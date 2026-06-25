/* ============================================================
   XTJ Pro 装扮 — 页面逻辑模块
   依赖：pro-upgrade.js（__xtjQueryVipStatus, __xtjCheckLocalVip 等）
   ============================================================ */
(function() {
  'use strict';
  if (window.__xtjProStyleLoaded) return;
  window.__xtjProStyleLoaded = true;

  var STYLE_KEY_PREFIX = 'xtj_pro_style_';

  // ===================== 默认值 =====================
  var DEFAULT_STYLE = {
    theme: 'default',
    bubble: 'default',
    post: 'default',
    updated_at: ''
  };

  // ===================== 本地存储 =====================
  function getStyleKey() {
    var uid = window.currentUser || '';
    return STYLE_KEY_PREFIX + uid;
  }

  function loadSavedStyle() {
    try {
      var raw = localStorage.getItem(getStyleKey());
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch(e) {}
    return null;
  }

  function saveStyleToLocal(style) {
    if (!window.currentUser) return;
    style.updated_at = new Date().toISOString();
    try { localStorage.setItem(getStyleKey(), JSON.stringify(style)); } catch(e) {}
  }

  // ===================== 获取当前草稿（未保存的选择） =====================
  function getCurrentStyleDraft() {
    var saved = loadSavedStyle();
    if (saved && saved.theme) {
      return {
        theme: saved.theme || 'default',
        bubble: saved.bubble || 'default',
        post: saved.post || 'default'
      };
    }
    return { theme: 'default', bubble: 'default', post: 'default' };
  }

  // ===================== 获取当前可用 Pro 权益 =====================
  function getCurrentProFeatures() {
    if (!window.currentUser) return [];
    var features = [];
    if (window.currentUser === 'XXZ') {
      features = ['custom_theme', 'pro_chat_bubble', 'pro_post_style'];
    } else if (typeof window.__xtjIsProUnlimited === 'function' && window.__xtjIsProUnlimited()) {
      var proFeatures = window.__xtjGetProFeatures ? window.__xtjGetProFeatures() : null;
      features = proFeatures ? (proFeatures.unlock || []) : ['custom_theme', 'pro_chat_bubble', 'pro_post_style'];
    }
    return features;
  }

  function hasProFeature(feature) {
    return getCurrentProFeatures().indexOf(feature) !== -1;
  }

  function isProUser() {
    if (window.currentUser === 'XXZ') return true;
    if (typeof window.__xtjIsProUnlimited === 'function') return window.__xtjIsProUnlimited();
    return false;
  }

  // ===================== 面板切换 =====================
  window.showProStyleCategory = window.showProStyleCategory || function(category) {
    var landing = document.getElementById('proStylePanelLanding');
    var actions = document.getElementById('proStylePanelActions');
    var panels = {
      theme: document.getElementById('proStylePanelTheme'),
      bubble: document.getElementById('proStylePanelBubble'),
      post: document.getElementById('proStylePanelPost')
    };
    if (landing) landing.hidden = true;
    if (actions) actions.hidden = true;
    Object.keys(panels).forEach(function(key) {
      if (panels[key]) panels[key].hidden = (key !== category);
    });
    // 刷新预览选中状态
    updatePreviewActiveStates();
    var page = document.getElementById('profileProStylePage');
    if (page && typeof page.scrollTo === 'function') {
      page.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  window.showProStyleLanding = window.showProStyleLanding || function() {
    var landing = document.getElementById('proStylePanelLanding');
    var actions = document.getElementById('proStylePanelActions');
    var panelIds = ['proStylePanelTheme', 'proStylePanelBubble', 'proStylePanelPost'];
    if (landing) landing.hidden = false;
    if (actions) actions.hidden = false;
    panelIds.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.hidden = true;
    });
  };

  // ===================== 分类预览选中状态 =====================
  function updatePreviewActiveStates() {
    var draft = getCurrentStyleDraft();
    document.querySelectorAll('.pro-style-option-card').forEach(function(card) {
      var type = card.getAttribute('data-style-type');
      var val = card.getAttribute('data-style-value');
      card.classList.toggle('active', type && val && draft[type] === val);
    });
  }

  // ===================== 选择样式 =====================
  window.setProStyleValue = function(type, value) {
    if (!type || !value) return;
    var draft = getCurrentStyleDraft();
    draft[type] = value;
    // 保存到 localStorage（草稿）
    if (window.currentUser) {
      var full = loadSavedStyle() || {};
      full[type] = value;
      full.updated_at = new Date().toISOString();
      try { localStorage.setItem(getStyleKey(), JSON.stringify(full)); } catch(e) {}
    }
    // 刷新预览选中
    updatePreviewActiveStates();
    // 刷新 select 同步
    var selectMap = { theme: 'proThemeSelect', bubble: 'proBubbleSelect', post: 'proPostStyleSelect' };
    var sel = document.getElementById(selectMap[type]);
    if (sel) sel.value = value;
  };

  // ===================== 应用样式到全站 =====================
  function applyStyleToDocument(style) {
    if (!style) style = getCurrentStyleDraft();
    // 通过 dataset 控制全站主题
    if (style.theme && style.theme !== 'default') {
      document.documentElement.setAttribute('data-pro-theme', style.theme);
    } else {
      document.documentElement.removeAttribute('data-pro-theme');
    }
    // 聊天气泡
    if (style.bubble && style.bubble !== 'default') {
      document.documentElement.setAttribute('data-pro-chat-bubble', style.bubble);
    } else {
      document.documentElement.removeAttribute('data-pro-chat-bubble');
    }
    // 帖子卡片装饰
    if (style.post && style.post !== 'default') {
      document.documentElement.setAttribute('data-pro-post-style', style.post);
    } else {
      document.documentElement.removeAttribute('data-pro-post-style');
    }
  }

  // ===================== 保存用户偏好 =====================
  window.saveCurrentUserStyle = function() {
    if (!window.currentUser) {
      alert('请先登录');
      return;
    }
    if (!isProUser()) {
      alert('开通 Pro 后可使用视觉权益');
      return;
    }
    var draft = getCurrentStyleDraft();
    // 禁止非 Pro 保存非默认项
    if (!hasProFeature('custom_theme') && draft.theme !== 'default') {
      alert('当前 Pro 不包含专属主题权益');
      return;
    }
    if (!hasProFeature('pro_chat_bubble') && draft.bubble !== 'default') {
      alert('当前 Pro 不包含聊天气泡权益');
      return;
    }
    if (!hasProFeature('pro_post_style') && draft.post !== 'default') {
      alert('当前 Pro 不包含帖子卡片装饰权益');
      return;
    }
    saveStyleToLocal(draft);
    applyStyleToDocument(draft);
    showSaveToast('视觉偏好已保存');
    // 回到总览
    if (typeof window.showProStyleLanding === 'function') {
      window.showProStyleLanding();
    }
    updateProStyleEntry();
  };

  // ===================== 加载已保存的用户偏好 =====================
  window.loadCurrentUserStyle = function() {
    var saved = loadSavedStyle();
    if (!saved) return DEFAULT_STYLE;
    return {
      theme: saved.theme || 'default',
      bubble: saved.bubble || 'default',
      post: saved.post || 'default'
    };
  };

  // ===================== 应用当前用户样式（外部调用入口） =====================
  window.__xtjApplyCurrentUserStyle = function() {
    if (!window.currentUser) return;
    var saved = loadSavedStyle();
    if (!saved) return;
    // 检查该用户之前保存过的，直接应用
    var hasStored = saved && saved.theme;
    if (hasStored) {
      applyStyleToDocument(saved);
    }
    // 刷新入口显示
    if (typeof updateProStyleEntry === 'function') {
      updateProStyleEntry();
    }
  };

  // ===================== 刷新整个 Pro 装扮 UI =====================
  window.refreshProStyleUI = function() {
    // 同步各面板的选择状态
    var draft = getCurrentStyleDraft();
    var selectMap = {
      proThemeSelect: 'theme',
      proBubbleSelect: 'bubble',
      proPostStyleSelect: 'post'
    };
    Object.keys(selectMap).forEach(function(id) {
      var sel = document.getElementById(id);
      if (sel) sel.value = draft[selectMap[id]];
    });
    updatePreviewActiveStates();
    applyStyleToDocument(draft);
  };

  // ===================== 入口显示更新 =====================
  function updateProStyleEntry() {
    var entry = document.getElementById('profileProStyleEntry');
    if (!entry) return;
    if (!window.currentUser) {
      entry.style.display = '';
      var badge = document.getElementById('proStyleBadge');
      if (badge) badge.textContent = '默认';
      return;
    }
    var saved = loadSavedStyle();
    var features = getCurrentProFeatures();
    var badge = document.getElementById('proStyleBadge');
    if (badge) {
      if (saved && saved.theme && saved.theme !== 'default') {
        badge.textContent = '已设置';
      } else if (features.length) {
        badge.textContent = '已解锁 ' + features.length + ' 项';
      } else {
        badge.textContent = '默认';
      }
    }
  }

  // ===================== Toast 提示 =====================
  function showSaveToast(msg) {
    var existing = document.getElementById('proStyleToast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'proStyleToast';
    toast.textContent = msg || '已保存';
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '104px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(43,73,57,0.94)',
      color: '#fff',
      padding: '10px 20px',
      borderRadius: '10px',
      fontSize: '14px',
      zIndex: '100001',
      boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      backdropFilter: 'blur(8px)',
      transition: 'opacity 0.3s'
    });
    document.body.appendChild(toast);
    setTimeout(function() {
      toast.style.opacity = '0';
      setTimeout(function() { toast.remove(); }, 350);
    }, 2000);
  }

  // ===================== 初始化 =====================
  function init() {
    // 页面加载后恢复已保存样式
    if (window.currentUser && typeof window.__xtjApplyCurrentUserStyle === 'function') {
      window.__xtjApplyCurrentUserStyle();
    }
    // 监听登录态变化
    var origOnLogin = window.__xtjOnLoginSuccess;
    window.__xtjOnLoginSuccess = function() {
      if (typeof origOnLogin === 'function') {
        try { origOnLogin(); } catch(_) {}
      }
      window.__xtjOnLoginSuccess = origOnLogin || null;
      if (typeof window.__xtjApplyCurrentUserStyle === 'function') {
        window.__xtjApplyCurrentUserStyle();
      }
      updateProStyleEntry();
    };
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

  // 暴露到外部
  window.__xtjProGetCurrentDraft = getCurrentStyleDraft;
  window.__xtjProUpdateEntry = updateProStyleEntry;
  window.__xtjProApplyStyle = applyStyleToDocument;
})();
