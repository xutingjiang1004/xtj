'use strict';
(function() {
  var active = new Set();
  function permitted() {
    return typeof Element.prototype.animate === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches &&
      document.documentElement.getAttribute('data-xtj-motion') !== 'off';
  }
  function rect(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { left:r.left, top:r.top, width:r.width, height:r.height } : null;
  }
  function visible(r) { return r && r.top < innerHeight && r.top + r.height > 0 && r.left < innerWidth && r.left + r.width > 0; }
  function capture(files, text, isCurrent) {
    if (!permitted() || !isCurrent()) return null;
    var state = { items:[], ghosts:[], animations:[], restores:[], urls:new Set(), current:isCurrent, stopped:false };
    var previews = document.querySelectorAll('#postMediaPreviewGrid .post-media-preview-thumb');
    Array.from(files || []).slice(0,9).forEach(function(file,index) {
      var source = previews[index], box = rect(source);
      if (!file.type.startsWith('image/') || !visible(box)) return;
      var url = URL.createObjectURL(file); state.urls.add(url);
      state.items.push({ index:index, source:box, url:url });
    });
    var input = document.getElementById('postInp'), inputBox = rect(input);
    if (text && visible(inputBox)) {
      var style = getComputedStyle(input), left = parseFloat(style.paddingLeft) || 0, top = parseFloat(style.paddingTop) || 0;
      state.text = { text:text, source:{left:inputBox.left+left,top:inputBox.top+top,width:inputBox.width-left-(parseFloat(style.paddingRight)||0),height:Math.min(inputBox.height,parseFloat(style.lineHeight)||26)},font:style.font };
    }
    active.add(state);
    state.stop = function() {
      if (state.stopped) return; state.stopped = true;
      state.animations.forEach(function(a) { a.cancel(); });
      state.ghosts.forEach(function(g) { g.remove(); });
      state.restores.forEach(function(restore) { restore(); });
      state.urls.forEach(function(url) { URL.revokeObjectURL(url); });state.urls.clear();active.delete(state);
    };
    return state;
  }
  // Keep the same original File visible while its new Storage URL decodes.
  // The viewer/data-media-url still use the canonical server address.
  function warmOriginal(state, img, url) {
    if (img.complete && img.naturalWidth > 0) return;
    var remote = img.getAttribute('src'), loader = new Image(), restored = false, timer;
    function restore() {
      if (restored) return; restored = true;clearTimeout(timer);loader.onload=null;loader.onerror=null;
      if (img.getAttribute('src') === url) img.setAttribute('src',remote);
      state.urls.delete(url);URL.revokeObjectURL(url);
      if (!state.ghosts.length && !state.urls.size) state.stop();
    }
    state.restores.push(restore);img.src = url;
    loader.onload = function() { if (loader.decode) loader.decode().catch(function() {}).then(restore); else restore(); };
    loader.onerror = restore;timer = setTimeout(restore,60000);loader.src = remote;
  }
  async function play(state, post) {
    if (!state) return;
    if (!post || !state.current() || !permitted()) { state.stop();return; }
    post.classList.remove('is-newly-published');
    if (!visible(rect(post))) post.scrollIntoView({block:'nearest',behavior:'instant'});
    var jobs = [], targets = post.querySelectorAll('.post-media-cell img');
    function fly(item, target, ghost) {
      var destination = rect(target);
      if (!destination || !visible(destination)) { if (item.url) { state.urls.delete(item.url);URL.revokeObjectURL(item.url); } return; }
      ghost.className = 'post-publish-flight';ghost.setAttribute('aria-hidden','true');
      Object.assign(ghost.style,{left:destination.left+'px',top:destination.top+'px',width:destination.width+'px',height:destination.height+'px'});
      if (item.url) { ghost.src = item.url;ghost.style.objectFit = getComputedStyle(target).objectFit;warmOriginal(state,target,item.url); }
      var originalVisibility = target.style.visibility;target.style.visibility = 'hidden';
      var restoreVisibility = function() { target.style.visibility = originalVisibility; };
      state.restores.push(restoreVisibility);document.body.appendChild(ghost);state.ghosts.push(ghost);
      var dx = item.source.left-destination.left, dy = item.source.top-destination.top;
      var animation = ghost.animate([
        {transform:'translate('+dx+'px,'+dy+'px) scale('+item.source.width/destination.width+','+item.source.height/destination.height+')',opacity:1},
        {transform:'translate(0,0) scale(1,1)',opacity:1}
      ],{duration:360,easing:'cubic-bezier(.2,.75,.2,1)',fill:'both'});
      state.animations.push(animation);
      jobs.push(animation.finished.catch(function() {}).then(function() {
        restoreVisibility();ghost.remove();state.ghosts=state.ghosts.filter(function(g) { return g!==ghost; });
        if (item.url && target.getAttribute('src')!==item.url) { state.urls.delete(item.url);URL.revokeObjectURL(item.url); }
      }));
    }
    try {
      state.items.forEach(function(item) { var target=targets[item.index];if(target) fly(item,target,new Image());else {state.urls.delete(item.url);URL.revokeObjectURL(item.url);} });
      if (state.text) {
        var copy = post.querySelector(':scope > .content'), ghost = document.createElement('div');
        ghost.textContent=state.text.text;ghost.style.font=state.text.font;fly(state.text,copy,ghost);
      }
      var enter = post.animate([{opacity:.35,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:220,easing:'ease-out'});
      state.animations.push(enter);jobs.push(enter.finished.catch(function() {}));
      await Promise.all(jobs);
      if (!state.urls.size) state.stop();
    } catch (_) { state.stop(); }
  }
  function clearInvalid() { active.forEach(function(state) { if (!state.current()) state.stop(); }); }
  window.addEventListener('auth-ready',clearInvalid);
  window.addEventListener('pagehide',function() { active.forEach(function(state) { state.stop(); }); });
  document.addEventListener('visibilitychange',function() { if (document.hidden) active.forEach(function(state) { state.stop(); }); });
  window.XtjPostPublishMotion = { capture:capture, play:play };
})();
