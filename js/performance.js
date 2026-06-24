(function() {
    'use strict';

    if (window.__xtjPerformanceBooted) return;
    window.__xtjPerformanceBooted = true;

    var root = document.documentElement;
    var refreshFrameId = null;
    var mediaQueries = [];

    function setProfile(profile) {
        root.classList.remove('perf-lite', 'perf-balanced', 'perf-full');
        root.classList.add('perf-' + profile);
        root.dataset.xtjPerfProfile = profile;
        window.__xtjPerfProfile = profile;
    }

    function detectProfile() {
        var coarse = false;
        var reduced = false;
        try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) {}
        try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
        // ★ 修复 L4：navigator.deviceMemory 和 hardwareConcurrency 在 Safari/Firefox 不可用
        var mem = (typeof navigator.deviceMemory !== 'undefined') ? navigator.deviceMemory : 0;
        var cores = (typeof navigator.hardwareConcurrency !== 'undefined') ? navigator.hardwareConcurrency : 0;
        var firefox = /firefox/i.test(navigator.userAgent || '');

        if (reduced || (coarse && (mem && mem <= 4 || cores && cores <= 6)) || (mem && mem <= 2) || (cores && cores <= 4)) {
            return 'lite';
        }
        if (coarse || firefox || (mem && mem <= 8) || (cores && cores <= 8)) {
            return 'balanced';
        }
        return 'full';
    }

    function markRefreshRate(hz) {
        root.classList.remove('perf-hz-60', 'perf-hz-90', 'perf-hz-120');
        var bucket = hz >= 108 ? 120 : (hz >= 80 ? 90 : 60);
        root.classList.add('perf-hz-' + bucket);
        root.dataset.xtjRefresh = String(bucket);
        window.__xtjRefreshRate = bucket;
    }

    function measureRefreshRate() {
        if (document.hidden) return;
        if (refreshFrameId) cancelAnimationFrame(refreshFrameId);
        var stamps = [];
        function step(ts) {
            stamps.push(ts);
            if (stamps.length < 16) {
                refreshFrameId = requestAnimationFrame(step);
                return;
            }
            var total = 0;
            for (var i = 1; i < stamps.length; i++) total += (stamps[i] - stamps[i - 1]);
            var avg = total / Math.max(1, stamps.length - 1);
            var hz = avg > 0 ? (1000 / avg) : 60;
            markRefreshRate(hz);
            refreshFrameId = null;
        }
        refreshFrameId = requestAnimationFrame(step);
    }

    function applyProfile() {
        setProfile(detectProfile());
    }

    function bindMedia(query) {
        try {
            var mq = window.matchMedia(query);
            var handler = applyProfile;
            if (mq.addEventListener) mq.addEventListener('change', handler);
            else if (mq.addListener) mq.addListener(handler);
            mediaQueries.push({ mq: mq, handler: handler });
        } catch (e) {}
    }

    applyProfile();
    measureRefreshRate();

    bindMedia('(pointer: coarse)');
    bindMedia('(prefers-reduced-motion: reduce)');

    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            applyProfile();
            measureRefreshRate();
        }
    });

    window.addEventListener('pageshow', function() {
        applyProfile();
        measureRefreshRate();
    });

    window.addEventListener('resize', function() {
        applyProfile();
    }, { passive: true });
})();
