(function(){
  'use strict';

  var initialized = false;
  var initializingPromise = null;
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

  window.initPhotoWall = function(force) {
    if (initialized && !force) {
      if (typeof window.renderPhotoWallWithoutReload === 'function') {
        window.renderPhotoWallWithoutReload();
      }
      warmVisibleImages();
      return Promise.resolve(true);
    }

    if (initializingPromise && !force) return initializingPromise;

    initializingPromise = Promise.resolve().then(async function() {
      var grid = document.getElementById('photoGrid');
      if (!grid) throw new Error('photo_grid_missing');

      if (typeof window.renderPhotoWall !== 'function') {
        throw new Error('photo_renderer_not_loaded');
      }

      await window.renderPhotoWall();

      initialized = true;

      if (!grid.children.length) {
        throw new Error('photo_grid_not_rendered');
      }

      if (typeof window.bindPhotoWallScroll === 'function') {
        window.bindPhotoWallScroll();
      }

      warmVisibleImages();
      return true;
    }).catch(function(error) {
      initialized = false;

      var grid = document.getElementById('photoGrid');
      if (grid) {
        grid.innerHTML =
          '<div class="photo-wall-empty">' +
          '<div>照片墙加载失败</div>' +
          '<button type="button" onclick="window.initPhotoWall(true)">重新加载</button>' +
          '</div>';
      }

      console.error('[PhotoWall] initialization failed:', error && error.message ? error.message : error);
      throw error;
    }).finally(function() {
      initializingPromise = null;
    });

    return initializingPromise;
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