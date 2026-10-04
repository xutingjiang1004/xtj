'use strict';
(function() {
  var entries = [], selectionVersion = 0;
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
    var wrap = document.getElementById('postMediaPreview'), grid = document.getElementById('postMediaPreviewGrid'), count = document.getElementById('postMediaPreviewCount');
    if (!wrap || !grid) return;
    grid.replaceChildren();
    grid.style.setProperty('--post-grid-columns', window.XtjPostMedia.gridColumns(entries.length));
    entries.forEach(function(entry, index) {
      var node = document.createElement('div'); node.className = 'post-media-preview-thumb';
      var isVideo = entry.file.type.startsWith('video/'), isAudio = entry.file.type.startsWith('audio/');
      var media = document.createElement(isVideo ? 'video' : (isAudio ? 'audio' : 'img'));
      media.src = entry.url;
      if (isVideo) { media.muted = true; media.playsInline = true; media.preload = 'metadata'; }
      if (isAudio) { media.controls = true; media.preload = 'metadata'; node.classList.add('is-audio'); }
      if (!isVideo && !isAudio) { media.alt = '待发布图片 ' + (index + 1); media.decoding = 'async'; }
      var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'post-media-remove'; remove.textContent = '×';
      remove.setAttribute('aria-label', '移除第' + (index + 1) + '个附件');
      remove.addEventListener('click', function() { if (busy()) return; discard(entry); entries.splice(entries.indexOf(entry), 1); selectionVersion++; render(); });
      node.append(media, remove); grid.appendChild(node);
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
  window.XtjPostComposerMedia = { getFiles: function() { return entries.map(function(e) { return e.file; }); }, clear: clear, append: append,
    getVersion: function() { return selectionVersion; }, retainImage: retainImage };
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
