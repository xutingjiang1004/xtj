/* ============================================================
 * XTJ English Learning Studio
 * - Account-synced vocabulary state
 * - DeepSeek reading/question generation
 * - Mastery, mistakes, history, review queue
 * ============================================================ */

(function() {
  'use strict';

  var STORAGE_KEY = 'xtj_english_state_v2';
  var LEGACY_WORDS_KEY = 'xtj_english_words_v1';
  var LEGACY_HISTORY_KEY = 'xtj_english_history_v1';
  var MAX_WORDS = 200;
  var MAX_HISTORY = 80;
  var MAX_MISTAKES = 120;
  var SAVE_DEBOUNCE_MS = 800;

  var DEFAULT_SETTINGS = {
    defaultLevel: 'cet4',
    articleLength: 'medium',
    questionCount: 6,
    focus: 'weak',
    topic: ''
  };

  var S = {
    words: [],
    history: [],
    mistakes: [],
    settings: Object.assign({}, DEFAULT_SETTINGS),
    currentQuiz: null,
    filter: 'all',
    search: '',
    isGenerating: false,
    isCancelled: false,
    currentController: null,
    initialized: false,
    syncStatus: 'local',
    syncTimer: null,
    saveInFlight: false,
    pendingSave: false,
    lastRemoteUpdatedAt: 0,
    openTimer: null,
    closeTimer: null,
    eventsBound: false,
    batchMutating: false,
    batchDirty: false
  };

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function(k) {
        var v = attrs[k];
        if (v === undefined || v === null) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = String(v);
        else if (k === 'style') node.style.cssText = String(v);
        else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, String(v));
      });
    }
    if (children !== undefined && children !== null) {
      if (typeof children === 'string') node.textContent = children;
      else if (Array.isArray(children)) children.forEach(function(c) {
        if (!c) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
      else node.appendChild(children);
    }
    return node;
  }

  function notify(msg, type) {
    if (window.notify && typeof window.notify === 'function') {
      try { window.notify(msg, type); return; } catch (e) {}
    }
    if (window.showToast && typeof window.showToast === 'function') {
      try { window.showToast(msg); return; } catch (e2) {}
    }
    try { console.log('[EL]', msg); } catch (e3) {}
  }

  function safeBind(id, eventName, handler, options) {
    try {
      var node = $(id);
      if (!node) return null;
      node.addEventListener(eventName, handler, options);
      return node;
    } catch (e) {
      try { console.error('[EL] bind failed:', id, e); } catch (e2) {}
      return null;
    }
  }

  function safeBindNode(node, eventName, handler, label, options) {
    try {
      if (!node) return false;
      node.addEventListener(eventName, handler, options);
      return true;
    } catch (e) {
      try { console.error('[EL] bind failed:', label || eventName, e); } catch (e2) {}
      return false;
    }
  }

  function safeForEach(selector, binder) {
    try {
      Array.prototype.forEach.call(document.querySelectorAll(selector), function(node, index) {
        try { binder(node, index); } catch (e) {
          try { console.error('[EL] bind failed:', selector, e); } catch (e2) {}
        }
      });
    } catch (e) {
      try { console.error('[EL] bind failed:', selector, e); } catch (e2) {}
    }
  }

  function apiBase() {
    return (typeof window.API_BASE === 'string' && window.API_BASE)
      ? window.API_BASE.replace(/\/$/, '') + '/api/agent'
      : '/api/agent';
  }

  function readUserName() {
    try {
      return sessionStorage.getItem('xtj_user_name') ||
        localStorage.getItem('xtj_user_name') ||
        localStorage.getItem('xtj_user') ||
        window.currentUser ||
        '';
    } catch (e) { return window.currentUser || ''; }
  }

  function readPwHash() {
    try { return sessionStorage.getItem('xtj_pw_hash') || localStorage.getItem('xtj_pw_hash') || ''; } catch (e) { return ''; }
  }

  function readUserToken() {
    try { return sessionStorage.getItem('xtj_user_token') || localStorage.getItem('xtj_user_token') || ''; } catch (e) { return ''; }
  }

  async function getAuthHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    try {
      if (typeof window.ensureUserToken === 'function') {
        var ensured = await window.ensureUserToken();
        if (ensured) {
          headers.Authorization = 'Bearer ' + ensured;
          return headers;
        }
      }
    } catch (e) {}
    var token = readUserToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }

  function addLegacyAuth(body, headers) {
    if (headers && headers.Authorization) return body;
    var un = readUserName();
    var pw = readPwHash();
    if (un && pw) {
      body.user_name = un;
      body.password_hash = pw;
    }
    return body;
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function now() { return Date.now(); }

  function normalizeWord(en, cn, existing) {
    en = String(en || '').trim().toLowerCase();
    cn = String(cn || '').trim();
    if (!en || !/^[a-zA-Z\s\-']+$/.test(en) || en.length > 60) return null;
    var base = existing || {};
    return {
      id: base.id || uid('w'),
      en: en,
      cn: cn || base.cn || '',
      mastery: clampNumber(base.mastery, 0, 100, 0),
      seen: clampNumber(base.seen, 0, 9999, 0),
      correct: clampNumber(base.correct, 0, 9999, 0),
      wrong: clampNumber(base.wrong, 0, 9999, 0),
      lastReviewedAt: clampNumber(base.lastReviewedAt, 0, Number.MAX_SAFE_INTEGER, 0),
      addedAt: clampNumber(base.addedAt, 0, Number.MAX_SAFE_INTEGER, now()),
      updatedAt: clampNumber(base.updatedAt, 0, Number.MAX_SAFE_INTEGER, now())
    };
  }

  function clampNumber(v, min, max, fallback) {
    v = Number(v);
    if (!isFinite(v)) return fallback;
    return Math.max(min, Math.min(max, v));
  }

  function normalizeState(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var words = Array.isArray(raw.words) ? raw.words : [];
    var byEn = {};
    words.forEach(function(item) {
      var w = normalizeWord(item && item.en, item && item.cn, item);
      if (!w) return;
      var prev = byEn[w.en];
      if (!prev || (w.updatedAt || 0) >= (prev.updatedAt || 0)) byEn[w.en] = w;
    });
    var list = Object.keys(byEn).map(function(k) { return byEn[k]; })
      .sort(function(a, b) { return (b.addedAt || 0) - (a.addedAt || 0); })
      .slice(0, MAX_WORDS);
    return {
      version: 1,
      words: list,
      history: Array.isArray(raw.history) ? raw.history.slice(0, MAX_HISTORY) : [],
      mistakes: Array.isArray(raw.mistakes) ? raw.mistakes.slice(0, MAX_MISTAKES) : [],
      settings: Object.assign({}, DEFAULT_SETTINGS, raw.settings || {}),
      updatedAt: clampNumber(raw.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0)
    };
  }

  function getLocalState() {
    var parsed = {};
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      parsed = raw ? JSON.parse(raw) : {};
    } catch (e) { parsed = {}; }

    var state = normalizeState(parsed);
    try {
      var legacyWords = localStorage.getItem(LEGACY_WORDS_KEY);
      if (legacyWords) {
        var arr = JSON.parse(legacyWords);
        if (Array.isArray(arr)) {
          state = mergeStates(state, normalizeState({ words: arr, updatedAt: 0 }));
        }
      }
      var legacyHistory = localStorage.getItem(LEGACY_HISTORY_KEY);
      if (legacyHistory && state.history.length === 0) {
        var hist = JSON.parse(legacyHistory);
        if (Array.isArray(hist)) state.history = hist.slice(0, MAX_HISTORY);
      }
    } catch (e2) {}
    return state;
  }

  function saveLocalState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildStatePayload()));
    } catch (e) {}
  }

  function mergeStates(local, remote) {
    local = normalizeState(local);
    remote = normalizeState(remote);
    var map = {};
    local.words.concat(remote.words).forEach(function(w) {
      if (!w || !w.en) return;
      var key = w.id || w.en;
      var enKey = 'en:' + w.en;
      var prev = map[key] || map[enKey];
      if (!prev || (w.updatedAt || 0) >= (prev.updatedAt || 0)) {
        map[key] = w;
        map[enKey] = w;
      }
    });
    var seenIds = {};
    var words = [];
    Object.keys(map).forEach(function(k) {
      var w = map[k];
      if (!w || seenIds[w.id]) return;
      seenIds[w.id] = true;
      words.push(w);
    });
    words.sort(function(a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
    return {
      version: 1,
      words: words.slice(0, MAX_WORDS),
      history: mergeById(local.history, remote.history, MAX_HISTORY),
      mistakes: mergeById(local.mistakes, remote.mistakes, MAX_MISTAKES),
      settings: Object.assign({}, DEFAULT_SETTINGS, remote.settings || {}, local.settings || {}),
      updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0)
    };
  }

  function mergeById(a, b, cap) {
    var map = {};
    (Array.isArray(a) ? a : []).concat(Array.isArray(b) ? b : []).forEach(function(item) {
      if (!item) return;
      var id = item.id || uid('row');
      var prev = map[id];
      if (!prev || (item.time || item.updatedAt || 0) >= (prev.time || prev.updatedAt || 0)) map[id] = item;
    });
    return Object.keys(map).map(function(k) { return map[k]; })
      .sort(function(x, y) { return (y.time || y.updatedAt || 0) - (x.time || x.updatedAt || 0); })
      .slice(0, cap);
  }

  function applyState(state) {
    state = normalizeState(state);
    S.words = state.words;
    S.history = state.history;
    S.mistakes = state.mistakes;
    S.settings = Object.assign({}, DEFAULT_SETTINGS, state.settings || {});
    S.lastRemoteUpdatedAt = state.updatedAt || 0;
  }

  function buildStatePayload() {
    return {
      version: 1,
      words: S.words.slice(0, MAX_WORDS),
      history: S.history.slice(0, MAX_HISTORY),
      mistakes: S.mistakes.slice(0, MAX_MISTAKES),
      settings: Object.assign({}, DEFAULT_SETTINGS, S.settings || {}),
      updatedAt: now()
    };
  }

  function setSyncStatus(status, label) {
    S.syncStatus = status;
    var node = $('elSyncStatus');
    if (!node) return;
    node.className = 'el-sync ' + 'is-' + status;
    node.textContent = label || (
      status === 'synced' ? '已同步' :
      status === 'syncing' ? '同步中' :
      status === 'dirty' ? '待同步' :
      status === 'error' ? '未同步' :
      '离线模式'
    );
  }

  async function loadRemoteState() {
    var headers = await getAuthHeaders();
    var body = addLegacyAuth({}, headers);
    if (!headers.Authorization && (!body.user_name || !body.password_hash)) {
      setSyncStatus('local', '离线模式');
      return null;
    }
    var url = apiBase() + '/english/state';
    if (!headers.Authorization) {
      url += '?user_name=' + encodeURIComponent(body.user_name) + '&password_hash=' + encodeURIComponent(body.password_hash);
    }
    setSyncStatus('syncing', '同步中');
    var resp = await fetch(url, { method: 'GET', headers: headers });
    if (!resp.ok) throw new Error('鍚屾璇诲彇澶辫触');
    var json = await resp.json();
    if (!json.ok) throw new Error(json.error || '鍚屾璇诲彇澶辫触');
    setSyncStatus('synced', '已同步');
    return normalizeState(json.data || {});
  }

  function scheduleSave() {
    saveLocalState();
    setSyncStatus('dirty', '待同步');
    if (S.batchMutating) {
      S.batchDirty = true;
      return;
    }
    if (S.syncTimer) clearTimeout(S.syncTimer);
    S.syncTimer = setTimeout(saveRemoteState, SAVE_DEBOUNCE_MS);
  }

  function beginBatchMutation() {
    S.batchMutating = true;
  }

  function endBatchMutation(options) {
    S.batchMutating = false;
    if (!S.batchDirty) return;
    S.batchDirty = false;
    if (!options || options.render !== false) renderAll();
    scheduleSave();
  }

  async function saveRemoteState() {
    if (S.saveInFlight) {
      S.pendingSave = true;
      return;
    }
    S.saveInFlight = true;
    S.pendingSave = false;
    try {
      var headers = await getAuthHeaders();
      var payload = buildStatePayload();
      var body = addLegacyAuth({ data: payload }, headers);
      if (!headers.Authorization && (!body.user_name || !body.password_hash)) {
        setSyncStatus('local', '离线模式');
        return;
      }
      setSyncStatus('syncing', '同步中');
      var resp = await fetch(apiBase() + '/english/state', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
      });
      if (!resp.ok) {
        var err = '';
        try { var ej = await resp.json(); err = ej && ej.error || ''; } catch (e) {}
        throw new Error(err || '鍚屾淇濆瓨澶辫触');
      }
      var json = await resp.json();
      if (!json.ok) throw new Error(json.error || '鍚屾淇濆瓨澶辫触');
      setSyncStatus('synced', '已同步');
    } catch (e2) {
      setSyncStatus('error', '未同步');
      try { console.warn('[EL] sync failed:', e2 && e2.message); } catch (e3) {}
    } finally {
      S.saveInFlight = false;
      if (S.pendingSave) saveRemoteState();
    }
  }

  async function initializeState() {
    var local = getLocalState();
    applyState(local);
    saveLocalState();
    try {
      var remote = await loadRemoteState();
      if (remote) {
        var merged = mergeStates(local, remote);
        applyState(merged);
        saveLocalState();
        if ((merged.updatedAt || 0) > (remote.updatedAt || 0) || local.words.length) scheduleSave();
      }
    } catch (e) {
      setSyncStatus('error', '未同步');
    }
    renderAll();
  }

  function findDictWord(en) {
    en = String(en || '').toLowerCase();
    var dict = window.ENGLISH_WORD_DICT || [];
    for (var i = 0; i < dict.length; i++) {
      if (String(dict[i].en || '').toLowerCase() === en) return dict[i];
    }
    return null;
  }

  function addWord(en, cn, silent) {
    var dict = findDictWord(en);
    var normalized = normalizeWord(en, cn || (dict && dict.cn) || '');
    if (!normalized) {
      if (!silent) notify('请输入有效英文单词');
      return null;
    }
    for (var i = 0; i < S.words.length; i++) {
      if (S.words[i].en === normalized.en) {
        if (normalized.cn && normalized.cn !== S.words[i].cn) S.words[i].cn = normalized.cn;
        S.words[i].updatedAt = now();
        scheduleSave();
        return S.words[i];
      }
    }
    if (S.words.length >= MAX_WORDS) {
      if (!silent) notify('单词库已满 (' + MAX_WORDS + ' 词)');
      return null;
    }
    S.words.unshift(normalized);
    scheduleSave();
    return normalized;
  }

  function deleteWord(id) {
    S.words = S.words.filter(function(w) { return w.id !== id; });
    scheduleSave();
  }

  /* ============================================================
   * 娣诲姞鍗曡瘝: 鐢ㄦ埛鎵嬪姩濉噴涔? 涓嶅啀鑷姩璋?AI
   * ============================================================ */
  function handleAddWord() {
    var wordInput = $('elWordInput');
    var cnInput = $('elMeaningInput');
    if (!wordInput) return;
    var en = String(wordInput.value || '').trim();
    var cn = String(cnInput && cnInput.value || '').trim();
    if (!en) { notify('请输入英文单词'); return; }
    var w = addWord(en, cn);
    if (!w) return;
    if (wordInput) wordInput.value = '';
    if (cnInput) cnInput.value = '';
    renderAll();
    notify('已添加 ' + w.en + (w.cn ? ' · ' + w.cn : ''));
    if (wordInput) wordInput.focus();
  }

  function deleteSelected(ids) {
    ids = ids || [];
    S.words = S.words.filter(function(w) { return ids.indexOf(w.id) < 0; });
    scheduleSave();
    return ids.length;
  }

  function clearAll() {
    S.words = [];
    S.history = [];
    S.mistakes = [];
    S.currentQuiz = null;
    scheduleSave();
  }

  function getDictMatches(query, maxResults) {
    maxResults = maxResults || 8;
    query = String(query || '').trim().toLowerCase();
    if (!query || !window.ENGLISH_WORD_DICT) return [];
    var dict = window.ENGLISH_WORD_DICT;
    var matches = [];
    for (var i = 0; i < dict.length && matches.length < maxResults; i++) {
      if (String(dict[i].en || '').toLowerCase().indexOf(query) === 0) matches.push(dict[i]);
    }
    for (var j = 0; j < dict.length && matches.length < maxResults; j++) {
      var en = String(dict[j].en || '').toLowerCase();
      if (en.indexOf(query) > 0 && matches.indexOf(dict[j]) < 0) matches.push(dict[j]);
    }
    return matches;
  }

  function showAutocomplete(input, suggestions) {
    var box = $('elAutocomplete');
    if (!box) return;
    box.innerHTML = '';
    if (!suggestions || !suggestions.length) {
      box.style.display = 'none';
      return;
    }
    suggestions.forEach(function(s) {
      var item = el('button', { type: 'button', class: 'el-ac-item' });
      item.appendChild(el('span', { class: 'el-ac-en', text: s.en }));
      item.appendChild(el('span', { class: 'el-ac-cn', text: s.cn || '' }));
      item.addEventListener('mousedown', function(ev) {
        ev.preventDefault();
        input.value = s.en;
        var cnInput = $('elMeaningInput');
        if (cnInput && !cnInput.value) cnInput.value = s.cn || '';
        hideAutocomplete();
        input.focus();
      });
      box.appendChild(item);
    });
    box.style.display = 'block';
  }

  function hideAutocomplete() {
    var box = $('elAutocomplete');
    if (box) {
      box.style.display = 'none';
      box.innerHTML = '';
    }
  }

  function isWeakWord(w) {
    if (!w) return false;
    if ((w.seen || 0) === 0) return false;
    return (w.mastery || 0) < 60 || (w.wrong || 0) > (w.correct || 0);
  }

  function isMasteredWord(w) {
    return w && (w.seen || 0) >= 2 && (w.mastery || 0) >= 80;
  }

  function getFilteredWords() {
    var q = String(S.search || '').trim().toLowerCase();
    return S.words.filter(function(w) {
      if (S.filter === 'weak' && !isWeakWord(w)) return false;
      if (S.filter === 'mastered' && !isMasteredWord(w)) return false;
      if (S.filter === 'recent' && now() - (w.addedAt || 0) > 7 * 86400000) return false;
      if (!q) return true;
      return w.en.indexOf(q) >= 0 || String(w.cn || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  function masteryLabel(w) {
    var m = w.mastery || 0;
    if ((w.seen || 0) === 0) return '鏂拌瘝';
    if (m >= 80) return '鎺屾彙';
    if (m >= 60) return '鐔熸倝';
    return '钖勫急';
  }

  function renderStats() {
    setText('elWordCount', S.words.length);
    setText('elGenTotal', getWordsForGeneration(false).length);
  }

  function setText(id, value) {
    var node = $(id);
    if (node) node.textContent = String(value);
  }

  function renderWordList() {
    var list = $('elWordList');
    if (!list) return;
    list.innerHTML = '';
    var words = getFilteredWords();
    if (!words.length) {
      list.appendChild(el('div', { class: 'el-empty-hint', text: S.words.length ? '????????' : '???????????????' }));
      return;
    }
    var frag = document.createDocumentFragment();
    words.forEach(function(w, index) {
      var item = el('article', { class: 'el-word-item', 'data-id': w.id, style: '--el-i:' + Math.min(index, 16) });
      var cb = el('input', { type: 'checkbox', class: 'el-word-cb', 'data-id': w.id, 'aria-label': '閫夋嫨 ' + w.en });
      cb.addEventListener('change', function() {
        item.classList.toggle('selected', cb.checked);
        updateGenInfo();
      });
      var main = el('div', { class: 'el-word-main' });
      main.appendChild(el('div', { class: 'el-word-en', text: w.en }));
      main.appendChild(el('div', { class: 'el-word-cn', text: w.cn || '鏆傛棤閲婁箟' }));
      var delBtn = el('button', { type: 'button', class: 'el-word-del', 'aria-label': '鍒犻櫎 ' + w.en, title: '鍒犻櫎', text: '脳' });
      delBtn.addEventListener('click', function() {
        deleteWord(w.id);
        renderAll();
        notify('已删除 ' + w.en);
      });
      // 宸插垹闄? AI 鎸夐挳 (鐢ㄦ埛瑕佹眰), 鍗曡瘝鍙繚鐣?鍕鹃€?+ 璇嶄箟 + 鍒犻櫎
      item.appendChild(cb);
      item.appendChild(main);
      item.appendChild(delBtn);
      frag.appendChild(item);
    });
    list.appendChild(frag);
  }

  function masteryClass(w) {
    if (isMasteredWord(w)) return 'is-mastered';
    if (isWeakWord(w)) return 'is-weak';
    return 'is-new';
  }

  function updateGenInfo() {
    var total = getWordsForGeneration(false).length;
    setText('elGenTotal', total);
    var info = $('elGenInfo');
    if (info) info.innerHTML = '??? <span id="elGenTotal">' + total + '</span> ???';
    var gen = $('elGenBtn');
    if (gen) gen.disabled = S.isGenerating || total === 0;
  }

  function getSelectedWordIds() {
    var ids = [];
    document.querySelectorAll('.el-word-cb:checked').forEach(function(cb) {
      ids.push(cb.getAttribute('data-id'));
    });
    return ids;
  }

  function getWordsForGeneration(notifyIfEmpty) {
    var mode = S.settings.focus || 'weak';
    var selectedIds = getSelectedWordIds();
    var words = S.words.slice();
    if (mode === 'selected' && selectedIds.length) {
      words = words.filter(function(w) { return selectedIds.indexOf(w.id) >= 0; });
    } else if (mode === 'weak') {
      var weak = words.filter(isWeakWord);
      var fresh = words.filter(function(w) { return (w.seen || 0) === 0; });
      var rest = words.filter(function(w) { return weak.indexOf(w) < 0 && fresh.indexOf(w) < 0; });
      words = weak.concat(fresh).concat(rest);
    }
    words = words.slice(0, MAX_WORDS);
    if (notifyIfEmpty && !words.length) notify('璇峰厛娣诲姞鍗曡瘝鍒板崟璇嶅簱');
    return words;
  }

  function getSelectedTypes() {
    var types = [];
    document.querySelectorAll('input[name="elType"]:checked').forEach(function(input) { types.push(input.value); });
    return types;
  }

  function getSelectedLevel() {
    var r = document.querySelector('input[name="elLevel"]:checked');
    return r ? r.value : (S.settings.defaultLevel || 'cet4');
  }

  function syncSettingsFromInputs() {
    S.settings.defaultLevel = getSelectedLevel();
    S.settings.questionCount = parseInt(($('elQuestionCount') || {}).value, 10) || 6;
    S.settings.articleLength = (($('elArticleLength') || {}).value || 'medium');
    S.settings.focus = (($('elFocusMode') || {}).value || 'weak');
    S.settings.topic = String((($('elTopicInput') || {}).value || '')).trim().slice(0, 80);
  }

  function applySettingsToInputs() {
    var level = S.settings.defaultLevel || 'cet4';
    var levelInput = document.querySelector('input[name="elLevel"][value="' + level + '"]');
    if (levelInput) levelInput.checked = true;
    if ($('elQuestionCount')) $('elQuestionCount').value = String(S.settings.questionCount || 6);
    if ($('elArticleLength')) $('elArticleLength').value = S.settings.articleLength || 'medium';
    if ($('elFocusMode')) $('elFocusMode').value = S.settings.focus || 'weak';
    if ($('elTopicInput')) $('elTopicInput').value = S.settings.topic || '';
    refreshChipStates();
  }

  /**
   * 鎵归噺瀵煎叆: 鏈湴瑙ｆ瀽涓轰富, AI 鍙ˉ鍏呴噴涔?
   */
  function stripBatchNoise(line) {
    return String(line || '')
      .replace(/^[\s\-*?·]+/, '')
      .replace(/^\s*\d+[\.\)銆乗)]\s*/, '')
      .replace(/^\s*[鈶犫憽鈶⑩懀鈶も懃鈶︹懅鈶ㄢ懇]\s*/, '')
      .replace(/\/[^\/\n]{1,40}\//g, ' ')
      .replace(/\[[^\]\n]{1,40}\]/g, ' ')
      .trim();
  }

  function cleanBatchWord(en) {
    return String(en || '')
      .replace(/^[^a-zA-Z]+/, '')
      .replace(/[^a-zA-Z\s\-']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function cleanBatchMeaning(cn) {
    return String(cn || '')
      .replace(/^[\s:锛歕-鈥撯€?,锛?锛泑\/]+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function pushBatchParsed(list, seen, en, cn) {
    en = cleanBatchWord(en);
    cn = cleanBatchMeaning(cn);
    if (!en || !/^[a-zA-Z][a-zA-Z\s\-']{0,59}$/.test(en)) return false;
    var key = en.toLowerCase();
    if (seen[key]) {
      if (cn && !seen[key].cn) seen[key].cn = cn;
      return false;
    }
    var item = { en: key, cn: cn || '' };
    seen[key] = item;
    list.push(item);
    return true;
  }

  function parseBatchWordsLocal(text) {
    var parsed = [];
    var seen = {};
    text = String(text || '')
      .replace(/\r/g, '\n')
      .replace(/[，、]/g, ',')
      .replace(/[；;]/g, '\n');

    var roughParts = [];
    text.split('\n').forEach(function(line) {
      line = stripBatchNoise(line);
      if (!line) return;
      if (line.indexOf(',') >= 0 && !/[\u4e00-\u9fa5]/.test(line)) {
        line.split(',').forEach(function(p) {
          p = stripBatchNoise(p);
          if (p) roughParts.push(p);
        });
      } else {
        roughParts.push(line);
      }
    });

    roughParts.forEach(function(line) {
      line = stripBatchNoise(line);
      if (!line) return;
      var m = line.match(/^([a-zA-Z][a-zA-Z\s\-']{0,59}?)[\s:锛歕-鈥撯€?|\/]+([\u4e00-\u9fa5].*)$/);
      if (m) { pushBatchParsed(parsed, seen, m[1], m[2]); return; }
      m = line.match(/^([a-zA-Z][a-zA-Z\-']{0,59})[\s:锛歕-鈥撯€?|\/]+(.+)$/);
      if (m) { pushBatchParsed(parsed, seen, m[1], m[2]); return; }
      m = line.match(/[a-zA-Z][a-zA-Z\s\-']{0,59}/);
      if (m) { pushBatchParsed(parsed, seen, m[0], ''); }
    });
    return parsed;
  }

  async function doBatchImport(btn) {
    var input = $('elBatchInput');
    if (!input) { notify('鎵归噺瀵煎叆杈撳叆妗嗘湭鎵惧埌', 'error'); return; }
    var text = String(input.value || '').trim();
    if (!text) { notify('璇峰厛杈撳叆瑕佸鍏ョ殑鍗曡瘝'); return; }
    if (btn) { btn.disabled = true; btn.dataset._oldText = btn.textContent; btn.textContent = '瑙ｆ瀽涓?..'; }

    // 1) 鏈湴纭畾鎬цВ鏋愪紭鍏?鈥?AI 鍙兘琛ュ厖閲婁箟
    var localParsed = parseBatchWordsLocal(text);
    var parsedMap = {};
    localParsed.forEach(function(w) { parsedMap[w.en] = { en: w.en, cn: w.cn || '' }; });

    // 2) AI 鍙敤浜庤ˉ鍏呴噴涔夛紝缁濅笉瑕嗙洊鏈湴璇嗗埆鏁伴噺
    try {
      var headers = await getAuthHeaders();
      var resp = await fetch(apiBase() + '/english/parse-batch', {
        method: 'POST', headers: headers,
        body: JSON.stringify({ text: text, max_count: 120 })
      });
      if (resp.ok) {
        var json = await resp.json();
        var aiWords = json && json.ok && json.data && Array.isArray(json.data.words) ? json.data.words : [];
        aiWords.forEach(function(p) {
          if (!p || !p.en) return;
          var en = cleanBatchWord(p.en);
          if (!en) return;
          if (parsedMap[en]) {
            if (!parsedMap[en].cn && p.cn) parsedMap[en].cn = cleanBatchMeaning(p.cn);
          } else {
            var tmp = []; var seen2 = {};
            Object.keys(parsedMap).forEach(function(k) { seen2[k] = true; });
            pushBatchParsed(tmp, seen2, en, p.cn || '');
            if (tmp.length) parsedMap[en] = tmp[0];
          }
        });
      }
    } catch (e) { /* AI 澶辫触涓嶅奖鍝嶅鍏?*/ }

    var parsed = Object.keys(parsedMap).map(function(k) { return parsedMap[k]; });
    if (!parsed.length) {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset._oldText || '鎵归噺瀵煎叆'; }
      notify('没有提取到有效英文单词，请检查输入', 'error');
      return;
    }

    var before = S.words.length;
    var existed = 0;
    beginBatchMutation();
    parsed.forEach(function(p) {
      if (!p || !p.en) return;
      var prev = S.words.some(function(w) { return w.en === p.en; }) ? 1 : 0;
      addWord(p.en, p.cn || '', true);
      existed += prev;
    });
    S.batchDirty = true;
    endBatchMutation({ render: true });
    var totalAdded = S.words.length - before;
    if (input) input.value = '';
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset._oldText || '鎵归噺瀵煎叆'; }

    notify(
      '鎵归噺瀵煎叆瀹屾垚锛氳瘑鍒?' + parsed.length +
      ' 涓紝鏂板 ' + totalAdded +
      ' 涓紝宸插瓨鍦?' + existed +
      ' ?' + (totalAdded === 0 && existed > 0 ? '???????' : '')
    );
  }

  async function generateQuiz(opts) {
    opts = opts || {};
    if (S.isGenerating) {
      notify('正在生成中，请稍候...');
      return;
    }
    syncSettingsFromInputs();
    var words = getWordsForGeneration(true);
    if (!words.length) return;
    var types = getSelectedTypes();
    if (!types.length) {
      notify('请至少选择一种题型');
      return;
    }
    var level = getSelectedLevel();
    S.isGenerating = true;
    updateGenInfo();
    showLoading(true);
    hideResult();
    // 閲嶆柊鐢熸垚鏃跺彧闅愯棌鏃ч/鏃ф枃绔? 淇濈暀 scrollTop 浣撻獙鏇村钩婊?
    if (opts.regenArticle || opts.regenQuiz) {
      hideArticle();
      hideQuestions();
    } else {
      hideArticle();
      hideQuestions();
    }
    scheduleSave();

    // AbortController: 鐢ㄦ埛鐐?鍙栨秷" 鎴?鍒囧埌鍗曡瘝搴撳悗鎯冲仠姝㈢敓鎴愭椂鍙珛鍗充腑姝?fetch
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    S.currentController = controller;
    S.isCancelled = false;

    var headers;
    try {
      headers = await getAuthHeaders();
    } catch (e) {
      showLoading(false);
      S.isGenerating = false;
      S.currentController = null;
      updateGenInfo();
      notify('璇峰厛鐧诲綍鍚庡啀鐢熸垚缁冧範', 'error');
      return;
    }
    try {
      var body = addLegacyAuth({
        words: words.map(function(w) { return { en: w.en, cn: w.cn || '', mastery: w.mastery || 0 }; }),
        level: level,
        types: types,
        question_count: S.settings.questionCount || 6,
        article_length: S.settings.articleLength || 'medium',
        topic: S.settings.topic || '',
        focus: S.settings.focus || 'weak',
        regen_article: !!opts.regenArticle,
        regen_quiz: !!opts.regenQuiz
      }, headers);
      var fetchOpts = {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
      };
      if (controller) fetchOpts.signal = controller.signal;
      var resp = await fetch(apiBase() + '/english/generate', fetchOpts);
      if (!resp.ok) {
        var err = '';
        try { var ej = await resp.json(); err = (ej && ej.error) || ''; } catch (e) {}
        throw new Error(err || ('HTTP ' + resp.status));
      }
      var json = await resp.json();
      if (!json.ok || !json.data) throw new Error(json.error || '杩斿洖鏁版嵁寮傚父');
      var data = json.data;
      S.currentQuiz = {
        id: uid('quiz'),
        article: data.article || '',
        words: Array.isArray(data.words_used) && data.words_used.length ? data.words_used : words.map(function(w) { return w.en; }),
        questions: Array.isArray(data.questions) ? data.questions : [],
        answers: {},
        level: level,
        types: types,
        topic: S.settings.topic || '',
        time: now()
      };
      renderArticle(S.currentQuiz);
      renderQuestions(S.currentQuiz);
      switchTab('practice');
    } catch (e2) {
      // 鐢ㄦ埛涓诲姩鍙栨秷: 闈欓粯鍏抽棴 loading
      if (S.isCancelled || (e2 && e2.name === 'AbortError')) {
        S.isCancelled = false;
        return;
      }
      try { console.error('[EL] generate error:', e2); } catch (e3) {}
      // 鍚庣涓嶅彲鐢ㄦ椂, 鐢ㄦ湰鍦版ā鏉垮厹搴? 鐢ㄦ埛涓嶈嚦浜庡畬鍏ㄥ崱浣?
      var emsg = String((e2 && e2.message) || '');
      var backendDown = /HTTP (501|404|502|503)|Failed to fetch|NetworkError|AbortError/i.test(emsg);
      if (backendDown) {
        try {
          var fallback = buildLocalQuiz(words, level, types, S.settings);
          S.currentQuiz = {
            id: uid('quiz'),
            article: fallback.article,
            words: fallback.words,
            questions: fallback.questions,
            answers: {},
            level: level,
            types: types,
            topic: S.settings.topic || '',
            time: now(),
            local: true
          };
          renderArticle(S.currentQuiz);
          renderQuestions(S.currentQuiz);
          switchTab('practice');
          notify('已使用本地模板生成（后端不可用，题目为示例格式）');
          return;
        } catch (e4) {
          try { console.error('[EL] local fallback failed:', e4); } catch (_) {}
        }
      }
      var hint = emsg || '鏈煡閿欒';
      if (/HTTP 501|Unsupported method/i.test(hint)) {
        hint = '??????? POST?????????';
      } else if (/HTTP 404|Not Found/i.test(hint)) {
        hint = '????????????????';
      }
      notify('鐢熸垚澶辫触: ' + hint, 'error');
    } finally {
      showLoading(false);
      S.isGenerating = false;
      S.currentController = null;
      updateGenInfo();
    }
  }

  function cancelGeneration() {
    if (!S.isGenerating) return;
    S.isCancelled = true;
    try { if (S.currentController) S.currentController.abort(); } catch (e) {}
    showLoading(false);
    S.isGenerating = false;
    S.currentController = null;
    updateGenInfo();
    notify('已取消生成');
  }

  function renderArticle(quiz) {
    var card = $('elArticleCard');
    var text = $('elArticleText');
    var meta = $('elArticleMeta');
    var wordsBox = $('elArticleWords');
    if (!card || !text) return;
    var article = String(quiz.article || '(鏈疆鏈敓鎴愭枃绔?');
    text.innerHTML = buildHighlightedArticle(article, quiz.words || []);
    if (meta) meta.textContent = (quiz.words.length || 0) + ' words 路 ' + (quiz.level || '').toUpperCase();
    if (wordsBox) {
      wordsBox.innerHTML = '';
      (quiz.words || []).slice(0, 24).forEach(function(w) {
        var tag = el('span', { class: 'el-word-tag', text: w });
        wordsBox.appendChild(tag);
      });
    }
    // 鐢?removeProperty 娓呮帀鍙兘瀛樺湪鐨?important inline display, 璁?CSS 榛樿 (block) 鐢熸晥
    card.style.removeProperty('display');
  }

  function buildHighlightedArticle(article, words) {
    var tokens = String(article || '').split(/(\b[a-zA-Z][a-zA-Z\-']*\b)/g);
    var wordSet = {};
    (words || []).forEach(function(w) { wordSet[String(w || '').toLowerCase()] = true; });
    return tokens.map(function(t) {
      var low = t.toLowerCase();
      if (wordSet[low]) return '<span class="el-word-highlight">' + escapeHtml(t) + '</span>';
      return escapeHtml(t);
    }).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * 鏈湴鍏滃簳: 妯℃澘鍖栫敓鎴愭枃绔?+ 棰樼洰
   * 鐪熸鐨?AI 鍐呭闇€瑕佸悗绔? 杩欓噷鍙槸涓嶈鐢ㄦ埛鍗′綇
   */
  function buildLocalQuiz(words, level, types, settings) {
    // Fisher-Yates 娲楃墝, 姣忔鐢熸垚涓嶅悓鐨勬牱鏈?
    function shuffle(arr) {
      var out = arr.slice();
      for (var i = out.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
      }
      return out;
    }
    var sample = shuffle(words).slice(0, Math.min(8, words.length));
    var used = sample.map(function(w) { return w.en; });
    var cnList = sample.map(function(w) { return w.cn || ''; });
    // 鍔犲叆闅忔満绉嶅瓙璁?article 姣忔閮戒笉鍚?
    var seed = ' (sample ' + Math.random().toString(36).slice(2, 6) + ')';
    var article = 'Local Practice (offline mode)' + seed + '\n\n'
      + 'This is a sample article for offline practice. '
      + 'Words in this set: ' + used.join(', ') + '. '
      + 'You can learn them: ' + cnList.join('; ') + '. '
      + 'Add more words to your library and try again when the server is available.';
    var topic = (settings && settings.topic) ? settings.topic : 'general';
    var levelLabel = (level || 'cet4').toUpperCase();

    // 宸ュ叿: 鎵惧埌 opts 鏁扮粍涓纭」鐨勪綅缃?(answer 蹇呴』鏄暟瀛楃储寮? 涓?renderMcQuestion 鍏煎)
    function indexOfAnswer(opts, ans) {
      for (var i = 0; i < opts.length; i++) {
        if (opts[i] === ans) return i;
      }
      return 0;
    }

    var questions = [];
    var qid = 1;
    var qcount = Math.max(2, Math.min(8, (settings && settings.questionCount) || 6));

    if (types.indexOf('reading') >= 0 && sample.length) {
      // 闃呰鐞嗚В: 鍖归厤鍗曡瘝-閲婁箟 (mc 绫诲瀷, 绛旀鐢ㄧ储寮?
      var w0 = sample[0];
      var correctOpt = w0.en + ' (' + (w0.cn || '???') + ')';
      var opts1 = sample.slice(0, Math.min(3, sample.length)).map(function(w) { return w.en + ' (' + (w.cn || '') + ')'; });
      opts1.push(correctOpt);
      opts1 = shuffle(opts1).slice(0, 4);
      // 纭繚姝ｇ‘椤瑰湪 opts 涓?
      if (opts1.indexOf(correctOpt) < 0) opts1[0] = correctOpt;
      questions.push({
        id: 'q' + (qid++),
        type: 'mc',
        question: '涓嬪垪鍝釜鍗曡瘝涓?"' + (w0.cn || '涓婚') + '" 瀵瑰簲?',
        options: opts1,
        answer: indexOfAnswer(opts1, correctOpt),
        explain: '???????? ' + w0.en + ' ????'
      });
    }

    if (types.indexOf('choice') >= 0) {
      // 閫夋嫨棰? 姣忓崟璇嶄竴閬撻噴涔夊尮閰?(mc 绫诲瀷)
      var need = Math.max(1, qcount - questions.length);
      sample.slice(0, need).forEach(function(w) {
        var correctOpt = w.cn || ('閲婁箟: ' + w.en);
        var pool = [correctOpt];
        var distractors = sample.filter(function(x) { return x.en !== w.en; }).slice(0, 6);
        distractors.forEach(function(d) { pool.push((d.cn || d.en) + ' / ' + d.en); });
        pool = shuffle(pool).slice(0, 4);
        if (pool.indexOf(correctOpt) < 0) pool[0] = correctOpt;
        pool = shuffle(pool);
        questions.push({
          id: 'q' + (qid++),
          type: 'mc',
          question: '"' + w.en + '" 鐨勪腑鏂囬噴涔夋渶鎺ヨ繎:',
          options: pool,
          answer: indexOfAnswer(pool, correctOpt),
          explain: '璇ュ崟璇嶅湪鍗曡瘝搴撲腑閲婁箟涓? ' + (w.cn || '鏆傛棤')
        });
      });
    }

    if (types.indexOf('cloze') >= 0 && sample.length) {
      // 瀹屽舰濉┖: 蹇呴』鐢?q.blanks 鏁扮粍缁撴瀯, renderClozeQuestion 鎵嶈兘娓叉煋
      var target = sample[0];
      var optTexts = [target.en].concat(sample.slice(1, 4).map(function(x) { return x.en; })).slice(0, 4);
      optTexts = shuffle(optTexts);
      // 鐢?___ 浣滀负鎸栫┖鏍囪, renderClozeQuestion 浼氭寜 ___ 鍒囧垎骞舵彃鍏ヤ笅鎷夋
      var clozeContext = 'In this example, please fill in the blank: ___ means ' + (target.cn || 'something') + '.';
      var blank = {
        options: optTexts,
        answer: indexOfAnswer(optTexts, target.en),
        explain: '?????????????'
      };
      questions.push({
        id: 'q' + (qid++),
        type: 'cloze',
        question: '瀹屽舰濉┖ (鏈湴妯℃澘)',
        context: clozeContext,
        blanks: [blank]
      });
    }

    // 涓嶈冻鏁伴噺琛ラ€夋嫨棰?
    while (questions.length < qcount && sample.length) {
      var w2 = sample[questions.length % sample.length];
      var correctOpt2 = w2.cn || ('閲婁箟: ' + w2.en);
      var pool2 = [correctOpt2, '????', '???', '??'];
      pool2 = shuffle(pool2);
      questions.push({
        id: 'q' + (qid++),
        type: 'mc',
        question: '"' + w2.en + '" 鐨勪腑鏂囬噴涔夋槸?',
        options: pool2,
        answer: indexOfAnswer(pool2, correctOpt2),
        explain: '????????'
      });
    }

    return { article: article, words: used, questions: questions, topic: topic, level: levelLabel };
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  function renderQuestions(quiz) {
    var card = $('elQuestionsCard');
    var list = $('elQuestionsList');
    var meta = $('elQuestionsMeta');
    if (!card || !list) return;
    list.innerHTML = '';
    (quiz.questions || []).forEach(function(q, qi) {
      var qEl = el('article', { class: 'el-question', 'data-qid': q.id, style: '--el-i:' + Math.min(qi, 12) });
      var title = el('div', { class: 'el-q-title' });
      title.appendChild(el('span', { class: 'el-q-type', text: q.type === 'cloze' ? '??' : '??' }));
      title.appendChild(document.createTextNode('Q' + (qi + 1) + '. ' + (q.question || '棰樼洰')));
      qEl.appendChild(title);
      if (q.type === 'mc') renderMcQuestion(qEl, q);
      else if (q.type === 'cloze') renderClozeQuestion(qEl, q);
      qEl.appendChild(el('div', { class: 'el-q-explain', 'data-explain-for': q.id, style: 'display:none' }));
      list.appendChild(qEl);
    });
    if (meta) {
      var mc = (quiz.questions || []).filter(function(q) { return q.type === 'mc'; }).length;
      var cloze = (quiz.questions || []).filter(function(q) { return q.type === 'cloze'; }).length;
      meta.textContent = mc + ' 鍗曢€?路 ' + cloze + ' 瀹屽舰';
    }
    card.style.removeProperty('display');
    var submit = $('elSubmitBtn');
    if (submit) submit.disabled = false;
  }

  function renderMcQuestion(parent, q) {
    var opts = el('div', { class: 'el-q-options' });
    (q.options || []).forEach(function(opt, oi) {
      var optEl = el('label', { class: 'el-q-option', 'data-oi': oi, 'data-qid': q.id });
      var input = el('input', { type: 'radio', name: 'q_' + q.id, value: String(oi) });
      input.addEventListener('change', function() {
        S.currentQuiz.answers[q.id] = oi;
        opts.querySelectorAll('.el-q-option').forEach(function(s) { s.classList.remove('selected'); });
        optEl.classList.add('selected');
      });
      optEl.appendChild(input);
      optEl.appendChild(el('span', { class: 'el-option-letter', text: String.fromCharCode(65 + oi) }));
      optEl.appendChild(el('span', { class: 'el-option-text', text: stripOptionPrefix(opt, oi) }));
      opts.appendChild(optEl);
    });
    parent.appendChild(opts);
  }

  function renderClozeQuestion(parent, q) {
    var ctx = el('div', { class: 'el-q-context' });
    var parts = String(q.context || '').split('___');
    var blankIndex = 0;
    parts.forEach(function(part, pi) {
      if (pi > 0) {
        var currentBlankIndex = blankIndex;
        var blank = q.blanks && q.blanks[currentBlankIndex];
        if (blank) {
          var sel = el('select', { class: 'el-blank-sel', 'data-qid': q.id, 'data-bi': currentBlankIndex, 'aria-label': '? ' + (currentBlankIndex + 1) + ' ?' });
          sel.appendChild(el('option', { value: '-1', text: '? ' + (currentBlankIndex + 1) }));
          (blank.options || []).forEach(function(opt, oi) {
            sel.appendChild(el('option', { value: String(oi), text: String.fromCharCode(65 + oi) }));
          });
          sel.addEventListener('change', function() {
            var v = parseInt(sel.value, 10);
            // selected 瑙嗚鎬? 閫変簡鐪熺瓟妗?(>=0) 鍚庡姞 selected
            if (v >= 0) sel.classList.add('selected');
            else sel.classList.remove('selected');
            if (!S.currentQuiz.answers[q.id]) S.currentQuiz.answers[q.id] = {};
            S.currentQuiz.answers[q.id][currentBlankIndex] = v;
          });
          ctx.appendChild(sel);
        }
        blankIndex++;
      }
      ctx.appendChild(document.createTextNode(part));
    });
    parent.appendChild(ctx);
    var optionPanel = el('div', { class: 'el-cloze-options' });
    optionPanel.appendChild(el('div', { class: 'el-cloze-ref-label', text: '???? ? ?????' }));
    (q.blanks || []).forEach(function(blank, bi) {
      var group = el('div', { class: 'el-cloze-group' });
      group.appendChild(el('div', { class: 'el-cloze-label', text: '绌?' + (bi + 1) }));
      (blank.options || []).forEach(function(opt, oi) {
        group.appendChild(el('div', { class: 'el-cloze-choice', text: String.fromCharCode(65 + oi) + '. ' + stripOptionPrefix(opt, oi) }));
      });
      optionPanel.appendChild(group);
    });
    parent.appendChild(optionPanel);
  }

  function stripOptionPrefix(opt, index) {
    var text = String(opt || '');
    var letter = String.fromCharCode(65 + index);
    return text.replace(new RegExp('^\\s*' + letter + '[\\.|銆乗\)]\\s*', 'i'), '');
  }

  function hideArticle() {
    var c = $('elArticleCard'); if (c) c.style.setProperty('display', 'none', 'important');
    // locale-bar 濮嬬粓鏄剧ず, 璁?閲嶆柊鐢熸垚"鎸夐挳浠讳綍鏃跺€欓兘鍙
  }
  function hideQuestions() { var c = $('elQuestionsCard'); if (c) c.style.setProperty('display', 'none', 'important'); }
  function hideResult() { var c = $('elResultCard'); if (c) c.style.setProperty('display', 'none', 'important'); }

  /* ============ 杈圭紭闇撹櫣澹版尝鍔犺浇鍔ㄧ敾 (Siri 椋庢牸) ============
   * 鍦嗚鐭╁舰鍛ㄩ暱鍩哄噯鐐?+ 鍙?sine 骞叉秹 + lighter 娣峰悎 + shadowBlur 娉涘厜
   * - canvas 閫忔槑娴眰, 涓嶉樆鎸￠〉闈氦浜?
   * - 鍏ュ満: overlay 浠庡簳閮?scaleY(0)鈫?, 澹版尝鍚屾浠庡井寮卞埌涓版弧
   * - 閫€鍦? 鍔?leaving 绫?scaleY 鍙嶅悜鏀剁缉, 鍋滄 rAF
   */
  var _neonRaf = 0;
  var _neonCtx = null;
  var _neonCanvas = null;
  var _neonStart = 0;
  var _neonDPR = 1;
  var _neonBasePts = [];
  var _neonLines = [];
  var _neonW = 0, _neonH = 0;
  var _neonState = 'idle';

  var NEON_PADDING = 3;
  var NEON_RADIUS  = 22;
  var NEON_POINTS  = 600;
  var NEON_LINES   = 26;
  var NEON_AMP     = 12;

  function neonBuildBase(w, h) {
    var pad = NEON_PADDING, r = NEON_RADIUS;
    var wLine = Math.max(0, w - 2 * pad - 2 * r);
    var hLine = Math.max(0, h - 2 * pad - 2 * r);
    var arc = Math.PI / 2 * r;
    var total = 2 * wLine + 2 * hLine + 4 * arc;
    var pts = [];
    for (var i = 0; i < NEON_POINTS; i++) {
      var d = (i / NEON_POINTS) * total;
      var x, y, nx, ny;
      if (d < wLine) {
        x = pad + r + d; y = pad; nx = 0; ny = 1;
      } else if (d < wLine + arc) {
        var a = (d - wLine) / arc * (Math.PI / 2) - Math.PI / 2;
        x = w - pad - r + Math.cos(a) * r; y = pad + r + Math.sin(a) * r;
        nx = -Math.cos(a); ny = -Math.sin(a);
      } else if (d < wLine + arc + hLine) {
        var cd = d - (wLine + arc);
        x = w - pad; y = pad + r + cd; nx = -1; ny = 0;
      } else if (d < wLine + 2 * arc + hLine) {
        var a = (d - (wLine + arc + hLine)) / arc * (Math.PI / 2);
        x = w - pad - r + Math.cos(a) * r; y = h - pad - r + Math.sin(a) * r;
        nx = -Math.cos(a); ny = -Math.sin(a);
      } else if (d < 2 * wLine + 2 * arc + hLine) {
        var cd = d - (wLine + 2 * arc + hLine);
        x = w - pad - r - cd; y = h - pad; nx = 0; ny = -1;
      } else if (d < 2 * wLine + 3 * arc + hLine) {
        var a = (d - (2 * wLine + 2 * arc + hLine)) / arc * (Math.PI / 2) + Math.PI / 2;
        x = pad + r + Math.cos(a) * r; y = h - pad - r + Math.sin(a) * r;
        nx = -Math.cos(a); ny = -Math.sin(a);
      } else if (d < 2 * wLine + 3 * arc + 2 * hLine) {
        var cd = d - (2 * wLine + 3 * arc + hLine);
        x = pad; y = h - pad - r - cd; nx = 1; ny = 0;
      } else {
        var a = (d - (2 * wLine + 3 * arc + 2 * hLine)) / arc * (Math.PI / 2) + Math.PI;
        x = pad + r + Math.cos(a) * r; y = pad + r + Math.sin(a) * r;
        nx = -Math.cos(a); ny = -Math.sin(a);
      }
      pts.push({x: x, y: y, nx: nx, ny: ny, t: i / NEON_POINTS});
    }
    _neonBasePts = pts;
    _neonW = w; _neonH = h;
  }

  function neonBuildLines() {
    var palette = [
      [10, 132, 255],
      [191, 90, 242],
      [255, 55, 95],
      [94, 92, 230],
      [255, 149, 0]
    ];
    var lines = [];
    for (var i = 0; i < NEON_LINES; i++) {
      var c = palette[i % palette.length];
      lines.push({
        r: c[0], g: c[1], b: c[2],
        freq1: Math.floor(3 + Math.random() * 5),
        freq2: Math.floor(5 + Math.random() * 7),
        speed1: (Math.random() > 0.5 ? 1 : -1) * (0.8 + Math.random() * 1.4),
        speed2: (Math.random() > 0.5 ? 1 : -1) * (1.1 + Math.random() * 1.8),
        phase1: Math.random() * Math.PI * 2,
        phase2: Math.random() * Math.PI * 2,
        amp: 5 + Math.random() * NEON_AMP,
        thick: Math.random() < 0.22 ? 2.2 : 1.1,
        pulseSpeed: 0.5 + Math.random() * 1.4,
        alpha: 0.55 - (i / NEON_LINES) * 0.35
      });
    }
    _neonLines = lines;
  }

  function neonResize() {
    if (!_neonCanvas) return;
    var parent = _neonCanvas.parentElement;
    if (!parent) return;
    var w = parent.clientWidth;
    var h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    _neonDPR = Math.min(window.devicePixelRatio || 1, 2);
    _neonCanvas.width  = Math.floor(w * _neonDPR);
    _neonCanvas.height = Math.floor(h * _neonDPR);
    _neonCanvas.style.width  = w + 'px';
    _neonCanvas.style.height = h + 'px';
    _neonCtx.setTransform(_neonDPR, 0, 0, _neonDPR, 0, 0);
    neonBuildBase(w, h);
    if (!_neonLines.length) neonBuildLines();
  }

  function neonEase(x) { return x < 0.5 ? 2*x*x : 1-Math.pow(-2*x+2,2)/2; }

  function neonDrawFrame(ts) {
    if (!_neonCtx || _neonState === 'idle') return;
    var ctx = _neonCtx;
    var w = _neonW, h = _neonH;
    var elapsed = (ts - _neonStart) / 1000;

    var intensity;
    if (_neonState === 'enter') {
      intensity = Math.min(1, elapsed / 0.55);
      intensity = neonEase(intensity);
      if (elapsed >= 0.55) _neonState = 'live';
    } else if (_neonState === 'leaving') {
      intensity = Math.max(0, 1 - elapsed / 0.42);
      intensity = 1 - neonEase(1 - intensity);
      if (elapsed >= 0.42) {
        _neonState = 'idle';
        ctx.clearRect(0, 0, w, h);
        _neonRaf = 0;
        return;
      }
    } else {
      intensity = 1;
    }

    var breath = 0.88 + Math.sin(elapsed * 1.8) * 0.12;
    var globalAmp = intensity * breath;

    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var time = elapsed * 0.9;
    for (var li = 0; li < _neonLines.length; li++) {
      var L = _neonLines[li];
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(' + L.r + ',' + L.g + ',' + L.b + ',' + (L.alpha * intensity).toFixed(3) + ')';
      ctx.lineWidth = L.thick;
      ctx.shadowColor = 'rgba(' + L.r + ',' + L.g + ',' + L.b + ',0.9)';
      ctx.shadowBlur = 10 * intensity;

      for (var i = 0; i < _neonBasePts.length; i++) {
        var pt = _neonBasePts[i];
        var ang1 = pt.t * Math.PI * 2 * L.freq1 + time * L.speed1 + L.phase1;
        var ang2 = pt.t * Math.PI * 2 * L.freq2 + time * L.speed2 + L.phase2;
        var wave = (Math.sin(ang1) + Math.sin(ang2)) * 0.5;
        var pAng = pt.t * Math.PI * 2 - time * L.pulseSpeed;
        var pulse = (Math.sin(pAng) + 1.2) * 0.5;
        var off = wave * L.amp * pulse * globalAmp;
        var px = pt.x + pt.nx * off;
        var py = pt.y + pt.ny * off;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;

    _neonRaf = requestAnimationFrame(neonDrawFrame);
  }

  function neonStart() {
    _neonCanvas = document.getElementById('elLoadingCanvas');
    if (!_neonCanvas) return;
    _neonCtx = _neonCanvas.getContext('2d');
    if (!_neonCtx) return;
    _neonLines = [];
    neonResize();
    if (_neonW === 0 || _neonH === 0) return;
    neonBuildLines();
    _neonStart = performance.now();
    _neonState = 'enter';
    cancelAnimationFrame(_neonRaf);
    _neonRaf = requestAnimationFrame(neonDrawFrame);
    window.removeEventListener('resize', neonResize);
    window.addEventListener('resize', neonResize);
  }
  function neonStop() {
    if (_neonState === 'idle' || !_neonCanvas) {
      cancelAnimationFrame(_neonRaf);
      _neonRaf = 0;
      window.removeEventListener('resize', neonResize);
      return;
    }
    var overlay = _neonCanvas.parentElement;
    if (overlay) overlay.classList.add('leaving');
    _neonState = 'leaving';
    _neonStart = performance.now();
    setTimeout(function() {
      if (overlay) overlay.classList.remove('leaving');
      window.removeEventListener('resize', neonResize);
    }, 500);
  }

  function showLoading(on) {
    var l = $('elLoading');
    var g = $('elGenBtn');
    if (l) {
      if (on) {
        l.classList.remove('leaving');
        l.hidden = false;
        l.setAttribute('aria-busy', 'true');
        requestAnimationFrame(function() { requestAnimationFrame(function() { neonStart(); }); });
      } else {
        l.setAttribute('aria-busy', 'false');
        neonStop();
        setTimeout(function() { if (l) l.hidden = true; }, 520);
      }
    }
    if (g) {
      g.disabled = on || getWordsForGeneration(false).length === 0;
      g.textContent = on ? '鐢熸垚涓?..' : '鐢熸垚涓撳睘缁冧範';
    }
  }

  function submitAnswers() {
    if (!S.currentQuiz) return;
    var quiz = S.currentQuiz;
    var correct = 0;
    var total = 0;
    var missed = [];
    (quiz.questions || []).forEach(function(q) {
      if (q.type === 'mc') {
        total++;
        var ua = quiz.answers[q.id];
        var ok = typeof ua === 'number' && ua === parseInt(q.answer, 10);
        if (ok) correct++;
        else missed.push(buildMistake(q, ua, quiz));
      } else if (q.type === 'cloze') {
        (q.blanks || []).forEach(function(blank, bi) {
          total++;
          var ua2 = (quiz.answers[q.id] || {})[bi];
          var ok2 = typeof ua2 === 'number' && ua2 === parseInt(blank.answer, 10);
          if (ok2) correct++;
          else missed.push(buildMistake(q, ua2, quiz, bi));
        });
      }
    });
    var pct = total ? Math.round((correct / total) * 100) : 0;
    showResult(correct, total, pct);
    updateMasteryFromQuiz(quiz, correct, total);
    S.mistakes = missed.concat(S.mistakes).slice(0, MAX_MISTAKES);
    S.history.unshift({
      id: uid('h'),
      correct: correct,
      score: correct,
      total: total,
      pct: pct,
      level: quiz.level,
      types: quiz.types,
      topic: quiz.topic || '',
      words: quiz.words || [],
      mistakeCount: missed.length,
      time: now()
    });
    S.history = S.history.slice(0, MAX_HISTORY);
    scheduleSave();
    renderAll();
    showAllAnswers();
  }

  function buildMistake(q, answer, quiz, blankIndex) {
    var words = findWordsInText([q.question, q.context, (q.options || []).join(' '), quiz.article].join(' '));
    var correctAnswer = '';
    var userAnswer = '';
    if (q.type === 'mc') {
      correctAnswer = optionText(q.options, q.answer);
      userAnswer = typeof answer === 'number' ? optionText(q.options, answer) : '???';
    } else {
      var blank = q.blanks && q.blanks[blankIndex];
      correctAnswer = blank ? optionText(blank.options, blank.answer) : '';
      userAnswer = blank && typeof answer === 'number' ? optionText(blank.options, answer) : '???';
    }
    return {
      id: uid('m'),
      questionId: q.id,
      type: q.type,
      question: q.question || (q.type === 'cloze' ? '瀹屽舰濉┖' : '棰樼洰'),
      context: q.context || '',
      blankIndex: typeof blankIndex === 'number' ? blankIndex : -1,
      userAnswer: userAnswer,
      correctAnswer: correctAnswer,
      explain: q.explain || (q.blanks && q.blanks[blankIndex] && q.blanks[blankIndex].explain) || '',
      words: words,
      level: quiz.level,
      time: now()
    };
  }

  function optionText(options, index) {
    index = parseInt(index, 10);
    if (!Array.isArray(options) || isNaN(index) || index < 0 || index >= options.length) return '';
    return String.fromCharCode(65 + index) + '. ' + stripOptionPrefix(options[index], index);
  }

  function findWordsInText(text) {
    text = String(text || '').toLowerCase();
    return S.words.filter(function(w) {
      return w.en && new RegExp('\\b' + escapeRegExp(w.en) + '\\b', 'i').test(text);
    }).map(function(w) { return w.en; }).slice(0, 12);
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function updateMasteryFromQuiz(quiz, correct, total) {
    var used = {};
    (quiz.words || []).forEach(function(w) { used[String(w || '').toLowerCase()] = true; });
    var ratio = total ? correct / total : 0;
    S.words.forEach(function(w) {
      if (!used[w.en]) return;
      w.seen = (w.seen || 0) + 1;
      if (ratio >= 0.7) w.correct = (w.correct || 0) + 1;
      else w.wrong = (w.wrong || 0) + 1;
      var score = w.correct + w.wrong > 0 ? Math.round((w.correct / (w.correct + w.wrong)) * 100) : 0;
      w.mastery = Math.round((w.mastery || 0) * 0.45 + score * 0.55);
      w.lastReviewedAt = now();
      w.updatedAt = now();
    });
  }

  function showResult(correct, total, pct) {
    var card = $('elResultCard');
    var score = $('elResultScore');
    var text = $('elResultText');
    if (!card) return;
    if (score) score.textContent = correct + ' / ' + total + ' 路 ' + pct + '%';
    if (text) {
      text.textContent = pct >= 80 ? '??????????' :
        pct >= 60 ? '?????????????' :
        '???????????????';
    }
    card.style.removeProperty('display');
    // 涓嶅啀鑷姩 scrollIntoView, 閬垮厤椤甸潰璺冲姩
    try { /* card.scrollIntoView({ behavior: 'smooth', block: 'center' }); */ } catch (e) {}
  }

  function showAllAnswers() {
    if (!S.currentQuiz) return;
    var quiz = S.currentQuiz;
    (quiz.questions || []).forEach(function(q) {
      if (q.type === 'mc') {
        document.querySelectorAll('.el-q-option[data-qid="' + q.id + '"]').forEach(function(opt) {
          opt.classList.add('disabled');
          var oi = parseInt(opt.getAttribute('data-oi'), 10);
          if (oi === parseInt(q.answer, 10)) opt.classList.add('correct');
          var ua = quiz.answers[q.id];
          if (typeof ua === 'number' && ua === oi && ua !== parseInt(q.answer, 10)) opt.classList.add('wrong');
        });
        revealExplain(q.id, '姝ｇ‘绛旀: ' + optionText(q.options, q.answer) + ' 路 ' + (q.explain || ''));
      } else if (q.type === 'cloze') {
        (q.blanks || []).forEach(function(blank, bi) {
          document.querySelectorAll('.el-blank-sel[data-qid="' + q.id + '"][data-bi="' + bi + '"]').forEach(function(sel) {
            sel.value = String(blank.answer);
            sel.classList.add('correct');
          });
        });
        var parts = (q.blanks || []).map(function(blank, bi) { return '? ' + (bi + 1) + ': ' + optionText(blank.options, blank.answer); });
        revealExplain(q.id, '??: ' + parts.join('?') + ' ? ' + ((q.blanks && q.blanks[0] && q.blanks[0].explain) || ''));
      }
    });
    var submit = $('elSubmitBtn');
    if (submit) submit.disabled = true;
  }

  function revealExplain(id, text) {
    var node = document.querySelector('.el-q-explain[data-explain-for="' + id + '"]');
    if (!node) return;
    node.textContent = text;
    node.style.display = '';
    node.classList.add('is-visible');
  }

  function renderAll() {
    // 鎬ц兘浼樺寲: 浣跨敤 rAF 鍚堝苟澶氭 renderAll 璋冪敤, 閬垮厤杩炵画瑙﹀彂 DOM 鎶栧姩
    if (renderAll._rafId) return;
    renderAll._rafId = requestAnimationFrame(function() {
      renderAll._rafId = 0;
      applySettingsToInputs();
      renderStats();
      renderWordList();
      updateGenInfo();
      updateTabIndicator();
    });
  }

  function switchTab(name) {
    ['library', 'practice'].forEach(function(p) {
      var pane = $('elPane' + p.charAt(0).toUpperCase() + p.slice(1));
      if (pane) pane.classList.toggle('active', p === name);
    });
    document.querySelectorAll('.el-tab').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-eltab') === name);
    });
    setTimeout(updateTabIndicator, 20);
    // 涓嶅啀閲嶇疆 page.scrollTop, 閬垮厤鐐瑰嚮鐢熸垚/閲嶆柊鐢熸垚鏃堕〉闈㈣烦鍒伴《閮?
  }

  function updateTabIndicator() {
    var tabs = document.querySelector('.el-tabs');
    var indicator = document.querySelector('.el-tab-indicator');
    var active = document.querySelector('.el-tab.active');
    if (!tabs || !indicator || !active) return;
    var tr = tabs.getBoundingClientRect();
    var ar = active.getBoundingClientRect();
    // 瑙嗚涓婅 indicator 姣?cell 绐?8px (宸﹀彸鍚?4px), 鐪嬭捣鏉ュ儚涓€涓嫭绔嬭兌鍥?
    var inset = 4;
    var w = Math.max(40, ar.width - inset * 2);
    indicator.style.width = w + 'px';
    indicator.style.transform = 'translateX(' + (ar.left - tr.left + inset) + 'px)';
  }

  function refreshChipStates() {
    document.querySelectorAll('.el-chip').forEach(function(label) {
      var input = label.querySelector('input');
      label.classList.toggle('selected', !!(input && input.checked));
    });
  }

  function setDockBarVisible(visible) {
    var dockBar = document.querySelector('.dock-bar');
    if (dockBar) dockBar.style.display = visible ? '' : 'none';
  }

  function setPageScrollLocked(locked) {
    try {
      document.body.classList.toggle('english-learning-open', !!locked);
      document.documentElement.style.overflow = locked ? 'hidden' : '';
      document.body.style.overflow = locked ? 'hidden' : '';
      document.body.style.touchAction = locked ? 'none' : '';
    } catch (e) {}
  }

  async function openPage() {
    var panel = $('panelEnglishLearning');
    if (!panel) return;
    if (S.closeTimer) {
      clearTimeout(S.closeTimer);
      S.closeTimer = null;
    }
    if (S.openTimer) {
      clearTimeout(S.openTimer);
      S.openTimer = null;
    }
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
    panel.classList.remove('el-closing');
    panel.classList.remove('el-opening');
    void panel.offsetWidth;
    panel.classList.add('el-opening');
    panel.classList.add('el-show');
    S.openTimer = setTimeout(function() {
      panel.classList.remove('el-opening');
      S.openTimer = null;
    }, 180);
    setPageScrollLocked(true);
    setDockBarVisible(false);
    if (!S.initialized) {
      S.initialized = true;
      applyState(getLocalState());
      renderAll();
      initializeState();
    } else {
      renderAll();
    }
  }

  function closePage() {
    var panel = $('panelEnglishLearning');
    if (!panel) return;
    if (S.openTimer) {
      clearTimeout(S.openTimer);
      S.openTimer = null;
    }
    if (S.closeTimer) {
      clearTimeout(S.closeTimer);
      S.closeTimer = null;
    }
    panel.classList.remove('el-opening');
    panel.classList.add('el-closing');
    panel.classList.remove('el-show');
    panel.setAttribute('aria-hidden', 'true');
    S.closeTimer = setTimeout(function() {
      panel.classList.add('hidden');
      panel.classList.remove('el-closing');
      S.closeTimer = null;
    }, 180);
    setPageScrollLocked(false);
    setDockBarVisible(true);
  }

  function bindEventsSafe() {
    if (S.eventsBound) return;
    S.eventsBound = true;

    safeBind('elBackBtn', 'click', closePage);

    safeBind('elAddWordBtn', 'click', function() {
      handleAddWord();
    });

    ['elWordInput', 'elMeaningInput'].forEach(function(id) {
      safeBind(id, 'keydown', function(ev) {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          var btn = $('elAddWordBtn');
          if (btn) btn.click();
        }
      });
    });

    var wordInput = $('elWordInput');
    if (wordInput) {
      var acTimer = null;
      safeBindNode(wordInput, 'input', function() {
        if (acTimer) clearTimeout(acTimer);
        var q = wordInput.value.trim();
        if (!q) {
          hideAutocomplete();
          return;
        }
        acTimer = setTimeout(function() {
          showAutocomplete(wordInput, getDictMatches(q, 8));
        }, 160);
      }, 'elWordInput:input');
      safeBindNode(wordInput, 'focus', function() {
        var q = wordInput.value.trim();
        if (q) showAutocomplete(wordInput, getDictMatches(q, 8));
      }, 'elWordInput:focus');
      safeBindNode(wordInput, 'blur', function() {
        setTimeout(hideAutocomplete, 180);
      }, 'elWordInput:blur');
    }

    safeBind('elBatchAddBtn', 'click', function() {
      doBatchImport($('elBatchAddBtn'));
    });

    safeBind('elSearchInput', 'input', function() {
      var search = $('elSearchInput');
      S.search = search ? (search.value || '') : '';
      renderWordList();
    });

    safeForEach('.el-filter', function(btn) {
      safeBindNode(btn, 'click', function() {
        S.filter = btn.getAttribute('data-filter') || 'all';
        document.querySelectorAll('.el-filter').forEach(function(node) { node.classList.remove('active'); });
        btn.classList.add('active');
        renderWordList();
      }, 'el-filter');
    });

    var selectAllNode = $('elSelectAllCb');
    safeBind('elSelectAllCb', 'change', function() {
      safeForEach('.el-word-cb', function(cb) {
        cb.checked = !!(selectAllNode && selectAllNode.checked);
        cb.dispatchEvent(new Event('change'));
      });
    });

    safeBind('elDeleteSelBtn', 'click', function() {
      var ids = Array.from(document.querySelectorAll('.el-word-cb:checked')).map(function(cb) {
        return cb.getAttribute('data-id');
      });
      if (!ids.length) {
        notify('璇峰厛閫夋嫨瑕佸垹闄ょ殑鍗曡瘝');
        return;
      }
      if (!confirm('确定删除选中的 ' + ids.length + ' 个单词吗？')) return;
      deleteSelected(ids);
      if (selectAllNode) selectAllNode.checked = false;
      renderAll();
    });

    safeForEach('input[name="elType"], input[name="elLevel"]', function(input) {
      safeBindNode(input, 'change', function() {
        refreshChipStates();
        syncSettingsFromInputs();
        scheduleSave();
      }, 'settings-radio');
    });

    ['elQuestionCount', 'elArticleLength', 'elFocusMode', 'elTopicInput'].forEach(function(id) {
      safeBind(id, 'change', function() {
        syncSettingsFromInputs();
        scheduleSave();
        updateGenInfo();
      });
    });

    safeBind('elGenBtn', 'click', function() { generateQuiz(); });
    safeBind('elRegenArticleBtn', 'click', function() { generateQuiz({ regenArticle: true }); });
    safeBind('elSubmitBtn', 'click', submitAnswers);
    safeBind('elShowAnswerBtn', 'click', showAllAnswers);
    safeBind('elLoadingCancel', 'click', function() { cancelGeneration(); });
    safeBind('elNewPracticeBtn', 'click', function() {
      hideArticle();
      hideQuestions();
      hideResult();
      switchTab('practice');
      // 涓嶅啀 scrollIntoView
    });
    safeBind('elNewChatBtn', 'click', function() {
      hideArticle();
      hideQuestions();
      hideResult();
      switchTab('practice');
    });
    safeBind('elDeleteBtn', 'click', function() {
      if (!confirm('纭畾娓呯┖鍏ㄩ儴鍗曡瘝銆佺粌涔犺褰曞拰閿欓鍚楋紵')) return;
      clearAll();
      renderAll();
      notify('已清空');
    });
    safeBindNode(window, 'resize', function() {
      setTimeout(updateTabIndicator, 80);
    }, 'window:resize');

  }

  /* ============================================================
   * Tabs 鐐瑰嚮鍒囨崲 + indicator 鎷栧姩鍒囨崲 (iOS segmented control 椋庢牸)
   * ============================================================ */
  function initTabs() {
    var tabsContainer = document.querySelector('#panelEnglishLearning .el-tabs');
    if (!tabsContainer) return;
    var tabs = tabsContainer.querySelectorAll('.el-tab');
    tabs.forEach(function(tab) {
      // 闃叉閲嶅缁戝畾 (鍏煎 init() 閲嶅璋冪敤)
      if (tab.dataset._elTabInited) return;
      tab.dataset._elTabInited = '1';
      tab.setAttribute('draggable', 'false');
      tab.addEventListener('click', function() {
        var name = tab.getAttribute('data-eltab');
        if (name) switchTab(name);
      });
    });

    // indicator 鎷栧姩鍒囨崲 (鍊熼壌 dock-bar drag 妯″紡)
    if (!tabsContainer.dataset._elDragInited) {
      tabsContainer.dataset._elDragInited = '1';
      var indicator = tabsContainer.querySelector('.el-tab-indicator');
      var dragState = null;
      var dragStartX = 0;
      var dragStartIndicatorLeft = 0;
      var dragStartIndicatorWidth = 0;
      var dragSuppressClick = false;

      function currentRect() {
        if (!indicator) return { left: 0, width: 0, containerLeft: tabsContainer.getBoundingClientRect().left };
        var tr = tabsContainer.getBoundingClientRect();
        var ir = indicator.getBoundingClientRect();
        return { left: ir.left - tr.left, width: ir.width, containerLeft: tr.left };
      }
      function getTabRects() {
        var tr = tabsContainer.getBoundingClientRect();
        var rects = [];
        tabs.forEach(function(t) {
          var r = t.getBoundingClientRect();
          rects.push({ tab: t, center: r.left - tr.left + r.width / 2, width: r.width, left: r.left - tr.left });
        });
        return rects;
      }
      function setIndicatorImmediate(left, width) {
        if (!indicator) return;
        indicator.style.width = Math.max(40, width) + 'px';
        indicator.style.transform = 'translateX(' + Math.max(0, left) + 'px)';
      }
      function snapToNearestTab() {
        if (!indicator) return;
        var rects = getTabRects();
        if (!rects.length) return;
        var info = currentRect();
        var center = info.left + info.width / 2;
        var best = rects[0];
        var bestDist = Math.abs(rects[0].center - center);
        for (var i = 1; i < rects.length; i++) {
          var d = Math.abs(rects[i].center - center);
          if (d < bestDist) { bestDist = d; best = rects[i]; }
        }
        // 鎭㈠寮规€ц繃娓?+ 鍒囧埌瀵瑰簲 tab
        tabsContainer.classList.remove('is-dragging');
        var tr = tabsContainer.getBoundingClientRect();
        var ar = best.tab.getBoundingClientRect();
        var inset = 4;
        setIndicatorImmediate(ar.left - tr.left + inset, ar.width - inset * 2);
        var name = best.tab.getAttribute('data-eltab');
        if (name) {
          var active = document.querySelector('.el-tab.active');
          if (active !== best.tab) switchTab(name);
        }
      }

      tabsContainer.addEventListener('pointerdown', function(e) {
        // 鍙湪涓绘寚閽?瑙︽懜
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        // 鐐瑰嚮 tab 鑷繁: 璧?click, 涓嶆姠鎷栧姩
        if (e.target.closest('.el-tab')) return;
        if (!indicator) return;
        dragStartX = e.clientX;
        var info = currentRect();
        dragStartIndicatorLeft = info.left;
        dragStartIndicatorWidth = info.width;
        dragState = 'pending';
        try { tabsContainer.setPointerCapture(e.pointerId); } catch (_) {}
      });
      tabsContainer.addEventListener('pointermove', function(e) {
        if (dragState == null) return;
        if (dragState === 'pending') {
          if (Math.abs(e.clientX - dragStartX) < 4) return; // 4px 姝诲尯
          dragState = 'dragging';
          dragSuppressClick = true;
          tabsContainer.classList.add('is-dragging');
        }
        if (dragState !== 'dragging') return;
        var dx = e.clientX - dragStartX;
        var newLeft = dragStartIndicatorLeft + dx;
        setIndicatorImmediate(newLeft, dragStartIndicatorWidth);
      });
      function endDrag(e) {
        if (dragState == null) return;
        if (dragState === 'dragging') {
          snapToNearestTab();
        } else {
          // 娌＄湡姝ｆ嫋鍔? 瑙ｉ櫎 capturing, 璁?click 璧?
        }
        try { tabsContainer.releasePointerCapture(e.pointerId); } catch (_) {}
        dragState = null;
      }
      tabsContainer.addEventListener('pointerup', endDrag);
      tabsContainer.addEventListener('pointercancel', endDrag);

      // 鎷栧姩缁撴潫鍚庣煭鏆傚拷鐣?click 闃叉璇Е (鍊熼壌 dockBar 妯″紡)
      tabsContainer.addEventListener('click', function(e) {
        if (dragSuppressClick) {
          dragSuppressClick = false;
          e.stopPropagation();
          e.preventDefault();
        }
      }, true);
    }

    // 鍒濆鍖?indicator 浣嶇疆
    setTimeout(updateTabIndicator, 30);
  }

  function findWord(en) {
    en = String(en || '').toLowerCase();
    for (var i = 0; i < S.words.length; i++) if (S.words[i].en === en) return S.words[i];
    return null;
  }

  function init() {
    initTabs();
    bindEventsSafe();
    applyState(getLocalState());
    renderAll();
  }

  window.EnglishLearning = {
    open: openPage,
    close: closePage,
    addWord: function(en, cn) {
      var w = addWord(en, cn);
      renderAll();
      return w;
    },
    getWords: function() { return S.words.slice(); },
    sync: saveRemoteState
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();


