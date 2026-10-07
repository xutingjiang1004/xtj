(function () {
  'use strict';
  var dialog = document.querySelector('dialog'), viewer = dialog && dialog.querySelector('img');
  document.querySelectorAll('article').forEach(function (article) {
    var image = article.querySelector('.photo img'), retry = article.querySelector('.retry');
    image.addEventListener('error', function () { retry.hidden = false; });
    image.addEventListener('load', function () { retry.hidden = true; });
    if (image.complete && !image.naturalWidth) retry.hidden = false;
    retry.addEventListener('click', function () { var url = new URL(image.src); url.searchParams.set('retry', Date.now()); image.src = url.href; });
    article.querySelector('.photo').addEventListener('click', function () {
      if (!dialog || !image.naturalWidth) return;
      viewer.classList.remove('zoomed'); viewer.parentElement.classList.remove('is-zoomed'); viewer.src = image.src; viewer.alt = image.alt; dialog.showModal();
    });
  });
  if (dialog) {
    viewer.draggable = false;
    var surface = viewer.parentElement, drag = null;
    function resetDrag() {
      drag = null; viewer.style.transform = ''; viewer.style.transition = '';
    }
    dialog.querySelector('.close').addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('close', function () { resetDrag(); viewer.removeAttribute('src'); });
    viewer.addEventListener('dblclick', function () { resetDrag(); surface.classList.toggle('is-zoomed', viewer.classList.toggle('zoomed')); });
    surface.addEventListener('pointerdown', function (event) {
      if (!dialog.open || viewer.classList.contains('zoomed') || !event.isPrimary || event.button !== 0) return;
      drag = { id:event.pointerId, x:event.clientX, y:event.clientY, dy:0 };
      if (surface.setPointerCapture) surface.setPointerCapture(event.pointerId);
    });
    surface.addEventListener('pointermove', function (event) {
      if (!drag || event.pointerId !== drag.id) return;
      var dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (dy <= 0 || Math.abs(dx) > dy) { drag.dy = 0; viewer.style.transform = ''; return; }
      drag.dy = dy;
      viewer.style.transform = 'translateY(' + dy + 'px) scale(' + Math.max(.85, 1 - dy / (innerHeight * 4)) + ')';
    });
    surface.addEventListener('pointerup', function (event) {
      if (!drag || event.pointerId !== drag.id) return;
      var shouldClose = drag.dy >= Math.max(80, Math.min(140, innerHeight * .12));
      resetDrag();
      if (shouldClose) dialog.close();
    });
    surface.addEventListener('pointercancel', resetDrag);
    surface.addEventListener('lostpointercapture', resetDrag);
  }
})();
