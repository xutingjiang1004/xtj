'use strict';
(function() {
  var entries = [], selectionVersion = 0, drag = null;
  function finishDrag() {
    if (!drag) return;
    clearTimeout(drag.timer);
    drag.node.classList.remove('is-dragging');
    if (drag.ghost) drag.ghost.remove();
    try { drag.node.releasePointerCapture(drag.pointerId); } catch (_) {}
    drag = null;
    var grid = document.getElementById('postMediaPreviewGrid');
    if (grid) entries.forEach(function (entry) { if (entry.node) grid.appendChild(entry.node); });
  }
  function reorder(from, to) {
    if (busy() || from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) return false;
    entries.splice(to, 0, entries.splice(from, 1)[0]); selectionVersion++;
    var grid = document.getElementById('postMediaPreviewGrid');
    entries.forEach(function (entry, index) {
      if (!entry.node || !grid) return;
      entry.node.style.order = index;
      if (!drag) grid.appendChild(entry.node);
      entry.node.setAttribute('aria-label', '第' + (index + 1) + '张图片，可拖拽排序');
      entry.node.querySelector('img').alt = '待发布图片 ' + (index + 1);
      entry.node.querySelector('.post-media-remove').setAttribute('aria-label', '移除第' + (index + 1) + '个附件');
    });
    return true;
  }
  function bindReorder(node, entry) {
    node.tabIndex = 0; node.setAttribute('role', 'group');
    node.setAttribute('aria-label', '第' + (entries.indexOf(entry) + 1) + '张图片，可拖拽排序');
    node.addEventListener('keydown', function (event) {
      if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      var offset = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      reorder(entries.indexOf(entry), entries.indexOf(entry) + offset); node.focus();
    });
    node.addEventListener('pointerdown', function (event) {
      if (busy() || entries.length < 2 || event.button !== 0 || event.target.closest('button')) return;
      finishDrag();
      drag = { node: node, entry: entry, pointerId: event.pointerId, x: event.clientX, y: event.clientY, ghost: null };
      node.setPointerCapture(event.pointerId);
    });
    node.addEventListener('pointermove', function (event) {
      if (!drag || drag.node !== node || drag.pointerId !== event.pointerId) return;
      if (busy()) { finishDrag(); return; }
      if (!drag.ghost && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
      event.preventDefault();
      if (!drag.ghost) {
        var rect = node.getBoundingClientRect();
        drag.ghost = node.querySelector('img').cloneNode(); drag.ghost.className = 'post-media-drag-ghost';
        drag.ghost.setAttribute('aria-hidden', 'true'); drag.ghost.removeAttribute('alt');
        drag.ghost.style.width = rect.width + 'px'; drag.ghost.style.height = rect.height + 'px';
        document.body.appendChild(drag.ghost); node.classList.add('is-dragging');
      }
      drag.ghost.style.left = event.clientX + 'px'; drag.ghost.style.top = event.clientY + 'px';
      var hit = document.elementFromPoint(event.clientX, event.clientY);
      var target = hit && hit.closest('#postMediaPreviewGrid .post-media-preview-thumb');
      if (!target || target === node) return;
      var to = entries.findIndex(function (item) { return item.node === target; });
      reorder(entries.indexOf(entry), to);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (name) {
      node.addEventListener(name, function (event) { if (drag && drag.pointerId === event.pointerId) finishDrag(); });
    });
  }
  // Publishing borrows the decoded original until the Feed's server URL is ready.
  // Clearing the draft must not revoke a URL still used by that transition.
  function discard(entry) {
    entry.discarded = true;
    if (!entry.retained) URL.revokeObjectURL(entry.url);
  }
  function retainImage(file) {
    var entry = entries.find(function(e) { return e.file === file; });
    if (!entry || !file.type.startsWith('image/')) return null;
    entry.retained++;
    var released = false;
    return { url: entry.url, release: function() {
      if (released) return; released = true;
      entry.retained--;
      if (entry.discarded && !entry.retained) URL.revokeObjectURL(entry.url);
    } };
  }
  function busy() { var b = document.getElementById('pubBtn'); return b && b.disabled; }
  function toast(message) { if (typeof window.showToast === 'function') window.showToast(message); }
  function render() {
    finishDrag();
    var wrap = document.getElementById('postMediaPreview'), grid = document.getElementById('postMediaPreviewGrid'), count = document.getElementById('postMediaPreviewCount');
    if (!wrap || !grid) return;
    grid.replaceChildren();
    grid.style.setProperty('--post-grid-columns', window.XtjPostMedia.gridColumns(entries.length));
    entries.forEach(function(entry, index) {
      var node = document.createElement('div'); node.className = 'post-media-preview-thumb';
      entry.node = node;
      var isVideo = entry.file.type.startsWith('video/'), isAudio = entry.file.type.startsWith('audio/');
      var media = document.createElement(isVideo ? 'video' : (isAudio ? 'audio' : 'img'));
      media.src = entry.url;
      if (isVideo) { media.muted = true; media.playsInline = true; media.preload = 'metadata'; }
      if (isAudio) { media.controls = true; media.preload = 'metadata'; node.classList.add('is-audio'); }
      if (!isVideo && !isAudio) { media.alt = '待发布图片 ' + (index + 1); media.decoding = 'sync'; }
      var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'post-media-remove'; remove.textContent = '×';
      remove.setAttribute('aria-label', '移除第' + (index + 1) + '个附件');
      remove.addEventListener('click', function() { if (busy()) return; discard(entry); entries.splice(entries.indexOf(entry), 1); selectionVersion++; render(); });
      node.append(media, remove); grid.appendChild(node);
      if (!isVideo && !isAudio) { media.draggable = false; node.classList.add('is-sortable'); bindReorder(node, entry); }
    });
    if (count) count.textContent = entries.length && entries[0].file.type.startsWith('image/')
      ? '已选择 ' + entries.length + ' / ' + window.XtjPostMedia.MAX_POST_IMAGES + ' 张图片' : '已选择 ' + entries.length + ' 个文件';
    wrap.style.display = entries.length ? '' : 'none'; wrap.classList.toggle('is-active', !!entries.length);
  }
  function clear() { entries.forEach(discard); entries = []; selectionVersion++; render(); }
  function append(files) {
    if (busy()) { toast('正在发布，请稍后再修改附件'); return false; }
    var added = Array.from(files || []);
    try { window.XtjPostMedia.validateSelection(entries.map(function(e) { return e.file; }).concat(added)); }
    catch (error) { toast(error.message); return false; }
    var created = [];
    try { added.forEach(function(file) { created.push({ file: file, url: URL.createObjectURL(file), retained: 0, discarded: false }); }); }
    catch (error) { created.forEach(function(e) { URL.revokeObjectURL(e.url); }); toast('无法预览附件，请重新选择'); return false; }
    entries = entries.concat(created); selectionVersion++; render(); return true;
  }
  window.XtjPostComposerMedia = { getFiles: function() { finishDrag(); return entries.map(function(e) { return e.file; }); }, clear: clear, append: append, reorder: reorder,
    getVersion: function() { return selectionVersion; }, retainImage: retainImage,
    imageDimensions: function(file) {
      var entry = entries.find(function(e) { return e.file === file; });
      var img = entry && entry.node && entry.node.querySelector('img');
      return img && img.complete && img.naturalWidth > 0 ? {width: img.naturalWidth, height: img.naturalHeight} : null;
    } };
  window.resetPostPreview = clear;
  Object.defineProperty(window, 'selectedPostMedia', { configurable: true, get: function() { return entries.map(function(e) { return e.file; }); } });
  function boot() {
    var input = document.getElementById('fileInp');
    if (!input || input.__xtjPostSelectionBound) return;
    input.__xtjPostSelectionBound = true; input.multiple = true;
    input.addEventListener('change', function() { append(input.files); input.value = ''; });
    var owner = window.currentUser || '';
    window.addEventListener('auth-ready', function() { var next = window.currentUser || ''; if (next !== owner) clear(); owner = next; });
    window.addEventListener('pagehide', function(e) { if (!e.persisted) clear(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
