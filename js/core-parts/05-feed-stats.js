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
            var dmNotificationIdentity = '', dmNotificationIds = new Set(), dmSnapshotReady = false;
            window.__xtjResetDmNotifications=function(){
                activeNotifications.forEach(function(n){n.element.remove();});activeNotifications=[];
                dmNotificationIdentity='';dmNotificationIds.clear();dmSnapshotReady=false;
            };
            function resetDmNotificationIdentity() {
                var identity=(typeof _authStateEpoch==='number'?_authStateEpoch:0)+':'+(window.currentUser||'');
                if(identity!==dmNotificationIdentity){
                    dmNotificationIdentity=identity;dmNotificationIds.clear();dmSnapshotReady=false;
                    activeNotifications.forEach(function(n){n.element.remove();});activeNotifications=[];
                }
            }
            function observeDmSnapshot(result) {
                resetDmNotificationIdentity();
                if(Array.isArray(result.conversations))authoritativeDmUnread(result.conversations);
                var rows=(result.data||[]).slice().sort(function(a,b){return String(a.created_at||'').localeCompare(String(b.created_at||''));});
                rows.forEach(function(message){
                    if(!message.id||message.user_name===window.currentUser||message.media_url!==window.currentUser)return;
                    var id=String(message.id);
                    if(dmNotificationIds.has(id))return;
                    if(dmSnapshotReady&&!getDMMessageReadAt(message)&&window.__xtjDmMuteReady&&!window.__xtjMutedChatPeers[message.user_name])
                        showNotification(message.user_name,getDockChatMessagePreview(message),id);
                    dmNotificationIds.add(id);
                });
                dmSnapshotReady=true;
                while(dmNotificationIds.size>500)dmNotificationIds.delete(dmNotificationIds.values().next().value);
            }

            function showNotification(userName, message, messageId) {
                resetDmNotificationIdentity();
                if(messageId){if(dmNotificationIds.has(String(messageId)))return;dmNotificationIds.add(String(messageId));}
                if (!userName || !message) return;
                var preferences = window.__xtjProfileMessagePreferences;
                var ownPreferences = preferences && preferences.owner === currentUser && preferences.epoch === _authStateEpoch;
                if (ownPreferences ? preferences.enabled === false : window.safeStorage.get('xtj-notif') === 'off') return;
                if (currentDockTab === 'chat' && !document.hidden && dockChatActiveUser === userName) return;

                const container = document.getElementById('notificationContainer');
                if (!container) return;

                const bubble = document.createElement('div');
                bubble.className = 'notification-bubble';

                const safeAvatarUrl = getAvatarUrl(userName) ? sanitizeUrl(getAvatarUrl(userName)) : '';
                const avatarHtml = safeAvatarUrl ? 
                    `<img loading="lazy" decoding="async" src="${escapeHtml(safeAvatarUrl)}" alt="${escapeHtml(userName)}">` : 
                    escapeHtml(String(userName)[0] || '').toUpperCase();

                const truncatedMsg = ownPreferences && preferences.preview === false ? '收到一条新消息' : (message.length > 50 ? message.slice(0, 50) + '...' : message);

                bubble.innerHTML = `
                    <div class="notification-avatar">${avatarHtml}</div>
                    <div class="notification-content">
                        <div class="notification-name">${escapeHtml(userName)}</div>
                        <div class="notification-text">${escapeHtml(truncatedMsg)}</div>
                    </div>
                `;

                // ★ 2026-09-13 修复（M-7）：气泡点击需要幂等 + 取消自动隐藏定时器。
                // 旧实现里点击后 3000ms 的自动移除定时器照常执行，且气泡在 400ms 动画
                // 期间仍可点击 —— 用户快速连点会反复触发 openChat（每次拉 DM 列表/消息），
                // 叠加 startDMPolling 造成重复请求。现在：点击即置幂等标记并取消计时器。
                let autoHideTimer = null;
                let clicked = false;
                bubble.addEventListener('click', () => {
                    if (clicked) return; // 幂等：连点只生效一次
                    clicked = true;
                    if (autoHideTimer) { clearTimeout(autoHideTimer); autoHideTimer = null; }
                    switchDockTab('chat');
                    openChat(userName);
                    bubble.classList.remove('show');
                    bubble.classList.add('hide');
                    setTimeout(() => {
                        if (bubble.parentNode) bubble.remove();
                        // ★ 审计修复：点击路径同样要从 activeNotifications 移除条目。
                        //   旧实现只在自动隐藏路径 filter（且 clicked 后被 if 提前
                        //   return 跳过），点击过的气泡 DOM 引用会长期滞留数组。
                        activeNotifications = activeNotifications.filter(n => n.id !== notifId);
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

                autoHideTimer = setTimeout(() => {
                    // S：若用户已点击过，说明该条目已被处理，跳过自动隐藏（避免对已移除
                    // 的节点操作，也避免 filter 掉后到的同 id 条目）
                    if (clicked) return;
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
            let likesRealtime = null;
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
                // ★ 2026-09-26（审计 P2-5）：整体长度上限。data: 分支此前无长度限制，
                //   攻击者可在头像/帖图/私信字段塞入超长 base64，导致 DOM 属性膨胀、
                //   内存与解析耗时（配合私信里的 ?retry= 拼接更明显）。2MB 足够覆盖
                //   正常内联图，超出直接拒绝。
                if (s.length > 2 * 1024 * 1024) return '';
                // ★ M45：收紧协议白名单——http/https 与 blob:（本地媒体对象）放行
                if (/^https?:/i.test(s)) return s;
                if (/^blob:/i.test(s)) return s;
                // data: 仅放行可安全内联的位图类型，禁止 data:text/html 等可执行载荷
                // （svg+xml 可能携带脚本面，一并拒绝）
                if (/^data:image\/(png|jpeg|gif|webp)(;|,)/i.test(s)) return s;
                // 相对路径（./ 或 ../ 开头，排除 .evil 这类裸点开头写法）
                if (/^\.\.?\//.test(s)) return s;
                // 以单个 / 开头的站内路径也允许（但排除协议相对 URL //）
                if (/^\//.test(s) && !/^\/\//.test(s)) return s;
                return '';
            }
            window.sanitizeUrl = sanitizeUrl;

            function formatMsgTime(dateStr) {
                var d = new Date(dateStr);
                // ★ 2026-09-25 修复（会话列表出现 "NaN/NaN NaN:NaN"）：空串/非法日期时
                //   new Date('') 是 Invalid Date，getHours() 返回 NaN，拼出来就是 "NaN:NaN"。
                //   管理员固定入口本来就没有时间，而每发一条消息都会走
                //   applyDockChatConversationPreview 把列表重排一遍 —— 于是那一行立刻变成 NaN。
                //   所有调用方都只把这里当展示文案，兜底成空串最安全。
                if (isNaN(d.getTime())) return '';
                var now = new Date();
                var pad = function(n) { return String(n).padStart(2, '0'); };
                var hhmm = pad(d.getHours()) + ':' + pad(d.getMinutes());
                if (d.toDateString() === now.toDateString()) return hhmm;
                return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hhmm;
            }

            function getMediaUrl(prefix, val) {
                if (val.startsWith('http')) return sanitizeUrl(val);
                // ★ 2026-09-25 修复：sb 可能为 null（Supabase SDK 延迟就绪/加载失败），
                //   原实现直接 return ''，导致私聊图片拿不到地址而永久显示「查看图片」按钮。
                //   现做惰性兜底 + 触发一次 Supabase 重建。
                var _client = sb || window.sb || null;
                if (!_client && typeof initSupabaseClient === 'function') {
                    try { initSupabaseClient(); } catch (eInit) {}
                    _client = sb || window.sb || null;
                }
                if (!_client) return '';
                try {
                    return _client.storage.from('uploads').getPublicUrl(val).data.publicUrl;
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

            // ★ 2026-09-25 新增：私聊媒体上传路径（走后端 /api/dm/upload 时使用）。
            //   与 buildStorageUploadPath 的区别：**不含用户名**，改为 <uidHash>_ 前缀。
            //   原因：后端 validateDmUploadOwnership 要求 chat/<uidHash>_ 严格前缀匹配
            //   （uidHash = sha256(userName) 前 12 位），以此把"猜路径抢存储位"挡在写入之前。
            //   dm-media.js 的路径正则只允许 [A-Za-z0-9_-]，所以这里也不能出现中文用户名。
            //   客户端不做哈希（避免依赖 crypto.subtle 的 HTTPS 限制），由其异步取一次。
            var _dmUidHashCache = null;
            async function getDmUidHash() {
                if (_dmUidHashCache) return _dmUidHashCache;
                var u = '';
                try { u = String(window.currentUser || '').trim(); } catch (_) {}
                if (!u) return null;
                try {
                    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
                        var buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(u));
                        var hex = Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
                        _dmUidHashCache = hex.slice(0, 12);
                        return _dmUidHashCache;
                    }
                } catch (_) { /* 非安全上下文等：落回下面的兜底 */ }
                // 兜底：必须与后端 sha256 前 12 位一致，否则上传必然 400。
                // 因此拿不到 WebCrypto 时不再瞎猜，直接返回 null 让调用方报可读错误。
                return null;
            }

            async function buildDmStorageUploadPath(fileName) {
                var hash = await getDmUidHash();
                if (!hash) throw new Error('无法为上传文件生成安全标识，请刷新页面重试');
                return 'chat/' + hash + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + sanitizeStorageFileName(fileName);
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
                if (payload && payload.media && (payload.media.url ||
                    payload.media.bucket === 'dm-private' && payload.media.storage_path)) {
                    return {
                        kind: payload.media.kind || '',
                        name: payload.media.name || '',
                        src: payload.media.url,
                        fullSrc: payload.media.url,
                        w: Math.round(Number(payload.media.w || 0)) || 0,
                        h: Math.round(Number(payload.media.h || 0)) || 0
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
                if (media.kind === 'file') return '[文件]';
                if (media.kind === 'audio') return '[音频]';
                if (media.kind === 'video') return '[视频]';
                return '[图片]';
            }

            // ★ 2026-09-25 简化：私聊图片「退化成查看图片按钮」的**签名地址**补救链路已删除。
            //
            //   上一版曾假设"生产环境 uploads 桶未开公共读，公共地址 403，所以要换后端签名地址"。
            //   该假设已被线上事实验证为不成立：实测真实对象
            //     https://<proj>.supabase.co/storage/v1/object/public/uploads/posts/xxx.jpg
            //     → HTTP 200 / image/jpeg / 589950 bytes
            //   而取一个不存在的对象返回 NoSuchKey（而非策略拒绝），证明 /public/ 路由是放通的。
            //   因此 /api/dm/media/sign 及其前端签名缓存/预热/降级分支全部是多余复杂度：
            //   它们只是让每次渲染多打一次后端、并在失败时把图片退化成按钮。
            //
            //   现在保留的只有「真实网络抖动仍需要重试 + 重试仍失败给可点开的兜底按钮」，
    //   直接用公共地址，不再引入任何后端往返。
            window.handleDockChatImageError = function(img) {
                if (!img || !img.parentNode) return;
                var retryCount = parseInt(img.getAttribute('data-retry-count') || '0', 10) || 0;
                var currentSrc = String(img.currentSrc || img.src || '');
                var dataSrc = String(img.getAttribute('data-src') || '');
                var fullSrc = img.getAttribute("data-full-src") || dataSrc || currentSrc || "";
                var localSrc = String(img.getAttribute('data-local-src') || '');
                var remoteAlt = String(img.getAttribute('data-remote-src') || '');

                // ★ 2026-09-26 修复（"发完图先是小气泡→再变没图的大气泡→最后变成『查看图片』按钮"）：
                //   ① 手上还有**本地原图**时，远端取不到就退回本地继续显示。
                //      绝不让气泡变空、也绝不降级成按钮 —— 本地字节不可能 404。
                //   ② blob: 地址**不能**拼 ?retry= 之类的查询串 —— blob URL 是内存句柄，
                //      带 query 后立刻失效，于是"第一次失败 → 重试必然再失败 → 直接降级成按钮"。
                //      这正是真机上那套三段式退化的直接成因。
                //   ③ 远端地址失败时也不再立刻降级：先退避重试两次（300ms / 900ms），
                //      移动端弱网首帧失败很常见，多给两次机会基本都能救回来。

                // 情况 A：当前是远端、本地图还在 → 退回本地图，到此为止
                if (localSrc && !/^blob:/i.test(currentSrc) && img.getAttribute('data-local-shown') !== '1') {
                    img.setAttribute('data-local-shown', '1');
                    img.removeAttribute('data-remote-src');
                    // ★ 2026-09-27 修复（审计 M10）：这是一次**新的显示起点**（本地图接管），
                    //   把「连续失败次数」清零，否则远端再次失败时会直接继承此前的失败档位。
                    img.setAttribute('data-retry-count', '0');
                    img.src = localSrc;
                    return;
                }
                // 情况 B：当前是本地 blob（被 revoke 或解码失败）→ 立刻切到远端，不加 query
                if (/^blob:/i.test(currentSrc)) {
                    var next = remoteAlt || (dataSrc && !/^blob:/i.test(dataSrc) ? dataSrc : (String(fullSrc).indexOf('blob:') !== 0 ? fullSrc : ''));
                    if (next && next !== currentSrc) {
                        img.removeAttribute('data-remote-src');
                        img.setAttribute('data-retry-count', String(retryCount + 1));
                        img.src = next;
                        return;
                    }
                    // ★ 2026-09-27 修复（审计 M9）：本地 blob 已失效、且**没有任何远端可换**
                    //   （HEIC 在桌面 Chrome 解不了、服务端也没转出 JPEG，即 data-remote-src
                    //   为空）时，旧实现直接 return —— 气泡里永久留一个坏图图标，用户
                    //   完全不知道发生了什么。这里改为给出**可感知**的占位说明（复用
                    //   _dmRenderMediaFallback，不另起一套 DOM）。注意：不拼任何 query 参数，
                    //   也不重新拼 blob URL —— 只做一次性降级。
                    _dmRenderMediaFallback(img, '');
                    return;
                }
                // 情况 C：远端地址 → 退避重试两次
                if (retryCount < 2 && fullSrc && String(fullSrc).indexOf('blob:') !== 0) {
                    img.setAttribute('data-retry-count', String(retryCount + 1));
                    var delay = retryCount === 0 ? 300 : 900;
                    setTimeout(function() {
                        if (!img.parentNode) return;
                        img.src = fullSrc + (fullSrc.indexOf('?') >= 0 ? '&' : '?') + 'retry=' + Date.now();
                    }, delay);
                    return;
                }
                // ★ 2026-09-27 修复（审计 M10）：走到终态降级前先把「连续失败次数」清零。
                //   旧实现 data-retry-count 只增不减，同一张图第二次失效时 retryCount 仍是
                //   上一次的 2 → 直接越过情况 C 跳到按钮终态，用户根本没有第二次机会。
                //   计数语义必须是「连续失败次数」：一次**成功 retry 发起之前**已被下面的
                //   onload 路径重置；这里保证终态不会把计数留在高位。
                img.setAttribute('data-retry-count', '0');
                // 情况 D：确实没救了 → 退化成可点开的兜底按钮（点开用原始地址）
                _dmRenderMediaFallback(img, fullSrc);
            };

            // ★ 2026-09-26 新增：把气泡里的本地 blob 预览**无缝换成**远端地址。
            //   发送成功后消息对象仍带着 __localPreviewUrl（本地字节），气泡先用它渲染，
            //   所以图片从头到尾都在，绝不会出现"空白气泡"。这里在后台把远端图下载好，
            //   完成后才把 src 指过去（同一张图，肉眼无变化），随后释放 blob。
            //   远端下载失败则**什么都不做**：继续显示本地图，不清空、不降级成按钮。
            function hydrateDockChatRemoteMedia(host) {
                var root = host || document.getElementById('dockChatMessages');
                if (!root) return;
                var imgs = root.querySelectorAll('img.msg-img[data-remote-src]');
                Array.prototype.forEach.call(imgs, function(img) {
                    var remote = String(img.getAttribute('data-remote-src') || '');
                    if (!remote || img.getAttribute('data-swapping') === '1') return;
                    img.setAttribute('data-swapping', '1');
                    // ★ 2026-09-27 修复（审计 M11：换源要下载两遍远端图）：
                    //   旧实现先用 `new Image()` 探一次远端可用性（probe），onload 后再把
                    //   `img.src = remote` —— 同一张图下载两遍，弱网下流量翻倍。
                    //   改为**预加载到目标元素本身**：probe 不再是独立对象，而是把远端地址
                    //   直接喂给这个 `<img>`（浏览器据此完成一次下载并解码）。为了让"换源期间
                    //   不闪空窗"，仍保留本地图当背景垫底（本地图本来就已经在 src 里显示），
                    //   待远端 load 完成后再撤背景、释放 blob。整条链路只请求远端一次。
                    var localSrc = String(img.getAttribute('data-local-src') || '');
                    // ★ 2026-09-27 修复（审计 M14：once:true 的 load 监听在失败分支从不移除）：
                    //   旧实现两个 { once: true } 监听（finishSwap 与 error 清理）互相不知道对方
                    //   是否存在 —— error 触发后 load 监听仍挂在元素上（闭包连同 img 引用滞留），
                    //   反之亦然。这里统一命名、互相注销，保证任一路径结束后两个监听都不残留。
                    var onLoad = null;
                    var onError = null;
                    var cleanupListeners = function() {
                        if (onLoad) { try { img.removeEventListener('load', onLoad); } catch (eL) {} onLoad = null; }
                        if (onError) { try { img.removeEventListener('error', onError); } catch (eE) {} onError = null; }
                        try { img.removeAttribute('data-swapping'); } catch (eS) {}
                    };
                    var finishSwap = function() {
                        cleanupListeners();
                        // ★ 2026-09-27（审计 M10）：成功换到远端图 → 重置「连续失败计数」，
                        //   让同一气泡此后如有异常从零开始，而不是继承上次的失败档位。
                        try { img.setAttribute('data-retry-count', '0'); } catch (eRc) {}
                        try {
                            img.style.backgroundImage = '';
                            img.style.backgroundSize = '';
                        } catch (eClr) {}
                        // 远端确认显示后，本地 blob 不再需要；通知外层释放（幂等）
                        try {
                            if (typeof window.__xtjReleaseDmLocalPreview === 'function') {
                                window.__xtjReleaseDmLocalPreview(localSrc);
                            }
                        } catch (e) {}
                        img.removeAttribute('data-local-src');
                        img.removeAttribute('data-local-shown');
                    };
                    // ★ 2026-09-27 修复（审计 M5：远端探测失败后既不重试也不释放 blob）：
                    //   弱网下 probe 失败就彻底放弃，且因为 renderDockMessages 签名未变会直接
                    //   return，hydrate 再也不会被触发 → blob 永久滞留内存。现在退避重试
                    //   2 次（600ms / 1800ms）；仍失败则**保留本地 blob 继续显示**（既有设计
                    //   意图：绝不降级成按钮），但把背景垫底与监听都清干净，避免闭包滞留。
                    // 远端地址已有本地图在显示 → 先把本地图铺成背景，换源期间零空窗。
                    // 抽成函数：每次重试前都要重新铺（error 会把 <img> 内容清空露出空白）。
                    var applyLocalBackdrop = function() {
                        if (!localSrc) return;
                        try {
                            img.style.backgroundImage = 'url("' + localSrc.replace(/["\\]/g, '') + '")';
                            img.style.backgroundSize = '100% 100%';
                            img.style.backgroundRepeat = 'no-repeat';
                        } catch (eBg) {}
                    };
                    var retryLeft = 2;
                    var scheduleRetry = function() {
                        if (!img.parentNode || img.getAttribute('data-remote-src') !== remote) { cleanupListeners(); return; }
                        if (retryLeft <= 0) { cleanupListeners(); return; }
                        retryLeft -= 1;
                        var delay = retryLeft === 1 ? 600 : 1800;
                        setTimeout(function() {
                            if (!img.parentNode) { cleanupListeners(); return; }
                            if (img.getAttribute('data-remote-src') !== remote) { cleanupListeners(); return; }
                            // error 之后 <img> 是空的 → 先把本地图重新铺成背景，避免露出空白
                            applyLocalBackdrop();
                            // 复用目标元素本身重新加载（命中缓存/失败重试都只算这一路）
                            try { img.src = remote; } catch (eR) {}
                        }, delay);
                    };
                    applyLocalBackdrop();
                    onLoad = function() {
                        if (!img.parentNode || img.getAttribute('data-remote-src') !== remote) { cleanupListeners(); return; }
                        // ★ 2026-09-26（`object-fit` 改为 cover 后的必要条件）：只有远端图的
                        //   真实比例与占位比例**一致**时才允许换源。比例一旦不一致，cover 会把
                        //   远端图按占位盒子裁切（老消息没有 w/h，兜的是 4:3，会被裁掉一大块）。
                        //   不一致就继续显示本地 blob：本地字节、比例一定对、又不可能 404。
                        var pw = Number(img.naturalWidth || 0);
                        var ph = Number(img.naturalHeight || 0);
                        var boxW = Number(img.getAttribute('width') || 0);
                        var boxH = Number(img.getAttribute('height') || 0);
                        if (pw > 0 && ph > 0 && boxW > 0 && boxH > 0) {
                            var probeRatio = pw / ph;
                            var boxRatio = boxW / boxH;
                            if (Math.abs(probeRatio - boxRatio) / boxRatio > 0.02) {
                                // 比例不符：退回本地图，清监听但不释放 blob（本地图还要继续显示）
                                cleanupListeners();
                                try { img.style.backgroundImage = ''; img.style.backgroundSize = ''; } catch (ePr) {}
                                return;
                            }
                        }
                        finishSwap();
                    };
                    onError = function() {
                        // 远端这一次没成功 → **保留本地背景图**（不撤，避免露白），安排有限重试。
                        // 旧实现这里会先把背景清掉，弱网下用户就会看到一次空白闪动 ——
                        // 与"文件没换成功就继续显示本地图"的设计意图相悖。
                        scheduleRetry();
                    };
                    img.addEventListener('load', onLoad);
                    img.addEventListener('error', onError);
                    // ★ 预加载到目标元素本身：只请求远端一次（onload 后浏览器已缓存）
                    img.removeAttribute('data-remote-src');
                    try { img.src = remote; } catch (eSet) { cleanupListeners(); }
                });
            }
            window.hydrateDockChatRemoteMedia = hydrateDockChatRemoteMedia;

            // ★ 2026-09-27 修复（审计 M9）：无远端可换时给用户**可感知**的降级说明。
            //   旧实现只给一个「查看图片」按钮，点开还得再失败一次；HEIC 在桌面 Chrome
            //   解不了、服务端也没转出 JPEG 时，用户完全不知道是格式问题。这里按 mime
            //   给出原因与可执行建议（HEIC → 转 JPEG），并保留可点开按钮（有远端地址时）。
            function _dmMediaFallbackReason() {
                return '图片无法显示：当前浏览器/服务端无法解码该格式（HEIC/HEIF 请先用 iPhone 相册「编辑 → 存储为 JPEG」，或在电脑上用「文件」里的 JPG 重新发送）';
            }

            function _dmRenderMediaFallback(img, fullSrc) {
                if (!img || !img.parentNode) return;
                var fallback = document.createElement("button");
                fallback.type = "button";
                fallback.className = "msg-media-fallback";
                // 无远端可换 → 直接把原因写进气泡；有远端 → 仍提示可点开查看
                if (fullSrc) {
                    fallback.innerHTML = '<span class="msg-media-fallback-icon">图片</span><span class="msg-media-fallback-text">查看图片</span>';
                    fallback.title = _dmMediaFallbackReason();
                } else {
                    fallback.innerHTML = '<span class="msg-media-fallback-icon">图片</span><span class="msg-media-fallback-text">图片无法显示</span>';
                    fallback.title = _dmMediaFallbackReason();
                    fallback.setAttribute('aria-label', _dmMediaFallbackReason());
                }
                fallback.onclick = function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    // ★ 2026-09-25：把兜底按钮自身作为 triggerEl 传入。此前只传 src，
                    //   新预览器拿不到触发元素就会退化成旧 #imgViewer（关闭按钮不可见、
                    //   缩放异常）。传 this 后即使原图失败，点开的仍是统一的新预览器。
                    if (fullSrc && typeof window.openImageViewer === "function") {
                        window.openImageViewer(fullSrc, fallback);
                    } else if (fullSrc) {
                        window.open(fullSrc, '_blank', 'noopener');
                    } else {
                        showToast("图片加载失败");
                    }
                };
                img.parentNode.replaceChild(fallback, img);
            }

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

            // ★ 2026-09-25 修复（审计 M-7）：未读口径单一来源。
            //   会话列表（loadDockChatList）与导航角标（updateUnreadBadge）此前各自实现了一份
            //   聚合，条数上限还不一样（180 vs 200），切换 tab 时数字会跳动。
            //   规则：只统计"发给我的且未读"的消息，按发件人（会话）分组，每个会话封顶 99，再求和。
            function aggregateDmUnread(rows) {
                var bySender = {};
                (Array.isArray(rows) ? rows : []).forEach(function(m) {
                    if (!m || m.media_url !== window.currentUser) return;
                    if (window.isMsgReadByMe(m)) return;
                    var sender = m.user_name;
                    if (!sender) return;
                    bySender[sender] = Math.min((bySender[sender] || 0) + 1, 99);
                });
                var total = 0;
                Object.keys(bySender).forEach(function(k) { total += bySender[k]; });
                return { total: total, bySender: bySender };
            }
            window.aggregateDmUnread = aggregateDmUnread;

            function subscribeToMessages() {
                // ★ H-1：顺带确保 Broadcast 订阅存在（启动 / 可见性 / online / pageshow 都走这里），
                //   避免改四处调用点；它自带代次与退避，重复调用安全。
                try { subscribeToDmBroadcast(); } catch (eBc) {}
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

                // ★ 2026-09-25 修复（复审 P1-01）：与评论订阅对齐的「订阅代次」保护。
                //   旧实现没有代次：连接异常后排下的退避定时器，会在用户切回页面之后触发 ——
                //   而 visibilitychange / pageshow / online 都会重新调用 subscribeToMessages()，
                //   此时 chatRealtime 已经指向**新连接**，却被旧定时器 removeChannel 掉，
                //   即「旧连接的重连任务杀掉新连接」。
                //   注：DM Realtime 目前本身并未真正投递（见审计 H-1：posts 不在 publication、
                //   RLS 排除 __dm__、socket 未用本应用 JWT 鉴权），所以这是**防御性修复** ——
                //   等真接通实时通道时，这个坑已经填好。
                window.__dmSubEpoch = (window.__dmSubEpoch || 0) + 1;
                var mySubEpoch = window.__dmSubEpoch;

                function createDmChannel() {
                    if (mySubEpoch !== window.__dmSubEpoch) return; // 已被更新的订阅取代
                    chatRealtime = sb.channel('chat-dms')
                        // ★ 修复：只订阅 INSERT——/api/dm/read 一次批量写 read_at 会让 N 行各产生
                        // 一个 UPDATE 事件，每个事件再触发一次全量 loadDockChatMessages（请求放大 N 倍）。
                        // 新消息到达已由 INSERT 覆盖；已读状态由本地标记 + 轮询兜底。
                        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts', filter: 'media_type=eq.' + DM_MARKER }, function(payload) {
                            var m = payload.new || payload.old;
                            if (m.media_type !== DM_MARKER) return;
                            if (!window.currentUser) return;
                            if (m.user_name !== window.currentUser && m.media_url !== window.currentUser) return;
                            var otherUser = m.user_name === window.currentUser ? m.media_url : m.user_name;
                            if (payload.eventType === 'INSERT' && m.media_url === window.currentUser && m.user_name !== window.currentUser) {
                                if (window.__xtjDmMuteReady && !window.__xtjMutedChatPeers[m.user_name]) showNotification(m.user_name, getDockChatMessagePreview(m), m.id);
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
                                        // 代次已变 = 期间有更新的订阅建立，旧定时器必须彻底放弃，
                                        //   否则会把新连接 removeChannel 掉（复审 P1-01）。
                                        if (mySubEpoch !== window.__dmSubEpoch) return;
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

            // ══════════════════════════════════════════════════════════════════
            // H-1 实时投递（Broadcast）：订阅属于自己的、不可猜的频道。
            //   为什么不用 postgres_changes：posts 既不在 supabase_realtime publication，
            //   RLS 也不允许读 __dm__，且它的过滤器没有按人过滤 —— 放开就是全站私信泄露。
            //   Broadcast 的频道名由服务端 HMAC 派生、只发给本人，天然按人隔离。
            //   收到消息后**直接把 payload 写进缓存并增量渲染**（复审 P2-02 的建议形态），
            //   不再因为一条新消息就回拉 180 条历史。
            // ══════════════════════════════════════════════════════════════════
            var dmBroadcast = { channel: null, topic: null, owner: '', epoch: 0, attempts: 0 };
            window.__xtjResetDmBroadcast = function() {
                dmBroadcast.epoch++;
                if (dmBroadcast.channel && sb) { try { sb.removeChannel(dmBroadcast.channel); } catch(e) {} }
                if (chatRealtime && sb) { try { sb.removeChannel(chatRealtime); } catch(e) {} }
                chatRealtime = null;
                window.__dmSubEpoch = (window.__dmSubEpoch || 0) + 1;
                dmBroadcast.channel = null;
                dmBroadcast.topic = null;
                dmBroadcast.owner = '';
                dmBroadcast.attempts = 0;
                if (_chatStateRefreshTimer) { clearTimeout(_chatStateRefreshTimer); _chatStateRefreshTimer = null; }
            };
            var _chatStateRefreshTimer = null;
            function refreshChatStateFromEvent(payload) {
                if (!window.currentUser) return;
                var owner = window.currentUser;
                if (typeof window.__xtjInvalidateDmListShared === 'function') window.__xtjInvalidateDmListShared();
                if (_chatStateRefreshTimer) clearTimeout(_chatStateRefreshTimer);
                _chatStateRefreshTimer = setTimeout(function() {
                    _chatStateRefreshTimer = null;
                    if (owner !== window.currentUser) return;
                    window.dockChatListCacheTime = 0;
                    loadDockChatList();
                    updateUnreadBadge();
                    if (dockChatActiveUser && payload && (!payload.peer || payload.peer===dockChatActiveUser) &&
                        ['read','mark_read','sent','withdraw','delete_message','edit','reaction','transcript','refresh','reconnect','clear','delete'].indexOf(payload.kind) >= 0) {
                        loadDockChatMessages(dockChatActiveUser,false);
                    }
                    if (payload && typeof window.__xtjRefreshChatMessageExtras === 'function') window.__xtjRefreshChatMessageExtras(payload);
                    if (payload && ['friend_request','friendship','block','friend_note'].indexOf(payload.kind) >= 0 &&
                        typeof window.__xtjRefreshChatSocialState === 'function') window.__xtjRefreshChatSocialState();
                },180);
            }

            function applyRealtimeDmMessage(message) {
                try {
                    if (!message || !message.id) return;
                    if (!window.currentUser) return;
                    if (message.media_type !== DM_MARKER) return;
                    if (message.user_name !== window.currentUser && message.media_url !== window.currentUser) return;
                    var isMine = message.user_name === window.currentUser;
                    var otherUser = isMine ? message.media_url : message.user_name;
                    if (!otherUser || otherUser === window.currentUser) return;
                    // 增量：把 payload 直接并入该会话缓存（同 id 的乐观消息就地被替换），
                    //   不再触发 loadDockChatMessages 的全量回拉。
                    upsertDockChatCacheMessage(otherUser, message);
                    var convOpen = (currentDockTab === 'chat' && !document.hidden && dockChatActiveUser === otherUser);
                    if (convOpen) {
                        var key = getDockChatCacheKey(otherUser);
                        _chatRenderSignature[otherUser] = undefined;
                        renderDockMessages(otherUser, _chatCache[key] || [], false);
                        if (!isMine && currentDockTab === 'chat' && !document.hidden && !getDMMessageReadAt(message)) {
                            window.markMessagesRead(otherUser,_chatCache[key] || [],[{id:message.id}]).catch(function() {
                                scheduleDockChatListRefresh(120);
                            });
                        }
                    }
                    // 会话列表就地更新预览/时间/排序；缓存标记失效，下次打开列表仍取权威值。
                    //   ⚠ 只在列表**已经有渲染内容**时才就地改行：applyDockChatConversationPreview
                    //   会把「它收集到的会话」整体重排渲染，若此刻列表为空，它会拿"只有一条"的
                    //   数组去渲染，把完整列表临时覆盖成一条。未渲染时靠 cacheTime=0 在打开时取权威值。
                    window.dockChatListCacheTime = 0;
                    var _convListEl = document.getElementById("dockChatList");
                    if (_convListEl && _convListEl.querySelector(".chat-list-item")) {
                        applyDockChatConversationPreview(otherUser, message, 0);
                    }
                    if (!isMine && !convOpen) {
                        updateUnreadBadge();
                        if (window.__xtjDmMuteReady && !window.__xtjMutedChatPeers[message.user_name]) showNotification(message.user_name, getDockChatMessagePreview(message), message.id);
                    }
                } catch (e) { console.warn("[dm-realtime] apply failed:", e && e.message); }
            }

            async function subscribeToDmBroadcast() {
                var owner=window.currentUser || '';
                if (dmBroadcast.owner !== owner) {
                    window.__xtjResetDmBroadcast();
                    dmBroadcast.owner=owner;
                }
                if (!sb || !owner) return;
                if (typeof window.xtjProtectedFetch !== "function") return;
                dmBroadcast.epoch += 1;
                var myEpoch = dmBroadcast.epoch;
                try {
                    if (!dmBroadcast.topic) {
                        var resp = await window.xtjProtectedFetch("/api/dm/realtime-topic");
                        if (!resp || !resp.ok) { console.warn("[dm-realtime] topic fetch", resp && resp.status); return; }
                        var data = await resp.json().catch(function () { return {}; });
                        if (!data || !data.ok || !data.topic) return;
                        if (myEpoch !== dmBroadcast.epoch || owner !== window.currentUser) return;
                        dmBroadcast.topic = data.topic;
                    }
                } catch (e) { return; }
                if (myEpoch !== dmBroadcast.epoch || owner !== window.currentUser) return;
                try {
                    if (dmBroadcast.channel) { sb.removeChannel(dmBroadcast.channel); dmBroadcast.channel = null; }
                } catch (e) {}
                try {
                    dmBroadcast.channel = sb.channel(dmBroadcast.topic, { config: { broadcast: { self: false } } })
                        .on("broadcast", { event: "dm" }, function (payload) {
                            if (myEpoch !== dmBroadcast.epoch) return;
                            var msg = payload && payload.payload && payload.payload.message;
                            applyRealtimeDmMessage(msg);
                        })
                        .on("broadcast", { event: "chat-state" }, function(payload) {
                            if (myEpoch !== dmBroadcast.epoch) return;
                            refreshChatStateFromEvent(payload && payload.payload);
                        })
                        .on("broadcast", { event: "typing" }, function(payload) {
                            if (myEpoch !== dmBroadcast.epoch) return;
                            if (typeof window.__xtjApplyChatTyping === 'function') window.__xtjApplyChatTyping(payload && payload.payload);
                        })
                        .on("broadcast", { event: "presence" }, function(payload) {
                            if (myEpoch !== dmBroadcast.epoch) return;
                            if (typeof window.__xtjRefreshChatPresence === 'function') window.__xtjRefreshChatPresence(payload && payload.payload && payload.payload.peer);
                        })
                        .subscribe(function (status) {
                            if (status === "SUBSCRIBED") {
                                dmBroadcast.attempts = 0;
                                refreshChatStateFromEvent({kind:'reconnect'});
                                if (typeof window.__xtjRefreshChatPresence === 'function') window.__xtjRefreshChatPresence();
                                return;
                            }
                            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
                                console.warn("[dm-realtime]", status);
                                dmBroadcast.attempts += 1;
                                var backoff = Math.min(1000 * Math.pow(2, dmBroadcast.attempts), 30000);
                                setTimeout(function () {
                                    // 代次校验：期间若已重建订阅，旧定时器必须彻底放弃（与 P1-01 同一教训）
                                    if (myEpoch !== dmBroadcast.epoch || owner !== window.currentUser) return;
                                    subscribeToDmBroadcast();
                                }, backoff);
                            }
                        });
                } catch (e) { console.warn("[dm-realtime] subscribe failed:", e && e.message); }
            }
            window.subscribeToDmBroadcast = subscribeToDmBroadcast;

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
                            if (window.__xtjApplyPostDetailComment) window.__xtjApplyPostDetailComment(payload.eventType, row);
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
                                // ★ 2026-09-27 修复（审计 P11：DELETE 只删 DOM，不同步「评论 N」计数）：
                                //   此前只移除单个 .comment-item 节点，卡片上的「评论 N」统计行与
                                //   「评论记录」面板仍停留在删除前的数字，直到下一次全量刷新才对上。
                                //   这里复用 04 导出的单卡片重绘入口（P2 引入），按最新 feedAllComments
                                //   重绘本帖卡片，统计行与评论树随之一致。
                                //   注意只在 post_id 可用时调用；拿不到就退化为「等下次全量刷新」，
                                //   不做无谓的整屏重绘（那正是 P2 要消灭的）。
                                if (row.post_id != null && typeof window.__xtjSchedulePostCardPatch === 'function') {
                                    try { window.__xtjSchedulePostCardPatch(row.post_id); } catch (ePatchDel) {}
                                }
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
                                    // ★ 2026-09-27 修复（审计 P2）：普通评论不再全量重建 feed。
                                    //   旧实现调 renderFeedFromMemoryState()，即 `feed.innerHTML = 全部卡片`
                                    //   整段重建 —— 评论草稿丢失、滚动位置被拽回、图片重新请求、
                                    //   评论区展开状态与小猫 AI 气泡全部重置。现在改走单卡片局部更新，
                                    //   只有该卡片不在 DOM 中时才回退到全量刷新（保证不退化）。
                                    if (row.post_id != null && typeof window.__xtjSchedulePostCardPatch === 'function') {
                                        try { window.__xtjSchedulePostCardPatch(row.post_id); }
                                        catch (ePatch) {
                                            if (typeof renderFeedFromMemoryState === 'function') renderFeedFromMemoryState().catch(function() {});
                                        }
                                    } else if (typeof renderFeedFromMemoryState === 'function') {
                                        renderFeedFromMemoryState().catch(function() {});
                                    }
                                }
                            } else if (payload.eventType === 'UPDATE') {
                                // 更新已有评论
                                var updatePostVisible = (feedAllPosts || []).some(function(post) {
                                    return String(post && post.id) === String(row.post_id);
                                });
                                if (updatePostVisible) {
                                    feedAllComments = (feedAllComments || []).map(function(comment) {
                                        return String(comment && comment.id) === commentId ? row : comment;
                                    });
                                    profileActivityState.comments = (profileActivityState.comments || []).map(function(comment) {
                                        return String(comment && comment.id) === commentId ? row : comment;
                                    });
                                    if (typeof window.__xtjSchedulePostCardPatch === 'function') {
                                        try { window.__xtjSchedulePostCardPatch(row.post_id); } catch (ePatchUpdate) {}
                                    }
                                }
                            }
                            // ★ 修复：全站任意用户的评论变更都会推给所有在线端；此前无条件执行
                            // 全量快照序列化 + 个人页重渲染（跨用户写放大）。仅当评论所属帖子
                            // 存在于本地 feed 时才做这些副作用。
                            var affectsLocalFeed = (row && row.post_id != null)
                                ? (feedAllPosts || []).some(function(p) { return String(p && p.id) === String(row.post_id); })
                                : true;
                            if (affectsLocalFeed && typeof writeFeedCacheSnapshot === 'function') writeFeedCacheSnapshot();
                            if (affectsLocalFeed && typeof renderProfileActivity === 'function') renderProfileActivity();
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
                subscribeToLikes();
            }

            function subscribeToLikes() {
                if (!sb) return;
                window.__likesSubEpoch = (window.__likesSubEpoch || 0) + 1;
                var mySubEpoch = window.__likesSubEpoch;
                if (likesRealtime) {
                    try { sb.removeChannel(likesRealtime); } catch (e) {}
                    likesRealtime = null;
                }
                var reconnectAttempts = 0;
                function createChannel() {
                    if (mySubEpoch !== window.__likesSubEpoch) return;
                    likesRealtime = sb.channel('feed-likes')
                        .on('postgres_changes', { event: '*', schema: 'public', table: 'likes' }, function(payload) {
                            var row = payload && (payload.new || payload.old);
                            if (!row || row.id == null || row.post_id == null) return;
                            if (typeof window.__xtjApplyRealtimeLike === 'function') {
                                window.__xtjApplyRealtimeLike(payload.eventType, row);
                            }
                        })
                        .subscribe(function(status, err) {
                            if (status === 'SUBSCRIBED') {
                                reconnectAttempts = 0;
                                return;
                            }
                            if (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT' && status !== 'CLOSED') return;
                            console.warn('[LIKES-REALTIME]', status, err);
                            if (reconnectAttempts >= 10) return;
                            reconnectAttempts++;
                            var backoff = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
                            setTimeout(function() {
                                if (mySubEpoch !== window.__likesSubEpoch) return;
                                if (likesRealtime) {
                                    try { sb.removeChannel(likesRealtime); } catch (e) {}
                                    likesRealtime = null;
                                }
                                createChannel();
                            }, backoff);
                        });
                }
                createChannel();
            }

            if (window.currentUser) subscribeToComments();

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
                // ★ 2026-09-26（审计 P2-30）：恢复联网时撤掉离线提示条
                try {
                    var offlineBar = document.getElementById('xtjOfflineBar');
                    if (offlineBar && offlineBar.parentNode) offlineBar.parentNode.removeChild(offlineBar);
                } catch (eOff) {}
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
            // ★ 2026-09-26（审计 P2-30）：断网提示。此前只有 online 恢复路径，
            //   断网时点发布/点赞只能等到超时才给出笼统提示。这里加一个常驻提示条，
            //   并让 xtjProtectedFetch 在 navigator.onLine === false 时立刻给出明确文案。
            window.addEventListener('offline', function() {
                try {
                    if (document.getElementById('xtjOfflineBar')) return;
                    var bar = document.createElement('div');
                    bar.id = 'xtjOfflineBar';
                    bar.setAttribute('role', 'status');
                    bar.setAttribute('aria-live', 'polite');
                    bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom, 0px) + 76px);z-index:9999;background:#ff3b60;color:#fff;padding:8px 16px;border-radius:999px;font-size:13px;box-shadow:0 6px 18px rgba(255,59,96,.35);';
                    bar.textContent = '网络已断开，请检查连接';
                    if (document.body) document.body.appendChild(bar);
                } catch (eOff2) {}
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
                // Broadcast is immediate; a sitewide list-only poll covers disconnections.
                interval = Math.min(interval || 30000,30000);
                if (dmpollTimer) {
                    if (dmpollInterval === interval) return;
                    clearInterval(dmpollTimer); dmpollTimer = null;
                }
                dmpollInterval = interval;
                var polling = false;
                async function pollNow() {
                    if (!window.currentUser || document.hidden || polling) return;
                    polling=true;
                    try {
                        await updateUnreadBadge();
                        if (currentDockTab === 'chat' && typeof dockChatActiveUser !== 'undefined' && dockChatActiveUser) {
                            // ★ 2026-09-25：轮询属于后台刷新，禁止动 loading 骨架/空状态，
                            //   否则回包会把用户当前界面顶掉重画（闪屏）。
                            await loadDockChatMessages(dockChatActiveUser, false, true);
                        }
                    } catch(e) {} finally { polling=false; }
                }
                if (!skipImmediate) pollNow();
                dmpollTimer = setInterval(pollNow, interval);
            }

            function stopDMPolling() {
                if (dmpollTimer) { clearInterval(dmpollTimer); dmpollTimer = null; dmpollInterval = null; }
            }

            function setUnreadBadgeCount(cnt) {
                var badge = document.getElementById('navChatBadge');
                var count = Number(cnt) || 0;
                if (!badge) return;
                if (count > 0) {
                    badge.textContent = count > 99 ? '99+' : String(count);
                    badge.classList.add('show');
                } else {
                    // ★ 2026-09-25 修复（审计 M-11）：清零时必须同时清空文本。
                    //   desktop-shell.js 的 syncChatBadge 是按 textContent 把导航角标镜像到
                    //   桌面侧栏 #desktopChatBadge 的，只摘 .show 会让侧栏长期显示过期未读数。
                    badge.textContent = '';
                    badge.classList.remove('show');
                }
            }

            var _dmUnreadFetchedAt = 0;
            // 供 loadDockChatList 在写入角标后打点，避免紧随其后再打一次同样的请求
            window.__xtjNoteDmUnreadFresh = function() { _dmUnreadFetchedAt = Date.now(); };

            // ★ 2026-09-25 性能修复：/api/dm/list 是聊天里最重的接口（要扫两个方向的消息），
            //   而会话列表（loadDockChatList）与未读角标（updateUnreadBadge）都要用它 ——
            //   启动时两者在同一帧先后触发，等于并发打两次同一个重接口。
            //   这里做单飞 + 3 秒短缓存；缓存的是**解析后的 JSON**（Response body 只能消费一次，
            //   直接共享 Response 会让第二个调用方拿到 "body already used"）。
            var _dmListShared = { at: 0, json: null, inflight: null, owner: '', epoch: 0, retryAt: 0, failures: 0 };
            window.__xtjInvalidateDmListShared = function() {
                _dmListShared.epoch++;
                _dmListShared.at = 0;
                _dmListShared.retryAt = 0; _dmListShared.failures = 0;
                _dmListShared.json = null;
                _dmListShared.inflight = null;
                _dmUnreadFetchedAt = 0;
            };
            window.__xtjMutedChatPeers = {};
            window.__xtjDmMuteReady = false;
            function authoritativeDmUnread(conversations) {
                var total = 0;
                var muted = {};
                (conversations || []).forEach(function(c) {
                    if (!c || c.deleted) return;
                    var isMuted = !!c.muted_until && (c.muted_until === 'infinity' || Date.parse(c.muted_until) > Date.now());
                    if (isMuted) muted[c.peer_name] = true;
                    else total += Math.max(0, Number(c.unread_count) || 0);
                });
                window.__xtjMutedChatPeers = muted;
                window.__xtjDmMuteReady = true;
                return total;
            }
            window.__xtjAuthoritativeDmUnread = authoritativeDmUnread;
            function fetchDmListShared(limit, options) {
                options = options || {};
                var now = Date.now();
                var owner = window.currentUser || '', identityEpoch = window._authStateEpoch || 0;
                if (_dmListShared.owner !== owner || _dmListShared.authEpoch !== identityEpoch) {
                    window.__xtjInvalidateDmListShared();
                    _dmListShared.owner = owner;
                    _dmListShared.authEpoch = identityEpoch;
                    window.__xtjMutedChatPeers = {};
                    window.__xtjDmMuteReady = false;
                    setUnreadBadgeCount(0);
                }
                var epoch = _dmListShared.epoch;
                if (_dmListShared.json && (now - _dmListShared.at) < 3000) {
                    return Promise.resolve(_dmListShared.json);
                }
                if (_dmListShared.inflight) return _dmListShared.inflight;
                if (now < _dmListShared.retryAt) return Promise.resolve(null);
                // ★ 2026-09-27（M15 配套）：本函数是 DM 轮询的主链路
                //   （startDMPolling → pollNow → updateUnreadBadge → 这里），属后台被动请求。
                //   显式标记 background，让 ensureProtectedOperationAuth 保留 refresh 冷却，
                //   避免每 60 秒一轮的轮询把「401/403 后 30 秒不重试」的冷却反复清零，
                //   持续打 /api/user/refresh。用户主动操作（点按钮）走其它路径，不受影响。
                async function fetchListAttempt() {
                    for (var attempt=0; attempt<2; attempt++) {
                        if (_dmListShared.epoch!==epoch || window.currentUser!==owner || (window._authStateEpoch || 0)!==identityEpoch) return null;
                        try {
                            var response=await window.xtjProtectedFetch('/api/dm/list?limit='+encodeURIComponent(String(limit||180)), {background:options.background !== false,timeoutMs:12000,authOwner:owner,authEpoch:identityEpoch});
                            if (response && response.ok) return await response.json();
                            if (!response || (response.status!==429 && response.status<500)) return null;
                        } catch (_) {}
                        if (attempt===0) await new Promise(function(resolve){setTimeout(resolve,800);});
                    }
                    return null;
                }
                var p=fetchListAttempt().then(function(json){
                    if (_dmListShared.epoch!==epoch || window.currentUser!==owner || (window._authStateEpoch || 0)!==identityEpoch) return null;
                    if (json && json.ok) {
                        _dmListShared.json=json; _dmListShared.at=Date.now();
                        _dmListShared.retryAt=0; _dmListShared.failures=0;
                        observeDmSnapshot(json);
                    } else {
                        _dmListShared.failures++;
                        _dmListShared.retryAt=Date.now()+Math.min(60000,5000*Math.pow(2,_dmListShared.failures-1));
                    }
                    _dmListShared.inflight=null;return json;
                }).catch(function(){if(_dmListShared.epoch===epoch){_dmListShared.inflight=null;_dmListShared.retryAt=Date.now()+5000;}return null;});
                _dmListShared.inflight = p;
                return p;
            }
            window.fetchDmListShared = fetchDmListShared;

            async function updateUnreadBadge() {
                if (!window.currentUser) { setUnreadBadgeCount(0); return; }
                // ★ 2026-09-25 修复（审计 H-2，严重）：旧实现用浏览器端 anon key 直连
                //   Supabase 查 posts 里 media_type = '__dm__' 的行来数未读。但 posts 的 RLS
                //   白名单（migrations/015、035）**显式排除了 __dm__** —— 该查询不报错，
                //   只是被 RLS 过滤成空数组，于是每次调用都把角标"成功地"写成 0。
                //   而它在启动后 90ms、每次轮询、每次发消息/标记已读时都会跑，等于反复
                //   抹掉 loadDockChatList 算出来的正确数字 —— 用户因此漏消息。
                //   未读数是安全敏感数据，必须走后端（service_role）。这里改为复用
                //   /api/dm/list，并用 aggregateDmUnread 保证与会话列表口径完全一致。
                if (Date.now() - _dmUnreadFetchedAt < 5000) return;
                try {
                    // 走共享单飞请求：与会话列表复用同一份结果，不再并发两次
                    var result = await fetchDmListShared(180);
                    if (!result || !result.ok) return;
                    _dmUnreadFetchedAt = Date.now();
                    setUnreadBadgeCount(Array.isArray(result.conversations)
                        ? authoritativeDmUnread(result.conversations)
                        : aggregateDmUnread(result.data || []).total);
                    if (Array.isArray(result.conversations) && typeof window.__xtjApplyConversationSnapshot === 'function') {
                        window.__xtjApplyConversationSnapshot(result.conversations);
                    }
                } catch (e) {
                    // 网络失败时保留上一次的角标 —— 清零等于谎报"没有未读"
                }
            }
            window.updateUnreadBadge = updateUnreadBadge;
            window.startDMPolling = startDMPolling;

            // ===================== 举报回复通知检测 =====================
            var reportReplyPollTimer = null;
            var REPORT_REPLY_POLL_INTERVAL = 30000; // 30秒

            async function checkReportReplies() {
                if (!window.currentUser) return;
                try {
                    // 兼容新旧API：优先用后端通知API，降级到本地检测
                    var unread = 0;
                    if (typeof window.xtjProtectedFetch !== 'function') return;
                    var notifRes = await window.xtjProtectedFetch('/api/report/notifications', { background: true });
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
