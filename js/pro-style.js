/* ============================================================
   XTJ Pro 装扮 — 面板切换动画增强层（薄模块）
   ------------------------------------------------------------
   职责（仅 class 控制，不接管任何业务逻辑）：
     1. 进入二级面板 → 触发 is-entering + stagger 动画
     2. 返回总览 → 触发 is-entering
     3. 修复旧版 proStylePanelLanding 引用（0.97g 已删除该 id）
   ------------------------------------------------------------
   严格禁止（不破坏既有逻辑）：
     - 不接管 saveCurrentUserStyle / updateProStylePreviewActiveStates
     - 不接管 select 同步、权益校验、加载、应用
     - 不修改 id / onclick / data-pro-style-type / data-pro-style-value
   ============================================================ */
(function() {
  'use strict';
  if (window.__xtjProStylePageLoaded) return;
  window.__xtjProStylePageLoaded = true;

  var SUB_PANEL_IDS = ['proStylePanelTheme', 'proStylePanelBubble', 'proStylePanelPost'];
  var LANDING_ID = 'proStyleCategoryCards';
  var ACTIONS_ID = 'proStylePanelActions';

  function getEl(id) { return document.getElementById(id); }

  // 触发 CSS 动画的 class：先移除再强制 reflow 再添加，让 animation 重置
  function triggerEnter(el) {
    if (!el) return;
    el.classList.remove('is-entering', 'is-leaving');
    try { void el.offsetWidth; } catch (_) {}
    el.classList.add('is-entering');
  }

  // 给子面板内的 option-card 加上 stagger 错开延迟
  function triggerStagger(panel) {
    if (!panel) return;
    var cards = panel.querySelectorAll('.pro-style-option-card');
    if (!cards || !cards.length) return;
    cards.forEach(function(card, idx) {
      card.classList.remove('is-stagger');
      try { void card.offsetWidth; } catch (_) {}
      // 每张延迟 40ms（在 CSS 中会被 translateY/opacity 淡入）
      // 50ms 起步避免与 panel 进入冲突
      window.setTimeout(function() {
        card.classList.add('is-stagger');
      }, 50 + idx * 40);
    });
  }

  // 包装原函数：在原函数执行后添加 class（不修改原函数行为）
  function wrapShowCategory() {
    var orig = window.showProStyleCategory;
    if (typeof orig !== 'function' || orig.__xtjAnimWrapped) return;
    var wrapped = function(category) {
      var ret = orig.apply(this, arguments);
      var id = category === 'theme' ? 'proStylePanelTheme'
            : category === 'bubble' ? 'proStylePanelBubble'
            : category === 'post' ? 'proStylePanelPost'
            : null;
      var target = id ? getEl(id) : null;
      if (target) {
        triggerEnter(target);
        triggerStagger(target);
      }
      return ret;
    };
    wrapped.__xtjAnimWrapped = true;
    window.showProStyleCategory = wrapped;
  }

  function wrapShowLanding() {
    var orig = window.showProStyleLanding;
    if (typeof orig !== 'function' || orig.__xtjAnimWrapped) return;
    var wrapped = function() {
      var ret = orig.apply(this, arguments);
      var landing = getEl(LANDING_ID);
      if (landing) triggerEnter(landing);
      return ret;
    };
    wrapped.__xtjAnimWrapped = true;
    window.showProStyleLanding = wrapped;
  }

  // defer scripts 中 pro-style.js 在 core.js 之前执行
  // core.js 会覆盖 window.showProStyleCategory
  // 我们在 DOMContentLoaded / load 后再包装一次，拿到 core.js 定义的版本
  function setupWrappers() {
    wrapShowCategory();
    wrapShowLanding();
  }

  // 立即尝试一次（处理 core.js 已加载的特殊情况）
  setupWrappers();
  // DOM 解析完成后：defer 脚本都已执行完，core.js 已定义真实函数
  document.addEventListener('DOMContentLoaded', function() {
    setupWrappers();
    window.setTimeout(setupWrappers, 0);
  });
  // 终极兜底：所有资源加载完
  window.addEventListener('load', function() {
    setupWrappers();
  });

  // 初始状态：隐藏所有子面板（与原版行为一致）
  function init() {
    SUB_PANEL_IDS.forEach(function(id) {
      var el = getEl(id);
      if (el) el.hidden = true;
    });
    var landing = getEl(LANDING_ID);
    var actions = getEl(ACTIONS_ID);
    if (landing) landing.hidden = true;
    if (actions) actions.hidden = true;
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
