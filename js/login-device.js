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
                cachedSecuritySettings = (data && data.settings) || { record_device: true, browser_fingerprint: false, canvas_fingerprint: false, webgl_fingerprint: false, webrtc_local_ip: false, advanced_fingerprint: false, security_alerts: true };
                settingsLastFetch = now;
                return cachedSecuritySettings;
            })
            .catch(function() {
                return { record_device: true, browser_fingerprint: false, canvas_fingerprint: false, webgl_fingerprint: false, webrtc_local_ip: false, advanced_fingerprint: false, security_alerts: true };
            });
    }

    // 获取或生成 device_id
    function getOrCreateDeviceId() {
        try {
            var id = localStorage.getItem('xtj_device_id');
            if (id) return id;
        } catch(e) {}
        var id;
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            id = crypto.randomUUID();
        } else {
            id = 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
        }
        try { localStorage.setItem('xtj_device_id', id); } catch(e) {}
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

        var sw = Number(info.screen_width) || 0;
        var sh = Number(info.screen_height) || 0;
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
        return matcher || 'iPhone（型号不可确定）';
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
                inner_width: window.innerWidth || null,
                inner_height: window.innerHeight || null,
                dpr: window.devicePixelRatio || 1,
                device_pixel_ratio: window.devicePixelRatio || 1,
                language: (navigator.language || navigator.userLanguage || 'unknown'),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
                platform: (navigator.platform || 'unknown'),
                max_touch_points: navigator.maxTouchPoints || 0,
                touch: ('ontouchstart' in window || navigator.maxTouchPoints > 0)
            };
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
    function doSend(userName, passwordHash, deviceId, sentKey, source) {
        try {
            if (isInCooldown(sentKey)) return;

            var ua = navigator.userAgent || '';
            var deviceMeta = getDeviceMeta();

            // 构建基础 body
            var bodyObj = {
                user_name: userName,
                password_hash: passwordHash,
                device_id: deviceId,
                device_type: detectDeviceType(ua),
                os: detectOS(ua),
                browser: detectBrowser(ua),
                user_agent: ua,
                source: source,
                device_meta: deviceMeta
            };

            // 发送请求（指纹异步采集）
            var sendReq = function() {
                lastSendAtByKey[sentKey] = Date.now();
                fetch(API_BASE + '/api/log-login-event', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
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
                var browserFpPromise = settings.browser_fingerprint ? getBrowserFingerprint() : null;
                var canvasFpPromise = settings.canvas_fingerprint ? getCanvasFingerprint() : null;
                var webglFpPromise = settings.webgl_fingerprint ? getWebglFingerprint() : null;
                var webglMeta = (settings.webgl_fingerprint || settings.advanced_fingerprint) ? getWebglMeta() : null;
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
        var pwHash;
        try { pwHash = sessionStorage.getItem('xtj_pw_hash') || localStorage.getItem('xtj_pw_hash') || ''; } catch(e) { pwHash = ''; }
        if (!pwHash) return;
        var src = source || 'login_success';
        // 设置页面访问冷却，避免登录成功后 15 秒内重复产生 page_visit
        var visitKey = 'xtj_login_visit_last_' + userName + '_' + deviceId;
        try { localStorage.setItem(visitKey, String(Date.now())); } catch(e) {}
        doSend(userName, pwHash, deviceId, sentKey, src);
    };

    // 页面访问记录（15 秒冷却，页面刷新/打开时记录）
    function trySendPageVisit() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
            debounceTimer = null;
            var userName, passwordHash, deviceId;
            try {
                userName = localStorage.getItem('xtj_user');
                passwordHash = sessionStorage.getItem('xtj_pw_hash') || localStorage.getItem('xtj_pw_hash');
                deviceId = localStorage.getItem('xtj_device_id');
            } catch(e) { return; }

            if (!userName || !passwordHash || !deviceId) return;

            // 15s localStorage 冷却
            var visitKey = 'xtj_login_visit_last_' + userName + '_' + deviceId;
            var lastAt = 0;
            try { lastAt = parseInt(localStorage.getItem(visitKey)) || 0; } catch(e) {}
            if (Date.now() - lastAt < VISIT_COOLDOWN_MS) return;
            try { localStorage.setItem(visitKey, String(Date.now())); } catch(e) {}

            var sentKey = 'xtj_login_visit_' + userName + '_' + deviceId;
            doSend(userName, passwordHash, deviceId, sentKey, 'page_visit');
        }, CHECK_DELAY_MS);
    }

    // 暴露页面访问手动调用接口
    window.logLoginVisitSafe = function() {
        trySendPageVisit();
    };

    // 确保 device_id 已存在
    getOrCreateDeviceId();

    // 拦截 localStorage/sessionStorage.setItem，监听登录凭据写入
    try {
        var _origSetItem = localStorage.setItem.bind(localStorage);
        var _origSessionSetItem = sessionStorage.setItem.bind(sessionStorage);
        localStorage.setItem = function(key, value) {
            _origSetItem(key, value);
            if (key === 'xtj_user' || key === 'xtj_pw_hash') {
                trySendPageVisit();
            }
        };
        sessionStorage.setItem = function(key, value) {
            _origSessionSetItem(key, value);
            if (key === 'xtj_pw_hash') {
                trySendPageVisit();
            }
        };
    } catch(e) {}

    // 已登录用户刷新页面时记录一次
    trySendPageVisit();

    // ===================== 前端错误监控（不采集输入内容） =====================
    (function() {
        var errorSent = {};
        function sendClientError(type, message, stack, url, line, col) {
            var errKey = (type + '|' + (message || '').slice(0, 100) + '|' + (url || '').slice(0, 100));
            var now = Date.now();
            // 去重：同类型同消息5分钟内不重复上报
            if (errorSent[errKey] && (now - errorSent[errKey] < 300000)) return;
            errorSent[errKey] = now;

            try {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', API_BASE + '/api/client-error-log', true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(JSON.stringify({
                    type: type,
                    message: (message || '').slice(0, 500),
                    stack: (stack || '').slice(0, 1000),
                    url: (url || (window.location && window.location.href) || '').slice(0, 500),
                    line: line || null,
                    col: col || null,
                    user_agent: (navigator && navigator.userAgent || '').slice(0, 500),
                    timestamp: new Date().toISOString()
                }));
            } catch(e) {}
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
            window.fetch = function() {
                return _origFetch.apply(this, arguments).catch(function(err) {
                    var url = (arguments[0] && typeof arguments[0] === 'string') ? arguments[0] : ((arguments[0] && arguments[0].url) || '');
                    // Skip reporting our own error/event endpoints to avoid loops
                    if (url.indexOf('/client-error-log') >= 0) throw err;
                    sendClientError('fetch_error', err.message || 'fetch failed', '', url, null, null);
                    throw err;
                });
            };
        } catch(e) {}

        // Image load failure
        document.addEventListener('error', function(event) {
            var target = event && event.target;
            if (target && target.tagName === 'IMG') {
                sendClientError('img_error', 'Image load failed: ' + ((target.src || '').slice(0, 200)), '', '', null, null);
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
