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
      viewer.classList.remove('zoomed'); viewer.src = image.src; viewer.alt = image.alt; dialog.showModal();
    });
  });
  if (dialog) {
    dialog.querySelector('.close').addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('close', function () { viewer.removeAttribute('src'); });
    viewer.addEventListener('dblclick', function () { viewer.classList.toggle('zoomed'); });
  }
})();
