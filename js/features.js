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
    // 仅剔除单字映射（如 '淇'→'修复'，会误伤人名/地名如"淇河"）；
    // 双字乱码组合（如 '閿欒'→'错误'）在合法中文中几乎不可能出现，保留以维持修复能力。
    // ★ 修复：此前把含 '?' 的键（如 '发送失败'/'加载中'，制表时字符丢失用 ? 占位）一并跳过，
    // 导致这些高频文案的修复条目永不生效；正则拼接已对元字符转义，'?' 键可安全参与匹配。
    if (!pair[0] || pair[0] === pair[1] || replacements[pair[0]] || pair[0].length < 2) return;
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
    if (!node || node.nodeType !== 1) return;
    // ★ 修复：此前要求节点带 data-xtj-legacy-text 属性，但全项目没有任何代码设置该标记，
    // 导致页面乱码修复（除 toast 外）从不生效。改为直接对节点文本做幂等修复：
    // 修复后的文本不再命中乱码对，重复处理无副作用；属性修复仅对匹配属性生效。
    Array.prototype.forEach.call(node.childNodes, function (child) {
      if (child.nodeType === 3) child.nodeValue = fixText(child.nodeValue);
    });
    REPAIR_ATTRS.forEach(function (attr) {
      try { if (node.hasAttribute(attr)) node.setAttribute(attr, fixText(node.getAttribute(attr))); } catch (_) {}
    });
    if (node.hasAttribute(LEGACY_MARKER)) node.removeAttribute(LEGACY_MARKER);
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
    // G6 修复：原实现是无操作的函数包装（openChat/switchDockTab 原样转发），
    // 属于死代码。真正的乱码修复由 MutationObserver 的 repairMarkedNode 完成，
    // 此处不再做无意义的别名覆盖。
    return;
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
        if (avatar) avatar.textContent = String(window.currentUser || '').slice(0, 1).toUpperCase() || '?';
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
