/**
 * core-parts/04-posts-interactions.js
 * Likes, post tools, delete, image viewer, view history, feed helpers
 * Lines from original core.js: 4753-8928
 * DO NOT edit js/core.js directly — edit this file, then run: node scripts/assemble-core.js
 */
            // ===================== 点赞 =====================
            function getCurrentLikeIdentityValues() {
                var values = [];
                if (deviceId) values.push(String(deviceId));
                if (currentUser) values.push(String(currentUser));
                return Array.from(new Set(values.filter(Boolean)));
            }

            function makeLikeLookupKeys(postId, actorKey, userName) {
                var pid = String(postId || '');
                var keys = [];
                if (actorKey) keys.push(pid + '|' + String(actorKey));
                if (userName) keys.push(pid + '|' + String(userName));
                return Array.from(new Set(keys));
            }

            function isLikeOwnedByCurrentUser(like, postId) {
                if (!like) return false;
                if (postId != null && String(like.post_id || '') !== String(postId)) return false;
                if (currentUser && String(like.user_name || '') === String(currentUser)) return true;
                var actor = String(like.actor_key || '');
                if (!actor) return false;
                return getCurrentLikeIdentityValues().indexOf(actor) >= 0;
            }

            function isPostLikedByCurrentUser(likeUserMap, postId) {
                var keys = makeLikeLookupKeys(postId, deviceId, currentUser);
                for (var i = 0; i < keys.length; i++) {
                    if (likeUserMap && likeUserMap[keys[i]]) return true;
                }
                return false;
            }

            function setLikeButtonState(btn, liked) {
                if (!btn) return;
                btn.classList.toggle('liked', !!liked);
                btn.textContent = liked ? '❤️' : '🤍';
                btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
            }

            function persistFeedLikesCache() {
                try {
                    var raw = window.safeStorage.get(CACHE_KEY);
                    if (!raw) return;
                    var parsed = JSON.parse(raw);
                    if (!parsed || typeof parsed !== 'object') return;
                    if (!parsed.data || typeof parsed.data !== 'object') parsed.data = {};
                    parsed.data.likes = Array.isArray(feedAllLikes) ? feedAllLikes : [];
                    parsed.timestamp = Date.now();
                    window.safeStorage.set(CACHE_KEY, JSON.stringify(parsed));
                } catch (e) {}
            }

            function updateLikeStatsText(statsEl, liked) {
                if (!statsEl) return;
                var text = statsEl.textContent || '';
                var match = text.match(/(?:点赞|❤)\s*(\d+)/);
                if (!match) return;
                var current = parseInt(match[1], 10) || 0;
                var next = liked ? current + 1 : Math.max(0, current - 1);
                statsEl.textContent = text.replace(/(点赞|❤)\s*\d+/, '$1 ' + next);
            }

            function updatePostLikeCount(postId, likeCount) {
                var count = Number(likeCount);
                if (!Number.isFinite(count) || count < 0) return;
                var pid = String(postId || '');
                document.querySelectorAll('.post[data-post-id]').forEach(function(postEl) {
                    if (String(postEl.getAttribute('data-post-id') || '') !== pid) return;
                    var statsEl = postEl.querySelector('.post-stats-text');
                    if (!statsEl) return;
                    statsEl.textContent = (statsEl.textContent || '').replace(/(点赞|❤)\s*\d+/, '$1 ' + count);
                });
            }

            function getPostLikeButtons(postId) {
                var pid = String(postId || '');
                var buttons = [];
                document.querySelectorAll('.post[data-post-id]').forEach(function(postEl) {
                    if (String(postEl.getAttribute('data-post-id') || '') !== pid) return;
                    var likeBtn = postEl.querySelector('.actions .like-btn') || postEl.querySelector('.actions .action-btn');
                    if (likeBtn) buttons.push(likeBtn);
                });
                return buttons;
            }

            function setPostLikePending(postId, pending) {
                getPostLikeButtons(postId).forEach(function(likeBtn) {
                    // Keep the control available so rapid toggles feel immediate while the latest intent syncs.
                    likeBtn.disabled = false;
                    if (pending) likeBtn.setAttribute('aria-busy', 'true');
                    else likeBtn.removeAttribute('aria-busy');
                    if (pending) likeBtn.dataset.likePending = '1';
                    else delete likeBtn.dataset.likePending;
                });
            }

            function updatePostLikeUi(postId, liked, likeRecord) {
                var pid = String(postId || '');
                if (!Array.isArray(feedAllLikes)) feedAllLikes = [];
                feedAllLikes = feedAllLikes.filter(function(item) {
                    return !isLikeOwnedByCurrentUser(item, pid);
                });
                if (liked) {
                    feedAllLikes.push(likeRecord || {
                        post_id: pid,
                        user_name: currentUser,
                        actor_key: deviceId
                    });
                }
                persistFeedLikesCache();

                document.querySelectorAll('.post[data-post-id]').forEach(function(postEl) {
                    if (String(postEl.getAttribute('data-post-id') || '') !== pid) return;
                    var likeBtn = postEl.querySelector('.actions .like-btn') || postEl.querySelector('.actions .action-btn');
                    var statsEl = postEl.querySelector('.post-stats-text');
                    var stateChanged = !!likeBtn && likeBtn.classList.contains('liked') !== !!liked;
                    setLikeButtonState(likeBtn, liked);
                    if (stateChanged) updateLikeStatsText(statsEl, liked);
                });
            }
            var likeStatRefreshTimer = null;
            function scheduleLikeStatRefresh() {
                var modal = document.getElementById('statModal');
                if (!modal || !modal.classList.contains('active') || statCurrentType !== 'likes') return;
                if (likeStatRefreshTimer) clearTimeout(likeStatRefreshTimer);
                likeStatRefreshTimer = setTimeout(function() {
                    likeStatRefreshTimer = null;
                    refreshStatModal();
                }, 300);
            }

            var likeOperations = Object.create(null);

            function applyPostLikeIntent(postId, liked, sourceButton) {
                updatePostLikeUi(postId, liked, { post_id: postId, user_name: currentUser, actor_key: deviceId });
                updateFeedStats();
                if (liked && sourceButton) createLikeBlossom(sourceButton);
            }

            function flushPostLikeOperation(postId, operation) {
                if (likeOperations[postId] !== operation) return Promise.resolve();
                var requestedLiked = operation.desired;
                operation.running = true;
                operation.requested = requestedLiked;
                var normalizedPostId = postId.trim().toLowerCase();
                return window.xtjProtectedFetch('/api/post/like', {
                    method: 'POST',
                    body: JSON.stringify({ post_id: normalizedPostId, liked: requestedLiked })
                }).then(function(likeResponse) {
                    return likeResponse.json().catch(function() { return {}; }).then(function(likeResult) {
                        if (!likeResponse.ok || !likeResult.ok || !!likeResult.liked !== requestedLiked) {
                            throw new Error(likeResult.error || 'like_state_sync_failed');
                        }
                        operation.confirmed = requestedLiked;
                        updatePostLikeCount(postId, likeResult.like_count);
                        touchUserSession(false);
                        scheduleLikeStatRefresh();
                        if (currentDockTab === 'profile' && typeof loadProfileActivity === 'function') loadProfileActivity(true);
                        try { if (typeof window.queueBehavior === 'function') window.queueBehavior(requestedLiked ? 'post_like' : 'post_unlike', 'post ' + postId.slice(0, 8)); } catch(e) {}
                        if (operation.desired !== operation.confirmed) return flushPostLikeOperation(postId, operation);
                    });
                }).catch(function(error) {
                    console.error(error);
                    if (likeOperations[postId] !== operation) return;
                    if (operation.desired !== operation.confirmed) {
                        applyPostLikeIntent(postId, operation.confirmed);
                        showToast("点赞失败，请重试");
                    }
                }).finally(function() {
                    // ★ 修复：无条件复位 running——此前仅当 desired===confirmed 时才删除条目，
                    // 若"请求在途时再点取消 → 第一次成功触发 re-flush → 第二次失败"，条目会永久
                    // 残留在 running=true 状态，此后 toggleLike 不再发起任何请求，点赞态与服务器
                    // 永久失同步（P1）。现在 running 始终复位：状态未同步时下次点击可重新 flush。
                    operation.running = false;
                    setPostLikePending(postId, false);
                    if (likeOperations[postId] === operation && operation.desired === operation.confirmed) {
                        delete likeOperations[postId];
                    }
                });
            }

            window.toggleLike = function (btn, postId) {
                if (!currentUser) { showToast("请先登录"); return; }
                if (isUserMuted()) { showToast("您已被禁言，无法点赞"); return; }
                var pid = String(postId || '');
                if (!btn || !pid) return;
                var normalizedPostId = pid.trim().toLowerCase();
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalizedPostId)) {
                    showToast("帖子参数无效");
                    return;
                }
                var operation = likeOperations[pid];
                var visibleButton = getPostLikeButtons(pid)[0] || btn;
                var currentLiked = operation ? operation.desired : visibleButton.classList.contains('liked');
                var nextLiked = !currentLiked;
                if (!operation) {
                    operation = { confirmed: currentLiked, desired: currentLiked, running: false, promise: null };
                    likeOperations[pid] = operation;
                }
                operation.desired = nextLiked;
                setPostLikePending(pid, true);
                applyPostLikeIntent(pid, nextLiked, btn);
                if (!operation.running) operation.promise = flushPostLikeOperation(pid, operation);
                return operation.promise;
            };

            var likeBlossomSequence = 0;

            function createLikeBlossom(btn) {
                var perfProfile = window.__xtjPerfProfile || 'full';
                if (perfProfile === 'lite') return;
                if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
                var layer = btn.closest ? btn.closest('.actions') : btn.parentElement;
                if (!layer) return;

                var existing = btn._likeBlossom;
                if (existing) {
                    if (existing.timer) clearTimeout(existing.timer);
                    if (existing.node && existing.node.parentNode) existing.node.remove();
                }

                var buttonRect = btn.getBoundingClientRect();
                var layerRect = layer.getBoundingClientRect();
                var blossom = document.createElement('span');
                var gradientId = 'xtj-like-blossom-gradient-' + (++likeBlossomSequence);
                blossom.className = 'like-blossom';
                blossom.setAttribute('aria-hidden', 'true');
                blossom.style.left = (buttonRect.left - layerRect.left + buttonRect.width / 2) + 'px';
                blossom.style.top = (buttonRect.top - layerRect.top + buttonRect.height / 2) + 'px';
                blossom.innerHTML = '<svg viewBox="0 0 100 100" focusable="false"><defs><linearGradient id="' + gradientId + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe8f0"/><stop offset=".62" stop-color="#ffb4c8"/><stop offset="1" stop-color="#ff91ad"/></linearGradient></defs><g transform="translate(50 50)"><g transform="rotate(0)"><path d="M0 3 C-13 -2 -19 -16 -13 -28 C-9 -37 -2 -39 0 -31 C2 -39 9 -37 13 -28 C19 -16 13 -2 0 3Z" fill="url(#' + gradientId + ')"/></g><g transform="rotate(72)"><path d="M0 3 C-13 -2 -19 -16 -13 -28 C-9 -37 -2 -39 0 -31 C2 -39 9 -37 13 -28 C19 -16 13 -2 0 3Z" fill="url(#' + gradientId + ')"/></g><g transform="rotate(144)"><path d="M0 3 C-13 -2 -19 -16 -13 -28 C-9 -37 -2 -39 0 -31 C2 -39 9 -37 13 -28 C19 -16 13 -2 0 3Z" fill="url(#' + gradientId + ')"/></g><g transform="rotate(216)"><path d="M0 3 C-13 -2 -19 -16 -13 -28 C-9 -37 -2 -39 0 -31 C2 -39 9 -37 13 -28 C19 -16 13 -2 0 3Z" fill="url(#' + gradientId + ')"/></g><g transform="rotate(288)"><path d="M0 3 C-13 -2 -19 -16 -13 -28 C-9 -37 -2 -39 0 -31 C2 -39 9 -37 13 -28 C19 -16 13 -2 0 3Z" fill="url(#' + gradientId + ')"/></g><circle cx="0" cy="0" r="7.5" fill="#ffd96b"/><circle cx="-2" cy="-1" r="2.2" fill="#fff2ad"/></g></svg>';
                btn.classList.add('like-bloom-origin');
                layer.appendChild(blossom);

                var cleanup = function() {
                    if (btn._likeBlossom && btn._likeBlossom.node === blossom) btn._likeBlossom = null;
                    if (blossom.parentNode) blossom.remove();
                };
                blossom.addEventListener('animationend', cleanup, { once: true });
                btn._likeBlossom = {
                    node: blossom,
                    timer: setTimeout(cleanup, perfProfile === 'balanced' ? 620 : 820)
                };
            }

            // ===================== 帖子操作弹窗 =====================
            const POST_ACTION_MODAL_IDS = ['commentModal', 'delModal'];

            function resetCommentModalState() {
                var input = document.getElementById("commInp");
                var btn = document.getElementById("commBtn");
                activePostId = null;
                if (input) input.value = "";
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = "发布评论";
                }
            }

            function clearPostActionConfirmOverlay() {
                var overlay = document.getElementById('ppConfirmOverlay');
                var okBtn = document.getElementById('ppConfirmOkBtn');
                if (!overlay) return;
                if (overlay._closeTimer) {
                    clearTimeout(overlay._closeTimer);
                    overlay._closeTimer = null;
                }
                overlay.classList.remove('active');
                overlay.classList.remove('closing');
                overlay.style.opacity = '';
                overlay.style.transition = '';
                overlay.style.pointerEvents = '';
                overlay._ppDeleteOrigin = null;
                window._confirmCallback = null;
                if (okBtn) okBtn.disabled = false;
                var dialog = overlay.querySelector('.pp-confirm-dialog');
                if (dialog) {
                    dialog.style.transition = '';
                    dialog.style.transform = '';
                    dialog.style.opacity = '';
                    dialog.style.transformOrigin = '';
                }
            }

            function isPostActionModalId(id) {
                return POST_ACTION_MODAL_IDS.indexOf(String(id || '')) !== -1;
            }

            function forceClosePostActionModal(id) {
                var el = document.getElementById(id);
                if (el) {
                    el.classList.remove("active");
                    el.classList.remove("closing");
                    el.style.display = '';
                    el.style.pointerEvents = '';
                }
                if (id === 'commentModal') {
                    resetCommentModalState();
                } else if (id === 'delModal') {
                    cleanupDeleteSession({ restoreVisual: true, hideModal: false, resetTarget: true });
                }
            }

            function closeOtherPostActionModals(exceptId) {
                POST_ACTION_MODAL_IDS.forEach(function(id) {
                    if (id !== exceptId) forceClosePostActionModal(id);
                });
                clearPostActionConfirmOverlay();
            }

            function resetPostActionModals() {
                closeOtherPostActionModals('');
            }

            window.openComment = function (postId) {
                if (!currentUser) { showToast("请先登录"); return; }
                if (window.__xtjDeleteInProgress) {
                    if (Date.now() - window.__xtjDeleteStartTime > 12000) {
                        cleanupDeleteSession({ restoreVisual: true, hideModal: true, resetTarget: true });
                    } else {
                        showToast("正在删除中，请稍后..");
                        return;
                    }
                }
                
                var postEl = document.querySelector('.post[data-post-id="' + postId + '"]');
                if (!postEl) return;
                
                // 如果已经存在，则收起（切换显示状态）
                var existingBox = postEl.querySelector('.inline-comment-box');
                if (existingBox) {
                    existingBox.style.gridTemplateRows = '0fr';
                    existingBox.style.opacity = '0';
                    existingBox.style.marginTop = '0px';
                    setTimeout(() => existingBox.remove(), 300);
                    return;
                }
                
                // 移除其他帖子下可能打开的内联输入框，保持界面整洁
                document.querySelectorAll('.inline-comment-box').forEach(function(el) {
                    el.style.gridTemplateRows = '0fr';
                    el.style.opacity = '0';
                    el.style.marginTop = '0px';
                    setTimeout(() => el.remove(), 300);
                });
                
                // 创建内联评论框容器 (带动画)
                var box = document.createElement('div');
                box.className = 'inline-comment-box';
                box.style.display = 'grid';
                box.style.gridTemplateRows = '0fr';
                box.style.opacity = '0';
                box.style.marginTop = '0px';
                box.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
                box.style.background = 'transparent'; // 修复底色不统一的问题
                box.style.borderBottomLeftRadius = '16px';
                box.style.borderBottomRightRadius = '16px';
                
                var gridInner = document.createElement('div');
                gridInner.style.overflow = 'hidden';
                
                var innerWrap = document.createElement('div');
                innerWrap.style.padding = '0px 16px 16px 16px'; // 取消上边距和线，让它自然融入 actions 之下
                innerWrap.style.display = 'flex';
                innerWrap.style.gap = '8px';
                innerWrap.style.alignItems = 'center';
                
                var inp = document.createElement('input');
                inp.type = 'text';
                inp.className = 'inline-comment-inp';
                inp.placeholder = '写下你的想法...';
                inp.style.flex = '1';
                inp.style.padding = '8px 12px';
                inp.style.border = '1px solid var(--border)';
                inp.style.borderRadius = '20px';
                inp.style.background = 'var(--bg-secondary)';
                inp.style.outline = 'none';
                inp.style.fontSize = '14px';
                
                // ★ @ mention autocomplete
                var mentionDropdown = null;
                var mentionActiveIndex = 0;
                function closeMentionDropdown() {
                    if (mentionDropdown && mentionDropdown.parentNode) {
                        mentionDropdown.parentNode.removeChild(mentionDropdown);
                    }
                    mentionDropdown = null;
                    mentionActiveIndex = 0;
                }
                function insertMentionAtCursor(inp, mentionText) {
                    var start = inp.selectionStart || 0;
                    var text = inp.value;
                    // 找到光标前最近的 @ 位置
                    var atPos = -1;
                    for (var i = start - 1; i >= 0; i--) {
                        if (text[i] === '@' || text[i] === '＠') {
                            // 检查 @ 是否在开头、空格后或换行后
                            if (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\n' || text[i - 1] === '\r') {
                                atPos = i;
                                break;
                            }
                        }
                    }
                    if (atPos >= 0) {
                        var before = text.slice(0, atPos);
                        var after = text.slice(start);
                        inp.value = before + mentionText + after;
                        var newCursor = atPos + mentionText.length;
                        inp.setSelectionRange(newCursor, newCursor);
                    }
                    closeMentionDropdown();
                    inp.focus();
                }
                function showMentionDropdown(inp) {
                    var start = inp.selectionStart || 0;
                    var text = inp.value;
                    // 查找光标前最近的 @
                    var atPos = -1;
                    for (var i = start - 1; i >= 0; i--) {
                        if (text[i] === '@' || text[i] === '＠') {
                            if (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\n' || text[i - 1] === '\r') {
                                atPos = i;
                                break;
                            }
                        }
                    }
                    if (atPos < 0) { closeMentionDropdown(); return; }
                    // 检查 @ 后面是否已经有非空内容（排除空格）
                    var afterAt = text.slice(atPos + 1, start);
                    if (afterAt.length > 0 && !/^\s*$/.test(afterAt)) {
                        // 用户已经开始输入了，检查是否匹配"小猫"的前缀
                        if (!'小猫'.startsWith(afterAt) && !'小猫'.includes(afterAt)) {
                            closeMentionDropdown(); return;
                        }
                    }
                    closeMentionDropdown();
                    mentionDropdown = document.createElement('div');
                    mentionDropdown.className = 'mention-dropdown';
                    mentionDropdown.setAttribute('role', 'listbox');
                    mentionDropdown.setAttribute('aria-label', '提及候选');
                    mentionDropdown.innerHTML = 
                        '<div class="mention-item mention-active" role="option" aria-selected="true" id="mention-cat-ai" data-insert="@小猫 ">' +
                        '<span class="mention-avatar">🐱</span>' +
                        '<span class="mention-name">小猫</span>' +
                        '<span class="mention-badge">AI</span>' +
                        '<span class="mention-desc">犀利毒舌回复</span>' +
                        '</div>';
                    mentionActiveIndex = 0;
                    // 定位在输入框下方
                    var rect = inp.getBoundingClientRect();
                    mentionDropdown.style.position = 'fixed';
                    mentionDropdown.style.left = rect.left + 'px';
                    mentionDropdown.style.top = (rect.bottom + 4) + 'px';
                    mentionDropdown.style.minWidth = rect.width + 'px';
                    mentionDropdown.style.zIndex = '99999';
                    document.body.appendChild(mentionDropdown);
                    // 点击选中
                    mentionDropdown.addEventListener('click', function(e) {
                        var item = e.target.closest('.mention-item');
                        if (item) {
                            insertMentionAtCursor(inp, item.getAttribute('data-insert'));
                        }
                    });
                    // 触摸支持
                    mentionDropdown.addEventListener('touchend', function(e) {
                        var item = e.target.closest('.mention-item');
                        if (item) {
                            insertMentionAtCursor(inp, item.getAttribute('data-insert'));
                        }
                    });
                    // 设置 aria-expanded
                    inp.setAttribute('aria-expanded', 'true');
                    inp.setAttribute('role', 'combobox');
                    inp.setAttribute('aria-activedescendant', 'mention-cat-ai');
                }
                function updateMentionActive(delta) {
                    if (!mentionDropdown) return;
                    var items = mentionDropdown.querySelectorAll('.mention-item');
                    if (!items.length) return;
                    items[mentionActiveIndex].classList.remove('mention-active');
                    items[mentionActiveIndex].setAttribute('aria-selected', 'false');
                    mentionActiveIndex = (mentionActiveIndex + delta + items.length) % items.length;
                    items[mentionActiveIndex].classList.add('mention-active');
                    items[mentionActiveIndex].setAttribute('aria-selected', 'true');
                    inp.setAttribute('aria-activedescendant', items[mentionActiveIndex].id || '');
                }
                inp.addEventListener('input', function() {
                    showMentionDropdown(inp);
                });
                inp.addEventListener('keydown', function(e) {
                    // ★ 统一 keydown 处理器：mention dropdown 优先
                    if (mentionDropdown) {
                        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); updateMentionActive(1); return; }
                        if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); updateMentionActive(-1); return; }
                        if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();
                            var items = mentionDropdown.querySelectorAll('.mention-item');
                            if (items[mentionActiveIndex]) {
                                insertMentionAtCursor(inp, items[mentionActiveIndex].getAttribute('data-insert'));
                            }
                            return;
                        }
                        if (e.key === 'Escape') { e.preventDefault(); closeMentionDropdown(); return; }
                    }
                    // ★ 没有 mention dropdown 时，Enter 发送评论
                    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        btn.click();
                    }
                });
                inp.addEventListener('click', function() {
                    showMentionDropdown(inp);
                });
                // 全局关闭（使用命名函数，注释框销毁时移除）
                var _mentionGlobalClick = function(e) {
                    if (mentionDropdown && e.target !== inp && !mentionDropdown.contains(e.target)) {
                        closeMentionDropdown();
                    }
                };
                document.addEventListener('click', _mentionGlobalClick, true);
                // 帖子关闭或重绘时关闭 + 移除全局监听器
                var _origBoxRemove = box.remove;
                box.remove = function() {
                    closeMentionDropdown();
                    document.removeEventListener('click', _mentionGlobalClick, true);
                    _origBoxRemove.call(box);
                };
                
                var btn = document.createElement('button');
                btn.className = 'btn-sm btn-primary';
                btn.textContent = '发送';
                btn.style.borderRadius = '20px';
                btn.style.padding = '6px 14px';
                
                btn.onclick = async function() {
                    if (btn.disabled) return;
                    if (isUserMuted()) { showToast("您已被禁言，无法发表评论"); return; }
                    var content = inp.value.trim();
                    if (!content) { showToast("请输入评论内容"); return; }
                    var targetPostId = String(postId || '').trim().toLowerCase();
                    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(targetPostId)) {
                        showToast("帖子参数无效");
                        return;
                    }
                    
                    btn.disabled = true;
                    btn.textContent = "发送中..";
                    
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 15000);
                    try {
                        const response = await window.xtjProtectedFetch('/api/post/comment', {
                            signal: controller.signal,
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ post_id: targetPostId, content: content })
                        });
                        clearTimeout(timeoutId);
                        const result = await response.json().catch(function() { return {}; });
                        if (!response.ok || !result.ok) throw new Error(result.error || '评论失败');
                        
                        touchUserSession(false);
                        showToast("评论成功");
                        box.style.gridTemplateRows = '0fr';
                        box.style.opacity = '0';
                        box.style.marginTop = '0px';
                        setTimeout(() => box.remove(), 300);
                        
                        var scrollEl = document.getElementById('panelPosts');
                        var savedScroll = scrollEl ? scrollEl.scrollTop : 0;
                        var insertedComment = result.data && String(result.data.post_id) === targetPostId ? result.data : null;
                        
                        if (insertedComment) {
                            feedAllComments = (feedAllComments || []).filter(function(item) {
                                return !(item && item.id != null && String(item.id) === String(insertedComment.id));
                            }).concat([insertedComment]);
                            writeFeedCacheSnapshot();
                            await renderFeedFromMemoryState();
                        } else {
                            await loadFeed(true);
                        }
                        
                        requestAnimationFrame(function() {
                            var p = document.getElementById('panelPosts');
                            if (p && savedScroll > 0) p.scrollTop = savedScroll;
                            var newEl = document.querySelector('.post[data-post-id="' + targetPostId + '"]');
                            if (newEl) newEl.classList.add('visible');
                        });
                        loadProfileActivity(true);
                        
                        // 小猫 AI 自动回复轮询
                        // Phase 3-P0-1: 修复 @小猫 正则。原 lookahead (?=\s|$|[^\w\u4e00-\u9fa5]) 要求
                        // 小猫后跟非汉字字符，导致 @小猫帮我看看 不匹配（"帮"是汉字）。
                        // 改为负向断言 (?![猫])：仅排除 小猫咪，@小猫帮我看看 可匹配。
                        if (content && /[@＠]小猫(?![猫咪])/.test(content) && insertedComment) {
                            pollCatAiReply(insertedComment.id, targetPostId);
                        }
                    } catch (e) {
                        showToast("评论失败: " + (e.message || "未知错误"));
                        btn.disabled = false;
                        btn.textContent = '发送';
                    }
                };

                // ★ 不再使用独立的 inp.onkeydown，统一由 addEventListener 处理
                
                innerWrap.appendChild(inp);
                innerWrap.appendChild(btn);
                gridInner.appendChild(innerWrap);
                box.appendChild(gridInner);
                
                var actionsEl = postEl.querySelector('.actions');
                if (actionsEl) {
                    actionsEl.parentNode.insertBefore(box, actionsEl.nextSibling);
                } else {
                    postEl.appendChild(box);
                }
                
                // 触发展开动画
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        box.style.gridTemplateRows = '1fr';
                        box.style.opacity = '1';
                        box.style.marginTop = '8px';
                    });
                });
                
                setTimeout(() => inp.focus(), 300); // 动画结束后再 focus
            };

            // ===================== 删除帖子 =====================
            // 用 window 挂载，确保不同 IIFE 共享
            if (typeof window.__xtjDeleteInProgress === 'undefined') window.__xtjDeleteInProgress = false;
            if (typeof window.__xtjDeleteStartTime === 'undefined') window.__xtjDeleteStartTime = 0;
            if (!window.__xtjDeleteSession) {
                window.__xtjDeleteSession = {
                    timeoutId: null,
                    postId: null,
                    ownerKey: null,
                    postEl: null,
                    originalOpacity: '',
                    originalPointerEvents: '',
                    originalFilter: ''
                };
            }
            function getDeleteSession() {
                return window.__xtjDeleteSession;
            }
            function restoreDeleteTargetVisual() {
                var session = getDeleteSession();
                if (!session.postEl) return;
                try { session.postEl.style.opacity = session.originalOpacity || ''; } catch (e) {}
                try { session.postEl.style.pointerEvents = session.originalPointerEvents || ''; } catch (e) {}
                try { session.postEl.style.filter = session.originalFilter || ''; } catch (e) {}
                session.postEl = null;
                session.originalOpacity = '';
                session.originalPointerEvents = '';
                session.originalFilter = '';
            }
            function resetDeleteButtonState() {
                var btn = document.getElementById("delBtn");
                if (!btn) return;
                try { btn.disabled = false; } catch (e) {}
                try { btn.textContent = "确认删除"; } catch (e) {}
            }
            function cleanupDeleteSession(options) {
                var opts = options || {};
                var session = getDeleteSession();
                if (session.timeoutId) {
                    clearTimeout(session.timeoutId);
                    session.timeoutId = null;
                }
                if (opts.restoreVisual !== false) {
                    restoreDeleteTargetVisual();
                } else {
                    session.postEl = null;
                    session.originalOpacity = '';
                    session.originalPointerEvents = '';
                    session.originalFilter = '';
                }
                if (opts.hideModal !== false) {
                    var modalEl = document.getElementById("delModal");
                    if (modalEl) modalEl.classList.remove("active");
                }
                if (opts.resetTarget !== false) {
                    delPostId = null;
                    delOwnerKey = null;
                    session.postId = null;
                    session.ownerKey = null;
                }
                resetDeleteButtonState();
                window.__xtjDeleteInProgress = false;
                window.__xtjDeleteStartTime = 0;
                if (opts.toast && typeof showToast === 'function') {
                    showToast(opts.toast);
                }
            }
            function findPostCardElement(postId) {
                return document.querySelector('.post[data-post-id="' + postId + '"]');
            }
            function removeDeletedPostFromFeed(postId) {
                if (!Array.isArray(feedAllPosts)) return;
                feedAllPosts = feedAllPosts.filter(function(post) {
                    return String(post.id) !== String(postId);
                });
            }
            async function confirmPostDeleteStatus(postId) {
                var controller = typeof AbortController === 'function' ? new AbortController() : null;
                var statusTimeoutMs = Number(window.__xtjPostDeleteStatusTimeoutMs) > 0 ? Number(window.__xtjPostDeleteStatusTimeoutMs) : 8000;
                var timer = setTimeout(function() { if (controller) controller.abort(); }, statusTimeoutMs);
                try {
                    var response = await window.xtjProtectedFetch('/api/post/delete-status', {
                        method: 'POST',
                        body: JSON.stringify({ post_id: postId }),
                        signal: controller ? controller.signal : undefined
                    });
                    var result = await response.json().catch(function() { return {}; });
                    if (!response.ok || !result.ok) return { confirmed: false };
                    return { confirmed: true, deleted: result.deleted === true && result.exists === false };
                } catch (_) {
                    return { confirmed: false };
                } finally {
                    clearTimeout(timer);
                }
            }
            // 快速本地检查帖子是否存在（不依赖网络，避免二次超时）
            function quickPostExistsCheck(postId) {
                try {
                    var allPosts = normalizePosts(feedAllPosts);
                    var found = allPosts.find(function(p) { return String(p.id) === String(postId); });
                    if (found) return 'exists';
                    // 如果本地feed中已不存在，视为已删除
                    return 'deleted';
                } catch (_) {
                    return 'unknown';
                }
            }
            function applyConfirmedPostDeletion(postId, session) {
                removeDeletedPostFromFeed(postId);
                if (typeof clearFeedCache === 'function') { try { clearFeedCache(); } catch (e) {} }

                // 乐观删除动画：透明度+位移+高度收缩，180-220ms
                if (session.postEl && session.postEl.parentNode) {
                    var el = session.postEl;
                    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    if (reducedMotion) {
                        try { el.remove(); } catch (e) {}
                    } else {
                        el.style.transition = 'opacity 200ms ease, transform 200ms ease, max-height 200ms ease, margin 200ms ease, padding 200ms ease';
                        el.style.opacity = '0';
                        el.style.transform = 'translateY(-8px) scale(0.98)';
                        el.style.maxHeight = '0';
                        el.style.overflow = 'hidden';
                        el.style.margin = '0';
                        el.style.padding = '0';
                        el.style.border = 'none';
                        el.style.pointerEvents = 'none';
                        var onTransitionEnd = function() {
                            try { el.remove(); } catch (e) {}
                            el.removeEventListener('transitionend', onTransitionEnd);
                        };
                        el.addEventListener('transitionend', onTransitionEnd);
                        // 兜底：250ms 后强制移除
                        setTimeout(function() {
                            try { if (el.parentNode) el.remove(); } catch (e) {}
                        }, 250);
                    }
                }

                if (typeof updateFeedStats === 'function') { try { updateFeedStats(); } catch (e) {} }
                cleanupDeleteSession({ restoreVisual: false, hideModal: true, resetTarget: true });
                showToast("帖子已删除");
                // 不再调用 loadFeed(true)，避免整页重建和闪白
            }
            window.openDelete = function (postId, ownerKey) {
                // ★ 入口强制解锁：超过 12 秒仍处于 in-progress 状态，强制重置（防卡死兜底）
                if (window.__xtjDeleteInProgress && Date.now() - window.__xtjDeleteStartTime > 12000) {
                    console.warn('[openDelete] 检测到上一次删除超时卡死，强制解锁');
                    cleanupDeleteSession({ restoreVisual: true, hideModal: true, resetTarget: true });
                }
                if (window.__xtjDeleteInProgress) {
                    showToast("正在删除中，请稍后..");
                    return;
                }
                var targetPost = normalizePosts(feedAllPosts).find(function(post) { return String(post.id) === String(postId); });
                if (targetPost && !canDeletePost(targetPost)) {
                    showToast("无权删除这条帖子");
                    return;
                }
                delPostId = postId;
                delOwnerKey = ownerKey;
                var session = getDeleteSession();
                session.postId = postId;
                session.ownerKey = ownerKey;
                closeOtherPostActionModals('delModal');
                openModal("delModal");
            };
            var delBtn = document.getElementById("delBtn");
            if (delBtn) delBtn.onclick = async () => {
                if (!delPostId) return;
                // ★ 入口强制解锁（同 openDelete）
                if (window.__xtjDeleteInProgress && Date.now() - window.__xtjDeleteStartTime > 12000) {
                    cleanupDeleteSession({ restoreVisual: true, hideModal: true, resetTarget: true });
                }
                if (window.__xtjDeleteInProgress) return;
                const btn = document.getElementById("delBtn");
                const session = getDeleteSession();
                const targetPostId = String(delPostId);
                const currentPost = normalizePosts(feedAllPosts).find(function(post) { return String(post.id) === targetPostId; });
                if (currentPost && !canDeletePost(currentPost)) {
                    cleanupDeleteSession({ toast: "无权删除这条帖子" });
                    return;
                }
                window.__xtjDeleteInProgress = true;
                window.__xtjDeleteStartTime = Date.now();
                btn.disabled = true;
                btn.textContent = "删除中..";
                var finished = false;
                session.postEl = findPostCardElement(targetPostId);
                if (session.postEl) {
                    session.originalOpacity = session.postEl.style.opacity || '';
                    session.originalPointerEvents = session.postEl.style.pointerEvents || '';
                    session.originalFilter = session.postEl.style.filter || '';
                    session.postEl.style.opacity = '0.56';
                    session.postEl.style.pointerEvents = 'none';
                    session.postEl.style.filter = 'grayscale(0.08)';
                }
                session.timeoutId = setTimeout(function() {
                    if (finished) return;
                    console.warn('[delBtn] delete flow exceeded safety deadline');
                    finished = true;
                    cleanupDeleteSession({ toast: "删除状态确认超时，请刷新后重试" });
                    // 不再调用 loadFeed(true)，防止整页重建
                }, 30000);

                try {
                    var deleteController = typeof AbortController === 'function' ? new AbortController() : null;
                    var deleteTimedOut = false;
                    var deleteTimeoutMs = Number(window.__xtjPostDeleteRequestTimeoutMs) > 0 ? Number(window.__xtjPostDeleteRequestTimeoutMs) : 10000;
                    var deleteTimer = setTimeout(function() {
                        deleteTimedOut = true;
                        if (deleteController) deleteController.abort();
                    }, deleteTimeoutMs);
                    let deleteResponse;
                    try {
                        deleteResponse = await window.xtjProtectedFetch('/api/post/delete', {
                            method: 'POST',
                            body: JSON.stringify({ post_id: targetPostId }),
                            signal: deleteController ? deleteController.signal : undefined
                        });
                    } catch (raceErr) {
                        if (finished) return;
                        if (deleteTimedOut) {
                            console.warn('[delBtn] delete request timed out; checking locally');
                            // The delete request may have reached the server before this
                            // browser timed out. Confirm with the authoritative endpoint
                            // before deciding whether to restore the optimistic UI.
                            var authoritativeStatus = await confirmPostDeleteStatus(targetPostId);
                            if (finished) return;
                            finished = true;
                            if (authoritativeStatus.confirmed && authoritativeStatus.deleted) {
                                applyConfirmedPostDeletion(targetPostId, session);
                            } else {
                                cleanupDeleteSession({ toast: "删除超时，帖子仍然存在，请重试" });
                            }
                            return;
                            // 说明：原先此处有"快速本地检查"兜底，但被上方 return 短路成为死代码。
                            // 超时后必须以权威接口 confirmPostDeleteStatus 的结果为准（避免误删/误恢复），
                            // 本地缓存检查不可靠，故移除。
                            // [dead code removed - quickPostExistsCheck local fallback]
                        }
                        throw raceErr;
                    } finally {
                        clearTimeout(deleteTimer);
                    }
                    if (finished) return;
                    const deleteResult = await deleteResponse.json().catch(function() { return {}; });
                    if (!deleteResponse.ok || !deleteResult.ok || (!deleteResult.deleted && !deleteResult.already_deleted)) {
                        finished = true;
                        cleanupDeleteSession({ toast: "删除失败: " + (deleteResult.error || "服务器未确认删除") });
                        return;
                    }
                    finished = true;
                    applyConfirmedPostDeletion(targetPostId, session);
                } catch (e) {
                    if (finished) return;
                    console.error('[delBtn] 删除异常:', e);
                    finished = true;
                    // 恢复目标帖子视觉状态
                    if (session.postEl) {
                        try {
                            session.postEl.style.opacity = session.originalOpacity || '';
                            session.postEl.style.pointerEvents = session.originalPointerEvents || '';
                            session.postEl.style.filter = session.originalFilter || '';
                            session.postEl.style.transition = '';
                            session.postEl.style.transform = '';
                            session.postEl.style.maxHeight = '';
                            session.postEl.style.overflow = '';
                            session.postEl.style.margin = '';
                            session.postEl.style.padding = '';
                            session.postEl.style.border = '';
                        } catch(e) {}
                    }
                    cleanupDeleteSession({ toast: "删除帖子失败: " + (e && e.message || "未知错误"), restoreVisual: false });
                } finally {
                    if (!finished) {
                        cleanupDeleteSession({ restoreVisual: true, hideModal: false, resetTarget: false });
                    }
                }
            };

            window.openModal = function (id) {
                var el = document.getElementById(id);
                if (!el) return;
                if (isPostActionModalId(id)) {
                    closeOtherPostActionModals(id);
                }
                el.style.display = '';
                el.classList.add("active");
            };

            window.closeModal = function (id) {
                var el = document.getElementById(id);
                if (!el) return;
                if (isPostActionModalId(id)) {
                    forceClosePostActionModal(id);
                } else {
                    el.classList.remove("active");
                }
                // 删除弹窗取消时立即清理，不播放动画
                if (id === 'delModal') {
                    cleanupDeleteSession({ restoreVisual: true, hideModal: true, resetTarget: true });
                }
                if (id === 'loginModal' || id === 'registerModal') {
                    if (authModalFocusOrigin && typeof authModalFocusOrigin.focus === 'function') {
                        try { authModalFocusOrigin.focus(); } catch (_) {}
                    }
                    authModalFocusOrigin = null;
                }
                if (id === 'statModal' && statPollTimer) {
                    clearInterval(statPollTimer);
                    statPollTimer = null;
                }
            };
            resetPostActionModals();

            // ===================== 图片查看器 =====================
            const ivZoomState = { scale: 1, tx: 0, ty: 0 };
            let ivIsZooming = false;
            let ivIsPanning = false;
            let ivLastDist = 0;
            let ivPanStartX = 0, ivPanStartY = 0;
            let ivStartTx = 0, ivStartTy = 0;
            let ivStartScale = 1;
            let ivPinchAnchorX = 0, ivPinchAnchorY = 0;
            let ivLastTapTime = 0;
            let ivDoubleTapTimer = null;
            let ivHintTimer = null;
            let ivTouchEndTime = 0;

            function ivApplyTransform() {
                const img = document.getElementById('ivImg');
                if (!img) return;
                const v = ivZoomState;
                const t = `translate3d(${v.tx}px, ${v.ty}px, 0) scale(${v.scale})`;
                img.style.transform = t;
                img.style.webkitTransform = t;
            }

            function ivResetZoom(instant = false) {
                const img = document.getElementById('ivImg');
                if (!img) return;
                ivZoomState.scale = 1;
                ivZoomState.tx = 0;
                ivZoomState.ty = 0;
                if (instant) {
                    img.classList.add('instant');
                    img.style.transform = '';
                    img.style.webkitTransform = '';
                    void img.offsetWidth;
                    img.classList.remove('instant');
                } else {
                    img.style.transform = '';
                    img.style.webkitTransform = '';
                }
            }

            function ivZoomAt(clientX, clientY, nextScale) {
                const oldScale = ivZoomState.scale || 1;
                const x = clientX == null ? window.innerWidth / 2 : clientX;
                const y = clientY == null ? window.innerHeight / 2 : clientY;
                const anchorX = (x - window.innerWidth / 2 - ivZoomState.tx) / oldScale;
                const anchorY = (y - window.innerHeight / 2 - ivZoomState.ty) / oldScale;
                ivZoomState.scale = Math.max(1, Math.min(6, nextScale));
                ivZoomState.tx = x - window.innerWidth / 2 - anchorX * ivZoomState.scale;
                ivZoomState.ty = y - window.innerHeight / 2 - anchorY * ivZoomState.scale;
                if (ivZoomState.scale <= 1.01) {
                    ivResetZoom(false);
                } else {
                    ivApplyTransform();
                    ivShowHint();
                }
            }

            function ivShowHint() {
                const h = document.getElementById('ivZoomHint');
                if (!h) return;
                h.classList.add('show');
                clearTimeout(ivHintTimer);
                ivHintTimer = setTimeout(() => h.classList.remove('show'), 2000);
            }

            function buildPostPreviewItemFromTrigger(src, triggerEl) {
                var el = triggerEl && triggerEl.getAttribute ? triggerEl : null;
                if (!el) return null;
                var postId = String(el.getAttribute('data-post-id') || '').trim();
                if (!postId) return null;
                var userName = String(el.getAttribute('data-post-user') || '').trim();
                var createdAt = String(el.getAttribute('data-post-created-at') || '').trim();
                var views = Number(el.getAttribute('data-post-views') || 0) || 0;
                var fileSize = Number(el.getAttribute('data-file-size') || 0) || null;
                var originalSize = Number(el.getAttribute('data-original-size') || 0) || null;
                return {
                    id: 'post_' + postId,
                    imageUrl: sanitizeUrl(src || el.getAttribute('src') || ''),
                    thumbUrl: sanitizeUrl(src || el.getAttribute('src') || ''),
                    username: userName || '',
                    timestamp: createdAt || '',
                    views: views,
                    fileSize: fileSize,
                    originalSize: originalSize,
                    __xtjSource: 'post',
                    __xtjPostId: postId,
                    __xtjActorKey: String(el.getAttribute('data-actor-key') || ''),
                    __xtjCanDelete: String(el.getAttribute('data-can-delete') || '') === '1'
                };
            }

            function syncPostPhotoPreviewChrome(photo) {
                var overlay = document.getElementById('photoPreviewOverlay');
                if (!overlay) return;
                var isPostPhoto = !!(photo && photo.__xtjSource === 'post');
                overlay.classList.toggle('pp-post-mode', isPostPhoto);
                var prevBtn = document.getElementById('ppPrevBtn');
                var nextBtn = document.getElementById('ppNextBtn');
                if (prevBtn) prevBtn.style.display = isPostPhoto ? 'none' : '';
                if (nextBtn) nextBtn.style.display = isPostPhoto ? 'none' : '';
                var deleteBtn = document.getElementById('ppDeleteBtn');
                if (deleteBtn && isPostPhoto) {
                    deleteBtn.style.display = photo.__xtjCanDelete ? 'flex' : 'none';
                    deleteBtn.title = '删除帖子';
                }
            }

            function ensurePhotoPreviewContextHooks() {
                if (window.__xtjPhotoPreviewContextHooked) return;
                if (typeof window.closePhotoPreview !== 'function') return;
                var originalClosePhotoPreview = window.closePhotoPreview;
                window.closePhotoPreview = function() {
                    var overlay = document.getElementById('photoPreviewOverlay');
                    if (overlay) overlay.classList.remove('pp-post-mode');
                    window.__xtjPhotoPreviewContext = null;
                    return originalClosePhotoPreview.apply(this, arguments);
                };
                window.__xtjPhotoPreviewContextHooked = true;
            }

            function openPostImagePreview(src, triggerEl) {
                var photo = buildPostPreviewItemFromTrigger(src, triggerEl);
                if (!photo || !photo.imageUrl || typeof window.openPhotoPreview !== 'function') return false;
                ensurePhotoPreviewContextHooks();
                if (typeof window.closeImageViewer === 'function') {
                    try { window.closeImageViewer(); } catch (e) {}
                }
                window.__xtjPhotoPreviewContext = {
                    kind: 'post',
                    postId: photo.__xtjPostId,
                    actorKey: photo.__xtjActorKey || '',
                    canDelete: !!photo.__xtjCanDelete
                };
                window.openPhotoPreview(0, { photos: [photo], originEl: triggerEl && triggerEl.getBoundingClientRect ? triggerEl : null });
                window.photoPreviewCurrent = photo;
                setTimeout(function() {
                    syncPostPhotoPreviewChrome(photo);
                }, 30);
                return true;
            }
            window.openPostImagePreview = openPostImagePreview;

            window.openImageViewer = function (src, triggerEl) {
                function fallbackOpen() {
                    if (typeof window.forceClosePhotoPreview === 'function') {
                        try { window.forceClosePhotoPreview(); } catch (e) {}
                    } else if (typeof window.closePhotoPreview === 'function') {
                        try { window.closePhotoPreview(); } catch (e) {}
                    }
                    const viewer = document.getElementById('imgViewer');
                    const img = document.getElementById('ivImg');
                    const wrapper = document.getElementById('ivWrapper');
                    ivResetZoom(true);
                    img.src = src;
                    wrapper.classList.add('open-anim');
                    viewer.classList.add('img-transition');
                    img.classList.add('instant');
                    void img.offsetWidth;
                    img.classList.remove('instant');
                    viewer.classList.add('active');
                    setTimeout(function() { viewer.classList.add('show'); }, 10);
                    document.body.style.overflow = 'hidden';
                }
                if ((typeof window.openPhotoPreview !== 'function' || window.openPhotoPreview === lazyOpenPhotoPreview) && typeof ensurePhotoWallPreviewLoaded === 'function') {
                    ensurePhotoWallPreviewLoaded().then(function() {
                        if (!openPostImagePreview(src, triggerEl)) fallbackOpen();
                    }).catch(function() {
                        fallbackOpen();
                    });
                    return;
                }
                if (openPostImagePreview(src, triggerEl)) return;
                fallbackOpen();
            };

            window.closeImageViewer = function () {
                const viewer = document.getElementById('imgViewer');
                const wrapper = document.getElementById('ivWrapper');
                ivResetZoom(true);
                wrapper.classList.remove('open-anim');
                viewer.classList.remove('show');
                setTimeout(function() {
                    viewer.classList.remove('active');
                    viewer.classList.remove('img-transition');
                }, 300);
                document.body.style.overflow = '';
            };

            window.deleteCurrentPhoto = function() {
                var ctx = window.__xtjPhotoPreviewContext || null;
                var current = window.photoPreviewCurrent || null;
                if (ctx && ctx.kind === 'post' && current && current.__xtjSource === 'post') {
                    if (!ctx.canDelete) {
                        showToast('仅发布者可删除');
                        return;
                    }
                    if (typeof window.closePhotoPreview === 'function') window.closePhotoPreview();
                    setTimeout(function() {
                        openDelete(ctx.postId, ctx.actorKey || '');
                    }, 60);
                    return;
                }
                if (typeof window.deletePhotoFromPreview === 'function') {
                    window.deletePhotoFromPreview();
                }
            };

            document.addEventListener('keydown', function (e) {
                if (e.key !== 'Escape') return;
                var iv = document.getElementById('imgViewer');
                if (iv && iv.classList.contains('active')) { closeImageViewer(); return; }
                var am = document.getElementById('announcementModal');
                if (am && am.classList.contains('active')) { closeAnnouncementModal(); return; }
                var sm = document.getElementById('statModal');
                if (sm && sm.classList.contains('active')) { sm.classList.remove('active'); return; }
                var cm = document.getElementById('commentModal');
                if (cm && cm.classList.contains('active')) { closeModal('commentModal'); return; }
            });

            const ivViewerEl = document.getElementById('imgViewer');
            const ivImgEl = document.getElementById('ivImg');

            // 判空保护：图片查看器元素缺失时跳过绑定，不得中断 core.js 后续逻辑
            if (ivViewerEl) {
            ivViewerEl.addEventListener('click', function (e) {
                if (Date.now() - ivTouchEndTime < 120) return;
                if (e.target === ivViewerEl || e.target === document.getElementById('ivWrapper')) {
                    closeImageViewer();
                }
            });

            ivViewerEl.addEventListener('contextmenu', function (e) {
                e.preventDefault();
            });

            ivViewerEl.addEventListener('touchstart', function (e) {
                if (e.target.closest('.iv-close')) return;
                if (e.touches.length === 2) {
                    e.preventDefault();
                    ivIsZooming = true;
                    const t = e.touches;
                    ivLastDist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
                    ivStartTx = ivZoomState.tx;
                    ivStartTy = ivZoomState.ty;
                    ivStartScale = ivZoomState.scale;
                    const cx = (t[0].clientX + t[1].clientX) / 2;
                    const cy = (t[0].clientY + t[1].clientY) / 2;
                    ivPinchAnchorX = (cx - window.innerWidth / 2 - ivStartTx) / ivStartScale;
                    ivPinchAnchorY = (cy - window.innerHeight / 2 - ivStartTy) / ivStartScale;
                    ivImgEl.classList.add('instant');
                } else if (e.touches.length === 1) {
                    const now = Date.now();
                    if (now - ivLastTapTime < 320) {
                        clearTimeout(ivDoubleTapTimer);
                        ivLastTapTime = 0;
                        if (ivZoomState.scale > 1.5) {
                            ivResetZoom(false);
                        } else {
                            ivZoomAt(e.touches[0].clientX, e.touches[0].clientY, 2.5);
                        }
                        return;
                    }
                    ivLastTapTime = now;
                    ivDoubleTapTimer = setTimeout(() => { ivLastTapTime = 0; }, 350);

                    if (ivZoomState.scale > 1) {
                        ivIsPanning = true;
                        ivPanStartX = e.touches[0].clientX;
                        ivPanStartY = e.touches[0].clientY;
                        ivStartTx = ivZoomState.tx;
                        ivStartTy = ivZoomState.ty;
                        ivImgEl.classList.add('instant');
                    }
                }
            }, { passive: false });

            var _ivMoveTicking = false;
            ivViewerEl.addEventListener('touchmove', function (e) {
                if (ivIsZooming && e.touches.length === 2) {
                    e.preventDefault();
                    const t = e.touches;
                    const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
                    const totalRatio = dist / ivLastDist;
                    const newScale = Math.max(1, Math.min(6, ivStartScale * totalRatio));
                    const cx = (t[0].clientX + t[1].clientX) / 2;
                    const cy = (t[0].clientY + t[1].clientY) / 2;
                    ivZoomState.scale = newScale;
                    ivZoomState.tx = cx - window.innerWidth / 2 - ivPinchAnchorX * newScale;
                    ivZoomState.ty = cy - window.innerHeight / 2 - ivPinchAnchorY * newScale;
                    if (!_ivMoveTicking) {
                        _ivMoveTicking = true;
                        requestAnimationFrame(function() {
                            ivApplyTransform();
                            ivShowHint();
                            _ivMoveTicking = false;
                        });
                    }
                } else if (ivIsPanning && e.touches.length === 1) {
                    e.preventDefault();
                    const dx = e.touches[0].clientX - ivPanStartX;
                    const dy = e.touches[0].clientY - ivPanStartY;
                    ivZoomState.tx = ivStartTx + dx;
                    ivZoomState.ty = ivStartTy + dy;
                    if (!_ivMoveTicking) {
                        _ivMoveTicking = true;
                        requestAnimationFrame(function() {
                            ivApplyTransform();
                            _ivMoveTicking = false;
                        });
                    }
                }
            }, { passive: false });

            ivViewerEl.addEventListener('touchend', function (e) {
                ivTouchEndTime = Date.now();
                if (ivIsZooming) {
                    ivIsZooming = false;
                    if (ivZoomState.scale <= 1) {
                        ivImgEl.classList.remove('instant');
                        ivResetZoom(false);
                    } else {
                        setTimeout(() => ivImgEl.classList.remove('instant'), 50);
                    }
                }
                if (ivIsPanning) {
                    ivIsPanning = false;
                    ivImgEl.classList.remove('instant');
                }
            });

            ivViewerEl.addEventListener('wheel', function (e) {
                if (!ivViewerEl.classList.contains('active')) return;
                e.preventDefault();
                const delta = -e.deltaY * 0.002;
                const newScale = Math.max(1, Math.min(6, ivZoomState.scale * (1 + delta)));
                if (newScale === ivZoomState.scale) return;
                const cx = e.clientX;
                const cy = e.clientY;
                const ratio = newScale / ivZoomState.scale;
                ivZoomState.tx = cx - ratio * (cx - ivZoomState.tx);
                ivZoomState.ty = cy - ratio * (cy - ivZoomState.ty);
                ivZoomState.scale = newScale;
                ivApplyTransform();
                ivShowHint();
                if (ivZoomState.scale <= 1) {
                    ivResetZoom(true);
                }
            }, { passive: false });
            } // end if (ivViewerEl)

            // ===================== 浏览历史缓存 =====================
            // 帖子信息缓存：用于浏览历史与媒体标签
            const postInfoCache = {};
            // 挂到 window：登出清理 clearAllAuthState 中 window.postInfoCache 清理依赖此引用
            window.postInfoCache = postInfoCache;
            const VIEW_HISTORY_KEY = 'xtj_view_history';
            const VIEW_TRACK_TTL = 5 * 60 * 1000;
            const VIEW_HISTORY_MEDIA_LABEL = '(\u56fe\u7247/\u89c6\u9891)';
            const VIEW_HISTORY_DELETED_AUTHOR = '\u5df2\u5220\u9664\u7528\u6237';

            function normalizeViewHistoryText(value, fallback) {
                var text = String(value == null ? '' : value).trim();
                if (!text) return fallback;
                // ★ 修复：媒体标记检测关键词此前为编码损坏的乱码（永不匹配），
                // 替换为正常中文关键词，使媒体帖子的历史标签能正确显示
                if (text.indexOf('图片') !== -1 || text.indexOf('视频') !== -1 || text.indexOf('音频') !== -1 || text.indexOf('(图片/视频)') !== -1) return VIEW_HISTORY_MEDIA_LABEL;
                // ★ 修复：已删除用户标记检测关键词同上（乱码→正常中文）
                if (text.indexOf('已删除') !== -1 || text.indexOf('未知') !== -1) return VIEW_HISTORY_DELETED_AUTHOR;
                // 兼容旧数据：如果存储的是原始 JSON，解析出 text 字段
                if (text.startsWith('{') && text.indexOf('"__type"') !== -1) {
                    try { var pc = JSON.parse(text); if (pc && pc.text !== undefined) return pc.text || fallback; } catch(e) {}
                }
                return text;
            }

            function normalizeViewHistoryEntry(entry) {
                entry = entry || {};
                return Object.assign({}, entry, {
                    user_name: String(entry.user_name || '').trim(),
                    post_id: entry.post_id,
                    post_content: normalizeViewHistoryText(entry.post_content, VIEW_HISTORY_MEDIA_LABEL),
                    post_author: normalizeViewHistoryText(entry.post_author, VIEW_HISTORY_DELETED_AUTHOR),
                    media_url: String(entry.media_url || '').trim(),
                    media_type: String(entry.media_type || '').trim(),
                    viewed_at: entry.viewed_at || new Date().toISOString()
                });
            }

            function shouldKeepViewHistoryEntry(entry) {
                var viewer = String(entry && entry.user_name || '').trim();
                var author = String(entry && entry.post_author || '').trim();
                if (!viewer || !author || viewer === author) return false;
                // 过滤系统日志 marker，不允许在前台总浏览弹窗显示
                var mediaType = String(entry && entry.media_type || '').trim();
                if (/^__.*__$/.test(mediaType)) return false; // 以双下划线开头&结尾的系统记录
                // 过滤原始 JSON 字符串（device_id、ip、user_agent 等敏感信息不应出现在前台）
                var postContent = String(entry && entry.post_content || '');
                if (postContent.indexOf('"device_id"') !== -1 && postContent.indexOf('"ip"') !== -1) return false;
                if (postContent.indexOf('"browser_fingerprint_hash"') !== -1) return false;
                if (postContent.indexOf('"canvas_fingerprint_hash"') !== -1) return false;
                if (postContent.indexOf('"webgl_fingerprint_hash"') !== -1) return false;
                if (postContent.indexOf('"webrtc_local_ips"') !== -1) return false;
                return true;
            }

            function getViewHistory() {
                try {
                    var history = window.safeLocalStorageGetJSON(VIEW_HISTORY_KEY, []);
                    var changed = false;
                    var normalized = Array.isArray(history) ? history.map(function(entry) {
                        var next = normalizeViewHistoryEntry(entry);
                        if (!changed && JSON.stringify(next) !== JSON.stringify(entry || {})) changed = true;
                        return next;
                    }) : [];
                    var filtered = normalized.filter(function(entry) {
                        var keep = shouldKeepViewHistoryEntry(entry);
                        if (!keep) changed = true;
                        return keep;
                    });
                    if (changed) {
                        window.safeStorage.set(VIEW_HISTORY_KEY, JSON.stringify(filtered));
                    }
                    return filtered;
                } catch(e) { return []; }
            }

            function saveViewHistory(entry) {
                const history = getViewHistory();
                // 避免重复记录相同 post_id + user_name 的浏览记录
                const exists = history.some(h => h.post_id === entry.post_id && h.user_name === entry.user_name);
                if (!exists) {
                    history.unshift(normalizeViewHistoryEntry(entry));
                    // 只保留最近 500 条
                    if (history.length > 500) history.length = 500;
                    window.safeStorage.set(VIEW_HISTORY_KEY, JSON.stringify(history));
                }
            }

            function trackView(postId) {
                const key = `xtj_v_${postId}`;
                if (!window.safeStorage.get(key) && !viewTracked.has(postId)) {
                    viewTracked.add(postId);
                    window.safeStorage.set(key, "1");
                    var postEl = document.querySelector('.post[data-post-id="' + postId + '"]');
                    if (postEl) {
                        var statsEl = postEl.querySelector('.post-stats-text');
                        if (statsEl) {
                            var vm = statsEl.textContent.match(/浏览 (\d+)/);
                            if (vm) {
                                var newVal = parseInt(vm[1]) + 1;
                                statsEl.textContent = statsEl.textContent.replace(/浏览 \d+/, '浏览 ' + newVal);
                            }
                        }
                    }
                    if (currentUser && postInfoCache[postId]) {
                        var rawContent = postInfoCache[postId].content || '';
                        var displayContent = rawContent;
                        try { var pc = JSON.parse(rawContent); if (pc && pc.__type && pc.text !== undefined) { displayContent = pc.text; } } catch(e) {}
                        saveViewHistory({
                            user_name: currentUser,
                            post_id: postId,
                            post_content: displayContent.length > 200 ? displayContent.slice(0, 200) + '...' : (displayContent || '(图片/视频)'),
                            post_author: postInfoCache[postId].user_name || '未知',
                            media_url: postInfoCache[postId].media_url || '',
                            media_type: postInfoCache[postId].media_type || '',
                            viewed_at: new Date().toISOString()
                        });
                    }
                    setTimeout(async () => { 
                        try { 
                            await sb.rpc("increment_post_views", { p_post_id: postId }); 
                        } catch(e){ console.error(e); } 
                    }, 1000);
                    updateFeedStats();
                }
            }

            // ===================== 浏览历史加载 =====================
            // 保存浏览历史：分页加载相关变量
            saveViewHistory = function(entry) {
                const history = getViewHistory();
                var normalized = normalizeViewHistoryEntry(entry);
                var postId = String(normalized.post_id || normalized.postId || '').trim();
                var userName = String(normalized.user_name || normalized.userName || '').trim();
                // 去重：相同 post_id + user_name 的记录不重复添加
                var exists = postId ? history.some(function(h) {
                    return String(h.post_id || h.postId || '') === postId &&
                           String(h.user_name || h.userName || '') === userName;
                }) : false;
                if (!exists) {
                    history.unshift(normalized);
                    if (history.length > 500) history.length = 500;
                    window.safeStorage.set(VIEW_HISTORY_KEY, JSON.stringify(history));
                }
            };

            function canTrackViewNow(postId) {
                const key = `xtj_v_${postId}`;
                const now = Date.now();
                var last = 0;
                try { last = Number(window.safeStorage.get(key) || 0); } catch (e) { last = 0; }
                if (viewTracked.has(postId) && now - last < VIEW_TRACK_TTL) return false;
                if (last && now - last < VIEW_TRACK_TTL) return false;
                return true;
            }

            trackView = function(postId) {
                const key = `xtj_v_${postId}`;
                if (!canTrackViewNow(postId)) return false;
                // ★ 修复：未登录时不记录浏览——静默返回（此前 throw + console.error
                // 导致每次滚动浏览都报错刷屏，且删除节流标记造成无限重复触发）。
                if (!currentUser || typeof window.xtjProtectedFetch !== 'function') return false;
                viewTracked.add(postId);
                // ★ 修复：请求发出前先写节流键，防止键仅成功后写入期间
                // 1 秒内重复触发并发 POST（在途请求保护）
                window.safeStorage.set(key, String(Date.now()));
                setTimeout(async () => {
                    try {
                        if (!currentUser || typeof window.xtjProtectedFetch !== 'function') throw new Error('view_auth_required');
                        var response = await window.xtjProtectedFetch('/api/post/view', {
                            method: 'POST',
                            body: JSON.stringify({ post_id: String(postId) })
                        });
                        var result = await response.json().catch(function() { return {}; });
                        if (!response.ok || !result.ok) throw new Error(result.error || 'view_record_failed');
                        var authoritativeViews = Number(result.views);
                        if (Number.isFinite(authoritativeViews)) {
                            var postEl = document.querySelector('.post[data-post-id="' + postId + '"]');
                            var statsEl = postEl && postEl.querySelector('.post-stats-text');
                            if (statsEl) statsEl.textContent = statsEl.textContent.replace(/\d+/, String(authoritativeViews));
                            if (Array.isArray(feedAllPosts)) {
                                feedAllPosts = feedAllPosts.map(function(post) {
                                    return post && String(post.id) === String(postId) ? Object.assign({}, post, { views: authoritativeViews }) : post;
                                });
                                if (typeof writeFeedCacheSnapshot === 'function') writeFeedCacheSnapshot();
                            }
                            if (postInfoCache[postId]) postInfoCache[postId].views = authoritativeViews;
                        }
                        window.safeStorage.set(key, String(Date.now()));
                        if (result.recorded && currentUser && postInfoCache[postId]) {
                            var cachedPost = postInfoCache[postId];
                            var rawContent = cachedPost.content || '';
                            var displayContent = rawContent;
                            try { var pc = JSON.parse(rawContent); if (pc && pc.__type && pc.text !== undefined) { displayContent = pc.text; } } catch(e) {}
                            saveViewHistory({ user_name: currentUser, post_id: postId,
                                post_content: displayContent.length > 200 ? displayContent.slice(0, 200) + '...' : (displayContent || VIEW_HISTORY_MEDIA_LABEL),
                                post_author: cachedPost.user_name || VIEW_HISTORY_DELETED_AUTHOR,
                                media_url: cachedPost.media_url || '', media_type: cachedPost.media_type || '',
                                viewed_at: result.viewed_at || new Date().toISOString() });
                        }
                        updateFeedStats();
                    } catch (e) {
                        viewTracked.delete(postId);
                        try { window.safeStorage.remove(key); } catch (_) {}
                        console.error(e);
                    }
                }, 1000);
                return true;
            };
            window.xtjTrackPostView = trackView;
            window.xtjCanTrackPostView = canTrackViewNow;
            window.xtjGetPostById = function(postId) {
                var found = Array.isArray(feedAllPosts) ? feedAllPosts.find(function(post) {
                    return post && String(post.id) === String(postId);
                }) : null;
                return found || postInfoCache[postId] || null;
            };

            let feedPage = 1;
            const FEED_PAGE_SIZE = 20;
            let feedEndReached = false;
            let feedAllPosts = [];
            let feedAllComments = [];
            let feedAllLikes = [];
            let feedScrollObserver = null;
            let feedLoadRequestId = 0;
            let feedStateVersion = 0;
            let feedNextOffset = 0;
            let feedLoadedPages = [];
            let feedPageFetchPending = false;
            // ★ 修复：加载更多失败后置位，哨兵不再自动触发（防无限重复请求），
            // 需用户点击错误提示"重试"才清除并重新加载
            let feedLoadMoreFailed = false;

            function markFeedStateChanged() {
                feedStateVersion += 1;
                feedVisiblePostsCache = null;
                feedMapsCache = null;
                return feedStateVersion;
            }

            function syncPostInfoCache(post) {
                var normalized = normalizePost(post || {});
                if (!normalized || !normalized.id) return;
                postInfoCache[normalized.id] = {
                    id: normalized.id,
                    content: normalized.content || '',
                    user_name: normalized.user_name || '',
                    media_url: normalized.media_url || '',
                    media_type: normalized.media_type || '',
                    created_at: normalized.created_at || '',
                    views: Number(normalized.views || 0)
                };
            }
            let feedVisiblePostsCache = null; // 缓存过滤后的帖子
            let feedMapsCache = null; // 缓存 buildPostMaps 结果

            // 无限滚动监听

            // 无限滚动监听
            function setupFeedInfiniteScroll() {
                if (feedScrollObserver) feedScrollObserver.disconnect();
                
                const feed = document.getElementById('feed');
                const observer = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting && !feedEndReached && !feedLoadMoreFailed) {
                            loadMoreFeedPosts();
                        }
                    });
                }, { rootMargin: '200px' });
                
                // 在 feed 底部添加哨兵元素（sentinel）
                let sentinel = document.getElementById('feedSentinel');
                if (!sentinel) {
                    sentinel = document.createElement('div');
                    sentinel.id = 'feedSentinel';
                    sentinel.style.height = '1px';
                    feed.appendChild(sentinel);
                }
                observer.observe(sentinel);
                feedScrollObserver = observer;
            }


            // 构建帖子评论/点赞映射（用于渲染）
            function buildPostMaps(comments, likes) {
                const commentMap = {};
                const likeMap = {};
                const likeUserMap = {};

                comments.forEach(c => {
                    if (!commentMap[c.post_id]) commentMap[c.post_id] = [];
                    commentMap[c.post_id].push(c);
                });

                likes.forEach(l => {
                    if (!likeMap[l.post_id]) likeMap[l.post_id] = [];
                    likeMap[l.post_id].push(l);
                    makeLikeLookupKeys(l.post_id, l.actor_key, l.user_name).forEach(function(key) {
                        likeUserMap[key] = true;
                    });
                });

                return { commentMap, likeMap, likeUserMap };
            }

            // 缓存头像 URL

            async function loadAvatarsForUsers(usernames) {
                var normalizedUsers = Array.from(new Set(
                    (usernames || [])
                        .map(function(value) {
                            return String(value || '').trim();
                        })
                        .filter(Boolean)
                ));

                if (normalizedUsers.length === 0) return;
                try {
                    var cachedAvatars = readAvatarCacheFromStorage();
                    normalizedUsers.forEach(function(username) {
                        if (username && cachedAvatars[username] && !avatarCache[username]) {
                            avatarCache[username] = cachedAvatars[username];
                        }
                    });
                } catch (e) {}

                // P7: 只为没有新鲜缓存（TTL 内）的用户发起批量请求。
                // confirmed_none / has_avatar / fetch_failed 在 TTL 内均不重查。
                var uncached = normalizedUsers.filter(function(username) {
                    return !hasFreshAvatarCache(username);
                });
                if (uncached.length === 0) return;
                try {
                    var resp = await fetch(API_BASE + '/api/avatar/batch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ users: uncached })
                    });
                    var result = await resp.json();
                    if (resp.ok && result.ok && result.avatars) {
                        var avatars = result.avatars;
                        var keys = Object.keys(avatars);
                        for (var ki = 0; ki < keys.length; ki++) {
                            var k = keys[ki];
                            // P7: null → confirmed_none；有 URL → has_avatar
                            if (avatars[k]) {
                                setAvatarCacheEntry(k, 'has_avatar', avatars[k]);
                            } else if (avatars[k] === null) {
                                setAvatarCacheEntry(k, 'confirmed_none', null);
                            }
                        }
                        // 写入本地缓存，避免下次访问重新请求
                        try {
                            var cachedAvatars = readAvatarCacheFromStorage();
                            for (var ki2 = 0; ki2 < keys.length; ki2++) {
                                var k2 = keys[ki2];
                                if (avatars[k2]) {
                                    cachedAvatars[k2] = { state: 'has_avatar', url: avatars[k2], fetched_at: Date.now() };
                                } else if (avatars[k2] === null) {
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
                } catch(e) {
                    // P7: 网络异常时降级到旧缓存（与单用户接口一致）
                    uncached.forEach(function(username) {
                        setAvatarCacheEntry(username, 'fetch_failed', null);
                    });
                    console.error('批量头像加载失败:', e);
                }
            }

            function renderAvatarContent(username, avatarUrl) {
                var safeUser = String(username || '').trim();
                var fallbackInitial = (Array.from(safeUser)[0] || '?').toUpperCase();
                var fallbackSpan = '<span class="avatar-fallback" data-user-name="' + escapeHtml(safeUser) + '">' + escapeHtml(fallbackInitial) + '</span>';
                if (avatarUrl && sanitizeUrl(avatarUrl)) {
                    return '<img class="avatar-image" src="' + escapeHtml(sanitizeUrl(avatarUrl)) +
                        '" alt="' + escapeHtml(safeUser) + '" data-user-name="' + escapeHtml(safeUser) +
                        '" loading="lazy" decoding="async" style="opacity:0;transition:opacity 0.2s"' +
                        ' onload="var p=this.closest(\'.avatar\');if(p){p.classList.add(\'has-image\');this.style.opacity=\'1\'}"' +
                        ' onerror="var p=this.closest(\'.avatar\');if(p){p.classList.remove(\'has-image\');this.remove();var f=p.querySelector(\'.avatar-fallback\');if(f)f.style.visibility=\'visible\'};var u=this.getAttribute(\'data-user-name\');if(u&&window.__xtjInvalidateAvatarCache)window.__xtjInvalidateAvatarCache(u)">' +
                        fallbackSpan;
                }
                return fallbackSpan;
            }

            function getAvatarHtml(username, post) {
                var safeUser = String(username || '').trim();
                var fallbackInitial = (Array.from(safeUser)[0] || '?').toUpperCase();
                var avatarUrl = getAvatarUrl(safeUser) || '';

                if (!avatarUrl && safeUser) {
                    try {
                        var cachedAvatars = readAvatarCacheFromStorage();
                        if (cachedAvatars[safeUser] && cachedAvatars[safeUser].url) {
                            avatarCache[safeUser] = cachedAvatars[safeUser];
                            avatarUrl = cachedAvatars[safeUser].url;
                        }
                    } catch (e) {}
                }

                var safeName = escapeHtml(safeUser);
                var safeNameJs = safeJsStr(safeUser);

                if (avatarUrl && sanitizeUrl(avatarUrl)) {
                    return '<div class="avatar-wrap" onclick="openUserProfile(\'' +
                        safeNameJs +
                        '\')" data-user-name="' + safeName +
                        '"><div class="avatar clickable">' +
                        renderAvatarContent(safeUser, avatarUrl) +
                        '</div></div>';
                }

                return '<div class="avatar clickable" onclick="openUserProfile(\'' +
                    safeNameJs +
                    '\')" data-user-name="' + safeName +
                    '">' +
                    escapeHtml(fallbackInitial) +
                    '</div>';
            }

            // DEPRECATED_DO_NOT_EDIT ====== [??????]
            function getPostFilterUserAvatar(username) {
                var safeName = escapeHtml(username || "");
                var avatarUrl = getAvatarUrl(username);
                if (avatarUrl) {
                    return '<span class="post-user-chip-avatar"><img loading="lazy" decoding="async" src="' + escapeHtml(avatarUrl) + '" alt="' + safeName + '"></span>';
                }
                try {
                    var cachedAvatars = readAvatarCacheFromStorage();
                    if (cachedAvatars[username] && cachedAvatars[username].url) {
                        avatarCache[username] = cachedAvatars[username];
                        return '<span class="post-user-chip-avatar"><img loading="lazy" decoding="async" src="' + escapeHtml(cachedAvatars[username].url) + '" alt="' + safeName + '"></span>';
                    }
                } catch(e) {}
                return '<span class="post-user-chip-avatar">' + escapeHtml((username || "?").slice(0, 1).toUpperCase()) + '</span>';
            }

            function renderPostFilterUsers() {
                var list = document.getElementById("postUserQuickList");
                var input = document.getElementById("postUserFilter");
                var resetBtn = document.getElementById("postUserFilterReset");
                if (!list || !input) return;
                var activeUser = String(input.value || "").trim();
                if (resetBtn) resetBtn.style.visibility = activeUser ? "visible" : "hidden";
                if (postFilterUsersLoading && !postFilterUsers.length) {
                    list.innerHTML = renderPostFilterUserLoader();
                    return;
                }
                var users = Array.isArray(postFilterUsers) ? postFilterUsers : [];
                if (!users.length) {
                    list.innerHTML = '<div class="post-user-chip is-empty">\u6682\u65e0\u53ef\u7b5b\u9009\u7528\u6237</div>';
                    return;
                }
                var html = [
                    '<button type="button" class="post-user-chip' + (!activeUser ? ' is-active' : '') + '" onclick="selectPostFilterUser(\'\')">' +
                        '<span class="post-user-chip-avatar">\u5168</span>' +
                        '<span class="post-user-chip-name">\u5168\u90e8\u7528\u6237</span>' +
                    '</button>'
                ];
                users.forEach(function(username) {
                    var safeJsName = String(username).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
                    html.push(
                        '<button type="button" class="post-user-chip' + (activeUser === username ? ' is-active' : '') + '" onclick="selectPostFilterUser(\'' + safeJsName + '\')">' +
                            getPostFilterUserAvatar(username) +
                            '<span class="post-user-chip-name">' + escapeHtml(username) + '</span>' +
                        '</button>'
                    );
                });
                list.innerHTML = html.join("");
            }

            async function loadPostFilterUsers(forceRefresh) {
                if (postFilterUsersLoading) return;
                if (postFilterUsersLoaded && !forceRefresh) {
                    renderPostFilterUsers();
                    return;
                }
                var loadSeq = ++postFilterUsersLoadSeq;
                postFilterUsersLoading = true;
                renderPostFilterUsers();
                if (postFilterUsersLoadTimer) clearTimeout(postFilterUsersLoadTimer);
                postFilterUsersLoadTimer = setTimeout(function() {
                    if (loadSeq !== postFilterUsersLoadSeq) return;
                    postFilterUsersLoading = false;
                    renderPostFilterUsers();
                }, 2400);
                try {
                    var authRes = await window.xtjOptionalAuthFetch('/api/feed/authors');
                    if (!authRes.ok) throw new Error('authors_query_failed');
                    var authorPayload = await authRes.json();
                    if (!authorPayload || !authorPayload.ok) throw new Error('authors_query_failed');
                    var seen = {};
                    postFilterUsers = (authorPayload.authors || []).map(function(name) {
                        return String(name || "").trim();
                    }).filter(function(name) {
                        if (!name || seen[name]) return false;
                        seen[name] = true;
                        return true;
                    }).sort(function(a, b) {
                        return a.localeCompare(b, "zh-Hans-CN");
                    });
                    postFilterUsersLoaded = true;
                    if (postFilterUsers.length) {
                        await Promise.race([
                            loadAvatarsForUsers(postFilterUsers),
                            new Promise(function(resolve) { setTimeout(resolve, 1800); })
                        ]);
                    }
                } catch (e) {
                    console.error("[post-filter-users] load failed", e);
                    if (!postFilterUsers.length) {
                        var fallbackSeen = {};
                        postFilterUsers = (feedAllPosts || []).map(function(post) {
                            return post && post.user_name ? String(post.user_name).trim() : "";
                        }).filter(function(name) {
                            if (!name || fallbackSeen[name]) return false;
                            fallbackSeen[name] = true;
                            return true;
                        }).sort(function(a, b) {
                            return a.localeCompare(b, "zh-Hans-CN");
                        });
                    }
                } finally {
                    if (loadSeq === postFilterUsersLoadSeq) {
                        stopPostFilterUsersLoading();
                    }
                    renderPostFilterUsers();
                }
            }

            window.selectPostFilterUser = function(userName) {
                var input = document.getElementById("postUserFilter");
                if (input) input.value = userName || "";
                renderPostFilterUsers();
                window.applyPostFilters();
            };

            function buildPostContentHtml(content) {
                return escapeHtml(String(content || ''));
            }
            window.buildPostContentHtml = buildPostContentHtml;

            function renderFeedWithAvatars(visiblePosts, comments, likes) {
                const feed = document.getElementById("feed");
                const { commentMap, likeMap, likeUserMap } = buildPostMaps(comments, likes);

                var htmlChunks = [];
                visiblePosts.forEach(function(post) {
                    try {
                        const p = normalizePost(post);
                        const pLikes = likeMap[p.id] || [];
                        const pComms = commentMap[p.id] || [];
                        const isLiked = isPostLikedByCurrentUser(likeUserMap, p.id);
                        const canDelPost = p.actor_key === deviceId || p.actor_key === currentUser || isAdmin();
                        var commentsHtml = '';
                        if (pComms.length) {
                            var parentComments = pComms.filter(function(c) { return !c.parent_comment_id; });
                            var aiCommentMap = {};
                            pComms.forEach(function(c) {
                                if (c.parent_comment_id && c.user_name === 'cat_ai' && c.generated_by_ai) {
                                    var key = String(c.parent_comment_id);
                                    if (!aiCommentMap[key]) aiCommentMap[key] = [];
                                    aiCommentMap[key].push(c);
                                }
                            });
                            commentsHtml = '\n                  <div class="comments">\n                    ' + parentComments.map(function(c) {
                                var delBtn = isAdmin() ? '<button type="button" class="comment-del-btn" onclick="deleteFeedComment(\'' + safeJsStr(c.id) + '\', this)">删除</button>' : '';
                                var html = '\n                    <div class="comment-item" data-comment-id="' + escapeHtml(c.id) + '">\n                      <div><b>' + escapeHtml(c.user_name) + ':</b> ' + escapeHtml(c.content) + '</div>' + delBtn + '\n                    ';
                                var aiReplies = aiCommentMap[String(c.id)] || [];
                                if (aiReplies.length > 0) {
                                    html += '<div class="comment-replies" style="margin-left:24px; margin-top:8px;">';
                                    aiReplies.forEach(function(reply) {
                                        if (typeof renderCatAiComment === 'function') {
                                            html += renderCatAiComment(reply);
                                        }
                                    });
                                    html += '</div>';
                                }
                                html += '\n                    </div>\n                    ';
                                return html;
                            }).join('') + '\n                  </div>\n                  ';
                        }
                        htmlChunks.push('\n                <div class="post glass" data-post-id="' + escapeHtml(p.id) + '">\n                  <div class="post-header">\n                    ' + getAvatarHtml(p.user_name, post) + '\n                    <div class="user-info">\n                      <span class="user-name">' + escapeHtml(p.user_name) + '</span>\n                      <span class="post-time">' + window.safeParseDate(p.created_at).toLocaleString() + '</span>\n                    </div>\n                  </div>\n                  <div class="content">' + buildPostContentHtml(p.content) + '</div>\n                  ' + (p.media_url ? '<div class="media">' + (p.media_type === 'video' ? '<video src="' + escapeHtml(p.media_url) + '" controls preload="none" playsinline></video>' : '<img data-post-id="' + escapeHtml(p.id) + '" data-post-user="' + escapeHtml(p.user_name || '') + '" data-post-created-at="' + escapeHtml(p.created_at || '') + '" data-post-views="' + escapeHtml(String(p.views || 0)) + '" data-actor-key="' + escapeHtml(String(p.actor_key || '')) + '" data-can-delete="' + (canDelPost ? '1' : '0') + '" src="' + escapeHtml(p.media_url) + '" loading="lazy" onclick="openImageViewer(\'' + safeJsStr(p.media_url) + '\', this)">') + '</div>' : '') + '\n                  <div class="post-stats-text">浏览 ' + (p.views || 0) + ' | 点赞 ' + pLikes.length + ' | 评论 ' + pComms.length + '</div>\n                  <div class="actions">\n                    <button class="action-btn ' + (isLiked ? 'liked' : '') + '" aria-pressed="' + (isLiked ? 'true' : 'false') + '" onclick="toggleLike(this, \'' + safeJsStr(p.id) + '\')">' + (isLiked ? '❤️' : '🤍') + '</button>\n                    <button class="action-btn" onclick="openComment(\'' + safeJsStr(p.id) + '\')">评论</button>\n                    ' + (canPinPost(p) ? '<button type="button" class="action-btn pin" data-post-id="' + escapeHtml(p.id) + '">' + (normalizePost(p).is_pinned ? '取消置顶' : '置顶') + '</button>' : '') + '\n                    ' + (canDelPost ? '<button type="button" class="action-btn del" onclick="openDelete(\'' + safeJsStr(p.id) + '\', \'' + safeJsStr(p.actor_key) + '\')">删除</button>' : '') + '\n                  </div>\n                  ' + commentsHtml + '\n                </div>\n              ');
                    } catch (e) {
                        console.error('[feed-render] failed post:', {
                            postId: post && post.id,
                            userName: post && post.user_name,
                            error: e
                        });
                    }
                });

                // Before replacing feed innerHTML:
                var detachedPanels = [];
                feed.querySelectorAll('.post-tool-critique, .post-tool-translation').forEach(function(panel) {
                    var post = panel.closest('.post');
                    var postId = post ? post.getAttribute('data-post-id') : null;
                    if (postId) {
                        panel.parentNode.removeChild(panel);
                        detachedPanels.push({ id: postId, panel: panel });
                    }
                });

                feed.innerHTML = htmlChunks.length ? htmlChunks.join('') : '<div class="loading">快来发布第一条动态吧~</div>';

                // Reattach:
                detachedPanels.forEach(function(item) {
                    // L9 修复：CSS 选择器里不能用 escapeHtml（HTML 实体是字面字符永不匹配），
                    // 应转义选择器特殊字符（对齐 6573 行的 replace(/"/g,'\\"') 模式）
                    var _pid = String(item.id == null ? '' : item.id).replace(/"/g, '\\"');
                    var post = feed.querySelector('.post[data-post-id="' + _pid + '"]');
                    if (post) {
                        var actions = post.querySelector('.actions');
                        if (actions) actions.insertAdjacentElement('afterend', item.panel);
                    }
                });

                initPostScrollAnimation();
            }

            function initPostScrollAnimation() {
                var posts = document.querySelectorAll('.post');
                primePostReveal(posts);
                observePostViewportState(posts);
            }

            let _cachedSPosts = null, _cachedSViews = null, _cachedSLikes = null;
            function updateFeedStats() {
    // 统一统计口径：优先使用内存全量数据（feedAll* 缓存），
    // 避免筛选/分页后 DOM 只含部分帖子导致统计数字错乱；内存数据缺失时回退 DOM 统计。
    var posts = [];
    var totalLikes = 0, totalComments = 0, totalViews = 0;
    // feedAll* 是与 updateFeedStats 同作用域的闭包变量（let 声明），直接访问；
    // 未初始化（undefined）时回退 DOM 统计，避免筛选/分页后统计错乱。
    var hasFullData = Array.isArray(feedAllPosts) && Array.isArray(feedAllLikes) && Array.isArray(feedAllComments);
    if (hasFullData) {
        posts = feedAllPosts;
        feedAllLikes.forEach(function(like) {
            if (!(like && (like.is_like === false || like.like_type === 'unlike'))) totalLikes += 1;
        });
        totalComments = feedAllComments.length;
        posts.forEach(function(p) {
            if (p && Number(p.views)) totalViews += Number(p.views);
        });
    } else {
        posts = Array.prototype.slice.call(document.querySelectorAll('.post'));
        posts.forEach(function(p) {
            var text = (p.querySelector('.post-stats-text') || {}).textContent || '';
            var matchV = text.match(/(?:浏览|👁)\s*(\d+)/);
            if (matchV) totalViews += parseInt(matchV[1], 10) || 0;
            var matchL = text.match(/(?:点赞|❤)\s*(\d+)/);
            if (matchL) totalLikes += parseInt(matchL[1], 10) || 0;
            var matchC = text.match(/(?:评论|💬)\s*(\d+)/);
            if (matchC) totalComments += parseInt(matchC[1], 10) || 0;
        });
    }
                var sPosts = _cachedSPosts || (_cachedSPosts = document.getElementById('sPosts'));
                var sViews = _cachedSViews || (_cachedSViews = document.getElementById('sViews'));
                var sLikes = _cachedSLikes || (_cachedSLikes = document.getElementById('sLikes'));
                if (sPosts) sPosts.textContent = posts.length;
                if (sViews) sViews.textContent = totalViews;
                if (sLikes) sLikes.textContent = totalLikes + totalComments;
            }

            async function initialLoad(skipCache = false) {
                if (!skipCache) {
                    const cached = window.safeStorage.get(CACHE_KEY);
                    if (cached) {
                        try {
                            const parsed = JSON.parse(cached);
                            if (parsed?.data && Date.now()-parsed.timestamp < CACHE_DURATION) { await renderFeed(parsed.data); loadFeed(true); queueDeferredStartupTasks(); return; }
                        } catch(e){}
                    }
                }
                await loadFeed(false);
                queueDeferredStartupTasks();
            }

            function collectPostMetadata(visibility, overrides) {
                var meta = Object.assign({}, POST_META_DEFAULTS, {
                    visibility: visibility || "public"
                }, overrides || {});
                if (overrides && overrides.location && typeof overrides.location === "object") {
                    meta.location_name = overrides.location.name || "";
                    meta.location_province = overrides.location.province || "";
                    meta.location_city = overrides.location.city || "";
                    meta.location_district = overrides.location.district || "";
                    meta.location_level = overrides.location.level || "";
                }
                return meta;
            }

            async function insertPostRecord(payload, fallbackContent) {
                try {
                    var body = {
                        content: payload.content || fallbackContent || '',
                        media_url: payload.media_url || '',
                        media_type: payload.media_type || '',
                        actor_key: payload.actor_key || '',
                        visibility: payload.visibility || 'public'
                    };
                    // 位置字段（可选，用户主动选择）
                    if (payload.location && payload.location.name) {
                        body.location = {
                            name: payload.location.name || '',
                            province: payload.location.province || '',
                            city: payload.location.city || '',
                            district: payload.location.district || '',
                            level: payload.location.level || ''
                        };
                    }
                    var response = await window.xtjProtectedFetch('/api/post/create', {
                        method: 'POST',
                        body: JSON.stringify(body)
                    });
                    var result = await response.json().catch(function() { return {}; });
                    if (!response.ok || !result.ok || !result.data) {
                        return { ok: false, error: new Error(result.error || '发布失败') };
                    }
                    var data = normalizePost(result.data);
                    if (data && data.id && (!data.ip_region_text || !data.ip_region_status || !data.location_name)) {
                        try {
                            var fresh = await fetchPostSnapshot(data.id);
                            if (fresh) data = normalizePost(fresh);
                        } catch (snapshotError) {
                            console.warn('[post-create] snapshot refresh failed', snapshotError);
                        }
                    }
                    return { ok: true, fallback: false, data: data };
                } catch (error) {
                    return { ok: false, error: error };
                }
            }

            function insertPublishedPostIntoFeed(post) {
                if (!post || !post.id) return false;
                post = normalizePost(post);
                if (!Array.isArray(feedAllPosts)) feedAllPosts = [];
                feedAllPosts = feedAllPosts.filter(function(item) { return String(item.id) !== String(post.id); });
                feedAllPosts.unshift(post);
                feedAllPosts = sortPosts(feedAllPosts);
                syncPostInfoCache(post);
                var firstPage = (feedLoadedPages || []).find(function(page) { return page && page.offset === 0; });
                if (firstPage) {
                    firstPage.postIds = [String(post.id)].concat((firstPage.postIds || []).filter(function(id) { return String(id) !== String(post.id); }));
                } else {
                    feedLoadedPages = [{ offset: 0, postIds: [String(post.id)] }].concat(feedLoadedPages || []);
                }
                markFeedStateChanged();
                var feed = document.getElementById('feed');
                if (!feed) return false;
                var maps = buildPostMaps(feedAllComments || [], feedAllLikes || []);
                var template = document.createElement('template');
                template.innerHTML = renderPostCard(post, maps.commentMap, maps.likeMap, maps.likeUserMap).trim();
                var postEl = template.content.firstElementChild;
                if (!postEl) return false;
                postEl.classList.add('visible', 'is-newly-published');
                postEl.style.setProperty('--post-enter-delay', '0ms');
                feed.insertBefore(postEl, feed.firstChild);
                observePostViewportState([postEl]);
                var clearPublishedAnimation = function() { postEl.classList.remove('is-newly-published'); };
                postEl.addEventListener('animationend', clearPublishedAnimation, { once: true });
                setTimeout(clearPublishedAnimation, 420);
                writeFeedCacheSnapshot();
                updateFeedStats();
                return true;
            }

            function postHasRenderableIpData(post) {
                if (!post) return false;
                return !!(
                    String(post.ip_region_text || "").trim() ||
                    String(post.ip_region_status || "").trim() ||
                    String(post.ip_province || "").trim() ||
                    String(post.ip_city || "").trim() ||
                    String(post.ip_lookup_started_at || "").trim()
                );
            }

            function postNeedsIpRefresh(post) {
                if (!post || !post.id) return false;
                var status = String(post.ip_region_status || "").trim();
                var hasLookupStarted = !!String(post.ip_lookup_started_at || "").trim();
                var hasRegionText = !!String(post.ip_region_text || "").trim();
                return status === 'pending' || (hasLookupStarted && !hasRegionText);
            }

            function refreshPublishedPostCard(post) {
                if (!post || !post.id) return false;
                if (!Array.isArray(feedAllPosts)) feedAllPosts = [];
                var postId = String(post.id);
                feedAllPosts = feedAllPosts.map(function(item) {
                    return String(item && item.id) === postId ? post : item;
                });
                syncPostInfoCache(post);
                markFeedStateChanged();
                var feed = document.getElementById('feed');
                if (!feed) return false;
                var existing = feed.querySelector('.post[data-post-id="' + postId.replace(/"/g, '\\"') + '"]');
                if (!existing) return false;
                var maps = buildPostMaps(feedAllComments || [], feedAllLikes || []);
                var template = document.createElement('template');
                template.innerHTML = renderPostCard(post, maps.commentMap, maps.likeMap, maps.likeUserMap).trim();
                var nextPostEl = template.content.firstElementChild;
                if (!nextPostEl) return false;
                nextPostEl.classList.add('visible');
                existing.replaceWith(nextPostEl);
                observePostViewportState([nextPostEl]);
                writeFeedCacheSnapshot();
                updateFeedStats();
                return true;
            }

            var publishedPostIpRefreshTimers = Object.create(null);
            function schedulePublishedPostIpRefresh(postId) {
                if (!postId) return;
                var key = String(postId);
                if (publishedPostIpRefreshTimers[key]) return;
                publishedPostIpRefreshTimers[key] = true;
                var attempts = 0;
                var maxAttempts = 4;
                function cleanup() {
                    delete publishedPostIpRefreshTimers[key];
                }
                function run() {
                    attempts++;
                    fetchPostSnapshot(postId).then(function(freshPost) {
                        var normalized = freshPost ? normalizePost(freshPost) : null;
                        var ipText = normalized ? String(normalized.ip_region_text || "").trim() : "";
                        var ipStatus = normalized ? String(normalized.ip_region_status || "").trim() : "";
                        var hasFinalIpDisplay = !!ipText || ipStatus === 'resolved' || ipStatus === 'failed';
                        if (normalized && hasFinalIpDisplay) {
                            refreshPublishedPostCard(normalized);
                            cleanup();
                            return;
                        }
                        if (normalized && (ipStatus === 'pending' || String(normalized.ip_lookup_started_at || "").trim())) {
                            if (attempts < maxAttempts) {
                                setTimeout(run, attempts === 1 ? 600 : 900);
                            } else {
                                cleanup();
                            }
                            return;
                        }
                        if (attempts < maxAttempts) {
                            setTimeout(run, attempts === 1 ? 600 : 900);
                        } else {
                            cleanup();
                        }
                    }).catch(function() {
                        if (attempts < maxAttempts) {
                            setTimeout(run, 900);
                        } else {
                            cleanup();
                        }
                    });
                }
                setTimeout(run, 450);
            }

            function refreshPendingFeedIpPosts(posts) {
                if (!Array.isArray(posts) || !posts.length) return;
                posts.forEach(function(post) {
                    if (!postNeedsIpRefresh(post)) return;
                    schedulePublishedPostIpRefresh(post.id);
                });
            }

            function resetPostComposer() {
                var postInp = document.getElementById("postInp");
                var fileInp = document.getElementById("fileInp");
                var visibilityEl = document.getElementById("postVisibility");
                if (postInp) postInp.value = "";
                if (fileInp) fileInp.value = "";
                if (visibilityEl) visibilityEl.value = "public";
                resetPostLocation();
            }

            function buildPostStorageContent(post, text, metaOverrides) {
                var normalized = normalizePost(post || {});
                var meta = Object.assign({}, normalized._contentMeta || POST_META_DEFAULTS, {
                    visibility: normalized.visibility || "public",
                    is_pinned: !!normalized.is_pinned,
                    pinned_at: normalized.pinned_at || null,
                    updated_at: normalized.updated_at || null,
                    edited_at: (normalized._contentMeta && normalized._contentMeta.edited_at) || null
                }, metaOverrides || {});
                var nextText = typeof text === "string" ? text : normalized.content || "";
                return buildPostContentPayload(nextText, meta);
            }

            function matchesPostExpectation(post, expected) {
                if (!post) return false;
                var normalized = normalizePost(post);
                if (typeof expected.content === "string" && String(normalized.content || "") !== String(expected.content)) return false;
                if (expected.visibility != null && String(normalized.visibility || "public") !== String(expected.visibility)) return false;
                if (expected.is_pinned != null && !!normalized.is_pinned !== !!expected.is_pinned) return false;
                if (Object.prototype.hasOwnProperty.call(expected, "pinned_at") && String(normalized.pinned_at || "") !== String(expected.pinned_at || "")) return false;
                return true;
            }

            async function fetchPostSnapshot(postId) {
                var fetched = await sb.from("posts").select("*").eq("id", postId).maybeSingle();
                if (fetched.error) throw fetched.error;
                return fetched.data || null;
            }

            async function updatePostRecord(post, updates) {
                var normalized = normalizePost(post);
                var nextVisibility = updates.visibility != null ? updates.visibility : normalized.visibility;
                var nextPinned = updates.is_pinned != null ? !!updates.is_pinned : !!normalized.is_pinned;
                var nextPinnedAt = Object.prototype.hasOwnProperty.call(updates, "pinned_at") ? updates.pinned_at : normalized.pinned_at;
                var nextUpdatedAt = Object.prototype.hasOwnProperty.call(updates, "updated_at") ? updates.updated_at : normalized.updated_at;
                var nextEditedAt = Object.prototype.hasOwnProperty.call(updates, "edited_at")
                    ? updates.edited_at
                    : ((normalized._contentMeta && normalized._contentMeta.edited_at) || null);
                var nextContent = typeof updates.content === "string" ? updates.content : normalized.content;

                var newContent = buildPostStorageContent(normalized, nextContent, {
                    visibility: nextVisibility,
                    is_pinned: nextPinned,
                    pinned_at: nextPinnedAt,
                    updated_at: nextUpdatedAt,
                    edited_at: nextEditedAt
                });
                var updatePayload = {
                    post_id: post.id,
                    content: newContent,
                    visibility: nextVisibility
                };
                var resp = await window.xtjProtectedFetch('/api/post/update', {
                    method: 'POST',
                    body: JSON.stringify(updatePayload)
                });
                var result = await resp.json().catch(function() { return {}; });
                if (!resp.ok || !result.ok) return { ok: false, error: new Error(result.error || '更新失败') };
                // 优先使用后端返回的 data，否则重新查询
                var verified = result.data ? normalizePost(result.data) : null;
                if (!verified) {
                    var verifyRes = await sb.from('posts').select('*').eq('id', post.id).maybeSingle();
                    if (!verifyRes.data) return { ok: false, error: new Error('更新失败：数据库没有实际修改任何行') };
                    verified = normalizePost(verifyRes.data);
                }
                var verifiedMeta = parsePostContent(verified._rawContent || verified.content || '').meta || {};
                if (String(verified.visibility || "public") !== String(nextVisibility)) {
                    return { ok: false, error: new Error("更新失败：visibility 未实际生效") };
                }
                if (String(verifiedMeta.visibility || "public") !== String(nextVisibility)) {
                    return { ok: false, error: new Error("更新失败：content.meta.visibility 未同步") };
                }
                if (!!verified.is_pinned !== !!nextPinned) {
                    return { ok: false, error: new Error("更新失败：置顶状态未实际生效") };
                }
                if (!!verifiedMeta.is_pinned !== !!nextPinned) {
                    return { ok: false, error: new Error("更新失败：content.meta.is_pinned 未同步") };
                }
                if (Object.prototype.hasOwnProperty.call(updates, "pinned_at") && String(verified.pinned_at || "") !== String(nextPinnedAt || "")) {
                    return { ok: false, error: new Error("更新失败：pinned_at 未实际生效") };
                }
                return { ok: true, data: verified };
            }

            function getRenderableComments(comments, visiblePosts) {
                var visibleIds = new Set((visiblePosts || []).map(function(post) { return String(post.id); }));
                return (comments || []).filter(function(comment) {
                    return comment && visibleIds.has(String(comment.post_id));
                });
            }

            function formatRelativeTime(dateStr) {
                var d = window.safeParseDate ? window.safeParseDate(dateStr) : new Date(dateStr);
                var diff = Math.floor((Date.now() - d.getTime()) / 1000);
                if (diff < 60) return "刚刚";
                if (diff < 3600) return Math.floor(diff / 60) + "分钟前";
                if (diff < 86400) return Math.floor(diff / 3600) + "小时前";
                if (diff < 86400 * 30) return Math.floor(diff / 86400) + "天前";
                return d.toLocaleDateString();
            }

            function formatPostTime(post) {
                var normalized = normalizePost(post);
                var time = normalized.created_at ? window.safeParseDate(normalized.created_at).toLocaleString() : "";
                var editedAt = normalized._contentMeta && normalized._contentMeta.edited_at ? normalized._contentMeta.edited_at : null;
                if (editedAt) return time + " (已编辑)";
                return time;
            }

            function buildPostBadges(post) {
                var normalized = normalizePost(post);
                var bits = [];
                bits.push('<span class="post-visibility-badge ' + (normalized.visibility === "private" ? 'private' : 'public') + '">' + (normalized.visibility === "private" ? '私密' : '公开') + '</span>');
                if (normalized.is_pinned) bits.push('<span class="post-pin-badge">置顶</span>');
                return bits.join("");
            }

            function buildPostStatsLine(post, likeCount, commentCount) {
                var normalized = normalizePost(post);
                return '浏览 ' + (normalized.views || 0) +
                    ' | 点赞 ' + (likeCount || 0) +
                    ' | 评论 ' + (commentCount || 0);
            }

            // ★ 关键修复：删除此处的 buildPostBadges 重新赋值！
            // 原因：上面 line 3765 定义的 buildPostBadges 已经包含 Pro 标志、公开/私密、置顶的完整逻辑。
            //       此处重新赋值为简单版会**覆盖**上面的完整实现，导致 Pro 标志永远不显示。
            // 置顶徽章已经在 line 3784 的 buildPostBadges 内部处理了，无需重复。
            function buildPostActionHtml(post, isLiked, canDelete) {
                var idJs = safeJsStr(String(post.id));
                var idHtml = escapeHtml(String(post.id));
                var actorKeyJs = safeJsStr(String(post.actor_key || ""));
                var actions = [
                    '<button class="action-btn ' + (isLiked ? 'liked' : '') + '" aria-pressed="' + (isLiked ? 'true' : 'false') + '" onclick="toggleLike(this, \'' + idJs + '\')">' + (isLiked ? '❤️' : '🤍') + '</button>',
                    '<button class="action-btn" onclick="openComment(\'' + idJs + '\')">评论</button>'
                ];
                if (canPinPost(post)) {
                    actions.push('<button type="button" class="action-btn pin" data-post-id="' + idHtml + '">' + (normalizePost(post).is_pinned ? '取消置顶' : '置顶') + '</button>');
                }
                if (canDelete) {
                    actions.push('<button type="button" class="action-btn del" onclick="openDelete(\'' + idJs + '\', \'' + actorKeyJs + '\')">删除</button>');
                }
                actions.push('<button type="button" class="action-btn post-tools-trigger" data-post-id="' + idHtml + '" aria-haspopup="menu" aria-expanded="false" aria-label="更多帖子工具">•••</button>');
                return actions.join("");
            }

            var activePostToolsMenu = null;
            function closePostToolsMenu() {
                if (!activePostToolsMenu) return;
                var trigger = activePostToolsMenu.trigger;
                activePostToolsMenu.menu.remove();
                if (trigger) trigger.setAttribute('aria-expanded', 'false');
                activePostToolsMenu = null;
            }

            function openPostToolsMenu(trigger) {
                if (!trigger) return;
                if (activePostToolsMenu && activePostToolsMenu.trigger === trigger) {
                    closePostToolsMenu();
                    return;
                }
                closePostToolsMenu();
                var postId = String(trigger.getAttribute('data-post-id') || '');
                if (!postId) return;
                var menu = document.createElement('div');
                menu.className = 'post-tools-menu';
                menu.setAttribute('role', 'menu');
                var svgTranslate = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';
                var svgAi = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3l1.9 5.8 1.9-5.8a2 2 0 0 1 1.3-1.3l5.8-1.9-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>';
                var svgReport = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>';
                var post = feedAllPosts.find(function(p) { return p.id == postId; });
                if (!post && window.currentPost && window.currentPost.id == postId) post = window.currentPost;
                var hasText = post && String(post.content || '').trim().length > 0;
                var btnTranslate = hasText ? '<button type="button" role="menuitem" data-post-tool="translate" data-post-id="' + escapeHtml(postId) + '">' + svgTranslate + '<span>翻译帖子</span></button>' : '';
                var btnAi = hasText ? '<button type="button" role="menuitem" data-post-tool="ask-ai" data-post-id="' + escapeHtml(postId) + '">' + svgAi + '<span>锐评 AI</span></button>' : '';
                menu.innerHTML = btnTranslate + btnAi +
                                 '<button type="button" role="menuitem" data-post-tool="report" data-post-id="' + escapeHtml(postId) + '">' + svgReport + '<span>举报帖子</span></button>';
                document.body.appendChild(menu);
                var rect = trigger.getBoundingClientRect();
                var width = menu.offsetWidth || 148;
                menu.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)) + 'px';
                menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 6)) + 'px';
                trigger.setAttribute('aria-expanded', 'true');
                activePostToolsMenu = { menu: menu, trigger: trigger };
            }
            window.closePostToolsMenu = closePostToolsMenu;
            window.addEventListener('pagehide', closePostToolsMenu);
            window.addEventListener('scroll', closePostToolsMenu, { passive: true });
            window.addEventListener('resize', closePostToolsMenu, { passive: true });
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', closePostToolsMenu, { passive: true });
                window.visualViewport.addEventListener('scroll', closePostToolsMenu, { passive: true });
            }
            // Capture scroll from dock panels as well as the document; the menu is appended to body.
            document.addEventListener('scroll', closePostToolsMenu, { capture: true, passive: true });
            document.addEventListener('visibilitychange', function() {
                if (document.hidden) closePostToolsMenu();
            });

            var activePostAiSession = null;
            function getPostToolAnchor(postId) {
                return document.querySelector('.post-tools-trigger[data-post-id="' + String(postId).replace(/"/g, '\\"') + '"]');
            }
            function postToolFetch(body) {
                return window.xtjProtectedFetch('/api/agent/post-tools', { method: 'POST', body: JSON.stringify(body) }).then(function(resp) {
                    return resp.json().then(function(data) { if (!resp.ok) throw new Error(data.error || 'post_tool_failed'); return data; });
                });
            }
            window.requestPostTranslation = function(postId) {
                var anchor = getPostToolAnchor(postId);
                if (!anchor) return;
                var host = anchor.closest('.post');
                if (!host) return;
                var actions = anchor.closest('.actions');
                if (!actions) return;
                var existing = host.querySelector('.post-tool-translation');
                if (existing) { existing.hidden = !existing.hidden; return; }
                var panel = document.createElement('section');
                panel.className = 'post-tool-translation';
                panel.textContent = '正在翻译...';
                actions.insertAdjacentElement('afterend', panel);
                postToolFetch({ post_id: postId, action: 'translate' }).then(function(data) {
                    panel.textContent = data.translation || '暂时无法翻译该帖子。';
                    panel.classList.toggle('is-original-chinese', !!data.already_chinese);
                }).catch(function() { panel.textContent = '翻译暂时不可用。'; panel.classList.add('is-error'); });
            };
            function runPostAiRequest(session, payload) {
                var requestId = ++session.requestId;
                session.output.textContent = 'AI 正在锐评...';
                session.output.classList.remove('is-error');
                session.controller.abort();
                session.controller = new AbortController();
                window.xtjProtectedFetch('/api/agent/post-chat/stream', { method: 'POST', body: JSON.stringify(payload), signal: session.controller.signal }).then(function(resp) {
                    if (!resp.ok || !resp.body) throw new Error('post_chat_failed');
                    return resp.body.getReader();
                }).then(function(reader) {
                    var decoder = new TextDecoder(), buffer = '';
                    var receivedContent = false;
                    function read() { return reader.read().then(function(chunk) {
                        if (chunk.done) {
                            if (!receivedContent) {
                                session.output.textContent = 'AI 暂时不可用。';
                                session.output.classList.add('is-error');
                            }
                            return;
                        }
                        buffer += decoder.decode(chunk.value, { stream: true });
                        var events = buffer.split('\n\n'); buffer = events.pop();
                        events.forEach(function(event) {
                            var dataLine = event.split('\n').filter(function(line) { return line.indexOf('data: ') === 0; })[0];
                            if (!dataLine || session.isClosed || requestId !== session.requestId) return;
                            var data; try { data = JSON.parse(dataLine.slice(6)); } catch (e) { return; }
                            if (data.content) {
                                receivedContent = true;
                                session.conversationId = data.conversation_id || session.conversationId;
                                session.output.textContent = event.indexOf('event: delta') === 0 ? (session.output.textContent === 'AI 正在锐评...' ? '' : session.output.textContent) + data.content : data.content;
                            }
                            if (data.error) { session.output.textContent = 'AI 暂时不可用。'; session.output.classList.add('is-error'); }
                        });
                        return read();
                    }); }
                    return read();
                }).catch(function(error) {
                    if (error.name !== 'AbortError' && !session.isClosed && requestId === session.requestId) {
                        session.output.textContent = 'AI 暂时不可用。';
                        session.output.classList.add('is-error');
                    }
                });
            }
            window.openPostAiChat = function(postId) {
                var anchor = getPostToolAnchor(postId);
                if (!anchor) return;
                var host = anchor.closest('.post');
                if (!host) return;
                var actions = anchor.closest('.actions');
                if (!actions) return;
                var existing = host.querySelector('.post-tool-critique');
                if (existing) {
                    if (existing.classList.contains('is-error')) {
                        existing.classList.remove('is-error');
                        existing.textContent = 'AI 正在锐评...';
                        var existingSession = existing.__aiSession;
                        if (existingSession) runPostAiRequest(existingSession, { post_id: String(postId), initial: true });
                    } else {
                        existing.hidden = !existing.hidden;
                    }
                    return;
                }
                
                var panel = document.createElement('section');
                panel.className = 'post-tool-critique';
                panel.textContent = 'AI 正在锐评...';
                actions.insertAdjacentElement('afterend', panel);
                
                var session = { output: panel, controller: new AbortController(), requestId: 0, conversationId: '', isClosed: false };
                panel.__aiSession = session;
                runPostAiRequest(session, { post_id: String(postId), initial: true });
            };
            window.openPostReport = function(postId) {
                window.__xtjReportTargetPostId = String(postId);
                if (typeof window.openReportModal === 'function') window.openReportModal();
                var reportList = document.getElementById('reportContentList');
                var selectTarget = function() {
                    var item = reportList && reportList.querySelector('[data-id="' + String(postId).replace(/"/g, '\\"') + '"]');
                    if (item) { item.click(); return true; }
                    return false;
                };
                if (!selectTarget() && reportList) {
                    var observer = new MutationObserver(function() { if (selectTarget()) observer.disconnect(); });
                    observer.observe(reportList, { childList: true, subtree: true });
                }
                postToolFetch({ post_id: postId, action: 'report_scan' }).then(function(data) {
                    window.__xtjReportAiScan = data.scan || null;
                    var form = document.getElementById('reportModal');
                    if (!form || !data.scan) return;
                    var old = form.querySelector('.report-ai-scan'); if (old) old.remove();
                    var scan = document.createElement('div'); scan.className = 'report-ai-scan';
                    scan.textContent = 'AI 检测：' + String(data.scan.summary || '未发现明确风险');
                    form.querySelector('.report-form, .report-content, .modal-box').appendChild(scan);
                }).catch(function() { window.__xtjReportAiScan = null; });
            };

            function buildPostLocationHtml(normalized) {
                var parts = [];
                var locationName = String(normalized.location_name || normalized.location || "").trim();
                if (!locationName && normalized._contentMeta) {
                    locationName = String((normalized._contentMeta.location_name || "")).trim();
                }
                if (locationName) {
                    parts.push('<div class="post-location-display"><span class="post-location-icon">📍</span> ' + escapeHtml(locationName) + '</div>');
                }
                var ipText = String(normalized.ip_region_text || "").trim();
                var ipStatus = String(normalized.ip_region_status || "").trim();
                var ipProvince = String(normalized.ip_province || "").trim();
                var ipCity = String(normalized.ip_city || "").trim();
                if (!ipText && normalized._contentMeta) {
                    var ipMeta = normalized._contentMeta || {};
                    if (!ipText) ipText = String(ipMeta.ip_region_text || "").trim();
                    if (!ipStatus) ipStatus = String(ipMeta.ip_region_status || "").trim();
                    if (!ipProvince) ipProvince = String(ipMeta.ip_province || "").trim();
                    if (!ipCity) ipCity = String(ipMeta.ip_city || "").trim();
                }
                var hasLookupStarted = !!normalized.ip_lookup_started_at || ipStatus === 'resolved' || ipStatus === 'pending' || ipStatus === 'failed';
                if (!ipText && (ipProvince || ipCity)) {
                    ipText = [ipProvince, ipCity].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
                }
                if (hasLookupStarted || ipText) {
                    if (!ipText && ipStatus === 'pending') ipText = '解析中';
                    if (!ipText && (ipStatus === 'failed' || ipStatus === 'resolved')) ipText = '未知';
                    if (!ipText) ipText = '未知';
                }
                if (ipText) {
                    parts.push('<div class="post-ip-region">IP属地：' + escapeHtml(ipText) + '</div>');
                }
                return parts.length ? '<div class="post-location-info">' + parts.join('') + '</div>' : '';
            }

            function looksLikeSystemTelemetry(content) {
                if (!content) return false;
                try {
                    var obj = JSON.parse(String(content).trim());
                    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
                    var telemetryKeys = [
                        'page_load_id', 'last_attempt_at', 'resolved_address', 'resolved_at',
                        'capture_reason', 'precise_location_history',
                        'device_id', 'browser_fingerprint_hash', 'canvas_fingerprint_hash',
                        'webgl_fingerprint_hash'
                    ];
                    var matchCount = 0;
                    for (var i = 0; i < telemetryKeys.length; i++) {
                        if (telemetryKeys[i] in obj) matchCount++;
                    }
                    return matchCount >= 2;
                } catch (e) {
                    return false;
                }
            }

            function renderPostCard(post, commentMap, likeMap, likeUserMap) {
                var normalized = normalizePost(post);
                // 安全兜底：content 是系统遥测/定位 JSON 则跳过
                if (looksLikeSystemTelemetry(normalized.content)) {
                    return '';
                }
                var pLikes = likeMap[normalized.id] || [];
                var pComms = commentMap[normalized.id] || [];
                var isLiked = isPostLikedByCurrentUser(likeUserMap, normalized.id);
                var canDelete = canDeletePost(normalized);
                function commentDeleteButton(comment) {
                    if (!comment || !currentUser || !(isAdmin() || String(comment.user_name || '') === String(currentUser))) return '';
                    return '<button type="button" class="comment-del-btn" onclick="deleteFeedComment(\'' + safeJsStr(comment.id) + '\', this)">删除</button>';
                }
                var mediaDataAttrs = [
                    'data-post-id="' + escapeHtml(String(normalized.id)) + '"',
                    'data-media-url="' + escapeHtml(String(normalized.media_url || "")) + '"',
                    'data-post-user="' + escapeHtml(String(normalized.user_name || "")) + '"',
                    'data-post-created-at="' + escapeHtml(String(normalized.created_at || "")) + '"',
                    'data-post-views="' + escapeHtml(String(normalized.views || 0)) + '"',
                    'data-file-size="' + escapeHtml(String((normalized._contentMeta && normalized._contentMeta.fileSize) || "")) + '"',
                    'data-original-size="' + escapeHtml(String((normalized._contentMeta && normalized._contentMeta.originalSize) || "")) + '"'
                ].join(" ");
                var mediaMarkup = '';
                if (normalized.media_url) {
                    if (normalized.media_type === 'video') mediaMarkup = '<div class="media"><video src="' + escapeHtml(normalized.media_url) + '" controls preload="none" playsinline></video></div>';
                    else if (normalized.media_type === 'audio') mediaMarkup = '<div class="media"><audio src="' + escapeHtml(normalized.media_url) + '" controls preload="metadata"></audio></div>';
                    else mediaMarkup = '<div class="media"><img ' + mediaDataAttrs + ' data-actor-key="' + escapeHtml(String(normalized.actor_key || '')) + '" data-can-delete="' + (canDelete ? '1' : '0') + '" src="' + escapeHtml(normalized.media_url) + '" loading="lazy" decoding="async" fetchpriority="low" onclick="openImageViewer(\'' + safeJsStr(normalized.media_url) + '\', this)"></div>';
                }
                return `
                <div class="post glass" data-post-id="${escapeHtml(normalized.id)}" data-post-user="${escapeHtml(normalized.user_name || "")}">
                  <div class="post-header">
                    ${getAvatarHtml(normalized.user_name, normalized)}
                    <div class="post-header-main">
                      <div class="user-info">
                        <span class="user-name">${escapeHtml(normalized.user_name)}</span>
                        <span class="post-time post-meta-line">${escapeHtml(formatPostTime(normalized))}</span>
                      </div>
                      <div class="post-badge-stack">${buildPostBadges(normalized)}</div>
                    </div>
                  </div>
                  <div class="content">${buildPostContentHtml(normalized.content)}</div>
                  ${mediaMarkup}
                  ${buildPostLocationHtml(normalized)}
                  <div class="post-stats-text">${buildPostStatsLine(normalized, pLikes.length, pComms.length)}</div>
                  <div class="actions">${buildPostActionHtml(normalized, isLiked, canDelete)}</div>
                  ${pComms.length ? `<div class="comments">${(function(){
                      var roots = pComms.filter(function(c) { return !c.parent_comment_id; });
                      var children = pComms.filter(function(c) { return c.parent_comment_id; });
                      var html = '';
                      roots.forEach(function(r) {
                        html += '<div class="comment-item" data-comment-id="' + escapeHtml(r.id) + '"><div><b>' + escapeHtml(r.user_name) + ':</b> ' + escapeHtml(r.content) + '</div>' + commentDeleteButton(r);
                        var replies = children.filter(function(c) { return String(c.parent_comment_id) === String(r.id); });
                        if (replies.length > 0) {
                          html += '<div class="comment-replies" style="margin-left:24px; margin-top:8px;">' + replies.map(function(c) {
                            if (c.user_name === 'cat_ai' && c.generated_by_ai) {
                               return '<div class="comment-item cat-ai-comment" data-comment-id="' + escapeHtml(c.id) + '" data-parent-comment-id="' + escapeHtml(c.parent_comment_id || '') + '"><div class="comment-item-inner"><span class="cat-ai-avatar" aria-label="小猫">🐱</span><div class="comment-item-body"><div class="comment-item-header"><b class="cat-ai-name">小猫</b><span class="cat-ai-badge">AI</span><span class="comment-item-time">' + escapeHtml(c.created_at ? formatRelativeTime(c.created_at) : '刚刚') + '</span>' + commentDeleteButton(c) + '</div><div class="comment-item-content">' + escapeHtml(c.content) + '</div></div></div></div>';
                            }
                            return '<div class="comment-item" data-comment-id="' + escapeHtml(c.id) + '"><div><b>' + escapeHtml(c.user_name) + ':</b> ' + escapeHtml(c.content) + '</div>' + commentDeleteButton(c) + '</div>';
                          }).join('') + '</div>';
                        }
                        html += '</div>';
                      });
                      return html;
                  })()}</div>` : ''}
                </div>`;
            }

            // A malformed legacy record must not take down the complete feed.
            function renderPostCardSafely(post, commentMap, likeMap, likeUserMap) {
                try {
                    return renderPostCard(post, commentMap, likeMap, likeUserMap);
                } catch (error) {
                    console.error('[feed-render] failed post:', {
                        postId: post && post.id,
                        userName: post && post.user_name,
                        error: error
                    });
                    return '';
                }
            }

            function hydrateCachedAvatarsForUsers(usernames) {
                var users = Array.from(new Set((usernames || []).map(function(value) {
                    return String(value || '').trim();
                }).filter(Boolean)));
                if (!users.length) return;
                try {
                    var cachedAvatars = readAvatarCacheFromStorage();
                    users.forEach(function(userName) {
                        if (!avatarCache[userName] && cachedAvatars[userName]) avatarCache[userName] = cachedAvatars[userName];
                    });
                } catch (e) {}
            }

            function updatePostFilterStateFromDom() {
                var keywordEl = document.getElementById("postSearchInput");
                var userEl = document.getElementById("postUserFilter");
                var startEl = document.getElementById("postStartDate");
                var endEl = document.getElementById("postEndDate");
                var visibilityEl = document.getElementById("postVisibilityFilter");
                var mineEl = document.getElementById("postOnlyMine");
                postSearchState = {
                    keyword: keywordEl ? keywordEl.value.trim() : "",
                    user: userEl ? userEl.value.trim() : "",
                    startDate: startEl ? startEl.value : "",
                    endDate: endEl ? endEl.value : "",
                    visibility: visibilityEl ? visibilityEl.value : "all",
                    onlyMine: !!(mineEl && mineEl.checked)
                };
            }

            window.applyPostFilters = function() {
                updatePostFilterStateFromDom();
                feedPage = 1;
                feedEndReached = false;
                var feed = document.getElementById("feed");
                if (feed) {
                    feed.innerHTML = getXtjLoadingHtml('内容加载中..', '', 'feed');
                }
                renderFeed({ posts: feedAllPosts, comments: feedAllComments, likes: feedAllLikes });
            };

            window.clearPostFilters = function() {
                var ids = ["postSearchInput", "postUserFilter", "postStartDate", "postEndDate"];
                ids.forEach(function(id) {
                    var el = document.getElementById(id);
                    if (el) el.value = "";
                });
                var visibilityEl = document.getElementById("postVisibilityFilter");
                var mineEl = document.getElementById("postOnlyMine");
                if (visibilityEl) visibilityEl.value = "all";
                if (mineEl) mineEl.checked = false;
                postSearchState = {
                    keyword: "",
                    user: "",
                    startDate: "",
                    endDate: "",
                    visibility: "all",
                    onlyMine: false
                };
                feedPage = 1;
                feedEndReached = false;
                var panel = document.getElementById("postFilterPanel");
                if (panel) panel.style.display = "none";
                var btn = document.getElementById("filterToggleBtn");
                if (btn) btn.classList.remove("active");
                renderPostFilterUsers();
                renderFeed({ posts: feedAllPosts, comments: feedAllComments, likes: feedAllLikes });
            };

            function bindPostFilterEvents() {
                if (window._postFilterEventsBound) return;
                window._postFilterEventsBound = true;
                ["postSearchInput", "postUserFilter", "postStartDate", "postEndDate", "postVisibilityFilter", "postOnlyMine"].forEach(function(id) {
                    var el = document.getElementById(id);
                    if (!el) return;
                    var eventName = el.type === "checkbox" || el.tagName === "SELECT" || el.type === "date" ? "change" : "input";
                    if (eventName === "input") {
                        // ★ 修复：搜索输入防抖 300ms，避免每次击键全量重建 feed DOM
                        var debounceTimer = null;
                        el.addEventListener(eventName, function() {
                            if (debounceTimer) clearTimeout(debounceTimer);
                            debounceTimer = setTimeout(function() {
                                debounceTimer = null;
                                window.applyPostFilters();
                            }, 300);
                        });
                    } else {
                        el.addEventListener(eventName, function() {
                            window.applyPostFilters();
                        });
                    }
                });
            }

            window.toggleFilterPanel = function() {
                var panel = document.getElementById("postFilterPanel");
                var btn = document.getElementById("filterToggleBtn");
                if (!panel) return;
                var isHidden = panel.style.display === "none" || window.getComputedStyle(panel).display === "none";
                if (isHidden) {
                    panel.style.display = "flex";
                    if (btn) btn.classList.add("active");
                    loadPostFilterUsers(true);
                    renderPostFilterUsers();
                } else {
                    panel.style.display = "none";
                    if (btn) btn.classList.remove("active");
                }
            };

            window._legacyTogglePostPinBase = async function(postId, btn) {
                if (!postId) { showToast("置顶失败: postId 为空"); return; }
                var nextPinned;
                var originalText;
                if (btn) {
                    originalText = btn.textContent;
                    btn.disabled = true;
                    btn.textContent = '处理中..';
                }
                try {
                    // Fetch current post state directly from DB (only select columns that exist)
                    var fetchRes = await sb.from('posts').select('*').eq('id', postId).maybeSingle();
                    if (fetchRes.error) { alert('查询失败: ' + fetchRes.error.message); throw fetchRes.error; }
                    if (!fetchRes.data) { alert('未找到帖子(id=' + postId + ')'); throw new Error('not found'); }
                    var dbPost = normalizePost(fetchRes.data);
                    // Check permission
                    if (currentUser !== dbPost.user_name && currentUser !== ADMIN_NAME) {
                        showToast('无权置顶');
                        if (btn) { btn.disabled = false; btn.textContent = originalText; }
                        return;
                    }
                    nextPinned = !dbPost.is_pinned;
                    btn.textContent = nextPinned ? '置顶中..' : '取消中..';
                    // P0: 改为后端 API (service_role), 不走前端 direct UPDATE
                    var updHeaders = (typeof window.getUserAuthHeaders === 'function')
                        ? await window.getUserAuthHeaders() : null;
                    if (!updHeaders) { showToast('登录已失效'); if (btn) { btn.disabled = false; btn.textContent = originalText; } return; }
                    var updResp = await fetch((window.API_BASE || '') + '/api/post/update', {
                        method: 'POST',
                        headers: updHeaders,
                        body: JSON.stringify({ post_id: postId, is_pinned: nextPinned })
                    });
                    var updResult = await updResp.json();
                    if (!updResp.ok || !updResult.ok) { alert('更新失败: ' + (updResult.error || '服务器错误')); throw new Error(updResult.error); }
                    clearFeedCache();
                    showToast(nextPinned ? '帖子已置顶' : '已取消置顶');
                    await loadFeed(true);
                } catch (e) {
                    console.error('[togglePostPin] error:', e);
                    if (btn) { btn.disabled = false; btn.textContent = originalText || '置顶'; }
                    if (!/^[\u4e00-\u9fa5]/.test(e && e.message || '')) {
                        showToast('操作异常，请查看控制台');
                    }
                }
            };
            window._legacyTogglePostPin = async function(postId, btn) {
                if (!postId) { showToast("置顶失败: postId 为空"); return; }
                var nextPinned;
                var originalText;
                if (btn) {
                    originalText = btn.textContent;
                    btn.disabled = true;
                    btn.textContent = '处理中..';
                }
                try {
                    var fetchRes = await sb.from('posts').select('*').eq('id', postId).maybeSingle();
                    if (fetchRes.error) throw fetchRes.error;
                    if (!fetchRes.data) throw new Error('未找到对应帖子');
                    var dbPost = normalizePost(fetchRes.data);
                    if (!isAdmin()) {
                        showToast('无权置顶');
                        return;
                    }
                    nextPinned = !dbPost.is_pinned;
                    if (btn) btn.textContent = nextPinned ? '置顶中..' : '取消中..';
                    var updateRes = await updatePostRecord(fetchRes.data, {
                        is_pinned: nextPinned,
                        pinned_at: nextPinned ? new Date().toISOString() : null,
                        updated_at: new Date().toISOString()
                    });
                    if (!updateRes.ok) {
                        showToast('置顶失败: ' + ((updateRes.error && updateRes.error.message) || '未知错误'));
                        return;
                    }
                    clearFeedCache();
                    await loadFeed(true);
                    showToast(nextPinned ? '帖子已置顶' : '已取消置顶');
                } catch (e) {
                    console.error('[togglePostPin override] error:', e);
                    showToast('置顶失败: ' + (e && e.message ? e.message : '未知错误'));
                } finally {
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = originalText || '置顶';
                    }
                }
            };
            var feedCacheWriteTimer = null;
            function shouldPersistMediaUrl(url) {
                url = String(url || '');
                if (!url) return false;
                if (/^(data:|blob:)/i.test(url)) return false;
                if (url.length > 900) return false;
                return true;
            }

            function toLightweightFeedPost(post) {
                if (!post || typeof post !== 'object') return post;
                var snapshot = Object.assign({}, post);
                if (!shouldPersistMediaUrl(snapshot.media_url)) snapshot.media_url = '';
                return snapshot;
            }

            function persistFeedCacheSnapshotNow() {
                try {
                    var firstPage = (feedLoadedPages || []).find(function(page) { return page && page.offset === 0; });
                    var firstPageIds = new Set((firstPage && Array.isArray(firstPage.postIds) ? firstPage.postIds : (feedAllPosts || []).slice(0, FEED_PAGE_SIZE).map(function(post) {
                        return String(post && post.id || '');
                    })).filter(Boolean));
                    var cachePosts = (feedAllPosts || []).filter(function(post) {
                        return post &&
                            firstPageIds.has(String(post.id || '')) &&
                            !isSystemPost(post);
                    }).map(toLightweightFeedPost);
                    var cacheComments = (feedAllComments || []).filter(function(comment) {
                        return comment && firstPageIds.has(String(comment.post_id || ''));
                    });
                    var cacheLikes = (feedAllLikes || []).filter(function(like) {
                        return like && firstPageIds.has(String(like.post_id || ''));
                    });
                    localStorage.setItem(CACHE_KEY, JSON.stringify({
                        version: 7,
                        data: {
                            posts: cachePosts,
                            comments: cacheComments,
                            likes: cacheLikes,
                            pages: cachePosts.length ? [{
                                offset: 0,
                                postIds: cachePosts.map(function(post) { return String(post.id); })
                            }] : [],
                            nextOffset: cachePosts.length,
                            endReached: cachePosts.length < FEED_PAGE_SIZE,
                            pageSize: FEED_PAGE_SIZE
                        },
                        timestamp: Date.now()
                    }));
                } catch (e) {
                    console.warn('[feed-cache] failed to persist feed cache', e);
                }
            }

            function writeFeedCacheSnapshot() {
                try {
                    if (feedCacheWriteTimer) clearTimeout(feedCacheWriteTimer);
                    feedCacheWriteTimer = setTimeout(function() {
                        feedCacheWriteTimer = null;
                        persistFeedCacheSnapshotNow();
                    }, 900);
                } catch (e) {
                    console.warn('[feed-cache] failed to schedule feed cache write', e);
                }
            }

            function getFeedRecordKey(record, fallbackParts) {
                if (!record) return "";
                if (record.id !== undefined && record.id !== null && record.id !== "") return String(record.id);
                return (fallbackParts || []).map(function(part) {
                    return String(part == null ? "" : part);
                }).join("|");
            }

            function mergeFeedRecords(existing, incoming, keyResolver, shouldSortPosts) {
                var map = new Map();
                (existing || []).forEach(function(item) {
                    if (!item) return;
                    map.set(keyResolver(item), item);
                });
                (incoming || []).forEach(function(item) {
                    if (!item) return;
                    map.set(keyResolver(item), item);
                });
                var merged = Array.from(map.values());
                return shouldSortPosts ? sortPosts(merged) : merged;
            }

            function normalizeFeedSnapshotCache(parsed) {
                if (!parsed || !parsed.data) return null;
                var data = parsed.data || {};
                var posts = normalizePosts(data.posts || []).filter(function(post) {
                    return !(typeof isSystemPost === 'function' && isSystemPost(post));
                });
                var pages = Array.isArray(data.pages) ? data.pages.filter(function(page) {
                    return page && typeof page.offset === "number";
                }) : [];
                if (!pages.length && posts.length) {
                    pages = [{
                        offset: 0,
                        postIds: posts.slice(0, FEED_PAGE_SIZE).map(function(post) { return String(post.id); })
                    }];
                }
                return {
                    version: parsed.version || 7, // 必须与 CACHE_KEY v7 一致，旧缓存自动以新版本重写
                    timestamp: parsed.timestamp || 0,
                    data: {
                        posts: posts,
                        comments: Array.isArray(data.comments) ? data.comments : [],
                        likes: Array.isArray(data.likes) ? data.likes : [],
                        pages: pages,
                        nextOffset: typeof data.nextOffset === "number" ? data.nextOffset : posts.length,
                        endReached: typeof data.endReached === "boolean" ? data.endReached : (posts.length < FEED_PAGE_SIZE),
                        pageSize: data.pageSize || FEED_PAGE_SIZE
                    }
                };
            }

            function hydrateFeedStateFromSnapshot(snapshot) {
                var normalized = normalizeFeedSnapshotCache(snapshot);
                if (!normalized) return false;
                feedAllPosts = normalized.data.posts || [];
                feedAllComments = normalized.data.comments || [];
                feedAllLikes = normalized.data.likes || [];
                feedLoadedPages = normalized.data.pages || [];
                feedNextOffset = typeof normalized.data.nextOffset === "number" ? normalized.data.nextOffset : feedAllPosts.length;
                feedEndReached = !!normalized.data.endReached;
                return true;
            }

            // 统一：应用所有需要从普通帖子流中排除的系统标记
            // 集中维护，避免漏掉 __pro_gift__ / __pro_gift_claim__ / __vip_plan__ 等
            function applyVisiblePostQueryFilters(query) {
                if (!query || typeof query.neq !== 'function') return query;
                return query
                    .neq("media_type", AUTH_MARKER)
                    .neq("media_type", ADMIN_AUTH_MARKER)
                    .neq("media_type", ADMIN_META_MARKER)
                    .neq("media_type", DM_MARKER)
                    .neq("media_type", REPORT_MARKER)
                    .neq("media_type", "__avatar__")
                    .neq("media_type", "__user_info__")
                    .neq("media_type", "__photo_wall__")
                    .neq("media_type", "__visit__")
                    .neq("media_type", "__attack__")
                    .neq("media_type", "__user_visit__")
                    .neq("media_type", "__post_view__")
                    .neq("media_type", "__ann__")
                    .neq("media_type", "__ann_read__")
                    .neq("media_type", "__vip__")
                    .neq("media_type", "__vip_order__")
                    .neq("media_type", "__vip_plan__")
                    .neq("media_type", "__user_style__")
                    .neq("media_type", "__pro_gift__")
                    .neq("media_type", "__pro_gift_claim__")
                    .neq("media_type", "__login_event__")
                    .neq("media_type", "__user_behavior__")
                    .neq("media_type", "__security_alert__")
                    .neq("media_type", "__admin_audit__")
                    .neq("media_type", "__client_error__")
                    .neq("media_type", "__email_sent__")
                    .neq("media_type", "__email_recipient_history__")
                    .neq("media_type", "__ai_agent_profile__")
                    .neq("media_type", "__ai_agent_msg__")
                    .neq("media_type", "__ai_agent_memory__")
                    .neq("media_type", "__ai_agent_config__")
                    .neq("media_type", "**ai_agent_memory_box**")
                    .neq("media_type", "**ai_agent_conv_summary**")
                    .neq("media_type", "**ai_agent_memory_log**")
                    .neq("media_type", "__refresh_token__")
                    .neq("media_type", "__revoked_token__")
                    .neq("media_type", "__ai_english_learning__")  // 退役模块，保留过滤防止旧数据泄漏
                    .neq("media_type", "__location_task__");
            }
            window.applyVisiblePostQueryFilters = applyVisiblePostQueryFilters;

            // 客户端过滤：单一帖子是否对当前用户可见
            function isSystemPost(post) {
                if (!post) return true;
                var mt = post.media_type;
                if (!mt) return false;
                var SYSTEM_MARKERS = [
                    AUTH_MARKER, ADMIN_AUTH_MARKER, ADMIN_META_MARKER, DM_MARKER, REPORT_MARKER,
                    "__avatar__", "__user_info__", "__photo_wall__", "__visit__",
                    "__attack__", "__user_visit__", "__post_view__", "__ann__", "__ann_read__",
                    "__vip__", "__vip_order__", "__vip_plan__", "__user_style__",
                    "__pro_gift__", "__pro_gift_claim__",
                    "__login_event__", "__user_behavior__", "__security_alert__", "__admin_audit__", "__client_error__",
                    "__email_sent__", "__email_recipient_history__",
                    "__refresh_token__", "__revoked_token__",
                    "__ai_agent_profile__", "__ai_agent_msg__", "__ai_agent_memory__", "__ai_agent_config__",
                    "**ai_agent_memory_box**", "**ai_agent_conv_summary**", "**ai_agent_memory_log**",
                    "__location_task__",
                    "__ai_english_learning__"  // 退役模块，保留过滤防止旧数据泄漏
                ];
                return SYSTEM_MARKERS.indexOf(mt) >= 0;
            }
            window.isSystemPost = isSystemPost;

            function getFeedBasePostQuery() {
                if (!sb) {
                    return {
                        range: function() { return Promise.resolve({ data: [], error: null }); }
                    };
                }
                return applyVisiblePostQueryFilters(
                    sb.from("posts").select("*")
                ).order("created_at", { ascending: false });
            }

            async function fetchFeedPageChunk(offset, requestId, deferRelated) {
                var start = Math.max(0, Number(offset) || 0);
                var page = Math.floor(start / FEED_PAGE_SIZE);
                var posts = [];
                var comments = [];
                var likes = [];
                var endReached = false;
                var usedApi = false;

                // 优先使用后端 API（支持私密帖子可见性过滤）
                try {
                    var apiResp = await window.xtjOptionalAuthFetch('/api/feed?page=' + page + '&limit=' + FEED_PAGE_SIZE);
                    if (apiResp.ok) {
                        var apiData = await apiResp.json();
                        if (apiData && apiData.ok) {
                            posts = normalizePosts(apiData.posts || []);
                            comments = apiData.comments || [];
                            likes = apiData.likes || [];
                            endReached = apiData.endReached || false;
                            if (typeof apiData.total_post_count === 'number') window._xtjTotalPostCount = apiData.total_post_count;
                            // 使用服务器返回的 next_offset，不自行计算
                            start = apiData.next_offset != null ? apiData.next_offset : start + posts.length;
                            usedApi = true;
                        }
                    }
                } catch (apiErr) {
                    console.warn('[feed] API unavailable, fallback to Supabase:', apiErr && apiErr.message);
                }

                if (!usedApi) {
                    // 回退：Supabase 直连（RLS 仅返回公开帖子）
                    var end = start + FEED_PAGE_SIZE - 1;
                    var postRes = await getFeedBasePostQuery().range(start, end);
                    if (requestId && requestId !== feedLoadRequestId) return null;
                    if (postRes.error) throw postRes.error;
                    posts = normalizePosts(postRes.data || []);
                    endReached = posts.length < FEED_PAGE_SIZE;
                    try {
                        var countRes = await applyVisiblePostQueryFilters(sb.from('posts').select('id', { count: 'exact', head: true }));
                        if (countRes.count !== null) window._xtjTotalPostCount = countRes.count;
                    } catch(e) {}
                }

                if (requestId && requestId !== feedLoadRequestId) return null;
                var postIds = posts.map(function(post) { return String(post.id); }).filter(Boolean);
                var relatedPromise = null;

                if (postIds.length && !usedApi) {
                    // 仅 Supabase 直连时需要单独获取评论和点赞
                    if (!sb) {
                        relatedPromise = Promise.resolve([ { data: [], error: null }, { data: [], error: null } ]);
                    } else {
                        relatedPromise = Promise.all([
                            sb.from("comments").select("*").in("post_id", postIds).order("created_at"),
                            sb.from("likes").select("*").in("post_id", postIds)
                        ]);
                    }
                    if (deferRelated) {
                        return {
                            offset: start,
                            posts: posts,
                            comments: comments,
                            likes: likes,
                            nextOffset: start + posts.length,
                            endReached: endReached,
                            postIds: postIds,
                            relatedPromise: relatedPromise
                        };
                    }
                    var related = await relatedPromise;
                    if (requestId && requestId !== feedLoadRequestId) return null;
                    if (related[0].error || related[1].error) {
                        throw (related[0].error || related[1].error);
                    }
                    comments = related[0].data || [];
                    likes = related[1].data || [];
                }

                return {
                    offset: start,
                    posts: posts,
                    comments: comments,
                    likes: likes,
                    nextOffset: start + posts.length,
                    endReached: endReached,
                    postIds: postIds
                };
            }

            function hydrateDeferredFeedRelations(chunk, requestId) {
                if (!chunk || !chunk.relatedPromise) return Promise.resolve(false);
                return chunk.relatedPromise.then(function(related) {
                    if (requestId !== feedLoadRequestId) return false;
                    if (related[0].error || related[1].error) {
                        throw (related[0].error || related[1].error);
                    }
                    mergeFeedPageIntoState({
                        offset: chunk.offset,
                        posts: [],
                        comments: related[0].data || [],
                        likes: related[1].data || [],
                        nextOffset: chunk.nextOffset,
                        endReached: chunk.endReached,
                        postIds: chunk.postIds
                    });
                    writeFeedCacheSnapshot();
                    return renderFeedFromMemoryState().then(function() { return true; });
                }).catch(function(error) {
                    console.warn('[feed] engagement hydration failed:', error);
                    return false;
                });
            }

            function mergeFeedPageIntoState(chunk) {
                if (!chunk) return;
                feedAllPosts = mergeFeedRecords(feedAllPosts, chunk.posts, function(post) {
                    return getFeedRecordKey(post, [post && post.user_name, post && post.created_at]);
                }, true);
                feedAllComments = mergeFeedRecords(feedAllComments, chunk.comments, function(comment) {
                    return getFeedRecordKey(comment, [comment && comment.post_id, comment && comment.user_name, comment && comment.created_at, comment && comment.content]);
                });
                feedAllLikes = mergeFeedRecords(feedAllLikes, chunk.likes, function(like) {
                    return getFeedRecordKey(like, [like && like.post_id, like && like.user_name, like && like.created_at]);
                });
                var pagePostIds = chunk.postIds || [];
                var pageExists = (feedLoadedPages || []).some(function(page) { return page && page.offset === chunk.offset; });
                if (!pageExists) {
                    feedLoadedPages = (feedLoadedPages || []).concat([{
                        offset: chunk.offset,
                        postIds: pagePostIds
                    }]).sort(function(a, b) { return a.offset - b.offset; });
                }
                feedNextOffset = Math.max(feedNextOffset || 0, chunk.nextOffset || 0);
                if (chunk.endReached) feedEndReached = true;
                (chunk.posts || []).forEach(syncPostInfoCache);
                markFeedStateChanged();
            }

            function hasActiveFeedFilters() {
                var state = getPostSearchState();
                return !!(state.keyword || state.user || state.startDate || state.endDate || state.onlyMine || (state.visibility && state.visibility !== "all"));
            }

            async function ensureFeedCoverageForVisibleSlice(minVisiblePosts, requestId) {
                var target = Math.max(Number(minVisiblePosts) || 0, FEED_PAGE_SIZE);
                var guard = 0;
                while (!feedEndReached && guard < 12) {
                    var filteredPosts = getFilteredPosts(feedAllPosts || [], feedAllComments || []);
                    if (filteredPosts.length >= target) break;
                    var chunk = await fetchFeedPageChunk(feedNextOffset, requestId);
                    if (!chunk) return false;
                    if (!chunk.posts.length) {
                        feedEndReached = true;
                        break;
                    }
                    mergeFeedPageIntoState(chunk);
                    guard++;
                }
                writeFeedCacheSnapshot();
                return true;
            }

            function syncPinnedPostIntoFeedState(serverPost) {
                if (!serverPost || !serverPost.id) return false;
                var found = false;
                feedAllPosts = sortPosts((feedAllPosts || []).map(function(post) {
                    if (String(post.id) !== String(serverPost.id)) return post;
                    found = true;
                    return Object.assign({}, post, serverPost);
                }));
                return found;
            }

            async function renderFeedFromMemoryState() {
                await renderFeed({
                    posts: feedAllPosts || [],
                    comments: feedAllComments || [],
                    likes: feedAllLikes || []
                });
                // Phase 3-P0-5: Feed 重渲染后恢复持久化的 retryable 状态，
                // 避免评论重渲染导致小猫 AI 重试按钮丢失。
                try { if (typeof restoreCatAiRetryableStatuses === 'function') restoreCatAiRetryableStatuses(); } catch(e) {}
            }

            async function rebuildFeedFromCurrentState() {
                feedPage = 1;
                var noMore = document.getElementById('feedNoMore');
                if (noMore) noMore.remove();
                await renderFeedFromMemoryState();
                if (typeof setupFeedInfiniteScroll === 'function') {
                    setupFeedInfiniteScroll();
                }
            }

            window.xtjPrependPostToFeed = async function(serverPost) {
                if (!serverPost || !serverPost.id) return false;
                var normalized = normalizePost(serverPost);
                var exists = false;
                feedAllPosts = sortPosts((feedAllPosts || []).map(function(post) {
                    if (!post || String(post.id) !== String(normalized.id)) return post;
                    exists = true;
                    return Object.assign({}, post, normalized);
                }));
                if (!exists) {
                    feedAllPosts = sortPosts([normalized].concat(feedAllPosts || []));
                }
                writeFeedCacheSnapshot();
                await rebuildFeedFromCurrentState();
                return true;
            };

            async function refreshPostDetailIfActive(postId) {
                if (!postId || String(activePostId || '') !== String(postId)) return;
                if (typeof window.openPostDetail !== 'function') return;
                try {
                    await window.openPostDetail(postId);
                } catch (e) {
                    console.warn('[pin] failed to refresh post detail', e);
                }
            }

            async function verifyPinnedPostInBackground(postId, expectedPinned) {
                try {
                    var snapshot = await fetchPostSnapshot(postId);
                    if (!snapshot) throw new Error('not found');
                    var normalized = normalizePost(snapshot);
                    var synced = syncPinnedPostIntoFeedState(snapshot);
                    writeFeedCacheSnapshot();
                    if (!!normalized.is_pinned !== !!expectedPinned) {
                        if (synced) {
                            await rebuildFeedFromCurrentState();
                            await refreshPostDetailIfActive(postId);
                        }
                        showToast('置顶状态已按服务器结果校正');
                    }
                } catch (e) {
                    console.error('[pin] background verify failed', e);
                    showToast('置顶已更新，但后台校验失败: ' + (e && e.message ? e.message : '未知错误'));
                }
            }

            async function syncFeedDataInBackground() {
                try {
                    await loadFeed(true);
                    return true;
                } finally {
                    isRefreshing.posts = false;
                }
            }

            function pinMotionReduced() {
                return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
            }

            function getActualScrollSurface(startNode) {
                var current = startNode || document.getElementById('feed');
                while (current && current !== document.body && current !== document.documentElement) {
                    if (current.scrollHeight > current.clientHeight) {
                        var style = window.getComputedStyle(current);
                        if (style.overflowY === 'auto' || style.overflowY === 'scroll') return current;
                    }
                    current = current.parentElement;
                }
                
                var se = document.scrollingElement || document.documentElement;
                if (se && se.scrollHeight > se.clientHeight) {
                    var seStyle = window.getComputedStyle(se);
                    if (seStyle.overflowY !== 'hidden' && seStyle.overflowY !== 'clip') {
                        return window;
                    }
                }
                return window;
            }

            function waitForPinScroll(surface, targetTop, timeoutMs) {
                return new Promise(function(resolve) {
                    var actualSurface = getActualScrollSurface(surface);
                    if (!actualSurface || pinMotionReduced()) return resolve();
                    
                    var getScroll = function() { return actualSurface === window ? window.scrollY : actualSurface.scrollTop; };
                    if (Math.abs(getScroll() - targetTop) <= 2) return resolve();
                    
                    var isResolved = false;
                    var timeoutId;
                    
                    function finish() {
                        if (isResolved) return;
                        isResolved = true;
                        clearTimeout(timeoutId);
                        actualSurface.removeEventListener('scrollend', onScrollEnd);
                        resolve();
                    }
                    
                    function onScrollEnd() {
                        if (Math.abs(getScroll() - targetTop) <= 2) finish();
                    }
                    
                    actualSurface.addEventListener('scrollend', onScrollEnd);
                    timeoutId = setTimeout(finish, timeoutMs);
                });
            }

            function getPinnedPostScrollTarget(surface) {
                var feed = document.getElementById('feed');
                if (!feed) return 0;
                var actualSurface = getActualScrollSurface(surface);
                var feedRect = feed.getBoundingClientRect();
                var nav = document.querySelector('.posts-nav.sticky-header') || (surface ? surface.querySelector('.posts-nav') : null);
                var navRect = nav ? nav.getBoundingClientRect() : null;
                
                if (actualSurface === window) {
                    var navHeight = navRect && navRect.bottom > 0 ? Math.max(0, navRect.height) : 0;
                    return Math.max(0, Math.round(window.scrollY + feedRect.top - navHeight - 12));
                } else {
                    var surfaceRect = actualSurface.getBoundingClientRect();
                    var navHeight = navRect && navRect.bottom > surfaceRect.top ? Math.max(0, navRect.height) : 0;
                    return Math.max(0, Math.round(actualSurface.scrollTop + feedRect.top - surfaceRect.top - navHeight - 12));
                }
            }

            async function beginPinnedPostTransition(postEl) {
                var surface = document.getElementById('panelPosts');
                if (postEl && postEl.isConnected && !pinMotionReduced()) {
                    postEl.classList.add('post-pin-departing');
                }
                var actualSurface = getActualScrollSurface(surface);
                var targetTop = getPinnedPostScrollTarget(surface);
                if (pinMotionReduced()) {
                    actualSurface.scrollTo(0, targetTop);
                    return;
                }
                actualSurface.scrollTo({ top: targetTop, behavior: 'smooth' });
                await Promise.all([
                    new Promise(function(resolve) { setTimeout(resolve, 320); }),
                    waitForPinScroll(surface, targetTop, 620)
                ]);
            }

            function completePinnedPostTransition(postId) {
                var selector = '.post[data-post-id="' + String(postId).replace(/"/g, '\\"') + '"]';
                var postEl = document.querySelector(selector);
                var surface = document.getElementById('panelPosts');
                if (!postEl) return Promise.resolve(false);
                var actualSurface = getActualScrollSurface(surface);
                actualSurface.scrollTo(0, getPinnedPostScrollTarget(surface));
                if (pinMotionReduced()) return Promise.resolve(true);
                return new Promise(function(resolve) {
                    var completed = false;
                    var finish = function() {
                        if (completed) return;
                        completed = true;
                        postEl.classList.remove('post-pin-arriving');
                        postEl.removeEventListener('animationend', onAnimationEnd);
                        resolve(true);
                    };
                    var onAnimationEnd = function(event) {
                        if (event.target === postEl && event.animationName === 'xtj-pin-arrive') finish();
                    };
                    postEl.classList.remove('post-pin-arriving');
                    void postEl.offsetWidth;
                    postEl.addEventListener('animationend', onAnimationEnd);
                    postEl.classList.add('post-pin-arriving');
                    setTimeout(finish, 760);
                });
            }


            // Final pin action: server-side RPC enforces one pinned post per author.
            window.isPinningPost = false;
            window.togglePostPin = async function(postId, btn) {
                if (!postId) return;
                var normalizedPostId = String(postId || '').trim().toLowerCase();
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalizedPostId)) {
                    showToast('置顶失败：帖子参数无效');
                    return;
                }
                
                if (window.isPinningPost) return;
                window.isPinningPost = true;
                
                var originalText = btn ? btn.textContent : '';
                var nextPinned = false;
                var didSucceed = false;
                var serverSucceeded = false;
                var authoritativePinnedState = null;
                try {
                    if (btn) { btn.disabled = true; btn.textContent = '...'; }
                    var auth = typeof window.ensureProtectedOperationAuth === 'function'
                        ? await window.ensureProtectedOperationAuth()
                        : { ok: !!(typeof window.getUserAuthHeaders === 'function' && await window.getUserAuthHeaders()) };
                    if (!auth.ok) {
                        if (auth.reason !== 'expired' && auth.reason !== 'no_user') {
                            showToast('认证服务暂时不可用，请稍后重试');
                        }
                        return;
                    }

                    var currentPost = normalizePosts(feedAllPosts).find(function(item) {
                        return String(item.id).toLowerCase() === normalizedPostId;
                    });
                    
                    // Allow pinning even if not in feedAllPosts (e.g. detail view)
                    var isOwner = currentPost && String(currentUser || '').toLowerCase() === String(currentPost.user_name || '').toLowerCase();
                    if (currentPost && !isOwner && currentUser !== ADMIN_NAME) {
                        showToast('无权置顶此帖子');
                        return;
                    }
                    var isCurrentlyPinned = currentPost ? !!currentPost.is_pinned : (btn && (btn.getAttribute('data-pinned') === 'true' || originalText.indexOf('取消') !== -1));
                    nextPinned = !isCurrentlyPinned;
                    
                    var response = await window.xtjProtectedFetch('/api/post/pin', {
                        method: 'POST',
                        body: JSON.stringify({ post_id: normalizedPostId, is_pinned: Boolean(nextPinned) })
                    });
                    var result = await response.json().catch(function() { return {}; });
                    if (response.status === 401) {
                        return;
                    }
                    if (result.code === 'pin_migration_required') {
                        throw new Error('置顶服务尚未完成数据库升级，请部署迁移 008_atomic_post_pin.sql');
                    }
                    if (!response.ok || !result.ok || !result.data) throw new Error(result.error || '置顶操作失败');
                    serverSucceeded = true;
                    authoritativePinnedState = result.data.is_pinned;

                    (Array.isArray(result.unpinned_post_ids) ? result.unpinned_post_ids : []).forEach(function(id) {
                        syncPinnedPostIntoFeedState({ id: id, is_pinned: false, pinned_at: null });
                    });
                    
                    var postEl = document.querySelector('.post[data-post-id="' + normalizedPostId + '"]');
                    var willAnimatePin = nextPinned;
                    if (willAnimatePin) await beginPinnedPostTransition(postEl);

                    if (!syncPinnedPostIntoFeedState(result.data)) {
                        clearFeedCache();
                        await loadFeed(true);
                    } else {
                        writeFeedCacheSnapshot();
                        await rebuildFeedFromCurrentState();
                    }
                    await refreshPostDetailIfActive(normalizedPostId);
                    if (willAnimatePin) await completePinnedPostTransition(normalizedPostId);
                    didSucceed = true;
                    showToast(nextPinned ? '帖子已置顶' : '已取消置顶');
                } catch (e) {
                    if (serverSucceeded) {
                        console.error('[pin] render failed after server success', e);
                        showToast('置顶已更新，正在尝试恢复界面同步');
                        clearFeedCache();
                        loadFeed(true).catch(function(err){ console.error('loadFeed failed in catch', err); });
                        refreshPostDetailIfActive(normalizedPostId).catch(function(err){ console.error('refreshPostDetailIfActive failed in catch', err); });
                    } else {
                        console.error('[pin] atomic update failed', e);
                        showToast('置顶失败：' + (e && e.message ? e.message : '未知错误'));
                    }
                } finally {
                    var postEl = document.querySelector('.post[data-post-id="' + normalizedPostId + '"]');
                    if (postEl) postEl.classList.remove('post-pin-departing');
                    if (btn) {
                        btn.disabled = false;
                        if (authoritativePinnedState !== null) {
                            btn.textContent = authoritativePinnedState ? '取消置顶' : '置顶';
                            btn.setAttribute('data-pinned', authoritativePinnedState ? 'true' : 'false');
                        } else {
                            btn.textContent = didSucceed ? (nextPinned ? '取消置顶' : '置顶') : (originalText || '置顶');
                        }
                    }
                    window.isPinningPost = false;
                }
            };

            // G10 修复：可见性切换并发锁（与 togglePostPin 的 isPinningPost 对齐），
            // 防止双击基于同一旧 visibility 发两次更新 + 两次整页刷新
            window.isTogglingPostVisibility = false;
            window.togglePostVisibility = async function(postId, btn) {
                if (window.isTogglingPostVisibility) return;
                var post;
                var nextVisibility;
                // ★ 修复：失败分支已设置失败文案，若 finally 仍无条件重置为成功态文案
                // 会覆盖"操作失败/操作异常"的提示；handled 置位后 finally 不再重置。
                var handled = false;
                try {
                    post = normalizePosts(feedAllPosts).find(function(item) { return String(item.id) === String(postId); });
                    if (!post || !canEditPost(post)) {
                        showToast("无权修改这条帖子的隐私状态");
                        return;
                    }
                    if (btn) {
                        btn.disabled = true;
                        btn.textContent = "处理中..";
                    }
                    window.isTogglingPostVisibility = true;
                    nextVisibility = post.visibility === "private" ? "public" : "private";
                    var result = await updatePostRecord(post, {
                        visibility: nextVisibility
                    });
                    if (!result.ok) {
                        handled = true;
                        if (btn) { btn.disabled = false; btn.textContent = nextVisibility === "private" ? "🔒 设为私密" : "🌐 设为公开"; }
                        showToast("操作失败: " + ((result.error && result.error.message) || "未知错误"));
                        return;
                    }
                    clearFeedCache();
                    showToast(nextVisibility === "private" ? "已设为私密" : "已设为公开");
                    await loadFeed(true);
                } catch (e) {
                    handled = true;
                    console.error("togglePostVisibility error:", e);
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = "🔒 设为私密";
                    }
                    showToast("操作异常: " + (e && e.message ? e.message : "未知错误，请查看控制台"));
                } finally {
                    window.isTogglingPostVisibility = false;
                    if (!handled && btn) { btn.disabled = false; btn.textContent = nextVisibility === "private" ? "🌐 设为公开" : "🔒 设为私密"; }
                }
            };
            // ============== Global click delegation ==============
            document.addEventListener('click', function(e) {
                var postToolTrigger = e.target.closest('.post-tools-trigger');
                if (postToolTrigger) {
                    e.preventDefault();
                    openPostToolsMenu(postToolTrigger);
                    return;
                }
                var postToolAction = e.target.closest('[data-post-tool]');
                if (postToolAction) {
                    e.preventDefault();
                    if (!window.currentUser) { showToast('请先登录'); return; }
                    var postTool = postToolAction.getAttribute('data-post-tool');
                    var postToolPostId = postToolAction.getAttribute('data-post-id');
                    closePostToolsMenu();
                    if (postTool === 'translate' && typeof window.requestPostTranslation === 'function') {
                        window.requestPostTranslation(postToolPostId);
                    } else if (postTool === 'ask-ai' && typeof window.openPostAiChat === 'function') {
                        window.openPostAiChat(postToolPostId);
                    } else if (postTool === 'report' && typeof window.openPostReport === 'function') {
                        window.openPostReport(postToolPostId);
                    }
                    return;
                }
                if (activePostToolsMenu && !e.target.closest('.post-tools-menu')) closePostToolsMenu();
                // Pin button: delegate only (no inline onclick)
                var pinBtn = e.target.closest('.action-btn.pin');
                if (pinBtn) {
                    if (pinBtn.disabled) { return; }
                    var pid = pinBtn.getAttribute('data-post-id');
                    if (!pid) { return; }
                    window.togglePostPin(pid, pinBtn);
                    return;
                }
            });
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') closePostToolsMenu();
            });
            // ── 帖子位置功能 ──
            var postLocationData = null;
            var postLocationRequesting = false;

            window.requestPostLocation = function() {
                if (postLocationRequesting) return;
                var btn = document.getElementById('postLocationAddBtn');
                if (!btn) return;
                if (!navigator.geolocation) {
                    showToast('您的浏览器不支持定位功能');
                    return;
                }
                postLocationRequesting = true;
                btn.disabled = true;
                btn.textContent = '正在获取位置...';
                function requestPostLocationFix(options, onError) {
                    navigator.geolocation.getCurrentPosition(function(position) {
                        reverseGeocodePostLocation(position.coords.latitude, position.coords.longitude, position.coords.accuracy);
                    }, onError, options);
                }
                function finishLocationRequest(error) {
                    postLocationRequesting = false;
                    btn.disabled = false;
                    btn.textContent = '添加位置';
                    showToast(error && error.code === 1 ? '位置权限被拒绝，请在浏览器设置中允许定位' : '定位失败，请重试');
                }
                requestPostLocationFix({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }, function(error) {
                    if (error && error.code !== 1) {
                        // A timeout or unavailable GPS fix gets one bounded fallback request.
                        btn.textContent = '正在尝试备用定位...';
                        requestPostLocationFix({ enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }, function(fallbackError) {
                            postLocationRequesting = false;
                            btn.disabled = false;
                            btn.textContent = '📍 添加位置';
                            showToast('定位失败，请重试');
                        });
                        return;
                    }
                    finishLocationRequest(error);
                    return;
                });
            };

            async function reverseGeocodePostLocation(lat, lng, accuracy) {
                var btn = document.getElementById('postLocationAddBtn');
                try {
                    var resp = await window.xtjProtectedFetch('/api/location/reverse', {
                        method: 'POST',
                        body: JSON.stringify({ latitude: lat, longitude: lng, accuracy: Number(accuracy) || null })
                    });
                    var data = await resp.json().catch(function() { return {}; });
                    if (!resp.ok || !data.ok) {
                        showToast('地址解析失败: ' + (data.error || '请重试'));
                        postLocationRequesting = false;
                        if (btn) { btn.disabled = false; btn.textContent = '📍 添加位置'; }
                        return;
                    }
                    data.accuracy = Number(accuracy) || null;
                    showPostLocationOptions(data);
                } catch (e) {
                    showToast('地址解析失败，请检查网络');
                    postLocationRequesting = false;
                    if (btn) { btn.disabled = false; btn.textContent = '📍 添加位置'; }
                }
            }

            function showPostLocationOptions(geoData) {
                var panel = document.getElementById('postLocationPanel');
                var optionsEl = document.getElementById('postLocationOptions');
                if (!panel || !optionsEl) return;
                optionsEl.innerHTML = '';
                var options = geoData.options || [];
                if (options.length === 0) {
                    if (geoData.province && geoData.city) {
                        options.push({ level: 'city', name: geoData.province + geoData.city, province: geoData.province, city: geoData.city });
                    }
                    if (geoData.city && geoData.district) {
                        options.push({ level: 'district', name: geoData.city + geoData.district, province: geoData.province, city: geoData.city, district: geoData.district });
                    }
                }
                for (var i = 0; i < options.length; i++) {
                    var opt = options[i];
                    var optEl = document.createElement('div');
                    optEl.className = 'post-location-option';
                    optEl.textContent = opt.name;
                    optEl.setAttribute('role', 'button');
                    optEl.setAttribute('tabindex', '0');
                    (function(option) {
                        optEl.addEventListener('click', function() { selectPostLocationOption(option); });
                        optEl.addEventListener('keydown', function(e) {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPostLocationOption(option); }
                        });
                    })(opt);
                    optionsEl.appendChild(optEl);
                }
                panel.style.display = 'block';
                var addRow = document.getElementById('postLocationAddRow');
                if (addRow) addRow.style.display = 'none';
                postLocationRequesting = false;
                var btn = document.getElementById('postLocationAddBtn');
                if (btn) { btn.disabled = false; btn.textContent = '📍 添加位置'; }
            }

            window.selectPostLocationOption = function(option) {
                var panel = document.getElementById('postLocationPanel');
                var addRow = document.getElementById('postLocationAddRow');
                var preview = document.getElementById('postLocationPreview');
                var nameEl = document.getElementById('postLocationName');
                if (panel) panel.style.display = 'none';
                if (option && option.name) {
                    postLocationData = {
                        name: option.name,
                        province: option.province || '',
                        city: option.city || '',
                        district: option.district || '',
                        level: option.level || ''
                    };
                    if (nameEl) nameEl.textContent = option.name;
                    if (preview) preview.style.display = 'flex';
                    if (addRow) addRow.style.display = 'none';
                } else {
                    postLocationData = null;
                    if (preview) preview.style.display = 'none';
                    if (addRow) addRow.style.display = 'block';
                }
            };

            window.removePostLocation = function() {
                postLocationData = null;
                var preview = document.getElementById('postLocationPreview');
                var addRow = document.getElementById('postLocationAddRow');
                if (preview) preview.style.display = 'none';
                if (addRow) addRow.style.display = 'block';
            };

            function resetPostLocation() {
                postLocationData = null;
                postLocationRequesting = false;
                var panel = document.getElementById('postLocationPanel');
                var preview = document.getElementById('postLocationPreview');
                var addRow = document.getElementById('postLocationAddRow');
                var btn = document.getElementById('postLocationAddBtn');
                if (panel) panel.style.display = 'none';
                if (preview) preview.style.display = 'none';
                if (addRow) addRow.style.display = 'block';
                if (btn) { btn.disabled = false; btn.textContent = '📍 添加位置'; }
            }

            window.doPublish = async function () {
                if (!currentUser) { showToast("请先登录"); return; }
                var btn = document.getElementById("pubBtn");
                if (!btn || btn.disabled || btn.getAttribute('aria-busy') === 'true') return;
                if (isUserMuted()) { showToast("您已被禁言，无法发布内容"); return; }
                var content = document.getElementById("postInp").value.trim();
                var file = document.getElementById("fileInp").files[0];
                var visibilityEl = document.getElementById("postVisibility");
                var visibility = visibilityEl ? visibilityEl.value : "public";
                if (!content && !file) { showToast("请输入帖子内容"); return; }
                if (content.length > 2000) { showToast("内容不能超过2000字"); return; }
                var maxFileSize = 50 * 1024 * 1024;
                if (file && file.size > maxFileSize) { showToast("文件大小不能超过50MB"); return; }
                if (file) {
                    var allowedTypes = ['image/','video/','audio/'];
                    var typeOk = allowedTypes.some(function(t) { return file.type.startsWith(t); });
                    if (!typeOk) { showToast("不支持的文件类型，仅支持图片、视频、音频"); return; }
                }
                btn.disabled = true;
                btn.classList.add('is-loading');
                btn.setAttribute('aria-busy', 'true');
                btn.dataset.originalText = btn.textContent;
                btn.innerHTML = '<span>发布中</span>';
                var uploadedPath = '';
                try {
                    var media_url = "";
                    var media_type = "";
                    if (file) {
                        var path = buildStorageUploadPath('posts', file.name);
                        var uploadRes = await sb.storage.from("uploads").upload(path, file);
                        if (uploadRes.error) throw uploadRes.error;
                        uploadedPath = path;
                        media_url = sb.storage.from("uploads").getPublicUrl(path).data.publicUrl;
                        media_type = file.type.startsWith("image/") ? "image" : (file.type.startsWith("audio/") ? "audio" : "video");
                    }
                    var plainText = content.slice(0, 2000);
                    var metadata = collectPostMetadata ? collectPostMetadata(visibility, { location: postLocationData || null }) : { visibility: visibility || "public" };
                    var contentPayload = buildPostContentPayload(plainText, metadata);
                    var payload = {
                        user_name: currentUser,
                        content: contentPayload,
                        media_url: media_url,
                        media_type: media_type || null,
                        actor_key: deviceId,
                        visibility: metadata.visibility,
                        is_pinned: false,
                        pinned_at: null,
                        updated_at: null,
                        location: postLocationData || null
                    };
                    var insertRes = await insertPostRecord(payload, contentPayload);
                    if (!insertRes.ok) {
                        if (uploadedPath) {
                            try {
                                var cleanupResult = await sb.storage.from('uploads').remove([uploadedPath]);
                                if (cleanupResult && cleanupResult.error) console.warn('[post-publish] orphan cleanup failed', cleanupResult.error);
                            } catch (cleanupError) { console.warn('[post-publish] orphan cleanup failed', cleanupError); }
                            uploadedPath = '';
                        }
                        showToast("发布失败: " + ((insertRes.error && insertRes.error.message) || "未知错误"));
                        return;
                    }
                    uploadedPath = '';
                    touchUserSession(false);
                    resetPostComposer();
                    if (typeof window.resetPostPreview === "function") window.resetPostPreview();
                    showToast(insertRes.fallback ? "发布成功，已兼容旧数据结构" : "发布成功");
                    if (!insertPublishedPostIntoFeed(insertRes.data)) {
                        clearFeedCache();
                        await loadFeed(true);
                    } else {
                        writeFeedCacheSnapshot();
                    }
                    if (insertRes.data && insertRes.data.id) {
                        schedulePublishedPostIpRefresh(insertRes.data.id);
                    }
                    loadProfileActivity(true);
                } catch (e) {
                    if (uploadedPath) {
                        try {
                            var catchCleanupResult = await sb.storage.from('uploads').remove([uploadedPath]);
                            if (catchCleanupResult && catchCleanupResult.error) console.warn('[post-publish] orphan cleanup failed', catchCleanupResult.error);
                        } catch (cleanupError) { console.warn('[post-publish] orphan cleanup failed', cleanupError); }
                    }
                    showToast("发布失败: " + (e.message || "网络错误"));
                } finally {
                    btn.disabled = false;
                    btn.classList.remove('is-loading');
                    btn.setAttribute('aria-busy', 'false');
                    btn.textContent = btn.dataset.originalText || "发布动态";
                    delete btn.dataset.originalText;
                }
            };

            loadFeed = async function(forceRefresh) {
                // ★ 修复：loadFeed 语义为"重新加载 feed"——所有路径（缓存快路径/
                //   成功刷新/失败回退）都重置旧式 feedPage 计数器。此前刷新后
                //   feedPage 残留旧值，加载更多按旧页码计算导致误判 feedEndReached，
                //   无限滚动永久失效（"没有更多帖子"）直至刷新页面。
                feedPage = 1;
                var now = Date.now();
                var requestId = ++feedLoadRequestId;
                var stateVersionAtRequest = feedStateVersion;
                var hadLiveFeed = Array.isArray(feedAllPosts) && feedAllPosts.length > 0;
                if (forceRefresh) {
                    // Keep the rendered feed intact until a replacement page succeeds.
                    // A transient empty response must not turn a populated page into an empty one.
                    feedPageFetchPending = false;
                }
                bindPostFilterEvents();
                if (!forceRefresh) {
                    try {
                        var cached = window.safeStorage.get(CACHE_KEY);
                        if (cached) {
                            var parsed = JSON.parse(cached);
                            if (parsed && parsed.data && now - parsed.timestamp < CACHE_DURATION && hydrateFeedStateFromSnapshot(parsed)) {
                                if (requestId !== feedLoadRequestId) return;
                                await renderFeedFromMemoryState();
                                setupFeedInfiniteScroll();
                                ensureFeedCoverageForVisibleSlice(FEED_PAGE_SIZE, requestId).then(function() {
                                    if (requestId !== feedLoadRequestId) return;
                                    return renderFeedFromMemoryState();
                                }).catch(function(error) {
                                    console.warn('[feed] cached coverage refresh failed:', error);
                                });
                                return;
                            }
                        }
                    } catch (e) {}
                }
                var feed = document.getElementById("feed");
                if (!forceRefresh && feed) {
                    feed.innerHTML = getXtjLoadingHtml('内容加载中..', '', 'feed');
                }
                try {
                    feedPageFetchPending = true;
                    var chunk = await fetchFeedPageChunk(0, requestId, true);
                    if (!chunk) return;
                    if (requestId !== feedLoadRequestId) return;
                    // A publish may finish while this request is in flight.
                    // Preserve current state and merge this page when that happens.
                    if (stateVersionAtRequest === feedStateVersion) {
                        if (!chunk.posts.length && hadLiveFeed) {
                            console.warn('[feed] ignored empty refresh response while posts are visible');
                            return;
                        }
                        feedAllPosts = [];
                        feedAllComments = [];
                        feedAllLikes = [];
                        feedLoadedPages = [];
                        feedNextOffset = 0;
                        feedEndReached = false;
                        markFeedStateChanged();
                    }
                    if (chunk.posts.length) mergeFeedPageIntoState(chunk);
                    else feedEndReached = true;
                    writeFeedCacheSnapshot();
                    // 批量预加载所有出现过的用户的 VIP 历史（用于显示历史 Pro 帖子的 Pro 标志）
                    try {
                        if (typeof window.__xtjBatchLoadVipHistory === 'function') {
                            var userNames = feedAllPosts.map(function(p) { return p && p.user_name; }).filter(Boolean);
                            var vipLoadPromise = window.__xtjBatchLoadVipHistory(userNames);
                            // 5s 兜底：超过就放行，不阻塞 renderFeed
                            var vipLoadTimeout = new Promise(function(resolve) { setTimeout(resolve, 5000); });
                            Promise.race([vipLoadPromise, vipLoadTimeout]).then(function() {
                                // VIP 历史加载完后，强制 reRender 让 Pro 标志显示出来
                                if (window.__xtjVipHistoryCache) {
                                    try {
                                        if (typeof renderFeed === 'function') {
                                            renderFeed({ posts: feedAllPosts, comments: feedAllComments, likes: feedAllLikes });
                                        }
                                    } catch(e) {}
                                }
                            }).catch(function() {});
                        }
                    } catch (e) { console.warn('[VIP history preload]', e); }
                    await renderFeedFromMemoryState();
                    setupFeedInfiniteScroll();
                    hydrateDeferredFeedRelations(chunk, requestId).then(function() {
                        if (requestId !== feedLoadRequestId) return;
                        return ensureFeedCoverageForVisibleSlice(FEED_PAGE_SIZE, requestId);
                    }).then(function() {
                        if (requestId !== feedLoadRequestId) return;
                        writeFeedCacheSnapshot();
                    }).catch(function(error) {
                        console.warn('[feed] background hydration failed:', error);
                    });
                } catch (e) {
                    console.error(e);
                    var cacheFallbackShown = false;
                    if (!hadLiveFeed && feed) feed.innerHTML = '<div class="loading" style="color:#ff3b60;">加载失败，请刷新重试</div>';
                    try {
                        var fallbackRaw = window.safeStorage.get(CACHE_KEY);
                        if (fallbackRaw) {
                            var fallbackParsed = JSON.parse(fallbackRaw);
                            if (fallbackParsed && fallbackParsed.data && hydrateFeedStateFromSnapshot(fallbackParsed)) {
                                await renderFeedFromMemoryState();
                                setupFeedInfiniteScroll();
                                cacheFallbackShown = true;
                            }
                        }
                    } catch (fbErr) {
                        console.error('[loadFeed] cache fallback failed:', fbErr);
                    }
                    // ★ 修复：缓存回退显示时必须给用户可感知反馈（数据可能过期），
                    // 并提供点击重试入口。此前静默显示旧缓存，用户无法感知加载失败。
                    if (cacheFallbackShown && feed) {
                        var staleNotice = document.getElementById('feedStaleNotice');
                        if (!staleNotice) {
                            staleNotice = document.createElement('div');
                            staleNotice.id = 'feedStaleNotice';
                            staleNotice.className = 'loading feed-load-more-error';
                            staleNotice.setAttribute('role', 'button');
                            staleNotice.setAttribute('tabindex', '0');
                            staleNotice.textContent = '网络加载失败，当前显示缓存内容，点击重试';
                            staleNotice.addEventListener('click', function() {
                                var el = document.getElementById('feedStaleNotice');
                                if (el && el.parentNode) el.parentNode.removeChild(el);
                                loadFeed(true);
                            });
                            feed.appendChild(staleNotice);
                        }
                    }
                } finally {
                    feedPageFetchPending = false;
                }
            };
            window.loadFeed = loadFeed;

            loadMoreFeedPosts = async function() {
                if (feedEndReached || feedPageFetchPending || feedLoadMoreFailed) return;
                var feed = document.getElementById("feed");
                var pageLoading = document.createElement("div");
                pageLoading.className = "feed-page-loading";
                pageLoading.setAttribute("role", "status");
                pageLoading.setAttribute("aria-live", "polite");
                pageLoading.textContent = "正在加载更多帖子";
                var sentinel = document.getElementById("feedSentinel");
                feed.insertBefore(pageLoading, sentinel || null);
                var startIdx = feedPage * FEED_PAGE_SIZE;
                var endIdx = startIdx + FEED_PAGE_SIZE;
                var filteredPosts = getFilteredPosts(feedAllPosts, feedAllComments);
                var fetchFailed = false;
                if (filteredPosts.length < endIdx && !feedEndReached) {
                    try {
                        feedPageFetchPending = true;
                        // ★ 修复：ensureFeedCoverageForVisibleSlice 内部以 feedNextOffset（服务端游标）拉取，
                        // 不再依赖 feedPage 推算 offset，避免并发发帖/删除导致 offset 漂移时帖子重复或永久跳过。
                        // 拉取成功后以当前内存过滤结果重新计算切片。
                        await ensureFeedCoverageForVisibleSlice(endIdx, feedLoadRequestId);
                        writeFeedCacheSnapshot();
                    } catch (e) {
                        fetchFailed = true;
                        console.error('[feed] loadMore ensure coverage failed:', e);
                    } finally {
                        feedPageFetchPending = false;
                    }
                    filteredPosts = getFilteredPosts(feedAllPosts, feedAllComments);
                }
                pageLoading.remove();
                if (fetchFailed) {
                    // ★ 修复：加载更多失败必须给用户可感知反馈 + 可点击重试入口。
                    // 此前静默失败且 feedEndReached 不置位，哨兵每次进入视口都会
                    // 无限重复触发请求。失败后置位 feedLoadMoreFailed 暂停自动触发，
                    // 用户点击"重试"后清除并重新加载。
                    feedLoadMoreFailed = true;
                    var failEl = document.getElementById('feedLoadMoreError');
                    if (!failEl) {
                        failEl = document.createElement('div');
                        failEl.id = 'feedLoadMoreError';
                        failEl.className = 'loading feed-load-more-error';
                        failEl.setAttribute('role', 'button');
                        failEl.setAttribute('tabindex', '0');
                        failEl.textContent = '加载更多失败，点击重试';
                        failEl.addEventListener('click', function() {
                            feedLoadMoreFailed = false;
                            var errEl = document.getElementById('feedLoadMoreError');
                            if (errEl && errEl.parentNode) errEl.parentNode.removeChild(errEl);
                            loadMoreFeedPosts();
                        });
                        feed.appendChild(failEl);
                    }
                    return;
                }
                if (startIdx >= filteredPosts.length && !fetchFailed) {
                    feedEndReached = true;
                    var noMore = document.getElementById("feedNoMore");
                    if (!noMore) {
                        noMore = document.createElement("div");
                        noMore.id = "feedNoMore";
                        noMore.className = "loading";
                        noMore.textContent = "没有更多帖子";
                        noMore.style.padding = "30px";
                        noMore.style.textAlign = "center";
                        feed.appendChild(noMore);
                    }
                    return;
                }
                var filteredPostIds = new Set();
                filteredPosts.forEach(function(p) { filteredPostIds.add(String(p.id)); });
                var scopedComments = getRenderableComments(feedAllComments, filteredPosts);
                var scopedLikes = (feedAllLikes || []).filter(function(l) { return filteredPostIds.has(String(l.post_id)); });
                appendMorePosts(filteredPosts.slice(startIdx, endIdx), scopedComments, scopedLikes);
                feedPage++;
            };

            appendMorePosts = function(posts, comments, likes) {
                var feed = document.getElementById("feed");
                var maps = buildPostMaps(getRenderableComments(comments, posts), likes);
                var postsHtml = posts.map(function(post) {
                    return renderPostCardSafely(post, maps.commentMap, maps.likeMap, maps.likeUserMap);
                }).join("");
                var sentinel = document.getElementById("feedSentinel");
                var tempContainer = document.createElement("div");
                tempContainer.innerHTML = postsHtml;
                while (tempContainer.firstChild) {
                    feed.insertBefore(tempContainer.firstChild, sentinel);
                }
                var newPosts = feed.querySelectorAll(".post:not(.visible)");
                primePostReveal(newPosts);
                observePostViewportState(newPosts);
                updateFeedStats();
            };

            renderFeedWithAvatars = function(visiblePosts, comments, likes) {
                var feed = document.getElementById("feed");
                var scopedComments = getRenderableComments(comments, visiblePosts);
                var maps = buildPostMaps(scopedComments, likes);
                var state = getPostSearchState();
                var hasFilters = !!(state.keyword || state.user || state.startDate || state.endDate || state.onlyMine || (state.visibility && state.visibility !== "all"));
                if (visiblePosts.length) {
                    feed.innerHTML = visiblePosts.map(function(post) {
                        return renderPostCardSafely(post, maps.commentMap, maps.likeMap, maps.likeUserMap);
                    }).join("");
                } else {
                    feed.innerHTML = '<div class="loading">' + (hasFilters ? '暂无匹配的帖子' : '快去发布第一条动态吧~') + '</div>';
                }
                initPostScrollAnimation();
            };

            renderFeed = async function(payload) {
                bindPostFilterEvents();
                var filteredPosts = getFilteredPosts(payload.posts, payload.comments);
                var visibleComments = getRenderableComments(payload.comments, filteredPosts);
                var totalPosts = window._xtjTotalPostCount || filteredPosts.length;
                var sPostsEl = document.getElementById("sPosts");
                if (sPostsEl) sPostsEl.textContent = totalPosts;
                var sViewsEl = document.getElementById("sViews");
                if (sViewsEl) sViewsEl.textContent = filteredPosts.reduce(function(sum, post) { return sum + (post.views || 0); }, 0);
                var visiblePostIds = new Set();
                filteredPosts.forEach(function(p) { visiblePostIds.add(String(p.id)); });
                var scopedLikes = (payload.likes || []).filter(function(l) { return visiblePostIds.has(String(l.post_id)); });
                var sLikesEl = document.getElementById("sLikes");
                if (sLikesEl) sLikesEl.textContent = scopedLikes.length + visibleComments.length;
                filteredPosts.forEach(function(post) {
                    postInfoCache[post.id] = {
                        content: post.content,
                        user_name: post.user_name,
                        media_url: post.media_url || '',
                        media_type: post.media_type || '',
                        created_at: post.created_at || '',
                        views: Number(post.views || 0)
                    };
                });
                var allUsers = new Set();
                filteredPosts.forEach(function(post) { allUsers.add(post.user_name); });
                visibleComments.forEach(function(comment) { allUsers.add(comment.user_name); });
                // Render local avatar cache before the first paint; remote lookup stays background-only.
                hydrateCachedAvatarsForUsers(Array.from(allUsers));
                var visibleCount = feedPage * FEED_PAGE_SIZE;
                var currentPages = filteredPosts.slice(0, Math.max(FEED_PAGE_SIZE, visibleCount));
                // 不在 renderFeed 中重置 feedPage，避免后台渲染破坏滚动状态
                // ★ 修复：不再用 `currentPages.length >= filteredPosts.length` 反向置 feedEndReached。
                // 缓存 hydrate 或帖数恰为 20 的倍数时会把 endReached 误置 true，导致无限滚动提前终止。
                // feedEndReached 只由服务端 endReached / 空 chunk / 游标越界判定。
                renderFeedWithAvatars(currentPages, visibleComments, scopedLikes);
                refreshPendingFeedIpPosts(currentPages);
                renderFilterSummary(filteredPosts.length);
                if (typeof setupFeedInfiniteScroll === 'function') setupFeedInfiniteScroll();

                loadAvatarsForUsers(Array.from(allUsers)).then(function() {
                    var feedEl = document.getElementById('feed');
                    if (!feedEl) return;
                    var avatars = feedEl.querySelectorAll('.avatar.clickable');
                    avatars.forEach(function(avatarEl) {
                        if (avatarEl.querySelector('img')) return;
                        var username = avatarEl.getAttribute('data-user-name') ||
                            avatarEl.parentElement && avatarEl.parentElement.getAttribute('data-user-name') ||
                            avatarEl.closest && avatarEl.closest('[data-user-name]') && avatarEl.closest('[data-user-name]').getAttribute('data-user-name');
                        if (!username) {
                            // 兼容旧版 onclick 解析
                            var onclick = avatarEl.getAttribute('onclick') || '';
                            username = onclick.replace(/^.*openUserProfile\('([^']*)'.*$/, '$1');
                            if (!username || username === onclick) username = '';
                        }
                        if (!username) return;
                        var avatarUrl = getAvatarUrl(username);
                        if (avatarUrl) {
                            avatarEl.innerHTML = renderAvatarContent(username, avatarUrl);
                        }
                    });
                });
                setTimeout(function() { prefetchStatData(); }, 1000);
            };
            window.renderFeed = renderFeed;

            // ★ 关键修复：删除此重复的 delBtn.onclick 赋值！
            // 原因：此 handler 没有 __xtjDeleteInProgress 锁、没有 Promise.race 超时、
            //      finally 没重置状态、await loadFeed(true) 会阻塞整个事件循环。
            //      JS 中 .onclick 重复赋值会**覆盖**前面的 handler（line 2602 区域的完整保护版失效），
            //      导致删除卡死、连续删除卡死。
            // 真正生效的 handler 在 line 2602 区域（带锁 + 超时 + 乐观删除 + 入口强制解锁）。

            // 统计预加载（使用后端快照接口，避免全量读取）

