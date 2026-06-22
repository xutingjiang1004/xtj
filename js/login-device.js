(function() {
    'use strict';

    var API_BASE = (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || window.location.origin;
    var CHECK_DELAY_MS = 300;
    var debounceTimer = null;

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

    // 发送登录事件
    function doSend(userName, passwordHash, deviceId, sentKey) {
        try {
            var ua = navigator.userAgent || '';
            var body = JSON.stringify({
                user_name: userName,
                password_hash: passwordHash,
                device_id: deviceId,
                device_type: detectDeviceType(ua),
                os: detectOS(ua),
                browser: detectBrowser(ua),
                user_agent: ua
            });

            fetch(API_BASE + '/api/log-login-event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body
            }).then(function(res) {
                if (res.ok) {
                    try { sessionStorage.setItem(sentKey, '1'); } catch(e) {}
                }
            }).catch(function() {});
        } catch(e) {}
    }

    // 检查并尝试发送
    function trySendLoginEvent() {
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

            var sentKey = 'xtj_login_event_sent_' + userName + '_' + deviceId;
            try {
                if (sessionStorage.getItem(sentKey)) return;
            } catch(e) {}

            doSend(userName, passwordHash, deviceId, sentKey);
        }, CHECK_DELAY_MS);
    }

    // 暴露手动调用接口
    window.logLoginEventSafe = function(userName) {
        if (!userName) return;
        var deviceId = getOrCreateDeviceId();
        var sentKey = 'xtj_login_event_sent_' + userName + '_' + deviceId;
        try {
            if (sessionStorage.getItem(sentKey)) return;
        } catch(e) {}
        var pwHash;
        try { pwHash = localStorage.getItem('xtj_pw_hash') || ''; } catch(e) { pwHash = ''; }
        doSend(userName, pwHash, deviceId, sentKey);
    };

    // 确保 device_id 已存在
    getOrCreateDeviceId();

    // 拦截 localStorage.setItem，监听登录凭据写入
    var _origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function(key, value) {
        _origSetItem(key, value);
        if (key === 'xtj_user' || key === 'xtj_pw_hash') {
            trySendLoginEvent();
        }
    };
})();
