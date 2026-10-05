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
                if (like.user_name) return !!currentUser && String(like.user_name) === String(currentUser);
                var actor = String(like.actor_key || '');
                if (!actor) return false;
                return getCurrentLikeIdentityValues().indexOf(actor) >= 0;
            }

            function isPostLikedByCurrentUser(likeUserMap, postId) {
                var keys = makeLikeLookupKeys(postId, currentUser ? null : deviceId, currentUser);
                for (var i = 0; i < keys.length; i++) {
                    if (likeUserMap && likeUserMap[keys[i]]) return true;
                }
                return false;
            }

            function buildLikeButtonContent(liked) {
                return '<svg class="post-like-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg><span class="post-like-label">' + (liked ? '已赞' : '点赞') + '</span>';
            }

            function setLikeButtonState(btn, liked) {
                if (!btn) return;
                btn.classList.toggle('liked', !!liked);
                if (!btn.querySelector('.post-like-icon')) btn.innerHTML = buildLikeButtonContent(liked);
                var label = btn.querySelector('.post-like-label');
                if (label) label.textContent = liked ? '已赞' : '点赞';
                btn.setAttribute('aria-label', liked ? '取消点赞' : '点赞');
                btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
            }

            // ★ 2026-09-27 修复（审计 P10：点赞同步写 localStorage 阻塞主线程）：
            //   根因：updatePostLikeUi 每次点赞都同步 get→JSON.parse→改→JSON.stringify→set
            //   整份 feed 缓存，快速连点时主线程被反复全量序列化打满（卡顿）。
            //   修法：只改写入时机——用 ~400ms 尾沿防抖合并窗口内的多次点赞，
            //   最终只落盘一次；并在页面卸载/隐藏前强制 flush，避免丢数据。
            //   数据结构与语义（parsed.data.likes / timestamp）完全不变。
            var _persistLikesTimer = null;
            var _persistLikesFlushBound = false;
            function _persistFeedLikesCacheNow() {
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
            function flushFeedLikesCache() {
                if (_persistLikesTimer) {
                    clearTimeout(_persistLikesTimer);
                    _persistLikesTimer = null;
                }
                _persistFeedLikesCacheNow();
            }
            function persistFeedLikesCache() {
                if (_persistLikesTimer) clearTimeout(_persistLikesTimer);
                _persistLikesTimer = setTimeout(function() {
                    _persistLikesTimer = null;
                    _persistFeedLikesCacheNow();
                }, 400);
                if (!_persistLikesFlushBound) {
                    _persistLikesFlushBound = true;
                    // 页面卸载/切后台前把挂起的写入落盘（pagehide 比 beforeunload 在移动端更可靠）
                    window.addEventListener('pagehide', flushFeedLikesCache);
                    window.addEventListener('beforeunload', flushFeedLikesCache);
                    document.addEventListener('visibilitychange', function() {
                        if (document.visibilityState === 'hidden') flushFeedLikesCache();
                    });
                }
            }
            window.__xtjFlushFeedLikesCache = flushFeedLikesCache;

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
                if (window.__xtjPostDetailSnapshot && String(window.__xtjPostDetailSnapshot.id) === String(postId) && Number.isFinite(count)) window.__xtjPostDetailSnapshot.like_count = count;
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
                    var likeBtn = postEl.querySelector('.actions .like-btn');
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
                    var likeBtn = postEl.querySelector('.actions .like-btn');
                    var statsEl = postEl.querySelector('.post-stats-text');
                    var stateChanged = !!likeBtn && likeBtn.classList.contains('liked') !== !!liked;
                    setLikeButtonState(likeBtn, liked);
                    if (stateChanged) updateLikeStatsText(statsEl, liked);
                });
            }

            window.__xtjApplyRealtimeLike = function(eventType, row) {
                if (!row || row.id == null || row.post_id == null) return;
                var postId = String(row.post_id);
                var detail = window.__xtjPostDetailSnapshot;
                if (!(feedAllPosts || []).some(function(post) { return String(post && post.id) === postId; }) && !(detail && String(detail.id) === postId)) return;
                // The API response owns the in-flight optimistic update on this device.
                if (likeOperations[postId] && likeOperations[postId].running) return;
                var likes = Array.isArray(feedAllLikes) ? feedAllLikes : (feedAllLikes = []);
                var changed = false;
                var shouldIncrement = false;
                if (eventType === 'INSERT') {
                    if (likes.some(function(item) { return String(item && item.id) === String(row.id); })) return;
                    var sameActorIndex = -1;
                    if (isLikeOwnedByCurrentUser(row, postId)) {
                        sameActorIndex = likes.findIndex(function(item) {
                            return !item.id && isLikeOwnedByCurrentUser(item, postId);
                        });
                    }
                    if (sameActorIndex >= 0) likes.splice(sameActorIndex, 1);
                    else shouldIncrement = true;
                    likes.push(row);
                    changed = true;
                } else if (eventType === 'DELETE') {
                    var before = likes.length;
                    likes = likes.filter(function(item) {
                        if (String(item && item.id) === String(row.id)) return false;
                        if (isLikeOwnedByCurrentUser(row, postId) && isLikeOwnedByCurrentUser(item, postId)) return false;
                        return true;
                    });
                    changed = likes.length !== before;
                    if (!changed) return;
                } else {
                    return;
                }
                feedAllLikes = likes;
                if (detail && String(detail.id) === postId && Number.isFinite(Number(detail.like_count)) && (eventType === 'DELETE' || shouldIncrement)) detail.like_count = Math.max(0, Number(detail.like_count) + (eventType === 'INSERT' ? 1 : -1));
                document.querySelectorAll('.post[data-post-id]').forEach(function(card) {
                    if (String(card.getAttribute('data-post-id') || '') !== postId) return;
                    var stats = card.querySelector('.post-stats-text');
                    if (stats && (eventType === 'DELETE' || shouldIncrement)) updateLikeStatsText(stats, eventType === 'INSERT');
                    var mine = likes.some(function(item) { return isLikeOwnedByCurrentUser(item, postId); });
                    setLikeButtonState(card.querySelector('.actions .like-btn'), mine);
                });
                persistFeedLikesCache();
                scheduleLikeStatRefresh();
                if (typeof updateFeedStats === 'function') updateFeedStats();
            };
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

            function capturePostActionIdentity() {
                return { owner: currentUser, epoch: typeof _authStateEpoch === 'number' ? _authStateEpoch : 0 };
            }
            function postActionIdentityCurrent(identity) {
                return !!identity && identity.owner === currentUser &&
                    identity.epoch === (typeof _authStateEpoch === 'number' ? _authStateEpoch : 0);
            }
            function assertPostActionIdentity(identity) {
                if (!postActionIdentityCurrent(identity)) {
                    var error = new Error('账号已切换，操作已停止');
                    error.code = 'identity_changed';
                    throw error;
                }
            }

            function applyPostLikeIntent(postId, liked, sourceButton) {
                updatePostLikeUi(postId, liked, { post_id: postId, user_name: currentUser, actor_key: deviceId });
                updateFeedStats();
                if (liked && sourceButton) createLikeBlossom(sourceButton);
            }

            function flushPostLikeOperation(postId, operation) {
                if (likeOperations[postId] !== operation || !postActionIdentityCurrent(operation.identity)) return Promise.resolve();
                var requestedLiked = operation.desired;
                operation.running = true;
                operation.requested = requestedLiked;
                var normalizedPostId = postId.trim().toLowerCase();
                return window.xtjProtectedFetch('/api/post/like', {
                    method: 'POST',
                    authOwner: operation.identity.owner, authEpoch: operation.identity.epoch,
                    body: JSON.stringify({ post_id: normalizedPostId, liked: requestedLiked })
                }).then(function(likeResponse) {
                    return likeResponse.json().catch(function() { return {}; }).then(function(likeResult) {
                        if (likeOperations[postId] !== operation || !postActionIdentityCurrent(operation.identity)) return;
                        if (!likeResponse.ok || !likeResult.ok || !!likeResult.liked !== requestedLiked) {
                            throw new Error(likeResult.error || 'like_state_sync_failed');
                        }
                        operation.confirmed = requestedLiked;
                        // The response describes the sent intent, while the user may already
                        // have reversed it. Keep the count aligned with the visible intent.
                        var intentDelta = Number(operation.desired) - Number(requestedLiked);
                        updatePostLikeCount(postId, Math.max(0, Number(likeResult.like_count) + intentDelta));
                        touchUserSession(false);
                        scheduleLikeStatRefresh();
                        if (currentDockTab === 'profile' && typeof loadProfileActivity === 'function') loadProfileActivity(true);
                        try { if (typeof window.queueBehavior === 'function') window.queueBehavior(requestedLiked ? 'post_like' : 'post_unlike', 'post ' + postId.slice(0, 8)); } catch(e) {}
                        if (operation.desired !== operation.confirmed) return flushPostLikeOperation(postId, operation);
                    });
                }).catch(function(error) {
                    if (likeOperations[postId] !== operation || !postActionIdentityCurrent(operation.identity)) return;
                    console.error(error);
                    if (operation.desired !== operation.confirmed) {
                        applyPostLikeIntent(postId, operation.confirmed);
                        showToast("点赞失败，请重试");
                    }
                    // A failed request must not leave a stale optimistic intent behind.
                    // The next tap is derived from the visible/confirmed state and will
                    // resend that explicit state (the endpoint is idempotent).
                    operation.desired = operation.confirmed;
                    operation.requested = operation.confirmed;
                }).finally(function() {
                    // ★ 修复：无条件复位 running——此前仅当 desired===confirmed 时才删除条目，
                    // 若"请求在途时再点取消 → 第一次成功触发 re-flush → 第二次失败"，条目会永久
                    // 残留在 running=true 状态，此后 toggleLike 不再发起任何请求，点赞态与服务器
                    // 永久失同步（P1）。现在 running 始终复位：状态未同步时下次点击可重新 flush。
                    operation.running = false;
                    if (likeOperations[postId] !== operation) return;
                    if (!postActionIdentityCurrent(operation.identity)) {
                        delete likeOperations[postId];
                        return;
                    }
                    setPostLikePending(postId, false);
                    // ★ 修复（P1 补洞）：re-flush 请求已发出(requested)但响应丢失时，
                    // desired===confirmed 导致条目被删除、UI 与服务器永久失步；
                    // 现在要求 desired 与 requested 都等于 confirmed 才删除条目——
                    // 任一状态不确定时保留条目，用户再点一次即可重新同步。
                    if (likeOperations[postId] === operation &&
                        operation.desired === operation.confirmed &&
                        operation.requested === operation.confirmed) {
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
                if (operation && !postActionIdentityCurrent(operation.identity)) {
                    delete likeOperations[pid];
                    operation = null;
                }
                var visibleButton = btn && btn.classList ? btn : getPostLikeButtons(pid)[0];
                var currentLiked = operation ? operation.desired : visibleButton.classList.contains('liked');
                var nextLiked = !currentLiked;
                if (!operation) {
                    operation = { confirmed: currentLiked, desired: currentLiked, running: false, promise: null, identity: capturePostActionIdentity() };
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
                if (document.documentElement.getAttribute('data-xtj-motion') === 'off' ||
                    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
                if (!btn || !btn.classList) return;
                if (btn._likeLiteTimer) clearTimeout(btn._likeLiteTimer);
                if (btn._likeLiteFrame != null) {
                    if (window.cancelAnimationFrame) window.cancelAnimationFrame(btn._likeLiteFrame);
                    else clearTimeout(btn._likeLiteFrame);
                }
                btn.classList.remove('like-lite-feedback');
                var startLiteFeedback = function() {
                    btn._likeLiteFrame = null;
                    btn.classList.add('like-lite-feedback');
                    btn._likeLiteTimer = setTimeout(function() {
                        btn._likeLiteTimer = null;
                        btn.classList.remove('like-lite-feedback');
                    }, 240);
                };
                btn._likeLiteFrame = window.requestAnimationFrame
                    ? window.requestAnimationFrame(startLiteFeedback)
                    : setTimeout(startLiteFeedback, 16);
                if (perfProfile === 'lite') return;
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
                    if (btn._likeBlossom && btn._likeBlossom.node === blossom) {
                        if (btn._likeBlossom.timer) clearTimeout(btn._likeBlossom.timer);
                        btn._likeBlossom = null;
                    }
                    if (blossom.parentNode) blossom.remove();
                    btn.classList.remove('like-bloom-origin');
                };
                blossom.addEventListener('animationend', cleanup, { once: true });
                blossom.addEventListener('animationcancel', cleanup, { once: true });
                btn._likeBlossom = {
                    node: blossom,
                    // The compact blossom ends at 480ms; also clean up if animation is cancelled.
                    timer: setTimeout(cleanup, 600)
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
                
                var postEl = findBySafePostSelector(postId);
                var detail = document.getElementById('postDetailModal');
                if (detail && detail.classList.contains('active')) { var detailSel = safePostSelector(postId); var detailCard = detailSel && detail.querySelector(detailSel); if (detailCard) postEl = detailCard; }
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
                    inp.setAttribute('aria-expanded', 'false');
                    inp.removeAttribute('aria-activedescendant');
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
                inp.addEventListener('input', function(e) {
                    if (e.isComposing) { closeMentionDropdown(); return; }
                    showMentionDropdown(inp);
                });
                inp.addEventListener('keydown', function(e) {
                    if (e.isComposing || e.keyCode === 229) return;
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
                // ★ 修复：监听器泄漏。feed 重渲染会直接替换 #feed.innerHTML，正在
                // 展开的 .inline-comment-box 被整体丢弃，不会触发 box.remove()，导致
                // document 级 capture 点击监听反复累积。这里把清理函数登记到全局
                // 注册表，渲染 feed 前统一执行（见 renderFeed* 入口）。
                window.__xtjMentionCleanups = window.__xtjMentionCleanups || [];
                var _mentionCleanup = function() {
                    closeMentionDropdown();
                    document.removeEventListener('click', _mentionGlobalClick, true);
                };
                window.__xtjMentionCleanups.push(_mentionCleanup);
                if (!window.__xtjRunMentionCleanups) {
                    window.__xtjRunMentionCleanups = function() {
                        var _arr = window.__xtjMentionCleanups || [];
                        for (var _ci = 0; _ci < _arr.length; _ci++) { try { _arr[_ci](); } catch (_ce) {} }
                        window.__xtjMentionCleanups = [];
                    };
                }
                // 帖子关闭或重绘时关闭 + 移除全局监听器
                var _origBoxRemove = box.remove;
                box.remove = function() {
                    closeMentionDropdown();
                    _mentionCleanup();
                    var _ri = window.__xtjMentionCleanups ? window.__xtjMentionCleanups.indexOf(_mentionCleanup) : -1;
                    if (_ri !== -1) window.__xtjMentionCleanups.splice(_ri, 1);
                    _origBoxRemove.call(box);
                };
                
                var btn = document.createElement('button');
                btn.className = 'btn-sm btn-primary';
                btn.textContent = '发送';
                btn.style.borderRadius = '20px';
                btn.style.padding = '6px 14px';
                
                btn.onclick = async function() {
                    if (btn.disabled) return;
                    if (!currentUser) { showToast("请先登录"); return; }
                    var identity = capturePostActionIdentity();
                    if (isUserMuted()) { showToast("您已被禁言，无法发表评论"); return; }
                    var content = inp.value.trim();
                    if (!content) { showToast("请输入评论内容"); return; }
                    // ★ 2026-09-27 修复（审计 P8-①：评论内容无长度上限）：
                    //   与服务端 /api/post/comment 的 content.length > 5000 限制保持一致，
                    //   提前拦截既避免无谓请求，也给用户及时反馈（服务端仍会二次校验）。
                    if (content.length > 5000) { showToast("评论内容不能超过5000字"); return; }
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
                            authOwner: identity.owner, authEpoch: identity.epoch,
                            signal: controller.signal,
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ post_id: targetPostId, content: content })
                        });
                        const result = await response.json().catch(function() { return {}; });
                        if (!postActionIdentityCurrent(identity)) return;
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
                            if (window.__xtjApplyPostDetailComment) window.__xtjApplyPostDetailComment('INSERT', insertedComment);
                            writeFeedCacheSnapshot();
                            if (typeof window.__xtjSchedulePostCardPatch === 'function') {
                                window.__xtjSchedulePostCardPatch(targetPostId);
                            }
                        } else {
                            await loadFeed(true);
                        }
                        
                        if (!postActionIdentityCurrent(identity)) return;
                        requestAnimationFrame(function() {
                            if (!postActionIdentityCurrent(identity)) return;
                            var p = document.getElementById('panelPosts');
                            if (p && savedScroll > 0) p.scrollTop = savedScroll;
                            var newEl = findBySafePostSelector(targetPostId);
                            if (newEl) newEl.classList.add('visible');
                        });
                        loadProfileActivity(true).catch(function(eProfile) {
                            // ★ 2026-09-27 修复（审计 P8-③）：loadProfileActivity 返回 Promise，
                            //   此前不接 await/catch，抛错会成为未处理的 rejection（静默）。
                            //   评论已发布成功，个人页刷新失败不影响主流程，仅告警不阻断。
                            console.warn('[comment] loadProfileActivity refresh failed', eProfile);
                        });
                        
                        // 小猫 AI 自动回复轮询
                        // Phase 3-P0-1: 修复 @小猫 正则。原 lookahead (?=\s|$|[^\w\u4e00-\u9fa5]) 要求
                        // 小猫后跟非汉字字符，导致 @小猫帮我看看 不匹配（"帮"是汉字）。
                        // 改为负向断言 (?![猫])：仅排除 小猫咪，@小猫帮我看看 可匹配。
                        if (content && /[@＠]小猫(?![猫咪])/.test(content) && insertedComment) {
                            pollCatAiReply(insertedComment.id, targetPostId);
                        }
                    } catch (e) {
                        if (!postActionIdentityCurrent(identity)) return;
                        showToast("评论失败: " + (e.message || "未知错误"));
                        btn.disabled = false;
                        btn.textContent = '发送';
                    } finally {
                        // ★ 2026-09-27 修复（审计 P8-②：失败路径未 clearTimeout(15s)）：
                        //   此前仅成功路径 clearTimeout，请求失败/抛错时定时器仍挂着 15s，
                        //   虽 abort 后无实际影响，但属泄漏。统一在 finally 清理，幂等安全。
                        clearTimeout(timeoutId);
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
                // ★ 修复：取消/清理即标记 cancelled，在途删除请求成功回调据此不再执行乐观删除
                session.cancelled = true;
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
            // ★ 2026-09-27 修复（审计 P12：id 未校验就拼进 querySelector）：
            //   根因：多处直接把 postId 拼进 `.post[data-post-id="' + id + '"]` 选择器，
            //   非法字符（引号/方括号/控制字符等）会抛 SyntaxError，或命中错误元素。
            //   修法：统一走 safePostSelector 生成选择器——优先 CSS.escape（旧浏览器可能
            //   缺失，带 try/catch），否则退化为手工转义引号/反斜杠/控制符（与 03 中
            //   既有写法保持一致）。返回 null 时调用方应跳过查询，避免抛错。
            function escapeCssIdent(value) {
                var s = String(value == null ? '' : value);
                if (window.CSS && typeof window.CSS.escape === 'function') {
                    try { return window.CSS.escape(s); } catch (_) { /* 落到手工转义 */ }
                }
                return s.replace(/["\\\x00-\x1f\x7f]/g, function(ch) {
                    return '\\' + ch;
                });
            }
            function safePostSelector(postId) {
                var raw = String(postId == null ? '' : postId);
                if (!raw) return null;
                return '.post[data-post-id="' + escapeCssIdent(raw) + '"]';
            }
            function findBySafePostSelector(postId) {
                var sel = safePostSelector(postId);
                return sel ? document.querySelector(sel) : null;
            }
            function findPostCardElement(postId) {
                return findBySafePostSelector(postId);
            }
            function removeDeletedPostFromFeed(postId) {
                if (!Array.isArray(feedAllPosts)) return;
                feedAllPosts = feedAllPosts.filter(function(post) {
                    return String(post.id) !== String(postId);
                });
            }
            async function confirmPostDeleteStatus(postId, identity) {
                identity = identity || capturePostActionIdentity();
                var controller = typeof AbortController === 'function' ? new AbortController() : null;
                var statusTimeoutMs = Number(window.__xtjPostDeleteStatusTimeoutMs) > 0 ? Number(window.__xtjPostDeleteStatusTimeoutMs) : 8000;
                var timer = setTimeout(function() { if (controller) controller.abort(); }, statusTimeoutMs);
                try {
                    var response = await window.xtjProtectedFetch('/api/post/delete-status', {
                        method: 'POST', authOwner: identity.owner, authEpoch: identity.epoch,
                        body: JSON.stringify({ post_id: postId }),
                        signal: controller ? controller.signal : undefined
                    });
                    var result = await response.json().catch(function() { return {}; });
                    if (!postActionIdentityCurrent(identity)) return { confirmed: false };
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
                if (typeof window.__xtjRemoveAuthorPost === 'function') window.__xtjRemoveAuthorPost(postId);
                if (String(window.__xtjPostDetailCurrentId || '') === String(postId) && typeof window.closeModal === 'function') window.closeModal('postDetailModal');
                if (typeof clearFeedCache === 'function') { try { clearFeedCache(); } catch (e) {} }

                // 删除只过渡合成属性，完成后一次移除节点，避免连续重算整张卡片的布局。
                if (session.postEl && session.postEl.parentNode) {
                    var el = session.postEl;
                    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    if (reducedMotion) {
                        try { el.remove(); } catch (e) {}
                    } else {
                        el.style.transition = 'opacity 180ms ease, transform 180ms cubic-bezier(.2,.7,.25,1)';
                        el.style.opacity = '0';
                        el.style.transform = 'translate3d(0,-6px,0) scale(.99)';
                        el.style.pointerEvents = 'none';
                        var onTransitionEnd = function() {
                            try { el.remove(); } catch (e) {}
                            el.removeEventListener('transitionend', onTransitionEnd);
                        };
                        el.addEventListener('transitionend', onTransitionEnd);
                        // 兜底：transitionend 在后台标签页可能不会触发。
                        setTimeout(function() {
                            try { if (el.parentNode) el.remove(); } catch (e) {}
                        }, 220);
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
                // ★ 2026-09-27 修复（审计 P6：删除客户端权限校验 fail-open）：
                //   根因：缓存未命中（targetPost 为 undefined）时下方 `targetPost &&` 短路，
                //   直接放行 → 前端门禁形同虚设（虽有服务端 403 兜底，但前端应 fail-closed）。
                //   修法：先在内存全量数据里找，找不到再从 postInfoCache / xtjGetPostById 兜底
                //   再取一次；仍取不到就不放行，提示刷新后重试并中止，绝不把请求发出去。
                //   正常路径（卡片可见、feedAllPosts 已加载）都能取到，不会卡死正常删除。
                var targetPost = null;
                if (Array.isArray(feedAllPosts)) {
                    targetPost = feedAllPosts.find(function(post) { return String(post && post.id) === String(postId); });
                }
                if (!targetPost) {
                    var cachedForDelete = (window.postInfoCache && window.postInfoCache[String(postId)])
                        || (typeof window.xtjGetPostById === 'function' ? window.xtjGetPostById(postId) : null);
                    if (cachedForDelete) targetPost = cachedForDelete;
                }
                if (!targetPost) {
                    showToast("无法确认删除权限，请刷新后重试");
                    return;
                }
                if (!canDeletePost(targetPost)) {
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
                session.cancelled = false;
                var identity = capturePostActionIdentity();
                session.flight = identity;
                function currentDelete() {
                    return session.flight === identity && postActionIdentityCurrent(identity);
                }
                const targetPostId = String(delPostId);
                // ★ 2026-09-27 修复（审计 P6）：删除确认入口同样 fail-closed，
                //   取不到帖子记录时不再放行（openDelete 已拦一道，这里再兜一道，
                //   防止 delPostId 被其它路径直接写入或缓存被清空后绕过）。
                var currentPost = null;
                if (Array.isArray(feedAllPosts)) {
                    currentPost = feedAllPosts.find(function(post) { return String(post && post.id) === targetPostId; });
                }
                if (!currentPost) {
                    currentPost = (window.postInfoCache && window.postInfoCache[targetPostId])
                        || (typeof window.xtjGetPostById === 'function' ? window.xtjGetPostById(targetPostId) : null);
                }
                if (!currentPost) {
                    cleanupDeleteSession({ toast: "无法确认删除权限，请刷新后重试" });
                    return;
                }
                if (!canDeletePost(currentPost)) {
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
                    session.postEl.style.opacity = '0.56';
                    session.postEl.style.pointerEvents = 'none';
                }
                session.timeoutId = setTimeout(function() {
                    if (finished || !currentDelete()) return;
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
                    let deleteResult;
                    try {
                        deleteResponse = await window.xtjProtectedFetch('/api/post/delete', {
                            method: 'POST', authOwner: identity.owner, authEpoch: identity.epoch,
                            body: JSON.stringify({ post_id: targetPostId }),
                            signal: deleteController ? deleteController.signal : undefined
                        });
                        deleteResult = await deleteResponse.json().catch(function(error) {
                            if (deleteTimedOut || (error && error.name === 'AbortError')) throw error;
                            return {};
                        });
                    } catch (raceErr) {
                        if (finished || session.cancelled || !currentDelete()) return;
                        if (deleteTimedOut) {
                            console.warn('[delBtn] delete request timed out; checking locally');
                            // The delete request may have reached the server before this
                            // browser timed out. Confirm with the authoritative endpoint
                            // before deciding whether to restore the optimistic UI.
                            var authoritativeStatus = await confirmPostDeleteStatus(targetPostId, identity);
                            if (finished || session.cancelled || !currentDelete()) return;
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
                    if (finished || session.cancelled || !currentDelete()) return;
                    if (!deleteResponse.ok || !deleteResult.ok || (!deleteResult.deleted && !deleteResult.already_deleted)) {
                        finished = true;
                        if (!session.cancelled) cleanupDeleteSession({ toast: "删除失败: " + (deleteResult.error || "服务器未确认删除") });
                        return;
                    }
                    if (session.cancelled || !currentDelete()) return;
                    finished = true;
                    applyConfirmedPostDeletion(targetPostId, session);
                } catch (e) {
                    if (finished || session.cancelled || !currentDelete()) return;
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
                    if (!finished && currentDelete()) {
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
                    // ★ 修复：关闭即复位 aria-hidden（打开时 02 置 false，关闭从不复位）
                    try { if (el.getAttribute('aria-hidden') !== null) el.setAttribute('aria-hidden', 'true'); } catch (_) {}
                    // ★ 修复：弹窗状态变化后重算 body 滚动锁（statModal 此前所有关闭路径都不解锁）
                    try { if (typeof syncHeaderModalBodyLock === 'function') syncHeaderModalBodyLock(); } catch (_) {}
                }
                // 删除弹窗取消时立即清理，不播放动画
                if (id === 'delModal') {
                    cleanupDeleteSession({ restoreVisual: true, hideModal: true, resetTarget: true });
                }
                // ★ 2026-09-27（P7 配套）：关闭帖子详情弹窗时清空 activePostId，
                //   避免「已关闭但 activePostId 残留」导致 refreshPostDetailIfActive
                //   在后续置顶操作时误判为"详情正开着"。
                //   直接内联在此处而不是外层包装 closeModal —— 包装会引入「谁先谁后」
                //   的隐式依赖，内联版是确定性的。
                if (id === 'postDetailModal') {
                    if (window.__xtjCancelPostDetail) window.__xtjCancelPostDetail();
                    try { window.__xtjSetActivePostId(null); } catch (_) {}
                }
                if (id === 'userProfileModal') {
                    upcRequestSeq++;
                    upcTargetUser = null;
                    if (typeof window.__xtjCloseAuthorPosts === 'function') window.__xtjCloseAuthorPosts();
                }
                if (id === 'loginModal' || id === 'registerModal') {
                    if (el.contains(document.activeElement)) {
                        try { document.activeElement.blur(); } catch (_) {}
                    }
                    el.setAttribute('inert', '');
                    if (authModalFocusOrigin && typeof authModalFocusOrigin.focus === 'function') {
                        if (!el.contains(authModalFocusOrigin) && (!window.matchMedia || window.matchMedia('(hover: hover) and (pointer: fine)').matches)) {
                            try { authModalFocusOrigin.focus(); } catch (_) {}
                        }
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
                // ★ 修复：此前 el 为空直接 return null，导致「无触发元素」的调用
                //   （如兜底按钮、外链图片）也强制退回旧 #imgViewer。
                //   现在只要拿到可用 src 就构造预览项，el 仅用于补充元数据。
                var rawSrc = String(src || (el && (el.getAttribute('data-full-src') || el.getAttribute('data-src') || el.getAttribute('src'))) || '').trim();
                var safeImageUrl = sanitizeUrl(rawSrc);
                if (!safeImageUrl) return null;
                var postId = String((el && el.getAttribute('data-post-id')) || '').trim();
                var userName = String((el && el.getAttribute('data-post-user')) || '').trim();
                var createdAt = String((el && el.getAttribute('data-post-created-at')) || '').trim();
                var views = Number((el && el.getAttribute('data-post-views')) || 0) || 0;
                var fileSize = Number((el && el.getAttribute('data-file-size')) || 0) || null;
                var originalSize = Number((el && el.getAttribute('data-original-size')) || 0) || null;
                // ★ 修复（聊天图片无关闭按钮/按钮错位/缩放异常的根因）：
                //   聊天图片气泡 <img class="msg-img"> 只有 data-full-src，没有 data-post-id。
                //   旧代码在 postId 为空时 return null → openPostImagePreview 返回 false →
                //   openImageViewer 退回旧 #imgViewer（其关闭按钮被全局按钮重置规则压成
                //   position:relative，实测 rect.x = -24 跑到屏幕外，缩放也在两套状态机间打架）。
                //   现在：无 postId 时按「聊天/通用图片」构造单图预览项，统一走新 photo-preview。
                var isPostPhoto = !!postId;
                return {
                    id: isPostPhoto ? ('post_' + postId) : ('chat_' + (el && el.id ? el.id : 'img') + '_' + rawSrc.length),
                    imageUrl: safeImageUrl,
                    // 缩略图与原图同源：聊天图没有独立缩略图，传相同的 URL 会让 preview.js
                    // 走 hasThumb=false 分支（避免多一次无意义预加载）。
                    thumbUrl: safeImageUrl,
                    username: userName || '',
                    timestamp: createdAt || '',
                    views: views,
                    fileSize: fileSize,
                    originalSize: originalSize,
                    __xtjSource: isPostPhoto ? 'post' : 'chat',
                    __xtjPostId: postId,
                    __xtjActorKey: String((el && el.getAttribute('data-actor-key')) || ''),
                    __xtjCanDelete: String((el && el.getAttribute('data-can-delete')) || '') === '1'
                };
            }

            function syncPostPhotoPreviewChrome(photo) {
                var overlay = document.getElementById('photoPreviewOverlay');
                if (!overlay || !overlay.classList.contains('active')) return;
                var isPostPhoto = !!(photo && photo.__xtjSource === 'post');
                var isChatPhoto = !!(photo && photo.__xtjSource === 'chat');
                overlay.classList.toggle('pp-post-mode', isPostPhoto);
                // ★ 修复：单图预览（帖子图 / 聊天图）都隐藏左右翻页箭头——只有一张图时
                //   箭头点了没反应，反而和关闭按钮一起造成「按钮很多但没用」的观感。
                var singleItem = isChatPhoto ||
                    (Array.isArray(window.__xtjPreviewExplicitPhotos) && window.__xtjPreviewExplicitPhotos.length <= 1);
                var prevBtn = document.getElementById('ppPrevBtn');
                var nextBtn = document.getElementById('ppNextBtn');
                if (prevBtn) setCtBtnDisplay(prevBtn, singleItem ? 'none' : '');
                if (nextBtn) setCtBtnDisplay(nextBtn, singleItem ? 'none' : '');
                var deleteBtn = document.getElementById('ppDeleteBtn');
                if (deleteBtn) {
                    if (isPostPhoto) {
                        setCtBtnDisplay(deleteBtn, photo.__xtjCanDelete ? 'flex' : 'none');
                        deleteBtn.title = '删除帖子'; deleteBtn.setAttribute('aria-label', '删除帖子');
                        deleteBtn.__xtjPostDeleteBound = true;
                        deleteBtn.onclick = function() { window.deletePostPhotoFromPreview(); };
                    } else {
                        // 聊天图 / 通用图不属于当前用户可删除的内容，强制隐藏。
                        // 必须用 setProperty(...,'important')：style.css 里
                        // #photoPreviewOverlay .pp-delete-btn { display:flex !important }
                        // 会压过普通内联值（实测改完后按钮仍在工具栏里显示）。
                        setCtBtnDisplay(deleteBtn, 'none');
                        deleteBtn.onclick = function() { window.deletePhotoFromPreview(); };
                    }
                }
                // 聊天图片不提供「分享」（复制图片直链给他人并无意义，且聊天图多为
                // 私有会话内容），也不提供「删除」。工具栏只留 信息 / 旋转。
                var shareBtn = document.getElementById('ppShareBtn');
                if (shareBtn) setCtBtnDisplay(shareBtn, isChatPhoto ? 'none' : '');
            }

            // 统一用 !important 设置按钮显隐：预览器工具栏按钮在 style.css 里
            // 有一组 display:flex !important 的后置覆盖规则，普通 .style.display
            // 会被压掉，导致「代码里隐藏了、界面仍然显示」。
            function setCtBtnDisplay(btn, value) {
                if (!btn) return;
                if (value) btn.style.setProperty('display', value, 'important');
                else btn.style.removeProperty('display');
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
                // ★ 修复：context.kind 必须跟随真实来源。此前对聊天图片也硬编码 'post'，
                //   会让 deleteCurrentPhoto 把聊天图当成帖子图去调删除帖子接口。
                window.__xtjPhotoPreviewContext = {
                    kind: photo.__xtjSource === 'post' ? 'post' : 'generic',
                    postId: photo.__xtjPostId,
                    actorKey: photo.__xtjActorKey || '',
                    canDelete: !!photo.__xtjCanDelete
                };
                var photos = [photo], index = 0;
                if (photo.__xtjSource === 'post') {
                    var detailPost = window.__xtjPostDetailSnapshot;
                    var post = detailPost && String(detailPost.id) === photo.__xtjPostId ? detailPost :
                        (feedAllPosts || []).find(function(p) { return String(p.id) === photo.__xtjPostId; });
                    var mediaItems = post ? getPostMediaItems(post).filter(function(item) { return item.media_type === 'image' && !!sanitizeUrl(item.media_url); }) : [];
                    if (mediaItems.length) {
                        photos = mediaItems.map(function(item, position) {
                            return Object.assign({}, photo, { id: 'post_' + photo.__xtjPostId + '_' + (item.id || position), imageUrl: sanitizeUrl(item.media_url),
                                thumbUrl: sanitizeUrl(item.media_url), width: item.width || null, height: item.height || null, fileSize: item.file_size || null, views: Number(post.views) || 0, __xtjCanDelete: canDeletePost(post), __xtjMediaIndex: position });
                        });
                        index = Math.max(0, photos.findIndex(function(item) { return item.imageUrl === photo.imageUrl; }));
                        var clickedIndex = Number(triggerEl && triggerEl.getAttribute('data-post-media-index'));
                        if (Number.isInteger(clickedIndex) && photos[clickedIndex] && photos[clickedIndex].imageUrl === photo.imageUrl) index = clickedIndex;
                    }
                }
                photo = photos[index];
                window.openPhotoPreview(index, { photos: photos, originEl: triggerEl && triggerEl.getBoundingClientRect ? triggerEl : null });
                window.photoPreviewCurrent = photo;
                // 同步 chrome 需要等 hotfix 的 afterOpen（双 rAF + 打开动画）走完，
                // 否则按钮会在其后的重置里被改回来。这里在两个时间点各同步一次：
                // 30ms 覆盖快路径，480ms 兜底覆盖慢路径/动画较长的设备。
                setTimeout(function() { if (window.photoPreviewCurrent && window.photoPreviewCurrent.__xtjPostId === photo.__xtjPostId) syncPostPhotoPreviewChrome(window.photoPreviewCurrent); }, 30);
                setTimeout(function() { if (window.photoPreviewCurrent && window.photoPreviewCurrent.__xtjPostId === photo.__xtjPostId) syncPostPhotoPreviewChrome(window.photoPreviewCurrent); }, 480);
                return true;
            }
            window.openPostImagePreview = openPostImagePreview;
            window.syncPostPhotoPreviewChrome = syncPostPhotoPreviewChrome;

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

            window.deletePostPhotoFromPreview = function() {
                var ctx = window.__xtjPhotoPreviewContext || null;
                var current = window.photoPreviewCurrent || null;
                if (current && current.__xtjSource === 'post') {
                    if (!ctx || ctx.kind !== 'post' || String(ctx.postId) !== String(current.__xtjPostId) || !ctx.canDelete || !current.__xtjCanDelete) {
                        showToast('仅发布者可删除');
                        return;
                    }
                    var identity = capturePostActionIdentity();
                    if (typeof window.closePhotoPreview === 'function') window.closePhotoPreview();
                    setTimeout(function() {
                        if (postActionIdentityCurrent(identity)) openDelete(ctx.postId, ctx.actorKey || '');
                    }, 60);
                    return;
                }
                if (typeof window.deletePhotoFromPreview === 'function') {
                    window.deletePhotoFromPreview();
                }
            };

            window.deleteCurrentPhoto = window.deletePostPhotoFromPreview;

            document.addEventListener('keydown', function (e) {
                if (e.key !== 'Escape') return;
                var iv = document.getElementById('imgViewer');
                if (iv && iv.classList.contains('active')) { closeImageViewer(); return; }
                var am = document.getElementById('announcementModal');
                if (am && am.classList.contains('active')) { closeAnnouncementModal(); return; }
                var sm = document.getElementById('statModal');
                if (sm && sm.classList.contains('active')) { closeModal('statModal'); return; }
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

            // ===================== 浏览历史加载 =====================
            // 保存浏览历史：分页加载相关变量
            // (已收敛单一实现：旧 function saveViewHistory 声明为死代码，删除)
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
                const key = `xtj_v_${encodeURIComponent(currentUser || '')}_${postId}`;
                const now = Date.now();
                var last = 0;
                try { last = Number(window.safeStorage.get(key) || 0); } catch (e) { last = 0; }
                if (viewTracked.has(key) && now - last < VIEW_TRACK_TTL) return false;
                if (last && now - last < VIEW_TRACK_TTL) return false;
                return true;
            }

            trackView = function(postId) {
                const key = `xtj_v_${encodeURIComponent(currentUser || '')}_${postId}`;
                if (!canTrackViewNow(postId)) return false;
                // ★ 修复：未登录时不记录浏览——静默返回（此前 throw + console.error
                // 导致每次滚动浏览都报错刷屏，且删除节流标记造成无限重复触发）。
                if (!currentUser || typeof window.xtjProtectedFetch !== 'function') return false;
                var viewOwner = currentUser, viewEpoch = _authStateEpoch;
                var identityCurrent = function() { return currentUser === viewOwner && _authStateEpoch === viewEpoch; };
                viewTracked.add(key);
                // ★ 修复：请求发出前先写节流键，防止键仅成功后写入期间
                // 1 秒内重复触发并发 POST（在途请求保护）
                window.safeStorage.set(key, String(Date.now()));
                setTimeout(async () => {
                    try {
                        if (!identityCurrent()) throw new Error('view_identity_changed');
                        var response = await window.xtjProtectedFetch('/api/post/view', {
                            method: 'POST', authOwner: viewOwner, authEpoch: viewEpoch,
                            body: JSON.stringify({ post_id: String(postId) })
                        });
                        var result = await response.json().catch(function() { return {}; });
                        if (!identityCurrent()) throw new Error('view_identity_changed');
                        if (!response.ok || !result.ok) throw new Error(result.error || 'view_record_failed');
                        var authoritativeViews = Number(result.views);
                        if (Number.isFinite(authoritativeViews)) {
                            var postEl = findBySafePostSelector(postId);
                            var statsEl = postEl && postEl.querySelector('.post-stats-text');
                            // ★ 修复：原用无锚点的 /\d+/ 替换，会命中文案里的**第一个**数字。
                            //   正常文案「浏览 1｜点赞 0｜评论 0」下恰好是浏览数，
                            //   但一旦文案改版（如「3 小时前 · 浏览 1」）就会把时间数字改掉。
                            //   改为锚定「浏览」/👁 后的数字，只替换目标位置。
                            if (statsEl) {
                                statsEl.textContent = statsEl.textContent.replace(
                                    /((?:浏览|👁)\s*)(\d+)/,
                                    function (_m, prefix) { return prefix + String(authoritativeViews); }
                                );
                            }
                            var detailModal = document.getElementById('postDetailModal');
                            var detailStats = document.querySelector('#postDetailBody .post-detail-stats');
                            if (detailModal && detailModal.classList.contains('active') &&
                                String(window.__xtjPostDetailCurrentId || '') === String(postId) && detailStats) {
                                detailStats.textContent = detailStats.textContent.replace(
                                    /((?:浏览|👁)\s*)(\d+)/,
                                    function (_m, prefix) { return prefix + String(authoritativeViews); }
                                );
                            }
                            if (Array.isArray(feedAllPosts)) {
                                feedAllPosts = feedAllPosts.map(function(post) {
                                    return post && String(post.id) === String(postId) ? Object.assign({}, post, { views: authoritativeViews }) : post;
                                });
                                if (typeof writeFeedCacheSnapshot === 'function') writeFeedCacheSnapshot();
                            }
                            var detailSnapshot = window.__xtjPostDetailSnapshot;
                            if (detailSnapshot && String(detailSnapshot.id) === String(postId)) { detailSnapshot.views = authoritativeViews; detailSnapshot.view_count = authoritativeViews; }
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
                        viewTracked.delete(key);
                        try { window.safeStorage.remove(key); } catch (_) {}
                        if (identityCurrent()) console.error(e);
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
                var detail = window.__xtjPostDetailSnapshot;
                return (detail && String(detail.id) === String(postId) ? detail : null) || found || postInfoCache[postId] || null;
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
            let feedNextCursor = null;
            let feedLoadedPages = [];
            let feedPageFetchPending = false;
            // ★ 修复：加载更多失败后置位，哨兵不再自动触发（防无限重复请求），
            // 需用户点击错误提示"重试"才清除并重新加载
            let feedLoadMoreFailed = false;

            window.__xtjResetPostState = function() {
                feedLoadRequestId++;
                feedPageFetchPending = false;
                feedLoadMoreFailed = false;
                feedPage = 1;
                feedEndReached = false;
                feedNextOffset = 0;
                feedNextCursor = null;
                feedLoadedPages = [];
                feedAllPosts = [];
                feedAllComments = [];
                feedAllLikes = [];
                likeOperations = Object.create(null);
                window.isPinningPost = false;
                postPinFlight = null;
                window.isTogglingPostVisibility = false;
                postVisibilityFlight = null;
                if (_persistLikesTimer) clearTimeout(_persistLikesTimer);
                _persistLikesTimer = null;
                if (feedCacheWriteTimer) clearTimeout(feedCacheWriteTimer);
                feedCacheWriteTimer = null;
                Object.keys(_pendingCardPatchTimers || {}).forEach(function(key) {
                    clearTimeout(_pendingCardPatchTimers[key].timer);
                });
                _pendingCardPatchTimers = {};
                if (feedScrollObserver) feedScrollObserver.disconnect();
                if (window.__xtjRunMentionCleanups) window.__xtjRunMentionCleanups();
                resetPostActionModals();
                closePostToolsMenu(true);
                document.querySelectorAll('.post-tool-critique').forEach(function(panel) {
                    if (panel.__aiSession) { panel.__aiSession.isClosed = true; panel.__aiSession.controller.abort(); }
                });
                if (window.__xtjCancelPostDetail) window.__xtjCancelPostDetail();
                upcRequestSeq++;
                upcTargetUser = null;
                if (typeof window.__xtjCloseAuthorPosts === 'function') window.__xtjCloseAuthorPosts();
                var authorModal = document.getElementById('userProfileModal');
                if (authorModal) authorModal.classList.remove('active');
                Object.keys(postInfoCache).forEach(function(key) { delete postInfoCache[key]; });
                resetFeedDomTrimmed();
                markFeedStateChanged();
                var feed = document.getElementById('feed');
                if (feed) feed.textContent = '';
            };

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
                    media_items: normalized.media_items || [],
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
                        if (entry.isIntersecting && !feedLoadMoreFailed &&
                            (!feedEndReached || getFeedRenderedSliceStart() < getFilteredPosts(feedAllPosts, feedAllComments).length)) {
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
                var requestedEntries={};uncached.forEach(function(name){requestedEntries[name]=avatarCache[name];});
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
                            if(avatarCache[k]!==requestedEntries[k])continue;
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
                var authorAttrs = ' role="button" tabindex="0" aria-label="查看 ' + safeName + ' 的动态" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click();}"';

                if (avatarUrl && sanitizeUrl(avatarUrl)) {
                    return '<div class="avatar-wrap"' + authorAttrs + ' onclick="openUserProfile(\'' +
                        safeNameJs +
                        '\')" data-user-name="' + safeName +
                        '"><div class="avatar clickable">' +
                        renderAvatarContent(safeUser, avatarUrl) +
                        '</div></div>';
                }

                return '<div class="avatar clickable"' + authorAttrs + ' onclick="openUserProfile(\'' +
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
                // ★ 修复（XSS 防护一致性）：此前只做 escapeHtml，未过 sanitizeUrl 协议白名单。
                //   若缓存/服务端下发 `javascript:` 或 `data:text/html` 形态 URL，会直接进 src。
                //   与本文件 renderAvatarContent（1678 行）保持一致，统一走 sanitizeUrl。
                if (avatarUrl && sanitizeUrl(avatarUrl)) {
                    return '<span class="post-user-chip-avatar"><img loading="lazy" decoding="async" src="' + escapeHtml(sanitizeUrl(avatarUrl)) + '" alt="' + safeName + '"></span>';
                }
                try {
                    var cachedAvatars = readAvatarCacheFromStorage();
                    if (cachedAvatars[username] && cachedAvatars[username].url && sanitizeUrl(cachedAvatars[username].url)) {
                        avatarCache[username] = cachedAvatars[username];
                        return '<span class="post-user-chip-avatar"><img loading="lazy" decoding="async" src="' + escapeHtml(sanitizeUrl(cachedAvatars[username].url)) + '" alt="' + safeName + '"></span>';
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
                    var safeJsName = safeJsStr(String(username));
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
                // ★ 2026-09-26（审计 P2-3）：记录加载时间，供 toggleFilterPanel 做 TTL 判断
                window.__xtjPostFilterUsersLoadedAt = Date.now();
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
                // ★ 修复：多行帖正文换行——escapeHtml 后把 \n 替换为 <br>（与 early-feed.js 行为一致）；
                // 仅作用于 feed 正文渲染，评论/标题等不走本函数，不受影响。
                return escapeHtml(String(content || '')).replace(/\n/g, '<br>');
            }
            window.buildPostContentHtml = buildPostContentHtml;

            function initPostScrollAnimation() {
                var posts = document.querySelectorAll('.post');
                primePostReveal(posts);
                observePostViewportState(posts);
            }

            let _cachedSPosts = null, _cachedSViews = null, _cachedSLikes = null;
            // ★ 2026-09-27 修复（审计 P4：顶部统计两套口径，数字突变）：
            //   根因：renderFeed 把 sPosts 写成 window._xtjTotalPostCount（服务端全站总量，
            //   如 1234），而 updateFeedStats 写 feedAllPosts.length（已加载数，如 40）。
            //   用户点赞一次 → applyPostLikeIntent → updateFeedStats → sPosts 从 1234 突变成 40，
            //   统计区数字不可信。
            //   语义裁定：HTML 中该标签是「总动态」（index.html 的 <b id="sPosts"> 对应
            //   <span>总动态</span>），点击进详情也是全站动态，故统一为「服务端已知总量」，
            //   无该值时退回当前已加载帖子数。两处共用本函数，口径唯一。
            function resolveTotalPostCount() {
                var known = Number(window._xtjTotalPostCount);
                if (Number.isFinite(known) && known >= 0) return known;
                return Array.isArray(feedAllPosts) ? feedAllPosts.length : 0;
            }
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
                // 缓存引用前先校验节点仍在文档中，避免节点被 innerHTML 重写后写入已脱离文档的旧节点
                var sPosts = (_cachedSPosts && document.body.contains(_cachedSPosts)) ? _cachedSPosts : (_cachedSPosts = document.getElementById('sPosts'));
                var sViews = (_cachedSViews && document.body.contains(_cachedSViews)) ? _cachedSViews : (_cachedSViews = document.getElementById('sViews'));
                var sLikes = (_cachedSLikes && document.body.contains(_cachedSLikes)) ? _cachedSLikes : (_cachedSLikes = document.getElementById('sLikes'));
                if (sPosts) sPosts.textContent = resolveTotalPostCount();
                if (sViews) sViews.textContent = totalViews;
                // 只显示点赞数；互动合计见统计弹层文案
                if (sLikes) sLikes.textContent = totalLikes;
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

            async function insertPostRecord(payload, fallbackContent, flight) {
                try {
                    assertPostPublishIdentity(flight);
                    var body = {
                        content: payload.content || fallbackContent || '',
                        media_url: payload.media_url || '',
                        media_type: payload.media_type || '',
                        actor_key: payload.actor_key || '',
                        visibility: payload.visibility || 'public',
                        media_upload_id: payload.media_upload_id || null,
                        media_storage_path: payload.media_storage_path || null,
                        attachments: payload.attachments || undefined
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
                        authOwner: flight.owner, authEpoch: flight.epoch,
                        body: JSON.stringify(body)
                    });
                    var result = await response.json().catch(function() { return {}; });
                    assertPostPublishIdentity(flight);
                    if (!response.ok || !result.ok || !result.data) {
                        return { ok: false, error: new Error(result.error || '发布失败') };
                    }
                    var data = normalizePost(result.data);
                    if (data && data.id && (!data.ip_region_text || !data.ip_region_status || !data.location_name)) {
                        try {
                            var fresh = await fetchPostSnapshot(data.id);
                            assertPostPublishIdentity(flight);
                            if (fresh) data = normalizePost(Object.assign({}, data, fresh, { media_items: data.media_items }));
                        } catch (snapshotError) {
                            if (snapshotError && snapshotError.code === 'identity_changed') throw snapshotError;
                            console.warn('[post-create] snapshot refresh failed', snapshotError);
                        }
                    }
                    assertPostPublishIdentity(flight);
                    return { ok: true, fallback: false, data: data };
                } catch (error) {
                    return { ok: false, error: error };
                }
            }

            function insertPublishedPostIntoFeed(post, publishingMotion) {
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
                postEl.classList.add('visible');
                if (!publishingMotion) postEl.classList.add('is-newly-published');
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
                var existing = (function() {
                    var sel = safePostSelector(postId);
                    return sel ? feed.querySelector(sel) : null;
                })();
                if (!existing) return false;
                var locationHolder = document.createElement('div');
                locationHolder.innerHTML = buildPostLocationHtml(post);
                var nextIp = locationHolder.querySelector('.post-ip-region');
                var oldIp = existing.querySelector('.post-ip-region');
                var oldLocation = existing.querySelector('.post-location-info');
                if (nextIp) {
                    if (oldIp) {
                        oldIp.textContent = nextIp.textContent;
                    } else {
                        if (!oldLocation) {
                            oldLocation = document.createElement('div');
                            oldLocation.className = 'post-location-info';
                            var stats = existing.querySelector('.post-stats-text');
                            if (stats && stats.parentNode) stats.parentNode.insertBefore(oldLocation, stats);
                            else existing.appendChild(oldLocation);
                        }
                        oldLocation.appendChild(nextIp);
                    }
                } else if (oldIp) {
                    oldIp.remove();
                    if (oldLocation && !oldLocation.children.length) oldLocation.remove();
                }
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
                var attempts = 0, owner = currentUser, epoch = _authStateEpoch;
                // Track the complete server retry schedule: an immediate retry, then 30s,
                // then 5m. The extra polling margin covers the resolver deadline on the
                // final attempt so a successful backend update is not missed by this card.
                var maxAttempts = 19;
                var attemptDelaysMs = [600, 1200, 2500, 5000, 8000, 15000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000, 30000];
                function nextDelayMs() {
                    return attemptDelaysMs[Math.min(attempts, attemptDelaysMs.length) - 1] || 900;
                }
                function cleanup() {
                    delete publishedPostIpRefreshTimers[key];
                }
                function run() {
                    if (owner !== currentUser || epoch !== _authStateEpoch) { cleanup(); return; }
                    attempts++;
                    fetchPostSnapshot(postId).then(function(freshPost) {
                        if (owner !== currentUser || epoch !== _authStateEpoch) { cleanup(); return; }
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
                                setTimeout(run, nextDelayMs());
                            } else {
                                cleanup();
                            }
                            return;
                        }
                        if (attempts < maxAttempts) {
                            setTimeout(run, nextDelayMs());
                        } else {
                            cleanup();
                        }
                    }).catch(function() {
                        if (attempts < maxAttempts) {
                            setTimeout(run, nextDelayMs());
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
                if (window.XtjPostComposerMedia) window.XtjPostComposerMedia.clear();
                if (visibilityEl) visibilityEl.value = window.__xtjDefaultPostVisibility || "public";
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
                if (!fetched.data) return null;
                var existing = (feedAllPosts || []).find(function(post) { return String(post.id) === String(postId); });
                if (!existing && window.__xtjPostDetailSnapshot && String(window.__xtjPostDetailSnapshot.id) === String(postId)) existing = window.__xtjPostDetailSnapshot;
                return existing && Array.isArray(existing.media_items) ? Object.assign({}, fetched.data, { media_items: existing.media_items }) : fetched.data;
            }

            async function updatePostRecord(post, updates) {
                var identity = capturePostActionIdentity();
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
                    method: 'POST', authOwner: identity.owner, authEpoch: identity.epoch,
                    body: JSON.stringify(updatePayload)
                });
                var result = await resp.json().catch(function() { return {}; });
                assertPostActionIdentity(identity);
                if (!resp.ok || !result.ok) return { ok: false, error: new Error(result.error || '更新失败') };
                // 优先使用后端返回的 data，否则重新查询
                var verified = result.data ? normalizePost(result.data) : null;
                if (!verified) {
                    var verifyRes = await sb.from('posts').select('*').eq('id', post.id).maybeSingle();
                    assertPostActionIdentity(identity);
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
                if (typeof window.__xtjUpdateAuthorPost === "function") window.__xtjUpdateAuthorPost(verified);
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
                    '<button class="action-btn like-btn ' + (isLiked ? 'liked' : '') + '" aria-pressed="' + (isLiked ? 'true' : 'false') + '" aria-label="' + (isLiked ? '取消点赞' : '点赞') + '" onclick="toggleLike(this, \'' + idJs + '\')">' + buildLikeButtonContent(isLiked) + '</button>',
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
            var closingPostToolsMenus = new Set();
            function removePostToolsMenu(entry) {
                closingPostToolsMenus.delete(entry);
                if (entry.animation) { entry.animation.cancel(); entry.animation = null; }
                entry.menu.remove();
            }
            function animatePostToolsMenu(entry, opening, fresh) {
                var menu = entry.menu;
                if (typeof menu.animate !== 'function' || document.documentElement.getAttribute('data-xtj-motion') === 'off' ||
                    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
                    if (!opening) removePostToolsMenu(entry);
                    return;
                }
                // Snapshot the interrupted frame so rapid close/reopen reverses smoothly.
                var style = getComputedStyle(menu);
                var from = fresh ? {opacity:0,transform:'translate3d(0,-5px,0) scale(.97)'} : {opacity:style.opacity,transform:style.transform};
                if (entry.animation) entry.animation.cancel();
                var animation = menu.animate([from, opening ? {opacity:1,transform:'translate3d(0,0,0) scale(1)'} : {opacity:0,transform:'translate3d(0,-4px,0) scale(.98)'}],
                    {duration:opening ? 190 : 150,easing:'cubic-bezier(.2,.7,.2,1)',fill:'both'});
                entry.animation = animation;
                animation.finished.then(function() {
                    if (entry.animation !== animation) return;
                    if (opening) { entry.animation = null; animation.cancel(); }
                    else removePostToolsMenu(entry);
                }, function() {});
            }
            function closePostToolsMenu(immediate) {
                if (immediate === true) Array.from(closingPostToolsMenus).forEach(removePostToolsMenu);
                if (!activePostToolsMenu) return;
                var entry = activePostToolsMenu;
                activePostToolsMenu = null;
                if (entry.trigger) entry.trigger.setAttribute('aria-expanded', 'false');
                entry.menu.classList.add('is-closing');
                entry.menu.setAttribute('aria-hidden', 'true'); entry.menu.setAttribute('inert', '');
                closingPostToolsMenus.add(entry);
                if (immediate === true) removePostToolsMenu(entry);
                else animatePostToolsMenu(entry, false);
            }
            function activatePostToolsMenu(entry, fresh) {
                var menu = entry.menu, trigger = entry.trigger;
                var rect = trigger.getBoundingClientRect(), width = menu.offsetWidth || 148, height = menu.offsetHeight;
                menu.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)) + 'px';
                menu.style.top = Math.max(8, Math.min(window.innerHeight - height - 8, rect.bottom + 6)) + 'px';
                menu.classList.remove('is-closing'); menu.removeAttribute('aria-hidden'); menu.removeAttribute('inert');
                closingPostToolsMenus.delete(entry);
                trigger.setAttribute('aria-expanded', 'true'); activePostToolsMenu = entry;
                animatePostToolsMenu(entry, true, fresh);
            }

            function openPostToolsMenu(trigger) {
                if (!trigger) return;
                if (activePostToolsMenu && activePostToolsMenu.trigger === trigger) {
                    closePostToolsMenu();
                    return;
                }
                closePostToolsMenu();
                var returning = Array.from(closingPostToolsMenus).find(function(entry) { return entry.trigger === trigger; });
                if (returning) { activatePostToolsMenu(returning, false); return; }
                var postId = String(trigger.getAttribute('data-post-id') || '');
                if (!postId) return;
                var menu = document.createElement('div');
                menu.className = 'post-tools-menu';
                menu.setAttribute('role', 'menu');
                var svgTranslate = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';
                var svgAi = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3l1.9 5.8 1.9-5.8a2 2 0 0 1 1.3-1.3l5.8-1.9-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>';
                var svgReport = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>';
                var post = feedAllPosts.find(function(p) { return String(p.id) === String(postId); });
                if (!post && window.currentPost && String(window.currentPost.id) === String(postId)) post = window.currentPost;
                var hasText = post && String(post.content || '').trim().length > 0;
                var btnTranslate = hasText ? '<button type="button" role="menuitem" data-post-tool="translate" data-post-id="' + escapeHtml(postId) + '">' + svgTranslate + '<span>翻译帖子</span></button>' : '';
                var btnAi = hasText ? '<button type="button" role="menuitem" data-post-tool="ask-ai" data-post-id="' + escapeHtml(postId) + '">' + svgAi + '<span>锐评 AI</span></button>' : '';
                menu.innerHTML = btnTranslate + btnAi +
                                 '<button type="button" role="menuitem" data-post-tool="report" data-post-id="' + escapeHtml(postId) + '">' + svgReport + '<span>举报帖子</span></button>';
                document.body.appendChild(menu);
                activatePostToolsMenu({ menu: menu, trigger: trigger, animation: null }, true);
            }
            window.closePostToolsMenu = closePostToolsMenu;
            window.addEventListener('pagehide', function() { closePostToolsMenu(true); });
            window.addEventListener('scroll', closePostToolsMenu, { passive: true });
            window.addEventListener('resize', closePostToolsMenu, { passive: true });
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', closePostToolsMenu, { passive: true });
                window.visualViewport.addEventListener('scroll', closePostToolsMenu, { passive: true });
            }
            // Capture scroll from dock panels as well as the document; the menu is appended to body.
            document.addEventListener('scroll', closePostToolsMenu, { capture: true, passive: true });
            document.addEventListener('visibilitychange', function() {
                if (document.hidden) closePostToolsMenu(true);
            });

            var activePostAiSession = null;
            function getPostToolAnchor(postId) {
                var esc = escapeCssIdent(postId);
                var detail = document.getElementById('postDetailModal');
                var scope = detail && detail.classList.contains('active') ? detail : document;
                return esc ? scope.querySelector('.post-tools-trigger[data-post-id="' + esc + '"]') : null;
            }
            function postToolFetch(body) {
                var identity = capturePostActionIdentity();
                return window.xtjProtectedFetch('/api/agent/post-tools', {
                    method: 'POST', authOwner: identity.owner, authEpoch: identity.epoch, body: JSON.stringify(body)
                }).then(function(resp) {
                    return resp.json().then(function(data) {
                        assertPostActionIdentity(identity);
                        if (!resp.ok) throw new Error(data.error || 'post_tool_failed');
                        return data;
                    });
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
                if (existing && !existing.classList.contains('is-error')) { existing.hidden = !existing.hidden; return; }
                if (existing) existing.remove();
                var panel = document.createElement('section');
                panel.className = 'post-tool-translation';
                panel.textContent = '正在翻译...';
                actions.insertAdjacentElement('afterend', panel);
                postToolFetch({ post_id: postId, action: 'translate' }).then(function(data) {
                    panel.textContent = data.translation || '暂时无法翻译该帖子。';
                    panel.classList.toggle('is-original-chinese', !!data.already_chinese);
                }).catch(function(error) {
                    if (error.code === 'identity_changed' || !panel.isConnected) return;
                    panel.textContent = '翻译暂时不可用。'; panel.classList.add('is-error');
                });
            };
            function runPostAiRequest(session, payload) {
                if (!session.identity) session.identity = capturePostActionIdentity();
                if (!postActionIdentityCurrent(session.identity)) return;
                var requestId = ++session.requestId;
                function isCurrentRequest() {
                    return !session.isClosed && requestId === session.requestId &&
                        postActionIdentityCurrent(session.identity) && session.output.isConnected !== false;
                }
                session.output.textContent = 'AI 正在锐评...';
                session.output.classList.remove('is-error');
                session.controller.abort();
                session.controller = new AbortController();
                window.xtjProtectedFetch('/api/agent/post-chat/stream', { method: 'POST', authOwner: session.identity.owner, authEpoch: session.identity.epoch, body: JSON.stringify(payload), signal: session.controller.signal }).then(function(resp) {
                    if (!isCurrentRequest()) { session.controller.abort(); return null; }
                    if (!resp.ok || !resp.body) throw new Error('post_chat_failed');
                    return resp.body.getReader();
                }).then(function(reader) {
                    if (!reader) return;
                    var decoder = new TextDecoder(), buffer = '';
                    var receivedContent = false;
                    function read() { return reader.read().then(function(chunk) {
                        if (!isCurrentRequest()) {
                            return reader.cancel().catch(function() {});
                        }
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
                                // 按 event: 行判定增量/整段，而不是对整块字符串做 indexOf 前缀匹配。
                                // 后者在事件块前有 SSE 心跳注释(: ...)或空白行时会误判为整段覆盖，
                                // 导致锐评"闪一下"或只剩半句。
                                var eventLine = event.split('\n').filter(function(line) { return line.indexOf('event: ') === 0; })[0];
                                var isDeltaEvent = !!(eventLine && eventLine.slice(7).trim() === 'delta');
                                session.output.textContent = isDeltaEvent ? (session.output.textContent === 'AI 正在锐评...' ? '' : session.output.textContent) + data.content : data.content;
                            }
                            if (data.error) { session.output.textContent = 'AI 暂时不可用。'; session.output.classList.add('is-error'); }
                        });
                        return read();
                    }); }
                    return read();
                }).catch(function(error) {
                    if (error.name !== 'AbortError' && isCurrentRequest()) {
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
                    // 兜底：目标始终未出现时 5s 强制断开，避免监听器常驻泄漏
                    window.setTimeout(function() { try { observer.disconnect(); } catch (e) {} }, 5000);
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
            // 供 core-parts/06 的帖子详情弹窗复用（各 part 为独立 IIFE，跨 part 走 window）
            window.buildPostLocationHtml = buildPostLocationHtml;

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

            function getPostMediaItems(post) {
                return window.XtjPostMedia ? window.XtjPostMedia.getPostMediaItems(post) : (post.media_url ? [{ media_url: post.media_url, media_type: post.media_type, position: 0 }] : []);
            }
            function renderPostMediaGrid(post, options) {
                var items = getPostMediaItems(post).filter(function(item) { return !!sanitizeUrl(item.media_url || ''); });
                if (!items.length) return '';
                var first = items[0], safeMediaUrl = sanitizeUrl(first.media_url);
                if (first.media_type === 'video') return '<div class="media"><video src="' + escapeHtml(safeMediaUrl) + '" controls preload="none" playsinline></video></div>';
                if (first.media_type === 'audio') return '<div class="media"><audio src="' + escapeHtml(safeMediaUrl) + '" controls preload="metadata"></audio></div>';
                var visible = options && options.detail ? items : items.slice(0, 9);
                var columns = window.XtjPostMedia ? window.XtjPostMedia.gridColumns(items.length) : 1;
                return '<div class="media post-media-grid' + (items.length === 1 ? ' post-media-grid--single' : '') + '" style="--post-grid-columns:' + columns + '">' + visible.map(function(item, index) {
                    var url = sanitizeUrl(item.media_url), width = Number(item.width), height = Number(item.height);
                    var validDims = width > 0 && height > 0 && width <= 20000 && height <= 20000;
                    var ratio = validDims ? width + ' / ' + height : '4 / 3';
                    var aspect = validDims ? width / height : 4 / 3;
                    var singleSize = '--post-single-max-width:' + (aspect * 520) + 'px;--post-single-viewport-width:' + (aspect * 65) + 'vh;';
                    var attrs = 'data-post-id="' + escapeHtml(String(post.id)) + '" data-post-media-index="' + index + '" data-media-url="' + escapeHtml(url) + '"' +
                        ' data-post-user="' + escapeHtml(post.user_name || '') + '" data-post-created-at="' + escapeHtml(post.created_at || '') + '" data-post-views="' + escapeHtml(String(post.views || 0)) + '"' +
                        ' data-file-size="' + escapeHtml(String(item.file_size || '')) + '" data-actor-key="' + escapeHtml(post.actor_key || '') + '" data-can-delete="' + (canDeletePost(post) ? '1' : '0') + '"';
                    var dims = validDims ? ' width="' + width + '" height="' + height + '"' : '';
                    return '<button type="button" class="post-media-cell" aria-label="查看第' + (index + 1) + '张图片，共' + items.length + '张" style="--post-image-ratio:' + ratio + ';' + singleSize + '" onclick="if(this.classList.contains(\'post-image-failed\'))retryPostImage(this);else openImageViewer(\'' + safeJsStr(url) + '\', this.querySelector(\'img\'))">' +
                        '<img ' + attrs + dims + ' style="aspect-ratio:' + ratio + '" src="' + escapeHtml(url) + '" alt="帖子图片 ' + (index + 1) + '" loading="lazy" decoding="async" fetchpriority="low" onload="syncPostImageRatio(this)" onerror="markPostImageFailed(this)">' +
                        '<span class="post-media-error" role="status">图片未加载 · 点击重试</span>' +
                        (index === 8 && items.length > visible.length ? '<span class="post-media-overflow">+' + (items.length - visible.length) + '</span>' : '') + '</button>';
                }).join('') + '</div>';
            }
            window.getPostMediaItems = getPostMediaItems;
            window.renderPostMediaGrid = renderPostMediaGrid;
            window.markPostImageFailed = function(img) {
                var cell = img && img.closest('.post-media-cell');
                if (cell) cell.classList.add('post-image-failed');
            };
            window.retryPostImage = function(cell) {
                var img = cell && cell.querySelector('img');
                var url = img && sanitizeUrl(img.getAttribute('data-media-url') || '');
                if (!url) return;
                cell.classList.remove('post-image-failed');
                img.removeAttribute('src'); img.src = window.xtjRetryOriginalImageUrl ? window.xtjRetryOriginalImageUrl(url) : url;
            };
            window.syncPostImageRatio = function(img) {
                var parent = img && img.closest('.post-media-cell');
                if (parent) parent.classList.remove('post-image-failed');
                var cell = img && img.closest('.post-media-grid--single .post-media-cell');
                if (!cell || !img.naturalWidth || !img.naturalHeight) return;
                var ratio = img.naturalWidth / img.naturalHeight;
                cell.style.setProperty('--post-image-ratio', img.naturalWidth + ' / ' + img.naturalHeight);
                cell.style.setProperty('--post-single-max-width', (ratio * 520) + 'px');
                cell.style.setProperty('--post-single-viewport-width', (ratio * 65) + 'vh');
            };

            var expandedPostComments = new Set(), expandedCommentsOwner = currentUser;
            function canOpenFeedPostDetail(post) {
                return !!post && getPostMediaItems(post).filter(function(item) { return item.media_type === 'image'; }).length > 9;
            }
            window.showFeedPostComments = function(postId) {
                var post = (feedAllPosts || []).find(function(p) { return String(p.id) === String(postId); });
                if (canOpenFeedPostDetail(post)) { window.openPostDetail(postId); return; }
                expandedPostComments.add(String(postId)); schedulePostCardPatch(postId);
            };
            if (typeof window.addEventListener === 'function') window.addEventListener('auth-ready', function() { if (expandedCommentsOwner !== currentUser) { expandedPostComments.clear(); expandedCommentsOwner = currentUser; } });
            function buildPostCommentsHtml(post, pComms, options) {
                if (!pComms.length) return '';
                var limit = (options && options.detail) || expandedPostComments.has(String(post.id)) ? Infinity : 3;
                function commentDeleteButton(comment) {
                    if (!comment || !currentUser || !(isAdmin() || String(comment.user_name || '') === String(currentUser))) return '';
                    return '<button type="button" class="comment-del-btn" onclick="deleteFeedComment(\'' + safeJsStr(comment.id) + '\', this)">删除</button>';
                }
                      var _byId = {}; var _seen = Object.create(null); var _count = 0;
                      pComms.forEach(function(c) { _byId[String(c.id)] = c; });
                      var _childrenOf = {};
                      var _roots = [];
                      pComms.forEach(function(c) {
                        var _pid = (c.parent_comment_id != null && String(c.parent_comment_id) !== '') ? String(c.parent_comment_id) : '';
                        if (_pid && _byId[_pid]) {
                          (_childrenOf[_pid] = _childrenOf[_pid] || []).push(c);
                        } else {
                          _roots.push(c);
                        }
                      });
                      function _renderCommentNode(c, depth) {
                        depth = typeof depth === 'number' ? depth : 0;
                        if (_seen[String(c.id)] || _count >= limit) return '';
                        _seen[String(c.id)] = true; _count++;
                        var _node;
                        if (c.user_name === 'cat_ai' && c.generated_by_ai) {
                          _node = '<div class="comment-item cat-ai-comment" data-comment-id="' + escapeHtml(c.id) + '" data-parent-comment-id="' + escapeHtml(c.parent_comment_id || '') + '"><div class="comment-item-inner"><span class="cat-ai-avatar" aria-label="小猫">🐱</span><div class="comment-item-body"><div class="comment-item-header"><b class="cat-ai-name">小猫</b><span class="cat-ai-badge">AI</span><span class="comment-item-time">' + escapeHtml(c.created_at ? formatRelativeTime(c.created_at) : '刚刚') + '</span>' + commentDeleteButton(c) + '</div><div class="comment-item-content">' + escapeHtml(c.content) + '</div></div></div></div>';
                        } else {
                          _node = '<div class="comment-item" data-comment-id="' + escapeHtml(c.id) + '"><div><b>' + escapeHtml(c.user_name) + ':</b> ' + escapeHtml(c.content) + '</div>' + commentDeleteButton(c) + '</div>';
                        }
                        var _kids = _childrenOf[String(c.id)] || [];
                        if (_kids.length && depth < 8 && _count < limit) {
                          _node += '<div class="comment-replies" style="margin-left:24px; margin-top:8px;">' + _kids.map(function(child) { return _renderCommentNode(child, depth + 1); }).join('') + '</div>';
                        }
                        return _node;
                      }
                var html = _roots.map(function(c) { return _renderCommentNode(c, 0); }).join('');
                // Orphan/cyclic/deep historical replies stay readable without unbounded recursion.
                pComms.forEach(function(c) { if (!_seen[String(c.id)] && _count < limit) html += _renderCommentNode(c, 0); });
                if (pComms.length > _count) html += '<button type="button" class="post-all-comments" onclick="showFeedPostComments(\'' + safeJsStr(String(post.id)) + '\')">查看全部 ' + pComms.length + ' 条评论</button>';
                return '<div class="comments">' + html + '</div>';
            }
            window.buildPostCommentsHtml = buildPostCommentsHtml;

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
                var mediaMarkup = renderPostMediaGrid(normalized);
                return `
                <div class="post post-feed-item" data-post-id="${escapeHtml(normalized.id)}" data-post-user="${escapeHtml(normalized.user_name || "")}">
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
                  ${buildPostCommentsHtml(normalized, pComms)}
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

            // ★ 2026-09-27 新增（审计 P2：评论 Realtime 触发全量重建）：
            //   背景：subscribeToComments 的 Realtime 回调里，收到一条**普通评论 INSERT**
            //   就调 renderFeedFromMemoryState() → renderFeed() → renderFeedWithAvatars()，
            //   而后者是 `feed.innerHTML = 全部卡片` 的整段重建。全站任意用户发评论都会
            //   推给所有在线端，于是：
            //     · 正在评论框里打字的人，草稿节点被销毁 → 输入丢失；
            //     · 已经加载到第 10 屏的人，滚动位置被拽回重建后的内容；
            //     · 评论框展开状态、正在播放的视频、已加载的图片全部重置（图片重新请求）；
            //     · 卡片上的「小猫 AI 正在组织语言」气泡也会被重绘。
            //   现在只重渲染受影响的评论与统计子树；保留 .post 根节点及其媒体、
            //   评论输入框、焦点和其他临时交互状态。
            //   若目标卡片不在 DOM 中（尚未加载到 / 被筛选掉 / 被 DOM 回收），
            //   安全回退到原有全量刷新路径，保证行为不退化。
            //   ⚠️ 不触碰 dock bar / dock capsule / 动画相关逻辑。
            function patchSinglePostCard(postId) {
                try {
                    var feed = document.getElementById('feed');
                    if (!feed || postId == null) return false;
                    var post = (feedAllPosts || []).find(function(p) {
                        return String(p && p.id) === String(postId);
                    });
                    if (!post) return false;
                    var _cardSel = safePostSelector(postId);
                    var card = _cardSel ? feed.querySelector(_cardSel) : null;
                    if (!card) return false;
                    var filtered = getFilteredPosts([post], feedAllComments);
                    if (!filtered || !filtered.length) {
                        // 被当前筛选排除 → 直接移除卡片，无需重绘
                        if (card.parentNode) card.parentNode.removeChild(card);
                        window._xtjFeedDomTrimmed = Math.max(0, (Number(window._xtjFeedDomTrimmed) || 0));
                        return true;
                    }
                    var scopedComments = getRenderableComments(feedAllComments, filtered);
                    var maps = buildPostMaps(scopedComments, feedAllLikes || []);
                    var html = renderPostCardSafely(filtered[0], maps.commentMap, maps.likeMap, maps.likeUserMap);
                    if (!html) return false;
                    var tmp = document.createElement('div');
                    tmp.innerHTML = html;
                    var newNode = tmp.firstElementChild;
                    if (!newNode) return false;
                    var oldStats = card.querySelector('.post-stats-text');
                    var newStats = newNode.querySelector('.post-stats-text');
                    if (oldStats && newStats) oldStats.innerHTML = newStats.innerHTML;
                    var oldComments = card.querySelector('.comments');
                    var newComments = newNode.querySelector('.comments');
                    if (oldComments && newComments) {
                        oldComments.replaceWith(newComments);
                    } else if (oldComments) {
                        oldComments.remove();
                    } else if (newComments) {
                        var actions = card.querySelector('.actions');
                        if (actions && actions.parentNode) actions.parentNode.insertBefore(newComments, actions.nextSibling);
                        else card.appendChild(newComments);
                    }
                    try { if (typeof updateFeedStats === 'function') updateFeedStats(); } catch (_) {}
                    return true;
                } catch (ePatch) {
                    console.warn('[feed] patchSinglePostCard failed, fallback to full render', ePatch);
                    return false;
                }
            }
            window.__xtjPatchSinglePostCard = patchSinglePostCard;

            // 评论变更后的统一入口：优先局部更新，失败则回退全量刷新。
            //   ★ 节流：Realtime 在批量导入/连续灌评论时会密集触发，逐条全量重建会把
            //   主线程打满。这里按 postId 合并 120ms 内的多次变更，只重绘一次；
            //   超出节流窗口的稳定变更仍会立即生效（首条不延迟）。
            var _pendingCardPatchTimers = {};
            function schedulePostCardPatch(postId) {
                var key = String(postId == null ? '' : postId);
                if (!key) return;
                var pending = _pendingCardPatchTimers[key];
                if (pending) { pending.dirty = true; return; }
                var owner = currentUser;
                var epoch = typeof _authStateEpoch === 'number' ? _authStateEpoch : 0;
                var run = function() {
                    if (owner !== currentUser || epoch !== (typeof _authStateEpoch === 'number' ? _authStateEpoch : 0)) return;
                    if (window.__xtjMergePostDetailComments) window.__xtjMergePostDetailComments(postId, feedAllComments || []);
                    var feed = document.getElementById('feed');
                    // Off-screen posts do not require a rebuild of every visible card.
                    if (!feed || !feed.querySelector(safePostSelector(postId))) return;
                    var ok = patchSinglePostCard(postId);
                    if (!ok && typeof renderFeedFromMemoryState === 'function') {
                        renderFeedFromMemoryState().catch(function() {});
                    }
                };
                pending = { dirty: false, timer: null };
                _pendingCardPatchTimers[key] = pending;
                run();
                pending.timer = setTimeout(function() {
                    if (_pendingCardPatchTimers[key] !== pending) return;
                    delete _pendingCardPatchTimers[key];
                    if (pending.dirty) run();
                }, 120);
            }
            window.__xtjSchedulePostCardPatch = schedulePostCardPatch;

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
                feedLoadMoreFailed = false;
                var errEl = document.getElementById('feedLoadMoreError');
                if (errEl && errEl.parentNode) errEl.parentNode.removeChild(errEl);
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
                feedLoadMoreFailed = false;
                try {
                    var clearErr = document.getElementById('feedLoadMoreError');
                    if (clearErr && clearErr.parentNode) clearErr.parentNode.removeChild(clearErr);
                } catch (_eClr) {}
                var panel = document.getElementById("postFilterPanel");
                if (panel) panel.style.display = "none";
                var btn = document.getElementById("filterToggleBtn");
                if (btn) { btn.classList.remove("active"); btn.setAttribute("aria-expanded", "false"); }
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
                    if (btn) { btn.classList.add("active"); btn.setAttribute("aria-expanded", "true"); }
                    // ★ 2026-09-26（审计 P2-3）：原实现每次展开都 forceRefresh=true，
                    //   用户反复开合筛选面板就会反复打后端拉全量用户列表（并且
                    //   renderPostFilterUsers 内还会逐用户读头像缓存）。这里改为
                    //   仅在缓存超过 TTL（3 分钟）或从未加载时才强制刷新。
                    var _pfAge = Date.now() - (window.__xtjPostFilterUsersLoadedAt || 0);
                    var _pfNeedForce = !window.__xtjPostFilterUsersLoadedAt || _pfAge > 3 * 60 * 1000;
                    loadPostFilterUsers(_pfNeedForce);
                    renderPostFilterUsers();
                } else {
                    panel.style.display = "none";
                    if (btn) { btn.classList.remove("active"); btn.setAttribute("aria-expanded", "false"); }
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

            function getFeedResumeCursor(posts) {
                var last = null;
                (posts || []).forEach(function(post) {
                    if (!post || !post.created_at || !post.id || !Number.isFinite(Date.parse(post.created_at))) return;
                    if (!last || Date.parse(post.created_at) < Date.parse(last.created_at) ||
                        (Date.parse(post.created_at) === Date.parse(last.created_at) && String(post.id) < String(last.id))) last = post;
                });
                return last ? { created_at: last.created_at, id: String(last.id) } : null;
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
                        version: 8,
                        data: {
                            posts: cachePosts,
                            comments: cacheComments,
                            likes: cacheLikes,
                            pages: cachePosts.length ? [{
                                offset: 0,
                                postIds: cachePosts.map(function(post) { return String(post.id); })
                            }] : [],
                            nextOffset: firstPage && firstPage.nextOffset > 0 ? firstPage.nextOffset : cachePosts.length,
                            nextCursor: firstPage && firstPage.nextCursor ? firstPage.nextCursor : getFeedResumeCursor(cachePosts),
                            cursorScope: 'first-page',
                            endReached: !!feedEndReached && cachePosts.length === (feedAllPosts || []).length,
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
                    version: parsed.version || 8, // v8 snapshots retain complete media lists
                    timestamp: parsed.timestamp || 0,
                    data: {
                        posts: posts,
                        comments: Array.isArray(data.comments) ? data.comments : [],
                        likes: Array.isArray(data.likes) ? data.likes : [],
                        pages: pages,
                        nextOffset: typeof data.nextOffset === "number" ? data.nextOffset : posts.length,
                        // Older v7 caches stored a later page's cursor alongside only the first page.
                        nextCursor: data.cursorScope !== 'first-page' ? getFeedResumeCursor(posts) : data.nextCursor && typeof data.nextCursor.created_at === 'string' && data.nextCursor.id
                            ? { created_at: data.nextCursor.created_at, id: String(data.nextCursor.id) }
                            : null,
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
                feedNextCursor = normalized.data.nextCursor || null;
                feedEndReached = !!normalized.data.endReached;
                return true;
            }

            // 统一：应用所有需要从普通帖子流中排除的系统标记
            // 集中维护，避免漏掉 __pro_gift__ / __pro_gift_claim__ / __vip_plan__ 等
            function applyVisiblePostQueryFilters(query) {
                if (!query || typeof query.neq !== 'function') return query;
                query = query
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
                // 回退查询显式加可见性 fortify：公开帖 + 本人私密帖（不单依赖 RLS）
                try {
                    var me = String(window.currentUser || '').trim();
                    if (typeof query.or === 'function') {
                        if (me) {
                            var safeMe = me.replace(/[,.()]/g, '');
                            query = query.or('visibility.is.null,visibility.eq.public,and(visibility.eq.private,user_name.eq.' + safeMe + ')');
                        } else {
                            query = query.or('visibility.is.null,visibility.eq.public');
                        }
                    }
                } catch (_visErr) {}
                return query;
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
                // ★ 修复：记录服务端返回的"下一页起始绝对偏移"（已含页宽），
                // 仅 API/early 路径设置；start 保持为本次请求的起始偏移，不再被改写。
                var serverNextOffset = null;
                var serverNextCursor = null;
                var requestCursor = start > 0 ? feedNextCursor : null;
                var FEED_NET_TIMEOUT_MS = 18000;
                var withTimeout = (typeof window.xtjWithTimeout === 'function')
                    ? window.xtjWithTimeout
                    : function(p) { return p; };

                // 优先使用后端 API（支持私密帖子可见性过滤）
                // 公开首屏：裸 fetch + 硬超时，避免登录态 refresh / optionalAuth 路径拖死 skeleton
                try {
                    // 复用 early-feed.js 已发起的首屏请求，避免重复等待
                    var knownUser = '';
                    try {
                        knownUser = String((typeof currentUser === 'string' ? currentUser : '') || (window.safeStorage && window.safeStorage.get('xtj_user')) || '').trim();
                    } catch (eUser) { knownUser = ''; }
                    var hasToken = false;
                    try { hasToken = !!(typeof getUserToken === 'function' && getUserToken()); } catch (eTok) { hasToken = false; }
                    var mayReuseAnonymousEarlyFeed = !knownUser && !hasToken;

                    if (page === 0 && mayReuseAnonymousEarlyFeed && start === 0 && !usedApi && window.__xtjEarlyFeed && window.__xtjEarlyFeed.status === 'ok' && window.__xtjEarlyFeed.data) {
                        var early = window.__xtjEarlyFeed.data;
                        posts = normalizePosts(early.posts || []);
                        comments = early.comments || [];
                        likes = early.likes || [];
                        endReached = early.endReached || false;
                        if (typeof early.total_post_count === 'number') window._xtjTotalPostCount = early.total_post_count;
                        serverNextOffset = early.next_offset != null ? Number(early.next_offset) : null;
                        serverNextCursor = early.next_cursor || null;
                        usedApi = true;
                    } else if (page === 0 && mayReuseAnonymousEarlyFeed && start === 0 && !usedApi && window.__xtjEarlyFeedPromise) {
                        try {
                            var early2 = await (typeof window.xtjWithTimeout === 'function'
                                ? window.xtjWithTimeout(window.__xtjEarlyFeedPromise, Math.min(FEED_NET_TIMEOUT_MS, 12000), 'early-feed')
                                : window.__xtjEarlyFeedPromise);
                            if (early2 && early2.ok) {
                                posts = normalizePosts(early2.posts || []);
                                comments = early2.comments || [];
                                likes = early2.likes || [];
                                endReached = early2.endReached || false;
                                if (typeof early2.total_post_count === 'number') window._xtjTotalPostCount = early2.total_post_count;
                                serverNextOffset = early2.next_offset != null ? Number(early2.next_offset) : null;
                                serverNextCursor = early2.next_cursor || null;
                                usedApi = true;
                            }
                        } catch (earlyErr) {
                            console.warn('[feed] early-feed unavailable:', earlyErr && earlyErr.message);
                        }
                    }
                    var feedPath = '/api/feed?page=' + page + '&limit=' + FEED_PAGE_SIZE;
                    if (requestCursor && requestCursor.created_at && requestCursor.id) {
                        feedPath += '&cursor_created_at=' + encodeURIComponent(requestCursor.created_at) +
                            '&cursor_id=' + encodeURIComponent(requestCursor.id) + '&offset=' + start;
                    }
                    var apiResp = null;
                    if (!usedApi) {
                    if (!knownUser && !hasToken) {
                        var feedUrl = (window.API_BASE || (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || window.location.origin || '').replace(/\/$/, '') + feedPath;
                        var doFetch = (typeof window.xtjFetch === 'function') ? window.xtjFetch : fetch;
                        apiResp = await doFetch(feedUrl, { method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json' } }, FEED_NET_TIMEOUT_MS);
                    } else if (typeof window.xtjOptionalAuthFetch === 'function') {
                        apiResp = await window.xtjOptionalAuthFetch(feedPath, { timeoutMs: FEED_NET_TIMEOUT_MS });
                    } else {
                        var feedUrl2 = (window.API_BASE || window.location.origin || '').replace(/\/$/, '') + feedPath;
                        var doFetch2 = (typeof window.xtjFetch === 'function') ? window.xtjFetch : fetch;
                        apiResp = await doFetch2(feedUrl2, { method: 'GET', credentials: 'include' }, FEED_NET_TIMEOUT_MS);
                    }

                    if (apiResp && apiResp.ok) {
                        var apiData = await apiResp.json();
                        if (apiData && apiData.ok) {
                            posts = normalizePosts(apiData.posts || []);
                            comments = apiData.comments || [];
                            likes = apiData.likes || [];
                            endReached = apiData.endReached || false;
                            if (typeof apiData.total_post_count === 'number') window._xtjTotalPostCount = apiData.total_post_count;
                            // 使用服务器返回的 next_offset，不自行计算、不再叠加 posts.length
                            serverNextOffset = apiData.next_offset != null ? Number(apiData.next_offset) : null;
                            serverNextCursor = apiData.next_cursor || null;
                            usedApi = true;
                        }
                    }
                    }
                } catch (apiErr) {
                    console.warn('[feed] API unavailable, fallback to Supabase:', apiErr && apiErr.message);
                }

                if (!usedApi) {
                    // 回退：Supabase 直连（RLS 仅返回公开帖子）
                    // VPN 下 supabase.co 也可能半开连接，必须有硬超时，否则永久转圈
                    var end = start + FEED_PAGE_SIZE - 1;
                    var fallbackQuery = getFeedBasePostQuery();
                    if (requestCursor && requestCursor.created_at && requestCursor.id) {
                        fallbackQuery = fallbackQuery
                            .or('created_at.lt.' + requestCursor.created_at + ',and(created_at.eq.' + requestCursor.created_at + ',id.lt.' + requestCursor.id + ')')
                            .order('id', { ascending: false })
                            .limit(FEED_PAGE_SIZE);
                    } else {
                        fallbackQuery = fallbackQuery.range(start, end);
                    }
                    var postRes = await withTimeout(
                        fallbackQuery,
                        FEED_NET_TIMEOUT_MS,
                        'feed-supabase'
                    );
                    if (requestId && requestId !== feedLoadRequestId) return null;
                    if (postRes.error) throw postRes.error;
                    var fallbackPosts = postRes.data || [];
                    if (fallbackPosts.some(function(post) { return post.media_type === 'album'; })) {
                        // Direct post rows have only a cover. Hydrate the visible
                        // page in one server-authorized request before normalizing.
                        var mediaResponse = await window.xtjOptionalAuthFetch('/api/post/media/batch', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ post_ids: fallbackPosts.map(function(post) { return post.id; }) }),
                            timeoutMs: FEED_NET_TIMEOUT_MS
                        });
                        if (!mediaResponse || !mediaResponse.ok) throw new Error('帖子图片加载失败，请重试');
                        var mediaData = await mediaResponse.json();
                        if (!mediaData.ok || !Array.isArray(mediaData.posts) || mediaData.posts.some(function(post) { return !post || !Array.isArray(post.media_items); })) throw new Error('帖子图片加载失败，请重试');
                        var visibleMedia = new Map(mediaData.posts.map(function(post) { return [String(post.id), post.media_items]; }));
                        fallbackPosts = fallbackPosts.filter(function(post) { return visibleMedia.has(String(post.id)); }).map(function(post) {
                            return Object.assign({}, post, { media_items: visibleMedia.get(String(post.id)) });
                        });
                    }
                    posts = normalizePosts(fallbackPosts);
                    endReached = posts.length < FEED_PAGE_SIZE;
                    if (posts.length) {
                        var fallbackLastPost = posts[posts.length - 1];
                        serverNextCursor = fallbackLastPost && fallbackLastPost.created_at && fallbackLastPost.id
                            ? { created_at: fallbackLastPost.created_at, id: String(fallbackLastPost.id) }
                            : null;
                    }
                    try {
                        var countRes = await withTimeout(
                            applyVisiblePostQueryFilters(sb.from('posts').select('id', { count: 'exact', head: true })),
                            Math.min(FEED_NET_TIMEOUT_MS, 8000),
                            'feed-count'
                        );
                        if (countRes.count !== null) window._xtjTotalPostCount = countRes.count;
                    } catch(e) {}
                }

                // ★ 修复：计算下一次请求的起始偏移。
                // 服务端 next_offset 已是"下一页起始绝对偏移"，直接作为下一次请求起点；
                // 为 null/0/不大于当前起点（无前进）时视为已到末尾，停止加载，避免死循环/丢页。
                var computedNextOffset;
                if (usedApi && typeof serverNextOffset === 'number' && serverNextOffset > start) {
                    computedNextOffset = serverNextOffset;
                } else if (usedApi) {
                    endReached = true;
                    computedNextOffset = null;
                } else {
                    // Supabase 回退：无服务端游标，按实际拉取条数推进
                    computedNextOffset = start + posts.length;
                    if (!posts.length) endReached = true;
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
                            nextOffset: computedNextOffset,
                            nextCursor: serverNextCursor,
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
                    nextOffset: computedNextOffset,
                    nextCursor: serverNextCursor,
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
                        nextCursor: chunk.nextCursor,
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
                        postIds: pagePostIds,
                        nextOffset: chunk.nextOffset,
                        nextCursor: chunk.nextCursor || null
                    }]).sort(function(a, b) { return a.offset - b.offset; });
                }
                // ★ 修复：nextOffset 为 null/0/缺失时视为已到末尾，禁止退化为 0 无限重拉 page0
                if (chunk.nextOffset == null || chunk.nextOffset <= 0) {
                    feedEndReached = true;
                } else {
                    feedNextOffset = Math.max(feedNextOffset || 0, chunk.nextOffset);
                }
                feedNextCursor = chunk.nextCursor || null;
                if (chunk.endReached) feedEndReached = true;
                (chunk.posts || []).forEach(syncPostInfoCache);
                markFeedStateChanged();
            }

            function hasActiveFeedFilters() {
                var state = getPostSearchState();
                return !!(state.keyword || state.user || state.startDate || state.endDate || state.onlyMine || (state.visibility && state.visibility !== "all"));
            }

            // ★ 修复：单轮最多拉 3 页 + 2s 节流，避免筛选开启且匹配不足时哨兵
            // 反复进视口触发整批重拉，撞 /api/feed 限流。
            var FEED_COVERAGE_MAX_PAGES_PER_RUN = 3;
            var FEED_COVERAGE_THROTTLE_MS = 2000;
            var _feedCoverageLastFetchAt = 0;

            async function ensureFeedCoverageForVisibleSlice(minVisiblePosts, requestId) {
                var target = Math.max(Number(minVisiblePosts) || 0, FEED_PAGE_SIZE);
                var filteredPosts = getFilteredPosts(feedAllPosts || [], feedAllComments || []);
                if (filteredPosts.length >= target) return true;
                var now = Date.now();
                if (_feedCoverageLastFetchAt && now - _feedCoverageLastFetchAt < FEED_COVERAGE_THROTTLE_MS) return true;
                var guard = 0;
                while (!feedEndReached && guard < FEED_COVERAGE_MAX_PAGES_PER_RUN) {
                    filteredPosts = getFilteredPosts(feedAllPosts || [], feedAllComments || []);
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
                _feedCoverageLastFetchAt = Date.now();
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
                    return Object.assign({}, post, normalized, { media_items: Array.isArray(serverPost.media_items) || Array.isArray(serverPost.attachments) || normalized.media_url !== post.media_url ? normalized.media_items : post.media_items });
                }));
                if (!exists) {
                    feedAllPosts = sortPosts([normalized].concat(feedAllPosts || []));
                }
                writeFeedCacheSnapshot();
                await rebuildFeedFromCurrentState();
                return true;
            };

            // ★ 2026-09-27 修复（审计 P7：refreshPostDetailIfActive 是死代码）：
            //   根因：该函数依赖 activePostId，但全仓 grep 确认 activePostId 仅在
            //   01 声明、04 的 resetCommentModalState 里被置 null，**从未被赋具体帖子 id**，
            //   于是 `String(activePostId) !== postId` 恒真 → 函数体永不执行 →
            //   置顶后详情弹窗不刷新。
            //   修法（打通数据流）：详情弹窗的打开/渲染逻辑在 06（openPostDetail/renderPostDetail），
            //   本文件不可改 06。因此在这里提供标准 hook，并在本文件内把 openPostDetail
            //   包一层以自动记录当前详情帖 id：
            //     · window.__xtjSetActivePostId(id|null)：给 06 或任何调用方显式设置/清空；
            //     · 由于 04 先于 06 执行，window.openPostDetail 此刻尚未定义，包装推迟到
            //       setTimeout(0)（此时整份 bundle 的 7 个 IIFE 已同步执行完毕，06 已就绪）。
            //   打开详情 → 记录 id；关闭详情弹窗（closeModal('postDetailModal')）→ 清空。
            //   ⚠ 不修改 06 的任何逻辑，仅在其对外入口上做无侵入包装（保留原函数返回值/this）。
            window.__xtjSetActivePostId = function(id) {
                activePostId = (id == null || id === '') ? null : String(id);
                return activePostId;
            };
            window.__xtjGetActivePostId = function() { return activePostId; };
            var _xtjOpenPostDetailWrapped = false;
            function installPostDetailActiveTracker() {
                if (_xtjOpenPostDetailWrapped) return;
                if (typeof window.openPostDetail !== 'function') return;
                var _origOpenPostDetail = window.openPostDetail;
                window.openPostDetail = function(postId) {
                    // 记录当前正在查看的详情帖，供置顶/编辑后的局部刷新判断
                    try { window.__xtjSetActivePostId(postId); } catch (_) {}
                    return _origOpenPostDetail.apply(this, arguments);
                };
                _xtjOpenPostDetailWrapped = true;
            }
            // 06 在本 bundle 之后同步注册，故用宏任务兜底安装（幂等）。
            setTimeout(installPostDetailActiveTracker, 0);
            // ★ 2026-09-27（P7）：关闭详情弹窗的清空钩子已直接内联进
            //   window.closeModal（见上方 `id === 'postDetailModal'` 分支），
            //   此处不再对外层做包装，避免「包装先后顺序」的隐式依赖。

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
                var selector = safePostSelector(postId);
                var postEl = selector ? document.querySelector(selector) : null;
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
            var postPinFlight = null;
            window.isPinningPost = false;
            window.togglePostPin = async function(postId, btn) {
                if (!postId) return;
                var normalizedPostId = String(postId || '').trim().toLowerCase();
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalizedPostId)) {
                    showToast('置顶失败：帖子参数无效');
                    return;
                }
                
                if (postPinFlight && !postActionIdentityCurrent(postPinFlight)) { postPinFlight = null; window.isPinningPost = false; }
                if (window.isPinningPost) return;
                window.isPinningPost = true;
                var identity = capturePostActionIdentity();
                postPinFlight = identity;
                
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
                    assertPostActionIdentity(identity);
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
                        method: 'POST', authOwner: identity.owner, authEpoch: identity.epoch,
                        body: JSON.stringify({ post_id: normalizedPostId, is_pinned: Boolean(nextPinned) })
                    });
                    var result = await response.json().catch(function() { return {}; });
                    assertPostActionIdentity(identity);
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
                    
                    var postEl = findBySafePostSelector(normalizedPostId);
                    var willAnimatePin = nextPinned;
                    if (willAnimatePin) await beginPinnedPostTransition(postEl);
                    assertPostActionIdentity(identity);

                    if (!syncPinnedPostIntoFeedState(result.data)) {
                        clearFeedCache();
                        await loadFeed(true);
                    } else {
                        writeFeedCacheSnapshot();
                        await rebuildFeedFromCurrentState();
                    }
                    assertPostActionIdentity(identity);
                    await refreshPostDetailIfActive(normalizedPostId);
                    if (willAnimatePin) await completePinnedPostTransition(normalizedPostId);
                    assertPostActionIdentity(identity);
                    didSucceed = true;
                    showToast(nextPinned ? '帖子已置顶' : '已取消置顶');
                } catch (e) {
                    if (!postActionIdentityCurrent(identity)) return;
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
                    if (postPinFlight !== identity) return;
                    postPinFlight = null;
                    window.isPinningPost = false;
                    if (!postActionIdentityCurrent(identity)) return;
                    var postEl = findBySafePostSelector(normalizedPostId);
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
                }
            };

            // G10 修复：可见性切换并发锁（与 togglePostPin 的 isPinningPost 对齐），
            // 防止双击基于同一旧 visibility 发两次更新 + 两次整页刷新
            var postVisibilityFlight = null;
            window.isTogglingPostVisibility = false;
            window.togglePostVisibility = async function(postId, btn) {
                if (postVisibilityFlight && !postActionIdentityCurrent(postVisibilityFlight)) { postVisibilityFlight = null; window.isTogglingPostVisibility = false; }
                if (window.isTogglingPostVisibility) return;
                var identity = capturePostActionIdentity();
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
                    postVisibilityFlight = identity;
                    nextVisibility = post.visibility === "private" ? "public" : "private";
                    var result = await updatePostRecord(post, {
                        visibility: nextVisibility
                    });
                    assertPostActionIdentity(identity);
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
                    if (!postActionIdentityCurrent(identity)) return;
                    handled = true;
                    console.error("togglePostVisibility error:", e);
                    // ★ 修复：按失败方向复位按钮（此前无条件写"设为私密"，私密帖点"设为公开"失败时标签相反）
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = nextVisibility === "private" ? "🔒 设为私密" : "🌐 设为公开";
                    }
                    showToast("操作异常: " + (e && e.message ? e.message : "未知错误，请查看控制台"));
                } finally {
                    if (postVisibilityFlight && postVisibilityFlight !== identity) return;
                    postVisibilityFlight = null;
                    window.isTogglingPostVisibility = false;
                    if (!postActionIdentityCurrent(identity)) return;
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
            var feedDetailGesture = null, suppressFeedDetailUntil = 0;
            document.addEventListener('pointerdown', function(e) {
                var card = e.target.closest && e.target.closest('#feed > .post-feed-item');
                feedDetailGesture = card && e.pointerType === 'touch' ? {id:e.pointerId,x:e.clientX,y:e.clientY} : null;
            }, {passive:true});
            document.addEventListener('pointermove', function(e) {
                if (feedDetailGesture && feedDetailGesture.id === e.pointerId && Math.hypot(e.clientX-feedDetailGesture.x,e.clientY-feedDetailGesture.y)>10) suppressFeedDetailUntil=Date.now()+400;
            }, {passive:true});
            document.addEventListener('pointercancel', function() { if(feedDetailGesture)suppressFeedDetailUntil=Date.now()+400;feedDetailGesture=null; }, {passive:true});
            document.addEventListener('click', function(e) {
                var card = e.target.closest && e.target.closest('#feed > .post-feed-item');
                if (!card || Date.now()<suppressFeedDetailUntil || e.defaultPrevented || e.target.closest('button,a,input,textarea,select,video,audio,img,.actions,.comments,.inline-comment-box,.avatar,.avatar-wrap,.post-badge-stack')) return;
                if (window.getSelection && String(window.getSelection()).trim()) return;
                var post = (feedAllPosts || []).find(function(p) { return String(p.id) === card.getAttribute('data-post-id'); });
                if (canOpenFeedPostDetail(post)) window.openPostDetail(post.id);
            });
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') closePostToolsMenu();
            });
            // ── 帖子位置功能 ──
            var postLocationData = null;
            var postLocationRequesting = false;

            function restorePostLocationButton(btn) {
                if(btn)btn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><span class="compose-tool-label">定位</span>';
            }
            window.requestPostLocation = function() {
                if (postLocationRequesting) return;
                var btn = document.getElementById('postLocationAddBtn');
                if (!btn) return;
                if (!navigator.geolocation) {
                    showToast('您的浏览器不支持定位功能');
                    return;
                }
                var locationOwner=window.currentUser;
                postLocationRequesting = true;
                btn.disabled = true;
                btn.textContent = '正在获取位置...';
                function requestPostLocationFix(options, onError) {
                    navigator.geolocation.getCurrentPosition(function(position) {
                        if(locationOwner!==window.currentUser){postLocationRequesting=false;btn.disabled=false;restorePostLocationButton(btn);return;}
                        reverseGeocodePostLocation(position.coords.latitude, position.coords.longitude, position.coords.accuracy, new Date(position.timestamp || Date.now()).toISOString(), locationOwner);
                    }, onError, options);
                }
                function finishLocationRequest(error) {
                    postLocationRequesting = false;
                    btn.disabled = false;
                    restorePostLocationButton(btn);
                    showToast(error && error.code === 1 ? '位置权限被拒绝，请在浏览器设置中允许定位' : '定位失败，请重试');
                }
                requestPostLocationFix({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }, function(error) {
                    if (error && error.code !== 1) {
                        // A timeout or unavailable GPS fix gets one bounded fallback request.
                        btn.textContent = '正在尝试备用定位...';
                        requestPostLocationFix({ enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }, function(fallbackError) {
                            postLocationRequesting = false;
                            btn.disabled = false;
                            restorePostLocationButton(btn);
                            showToast('定位失败，请重试');
                        });
                        return;
                    }
                    finishLocationRequest(error);
                    return;
                });
            };

            async function reverseGeocodePostLocation(lat, lng, accuracy, capturedAt, owner) {
                var btn = document.getElementById('postLocationAddBtn');
                try {
                    if(owner!==window.currentUser) return;
                    var resp = await window.xtjProtectedFetch('/api/location/reverse', {
                        method: 'POST',
                        body: JSON.stringify({ latitude: lat, longitude: lng, accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null, captured_at: capturedAt, capture_id: "post_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2) })
                    });
                    if(owner!==window.currentUser) return;
                    var data = await resp.json().catch(function() { return {}; });
                    if (!resp.ok || !data.ok) {
                        showToast('地址解析失败: ' + (data.error || '请重试'));
                        postLocationRequesting = false;
                        if (btn) { btn.disabled = false; restorePostLocationButton(btn); }
                        return;
                    }
                    data.accuracy = Number(accuracy) || null;
                    showPostLocationOptions(data);
                } catch (e) {
                    if(owner!==window.currentUser)return;
                    showToast('地址解析失败，请检查网络');
                    postLocationRequesting = false;
                    if (btn) { btn.disabled = false; restorePostLocationButton(btn); }
                } finally {postLocationRequesting=false;if(btn){btn.disabled=false;restorePostLocationButton(btn);}}
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
                if (btn) { btn.disabled = false; restorePostLocationButton(btn); }
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
                if (btn) { btn.disabled = false; restorePostLocationButton(btn); }
            }

            var postPublishFlight = null;
            var activePostUploadFlights = new Set();
            function postPublishIdentityCurrent(flight) {
                return !!flight && flight.owner === currentUser && flight.epoch === _authStateEpoch && postPublishFlight === flight;
            }
            function assertPostPublishIdentity(flight) {
                if (!postPublishIdentityCurrent(flight)) { var error = new Error('账号已切换，发布已停止'); error.code = 'identity_changed'; throw error; }
            }
            function restorePostPublishButton(flight) {
                if (flight.progress) flight.progress.cancel();
                var btn = flight.button;
                btn.disabled = false; btn.classList.remove('is-loading'); btn.setAttribute('aria-busy', 'false');
                btn.innerHTML = flight.markup || '<span>发动态</span>'; delete btn._composeMarkup; delete btn.dataset.originalText;
            }
            function pendingPostMediaKey(owner) { return 'xtj_post_media_pending_' + encodeURIComponent(owner); }
            function readPendingPostMedia(owner) {
                try { var rows = JSON.parse(window.safeStorage.get(pendingPostMediaKey(owner)) || '[]'); return Array.isArray(rows) ? rows : []; } catch (_) { return []; }
            }
            function rememberPendingPostMedia(owner, path, uploadId) {
                var rows = readPendingPostMedia(owner).filter(function(row) { return row.storage_path !== path; });
                rows.push({ storage_path: path, upload_id: uploadId });
                try { window.safeStorage.set(pendingPostMediaKey(owner), JSON.stringify(rows)); } catch (_) {}
            }
            function forgetPendingPostMedia(owner, path) {
                try { window.safeStorage.set(pendingPostMediaKey(owner), JSON.stringify(readPendingPostMedia(owner).filter(function(row) { return row.storage_path !== path; }))); } catch (_) {}
            }
            async function cleanupPendingPostMedia(identity, path, uploadId) {
                // Never use a new account to clean an old upload; the server's registry handles abandoned sessions.
                if (identity.owner !== currentUser || identity.epoch !== _authStateEpoch) return;
                try {
                    var response = await window.xtjProtectedFetch('/api/post/media/cleanup', { method: 'POST', authOwner: identity.owner, authEpoch: identity.epoch, body: JSON.stringify({ storage_path: path, upload_id: uploadId }) });
                    var result = await response.json();
                    if (identity.owner !== currentUser || identity.epoch !== _authStateEpoch) return;
                    if (response.ok && result.ok) forgetPendingPostMedia(identity.owner, path);
                } catch (error) { console.warn('[post-publish] orphan cleanup failed', error); }
            }
            document.addEventListener('visibilitychange', function() {
                if (document.hidden || !currentUser) return;
                retryPendingPostMedia();
            });
            function retryPendingPostMedia() {
                var identity = { owner: currentUser, epoch: _authStateEpoch };
                if (!identity.owner) return;
                readPendingPostMedia(identity.owner).forEach(function(row) {
                    if (Array.from(activePostUploadFlights).some(function(flight) { return flight.owner === identity.owner; })) return;
                    cleanupPendingPostMedia(identity, row.storage_path, row.upload_id);
                });
            }
            window.addEventListener('auth-ready', function() {
                if (postPublishFlight && (postPublishFlight.owner !== currentUser || postPublishFlight.epoch !== _authStateEpoch)) {
                    var old = postPublishFlight; postPublishFlight = null; restorePostPublishButton(old);
                }
                retryPendingPostMedia();
            });

            async function readPostImageDimensions(file) {
                var url = URL.createObjectURL(file);
                try {
                    return await new Promise(function(resolve) {
                        var img = new Image(), finished = false;
                        var timer = setTimeout(function() { finish({ width: null, height: null }); }, 8000);
                        function finish(value) { if (finished) return; finished = true; clearTimeout(timer); img.onload = img.onerror = null; resolve(value); }
                        img.onload = function() { finish(img.naturalWidth > 0 && img.naturalHeight > 0 && img.naturalWidth <= 20000 && img.naturalHeight <= 20000
                            ? { width: img.naturalWidth, height: img.naturalHeight } : { width: null, height: null }); };
                        img.onerror = function() { finish({ width: null, height: null }); }; img.src = url;
                    });
                } finally { URL.revokeObjectURL(url); }
            }

            window.doPublish = async function () {
                if (!currentUser) { showToast("请先登录"); return; }
                var btn = document.getElementById("pubBtn");
                if (!btn || btn.disabled || btn.getAttribute('aria-busy') === 'true') return;
                if (isUserMuted()) { showToast("您已被禁言，无法发布内容"); return; }
                // ★ 2026-09-27 修复（审计 P13-①：取 DOM 值无判空）：
                //   此前直接 `document.getElementById("postInp").value`，元素缺失时抛
                //   TypeError（整段中断）。这里改为判空后安全取值，缺失时给出提示并返回。
                var postInpEl = document.getElementById("postInp");
                var fileInpEl = document.getElementById("fileInp");
                if (!postInpEl) { showToast("发布框未就绪，请刷新后重试"); return; }
                var content = postInpEl.value.trim();
                var selectedPostMedia = window.XtjPostComposerMedia ? window.XtjPostComposerMedia.getFiles() : Array.from((fileInpEl && fileInpEl.files) || []);
                try { if (window.XtjPostMedia) window.XtjPostMedia.validateSelection(selectedPostMedia); }
                catch (selectionError) { showToast(selectionError.message); return; }
                var file = selectedPostMedia[0] || null;
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
                var flight = { owner: currentUser, epoch: _authStateEpoch, button: btn, markup: btn.innerHTML };
                postPublishFlight = flight;
                activePostUploadFlights.add(flight);
                var publishLocation = postLocationData ? Object.assign({}, postLocationData) : null;
                btn.disabled = true;
                btn.classList.add('is-loading');
                btn.setAttribute('aria-busy', 'true');
                btn.dataset.originalText = btn.textContent;btn._composeMarkup=btn.innerHTML;
                btn.innerHTML = '<span>发布中</span>';
                if (window.XtjPostPublishProgress) flight.progress = window.XtjPostPublishProgress.begin(btn, selectedPostMedia, function() { return postPublishIdentityCurrent(flight); });
                var uploadedPath = '', mediaUploadId = '', uploadedMedia = [];
                try {
                    var media_url = "";
                    var media_type = "";
                    var attachments = [];
                    if (file && window.XtjPostMedia) {
                        var uploaded = await window.XtjPostMedia.mapUploads(selectedPostMedia, async function(selectedFile, position) {
                            assertPostPublishIdentity(flight);
                            var path = buildStorageUploadPath('posts', selectedFile.name), uploadId = crypto.randomUUID();
                            var pending = { storage_path: path, upload_id: uploadId };
                            uploadedMedia.push(pending);
                            rememberPendingPostMedia(flight.owner, path, uploadId);
                            var prepareResponse = await window.xtjProtectedFetch('/api/post/media/prepare', { method: 'POST', authOwner: flight.owner, authEpoch: flight.epoch, body: JSON.stringify(pending) });
                            var prepared = await prepareResponse.json();
                            assertPostPublishIdentity(flight);
                            if (!prepareResponse.ok || !prepared.ok || prepared.storage_path !== path) throw new Error(prepared.error || '上传准备失败');
                            var uploadRes = flight.progress ? await flight.progress.upload(sb, path, selectedFile, position) : await sb.storage.from('uploads').upload(path, selectedFile, { upsert: false });
                            assertPostPublishIdentity(flight);
                            if (uploadRes.error) throw uploadRes.error;
                            var dimensions = selectedFile.type.startsWith('image/') ? await readPostImageDimensions(selectedFile) : {};
                            assertPostPublishIdentity(flight);
                            return Object.assign({}, pending, dimensions, { position: position, media_type: selectedFile.type.split('/')[0],
                                media_url: sb.storage.from('uploads').getPublicUrl(path).data.publicUrl, file_size: selectedFile.size });
                        }, 3);
                        media_url = uploaded[0].media_url;
                        media_type = uploaded.length > 1 ? 'album' : uploaded[0].media_type;
                        if (media_type === 'album' || media_type === 'image') attachments = uploaded;
                        else { uploadedPath = uploaded[0].storage_path; mediaUploadId = uploaded[0].upload_id; }
                    } else if (file) {
                        throw new Error('附件模块未加载，请刷新后重试');
                    }
                    var plainText = content.slice(0, 2000);
                    var metadata = collectPostMetadata ? collectPostMetadata(visibility, { location: publishLocation }) : { visibility: visibility || "public" };
                    var contentPayload = buildPostContentPayload(plainText, metadata);
                    var payload = {
                        user_name: flight.owner,
                        content: contentPayload,
                        media_url: media_url,
                        media_type: media_type || null,
                        actor_key: deviceId,
                        visibility: metadata.visibility,
                        is_pinned: false,
                        pinned_at: null,
                        updated_at: null,
                        location: publishLocation,
                        media_upload_id: mediaUploadId || null,
                        media_storage_path: uploadedPath || null,
                        attachments: attachments.length ? attachments : null
                    };
                    assertPostPublishIdentity(flight);
                    if (flight.progress) flight.progress.saving();
                    var insertRes = await insertPostRecord(payload, contentPayload, flight);
                    assertPostPublishIdentity(flight);
                    if (!insertRes.ok) {
                        await Promise.all(uploadedMedia.map(function(item) { return cleanupPendingPostMedia(flight, item.storage_path, item.upload_id); }));
                        assertPostPublishIdentity(flight);
                        showToast("发布失败: " + ((insertRes.error && insertRes.error.message) || "未知错误"));
                        return;
                    }
                    uploadedMedia.forEach(function(item) { forgetPendingPostMedia(flight.owner, item.storage_path); });
                    if (flight.progress) flight.progress.confirmed();
                    uploadedMedia = [];
                    uploadedPath = '';
                    assertPostPublishIdentity(flight);
                    touchUserSession(false);
                    var publishMotion = window.XtjPostPublishMotion && window.XtjPostPublishMotion.capture(selectedPostMedia, plainText, function() { return currentUser === flight.owner && _authStateEpoch === flight.epoch; });
                    resetPostComposer();
                    // ★ 2026-09-27 修复（审计 P13-②：失败仍 resetPostPreview 导致
                    //   "显示 0 个文件但文件还在"）：把预览清理移到**发布成功之后**。
                    //   成功时 resetPostComposer 已清空 fileInp，这里同步回收预览界面与 blob URL；
                    //   失败时（下方 catch/insertRes.!ok 分支）保留预览，用户可直接改文案重试，
                    //   不必重新选文件。重新选择文件时 setPostPreview 会先 revoke 旧 blob，无泄漏。
                    if (typeof window.resetPostPreview === "function") window.resetPostPreview();
                    showToast(insertRes.fallback ? "发布成功，已兼容旧数据结构" : "发布成功");
                    if (!insertPublishedPostIntoFeed(insertRes.data, !!publishMotion)) {
                        clearFeedCache();
                        await loadFeed(true);
                        assertPostPublishIdentity(flight);
                    } else {
                        writeFeedCacheSnapshot();
                    }
                    if (publishMotion) window.XtjPostPublishMotion.play(publishMotion, findBySafePostSelector(insertRes.data && insertRes.data.id));
                    if (insertRes.data && insertRes.data.id) {
                        schedulePublishedPostIpRefresh(insertRes.data.id);
                    }
                    loadProfileActivity(true).catch(function() {});
                } catch (e) {
                    await Promise.all(uploadedMedia.map(function(item) { return cleanupPendingPostMedia(flight, item.storage_path, item.upload_id); }));
                    if (postPublishIdentityCurrent(flight)) showToast("发布失败: " + (e.message || "网络错误"));
                } finally {
                    activePostUploadFlights.delete(flight);
                    if (!postPublishIdentityCurrent(flight) && currentUser === flight.owner) retryPendingPostMedia();
                    if (postPublishFlight === flight) {
                        postPublishFlight = null;
                        restorePostPublishButton(flight);
                    }
                }
            };

            loadFeed = async function(forceRefresh) {
                // ★ 修复：loadFeed 语义为"重新加载 feed"——所有路径（缓存快路径/
                //   成功刷新/失败回退）都重置旧式 feedPage 计数器。此前刷新后
                //   feedPage 残留旧值，加载更多按旧页码计算导致误判 feedEndReached，
                //   无限滚动永久失效（"没有更多帖子"）直至刷新页面。
                feedPage = 1;
                // 重置"加载更多失败"标志，避免 feed 重绘后哨兵永久不再触发
                feedLoadMoreFailed = false;
                try {
                    var moreErr = document.getElementById('feedLoadMoreError');
                    if (moreErr && moreErr.parentNode) moreErr.parentNode.removeChild(moreErr);
                } catch (_eMore) {}
                var now = Date.now();
                var requestId = ++feedLoadRequestId;
                var stateVersionAtRequest = feedStateVersion;
                var hadLiveFeed = Array.isArray(feedAllPosts) && feedAllPosts.length > 0;
                if (forceRefresh) {
                    // Keep the rendered feed intact until a replacement page succeeds.
                    // A transient empty response must not turn a populated page into an empty one.
                    feedPageFetchPending = false;
                    // ★ 修复：强制刷新时 early-feed 快照已过期（发帖/删除/置顶后仍复用旧快照
                    // 会拿到旧数据），标记过期并清空，强制走真实 API 重新请求。
                    try {
                        if (window.__xtjEarlyFeed) {
                            window.__xtjEarlyFeed.status = 'stale';
                            window.__xtjEarlyFeed.data = null;
                        }
                        window.__xtjEarlyFeedPromise = null;
                    } catch (_ef) {}
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
                    // ★ 修复：early-feed 已画出的帖子不再被骨架覆盖（此前无差别 innerHTML=
                    // 骨架造成"帖子→骨架→完整列表"首屏闪动）；仅当 feed 尚无内容时才写骨架。
                    if (!feed.querySelector('.post')) {
                        feed.innerHTML = getXtjLoadingHtml('内容加载中..', '', 'feed');
                    }
                }
                try {
                    feedPageFetchPending = true;
                    var chunk = await fetchFeedPageChunk(0, requestId, true);
                    if (!chunk || requestId !== feedLoadRequestId) {
                        // 竞态取消时不要把 HTML skeleton 永久留住
                        if (feed && !hadLiveFeed) {
                            var stillSkeleton = /xtj-loading-skeleton|xtj-skeleton-card|xtj-sk-pack|内容加载中/.test(feed.innerHTML || '');
                            if (stillSkeleton && requestId === feedLoadRequestId) {
                                feed.innerHTML = '<div class="loading feed-load-more-error" id="feedBootError" role="button" tabindex="0" style="color:#ff3b60;cursor:pointer;">加载中断，点击重试</div>';
                                var bootErr = document.getElementById('feedBootError');
                                if (bootErr && !bootErr.__xtjBound) {
                                    bootErr.__xtjBound = true;
                                    bootErr.addEventListener('click', function() { loadFeed(true); });
                                }
                            }
                        }
                        return;
                    }
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
                        feedNextCursor = null;
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
                    window.__xtjCoreFeedReady = true;
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
                    if (requestId !== feedLoadRequestId) return;
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
                    if (requestId === feedLoadRequestId) feedPageFetchPending = false;
                }
            };
            window.loadFeed = loadFeed;

            // ★ 2026-09-27 新增（审计 P1：DOM 回收导致切片下标错位）：
            //   背景：appendMorePosts 里有 FEED_DOM_MAX_POSTS=200 的 DOM 上限，超出后会把
            //   顶部的 .post 节点 removeChild 掉，并把回收条数累加到 window._xtjFeedDomTrimmed。
            //   但该计数器**只写不读**（全仓 grep 无读取点），而 loadMoreFeedPosts 的切片起点
            //   一直是 `feed.querySelectorAll('.post').length` —— 于是每回收一批，DOM 计数就
            //   比真实位置少一批：假设内存里已有 400 条、DOM 保留最后 200 条，继续加载时
            //   startIdx 算成 200，又从第 201 条开始追加，**已展示过的帖子被重复渲染一遍**，
            //   表现为"加载更多之后又看到之前看过的内容"。
            //   ★ 另需注意：滚动到顶部时那些被回收的卡片不会再回到 DOM（这里不做反向补偿，
            //   因为内存态仍完整、且往上滚由既有逻辑重新渲染），所以无需恢复 window.scrollY。
            //   ★ 第二个错误来源：`feed.querySelectorAll('.post')` 会**同时命中**非 feed 列表
            //   里的 .post 节点（用户主页/搜索结果等），把它们算进 feed 的已渲染数造成多算。
            //   这里改用 feed 直属子节点计数，语义严格限定在信息流容器内。
            function countFeedDomPosts(feed) {
                if (!feed) return 0;
                var n = 0;
                for (var i = 0; i < feed.children.length; i++) {
                    var child = feed.children[i];
                    if (child && child.classList && child.classList.contains('post')) n++;
                }
                return n;
            }

            // 返回「当前内存过滤结果中，已被渲染到该位置」的条数（含已被 DOM 回收的部分）。
            function getFeedRenderedSliceStart() {
                var feed = document.getElementById('feed');
                var domCount = countFeedDomPosts(feed);
                var trimmed = Math.max(0, Number(window._xtjFeedDomTrimmed) || 0);
                return domCount + trimmed;
            }

            // 信息流被整段重建（renderFeedWithAvatars 全量 innerHTML / 筛选重置 / 换账号）时，
            //   是否该把回收计数清零？—— **不清零**。因为切片起点的语义是"在内存过滤结果中的
            //   位置"，全量重建后 DOM 通常又回到从头渲染的前 N 条，此时 trimmed 若不清零会多算。
            //   因此在全量重建处显式归零，保证两种口径始终一致。
            function resetFeedDomTrimmed() {
                window._xtjFeedDomTrimmed = 0;
            }

            function showFeedSearchContinueControl() {
                var feed = document.getElementById('feed');
                if (!feed || feedEndReached || !hasActiveFeedFilters() || document.getElementById('feedContinueSearch')) return;
                var button = document.createElement('button');
                button.id = 'feedContinueSearch';
                button.type = 'button';
                button.className = 'loading feed-load-more-error';
                button.textContent = '继续查找帖子';
                button.addEventListener('click', function() {
                    if (feedPageFetchPending) return;
                    button.remove();
                    _feedCoverageLastFetchAt = 0;
                    loadMoreFeedPosts();
                });
                feed.appendChild(button);
            }

            loadMoreFeedPosts = async function() {
                if (feedPageFetchPending || feedLoadMoreFailed) return;
                var feed = document.getElementById("feed");
                if (!feed) return;
                var requestId = feedLoadRequestId;
                var continueButton = document.getElementById('feedContinueSearch');
                if (continueButton) continueButton.remove();
                var pageLoading = document.createElement("div");
                pageLoading.className = "feed-page-loading";
                pageLoading.setAttribute("role", "status");
                pageLoading.setAttribute("aria-live", "polite");
                pageLoading.textContent = "正在加载更多帖子";
                var sentinel = document.getElementById("feedSentinel");
                feed.insertBefore(pageLoading, sentinel || null);
                // ★ 修复：切片起点统一以"已渲染条数"计算，不再用 feedPage（显示计数）
                // 推算。feedPage 仅作显示计数，由 applyPostFilters/clearPostFilters 重置为 1，
                // 但 feedNextOffset（服务端游标）不随之重置；若用 feedPage 推算切片，
                // 筛选开启时 filteredPosts 远小于 feedAllPosts 会提前判定"没有更多"，
                // 或 20 页后游标与切片错位导致循环不满足。是否还有更多只由 feedNextOffset/
                // feedEndReached 判定，切片长度只受当前内存过滤结果约束。
                //   现在把切片起点统一收敛到 getFeedRenderedSliceStart()：它返回
                //   「DOM 卡片数 + 被 DOM 回收掉的条数」，也就是**在当前内存过滤结果中的
                //   真实位置**，两种口径下都不再错位。
                var startIdx = getFeedRenderedSliceStart();
                var endIdx = startIdx + FEED_PAGE_SIZE;
                var filteredPosts = getFilteredPosts(feedAllPosts, feedAllComments);
                var fetchFailed = false;
                if (filteredPosts.length < endIdx && !feedEndReached) {
                    try {
                        feedPageFetchPending = true;
                        // ★ 修复：ensureFeedCoverageForVisibleSlice 内部以 feedNextOffset（服务端游标）拉取，
                        // 不再依赖 feedPage 推算 offset，避免并发发帖/删除导致 offset 漂移时帖子重复或永久跳过。
                        // 拉取成功后以当前内存过滤结果重新计算切片。
                        await ensureFeedCoverageForVisibleSlice(endIdx, requestId);
                        if (requestId === feedLoadRequestId) writeFeedCacheSnapshot();
                    } catch (e) {
                        fetchFailed = true;
                        console.error('[feed] loadMore ensure coverage failed:', e);
                    } finally {
                        if (requestId === feedLoadRequestId) feedPageFetchPending = false;
                    }
                    filteredPosts = getFilteredPosts(feedAllPosts, feedAllComments);
                }
                pageLoading.remove();
                if (requestId !== feedLoadRequestId) return;
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
                // ★ 修复：await 拉取期间 feed 可能被并发发布/刷新重建（DOM 计数与内存索引错位，
                // 导致偶发重复渲染或跳帖）；在拉取完成之后、切片之前基于最新 DOM 数量重新计算起点。
                //   现在同样走 getFeedRenderedSliceStart()，把被回收的条数补偿回去。
                startIdx = getFeedRenderedSliceStart();
                endIdx = startIdx + FEED_PAGE_SIZE;
                // ★ 修复：只有"服务端已到末尾"才置 feedEndReached 并显示"没有更多"。
                // 筛选开启时 filteredPosts 可能远小于已拉取总量（feedNextOffset 尚未到末尾），
                // 此时不能因为切片末尾超过 filteredPosts 就提前终止无限滚动——继续滚动应
                // 继续用 feedNextOffset 拉取，让更多可匹配筛选的帖子进入内存后再渲染。
                if (feedEndReached && startIdx >= filteredPosts.length) {
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
                if (startIdx < filteredPosts.length) {
                    var filteredPostIds = new Set();
                    filteredPosts.forEach(function(p) { filteredPostIds.add(String(p.id)); });
                    var scopedComments = getRenderableComments(feedAllComments, filteredPosts);
                    var scopedLikes = (feedAllLikes || []).filter(function(l) { return filteredPostIds.has(String(l.post_id)); });
                    appendMorePosts(filteredPosts.slice(startIdx, endIdx), scopedComments, scopedLikes);
                }
                if (getFeedRenderedSliceStart() >= filteredPosts.length && !feedEndReached) {
                    // A permanently visible sentinel emits no second intersection event.
                    // Keep a keyboard-accessible continuation after the bounded filter scan.
                    showFeedSearchContinueControl();
                }
                if (startIdx < filteredPosts.length) feedPage++;
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
                // ★ 2026-09-26（审计 P2-25）：改用 DocumentFragment 一次性插入。
                //   原实现 while 循环里逐节点 insertBefore —— 每个节点都触发一次 DOM
                //   插入与（潜在）布局，长列表追加时是 O(n) 次重排；Fragment 只触发一次。
                var frag = document.createDocumentFragment();
                while (tempContainer.firstChild) {
                    frag.appendChild(tempContainer.firstChild);
                }
                feed.insertBefore(frag, sentinel);
                // ★ 2026-09-26（审计 P2-25）：Feed DOM 上限。照片墙早有 MAX_DOM_PHOTOS 封顶，
                //   Feed 侧此前没有任何上限，长会话下节点数线性增长，滚动与
                //   updateFeedStats（遍历全部帖子）同步变慢。超过上限时回收顶部的旧卡片
                //   （保留内存中的 posts 状态，向上滚动时由既有加载逻辑重新渲染）。
                try {
                    var FEED_DOM_MAX_POSTS = 200;
                    var _postNodes = feed.querySelectorAll('.post');
                    if (_postNodes.length > FEED_DOM_MAX_POSTS) {
                        var _toDrop = _postNodes.length - FEED_DOM_MAX_POSTS;
                        // ★ P1：回收计数必须用 `|| 0` 兜底 + 统一走 getFeedRenderedSliceStart 读取，
                        //   否则一旦某次渲染把计数写成 NaN，所有后续切片起点都会变成 NaN。
                        var _dropped = 0;
                        for (var _di = 0; _di < _toDrop; _di++) {
                            var _node = _postNodes[_di];
                            if (_node && _node.parentNode) { _node.parentNode.removeChild(_node); _dropped++; }
                        }
                        window._xtjFeedDomTrimmed = (Number(window._xtjFeedDomTrimmed) || 0) + _dropped;
                        if (!window._xtjFeedDomTrimNoticeShown) {
                            window._xtjFeedDomTrimNoticeShown = true;
                            console.info('[feed] DOM 超过 ' + FEED_DOM_MAX_POSTS + ' 条，已回收顶部卡片以保持滚动流畅');
                        }
                    }
                } catch (eTrim) { /* DOM 回收失败不影响本次渲染 */ }
                var newPosts = feed.querySelectorAll(".post:not(.visible)");
                primePostReveal(newPosts);
                observePostViewportState(newPosts);
                updateFeedStats();
            };

            renderFeedWithAvatars = function(visiblePosts, comments, likes) {
                if (window.__xtjRunMentionCleanups) window.__xtjRunMentionCleanups();
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
                // ★ P1：整段重建后 DOM 从新渲染的前 N 条开始，与内存过滤结果的第 0..N 条对齐，
                //   此时必须把"已回收条数"归零，否则 loadMoreFeedPosts 的切片起点会多算，
                //   从中间开始追加 → 帖子重复。
                resetFeedDomTrimmed();
                initPostScrollAnimation();
            };

            renderFeed = async function(payload) {
                if (window.__xtjRunMentionCleanups) window.__xtjRunMentionCleanups();
                bindPostFilterEvents();
                var filteredPosts = getFilteredPosts(payload.posts, payload.comments);
                var visibleComments = getRenderableComments(payload.comments, filteredPosts);
                // ★ 2026-09-27 修复（审计 P4）：与 updateFeedStats 共用 resolveTotalPostCount，
                //   保证两处口径完全一致（详见该函数处注释）。
                var totalPosts = resolveTotalPostCount();
                var sPostsEl = document.getElementById("sPosts");
                if (sPostsEl) sPostsEl.textContent = totalPosts;
                var sViewsEl = document.getElementById("sViews");
                if (sViewsEl) sViewsEl.textContent = filteredPosts.reduce(function(sum, post) { return sum + (post.views || 0); }, 0);
                var visiblePostIds = new Set();
                filteredPosts.forEach(function(p) { visiblePostIds.add(String(p.id)); });
                var scopedLikes = (payload.likes || []).filter(function(l) { return visiblePostIds.has(String(l.post_id)); });
                var sLikesEl = document.getElementById("sLikes");
                // ★ 修复：首屏统计只显示点赞数，与 updateFeedStats（6624 行）口径一致，不再混入评论数
                if (sLikesEl) sLikesEl.textContent = scopedLikes.length;
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
