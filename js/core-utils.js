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

// Gesture handling shared by the mobile Dock and the vertical workbench rail.
// Measurements happen at gesture start / resize; movement only writes one pose
// per frame. Native taps, keyboard clicks and the existing business handlers stay
// in charge of normal selection.
window.xtjInstallSelectionRail = function(options) {
    var rail = options.rail, indicator = options.indicator;
    if (!rail || !indicator) return null;
    if (rail.__xtjSelectionRail) return rail.__xtjSelectionRail;
    var lifetime = new AbortController(), gesture = null, frame = 0, suppressed = null, suspended = false;
    function axis() { return typeof options.axis === 'function' ? options.axis() : options.axis || 'x'; }
    function measure() {
        var rect = rail.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        var sizes = new Map([[rail,{w:rail.offsetWidth,h:rail.offsetHeight}]]);
        var buttons = Array.from(rail.querySelectorAll(options.buttons)).map(function(button) {
            var bounds = button.getBoundingClientRect();
            sizes.set(button,{w:button.offsetWidth,h:button.offsetHeight});
            return { button: button, x: bounds.left - rect.left, y: bounds.top - rect.top, w: bounds.width, h: bounds.height };
        }).filter(function(item) { return item.w > 0 && item.h > 0; });
        return buttons.length ? { rect: rect, buttons: buttons, axis: axis(), sizes:sizes } : null;
    }
    function selected(metrics) {
        var button = options.selected();
        return metrics.buttons.find(function(item) { return item.button === button; }) || metrics.buttons[0];
    }
    function paint(item, x, y) {
        indicator.style.width = item.w + 'px'; indicator.style.height = item.h + 'px';
        indicator.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
        indicator.style.opacity = '1';
    }
    function syncNow() {
        if (gesture) return;
        var metrics = measure();
        if (!metrics) return;
        var item = selected(metrics); paint(item, item.x, item.y);
    }
    function sync() {
        if (gesture || frame || suspended || document.hidden) return;
        frame = requestAnimationFrame(function() { frame = 0; syncNow(); });
    }
    function position(state) {
        var items = state.metrics.buttons, vertical = state.metrics.axis === 'y';
        var delta = vertical ? state.y - state.sy : state.x - state.sx;
        var first = items[0], last = items[items.length - 1], origin = state.origin;
        var low = vertical ? first.y : first.x;
        var high = vertical ? last.y + last.h - origin.h : last.x + last.w - origin.w;
        var main = Math.max(low, Math.min(high, (vertical ? origin.y : origin.x) + delta));
        return { x: vertical ? origin.x : main, y: vertical ? main : origin.y };
    }
    function render() {
        frame = 0;
        if (!gesture || !gesture.moved) return;
        var pose = position(gesture); paint(gesture.origin, pose.x, pose.y);
    }
    function move(event) {
        var state = gesture;
        if (!state || event.pointerId !== state.id) return;
        state.x = event.clientX; state.y = event.clientY;
        var dx = Math.abs(state.x - state.sx), dy = Math.abs(state.y - state.sy);
        var main = state.metrics.axis === 'y' ? dy : dx, cross = state.metrics.axis === 'y' ? dx : dy;
        if (!state.moved) {
            if (cross > 9 && cross > main * 1.25) { cancel(); return; }
            if (main < 7 || main < cross) return;
            state.moved = true;
            indicator.style.transition = 'none'; indicator.style.willChange = 'transform';
            rail.classList.add('is-dragging');
            try { state.button.setPointerCapture(state.id); } catch (_) {}
        }
        if (event.cancelable) event.preventDefault();
        if (!frame) frame = requestAnimationFrame(render);
    }
    function detach(state) {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', end);
        document.removeEventListener('pointercancel', cancelEvent);
        if (frame) { cancelAnimationFrame(frame); frame = 0; }
        rail.classList.remove('is-dragging'); indicator.style.transition = ''; indicator.style.willChange = '';
        if (state) try { if (state.button.hasPointerCapture(state.id)) state.button.releasePointerCapture(state.id); } catch (_) {}
    }
    function cancel() {
        var state = gesture; gesture = null; detach(state); sync();
    }
    function cancelEvent(event) { if (gesture && event.pointerId === gesture.id) cancel(); }
    function end(event) {
        var state = gesture;
        if (!state || event.pointerId !== state.id) return;
        // The release can arrive before the scheduled pointermove frame.
        state.x = event.clientX; state.y = event.clientY;
        var main = state.metrics.axis === 'y' ? state.y - state.sy : state.x - state.sx;
        if (!state.moved && Math.abs(main) >= 7) move(event);
        if (gesture !== state) return;
        gesture = null; detach(state);
        if (state.moved) {
            var pose = position(state), vertical = state.metrics.axis === 'y';
            var center = vertical ? pose.y + state.origin.h / 2 : pose.x + state.origin.w / 2;
            var nearest = state.metrics.buttons.reduce(function(best, item) {
                var distance = Math.abs(center - (vertical ? item.y + item.h / 2 : item.x + item.w / 2));
                return !best || distance < best.distance ? { item: item, distance: distance } : best;
            }, null);
            suppressed = { id: state.id, until: performance.now() + 750 };
            options.select(nearest.item.button);
        }
        sync();
    }
    rail.addEventListener('pointerdown', function(event) {
        if (gesture || event.isPrimary === false || event.pointerType === 'mouse' && event.button !== 0) return;
        var button = event.target.closest && event.target.closest(options.buttons);
        if (!button || !rail.contains(button) || button.disabled) return;
        suppressed = null; // A fresh intentional tap must never inherit a drag's suppression.
        var metrics = measure(); if (!metrics) return;
        if (frame) { cancelAnimationFrame(frame); frame = 0; }
        var origin = metrics.buttons.find(function(item) { return item.button === button; });
        gesture = { id: event.pointerId, button: button, metrics: metrics, origin: origin, sx: event.clientX, sy: event.clientY, x: event.clientX, y: event.clientY, moved: false };
        document.addEventListener('pointermove', move, { passive: false });
        document.addEventListener('pointerup', end);
        document.addEventListener('pointercancel', cancelEvent);
    }, { signal: lifetime.signal });
    rail.addEventListener('click', function(event) {
        if (!suppressed || event.detail === 0 || performance.now() > suppressed.until) return;
        if (event.pointerId != null && event.pointerId !== suppressed.id) return;
        suppressed = null; event.preventDefault(); event.stopImmediatePropagation();
    }, { capture: true, signal: lifetime.signal });
    rail.addEventListener('lostpointercapture', function(event) {
        // Touch starts with implicit capture on the label/SVG. Transferring it
        // to the owning button emits a loss event for that child, not a cancel.
        if (gesture && event.pointerId === gesture.id && event.target === gesture.button && !gesture.button.hasPointerCapture(event.pointerId)) cancel();
    }, { signal: lifetime.signal });
    window.addEventListener('blur', cancel, { signal: lifetime.signal });
    window.addEventListener('pagehide', function() { suspended = true; cancel(); }, { signal: lifetime.signal });
    window.addEventListener('pageshow', function() { suspended = false; sync(); }, { signal: lifetime.signal });
    document.addEventListener('visibilitychange', function() { if (document.hidden) cancel(); else sync(); }, { signal: lifetime.signal });
    window.addEventListener('resize', cancel, { passive: true, signal: lifetime.signal });
    var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(function(entries) {
        if (!gesture) { sync(); return; }
        // The first observation is delivered even when no resize occurred.
        // Opening a menu and touching it before that delivery must not cancel
        // an otherwise valid drag. Offset sizes ignore compositor transforms.
        if (entries.some(function(entry) { var size=gesture.metrics.sizes.get(entry.target); return size&&(entry.target.offsetWidth!==size.w||entry.target.offsetHeight!==size.h); })) cancel();
    }) : null;
    if (observer) { observer.observe(rail); rail.querySelectorAll(options.buttons).forEach(function(button) { observer.observe(button); }); }
    var api = { sync: sync, dispose: function() { cancel(); if (frame) cancelAnimationFrame(frame); lifetime.abort(); if (observer) observer.disconnect(); delete rail.__xtjSelectionRail; } };
    rail.__xtjSelectionRail = api; sync(); return api;
};

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
