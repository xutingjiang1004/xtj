(function () {
  'use strict';
  if (window.__xtjFeaturesSafeV10) return;
  window.__xtjFeaturesSafeV10 = true;

  var queuedNodes = [];
  var queuedSet = new WeakSet();
  var repairScheduled = false;
  var observer = null;
  var LEGACY_MARKER = 'data-xtj-legacy-text';
  var REPAIR_ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
  var MOJIBAKE_PAIRS = [
    ['鍏ㄩ儴甯栧瓙', '全部帖子'], ['娌℃湁鎵惧埌相关甯栧瓙', '没有找到相关帖子'],
    ['纭鎿嶄綔', '确认操作'], ['纭畾瑕佹墽琛屾鎿嶄綔鍚楋紵', '确定要执行此操作吗？'],
    ['鍔熻兘浼樺寲', '功能优化'], ['Bug修复', 'Bug修复'], ['鏂板', '新增'],
    ['淇', '修复'], ['绛涢€', '筛选'], ['甯栧瓙', '帖子'], ['鐢ㄦ埛', '用户'],
    ['鎸夐挳', '按钮'], ['涓炬姤', '举报'], ['鍔犺浇', '加载'], ['涓婁紶', '上传'],
    ['鍙戦€', '发送'], ['失败', '失败'], ['鎴愬姛', '成功'], ['閿欒', '错误'],
    ['鐓х墖', '照片'], ['椤甸潰', '页面'], ['鏁版嵁', '数据'], ['缃戠粶', '网络'],
    ['瀹夊叏', '安全'], ['妯″紡', '模式'], ['棰勮', '预览'], ['鍒嗕韩', '分享'],
    ['鏄剧ず', '显示'], ['鏀寔', '支持'], ['杩斿洖', '返回'], ['澶勭悊', '处理'],
    ['璇█', '语言'], ['娴佺▼', '流程'], ['寮傛', '异常'], ['娓呯悊', '清理'],
    ['鍘嬬缉', '压缩'], ['鍙戝竷', '发布'], ['淇濆瓨', '保存'], ['纭畾', '确定'],
    ['鍒锋柊', '刷新'], ['鍙戦€佸け璐?', '发送失败'], ['加载涓?..', '加载中..'], ['加载涓?', '加载中']
  ];
  var replacements = Object.create(null);
  var patterns = [];

  MOJIBAKE_PAIRS.forEach(function (pair) {
    if (!pair[0] || pair[0] === pair[1] || replacements[pair[0]]) return;
    replacements[pair[0]] = pair[1];
    patterns.push(pair[0]);
  });
  patterns.sort(function (a, b) { return b.length - a.length; });
  var repairPattern = new RegExp(patterns.map(function (value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('|'), 'g');

  function fixText(value) {
    var text = String(value == null ? '' : value);
    return text.replace(repairPattern, function (match) { return replacements[match] || match; });
  }
  function repairMarkedNode(node) {
    if (!node || node.nodeType !== 1 || !node.hasAttribute(LEGACY_MARKER)) return;
    Array.prototype.forEach.call(node.childNodes, function (child) {
      if (child.nodeType === 3) child.nodeValue = fixText(child.nodeValue);
    });
    REPAIR_ATTRS.forEach(function (attr) {
      if (node.hasAttribute(attr)) node.setAttribute(attr, fixText(node.getAttribute(attr)));
    });
    node.removeAttribute(LEGACY_MARKER);
  }

  function flushRepairs() {
    repairScheduled = false;
    var nodes = queuedNodes.slice();
    queuedNodes.length = 0;
    queuedSet = new WeakSet();
    nodes.forEach(repairMarkedNode);
  }

  function scheduleRepair(node) {
    if (!node || node.nodeType !== 1 || queuedSet.has(node)) return;
    queuedSet.add(node);
    queuedNodes.push(node);
    if (repairScheduled) return;
    repairScheduled = true;
    requestAnimationFrame(flushRepairs);
  }

  function collectMarkedNodes(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.hasAttribute(LEGACY_MARKER)) scheduleRepair(node);
    if (node.querySelectorAll) node.querySelectorAll('[' + LEGACY_MARKER + ']').forEach(scheduleRepair);
  }

  function patchToast() {
    if (typeof window.showToast !== 'function' || window.showToast.__xtjPatchedV10) return;
    var original = window.showToast;
    window.showToast = function () {
      var args = Array.prototype.slice.call(arguments);
      if (args.length > 0 && args[0] != null) {
        args[0] = fixText(String(args[0])).trim();
        if (!args[0]) return; // skip empty messages, don't show "操作成功"
      }
      return original.apply(this, args);
    };
    window.showToast.__xtjPatchedV10 = true;
  }

  function patchChat() {
    if (typeof window.openChat === 'function' && !window.openChat.__xtjPatchedV10) {
      var originalOpen = window.openChat;
      window.openChat = function () { return originalOpen.apply(this, arguments); };
      window.openChat.__xtjPatchedV10 = true;
    }
    if (typeof window.switchDockTab === 'function' && !window.switchDockTab.__xtjPatchedV10) {
      var originalSwitch = window.switchDockTab;
      window.switchDockTab = function () { return originalSwitch.apply(this, arguments); };
      window.switchDockTab.__xtjPatchedV10 = true;
    }
  }

  function initProfileSync() {
    window.syncProfileUser = function () {
      var name = document.getElementById('profileName');
      var status = document.getElementById('profileStatus');
      var avatar = document.getElementById('profileAvatar');
      if (!name) return;
      if (window.currentUser) {
        name.textContent = window.currentUser;
        if (status) status.textContent = '查看资料';
        if (avatar) avatar.textContent = window.currentUser[0].toUpperCase();
      } else {
        name.textContent = '未登录';
        if (status) status.textContent = '请先登录';
        if (avatar) avatar.textContent = '?';
      }
    };
  }

  function stopObserver() {
    if (observer) observer.disconnect();
  }

  function boot() {
    patchToast();
    patchChat();
    initProfileSync();
    document.querySelectorAll('[' + LEGACY_MARKER + ']').forEach(scheduleRepair);
    observer = new MutationObserver(function (records) {
      records.forEach(function (record) {
        Array.prototype.forEach.call(record.addedNodes || [], collectMarkedNodes);
      });
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('beforeunload', stopObserver);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
