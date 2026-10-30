(function() {
    'use strict';

    if (window.__xtjPerformanceBooted) return;
    window.__xtjPerformanceBooted = true;

    var root = document.documentElement;
    var refreshFrameId = null;
    var mediaQueries = [];
    var currentProfile = null;
    var resizeApplyFrameId = null;

    function setupDebugMetrics() {
        var enabled = false;
        try { enabled = new URLSearchParams(window.location.search).get('perf') === '1'; } catch (e) {}
        if (!enabled || !window.performance) return;
        var start = performance.timeOrigin || Date.now();
        var metrics = {
            enabled: true,
            startedAt: start,
            marks: {},
            longTasks: { count: 0, total: 0, max: 0 },
            lcp: 0,
            resources: { count: 0, totalBytes: 0 }
        };
        function mark(name) {
            if (!name || metrics.marks[name] != null) return metrics.marks[name];
            metrics.marks[name] = Math.round(performance.now());
            return metrics.marks[name];
        }
        function updateResources() {
            var entries = performance.getEntriesByType ? performance.getEntriesByType('resource') : [];
            metrics.resources.count = entries.length;
            metrics.resources.totalBytes = entries.reduce(function(total, entry) {
                return total + (entry.transferSize || entry.encodedBodySize || 0);
            }, 0);
        }
        function snapshot() {
            updateResources();
            return JSON.parse(JSON.stringify(metrics));
        }
        window.__xtjPerfMetrics = metrics;
        window.XTJPerf = { mark: mark, snapshot: snapshot };
        document.addEventListener('DOMContentLoaded', function() {
            mark('dom-content-loaded');
            var feed = document.getElementById('feed');
            if (!feed || typeof MutationObserver !== 'function') return;
            if (feed.firstElementChild) { mark('first-post-render'); return; }
            var feedObserver = new MutationObserver(function() {
                if (!feed.firstElementChild) return;
                mark('first-post-render');
                feedObserver.disconnect();
            });
            feedObserver.observe(feed, { childList: true });
        }, { once: true });
        window.addEventListener('load', function() {
            mark('load');
            updateResources();
            try { console.table(snapshot()); } catch (e) {}
        }, { once: true });
        if (typeof PerformanceObserver === 'function') {
            var supported = PerformanceObserver.supportedEntryTypes || [];
            if (supported.indexOf('longtask') >= 0) {
                try {
                    new PerformanceObserver(function(list) {
                        list.getEntries().forEach(function(entry) {
                            metrics.longTasks.count += 1;
                            metrics.longTasks.total += Math.round(entry.duration || 0);
                            metrics.longTasks.max = Math.max(metrics.longTasks.max, Math.round(entry.duration || 0));
                        });
                    }).observe({ type: 'longtask', buffered: true });
                } catch (e) {}
            }
            if (supported.indexOf('largest-contentful-paint') >= 0) {
                try {
                    new PerformanceObserver(function(list) {
                        var entries = list.getEntries();
                        var latest = entries[entries.length - 1];
                        if (latest) metrics.lcp = Math.round(latest.startTime || 0);
                    }).observe({ type: 'largest-contentful-paint', buffered: true });
                } catch (e) {}
            }
        }
    }

    setupDebugMetrics();

    function setProfile(profile) {
        if (profile === currentProfile) return;
        currentProfile = profile;
        root.classList.remove('perf-lite', 'perf-balanced', 'perf-full');
        root.classList.add('perf-' + profile);
        root.dataset.xtjPerfProfile = profile;
        window.__xtjPerfProfile = profile;
    }

    function detectProfile() {
        // One experience for every device: no hardware-based downgrade (memory / core count / touch / browser).
        // Only the user's own "reduce motion" preference selects the reduced profile (accessibility, not performance).
        var reduced = false;
        try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
        return reduced ? 'lite' : 'full';
    }

    function markRefreshRate(hz) {
        root.classList.remove('perf-hz-60', 'perf-hz-90', 'perf-hz-120');
        var bucket = hz >= 108 ? 120 : (hz >= 80 ? 90 : 60);
        root.classList.add('perf-hz-' + bucket);
        root.dataset.xtjRefresh = String(bucket);
        window.__xtjRefreshRate = bucket;
    }

    var _refreshRateMeasured = false;
    function measureRefreshRate() {
        if (_refreshRateMeasured) return; // 只测一次并缓存（避免每次页面可见都跑 16 帧）
        // ★ 修复：hidden 时不能预置位缓存标志，否则后台标签页首次触发后永远不再测量
        if (document.hidden) return;
        _refreshRateMeasured = true;
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
        if (resizeApplyFrameId) return;
        resizeApplyFrameId = requestAnimationFrame(function() {
            resizeApplyFrameId = null;
            applyProfile();
        });
    }, { passive: true });
})();
