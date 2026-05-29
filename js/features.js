(function () {
  'use strict';
  if (window.__xtjFeaturesSafeV8) return;
  window.__xtjFeaturesSafeV8 = true;

  var listSnapshot = '';
  var loadingTimers = {};

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
    ['鍏抽棴棰勮', '关闭预览'], ['涓婁竴寮?', '上一张'], ['涓嬩竴寮?', '下一张'], ['鍒嗕韩', '分享'], ['鏃嬭浆 90 搴?', '旋转 90 度'], ['旋转 90 搴?', '旋转 90 度'],
    ['鐓х墖璇︽儏', '照片详情'], ['鐓х墖淇℃伅', '照片信息'], ['鐓х墖澧', '照片墙'], ['鐓х墖', '照片'],
    ['浣滆€?', '作者'], ['浣滆€', '作者'], ['鏃堕棿', '时间'], ['娴忚', '浏览'], ['澶у皬', '大小'], ['鏂囦欢淇℃伅', '文件信息'], ['鏂囦欢', '文件'],
    ['璁惧', '设备'], ['鍏夊湀', '光圈'], ['蹇棬', '快门'], ['鐒﹁窛', '焦距'],
    ['楂樻竻鍥惧姞杞藉け璐ワ紝宸叉樉绀洪瑙堝浘', '高清图加载失败，已显示预览图'], ['楂樻竻', '高清'], ['宸叉樉绀洪瑙堝浘', '已显示预览图'],
    ['浠呬笂浼犺€呭彲鍒犻櫎', '仅上传者可删除'], ['鍒犻櫎鐓х墖', '删除照片'], ['鍒犻櫎澶辫触', '删除失败'], ['鍒犻櫎', '删除'],
    ['纭畾鍒犻櫎杩欏紶鐓х墖鍚楋紵', '确定删除这张照片吗？'], ['纭畾瑕佸垹闄よ繖鏉″叕鍛婂悧锛', '确定要删除这条公告吗？'], ['纭鍒犻櫎', '确认删除'], ['纭删除', '确认删除'], ['纭', '确认'], ['纭畾', '确定'],
    ['鍙栨秷', '取消'], ['鎻愴氦', '提交'], ['鎻愳氦', '提交'], ['鎻愪氦', '提交'], ['澶辫触', '失败'], ['成功', '成功'], ['鏈煡閿欒', '未知错误'], ['閿欒', '错误'],
    ['缂栬緫', '编辑'], ['鐐硅禐', '点赞'], ['璇勮', '评论'], ['鏃犳潈', '无权'], ['甯栧瓙', '帖子'], ['鍙戝笘', '发帖'],
    ['鍏憡发布成功', '公告发布成功'], ['删除鍏憡', '删除公告'], ['加载鍏憡失败', '加载公告失败'], ['鍏憡', '公告'],
    ['璇疯嚦灏戝～鍐欐爣棰樻垨内容', '请至少填写标题或内容'], ['鏍囬', '标题'], ['内容', '内容'],
    ['鏇存柊内容', '更新内容'], ['淇内容', '修复内容'], ['浼樺寲内容', '优化内容'], ['鏇存柊', '更新'], ['淇', '修复'], ['浼樺寲', '优化'],
    ['缁熻', '统计'], ['璇︽儏', '详情'], ['娉勯湶', '泄露'], ['浜掑姩', '互动'], ['棰勮', '预览'], ['鍙屽嚮', '双击'], ['缂╁皬', '缩小'], ['鍙屾寚', '双指'], ['缂╂斁', '缩放'], ['涓嶇ǔ瀹', '不稳定'],
    ['缂╃暐', '缩略'], ['鍔熻兘', '功能'], ['涓庝氦浜', '与交互'], ['寮圭獥', '弹窗'], ['閫忔槑', '透明'], ['鐜荤拑', '玻璃'], ['鏁堟灉', '效果'], ['鎸夐挳', '按钮'], ['鐐瑰嚮', '点击'], ['鏃犲搷搴', '无响应'],
    ['瀛楁', '字段'], ['鍚嶅尮閰', '名匹配'], ['閫氱煡', '通知'], ['寮€鍏', '开关'], ['涓嶄竴鑷', '不一致'], ['鏉冮檺', '权限'], ['妫€鏌', '检查'], ['涓婁紶', '上传'], ['鍘婚櫎', '去除']
  ];

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fixText(v) {
    var s = String(v == null ? '' : v);
    MOJIBAKE_PAIRS.forEach(function (p) { s = s.split(p[0]).join(p[1]); });
    s = s.replace(/鏄\s*ㄥ\s*ぉ/g, '昨天');
    s = s.replace(/鑽\s*(?:ㄥ|ん)\s*お/g, '昨天');
    s = s.replace(/昨天\s+/g, '昨天 ');
    s = s.replace(/宸茶?\s*[读讀]*/g, '已读');
    s = s.replace(/鏈?\s*[读讀]*/g, '未读');
    return s;
  }
  window.xtjFixText = fixText;

  function bad(v) {
    return /(鏄|鑽|んお|加载涓|加载娑|鍔犺浇|鈴|馃|鈿|鉂|刷新瀹|姝ｅ湪刷新|鏆傛棤|鍙戦€|娑堟伅|鐧诲綍|缂栬緫|鐐硅禐|璇勮|鍒犻櫎|纭?|纭|鐓х墖|浣滆|鏃堕棿|澶у皬|鍏憡|鏇存柊|淇|浼樺寲|瀛楁|閫氱煡|寮€|涓婁紶|楂樻竻|鏈煡|宸茶|鏈)/.test(String(v || ''));
  }

  function addStyle() {
    var old = document.getElementById('xtjSafeFeatureFixStyle');
    if (old) old.remove();
    var st = document.createElement('style');
    st.id = 'xtjSafeFeatureFixStyle';
    st.textContent = `
      .toast-container{z-index:12000!important;gap:10px!important;max-width:min(92vw,520px)!important}.toast{display:inline-flex!important;align-items:center!important;justify-content:center!important;min-width:78px!important;min-height:38px!important;max-width:min(88vw,420px)!important;padding:10px 18px!important;border-radius:999px!important;background:rgba(18,24,32,.88)!important;color:rgba(255,255,255,.97)!important;border:1px solid rgba(255,255,255,.15)!important;box-shadow:0 14px 40px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.16)!important;backdrop-filter:blur(18px) saturate(160%)!important;-webkit-backdrop-filter:blur(18px) saturate(160%)!important;font-size:14px!important;font-weight:650!important;line-height:1.35!important;text-align:center!important}.toast:empty{display:none!important}
      .xtj-chat-loader,.xtj-chat-empty{min-height:58vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:34px 18px;color:var(--text-muted);position:relative;overflow:hidden}.xtj-chat-loader:before{content:'';position:absolute;width:min(92vw,520px);height:min(92vw,520px);border-radius:50%;background:radial-gradient(circle,rgba(80,145,255,.12),rgba(36,211,255,.07) 34%,transparent 70%);filter:blur(24px);opacity:.96;animation:xtjPortalAura 3.2s ease-in-out infinite;pointer-events:none}.xtj-chat-loader:after{content:'';position:absolute;top:50%;left:50%;width:min(78vw,380px);height:min(78vw,380px);transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,transparent 52%,rgba(125,211,252,.10) 53%,transparent 55%),linear-gradient(90deg,transparent 49.6%,rgba(191,219,254,.12) 50%,transparent 50.4%),linear-gradient(0deg,transparent 49.6%,rgba(191,219,254,.10) 50%,transparent 50.4%);opacity:.55;animation:xtjPortalGrid 4.8s ease-in-out infinite;pointer-events:none}
      .xtj-spell-loader{--s:clamp(172px,25vw,216px);width:var(--s);height:var(--s);position:relative;display:grid;place-items:center;isolation:isolate;z-index:2;cursor:pointer;-webkit-tap-highlight-color:transparent;filter:drop-shadow(0 30px 70px rgba(37,99,235,.22));animation:xtjSpellHover 3s ease-in-out infinite}.xtj-spell-loader.xtj-cast,.xtj-spell-loader:hover{filter:drop-shadow(0 38px 90px rgba(37,99,235,.34))}.xtj-spell-gate{position:absolute;inset:4%;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.18),transparent 46%),conic-gradient(from -25deg,transparent 0 24deg,rgba(147,197,253,.42) 24deg 38deg,transparent 38deg 92deg,rgba(196,181,253,.28) 92deg 108deg,transparent 108deg 184deg,rgba(125,211,252,.34) 184deg 202deg,transparent 202deg 360deg);-webkit-mask:radial-gradient(circle,transparent 56%,#000 57% 63%,transparent 65%);mask:radial-gradient(circle,transparent 56%,#000 57% 63%,transparent 65%);animation:xtjGateTurn 8s linear infinite}.xtj-spell-orbit{position:absolute;border-radius:50%;border:1px solid rgba(147,197,253,.42);box-shadow:inset 0 0 24px rgba(125,211,252,.07)}.xtj-spell-orbit.o1{inset:0;animation:xtjOrbit 9s linear infinite}.xtj-spell-orbit.o2{inset:13%;border-style:dashed;border-color:rgba(196,181,253,.42);animation:xtjOrbitReverse 6.5s linear infinite}.xtj-spell-orbit.o3{inset:28%;border-color:rgba(255,255,255,.36);animation:xtjOrbit 4.8s linear infinite}.xtj-spell-orbit.o4{inset:43%;border-color:rgba(125,211,252,.34);animation:xtjOrbitReverse 3.4s linear infinite}.xtj-spell-core{position:absolute;width:34%;height:34%;border-radius:44% 56% 42% 58%;background:radial-gradient(circle at 45% 32%,rgba(255,255,255,.98),rgba(191,219,254,.48) 34%,rgba(56,189,248,.16) 60%,rgba(15,23,42,0) 76%);box-shadow:0 0 34px rgba(125,211,252,.44),0 0 86px rgba(99,102,241,.20),inset 0 0 20px rgba(255,255,255,.50);animation:xtjCoreMorph 2.2s ease-in-out infinite;z-index:8}.xtj-spell-core:after{content:'';position:absolute;inset:25%;border-radius:inherit;border:1px solid rgba(255,255,255,.52);background:linear-gradient(135deg,transparent,rgba(255,255,255,.44),transparent);animation:xtjCoreGlint 2.1s ease-in-out infinite}.xtj-spell-beam{position:absolute;top:-14%;bottom:-14%;left:50%;width:2px;transform:translateX(-50%);background:linear-gradient(to bottom,transparent,rgba(255,255,255,.56),rgba(125,211,252,.40),transparent);box-shadow:0 0 18px rgba(125,211,252,.42);opacity:.45;animation:xtjBeam 2.4s ease-in-out infinite;z-index:1}.xtj-spell-cut{position:absolute;left:50%;top:50%;width:1px;height:96%;transform-origin:50% 0;background:linear-gradient(to bottom,transparent,rgba(147,197,253,.24),transparent);z-index:1}.xtj-spell-cut.c1{transform:rotate(30deg)}.xtj-spell-cut.c2{transform:rotate(90deg)}.xtj-spell-cut.c3{transform:rotate(150deg)}.xtj-spell-rune{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px;display:grid;place-items:center;font-size:15px;color:rgba(191,219,254,.72);text-shadow:0 0 18px rgba(125,211,252,.40);transform:rotate(var(--a)) translateY(calc(var(--s)*-.52)) rotate(calc(-1 * var(--a)));animation:xtjRune 2.6s ease-in-out infinite;z-index:7}.xtj-spell-rune.r2,.xtj-spell-rune.r5{color:rgba(196,181,253,.76);animation-delay:.18s}.xtj-spell-rune.r3,.xtj-spell-rune.r6{color:rgba(125,211,252,.78);animation-delay:.36s}.xtj-spell-rune.r4,.xtj-spell-rune.r8{color:rgba(255,255,255,.68);animation-delay:.54s}.xtj-spell-shard{position:absolute;width:10px;height:24px;border-radius:10px 2px 10px 2px;background:linear-gradient(180deg,rgba(255,255,255,.82),rgba(125,211,252,.28));box-shadow:0 0 20px rgba(125,211,252,.30);z-index:5;animation:xtjShard 2.8s ease-in-out infinite}.xtj-spell-shard.s1{left:13%;top:22%;transform:rotate(-22deg);animation-delay:.05s}.xtj-spell-shard.s2{right:13%;top:21%;transform:rotate(24deg);animation-delay:.25s}.xtj-spell-shard.s3{left:18%;bottom:16%;transform:rotate(38deg);animation-delay:.45s}.xtj-spell-shard.s4{right:19%;bottom:16%;transform:rotate(-36deg);animation-delay:.65s}.xtj-spell-mote{position:absolute;width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.92);box-shadow:0 0 16px rgba(125,211,252,.75);z-index:9;animation:xtjMote 2s ease-in-out infinite}.xtj-spell-mote.m1{left:15%;bottom:30%;animation-delay:.05s}.xtj-spell-mote.m2{left:30%;top:13%;animation-delay:.24s}.xtj-spell-mote.m3{right:15%;top:33%;animation-delay:.42s}.xtj-spell-mote.m4{right:30%;bottom:12%;animation-delay:.62s}.xtj-spell-mote.m5{left:48%;top:4%;animation-delay:.82s}.xtj-spell-mote.m6{right:45%;bottom:5%;animation-delay:1s}.xtj-spell-loader.xtj-cast .xtj-spell-gate{animation-duration:1.25s}.xtj-spell-loader.xtj-cast .xtj-spell-orbit.o1{animation-duration:1.55s}.xtj-spell-loader.xtj-cast .xtj-spell-core{box-shadow:0 0 48px rgba(125,211,252,.62),0 0 110px rgba(99,102,241,.30),inset 0 0 24px rgba(255,255,255,.64)}.xtj-spell-loader.xtj-cast .xtj-spell-beam{opacity:.9;width:3px}.xtj-spell-loader.xtj-cast .xtj-spell-rune{animation-duration:.85s}
      .xtj-chat-loader-title{margin-top:8px;font-size:20px;font-weight:820;letter-spacing:.05em;background:linear-gradient(90deg,rgba(31,41,55,.22),rgba(59,130,246,.76),rgba(14,165,233,.70),rgba(31,41,55,.22));background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:xtjTextGlint 2s ease-in-out infinite}.xtj-chat-loader-sub{margin-top:7px;font-size:12px;color:rgba(31,41,55,.34)}.xtj-chat-loader-dots{display:flex;gap:7px;margin-top:12px}.xtj-chat-loader-dots span{width:6px;height:6px;border-radius:50%;background:rgba(59,130,246,.54);box-shadow:0 0 14px rgba(59,130,246,.22);animation:xtjDot 1.1s ease-in-out infinite}.xtj-chat-loader-dots span:nth-child(2){animation-delay:.14s;background:rgba(14,165,233,.60)}.xtj-chat-loader-dots span:nth-child(3){animation-delay:.28s;background:rgba(191,219,254,.70)}.xtj-chat-empty-icon{width:72px;height:72px;border-radius:26px;display:flex;align-items:center;justify-content:center;font-size:31px;background:rgba(255,255,255,.34);border:1px solid rgba(255,255,255,.62);box-shadow:0 18px 46px rgba(59,130,246,.1);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.xtj-chat-empty-title{margin-top:16px;font-size:20px;font-weight:760;color:rgba(31,41,55,.44)}.xtj-chat-empty-sub{margin-top:7px;font-size:13px;color:rgba(31,41,55,.34)}[data-theme="dark"] .xtj-chat-loader-sub,[data-theme="dark"] .xtj-chat-empty-sub{color:rgba(255,255,255,.3)}[data-theme="dark"] .xtj-chat-empty-title{color:rgba(255,255,255,.42)}
      @keyframes xtjPortalAura{0%,100%{transform:scale(.94);opacity:.50}50%{transform:scale(1.05);opacity:1}}@keyframes xtjPortalGrid{0%,100%{opacity:.18;transform:translate(-50%,-50%) scale(.95) rotate(0deg)}50%{opacity:.52;transform:translate(-50%,-50%) scale(1.04) rotate(10deg)}}@keyframes xtjSpellHover{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@keyframes xtjGateTurn{to{transform:rotate(360deg)}}@keyframes xtjOrbit{to{transform:rotate(360deg)}}@keyframes xtjOrbitReverse{to{transform:rotate(-360deg)}}@keyframes xtjCoreMorph{0%,100%{transform:scale(.94) rotate(0deg);opacity:.84;border-radius:44% 56% 42% 58%}50%{transform:scale(1.06) rotate(8deg);opacity:1;border-radius:58% 42% 56% 44%}}@keyframes xtjCoreGlint{0%,100%{opacity:.20;transform:translate(-12%,-12%)}50%{opacity:.76;transform:translate(12%,12%)}}@keyframes xtjBeam{0%,100%{opacity:.28;transform:translateX(-50%) scaleY(.88)}50%{opacity:.82;transform:translateX(-50%) scaleY(1.04)}}@keyframes xtjRune{0%,100%{opacity:.34;filter:blur(.25px);transform:rotate(var(--a)) translateY(calc(var(--s)*-.50)) rotate(calc(-1 * var(--a))) scale(.92)}50%{opacity:.96;filter:blur(0);transform:rotate(var(--a)) translateY(calc(var(--s)*-.54)) rotate(calc(-1 * var(--a))) scale(1.07)}}@keyframes xtjShard{0%,100%{opacity:.25;filter:blur(.2px)}50%{opacity:.86;filter:blur(0);translate:0 -9px}}@keyframes xtjMote{0%{opacity:0;transform:translate3d(0,13px,0) scale(.55)}45%{opacity:1}100%{opacity:0;transform:translate3d(7px,-20px,0) scale(1.08)}}@keyframes xtjTextGlint{0%,100%{opacity:.72;background-position:0% 50%}50%{opacity:1;background-position:100% 50%}}@keyframes xtjDot{0%,100%{transform:translateY(0);opacity:.42}50%{transform:translateY(-5px);opacity:1}}@media(prefers-reduced-motion:reduce){.xtj-chat-loader:before,.xtj-chat-loader:after,.xtj-spell-loader,.xtj-spell-loader *,.xtj-chat-loader-title,.xtj-chat-loader-dots span{animation:none!important}}
      #photoPreviewOverlay.photo-preview-overlay{position:fixed!important;inset:0!important;z-index:10000!important;overflow:hidden!important}#photoPreviewOverlay .photo-preview-image-wrapper,#photoPreviewOverlay #ppImageWrapper{position:absolute!important;inset:0!important;z-index:1!important;overflow:hidden!important}#photoPreviewOverlay .photo-preview-close,#photoPreviewOverlay .pp-nav-arrow,#photoPreviewOverlay .pp-info-btn,#photoPreviewOverlay .pp-share-btn,#photoPreviewOverlay .pp-rotate-btn,#photoPreviewOverlay .pp-delete-btn{position:absolute!important;width:42px!important;height:42px!important;min-width:42px!important;min-height:42px!important;padding:0!important;margin:0!important;border-radius:999px!important;display:flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;pointer-events:auto!important;background:rgba(12,18,28,.82)!important;color:rgba(255,255,255,.95)!important;border:1px solid rgba(255,255,255,.12)!important;z-index:40!important}#photoPreviewOverlay .photo-preview-close{top:calc(16px + env(safe-area-inset-top,0px))!important;right:calc(12px + env(safe-area-inset-right,0px))!important}#photoPreviewOverlay .pp-nav-arrow{top:50%!important;transform:translateY(-50%)!important;z-index:35!important}#photoPreviewOverlay .pp-nav-prev{left:calc(12px + env(safe-area-inset-left,0px))!important}#photoPreviewOverlay .pp-nav-next{right:calc(12px + env(safe-area-inset-right,0px))!important}#photoPreviewOverlay .pp-info-btn,#photoPreviewOverlay .pp-share-btn,#photoPreviewOverlay .pp-rotate-btn,#photoPreviewOverlay .pp-delete-btn{bottom:calc(24px + env(safe-area-inset-bottom,0px))!important;top:auto!important}#photoPreviewOverlay .pp-delete-btn{left:calc(16px + env(safe-area-inset-left,0px))!important;color:#fecaca!important;background:rgba(127,29,29,.58)!important}#photoPreviewOverlay .pp-info-btn{left:50%!important;transform:translateX(-50%)!important}#photoPreviewOverlay .pp-rotate-btn{right:calc(68px + env(safe-area-inset-right,0px))!important}#photoPreviewOverlay .pp-share-btn{right:calc(16px + env(safe-area-inset-right,0px))!important}
    `;
    document.head.appendChild(st);
  }

  function loaderHtml(text) {
    return '<div class="xtj-chat-loader" role="status" aria-live="polite"><div class="xtj-spell-loader" aria-hidden="true"><span class="xtj-spell-gate"></span><span class="xtj-spell-orbit o1"></span><span class="xtj-spell-orbit o2"></span><span class="xtj-spell-orbit o3"></span><span class="xtj-spell-orbit o4"></span><span class="xtj-spell-beam"></span><span class="xtj-spell-cut c1"></span><span class="xtj-spell-cut c2"></span><span class="xtj-spell-cut c3"></span><span class="xtj-spell-rune r1" style="--a:0deg">A</span><span class="xtj-spell-rune r2" style="--a:45deg">*</span><span class="xtj-spell-rune r3" style="--a:90deg">O</span><span class="xtj-spell-rune r4" style="--a:135deg">+</span><span class="xtj-spell-rune r5" style="--a:180deg">R</span><span class="xtj-spell-rune r6" style="--a:225deg">*</span><span class="xtj-spell-rune r7" style="--a:270deg">Y</span><span class="xtj-spell-rune r8" style="--a:315deg">+</span><span class="xtj-spell-shard s1"></span><span class="xtj-spell-shard s2"></span><span class="xtj-spell-shard s3"></span><span class="xtj-spell-shard s4"></span><span class="xtj-spell-mote m1"></span><span class="xtj-spell-mote m2"></span><span class="xtj-spell-mote m3"></span><span class="xtj-spell-mote m4"></span><span class="xtj-spell-mote m5"></span><span class="xtj-spell-mote m6"></span><span class="xtj-spell-core"></span></div><div class="xtj-chat-loader-title">' + esc(text || '加载中...') + '</div><div class="xtj-chat-loader-sub">正在开启传送门</div><div class="xtj-chat-loader-dots"><span></span><span></span><span></span></div></div>';
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
      if (node.id === 'dockChatList' && listSnapshot) node.innerHTML = listSnapshot;
      else node.innerHTML = emptyHtml(node.id === 'dockChatMessages' ? 'detail' : 'list');
      repairVisibleText(node);
    }, 2600);
  }

  function repairChatArea(el) {
    if (!el) return;
    if (el.querySelector('.chat-list-item')) { if (el.id === 'dockChatList') listSnapshot = el.innerHTML; repairVisibleText(el); return; }
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

  function repairReadUnread(root) {
    root = root || document.body;
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[class*="read"],[class*="status"],[class*="meta"],[class*="time"],.chat-msg,.chat-list-item').forEach(function(el) {
      if (!el || !bad(el.textContent)) return;
      if (el.childElementCount === 0) el.textContent = fixText(el.textContent);
    });
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
    if (typeof window.showToast !== 'function' || window.showToast.__xtjPatchedV8) return;
    var old = window.showToast;
    window.showToast = function (msg) {
      msg = fixText(msg == null ? '' : String(msg)).trim() || '操作完成';
      var r = old.call(this, msg);
      setTimeout(repairToasts, 0); setTimeout(repairToasts, 160);
      return r;
    };
    window.showToast.__xtjPatchedV8 = true;
  }

  function patchChat() {
    if (typeof window.openChat === 'function' && !window.openChat.__xtjPatchedV8) {
      var oldOpen = window.openChat;
      window.openChat = function () { var r = oldOpen.apply(this, arguments); setTimeout(repairChat, 0); setTimeout(repairChat, 120); setTimeout(repairChat, 360); setTimeout(repairChat, 900); return r; };
      window.openChat.__xtjPatchedV8 = true;
    }
    if (typeof window.switchDockTab === 'function' && !window.switchDockTab.__xtjPatchedV8) {
      var oldSwitch = window.switchDockTab;
      window.switchDockTab = function (tab, skip) { var r = oldSwitch.apply(this, arguments); if (tab === 'chat') { setTimeout(repairChat, 0); setTimeout(repairChat, 120); setTimeout(repairChat, 360); setTimeout(repairChat, 900); } setTimeout(repairToasts, 0); return r; };
      window.switchDockTab.__xtjPatchedV8 = true;
    }
  }

  function installMagicInteraction() {
    if (window.__xtjMagicInteractionInstalledV8) return;
    window.__xtjMagicInteractionInstalledV8 = true;
    document.addEventListener('pointerdown', function (e) {
      var loader = e.target.closest && e.target.closest('.xtj-spell-loader');
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
      root.querySelectorAll('[title],[aria-label],[placeholder],[alt]').forEach(function (el) {
        ['title', 'aria-label', 'placeholder', 'alt'].forEach(function (attr) {
          var v = el.getAttribute(attr);
          if (bad(v)) el.setAttribute(attr, fixText(v));
        });
      });
    }
    repairReadUnread(root);
  }

  function photoInfoAnim() {
    if (window.__xtjPhotoInfoAnimationFixInstalledV8 || typeof window.showPhotoInfo !== 'function') return;
    window.__xtjPhotoInfoAnimationFixInstalledV8 = true;
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
    var obs = new MutationObserver(function () { clearTimeout(obs._t); obs._t = setTimeout(function () { repairVisibleText(document.body); repairChat(); repairToasts(); patchChat(); patchToast(); photoInfoAnim(); }, 45); });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder', 'alt'] });
    setTimeout(function () { repairVisibleText(document.body); repairChat(); repairToasts(); }, 160);
    setTimeout(function () { repairVisibleText(document.body); repairChat(); repairToasts(); }, 700);
    setInterval(function () { repairVisibleText(document.body); repairChat(); repairToasts(); }, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
