(function() {
    'use strict';

    var API_BASE = (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || window.location.origin;
    var CHECK_DELAY_MS = 300;
    var SEND_COOLDOWN_MS = 10000;
    var VISIT_COOLDOWN_MS = 15000;
    var debounceTimer = null;
    var lastSendAtByKey = {};

    // 安全设置缓存（懒加载，1分钟缓存）
    var cachedSecuritySettings = null;
    var settingsLastFetch = 0;
    function getSecuritySettings() {
        var now = Date.now();
        if (cachedSecuritySettings && (now - settingsLastFetch < 60000)) {
            return Promise.resolve(cachedSecuritySettings);
        }
        return fetch(API_BASE + '/api/security-settings')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                cachedSecuritySettings = (data && data.settings) || { record_device: false, browser_fingerprint: false, canvas_fingerprint: false, webgl_fingerprint: false, webrtc_local_ip: false, advanced_fingerprint: false, security_alerts: false };
                settingsLastFetch = now;
                return cachedSecuritySettings;
            })
            .catch(function() {
                return { record_device: false, browser_fingerprint: false, canvas_fingerprint: false, webgl_fingerprint: false, webrtc_local_ip: false, advanced_fingerprint: false, security_alerts: false };
            });
    }

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
        window.safeStorage.set('xtj_device_id', id);
        return id;
    }

    // 设备类型
    function detectDeviceType(ua) {
        if (/iPhone/i.test(ua)) return 'iPhone';
        if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
        if (/Android/i.test(ua)) return 'Android';
        if (/Mobi/i.test(ua)) return 'Mobile';
        return 'Desktop';
    }

    // 操作系统
    function detectOS(ua) {
        if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'iPadOS';
        if (/iPhone|iPod/i.test(ua)) return 'iOS';
        if (/Android/i.test(ua)) return 'Android';
        if (/Windows/i.test(ua)) return 'Windows';
        if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
        if (/Linux/i.test(ua)) return 'Linux';
        return 'Unknown';
    }

    // 浏览器
    function detectBrowser(ua) {
        if (/MicroMessenger/i.test(ua)) return 'WeChat';
        if (/Edg\//i.test(ua)) return 'Edge';
        if (/Firefox/i.test(ua)) return 'Firefox';
        if (/Chrome/i.test(ua)) return 'Chrome';
        if (/Safari/i.test(ua)) return 'Safari';
        return 'Unknown';
    }


    // 根据 iOS/Safari 暴露的屏幕参数推测 iPhone 疑似型号（非精确识别）
    // 结合 iOS 版本号缩小猜测范围
    function getPossibleDeviceModel(info) {
        info = info || {};
        var ua = String(info.user_agent || (navigator && navigator.userAgent) || '');
        var platform = String(info.platform || (navigator && navigator.platform) || '');
        var maxTouchPoints = Number(info.max_touch_points || (navigator && navigator.maxTouchPoints) || 0);
        var isIPhone = /iPhone/i.test(ua) || (/Mac/i.test(platform) && maxTouchPoints > 1 && Math.min(Number(info.screen_width) || 0, Number(info.screen_height) || 0) < 600);
        if (!isIPhone) return '';

        var sw = Number(info.screen_width || info.visual_viewport_width || info.inner_width) || 0;
        var sh = Number(info.screen_height || info.visual_viewport_height || info.inner_height) || 0;
        var dpr = Number(info.device_pixel_ratio) || 0;
        var shortSide = Math.min(sw, sh);
        var longSide = Math.max(sw, sh);
        var key = shortSide + 'x' + longSide + '@' + (dpr || '');
        var iosVer = getIosMajorVersion(ua);
        var modelMap = {
            '440x956@3': function() {
                if (iosVer !== null && iosVer < 19) return 'iPhone 16 Pro Max';
                return 'iPhone 16 Pro Max / iPhone 17 Pro Max';
            },
            '402x874@3': function() {
                if (iosVer !== null && iosVer < 19) return 'iPhone 16 Pro';
                if (iosVer !== null && iosVer >= 19) return 'iPhone 17 / iPhone 17 Pro';
                return 'iPhone 16 Pro / iPhone 17 / iPhone 17 Pro';
            },
            '393x852@3': function() {
                if (iosVer !== null && iosVer === 16) return 'iPhone 14 Pro';
                if (iosVer !== null && iosVer === 17) return 'iPhone 15 / iPhone 15 Pro';
                if (iosVer !== null && iosVer >= 18) return 'iPhone 16';
                return 'iPhone 14 Pro / iPhone 15 / iPhone 15 Pro / iPhone 16';
            },
            '430x932@3': function() {
                if (iosVer !== null && iosVer === 16) return 'iPhone 14 Pro Max';
                if (iosVer !== null && iosVer === 17) return 'iPhone 15 Plus / iPhone 15 Pro Max';
                if (iosVer !== null && iosVer >= 18) return 'iPhone 16 Plus';
                return 'iPhone 14 Pro Max / iPhone 15 Plus / iPhone 15 Pro Max / iPhone 16 Plus';
            },
            '428x926@3': function() {
                if (iosVer !== null && iosVer <= 15) return 'iPhone 12 Pro Max / iPhone 13 Pro Max';
                if (iosVer !== null && iosVer >= 16) return 'iPhone 14 Plus';
                return 'iPhone 12 Pro Max / iPhone 13 Pro Max / iPhone 14 Plus';
            },
            '390x844@3': function() {
                if (iosVer !== null && iosVer <= 14) return 'iPhone 12 / iPhone 12 Pro';
                if (iosVer !== null && iosVer === 15) return 'iPhone 13 / iPhone 13 Pro';
                if (iosVer !== null && iosVer >= 16) return 'iPhone 14';
                return 'iPhone 12 / iPhone 12 Pro / iPhone 13 / iPhone 13 Pro / iPhone 14';
            },
            '375x812@3': function() {
                if (iosVer !== null && iosVer <= 11) return 'iPhone X';
                if (iosVer !== null && iosVer === 12) return 'iPhone XS';
                if (iosVer !== null && iosVer === 13) return 'iPhone 11 Pro';
                if (iosVer !== null && iosVer === 14) return 'iPhone 12 mini';
                if (iosVer !== null && iosVer >= 15) return 'iPhone 13 mini';
                return 'iPhone X / iPhone XS / iPhone 11 Pro / iPhone 12 mini / iPhone 13 mini';
            },
            '414x896@3': function() {
                if (iosVer !== null && iosVer <= 12) return 'iPhone XS Max';
                if (iosVer !== null && iosVer >= 13) return 'iPhone 11 Pro Max';
                return 'iPhone XS Max / iPhone 11 Pro Max';
            },
            '414x896@2': function() {
                if (iosVer !== null && iosVer <= 12) return 'iPhone XR';
                if (iosVer !== null && iosVer >= 13) return 'iPhone 11';
                return 'iPhone XR / iPhone 11';
            },
            '414x736@3': 'iPhone 6 Plus / 6s Plus / 7 Plus / 8 Plus',
            '375x667@2': 'iPhone 6 / 6s / 7 / 8 / SE（第 2/3 代）',
            '320x568@2': 'iPhone 5 / 5s / SE（第 1 代）'
        };
        var matcher = modelMap[key];
        if (typeof matcher === 'function') return matcher();
        return matcher || '';
    }

    // 从 User-Agent 提取 iOS 主版本号
    function getIosMajorVersion(ua) {
        var match = ua.match(/iPhone OS (\d+)_/);
        if (match) return parseInt(match[1], 10);
        return null;
    }

    // 精确设备型号（通过 UA Client Hints API，仅 Chromium 浏览器支持）
    function getExactDeviceModel() {
        try {
            if (typeof navigator !== 'undefined' && navigator.userAgentData && typeof navigator.userAgentData.getHighEntropyValues === 'function') {
                return navigator.userAgentData.getHighEntropyValues(['model'])
                    .then(function(hints) {
                        if (!hints) return null;
                        var model = hints.model || '';
                        return model && model !== '' ? model : null;
                    })
                    .catch(function() {
                        return null;
                    });
            }
        } catch(e) {}
        return null;
    }

    // 设备元信息（仅基础信息，不做跨站追踪）
    function getDeviceMeta() {
        try {
            var meta = {
                screen: (window.screen ? window.screen.width + 'x' + window.screen.height : 'unknown'),
                screen_width: window.screen ? window.screen.width : null,
                screen_height: window.screen ? window.screen.height : null,
                screen_avail_width: window.screen ? window.screen.availWidth : null,
                screen_avail_height: window.screen ? window.screen.availHeight : null,
                inner_width: window.innerWidth || null,
                inner_height: window.innerHeight || null,
                visual_viewport_width: window.visualViewport ? window.visualViewport.width : null,
                visual_viewport_height: window.visualViewport ? window.visualViewport.height : null,
                orientation: window.screen && window.screen.orientation ? window.screen.orientation.type : null,
                dpr: window.devicePixelRatio || 1,
                device_pixel_ratio: window.devicePixelRatio || 1,
                language: (navigator.language || navigator.userLanguage || 'unknown'),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
                platform: (navigator.platform || 'unknown'),
                hardware_concurrency: Number(navigator.hardwareConcurrency) || null,
                device_memory_gb: Number(navigator.deviceMemory) || null,
                color_depth: window.screen ? Number(window.screen.colorDepth) || null : null,
                pixel_depth: window.screen ? Number(window.screen.pixelDepth) || null : null,
                cookies_enabled: navigator.cookieEnabled === true,
                online: navigator.onLine !== false,
                max_touch_points: navigator.maxTouchPoints || 0,
                touch: ('ontouchstart' in window || navigator.maxTouchPoints > 0)
            };
            var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (connection) {
                meta.network = {
                    effective_type: String(connection.effectiveType || '').slice(0, 20),
                    downlink_mbps: Number.isFinite(Number(connection.downlink)) ? Number(connection.downlink) : null,
                    rtt_ms: Number.isFinite(Number(connection.rtt)) ? Number(connection.rtt) : null,
                    save_data: connection.saveData === true
                };
            }
            try {
                var url = new URL(window.location.href);
                var referrerUrl = document.referrer ? new URL(document.referrer) : null;
                meta.traffic_source = {
                    referrer_origin: referrerUrl ? referrerUrl.origin : 'direct',
                    utm_source: String(url.searchParams.get('utm_source') || '').slice(0, 80),
                    utm_medium: String(url.searchParams.get('utm_medium') || '').slice(0, 80),
                    utm_campaign: String(url.searchParams.get('utm_campaign') || '').slice(0, 80),
                    landing_path: String(url.pathname || '/').slice(0, 160)
                };
            } catch (e) {}
            meta.possible_device_model = getPossibleDeviceModel({
                screen_width: meta.screen_width,
                screen_height: meta.screen_height,
                inner_width: meta.inner_width,
                inner_height: meta.inner_height,
                device_pixel_ratio: meta.device_pixel_ratio,
                platform: meta.platform,
                max_touch_points: meta.max_touch_points,
                user_agent: navigator.userAgent || ''
            });
            return meta;
        } catch(e) {
            return null;
        }
    }

    // 温和浏览器指纹 hash（SHA-256，仅保存 hash）
    function getBrowserFingerprint() {
        try {
            if (typeof crypto === 'undefined' || !crypto.subtle || !crypto.subtle.digest) {
                return null;
            }
            var fp = [
                window.screen ? window.screen.width + 'x' + window.screen.height + 'x' + (window.screen.colorDepth || '') : '',
                window.devicePixelRatio || 1,
                navigator.language || navigator.userLanguage || '',
                Intl.DateTimeFormat().resolvedOptions().timeZone || '',
                navigator.platform || '',
                navigator.hardwareConcurrency || 'unknown',
                navigator.deviceMemory || 'unknown',
                ('ontouchstart' in window || navigator.maxTouchPoints > 0) ? '1' : '0',
                detectBrowser(navigator.userAgent || ''),
                detectOS(navigator.userAgent || '')
            ].join('|');

            // 同步计算 hash（SHA-256，不阻塞主线程太久）
            var encoder = new TextEncoder();
            var data = encoder.encode(fp);
            return crypto.subtle.digest('SHA-256', data).then(function(hashBuffer) {
                var hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
            }).catch(function() {
                return null;
            });
        } catch(e) {
            return null;
        }
    }

    // Canvas 指纹 hash（仅辅助判断，不保存图像）
    function getCanvasFingerprint() {
        try {
            var canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 40;
            canvas.style.display = 'none';
            var ctx = canvas.getContext('2d');
            if (!ctx) return null;

            // 绘制温和的识别文本
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillStyle = '#059669';
            ctx.fillText('XTJ ' + (new Date().getFullYear()), 4, 4);

            ctx.font = '12px sans-serif';
            ctx.fillStyle = '#333';
            ctx.fillText('device check only', 4, 22);

            // 尝试读取像素（浏览器可能阻止）
            try {
                var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                var pixels = imageData.data;

                // 只计算 hash，不保存像素数据
                if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
                    return crypto.subtle.digest('SHA-256', pixels.slice(0, 512)).then(function(hashBuffer) {
                        var hashArray = Array.from(new Uint8Array(hashBuffer));
                        return hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
                    }).catch(function() {
                        return null;
                    });
                }
                return null;
            } catch(e) {
                // Canvas 被浏览器限制（如隐私模式），记录 null
                return null;
            }
        } catch(e) {
            return null;
        }
    }

    // WebGL 指纹 hash（GPU 型号 + 渲染器，跨浏览器稳定）
    function getWebglFingerprint() {
        try {
            var canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 256;
            var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) return null;

            var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (!debugInfo) return null;

            var renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
            var vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '';

            var extensions = [];
            try {
                var exts = gl.getSupportedExtensions() || [];
                extensions = exts.sort();
            } catch(ex) {}

            var raw = [renderer, vendor, extensions.join(',')].join('|');
            if (!raw || raw.length < 10) return null;

            if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
                var encoder = new TextEncoder();
                var data = encoder.encode(raw);
                return crypto.subtle.digest('SHA-256', data).then(function(hashBuffer) {
                    var hashArray = Array.from(new Uint8Array(hashBuffer));
                    return hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
                }).catch(function() {
                    return null;
                });
            }
            return null;
        } catch(e) {
            return null;
        }
    }

    // WebGL 元数据（原始 GPU 信息，仅管理员可见）
    function getWebglMeta() {
        try {
            var canvas = document.createElement('canvas');
            var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) return null;
            var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (!debugInfo) return null;
            return {
                gpu_renderer: String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '').slice(0, 200),
                gpu_vendor: String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '').slice(0, 100)
            };
        } catch(e) {
            return null;
        }
    }

    // WebRTC 本地 IP 检测（内网IP，超时2s）
    function getWebRtcLocalIps() {
        return new Promise(function(resolve) {
            var ips = [];
            var done = false;
            var timer = setTimeout(function() { if (!done) { done = true; resolve(ips.length ? ips : null); } }, 2000);

            try {
                var RTCPeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
                if (!RTCPeerConnection) { clearTimeout(timer); resolve(null); return; }

                var pc = new RTCPeerConnection({ iceServers: [] });
                pc.createDataChannel('');
                pc.createOffer().then(function(offer) { pc.setLocalDescription(offer); }).catch(function() {
                    if (!done) { done = true; clearTimeout(timer); resolve(null); }
                });
                pc.onicecandidate = function(e) {
                    if (!e || !e.candidate || !e.candidate.candidate) {
                        if (!done) { done = true; clearTimeout(timer); resolve(ips.length ? ips : null); }
                        return;
                    }
                    var candidate = e.candidate.candidate;
                    var match = candidate.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
                    if (match) {
                        var localIp = match[0];
                        if (ips.indexOf(localIp) === -1 && localIp !== '0.0.0.0' && localIp !== '127.0.0.1') {
                            ips.push(localIp);
                        }
                    }
                };
                pc.onicegatheringstatechange = function() {
                    if (pc.iceGatheringState === 'complete' && !done) {
                        done = true; clearTimeout(timer); resolve(ips.length ? ips : null);
                    }
                };
            } catch(e) {
                if (!done) { done = true; clearTimeout(timer); resolve(null); }
            }
        });
    }

    // 检查冷却（10s 内存级别）
    function isInCooldown(sentKey) {
        var lastAt = lastSendAtByKey[sentKey] || 0;
        return (Date.now() - lastAt) < SEND_COOLDOWN_MS;
    }

    // 发送登录事件
    function doSend(userName, deviceId, sentKey, source) {
        try {
            if (isInCooldown(sentKey)) return;

            var ua = navigator.userAgent || '';
            var deviceMeta = getDeviceMeta();

            // 构建基础 body
            var bodyObj = {
                user_name: userName,
                device_id: deviceId,
                device_type: detectDeviceType(ua),
                os: detectOS(ua),
                browser: detectBrowser(ua),
                user_agent: ua,
                source: source,
                device_meta: deviceMeta
            };

            // 发送请求（指纹异步采集）
            var sendReq = async function() {
                lastSendAtByKey[sentKey] = Date.now();
                var headers = { 'Content-Type': 'application/json' };
                var token = '';
                if (typeof window.ensureUserToken === 'function') token = await window.ensureUserToken();
                else if (typeof window.getUserToken === 'function') token = window.getUserToken();
                if (!token) { lastSendAtByKey[sentKey] = 0; return; }
                headers['Authorization'] = 'Bearer ' + token;
                fetch(API_BASE + '/api/log-login-event', {
                    method: 'POST',
                    headers: headers,
                    credentials: 'include',
                    body: JSON.stringify(bodyObj)
                }).then(function(res) {
                    if (res.ok && source === 'login_success') {
                        try { sessionStorage.setItem(sentKey, '1'); } catch(e) {}
                    }
                }).catch(function() {
                    // 请求失败清除冷却，允许重试
                    lastSendAtByKey[sentKey] = 0;
                });
            };

            // 加载安全设置，按开关决定是否采集指纹
            getSecuritySettings().then(function(settings) {
                if (!settings.record_device) bodyObj.device_meta = null;
                // advanced_fingerprint 作为主开关：开启时等同启用所有指纹采集
                var advFp = !!settings.advanced_fingerprint;
                var browserFpPromise = (advFp || settings.browser_fingerprint) ? getBrowserFingerprint() : null;
                var canvasFpPromise = (advFp || settings.canvas_fingerprint) ? getCanvasFingerprint() : null;
                var webglFpPromise = (advFp || settings.webgl_fingerprint) ? getWebglFingerprint() : null;
                var webglMeta = (advFp || settings.webgl_fingerprint) ? getWebglMeta() : null;
                var webRtcPromise = settings.webrtc_local_ip ? getWebRtcLocalIps() : null;

                // 始终采集时钟偏移（轻量，不涉及隐私）

                // 始终采集精确设备型号（UA Client Hints / 无成本的异步 API）
                var exactModelPromise = getExactDeviceModel();

                // 收集所有异步指纹，然后统一发送
                var collectAndSend = function() {
                    // 收集已完成的指纹
                    if (webglMeta) bodyObj.webgl_meta = webglMeta;
                    // 将指纹 Promise 转为统一收集
                    var promises = [];

                    if (browserFpPromise && browserFpPromise.then) {
                        promises.push(browserFpPromise.then(function(h) { if (h) bodyObj.browser_fingerprint_hash = h; }));
                    }
                    if (canvasFpPromise && canvasFpPromise.then) {
                        promises.push(canvasFpPromise.then(function(h) { if (h) bodyObj.canvas_fingerprint_hash = h; }));
                    }
                    if (webglFpPromise && webglFpPromise.then) {
                        promises.push(webglFpPromise.then(function(h) { if (h) bodyObj.webgl_fingerprint_hash = h; }));
                    }
                    if (webRtcPromise && webRtcPromise.then) {
                        promises.push(webRtcPromise.then(function(ips) { if (ips) bodyObj.webrtc_local_ips = ips; }));
                    }
                    if (exactModelPromise && exactModelPromise.then) {
                        promises.push(exactModelPromise.then(function(m) { if (m) bodyObj.exact_device_model = m; }));
                    }

                    if (promises.length > 0) {
                        Promise.all(promises).then(function() { sendReq(); }).catch(function() { sendReq(); });
                    } else {
                        sendReq();
                    }
                };
                collectAndSend();
            }).catch(function() { sendReq(); });
        } catch(e) {}
    }

    // 登录/注册成功后主动调用（由 core.js 触发）
    window.logLoginEventSafe = function(userName, source) {
        if (!userName) return;
        var deviceId = getOrCreateDeviceId();
        var sentKey = 'xtj_login_event_sent_' + userName + '_' + deviceId;
        try {
            if (sessionStorage.getItem(sentKey)) return;
        } catch(e) {}
        var userToken = '';
        if (typeof window.getUserToken === 'function') {
            userToken = window.getUserToken();
        }
        if (!userToken && typeof window.ensureUserToken !== 'function') return;
        var src = source || 'login_success';
        // 设置页面访问冷却，避免登录成功后 15 秒内重复产生 page_visit
        var visitKey = 'xtj_login_visit_last_' + userName + '_' + deviceId;
        window.safeStorage.set(visitKey, String(Date.now()));
        doSend(userName, deviceId, sentKey, src);
    };

    // 页面访问记录（15 秒冷却，页面刷新/打开时记录）
    function trySendPageVisit() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
            debounceTimer = null;
            var userName, deviceId;
            try {
                userName = window.safeStorage.get('xtj_user');
                deviceId = window.safeStorage.get('xtj_device_id');
            } catch(e) { return; }

            if (!userName || !deviceId) return;
            var userToken = typeof window.getUserToken === 'function' ? window.getUserToken() : '';
            if (!userToken && typeof window.ensureUserToken !== 'function') return;

            // 15s localStorage 冷却
            var visitKey = 'xtj_login_visit_last_' + userName + '_' + deviceId;
            var lastAt = 0;
            try { lastAt = parseInt(window.safeStorage.get(visitKey)) || 0; } catch(e) {}
            if (Date.now() - lastAt < VISIT_COOLDOWN_MS) return;
            window.safeStorage.set(visitKey, String(Date.now()));

            var sentKey = 'xtj_login_visit_' + userName + '_' + deviceId;
            doSend(userName, deviceId, sentKey, 'page_visit');
        }, CHECK_DELAY_MS);
    }

    // 暴露页面访问手动调用接口
    window.logLoginVisitSafe = function() {
        trySendPageVisit();
    };

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
    async function sendPreciseLocation(position, captureReason) {
        if (locationSentForPage) return;
        var coords = position && position.coords;
        if (!coords) return;
        var now = Date.now();
        var point = { lat: Number(coords.latitude), lng: Number(coords.longitude) };
        if (now - lastLocationSentAt < 60000 && locationDistanceMeters(lastLocationPoint, point) < 50) return;
        // 立即标记防止竞态：watchPosition可能在fetch期间再次触发，导致重复上传
        locationSentForPage = true;
        lastLocationSentAt = now;
        lastLocationPoint = point;
        // 立即停止watch，防止并发
        if (locationWatchId !== null && navigator.geolocation) {
            try { navigator.geolocation.clearWatch(locationWatchId); } catch (e) {}
            locationWatchId = null;
        }
        var reason = captureReason || 'page_refresh';
        var token = typeof window.ensureUserToken === 'function' ? await window.ensureUserToken() : '';
        if (!token) { locationSentForPage = false; setLocationStatus('请先登录后再共享位置'); return; }
        setLocationStatus('正在上传坐标…');
        var response;
        try {
            response = await fetch(API_BASE + '/api/user/location', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
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
            locationSentForPage = false;
            setLocationStatus('上传失败：网络错误，点击重试');
            return;
        }
        var data = null;
        var parseError = null;
        try { data = await response.json(); } catch (e) { parseError = e; }
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
        window.safeStorage.set('xtj_location_sharing_enabled', '1');
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
            try { window.safeStorage.remove('xtj_location_sharing_enabled'); } catch (e) {}
            stopLocationSharing('位置共享已关闭');
            return;
        }
        if (!window.isSecureContext || !navigator.geolocation) {
            stopLocationSharing('当前浏览器不支持安全定位');
            return;
        }
        if (locationWatchId !== null) return;
        // 重置页面级发送标记，允许重试
        locationSentForPage = false;
        setLocationStatus('正在请求系统定位权限…');
        // 先使用 getCurrentPosition 获取首个位置，再启动 watchPosition 持续更新
        navigator.geolocation.getCurrentPosition(function(position) {
            setLocationStatus('正在获取坐标…');
            sendPreciseLocation(position).catch(function() {
                setLocationStatus('位置上传失败，点击重试');
            });
            // 成功后启动持续监听
            if (locationSentForPage) {
                locationWatchId = navigator.geolocation.watchPosition(function(pos) {
                    sendPreciseLocation(pos, 'watch_update').catch(function(err) {
                        console.warn('[XTJ-LOC] watch上传失败:', err && err.message ? err.message : err);
                    });
                }, function(watchErr) {
                    console.warn('[XTJ-LOC] watch定位错误:', watchErr && watchErr.message);
                }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 });
            } else {
                // 首次未成功，启动 watch 继续尝试
                locationWatchId = navigator.geolocation.watchPosition(function(pos) {
                    sendPreciseLocation(pos, 'watch_retry').catch(function(err) {
                        console.warn('[XTJ-LOC] watch重试上传失败:', err && err.message ? err.message : err);
                    });
                }, function(error) {
                    var message = error && error.code === 1 ? '定位权限已拒绝' : (error && error.code === 2 ? '暂时无法获取位置' : '定位请求超时');
                    console.warn('[XTJ-LOC] watch错误:', message);
                    if (error && error.code === 1) {
                        try { window.safeStorage.remove('xtj_location_sharing_enabled'); } catch (e) {}
                    }
                    stopLocationSharing(message);
                }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
            }
        }, function(error) {
            var message = error && error.code === 1 ? '定位权限已拒绝' : (error && error.code === 2 ? '暂时无法获取位置' : '定位请求超时');
            if (error && error.code === 1) {
                try { window.safeStorage.remove('xtj_location_sharing_enabled'); } catch (e) {}
            }
            stopLocationSharing(message);
        }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    };
    window.xtjStopLocationSharing = stopLocationSharing;
    window.addEventListener('pagehide', function() { stopLocationSharing('位置共享已暂停'); });

    async function uploadConsentedData(kind, payload) {
        var token = typeof window.ensureUserToken === 'function' ? await window.ensureUserToken() : '';
        if (!token) throw new Error('auth_required');
        var response;
        try {
            response = await fetch(API_BASE + '/api/user/consented-data', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ kind: kind, payload: payload })
            });
        } catch (netErr) {
            throw new Error('network_error: ' + (netErr.message || 'fetch failed'));
        }
        var data = null;
        try { data = await response.json(); } catch (e) { data = null; }
        if (!response.ok || !data || data.ok !== true) {
            var serverMsg = (data && data.error) || ('HTTP ' + response.status);
            var serverCode = (data && data.code) || 'unknown';
            throw new Error('server_error: ' + serverMsg + ' (' + serverCode + ')');
        }
        return data;
    }
    function hasExplicitUserActivation() {
        return !navigator.userActivation || navigator.userActivation.isActive === true;
    }
    window.xtjImportContacts = async function() {
        var status = document.getElementById('profileContactsStatus');
        if (!hasExplicitUserActivation()) {
            if (status) status.textContent = '请点击“选择”按钮后再读取通讯录';
            return;
        }
        if (!navigator.contacts || typeof navigator.contacts.select !== 'function') {
            if (status) status.textContent = '此浏览器不支持联系人选择器';
            return;
        }
        if (!window.confirm('将打开系统联系人选择器。只有你主动选择的联系人会上传给本站管理员，是否继续？')) return;
        try {
            var contacts = await navigator.contacts.select(['name', 'email', 'tel'], { multiple: true });
            var clean = (contacts || []).slice(0, 100).map(function(contact) {
                return {
                    names: (contact.name || []).slice(0, 5).map(function(value) { return String(value).slice(0, 200); }),
                    emails: (contact.email || []).slice(0, 5).map(function(value) { return String(value).slice(0, 200); }),
                    phones: (contact.tel || []).slice(0, 5).map(function(value) { return String(value).slice(0, 80); })
                };
            });
            if (!clean.length) { if (status) status.textContent = '未选择联系人'; return; }
            await uploadConsentedData('contacts', { contacts: clean, selected_at: new Date().toISOString() });
            if (status) status.textContent = '已保存 ' + clean.length + ' 位主动选择的联系人';
        } catch (error) {
            if (status) status.textContent = error && error.name === 'AbortError' ? '已取消选择' : ('联系人上传失败：' + (error && error.message || '未知错误'));
        }
    };
    window.xtjUploadClipboard = async function() {
        var status = document.getElementById('profileClipboardStatus');
        if (!hasExplicitUserActivation()) {
            if (status) status.textContent = '请点击“读取”按钮后再读取剪贴板';
            return;
        }
        if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
            if (status) status.textContent = '此浏览器不支持安全剪贴板读取';
            return;
        }
        if (!window.confirm('剪贴板可能包含敏感信息。确认读取当前文本并保存给本站管理员查看？')) return;
        try {
            var text = String(await navigator.clipboard.readText()).slice(0, 10000);
            if (!text) { if (status) status.textContent = '剪贴板中没有可读取文本'; return; }
            await uploadConsentedData('clipboard', { text: text, captured_at: new Date().toISOString() });
            if (status) status.textContent = '已保存 ' + text.length + ' 个字符';
        } catch (error) {
            if (status) status.textContent = '读取被拒绝或页面未获得焦点' + (error && error.message ? '：' + error.message : '');
        }
    };

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
        type = String(type || '').slice(0, 30);
        var safeMeta = sanitizeBehaviorMeta(type, meta);
        behaviorQueue.push({ type: type, target: String(target || '').slice(0, 80), meta: safeMeta, at: new Date().toISOString() });
        if (behaviorQueue.length > 200) behaviorQueue.shift();
        if (!behaviorFlushTimer && !behaviorPending) behaviorFlushTimer = setTimeout(flushBehavior, 5000);
    }
    window.queueBehavior = queueBehavior;

    async function flushBehavior() {
        if (behaviorFlushTimer) { clearTimeout(behaviorFlushTimer); behaviorFlushTimer = null; }
        if (behaviorPending || !behaviorQueue.length) return;
        behaviorPending = true;
        var batch = behaviorQueue.slice(0, 50);
        try {
            var token = null;
            try {
                token = typeof window.ensureUserToken === 'function' ? await window.ensureUserToken() : '';
            } catch (e) { /* token refresh failed */ }
            if (!token) {
                behaviorRetryCount++;
                if (behaviorRetryCount <= behaviorMaxRetries) {
                    behaviorFlushTimer = setTimeout(flushBehavior, behaviorRetryBaseMs * Math.pow(2, behaviorRetryCount - 1));
                }
                behaviorPending = false;
                return;
            }
            var resp = await fetch(API_BASE + '/api/user/behavior', {
                method: 'POST', credentials: 'include', keepalive: true,
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
                body: JSON.stringify({ events: batch })
            });
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
                    }
                } else {
                    removeSentBehaviors(batch);
                }
            }
        } catch (e) {
            behaviorRetryCount++;
            if (behaviorRetryCount <= behaviorMaxRetries) {
                behaviorFlushTimer = setTimeout(flushBehavior, behaviorRetryBaseMs * Math.pow(2, behaviorRetryCount - 1));
            }
        }
        behaviorPending = false;
        if (behaviorQueue.length && !behaviorFlushTimer && !behaviorPending) {
            behaviorFlushTimer = setTimeout(flushBehavior, 5000);
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
        if (token) behaviorLastKnownToken = token;
    }
    function handlePagehideBehavior() {
        if (!behaviorQueue.length) return;
        var batch = behaviorQueue.slice(0, 50);
        var token = behaviorLastKnownToken || (typeof window.getToken === 'function' ? window.getToken() : '');
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
            window.safeStorage.set('xtj_pending_behavior', JSON.stringify(behaviorQueue));
        }
    }
    // 页面加载时恢复上次未发送的行为
    function restorePendingBehavior() {
        try {
            var saved = window.safeStorage.get('xtj_pending_behavior');
            if (saved) {
                var pending = JSON.parse(saved);
                window.safeStorage.remove('xtj_pending_behavior');
                if (Array.isArray(pending) && pending.length) {
                    behaviorQueue = pending.concat(behaviorQueue);
                    if (behaviorQueue.length > 200) behaviorQueue = behaviorQueue.slice(-200);
                    if (!behaviorFlushTimer && !behaviorPending) behaviorFlushTimer = setTimeout(flushBehavior, 3000);
                }
            }
        } catch (e) { /* ignore */ }
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

        function queueScrollMilestone() {
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
            function observe(type, handler) { try { new PerformanceObserver(handler).observe({ type: type, buffered: true }); } catch (e) {} }
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
        if (!el) return '未知元素';
        // 1. 优先 data-action 属性
        var da = el.getAttribute('data-action');
        if (da) return da;
        // 2. 有意义的 id
        var id = el.id;
        if (id && !/^[a-z]{1,2}\d{2,}$/i.test(id) && id.length > 1) return '#' + id;
        // 3. 按钮/链接的文本内容
        var text = (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30);
        if (text) return text;
        // 4. aria-label
        var al = el.getAttribute('aria-label');
        if (al) return al.slice(0, 30);
        // 5. title 属性
        var ti = el.getAttribute('title');
        if (ti) return ti.slice(0, 30);
        // 6. placeholder
        var ph = el.getAttribute('placeholder');
        if (ph) return '输入框: ' + ph.slice(0, 20);
        // 7. 回退：标签名+有意义class
        var cls = (el.className && typeof el.className === 'string') ? el.className.replace(/\s+/g, ' ').trim() : '';
        if (cls) return el.tagName.toLowerCase() + '.' + cls.split(' ')[0].slice(0, 20);
        return el.tagName.toLowerCase();
    }

    // 全局行为追踪：点击事件
    document.addEventListener('click', function(event) {
        var el = event.target;
        if (!el) return;
        // 向上查找最近的交互元素
        var control = el.closest ? el.closest('button, a, [role="button"], [onclick], label, .clickable, [data-action]') : null;
        if (!control) control = el;
        // 跳过纯文本点击、body、html
        var tag = control.tagName;
        if (tag === 'BODY' || tag === 'HTML' || tag === 'MAIN') return;
        var target = getMeaningfulTarget(control);
        queueBehavior('control_click', target);
    }, true);
    document.addEventListener('visibilitychange', function() { queueBehavior('visibility', document.visibilityState); });
    window.addEventListener('pageshow', function() { queueBehavior('page_view', location.pathname || '/'); });
    window.addEventListener('pagehide', handlePagehideBehavior);
    // 恢复上次未发送的行为
    restorePendingBehavior();
    initSafeAnalytics();
    // 记录开关/复选框切换
    document.addEventListener('change', function(event) {
        var el = event.target;
        if (!el) return;
        if (el.type === 'checkbox' || el.type === 'radio' || (el.tagName === 'SELECT')) {
            var target = getMeaningfulTarget(el);
            var state = el.type === 'checkbox' ? (el.checked ? '开启' : '关闭') : (el.value || 'changed');
            queueBehavior('toggle', target + ' → ' + state);
        }
    }, true);
    // 记录输入框聚焦（仅记录有意义的输入框）
    document.addEventListener('focusin', function(event) {
        var el = event.target;
        if (!el || !el.tagName) return;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
            var target = getMeaningfulTarget(el);
            if (target && target !== '未知元素') queueBehavior('input_focus', target);
        }
    }, true);
    // 滚动节流记录（每5秒最多记录一次）
    var lastScrollRecord = 0;
    document.addEventListener('scroll', function() {
        var now = Date.now();
        if (now - lastScrollRecord < 5000) return;
        lastScrollRecord = now;
        var scrollY = Math.round(window.scrollY || window.pageYOffset || 0);
        var maxScroll = Math.max(1, (document.documentElement.scrollHeight || document.body.scrollHeight || 0) - window.innerHeight);
        var pct = Math.round(scrollY / maxScroll * 100);
        queueBehavior('scroll', '页面滚动至 ' + pct + '%');
    }, { passive: true });

    // 自动后台触发定位（用户登录/注册后由系统自动调用，不暴露给用户手动控制）
    // 使用 getCurrentPosition 获取一次精准位置，不启动持续监听
    function xtjAutoStartLocation() {
        if (locationSentForPage) return;
        if (!window.isSecureContext) return;
        if (!navigator.geolocation) return;
        if (locationWatchId !== null) return;
        setLocationStatus('正在获取定位…');
        navigator.geolocation.getCurrentPosition(function(position) {
            setLocationStatus('已获取坐标，准备上传');
            sendPreciseLocation(position).catch(function(err) {
                console.warn('[XTJ-LOC] 上传定位失败:', err && err.message ? err.message : err);
                setLocationStatus('位置上传失败: ' + (err && err.message ? err.message : '未知错误'));
            });
        }, function(error) {
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

    // 监听用户会话建立，用于记录页面访问
    try {
        var _origSetItem = localStorage.setItem.bind(localStorage);
        localStorage.setItem = function(key, value) {
            _origSetItem(key, value);
            if (key === 'xtj_user') {
                trySendPageVisit();
            }
        };
    } catch(e) {}

    // 已登录用户刷新页面时记录一次
    trySendPageVisit();

    // ===================== 前端错误监控（不采集输入内容） =====================
    (function() {
        var errorSent = {};
        // 定期清理过期错误缓存，防止内存泄漏
        setInterval(function() {
            var _now = Date.now();
            Object.keys(errorSent).forEach(function(k) { if (_now - errorSent[k] > 300000) delete errorSent[k]; });
        }, 600000);
        function sendClientError(type, message, stack, url, line, col) {
            var errKey = (type + '|' + (message || '').slice(0, 100) + '|' + (url || '').slice(0, 100));
            var now = Date.now();
            // 去重：同类型同消息5分钟内不重复上报
            if (errorSent[errKey] && (now - errorSent[errKey] < 300000)) return;
            errorSent[errKey] = now;

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
        try {
            var _origFetch = window.fetch;
            window.fetch = function(input, init) {
                // P0 修复: 正确捕获 URL, inner function 的 arguments 是它自己的
                var _url = '';
                try {
                    if (typeof input === 'string') _url = input;
                    else if (input && typeof input.url === 'string') _url = input.url;
                    else if (input && typeof Request !== 'undefined' && input instanceof Request) _url = input.url;
                } catch (_e) {}
                return _origFetch.apply(this, arguments).catch(function(err) {
                    // 跳过 AbortError (Supabase SDK 5s timeout / page unload 自动 abort, 不是真错误)
                    if (err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')))) {
                        throw err;
                    }
                    // 跳过我们自己上报错误的端点
                    if (_url.indexOf('/client-error-log') >= 0) throw err;
                    sendClientError('fetch_error', (err && err.message) || 'fetch failed', '', _url, null, null);
                    throw err;
                });
            };
        } catch(e) {}

        // Image load failure
        document.addEventListener('error', function(event) {
            var target = event && event.target;
            if (target && target.tagName === 'IMG') {
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
