/** Shared window utils — loaded before core.js */

window.safeStorage = {
    set: function(key, value) {
        try { localStorage.setItem(key, String(value)); } catch(e) { console.warn('Storage set failed', e); }
    },
    get: function(key) {
        try { return localStorage.getItem(key); } catch(e) { return null; }
    },
    remove: function(key) {
        try { localStorage.removeItem(key); } catch(e) { console.warn('Storage remove failed', e); }
    }
};

/**
 * Network resilience helpers.
 * VPN/TUN/proxy (Clash etc.) can leave TCP half-open so fetch never settles;
 * without a timeout the feed skeleton spins forever.
 */
window.xtjCreateTimeoutSignal = function(timeoutMs) {
    var ms = Math.max(1000, Number(timeoutMs) || 15000);
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        try { return AbortSignal.timeout(ms); } catch (e) {}
    }
    var controller = new AbortController();
    var timer = setTimeout(function() {
        try { controller.abort(); } catch (e) {}
    }, ms);
    if (controller.signal && typeof controller.signal.addEventListener === 'function') {
        controller.signal.addEventListener('abort', function() {
            clearTimeout(timer);
        }, { once: true });
    }
    return controller.signal;
};

window.xtjMergeAbortSignals = function(primary, secondary) {
    if (!primary) return secondary || null;
    if (!secondary) return primary;
    if (primary.aborted) return primary;
    if (secondary.aborted) return secondary;
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
        try { return AbortSignal.any([primary, secondary]); } catch (e) {}
    }
    var controller = new AbortController();
    // 任一信号触发时：先从两侧移除本监听（防残留），再中止合并控制器
    var handler = function() {
        try { primary.removeEventListener('abort', handler); } catch (e) {}
        try { secondary.removeEventListener('abort', handler); } catch (e) {}
        try { controller.abort(); } catch (e) {}
    };
    primary.addEventListener('abort', handler, { once: true });
    secondary.addEventListener('abort', handler, { once: true });
    return controller.signal;
};

/**
 * fetch with a hard timeout. Preserves caller AbortSignal when provided.
 */
window.xtjFetch = function(url, options, timeoutMs) {
    options = options || {};
    var ms = timeoutMs == null ? 15000 : timeoutMs;
    var timeoutSignal = window.xtjCreateTimeoutSignal(ms);
    var signal = window.xtjMergeAbortSignals(options.signal, timeoutSignal);
    return fetch(url, Object.assign({}, options, { signal: signal }));
};

/**
 * Race a promise against a timeout; reject with a named Error on timeout.
 */
window.xtjWithTimeout = function(promise, timeoutMs, label) {
    var ms = Math.max(1000, Number(timeoutMs) || 15000);
    var settled = false;
    return new Promise(function(resolve, reject) {
        var timer = setTimeout(function() {
            if (settled) return;
            settled = true;
            var err = new Error((label || 'request') + ' timeout after ' + ms + 'ms');
            err.name = 'TimeoutError';
            err.code = 'timeout';
            reject(err);
        }, ms);
        Promise.resolve(promise).then(function(value) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        }, function(err) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
        });
    });
};


if (!window.throttleRAF) { window.throttleRAF = function(fn) {
    var ticking = false, args, ctx;
    return function() {
        args = arguments;
        ctx = this;
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(function() {
                try {
                    fn.apply(ctx, args);
                } finally {
                    ticking = false;
                }
            });
        }
    };
}; }

window.safeParseDate = function(val) {
    if (!val) return new Date('Invalid Date');
    if (val instanceof Date) return new Date(val.getTime());
    
    if (typeof val === 'number') {
        return new Date(val > 9999999999 ? val : val * 1000);
    }
    if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
        var num = parseInt(val.trim(), 10);
        return new Date(num > 9999999999 ? num : num * 1000);
    }
    
    var orig = String(val).trim();
    var d = new Date(orig);
    if (!isNaN(d.getTime())) return d;
    
    // 如果带 Z 或者是标准时区（如 +08:00），原样解析失败说明不是标准格式，交给下面处理
    // 把 YYYY-MM-DD 替换成 YYYY/MM/DD（Safari 兼容本地时间格式）
    // 如果存在 'T'，而且没有 'Z' 也没有 '+'，把它换成空格（Safari 兼容）
    var isISOWithTimezone = /Z|[+-]\d{2}:\d{2}$/i.test(orig);
    if (isISOWithTimezone) {
      // 已经带了时区却解析失败，直接原样替换-为/看看
      d = new Date(orig.replace(/-/g, '/'));
      return d;
    }
    
    var formatted = orig.replace(/-/g, '/').replace('T', ' ').replace(/\.\d+/, '');
    d = new Date(formatted);
    return d; // 如果依然是 Invalid Date，也如实返回
};
