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

    // Determine source label
    var sourceLabel = '自主开通';
    var sourceIcon = '🆓';
    if (vipInfo.source === 'pro_gift') {
      sourceLabel = '免费赠送';
      sourceIcon = '🎁';
    } else if (vipInfo.source === 'paid' || vipInfo.source === 'payment') {
      sourceLabel = '付费购买';
      sourceIcon = '💳';
    } else if (vipInfo.source === 'frontend_direct') {
      sourceLabel = '自主开通';
      sourceIcon = '🆓';
    }

    var overlay = document.createElement('div');
    overlay.id = 'proCelebrationOverlay';
    overlay.className = 'pro-celebration-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);';
    overlay.innerHTML = [
      '<canvas id="proCelebrationCanvas" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;"></canvas>',
      '<div class="pro-celebration-card" style="position:relative;background:linear-gradient(145deg,#1a1a2e,#16213e);border:1px solid rgba(245,158,11,0.3);border-radius:20px;padding:32px 28px;max-width:380px;width:90%;text-align:center;box-shadow:0 0 60px rgba(245,158,11,0.15),0 20px 60px rgba(0,0,0,0.5);color:#fff;overflow:hidden;">',
      '  <div style="position:absolute;top:-80px;right:-80px;width:200px;height:200px;background:radial-gradient(circle,rgba(245,158,11,0.15),transparent 70%);border-radius:50%;pointer-events:none;"></div>',
      '  <div style="position:absolute;bottom:-60px;left:-60px;width:160px;height:160px;background:radial-gradient(circle,rgba(245,158,11,0.1),transparent 70%);border-radius:50%;pointer-events:none;"></div>',
      '  <div class="pro-celebration-icon" style="position:relative;display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#d97706);box-shadow:0 0 30px rgba(245,158,11,0.4);margin-bottom:12px;">',
      '    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#fff" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="#fff"/></svg>',
      '  </div>',
      '  <div class="pro-celebration-title" style="font-size:22px;font-weight:700;margin-bottom:4px;background:linear-gradient(135deg,#fbbf24,#f59e0b);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">🎉 恭喜升级 Pro！</div>',
      '  <div class="pro-celebration-sub" style="font-size:13px;color:rgba(255,255,255,0.6);margin-bottom:16px;">您已成功开启 XTJ Pro 会员之旅</div>',
      '  <div class="pro-celebration-info" style="background:rgba(255,255,255,0.06);border-radius:12px;padding:12px;margin-bottom:16px;">',
      '    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:left;">',
      '      <div style="font-size:11px;color:rgba(255,255,255,0.4);">会员</div><div style="font-size:13px;font-weight:600;text-align:right;">XTJ Pro</div>',
      '      <div style="font-size:11px;color:rgba(255,255,255,0.4);">来源</div><div style="font-size:13px;font-weight:600;text-align:right;">' + sourceIcon + ' ' + sourceLabel + '</div>',
      '      <div style="font-size:11px;color:rgba(255,255,255,0.4);">有效期至</div><div style="font-size:13px;font-weight:600;text-align:right;">' + (vipInfo.expire_at ? new Date(vipInfo.expire_at).toLocaleDateString('zh-CN', {year:'numeric',month:'long',day:'numeric'}) : '30天') + '</div>',
      '    </div>',
      '  </div>',
      '  <div class="pro-celebration-features" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:16px;">',
      '    <div style="background:rgba(245,158,11,0.1);border-radius:8px;padding:6px 4px;font-size:11px;">👑 身份标识</div>',
      '    <div style="background:rgba(245,158,11,0.1);border-radius:8px;padding:6px 4px;font-size:11px;">📸 无限照片墙</div>',
      '    <div style="background:rgba(245,158,11,0.1);border-radius:8px;padding:6px 4px;font-size:11px;">⬆️ 200MB文件</div>',
      '    <div style="background:rgba(245,158,11,0.1);border-radius:8px;padding:6px 4px;font-size:11px;">🎨 Pro主题</div>',
      '    <div style="background:rgba(245,158,11,0.1);border-radius:8px;padding:6px 4px;font-size:11px;">📌 帖子置顶</div>',
      '    <div style="background:rgba(245,158,11,0.1);border-radius:8px;padding:6px 4px;font-size:11px;">✨ 动态特效</div>',
      '  </div>',
      '  <button class="pro-celebration-btn" id="proCelebrationBtn" style="width:100%;padding:12px;border:none;border-radius:12px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;font-size:15px;font-weight:600;cursor:pointer;transition:transform 0.2s,box-shadow 0.2s;box-shadow:0 4px 15px rgba(245,158,11,0.3);">开始体验 Pro →</button>',
      '</div>'
    ].join('');
    document.body.appendChild(overlay);

    var btn = document.getElementById('proCelebrationBtn');
    btn.onclick = function() {
      overlay.style.transition = 'opacity 0.4s,transform 0.4s';
      overlay.style.opacity = '0';
      overlay.style.transform = 'scale(0.95)';
      setTimeout(function() { overlay.remove(); }, 450);
    };
    btn.onmouseenter = function() { btn.style.transform = 'translateY(-2px)'; btn.style.boxShadow = '0 6px 20px rgba(245,158,11,0.4)'; };
    btn.onmouseleave = function() { btn.style.transform = ''; btn.style.boxShadow = '0 4px 15px rgba(245,158,11,0.3)'; };

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) {
        overlay.style.transition = 'opacity 0.4s,transform 0.4s';
        overlay.style.opacity = '0';
        overlay.style.transform = 'scale(0.95)';
        setTimeout(function() { overlay.remove(); }, 450);
      }
    });

    var card = overlay.querySelector('.pro-celebration-card');
    if (typeof gsap !== 'undefined') {
      var tl = gsap.timeline({ defaults: { ease: 'power4.out' } });
      tl.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.35 }, 0);
      tl.fromTo(card, { y: 80, opacity: 0, scale: 0.85 }, { y: 0, opacity: 1, scale: 1, duration: 0.7, ease: 'back.out(1.5)' }, 0.15);
      tl.fromTo('.pro-celebration-icon', { scale: 0, rotation: -45 }, { scale: 1, rotation: 0, duration: 0.5, ease: 'back.out(2.5)' }, 0.2);
      tl.fromTo('.pro-celebration-title', { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, 0.35);
      tl.fromTo('.pro-celebration-sub', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35 }, 0.42);
      tl.fromTo('.pro-celebration-info', { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35 }, 0.5);
      tl.fromTo('.pro-celebration-features > div', { y: 10, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.3, stagger: 0.04 }, 0.52);
      tl.fromTo('.pro-celebration-btn', { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35 }, 0.6);
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
