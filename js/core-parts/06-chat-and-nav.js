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
                            window.showToast('正在刷新...');
                            window.dockChatListCacheTime = 0;
                            loadDockChatList();
                            isRefreshing[tab] = false;
                            window.showToast('刷新完成');
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
                currentDockTab = tab;
                window.safeStorage.set('xtj_current_tab', tab);
                document.querySelectorAll('.dock-tab').forEach(t => t.classList.remove('active'));
                const panel = document.getElementById('panel' + tab.charAt(0).toUpperCase() + tab.slice(1));
                if (dockPanelTransitionTimer) clearTimeout(dockPanelTransitionTimer);
                if (dockPanelAnimation) {
                    try { dockPanelAnimation.cancel(); } catch (_) {}
                    dockPanelAnimation = null;
                }
                var reduceDockMotion = false;
                try { reduceDockMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) {}
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
                        var animatedSurface = panel.firstElementChild || panel;
                        if (animatedSurface && typeof animatedSurface.animate === 'function') {
                            dockPanelAnimation = animatedSurface.animate([
                                { opacity: 0, transform: 'translate3d(0, 8px, 0)' },
                                { opacity: 1, transform: 'translate3d(0, 0, 0)' }
                            ], { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' });
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
                return width >= 768 && height >= 480;
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
                try {
                    var messages = document.getElementById('dockChatMessages');
                    if (messages) {
                        messages.innerHTML = '';
                        delete messages.dataset.chatUser;
                        delete messages.dataset.emptyRendered;
                    }
                    var list = document.getElementById('dockChatList');
                    if (list) list.innerHTML = '';
                    var title = document.getElementById('dockChatTitle');
                    if (title) title.textContent = '消息';
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
                var backBtn = document.getElementById('dockChatBackBtn');
                var titleEl = document.getElementById('dockChatTitle');
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
                el.innerHTML = getXtjLoadingHtml(title, subtitle, variant);
            }

            function dockChatGoBack() {
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
                // ★ 2026-09-25 修复：返回会话列表时 0 值即"缓存失效"，缓存时长被提到 20s 后
                //   这里会必然触发一次 /api/dm/list 往返（列表明明还在屏幕上）。改为标记为刚刷新。
                window.dockChatListCacheTime = Date.now();
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
                if (!window.currentUser) { showToast('请先登录'); return; }
                if (isUserMuted()) { showToast("您已被禁言，无法发送消息"); return; }
                if (userName === window.currentUser) { switchDockTab('chat', true); return; }
                if (currentDockTab === 'posts') {
                    const postsPanel = document.getElementById('panelPosts');
                    if (postsPanel) restorePostsScroll = postsPanel.scrollTop;
                }
                dockChatActiveUser = userName;
                // 清除渲染签名，确保缓存加载不会因签名匹配跳过（当前 innerHTML 是 loading 状态）
                if (typeof _chatRenderSignature !== 'undefined') _chatRenderSignature[userName] = undefined;
                // ★ 2026-09-25 修复（切换联系人闪一下）：这里不再无条件画 loading 骨架。
                //   骨架的绘制统一交给 loadDockChatMessages —— 它有缓存时会直接渲染内容，
                //   只有真正「无缓存的首屏」才显示骨架，避免骨架→内容两次重绘造成闪烁。
                document.getElementById('dockChatListView').classList.add('hidden');
                document.getElementById('dockChatDetailView').classList.remove('hidden');
                document.getElementById('dockChatBackBtn').style.display = 'flex';
                document.getElementById('dockChatTitle').textContent = userName;
                switchDockTab('chat', true, { source: 'openChat' });
                loadDockChatMessages(userName, true);
                startDMPolling(60000, true);
            };

            async function loadDockChatList() {
                const el = document.getElementById('dockChatList');
                if (!el) return;
                if (!window.currentUser) {
                    el.innerHTML = '<div class="chat-empty"><div style="color:var(--xtj-text-muted);font-size:13px;padding:20px 0;">登录后可查看消息</div></div>';
                    setUnreadBadgeCount(0);
                    renderDockChatFixedEntry(el);
                    syncDockChatLayoutState();
                    return;
                }
                if (!dockChatActiveUser) {
                    syncDockChatLayoutState();
                }
                if (Date.now() - (window.dockChatListCacheTime || 0) < DOCK_CHAT_CACHE_DURATION) return;
                var listLoadSeq = ++_dockChatListLoadSeq;
                var hadRenderedList = !!el.children.length;
                try {
                    if (!hadRenderedList) {
                        renderChatLoadingState(el, {
                            title: '加载中...',
                            subtitle: '正在取回最近消息',
                            variant: 'chat-list'
                        });
                    }
                    // 走共享单飞请求（与未读角标复用同一份结果），并显式传 limit=180 ——
                    //   与下面 mergeDockChatRowsById 的窗口一致，避免"拉了 1000 条只用 180 条"。
                    const dmResult = await window.fetchDmListShared(180);
                    if (!dmResult || !dmResult.ok) throw new Error((dmResult && dmResult.error) || 'DM list fetch failed');
                    if (listLoadSeq !== _dockChatListLoadSeq) return;
                    const allMsgs = mergeDockChatRowsById(dmResult.data || [], false, 180);
                    if (!allMsgs || !allMsgs.length) {
                        el.innerHTML = '<div class="chat-empty"><div style="color:var(--xtj-text-muted);font-size:13px;padding:20px 0;">暂无最近会话</div></div>';
                        setUnreadBadgeCount(0);
                        window.dockChatListCacheTime = Date.now();
                        renderDockChatFixedEntry(el);
                        syncDockChatLayoutState();
                        return;
                    }
                    const convMap = {};
                    // ★ 2026-09-25 优化（聊天秒开）：会话列表接口返回的其实是「该用户最近的
                    //   全部消息」，此前只取每个会话的最后一条做预览，其余全部丢弃 —— 于是用户
                    //   点开会话时必须等一次 /api/dm/messages 网络往返才能看到内容（"点开会话要
                    //   等一下才出现消息"）。
                    //   现改为：把每条消息按会话归组，预热进 _chatCache。点击会话时 loadDockChatMessages
                    //   会先命中缓存立即渲染（见其开头 _chatCache 分支），网络回包后再精确替换，
                    //   从而实现"点开秒见内容"。
                    const preheatMap = {};
                    allMsgs.forEach(m => {
                        const other = m.user_name === window.currentUser ? m.media_url : m.user_name;
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
                    // 按会话预热缓存：只在缓存为空或确实更旧时写入，避免把更完整的既有缓存降级覆盖
                    try {
                        Object.keys(preheatMap).forEach(function(other) {
                            var k = getDockChatCacheKey(other);
                            var rows = preheatMap[other].sort(function(a, b) {
                                return String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
                                       String(a.id || '').localeCompare(String(b.id || ''));
                            });
                            var existing = _chatCache[k];
                            // 已有缓存且条数不少于预热数据时跳过（网络回包的数据更权威）
                            if (Array.isArray(existing) && existing.length >= rows.length && existing.length > 0) return;
                            _chatCache[k] = rows;
                        });
                    } catch (ePreheat) { /* 预热失败不影响列表渲染 */ }
                    const convs = Object.values(convMap).sort((a, b) => new Date(b.last_time) - new Date(a.last_time));
                    // ★ 2026-09-25 修复（审计 M-7/H-2）：角标口径统一走 aggregateDmUnread，
                    //   与 updateUnreadBadge 完全同源，避免两处算法/上限不同导致数字跳动。
                    setUnreadBadgeCount(aggregateDmUnread(allMsgs).total);
                    if (typeof window.__xtjNoteDmUnreadFresh === 'function') window.__xtjNoteDmUnreadFresh();
                    renderDockChatConversationList(el, convs);
                    window.dockChatListCacheTime = Date.now();
                    renderDockChatFixedEntry(el);
                    syncDockChatLayoutState();
                    // 非阻塞加载头像: 先显示列表, 头像后台补上（包含固定入口 xxz）
                    var avatarUsers = convs.map(function(c) { return c.other_user; });
                    if (window.currentUser !== 'xxz') avatarUsers.push('xxz');
                    hydrateDockChatAvatars(avatarUsers, function(changed) {
                        if (changed) patchDockChatConversationAvatars(el);
                    });
                } catch(e) {
                    if (listLoadSeq !== _dockChatListLoadSeq) return;
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
                            loadDockChatList();
                        }, { once: true });
                        el.appendChild(retry);
                        window.dockChatListCacheTime = 0;
                    } else {
                        showToast('消息列表刷新失败，请稍后重试');
                    }
                    renderDockChatFixedEntry(el);
                    syncDockChatLayoutState();
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
            var _chatRenderSignature = {};
            var _dockChatLoadSeq = 0;
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
                    node.innerHTML = getDockChatAvatarMarkup(userName);
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
                    node.innerHTML = row.classList.contains('sent') ? mineAvatar : otherAvatar;
                });
            }

            function buildDockChatConversationSignature(conversation) {
                return [
                    conversation && conversation.other_user ? conversation.other_user : '',
                    conversation && conversation.last_message ? conversation.last_message : '',
                    conversation && conversation.last_time ? conversation.last_time : '',
                    conversation && conversation.unread ? conversation.unread : 0,
                    getAvatarUrl(conversation && conversation.other_user ? conversation.other_user : '') || ''
                ].join('~');
            }

            function getDockChatConversationAvatarHtml(userName) {
                return getDockChatAvatarMarkup(userName);
            }

            function buildDockChatListItemMarkup(conversation, index) {
                var safeUser = safeJsStr(conversation.other_user);
                var signature = buildDockChatConversationSignature(conversation);
                return [
                    '<div class="chat-list-item" data-chat-user="', escapeHtml(conversation.other_user), '" data-signature="', escapeHtml(signature),
                    '" data-last-time="', escapeHtml(conversation.last_time || ''), '" style="--xtj-enter-delay:', String(Math.min((index || 0) * 12, 48)),
                    'ms" onclick="openChat(\'', safeUser, '\')">',
                    '<div class="cli-avatar">', getDockChatConversationAvatarHtml(conversation.other_user), '</div>',
                    '<div class="cli-info"><div class="cli-name"><span class="cli-name-text">', escapeHtml(conversation.other_user), '</span></div><div class="cli-preview">', escapeHtml(conversation.last_message || ''), '</div></div>',
                    '<div class="cli-right"><span class="cli-time">', formatMsgTime(conversation.last_time), '</span>', conversation.unread ? '<span class="cli-badge">' + (conversation.unread > 99 ? '99+' : conversation.unread) + '</span>' : '', '</div>',
                    '</div>'
                ].join('');
            }

            function renderDockChatConversationList(el, convs) {
                if (!el) return '';
                var nextListSignature = convs.map(buildDockChatConversationSignature).join('|');
                var hadRenderedList = !!el.children.length;
                if (_dockChatListRenderSignature === nextListSignature && hadRenderedList) {
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
                if (existingAdmin) {
                    if (el.firstChild !== existingAdmin) el.insertBefore(existingAdmin, el.firstChild);
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
                    unread: typeof unreadCount === 'number' ? unreadCount : 0
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
                        unread: badgeNode ? parseInt(badgeNode.textContent, 10) || 0 : 0
                    });
                });
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
                    (payload.media && payload.media.url) ? payload.media.url : ''
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


            function mergeDockChatMessages(userName, msgs) {
                // ★ 修复：发送成功会把乐观消息替换成服务端真实消息（不再带 __optimistic）。
                //   此前该函数只保留带 __optimistic 的缓存消息，若此刻刚好有「更早快照」的
                //   /api/dm/messages 请求在途并写回缓存，刚提交的新消息会从会话里消失。
                //   现改为：以服务端快照为底，把缓存中仍缺失的「乐观消息」以及「比快照更近
                //   （窗口期新提交）的非乐观消息」按 id 合并回去，避免发送成功即丢失。
                var cacheKey = getDockChatCacheKey(userName);
                var cached = Array.isArray(_chatCache[cacheKey]) ? _chatCache[cacheKey] : [];
                var snapshot = (msgs || []).slice();
                // 快照为空时以快照为准，避免整段恢复已删除/过期缓存
                if (!snapshot.length) return sortDockChatMessages(snapshot);
                var snapshotNewestAt = 0;
                var lastMsg = snapshot[snapshot.length - 1];
                if (lastMsg && lastMsg.created_at) {
                    var lastTs = Date.parse(lastMsg.created_at);
                    if (!isNaN(lastTs)) snapshotNewestAt = lastTs;
                }
                var merged = snapshot.slice();
                cached.forEach(function(msg) {
                    if (!msg || !msg.id) return;
                    var exists = merged.some(function(existing) {
                        return existing && existing.id && msg.id && existing.id === msg.id;
                    });
                    if (exists) return; // 快照已是服务端权威
                    if (msg.__optimistic) { merged.push(msg); return; }
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
                if (previewUrl.indexOf('blob:') === 0) {
                    try { URL.revokeObjectURL(previewUrl); } catch (e) {}
                }
            }

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
                requestAnimationFrame(function() {
                    scroll();
                    requestAnimationFrame(scroll);
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
                var payload = getDMMessagePayload(message);
                if (payload && payload.withdrawn) {
                    return '<span class="msg-text withdrawn">[此消息已被撤回]</span>';
                }
                var media = resolveDockChatMedia(message);
                var messageText = getDMMessageText(message);
                if (media && media.kind === 'image') {
                    // ★ 2026-09-25：直接用公共地址渲染，不再绕后端签名。
                    //   实测 uploads 桶的 /public/ 路由是放通的（真实对象 HTTP 200），
                    //   此前"渲染期先换签名地址"的多余往返已删除——它正是图片首帧
                    //   显示成坏图标/按钮、几百毫秒后才变图的根源。
                    var resolvedImageSrc = String(media.src || media.fullSrc || '');
                    var safeSrc = escapeHtml(resolvedImageSrc);
                    var safeFull = escapeHtml(resolvedImageSrc);
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
                    var imageBody = '<img class="msg-img" src="' + safeSrc + '" data-src="' + safeSrc + '" data-full-src="' + safeFull + '" data-post-user="' + escapeHtml(String(message.user_name || '')) + '" data-post-created-at="' + escapeHtml(String(message.created_at || '')) + '" alt="聊天图片" onclick="openImageViewer(this.getAttribute(\'data-full-src\') || this.src, this)" onerror="window.handleDockChatImageError(this)" loading="lazy" decoding="async" />';
                    if (messageText) imageBody += '<div class="msg-text">' + escapeHtml(messageText) + '</div>';
                    return imageBody;
                }
                if (media && media.kind === 'video') {
                    var videoBody = '<video class="msg-img" src="' + escapeHtml(media.src) + '" controls preload="metadata" onclick="event.stopPropagation()" style="cursor:default;"></video>';
                    if (messageText) videoBody += '<div class="msg-text">' + escapeHtml(messageText) + '</div>';
                    return videoBody;
                }
                // P6: render audio messages with <audio> player
                if (media && media.kind === 'audio') {
                    var audioBody = '<audio class="msg-audio" src="' + escapeHtml(media.src) + '" controls preload="metadata" onclick="event.stopPropagation()" style="max-width:240px;cursor:default;"></audio>';
                    if (messageText) audioBody += '<div class="msg-text">' + escapeHtml(messageText) + '</div>';
                    return audioBody;
                }
                return '<span class="msg-text">' + escapeHtml(messageText || '') + '</span>';
            }

                        function buildDockChatRowMarkup(message, avatars, disableAnim) {
                var sent = message.user_name === currentUser;
                var avatarHtml = sent ? avatars.mine : avatars.other;
                // ★ is-read 类给「已读」配上配色/微动画（ui-enhance.css 里有规则）。
                //   原先由 ux-features.js 那套重复的长按菜单在**绑定时刻**扫描一遍，
                //   但那时还没有任何消息，等于从未生效；现在直接在渲染时打上。
                var readStatus = sent
                    ? (isMsgReadByMe(message)
                        ? '<span class="msg-read-status is-read">已读</span>'
                        : '<span class="msg-read-status">未读</span>')
                    : '';
                
                var payload = getDMMessagePayload(message);
                var isWithdrawn = payload && payload.withdrawn;
                // 已撤回的消息不再解析媒体：actor_key 仍然保留，若照常解析会给"已撤回"
                //   这段文字套上媒体气泡的紧内边距，看着很怪。
                var rowMedia = isWithdrawn ? null : resolveDockChatMedia(message);
                
                // ★ 2026-09-25 改造：撤回不再常驻气泡（改由长按菜单触发，与微信/QQ 一致），
                //   气泡右下角只保留时间；失败态给出明确标记与重发入口，发送中给出上传提示。
                var bubbleClass = 'chat-msg ' + (sent ? 'sent' : 'received');
                // 纯媒体气泡用更紧的内边距，让图片贴着气泡边（否则彩色边框会显得很宽）
                if (rowMedia) bubbleClass += ' has-media';
                // 只有"图片/视频 + 无文字"时才把时间叠到图上去；带文字的气泡若也叠，
                //   绝对定位的元信息会盖住文字（所以这里由 JS 判定，不用 :has()）。
                if (rowMedia && !(getDMMessageText(message) || '').trim()) bubbleClass += ' media-only';
                if (message.__optimistic && sent) bubbleClass += ' sent-anim';
                else if (disableAnim) bubbleClass += ' no-anim';
                if (message.__optimistic) bubbleClass += ' pending';
                if (message.__failed) bubbleClass += ' failed';
                if (isWithdrawn) bubbleClass += ' is-withdrawn';
                
                var statusMark = '';
                if (message.__failed) {
                    statusMark = '<span class="msg-fail-mark" title="' + escapeHtml(String(message.__failReason || '发送失败')) + '">发送失败 · 长按重发</span>';
                } else if (message.__optimistic && rowMedia) {
                    statusMark = '<span class="msg-send-status" role="status">' + (rowMedia.kind === 'image' ? '图片上传中…' : (rowMedia.kind === 'video' ? '视频上传中…' : '音频上传中…')) + '</span>';
                }
                var tempAttr = message.__tempId ? ' data-temp-id="' + message.__tempId + '"' : '';
                var bubble = '<div class="' + bubbleClass + '"' + tempAttr + '>' + buildDockChatBodyMarkup(message) + '<span class="msg-meta">' + readStatus + '<span class="msg-time">' + formatMsgTime(message.created_at) + '</span></span>' + statusMark + '</div>';
                if (sent) return '<div class="chat-msg-row sent">' + bubble + '<div class="chat-msg-avatar">' + avatarHtml + '</div></div>';
                return '<div class="chat-msg-row received"><div class="chat-msg-avatar">' + avatarHtml + '</div>' + bubble + '</div>';
            }

            // ★ 2026-09-25：muteLoadingSkeleton=true 表示「轮询/后台刷新」，不允许动 loading 骨架
            //   与空状态，避免后台回包把用户正在看的界面顶掉重画。
            async function loadDockChatMessages(userName, forceScroll, muteLoadingSkeleton) {
                var el0 = document.getElementById('dockChatMessages');
                if (!window.currentUser) {
                    if (el0) el0.innerHTML = '<div class="chat-empty"><div class="ce-icon">🔒</div><div>登录后可查看消息</div></div>';
                    return;
                }
                var loadSeq = ++_dockChatLoadSeq;
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
                var hadCachedMessages = !!(_chatCache[cacheKey] && _chatCache[cacheKey].length);
                if (hadCachedMessages) {
                    // ★ 2026-09-25 修复（切换会话骨架闪烁）：缓存命中时必须在任何骨架/空状态
                    //   绘制之前就把内容渲染出来，否则 openChat 里那次 loading 骨架会先画上去
                    //   再被覆盖，用户就看到"闪一下"。
                    renderDockMessages(userName, _chatCache[cacheKey], !!forceScroll);
                }
                if (!hadCachedMessages && !muteLoadingSkeleton) {
                    // 无缓存且不是轮询/后台刷新 → 才允许显示骨架（首次打开会话）
                    renderChatLoadingState(el0, {
                        title: '加载中..',
                        subtitle: '正在打开聊天通道',
                        variant: 'chat-detail',
                        seq: loadSeq
                    });
                }
                hydrateDockChatAvatars([currentUser, userName], function(changed) {
                    if (loadSeq !== _dockChatLoadSeq || dockChatActiveUser !== userName) return;
                    // ★ 修复：头像变化只就地替换头像节点，不再整段重渲染消息列表
                    //   （整段重建会让已加载的图片重新请求，造成"气泡闪白"）。
                    patchDockChatMessageAvatars(userName);
                });
                const el = el0;
                try {
                    var requestController = typeof AbortController === 'function' ? new AbortController() : null;
                    var requestTimeout = setTimeout(function() {
                        if (requestController) requestController.abort();
                    }, 12000);
                    var messagesResp;
                    try {
                        messagesResp = await window.xtjProtectedFetch('/api/dm/messages?target=' + encodeURIComponent(userName) + '&limit=180', {
                            signal: requestController ? requestController.signal : undefined
                        });
                    } finally {
                        clearTimeout(requestTimeout);
                    }
                    var messagesResult = await messagesResp.json().catch(function() { return {}; });
                    if (!messagesResp.ok || !messagesResult.ok) throw new Error(messagesResult.error || 'DM messages failed');
                    if (loadSeq !== _dockChatLoadSeq || dockChatActiveUser !== userName) return;
                    var mergedMessages = mergeDockChatMessages(userName, mergeDockChatRowsById(messagesResult.data || [], true, 180)).filter(function(m) {
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
                    renderDockMessages(userName, mergedMessages, forceScroll);
                    if (pendingReadUpdates.length) {
                        window.markMessagesRead(userName, mergedMessages, pendingReadUpdates).catch(function() {
                            scheduleDockChatListRefresh(120);
                        });
                    } else {
                        updateUnreadBadge();
                    }
                } catch(e) {
                    if (loadSeq === _dockChatLoadSeq && dockChatActiveUser === userName) {
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
                            loadDockChatMessages(userName, false);
                        }, { once: true });
                        el.appendChild(retry);
                    }
                }
            }

            function renderDockMessages(userName, msgs, forceScroll) {
                const el = document.getElementById('dockChatMessages');
                if (!el) return;
                if (typeof clearDockChatDesktopEmptyFlag === 'function') clearDockChatDesktopEmptyFlag();
                // ★ 2026-09-25：长按菜单的「删除」是**仅本机**生效的（与微信一致）。
                //   必须在这里统一过滤 tombstone，否则下一次轮询/重新进入会话时，
                //   服务端返回的同一批消息会把删掉的内容又渲染回来。
                msgs = (Array.isArray(msgs) ? msgs : []).filter(function(m) {
                    return !isDmMessageLocallyDeleted(m);
                });
                if (!msgs.length) {
                    _chatRenderSignature[userName || '__empty__'] = '__empty__';
                    el.innerHTML = '<div class="chat-empty"><div class="ce-icon">💬</div><div>发送第一条消息吧</div></div>';
                    el.dataset.chatUser = userName || '__empty__';
                    return;
                }
                if (userName && dockChatActiveUser && userName !== dockChatActiveUser) return;
                var signatureKey = userName || '__empty__';
                var nextSignature = buildDockChatRenderSignature(msgs);
                if (_chatRenderSignature[signatureKey] === nextSignature && el.dataset.chatUser === signatureKey) {
                    if (forceScroll) scrollDockChatToLatest();
                    return;
                }
                var previousScrollTop = el.scrollTop;
                var previousScrollHeight = el.scrollHeight;
                var isNearBottom = !el.scrollHeight || isDockChatNearBottom(el, 100);
                var shouldAutoScroll = forceScroll || isNearBottom;
                const isBulk = msgs.length > 2;
                var otherUser = msgs[0] ? (msgs[0].user_name === currentUser ? msgs[0].media_url : msgs[0].user_name) : '';
                var avatars = { mine: getDockChatAvatarMarkup(currentUser), other: getDockChatAvatarMarkup(otherUser) };
                var sameConversation = el.dataset.chatUser === signatureKey;
                var existingRows = {};
                Array.prototype.forEach.call(el.querySelectorAll('.chat-msg-row[data-msg-key]'), function(node) {
                    var k = node.getAttribute('data-msg-key');
                    if (k) existingRows[k] = node;
                });
                var fragment = document.createDocumentFragment();
                msgs.forEach(function(message, index) {
                    var key = getDockChatRowKey(message, index);
                    var sig = buildDockChatRowSignature(message);
                    var node = existingRows[key];
                    if (sameConversation && node && node.getAttribute('data-msg-sig') === sig) {
                        // 未变化 → 复用原节点：图片不重新请求，已读状态不重建，不闪白
                        delete existingRows[key];
                        fragment.appendChild(node);
                        return;
                    }
                    var template = document.createElement('template');
                    template.innerHTML = buildDockChatRowMarkup(message, avatars, isBulk).trim();
                    node = template.content.firstElementChild;
                    if (node) {
                        node.setAttribute('data-msg-key', key);
                        node.setAttribute('data-msg-sig', sig);
                    }
                    fragment.appendChild(node);
                });
                el.replaceChildren(fragment);
                el.dataset.chatUser = signatureKey;
                _chatRenderSignature[signatureKey] = nextSignature;
                patchDockChatMessageAvatars(userName);
                if (shouldAutoScroll) {
                    scrollDockChatToLatest();
                    bindDockChatMediaLoadScroll(el, true);
                } else if (sameConversation) {
                    // Keep the reader anchored on the same message while a polling refresh
                    // updates the DOM; only advertise the new messages instead of yanking
                    // the conversation to the bottom.
                    el.scrollTop = previousScrollTop + Math.max(0, el.scrollHeight - previousScrollHeight);
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

            // ★ 2026-09-25 新增：「原图」开关（对齐微信的做法）。
            //   默认压缩（长边 1600 / q0.82，约 200–500KB，发送最快）；
            //   打开后按**原始字节**上传，不缩放不重编码；
            //   唯一例外是 HEIC —— 服务端 sharp 不支持 HEIC/HEVC，必须转码成 JPEG，
            //   此时用 q0.95 且不缩放，把损失降到最低。
            //   偏好按设备持久化（safeStorage），下次进来自动沿用。
            var DM_ORIGINAL_KEY = 'xtj_dm_send_original';

            function isDmOriginalSendEnabled() {
                try { return window.safeStorage.get(DM_ORIGINAL_KEY) === '1'; } catch (e) { return false; }
            }

            function syncDmOriginalToggle() {
                var btn = document.getElementById('dockChatOrigBtn');
                if (!btn) return;
                var on = isDmOriginalSendEnabled();
                btn.classList.toggle('is-on', on);
                btn.setAttribute('aria-checked', on ? 'true' : 'false');
            }

            window.toggleDmOriginalSend = function() {
                var next = !isDmOriginalSendEnabled();
                try { window.safeStorage.set(DM_ORIGINAL_KEY, next ? '1' : '0'); } catch (e) {}
                syncDmOriginalToggle();
                showToast(next ? '已开启原图发送：画质更好，上传更慢' : '已关闭原图发送：图片压缩后上传');
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
            async function prepareDmImageForUpload(file, opts) {
                var wantOriginal = !!(opts && opts.original);
                var passthrough = { file: file, converted: false, originalSize: file.size, newSize: file.size };
                if (!file || !/^image\//i.test(String(file.type || ''))) return passthrough;
                if (/gif/i.test(String(file.type || ''))) return passthrough; // 保留动图
                var isHeic = /heic|heif/i.test(String(file.type || '')) || /\.(heic|heif)$/i.test(String(file.name || ''));
                // ★ 原图开关打开时：非 HEIC 一律**原样上传** —— 不缩放、不重编码，保留原始字节。
                //   （HEIC 例外：服务端 sharp 不支持 HEIC/HEVC，必须转码，否则整条消息发不出去。）
                if (wantOriginal && !isHeic) return passthrough;
                // 已经很小、又不是 HEIC 的图没必要重编码（重编码会掉画质）
                if (!isHeic && file.size <= 400 * 1024) return passthrough;

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
                if (!bitmap) return passthrough;

                var sw = bitmap.width || 0, sh = bitmap.height || 0;
                if (!sw || !sh) return passthrough;
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
                    if (!ctx) return passthrough;
                    ctx.drawImage(bitmap, 0, 0, tw, th);
                } catch (eDraw) {
                    return passthrough;
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
                if (!blob) return passthrough;
                // 压完反而更大（小图/已高压缩）→ 保留原图；HEIC 必须转换，不看体积
                if (!isHeic && blob.size >= file.size * 0.96) return passthrough;

                var baseName = String(file.name || 'image').replace(/\.[^./\\]+$/, '') || 'image';
                var nextFile = null;
                try { nextFile = new File([blob], baseName + '.jpg', { type: 'image/jpeg', lastModified: Date.now() }); }
                catch (eFile) { return passthrough; }
                return { file: nextFile, converted: true, originalSize: file.size, newSize: nextFile.size };
            }

            async function sendDockChatMessage() {
                if (!currentUser) { showToast('请先登录'); return; }
                if (isUserMuted()) { showToast("您已被禁言，无法发送消息"); return; }
                const inp = document.getElementById('dockChatInput');
                if (!inp) return;
                const content = inp.value.trim();
                const fileInput = document.getElementById('dockChatFileInp');
                let file = fileInput && fileInput.files[0];
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
                var targetUser = dockChatActiveUser;
                if (targetUser === currentUser) { showToast('不能给自己发送消息'); return; }
                var maxFileSize = 50 * 1024 * 1024;
                if (file && file.size > maxFileSize) { showToast("文件大小不能超过50MB"); return; }
                if (file) {
                    // ★ 修复：显式拒绝 SVG（image/svg+xml 会通过 image/ 前缀白名单），
                    // 后端 dm-media 拒绝 SVG 后文件已先落桶，留下 Storage 孤儿 + 公共桶
                    // 存储型 XSS 窗口。这里与照片墙 upload-ui 的拒绝策略对齐。
                    var svgBlocked = /^image\/svg\+xml/i.test(String(file.type || '')) || /\.svgz?$/i.test(String(file.name || '').toLowerCase());
                    if (svgBlocked) { showToast("不支持 SVG 文件，仅支持图片、视频、音频"); return; }
                    var allowedTypes = ['image/','video/','audio/'];
                    var typeOk = allowedTypes.some(function(t) { return file.type.startsWith(t); });
                    if (!typeOk) { showToast("不支持的文件类型，仅支持图片、视频、音频"); return; }
                }
                dockChatSending = true; inp.value = '';
                // 把真实的发送状态告诉 ux-features 的指示器（它此前是假的 1.8 秒计时）
                try { if (typeof window.__xtjNotifyChatSending === 'function') window.__xtjNotifyChatSending(true); } catch (e) {}
                var capturedContent = content;
                var tempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
                var optimisticCreatedAt = new Date().toISOString();
                var localPreviewUrl = '';
                var mediaKind = file
                    ? (file.type.startsWith('video/') ? 'video' : (file.type.startsWith('image/') ? 'image' : 'audio'))
                    : null;
                var mediaPayload = null;
                if (file) {
                    try {
                        localPreviewUrl = URL.createObjectURL(file);
                        mediaPayload = { kind: mediaKind, url: localPreviewUrl, mimeType: file.type || '' };
                    } catch (previewError) { /* 本地预览失败时仍继续发送原文件 */ }
                }
                var actorKey = DM_MARKER;
                var optimisticContentPayload = buildDMMessageContent({ content: capturedContent }, { text: capturedContent, read_at: null, media: mediaPayload });
                var optimisticMessage = {
                    id: tempId,
                    __tempId: tempId,
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
                applyDockChatConversationPreview(targetUser, optimisticMessage, 0);
                if (file) clearDockChatFilePreview(false);
                // 失败重发时复用同一个文件对象（File 在内存里保留，页面刷新后重发不可用）
                var pendingFile = file || null;
                try {
                    var storagePath = null;
                    if (file) {
                        // ★ 上传前规范化图片：HEIC→JPEG + 压缩。失败一律回退原文件。
                        if (/^image\//i.test(String(file.type || ''))) {
                            try {
                                var _prep = await prepareDmImageForUpload(file, { original: isDmOriginalSendEnabled() });
                                if (_prep && _prep.file && _prep.file !== file) {
                                    file = _prep.file;
                                    pendingFile = _prep.file;
                                }
                            } catch (prepErr) {
                                console.warn('[dm-send] image prepare failed, falling back to original', prepErr);
                                // 浏览器解不了 HEIC，且服务端 sharp 也不支持 → 给出可执行的提示，
                                // 而不是让用户面对一句模糊的「无法识别为有效图片」。
                                if (/heic|heif/i.test(String(file.type || '') + ' ' + String(file.name || ''))) {
                                    var heicErr = new Error('当前浏览器无法转换 HEIC 照片：请在 iPhone 相册里打开该照片 → 编辑 → 存储为 JPEG，或改用「文件」里的 JPG 发送');
                                    heicErr.serverRejected = true;
                                    throw heicErr;
                                }
                            }
                        }
                        // ★ 2026-09-25 根治：媒体改走**后端上传**，不再直连 Supabase Storage。
                        //   旧实现依赖 window.sb（浏览器端 anon key）。构建期未注入
                        //   SUPABASE_ANON_KEY 时线上 config 里是占位串，浏览器用垃圾 key 建的
                        //   client 在登录后会被 Supabase 判为无效 JWS，报
                        //   "发送失败: 媒体上传失败: Invalid Compact JWS"——反复出现的根因。
                        //   改成一次 multipart 以外的单请求：50MB 原始体 + 查询参数描述元数据，
                        //   由后端用 service_role 写入，前端不再持有任何存储密钥。
                        var _dmKind = file.type.startsWith('video/') ? 'video'
                                    : (file.type.startsWith('image/') ? 'image'
                                    : (file.type.startsWith('audio/') ? 'audio' : null));
                        if (!_dmKind) throw new Error('不支持的媒体类型: ' + file.type);
                        // 路径必须带 uidHash 前缀，后端 validateDmUploadOwnership 会校验归属，
                        // 防止"猜一个他人路径"抢占存储位置。
                        var path = await buildDmStorageUploadPath(file.name);
                        // 统一走 xtjProtectedFetch：它已处理 token 刷新、15s 超时、401 重试与
                        // 失效弹窗，比裸 fetch 更稳，也不会在 token 过期时静默失败。
                        var _upResp = await window.xtjProtectedFetch(
                            '/api/dm/upload'
                                + '?path=' + encodeURIComponent(path)
                                + '&kind=' + encodeURIComponent(_dmKind)
                                + '&mime_type=' + encodeURIComponent(file.type || 'application/octet-stream'),
                            {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/octet-stream' },
                                body: file,
                                // 50MB 素材在移动网络下 15s 不够，放宽到 2 分钟
                                timeoutMs: 120000
                            }
                        );
                        var _upData = await _upResp.json().catch(function() { return {}; });
                        if (!_upResp.ok || !_upData || !_upData.ok) {
                            throw new Error('媒体上传失败: ' + ((_upData && _upData.error) || ('HTTP ' + _upResp.status)));
                        }
                        storagePath = _upData.storage_path || path;
                        mediaKind = _dmKind;
                        if (_dmKind === 'video') {
                            actorKey = '__dm_vid__' + storagePath;
                            mediaPayload = { kind: 'video', url: _upData.public_url || getMediaUrl('__dm_vid__', storagePath), mimeType: file.type || '' };
                        } else if (_dmKind === 'image') {
                            actorKey = '__dm_img__' + storagePath;
                            mediaPayload = { kind: 'image', url: _upData.public_url || getMediaUrl('__dm_img__', storagePath), mimeType: file.type || '' };
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
                        content: capturedContent
                    };
                    if (storagePath) {
                        requestBody.storage_path = storagePath;
                        requestBody.kind = mediaKind;
                        requestBody.mime_type = file.type;
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
                        timeoutMs: 60000
                    });
                    if (!sendResp.ok) {
                        var sendErrData = await sendResp.json().catch(function() { return {}; });
                        var sendErr = new Error(sendErrData.error || '发送失败 (HTTP ' + sendResp.status + ')');
                        // 只有"重试也不会变好"的客户端错误才把提交结果视为确定；
                        // 409/429/5xx 属于可重试或结果未知，媒体必须留下。
                        sendErr.serverRejected = [400, 403, 404, 413, 415, 422].indexOf(sendResp.status) >= 0;
                        throw sendErr;
                    }
                    var sendResult = await sendResp.json();
                    if (!sendResult.ok || !sendResult.message) throw new Error('服务端未确认发送');

                    var insertedMessage = sendResult.message;
                    touchUserSession(false);
                    try { if (typeof window.queueBehavior === 'function') window.queueBehavior('message_send', '发送消息给 [' + targetUser + ']'); } catch(e) {}
                    clearDockChatFilePreview(false);
                    replaceDockChatCacheMessage(targetUser, tempId, insertedMessage);
                    if (dockChatActiveUser === targetUser) renderDockMessages(targetUser, _chatCache[getDockChatCacheKey(targetUser)] || [], true);
                    releaseDockChatLocalPreview(optimisticMessage);
                    localPreviewUrl = '';
                    applyDockChatConversationPreview(targetUser, insertedMessage, 0);
                    scheduleDockChatListRefresh(320);
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
                                timeoutMs: 15000
                            });
                        } catch (dmCleanupErr) { console.warn('[dm-send] orphan media cleanup failed', dmCleanupErr); }
                        storagePath = null;
                    }
                    // ★ 2026-09-25 修复（"发送失败"体验）：不再把气泡直接抹掉。
                    //   旧行为是 removeDockChatCacheMessage + 一句 3 秒 toast —— 消息凭空消失，
                    //   用户既不知道丢了什么，也没有任何重试入口。现在保留为"失败态"气泡，
                    //   长按即可重发或删除，并把服务端原因留在气泡上（title）。
                    var failedMessage = Object.assign({}, optimisticMessage || {}, {
                        id: tempId,
                        __tempId: tempId,
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
                    dockChatSending = false;
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

            // 「删除」仅本机生效（与微信的"删除"语义一致）：用 tombstone 记录 id，
            //   渲染与入缓存时都过滤掉。按账号隔离，避免换账号后串数据。
            var DM_DELETED_KEY_PREFIX = 'xtj_dm_deleted_';
            var DM_DELETED_MAX = 500;

            function getDmDeletedIds() {
                try {
                    var raw = window.safeStorage ? window.safeStorage.get(DM_DELETED_KEY_PREFIX + (currentUser || '')) : null;
                    var arr = raw ? JSON.parse(raw) : [];
                    return Array.isArray(arr) ? arr : [];
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
                try { window.safeStorage.set(DM_DELETED_KEY_PREFIX + (currentUser || ''), JSON.stringify(list)); } catch (e) {}
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
                    return [
                        { id: 'resend', label: '重发' },
                        { id: 'delete', label: '删除' }
                    ];
                }
                if (message.__optimistic) return actions;   // 发送中不给操作
                var payload = getDMMessagePayload(message) || {};
                var withdrawn = !!payload.withdrawn;
                var value = getDmActionValue(message);
                var sent = message.user_name === currentUser;
                var elapsed = Date.now() - new Date(message.created_at).getTime();
                var canWithdraw = sent && !withdrawn && !isNaN(elapsed) && elapsed <= 3 * 60 * 1000;
                if (!withdrawn && value) actions.push({ id: 'copy', label: '复制' });
                if (canWithdraw) actions.push({ id: 'withdraw', label: '撤回' });
                if (!withdrawn && value) actions.push({ id: 'forward', label: '转发' });
                if (value) actions.push({ id: 'share', label: '分享' });
                // ★ 由 ux-features.js 的重复长按菜单迁移过来（那里已停用），保留"问小猫"这个能力
                if (!withdrawn && value) actions.push({ id: 'ask-ai', label: '问小猫' });
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
                var sheet = _dmActionSheet;
                _dmActionSheet = null;
                try { sheet.classList.remove('active'); } catch (e) {}
                // .active 在**内层**（.dm-bar 或 .dm-action-panel）上，遮罩层本身没有，
                // 这里一并摘掉，避免关闭时最后 200ms 还亮着。
                try {
                    var innerSurface = sheet.querySelector ? sheet.querySelector('.dm-bar, .dm-action-panel') : null;
                    if (innerSurface) innerSurface.classList.remove('active');
                } catch (e) {}
                setTimeout(function() { try { if (sheet.parentNode) sheet.parentNode.removeChild(sheet); } catch (e) {} }, 200);
                try { document.removeEventListener('keydown', onDmActionKeydown, true); } catch (e) {}
            }

            function closeDockForwardPicker() {
                if (!_dmForwardPicker) return;
                var el = _dmForwardPicker;
                _dmForwardPicker = null;
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
                panel.setAttribute('role', 'dialog');
                panel.setAttribute('aria-modal', 'true');
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

                var cancelBtn = document.createElement('button');
                cancelBtn.type = 'button';
                cancelBtn.className = 'dm-action-cancel';
                cancelBtn.textContent = '取消';
                cancelBtn.addEventListener('click', function(ev) {
                    ev.preventDefault(); ev.stopPropagation(); closeDockMessageActions();
                });
                panel.appendChild(cancelBtn);

                overlay.appendChild(panel);
                overlay.addEventListener('click', function(ev) { if (ev.target === overlay) closeDockMessageActions(); });
                document.body.appendChild(overlay);
                _dmActionSheet = overlay;
                requestAnimationFrame(function() { try { overlay.classList.add('active'); } catch (e) {} });
                document.addEventListener('keydown', onDmActionKeydown, true);
            }
            function runDockMessageAction(actionId, message) {
                closeDockMessageActions();
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
                showToast('已删除（仅本机）');
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
                try {
                    var resp = await window.xtjProtectedFetch('/api/dm/send', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ target_user: targetUser, content: value }),
                        timeoutMs: 60000
                    });
                    var data = await resp.json().catch(function() { return {}; });
                    if (!resp.ok || !data || !data.ok) {
                        throw new Error((data && data.error) || ('HTTP ' + resp.status));
                    }
                    showToast('已转发给 ' + targetUser);
                    scheduleDockChatListRefresh(200);
                    if (dockChatActiveUser === targetUser && data.message) {
                        replaceDockChatCacheMessage(targetUser, null, data.message);
                        loadDockChatMessages(targetUser, false, true);
                    }
                } catch (e) {
                    showToast('转发失败：' + ((e && e.message) || '未知错误'));
                }
            }

            async function resendDmMessage(message) {
                if (!message || !message.__failed) return;
                var peer = dockChatActiveUser;
                if (!peer) return;
                var file = message.__pendingFile || null;
                var text = (getDMMessageText(message) || '').trim();
                if (!file && !text) { showToast('这条消息没有可重发的内容'); return; }
                // 先把失败气泡移出缓存，再走一次完整的正常发送流程
                var targetId = String(message.id || message.__tempId || '');
                var cacheKey = getDockChatCacheKey(peer);
                var list = Array.isArray(_chatCache[cacheKey]) ? _chatCache[cacheKey] : [];
                _chatCache[cacheKey] = list.filter(function(m) {
                    return String((m && (m.id || m.__tempId)) || '') !== targetId;
                });
                _chatRenderSignature[peer] = undefined;
                renderDockMessages(peer, _chatCache[cacheKey], false);
                releaseDockChatLocalPreview(message);

                var fileInput = document.getElementById('dockChatFileInp');
                var inp = document.getElementById('dockChatInput');
                if (file && fileInput) {
                    try {
                        var dt = new DataTransfer();
                        dt.items.add(file);
                        fileInput.files = dt.files;
                    } catch (e) { fileInput.value = ''; }
                }
                if (inp && text) inp.value = text;
                await sendDockChatMessage();
            }

            function bindDockChatMessageActions() {
                var container = document.getElementById('dockChatMessages');
                if (!container || container.__xtjMsgActionsBound) return;
                container.__xtjMsgActionsBound = true;
                var pressTimer = null;
                var startX = 0, startY = 0, longPressed = false;
                function cancelPress() { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }

                // 长按 450ms。用 passive 监听 + 位移阈值取消，避免抢走列表滚动。
                container.addEventListener('touchstart', function(e) {
                    if (!e.touches || e.touches.length !== 1) { cancelPress(); return; }
                    var row = e.target && e.target.closest ? e.target.closest('.chat-msg') : null;
                    if (!row) { cancelPress(); return; }
                    startX = e.touches[0].clientX;
                    startY = e.touches[0].clientY;
                    longPressed = false;
                    cancelPress();
                    pressTimer = setTimeout(function() {
                        pressTimer = null;
                        longPressed = true;
                        try { if (navigator.vibrate) navigator.vibrate(12); } catch (eVib) {}
                        openDockMessageActions(row);
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
                    if (!longPressed) return;
                    longPressed = false;
                    e.preventDefault();
                    e.stopPropagation();
                }, true);
            }

            function showDockChatFilePreview(file) {
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
                } else {
                    const img = document.createElement('img');
                    _dockPreviewUrl = URL.createObjectURL(file);
                    img.src = _dockPreviewUrl;
                    img.alt = '';
                    thumb.appendChild(img);
                }
                name.textContent = file.name || '图片';
                if (meta) {
                    var kindLabel = file.type.startsWith('video/') ? '视频' : (file.type.startsWith('audio/') ? '音频' : '图片');
                    var sizeLabel = file.size < 1024 * 1024
                        ? Math.max(1, Math.round(file.size / 1024)) + ' KB'
                        : (file.size / (1024 * 1024)).toFixed(1) + ' MB';
                    meta.textContent = kindLabel + ' · ' + sizeLabel + ' · 准备发送';
                }
                preview.classList.remove('hidden');
            }

            function clearDockChatFilePreview(restoreFocus) {
                const preview = document.getElementById('dockChatFilePreview');
                const input = document.getElementById('dockChatInput');
                const fileInput = document.getElementById('dockChatFileInp');
                if (_dockPreviewUrl) { URL.revokeObjectURL(_dockPreviewUrl); _dockPreviewUrl = null; }
                if (preview) preview.classList.add('hidden');
                if (fileInput) fileInput.value = '';
                if (restoreFocus !== false && input) input.focus();
            }

            /** Normalize clipboard/drag files (often nameless blobs) and assign into #dockChatFileInp. */
            function normalizeDockChatMediaFile(file) {
                if (!file) return null;
                var type = String(file.type || '');
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
                var allowedTypes = ['image/', 'video/', 'audio/'];
                var typeOk = allowedTypes.some(function(t) { return String(file.type || '').indexOf(t) === 0; });
                if (!typeOk) { showToast('不支持的文件类型，仅支持图片、视频、音频'); return false; }
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
                    if (f && /^(image|video|audio)\//.test(String(f.type || ''))) return f;
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
                var _dfi = document.getElementById('dockChatFileInp'); if (_dfi) _dfi.addEventListener('change', function() { if (this.files.length) showDockChatFilePreview(this.files[0]); });
                var _dcjl = document.getElementById('dockChatJumpLatest'); if (_dcjl) _dcjl.addEventListener('click', function() { scrollDockChatToLatest({ smooth: true }); });
                var _dcm = document.getElementById('dockChatMessages'); if (_dcm) _dcm.addEventListener('scroll', function() { if (isDockChatNearBottom(_dcm, 96)) setDockChatJumpLatestVisible(false); }, { passive: true });
                var _dcr = document.getElementById('dockCfpRemove'); if (_dcr) _dcr.addEventListener('click', clearDockChatFilePreview);
                bindDockChatPasteAndDrop();
                bindDockChatMessageActions();
                var _dockOrigBtn = document.getElementById('dockChatOrigBtn');
                if (_dockOrigBtn) _dockOrigBtn.addEventListener('click', window.toggleDmOriginalSend);
                syncDmOriginalToggle();
            } catch(e) {
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
                    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                    if (!isIOS) return;

                    const dockBar = document.getElementById('dockBar');
                    const inputs = ['dockChatInput', 'postInp', 'announcementAdminInput', 'announcementAdminTitle', 'authUserInput', 'authPassInput'];
                    const root = document.documentElement;
                    root.classList.add('xtj-ios-viewport');
                    let keyboardOpen = false;
                    // 环境固有的视口差（非键盘部分），取历史最小值当基线。见 updateIOSViewport。
                    var viewportBaseline = Infinity;

                    function hasActiveInput() {
                        var active = document.activeElement;
                        return !!(active && inputs.indexOf(active.id) >= 0);
                    }

                    function updateIOSViewport() {
                        var vv = window.visualViewport;
                        var appHeight = vv ? Math.round(vv.height) : window.innerHeight;
                        root.style.setProperty('--xtj-app-height', appHeight + 'px');
                        var rawDiff = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
                        // ★ 2026-09-22 视口差基线（微信 web-view / 微信内置浏览器 / 开发者工具模拟器通吃）：
                        //   这些环境里 window.innerHeight 与 visualViewport 存在**环境固有的恒定差值**
                        //   （微信的导航栏工具栏、调试器里的 iframe 都不参与 visualViewport），
                        //   它并不是键盘造成的。若直接把它当键盘高度，.dock-bar 的
                        //   bottom: max(--xtj-visual-bottom, inset-bottom) 就会把 Dock 顶到屏幕中下部。
                        //   做法：用**历史最小值当基线**，只有超出基线的增量才算真正的键盘。
                        //   好处：不依赖 UA（模拟器/真机/内置浏览器都成立），纯浏览器里基线恒为 0，
                        //   行为与修复前逐像素一致。
                        if (rawDiff < viewportBaseline) viewportBaseline = rawDiff;
                        var viewportBottom = Math.max(0, rawDiff - viewportBaseline);
                        root.style.setProperty('--xtj-visual-bottom', viewportBottom + 'px');
                        if (dockBar) {
                            // Reserve the real Dock footprint so the last post never scrolls behind it.
                            root.style.setProperty('--xtj-dock-reserve', (Math.ceil(dockBar.getBoundingClientRect().height) + 20) + 'px');
                        }
                        var keyboardGap = viewportBottom;
                        root.style.setProperty('--xtj-ios-keyboard-gap', keyboardGap + 'px');
                        var chatFocused = document.activeElement && document.activeElement.id === 'dockChatInput' && currentDockTab === 'chat';
                        var shouldCollapseDock = !!(chatFocused && keyboardGap > 0);
                        document.body.classList.toggle('ios-chat-keyboard-open', shouldCollapseDock);
                        if (dockBar) dockBar.style.display = shouldCollapseDock ? 'none' : '';
                        if (chatFocused) setTimeout(scrollDockChatBottom, 80);
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
                        keyboardOpen = false;
                        document.body.classList.remove('ios-chat-keyboard-open');
                        root.style.setProperty('--xtj-ios-keyboard-gap', '0px');
                        if (dockBar) dockBar.style.display = '';
                        requestAnimationFrame(function() {
                            updateIOSViewport();
                            setTimeout(function() {
                                updateIOSViewport();
                                scrollDockChatBottom();
                            }, 120);
                        });
                    };

                    function handleFocus(e) {
                        keyboardOpen = true;
                        updateIOSViewport();
                        setTimeout(() => {
                            if (e.target && e.target.scrollIntoViewIfNeeded) {
                                e.target.scrollIntoViewIfNeeded(true);
                            } else if (e.target && e.target.scrollIntoView) {
                                e.target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                            }
                        }, 300);
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

                    inputs.forEach(id => {
                        const el = document.getElementById(id);
                        if (el) {
                            el.addEventListener('focus', handleFocus);
                            el.addEventListener('blur', handleBlur);
                        }
                    });
                    if (window.visualViewport) {
                        var _iosVvTicking = false;
                        function _iosVvHandler() {
                            if (!_iosVvTicking) {
                                _iosVvTicking = true;
                                requestAnimationFrame(function() {
                                    updateIOSViewport();
                                    _iosVvTicking = false;
                                });
                            }
                        }
                        window.visualViewport.addEventListener('resize', _iosVvHandler);
                        window.visualViewport.addEventListener('scroll', _iosVvHandler);
                    }
                    window.addEventListener('orientationchange', function() {
                        setTimeout(updateIOSViewport, 180);
                    });
                    window.addEventListener('resize', function() {
                        if (!keyboardOpen) updateIOSViewport();
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
                        var hasSkeleton = !!feedEl.querySelector('.xtj-loading-skeleton, .xtj-skeleton-card, .xtj-magic-loading, .loading')
                            || /内容加载中|加载中/.test(feedEl.innerHTML || '');
                        var hasError = !!feedEl.querySelector('#feedBootError, #feedInitError, #feedWatchdogError, .feed-load-more-error')
                            || /加载失败|加载中断|启动加载失败|加载超时/.test(feedEl.innerText || '');
                        var isEmpty = !hasPosts && !hasError && String(feedEl.textContent || '').trim().length < 8;
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
            function updateAnnouncementBadgeOld() { window.updateAnnouncementBadge(); }

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
                    fetch(API_BASE + '/api/photos/public?limit=200')
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
                var thumbHtml = item.thumb
                    ? '<img class="rc-thumb" src="' + escapeHtml(item.thumb) + '" alt="" loading="lazy" onerror="this.outerHTML=\'<div class=&quot;rc-thumb rc-thumb--text&quot; aria-hidden=&quot;true&quot;><span>' + safeJsStr((item.user_name || '?').slice(0,1).toUpperCase()) + '</span></div>\'">'
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
                var detailMediaAttrs = buildPostDetailMediaAttrs(normalizedPost);
                var mediaHtml = normalizedPost.media_url ? (
                    normalizedPost.media_type === 'video'
                        ? '<video src="' + escapeHtml(normalizedPost.media_url) + '" controls preload="metadata" playsinline></video>'
                        : (normalizedPost.media_type === 'audio'
                            ? '<audio src="' + escapeHtml(normalizedPost.media_url) + '" controls preload="metadata"></audio>'
                            : '<img ' + detailMediaAttrs + ' data-actor-key="' + escapeHtml(String(normalizedPost.actor_key || "")) + '" data-can-delete="' + (canDeletePost(normalizedPost) ? '1' : '0') + '" src="' + escapeHtml(normalizedPost.media_url) + '" onclick="openImageViewer(\'' + safeJsStr(normalizedPost.media_url) + '\', this)" loading="lazy" decoding="async" fetchpriority="low" />')
                ) : '';
                var visibilityLabel = normalizedPost.visibility === 'private' ? '私密' : '公开';
                var contentText = String(normalizedPost.content || '').trim();
                var detailActions = [];
                detailActions.push('<button type="button" class="action-btn post-tools-trigger" data-post-id="' + escapeHtml(String(normalizedPost.id)) + '" aria-haspopup="menu" aria-expanded="false" aria-label="更多帖子工具">•••</button>');
                if (canDeletePost(normalizedPost)) {
                    detailActions.push('<button type="button" class="action-btn del" onclick="openDelete(\'' + safeJsStr(String(normalizedPost.id)) + '\', \'' + safeJsStr(String(normalizedPost.actor_key || "")) + '\')">删除</button>');
                }
                return [
                    '<article class="post-detail-shell post-detail-shell--clean">',
                    '  <section class="post-detail-main-card">',
                    '    <header class="post-detail-top">',
                    '      <div class="post-detail-owner">',
                    '        <div class="post-detail-avatar">' + escapeHtml(String(normalizedPost.user_name || '?').slice(0, 1).toUpperCase()) + '</div>',
                    '        <div class="post-detail-owner-copy">',
                    '          <div class="pdh-name">' + escapeHtml(normalizedPost.user_name || '未知用户') + '</div>',
                    '          <div class="pdh-time">' + window.safeParseDate(normalizedPost.created_at).toLocaleString() + '</div>',
                    '        </div>',
                    '      </div>',
                    '      <span class="post-detail-visibility">' + visibilityLabel + '</span>',
                    '    </header>',
                    mediaHtml ? '<div class="post-detail-media-card"><div class="post-detail-media">' + mediaHtml + '</div></div>' : '',
                    contentText ? '<div class="post-detail-content">' + escapeHtml(contentText) + '</div>' : '',
                    // 2026-09-22：详情弹窗与 feed 卡片一致展示位置/IP 属地（此前详情不显示）
                    (typeof window.buildPostLocationHtml === 'function' ? window.buildPostLocationHtml(normalizedPost) : ''),
                    '    <div class="post-detail-stats">' + buildPostStatsLine(normalizedPost, (likes || []).length, (comments || []).length) + '</div>',
                    detailActions.length ? '<div class="post-detail-actions">' + detailActions.join("") + '</div>' : '',
                    '  </section>',
                    '  <section class="post-detail-panel post-detail-panel--stack">',
                    '    <div class="post-detail-panel-title">点赞用户 <span>' + likes.length + '</span></div>',
                    likes.length ? likes.map(function(l) {
                        return '<article class="post-detail-mini-row"><div class="post-detail-mini-main"><div class="post-detail-mini-name">' + escapeHtml(l.user_name) + '</div><div class="post-detail-mini-copy">留下了喜欢</div></div><span class="post-detail-mini-time">' + window.safeParseDate(l.created_at).toLocaleString() + '</span></article>';
                    }).join('') : '<div class="stat-empty post-detail-empty">暂无点赞</div>',
                    '  </section>',
                    '  <section class="post-detail-panel post-detail-panel--stack">',
                    '    <div class="post-detail-panel-title">评论记录 <span>' + comments.length + '</span></div>',
                    comments.length ? comments.map(function(c) {
                        return '<article class="post-detail-mini-row"><div class="post-detail-mini-main"><div class="post-detail-mini-name">' + escapeHtml(c.user_name) + '</div><div class="post-detail-mini-copy">' + escapeHtml(c.content || '无评论内容') + '</div></div><span class="post-detail-mini-time">' + window.safeParseDate(c.created_at).toLocaleString() + '</span></article>';
                    }).join('') : '<div class="stat-empty post-detail-empty">暂无评论</div>',
                    '  </section>',
                    '</article>'
                ].join('');
            }

            renderPostDetail = function(post, likes, comments) {
                var body = document.getElementById('postDetailBody');
                if (!body) return;
                body.innerHTML = statPostDetailMarkup(post, likes, comments);
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

            window.openPostDetail = async function(postId) {
                var _seq = ++_postDetailReqSeq;
                var title = document.getElementById('postDetailTitle');
                var body = document.getElementById('postDetailBody');
                var modal = document.getElementById('postDetailModal');
                if (title) title.textContent = '帖子详情';
                if (body) body.innerHTML = getXtjLoadingHtml('加载中..', '加载中..', 'feed');
                if (modal) modal.classList.add('active');

                try {
                    var apiUrl = (window.API_BASE || '') + '/api/post/detail/' + encodeURIComponent(postId);
                    var apiRes = await fetch(apiUrl, { credentials: 'include' });
                    if (!apiRes.ok && (!apiRes.headers.get('content-type') || !apiRes.headers.get('content-type').includes('application/json'))) {
                        if (_seq === _postDetailReqSeq && body) body.innerHTML = '<div class="stat-empty">无法获取帖子详情（' + apiRes.status + '）。</div>';
                        return;
                    }
                    var apiData;
                    try {
                        apiData = await apiRes.json();
                    } catch(e) {
                        if (_seq === _postDetailReqSeq && body) body.innerHTML = '<div class="stat-empty">解析帖子详情失败，请稍后重试。</div>';
                        return;
                    }
                    if (!apiRes.ok || !apiData || !apiData.ok) {
                        var errMsg = (apiData && apiData.message) || '该帖子不存在、已删除或不可查看。';
                        // 错误消息来自服务端，先转义再拼 HTML，防 XSS 注入
                        if (_seq === _postDetailReqSeq && body) body.innerHTML = '<div class="stat-empty">' + escapeHtml(errMsg) + '</div>';
                        return;
                    }
                    // S7 修复：响应落地前校验是否已被新请求替代
                    if (_seq !== _postDetailReqSeq) return;
                    var post = apiData.post;
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
                    if (_seq === _postDetailReqSeq && body) body.innerHTML = '<div class="stat-empty">加载失败，请重试</div>';
                    console.error(e);
                }
            };

        })();
