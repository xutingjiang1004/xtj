/* ============================================================
   XTJ Pro style panel animation glue
   Keeps the existing panel behavior and only layers entry/stagger
   classes without touching business logic.
   ============================================================ */
(function() {
  'use strict';

  if (window.__xtjProStylePageLoaded) return;
  window.__xtjProStylePageLoaded = true;

  var SUB_PANEL_IDS = ['proStylePanelTheme', 'proStylePanelBubble', 'proStylePanelPost'];
  var LANDING_ID = 'proStyleCategoryCards';
  var ACTIONS_ID = 'proStylePanelActions';

  function getEl(id) { return document.getElementById(id); }

  function isPerfLite() {
    return !!(document.documentElement && document.documentElement.classList.contains('perf-lite'));
  }

  function resetAnimationClass(el, className) {
    if (!el) return;
    el.classList.remove(className);
    if (isPerfLite()) {
      el.classList.add(className);
      return;
    }
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        el.classList.add(className);
      });
    });
  }

  function triggerEnter(el) {
    if (!el) return;
    el.classList.remove('is-entering', 'is-leaving');
    resetAnimationClass(el, 'is-entering');
  }

  function triggerStagger(panel) {
    if (!panel) return;
    var cards = panel.querySelectorAll('.pro-style-option-card');
    if (!cards || !cards.length || isPerfLite()) return;
    cards.forEach(function(card, idx) {
      card.classList.remove('is-stagger');
      window.setTimeout(function() {
        card.classList.add('is-stagger');
      }, 50 + idx * 40);
    });
  }

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

  function setupWrappers() {
    wrapShowCategory();
    wrapShowLanding();
  }

  function restartPreviewAnimation(card) {
    if (!card || isPerfLite()) return;
    var preview = card.querySelector('.bubble-preview, .theme-preview, .post-card-preview');
    if (!preview) return;
    var elements = [preview];
    var children = preview.querySelectorAll('*');
    for (var i = 0; i < children.length; i++) elements.push(children[i]);
    elements.forEach(function(node) {
      node.style.animation = 'none';
    });
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        elements.forEach(function(node) {
          node.style.animation = '';
        });
      });
    });
  }

  function init() {
    SUB_PANEL_IDS.forEach(function(id) {
      var node = getEl(id);
      if (node) node.hidden = true;
    });
    var landing = getEl(LANDING_ID);
    var actions = getEl(ACTIONS_ID);
    if (landing) landing.hidden = true;
    if (actions) actions.hidden = true;
  }

  setupWrappers();
  document.addEventListener('DOMContentLoaded', function() {
    setupWrappers();
    window.setTimeout(setupWrappers, 0);
    init();
  });
  window.addEventListener('load', setupWrappers);

  document.addEventListener('click', function(e) {
    var card = e.target && e.target.closest && e.target.closest('.pro-style-option-card');
    if (!card) return;
    restartPreviewAnimation(card);
  });

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  }
})();
