/**
 * core-parts/07-final-overrides.js
 * Emergency rescue + final UI/data overrides
 * Lines from original core.js: 13871-14624
 * DO NOT edit js/core.js directly — edit this file, then run: node scripts/assemble-core.js
 */
        (function installEmergencyActionRescue() {
            if (window.__xtjEmergencyActionRescueV1) return;
            window.__xtjEmergencyActionRescueV1 = true;

            function setBodyLockFromVisibleModals() {
                var activeIds = ['announcementModal', 'reportModal', 'reportHistoryModal', 'statModal'];
                var hasActive = activeIds.some(function(id) {
                    var el = document.getElementById(id);
                    return !!(el && el.classList.contains('active'));
                });
                document.body.style.overflow = hasActive ? 'hidden' : '';
            }

            function getSimpleStatPostMap() {
                var map = {};
                (Array.isArray(statAllPosts) ? statAllPosts : []).forEach(function(post) {
                    if (post && post.id != null) map[String(post.id)] = normalizePost(post);
                });
                Object.keys(postInfoCache || {}).forEach(function(id) {
                    if (!id || map[id]) return;
                    var cached = postInfoCache[id] || {};
                    map[id] = normalizePost({
                        id: cached.id || id,
                        content: cached.content || '',
                        user_name: cached.user_name || '',
                        media_url: cached.media_url || '',
                        media_type: cached.media_type || '',
                        created_at: cached.created_at || '',
                        views: Number(cached.views || 0)
                    });
                });
                return map;
            }

            function getStatPostById(postId) {
                if (postId == null || postId === '') return null;
                var key = String(postId);
                var direct = (Array.isArray(statAllPosts) ? statAllPosts : []).find(function(post) {
                    return post && String(post.id) === key;
                });
                if (direct) return normalizePost(direct);
                var cached = postInfoCache && postInfoCache[key];
                if (!cached) return null;
                return normalizePost({
                    id: cached.id || key,
                    content: cached.content || '',
                    user_name: cached.user_name || '',
                    media_url: cached.media_url || '',
                    media_type: cached.media_type || '',
                    created_at: cached.created_at || '',
                    views: Number(cached.views || 0)
                });
            }

            function formatPostSummary(post) {
                var normalized = normalizePost(post || {});
                var text = String(normalized.content || '').trim();
                var hasImg = !!(normalized.media_url && normalized.media_type === 'image');
                var hasVid = !!(normalized.media_url && normalized.media_type === 'video');
                var summary = text.length > 28 ? text.slice(0, 28) + '...' : text;
                return {
                    display: summary || (hasImg ? '图片动态' : (hasVid ? '视频动态' : '无文字内容')),
                    hasImg: hasImg,
                    hasVid: hasVid,
                    thumbUrl: hasImg ? normalized.media_url : null,
                    normalized: normalized
                };
            }

            function getStatPostSummary(post) {
                if (!post) return '原帖已删除';
                return formatPostSummary(post).display || '原帖已删除';
            }

            function formatStatDateTime(value) {
                var date = value ? window.safeParseDate(value) : new Date();
                if (Number.isNaN(date.getTime())) date = new Date();
                return date.toLocaleString();
            }

            function renderStatThumb(summary) {
                if (summary && summary.hasImg && summary.thumbUrl) {
                    return '<img class="spi-thumb" loading="lazy" decoding="async" src="' + escapeHtml(summary.thumbUrl) + '" alt="帖子缩略图" loading="lazy">';
                }
                if (summary && summary.hasVid) {
                    return '<div class="spi-thumb spi-thumb--video" aria-hidden="true">视频</div>';
                }
                return '';
            }

            function renderPostItemHTML(post, index) {
                var normalized = normalizePost(post || {});
                var summary = formatPostSummary(normalized);
                var detailOnclick = "openStatPostDetail('" + safeJsStr(String(normalized.id || '')) + "')";
                var thumb = renderStatThumb(summary);
                return [
                    '<article class="stat-post-item' + (thumb ? '' : ' stat-post-item--no-thumb') + '" role="button" tabindex="0" onclick="' + detailOnclick + '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + detailOnclick + '}" style="--xtj-enter-delay:' + Math.min((index || 0) * 20, 180) + 'ms;">',
                    '<div class="spi-main">',
                    '<div class="spi-content">' + escapeHtml(summary.display) + '</div>',
                    '<div class="spi-time">' + escapeHtml(formatStatDateTime(normalized.created_at)) + '</div>',
                    '</div>',
                    thumb,
                    '</article>'
                ].join('');
            }

            function getStatPostMediaHtml(post, postId) {
                var normalized = post ? normalizePost(post) : null;
                if (!normalized || !normalized.media_url) return '';
                if (normalized.media_type === 'image') {
                    return '<img class="stat-record-thumb" src="' + escapeHtml(normalized.media_url) + '" alt="记录缩略图" loading="lazy">';
                }
                if (normalized.media_type === 'video') {
                    return '<div class="stat-record-thumb stat-record-thumb--video" aria-hidden="true">视频</div>';
                }
                return '';
            }

            function renderStatRecordCard(options) {
                var title = String(options && options.title || '');
                var copy = String(options && options.copy || '');
                var note = String(options && options.note || '');
                var time = String(options && options.time || '');
                var postId = options && options.postId != null ? String(options.postId) : '';
                var thumbHtml = String(options && options.thumbHtml || '');
                var detailOnclick = postId ? "openStatPostDetail('" + safeJsStr(postId) + "')" : '';
                var clickAttr = detailOnclick ? ' role="button" tabindex="0" onclick="' + detailOnclick + '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + detailOnclick + '}"' : '';
                var enterStyle = String(options && options.enterStyle || '');
                return [
                    '<article class="stat-record-card' + (thumbHtml ? '' : ' stat-record-card--no-thumb') + '"' + clickAttr + enterStyle + '>',
                    '<div class="stat-record-main">',
                    '<div class="stat-record-title">' + escapeHtml(title) + '</div>',
                    '<div class="stat-record-copy">' + escapeHtml(copy || '无文字内容') + '</div>',
                    note ? '<div class="stat-record-note">' + escapeHtml(note) + '</div>' : '',
                    '<div class="stat-record-meta">' + escapeHtml(time) + '</div>',
                    '</div>',
                    thumbHtml,
                    '</article>'
                ].join('');
            }

            function resolveStatRecordPost(item) {
                var postId = item && item.post_id != null ? String(item.post_id) : '';
                var direct = postId ? getStatPostById(postId) : null;
                if (direct) return direct;
                if (!item) return null;
                if (!item.post_content && !item.post_author && !item.media_url && !item.media_type) return null;
                return normalizePost({
                    id: postId || '',
                    content: item.post_content || '',
                    user_name: item.post_author || '',
                    media_url: item.media_url || '',
                    media_type: item.media_type || '',
                    created_at: item.created_at || item.viewed_at || ''
                });
            }

            renderPostStats = window.renderPostStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var userMap = {};
                (Array.isArray(statAllPosts) ? statAllPosts : []).forEach(function(post) {
                    if (!post || !post.user_name) return;
                    if (!userMap[post.user_name]) userMap[post.user_name] = [];
                    userMap[post.user_name].push(post);
                });
                var entries = Object.keys(userMap).map(function(name) {
                    return [name, sortPosts(userMap[name] || [])];
                }).sort(function(a, b) {
                    return b[1].length - a[1].length;
                });
                if (!entries.length) {
                    body.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无动态记录</div>';
                    return;
                }
                body.innerHTML = entries.map(function(entry) {
                    var name = entry[0];
                    var posts = entry[1];
                    return [
                        '<section class="stat-user-group">',
                        '<div class="stat-user-header"><div class="suh-left"><div class="suh-avatar">' + escapeHtml(String(name).slice(0, 1).toUpperCase()) + '</div><span class="suh-name">' + escapeHtml(name) + '</span></div><span class="suh-count">' + posts.length + ' 条</span></div>',
                        '<div class="stat-user-posts">' + posts.slice(0, 3).map(function(post, index) { return renderPostItemHTML(post, index); }).join('') + '</div>',
                        (posts.length > 3 ? '<div style="padding-top:8px;"><button type="button" class="stat-view-btn" onclick="loadUserAllPosts(\'' + safeJsStr(name) + '\')">查看全部 ' + posts.length + ' 条</button></div>' : ''),
                        '</section>'
                    ].join('');
                }).join('');
            };

            window.loadUserAllPosts = function(userName) {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var userPosts = sortPosts((Array.isArray(statAllPosts) ? statAllPosts : []).filter(function(post) {
                    return post && post.user_name === userName;
                }));
                body.innerHTML = [
                    '<div class="stat-history-head"><button type="button" class="back-to-stats-btn" onclick="openStatDetail(\'posts\')">返回总动态</button></div>',
                    '<div class="stat-stack">' + userPosts.map(function(post, index) { return renderPostItemHTML(post, index); }).join('') + '</div>'
                ].join('');
            };

            renderViewStats = window.renderViewStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                var history = (Array.isArray(statViewEvents) ? statViewEvents : []).map(function(event) {
                    var detail = {};
                    try { detail = JSON.parse(event && event.content || '{}'); } catch (_) {}
                    return {
                        user_name: event && event.user_name,
                        post_id: detail.post_id || (event && event.media_url),
                        post_author: detail.post_author,
                        post_content: detail.post_content,
                        media_url: detail.media_url,
                        media_type: detail.media_type,
                        viewed_at: detail.viewed_at || (event && event.created_at)
                    };
                });
                if (!history.length) {
                    body.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无用户浏览记录</div>';
                    return;
                }
                body.innerHTML = history.map(function(item, index) {
                    var post = resolveStatRecordPost(item);
                    var viewerName = String(item.user_name || '').trim() || '未知用户';
                    var targetAuthor = String(item.post_author || (post && post.user_name) || '该用户').trim();
                    return renderStatRecordCard({
                        title: viewerName + ' 浏览了 ' + targetAuthor + ' 的帖子',
                        copy: String(item.post_content || getStatPostSummary(post)),
                        postId: post && post.id ? String(post.id) : '',
                        time: formatStatDateTime(item.viewed_at),
                        thumbHtml: getStatPostMediaHtml(post, post && post.id ? String(post.id) : ''),
                        enterStyle: ' style="--xtj-enter-delay:' + Math.min(index * 16, 160) + 'ms;"'
                    });
                }).join('');
            };

            renderLikeStats = window.renderLikeStats = function() {
                var body = document.getElementById('statModalBody');
                if (!body) return;
                function renderRecord(kind, item, index) {
                    var post = getStatPostById(item && item.post_id);
                    var copyText = kind === 'likes'
                        ? getStatPostSummary(post)
                        : '原帖：' + getStatPostSummary(post);
                    return renderStatRecordCard({
                        title: String(item.user_name || '匿名用户') + (kind === 'likes' ? ' 点赞了 ' : ' 评论了 ') + (post && post.user_name ? escapeHtml(post.user_name) : '某用户') + ' 的内容',
                        copy: copyText,
                        note: kind === 'comments' ? ('评论：' + String(item.content || '')) : '',
                        postId: post && post.id ? String(post.id) : '',
                        time: formatStatDateTime(item.created_at),
                        thumbHtml: getStatPostMediaHtml(post, post && post.id ? String(post.id) : ''),
                        enterStyle: ' style="--xtj-enter-delay:' + Math.min(index * 14, 160) + 'ms;"'
                    });
                }
                var likesHtml = statAllLikes.length
                    ? statAllLikes.map(function(item, index) { return renderRecord('likes', item, index); }).join('')
                    : '<div class="stat-empty" style="padding:12px 0;">暂无点赞记录</div>';
                var commentsHtml = statAllComments.length
                    ? statAllComments.slice().reverse().map(function(item, index) { return renderRecord('comments', item, index); }).join('')
                    : '<div class="stat-empty" style="padding:12px 0;">暂无评论记录</div>';
                body.innerHTML = '<div class="stat-two-col stat-two-col--bare"><section class="stat-col stat-col--bare"><div class="stat-section-title">点赞记录</div>' + likesHtml + '</section><section class="stat-col stat-col--bare"><div class="stat-section-title">评论记录</div>' + commentsHtml + '</section></div>';
            };

            window.switchReportView = typeof window.switchReportView === 'function' ? window.switchReportView : function(view) {
                var formBody = document.getElementById('reportModalFormBody');
                var recordsPanel = document.getElementById('reportRecordsPanel');
                if (formBody) formBody.style.display = view === 'records' ? 'none' : 'block';
                if (recordsPanel) recordsPanel.style.display = view === 'records' ? 'block' : 'none';
            };

            window.switchReportType = typeof window.switchReportType === 'function' ? window.switchReportType : function(type) {
                _reportType = type || 'post';
            };

            window.toggleReportRecords = typeof window.toggleReportRecords === 'function' ? window.toggleReportRecords : function() {
                if (typeof window.switchReportView === 'function') window.switchReportView('records');
            };

            window.selectReportReason = typeof window.selectReportReason === 'function' ? window.selectReportReason : function(btn) {
                document.querySelectorAll('.report-reason-btn').forEach(function(node) { node.classList.remove('selected'); });
                if (btn) btn.classList.add('selected');
                _reportSelectedReason = btn ? String(btn.dataset.reason || btn.textContent || '') : null;
                var submitBtn = document.getElementById('reportSubmitBtn');
                if (submitBtn) submitBtn.disabled = false;
            };

            window.submitReport = typeof window.submitReport === 'function' ? window.submitReport : function() {
                showToast('举报功能暂不可用，请稍后重试');
            };


        })();

        (function installFinalUiAndDataOverrides() {
            if (window.__xtjFinalUiOverridesV1) return;
            window.__xtjFinalUiOverridesV1 = true;
            var ANN_CACHE_KEY = "xtj_announcements_cache_v1";
            var ANN_CACHE_DURATION = 3 * 60 * 1000;

            function sleep(ms) {
                return new Promise(function(resolve) { setTimeout(resolve, ms); });
            }

            function readFeedSnapshotCache() {
                try {
                    var raw = window.safeStorage.get(CACHE_KEY);
                    if (!raw) return null;
                    var parsed = JSON.parse(raw);
                    return normalizeFeedSnapshotCache(parsed);
                } catch (e) {
                    return null;
                }
            }

            function readAnnouncementCache() {
                try {
                    var raw = window.safeStorage.get(ANN_CACHE_KEY);
                    if (!raw) return null;
                    var parsed = JSON.parse(raw);
                    if (!parsed || !Array.isArray(parsed.data)) return null;
                    return parsed;
                } catch (e) {
                    return null;
                }
            }

            function writeAnnouncementCache(items) {
                try {
                    localStorage.setItem(ANN_CACHE_KEY, JSON.stringify({
                        data: Array.isArray(items) ? items : [],
                        timestamp: Date.now()
                    }));
                } catch (e) {}
            }

            function applyStatSnapshot(posts, comments, likes, viewEvents) {
                var visiblePosts = normalizePosts(Array.isArray(posts) ? posts : []).filter(function(p) {
                    return p && !isSystemPost(p) && canViewPost(p);
                });
                var visiblePostIds = new Set(visiblePosts.map(function(p) { return String(p.id); }));
                statAllPosts = visiblePosts;
                statAllComments = (Array.isArray(comments) ? comments : []).filter(function(c) {
                    return c && visiblePostIds.has(String(c.post_id));
                });
                statAllLikes = (Array.isArray(likes) ? likes : []).filter(function(l) {
                    return l && visiblePostIds.has(String(l.post_id));
                });
                if (Array.isArray(viewEvents)) {
                    // 本人过滤：仅保留"他人浏览了我（当前用户）的帖子"的记录，
                    // 避免泄露全站任意用户间的浏览关系（post_author 存于 content JSON）。
                    var me = String(window.currentUser || '').trim();
                    statViewEvents = viewEvents.filter(function(event) {
                        if (!event) return false;
                        if (!visiblePostIds.has(String(event.media_url))) return false;
                        if (!me) return false; // 未登录时不展示任何浏览记录
                        var author = '';
                        try {
                            var parsed = JSON.parse(String(event.content || '{}'));
                            if (parsed && typeof parsed === 'object') author = String(parsed.post_author || '').trim();
                        } catch (e) {}
                        if (author) return author === me;
                        // content 缺失时按帖子归属兜底
                        var owner = postInfoCache && postInfoCache[String(event.media_url)] && postInfoCache[String(event.media_url)].user_name;
                        return owner ? String(owner) === me : false;
                    });
                }
                var postsCountEl = document.getElementById('sPosts');
                var viewsCountEl = document.getElementById('sViews');
                var likesCountEl = document.getElementById('sLikes');
                if (postsCountEl) postsCountEl.textContent = String(visiblePosts.length);
                if (viewsCountEl) viewsCountEl.textContent = String(statViewEvents.length);
                // 只显示点赞数，不再把评论混进"总点赞"
                if (likesCountEl) likesCountEl.textContent = String(statAllLikes.length);
                statCacheTime = Date.now();
            }

            var statRequestId = 0;
            var statDataPromise = null;

            function hasUsableStatCache() {
                return statCacheTime > 0 && (Date.now() - statCacheTime < STAT_CACHE_DURATION);
            }

            async function ensureStatDataLoaded(force) {
                if (!force && hasUsableStatCache()) {
                    return {
                        posts: statAllPosts,
                        comments: statAllComments,
                        likes: statAllLikes,
                        view_events: statViewEvents
                    };
                }
                if (!force && statDataPromise) return statDataPromise;
                statDataPromise = fetchStatSnapshotWithTimeout(5000).then(function(snapshot) {
                    if (snapshot) {
                        applyStatSnapshot(snapshot.posts, snapshot.comments, snapshot.likes, snapshot.view_events);
                    }
                    return snapshot;
                }).finally(function() {
                    statDataPromise = null;
                });
                return statDataPromise;
            }

            function syncHeaderModalBodyLock() {
                var activeIds = ['announcementModal', 'reportModal', 'reportHistoryModal', 'statModal'];
                var hasActive = activeIds.some(function(id) {
                    var el = document.getElementById(id);
                    return !!(el && el.classList.contains('active'));
                });
                document.body.style.overflow = hasActive ? 'hidden' : '';
            }

            function renderStatByTypeFinal(type) {
                if (type === 'posts') {
                    if (typeof renderPostStats === 'function') renderPostStats();
                    return;
                }
                if (type === 'views') {
                    if (typeof renderViewStats === 'function') renderViewStats();
                    return;
                }
                if (type === 'likes') {
                    if (typeof renderLikeStats === 'function') renderLikeStats();
                }
            }

            function setAnnouncementModalToListMode() {
                currentAnnouncementTab = 'announcements';
                document.querySelectorAll('.announcement-tab').forEach(function(tab) {
                    tab.classList.toggle('active', tab.dataset.tab === 'announcements');
                });
                var adminArea = document.getElementById('announcementAdminArea');
                var listContainer = document.getElementById('announcementListContainer');
                var detail = document.getElementById('announcementDetail');
                var changelog = document.getElementById('changelogContainer');
                var list = document.getElementById('announcementList');
                if (adminArea) adminArea.style.display = isAdmin() ? 'block' : 'none';
                if (listContainer) listContainer.style.display = 'block';
                if (detail) {
                    detail.classList.remove('active');
                    detail.style.display = 'none';
                }
                if (changelog) changelog.style.display = 'none';
                if (list && !String(list.innerHTML || '').trim()) {
                    list.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无公告</div>';
                }
            }

            refreshStatModal = window.refreshStatModal = function() {
                var modal = document.getElementById('statModal');
                if (!modal || !modal.classList.contains('active') || !statCurrentType) return;
                var sourcePosts = Array.isArray(feedAllPosts) && feedAllPosts.length ? feedAllPosts : statAllPosts;
                var sourceComments = Array.isArray(feedAllComments) && feedAllComments.length ? feedAllComments : statAllComments;
                var sourceLikes = Array.isArray(feedAllLikes) && feedAllLikes.length ? feedAllLikes : statAllLikes;
                if (sourcePosts.length || sourceComments.length || sourceLikes.length) {
                    applyStatSnapshot(sourcePosts, sourceComments, sourceLikes);
                }
                renderStatByTypeFinal(statCurrentType);
                ensureStatDataLoaded(false).then(function(snapshot) {
                    if (!snapshot || !modal.classList.contains('active') || !statCurrentType) return;
                    applyStatSnapshot(snapshot.posts, snapshot.comments, snapshot.likes, snapshot.view_events);
                    renderStatByTypeFinal(statCurrentType);
                }).catch(function() {});
            };

            window.prefetchStatData = function() {
                return ensureStatDataLoaded(false).catch(function() { return null; });
            };

            async function fetchStatSnapshotWithTimeout(timeoutMs) {
                var timeout = new Promise(function(resolve) {
                    setTimeout(function() { resolve(null); }, timeoutMs);
                });
                var request = window.xtjProtectedFetch('/api/stats/snapshot?limit=1000')
                .then(function(response) {
                    return response.json().then(function(result) {
                        if (!response.ok || !result.ok) throw new Error(result.error || '统计加载失败');
                        return {
                            posts: result.posts || [],
                            comments: result.comments || [],
                            likes: result.likes || [],
                            view_events: result.view_events || [],
                            totals: result.totals || {}
                        };
                    });
                }).catch(function() {
                    return null;
                });
                return Promise.race([request, timeout]);
            }

            window.openAnnouncementModal = function() {
                var overlay = document.getElementById('announcementModal');
                if (!overlay) return;
                var list = document.getElementById('announcementList');
                overlay.classList.add('active');
                setAnnouncementModalToListMode();
                syncHeaderModalBodyLock();
                // 立即标记已加载的公告为已读（用稳定 ID）
                // 即使 loadAnnouncements 后续重新拉取也会再次 mark
                try {
                    if (announcements && announcements.length) {
                        var preIds = announcements.map(window.getAnnouncementId).filter(Boolean);
                        if (preIds.length) window.markAnnouncementsRead(preIds);
                    }
                } catch (_) {}
                try {
                    if (typeof loadAnnouncements === 'function') {
                        Promise.resolve(loadAnnouncements()).then(function() {
                            if (typeof renderAnnouncementList === 'function') {
                                renderAnnouncementList();
                                // 重新拉取后再次标记
                                if (announcements && announcements.length) {
                                    var postIds = announcements.map(window.getAnnouncementId).filter(Boolean);
                                    if (postIds.length) window.markAnnouncementsRead(postIds);
                                }
                            } else if (list && !String(list.innerHTML || '').trim()) {
                                list.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无公告</div>';
                            }
                        }).catch(function() {
                            if (list && !String(list.innerHTML || '').trim()) {
                                list.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无公告</div>';
                            }
                        });
                    }
                } catch (_) {
                    if (list && !String(list.innerHTML || '').trim()) {
                        list.innerHTML = '<div class="stat-empty" style="padding:12px 0;">暂无公告</div>';
                    }
                }
            };

            window.closeAnnouncementModal = function() {
                var overlay = document.getElementById('announcementModal');
                if (!overlay) return;
                overlay.classList.remove('active');
                syncHeaderModalBodyLock();
            };


            renderChatLoadingState = function(el, options) {
                if (!el) return;
                var title = options && options.title ? options.title : '加载中..';
                var subtitle = options && options.subtitle ? options.subtitle : '';
                var variant = options && options.variant ? String(options.variant) : '';
                el.classList.add('xtj-chat-photo-loading');
                el.innerHTML = window.__xtjSharedPhotoLoaderHtml || getXtjLoadingHtml(title, subtitle, variant.indexOf('chat') === -1 ? 'chat-list' : variant);
            };

            (function installChatPhotoLoaderFinal() {
                if (window.__xtjChatPhotoLoaderFinalV1) return;
                window.__xtjChatPhotoLoaderFinalV1 = true;
                var originalMagicLoader = window.xtjMagicLoadingHtml;
                window.__xtjSharedPhotoLoaderHtml = window.__xtjSharedPhotoLoaderHtml || (window.__xtjSkeletonCardHtml ? window.__xtjSkeletonCardHtml(true) : '');
                window.xtjMagicLoadingHtml = function(title, subtitle, variant) {
                    var mode = String(variant || '');
                    if (mode.indexOf('chat') !== -1 || /聊天|消息/.test(String(title || '') + String(subtitle || ''))) {
                        return window.__xtjSharedPhotoLoaderHtml;
                    }
                    return originalMagicLoader ? originalMagicLoader.apply(this, arguments) : '';
                };
            })();

            (function installButtonMotionFinal() {
                if (window.__xtjButtonMotionFinalV1) return;
                window.__xtjButtonMotionFinalV1 = true;
                var selector = '.user-filter-btn,.search-toggle,.filter-toggle';
                var gsapCache = false;

                function isDock(target) {
                    return !!(target && target.closest && target.closest('#dockBar, .dock-bar, .dock-tab'));
                }

                document.addEventListener('click', function(event) {
                    if (gsapCache === false) gsapCache = typeof window.gsap !== 'undefined';
                    var target = event.target;
                    if (!target) return;
                    var btn = target.closest(selector);
                    if (!btn) return;
                    if (isDock(btn)) return;

                    if (gsapCache) {
                        var icon = btn.querySelector('svg, img, i');
                        if (icon) {
                            gsap.fromTo(icon, {scale:1}, {scale:1.18, duration:0.16, ease:'back.out(2.5)', clearProps:'scale'});
                        }
                    } else {
                        btn.style.transform = 'scale(0.96)';
                        window.setTimeout(function(){btn.style.transform='';}, 120);
                    }
                }, true);

                document.addEventListener('pointerdown', function(event) {
                    var target = event.target;
                    if (!target || isDock(target)) return;
                    if (target.closest('button:not(.dock-tab),[role="button"]:not(.dock-tab),.action-btn,.send-btn,.chat-img-btn,.photo-wall-btn,.file-label')) {
                        target.style.transition = 'transform 0.12s ease';
                        target.style.transform = 'scale(0.96)';
                    }
                }, true);

                document.addEventListener('pointerup', function(event) {
                    var target = event.target;
                    if (!target) return;
                    if (target.style.transform) {
                        target.style.transition = 'transform 0.25s cubic-bezier(.34,1.4,.64,1)';
                        target.style.transform = 'scale(1)';
                        window.setTimeout(function(){target.style.transition='';target.style.transform='';}, 280);
                    }
                }, true);

                document.addEventListener('pointercancel', function(event) {
                    var target = event.target;
                    if (!target) return;
                    target.style.transform = '';
                    target.style.transition = '';
                }, true);
            })();

            renderPostFilterUserLoader = function() {
                return '<div class="xtj-magic-loading" style="display:flex;align-items:center;justify-content:center;min-height:140px;padding:16px 0;"><div class="xtj-loading-skeleton" style="width:100%"><div class="xtj-skeleton-card"><div class="xtj-skeleton-header"><div class="xtj-skeleton-avatar"></div><div class="xtj-skeleton-lines"><div class="xtj-skeleton-line medium"></div><div class="xtj-skeleton-line short"></div></div></div><div class="xtj-skeleton-body"><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line"></div><div class="xtj-skeleton-line short"></div></div></div></div></div>';
            };

            window.openStatDetail = async function(type) {
                if (['posts', 'views', 'likes'].indexOf(type) === -1) return;
                statCurrentType = type;
                var requestId = ++statRequestId;
                var titles = {
                    posts: '总动态',
                    views: '总浏览',
                    likes: '点赞和评论'
                };
                var title = document.getElementById('statModalTitle');
                var body = document.getElementById('statModalBody');
                var modal = document.getElementById('statModal');
                if (title) title.textContent = titles[type] || '统计详情';
                if (modal && !modal.classList.contains('active')) modal.classList.add('active');
                syncHeaderModalBodyLock();
                if (body) body.innerHTML = getXtjLoadingHtml('加载中..', '', 'feed');
                // 全面清除GSAP残留在弹窗上的内联样式，并杀死正在运行的GSAP动画
                var box = modal ? modal.querySelector('.stat-detail-modal') : null;
                if (box) {
                    if (typeof gsap !== 'undefined' && gsap.killTweensOf) {
                        gsap.killTweensOf(box);
                        gsap.set(box, { y: 0, scale: 1, opacity: 1, filter: 'blur(0px)', clearProps: 'filter' });
                    }
                    box.style.transform = ''; box.style.opacity = ''; box.style.filter = '';
                    box.style.translate = ''; box.style.scale = ''; box.style.rotate = '';
                }
                if (modal) {
                    if (typeof gsap !== 'undefined' && gsap.killTweensOf) {
                        gsap.killTweensOf(modal);
                        gsap.set(modal, { backdropFilter: '', backgroundColor: '' });
                    }
                    modal.style.backdropFilter = ''; modal.style.backgroundColor = '';
                }

                var sourcePosts = Array.isArray(feedAllPosts) && feedAllPosts.length ? feedAllPosts : statAllPosts;
                var sourceComments = Array.isArray(feedAllComments) && feedAllComments.length ? feedAllComments : statAllComments;
                var sourceLikes = Array.isArray(feedAllLikes) && feedAllLikes.length ? feedAllLikes : statAllLikes;
                if (statPollTimer) {
                    clearInterval(statPollTimer);
                    statPollTimer = null;
                }

                if (sourcePosts.length || sourceComments.length || sourceLikes.length) {
                    applyStatSnapshot(sourcePosts, sourceComments, sourceLikes);
                    if (requestId !== statRequestId) return;
                    renderStatByTypeFinal(type);
                    ensureStatDataLoaded(false).then(function(snapshot) {
                        if (!snapshot || !modal || !modal.classList.contains('active') || statCurrentType !== type || requestId !== statRequestId) return;
                        applyStatSnapshot(snapshot.posts, snapshot.comments, snapshot.likes);
                        renderStatByTypeFinal(type);
                    }).catch(function() {});
                    return;
                }

                var snapshot = await ensureStatDataLoaded(true);
                if (!modal || !modal.classList.contains('active') || statCurrentType !== type || requestId !== statRequestId) return;
                if (snapshot) {
                    applyStatSnapshot(snapshot.posts, snapshot.comments, snapshot.likes);
                    renderStatByTypeFinal(type);
                } else if (body) {
                    body.innerHTML = '<div class="stat-empty">加载失败，请重试</div>';
                }
            };

            var originalInitialLoad = initialLoad;
            initialLoad = async function(skipCache) {
                var usedFastSnapshot = false;
                if (!skipCache) {
                    if (Array.isArray(feedAllPosts) && feedAllPosts.length) {
                        usedFastSnapshot = true;
                        await renderFeed({
                            posts: feedAllPosts,
                            comments: feedAllComments || [],
                            likes: feedAllLikes || []
                        });
                    } else {
                        var cachedFeed = readFeedSnapshotCache();
                        if (cachedFeed && cachedFeed.data) {
                            usedFastSnapshot = hydrateFeedStateFromSnapshot(cachedFeed);
                            if (usedFastSnapshot) {
                                await renderFeed({
                                    posts: feedAllPosts,
                                    comments: feedAllComments,
                                    likes: feedAllLikes
                                });
                            }
                        }
                    }
                }
                queueDeferredStartupTasks();
                if (!usedFastSnapshot || skipCache) {
                    return originalInitialLoad.call(this, skipCache);
                }
                await loadFeed(true);
            };
            window.initialLoad = initialLoad;

            var originalLoadAnnouncements = loadAnnouncements;
            loadAnnouncements = async function() {
                var listEl = document.getElementById('announcementList');
                var cachedAnnouncements = readAnnouncementCache();
                if (cachedAnnouncements && cachedAnnouncements.data.length && Date.now() - cachedAnnouncements.timestamp < ANN_CACHE_DURATION) {
                    announcements = cachedAnnouncements.data;
                    updateAnnouncementBadge();
                    if (listEl && !listEl.children.length) {
                        renderAnnouncementList();
                    }
                }
                try {
                    await originalLoadAnnouncements.apply(this, arguments);
                    writeAnnouncementCache(announcements || []);
                    if (listEl && announcements && announcements.length) {
                        renderAnnouncementList();
                    }
                } catch (e) {
                    if (cachedAnnouncements && cachedAnnouncements.data.length) {
                        announcements = cachedAnnouncements.data;
                        updateAnnouncementBadge();
                        if (listEl) renderAnnouncementList();
                        return;
                    }
                    throw e;
                }
            };
            
            // Add sticky header behavior and class
            var _navHeader = document.querySelector('.posts-nav');
            if (_navHeader) _navHeader.classList.add('sticky-header');
            
            var _panelPosts = document.getElementById('panelPosts');
            var _scrollTarget = _panelPosts || window;
            _scrollTarget.addEventListener('scroll', window.throttleRAF(function() {
                var header = document.querySelector('.posts-nav.sticky-header');
                if (!header) return;
                var currentScrollY = _scrollTarget.scrollTop || window.scrollY;
                if (typeof window._lastHeaderScrollY === 'undefined') window._lastHeaderScrollY = 0;
                if (currentScrollY > 50 && currentScrollY > window._lastHeaderScrollY) {
                    header.classList.add('hidden-header');
                } else {
                    header.classList.remove('hidden-header');
                }
                window._lastHeaderScrollY = currentScrollY;
            }));
            
        })();
