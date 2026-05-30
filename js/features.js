(function () {
  'use strict';

  if (window.__xtjSafeFeaturesRestoreV1) return;
  window.__xtjSafeFeaturesRestoreV1 = true;

  var MOJIBAKE_PAIRS = [
    ['鏄ㄥぉ', '昨天'], ['鏄 ㄥ ぉ', '昨天'], ['鏄ㄥ?', '昨天'], ['鑽ㄥぉ', '昨天'], ['鑽 ん お', '昨天'], ['鑽んお', '昨天'],
    ['加载涓?..', '加载中...'], ['加载娑?..', '加载中...'], ['鍔犺浇涓?..', '加载中...'], ['鍔犺浇楂樻竻涓?..', '加载高清中...'], ['鍔犺浇', '加载'],
    ['姝ｅ湪刷新鐓х墖澧?..', '正在刷新照片墙...'], ['姝ｅ湪刷新...', '正在刷新...'], ['刷新瀹屾垚', '已刷新'], ['鍒锋柊瀹屾垚', '已刷新'],
    ['鏆傛棤娑堟伅', '暂无消息'], ['鏆傛棤鐓х墖', '暂无照片'], ['鏆傛棤鍏憡', '暂无公告'], ['鏆傛棤', '暂无'],
    ['鍦ㄥ笘瀛愰〉闈㈢偣鍑诲ご鍍忓紑濮嬭亰澶?', '在帖子页面点击头像开始聊天'], ['鍙戦€佺涓€鏉℃秷鎭惂', '发送第一条消息吧'], ['娑堟伅', '消息'],
    ['鍙戦€佷簡涓€寮犲浘鐗?视频', '发送了一张图片/视频'], ['鍙戦€佷簡涓€寮犲浘鐗?', '发送了一张图片'], ['鍥剧墖', '图片'],
    ['鈴?/div><div>', ''], ['鈴?', ''], ['鈴', ''], ['馃挰', ''], ['馃摥', '📣'], ['鈿狅笍', ''], ['鉂わ笍', '❤️'],
    ['请先鐧诲綍', '请先登录'], ['鐧诲綍', '登录'], ['瀵嗙爜', '密码'], ['鐢ㄦ埛', '用户'], ['鏈煡鐢ㄦ埛', '未知用户'], ['鏈煡', '未知'],
    ['宸茶', '已读'], ['宸茶读', '已读'], ['宸茶讀', '已读'], ['宸茶', '已读'], ['鏈', '未读'], ['鏈读', '未读'], ['鏈讀', '未读'], ['鏈', '未读'],
    ['鍏抽棴棰勮', '关闭预览'], ['涓婁竴寮?', '上一张'], ['涓嬩竴寮?', '下一张'], ['鍒嗘韓', '分享'], ['鍒嗕韩', '分享'], ['鏃嬭浆 90 搴?', '旋转 90 度'], ['旋转 90 搴?', '旋转 90 度'],
    ['鐓х墖璇︽儏', '照片详情'], ['鐓х墖淇℃伅', '照片信息'], ['鐓х墖澧', '照片墙'], ['鐓х墖', '照片'],
    ['浣滆€?', '作者'], ['浣滆€', '作者'], ['鏃堕棿', '时间'], ['娴忚', '浏览'], ['澶у皬', '大小'], ['鏂囦欢淇℃伅', '文件信息'], ['鏂囦欢', '文件'],
    ['璁惧', '设备'], ['鍏夊湀', '光圈'], ['蹇棬', '快门'], ['鐒﹁窛', '焦距'],
    ['楂樻竻鍥惧姞杞藉け璐ワ紝宸叉樉绀洪瑙堝浘', '高清图加载失败，已显示预览图'], ['楂樻竻', '高清'], ['宸叉樉绀洪瑙堝浘', '已显示预览图'],
    ['浠呬笂浼犺€呭彲鍒犻櫎', '仅上传者可删除'], ['鍒犻櫎鐓х墖', '删除照片'], ['鍒犻櫎澶辫触', '删除失败'], ['鍒犻櫎', '删除'],
    ['纭畾鍒犻櫎杩欏紶鐓х墖鍚楋紵', '确定删除这张照片吗？'], ['纭畾瑕佸垹闄よ繖鏉″叕鍛婂悧锛', '确定要删除这条公告吗？'], ['纭鍒犻櫎', '确认删除'], ['纭删除', '确认删除'], ['纭', '确认'], ['纭畾', '确定'],
    ['鍙栨秷', '取消'], ['鎻愴氦', '提交'], ['鎻愳氦', '提交'], ['鎻愪氦', '提交'], ['澶辫触', '失败'], ['鏈煡閿欒', '未知错误'], ['閿欒', '错误'],
    ['缂栬緫', '编辑'], ['鐐硅禐', '点赞'], ['璇勮', '评论'], ['鏃犳潈', '无权'], ['甯栧瓙', '帖子'], ['鍙戝笘', '发帖'],
    ['鍏憡发布成功', '公告发布成功'], ['删除鍏憡', '删除公告'], ['加载鍏憡失败', '加载公告失败'], ['鍏憡', '公告'],
    ['璇疯嚦灏戝～鍐欐爣棰樻垨内容', '请至少填写标题或内容'], ['鏍囬', '标题'],
    ['鏇存柊内容', '更新内容'], ['淇内容', '修复内容'], ['浼樺寲内容', '优化内容'], ['鏇存柊', '更新'], ['淇', '修复'], ['浼樺寲', '优化'],
    ['缁熻', '统计'], ['璇︽儏', '详情'], ['娉勯湶', '泄露'], ['浜掑姩', '互动'], ['棰勮', '预览'], ['鍙屽嚮', '双击'], ['缂╁皬', '缩小'], ['鍙屾寚', '双指'], ['缂╂斁', '缩放'], ['涓嶇ǔ瀹', '不稳定'],
    ['缂╃暐', '缩略'], ['鍔熻兘', '功能'], ['涓庝氦浜', '与交互'], ['寮圭獥', '弹窗'], ['閫忔槑', '透明'], ['鐜荤拑', '玻璃'], ['鏁堟灉', '效果'], ['鎸夐挳', '按钮'], ['鐐瑰嚮', '点击'], ['鏃犲搷搴', '无响应'],
    ['瀛楁', '字段'], ['鍚嶅尮閰', '名匹配'], ['閫氱煡', '通知'], ['寮€鍏', '开关'], ['涓嶄竴鑷', '不一致'], ['鏉冮檺', '权限'], ['妫€鏌', '检查'], ['涓婁紶', '上传'], ['鍘婚櫎', '去除']
  ];

  function fixText(value) {
    var text = String(value == null ? '' : value);
    MOJIBAKE_PAIRS.forEach(function (pair) {
      text = text.split(pair[0]).join(pair[1]);
    });
    text = text.replace(/鏄\s*ㄥ\s*ぉ/g, '昨天');
    text = text.replace(/鑽\s*(?:ㄥ|ん)\s*お/g, '昨天');
    text = text.replace(/宸茶?\s*[读讀]*/g, '已读');
    text = text.replace(/鏈?\s*[读讀]*/g, '未读');
    return text;
  }

  function hasMojibake(value) {
    return /(鏄|鑽|んお|加载涓|加载娑|鍔犺浇|鈴|馃|鈿|鉂|刷新瀹|姝ｅ湪刷新|鏆傛棤|鍙戦€|娑堟伅|鐧诲綍|缂栬緫|鐐硅禐|璇勮|鍒犻櫎|纭?|纭|鐓х墖|浣滆|鏃堕棿|澶у皬|鍏憡|鏇存柊|淇|浼樺寲|瀛楁|閫氱煡|寮€|涓婁紶|楂樻竻|鏈煡|宸茶|鏈)/.test(String(value || ''));
  }

  window.xtjFixText = fixText;

  function repairVisibleText(root) {
    root = root || document.body;
    if (!root) return;

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        if (!parent || /^(SCRIPT|STYLE|TEXTAREA|PRE|CODE)$/.test(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return hasMojibake(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });

    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      node.nodeValue = fixText(node.nodeValue);
    });

    if (root.querySelectorAll) {
      root.querySelectorAll('[title],[aria-label],[placeholder],[alt]').forEach(function (element) {
        ['title', 'aria-label', 'placeholder', 'alt'].forEach(function (attr) {
          var value = element.getAttribute(attr);
          if (hasMojibake(value)) element.setAttribute(attr, fixText(value));
        });
      });
    }
  }

  function patchToast() {
    if (typeof window.showToast !== 'function' || window.showToast.__xtjTextPatched) return;
    var original = window.showToast;
    window.showToast = function (message) {
      return original.call(this, fixText(message == null ? '' : String(message)) || '操作完成');
    };
    window.showToast.__xtjTextPatched = true;
  }

  function patchChatHooks() {
    ['openChat', 'switchDockTab', 'loadDockChatList', 'loadDockChatMessages'].forEach(function (name) {
      if (typeof window[name] !== 'function' || window[name].__xtjTextPatched) return;
      var original = window[name];
      window[name] = function () {
        var result = original.apply(this, arguments);
        setTimeout(function () { repairVisibleText(document.body); }, 0);
        setTimeout(function () { repairVisibleText(document.body); }, 180);
        setTimeout(function () { repairVisibleText(document.body); }, 650);
        return result;
      };
      window[name].__xtjTextPatched = true;
    });
  }

  function installProfileBridge() {
    if (typeof window.syncProfileUser !== 'function') {
      window.syncProfileUser = function () {
        var user = window.currentUser || '';
        var name = document.getElementById('profileName');
        var status = document.getElementById('profileStatus');
        var avatar = document.getElementById('profileAvatar');
        if (name) name.textContent = user || '未登录';
        if (status) status.textContent = user ? '查看资料' : '点击登录';
        if (avatar) avatar.textContent = user ? user.charAt(0).toUpperCase() : '?';
      };
    }

    document.addEventListener('change', function (event) {
      if (!event.target) return;
      if (event.target.id === 'profileThemeToggle') {
        var themeButton = document.getElementById('themeToggle');
        if (themeButton) themeButton.click();
      }
      if (event.target.id === 'profileNotifToggle') {
        try { localStorage.setItem('xtj-notif', event.target.checked ? 'on' : 'off'); } catch (_) {}
      }
    });
  }

  function installReportFallback() {
    if (typeof window.openReport !== 'function') {
      window.openReport = function (type, id, user) {
        var modal = document.getElementById('reportModal');
        if (!modal) return;
        modal.style.display = '';
        modal.classList.add('active');
        var category = document.getElementById('reportCategory');
        var reason = document.getElementById('reportReason');
        var preview = document.getElementById('reportEvidencePreview');
        var input = document.getElementById('reportEvidenceInput');
        if (category) category.value = 'spam';
        if (reason) reason.value = '';
        if (preview) preview.textContent = '';
        if (input) input.value = '';
        window._reportTarget = { type: type, id: id, user: user || '' };
      };
    }

    if (typeof window.submitReport !== 'function') {
      window.submitReport = async function () {
        var target = window._reportTarget;
        var reasonElement = document.getElementById('reportReason');
        var categoryElement = document.getElementById('reportCategory');
        var button = document.getElementById('reportSubmitBtn');
        var reason = reasonElement ? reasonElement.value.trim() : '';
        if (!target) { window.showToast && window.showToast('举报目标不存在'); return; }
        if (!reason) { window.showToast && window.showToast('请填写举报理由'); return; }
        if (!window.sb) { window.showToast && window.showToast('提交失败: 数据库未连接'); return; }
        if (button) { button.disabled = true; button.textContent = '提交中...'; }
        try {
          var result = await window.sb.from('reports').insert([{
            reporter_name: window.currentUser || 'anonymous',
            target_type: target.type,
            target_id: target.id,
            target_user: target.user || '',
            report_category: categoryElement ? categoryElement.value : 'other',
            report_reason: reason,
            evidence_url: '',
            status: 'pending'
          }]);
          if (result.error) throw result.error;
          window.showToast && window.showToast('举报已提交');
          window.closeModal && window.closeModal('reportModal');
        } catch (error) {
          window.showToast && window.showToast('提交失败: ' + (error.message || '未知错误'));
        } finally {
          if (button) { button.disabled = false; button.textContent = '提交举报'; }
        }
      };
    }

    document.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('.report-btn') : null;
      if (!button) return;
      window.openReport('post', button.getAttribute('data-id'), button.getAttribute('data-user') || '');
    });

    document.addEventListener('change', function (event) {
      if (!event.target || event.target.id !== 'reportEvidenceInput') return;
      var file = event.target.files && event.target.files[0];
      var preview = document.getElementById('reportEvidencePreview');
      if (preview) preview.textContent = file ? '已选择: ' + file.name + ' (' + (file.size / 1024).toFixed(1) + 'KB)' : '';
    });
  }

  function boot() {
    patchToast();
    patchChatHooks();
    installProfileBridge();
    installReportFallback();
    repairVisibleText(document.body);
    try { window.syncProfileUser && window.syncProfileUser(); } catch (_) {}

    var timer = 0;
    var observer = new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        patchToast();
        patchChatHooks();
        repairVisibleText(document.body);
      }, 80);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['title', 'aria-label', 'placeholder', 'alt']
    });

    setTimeout(function () { repairVisibleText(document.body); }, 200);
    setTimeout(function () { repairVisibleText(document.body); }, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
