(function () {
  'use strict';
  if (window.__xtjFeaturesSafeV2) return;
  window.__xtjFeaturesSafeV2 = true;

  var chatListSnapshot = '';
  var loadingTimers = {};

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fixText(v) {
    var s = String(v == null ? '' : v);
    [
      ['加载涓?..', '加载中...'], ['加载娑?..', '加载中...'], ['鍔犺浇涓?..', '加载中...'], ['鍔犺浇', '加载'],
      ['姝ｅ湪刷新鐓х墖澧?..', '正在刷新照片墙...'], ['姝ｅ湪刷新...', '正在刷新...'], ['刷新瀹屾垚', '已刷新'], ['鍒锋柊瀹屾垚', '已刷新'],
      ['鏆傛棤娑堟伅', '暂无消息'], ['鍦ㄥ笘瀛愰〉闈㈢偣鍑诲ご鍍忓紑濮嬭亰澶?', '在帖子页面点击头像开始聊天'], ['鍙戦€佺涓€鏉℃秷鎭惂', '发送第一条消息吧'], ['娑堟伅', '消息'],
      ['鈴?/div><div>', ''], ['鈴?', ''], ['鈴', ''], ['馃挰', ''], ['鈿狅笍', ''], ['鉂わ笍', '❤️'], ['请先鐧诲綍', '请先登录'],
      ['宸茶', '已读'], ['鏈', '未读'], ['纭删除', '确认删除'], ['纭', '确认'], ['缂栬緫', '编辑'], ['鍒犻櫎', '删除'], ['鐐硅禐', '点赞'], ['璇勮', '评论'], ['娴忚', '浏览'], ['鏆傛棤', '暂无'], ['鏃犳潈', '无权'], ['甯栧瓙', '帖子'], ['鐧诲綍', '登录'], ['锛岃', '，请'], ['閲嶈瘯', '重试'], ['鍙栨秷', '取消'], ['鎻愪氦', '提交'], ['澶辫触', '失败'], ['鏈煡閿欒', '未知错误'],
      ['鐓х墖璇︽儏', '照片详情'], ['鐓х墖淇℃伅', '照片信息'], ['浣滆€?', '作者'], ['浣滆€', '作者'], ['鏃堕棿', '时间'], ['澶у皬', '大小'], ['鏂囦欢淇℃伅', '文件信息']
    ].forEach(function (p) { s = s.split(p[0]).join(p[1]); });
    return s;
  }

  function bad(v) {
    return /(加载涓|加载娑|鍔犺浇|鈴|馃|鈿|鉂|刷新瀹|姝ｅ湪刷新|鏆傛棤娑|鍙戦€|娑堟伅|鐧诲綍|缂栬緫|鐐硅禐|璇勮|鍒犻櫎|纭|鐓х墖|浣滆|鏃堕棿|澶у皬)/.test(String(v || ''));
  }

  function addStyle() {
    var old = document.getElementById('xtjSafeFeatureFixStyle');
    if (old) old.remove();
    var st = document.createElement('style');
    st.id = 'xtjSafeFeatureFixStyle';
    st.textContent = `
      .toast-container{z-index:12000!important;gap:10px!important;max-width:min(92vw,520px)!important}.toast{display:inline-flex!important;align-items:center!important;justify-content:center!important;min-width:78px!important;min-height:38px!important;max-width:min(88vw,420px)!important;padding:10px 18px!important;border-radius:999px!important;background:rgba(18,24,32,.88)!important;color:rgba(255,255,255,.97)!important;border:1px solid rgba(255,255,255,.15)!important;box-shadow:0 14px 40px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.16)!important;backdrop-filter:blur(18px) saturate(160%)!important;-webkit-backdrop-filter:blur(18px) saturate(160%)!important;font-size:14px!important;font-weight:650!important;line-height:1.35!important;text-align:center!important}.toast:empty{display:none!important}
      .xtj-chat-loader,.xtj-chat-empty{min-height:52vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px 18px;color:var(--text-muted)}
      .xtj-magic-loader{width:96px;height:96px;position:relative;display:grid;place-items:center;isolation:isolate;filter:drop-shadow(0 18px 38px rgba(124,58,237,.22));animation:xtjMagicFloat 1.45s ease-in-out infinite}.xtj-magic-loader:before{content:'';position:absolute;inset:20px;border-radius:50%;background:radial-gradient(circle at 50% 50%,rgba(255,255,255,.96),rgba(255,255,255,.22) 42%,transparent 66%),radial-gradient(circle at 36% 30%,rgba(236,72,153,.50),transparent 54%),radial-gradient(circle at 66% 70%,rgba(34,211,238,.48),transparent 56%);box-shadow:0 0 26px rgba(168,85,247,.38),0 0 52px rgba(34,211,238,.18),inset 0 1px 0 rgba(255,255,255,.85);animation:xtjMagicCore 1s ease-in-out infinite;z-index:3}.xtj-magic-ring{position:absolute;inset:5px;border-radius:50%;border:1.5px solid rgba(168,85,247,.46);background:conic-gradient(from 0deg,transparent 0 16deg,rgba(236,72,153,.78) 16deg 28deg,transparent 28deg 74deg,rgba(34,211,238,.70) 74deg 88deg,transparent 88deg 145deg,rgba(250,204,21,.70) 145deg 158deg,transparent 158deg 360deg);-webkit-mask:radial-gradient(circle,transparent 54%,#000 56% 67%,transparent 69%);mask:radial-gradient(circle,transparent 54%,#000 56% 67%,transparent 69%);animation:xtjMagicSpin .85s linear infinite;z-index:2}.xtj-magic-ring.r2{inset:17px;opacity:.72;border-color:rgba(34,211,238,.42);animation:xtjMagicSpinReverse 1.15s linear infinite}.xtj-magic-rune{position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px;display:grid;place-items:center;font-size:14px;color:rgba(139,92,246,.72);text-shadow:0 0 18px rgba(139,92,246,.48);transform:rotate(var(--a)) translateY(-48px) rotate(calc(-1 * var(--a)));animation:xtjRunePulse .8s ease-in-out infinite}.xtj-magic-rune:nth-child(4){color:rgba(34,211,238,.76);animation-delay:.1s}.xtj-magic-rune:nth-child(5){color:rgba(236,72,153,.76);animation-delay:.2s}.xtj-magic-rune:nth-child(6){color:rgba(250,204,21,.76);animation-delay:.3s}.xtj-magic-spark{position:absolute;width:5px;height:5px;border-radius:50%;background:currentColor;color:rgba(34,211,238,.9);box-shadow:0 0 16px currentColor;animation:xtjSpark .75s ease-in-out infinite;z-index:4}.xtj-magic-spark.s1{left:17px;top:22px}.xtj-magic-spark.s2{right:14px;top:31px;color:rgba(236,72,153,.9);animation-delay:.18s}.xtj-magic-spark.s3{left:29px;bottom:14px;color:rgba(250,204,21,.88);animation-delay:.32s}.xtj-chat-loader-title{margin-top:14px;font-size:19px;font-weight:780;letter-spacing:.03em;background:linear-gradient(90deg,rgba(31,41,55,.28),rgba(124,58,237,.72),rgba(34,211,238,.66),rgba(31,41,55,.28));-webkit-background-clip:text;background-clip:text;color:transparent;animation:xtjTextGlint 1s ease-in-out infinite}.xtj-chat-loader-sub{margin-top:6px;font-size:12px;color:rgba(31,41,55,.32)}.xtj-chat-loader-dots{display:flex;gap:6px;margin-top:10px}.xtj-chat-loader-dots span{width:6px;height:6px;border-radius:50%;background:rgba(124,58,237,.6);box-shadow:0 0 14px rgba(124,58,237,.24);animation:xtjDot .75s ease-in-out infinite}.xtj-chat-loader-dots span:nth-child(2){animation-delay:.1s;background:rgba(34,211,238,.66)}.xtj-chat-loader-dots span:nth-child(3){animation-delay:.2s;background:rgba(236,72,153,.64)}.xtj-chat-empty-icon{width:72px;height:72px;border-radius:26px;display:flex;align-items:center;justify-content:center;font-size:31px;background:rgba(255,255,255,.34);border:1px solid rgba(255,255,255,.62);box-shadow:0 18px 46px rgba(124,58,237,.1);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.xtj-chat-empty-title{margin-top:16px;font-size:20px;font-weight:760;color:rgba(31,41,55,.44)}.xtj-chat-empty-sub{margin-top:7px;font-size:13px;color:rgba(31,41,55,.34)}[data-theme="dark"] .xtj-chat-loader-sub,[data-theme="dark"] .xtj-chat-empty-sub{color:rgba(255,255,255,.3)}[data-theme="dark"] .xtj-chat-empty-title{color:rgba(255,255,255,.42)}
      @keyframes xtjMagicFloat{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-5px) scale(1.02)}}@keyframes xtjMagicCore{0%,100%{transform:scale(.92);opacity:.74}50%{transform:scale(1.04);opacity:1}}@keyframes xtjMagicSpin{to{transform:rotate(360deg)}}@keyframes xtjMagicSpinReverse{to{transform:rotate(-360deg)}}@keyframes xtjRunePulse{0%,100%{opacity:.38;filter:blur(.2px)}50%{opacity:1;filter:blur(0)}}@keyframes xtjSpark{0%,100%{transform:translate3d(0,0,0) scale(.64);opacity:.25}50%{transform:translate3d(4px,-7px,0) scale(1.15);opacity:1}}@keyframes xtjTextGlint{0%,100%{opacity:.62;background-position:0% 50%}50%{opacity:1;background-position:100% 50%}}@keyframes xtjDot{0%,100%{transform:translateY(0);opacity:.42}50%{transform:translateY(-5px);opacity:1}}@media(prefers-reduced-motion:reduce){.xtj-magic-loader,.xtj-magic-ring,.xtj-magic-loader:before,.xtj-magic-rune,.xtj-magic-spark,.xtj-chat-loader-title,.xtj-chat-loader-dots span{animation:none!important}}
      #photoPreviewOverlay.photo-preview-overlay{position:fixed!important;inset:0!important;z-index:10000!important;overflow:hidden!important}#photoPreviewOverlay .photo-preview-image-wrapper,#photoPreviewOverlay #ppImageWrapper{position:absolute!important;inset:0!important;z-index:1!important;overflow:hidden!important}#photoPreviewOverlay .photo-preview-close,#photoPreviewOverlay .pp-nav-arrow,#photoPreviewOverlay .pp-info-btn,#photoPreviewOverlay .pp-share-btn,#photoPreviewOverlay .pp-rotate-btn,#photoPreviewOverlay .pp-delete-btn{position:absolute!important;width:42px!important;height:42px!important;min-width:42px!important;min-height:42px!important;padding:0!important;margin:0!important;border-radius:999px!important;display:flex!important;align-items:center!important;justify-content:center!important;box-sizing:border-box!important;pointer-events:auto!important;background:rgba(12,18,28,.82)!important;color:rgba(255,255,255,.95)!important;border:1px solid rgba(255,255,255,.12)!important;z-index:40!important}#photoPreviewOverlay .photo-preview-close{top:calc(16px + env(safe-area-inset-top,0px))!important;right:calc(12px + env(safe-area-inset-right,0px))!important}#photoPreviewOverlay .pp-nav-arrow{top:50%!important;transform:translateY(-50%)!important;z-index:35!important}#photoPreviewOverlay .pp-nav-prev{left:calc(12px + env(safe-area-inset-left,0px))!important}#photoPreviewOverlay .pp-nav-next{right:calc(12px + env(safe-area-inset-right,0px))!important}#photoPreviewOverlay .pp-info-btn,#photoPreviewOverlay .pp-share-btn,#photoPreviewOverlay .pp-rotate-btn,#photoPreviewOverlay .pp-delete-btn{bottom:calc(24px + env(safe-area-inset-bottom,0px))!important;top:auto!important}#photoPreviewOverlay .pp-delete-btn{left:calc(16px + env(safe-area-inset-left,0px))!important;color:#fecaca!important;background:rgba(127,29,29,.58)!important}#photoPreviewOverlay .pp-info-btn{left:50%!important;transform:translateX(-50%)!important}#photoPreviewOverlay .pp-rotate-btn{right:calc(68px + env(safe-area-inset-right,0px))!important}#photoPreviewOverlay .pp-share-btn{right:calc(16px + env(safe-area-inset-right,0px))!important}
    `;
    document.head.appendChild(st);
  }

  function loaderHtml(text) {
    return '<div class="xtj-chat-loader" role="status" aria-live="polite"><div class="xtj-magic-loader" aria-hidden="true"><span class="xtj-magic-ring r1"></span><span class="xtj-magic-ring r2"></span><span class="xtj-magic-rune" style="--a:0deg">✦</span><span class="xtj-magic-rune" style="--a:90deg">✧</span><span class="xtj-magic-rune" style="--a:180deg">✶</span><span class="xtj-magic-rune" style="--a:270deg">✦</span><span class="xtj-magic-spark s1"></span><span class="xtj-magic-spark s2"></span><span class="xtj-magic-spark s3"></span></div><div class="xtj-chat-loader-title">' + esc(text || '加载中...') + '</div><div class="xtj-chat-loader-sub">正在召唤消息</div><div class="xtj-chat-loader-dots"><span></span><span></span><span></span></div></div>';
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
    }, 2600);
  }

  function repairChatArea(el) {
    if (!el) return;
    if (el.querySelector('.chat-list-item')) { if (el.id === 'dockChatList') chatListSnapshot = el.innerHTML; return; }
    if (el.querySelector('.chat-msg')) return;
    if (el.querySelector('.xtj-chat-loader')) { capLoading(el); return; }
    if (el.querySelector('.xtj-chat-empty')) return;
    var raw = el.innerHTML || '';
    var text = fixText(el.textContent || '').trim();
    if (/加载中|正在刷新/.test(text) || /加载涓|加载娑|鍔犺浇|鈴|馃挰|ce-icon/.test(raw)) { el.innerHTML = loaderHtml('加载中...'); capLoading(el); return; }
    if (/暂无消息|发送第一条消息吧|在帖子页面点击头像/.test(text) || /鏆傛棤娑堟伅|鍙戦€佺/.test(raw)) { el.innerHTML = emptyHtml(el.id === 'dockChatMessages' ? 'detail' : 'list'); return; }
    if (bad(raw)) el.innerHTML = fixText(raw);
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

  function basicTextGuard(root) {
    root = root || document.body;
    if (!root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { var p = n.parentElement; if (!p || /^(SCRIPT|STYLE|TEXTAREA|PRE|CODE)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT; return bad(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP; } });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) { n.nodeValue = fixText(n.nodeValue); });
  }

  function photoInfoAnim() {
    if (window.__xtjPhotoInfoAnimationFixInstalled || typeof window.showPhotoInfo !== 'function') return;
    window.__xtjPhotoInfoAnimationFixInstalled = true;
    var nativeShow = window.showPhotoInfo;
    function m() { return document.getElementById('ppInfoModal'); }
    function c(x) { return x ? x.querySelector('.pp-info-modal-content') : null; }
    function close(x) { x = x || m(); var y = c(x); if (!x) return; x.classList.remove('active'); x.style.display = 'flex'; x.style.pointerEvents = 'none'; x.style.transition = 'opacity 220ms ease-in'; x.style.opacity = '1'; if (y) { y.style.transition = 'transform 260ms cubic-bezier(.55,0,1,.45), opacity 180ms ease-in, filter 220ms ease-in'; y.style.transform = 'translate3d(0,14px,0) scale(.94)'; y.style.opacity = '0'; y.style.filter = 'blur(6px)'; } requestAnimationFrame(function () { x.style.opacity = '0'; }); setTimeout(function () { x.style.display = 'none'; if (y) { y.style.transition = ''; y.style.transform = ''; y.style.opacity = ''; y.style.filter = ''; } }, 280); }
    window.showPhotoInfo = function () { var x = m(); if (x && x.style.display !== 'none' && x.classList.contains('active')) { close(x); return; } nativeShow.apply(this, arguments); setTimeout(function () { x = m(); var y = c(x); basicTextGuard(x || document.body); if (!x || !y) return; x.style.display = 'flex'; x.style.pointerEvents = 'none'; x.style.opacity = '0'; y.style.pointerEvents = 'auto'; y.style.transition = 'none'; y.style.transform = 'translate3d(0,18px,0) scale(.92)'; y.style.opacity = '0'; y.style.filter = 'blur(8px)'; void y.offsetHeight; requestAnimationFrame(function () { x.style.opacity = '1'; y.style.transition = 'transform 360ms cubic-bezier(.16,1,.3,1), opacity 240ms ease-out, filter 320ms ease-out'; y.style.transform = 'translate3d(0,0,0) scale(1)'; y.style.opacity = '1'; y.style.filter = 'blur(0)'; }); }, 0); };
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
    addStyle(); patchToast(); patchChat(); reportsAndProfile(); photoInfoAnim(); basicTextGuard(document.body); repairChat(); repairToasts();
    var obs = new MutationObserver(function () { clearTimeout(obs._t); obs._t = setTimeout(function () { basicTextGuard(document.body); repairChat(); repairToasts(); patchChat(); patchToast(); photoInfoAnim(); }, 60); });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    setTimeout(function () { repairChat(); repairToasts(); }, 160);
    setTimeout(function () { repairChat(); repairToasts(); }, 700);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
