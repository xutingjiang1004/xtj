(function () {
  'use strict';

  if (window.__xtjSafeClickRecoveryV2) return;
  window.__xtjSafeClickRecoveryV2 = true;

  var TEXT_FIXES = [
    ['鏄ㄥぉ', '昨天'], ['鏄 ㄥ ぉ', '昨天'], ['鑽 ん お', '昨天'], ['鑽んお', '昨天'],
    ['鍔犺浇涓?..', '加载中...'], ['加载涓?..', '加载中...'], ['加载娑?..', '加载中...'], ['鍔犺浇', '加载'],
    ['鏆傛棤娑堟伅', '暂无消息'], ['鏆傛棤鐓х墖', '暂无照片'], ['鏆傛棤鍏憡', '暂无公告'], ['鏆傛棤', '暂无'],
    ['宸茶', '已读'], ['宸茶读', '已读'], ['宸茶', '已读'], ['鏈', '未读'], ['鏈读', '未读'], ['鏈', '未读'],
    ['鐧诲綍', '登录'], ['瀵嗙爜', '密码'], ['鐢ㄦ埛', '用户'], ['鏈煡鐢ㄦ埛', '未知用户'], ['鏈煡', '未知'],
    ['鐓х墖璇︽儏', '照片详情'], ['鐓х墖淇℃伅', '照片信息'], ['鐓х墖澧', '照片墙'], ['鐓х墖', '照片'],
    ['浣滆€?', '作者'], ['浣滆€', '作者'], ['鏃堕棿', '时间'], ['娴忚', '浏览'], ['澶у皬', '大小'],
    ['鍒犻櫎', '删除'], ['纭', '确认'], ['纭畾', '确定'], ['鍙栨秷', '取消'], ['鎻愪氦', '提交'], ['澶辫触', '失败'],
    ['缂栬緫', '编辑'], ['鐐硅禐', '点赞'], ['璇勮', '评论'], ['鍏憡', '公告'], ['鏇存柊', '更新'], ['淇', '修复'], ['浼樺寲', '优化'],
    ['鍏ㄩ儴甯栧瓙', '全部帖子'], ['娌℃湁鎵惧埌鐩稿叧甯栧瓙', '没有找到相关帖子'], ['鐐瑰嚮', '点击'], ['涓婁紶', '上传']
  ];

  function fixText(value) {
    var text = String(value == null ? '' : value);
    TEXT_FIXES.forEach(function (pair) { text = text.split(pair[0]).join(pair[1]); });
    text = text.replace(/鏄\s*ㄥ\s*ぉ/g, '昨天');
    text = text.replace(/鑽\s*(?:ㄥ|ん)\s*お/g, '昨天');
    text = text.replace(/宸茶?\s*[读讀]*/g, '已读');
    text = text.replace(/鏈?\s*[读讀]*/g, '未读');
    return text;
  }

  function hasBadText(value) {
    return /(鏄|鑽|んお|鍔犺浇|加载涓|加载娑|鏆傛棤|鍙戦€|娑堟伅|鐧诲綍|缂栬緫|鐐硅禐|璇勮|鍒犻櫎|纭?|纭|鐓х墖|浣滆|鏃堕棿|澶у皬|鍏憡|鏇存柊|淇|浼樺寲|鏈煡|宸茶|鏈)/.test(String(value || ''));
  }

  window.xtjFixText = fixText;
  window.__xtjUiTextRepair = fixText;

  function addSafeCss() {
    if (document.getElementById('xtjSafeClickRecoveryStyle')) return;
    var style = document.createElement('style');
    style.id = 'xtjSafeClickRecoveryStyle';
    style.textContent = [
      '.modal-overlay:not(.active),#authModal:not(.active),#reportModal:not(.active),#statModal:not(.active),#ppConfirmOverlay:not(.active){display:none!important;pointer-events:none!important;}',
      '#photoPreviewOverlay:not(.active),.photo-preview-overlay:not(.active){display:none!important;pointer-events:none!important;}',
      '.pp-download-confirm-overlay:not(.show){display:none!important;pointer-events:none!important;}',
      '.announcement-detail:not(.active){pointer-events:none!important;}',
      '.dock-panel.active,#dockBar,.dock-item,button,[role="button"],[onclick],input,textarea,select,label,a{pointer-events:auto;}',
      '.toast-container{pointer-events:none!important}.toast{pointer-events:auto!important}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function repairVisibleText(root) {
    root = root || document.body;
    if (!root) return;

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        if (!parent || /^(SCRIPT|STYLE|TEXTAREA|PRE|CODE)$/.test(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return hasBadText(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) { node.nodeValue = fixText(node.nodeValue); });

    if (root.querySelectorAll) {
      root.querySelectorAll('[title],[aria-label],[placeholder],[alt]').forEach(function (element) {
        ['title', 'aria-label', 'placeholder', 'alt'].forEach(function (attr) {
          var value = element.getAttribute(attr);
          if (hasBadText(value)) element.setAttribute(attr, fixText(value));
        });
      });
    }
  }

  function removeInvisibleBlockers() {
    var selectors = [
      '.modal-overlay:not(.active)',
      '#authModal:not(.active)',
      '#reportModal:not(.active)',
      '#statModal:not(.active)',
      '#ppConfirmOverlay:not(.active)',
      '#photoPreviewOverlay:not(.active)',
      '.photo-preview-overlay:not(.active)',
      '.pp-download-confirm-overlay:not(.show)'
    ];
    selectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (el) {
        el.style.pointerEvents = 'none';
      });
    });
  }

  function patchToast() {
    if (typeof window.showToast !== 'function' || window.showToast.__xtjSafeClickPatched) return;
    var original = window.showToast;
    window.showToast = function (message) {
      return original.call(this, fixText(message == null ? '' : String(message)) || '操作完成');
    };
    window.showToast.__xtjSafeClickPatched = true;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function appCoreMissing() {
    return typeof window.switchDockTab !== 'function' || typeof window.openAuthModal !== 'function' || typeof window.doPublish !== 'function';
  }

  function ensureAppBoot() {
    if (!appCoreMissing() || window.__xtjCoreRescueRunning) return;
    window.__xtjCoreRescueRunning = true;

    var feed = document.getElementById('feed');
    if (feed && /加载|鍔犺浇|loading/i.test(feed.textContent || '')) {
      feed.innerHTML = '<div class="loading"><div class="loading-spinner"></div><div class="loading-text">正在恢复页面...</div></div>';
    }

    var chain = Promise.resolve();
    if (!window.supabase) {
      chain = chain
        .then(function () { return loadScript('https://unpkg.com/@supabase/supabase-js@2'); })
        .catch(function () { return loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'); });
    }

    chain.then(function () {
      if (!window.supabase) throw new Error('Supabase still missing');
      return loadScript('js/core.js?v=rescue-' + Date.now());
    }).then(function () {
      return loadScript('js/photo-wall/data.js?v=rescue-' + Date.now()).catch(function () {});
    }).then(function () {
      return loadScript('js/photo-wall/render.js?v=rescue-' + Date.now()).catch(function () {});
    }).then(function () {
      return loadScript('js/photo-wall/upload.js?v=rescue-' + Date.now()).catch(function () {});
    }).then(function () {
      return loadScript('js/photo-wall/preview.js?v=rescue-' + Date.now()).catch(function () {});
    }).then(function () {
      return loadScript('js/photo-wall/photo-wall.js?v=rescue-' + Date.now()).catch(function () {});
    }).then(function () {
      patchToast();
      removeInvisibleBlockers();
      repairVisibleText(document.body);
      try { if (typeof window.updateAuthUI === 'function') window.updateAuthUI(); } catch (_) {}
      try { if (typeof window.loadPosts === 'function') window.loadPosts(); } catch (_) {}
      try { if (typeof window.switchDockTab === 'function') window.switchDockTab('posts', true); } catch (_) {}
      window.showToast && window.showToast('页面已恢复');
    }).catch(function (error) {
      console.error('[XTJ] core rescue failed:', error);
      if (feed) feed.innerHTML = '<div class="loading" style="color:#ff3b60;">页面核心脚本加载失败，请刷新或切换网络后重试</div>';
    }).finally(function () {
      window.__xtjCoreRescueRunning = false;
    });
  }

  function installLightObserver() {
    var timer = 0;
    var observer = new MutationObserver(function (records) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        records.forEach(function (record) {
          record.addedNodes && Array.prototype.forEach.call(record.addedNodes, function (node) {
            if (node.nodeType === 1) repairVisibleText(node);
            if (node.nodeType === 3 && hasBadText(node.nodeValue)) node.nodeValue = fixText(node.nodeValue);
          });
        });
        patchToast();
        removeInvisibleBlockers();
      }, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    addSafeCss();
    patchToast();
    removeInvisibleBlockers();
    repairVisibleText(document.body);
    ensureAppBoot();
    installLightObserver();
    setTimeout(function () { patchToast(); removeInvisibleBlockers(); repairVisibleText(document.body); ensureAppBoot(); }, 400);
    setTimeout(function () { patchToast(); removeInvisibleBlockers(); repairVisibleText(document.body); ensureAppBoot(); }, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
