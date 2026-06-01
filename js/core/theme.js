(function() {
    var htmlEl = document.documentElement;
    var themeBtn = document.getElementById('themeToggle');

    function applyTheme(isDark) {
        if (isDark) {
            htmlEl.setAttribute('data-theme', 'dark');
            if (themeBtn) themeBtn.textContent = '☀️';
            localStorage.setItem('xtj-theme', 'dark');
        } else {
            htmlEl.removeAttribute('data-theme');
            if (themeBtn) themeBtn.textContent = '🌙';
            localStorage.setItem('xtj-theme', 'light');
        }
    }
    window.applyTheme = applyTheme;

    if (themeBtn) {
        themeBtn.addEventListener('click', function() {
            var isDark = htmlEl.getAttribute('data-theme') === 'dark';
            applyTheme(!isDark);
        });
    }
    var savedTheme = localStorage.getItem('xtj-theme');
    if (savedTheme === 'dark') {
        applyTheme(true);
    } else if (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        applyTheme(true);
    } else {
        applyTheme(false);
    }

    var ivZoomState = { scale: 1, tx: 0, ty: 0 };
    var ivIsZooming = false;
    var ivIsPanning = false;
    var ivLastDist = 0;
    var ivPanStartX = 0, ivPanStartY = 0;
    var ivStartTx = 0, ivStartTy = 0;
    var ivStartScale = 1;
    var ivLastTapTime = 0;
    var ivDoubleTapTimer = null;
    var ivHintTimer = null;
    var ivTouchEndTime = 0;

    function ivApplyTransform() {
        var img = document.getElementById('ivImg');
        var v = ivZoomState;
        var t = 'translate3d(' + v.tx + 'px, ' + v.ty + 'px, 0) scale(' + v.scale + ')';
        img.style.transform = t;
        img.style.webkitTransform = t;
    }

    function ivResetZoom(instant) {
        if (instant === undefined) instant = false;
        var img = document.getElementById('ivImg');
        ivZoomState.scale = 1; ivZoomState.tx = 0; ivZoomState.ty = 0;
        if (instant) {
            img.classList.add('instant');
            img.style.transform = ''; img.style.webkitTransform = '';
            void img.offsetWidth;
            img.classList.remove('instant');
        } else {
            img.style.transform = ''; img.style.webkitTransform = '';
        }
    }

    function ivShowHint() {
        var h = document.getElementById('ivZoomHint');
        h.classList.add('show');
        clearTimeout(ivHintTimer);
        ivHintTimer = setTimeout(function() { h.classList.remove('show'); }, 2000);
    }

    window.openImageViewer = function(src) {
        var viewer = document.getElementById('imgViewer');
        var img = document.getElementById('ivImg');
        var wrapper = document.getElementById('ivWrapper');
        ivResetZoom(true);
        img.src = src;
        wrapper.classList.add('open-anim');
        img.classList.add('instant');
        void img.offsetWidth;
        img.classList.remove('instant');
        viewer.classList.add('active');
        document.body.style.overflow = 'hidden';
    };

    window.closeImageViewer = function() {
        var viewer = document.getElementById('imgViewer');
        var wrapper = document.getElementById('ivWrapper');
        ivResetZoom(true);
        wrapper.classList.remove('open-anim');
        viewer.classList.remove('active');
        document.body.style.overflow = '';
    };

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') window.closeImageViewer();
    });

    document.getElementById('ivClose').addEventListener('click', window.closeImageViewer);
    document.getElementById('imgViewer').addEventListener('click', function(e) { if (e.target === this) window.closeImageViewer(); });

    document.getElementById('ivWrapper').addEventListener('touchstart', function(e) {
        var touches = e.touches;
        if (touches.length === 1) {
            var t = touches[0];
            ivPanStartX = t.clientX - ivZoomState.tx;
            ivPanStartY = t.clientY - ivZoomState.ty;
            ivIsPanning = true;
        } else if (touches.length === 2) {
            ivIsZooming = true;
            ivIsPanning = false;
            var dx = touches[0].clientX - touches[1].clientX;
            var dy = touches[0].clientY - touches[1].clientY;
            ivLastDist = Math.sqrt(dx*dx + dy*dy);
            ivStartScale = ivZoomState.scale;
            var cx = (touches[0].clientX + touches[1].clientX) / 2;
            var cy = (touches[0].clientY + touches[1].clientY) / 2;
            ivStartTx = ivZoomState.tx;
            ivStartTy = ivZoomState.ty;
        }
    }, { passive: true });

    document.getElementById('ivWrapper').addEventListener('touchmove', function(e) {
        e.preventDefault();
        var touches = e.touches;
        if (ivIsPanning && touches.length === 1) {
            ivZoomState.tx = touches[0].clientX - ivPanStartX;
            ivZoomState.ty = touches[0].clientY - ivPanStartY;
            ivApplyTransform();
        } else if (ivIsZooming && touches.length === 2) {
            var dx = touches[0].clientX - touches[1].clientX;
            var dy = touches[0].clientY - touches[1].clientY;
            var dist = Math.sqrt(dx*dx + dy*dy);
            if (ivLastDist > 0) {
                var scale = ivStartScale * (dist / ivLastDist);
                scale = Math.max(0.5, Math.min(5, scale));
                ivZoomState.scale = scale;
                ivZoomState.tx = ivStartTx;
                ivZoomState.ty = ivStartTy;
                ivApplyTransform();
            }
        }
    }, { passive: false });

    document.getElementById('ivWrapper').addEventListener('touchend', function(e) {
        if (ivIsZooming) { ivIsZooming = false; }
        if (ivIsPanning) { ivIsPanning = false; }
    }, { passive: true });

    document.getElementById('ivWrapper').addEventListener('wheel', function(e) {
        e.preventDefault();
        var delta = e.deltaY > 0 ? 0.9 : 1.1;
        var newScale = Math.max(0.5, Math.min(5, ivZoomState.scale * delta));
        ivZoomState.scale = newScale;
        ivApplyTransform();
    }, { passive: false });

    function createHeartParticles(btn) {
        var rect = btn.getBoundingClientRect();
        var cx = rect.left + rect.width/2;
        var cy = rect.top + rect.height/2;
        var emojis = ["❤️","💕","💗","✨","💖","💓"];
        for (var i=0; i<8; i++) {
            var heart = document.createElement('div');
            heart.className = 'heart-particle';
            heart.textContent = emojis[Math.floor(Math.random()*emojis.length)];
            var angle = (Math.PI*2*i/8) + (Math.random()-0.5)*0.4;
            var dist1 = 30 + Math.random()*20;
            var dist2 = 55 + Math.random()*40;
            var dist3 = 80 + Math.random()*50;
            heart.style.left = cx+'px';
            heart.style.top = cy+'px';
            heart.style.setProperty('--tx25', Math.cos(angle)*dist1+'px');
            heart.style.setProperty('--ty25', Math.sin(angle)*dist1+'px');
            heart.style.setProperty('--tx60', Math.cos(angle)*dist2+'px');
            heart.style.setProperty('--ty60', Math.sin(angle)*dist2+'px');
            heart.style.setProperty('--tx', Math.cos(angle)*dist3+'px');
            heart.style.setProperty('--ty', Math.sin(angle)*dist3+'px');
            heart.style.animationDelay = (Math.random()*0.12)+'s';
            document.body.appendChild(heart);
            setTimeout(function() { heart.remove(); }, 1200);
        }
    }
    window.createHeartParticles = createHeartParticles;
})();