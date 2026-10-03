(function(){
  'use strict';
  var frozenMedia = [], desktopLink = null, originalLinkMedia = '', restoreTimer;
  var touchHardware = Number(navigator.maxTouchPoints || 0) > 0;
  window.__xtjTouchViewportDevice = /iPad|iPhone|iPod|Android/.test(navigator.userAgent + ' ' + navigator.platform) || (touchHardware && /Mac/.test(navigator.platform));
  window.__xtjViewportBootHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  function editable(node) { return node && node.matches && node.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),textarea,select,[contenteditable="true"]'); }
  function restoreTabletLayout() {
    frozenMedia.forEach(function(item){ item.rule.media.mediaText = item.media; }); frozenMedia = [];
    if (desktopLink) desktopLink.media = originalLinkMedia;
    desktopLink = null; document.documentElement.classList.remove('xtj-tablet-keyboard');
  }
  function freezeRules(rules) {
    Array.from(rules || []).forEach(function(rule){
      if (rule.media && /min-height:\s*480px/.test(rule.media.mediaText)) {
        frozenMedia.push({rule:rule,media:rule.media.mediaText});
        rule.media.mediaText = rule.media.mediaText.replace(/\s*and\s*\(min-height:\s*480px\)/g,'');
      }
      if (rule.cssRules) freezeRules(rule.cssRules);
    });
  }
  document.addEventListener('focusin', function(event){
    clearTimeout(restoreTimer);
    if (!editable(event.target) || desktopLink || !matchMedia('(min-width:768px) and (min-height:480px)').matches || !(touchHardware || window.__xtjTouchViewportDevice || matchMedia('(pointer:coarse)').matches)) return;
    desktopLink = document.querySelector('link[href*="desktop.min.css"]');
    if (!desktopLink) return;
    originalLinkMedia = desktopLink.media; desktopLink.media = '(min-width:768px)';
    document.documentElement.classList.add('xtj-tablet-keyboard');
    Array.from(document.styleSheets).forEach(function(sheet){try{freezeRules(sheet.cssRules);}catch(_){} });
  });
  document.addEventListener('focusout', function(){ restoreTimer=setTimeout(function(){if(!editable(document.activeElement))restoreTabletLayout();},100); });
  window.addEventListener('resize',function(){if(window.innerWidth<768)restoreTabletLayout();});
  window.addEventListener('pagehide',restoreTabletLayout);
  function ownPhotoGesture(target) { return target && target.closest && target.closest('#photoPreviewOverlay.active,#imgViewer.active'); }
  document.addEventListener('gesturestart', function(event){ if (!ownPhotoGesture(event.target)) event.preventDefault(); }, {passive:false});
  document.addEventListener('gesturechange', function(event){ if (!ownPhotoGesture(event.target)) event.preventDefault(); }, {passive:false});
  document.addEventListener('touchmove', function(event){ if (event.touches && event.touches.length>1 && !ownPhotoGesture(event.target)) event.preventDefault(); }, {passive:false});
})();
