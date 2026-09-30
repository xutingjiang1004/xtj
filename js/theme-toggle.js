(function () {
  'use strict';

  if (window.__xtjThemeToggleBound) return;
  window.__xtjThemeToggleBound = true;
  window.__xtjThemeControllerV2 = true;

  var STORAGE_KEY = 'xtj_theme';
  var LEGACY_STORAGE_KEY = 'xtj-theme';
  var htmlEl = document.documentElement;
  var themeBtn, profileThemeToggle, desktopThemeMode, systemThemeQuery;
  var gesture = null;
  var dragFrame = 0;
  var suppressPointerClick = false;

  function getSystemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function resolveThemeMode() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
      var legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy === 'dark' || legacy === 'light') {
        localStorage.setItem(STORAGE_KEY, legacy);
        return legacy;
      }
    } catch (_) {}
    var mode = htmlEl.getAttribute('data-theme-mode');
    return mode === 'dark' || mode === 'light' || mode === 'system' ? mode : 'system';
  }

  function resolveTheme(mode) {
    return mode === 'system' ? getSystemTheme() : (mode === 'dark' ? 'dark' : 'light');
  }

  function persistTheme(mode) {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (_) {}
  }

  function syncControls(theme, mode) {
    var isDark = theme === 'dark';
    if (themeBtn) {
      themeBtn.classList.toggle('is-dark', isDark);
      themeBtn.style.setProperty('--theme-progress', isDark ? '1' : '0');
      themeBtn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      themeBtn.setAttribute('aria-label', isDark ? '切换浅色模式，可左右拖动' : '切换深色模式，可左右拖动');
      themeBtn.setAttribute('title', isDark ? '切换浅色模式' : '切换深色模式');
    }
    if (profileThemeToggle) {
      profileThemeToggle.checked = isDark;
      profileThemeToggle.setAttribute('aria-checked', isDark ? 'true' : 'false');
    }
    if (desktopThemeMode) desktopThemeMode.value = mode;
  }

  function applyThemeMode(mode) {
    htmlEl.setAttribute('data-theme-mode', mode);
    htmlEl.setAttribute('data-theme', resolveTheme(mode));
    syncControls(resolveTheme(mode), mode);
  }

  function clearThemeSwitching() {
    htmlEl.classList.remove('theme-switching', 'theme-crossfade');
  }

  function motionEnabled() {
    return htmlEl.getAttribute('data-xtj-motion') !== 'off' &&
      !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Safari may suspend rAF after a viewport/cache restoration. One guarded
  // timer keeps completion/cancellation reliable until normal frame delivery resumes.
  function requestPaintFrame(callback) {
    var done=false, frame={raf:0,timer:0};
    function run() {
      if (done) return;
      done=true; cancelPaintFrame(frame); callback(performance.now());
    }
    frame.raf=requestAnimationFrame(run); frame.timer=setTimeout(run,40);
    return frame;
  }
  function cancelPaintFrame(frame) {
    if (!frame) return;
    cancelAnimationFrame(frame.raf); clearTimeout(frame.timer);
  }

  // Read both palettes in batches. Never interleave a selector-affecting write
  // with a computed-style read: that used to force a full style pass per node.
  var palette = null, paletteFrame = 0, paletteCleanupFrame = 0, currentProgress = null;
  var localProgress = false;
  try {
    // Non-inherited values keep each frame from invalidating the entire app,
    // including inactive panels and thousands of off-screen descendants.
    CSS.registerProperty({name:'--xtj-theme-paint-progress',syntax:'<number>',inherits:false,initialValue:'0'});
    localProgress = typeof document.body.animate === 'function';
  } catch (_) {}
  var paintProperties = ['color','background-color','background-image','border-top-color',
    'border-right-color','border-bottom-color','border-left-color','box-shadow','fill','stroke'];
  function readPaint(node, pseudo) {
    var style = getComputedStyle(node, pseudo), values = {};
    paintProperties.forEach(function(key) {
      // A border's computed color changes with text even when no border exists.
      // Such invisible edges used to add paint rules to almost every child.
      var edge=key.match(/^border-(top|right|bottom|left)-color$/);
      values[key]=edge && (style.getPropertyValue('border-'+edge[1]+'-style')==='none' ||
        parseFloat(style.getPropertyValue('border-'+edge[1]+'-width'))===0)
        ? 'transparent' : style.getPropertyValue(key);
    });
    return values;
  }
  function mixColor(a, b) {
    return 'color-mix(in srgb,' + a + ' calc((1 - var(' +
      (localProgress ? '--xtj-theme-paint-progress' : '--xtj-theme-darkness') + '))*100%),' + b + ')';
  }
  function mixPaint(a, b, property) {
    if (a === b) return null;
    var colors = /(?:rgba?|color)\([^)]*\)/g;
    if (property === 'background-image' || property === 'box-shadow') {
      if (/url\(/.test(a+b)) return null;
      var left=a.match(colors)||[],right=b.match(colors)||[];
      if (!left.length && !right.length) return null;
      if (left.length === right.length && a.replace(colors,'@') === b.replace(colors,'@')) {
        var index=0;
        return a.replace(colors,function(color){ return mixColor(color,right[index++]); });
      }
      // Fade each endpoint's own layers, retaining its exact stops, geometry and
      // transparency. This also avoids a final-frame gradient/shadow jump.
      var layers=[];
      if (right.length) layers.push(b.replace(colors,function(color){return mixColor('transparent',color);}));
      if (left.length) layers.push(a.replace(colors,function(color){return mixColor(color,'transparent');}));
      return layers.join(',');
    }
    if (!/^(?:rgba?|color)\(/.test(a) || !/^(?:rgba?|color)\(/.test(b)) return null;
    return mixColor(a,b);
  }
  function stopPaletteAnimation() {
    if (paletteFrame) cancelPaintFrame(paletteFrame);
    paletteFrame = 0;
  }
  function clearPalette() {
    stopPaletteAnimation();
    if (palette) {
      clearTimeout(palette.captureDeadline);
      if (palette.composited) {
        applyThemeMode(palette.finalMode || resolveThemeMode());
        palette.transition.skipTransition();
        if (themeBtn) themeBtn.querySelector('.theme-toggle-orb').style.removeProperty('view-transition-name');
        htmlEl.classList.remove('theme-composited');
      } else { palette.style.remove(); if (palette.background) palette.background.remove(); }
      palette.animations.forEach(function(animation){ animation.cancel(); });
      palette.nodes.forEach(function(node) { node.removeAttribute('data-xtj-theme-paint'); });
    }
    palette = null; currentProgress = null;
    htmlEl.style.removeProperty('--xtj-theme-darkness');
    // Flush the final palette while old component transitions remain frozen.
    // Otherwise removing the temporary rules starts a second CSS animation.
    getComputedStyle(document.body).backgroundColor;
    if (paletteCleanupFrame) cancelPaintFrame(paletteCleanupFrame);
    paletteCleanupFrame=requestPaintFrame(function() { paletteCleanupFrame=0; if (!palette) clearThemeSwitching(); });
  }
  function preparePalette(forceLive) {
    if (paletteCleanupFrame) cancelPaintFrame(paletteCleanupFrame);
    paletteCleanupFrame=0;
    if (palette) return;
    htmlEl.classList.add('theme-switching');
    var original = htmlEl.getAttribute('data-theme');
    if (!forceLive && motionEnabled() && typeof document.startViewTransition === 'function') {
      var origin = original === 'dark' ? 1 : 0;
      var capture = {composited:true,ready:false,origin:origin,nodes:[],animations:[],finalMode:resolveThemeMode()};
      palette=capture; currentProgress=origin;
      htmlEl.classList.add('theme-composited');
      if (themeBtn) themeBtn.querySelector('.theme-toggle-orb').style.viewTransitionName='xtj-theme-orb';
      capture.transition=document.startViewTransition(function(){
        if (palette!==capture) return;
        htmlEl.setAttribute('data-theme',origin ? 'light' : 'dark');
        syncControls(origin ? 'light' : 'dark',resolveThemeMode());
      });
      capture.transition.ready.then(function(){
        if (palette!==capture) return;
        clearTimeout(capture.captureDeadline);
        capture.animations=document.getAnimations().filter(function(animation){
          return animation.effect && animation.effect.pseudoElement &&
            animation.effect.pseudoElement.indexOf('::view-transition')===0;
        });
        capture.animations.forEach(function(animation){
          if (animation.effect.pseudoElement.indexOf('::view-transition-group(')===0) {
            // Keep translation on the compositor; interpolating identical
            // width/height values would still lay out snapshot layers each frame.
            animation.effect.setKeyframes(animation.effect.getKeyframes().map(function(frame){
              return {offset:frame.offset,easing:frame.easing,transform:frame.transform};
            }));
          }
          animation.pause();
        });
        capture.ready=true; paintProgress(currentProgress);
        if (capture.whenReady) { var run=capture.whenReady;capture.whenReady=null;run(); }
      }).catch(fallbackCapture);
      // Slow/partially supported snapshot capture must not freeze a held
      // slider. Continue from the exact finger position using the live palette.
      function fallbackCapture(){
        if (palette!==capture || capture.ready) return;
        clearTimeout(capture.captureDeadline);
        var progress=currentProgress, resume=capture.whenReady, mode=capture.finalMode;
        capture.transition.skipTransition();
        capture.animations.forEach(function(animation){animation.cancel();});
        htmlEl.classList.remove('theme-composited');
        if (themeBtn) themeBtn.querySelector('.theme-toggle-orb').style.removeProperty('view-transition-name');
        palette=null; currentProgress=null;
        if (!motionEnabled()) { applyThemeMode(mode); clearThemeSwitching(); if (resume) resume(); return; }
        htmlEl.setAttribute('data-theme',original);
        preparePalette(true); applyThemeMode(mode); paintProgress(progress);
        if (resume) resume();
      }
      capture.captureDeadline=setTimeout(fallbackCapture,350);
      return;
    }
    var nodes = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function(node) {
        // Prune entire inactive panels, modals, media and the unchanged Dock.
        if (node.matches('#dockBar,#themeToggle,script,style,svg,img,video,audio,[hidden],[aria-hidden="true"],.dock-panel:not(.active)') ||
            node.getClientRects().length === 0) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    nodes.push(document.body);
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes = nodes.filter(function(node) {
      var rect = node.getBoundingClientRect();
      return rect.width && rect.height && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    });
    var entries = [];
    htmlEl.setAttribute('data-theme','light');
    nodes.forEach(function(node,index) {
      [null,'::before','::after'].forEach(function(pseudo) {
        if (pseudo) { var s=getComputedStyle(node,pseudo); if (s.content==='none' || s.content==='normal' || s.display==='none') return; }
        entries.push({node:node,index:index,pseudo:pseudo,light:readPaint(node,pseudo)});
      });
    });
    htmlEl.setAttribute('data-theme','dark');
    var paints = new Map();
    var owners = new Set();
    // Put the page background on a leaf layer. A custom-property animation on
    // body would still force descendants to recalculate inherited styles.
    var background=document.createElement('div');
    background.setAttribute('aria-hidden','true');
    background.style.cssText='position:fixed;inset:0;z-index:-1;pointer-events:none;contain:strict';
    var targets=new Map();
    var rules = entries.map(function(entry) {
      var dark=readPaint(entry.node,entry.pseudo), declarations=[], colorAnimated=false;
      var parent = paints.get(entry.node.parentElement);
      var paintsText=entry.pseudo || entry.node.matches('input,textarea,select,button') ||
        Array.from(entry.node.childNodes).some(function(child){
          return child.nodeType===Node.TEXT_NODE && child.textContent.trim() ||
            child.nodeType===Node.ELEMENT_NODE && child.tagName.toLowerCase()==='svg';
        });
      paintProperties.forEach(function(key) {
        // Tween actual visible text owners. Animating inherited body/panel
        // text color would invalidate every off-screen and inactive descendant.
        if (key==='color' && !paintsText) return;
        // Inherited text needs one rule on its owner, rather than a rule on
        // every nested span. Unchanged properties never join the paint sheet.
        if (key === 'color' && !entry.pseudo && parent && parent.colorAnimated &&
            entry.light.color === parent.light.color && dark.color === parent.dark.color) return;
        var mixed=mixPaint(entry.light[key],dark[key],key);
        if (mixed) { declarations.push(key+':'+mixed+'!important'); if (key==='color') colorAnimated=true; }
      });
      if (!entry.pseudo) paints.set(entry.node,{light:entry.light,dark:dark,colorAnimated:colorAnimated});
      var paintIndex=entry.node===document.body && !entry.pseudo ? nodes.length : entry.index;
      if (declarations.length) {
        var owner=entry.node===document.body && !entry.pseudo ? background : entry.node;
        owners.add(owner); targets.set(owner,paintIndex);
        if (localProgress && entry.pseudo) declarations.push('--xtj-theme-paint-progress:inherit');
      }
      return declarations.length ? '[data-xtj-theme-paint="'+paintIndex+'"]'+(entry.pseudo||'')+'{'+declarations.join(';')+'}' : '';
    });
    htmlEl.setAttribute('data-theme',original);
    targets.forEach(function(index,node){node.setAttribute('data-xtj-theme-paint',String(index));});
    if (owners.has(background)) document.body.prepend(background);
    var style=document.createElement('style'); style.id='xtjThemePaint';
    style.textContent='@layer xtj-theme-paint {'+
      (owners.has(background) ? 'body{background-color:transparent!important;background-image:none!important;}' : '')+
      rules.join('\n')+'}';
    document.head.appendChild(style);
    var animations = [];
    if (localProgress) owners.forEach(function(node){
      var animation = node.animate([{'--xtj-theme-paint-progress':'0'},{'--xtj-theme-paint-progress':'1'}],
        {duration:1000,fill:'both'});
      animation.pause(); animations.push(animation);
    });
    palette={style:style,background:background,nodes:Array.from(owners),animations:animations};
    paintProgress(resolveTheme(resolveThemeMode())==='dark' ? 1 : 0);
  }
  function paintProgress(progress) {
    currentProgress=progress;
    if (palette && (!palette.composited || palette.ready)) palette.animations.forEach(function(animation){
      animation.currentTime=(palette.composited && palette.origin ? 1-progress : progress)*1000;
    });
    // Updating even a non-inherited property on html changes its style attribute
    // and invalidates the full selector tree. Keep modern clocks on their local
    // animation owners; only engines without property registration need this.
    if (!localProgress && palette && !palette.composited)
      htmlEl.style.setProperty('--xtj-theme-darkness',String(progress));
    // Endpoint snapshots need the orb at each endpoint during capture. Its
    // separate composited group then follows the same scrubbed clock as the page.
    if (themeBtn && !(palette && palette.composited && !palette.ready)) themeBtn.style.setProperty('--theme-progress',String(progress));
  }
  function animatePalette(target, finish) {
    stopPaletteAnimation();
    if (palette && palette.composited && !palette.ready) {
      palette.whenReady=function(){animatePalette(target,finish);}; return;
    }
    var from=currentProgress == null ? target : currentProgress;
    if (!motionEnabled() || Math.abs(from-target)<.001) { paintProgress(target); finish(); return; }
    var last=0, elapsed=0, duration=300;
    function frame(now) {
      // A long first paint must not skip every intermediate animation frame.
      if (last) elapsed+=Math.min(50,Math.max(0,now-last));
      last=now;
      var t=Math.min(1,elapsed/duration), ease=1-Math.pow(1-t,3);
      paintProgress(from+(target-from)*ease);
      if (t<1) paletteFrame=requestPaintFrame(frame);
      else { paletteFrame=0; finish(); }
    }
    paletteFrame=requestPaintFrame(frame);
  }
  function setThemeMode(mode) {
    var next=mode==='dark'||mode==='light' ? mode : 'system';
    var previous=resolveTheme(resolveThemeMode()), target=resolveTheme(next)==='dark' ? 1 : 0;
    if ((previous!==resolveTheme(next) && motionEnabled()) || palette) preparePalette();
    persistTheme(next);
    if (palette && palette.composited) {
      palette.finalMode=next;
      htmlEl.setAttribute('data-theme-mode',next);
      if (palette.ready) applyThemeMode(next);
    } else applyThemeMode(next);
    if (!palette) return;
    // applyThemeMode synchronizes controls; immediately restore their live position.
    paintProgress(currentProgress);
    animatePalette(target,function() { clearPalette(); applyThemeMode(next); });
  }

  function switchTheme() {
    setThemeMode(resolveTheme(resolveThemeMode()) === 'dark' ? 'light' : 'dark');
  }

  function renderDrag() {
    dragFrame = 0;
    if (gesture && themeBtn) {
      if (motionEnabled()) { preparePalette(); paintProgress(gesture.progress); }
      else themeBtn.style.setProperty('--theme-progress',String(gesture.progress));
    }
  }

  function resetGesture() {
    if (dragFrame) cancelPaintFrame(dragFrame);
    dragFrame = 0;
    var old = gesture;
    gesture = null;
    themeBtn.classList.remove('is-dragging');
    if (old && themeBtn.hasPointerCapture(old.id)) themeBtn.releasePointerCapture(old.id);
    return old;
  }

  function finishGesture(event, cancelled) {
    if (!gesture || (event && event.pointerId !== gesture.id)) return;
    var old = resetGesture();
    suppressPointerClick = old.dragged || cancelled;
    if (cancelled || !old.dragged) {
      if (palette) animatePalette(old.original, function() { clearPalette(); applyThemeMode(resolveThemeMode()); });
      else syncControls(resolveTheme(resolveThemeMode()), resolveThemeMode());
      return;
    }
    if (motionEnabled() || palette) { preparePalette(); paintProgress(old.progress); }
    setThemeMode(old.progress >= 0.5 ? 'dark' : 'light');
  }

  function bindThemeToggle() {
    themeBtn = document.getElementById('themeToggle');
    profileThemeToggle = document.getElementById('profileThemeToggle');
    desktopThemeMode = document.getElementById('desktopThemeMode');
    if (themeBtn) {
      themeBtn.addEventListener('click', function (event) {
        event.preventDefault();
        if (suppressPointerClick && event.detail !== 0) {
          suppressPointerClick = false;
          return;
        }
        suppressPointerClick = false;
        switchTheme();
      });
      themeBtn.addEventListener('pointerdown', function (event) {
        if (gesture || !event.isPrimary || event.button !== 0) return;
        suppressPointerClick = false;
        stopPaletteAnimation();
        var orb = themeBtn.querySelector('.theme-toggle-orb');
        var box = themeBtn.getBoundingClientRect();
        var style = window.getComputedStyle(themeBtn);
        var travel = box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) -
          parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth) - orb.offsetWidth;
        themeBtn.style.setProperty('--theme-travel', Math.max(1, travel) + 'px');
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY,
          original: resolveTheme(resolveThemeMode()) === 'dark' ? 1 : 0,
          start: currentProgress == null ? (resolveTheme(resolveThemeMode()) === 'dark' ? 1 : 0) : currentProgress,
          progress: currentProgress == null ? (resolveTheme(resolveThemeMode()) === 'dark' ? 1 : 0) : currentProgress,
          travel: Math.max(1, travel), dragged: false };
        themeBtn.setPointerCapture(event.pointerId);
        // Begin native capture at contact, before the first horizontal move.
        if (motionEnabled() && typeof document.startViewTransition==='function') preparePalette();
      });
      themeBtn.addEventListener('pointermove', function (event) {
        if (!gesture || event.pointerId !== gesture.id) return;
        var dx = event.clientX - gesture.x;
        var dy = event.clientY - gesture.y;
        if (!gesture.dragged && Math.abs(dy) > 6 && Math.abs(dy) > Math.abs(dx)) {
          finishGesture(event, true);
          return;
        }
        if (!gesture.dragged && Math.abs(dx) < 3) return;
        gesture.dragged = true;
        themeBtn.classList.add('is-dragging');
        gesture.progress = Math.max(0, Math.min(1, gesture.start + dx / gesture.travel));
        if (!dragFrame) dragFrame = requestPaintFrame(renderDrag);
      });
      themeBtn.addEventListener('pointerup', function (event) { finishGesture(event, false); });
      themeBtn.addEventListener('pointercancel', function (event) { finishGesture(event, true); });
      themeBtn.addEventListener('lostpointercapture', function (event) { finishGesture(event, true); });
      themeBtn.addEventListener('keydown', function (event) {
        if (!/^(ArrowLeft|ArrowRight|Home|End)$/.test(event.key)) return;
        event.preventDefault();
        if (gesture) finishGesture(null, true);
        setThemeMode(event.key === 'ArrowRight' || event.key === 'End' ? 'dark' : 'light');
      });
    }
    if (profileThemeToggle) profileThemeToggle.addEventListener('change', function () {
      setThemeMode(this.checked ? 'dark' : 'light');
    });
    if (desktopThemeMode) desktopThemeMode.addEventListener('change', function () { setThemeMode(this.value); });
  }

  function initThemeController() {
    bindThemeToggle();
    applyThemeMode(resolveThemeMode());
    try {
      systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      var change = function () {
        if (resolveThemeMode() === 'system') setThemeMode('system');
      };
      if (systemThemeQuery.addEventListener) systemThemeQuery.addEventListener('change', change);
      else if (systemThemeQuery.addListener) systemThemeQuery.addListener(change);
    } catch (_) {}
    window.addEventListener('pagehide', function () {
      if (gesture) finishGesture(null, true);
      applyThemeMode(resolveThemeMode());
      clearPalette();
      if (paletteCleanupFrame) cancelPaintFrame(paletteCleanupFrame);
      paletteCleanupFrame=0; clearThemeSwitching();
    });
  }

  window.XTJThemeController = {
    setMode: setThemeMode,
    getMode: resolveThemeMode,
    getProgress: function(){ return currentProgress == null ? (resolveTheme(resolveThemeMode())==='dark' ? 1 : 0) : currentProgress; },
    getResolvedTheme: function () { return resolveTheme(resolveThemeMode()); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initThemeController, { once: true });
  else initThemeController();
})();
