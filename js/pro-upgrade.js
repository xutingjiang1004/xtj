(function() {
  'use strict';
  if (window.__xtjProUpgradeLoaded) return;
  window.__xtjProUpgradeLoaded = true;

  var VIP_MARKER = '__vip__';
  var VIP_PLAN_ID = 'pro_monthly';
  var VIP_DURATION_DAYS = 30;
  var VIP_PRICE = 3;
  var LOCAL_VIP_KEY = 'xtj_local_vip';

  function getLocalVip() {
    try {
      var raw = localStorage.getItem(LOCAL_VIP_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  function setLocalVip(info) {
    try { localStorage.setItem(LOCAL_VIP_KEY, JSON.stringify(info)); } catch(e) {}
  }

  function clearLocalVip() {
    try { localStorage.removeItem(LOCAL_VIP_KEY); } catch(e) {}
  }

  function isLocalVipValid(info) {
    if (!info || !info.is_active) return false;
    if (info.expire_at && new Date(info.expire_at) > new Date()) return true;
    return false;
  }

  window.__xtjCheckLocalVip = function(userName) {
    var local = getLocalVip();
    if (local && local.user_name === userName && isLocalVipValid(local)) {
      return local;
    }
    return null;
  };

  window.__xtjSaveLocalVip = function(info) {
    setLocalVip(info);
  };

  window.__xtjClearLocalVip = function() {
    clearLocalVip();
  };

  window.__xtjDirectPurchasePro = async function(userName) {
    if (!userName) return { ok: false, error: '未登录' };

    var now = new Date();
    var expireAt = new Date(now.getTime() + VIP_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    var orderNo = 'XTJ_DIRECT_' + Date.now() + '_' + String(Math.random()).slice(2, 8);

    try {
      if (window.sb) {
        var vipContent = JSON.stringify({
          plan_id: VIP_PLAN_ID,
          plan_name: 'XTJ Pro',
          price: VIP_PRICE,
          is_active: true,
          order_no: orderNo,
          start_at: now.toISOString(),
          expire_at: expireAt,
          features: ['vip_badge', 'photo_wall_unlimited', 'large_file_upload', 'pin_post', 'custom_theme', 'profile_effects'],
          activated_at: now.toISOString(),
          source: 'frontend_direct'
        });
        var { error } = await window.sb.from('posts').insert([{
          user_name: userName,
          content: vipContent,
          media_type: VIP_MARKER,
          media_url: VIP_PLAN_ID,
          actor_key: 'vip_direct_' + Date.now()
        }]);
        if (error) console.warn('[Pro] Supabase insert failed (non-fatal):', error.message);
      } else {
        console.warn('[Pro] window.sb not available, local-only activation');
      }
    } catch(e) {
      console.warn('[Pro] Supabase insert error (non-fatal):', e.message);
    }

    var vipInfo = {
      ok: true,
      user_name: userName,
      plan_name: 'XTJ Pro',
      expire_at: expireAt,
      is_active: true,
      features: ['vip_badge', 'photo_wall_unlimited', 'large_file_upload', 'pin_post', 'custom_theme', 'profile_effects'],
      activated_at: now.toISOString()
    };

    window.__xtjSaveLocalVip({
      user_name: userName,
      plan_name: 'XTJ Pro',
      expire_at: expireAt,
      is_active: true,
      features: vipInfo.features,
      activated_at: now.toISOString()
    });

    // console.log('[Pro] VIP activated locally for', userName);
    return vipInfo;
  };

  window.__xtjQueryVipStatus = async function(userName) {
    if (!userName || !window.sb) return null;

    var local = window.__xtjCheckLocalVip(userName);
    if (local) return local;

    try {
      var { data } = await window.sb.from('posts')
        .select('content')
        .eq('user_name', userName)
        .eq('media_type', VIP_MARKER)
        .order('created_at', { ascending: false })
        .limit(5);

      if (data && data.length > 0) {
        for (var i = 0; i < data.length; i++) {
          try {
            var c = JSON.parse(data[i].content || '{}');
            if (c.is_active && c.expire_at && new Date(c.expire_at) > new Date()) {
              window.__xtjSaveLocalVip({
                user_name: userName,
                plan_name: c.plan_name || 'XTJ Pro',
                expire_at: c.expire_at,
                is_active: true,
                features: c.features || [],
                activated_at: c.activated_at
              });
              return c;
            }
          } catch(e) {}
        }
      }
    } catch(e) {
      console.warn('[Pro] Supabase query failed:', e);
    }

    window.__xtjClearLocalVip();
    return null;
  };

  window.__xtjShowProCelebration = function(vipInfo) {
    if (!vipInfo) return;

    var existing = document.getElementById('proCelebrationOverlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'proCelebrationOverlay';
    overlay.className = 'pro-celebration-overlay';
    overlay.innerHTML = [
      '<div class="pro-celebration-bg"></div>',
      '<canvas id="proCelebrationCanvas"></canvas>',
      '<div class="pro-celebration-card">',
      '  <div class="pro-celebration-icon">',
      '    <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5">',
      '      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="#f59e0b" stroke="#f59e0b"/>',
      '    </svg>',
      '  </div>',
      '  <div class="pro-celebration-title">🎉 恭喜升级 Pro！</div>',
      '  <div class="pro-celebration-sub">您已成功开通 XTJ Pro 会员</div>',
      '  <div class="pro-celebration-info">',
      '    <div class="pro-celebration-info-item"><span class="pro-celebration-info-label">会员</span><span class="pro-celebration-info-value">XTJ Pro</span></div>',
      '    <div class="pro-celebration-info-item"><span class="pro-celebration-info-label">有效期</span><span class="pro-celebration-info-value" id="proCelebrationExpiry">' + (vipInfo.expire_at ? new Date(vipInfo.expire_at).toLocaleDateString('zh-CN') : '30天') + '</span></div>',
      '    <div class="pro-celebration-info-item"><span class="pro-celebration-info-label">费用</span><span class="pro-celebration-info-value">¥' + (vipInfo.price || 3) + '/月</span></div>',
      '  </div>',
      '  <div class="pro-celebration-features">',
      '    <div class="pro-celebration-feature"><span class="pcf-icon">👑</span><span>专属身份标识</span></div>',
      '    <div class="pro-celebration-feature"><span class="pcf-icon">📸</span><span>照片墙无限上传</span></div>',
      '    <div class="pro-celebration-feature"><span class="pcf-icon">⬆️</span><span>200MB 大文件</span></div>',
      '    <div class="pro-celebration-feature"><span class="pcf-icon">🎨</span><span>Pro 专属主题</span></div>',
      '    <div class="pro-celebration-feature"><span class="pcf-icon">📌</span><span>帖子置顶特权</span></div>',
      '    <div class="pro-celebration-feature"><span class="pcf-icon">✨</span><span>动态特效</span></div>',
      '  </div>',
      '  <button class="pro-celebration-btn" id="proCelebrationBtn">开始体验 Pro</button>',
      '</div>'
    ].join('');
    document.body.appendChild(overlay);

    var btn = document.getElementById('proCelebrationBtn');
    btn.onclick = function() {
      overlay.classList.add('pro-celebration-exit');
      setTimeout(function() { overlay.remove(); }, 600);
    };

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) {
        overlay.classList.add('pro-celebration-exit');
        setTimeout(function() { overlay.remove(); }, 600);
      }
    });

    var card = overlay.querySelector('.pro-celebration-card');
    if (typeof gsap !== 'undefined') {
      var tl = gsap.timeline({ defaults: { ease: 'power4.out' } });
      tl.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0);
      tl.fromTo('.pro-celebration-bg', { scale: 0, opacity: 1 }, { scale: 3, opacity: 0.15, duration: 1.2, ease: 'power2.out' }, 0);
      tl.fromTo(card, { y: 60, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.6 }, 0.2);
      tl.fromTo('.pro-celebration-icon', { scale: 0, rotation: -30 }, { scale: 1, rotation: 0, duration: 0.5, ease: 'back.out(2)' }, 0.25);
      tl.fromTo('.pro-celebration-title', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, 0.35);
      tl.fromTo('.pro-celebration-sub', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, 0.42);
      tl.fromTo('.pro-celebration-info', { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, 0.5);
      tl.fromTo('.pro-celebration-features', { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, 0.55);
      tl.fromTo('.pro-celebration-btn', { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, 0.6);
      tl.fromTo('.pro-celebration-feature', { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, stagger: 0.06 }, 0.58);
    } else {
      overlay.style.opacity = '1';
      card.style.opacity = '1';
      card.style.transform = 'none';
    }

    window.__xtjStartProParticles('proCelebrationCanvas', 5000);
  };

  window.__xtjStartProParticles = function(canvasId, duration) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    var particles = [];
    var numParticles = 80;
    var colors = ['#f59e0b', '#d97706', '#fbbf24', '#fcd34d', '#fef3c7', '#fffbeb'];
    var startTime = Date.now();
    var animId = null;

    function randomRange(min, max) { return Math.random() * (max - min) + min; }

    for (var i = 0; i < numParticles; i++) {
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 100,
        y: canvas.height / 2 + (Math.random() - 0.5) * 100,
        vx: (Math.random() - 0.5) * 8,
        vy: -Math.random() * 6 - 2,
        size: randomRange(3, 11),
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
        decay: randomRange(0.003, 0.012),
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 8,
        shape: Math.random() > 0.5 ? 'star' : 'circle'
      });
    }

    function drawStar(cx, cy, r, rot) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot || 0);
      ctx.beginPath();
      for (var i = 0; i < 5; i++) {
        var angle = (i * 4 * Math.PI / 5) - Math.PI / 2;
        var method = i === 0 ? 'moveTo' : 'lineTo';
        ctx[method](Math.cos(angle) * r, Math.sin(angle) * r);
      }
      ctx.closePath();
      ctx.restore();
    }

    function animate() {
      var elapsed = Date.now() - startTime;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05;
        p.alpha -= p.decay;
        p.rotation += p.rotSpeed;

        if (p.alpha <= 0 || p.y > canvas.height + 20) {
          particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;

        if (p.shape === 'star') {
          drawStar(p.x, p.y, p.size, p.rotation * Math.PI / 180);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }

      if (particles.length > 0 && elapsed < duration) {
        if (particles.length < numParticles * 0.3 && Math.random() > 0.7) {
          particles.push({
            x: canvas.width / 2 + (Math.random() - 0.5) * 150,
            y: canvas.height / 2,
            vx: (Math.random() - 0.5) * 10,
            vy: -Math.random() * 8 - 3,
            size: randomRange(3, 10),
            color: colors[Math.floor(Math.random() * colors.length)],
            alpha: 1,
            decay: randomRange(0.004, 0.014),
            rotation: Math.random() * 360,
            rotSpeed: (Math.random() - 0.5) * 10,
            shape: Math.random() > 0.5 ? 'star' : 'circle'
          });
        }
        animId = requestAnimationFrame(animate);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    animate();

    window.addEventListener('resize', function() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    });

    return function stop() {
      if (animId) cancelAnimationFrame(animId);
    };
  };

  window.__xtjApplyProTheme = function(isPro) {
    document.documentElement.classList.toggle('xtj-pro-active', isPro);
    if (isPro) {
      var profilePanel = document.getElementById('panelProfile');
      if (profilePanel) profilePanel.classList.add('xtj-pro-profile');
    } else {
      var proProfile = document.querySelector('.xtj-pro-profile');
      if (proProfile) proProfile.classList.remove('xtj-pro-profile');
    }
  };

  window.__xtjGetProFeatures = function() {
    return {
      badge: '👑',
      label: 'Pro 会员',
      unlock: ['vip_badge', 'photo_wall_unlimited', 'large_file_upload', 'pin_post', 'custom_theme', 'profile_effects'],
      theme: 'xtj-pro-active'
    };
  };

  window.__xtjIsProUnlimited = function() {
    var uid = window.currentUser || '';
    var local = window.__xtjCheckLocalVip(uid);
    return !!(local && local.is_active);
  };

  var vipHistoryCache = window.__xtjVipHistoryCache || {
    loadedUsers: {},
    intervalsByUser: {}
  };
  window.__xtjVipHistoryCache = vipHistoryCache;

  function toTs(value) {
    if (!value) return NaN;
    var ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : NaN;
  }

  function buildVipInterval(userName, payload, fallbackStart) {
    if (!userName || !payload) return null;
    var startTs = toTs(payload.activated_at || payload.start_at || fallbackStart);
    var endTs = toTs(payload.expire_at);
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs < startTs) return null;
    return {
      user_name: String(userName),
      startTs: startTs,
      endTs: endTs
    };
  }

  function mergeVipIntervals(userName, intervals) {
    var key = String(userName || '');
    if (!key) return;
    if (!Array.isArray(vipHistoryCache.intervalsByUser[key])) {
      vipHistoryCache.intervalsByUser[key] = [];
    }
    var existing = vipHistoryCache.intervalsByUser[key];
    (Array.isArray(intervals) ? intervals : []).forEach(function(interval) {
      if (!interval) return;
      var duplicated = existing.some(function(item) {
        return item.startTs === interval.startTs && item.endTs === interval.endTs;
      });
      if (!duplicated) existing.push(interval);
    });
    existing.sort(function(a, b) {
      return a.startTs - b.startTs;
    });
  }

  function mergeLocalVipHistory(userName) {
    if (!userName || typeof window.__xtjCheckLocalVip !== 'function') return;
    var local = window.__xtjCheckLocalVip(userName);
    if (!local) return;
    var interval = buildVipInterval(userName, local, local.activated_at || local.start_at);
    if (interval) mergeVipIntervals(userName, [interval]);
  }

  window.__xtjBatchLoadVipHistory = async function(userNames) {
    var names = Array.from(new Set((Array.isArray(userNames) ? userNames : []).map(function(name) {
      return String(name || '').trim();
    }).filter(Boolean)));
    if (!names.length) return vipHistoryCache;

    names.forEach(function(name) {
      mergeLocalVipHistory(name);
    });

    var pending = names.filter(function(name) {
      return !vipHistoryCache.loadedUsers[name];
    });
    if (!pending.length || !window.sb) return vipHistoryCache;

    try {
      var result = await window.sb.from('posts')
        .select('user_name,content,created_at')
        .eq('media_type', VIP_MARKER)
        .in('user_name', pending)
        .order('created_at', { ascending: false });

      if (result && result.error) throw result.error;

      pending.forEach(function(name) {
        vipHistoryCache.loadedUsers[name] = true;
        if (!Array.isArray(vipHistoryCache.intervalsByUser[name])) {
          vipHistoryCache.intervalsByUser[name] = [];
        }
      });

      (result && Array.isArray(result.data) ? result.data : []).forEach(function(row) {
        if (!row || !row.user_name) return;
        try {
          var payload = JSON.parse(row.content || '{}');
          var interval = buildVipInterval(row.user_name, payload, row.created_at);
          if (interval) mergeVipIntervals(row.user_name, [interval]);
        } catch (_) {}
      });
    } catch (e) {
      pending.forEach(function(name) {
        mergeLocalVipHistory(name);
      });
    }

    return vipHistoryCache;
  };

  window.__xtjIsUserProAt = function(userName, createdAt) {
    var key = String(userName || '').trim();
    var createdTs = toTs(createdAt);
    if (!key || !Number.isFinite(createdTs)) return false;
    mergeLocalVipHistory(key);
    var intervals = vipHistoryCache.intervalsByUser[key] || [];
    return intervals.some(function(interval) {
      return interval && createdTs >= interval.startTs && createdTs <= interval.endTs;
    });
  };

  // console.log('[Pro] Upgrade module loaded');
})();
