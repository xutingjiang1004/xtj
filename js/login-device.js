(function() {
    'use strict';
    // 数据采集说明：本文件所有采集项默认关闭，仅在用户明示同意或服务端开关放行时才采集。
    // 逐条清单、用途与默认状态见项目根目录 DATA_COLLECTION_COMPLIANCE.js —— 该文件是唯一真源，
    // 任何采集行为的变更都必须同步更新它。
    // （原此处的「均已通过法律审核、用户已同意隐私条款……请勿删除或禁用任何采集功能」表述
    //   已按 2026-09-22 审计意见移除：代码注释无法构成法律审核的证据，且与合规清单自相矛盾。）
    // 2026-09-22 合规整改：通讯录读取与剪贴板读取功能已按合规清单要求【整体移除】——
    //   window.xtjImportContacts / window.xtjUploadClipboard 及对应后端接口
    //   /api/user/consented-data、/admin/clipboard-data 均已删除，不再采集这两类数据。
    // 2026-09-03 安全审计修订：
    //  1) WebRTC 内网 IP（局域网地址）采集已整体移除，webrtc_local_ips 不再产生/上传；
    //  2) doSend 一律“先读服务端 record_device 开关”，开关未明确开启时不做任何采集与上传；
    //  3) window.fetch / localStorage.setItem 的全局改写保留但加幂等保护，收敛需产品决策。


    var API_BASE = (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || window.location.origin;
    // 获取或生成 device_id
    function getOrCreateDeviceId() {
        try {
            var id = window.safeStorage.get('xtj_device_id');
            if (id) return id;
        } catch(e) {}
        id = id || '';
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            id = crypto.randomUUID();
        } else {
            id = 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
        }
        try { window.safeStorage.set('xtj_device_id', id); } catch(e) {}
        return id;
    }

    // Retired client login/device collectors cannot be re-enabled by historical settings.
    // Authoritative authentication events are recorded on the server.
    function doSend() { return; }
    window.logLoginEventSafe = function() { return; };
    window.logLoginVisitSafe = function() { return; };

    // 精确位置只能由用户主动开启。浏览器会显示系统权限提示；拒绝后不重试或绕过。
    var locationWatchId = null;
    var lastLocationSentAt = 0;
    var lastLocationPoint = null;
    var locationSentForPage = false;
    var locationPageLoadId = 'page_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    function setLocationStatus(text) {
        if (text) {
            try { sessionStorage.setItem('xtj_loc_status', String(text).slice(0, 200)); } catch(e) {}
        }
    }
    function stopLocationSharing(statusText) {
        if (locationWatchId !== null && navigator.geolocation) {
            try { navigator.geolocation.clearWatch(locationWatchId); } catch (e) {}
        }
        locationWatchId = null;
        setLocationStatus(statusText || '位置共享已关闭');
    }
    function locationDistanceMeters(a, b) {
        if (!a || !b) return Infinity;
        var rad = Math.PI / 180;
        var dLat = (b.lat - a.lat) * rad;
        var dLng = (b.lng - a.lng) * rad;
        var x = dLng * Math.cos((a.lat + b.lat) * rad / 2);
        return Math.sqrt(dLat * dLat + x * x) * 6371000;
    }
    function locationIdentity() { return { owner: window.currentUser, epoch: window.__xtjGetAuthEpoch ? window.__xtjGetAuthEpoch() : 0 }; }
    function locationIdentityCurrent(identity) { return !!identity.owner && identity.owner === window.currentUser && identity.epoch === (window.__xtjGetAuthEpoch ? window.__xtjGetAuthEpoch() : 0); }
    async function sendPreciseLocation(position, captureReason, identity) {
        identity = identity || locationIdentity();
        if (!locationIdentityCurrent(identity)) return;
        var coords = position && position.coords;
        if (!coords) return;
        var now = Date.now();
        var point = { lat: Number(coords.latitude), lng: Number(coords.longitude) };
        var isWatchUpdate = captureReason === 'watch_update' || captureReason === 'watch_retry';
        var sharingOn = false;
        try { sharingOn = !!window.safeStorage.get('xtj_location_sharing_enabled'); } catch (e) {}
        // ★ 修复：页面级首次发送用 locationSentForPage 去重；但"持续共享"(watch 更新)
        // 此前被该标记恒拦截——位置只上报一次、watchPosition 更新是死代码。
        // 持续共享期间按 30 分钟 / 移动 500m 节流继续上报。
        if (locationSentForPage && !isWatchUpdate) return;
        if (isWatchUpdate) {
            if (!sharingOn) return; // 共享已关闭时忽略 watch 更新
            if (now - lastLocationSentAt < 30 * 60 * 1000 && locationDistanceMeters(lastLocationPoint, point) < 500) return;
        } else if (now - lastLocationSentAt < 60000 && locationDistanceMeters(lastLocationPoint, point) < 50) {
            return;
        }
        // 立即标记防止竞态：watchPosition可能在fetch期间再次触发，导致重复上传
        locationSentForPage = true;
        lastLocationSentAt = now;
        lastLocationPoint = point;
        // 首次发送完成后停止 watch，避免并发；持续共享（watch_update）不停止
        if (!isWatchUpdate && locationWatchId !== null && navigator.geolocation) {
            try { navigator.geolocation.clearWatch(locationWatchId); } catch (e) {}
            locationWatchId = null;
        }
        var reason = captureReason || 'page_refresh';
        if (!window.xtjProtectedFetch) { locationSentForPage = false; setLocationStatus('请先登录后再共享位置'); return; }
        setLocationStatus('正在上传坐标…');
        var response;
        try {
            response = await window.xtjProtectedFetch('/api/user/location', {
                authOwner: identity.owner, authEpoch: identity.epoch,
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    latitude: point.lat,
                    longitude: point.lng,
                    accuracy: Number(coords.accuracy),
                    altitude: coords.altitude == null ? null : Number(coords.altitude),
                    altitude_accuracy: coords.altitudeAccuracy == null ? null : Number(coords.altitudeAccuracy),
                    heading: coords.heading == null ? null : Number(coords.heading),
                    speed: coords.speed == null ? null : Number(coords.speed),
                    captured_at: new Date(position.timestamp || now).toISOString(),
                    page_load_id: locationPageLoadId,
                    capture_reason: reason
                })
            });
        } catch (netErr) {
            if (!locationIdentityCurrent(identity)) return;
            locationSentForPage = false;
            setLocationStatus('上传失败：网络错误，点击重试');
            return;
        }
        if (!locationIdentityCurrent(identity)) return;
        var data = null;
        var parseError = null;
        try { data = await response.json(); } catch (e) { parseError = e; }
        if (!locationIdentityCurrent(identity)) return;
        if (!response.ok || parseError) {
            locationSentForPage = false;
            var serverCode = (data && data.code) || 'unknown';
            var serverMsg = (data && data.error) || ('HTTP ' + response.status);
            setLocationStatus('上传失败：' + serverMsg + '（' + serverCode + '），点击重试');
            return;
        }
        // 验证服务端返回
        if (!data || data.ok !== true || data.stored !== true) {
            locationSentForPage = false;
            setLocationStatus('坐标未保存到服务器，点击重试');
            return;
        }
        var returnedLoc = data.location;
        if (!returnedLoc || !Number.isFinite(Number(returnedLoc.latitude)) || !Number.isFinite(Number(returnedLoc.longitude))) {
            locationSentForPage = false;
            setLocationStatus('服务端返回坐标异常，点击重试');
            return;
        }
        // 验证返回坐标与提交值一致
        var latDiff = Math.abs(Number(returnedLoc.latitude) - point.lat);
        var lngDiff = Math.abs(Number(returnedLoc.longitude) - point.lng);
        if (latDiff > 0.0001 || lngDiff > 0.0001) {
            locationSentForPage = false;
            setLocationStatus('服务端返回坐标与提交不一致，点击重试');
            return;
        }
        // 所有验证通过，locationSentForPage已在函数开头设置，无需重复
        try { window.safeStorage.set('xtj_location_sharing_enabled', '1'); window.safeStorage.set('xtj_location_sharing_owner', identity.owner); } catch (e) {}
        var resolutionStatus = data.resolution_status || 'pending';
        var accuracyText = Math.round(Number(coords.accuracy) || 0) + ' 米';
        if (resolutionStatus === 'resolved' && data.address) {
            setLocationStatus('定位已保存 · ' + (typeof data.address === 'string' ? data.address : '已解析') + ' · 精度约 ' + accuracyText);
        } else if (resolutionStatus === 'pending') {
            setLocationStatus('坐标已保存，地址解析中 · 精度约 ' + accuracyText);
        } else if (resolutionStatus === 'failed') {
            setLocationStatus('坐标已保存，地址解析失败 · 精度约 ' + accuracyText);
        } else {
            setLocationStatus('定位已保存 · 精度约 ' + accuracyText);
        }
    }
    window.xtjSetLocationSharing = function(enabled) {
        if (!enabled) {
            try { window.safeStorage.remove('xtj_location_sharing_enabled'); window.safeStorage.remove('xtj_location_sharing_owner'); } catch (_) {}
            stopLocationSharing('位置共享已关闭'); return;
        }
        var identity = locationIdentity();
        if (!identity.owner) { setLocationStatus('请先登录后再共享位置'); return; }
        if (!window.isSecureContext || !navigator.geolocation) { stopLocationSharing('当前浏览器不支持安全定位'); return; }
        if (locationWatchId !== null) return;
        locationSentForPage = false;
        setLocationStatus('正在请求系统定位权限…');
        navigator.geolocation.getCurrentPosition(async function(position) {
            if (!locationIdentityCurrent(identity)) return;
            try { await sendPreciseLocation(position, 'manual', identity); }
            catch (_) { if (locationIdentityCurrent(identity)) setLocationStatus('位置上传失败，点击重试'); }
            if (!locationIdentityCurrent(identity)) return;
            locationWatchId = navigator.geolocation.watchPosition(function(pos) {
                if (!locationIdentityCurrent(identity)) return;
                sendPreciseLocation(pos, 'watch_update', identity).catch(function(err) { if (locationIdentityCurrent(identity)) console.warn('[XTJ-LOC]', err); });
            }, function(error) {
                if (!locationIdentityCurrent(identity)) return;
                if (error && error.code === 1) {
                    try { window.safeStorage.remove('xtj_location_sharing_enabled'); window.safeStorage.remove('xtj_location_sharing_owner'); } catch (_) {}
                    stopLocationSharing('定位权限已拒绝');
                } else setLocationStatus('定位失败，请重试');
            }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 });
        }, function(error) {
            if (!locationIdentityCurrent(identity)) return;
            stopLocationSharing(error && error.code === 1 ? '定位权限已拒绝' : '定位失败，请重试');
        }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    };
    window.xtjStopLocationSharing = stopLocationSharing;
    window.addEventListener('pagehide', function() { stopLocationSharing('位置共享已暂停'); });
    var locationSessionIdentity = locationIdentity();
    window.addEventListener('auth-ready', function() {
        var next = locationIdentity();
        if (next.owner === locationSessionIdentity.owner && next.epoch === locationSessionIdentity.epoch) return;
        locationSessionIdentity = next; stopLocationSharing('位置共享已暂停'); locationSentForPage = false; lastLocationSentAt = 0; lastLocationPoint = null;
    });


    // DATA_COLLECTION_COMPLIANCE.js marks per-user behavior tracking OFF. There is
    // explicit per-account behavior-consent control; start closed and do
    // not infer consent from login, a server device-recording flag, or GPS consent.
    var behaviorTelemetryEnabled = false;
    var behaviorOwner = '', behaviorListenersInstalled = false, consentEpoch = 0;
    var behaviorQueue = [];
    var behaviorFlushTimer = null;
    var behaviorPending = false;
    var behaviorRetryCount = 0;
    var behaviorMaxRetries = 3;
    var behaviorRetryBaseMs = 2000;

    function sanitizeBehaviorMeta(type, meta) {
        meta = meta && typeof meta === 'object' ? meta : {};
        var safe = {};
        if (type === 'scroll_depth' && Number.isFinite(Number(meta.milestone))) safe.milestone = Math.max(0, Math.min(100, Math.round(Number(meta.milestone))));
        if (type === 'web_vital') {
            if (Number.isFinite(Number(meta.value_ms))) safe.value_ms = Math.max(0, Math.min(120000, Math.round(Number(meta.value_ms))));
            if (Number.isFinite(Number(meta.value_milli))) safe.value_milli = Math.max(0, Math.min(100000, Math.round(Number(meta.value_milli))));
        }
        if (type === 'session_summary') {
            ['duration_s', 'active_s', 'max_scroll_depth'].forEach(function(key) {
                if (Number.isFinite(Number(meta[key]))) safe[key] = Math.max(0, Math.min(key === 'max_scroll_depth' ? 100 : 86400, Math.round(Number(meta[key]))));
            });
            if (meta.clicks && typeof meta.clicks === 'object') safe.clicks = { button: Math.max(0, Math.min(10000, Number(meta.clicks.button) || 0)), link: Math.max(0, Math.min(10000, Number(meta.clicks.link) || 0)), other: Math.max(0, Math.min(10000, Number(meta.clicks.other) || 0)) };
        }
        if (type === 'form_interaction') safe = { control: ['input', 'textarea', 'select'].indexOf(String(meta.control || '')) >= 0 ? String(meta.control) : '', input_type: String(meta.input_type || '').slice(0, 20), has_value: meta.has_value === true };
        if (type === 'client_error') safe = { kind: String(meta.kind || '').slice(0, 40), source: String(meta.source || '').split('/').pop().slice(0, 80), line: Math.max(0, Math.min(1000000, Number(meta.line) || 0)) };
        return safe;
    }
    function queueBehavior(type, target, meta) {
        if (!behaviorTelemetryEnabled) return;
        if (!behaviorOwner || behaviorOwner !== window.currentUser) { behaviorQueue.length=0; behaviorTelemetryEnabled=false; return; }
        type = String(type || '').slice(0, 30);
        var safeMeta = sanitizeBehaviorMeta(type, meta);
        behaviorQueue.push({ type: type, target: String(target || '').slice(0, 80), meta: safeMeta, at: new Date().toISOString() });
        if (behaviorQueue.length > 200) behaviorQueue.shift();
        if (!behaviorFlushTimer && !behaviorPending) behaviorFlushTimer = setTimeout(flushBehavior, 5000);
    }
    window.queueBehavior = queueBehavior;

    async function flushBehavior() {
        if (behaviorFlushTimer) { clearTimeout(behaviorFlushTimer); behaviorFlushTimer = null; }
        if (!behaviorTelemetryEnabled) {
            behaviorQueue.length = 0;
            behaviorRetryCount = 0;
            return;
        }
        if (behaviorPending || !behaviorQueue.length) return;
        behaviorPending = true;
        var batch = behaviorQueue.slice(0, 50), batchOwner=behaviorOwner;
        try {
            var token = null;
            try {
                token = typeof window.ensureUserToken === 'function' ? await window.ensureUserToken() : '';
            } catch (e) { /* token refresh failed */ }
            if (!token) {
                behaviorRetryCount++;
                if (behaviorRetryCount <= behaviorMaxRetries) {
                    behaviorFlushTimer = setTimeout(flushBehavior, behaviorRetryBaseMs * Math.pow(2, behaviorRetryCount - 1));
                } else {
                    // H-34: 重试耗尽（无 token）即丢弃整个队列，避免死循环轮询；
                    // 新事件入队时 queueBehavior 会自动重新调度。
                    behaviorQueue.length = 0;
                    behaviorRetryCount = 0;
                }
                behaviorPending = false;
                return;
            }
            if (!behaviorTelemetryEnabled || window.currentUser!==batchOwner || behaviorOwner!==batchOwner) { behaviorPending=false;return; }
            var resp = await fetch(API_BASE + '/api/user/behavior', {
                method: 'POST', credentials: 'include', keepalive: true,
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ events: batch })
            });
            if (window.currentUser!==batchOwner || behaviorOwner!==batchOwner) { behaviorPending=false;return; }
            if (resp.ok) {
                removeSentBehaviors(batch);
                behaviorRetryCount = 0;
            } else {
                behaviorRetryCount++;
                if (resp.status === 401 || resp.status === 429 || resp.status >= 500) {
                    if (behaviorRetryCount <= behaviorMaxRetries) {
                        behaviorFlushTimer = setTimeout(flushBehavior, behaviorRetryBaseMs * Math.pow(2, behaviorRetryCount - 1));
                    } else {
                        removeSentBehaviors(batch);
                        // H-34: HTTP 错误重试耗尽 → 丢弃批次，不再无限重试
                        behaviorQueue.length = 0;
                        behaviorRetryCount = 0;
                    }
                } else {
                    removeSentBehaviors(batch);
                }
            }
        } catch (e) {
            if (window.currentUser!==batchOwner || behaviorOwner!==batchOwner) return;
            behaviorRetryCount++;
            if (behaviorRetryCount <= behaviorMaxRetries) {
                behaviorFlushTimer = setTimeout(flushBehavior, behaviorRetryBaseMs * Math.pow(2, behaviorRetryCount - 1));
            } else {
                // H-34: 网络错误重试耗尽 → 丢弃批次，不再无限重试
                removeSentBehaviors(batch);
                behaviorQueue.length = 0;
                behaviorRetryCount = 0;
            }
        }
        finally {
        behaviorPending = false;
        // H-34: 仅未耗尽重试时才尾调度；耗尽后由 queueBehavior 的新事件重新启动
        if (behaviorQueue.length && behaviorRetryCount <= behaviorMaxRetries && !behaviorFlushTimer && !behaviorPending) {
            behaviorFlushTimer = setTimeout(flushBehavior, 5000);
        }
        }
    }

    function removeSentBehaviors(batch) {
        var sentSet = new Set();
        batch.forEach(function(e) { sentSet.add(e.at + '|' + e.type + '|' + e.target); });
        var remaining = [];
        for (var i = 0; i < behaviorQueue.length; i++) {
            var key = behaviorQueue[i].at + '|' + behaviorQueue[i].type + '|' + behaviorQueue[i].target;
            if (!sentSet.has(key)) remaining.push(behaviorQueue[i]);
        }
        behaviorQueue = remaining;
    }

    // pagehide 处理：使用 fetch keepalive 或持久化到 localStorage
    var behaviorLastKnownToken = null;
    function rememberBehaviorToken(token) {
        if (behaviorTelemetryEnabled && token && behaviorOwner===window.currentUser) {
            behaviorLastKnownToken = token;
        }
    }
    window.__xtjRememberBehaviorToken = rememberBehaviorToken;
    function handlePagehideBehavior() {
        if (!behaviorTelemetryEnabled) {
            behaviorQueue.length = 0;
            behaviorRetryCount = 0;
            try { window.safeStorage.remove('xtj_pending_behavior'); } catch (e) {}
            return;
        }
        if (behaviorOwner!==window.currentUser) { behaviorQueue.length=0;return; }
        if (!behaviorQueue.length) return;
        var batch = behaviorQueue.slice(0, 50);
        // L2 修复：统一 token 获取函数名（其他处均用 getUserToken；旧代码用不存在的
        // window.getToken 导致 pagehide 时 token 恒为空、行为数据丢失）。
        // 注：ensureUserToken 是异步的，pagehide 场景无法等待，仅用同步缓存 + getUserToken。
        var token = behaviorLastKnownToken;
        if (!token && typeof window.getUserToken === 'function') {
            try { token = window.getUserToken(); } catch (e) {}
        }
        if (token && typeof fetch === 'function') {
            try {
                // fetch + keepalive 支持自定义请求头，适合 pagehide 场景
                fetch(API_BASE + '/api/user/behavior', {
                    method: 'POST', keepalive: true,
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                    body: JSON.stringify({ events: batch })
                }).catch(function() {});
                removeSentBehaviors(batch);
            } catch (e) {}
        }
        // 剩余未发送的保存到 localStorage，下次页面打开时恢复
        if (behaviorQueue.length) {
            try { window.safeStorage.set('xtj_pending_behavior', JSON.stringify(behaviorQueue)); } catch (e) {}
        }
    }
    // 页面加载时恢复上次未发送的行为
    function restorePendingBehavior() {
        // Remove legacy data rather than
        // restoring it and sending events collected under the previous default.
        try { window.safeStorage.remove('xtj_pending_behavior'); } catch (e) {}
        if (!behaviorTelemetryEnabled) return;
    }

    // Aggregated diagnostics intentionally omit input values, selected text, pointer
    // coordinates, media labels, and any cross-session fingerprint material.
    function initSafeAnalytics() {
        var sessionStartedAt = Date.now();
        var activeStartedAt = document.hidden ? 0 : Date.now();
        var activeMs = 0;
        var maxScrollDepth = 0;
        var scrollMilestones = {};
        var clickCounts = { button: 0, link: 0, other: 0 };
        var lastScrollTick = 0;
        var latestLcpMs = null;
        var firstInputMs = null;
        var clsValue = 0;
        var scheduleFrame = typeof window.requestAnimationFrame === 'function'
            ? window.requestAnimationFrame.bind(window)
            : function(callback) { return window.setTimeout(callback, 16); };

        window.xtjResetSafeAnalytics=function(){sessionStartedAt=Date.now();activeMs=0;activeStartedAt=behaviorTelemetryEnabled?Date.now():0;maxScrollDepth=0;clickCounts={button:0,link:0,other:0};scrollMilestones={};};
        function queueScrollMilestone() {
            if(!behaviorTelemetryEnabled||behaviorOwner!==window.currentUser)return;
            var scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
            var depth = Math.max(0, Math.min(100, Math.round((window.scrollY / scrollable) * 100)));
            maxScrollDepth = Math.max(maxScrollDepth, depth);
            [25, 50, 75, 90, 100].forEach(function(milestone) {
                if (depth >= milestone && !scrollMilestones[milestone]) {
                    scrollMilestones[milestone] = true;
                    queueBehavior('scroll_depth', 'page', { milestone: milestone });
                }
            });
        }
        window.addEventListener('scroll', function() {
            if (lastScrollTick) return;
            lastScrollTick = scheduleFrame(function() { lastScrollTick = 0; queueScrollMilestone(); });
        }, { passive: true });

        document.addEventListener('click', function(event) {
            if(!behaviorTelemetryEnabled||behaviorOwner!==window.currentUser)return;
            var element = event.target && event.target.closest ? event.target.closest('button,a,[role="button"]') : null;
            if (!element) { clickCounts.other++; return; }
            clickCounts[element.tagName === 'A' ? 'link' : 'button']++;
        }, { passive: true, capture: true });

        document.addEventListener('focusin', function(event) {
            var el = event.target;
            if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
            queueBehavior('form_interaction', 'focus', { control: el.tagName.toLowerCase(), input_type: String(el.type || '').slice(0, 20) });
        }, true);
        document.addEventListener('focusout', function(event) {
            var el = event.target;
            if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
            queueBehavior('form_interaction', 'blur', { control: el.tagName.toLowerCase(), has_value: !!el.value });
        }, true);

        window.addEventListener('error', function(event) {
            queueBehavior('client_error', 'window', { kind: 'error', source: String(event.filename || '').split('/').pop().slice(0, 80), line: Number(event.lineno) || 0 });
        });
        window.addEventListener('unhandledrejection', function() {
            queueBehavior('client_error', 'window', { kind: 'unhandledrejection' });
        });

        if (typeof PerformanceObserver === 'function') {
            var supported = PerformanceObserver.supportedEntryTypes || [];
            function observe(type, handler) { try { new PerformanceObserver(function(list){if(behaviorTelemetryEnabled&&behaviorOwner===window.currentUser)handler(list);}).observe({ type: type, buffered: true }); } catch (e) {} }
            if (supported.indexOf('largest-contentful-paint') >= 0) observe('largest-contentful-paint', function(list) {
                var entries = list.getEntries(), last = entries[entries.length - 1];
                if (last) latestLcpMs = Math.round(last.startTime || 0);
            });
            if (supported.indexOf('first-input') >= 0) observe('first-input', function(list) {
                var first = list.getEntries()[0];
                if (first && firstInputMs === null) firstInputMs = Math.round((first.processingStart || first.startTime) - first.startTime);
            });
            if (supported.indexOf('layout-shift') >= 0) {
                observe('layout-shift', function(list) { list.getEntries().forEach(function(entry) { if (!entry.hadRecentInput) clsValue += Number(entry.value) || 0; }); });
            }
        }

        document.addEventListener('visibilitychange', function() {
            if (document.hidden && activeStartedAt) { activeMs += Date.now() - activeStartedAt; activeStartedAt = 0; }
            if (!document.hidden && !activeStartedAt) activeStartedAt = Date.now();
        });
        window.addEventListener('pagehide', function() {
            if (activeStartedAt) activeMs += Date.now() - activeStartedAt;
            if (latestLcpMs !== null) queueBehavior('web_vital', 'lcp', { value_ms: latestLcpMs });
            if (firstInputMs !== null) queueBehavior('web_vital', 'fid', { value_ms: firstInputMs });
            queueBehavior('web_vital', 'cls', { value_milli: Math.round(clsValue * 1000) });
            queueBehavior('session_summary', 'page', {
                duration_s: Math.round((Date.now() - sessionStartedAt) / 1000),
                active_s: Math.round(activeMs / 1000),
                max_scroll_depth: maxScrollDepth,
                clicks: clickCounts
            });
            handlePagehideBehavior();
        }, { once: true });
    }
    // 辅助函数：从DOM元素中提取有意义的行为描述
    function getMeaningfulTarget(el) {
        if(!el)return 'unknown';
        var action=el.getAttribute('data-action');
        return String(action||el.id||el.tagName.toLowerCase()).slice(0,80);
    }
    function installBehaviorListeners() {
      if(behaviorListenersInstalled)return;behaviorListenersInstalled=true;
      if (behaviorTelemetryEnabled) {
    // 全局行为追踪：仅控件种类与固定标识，不采集输入正文。
        document.addEventListener('click',function(event){
          var control=event.target.closest&&event.target.closest('button,a,[role="button"]');if(!control)return;
          var target = getMeaningfulTarget(control);
          queueBehavior('control_click',target);
        },true);
        document.addEventListener('visibilitychange',function(){queueBehavior('visibility',document.visibilityState);});
        window.addEventListener('pageshow',function(){queueBehavior('page_view',location.pathname||'/');});
        document.addEventListener('scroll',function(){}, {passive:true});
      }
      if (behaviorTelemetryEnabled) initSafeAnalytics();
      if (behaviorTelemetryEnabled) {
        document.addEventListener('change',function(event){var control=event.target;if(['INPUT','TEXTAREA','SELECT'].includes(control.tagName))queueBehavior('form_interaction',control.id||control.tagName.toLowerCase(),{control:control.tagName.toLowerCase(),input_type:control.type||'',has_value:!!control.value});},true);
      }
    }
    function setBehaviorConsent(enabled,actor) {
      behaviorTelemetryEnabled=enabled===true&&!!actor&&actor===window.currentUser;behaviorOwner=behaviorTelemetryEnabled?actor:'';
      behaviorQueue.length=0;behaviorLastKnownToken=null;behaviorRetryCount=0;
      if(window.xtjResetSafeAnalytics)window.xtjResetSafeAnalytics();
      if(behaviorFlushTimer){clearTimeout(behaviorFlushTimer);behaviorFlushTimer=null;}
      if(behaviorTelemetryEnabled){installBehaviorListeners();queueBehavior('page_view',location.pathname||'/');}
    }
    async function refreshBehaviorConsent(){ ++consentEpoch;setBehaviorConsent(false,''); }
    // Optional operation diagnostics retired; authentication records remain server-side.

    window.addEventListener('auth-ready',refreshBehaviorConsent);
    restorePendingBehavior();
    refreshBehaviorConsent();
    // 自动后台触发定位（用户登录/注册后由系统自动调用，不暴露给用户手动控制）
    // 使用 getCurrentPosition 获取一次精准位置，不启动持续监听
    function xtjAutoStartLocation() {
        if (locationSentForPage) return;
        if (!window.isSecureContext) return;
        if (!navigator.geolocation) return;
        if (locationWatchId !== null) return;
        // H-39: 精确定位只能在用户明确开启位置共享后恢复；登录/注册流程
        // 不得自行触发权限弹窗。持久化 opt-in 只用于恢复既有授权。
        var optedIn = false;
        try { optedIn = window.safeStorage.get('xtj_location_sharing_enabled') === '1'; } catch (e) {}
        var identity = locationIdentity();
        if (!optedIn || !identity.owner || window.safeStorage.get('xtj_location_sharing_owner') !== identity.owner) return;
        setLocationStatus('正在获取定位…');
        navigator.geolocation.getCurrentPosition(function(position) {
            if (!locationIdentityCurrent(identity)) return;
            setLocationStatus('已获取坐标，准备上传');
            sendPreciseLocation(position, 'page_refresh', identity).catch(function(err) {
                if (!locationIdentityCurrent(identity)) return;
                console.warn('[XTJ-LOC] 上传定位失败:', err && err.message ? err.message : err);
                setLocationStatus('位置上传失败: ' + (err && err.message ? err.message : '未知错误'));
            });
        }, function(error) {
            if (!locationIdentityCurrent(identity)) return;
            // 记录具体错误原因，不再静默
            var errMsg = '';
            if (error) {
                if (error.code === 1) {
                    errMsg = '用户拒绝定位权限';
                    try { window.safeStorage.remove('xtj_location_sharing_enabled'); } catch (e) {}
                } else if (error.code === 2) errMsg = '定位不可用（设备GPS关闭或信号弱）';
                else if (error.code === 3) errMsg = '定位超时（10秒内未获取到位置）';
                else errMsg = '定位错误: code=' + (error.code || '?') + ' msg=' + (error.message || '');
            }
            console.warn('[XTJ-LOC]', errMsg, error);
            setLocationStatus(errMsg);
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    }

    var contextOwner='',contextSentAt=0,contextSending=false;
    async function sendBrowserContext(){
        var actor=window.currentUser,epoch=window.__xtjGetAuthEpoch ? window.__xtjGetAuthEpoch() : 0;if(!actor||!window.xtjProtectedFetch||contextSending||actor===contextOwner&&Date.now()-contextSentAt<60000)return;
        contextSending=true;var connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
        var body={language:navigator.language||null,languages:Array.from(navigator.languages||[]).slice(0,5),timezone:null,online:navigator.onLine!==false,network:{supported:false}};
        try{body.timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;}catch(_){}
        if(connection)body.network={supported:true,effective_type:connection.effectiveType,downlink_mbps:connection.downlink,rtt_ms:connection.rtt,save_data:connection.saveData===true};
        try{if(actor!==window.currentUser)return;var response=await window.xtjProtectedFetch('/api/user/browser-context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),background:true,authOwner:actor,authEpoch:epoch});if(response.ok&&actor===window.currentUser&&epoch===(window.__xtjGetAuthEpoch ? window.__xtjGetAuthEpoch() : 0)){contextOwner=actor;contextSentAt=Date.now();}}
        catch(_){}finally{contextSending=false;if(actor!==window.currentUser&&window.currentUser)sendBrowserContext();}
    }
    window.addEventListener('auth-ready',sendBrowserContext);window.addEventListener('online',sendBrowserContext);
    document.addEventListener('visibilitychange',function(){if(!document.hidden)sendBrowserContext();});sendBrowserContext();

    // 确保 device_id 已存在
    getOrCreateDeviceId();

    var _autoLocationTimer = null;

    function tryAutoLocation() {
        if (_autoLocationTimer) return;
        _autoLocationTimer = setTimeout(function() {
            _autoLocationTimer = null;
            var fn = typeof window.ensureUserToken === 'function' ? window.ensureUserToken : null;
            if (fn) {
                fn().then(function(t) { if (t) xtjAutoStartLocation(); }).catch(function() {});
            } else if (window.__xtjAuthReady) {
                xtjAutoStartLocation();
            }
        }, 1500);
    }

    function tryAutoLocationOnLoad() {
        if (_autoLocationTimer) return;
        _autoLocationTimer = setTimeout(function() {
            _autoLocationTimer = null;
            try {
                var fn = typeof window.ensureUserToken === 'function' ? window.ensureUserToken : null;
                if (!fn) { if (window.__xtjAuthReady) xtjAutoStartLocation(); return; }
                fn().then(function(t) { if (t) xtjAutoStartLocation(); }).catch(function() {});
            } catch(e) {}
        }, 2000);
    }

    var _autoLocationAttempted = false;
    function safeAutoLocation() {
        if (_autoLocationAttempted) return;
        _autoLocationAttempted = true;
        tryAutoLocation();
    }

    if (window.__xtjAuthReady) {
        safeAutoLocation();
    } else {
        window.addEventListener('auth-ready', function() {
            safeAutoLocation();
        }, { once: true });
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                if (!_autoLocationAttempted) { _autoLocationAttempted = true; tryAutoLocationOnLoad(); }
            }, { once: true });
        } else {
            if (!_autoLocationAttempted) { _autoLocationAttempted = true; setTimeout(tryAutoLocationOnLoad, 0); }
        }
    }

    // ===================== 前端错误监控（不采集输入内容） =====================
    (function() {
        var errorSent = {};
        // 定期清理过期错误缓存，防止内存泄漏
        var _errorCleanupTimer = setInterval(function() {
            var _now = Date.now();
            Object.keys(errorSent).forEach(function(k) { if (_now - errorSent[k] > 300000) delete errorSent[k]; });
        }, 600000);
        // ★ 2026-09-13 修复（S-1）：改用 pagehide 清理。
        // 现代浏览器进入 bfcache（后退/前进）时不触发 beforeunload，旧写法下该 600s
        // 定时器会跨页存活；配合下面的 errorSent 无上限增长，长会话中内存与上报去重表
        // 都会持续膨胀。pagehide 在进入 bfcache 时同样会触发，是正确时机。
        // 双注册 beforeunload 作为兜底：pagehide 在部分旧环境可能缺失。
        window.addEventListener('pagehide', function() { clearInterval(_errorCleanupTimer); });
        window.addEventListener('beforeunload', function() { clearInterval(_errorCleanupTimer); });
        function sendClientError(type, message, stack, url, line, col) {
            var errKey = (type + '|' + (message || '').slice(0, 100) + '|' + (url || '').slice(0, 100));
            var now = Date.now();
            // 去重：同类型同消息5分钟内不重复上报
            if (errorSent[errKey] && (now - errorSent[errKey] < 300000)) return;
            errorSent[errKey] = now;
            // ★ 2026-09-13 修复（S-1）：去重表增加容量上限。
            // 原实现只在 600s 定时器里清理超过 5 分钟的条目，但若错误消息本身含动态内容
            // （如带 id/时间戳的报错），key 会以远快于清理速度的速率新增，在 10 分钟窗口内
            // 可无限膨胀。超限时按最旧时间戳淘汰，保证内存有界。
            (function capErrorSent() {
                var keys = Object.keys(errorSent);
                if (keys.length <= 500) return;
                keys.sort(function(a, b) { return errorSent[a] - errorSent[b]; });
                var drop = keys.length - 400;
                for (var i = 0; i < drop; i++) delete errorSent[keys[i]];
            })();

            // 清理敏感 URL：移除 query、fragment、Blob URL、Supabase 签名参数
            var cleanUrl = sanitizeUrl(url || (window.location && window.location.href) || '');

            try {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', API_BASE + '/api/client-error-log', true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.onerror = function() {};
                xhr.send(JSON.stringify({
                    type: type,
                    message: (message || '').slice(0, 500),
                    stack: sanitizeStack(stack || ''),
                    url: cleanUrl.slice(0, 500),
                    line: line || null,
                    col: col || null,
                    user_agent: (navigator && navigator.userAgent || '').slice(0, 500),
                    timestamp: new Date().toISOString()
                }));
            } catch(e) {}
        }

        // 清理 URL 中的敏感信息：query、fragment、Blob URL、签名参数
        function sanitizeUrl(raw) {
            if (!raw || typeof raw !== 'string') return '';
            // Blob URL 完全移除
            if (/^blob:/i.test(raw)) return '[blob-url]';
            // data: URL 完全移除
            if (/^data:/i.test(raw)) return '[data-url]';
            try {
                // 移除 fragment（# 及之后）
                var hashIdx = raw.indexOf('#');
                if (hashIdx >= 0) raw = raw.substring(0, hashIdx);
                // 移除 query string（? 及之后），但保留路径
                var qIdx = raw.indexOf('?');
                if (qIdx >= 0) {
                    // 如果路径本身包含敏感信息（如 token=），也一并清理
                    raw = raw.substring(0, qIdx);
                }
                // 限制长度
                return raw.slice(0, 500);
            } catch(e) {
                return (raw || '').slice(0, 200);
            }
        }

        // 清理堆栈中的敏感信息：过长堆栈截断，移除动态用户内容
        function sanitizeStack(stack) {
            if (!stack || typeof stack !== 'string') return '';
            var cleaned = stack.slice(0, 1000);
            // 移除可能包含 token 的 URL 行
            cleaned = cleaned.replace(/(https?:\/\/[^\s)]+)/g, function(m) {
                return sanitizeUrl(m);
            });
            return cleaned;
        }

        // JS Error
        window.addEventListener('error', function(event) {
            if (!event || !event.error) return;
            sendClientError('js_error', event.error.message, event.error.stack, event.filename, event.lineno, event.colno);
        });

        // Unhandled Promise rejection
        window.addEventListener('unhandledrejection', function(event) {
            var reason = event && event.reason;
            var msg = reason ? (reason.message || String(reason)) : 'Unhandled rejection';
            sendClientError('unhandled_rejection', msg, (reason && reason.stack) || '', '', null, null);
        });

        // Fetch failure monitoring (intercept fetch)
        // M57（保守收敛）：同上，fetch 全局包装不做结构性重构；仅加幂等保护，
        // 保证调用原实现、原样抛错、不吞异常，仅在满足熔断条件时补一条错误上报。
        try {
            if (!window.fetch.__xtjFetchErrorHook) {
                var _fetchFailCount = 0;
                var _origFetch = window.fetch;
                var _fetchHook = function(input, init) {
                    // P0 修复: 正确捕获 URL, inner function 的 arguments 是它自己的
                    var _url = '';
                    try {
                        if (typeof input === 'string') _url = input;
                        else if (input && typeof input.url === 'string') _url = input.url;
                        else if (input && typeof Request !== 'undefined' && input instanceof Request) _url = input.url;
                    } catch (_e) {}
                    return _origFetch.apply(this, arguments).then(function(_res) {
                        // 成功即清零熔断计数
                        _fetchFailCount = 0;
                        return _res;
                    }).catch(function(err) {
                        // 跳过 AbortError (Supabase SDK 5s timeout / page unload 自动 abort, 不是真错误)
                        if (err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')))) {
                            throw err;
                        }
                        // 跳过我们自己上报错误的端点
                        if (_url.indexOf('/client-error-log') >= 0) throw err;
                        // ★ 熔断：连续失败达到上限后不再上报，防止故障期间打爆上报端点
                        if (_fetchFailCount >= 10) throw err;
                        _fetchFailCount++;
                        sendClientError('fetch_error', (err && err.message) || 'fetch failed', '', _url, null, null);
                        throw err;
                    });
                };
                try { _fetchHook.__xtjFetchErrorHook = true; } catch (_markErr) {}
                window.fetch = _fetchHook;
            }
        } catch(e) {}

        // Image load failure
        var IMG_ERROR_MAX_PER_SESSION = 10;
        var _imgErrorCount = 0;
        document.addEventListener('error', function(event) {
            var target = event && event.target;
            if (target && target.tagName === 'IMG') {
                // ★ data-xtj-fallback 标记的图片跳过（预期失败图）
                if (target.getAttribute && target.getAttribute('data-xtj-fallback')) return;
                // ★ 熔断：本会话最多上报 10 次 img_error，超出后静默
                if (_imgErrorCount >= IMG_ERROR_MAX_PER_SESSION) return;
                _imgErrorCount++;
                var imgSrc = sanitizeUrl((target.src || '').slice(0, 200));
                sendClientError('img_error', 'Image load failed: ' + imgSrc, '', '', null, null);
            }
        }, true);

        // 页面白屏检测（DOM 加载5秒后检查）
        window.addEventListener('DOMContentLoaded', function() {
            setTimeout(function() {
                try {
                    var body = document.body;
                    if (!body || !body.children || body.children.length === 0) {
                        sendClientError('blank_page', 'Page appears blank (no children in body)', '', window.location.href, null, null);
                        return;
                    }
                    // Check if any visible text
                    var text = (body.innerText || '').trim();
                    if (!text || text.length < 10) {
                        sendClientError('blank_page', 'Page appears blank (minimal text)', '', window.location.href, null, null);
                    }
                } catch(e) {}
            }, 5000);
        });
    })();
})();
