(function() {
  'use strict';
  if (window.__xtjProUpgradeLoaded) return;
  var _createTimeoutSignal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? function(ms) { return AbortSignal.timeout(ms); } : function(ms) { var c = new AbortController(); setTimeout(function() { c.abort(); }, ms); return c.signal; };
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

  // deprecated: frontend direct Pro activation disabled. Pro can only be granted by admin campaigns.
  // 保留函数名以兼容旧代码，但必须返回禁用错误，禁止向 posts 插入 __vip__ 记录
  window.__xtjDirectPurchasePro = async function(userName) {
    console.warn('[Pro] __xtjDirectPurchasePro 已禁用，请通过管理员发布的活动领取 Pro');
    return {
      ok: false,
      error: '前端直接开通 Pro 已禁用，请通过管理员发布的活动领取'
    };
  };

  window.__xtjQueryVipStatus = async function(userName) {
    if (!userName) return null;

    var local = window.__xtjCheckLocalVip(userName);
    if (local) return local;

    // 通过 API 查询 VIP 状态，不再直连 Supabase
    var _apiBase = (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || window.API_BASE || window.location.origin;
    if (_apiBase) {
      try {
        var resp = await fetch(_apiBase + '/api/vip/status?user_name=' + encodeURIComponent(userName), {
          signal: _createTimeoutSignal(8000)
        });
        var data = await resp.json();
        if (data && data.active_vip && data.active_vip.is_active && data.active_vip.expire_at) {
          var expireTs = new Date(data.active_vip.expire_at).getTime();
          if (!isNaN(expireTs) && expireTs > Date.now()) {
            window.__xtjSaveLocalVip({
              user_name: userName,
              plan_name: data.active_vip.plan_name || 'XTJ Pro',
              expire_at: data.active_vip.expire_at,
              is_active: true,
              features: data.active_vip.features || [],
              activated_at: data.active_vip.activated_at
            });
            return data.active_vip;
          }
        }
      } catch(e) {
        console.warn('[Pro] API vip status query failed:', e);
      }
    }

    window.__xtjClearLocalVip();
    return null;
  };

  window.__xtjShowProCelebration = function(vipInfo) {
    if (!vipInfo) return;

    var existing = document.getElementById('proCelebrationOverlay');
    if (existing) existing.remove();

    // Determine source label
    var sourceLabel = '活动领取';
    var sourceIcon = '🎁';
    if (vipInfo.source === 'pro_gift') {
      sourceLabel = '活动领取';
      sourceIcon = '🎁';
    } else if (vipInfo.source === 'admin_gift') {
      sourceLabel = '管理员赠送';
      sourceIcon = '🎁';
    } else if (vipInfo.source === 'paid' || vipInfo.source === 'payment') {
      sourceLabel = '付费购买';
      sourceIcon = '💳';
    }

    var overlay = document.createElement('div');
    overlay.id = 'proCelebrationOverlay';
    overlay.className = 'pro-celebration-overlay';

    var canvas = document.createElement('canvas');
    canvas.id = 'proCelebrationCanvas';
    canvas.className = 'pro-celebration-canvas';
    overlay.appendChild(canvas);

    var card = document.createElement('div');
    card.className = 'pro-celebration-card';

    var glow1 = document.createElement('div');
    glow1.className = 'pro-celebration-glow pro-celebration-glow-top';
    card.appendChild(glow1);

    var glow2 = document.createElement('div');
    glow2.className = 'pro-celebration-glow pro-celebration-glow-bottom';
    card.appendChild(glow2);

    var iconWrap = document.createElement('div');
    iconWrap.className = 'pro-celebration-icon';
    iconWrap.innerHTML = '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#fff" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="#fff"/></svg>';
    card.appendChild(iconWrap);

    var title = document.createElement('div');
    title.className = 'pro-celebration-title';
    title.textContent = '🎉 恭喜升级 Pro！';
    card.appendChild(title);

    var sub = document.createElement('div');
    sub.className = 'pro-celebration-sub';
    sub.textContent = '您已成功开启 XTJ Pro 视觉权益';
    card.appendChild(sub);

    var info = document.createElement('div');
    info.className = 'pro-celebration-info';
    var infoGrid = document.createElement('div');
    infoGrid.className = 'pro-celebration-info-grid';

    function addInfoRow(label, value) {
      var lbl = document.createElement('div'); lbl.className = 'pro-celebration-info-label'; lbl.textContent = label; infoGrid.appendChild(lbl);
      var val = document.createElement('div'); val.className = 'pro-celebration-info-value'; val.textContent = value; infoGrid.appendChild(val);
    }
    addInfoRow('会员', 'XTJ Pro');
    addInfoRow('来源', sourceIcon + ' ' + sourceLabel);
    var expireText = vipInfo.expire_at ? new Date(vipInfo.expire_at).toLocaleDateString('zh-CN', {year:'numeric',month:'long',day:'numeric'}) : '30天';
    addInfoRow('有效期至', expireText);

    info.appendChild(infoGrid);
    card.appendChild(info);
    overlay.appendChild(card);

    var features = document.createElement('div');
    features.className = 'pro-celebration-features';
    ['🎨 专属主题', '💬 聊天气泡', '🪴 帖子卡片装饰'].forEach(function(t) {
      var f = document.createElement('div');
      f.className = 'pro-celebration-feature';
      f.textContent = t;
      features.appendChild(f);
    });
    card.appendChild(features);

    var btn = document.createElement('button');
    btn.className = 'pro-celebration-btn';
    btn.id = 'proCelebrationBtn';
    btn.textContent = '开始体验 Pro';
    card.appendChild(btn);
    document.body.appendChild(overlay);

    function closeOverlay() {
      if (overlay.classList.contains('is-closing')) return;
      overlay.classList.add('is-closing');
      setTimeout(function() { overlay.remove(); }, 450);
    }

    btn.onclick = closeOverlay;

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeOverlay();
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
      tl.fromTo('.pro-celebration-feature', { y: 10, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.3, stagger: 0.04 }, 0.52);
      tl.fromTo('.pro-celebration-btn', { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35 }, 0.6);
    } else {
      overlay.classList.add('is-ready');
      card.classList.add('is-ready');
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
    if (typeof window.__xtjApplyCurrentUserStyle === 'function') {
      try { window.__xtjApplyCurrentUserStyle(); } catch(_) {}
    }
  };

  window.__xtjGetProFeatures = function() {
    return {
      badge: '👑',
      label: 'Pro 会员',
      unlock: ['custom_theme', 'pro_chat_bubble', 'pro_post_style'],
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

  // ===================== Pro 活动 API 调用 =====================

  // 检测 fake login：有 currentUser 但无 token 也无 password_hash
  function isProGiftsFakeLogin() {
    if (typeof window.getUserToken === 'function' && window.getUserToken()) return false;
    try {
      var pwHash = sessionStorage.getItem('xtj_pw_hash') || localStorage.getItem('xtj_pw_hash') || '';
      if (pwHash) return false;
    } catch (e) {}
    return true;
  }

  // 假登录提示
  function renderFakeLogin() {
    return [
      '<div class="pro-gift-auth-required">',
      '  <div class="pro-gift-auth-icon">🔑</div>',
      '  <div class="pro-gift-auth-title">登录状态已过期</div>',
      '  <div class="pro-gift-auth-desc">你的登录状态已过期，请重新登录后查看 Pro 活动。</div>',
      '  <button class="pro-gift-auth-btn" onclick="reAuthAndRefresh()">重新登录</button>',
      '</div>'
    ].join('');
  }

  // 获取可用 Pro 活动列表（带 Authorization header）
  var _fetchProGiftsLock = false;
  window.fetchProGifts = async function() {
    if (_fetchProGiftsLock) return;
    _fetchProGiftsLock = true;
    try {
    var listEl = document.getElementById('proGiftList');
    if (!listEl) return;
    if (!window.currentUser) {
      listEl.innerHTML = '<div class="pro-gift-empty">登录后可查看 Pro 活动</div>';
      return;
    }
    // 假登录状态：直接显示"登录状态已过期"，不浪费一次 401
    if (isProGiftsFakeLogin()) {
      listEl.innerHTML = renderFakeLogin();
      return;
    }
    listEl.innerHTML = '<div class="pro-gift-loading">加载中...</div>';

    for (var retry = 0; retry <= 1; retry++) {
      try {
        var headers = { 'Content-Type': 'application/json' };
        if (typeof window.getUserAuthHeaders === 'function') {
          var authHeaders = await window.getUserAuthHeaders();
          if (authHeaders) {
            headers['Authorization'] = authHeaders['Authorization'];
          }
        }
        var _apiBase2 = (window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || window.API_BASE || '';
        var resp = await fetch(_apiBase2 + '/api/pro-gifts/available', {
          headers: headers,
          signal: _createTimeoutSignal(10000)
        });
        if (resp.status === 401 || resp.status === 403) {
          if (retry === 0) {
            // 尝试重试（clearUserToken + 重新认证）
            if (typeof window.clearUserToken === 'function') {
              window.clearUserToken();
            }
            // 重试前再判断一次：重试后变成 fake login 也要立刻结束
            if (isProGiftsFakeLogin()) {
              listEl.innerHTML = renderFakeLogin();
              return;
            }
            continue;
          }
          listEl.innerHTML = renderAuthRequired();
          return;
        }
        if (!resp.ok) {
          listEl.innerHTML = '<div class="pro-gift-error">请求失败，请稍后重试</div>';
          return;
        }
        var data = await resp.json();
        renderGiftList(listEl, data.gifts || data.data || []);
        return;
      } catch(e) {
        if (retry === 0) continue;
        listEl.innerHTML = '<div class="pro-gift-error">网络错误，请检查网络后重试</div>';
      }
    }
    } finally { _fetchProGiftsLock = false; }
  };

  // 领取 Pro 活动 — 由 core.js 提供完整实现 (含UI按钮状态管理)
  // 此处不再重复定义, 避免覆盖 core.js 版本

  // 渲染活动列表
  function renderGiftList(container, gifts) {
    if (!gifts || !gifts.length) {
      container.innerHTML = '<div class="pro-gift-empty">暂无可用活动</div>';
      return;
    }
    var html = gifts.map(function(g) {
      var cfg = g.campaign || g.config || {};
      var name = cfg.name || cfg.title || g.name || 'Pro 活动';
      var remain = cfg.claim_limit ? (cfg.claim_limit - (g.claim_count || 0)) : '';
      var claimed = g.claimed || g.is_claimed;
      var expired = g.expired || g.is_expired;
      var disabled = claimed || expired;
      return [
        '<div class="pro-gift-card" data-id="' + (g.id || g.gift_id) + '">',
        '  <div class="pro-gift-card-header">',
        '    <div class="pro-gift-card-title">' + escapeHtml(name) + '</div>',
        '    <div class="pro-gift-card-badge' + (claimed ? ' claimed' : '') + '">' + (claimed ? '已领取' : (expired ? '已结束' : '可用')) + '</div>',
        '  </div>',
        cfg.description ? '  <div class="pro-gift-card-desc">' + escapeHtml(cfg.description) + '</div>' : '',
        '  <div class="pro-gift-card-footer">',
        remain ? '    <span class="pro-gift-card-remain">剩余 ' + remain + ' 份</span>' : '',
        disabled ? '' : '    <button class="pro-gift-card-btn" onclick="onClaimGift(\'' + escapeAttr(g.id || g.gift_id).replace(/\\/g, '\\\\') + '\', event)">立即领取</button>',
        '  </div>',
        '</div>'
      ].join('');
    }).join('');
    container.innerHTML = html;
  }

  // 需要重新登录的提示渲染
  function renderAuthRequired() {
    return [
      '<div class="pro-gift-auth-required">',
      '  <div class="pro-gift-auth-icon">🔑</div>',
      '  <div class="pro-gift-auth-title">登录凭证需要刷新</div>',
      '  <div class="pro-gift-auth-desc">你当前账号仍显示为已登录，但领取 Pro 活动需要重新验证一次身份。可点击重试或重新登录。</div>',
      '  <div class="pro-gift-auth-actions">',
      '    <button class="pro-gift-auth-btn pro-gift-auth-btn-secondary" onclick="window.fetchProGifts && window.fetchProGifts()">重试</button>',
      '    <button class="pro-gift-auth-btn" onclick="reAuthAndRefresh()">重新登录</button>',
      '  </div>',
      '</div>'
    ].join('');
  }

  // 重新登录
  window.reAuthAndRefresh = function() {
    try {
    // 清理旧凭证
    if (typeof window.clearUserToken === 'function') {
      window.clearUserToken();
    }
    try { localStorage.removeItem('xtj_user_token'); } catch(_) {}
    // 调用登录弹窗
    if (typeof window.closeModal === 'function') {
      window.closeModal('loginModal');
    }
    if (typeof window.openAuthModal === 'function') {
      window.openAuthModal('login');
      // 注册登录成功后的回调
      var origOnLogin = window.__xtjOnLoginSuccess;
      window.__xtjOnLoginSuccess = function() {
        if (typeof origOnLogin === 'function') {
          try { origOnLogin(); } catch(_) {}
        }
        window.__xtjOnLoginSuccess = origOnLogin || null;
        // 登录成功后自动刷新 Pro 活动
        if (typeof window.fetchProGifts === 'function') {
          window.fetchProGifts();
        }
        // 刷新 VIP 状态
        if (window.currentUser && typeof window.__xtjQueryVipStatus === 'function') {
          window.__xtjQueryVipStatus(window.currentUser);
        }
      };
    }
    } catch(e) { try { console.warn('[Pro] reAuthAndRefresh error:', e); } catch(_) {} }
  };

  // 全局领取回调（由按钮 onclick 触发）
  window.onClaimGift = async function(giftId, ev) {
    var btn = ev && ev.target ? ev.target : (typeof event !== 'undefined' ? event.target : null);
    if (btn) {
      btn.disabled = true;
      btn.textContent = '领取中...';
    }
    var result = await window.claimProGift(giftId);
    if (btn) {
      btn.disabled = false;
      btn.textContent = '立即领取';
    }
    if (result.ok) {
      if (result.data && result.data.vip_info && typeof window.__xtjShowProCelebration === 'function') {
        window.__xtjShowProCelebration(result.data.vip_info);
      }
    } else if (result.needsReauth) {
      var listEl = document.getElementById('proGiftList');
      if (listEl) listEl.innerHTML = renderAuthRequired();
    } else {
      alert(result.error || '领取失败');
    }
  };

  // 简单 escapeHtml
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // escape attribute
  function escapeAttr(str) {
    return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 在页面加载完成后，如果 Pro 活动区块可见，自动查询
  document.addEventListener('DOMContentLoaded', function() {
    var proGiftSection = document.getElementById('proGiftSection');
    if (proGiftSection && !proGiftSection.hidden) {
      if (typeof window.fetchProGifts === 'function') {
        window.fetchProGifts();
      }
    }
  });

  // console.log('[Pro] Upgrade module loaded');
})();
