/* Group chat (user request 2026-11-09): WeChat/QQ-style groups of up to 1000
 * members inside the chat panel. Server rules live in the chat_group_* database
 * functions; this module renders the group list section, the conversation, the
 * group info page (members, name, QR code, announcement, search, do not disturb,
 * pin, nickname, background, clear history, complaint, leave/dissolve) and the
 * owner/admin management pages.
 *
 * Rendering is incremental: each message is one keyed DOM node that is created
 * once and patched in place (never a full re-render), and every animation only
 * touches transform/opacity so sending and withdrawing stay on the compositor. */
(function () {
  'use strict';
  if (window.__xtjChatGroups) return;

  var API = '/api/groups';
  var BACKGROUNDS = [
    { id: '', label: '默认' }, { id: 'mint', label: '薄荷' }, { id: 'sky', label: '晴空' }, { id: 'peach', label: '蜜桃' },
    { id: 'lavender', label: '薰衣草' }, { id: 'paper', label: '信纸' }, { id: 'grid', label: '方格' }, { id: 'night', label: '夜色' }
  ];
  var REPORT_REASONS = [
    ['spam', '广告、垃圾信息'], ['fraud', '诈骗、虚假信息'], ['porn', '色情低俗'], ['violence', '暴力血腥'],
    ['harassment', '辱骂、骚扰'], ['illegal', '违法违规'], ['other', '其他']
  ];
  var BAN_OPTIONS = [[10, '10 分钟'], [60, '1 小时'], [720, '12 小时'], [1440, '1 天'], [10080, '7 天'], [43200, '30 天']];

  var state = {
    owner: '', epoch: 0,
    groups: [], groupsLoaded: false, listSeq: 0, listTimer: 0, lastUnread: Object.create(null),
    active: null,          // the open conversation (see openGroup)
    layers: [],            // open sheets, topmost last
    pollTimer: 0, realtimeAt: 0,
    friends: null, friendsAt: 0
  };

  // ------------------------------------------------------------ utilities
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function me() { return window.currentUser || ''; }
  function epoch() { return window._authStateEpoch || 0; }
  function same(owner, ep) { return owner === me() && ep === epoch(); }
  function $(id) { return document.getElementById(id); }
  function toast(text) { if (typeof window.showToast === 'function') window.showToast(text); }
  function reducedMotion() {
    return document.documentElement.getAttribute('data-xtj-motion') === 'off' ||
      !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function animate(el, frames, opts) {
    if (!el || reducedMotion() || typeof el.animate !== 'function') return null;
    try { return el.animate(frames, opts); } catch (_) { return null; }
  }
  function clientId() {
    var bytes = new Uint8Array(12);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(bytes) : bytes.forEach(function (_, i) { bytes[i] = Math.random() * 256; });
    return 'g' + Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function hue(seed) {
    var h = 0; seed = String(seed || '');
    for (var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
    return h;
  }
  function initials(name) {
    var text = String(name || '群').trim();
    return Array.from(text).slice(0, 2).join('');
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function formatTime(stamp, long) {
    var d = new Date(stamp); if (isNaN(d)) return '';
    var now = new Date(), diffDays = Math.round((dayStart(now) - dayStart(d)) / 86400000);
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (diffDays === 0) return hm;
    if (diffDays === 1) return long ? '昨天 ' + hm : '昨天';
    if (diffDays < 7) return (long ? '' : '') + '周' + '日一二三四五六'[d.getDay()] + (long ? ' ' + hm : '');
    var date = (d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '/') + (d.getMonth() + 1) + '/' + d.getDate();
    return long ? date + ' ' + hm : date;
  }
  function clock(stamp) { var d = new Date(stamp || Date.now()); return isNaN(d) ? '' : pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function linkify(text) {
    var html = esc(text);
    html = html.replace(/https?:\/\/[^\s<>"']+/g, function (url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer nofollow">' + url + '</a>';
    });
    return html.replace(/@([^\s@<>&]{1,24})/g, function (all) {
      return '<span class="grp-mention">' + all + '</span>';
    });
  }

  async function api(path, options) {
    options = options || {};
    var owner = options.owner || me(), ep = options.epoch == null ? epoch() : options.epoch;
    if (!owner) { var e0 = new Error('请先登录'); e0.code = 'auth_required'; throw e0; }
    if (typeof window.xtjProtectedFetch !== 'function') { var e1 = new Error('页面尚未就绪，请稍后重试'); e1.code = 'not_ready'; throw e1; }
    var init = { method: options.method || 'GET', headers: {}, authOwner: owner, authEpoch: ep, timeoutMs: options.timeoutMs || 15000 };
    if (options.json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(options.json); }
    if (options.raw) { init.headers['Content-Type'] = options.contentType || 'application/octet-stream'; init.body = options.raw; init.timeoutMs = 60000; }
    var response = await window.xtjProtectedFetch(API + path, init);
    var data = await response.json().catch(function () { return {}; });
    if (!same(owner, ep)) { var e2 = new Error('账号已切换'); e2.code = 'identity_changed'; throw e2; }
    if (!response.ok || !data || data.ok === false) {
      var error = new Error((data && data.error) || '操作失败，请稍后重试');
      error.code = (data && data.code) || 'http_' + response.status; error.status = response.status; error.data = data;
      throw error;
    }
    return data;
  }

  // ----------------------------------------------------------- avatars
  var avatarUrls = Object.create(null), avatarWaiters = Object.create(null);
  function avatarHtml(userName, cls) {
    var url = avatarUrls[userName];
    var style = 'style="--grp-hue:' + hue(userName) + '"';
    if (url) return '<span class="' + (cls || 'grp-user-avatar') + '" ' + style + '><img src="' + esc(url) + '" alt="" loading="lazy" decoding="async"></span>';
    return '<span class="' + (cls || 'grp-user-avatar') + ' is-initial" ' + style + ' data-avatar-user="' + esc(userName) + '">' + esc(initials(userName === '已注销用户' ? '?' : userName).slice(0, 1)) + '</span>';
  }
  function ensureAvatars(names, root) {
    if (typeof window.xtjFetchAvatarUrl !== 'function') return;
    names.forEach(function (name) {
      if (!name || name === '已注销用户' || avatarUrls[name] !== undefined || avatarWaiters[name]) return;
      avatarWaiters[name] = Promise.resolve(window.xtjFetchAvatarUrl(name)).then(function (url) {
        avatarUrls[name] = url || '';
        if (!url) return;
        var scope = root && root.isConnected ? root : document;
        scope.querySelectorAll('[data-avatar-user="' + (window.CSS && CSS.escape ? CSS.escape(name) : name) + '"]').forEach(function (node) {
          node.classList.remove('is-initial'); node.removeAttribute('data-avatar-user');
          node.innerHTML = '<img src="' + esc(url) + '" alt="" decoding="async">';
        });
      }).catch(function () { avatarUrls[name] = ''; }).finally(function () { delete avatarWaiters[name]; });
    });
  }
  function groupAvatarHtml(group, cls) {
    return '<span class="' + (cls || 'grp-avatar') + '" style="--grp-hue:' + hue(group.id) + '" aria-hidden="true"><span>' +
      esc(initials(group.name)) + '</span><svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="3.2"/><circle cx="16.5" cy="10" r="2.6"/><path d="M3.5 19c.6-3.4 3-5 5.5-5s4.9 1.6 5.5 5M14.5 14.6c2.6-.4 5 .9 5.8 4"/></svg></span>';
  }

  // ------------------------------------------------------------- layers
  // Sheets are fixed overlays with a card; they open from the bottom on phones
  // and as a centred card on wide screens. Esc / backdrop closes the topmost.
  function openSheet(title, bodyHtml, options) {
    options = options || {};
    var overlay = document.createElement('div');
    overlay.className = 'grp-sheet grp-ui' + (options.wide ? ' is-wide' : '') + (options.className ? ' ' + options.className : '');
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = '<div class="grp-sheet-card"><div class="grp-sheet-head">' +
      (options.back ? '<button type="button" class="grp-icon-btn" data-sheet-close aria-label="返回"><svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg></button>' : '') +
      '<strong>' + esc(title) + '</strong>' + (options.headAction || '') +
      '<button type="button" class="grp-icon-btn" data-sheet-close aria-label="关闭"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
      '<div class="grp-sheet-body">' + bodyHtml + '</div>' + (options.footer ? '<div class="grp-sheet-foot">' + options.footer + '</div>' : '') + '</div>';
    var layer = { el: overlay, close: close, onClose: options.onClose, previous: document.activeElement };
    function close(immediate) {
      if (layer.closed) return; layer.closed = true;
      state.layers = state.layers.filter(function (l) { return l !== layer; });
      if (layer.onClose) try { layer.onClose(); } catch (_) {}
      var card = overlay.firstElementChild;
      var anim = !immediate && animate(card, [{ transform: 'translate3d(0,0,0)', opacity: 1 }, { transform: sheetOffset(), opacity: 0 }], { duration: 170, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
      animate(overlay, [{ backgroundColor: getComputedStyle(overlay).backgroundColor }, { backgroundColor: 'rgba(0,0,0,0)' }], { duration: 170, fill: 'forwards' });
      var done = function () { overlay.remove(); if (layer.previous && layer.previous.isConnected && layer.previous.focus) try { layer.previous.focus({ preventScroll: true }); } catch (_) {} };
      if (anim) anim.finished.then(done, done); else done();
    }
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay || event.target.closest('[data-sheet-close]')) close();
    });
    document.body.appendChild(overlay);
    state.layers.push(layer);
    animate(overlay.firstElementChild, [{ transform: sheetOffset(), opacity: 0 }, { transform: 'translate3d(0,0,0)', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    var focusable = overlay.querySelector('[autofocus]') || overlay.querySelector('.grp-sheet-head [data-sheet-close]');
    if (focusable) setTimeout(function () { try { focusable.focus({ preventScroll: true }); } catch (_) {} }, 30);
    return layer;
  }
  function sheetOffset() { return window.innerWidth < 640 ? 'translate3d(0,36px,0)' : 'translate3d(0,10px,0) scale(.97)'; }
  function closeAllSheets() { state.layers.slice().forEach(function (l) { l.close(true); }); }

  function confirmBox(title, message, okText) {
    return typeof window.xtjConfirm === 'function' ? window.xtjConfirm(title, message, okText) : Promise.resolve(window.confirm(message));
  }
  function promptBox(title, message, initial, max) {
    return typeof window.xtjPrompt === 'function' ? window.xtjPrompt(title, message, initial, max) : Promise.resolve(window.prompt(message, initial));
  }

  // --------------------------------------------------------- list section
  function ensureListSection() {
    var view = $('dockChatListView'), list = $('dockChatList');
    if (!view || !list) return null;
    var section = $('dockGroupSection');
    if (!section) {
      section = document.createElement('section');
      section.id = 'dockGroupSection'; section.className = 'grp-section grp-ui'; section.hidden = true;
      section.setAttribute('aria-label', '群聊');
      section.innerHTML = '<div class="grp-section-head"><span>群聊</span><span class="grp-section-count" id="dockGroupCount"></span>' +
        '<button type="button" class="grp-create-btn" data-group-create aria-label="发起群聊"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>发起群聊</button></div>' +
        '<div id="dockGroupList" class="grp-list" role="list"></div>';
      var tools = view.querySelector('.chat-list-tools');
      view.insertBefore(section, tools && tools.parentNode === view ? tools : list);
      section.addEventListener('click', function (event) {
        if (event.target.closest('[data-group-create]')) { openCreateSheet(); return; }
        var row = event.target.closest('[data-group-id]');
        if (row) openGroup(row.getAttribute('data-group-id'));
      });
      section.addEventListener('keydown', function (event) {
        var row = event.target.closest('[data-group-id]');
        if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openGroup(row.getAttribute('data-group-id')); }
      });
    }
    var header = document.querySelector('#dockChatContainer > .chat-header');
    if (header && !$('chatGroupCreateButton')) {
      var button = document.createElement('button');
      button.type = 'button'; button.id = 'chatGroupCreateButton'; button.className = 'chat-feature-button';
      button.setAttribute('aria-label', '发起群聊'); button.title = '发起群聊';
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c.7-3.6 3.2-5.4 6-5.4 1.4 0 2.7.4 3.8 1.3M18 13v6M15 16h6"/></svg>';
      button.addEventListener('click', openCreateSheet);
      var anchor = $('dockChatSocialBtn');
      header.insertBefore(button, anchor ? anchor.nextSibling : null);
    }
    return section;
  }

  function groupRowHtml(group) {
    var last = group.last_message;
    var preview = '';
    if (group.dissolved) preview = '该群聊已解散';
    else if (last) preview = (last.kind === 'system' ? '' : (last.sender === me() ? '我' : last.sender_display || last.sender) + '：') + last.text;
    var unread = group.unread || 0;
    var badge = unread ? '<span class="cli-badge' + (group.muted ? ' is-muted' : '') + '">' + (group.muted ? '' : unread > 99 ? '99+' : unread) + '</span>' : '';
    return '<div class="chat-list-item grp-row' + (state.active && state.active.id === group.id ? ' active' : '') + '" role="listitem" tabindex="0" data-group-id="' + esc(group.id) + '">' +
      '<div class="cli-avatar">' + groupAvatarHtml(group) + '</div>' +
      '<div class="cli-info"><div class="cli-name"><span class="cli-name-text">' + esc(group.name) + '</span><span class="grp-count-tag">(' + (group.member_count || 0) + ')</span>' +
      (group.pinned_at ? '<span class="cli-state">置顶</span>' : '') + (group.muted ? '<span class="cli-state" title="消息免打扰">免打扰</span>' : '') + '</div>' +
      '<div class="cli-preview">' + (group.mentioned && unread ? '<em class="grp-at-me">[有人@我]</em>' : '') +
      (group.muted && unread > 1 ? '[' + (unread > 99 ? '99+' : unread) + '条] ' : '') + esc(preview) + '</div></div>' +
      '<div class="cli-right"><span class="cli-time">' + esc(last ? formatTime(last.created_at) : '') + '</span>' + badge + '</div></div>';
  }

  function renderGroupList() {
    var section = ensureListSection(); if (!section) return;
    var list = $('dockGroupList');
    section.hidden = !me();
    var count = $('dockGroupCount'); if (count) count.textContent = state.groups.length ? String(state.groups.length) : '';
    if (!state.groups.length) {
      list.innerHTML = state.groupsLoaded ? '<button type="button" class="grp-empty-cta" data-group-create><span>和好友一起聊</span><small>最多 1000 人，群主可管理成员、公告和二维码</small></button>' : '';
      return;
    }
    // Patch rows in place: a row is only rebuilt when its own content changed.
    var existing = Object.create(null);
    list.querySelectorAll('[data-group-id]').forEach(function (node) { existing[node.getAttribute('data-group-id')] = node; });
    var fragment = document.createDocumentFragment();
    state.groups.forEach(function (group) {
      var html = groupRowHtml(group), node = existing[group.id];
      if (!node || node.__html !== html) {
        var t = document.createElement('template'); t.innerHTML = html; var fresh = t.content.firstElementChild;
        fresh.__html = html;
        if (!node) fresh.classList.add('grp-row-enter');
        node = fresh;
      }
      fragment.appendChild(node);
    });
    list.replaceChildren(fragment);
  }

  function groupUnreadTotal() {
    return state.groups.reduce(function (sum, g) { return sum + (g.muted || g.dissolved ? 0 : (g.unread || 0)); }, 0);
  }

  async function loadGroups(options) {
    options = options || {};
    var owner = me(), ep = epoch();
    if (!owner) return;
    var seq = ++state.listSeq;
    try {
      var data = await api('', { owner: owner, epoch: ep });
      if (seq !== state.listSeq || !same(owner, ep)) return;
      var previous = state.lastUnread;
      state.groups = Array.isArray(data.groups) ? data.groups : [];
      state.groupsLoaded = true;
      state.lastUnread = Object.create(null);
      state.groups.forEach(function (g) {
        state.lastUnread[g.id] = g.unread || 0;
        var before = previous[g.id];
        var viewing = state.active && state.active.id === g.id && document.visibilityState === 'visible' && isChatVisible();
        if (options.notify && before !== undefined && (g.unread || 0) > before && !g.muted && !viewing && g.last_message && g.last_message.sender !== owner) {
          toast(g.name + '：' + (g.last_message.sender_display || g.last_message.sender || '') + '：' + g.last_message.text);
        }
      });
      if (typeof window.__xtjSetGroupUnread === 'function') window.__xtjSetGroupUnread(groupUnreadTotal());
      renderGroupList();
      if (state.active) syncActiveFromList();
    } catch (error) {
      if (error.code === 'identity_changed') return;
      if (seq === state.listSeq) { state.groupsLoaded = true; renderGroupList(); }
    }
  }
  function scheduleListRefresh(delay, notify) {
    clearTimeout(state.listTimer);
    state.listTimer = setTimeout(function () { loadGroups({ notify: notify }); }, delay == null ? 250 : delay);
  }
  function isChatVisible() { var panel = $('panelChat'); return !!(panel && panel.classList.contains('active')); }

  // ------------------------------------------------------------ friends
  async function loadFriends() {
    if (state.friends && Date.now() - state.friendsAt < 30000) return state.friends;
    var response = await window.xtjProtectedFetch('/api/chat/friends', { authOwner: me(), authEpoch: epoch() });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok || !data.ok) throw new Error(data.error || '好友列表暂时不可用');
    state.friends = (data.friends || []).map(function (f) { return { name: f.peer_name, note: f.note || '' }; });
    state.friendsAt = Date.now();
    return state.friends;
  }

  // Friend picker shared by "create group" and "invite".
  async function pickFriends(options) {
    var friends;
    try { friends = await loadFriends(); } catch (error) { toast(error.message); return; }
    var exclude = options.exclude || {};
    var candidates = friends.filter(function (f) { return !exclude[f.name]; });
    var selected = new Set();
    var body = (options.withName ? '<label class="grp-field"><span>群聊名称（选填）</span><input id="grpCreateName" maxlength="30" placeholder="不填则使用成员名字"></label>' : '') +
      '<div class="grp-search"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input id="grpPickFilter" type="search" placeholder="搜索好友" aria-label="搜索好友"></div>' +
      '<div class="grp-chips" id="grpPickChips" aria-live="polite"></div>' +
      '<div class="grp-pick-list" id="grpPickList">' + (candidates.length ? candidates.map(function (f) {
        return '<label class="grp-pick-row" data-name="' + esc(f.name.toLowerCase() + ' ' + f.note.toLowerCase()) + '"><input type="checkbox" value="' + esc(f.name) + '">' +
          avatarHtml(f.name) + '<span class="grp-pick-name">' + esc(f.note || f.name) + (f.note ? '<small>' + esc(f.name) + '</small>' : '') + '</span><i class="grp-check" aria-hidden="true"></i></label>';
      }).join('') : '<p class="grp-empty">' + (friends.length ? '好友都已经在群里了' : '还没有好友，先在「联系人」里添加好友吧') + '</p>') + '</div>';
    return new Promise(function (resolve) {
      var resolved = false;
      var layer = openSheet(options.title, body, {
        footer: '<button type="button" class="grp-primary" id="grpPickConfirm" disabled>' + esc(options.okText) + '</button>',
        onClose: function () { if (!resolved) resolve(null); }
      });
      var root = layer.el, confirmBtn = root.querySelector('#grpPickConfirm'), chips = root.querySelector('#grpPickChips');
      ensureAvatars(candidates.map(function (f) { return f.name; }), root);
      function sync() {
        confirmBtn.disabled = selected.size === 0;
        confirmBtn.textContent = options.okText + (selected.size ? '（' + selected.size + '）' : '');
        chips.innerHTML = Array.from(selected).map(function (name) { return '<button type="button" class="grp-chip" data-unpick="' + esc(name) + '">' + esc(name) + ' ×</button>'; }).join('');
      }
      root.querySelector('#grpPickList').addEventListener('change', function (event) {
        var box = event.target; if (!box || box.type !== 'checkbox') return;
        if (box.checked) {
          if (selected.size + (options.existing || 0) >= 1000) { box.checked = false; toast('群成员最多 1000 人'); return; }
          selected.add(box.value);
        } else selected.delete(box.value);
        sync();
      });
      chips.addEventListener('click', function (event) {
        var chip = event.target.closest('[data-unpick]'); if (!chip) return;
        var name = chip.getAttribute('data-unpick'); selected.delete(name);
        root.querySelectorAll('#grpPickList input').forEach(function (input) { if (input.value === name) input.checked = false; });
        sync();
      });
      root.querySelector('#grpPickFilter').addEventListener('input', function (event) {
        var q = event.target.value.trim().toLowerCase();
        root.querySelectorAll('.grp-pick-row').forEach(function (row) { row.hidden = !!q && row.getAttribute('data-name').indexOf(q) < 0; });
      });
      confirmBtn.addEventListener('click', function () {
        resolved = true;
        var nameInput = root.querySelector('#grpCreateName');
        resolve({ members: Array.from(selected), name: nameInput ? nameInput.value.trim() : '', layer: layer, button: confirmBtn });
      });
    });
  }

  async function openCreateSheet() {
    if (!me()) { toast('请先登录'); if (typeof window.openAuthModal === 'function') window.openAuthModal('login'); return; }
    var picked = await pickFriends({ title: '发起群聊', okText: '创建', withName: true });
    if (!picked) return;
    picked.button.disabled = true; picked.button.textContent = '正在创建…';
    try {
      var data = await api('', { method: 'POST', json: { name: picked.name, members: picked.members } });
      picked.layer.close();
      if (data.rejected && data.rejected.length) toast('已创建，' + data.rejected.join('、') + ' 不是好友或无法邀请');
      await loadGroups();
      openGroup(data.group_id);
    } catch (error) {
      picked.button.disabled = false; picked.button.textContent = '创建';
      toast(error.message);
    }
  }

  // ------------------------------------------------------- conversation
  function ensureView() {
    var container = $('dockChatContainer'); if (!container) return null;
    var view = $('groupChatView');
    if (view) return view;
    view = document.createElement('section');
    view.id = 'groupChatView'; view.className = 'grp-view grp-ui'; view.hidden = true;
    view.setAttribute('aria-label', '群聊');
    view.innerHTML =
      '<header class="grp-head"><button type="button" class="grp-icon-btn" data-grp="back" aria-label="返回会话列表"><svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg></button>' +
      '<div class="grp-title"><h3 id="groupChatTitle"></h3><span id="groupChatSub"></span></div>' +
      '<button type="button" class="grp-icon-btn" data-grp="info" aria-label="聊天信息" id="groupChatInfoBtn"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button></header>' +
      '<button type="button" class="grp-announce" id="groupAnnounceBar" hidden><span class="grp-announce-tag">公告</span><span class="grp-announce-text"></span><span class="grp-announce-x" data-grp="dismiss-announce" aria-label="关闭公告">×</span></button>' +
      '<div class="grp-messages" id="groupChatMessages" role="log" aria-live="polite" aria-relevant="additions"><div class="grp-older" id="groupOlder" hidden><span class="grp-spinner"></span></div><div class="grp-stream" id="groupStream"></div></div>' +
      '<button type="button" class="grp-jump" id="groupJumpLatest" hidden>↓ 新消息</button>' +
      '<div class="grp-compose" id="groupCompose">' +
        '<div class="grp-reply" id="groupReplyBar" hidden><span></span><button type="button" data-grp="cancel-reply" aria-label="取消引用">×</button></div>' +
        '<div class="grp-mention-pop" id="groupMentionPop" hidden role="listbox" aria-label="选择要 @ 的成员"></div>' +
        '<div class="grp-compose-row"><button type="button" class="grp-icon-btn" data-grp="image" aria-label="发送图片"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17 5-4.5 3.5 3 2.5-2 4 3.5"/></svg></button>' +
        '<textarea id="groupChatInput" rows="1" maxlength="2000" placeholder="发消息，输入 @ 提醒成员" aria-label="输入群消息" enterkeyhint="send"></textarea>' +
        '<button type="button" class="grp-send" data-grp="send" id="groupSendBtn" aria-label="发送" disabled><svg viewBox="0 0 24 24"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button></div>' +
        '<input type="file" id="groupImageInput" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" multiple hidden>' +
      '</div>' +
      '<div class="grp-locked" id="groupLocked" hidden></div>';
    container.appendChild(view);
    bindView(view);
    return view;
  }

  function placeView() {
    var view = $('groupChatView'), container = $('dockChatContainer'), detail = $('dockChatDetailView');
    if (!view || !container) return;
    var split = container.classList.contains('desktop-split') && detail && detail.getClientRects().length;
    view.classList.toggle('is-split', !!split);
    if (split) {
      var c = container.getBoundingClientRect(), d = detail.getBoundingClientRect();
      view.style.left = (d.left - c.left) + 'px'; view.style.top = (d.top - c.top) + 'px';
      view.style.width = d.width + 'px'; view.style.height = d.height + 'px';
    } else {
      view.style.left = view.style.top = view.style.width = view.style.height = '';
    }
  }

  function newConversation(id) {
    return { id: id, owner: me(), epoch: epoch(), detail: null, nodes: new Map(), messages: new Map(), order: [],
      hasMore: false, loadingOlder: false, fetching: false, reply: null, mentions: Object.create(null), seq: 0, pendingCount: 0 };
  }

  function openGroup(id) {
    if (!id || !me()) return;
    var view = ensureView(); if (!view) return;
    if (typeof window.switchDockTab === 'function' && !isChatVisible()) window.switchDockTab('chat', true);
    if (state.active && state.active.id === id && !view.hidden) { focusInput(); return; }
    closeInfo(true);
    state.active = newConversation(id);
    var conv = state.active;
    var group = findGroup(id);
    $('groupStream').innerHTML = '';
    $('groupOlder').hidden = true;
    $('groupJumpLatest').hidden = true;
    setReply(null);
    $('groupChatInput').value = draftFor(id);
    syncSendButton();
    paintHeader(group);
    applyBackground(group && group.background);
    placeView();
    var wasHidden = view.hidden;
    view.hidden = false; view.inert = false;
    document.querySelectorAll('#dockGroupList .grp-row').forEach(function (row) { row.classList.toggle('active', row.getAttribute('data-group-id') === id); });
    if (wasHidden) {
      var from = view.classList.contains('is-split') ? 'translate3d(18px,0,0)' : 'translate3d(100%,0,0)';
      var anim = animate(view, [{ transform: from, opacity: view.classList.contains('is-split') ? 0 : 1 }, { transform: 'translate3d(0,0,0)', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.22,.7,.25,1)' });
      if (anim) anim.finished.then(function () {}, function () {});
    }
    $('groupStream').innerHTML = '<div class="grp-loading"><span class="grp-spinner"></span></div>';
    Promise.all([refreshDetail(conv), fetchLatest(conv)]).then(function () {
      if (state.active !== conv) return;
      markRead(conv);
      if (!view.classList.contains('is-split')) focusInput(true);
    });
    startPolling();
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (_) {}
  }

  function closeGroup(immediate) {
    var view = $('groupChatView');
    var conv = state.active;
    if (conv) saveDraft(conv.id, $('groupChatInput') ? $('groupChatInput').value : '');
    state.active = null;
    stopPolling();
    closeInfo(true);
    hideMentionPop();
    document.querySelectorAll('#dockGroupList .grp-row.active').forEach(function (row) { row.classList.remove('active'); });
    if (!view || view.hidden) return;
    view.inert = true;
    var to = view.classList.contains('is-split') ? 'translate3d(18px,0,0)' : 'translate3d(100%,0,0)';
    var anim = !immediate && animate(view, [{ transform: 'translate3d(0,0,0)', opacity: 1 }, { transform: to, opacity: view.classList.contains('is-split') ? 0 : 1 }], { duration: 240, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
    var done = function () { if (state.active) return; view.hidden = true; if (anim) anim.cancel(); };
    if (anim) anim.finished.then(done, done); else done();
  }

  function findGroup(id) { for (var i = 0; i < state.groups.length; i++) if (state.groups[i].id === id) return state.groups[i]; return null; }

  function paintHeader(group) {
    var conv = state.active;
    var detail = conv && conv.detail;
    var name = detail ? detail.group.name : group ? group.name : '群聊';
    var count = detail ? detail.group.member_count : group ? group.member_count : 0;
    $('groupChatTitle').textContent = name;
    var sub = $('groupChatSub');
    var muted = detail ? detail.me.muted : group && group.muted;
    sub.textContent = (count ? count + ' 人' : '') + (muted ? ' · 免打扰' : '');
  }

  function syncActiveFromList() {
    var conv = state.active; if (!conv) return;
    var group = findGroup(conv.id);
    if (!group) return;
    if (!conv.detail) paintHeader(group);
    if (group.unread && document.visibilityState === 'visible' && isChatVisible()) {
      // The list says there is something newer than what we show.
      fetchNewer(conv).then(function () { markRead(conv); });
    }
  }

  async function refreshDetail(conv) {
    try {
      var data = await api('/' + conv.id, { owner: conv.owner, epoch: conv.epoch });
      if (state.active !== conv) return;
      conv.detail = data;
      paintHeader();
      applyBackground(data.me.background);
      paintComposerLock();
      paintAnnouncement();
      ensureAvatars(data.members.slice(0, 60).map(function (m) { return m.user_name; }), $('groupChatView'));
      if (state.info && state.info.conv === conv) renderInfo();
    } catch (error) {
      if (state.active !== conv) return;
      if (error.code === 'not_member') { toast('你已不在该群聊中'); closeGroup(); scheduleListRefresh(0); }
      else if (error.code !== 'identity_changed') toast(error.message);
    }
  }

  function paintComposerLock() {
    var conv = state.active; if (!conv || !conv.detail) return;
    var d = conv.detail, lock = '';
    if (d.group.dissolved) lock = '该群聊已被群主解散';
    else if (d.me.banned_until && new Date(d.me.banned_until) > new Date()) lock = '你已被禁言，' + formatTime(d.me.banned_until, true) + ' 后可发言';
    else if (d.group.mute_all && d.me.role === 'member') lock = '群主已开启全员禁言';
    $('groupLocked').textContent = lock;
    $('groupLocked').hidden = !lock;
    $('groupCompose').hidden = !!lock;
  }

  function paintAnnouncement() {
    var conv = state.active, bar = $('groupAnnounceBar');
    if (!conv || !conv.detail || !bar) return;
    var g = conv.detail.group;
    var key = 'xtj_grp_ann_' + me() + '_' + conv.id;
    var seen = ''; try { seen = localStorage.getItem(key) || ''; } catch (_) {}
    var show = !!g.announcement && seen !== String(g.announcement_at || '');
    bar.hidden = !show;
    if (show) bar.querySelector('.grp-announce-text').textContent = g.announcement.replace(/\s+/g, ' ');
  }

  function applyBackground(id) {
    var box = $('groupChatMessages'); if (!box) return;
    BACKGROUNDS.forEach(function (b) { if (b.id) box.classList.remove('grp-bg-' + b.id); });
    if (id) box.classList.add('grp-bg-' + id);
  }

  // ---- message fetching
  function cursorQuery(msg, dir) {
    return '&' + dir + '=' + encodeURIComponent(msg.created_at) + '&' + dir + '_id=' + encodeURIComponent(msg.id);
  }
  function lastServerMessage(conv) {
    for (var i = conv.order.length - 1; i >= 0; i--) { var m = conv.messages.get(conv.order[i]); if (m && !m.__local) return m; }
    return null;
  }
  function firstServerMessage(conv) {
    for (var i = 0; i < conv.order.length; i++) { var m = conv.messages.get(conv.order[i]); if (m && !m.__local) return m; }
    return null;
  }

  async function fetchLatest(conv) {
    try {
      var data = await api('/' + conv.id + '/messages?limit=40', { owner: conv.owner, epoch: conv.epoch });
      if (state.active !== conv) return;
      $('groupStream').innerHTML = '';
      conv.hasMore = !!data.has_more;
      mergeMessages(conv, data.messages, 'replace');
      scrollToBottom(true);
    } catch (error) {
      if (state.active !== conv) return;
      $('groupStream').innerHTML = '<div class="grp-load-error">消息加载失败<button type="button" data-grp="retry">重试</button></div>';
    }
  }

  async function fetchNewer(conv) {
    if (!conv || conv.fetching) { if (conv) conv.refetch = true; return; }
    var last = lastServerMessage(conv);
    if (!last) return fetchLatest(conv);
    conv.fetching = true;
    try {
      for (var round = 0; round < 5; round++) {
        var data = await api('/' + conv.id + '/messages?limit=100' + cursorQuery(last, 'after'), { owner: conv.owner, epoch: conv.epoch });
        if (state.active !== conv) return;
        var nearBottom = isNearBottom();
        mergeMessages(conv, data.messages, 'append');
        if (nearBottom) scrollToBottom(false); else if (data.messages.some(function (m) { return m.sender !== me(); })) $('groupJumpLatest').hidden = false;
        if (!data.has_more) break;
        last = lastServerMessage(conv);
      }
    } catch (_) {
    } finally {
      conv.fetching = false;
      if (conv.refetch && state.active === conv) { conv.refetch = false; fetchNewer(conv); }
    }
  }

  async function fetchOlder(conv) {
    if (!conv || conv.loadingOlder || !conv.hasMore) return;
    var first = firstServerMessage(conv); if (!first) return;
    conv.loadingOlder = true; $('groupOlder').hidden = false;
    var box = $('groupChatMessages'), before = box.scrollHeight - box.scrollTop;
    try {
      var data = await api('/' + conv.id + '/messages?limit=40' + cursorQuery(first, 'before'), { owner: conv.owner, epoch: conv.epoch });
      if (state.active !== conv) return;
      conv.hasMore = !!data.has_more;
      mergeMessages(conv, data.messages, 'prepend');
      box.scrollTop = box.scrollHeight - before; // keep the reader anchored
    } catch (_) {
    } finally { conv.loadingOlder = false; $('groupOlder').hidden = true; }
  }

  function markRead(conv) {
    if (!conv || document.visibilityState !== 'visible' || !isChatVisible()) return;
    var group = findGroup(conv.id);
    if (group && group.unread) {
      group.unread = 0; group.mentioned = false; renderGroupList();
      if (typeof window.__xtjSetGroupUnread === 'function') window.__xtjSetGroupUnread(groupUnreadTotal());
    }
    clearTimeout(conv.readTimer);
    conv.readTimer = setTimeout(function () {
      if (state.active !== conv) return;
      api('/' + conv.id + '/actions', { method: 'POST', json: { action: 'mark_read' }, owner: conv.owner, epoch: conv.epoch }).catch(function () {});
    }, 400);
  }

  // ---- rendering
  function mergeMessages(conv, list, mode) {
    if (!Array.isArray(list) || !list.length) return;
    var stream = $('groupStream'), fresh = [];
    list.forEach(function (msg) {
      if (!msg || !msg.id) return;
      // A server echo of our own optimistic send replaces the local bubble.
      if (msg.client_id && conv.messages.has('local:' + msg.client_id)) { settleLocal(conv, 'local:' + msg.client_id, msg); return; }
      var old = conv.messages.get(msg.id);
      conv.messages.set(msg.id, msg);
      if (old) { patchMessage(conv, msg, old); return; }
      fresh.push(msg);
    });
    if (!fresh.length) return;
    fresh.sort(compareMessages);
    var names = [];
    if (mode === 'prepend') {
      conv.order = fresh.map(function (m) { return m.id; }).concat(conv.order);
    } else {
      var tail = conv.messages.get(conv.order[conv.order.length - 1]);
      conv.order = conv.order.concat(fresh.map(function (m) { return m.id; }));
      // A late page older than what is shown (rare race) re-sorts; placeNodes then rebuilds.
      if (mode === 'append' && tail && !tail.__local && compareMessages(fresh[0], tail) < 0) {
        conv.order.sort(function (a, b) { return compareMessages(conv.messages.get(a), conv.messages.get(b)); });
      }
    }
    var fragment = document.createDocumentFragment();
    fresh.forEach(function (msg) {
      var node = buildMessageNode(conv, msg, mode === 'append');
      conv.nodes.set(msg.id, node);
      names.push(msg.sender);
    });
    // Rebuild only the time separators and node order around the new nodes.
    placeNodes(conv, stream, fresh, mode, fragment);
    ensureAvatars(names, stream);
  }

  function compareMessages(a, b) {
    if (!a || !b) return 0;
    var ta = a.__local ? Infinity : Date.parse(a.created_at), tb = b.__local ? Infinity : Date.parse(b.created_at);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
  }

  function placeNodes(conv, stream, fresh, mode, fragment) {
    if (mode === 'replace' || mode === 'prepend' || conv.order.length !== stream.querySelectorAll('[data-msg-id]').length + fresh.length ||
        (mode === 'append' && conv.order[conv.order.length - fresh.length] !== fresh[0].id)) {
      var all = document.createDocumentFragment(), prev = null;
      conv.order.forEach(function (id) {
        var msg = conv.messages.get(id), node = conv.nodes.get(id);
        if (!msg || !node) return;
        if (needsSeparator(msg, prev)) all.appendChild(separator(msg.created_at));
        all.appendChild(node); prev = msg;
      });
      stream.replaceChildren(all);
      return;
    }
    var before = conv.messages.get(conv.order[conv.order.length - fresh.length - 1]) || null;
    fresh.forEach(function (msg) {
      if (needsSeparator(msg, before)) fragment.appendChild(separator(msg.created_at));
      fragment.appendChild(conv.nodes.get(msg.id));
      before = msg;
    });
    stream.appendChild(fragment);
  }
  function needsSeparator(msg, prev) {
    if (msg.__local) return false;
    if (!prev) return true;
    var a = Date.parse(prev.created_at), b = Date.parse(msg.created_at);
    return !isFinite(a) || b - a > 5 * 60000 || dayStart(new Date(a)) !== dayStart(new Date(b));
  }
  function separator(stamp) {
    var node = document.createElement('div'); node.className = 'grp-time-sep';
    node.innerHTML = '<span>' + esc(formatTime(stamp, true)) + '</span>';
    return node;
  }

  function messageHtml(conv, msg) {
    if (msg.kind === 'system') return '<div class="grp-system"><span>' + esc(msg.body) + '</span></div>';
    var mine = msg.sender === me();
    if (msg.withdrawn) {
      var name = msg.sender_display || msg.sender;
      var by = msg.withdrawn_by && msg.withdrawn_by !== msg.sender
        ? (msg.withdrawn_by === me() ? '你撤回了成员“' + name + '”的一条消息' : '群主或管理员撤回了一条成员消息')
        : (mine ? '你撤回了一条消息' : '“' + name + '”撤回了一条消息');
      return '<div class="grp-system grp-withdrawn"><span>' + esc(by) + '</span></div>';
    }
    var mentionsMe = msg.meta && Array.isArray(msg.meta.mentions) && (msg.meta.mentions.indexOf(me()) >= 0 || msg.meta.mentions.indexOf('@all') >= 0);
    var body = '';
    if (msg.reply_to) body += '<button type="button" class="grp-quote" data-quote="' + esc(msg.reply_to.id) + '"><strong>' + esc(msg.reply_to.sender_name) + '</strong><span>' + esc(msg.reply_to.text) + '</span></button>';
    if (msg.kind === 'image') {
      var w = Number(msg.meta && msg.meta.width) || 0, h = Number(msg.meta && msg.meta.height) || 0;
      var ratio = w && h ? Math.max(.35, Math.min(2.4, h / w)) : .75;
      var src = msg.__preview || msg.media_url || '';
      body += src ? '<button type="button" class="grp-image" data-image style="--grp-ratio:' + ratio.toFixed(3) + '"><img src="' + esc(src) + '" alt="图片" decoding="async" loading="lazy"></button>'
        : '<span class="grp-image is-missing" style="--grp-ratio:' + ratio.toFixed(3) + '">图片不可用</span>';
    } else {
      body += '<span class="grp-text">' + linkify(msg.body) + '</span>';
    }
    var status = msg.__failed ? '<button type="button" class="grp-fail" data-retry aria-label="重新发送">!</button>' : msg.__local ? '<span class="grp-sending" aria-label="发送中"></span>' : '';
    return '<div class="grp-msg ' + (mine ? 'is-mine' : 'is-other') + (mentionsMe && !mine ? ' is-mention' : '') + '">' +
      (mine ? '' : '<button type="button" class="grp-msg-avatar" data-at="' + esc(msg.sender) + '" aria-label="@' + esc(msg.sender_display || msg.sender) + '">' + avatarHtml(msg.sender) + '</button>') +
      '<div class="grp-msg-col">' + (mine ? '' : '<span class="grp-sender">' + esc(msg.sender_display || msg.sender) + roleBadge(conv, msg.sender) + '</span>') +
      '<div class="grp-bubble-wrap">' + status + '<div class="grp-bubble' + (msg.kind === 'image' ? ' is-image' : '') + '" tabindex="0">' + body +
      '<span class="grp-time">' + esc(clock(msg.created_at)) + '</span></div></div></div>' +
      (mine ? '<span class="grp-msg-avatar is-self">' + avatarHtml(msg.sender) + '</span>' : '') + '</div>';
  }
  function roleBadge(conv, userName) {
    var member = conv.detail && conv.detail.members.find(function (m) { return m.user_name === userName; });
    if (!member || member.role === 'member') return '';
    return '<em class="grp-role is-' + member.role + '">' + (member.role === 'owner' ? '群主' : '管理员') + '</em>';
  }

  function buildMessageNode(conv, msg, animateIn) {
    var node = document.createElement('div');
    node.className = 'grp-row-msg';
    node.setAttribute('data-msg-id', msg.id);
    node.innerHTML = messageHtml(conv, msg);
    node.__html = node.innerHTML;
    if (animateIn && !reducedMotion()) node.classList.add(msg.sender === me() && msg.kind !== 'system' ? 'grp-enter-mine' : 'grp-enter');
    return node;
  }

  function patchMessage(conv, msg, old) {
    var node = conv.nodes.get(msg.id); if (!node) return;
    if (!old.withdrawn && msg.withdrawn) { withdrawAnimation(conv, node, msg); return; }
    var html = messageHtml(conv, msg);
    if (html !== node.__html) {
      // Keep a loaded <img> instead of flashing it when only the signed URL rotated.
      var img = node.querySelector('.grp-image img');
      node.innerHTML = html; node.__html = html;
      var nextImg = node.querySelector('.grp-image img');
      if (img && nextImg && img.complete && img.naturalWidth) nextImg.replaceWith(img);
    }
  }

  // Withdraw: the bubble folds away on the compositor, then the one-line notice
  // fades in. The row height change is covered by a short FLIP on the stream.
  function withdrawAnimation(conv, node, msg) {
    var bubble = node.querySelector('.grp-msg');
    var swap = function () {
      var startHeight = node.offsetHeight;
      node.innerHTML = messageHtml(conv, msg); node.__html = node.innerHTML;
      var endHeight = node.offsetHeight, delta = startHeight - endHeight;
      var notice = node.firstElementChild;
      animate(notice, [{ opacity: 0, transform: 'translate3d(0,4px,0) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
      if (delta > 0 && !reducedMotion()) {
        // Followers slide up from where they were instead of jumping.
        var next = node.nextElementSibling, followers = [];
        while (next && followers.length < 30) { followers.push(next); next = next.nextElementSibling; }
        followers.forEach(function (el) { animate(el, [{ transform: 'translate3d(0,' + delta + 'px,0)' }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' }); });
      }
    };
    var out = bubble && animate(bubble, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.86)' }], { duration: 150, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    if (out) out.finished.then(swap, swap); else swap();
  }

  function settleLocal(conv, localId, msg) {
    var node = conv.nodes.get(localId), local = conv.messages.get(localId);
    conv.messages.delete(localId); conv.nodes.delete(localId);
    var index = conv.order.indexOf(localId);
    if (conv.messages.has(msg.id)) { // already rendered through a poll
      if (index >= 0) conv.order.splice(index, 1);
      if (node) node.remove();
      return;
    }
    if (local && local.__preview && !msg.media_url) msg.__preview = local.__preview;
    conv.messages.set(msg.id, msg);
    if (index >= 0) conv.order[index] = msg.id;
    if (node) {
      node.setAttribute('data-msg-id', msg.id);
      var img = node.querySelector('.grp-image img');
      node.innerHTML = messageHtml(conv, msg); node.__html = node.innerHTML;
      var nextImg = node.querySelector('.grp-image img');
      if (img && nextImg && img.complete && img.naturalWidth) nextImg.replaceWith(img); // no flash from blob → signed URL
      conv.nodes.set(msg.id, node);
    }
  }

  function isNearBottom() {
    var box = $('groupChatMessages'); if (!box) return true;
    return box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  }
  function scrollToBottom(instant) {
    var box = $('groupChatMessages'); if (!box) return;
    $('groupJumpLatest').hidden = true;
    if (instant || reducedMotion()) { box.scrollTop = box.scrollHeight; return; }
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  }

  // ---- sending
  function draftFor(id) { try { return sessionStorage.getItem('xtj_grp_draft_' + me() + '_' + id) || ''; } catch (_) { return ''; } }
  function saveDraft(id, value) { try { value ? sessionStorage.setItem('xtj_grp_draft_' + me() + '_' + id, value) : sessionStorage.removeItem('xtj_grp_draft_' + me() + '_' + id); } catch (_) {} }
  function syncSendButton() {
    var input = $('groupChatInput'), btn = $('groupSendBtn'); if (!input || !btn) return;
    btn.disabled = !input.value.trim();
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }
  function focusInput(soft) {
    var input = $('groupChatInput');
    if (!input || $('groupCompose').hidden) return;
    if (soft && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return; // do not pop the phone keyboard on open
    try { input.focus({ preventScroll: true }); } catch (_) {}
  }

  function addLocal(conv, msg) {
    conv.messages.set(msg.id, msg);
    conv.order.push(msg.id);
    var node = buildMessageNode(conv, msg, true);
    conv.nodes.set(msg.id, node);
    $('groupStream').appendChild(node);
    scrollToBottom(true);
    return node;
  }

  function localMessage(conv, kind, body, extra) {
    var cid = clientId();
    return Object.assign({ id: 'local:' + cid, client_id: cid, __local: true, kind: kind, body: body, meta: {}, sender: me(),
      sender_display: conv.detail && conv.detail.me.nickname || me(), created_at: new Date().toISOString(),
      reply_to: conv.reply ? { id: conv.reply.id, sender_name: conv.reply.sender_display || conv.reply.sender, text: conv.reply.kind === 'image' ? '[图片]' : String(conv.reply.body || '').slice(0, 120) } : null }, extra || {});
  }

  function collectMentions(conv, text) {
    var out = [];
    Object.keys(conv.mentions).forEach(function (label) { if (text.indexOf('@' + label) >= 0 && out.indexOf(conv.mentions[label]) < 0) out.push(conv.mentions[label]); });
    return out;
  }

  async function sendText() {
    var conv = state.active, input = $('groupChatInput');
    if (!conv || !input) return;
    var text = input.value.replace(/\s+$/, '');
    if (!text.trim()) return;
    if (text.length > 2000) { toast('消息最多 2000 字'); return; }
    var mentions = collectMentions(conv, text);
    var msg = localMessage(conv, 'text', text, { meta: mentions.length ? { mentions: mentions } : {} });
    var replyId = conv.reply && conv.reply.id;
    input.value = ''; saveDraft(conv.id, ''); syncSendButton(); setReply(null); conv.mentions = Object.create(null); hideMentionPop();
    addLocal(conv, msg);
    await deliverText(conv, msg, replyId, mentions);
  }

  async function deliverText(conv, msg, replyId, mentions) {
    try {
      var data = await api('/' + conv.id + '/messages', { method: 'POST', owner: conv.owner, epoch: conv.epoch,
        json: { body: msg.body, client_id: msg.client_id, reply_to: replyId || undefined, mentions: mentions } });
      if (state.active !== conv) { scheduleListRefresh(0); return; }
      settleLocal(conv, msg.id, data.message);
      scheduleListRefresh(150);
    } catch (error) { failLocal(conv, msg, error, function () { return deliverText(conv, msg, replyId, mentions); }); }
  }

  function failLocal(conv, msg, error, retry) {
    if (error.code === 'identity_changed' || state.active !== conv) return;
    msg.__failed = true; msg.__retry = retry;
    patchMessage(conv, msg, Object.assign({}, msg, { __failed: false }));
    toast(error.message || '发送失败');
    if (['muted_all', 'banned', 'dissolved', 'not_member'].indexOf(error.code) >= 0) refreshDetail(conv);
  }

  async function prepareImage(file) {
    var type = String(file.type || '').toLowerCase();
    if (type === 'image/gif') return { blob: file, type: type };
    var bitmap = null, img = null, w, h;
    try {
      if (window.createImageBitmap) { bitmap = await createImageBitmap(file); w = bitmap.width; h = bitmap.height; }
    } catch (_) { bitmap = null; }
    if (!bitmap) {
      img = await new Promise(function (resolve, reject) {
        var el = new Image(), url = URL.createObjectURL(file);
        el.onload = function () { URL.revokeObjectURL(url); resolve(el); };
        el.onerror = function () { URL.revokeObjectURL(url); reject(new Error('无法读取这张图片')); };
        el.src = url;
      });
      w = img.naturalWidth; h = img.naturalHeight;
    }
    var max = 2560, scale = Math.min(1, max / Math.max(w, h));
    if (scale === 1 && file.size <= 1.5 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/.test(type)) { if (bitmap && bitmap.close) bitmap.close(); return { blob: file, type: type }; }
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d').drawImage(bitmap || img, 0, 0, canvas.width, canvas.height);
    if (bitmap && bitmap.close) bitmap.close();
    var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', .86); });
    if (!blob) throw new Error('图片处理失败');
    return { blob: blob, type: 'image/jpeg' };
  }

  async function sendImages(files) {
    var conv = state.active; if (!conv) return;
    var list = Array.prototype.slice.call(files || [], 0, 9);
    for (var i = 0; i < list.length; i++) {
      var file = list[i];
      if (!/^image\//.test(file.type || '')) { toast('目前群聊只支持发送图片'); continue; }
      if (file.size > 40 * 1024 * 1024) { toast('图片太大了'); continue; }
      var preview = URL.createObjectURL(file);
      var dims = await new Promise(function (resolve) { var probe = new Image(); probe.onload = function () { resolve([probe.naturalWidth, probe.naturalHeight]); }; probe.onerror = function () { resolve([0, 0]); }; probe.src = preview; });
      if (state.active !== conv) return;
      var msg = localMessage(conv, 'image', '', { __preview: preview, meta: { width: dims[0], height: dims[1] } });
      var replyId = conv.reply && conv.reply.id; setReply(null);
      addLocal(conv, msg);
      await deliverImage(conv, msg, file, replyId);
    }
  }

  async function deliverImage(conv, msg, file, replyId) {
    try {
      var prepared = await prepareImage(file);
      if (prepared.blob.size > 20 * 1024 * 1024) throw Object.assign(new Error('图片压缩后仍超过 20MB'), { code: 'too_large' });
      var data = await api('/' + conv.id + '/images?client_id=' + encodeURIComponent(msg.client_id) + (replyId ? '&reply_to=' + encodeURIComponent(replyId) : ''),
        { method: 'POST', raw: prepared.blob, contentType: prepared.type, owner: conv.owner, epoch: conv.epoch });
      if (state.active !== conv) { scheduleListRefresh(0); return; }
      settleLocal(conv, msg.id, data.message);
      scheduleListRefresh(150);
    } catch (error) { failLocal(conv, msg, error, function () { return deliverImage(conv, msg, file, replyId); }); }
  }

  function retryLocal(conv, id) {
    var msg = conv.messages.get(id); if (!msg || !msg.__failed || !msg.__retry) return;
    msg.__failed = false;
    patchMessage(conv, msg, Object.assign({}, msg, { __failed: true }));
    msg.__retry();
  }

  function setReply(msg) {
    var conv = state.active, bar = $('groupReplyBar'); if (!bar) return;
    if (conv) conv.reply = msg || null;
    bar.hidden = !msg;
    if (msg) {
      bar.querySelector('span').textContent = '回复 ' + (msg.sender_display || msg.sender) + '：' + (msg.kind === 'image' ? '[图片]' : String(msg.body || '').slice(0, 60));
      focusInput();
    }
  }

  // ---- @ mentions
  function mentionQuery() {
    var input = $('groupChatInput'); if (!input) return null;
    var upto = input.value.slice(0, input.selectionStart || 0);
    var match = upto.match(/@([^\s@]{0,20})$/);
    return match ? { text: match[1], start: upto.length - match[0].length } : null;
  }
  function showMentionPop() {
    var conv = state.active, pop = $('groupMentionPop');
    var q = mentionQuery();
    if (!conv || !conv.detail || !q) { hideMentionPop(); return; }
    var needle = q.text.toLowerCase();
    var items = [];
    if (conv.detail.me.role !== 'member' && ('所有人'.indexOf(q.text) >= 0 || 'all'.indexOf(needle) >= 0)) items.push({ user: '@all', label: '所有人' });
    conv.detail.members.forEach(function (m) {
      if (m.user_name === me() || !m.active) return;
      var label = m.nickname || m.user_name;
      if (!needle || label.toLowerCase().indexOf(needle) >= 0 || m.user_name.toLowerCase().indexOf(needle) >= 0) items.push({ user: m.user_name, label: label });
    });
    items = items.slice(0, 8);
    if (!items.length) { hideMentionPop(); return; }
    pop.innerHTML = items.map(function (item, i) {
      return '<button type="button" role="option" data-mention="' + esc(item.user) + '" data-label="' + esc(item.label) + '"' + (i === 0 ? ' class="is-active"' : '') + '>' +
        (item.user === '@all' ? '<span class="grp-user-avatar is-initial" style="--grp-hue:150">@</span>' : avatarHtml(item.user)) + '<span>' + esc(item.label) + '</span></button>';
    }).join('');
    pop.hidden = false;
  }
  function hideMentionPop() { var pop = $('groupMentionPop'); if (pop) pop.hidden = true; }
  function insertMention(user, label) {
    var conv = state.active, input = $('groupChatInput'); if (!conv || !input) return;
    var q = mentionQuery();
    var start = q ? q.start : input.selectionStart || input.value.length, end = input.selectionStart || input.value.length;
    var text = '@' + label + ' ';
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    var caret = start + text.length;
    try { input.setSelectionRange(caret, caret); } catch (_) {}
    conv.mentions[label] = user;
    hideMentionPop(); syncSendButton(); focusInput();
  }

  // ---- long press / context menu on a message
  function openMessageMenu(conv, msg, anchor) {
    closeMessageMenu();
    if (!msg || msg.kind === 'system' || msg.withdrawn || msg.__local) return;
    var mine = msg.sender === me(), role = conv.detail ? conv.detail.me.role : 'member';
    var senderRole = (conv.detail && conv.detail.members.find(function (m) { return m.user_name === msg.sender; }) || {}).role || 'member';
    var fresh = Date.now() - Date.parse(msg.created_at) < 120000;
    var canWithdraw = (mine && (fresh || role !== 'member')) || (!mine && (role === 'owner' || (role === 'admin' && senderRole === 'member')));
    var items = [];
    if (msg.kind === 'text') items.push(['copy', '复制']);
    items.push(['reply', '回复']);
    if (!mine) items.push(['at', '@TA']);
    if (canWithdraw) items.push(['withdraw', '撤回']);
    items.push(['hide', '删除']);
    var menu = document.createElement('div');
    menu.className = 'grp-menu grp-ui'; menu.setAttribute('role', 'menu');
    menu.innerHTML = items.map(function (it) { return '<button type="button" role="menuitem" data-menu="' + it[0] + '">' + it[1] + '</button>'; }).join('');
    document.body.appendChild(menu);
    var r = anchor.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    var left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.left + r.width / 2 - mw / 2));
    var top = r.top - mh - 8 < 8 ? r.bottom + 8 : r.top - mh - 8;
    menu.style.left = left + 'px'; menu.style.top = top + 'px';
    menu.style.transformOrigin = (r.left + r.width / 2 - left) + 'px ' + (top < r.top ? '100%' : '0');
    animate(menu, [{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 140, easing: 'cubic-bezier(.2,.8,.2,1)' });
    anchor.classList.add('is-pressed');
    state.menu = { el: menu, anchor: anchor };
    menu.addEventListener('click', function (event) {
      var b = event.target.closest('[data-menu]'); if (!b) return;
      var action = b.getAttribute('data-menu'); closeMessageMenu();
      if (action === 'copy') copyText(msg.body);
      else if (action === 'reply') setReply(msg);
      else if (action === 'at') insertMentionFor(msg.sender, msg.sender_display || msg.sender);
      else if (action === 'withdraw') withdrawMessage(conv, msg);
      else if (action === 'hide') hideMessage(conv, msg);
    });
    setTimeout(function () { document.addEventListener('pointerdown', outsideMenu, true); }, 0);
  }
  function outsideMenu(event) { if (state.menu && !state.menu.el.contains(event.target)) closeMessageMenu(); }
  function closeMessageMenu() {
    document.removeEventListener('pointerdown', outsideMenu, true);
    if (!state.menu) return;
    state.menu.anchor.classList.remove('is-pressed');
    var el = state.menu.el; state.menu = null;
    var a = animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: 'forwards' });
    if (a) a.finished.then(function () { el.remove(); }, function () { el.remove(); }); else el.remove();
  }
  function insertMentionFor(user, label) {
    var input = $('groupChatInput'); if (!input) return;
    var pos = input.selectionStart == null ? input.value.length : input.selectionStart;
    input.value = input.value.slice(0, pos) + '@' + input.value.slice(pos);
    try { input.setSelectionRange(pos + 1, pos + 1); } catch (_) {}
    insertMention(user, label);
  }
  function copyText(text) {
    var done = function () { toast('已复制'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
    else { legacyCopy(text); done(); }
  }
  function legacyCopy(text) {
    var area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select(); try { document.execCommand('copy'); } catch (_) {} area.remove();
  }

  async function withdrawMessage(conv, msg) {
    try {
      var data = await api('/' + conv.id + '/actions', { method: 'POST', json: { action: 'withdraw', message_id: msg.id }, owner: conv.owner, epoch: conv.epoch });
      if (state.active !== conv) return;
      mergeMessages(conv, [data.message], 'append');
      scheduleListRefresh(150);
    } catch (error) { toast(error.message); }
  }
  async function hideMessage(conv, msg) {
    var node = conv.nodes.get(msg.id);
    try {
      await api('/' + conv.id + '/actions', { method: 'POST', json: { action: 'hide_message', message_id: msg.id }, owner: conv.owner, epoch: conv.epoch });
      if (state.active !== conv) return;
      conv.messages.delete(msg.id); conv.nodes.delete(msg.id);
      conv.order = conv.order.filter(function (id) { return id !== msg.id; });
      if (node) {
        var a = animate(node, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.94)' }], { duration: 160, easing: 'ease-in', fill: 'forwards' });
        var drop = function () { var h = node.offsetHeight, next = node.nextElementSibling; node.remove(); if (next) animate(next, [{ transform: 'translate3d(0,' + h + 'px,0)' }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' }); };
        if (a) a.finished.then(drop, drop); else drop();
      }
      scheduleListRefresh(150);
    } catch (error) { toast(error.message); }
  }

  function openImageViewer(src) {
    var overlay = document.createElement('div');
    overlay.className = 'grp-viewer grp-ui'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-label', '查看图片');
    overlay.innerHTML = '<img src="' + esc(src) + '" alt="图片"><button type="button" class="grp-viewer-x" aria-label="关闭">×</button>';
    document.body.appendChild(overlay);
    animate(overlay, [{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
    animate(overlay.querySelector('img'), [{ transform: 'scale(.92)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
    var layer = { el: overlay, close: function () {
      state.layers = state.layers.filter(function (l) { return l !== layer; });
      var a = animate(overlay, [{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' });
      if (a) a.finished.then(function () { overlay.remove(); }, function () { overlay.remove(); }); else overlay.remove();
    } };
    state.layers.push(layer);
    overlay.addEventListener('click', function (event) { if (event.target.tagName !== 'IMG' || event.target.closest('.grp-viewer-x')) layer.close(); });
  }

  // ---- view events
  function bindView(view) {
    var input = view.querySelector('#groupChatInput'), box = view.querySelector('#groupChatMessages');
    view.addEventListener('click', function (event) {
      var conv = state.active;
      var t = event.target.closest('[data-grp]');
      if (t) {
        var what = t.getAttribute('data-grp');
        if (what === 'back') closeGroup();
        else if (what === 'info') openInfo();
        else if (what === 'send') sendText();
        else if (what === 'image') view.querySelector('#groupImageInput').click();
        else if (what === 'cancel-reply') setReply(null);
        else if (what === 'retry' && conv) fetchLatest(conv);
        else if (what === 'dismiss-announce') { event.stopPropagation(); dismissAnnouncement(); }
        return;
      }
      if (event.target.closest('#groupAnnounceBar')) { openAnnouncement(); return; }
      if (event.target.closest('#groupJumpLatest')) { scrollToBottom(false); return; }
      var at = event.target.closest('[data-at]');
      if (at && conv) { var m = conv.messages.get(at.closest('[data-msg-id]').getAttribute('data-msg-id')); insertMentionFor(at.getAttribute('data-at'), m ? m.sender_display || m.sender : at.getAttribute('data-at')); return; }
      var img = event.target.closest('[data-image] img');
      if (img) { openImageViewer(img.currentSrc || img.src); return; }
      var retry = event.target.closest('[data-retry]');
      if (retry && conv) { retryLocal(conv, retry.closest('[data-msg-id]').getAttribute('data-msg-id')); return; }
      var quote = event.target.closest('[data-quote]');
      if (quote && conv) { jumpToMessage(conv, quote.getAttribute('data-quote')); return; }
      var mention = event.target.closest('[data-mention]');
      if (mention) { insertMention(mention.getAttribute('data-mention'), mention.getAttribute('data-label')); }
    });
    input.addEventListener('input', function () { syncSendButton(); showMentionPop(); if (state.active) saveDraft(state.active.id, input.value); });
    input.addEventListener('keydown', function (event) {
      var pop = $('groupMentionPop');
      if (!pop.hidden && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].indexOf(event.key) >= 0) {
        var options = Array.prototype.slice.call(pop.querySelectorAll('[data-mention]')), at = options.findIndex(function (o) { return o.classList.contains('is-active'); });
        event.preventDefault();
        if (event.key === 'Escape') { hideMentionPop(); return; }
        if (event.key === 'Enter' || event.key === 'Tab') { var pick = options[Math.max(0, at)]; if (pick) insertMention(pick.getAttribute('data-mention'), pick.getAttribute('data-label')); return; }
        var next = (at + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options.forEach(function (o, i) { o.classList.toggle('is-active', i === next); });
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        if (!coarse || input.getAttribute('enterkeyhint') === 'send') { event.preventDefault(); sendText(); }
      }
    });
    input.addEventListener('blur', function () { setTimeout(hideMentionPop, 150); });
    input.addEventListener('paste', function (event) {
      var files = event.clipboardData && Array.prototype.filter.call(event.clipboardData.files || [], function (f) { return /^image\//.test(f.type); });
      if (files && files.length) { event.preventDefault(); sendImages(files); }
    });
    view.querySelector('#groupImageInput').addEventListener('change', function (event) {
      var files = event.target.files; sendImages(files); event.target.value = '';
    });
    box.addEventListener('scroll', function () {
      if (box.scrollTop < 80 && state.active) fetchOlder(state.active);
      if (isNearBottom()) $('groupJumpLatest').hidden = true;
      if (state.menu) closeMessageMenu();
    }, { passive: true });
    // Long press on touch, right click on desktop.
    var press = null;
    box.addEventListener('pointerdown', function (event) {
      var bubble = event.target.closest('.grp-bubble'); if (!bubble || event.button > 0) return;
      if (event.target.closest('a,[data-quote]')) return;
      var x = event.clientX, y = event.clientY;
      press = { bubble: bubble, x: x, y: y, timer: setTimeout(function () {
        press = null; var conv = state.active; if (!conv) return;
        var id = bubble.closest('[data-msg-id]').getAttribute('data-msg-id');
        if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) {}
        openMessageMenu(conv, conv.messages.get(id), bubble);
        bubble.__suppressClick = true;
      }, 420) };
    });
    function cancelPress(event) { if (!press) return; if (event && event.type === 'pointermove' && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 8) return; clearTimeout(press.timer); press = null; }
    box.addEventListener('pointermove', cancelPress, { passive: true });
    box.addEventListener('pointerup', cancelPress);
    box.addEventListener('pointercancel', cancelPress);
    box.addEventListener('click', function (event) { var b = event.target.closest('.grp-bubble'); if (b && b.__suppressClick) { b.__suppressClick = false; event.stopPropagation(); event.preventDefault(); } }, true);
    box.addEventListener('contextmenu', function (event) {
      var bubble = event.target.closest('.grp-bubble'); if (!bubble || !state.active) return;
      event.preventDefault();
      openMessageMenu(state.active, state.active.messages.get(bubble.closest('[data-msg-id]').getAttribute('data-msg-id')), bubble);
    });
    box.addEventListener('keydown', function (event) {
      var bubble = event.target.closest && event.target.closest('.grp-bubble');
      if (bubble && state.active && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
        event.preventDefault(); openMessageMenu(state.active, state.active.messages.get(bubble.closest('[data-msg-id]').getAttribute('data-msg-id')), bubble);
      }
    });
  }

  async function jumpToMessage(conv, id) {
    for (var i = 0; i < 12 && !conv.nodes.has(id) && conv.hasMore && state.active === conv; i++) await fetchOlder(conv);
    var node = conv.nodes.get(id);
    if (!node) { toast('原消息已不在可见记录中'); return; }
    node.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    node.classList.remove('grp-flash'); void node.offsetWidth; node.classList.add('grp-flash');
  }

  function dismissAnnouncement() {
    var conv = state.active; if (!conv || !conv.detail) return;
    try { localStorage.setItem('xtj_grp_ann_' + me() + '_' + conv.id, String(conv.detail.group.announcement_at || '')); } catch (_) {}
    var bar = $('groupAnnounceBar');
    var a = animate(bar, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(0,-6px,0)' }], { duration: 150, fill: 'forwards' });
    var hide = function () { bar.hidden = true; if (a) a.cancel(); };
    if (a) a.finished.then(hide, hide); else hide();
  }

  // ---------------------------------------------------------- info page
  function closeInfo(immediate) {
    var panel = $('groupInfoPanel');
    if (!state.info) { if (panel) panel.hidden = true; return; }
    state.info = null;
    if (!panel || panel.hidden) return;
    var a = !immediate && animate(panel, [{ transform: 'none' }, { transform: 'translate3d(100%,0,0)' }], { duration: 240, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
    var done = function () { if (!state.info) panel.hidden = true; if (a) a.cancel(); };
    if (a) a.finished.then(done, done); else done();
  }

  function openInfo() {
    var conv = state.active; if (!conv) return;
    var view = $('groupChatView'), panel = $('groupInfoPanel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'groupInfoPanel'; panel.className = 'grp-info'; panel.hidden = true; panel.setAttribute('aria-label', '聊天信息');
      view.appendChild(panel);
      panel.addEventListener('click', onInfoClick);
      panel.addEventListener('change', onInfoChange);
    }
    state.info = { conv: conv };
    renderInfo();
    panel.hidden = false;
    animate(panel, [{ transform: 'translate3d(100%,0,0)' }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.22,.7,.25,1)' });
    if (!conv.detail) refreshDetail(conv);
  }

  function infoRow(action, label, value, extra) {
    return '<button type="button" class="grp-info-row" data-info="' + action + '"><span>' + esc(label) + '</span><span class="grp-info-value">' + (value || '') + '</span>' + (extra === 'no-arrow' ? '' : '<i class="grp-arrow" aria-hidden="true"></i>') + '</button>';
  }
  function switchRow(action, label, checked, hint) {
    return '<label class="grp-info-row is-switch"><span>' + esc(label) + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</span><input type="checkbox" role="switch" data-switch="' + action + '"' + (checked ? ' checked' : '') + '><i class="grp-switch" aria-hidden="true"></i></label>';
  }

  function renderInfo() {
    var panel = $('groupInfoPanel'), info = state.info; if (!panel || !info) return;
    var conv = info.conv, d = conv.detail;
    if (!d) { panel.innerHTML = infoHead('聊天信息') + '<div class="grp-loading"><span class="grp-spinner"></span></div>'; return; }
    var g = d.group, mine = d.me, admin = mine.role !== 'member', owner = mine.role === 'owner';
    var canInvite = !g.dissolved && (g.invite_policy === 'all' || admin);
    var shown = d.members.slice(0, canInvite ? (admin ? 18 : 19) : 20);
    var grid = shown.map(function (m) {
      return '<button type="button" class="grp-member" data-member="' + esc(m.user_name) + '">' + avatarHtml(m.user_name) +
        '<span>' + esc(m.nickname || m.user_name) + '</span>' + (m.role !== 'member' ? '<em class="grp-role is-' + m.role + '">' + (m.role === 'owner' ? '群主' : '管理') + '</em>' : '') + '</button>';
    }).join('');
    if (canInvite) grid += '<button type="button" class="grp-member is-tool" data-info="invite"><span class="grp-tool-icon">+</span><span>邀请</span></button>';
    if (admin && !g.dissolved) grid += '<button type="button" class="grp-member is-tool" data-info="remove"><span class="grp-tool-icon">−</span><span>移出</span></button>';
    var html = infoHead('聊天信息（' + g.member_count + '）') + '<div class="grp-info-scroll">' +
      '<div class="grp-info-card"><div class="grp-member-grid">' + grid + '</div>' +
      (d.members.length > shown.length ? '<button type="button" class="grp-more" data-info="members">查看全部群成员（' + g.member_count + '）<i class="grp-arrow"></i></button>' : '') + '</div>';
    if (g.dissolved) {
      html += '<div class="grp-info-card"><p class="grp-dissolved">该群聊已被群主解散，你仍可查看之前的聊天记录。</p></div>' +
        '<div class="grp-info-card">' + infoRow('search', '查找聊天内容') + infoRow('clear', '清空聊天记录') + '</div>' +
        '<button type="button" class="grp-danger" data-info="leave">删除并退出</button></div>';
      panel.innerHTML = html; ensureAvatars(shown.map(function (m) { return m.user_name; }), panel); return;
    }
    html += '<div class="grp-info-card">' +
      infoRow('rename', '群聊名称', esc(g.name)) +
      infoRow('qr', '群二维码', '<svg class="grp-qr-mini" viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/></svg>') +
      infoRow('announce', '群公告', g.announcement ? '<span class="grp-info-ann">' + esc(g.announcement.slice(0, 60)) + '</span>' : '<span class="grp-muted">未设置</span>') +
      (admin ? infoRow('manage', '群管理', g.pending_requests ? '<span class="grp-dot">' + g.pending_requests + '</span>' : '') : '') + '</div>' +
      '<div class="grp-info-card">' + infoRow('search', '查找聊天内容') + '</div>' +
      '<div class="grp-info-card">' + switchRow('muted', '消息免打扰', mine.muted) + switchRow('pinned', '置顶聊天', !!mine.pinned_at) + '</div>' +
      '<div class="grp-info-card">' + infoRow('nickname', '我在本群的昵称', esc(mine.nickname || me())) + infoRow('background', '设置当前聊天背景',
        esc((BACKGROUNDS.find(function (b) { return b.id === (mine.background || ''); }) || BACKGROUNDS[0]).label)) + '</div>' +
      '<div class="grp-info-card">' + infoRow('clear', '清空聊天记录') + infoRow('report', '投诉') + '</div>' +
      '<button type="button" class="grp-danger" data-info="leave">退出群聊</button>' +
      (owner ? '<button type="button" class="grp-danger is-quiet" data-info="dissolve">解散群聊</button>' : '') + '</div>';
    panel.innerHTML = html;
    ensureAvatars(shown.map(function (m) { return m.user_name; }), panel);
  }
  function infoHead(title) {
    return '<header class="grp-head"><button type="button" class="grp-icon-btn" data-info="close" aria-label="返回聊天"><svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg></button><div class="grp-title"><h3>' + esc(title) + '</h3></div><span class="grp-head-spacer"></span></header>';
  }

  async function groupAction(conv, payload, okText) {
    try {
      var data = await api('/' + conv.id + '/actions', { method: 'POST', json: payload, owner: conv.owner, epoch: conv.epoch });
      if (okText) toast(okText);
      if (state.active === conv) { await refreshDetail(conv); fetchNewer(conv); }
      scheduleListRefresh(100);
      return data;
    } catch (error) {
      if (error.code !== 'identity_changed') toast(error.message);
      return null;
    }
  }

  async function onInfoChange(event) {
    var input = event.target.closest('[data-switch]'); if (!input || !state.info) return;
    var conv = state.info.conv, key = input.getAttribute('data-switch'), on = input.checked;
    input.disabled = true;
    var payload = key === 'muted' ? { action: 'set_muted', muted: on } : key === 'pinned' ? { action: 'set_pinned', pinned: on }
      : key === 'mute_all' ? { action: 'set_mute_all', enabled: on } : key === 'join_approval' ? { action: 'set_join_approval', enabled: on }
      : key === 'invite_admins' ? { action: 'set_invite_policy', policy: on ? 'admins' : 'all' } : null;
    if (!payload) return;
    var ok = await groupAction(conv, payload);
    input.disabled = false;
    if (!ok) input.checked = !on;
  }

  async function onInfoClick(event) {
    var target = event.target.closest('[data-info],[data-member]'); if (!target || !state.info) return;
    var conv = state.info.conv, d = conv.detail;
    if (target.hasAttribute('data-member')) { openMemberCard(conv, target.getAttribute('data-member')); return; }
    var what = target.getAttribute('data-info');
    if (what === 'close') { closeInfo(); return; }
    if (!d) return;
    var g = d.group;
    if (what === 'invite') {
      var exclude = Object.create(null); d.members.forEach(function (m) { exclude[m.user_name] = true; });
      var picked = await pickFriends({ title: '邀请好友入群', okText: '邀请', exclude: exclude, existing: g.member_count });
      if (!picked) return;
      picked.button.disabled = true;
      var res = await groupAction(conv, { action: 'invite', members: picked.members });
      picked.layer.close();
      if (res) toast(res.pending && res.pending.length ? '已发送入群邀请，等待群主或管理员确认' : '已邀请 ' + (res.added || []).length + ' 位好友');
    } else if (what === 'remove' || what === 'members') {
      openMemberList(conv, what === 'remove');
    } else if (what === 'rename') {
      if (d.me.role === 'member') { toast('只有群主或管理员可以修改群名称'); return; }
      var name = await promptBox('修改群聊名称', '修改后将通知全体成员', g.name, 30);
      if (name == null) return;
      if (!name.trim()) { toast('群名称不能为空'); return; }
      await groupAction(conv, { action: 'rename', name: name.trim() }, '群名称已修改');
    } else if (what === 'qr') {
      openQr(conv);
    } else if (what === 'announce') {
      openAnnouncement();
    } else if (what === 'manage') {
      openManage(conv);
    } else if (what === 'search') {
      openSearch(conv);
    } else if (what === 'nickname') {
      var nick = await promptBox('我在本群的昵称', '昵称只在这个群里显示，最多 20 个字，留空则使用账号名', d.me.nickname || '', 20);
      if (nick == null) return;
      await groupAction(conv, { action: 'set_nickname', nickname: nick.trim() }, '群昵称已更新');
    } else if (what === 'background') {
      openBackgroundPicker(conv);
    } else if (what === 'clear') {
      if (!(await confirmBox('清空聊天记录', '只清空你在这个群里看到的聊天记录，其他成员不受影响。', '清空'))) return;
      var cleared = await groupAction(conv, { action: 'clear_history' }, '聊天记录已清空');
      if (cleared && state.active === conv) { conv.messages.clear(); conv.nodes.clear(); conv.order = []; conv.hasMore = false; $('groupStream').innerHTML = ''; }
    } else if (what === 'report') {
      openReport(conv);
    } else if (what === 'leave') {
      var ownerLeaving = d.me.role === 'owner' && !g.dissolved;
      var message = g.dissolved ? '删除后，这个群聊会从你的列表中移除。' : ownerLeaving ? '你是群主，退出后群主会自动转让给最早加入的管理员（没有管理员则为最早加入的成员）。' : '退出后不会再收到这个群聊的消息。';
      if (!(await confirmBox(g.dissolved ? '删除并退出' : '退出群聊', message, g.dissolved ? '删除' : '退出'))) return;
      var left = await groupAction(conv, { action: 'leave' });
      if (left) { closeGroup(); toast(g.dissolved ? '已删除群聊' : '已退出群聊'); }
    } else if (what === 'dissolve') {
      if (!(await confirmBox('解散群聊', '解散后所有成员都不能再发言，此操作不能撤销。', '解散'))) return;
      await groupAction(conv, { action: 'dissolve' }, '群聊已解散');
    }
  }

  // ---- member list & member card
  function openMemberList(conv, removeMode) {
    var d = conv.detail; if (!d) return;
    var admin = d.me.role !== 'member';
    function rowHtml(m) {
      var banned = m.banned_until && new Date(m.banned_until) > new Date();
      return '<button type="button" class="grp-member-row" data-member="' + esc(m.user_name) + '" data-search="' + esc((m.nickname || '') + ' ' + m.user_name).toLowerCase() + '">' +
        avatarHtml(m.user_name) + '<span class="grp-member-name">' + esc(m.nickname || m.user_name) + (m.nickname ? '<small>' + esc(m.user_name) + '</small>' : '') + '</span>' +
        (m.role !== 'member' ? '<em class="grp-role is-' + m.role + '">' + (m.role === 'owner' ? '群主' : '管理员') + '</em>' : '') +
        (banned ? '<em class="grp-role is-banned">禁言中</em>' : '') + (m.user_name === me() ? '<em class="grp-role">我</em>' : '') + '</button>';
    }
    var body = '<div class="grp-search"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input type="search" id="grpMemberFilter" placeholder="搜索群成员" aria-label="搜索群成员"></div>' +
      (removeMode ? '<p class="grp-hint">点选要移出群聊的成员</p>' : '') + '<div class="grp-member-list" id="grpMemberList"></div>';
    var layer = openSheet((removeMode ? '移出成员' : '群成员') + '（' + d.group.member_count + '）', body, { wide: true });
    var list = layer.el.querySelector('#grpMemberList'), members = d.members, rendered = 0;
    // Render 1000 members in chunks so the sheet opens instantly.
    function renderChunk() {
      var chunk = members.slice(rendered, rendered + 120).filter(function (m) { return !removeMode || canManage(d, m); });
      list.insertAdjacentHTML('beforeend', chunk.map(rowHtml).join(''));
      ensureAvatars(members.slice(rendered, rendered + 120).map(function (m) { return m.user_name; }), list);
      rendered += 120;
      if (rendered < members.length) requestAnimationFrame(renderChunk);
    }
    renderChunk();
    layer.el.querySelector('#grpMemberFilter').addEventListener('input', function (event) {
      var q = event.target.value.trim().toLowerCase();
      list.querySelectorAll('[data-member]').forEach(function (row) { row.hidden = !!q && row.getAttribute('data-search').indexOf(q) < 0; });
    });
    list.addEventListener('click', async function (event) {
      var row = event.target.closest('[data-member]'); if (!row) return;
      var name = row.getAttribute('data-member');
      if (removeMode) {
        var m = members.find(function (x) { return x.user_name === name; });
        if (!(await confirmBox('移出群聊', '确定将 ' + (m && m.nickname || name) + ' 移出群聊吗？', '移出'))) return;
        var ok = await groupAction(conv, { action: 'remove_member', user_name: name }, '已移出');
        if (ok) { var h = row.offsetHeight; var a = animate(row, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(24px,0,0)' }], { duration: 180, fill: 'forwards' }); var rm = function () { row.remove(); }; if (a) a.finished.then(rm, rm); else rm(); void h; }
        return;
      }
      openMemberCard(conv, name);
    });
    void admin;
  }
  function canManage(d, m) {
    if (m.user_name === me()) return false;
    if (d.me.role === 'owner') return true;
    return d.me.role === 'admin' && m.role === 'member';
  }

  function openMemberCard(conv, userName) {
    var d = conv.detail; if (!d) return;
    var m = d.members.find(function (x) { return x.user_name === userName; }); if (!m) return;
    var self = userName === me(), manage = canManage(d, m) && !d.group.dissolved, owner = d.me.role === 'owner';
    var banned = m.banned_until && new Date(m.banned_until) > new Date();
    var actions = '';
    if (!self && m.active) actions += '<button type="button" class="grp-action" data-card="dm">发消息</button><button type="button" class="grp-action" data-card="at">@TA</button>';
    if (manage) {
      if (owner) actions += '<button type="button" class="grp-action" data-card="' + (m.role === 'admin' ? 'unset_admin' : 'set_admin') + '">' + (m.role === 'admin' ? '取消管理员' : '设为管理员') + '</button>';
      actions += banned ? '<button type="button" class="grp-action" data-card="unban">解除禁言</button>' : '<button type="button" class="grp-action" data-card="ban">禁言</button>';
      if (owner && m.active) actions += '<button type="button" class="grp-action" data-card="transfer">转让群主</button>';
      actions += '<button type="button" class="grp-action is-danger" data-card="remove">移出群聊</button>';
    }
    var body = '<div class="grp-card-head">' + avatarHtml(userName, 'grp-user-avatar is-large') + '<div><strong>' + esc(m.nickname || userName) + '</strong>' +
      (m.nickname ? '<span>账号：' + esc(userName) + '</span>' : '') + '<span>' + (m.role === 'owner' ? '群主' : m.role === 'admin' ? '管理员' : '成员') +
      ' · ' + esc(formatTime(m.joined_at, true)) + ' 入群</span>' + (banned ? '<span class="grp-warn">禁言至 ' + esc(formatTime(m.banned_until, true)) + '</span>' : '') + '</div></div>' +
      (actions ? '<div class="grp-card-actions">' + actions + '</div>' : '');
    var layer = openSheet('成员资料', body);
    ensureAvatars([userName], layer.el);
    layer.el.addEventListener('click', async function (event) {
      var b = event.target.closest('[data-card]'); if (!b) return;
      var what = b.getAttribute('data-card');
      if (what === 'dm') { layer.close(); closeAllSheets(); closeGroup(true); if (typeof window.openChat === 'function') window.openChat(userName); return; }
      if (what === 'at') { layer.close(); closeAllSheets(); closeInfo(); insertMentionFor(userName, m.nickname || userName); return; }
      if (what === 'ban') { layer.close(); openBanPicker(conv, m); return; }
      var label = m.nickname || userName;
      if (what === 'remove' && !(await confirmBox('移出群聊', '确定将 ' + label + ' 移出群聊吗？', '移出'))) return;
      if (what === 'transfer' && !(await confirmBox('转让群主', '转让后你将成为管理员，' + label + ' 将成为新群主。', '转让'))) return;
      b.disabled = true;
      var payload = { action: what === 'remove' ? 'remove_member' : what, user_name: userName };
      var done = await groupAction(conv, payload, { set_admin: '已设为管理员', unset_admin: '已取消管理员', unban: '已解除禁言', transfer: '群主已转让', remove: '已移出群聊' }[what]);
      if (done) { layer.close(); closeAllSheets(); if (state.info) renderInfo(); }
      else b.disabled = false;
    });
  }

  function openBanPicker(conv, m) {
    var body = '<p class="grp-hint">禁言期间 ' + esc(m.nickname || m.user_name) + ' 不能在群里发言</p><div class="grp-option-list">' +
      BAN_OPTIONS.map(function (o) { return '<button type="button" class="grp-option" data-minutes="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>';
    var layer = openSheet('禁言时长', body);
    layer.el.addEventListener('click', async function (event) {
      var b = event.target.closest('[data-minutes]'); if (!b) return;
      b.disabled = true;
      var ok = await groupAction(conv, { action: 'ban', user_name: m.user_name, minutes: Number(b.getAttribute('data-minutes')) }, '已禁言');
      if (ok) closeAllSheets(); else b.disabled = false;
    });
  }

  // ---- management
  function openManage(conv) {
    var d = conv.detail; if (!d) return;
    var g = d.group, owner = d.me.role === 'owner';
    var body = '<div class="grp-info-card">' + switchRow('mute_all', '全员禁言', g.mute_all, '开启后只有群主和管理员可以发言') +
      switchRow('join_approval', '进群需要审批', g.join_approval, '成员邀请或扫码入群需群主/管理员确认') +
      (owner ? switchRow('invite_admins', '仅群主和管理员可邀请', g.invite_policy === 'admins') : '') + '</div>' +
      '<div class="grp-info-card">' + infoRow('requests', '进群申请', g.pending_requests ? '<span class="grp-dot">' + g.pending_requests + '</span>' : '<span class="grp-muted">暂无</span>') +
      (owner ? infoRow('admins', '设置管理员', '<span class="grp-muted">' + d.members.filter(function (m) { return m.role === 'admin'; }).length + ' / 15</span>') : '') +
      infoRow('banned', '禁言成员', '<span class="grp-muted">' + d.members.filter(function (m) { return m.banned_until; }).length + ' 人</span>') +
      (owner ? infoRow('transfer', '群主管理权转让') : '') + infoRow('reset_qr', '重置群二维码', '', 'no-arrow') + '</div>';
    var layer = openSheet('群管理', body, { back: true });
    layer.el.addEventListener('change', async function (event) {
      var input = event.target.closest('[data-switch]'); if (!input) return;
      var key = input.getAttribute('data-switch'), on = input.checked; input.disabled = true;
      var ok = await groupAction(conv, key === 'mute_all' ? { action: 'set_mute_all', enabled: on } : key === 'join_approval' ? { action: 'set_join_approval', enabled: on } : { action: 'set_invite_policy', policy: on ? 'admins' : 'all' });
      input.disabled = false; if (!ok) input.checked = !on;
    });
    layer.el.addEventListener('click', async function (event) {
      var b = event.target.closest('[data-info]'); if (!b) return;
      var what = b.getAttribute('data-info');
      if (what === 'requests') openRequests(conv);
      else if (what === 'admins' || what === 'transfer' || what === 'banned') openMemberPicker(conv, what);
      else if (what === 'reset_qr') {
        if (!(await confirmBox('重置群二维码', '重置后，之前分享的二维码和链接将立即失效。', '重置'))) return;
        await groupAction(conv, { action: 'reset_qr' }, '二维码已重置');
      }
    });
  }

  function openMemberPicker(conv, mode) {
    var d = conv.detail; if (!d) return;
    var list = d.members.filter(function (m) {
      if (m.user_name === me()) return false;
      if (mode === 'banned') return !!m.banned_until;
      if (mode === 'admins') return m.role !== 'owner' && m.active;
      return m.active;
    });
    var title = mode === 'admins' ? '设置管理员' : mode === 'transfer' ? '选择新群主' : '禁言成员';
    var body = list.length ? '<div class="grp-member-list">' + list.map(function (m) {
      var right = mode === 'admins' ? (m.role === 'admin' ? '<em class="grp-role is-admin">管理员</em>' : '') : mode === 'banned' ? '<em class="grp-role is-banned">至 ' + esc(formatTime(m.banned_until, true)) + '</em>' : '';
      return '<button type="button" class="grp-member-row" data-pick="' + esc(m.user_name) + '">' + avatarHtml(m.user_name) + '<span class="grp-member-name">' + esc(m.nickname || m.user_name) + '</span>' + right + '</button>';
    }).join('') + '</div>' : '<p class="grp-empty">' + (mode === 'banned' ? '当前没有被禁言的成员' : '暂无可选成员') + '</p>';
    var layer = openSheet(title, body, { back: true, wide: true });
    ensureAvatars(list.map(function (m) { return m.user_name; }), layer.el);
    layer.el.addEventListener('click', async function (event) {
      var b = event.target.closest('[data-pick]'); if (!b) return;
      var name = b.getAttribute('data-pick'), m = d.members.find(function (x) { return x.user_name === name; });
      if (mode === 'admins') {
        var on = m.role !== 'admin';
        if (await groupAction(conv, { action: on ? 'set_admin' : 'unset_admin', user_name: name }, on ? '已设为管理员' : '已取消管理员')) closeAllSheets();
      } else if (mode === 'transfer') {
        if (!(await confirmBox('转让群主', '转让后你将成为管理员，' + (m.nickname || name) + ' 将成为新群主。', '转让'))) return;
        if (await groupAction(conv, { action: 'transfer', user_name: name }, '群主已转让')) closeAllSheets();
      } else if (mode === 'banned') {
        if (await groupAction(conv, { action: 'unban', user_name: name }, '已解除禁言')) closeAllSheets();
      }
    });
  }

  async function openRequests(conv) {
    var layer = openSheet('进群申请', '<div class="grp-loading"><span class="grp-spinner"></span></div>', { back: true });
    var body = layer.el.querySelector('.grp-sheet-body');
    async function load() {
      try {
        var data = await api('/' + conv.id + '/actions', { method: 'POST', json: { action: 'list_requests' }, owner: conv.owner, epoch: conv.epoch });
        var rows = data.requests || [];
        body.innerHTML = rows.length ? rows.map(function (r) {
          return '<div class="grp-request" data-request="' + esc(r.id) + '">' + avatarHtml(r.user_name) + '<div><strong>' + esc(r.user_name) + '</strong><span>' +
            esc(r.inviter ? r.inviter + ' 邀请入群' : '通过二维码申请') + (r.note ? '：' + esc(r.note) : '') + '</span></div>' +
            '<button type="button" class="grp-chip-btn" data-decide="reject">拒绝</button><button type="button" class="grp-chip-btn is-primary" data-decide="approve">同意</button></div>';
        }).join('') : '<p class="grp-empty">暂无进群申请</p>';
        ensureAvatars(rows.map(function (r) { return r.user_name; }), body);
      } catch (error) { body.innerHTML = '<p class="grp-empty">' + esc(error.message) + '</p>'; }
    }
    body.addEventListener('click', async function (event) {
      var b = event.target.closest('[data-decide]'); if (!b) return;
      var row = b.closest('[data-request]'); row.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
      var approve = b.getAttribute('data-decide') === 'approve';
      var ok = await groupAction(conv, { action: approve ? 'approve_request' : 'reject_request', request_id: row.getAttribute('data-request') }, approve ? '已同意' : '已拒绝');
      if (ok) row.remove(); else row.querySelectorAll('button').forEach(function (x) { x.disabled = false; });
      if (!body.querySelector('[data-request]')) body.innerHTML = '<p class="grp-empty">暂无进群申请</p>';
    });
    load();
  }

  // ---- announcement
  function openAnnouncement() {
    var conv = state.active; if (!conv || !conv.detail) return;
    var g = conv.detail.group, admin = conv.detail.me.role !== 'member' && !g.dissolved;
    var body = g.announcement
      ? '<div class="grp-ann-meta">' + avatarHtml(g.announcement_by || g.owner) + '<div><strong>' + esc(g.announcement_by || '') + '</strong><span>' + esc(formatTime(g.announcement_at, true)) + '</span></div></div><div class="grp-ann-body">' + linkify(g.announcement) + '</div>'
      : '<p class="grp-empty">暂未设置群公告</p>';
    if (admin) body += '<div class="grp-ann-edit" hidden><textarea id="grpAnnInput" maxlength="2000" rows="6" placeholder="输入群公告，发布后会 @所有人">' + esc(g.announcement) + '</textarea></div>';
    var layer = openSheet('群公告', body, {
      footer: admin ? '<button type="button" class="grp-secondary" data-ann="edit">' + (g.announcement ? '编辑' : '发布公告') + '</button>' + (g.announcement ? '<button type="button" class="grp-secondary is-danger" data-ann="clear">清空</button>' : '') : '',
      wide: true
    });
    ensureAvatars([g.announcement_by || g.owner], layer.el);
    dismissAnnouncement();
    layer.el.addEventListener('click', async function (event) {
      var b = event.target.closest('[data-ann]'); if (!b) return;
      var what = b.getAttribute('data-ann'), editor = layer.el.querySelector('.grp-ann-edit');
      if (what === 'edit') {
        editor.hidden = false; layer.el.querySelectorAll('.grp-ann-body,.grp-ann-meta,.grp-empty').forEach(function (n) { n.hidden = true; });
        b.setAttribute('data-ann', 'save'); b.textContent = '发布'; b.className = 'grp-primary';
        layer.el.querySelector('#grpAnnInput').focus();
      } else if (what === 'save' || what === 'clear') {
        if (what === 'clear' && !(await confirmBox('清空群公告', '清空后成员将看不到群公告。', '清空'))) return;
        var text = what === 'clear' ? '' : layer.el.querySelector('#grpAnnInput').value.trim();
        if (what === 'save' && !text) { toast('公告内容不能为空'); return; }
        b.disabled = true;
        if (await groupAction(conv, { action: 'announce', announcement: text }, what === 'clear' ? '群公告已清空' : '群公告已发布')) layer.close();
        else b.disabled = false;
      }
    });
  }

  // ---- QR code
  var qrLoader = null;
  function loadQrLibrary() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!qrLoader) qrLoader = new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = 'js/vendor/qrcode-generator-1.4.4.min.js'; s.async = true;
      s.onload = function () { window.qrcode ? resolve(window.qrcode) : reject(new Error('二维码组件加载失败')); };
      s.onerror = function () { qrLoader = null; reject(new Error('二维码组件加载失败')); };
      document.head.appendChild(s);
    });
    return qrLoader;
  }
  function joinLink(token) { return location.origin + '/?group_join=' + encodeURIComponent(token); }
  function drawQr(canvas, text, size) {
    var qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
    var count = qr.getModuleCount(), margin = 2, cell = Math.floor(size / (count + margin * 2));
    var real = cell * (count + margin * 2), ratio = window.devicePixelRatio || 1;
    canvas.width = real * ratio; canvas.height = real * ratio; canvas.style.width = real + 'px'; canvas.style.height = real + 'px';
    var ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, real, real); ctx.fillStyle = '#16302a';
    for (var r = 0; r < count; r++) for (var c = 0; c < count; c++) if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    return real;
  }
  async function openQr(conv) {
    var d = conv.detail; if (!d) return;
    var g = d.group, admin = d.me.role !== 'member';
    var body = '<div class="grp-qr-card" id="grpQrCard"><div class="grp-qr-head">' + groupAvatarHtml(g, 'grp-avatar is-large') + '<div><strong>' + esc(g.name) + '</strong><span>' + g.member_count + ' 位成员</span></div></div>' +
      '<div class="grp-qr-box"><canvas id="grpQrCanvas" aria-label="群二维码"></canvas></div><p>扫一扫二维码，加入群聊' + (g.join_approval ? '（需群主或管理员同意）' : '') + '</p></div>';
    var layer = openSheet('群二维码', body, {
      footer: '<button type="button" class="grp-secondary" data-qr="copy">复制邀请链接</button><button type="button" class="grp-primary" data-qr="save">保存图片</button>' +
        (admin ? '<button type="button" class="grp-secondary" data-qr="reset">重置</button>' : '')
    });
    var canvas = layer.el.querySelector('#grpQrCanvas');
    try { await loadQrLibrary(); drawQr(canvas, joinLink(g.qr_token), 220); }
    catch (error) { canvas.replaceWith(Object.assign(document.createElement('p'), { textContent: error.message })); }
    layer.el.addEventListener('click', async function (event) {
      var b = event.target.closest('[data-qr]'); if (!b) return;
      var what = b.getAttribute('data-qr');
      if (what === 'copy') copyText(joinLink(conv.detail.group.qr_token));
      else if (what === 'save') saveQrImage(conv.detail.group);
      else if (what === 'reset') {
        if (!(await confirmBox('重置群二维码', '重置后，之前分享的二维码和链接将立即失效。', '重置'))) return;
        if (await groupAction(conv, { action: 'reset_qr' }, '二维码已重置') && conv.detail) drawQr(layer.el.querySelector('#grpQrCanvas'), joinLink(conv.detail.group.qr_token), 220);
      }
    });
  }
  function saveQrImage(g) {
    var w = 600, h = 760, canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f4faf6'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff'; roundRect(ctx, 40, 40, w - 80, h - 80, 28); ctx.fill();
    ctx.fillStyle = 'hsl(' + hue(g.id) + ',48%,46%)'; roundRect(ctx, 80, 80, 96, 96, 22); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '600 36px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(initials(g.name), 128, 130);
    ctx.textAlign = 'left'; ctx.fillStyle = '#1d3a30'; ctx.font = '600 32px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(g.name.length > 12 ? g.name.slice(0, 12) + '…' : g.name, 200, 112);
    ctx.fillStyle = '#6b8578'; ctx.font = '24px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(g.member_count + ' 位成员', 200, 154);
    var qrCanvas = document.createElement('canvas'); var saveRatio = window.devicePixelRatio; window.devicePixelRatio = 1;
    var size = drawQr(qrCanvas, joinLink(g.qr_token), 400); window.devicePixelRatio = saveRatio;
    ctx.drawImage(qrCanvas, (w - size) / 2, 220, size, size);
    ctx.textAlign = 'center'; ctx.fillStyle = '#6b8578'; ctx.font = '24px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('扫一扫二维码，加入群聊', w / 2, 220 + size + 40);
    canvas.toBlob(function (blob) {
      if (!blob) { toast('保存失败'); return; }
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '群二维码-' + g.name.replace(/[\\/:*?"<>|]/g, '') + '.png';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      toast('二维码已保存');
    }, 'image/png');
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  // ---- search in group
  function openSearch(conv) {
    var body = '<form class="grp-search" id="grpSearchForm"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input type="search" id="grpSearchInput" maxlength="60" placeholder="搜索群聊记录" aria-label="搜索群聊记录" autofocus></form><div class="grp-search-results" id="grpSearchResults" aria-live="polite"><p class="grp-empty">输入关键词查找文字消息</p></div>';
    var layer = openSheet('查找聊天内容', body, { wide: true, back: true });
    var input = layer.el.querySelector('#grpSearchInput'), results = layer.el.querySelector('#grpSearchResults'), seq = 0, timer = 0;
    async function run() {
      var q = input.value.trim(), mine = ++seq;
      if (!q) { results.innerHTML = '<p class="grp-empty">输入关键词查找文字消息</p>'; return; }
      results.innerHTML = '<div class="grp-loading"><span class="grp-spinner"></span></div>';
      try {
        var data = await api('/' + conv.id + '/search?q=' + encodeURIComponent(q), { owner: conv.owner, epoch: conv.epoch });
        if (mine !== seq) return;
        var rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        results.innerHTML = data.messages.length ? data.messages.map(function (m) {
          return '<button type="button" class="grp-search-row" data-jump="' + esc(m.id) + '">' + avatarHtml(m.sender) + '<div><span class="grp-search-meta"><strong>' + esc(m.sender_display || m.sender) + '</strong><time>' + esc(formatTime(m.created_at, true)) + '</time></span>' +
            '<span class="grp-search-text">' + esc(m.body).replace(rx, function (x) { return '<mark>' + x + '</mark>'; }) + '</span></div></button>';
        }).join('') : '<p class="grp-empty">没有找到相关聊天记录</p>';
        ensureAvatars(data.messages.map(function (m) { return m.sender; }), results);
      } catch (error) { if (mine === seq) results.innerHTML = '<p class="grp-empty">' + esc(error.message) + '</p>'; }
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 280); });
    layer.el.querySelector('#grpSearchForm').addEventListener('submit', function (event) { event.preventDefault(); run(); });
    results.addEventListener('click', function (event) {
      var b = event.target.closest('[data-jump]'); if (!b) return;
      closeAllSheets(); closeInfo();
      jumpToMessage(conv, b.getAttribute('data-jump'));
    });
  }

  // ---- background
  function openBackgroundPicker(conv) {
    var current = conv.detail && conv.detail.me.background || '';
    var body = '<div class="grp-bg-grid">' + BACKGROUNDS.map(function (b) {
      return '<button type="button" class="grp-bg-swatch grp-bg-' + (b.id || 'default') + (b.id === current ? ' is-active' : '') + '" data-bg="' + b.id + '" aria-pressed="' + (b.id === current) + '"><span>' + esc(b.label) + '</span></button>';
    }).join('') + '</div><p class="grp-hint">背景只在你自己的设备和账号上生效</p>';
    var layer = openSheet('设置当前聊天背景', body, { back: true });
    layer.el.addEventListener('click', async function (event) {
      var b = event.target.closest('[data-bg]'); if (!b) return;
      var id = b.getAttribute('data-bg');
      applyBackground(id);
      layer.el.querySelectorAll('[data-bg]').forEach(function (x) { x.classList.toggle('is-active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      if (!(await groupAction(conv, { action: 'set_background', background: id }, '聊天背景已更新'))) applyBackground(current);
    });
  }

  // ---- complaint
  function openReport(conv) {
    var body = '<p class="grp-hint">请选择投诉该群聊的原因，管理员会尽快处理。</p><div class="grp-option-list is-radio">' + REPORT_REASONS.map(function (r, i) {
      return '<label class="grp-option"><input type="radio" name="grpReport" value="' + r[0] + '"' + (i === 0 ? ' checked' : '') + '><span>' + esc(r[1]) + '</span></label>';
    }).join('') + '</div><label class="grp-field"><span>补充说明（选填）</span><textarea id="grpReportText" maxlength="500" rows="3" placeholder="可以描述具体情况"></textarea></label>';
    var layer = openSheet('投诉', body, { back: true, footer: '<button type="button" class="grp-primary" id="grpReportSubmit">提交</button>' });
    layer.el.querySelector('#grpReportSubmit').addEventListener('click', async function (event) {
      var b = event.target; b.disabled = true;
      var category = (layer.el.querySelector('input[name="grpReport"]:checked') || {}).value || 'other';
      try {
        await api('/' + conv.id + '/report', { method: 'POST', json: { category: category, reason: layer.el.querySelector('#grpReportText').value.trim() }, owner: conv.owner, epoch: conv.epoch });
        layer.close(); toast('投诉已提交，感谢反馈');
      } catch (error) { b.disabled = false; toast(error.message); }
    });
  }

  // -------------------------------------------------------- join by link
  async function handleJoinLink() {
    var params; try { params = new URLSearchParams(location.search); } catch (_) { return; }
    var token = params.get('group_join');
    if (!token) return;
    if (!/^[a-f0-9]{32}$/.test(token)) { stripJoinParam(); return; }
    for (var i = 0; i < 40 && !me(); i++) await new Promise(function (r) { setTimeout(r, 250); });
    if (!me()) { toast('登录后即可加入群聊'); if (typeof window.openAuthModal === 'function') window.openAuthModal('login'); state.pendingJoin = token; return; }
    stripJoinParam();
    openJoinPreview(token);
  }
  function stripJoinParam() {
    try { var url = new URL(location.href); url.searchParams.delete('group_join'); history.replaceState(history.state, '', url.pathname + url.search + url.hash); } catch (_) {}
  }
  async function openJoinPreview(token) {
    var layer = openSheet('加入群聊', '<div class="grp-loading"><span class="grp-spinner"></span></div>');
    var body = layer.el.querySelector('.grp-sheet-body');
    try {
      var data = await api('/join/' + token);
      var g = data.group;
      body.innerHTML = '<div class="grp-join">' + groupAvatarHtml(g, 'grp-avatar is-large') + '<strong>' + esc(g.name) + '</strong><span>' + g.member_count + ' 位成员 · 群主 ' + esc(g.owner || '') + '</span>' +
        (g.is_member ? '<p class="grp-hint">你已经在这个群里了</p>' : g.pending ? '<p class="grp-hint">已提交申请，等待群主或管理员同意</p>' : g.join_approval ? '<label class="grp-field"><span>申请备注（选填）</span><input id="grpJoinNote" maxlength="120" placeholder="介绍一下自己"></label>' : '') +
        '<button type="button" class="grp-primary" id="grpJoinBtn"' + (g.pending ? ' disabled' : '') + '>' + (g.is_member ? '进入群聊' : g.join_approval ? '申请加入' : '加入群聊') + '</button></div>';
      body.querySelector('#grpJoinBtn').addEventListener('click', async function (event) {
        var b = event.target; b.disabled = true;
        if (g.is_member) { layer.close(); await loadGroups(); openGroup(g.id); return; }
        try {
          var note = body.querySelector('#grpJoinNote');
          var res = await api('/join/' + token, { method: 'POST', json: { note: note ? note.value.trim() : '' } });
          layer.close();
          if (res.joined) { await loadGroups(); openGroup(res.group_id); toast('已加入群聊'); }
          else toast('已提交申请，等待群主或管理员同意');
        } catch (error) { b.disabled = false; toast(error.message); }
      });
    } catch (error) { body.innerHTML = '<p class="grp-empty">' + esc(error.message) + '</p>'; }
  }

  // ------------------------------------------------- polling & realtime
  function startPolling() {
    stopPolling();
    var tick = function () {
      var conv = state.active;
      if (!conv) return;
      var visible = document.visibilityState === 'visible' && isChatVisible();
      if (visible) fetchNewer(conv).then(function () { if (state.active === conv) markRead(conv); });
      // Realtime pushes usually arrive first; polling is the safety net.
      var realtimeFresh = Date.now() - state.realtimeAt < 60000;
      state.pollTimer = setTimeout(tick, visible ? (realtimeFresh ? 12000 : 4000) : 15000);
    };
    state.pollTimer = setTimeout(tick, 4000);
  }
  function stopPolling() { clearTimeout(state.pollTimer); state.pollTimer = 0; }

  window.__xtjApplyGroupEvent = function (payload) {
    if (!payload || !me()) return;
    state.realtimeAt = Date.now();
    var conv = state.active;
    if (conv && payload.group_id === conv.id) {
      if (payload.kind === 'remove_member' || payload.kind === 'dissolve' || payload.kind === 'transfer' || payload.kind === 'set_admin' ||
          payload.kind === 'unset_admin' || payload.kind === 'ban' || payload.kind === 'unban' || payload.kind === 'set_mute_all' ||
          payload.kind === 'rename' || payload.kind === 'announce' || payload.kind === 'invite' || payload.kind === 'members' ||
          payload.kind === 'leave' || payload.kind === 'set_join_approval' || payload.kind === 'set_invite_policy' || payload.kind === 'approve_request' ||
          payload.kind === 'set_nickname' || payload.kind === 'request') {
        refreshDetail(conv);
      }
      fetchNewer(conv).then(function () { if (state.active === conv) markRead(conv); });
    }
    scheduleListRefresh(conv && payload.group_id === conv.id ? 600 : 250, payload.kind === 'message');
  };

  function resetForAccount() {
    closeAllSheets(); closeMessageMenu(); closeGroup(true);
    state.groups = []; state.groupsLoaded = false; state.lastUnread = Object.create(null); state.friends = null; state.listSeq++;
    avatarUrls = Object.create(null);
    if (typeof window.__xtjSetGroupUnread === 'function') window.__xtjSetGroupUnread(0);
    renderGroupList();
  }

  function syncAccount() {
    var owner = me(), ep = epoch();
    if (owner === state.owner && ep === state.epoch) return;
    var changedUser = owner !== state.owner;
    state.owner = owner; state.epoch = ep;
    if (changedUser) resetForAccount();
    if (owner) {
      loadGroups();
      if (state.pendingJoin) { var t = state.pendingJoin; state.pendingJoin = null; stripJoinParam(); openJoinPreview(t); }
    }
  }

  function init() {
    ensureListSection();
    ensureView();
    renderGroupList();
    syncAccount();
    handleJoinLink();
    // Account changes: the core bumps _authStateEpoch and fires auth events.
    ['auth-ready', 'xtj-auth-changed', 'storage'].forEach(function (name) { window.addEventListener(name, function () { setTimeout(syncAccount, 0); }); });
    setInterval(syncAccount, 1500);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && me()) { scheduleListRefresh(100); if (state.active) fetchNewer(state.active); }
    });
    window.addEventListener('resize', placeView);
    if (typeof ResizeObserver === 'function') {
      var observe = function () { var d = $('dockChatDetailView'), c = $('dockChatContainer'); if (!d || !c) return; var ro = new ResizeObserver(function () { if (state.active) placeView(); }); ro.observe(d); ro.observe(c); };
      observe();
    }
    // Opening a direct conversation or leaving the chat tab closes the group view.
    var list = $('dockChatList');
    if (list) list.addEventListener('click', function (event) { if (event.target.closest('.chat-list-item[data-chat-user]') && state.active) closeGroup(true); }, true);
    var openChat = window.openChat;
    if (typeof openChat === 'function' && !openChat.__grpWrapped) {
      window.openChat = function () { if (state.active) closeGroup(true); return openChat.apply(this, arguments); };
      window.openChat.__grpWrapped = true;
    }
    var panel = $('panelChat');
    if (panel && typeof MutationObserver === 'function') {
      var wasActive = panel.classList.contains('active');
      new MutationObserver(function () {
        var active = panel.classList.contains('active');
        if (active && !wasActive && me()) { scheduleListRefresh(0); placeView(); if (state.active) markRead(state.active); }
        if (!active) closeMessageMenu();
        wasActive = active;
      }).observe(panel, { attributes: true, attributeFilter: ['class'] });
    }
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (state.menu) { closeMessageMenu(); return; }
      if (document.querySelector('.xtj-prompt-overlay, #ppConfirmOverlay.active')) return;
      var top = state.layers[state.layers.length - 1];
      if (top) { event.preventDefault(); top.close(); return; }
      if (state.info) { closeInfo(); return; }
      if (state.active && isChatVisible()) closeGroup();
    });
    // Background list refresh while the chat tab is open (realtime covers the rest).
    setInterval(function () { if (me() && isChatVisible() && document.visibilityState === 'visible') loadGroups({ notify: true }); }, 30000);
  }

  window.__xtjChatGroups = {
    open: openGroup, close: closeGroup, reload: loadGroups, create: openCreateSheet,
    state: function () { return state; }
  };
  window.__xtjResetChatGroups = resetForAccount;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
