/**
 * Requested UX features only:
 * - Fluency: unified skeleton helper, tab prefetch, image lazy polish, toast grades, send/loading feedback
 * - Site: chat typing + long-press, settings (font/motion/cache/export), announcement pulse, photo confetti hook
 * Does not touch mobile dock bar / capsule animations.
 */
(function () {
  'use strict';
  if (window.__xtjUxFeaturesV1) return;
  window.__xtjUxFeaturesV1 = true;

  function isDock(el) {
    return !!(el && el.closest && el.closest('#dockBar, .dock-bar, .dock-tab'));
  }

  // ---------- Fluency 1: skeleton helper ----------
  window.xtjSkeletonHtml = function (variant, count) {
    variant = String(variant || 'feed');
    count = Math.max(1, Math.min(Number(count) || 3, 6));
    var rows = '';
    for (var i = 0; i < count; i++) {
      if (variant === 'chat' || variant === 'chat-list') {
        rows +=
          '<div class="xtj-sk-row xtj-sk-chat"><div class="xtj-sk-avatar"></div><div class="xtj-sk-lines"><i class="xtj-sk-line med"></i><i class="xtj-sk-line short"></i></div></div>';
      } else if (variant === 'ai') {
        rows +=
          '<div class="xtj-sk-row xtj-sk-ai"><div class="xtj-sk-lines"><i class="xtj-sk-line long"></i><i class="xtj-sk-line med"></i><i class="xtj-sk-line short"></i></div></div>';
      } else {
        rows +=
          '<div class="xtj-sk-row xtj-sk-feed"><div class="xtj-sk-avatar"></div><div class="xtj-sk-lines"><i class="xtj-sk-line med"></i><i class="xtj-sk-line long"></i><i class="xtj-sk-line short"></i></div><div class="xtj-sk-media"></div></div>';
      }
    }
    return '<div class="xtj-sk-pack" data-variant="' + variant + '" aria-busy="true" aria-label="加载中">' + rows + '</div>';
  };

  // Patch getXtjLoadingHtml if present so feed/chat/ai share one skeleton language
  function patchLoadingHtml() {
    var orig = window.getXtjLoadingHtml;
    if (typeof orig !== 'function' || orig.__xtjSkPatched) return;
    window.getXtjLoadingHtml = function (title, subtitle, type) {
      var t = String(type || '');
      if (t.indexOf('chat') !== -1) return window.xtjSkeletonHtml('chat', 4);
      if (t.indexOf('ai') !== -1) return window.xtjSkeletonHtml('ai', 3);
      if (t.indexOf('feed') !== -1 || t.indexOf('photo') !== -1) return window.xtjSkeletonHtml('feed', 3);
      try {
        return orig.apply(this, arguments);
      } catch (e) {
        return window.xtjSkeletonHtml('feed', 2);
      }
    };
    window.getXtjLoadingHtml.__xtjSkPatched = true;
  }

  // ---------- Fluency 1: tab content prefetch (desktop nav, not dock) ----------
  function prefetchTab(tab) {
    try {
      if (tab === 'chat' && typeof window.loadDockChatList === 'function') {
        window.loadDockChatList();
      } else if (tab === 'ai' || tab === 'photo' || tab === 'posts') {
        if (typeof window.prefetchStatData === 'function') window.prefetchStatData();
      } else if (tab === 'profile') {
        if (typeof window.loadProfileActivity === 'function') {
          try {
            window.loadProfileActivity();
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  function bindDesktopPrefetch() {
    document.querySelectorAll('.desktop-nav-item[data-desktop-tab], .desktop-nav-item[data-desktop-action]').forEach(function (btn) {
      if (btn.__xtjPrefetchBound) return;
      btn.__xtjPrefetchBound = true;
      var once = function () {
        var tab = btn.getAttribute('data-desktop-tab');
        var action = btn.getAttribute('data-desktop-action');
        if (action === 'ai-chat') tab = 'ai';
        if (tab === 'ai' || tab === 'photo' || tab === 'chat' || tab === 'posts' || tab === 'profile') prefetchTab(tab);
      };
      btn.addEventListener('pointerenter', once, { passive: true });
      btn.addEventListener('focus', once, { passive: true });
    });
  }

  // ---------- Fluency 1: image lazy polish ----------
  function polishImages(root) {
    var scope = root || document;
    var imgs = scope.querySelectorAll
      ? scope.querySelectorAll('#feed img:not([loading]), .post img:not([loading]), .photo-wall img:not([loading]), .chat-messages img:not([loading])')
      : [];
    Array.prototype.forEach.call(imgs, function (img) {
      if (!img.getAttribute('loading')) img.setAttribute('loading', 'lazy');
      if (!img.getAttribute('decoding')) img.setAttribute('decoding', 'async');
      img.classList.add('xtj-img-soft');
    });
  }

  // ---------- Fluency 2: toast grades ----------
  function patchToast() {
    var orig = window.showToast;
    if (typeof orig !== 'function' || orig.__xtjToastPatched) return;
    window.showToast = function (message, type) {
      type = type || 'info';
      if (type === true) type = 'error';
      var container = document.getElementById('toastContainer');
      if (!container) return orig.apply(this, arguments);
      var toast = document.createElement('div');
      var cls = 'toast toast-' + String(type).replace(/[^a-z]/g, '');
      if (type === 'error') cls += ' toast-error';
      if (type === 'success') cls += ' toast-success';
      if (type === 'warn' || type === 'warning') cls += ' toast-warn';
      if (type === 'info') cls += ' toast-info';
      toast.className = cls;
      toast.textContent = message == null ? '' : String(message);
      container.appendChild(toast);
      var hold = type === 'error' ? 4000 : type === 'success' ? 2200 : 2500;
      setTimeout(function () {
        toast.style.animation = 'toastFade 0.3s ease-out forwards';
        setTimeout(function () {
          if (toast.parentNode) toast.remove();
        }, 300);
      }, hold);
    };
    window.showToast.__xtjToastPatched = true;
  }

  // ---------- Fluency 2: like particle hook ----------
  function patchLikeBurst() {
    var orig = window.toggleLike;
    if (typeof orig !== 'function' || orig.__xtjLikePatched) return;
    window.toggleLike = function (btn, postId) {
      var wasLiked = btn && btn.classList && btn.classList.contains('liked');
      var ret = orig.apply(this, arguments);
      try {
        if (btn && !wasLiked && typeof window.xtjHeartBurst === 'function') {
          // fire after optimistic like applied
          setTimeout(function () {
            if (btn.classList.contains('liked')) window.xtjHeartBurst(btn, { count: 8 });
          }, 20);
        }
      } catch (e) {}
      return ret;
    };
    window.toggleLike.__xtjLikePatched = true;
  }

  // ---------- Fluency 2/3: button press scale (not dock) ----------
  function bindButtonPress() {
    if (window.__xtjBtnPressBound) return;
    window.__xtjBtnPressBound = true;
    document.addEventListener(
      'pointerdown',
      function (e) {
        var t = e.target;
        if (!t || isDock(t)) return;
        var btn = t.closest && t.closest('button:not(.dock-tab), .btn, .action-btn, .send-btn, .ai-chat-send, .dt-action-btn, .desktop-nav-item');
        if (!btn || isDock(btn)) return;
        if (window.__xtjPerfProfile === 'lite') return;
        btn.classList.add('xtj-pressing');
      },
      true
    );
    function clearPress(e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var btn = t.closest('.xtj-pressing');
      if (btn) btn.classList.remove('xtj-pressing');
    }
    document.addEventListener('pointerup', clearPress, true);
    document.addEventListener('pointercancel', clearPress, true);
  }

  // ---------- Site 2 chat: typing indicator + long-press menu ----------
  function ensureTypingEl() {
    var messages = document.getElementById('dockChatMessages');
    if (!messages) return null;
    var el = document.getElementById('dockChatTyping');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dockChatTyping';
      el.className = 'chat-typing-indicator';
      el.hidden = true;
      el.innerHTML = '<span class="chat-typing-dots"><i></i><i></i><i></i></span><span class="chat-typing-text">发送中…</span>';
      messages.parentNode && messages.parentNode.insertBefore(el, messages.nextSibling);
    }
    return el;
  }

  // ★ 2026-09-25 改造：原来的「发送中…」是假的 —— 它只绑在发送按钮的 click 上、固定显示 1.8 秒，
  //   跟真实发送状态无关：按回车不触发、消息早已送达它还在闪、发送失败时它照样显示「发送中」，
  //   而气泡里已经有真实的「图片上传中…」，属于重复且误导。
  //   现在改为由 06-chat-and-nav.js 的 sendDockChatMessage 在开始/结束时回调真实状态。
  // ★ 2026-09-26（用户反馈）：这条「●●● 发送中…」出现在**输入框上方**，位置不对——
  //   发送状态应该跟着气泡走。现在媒体消息的真实进度（进度环 + 百分比）直接显示在
  //   气泡下方（setDockChatUploadProgress），文字消息则完全不需要"发送中"（发送很快）。
  //   因此这里**不再显示**消息列表下方的指示条（DOM 永远保持 hidden），
  //   只保留发送按钮上的 is-sending 微动画作为轻量反馈。
  function setChatSending(on) {
    var tip = ensureTypingEl();
    if (tip) tip.hidden = true;
    var sendBtn = document.getElementById('dockChatSendBtn');
    if (sendBtn) {
      try { sendBtn.classList.toggle('is-sending', !!on); } catch (e) {}
    }
  }

  function patchChatSend() {
    // 函数名保留（boot() 的调用点不动）：现在只负责把真实状态的入口挂到 window 上。
    window.__xtjNotifyChatSending = setChatSending;
  }

  // ---------- Site 4 settings ----------
  function applyFontScale(scale) {
    document.documentElement.style.setProperty('--xtj-font-scale', String(scale || 1));
    try {
      window.safeStorage && window.safeStorage.set('xtj_font_scale', String(scale));
    } catch (e) {}
  }

  function applyMotion(mode) {
    document.documentElement.setAttribute('data-xtj-motion', mode || 'full');
    if (mode === 'off') document.documentElement.classList.add('perf-lite');
    try {
      window.safeStorage && window.safeStorage.set('xtj_motion', mode || 'full');
    } catch (e) {}
  }

  function clearLocalCache() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        // keep auth keys（M63：xtj_user_session 等会话/身份键此前被 ^xtj_user$ 精确匹配漏保而误删，导致用户被登出）
        // ★ 2026-09-22：xtj_device_id 必须保活 —— 它是"本机 30 天免登录"的锚点，
        //   一旦被清理，下次登录会生成一个新 ID，等于设备身份丢失。
        if (/^xtj_user$|^xtj_user_session$|^xtj_admin_session$|^xtj_username$|^xtj_user_name$|^xtj_user_id$|^xtj_pw_hash$|^xtj_device_id$|^xtj_.*token|^xtj_theme|^xtj_font_scale|^xtj_motion|^xtj-notif/.test(k)) continue;
        if (k.indexOf('xtj_') === 0 || k.indexOf('xtj-') === 0) keys.push(k);
      }
      keys.forEach(function (k) {
        try {
          localStorage.removeItem(k);
        } catch (e) {}
      });
      if (typeof window.showToast === 'function') window.showToast('已清理本地缓存', 'success');
    } catch (e) {
      if (typeof window.showToast === 'function') window.showToast('清理失败', 'error');
    }
  }

  function exportMyData() {
    try {
      var payload = {
        exported_at: new Date().toISOString(),
        user: window.currentUser || null,
        feed_posts: Array.isArray(window.feedAllPosts) ? window.feedAllPosts.filter(function (p) {
          return p && p.user_name === window.currentUser;
        }) : [],
        likes: Array.isArray(window.feedAllLikes)
          ? window.feedAllLikes.filter(function (l) {
              return l && l.user_name === window.currentUser;
            })
          : [],
        comments: Array.isArray(window.feedAllComments)
          ? window.feedAllComments.filter(function (c) {
              return c && c.user_name === window.currentUser;
            })
          : []
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'xtj-export-' + (window.currentUser || 'guest') + '-' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 500);
      if (typeof window.showToast === 'function') window.showToast('已导出数据', 'success');
    } catch (e) {
      if (typeof window.showToast === 'function') window.showToast('导出失败', 'error');
    }
  }

  function injectProfileSettings() {
    var box = document.querySelector('#panelProfile .profile-settings');
    if (!box || box.querySelector('#xtjFontScale')) return;

    function row(label, innerHtml) {
      var div = document.createElement('div');
      div.className = 'profile-setting-item';
      div.innerHTML =
        '<div class="profile-setting-label"><span class="profile-setting-text">' +
        label +
        '</span></div><div class="profile-setting-control">' +
        innerHtml +
        '</div>';
      return div;
    }

    var fontRow = row(
      '字体大小',
      '<select id="xtjFontScale" class="profile-select" aria-label="字体大小"><option value="0.92">小</option><option value="1">标准</option><option value="1.08">大</option><option value="1.16">更大</option></select>'
    );
    var motionRow = row(
      '动效强度',
      '<select id="xtjMotionMode" class="profile-select" aria-label="动效强度"><option value="full">满</option><option value="weak">弱</option><option value="off">关</option></select>'
    );
    var cacheRow = row('清理缓存', '<button type="button" class="btn btn-ghost profile-mini-btn" id="xtjClearCacheBtn">清理</button>');
    var exportRow = row('导出我的数据', '<button type="button" class="btn btn-ghost profile-mini-btn" id="xtjExportDataBtn">导出</button>');
    box.appendChild(fontRow);
    box.appendChild(motionRow);
    box.appendChild(cacheRow);
    box.appendChild(exportRow);

    var savedScale = '1';
    var savedMotion = 'full';
    try {
      savedScale = (window.safeStorage && window.safeStorage.get('xtj_font_scale')) || '1';
      savedMotion = (window.safeStorage && window.safeStorage.get('xtj_motion')) || 'full';
    } catch (e) {}
    var fontSel = document.getElementById('xtjFontScale');
    var motionSel = document.getElementById('xtjMotionMode');
    if (fontSel) {
      fontSel.value = savedScale;
      applyFontScale(savedScale);
      fontSel.addEventListener('change', function () {
        applyFontScale(fontSel.value);
        if (typeof window.showToast === 'function') window.showToast('字体已更新', 'success');
      });
    }
    if (motionSel) {
      motionSel.value = savedMotion;
      applyMotion(savedMotion);
      motionSel.addEventListener('change', function () {
        applyMotion(motionSel.value);
        if (typeof window.showToast === 'function') window.showToast('动效已更新', 'success');
      });
    }
    var clearBtn = document.getElementById('xtjClearCacheBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearLocalCache);
    var exportBtn = document.getElementById('xtjExportDataBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportMyData);
  }

  // ---------- Site 4 announcement pulse ----------
  function enhanceAnnouncement() {
    var badge = document.getElementById('announcementBadge');
    if (badge && badge.style.display !== 'none' && (badge.textContent || '') !== '0') {
      badge.classList.add('xtj-ann-pulse');
    }
    var btn = document.getElementById('announcementBtn');
    if (btn) btn.classList.add('xtj-ann-btn');
  }

  // ---------- Site 3 photo confetti API ----------
  window.__xtjPhotoUploadCelebrate = function () {
    if (window.__xtjPerfProfile === 'lite') return;
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    } catch (e) {}
    var layer = document.createElement('div');
    layer.className = 'xtj-confetti-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    var colors = ['#40a774', '#52b6a0', '#ffd166', '#ef476f', '#118ab2', '#06d6a0'];
    for (var i = 0; i < 28; i++) {
      var p = document.createElement('i');
      p.style.cssText =
        'left:' +
        Math.random() * 100 +
        'vw;background:' +
        colors[i % colors.length] +
        ';animation-delay:' +
        Math.random() * 0.25 +
        's;animation-duration:' +
        (0.9 + Math.random() * 0.8) +
        's';
      layer.appendChild(p);
    }
    setTimeout(function () {
      if (layer.parentNode) layer.remove();
    }, 1800);
  };

  // ---------- Photo wall spacing class ----------
  function polishPhotoWall() {
    var wall = document.getElementById('photoWall') || document.querySelector('.photo-wall-grid, #photoWallGrid, .pw-grid');
    // 幂等保护：class 已存在时不再 add，避免产生新 mutation 触发 observer 再处理
    if (wall && !wall.classList.contains('xtj-photo-grid-polish')) wall.classList.add('xtj-photo-grid-polish');
    // also polish common photo containers
    document.querySelectorAll('.photo-item, .pw-item, .photo-wall-item').forEach(function (n) {
      if (!n.classList.contains('xtj-photo-item-polish')) n.classList.add('xtj-photo-item-polish');
    });
  }

  // ★ 2026-09-23 移除：照片墙预览里那两个「设为头像 / 问小猫描述」浮动按钮。
  //   它们锚定在预览底部，位置与 6 个导航按钮的工具栏（y≈772）几乎完全重叠，
  //   看起来像"工具栏背后多出来的两个按钮"，且点了也只是弹提示/跳转，属多余入口。
  //   原始实现见 git 历史（函数 ensurePhotoPreviewActions + .xtj-photo-preview-actions）。

  function boot() {
    patchLoadingHtml();
    patchToast();
    patchLikeBurst();
    bindButtonPress();
    bindDesktopPrefetch();
    polishImages(document);
    injectProfileSettings();
    enhanceAnnouncement();
    patchChatSend();
    polishPhotoWall();
    try {
      // 防重入：回调里会对 body 子节点加 class，若直接改会触发自身 mutation
      // → 无限循环占死主线程（线上首页曾因此彻底卡死，F12 都按不出来）。
      // 处理期间先 disconnect，杜绝回调重入，处理完再恢复观察。
      var moBody = new MutationObserver(function () {
        try {
          moBody.disconnect();
          polishPhotoWall();
        } finally {
          moBody.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
        }
      });
      moBody.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    } catch (eObs) {}

    // restore prefs
    try {
      var fs = window.safeStorage && window.safeStorage.get('xtj_font_scale');
      if (fs) applyFontScale(fs);
      var mo = window.safeStorage && window.safeStorage.get('xtj_motion');
      if (mo) applyMotion(mo);
    } catch (e) {}

    // observe feed mutations for new images
    try {
      var feed = document.getElementById('feed');
      if (feed && typeof MutationObserver === 'function') {
        new MutationObserver(function () {
          polishImages(feed);
        }).observe(feed, { childList: true, subtree: true });
      }
      var chat = document.getElementById('dockChatMessages');
      if (chat && typeof MutationObserver === 'function') {
        new MutationObserver(function () {
          try {
            chat.querySelectorAll('.msg-read-status').forEach(function (n) {
              if ((n.textContent || '').indexOf('已读') >= 0) n.classList.add('is-read');
            });
          } catch (e2) {}
        }).observe(chat, { childList: true, subtree: true });
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
