(function () {
  'use strict';
  if (window.__xtjFeaturesSafeV5) return;
  window.__xtjFeaturesSafeV5 = true;

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

      .xtj-chat-loader,.xtj-chat-empty{min-height:58vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:34px 18px;color:var(--text-muted);position:relative;overflow:hidden}.xtj-chat-loader:before{content:'';position:absolute;width:min(88vw,460px);height:min(88vw,460px);border-radius:50%;background:radial-gradient(circle,rgba(148,163,255,.13),rgba(20,184,166,.07) 37%,transparent 69%);filter:blur(22px);opacity:.95;animation:xtjAuraBreath 2.4s ease-in-out infinite;pointer-events:none}.xtj-chat-loader:after{content:'';position:absolute;top:50%;left:50%;width:min(76vw,360px);height:min(76vw,360px);margin-left:calc(min(76vw,360px)/-2);margin-top:calc(min(76vw,360px)/-2);border-radius:50%;background:linear-gradient(90deg,transparent 49.5%,rgba(125,211,252,.16) 50%,transparent 50.5%),linear-gradient(0deg,transparent 49.5%,rgba(196,181,253,.13) 50%,transparent 50.5%);opacity:.8;animation:xtjGridFade 2.8s ease-in-out infinite;pointer-events:none}
      .xtj-magic-loader{--magic-size:clamp(156px,24vw,194px);width:var(--magic-size);height:var(--magic-size);position:relative;display:grid;place-items:center;isolation:isolate;filter:drop-shadow(0 28px 56px rgba(79,70,229,.22));animation:xtjMagicFloat 2.1s ease-in-out infinite;z-index:2;cursor:pointer;-webkit-tap-highlight-color:transparent}.xtj-magic-loader:hover,.xtj-magic-loader.xtj-cast{filter:drop-shadow(0 34px 72px rgba(79,70,229,.32))}.xtj-magic-loader:before{content:'';position:absolute;inset:calc(var(--magic-size)*.36);border-radius:50%;background:radial-gradient(circle at 50% 48%,rgba(255,255,255,.98),rgba(191,219,254,.45) 38%,rgba(56,189,248,.16) 59%,transparent 72%);box-shadow:0 0 34px rgba(125,211,252,.42),0 0 86px rgba(129,140,248,.20),inset 0 1px 0 rgba(255,255,255,.92);animation:xtjMagicCore 1.9s ease-in-out infinite;z-index:7}.xtj-magic-loader:after{content:'';position:absolute;inset:calc(var(--magic-size)*.30);border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.70),rgba(96,165,250,.16) 48%,transparent 68%);filter:blur(8px);animation:xtjCoreMist 2.5s ease-in-out infinite;z-index:3}.xtj-magic-veil{position:absolute;inset:calc(var(--magic-size)*-.18);border-radius:50%;background:conic-gradient(from 90deg,transparent 0 26deg,rgba(125,211,252,.10) 26deg 45deg,transparent 45deg 118deg,rgba(196,181,253,.12) 118deg 138deg,transparent 138deg 224deg,rgba(165,243,252,.10) 224deg 245deg,transparent 245deg 360deg);filter:blur(5px);animation:xtjMagicSpinReverse 8s linear infinite;z-index:0}.xtj-magic-ring{position:absolute;border-radius:50%;border:1px solid rgba(147,197,253,.58);z-index:2}.xtj-magic-ring.r1{inset:calc(var(--magic-size)*.03);box-shadow:0 0 22px rgba(125,211,252,.16),inset 0 0 18px rgba(196,181,253,.10);animation:xtjMagicSpin 7.5s linear infinite}.xtj-magic-ring.r2{inset:calc(var(--magic-size)*.16);border-style:dashed;border-color:rgba(196,181,253,.54);animation:xtjMagicSpinReverse 5.8s linear infinite}.xtj-magic-ring.r3{inset:calc(var(--magic-size)*.29);border-color:rgba(165,243,252,.46);box-shadow:0 0 18px rgba(165,243,252,.12);animation:xtjMagicSpin 4.7s linear infinite}.xtj-magic-ring.r4{inset:calc(var(--magic-size)*-.08);border-color:rgba(255,255,255,.18);box-shadow:inset 0 0 30px rgba(125,211,252,.08);animation:xtjOuterPulse 2.6s ease-in-out infinite}.xtj-magic-ring.r5{inset:calc(var(--magic-size)*.43);border-color:rgba(255,255,255,.42);animation:xtjMagicSpinReverse 3.2s linear infinite}.xtj-magic-line{position:absolute;left:50%;top:50%;width:1px;height:calc(var(--magic-size)*.92);transform-origin:50% 0;background:linear-gradient(to bottom,transparent,rgba(125,211,252,.34),rgba(255,255,255,.20),transparent);z-index:1}.xtj-magic-line.l1{transform:rotate(0deg)}.xtj-magic-line.l2{transform:rotate(45deg)}.xtj-magic-line.l3{transform:rotate(90deg)}.xtj-magic-line.l4{transform:rotate(135deg)}.xtj-magic-mirror{position:absolute;width:calc(var(--magic-size)*.30);height:calc(var(--magic-size)*.30);border:1px solid rgba(255,255,255,.82);border-radius:18px 4px 18px 4px;transform:rotate(45deg);background:linear-gradient(135deg,rgba(255,255,255,.74),rgba(191,219,254,.20) 44%,rgba(17,24,39,.03));box-shadow:0 0 30px rgba(125,211,252,.38),inset 0 0 18px rgba(255,255,255,.46);animation:xtjMirrorBreathe 2s ease-in-out infinite;z-index:8}.xtj-magic-mirror:before{content:'';position:absolute;inset:17%;border-radius:12px 3px 12px 3px;border:1px solid rgba(255,255,255,.54);background:linear-gradient(135deg,transparent,rgba(255,255,255,.35),transparent);animation:xtjMirrorGlint 1.8s ease-in-out infinite}.xtj-magic-rune{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px;display:grid;place-items:center;font-size:15px;color:rgba(129,140,248,.72);text-shadow:0 0 18px rgba(129,140,248,.40);transform:rotate(var(--a)) translateY(calc(var(--magic-size)*-.50)) rotate(calc(-1 * var(--a)));animation:xtjRunePulse 1.9s ease-in-out infinite;z-index:6}.xtj-magic-rune.rune-b,.xtj-magic-rune.rune-f{color:rgba(125,211,252,.78);animation-delay:.12s}.xtj-magic-rune.rune-c,.xtj-magic-rune.rune-g{color:rgba(196,181,253,.80);animation-delay:.24s}.xtj-magic-rune.rune-d,.xtj-magic-rune.rune-h{color:rgba(255,255,255,.72);animation-delay:.36s}.xtj-magic-shard{position:absolute;width:10px;height:22px;border-radius:8px 2px 8px 2px;background:linear-gradient(180deg,rgba(255,255,255,.78),rgba(125,211,252,.28));box-shadow:0 0 18px rgba(125,211,252,.28);z-index:5;animation:xtjShardDrift 2.2s ease-in-out infinite}.xtj-magic-shard.h1{left:12%;top:23%;transform:rotate(-24deg);animation-delay:.05s}.xtj-magic-shard.h2{right:13%;top:22%;transform:rotate(26deg);animation-delay:.18s}.xtj-magic-shard.h3{left:18%;bottom:17%;transform:rotate(38deg);animation-delay:.30s}.xtj-magic-shard.h4{right:20%;bottom:16%;transform:rotate(-35deg);animation-delay:.42s}.xtj-magic-mote{position:absolute;width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.88);box-shadow:0 0 16px rgba(125,211,252,.65);z-index:9;animation:xtjMoteRise 1.7s ease-in-out infinite}.xtj-magic-mote.m1{left:16%;bottom:28%;animation-delay:.0s}.xtj-magic-mote.m2{left:29%;top:15%;animation-delay:.18s}.xtj-magic-mote.m3{right:18%;top:34%;animation-delay:.34s}.xtj-magic-mote.m4{right:29%;bottom:14%;animation-delay:.52s}.xtj-magic-mote.m5{left:47%;top:6%;animation-delay:.72s}.xtj-magic-mote.m6{right:44%;bottom:6%;animation-delay:.92s}.xtj-magic-loader:hover .xtj-magic-ring.r1,.xtj-magic-loader.xtj-cast .xtj-magic-ring.r1{animation-duration:2.2s}.xtj-magic-loader:hover .xtj-magic-mirror,.xtj-magic-loader.xtj-cast .xtj-magic-mirror{box-shadow:0 0 42px rgba(125,211,252,.58),0 0 92px rgba(129,140,248,.24),inset 0 0 22px rgba(255,255,255,.56)}.xtj-magic-loader.xtj-cast .xtj-magic-veil{animation-duration:1.4s;opacity:1}.xtj-magic-loader.xtj-cast .xtj-magic-rune{animation-duration:.7s}
      .xtj-chat-loader-title{margin-top:8px;font-size:20px;font-weight:820;letter-spacing:.05em;background:linear-gradient(90deg,rgba(31,41,55,.22),rgba(79,70,229,.78),rgba(14,165,233,.70),rgba(31,41,55,.22));background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:xtjTextGlint 1.8s ease-in-out infinite}.xtj-chat-loader-sub{margin-top:7px;font-size:12px;color:rgba(31,41,55,.34)}.xtj-chat-loader-dots{display:flex;gap:7px;margin-top:12px}.xtj-chat-loader-dots span{width:6px;height:6px;border-radius:50%;background:rgba(79,70,229,.52);box-shadow:0 0 14px rgba(79,70,229,.22);animation:xtjDot 1.05s ease-in-out infinite}.xtj-chat-loader-dots span:nth-child(2){animation-delay:.14s;background:rgba(14,165,233,.58)}.xtj-chat-loader-dots span:nth-child(3){animation-delay:.28s;background:rgba(165,243,252,.62)}.xtj-chat-empty-icon{width:72px;height:72px;border-radius:26px;display:flex;align-items:center;justify-content:center;font-size:31px;background:rgba(255,255,255,.34);border:1px solid rgba(255,255,255,.62);box-shadow:0 18px 46px rgba(79,70,229,.1);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.xtj-chat-empty-title{margin-top:16px;font-size:20px;font-weight:760;color:rgba(31,41,55,.44)}.xtj-chat-empty-sub{margin-top:7px;font-size:13px;color:rgba(31,41,55,.34)}[data-theme="dark"] .xtj-chat-loader-sub,[data-theme="dark"] .xtj-chat-empty-sub{color:rgba(255,255,255,.3)}[data-theme="dark"] .xtj-chat-empty-title{color:rgba(255,255,255,.42)}
      @keyframes xtjAuraBreath{0%,100%{transform:scale(.94);opacity:.55}50%{transform:scale(1.05);opacity:1}}@keyframes xtjGridFade{0%,100%{opacity:.18;transform:scale(.94) rotate(0deg)}50%{opacity:.58;transform:scale(1.04) rotate(12deg)}}@keyframes xtjMagicFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@keyframes xtjMagicCore{0%,100%{transform:scale(.92);opacity:.78}50%{transform:scale(1.04);opacity:1}}@keyframes xtjCoreMist{0%,100%{transform:scale(.92);opacity:.4}50%{transform:scale(1.08);opacity:.78}}@keyframes xtjOuterPulse{0%,100%{transform:scale(.98);opacity:.36}50%{transform:scale(1.04);opacity:.72}}@keyframes xtjMagicSpin{to{transform:rotate(360deg)}}@keyframes xtjMagicSpinReverse{to{transform:rotate(-360deg)}}@keyframes xtjRunePulse{0%,100%{opacity:.38;filter:blur(.25px);transform:rotate(var(--a)) translateY(calc(var(--magic-size)*-.49)) rotate(calc(-1 * var(--a))) scale(.92)}50%{opacity:.94;filter:blur(0);transform:rotate(var(--a)) translateY(calc(var(--magic-size)*-.52)) rotate(calc(-1 * var(--a))) scale(1.05)}}@keyframes xtjMirrorBreathe{0%,100%{transform:rotate(45deg) scale(.94);opacity:.78}50%{transform:rotate(45deg) scale(1.05);opacity:1}}@keyframes xtjMirrorGlint{0%,100%{opacity:.22;transform:translate(-12%,-12%)}50%{opacity:.78;transform:translate(12%,12%)}}@keyframes xtjShardDrift{0%,100%{opacity:.28;filter:blur(.2px)}50%{opacity:.88;filter:blur(0);translate:0 -8px}}@keyframes xtjMoteRise{0%{opacity:0;transform:translate3d(0,12px,0) scale(.55)}45%{opacity:1}100%{opacity:0;transform:translate3d(6px,-18px,0) scale(1.1)}}@keyframes xtjTextGlint{0%,100%{opacity:.72;background-position:0% 50%}50%{opacity:1;background-position:100% 50%}}@keyframes xtjDot{0%,100%{transform:translateY(0);opacity:.42}50%{transform:translateY(-5px);opacity:1}}@media(prefers-reduced-motion:reduce){.xtj-chat-loader:before,.xtj-chat-loader:after,.xtj-magic-loader,.xtj-magic-loader:before,.xtj-magic-loader:after,.xtj-magic-veil,.xtj-magic-ring,.xtj-magic-line,.xtj-magic-rune,.xtj-magic-shard,.xtj-magic-mote,.xtj-magic-mirror,.xtj-chat-loader-title,.xtj-chat-loader-dots span{animation:none!important}}
      #photoPreviewOverlay.photo-preview-overlay{position:fixed!important;inset:0!important;z-index:10000!important;overflow:hidden!important}#photoPreviewOverlay .photo-preview-image-wrapper,#photoPreviewOverlay #ppImageWrapper{position:absolute!important;inset:0!important;z-index:1!important;overflow:hidden!important}#photoPreviewOverlay .photo-preview-close,#photoPreviewOverlay .pp-nav-arrow,#photoPreviewOverlay .pp-info-btn,#photoPreviewOverlay .pp-share-btn,#photoPreviewOverlay .pp-rotate-btn,#photoPreviewOverlay .pp-delete-btn{position:absolute!important;width:42px!important;height:42px!important;min-width:42px!important;min-height:42px!important;padding:0!important;margin:0!important;border-radius:999px!important;display:flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;pointer-events:auto!important;background:rgba(12,18,28,.82)!important;color:rgba(255,255,255,.95)!important;border:1px solid rgba(255,255,255,.12)!important;z-index:40!important}#photoPreviewOverlay .photo-preview-close{top:calc(16px + env(safe-area-inset-top,0px))!important;right:calc(12px + env(safe-area-inset-right,0px))!important}#photoPreviewOverlay .pp-nav-arrow{top:50%!important;transform:translateY(-50%)!important;z-index:35!important}#photoPreviewOverlay .pp-nav-prev{left:calc(12px + env(safe-area-inset-left,0px))!important}#photoPreviewOverlay .pp-nav-next{right:calc(12px + env(safe-area-inset-right,0px))!important}#photoPreviewOverlay .pp-info-btn,#photoPreviewOverlay .pp-share-btn,#photoPreviewOverlay .pp-rotate-btn,#photoPreviewOverlay .pp-delete-btn{bottom:calc(24px + env(safe-area-inset-bottom,0px))!important;top:auto!important}#photoPreviewOverlay .pp-delete-btn{left:calc(16px + env(safe-area-inset-left,0px))!important;color:#fecaca!important;background:rgba(127,29,29,.58)!important}#photoPreviewOverlay .pp-info-btn{left:50%!important;transform:translateX(-50%)!important}#photoPreviewOverlay .pp-rotate-btn{right:calc(68px + env(safe-area-inset-right,0px))!important}#photoPreviewOverlay .pp-share-btn{right:calc(16px + env(safe-area-inset-right,0px))!important}
    `;
    document.head.appendChild(st);
  }

  function loaderHtml(text) {
    return '<div class="xtj-chat-loader" role="status" aria-live="polite"><div class="xtj-magic-loader" aria-hidden="true"><span class="xtj-magic-veil"></span><span class="xtj-magic-ring r4"></span><span class="xtj-magic-ring r1"></span><span class="xtj-magic-ring r2"></span><span class="xtj-magic-ring r3"></span><span class="xtj-magic-ring r5"></span><span class="xtj-magic-line l1"></span><span class="xtj-magic-line l2"></span><span class="xtj-magic-line l3"></span><span class="xtj-magic-line l4"></span><span class="xtj-magic-rune rune-a" style="--a:0deg">ᚨ</span><span class="xtj-magic-rune rune-b" style="--a:45deg">✧</span><span class="xtj-magic-rune rune-c" style="--a:90deg">ᛟ</span><span class="xtj-magic-rune rune-d" style="--a:135deg">✦</span><span class="xtj-magic-rune rune-e" style="--a:180deg">ᚱ</span><span class="xtj-magic-rune rune-f" style="--a:225deg">✧</span><span class="xtj-magic-rune rune-g" style="--a:270deg">ᛉ</span><span class="xtj-magic-rune rune-h" style="--a:315deg">✦</span><span class="xtj-magic-shard h1"></span><span class="xtj-magic-shard h2"></span><span class="xtj-magic-shard h3"></span><span class="xtj-magic-shard h4"></span><span class="xtj-magic-mote m1"></span><span class="xtj-magic-mote m2"></span><span class="xtj-magic-mote m3"></span><span class="xtj-magic-mote m4"></span><span class="xtj-magic-mote m5"></span><span class="xtj-magic-mote m6"></span><span class="xtj-magic-mirror"></span></div><div class="xtj-chat-loader-title">' + esc(text || '加载中...') + '</div><div class="xtj-chat-loader-sub">镜面法阵正在连线</div><div class="xtj-chat-loader-dots"><span></span><span></span><span></span></div></div>';
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

  function installMagicInteraction() {
    if (window.__xtjMagicInteractionInstalled) return;
    window.__xtjMagicInteractionInstalled = true;
    document.addEventListener('pointerdown', function (e) {
      var loader = e.target.closest && e.target.closest('.xtj-magic-loader');
      if (!loader) return;
      loader.classList.remove('xtj-cast');
      void loader.offsetWidth;
      loader.classList.add('xtj-cast');
      clearTimeout(loader._xtjCastTimer);
      loader._xtjCastTimer = setTimeout(function () { loader.classList.remove('xtj-cast'); }, 720);
    }, { passive: true });
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
    addStyle(); patchToast(); patchChat(); installMagicInteraction(); reportsAndProfile(); photoInfoAnim(); repairVisibleText(document.body); repairChat(); repairToasts();
    var obs = new MutationObserver(function () { clearTimeout(obs._t); obs._t = setTimeout(function () { repairVisibleText(document.body); repairChat(); repairToasts(); patchChat(); patchToast(); photoInfoAnim(); }, 60); });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder'] });
    setTimeout(function () { repairVisibleText(document.body); repairChat(); repairToasts(); }, 160);
    setTimeout(function () { repairVisibleText(document.body); repairChat(); repairToasts(); }, 700);
    setInterval(function () { repairVisibleText(document.body); repairChat(); repairToasts(); }, 1800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
