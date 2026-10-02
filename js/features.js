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
  var PROTECTED_TAGS = Object.create(null);
  ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'PRE', 'CODE', 'TEXTAREA', 'INPUT'].forEach(function (tag) {
    PROTECTED_TAGS[tag] = true;
  });
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
  function needsRepair(value) {
    repairPattern.lastIndex = 0;
    return repairPattern.test(String(value == null ? '' : value));
  }
  function isMarkedSystemText(node) {
    var element = node && node.nodeType === 1 ? node : node && node.parentNode;
    // A marker only authorizes this element's own text and labels, not user descendants.
    return !!(element && element.hasAttribute && element.hasAttribute(LEGACY_MARKER));
  }
  function isInProtectedSubtree(node) {
    var element = node && node.nodeType === 1 ? node : (node && node.parentNode);
    while (element && element.nodeType === 1) {
      if (PROTECTED_TAGS[String(element.tagName || '').toUpperCase()]) return true;
      if (element === document.body) break;
      element = element.parentNode;
    }
    return false;
  }
  function repairMarkedNode(node) {
    if (!node) return;
    // Content in source/code samples, templates, and form controls is literal data.
    // A queued node can also be moved into one of these subtrees before the RAF runs.
    if (isInProtectedSubtree(node) || !isMarkedSystemText(node)) return;
    if (node.nodeType === 3) {
      var originalText = node.nodeValue || '';
      var fixedText = fixText(originalText);
      if (fixedText !== originalText) node.nodeValue = fixedText;
      return;
    }
    if (node.nodeType !== 1) return;
    // Only explicitly marked system UI owns repairable text. Published user content stays literal.
    Array.prototype.forEach.call(node.childNodes, function (child) {
      if (child.nodeType === 3) {
        var originalText = child.nodeValue || '';
        var fixedText = fixText(originalText);
        if (fixedText !== originalText) child.nodeValue = fixedText;
      }
    });
    REPAIR_ATTRS.forEach(function (attr) {
      try {
        if (!node.hasAttribute(attr)) return;
        var originalAttr = node.getAttribute(attr);
        var fixedAttr = fixText(originalAttr);
        if (fixedAttr !== originalAttr) node.setAttribute(attr, fixedAttr);
      } catch (_) {}
    });
    // Keep the marker so later updates to this system label remain repairable.
  }

  function flushRepairs() {
    repairScheduled = false;
    var nodes = queuedNodes.slice();
    queuedNodes.length = 0;
    queuedSet = new WeakSet();
    nodes.forEach(repairMarkedNode);
  }

  function scheduleRepair(node) {
    if (!node || (node.nodeType !== 1 && node.nodeType !== 3) || queuedSet.has(node)) return;
    queuedSet.add(node);
    queuedNodes.push(node);
    if (repairScheduled) return;
    repairScheduled = true;
    requestAnimationFrame(flushRepairs);
  }

  function collectMarkedNodes(node) {
    if (!node) return;
    if (isInProtectedSubtree(node)) return;
    if (node.nodeType === 3) {
      if (isMarkedSystemText(node) && needsRepair(node.nodeValue)) scheduleRepair(node);
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = String(node.tagName || '').toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'INPUT') return;
    function collectElement(el) {
      if (isInProtectedSubtree(el) || !isMarkedSystemText(el)) return;
      if (el.hasAttribute(LEGACY_MARKER)) scheduleRepair(el);
      REPAIR_ATTRS.forEach(function(attr) {
        try { if (el.hasAttribute(attr) && needsRepair(el.getAttribute(attr))) scheduleRepair(el); } catch (_) {}
      });
      Array.prototype.forEach.call(el.childNodes || [], function (child) {
        if (child.nodeType === 3 && needsRepair(child.nodeValue)) scheduleRepair(child);
      });
    }
    collectElement(node);
    if (node.querySelectorAll) node.querySelectorAll('*').forEach(collectElement);
  }

  function patchToast() {
    // Preserve user-derived text verbatim; only suppress empty feedback.
    var original = window.showToast;
    if (typeof original !== 'function' || original.__xtjPatchedV10) return;
    window.showToast = function() {
      var args = Array.prototype.slice.call(arguments);
      if (!args[0] || !String(args[0]).trim()) return;
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
    if (document.body) collectMarkedNodes(document.body);
    observer = new MutationObserver(function (records) {
      records.forEach(function (record) {
        if (record.type === 'childList') {
          Array.prototype.forEach.call(record.addedNodes || [], collectMarkedNodes);
        } else if (record.type === 'characterData') {
          if (!isInProtectedSubtree(record.target) && isMarkedSystemText(record.target) && needsRepair(record.target.nodeValue)) scheduleRepair(record.target);
        } else if (record.type === 'attributes' && !isInProtectedSubtree(record.target) && isMarkedSystemText(record.target)) {
          var attr = record.attributeName;
          if (attr === LEGACY_MARKER && record.target.hasAttribute(LEGACY_MARKER)) {
            collectMarkedNodes(record.target);
          } else if (REPAIR_ATTRS.indexOf(attr) !== -1 && needsRepair(record.target.getAttribute(attr))) {
            scheduleRepair(record.target);
          }
        }
      });
    });
    if (document.body) observer.observe(document.body, {
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: REPAIR_ATTRS.concat([LEGACY_MARKER]),
      subtree: true
    });
    window.addEventListener('beforeunload', stopObserver);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
