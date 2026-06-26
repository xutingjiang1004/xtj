/* ============================================================
   XTJ Pro 装扮 — 分类面板切换薄模块
   只负责 Landing <-> 子面板（theme/bubble/post）的显隐切换。
   核心逻辑（预览卡点击、select 同步、保存、加载、应用、权益校验）
   全部由 js/core.js 承担，本文件不做覆盖。
   ============================================================ */
(function() {
  'use strict';
  if (window.__xtjProStylePageLoaded) return;
  window.__xtjProStylePageLoaded = true;

  var SUB_PANEL_IDS = ['proStylePanelTheme', 'proStylePanelBubble', 'proStylePanelPost'];

  function hideAllSubPanels() {
    SUB_PANEL_IDS.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.hidden = true;
    });
  }

  function getActionsEl() {
    return document.getElementById('proStylePanelActions');
  }

  function getLandingEl() {
    return document.getElementById('proStylePanelLanding');
  }

  window.showProStyleCategory = window.showProStyleCategory || function(category) {
    var landing = getLandingEl();
    var actions = getActionsEl();
    var targetId = null;
    if (category === 'theme') targetId = 'proStylePanelTheme';
    else if (category === 'bubble') targetId = 'proStylePanelBubble';
    else if (category === 'post') targetId = 'proStylePanelPost';
    if (!targetId) return;
    var target = document.getElementById(targetId);
    if (!target) return;
    if (landing) landing.hidden = true;
    // 进入子面板 → 显示保存按钮（每个子面板的修改都需要保存按钮）
    if (actions) actions.hidden = false;
    hideAllSubPanels();
    target.hidden = false;
    if (typeof window.updateProStylePreviewActiveStates === 'function') {
      try { window.updateProStylePreviewActiveStates(); } catch (_) {}
    }
    var page = document.getElementById('profileProStylePage');
    if (page && typeof page.scrollTo === 'function') {
      page.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  window.showProStyleLanding = window.showProStyleLanding || function() {
    var landing = getLandingEl();
    var actions = getActionsEl();
    hideAllSubPanels();
    if (landing) landing.hidden = false;
    // 总览页 → 隐藏保存按钮（避免遮挡 3 个分类入口卡片）
    if (actions) actions.hidden = true;
  };

  function init() {
    // 初始状态：全部隐藏；具体显示由 core.js 的 renderProStyleSettings() 在 openProStylePage 时控制
    hideAllSubPanels();
    var landing = getLandingEl();
    var actions = getActionsEl();
    if (landing) landing.hidden = true;
    if (actions) actions.hidden = true;
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
