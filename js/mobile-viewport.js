(function(){
  'use strict';
  var frozenMedia = new Map(), desktopLink = null, originalLinkMedia = '';
  var touchHardware = Number(navigator.maxTouchPoints || 0) > 0;
  window.__xtjTouchViewportDevice = /iPad|iPhone|iPod|Android/.test(navigator.userAgent + ' ' + navigator.platform) || (touchHardware && /Mac/.test(navigator.platform));
  window.__xtjViewportBootHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  var device = navigator.userAgent + ' ' + navigator.platform;
  var tablet = /iPad/.test(device) || (touchHardware && /Mac/.test(navigator.platform)) ||
    (!/iPhone|iPod/.test(device) && window.__xtjTouchViewportDevice && Math.min(screen.width, screen.height) >= 600);
  function restoreTabletLayout() {
    frozenMedia.forEach(function(media,rule){ rule.media.mediaText = media; }); frozenMedia.clear();
    if (desktopLink) desktopLink.media = originalLinkMedia;
    desktopLink = null; document.documentElement.classList.remove('xtj-tablet-layout');
  }
  function freezeRules(rules) {
    Array.from(rules || []).forEach(function(rule){
      if (rule.media && /min-height:\s*480px/.test(rule.media.mediaText)) {
        if (!frozenMedia.has(rule)) frozenMedia.set(rule,rule.media.mediaText);
        rule.media.mediaText = rule.media.mediaText.replace(/\s*and\s*\(min-height:\s*480px\)/g,'');
      }
      if (rule.cssRules) freezeRules(rule.cssRules);
    });
  }
  function syncTabletLayout() {
    if (!tablet || window.innerWidth < 768) { restoreTabletLayout(); return; }
    // Device width owns tablet navigation. Keyboard height and focus events
    // cannot switch it to the phone shell, including a reload with keyboard open.
    document.documentElement.classList.add('xtj-tablet-layout');
    if (!desktopLink) {
      desktopLink = document.querySelector('link[href*="desktop.min.css"]');
      if (desktopLink) { originalLinkMedia = desktopLink.media; desktopLink.media = '(min-width:768px)'; }
    }
    Array.from(document.styleSheets).forEach(function(sheet){try{freezeRules(sheet.cssRules);}catch(_){} });
  }
  // Capturing load also covers stylesheets mounted by a lazy module.
  document.addEventListener('load',function(event){if(event.target.matches && event.target.matches('link[rel="stylesheet"]')) syncTabletLayout();},true);
  window.addEventListener('resize',syncTabletLayout);
  window.addEventListener('pageshow',syncTabletLayout);
  syncTabletLayout();
  // Page magnification remains a browser accessibility gesture. Photo viewers
  // own their image gestures through their existing scoped handlers.
})();
