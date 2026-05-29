(function () {
  'use strict';
  if (window.__xtjFeaturesSafeV4) return;
  window.__xtjFeaturesSafeV4 = true;

  var chatListSnapshot = '';
  var loadingTimers = {};

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fixText(v) {
    var s = String(v == null ? '' : v);

    [
      ['鏄ㄥぉ', '昨天'], ['鏄 ㄥ ぉ', '昨天'], ['鏄ㄥ?', '昨天'], ['鑽ㄥぉ', '昨天'], ['鑽 ん お', '昨天'], ['鑽んお', '昨天'],
      ['加载涓?..', '加载中...'], ['加载娑?..', '加载中...'], ['鍔犺浇涓?..', '加载中...'], ['鍔犺浇', '加载'],
      ['姝ｅ湪刷新鐓х墖澧?..', '正在刷新照片墙...'], ['姝ｅ湪刷新...', '正在刷新...'], ['刷新瀹屾垚', '已刷新'], ['鍒锋柊瀹屾垚', '已刷新'],
      ['鏆傛棤娑堟伅', '暂无消息'], ['鍦ㄥ笘瀛愰〉闈㈢偣鍑诲ご鍍忓紑濮嬭亰澶?', '在帖子页面点击头像开始聊天'], ['鍙戦€佺涓€鏉℃秷鎭惂', '发送第一条消息吧'], ['娑堟伅', '消息'],
      ['鍙戦€佷簡涓€寮犲浘鐗?视频', '发送了一张图片/视频'], ['鍙戦€佷簡涓€寮犲浘鐗?', '发送了一张图片'],
      ['鈴?/div><div>', ''], ['鈴?', ''], ['鈴', ''], ['馃挰', ''], ['馃摥', ''], ['鈿狅笍', ''], ['鉂わ笍', '❤️'],
      ['请先鐧诲綍', '请先登录'], ['宸茶', '已读'], ['鏈', '未读'],
      ['纭删除', '确认删除'], ['纭', '确认'], ['缂栬緫', '编辑'], ['鍒犻櫎', '删除'], ['鐐硅禐', '点赞'], ['璇勮', '评论'], ['娴忚', '浏览'],
      ['鏆傛棤', '暂无'], ['鏃犳潈', '无权'], ['甯栧瓙', '帖子'], ['鐧诲綍', '登录'], ['锛岃', '，请'], ['閲嶈瘯', '重试'], ['鍙栨秷', '取消'], ['鎻愪氦', '提交'], ['澶辫触', '失败'], ['鏈煡閿欒', '未知错误'],
      ['鐓х墖璇︽儏', '照片详情'], ['鐓х墖淇℃伅', '照片信息'], ['浣滆€?', '作者'], ['浣滆€', '作者'], ['鏃堕棿', '时间'], ['澶у皬', '大小'], ['鏂囦欢淇℃伅', '文件信息'],
      ['鍏憡', '公告'], ['鏇存柊内容', '更新内容'], ['淇内容', '修复内容'], ['浼樺寲内容', '优化内容'], ['鏆傛棤鍏憡', '暂无公告']
    ].forEach(function (p) { s = s.split(p[0]).join(p[1]); });

    s = s.replace(/鏄\s*ㄥ\s*ぉ/g, '昨天');
    s = s.replace(/鑽\s*(?:ㄥ|ん)\s*お/g, '昨天');
    s = s.replace(/昨天\s+/g, '昨天 ');
    return s;
  }

  function bad(v) {
    return /(鏄ㄥぉ|鏄\s*ㄥ\s*ぉ|鑽|んお|加载涓|加载娑|鍔犺浇|鈴|馃|鈿|鉂|刷新瀹|姝ｅ湪刷新|鏆傛棤娑|鍙戦€|娑堟伅|鐧诲綍|缂栬緫|鐐硅禐|璇勮|鍒犻櫎|纭|鐓х墖|浣滆|鏃堕棿|澶у皬|鍏憡|鏇存柊|淇|浼樺寲)/.test(String(v || ''));
  }

  function addStyle() {
    var old = document.getElementById('xtjSafeFeatureFixStyle');
    if (old) old.remove();
    var st = document.createElement('style');
    st.id = 'xtjSafeFeatureFixStyle';
    st.textContent = `
      .toast-container{z-index:12000!important;gap:10px!important;max-width:min(92vw,520px)!important}.toast{display:inline-flex!important;align-items:center!important;justify-content:center!important;min-width:78px!important;min-height:38px!important;max-width:min(88vw,420px)!important;padding:10px 18px!important;border-radius:999px!important;background:rgba(18,24,32,.88)!important;color:rgba(255,255,255,.97)!important;border:1px solid rgba(255,255,255,.15)!important;box-shadow:0 14px 40px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.16)!important;backdrop-filter:blur(18px) saturate(160%)!important;-webkit-backdrop-filter:blur(18px) saturate(160%)!important;font-size:14px!important;font-weight:650!important;line-height:1.35!important;text-align:center!important}.toast:empty{display:none!important}
      .xtj-chat-loader,.xtj-chat-empty{min-height:58vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:34px 18px;color:var(--text-muted);position:relative;overflow:hidden}.xtj-chat-loader:before{content:'';position:absolute;width:min(86vw,430px);height:min(86vw,430px);border-radius:50%;background:radial-gradient(circle,rgba(168,85,247,.16),rgba(34,211,238,.08) 36%,transparent 68%);filter:blur(18px);opacity:.9;animation:xtjAuraBreath 1.75s ease-in-out infinite;pointer-events:none}.xtj-chat-loader:after{content:'✦  ✧  ✶';position:absolute;top:50%;left:50%;width:min(76vw,360px);height:min(76vw,360px);margin-left:calc(min(76vw,360px)/-2);margin-top:calc(min(76vw,360px)/-2);border-radius:50%;display:flex;align-items:flex-start;justify-content:center;color:rgba(124,58,237,.18);font-size:24px;letter-spacing:26px;text-shadow:0 0 28px rgba(124,58,237,.35);animation:xtjFieldSpin 5.2s linear infinite;pointer-events:none}
      .xtj-magic-loader{--magic-size:clamp(138px,22vw,176px);width:var(--magic-size);height:var(--magic-size);position:relative;display:grid;place-items:center;isolation:isolate;filter:drop-shadow(0 26px 55px rgba(124,58,237,.28));animation:xtjMagicFloat 1.35s ease-in-out infinite;z-index:2}.xtj-magic-loader:after{content:'';position:absolute;inset:calc(var(--magic-size)*-.30);border-radius:50%;background:conic-gradient(from 90deg,transparent 0 18deg,rgba(124,58,237,.16) 18deg 42deg,transparent 42deg 98deg,rgba(34,211,238,.14) 98deg 126deg,transparent 126deg 205deg,rgba(236,72,153,.15) 205deg 236deg,transparent 236deg 360deg);filter:blur(7px);animation:xtjMagicSpinReverse 2.8s linear infinite;z-index:0}.xtj-magic-loader:before{content:'';position:absolute;inset:calc(var(--magic-size)*.34);border-radius:50%;background:radial-gradient(circle at 50% 50%,rgba(255,255,255,1),rgba(255,255,255,.30) 39%,transparent 66%),radial-gradient(circle at 36% 30%,rgba(236,72,153,.62),transparent 56%),radial-gradient(circle at 66% 70%,rgba(34,211,238,.58),transparent 58%),radial-gradient(circle at 50% 80%,rgba(250,204,21,.36),transparent 54%);box-shadow:0 0 34px rgba(168,85,247,.48),0 0 76px rgba(34,211,238,.22),0 0 108px rgba(236,72,153,.13),inset 0 1px 0 rgba(255,255,255,.9);animation:xtjMagicCore .92s ease-in-out infinite;z-index:4}.xtj-magic-ring{position:absolute;inset:calc(var(--magic-size)*.04);border-radius:50%;border:1.5px solid rgba(168,85,247,.52);background:conic-gradient(from 0deg,transparent 0 12deg,rgba(236,72,153,.86) 12deg 26deg,transparent 26deg 67deg,rgba(34,211,238,.78) 67deg 84deg,transparent 84deg 138deg,rgba(250,204,21,.78) 138deg 154deg,transparent 154deg 226deg,rgba(124,58,237,.74) 226deg 240deg,transparent 240deg 360deg);-webkit-mask:radial-gradient(circle,transparent 54%,#000 56% 67%,transparent 69%);mask:radial-gradient(circle,transparent 54%,#000 56% 67%,transparent 69%);animation:xtjMagicSpin .72s linear infinite;z-index:2}.xtj-magic-ring.r2{inset:calc(var(--magic-size)*.18);opacity:.78;border-color:rgba(34,211,238,.48);animation:xtjMagicSpinReverse 1.05s linear infinite}.xtj-magic-ring.r3{inset:calc(var(--magic-size)*.30);opacity:.62;border-color:rgba(250,204,21,.38);animation:xtjMagicSpin 1.55s linear infinite}.xtj-magic-rune{position:absolute;left:50%;top:50%;width:20px;height:20px;margin:-10px;display:grid;place-items:center;font-size:16px;color:rgba(139,92,246,.78);text-shadow:0 0 20px rgba(139,92,246,.54);transform:rotate(var(--a)) translateY(calc(var(--magic-size)*-.49)) rotate(calc(-1 * var(--a)));animation:xtjRunePulse .72s ease-in-out infinite;z-index:5}.xtj-magic-rune.rune-b,.xtj-magic-rune.rune-f{color:rgba(34,211,238,.82);animation-delay:.08s}.xtj-magic-rune.rune-c,.xtj-magic-rune.rune-g{color:rgba(236,72,153,.82);animation-delay:.16s}.xtj-magic-rune.rune-d,.xtj-magic-rune.rune-h{color:rgba(250,204,21,.82);animation-delay:.24s}.xtj-magic-spark{position:absolute;width:6px;height:6px;border-radius:50%;background:currentColor;color:rgba(34,211,238,.95);box-shadow:0 0 18px currentColor,0 0 32px currentColor;animation:xtjSpark .68s ease-in-out infinite;z-index:6}.xtj-magic-spark.s1{left:14%;top:20%}.xtj-magic-spark.s2{right:11%;top:27%;color:rgba(236,72,153,.94);animation-delay:.12s}.xtj-magic-spark.s3{left:28%;bottom:9%;color:rgba(250,204,21,.92);animation-delay:.24s}.xtj-magic-spark.s4{right:25%;bottom:15%;color:rgba(124,58,237,.94);animation-delay:.34s}.xtj-magic-spark.s5{left:8%;bottom:38%;color:rgba(34,211,238,.86);animation-delay:.44s}.xtj-magic-spark.s6{right:9%;bottom:43%;color:rgba(236,72,153,.88);animation-delay:.54s}
      .xtj-chat-loader-title{margin-top:10px;font-size:20px;font-weight:820;letter-spacing:.04em;background:linear-gradient(90deg,rgba(31,41,55,.25),rgba(124,58,237,.88),rgba(34,211,238,.78),rgba(236,72,153,.78),rgba(31,41,55,.25));background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:xtjTextGlint .9s ease-in-out infinite}.xtj-chat-loader-sub{margin-top:7px;font-size:12px;color:rgba(31,41,55,.34)}.xtj-chat-loader-dots{display:flex;gap:7px;margin-top:12px}.xtj-chat-loader-dots span{width:7px;height:7px;border-radius:50%;background:rgba(124,58,237,.66);box-shadow:0 0 16px rgba(124,58,237,.28);animation:xtjDot .68s ease-in-out infinite}.xtj-chat-loader-dots span:nth-child(2){animation-delay:.09s;background:rgba(34,211,238,.72)}.xtj-chat-loader-dots span:nth-child(3){animation-delay:.18s;background:rgba(236,72,153,.70)}.xtj-chat-empty-icon{width:72px;height:72px;border-radius:26px;display:flex;align-items:center;justify-content:center;font-size:31px;background:rgba(255,255,255,.34);border:1px solid rgba(255,255,255,.62);box-shadow:0 18px 46px rgba(124,58,237,.1);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.xtj-chat-empty-title{margin-top:16px;font-size:20px;font-weight:760;color:rgba(31,41,55,.44)}.xtj-chat-empty-sub{margin-top:7px;font-size:13px;color:rgba(31,41,55,.34)}[data-theme="dark"] .xtj-chat-loader-sub,[data-theme="dark"] .xtj-chat-empty-sub{color:rgba(255,255,255,.3)}[data-theme="dark"] .xtj-chat-empty-title{color:rgba(255,255,255,.42)}
      @keyframes xtjAuraBreath{0%,100%{transform:scale(.92);opacity:.58}50%{transform:scale(1.08);opacity:1}}@keyframes xtjFieldSpin{to{transform:rotate(360deg)}}@keyframes xtjMagicFloat{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-7px) scale(1.025)}}@keyframes xtjMagicCore{0%,100%{transform:scale(.9);opacity:.78}50%{transform:scale(1.08);opacity:1}}@keyframes xtjMagicSpin{to{transform:rotate(360deg)}}@keyframes xtjMagicSpinReverse{to{transform:rotate(-360deg)}}@keyframes xtjRunePulse{0%,100%{opacity:.36;filter:blur(.25px);transform:rotate(var(--a)) translateY(calc(var(--magic-size)*-.49)) rotate(calc(-1 * var(--a))) scale(.86)}50%{opacity:1;filter:blur(0);transform:rotate(var(--a)) translateY(calc(var(--magic-size)*-.52)) rotate(calc(-1 * var(--a))) scale(1.14)}}@keyframes xtjSpark{0%,100%{transform:translate3d(0,0,0) scale(.56);opacity:.22}50%{transform:translate3d(8px,-12px,0) scale(1.25);opacity:1}}@keyframes xtjTextGlint{0%,100%{opacity:.68;background-position:0% 50%}50%{opacity:1;background-position:100% 50%}}@keyframes xtjDot{0%,100%{transform:translateY(0);opacity:.42}50%{transform:translateY(-6px);opacity:1}}@media(prefers-reduced-motion:reduce){.xtj-chat-loader:before,.xtj-chat-loader:after,.xtj-magic-loader,.xtj-magic-loader:before,.xtj-magic-loader:after,.xtj-magic-ring,.xtj-magic-rune,.xtj-magic-spark,.xtj-chat-loader-title,.xtj-chat-loader-dots span{animation:none!important}}
      #photoPreviewOverlay.photo-preview-overlay{position:fixed!important;inset:0!important;z-index:10000!important;overflow:hidden!important}#photoPreviewOverlay .photo-preview-image-wrapper,#photoPreviewOverlay #ppImageWrapper{position:absolute!important;inset:0!important;z-index:1!important;overflow:hidden!important}#photoPreviewOverlay .photo-preview-close,#photoPreviewOverlay .pp-nav-arrow,#photoPreviewOverlay .pp-info-btn,#photoPreviewOverlay .pp-share-btn,#photoPreviewOverlay .pp-rotate-btn,#photoPreviewOverlay .pp-delete-btn{position:absolute!important;width:42px!important;height:42px!important;min-width:42px!important;min-height:42px!important;padding:0!important;margin:0!important;border-radius:999px!important;display:flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;pointer-events:auto!important;background:rgba(12,18,28,.82)!important;color:rgba(255,255,255,.95)!important;border:1px solid rgba(255,255,255,.12)!important;z-index:40!important}#photoPreviewOverlay .photo-preview-close{top:calc(16px + env(safe-area-inset-top,0px))!important;right:calc(12px + env(safe-area-inset-right,0px))!important}#photoPreviewOverlay .pp-nav-arrow{top:50%!important;transform:translateY(-50%)!important;z-index:35!important}#photoPreviewOverlay .pp-nav-prev{left:calc(12px + env(safe-area-inset-left,0px))!important}#photoPreviewOverlay .pp-nav-next{right:calc(12px + env(safe-area-inset-right,0px))!important}#photoPreviewOverlay .pp-info-btn,#photoPreviewOverlay .pp-share-btn,#photoPreviewOverlay .pp-rotate-btn,#photoPreviewOverlay .pp-delete-btn{bottom:calc(24px + env(safe-area-inset-bottom,0px))!important;top:auto!important}#photoPreviewOverlay .pp-delete-btn{left:calc(16px + env(safe-area-inset-left,0px))!important;color:#fecaca!important;background:rgba(127,29,29,.58)!important}#photoPreviewOverlay .pp-info-btn{left:50%!important;transform:translateX(-50%)!important}#photoPreviewOverlay .pp-rotate-btn{right:calc(68px + env(safe-area-inset-right,0px))!important}#photoPreviewOverlay .pp-share-btn{right:calc(16px + env(safe-area-inset-right,0px))!important}
    `;
    document.head.appendChild(st);
  }

  function loaderHtml(text) {
    return '<div class="xtj-chat-loader" role="status" aria-live="polite"><div class="xtj-magic-loader" aria-hidden="true"><span class="xtj-magic-ring r1"></span><span class="xtj-magic-ring r2"></span><span class="xtj-magic-ring r3"></span><span class="xtj-magic-rune rune-a" style="--a:0deg">✦</span><span class="xtj-magic-rune rune-b" style="--a:45deg">✧</span><span class="xtj-magic-rune rune-c" style="--a:90deg">✶</span><span class="xtj-magic-rune rune-d" style="--a:135deg">✹</span><span class="xtj-magic-rune rune-e" style="--a:180deg">✦</span><span class="xtj-magic-rune rune-f" style="--a:225deg">✧</span><span class="xtj-magic-rune rune-g" style="--a:270deg">✶</span><span class="xtj-magic-rune rune-h" style="--a:315deg">✹</span><span class="xtj-magic-spark s1"></span><span class="xtj-magic-spark s2"></span><span class="xtj-magic-spark s3"></span><span class="xtj-magic-spark s4"></span><span class="xtj-magic-spark s5"></span><span class="xtj-magic-spark s6"></span></div><div class="xtj-chat-loader-title">' + esc(text || '加载中...') + '</div><div class="xtj-chat-loader-sub">正在展开传送法阵</div><div class="xtj-chat-loader-dots"><span></span><span></span><span></span></div></div>';
  }

  function emptyHtml(kind) {
    return '<div class="xtj-chat-empty"><div class="xtj-chat-empty-icon">💬</div><div class="xtj-chat-empty-title">暂无消息</div><div class="xtj-chat-empty-sub">' + (kind === 'detail' ? '发送第一条消息吧' : '在帖子页面点击头像开始聊天') + '</div></div>';
  }

  function capLoading(el) {
    if (!el || !el.id) return;
    clearTimeout(loadingTimers[el.id]);
    loadingTimers[el.id] = setTimeout(function () {
      var node = document.getElementById(el.id);
      if (!node || !node.querySelector('.xtj-chat-loader')) return;
      if (node.id === 'dockChatList' && chatListSnapshot) node.innerHTML = chatListSnapshot;
      else node.innerHTML = emptyHtml(node.id === 'dockChatMessages' ? 'detail' : 'list');
      repairVisibleText(node);
    }, 2600);
  }

  function repairChatArea(el) {
    if (!el) return;
    if (el.querySelector('.chat-list-item')) { if (el.id === 'dockChatList') chatListSnapshot = el.innerHTML; repairVisibleText(el); return; }
    if (el.querySelector('.chat-msg')) { repairVisibleText(el); return; }
    if (el.querySelector('.xtj-chat-loader')) { capLoading(el); return; }
    if (el.querySelector('.xtj-chat-empty')) { repairVisibleText(el); return; }
    var raw = el.innerHTML || '';
    var text = fixText(el.textContent || '').trim();
    if (/加载中|正在刷新/.test(text) || /加载涓|加载娑|鍔犺浇|鈴|馃挰|ce-icon/.test(raw)) { el.innerHTML = loaderHtml('加载中...'); capLoading(el); return; }
    if (/暂无消息|发送第一条消息吧|在帖子页面点击头像/.test(text) || /鏆傛棤娑堟伅|鍙戦€佺/.test(raw)) { el.innerHTML = emptyHtml(el.id === 'dockChatMessages' ? 'detail' : 'list'); repairVisibleText(el); return; }
    if (bad(raw)) el.innerHTML = fixText(raw);
    repairVisibleText(el);
  }

  function repairChat() {
    repairChatArea(document.getElementById('dockChatList'));
    repairChatArea(document.getElementById('dockChatMessages'));
    var title = document.getElementById('dockChatTitle');
    if (title && bad(title.textContent)) title.textContent = fixText(title.textContent || '消息');
  }

  function repairToasts() {
    var box = document.getElementById('toastContainer');
    if (!box) return;
    Array.prototype.slice.call(box.querySelectorAll('.toast')).forEach(function (t) {
      var text = fixText(t.textContent || '').trim();
      if (!text) t.remove(); else if (t.textContent !== text) t.textContent = text;
    });
  }

  function patchToast() {
    if (typeof window.showToast !== 'function' || window.showToast.__xtjPatched) return;
    var old = window.showToast;
    window.showToast = function (msg) {
      msg = fixText(msg == null ? '' : String(msg)).trim() || '操作完成';
      var r = old.call(this, msg);
      setTimeout(repairToasts, 0); setTimeout(repairToasts, 160);
      return r;
    };
    window.showToast.__xtjPatched = true;
  }

  function patchChat() {
    if (typeof window.openChat === 'function' && !window.openChat.__xtjPatched) {
      var oldOpen = window.openChat;
      window.openChat = function () { var r = oldOpen.apply(this, arguments); setTimeout(repairChat, 0); setTimeout(repairChat, 120); setTimeout(repairChat, 360); setTimeout(repairChat, 900); return r; };
      window.openChat.__xtjPatched = true;
    }
    if (typeof window.switchDockTab === 'function' && !window.switchDockTab.__xtjPatched) {
      var oldSwitch = window.switchDockTab;
      window.switchDockTab = function (tab, skip) { var r = oldSwitch.apply(this, arguments); if (tab === 'chat') { setTimeout(repairChat, 0); setTimeout(repairChat, 120); setTimeout(repairChat, 360); setTimeout(repairChat, 900); } setTimeout(repairToasts, 0); return r; };
      window.switchDockTab.__xtjPatched = true;
    }
  }

  function repairVisibleText(root) {
    root = root || document.body;
    if (!root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { var p = n.parentElement; if (!p || /^(SCRIPT|STYLE|TEXTAREA|PRE|CODE)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT; return bad(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP; } });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) { n.nodeValue = fixText(n.nodeValue); });
    if (root.querySelectorAll) {
      root.querySelectorAll('[title],[aria-label],[placeholder]').forEach(function (el) {
        ['title', 'aria-label', 'placeholder'].forEach(function (attr) {
          var v = el.getAttribute(attr);
          if (bad(v)) el.setAttribute(attr, fixText(v));
        });
      });
    }
  }

  function photoInfoAnim() {
    if (window.__xtjPhotoInfoAnimationFixInstalled || typeof window.showPhotoInfo !== 'function') return;
    window.__xtjPhotoInfoAnimationFixInstalled = true;
    var nativeShow = window.showPhotoInfo;
    function m() { return document.getElementById('ppInfoModal'); }
    function c(x) { return x ? x.querySelector('.pp-info-modal-content') : null; }
    function close(x) { x = x || m(); var y = c(x); if (!x) return; x.classList.remove('active'); x.style.display = 'flex'; x.style.pointerEvents = 'none'; x.style.transition = 'opacity 220ms ease-in'; x.style.opacity = '1'; if (y) { y.style.transition = 'transform 260ms cubic-bezier(.55,0,1,.45), opacity 180ms ease-in, filter 220ms ease-in'; y.style.transform = 'translate3d(0,14px,0) scale(.94)'; y.style.opacity = '0'; y.style.filter = 'blur(6px)'; } requestAnimationFrame(function () { x.style.opacity = '0'; }); setTimeout(function () { x.style.display = 'none'; if (y) { y.style.transition = ''; y.style.transform = ''; y.style.opacity = ''; y.style.filter = ''; } }, 280); }
    window.showPhotoInfo = function () { var x = m(); if (x && x.style.display !== 'none' && x.classList.contains('active')) { close(x); return; } nativeShow.apply(this, arguments); setTimeout(function () { x = m(); var y = c(x); repairVisibleText(x || document.body); if (!x || !y) return; x.style.display = 'flex'; x.style.pointerEvents = 'none'; x.style.opacity = '0'; y.style.pointerEvents = 'auto'; y.style.transition = 'none'; y.style.transform = 'translate3d(0,18px,0) scale(.92)'; y.style.opacity = '0'; y.style.filter = 'blur(8px)'; void y.offsetHeight; requestAnimationFrame(function () { x.style.opacity = '1'; y.style.transition = 'transform 360ms cubic-bezier(.16,1,.3,1), opacity 240ms ease-out, filter 320ms ease-out'; y.style.transform = 'translate3d(0,0,0) scale(1)'; y.style.opacity = '1'; y.style.filter = 'blur(0)'; }); }, 0); };
    window.closePhotoInfo = function () { close(m()); };
  }

  function reportsAndProfile() {
    window.syncProfileUser = function () { var n = document.getElementById('profileName'), s = document.getElementById('profileStatus'), a = document.getElementById('profileAvatar'); if (!n) return; if (window.currentUser) { n.textContent = window.currentUser; if (s) s.textContent = '查看资料'; if (a) a.textContent = window.currentUser[0].toUpperCase(); } else { n.textContent = '未登录'; if (s) s.textContent = '点击登录'; if (a) a.innerHTML = '?'; } };
    document.addEventListener('click', function (e) { var btn = e.target.closest('.report-btn'); if (btn) window.openReport('post', btn.getAttribute('data-id'), btn.getAttribute('data-user') || ''); });
    window.openReport = function (type, id, user) { var modal = document.getElementById('reportModal'); if (!modal) return; modal.style.display = ''; modal.classList.add('active'); var cat = document.getElementById('reportCategory'), rea = document.getElementById('reportReason'), pre = document.getElementById('reportEvidencePreview'), inp = document.getElementById('reportEvidenceInput'); if (cat) cat.value = 'spam'; if (rea) rea.value = ''; if (pre) pre.textContent = ''; if (inp) inp.value = ''; window._reportTarget = { type: type, id: id, user: user }; };
    window.submitReport = async function () { var target = window._reportTarget; if (!target) { window.showToast && window.showToast('举报目标不存在'); return; } var catEl = document.getElementById('reportCategory'), reaEl = document.getElementById('reportReason'), btn = document.getElementById('reportSubmitBtn'); var category = catEl ? catEl.value : 'other'; var reason = reaEl ? reaEl.value.trim() : ''; if (!reason) { window.showToast && window.showToast('请填写举报理由'); return; } if (btn) { btn.disabled = true; btn.textContent = '提交中...'; } try { var payload = { reporter_name: window.currentUser || 'anonymous', target_type: target.type, target_id: target.id, target_user: target.user || '', report_category: category, report_reason: reason, evidence_url: '', status: 'pending' }; var res = await window.sb.from('reports').insert([payload]); if (res.error) throw res.error; window.showToast && window.showToast('举报已提交'); window.closeModal && window.closeModal('reportModal'); } catch (err) { window.showToast && window.showToast('提交失败: ' + (err.message || '未知错误')); } finally { if (btn) { btn.disabled = false; btn.textContent = '提交举报'; } } };
    document.addEventListener('change', function (e) { if (e.target && e.target.id === 'profileThemeToggle') { var t = document.getElementById('themeToggle'); if (t) t.click(); } if (e.target && e.target.id === 'profileNotifToggle') { try { localStorage.setItem('xtj-notif', e.target.checked ? 'on' : 'off'); } catch (_) {} } if (e.target && e.target.id === 'reportEvidenceInput') { var f = e.target.files && e.target.files[0], p = document.getElementById('reportEvidencePreview'); if (p) p.textContent = f ? '已选择: ' + f.name + ' (' + (f.size / 1024).toFixed(1) + 'KB)' : ''; } });
  }

  function boot() {
    addStyle(); patchToast(); patchChat(); reportsAndProfile(); photoInfoAnim(); repairVisibleText(document.body); repairChat(); repairToasts();
    var obs = new MutationObserver(function () { clearTimeout(obs._t); obs._t = setTimeout(function () { repairVisibleText(document.body); repairChat(); repairToasts(); patchChat(); patchToast(); photoInfoAnim(); }, 60); });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder'] });
    setTimeout(function () { repairVisibleText(document.body); repairChat(); repairToasts(); }, 160);
    setTimeout(function () { repairVisibleText(document.body); repairChat(); repairToasts(); }, 700);
    setInterval(function () { repairVisibleText(document.body); repairChat(); repairToasts(); }, 1800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
