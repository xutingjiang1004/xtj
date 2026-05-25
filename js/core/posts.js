(function() {
    var delPostId = null, delOwnerKey = null;
    var activePostId = null;
    var viewTracked = new Set();
    var CACHE_KEY = "xtj_feed_cache";
    var CACHE_DURATION = 5 * 60 * 1000;
    var postInfoCache = {};
    var VIEW_HISTORY_KEY = 'xtj_view_history';

    var feedPage = 0;
    var FEED_PAGE_SIZE = 20;
    var feedEndReached = false;
    var feedAllPosts = [];
    var feedAllComments = [];
    var feedAllLikes = [];
    var feedScrollObserver = null;

    var statCurrentType = null;
    var statAllPosts = [];
    var statAllComments = [];
    var statAllLikes = [];
    var statPollTimer = null;
    var statCacheTime = 0;
    var STAT_CACHE_DURATION = 30000;

    window.CACHE_KEY = CACHE_KEY;

    function getViewHistory() {
        try {
            return window.safeLocalStorageGetJSON(VIEW_HISTORY_KEY, []);
        } catch(e) { return []; }
    }

    function saveViewHistory(entry) {
        var history = getViewHistory();
        var exists = history.some(function(h) { return h.post_id === entry.post_id && h.user_name === entry.user_name; });
        if (!exists) {
            history.unshift(entry);
            if (history.length > 500) history.length = 500;
            localStorage.setItem(VIEW_HISTORY_KEY, JSON.stringify(history));
        }
    }

    function trackView(postId) {
        var key = 'xtj_v_' + postId;
        if (!localStorage.getItem(key) && !viewTracked.has(postId)) {
            viewTracked.add(postId);
            localStorage.setItem(key, "1");
            var postEl = document.querySelector('.post[data-post-id="' + postId + '"]');
            if (postEl) {
                var statsEl = postEl.querySelector('.post-stats-text');
                if (statsEl) {
                    var vm = statsEl.textContent.match(/浏览 (\d+)/);
                    if (vm) {
                        var newVal = parseInt(vm[1]) + 1;
                        statsEl.innerHTML = statsEl.innerHTML.replace(/浏览 \d+/, '浏览 ' + newVal);
                    }
                }
            }
            if (window.currentUser && postInfoCache[postId]) {
                var rawContent = postInfoCache[postId].content || '';
                saveViewHistory({
                    user_name: window.currentUser,
                    post_id: postId,
                    post_content: rawContent.length > 200 ? rawContent.slice(0, 200) + '...' : (rawContent || '(图片/视频)'),
                    post_author: postInfoCache[postId].user_name || '未知',
                    viewed_at: new Date().toISOString()
                });
            }
            setTimeout(async function() {
                try {
                    await window.sb.rpc("increment_post_views", { p_post_id: postId });
                } catch(e) { console.error(e); }
            }, 1000);
            updateFeedStats();
        }
    }

    function createHeartParticles(btn) {
        var rect = btn.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var emojis = ["❤️","💕","💗","✨","💖","💓"];
        for (var i = 0; i < 8; i++) {
            var heart = document.createElement('div');
            heart.className = 'heart-particle';
            heart.textContent = emojis[Math.floor(Math.random() * emojis.length)];
            var angle = (Math.PI * 2 * i / 8) + (Math.random() - 0.5) * 0.4;
            var dist1 = 30 + Math.random() * 20;
            var dist2 = 55 + Math.random() * 40;
            var dist3 = 80 + Math.random() * 50;
            heart.style.left = cx + 'px';
            heart.style.top = cy + 'px';
            heart.style.setProperty('--tx25', Math.cos(angle) * dist1 + 'px');
            heart.style.setProperty('--ty25', Math.sin(angle) * dist1 + 'px');
            heart.style.setProperty('--tx60', Math.cos(angle) * dist2 + 'px');
            heart.style.setProperty('--ty60', Math.sin(angle) * dist2 + 'px');
            heart.style.setProperty('--tx', Math.cos(angle) * dist3 + 'px');
            heart.style.setProperty('--ty', Math.sin(angle) * dist3 + 'px');
            heart.style.animationDelay = (Math.random() * 0.12) + 's';
            document.body.appendChild(heart);
            setTimeout(function() { heart.remove(); }, 1200);
        }
    }
    window.createHeartParticles = createHeartParticles;

    window.doPublish = async function() {
        if (!window.currentUser) { window.showToast("请先登录"); return; }
        var content = document.getElementById("postInp").value.trim();
        var file = document.getElementById("fileInp").files[0];
        if (!content && !file) { window.showToast("请输入内容"); return; }
        if (content.length > 2000) { window.showToast("内容不能超过2000字"); return; }
        var btn = document.getElementById("pubBtn");
        btn.disabled = true;
        btn.textContent = "发布中...";
        try {
            var media_url = "", media_type = "";
            if (file) {
                var path = Date.now() + '_' + file.name;
                await window.sb.storage.from("uploads").upload(path, file);
                media_url = window.sb.storage.from("uploads").getPublicUrl(path).data.publicUrl;
                media_type = file.type.startsWith("image") ? "image" : "video";
            }
            var insertResult = await window.sb.from("posts").insert([{
                user_name: window.currentUser,
                content: window.safeText(content).slice(0, 2000),
                media_url: media_url,
                media_type: media_type,
                actor_key: window.deviceId
            }]);
            if (insertResult.error) {
                window.showToast("发布失败: " + (insertResult.error.message || "未知错误"));
                btn.disabled = false;
                btn.textContent = "发布动态";
                return;
            }
            document.getElementById("postInp").value = "";
            document.getElementById("fileInp").value = "";
            window.showToast("发布成功！");
            loadFeed(true);
        } catch(e) {
            window.showToast("发布失败: " + (e.message || "网络错误"));
        } finally {
            btn.disabled = false;
            btn.textContent = "发布动态";
        }
    };

    window.toggleLike = async function(btn, postId) {
        if (!window.currentUser) { window.showToast("请先登录"); return; }
        var isLiked = btn.classList.contains("liked");
        var statsText = btn.closest('.post').querySelector('.post-stats-text');

        if (isLiked) {
            btn.classList.remove("liked");
        } else {
            btn.classList.add("liked");
            window.createHeartParticles(btn);
        }
        btn.textContent = isLiked ? "点赞" : "❤️";

        try {
            if (isLiked) {
                await window.sb.from("likes").delete().eq("post_id", postId).eq("actor_key", window.deviceId);
            } else {
                await window.sb.from("likes").insert([{ post_id: postId, user_name: window.currentUser, actor_key: window.deviceId }]);
            }
            var match = statsText.textContent.match(/点赞 (\d+)/);
            if (match) {
                var num = parseInt(match[1]);
                statsText.innerHTML = statsText.innerHTML.replace(/点赞 \d+/, '点赞 ' + (isLiked ? num - 1 : num + 1));
            }
            updateFeedStats();
            refreshStatModal();
        } catch(e) { console.error(e); }
    };

    window.openComment = function(postId) {
        if (!window.currentUser) { window.showToast("请先登录"); return; }
        activePostId = postId;
        document.getElementById("commInp").value = "";
        document.getElementById("commentModal").classList.add("active");
        setTimeout(function() { document.getElementById("commInp").focus(); }, 100);
    };

    document.getElementById("commBtn").onclick = async function() {
        var content = document.getElementById("commInp").value.trim();
        if (!content) { window.showToast("请输入评论内容"); return; }
        var btn = document.getElementById("commBtn");
        btn.textContent = "提交中...";
        btn.disabled = true;
        try {
            var result = await window.sb.from("comments").insert([{
                post_id: activePostId,
                user_name: window.currentUser,
                content: content,
                actor_key: window.deviceId
            }]);
            if (result.error) throw result.error;
            window.closeModal("commentModal");
            window.showToast("评论成功！");
            var scrollEl = document.getElementById('panelPosts');
            var savedScroll = scrollEl ? scrollEl.scrollTop : 0;
            await loadFeed(true);
            requestAnimationFrame(function() {
                var p = document.getElementById('panelPosts');
                if (p && savedScroll > 0) p.scrollTop = savedScroll;
                var postEl = document.querySelector('.post[data-post-id="' + activePostId + '"]');
                if (postEl) postEl.classList.add('visible');
            });
        } catch(e) {
            window.showToast("评论失败: " + (e.message || "未知错误"));
            console.error(e);
        } finally {
            btn.textContent = "发布评论";
            btn.disabled = false;
        }
    };

    window.openDelete = function(postId, ownerKey) {
        delPostId = postId;
        delOwnerKey = ownerKey;
        document.getElementById("delModal").classList.add("active");
    };

    document.getElementById("delBtn").onclick = async function() {
        if (!delPostId) return;
        var btn = document.getElementById("delBtn");
        btn.disabled = true;
        btn.textContent = "删除中...";
        try {
            var key = window.isAdmin() ? delOwnerKey : window.deviceId;
            var result = await window.sb.rpc("delete_post_with_actor", {
                p_post_id: delPostId,
                p_actor_key: key
            });
            if (result.error) {
                window.showToast("删除失败：" + result.error.message);
                return;
            }
            window.closeModal("delModal");
            window.showToast("帖子已删除");
            delPostId = null;
            await loadFeed(true);
        } catch(e) {
            window.showToast("删除帖子失败");
            console.error(e);
        } finally {
            btn.disabled = false;
            btn.textContent = "确认删除";
        }
    };

    async function loadFeed(forceRefresh) {
        if (forceRefresh === undefined) forceRefresh = false;
        var now = Date.now();
        if (forceRefresh) {
            feedPage = 0;
            feedEndReached = false;
            feedAllPosts = [];
            feedAllComments = [];
            feedAllLikes = [];
        }
        if (!forceRefresh) {
            var cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                try {
                    var parsed = JSON.parse(cached);
                    if (parsed && parsed.data && now - parsed.timestamp < CACHE_DURATION) {
                        feedAllPosts = parsed.data.posts || [];
                        feedAllComments = parsed.data.comments || [];
                        feedAllLikes = parsed.data.likes || [];
                        await renderFeed(parsed.data);
                        setupFeedInfiniteScroll();
                        return;
                    }
                } catch(e) {}
            }
        }
        var feed = document.getElementById("feed");
        if (!forceRefresh) feed.innerHTML = '<div class="loading"><div class="loading-spinner"></div><span class="loading-text">加载中...</span></div>';
        try {
            var results = await Promise.all([
                window.sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }),
                window.sb.from("comments").select("*").order("created_at"),
                window.sb.from("likes").select("*")
            ]);
            var postRes = results[0], commRes = results[1], likeRes = results[2];
            if (postRes.error || commRes.error || likeRes.error) {
                var errMsg = (postRes.error || commRes.error || likeRes.error).message || '数据加载失败';
                feed.innerHTML = '<div class="loading" style="color:#ff3b60;">加载失败: ' + errMsg + '</div>';
                return;
            }
            var data = { posts: postRes.data || [], comments: commRes.data || [], likes: likeRes.data || [] };
            feedAllPosts = data.posts;
            feedAllComments = data.comments;
            feedAllLikes = data.likes;
            var cachePosts = data.posts.filter(function(p) {
                return p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__';
            });
            localStorage.setItem(CACHE_KEY, JSON.stringify({ data: { posts: cachePosts, comments: data.comments, likes: data.likes }, timestamp: now }));
            await renderFeed(data);
            setupFeedInfiniteScroll();
        } catch(e) {
            feed.innerHTML = '<div class="loading" style="color:#ff3b60;">加载失败，刷新重试</div>';
            console.error(e);
        }
    }
    window.loadFeed = loadFeed;

    function setupFeedInfiniteScroll() {
        if (feedScrollObserver) feedScrollObserver.disconnect();
        var feed = document.getElementById('feed');
        var observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting && !feedEndReached) {
                    loadMoreFeedPosts();
                }
            });
        }, { rootMargin: '200px' });
        var sentinel = document.getElementById('feedSentinel');
        if (!sentinel) {
            sentinel = document.createElement('div');
            sentinel.id = 'feedSentinel';
            sentinel.style.height = '1px';
            feed.appendChild(sentinel);
        }
        observer.observe(sentinel);
        feedScrollObserver = observer;
    }

    function loadMoreFeedPosts() {
        if (feedEndReached) return;
        var feed = document.getElementById('feed');
        var visiblePosts = feedAllPosts.filter(function(p) {
            return p.media_type !== window.AUTH_MARKER && p.media_type !== window.DM_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__ann__' && p.user_name;
        });
        var startIdx = feedPage * FEED_PAGE_SIZE;
        var endIdx = startIdx + FEED_PAGE_SIZE;
        if (startIdx >= visiblePosts.length) {
            feedEndReached = true;
            var noMore = document.getElementById('feedNoMore');
            if (!noMore) {
                noMore = document.createElement('div');
                noMore.id = 'feedNoMore';
                noMore.className = 'loading';
                noMore.textContent = '没有更多了';
                noMore.style.padding = '30px';
                noMore.style.textAlign = 'center';
                feed.appendChild(noMore);
            }
            return;
        }
        var nextPosts = visiblePosts.slice(startIdx, endIdx);
        appendMorePosts(nextPosts, feedAllComments, feedAllLikes);
        feedPage++;
    }

    function appendMorePosts(posts, comments, likes) {
        var feed = document.getElementById('feed');
        var maps = buildPostMaps(comments, likes);
        var commentMap = maps.commentMap, likeMap = maps.likeMap, likeUserMap = maps.likeUserMap;

        var postsHtml = posts.map(function(p) {
            var pLikes = likeMap[p.id] || [];
            var pComms = commentMap[p.id] || [];
            var isLiked = likeUserMap[p.id + '|' + window.deviceId];
            var canDelPost = p.actor_key === window.deviceId || p.actor_key === window.currentUser || window.isAdmin();
            trackView(p.id);
            return '<div class="post glass" data-post-id="' + window.escapeHtml(p.id) + '">' +
                '<div class="post-header">' +
                    getAvatarHtml(p.user_name) +
                    '<div class="user-info">' +
                        '<span class="user-name">' + window.escapeHtml(p.user_name) + '</span>' +
                        '<span class="post-time">' + new Date(p.created_at).toLocaleString() + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="content">' + window.escapeHtml(p.content) + '</div>' +
                (p.media_url ? '<div class="media">' + (p.media_type === 'video' ? '<video src="' + window.escapeHtml(p.media_url) + '" controls preload="none"></video>' : '<img src="' + window.escapeHtml(p.media_url) + '" loading="lazy" onclick="openImageViewer(\'' + window.escapeHtml(p.media_url).replace(/'/g, "\\'") + '\')">') + '</div>' : '') +
                '<div class="post-stats-text">浏览 ' + (p.views || 0) + ' · 点赞 ' + pLikes.length + ' · 评论 ' + pComms.length + '</div>' +
                '<div class="actions">' +
                    '<button class="action-btn' + (isLiked ? ' liked' : '') + '" onclick="toggleLike(this, \'' + window.escapeHtml(p.id).replace(/'/g, "\\'") + '\')">' + (isLiked ? '❤️' : '点赞') + '</button>' +
                    '<button class="action-btn" onclick="openComment(\'' + window.escapeHtml(p.id).replace(/'/g, "\\'") + '\')">评论</button>' +
                    (canDelPost ? '<button type="button" class="action-btn del" onclick="openDelete(\'' + window.escapeHtml(p.id).replace(/'/g, "\\'") + '\', \'' + window.escapeHtml(p.actor_key).replace(/'/g, "\\'") + '\')">删除</button>' : '') +
                    '<button class="action-btn report-btn" style="margin-left:auto;" onclick="window.openReport&&window.openReport(\'post\',\'' + window.escapeHtml(p.id).replace(/'/g, "\\'") + '\',\'' + window.escapeHtml(p.user_name).replace(/'/g, "\\'") + '\')">举报</button>' +
                '</div>' +
                (pComms.length ? '<div class="comments">' + pComms.map(function(c) {
                    return '<div class="comment-item" data-comment-id="' + window.escapeHtml(c.id) + '"><div><b>' + window.escapeHtml(c.user_name) + ':</b> ' + window.escapeHtml(c.content) + '</div></div>';
                }).join('') + '</div>' : '') +
            '</div>';
        }).join('');

        var sentinel = document.getElementById('feedSentinel');
        var tempContainer = document.createElement('div');
        tempContainer.innerHTML = postsHtml;
        while (tempContainer.firstChild) {
            feed.insertBefore(tempContainer.firstChild, sentinel);
        }
        var newPosts = feed.querySelectorAll('.post:not(.visible)');
        var observer = new IntersectionObserver(function(e) {
            e.forEach(function(i) {
                if (i.isIntersecting) {
                    i.target.classList.add('visible');
                }
            });
        }, { threshold: 0.05 });
        newPosts.forEach(function(p) { observer.observe(p); });
        updateFeedStats();
    }

    async function renderFeed(data) {
        var posts = data.posts, comments = data.comments, likes = data.likes;
        var visiblePosts = posts.filter(function(p) {
            return p.media_type !== window.AUTH_MARKER && p.media_type !== window.DM_MARKER && p.media_type !== '__avatar__' && p.media_type !== '__user_info__' && p.media_type !== '__photo_wall__' && p.media_type !== '__ann__' && p.user_name;
        });
        document.getElementById("sPosts").textContent = visiblePosts.length;
        document.getElementById("sViews").textContent = visiblePosts.reduce(function(s, p) { return s + (p.views || 0); }, 0);
        document.getElementById("sLikes").textContent = likes.length + comments.length;

        visiblePosts.forEach(function(p) {
            postInfoCache[p.id] = { content: p.content, user_name: p.user_name };
        });

        var allUsers = new Set();
        visiblePosts.forEach(function(p) { allUsers.add(p.user_name); });
        comments.forEach(function(c) { allUsers.add(c.user_name); });

        await loadAvatarsForUsers(Array.from(allUsers));

        var firstPage = visiblePosts.slice(0, FEED_PAGE_SIZE);
        feedPage = 1;
        renderFeedWithAvatars(firstPage, comments, likes);

        setTimeout(function() { window.prefetchStatData(); }, 1000);
    }
    window.renderFeed = renderFeed;

    function buildPostMaps(comments, likes) {
        var commentMap = {};
        var likeMap = {};
        var likeUserMap = {};
        comments.forEach(function(c) {
            if (!commentMap[c.post_id]) commentMap[c.post_id] = [];
            commentMap[c.post_id].push(c);
        });
        likes.forEach(function(l) {
            if (!likeMap[l.post_id]) likeMap[l.post_id] = [];
            likeMap[l.post_id].push(l);
            likeUserMap[l.post_id + '|' + l.actor_key] = true;
        });
        return { commentMap: commentMap, likeMap: likeMap, likeUserMap: likeUserMap };
    }

    async function loadAvatarsForUsers(usernames) {
        if (!usernames || usernames.length === 0) return;
        try {
            var allData = [];
            var batchSize = 80;
            for (var i = 0; i < usernames.length; i += batchSize) {
                var batch = usernames.slice(i, i + batchSize);
                var batchResult = await window.sb.from("posts")
                    .select("user_name, media_url")
                    .eq("media_type", "__avatar__")
                    .eq("actor_key", "__avatar__")
                    .in("user_name", batch)
                    .order("created_at", { ascending: false });
                if (batchResult.data) allData = allData.concat(batchResult.data);
            }
            if (allData.length) {
                var seenUsers = {};
                allData.forEach(function(avatar) {
                    if (avatar.media_url && !seenUsers[avatar.user_name]) {
                        seenUsers[avatar.user_name] = true;
                        window.avatarCache[avatar.user_name] = avatar.media_url;
                    }
                });
                if (window.currentUser) {
                    try {
                        var cachedAvatars = window.safeLocalStorageGetJSON(window.AVATAR_CACHE_KEY, {});
                        if (cachedAvatars[window.currentUser]) {
                            window.avatarCache[window.currentUser] = cachedAvatars[window.currentUser];
                        }
                    } catch(e) {}
                }
            }
        } catch(e) {
            console.error("加载头像失败:", e);
        }
    }

    function getAvatarHtml(username, size) {
        if (size === undefined) size = 32;
        var avatarUrl = window.avatarCache[username];
        if (!avatarUrl) {
            if (username === window.currentUser) {
                try {
                    var cachedAvatars = window.safeLocalStorageGetJSON(window.AVATAR_CACHE_KEY, {});
                    avatarUrl = cachedAvatars[username];
                    if (avatarUrl) window.avatarCache[username] = avatarUrl;
                } catch(e) {}
            }
        }
        if (avatarUrl) {
            return '<div class="avatar clickable" onclick="openUserProfile(\'' + username.replace(/'/g, "\\'") + '\')"><img src="' + avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"></div>';
        } else {
            return '<div class="avatar clickable" onclick="openUserProfile(\'' + username.replace(/'/g, "\\'") + '\')">' + username[0].toUpperCase() + '</div>';
        }
    }

    function renderFeedWithAvatars(visiblePosts, comments, likes) {
        var feed = document.getElementById("feed");
        var maps = buildPostMaps(comments, likes);
        var commentMap = maps.commentMap, likeMap = maps.likeMap, likeUserMap = maps.likeUserMap;

        feed.innerHTML = visiblePosts.length ? visiblePosts.map(function(p) {
            var pLikes = likeMap[p.id] || [];
            var pComms = commentMap[p.id] || [];
            var isLiked = likeUserMap[p.id + '|' + window.deviceId];
            var canDelPost = p.actor_key === window.deviceId || p.actor_key === window.currentUser || window.isAdmin();
            trackView(p.id);
            return '<div class="post glass" data-post-id="' + window.escapeHtml(p.id) + '">' +
                '<div class="post-header">' +
                    getAvatarHtml(p.user_name) +
                    '<div class="user-info">' +
                        '<span class="user-name">' + window.escapeHtml(p.user_name) + '</span>' +
                        '<span class="post-time">' + new Date(p.created_at).toLocaleString() + '</span>' +
                    '</div>' +
                '</div>' +
                '<div class="content">' + window.escapeHtml(p.content) + '</div>' +
                (p.media_url ? '<div class="media">' + (p.media_type === 'video' ? '<video src="' + window.escapeHtml(p.media_url) + '" controls preload="none"></video>' : '<img src="' + window.escapeHtml(p.media_url) + '" loading="lazy" onclick="openImageViewer(\'' + window.escapeHtml(p.media_url).replace(/'/g, "\\'") + '\')">') + '</div>' : '') +
                '<div class="post-stats-text">浏览 ' + (p.views || 0) + ' · 点赞 ' + pLikes.length + ' · 评论 ' + pComms.length + '</div>' +
                '<div class="actions">' +
                    '<button class="action-btn' + (isLiked ? ' liked' : '') + '" onclick="toggleLike(this, \'' + window.escapeHtml(p.id).replace(/'/g, "\\'") + '\')">' + (isLiked ? '❤️' : '点赞') + '</button>' +
                    '<button class="action-btn" onclick="openComment(\'' + window.escapeHtml(p.id).replace(/'/g, "\\'") + '\')">评论</button>' +
                    (canDelPost ? '<button type="button" class="action-btn del" onclick="openDelete(\'' + window.escapeHtml(p.id).replace(/'/g, "\\'") + '\', \'' + window.escapeHtml(p.actor_key).replace(/'/g, "\\'") + '\')">删除</button>' : '') +
                    '<button class="action-btn report-btn" style="margin-left:auto;" onclick="window.openReport&&window.openReport(\'post\',\'' + window.escapeHtml(p.id).replace(/'/g, "\\'") + '\',\'' + window.escapeHtml(p.user_name).replace(/'/g, "\\'") + '\')">举报</button>' +
                '</div>' +
                (pComms.length ? '<div class="comments">' + pComms.map(function(c) {
                    return '<div class="comment-item" data-comment-id="' + window.escapeHtml(c.id) + '"><div><b>' + window.escapeHtml(c.user_name) + ':</b> ' + window.escapeHtml(c.content) + '</div></div>';
                }).join('') + '</div>' : '') +
            '</div>';
        }).join('') : '<div class="loading">快来发布第一条动态吧~</div>';

        initPostScrollAnimation();
    }

    function initPostScrollAnimation() {
        var observer = new IntersectionObserver(function(e) {
            e.forEach(function(i) {
                if (i.isIntersecting) {
                    i.target.classList.add('visible');
                }
            });
        }, { threshold: 0.05 });
        document.querySelectorAll('.post').forEach(function(p) { observer.observe(p); });
    }

    function updateFeedStats() {
        var posts = document.querySelectorAll('.post');
        var totalLikes = 0, totalComments = 0, totalViews = 0;
        posts.forEach(function(p) {
            var text = (p.querySelector('.post-stats-text') || {}).textContent || '';
            var vm = text.match(/浏览 (\d+)/);
            var lm = text.match(/点赞 (\d+)/);
            var cm = text.match(/评论 (\d+)/);
            if (vm) totalViews += parseInt(vm[1]);
            if (lm) totalLikes += parseInt(lm[1]);
            if (cm) totalComments += parseInt(cm[1]);
        });
        var sPosts = document.getElementById('sPosts');
        var sViews = document.getElementById('sViews');
        var sLikes = document.getElementById('sLikes');
        if (sPosts) sPosts.textContent = posts.length;
        if (sViews) sViews.textContent = totalViews;
        if (sLikes) sLikes.textContent = totalLikes + totalComments;
    }

    async function initialLoad(skipCache) {
        if (skipCache === undefined) skipCache = false;
        if (!skipCache) {
            var cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                try {
                    var parsed = JSON.parse(cached);
                    if (parsed && parsed.data && Date.now() - parsed.timestamp < CACHE_DURATION) {
                        await renderFeed(parsed.data);
                        loadFeed(true);
                        if (window.currentUser) window.loadDockChatList();
                        return;
                    }
                } catch(e) {}
            }
        }
        await loadFeed(false);
        if (window.currentUser) window.loadDockChatList();
    }
    window.initialLoad = initialLoad;

    window.prefetchStatData = async function() {
        if (Date.now() - statCacheTime < STAT_CACHE_DURATION) return;
        try {
            var results = await Promise.all([
                window.sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }),
                window.sb.from("comments").select("*").order("created_at"),
                window.sb.from("likes").select("*").order("created_at", { ascending: false })
            ]);
            var postRes = results[0], commRes = results[1], likeRes = results[2];
            statAllPosts = (postRes.data || []).filter(function(p) {
                return p.media_type !== window.AUTH_MARKER && p.media_type !== window.DM_MARKER && p.media_type !== '__photo_wall__';
            });
            statAllComments = commRes.data || [];
            statAllLikes = likeRes.data || [];
            statCacheTime = Date.now();
        } catch(e) {}
    };

    window.openStatDetail = async function(type) {
        statCurrentType = type;
        var titles = { posts: '总动态 - 按用户分组', views: '总浏览 - 浏览记录', likes: '点赞和评论 - 记录' };
        document.getElementById('statModalTitle').textContent = titles[type] || '统计详情';
        document.getElementById('statModal').classList.add('active');

        if (statAllPosts.length > 0 && Date.now() - statCacheTime < STAT_CACHE_DURATION) {
            renderStatByType(type);
            if (statPollTimer) clearInterval(statPollTimer);
            statPollTimer = setInterval(refreshStatModal, 15000);
            window.prefetchStatData().then(function() {
                if (document.getElementById('statModal').classList.contains('active') && statCurrentType === type) {
                    renderStatByType(type);
                }
            });
            return;
        }

        document.getElementById('statModalBody').innerHTML = '<div class="loading"><div class="loading-spinner"></div><span class="loading-text">加载中...</span></div>';

        try {
            var results = await Promise.all([
                window.sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }),
                window.sb.from("comments").select("*").order("created_at"),
                window.sb.from("likes").select("*").order("created_at", { ascending: false })
            ]);
            var postRes = results[0], commRes = results[1], likeRes = results[2];
            statAllPosts = (postRes.data || []).filter(function(p) {
                return p.media_type !== window.AUTH_MARKER && p.media_type !== window.DM_MARKER && p.media_type !== '__photo_wall__';
            });
            statAllComments = commRes.data || [];
            statAllLikes = likeRes.data || [];
            statCacheTime = Date.now();

            renderStatByType(type);
        } catch(e) {
            document.getElementById('statModalBody').innerHTML = '<div class="stat-empty">加载失败，请重试</div>';
            console.error('stat error', e);
        }

        if (statPollTimer) clearInterval(statPollTimer);
        statPollTimer = setInterval(refreshStatModal, 15000);
    };

    function renderStatByType(type) {
        if (type === 'posts') {
            renderPostStats();
        } else if (type === 'views') {
            renderViewStats();
        } else if (type === 'likes') {
            renderLikeStats();
        }
    }

    window.scrollToPost = function(postId) {
        window.closeModal('statModal');
        setTimeout(function() {
            var post = document.querySelector('.post[data-post-id="' + postId + '"]');
            if (post) {
                post.scrollIntoView({ behavior: 'smooth', block: 'center' });
                post.style.boxShadow = '0 0 0 3px var(--primary)';
                post.style.transition = 'box-shadow 0.3s';
                setTimeout(function() { post.style.boxShadow = ''; }, 2000);
            }
        }, 350);
    };

    window.openPostDetail = async function(postId) {
        document.getElementById('postDetailTitle').textContent = '帖子详情';
        document.getElementById('postDetailBody').innerHTML = '<div class="loading"><div class="loading-spinner"></div><span class="loading-text">加载中...</span></div>';
        document.getElementById('postDetailModal').classList.add('active');

        try {
            var results = await Promise.all([
                window.sb.from("posts").select("*").eq("id", postId).maybeSingle(),
                window.sb.from("comments").select("*").eq("post_id", postId).order("created_at"),
                window.sb.from("likes").select("*").eq("post_id", postId).order("created_at", { ascending: false })
            ]);
            var post = results[0].data;
            if (!post) {
                document.getElementById('postDetailBody').innerHTML = '<div class="stat-empty">帖子不存在或已被删除</div>';
                return;
            }
            var likes = results[2].data || [];
            var comments = results[1].data || [];
            renderPostDetail(post, likes, comments);
        } catch(e) {
            document.getElementById('postDetailBody').innerHTML = '<div class="stat-empty">加载失败，请重试</div>';
            console.error(e);
        }
    };

    function renderPostDetail(post, likes, comments) {
        var body = document.getElementById('postDetailBody');
        var vc = (post.views || 0) + 1;

        body.innerHTML = '<div class="post-detail-header">' +
            '<div class="pdh-left">' +
                '<div class="pdh-name">' + window.escapeHtml(post.user_name) + '</div>' +
                '<div class="pdh-time">' + new Date(post.created_at).toLocaleString() + '</div>' +
            '</div>' +
        '</div>' +
        (post.content ? '<div class="post-detail-content">' + window.escapeHtml(post.content) + '</div>' : '') +
        (post.media_url ? '<div class="post-detail-media">' + (post.media_type === 'video' ? '<video src="' + window.escapeHtml(post.media_url) + '" controls preload="none"></video>' : '<img src="' + window.escapeHtml(post.media_url) + '" onclick="openImageViewer(\'' + window.escapeHtml(post.media_url).replace(/'/g, "\\'") + '\')" loading="lazy" />') + '</div>' : '') +
        '<div class="post-detail-stats">浏览 ' + vc + ' · 点赞 ' + likes.length + ' · 评论 ' + comments.length + '</div>' +
        '<div class="stat-two-col">' +
            '<div class="stat-col">' +
                '<div class="stat-section-title">❤️ 点赞用户（' + likes.length + '）</div>' +
                (likes.length ? likes.map(function(l) {
                    return '<div class="stat-like-item">' +
                        '<div class="sli-info">' +
                            '<div class="sli-user">' + window.escapeHtml(l.user_name) + '</div>' +
                        '</div>' +
                        '<span class="sli-time">' + new Date(l.created_at).toLocaleString() + '</span>' +
                    '</div>';
                }).join('') : '<div class="stat-empty" style="padding:12px 0;">暂无点赞</div>') +
            '</div>' +
            '<div class="stat-col">' +
                '<div class="stat-section-title">💬 评论列表（' + comments.length + '）</div>' +
                (comments.length ? comments.map(function(c) {
                    return '<div class="stat-comment-item">' +
                        '<div class="sci-info">' +
                            '<div class="sci-user">' + window.escapeHtml(c.user_name) + '</div>' +
                            '<div class="sci-target">' + window.escapeHtml(c.content) + '</div>' +
                        '</div>' +
                        '<span class="sci-time">' + new Date(c.created_at).toLocaleString() + '</span>' +
                    '</div>';
                }).join('') : '<div class="stat-empty" style="padding:12px 0;">暂无评论</div>') +
            '</div>' +
        '</div>';
    }

    function formatPostSummary(p) {
        var text = p.content || '';
        var hasImg = p.media_url && p.media_type === 'image';
        var hasVid = p.media_url && p.media_type === 'video';
        var tag = '';
        if (hasImg) tag = '<span class="spi-img-tag">🖼 图片</span>';
        if (hasVid) tag = '<span class="spi-img-tag">🎬 视频</span>';
        var summary = text.length > 20 ? text.slice(0, 20) + '...' : text;
        var display = summary || (hasImg ? '一张图片' : hasVid ? '一个视频' : '(无内容)');
        return { display: display, tag: tag, hasImg: hasImg, hasVid: hasVid, thumbUrl: hasImg ? p.media_url : null };
    }

    function renderPostItemHTML(p) {
        var fmt = formatPostSummary(p);
        var onclick = "openPostDetail('" + window.escapeHtml(p.id).replace(/'/g, "\\'") + "')";
        return '<div class="stat-post-item">' +
            '<span class="spi-content" onclick="' + onclick + '" title="点击查看帖子详情">' +
                window.escapeHtml(fmt.display) +
                fmt.tag +
            '</span>' +
            (fmt.thumbUrl ? '<img class="spi-thumb" src="' + window.escapeHtml(fmt.thumbUrl) + '" onclick="' + onclick + '" title="点击查看帖子详情" />' : '') +
            '<span class="spi-time">' + new Date(p.created_at).toLocaleString() + '</span>' +
        '</div>';
    }

    function renderPostStats() {
        var body = document.getElementById('statModalBody');
        var userMap = {};
        statAllPosts.forEach(function(p) {
            if (!userMap[p.user_name]) userMap[p.user_name] = [];
            userMap[p.user_name].push(p);
        });
        var entries = Object.entries(userMap).sort(function(a, b) { return b[1].length - a[1].length; });

        if (!entries.length) {
            body.innerHTML = '<div class="stat-empty">暂无动态数据</div>';
            return;
        }

        body.innerHTML = entries.map(function(item) {
            var name = item[0], posts = item[1];
            return '<div class="stat-user-group">' +
                '<div class="stat-user-header">' +
                    '<div class="suh-left">' +
                        '<div class="suh-avatar">' + window.escapeHtml(name)[0].toUpperCase() + '</div>' +
                        '<span class="suh-name">' + window.escapeHtml(name) + '</span>' +
                    '</div>' +
                    '<span class="suh-count">' + posts.length + ' 条</span>' +
                '</div>' +
                '<div class="stat-user-posts">' +
                    posts.slice(0, 3).map(function(p) { return renderPostItemHTML(p); }).join('') +
                    (posts.length > 3 ? '<div style="text-align:center; padding:8px 0;"><button class="stat-view-btn" onclick="loadUserAllPosts(\'' + window.escapeHtml(name).replace(/'/g, "\\'") + '\')">查看全部 ' + posts.length + ' 条</button></div>' : '') +
                '</div>' +
            '</div>';
        }).join('');
    }

    window.loadUserAllPosts = function(userName) {
        var body = document.getElementById('statModalBody');
        var userPosts = statAllPosts.filter(function(p) { return p.user_name === userName; });
        body.innerHTML = '<button class="back-to-stats-btn" onclick="openStatDetail(\'posts\')">← 返回总动态</button>' +
            '<div style="font-weight:700; font-size:15px; margin-bottom:12px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.1);">' +
                userName + ' 的全部帖子（共 ' + userPosts.length + ' 条）' +
            '</div>' +
            userPosts.map(function(p) { return renderPostItemHTML(p); }).join('');
    };

    function renderViewStats() {
        var body = document.getElementById('statModalBody');
        var history = getViewHistory();

        if (!history.length) {
            body.innerHTML = '<div class="stat-empty">' +
                '<div style="font-size:16px; margin-bottom:8px;">📊 浏览记录</div>' +
                '<div style="font-size:13px;">暂无浏览详情数据</div>' +
                '<div style="font-size:12px; margin-top:12px; opacity:0.7;">浏览记录会在你查看帖子时自动保存</div>' +
                '<div style="font-size:12px; margin-top:8px; opacity:0.7;">当前已记录总浏览数：' + document.getElementById('sViews').textContent + ' 次</div>' +
            '</div>';
            return;
        }

        body.innerHTML = history.map(function(v) {
            return '<div class="stat-view-item">' +
                '<div class="svi-info">' +
                    '<div class="svi-user">' + window.escapeHtml(v.user_name) + '</div>' +
                    '<div class="svi-target">浏览了 <b>' + window.escapeHtml(v.post_author) + '</b> 的帖子：' + window.escapeHtml(v.post_content) + '</div>' +
                '</div>' +
                '<span class="svi-time">' + new Date(v.viewed_at).toLocaleString() + '</span>' +
            '</div>';
        }).join('');
    }

    function renderLikeStats() {
        var body = document.getElementById('statModalBody');
        var postMap = {};
        statAllPosts.forEach(function(p) { postMap[p.id] = p; });

        function buildLikesCol() {
            var h = '<div class="stat-section-title">❤️ 点赞记录</div>';
            if (statAllLikes.length) {
                h += statAllLikes.slice(0, 200).map(function(l) {
                    var post = postMap[l.post_id];
                    var postContent = post ? (post.content ? window.escapeHtml(post.content.slice(0, 20)) + '...' : '(图片/视频)') : '(已删除)';
                    return '<div class="stat-like-item">' +
                        '<div class="sli-info">' +
                            '<div class="sli-user">' + window.escapeHtml(l.user_name) + '</div>' +
                            '<div class="sli-target">点赞了：' + postContent + '</div>' +
                        '</div>' +
                        '<span class="sli-time">' + new Date(l.created_at).toLocaleString() + '</span>' +
                    '</div>';
                }).join('');
            } else {
                h += '<div class="stat-empty" style="padding:12px 0;">暂无点赞记录</div>';
            }
            return h;
        }

        function buildCommentsCol() {
            var h = '<div class="stat-section-title">💬 评论记录</div>';
            if (statAllComments.length) {
                var reversed = [...statAllComments].reverse();
                h += reversed.slice(0, 200).map(function(c) {
                    var post = postMap[c.post_id];
                    var postContent = post ? (post.content ? window.escapeHtml(post.content.slice(0, 20)) + '...' : '(图片/视频)') : '(已删除)';
                    return '<div class="stat-comment-item">' +
                        '<div class="sci-info">' +
                            '<div class="sci-user">' + window.escapeHtml(c.user_name) + '</div>' +
                            '<div class="sci-target">评论了「' + postContent + '」：' + window.escapeHtml(c.content) + '</div>' +
                        '</div>' +
                        '<span class="sci-time">' + new Date(c.created_at).toLocaleString() + '</span>' +
                    '</div>';
                }).join('');
            } else {
                h += '<div class="stat-empty" style="padding:12px 0;">暂无评论记录</div>';
            }
            return h;
        }

        body.innerHTML = '<div class="stat-two-col">' +
            '<div class="stat-col">' + buildLikesCol() + '</div>' +
            '<div class="stat-col">' + buildCommentsCol() + '</div>' +
        '</div>';
    }

    function refreshStatModal() {
        var modal = document.getElementById('statModal');
        if (!modal || !modal.classList.contains('active')) return;
        var type = statCurrentType;
        if (!type) return;
        Promise.all([
            window.sb.from("posts").select("*").neq("media_type", "__avatar__").neq("media_type", "__user_info__").neq("media_type", "__photo_wall__").neq("media_type", "__ann__").order("created_at", { ascending: false }),
            window.sb.from("comments").select("*").order("created_at"),
            window.sb.from("likes").select("*").order("created_at", { ascending: false })
        ]).then(function(results) {
            var postRes = results[0], commRes = results[1], likeRes = results[2];
            statAllPosts = (postRes.data || []).filter(function(p) {
                return p.media_type !== window.AUTH_MARKER && p.media_type !== window.DM_MARKER && p.media_type !== '__photo_wall__';
            });
            statAllComments = commRes.data || [];
            statAllLikes = likeRes.data || [];
            var body = document.getElementById('statModalBody');
            if (!body) return;
            if (type === 'posts') renderPostStats();
            else if (type === 'views') renderViewStats();
            else if (type === 'likes') renderLikeStats();
        }).catch(function() {});
    }
})();