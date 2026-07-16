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
        var images = document.querySelectorAll('#photoGrid .photo-wall-item img[data-src]');
        var count = Math.min(images.length, 6);
        var viewportLimit = Math.max(window.innerHeight * 1.5, 900);
        for (var i = 0; i < count; i++) {
          var img = images[i];
          var url = img.getAttribute('data-src');
          if (!url) continue;
          var rect = img.getBoundingClientRect();
          if (rect.top > viewportLimit || rect.bottom < -120) continue;
          img.src = url;
          img.removeAttribute('data-src');
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
