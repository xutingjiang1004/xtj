/**
 * core-parts/05-feed-stats.js
 * Feed render, filters, stats state (pre-chat)
 * Lines from original core.js: 8929-10043
 * DO NOT edit js/core.js directly — edit this file, then run: node scripts/assemble-core.js
 */
            // ===================== 数据统计详情功能 =====================
            // 存储统计前的基础状态
            let statCurrentType = null;
            let statAllPosts = [];
            let statAllComments = [];
            let statAllLikes = [];
            let statViewEvents = [];
            let statPollTimer = null;
            let statCacheTime = 0;
            const STAT_CACHE_DURATION = 30000; // 30秒缓存

            // 滚动到指定帖子并高亮
            window.scrollToPost = function(postId) {
                closeModal('statModal');
                setTimeout(() => {
                    const post = document.querySelector(`.post[data-post-id="${postId}"]`);
                    if (post) {
                        post.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        post.style.boxShadow = '0 0 0 3px var(--primary)';
                        post.style.transition = 'box-shadow 0.3s';
                        setTimeout(() => { post.style.boxShadow = ''; }, 2000);
                    }
                }, 350);
            };

            // ===================== 帖子渲染函数 =====================
            let activeNotifications = [];

            function showNotification(userName, message) {
                if (!userName || !message) return;
                if (window.safeStorage.get('xtj-notif') === 'off') return;
                if (currentDockTab === 'chat' && dockChatActiveUser === userName) return;

                const container = document.getElementById('notificationContainer');
                if (!container) return;

                const bubble = document.createElement('div');
                bubble.className = 'notification-bubble';

                const safeAvatarUrl = getAvatarUrl(userName) ? sanitizeUrl(getAvatarUrl(userName)) : '';
                const avatarHtml = safeAvatarUrl ? 
                    `<img loading="lazy" decoding="async" src="${escapeHtml(safeAvatarUrl)}" alt="${escapeHtml(userName)}">` : 
                    escapeHtml(String(userName)[0] || '').toUpperCase();

                const truncatedMsg = message.length > 50 ? message.slice(0, 50) + '...' : message;

                bubble.innerHTML = `
                    <div class="notification-avatar">${avatarHtml}</div>
                    <div class="notification-content">
                        <div class="notification-name">${escapeHtml(userName)}</div>
                        <div class="notification-text">${escapeHtml(truncatedMsg)}</div>
                    </div>
                `;

                bubble.addEventListener('click', () => {
                    switchDockTab('chat');
                    openChat(userName);
                    bubble.classList.remove('show');
                    bubble.classList.add('hide');
                    setTimeout(() => {
                        if (bubble.parentNode) bubble.remove();
                    }, 400);
                });

                container.appendChild(bubble);

                // 强制浏览器完成布局后再添加 show（触发 CSS transition）
                bubble.offsetHeight; // force reflow
                setTimeout(function() {
                    bubble.classList.add('show');
                }, 16);

                const notifId = Date.now() + Math.random();
                activeNotifications.push({ id: notifId, element: bubble });

                setTimeout(() => {
                    bubble.classList.remove('show');
                    bubble.classList.add('hide');
                    setTimeout(() => {
                        if (bubble.parentNode) bubble.remove();
                        activeNotifications = activeNotifications.filter(n => n.id !== notifId);
                    }, 400);
                }, 3000);
            }

            // ==== 测试通知：testNotification() ====
            window.testNotification = function() {
                showNotification('张三', '这是一条测试消息，检查通知文本显示是否正常');
            };
            window.testNotificationLong = function() {
                showNotification('李四', '这是一条非常长的测试消息，用来检查文本截断效果到底怎么样，超过300个字符也不怕');
            };

            // ===================== 悬浮 Dock（底部导航） =====================
            let chatRealtime = null;
            let commentRealtime = null;
            let dmpollTimer = null;
            let dmpollInterval = null;

            var _escapeDiv = null;
            function escapeHtml(str) {
                var s = String(str == null ? '' : str);
                if (s.length < 80) {
                    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                }
                if (!_escapeDiv) _escapeDiv = document.createElement('div');
                _escapeDiv.textContent = s;
                // innerHTML serialization does NOT escape quotes in text, which
                // would break values placed inside double-quoted attributes
                // (e.g. long data: URLs used as avatar src). Escape them here.
                return _escapeDiv.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            }
            window.escapeHtml = escapeHtml;

            // Safely escape a value for use inside a JavaScript single-quoted string
            // that is itself inside an HTML attribute (e.g. onclick="...'...'...")
            function safeJsStr(str) {
                var s = String(str == null ? '' : str);
                // Must escape & first, then \, then ', then "
                return s.replace(/&/g, '&amp;').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            }
            window.safeJsStr = safeJsStr;

            // 安全地过滤 URL，防止 javascript: 等 XSS 攻击
            function sanitizeUrl(url) {
                var s = String(url == null ? '' : url).trim();
                // 只允许 http://, https://, data:, blob: 协议
                if (/^(https?:|data:|blob:)/i.test(s)) return s;
                // 相对路径也允许（以 / 或 ./ 开头，但排除协议相对 URL //）
                if (/^\./.test(s) || (/^\//.test(s) && !/^\/\//.test(s))) return s;
                return '';
            }
            window.sanitizeUrl = sanitizeUrl;

            function formatMsgTime(dateStr) {
                var d = new Date(dateStr);
                var now = new Date();
                var pad = function(n) { return String(n).padStart(2, '0'); };
                var hhmm = pad(d.getHours()) + ':' + pad(d.getMinutes());
                if (d.toDateString() === now.toDateString()) return hhmm;
                return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hhmm;
            }

            function getMediaUrl(prefix, val) {
                if (val.startsWith('http')) return sanitizeUrl(val);
                if (!sb) return '';
                try {
                    return sb.storage.from('uploads').getPublicUrl(val).data.publicUrl;
                } catch(e) { return ''; }
            }

            function sanitizeStorageFileName(name) {
                var raw = String(name || "file");
                var extMatch = raw.match(/(\.[a-zA-Z0-9]{1,8})$/);
                var ext = extMatch ? extMatch[1].toLowerCase() : "";
                // 阻止危险扩展名
                var dangerousExts = {'.exe':1,'.bat':1,'.cmd':1,'.com':1,'.msi':1,'.scr':1,'.pif':1,'.vbs':1,'.ps1':1,'.sh':1,'.php':1,'.jsp':1,'.asp':1,'.aspx':1,'.cgi':1,'.pl':1,'.py':1,'.rb':1};
                if (dangerousExts[ext]) ext = ".blocked";
                var base = ext ? raw.slice(0, -extMatch[0].length) : raw;
                if (base.normalize) base = base.normalize("NFKD");
                base = base.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
                if (!base) base = "media";
                return base + ext;
            }

            function buildStorageUploadPath(scope, fileName) {
                var userPart = '';
                try {
                    var u = String(window.currentUser || '').trim();
                    if (u) userPart = u.replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, '_').slice(0, 32) + '_';
                } catch (_e) {}
                return String(scope || "misc") + "/" + userPart + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "_" + sanitizeStorageFileName(fileName);
            }

            function parseDMContentPayload(raw) {
                if (!raw) return null;
                if (typeof raw === 'object') return raw;
                if (typeof raw !== 'string') return null;
                var trimmed = raw.trim();
                if (!trimmed || trimmed.charAt(0) !== '{') return null;
                try {
                    var parsed = JSON.parse(trimmed);
                    return parsed && typeof parsed === 'object' ? parsed : null;
                } catch (e) {
                    return null;
                }
            }

            function getDMMessagePayload(message) {
                return parseDMContentPayload(message && message.content);
            }

            function getDMMessageText(message) {
                var payload = getDMMessagePayload(message);
                if (payload && typeof payload.text === 'string') return payload.text;
                return typeof (message && message.content) === 'string' ? message.content : '';
            }

            function getDMMessageReadAt(message) {
                var payload = getDMMessagePayload(message);
                return payload && typeof payload.read_at === 'string' && payload.read_at ? payload.read_at : '';
            }

            function buildDMMessageContent(message, overrides) {
                var payload = getDMMessagePayload(message) || {};
                var next = Object.assign({}, payload, overrides || {});
                var hasTextOverride = overrides && Object.prototype.hasOwnProperty.call(overrides, 'text');
                var fallbackText = payload && typeof payload.text === 'string'
                    ? payload.text
                    : (typeof (message && message.content) === 'string' && !parseDMContentPayload(message.content) ? message.content : '');
                next.type = next.type || 'dm';
                next.text = hasTextOverride ? (overrides.text || '') : fallbackText;
                if (!Object.prototype.hasOwnProperty.call(next, 'read_at')) next.read_at = payload.read_at || null;
                return JSON.stringify(next);
            }

            function resolveDockChatMedia(message) {
                if (!message) return null;
                var payload = getDMMessagePayload(message);
                var actorKey = String(message.actor_key || '');
                if (payload && payload.media && payload.media.url) {
                    return {
                        kind: payload.media.kind || '',
                        src: payload.media.url,
                        fullSrc: payload.media.url
                    };
                }
                if (actorKey.indexOf('__dm_img__') === 0) {
                    var rawImage = actorKey.replace('__dm_img__', '');
                    var imageSrc = /^https?:\/\//i.test(rawImage) ? rawImage : getMediaUrl('__dm_img__', rawImage);
                    return { kind: 'image', src: imageSrc, fullSrc: imageSrc };
                }
                if (actorKey.indexOf('__dm_vid__') === 0) {
                    var rawVideo = actorKey.replace('__dm_vid__', '');
                    var videoSrc = /^https?:\/\//i.test(rawVideo) ? rawVideo : getMediaUrl('__dm_vid__', rawVideo);
                    return { kind: 'video', src: videoSrc, fullSrc: videoSrc };
                }
                // P6: support audio media — previously __dm_aud__ was never parsed,
                // causing audio messages to render as plain text with no player.
                if (actorKey.indexOf('__dm_aud__') === 0) {
                    var rawAudio = actorKey.replace('__dm_aud__', '');
                    var audioSrc = /^https?:\/\//i.test(rawAudio) ? rawAudio : getMediaUrl('__dm_aud__', rawAudio);
                    return { kind: 'audio', src: audioSrc, fullSrc: audioSrc };
                }
                var text = getDMMessageText(message).trim();
                if (/^https?:\/\/\S+$/i.test(text) && !/^data:/i.test(text)) {
                    if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(text)) {
                        return { kind: 'image', src: text, fullSrc: text };
                    }
                    if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(text)) {
                        return { kind: 'video', src: text, fullSrc: text };
                    }
                    // P6: detect audio URLs in text messages
                    if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i.test(text)) {
                        return { kind: 'audio', src: text, fullSrc: text };
                    }
                }
                return null;
            }

            function getDockChatMessagePreview(message) {
                var text = getDMMessageText(message).trim();
                if (text) return text;
                var media = resolveDockChatMedia(message);
                if (!media) return '新消息';
                // P6: support audio preview text
                if (media.kind === 'audio') return '[音频]';
                if (media.kind === 'video') return '[视频]';
                return '[图片]';
            }

            window.handleDockChatImageError = function(img) {
                if (!img || !img.parentNode) return;
                var retryCount = parseInt(img.getAttribute('data-retry-count') || '0', 10) || 0;
                if (retryCount < 1) {
                    var retrySrc = img.getAttribute('data-full-src') || img.getAttribute('data-src') || img.currentSrc || img.src || "";
                    if (retrySrc) {
                        img.setAttribute('data-retry-count', String(retryCount + 1));
                        img.src = retrySrc + (retrySrc.indexOf('?') >= 0 ? '&' : '?') + 'retry=' + Date.now();
                        return;
                    }
                }
                var fullSrc = img.getAttribute("data-full-src") || img.currentSrc || img.src || "";
                var fallback = document.createElement("button");
                fallback.type = "button";
                fallback.className = "msg-media-fallback";
                fallback.innerHTML = '<span class="msg-media-fallback-icon">图片</span><span class="msg-media-fallback-text">查看图片</span>';
                fallback.onclick = function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (fullSrc && typeof window.openImageViewer === "function") {
                        window.openImageViewer(fullSrc);
                    } else {
                        showToast("图片加载失败");
                    }
                };
                img.parentNode.replaceChild(fallback, img);
            };

            function isMsgReadByMe(msg) {
                if (getDMMessageReadAt(msg)) return true;
                return ((msg && msg.views) || 0) > 0;
            }
            // ★ 修复：导出到 window——此前仅同作用域可调用，而 9826/10652 行
            //   通过 window.isMsgReadByMe 调用必然 TypeError，DM 未读角标恒为 0。
            window.isMsgReadByMe = isMsgReadByMe;

            async function markMessagesRead(senderName, messages, pendingUpdates) {
                if (!window.currentUser || !senderName) return;
                var updates = Array.isArray(pendingUpdates) ? pendingUpdates.slice() : [];
                if (!updates.length && Array.isArray(messages)) {
                    messages.forEach(function(m) {
                        if (!m || m.user_name !== senderName || m.media_url !== window.currentUser || getDMMessageReadAt(m)) return;
                        updates.push({ id: m.id });
                    });
                }
                if (updates.length) {
                    var response = await window.xtjProtectedFetch('/api/dm/read', {
                        method: 'POST',
                        body: JSON.stringify({ message_ids: updates.map(function(update) { return update.id; }) })
                    });
                    var result = await response.json().catch(function() { return {}; });
                    if (!response.ok || !result.ok) throw new Error(result.error || 'DM read update failed');
                    var readRows = Array.isArray(result.data) ? result.data : [];
                    var readById = new Map(readRows.map(function(row) { return [String(row.id), row]; }));
                    var cacheKey = getDockChatCacheKey(senderName);
                    var cached = Array.isArray(_chatCache[cacheKey]) ? _chatCache[cacheKey] : [];
                    _chatCache[cacheKey] = cached.map(function(message) {
                        var authoritative = readById.get(String(message && message.id));
                        return authoritative ? Object.assign({}, message, authoritative) : message;
                    });
                    if (dockChatActiveUser === senderName) renderDockMessages(senderName, _chatCache[cacheKey], false);
                }
                scheduleDockChatListRefresh(updates.length ? 120 : 40);
                updateUnreadBadge();
            }
            window.markMessagesRead = markMessagesRead;

            function subscribeToMessages() {
                // H-10 修复：sb 在 SUPABASE_URL/ANON_KEY 缺失时为 null，
                // 缺守卫会抛 TypeError（与 subscribeToComments 对齐）
                if (!sb) return;
                if (chatRealtime) {
                    try { sb.removeChannel(chatRealtime); } catch(e) {}
                    chatRealtime = null;
                }
                // ★ 修复：DM 订阅此前完全没有断线重连（对比 subscribeToComments），
                //   CHANNEL_ERROR/TIMED_OUT/CLOSED 后永久失去实时推送，只能靠 5 分钟轮询兜底。
                //   现与评论订阅对齐：指数退避自动重连（最多 10 次）。
                var _dmReconnectAttempts = 0;
                var _dmMaxReconnectAttempts = 10;

                function createDmChannel() {
                    chatRealtime = sb.channel('chat-dms')
                        .on('postgres_changes', { event: '*', schema: 'public', table: 'posts', filter: 'media_type=eq.' + DM_MARKER }, function(payload) {
                            var m = payload.new || payload.old;
                            if (m.media_type !== DM_MARKER) return;
                            if (!window.currentUser) return;
                            if (m.user_name !== window.currentUser && m.media_url !== window.currentUser) return;
                            var otherUser = m.user_name === window.currentUser ? m.media_url : m.user_name;
                            if (payload.eventType === 'INSERT' && m.media_url === window.currentUser && m.user_name !== window.currentUser) {
                                showNotification(m.user_name, getDockChatMessagePreview(m));
                            }
                            window.dockChatListCacheTime = 0;
                            if (dockChatActiveUser && dockChatActiveUser === otherUser) {
                                loadDockChatMessages(otherUser, false);
                            } else if (!dockChatActiveUser) {
                                window.dockChatListCacheTime = 0;
                                loadDockChatList();
                                updateUnreadBadge();
                            } else {
                                // ★ 修复：正在看 A 的会话、B 发来新消息时，仅加未读数不刷新
                                //   会话列表，导致列表排序/预览/B 红点停留在旧快照。缓存已失效，
                                //   这里补一次列表刷新，回到列表页即可看到最新会话。
                                window.dockChatListCacheTime = 0;
                                loadDockChatList();
                                updateUnreadBadge();
                            }
                        })
                        .subscribe(function(status, err) {
                            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                                console.warn('[CHAT-REALTIME]', status, err);
                                if (_dmReconnectAttempts < _dmMaxReconnectAttempts) {
                                    _dmReconnectAttempts++;
                                    var backoff = Math.min(1000 * Math.pow(2, _dmReconnectAttempts), 30000);
                                    setTimeout(function() {
                                        if (chatRealtime) {
                                            try { sb.removeChannel(chatRealtime); } catch(e) {}
                                            chatRealtime = null;
                                        }
                                        createDmChannel();
                                    }, backoff);
                                }
                            } else if (status === 'SUBSCRIBED') {
                                _dmReconnectAttempts = 0;
                            } else if (err) {
                                console.error('[CHAT-REALTIME]', err);
                            }
                        });
                }
                createDmChannel();
            }

            function subscribeToComments() {
                if (!sb) return;
                // F6：订阅代次。断线 backoff 等待期间若又因可见性变化重建订阅，
                // 旧 backoff 到期不得再建通道，避免并存多个 feed-comments 通道。
                window.__commentSubEpoch = (window.__commentSubEpoch || 0) + 1;
                var mySubEpoch = window.__commentSubEpoch;
                if (commentRealtime) {
                    try { sb.removeChannel(commentRealtime); } catch(e) {}
                    commentRealtime = null;
                }
                var _reconnectAttempts = 0;
                var _maxReconnectAttempts = 10;

                function createChannel() {
                    if (mySubEpoch !== window.__commentSubEpoch) return; // 已被更新的订阅取代
                    commentRealtime = sb.channel('feed-comments')
                        .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, function(payload) {
                            var row = payload.new || payload.old;
                            if (!row || row.id == null) return;
                            var commentId = String(row.id);
                            if (payload.eventType === 'DELETE') {
                                feedAllComments = (feedAllComments || []).filter(function(comment) {
                                    return String(comment && comment.id) !== commentId;
                                });
                                profileActivityState.comments = (profileActivityState.comments || []).filter(function(comment) {
                                    return String(comment && comment.id) !== commentId;
                                });
                                // 删除对应的 DOM 元素
                                var domEl = document.querySelector('.comment-item[data-comment-id="' + commentId + '"]');
                                if (domEl && domEl.parentNode) domEl.parentNode.removeChild(domEl);
                                // Phase 4: 取消对应的 cat AI 轮询任务
                                if (typeof cancelCatAiTask === 'function') {
                                    cancelCatAiTask(commentId, 'comment deleted via Realtime');
                                }
                            } else if (payload.eventType === 'INSERT') {
                                var postIsVisible = (feedAllPosts || []).some(function(post) {
                                    return String(post && post.id) === String(row.post_id);
                                });
                                if (!postIsVisible) return;
                                // 去重
                                feedAllComments = (feedAllComments || []).filter(function(comment) {
                                    return String(comment && comment.id) !== commentId;
                                });
                                feedAllComments.push(row);
                                // F7：先判定“是否小猫回复行”，是则无论 post_id 是否齐全都先移除进行中状态，
                                // 避免缺 post_id 时落到普通全量刷新分支、导致“正在组织”气泡残留。
                                var isCatAiReplyRow = row.generated_by_ai === true && row.user_name === 'cat_ai' && row.parent_comment_id;
                                if (isCatAiReplyRow) {
                                    removeCatAiStatus(String(row.parent_comment_id));
                                    if (row.post_id != null) {
                                        upsertAiComment(row, String(row.parent_comment_id), row.post_id);
                                    } else if (typeof renderFeedFromMemoryState === 'function') {
                                        renderFeedFromMemoryState().catch(function() {});
                                    }
                                } else {
                                    // 普通评论，全量刷新
                                    if (typeof renderFeedFromMemoryState === 'function') renderFeedFromMemoryState().catch(function() {});
                                }
                            } else if (payload.eventType === 'UPDATE') {
                                // 更新已有评论
                                feedAllComments = (feedAllComments || []).map(function(comment) {
                                    if (String(comment && comment.id) === commentId) return row;
                                    return comment;
                                });
                            }
                            if (typeof writeFeedCacheSnapshot === 'function') writeFeedCacheSnapshot();
                            if (typeof renderProfileActivity === 'function') renderProfileActivity();
                        })
                        .subscribe(function(status, err) {
                            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                                console.warn('[COMMENT-REALTIME]', status, err);
                                // 自动重连
                                if (_reconnectAttempts < _maxReconnectAttempts) {
                                    _reconnectAttempts++;
                                    var backoff = Math.min(1000 * Math.pow(2, _reconnectAttempts), 30000);
                                    setTimeout(function() {
                                        if (mySubEpoch !== window.__commentSubEpoch) return;
                                        if (commentRealtime) {
                                            try { sb.removeChannel(commentRealtime); } catch(e) {}
                                            commentRealtime = null;
                                        }
                                        createChannel();
                                    }, backoff);
                                }
                            } else if (status === 'SUBSCRIBED') {
                                _reconnectAttempts = 0;
                            }
                        });
                }
                createChannel();
            }

            // ★ 页面可见时检查并恢复实时订阅 + 恢复轮询任务
            document.addEventListener('visibilitychange', function() {
                if (!document.hidden && window.currentUser) {
                    if (!commentRealtime || commentRealtime.state === 'closed') {
                        subscribeToComments();
                    }
                    // ★ 修复：DM 实时订阅同样需要在页面恢复可见时重建，
                    //   此前只恢复评论订阅，DM 通道断开后无法自动恢复
                    if (!chatRealtime || chatRealtime.state === 'closed') {
                        subscribeToMessages();
                    }
                    // ★ 恢复所有暂停的轮询
                    // Phase 3-P0-5: 原循环体为空，页面恢复可见时未触发立即轮询。
                    // 现遍历存活的轮询任务，从 __catAiPollStatus 取出 postId 后调用
                    // pollCatAiReply 触发一次立即轮询，避免隐藏期间任务长时间停滞。
                    var timers = window.__catAiPollTimers || {};
                    var statusMap = window.__catAiPollStatus || {};
                    Object.keys(timers).forEach(function(k) {
                        try {
                            var pid = (statusMap[k] && statusMap[k].postId) || null;
                            if (pid) {
                                pollCatAiReply(k, pid, true); // F3：恢复可见时立即首查
                            }
                        } catch(e) {}
                    });
                }
            });
            window.addEventListener('online', function() {
                if (window.currentUser) {
                    if (!commentRealtime || commentRealtime.state === 'closed') {
                        subscribeToComments();
                    }
                    // ★ 修复：网络恢复时同时重建 DM 订阅
                    if (!chatRealtime || chatRealtime.state === 'closed') {
                        subscribeToMessages();
                    }
                }
            });
            window.addEventListener('pageshow', function() {
                if (window.currentUser) {
                    if (!commentRealtime || commentRealtime.state === 'closed') {
                        subscribeToComments();
                    }
                    // ★ 修复：页面重新显示时同时重建 DM 订阅
                    if (!chatRealtime || chatRealtime.state === 'closed') {
                        subscribeToMessages();
                    }
                }
            });

            function startDMPolling(interval, skipImmediate) {
                // 修复：5 分钟（300000ms）内不重复轮询
                interval = interval || 300000;
                if (dmpollTimer) {
                    if (dmpollInterval === interval) return;
                    clearInterval(dmpollTimer); dmpollTimer = null;
                }
                dmpollInterval = interval;
                async function pollNow() {
                    if (!window.currentUser) return;
                    try {
                        if (typeof dockChatActiveUser !== 'undefined' && dockChatActiveUser) {
                            await loadDockChatMessages(dockChatActiveUser, false);
                        } else {
                            await updateUnreadBadge();
                        }
                    } catch(e) {}
                }
                if (!skipImmediate) pollNow();
                dmpollTimer = setInterval(pollNow, interval);
            }

            function stopDMPolling() {
                if (dmpollTimer) { clearInterval(dmpollTimer); dmpollTimer = null; dmpollInterval = null; }
            }

            function setUnreadBadgeCount(cnt) {
                var badge = document.getElementById('navChatBadge');
                if (!badge) return;
                if (cnt > 0) {
                    badge.textContent = cnt > 99 ? '99+' : cnt;
                    badge.classList.add('show');
                } else {
                    badge.classList.remove('show');
                }
            }

            async function updateUnreadBadge() {
                var badge = document.getElementById('navChatBadge');
                if (!window.currentUser) {
                    if (badge) badge.classList.remove('show');
                    return;
                }
                try {
                    // ★ 修复：口径对齐 —— loadDockChatList 用最近 180 条按会话聚合再求和，
                    // 这里原为 120 条直接逐条计数（去重 120 条），两处结果不一致导致切换 tab 时数字跳动。
                    // 现将查询上限提高到 200，并同样先按会话（media_url）聚合每条会话的未读数
                    // （封顶 99），再对所有会话求和，与 loadDockChatList 的统计口径保持一致。
                    var result = await sb.from('posts')
                        .select('id, user_name, content, views, created_at')
                        .eq('media_type', DM_MARKER)
                        .eq('media_url', window.currentUser)
                        .order('created_at', { ascending: false })
                        .limit(200);

                    var data = result.data;
                    var error = result.error;
                    if (error) return;
                    var convUnreadMap = {};
                    (data || []).forEach(function(m) {
                        var sender = m && m.user_name;
                        if (!sender) return;
                        if (window.isMsgReadByMe(m)) return;
                        convUnreadMap[sender] = Math.min((convUnreadMap[sender] || 0) + 1, 99);
                    });
                    var cnt = 0;
                    Object.keys(convUnreadMap).forEach(function(sender) {
                        cnt += convUnreadMap[sender];
                    });
                    setUnreadBadgeCount(cnt);
                } catch(e) {}
            }

            // ===================== 举报回复通知检测 =====================
            var reportReplyPollTimer = null;
            var REPORT_REPLY_POLL_INTERVAL = 30000; // 30秒

            async function checkReportReplies() {
                if (!window.currentUser) return;
                try {
                    // 兼容新旧API：优先用后端通知API，降级到本地检测
                    var unread = 0;
                    if (typeof window.xtjProtectedFetch !== 'function') return;
                    var notifRes = await window.xtjProtectedFetch('/api/report/notifications');
                    if (!notifRes.ok) return;
                    var notifData = await notifRes.json().catch(function() { return {}; });
                    unread = Number(notifData.unread) || 0;
                        // 降级：本地检测旧版 admin_response（兼容旧逻辑）
                                // 检查通知数组
                                // 兼容旧版 admin_response
                    // 更新举报按钮红点
                    var reportBadge = document.getElementById('reportBtnBadge');
                    if (reportBadge) {
                        if (unread > 0) {
                            reportBadge.textContent = unread > 99 ? '99+' : unread;
                            reportBadge.style.display = '';
                            reportBadge.classList.add('show');
                        } else {
                            reportBadge.classList.remove('show');
                            reportBadge.style.display = 'none';
                        }
                    }
                    // 同时更新 dock 导航红点
                    var navBadge = document.getElementById('navReportBadge');
                    if (navBadge) {
                        if (unread > 0) {
                            navBadge.textContent = unread > 99 ? '99+' : unread;
                            navBadge.classList.add('show');
                        } else {
                            navBadge.classList.remove('show');
                        }
                    }
                } catch(e) {}
            }

            function startReportReplyPolling() {
                if (reportReplyPollTimer) {
                    clearInterval(reportReplyPollTimer);
                }
                checkReportReplies();
                reportReplyPollTimer = setInterval(checkReportReplies, REPORT_REPLY_POLL_INTERVAL);
            }

            // S8 修复：登出/会话销毁时必须停止举报轮询，避免定时器残留
            function stopReportReplyPolling() {
                if (reportReplyPollTimer) {
                    clearInterval(reportReplyPollTimer);
                    reportReplyPollTimer = null;
                }
            }

            function clearReportReplyBadge() {
                if (!window.currentUser || typeof window.xtjProtectedFetch !== 'function') return;
                window.xtjProtectedFetch('/api/report/notifications/mark-read', {
                    method: 'POST',
                    body: JSON.stringify({})
                }).then(function(response) {
                    if (!response.ok) throw new Error('report_mark_read_failed');
                window.safeStorage.set('xtj_report_reply_check', String(Date.now()));
                var badge = document.getElementById('navReportBadge');
                if (badge) {
                    badge.classList.remove('show');
                    badge.textContent = '0';
                }
                var reportBadge = document.getElementById('reportBtnBadge');
                if (reportBadge) {
                    reportBadge.classList.remove('show');
                    reportBadge.style.display = 'none';
                    reportBadge.textContent = '0';
                }
                // 标记服务器端通知为已读
                // ★ 修复：原 200ms 内后端未必完成"已读"落库，checkReportReplies
                // 会读到旧 unread>0 把刚清掉的红点又点亮（闪烁/残留）。
                // 延迟重查让后端落库完成；本地角标已即时清空。
                setTimeout(checkReportReplies, 3000);
                }).catch(function() {});
            }

            let refreshTimeout = null;
            const debouncedLoadFeed = (forceRefresh = false) => {
                if (refreshTimeout) clearTimeout(refreshTimeout);
                refreshTimeout = setTimeout(() => loadFeed(forceRefresh), 500);
            };

            // ========== Dock 底部导航 ==========
            let currentDockTab = window.safeStorage.get('xtj_current_tab') || 'posts';
            let lastTabTapTime = {};
            let lastTabTapCount = {};
            let isRefreshing = {};
            function syncDockIndicator() {
                var dockBar = document.getElementById('dockBar');
                var indicator = document.getElementById('dockIndicator');
                if (!dockBar || !indicator) return;
                var activeBtn = dockBar.querySelector('.dock-tab.active') || dockBar.querySelector('.dock-tab[data-tab="' + currentDockTab + '"]');
                if (!activeBtn) {
                    indicator.style.opacity = '0';
                    return;
                }
                var barRect = dockBar.getBoundingClientRect();
                var btnRect = activeBtn.getBoundingClientRect();
                indicator.style.transition = '';
                indicator.style.width = btnRect.width + 'px';
                indicator.style.height = btnRect.height + 'px';
                indicator.style.transform = 'translate3d(' + (btnRect.left - barRect.left) + 'px,' + (btnRect.top - barRect.top) + 'px,0)';
                indicator.style.opacity = '1';
            }
            window.syncDockIndicator = syncDockIndicator;

            function getDockIndicatorMetrics() {
                var dockBar = document.getElementById('dockBar');
                var indicator = document.getElementById('dockIndicator');
                if (!dockBar || !indicator) return null;
                var dockTabs = Array.prototype.slice.call(dockBar.querySelectorAll('.dock-tab'));
                if (!dockTabs.length) return null;
                var barRect = dockBar.getBoundingClientRect();
                var indicatorRect = indicator.getBoundingClientRect();
                var activeBtn = dockBar.querySelector('.dock-tab.active') || dockBar.querySelector('.dock-tab[data-tab="' + currentDockTab + '"]') || dockTabs[0];
                var activeRect = activeBtn.getBoundingClientRect();
                var indicatorWidth = activeRect.width || indicatorRect.width || 72;
                var indicatorHeight = activeRect.height || indicatorRect.height || 48;
                var currentX = indicatorRect.width
                    ? (indicatorRect.left - barRect.left)
                    : (activeRect.left - barRect.left);
                var firstRect = dockTabs[0].getBoundingClientRect();
                var lastRect = dockTabs[dockTabs.length - 1].getBoundingClientRect();
                return {
                    dockBar: dockBar,
                    indicator: indicator,
                    dockTabs: dockTabs,
                    barRect: barRect,
                    currentX: currentX,
                    currentY: activeRect.top - barRect.top,
                    currentWidth: indicatorWidth,
                    currentHeight: indicatorHeight,
                    minX: (firstRect.left - barRect.left) - firstRect.width * 0.2,
                    maxX: (lastRect.right - barRect.left) - indicatorWidth + lastRect.width * 0.2,
                    minY: (firstRect.top - barRect.top) - firstRect.height * 0.2,
                    maxY: (lastRect.bottom - barRect.top) - indicatorHeight + lastRect.height * 0.2
                };
            }

            function findNearestDockTab(clientX) {
                var dockBar = document.getElementById('dockBar');
                if (!dockBar) return null;
                var dockTabs = Array.prototype.slice.call(dockBar.querySelectorAll('.dock-tab'));
                if (!dockTabs.length) return null;
                var nearest = dockTabs[0];
                var nearestDistance = Infinity;
                dockTabs.forEach(function(tab) {
                    var rect = tab.getBoundingClientRect();
                    var centerX = rect.left + rect.width / 2;
                    var distance = Math.abs(clientX - centerX);
                    if (distance < nearestDistance) {
                        nearest = tab;
                        nearestDistance = distance;
                    }
                });
                return nearest;
            }
            function findNearestDockTabY(clientY) {
                var dockBar = document.getElementById('dockBar');
                if (!dockBar) return null;
                var dockTabs = Array.prototype.slice.call(dockBar.querySelectorAll('.dock-tab'));
                if (!dockTabs.length) return null;
                var nearest = dockTabs[0];
                var nearestDistance = Infinity;
                dockTabs.forEach(function(tab) {
                    var rect = tab.getBoundingClientRect();
                    var centerY = rect.top + rect.height / 2;
                    var distance = Math.abs(clientY - centerY);
                    if (distance < nearestDistance) {
                        nearest = tab;
                        nearestDistance = distance;
                    }
                });
                return nearest;
            }

            function setPhotoWallLockedState(isLocked) {
                var sort = document.getElementById('pwAlbumSort');
                var toggle = document.getElementById('pwAlbumToggle');
                var upload = document.getElementById('photoUploadBtn');
                var sync = document.getElementById('pwSyncStatus');
                if (sort) sort.style.display = isLocked ? 'none' : '';
                if (toggle) toggle.style.display = isLocked ? 'none' : '';
                if (upload) upload.style.display = isLocked ? 'none' : '';
                if (sync) sync.style.display = isLocked ? 'none' : '';
            }

            function renderPhotoWallLockedState() {
                var grid = document.getElementById('photoGrid');
                var albums = document.getElementById('pwAlbumContainer');
                if (albums) {
                    albums.style.display = 'none';
                    albums.innerHTML = '';
                }
                setPhotoWallLockedState(true);
                if (!grid) return;
                grid.innerHTML = [
                    '<div class="photo-wall-empty">',
                    '  <div class="photo-wall-empty-icon">🔒</div>',
                    '  <div>登录后可查看照片墙内容</div>',
                    '  <div style="font-size:12px;margin-top:8px;">可以切换到这个板块，但未登录时不会加载具体照片数据。</div>',
                    '  <button type="button" class="photo-wall-empty-cta" onclick="openAuthModal(\'login\')">立即登录</button>',
                    '</div>'
                ].join('');
            }

            async function ensurePhotoWallVisibleContent(options) {
                var opts = options || {};
                await ensurePhotoWallLoaded();
                if (typeof window.initPhotoWall === 'function') {
                    await window.initPhotoWall();
                }
                var grid = document.getElementById('photoGrid');
                if (!grid) return;
                var hasRenderedPhotos = !!grid.querySelector('.photo-wall-item');
                var hasSkeleton = !!grid.querySelector('.pw-skeleton');
                var hasEmptyState = !!grid.querySelector('.photo-wall-empty');
                var hasPhotoData = Array.isArray(window.photoWallData) && window.photoWallData.length > 0;
                if (opts.forceReload || !hasRenderedPhotos || hasSkeleton || (!hasPhotoData && !hasEmptyState)) {
                    if (typeof window.loadPhotoWallData === 'function') {
                        await window.loadPhotoWallData(true);
                    }
                    if (typeof window.renderPhotoWall === 'function') {
                        await window.renderPhotoWall();
                    } else if (typeof window.renderPhotoWallWithoutReload === 'function') {
                        window.renderPhotoWallWithoutReload();
                    }
                    grid = document.getElementById('photoGrid');
                    hasRenderedPhotos = !!(grid && grid.querySelector('.photo-wall-item'));
                    hasSkeleton = !!(grid && grid.querySelector('.pw-skeleton'));
                    hasEmptyState = !!(grid && grid.querySelector('.photo-wall-empty'));
                    hasPhotoData = Array.isArray(window.photoWallData) && window.photoWallData.length > 0;
                }
                if (grid && !hasRenderedPhotos && !hasSkeleton && !hasEmptyState && !hasPhotoData) {
                    grid.innerHTML = '<div class="photo-wall-empty"><div>暂无照片</div></div>';
                }
            }

            function installDockIndicatorDrag() {
                var dockBar = document.getElementById('dockBar');
                var indicator = document.getElementById('dockIndicator');
                if (!dockBar || !indicator || dockBar.__xtjDockDragInstalled) return;
                dockBar.__xtjDockDragInstalled = true;

                var drag = null;
                var dragHandledTs = 0;

                dockBar.addEventListener('pointerdown', function(e) {
                    if (e.pointerType === 'mouse' && e.button !== 0) return;
                    var metrics = getDockIndicatorMetrics();
                    if (!metrics) return;
                    syncDockIndicator();
                    metrics = getDockIndicatorMetrics();
                    if (!metrics) return;
                    var isVertical = getComputedStyle(dockBar).flexDirection === 'column';
                    drag = {
                        id: e.pointerId,
                        sx: e.clientX,
                        sy: e.clientY,
                        ix: metrics.currentX,
                        iy: metrics.currentY,
                        w: metrics.currentWidth,
                        h: metrics.currentHeight,
                        mx: isVertical ? metrics.maxY : metrics.maxX,
                        nx: isVertical ? metrics.minY : metrics.minX,
                        indicator: metrics.indicator,
                        moved: false,
                        onTab: !!(e.target && e.target.closest && e.target.closest('.dock-tab')),
                        vertical: isVertical
                    };
                    drag.indicator.style.width = drag.w + 'px';
                    drag.indicator.style.height = drag.h + 'px';
                    drag.indicator.style.transition = 'none';
                    drag.indicator.style.opacity = '1';
                    drag.indicator.style.transform = 'translate3d(' + drag.ix + 'px,' + drag.iy + 'px,0)';
                    if(!window._throttledDragMove) window._throttledDragMove = window.throttleRAF(onDragMove);
                    document.addEventListener('pointermove', window._throttledDragMove, {passive: false});
                    document.addEventListener('pointerup', onDragUp);
                    document.addEventListener('pointercancel', onDragCancel);
                });

                function onDragMove(e) {
                    if (!drag || e.pointerId !== drag.id) return;
                    e.preventDefault();
                    if (drag.vertical) {
                        var dy = e.clientY - drag.sy;
                        if (Math.abs(dy) > 2) drag.moved = true;
                        var ny = Math.max(drag.nx, Math.min(drag.mx, drag.iy + dy));
                        drag.indicator.style.transform = 'translate3d(' + drag.ix + 'px,' + ny + 'px,0)';
                        drag.cy = ny;
                    } else {
                        var dx = e.clientX - drag.sx;
                        if (Math.abs(dx) > 2) drag.moved = true;
                        var nx = Math.max(drag.nx, Math.min(drag.mx, drag.ix + dx));
                        drag.indicator.style.transform = 'translate3d(' + nx + 'px,' + drag.iy + 'px,0)';
                        drag.cx = nx;
                    }
                }

                function cleanupDrag() {
                    document.removeEventListener('pointermove', window._throttledDragMove || onDragMove);
                    document.removeEventListener('pointerup', onDragUp);
                    document.removeEventListener('pointercancel', onDragCancel);
                }

                function onDragUp(e) {
                    if (!drag) { cleanupDrag(); return; }
                    if (e.pointerId !== drag.id) return;
                    var state = drag;
                    drag = null;
                    cleanupDrag();
                    if (state.moved) {
                        var tab = state.vertical
                            ? findNearestDockTabY(e.clientY || state.sy)
                            : findNearestDockTab(e.clientX || state.sx);
                        if (tab) {
                            dragHandledTs = Date.now();
                            switchDockTab(tab.dataset.tab, true, { animate: true, source: 'dock-drag' });
                        }
                    }
                    requestAnimationFrame(syncDockIndicator);
                }

                function onDragCancel(e) {
                    if (!drag) { cleanupDrag(); return; }
                    if (e.pointerId !== drag.id) return;
                    drag = null;
                    cleanupDrag();
                    requestAnimationFrame(syncDockIndicator);
                }

                // 按钮点击：事件委托在 dockBar 上统一处理
                dockBar.addEventListener('click', function(e) {
                    var tabBtn = e.target.closest('.dock-tab');
                    if (!tabBtn) return;
                    if (Date.now() - dragHandledTs < 350) return;
                    switchDockTab(tabBtn.dataset.tab, false, { animate: true, source: 'dock-click' });
                });
            }

            var dockPanelTransitionTimer = null;
            var dockPanelAnimation = null;
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
