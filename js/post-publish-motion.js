'use strict';
(function() {
  var active = new Set(), duration = 480;
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
  function place(node, box) {
    Object.assign(node.style, {left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'});
  }
  function release(state, item) {
    if (item.lease && item.flightDone && item.mediaReady) {
      item.lease.release(); item.lease = null;
    }
    if (state.motionDone && !state.items.some(function(i) { return i.lease; })) state.stop();
  }
  function capture(files, text, isCurrent) {
    if (!permitted() || !isCurrent()) return null;
    var state = {items:[],ghosts:[],animations:[],restores:[],current:isCurrent,stopped:false,motionDone:false};
    state.feed = Array.from(document.querySelectorAll('#feed > .post')).map(function(node) {
      return {node:node,box:rect(node)};
    }).filter(function(item) { return visible(item.box); });
    var previews = document.querySelectorAll('#postMediaPreviewGrid .post-media-preview-thumb');
    // Read all geometry first. Borrow the already decoded preview node and URL;
    // never create another Blob or decode the original again to start a flight.
    Array.from(files || []).slice(0,9).forEach(function(file,index) {
      var source = previews[index], image = source && source.querySelector('img'), box = rect(source);
      if (!file.type.startsWith('image/') || !visible(box) || !image || !image.complete || !image.naturalWidth) return;
      var lease = window.XtjPostComposerMedia && window.XtjPostComposerMedia.retainImage(file);
      if (lease) state.items.push({index:index,source:box,image:image,url:lease.url,lease:lease,flightDone:false,mediaReady:false});
    });
    var input = document.getElementById('postInp'), inputBox = rect(input);
    if (text && visible(inputBox)) {
      var style = getComputedStyle(input), left = parseFloat(style.paddingLeft) || 0, top = parseFloat(style.paddingTop) || 0;
      state.text = {text:text,source:{left:inputBox.left+left,top:inputBox.top+top,width:inputBox.width-left-(parseFloat(style.paddingRight)||0),height:Math.max(1,inputBox.height-top-(parseFloat(style.paddingBottom)||0))},font:style.font,lineHeight:style.lineHeight};
    }
    if (!state.items.length && !state.text) return null;
    state.stop = function() {
      if (state.stopped) return; state.stopped = true;
      clearTimeout(state.timer);
      if (state.startFrame) cancelAnimationFrame(state.startFrame);
      if (state.startResolve) { state.startResolve(); state.startResolve=null; }
      state.animations.forEach(function(a) { a.cancel(); });
      state.restores.forEach(function(restore) { restore(); });
      state.ghosts.forEach(function(g) { g.remove(); }); state.ghosts = [];
      state.items.forEach(function(item) { if (item.lease) { item.lease.release(); item.lease=null; } });
      active.delete(state);
    };
    active.add(state); state.timer = setTimeout(state.stop, 60000);
    // Freeze visible originals before clearing the draft changes page height.
    // This is one write phase, with no intervening layout reads.
    var fragment = document.createDocumentFragment();
    state.items.concat(state.text ? [state.text] : []).forEach(function(item) {
      var ghost = document.createElement('div'); ghost.className = 'post-publish-flight'; ghost.setAttribute('aria-hidden','true');
      place(ghost,item.source);
      if (item.image) { item.image.style.objectFit='cover'; ghost.appendChild(item.image); }
      else { ghost.textContent=item.text; ghost.style.font=item.font; ghost.style.lineHeight=item.lineHeight; }
      item.ghost=ghost; state.ghosts.push(ghost); fragment.appendChild(ghost);
    });
    document.body.appendChild(fragment);
    return state;
  }
  // Show the same local original until the canonical Storage URL has decoded.
  // URL ownership lasts until BOTH the flight and that handoff are finished.
  function bridgeOriginal(state, item, img) {
    if (img.complete && img.naturalWidth > 0) { item.mediaReady=true; return; }
    var remote = img.getAttribute('src'), loader = new Image(), settled = false, timer;
    function restore() {
      if (settled) return; settled=true; clearTimeout(timer); loader.onload=loader.onerror=null;
      if (img.getAttribute('src') === item.url) img.setAttribute('src',remote);
      item.mediaReady=true; release(state,item);
    }
    state.restores.push(restore); img.src=item.url;
    loader.onload = function() { if (loader.decode) loader.decode().catch(function() {}).then(restore); else restore(); };
    // A temporarily unavailable server image must not turn the just-sent photo blank.
    // The bounded local lease also prevents an indefinitely retained original.
    timer=setTimeout(restore,60000); loader.src=remote;
  }
  function imageFrames(item, destination, fit) {
    var sx=item.source.width/destination.width, sy=item.source.height/destination.height;
    var sourceScale=Math.max(item.source.width/item.image.naturalWidth,item.source.height/item.image.naturalHeight);
    var destScale=(fit==='contain'?Math.min:Math.max)(destination.width/item.image.naturalWidth,destination.height/item.image.naturalHeight);
    var ratio=sourceScale/destScale, frames=[];
    // Counter-scale the inner image while the clipping frame changes ratio.
    // Square selection -> natural-ratio single image keeps the original undistorted.
    for (var step=0;step<=24;step++) {
      var t=step/24, scale=ratio+(1-ratio)*t;
      frames.push({offset:t,transform:'scale('+scale/(sx+(1-sx)*t)+','+scale/(sy+(1-sy)*t)+')'});
    }
    return frames;
  }
  async function play(state, post) {
    if (!state || state.stopped) return;
    if (!post || !state.current() || !permitted()) { state.stop(); return; }
    try {
      post.classList.remove('is-newly-published');
      if (!visible(rect(post))) post.scrollIntoView({block:'nearest',behavior:'instant'});
      var targets = post.querySelectorAll('.post-media-cell img'), plans=[];
      // Finish ALL destination/style reads before swapping images or appending animations.
      state.items.concat(state.text ? [state.text] : []).forEach(function(item) {
        var target=item.image?targets[item.index]:post.querySelector(':scope > .content');
        var destination=rect(target);
        plans.push({item:item,target:target,destination:destination,fit:target&&item.image?getComputedStyle(target).objectFit:null,visibility:target?target.style.visibility:''});
      });
      var movements=state.feed.filter(function(item) { return item.node.isConnected; }).map(function(item) {
        return {node:item.node,before:item.box,after:rect(item.node)};
      });
      var jobs=[], timing={duration:duration,easing:'cubic-bezier(.25,.65,.2,1)',fill:'both'};
      // Existing visible rows follow the layout change on the same clock.
      // Their sudden jump used to make the otherwise smooth image flight feel abrupt.
      movements.forEach(function(item) {
        if (!visible(item.after)) return;
        var dx=item.before.left-item.after.left,dy=item.before.top-item.after.top;
        if (Math.abs(dx)+Math.abs(dy)<1) return;
        var movement=item.node.animate([{transform:'translate3d('+dx+'px,'+dy+'px,0)'},{transform:'translate3d(0,0,0)'}],timing);
        state.animations.push(movement);jobs.push(movement.finished.catch(function() {}).then(function(){movement.cancel();}));
      });
      plans.forEach(function(plan) {
        var item=plan.item, target=plan.target, destination=plan.destination, ghost=item.ghost;
        if (!visible(destination)) { ghost.remove(); item.flightDone=item.mediaReady=true; release(state,item); return; }
        place(ghost,destination);
        if (item.image) {
          item.image.style.objectFit=plan.fit;
          bridgeOriginal(state,item,target);
          var crop=item.image.animate(imageFrames(item,destination,plan.fit),timing);
          state.animations.push(crop);
        }
        var restoreVisibility=function() { target.style.visibility=plan.visibility; };
        state.restores.push(restoreVisibility); target.style.visibility='hidden';
        var animation=ghost.animate([
          {transform:'translate3d('+(item.source.left-destination.left)+'px,'+(item.source.top-destination.top)+'px,0)'+(item.image?' scale('+item.source.width/destination.width+','+item.source.height/destination.height+')':'')},
          {transform:'translate3d(0,0,0) scale(1,1)'}
        ],timing);
        state.animations.push(animation);
        jobs.push(animation.finished.catch(function() {}).then(function() {
          restoreVisibility(); ghost.remove(); item.flightDone=true; release(state,item);
        }));
      });
      // The card stays geometrically still; it shares the flight's single clock.
      Array.from(post.children).forEach(function(child) {
        if (child.matches('.content,.media')) return;
        var enter=child.animate([{opacity:0},{opacity:1}],timing);
        state.animations.push(enter); jobs.push(enter.finished.catch(function() {}));
      });
      // The previous timeline tick can predate this entire layout/decode task.
      // Hold the source frame, then start every layer at the next actual paint.
      state.animations.forEach(function(animation) { animation.pause(); animation.currentTime=0; });
      await new Promise(function(resolve) {
        state.startResolve=resolve;
        state.startFrame=requestAnimationFrame(function() {
          state.startFrame=null; state.startResolve=null;
          if (!state.stopped) {
            var start=document.timeline.currentTime;
            state.animations.forEach(function(animation) { animation.play(); animation.startTime=start; });
          }
          resolve();
        });
      });
      await Promise.all(jobs);
      state.ghosts=[]; state.motionDone=true;
      if (!state.items.some(function(item) { return item.lease; })) state.stop();
    } catch (_) { state.stop(); }
  }
  function clearInvalid() { active.forEach(function(state) { if (!state.current()) state.stop(); }); }
  window.addEventListener('auth-ready',clearInvalid);
  window.addEventListener('pagehide',function() { active.forEach(function(state) { state.stop(); }); });
  document.addEventListener('visibilitychange',function() { if (document.hidden) active.forEach(function(state) { state.stop(); }); });
  window.XtjPostPublishMotion = {capture:capture,play:play};
})();
