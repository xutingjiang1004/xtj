(function(){
  'use strict';

  var initialized = false;
  var warmTimer = null;

  function warmVisibleImages(){
    if (warmTimer) clearTimeout(warmTimer);
    warmTimer = setTimeout(function(){
      warmTimer = null;
      var schedule = window.requestIdleCallback || window.requestAnimationFrame;
      schedule(function(){
        if (typeof window.loadVisiblePhotoWallImages === 'function') {
          window.loadVisiblePhotoWallImages(document.getElementById('photoGrid'), 6);
        }
      });
    }, 80);
  }

  window.initPhotoWall = async function(){
    if (initialized) return;
    initialized = true;
    if (typeof window.renderPhotoWall === 'function') await window.renderPhotoWall();
    if (typeof window.bindPhotoWallScroll === 'function') window.bindPhotoWallScroll();
    warmVisibleImages();
  };

  function wrapRender(name){
    var original = window[name];
    if (typeof original !== 'function' || original.__xtjPhotoWarmWrapped) return;
    var wrapped = function(){
      var result = original.apply(this, arguments);
      return Promise.resolve(result).then(function(value){ warmVisibleImages(); return value; });
    };
    wrapped.__xtjPhotoWarmWrapped = true;
    window[name] = wrapped;
  }

  wrapRender('renderPhotoWall');
  wrapRender('renderPhotoWallWithoutReload');
})();
