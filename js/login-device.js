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
                cachedSecuritySettings = (data && data.settings) || { record_device: true, browser_fingerprint: false, canvas_fingerprint: false, security_alerts: true };
                settingsLastFetch = now;
                return cachedSecuritySettings;
            })
            .catch(function() {
                return { record_device: true, browser_fingerprint: false, canvas_fingerprint: false, security_alerts: true };
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
        var modelMap = {
            '440x956@3': '疑似 iPhone 16 Pro Max / iPhone 17 Pro Max',
            '402x874@3': '疑似 iPhone 16 Pro / iPhone 17 / iPhone 17 Pro',
            '393x852@3': '疑似 iPhone 14 Pro / iPhone 15 / iPhone 15 Pro / iPhone 16',
            '430x932@3': '疑似 iPhone 14 Pro Max / iPhone 15 Plus / iPhone 15 Pro Max / iPhone 16 Plus',
            '428x926@3': '疑似 iPhone 12 Pro Max / iPhone 13 Pro Max / iPhone 14 Plus',
            '390x844@3': '疑似 iPhone 12 / iPhone 12 Pro / iPhone 13 / iPhone 13 Pro / iPhone 14',
            '375x812@3': '疑似 iPhone X / iPhone XS / iPhone 11 Pro / iPhone 12 mini / iPhone 13 mini',
            '414x896@3': '疑似 iPhone XS Max / iPhone 11 Pro Max',
            '414x896@2': '疑似 iPhone XR / iPhone 11',
            '414x736@3': '疑似 iPhone 6 Plus / 6s Plus / 7 Plus / 8 Plus',
            '375x667@2': '疑似 iPhone 6 / 6s / 7 / 8 / SE（第 2/3 代）',
            '320x568@2': '疑似 iPhone 5 / 5s / SE（第 1 代）'
        };
        return modelMap[key] || 'iPhone（型号不可确定）';
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

                if (browserFpPromise && browserFpPromise.then) {
                    browserFpPromise.then(function(hash) {
                        if (hash) bodyObj.browser_fingerprint_hash = hash;
                        if (canvasFpPromise && canvasFpPromise.then) {
                            canvasFpPromise.then(function(cHash) {
                                if (cHash) bodyObj.canvas_fingerprint_hash = cHash;
                                sendReq();
                            }).catch(function() { sendReq(); });
                        } else {
                            sendReq();
                        }
                    }).catch(function() { sendReq(); });
                } else if (canvasFpPromise && canvasFpPromise.then) {
                    canvasFpPromise.then(function(cHash) {
                        if (cHash) bodyObj.canvas_fingerprint_hash = cHash;
                        sendReq();
                    }).catch(function() { sendReq(); });
                } else {
                    sendReq();
                }
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
        try { pwHash = localStorage.getItem('xtj_pw_hash') || ''; } catch(e) { pwHash = ''; }
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
                passwordHash = localStorage.getItem('xtj_pw_hash');
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

    // 拦截 localStorage.setItem，监听登录凭据写入
    try {
        var _origSetItem = localStorage.setItem.bind(localStorage);
        localStorage.setItem = function(key, value) {
            _origSetItem(key, value);
            if (key === 'xtj_user' || key === 'xtj_pw_hash') {
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
