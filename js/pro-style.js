(function() {
  'use strict';
  if (window.__xtjProStyleLoaded) return;
  window.__xtjProStyleLoaded = true;

  var PRO_STYLE_KEY_PREFIX = 'xtj_pro_style_';
  var PRO_STYLE_DEFAULTS = {
    theme: 'default',
    bubble: 'default',
    post: 'default',
    updated_at: ''
  };

  /* ============ LocalStorage persistence ============ */

  function getStyleStorageKey(userName) {
    return PRO_STYLE_KEY_PREFIX + String(userName || '').trim();
  }

  function readLocalStyle(userName) {
    if (!userName) return null;
    try {
      var raw = localStorage.getItem(getStyleStorageKey(userName));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return normalizeLocalStyle(parsed);
    } catch(e) {
      return null;
    }
  }

  function writeLocalStyle(userName, style) {
    if (!userName) return;
    try {
      localStorage.setItem(getStyleStorageKey(userName), JSON.stringify(normalizeLocalStyle(style)));
    } catch(e) {}
  }

  function removeLocalStyle(userName) {
    if (!userName) return;
    try { localStorage.removeItem(getStyleStorageKey(userName)); } catch(e) {}
  }

  function normalizeLocalStyle(payload) {
    var s = {};
    s.theme = (payload && ['default', 'mint', 'aqua', 'sakura', 'lavender'].indexOf(payload.theme) >= 0)
      ? payload.theme : 'default';
    s.bubble = (payload && ['default', 'mint', 'aqua', 'cream', 'sakura', 'lavender'].indexOf(payload.bubble) >= 0)
      ? payload.bubble : 'default';
    s.post = (payload && ['default', 'clean_border', 'leaf_corner', 'soft_glow', 'minimal_pro'].indexOf(payload.post) >= 0)
      ? payload.post : 'default';
    s.updated_at = (payload && payload.updated_at) ? String(payload.updated_at) : '';
    return s;
  }

  /* ============ Convert between local style format and core style format ============ */

  function localToCoreStyle(local) {
    return {
      theme: local.theme || 'default',
      chat_bubble_style: local.bubble || 'default',
      post_card_style: local.post || 'default',
      updated_at: local.updated_at || ''
    };
  }

  function coreToLocalStyle(core) {
    return {
      theme: core.theme || 'default',
      bubble: core.chat_bubble_style || 'default',
      post: core.post_card_style || 'default',
      updated_at: core.updated_at || ''
    };
  }

  /* ============ UI / State helpers ============ */

  /**
   * setProStyleValue(type, value) — 设置单项装扮值并更新 UI。
   * type: 'theme' | 'bubble' | 'post'
   * value: 对应有效值
   */
  window.setProStyleValue = function(type, value) {
    var curUser = window.currentUser || '';
    if (!curUser) return;

    // 代理到 core 已有的 setProStyleSelectValue
    if (typeof window.setProStyleSelectValue === 'function') {
      window.setProStyleSelectValue(type, value);
    }

    // 写本地存储
    var local = readLocalStyle(curUser) || {};
    if (type === 'theme') local.theme = value;
    else if (type === 'bubble') local.bubble = value;
    else if (type === 'post') local.post = value;
    local.updated_at = new Date().toISOString();
    writeLocalStyle(curUser, local);

    // 触发 UI 刷新
    window.refreshProStyleUI();
  };

  /**
   * refreshProStyleUI() — 刷新所有 Pro 样式相关 UI。
   * 同步 dataset、预览卡片高亮、Pro 装扮入口状态。
   */
  window.refreshProStyleUI = function() {
    // 确保当前核心样式已应用
    if (typeof window.__xtjApplyCurrentUserStyle === 'function') {
      try { window.__xtjApplyCurrentUserStyle(); } catch(e) {}
    }
    // 刷新预览卡片高亮状态
    if (typeof window.updateProStylePreviewActiveStates === 'function') {
      try { window.updateProStylePreviewActiveStates(); } catch(e) {}
    }
    // 刷新入口状态（已解锁 X 项）
    if (typeof window.updateProStyleEntry === 'function') {
      try { window.updateProStyleEntry(); } catch(e) {}
    }
    // 更新 VIP UI
    if (typeof window.ensureVipStatusFresh === 'function') {
      try { window.ensureVipStatusFresh(false); } catch(e) {}
    }
  };

  /* ============ 覆盖 / 扩展核心函数 ============ */

  /**
   * loadCurrentUserStyle — 优先从 localStorage (xtj_pro_style_<userName>) 读取，
   * 再回退到 Supabase，确保离线也有视觉偏好。
   */
  if (typeof window.loadCurrentUserStyle !== 'function') {
    window.loadCurrentUserStyle = async function() {
      var curUser = window.currentUser || '';
      if (!curUser) {
        if (typeof window.__xtjApplyCurrentUserStyle === 'function') {
          window.__xtjApplyCurrentUserStyle();
        }
        return;
      }

      // 1. 从 localStorage 读取
      var local = readLocalStyle(curUser);
      if (local) {
        if (typeof window.applyCurrentUserCoreStyle === 'function') {
          try { window.applyCurrentUserCoreStyle(localToCoreStyle(local)); } catch(e) {}
        } else {
          // 回退：手动设置 dataset
          document.documentElement.setAttribute('data-pro-theme', local.theme);
          document.documentElement.setAttribute('data-pro-chat-bubble', local.bubble);
          document.documentElement.setAttribute('data-pro-post-style', local.post);
        }
      }

      if (typeof window.__xtjApplyCurrentUserStyle === 'function') {
        try { window.__xtjApplyCurrentUserStyle(); } catch(e) {}
      }
    };
  }

  /**
   * saveCurrentUserStyle — 保存到 localStorage（xtj_pro_style_<userName>）+
   * 如果核心 saveCurrentUserStyle 存在，也调用它（保存到 Supabase）。
   */
  var _origSaveCurrentUserStyle = window.saveCurrentUserStyle;
  window.saveCurrentUserStyle = async function() {
    var curUser = window.currentUser || '';
    if (!curUser) { return; }

    // 读取当前 UI 控制值
    var themeSelect = document.getElementById('proThemeSelect');
    var bubbleSelect = document.getElementById('proBubbleSelect');
    var postSelect = document.getElementById('proPostStyleSelect');

    var localStyle = {
      theme: themeSelect ? themeSelect.value : 'default',
      bubble: bubbleSelect ? bubbleSelect.value : 'default',
      post: postSelect ? postSelect.value : 'default',
      updated_at: new Date().toISOString()
    };
    localStyle = normalizeLocalStyle(localStyle);

    // 写入本地存储
    writeLocalStyle(curUser, localStyle);

    // 同步到 core 的 currentUserStylePreview
    if (typeof window.setProStyleSelectValue === 'function') {
      window.setProStyleSelectValue('theme', localStyle.theme);
      window.setProStyleSelectValue('bubble', localStyle.bubble);
      window.setProStyleSelectValue('post', localStyle.post);
    }

    // 调用原来的 saveCurrentUserStyle（保存到 Supabase）
    if (typeof _origSaveCurrentUserStyle === 'function') {
      return await _origSaveCurrentUserStyle();
    } else {
      try { showToast('视觉偏好已保存'); } catch(e) {}
    }

    window.refreshProStyleUI();
  };

  /**
   * openProStylePage — 如果已存在则拓展，否则新建。
   * 打开 Pro 装扮页面时同步本地样式到 UI 控件。
   */
  var _origOpenProStylePage = window.openProStylePage;
  window.openProStylePage = function() {
    var curUser = window.currentUser || '';
    if (!curUser) {
      if (typeof showToast === 'function') {
        showToast('请先登录');
      }
      return;
    }

    // 从本地存储恢复装扮值到 UI
    var local = readLocalStyle(curUser);
    if (local) {
      var themeSelect = document.getElementById('proThemeSelect');
      var bubbleSelect = document.getElementById('proBubbleSelect');
      var postSelect = document.getElementById('proPostStyleSelect');
      if (themeSelect) themeSelect.value = local.theme;
      if (bubbleSelect) bubbleSelect.value = local.bubble;
      if (postSelect) postSelect.value = local.post;
      // 同步到 core 的预览
      if (typeof window.setProStyleSelectValue === 'function') {
        window.setProStyleSelectValue('theme', local.theme);
        window.setProStyleSelectValue('bubble', local.bubble);
        window.setProStyleSelectValue('post', local.post);
      }
    }

    // 调用原有的 openProStylePage
    if (typeof _origOpenProStylePage === 'function') {
      _origOpenProStylePage();
    } else {
      // fallback: manual open
      var main = document.getElementById('profileMainView');
      var page = document.getElementById('profileProStylePage');
      var panel = document.getElementById('panelProfile');
      if (main) main.hidden = true;
      if (page) {
        page.hidden = false;
        page.classList.add('active');
      }
      if (panel && typeof panel.scrollTo === 'function') {
        panel.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }

    window.refreshProStyleUI();
  };

  /**
   * closeProStylePage — 关闭时确保样式的持久化已完成。
   */
  var _origCloseProStylePage = window.closeProStylePage;
  window.closeProStylePage = function() {
    // 调用原有逻辑
    if (typeof _origCloseProStylePage === 'function') {
      _origCloseProStylePage();
    } else {
      var main = document.getElementById('profileMainView');
      var page = document.getElementById('profileProStylePage');
      if (page) {
        page.classList.remove('active');
        page.hidden = true;
      }
      if (main) main.hidden = false;
    }
  };

  /* ============ 页面加载时同步 ============ */

  function initProStyle() {
    var curUser = window.currentUser || '';
    if (!curUser) {
      // 未登录：重置为默认
      document.documentElement.setAttribute('data-pro-theme', 'default');
      document.documentElement.setAttribute('data-pro-chat-bubble', 'default');
      document.documentElement.setAttribute('data-pro-post-style', 'default');
      return;
    }

    // 已登录：从 localStorage 恢复
    var local = readLocalStyle(curUser);
    if (local) {
      document.documentElement.setAttribute('data-pro-theme', local.theme);
      document.documentElement.setAttribute('data-pro-chat-bubble', local.bubble);
      document.documentElement.setAttribute('data-pro-post-style', local.post);
    }
  }

  // 页面加载时执行（可能 core 还在初始化，延迟到 DOM ready 再执行一次）
  initProStyle();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      // DOM ready 后再次尝试同步
      setTimeout(initProStyle, 100);
    });
  } else {
    setTimeout(initProStyle, 100);
  }

  // 导出 updateProStyle 供外部调用（如登录/登出后同步）
  window.updateProStyle = function(userName) {
    var curUser = String(userName || window.currentUser || '').trim();
    if (!curUser) {
      document.documentElement.setAttribute('data-pro-theme', 'default');
      document.documentElement.setAttribute('data-pro-chat-bubble', 'default');
      document.documentElement.setAttribute('data-pro-post-style', 'default');
      return;
    }
    var local = readLocalStyle(curUser);
    if (local) {
      document.documentElement.setAttribute('data-pro-theme', local.theme);
      document.documentElement.setAttribute('data-pro-chat-bubble', local.bubble);
      document.documentElement.setAttribute('data-pro-post-style', local.post);
    }
  };

  // console.log('[ProStyle] pro-style.js loaded');
})();
