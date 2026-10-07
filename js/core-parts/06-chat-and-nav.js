/**
 * core-parts/06-chat-and-nav.js
 * Dock chat, switchDockTab, announcements/report mid-layer (behavior preserved)
 * Lines from original core.js: 10044-13870
 * DO NOT edit js/core.js directly — edit this file, then run: node scripts/assemble-core.js
 */
            window.switchDockTab = function(tab, skipReturn, options) {
                options = options || {};
                // ★ 小猫AI dock 中间 tab：打开独立二级浮层(panelAiChat)，不走 dock-panel 显隐
                if (tab === 'ai-chat') {
                    document.querySelectorAll('.dock-tab').forEach(function(t) { t.classList.remove('active'); });
                    var aicBtn = document.querySelector('.dock-tab[data-tab="ai-chat"]');
                    if (aicBtn) aicBtn.classList.add('active');
                    currentDockTab = 'ai-chat';
                    window.safeStorage.set('xtj_current_tab', 'ai-chat');
                    requestAnimationFrame(syncDockIndicator);
                    var _opener = window.__xtjOpenAiChatFromDock || window.__xtjOpenAiChat;
                    if (typeof _opener === 'function') { try { _opener(); } catch (eDock) { console.warn('[dock] open ai-chat failed', eDock); } }
                    else { try { window.__xtjPendingAiChatOpen = true; } catch (ePend) {} }
                    // ★ 小猫AI 点击动画
                    if (aicBtn) {
                        if (typeof triggerTabAnimation === 'function') {
                            try { triggerTabAnimation(aicBtn, 'ai-chat'); } catch (eAnim) {}
                        } else {
                            try {
                                aicBtn.classList.remove('anim-brain'); void aicBtn.offsetWidth;
                                aicBtn.classList.add('anim-brain');
                                setTimeout(function() { aicBtn.classList.remove('anim-brain'); }, 950);
                            } catch (eAnim2) {}
                        }
                    }
                    return;
                }
                // 离开小猫AI 到其它 tab → 关闭小猫AI 浮层
                if (currentDockTab === 'ai-chat') {
                    if (typeof window.__xtjCloseAiChat === 'function') {
                        try { window.__xtjCloseAiChat(); } catch (eClose) {}
                    }
                }
                var shouldAnimateTab = options.animate === true;
                if (tab !== currentDockTab) {
                    try { var imv = document.getElementById('imgViewer'); if (imv && imv.classList.contains('active')) closeImageViewer(); } catch(e) {}
                    try { var am = document.getElementById('announcementModal'); if (am && am.classList.contains('active')) closeAnnouncementModal(); } catch(e) {}
                    try { var sm = document.getElementById('statModal'); if (sm && sm.classList.contains('active')) sm.classList.remove('active'); } catch(e) {}
                    try { var cm = document.getElementById('commentModal'); if (cm && cm.classList.contains('active')) closeModal('commentModal'); } catch(e) {}
                    document.body.style.overflow = '';
                }
                if (shouldAnimateTab) {
                    var btn = document.querySelector('.dock-tab[data-tab="' + tab + '"]');
                    if (btn) triggerTabAnimation(btn, tab);
                }
                const now = Date.now();
                touchUserSession(false);

                // 双击当前 tab 触发刷新（300ms 内再次点击）
                const isDoubleTap = (tab === currentDockTab) && lastTabTapTime[tab] && (now - lastTabTapTime[tab] < 300);

                if (tab === currentDockTab && !skipReturn) {
                    if (isDoubleTap && !isRefreshing[tab]) {
                        // 双击：执行刷新
                        isRefreshing[tab] = true;
                        lastTabTapCount[tab] = (lastTabTapCount[tab] || 0) + 1;

                        if (tab === 'ai') {
                            if (!window.currentUser) {
                                // ★ 修复：双击刷新在未登录时不再调用 renderPhotoWallLockedState()
                                // 把整个 photoGrid 替换成"登录提示"锁定页（破坏照片墙网格且无恢复入口）。
                                // 改为与单击分支一致的 ensurePhotoWallVisibleContent()（未登录时它只做
                                // 加载/兜底渲染，不替换网格），并复位刷新锁，保留网格不被破坏。
                                isRefreshing[tab] = false;
                                window.showToast('请先登录');
                                ensurePhotoWallVisibleContent().catch(function(err) {
                                    console.warn('[photo-wall] double-tap refresh visibility check failed', err);
                                });
                                return;
                            }
                            window.showToast('正在刷新...');
                            ensurePhotoWallLoaded().then(function() {
                                if (typeof window.loadPhotoWallData === 'function') {
                                    return window.loadPhotoWallData(true).then(function() {
                                        if (typeof window.renderPhotoWall === 'function') {
                                            window.renderPhotoWall();
                                        }
                                    });
                                }
                            }).then(function() {
                                isRefreshing[tab] = false;
                                window.showToast('刷新完成');
                            }).catch(function() {
                                isRefreshing[tab] = false;
                                window.showToast('刷新失败');
                            });
                        } else if (tab === 'posts') {
                            // 帖子页刷新
                            window.showToast('正在刷新...');
                            // ★ 修复：不再先删缓存再刷新。若网络失败，用户仍可看到旧数据与重试入口；
                            // 刷新成功时 loadFeed 会写入新快照自然覆盖旧缓存。
                            if (typeof window.initialLoad === 'function') {
                                rebuildFeedFromCurrentState()
                                    .then(function() {
                                        isRefreshing[tab] = false;
                                        return syncFeedDataInBackground();
                                    }).then(function() {
                                        window.showToast('刷新完成');
                                    })
                                    .catch(function(err) {
                                        isRefreshing[tab] = false;
                                        console.error('[posts] fast refresh failed', err);
                                        window.showToast('刷新失败');
                                    });
                            }
                            // 回到顶部
                            const panel = document.getElementById('panelPosts');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                        } else if (tab === 'chat') {
                            // 聊天 tab 刷新逻辑
                            // ★ 2026-09-27 修复（审计 C14）：旧实现在调用 loadDockChatList() 后
                            //   **不 await** 就立刻弹「刷新完成」并释放刷新锁 isRefreshing[tab]。
                            //   后果：① 提示先报成功、网络失败时又报失败（自相矛盾）；
                            //   ② 锁提前释放，用户可在请求在途时再次双击触发并发刷新。
                            //   改为 await 真正完成后才给结果提示，并在 finally 里释放锁。
                            window.showToast('正在刷新...');
                            window.dockChatListCacheTime = 0;
                            Promise.resolve()
                                .then(function() { return loadDockChatList(); })
                                .then(function() {
                                    window.showToast('刷新完成');
                                })
                                .catch(function(err) {
                                    console.error('[chat] refresh failed', err);
                                    window.showToast('刷新失败');
                                })
                                .then(function() {
                                    // finally 语义：无论成功/失败都释放锁
                                    isRefreshing[tab] = false;
                                });
                        } else if (tab === 'profile') {
                            // 个人页刷新
                            window.showToast('正在刷新...');
                            syncProfileUser();
                            if (currentUser) loadUserAvatar();
                            loadProfileActivity(true);
                            isRefreshing[tab] = false;
                            window.showToast('刷新完成');
                        }
                    } else {
                        // 单击：执行返回顶部操作
                        lastTabTapCount[tab] = 1;
                        if (tab === 'posts') {
                            // 帖子页：回到顶部
                            const panel = document.getElementById('panelPosts');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                        } else if (tab === 'chat') {
                            // 聊天页：如果在对话中则返回列表，否则回到顶部
                            if (dockChatActiveUser) {
                                dockChatGoBack();
                            } else {
                                const panel = document.getElementById('panelChat');
                                if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                            }
                        } else if (tab === 'ai') {
                            const photoWallPage = document.getElementById('photoWallContainer');
                            if (photoWallPage) photoWallPage.scrollTo({ top: 0, behavior: 'smooth' });
                            if (window.currentUser) {
                                ensurePhotoWallVisibleContent().catch(function(err) {
                                    console.warn('[photo-wall] current tab visibility check failed', err);
                                });
                            }
                        } else if (tab === 'profile') {
                            // 我的页面：回到顶部
                            const panel = document.getElementById('panelProfile');
                            if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                    }
                    lastTabTapTime[tab] = now;
                    return;
                }

                // 记录本次点击的 tab
                lastTabTapTime[tab] = now;
                lastTabTapCount[tab] = 1;
                if (currentDockTab === 'ai' && tab !== 'ai' && typeof window.cleanupPhotoWallTransientState === 'function') {
                    window.cleanupPhotoWallTransientState();
                }
                var previousPanel = document.querySelector('.dock-panel.active');
                // Keep receiving sitewide messages; off-tab polling only reads the list.
                if (window.currentUser) startDMPolling(30000, true);
                currentDockTab = tab;
                window.safeStorage.set('xtj_current_tab', tab);
                document.querySelectorAll('.dock-tab').forEach(t => t.classList.remove('active'));
                const panel = document.getElementById('panel' + tab.charAt(0).toUpperCase() + tab.slice(1));
                if (dockPanelTransitionTimer) clearTimeout(dockPanelTransitionTimer);
                if (dockPanelAnimation) {
                    try { dockPanelAnimation.cancel(); } catch (_) {}
                    dockPanelAnimation = null;
                }
                var reduceDockMotion = document.documentElement.getAttribute('data-xtj-motion') === 'off';
                try { reduceDockMotion = reduceDockMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
                document.querySelectorAll('.dock-panel').forEach(function(candidate) {
                    if (candidate !== previousPanel && candidate !== panel) candidate.classList.remove('active', 'is-entering', 'is-leaving');
                });
                if (panel) {
                    if (!previousPanel || previousPanel === panel || reduceDockMotion) {
                        if (previousPanel && previousPanel !== panel) previousPanel.classList.remove('active', 'is-entering', 'is-leaving');
                        panel.classList.add('active');
                        panel.classList.remove('is-entering', 'is-leaving');
                    } else {
                        previousPanel.classList.remove('active', 'is-entering', 'is-leaving');
                        panel.classList.add('active');
                        panel.classList.remove('is-entering', 'is-leaving');
                        var animatedSurface = panel;
                        if (animatedSurface && typeof animatedSurface.animate === 'function') {
                            dockPanelAnimation = animatedSurface.animate([
                                { opacity: .65 },
                                { opacity: 1 }
                            ], { duration: 180, easing: 'ease-out' });
                            dockPanelAnimation.onfinish = dockPanelAnimation.oncancel = function() {
                                dockPanelAnimation = null;
                            };
                        }
                    }
                }
                const tabBtn = document.querySelector('.dock-tab[data-tab="' + tab + '"]');
                if (tabBtn) tabBtn.classList.add('active');
                requestAnimationFrame(syncDockIndicator);
                if (tab === 'posts') { if (window._rainResume) window._rainResume(); }
                else { if (window._rainPause) window._rainPause(); }
                if (tab === 'chat') {
                    updateChatAuthUI();
                    if (typeof dockChatActiveUser !== 'undefined' && dockChatActiveUser) {
                        document.getElementById('dockChatListView').classList.add('hidden');
                        document.getElementById('dockChatDetailView').classList.remove('hidden');
                        document.getElementById('dockChatBackBtn').style.display = 'flex';
                        document.getElementById('dockChatTitle').textContent = dockChatActiveUser;
                        if (!(options && options.source === 'openChat')) {
                            // ★ 2026-09-25：切回聊天 Tab 属于恢复既有界面，静默刷新即可，
                            //   不要重画骨架（否则每次切 Tab 都闪一下）。
                            loadDockChatMessages(dockChatActiveUser, false, true);
                        }
                    } else {
                        loadDockChatList();
                    }
                    syncDockChatLayoutState();
                    startDMPolling(300000, !!(options && options.source === 'openChat'));
                }
                if (tab === 'ai') {
                    if (!window.currentUser) {
                        // ★ 修复：未登录时不再把整个 photoGrid 替换成"登录提示"锁定页
                        // （破坏网格且登录后不自动恢复），与 05 双击刷新分支策略对齐：
                        // 仅提示登录并做可见性兜底，保留网格结构。
                        if (typeof window.showToast === 'function') window.showToast('请先登录');
                        ensurePhotoWallVisibleContent().catch(function(err) {
                            console.warn('[photo-wall] visibility check failed', err);
                        });
                    } else {
                        setPhotoWallLockedState(false);
                        ensurePhotoWallLoaded().then(function() {
                            if (typeof window.initPhotoWall !== 'function') {
                                throw new Error('photo_wall_init_missing');
                            }
                            return window.initPhotoWall();
                        }).catch(function(error) {
                            var grid = document.getElementById('photoGrid');
                            if (grid) {
                                grid.innerHTML =
                                    '<div class="photo-wall-empty">' +
                                    '<div>照片墙模块加载失败，请重试</div>' +
                                    '</div>';
                            }
                            console.error('[PhotoWall] module load failed:', error);
                        });
                        // 自动兜底：延迟 100ms 检查 photoGrid 是否仍为空
                        setTimeout(function() {
                            var grid = document.getElementById('photoGrid');
                            if (!grid || grid.children.length > 0) return;
                            if (typeof window.renderPhotoWall === 'function') {
                                window.renderPhotoWall().catch(function(e) {
                                    console.error('[PhotoWall] auto-fallback render failed:', e);
                                });
                            } else if (typeof window.initPhotoWall === 'function') {
                                window.initPhotoWall(true).catch(function(e) {
                                    console.error('[PhotoWall] auto-fallback init failed:', e);
                                });
                            }
                        }, 100);
                    }
                }
                if (tab === 'profile') { syncProfileUser(); if (currentUser) loadUserAvatar(); loadProfileActivity(false); if (typeof clearReportReplyBadge === 'function') clearReportReplyBadge(); }
            };

            // Animation class mapping
            var animClassMap = { posts: 'anim-post', chat: 'anim-chat', ai: 'anim-ai', 'ai-chat': 'anim-brain', profile: 'anim-profile' };
            // Track which buttons currently have animation playing
            var animatingTabs = {};
            // Animation durations by tab (in ms, matching CSS)
            var animDurations = { posts: 900, chat: 900, ai: 900, 'ai-chat': 900, profile: 900 };
            var dockTabAnimationTimers = {};
            var dockTabAnimationElements = {};
            var dockTabAnimationGeneration = 0;

            function clearTabAnimation(el, tab) {
                if (dockTabAnimationTimers[tab]) {
                    clearTimeout(dockTabAnimationTimers[tab]);
                    delete dockTabAnimationTimers[tab];
                }
                if (el) {
                    el.classList.remove(animClassMap[tab]);
                    var animLayer = el.querySelector('.anim-layer');
                    if (animLayer) animLayer.style.willChange = '';
                }
                delete dockTabAnimationElements[tab];
                animatingTabs[tab] = false;
            }

            function clearAllTabAnimations() {
                Object.keys(animClassMap).forEach(function(tabName) {
                    clearTabAnimation(dockTabAnimationElements[tabName], tabName);
                });
            }

            function triggerTabAnimation(el, tab) {
                var cls = animClassMap[tab];
                if (!cls) return;
                var generation = ++dockTabAnimationGeneration;
                clearAllTabAnimations();
                try {
                    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
                } catch (_) {}
                animatingTabs[tab] = true;
                dockTabAnimationElements[tab] = el;
                requestAnimationFrame(function() {
                    if (generation !== dockTabAnimationGeneration) return;
                    var animLayer = el.querySelector('.anim-layer');
                    if (animLayer) animLayer.style.willChange = 'transform, opacity';
                    el.classList.add(cls);
                    dockTabAnimationTimers[tab] = setTimeout(function() {
                        if (generation === dockTabAnimationGeneration) {
                            clearTabAnimation(el, tab);
                        }
                    }, animDurations[tab] + 50);
                });
            }

            // 按钮点击由 HTML onclick 属性处理，不再需要 JS 委托
            installDockIndicatorDrag();
            window.addEventListener('resize', function() {
                requestAnimationFrame(syncDockIndicator);
                requestAnimationFrame(syncDockChatLayoutState);
            });
            setTimeout(function() {
                requestAnimationFrame(syncDockIndicator);
            }, 0);
            // ========== Dock 相关功能 ==========
            let dockChatActiveUser = null;
            let dockChatSending = false;
            let _dockPreviewUrl = null;
            var _dockChatFriendNotes = Object.create(null);
            var _dockChatFriendNotesOwner = '';
            var _dockChatFriendNotesAt = 0;
            var _dockChatSocialTab = 'friends';
            var _dockChatSocialQuery = '';
            var _dockChatSocialRequestDirection = 'incoming';
            var _dockChatSocialLoadSeq = 0;
            var _dockChatSocialBadgeOwner = '';
            var _dockChatSocialBadgeAt = 0;
            var _dockChatRelationshipSeq = 0;

            // ★ 2026-09-25 修复（审计 M-16）：判据必须与 desktop.css 的加载条件一致。
            //   desktop.min.css 的 media 是 (min-width:768px) and (min-height:480px)，
            //   而这里此前只看宽度 —— 横屏手机（如 844x390）会被判为桌面分屏，加上
            //   .desktop-split 并取消两栏 hidden，但分屏样式根本没加载，于是变成
            //   "单栏布局 + dock 栏不隐藏"的混合态。
            function shouldUseDesktopChatSplitLayout() {
                var width = Math.max(
                    window.innerWidth || 0,
                    document.documentElement ? (document.documentElement.clientWidth || 0) : 0
                );
                var height = Math.max(
                    window.innerHeight || 0,
                    document.documentElement ? (document.documentElement.clientHeight || 0) : 0
                );
                return width >= 768 && (height >= 480 || document.documentElement.classList.contains('xtj-tablet-layout'));
            }

            function renderDockChatDesktopEmptyState() {
                var messages = document.getElementById('dockChatMessages');
                if (!messages || window.__xtjAiChatActive) return;
                // ★ 2026-09-25 修复（审计 H-4，隐私）：未登录分支必须放在"内容归属"判断
                //   **之前**。旧顺序下，dataset.chatUser 仍是上一个账号的会话对手名时，
                //   会命中下面的 return，于是登出后桌面分屏继续显示**上一账号的完整聊天记录**。
                if (!window.currentUser) {
                    messages.innerHTML = '<div class="chat-empty chat-empty-state"><div class="ce-icon">🔒</div><div>登录后可查看消息</div><div style="font-size:12px;">登录后即可查看和发送私信</div></div>';
                    delete messages.dataset.chatUser;
                    messages.dataset.emptyRendered = '1';
                    return;
                }
                // ★ 2026-09-25 修复（切换联系人时桌面端"闪白"）：旧实现无条件重写空状态
                //   DOM。会话切换过程中 switchDockTab → syncDockChatLayoutState 会走到这里，
                //   把正在渲染的消息区顶掉再重画，观感就是闪一下白。仅在内容确实不属于
                //   任何会话（没有渲染过消息）时才重绘。
                if (messages.dataset.chatUser && messages.dataset.chatUser !== '__empty__') return;
                if (messages.dataset.emptyRendered === '1') return;
                messages.innerHTML = '<div class="chat-empty chat-empty-state"><div class="ce-icon">💬</div><div>选择一条会话开始聊天</div><div style="font-size:12px;">左侧列表会保持可见，方便切换会话</div></div>';
                messages.dataset.emptyRendered = '1';
            }

            // ★ 2026-09-25 新增（审计 H-4）：登出/切换账号时把聊天面板的**渲染态**一并清掉。
            //   旧实现只清了内存缓存（_chatCache / dockChatActiveUser），DOM 原样保留，
            //   叠加 renderDockChatDesktopEmptyState 的归属判断，导致桌面分屏在登出后
            //   仍显示上一个账号的私聊内容。由 doLogout 显式调用。
            window.__xtjResetChatPanels = function() {
                cancelChatFlashSend();
                if(_chatSendFlight){_chatSendFlight.controller.abort();_chatSendFlight=null;}
                if (_chatSocialPanels) _chatSocialPanels.clear();
                resetChatAttachmentQueue();_chatBatchSending=false;dockChatSending=false;
                var gallery=document.getElementById('chatGallery');if(gallery)gallery.__close ? gallery.__close() : gallery.remove();
                _chatPushOwner='';_chatPushEnabled=false;
                setTimeout(function(){window.__xtjSyncChatPush?.();},0);
                if (_chatDomSnapshots) _chatDomSnapshots.clear();
                if(_flashViewer)_flashViewer.close();
                cancelDockChatSendFlights(); resetDockChatTyping(); closeDockChatConversationMenu(true);
                closeAuthorSupport(); _supportOwner='';
                closeChatHistory(); cancelChatVoice(); clearChatMessageDraft(); _chatRecordedFile = null; _chatShowArchived = false; var archiveButton = document.getElementById('chatArchiveButton'); if (archiveButton) { archiveButton.textContent = '归档'; archiveButton.setAttribute('aria-pressed','false'); } _chatReactionSeq++; clearTimeout(_chatReactionTimer);
                document.querySelectorAll('.chat-reaction-picker').forEach(function(p) { p.remove(); });
                try {
                    // ★ 2026-09-27 修复（审计 S6 配套）：登出时必须**顶掉所有在途请求**，
                    //   否则登出前发出的 /api/dm/list 回来后（seq 未变）会把上个账号的
                    //   会话列表重新画进刚被清空的 DOM —— 正是本次要根治的残留问题。
                    //   计数器是共享的，nextMessageLoadSeq 也在同一变量上，一并失效即可。
                    if (typeof _dockChatListLoadSeq === 'number') _dockChatListLoadSeq++;
                    if (typeof _dockChatLoadSeq === 'number') _dockChatLoadSeq++;
                    _dockChatSocialLoadSeq++;
                    _dockChatRelationshipSeq++;
                    _dockChatFriendNotes = Object.create(null);
                    _dockChatFriendNotesOwner = '';
                    _dockChatFriendNotesAt = 0;
                    var messages = document.getElementById('dockChatMessages');
                    if (messages) {
                        messages.innerHTML = '';
                        delete messages.dataset.chatUser;
                        delete messages.dataset.emptyRendered;
                    }
                    var list = document.getElementById('dockChatList');
                    if (list) { list.innerHTML = ''; list.removeAttribute('data-list-owner'); }
                    var title = document.getElementById('dockChatTitle');
                    if (title) title.textContent = '消息';
                    var socialSheet = document.getElementById('dockChatSocialSheet');
                    if (socialSheet) { socialSheet.classList.add('hidden'); socialSheet.setAttribute('aria-hidden', 'true'); }
                    var socialContent = document.getElementById('dockChatSocialContent');
                    if (socialContent) socialContent.innerHTML = '';
                    var socialBadge = document.getElementById('dockChatSocialPendingBadge');
                    if (socialBadge) { socialBadge.hidden = true; socialBadge.textContent = '0'; }
                    var relationNotice = document.getElementById('dockChatRelationshipNotice');
                    if (relationNotice) relationNotice.hidden = true;
                    _dockChatListRenderSignature = '';
                    _chatRenderSignature = {};
                } catch (e) {}
            };

            function clearDockChatDesktopEmptyFlag() {
                var messages = document.getElementById('dockChatMessages');
                if (messages) delete messages.dataset.emptyRendered;
            }

            function syncDockChatLayoutState() {
                if (window.__xtjAiChatActive) return;
                var listView = document.getElementById('dockChatListView');
                var detailView = document.getElementById('dockChatDetailView');
                var container = document.getElementById('dockChatContainer');
                if (container) container.classList.toggle('has-active-conversation', !!dockChatActiveUser);
                var backBtn = document.getElementById('dockChatBackBtn');
                syncAuthorSupportButton(dockChatActiveUser);
                var titleEl = document.getElementById('dockChatTitle');
                var conversationBtn = document.getElementById('dockChatConversationBtn');
                if (conversationBtn) conversationBtn.hidden = !dockChatActiveUser;
                var inputArea = document.querySelector('#panelChat .chat-input-area');
                if (!listView || !detailView) return;

                if (shouldUseDesktopChatSplitLayout()) {
                    if (container) container.classList.add('desktop-split');
                    listView.classList.remove('hidden');
                    detailView.classList.remove('hidden');
                    if (backBtn) backBtn.style.display = 'none';
                    if (!dockChatActiveUser) {
                        if (titleEl) titleEl.textContent = '消息';
                        if (inputArea) inputArea.style.display = 'none';
                        renderDockChatDesktopEmptyState();
                    } else if (inputArea) {
                        inputArea.style.display = '';
                    }
                    return;
                }

                if (container) container.classList.remove('desktop-split');
                if (!dockChatActiveUser) {
                    detailView.classList.add('hidden');
                    listView.classList.remove('hidden');
                    if (backBtn) backBtn.style.display = 'none';
                    if (titleEl) titleEl.textContent = '消息';
                } else {
                    listView.classList.add('hidden');
                    detailView.classList.remove('hidden');
                    if (backBtn) backBtn.style.display = 'flex';
                }
                if (inputArea) inputArea.style.display = '';
            }

            function buildDockChatListSkeleton() {
                return '<div class="chat-list-skeleton" aria-hidden="true">' + [0, 1, 2, 3].map(function() {
                    return '<div class="chat-list-item chat-list-skeleton-row"><span class="cli-avatar"></span>' +
                        '<span class="cli-info"><span class="cli-name"><span class="chat-list-skeleton-line chat-list-skeleton-name"></span></span>' +
                        '<span class="cli-preview"><span class="chat-list-skeleton-line chat-list-skeleton-preview"></span></span></span>' +
                        '<span class="cli-right"><span class="chat-list-skeleton-line chat-list-skeleton-time"></span></span></div>';
                }).join('') + '</div>';
            }
            window.__xtjChatListSkeletonHtml = buildDockChatListSkeleton;

                                                            function renderChatLoadingState(el, options) {
                if (!el) return;
                var title = options && options.title ? options.title : '加载中..';
                var subtitle = options && options.subtitle ? options.subtitle : '';
                var variant = options && options.variant ? String(options.variant) : '';
                var seq = parseInt(options && options.seq, 10);
                // ★ 2026-09-25 修复（切换联系人骨架闪烁）：切换会话时先显示 loading 骨架，再把
                //   网络回包渲染进去，两次 innerHTML 替换之间骨架会闪一下（观感像"闪白/卡顿"）。
                //   给骨架打上序号；同一序号（同一次会话打开）内的后续调用直接跳过，不再重绘。
                if (seq > 0 && el.getAttribute('data-loading-seq') === String(seq) && el.querySelector('.xtj-loading')) return;
                if (seq > 0) el.setAttribute('data-loading-seq', String(seq));
                el.innerHTML = variant === 'chat-list' ? buildDockChatListSkeleton() : getXtjLoadingHtml(title, subtitle, variant);
            }

            // ★ 2026-09-27 修复（审计 C11）：从帖子/通知直接 openChat() 进入私信详情时，
            //   会话列表根本没被加载过（列表 DOM 仍是空的）。此时返回列表会走下面的
            //   `window.dockChatListCacheTime = Date.now()` 分支 —— 因为"缓存新鲜"而
            //   直接 return，loadDockChatList 判定 Date.now()-cacheTime < 20s 直接跳过，
            //   于是列表是空白的，要等 20s 或手动下拉才会加载。
            //   这里用一个显式标记记录"列表从未成功渲染过"，返回列表时据此强制加载一次。
            var _dockChatListEverLoaded = false;
            var _dockChatConversationStates = {};
            var _dockChatConversationOwner = '';
            var _dockChatDraftTimer = null;
            var _dockChatDraftLoadSeq = 0;
            var _dockChatDraftWrites = {};
            var _dockChatDraftConflicts = {};

            function dockChatConversationRows(states) {
                return states.filter(function(s) { return s && !s.deleted && s.peer_name; }).map(function(s) {
                    var preview = s.draft_text ? '草稿：' + s.draft_text : s.last_message;
                    if (!preview && s.last_message_type && s.last_message_type !== 'text') preview = '[' + s.last_message_type + ']';
                    return { other_user: s.peer_name, last_message: preview || '',
                        last_time: s.last_message_at || '', unread: Number(s.unread_count) || 0,
                        pinned: !!s.pinned_at, muted: !!s.muted_until && (s.muted_until === 'infinity' || Date.parse(s.muted_until) > Date.now()),
                        draft: !!s.draft_text };
                }).sort(function(a,b) {
                    return Number(b.pinned) - Number(a.pinned) || String(b.last_time).localeCompare(String(a.last_time));
                });
            }

            window.__xtjApplyConversationSnapshot = function(states) {
                if (!Array.isArray(states) || !window.currentUser || currentDockTab !== 'chat') return;
                if (_dockChatConversationOwner && _dockChatConversationOwner !== window.currentUser) return;
                _dockChatConversationOwner = window.currentUser;
                _dockChatConversationStates = {};
                states.forEach(function(state) {
                    if (state && state.peer_name) _dockChatConversationStates[state.peer_name] = state;
                });
                var list = document.getElementById('dockChatList');
                if (!list || list.getAttribute('data-list-owner') !== window.currentUser) return;
                renderDockChatConversationList(list,dockChatConversationRows(states));
                renderDockChatFixedEntry(list);
                window.dockChatListCacheTime = Date.now();
            };

            // Shared short transitions. Each surface owns one animation so rapid
            // close/reopen cannot let an old completion hide a newly opened menu.
            var _chatSurfaceMotions = new WeakMap();
            var _chatSendFlights = new Map();
            function chatReducedMotion() {
                return document.documentElement.getAttribute('data-xtj-motion')==='off' ||
                    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
            }
            function transitionChatSurface(surface, open, immediate, animatedElement) {
                if (!surface) return;
                var previous = _chatSurfaceMotions.get(surface);
                _chatSurfaceMotions.delete(surface);
                if (previous) previous.cancel();
                var card = animatedElement || surface.firstElementChild;
                surface.inert = !open;
                surface.setAttribute('aria-hidden', open ? 'false' : 'true');
                if (open) { surface.hidden=false; surface.classList.remove('hidden'); }
                if (immediate || chatReducedMotion() || !card || typeof card.animate !== 'function') {
                    if (!open) { surface.hidden=true; surface.classList.add('hidden'); }
                    return;
                }
                var frames = open
                    ? [{opacity:0,transform:'translateY(-8px) scale(.97)'},{opacity:1,transform:'translateY(0) scale(1)'}]
                    : [{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(-5px) scale(.98)'}];
                var animation = card.animate(frames,{duration:open ? 200 : 140,easing:'cubic-bezier(.2,.75,.25,1)',fill:'both'});
                _chatSurfaceMotions.set(surface,animation);
                animation.finished.then(function() {
                    if (_chatSurfaceMotions.get(surface)!==animation) return;
                    _chatSurfaceMotions.delete(surface);
                    if (!open) { surface.hidden=true; surface.classList.add('hidden'); }
                    animation.cancel();
                }).catch(function() {});
            }
            function cancelDockChatSendFlights() {
                if (!_chatSendFlights) return;
                _chatSendFlights.forEach(function(flight) { flight.finish(); });
            }
            function captureDockChatSendOrigin(file) {
                var source = document.querySelector(file && getChatUploadKind(file)!=='audio' ? '#dockCfpThumb' : '#panelChat .chat-input-wrap');
                if (!source || !source.getClientRects().length) source=document.querySelector('#panelChat .chat-input-wrap');
                if (!source || !source.getClientRects().length) return null;
                return source.getBoundingClientRect();
            }
            function animateDockChatSend(tempId, peer, origin) {
                if (!origin || chatReducedMotion() || dockChatActiveUser!==peer) return;
                var row = Array.prototype.find.call(document.querySelectorAll('#dockChatMessages .chat-msg-row'),function(node) {
                    return node.getAttribute('data-msg-key')==='t:'+tempId;
                });
                var bubble = row && row.querySelector('.chat-msg');
                if (!bubble || typeof bubble.animate!=='function') return;
                var destination = bubble.getBoundingClientRect();
                if (!destination.width || !destination.height) return;
                var ghost = bubble.cloneNode(true);
                ghost.classList.remove('sent-anim','pending');
                ghost.classList.add('chat-send-flight');
                ghost.setAttribute('aria-hidden','true');
                ghost.inert=true;
                ghost.removeAttribute('data-message-id');
                var styles = getComputedStyle(bubble);
                ['background','border','borderRadius','boxShadow','padding','color','font','lineHeight'].forEach(function(key) { ghost.style[key]=styles[key]; });
                Object.assign(ghost.style,{position:'fixed',left:destination.left+'px',top:destination.top+'px',width:destination.width+'px',height:destination.height+'px',maxWidth:'none',boxSizing:'border-box',margin:'0',zIndex:'1800',pointerEvents:'none',animation:'none',transition:'none',transformOrigin:'center center',overflow:'hidden'});
                ghost.querySelectorAll('[id]').forEach(function(node) { node.removeAttribute('id'); });
                ghost.querySelectorAll('img').forEach(function(img) { Object.assign(img.style,{display:'block',width:'100%',height:'100%',objectFit:'cover',maxHeight:'none'}); });
                document.body.appendChild(ghost);
                var dx=origin.left+origin.width/2-destination.left-destination.width/2;
                var dy=origin.top+origin.height/2-destination.top-destination.height/2;
                var sx=Math.max(.18,Math.min(1.25,origin.width/destination.width));
                var sy=Math.max(.18,Math.min(1,origin.height/destination.height));
                var flight={peer:peer,id:tempId,bubble:bubble,ghost:ghost};
                bubble.style.visibility='hidden';
                flight.finish=function() {
                    if (!_chatSendFlights.has(tempId)) return;
                    _chatSendFlights.delete(tempId);
                    if (flight.animation) flight.animation.cancel();
                    if (flight.bubble) flight.bubble.style.visibility='';
                    ghost.remove();
                };
                _chatSendFlights.set(tempId,flight);
                try {
                    flight.animation=ghost.animate([
                        {transform:'translate3d('+dx+'px,'+dy+'px,0) scale('+sx+','+sy+')',opacity:.72},
                        {transform:'translate3d(0,0,0) scale(1,1)',opacity:1}
                    ],{duration:290,easing:'cubic-bezier(.22,.72,.24,1)',fill:'both'});
                    flight.animation.finished.then(flight.finish,flight.finish);
                } catch (_) { flight.finish(); }
            }
            window.addEventListener('resize',cancelDockChatSendFlights);
            window.addEventListener('pagehide',cancelDockChatSendFlights);
            var chatMotionPanel=document.getElementById('panelChat');
            if (chatMotionPanel && typeof MutationObserver==='function') {
                new MutationObserver(function() {
                    if (!chatMotionPanel.classList.contains('active')) {
                        if(_flashViewer)_flashViewer.close();
                        cancelChatFlashSend();cancelDockChatSendFlights(); resetDockChatTyping(); closeDockChatConversationMenu(true);
                    }
                }).observe(chatMotionPanel,{attributes:true,attributeFilter:['class']});
            }

            var _chatDomSnapshots = new Map();
            var _chatRouteMotion = null;
            function finishDockChatRoute() {
                var job = _chatRouteMotion;
                if (!job) return;
                _chatRouteMotion = null;
                job.animations.forEach(function(animation) { animation.cancel(); });
                job.detail.classList.remove('chat-route-layer');
                job.detail.inert = false;
                ['--chat-route-top','--chat-route-left','--chat-route-width','--chat-route-height'].forEach(function(key) { job.detail.style.removeProperty(key); });
                if (!dockChatActiveUser && !shouldUseDesktopChatSplitLayout()) job.detail.classList.add('hidden');
            }
            function prepareDockChatExit() {
                finishDockChatRoute();
                var detail = document.getElementById('dockChatDetailView'), container = document.getElementById('dockChatContainer');
                if (shouldUseDesktopChatSplitLayout() || chatReducedMotion() || !detail || detail.classList.contains('hidden') || !container) return false;
                var box = detail.getBoundingClientRect(), frame = container.getBoundingClientRect();
                detail.style.setProperty('--chat-route-top',box.top-frame.top+'px');
                detail.style.setProperty('--chat-route-left',box.left-frame.left+'px');
                detail.style.setProperty('--chat-route-width',box.width+'px');
                detail.style.setProperty('--chat-route-height',box.height+'px');
                detail.classList.add('chat-route-layer'); detail.inert = true;
                return true;
            }
            function animateDockChatRoute(open) {
                if (open) finishDockChatRoute();
                var detail = document.getElementById('dockChatDetailView');
                if (!detail || chatReducedMotion() || typeof detail.animate !== 'function') { if(!open && detail){detail.classList.remove('chat-route-layer');detail.inert=false;} return; }
                var header = document.querySelector('#dockChatContainer > .chat-header');
                var distance = shouldUseDesktopChatSplitLayout() ? '24px' : '100%';
                var frames = open ? [{transform:'translate3d('+distance+',0,0)'},{transform:'translate3d(0,0,0)'}] : [{transform:'translate3d(0,0,0)'},{transform:'translate3d(100%,0,0)'}];
                var job = {detail:detail,animations:[]}; _chatRouteMotion = job;
                var start = document.timeline.currentTime;
                [detail,open && !shouldUseDesktopChatSplitLayout() ? header : null].filter(Boolean).forEach(function(node) {
                    var animation = node.animate(frames,{duration:300,easing:'cubic-bezier(.22,.7,.25,1)',fill:'both'});
                    animation.startTime=start;job.animations.push(animation);
                });
                Promise.all(job.animations.map(function(animation){return animation.finished.catch(function(){});})).then(function(){if(_chatRouteMotion===job)finishDockChatRoute();});
            }
            window.addEventListener('resize',finishDockChatRoute);
            window.addEventListener('pagehide',finishDockChatRoute);
            window.addEventListener('auth-ready',finishDockChatRoute);
            function forgetDockChatConversationMessages(peer) {
                _chatDomSnapshots.delete(getDockChatCacheKey(peer));
                _chatCache[getDockChatCacheKey(peer)] = [];
                _chatRenderSignature[peer] = undefined;
            }

            function dockChatGoBack() {
                var routeExit = prepareDockChatExit();
                cancelChatFlashSend();
                closeAuthorSupport();
                closeChatHistory(); cancelChatVoice(); clearChatMessageDraft(); clearDockChatFilePreview(false); _chatHistoryFocus = '';
                closeDockChatConversationMenu(true);
                cancelDockChatSendFlights();
                resetDockChatTyping();
                showDockChatPresence('',false);
                if (_dockChatDraftTimer && dockChatActiveUser) {
                    clearTimeout(_dockChatDraftTimer);
                    _dockChatDraftTimer = null;
                    var currentDraftInput = document.getElementById('dockChatInput');
                    persistDockChatDraft(dockChatActiveUser,currentDraftInput ? currentDraftInput.value : '');
                }
                var conversationButton = document.getElementById('dockChatConversationBtn');
                if (conversationButton) conversationButton.hidden = true;
                dockChatActiveUser = null;
                dockChatSending = false;
                _dockChatLoadSeq += 1;
                // 如果当前处于 AI 聊天状态，优先关闭 AI 并恢复标准 UI
                if (window.__xtjAiChatActive) {
                    if (typeof window.__xtjCloseAiChat === 'function') window.__xtjCloseAiChat();
                    var chatInputArea2 = document.querySelector('.chat-input-area');
                    if (chatInputArea2) chatInputArea2.style.display = '';
                    var chatMessages2 = document.getElementById('dockChatMessages');
                    if (chatMessages2) chatMessages2.classList.remove('ai-chat-container');
                }
                window.dockChatListCacheTime = 0;
                syncDockChatLayoutState();
                if (routeExit) animateDockChatRoute(false);
                // ★ 2026-09-25 修复：返回会话列表时 0 值即"缓存失效"，缓存时长被提到 20s 后
                //   这里会必然触发一次 /api/dm/list 往返（列表明明还在屏幕上）。改为标记为刚刷新。
                // ★ 2026-09-27 修复（C11）：若列表**从未加载成功过**（例如从帖子直接 openChat
                //   进的详情），则必须清掉缓存时间戳强制加载，否则返回时列表空白。
                var listEl = document.getElementById('dockChatList');
                var listHasContent = !!(listEl && listEl.children.length);
                if (_dockChatListEverLoaded || listHasContent) {
                    window.dockChatListCacheTime = Date.now();
                }
                loadDockChatList();
                startDMPolling(300000);
                if (typeof window.__xtjResetIOSChatViewport === 'function') {
                    window.__xtjResetIOSChatViewport();
                }
                if (restorePostsScroll !== null) {
                    switchDockTab('posts');
                    requestAnimationFrame(() => {
                        const postsPanel = document.getElementById('panelPosts');
                        if (postsPanel) postsPanel.scrollTop = restorePostsScroll;
                        restorePostsScroll = null;
                    });
                }
            }
            window.dockChatGoBack = dockChatGoBack;

            window.openChatList = function() { switchDockTab('chat', true); };
            window.closeChat = function() {
                _dockChatLoadSeq += 1;
                if (typeof window.__xtjResetIOSChatViewport === 'function') {
                    window.__xtjResetIOSChatViewport();
                }
                switchDockTab('posts');
            };

            let restorePostsScroll = null;

            window.openChat = function(userName) {
                finishDockChatRoute();
                cancelChatFlashSend();
                if(_flashViewer)_flashViewer.close();
                cancelDockChatSendFlights();
                resetDockChatTyping();
                closeChatHistory(); cancelChatVoice(); clearChatMessageDraft(); clearDockChatFilePreview(false); _chatHistoryFocus = '';
                if (!window.currentUser) { showToast('请先登录'); return; }
                // ★ 2026-09-27 待产品确认（审计 C13）：禁言是否应禁止"查看"私信。
                //   审计认为「禁言应只禁发送，不应禁查看」，但这属于**产品语义**问题，不是明确 bug。
                //   现状：禁言用户被这一行直接挡在会话之外（连历史都看不了）。
                //   保守处理：暂不放开权限，仅保留拦截 + TODO。
                //   → 若产品确认改为「仅禁发」，改动点：删除/放宽**本行** return，
                //     会话即可进入；发送侧仍由 sendDockChatMessage 第 1940 行附近的
                //     isUserMuted() 拦截兜底（发送必须拦，不动）。
                if (isUserMuted()) { showToast("您已被禁言，无法发送消息"); return; }
                if (userName === window.currentUser) { switchDockTab('chat', true); return; }
                if (currentDockTab === 'posts') {
                    const postsPanel = document.getElementById('panelPosts');
                    if (postsPanel) restorePostsScroll = postsPanel.scrollTop;
                }
                if (_dockChatDraftTimer && dockChatActiveUser) {
                    clearTimeout(_dockChatDraftTimer);
                    _dockChatDraftTimer = null;
                    var previousInput = document.getElementById('dockChatInput');
                    persistDockChatDraft(dockChatActiveUser,previousInput ? previousInput.value : '');
                }
                var supportDialog=document.getElementById('authorSupportDialog');
                if(userName!==_supportAuthor)closeAuthorSupport();
                else if (supportDialog && supportDialog.open) supportDialog.close();
                var oldMessages=document.getElementById('dockChatMessages');
                if (dockChatActiveUser && oldMessages && oldMessages.dataset.chatUser===dockChatActiveUser) {
                    _chatDomSnapshots.set(getDockChatCacheKey(dockChatActiveUser),Array.from(oldMessages.children));
                    while (_chatDomSnapshots.size>6) _chatDomSnapshots.delete(_chatDomSnapshots.keys().next().value);
                }
                dockChatActiveUser = userName;
                _chatPresenceSnapshot=null;
                showDockChatPresence('',false);
                closeDockChatConversationMenu(true);
                restoreDockChatDraft(userName);
                refreshDockChatPresence(userName);
                touchDockChatPresence();
                // ★ 2026-09-27 修复（C11）：直接进详情时，会话列表并未加载，
                //   标记为"待加载"，返回列表时 dockChatGoBack 会据此强制加载一次。
                _dockChatListEverLoaded = false;
                // 清除渲染签名，确保缓存加载不会因签名匹配跳过（当前 innerHTML 是 loading 状态）
                if (typeof _chatRenderSignature !== 'undefined') _chatRenderSignature[userName] = undefined;
                // ★ 2026-09-25 修复（切换联系人闪一下）：这里不再无条件画 loading 骨架。
                //   骨架的绘制统一交给 loadDockChatMessages —— 它有缓存时会直接渲染内容，
                //   只有真正「无缓存的首屏」才显示骨架，避免骨架→内容两次重绘造成闪烁。
                document.getElementById('dockChatListView').classList.add('hidden');
                document.getElementById('dockChatDetailView').classList.remove('hidden');
                document.getElementById('dockChatBackBtn').style.display = 'flex';
                var conversationButton = document.getElementById('dockChatConversationBtn');
                if (conversationButton) conversationButton.hidden = false;
                var titleEl = document.getElementById('dockChatTitle');
                if (titleEl) titleEl.textContent = _dockChatFriendNotes[userName] || userName;
                updateDockChatComposerPermission(userName);
                animateDockChatRoute(true);
                switchDockTab('chat', true, { source: 'openChat' });
                loadDockChatMessages(userName, true);
                startDMPolling(60000, true);
            };

            // ★ 2026-09-27 新增（审计 C8）：把"按会话分组 + 预热缓存"的逻辑抽成可复用函数，
            //   供首屏渲染与"截断补拉"两条路径共用，避免两处口径分叉。
            function buildDockChatConversations(allMsgs) {
                var convMap = {};
                var preheatMap = {};
                (Array.isArray(allMsgs) ? allMsgs : []).forEach(function(m) {
                    var other = m.user_name === window.currentUser ? m.media_url : m.user_name;
                    if (!other) return;
                    if (!convMap[other] || new Date(m.created_at) > new Date(convMap[other].last_time)) {
                        convMap[other] = { other_user: other, last_message: getDockChatMessagePreview(m), last_time: m.created_at, unread: 0 };
                    }
                    if (m.media_url === window.currentUser && !window.isMsgReadByMe(m)) {
                        convMap[other].unread = Math.min((convMap[other].unread || 0) + 1, 99);
                    }
                    if (!preheatMap[other]) preheatMap[other] = [];
                    preheatMap[other].push(m);
                });
                var convs = Object.keys(convMap).map(function(k) { return convMap[k]; })
                    .sort(function(a, b) { return new Date(b.last_time) - new Date(a.last_time); });
                return { convs: convs, preheatMap: preheatMap };
            }

            // 把 preheatMap 写进 _chatCache（只在缓存为空或确实更旧时写入，避免降级覆盖）
            function preheatDockChatCache(preheatMap) {
                try {
                    Object.keys(preheatMap).forEach(function(other) {
                        var k = getDockChatCacheKey(other);
                        var rows = preheatMap[other].sort(function(a, b) {
                            return String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
                                   String(a.id || '').localeCompare(String(b.id || ''));
                        });
                        var existing = _chatCache[k];
                        if (Array.isArray(existing) && existing.length >= rows.length && existing.length > 0) return;
                        _chatCache[k] = rows;
                    });
                } catch (ePreheat) { /* 预热失败不影响列表渲染 */ }
            }

            // ★ 2026-09-27 新增（审计 C8）：会话列表窗口截断的"温和兜底"补拉。
            //   现状局限（务必知晓）：
            //     · 后端 `/api/dm/list` **只接受 limit、不支持游标分页**（render-api/server.js
            //       的 dm/list 无 before/offset 参数），返回的是"该用户两个方向最近 N 条消息"，
            //       没有服务端未读聚合接口。
            //     · 因此当高频会话把最近 180 条塞满时，更早的旧会话会从列表消失，
            //       窗口外的未读也无法从服务端补齐。
            //   兜底做法（只用现有接口）：把 limit 提到服务端上限 500 再拉一次，
            //   按 id 去重合并后重算会话列表与未读角标 —— 能覆盖绝大多数场景，
            //   但**极端情况（>500 条仍被单一高频会话占满）依旧会截断**，
            //   彻底解法需要后端支持会话级聚合/游标（记为已知局限）。
            async function fetchDockChatListCatchUp(listOwner, listResultStale) {
                try {
                    var resp = await window.xtjProtectedFetch('/api/dm/list?limit=500', { timeoutMs: 15000, background: true });
                    if (!resp || !resp.ok) return null;
                    var json = await resp.json().catch(function() { return null; });
                    if (!json || !json.ok) return null;
                    if (listResultStale()) return null;
                    return json.data || [];
                } catch (eCatch) {
                    console.warn('[chat-list] 补拉更大会话窗口失败（保持首屏结果）:', eCatch && eCatch.message);
                    return null;
                }
            }

            // Keep only contact names for this tab and account. The first paint can show
            // recognizable contacts while the current previews and unread counts load.
            function cacheDockChatContactNames(owner, convs) {
                try {
                    sessionStorage.setItem('xtj_dm_contact_names:' + owner, JSON.stringify({
                        at: Date.now(), names: convs.map(function(c) { return c.other_user; }).slice(0, 80)
                    }));
                } catch (_) {}
            }
            function restoreDockChatContactNames(el, owner) {
                try {
                    var saved = JSON.parse(sessionStorage.getItem('xtj_dm_contact_names:' + owner) || 'null');
                    if (!saved || Date.now() - saved.at > 15 * 60 * 1000 || !Array.isArray(saved.names)) return false;
                    var names = saved.names.filter(function(name) { return typeof name === 'string' && name && name !== 'xxz'; });
                    if (!names.length) return false;
                    renderDockChatConversationList(el, names.map(function(name) {
                        return { other_user: name, last_message: '正在更新消息…', last_time: '', unread: 0 };
                    }));
                    renderDockChatFixedEntry(el);
                    return true;
                } catch (_) { return false; }
            }

            var _dockChatListRetryTimer = 0;
            async function loadDockChatList(userRetry) {
                if (_dockChatListRetryTimer) { clearTimeout(_dockChatListRetryTimer); _dockChatListRetryTimer=0; }
                const el = document.getElementById('dockChatList');
                if (!el) return;
                if (!window.currentUser) {
                    el.removeAttribute('data-list-owner');
                    el.innerHTML = '<div class="chat-empty"><div style="color:var(--xtj-text-muted);font-size:13px;padding:20px 0;">登录后可查看消息</div></div>';
                    setUnreadBadgeCount(0);
                    renderDockChatFixedEntry(el);
                    syncDockChatLayoutState();
                    return;
                }
                if (!dockChatActiveUser) {
                    syncDockChatLayoutState();
                }
                touchDockChatPresence();
                refreshChatSocialBadge(false);
                refreshChatFriendNotes(false);
                if (el.getAttribute('data-list-owner') === window.currentUser &&
                    Date.now() - (window.dockChatListCacheTime || 0) < DOCK_CHAT_CACHE_DURATION) return;
                // ★ 2026-09-27 修复（审计 S6：会话列表跨账号/跨登出残留）：
                //   此前只用 `listLoadSeq !== _dockChatListLoadSeq` 判失效，而这个计数器只在
                //   **本函数自身**下一次进入时才 ++，有两个致命缺口：
                //     1) 上面的 `if (!window.currentUser) { … return; }` 分支在计数器递增**之前**
                //        就 return 了 —— 于是登出/换账号时计数器纹丝不动，登出前在途的请求
                //        回来后 seq 仍然相等，直接把**上一个账号的会话列表**画到新会话的 DOM 里。
                //     2) 登录用户从 A 切到 B 时计数器也不会变（切号不一定经过未登录态），
                //        A 的在途响应会被当作最新数据渲染出来。
                //   现在同时快照「请求发起时的登录账号」，回填前核对当前账号与登录态，
                //   只要对不上就整段丢弃（不 toast、不重试，由新账号自己的请求接管）。
                var listOwner = window.currentUser || '', listAuthEpoch = window._authStateEpoch || 0;
                if (_dockChatConversationOwner !== listOwner) {
                    _dockChatConversationStates = {};
                    _dockChatConversationOwner = listOwner;
                    window.__xtjMutedChatPeers = {};
                }
                if (el.getAttribute('data-list-owner') !== listOwner) {
                    el.replaceChildren();
                    el.setAttribute('data-list-owner', listOwner);
                    _dockChatListRenderSignature = '';
                }
                var listLoadSeq = ++_dockChatListLoadSeq;
                // 统一的失效判定：请求序号被顶掉，或账号/登录态已变，都视为这次结果作废。
                var listResultStale = function() {
                    if (listLoadSeq !== _dockChatListLoadSeq) return true;
                    if (!window.currentUser) return true;
                    if ((window.currentUser || '') !== listOwner || (window._authStateEpoch || 0) !== listAuthEpoch) return true;
                    return false;
                };
                if (!el.querySelector('.chat-list-item[data-chat-user]')) {
                    restoreDockChatContactNames(el, listOwner);
                }
                var hadRenderedList = !!el.querySelector('.chat-list-item[data-chat-user]');
                try {
                    if (!hadRenderedList) {
                        renderChatLoadingState(el, {
                            title: '加载中...',
                            subtitle: '正在取回最近消息',
                            variant: 'chat-list'
                        });
                        renderDockChatFixedEntry(el);
                    }
                    // 走共享单飞请求（与未读角标复用同一份结果），并显式传 limit=180 ——
                    //   与下面 mergeDockChatRowsById 的窗口一致，避免"拉了 1000 条只用 180 条"。
                    const dmResult = await window.fetchDmListShared(180, { background: !userRetry });
                    if (!dmResult || !dmResult.ok) throw new Error((dmResult && dmResult.error) || 'DM list fetch failed');
                    if (listResultStale()) return;
                    var syncStatus=el.querySelector('.chat-list-sync-status');if(syncStatus)syncStatus.remove();
                    var rawRows = dmResult.data || [];
                    var allMsgs = mergeDockChatRowsById(rawRows, false, 180);
                    var authoritative = Array.isArray(dmResult.conversations);
                    if (authoritative) {
                        _dockChatConversationStates = {};
                        dmResult.conversations.forEach(function(state) {
                            if (state && state.peer_name) _dockChatConversationStates[state.peer_name] = state;
                        });
                    }
                    var authoritativeConvs = authoritative ? dockChatConversationRows(dmResult.conversations) : null;
                    if ((!allMsgs || !allMsgs.length) && (!authoritativeConvs || !authoritativeConvs.length)) {
                        cacheDockChatContactNames(listOwner, []);
                        el.innerHTML = '<div class="chat-empty"><div style="color:var(--xtj-text-muted);font-size:13px;padding:20px 0;">暂无最近会话</div></div>';
                        setUnreadBadgeCount(0);
                        window.dockChatListCacheTime = Date.now();
                        _dockChatListEverLoaded = true;
                        renderDockChatFixedEntry(el);
                        syncDockChatLayoutState();
                        return;
                    }
                    // ★ 2026-09-25 优化（聊天秒开）：会话列表接口返回的其实是「该用户最近的
                    //   全部消息」，此前只取每个会话的最后一条做预览，其余全部丢弃 —— 于是用户
                    //   点开会话时必须等一次 /api/dm/messages 网络往返才能看到内容（"点开会话要
                    //   等一下才出现消息"）。
                    //   现改为：把每条消息按会话归组，预热进 _chatCache。点击会话时 loadDockChatMessages
                    //   会先命中缓存立即渲染（见其开头 _chatCache 分支），网络回包后再精确替换，
                    //   从而实现"点开秒见内容"。分组逻辑抽到 buildDockChatConversations 复用。
                    var grouped = buildDockChatConversations(allMsgs);
                    preheatDockChatCache(grouped.preheatMap);
                    const convs = authoritative ? authoritativeConvs : grouped.convs;
                    // ★ 2026-09-25 修复（审计 M-7/H-2）：角标口径统一走 aggregateDmUnread，
                    //   与 updateUnreadBadge 完全同源，避免两处算法/上限不同导致数字跳动。
                    // ★ 2026-09-27（C8）：补拉后基于**更宽的窗口**重算角标，使窗口外旧会话的
                    //   未读也能计入；但服务端无聚合接口，极端情况下（>500 条仍被占满）仍会低估，
                    //   属于已知局限（见 fetchDockChatListCatchUp 注释）。
                    setUnreadBadgeCount(authoritative && typeof window.__xtjAuthoritativeDmUnread === 'function'
                        ? window.__xtjAuthoritativeDmUnread(dmResult.conversations)
                        : aggregateDmUnread(allMsgs).total);
                    if (typeof window.__xtjNoteDmUnreadFresh === 'function') window.__xtjNoteDmUnreadFresh();
                    renderDockChatConversationList(el, convs);
                    cacheDockChatContactNames(listOwner, convs);
                    window.dockChatListCacheTime = Date.now();
                    _dockChatListEverLoaded = true;
                    renderDockChatFixedEntry(el);
                    syncDockChatLayoutState();
                    // 非阻塞加载头像: 先显示列表, 头像后台补上（包含固定入口 xxz）
                    var avatarUsers = convs.map(function(c) { return c.other_user; });
                    if (window.currentUser !== 'xxz') avatarUsers.push('xxz');
                    hydrateDockChatAvatars(avatarUsers, function(changed) {
                        if (changed) patchDockChatConversationAvatars(el);
                    });
                    // A full 180-row window might hide older contacts. Paint the first
                    // result now, then extend the list without blocking its first paint.
                    if (!authoritative && rawRows.length >= 180) {
                        fetchDockChatListCatchUp(listOwner, listResultStale).then(function(widerRows) {
                            if (listResultStale() || !widerRows || widerRows.length <= rawRows.length) return;
                            var widerMsgs = mergeDockChatRowsById(rawRows.concat(widerRows), false, 500);
                            if (widerMsgs.length <= allMsgs.length) return;
                            var widerGrouped = buildDockChatConversations(widerMsgs);
                            preheatDockChatCache(widerGrouped.preheatMap);
                            setUnreadBadgeCount(aggregateDmUnread(widerMsgs).total);
                            if (typeof window.__xtjNoteDmUnreadFresh === 'function') window.__xtjNoteDmUnreadFresh();
                            renderDockChatConversationList(el, widerGrouped.convs);
                            cacheDockChatContactNames(listOwner, widerGrouped.convs);
                            renderDockChatFixedEntry(el);
                            syncDockChatLayoutState();
                            hydrateDockChatAvatars(widerGrouped.convs.map(function(c) { return c.other_user; }), function(changed) {
                                if (changed && !listResultStale()) patchDockChatConversationAvatars(el);
                            });
                        }).catch(function(err) { console.warn('[chat-list] 后台补全失败:', err); });
                    }
                } catch(e) {
                    if (listResultStale()) return;
                    // ★ 修复：已有列表时保留旧列表并仅 toast 提示失败，不追加重试按钮；
                    // 此前无条件追加 retry 且 dockChatListCacheTime=0 会立刻触发下次重试，
                    // 可能反复请求。重试按钮只在无列表（首屏加载失败）时显示。
                    if (!hadRenderedList) {
                        el.innerHTML = '';
                        var previousRetry = el.querySelector('.chat-load-retry');
                        if (previousRetry) previousRetry.remove();
                        var retry = document.createElement('button');
                        retry.type = 'button';
                        retry.className = 'chat-load-retry';
            // ★ 修复：全库无 .chat-load-retry 样式规则，按钮此前以浏览器默认外观呈现
            retry.style.cssText = 'display:inline-block;margin:12px auto;padding:8px 18px;background:var(--primary,#4c9aff);color:#fff;border:none;border-radius:18px;cursor:pointer;font-size:13px;';
                        retry.textContent = '消息加载失败，点击重试';
                        retry.addEventListener('click', function() {
                            retry.remove();
                            window.dockChatListCacheTime = 0;
                            if (window.__xtjInvalidateDmListShared) window.__xtjInvalidateDmListShared();
                            loadDockChatList(true);
                        }, { once: true });
                        el.appendChild(retry);
                        window.dockChatListCacheTime = 0;
                    } else {
                        if (!el.querySelector('.chat-list-sync-status')) {
                            var status=document.createElement('div');status.className='chat-list-sync-status';status.setAttribute('role','status');
                            var message=document.createElement('span');message.textContent='连接暂时不稳定，稍后自动重试';
                            var retryButton=document.createElement('button');retryButton.type='button';retryButton.textContent='重试';
                            retryButton.onclick=function(){window.dockChatListCacheTime=0;if(window.__xtjInvalidateDmListShared)window.__xtjInvalidateDmListShared();loadDockChatList(true);};
                            status.append(message,retryButton);el.appendChild(status);
                        }
                        window.dockChatListCacheTime=Date.now();
                    }
                    renderDockChatFixedEntry(el);
                    syncDockChatLayoutState();
                    _dockChatListRetryTimer=setTimeout(function(){
                        _dockChatListRetryTimer=0;
                        if (!listResultStale() && currentDockTab==='chat' && !document.hidden) {
                            window.dockChatListCacheTime=0;loadDockChatList();
                        }
                    },5000);
                }
            }

            function hydrateDockChatAvatars(userNames, onReady) {
                var users = Array.from(new Set((Array.isArray(userNames) ? userNames : []).filter(function(name) {
                    return !!name;
                })));
                if (!users.length) {
                    if (typeof onReady === 'function') onReady(false);
                    return Promise.resolve(false);
                }
                // P7: 先从 localStorage 补全内存缓存
                try {
                    var storedAvatars = readAvatarCacheFromStorage();
                    users.forEach(function(username) {
                        if (storedAvatars[username] && !avatarCache[username]) {
                            avatarCache[username] = storedAvatars[username];
                        }
                    });
                } catch (e) {}
                // P7: 只为没有新鲜缓存（TTL 内）的用户发起批量请求
                var uncached = users.filter(function(username) {
                    return !hasFreshAvatarCache(username);
                });
                if (!uncached.length) {
                    if (typeof onReady === 'function') onReady(false);
                    return Promise.resolve(false);
                }
                return window.xtjProtectedFetch('/api/avatar/batch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ users: uncached })
                })
                    .then(function(resp) { return resp.json(); })
                    .then(function(result) {
                        var changed = false;
                        if (result && result.ok && result.avatars) {
                            var keys = Object.keys(result.avatars);
                            for (var ki = 0; ki < keys.length; ki++) {
                                var k = keys[ki];
                                var v = result.avatars[k];
                                if (v) {
                                    // P7: 有 URL → has_avatar
                                    if (getAvatarUrl(k) !== v) {
                                        changed = true;
                                    }
                                    setAvatarCacheEntry(k, 'has_avatar', v);
                                } else if (v === null) {
                                    // P7: null → 清除旧缓存并设为 confirmed_none（TTL 内不重查）
                                    var prevEntry = avatarCache[k];
                                    if (v === null && avatarCache[k]) {
                                        delete avatarCache[k];
                                    }
                                    if (!prevEntry || prevEntry.state !== 'confirmed_none') {
                                        changed = true;
                                    }
                                    setAvatarCacheEntry(k, 'confirmed_none', null);
                                }
                            }
                            // 写入本地缓存
                            try {
                                var cachedAvatars = readAvatarCacheFromStorage();
                                for (var ki2 = 0; ki2 < keys.length; ki2++) {
                                    var k2 = keys[ki2];
                                    if (result.avatars[k2]) {
                                        cachedAvatars[k2] = { state: 'has_avatar', url: result.avatars[k2], fetched_at: Date.now() };
                                    } else if (result.avatars[k2] === null) {
                                        delete cachedAvatars[k2];
                                        cachedAvatars[k2] = { state: 'confirmed_none', url: null, fetched_at: Date.now() };
                                    }
                                }
                                writeAvatarCacheToStorage(cachedAvatars);
                            } catch(e) {}
                        } else {
                            // P7: 批量接口失败时降级到旧缓存（与单用户接口一致）
                            uncached.forEach(function(username) {
                                setAvatarCacheEntry(username, 'fetch_failed', null);
                            });
                        }
                        if (typeof onReady === 'function') onReady(changed || uncached.length > 0);
                        return changed || uncached.length > 0;
                    })
                    .catch(function() {
                        // P7: 网络异常时降级到旧缓存（与单用户接口一致）
                        uncached.forEach(function(username) {
                            setAvatarCacheEntry(username, 'fetch_failed', null);
                        });
                        if (typeof onReady === 'function') onReady(false);
                        return false;
                    });
            }

            // 聊天消息缓存
            var _chatCache = {};
            var _chatCommittedRevision = 0;
            var _chatRenderSignature = {};
            var _dockChatLoadSeq = 0;
            var _dockChatMessageLoad = null;
            var _dockChatListLoadSeq = 0;
            var _dockChatListRefreshTimer = null;
            var _dockChatListRenderSignature = '';

            function getDockChatCacheKey(userName) {
                return (currentUser || '') + '_' + (userName || '');
            }

            function mergeDockChatRowsById(rows, ascending, limit) {
                var seen = {};
                var list = [];
                (Array.isArray(rows) ? rows : []).forEach(function(row, index) {
                    if (!row) return;
                    var rowId = row.id ? String(row.id) : ('__row__' + index + '_' + (row.created_at || ''));
                    if (seen[rowId]) return;
                    seen[rowId] = true;
                    list.push(row);
                });
                list.sort(function(a, b) {
                    var at = new Date(a && a.created_at ? a.created_at : 0).getTime();
                    var bt = new Date(b && b.created_at ? b.created_at : 0).getTime();
                    return ascending ? (at - bt) : (bt - at);
                });
                if (limit && list.length > limit) {
                    list = list.slice(0, limit);
                }
                return list;
            }

            function getDockChatAvatarMarkup(userName) {
                var avatarUrl = getAvatarUrl(userName);
                if (avatarUrl) {
                    var safeAvatarUrl = escapeHtml(sanitizeUrl(avatarUrl));
                    if (safeAvatarUrl) {
                        return '<img loading="lazy" decoding="async" src="' + safeAvatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display=\'none\';this.parentElement.textContent=\'' + safeJsStr(String(userName || '?').slice(0, 1).toUpperCase()) + '\'">';
                    }
                }
                // 无头像时显示首字母（xxz → X）
                return escapeHtml(String(userName || '?').slice(0, 1).toUpperCase());
            }

            function patchDockChatConversationAvatars(root) {
                var container = root || document.getElementById('dockChatList');
                if (!container) return;
                Array.prototype.forEach.call(container.querySelectorAll('.chat-list-item[data-chat-user] .cli-avatar'), function(node) {
                    var row = node.closest('.chat-list-item[data-chat-user]');
                    if (!row) return;
                    var userName = row.getAttribute('data-chat-user') || '';
                    var markup=getDockChatAvatarMarkup(userName); if (node.innerHTML !== markup) node.innerHTML=markup;
                });
            }

            function patchDockChatMessageAvatars(userName) {
                var container = document.getElementById('dockChatMessages');
                if (!container || !dockChatActiveUser || dockChatActiveUser !== userName) return;
                var mineAvatar = getDockChatAvatarMarkup(currentUser);
                var otherAvatar = getDockChatAvatarMarkup(userName);
                Array.prototype.forEach.call(container.querySelectorAll('.chat-msg-row .chat-msg-avatar'), function(node) {
                    var row = node.closest('.chat-msg-row');
                    if (!row) return;
                    var markup=row.classList.contains('sent') ? mineAvatar : otherAvatar; if (node.innerHTML !== markup) node.innerHTML=markup;
                });
            }

            function buildDockChatConversationSignature(conversation) {
                var otherUser = conversation && conversation.other_user ? conversation.other_user : '';
                return [
                    otherUser,
                    _dockChatFriendNotes[otherUser] || '',
                    conversation && conversation.last_message ? conversation.last_message : '',
                    conversation && conversation.last_time ? conversation.last_time : '',
                    conversation && conversation.unread ? conversation.unread : 0,
                    conversation && conversation.pinned ? 'pinned' : '',
                    conversation && conversation.muted ? 'muted' : '',
                    conversation && conversation.draft ? 'draft' : '',
                    getAvatarUrl(conversation && conversation.other_user ? conversation.other_user : '') || ''
                ].join('~');
            }

            function getDockChatConversationAvatarHtml(userName) {
                return getDockChatAvatarMarkup(userName);
            }

            function buildDockChatListItemMarkup(conversation, index) {
                var safeUser = safeJsStr(conversation.other_user);
                var friendNote = _dockChatFriendNotes[conversation.other_user] || '';
                var displayName = friendNote || conversation.other_user;
                var signature = buildDockChatConversationSignature(conversation);
                return [
                    '<div class="chat-list-item" data-chat-user="', escapeHtml(conversation.other_user), '" data-signature="', escapeHtml(signature),
                    '" data-last-time="', escapeHtml(conversation.last_time || ''), '" style="--xtj-enter-delay:', String(Math.min((index || 0) * 12, 48)),
                    'ms" onclick="openChat(\'', safeUser, '\')">',
                    '<div class="cli-avatar">', getDockChatConversationAvatarHtml(conversation.other_user), '</div>',
                    '<div class="cli-info"><div class="cli-name"><span class="cli-name-text" title="', escapeHtml(conversation.other_user), '">', escapeHtml(displayName), '</span>', conversation.pinned ? '<span class="cli-state" title="已置顶">置顶</span>' : '', conversation.muted ? '<span class="cli-state" title="免打扰">静音</span>' : '', '</div><div class="cli-preview">', escapeHtml(conversation.last_message || ''), '</div></div>',
                    '<div class="cli-right"><span class="cli-time">', formatMsgTime(conversation.last_time), '</span>', conversation.unread ? '<span class="cli-badge">' + (conversation.unread > 99 ? '99+' : conversation.unread) + '</span>' : '', '</div>',
                    '</div>'
                ].join('');
            }

            function renderDockChatConversationList(el, convs) {
                if (!el) return '';
                var nextListSignature = convs.map(buildDockChatConversationSignature).join('|');
                var existingRows = el.querySelectorAll('.chat-list-item[data-signature]');
                if (_dockChatListRenderSignature === nextListSignature && existingRows.length === convs.length && !el.querySelector('.chat-list-skeleton')) {
                    return nextListSignature;
                }
                var existingMap = {};
                Array.prototype.forEach.call(el.querySelectorAll('.chat-list-item[data-chat-user]'), function(node) {
                    existingMap[node.getAttribute('data-chat-user')] = node;
                });
                var fragment = document.createDocumentFragment();
                convs.forEach(function(conversation, index) {
                    var userName = conversation.other_user;
                    var signature = buildDockChatConversationSignature(conversation);
                    var row = existingMap[userName];
                    if (row && row.getAttribute('data-signature') === signature) {
                        row.style.setProperty('--xtj-enter-delay', String(Math.min(index * 12, 48)) + 'ms');
                        fragment.appendChild(row);
                        return;
                    }
                    var template = document.createElement('template');
                    template.innerHTML = buildDockChatListItemMarkup(conversation, index).trim();
                    row = template.content.firstElementChild;
                    fragment.appendChild(row);
                });
                el.replaceChildren(fragment);
                _dockChatListRenderSignature = nextListSignature;
                return nextListSignature;
            }

            // The chat list contains real direct-message contacts only. AI is
            // intentionally launched from the homepage AI tools button.
            function renderDockChatFixedEntry(el) {
                if (!el) return;
                // ★ 2026-09-25 修复（审计 M-10）：未登录时不渲染固定入口。
                //   旧实现不看登录态，未登录访客会在"登录后可查看消息"的列表里看到一个
                //   「xxz 管理员」联系人，点下去只弹"请先登录"。
                if (!window.currentUser) {
                    var staleAdminEntry = el.querySelector('.chat-list-item[data-chat-user="xxz"]');
                    if (staleAdminEntry) staleAdminEntry.remove();
                    return;
                }
                // The administrator contact remains a normal direct-message entry.
                if (window.currentUser === 'xxz') {
                    var selfEntry = el.querySelector('.chat-list-item[data-chat-user="xxz"]');
                    if (selfEntry) selfEntry.remove();
                    return;
                }
                var existingAdmin = el.querySelector('.chat-list-item[data-chat-user="xxz"]');
                if (_dockChatConversationStates.xxz && _dockChatConversationStates.xxz.deleted) {
                    if (existingAdmin) existingAdmin.remove();
                    return;
                }
                if (existingAdmin) {
                    // 更新头像（可能已有缓存）
                    var adminAvatar = existingAdmin.querySelector('.cli-avatar');
                    if (adminAvatar) adminAvatar.innerHTML = getDockChatAvatarMarkup('xxz');
                } else {
                    var adminHtml = [
                        '<div class="chat-list-item admin-chat-entry" data-chat-user="xxz" role="button" tabindex="0" style="--xtj-enter-delay:50ms">',
                        '<div class="cli-avatar">', getDockChatAvatarMarkup('xxz'), '</div>',
                        '<div class="cli-info"><div class="cli-name"><span class="cli-name-text">xxz</span><span class="admin-tag-mini">管理员</span></div><div class="cli-preview">想我就给我发消息</div></div>',
                        '<div class="cli-right"></div>',
                        '</div>'
                    ].join('');
                    var adminTemplate = document.createElement('template');
                    adminTemplate.innerHTML = adminHtml.trim();
                    var adminRow = adminTemplate.content.firstElementChild;
                    // 整行可点击，统一调用 openChat
                    adminRow.addEventListener('click', function(e) {
                        e.stopPropagation();
                        if (typeof window.openChat === 'function') {
                            window.openChat('xxz');
                        }
                    });
                    adminRow.addEventListener('keydown', function(e) {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); adminRow.click(); }
                    });
                    el.insertBefore(adminRow, el.firstChild);
                }
            }

            function applyDockChatConversationPreview(otherUser, message, unreadCount) {
                var el = document.getElementById('dockChatList');
                if (!el || !otherUser || !message) return;
                var convs = [{
                    other_user: otherUser,
                    last_message: getDockChatMessagePreview(message),
                    last_time: message.created_at || new Date().toISOString(),
                    unread: typeof unreadCount === 'number' ? unreadCount : 0,
                    pinned: !!(_dockChatConversationStates[otherUser] && _dockChatConversationStates[otherUser].pinned_at),
                    muted: !!(_dockChatConversationStates[otherUser] && _dockChatConversationStates[otherUser].muted_until)
                }];
                Array.prototype.forEach.call(el.querySelectorAll('.chat-list-item[data-chat-user]'), function(node) {
                    var userName = node.getAttribute('data-chat-user');
                    if (!userName || userName === otherUser) return;
                    var previewNode = node.querySelector('.cli-preview');
                    var badgeNode = node.querySelector('.cli-badge');
                    convs.push({
                        other_user: userName,
                        last_message: previewNode ? previewNode.textContent : '',
                        // ★ 2026-09-25 修复：只认 data-last-time（权威值）。旧实现会回退去读
                        //   **渲染后的时间文本**，一旦某行被写成 "NaN/NaN NaN:NaN"，这个坏值
                        //   又会被当成时间读回来，从此永久污染该行（而且它还是排序依据）。
                        last_time: node.getAttribute('data-last-time') || '',
                        unread: badgeNode ? parseInt(badgeNode.textContent, 10) || 0 : 0,
                        pinned: !!(_dockChatConversationStates[userName] && _dockChatConversationStates[userName].pinned_at),
                        muted: !!(_dockChatConversationStates[userName] && _dockChatConversationStates[userName].muted_until)
                    });
                });
                convs.sort(function(a,b) { return Number(b.pinned)-Number(a.pinned) || String(b.last_time).localeCompare(String(a.last_time)); });
                renderDockChatConversationList(el, convs);
            }

            function scheduleDockChatListRefresh(delay) {
                if (_dockChatListRefreshTimer) clearTimeout(_dockChatListRefreshTimer);
                _dockChatListRefreshTimer = setTimeout(function() {
                    _dockChatListRefreshTimer = null;
                    window.dockChatListCacheTime = 0;
                    loadDockChatList();
                    updateUnreadBadge();
                }, typeof delay === 'number' ? delay : 100);
            }

            function sortDockChatMessages(msgs) {
                return (Array.isArray(msgs) ? msgs.slice() : []).sort(function(a, b) {
                    return new Date(a && a.created_at ? a.created_at : 0).getTime() - new Date(b && b.created_at ? b.created_at : 0).getTime();
                });
            }

            // ★ 2026-09-25 修复（切换会话卡顿 + 已读未读/气泡闪白）：
            //   旧实现用 el.innerHTML = rows.join('') 全量重建，是三个用户可感知问题的共同根因：
            //     ① 整个消息树被销毁重建 → 已加载的图片/视频重新发起请求、先变成一张白纸再解码，
            //        视觉上就是「聊天气泡闪白」；
            //     ② 消息多时重建成本高 → 切换联系人卡顿；
            //     ③ 「已读/未读」「撤回按钮」这类随时间/状态变化的节点每次都被重新创建。
            //   现改为「按 id 复用 DOM 节点」的增量渲染：只在签名变化的那一行重建，
            //   其余行原样搬过去（节点不销毁 → 图片不重载 → 不闪白，也不卡顿）。
            function getDockChatRowKey(message, index) {
                if (!message) return 'row-' + index;
                if (message.__tempId) return 't:' + message.__tempId;
                if (message.id) return 'i:' + message.id;
                return 'x:' + index + ':' + String(message.created_at || '');
            }

            function buildDockChatStableBodySignature(message) {
                var p=getDMMessagePayload(message) || {};
                return buildDockChatBodyMarkup(message)+'|'+JSON.stringify([p.reply_to,p.transcript,p.edited_at,p.withdrawn,!!message.__failed,!!message.__optimistic]);
            }
            function buildDockChatRowSignature(message) {
                var payload = getDMMessagePayload(message) || {};
                return [
                    message && message.user_name ? message.user_name : '',
                    message && message.media_url ? message.media_url : '',
                    message && message.content ? message.content : '',
                    message && message.created_at ? message.created_at : '',
                    message && message.actor_key ? message.actor_key : '',
                    message && message.views ? message.views : 0,
                    message && message.__optimistic ? 1 : 0,
                    // ★ 失败态必须进签名，否则"发送中 → 失败"这一跳不会重绘
                    message && message.__failed ? 1 : 0,
                    // 已读状态 / 撤回状态 / 媒体地址 必须进签名：这些变化时该行才重建
                    getDMMessageReadAt(message),
                    payload.withdrawn ? 1 : 0,
                    payload.flash && flashLocallyViewed(currentUser,message.id) ? 1 : 0,
                    (payload.media && payload.media.url) ? payload.media.url : '',
                    String(message && message.__localPreviewUrl || '')
                ].join('~');
            }

            function buildDockChatRenderSignature(msgs) {
                // ★ 修复：签名纳入 read_at / withdrawn / 媒体地址 与「时间显示档位」。
                //   此前只比 id/content 等，导致已读变未读、撤回、以及跨档位（1分钟前→昨天）
                //   的时间文案都不会触发重渲染；反过来又因为全量重建而频繁闪烁。现两者都对齐。
                return (Array.isArray(msgs) ? msgs : []).map(function(m) {
                    return (m && (m.id || m.__tempId) ? (m.id || m.__tempId) : '') + '@' + buildDockChatRowSignature(m);
                }).join('|');
            }


            // ★ 2026-09-27 新增（审计 S3/S4）：判定一条缓存消息是否属于「本地未决状态」——
            //   即服务端快照暂时还看不到、但绝不该被合并逻辑抹掉的消息。
            //   覆盖三类：
            //   1) __optimistic  正在发送中的乐观气泡（尚未落库）
            //   2) __failed      发送失败、等待用户重试的气泡（服务端永远不会有它）
            //   3) __pendingFile 已选好文件但还没走完上传流程的占位消息
            //   注意：只用本地标记判定，不掺入时间戳比较，避免服务端时钟偏移导致误判。
            function isDockChatLocalPendingMessage(msg) {
                if (!msg || typeof msg !== 'object') return false;
                return !!(msg.__optimistic || msg.__failed || msg.__pendingFile);
            }

            function mergeDockChatMessages(userName, msgs, readRevision) {
                // ★ 修复：发送成功会把乐观消息替换成服务端真实消息（不再带 __optimistic）。
                //   此前该函数只保留带 __optimistic 的缓存消息，若此刻刚好有「更早快照」的
                //   /api/dm/messages 请求在途并写回缓存，刚提交的新消息会从会话里消失。
                //   现改为：以服务端快照为底，把缓存中仍缺失的「乐观消息」以及「比快照更近
                //   （窗口期新提交）的非乐观消息」按 id 合并回去，避免发送成功即丢失。
                var cacheKey = getDockChatCacheKey(userName);
                var cached = Array.isArray(_chatCache[cacheKey]) ? _chatCache[cacheKey] : [];
                var snapshot = (msgs || []).slice();
                // ★ 2026-09-27 修复（审计 S3：空快照吞掉本地新消息）：
                //   此前 `if (!snapshot.length) return sortDockChatMessages(snapshot);`
                //   直接返回空数组 —— 但"服务端返回空快照"和"服务端确实没有消息"是两回事：
                //   一个更早发出、此刻才回来的 /api/dm/messages（limit=0 结果 / 对方刚清空 /
                //   接口抖动返回 []）都会走到这里，于是把缓存里**刚发送成功但还没进快照窗口**
                //   的消息、以及正在发送中的乐观气泡全部当作"服务端已删除"抹掉，用户看到
                //   自己刚发出去的消息凭空消失。现在空快照也走合并：只保留本地仍处于
                //   「未决状态」的消息（乐观/失败/窗口期新提交），绝不复活真正的旧历史。
                if (!snapshot.length) {
                    var keptFromCache = cached.filter(function(msg) {
                        return isDockChatLocalPendingMessage(msg) || (typeof readRevision === 'number' && Number(msg.__committedRevision || 0) > readRevision);
                    });
                    return sortDockChatMessages(keptFromCache);
                }
                var snapshotNewestAt = 0;
                var lastMsg = snapshot[snapshot.length - 1];
                if (lastMsg && lastMsg.created_at) {
                    var lastTs = Date.parse(lastMsg.created_at);
                    if (!isNaN(lastTs)) snapshotNewestAt = lastTs;
                }
                var priorById = new Map(cached.filter(function(row){return row && row.id;}).map(function(row){return [row.id,row];}));
                var merged = snapshot.map(function(row){
                    var old=priorById.get(row.id), saved=old && getDMMessagePayload(old), fresh=getDMMessagePayload(row);
                    // A stale read acknowledgement/snapshot may predate the durable
                    // transcript. Transcription has no delete action; withdrawal wins.
                    if (fresh && !fresh.withdrawn && !fresh.transcript && saved && saved.transcript)
                        return Object.assign({},row,{content:JSON.stringify(Object.assign({},fresh,{transcript:saved.transcript}))});
                    return row;
                });
                cached.forEach(function(msg) {
                    if (!msg || !msg.id) return;
                    var exists = merged.some(function(existing) {
                        return existing && existing.id && msg.id && existing.id === msg.id;
                    });
                    if (exists) return; // 快照已是服务端权威
                    // ★ S4：本地未决消息（乐观 / 失败 / 待上传）无条件保留。
                    //   此前只特判了 __optimistic，__failed 的气泡会掉进下面的时间戳比较里：
                    //   失败气泡的 created_at 通常是"当时点发送"的时间，一旦它早于快照最新时间
                    //   （比如在弱网里挂了 30 秒、期间收到了对方新消息），条件 `ts >= snapshotNewestAt`
                    //   不成立 → 失败气泡被丢弃 → 用户既看不到"发送失败"也没法重试，
                    //   而重试所需的 __pendingFile 也随之丢失，只能重新选文件。
                    if (isDockChatLocalPendingMessage(msg) || (typeof readRevision === 'number' && Number(msg.__committedRevision || 0)>readRevision)) { merged.push(msg); return; }
                    var ts = msg.created_at ? Date.parse(msg.created_at) : NaN;
                    // 仅合并比快照新（发送成功后才落库的窗口期消息），不复活旧历史
                    if (!isNaN(ts) && ts >= snapshotNewestAt) merged.push(msg);
                });
                return sortDockChatMessages(merged);
            }

            function upsertDockChatCacheMessage(userName, message) {
                var cacheKey = getDockChatCacheKey(userName);
                var list = Array.isArray(_chatCache[cacheKey]) ? _chatCache[cacheKey].slice() : [];
                var index = list.findIndex(function(item) {
                    if (!item) return false;
                    if (message.__tempId && item.__tempId === message.__tempId) return true;
                    return !!(message.id && item.id && message.id === item.id);
                });
                if (index >= 0) list[index] = message;
                else list.push(message);
                _chatCache[cacheKey] = sortDockChatMessages(list);
                return _chatCache[cacheKey];
            }

            function releaseDockChatLocalPreview(message) {
                var previewUrl = String(message && message.__localPreviewUrl || '');
                if (previewUrl.indexOf('blob:') !== 0) return;
                // ★ 2026-09-27 修复（审计 M3：只 revoke 不清缓存 __localPreviewUrl）：
                //   旧实现只 `URL.revokeObjectURL` 就完事，缓存里那条消息的
                //   `__localPreviewUrl` 仍指着这个已被 revoke 的 blob —— 用户切回会话时
                //   渲染又把它当 src，浏览器必然先 error 再回退，图片闪一下（正是下方
                //   __xtjReleaseDmLocalPreview 注释里声称要消灭的现象）。
                //   现在收敛到**同一个实现**：复用 __xtjReleaseDmLocalPreview 的完整语义
                //   （清掉所有会话缓存里指向该 blob 的字段 + revoke）。它内部已做
                //   幂等与 blob: 协议校验，这里不再重复一套逻辑。
                if (typeof window.__xtjReleaseDmLocalPreview === 'function') {
                    window.__xtjReleaseDmLocalPreview(previewUrl);
                    return;
                }
                try { URL.revokeObjectURL(previewUrl); } catch (e) {}
            }

            // ★ 2026-09-26：气泡把本地 blob 成功换成远端地址后调用。
            //   除了释放 blob，还要把缓存里所有指向它的 __localPreviewUrl 清掉 ——
            //   否则下次重渲染又拿已被 revoke 的 blob 当 src（先 error 再回退，会闪一下）。
            window.__xtjReleaseDmLocalPreview = function(url) {
                var target = String(url || '');
                if (target.indexOf('blob:') !== 0) return;
                try {
                    Object.keys(_chatCache || {}).forEach(function(k) {
                        var list = _chatCache[k];
                        if (!Array.isArray(list)) return;
                        list.forEach(function(m) {
                            if (m && String(m.__localPreviewUrl || '') === target) m.__localPreviewUrl = '';
                        });
                    });
                } catch (e) {}
                try { URL.revokeObjectURL(target); } catch (e2) {}
            };

            function replaceDockChatCacheMessage(userName, tempId, message) {
                var cacheKey = getDockChatCacheKey(userName);
                var list = Array.isArray(_chatCache[cacheKey]) ? _chatCache[cacheKey].slice() : [];
                var index = list.findIndex(function(item) {
                    return !!(item && item.__tempId === tempId);
                });
                if (index < 0 && message && message.id) {
                    index = list.findIndex(function(item) {
                        return !!(item && item.id && item.id === message.id);
                    });
                }
                if (index >= 0) list[index] = message;
                else list.push(message);
                _chatCache[cacheKey] = sortDockChatMessages(list);
                return _chatCache[cacheKey];
            }

            function removeDockChatCacheMessage(userName, tempId) {
                var cacheKey = getDockChatCacheKey(userName);
                var list = Array.isArray(_chatCache[cacheKey]) ? _chatCache[cacheKey].slice() : [];
                _chatCache[cacheKey] = list.filter(function(item) {
                    return !(item && item.__tempId === tempId);
                });
                return _chatCache[cacheKey];
            }

            function isDockChatNearBottom(el, threshold) {
                if (!el) return true;
                return (el.scrollHeight - el.scrollTop - el.clientHeight) < (threshold || 96);
            }

            // ★ 2026-09-25：撤回入口改为长按菜单后，气泡里不再有会过期的按钮，
            //   这里原本的"到期强制重绘"定时器已无必要（菜单每次打开都实时计算窗口）。

            function setDockChatJumpLatestVisible(visible) {
                var button = document.getElementById('dockChatJumpLatest');
                if (!button) return;
                var count=Number(button.dataset.unseen || 0);
                if(!visible){button.dataset.unseen='0';count=0;}
                var label=button.querySelector('span');if(label)label.textContent=count ? count+' 条新消息' : '最新消息';
                button.hidden = !visible;
                button.classList.toggle('is-visible', !!visible);
            }

            // A single layout can change twice after rendering: once on DOM insertion and
            // once when an image decodes. Reapply the target after both frames so opening a
            // long history always lands on the newest message, including on mobile Safari.
            function scrollDockChatToLatest(options) {
                var el = document.getElementById('dockChatMessages');
                if (!el) return;
                var behavior = options && options.smooth ? 'smooth' : 'auto';
                var scroll = function() { el.scrollTo({ top: el.scrollHeight, behavior: behavior }); };
                scroll();
                if (!_chatSendFlights.size) requestAnimationFrame(function() {
                    scroll();
                });
                setDockChatJumpLatestVisible(false);
            }

            function bindDockChatMediaLoadScroll(el, shouldFollow) {
                if (!el || !shouldFollow) return;
                Array.prototype.forEach.call(el.querySelectorAll('.msg-img'), function(media) {
                    if (media.__xtjChatScrollBound) return;
                    media.__xtjChatScrollBound = true;
                    media.addEventListener('load', function() {
                        if (isDockChatNearBottom(el, 180)) scrollDockChatToLatest();
                    }, { once: true });
                });
            }

            function buildDockChatBodyMarkup(message) {
                var payload = getDMMessagePayload(message) || {};
                if (payload && payload.withdrawn) {
                    return '<span class="msg-text withdrawn">[此消息已被撤回]</span>';
                }
                if(payload.flash){var own=message.user_name===currentUser,expired=!own&&(payload.flash.state==='expired'||flashLocallyViewed(currentUser,message.id));return '<button type="button" class="chat-flash-card" '+(expired||message.__optimistic?'disabled':'onclick="openChatFlash(\''+escapeHtml(String(message.id))+'\')"')+' aria-label="'+(expired?'闪图已失效':own?'查看自己发送的闪图，不限次数':'查看一次性闪图，3 秒后失效')+'"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 2-10 12h7l-1 8 10-12h-7z"/></svg><span>'+(expired?'闪图已失效':'闪图 3 秒')+'</span></button>';}
                var media = resolveDockChatMedia(message);
                var messageText = getDMMessageText(message);
                if (media && media.kind === 'image') {
                    // ★ 2026-09-26（用户反馈"发完图先是小气泡、再变成没图的大气泡、最后
                    //   变成『查看图片』按钮"）：整条渲染链改成 iMessage 的做法——
                    //   ① **有本地原图就用本地原图**：刚发出的消息带着本地字节
                    //      （__localPreviewUrl / blob），直接拿它当 src，图片**立刻**就在，
                    //      不存在"等远端下载"的空白窗口；远端地址写进 data-remote-src，
                    //      由 hydrateDockChatRemoteMedia() 后台下载好再无缝换过去。
                    //   ② **预留真实比例**：payload 里的 w/h（发送端解码时量到的真实像素）
                    //      写成 width/height 属性，浏览器在图片解码前就按正确比例占位，
                    //      彻底消灭"先小后大"的两次布局跳动。
                    //   ③ **去掉 loading="lazy"**：聊天图片是用户刚主动发出的内容，
                    //      移动端 Safari 的懒加载 defer 会让它长时间停在空白态。
                    var localSrc = String(message.__localPreviewUrl || '');
                    var localUsable = /^blob:/i.test(localSrc) || /^data:image\//i.test(localSrc);
                    var remoteSrc = String(media.src || media.fullSrc || '');
                    // ★ 2026-09-25：直接用公共地址渲染，不再绕后端签名。
                    //   实测 uploads 桶的 /public/ 路由是放通的（真实对象 HTTP 200），
                    //   此前"渲染期先换签名地址"的多余往返已删除——它正是图片首帧
                    //   显示成坏图标/按钮、几百毫秒后才变图的根源。
                    // ★ 2026-09-26（审计 P1-7）：这段私信媒体此前只 escapeHtml，是全站
                    //   唯一没过协议白名单的用户内容渲染点（media.src 来自发信人可控的
                    //   私信 JSON）。img/video/audio 的 src 不能直接执行脚本，但一旦这些
                    //   地址被复用到 <a href>/window.open（历史上照片墙就出过这类事故），
                    //   即刻变成 XSS。统一走 sanitizeUrl，非法协议返回空串 → 不渲染节点。
                    var safeSrc = (typeof sanitizeUrl === 'function') ? sanitizeUrl(remoteSrc) : '';
                    if (!safeSrc) {
                        if (localUsable) safeSrc = (typeof sanitizeUrl === 'function') ? sanitizeUrl(localSrc) : '';
                    }
                    if (!safeSrc) return '<span class="msg-text">' + escapeHtml(messageText || '[媒体]') + '</span>';
                    var safeFull = escapeHtml(safeSrc);
                    // 本地预览优先当 src；远端地址留给后台换取
                    var safeLocal = localUsable ? ((typeof sanitizeUrl === 'function') ? sanitizeUrl(localSrc) : '') : '';
                    var displaySrc = safeLocal || safeSrc;
                    var remoteAttr = (safeLocal && safeSrc && safeSrc !== safeLocal)
                        ? ' data-remote-src="' + escapeHtml(safeSrc) + '" data-local-src="' + escapeHtml(safeLocal) + '"'
                        : '';
                    // 宽高占位：只取合理范围的正整数，避免污染布局。
                    // 写 width/height 属性 + 内联 aspect-ratio（作者样式，优先级高于 UA 规则），
                    // 浏览器据此在图片解码前就撑出正确比例的盒子 → 不再"先小后大"。
                    // 老消息没有 w/h（服务端此前不存），兜一个 4:3，也比 0 高度好得多。
                    var mw = Math.round(Number(media.w || 0));
                    var mh = Math.round(Number(media.h || 0));
                    var hasRealDims = (mw > 0 && mh > 0 && mw <= 20000 && mh <= 20000);
                    if (!hasRealDims) { mw = 4; mh = 3; }
                    var dimAttr = ' style="aspect-ratio:' + mw + ' / ' + mh + '"';
                    if (hasRealDims) dimAttr += ' width="' + mw + '" height="' + mh + '"';
                    // ★ 2026-09-27 修复（审计 M8：4:3 兜底不写 width/height，盒子 0×0）：
                    //   老消息没有 w/h 时兜 4:3，但此前**不写** width/height，而 CSS 是
                    //   `width:auto`（css/style.css .chat-msg .msg-img）→ `aspect-ratio` 需要
                    //   至少一维确定才能算出另一维，两维都 auto 时盒子塌成 0×0，老消息仍会
                    //   布局跳动。这里给兜底 `<img>` 补一个**确定的宽度基准** width:100%
                    //   （走 .has-media 气泡的满宽 + max-height:260px 约束），aspect-ratio
                    //   据此算出高度，盒子立刻有尺寸，也不破坏有真实 w/h 的现有正确渲染。
                    else dimAttr += ' style="aspect-ratio:' + mw + ' / ' + mh + ';width:100%"';
                    // ★ 2026-09-25 修复（聊天图片预览器降级到旧 #imgViewer）：
                    //   此前 onclick 只传了 src，没有把 <img> 自身作为 triggerEl 传入。
                    //   openImageViewer → openPostImagePreview 依赖 triggerEl 读取
                    //   data-post-id 等元数据来构造新预览器的数据项；缺了它就只能
                    //   fallbackOpen() 打开旧 #imgViewer —— 旧查看器的关闭按钮被
                    //   全局按钮重置规则压成 position:relative（实测跑到屏幕外 x=-24），
                    //   缩放也在两套状态机之间打架，正是用户反馈的那一堆问题。
                    //   这里补上 this，让聊天图片走和帖子图完全一致的新预览器。
                    // ★ 2026-09-25 修复（"照片详情点开是空的"）：预览器 buildPostPreviewItemFromTrigger
                    //   是从触发元素的 data-* 属性读元数据的（帖子图有 data-post-user 等，
                    //   帖子详情图也有），而聊天图片此前只写了 data-full-src —— 于是点开
                    //   ⓘ 永远是「未知用户 / – / – / –」。这里补上发送者与时间。
                    //   故意**不加** data-post-id：预览器据此把来源判定为 chat，
                    //   从而不显示"删除帖子/分享"等不适用按钮。
                    // 点开大图始终用**远端原图地址**（本地 blob 只在本次会话有效，
                    // 用它做 data-full-src 会让对方/刷新后失效）。
                    var fullForViewer = (safeSrc && !/^blob:/i.test(safeSrc)) ? safeSrc : safeFull;
                    var imageBody = '<img class="msg-img" src="' + escapeHtml(displaySrc) + '" data-src="' + escapeHtml(safeSrc) + '" data-full-src="' + escapeHtml(fullForViewer) + '" data-post-user="' + escapeHtml(String(message.user_name || '')) + '" data-post-created-at="' + escapeHtml(String(message.created_at || '')) + '" alt="聊天图片" onclick="openChatGallery(this.getAttribute(\'data-full-src\') || this.src, this)" onerror="window.handleDockChatImageError(this)" decoding="async"' + dimAttr + remoteAttr + ' />';
                    // ★ 2026-09-26（用户："已读未读要显示在气泡下面，而不是图片里面"）：
                    //   带文字的图片消息以前是「图片 → 文字」竖排，状态行被推到文字下面，
                    //   视觉上「未读 04:37」就贴在图片内部（截图里的观感）。改成
                    //   「文字在上、图片在下」，状态行自然落在**图片正下方**，与 iMessage 一致。
                    //   纯图片消息保持「图片 → 状态行」不变。
                    if (messageText) imageBody = '<div class="msg-text">' + escapeHtml(messageText) + '</div>' + imageBody;
                    return imageBody;
                }
                if (media && media.kind === 'video') {
                    // ★ 2026-09-26（审计 P1-7）：同图片，走 sanitizeUrl 协议白名单
                    var safeVideoSrc = sanitizeUrl(String(message.__localPreviewUrl || media.src || ''));
                    if (!safeVideoSrc) return '<span class="msg-text">' + escapeHtml(messageText || '[视频]') + '</span>';
                    var videoBody = '<video class="msg-img" src="' + escapeHtml(safeVideoSrc) + '" controls preload="metadata" onclick="event.stopPropagation()" style="cursor:default;"></video>';
                    if (messageText) videoBody += '<div class="msg-text">' + escapeHtml(messageText) + '</div>';
                    return videoBody;
                }
                // P6: render audio messages with <audio> player
                if (media && media.kind === 'audio') {
                    // ★ 2026-09-26（审计 P1-7）：同图片，走 sanitizeUrl 协议白名单
                    var safeAudioSrc = sanitizeUrl(String(message.__localPreviewUrl || media.src || ''));
                    // Keep the voice control and saved text even when its signed
                    // URL is temporarily unavailable. Playback refreshes that row.
                    var audioBody = '<div class="chat-voice-player"><audio class="msg-audio"' + (safeAudioSrc ? ' src="' + escapeHtml(safeAudioSrc) + '"' : '') + ' preload="metadata"></audio><button type="button" class="chat-voice-play" aria-label="播放语音" aria-pressed="false"><svg class="voice-play-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="m8 5 11 7-11 7z"/></svg><span class="chat-voice-wave" aria-hidden="true">' + [8,14,23,12,18,28,16,10,22,14,26,18,12,20,9,16].map(function(height) { return '<i style="--voice-bar:'+height+'px"></i>'; }).join('') + '</span><span class="chat-voice-duration">' + (Number(payload.media && payload.media.duration)>0 ? Math.ceil(payload.media.duration)+'″' : '语音') + '</span></button></div>';
                    if (messageText) audioBody += '<div class="msg-text">' + escapeHtml(messageText) + '</div>';
                    return audioBody;
                }
                if (media && media.kind === 'file') {
                    var safeFile = sanitizeUrl(media.src);
                    if (!safeFile || !/^https?:\/\//i.test(safeFile)) return '<span class="msg-text">[文件不可用]</span>';
                    return '<a class="chat-file-link" href="' + escapeHtml(safeFile) + '" target="_blank" rel="noopener noreferrer" download>' + escapeHtml(String(media.name || '附件')) + '</a>' + (messageText ? '<div class="msg-text">' + escapeHtml(messageText) + '</div>' : '');
                }
                return '<span class="msg-text">' + escapeHtml(messageText || '') + '</span>';
            }

            function queueDockVoiceTranscription(peer, messages, file, fileId) {
                var controller = window.XTJVoiceTranscription, owner = currentUser;
                if (!controller || !owner) return;
                (messages || []).forEach(function(message) {
                    var payload = getDMMessagePayload(message) || {};
                    if (!message.id || message.__optimistic || message.__failed || payload.withdrawn || payload.transcript || !payload.media || payload.media.kind !== 'audio' || isDmMessageLocallyDeleted(message)) return;
                    controller.enqueue({ owner: owner, peer: peer, id: message.id, sent: message.user_name === owner,
                        file: fileId === message.id ? file : null,
                        onState: function(job) {
                            if (currentUser !== owner || dockChatActiveUser !== peer) return;
                            var host = document.getElementById('dockChatMessages');
                            if (!host) return;
                            Array.from(host.querySelectorAll('.chat-msg-row')).forEach(function(row) {
                                if (row.dataset.messageId !== String(message.id)) return;
                                var status = row.querySelector('.chat-transcription-status');
                                if (!status) return;
                                status.querySelector('span').textContent = job.label;
                                var retry = status.querySelector('button');
                                retry.hidden = job.state !== 'error';
                                retry.onclick = function(event) { event.stopPropagation(); controller.retry(peer, message.id); };
                            });
                        },
                        onResult: function(text, saved) {
                            if (currentUser !== owner) return;
                            var cache = _chatCache[getDockChatCacheKey(peer)] || [];
                            var target = cache.find(function(row) { return row.id === message.id; });
                            if (!target) return;
                            var latest = getDMMessagePayload(target) || {};
                            if (latest.withdrawn || isDmMessageLocallyDeleted(target)) return;
                            var stored = saved && getDMMessagePayload(saved);
                            latest.transcript = stored && stored.transcript || text;
                            target.content = JSON.stringify(latest);
                            if (dockChatActiveUser === peer) renderDockMessages(peer, cache, false);
                        }
                    });
                });
            }

                        function buildDockChatRowMarkup(message, avatars, disableAnim) {
                var sent = message.user_name === currentUser;
                var avatarHtml = sent ? avatars.mine : avatars.other;
                // ★ is-read 类给「已读」配上配色/微动画（ui-enhance.css 里有规则）。
                //   原先由 ux-features.js 那套重复的长按菜单在**绑定时刻**扫描一遍，
                //   但那时还没有任何消息，等于从未生效；现在直接在渲染时打上。
                // ★ 2026-09-26（用户："气泡的已读未读我需要和图片这样显示在气泡下面"）：
                //   媒体消息的 meta 行只对**发送方**放已读状态（对方的消息本来就没有
                //   "已读未读"），用户截图里那条正是自己发的图 —— 现在这一行统一按
                //   「已读/未读 + 时间」排布，位置固定在**图片下方**（见下方 has-media
                //   的 .msg-meta 规则），与文字消息观感一致。
                // ★ 2026-09-27 修复（审计 C15：失败消息自相矛盾显示"发送失败 + 未读"）：
                //   __failed 的消息已被判定为发送失败，既没成功提交到服务端，
                //   就不存在"已读/未读"这回事。旧实现照常计算 readStatus，于是
                //   文字气泡里同时出现 failMark（发送失败·长按重发）和 readStatus（未读），
                //   观感矛盾且误导。这里对失败态直接清空 readStatus，只保留失败态 + 时间。
                var readStatus = (sent && !message.__failed)
                    ? (isMsgReadByMe(message)
                        ? '<span class="msg-read-status is-read">已读</span>'
                        : '<span class="msg-read-status">未读</span>')
                    : '';

                var payload = getDMMessagePayload(message) || {};
                var isWithdrawn = payload && payload.withdrawn;
                // 已撤回的消息不再解析媒体：actor_key 仍然保留，若照常解析会给"已撤回"
                //   这段文字套上媒体气泡的紧内边距，看着很怪。
                var rowMedia = isWithdrawn ? null : resolveDockChatMedia(message);

                // ★ 2026-09-25 改造：撤回不再常驻气泡（改由长按菜单触发，与微信/QQ 一致），
                //   气泡右下角只保留时间；失败态给出明确标记与重发入口，发送中给出上传提示。
                var bubbleClass = 'chat-msg ' + (sent ? 'sent' : 'received');
                // 纯媒体气泡用更紧的内边距，让图片贴着气泡边（否则彩色边框会显得很宽）
                if (rowMedia) bubbleClass += ' has-media';
                if (rowMedia && rowMedia.kind==='image') bubbleClass += ' has-image';
                // ★ 2026-09-26：不再给气泡加 media-only（把时间/已读未读绝对定位**叠在图片上**）。
                //   用户明确反馈"已读未读、时间都显示在图片里面……有点不对"——这正是叠图方案
                //   的观感。现在媒体消息的状态行（含时间）统一放气泡**下方**（见下方 msg-meta），
                //   图片上不再压任何文字，对齐 iMessage。
                if (message.__optimistic && sent) bubbleClass += ' sent-anim';
                else if (disableAnim) bubbleClass += ' no-anim';
                if (message.__optimistic) bubbleClass += ' pending';
                if (message.__failed) bubbleClass += ' failed';
                if (isWithdrawn) bubbleClass += ' is-withdrawn';

                // ★ 2026-09-26：媒体消息的上传状态升级为**实时进度环 + 百分比**。
                //   旧的 .msg-send-status 是一句不会动的「图片上传中…」——fetch 上传拿不到
                //   进度，只能干等；现在上传走 XHR（见 uploadDmMediaWithProgress），
                //   真实字节进度由 setDockChatUploadProgress 实时 patch 到环与百分比上。
                //   失败标记也从气泡内挪到 meta 行，与状态信息同一层。
                var failMark = message.__failed
                    ? '<span class="msg-fail-mark" title="' + escapeHtml(String(message.__failReason || '发送失败')) + '">发送失败 · 长按重发</span>'
                    : '';
                // ★ 2026-09-26（审计 P2-27）：属性值必须转义。__tempId 目前由本地生成
                //   （不可注入），但同函数其它属性全部走 escapeHtml，这里补齐以防未来
                //   改为服务端字段后变成属性注入。
                var tempAttr = message.__tempId ? ' data-temp-id="' + escapeHtml(String(message.__tempId)) + '"' : '';
                var timeHtml = '<span class="msg-time">' + formatMsgTime(message.created_at) + '</span>';
                var bubbleBody = buildDockChatBodyMarkup(message);
                if (!isWithdrawn && payload.transcript) bubbleBody += '<div class="chat-transcript"><small>语音转写</small><span>' + escapeHtml(String(payload.transcript)) + '</span></div>';
                else if (!isWithdrawn && rowMedia && rowMedia.kind === 'audio' && !message.__optimistic && !message.__failed) bubbleBody += '<div class="chat-transcription-status" role="status"><span>等待语音转写…</span><button type="button" hidden>重新转写</button></div>';
                if (!isWithdrawn && payload.reply_to) bubbleBody = '<button type="button" class="chat-reply-quote" data-reply-id="' + escapeHtml(String(payload.reply_to.id || '')) + '" aria-label="定位引用的消息"><strong>' + escapeHtml(String(payload.reply_to.sender_name || '消息')) + '</strong><span>' + escapeHtml(String(payload.reply_to.text || '[附件]')) + '</span></button>' + bubbleBody;
                if (payload.edited_at) timeHtml = '<span class="msg-edited">已编辑</span>' + timeHtml;
                var bubble, inner;
                if (rowMedia) {
                    // 媒体消息：气泡内只留媒体本体（iMessage 观感），状态/时间在气泡下方。
                    bubble = '<div class="' + bubbleClass + '"' + tempAttr + '>' + bubbleBody + '</div>';
                    var metaParts = [];
                    if (message.__failed) metaParts.push(failMark);
                    else if (message.__optimistic && sent) metaParts.push(buildDmUploadProgressHtml(rowMedia.kind, message.__dmUploadRatio));
                    else metaParts.push(readStatus);
                    metaParts.push(timeHtml);
                    inner = '<div class="chat-msg-col">' + bubble + '<div class="msg-meta">' + metaParts.join('') + '</div></div>';
                } else {
                    // 文字消息：meta 收在气泡内右下角（气泡小、贴得下，保持既有观感）。
                    // 失败标记（发送失败 · 长按重发）保留在气泡内 —— 文字气泡有内边距放得下，
                    // 且失败是异常态，贴着正文更显眼。
                    bubble = '<div class="' + bubbleClass + '"' + tempAttr + '>' + bubbleBody + (message.__failed ? failMark : '') + '<span class="msg-meta">' + readStatus + timeHtml + '</span></div>';
                    inner = bubble;
                }
                if (sent) return '<div data-message-id="' + escapeHtml(String(message.id || '')) + '" class="chat-msg-row sent' + (rowMedia ? ' has-media' : '') + '">' + inner + '<div class="chat-msg-avatar">' + avatarHtml + '</div></div>';
                return '<div data-message-id="' + escapeHtml(String(message.id || '')) + '" class="chat-msg-row received' + (rowMedia ? ' has-media' : '') + '"><div class="chat-msg-avatar">' + avatarHtml + '</div>' + inner + '</div>';
            }

            // ===== 2026-09-26：媒体上传的实时进度 UI（iMessage 风格） =====
            // 进度环 SVG：r=8 → 周长 2πr ≈ 50.27，用 stroke-dashoffset 表示剩余弧长。
            var DM_RING_CIRCUMFERENCE = 2 * Math.PI * 8;
            var DM_UPLOAD_LABEL = { image: '图片上传中', video: '视频上传中', audio: '音频上传中' };
            function buildDmUploadProgressHtml(kind, ratio) {
                var label = DM_UPLOAD_LABEL[String(kind || '').toLowerCase()] || '文件上传中';
                var r = (typeof ratio === 'number' && isFinite(ratio)) ? Math.max(0, Math.min(1, ratio)) : 0;
                var percent = Math.round(r * 100);
                return '<span class="msg-send-state" role="status" data-dm-progress="' + r.toFixed(4) + '">'
                    + '<svg class="dm-progress-ring" viewBox="0 0 20 20" aria-hidden="true" focusable="false">'
                    + '<circle class="dm-ring-track" cx="10" cy="10" r="8"></circle>'
                    + '<circle class="dm-ring-bar" cx="10" cy="10" r="8" stroke-dashoffset="' + (DM_RING_CIRCUMFERENCE * (1 - r)).toFixed(2) + '"></circle>'
                    + '</svg>'
                    + '<span class="dm-progress-text">' + label + ' <em class="dm-progress-pct">' + percent + '%</em></span>'
                    + '</span>';
            }
            // 实时刷新某条乐观媒体消息的进度：**只 patch 环与百分比两个节点**，
            // 不重渲染整行——整行重建会让已解码的本地图片重新请求，气泡闪白。
            function setDockChatUploadProgress(tempId, ratio, phaseLabel) {
                var host = document.getElementById('dockChatMessages');
                if (!host || !tempId) return;
                var bubble = null;
                try { bubble = host.querySelector('.chat-msg[data-temp-id="' + tempId + '"]'); } catch (e) {}
                if (!bubble) return;
                var state = bubble.parentNode ? bubble.parentNode.querySelector('.msg-send-state') : null;
                if (!state) return;
                var r = (typeof ratio === 'number' && isFinite(ratio)) ? Math.max(0, Math.min(1, ratio)) : 0;
                var bar = state.querySelector('.dm-ring-bar');
                if (bar) bar.setAttribute('stroke-dashoffset', (DM_RING_CIRCUMFERENCE * (1 - r)).toFixed(2));
                var pct = state.querySelector('.dm-progress-pct');
                if (pct) {
                    // 字节已发完、服务端还在写 Storage → 不显示卡住的"100%"，改提示处理中
                    pct.textContent = (phaseLabel === 'processing') ? '处理中…' : (Math.round(r * 100) + '%');
                }
                state.setAttribute('data-dm-progress', r.toFixed(4));
            }

            // 带真实上传进度的 DM 媒体上传：fetch 拿不到 upload.onprogress，
            // XMLHttpRequest 是唯一能上报字节进度的方式。鉴权完全复用
            // xtjProtectedFetch 的链路：ensureProtectedOperationAuth 取 token →
            // 401 时 refreshUserToken(true) 换新 token 重试一次；120s 超时对齐旧实现。
            function uploadDmMediaWithProgress(path, kind, file, onProgress, identity) {
                identity = identity || { owner: currentUser, epoch: _authStateEpoch };
                function currentUpload(){return currentUser===identity.owner && _authStateEpoch===identity.epoch && !(identity.signal && identity.signal.aborted);}
                function changed(){var error=new Error('账号已切换，上传已停止');error.code='identity_changed';return error;}
                return new Promise(function(resolve, reject) {
                    if (typeof XMLHttpRequest !== 'function') {
                        reject(new Error('当前浏览器不支持带进度的上传，请升级后重试'));
                        return;
                    }
                    // ★ 2026-09-27 修复（审计 S2：上传 401 递归重试无上限）：
                    //   此前 401 分支里 `settled = false; sendOnce(renewed);` 没有任何计数，
                    //   若续期接口持续返回"看似成功"但 token 仍被服务端拒绝（时钟漂移 /
                    //   多端登录互相踢 / 服务端续期契约变更），就会 401 → 续期 → 401 →
                    //   续期 …… 无限递归，每次都是一次真实网络往返，且上传进度环永远
                    //   停在原地转圈、Promise 永不 settle（用户看到"发不出去也退不回来"）。
                    //   现在对齐 xtjProtectedFetch 的做法：**最多重试 1 次**，且续期拿到的
                    //   token 必须与上一次不同（否则说明续期根本没生效，重试毫无意义）。
                    var MAX_UPLOAD_AUTH_RETRIES = 1;
                    var sendOnce = function(token, authAttempt) {
                        if(!currentUpload()){reject(changed());return;}
                        var attempt = Number(authAttempt) || 0;
                        var xhr = new XMLHttpRequest();
                        var settled = false;
                        var finish = function(fn, arg) {
                            if (settled) return;
                            settled = true;
                            if(identity.signal)identity.signal.removeEventListener('abort', abortUpload);
                            fn(arg);
                        };
                        function abortUpload(){xhr.abort();finish(reject,changed());}
                        if(identity.signal)identity.signal.addEventListener('abort',abortUpload,{once:true});
                        xhr.timeout = 120000; // 50MB 素材在弱网下也够用
                        xhr.open('POST', (window.API_BASE || '') + '/api/dm/upload'
                            + '?path=' + encodeURIComponent(path)
                            + '&kind=' + encodeURIComponent(kind)
                            + '&mime_type=' + encodeURIComponent(file.type || 'application/octet-stream'), true);
                        xhr.withCredentials = true;
                        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
                        if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
                        if (xhr.upload && typeof onProgress === 'function') {
                            xhr.upload.onprogress = function(e) {
                                if (!currentUpload() || settled || !e || !e.lengthComputable || !e.total) return;
                                try { onProgress(Math.max(0, Math.min(1, e.loaded / e.total))); } catch (err) {}
                            };
                            // 字节发完、服务端还在写 Storage → 通知 UI 进入"处理中"阶段
                            xhr.upload.onload = function() {
                                if (!currentUpload() || settled) return;
                                try { onProgress(1, 'processing'); } catch (err) {}
                            };
                        }
                        xhr.onload = function() {
                            if(!currentUpload()){finish(reject,changed());return;}
                            var data = null;
                            try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) { data = null; }
                            if (xhr.status === 401) {
                                // ★ S2：超出重试上限 / 无续期能力 → 直接 reject，绝不静默挂起
                                if (attempt >= MAX_UPLOAD_AUTH_RETRIES
                                    || typeof window.refreshUserToken !== 'function') {
                                    finish(reject, new Error('登录已失效'));
                                    return;
                                }
                                finish(function() {
                                    if(!currentUpload()){reject(changed());return;}
                                    window.refreshUserToken(true).then(function(renewed) {
                                        if(!currentUpload()){reject(changed());return;}
                                        // 续期失败，或拿到的 token 与刚才那份完全相同（说明续期
                                        // 没有真正生效），都不该再打一次必然失败的上传。
                                        if (!renewed || String(renewed) === String(token || '')) {
                                            reject(new Error('登录已失效'));
                                            return;
                                        }
                                        settled = false;
                                        sendOnce(renewed, attempt + 1);
                                    }).catch(function() { reject(new Error('登录已失效')); });
                                });
                                return;
                            }
                            // 只有 (2xx && data.ok) 才算成功；其余一律 reject —— 失败即阻断发送
                            if (xhr.status >= 200 && xhr.status < 300 && data && data.ok) {
                                finish(resolve, data);
                                return;
                            }
                            finish(reject, new Error('媒体上传失败: ' + ((data && data.error) || ('HTTP ' + xhr.status))));
                        };
                        xhr.onerror = function() { finish(reject, new Error('媒体上传失败: 网络错误')); };
                        xhr.ontimeout = function() { finish(reject, new Error('媒体上传超时，请检查网络后重试')); };
                        xhr.onabort = function() { finish(reject, new Error('媒体上传已取消')); };
                        try { xhr.send(file); } catch (e) { finish(reject, new Error('媒体上传失败: ' + (e && e.message ? e.message : '未知错误'))); }
                    };
                    if (typeof window.ensureProtectedOperationAuth === 'function') {
                        window.ensureProtectedOperationAuth().then(function(auth) {
                            if(!currentUpload()){reject(changed());return;}
                            if (!auth || !auth.ok) {
                                reject(new Error((auth && auth.reason === 'expired') ? '登录已失效' : '认证服务暂时不可用'));
                                return;
                            }
                            sendOnce(auth.token);
                        }).catch(function() { reject(new Error('认证服务暂时不可用')); });
                    } else {
                        sendOnce('');
                    }
                });
            }

            // ★ 2026-09-25：muteLoadingSkeleton=true 表示「轮询/后台刷新」，不允许动 loading 骨架
            //   与空状态，避免后台回包把用户正在看的界面顶掉重画。
            async function loadDockChatMessages(userName, forceScroll, muteLoadingSkeleton, userRetry) {
                if (_chatHistoryFocus === userName && !forceScroll && !userRetry) return;
                if (userRetry) { _chatHistoryFocus = ''; _chatRenderSignature[userName] = undefined; }
                var el0 = document.getElementById('dockChatMessages');
                if (!window.currentUser) {
                    if (el0) el0.innerHTML = '<div class="chat-empty"><div class="ce-icon">🔒</div><div>登录后可查看消息</div></div>';
                    return;
                }
                if (!el0 || dockChatActiveUser !== userName) return;
                var loadOwner = window.currentUser || '', loadEpoch = window._authStateEpoch || 0;
                var previousLoad = _dockChatMessageLoad;
                if (!userRetry && previousLoad && previousLoad.seq === _dockChatLoadSeq &&
                    previousLoad.peer === userName && previousLoad.owner === loadOwner && previousLoad.epoch === loadEpoch) return;
                if (previousLoad && previousLoad.controller) previousLoad.controller.abort();
                var loadSeq = ++_dockChatLoadSeq;
                var requestController = typeof AbortController === 'function' ? new AbortController() : null;
                var flight = { seq: loadSeq, peer: userName, owner: loadOwner, epoch: loadEpoch, controller: requestController };
                _dockChatMessageLoad = flight;
                function currentLoad() {
                    return loadSeq === _dockChatLoadSeq && dockChatActiveUser === userName &&
                        window.currentUser === loadOwner && (window._authStateEpoch || 0) === loadEpoch;
                }
                var readRevision = _chatCommittedRevision;
                // 当前用户优先使用 localStorage 缓存的头像
                if (currentUser) {
                    try {
                        var cachedAvatars = readAvatarCacheFromStorage();
                        if (cachedAvatars[currentUser]) {
                            avatarCache[currentUser] = cachedAvatars[currentUser];
                        }
                    } catch(e) {}
                }
                // 获取聊天缓存键
                var cacheKey = getDockChatCacheKey(userName);
                var hadCachedMessages = Array.isArray(_chatCache[cacheKey]);
                if (hadCachedMessages) {
                    // ★ 2026-09-25 修复（切换会话骨架闪烁）：缓存命中时必须在任何骨架/空状态
                    //   绘制之前就把内容渲染出来，否则 openChat 里那次 loading 骨架会先画上去
                    //   再被覆盖，用户就看到"闪一下"。
                    renderDockMessages(userName, _chatCache[cacheKey], !!forceScroll);
                }
                if (!hadCachedMessages && !muteLoadingSkeleton) {
                    // 无缓存且不是轮询/后台刷新 → 才允许显示骨架（首次打开会话）
                    renderDockMessages(userName, [], false);
                }
                hydrateDockChatAvatars([currentUser, userName], function(changed) {
                    if (!currentLoad()) return;
                    // ★ 修复：头像变化只就地替换头像节点，不再整段重渲染消息列表
                    //   （整段重建会让已加载的图片重新请求，造成"气泡闪白"）。
                    patchDockChatMessageAvatars(userName);
                });
                const el = el0;
                try {
                    var requestTimeout = setTimeout(function() {
                        if (requestController) requestController.abort();
                    }, 12000);
                    var messagesResp, messagesResult;
                    try {
                        messagesResp = await window.xtjProtectedFetch('/api/dm/messages?target=' + encodeURIComponent(userName) + '&limit=180', {
                            signal: requestController ? requestController.signal : undefined,
                            authOwner: loadOwner, authEpoch: loadEpoch, timeoutMs: 12000, background: !!muteLoadingSkeleton
                        });
                        messagesResult = await messagesResp.json();
                    } finally {
                        clearTimeout(requestTimeout);
                    }
                    if (!messagesResp.ok || !messagesResult.ok) throw new Error(messagesResult.error || 'DM messages failed');
                    if (!currentLoad()) return;
                    var mergedMessages = mergeDockChatMessages(userName, mergeDockChatRowsById(messagesResult.data || [], true, 180), readRevision).filter(function(m) {
                        // 本地已删除的消息不再进入缓存（否则未读统计/会话预览还会带上它）
                        return !isDmMessageLocallyDeleted(m);
                    });
                    var pendingReadUpdates = [];
                    mergedMessages.forEach(function(message) {
                        if (!message || message.user_name !== userName || message.media_url !== window.currentUser || getDMMessageReadAt(message)) {
                            return;
                        }
                        pendingReadUpdates.push({ id: message.id });
                    });
                    _chatCache[cacheKey] = mergedMessages;
                    var oldRetry = el.querySelector('.chat-load-retry'); if (oldRetry) oldRetry.remove();
                    renderDockMessages(userName, mergedMessages, forceScroll);
                    if (pendingReadUpdates.length && currentDockTab==='chat' && !document.hidden) {
                        window.markMessagesRead(userName, mergedMessages, pendingReadUpdates).catch(function() {
                            scheduleDockChatListRefresh(120);
                        });
                    } else {
                        updateUnreadBadge();
                    }
                } catch(e) {
                    if (currentLoad()) {
                        if (!(_chatCache[cacheKey] && _chatCache[cacheKey].length)) el.innerHTML = '';
                        var previousRetry = el.querySelector('.chat-load-retry');
                        if (previousRetry) previousRetry.remove();
                        var retry = document.createElement('button');
                        retry.type = 'button';
                        retry.className = 'chat-load-retry';
            // ★ 修复：全库无 .chat-load-retry 样式规则，按钮此前以浏览器默认外观呈现
            retry.style.cssText = 'display:inline-block;margin:12px auto;padding:8px 18px;background:var(--primary,#4c9aff);color:#fff;border:none;border-radius:18px;cursor:pointer;font-size:13px;';
                        retry.textContent = '消息加载失败，点击重试';
                        retry.addEventListener('click', function() {
                            retry.remove();
                            loadDockChatMessages(userName, false, false, true);
                        }, { once: true });
                        el.appendChild(retry);
                    }
                } finally {
                    if (_dockChatMessageLoad === flight) _dockChatMessageLoad = null;
                }
            }

            function renderDockMessages(userName, msgs, forceScroll) {
                scheduleChatReactions();
                const el = document.getElementById('dockChatMessages');
                if (!el) return;
                // ★ 2026-09-27 修复（审计 S7：空数组分支绕过会话一致性检查）：
                //   此前 `userName !== dockChatActiveUser → return` 这道关卡位于**函数中部**
                //   （原 1624 行），而"消息为空"分支在它**之前**就 return 了。后果：
                //     1) 切走会话后，先前那个会话的在途轮询/同步回调若带着**空数组**回来，
                //        会命中空分支，把「发送第一条消息吧」写进**当前正在看的另一个会话**，
                //        刚打开的历史消息被整屏抹掉。
                //     2) 紧接着第 1619 行还会把 `_chatRenderSignature[outdatedUser] = '__empty__'`
                //        写脏签名缓存，导致切回该会话时判定"签名相同"而跳过渲染，停在空态。
                //   现在把会话归属检查**提到所有副作用之前**：只要 userName 与当前会话不符，
                //   立即返回，不写 DOM、不写签名、不触发墓碑同步。
                //   注意兼容 `__empty__`/空 userName 这类由内部主动发起的"清空"调用：
                //   它们不绑定具体会话，仍然放行（由空分支自己处理）。
                if (userName && dockChatActiveUser && userName !== dockChatActiveUser) return;
                // ★ S7 配套：墓碑同步回调是**异步**的，等到它回来时用户可能已经切走会话，
                //   甚至已经登出/换号。回调里必须重新核对「此刻的会话 + 此刻的账号」，
                //   否则会拿旧会话的数据去重渲染新会话，或把上个账号的缓存画进新账号界面。
                //   账号维度用快照比较（renderDockMessages 是同步函数，取当前 currentUser 即基线）。
                var renderOwner = currentUser || '';
                if (typeof clearDockChatDesktopEmptyFlag === 'function') clearDockChatDesktopEmptyFlag();
                // ★ 2026-09-25：长按菜单的「删除」语义为「对本账号隐藏」。
                //   必须在这里统一过滤 tombstone，否则下一次轮询/重新进入会话时，
                //   服务端返回的同一批消息会把删掉的内容又渲染回来。
                // ★ 2026-09-26：墓碑现在是"本机 ∪ 服务端"。这里首次渲染时后台拉取服务端
                //   快照并合并（每账号每会话只拉一次），合并结果变化后再重渲染一次，
                //   使"在别的设备删掉的消息"在本机也立即消失。
                if (userName) {
                    try {
                        syncDmDeletedWithServer(userName, false).then(function(changed) {
                            if (!changed) return;
                            // ★ S7：回调期间用户可能已切走会话/登出/换账号 —— 三者任一不成立即放弃重渲染
                            if (!window.currentUser) return;
                            if ((currentUser || '') !== renderOwner) return;
                            if (dockChatActiveUser && userName !== dockChatActiveUser) return;
                            var uKey = getDockChatCacheKey(userName);
                            var fresh = Array.isArray(_chatCache[uKey]) ? _chatCache[uKey] : [];
                            _chatRenderSignature[userName] = undefined;
                            renderDockMessages(userName, fresh, false);
                        }).catch(function() {});
                    } catch (eSync) {}
                }
                msgs = (Array.isArray(msgs) ? msgs : []).filter(function(m) {
                    return !isDmMessageLocallyDeleted(m);
                });
                if (!msgs.length) {
                    cancelDockChatSendFlights();
                    _chatRenderSignature[userName || '__empty__'] = '__empty__';
                    el.innerHTML = '<div class="chat-empty"><div class="ce-icon">💬</div><div>发送第一条消息吧</div></div>';
                    el.dataset.chatUser = userName || '__empty__';
                    return;
                }
                // 注：会话归属检查已前移到函数开头（见上），此处不再重复判断。
                var signatureKey = userName || '__empty__';
                var nextSignature = buildDockChatRenderSignature(msgs);
                if (_chatRenderSignature[signatureKey] === nextSignature && el.dataset.chatUser === signatureKey) {
                    queueDockVoiceTranscription(userName, msgs);
                    if (forceScroll) scrollDockChatToLatest();
                    return;
                }
                var previousScrollTop = el.scrollTop;
                var isNearBottom = !el.scrollHeight || isDockChatNearBottom(el, 100);
                var shouldAutoScroll = forceScroll || isNearBottom;
                const isBulk = msgs.length > 2;
                var otherUser = msgs[0] ? (msgs[0].user_name === currentUser ? msgs[0].media_url : msgs[0].user_name) : '';
                var avatars = { mine: getDockChatAvatarMarkup(currentUser), other: getDockChatAvatarMarkup(otherUser) };
                var sameConversation = el.dataset.chatUser === signatureKey;
                if (!sameConversation) { var snapshot=_chatDomSnapshots.get(getDockChatCacheKey(userName)); if (snapshot) { el.replaceChildren.apply(el,snapshot); sameConversation=true; } }
                var existingRows = {};
                Array.prototype.forEach.call(el.querySelectorAll('.chat-msg-row[data-msg-key]'), function(node) {
                    var k = node.getAttribute('data-msg-key');
                    if (k) existingRows[k] = node;
                });
                var newReceived=msgs.filter(function(message,index){return message.user_name!==currentUser && !existingRows[getDockChatRowKey(message,index)];}).length;
                var orderedNodes = [];
                msgs.forEach(function(message, index) {
                    var key = getDockChatRowKey(message, index);
                    var sig = buildDockChatRowSignature(message);
                    var node = existingRows[key];
                    if (sameConversation && node && node.getAttribute('data-msg-sig') === sig) {
                        // 未变化 → 复用原节点：图片不重新请求，已读状态不重建，不闪白
                        delete existingRows[key];
                        orderedNodes.push(node);
                        return;
                    }
                    var activeFlight = _chatSendFlights.get(message.__tempId || '');
                    if (!activeFlight && node) {
                        _chatSendFlights.forEach(function(flight) { if (flight.bubble && node.contains(flight.bubble)) activeFlight=flight; });
                    }
                    if (!activeFlight) _chatSendFlights.forEach(function(flight) { if (flight.messageId && flight.messageId===message.id) activeFlight=flight; });
                    if (activeFlight && message.__failed) { activeFlight.finish(); activeFlight=null; }
                    var template = document.createElement('template');
                    template.innerHTML = buildDockChatRowMarkup(message, avatars, isBulk || !message.__optimistic).trim();
                    var nextNode = template.content.firstElementChild;
                    if (node && sameConversation && node.getAttribute('data-body-sig') === buildDockChatStableBodySignature(message)) {
                        var oldMeta=node.querySelector('.msg-meta'), nextMeta=nextNode.querySelector('.msg-meta');
                        if (oldMeta && nextMeta && oldMeta.innerHTML!==nextMeta.innerHTML) oldMeta.innerHTML=nextMeta.innerHTML;
                        var oldBubble=node.querySelector('.chat-msg'), nextBubble=nextNode.querySelector('.chat-msg');
                        if (oldBubble && nextBubble) oldBubble.className=nextBubble.className;
                    } else node=nextNode;
                    node.setAttribute('data-body-sig',buildDockChatStableBodySignature(message));
                    node.setAttribute('data-message-id',String(message.id || ''));
                    if (node) {
                        node.setAttribute('data-msg-key', key);
                        node.setAttribute('data-msg-sig', sig);
                        if (activeFlight) {
                            if (activeFlight.bubble) activeFlight.bubble.style.visibility='';
                            activeFlight.bubble=node.querySelector('.chat-msg');
                            if (activeFlight.bubble) activeFlight.bubble.style.visibility='hidden';
                        }
                    }
                    orderedNodes.push(node);
                });
                var cursor=el.firstChild;
                orderedNodes.forEach(function(node) { if (node===cursor) cursor=cursor.nextSibling; else el.insertBefore(node,cursor); });
                var wanted=new Set(orderedNodes); Array.from(el.children).forEach(function(node) { if (!wanted.has(node)) node.remove(); });
                el.dataset.chatUser = signatureKey;
                _chatRenderSignature[signatureKey] = nextSignature;
                patchDockChatMessageAvatars(userName);
                bindChatAudioPlayers();
                queueDockVoiceTranscription(userName, msgs);
                // ★ 2026-09-26：把仍用本地 blob 显示的图片在后台换成远端地址
                //   （下载成功才替换，失败则继续显示本地图，绝不降级成按钮）
                try { if (typeof hydrateDockChatRemoteMedia === 'function') hydrateDockChatRemoteMedia(el); } catch (eHyd) {}
                if (shouldAutoScroll) {
                    scrollDockChatToLatest();
                    bindDockChatMediaLoadScroll(el, true);
                } else if (sameConversation) {
                    // Keep the reader anchored on the same message while a polling refresh
                    // updates the DOM; only advertise the new messages instead of yanking
                    // the conversation to the bottom.
                    // ★ 2026-09-27 修复（审计 C10：上翻历史被轮询拖回底部）：
                    //   旧公式 `previousScrollTop + (scrollHeight - previousScrollHeight)`
                    //   是「在**顶部之前**插入内容、需要把内容整体下推」的补偿语义。
                    //   但本函数的更新方式是在**末尾追加**（消息按时间升序渲染，新的在下面），
                    //   追加发生在视口**下方**，根本不影响用户当前正在阅读的位置。
                    //   套用该公式会把 scrollTop 跟着内容高度增量往前推 —— 每轮轮询都把
                    //   正在上翻历史的用户往底部方向拽一段，连点几次就"被拖回底部"。
                    //   正确做法：追加到末尾时 scrollTop 保持**不变**（视口内内容位置不动）。
                    el.scrollTop = previousScrollTop;
                    var jump=document.getElementById('dockChatJumpLatest');if(jump && !_chatHistoryFocus)jump.dataset.unseen=String(Number(jump.dataset.unseen || 0)+newReceived);
                    setDockChatJumpLatestVisible(true);
                } else {
                    setDockChatJumpLatestVisible(false);
                }
            }

            window.withdrawDMMessage = async function(id, btnEl) {
                if (!id) return false;
                // ★ 2026-09-25：撤回入口从"气泡内常驻按钮"改为长按菜单后，这里不再有
                //   按钮可用来显示"撤回中…"，因此 btnEl 变成可选，并返回是否成功，
                //   交给调用方决定提示。
                var oldText = btnEl ? btnEl.textContent : '';
                if (btnEl) {
                    btnEl.textContent = '撤回中...';
                    btnEl.style.pointerEvents = 'none';
                }
                try {
                    var resp = await window.xtjProtectedFetch('/api/dm/withdraw', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: id })
                    });
                    var result = await resp.json().catch(function() { return {}; });
                    if (!resp.ok || !result.ok) {
                        throw new Error(result.error || '撤回失败');
                    }
                    if (result.message && dockChatActiveUser) {
                        upsertDockChatCacheMessage(dockChatActiveUser, result.message);
                        // 撤回后本地签名要失效，否则签名未变会被提前 return 掉、界面不更新
                        _chatRenderSignature[dockChatActiveUser] = undefined;
                        loadDockChatMessages(dockChatActiveUser, false);
                    }
                    window.showToast('已撤回');
                    return true;
                } catch (e) {
                    window.showToast(e.message || '撤回请求失败');
                    if (btnEl) {
                        btnEl.textContent = oldText;
                        btnEl.style.pointerEvents = 'auto';
                    }
                    return false;
                }
            };

            function scrollDockChatBottom() {
                scrollDockChatToLatest({ smooth: true });
            }

            // ★ 2026-09-25 新增 / ★ 2026-09-26 反转默认值：「原图」开关。
            //   用户明确要求：**发出去的就是原图**，只有在**主动取消勾选**原图时才发缩略图。
            //   所以默认值改为「开」（safeStorage 还没有该键时按开启处理）。
            //   开启 → 按原始字节上传，不缩放不重编码；
            //   关闭 → 压到长边 1600 / q0.82（约 200–500KB，弱网更快）；
            //   唯一例外是 HEIC —— 服务端 sharp 不支持 HEIC/HEVC，必须转码成 JPEG，
            //   此时用 q0.95 且不缩放，把损失降到最低。
            //   偏好按设备持久化（safeStorage），下次进来自动沿用。
            var DM_ORIGINAL_KEY = 'xtj_dm_send_original';

            // ★ 2026-09-26 反转默认值：**默认不勾选（压缩）**。
            //   用户澄清：「开启原图选项不应该是图片开始原图吗，为什么现在显示气泡和图片原图？
            //   一个文本信息有啥原图不原图的？」——上一版把默认值反成"开"是理解错了。
            //   正确语义：默认走压缩（体积小、弱网快）；**主动勾选**后整条链才切到原图字节。
            //   旧版本遗留的 '1'（那时"开"=压缩）与新版语义相反，直接忽略 —— 用户升级后
            //   看到的就是默认不勾选，符合直觉。
            function isDmOriginalSendEnabled() {
                try {
                    return window.safeStorage.get(DM_ORIGINAL_KEY) === '1';
                } catch (e) { return false; }
            }

            function syncDmOriginalToggle() {
                var btn = document.getElementById('dockChatOrigBtn');
                if (!btn) return;
                var on = isDmOriginalSendEnabled();
                btn.classList.toggle('is-on', on);
                btn.setAttribute('aria-checked', on ? 'true' : 'false');
                btn.setAttribute('aria-label', on ? '原图已开启，点击改为压缩发送' : '原图已关闭，点击按原始画质发送');
                var label = btn.querySelector('.cor-label');
                if (label) label.textContent = '原图';
            }

            window.toggleDmOriginalSend = function() {
                var next = !isDmOriginalSendEnabled();
                try { window.safeStorage.set(DM_ORIGINAL_KEY, next ? '1' : '0'); } catch (e) {}
                syncDmOriginalToggle();
                var btn = document.getElementById('dockChatOrigBtn');
                if (btn) {
                    btn.classList.remove('is-bouncing');
                    void btn.offsetWidth;
                    btn.classList.add('is-bouncing');
                    clearTimeout(btn._dmBounceTimer);
                    btn._dmBounceTimer = setTimeout(function() { btn.classList.remove('is-bouncing'); }, 360);
                }
                showToast(next ? '已选原图：这条照片按原始画质发送' : '未选原图：照片压缩后发送（更省流量、更快）');
            };

            // ★ 2026-09-25 新增（修复"照片发送慢 / 发送失败"）：上传前把图片规范化成
            //   「服务端一定能解码、且体积可控」的 JPEG。三个真实问题的根因：
            //   ① HEIC：服务端 sharp 0.34.5（libvips 8.17.3）的 heif 解码器只注册了 .avif，
            //      **不支持 iPhone 的 HEIC/HEVC** → /api/dm/upload 里 sharp 解码抛错 →
            //      400「无法识别为有效图片，请重新选择」＝ 用户看到的"发送失败"。
            //      而 iOS Safari 自己能解码 HEIC，所以先在浏览器里画进 canvas 再导出 JPEG，
            //      等于借浏览器完成 HEIC→JPEG 转换，服务端与其它客户端都能正常显示。
            //   ② 速度慢：此前**零压缩**直传 3–8MB 原图，弱网下要几十秒；
            //      缩到长边 1600 / q0.82 后通常 200–500KB。
            //   ③ 顺带剥掉 EXIF（含 GPS 坐标）—— 私聊图片不该带着拍摄地。
            //   任何一步失败都回退原文件：绝不因为"压缩失败"让用户发不出去。
            var DM_IMAGE_MAX_EDGE = 1600;
            var DM_IMAGE_QUALITY = 0.82;

            // ★ 2026-09-26 新增：只读文件头拿图片像素尺寸（PNG/GIF/WEBP/JPEG）。
            //   用途是给气泡 <img> 写 width/height，让浏览器在图片解码完成前就按正确比例
            //   预留空间 —— 消除"先一个小气泡、图片到位后气泡又跳大"的两次布局跳动。
            //   刻意**不整图解ma**：原图动辄 3–12MB，为拿两个数字去解码既慢又占内存；
            //   这几种格式都把尺寸写在头部固定偏移上，读前 64KB 足够。
            function readImageHeaderSize(file) {
                return new Promise(function(resolve) {
                    var done = function(w, h) { resolve({ w: Math.round(w) || 0, h: Math.round(h) || 0 }); };
                    try {
                        if (!file || typeof file.slice !== 'function') return done(0, 0);
                        var head = file.slice(0, 65536);
                        var reader = new FileReader();
                        reader.onload = function() {
                            var buf = reader.result;
                            if (!(buf instanceof ArrayBuffer) || buf.byteLength < 32) return done(0, 0);
                            var u = new Uint8Array(buf);
                            // PNG：IHDR 里 16–23 字节是 width/height（大端）
                            if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) {
                                var dv = new DataView(buf);
                                return done(dv.getUint32(16), dv.getUint32(20));
                            }
                            // GIF：6–9 字节（小端）
                            if (u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46) {
                                return done(u[6] | (u[7] << 8), u[8] | (u[9] << 8));
                            }
                            // WEBP：RIFF....WEBP + VP8/VP8L/VP8X
                            if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 &&
                                u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50) {
                                var fmt = String.fromCharCode(u[12], u[13], u[14], u[15]);
                                if (fmt === 'VP8 ') return done((u[26] | (u[27] << 8)) & 0x3fff, (u[28] | (u[29] << 8)) & 0x3fff);
                                if (fmt === 'VP8L') {
                                    var b0 = u[21], b1 = u[22], b2 = u[23], b3 = u[24];
                                    var bits = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
                                    return done((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
                                }
                                if (fmt === 'VP8X') return done((u[24] | (u[25] << 8) | (u[26] << 16)) + 1, (u[27] | (u[28] << 8) | (u[29] << 16)) + 1);
                                return done(0, 0);
                            }
                            // JPEG：从 SOI 起按 marker 段走，找到 SOFn（C0–CF 且非 C4/C8/CC）
                            if (u[0] === 0xff && u[1] === 0xd8) {
                                var off = 2;
                                while (off + 9 < u.length) {
                                    if (u[off] !== 0xff) { off++; continue; }
                                    var marker = u[off + 1];
                                    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
                                    var segLen = (u[off + 2] << 8) | u[off + 3];
                                    if (segLen < 2) break;
                                    var isSof = (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
                                    if (isSof) {
                                        return done((u[off + 7] << 8) | u[off + 8], (u[off + 5] << 8) | u[off + 6]);
                                    }
                                    off += 2 + segLen;
                                }
                                return done(0, 0);
                            }
                            return done(0, 0);
                        };
                        reader.onerror = function() { done(0, 0); };
                        reader.readAsArrayBuffer(head);
                    } catch (e) { done(0, 0); }
                });
            }

            // 仅供私信使用：照片墙有它自己的一套"原画质直传"策略，**不要动**。
            async function prepareDmImageForUpload(file, opts) {
                var wantOriginal = !!(opts && opts.original);
                var passthrough = { file: file, converted: false, originalSize: file.size, newSize: file.size, w: 0, h: 0 };
                if (!file || !/^image\//i.test(String(file.type || ''))) return passthrough;
                var headSize = await readImageHeaderSize(file);
                passthrough.w = headSize.w; passthrough.h = headSize.h;
                if (/gif/i.test(String(file.type || ''))) return passthrough; // 保留动图
                var isHeic = /heic|heif/i.test(String(file.type || '')) || /\.(heic|heif)$/i.test(String(file.name || ''));
                // ★ 原图开关打开时：非 HEIC 一律**原样上传** —— 不缩放、不重编码，保留原始字节。
                //   （HEIC 例外：服务端 sharp 不支持 HEIC/HEVC，必须转码，否则整条消息发不出去。）
                if (wantOriginal && !isHeic) return passthrough;
                // 未选原图的静态照片统一重编码，小文件也遵守开关。


                var bitmap = null;
                try {
                    if (typeof createImageBitmap === 'function') {
                        try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
                        catch (e1) { bitmap = await createImageBitmap(file); }
                    }
                } catch (eBitmap) { bitmap = null; }
                if (!bitmap) {
                    bitmap = await new Promise(function(resolve) {
                        var url = URL.createObjectURL(file);
                        var img = new Image();
                        img.onload = function() { URL.revokeObjectURL(url); resolve(img); };
                        img.onerror = function() { URL.revokeObjectURL(url); resolve(null); };
                        img.src = url;
                    });
                }
                // 浏览器也解不了（典型：桌面 Chrome 打开 HEIC）→ 交回原文件，由调用方决定怎么提示
                if (!bitmap) throw Error('无法压缩这张照片，请重试或勾选原图');

                var sw = bitmap.width || 0, sh = bitmap.height || 0;
                if (!sw || !sh) throw Error('图片尺寸无法读取，请重试');
                // 原图模式不缩放；HEIC 必须转码时用更高质量，尽量少损失
                var maxEdge = wantOriginal ? 0 : DM_IMAGE_MAX_EDGE;
                var quality = wantOriginal ? 0.95 : DM_IMAGE_QUALITY;
                var scale = maxEdge > 0 ? Math.min(1, maxEdge / Math.max(sw, sh)) : 1;
                var tw = Math.max(1, Math.round(sw * scale));
                var th = Math.max(1, Math.round(sh * scale));
                var canvas = null, ctx = null;
                try {
                    if (typeof OffscreenCanvas === 'function') { canvas = new OffscreenCanvas(tw, th); }
                    else { canvas = document.createElement('canvas'); canvas.width = tw; canvas.height = th; }
                    ctx = canvas.getContext('2d');
                    if (!ctx) throw Error('无法压缩这张照片，请重试或勾选原图');
                    ctx.fillStyle='#fff';ctx.fillRect(0,0,tw,th);
                    ctx.drawImage(bitmap, 0, 0, tw, th);
                } catch (eDraw) {
                    throw Error('无法压缩这张照片，请重试或勾选原图');
                } finally {
                    try { if (bitmap && typeof bitmap.close === 'function') bitmap.close(); } catch (eClose) {}
                }

                var blob = null;
                try {
                    if (typeof canvas.convertToBlob === 'function') {
                        blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality });
                    } else {
                        blob = await new Promise(function(resolve) { canvas.toBlob(resolve, 'image/jpeg', quality); });
                    }
                } catch (eBlob) { blob = null; }
                if (!blob) throw Error('无法压缩这张照片，请重试或勾选原图');
                // 压缩模式保留生成的结果，不能按体积悄悄回退原文件。


                var baseName = String(file.name || 'image').replace(/\.[^./\\]+$/, '') || 'image';
                var nextFile = null;
                try { nextFile = new File([blob], baseName + '.jpg', { type: 'image/jpeg', lastModified: Date.now() }); }
                catch (eFile) { throw Error('无法生成压缩照片，请重试或勾选原图'); }
                // 返回**输出图**的真实像素（缩放后为 tw×th），气泡按比例占位才准确
                return { file: nextFile, converted: true, originalSize: file.size, newSize: nextFile.size, w: tw, h: th };
            }

            var _chatSendFlight = null;
            async function sendDockChatMessageSingle(queuedFile, queuedText, retryOptions) {
                _chatHistoryFocus = '';
                if (!currentUser) { showToast('请先登录'); return; }
                if (isUserMuted()) { showToast("您已被禁言，无法发送消息"); return; }
                const inp = document.getElementById('dockChatInput');
                if (!inp) return;
                const content = queuedText != null ? queuedText : inp.value.trim();
                const fileInput = document.getElementById('dockChatFileInp');
                let file = queuedFile || _chatRecordedFile || (fileInput && fileInput.files[0]);
                if (file) file = normalizeDockChatMediaFile(file);
                if (_chatVoice) { showToast('请先结束录音'); return; }
                if (_chatEditDraft) { await sendChatEditedMessage(content); return; }
                var replyDraftSource = _chatReplyDraft;
                var replyDraft = replyDraftSource ? Object.assign({}, replyDraftSource) : null;
                if (!content && !file) return;
                if (!dockChatActiveUser) {
                    if (content) showToast('请先选择一个聊天对象');
                    return;
                }
                if (dockChatSending) {
                    // ★ 2026-09-25 修复（审计 M-4）：旧实现把 dockChatSending 与"无内容"
                    //   合并在同一个 return 里，发送中再次回车会被静默吞掉（无提示、不排队）。
                    //   这里给出明确反馈；输入框内容保持不变，用户可直接再回车。
                    showToast('上一条消息正在发送，请稍候');
                    return;
                }
                var sendOwner=currentUser,sendEpoch=_authStateEpoch;
                function sameSender(){return currentUser===sendOwner && _authStateEpoch===sendEpoch;}
                function assertSender(){if(!sameSender() || flight.controller.signal.aborted){var error=new Error('账号已切换，发送已停止');error.code='identity_changed';throw error;}}
                var targetUser = dockChatActiveUser;
                if (targetUser === currentUser) { showToast('不能给自己发送消息'); return; }
                var maxFileSize = 50 * 1024 * 1024;
                if (file && file.size > maxFileSize) { showToast("文件大小不能超过50MB"); return; }
                if (file) {
                    // ★ 修复：显式拒绝 SVG（image/svg+xml 会通过 image/ 前缀白名单）。
                    // ★ M13：拦截规则已收敛到共用 isBlockedDmFile（粘贴/拖拽入口同用），
                    // 确保三个入口规则一致。
                    if (isBlockedDmFile(file)) { showToast("不支持 SVG 文件，支持图片、视频、音频及 PDF、TXT、CSV、RTF、DOCX、XLSX、PPTX、ZIP"); return; }
                    var allowedTypes = ['image/','video/','audio/'];
                    var typeOk = !!getChatUploadKind(file);
                    if (!typeOk) { showToast("不支持的文件类型，支持图片、视频、音频及 PDF、TXT、CSV、RTF、DOCX、XLSX、PPTX、ZIP"); return; }
                }
                var sendOriginal=isDmOriginalSendEnabled();
                var sendOrigin = captureDockChatSendOrigin(file);
                var flight={controller:new AbortController(),owner:sendOwner,epoch:sendEpoch};_chatSendFlight=flight;
                dockChatSending = true; if (!queuedFile || inp.value.trim()===content) inp.value = '';
                sendDockChatTyping(false);
                if (_dockChatDraftTimer) { clearTimeout(_dockChatDraftTimer); _dockChatDraftTimer = null; }
                // 把真实的发送状态告诉 ux-features 的指示器（它此前是假的 1.8 秒计时）
                try { if (typeof window.__xtjNotifyChatSending === 'function') window.__xtjNotifyChatSending(true); } catch (e) {}
                var capturedContent = content;
                var tempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
                // ★ 2026-09-27 修复（审计 S5：发送请求缺幂等键）：
                //   /api/dm/send 此前只带 target_user + content，服务端无法区分
                //   「用户真的发了两条一模一样的话」和「同一条消息被重发了一次」。
                //   而前端**确实会重发**：xtjProtectedFetch 超时后（60s 未回包）会走
                //   401 续期重试；弱网下"服务端已落库、响应丢在路上"更是经典场景 ——
                //   结果是收件人看到两条重复消息，且前端 replaceDockChatCacheMessage
                //   按 tempId 替换，两条服务端消息里只有一条能替换掉乐观气泡，另一条
                //   永久残留成"幽灵消息"。
                //   现在为每次用户动作生成一个稳定幂等键（同一 tempId 生命周期内不变，
                //   重发/重试复用同一个值），服务端据此去重即可。
                var clientMessageId = retryOptions && retryOptions.clientMessageId || tempId;
                var optimisticCreatedAt = new Date().toISOString();
                var localPreviewUrl = '';
                var mediaKind = file
                    ? getChatUploadKind(file)
                    : null;
                var mediaPayload = null;
                var mediaW = 0, mediaH = 0;
                if (file) {
                    // Each media bubble owns its local preview until delivery/cleanup.
                    // Keep recorded audio playable immediately, without waiting for storage.
                    if (['image','audio','video'].includes(mediaKind)) {
                        try {
                            localPreviewUrl = URL.createObjectURL(file);
                            mediaPayload = { kind: mediaKind, url: localPreviewUrl, mimeType: file.type || '', duration: file.__voiceDuration || 0 };
                            var previewImage=document.querySelector('#dockCfpThumb img');
                            if (previewImage && previewImage.naturalWidth && previewImage.naturalHeight) {
                                mediaPayload.w=previewImage.naturalWidth; mediaPayload.h=previewImage.naturalHeight;
                            }
                        } catch (previewError) { /* 本地预览失败时仍继续发送原文件 */ }
                    }
                }
                var actorKey = DM_MARKER;
                var optimisticContentPayload = buildDMMessageContent({ content: capturedContent }, Object.assign({ text: capturedContent, read_at: null, media: mediaPayload }, replyDraft ? { reply_to: replyDraft } : {}));
                var optimisticMessage = {
                    id: tempId,
                    __tempId: tempId,
                    __clientMessageId: clientMessageId,
                    __optimistic: true,
                    __localPreviewUrl: localPreviewUrl,
                    user_name: currentUser,
                    content: optimisticContentPayload,
                    media_type: DM_MARKER,
                    media_url: targetUser,
                    actor_key: actorKey,
                    created_at: optimisticCreatedAt,
                    views: 0
                };
                renderDockMessages(targetUser, upsertDockChatCacheMessage(targetUser, optimisticMessage), true);
                animateDockChatSend(tempId,targetUser,sendOrigin);
                applyDockChatConversationPreview(targetUser, optimisticMessage, 0);
                if (file) clearDockChatFilePreview(false);
                // 失败重发时复用同一个文件对象（File 在内存里保留，页面刷新后重发不可用）
                var pendingFile = file || null;
                try {
                    var storagePath = null;
                    if (file) {
                        // 上传前按点击发送时的原图开关处理；压缩失败不得偷偷上传原文件。
                        if (/^image\//i.test(String(file.type || ''))) {
                            try {
                                var _prep = await prepareDmImageForUpload(file, { original: sendOriginal });
                                assertSender();
                                if (_prep) {
                                    // 真实像素 → 随消息一起存（服务端会原样透传），
                                    // 渲染时写成 <img width height> 让气泡按正确比例占位。
                                    mediaW = Math.round(Number(_prep.w || 0)) || 0;
                                    mediaH = Math.round(Number(_prep.h || 0)) || 0;
                                }
                                if (_prep && _prep.file && _prep.file !== file) {
                                    file = _prep.file;
                                    // Keep the selected original for retries and a changed original toggle.
                                    if(localPreviewUrl){var previousPreview=localPreviewUrl;localPreviewUrl=URL.createObjectURL(file);optimisticMessage.__localPreviewUrl=localPreviewUrl;window.__xtjReleaseDmLocalPreview(previousPreview);_chatRenderSignature[targetUser]=undefined;renderDockMessages(targetUser,upsertDockChatCacheMessage(targetUser,optimisticMessage),false);}
                                }
                                // 换位后把宽高补进乐观气泡（否则第一帧仍会先小后大）
                                if (mediaW > 0 && mediaH > 0 && mediaPayload) {
                                    mediaPayload.w = mediaW;
                                    mediaPayload.h = mediaH;
                                    var _optPayload = getDMMessagePayload(optimisticMessage) || {};
                                    if (_optPayload.media) {
                                        _optPayload.media.w = mediaW;
                                        _optPayload.media.h = mediaH;
                                        optimisticMessage.content = JSON.stringify(_optPayload);
                                    }
                                }
                            } catch (prepErr) {
                                console.warn('[dm-send] image compression failed');
                                // 浏览器解不了 HEIC，且服务端 sharp 也不支持 → 给出可执行的提示，
                                // 而不是让用户面对一句模糊的「无法识别为有效图片」。
                                if (/heic|heif/i.test(String(file.type || '') + ' ' + String(file.name || ''))) {
                                    var heicErr = new Error('当前浏览器无法转换 HEIC 照片：请在 iPhone 相册里打开该照片 → 编辑 → 存储为 JPEG，或改用「文件」里的 JPG 发送');
                                    heicErr.serverRejected = true;
                                    throw heicErr;
                                }
                                prepErr.serverRejected=true;throw prepErr;
                            }
                        }
                        // ★ 2026-09-25 根治：媒体改走**后端上传**，不再直连 Supabase Storage。
                        //   旧实现依赖 window.sb（浏览器端 anon key）。构建期未注入
                        //   SUPABASE_ANON_KEY 时线上 config 里是占位串，浏览器用垃圾 key 建的
                        //   client 在登录后会被 Supabase 判为无效 JWS，报
                        //   "发送失败: 媒体上传失败: Invalid Compact JWS"——反复出现的根因。
                        //   改成一次 multipart 以外的单请求：50MB 原始体 + 查询参数描述元数据，
                        //   由后端用 service_role 写入，前端不再持有任何存储密钥。
                        var _dmKind = getChatUploadKind(file);
                        if (!_dmKind) throw new Error('不支持的媒体类型: ' + file.type);
                        // 路径必须带 uidHash 前缀，后端 validateDmUploadOwnership 会校验归属，
                        // 防止"猜一个他人路径"抢占存储位置。
                        var path = await buildDmStorageUploadPath(file.name);
                        assertSender();
                        // ★ 2026-09-26：fetch 换成 XHR 上传（uploadDmMediaWithProgress）。
                        //   fetch 拿不到上传进度，用户只能对着"图片上传中…"干等；
                        //   XHR 的 upload.onprogress 能拿到真实字节百分比，
                        //   由 setDockChatUploadProgress 实时画进气泡下方的进度环。
                        //   鉴权/401 重试/超时语义与 xtjProtectedFetch 保持一致。
                        var _upData = await uploadDmMediaWithProgress(path, _dmKind, file, function(ratio, phase) {
                            if(sameSender())setDockChatUploadProgress(tempId, ratio, phase || 'uploading');
                        }, {owner:sendOwner,epoch:sendEpoch,signal:flight.controller.signal});
                        assertSender();
                        storagePath = _upData.storage_path || path;
                        mediaKind = _dmKind;
                        if (_dmKind === 'file') {
                            actorKey = '__dm_file__' + storagePath;
                            mediaPayload = { kind: 'file', url: _upData.public_url, name: file.name };
                        } else if (_dmKind === 'video') {
                            actorKey = '__dm_vid__' + storagePath;
                            mediaPayload = { kind: 'video', url: _upData.public_url || getMediaUrl('__dm_vid__', storagePath), mimeType: file.type || '' };
                        } else if (_dmKind === 'image') {
                            actorKey = '__dm_img__' + storagePath;
                            mediaPayload = { kind: 'image', url: _upData.public_url || getMediaUrl('__dm_img__', storagePath), mimeType: file.type || '', w: mediaW, h: mediaH };
                        } else {
                            // P6: 明确支持音频 — 之前校验允许 audio/ 但上传分支和解析/渲染
                            // 全链路缺失，导致音频文件成为 Storage 孤儿。
                            actorKey = '__dm_aud__' + storagePath;
                            mediaPayload = { kind: 'audio', url: _upData.public_url || getMediaUrl('__dm_aud__', storagePath), mimeType: file.type || '' };
                        }
                    }
                    // P6: 客户端只提交 storage_path / kind / mime_type，后端生成 URL 和 actor_key
                    // 禁止前端直接发送 actor_key 和 media_type，防止篡改。
                    var requestBody = {
                        target_user: targetUser,
                        content: JSON.stringify(Object.assign({ type: 'dm', text: capturedContent, read_at: null }, replyDraft ? { reply_to: replyDraft } : {})),
                        // ★ S5：稳定幂等键。服务端应按 (user_name, client_message_id) 去重：
                        //   重复到达时直接返回**已存在的那条消息**而不是再插一条。
                        //   后端未实现时该字段被忽略，不影响现有行为（向前兼容）。
                        client_message_id: clientMessageId
                    };
                    if (storagePath) {
                        requestBody.storage_path = storagePath;
                        requestBody.kind = mediaKind;
                        requestBody.mime_type = file.type;
                        if (mediaKind === 'audio') requestBody.voice_duration = file.__voiceDuration || 0;
                        if (mediaKind === 'file') requestBody.file_name = file.name;
                        // 像素尺寸只用于气泡按比例占位（纯展示），服务端会做范围校验
                        if (mediaKind === 'image' && mediaW > 0 && mediaH > 0) {
                            requestBody.media_width = mediaW;
                            requestBody.media_height = mediaH;
                        }
                    }

                    // ★ 通过后端认证接口发送，禁止前端直连 Supabase。
                    //   ★ 2026-09-25 修复（"图片不显示"的根因）：此前没传 timeoutMs，
                    //   走的是 xtjProtectedFetch 默认的 15s。移动网络下"媒体已上传、正在写库"
                    //   很容易超过 15s，前端当成失败 → 进 catch → 调 /api/dm/upload/abort
                    //   把存储对象删掉；而服务端其实提交成功了 → 消息在、图片 404，
                    //   收件人看到的正是"图片不显示"。现在放宽到 60s，并且只有服务端
                    //   **明确拒绝**（4xx 且重试无意义）时才允许回收媒体。
                    var sendResp = await window.xtjProtectedFetch('/api/dm/send', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody),
                        timeoutMs: 60000,authOwner:sendOwner,authEpoch:sendEpoch,signal:flight.controller.signal
                    });
                    assertSender();
                    if (!sendResp.ok) {
                        var sendErrData = await sendResp.json().catch(function() { return {}; });
                        var sendErr = new Error(sendErrData.error || '发送失败 (HTTP ' + sendResp.status + ')');
                        // 只有"重试也不会变好"的客户端错误才把提交结果视为确定；
                        // 409/429/5xx 属于可重试或结果未知，媒体必须留下。
                        sendErr.serverRejected = [400, 403, 404, 413, 415, 422].indexOf(sendResp.status) >= 0;
                        throw sendErr;
                    }
                    var sendResult = await sendResp.json();
                    assertSender();
                    if (!sendResult.ok || !sendResult.message) throw new Error('服务端未确认发送');

                    var insertedMessage = Object.assign({}, sendResult.message, { __committedRevision: ++_chatCommittedRevision });
                    var sendFlight = _chatSendFlights.get(tempId);
                    if (sendFlight) sendFlight.messageId=insertedMessage.id;
                    if (replyDraftSource && _chatReplyDraft === replyDraftSource) clearChatMessageDraft();
                    touchUserSession(false);
                    try { if (typeof window.queueBehavior === 'function') window.queueBehavior('message_send', '发送消息给 [' + targetUser + ']'); } catch(e) {
                    if(!sameSender() || flight.controller.signal.aborted){if(localPreviewUrl)URL.revokeObjectURL(localPreviewUrl);return;}}
                    if(dockChatActiveUser===targetUser)clearDockChatFilePreview(false);
                    // ★ 2026-09-26（用户反馈"气泡先小、再空、最后变成查看图片按钮"）：
                    //   发送成功后**不立刻释放本地原图**。把 blob 挂到真实消息上继续当显示源，
                    //   于是气泡里从头到尾都有图（本地字节，不可能 404）；远端地址交给
                    //   hydrateDockChatRemoteMedia() 在后台下载，下载成功后才无缝换过去
                    //   并释放 blob。远端一时取不到也无所谓 —— 继续显示本地图，不降级。
                    if (localPreviewUrl && ['image','audio','video'].includes(mediaKind)) {
                        insertedMessage = Object.assign({}, insertedMessage, { __localPreviewUrl: localPreviewUrl });
                    }
                    replaceDockChatCacheMessage(targetUser, tempId, insertedMessage);
                    if (mediaKind === 'audio') queueDockVoiceTranscription(targetUser, [insertedMessage], file, insertedMessage.id);
                    if (dockChatActiveUser === targetUser) {
                        renderDockMessages(targetUser, _chatCache[getDockChatCacheKey(targetUser)] || [], true);
                        try { if (typeof hydrateDockChatRemoteMedia === 'function') hydrateDockChatRemoteMedia(document.getElementById('dockChatMessages')); } catch (eH) {}
                    } else {
                        // 用户已切走会话：本地图没有展示的必要，直接释放
                        releaseDockChatLocalPreview(optimisticMessage);
                    }
                    localPreviewUrl = '';
                    // ★ 2026-09-25 修复（复审 P2-04）：这里原本还调 scheduleDockChatListRefresh(320)，
                    //   于是每发一条消息 → 320ms 后 → GET /api/dm/list（服务端要扫两个方向的消息）
                    //   → 重新分组 → 重算整个会话列表。而上一行的 applyDockChatConversationPreview
                    //   已经把本条会话的预览/时间就地更新好了，发送**不会**改变其它会话。
                    //   现在把它真正作为主更新路径；全量校准交给轮询/可见性变化/手动刷新。
                    applyDockChatConversationPreview(targetUser, insertedMessage, 0);
                    if (typeof window.__xtjRefreshIOSChatViewport === 'function') {
                        window.__xtjRefreshIOSChatViewport({ preserveFocus: true, forceScroll: true });
                    }
                } catch(e) {
                    // ★ 修复：发送失败时回收已上传的 Storage 文件，避免孤儿媒体永久泄漏。
                    //   ★ 2026-09-25 改造：媒体已改走后端上传，回收也走后端 /api/dm/upload/abort
                    //   （只允许删自己命名空间下、且尚未挂到任何消息上的对象）。
                    //   旧实现直调 sb.storage.remove，sb 为 null 时会抛 TypeError 把真正的
                    //   失败原因覆盖成 "null is not an object (evaluating 'sb.storage')"。
                    var hardRejected = !!(e && e.serverRejected);
                    // ★ 2026-09-25 修复（审计 B-3）：只有"服务端明确拒绝"才回收媒体。
                    //   超时/断网属于**提交结果未知**，此刻删对象会把可能已经入库的消息
                    //   变成永久 404 图片（＝用户反馈的"图片不显示"）。这种情况保留对象，
                    //   由注册表与清理队列兜底；用户重发会命中 actor_key 幂等直接成功。
                    if (storagePath && hardRejected) {
                        try {
                            await window.xtjProtectedFetch('/api/dm/upload/abort', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ storage_path: storagePath }),
                                timeoutMs: 15000,authOwner:sendOwner,authEpoch:sendEpoch
                            });
                            assertSender();
                        } catch (dmCleanupErr) { console.warn('[dm-send] orphan media cleanup failed', dmCleanupErr); }
                        storagePath = null;
                    }
                    if(!sameSender())return;
                    // ★ 2026-09-25 修复（"发送失败"体验）：不再把气泡直接抹掉。
                    //   旧行为是 removeDockChatCacheMessage + 一句 3 秒 toast —— 消息凭空消失，
                    //   用户既不知道丢了什么，也没有任何重试入口。现在保留为"失败态"气泡，
                    //   长按即可重发或删除，并把服务端原因留在气泡上（title）。
                    var failedMessage = Object.assign({}, optimisticMessage || {}, {
                        id: tempId,
                        __tempId: tempId,
                    __clientMessageId: clientMessageId,
                        __optimistic: false,
                        __failed: true,
                        user_name: currentUser,
                        media_type: DM_MARKER,
                        media_url: targetUser,
                        created_at: optimisticCreatedAt,
                        __pendingFile: pendingFile || null,
                        __pendingStoragePath: storagePath || null,
                        __pendingMediaKind: mediaKind || null,
                        __pendingActorKey: actorKey || null,
                        __pendingPayload: mediaPayload || null,
                        __localPreviewUrl: localPreviewUrl,
                        __failReason: (e && e.message) ? e.message : '未知错误'
                    });
                    upsertDockChatCacheMessage(targetUser, failedMessage);
                    if (dockChatActiveUser === targetUser) renderDockMessages(targetUser, _chatCache[getDockChatCacheKey(targetUser)] || [], true);
                    // 注意：不再把内容回填到输入框 —— 消息已经以失败气泡留在会话里，
                    // 回填会让用户以为没发出去而重复发送。
                    showToast('发送失败：' + ((e && e.message) ? e.message : '未知错误') + '（长按该条可重发）');
                }
                finally {
                    if(_chatSendFlight!==flight || !sameSender())return;
                    _chatSendFlight=null;dockChatSending = false;
                    if (window.currentUser === sendOwner && !inp.value) persistDockChatDraft(targetUser,'');
                    try { if (typeof window.__xtjNotifyChatSending === 'function') window.__xtjNotifyChatSending(false); } catch (e) {}
                }
            }

            // ══════════════════════════════════════════════════════════════════
            // 长按气泡操作菜单（对齐微信/QQ）：复制 / 撤回 / 删除 / 转发 / 分享
            //   ★ 2026-09-25 改造：撤回按钮过去常驻气泡（且窗口过期后仍不消失），
            //   现在统一收进长按菜单；菜单每次打开都**实时**计算可用性，
            //   因此不会再出现"点了必然失败"的按钮。
            //   移动端：长按 450ms；桌面端：右键（contextmenu）。
            // ══════════════════════════════════════════════════════════════════

            // 「删除」= 对本账号隐藏（与微信的"删除"语义一致）：用 tombstone 记录 id，
            //   渲染与入缓存时都过滤掉。按账号隔离，避免换账号后串数据。
            // ★ 2026-09-26 修复（用户反馈"删除为什么只在本机生效"）：
            //   此前墓碑**只写本机 localStorage**，服务端完全不知情 —— 换设备、清缓存、
            //   换浏览器登录同一账号后，被删消息又会重新出现（数据库里也仍在）。
            //   现在墓碑按账号同步到服务端（/api/dm/deleted），localStorage 退化为
            //   本地快取：启动时与服务端合并，删除时回推，离线删除在下次同步补传。
            var DM_DELETED_KEY_PREFIX = 'xtj_dm_deleted_';
            var DM_DELETED_MAX = 500;
            // ★ 2026-09-27 修复（审计 C12）：
            //   _dmDeletedSyncedUsers 的键此前只用"对手 userName" u，但墓碑实际是
            //   **账号级**的（DM_DELETED_KEY_PREFIX + currentUser，服务端 /api/dm/deleted
            //   也按 req.userName 隔离）。用对手名作键有两个致命后果：
            //     1) 失败后本次生命周期内不再同步：_dmDeletedSyncedUsers[u] 已置 1，
            //        且失败不回滚 → 该会话的墓碑永远补推不上去（离线删除丢失）。
            //     2) 切号后串号：A 账号同步过 u 后，切到 B 账号再用同一个 u 会命中旧标记，
            //        或用 B 的凭证去补传 A 的删除 ID。
            //   这里统一改为「账号 + 对手」复合键，并在同步失败时撤销标记允许重试。
            var _dmDeletedSyncedUsers = {};
            // 待补传队列改为按"入队账号"分批存储：{ account, ids }，补传前核对当前账号。
            var _dmDeletedPendingPush = [];

            function getDmDeletedIds() {
                try {
                    var raw = window.safeStorage ? window.safeStorage.get(DM_DELETED_KEY_PREFIX + (currentUser || '')) : null;
                    var arr = raw ? JSON.parse(raw) : [];
                    return Array.isArray(arr) ? arr : [];
                } catch (e) { return []; }
            }

            function persistDmDeletedIds(list) {
                try {
                    var clean = (Array.isArray(list) ? list : []).slice(0, DM_DELETED_MAX);
                    window.safeStorage.set(DM_DELETED_KEY_PREFIX + (currentUser || ''), JSON.stringify(clean));
                    return clean;
                } catch (e) { return []; }
            }

            function isDmMessageLocallyDeleted(message) {
                if (!message) return false;
                var id = String(message.id || message.__tempId || '');
                if (!id) return false;
                return getDmDeletedIds().indexOf(id) >= 0;
            }

            function markDmMessageLocallyDeleted(message) {
                var id = String((message && (message.id || message.__tempId)) || '');
                if (!id) return;
                var list = getDmDeletedIds().filter(function(x) { return x !== id; });
                list.unshift(id);
                if (list.length > DM_DELETED_MAX) list = list.slice(0, DM_DELETED_MAX);
                persistDmDeletedIds(list);
            }

            // ★ 2026-09-27（C12）：待补传队列是"账号级"的 —— 入队时记录当时的账号，
            //   补传前核对账号一致，不一致就丢弃（绝不用新账号的凭证去提交旧账号的 ID）。
            function enqueueDmDeletedPending(ids) {
                var list = (Array.isArray(ids) ? ids : []).filter(Boolean);
                if (!list.length) return;
                var account = currentUser || '';
                if (!account) return;
                var batch = null;
                for (var i = 0; i < _dmDeletedPendingPush.length; i++) {
                    if (_dmDeletedPendingPush[i] && _dmDeletedPendingPush[i].account === account) { batch = _dmDeletedPendingPush[i]; break; }
                }
                if (!batch) { batch = { account: account, ids: [] }; _dmDeletedPendingPush.push(batch); }
                batch.ids = batch.ids.concat(list).filter(function(id, idx, arr) { return arr.indexOf(id) === idx; }).slice(0, DM_DELETED_MAX);
            }

            // 取出"当前账号"的待补传 ID（不跨账号），其余账号的批次原样保留。
            function takeDmDeletedPendingForCurrentAccount() {
                var account = currentUser || '';
                var mine = [];
                var rest = [];
                _dmDeletedPendingPush.forEach(function(batch) {
                    if (!batch || !Array.isArray(batch.ids)) return;
                    if (batch.account === account) mine = mine.concat(batch.ids);
                    else rest.push(batch);
                });
                _dmDeletedPendingPush = rest;
                return mine;
            }

            // 把 ids 从"当前账号"的批次中移除（推送成功后调用）。
            function clearDmDeletedPendingForCurrentAccount(ids) {
                var account = currentUser || '';
                var drop = Array.isArray(ids) ? ids : [];
                _dmDeletedPendingPush.forEach(function(batch) {
                    if (!batch || batch.account !== account || !Array.isArray(batch.ids)) return;
                    batch.ids = batch.ids.filter(function(x) { return drop.indexOf(x) < 0; });
                });
                _dmDeletedPendingPush = _dmDeletedPendingPush.filter(function(batch) { return batch && batch.ids && batch.ids.length; });
            }

            // ★ 2026-09-26：把删除记录推给服务端（账号级同步）。返回 Promise<boolean>，
            //   失败时进入待补传队列，下次同步时一并补上（离线删除不丢）。
            function pushDmDeletedToServer(ids) {
                var list = (Array.isArray(ids) ? ids : []).filter(Boolean);
                if (!list.length) return Promise.resolve(true);
                // ★ 2026-09-27（C12）：入队/提交都绑定"入队时的账号"，切号后不会用新账号提交旧数据。
                if (typeof window.xtjProtectedFetch !== 'function') {
                    enqueueDmDeletedPending(list);
                    return Promise.resolve(false);
                }
                return window.xtjProtectedFetch('/api/dm/deleted', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: list }),
                    timeoutMs: 15000
                }).then(function(resp) {
                    if (!resp || !resp.ok) throw new Error('dm_deleted_sync_failed');
                    clearDmDeletedPendingForCurrentAccount(list);
                    return true;
                }).catch(function(err) {
                    console.warn('[DM] 删除记录同步失败，已排队待补传:', err && err.message);
                    enqueueDmDeletedPending(list);
                    return false;
                });
            }

            // ★ 2026-09-26：与服务端合并墓碑（本机 ∪ 服务端），并把"仅本机"的部分补推上去
            //   （覆盖老版本留下的纯本地墓碑，以及离线期间删掉的消息）。
            function syncDmDeletedWithServer(userName, force) {
                var u = String(userName || currentUser || '');
                if (!u) return Promise.resolve(false);
                // ★ 2026-09-27（C12）：复合键 —— 账号 + 对手。换账号后不复用旧标记（避免串号），
                //   同一账号下不同会话仍各自独立（保持原有"每会话一次"的去重语义）。
                var syncKey = (currentUser || '') + '|' + u;
                if (_dmDeletedSyncedUsers[syncKey] && !force) return Promise.resolve(false);
                _dmDeletedSyncedUsers[syncKey] = 1;
                // 同步发起时的账号快照：回调里核对，账号变了就整段放弃（不写缓存、不补传）。
                var syncOwner = currentUser || '';
                // 撤销标记：失败（网络/非 ok）时允许下次重试，否则本次生命周期内永不重试。
                var releaseMarker = function() { delete _dmDeletedSyncedUsers[syncKey]; };
                if (typeof window.xtjProtectedFetch !== 'function') { releaseMarker(); return Promise.resolve(false); }
                var localIds = getDmDeletedIds();
                // 只取**当前账号**的待补传批次（跨账号批次原样留在队列里）。
                var pending = takeDmDeletedPendingForCurrentAccount();
                return window.xtjProtectedFetch('/api/dm/deleted', { method: 'GET', timeoutMs: 15000 })
                    .then(function(resp) {
                        if (!resp || !resp.ok) throw new Error('dm_deleted_fetch_failed');
                        return resp.json();
                    })
                    .then(function(data) {
                        // 回调期间账号已变（登出/切号）→ 丢弃结果，不污染新账号的墓碑，也不补传。
                        if (!currentUser || (currentUser || '') !== syncOwner) return false;
                        var serverIds = (data && Array.isArray(data.ids)) ? data.ids : [];
                        var merged = serverIds.slice();
                        localIds.forEach(function(id) { if (merged.indexOf(id) < 0) merged.push(id); });
                        var onlyLocal = localIds.filter(function(id) { return serverIds.indexOf(id) < 0; });
                        var toPush = onlyLocal.concat(pending).filter(function(id, i, arr) { return arr.indexOf(id) === i; });
                        var changed = JSON.stringify(merged) !== JSON.stringify(localIds);
                        if (changed) persistDmDeletedIds(merged);
                        if (toPush.length) {
                            // 补传失败不回滚"已同步"标记也无妨：失败的 ID 会进待补传队列由下次重试。
                            pushDmDeletedToServer(toPush);
                        }
                        return changed;
                    })
                    .catch(function(err) {
                        console.warn('[DM] 删除记录同步失败（继续用本机记录）:', err && err.message);
                        // ★ C12：失败必须撤销标记 —— 否则本次生命周期内不再重试（离线删除会丢）。
                        releaseMarker();
                        return false;
                    });
            }

            function findDockMessageByRow(rowEl) {
                if (!rowEl || !dockChatActiveUser) return null;
                // ★ 2026-09-25 修复（右键/长按菜单"完全没反应"的根因）：
                //   data-msg-key 是渲染时挂在 **.chat-msg-row** 上的
                //   （见 renderDockMessages 里 querySelectorAll('.chat-msg-row[data-msg-key]')），
                //   而事件目标 closest('.chat-msg') 拿到的是**内部的气泡**。
                //   旧实现从气泡上读 key，永远是空串 → 这里恒返 null →
                //   openDockMessageActions 直接 return，菜单静默不弹。
                //   现在：先归一到 .chat-msg-row 再读 key，并保留 __tempId 兜底。
                var row = rowEl;
                if (row.classList && row.classList.contains('chat-msg')) {
                    row = row.closest ? (row.closest('.chat-msg-row') || row) : row;
                }
                var bubble = (row.classList && row.classList.contains('chat-msg'))
                    ? row
                    : (row.querySelector ? row.querySelector('.chat-msg') : null);
                var key = row.getAttribute ? (row.getAttribute('data-msg-key') || '') : '';
                var tempId = (bubble && bubble.getAttribute) ? (bubble.getAttribute('data-temp-id') || '') : '';
                if (!key && !tempId) return null;
                var list = _chatCache[getDockChatCacheKey(dockChatActiveUser)] || [];
                for (var i = 0; i < list.length; i++) {
                    var candidate = list[i];
                    if (key && getDockChatRowKey(candidate, i) === key) return candidate;
                    if (tempId && candidate && candidate.__tempId && String(candidate.__tempId) === tempId) return candidate;
                    if (key && candidate && candidate.__tempId && ('t:' + candidate.__tempId) === key) return candidate;
                }
                return null;
            }

            function getDmActionValue(message) {
                var text = (getDMMessageText(message) || '').trim();
                if (text) return text;
                var media = resolveDockChatMedia(message);
                return media && media.src ? String(media.src) : '';
            }

            // ★ 2026-09-25：操作条用 16px 线性 SVG 图标（跟随 currentColor）。
            //   原先用 emoji/符号当占位（⧉ ↩ ➦ ⤴ 🗑），在深色小条上既花又受字体影响。
            var DM_ACTION_ICONS = {
                reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 5v7a4 4 0 0 1-4 4H4m5-5-5 5 5 5"/></svg>',
                edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-3 3 5 5"/></svg>',
                copy: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
                withdraw: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10h11a5 5 0 0 1 0 10h-1"/><path d="M7 6l-4 4 4 4"/></svg>',
                forward: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h13"/><path d="M13 8l4 4-4 4"/></svg>',
                share: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>',
                delete: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/></svg>',
                resend: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2 5.3"/><path d="M20 5v6h-6"/></svg>',
                'ask-ai': '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l1.9 4.3 4.6.5-3.4 3 1 4.6-4.1-2.3-4.1 2.3 1-4.6-3.4-3 4.6-.5z"/></svg>'
            };

            function buildDockMessageActions(message) {
                var actions = [];
                if (!message) return actions;
                if (message.__failed) {
                    // ★ 2026-09-25 修复（复审 P3-02）：__pendingFile 只活在当前页面内存里。
                    //   刷新页面后文件不可恢复，此时若还显示「重发」，用户点了才发现媒体发不出去
                    //   （会退化成只发文字）—— 那才是真的蠢。这里如实判断：
                    //   只有"文件还在"或"至少还有文字"时才给重发入口。
                    var acts = [];
                    var pendingText = (getDMMessageText(message) || '').trim();
                    if (message.__pendingFile || pendingText) acts.push({ id: 'resend', label: '重发' });
                    acts.push({ id: 'delete', label: '删除' });
                    return acts;
                }
                if (message.__optimistic) return actions;   // 发送中不给操作
                var payload = getDMMessagePayload(message) || {};
                var withdrawn = !!payload.withdrawn;
                var value = getDmActionValue(message);
                var sent = message.user_name === currentUser;
                var elapsed = Date.now() - new Date(message.created_at).getTime();
                var canWithdraw = sent && !withdrawn && !isNaN(elapsed) && elapsed <= 3 * 60 * 1000;
                var flash=!!(getDMMessagePayload(message)||{}).flash;
                if (!withdrawn&&!flash) {
                    actions.push({ id: 'reply', label: '回复' });
                    if (sent && !resolveDockChatMedia(message) && elapsed >= 0 && elapsed <= 15 * 60 * 1000) actions.push({ id: 'edit', label: '编辑' });
                }
                if (!withdrawn && value) actions.push({ id: 'copy', label: '复制' });
                if (canWithdraw) actions.push({ id: 'withdraw', label: '撤回' });
                if (!withdrawn && value&&!flash) actions.push({ id: 'forward', label: '转发' });
                if (value&&!flash) actions.push({ id: 'share', label: '分享' });
                // ★ 由 ux-features.js 的重复长按菜单迁移过来（那里已停用），保留"问小猫"这个能力
                if (!withdrawn && value&&!flash) actions.push({ id: 'ask-ai', label: '问小猫' });
                actions.push({ id: 'delete', label: '删除' });
                return actions;
            }

            var _dmActionSheet = null;
            var _dmForwardPicker = null;

            function onDmActionKeydown(e) {
                if (e.key === 'Escape') { e.preventDefault(); closeDockMessageActions(); closeDockForwardPicker(); }
            }

            function closeDockMessageActions() {
                if (!_dmActionSheet) return;
                window.__xtjResetDmPress?.();
                var sheet = _dmActionSheet;
                _dmActionSheet = null;
                if (sheet._dmCleanup) sheet._dmCleanup();
                sheet.style.pointerEvents = 'none'; sheet.inert=true;
                var card=sheet.querySelector('.dm-action-panel');
                if (card) card.style.transition='transform .14s ease, opacity .14s ease';
                try { sheet.classList.remove('active'); } catch (e) {}
                setTimeout(function() { try { if (sheet.parentNode) sheet.parentNode.removeChild(sheet); } catch (e) {} }, chatReducedMotion() ? 0 : 150);
                try { document.removeEventListener('keydown', onDmActionKeydown, true); } catch (e) {}
            }

            function closeDockForwardPicker() {
                if (!_dmForwardPicker) return;
                var el = _dmForwardPicker;
                _dmForwardPicker = null;
                el.style.pointerEvents='none'; el.inert=true;
                try { el.classList.remove('active'); } catch (e) {}
                setTimeout(function() { try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) {} }, 200);
                try { document.removeEventListener('keydown', onDmActionKeydown, true); } catch (e) {}
            }

            function copyTextToClipboard(text) {
                function legacyCopy(value) {
                    try {
                        var ta = document.createElement('textarea');
                        ta.value = value;
                        ta.setAttribute('readonly', '');
                        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
                        document.body.appendChild(ta);
                        ta.select();
                        ta.setSelectionRange(0, ta.value.length);
                        var ok = document.execCommand('copy');
                        document.body.removeChild(ta);
                        return !!ok;
                    } catch (e) { return false; }
                }
                if (!text) return Promise.resolve(false);
                if (navigator.clipboard && window.isSecureContext) {
                    return navigator.clipboard.writeText(text)
                        .then(function() { return true; })
                        .catch(function() { return legacyCopy(text); });
                }
                return Promise.resolve(legacyCopy(text));
            }

            function openDockMessageActions(rowEl) {
                var message = findDockMessageByRow(rowEl);
                if (!message) return;
                var actions = buildDockMessageActions(message);
                if (!actions.length) return;
                closeDockMessageActions();
                closeDockForwardPicker();

                var overlay = document.createElement('div');
                overlay.className = 'dm-action-overlay';
                var panel = document.createElement('div');
                panel.className = 'dm-action-panel';
                panel.setAttribute('role', 'group');
                panel.setAttribute('aria-label', '消息操作');

                var grid = document.createElement('div');
                grid.className = 'dm-action-grid';
                actions.forEach(function(action) {
                    var btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'dm-action-item';
                    btn.setAttribute('data-dm-action', action.id);
                    var icon = document.createElement('span');
                    icon.className = 'dm-action-icon';
                    icon.innerHTML = DM_ACTION_ICONS[action.id] || '';
                    var label = document.createElement('span');
                    label.className = 'dm-action-label';
                    label.textContent = action.label;
                    btn.appendChild(icon);
                    btn.appendChild(label);
                    btn.addEventListener('click', function(ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        runDockMessageAction(action.id, message);
                    });
                    grid.appendChild(btn);
                });
                panel.appendChild(grid);

                overlay.appendChild(panel);
                overlay.addEventListener('click', function(ev) { if (ev.target === overlay) closeDockMessageActions(); });
                document.body.appendChild(overlay);
                _dmActionSheet = overlay;
                var bubble = rowEl.classList && rowEl.classList.contains('chat-msg')
                    ? rowEl : rowEl.querySelector('.chat-msg');
                if (!bubble) bubble = rowEl;
                bubble.classList.add('is-actions-open');
                function positionPanel() {
                    if (_dmActionSheet !== overlay || !bubble.isConnected) { closeDockMessageActions(); return; }
                    var anchor = bubble.getBoundingClientRect();
                    var width = window.innerWidth;
                    var height = window.innerHeight;
                    // Transforms scale the visual rect during opening; use layout size for stable placement.
                    var surface = { width: panel.offsetWidth, height: panel.offsetHeight };
                    var margin = 10, gap = 12;
                    var left = Math.max(margin, Math.min(anchor.left + anchor.width / 2 - surface.width / 2, width - surface.width - margin));
                    var above = anchor.top >= surface.height + gap + margin;
                    var top = above ? anchor.top - surface.height - gap : anchor.bottom + gap;
                    top = Math.max(margin, Math.min(top, height - surface.height - margin));
                    panel.style.left = left + 'px';
                    panel.style.top = top + 'px';
                    panel.style.setProperty('--dm-tip-x', Math.max(18, Math.min(anchor.left + anchor.width / 2 - left, surface.width - 18)) + 'px');
                    panel.classList.toggle('is-below', !above);
                }
                positionPanel();
                // Two frames allow the browser to paint the collapsed surface before expanding it.
                requestAnimationFrame(function() { requestAnimationFrame(function() {
                    if (_dmActionSheet === overlay) overlay.classList.add('active');
                }); });
                function dismissOnScroll(ev) {
                    if (panel.contains(ev.target)) return;
                    // Programmatic scroll/focus during opening must not dismiss the menu.
                    // Keep it attached to its bubble; close only when that bubble leaves view.
                    var anchor=bubble.getBoundingClientRect();
                    if (!bubble.isConnected || anchor.bottom<=0 || anchor.top>=window.innerHeight) closeDockMessageActions();
                    else positionPanel();
                }
                window.addEventListener('resize', positionPanel);
                document.addEventListener('scroll', dismissOnScroll, true);
                overlay._dmCleanup = function() {
                    bubble.classList.remove('is-actions-open');
                    window.removeEventListener('resize', positionPanel);
                    document.removeEventListener('scroll', dismissOnScroll, true);
                };
                document.addEventListener('keydown', onDmActionKeydown, true);
            }
            function runDockMessageAction(actionId, message) {
                window.__xtjResetDmPress?.();
                closeDockMessageActions();
                if (['reply', 'edit', 'reaction', 'transcribe'].indexOf(actionId) >= 0) { runChatExtraAction(actionId, message); return; }
                if (actionId === 'copy') { doCopyDmMessage(message); return; }
                if (actionId === 'withdraw') { window.withdrawDMMessage(String(message.id || ''), null); return; }
                if (actionId === 'delete') { doDeleteDmMessage(message); return; }
                if (actionId === 'forward') { openDockForwardPicker(message); return; }
                if (actionId === 'share') { doShareDmMessage(message); return; }
                if (actionId === 'resend') { resendDmMessage(message); return; }
                if (actionId === 'ask-ai') { askAiAboutDmMessage(message); return; }
            }

            function doCopyDmMessage(message) {
                var value = getDmActionValue(message);
                if (!value) { showToast('这条消息没有可复制的内容'); return; }
                copyTextToClipboard(value).then(function(ok) {
                    showToast(ok ? '已复制' : '复制失败，请重试');
                });
            }

            function doDeleteDmMessage(message) {
                if (!message) return;
                var peer = dockChatActiveUser;
                if (!peer) return;
                markDmMessageLocallyDeleted(message);
                // 注意：不能用 removeDockChatCacheMessage(peer, undefined) —— 它按 __tempId
                //   匹配，传 undefined 会把所有"没有 __tempId"的服务端消息一起清掉。
                var targetId = String(message.id || message.__tempId || '');
                var cacheKey = getDockChatCacheKey(peer);
                var list = Array.isArray(_chatCache[cacheKey]) ? _chatCache[cacheKey] : [];
                _chatCache[cacheKey] = list.filter(function(m) {
                    return String((m && (m.id || m.__tempId)) || '') !== targetId;
                });
                _chatRenderSignature[peer] = undefined;
                renderDockMessages(peer, _chatCache[cacheKey], false);
                releaseDockChatLocalPreview(message);
                scheduleDockChatListRefresh(200);
                // ★ 2026-09-26：删除改为**账号级同步**。先本机立即生效（乐观），
                //   再把墓碑推给服务端；失败时排入待补传队列并在文案里如实说明，
                //   不再无脑显示"仅本机"。
                pushDmDeletedToServer([targetId]).then(function(ok) {
                    showToast(ok ? '已删除（已同步到账号）' : '已删除（本机生效，联网后自动同步）');
                });
            }

            // ★ 2026-09-25：从 ux-features.js 的重复长按菜单迁移过来的"问小猫"。
            //   原实现只对气泡取 innerText，这里改为取消息正文（含媒体时取链接）。
            // ★ 2026-09-25 修复「问小猫」：这个动作此前只是"打开小猫AI + 往输入框塞一段文字"，
            //   而且**塞错了元素**（找的是 #aiChatInput，而小猫AI 的输入框 id 是 #aiChatMsgInput），
            //   所以点下去实际只会跳到 AI 页面、什么都不会发生。
            //   现在：注入完整提示（图片/视频/音频带上链接）+ 直接触发发送，让小猫立刻开始思考回复。
            // ★ 2026-09-25 重写（两个真实缺陷）：
            //   ① 输入框里又出现一遍：旧逻辑是「发现输入框里没有提示词就重写」。
            //      但小猫AI 在**发送成功后本身会清空输入框** —— 于是下一个 tick 误判为"被冲掉"，
            //      又写回去；紧接着再点一次发送，触发小猫自己的防重（"已发送，请勿重复点击"），
            //      我的校验又因此认为没发出去，最后弹出"已填入内容，请手动点发送"。
            //      现在用 aiDispatched 标记：**一旦发出过，就绝不再注入**，只做校验。
            //   ② 图片只给链接：小猫的网页读取工具抓 supabase 公共地址返回 HTTP 400，
            //      而且它本来就没有解码视频/远端图片的能力。改为**把图片作为附件发给它**
            //      （小猫支持图片附件，能直接"看"）——抓取失败时才退回"给链接"。
            function askAiAboutDmMessage(message) {
                var text = (getDMMessageText(message) || '').trim();
                var media = resolveDockChatMedia(message);
                var mediaUrl = (media && media.src) ? String(media.src) : '';
                var isImage = !!(media && media.kind === 'image' && mediaUrl);
                if (!text && !mediaUrl) { showToast('这条消息没有可提问的内容'); return; }
                if (typeof window.__xtjOpenAiChat !== 'function') { showToast('请先打开小猫AI'); return; }

                var prompt = isImage ? '请帮我看看这张图片：' : '请帮我看看这条消息：';
                if (text) prompt += '\n' + text.slice(0, 800);
                if (mediaUrl && !isImage) {
                    var kindLabel = (media && media.kind === 'video') ? '视频' : ((media && media.kind === 'audio') ? '音频' : '媒体');
                    prompt += '\n（' + kindLabel + '链接：' + mediaUrl + '）';
                }

                window.__xtjOpenAiChat();

                var aiWaited = 0;
                var aiReadySince = 0;
                var aiDispatched = false;   // ★ 一旦发出过就不再注入
                var aiSentAt = 0;
                var aiRetries = 0;
                var aiAnchor = prompt.slice(0, 24);
                var aiAttached = false;

                // 等小猫AI 自己的初始化落定（它异步拉配置 + 载入历史，载入时会重写消息区；
                //   此前不等这一步，刚显示出来的消息会被那次重写冲掉）。
                function aiInitSettled() {
                    var cfg = null;
                    try {
                        cfg = (window.__xtjAiAgent && typeof window.__xtjAiAgent.getConfig === 'function')
                            ? window.__xtjAiAgent.getConfig()
                            : null;
                    } catch (e) { cfg = null; }
                    if (!cfg) { aiReadySince = 0; return false; }
                    if (!aiReadySince) { aiReadySince = Date.now(); return false; }
                    return (Date.now() - aiReadySince) >= 500;
                }

                // 把图片作为附件塞进小猫的附件管线（复用它的 change 处理，与手动选图完全同路径）
                function attachImageToAi() {
                    if (aiAttached || !isImage) return Promise.resolve(false);
                    aiAttached = true;
                    var fileInput = document.getElementById('aiChatFileInp');
                    if (!fileInput || typeof fetch !== 'function') return Promise.resolve(false);
                    return fetch(mediaUrl, { mode: 'cors', credentials: 'omit' })
                        .then(function(resp) { return resp.ok ? resp.blob() : null; })
                        .then(function(blob) {
                            if (!blob) return false;
                            var name = 'dm-' + Date.now() + '.png';
                            var file = null;
                            try { file = new File([blob], name, { type: blob.type || 'image/png' }); }
                            catch (e) { return false; }
                            var dt = new DataTransfer();
                            dt.items.add(file);
                            fileInput.files = dt.files;
                            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                            return true;
                        })
                        .catch(function() { return false; });
                }

                attachImageToAi().then(function(attachedOk) {
                    if (isImage && !attachedOk) {
                        // 附件注入失败（多为跨域）→ 退回把链接写进提示词，至少不是空手问
                        prompt += '\n（图片链接：' + mediaUrl + '）';
                        aiAnchor = prompt.slice(0, 24);
                    }

                    var aiTimer = setInterval(function() {
                        aiWaited += 150;
                        var input = document.getElementById('aiChatMsgInput') || document.getElementById('aiChatInput');
                        var sendBtn = document.getElementById('aiChatSendBtn');
                        var list = document.getElementById('aiChatMessages');
                        if (!input || !sendBtn) {
                            if (aiWaited >= 6000) {
                                clearInterval(aiTimer);
                                showToast('小猫AI 打开失败，请刷新后重试');
                            }
                            return;
                        }
                        if (!aiInitSettled()) {
                            if (aiWaited >= 10000) {
                                clearInterval(aiTimer);
                                showToast('小猫AI 初始化超时，请重试');
                            }
                            return;
                        }

                        // ① 注入（只在首次发送之前；发出后 AI 会清空输入框，绝不能再写回去）
                        if (!aiDispatched) {
                            if (String(input.value || '').indexOf(aiAnchor) < 0) {
                                var existing = String(input.value || '');
                                input.value = existing.trim() ? (existing.replace(/\s+$/, '') + '\n' + prompt) : prompt;
                                try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
                                return;
                            }
                            aiDispatched = true;
                            aiSentAt = aiWaited;
                            try { sendBtn.click(); } catch (e2) {}
                            return;
                        }

                        // ② 已发出：只校验，不再动输入框
                        if (aiWaited - aiSentAt < 900) return;
                        var produced = false;
                        try {
                            produced = !!(list && list.querySelector('.ai-msg.user, .ai-msg--user, .ai-msg'));
                        } catch (eChk) { produced = false; }
                        if (produced) { clearInterval(aiTimer); return; }
                        if (aiRetries < 1) {
                            aiRetries += 1;
                            aiSentAt = aiWaited;
                            // 重试前确认输入框真的还有内容，避免空点
                            if (String(input.value || '').trim()) {
                                try { sendBtn.click(); } catch (eRe) {}
                            } else {
                                clearInterval(aiTimer);
                                showToast('已发送，但未确认到小猫的回复，请查看对话');
                            }
                            return;
                        }
                        clearInterval(aiTimer);
                        showToast('已发送，但未确认到小猫的回复，请查看对话');
                    }, 150);
                });
            }
            async function doShareDmMessage(message) {
                var value = getDmActionValue(message);
                if (!value) { showToast('这条消息没有可分享的内容'); return; }
                if (navigator.share) {
                    try { await navigator.share({ text: value }); return; }
                    catch (e) { if (e && e.name === 'AbortError') return; }
                }
                var ok = await copyTextToClipboard(value);
                showToast(ok ? '内容已复制，可粘贴分享' : '分享失败，请重试');
            }

            function openDockForwardPicker(message) {
                var value = getDmActionValue(message);
                if (!value) { showToast('这条消息没有可转发的内容'); return; }
                var names = [];
                Array.prototype.forEach.call(document.querySelectorAll('#dockChatList .chat-list-item[data-chat-user]'), function(node) {
                    var n = node.getAttribute('data-chat-user');
                    if (n && n !== currentUser && names.indexOf(n) < 0) names.push(n);
                });
                if (!names.length) { showToast('暂无可转发的会话（先和对方聊过天才会出现在列表里）'); return; }

                closeDockForwardPicker();
                var overlay = document.createElement('div');
                overlay.className = 'dm-action-overlay dm-forward-overlay';
                var panel = document.createElement('div');
                panel.className = 'dm-action-panel dm-forward-panel';
                panel.setAttribute('role', 'dialog');
                panel.setAttribute('aria-modal', 'true');
                panel.setAttribute('aria-label', '转发到');
                var title = document.createElement('div');
                title.className = 'dm-forward-title';
                title.textContent = '转发到';
                panel.appendChild(title);
                var list = document.createElement('div');
                list.className = 'dm-forward-list';
                names.forEach(function(name) {
                    var row = document.createElement('button');
                    row.type = 'button';
                    row.className = 'dm-forward-item';
                    var av = document.createElement('span');
                    av.className = 'dm-forward-avatar';
                    av.innerHTML = getDockChatAvatarMarkup(name);
                    var nm = document.createElement('span');
                    nm.className = 'dm-forward-name';
                    nm.textContent = name;
                    row.appendChild(av);
                    row.appendChild(nm);
                    row.addEventListener('click', function(ev) {
                        ev.preventDefault(); ev.stopPropagation();
                        closeDockForwardPicker();
                        forwardDmMessage(value, name);
                    });
                    list.appendChild(row);
                });
                panel.appendChild(list);
                var cancelBtn = document.createElement('button');
                cancelBtn.type = 'button';
                cancelBtn.className = 'dm-action-cancel';
                cancelBtn.textContent = '取消';
                cancelBtn.addEventListener('click', function(ev) {
                    ev.preventDefault(); ev.stopPropagation(); closeDockForwardPicker();
                });
                panel.appendChild(cancelBtn);
                overlay.appendChild(panel);
                overlay.addEventListener('click', function(ev) { if (ev.target === overlay) closeDockForwardPicker(); });
                document.body.appendChild(overlay);
                _dmForwardPicker = overlay;
                requestAnimationFrame(function() { try { overlay.classList.add('active'); } catch (e) {} });
                document.addEventListener('keydown', onDmActionKeydown, true);
            }

            async function forwardDmMessage(value, targetUser) {
                if (!value || !targetUser) return;
                var owner=currentUser,epoch=_authStateEpoch;
                try {
                    var resp = await window.xtjProtectedFetch('/api/dm/send', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ target_user: targetUser, content: value }),
                        timeoutMs: 60000,authOwner:owner,authEpoch:epoch
                    });
                    var data = await resp.json().catch(function() { return {}; });
                    if(owner!==currentUser || epoch!==_authStateEpoch)return;
                    if (!resp.ok || !data || !data.ok) {
                        throw new Error((data && data.error) || ('HTTP ' + resp.status));
                    }
                    showToast('已转发给 ' + targetUser);
                    scheduleDockChatListRefresh(200);
                    if (dockChatActiveUser === targetUser && data.message) {
                        replaceDockChatCacheMessage(targetUser, null, Object.assign({},data.message,{__committedRevision:++_chatCommittedRevision}));
                        loadDockChatMessages(targetUser, false, true);
                    }
                } catch (e) {
                    if(owner!==currentUser || epoch!==_authStateEpoch)return;
                    showToast('转发失败：' + ((e && e.message) || '未知错误'));
                }
            }

            async function resendDmMessage(message) {
                if (!message || !message.__failed) return;
                var owner=currentUser,epoch=_authStateEpoch;
                var peer = dockChatActiveUser;
                if (!peer) return;
                var file = message.__pendingFile || null;
                var text = (getDMMessageText(message) || '').trim();
                if (!file && !text) { showToast('这条消息没有可重发的内容'); return; }
                // ★ 2026-09-27 修复（审计 S8：重发先毁旧气泡，失败即彻底丢失）：
                //   此前流程是「先把失败气泡从缓存删掉并重渲染 → 释放本地 blob → 再交给
                //   sendDockChatMessage 重新走一遍」。中间有多个**可失败**环节：
                //     · `new DataTransfer()` 在部分浏览器/无 File 构造环境下抛错 → 走
                //       `fileInput.value = ''`，媒体文件**已随 blob 释放而永久消失**；
                //     · sendDockChatMessage 开头的 `dockChatSending` 防抖命中（调用方恰好是
                //       在发送中长按重发）→ 直接 return，而旧气泡已经被删掉了；
                //     · `isUserMuted()` / 50MB 体积 / 类型校验任一不通过 → 同样只 return。
                //   这些情况下用户得到的是"消息没了、也没有提示"，比失败气泡还糟。
                //   现在改为**事务式重发**：先做完所有前置校验与文件准备，把旧失败项留在
                //   缓存里；只有当新一轮乐观气泡确定已入队成功后，才移除旧的失败项。
                //   任一步骤失败 → 旧气泡原样保留，用户可再试。
                if (dockChatSending) { showToast('上一条消息正在发送，请稍候再重发'); return; }
                if (isUserMuted()) { showToast('您已被禁言，无法发送消息'); return; }
                if (!window.currentUser) { showToast('请先登录'); return; }

                var targetId = String(message.id || message.__tempId || '');
                var cacheKey = getDockChatCacheKey(peer);
                var fileInput = document.getElementById('dockChatFileInp');
                var inp = document.getElementById('dockChatInput');
                // —— 阶段一：准备（可能失败，此时不改动任何缓存/DOM）——
                var stagedFileOk = true;
                var preList = Array.isArray(_chatCache[cacheKey]) ? _chatCache[cacheKey].slice() : [];
                var preSignature = _chatRenderSignature[peer];
                var preInputValue = (inp && typeof inp.value === 'string') ? inp.value : undefined;
                var preFileList = fileInput ? fileInput.files : null;
                try {
                    if (file && fileInput) {
                        var dt = new DataTransfer();
                        dt.items.add(file);
                        fileInput.files = dt.files;
                    }
                    if (inp && text) inp.value = text;
                    _chatReplyDraft = (getDMMessagePayload(message) || {}).reply_to || null;
                } catch (eStage) {
                    stagedFileOk = false;
                    try { if (fileInput) fileInput.value = ''; } catch (eStage2) {}
                    if (inp && typeof preInputValue === 'string') inp.value = preInputValue;
                }
                if (!stagedFileOk && file) {
                    // 文件无法回填到 fileInput → 无法重发媒体。保留旧失败气泡，明确告知。
                    _chatRenderSignature[peer] = preSignature;
                    showToast('无法准备原文件，重发未执行（气泡已保留，可清理后重新选择文件发送）');
                    return;
                }
                // —— 阶段二：发起新一轮发送 ——
                await sendDockChatMessageSingle(file,text,{clientMessageId:message.__clientMessageId || message.__tempId || message.id});
                if(owner!==currentUser || epoch!==_authStateEpoch || peer!==dockChatActiveUser)return;
                // —— 阶段三：确认新气泡已入队，才移除旧失败项 ——
                //   判据：缓存里出现了 targetId 以外的新项（乐观气泡的 tempId 必然是新的）。
                var postList = Array.isArray(_chatCache[cacheKey]) ? _chatCache[cacheKey] : [];
                var hasNewItem = postList.some(function(m) {
                    var id = String((m && (m.id || m.__tempId)) || '');
                    return id && id !== targetId && !preList.some(function(old){return String(old.id || old.__tempId || '')===id;});
                });
                if (!hasNewItem) {
                    // 新一轮根本没起来（例如内容被清空/被防抖拦下）→ 保留旧失败气泡
                    _chatCache[cacheKey] = preList;
                    _chatRenderSignature[peer] = undefined;
                    renderDockMessages(peer, _chatCache[cacheKey], false);
                    if (inp && typeof preInputValue === 'string') inp.value = preInputValue;
                    if (preFileList && fileInput) { try { fileInput.files = preFileList; } catch (eRestore) {} }
                    return;
                }
                _chatCache[cacheKey] = postList.filter(function(m) {
                    return String((m && (m.id || m.__tempId)) || '') !== targetId;
                });
                _chatRenderSignature[peer] = undefined;
                renderDockMessages(peer, _chatCache[cacheKey], false);
                releaseDockChatLocalPreview(message);
            }

            // Search uses server keyset pagination; message actions use the same
            // authenticated boundary as sending. State is tied to account + peer.
            var _chatSearchSeq = 0, _chatSearchCursor = null, _chatSearchMore = false, _chatSearchCriteria = '';
            var _chatHistoryFocus = '', _chatHistoryAnchor = '', _chatHistoryRefreshSeq = 0, _chatReplyDraft = null, _chatEditDraft = null;
            var _chatRecordedFile = null, _chatVoice = null, _chatVoiceSeq = 0;
            var _chatSearchMode='messages';
            var _chatReactionTimer = null, _chatReactionSeq = 0, _chatShowArchived = false;
            var _supportAuthor='xxz', _supportOwner='', _supportConfigPending=null, _supportDialogSeq=0, _supportCache=null, _supportCacheAt=0, _supportImages=new Map();
            function closeAuthorSupport() {
                _supportDialogSeq++;_supportCache=null;_supportOwner='';_supportImages.clear();var preview=document.getElementById('supportCodePreview');if(preview&&preview.open)preview.close();
                var codes=document.getElementById('authorSupportCodes');if(codes)codes.replaceChildren();
                var dialog=document.getElementById('authorSupportDialog');
                if (dialog && dialog.open) dialog.close();
                var button=document.getElementById('authorSupportButton');
                if (button) button.hidden=true;
            }
            function syncAuthorSupportButton(peer) {
                var button=document.getElementById('authorSupportButton');
                if (!button) return;
                button.hidden=!window.currentUser || peer!==_supportAuthor || window.currentUser===_supportAuthor;
                if(peer!==_supportAuthor||_supportOwner===window.currentUser||_supportConfigPending||!window.currentUser)return;
                var owner=window.currentUser;
                _supportConfigPending=chatFeatureApi('author-support').then(function(config){
                    if (window.currentUser!==owner) return;
                    _supportOwner=owner; _supportAuthor=config.author || 'xxz';cacheSupportConfig(config,owner);
                    button.hidden=dockChatActiveUser!==_supportAuthor || owner===_supportAuthor;
                }).catch(function(){}).finally(function(){_supportConfigPending=null;});
            }
            function cacheSupportConfig(config,owner){
                if(owner!==window.currentUser)return;_supportCache=config;_supportCacheAt=Date.now();_supportOwner=owner;
                ['wechat','alipay'].forEach(function(provider){var url=sanitizeUrl(config[provider+'_url']||'');if(!/^https:\/\//i.test(url)||_supportImages.has(url))return;var image=new Image();image.decoding='async';image.src=url;_supportImages.set(url,image);});
                if(_supportImages.size>4){var keep=[config.wechat_url,config.alipay_url];for(var url of _supportImages.keys())if(keep.indexOf(url)<0)_supportImages.delete(url);}
            }
            function paintSupportCodes(config,codes){
                codes.replaceChildren();['wechat','alipay'].forEach(function(provider){
                    var card=document.createElement('section'),name=document.createElement('h4');name.textContent=provider==='wechat'?'微信':'支付宝';card.appendChild(name);
                    var url=sanitizeUrl(config[provider+'_url']||'');
                    if(url&&/^https:\/\//i.test(url)){
                        var button=document.createElement('button');button.type='button';button.className='author-support-image-button';button.setAttribute('aria-label','全屏查看'+name.textContent+'收款码');
                        var image=document.createElement('img');image.src=url;image.alt=name.textContent+'收款码';image.decoding='async';button.appendChild(image);card.appendChild(button);
                        button.onclick=function(){openSupportCodePreview(url,image.alt,button);};
                        image.onerror=function(){button.hidden=true;var message=document.createElement('p');message.textContent='收款码暂时无法显示，请稍后重试';card.appendChild(message);};
                    }else{var empty=document.createElement('p');empty.className='author-support-empty';empty.textContent='作者暂未设置'+name.textContent+'收款码';card.appendChild(empty);}
                    codes.appendChild(card);
                });document.getElementById('authorSupportDisclaimer').textContent=config.disclaimer||'';
            }
            function openSupportCodePreview(url,label,opener){
                var dialog=document.getElementById('supportCodePreview');if(!dialog){
                    dialog=document.createElement('dialog');dialog.id='supportCodePreview';dialog.className='support-code-preview';dialog.setAttribute('aria-label','收款码全屏预览');
                    var close=document.createElement('button');close.type='button';close.className='support-code-close';close.setAttribute('aria-label','关闭收款码预览');close.textContent='×';close.onclick=function(){dialog.close();};
                    var stage=document.createElement('div');stage.className='support-code-stage';var image=document.createElement('img');image.draggable=false;stage.appendChild(image);dialog.append(close,stage);document.body.appendChild(dialog);
                    var scale=1,panX=0,panY=0,pointers=new Map(),distance=0,base=1;
                    function reset(){scale=1;panX=panY=0;pointers.clear();distance=0;image.style.transform='';stage.scrollTop=stage.scrollLeft=0;}
                    function zoom(value){scale=Math.max(1,Math.min(4,value));var r=stage.getBoundingClientRect();panX=Math.max(-r.width*(scale-1)/2,Math.min(r.width*(scale-1)/2,panX));panY=Math.max(-r.height*(scale-1)/2,Math.min(r.height*(scale-1)/2,panY));image.style.transform='translate3d('+panX+'px,'+panY+'px,0) scale('+scale+')';}
                    stage.addEventListener('dblclick',function(){zoom(scale===1?2:1);});
                    stage.addEventListener('pointerdown',function(e){pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});stage.setPointerCapture(e.pointerId);if(pointers.size===2){var a=[...pointers.values()];distance=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);base=scale;}});
                    stage.addEventListener('pointermove',function(e){if(!pointers.has(e.pointerId))return;var previous=pointers.get(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===1&&scale>1){panX+=e.clientX-previous.x;panY+=e.clientY-previous.y;zoom(scale);}if(pointers.size===2&&distance){var a=[...pointers.values()];zoom(base*Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)/distance);}});
                    function end(e){pointers.delete(e.pointerId);distance=0;}stage.addEventListener('pointerup',end);stage.addEventListener('pointercancel',end);stage.addEventListener('lostpointercapture',end);
                    dialog.addEventListener('close',function(){reset();if(dialog._opener&&dialog._opener.isConnected)dialog._opener.focus();});dialog._reset=reset;
                }
                dialog._reset();dialog._opener=opener;var img=dialog.querySelector('img');img.src=url;img.alt=label;if(!dialog.open)dialog.showModal();
            }
            async function openAuthorSupport(){
                if(!window.currentUser||dockChatActiveUser!==_supportAuthor||window.currentUser===_supportAuthor)return;
                var dialog=document.getElementById('authorSupportDialog'),codes=document.getElementById('authorSupportCodes'),owner=window.currentUser,seq=++_supportDialogSeq;
                var cached=_supportOwner===owner&&_supportCache&&Date.now()-_supportCacheAt<300000;
                codes.replaceChildren();if(cached)paintSupportCodes(_supportCache,codes);else{var loading=document.createElement('p');loading.textContent='正在加载收款码…';codes.appendChild(loading);document.getElementById('authorSupportDisclaimer').textContent='';}
                if(!dialog.open)dialog.showModal();
                try{var config=await chatFeatureApi('author-support');if(seq!==_supportDialogSeq||owner!==window.currentUser||!dialog.open)return;
                    var changed=!cached||config.wechat_url!==_supportCache.wechat_url||config.alipay_url!==_supportCache.alipay_url;cacheSupportConfig(config,owner);if(changed)paintSupportCodes(config,codes);
                }catch(error){if(seq!==_supportDialogSeq||owner!==window.currentUser||!dialog.open||cached)return;codes.replaceChildren();var message=document.createElement('p');message.textContent=error.message||'收款码加载失败';codes.appendChild(message);var retry=document.createElement('button');retry.type='button';retry.textContent='重新加载';retry.onclick=openAuthorSupport;codes.appendChild(retry);}
            }
            var _supportButton=document.getElementById('authorSupportButton'), _supportDialog=document.getElementById('authorSupportDialog');
            if (_supportButton) _supportButton.addEventListener('click',openAuthorSupport);
            if (_supportDialog) {
                document.getElementById('authorSupportClose').addEventListener('click',function(){_supportDialog.close();});
                _supportDialog.addEventListener('close',function(){_supportDialogSeq++;if (_supportButton && !_supportButton.hidden) _supportButton.focus();});
                _supportDialog.addEventListener('click',function(event){var rect=_supportDialog.getBoundingClientRect();if(event.target===_supportDialog && (event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom)) _supportDialog.close();});
            }

            async function chatFeatureApi(path, body) {
                var response = await window.xtjProtectedFetch('/api/chat/' + path, body ? {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body), timeoutMs: 30000
                } : { timeoutMs: 20000 });
                var result = await response.json();
                if (!response.ok || !result.ok) { var error = new Error(result.error || '操作失败，请重试'); error.status = response.status; throw error; }
                return result;
            }
            function closeChatHistory() {
                _chatSearchSeq++;
                var panel = document.getElementById('chatHistoryPanel');
                if (panel) transitionChatSurface(panel,false,false,panel);
            }
            function openChatHistory(media) {
                if (!window.currentUser) { showToast('请先登录'); return; }
                var panel = document.getElementById('chatHistoryPanel');
                transitionChatSurface(panel,true,false,panel);
                setChatSearchMode(media ? 'messages' : 'users');
                document.getElementById('chatSearchTabs').hidden=!!media;
                document.getElementById('chatHistoryKind').value = media ? 'media' : 'all';
                var scope = document.getElementById('chatHistoryScope');
                scope.options[0].disabled = !dockChatActiveUser;
                scope.value = dockChatActiveUser ? 'current' : 'global';
                document.getElementById('chatHistoryQuery').value = '';
                document.getElementById('chatHistoryResults').replaceChildren();
                document.getElementById('chatHistoryStatus').textContent = media ? '正在加载媒体…' : '输入账号，找到想联系的人';
                document.getElementById('chatHistoryMore').hidden = true;
                if (media) runChatHistorySearch(false); else document.getElementById('chatHistoryQuery').focus();
            }
            function setChatSearchMode(mode) {
                _chatSearchSeq++; _chatSearchMode=mode; _chatSearchCursor=null;
                document.getElementById('chatHistoryResults').replaceChildren();
                document.getElementById('chatHistoryMore').hidden=true;
                document.querySelector('#chatHistoryForm .chat-history-filters').hidden=mode==='users';
                document.getElementById('chatHistoryQuery').placeholder=mode==='users' ? '搜索注册用户的账号' : '搜索文字、转写或文件名';
                document.getElementById('chatHistoryStatus').textContent=mode==='users' ? '输入至少两个字搜索账号' : '输入至少两个字搜索消息';
                document.querySelectorAll('[data-chat-search-mode]').forEach(function(button) { button.setAttribute('aria-selected',String(button.dataset.chatSearchMode===mode)); });
            }
            async function searchChatAccounts() {
                var q=document.getElementById('chatHistoryQuery').value.trim(), status=document.getElementById('chatHistoryStatus');
                if (q.length<2) { status.textContent='请输入至少两个字'; return; }
                var seq=++_chatSearchSeq, owner=window.currentUser;
                status.textContent='正在搜索账号…';
                try {
                    var result=await requestDockChatSocial('/users/search?q='+encodeURIComponent(q));
                    if (seq!==_chatSearchSeq || owner!==window.currentUser || _chatSearchMode!=='users') return;
                    var list=document.getElementById('chatHistoryResults'); list.replaceChildren();
                    (result.users || []).forEach(function(user) {
                        var name=String(user.user_name || ''); if (!name) return;
                        var button=document.createElement('button'); button.type='button'; button.className='chat-account-result';
                        var icon=document.createElement('span'); icon.className='chat-account-avatar'; icon.textContent=name.slice(0,1).toUpperCase();
                        var label=document.createElement('strong'); label.textContent=name;
                        var hint=document.createElement('span'); hint.textContent='查看与添加';
                        button.append(icon,label,hint); button.onclick=function() { _dockChatSocialQuery=name; closeChatHistory(); openDockChatSocialSheet('search'); }; list.appendChild(button);
                    });
                    status.textContent=list.children.length ? '找到 '+list.children.length+' 个账号' : '没有匹配的账号';
                } catch(error) { if (seq===_chatSearchSeq) status.textContent=error.message; }
            }
            async function runChatHistorySearch(more) {
                if (_chatSearchMode==='users') { searchChatAccounts(); return; }
                var owner = window.currentUser, peer = document.getElementById('chatHistoryScope').value === 'current' ? dockChatActiveUser : null;
                var q = document.getElementById('chatHistoryQuery').value.trim(), kind = document.getElementById('chatHistoryKind').value;
                if (kind === 'all' && q.length < 2) { document.getElementById('chatHistoryStatus').textContent = '请输入至少两个字'; return; }
                if (!more) { _chatSearchCursor = null; document.getElementById('chatHistoryResults').replaceChildren(); }
                var seq = ++_chatSearchSeq, status = document.getElementById('chatHistoryStatus'), button = document.getElementById('chatHistoryMore');
                var params = new URLSearchParams({ q: q, kind: kind, limit: '30' });
                if (peer) params.set('peer', peer);
                ['from', 'to'].forEach(function(key) { var v = document.getElementById('chatHistory' + (key === 'from' ? 'From' : 'To')).value; if (v) params.set(key, v); });
                var criteria = params.toString();
                if (more && criteria !== _chatSearchCriteria) { more = false; _chatSearchCursor = null; document.getElementById('chatHistoryResults').replaceChildren(); }
                _chatSearchCriteria = criteria;
                if (more && _chatSearchCursor) { params.set('cursor_at', _chatSearchCursor.at); params.set('cursor_id', _chatSearchCursor.id); }
                status.textContent = '正在加载…'; button.disabled = true;
                try {
                    var result = await chatFeatureApi('history/search?' + params.toString());
                    if (seq !== _chatSearchSeq || owner !== window.currentUser) return;
                    var list = document.getElementById('chatHistoryResults');
                    result.items.forEach(function(item) {
                        var row = document.createElement('article'); row.className = 'chat-history-result';
                        var jump = document.createElement('button'); jump.type = 'button'; jump.className = 'chat-history-jump';
                        var heading = document.createElement('strong'); heading.textContent = (item.peer_name || '') + ' · ' + (item.sender_name || '');
                        var excerpt = document.createElement('span'); excerpt.textContent = (item.payload && item.payload.transcript && q && !String(item.body || '').includes(q) ? item.payload.transcript : item.body) || (item.payload && item.payload.media && item.payload.media.name) || '[' + ({ image: '图片', video: '视频', audio: '语音', file: '文件' }[item.message_type] || '消息') + ']';
                        var time = document.createElement('time'); time.textContent = new Date(item.sent_at).toLocaleString();
                        jump.append(heading, excerpt, time); jump.addEventListener('click', function() { jumpChatHistory(item.peer_name, item.message_id); }); row.appendChild(jump);
                        var media = item.payload && item.payload.media;
                        var safe = media && sanitizeUrl(media.url);
                        if (safe && /^https?:\/\//i.test(safe)) {
                            if (media.kind === 'image') { var thumb = document.createElement('img'); thumb.src = safe; thumb.alt = '聊天图片'; thumb.loading = 'lazy'; row.appendChild(thumb); }
                            var link = document.createElement('a'); link.href = safe; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = media.name || '打开附件'; row.appendChild(link);
                        } else {
                            var urls = String(item.body || '').match(/https?:\/\/[^\s<>"']+/g) || [];
                            urls.slice(0, 3).forEach(function(url) { var href = sanitizeUrl(url); if (!href) return; var a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = url; row.appendChild(a); });
                        }
                        list.appendChild(row);
                    });
                    _chatSearchMore = result.has_more;
                    _chatSearchCursor = result.next_cursor_at && result.next_cursor_id ? { at: result.next_cursor_at, id: result.next_cursor_id } : null;
                    button.hidden = !_chatSearchMore; status.textContent = list.children.length ? '已加载 ' + list.children.length + ' 条' : '没有匹配的消息';
                } catch (error) { if (seq === _chatSearchSeq) status.textContent = error.message; }
                finally { if (seq === _chatSearchSeq) button.disabled = false; }
            }
            async function jumpChatHistory(peer, id) {
                var owner = window.currentUser;
                closeChatHistory(); window.openChat(peer);
                try {
                    var result = await chatFeatureApi('history/context?peer=' + encodeURIComponent(peer) + '&message_id=' + encodeURIComponent(id));
                    if (owner !== window.currentUser || dockChatActiveUser !== peer) return;
                    _dockChatLoadSeq++; _chatHistoryRefreshSeq++; _chatHistoryFocus = peer; _chatHistoryAnchor = result.focus_id;
                    _chatCache[getDockChatCacheKey(peer)] = result.data;
                    _chatRenderSignature[peer] = undefined; renderDockMessages(peer, result.data, false);
                    requestAnimationFrame(function() {
                        var row = document.querySelector('#dockChatMessages [data-message-id="' + result.focus_id + '"]');
                        if (row) { row.scrollIntoView({ block: 'center', behavior: 'auto' }); row.classList.add('chat-search-focus'); setTimeout(function() { row.classList.remove('chat-search-focus'); }, 1800); }
                        setDockChatJumpLatestVisible(true);
                    });
                } catch (error) { if (owner === window.currentUser) showToast(error.message); }
            }
            function clearChatMessageDraft() {
                _chatReplyDraft = null; _chatEditDraft = null;
                var preview = document.getElementById('chatMessageContext'); if (preview) preview.hidden = true;
            }
            function showChatMessageDraft(title, text) {
                var preview = document.getElementById('chatMessageContext');
                preview.hidden = false; preview.querySelector('span').textContent = title + ' · ' + (text || '[附件]');
                document.getElementById('dockChatInput').focus();
            }
            async function runChatExtraAction(action, message) {
                var peer = dockChatActiveUser, owner = window.currentUser;
                if (action === 'transcribe') {
                    var existing = (getDMMessagePayload(message) || {}).transcript;
                    if (existing) { showToast(existing); return; }
                    try { var job = await chatFeatureApi('messages/transcribe', { peer: peer, message_id: message.id });
                        if (owner === window.currentUser && peer === dockChatActiveUser) showToast(job.status === 'completed' ? '转写已完成，请刷新会话查看' : '正在后台转写，完成后自动同步');
                    } catch (error) { if (owner === window.currentUser) showToast(error.message); }
                } else if (action === 'reply') {
                    // Immediate draft retains the quote even when Send precedes the validation response.
                    // The send endpoint independently validates visibility and replaces the quote canonically.
                    var draft={id:String(message.id || ''),sender_name:String(message.user_name || ''),text:getDMMessageText(message) || '[附件]'};
                    _chatEditDraft=null;_chatReplyDraft=draft;showChatMessageDraft('回复 '+draft.sender_name,draft.text);
                    try {
                        var result = await chatFeatureApi('messages/reply/validate', { peer: peer, message_id: message.id });
                        if (owner !== window.currentUser || peer !== dockChatActiveUser || _chatReplyDraft!==draft) return;
                        Object.assign(draft,result.reply_to);
                        showChatMessageDraft('回复 ' + draft.sender_name, draft.text);
                    } catch (error) {
                        if(owner===window.currentUser && peer===dockChatActiveUser && _chatReplyDraft===draft){clearChatMessageDraft();showToast(error.message);}
                    }
                } else if (action === 'edit') {
                    _chatReplyDraft = null; _chatEditDraft = { id: message.id, peer: peer, owner: owner };
                    document.getElementById('dockChatInput').value = getDMMessageText(message);
                    showChatMessageDraft('编辑消息', getDMMessageText(message));
                } else if (action === 'reaction') {
                    var panel = document.createElement('div'); panel.className = 'chat-reaction-picker';
                    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '选择回应');
                    ['❤️', '👍', '😂', '😮', '😢', '🔥'].forEach(function(emoji) {
                        var button = document.createElement('button'); button.type = 'button'; button.textContent = emoji; button.setAttribute('aria-label', emoji);
                        button.onclick = function() { panel.remove(); setChatReaction(peer, message.id, emoji); }; panel.appendChild(button);
                    });
                    var close = document.createElement('button'); close.type = 'button'; close.textContent = '取消'; close.onclick = function() { panel.remove(); }; panel.appendChild(close);
                    document.getElementById('panelChat').appendChild(panel);
                    panel.addEventListener('keydown', function(event) { if (event.key === 'Escape') panel.remove(); });
                    panel.querySelector('button').focus();
                }
            }
            async function sendChatEditedMessage(text) {
                var draft = _chatEditDraft;
                if (!draft || draft.owner !== window.currentUser || draft.peer !== dockChatActiveUser) return;
                if (!text) { showToast('编辑内容不能为空'); return; }
                if (dockChatSending) return;
                dockChatSending = true;
                try {
                    var result = await chatFeatureApi('messages/edit', { peer: draft.peer, message_id: draft.id, text: text });
                    if (draft.owner !== window.currentUser || draft.peer !== dockChatActiveUser) return;
                    replaceDockChatCacheMessage(draft.peer, draft.id, result.message);
                    _chatRenderSignature[draft.peer] = undefined; renderDockMessages(draft.peer, _chatCache[getDockChatCacheKey(draft.peer)] || [], false);
                    clearChatMessageDraft(); document.getElementById('dockChatInput').value = ''; showToast('已编辑');
                } catch (error) { showToast(error.message); } finally { dockChatSending = false; }
            }
            async function setChatReaction(peer, id, emoji) {
                var owner = window.currentUser;
                try { await chatFeatureApi('messages/reactions', { peer: peer, message_id: id, emoji: emoji }); if (owner === window.currentUser && peer === dockChatActiveUser) scheduleChatReactions(); }
                catch (error) { showToast(error.message); }
            }
            function scheduleChatReactions() {
                clearTimeout(_chatReactionTimer);
                _chatReactionTimer = setTimeout(async function() {
                    var seq = ++_chatReactionSeq, owner = window.currentUser, peer = dockChatActiveUser;
                    if (!owner || !peer) return;
                    var rows = Array.from(document.querySelectorAll('#dockChatMessages [data-message-id]'));
                    var ids = rows.map(function(row) { return row.dataset.messageId; }).filter(function(id) { return /^[0-9a-f-]{36}$/i.test(id); });
                    ids = Array.from(new Set(ids));
                    try {
                        var items = {};
                        for (var i = 0; i < ids.length; i += 80) {
                            var result = await chatFeatureApi('messages/reactions?peer=' + encodeURIComponent(peer) + '&ids=' + ids.slice(i, i + 80).join(','));
                            Object.assign(items, result.items);
                        }
                        if (seq !== _chatReactionSeq || owner !== window.currentUser || peer !== dockChatActiveUser) return;
                        rows.forEach(function(row) {
                            var old = row.querySelector('.chat-message-reactions'); if (old) old.remove();
                            if (!items[row.dataset.messageId]) return;
                            var chips = document.createElement('div'); chips.className = 'chat-message-reactions';
                            items[row.dataset.messageId].forEach(function(item) {
                                var button = document.createElement('button'); button.type = 'button'; button.textContent = item.emoji + ' ' + item.count;
                                button.classList.toggle('mine', item.mine); button.setAttribute('aria-pressed', String(item.mine));
                                button.onclick = function() { setChatReaction(peer, row.dataset.messageId, item.mine ? '' : item.emoji); }; chips.appendChild(button);
                            });
                            var bubble = row.querySelector('.chat-msg'); if (bubble) bubble.appendChild(chips);
                        });
                    } catch (_) { /* A failed summary read does not replace chat content. */ }
                }, 180);
            }
            window.__xtjRefreshChatMessageExtras = function(payload) {
                var peer = dockChatActiveUser, owner = window.currentUser;
                if (!peer || !owner || (payload.peer && payload.peer !== peer)) return;
                if (payload.kind === 'reaction') { scheduleChatReactions(); return; }
                if (['clear','delete'].indexOf(payload.kind) >= 0) {
                    _chatHistoryFocus = ''; _chatHistoryRefreshSeq++;
                    forgetDockChatConversationMessages(peer); renderDockMessages(peer,[],false);
                    if (payload.kind === 'delete') dockChatGoBack(); else loadDockChatMessages(peer,false);
                    return;
                }
                if (_chatHistoryFocus !== peer || ['edit','transcript','withdraw','delete_message','read','mark_read','refresh','reconnect','sent'].indexOf(payload.kind) < 0) return;
                var key = getDockChatCacheKey(peer), cached = _chatCache[key] || [];
                var anchors = [_chatHistoryAnchor,cached[0] && cached[0].id,cached[cached.length-1] && cached[cached.length-1].id].filter(Boolean);
                var seq = ++_chatHistoryRefreshSeq;
                (async function() {
                    for (var i=0;i<anchors.length;i++) {
                        try {
                            var result = await chatFeatureApi('history/context?peer=' + encodeURIComponent(peer) + '&message_id=' + encodeURIComponent(anchors[i]));
                            if (seq !== _chatHistoryRefreshSeq || owner !== window.currentUser || dockChatActiveUser !== peer || _chatHistoryFocus !== peer) return;
                            _chatCache[key] = result.data; _chatHistoryAnchor = result.focus_id;
                            _chatRenderSignature[peer] = undefined; renderDockMessages(peer,result.data,false); return;
                        } catch (error) { if (error.status !== 404) return; }
                    }
                    if (seq === _chatHistoryRefreshSeq && owner === window.currentUser && dockChatActiveUser === peer && _chatHistoryFocus === peer) {
                        _chatHistoryFocus = ''; forgetDockChatConversationMessages(peer); renderDockMessages(peer,[],false); loadDockChatMessages(peer,false);
                    }
                })();
            };
            var _chatVoiceStarting = false;
            function setChatAudioSession(type) {
                try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (_) {}
            }
            function cancelChatVoice() {
                _chatVoiceSeq++;
                if (typeof window.__xtjCancelChatVoiceHold==='function') window.__xtjCancelChatVoiceHold();
                document.querySelector('#panelChat .chat-input-wrap').classList.remove('is-recording');
                document.getElementById('chatRecordingIndicator').hidden=true;
                document.getElementById('chatRecordingIndicator').classList.remove('is-cancelling');
                if (_chatVoiceHold) _chatVoiceHold.active=false;
                var voice = _chatVoice; _chatVoice = null;
                setChatAudioSession('auto');
                if (voice) {
                    voice.cancelled = true; stopChatVoiceMeter(voice); if (voice.meter) voice.meter.chunks=[]; clearInterval(voice.timer); clearTimeout(voice.limit);
                    if (voice.recognition) { try { voice.recognition.abort(); } catch (_) {} }
                    if (voice.recorder && voice.recorder.state !== 'inactive') { try { voice.recorder.stop(); } catch (_) {} }
                    voice.stream.getTracks().forEach(function(track) { track.stop(); });
                    setChatAudioSession('auto');
                }
                var input = document.getElementById('dockChatInput');
                if (voice && input) { input.value = voice.base; input.disabled = false; }
                if (dockChatActiveUser) updateDockChatComposerPermission(dockChatActiveUser);
                var button = document.getElementById('chatVoiceButton'); if (button) { setChatVoiceButton(false); }
                var cancel = document.getElementById('chatVoiceCancel'); if (cancel) cancel.hidden = true;
                var status = document.getElementById('chatVoiceStatus'); if (status) status.hidden = true;
            }
            function stopChatVoiceMeter(voice) {
                if (!voice || !voice.meter) return;
                var meter=voice.meter; cancelAnimationFrame(meter.frame);
                try { meter.source.disconnect(); meter.processor.disconnect(); meter.gain.disconnect(); } catch (_) {}
                meter.processor.onaudioprocess=null;
                meter.context.close().catch(function() {});
            }
            function startChatVoiceMeter(voice) {
                var indicator=document.getElementById('chatRecordingIndicator');
                indicator.hidden=false;
                var Context=window.AudioContext || window.webkitAudioContext;
                if (!Context) return;
                try {
                    var context=new Context(), source=context.createMediaStreamSource(voice.stream);
                    // Keep a mono PCM backup: an interrupted WebKit MP4 finalization
                    // must not leave the recipient with an undecodable voice message.
                    var processor=context.createScriptProcessor(4096,1,1), gain=context.createGain(); gain.gain.value=0;
                    var meter=voice.meter={context:context,source:source,processor:processor,gain:gain,chunks:[],samples:0,level:0,frame:0};
                    source.connect(processor); processor.connect(gain); gain.connect(context.destination);
                    processor.onaudioprocess=function(event) {
                        if (voice.cancelled || _chatVoice!==voice) return;
                        var samples=event.inputBuffer.getChannelData(0), energy=0;
                        if (meter.samples<context.sampleRate*300) { meter.chunks.push(new Float32Array(samples)); meter.samples+=samples.length; }
                        for (var i=0;i<samples.length;i++) energy+=samples[i]*samples[i];
                        meter.level=Math.min(1,Math.sqrt(energy/samples.length)*5);
                    };
                    context.resume().catch(function() {});
                    var bars=indicator.querySelectorAll('i');
                    function draw() {
                        if (_chatVoice!==voice || voice.cancelled) return;
                        bars.forEach(function(bar,index) { bar.style.setProperty('--record-level',String(Math.max(.16,meter.level*(.5+.5*Math.sin(performance.now()/120+index))))); });
                        meter.frame=requestAnimationFrame(draw);
                    }
                    meter.frame=requestAnimationFrame(draw);
                } catch (_) { if (context) context.close().catch(function() {}); /* CSS wave remains visible. */ }
            }
            function encodeChatVoiceWav(channels,sampleRate,length) {
                // Mono 24 kHz PCM is playable by Safari/Chrome without container or
                // codec negotiation, and five minutes remains below the 50 MB cap.
                var rate=Math.min(24000,sampleRate), count=Math.floor(length*rate/sampleRate);
                var bytes=new ArrayBuffer(44+count*2), view=new DataView(bytes);
                function word(offset,text) { for(var i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i)); }
                word(0,'RIFF'); view.setUint32(4,36+count*2,true); word(8,'WAVE'); word(12,'fmt ');
                view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
                view.setUint32(24,rate,true); view.setUint32(28,rate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
                word(36,'data'); view.setUint32(40,count*2,true);
                for(var i=0;i<count;i++) {
                    var position=i*sampleRate/rate, index=Math.floor(position), fraction=position-index, sample=0;
                    channels.forEach(function(channel) { sample+=(channel[index]||0)*(1-fraction)+(channel[Math.min(index+1,length-1)]||0)*fraction; });
                    sample=Math.max(-1,Math.min(1,sample/channels.length)); view.setInt16(44+i*2,sample<0 ? sample*32768 : sample*32767,true);
                }
                var wav=new Blob([bytes],{type:'audio/wav'}); wav.__voiceDuration=count/rate; return wav;
            }
            async function prepareChatVoiceFile(blob,voice) {
                var Context=window.OfflineAudioContext || window.webkitOfflineAudioContext, decoded;
                try {
                    if (!Context) throw new Error('Audio decoder unavailable');
                    var timeout;
                    try { decoded=await Promise.race([new Context(1,1,24000).decodeAudioData(await blob.arrayBuffer()),new Promise(function(_,reject){timeout=setTimeout(function(){reject(new Error('Audio decode timeout'));},8000);})]); }
                    finally { clearTimeout(timeout); }
                    if (!decoded.length || !Number.isFinite(decoded.duration) || decoded.duration>302) throw new Error('Invalid audio duration');
                    var channels=[]; for(var i=0;i<decoded.numberOfChannels;i++)channels.push(decoded.getChannelData(i));
                    blob=encodeChatVoiceWav(channels,decoded.sampleRate,decoded.length);
                } catch (error) {
                    var meter=voice.meter;
                    if (!meter || meter.samples<meter.context.sampleRate*.4) throw error;
                    var pcm=new Float32Array(meter.samples), offset=0;
                    meter.chunks.forEach(function(chunk){pcm.set(chunk,offset);offset+=chunk.length;});
                    blob=encodeChatVoiceWav([pcm],meter.context.sampleRate,pcm.length);
                }
                var file=new File([blob],'voice-'+Date.now()+'.wav',{type:'audio/wav'});
                file.__voiceDuration=Math.max(1,Math.round(blob.__voiceDuration));
                return file;
            }
            function setChatVoiceButton(recording) {
                var button=document.getElementById('chatVoiceButton'); if (!button) return;
                if (!button.dataset.idleIcon) button.dataset.idleIcon=button.innerHTML;
                button.innerHTML=recording ? '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="3"/></svg>' : button.dataset.idleIcon;
                button.setAttribute('aria-label',recording ? '结束录音' : '录制语音'); button.setAttribute('aria-pressed',String(recording));
                button.classList.toggle('recording',!!recording);
            }
            function isChatHoldVoiceEnabled() { return localStorage.getItem('xtj_chat_hold_voice') !== 'off'; }
            var _chatVoiceHold=null;
            async function toggleChatVoice(options) {
                var hold=options && options.hold;
                if (_chatVoice) { if (_chatVoice.recorder.state === 'recording') _chatVoice.recorder.stop(); return; }
                if (_chatVoiceStarting) return;
                if (!window.currentUser || !dockChatActiveUser || dockChatSending || _chatEditDraft || document.getElementById('dockChatInput').disabled) { showToast('请选择可发送消息的会话'); return; }
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { showToast('此浏览器不支持录音，请使用附件发送音频'); return; }
                var seq = ++_chatVoiceSeq, owner = window.currentUser, peer = dockChatActiveUser, stream;
                _chatVoiceStarting = true;
                try {
                    // WebKit rejects capture while AudioSession is playback-only. Switch before requesting permission.
                    document.querySelectorAll('#dockChatMessages audio').forEach(function(audio) { audio.pause(); });
                    setChatAudioSession('play-and-record');
                    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    if ((hold && (!_chatVoiceHold || !_chatVoiceHold.active)) || seq !== _chatVoiceSeq || owner !== window.currentUser || peer !== dockChatActiveUser) { stream.getTracks().forEach(function(t) { t.stop(); }); if (seq===_chatVoiceSeq && !_chatVoice) setChatAudioSession('auto'); return; }
                    // Safari can advertise a MIME type but reject its recorder: try the
                    // remaining supported formats, then its native default.
                    var types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus'].filter(function(t) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t); });
                    types.push(null);
                    var recorder, chunks = [];
                    for (var typeIndex=0; typeIndex<types.length; typeIndex++) {
                        try { recorder = new MediaRecorder(stream,types[typeIndex] ? {mimeType:types[typeIndex]} : undefined); break; }
                        catch (formatError) { if (formatError.name!=='NotSupportedError' || typeIndex===types.length-1) throw formatError; }
                    }
                    setChatAudioSession('play-and-record');
                    var input = document.getElementById('dockChatInput'), base = input.value, transcript = '';
                    var voice = _chatVoice = { recorder: recorder, stream: stream, cancelled: false, hold:!!hold, base: base, started: Date.now() };
                    recorder.ondataavailable = function(event) { if (event.data.size) chunks.push(event.data); };
                    recorder.onerror = function() { if (seq!==_chatVoiceSeq || _chatVoice!==voice) return; cancelChatVoice(); showToast('录音失败，请重试'); };
                    recorder.onstop = async function() {
                        stopChatVoiceMeter(voice);
                        if (voice.recognition) { try { voice.recognition.stop(); } catch (_) {} }
                        stream.getTracks().forEach(function(t) { t.stop(); }); clearInterval(voice.timer); clearTimeout(voice.limit);
                        if (seq===_chatVoiceSeq && (!_chatVoice || _chatVoice === voice)) setChatAudioSession('auto');
                        if (voice.cancelled || seq !== _chatVoiceSeq || owner !== window.currentUser || peer !== dockChatActiveUser) return;
                        _chatVoice = null; input.disabled = true;
                        document.querySelector('#panelChat .chat-input-wrap').classList.remove('is-recording');
                        document.getElementById('chatRecordingIndicator').hidden=true;
                        document.getElementById('chatRecordingIndicator').classList.remove('is-cancelling');
                        setChatVoiceButton(false);
                        document.getElementById('chatVoiceButton').classList.remove('recording'); document.getElementById('chatVoiceCancel').hidden = true;
                        var mime = String(recorder.mimeType || (chunks[0] && chunks[0].type) || 'audio/mp4').split(';')[0];
                        var blob = new Blob(chunks, { type: mime });
                        if (voice.hold && Date.now()-voice.started<600) { input.disabled=false; document.getElementById('chatVoiceStatus').hidden=true; showToast('录音太短，请再说一次'); return; }
                        if ((!blob.size && !(voice.meter && voice.meter.samples)) || blob.size > 50 * 1024 * 1024) { input.disabled=false; document.getElementById('chatVoiceStatus').hidden=true; showToast('录音无内容或超过 50MB，请重录'); return; }
                        document.getElementById('chatVoiceStatus').textContent='正在准备语音…';
                        try {
                            var prepared=await prepareChatVoiceFile(blob,voice);
                            if (seq!==_chatVoiceSeq || owner!==window.currentUser || peer!==dockChatActiveUser) return;
                            _chatRecordedFile=prepared;
                        } catch (_) {
                            if (seq===_chatVoiceSeq) { document.getElementById('chatVoiceStatus').hidden=true; showToast('录音未生成可播放的音频，请重新录制'); }
                            return;
                        } finally {
                            if (voice.meter) voice.meter.chunks=[];
                            if (seq===_chatVoiceSeq && owner===window.currentUser && peer===dockChatActiveUser) { input.disabled=false; }
                        }
                        showDockChatFilePreview(_chatRecordedFile);
                        if (voice.hold) { sendDockChatMessage(); return; }
                        document.getElementById('chatVoiceStatus').textContent = transcript ? '录音完成 · 转写文字可编辑后发送' : '录音完成 · 可补充文字后发送';
                    };
                    // A second SpeechRecognition session can steal the iOS microphone from MediaRecorder.
                    // Record audio alone; the existing authenticated server queue transcribes after sending.
                    input.disabled = true; setChatVoiceButton(true); document.getElementById('chatVoiceButton').classList.add('recording');
                    document.getElementById('chatVoiceCancel').hidden = false; document.getElementById('chatVoiceStatus').hidden = false;
                    document.getElementById('chatVoiceStatus').textContent=voice.hold ? '正在录音 · 松开发送 · 上滑取消' : '正在录音 · 点击结束';
                    document.getElementById('chatRecordingTimer').textContent='00:00';
                    startChatVoiceMeter(voice);
                    voice.timer = setInterval(function() { var elapsed=Math.floor((Date.now()-voice.started)/1000); document.getElementById('chatRecordingTimer').textContent=String(Math.floor(elapsed/60)).padStart(2,'0')+':'+String(elapsed%60).padStart(2,'0'); if (voice.hold && _chatVoiceHold && _chatVoiceHold.cancel) return; document.getElementById('chatVoiceStatus').textContent = (voice.hold ? '松开发送 · 上滑取消 · ' : '正在录音 · ') + Math.floor((Date.now() - voice.started) / 1000) + ' 秒'; }, 500);
                    document.querySelector('#panelChat .chat-input-wrap').classList.add('is-recording');
                    voice.limit = setTimeout(function() { if (recorder.state === 'recording') recorder.stop(); }, 300000);
                    // Request the complete container on stop: Safari's MP4 fragments can be unplayable when interrupted.
                    recorder.start();
                } catch (error) {
                    if (stream) stream.getTracks().forEach(function(t) { t.stop(); });
                    if (seq !== _chatVoiceSeq || owner !== window.currentUser || peer !== dockChatActiveUser) return;
                    cancelChatVoice();
                    var reason=error && error.name;
                    showToast(reason==='NotAllowedError' ? '请在浏览器的网站设置中允许麦克风后重试' :
                        reason==='SecurityError' ? '浏览器限制了麦克风，请检查网站权限后重试' :
                        reason==='NotFoundError' ? '未找到可用的麦克风' :
                        reason==='NotReadableError' ? '麦克风被占用，请结束其他录音后重试' : '无法打开麦克风，请稍后重试');
                } finally { _chatVoiceStarting = false; }
            }
            function bindChatHoldVoice() {
                var wrap=document.querySelector('#panelChat .chat-input-wrap'), input=document.getElementById('dockChatInput');
                if (!wrap || wrap.__voiceHoldBound) return; wrap.__voiceHoldBound=true;
                var timer=null, press=null;
                function finish(cancel) {
                    clearTimeout(timer); timer=null;
                    if (!press) return;
                    var active=press.active; press.active=false; press=null;
                    if (!active) { if (!cancel) input.focus({preventScroll:true}); return; }
                    if (cancel || !_chatVoice) cancelChatVoice();
                    else if (_chatVoice.recorder.state==='recording') _chatVoice.recorder.stop();
                }
                window.__xtjCancelChatVoiceHold=function() { clearTimeout(timer); timer=null; if (press) press.active=false; press=null; };
                wrap.addEventListener('pointerdown',function(event) {
                    if (!isChatHoldVoiceEnabled() || event.button!==0 || input.disabled || input.value.trim() || _chatRecordedFile || document.getElementById('dockChatFileInp').files.length || _chatVoice || _chatEditDraft) return;
                    event.preventDefault();
                    press={active:false,x:event.clientX,y:event.clientY,id:event.pointerId,cancel:false,peer:dockChatActiveUser,owner:window.currentUser};
                    var current=press;
                    timer=setTimeout(function() {
                        if (press!==current || current.peer!==dockChatActiveUser || current.owner!==window.currentUser || !document.getElementById('panelChat').classList.contains('active')) return;
                        current.active=true; _chatVoiceHold=current; input.blur();
                        try { wrap.setPointerCapture(current.id); } catch(_) {}
                        toggleChatVoice({hold:true});
                    },450);
                });
                wrap.addEventListener('pointermove',function(event) {
                    if (!press) return;
                    if (!press.active && Math.hypot(event.clientX-press.x,event.clientY-press.y)>10) { finish(true); return; }
                    press.cancel=press.y-event.clientY>65;
                    if (press.active) { document.getElementById('chatRecordingIndicator').classList.toggle('is-cancelling',press.cancel); var status=document.getElementById('chatVoiceStatus'); status.textContent=press.cancel ? '松开取消发送' : '松开发送 · 上滑取消'; }
                });
                window.addEventListener('pointerup',function(event) { if (press && press.id===event.pointerId) finish(press.cancel); });
                window.addEventListener('pointercancel',function() { finish(true); });
                wrap.addEventListener('contextmenu',function(event) { if (press && press.active) event.preventDefault(); });
            }
            function bindChatAudioPlayers() {
                document.querySelectorAll('#dockChatMessages .chat-voice-player').forEach(function(player) {
                    if (player.__voiceBound) return; player.__voiceBound=true;
                    var audio=player.querySelector('audio'), button=player.querySelector('button'), duration=player.querySelector('.chat-voice-duration');
                    function update() {
                        var playing=!audio.paused && !audio.ended;
                        player.classList.toggle('is-playing',playing); player.classList.remove('is-loading');
                        button.setAttribute('aria-pressed',String(playing)); button.setAttribute('aria-label',playing ? '暂停语音' : '播放语音');
                        if (button.dataset.playing!==String(playing)) {
                            button.dataset.playing=String(playing);
                            player.querySelector('.voice-play-icon path').setAttribute('d',playing ? 'M7 5h4v14H7zM14 5h4v14h-4z' : 'm8 5 11 7-11 7z');
                        }
                        var seconds=playing ? audio.duration-audio.currentTime : audio.duration;
                        if (Number.isFinite(seconds) && seconds>0) duration.textContent=Math.ceil(seconds)+'″';
                        player.style.setProperty('--voice-progress',audio.duration>0 ? Math.min(100,audio.currentTime/audio.duration*100)+'%' : '0%');
                    }
                    button.onclick=async function(event) {
                        event.stopPropagation();
                        if (_chatVoice || _chatVoiceStarting) { showToast('请先结束录音'); return; }
                        if (!audio.paused) { audio.pause(); return; }
                        document.querySelectorAll('#dockChatMessages audio').forEach(function(other) { if (other!==audio) other.pause(); });
                        if (audio.ended) audio.currentTime=0;
                        player.classList.add('is-loading');
                        try {
                            try { if (navigator.audioSession) navigator.audioSession.type='playback'; } catch (_) {}
                            audio.muted=false; audio.volume=1;
                            if (!audio.getAttribute('src')) throw new Error('voice_url_missing');
                            if (audio.error) audio.load();
                            await audio.play(); update();
                        } catch(error) {
                            player.classList.remove('is-loading'); duration.textContent='重试';
                            if (error && error.name === 'NotAllowedError') {
                                showToast('浏览器暂未允许播放，请再次点击语音');
                                return;
                            }
                            // Keep the current row while refreshing; a detached player cannot receive the next tap.
                            var peer = dockChatActiveUser, owner = window.currentUser;
                            var row = player.closest('[data-message-id]');
                            if (row && row.dataset.messageId) {
                                try {
                                    var response = await window.xtjProtectedFetch('/api/chat/voice-url?peer=' + encodeURIComponent(peer) + '&message_id=' + encodeURIComponent(row.dataset.messageId));
                                    var body = await response.json();
                                    if (response.ok && body.ok && owner === window.currentUser && peer === dockChatActiveUser && player.isConnected) {
                                        var refreshed = sanitizeUrl(body.url);
                                        if (refreshed && /^https?:\/\//i.test(refreshed)) { audio.src = refreshed; audio.load(); await audio.play(); update(); return; }
                                    }
                                } catch (_) {}
                            }
                            showToast(error && error.name === 'NotSupportedError' ? '语音暂时无法解码，请重试或重新录制' : '语音加载失败，请点击重试');
                        }
                    };
                    ['loadedmetadata','durationchange','play','pause','ended','timeupdate','playing'].forEach(function(event) { audio.addEventListener(event,update); });
                    audio.addEventListener('ended', function() { if (!_chatVoice && !_chatVoiceStarting) setChatAudioSession('auto'); });
                    audio.addEventListener('waiting',function() { player.classList.add('is-loading'); });
                    audio.addEventListener('error',function() { player.classList.remove('is-playing','is-loading'); duration.textContent='重试'; button.setAttribute('aria-label','重新播放语音'); });
                    update();
                });
            }
            var _chatAttachmentQueue=[], _chatAttachmentUrls=new Map(), _chatBatchSending=false;
            function resetChatAttachmentQueue() {
                _chatAttachmentQueue=[];
                _chatAttachmentUrls.forEach(function(url) { URL.revokeObjectURL(url); }); _chatAttachmentUrls.clear();
                var host=document.getElementById('chatAttachmentQueue'); if(host)host.remove();
            }
            function renderChatAttachmentQueue() {
                var old=document.getElementById('chatAttachmentQueue'); if(old)old.remove();
                if(_chatAttachmentQueue.length<2)return;
                var host=document.createElement('div'); host.id='chatAttachmentQueue'; host.className='chat-attachment-queue';
                _chatAttachmentQueue.forEach(function(file,index){
                    var item=document.createElement('div'); item.className='chat-attachment-item';
                    if(/^image\//.test(file.type)){ var img=document.createElement('img'); var url=_chatAttachmentUrls.get(file); if(!url){url=URL.createObjectURL(file);_chatAttachmentUrls.set(file,url);} img.src=url;img.alt=file.name;item.appendChild(img); }
                    else {var label=document.createElement('span');label.textContent=file.name;item.appendChild(label);}
                    var controls=document.createElement('div');
                    [['←','前移',-1],['→','后移',1],['×','移除',0]].forEach(function(action){var button=document.createElement('button');button.type='button';button.textContent=action[0];button.setAttribute('aria-label',action[1]+'第 '+(index+1)+' 个附件');button.disabled=action[2] && (index+action[2]<0 || index+action[2]>=_chatAttachmentQueue.length);button.onclick=function(){
                        if(!action[2]){_chatAttachmentQueue.splice(index,1);var url=_chatAttachmentUrls.get(file);if(url)URL.revokeObjectURL(url);_chatAttachmentUrls.delete(file);}
                        else {var other=index+action[2];[_chatAttachmentQueue[index],_chatAttachmentQueue[other]]=[_chatAttachmentQueue[other],_chatAttachmentQueue[index]];}
                        if(!_chatAttachmentQueue.length)clearDockChatFilePreview(false);else{showDockChatFilePreview(_chatAttachmentQueue[0]);renderChatAttachmentQueue();}
                    };controls.appendChild(button);});item.appendChild(controls);host.appendChild(item);
                });document.getElementById('dockChatFilePreview').appendChild(host);
            }
            function selectChatAttachments(files) {
                if(dockChatSending || _chatBatchSending){showToast('请等待当前附件发送完成');return;}
                var valid=Array.from(files||[]).map(normalizeDockChatMediaFile).filter(function(f){return f && getChatUploadKind(f) && !isBlockedDmFile(f) && f.size>0 && f.size<=50*1024*1024;});
                if(valid.length!==files.length)showToast('部分附件类型或大小不支持，已跳过');
                if(valid.length>9 || valid.reduce(function(n,f){return n+f.size;},0)>200*1024*1024){showToast('每批最多 9 个附件，总大小不超过 200MB');return;}
                resetChatAttachmentQueue();_chatRecordedFile=null;_chatAttachmentQueue=valid;
                if(valid.length){showDockChatFilePreview(valid[0]);renderChatAttachmentQueue();}else clearDockChatFilePreview(false);
            }
            async function sendDockChatMessage() {
                if(_chatBatchSending){showToast('附件正在依次发送');return;}
                if(!_chatAttachmentQueue.length)return sendDockChatMessageSingle();
                if(dockChatSending)return;
                var files=_chatAttachmentQueue.slice(),peer=dockChatActiveUser,owner=window.currentUser,epoch=_authStateEpoch,text=document.getElementById('dockChatInput').value.trim();
                if(!peer || !owner || isUserMuted())return sendDockChatMessageSingle();
                _chatBatchSending=true;resetChatAttachmentQueue();
                try {for(var i=0;i<files.length;i++){
                    if(owner!==window.currentUser || epoch!==_authStateEpoch || peer!==dockChatActiveUser) {if(owner===window.currentUser && epoch===_authStateEpoch)showToast('会话已切换，剩余附件没有发送');break;}
                    await sendDockChatMessageSingle(files[i],i===0?text:'');
                }} finally {if(owner===window.currentUser && epoch===_authStateEpoch)_chatBatchSending=false;}
            }
            function bindChatReplyGestures() {
                var host=document.getElementById('dockChatMessages');
                host.addEventListener('click',function(event){var quote=event.target.closest('.chat-reply-quote');if(quote){event.stopPropagation();if(quote.dataset.replyId)jumpChatHistory(dockChatActiveUser,quote.dataset.replyId);}});
                var swipe=null;
                host.addEventListener('pointerdown',function(event){
                    if(event.pointerType!=='touch' || event.target.closest('button,a,img,video,audio'))return;
                    var row=event.target.closest('.chat-msg-row'),message=row && findDockMessageByRow(row);
                    if(!message || message.__optimistic || message.__failed || (getDMMessagePayload(message)||{}).withdrawn)return;
                    swipe={row:row,bubble:row.querySelector('.chat-msg'),id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,active:false,peer:dockChatActiveUser,owner:window.currentUser};
                });
                host.addEventListener('pointermove',function(event){if(!swipe || swipe.id!==event.pointerId)return;
                    var dx=event.clientX-swipe.x,dy=event.clientY-swipe.y;
                    if(Math.abs(dy)>15 && !swipe.active){swipe=null;return;}
                    if(dx>12 && Math.abs(dx)>Math.abs(dy)*1.5){swipe.active=true;swipe.dx=dx;swipe.bubble.style.transform='translateX('+Math.min(65,dx*.6)+'px)';}
                });
                function finish(event,cancel){if(!swipe || event.pointerId!==swipe.id)return;var state=swipe;swipe=null;state.bubble.style.transform='';
                    if(!cancel && state.active && state.dx>65 && state.peer===dockChatActiveUser && state.owner===window.currentUser){closeDockMessageActions();var message=findDockMessageByRow(state.row);if(message)runChatExtraAction('reply',message);}
                }
                host.addEventListener('pointerup',function(e){finish(e,false);});host.addEventListener('pointercancel',function(e){finish(e,true);});
            }
            window.openChatGallery=function(src,trigger){
                var peer=dockChatActiveUser,owner=window.currentUser,opener=trigger;
                if(!peer || !owner)return;
                var items=(_chatCache[getDockChatCacheKey(peer)]||[]).filter(function(m){var media=resolveDockChatMedia(m);return media && media.kind==='image' && !(getDMMessagePayload(m)||{}).withdrawn;}).map(function(m){return {id:m.id,url:sanitizeUrl(resolveDockChatMedia(m).src),date:m.created_at};});
                var row=trigger.closest('.chat-msg-row'),current=items.findIndex(function(i){return row && i.id===row.dataset.messageId;});if(current<0)current=0;
                var old=document.getElementById('chatGallery');if(old)old.__close ? old.__close() : old.remove();
                var overlay=document.createElement('section');overlay.id='chatGallery';overlay.className='chat-gallery';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','聊天图片');
                overlay.innerHTML='<header><button type="button" data-gallery="close" aria-label="关闭图片">×</button><span class="chat-gallery-title"></span><button type="button" data-gallery="save">保存</button></header><div class="chat-gallery-stage"><img alt="聊天图片" draggable="false" /></div><footer><button type="button" data-gallery="previous" aria-label="上一张图片">‹</button><button type="button" data-gallery="jump">定位原消息</button><button type="button" data-gallery="next" aria-label="下一张图片">›</button></footer>';
                var img=overlay.querySelector('img'),scale=1,pointer=null,panX=0,panY=0,pointers=new Map(),pinch=null;var closed=false,cursor=null,hasMore=true,loading=false;
                function paint(){if(!items[current])return;if(img.getAttribute('src')!==items[current].url){scale=1;panX=panY=0;pointers.clear();pinch=null;pointer=null;img.style.transform='';img.src=items[current].url;}overlay.querySelector('.chat-gallery-title').textContent=(current+1)+' / '+items.length+' · '+new Date(items[current].date).toLocaleDateString();overlay.querySelector('[data-gallery="previous"]').disabled=current===0 && (!hasMore || loading);overlay.querySelector('[data-gallery="next"]').disabled=current===items.length-1;}
                function close(){closed=true;window.removeEventListener('keydown',keys);overlay.remove();if(opener && opener.isConnected)opener.focus?.({preventScroll:true});}
                function keys(event){if(event.key==='Escape')close();else if(event.key==='ArrowLeft')move(-1);else if(event.key==='ArrowRight')move(1);else if(event.key==='Tab'){var buttons=Array.from(overlay.querySelectorAll('button:not(:disabled)'));var first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}}}
                function move(delta){if(owner!==window.currentUser || peer!==dockChatActiveUser){close();return;}if(delta<0 && current===0 && hasMore){loadOlder(true);return;}current=Math.max(0,Math.min(items.length-1,current+delta));paint();}
                overlay.addEventListener('click',async function(event){var b=event.target.closest('[data-gallery]');if(!b)return;var action=b.dataset.gallery;
                    if(action==='close')close();if(action==='previous')move(-1);if(action==='next')move(1);
                    if(action==='jump'){var id=items[current].id;close();jumpChatHistory(peer,id);}
                    if(action==='save'){b.disabled=true;try{var response=await fetch(items[current].url);if(!response.ok)throw Error();var blob=await response.blob();if(owner!==window.currentUser || closed)return;var url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='chat-photo-'+current+'.'+(blob.type==='image/png'?'png':'jpg');a.click();setTimeout(function(){URL.revokeObjectURL(url);},30000);}catch(_){showToast('图片暂时无法保存，请重试');}finally{b.disabled=false;}}
                });
                img.addEventListener('error',function(){if(!closed)showToast('图片暂时不可用，请返回会话刷新');});
                var stage=overlay.querySelector('.chat-gallery-stage');
                function zoom(value){
                    scale=Math.max(1,Math.min(4,value));var r=stage.getBoundingClientRect(),ratio=Math.min(r.width/(img.naturalWidth||r.width),r.height/(img.naturalHeight||r.height));
                    var maxX=Math.max(0,((img.naturalWidth||r.width)*ratio*scale-r.width)/2),maxY=Math.max(0,((img.naturalHeight||r.height)*ratio*scale-r.height)/2);
                    panX=Math.max(-maxX,Math.min(maxX,panX));panY=Math.max(-maxY,Math.min(maxY,panY));img.style.transform='translate3d('+panX+'px,'+panY+'px,0) scale('+scale+')';
                }
                stage.addEventListener('pointerdown',function(e){
                    if(e.pointerType==='mouse'&&e.button!==0)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});stage.setPointerCapture(e.pointerId);
                    if(pointers.size===1)pointer={x:e.clientX,y:e.clientY,id:e.pointerId,swipe:scale===1};
                    if(pointers.size===2){var p=[...pointers.values()],r=stage.getBoundingClientRect(),cx=(p[0].x+p[1].x)/2-r.left-r.width/2,cy=(p[0].y+p[1].y)/2-r.top-r.height/2;pinch={distance:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),scale:scale,anchorX:(cx-panX)/scale,anchorY:(cy-panY)/scale};pointer=null;}
                });
                stage.addEventListener('pointermove',function(e){
                    if(!pointers.has(e.pointerId))return;var before=pointers.get(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
                    if(pointers.size===2&&pinch&&pinch.distance){var p=[...pointers.values()],r=stage.getBoundingClientRect(),value=Math.max(1,Math.min(4,pinch.scale*Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)/pinch.distance));panX=(p[0].x+p[1].x)/2-r.left-r.width/2-pinch.anchorX*value;panY=(p[0].y+p[1].y)/2-r.top-r.height/2-pinch.anchorY*value;zoom(value);}
                    else if(pointers.size===1&&scale>1){panX+=e.clientX-before.x;panY+=e.clientY-before.y;zoom(scale);}
                });
                function endPointer(e,cancelled){
                    if(!pointers.has(e.pointerId))return;var swipe=pointer&&!cancelled&&pointer.swipe&&pointer.id===e.pointerId&&scale===1&&Math.abs(e.clientX-pointer.x)>55&&Math.abs(e.clientY-pointer.y)<50,delta=swipe?(e.clientX>pointer.x?-1:1):0;
                    pointers.delete(e.pointerId);pinch=null;pointer=null;if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);if(swipe)move(delta);
                }
                stage.addEventListener('pointerup',function(e){endPointer(e,false);});stage.addEventListener('pointercancel',function(e){endPointer(e,true);});stage.addEventListener('lostpointercapture',function(e){endPointer(e,true);});
                stage.addEventListener('dblclick',function(){zoom(scale===1?2:1);});
                stage.addEventListener('wheel',function(e){e.preventDefault();zoom(scale*(e.deltaY<0?1.12:1/1.12));},{passive:false});
                overlay.__close=close;document.body.appendChild(overlay);window.addEventListener('keydown',keys);paint();overlay.querySelector('[data-gallery="close"]').focus();
                // Load one authorized metadata page at a time, retaining the displayed image and zoom.
                async function loadOlder(moveBack){if(loading || !hasMore || closed)return;loading=true;paint();var active=items[current]?.id;
                    try{var result=await chatFeatureApi('history/search?peer='+encodeURIComponent(peer)+'&kind=image&limit=50'+(cursor?'&cursor_at='+encodeURIComponent(cursor.at)+'&cursor_id='+encodeURIComponent(cursor.id):''));
                        if(closed || owner!==window.currentUser || peer!==dockChatActiveUser)return;
                        (result.items||[]).forEach(function(item){
                            var media=item.payload && item.payload.media,url=media && sanitizeUrl(media.url);
                            if(!url)return;
                            var existing=items.find(function(i){return i.id===item.message_id || i.id===item.legacy_post_id;});
                            // The authorized metadata page renews private URLs.
                            // Deduplicating an image must not discard its fresh signature.
                            if(existing){existing.url=url;existing.date=item.sent_at || existing.date;}
                            else items.push({id:item.legacy_post_id || item.message_id,url:url,date:item.sent_at});
                        });
                        items.sort(function(a,b){return Date.parse(a.date)-Date.parse(b.date);});current=Math.max(0,items.findIndex(function(i){return i.id===active;}));
                        hasMore=!!result.has_more && !!result.next_cursor_id;cursor={at:result.next_cursor_at,id:result.next_cursor_id};
                        if(moveBack && current>0)current--;
                    }catch(_){showToast('历史图片加载失败，请重试');}finally{loading=false;if(!closed)paint();}
                }
                loadOlder(false);
            };

            var _chatPushSyncing=false, _chatPushPending=false, _chatPushOwner='', _chatPushEnabled=false;
            function chatPushSupported(){return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;}
            async function chatPushApi(path,body,owner,epoch){var response=await window.xtjProtectedFetch('/api/chat/push/'+path,Object.assign(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),timeoutMs:15000}:{timeoutMs:15000},{authOwner:owner,authEpoch:epoch}));var result=await response.json();if(!response.ok || !result.ok)throw new Error(result.error||'通知设置暂不可用');return result;}
            async function syncChatPushState(){
                if(!chatPushSupported())return;
                var owner=window.currentUser || '',epoch=_authStateEpoch,enabled=!!owner && localStorage.getItem('xtj_chat_push_'+owner)==='on';
                function current(){return owner===(window.currentUser||'') && epoch===_authStateEpoch;}
                function allowed(){return current() && localStorage.getItem('xtj_chat_push_'+owner)==='on' && Notification.permission==='granted';}
                var registration=await navigator.serviceWorker.getRegistration('/');
                if(!current())return;
                if(registration && registration.active)registration.active.postMessage({type:'XTJ_CHAT_PUSH_STATE',owner:enabled?owner:'',peer:currentDockTab==='chat'?dockChatActiveUser || '':''});
                if(!owner || !enabled || Notification.permission!=='granted'){_chatPushEnabled=false;_chatPushOwner='';return;}
                if(_chatPushSyncing){_chatPushPending=true;return;}
                if(_chatPushOwner===owner)return;
                _chatPushSyncing=true;
                try {
                    registration=await navigator.serviceWorker.register('/chat-notifications-sw.js',{scope:'/'});await navigator.serviceWorker.ready;
                    if(!allowed())return;
                    var config=await chatPushApi('config',null,owner,epoch);if(!allowed())return;
                    var subscription=await registration.pushManager.getSubscription();if(!allowed())return;
                    if(subscription){var key=subscription.options && subscription.options.applicationServerKey;if(key && btoa(String.fromCharCode.apply(null,new Uint8Array(key))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==config.public_key){await subscription.unsubscribe();subscription=null;if(!allowed())return;}}
                    if(!subscription){var raw=atob(config.public_key.replace(/-/g,'+').replace(/_/g,'/'));subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,function(c){return c.charCodeAt(0);})});}
                    if(!allowed())return;
                    await chatPushApi('subscribe',{subscription:subscription.toJSON()},owner,epoch);
                    if(!allowed())return;
                    _chatPushOwner=owner;_chatPushEnabled=true;
                    (registration.active || registration.waiting).postMessage({type:'XTJ_CHAT_PUSH_STATE',owner,peer:currentDockTab==='chat'?dockChatActiveUser || '':''});
                }catch(_){if(current())_chatPushEnabled=false;}finally{_chatPushSyncing=false;if(_chatPushPending||!current()){_chatPushPending=false;window.__xtjSyncChatPush();}}
            }
            async function toggleChatPush(){
                if(!chatPushSupported()){showToast('当前浏览器不支持系统推送，请使用支持通知的网页应用');return;}
                var owner=window.currentUser,epoch=_authStateEpoch;if(!owner)return;
                function current(){return owner===window.currentUser && epoch===_authStateEpoch;}
                if(localStorage.getItem('xtj_chat_push_'+owner)==='on'){
                    try{var registration=await navigator.serviceWorker.getRegistration('/'),subscription=registration && await registration.pushManager.getSubscription();if(!current())return;if(subscription){await chatPushApi('unsubscribe',{endpoint:subscription.endpoint},owner,epoch);if(!current())return;await subscription.unsubscribe();if(!current())return;}localStorage.setItem('xtj_chat_push_'+owner,'off');_chatPushOwner='';_chatPushEnabled=false;await syncChatPushState();if(current())showToast('系统消息通知已关闭');}catch(error){if(current())showToast(error.message);}return;
                }
                // Permission must be requested from this explicit user action, never at page startup.
                var permission=await Notification.requestPermission();if(permission!=='granted'){showToast('没有获得通知权限，可在浏览器设置中修改');return;}
                if(!current())return;
                localStorage.setItem('xtj_chat_push_'+owner,'on');await syncChatPushState();if(!current())return;
                if(!_chatPushEnabled){localStorage.setItem('xtj_chat_push_'+owner,'off');await syncChatPushState();showToast('通知订阅未建立，请检查浏览器支持和网络后重试');}
                else showToast('系统通知已开启，消息内容默认隐藏');
            }
            window.__xtjSyncChatPush=function(){void syncChatPushState().catch(function(){});};
            if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',function(event){var data=event.data||{};if(data.type==='XTJ_OPEN_CHAT' && data.owner===window.currentUser && typeof data.peer==='string' && data.peer.length<=64)window.openChat(data.peer);});
            window.addEventListener('online',function(){_chatPushOwner='';window.__xtjSyncChatPush();});
            document.addEventListener('visibilitychange',function(){window.__xtjSyncChatPush();});
            function openChatPushLink(){var params=new URLSearchParams(location.search),peer=params.get('chat_peer'),owner=params.get('chat_owner');if(peer && peer.length<=64 && owner===window.currentUser){params.delete('chat_peer');params.delete('chat_owner');history.replaceState(null,'',location.pathname+(params.size?'?'+params.toString():'')+location.hash);window.openChat(peer);}}

            function bindChatFeatures() {
                document.getElementById('chatSearchButton').onclick = function() { openChatHistory(false); };
                document.getElementById('chatMediaButton').onclick = function() { openChatHistory(true); };
                document.getElementById('chatHistoryClose').onclick = closeChatHistory;
                document.querySelectorAll('[data-chat-search-mode]').forEach(function(button) { button.onclick=function() { setChatSearchMode(button.dataset.chatSearchMode); if (document.getElementById('chatHistoryQuery').value.trim().length>=2) runChatHistorySearch(false); }; });
                document.getElementById('chatHistoryForm').onsubmit = function(event) { event.preventDefault(); runChatHistorySearch(false); };
                document.getElementById('chatHistoryMore').onclick = function() { runChatHistorySearch(true); };
                document.getElementById('chatHistoryKind').onchange = function() { runChatHistorySearch(false); };
                document.getElementById('chatMessageContextClose').onclick = clearChatMessageDraft;
                document.getElementById('chatVoiceButton').onclick = toggleChatVoice;
                document.getElementById('chatVoiceCancel').onclick = cancelChatVoice;
                document.addEventListener('keydown', function(event) { if (event.key === 'Escape') { closeChatHistory(); cancelChatVoice(); document.querySelectorAll('.chat-reaction-picker').forEach(function(p) { p.remove(); }); } });
                bindChatReplyGestures();
                bindChatHoldVoice();
                bindChatAudioPlayers();
                window.addEventListener('pagehide', cancelChatVoice);
                document.addEventListener('visibilitychange',function() { if (document.hidden) cancelChatVoice(); });
            }
            window.addEventListener('DOMContentLoaded', bindChatFeatures);

            function bindDockChatMessageActions() {
                var container = document.getElementById('dockChatMessages');
                if (!container || container.__xtjMsgActionsBound) return;
                container.__xtjMsgActionsBound = true;
                var pressTimer = null;
                var startX = 0, startY = 0, suppressedBubble = null, suppressUntil = 0;
                function resetSuppression() { suppressedBubble = null; suppressUntil = 0; }
                window.__xtjResetDmPress = resetSuppression;
                function cancelPress() { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }

                // 长按 450ms。用 passive 监听 + 位移阈值取消，避免抢走列表滚动。
                container.addEventListener('touchstart', function(e) {
                    if (!e.touches || e.touches.length !== 1) { cancelPress(); return; }
                    var row = e.target && e.target.closest ? e.target.closest('.chat-msg') : null;
                    if (!row) { cancelPress(); return; }
                    startX = e.touches[0].clientX;
                    startY = e.touches[0].clientY;
                    resetSuppression();
                    cancelPress();
                    pressTimer = setTimeout(function() {
                        pressTimer = null;
                        try { if (navigator.vibrate) navigator.vibrate(12); } catch (eVib) {}
                        openDockMessageActions(row);
                        suppressedBubble = row; suppressUntil = Date.now() + 900;
                    }, 450);
                }, { passive: true });

                container.addEventListener('touchmove', function(e) {
                    if (!pressTimer || !e.touches || !e.touches[0]) return;
                    if (Math.abs(e.touches[0].clientX - startX) > 10 || Math.abs(e.touches[0].clientY - startY) > 10) cancelPress();
                }, { passive: true });
                container.addEventListener('touchend', cancelPress, { passive: true });
                container.addEventListener('touchcancel', cancelPress, { passive: true });

                // 桌面端：鼠标右键。命中区域放宽到整行（.chat-msg-row，含头像），
                //   比只认气泡更好点；同时 preventDefault 掉浏览器原生菜单。
                container.addEventListener('contextmenu', function(e) {
                    var row = e.target && e.target.closest ? e.target.closest('.chat-msg-row') : null;
                    if (!row) return;
                    e.preventDefault();
                    openDockMessageActions(row);
                });

                // 长按之后浏览器还会补一次 click（会点开图片预览）——在捕获阶段吞掉它
                container.addEventListener('click', function(e) {
                    if (!suppressedBubble || Date.now() > suppressUntil || !suppressedBubble.contains(e.target)) { resetSuppression(); return; }
                    resetSuppression();
                    e.preventDefault();
                    e.stopPropagation();
                }, true);
            }

            // ★ 2026-09-27 修复（M13：粘贴/拖拽入口缺 SVG 拦截）：
            //   根因：文件选择入口（sendDockChatMessage）已有显式 SVG 拦截，但粘贴（paste）
            //   与拖拽（drop/dragover）走的是另一条路径（经 assignDockChatFile 的
            //   `image/` 白名单，而 image/* 天然包含 image/svg+xml）→ 可绕过拦截把 SVG
            //   塞进发送链路。后端 dm-media 拒绝 SVG 时文件已先落桶，留下 Storage 孤儿
            //   + 公共桶存储型 XSS 窗口。
            //   修法：把 SVG 拦截收敛成唯一的小工具函数，文件选择 / 粘贴 / 拖拽三处统一
            //   调用，规则一致，避免以后再分叉。
            var CHAT_DOCUMENT_MIMES = { pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf',
                docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip' };
            function getChatUploadKind(file) {
                var mime = String(file && file.type || '').split(';')[0];
                if (/^(image|video|audio)\//.test(mime)) return mime.split('/')[0];
                return Object.keys(CHAT_DOCUMENT_MIMES).some(function(k) { return CHAT_DOCUMENT_MIMES[k] === mime; }) ? 'file' : null;
            }
            function isBlockedDmFile(file) {
                if (!file) return false;
                return /^image\/svg\+xml/i.test(String(file.type || '')) ||
                    /\.svgz?$/i.test(String(file.name || '').toLowerCase());
            }

            var _flashViewer=null,_flashConsumed=new Set(),_flashSending=false,_flashSendFlight=null,_flashQuota=null,_flashQuotaFlight=null,_flashViewTokens=new Map();
            function cancelChatFlashSend(){if(!_flashSendFlight)return;_flashSendFlight.controller.abort();_flashSendFlight=null;_flashSending=false;dockChatSending=false;var send=document.getElementById('dockChatSendBtn'),flash=document.getElementById('chatFlashSendBtn');if(send)send.disabled=false;if(flash){flash.textContent='闪图';flash.disabled=false;}}
            var _flashReceiptJobs = new Map();
            function readFlashReceipts(owner){try{var records=JSON.parse(localStorage.getItem('xtj_flash_receipts_'+owner)||'{}');return records && typeof records==='object' && !Array.isArray(records)?records:{};}catch(_){return {};}}
            function writeFlashReceipts(owner,records){try{localStorage.setItem('xtj_flash_receipts_'+owner,JSON.stringify(records));return true;}catch(_){return false;}}
            function rememberFlashConsumed(key){_flashConsumed.add(key);if(_flashConsumed.size>512)_flashConsumed.delete(_flashConsumed.values().next().value);}
            function flashLocallyViewed(owner,id){var record=readFlashReceipts(owner)[id];return _flashConsumed.has(owner+':'+id)||!!(record && record.presented!==false);}
            function queueFlashReceipt(owner,epoch,id,view){
                var key=owner+':'+id,records=readFlashReceipts(owner),record=records[id]||{view:view,at:Date.now(),confirmed:false};
                record.presented=true;records[id]=record;writeFlashReceipts(owner,records);rememberFlashConsumed(key);
                var existingJob=_flashReceiptJobs.get(key);if(existingJob && existingJob.epoch===epoch)return;
                var job={owner:owner,epoch:epoch,id:id,view:record.view,at:record.at,attempt:0};_flashReceiptJobs.set(key,job);
                function removeJob(){if(_flashReceiptJobs.get(key)===job)_flashReceiptJobs.delete(key);}
                async function send(){
                    if(currentUser!==owner || _authStateEpoch!==epoch){removeJob();return;}
                    try{var response=await window.xtjProtectedFetch('/api/chat/flash/viewed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message_id:id,view_id:job.view}),background:true,timeoutMs:8000,authOwner:owner,authEpoch:epoch});var result=await response.json();
                        if(currentUser!==owner || _authStateEpoch!==epoch){removeJob();return;}
                        if(response.ok && result.ok){var saved=readFlashReceipts(owner);if(saved[id] && saved[id].view===job.view){saved[id].confirmed=true;writeFlashReceipts(owner,saved);}_flashViewTokens.delete(key);removeJob();return;}
                        if(response.status===410 || response.status===409 || response.status===404){removeJob();return;}
                    }catch(_){}
                    if(currentUser!==owner || _authStateEpoch!==epoch){removeJob();return;}
                    job.attempt++;if(job.attempt<6 && Date.now()-job.at<55000)setTimeout(send,Math.min(5000,500* Math.pow(2,job.attempt)));else removeJob();
                }
                void send();
            }
            function retryFlashReceipts(){var owner=currentUser,epoch=_authStateEpoch;if(!owner)return;var records=readFlashReceipts(owner);Object.keys(records).forEach(function(id){var record=records[id];if(record.presented!==false && !record.confirmed && Date.now()-record.at<55000)queueFlashReceipt(owner,epoch,id,record.view);});}
            window.addEventListener('online',retryFlashReceipts);window.addEventListener('xtj:auth-changed',retryFlashReceipts);
            function paintChatFlashQuota(){var node=document.getElementById('chatFlashQuota'),button=document.getElementById('chatFlashSendBtn');if(!node||!button)return;var q=_flashQuota&&_flashQuota.owner===currentUser?_flashQuota.data:null;node.hidden=button.hidden||!q;node.textContent=q?(q.remaining<0?'次数不限':'今日剩余 '+q.remaining+' 次'):'';}
            async function refreshChatFlashQuota(force){var owner=currentUser,epoch=_authStateEpoch;if(!owner)return;if(!force&&_flashQuota&&_flashQuota.owner===owner&&Date.now()-_flashQuota.at<10000){paintChatFlashQuota();return;}if(_flashQuotaFlight&&_flashQuotaFlight.owner===owner)return;var flight={owner:owner};_flashQuotaFlight=flight;try{var response=await window.xtjProtectedFetch('/api/chat/flash/quota',{background:true,timeoutMs:10000}),q=await response.json();if(response.ok&&q.ok&&typeof q.remaining==='number'&&Number.isFinite(q.remaining)&&currentUser===owner&&epoch===_authStateEpoch){_flashQuota={owner:owner,data:q,at:Date.now()};paintChatFlashQuota();}}catch(_){}finally{if(_flashQuotaFlight===flight)_flashQuotaFlight=null;}}
            function syncChatFlashButton(file){var b=document.getElementById('chatFlashSendBtn');if(b){b.hidden=!file||!/^image\//.test(file.type)||isBlockedDmFile(file);b.disabled=_flashSending;paintChatFlashQuota();if(!b.hidden)void refreshChatFlashQuota(false);}}
            window.sendChatFlash=async function(){
                if(_flashSending||dockChatSending||_chatBatchSending)return;
                var file=_chatAttachmentQueue[0]||(document.getElementById('dockChatFileInp').files||[])[0],owner=currentUser,peer=dockChatActiveUser,epoch=_authStateEpoch,original=isDmOriginalSendEnabled();
                if(!owner||!peer||!file||!/^image\//.test(file.type))return;
                if(file.size>20*1024*1024){showToast('闪图照片不能超过 20MB');return;}
                function active(){return _flashSendFlight===flight&&!flight.controller.signal.aborted&&currentUser===owner&&dockChatActiveUser===peer&&_authStateEpoch===epoch;}
                var client=file.__flashClientId||(file.__flashClientId='flash-'+crypto.randomUUID());
                var flight={controller:new AbortController()};_flashSendFlight=flight;
                _flashSending=true;dockChatSending=true;syncChatFlashButton(file);document.getElementById('dockChatSendBtn').disabled=true;
                var button=document.getElementById('chatFlashSendBtn');button.textContent='发送中…';
                try{
                    var prepared=await prepareDmImageForUpload(file,{original:original});if(!active())return;var uploadFile=prepared.file;
                    var form=new FormData();form.append('image',uploadFile,uploadFile.name||'flash.jpg');form.append('target_user',peer);form.append('client_id',client);
                    var response=await window.xtjProtectedFetch('/api/chat/flash/send',{method:'POST',body:form,signal:flight.controller.signal,timeoutMs:60000});var body=await response.json();if(!active())return;if(body.quota){_flashQuota={owner:owner,data:body.quota,at:Date.now()};paintChatFlashQuota();}else void refreshChatFlashQuota(true);
                    if(!response.ok||!body.ok||!body.message)throw Error(body.error||'闪图发送未确认，请重试');
                    var list=upsertDockChatCacheMessage(peer,Object.assign({},body.message,{__committedRevision:++_chatCommittedRevision}));_chatRenderSignature[peer]=undefined;renderDockMessages(peer,list,true);
                    if(_chatAttachmentQueue[0]===file){_chatAttachmentQueue.shift();var url=_chatAttachmentUrls.get(file);if(url)URL.revokeObjectURL(url);_chatAttachmentUrls.delete(file);}
                    if(_chatAttachmentQueue.length){showDockChatFilePreview(_chatAttachmentQueue[0]);renderChatAttachmentQueue();}else clearDockChatFilePreview(false);
                    showToast('闪图已发送，对方可查看一次，清晰显示 3 秒');
                }catch(error){if(active())showToast(error.message||'闪图发送失败，请重试');}
                finally{if(_flashSendFlight===flight){_flashSendFlight=null;_flashSending=false;dockChatSending=false;document.getElementById('dockChatSendBtn').disabled=false;if(button){button.textContent='闪图';button.disabled=false;}}}
            };
            window.openChatFlash=async function(id){
                if(_flashViewer||!currentUser||!/^[a-f0-9-]{36}$/i.test(String(id)))return;
                if(flashLocallyViewed(currentUser,id)){showToast('闪图已查看');retryFlashReceipts();return;}
                var owner=currentUser,peer=dockChatActiveUser,epoch=_authStateEpoch,key=owner+':'+id,opener=document.activeElement,view=_flashViewTokens.get(key)||crypto.randomUUID(),root=document.createElement('div');
                _flashViewTokens.set(key,view);if(_flashViewTokens.size>100)_flashViewTokens.delete(_flashViewTokens.keys().next().value);
                root.id='chatFlashViewer';root.className='chat-flash-viewer';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','闪图');root.innerHTML='<button type="button" class="flash-close" aria-label="关闭闪图">×</button><p class="flash-loading">正在打开闪图…</p><img alt="闪图照片"><div class="flash-clock" role="timer" hidden><span>3</span><i></i></div>';
                var controller=new AbortController(),url='',timeout,watch,closed=false,role='',receiptStarted=false,image=root.querySelector('img'),clock=root.querySelector('.flash-clock span');
                function active(){return !closed&&currentUser===owner&&_authStateEpoch===epoch&&dockChatActiveUser===peer&&!document.hidden;}
                function close(){if(closed)return;closed=true;clearTimeout(timeout);clearInterval(watch);controller.abort();image.style.visibility='hidden';image.removeAttribute('src');if(url)URL.revokeObjectURL(url);root.classList.add('is-closing');setTimeout(function(){root.remove();},150);_flashViewer=null;root.removeEventListener('keydown',keys);if(opener && opener.isConnected && currentUser===owner && epoch===_authStateEpoch)opener.focus?.({preventScroll:true});}
                function keys(event){if(event.key==='Escape'){event.preventDefault();close();}else if(event.key==='Tab'){event.preventDefault();root.querySelector('button').focus();}}
                root.addEventListener('keydown',keys);
                _flashViewer={close:close};root.querySelector('button').onclick=close;document.body.appendChild(root);root.querySelector('button').focus();
                watch=setInterval(function(){if(!active())close();},50);
                try{
                    var response=await window.xtjProtectedFetch('/api/chat/flash/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message_id:id,view_id:view}),signal:controller.signal,timeoutMs:30000,authOwner:owner,authEpoch:epoch});
                    if(!response.ok){var error=await response.json();if(response.status===410)rememberFlashConsumed(key);throw Error(error.error||'闪图不可查看');}
                    var cached=(_chatCache[getDockChatCacheKey(peer)]||[]).find(function(m){return String(m.id)===String(id);});role=response.headers.get('X-Flash-Role')||(cached&&cached.user_name===owner?'sender':'recipient');if(role!=='sender' && flashLocallyViewed(owner,id)){close();showToast('闪图已查看');return;}var blob=await response.blob();if(!active())return;
                    if(!blob.size||!/^image\//.test(blob.type))throw Error('闪图图片未加载，请重试');
                    url=URL.createObjectURL(blob);
                    // load/error handlers precede src: decode() alone can stall on Safari.
                    await new Promise(function(resolve,reject){var done=false,timer=setTimeout(function(){finish(Error('图片加载超时，请重试'));},10000);function finish(error){if(done)return;done=true;clearTimeout(timer);image.onload=image.onerror=null;error?reject(error):resolve();}image.onload=function(){if(image.naturalWidth>0)finish();else finish(Error('图片无法读取，请重试'));};image.onerror=function(){finish(Error('图片无法读取，请重试'));};image.src=url;if(typeof image.decode==='function')image.decode().then(function(){if(image.naturalWidth>0)finish();}).catch(function(){});});
                    if(!active())return;
                    if(role!=='sender'){var initialReceipts=readFlashReceipts(owner);initialReceipts[id]={view:view,at:Date.now(),presented:false,confirmed:false};if(!writeFlashReceipts(owner,initialReceipts))throw Error('浏览器无法保存查看状态，请允许本站存储后重试');}
                    root.querySelector('.flash-loading').remove();root.classList.add('is-viewing');
                    if(role==='sender'){root.classList.add('is-sender');return;}
                    // Start only after the decoded image gets an actual presentation frame.
                    await Promise.race([Promise.all(image.getAnimations?image.getAnimations().map(function(a){return a.finished.catch(function(){});}):[]),new Promise(function(resolve){setTimeout(resolve,200);})]);
                    await new Promise(function(resolve){requestAnimationFrame(function(){requestAnimationFrame(resolve);});});if(!active())return;
                    root.querySelector('.flash-clock').hidden=false;var deadline=performance.now()+3000;timeout=setTimeout(close,3000);
                    clearInterval(watch);watch=setInterval(function(){if(!active()||performance.now()>=deadline){close();return;}clock.textContent=String(Math.max(1,Math.ceil((deadline-performance.now())/1000)));},50);
                    receiptStarted=true;
                    queueFlashReceipt(owner,epoch,id,view);
                }catch(error){if(!closed){close();showToast(error.message||'闪图无法查看');}}
                finally{if(currentUser===owner&&_authStateEpoch===epoch&&dockChatActiveUser===peer){_chatRenderSignature[peer]=undefined;renderDockMessages(peer,_chatCache[getDockChatCacheKey(peer)]||[],false);}if(!active())close();}
            };
            document.addEventListener('visibilitychange',function(){if(document.hidden&&_flashViewer)_flashViewer.close();});

            function showDockChatFilePreview(file) {
                file = normalizeDockChatMediaFile(file);
                const preview = document.getElementById('dockChatFilePreview');
                const thumb = document.getElementById('dockCfpThumb');
                const name = document.getElementById('dockCfpName');
                const meta = document.getElementById('dockCfpMeta');
                if (!preview || !thumb || !name) return;
                if (_dockPreviewUrl) { URL.revokeObjectURL(_dockPreviewUrl); _dockPreviewUrl = null; }
                thumb.replaceChildren();
                if (file.type.startsWith('video/')) {
                    const icon = document.createElement('span'); icon.className = 'cfp-video-icon'; icon.textContent = '视频'; thumb.appendChild(icon);
                } else if (file.type.startsWith('audio/')) {
                    const icon = document.createElement('span'); icon.className = 'cfp-audio-icon'; icon.textContent = '音频'; thumb.appendChild(icon);
                } else if (getChatUploadKind(file) === 'file') {
                    const icon = document.createElement('span'); icon.textContent = '文件'; thumb.appendChild(icon);
                } else {
                    const img = document.createElement('img');
                    _dockPreviewUrl = URL.createObjectURL(file);
                    img.src = _dockPreviewUrl;
                    img.alt = '';
                    thumb.appendChild(img);
                }
                name.textContent = file.name || '图片';
                if (meta) {
                    var kindLabel = file.type.startsWith('video/') ? '视频' : (file.type.startsWith('audio/') ? '音频' : (getChatUploadKind(file) === 'file' ? '文件' : '图片'));
                    var sizeLabel = file.size < 1024 * 1024
                        ? Math.max(1, Math.round(file.size / 1024)) + ' KB'
                        : (file.size / (1024 * 1024)).toFixed(1) + ' MB';
                    meta.textContent = kindLabel + ' · ' + sizeLabel + ' · 准备发送';
                }
                preview.classList.remove('hidden');
                syncChatFlashButton(file);
            }

            function clearDockChatFilePreview(restoreFocus) {
                syncChatFlashButton(null);
                resetChatAttachmentQueue();
                const preview = document.getElementById('dockChatFilePreview');
                const input = document.getElementById('dockChatInput');
                const fileInput = document.getElementById('dockChatFileInp');
                _chatRecordedFile = null;
                if (_dockPreviewUrl) { URL.revokeObjectURL(_dockPreviewUrl); _dockPreviewUrl = null; }
                if (preview) preview.classList.add('hidden');
                var voiceStatus = document.getElementById('chatVoiceStatus'); if (voiceStatus && !_chatVoice) voiceStatus.hidden = true;
                if (fileInput) fileInput.value = '';
                if (restoreFocus !== false && input) input.focus();
            }

            /** Normalize clipboard/drag files (often nameless blobs) and assign into #dockChatFileInp. */
            function normalizeDockChatMediaFile(file) {
                if (!file) return null;
                var type = String(file.type || '');
                var extension = String(file.name || '').split('.').pop().toLowerCase();
                if ((!type || type === 'application/octet-stream') && CHAT_DOCUMENT_MIMES[extension]) {
                    try { file = new File([file], file.name, { type: CHAT_DOCUMENT_MIMES[extension], lastModified: file.lastModified }); type = file.type; } catch (_) {}
                }
                var name = String(file.name || '').trim();
                if (!name || name === 'blob' || name === 'image') {
                    var ext = 'bin';
                    if (type.indexOf('image/') === 0) {
                        ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
                    } else if (type.indexOf('video/') === 0) {
                        ext = (type.split('/')[1] || 'mp4').split(';')[0];
                    } else if (type.indexOf('audio/') === 0) {
                        ext = (type.split('/')[1] || 'mp3').split(';')[0];
                    }
                    name = 'paste-' + Date.now() + '.' + ext;
                    try {
                        return new File([file], name, { type: type || 'application/octet-stream', lastModified: Date.now() });
                    } catch (e) {
                        return file;
                    }
                }
                return file;
            }

            function assignDockChatFile(rawFile) {
                var fileInput = document.getElementById('dockChatFileInp');
                if (!fileInput || !rawFile) return false;
                var file = normalizeDockChatMediaFile(rawFile);
                var maxFileSize = 50 * 1024 * 1024;
                if (file.size > maxFileSize) { showToast('文件大小不能超过50MB'); return false; }
                // ★ M13：粘贴/拖拽入口统一走 isBlockedDmFile，拒绝 SVG（与文件选择入口同规则）
                if (isBlockedDmFile(file)) { showToast('不支持 SVG 文件，支持图片、视频、音频及 PDF、TXT、CSV、RTF、DOCX、XLSX、PPTX、ZIP'); return false; }
                var allowedTypes = ['image/', 'video/', 'audio/'];
                var typeOk = !!getChatUploadKind(file);
                if (!typeOk) { showToast('不支持的文件类型，支持图片、视频、音频及 PDF、TXT、CSV、RTF、DOCX、XLSX、PPTX、ZIP'); return false; }
                try {
                    var dt = new DataTransfer();
                    dt.items.add(file);
                    fileInput.files = dt.files;
                } catch (e) {
                    showToast('当前浏览器不支持粘贴/拖拽上传，请点 📷 选择文件');
                    return false;
                }
                showDockChatFilePreview(file);
                return true;
            }

            function pickFirstDockChatMedia(fileList) {
                if (!fileList || !fileList.length) return null;
                for (var i = 0; i < fileList.length; i++) {
                    var f = fileList[i];
                    if (f && getChatUploadKind(normalizeDockChatMediaFile(f))) return f;
                }
                return null;
            }

            function extractClipboardMediaFile(clipboardData) {
                if (!clipboardData) return null;
                var items = clipboardData.items;
                if (items && items.length) {
                    for (var i = 0; i < items.length; i++) {
                        var item = items[i];
                        if (item && item.kind === 'file' && /^(image|video|audio)\//.test(String(item.type || ''))) {
                            var asFile = item.getAsFile && item.getAsFile();
                            if (asFile) return asFile;
                        }
                    }
                }
                return pickFirstDockChatMedia(clipboardData.files);
            }

            function bindDockChatPasteAndDrop() {
                var input = document.getElementById('dockChatInput');
                var dropZone = document.querySelector('#dockChatDetailView .chat-input-area') ||
                    document.querySelector('#panelChat .chat-input-area');
                var dragDepth = 0;

                function onPaste(e) {
                    var clip = e.clipboardData || (window.clipboardData || null);
                    var media = extractClipboardMediaFile(clip);
                    if (!media) return;
                    e.preventDefault();
                    assignDockChatFile(media);
                }

                function hasDragFiles(e) {
                    var types = e.dataTransfer && e.dataTransfer.types;
                    if (!types) return false;
                    if (typeof types.contains === 'function') return types.contains('Files');
                    for (var i = 0; i < types.length; i++) {
                        if (types[i] === 'Files') return true;
                    }
                    return false;
                }

                function setDropActive(on) {
                    if (!dropZone) return;
                    if (on) dropZone.classList.add('is-file-dragover');
                    else dropZone.classList.remove('is-file-dragover');
                }

                if (input) {
                    input.addEventListener('paste', onPaste);
                }
                if (dropZone) {
                    dropZone.addEventListener('paste', onPaste);
                    dropZone.addEventListener('dragenter', function(e) {
                        if (!hasDragFiles(e)) return;
                        e.preventDefault();
                        dragDepth++;
                        setDropActive(true);
                    });
                    dropZone.addEventListener('dragover', function(e) {
                        if (!hasDragFiles(e)) return;
                        e.preventDefault();
                        try { e.dataTransfer.dropEffect = 'copy'; } catch (err) {}
                        setDropActive(true);
                    });
                    dropZone.addEventListener('dragleave', function(e) {
                        if (!hasDragFiles(e) && dragDepth === 0) return;
                        e.preventDefault();
                        dragDepth = Math.max(0, dragDepth - 1);
                        if (dragDepth === 0) setDropActive(false);
                    });
                    dropZone.addEventListener('drop', function(e) {
                        if (!hasDragFiles(e)) return;
                        e.preventDefault();
                        dragDepth = 0;
                        setDropActive(false);
                        var media = pickFirstDockChatMedia(e.dataTransfer && e.dataTransfer.files);
                        if (media) assignDockChatFile(media);
                        else showToast('请拖入图片、视频或音频文件');
                    });
                    dropZone.addEventListener('dragend', function() {
                        dragDepth = 0;
                        setDropActive(false);
                    });
                }
            }

            try {
                var _dsb = document.getElementById('dockChatSendBtn'); if (_dsb) _dsb.addEventListener('click', sendDockChatMessage);
                var _dci = document.getElementById('dockChatInput'); if (_dci) _dci.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDockChatMessage(); } });
                var _dib = document.getElementById('dockChatImgBtn'); if (_dib) _dib.addEventListener('click', function() { document.getElementById('dockChatFileInp').click(); });
                var _dfi = document.getElementById('dockChatFileInp'); if (_dfi) _dfi.addEventListener('change', function() { _chatRecordedFile = null; if (this.files.length) selectChatAttachments(this.files); });
                var _dcjl = document.getElementById('dockChatJumpLatest'); if (_dcjl) _dcjl.addEventListener('click', function() { if (_chatHistoryFocus) { _chatHistoryFocus = ''; loadDockChatMessages(dockChatActiveUser, true, true); } else scrollDockChatToLatest({ smooth: true }); });
                var _dcm = document.getElementById('dockChatMessages'); if (_dcm) _dcm.addEventListener('scroll', function() { if (isDockChatNearBottom(_dcm, 96)) setDockChatJumpLatestVisible(false); }, { passive: true });
                var _dcr = document.getElementById('dockCfpRemove'); if (_dcr) _dcr.addEventListener('click', clearDockChatFilePreview);
                bindDockChatPasteAndDrop();
                bindDockChatMessageActions();
                var _dockOrigBtn = document.getElementById('dockChatOrigBtn');
                if (_dockOrigBtn) _dockOrigBtn.addEventListener('click', window.toggleDmOriginalSend);
                var _socialOpen = document.getElementById('dockChatSocialBtn');
                if (_socialOpen) _socialOpen.addEventListener('click', function() { openDockChatSocialSheet('friends'); });
                var _socialClose = document.getElementById('dockChatSocialClose');
                if (_socialClose) _socialClose.addEventListener('click', closeDockChatSocialSheet);
                var _socialSheet = document.getElementById('dockChatSocialSheet');
                if (_socialSheet) _socialSheet.addEventListener('click', function(e) {
                    if (e.target === _socialSheet) { closeDockChatSocialSheet(); return; }
                    var tab = e.target && e.target.closest ? e.target.closest('[data-chat-social-tab]') : null;
                    if (tab) { openDockChatSocialSheet(tab.getAttribute('data-chat-social-tab')); return; }
                    var direction = e.target && e.target.closest ? e.target.closest('[data-chat-social-direction]') : null;
                    if (direction) {
                        _dockChatSocialRequestDirection = direction.getAttribute('data-chat-social-direction') === 'outgoing' ? 'outgoing' : 'incoming';
                        renderDockChatSocialTab('requests');
                        return;
                    }
                    var action = e.target && e.target.closest ? e.target.closest('[data-chat-social-action]') : null;
                    if (action) handleDockChatSocialAction(action);
                });
                var _socialContent = document.getElementById('dockChatSocialContent');
                if (_socialContent) _socialContent.addEventListener('submit', function(e) {
                    if (!e.target || e.target.id !== 'dockChatSocialSearchForm') return;
                    e.preventDefault();
                    var input = e.target.querySelector('input[name="q"]');
                    runDockChatSocialSearch(input ? input.value : '');
                });
                var _relationAction = document.getElementById('dockChatRelationshipAction');
                if (_relationAction) _relationAction.addEventListener('click', handleDockChatRelationshipAction);
                syncDmOriginalToggle();
            } catch(e) {
            }

            function requestDockChatSocial(path, options) {
                if (!window.currentUser) return Promise.reject(new Error('请先登录'));
                var reqOptions = Object.assign({ timeoutMs: 12000, background: true }, options || {});
                reqOptions.headers = Object.assign({ 'Content-Type': 'application/json' }, reqOptions.headers || {});
                return window.xtjProtectedFetch('/api/chat' + path, reqOptions).then(function(resp) {
                    return resp.json().catch(function() { return {}; }).then(function(data) {
                        if (!resp.ok || !data || !data.ok) {
                            var error = new Error(data && data.error || '好友操作失败，请稍后重试');
                            error.code = data && data.code || 'chat_social_failed';
                            error.draft_revision = data && data.draft_revision;
                            throw error;
                        }
                        return data;
                    });
                });
            }

            var _chatPresenceTouchedAt = 0;
            var _chatPresenceOwner = '';
            var _chatPresenceSeq = 0;
            var _chatPresenceSnapshot = null;
            var _chatTypingUntil = 0;
            var _chatTypingPeer = '';
            var _chatTypingLastSentAt = 0;
            var _chatTypingStopTimer = null;
            var _chatTypingExpireTimer = null;

            function showDockChatPresence(text,online) {
                var el = document.getElementById('dockChatPresence');
                if (!el) return;
                if (el.getAttribute('data-presence-text')!==String(text || '')) {
                    el.setAttribute('data-presence-text',text || '');
                    el.textContent=text || '';
                    if (text==='正在输入…') {
                        var dots=document.createElement('span'); dots.className='chat-typing-dots'; dots.setAttribute('aria-hidden','true');
                        dots.innerHTML='<i></i><i></i><i></i>'; el.appendChild(dots);
                    }
                }
                el.hidden = !text || !dockChatActiveUser;
                el.classList.toggle('is-online',!!online && !!text);
                el.classList.toggle('is-typing',text==='正在输入…');
            }

            function formatDockChatPresence(lastSeen) {
                var age = Date.now()-Date.parse(lastSeen || '');
                if (!Number.isFinite(age) || age<0) return '离线';
                if (age<80000) return '在线';
                if (age<180000) return '刚刚在线';
                if (age<3600000) return Math.max(1,Math.floor(age/60000))+' 分钟前在线';
                if (age<86400000) return Math.floor(age/3600000)+' 小时前在线';
                return new Date(lastSeen).toLocaleDateString()+' 在线';
            }

            function paintDockChatPresence() {
                if (!dockChatActiveUser) return;
                if (_chatTypingPeer===dockChatActiveUser && _chatTypingUntil>Date.now()) {
                    showDockChatPresence('正在输入…',false); return;
                }
                var snapshot=_chatPresenceSnapshot;
                if (!snapshot || snapshot.peer!==dockChatActiveUser) { showDockChatPresence('',false); return; }
                var text=formatDockChatPresence(snapshot.last_seen_at);
                showDockChatPresence(text,text==='在线');
            }

            function refreshDockChatPresence(peer) {
                peer=peer || dockChatActiveUser;
                if (!peer || peer!==dockChatActiveUser || !window.currentUser) return;
                var owner=window.currentUser;
                var seq=++_chatPresenceSeq;
                requestDockChatSocial('/presence/'+encodeURIComponent(peer)).then(function(data) {
                    if (owner!==window.currentUser || dockChatActiveUser!==peer || seq!==_chatPresenceSeq) return;
                    if (!data.presence) throw new Error('presence_missing');
                    _chatPresenceSnapshot={peer:peer,last_seen_at:data.presence.last_seen_at};
                    paintDockChatPresence();
                }).catch(function() {
                    if (owner!==window.currentUser || dockChatActiveUser!==peer || seq!==_chatPresenceSeq) return;
                    _chatPresenceSnapshot=null;
                    showDockChatPresence('',false);
                });
            }
            window.__xtjRefreshChatPresence=refreshDockChatPresence;

            function touchDockChatPresence() {
                if(window.__xtjSyncChatPush)window.__xtjSyncChatPush();
                openChatPushLink();
                if (!window.currentUser || document.hidden || (typeof navigator!=='undefined' && navigator.onLine===false)) return;
                var owner=window.currentUser;
                if (_chatPresenceOwner!==owner) { _chatPresenceOwner=owner; _chatPresenceTouchedAt=0; }
                if (Date.now()-_chatPresenceTouchedAt<30000) return;
                _chatPresenceTouchedAt=Date.now();
                requestDockChatSocial('/presence/heartbeat',{method:'POST',body:'{}'}).catch(function() {
                    if (window.currentUser===owner) _chatPresenceTouchedAt=0;
                });
            }
            window.__xtjChatHeartbeat=touchDockChatPresence;

            function sendDockChatTyping(active) {
                var peer=dockChatActiveUser;
                if (!peer || !window.currentUser) return;
                if (active && Date.now()-_chatTypingLastSentAt<3000) return;
                _chatTypingLastSentAt=active ? Date.now() : 0;
                requestDockChatSocial('/typing/'+encodeURIComponent(peer),{
                    method:'POST',body:JSON.stringify({active:!!active})
                }).catch(function() {});
            }
            function resetDockChatTyping() {
                sendDockChatTyping(false);
                clearTimeout(_chatTypingStopTimer); clearTimeout(_chatTypingExpireTimer);
                _chatTypingStopTimer=null; _chatTypingExpireTimer=null;
                _chatTypingLastSentAt=0; _chatTypingPeer=''; _chatTypingUntil=0;
                _chatPresenceSeq++;
            }
            window.__xtjApplyChatTyping=function(payload) {
                if (!payload || payload.peer!==dockChatActiveUser || !window.currentUser || document.hidden || currentDockTab!=='chat') return;
                var at=Number(payload.at);
                if (!Number.isFinite(at) || Math.abs(Date.now()-at)>15000) return;
                clearTimeout(_chatTypingExpireTimer);
                _chatTypingPeer=payload.peer;
                _chatTypingUntil=payload.active ? Date.now()+4700 : 0;
                paintDockChatPresence();
                if (payload.active) _chatTypingExpireTimer=setTimeout(function() {
                    _chatTypingUntil=0; _chatTypingExpireTimer=null; paintDockChatPresence();
                },4700);
            };
            setInterval(function() {
                touchDockChatPresence();
                if (dockChatActiveUser && !document.hidden) {
                    if (_chatTypingUntil<=Date.now()) paintDockChatPresence();
                    refreshDockChatPresence(dockChatActiveUser);
                }
            },35000);
            document.addEventListener('visibilitychange',function() {
                if (!document.hidden) { touchDockChatPresence(); refreshDockChatPresence(); }
                else { resetDockChatTyping(); cancelDockChatSendFlights(); paintDockChatPresence(); }
            });
            window.addEventListener('online',function() { touchDockChatPresence(); refreshDockChatPresence(); });
            setTimeout(touchDockChatPresence,1500);

            window.__xtjRefreshChatSocialState=function() {
                refreshChatSocialBadge(true);
                refreshChatFriendNotes(true);
                if (dockChatActiveUser) {
                    _chatPresenceSnapshot=null;
                    showDockChatPresence('',false);
                    refreshDockChatPresence(dockChatActiveUser);
                    updateDockChatComposerPermission(dockChatActiveUser);
                }
                var sheet=document.getElementById('dockChatSocialSheet');
                if (sheet && !sheet.classList.contains('hidden')) renderDockChatSocialTab(_dockChatSocialTab);
            };

            function closeDockChatConversationMenu(immediate) {
                var menu = document.getElementById('dockChatConversationMenu');
                var opener = document.getElementById('dockChatConversationBtn');
                if (opener) opener.setAttribute('aria-expanded','false');
                if (menu && menu.contains(document.activeElement) && opener && !opener.hidden) opener.focus({preventScroll:true});
                transitionChatSurface(menu,false,immediate===true);
            }

            function openDockChatConversationMenu(peer) {
                if (!peer || peer!==dockChatActiveUser) return;
                var state = _dockChatConversationStates[peer] || {};
                var menu = document.getElementById('dockChatConversationMenu');
                var title = document.getElementById('dockChatConversationMenuTitle');
                var actions = document.getElementById('dockChatConversationMenuActions');
                if (!menu || !actions) return;
                menu.setAttribute('data-peer', peer);
                if (title) title.textContent = _dockChatFriendNotes[peer] || peer;
                var items = [
                    ['search','搜索聊天记录'],['media','图片、文件与链接'],
                    [state.pinned_at ? 'unpin' : 'pin',state.pinned_at ? '取消置顶' : '置顶聊天'],
                    [state.muted_until ? 'unmute' : 'mute',state.muted_until ? '取消免打扰' : '消息免打扰'],
                    [Number(state.unread_count) || state.manual_unread_at ? 'mark_read' : 'mark_unread',Number(state.unread_count) || state.manual_unread_at ? '标记已读' : '标记未读'],
                    ['hold_voice',isChatHoldVoiceEnabled() ? '长按录音：已开启' : '长按录音：已关闭'],
                    ['push_notifications',_chatPushEnabled ? '系统消息通知：已开启' : '开启系统消息通知'],
                    ['clear','清空我的聊天记录'],['delete','删除我的会话']
                ];
                actions.innerHTML = items.map(function(item) {
                    return '<button type="button" data-chat-conversation-action="' + item[0] + '"' + (item[0]==='clear' || item[0]==='delete' ? ' class="is-destructive"' : '') + '><span>' + item[1] + '</span><span aria-hidden="true" class="conversation-action-arrow">›</span></button>';
                }).join('');
                var opener=document.getElementById('dockChatConversationBtn');
                if (opener) opener.setAttribute('aria-expanded','true');
                transitionChatSurface(menu,true);
                var first = actions.querySelector('button'); if (first) first.focus({preventScroll:true});
            }

            async function mutateDockChatConversation(peer, action) {
                if (action === 'clear' && !window.confirm('清空你看到的聊天记录？对方的记录不会删除。')) return;
                if (action === 'delete' && !window.confirm('删除你列表中的会话？对方的记录不会删除。')) return;
                var owner = window.currentUser;
                try {
                    var data = await requestDockChatSocial('/conversations/' + encodeURIComponent(peer), {
                        method:'PATCH',body:JSON.stringify({action:action}),background:false
                    });
                    if (window.currentUser !== owner) return;
                    _dockChatConversationStates[peer] = data.state;
                    if (window.__xtjMutedChatPeers) {
                        if (data.state.muted_until || data.state.deleted) window.__xtjMutedChatPeers[peer] = true;
                        else delete window.__xtjMutedChatPeers[peer];
                    }
                    closeDockChatConversationMenu();
                    if (action === 'clear' || action === 'delete') {
                        forgetDockChatConversationMessages(peer);
                        if (dockChatActiveUser === peer) {
                            if (action === 'delete') {
                                if (_dockChatDraftTimer) { clearTimeout(_dockChatDraftTimer); _dockChatDraftTimer = null; }
                                var input = document.getElementById('dockChatInput');
                                if (input) input.value = '';
                                dockChatGoBack();
                            }
                            else loadDockChatMessages(peer,true);
                        }
                    }
                    if (typeof window.__xtjInvalidateDmListShared === 'function') window.__xtjInvalidateDmListShared();
                    scheduleDockChatListRefresh(0);
                } catch (error) { showToast(error.message || '会话操作失败'); }
            }

            function persistDockChatDraft(peer, value) {
                var owner = window.currentUser;
                if (!peer || !owner) return;
                var key = owner + '\u0000' + peer;
                var previous = _dockChatDraftWrites[key] || Promise.resolve();
                var write = previous.catch(function() {}).then(function() {
                    if (window.currentUser !== owner) return;
                    var state = _dockChatConversationStates[peer] || { draft_revision:0 };
                    var revision = Number(state.draft_revision) || 0;
                    return requestDockChatSocial('/conversations/' + encodeURIComponent(peer), {
                        method:'PATCH',body:JSON.stringify({action:'draft',draft_text:value,draft_revision:revision}),background:false
                    }).then(function(data) {
                        if (window.currentUser !== owner) return;
                        if (_dockChatConversationStates[peer] && _dockChatConversationStates[peer].deleted) return;
                        _dockChatConversationStates[peer] = Object.assign({},state,data.state);
                        delete _dockChatDraftConflicts[key];
                        if (typeof window.__xtjInvalidateDmListShared === 'function') window.__xtjInvalidateDmListShared();
                        if (dockChatActiveUser !== peer) scheduleDockChatListRefresh(0);
                    }).catch(function(error) {
                        if (window.currentUser !== owner) return;
                        if (error.code === 'revision_conflict') {
                            _dockChatConversationStates[peer] = Object.assign({},state,{ draft_revision:error.draft_revision });
                            _dockChatDraftConflicts[key] = value;
                            showToast('草稿在其他设备已更新，本机输入已保留；请编辑后重试');
                        } else if (error.code !== 'not_found' && error.code !== 'deleted') showToast('草稿保存失败，请稍后重试');
                    });
                });
                _dockChatDraftWrites[key] = write;
                return write;
            }

            function restoreDockChatDraft(peer) {
                if (_dockChatDraftTimer) { clearTimeout(_dockChatDraftTimer); _dockChatDraftTimer = null; }
                var input = document.getElementById('dockChatInput');
                if (input) input.value = '';
                var owner = window.currentUser;
                var seq = ++_dockChatDraftLoadSeq;
                requestDockChatSocial('/conversations/' + encodeURIComponent(peer)).then(function(data) {
                    if (owner !== window.currentUser || dockChatActiveUser !== peer || seq !== _dockChatDraftLoadSeq) return;
                    var local = _dockChatConversationStates[peer] || {};
                    if ((Number(local.draft_revision) || 0) > (Number(data.state.draft_revision) || 0)) return;
                    _dockChatConversationStates[peer] = Object.assign({},local,data.state);
                    if (input && !input.value) {
                        var conflictKey = owner + '\u0000' + peer;
                        input.value = Object.prototype.hasOwnProperty.call(_dockChatDraftConflicts,conflictKey)
                            ? _dockChatDraftConflicts[conflictKey] : (data.state.draft_text || '');
                    }
                }).catch(function(error) { if (error.code !== 'not_found') console.warn('[chat] draft load failed',error); });
            }

            var _conversationOpen = document.getElementById('dockChatConversationBtn');
            if (_conversationOpen) _conversationOpen.addEventListener('click',function() {
                if (_conversationOpen.getAttribute('aria-expanded')==='true') closeDockChatConversationMenu();
                else openDockChatConversationMenu(dockChatActiveUser);
            });
            var _conversationClose = document.getElementById('dockChatConversationMenuClose');
            if (_conversationClose) _conversationClose.addEventListener('click',closeDockChatConversationMenu);
            var _conversationMenu = document.getElementById('dockChatConversationMenu');
            if (_conversationMenu) _conversationMenu.addEventListener('click',function(event) {
                if (event.target === _conversationMenu) { closeDockChatConversationMenu(); return; }
                var button = event.target.closest('[data-chat-conversation-action]');
                if (button) {
                    var action=button.getAttribute('data-chat-conversation-action');
                    if (action==='search' || action==='media') { closeDockChatConversationMenu(true); openChatHistory(action==='media'); }
                    else if (action==='push_notifications') { toggleChatPush().then(function(){openDockChatConversationMenu(dockChatActiveUser);}); }
                    else if (action==='hold_voice') { localStorage.setItem('xtj_chat_hold_voice',isChatHoldVoiceEnabled() ? 'off' : 'on'); openDockChatConversationMenu(dockChatActiveUser); }
                    else mutateDockChatConversation(_conversationMenu.getAttribute('data-peer'),action);
                }
            });
            if (_conversationMenu) _conversationMenu.addEventListener('keydown',function(event) {
                if (event.key==='Escape') { event.preventDefault(); closeDockChatConversationMenu(); }
                if (event.key==='Tab') {
                    var buttons=Array.prototype.slice.call(_conversationMenu.querySelectorAll('button:not([disabled])'));
                    var first=buttons[0],last=buttons[buttons.length-1];
                    if (event.shiftKey && document.activeElement===first) { event.preventDefault(); last.focus(); }
                    else if (!event.shiftKey && document.activeElement===last) { event.preventDefault(); first.focus(); }
                }
            });
            var _conversationInput = document.getElementById('dockChatInput');
            if (_conversationInput) _conversationInput.addEventListener('input',function() {
                var peer = dockChatActiveUser;
                var value = _conversationInput.value;
                if (_chatTypingStopTimer) clearTimeout(_chatTypingStopTimer);
                if (value.trim() && !_chatEditDraft) {
                    sendDockChatTyping(true);
                    _chatTypingStopTimer=setTimeout(function() {
                        if (dockChatActiveUser===peer) sendDockChatTyping(false);
                    },4200);
                } else sendDockChatTyping(false);
                if (_dockChatDraftTimer) clearTimeout(_dockChatDraftTimer);
                _dockChatDraftTimer = setTimeout(function() { persistDockChatDraft(peer,value); },650);
            });

            function refreshChatSocialBadge(force) {
                var badge = document.getElementById('dockChatSocialPendingBadge');
                if (!badge) return Promise.resolve();
                var owner = window.currentUser || '';
                if (!owner) {
                    badge.hidden = true;
                    badge.textContent = '0';
                    _dockChatSocialBadgeOwner = '';
                    _dockChatSocialBadgeAt = 0;
                    return Promise.resolve();
                }
                if (!force && _dockChatSocialBadgeOwner === owner && Date.now() - _dockChatSocialBadgeAt < 60000) return Promise.resolve();
                _dockChatSocialBadgeOwner = owner;
                return requestDockChatSocial('/requests?direction=incoming').then(function(data) {
                    if (window.currentUser !== owner) return;
                    var count = Array.isArray(data.requests) ? data.requests.length : 0;
                    badge.textContent = count > 99 ? '99+' : String(count);
                    badge.hidden = count === 0;
                    _dockChatSocialBadgeAt = Date.now();
                }).catch(function() {});
            }

            function applyDockChatFriendLabels() {
                var list = document.getElementById('dockChatList');
                if (list) Array.prototype.forEach.call(list.querySelectorAll('.chat-list-item[data-chat-user]'), function(row) {
                    var userName = row.getAttribute('data-chat-user') || '';
                    var name = row.querySelector('.cli-name-text');
                    if (name) {
                        name.textContent = _dockChatFriendNotes[userName] || userName;
                        name.title = userName;
                    }
                });
                if (dockChatActiveUser) {
                    var title = document.getElementById('dockChatTitle');
                    if (title) title.textContent = _dockChatFriendNotes[dockChatActiveUser] || dockChatActiveUser;
                }
                _dockChatListRenderSignature = '';
            }

            function refreshChatFriendNotes(force) {
                var owner = window.currentUser || '';
                if (!owner) {
                    _dockChatFriendNotes = Object.create(null);
                    _dockChatFriendNotesOwner = '';
                    _dockChatFriendNotesAt = 0;
                    return Promise.resolve();
                }
                if (!force && _dockChatFriendNotesOwner === owner && Date.now() - _dockChatFriendNotesAt < 60000) return Promise.resolve();
                return requestDockChatSocial('/friends').then(function(data) {
                    if (window.currentUser !== owner) return;
                    var next = Object.create(null);
                    (Array.isArray(data.friends) ? data.friends : []).forEach(function(friend) {
                        if (friend && friend.peer_name && friend.note) next[String(friend.peer_name)] = String(friend.note);
                    });
                    _dockChatFriendNotes = next;
                    _dockChatFriendNotesOwner = owner;
                    _dockChatFriendNotesAt = Date.now();
                    applyDockChatFriendLabels();
                }).catch(function() {});
            }

            function openDockChatSocialSheet(tab) {
                if (!window.currentUser) { showToast('请先登录后管理好友'); return; }
                var sheet = document.getElementById('dockChatSocialSheet');
                if (!sheet) return;
                // Switching an already visible tab must not replay the dialog entrance.
                if (sheet.hidden || sheet.classList.contains('hidden') || sheet.inert) transitionChatSurface(sheet,true);
                renderDockChatSocialTab(tab || 'friends');
                refreshChatSocialBadge(true);
                setTimeout(function() {
                    if (!sheet.hidden && !sheet.inert && !sheet.classList.contains('hidden') && _dockChatSocialTab === 'search') {
                        var input = document.querySelector('#dockChatSocialSearchForm input[name="q"]');
                        if (input) input.focus({ preventScroll: true });
                    }
                }, 30);
            }

            window.openProfileBlocks = function() {
                if (window.__xtjAiChatActive && window.__xtjCloseAiChat) window.__xtjCloseAiChat();
                switchDockTab('chat',true,{animate:true});
                openDockChatSocialSheet('blocks');
            };

            function closeDockChatSocialSheet() {
                var sheet = document.getElementById('dockChatSocialSheet');
                if (!sheet) return;
                var rail=document.getElementById('dockChatSocialTabs');
                if(rail&&rail.__xtjCancelSlider)rail.__xtjCancelSlider();
                transitionChatSurface(sheet,false);
                _dockChatSocialLoadSeq++;
                var opener = document.getElementById('dockChatSocialBtn');
                if (opener && document.activeElement && document.activeElement.closest && document.activeElement.closest('#dockChatSocialSheet')) {
                    opener.focus({ preventScroll: true });
                }
            }

            function bindDockChatSocialSlider() {
                var rail=document.getElementById('dockChatSocialTabs');if(!rail||rail.__xtjSliderBound)return;
                rail.__xtjSliderBound=true;var slider=rail.querySelector('.chat-social-slider'),tabs=['search','friends','requests','blocks'];
                var pointer=null,startX=0,startLeft=0,left=0,moved=false,startTab='',suppressClickUntil=0;
                function cellWidth(){return Math.max(1,(rail.clientWidth-8)/4);}
                function release(event,cancelled){
                    if(pointer===null||event.pointerId!==pointer)return;
                    var id=pointer;pointer=null;rail.classList.remove('is-dragging');
                    slider.style.transform='';slider.style.removeProperty('--liquid-stretch');
                    rail.querySelectorAll('[data-drag-active]').forEach(function(b){b.removeAttribute('data-drag-active');});
                    suppressClickUntil=Date.now()+400;
                    if(!cancelled)renderDockChatSocialTab(moved?tabs[Math.max(0,Math.min(3,Math.round(left/cellWidth())))]:startTab);
                    if(rail.hasPointerCapture&&rail.hasPointerCapture(id))rail.releasePointerCapture(id);
                }
                rail.addEventListener('pointerdown',function(event){
                    if((event.pointerType==='mouse'&&event.button!==0)||pointer!==null)return;
                    pointer=event.pointerId;startX=event.clientX;moved=false;
                    startLeft=left=Math.max(0,tabs.indexOf(_dockChatSocialTab))*cellWidth();
                    var hit=event.target.closest('[data-chat-social-tab]');startTab=hit?hit.dataset.chatSocialTab:_dockChatSocialTab;
                    try{rail.setPointerCapture(pointer);}catch(_){}
                });
                rail.addEventListener('pointermove',function(event){
                    if(event.pointerId!==pointer)return;var dx=event.clientX-startX;
                    if(!moved&&Math.abs(dx)<4)return;moved=true;rail.classList.add('is-dragging');
                    left=Math.max(0,Math.min(cellWidth()*3,startLeft+dx));
                    var stretch=matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.getAttribute('data-xtj-motion')==='off'?1:1+Math.min(.055,Math.abs(dx)/cellWidth()*.02);
                    slider.style.transform='translate3d('+left+'px,0,0) scaleX('+stretch+')';
                    rail.querySelectorAll('[data-chat-social-tab]').forEach(function(b,i){b.toggleAttribute('data-drag-active',i===Math.round(left/cellWidth()));});
                });
                rail.addEventListener('pointerup',function(e){release(e,false);});rail.addEventListener('pointercancel',function(e){release(e,true);});rail.addEventListener('lostpointercapture',function(e){release(e,true);});
                rail.__xtjCancelSlider=function(){if(pointer!==null)release({pointerId:pointer},true);};
                window.addEventListener('resize',rail.__xtjCancelSlider);
                window.addEventListener('blur',rail.__xtjCancelSlider);
                rail.addEventListener('click',function(e){if(e.detail!==0&&Date.now()<suppressClickUntil){e.preventDefault();e.stopPropagation();}},true);
                rail.addEventListener('keydown',function(event){
                    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();var i=Math.max(0,tabs.indexOf(_dockChatSocialTab));
                    i=event.key==='Home'?0:event.key==='End'?3:(i+(event.key==='ArrowRight'?1:3))%4;renderDockChatSocialTab(tabs[i]);rail.querySelector('[data-chat-social-tab="'+tabs[i]+'"]').focus({preventScroll:true});
                });
            }

            function setDockChatSocialTabState(tab) {
                _dockChatSocialTab = ['search', 'friends', 'requests', 'blocks'].indexOf(tab) >= 0 ? tab : 'search';
                bindDockChatSocialSlider();
                var rail = document.getElementById('dockChatSocialTabs');
                if (rail) rail.style.setProperty('--social-tab-index', String(['search','friends','requests','blocks'].indexOf(_dockChatSocialTab)));
                var panel = document.getElementById('dockChatSocialContent');
                if (panel) panel.setAttribute('aria-labelledby', 'social-tab-' + _dockChatSocialTab);
                Array.prototype.forEach.call(document.querySelectorAll('[data-chat-social-tab]'), function(button) {
                    var active = button.getAttribute('data-chat-social-tab') === _dockChatSocialTab;
                    button.id = 'social-tab-' + button.getAttribute('data-chat-social-tab');
                    button.setAttribute('aria-controls', 'dockChatSocialContent');
                    button.setAttribute('aria-selected', active ? 'true' : 'false');
                    button.tabIndex = active ? 0 : -1;
                });
            }

            function chatSocialActionButton(label, action, peer, requestId, className, note) {
                return '<button type="button" class="chat-social-action' + (className ? ' ' + className : '') + '" data-chat-social-action="' + escapeHtml(action) + '"' +
                    (peer ? ' data-peer="' + escapeHtml(peer) + '"' : '') +
                    (requestId ? ' data-request-id="' + escapeHtml(requestId) + '"' : '') +
                    (note ? ' data-note="' + escapeHtml(note) + '"' : '') + '>' + escapeHtml(label) + '</button>';
            }

            async function showChatMutualFriends(peer, cursor) {
                var owner = window.currentUser, seq = ++_dockChatSocialLoadSeq;
                var content = document.getElementById('dockChatSocialContent');
                if (!cursor) content.replaceChildren();
                try {
                    var result = await chatFeatureApi('friends/mutual?peer=' + encodeURIComponent(peer) + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
                    if (owner !== window.currentUser || seq !== _dockChatSocialLoadSeq) return;
                    content.querySelectorAll('.chat-mutual-more').forEach(function(b) { b.remove(); });
                    if (!cursor) { var title = document.createElement('p'); title.textContent = '与 ' + peer + ' 的共同好友'; content.appendChild(title); }
                    result.items.forEach(function(n) { var row = document.createElement('p'); row.textContent = n; content.appendChild(row); });
                    if (!result.items.length && !cursor) { var empty = document.createElement('p'); empty.textContent = '暂无共同好友'; content.appendChild(empty); }
                    if (result.has_more) { var more = document.createElement('button'); more.className = 'chat-mutual-more'; more.textContent = '加载更多'; more.onclick = function() { more.disabled = true; showChatMutualFriends(peer,result.cursor); }; content.appendChild(more); }
                } catch (error) { if (owner === window.currentUser && seq === _dockChatSocialLoadSeq) content.textContent = error.message; }
            }

            function chatSocialUserRow(userName, meta, actions, displayName) {
                var avatar = '?';
                try { avatar = getDockChatAvatarMarkup(userName); } catch (_) { avatar = escapeHtml(String(userName || '?').slice(0, 1).toUpperCase()); }
                return '<div class="chat-social-user" data-social-user="' + escapeHtml(userName) + '">' +
                    '<div class="chat-social-avatar">' + avatar + '</div>' +
                    '<div class="chat-social-info"><span class="chat-social-name" title="' + escapeHtml(userName) + '">' + escapeHtml(displayName || userName) + '</span>' +
                    '<span class="chat-social-meta">' + escapeHtml(meta || userName) + '</span></div>' +
                    '<div class="chat-social-actions">' + ((actions || []).length>3 ? actions[0] + '<details class="chat-contact-options"><summary aria-label="联系人设置">设置</summary><div>' + actions.slice(1).join('') + '</div></details>' : (actions || []).join('')) + '</div></div>';
            }

            function hydrateDockChatSocialAvatars(users) {
                if (!users || !users.length || typeof hydrateDockChatAvatars !== 'function') return;
                hydrateDockChatAvatars(users, function() {
                    Array.prototype.forEach.call(document.querySelectorAll('#dockChatSocialContent .chat-social-user[data-social-user]'), function(row) {
                        var avatar = row.querySelector('.chat-social-avatar');
                        var userName = row.getAttribute('data-social-user');
                        if (avatar && userName) {
                            var markup = getDockChatAvatarMarkup(userName);
                            if (avatar.dataset.avatarMarkup !== markup) { avatar.innerHTML = markup; avatar.dataset.avatarMarkup = markup; }
                        }
                    });
                });
            }

            var _chatSocialPanels = new Map();
            function updateChatSocialPanel(content, markup) {
                // Compare the unhydrated render, not live HTML containing loaded avatars.
                if (content.dataset.renderMarkup !== markup) {
                    content.innerHTML = markup;
                    content.dataset.renderMarkup = markup;
                }
            }
            function renderDockChatSocialTab(tab) {
                if (!window.currentUser) { closeDockChatSocialSheet(); return; }
                var content = document.getElementById('dockChatSocialContent');
                if (content && content.dataset.panelKey) _chatSocialPanels.set(content.dataset.panelKey,{nodes:Array.from(content.childNodes),markup:content.dataset.renderMarkup || ''});
                setDockChatSocialTabState(tab);
                if (!content) return;
                var panelKey=window.currentUser+'\u0000'+_dockChatSocialTab+(_dockChatSocialTab==='requests' ? '\u0000'+_dockChatSocialRequestDirection : '');
                var saved=_chatSocialPanels.get(panelKey);
                if (content.dataset.panelKey !== panelKey) {
                    content.dataset.panelKey=panelKey;
                    content.replaceChildren.apply(content,saved ? saved.nodes : []);
                    content.dataset.renderMarkup=saved ? saved.markup : '';
                }
                content.setAttribute('aria-busy','true');
                var seq = ++_dockChatSocialLoadSeq;
                if (saved && _dockChatSocialTab==='search') { content.setAttribute('aria-busy','false'); return; }
                if (_dockChatSocialTab === 'search') {
                    content.innerHTML = '<form id="dockChatSocialSearchForm" class="chat-social-search-form" autocomplete="off">' +
                        '<input name="q" type="search" minlength="2" maxlength="64" placeholder="输入用户名，至少 2 个字符" value="' + escapeHtml(_dockChatSocialQuery) + '" aria-label="搜索用户名">' +
                        '<button type="submit">搜索</button></form><div id="dockChatSocialResults" class="chat-social-results"><div class="chat-social-empty">搜索公开用户名，查看好友关系并发送申请。</div></div>';
                    content.dataset.renderMarkup='';
                    content.setAttribute('aria-busy','false');
                    if (_dockChatSocialQuery) loadDockChatSocialSearch(_dockChatSocialQuery, seq);
                    return;
                }
                if (!saved) content.innerHTML = '<div class="chat-social-empty">联系人会显示在这里</div>';
                content.setAttribute('aria-busy','false');
                if (_dockChatSocialTab === 'friends') {
                    requestDockChatSocial('/friends').then(function(data) {
                        if (seq !== _dockChatSocialLoadSeq || _dockChatSocialTab !== 'friends' || window.currentUser == null) return;
                        var friends = Array.isArray(data.friends) ? data.friends : [];
                        var next = Object.create(null);
                        friends.forEach(function(friend) { if (friend && friend.peer_name && friend.note) next[String(friend.peer_name)] = String(friend.note); });
                        _dockChatFriendNotes = next;
                        _dockChatFriendNotesOwner = window.currentUser;
                        _dockChatFriendNotesAt = Date.now();
                        applyDockChatFriendLabels();
                        if (!friends.length) {
                            updateChatSocialPanel(content,'<div class="chat-social-empty">还没有好友。搜索用户名后发送好友申请即可开始聊天。</div>');
                            return;
                        }
                        var friendMarkup = friends.map(function(friend) {
                            var name = String(friend.peer_name || '');
                            var note = String(friend.note || '');
                            var actions = [
                                chatSocialActionButton('聊天', 'friend-chat', name, '', 'primary'),
                                chatSocialActionButton('资料', 'friend-profile', name),
                                chatSocialActionButton('共同好友', 'friend-mutual', name),
                                chatSocialActionButton('备注', 'friend-note', name, '', '', note),
                                chatSocialActionButton('删除', 'friend-remove', name, '', 'danger'),
                                chatSocialActionButton('拉黑', 'friend-block', name, '', 'danger')
                            ];
                            return chatSocialUserRow(name, note ? '账号：' + name : '已添加为好友', actions, note || name);
                        }).join('');
                        updateChatSocialPanel(content,friendMarkup);
                        hydrateDockChatSocialAvatars(friends.map(function(friend) { return friend.peer_name; }));
                    }).catch(function() {
                        if (seq === _dockChatSocialLoadSeq) updateChatSocialPanel(content,'<div class="chat-social-error">好友列表加载失败，请切换标签或重新打开。</div>');
                    });
                    return;
                }
                if (_dockChatSocialTab === 'requests') {
                    if (!saved) content.innerHTML = '<div class="chat-social-request-switch">' +
                        '<button type="button" data-chat-social-direction="incoming" aria-pressed="' + (_dockChatSocialRequestDirection === 'incoming') + '">收到的申请</button>' +
                        '<button type="button" data-chat-social-direction="outgoing" aria-pressed="' + (_dockChatSocialRequestDirection === 'outgoing') + '">发出的申请</button></div>' +
                        '<div class="chat-social-empty">好友申请会显示在这里</div>';
                    requestDockChatSocial('/requests?direction=' + _dockChatSocialRequestDirection).then(function(data) {
                        if (seq !== _dockChatSocialLoadSeq || _dockChatSocialTab !== 'requests') return;
                        var rows = Array.isArray(data.requests) ? data.requests : [];
                        if (_dockChatSocialRequestDirection === 'incoming') refreshChatSocialBadge(true);
                        var html = rows.map(function(request) {
                            var incoming = _dockChatSocialRequestDirection === 'incoming';
                            var peer = incoming ? request.requester_name : request.target_name;
                            var actions = incoming ? [
                                chatSocialActionButton('接受', 'request-accept', peer, request.request_id, 'primary'),
                                chatSocialActionButton('拒绝', 'request-reject', peer, request.request_id, 'danger'),
                                chatSocialActionButton('拉黑', 'request-block', peer, request.request_id, 'danger')
                            ] : [chatSocialActionButton('取消申请', 'request-cancel', peer, request.request_id, 'danger')];
                            return chatSocialUserRow(peer, request.request_note || (incoming ? '等待你处理' : '等待对方处理'), actions, peer);
                        }).join('');
                        var switchHtml = '<div class="chat-social-request-switch">' +
                            '<button type="button" data-chat-social-direction="incoming" aria-pressed="' + (_dockChatSocialRequestDirection === 'incoming') + '">收到的申请</button>' +
                            '<button type="button" data-chat-social-direction="outgoing" aria-pressed="' + (_dockChatSocialRequestDirection === 'outgoing') + '">发出的申请</button></div>';
                        updateChatSocialPanel(content,switchHtml + (html || '<div class="chat-social-empty">' + (_dockChatSocialRequestDirection === 'incoming' ? '暂时没有收到好友申请。' : '暂时没有发出的好友申请。') + '</div>'));
                        hydrateDockChatSocialAvatars(rows.map(function(request) { return _dockChatSocialRequestDirection === 'incoming' ? request.requester_name : request.target_name; }));
                    }).catch(function() {
                        if (seq === _dockChatSocialLoadSeq) updateChatSocialPanel(content,'<div class="chat-social-error">好友申请加载失败，请稍后重试。</div>');
                    });
                    return;
                }
                requestDockChatSocial('/blocks').then(function(data) {
                    if (seq !== _dockChatSocialLoadSeq || _dockChatSocialTab !== 'blocks') return;
                    var blocks = Array.isArray(data.blocks) ? data.blocks : [];
                    updateChatSocialPanel(content,blocks.length ? blocks.map(function(block) {
                        var name = String(block.peer_name || '');
                        return chatSocialUserRow(name, '已拉黑，不能互相申请或发送新消息', [chatSocialActionButton('解除拉黑', 'block-remove', name, '', 'primary')], name);
                    }).join('') : '<div class="chat-social-empty">黑名单为空。</div>');
                    hydrateDockChatSocialAvatars(blocks.map(function(block) { return block.peer_name; }));
                }).catch(function() {
                    if (seq === _dockChatSocialLoadSeq) updateChatSocialPanel(content,'<div class="chat-social-error">黑名单加载失败，请稍后重试。</div>');
                });
            }

            function loadDockChatSocialSearch(query, seq) {
                var q = String(query || '').trim();
                _dockChatSocialQuery = q;
                var results = document.getElementById('dockChatSocialResults');
                if (!results) return;
                if (q.length < 2) {
                    results.innerHTML = '<div class="chat-social-error">请输入至少 2 个字符。</div>';
                    return;
                }
                results.innerHTML = '<div class="chat-social-loading">正在搜索…</div>';
                var owner = window.currentUser;
                requestDockChatSocial('/users/search?q=' + encodeURIComponent(q)).then(function(data) {
                    if (seq !== _dockChatSocialLoadSeq || window.currentUser !== owner || _dockChatSocialTab !== 'search') return;
                    var users = Array.isArray(data.users) ? data.users : [];
                    if (!users.length) {
                        results.innerHTML = '<div class="chat-social-empty">没有找到匹配的公开用户名。</div>';
                        return;
                    }
                    results.innerHTML = users.map(function(user) {
                        var name = String(user.user_name || '');
                        var relation = String(user.relationship || 'none');
                        var actions;
                        var meta;
                        if (relation === 'friends') {
                            actions = [chatSocialActionButton('聊天', 'friend-chat', name, '', 'primary'), chatSocialActionButton('资料', 'friend-profile', name)];
                            meta = '已是好友';
                        } else if (relation === 'request_sent') {
                            actions = [chatSocialActionButton('已发送', 'noop', name, '', '', '')];
                            meta = '等待对方处理';
                        } else if (relation === 'request_received') {
                            actions = [chatSocialActionButton('处理申请', 'requests-open', name, '', 'primary')];
                            meta = '对方已向你发送好友申请';
                        } else {
                            actions = [chatSocialActionButton('添加好友', 'friend-request', name, '', 'primary'), chatSocialActionButton('资料', 'friend-profile', name)];
                            meta = '注册用户';
                        }
                        return chatSocialUserRow(name, meta, actions, name);
                    }).join('');
                    hydrateDockChatSocialAvatars(users.map(function(user) { return user.user_name; }));
                }).catch(function(error) {
                    if (seq === _dockChatSocialLoadSeq && window.currentUser === owner) {
                        results.innerHTML = '<div class="chat-social-error">' + escapeHtml(error && error.message || '搜索失败，请稍后重试。') + '</div>';
                    }
                });
            }

            function runDockChatSocialSearch(query) {
                _dockChatSocialQuery = String(query || '').trim();
                var seq = ++_dockChatSocialLoadSeq;
                loadDockChatSocialSearch(_dockChatSocialQuery, seq);
            }

            async function sendDockChatFriendRequest(userName, fromComposer) {
                try {
                    var result = await requestDockChatSocial('/friend-requests', {
                        method: 'POST',
                        body: JSON.stringify({ target_user: userName })
                    });
                    var status = result.result && result.result.status;
                    showToast(status === 'accepted' || status === 'already_friends' ? '你们已经成为好友' : '好友申请已发送');
                    refreshChatSocialBadge(true);
                    refreshChatFriendNotes(true);
                    if (fromComposer && dockChatActiveUser === userName) updateDockChatComposerPermission(userName);
                    if (_dockChatSocialTab === 'search') {
                        var seq = ++_dockChatSocialLoadSeq;
                        loadDockChatSocialSearch(_dockChatSocialQuery, seq);
                    } else {
                        var currentSheet = document.getElementById('dockChatSocialSheet');
                        if (currentSheet && !currentSheet.classList.contains('hidden')) renderDockChatSocialTab(_dockChatSocialTab);
                    }
                    return true;
                } catch (e) {
                    showToast(e && e.message || '好友申请发送失败');
                    return false;
                }
            }

            async function handleDockChatSocialAction(button) {
                var action = button.getAttribute('data-chat-social-action') || '';
                var peer = button.getAttribute('data-peer') || '';
                var requestId = button.getAttribute('data-request-id') || '';
                if (action === 'noop' || !action) return;
                if (action === 'friend-chat') {
                    closeDockChatSocialSheet();
                    if (typeof window.openChat === 'function') window.openChat(peer);
                    return;
                }
                if (action === 'friend-profile') {
                    closeDockChatSocialSheet();
                    if (typeof window.openUserProfile === 'function') window.openUserProfile(peer);
                    return;
                }
                if (action === 'requests-open') { renderDockChatSocialTab('requests'); return; }
                if (action === 'friend-request') { await sendDockChatFriendRequest(peer, false); return; }
                if (action === 'friend-mutual') { await showChatMutualFriends(peer); return; }
                if (action === 'friend-note') {
                    var existingNote = button.getAttribute('data-note') || '';
                    var nextNote = window.prompt('设置仅自己可见的好友备注（留空可清除）', existingNote);
                    if (nextNote === null) return;
                    try {
                        await requestDockChatSocial('/friends/' + encodeURIComponent(peer) + '/note', { method: 'PUT', body: JSON.stringify({ note: nextNote }) });
                        await refreshChatFriendNotes(true);
                        showToast(nextNote.trim() ? '好友备注已保存' : '好友备注已清除');
                        renderDockChatSocialTab('friends');
                    } catch (e) { showToast(e && e.message || '备注保存失败'); }
                    return;
                }
                if (action === 'friend-remove') {
                    if (!window.confirm('删除好友后会保留历史聊天，但需要重新成为好友才能发送新消息。确定删除？')) return;
                    try {
                        await requestDockChatSocial('/friends/' + encodeURIComponent(peer), { method: 'DELETE' });
                        await refreshChatFriendNotes(true);
                        if (dockChatActiveUser === peer) updateDockChatComposerPermission(peer);
                        showToast('已删除好友，历史聊天保留');
                        renderDockChatSocialTab('friends');
                    } catch (e) { showToast(e && e.message || '删除好友失败'); }
                    return;
                }
                if (action === 'friend-block' || action === 'request-block') {
                    if (!window.confirm('拉黑后会解除好友关系，并阻止双方互相申请好友和发送新消息。历史聊天会保留。确定拉黑？')) return;
                    try {
                        await requestDockChatSocial('/blocks/' + encodeURIComponent(peer), { method: 'POST', body: '{}' });
                        await refreshChatFriendNotes(true);
                        refreshChatSocialBadge(true);
                        if (dockChatActiveUser === peer) updateDockChatComposerPermission(peer);
                        showToast('已拉黑该用户');
                        renderDockChatSocialTab(_dockChatSocialTab === 'requests' ? 'requests' : 'friends');
                    } catch (e) { showToast(e && e.message || '拉黑失败'); }
                    return;
                }
                if (action === 'block-remove') {
                    try {
                        await requestDockChatSocial('/blocks/' + encodeURIComponent(peer), { method: 'DELETE' });
                        showToast('已解除拉黑');
                        renderDockChatSocialTab('blocks');
                    } catch (e) { showToast(e && e.message || '解除拉黑失败'); }
                    return;
                }
                if (action.indexOf('request-') === 0) {
                    var verb = action.slice('request-'.length);
                    if (['accept', 'reject', 'cancel'].indexOf(verb) < 0 || !requestId) return;
                    try {
                        var response = await requestDockChatSocial('/friend-requests/' + encodeURIComponent(requestId) + '/' + verb, { method: 'POST', body: '{}' });
                        var resultStatus = response.result && response.result.status;
                        if (resultStatus === 'accepted') {
                            showToast('已添加好友');
                            await refreshChatFriendNotes(true);
                            if (dockChatActiveUser === peer) updateDockChatComposerPermission(peer);
                        } else {
                            showToast(verb === 'cancel' ? '已取消好友申请' : (verb === 'reject' ? '已拒绝好友申请' : '操作完成'));
                        }
                        refreshChatSocialBadge(true);
                        renderDockChatSocialTab('requests');
                    } catch (e) { showToast(e && e.message || '好友申请处理失败'); }
                }
            }

            function handleDockChatRelationshipAction() {
                var action = this.getAttribute('data-chat-action') || '';
                var userName = this.getAttribute('data-peer') || dockChatActiveUser || '';
                if (action === 'add') sendDockChatFriendRequest(userName, true);
                else if (action === 'cancel') {
                    var requestId = this.getAttribute('data-request-id') || '';
                    if (requestId) requestDockChatSocial('/friend-requests/' + encodeURIComponent(requestId) + '/cancel', { method: 'POST', body: '{}' })
                        .then(function() { showToast('已取消好友申请'); updateDockChatComposerPermission(userName); refreshChatSocialBadge(true); })
                        .catch(function(e) { showToast(e && e.message || '取消申请失败'); });
                } else if (action === 'requests') openDockChatSocialSheet('requests');
                else if (action === 'blocks') openDockChatSocialSheet('blocks');
                else if (action === 'retry') updateDockChatComposerPermission(userName);
            }

            async function updateDockChatComposerPermission(userName) {
                var input = document.getElementById('dockChatInput');
                var send = document.getElementById('dockChatSendBtn');
                var attach = document.getElementById('dockChatImgBtn');
                var notice = document.getElementById('dockChatRelationshipNotice');
                var message = document.getElementById('dockChatRelationshipText');
                var actionButton = document.getElementById('dockChatRelationshipAction');
                if (!userName || !window.currentUser) {
                    if (notice) notice.hidden = true;
                    return;
                }
                if (window.currentUser === 'xxz' || userName === 'xxz') {
                    if (input) input.disabled = false;
                    if (send) send.disabled = false;
                    if (attach) attach.disabled = false;
                    if (notice) notice.hidden = true;
                    return;
                }
                var seq = ++_dockChatRelationshipSeq;
                if (input) input.disabled = true;
                if (send) send.disabled = true;
                if (attach) attach.disabled = true;
                if (notice) notice.hidden = false;
                if (message) message.textContent = '正在确认好友关系…';
                if (actionButton) { actionButton.hidden = true; actionButton.onclick = null; }
                var owner = window.currentUser;
                try {
                    var result = await requestDockChatSocial('/relationship?target=' + encodeURIComponent(userName));
                    if (seq !== _dockChatRelationshipSeq || window.currentUser !== owner || dockChatActiveUser !== userName) return;
                    var relationship = result.relationship || {};
                    if (relationship.can_message === true) {
                        if (input) input.disabled = false;
                        if (send) send.disabled = false;
                        if (attach) attach.disabled = false;
                        if (notice) notice.hidden = true;
                        return;
                    }
                    var action = '';
                    var label = '';
                    var note = '';
                    if (relationship.status === 'blocked_by_me') {
                        note = '你已拉黑该用户。解除拉黑后，双方才能重新申请或发送新消息。'; action = 'blocks'; label = '管理黑名单';
                    } else if (relationship.status === 'blocked_by_peer') {
                        note = '对方已限制与你的好友申请和新消息。历史聊天仍可查看。';
                    } else if (relationship.status === 'request_sent') {
                        note = '好友申请已发送，等待对方处理。'; action = 'cancel'; label = '取消申请';
                    } else if (relationship.status === 'request_received') {
                        note = '对方已向你发送好友申请。'; action = 'requests'; label = '处理申请';
                    } else if (relationship.status === 'none') {
                        note = '成为好友后才能发送新消息。历史聊天仍可查看。'; action = 'add'; label = '添加好友';
                    } else if (relationship.status === 'user_not_found') {
                        note = '该用户当前不可用。';
                    } else {
                        note = '好友状态不可用，暂时无法发送新消息。'; action = 'retry'; label = '重试';
                    }
                    if (message) message.textContent = note;
                    if (actionButton && action) {
                        actionButton.hidden = false;
                        actionButton.textContent = label;
                        actionButton.setAttribute('data-chat-action', action);
                        actionButton.setAttribute('data-peer', userName);
                        actionButton.setAttribute('data-request-id', relationship.outgoing_request_id || '');
                    }
                } catch (_) {
                    if (seq !== _dockChatRelationshipSeq || dockChatActiveUser !== userName) return;
                    if (message) message.textContent = '暂时无法确认好友关系，消息发送已暂停。';
                    if (actionButton) {
                        actionButton.hidden = false;
                        actionButton.textContent = '重试';
                        actionButton.setAttribute('data-chat-action', 'retry');
                        actionButton.setAttribute('data-peer', userName);
                    }
                }
            }

            function updateChatAuthUI() {
                var inp = document.getElementById('dockChatInput');
                var sendBtn = document.getElementById('dockChatSendBtn');
                var imgBtn = document.getElementById('dockChatImgBtn');
                if (!window.currentUser) {
                    if (inp) { inp.disabled = true; inp.placeholder = '登录后可发消息'; }
                    if (sendBtn) sendBtn.disabled = true;
                    if (imgBtn) imgBtn.disabled = true;
                } else {
                    if (inp) { inp.disabled = false; inp.placeholder = '输入消息...'; }
                    if (sendBtn) sendBtn.disabled = false;
                    if (imgBtn) imgBtn.disabled = false;
                }
                refreshChatSocialBadge(false);
                refreshChatFriendNotes(false);
                if (dockChatActiveUser && window.currentUser) updateDockChatComposerPermission(dockChatActiveUser);
                syncDockChatLayoutState();
            }
            window.updateChatAuthUI = updateChatAuthUI;
            // ★ 2026-09-25 修复：desktop-shell.js 的"双击刷新聊天"分支用
            //   typeof window.loadDockChatMessages === 'function' / window.dockChatActiveUser
            //   做守卫，但这两个符号此前从未挂到 window 上 —— 于是桌面侧栏刷新聊天时
            //   消息重载被静默跳过。这里补齐（getter 保证读到的永远是当前会话）。
            window.loadDockChatMessages = loadDockChatMessages;
            try {
                Object.defineProperty(window, 'dockChatActiveUser', {
                    configurable: true,
                    get: function() { return dockChatActiveUser; }
                });
            } catch (eDockUser) {}

            window.addEventListener('DOMContentLoaded', async function() {
                // iOS 键盘与可视视口适配
                (function() {
                    const isIOS = window.__xtjTouchViewportDevice || /iPad|iPhone|iPod/.test(navigator.userAgent + ' ' + navigator.platform) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 0);
                    if (!isIOS) return;

                    const dockBar = document.getElementById('dockBar');
                    const root = document.documentElement;
                    root.classList.add('xtj-ios-viewport');
                    let keyboardOpen = false;
                    var awaitingKeyboardCloseViewport = false;
                    var keyboardFollowLatest=true;
                    // 环境固有的视口差（非键盘部分），取历史最小值当基线。见 updateIOSViewport。
                    var viewportBaseline = Infinity;
                    var closedViewportHeight = window.__xtjViewportBootHeight || (window.visualViewport ? window.visualViewport.height : window.innerHeight);
                    var viewportWidth = window.innerWidth;
                    var previousFocusedInput = null;

                    function fitFocusedInput(input) {
                        if (!input || input !== document.activeElement || !root.classList.contains('xtj-keyboard-open')) return;
                        var visualTop = parseFloat(root.style.getPropertyValue('--xtj-visual-top')) || 0;
                        var appHeight = parseFloat(root.style.getPropertyValue('--xtj-app-height')) || window.innerHeight;
                        var scroller = input.parentElement;
                        while (scroller && scroller !== document.body && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
                        if (scroller && scroller !== document.body) {
                            var inputRect = input.getBoundingClientRect(), scrollRect = scroller.getBoundingClientRect();
                            var bottom = Math.min(scrollRect.bottom, visualTop + appHeight) - 12;
                            var top = Math.max(scrollRect.top, visualTop) + 12;
                            if (inputRect.bottom > bottom) scroller.scrollTop += inputRect.bottom - bottom;
                            else if (inputRect.top < top) scroller.scrollTop -= top - inputRect.top;
                        }
                    }

                    function hasActiveInput() {
                        var active = document.activeElement;
                        return !!(active && active.matches && active.matches('textarea,input:not([type=checkbox]):not([type=radio]):not([type=range]),[contenteditable=true]'));
                    }

                    function updateIOSViewport() {
                        var vv = window.visualViewport;
                        var focused = hasActiveInput();
                        var viewportScale = vv && Number(vv.scale) > 0 ? Number(vv.scale) : 1;
                        var layoutHeight = window.innerHeight;
                        var visibleHeight = vv ? Math.round(vv.height * viewportScale) : layoutHeight;
                        var rawDiff = Math.max(0, layoutHeight - visibleHeight);
                        if (rawDiff < viewportBaseline) viewportBaseline = rawDiff;
                        if (window.innerWidth !== viewportWidth) {
                            viewportWidth = window.innerWidth;
                            closedViewportHeight = Math.max(visibleHeight, layoutHeight);
                            viewportBaseline = rawDiff;
                        }
                        // Safari can shrink innerHeight together with VisualViewport,
                        // or leave innerHeight stale after the keyboard has closed.
                        var keyboardGap = Math.max(0, closedViewportHeight - visibleHeight, rawDiff - viewportBaseline);
                        var viewportShrunk = keyboardGap > Math.max(100, closedViewportHeight * 0.18);
                        var isKeyboardVisible = focused && viewportShrunk;
                        if (!viewportShrunk) closedViewportHeight = visibleHeight;
                        // The shell owns the viewport. Fixed controls must not add
                        // the keyboard offset again after the shell has resized.
                        if (root.classList.contains('xtj-keyboard-open') && !focused && viewportShrunk) awaitingKeyboardCloseViewport = true;
                        if (focused || !viewportShrunk) awaitingKeyboardCloseViewport = false;
                        var appHeight = awaitingKeyboardCloseViewport ? closedViewportHeight : visibleHeight;
                        var previousHeight = parseFloat(root.style.getPropertyValue('--xtj-app-height')) || appHeight;
                        var visualTop = !awaitingKeyboardCloseViewport && vv ? Math.max(0, Math.round(vv.offsetTop * viewportScale)) : 0;
                        if (!isKeyboardVisible && window.scrollY !== 0) window.scrollTo(0, 0);
                        root.style.setProperty('--xtj-app-height', appHeight + 'px');
                        root.style.setProperty('--xtj-visual-top', visualTop + 'px');
                        root.style.setProperty('--xtj-visual-bottom', '0px');
                        root.style.setProperty('--xtj-ios-keyboard-gap', isKeyboardVisible ? keyboardGap + 'px' : '0px');
                        var keyboardWasVisible = root.classList.contains('xtj-keyboard-open');
                        root.classList.toggle('xtj-keyboard-open', isKeyboardVisible);
                        if (isKeyboardVisible && !keyboardWasVisible) {
                            // Focusing during the AI page's entrance must not leave
                            // the composer below the visual edge or replay on blur.
                            document.querySelectorAll('#panelAiChat, #aiChatRoot').forEach(function(node) {
                                if (typeof node.getAnimations !== 'function') return;
                                node.getAnimations().forEach(function(motion) {
                                    if (/^xtj-ai-(panel|dock)-enter$/.test(motion.animationName || '')) motion.finish();
                                });
                            });
                        }
                        var chatFocused = focused && document.activeElement.id === 'dockChatInput' && currentDockTab === 'chat';
                        document.body.classList.toggle('ios-chat-keyboard-open', !!(chatFocused && isKeyboardVisible));
                        if (dockBar) dockBar.style.display = isKeyboardVisible ? 'none' : '';
                        if (isKeyboardVisible && (!keyboardWasVisible || previousHeight !== appHeight || previousFocusedInput !== document.activeElement)) {
                            var input = document.activeElement;
                            fitFocusedInput(input);
                            // Inline comments and Safari focus scrolling can finish
                            // their layout after the first viewport event.
                            requestAnimationFrame(function() { fitFocusedInput(input); });
                        }
                        if (dockBar && !isKeyboardVisible && !shouldUseDesktopChatSplitLayout() && dockBar.getClientRects().length) {
                            root.style.setProperty('--xtj-dock-reserve', (Math.ceil(dockBar.getBoundingClientRect().height) + 20) + 'px');
                        }
                        previousFocusedInput = focused ? document.activeElement : null;
                        window.dispatchEvent(new CustomEvent('xtj:visual-viewport-change'));
                        if (chatFocused && keyboardOpen && keyboardFollowLatest) requestAnimationFrame(scrollDockChatBottom);
                    }

                    window.__xtjRefreshIOSChatViewport = function(options) {
                        options = options || {};
                        updateIOSViewport();
                        if (options.forceScroll) {
                            requestAnimationFrame(function() {
                                setTimeout(scrollDockChatBottom, 60);
                            });
                        }
                        if (options.preserveFocus && document.activeElement && document.activeElement.id === 'dockChatInput') {
                            document.body.classList.add('ios-chat-keyboard-open');
                        }
                    };

                    window.__xtjResetIOSChatViewport = function() {
                        var messages=document.getElementById('dockChatMessages');
                        var follow=isDockChatNearBottom(messages,100),anchor=messages ? messages.scrollTop : 0;
                        keyboardOpen = false;
                        document.body.classList.remove('ios-chat-keyboard-open');
                        root.style.setProperty('--xtj-ios-keyboard-gap', '0px');
                        if (dockBar) dockBar.style.display = '';
                        requestAnimationFrame(function() {
                            updateIOSViewport();
                            setTimeout(function() {
                                updateIOSViewport();
                                if (follow) scrollDockChatBottom(); else if(messages)messages.scrollTop=anchor;
                            }, 120);
                        });
                    };

                    function handleFocus(e) {
                        keyboardFollowLatest=isDockChatNearBottom(document.getElementById('dockChatMessages'),100) && !_chatHistoryFocus;
                        keyboardOpen = true;
                        updateIOSViewport();
                        // Native focus scroll and VisualViewport own the keyboard
                        // movement. A delayed whole-page scroll races that movement.
                    }

                    function handleBlur() {
                        setTimeout(function() {
                            keyboardOpen = hasActiveInput();
                            if (!keyboardOpen && !document.body.classList.contains('photo-previewing')) {
                                window.__xtjResetIOSChatViewport();
                                return;
                            }
                            updateIOSViewport();
                            requestAnimationFrame(function() {
                                setTimeout(updateIOSViewport, 120);
                            });
                        }, 80);
                    }

                    document.addEventListener('focusin', function(e) { if (hasActiveInput()) handleFocus(e); });
                    document.addEventListener('focusout', handleBlur);
                    if (window.visualViewport) {
                        var _iosVvTicking = false, _iosVvFrame=0, _iosVvTimer=0;
                        function _iosVvHandler() {
                            if (!_iosVvTicking) {
                                _iosVvTicking = true;
                                function settleViewport() {
                                    if (!_iosVvTicking) return;
                                    _iosVvTicking=false; cancelAnimationFrame(_iosVvFrame); clearTimeout(_iosVvTimer);
                                    updateIOSViewport();
                                }
                                _iosVvFrame=requestAnimationFrame(settleViewport);
                                _iosVvTimer=setTimeout(settleViewport,40);
                            }
                        }
                        window.visualViewport.addEventListener('resize', _iosVvHandler);
                        window.visualViewport.addEventListener('scroll', _iosVvHandler);
                    }
                    window.addEventListener('pageshow', updateIOSViewport);
                    window.addEventListener('orientationchange', function() {
                        setTimeout(updateIOSViewport, 180);
                    });
                    window.addEventListener('resize', function() {
                        updateIOSViewport();
                    });
                    updateIOSViewport();
                })();

                // 修复 100dvh 在 iOS 上的问题：改用 --vh 方案，移除旧逻辑
                // adjustIOSHeight();
                // window.addEventListener('resize', adjustIOSHeight);
                // window.addEventListener('orientationchange', function() { setTimeout(adjustIOSHeight, 150); });

                await initUI();
                normalizeReportModalStructure();
                requestAnimationFrame(function() {
                    Promise.resolve()
                        .then(function() { return initialLoad(); })
                        .catch(function(err) {
                            console.error('[XTJ] initialLoad failed:', err);
                            try {
                                var feedEl = document.getElementById('feed');
                                if (feedEl && /xtj-loading-skeleton|xtj-skeleton-card/.test(feedEl.innerHTML || '')) {
                                    feedEl.innerHTML = '<div class="loading" style="color:#ff3b60;cursor:pointer;" id="feedInitError">启动加载失败，点击重试</div>';
                                    var initErr = document.getElementById('feedInitError');
                                    if (initErr) initErr.onclick = function() {
                                        if (typeof window.loadFeed === 'function') window.loadFeed(true);
                                    };
                                }
                            } catch (e2) {}
                        });
                });
                // 帖子区看门狗：skeleton 卡住 / 白屏空 feed 时给出可点重试（含 Render 冷启动）
                // ★ 2026-09-26（审计 P2-2）：判活不再用 innerHTML/innerText 做字符串匹配 ——
                //   本看门狗每秒执行一次，innerHTML 会把整棵 feed 子树序列化、innerText 更会
                //   强制重排，Feed 有数十条帖子时是全站最贵的周期性开销。现改为
                //   querySelector + textContent（不触发重排，且 textContent 本来就要读一次）。
                (function setupFeedBootWatchdog() {
                    if (window.__xtjFeedBootWatchdog) return;
                    window.__xtjFeedBootWatchdog = true;
                    var tries = 0;
                    var timer = setInterval(function() {
                        tries += 1;
                        var feedEl = document.getElementById('feed');
                        if (!feedEl) {
                            if (tries >= 12) clearInterval(timer);
                            return;
                        }
                        var hasPosts = !!feedEl.querySelector('.post');
                        var _feedTextProbe = String(feedEl.textContent || '');
                        var hasSkeleton = !!feedEl.querySelector('.xtj-loading-skeleton, .xtj-skeleton-card, .xtj-magic-loading, .loading');
                        var hasError = !!feedEl.querySelector('#feedBootError, #feedInitError, #feedWatchdogError, .feed-load-more-error')
                            || /加载失败|加载中断|启动加载失败|加载超时/.test(_feedTextProbe);
                        var isEmpty = !hasPosts && !hasError && _feedTextProbe.trim().length < 8;
                        if (hasPosts || hasError) {
                            clearInterval(timer);
                            return;
                        }
                        if ((tries >= 10 && hasSkeleton) || (tries >= 8 && isEmpty)) {
                            clearInterval(timer);
                            console.warn('[XTJ] feed boot watchdog: recovery after ' + tries + 's');
                            feedEl.innerHTML = '<div class="loading" id="feedWatchdogError" role="button" tabindex="0" style="color:#ff3b60;cursor:pointer;padding:24px;text-align:center;">帖子加载超时，点击重试<br><small style="opacity:.7">若底部一直显示「正在等待…」，多半是 Render 冷启动或网络慢，请稍候再点</small></div>';
                            var w = document.getElementById('feedWatchdogError');
                            if (w) {
                                w.onclick = function() {
                                    if (typeof window.loadFeed === 'function') {
                                        window.loadFeed(true).catch(function() {});
                                    } else {
                                        window.location.reload();
                                    }
                                };
                            }
                            try {
                                if (typeof window.loadFeed === 'function') {
                                    window.loadFeed(true).catch(function() {});
                                }
                            } catch (e3) {}
                        }
                    }, 1000);
                    // ★ 2026-09-13 修复（S-1）：bfcache 往返时清理看门狗。
                    // 进入 bfcache 不触发 beforeunload，该 1s 间隔的看门狗会跨页存活；
                    // 返回后若 feed 已被浏览器恢复为真实内容，看门狗仍可能在检查窗口内
                    // 判定为 skeleton/空值并写入 innerHTML，覆盖掉恢复后的真实 feed
                    //（表现为「返回后 feed 闪回错误页」）。pagehide 在进入 bfcache 时
                    // 同样触发，是可靠时机。
                    window.addEventListener('pagehide', function() { clearInterval(timer); });
                })();
                // 记录访问（用户+IP）
                if (currentUser) logUserVisitToApi(currentUser);
                logIpVisitToSupabase();

                // 公告已读：已登录用户进入页面时拉取远端已读记录（跨设备同步）
                // 让"换设备/换浏览器/重新登录"的账号不再显示已读公告红点
                if (window.currentUser && typeof window.loadRemoteAnnouncementReads === 'function') {
                    Promise.resolve()
                        .then(function() { return window.loadRemoteAnnouncementReads(); })
                        .then(function() {
                            if (typeof window.updateAnnouncementBadge === 'function') {
                                window.updateAnnouncementBadge();
                            }
                        })
                        .catch(function(e) { console.warn('[ann_read_sync_boot]', e); });
                }
                // 恢复/停止保存当前 tab
                const savedTab = window.safeStorage.get('xtj_current_tab');
                if (savedTab && savedTab !== 'posts') {
                    switchDockTab(savedTab, true);
                }
            });

            // ========== 主题切换 ==========
            if (!window.__xtjThemeControllerV2) {
            const htmlEl = document.documentElement;
            const themeBtn = document.getElementById('themeToggle');
            const THEME_STORAGE_KEY = 'xtj-theme';
            let themeToggleAnimating = false;
            let themeSplashOverlay = null;
            let themeSplashCleanupTimer = 0;

            // ★ 审计修复（G7 对称补全）：新增 persist 参数（默认 true）。
            //   旧实现 isDark 分支无条件落盘 'dark' —— 首次访问且系统为深色时，
            //   初始化 setThemeState(true) 会写入 localStorage，使下方系统主题
            //   变化监听的 `if (!safeStorage.get(THEME_STORAGE_KEY))` 永久短路；
            //   浅色路径 G7 已修、深色路径遗漏。"跟随系统"的初始化与系统变化
            //   回调现传 persist=false，不写存储；用户主动切换保持落盘。
            function setThemeState(isDark, persist) {
                if (persist === undefined) persist = true;
                if (isDark) {
                    htmlEl.setAttribute('data-theme', 'dark');
                    if (themeBtn) {
                        themeBtn.setAttribute('aria-label', '切换到浅色模式');
                        themeBtn.setAttribute('title', '切换到浅色模式');
                    }
                    if (persist) window.safeStorage.set(THEME_STORAGE_KEY, 'dark');
                } else {
                    htmlEl.removeAttribute('data-theme');
                    if (themeBtn) {
                        themeBtn.setAttribute('aria-label', '切换到深色模式');
                        themeBtn.setAttribute('title', '切换到深色模式');
                    }
                    // G7 修复：仅当用户显式选择了浅色（此前存过偏好）时才落盘 'light'；
                    // 首次访问跟随系统浅色时不写 localStorage，保证系统深色监听（11441 行）持续生效
                    if (!persist) return;
                    if (window.safeStorage.get(THEME_STORAGE_KEY)) {
                        window.safeStorage.set(THEME_STORAGE_KEY, 'light');
                    } else {
                        window.safeStorage.remove(THEME_STORAGE_KEY);
                    }
                }
            }

            function setThemeRevealVars(originEl) {
                var source = originEl || themeBtn;
                var rect = source && typeof source.getBoundingClientRect === 'function'
                    ? source.getBoundingClientRect()
                    : { left: window.innerWidth / 2, top: 44, width: 0, height: 0 };
                var x = rect.left + (rect.width / 2);
                var y = rect.top + (rect.height / 2);
                var maxX = Math.max(x, window.innerWidth - x);
                var maxY = Math.max(y, window.innerHeight - y);
                var radius = Math.ceil(Math.hypot(maxX, maxY)) + 48;
                htmlEl.style.setProperty('--theme-reveal-x', x + 'px');
                htmlEl.style.setProperty('--theme-reveal-y', y + 'px');
                htmlEl.style.setProperty('--theme-reveal-radius', radius + 'px');
                return { x: x, y: y, radius: radius };
            }

            function clearThemeRevealVars() {
                htmlEl.style.removeProperty('--theme-reveal-x');
                htmlEl.style.removeProperty('--theme-reveal-y');
                htmlEl.style.removeProperty('--theme-reveal-radius');
            }

            function getThemeSplashBackground(isDark) {
                return isDark
                    ? '#12131a'
                    : '#eef8f2';
            }

            function isIOSWebKitThemePath() {
                try {
                    var ua = navigator.userAgent || '';
                    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                } catch (_) {
                    return false;
                }
            }

            function shouldUseThemeFallback(nextIsDark) {
                if (!nextIsDark) return true;
                if (isIOSWebKitThemePath()) return true;
                return !supportsThemeViewTransition();
            }

            function clearThemeSplashOverlay() {
                if (themeSplashCleanupTimer) {
                    window.clearTimeout(themeSplashCleanupTimer);
                    themeSplashCleanupTimer = 0;
                }
                if (themeSplashOverlay && themeSplashOverlay.parentNode) {
                    themeSplashOverlay.parentNode.removeChild(themeSplashOverlay);
                }
                themeSplashOverlay = null;
            }

            function finishThemeToggle() {
                clearThemeSplashOverlay();
                themeToggleAnimating = false;
                htmlEl.removeAttribute('data-theme-animating');
                htmlEl.removeAttribute('data-theme-transition');
                if (themeBtn) themeBtn.disabled = false;
                clearThemeRevealVars();
            }

            function supportsThemeViewTransition() {
                try {
                    return !!(document.startViewTransition && window.CSS && CSS.supports && CSS.supports('view-transition-name: root'));
                } catch (_) {
                    return !!document.startViewTransition;
                }
            }

            function playThemeFallback(nextIsDark, originEl) {
                var reveal = setThemeRevealVars(originEl);
                var overlay = document.createElement('div');
                var disc = document.createElement('div');
                var nextBg = getThemeSplashBackground(nextIsDark);
                var currentBg = getThemeSplashBackground(!nextIsDark);
                var diameter = reveal.radius * 2;
                overlay.className = 'theme-splash-overlay' + (nextIsDark ? ' is-expand' : ' is-conceal');
                overlay.style.setProperty('--theme-reveal-x', reveal.x + 'px');
                overlay.style.setProperty('--theme-reveal-y', reveal.y + 'px');
                overlay.style.setProperty('--theme-reveal-radius', reveal.radius + 'px');
                overlay.style.background = nextIsDark ? currentBg : 'transparent';
                disc.className = 'theme-splash-disc';
                disc.style.left = (reveal.x - reveal.radius) + 'px';
                disc.style.top = (reveal.y - reveal.radius) + 'px';
                disc.style.width = diameter + 'px';
                disc.style.height = diameter + 'px';
                disc.style.background = nextIsDark ? nextBg : currentBg;
                overlay.appendChild(disc);
                clearThemeSplashOverlay();
                themeSplashOverlay = overlay;
                document.body.appendChild(overlay);
                setThemeState(nextIsDark);
                overlay.offsetHeight;
                requestAnimationFrame(function() {
                    requestAnimationFrame(function() {
                        overlay.classList.add('is-active');
                    });
                });
                themeSplashCleanupTimer = window.setTimeout(function() {
                    finishThemeToggle();
                }, 230);
            }

            function animateThemeToggle(nextIsDark, originEl) {
                if (themeToggleAnimating) return;
                var prefersReducedMotion = false;
                try {
                    prefersReducedMotion = !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                } catch (_) {}
                if (prefersReducedMotion) {
                    setThemeState(nextIsDark);
                    return;
                }

                themeToggleAnimating = true;
                htmlEl.setAttribute('data-theme-animating', '1');
                htmlEl.setAttribute('data-theme-transition', nextIsDark ? 'dark' : 'light');
                if (themeBtn) themeBtn.disabled = true;
                setThemeRevealVars(originEl);
                if (!shouldUseThemeFallback(nextIsDark)) {
                    try {
                        var transition = document.startViewTransition(function() {
                            setThemeState(nextIsDark);
                        });
                        transition.finished.finally(finishThemeToggle);
                        return;
                    } catch (_) {}
                }
                playThemeFallback(nextIsDark, originEl);
            }

            if (themeBtn) {
                themeBtn.__xtjLegacyThemeClick = function() {
                    const isDark = htmlEl.getAttribute('data-theme') === 'dark';
                    const nextTheme = !isDark ? '深色模式' : '浅色模式';
                    try { if (typeof window.queueBehavior === 'function') window.queueBehavior('settings_change', '切换主题 → ' + nextTheme); } catch(e) {}
                    animateThemeToggle(!isDark, themeBtn);
                };
                themeBtn.addEventListener('click', themeBtn.__xtjLegacyThemeClick);
            }
            // 初始化时从 localStorage 读取主题设置
            const savedTheme = window.safeStorage.get(THEME_STORAGE_KEY);
            if (savedTheme === 'dark') {
                setThemeState(true);
            } else if (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                // ★ 审计修复：首次跟随系统深色不落盘（persist=false），与 G7 浅色
                //   路径对称 —— 否则系统主题变化监听从此永久失效。
                setThemeState(true, false);
            } else {
                setThemeState(false);
            }
            // 监听系统主题变化
            try {
                var mqDark = window.matchMedia('(prefers-color-scheme: dark)');
                if (mqDark && mqDark.addEventListener) {
                    mqDark.addEventListener('change', function(e) {
                        if (!window.safeStorage.get(THEME_STORAGE_KEY)) {
                            setThemeState(e.matches, false);
                        }
                    });
                }
            } catch (_) {}
            // ★ 修复 M-2：本旧主题块在 core.js 顶层立即执行，此时 theme-toggle.js
            // （V2 控制器）尚未加载（defer 顺序在 core 之后）。DOMContentLoaded 时
            // 所有 defer 脚本已执行完毕，若 V2 已接管（__xtjThemeControllerV2 被设置），
            // 移除旧块对 themeToggle 的 click 绑定，避免双 handler 同时响应导致
            // 动画/存储键（xtj-theme vs xtj_theme）互相覆盖。主题统一由 V2 管理。
            if (themeBtn) {
                document.addEventListener('DOMContentLoaded', function() {
                    try {
                        if (window.__xtjThemeControllerV2 && themeBtn.__xtjLegacyThemeClick) {
                            themeBtn.removeEventListener('click', themeBtn.__xtjLegacyThemeClick);
                            themeBtn.__xtjLegacyThemeClick = null;
                        }
                    } catch (e3) {}
                });
            }
            }

            function applyPerformanceMode() {
                var perfClasses = ['perf-lite', 'perf-balanced'];
                var rootEl = document.documentElement;
                if (!rootEl) return;
                rootEl.classList.remove.apply(rootEl.classList, perfClasses);
                var prefersReducedMotion = false;
                try {
                    prefersReducedMotion = !!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                } catch (_) {}
                var memory = Number(navigator.deviceMemory || 0);
                var cores = Number(navigator.hardwareConcurrency || 0);
                var touchPoints = Number(navigator.maxTouchPoints || 0);
                var smallScreen = Math.min(window.innerWidth || 0, window.screen && window.screen.width ? window.screen.width : window.innerWidth || 0) <= 1024;
                var mode = '';
                if (prefersReducedMotion || (memory && memory <= 4) || (cores && cores <= 4)) {
                    mode = 'perf-lite';
                } else if (smallScreen || touchPoints > 0 || (memory && memory <= 8) || (cores && cores <= 8)) {
                    mode = 'perf-balanced';
                }
                if (mode) rootEl.classList.add(mode);
            }

            applyPerformanceMode();
            window.addEventListener('resize', applyPerformanceMode, { passive: true });

            // ========== 公告已读（跨设备同步 v2）==========
            const ANN_MARKER = '__ann__';
            // 每用户独立 localStorage key（支持未登录 guest）
            // - 已登录用户: xtj_announcement_read_v2_<currentUser>
            // - 未登录:      xtj_announcement_read_v2_guest
            // 切换账号前需调用 ensureAnnouncementReadCacheKey() 切换上下文
            const ANN_READ_KEY_PREFIX = 'xtj_announcement_read_v2_';
            let announcements = [];
            let currentAnnouncement = null;
            let annRealtime = null;

            // 简单的 32-bit FNV-1a 哈希：给没有 id 字段的旧公告生成稳定 fingerprint
            function __xtjAnnHash(str) {
                str = String(str || '');
                var hash = 2166136261;
                for (var i = 0; i < str.length; i++) {
                    hash ^= str.charCodeAt(i);
                    hash = Math.imul(hash, 16777619);
                }
                // 转成无符号 16 进制字符串
                return (hash >>> 0).toString(16);
            }

            // 获取公告稳定 ID：优先用 ann.id，否则用 title+content+created_at 哈希
            // 严禁用数组 index（公告排序变化后已读状态会错乱）
            window.getAnnouncementId = function(ann) {
                if (!ann) return null;
                if (ann.id !== undefined && ann.id !== null && String(ann.id) !== '') {
                    return 'a_' + String(ann.id);
                }
                var parts = [ann.title || '', ann.content || '', ann.created_at || ''];
                return 'fp_' + __xtjAnnHash(parts.join('|'));
            };

            function getAnnouncementReadKey() {
                var user = (window.currentUser || '').trim();
                return ANN_READ_KEY_PREFIX + (user || 'guest');
            }

            // 读取本地已读公告 id 集合（仅当前用户）
            window.getLocalAnnouncementReadSet = function() {
                try {
                    var raw = window.safeStorage.get(getAnnouncementReadKey());
                    if (!raw) return new Set();
                    var obj = JSON.parse(raw);
                    var keys = obj && typeof obj === 'object' ? Object.keys(obj) : [];
                    return new Set(keys);
                } catch (e) {
                    return new Set();
                }
            };

            // 写入本地已读公告（不覆盖已有 read_at）
            window.saveLocalAnnouncementRead = function(ids) {
                if (!Array.isArray(ids) || !ids.length) return;
                try {
                    var key = getAnnouncementReadKey();
                    var raw = window.safeStorage.get(key);
                    var obj = {};
                    try { obj = raw ? (JSON.parse(raw) || {}) : {}; } catch (_) { obj = {}; }
                    var now = new Date().toISOString();
                    var changed = false;
                    ids.forEach(function(id) {
                        if (id === undefined || id === null) return;
                        var s = String(id);
                        if (!s || s === 'a_undefined' || s === 'fp_undefined') return;
                        if (!obj[s]) {
                            obj[s] = now;
                            changed = true;
                        }
                    });
                    if (changed) {
                        window.safeStorage.set(key, JSON.stringify(obj));
                    }
                } catch (e) {}
            };

            // 加载远程已读公告（登录后调用）
            // 返回 Promise<Set<string>>，并合并写入本地
            window.loadRemoteAnnouncementReads = async function() {
                if (!window.currentUser) return new Set();
                try {
                    var tok = await window.ensureUserToken();
                    if (!tok) return new Set();
                    var resp = await fetch((window.API_BASE || '') + '/api/announcements/read', {
                        headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
                        signal: AbortSignal.timeout(8000)
                    });
                    if (!resp.ok) {
                        console.warn('[ann_read_get] status=' + resp.status);
                        return new Set();
                    }
                    var data = await resp.json();
                    var reads = (data && data.reads) || {};
                    var ids = Object.keys(reads);
                    if (ids.length) {
                        window.saveLocalAnnouncementRead(ids);
                    }
                    return new Set(ids);
                } catch (e) {
                    console.warn('[loadRemoteAnnouncementReads]', e);
                    return new Set();
                }
            };

            // 标记公告已读：先写本地（立即刷新 UI），再异步写后端
            // 后端失败不阻塞 UI，只 console.warn
            window.markAnnouncementsRead = function(ids) {
                if (!Array.isArray(ids) || !ids.length) return;
                // 1) 立即写本地 + 立即隐藏红点
                window.saveLocalAnnouncementRead(ids);
                if (typeof window.updateAnnouncementBadge === 'function') {
                    window.updateAnnouncementBadge();
                }
                if (typeof window.renderAnnouncementList === 'function' && !document.getElementById('announcementModal').classList.contains('active')) {
                    // 弹窗未打开时不需要 render
                }
                // 2) 异步同步到后端（仅登录用户）
                if (!window.currentUser) return;
                (async function() {
                    try {
                        var tok = await window.ensureUserToken();
                        if (!tok) return;
                        var resp = await fetch((window.API_BASE || '') + '/api/announcements/read', {
                            method: 'POST',
                            headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ announcement_ids: ids }),
                            signal: AbortSignal.timeout(8000)
                        });
                        if (!resp.ok) {
                            console.warn('[markAnnouncementsRead] backend status=' + resp.status);
                        }
                    } catch (e) {
                        console.warn('[markAnnouncementsRead] backend sync failed', e);
                    }
                })();
            };

            // 兼容旧调用（单条）
            window.markAnnouncementRead = function(annId) {
                if (annId === undefined || annId === null) return;
                var id = String(annId);
                if (id === 'a_undefined' || id === 'fp_undefined') return;
                window.markAnnouncementsRead([id]);
            };

            // 兼容旧调用（直接返回数组形式，给 renderAnnouncementList 用）
            // 注意：内部统一使用 getLocalAnnouncementReadSet（Set）
            // 此函数包装成 Array 仅为兼容现有 renderAnnouncementList.includes()
            window.getReadAnnouncementIds = function() {
                return Array.from(window.getLocalAnnouncementReadSet());
            };

            // 红点更新：已禁用红点提醒
            window.updateAnnouncementBadge = function() {
                var badge = document.getElementById('announcementBadge');
                if (badge) badge.style.display = 'none';
            };

            // 旧函数名（保留兼容）
            function getReadAnnouncements() { return window.getReadAnnouncementIds(); }
            function saveReadAnnouncements(arr) {
                // ★ 修复：此前写入 ANN_READ_KEY_PREFIX + 'legacy'——从未被任何读取路径消费的键，
                // 删除公告后真实已读集合（按用户/guest 键，getAnnouncementReadKey）永不清除，
                // 同 fingerprint 公告重现仍会被当"已读"。改为写入真实键并保留既有 read_at。
                try {
                    var key = getAnnouncementReadKey();
                    var raw = window.safeStorage.get(key);
                    var obj = {};
                    try { obj = raw ? (JSON.parse(raw) || {}) : {}; } catch (_) { obj = {}; }
                    var now = new Date().toISOString();
                    (arr || []).forEach(function(id) {
                        if (id !== undefined && id !== null && String(id)) obj[String(id)] = now;
                    });
                    window.safeStorage.set(key, JSON.stringify(obj));
                } catch (e) {}
            }

            window.openAnnouncementModal = async function() {
                const overlay = document.getElementById('announcementModal');
                if (!overlay) return;
                overlay.style.opacity = '';
                overlay.style.transition = '';
                overlay.classList.add('active');
                document.body.style.overflow = 'hidden';
                showAnnouncementList();
                if (announcements && announcements.length) {
                    var preIds0 = announcements.map(window.getAnnouncementId).filter(Boolean);
                    if (preIds0.length) window.markAnnouncementsRead(preIds0);
                    renderAnnouncementList();
                }
                await loadAnnouncements();
                var postIds0 = (announcements || []).map(window.getAnnouncementId).filter(Boolean);
                if (postIds0.length) window.markAnnouncementsRead(postIds0);
                renderAnnouncementList();

                if (isAdmin()) {
                    document.getElementById('announcementAdminArea').style.display = 'block';
                } else {
                    document.getElementById('announcementAdminArea').style.display = 'none';
                }
            };

            window.closeAnnouncementModal = function() {
                const overlay = document.getElementById('announcementModal');
                if (!overlay) return;
                overlay.style.opacity = '0';
                overlay.style.transition = 'opacity 0.2s ease';
                setTimeout(() => {
                    overlay.classList.remove('active');
                    overlay.style.opacity = '';
                    overlay.style.transition = '';
                    document.body.style.overflow = '';
                    if (typeof syncReportModalBodyLock === 'function') syncReportModalBodyLock();
                    currentAnnouncement = null;
                }, 200);
            };

            function showAnnouncementList() {
                document.getElementById('announcementListContainer').style.display = 'block';
                const detail = document.getElementById('announcementDetail');
                detail.classList.remove('active');
                detail.style.display = 'none';
                currentAnnouncement = null;
                // 公告：管理员专属的发布区域
                if (isAdmin()) {
                    document.getElementById('announcementAdminArea').style.display = 'block';
                }
            }

            window.showAnnouncementList = showAnnouncementList;

            function showAnnouncementDetail(ann) {
                currentAnnouncement = ann;
                // 标记单条公告已读（用稳定 ID）
                var annId = window.getAnnouncementId(ann);
                if (annId) window.markAnnouncementRead(annId);

                // 进入公告详情：隐藏管理区域
                document.getElementById('announcementAdminArea').style.display = 'none';
                document.getElementById('announcementListContainer').style.display = 'none';
                const detail = document.getElementById('announcementDetail');
                detail.style.display = 'block';
                detail.classList.add('active');

                var annData = parseAnnData(ann);
                document.getElementById('announcementDetailTitle').textContent = annData.title;
                document.getElementById('announcementDetailTime').textContent = window.safeParseDate(ann.created_at).toLocaleString('zh-CN');
                document.getElementById('announcementDetailContent').textContent = annData.content;

                // 设置公告发布者信息显示
                const userInfoEl = document.getElementById('announcementDetailUserInfo');
                if (userInfoEl) {
                    var avUrl = getAvatarUrl(ann.user_name) ? sanitizeUrl(getAvatarUrl(ann.user_name)) : '';
                    var avatarHtml = avUrl
                        ? '<div class="announcement-detail-avatar"><img loading="lazy" decoding="async" src="' + escapeHtml(avUrl) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>'
                        : '<div class="announcement-detail-avatar">' + escapeHtml(String(ann.user_name).charAt(0) || '').toUpperCase() + '</div>';
                    userInfoEl.innerHTML = avatarHtml + '<div class="announcement-detail-name">' + escapeHtml(ann.user_name) + '</div>';
                }

                // 如果是管理员，添加删除按钮
                const existingDelBtn = detail.querySelector('.announcement-delete-btn');
                if (existingDelBtn) existingDelBtn.remove();
                if (isAdmin()) {
                    const delBtn = document.createElement('button');
                    delBtn.className = 'announcement-delete-btn';
                    delBtn.textContent = '删除公告';
                    delBtn.onclick = function(e) { e.stopPropagation(); deleteAnnouncement(ann); };
                    const header = detail.querySelector('.announcement-detail-header');
                    if (header) header.appendChild(delBtn);
                }

                renderAnnouncementList(); // 重新渲染列表，清理新增
            }

            async function loadAnnouncements() {
                try {
                    const { data, error } = await sb.from('posts')
                        .select('*')
                        .eq('media_type', ANN_MARKER)
                        .order('created_at', { ascending: false });
                    if (error) throw error;
                    announcements = data || [];

                    // 登录用户：异步拉取远端已读记录（合并到本地 + 刷新红点）
                    if (window.currentUser) {
                        try {
                            await window.loadRemoteAnnouncementReads();
                        } catch (e) {}
                    }

                    // 用合并后的已读集合刷新红点
                    window.updateAnnouncementBadge();

                    // 预加载发布者头像
                    if (announcements.length > 0) {
                        var publishers = new Set();
                        announcements.forEach(function(a) { publishers.add(a.user_name); });
                        loadAvatarsForUsers(Array.from(publishers));
                    }
                } catch(e) {
                    // quietly fail
                }
            }

            function parseAnnData(ann) {
                var title = '公告', content = ann.content || '';
                if (ann.content) {
                    try {
                        var parsed = JSON.parse(ann.content);
                        if (parsed.title !== undefined) { title = parsed.title || '公告'; content = parsed.content || ''; }
                    } catch(e) {}
                }
                return { title: title, content: content };
            }

            function renderAnnouncementList() {
                const listEl = document.getElementById('announcementList');
                if (!listEl) return;

                if (!announcements.length) {
                    listEl.innerHTML = '<div class="announcement-empty"><div class="announcement-empty-icon">📢</div><div>暂无公告</div></div>';
                    return;
                }

                listEl.innerHTML = '';
                // 用稳定 ID 判断已读
                const readSet = window.getLocalAnnouncementReadSet();

                announcements.forEach((ann, index) => {
                    const annId = window.getAnnouncementId(ann);
                    const isRead = annId ? readSet.has(annId) : true;
                    const item = document.createElement('div');
                    item.className = 'announcement-item' + (isRead ? '' : ' unread');
                    item.onclick = function() { showAnnouncementDetail(ann); };

                    var annData = parseAnnData(ann);
                    const displayTitle = annData.title;
                    const previewContent = annData.content ? (annData.content.length > 100 ? annData.content.substring(0, 100) + '...' : annData.content) : '';

                    item.innerHTML = `
                        <div class="announcement-item-header">
                            <div class="announcement-item-title">
                                ${!isRead ? '<span class="unread-dot"></span>' : ''}
                                ${escapeHtml(displayTitle)}
                            </div>
                            <div class="announcement-item-time">${window.safeParseDate(ann.created_at).toLocaleString('zh-CN')}</div>
                        </div>
                        ${previewContent ? `<div class="announcement-item-preview">${escapeHtml(previewContent)}</div>` : ''}
                    `;
                    listEl.appendChild(item);

                    requestAnimationFrame(() => {
                        setTimeout(() => {
                            item.classList.add('visible');
                        }, index * 60);
                    });
                });
            }

            window.publishAnnouncement = async function() {
                if (!window.isAdmin()) { if (window.showToast) showToast('无权限'); return; }
                const titleInput = document.getElementById('announcementAdminTitle');
                const contentInput = document.getElementById('announcementAdminInput');
                const title = titleInput.value.trim();
                const content = contentInput.value.trim();

                if (!title && !content) {
                    showToast('请至少填写标题或内容');
                    return;
                }

                try {
                    // 走后端 /api/admin/announcement（access token + ADMIN_USERNAME），禁止 anon 直写
                    var resp;
                    if (typeof window.xtjProtectedFetch === 'function') {
                        resp = await window.xtjProtectedFetch('/api/admin/announcement', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ title: title, content: content })
                        });
                    } else {
                        var authHeaders = (typeof window.getUserAuthHeaders === 'function') ? await window.getUserAuthHeaders() : {};
                        resp = await fetch((window.API_BASE || '').replace(/\/$/, '') + '/api/admin/announcement', {
                            method: 'POST',
                            credentials: 'include',
                            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders || {}),
                            body: JSON.stringify({ title: title, content: content })
                        });
                    }
                    var data = await resp.json().catch(function() { return {}; });
                    if (!resp.ok || !data || data.ok === false) {
                        throw new Error((data && data.error) || ('发布失败 (' + resp.status + ')'));
                    }
                    titleInput.value = '';
                    contentInput.value = '';
                    showToast('公告发布成功');
                    // 发布后强制刷新（按用户键的 3 分钟缓存在发布后会跳过网络请求）
                    await loadAnnouncements(true);
                    renderAnnouncementList();
                } catch(e) {
                    showToast('发布失败: ' + (e.message || '未知错误'));
                }
            };

            window.deleteAnnouncement = async function(ann) {
                if (!window.isAdmin()) { if (window.showToast) showToast('无权限'); return; }
                showConfirm('删除公告', '确定要删除这条公告吗？', '确定', async function() {
                    try {
                        var delPath = '/api/admin/announcement/' + encodeURIComponent(ann.id);
                        var delResp;
                        if (typeof window.xtjProtectedFetch === 'function') {
                            delResp = await window.xtjProtectedFetch(delPath, { method: 'DELETE' });
                        } else {
                            var delAuth = (typeof window.getUserAuthHeaders === 'function') ? await window.getUserAuthHeaders() : {};
                            delResp = await fetch((window.API_BASE || '').replace(/\/$/, '') + delPath, {
                                method: 'DELETE',
                                credentials: 'include',
                                headers: delAuth || {}
                            });
                        }
                        var delData = await delResp.json().catch(function() { return {}; });
                        if (!delResp.ok || (delData && delData.ok === false)) {
                            throw new Error((delData && delData.error) || ('删除失败 (' + delResp.status + ')'));
                        }

                        const readIds = getReadAnnouncements();
                        var annReadId = window.getAnnouncementId ? window.getAnnouncementId(ann) : ('a_' + ann.id);
                        const filteredReadIds = readIds.filter(id => id !== annReadId);
                        saveReadAnnouncements(filteredReadIds);

                        showToast('公告已删除');
                        await loadAnnouncements(true);
                        showAnnouncementList();
                        renderAnnouncementList();
                    } catch(e) {
                        showToast('删除失败: ' + (e.message || '未知错误'));
                    }
                });
            };

            function subscribeToAnnouncements() {
                if (annRealtime) return;
                // ★ 2026-09-24 修复：补 if (!sb) 空守卫，与 subscribeToMessages /
                //   subscribeToComments 一致，避免 sb 未初始化时抛 TypeError
                if (!sb) return;
                annRealtime = sb.channel('announcements')
                    .on('postgres_changes', {
                        event: '*',
                        schema: 'public',
                        table: 'posts',
                        filter: `media_type=eq.${ANN_MARKER}`
                    }, async function() {
                        if (!currentUser) return;
                        await loadAnnouncements();
                        if (document.getElementById('announcementModal').classList.contains('active')) {
                            renderAnnouncementList();
                        }
                    })
                    .subscribe();
            }

            // 版本更新日志
            const changelogData = [
                {
                    version: 'v0.95.0', date: '2026-09-30',
                    content: `<h4>更轻的个人页，更稳定的语音</h4><ul>
                      <li>“我的”增加动态、浏览、点赞、评论四个紧凑入口，记录分页显示，统一头像和设置排版。</li>
                      <li>修复播放后无法再次启用麦克风的音频会话顺序，完善录音取消、语音时长和播放重试。</li>
                      <li>当前主题滑块保留：白天是太阳，夜晚是月亮，完善切换过渡。</li>
                      <li>独立 Code 工作区彻底移除，小猫普通对话、深度思考和文件功能保留。</li>
                      <li>近期聊天已增加消息搜索、媒体历史、语音转写、引用定位、转发、编辑和发送重试。</li>
                      <li>首页导航随帖子滚出，通讯录切换和消息菜单已优化，底部 Dock 按钮保持原样。</li>
                    </ul>`
                },
                {
                    version: 'v0.94.1',
                    date: '2026-09-22',
                    content: `
                        <h4>静默失效类缺陷修复 + 采集合规整改 + 属地/响应式</h4>
                        <ul>
                            <li><b>修复 5 处未声明变量</b>：<code>finishStream</code> 引用不存在的 <code>req</code>（每次流式收尾都抛错 → 消息不落库、done 不发）、
                                <code>DEBUG_PROVIDER</code> 跨函数引用、<code>mail-transport</code> 私有变量（后台发信全废 + DM 提醒失效）、
                                深研 Worker 的 <code>userName</code>（多智能体研究报告为空）、断流补记账的 <code>searchMeta</code></li>
                            <li><b>照片墙 XSS 修复</b>：<code>javascript:</code> 伪协议可经预览「下载」兜底分支的 &lt;a href&gt; + 自动 click 执行；
                                已在数据源头加协议白名单 + 兜底分支二次校验</li>
                            <li><b>配额修复</b>：自定义模型流式接口此前无门禁也不记账（搜索额度只读不扣，可无限绕过）；深度研究断流不再免单、
                                用量改为全链路累计</li>
                            <li><b>合规整改</b>：通讯录与剪贴板采集<b>整体移除</b>（后端接口 / 后台标签页 / 前端入口 / 字段白名单全部删除），
                                存量数据由迁移 057 清除</li>
                            <li><b>IP 属地</b>：数据源改并行竞速并补中文参数（不再显示 <code>Zhejiang Sheng Hangzhou</code> 这类英文）、
                                帖子详情弹窗补显示属地、发布后轮询窗口对齐后端重试节奏</li>
                            <li><b>响应式</b>：高度单位补 <code>100vh</code> 兜底（旧浏览器不再高度塌陷）、横屏手机排除回移动布局、
                                次要样式加 preload 减少布局跳变</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.90',
                    date: '2026-06-25',
                    content: `
                        <h4>邮件发送记录重构 + 历史邮箱双保险持久化</h4>
                        <ul>
                            <li><b>邮件发送记录</b>：删除 from_email 列、详情列、收件人合计列；表格改为 时间 / 接收邮件账号 / 接收人 / 主题 / 结果</li>
                            <li><b>接收人列</b>：网站用户显示用户名，外部邮箱显示邮箱号；多收件人显示"第一个 + 等 N 人"，title 放完整列表</li>
                            <li><b>历史邮箱双保险</b>：后端 /admin/send-email 内部保存 + 前端 emailSend 发送后主动调用 POST /admin/email-recipient-history</li>
                            <li><b>4 种状态都保存历史</b>：成功 / 部分失败 / 全部失败 / 网络异常 都调用 saveRecipientsHistorySafe，失败只 console.warn</li>
                            <li><b>后端 helper</b>：新增 normalizeEmailAddress / isValidEmailAddress / normalizeRecipientUserName / saveEmailRecipientHistory</li>
                            <li><b>saveEmailRecipientHistory</b>：去重 / 一次性查询 / 已有更新 / 新增补 actor_key + media_url</li>
                            <li><b>API 兼容</b>：POST /admin/email-recipient-history 兼容 recipients 与 emails 两种格式；GET 兼容 info.email / row.media_url 等多字段</li>
                            <li><b>旧数据兼容</b>：recipients / emails / recipient_email / to_email / total_recipients 都能解析</li>
                            <li><b>不影响</b>：邮件发送主流程（SMTP / SendGrid / GAS）、/admin/send-email、/admin/email-history、照片墙 / 聊天 / 底部 Dock / 普通帖子</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.88c',
                    date: '2026-06-24',
                    content: `
                        <h4>修复邮件历史邮箱账户不保存 + 发送记录增加详情</h4>
                        <ul>
                            <li><b>后端 send-email 路由</b>：发送前先调用 saveEmailRecipientHistory 保存收件人历史</li>
                            <li><b>saveEmailRecipientHistory helper</b>：去重 / 一次性查询 / 已有更新 / 新增插入；新增时补齐 actor_key + media_url</li>
                            <li><b>发送记录字段扩展</b>：新增 from_email 与 recipients_detail 字段</li>
                            <li><b>前端 loadEmailHistory</b>：显示 时间 / 发件邮箱 / 主题 / 收件人 / 结果 / 详情（含展开）</li>
                            <li><b>前端 loadEmailRecipientHistory</b>：展示 用户名 &lt;邮箱&gt; / 邮箱 两种形式</li>
                            <li><b>发送成功后</b>：自动清空已选 + 刷新历史 + 刷新记录</li>
                            <li>emailClearSelected 添加到发送成功链</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.88b',
                    date: '2026-06-24',
                    content: `
                        <h4>邮件配置健康检查端点 + bug 修复</h4>
                        <ul>
                            <li><b>/health/mail</b>：返回 active_provider（GAS / SendGrid / Gmail_SMTP）以及 env 加载状态</li>
                            <li>修复 SENDGRID_API_KEY 误用 var 声明被覆盖的隐患</li>
                            <li>修复 /admin/report/:id/delete-post 和 /admin/report/:id/ban-user 端点缺少顶层 try-catch</li>
                            <li>修复 index.html / README.md / CHANGELOG.md 版本号不一致</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.88a',
                    date: '2026-06-24',
                    content: `
                        <h4>Google Apps Script (GAS) 邮件中转通道上线</h4>
                        <ul>
                            <li><b>GAS HTTPS 443 中转</b>：绕过 Render SMTP 465/587 端口封锁</li>
                            <li><b>发送优先级</b>：GAS (HTTPS 443) > SendGrid > Gmail SMTP（最终兜底）</li>
                            <li><b>失败链</b>：GAS 失败 → SendGrid → Gmail SMTP</li>
                            <li><b>GMAIL_GAS_URL 环境变量</b>：必须在 Render Dashboard 准确填入 Key/Value，不能有空格</li>
                            <li><b>GAS Web App</b>：部署权限必须设为"任何人"（Anyone）以允许未认证请求</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.87',
                    date: '2026-06-24',
                    content: `
                        <h4>安全修复</h4>
                        <ul>
                            <li><b>【严重】</b>邮件发送记录泄露到帖子首页：<code>__email_sent__</code> 全量加入所有 SQL 过滤链 + 客户端过滤链（共 21 处），刷新即消失</li>
                            <li><b>Cookie maxAge 单位修复</b>：原来写的是秒（72秒过期），改为毫秒（72小时）</li>
                            <li><b>管理员 token 不再暴露前端 localStorage</b>：/admin/login 不再返回 token，前端登录后不写 localStorage，全走 HttpOnly Cookie + credentials: same-origin</li>
                            <li><b>吊销 token 持久化修复</b>：loadRevokedTokenHashes select 补 id 字段，清理时 r.id 存在；persistRevokedToken 后立即加入内存集合</li>
                            <li><b>用户删除后旧 token 失效</b>：authenticateUser 额外查询 __auth__ 记录确认用户仍存在</li>
                            <li><b>移除 query.password_hash</b>：authenticateUser 不再接受 URL query 传 password_hash，只允许 body/Authorization</li>
                            <li><b>审计日志 operator 修复</b>：verifyToken 统一设置 req.adminUser</li>
                        </ul>
                        <h4>Bug 修复</h4>
                        <ul>
                            <li><b>懒加载数据赋值修复</b>：reports 数据赋值到 reportsData、mutes 到 mutesData、新增 blacklist 分支</li>
                            <li><b>page_visit 无 password_hash 不发送</b>：改为有 token 也能发送</li>
                            <li><b>Cookie 登录后后台卡死</b>：loadAllData / fetchRegisterAlerts / renderPostsTab 等 5 处 getToken() 门禁全部移除</li>
                            <li><b>退出登录不清理 Cookie</b>：doAdminLogout 无论有无 localStorage token 都请求 /admin/logout</li>
                        </ul>
                        <h4>新增</h4>
                        <ul>
                            <li><b>邮件历史邮箱账户</b>：发送邮件后自动保存收件人历史，管理员可点选/删除/清空</li>
                            <li><b>邮箱后缀快速补全</b>：输入账号时实时显示 @qq.com / @163.com / @gmail.com 等 9 个后缀</li>
                        </ul>
                        <h4>性能</h4>
                        <ul>
                            <li>/admin/data 去掉 3 个重量级查询（reports/mutes/blacklist），改为按 tab 懒加载</li>
                            <li>移除初始化 500ms 后自动预加载 users/security/audit/errorlog/photos</li>
                            <li>邮件 SMTP 端口自动回退：465 SSL 失败自动重试 587 STARTTLS</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.86',
                    date: '2026-06-23',
                    content: `
                        <h4>全面 Bug 修复 & 支付事务保护</h4>
                        <ul>
                            <li><b>VIP 支付事务保护</b>：先写 VIP 记录再更新订单状态，避免"付了钱没开通"</li>
                            <li><b>头像上传回滚</b>：先插入新记录再删旧记录，防止头像丢失</li>
                            <li><b>登出彻底清理</b>：遍历所有 xtj_* 前缀 localStorage，避免跨用户缓存泄露</li>
                            <li><b>Observer 内存泄漏</b>：beforeunload 时 disconnect 所有 IntersectionObserver</li>
                            <li><b>乱码修复立即生效</b>：_buildMjRegex IIFE 加载时执行，任意时机可用</li>
                            <li><b>浏览器兼容</b>：deviceMemory / hardwareConcurrency 加 typeof 检查</li>
                            <li>visitCache 改为 setTimeout 异步清理，不阻塞事件循环</li>
                            <li>Supabase 初始化检查，无效时 sb = null</li>
                            <li>desktop.css / core.js 等 query string 版本号升级</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.85',
                    date: '2026-06-23',
                    content: `
                        <h4>全量安全审计修复、设备识别大幅升级、聊天头像即时更新</h4>
                        <ul>
                            <li><b>Pro 赠送活动系统</b>：管理员后台创建/编辑/发布 Pro 赠送活动，用户一键免费领取</li>
                            <li><b>Pro 历史记录系统</b>：后台新增「Pro记录」子标签，展示用户开通次数/来源/时间线</li>
                            <li>Pro 领取庆祝动画重做：暗色渐变卡片，显示来源信息，GSAP 分段入场</li>
                            <li><b>【安全】</b>XSS 高危漏洞修复（safeJsStr 全转义 + 注册字符限制）</li>
                            <li><b>【安全】</b>Storage 路径遍历防护、后端错误信息不返回前端</li>
                            <li><b>【安全】</b>RateLimit 边界修复、fetch 超时保护、currentUser TDZ 修复</li>
                            <li><b>【安全】</b><code>window.sb</code> 不再被 admin.js 删除，前后台可共存</li>
                            <li>设备型号识别升级：新增 UA 标识符映射表，15 Pro Max 不再误判为 16 Plus</li>
                            <li>聊天列表头像即时更新：全量检查头像并刷新列表 DOM</li>
                            <li>地区中文显示：<code>China·Guangdong·Guangzhou</code> → 广东广州</li>
                            <li>用户详情卡片数据回填：最近访问/IP/地区/设备从登录事件自动回填</li>
                            <li>用户详情弹窗去掉最近安全提醒区块</li>
                            <li>举报弹窗 × 按钮独立样式修复</li>
                            <li>点赞/评论记录显示被操作人（xxz 点赞了 yy 的内容）</li>
                            <li>未登录用户隐藏帖子页三大数据版块</li>
                            <li>管理员登出清理定时器与事件监听</li>
                            <li>邮箱发件地址修正：Resend 免费版强制使用 onboarding@resend.dev</li>
                            <li>管理员邮箱发送结果展示详细失败原因</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>设备识别链路重做：UA 标识符优先，分辨率推断降级为兜底</li>
                            <li>注册入口增加字符集与长度双重校验</li>
                            <li>设备详情弹出卡从内联展开改为 860px 模态框</li>
                            <li>后台登出时完整清理定时器与事件监听</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做设备型号识别引擎：UA 标识符映射优先</li>
                            <li>重做聊天列表头像更新机制：每次全量刷新</li>
                            <li>重做后台会话管理：登出时完整清理</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.84',
                    date: '2026-06-22',
                    content: `
                        <h4>新增</h4>
                        <ul>
                            <li>管理后台新增"🛡️ 安全中心"：同 IP 多账号、同设备多账号、多 IP 同账号、地区变化、高频访问五类安全提醒</li>
                            <li>安全提醒支持已读、忽略、误报三种处理状态</li>
                            <li>客户端温和浏览器指纹 + Canvas 指纹 Hash（仅保存 hash，不存图像/像素）</li>
                            <li>前端错误监控：JS error、unhandledrejection、fetch 失败、图片加载失败、白屏检测自动上报</li>
                            <li>管理员操作审计日志：所有敏感操作全记录</li>
                            <li>日志保留与清理：登录/安全日志 90 天，错误日志 30 天</li>
                            <li>用户详情弹窗：点击用户名查看完整信息（IP、地区、设备、指纹、统计、登录记录、安全提醒、处罚历史）</li>
                            <li>风险评分系统：用户列表显示"正常/低风险/中风险/高风险"</li>
                            <li>安全识别开关：可独立控制基础设备、浏览器指纹、Canvas 指纹、安全提醒的采集与生成</li>
                        </ul>
                        <h4>修复</h4>
                        <ul>
                            <li>用户列表最近 IP 改为完整显示，不再打码</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>IP 地区解析改为多源 fallback</li>
                            <li>登录事件写入后同步更新用户信息</li>
                            <li>页面访问冷却改为 15 秒</li>
                        </ul>
                        <h4>安全</h4>
                        <ul>
                            <li>所有敏感数据仅限管理员后台查看，前台不泄露</li>
                            <li>指纹仅作辅助判断，不做跨站追踪</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.83',
                    date: '2026-06-21',
                    content: `
                        <h4>修复</h4>
                        <ul>
                            <li>统计弹窗恢复到旧版记录布局，不再继续沿用 <code>statHero</code> / <code>stat-row</code> 的面板化样式</li>
                            <li>“总动态”恢复为按用户分组的列表结构，组头只保留头像首字母、用户名和条数胶囊</li>
                            <li>修复总动态中坏标签、乱码、时间与内容挤在一起、移动端时间断行等问题</li>
                            <li>修复“总浏览”“点赞和评论”里图片帖只剩文字、原帖缩略图缺失、评论内容不独立显示的问题</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>总浏览统一改回图文记录卡，浏览图片帖时优先显示真实缩略图，视频帖显示视频占位</li>
                            <li>点赞记录与评论记录统一为旧版风格记录卡，原帖查不到时明确显示“原帖已删除”</li>
                            <li>统计弹窗移动端布局收口为横向卡片，时间保持单行省略，不再退回竖排</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做统计弹窗恢复策略：以 Git 历史旧版结构为基线回退，而不是继续在当前救火覆盖层上叠补丁</li>
                            <li>重做版本同步到 <code>v0.83</code>，让关于页、站内 changelog、仓库文档与构建产物保持一致</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.82',
                    date: '2026-06-21',
                    content: `
                        <h4>修复</h4>
                        <ul>
                            <li>修复首页三大统计卡片点击后弹窗无响应的问题，“总动态 / 总浏览 / 点赞和评论” 重新可打开 <code>#statModal</code></li>
                            <li>修复 <code>js/core.js</code> 中 <code>applyPerformanceMode()</code> 的作用域错误，避免脚本在初始化阶段中断</li>
                            <li>修复旧版 <code>bindHeaderActionButtons()</code> 与最终全局导出互相干扰，导致公告与举报入口失效的问题</li>
                            <li>修复顶部公告按钮与举报按钮的运行时入口链路，点击后不再被前序异常打断</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>首页入口排查改为以浏览器真实点击结果为准，优先定位真实 <code>runtime blocker</code></li>
                            <li>入口验证改为 <code>node --check</code>、<code>npm run build</code> 与浏览器点击结果三层校验</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做首页入口修复思路：从静态绑定补丁改为先清理前序 runtime blocker，再让最终全局入口生效</li>
                            <li>重做统计 / 公告 / 举报的修复标准，以真实 modal 打开结果为准，而不是只看函数名是否存在</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.81',
                    date: '2026-06-20',
                    content: `
                        <h4>新增</h4>
                        <ul>
                            <li>后台新增“新用户注册提醒”，只统计 <code>__auth__</code> 注册记录，并在“用户数据”入口显示红点数字</li>
                            <li>新增 <code>/admin/users/register-alerts</code> 和 <code>/admin/users/register-alerts/read</code> 两个后台接口</li>
                        </ul>
                        <h4>修复</h4>
                        <ul>
                            <li>修复后台用户统计口径不一致：<code>/admin/stats/users</code> 现在统一聚合 <code>__auth__</code>、<code>__user_info__</code>、<code>__user_visit__</code></li>
                            <li>修复 <code>/admin/stats/daily</code> 中 <code>new_users</code> 被重复注册记录放大的问题，改为按用户名去重后只认最早注册时间</li>
                            <li>修复 <code>/admin/stats</code> 顶部 <code>total_users</code> 被重复 <code>__auth__</code> 记录放大的问题</li>
                            <li>修复照片墙全屏预览在 iPhone / iPad 上双指缩放乱飞、松手跳变、误触单击缩放的问题</li>
                            <li>修复 pinch 结束后松开一根手指继续拖图时沿用旧起点，导致图片突然跳回旧坐标的问题</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>照片墙移动端预览手势统一为单一状态机，pinch / pan / swipe / dismiss 明确互斥</li>
                            <li>后台首次打开注册提醒时默认只统计最近 24 小时新注册用户，避免历史数据一次性冲上红点</li>
                            <li>pinch 结束后增加至少 <code>350ms</code> 的 tap / doubleTap 屏蔽窗口，避免误触把图片立刻缩回原图</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做后台注册用户统计链路，让注册数、用户总数、访问明细三处统一按用户名去重</li>
                            <li>重做照片墙移动端预览热修复策略，改为由 <code>preview-hotfix.js</code> 统一接管移动端触摸手势，并对齐 hotfix 标记</li>
                            <li>重做 pinch 到 pan 的交接逻辑，双指结束后立即以剩余手指重建拖拽起点</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.80',
                    date: '2026-06-18',
                    content: `
                        <h4>新增</h4>
                        <ul>
                            <li>照片墙单次加载数量从 20 提升到 60，首次进入即可看到更多历史内容</li>
                            <li>导出 <code>window.normalizePhotoWallRow</code>，上传完成后新照片可以即时插入当前列表</li>
                        </ul>
                        <h4>修复</h4>
                        <ul>
                            <li>修复照片墙仍命中旧缓存导致只显示陈旧数据的问题</li>
                            <li>修复老视频无 thumb 时直接显示空白块的问题，补上运行时首帧封面兜底</li>
                            <li>修复多处前端 XSS 风险、调试输出残留与重复 BOM 问题</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>将 <code>admin.html</code> 的 Supabase CDN 脚本改为 defer，减少阻塞</li>
                            <li>将 <code>ui-enhance.css</code> 提前到 head 加载，减少样式闪动</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做照片墙数据链路，从缓存优先收口为实时读取 + 更大首屏批量</li>
                            <li>重做上传后同步链路，标准化数据、即时插入、清缓存、强制重取统一到一条路径</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.79',
                    date: '2026-06-15',
                    content: `
                        <h4>新增</h4>
                        <ul>
                            <li>帖子视频与照片墙视频统一按 10MB 规则处理，超过阈值会先尝试浏览器端压缩</li>
                            <li>照片墙老视频补上运行时首帧封面兜底，避免无 thumb 时直接露出空白块</li>
                        </ul>
                        <h4>修复</h4>
                        <ul>
                            <li>修复非 Pro 用户帖子误显示 Pro 标记的问题，渲染只认发帖冻结状态与历史有效期</li>
                            <li>修复举报弹层文字帖重复显示作者名与“文字帖”标签挡内容的问题</li>
                            <li>修复照片墙视频点击入口与全屏预览链路不一致的问题</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>视频大小信息统一优先展示最终上传大小 fileSize，并保留 originalSize 供详情查看</li>
                            <li>举报弹层顶部收敛为单标题 + 图标按钮，减少重复入口</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做举报弹层文字帖卡片骨架与记录入口样式，统一成更简洁的内容优先结构</li>
                            <li>重做 v0.79 版本同步链路，关于页、站内 changelog、仓库 CHANGELOG.md 三处统一</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.78',
                    date: '2026-06-14',
                    content: `
                        <h4>版本与更新日志同步</h4>
                        <ul>
                            <li>关于页版本显示统一更新为 xtj v0.78</li>
                            <li>站内更新日志补充 v0.78 版本记录</li>
                            <li>仓库 CHANGELOG.md 与站内版本记录同步，避免版本信息分裂</li>
                        </ul>
                        <h4>文案整理</h4>
                        <ul>
                            <li>本次版本记录按正式发布口径重新整理，保留清晰的分节结构</li>
                            <li>继续保留 Remade 板块，用来标记重做、重写、重构类更新</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做了版本记录的同步方式，让关于页版本号、站内 changelog、仓库 changelog 三处保持一致</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.77',
                    date: '2026-06-13',
                    content: `
                        <h4>版本号与更新日志同步</h4>
                        <ul>
                            <li>版本展示统一更新为 xtj v0.77</li>
                            <li>更新日志补充 v0.77 版本记录</li>
                            <li>保持当时的浅绿色 UI 基底，不引入后续蓝化样式调整</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.76',
                    date: '2026-06-12',
                    content: `
                        <h4>按钮点击修复、安全加固与全模块 Bug 修复</h4>
                        <ul>
                            <li>通知/举报/Pro/点赞评论记录按钮点击无响应问题全面修复</li>
                            <li>帖子显示兜底机制：IntersectionObserver 异常时自动降级为可见</li>
                            <li>举报弹窗顶部新增「举报表单」「举报记录」切换标签，与 JS 事件绑定对齐</li>
                        </ul>
                        <h4>修复</h4>
                        <ul>
                            <li>API_BASE 始终使用 window.location.origin，支持任意自定义域名</li>
                            <li>照片墙 upload.min.js 被重复加载导致事件重复绑定</li>
                            <li>/api/photo/delete 安全漏洞：username 不允许为空，必须校验照片归属</li>
                            <li>访问统计中间件放在 express.static 之后导致 GET / 不记录访问</li>
                            <li>删除公告时重新生成 actor_key 导致 RLS 校验失败</li>
                            <li>举报列表未过滤 __vip__、__vip_order__、__user_visit__ 等内部记录</li>
                        </ul>
                        <h4>安全</h4>
                        <ul>
                            <li>照片删除 API 未校验 username 可被任意删除照片的安全漏洞</li>
                            <li>公告删除 RPC 调用传递错误 actor_key 导致 RLS 校验失败的问题</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>IntersectionObserver 增加 try/catch 保护，兼容不支持该 API 的旧浏览器</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.74',
                    date: '2026-06-10',
                    content: `
                        <h4>安全审计全面修复</h4>
                        <ul>
                            <li>修复 Supabase RLS 策略中 AUTH_MARKER 未正确排除 __auth__ 记录的安全漏洞</li>
                            <li>修复 X-Forwarded-For IP 伪造防护：改用 express trust proxy + req.ip</li>
                            <li>修复 CSRF Origin 校验使用 includes() 子串匹配可被绕过的漏洞</li>
                            <li>移除前端重复硬编码的 Supabase URL 和 Anon Key，统一从 config.js 读取</li>
                            <li>管理后台举报处理 API 全部增加数据库操作错误检查和回滚逻辑</li>
                        </ul>
                        <h4>性能与内存泄漏修复</h4>
                        <ul>
                            <li>rateLimitStore 新增每5分钟过期记录自动清理，防止内存无限增长</li>
                            <li>adminTokens 新增每10分钟过期 token 自动清理</li>
                            <li>visitCache 访问去重改用按天清理旧记录，不再全量清除导致统计虚高</li>
                            <li>statsCache 新增并发锁防止多请求重复触发数据库查询</li>
                            <li>统计查询 limit(100000) 降为 20000，减少数据库压力</li>
                            <li>新增 8 条数据库性能索引 SQL（posts/likes/comments/bans/mutes/blacklist）</li>
                        </ul>
                        <h4>加载动画全面升级</h4>
                        <ul>
                            <li>移除旧版 Canvas 春日藤蔓蝴蝶加载动画（~530 行 JS），替换为纯 CSS 照片墙同款动画</li>
                            <li>新动画采用双旋转光环 + 脉冲核心 + 光点轨道设计，GPU 加速渲染流畅不掉帧</li>
                            <li>修复加载动画阻塞内容渲染问题：头像改为后台异步加载，内容立即渲染字母占位头像</li>
                            <li>清理 upload-ui.js 中重复定义的 buildPostPreviewItems 和 ppRotatePhoto 死代码</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重写了加载动画系统，从 Canvas 逐帧绘制改为纯 CSS 动画，页面冷启动加载速度显著提升</li>
                            <li>重构了帖子渲染管线，头像和内容解耦，首屏内容即刻可见不再等待头像加载</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.73',
                    date: '2026-06-08',
                    content: `
                        <h4>管理员禁言拉黑功能验证与全面更新</h4>
                        <ul>
                            <li>后台“用户数据-禁言拉黑”空白问题完整诊断：确认是数据库无活跃记录导致的正常空状态</li>
                            <li>插入三条测试禁言记录验证全链路：API → 数据库 → 前端渲染均正常工作</li>
                            <li>测试覆盖真实用户 11（24小时禁言）、徐廷江（永久禁言），状态徽章和筛选正确展示</li>
                            <li>标签页切换时按需自动拉取最新 bans/mutes/blacklist 数据，数据实时同步</li>
                            <li>用户列表页禁言中/拉黑封禁中筛选与数据库实时同步，筛选结果准确</li>
                        </ul>
                        <h4>安全加固</h4>
                        <ul>
                            <li>通过 Supabase service_role key 验证 RLS 策略配置正确，管理员 API 可绕过行级安全策略</li>
                            <li>确认 JWT 鉴权 + 速率限制 + 输入校验三层防护在禁言拉黑 API 上全部生效</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重写了管理员后台数据加载策略，从一次性加载改为按标签页按需拉取，性能更优</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.71',
                    date: '2026-06-06',
                    content: `
                        <h4>安全审计全面修复与黑名单管理上线</h4>
                        <ul>
                            <li>移除前端硬编码管理员密码，改为后端 API + 环境变量认证</li>
                            <li>新增 CORS 白名单限制、安全响应头、API 频率限制</li>
                            <li>新增输入长度校验、错误信息脱敏、文件上传类型与大小校验</li>
                            <li>增强密码策略：注册密码最小长度提升至 6 位</li>
                            <li>黑名单管理上线：后端 API + 管理后台界面全套 CRUD</li>
                            <li>用户限制状态轮询：15 秒检查拉黑/封禁/禁言状态，即时生效</li>
                            <li>后端管理 API 全面重写：JWT Token 鉴权 + 频率限制 + 输入校验 + 错误脱敏四层防护</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.70',
                    date: '2026-06-05',
                    content: `
                        <h4>后台管理大更新</h4>
                        <ul>
                            <li>用户列表 UI 全面美化：卡片式网格布局 + 筛选排序搜索</li>
                            <li>筛选功能：按状态（全部/管理员/拉黑封禁中/禁言中）快速筛选</li>
                            <li>排序功能：按注册时间/最近登录/帖子数排序</li>
                            <li>拉黑封禁表和禁言表新增解除时间列，一目了然</li>
                            <li>封禁改名为拉黑封禁，移除冗余的黑名单版块</li>
                        </ul>
                        <h4>修复</h4>
                        <ul>
                            <li>修复用户列表最近登录时间显示旧数据问题</li>
                            <li>修复管理面板初始化未加载 bans/mutes 数据</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做了后台用户列表 UI 和交互体验，更清晰直观</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.69',
                    date: '2026-06-04',
                    content: `
                        <h4>我的页互动收口</h4>
                        <ul>
                            <li>我的页点赞记录和评论记录改为首页只预览 1 条，减少首屏占位</li>
                            <li>更多点赞内容和更多评论内容统一改成二级弹层，不再把当前页面拉得很长</li>
                            <li>评论记录整条可直接查看帖子，主按钮改成删除评论</li>
                            <li>点赞记录缩略图位置收紧到文案右侧，信息关系更清晰</li>
                        </ul>
                        <h4>详情入口整理</h4>
                        <ul>
                            <li>所有非首页查看详情入口移除置顶和取消置顶操作，避免和首页帖子操作重复</li>
                            <li>我的页互动卡、互动二级弹层、帖子详情弹层统一向首页帖子卡样式靠拢</li>
                        </ul>
                        <h4>Remade</h4>
                        <ul>
                            <li>重做了我的页互动入口、记录弹层和详情入口关系，整个链路更短、更干净，也更顺手</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.67',
                    date: '2026-06-02',
                    content: `
                        <h4>性能大幅优化</h4>
                        <ul>
                            <li>花草圈圈 Canvas 动画全面优化：阴影模糊降低60%、藤蔓分段减少33%、花粉减至8粒、蝴蝶残影减至1层</li>
                            <li>escapeHtml 改用纯字符串替换避免创建DOM元素；fixText 改为单次正则替换</li>
                            <li>全局 pointerdown 加80ms节流；移除多个 will-change 反效果声明</li>
                            <li>perf-lite 彻底禁用 echo-loader 无限循环动画；perf-balanced 大幅降低阴影和模糊</li>
                            <li>筛选用户加载动画改为中心120px花草圈圈Canvas动画</li>
                        </ul>
                    `
                },
                            {
                    version: 'v0.64',
                    date: '2026-05-31',
                    content: `
                        <h4>乱码修复与动画升级</h4>
                        <ul>
                            <li>帖子卡片浏览、点赞、评论文字乱码</li>
                            <li>点赞(❤️)、评论、编辑、删除、置顶等按钮文字乱码</li>
                            <li>私密切换和置顶徽章乱码</li>
                            <li>统计正则匹配乱码，确保计数正确更新</li>
                            <li>帖子详情页、摘要、Toast 消息中的多处乱码</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>加载动画新增 8 颗浮动星辰粒子，蓝紫白辉光飘移</li>
                            <li>光环、符文环、镜面核心视觉增强</li>
                            <li>交互粒子爆发升级：42 颗、8 色、可变大小、扩散范围加大</li>
                            <li>照片墙信息模板点击外部和再次点击 i 均可关闭</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.62',
                    date: '2026-05-30',
                    content: `
                        <h4>功能优化与Bug修复</h4>
                        <ul>
                            <li>筛选功能优化：将内联筛选控件整合为折叠式"筛选"按钮面板，支持活跃筛选计数徽章</li>
                            <li>移除帖子举报按钮及全部相关代码，清理前端残留</li>
                        </ul>
                        <h4>修复</h4>
                        <ul>
                            <li>修复编辑帖子时公开/私密选项不真正生效的问题</li>
                            <li>修复帖子置顶功能不生效的问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.61',
                    date: '2026-05-30',
                    content: `
                        <h4>项目清理与全面检查</h4>
                        <ul>
                            <li>删除所有冗余备份文件、临时修复脚本和测试脚本（js备份、scripts目录、root fix/test等）</li>
                            <li>全面检查：HTML引用完整性、JS语法（全部通过）、乱码扫描、后端服务验证</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.60',
                    date: '2026-05-28',
                    content: `
                        <h4>核心功能修复与照片墙预览优化</h4>
                        <ul>
                            <li>修复编辑帖子公开/私密不真正生效问题</li>
                            <li>修复统计详情泄露私密帖子互动</li>
                            <li>修复照片预览双击缩小/双指缩放不稳定</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>照片墙预览新增双指缩放</li>
                            <li>标记废弃函数避免误修改</li>
                            <li>upload.js select 字段完整性提升</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.59',
                    date: '2026-05-27',
                    content: `
                        <h4>功能修复与稳定性提升</h4>
                        <ul>
                            <li>修复举报按钮点击无响应问题</li>
                            <li>修复举报提交字段名匹配，添加 fallback 机制</li>
                            <li>修复通知开关 localStorage key 不一致</li>
                            <li>修复统计详情泄露私密帖子互动</li>
                            <li>修复帖子详情页无私密权限检查</li>
                            <li>修复发帖文件上传未检查错误</li>
                        </ul>
                        <h4>优化</h4>
                        <ul>
                            <li>照片墙缩略图加载速度提升</li>
                            <li>去除 index.html UTF-8 BOM</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.56',
                    date: '2026-05-26',
                    content: `
                        <h4>照片墙优化与Bug修复</h4>
                        <ul>
                            <li>照片墙缩略图延迟加载(LazyLoad)，滚动到可视区域再加载</li>
                            <li>大图预览优化，支持手势缩放和滑动切换</li>
                            <li>移除原生 confirm 弹窗，统一替换为自定义弹窗</li>
                            <li>优化统计数据显示，修复计数不准确问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.55',
                    date: '2026-05-26',
                    content: `
                        <h4>照片墙优化</h4>
                        <ul>
                            <li>照片墙性能优化：减少重排重绘，提升滚动流畅度</li>
                            <li>修复照片上传后不立即显示的问题</li>
                            <li>优化照片加载状态提示</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.54',
                    date: '2026-05-25',
                    content: `
                        <h4>API性能优化</h4>
                        <ul>
                            <li>优化 Supabase 查询性能，减少不必要的数据请求</li>
                            <li>新增双指缩放/捏合手势支持</li>
                            <li>稳定性提升：修复多条件竞态问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.53',
                    date: '2026-05-25',
                    content: `
                        <h4>闭包陷阱修复</h4>
                        <ul>
                            <li>修复循环中的闭包陷阱导致的数据加载错误</li>
                            <li>优化异步数据加载逻辑，避免重复请求</li>
                            <li>修复特定条件下页面白屏问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.52',
                    date: '2026-05-25',
                    content: `
                        <h4>照片墙数据丢失修复</h4>
                        <ul>
                            <li>修复照片墙数据丢失问题：优化数据同步机制</li>
                            <li>新增筛选和排序功能</li>
                            <li>全屏预览模式优化</li>
                            <li>跨模块数据一致性修复</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.51',
                    date: '2026-05-25',
                    content: `
                        <h4>CSS性能优化</h4>
                        <ul>
                            <li>优化 CSS 选择器性能，减少重排重绘</li>
                            <li>图片压缩优化，首屏加载速度提升</li>
                            <li>移除冗余 CSS 代码</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.50',
                    date: '2026-05-25',
                    content: `
                        <h4>照片墙功能增强</h4>
                        <ul>
                            <li>照片墙交互优化：新增双击缩放、滑动切换</li>
                            <li>优化照片分类和标签系统</li>
                            <li>提升移动端触摸体验</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.40',
                    date: '2026-05-24',
                    content: `
                        <h4>UI视觉优化</h4>
                        <ul>
                            <li>整体UI视觉优化：统一设计语言</li>
                            <li>照片墙滑块组件优化</li>
                            <li>响应式布局适配改进</li>
                            <li>清理废弃代码</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.38',
                    date: '2026-05-18',
                    content: `
                        <h4>移除雅思词汇系统</h4>
                        <ul>
                            <li>移除完整的雅思词汇学习系统</li>
                            <li>清理所有相关代码和样式</li>
                            <li>优化整体性能</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.37',
                    date: '2026-05-18',
                    content: `
                        <h4>雅思词汇页面增强</h4>
                        <ul>
                            <li>panelAi 改造：采用简洁 HTML 结构</li>
                            <li>单词图片 base64 化，适配 localStorage 存储</li>
                            <li>响应式布局 grid-template-columns: repeat(5, 1fr)</li>
                            <li>悬停和交互动画优化</li>
                            <li>预览显示作者、发布时间和浏览数</li>
                            <li>照片按上传时间排序（最新在前）</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.36',
                    date: '2026-05-13',
                    content: `
                        <h4>极致毛玻璃效果</h4>
                        <ul>
                            <li>修复所有浏览器 backdrop-filter 兼容性问题</li>
                            <li>锁屏面板和遮罩层毛玻璃效果完善</li>
                            <li>卡片、选项、反馈面板高级毛玻璃质感</li>
                            <li>优化毛玻璃遮罩层叠顺序</li>
                            <li>暗色模式同步深度渐变背景</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.35',
                    date: '2026-05-13',
                    content: `
                        <h4>音频系统修复与毛玻璃增强</h4>
                        <ul>
                            <li>修复 AudioContext 被浏览器挂起导致无声的问题</li>
                            <li>修复继续按钮位置：调整间距布局</li>
                            <li>毛玻璃效果增强：卡片/选项/反馈面板统一优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.34',
                    date: '2026-05-13',
                    content: `
                        <h4>学习系统增强</h4>
                        <ul>
                            <li>修复继续按钮位置，反馈移到底部</li>
                            <li>新增对错答案音效反馈</li>
                            <li>Web Audio API 语音优化</li>
                            <li>修复音频资源管理内存泄漏</li>
                            <li>修复主题切换导致的 CPU 100% 问题</li>
                            <li>TTS 语音进一步优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.33',
                    date: '2026-05-13',
                    content: `
                        <h4>雅思词汇重构与代码清理</h4>
                        <ul>
                            <li>布局重构为简洁单词卡片样式</li>
                            <li>TTS 语音优化，自动选择最自然发音</li>
                            <li>新增错误计数追踪和准确率进度条</li>
                            <li>新增重新学习/查看答案切换功能</li>
                            <li>移除 toggleAIChat 函数和 AI 欢迎消息</li>
                            <li>移除 Taylor Swift 画廊初始化</li>
                            <li>修复 Git 合并冲突</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.32',
                    date: '2026-05-12',
                    content: `
                        <h4>雅思词汇升级</h4>
                        <ul>
                            <li>完整雅思词库升级，学术分类</li>
                            <li>新增 3000+ 核心雅思词汇</li>
                            <li>从 abandon 到 yield，完整 A-Z 覆盖</li>
                            <li>每个单词含标准音标、英文例句和中文翻译</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.31',
                    date: '2026-05-12',
                    content: `
                        <h4>Taylor Swift 与 Jennie 替换为雅思词汇</h4>
                        <ul>
                            <li>删除原 idol/ts 前缀全部样式</li>
                            <li>新增完整雅思词汇学习系统样式</li>
                            <li>200 核心雅思词汇含音标、释义和例句</li>
                            <li>双模式学习：英译中/中译英</li>
                            <li>完整暗色/亮色主题支持</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.30',
                    date: '2026-05-03 16:00',
                    content: `
                        <h4>Taylor Swift 功能完全移除</h4>
                        <ul>
                            <li>删除全部 .ts- 前缀 CSS 样式</li>
                            <li>新增 .idol- 命名空间样式替代</li>
                            <li>引入 Google Fonts Great Vibes 手写字体</li>
                            <li>相册卡片悬停缩放和毛玻璃效果</li>
                            <li>SVG 装饰元素视觉增强</li>
                            <li>移除 Taylor Swift JavaScript 代码</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.29',
                    date: '2026-05-03 15:30',
                    content: `
                        <h4>Taylor Swift 页面交互升级</h4>
                        <ul>
                            <li>SVG 装饰元素悬停动画</li>
                            <li>12 张专辑卡片悬停预览效果</li>
                            <li>每张专辑支持点击进入详情页</li>
                            <li>专辑详情含封面、时代照片、专辑故事、曲目列表</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.28',
                    date: '2026-05-03 15:00',
                    content: `
                        <h4>Taylor Swift 12 专辑展示</h4>
                        <ul>
                            <li>Taylor Swift 页面重构为 12 专辑展示</li>
                            <li>新增 evermore、Midnights、The Tortured Poets Department 等</li>
                            <li>专辑卡片真实封面、海报式布局、渐入暂停过渡</li>
                            <li>渐变背景和精致悬停效果</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.27',
                    date: '2026-05-03 14:00',
                    content: `
                        <h4>AI 聊天替换为 Taylor Swift</h4>
                        <ul>
                            <li>DeepSeek AI 替换为 Taylor Swift 主题界面</li>
                            <li>添加 Taylor Swift SVG 装饰元素</li>
                            <li>8 张专辑卡片从 Debut 到 folklore</li>
                            <li>渐变背景和专辑专属图标</li>
                            <li>修复已知崩溃和页面白屏问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.26',
                    date: '2026-05-03 12:00',
                    content: `
                        <h4>iOS Safari 兼容性修复</h4>
                        <ul>
                            <li>修复 iOS Safari 兼容性问题</li>
                            <li>修复灵动岛/刘海区域视觉适配</li>
                            <li>修复登录时间不更新问题</li>
                            <li>优化 iOS Safari 滚动性能</li>
                            <li>修复 iOS 上 Toast 通知显示</li>
                            <li>修复多项 UI 显示问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.25',
                    date: '2026-05-03 10:35',
                    content: `
                        <h4>版本号显示更新</h4>
                        <ul>
                            <li>更新版本号显示在版本更新日志系统中</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.24',
                    date: '2026-05-03 10:20',
                    content: `
                        <h4>头像与固定定位修复</h4>
                        <ul>
                            <li>修复头像 URL 处理，添加 actor_key=__avatar__ 回退</li>
                            <li>修复某些场景下 position:fixed 渲染问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.23',
                    date: '2026-05-03 10:00',
                    content: `
                        <h4>数据查询与性能优化</h4>
                        <ul>
                            <li>修复 JSON 内容解析的数据获取错误</li>
                            <li>数据查询优化：limit(1) + maybeSingle 模式</li>
                            <li>Fetch 限制从 1000 降至 20 提升性能</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.22',
                    date: '2026-05-03 09:50',
                    content: `
                        <h4>头像与触摸交互修复</h4>
                        <ul>
                            <li>修复 loadAvatarsForUsers 函数头像加载问题</li>
                            <li>修复 touch-action 交互问题</li>
                            <li>修复 html/body overflow:hidden 滚动锁定</li>
                            <li>修复多项 UI 和交互问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.21',
                    date: '2026-05-03 09:30',
                    content: `
                        <h4>头像与导航修复</h4>
                        <ul>
                            <li>修复头像自动回退问题（localStorage 优先，DB 不再覆盖）</li>
                            <li>优化导航栏交互</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.20',
                    date: '2026-05-03 09:20',
                    content: `
                        <h4>管理面板与聊天修复</h4>
                        <ul>
                            <li>修复管理面板数据获取错误</li>
                            <li>聊天列表背景预加载，实现即时打开</li>
                            <li>移除帖子列表右侧滚动条</li>
                            <li>修复交互状态一致性问题</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.19',
                    date: '2026-05-03 09:10',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.18',
                    date: '2026-05-03 08:30',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.17',
                    date: '2026-05-02 17:00',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.16',
                    date: '2026-05-02 16:53',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.15',
                    date: '2026-05-02 16:30',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.14',
                    date: '2026-05-02 16:20',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.13',
                    date: '2026-05-02 14:58',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.12',
                    date: '2026-05-02 01:00',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.11',
                    date: '2026-05-02',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.10',
                    date: '2026-05-02',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.9',
                    date: '2026-05-02',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.8',
                    date: '2026-05-02',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.7',
                    date: '2026-05-02',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.6',
                    date: '2026-05-01',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.5',
                    date: '2026-04-30',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.4',
                    date: '2026-04-29',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                },
                {
                    version: 'v0.0.3',
                    date: '2026-04-28',
                    content: `
                        <h4>Bug修复与改进</h4>
                        <ul>
                            <li>问题修复和性能优化</li>
                        </ul>
                    `
                }
            ];

            let currentAnnouncementTab = 'announcements';
            function switchAnnouncementTab(tab) {
                currentAnnouncementTab = tab;
                const tabs = document.querySelectorAll('.announcement-tab');
                tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
                const listContainer = document.getElementById('announcementListContainer');
                const detailContainer = document.getElementById('announcementDetail');
                const changelogContainer = document.getElementById('changelogContainer');
                const adminArea = document.getElementById('announcementAdminArea');
                if (tab === 'announcements') {
                    listContainer.style.display = 'block';
                    detailContainer.style.display = 'none';
                    changelogContainer.style.display = 'none';
                    if (isAdmin()) adminArea.style.display = 'block';
                } else {
                    listContainer.style.display = 'none';
                    detailContainer.style.display = 'none';
                    changelogContainer.style.display = 'block';
                    adminArea.style.display = 'none';
                    renderChangelogList();
                }
            }
            function renderChangelogList() {
                const listEl = document.getElementById('changelogList');
                if (!listEl) return;
                listEl.innerHTML = '';
                changelogData.forEach((item, index) => {
                    const div = document.createElement('div');
                    div.className = 'changelog-item';
                    div.innerHTML = `
                        <div class="changelog-header">
                            <div class="changelog-version">版本 ${item.version}</div>
                            <div class="changelog-date">${item.date}</div>
                        </div>
                        <div class="changelog-content">
                            ${item.content}
                        </div>
                    `;
                    listEl.appendChild(div);
                    requestAnimationFrame(() => {
                        setTimeout(() => {
                            div.style.opacity = '1';
                            div.style.transform = 'translateY(0)';
                        }, index * 80);
                    });
                });
            }
            // 绑定公告 tab 切换事件
            document.querySelectorAll('.announcement-tab').forEach(btn => {
                btn.addEventListener('click', function() {
                    switchAnnouncementTab(this.dataset.tab);
                });
            });
            // 增强 showAnnouncementList 以支持当前标签状态
            const originalShowAnnouncementList = showAnnouncementList;
            window.showAnnouncementList = function() {
                if (currentAnnouncementTab !== 'announcements') {
                    switchAnnouncementTab('announcements');
                }
                originalShowAnnouncementList();
            };

        // ===================== 举报功能 =====================
        var _reportType = 'post';
        var _reportView = 'form';
        var _reportSelectedId = null;
        var _reportSelectedReason = null;
        var _reportTargetUser = null;
        var _reportContentData = [];

        function getReportViewNodes() {
            return {
                formPanel: document.getElementById('reportModalFormBody')
            };
        }

        function resetReportModalScroll() {
            var scroller = document.querySelector('#reportModal .report-modal-content');
            if (scroller) scroller.scrollTop = 0;
        }

            function normalizeReportModalStructure() {
                var overlay = document.getElementById('reportModal');
                if (!overlay || overlay.dataset.normalized === '1') return;
            var headerLeft = overlay.querySelector('.report-modal-header-left');
            if (headerLeft) {
                headerLeft.innerHTML = '<span>举报</span><button class="report-records-btn" id="reportRecordsToggleBtn" onclick="toggleReportRecords()" aria-label="打开举报记录">举报记录</button>';
            }
            var closeBtn = overlay.querySelector('.report-modal-close');
            if (closeBtn) {
                closeBtn.setAttribute('aria-label', '关闭');
                closeBtn.textContent = '✕';
            }
            var recordsPanel = document.getElementById('reportRecordsPanel');
            if (recordsPanel && recordsPanel.parentNode) {
                recordsPanel.parentNode.removeChild(recordsPanel);
            }
            var labels = overlay.querySelectorAll('.report-field > label');
            if (labels[0]) labels[0].textContent = '选择举报类型';
            if (labels[1]) labels[1].textContent = '选择要举报的内容';
            if (labels[2]) labels[2].textContent = '举报原因';
            var typeButtons = overlay.querySelectorAll('.report-type-tab');
            if (typeButtons[0]) typeButtons[0].textContent = '帖子';
            if (typeButtons[1]) typeButtons[1].textContent = '照片墙';
            var reasonMap = ['垃圾广告', '色情低俗', '人身攻击', '虚假信息', '侵权内容', '违规内容'];
            overlay.querySelectorAll('.report-reason-btn').forEach(function(btn, index) {
                var label = reasonMap[index];
                if (!label) return;
                btn.dataset.reason = label;
                btn.textContent = label;
            });
            var customReason = document.getElementById('reportCustomReason');
            if (customReason) customReason.setAttribute('placeholder', '补充说明（选填）');
            var submitBtn = document.getElementById('reportSubmitBtn');
            if (submitBtn) submitBtn.textContent = '提交举报';
            var loadingNode = document.querySelector('#reportContentList .report-loading');
            if (loadingNode) loadingNode.textContent = '加载中...';
            overlay.dataset.normalized = '1';
        }

        function getReportSelectedItem() {
            return (_reportContentData || []).find(function(item) {
                return String(item.id) === String(_reportSelectedId);
            }) || null;
        }

        function formatReportTime(value) {
            if (!value) return '';
            try {
                return window.safeParseDate(value).toLocaleString();
            } catch(_) {
                return '';
            }
        }

        function formatReportDate(value) {
            if (!value) return '';
            try {
                return window.safeParseDate(value).toLocaleDateString();
            } catch(_) {
                return '';
            }
        }

        function getReportTextThumbLabel(userName) {
            var name = String(userName || '匿名').trim();
            return escapeHtml(name.length > 4 ? name.slice(0, 4) : name);
        }

        function buildReportSelectedPreview(item) {
            if (!item) {
                return '<div class="report-selected-empty">还没有选择举报对象，请先从上方列表中选择一条内容。</div>';
            }
            var itemType = item.type === 'photo' ? '照片墙' : '帖子';
            var userName = escapeHtml(item.user_name || _reportTargetUser || '未知');
            var text = escapeHtml(item.text || (item.thumb ? '已选择图片内容' : '已选择内容'));
            var isTextOnly = !item.thumb && item.type !== 'photo';
            if (isTextOnly) {
                return [
                    '<div class="report-selected-top report-selected-top--text">',
                    '<span class="report-selected-name-badge">' + getReportTextThumbLabel(item.user_name) + '</span>',
                    item.created_at ? '<span class="report-selected-time">' + escapeHtml(formatReportDate(item.created_at)) + '</span>' : '',
                    '</div>',
                    '<div class="report-selected-text">' + text + '</div>'
                ].join('');
            }
            return [
                '<div class="report-selected-top">',
                '<span class="report-selected-chip">' + escapeHtml(itemType) + '</span>',
                '<span class="report-selected-user">发布者：' + userName + '</span>',
                '</div>',
                '<div class="report-selected-text">' + text + '</div>'
            ].join('');
        }

        function updateReportSelectedPreview() {
            var info = document.getElementById('reportSelectedInfo');
            if (!info) return;
            var preview = info.querySelector('.report-selected-preview');
            if (!preview) return;
            preview.innerHTML = buildReportSelectedPreview(getReportSelectedItem());
        }

        window.switchReportView = async function(view) {
            if (view === 'records') {
                _reportView = 'records';
                await window.toggleReportRecords();
                return;
            }
            _reportView = 'form';
            var nodes = getReportViewNodes();
            if (nodes.formPanel) {
                nodes.formPanel.classList.add('active');
                nodes.formPanel.setAttribute('aria-hidden', 'false');
            }
            resetReportModalScroll();
        };

        window.openReportModal = function() {
            if (!currentUser) { showToast('请先登录'); return; }
            if (typeof clearReportReplyBadge === 'function') clearReportReplyBadge();
            var overlay = document.getElementById('reportModal');
            if (!overlay) return;
            normalizeReportModalStructure();
            if (!window.__xtjReportModalPrimedV1) {
                ensureReportHistoryModal();
                window.__xtjReportModalPrimedV1 = true;
            }
            _reportType = 'post';
            _reportView = 'form';
            _reportSelectedId = window.__xtjReportTargetPostId || null;
            window.__xtjReportTargetPostId = null;
            _reportSelectedReason = null;
            _reportTargetUser = null;
            _reportContentData = [];
            document.querySelectorAll('.report-type-tab').forEach(function(t) {
                t.classList.toggle('active', t.dataset.type === 'post');
            });
            document.querySelectorAll('.report-reason-btn').forEach(function(b) { b.classList.remove('selected'); });
            document.getElementById('reportCustomReason').value = '';
            document.getElementById('reportSubmitBtn').disabled = true;
            document.getElementById('reportError').style.display = 'none';
            document.getElementById('reportError').textContent = '';
            updateReportSelectedPreview();
            overlay.classList.add('active');
            window.closeReportHistoryModal();
            syncReportModalBodyLock();
            resetReportModalScroll();
            var formBody = document.getElementById('reportModalFormBody');
            if (formBody) {
                formBody.classList.add('active');
                formBody.setAttribute('aria-hidden', 'false');
            }
            loadReportContentList();
            var dialog = document.getElementById('reportModalDialog');
            if (dialog && typeof dialog.focus === 'function') {
                setTimeout(function() {
                    try { dialog.focus(); } catch(_) {}
                }, 0);
            }
        };

        window.closeReportModal = function() {
            var overlay = document.getElementById('reportModal');
            if (!overlay) return;
            overlay.classList.remove('active');
            window.closeReportHistoryModal();
            syncReportModalBodyLock();
        };

        window.switchReportType = function(type) {
            _reportType = type;
            _reportSelectedId = null;
            _reportTargetUser = null;
            document.querySelectorAll('.report-type-tab').forEach(function(t) {
                t.classList.toggle('active', t.dataset.type === type);
            });
            document.getElementById('reportSubmitBtn').disabled = true;
            updateReportSelectedPreview();
            loadReportContentList();
        };

        function resolveReportPhotoWallItem(post) {
            if (!post) return null;
            var parsed = {};
            try { parsed = post.content ? JSON.parse(post.content) : {}; } catch(_) {}
            if (post.media_url === '__deleted__' || parsed.__pw_del__ === true) {
                return null;
            }
            var normalized = null;
            if (typeof window.normalizePhotoWallRow === 'function') {
                try { normalized = window.normalizePhotoWallRow(post); } catch(_) {}
            }
            var thumb = '';
            if (normalized) {
                thumb = normalized.thumbUrl || normalized.thumb || normalized.imageUrl || '';
            }
            if (!thumb) {
                thumb = parsed.thumb || parsed.thumbUrl || parsed.url || parsed.image_url || post.media_url || '';
            }
            if (!thumb || thumb === '__deleted__') {
                return null;
            }
            var text = parsed.caption || parsed.title || parsed.content || '';
            if (text.length > 72) text = text.substring(0, 72) + '...';
            return {
                id: post.id,
                user_name: post.user_name,
                text: text || (normalized && normalized.mediaKind === 'video' ? '(视频)' : '(照片)'),
                thumb: thumb,
                type: 'photo',
                created_at: post.created_at,
                kindLabel: normalized && normalized.mediaKind === 'video' ? '照片墙视频' : '照片墙'
            };
        }

        var _reportLoadId = 0;
        function loadReportContentList() {
            var reqId = ++_reportLoadId;
            var container = document.getElementById('reportContentList');
            if (!container) return;
            container.innerHTML = '<div class="report-loading">加载中...</div>';

            if (_reportType === 'post') {
                try {
                    applyVisiblePostQueryFilters(
                        sb.from('posts').select('id, user_name, content, media_url, media_type, created_at')
                    )
                        .order('created_at', { ascending: false })
                        .limit(200)
                        .then(function(res) {
                            if (reqId !== _reportLoadId) return;
                            _reportContentData = (res.data || []).map(function(p) {
                                var txt = p.content || '';
                                try {
                                    var j = JSON.parse(txt);
                                    txt = j.content || j.title || j.caption || j.text || (typeof j === 'object' ? '' : txt) || '';
                                } catch(e) {}
                                var mediaType = String(p.media_type || '').toLowerCase();
                                var hasRenderableThumb = !!p.media_url && /^(https?:|data:|blob:)/i.test(String(p.media_url || ''));
                                if (!txt && hasRenderableThumb) txt = mediaType === 'video' ? '(视频)' : '(图片)';
                                if (txt.length > 72) txt = txt.substring(0, 72) + '...';
                                return {
                                    id: p.id,
                                    user_name: p.user_name,
                                    text: txt,
                                    thumb: hasRenderableThumb ? p.media_url : '',
                                    type: 'post',
                                    created_at: p.created_at,
                                    kindLabel: hasRenderableThumb ? (mediaType === 'video' ? '视频帖' : '图片帖') : '文字帖'
                                };
                            }).filter(function(item) { return item.text || item.thumb; });
                            renderReportContentList(container);
                        }).catch(function() {
                            container.innerHTML = '<div class="report-loading">加载失败，请重试</div>';
                        });
                } catch(e) {
                    container.innerHTML = '<div class="report-loading">加载失败，请重试</div>';
                }
            } else {
                try {
                    window.apiAuthFetch(API_BASE + '/api/photos/public?limit=200', {credentials:'include'})
                        .then(function(resp) { return resp.json(); })
                        .then(function(result) {
                            if (reqId !== _reportLoadId) return;
                            _reportContentData = (result.data || []).map(resolveReportPhotoWallItem).filter(Boolean);
                            renderReportContentList(container);
                        }).catch(function() {
                            container.innerHTML = '<div class="report-loading">加载失败，请重试</div>';
                        });
                } catch(e) {
                    container.innerHTML = '<div class="report-loading">加载失败，请重试</div>';
                }
            }
        }

        function renderReportContentList(container) {
            if (!_reportContentData.length) {
                container.innerHTML = '<div class="report-loading">暂无内容</div>';
                return;
            }
            var h = '';
            _reportContentData.forEach(function(item) {
                var selected = _reportSelectedId === String(item.id) ? ' selected' : '';
                if (selected && !_reportTargetUser) _reportTargetUser = item.user_name;
                var isTextOnly = !item.thumb && item.type !== 'photo';
                // ★ 2026-09-26（审计 P1-7）：item.thumb 的照片墙分支来自用户可控的
                //   JSON.parse(post.content)，此前仅 escapeHtml（不过协议白名单）。
                //   统一改走 sanitizeUrl，非法协议（javascript:/data:text/html 等）直接不渲染图片。
                var safeThumb = (typeof sanitizeUrl === 'function') ? sanitizeUrl(item.thumb) : '';
                var thumbHtml = safeThumb
                    ? '<img class="rc-thumb" src="' + escapeHtml(safeThumb) + '" alt="" loading="lazy" onerror="this.outerHTML=\'<div class=&quot;rc-thumb rc-thumb--text&quot; aria-hidden=&quot;true&quot;><span>' + safeJsStr((item.user_name || '?').slice(0,1).toUpperCase()) + '</span></div>\'">'
                    : '<div class="rc-thumb rc-thumb--text" aria-hidden="true"><span>' + getReportTextThumbLabel(item.user_name) + '</span></div>';
                h += '<div class="report-content-item' + selected + (isTextOnly ? ' report-content-item--text' : '') + '" data-id="' + escapeHtml(item.id) + '" data-user="' + escapeHtml(item.user_name) + '" onclick="selectReportContent(this)">';
                h += thumbHtml;
                h += '<div class="rc-info' + (isTextOnly ? ' rc-info--text' : '') + '">';
                if (isTextOnly) {
                    h += '<div class="rc-meta rc-meta--text">' + (item.created_at ? '<span class="rc-time">' + escapeHtml(formatReportDate(item.created_at)) + '</span>' : '') + '</div>';
                } else {
                    h += '<div class="rc-meta"><div class="rc-user">' + escapeHtml(item.user_name) + '</div><span class="rc-type">' + escapeHtml(item.kindLabel || (item.type === 'photo' ? '照片墙' : '帖子')) + '</span>' + (item.created_at ? '<span class="rc-time">' + escapeHtml(formatReportDate(item.created_at)) + '</span>' : '') + '</div>';
                }
                h += '<div class="rc-text">' + escapeHtml(item.text || (item.thumb ? '图片内容' : '无文字内容')) + '</div>';
                h += '</div></div>';
            });
            container.innerHTML = h;
            updateReportSelectedPreview();
        }

        window.selectReportContent = function(el) {
            var id = el.dataset.id;
            _reportSelectedId = id;
            _reportTargetUser = el.dataset.user;
            document.querySelectorAll('#reportContentList .report-content-item').forEach(function(item) {
                item.classList.toggle('selected', item.dataset.id === id);
            });
            updateReportSubmitState();
            updateReportSelectedPreview();
        };

        window.selectReportReason = function(btn) {
            var reason = btn.dataset.reason;
            if (_reportSelectedReason === reason) {
                _reportSelectedReason = null;
                btn.classList.remove('selected');
            } else {
                document.querySelectorAll('.report-reason-btn').forEach(function(b) { b.classList.remove('selected'); });
                _reportSelectedReason = reason;
                btn.classList.add('selected');
            }
            updateReportSubmitState();
        };

        function updateReportSubmitState() {
            var btn = document.getElementById('reportSubmitBtn');
            if (!btn) return;
            btn.disabled = !(_reportSelectedId && _reportSelectedReason);
        }

        window.submitReport = async function() {
            if (!_reportSelectedId || !_reportSelectedReason) {
                document.getElementById('reportError').style.display = 'block';
                document.getElementById('reportError').textContent = '请选择举报内容和举报原因';
                return;
            }
            var btn = document.getElementById('reportSubmitBtn');
            var errEl = document.getElementById('reportError');
            btn.disabled = true;
            btn.textContent = '提交中...';
            errEl.style.display = 'none';

            var customReason = document.getElementById('reportCustomReason').value.trim();
            var finalReason = customReason ? _reportSelectedReason + '：' + customReason : _reportSelectedReason;

            try {
                if (typeof API_BASE !== 'undefined' && API_BASE) {
                    var reportHeaders = { 'Content-Type': 'application/json' };
                    var reportToken = getUserToken();
                    if (reportToken) reportHeaders['Authorization'] = 'Bearer ' + reportToken;
                    var res = await fetch(API_BASE + '/api/report', {
                        method: 'POST',
                        headers: reportHeaders,
                        body: JSON.stringify({
                            reporter_name: currentUser,
                            target_type: _reportType,
                            target_id: _reportSelectedId,
                            target_user: _reportTargetUser,
                            report_category: _reportSelectedReason,
                            report_reason: finalReason
                        })
                    });
                    var data = await res.json();
                    if (!res.ok) throw new Error(data.error || '提交失败');
                } else {
                    if (!window.sb) throw new Error('数据库连接未初始化，请刷新页面重试');
                    if (!currentUser) throw new Error('请先登录');
                    var reportContent = JSON.stringify({
                        target_type: _reportType,
                        target_id: _reportSelectedId,
                        target_user: _reportTargetUser,
                        report_category: _reportSelectedReason,
                        report_reason: finalReason,
                        status: 'pending'
                    });
                    var result = await window.sb.from('posts').insert([{
                        user_name: currentUser,
                        content: reportContent,
                        media_type: REPORT_MARKER,
                        actor_key: REPORT_MARKER
                    }]);
                    if (result.error) throw new Error(result.error.message);
                }
                window.showToast('举报已提交，管理员会尽快处理', 'success');
                closeReportModal();
            } catch(e) {
                console.error('[XTJ] submitReport error:', e);
                errEl.style.display = 'block';
                errEl.textContent = '提交失败：' + e.message;
                try { window.showToast('提交失败：' + e.message, 'error'); } catch(_) {}
            } finally {
                btn.disabled = false;
                btn.textContent = '提交举报';
            }
        };

        var reportOverlay = document.getElementById('reportModal');
        if (reportOverlay) {
            reportOverlay.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') closeReportModal();
            });
        }

        (function installUiTextRepair() {
            // This repair system is superseded by features.js which handles mojibake more accurately.
            // Only expose stop/repair hooks for backward compatibility.
            window.__xtjUiTextRepair = function(node) { return node; };
            window.__xtjUiTextRepairStop = function() {};
            return;
        })();

        // === Self-diagnostic: verify key functions are available after page load ===
        (function() {
            function check() {
                var funcs = ['togglePostPin', 'safeJsStr', 'escapeHtml'];
                var missing = [];
                funcs.forEach(function(f) {
                    if (typeof window[f] !== 'function') missing.push(f);
                });
                if (missing.length) {
                    console.error('[XTJ] Missing functions:', missing.join(', '));
                } else {
                    // console.log('[XTJ] All key functions loaded OK');
                }
            }
            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                check();
            } else {
                document.addEventListener('DOMContentLoaded', check);
            }
        })();

        (function installMagicLoaderV4() {
            if (window.__xtjMagicLoaderV4Installed) return;
            window.__xtjMagicLoaderV4Installed = true;

            var skeletonCardHtml = function(isChat) {
                if (isChat) {
                    return [
                        '<div class="xtj-loading-skeleton xtj-loading-skeleton--chat">',
                        '  <div class="xtj-skeleton-card"><div class="xtj-skeleton-body"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div>',
                        '  <div class="xtj-skeleton-card"><div class="xtj-skeleton-body"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div>',
                        '  <div class="xtj-skeleton-card"><div class="xtj-skeleton-body"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div>',
                        '  <div class="xtj-skeleton-card"><div class="xtj-skeleton-body"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div>',
                        '  <div class="xtj-skeleton-card"><div class="xtj-skeleton-body"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div>',
                        '</div>'
                    ].join('');
                }
                return [
                    '<div class="xtj-loading-skeleton">',
                    '  <div class="xtj-skeleton-card">',
                    '    <div class="xtj-skeleton-header"><div class="xtj-skeleton-avatar"></div><div class="xtj-skeleton-lines"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div>',
                    '    <div class="xtj-skeleton-body"><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line short"></div></div>',
                    '  </div>',
                    '  <div class="xtj-skeleton-card">',
                    '    <div class="xtj-skeleton-header"><div class="xtj-skeleton-avatar"></div><div class="xtj-skeleton-lines"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div>',
                    '    <div class="xtj-skeleton-body"><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line short"></div></div>',
                    '  </div>',
                    '  <div class="xtj-skeleton-card">',
                    '    <div class="xtj-skeleton-header"><div class="xtj-skeleton-avatar"></div><div class="xtj-skeleton-lines"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div>',
                    '    <div class="xtj-skeleton-body"><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line short"></div></div>',
                    '  </div>',
                    '</div>'
                ].join('');
            };
            window.__xtjSkeletonCardHtml = skeletonCardHtml;

            window.xtjMagicLoadingHtml = function(title, subtitle, variant) {
                var mode = String(variant || '');
                if (mode === 'chat-list' || mode === 'chat-detail') {
                    return skeletonCardHtml(true);
                }
                return skeletonCardHtml(false);
            };
            window.xtjInitSpringUltLoaders = function(root) {
                // No-op: spring loader removed
            };

            // Disabled on purpose: this global loader patch was replacing live content areas
            // after render, which could cause feed/chat content loss and persistent jank.
            if (false && typeof loadFeed === 'function' && !loadFeed.__xtjMagicLoaderV4) {
                var orig = loadFeed;
                loadFeed = window.loadFeed = function(forceRefresh) {
                    var r = orig.apply(this, arguments);
                    var feed = document.getElementById('feed');
                    if (feed && /loading-spinner|loading-text|内容加载中/.test(feed.innerHTML || '')) {
                        feed.innerHTML = magicHtml();
                        if (window.initAllSpringLoaders) {
                            window.initAllSpringLoaders(feed);
                        }
                    }
                    return r;
                };
                loadFeed.__xtjMagicLoaderV4 = true;
            }

            // ★ 2026-09-25 清理（审计 L-3）：此处原有一段 `if (false && ...)` 包裹的
            //   openChat 覆盖实现（永久不可达），已删除以免误导后续维护。


        })();

        (function installCleanStatUiOverrides() {
            if (window.__xtjStatUiOverridesV1) return;
            window.__xtjStatUiOverridesV1 = true;

            function buildPostDetailMediaAttrs(post) {
                var normalizedPost = normalizePost(post);
                return [
                    'data-post-id="' + escapeHtml(String(post.id || "")) + '"',
                    'data-media-url="' + escapeHtml(String(post.media_url || "")) + '"',
                    'data-post-user="' + escapeHtml(String(post.user_name || "")) + '"',
                    'data-post-created-at="' + escapeHtml(String(post.created_at || "")) + '"',
                    'data-post-views="' + escapeHtml(String(post.views || 0)) + '"',
                    'data-file-size="' + escapeHtml(String((normalizedPost._contentMeta && normalizedPost._contentMeta.fileSize) || "")) + '"',
                    'data-original-size="' + escapeHtml(String((normalizedPost._contentMeta && normalizedPost._contentMeta.originalSize) || "")) + '"'
                ].join(" ");
            }

            function statPostDetailMarkup(post, likes, comments) {
                var normalizedPost = normalizePost(post);
                var vc = Math.max(Number(normalizedPost.views) || 0, (post && post.views) || 0);
                var likeCount = Number.isFinite(Number(normalizedPost.like_count)) ? Number(normalizedPost.like_count) : (likes || []).length;
                var commentCount = Number.isFinite(Number(normalizedPost.comment_count)) ? Number(normalizedPost.comment_count) : (comments || []).length;
                var mediaHtml = renderPostMediaGrid(normalizedPost, { detail: true });
                var visibilityLabel = normalizedPost.visibility === 'private' ? '私密' : '公开';
                var contentText = String(normalizedPost.content || '').trim();
                var detailActions = [buildPostActionHtml(normalizedPost, typeof normalizedPost.liked_by_me === 'boolean' ? normalizedPost.liked_by_me : (likes || []).some(function(l) { return l.user_name === currentUser; }), canDeletePost(normalizedPost))];
                return [
                    '<article class="post visible post-detail-shell post-detail-shell--clean" data-post-id="' + escapeHtml(String(normalizedPost.id)) + '" data-post-user="' + escapeHtml(normalizedPost.user_name || '') + '">',
                    '  <section class="post-detail-main-card">',
                    '    <header class="post-detail-top">',
                    '      <div class="post-detail-owner">',
                    getAvatarHtml(normalizedPost.user_name, normalizedPost),
                    '        <div class="post-detail-owner-copy">',
                    '          <div class="pdh-name">' + escapeHtml(normalizedPost.user_name || '未知用户') + '</div>',
                    '          <div class="pdh-time">' + window.safeParseDate(normalizedPost.created_at).toLocaleString() + '</div>',
                    '        </div>',
                    '      </div>',
                    '      <span class="post-detail-visibility">' + visibilityLabel + '</span>',
                    '    </header>',
                    contentText ? '<div class="post-detail-content">' + buildPostContentHtml(contentText) + '</div>' : '',
                    mediaHtml ? '<div class="post-detail-media-card"><div class="post-detail-media">' + mediaHtml + '</div></div>' : '',
                    // 2026-09-22：详情弹窗与 feed 卡片一致展示位置/IP 属地（此前详情不显示）
                    (typeof window.buildPostLocationHtml === 'function' ? window.buildPostLocationHtml(normalizedPost) : ''),
                    '    <div class="post-stats-text post-detail-stats">' + buildPostStatsLine(normalizedPost, likeCount, commentCount) + '</div>',
                    detailActions.length ? '<div class="actions post-detail-actions">' + detailActions.join("") + '</div>' : '',
                    '  </section>',
                    '  <section class="post-detail-panel post-detail-panel--stack">',
                    '    <div class="post-detail-panel-title">点赞用户 <span>' + likeCount + '</span></div>',
                    likes.length ? likes.map(function(l) {
                        return '<article class="post-detail-mini-row"><div class="post-detail-mini-main"><div class="post-detail-mini-name">' + escapeHtml(l.user_name) + '</div><div class="post-detail-mini-copy">留下了喜欢</div></div><span class="post-detail-mini-time">' + window.safeParseDate(l.created_at).toLocaleString() + '</span></article>';
                    }).join('') : '<div class="stat-empty post-detail-empty">暂无点赞</div>',
                    '  </section>',
                    '  <section class="post-detail-panel post-detail-panel--stack post-detail-comments-panel">',
                    '    <div class="post-detail-panel-title">评论记录 <span>' + commentCount + '</span></div>',
                    comments.length ? buildPostCommentsHtml(normalizedPost, comments, { detail: true }) : '<div class="stat-empty post-detail-empty">暂无评论</div>',
                    '  </section>',
                    '</article>'
                ].join('');
            }

            renderPostDetail = function(post, likes, comments) {
                var body = document.getElementById('postDetailBody');
                if (!body) return;
                window.__xtjPostDetailSnapshot = normalizePost(post);
                window.__xtjPostDetailLikes = likes || [];
                (likes || []).forEach(function(like) {
                    var row = Object.assign({}, like, { post_id: post.id });
                    if (!(feedAllLikes || []).some(function(l) { return String(l.id) === String(row.id); })) feedAllLikes.push(row);
                });
                if (post.liked_by_me && !(feedAllLikes || []).some(function(l) { return String(l.post_id) === String(post.id) && l.user_name === currentUser; })) feedAllLikes.push({ post_id: post.id, user_name: currentUser });
                window.__xtjPostDetailComments = comments || [];
                body.innerHTML = statPostDetailMarkup(post, likes || [], comments || []);
            };

            window.__xtjPatchPostDetailInteractions = function(postId) {
                var post = window.__xtjPostDetailSnapshot;
                if (!post || String(post.id) !== String(postId) || window.__xtjPostDetailCurrentId !== String(postId)) return;
                var body = document.getElementById('postDetailBody');
                if (!body) return;
                var comments = window.__xtjPostDetailComments || [], likes = window.__xtjPostDetailLikes || [];
                var panel = body.querySelector('.post-detail-comments-panel');
                if (panel) panel.innerHTML = '<div class="post-detail-panel-title">评论记录 <span>' + comments.length + '</span></div>' +
                    (comments.length ? buildPostCommentsHtml(post, comments, { detail: true }) : '<div class="stat-empty post-detail-empty">暂无评论</div>');
                var stats = body.querySelector('.post-detail-stats');
                if (stats) stats.innerHTML = buildPostStatsLine(post, Number.isFinite(Number(post.like_count)) ? Number(post.like_count) : likes.length, comments.length);
            };
            window.__xtjMergePostDetailComments = function(postId, incoming) {
                var post = window.__xtjPostDetailSnapshot;
                if (!post || String(post.id) !== String(postId)) return;
                var list = window.__xtjPostDetailComments || [], map = new Map(list.map(function(c) { return [String(c.id), c]; })), changed = false;
                (incoming || []).forEach(function(row) {
                    if (String(row.post_id) !== String(postId)) return;
                    var old = map.get(String(row.id));
                    if (!old || old.content !== row.content || old.parent_comment_id !== row.parent_comment_id || old.generated_by_ai !== row.generated_by_ai) { map.set(String(row.id), row); changed = true; }
                });
                if (!changed) return;
                window.__xtjPostDetailComments = Array.from(map.values()).sort(function(a,b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)); });
                window.__xtjPatchPostDetailInteractions(postId);
            };
            window.__xtjApplyPostDetailComment = function(eventType, row) {
                var post = window.__xtjPostDetailSnapshot;
                if (!post || !row || row.id == null || (row.post_id != null && String(row.post_id) !== String(post.id))) return;
                var list = window.__xtjPostDetailComments || [];
                if (eventType !== 'DELETE' && row.post_id == null) return;
                if (eventType === 'DELETE') list = list.filter(function(c) { return String(c.id) !== String(row.id); });
                else {
                    var index = list.findIndex(function(c) { return String(c.id) === String(row.id); });
                    if (index < 0) list.push(row); else list[index] = row;
                    list.sort(function(a,b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)); });
                }
                window.__xtjPostDetailComments = list;
                window.__xtjPatchPostDetailInteractions(post.id);
            };

            function statGetPostMap() {
                var postMap = {};
                (Array.isArray(statAllPosts) ? statAllPosts : []).forEach(function(post) {
                    if (post && post.id != null) postMap[String(post.id)] = normalizePost(post);
                });
                (Array.isArray(feedAllPosts) ? feedAllPosts : []).forEach(function(post) {
                    if (post && post.id != null && !postMap[String(post.id)]) {
                        postMap[String(post.id)] = normalizePost(post);
                    }
                });
                return postMap;
            }

            function statGetPost(postId) {
                return statGetPostMap()[String(postId)] || null;
            }

            window.closeStatRecordsModal = function() {
                var modal = document.getElementById('statRecordsModal');
                if (modal) modal.classList.remove('active');
            };

            window.openStatPostDetail = function(postId) {
                if (!postId) return;
                window.closeStatRecordsModal();
                window.openPostDetail(postId);
            };

            window.openStatPostMedia = function(postId) {
                if (!postId) return;
                window.closeStatRecordsModal();
                var post = statGetPost(postId);
                if (!post) {
                    window.openPostDetail(postId);
                    return;
                }
                if (post.media_type === 'image' && post.media_url && typeof window.openPhotoPreview === 'function') {
                    var statPreviewPhoto = {
                        id: 'post_' + String(post.id || ''),
                        imageUrl: sanitizeUrl(post.media_url),
                        thumbUrl: sanitizeUrl(post.media_url),
                        username: String(post.user_name || ''),
                        timestamp: String(post.created_at || ''),
                        views: Number(post.views || 0) || 0,
                        fileSize: ((normalizePost(post)._contentMeta || {}).fileSize) || null,
                        originalSize: ((normalizePost(post)._contentMeta || {}).originalSize) || null,
                        __xtjSource: 'post',
                        __xtjPostId: String(post.id || ''),
                        __xtjActorKey: String(post.actor_key || ''),
                        __xtjCanDelete: !!canDeletePost(post)
                    };
                    window.__xtjPhotoPreviewContext = {
                        kind: 'post',
                        postId: statPreviewPhoto.__xtjPostId,
                        actorKey: statPreviewPhoto.__xtjActorKey,
                        canDelete: statPreviewPhoto.__xtjCanDelete
                    };
                    window.openPhotoPreview(0, [statPreviewPhoto]);
                    setTimeout(function() {
                        syncPostPhotoPreviewChrome(statPreviewPhoto);
                    }, 30);
                    return;
                }
                window.openPostDetail(post.id);
                if (post.media_type === 'video') {
                    setTimeout(function() {
                        try {
                            var video = document.querySelector('#postDetailBody .post-detail-media video');
                            if (video && typeof video.play === 'function') video.play().catch(function() {});
                        } catch (_) {}
                    }, 220);
                }
            };


            // S7 修复：帖子详情请求代次号，防止快速切换详情时旧响应覆盖新内容
            var _postDetailReqSeq = 0;
            window.__xtjCancelPostDetail = function() {
                _postDetailReqSeq++;
                window.__xtjPostDetailCurrentId = '';
                window.__xtjPostDetailSnapshot = null;
                window.__xtjPostDetailLikes = [];
                window.__xtjPostDetailComments = [];
                var modal = document.getElementById('postDetailModal');
                var body = document.getElementById('postDetailBody');
                if (modal) modal.classList.remove('active');
                if (body) body.textContent = '';
            };

            window.openPostDetail = async function(postId) {
                var _seq = ++_postDetailReqSeq;
                var owner = currentUser;
                var epoch = _authStateEpoch;
                window.__xtjPostDetailCurrentId = String(postId || '');
                var title = document.getElementById('postDetailTitle');
                var body = document.getElementById('postDetailBody');
                var modal = document.getElementById('postDetailModal');
                if (title) title.textContent = '帖子详情';
                if (body) body.innerHTML = getXtjLoadingHtml('加载中..', '加载中..', 'feed');
                if (modal) {
                    modal.removeAttribute('inert');
                    modal.setAttribute('aria-hidden', 'false');
                    // Reuse the modal lifecycle: direct class changes bypassed
                    // cancellation of a pending close and animation restoration.
                    window.openModal('postDetailModal');
                }
                if (body) { body.setAttribute('aria-busy', 'true'); body.scrollTop = 0; }
                function isCurrentDetail() {
                    return _seq === _postDetailReqSeq && owner === currentUser && epoch === _authStateEpoch &&
                        window.__xtjPostDetailCurrentId === String(postId || '') &&
                        !!modal && modal.classList.contains('active');
                }

                try {
                    var detailPath = '/api/post/detail/' + encodeURIComponent(postId);
                    var apiUrl = (window.API_BASE || '') + detailPath;
                    var apiRes;
                    if (typeof window.xtjOptionalAuthFetch === 'function') {
                        apiRes = await window.xtjOptionalAuthFetch(detailPath, { timeoutMs: 18000, authOwner: owner, authEpoch: epoch });
                    } else {
                        var detailHeaders = { 'Accept': 'application/json' };
                        var detailToken = '';
                        try { detailToken = typeof getUserToken === 'function' ? String(getUserToken() || '') : ''; } catch (_) {}
                        if (detailToken) detailHeaders.Authorization = 'Bearer ' + detailToken;
                        apiRes = await window.xtjFetch(apiUrl, { credentials: 'include', headers: detailHeaders }, 18000);
                    }
                    if (!apiRes.ok && (!apiRes.headers.get('content-type') || !apiRes.headers.get('content-type').includes('application/json'))) {
                        if (isCurrentDetail() && body) body.innerHTML = '<div class="stat-empty">无法获取帖子详情（' + apiRes.status + '）。</div>';
                        return;
                    }
                    var apiData;
                    try {
                        apiData = await apiRes.json();
                    } catch(e) {
                        if (isCurrentDetail() && body) body.innerHTML = '<div class="stat-empty">解析帖子详情失败，请稍后重试。</div>';
                        return;
                    }
                    if (!apiRes.ok || !apiData || !apiData.ok) {
                        var errMsg = (apiData && apiData.message) || '该帖子不存在、已删除或不可查看。';
                        // 错误消息来自服务端，先转义再拼 HTML，防 XSS 注入
                        if (isCurrentDetail() && body) body.innerHTML = '<div class="stat-empty">' + escapeHtml(errMsg) + '</div>';
                        return;
                    }
                    // S7 修复：响应落地前校验是否已被新请求替代
                    if (!isCurrentDetail()) return;
                    var post = apiData.post;
                    if (!post || typeof post !== 'object') {
                        if (body) body.innerHTML = '<div class="stat-empty">该帖子不存在、已删除或不可查看。</div>';
                        return;
                    }
                    var likes = apiData.likes || [];
                    var comments = apiData.comments || [];
                    // normalize to match renderPostDetail expectations；避免真实 views 被清零
                    post.views = (post.view_count != null ? post.view_count : (post.views != null ? post.views : 0));
                    if (!post.user_name || !post.created_at) {
                        if (body) body.innerHTML = '<div class="stat-empty">该帖子不存在、已删除或不可查看。</div>';
                        return;
                    }
                    trackView(postId);
                    renderPostDetail(post, likes, comments);
                } catch (e) {
                    if (isCurrentDetail() && body) body.innerHTML = '<div class="stat-empty">加载失败，请重试</div>';
                    console.error(e);
                } finally {
                    if (isCurrentDetail() && body) {
                        body.setAttribute('aria-busy', 'false');
                        if (!body.querySelector('.post-detail-shell')) {
                            var retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn btn-ghost'; retry.textContent = '重新加载';
                            retry.addEventListener('click', function() { window.openPostDetail(postId); });
                            body.appendChild(retry);
                        }
                    }
                }
            };

        })();
