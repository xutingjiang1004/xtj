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
    batchDirty: false,
    batchFeedback: null,
    syncVisualTimer: null
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
    try { return sessionStorage.getItem('xtj_pw_hash') || ''; } catch (e) { return ''; }
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
    if (S.syncVisualTimer) {
      clearTimeout(S.syncVisualTimer);
      S.syncVisualTimer = null;
    }
    node.className = 'el-sync ' + 'is-' + status;
    node.textContent = label || (
      status === 'synced' ? '已同步' :
      status === 'syncing' ? '同步中' :
      status === 'dirty' ? '待同步' :
      status === 'error' ? '未同步' :
      '离线模式'
    );
    node.setAttribute('data-status', status);
    node.setAttribute('data-label', node.textContent);
    node.classList.toggle('is-pulse', status === 'syncing');
    node.classList.remove('is-settled');
    if (status === 'synced' || status === 'error' || status === 'local') {
      S.syncVisualTimer = setTimeout(function() {
        node.classList.add('is-settled');
        S.syncVisualTimer = null;
      }, 420);
    }
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
    if (!resp.ok) throw new Error('同步读取失败');
    var json = await resp.json();
    if (!json.ok) throw new Error(json.error || '同步读取失败');
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
        throw new Error(err || '同步保存失败');
      }
      var json = await resp.json();
      if (!json.ok) throw new Error(json.error || '同步保存失败');
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
   * 娣诲姞鍗曡瘝: 鐢ㄦ埛鎵嬪姩濉噴涔? 涓嶅啀鑷姩璋?AI
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
      list.appendChild(el('div', { class: 'el-empty-hint', text: S.words.length ? '当前筛选条件下没有单词' : '单词库为空，请先添加单词' }));
      return;
    }
    var frag = document.createDocumentFragment();
    words.forEach(function(w, index) {
      var item = el('article', { class: 'el-word-item', 'data-id': w.id, style: '--el-i:' + Math.min(index, 16) });
      var cb = el('input', { type: 'checkbox', class: 'el-word-cb', 'data-id': w.id, 'aria-label': '选择 ' + w.en });
      cb.addEventListener('change', function() {
        item.classList.toggle('selected', cb.checked);
        updateGenInfo();
      });
      var main = el('div', { class: 'el-word-main' });
      main.appendChild(el('div', { class: 'el-word-en', text: w.en }));
      main.appendChild(el('div', { class: 'el-word-cn', text: w.cn || '暂无释义' }));
      var delBtn = el('button', { type: 'button', class: 'el-word-del', 'aria-label': '删除 ' + w.en, title: '删除', text: '×' });
      delBtn.addEventListener('click', function() {
        deleteWord(w.id);
        renderAll();
        notify('已删除 ' + w.en);
      });
      // 已删除? AI 按钮（用户要求），单词只保留?勾选?+ 词义 + 删除
      item.appendChild(cb);
      item.appendChild(main);
      item.appendChild(delBtn);
      frag.appendChild(item);
    });
    list.appendChild(frag);
  }

  function updateGenInfo() {
    var total = getWordsForGeneration(false).length;
    setText('elGenTotal', total);
    var info = $('elGenInfo');
    if (info) info.textContent = '已选 ' + total + ' 个单词';
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
    if (notifyIfEmpty && !words.length) notify('请先添加单词到单词库');
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
   * 批量导入: 本地解析为主, AI 鍙ˉ鍏呴噴涔?
   */
  function stripBatchNoise(line) {
    return String(line || '')
      .replace(/^[\s\-*?·]+/, '')
      .replace(/^\s*\d+[\.\)、\u3001]\s*/, '')
      .replace(/^\s*[\u2460-\u2473\u2474-\u247F]\s*/, '') // ①-⑳ / ⑴-⒇
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
      .replace(/^[\s:：\-\u2014\u2013\u2018\u2019\u201C\u201D\u2022\u2026,\u3001\uff0c\u3002\u00b7\/]+/, '')
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
      var m = line.match(/^([a-zA-Z][a-zA-Z\s\-']{0,59}?)[\s:：\u2014\u2013\u2018\u2019\u201C\u201D\u2022\u2026,\u3001\uff0c\u3002\u00b7\/\|]+([\u4e00-\u9fa5].*)$/);
      if (m) { pushBatchParsed(parsed, seen, m[1], m[2]); return; }
      m = line.match(/^([a-zA-Z][a-zA-Z\-']{0,59})[\s:：\u2014\u2013\u2018\u2019\u201C\u201D\u2022\u2026,\u3001\uff0c\u3002\u00b7\/\|]+(.+)$/);
      if (m) { pushBatchParsed(parsed, seen, m[1], m[2]); return; }
      m = line.match(/[a-zA-Z][a-zA-Z\s\-']{0,59}/);
      if (m) { pushBatchParsed(parsed, seen, m[0], ''); }
    });
    return parsed;
  }

  function parseBatchWordsDetailed(text) {
    text = String(text || '');
    var parsed = parseBatchWordsLocal(text);
    var matched = {};
    parsed.forEach(function(item) {
      if (!item || !item.en) return;
      matched[String(item.en || '').toLowerCase()] = true;
    });
    var failed = [];
    text.split(/\r?\n/).forEach(function(line, index) {
      var cleaned = stripBatchNoise(line);
      if (!cleaned) return;
      var english = cleaned.match(/[a-zA-Z][a-zA-Z\s\-']{0,59}/);
      if (!english) {
        failed.push({ line: index + 1, text: cleaned, reason: '未识别到有效英文单词' });
        return;
      }
      var normalized = cleanBatchWord(english[0]);
      if (!normalized || !matched[normalized]) {
        failed.push({ line: index + 1, text: cleaned, reason: '格式不完整或分隔符异常' });
      }
    });
    return { parsed: parsed, failed: failed };
  }

  function buildBatchFeedback(detail, overrides) {
    detail = detail || { parsed: [], failed: [] };
    overrides = overrides || {};
    var recognized = typeof overrides.recognized === 'number'
      ? overrides.recognized
      : (Array.isArray(detail.parsed) ? detail.parsed.length : 0);
    var added = typeof overrides.added === 'number' ? overrides.added : 0;
    var existing = typeof overrides.existing === 'number' ? overrides.existing : 0;
    var failedRows = Array.isArray(overrides.failedRows) ? overrides.failedRows : (detail.failed || []);
    var previewWords = Array.isArray(overrides.previewWords) ? overrides.previewWords : (detail.parsed || []);
    if (!added && !existing && previewWords.length) {
      previewWords.forEach(function(item) {
        var exists = S.words.some(function(w) { return w.en === item.en; });
        if (exists) existing += 1;
        else added += 1;
      });
    }
    return {
      state: overrides.state || 'preview',
      status: overrides.status || '等待输入',
      recognized: recognized,
      added: added,
      existing: existing,
      failedRows: failedRows,
      previewWords: previewWords.slice(0, 8)
    };
  }

  function renderBatchFeedback(model) {
    var summary = $('elBatchSummary');
    var stats = $('elBatchStats');
    var previewList = $('elBatchPreviewList');
    var status = $('elBatchStatus');
    var failedBox = $('elBatchFailedBox');
    var failedCount = $('elBatchFailedCount');
    var failedList = $('elBatchFailedList');
    if (!summary || !stats || !previewList || !status || !failedBox || !failedCount || !failedList) return;

    model = model || {
      state: 'idle',
      status: '等待输入',
      recognized: 0,
      added: 0,
      existing: 0,
      failedRows: [],
      previewWords: []
    };
    summary.dataset.state = model.state || 'idle';
    summary.classList.toggle('is-empty', !model.recognized && !(model.failedRows && model.failedRows.length));
    status.textContent = model.status || '等待输入';

    stats.innerHTML = '';
    [
      { label: '识别总数', value: model.recognized || 0 },
      { label: '预计新增', value: model.added || 0 },
      { label: '已存在', value: model.existing || 0 },
      { label: '失败行', value: (model.failedRows || []).length }
    ].forEach(function(item) {
      var chip = el('div', { class: 'el-batch-stat' });
      chip.appendChild(el('span', { class: 'el-batch-stat-label', text: item.label }));
      chip.appendChild(el('strong', { class: 'el-batch-stat-value', text: item.value }));
      stats.appendChild(chip);
    });

    previewList.innerHTML = '';
    if (Array.isArray(model.previewWords) && model.previewWords.length) {
      model.previewWords.forEach(function(item) {
        var row = el('div', { class: 'el-batch-preview-item' });
        row.appendChild(el('span', { class: 'el-batch-preview-en', text: item.en || '' }));
        row.appendChild(el('span', { class: 'el-batch-preview-cn', text: item.cn || '待补充释义' }));
        previewList.appendChild(row);
      });
      if ((model.recognized || 0) > model.previewWords.length) {
        previewList.appendChild(el('div', {
          class: 'el-batch-preview-empty is-more',
          text: '还有 ' + ((model.recognized || 0) - model.previewWords.length) + ' 个'
        }));
      }
    } else {
      previewList.appendChild(el('div', {
        class: 'el-batch-preview-empty',
        text: model.state === 'loading' ? '正在解析导入内容...' : '粘贴多行单词后，这里会先给出预解析结果。'
      }));
    }

    failedCount.textContent = String((model.failedRows || []).length);
    failedList.innerHTML = '';
    if (Array.isArray(model.failedRows) && model.failedRows.length) {
      failedBox.hidden = false;
      model.failedRows.forEach(function(item) {
        var row = el('div', { class: 'el-batch-failed-item' });
        row.appendChild(el('div', { class: 'el-batch-failed-line', text: '第 ' + item.line + ' 行 · ' + (item.reason || '未识别') }));
        row.appendChild(el('div', { class: 'el-batch-failed-text', text: item.text || '' }));
        failedList.appendChild(row);
      });
    } else {
      failedBox.hidden = true;
      failedBox.open = false;
    }
  }

  function updateBatchFeedbackFromInput() {
    var input = $('elBatchInput');
    var text = String(input && input.value || '').trim();
    if (!text) {
      S.batchFeedback = null;
      renderBatchFeedback(null);
      return;
    }
    var detail = parseBatchWordsDetailed(text);
    S.batchFeedback = buildBatchFeedback(detail, {
      state: 'preview',
      status: detail.parsed.length ? '已预解析' : '等待调整格式'
    });
    renderBatchFeedback(S.batchFeedback);
  }

  function setBatchImportButtonState(btn, loading) {
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      if (!btn.dataset._oldText) btn.dataset._oldText = btn.textContent;
      btn.textContent = '解析中...';
      btn.classList.remove('is-complete');
      btn.classList.remove('is-warning');
      btn.classList.remove('is-error');
      btn.classList.add('is-loading');
      btn.setAttribute('aria-busy', 'true');
      return;
    }
    btn.disabled = false;
    btn.textContent = btn.dataset._oldText || '批量导入';
    btn.classList.remove('is-loading');
    btn.classList.add('is-complete');
    if (btn._completeTimer) clearTimeout(btn._completeTimer);
    btn._completeTimer = setTimeout(function() {
      btn.classList.remove('is-complete');
      btn._completeTimer = null;
    }, 720);
    btn.removeAttribute('aria-busy');
  }

  async function doBatchImport(btn) {
    var input = $('elBatchInput');
    if (!input) { notify('批量导入输入框未找到', 'error'); return; }
    var text = String(input.value || '').trim();
    if (!text) { notify('请先输入要导入的单词'); return; }
    var detail = parseBatchWordsDetailed(text);
    S.batchFeedback = buildBatchFeedback(detail, {
      state: 'loading',
      status: '正在解析与校验'
    });
    renderBatchFeedback(S.batchFeedback);
    setBatchImportButtonState(btn, true);

    var localParsed = detail.parsed || [];
    var parsedMap = {};
    localParsed.forEach(function(w) { parsedMap[w.en] = { en: w.en, cn: w.cn || '' }; });

    try {
      var headers = await getAuthHeaders();
      var resp = await fetch(apiBase() + '/english/parse-batch', {
        method: 'POST',
        headers: headers,
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
            var tmp = [];
            var seen2 = {};
            Object.keys(parsedMap).forEach(function(k) { seen2[k] = true; });
            pushBatchParsed(tmp, seen2, en, p.cn || '');
            if (tmp.length) parsedMap[en] = tmp[0];
          }
        });
      }
    } catch (e) {}

    var parsed = Object.keys(parsedMap).map(function(k) { return parsedMap[k]; });
    if (!parsed.length) {
      setBatchImportButtonState(btn, false);
      if (btn) {
        btn.classList.remove('is-complete');
        btn.classList.add('is-error');
      }
      S.batchFeedback = buildBatchFeedback(detail, {
        state: 'error',
        status: '未识别到可导入内容',
        recognized: 0,
        added: 0,
        existing: 0
      });
      renderBatchFeedback(S.batchFeedback);
      notify('没有提取到有效英文单词，请检查输入', 'error');
      return;
    }

    var existed = 0;
    var addedCount = 0;
    beginBatchMutation();
    parsed.forEach(function(p) {
      if (!p || !p.en) return;
      var prev = S.words.some(function(w) { return w.en === p.en; }) ? 1 : 0;
      var result = addWord(p.en, p.cn || '', true);
      existed += prev;
      if (!prev && result) addedCount += 1;
    });
    S.batchDirty = true;
    endBatchMutation({ render: true });
    input.value = '';
    setBatchImportButtonState(btn, false);
    if (btn) {
      btn.classList.remove('is-error');
      btn.classList.toggle('is-warning', !!detail.failed.length);
    }
    S.batchFeedback = buildBatchFeedback(detail, {
      state: detail.failed.length ? 'warning' : 'success',
      status: detail.failed.length ? '导入完成，存在未识别行' : '导入完成',
      recognized: parsed.length,
      added: addedCount,
      existing: existed,
      previewWords: parsed
    });
    renderBatchFeedback(S.batchFeedback);

    notify(
      '批量导入完成：识别 ' + parsed.length +
      ' 个，新增 ' + addedCount +
      ' 个，已存在 ' + existed +
      ' 个' + (addedCount === 0 && existed > 0 ? '（均为已存在的单词）' : '')
    );
  };

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
    // 閲嶆柊鐢熸垚鏃跺彧闅愯棌鏃ч/鏃ф枃绔? 淇濈暀 scrollTop 浣撻獙鏇村钩婊?
    if (opts.regenArticle || opts.regenQuiz) {
      hideArticle();
      hideQuestions();
    } else {
      hideArticle();
      hideQuestions();
    }
    scheduleSave();

    // AbortController: 鐢ㄦ埛鐐?鍙栨秷" 鎴?鍒囧埌鍗曡瘝搴撳悗鎯冲仠步㈢敓鎴愭椂鍙珛鍗充腑步?fetch
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
      notify('请先登录后再生成练习', 'error');
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
      if (!json.ok || !json.data) throw new Error(json.error || '返回数据异常');
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
      // 用户主动取消: 静默关闭 loading
      if (S.isCancelled || (e2 && e2.name === 'AbortError')) {
        S.isCancelled = false;
        return;
      }
      try { console.error('[EL] generate error:', e2); } catch (e3) {}
      // 后端不可用时，用本地模板兜底? 用户不至于完全卡住?
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
          updateOfflinePracticeState(S.currentQuiz);
          notify('后端接口不可用，已加载离线示例');
          return;
        } catch (e4) {
          try { console.error('[EL] local fallback failed:', e4); } catch (_) {}
        }
      }
      var hint = emsg || '未知错误';
      if (/HTTP 501|Unsupported method/i.test(hint)) {
        hint = '后端接口不支持当前请求方式，请检查服务';
      } else if (/HTTP 404|Not Found/i.test(hint)) {
        hint = '后端接口未找到，请确认服务已启动';
      }
      notify('生成失败: ' + hint, 'error');
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

  function updateOfflinePracticeState(quiz) {
    var isLocal = !!(quiz && quiz.local);
    var articleCard = $('elArticleCard');
    var questionsCard = $('elQuestionsCard');
    var localeBar = $('elLocaleBar');
    var practicePane = $('elPanePractice');
    var banner = document.querySelector('#panelEnglishLearning .el-offline-banner');

    [articleCard, questionsCard, localeBar].forEach(function(node) {
      if (!node) return;
      if (isLocal) node.setAttribute('data-local', 'true');
      else node.removeAttribute('data-local');
    });

    if (!isLocal) {
      if (banner) banner.remove();
      return;
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'el-offline-banner';
      banner.innerHTML =
        '<div class=\"el-offline-banner-title\">离线示例</div>' +
        '<div class=\"el-offline-banner-meta\">当前内容为本地模板示例，非 AI 生成；后端恢复后可重新生成正式练习。</div>';
      if (practicePane) practicePane.insertBefore(banner, practicePane.firstChild);
    }
  }

  function renderArticle(quiz) {
    var card = $('elArticleCard');
    var text = $('elArticleText');
    var meta = $('elArticleMeta');
    var wordsBox = $('elArticleWords');
    if (!card || !text) return;
    updateOfflinePracticeState(quiz);
    var article = String(quiz.article || '(本轮未生成文章)');
    text.innerHTML = buildHighlightedArticle(article, quiz.words || []);
    if (meta) meta.textContent = (quiz.words.length || 0) + ' words · ' + (quiz.level || '').toUpperCase();
    if (wordsBox) {
      wordsBox.innerHTML = '';
      (quiz.words || []).slice(0, 24).forEach(function(w) {
        var tag = el('span', { class: 'el-word-tag', text: w });
        wordsBox.appendChild(tag);
      });
    }
    // 鐢?removeProperty 娓呮帀鍙兘瀛樺湪鐨?important inline display，让?CSS 默认 (block) 生效
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
   * 鏈湴鍏滃簳: 妯℃澘鍖栫敓鎴愭枃绔?+ 棰樼洰
   * 鐪熸鐨?AI 鍐呭闇€瑕佸悗绔? 杩欓噷鍙槸涓嶈鐢ㄦ埛鍗′綇
   */
  function buildLocalQuiz(words, level, types, settings) {
    // Fisher-Yates 娲楃墝, 姣忔生成中嶅悓鐨勬牱鏈?
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
    // 鍔犲叆闅忔満绉嶅瓙璁?article 姣忔閮戒笉鍚?
    var seed = ' (sample ' + Math.random().toString(36).slice(2, 6) + ')';
    var article = 'Local Practice (offline mode)' + seed + '\n\n'
      + 'This is a sample article for offline practice. '
      + 'Words in this set: ' + used.join(', ') + '. '
      + 'You can learn them: ' + cnList.join('; ') + '. '
      + 'Add more words to your library and try again when the server is available.';
    var topic = (settings && settings.topic) ? settings.topic : 'general';
    var levelLabel = (level || 'cet4').toUpperCase();

    // 工具: 找到 opts 鏁扮粍涓纭」鐨勪綅缃?(answer 蹇呴』鏄暟瀛楃储寮? 涓?renderMcQuestion 兼容)
    function indexOfAnswer(opts, ans) {
      for (var i = 0; i < opts.length; i++) {
        if (opts[i] === ans) return i;
      }
      return 0;
    }

    var questions = [];
    var qid = 1;
    var qcount = Math.max(2, Math.min(8, (settings && settings.questionCount) || 6));

    if (types.indexOf('article') >= 0 && sample.length) {
      // 阅读理解: 匹配单词-释义 (mc 绫诲瀷, 绛旀鐢ㄧ储寮?
      var w0 = sample[0];
      var correctOpt = w0.en + ' (' + (w0.cn || '???') + ')';
      var opts1 = sample.slice(0, Math.min(3, sample.length)).map(function(w) { return w.en + ' (' + (w.cn || '') + ')'; });
      opts1.push(correctOpt);
      opts1 = shuffle(opts1).slice(0, 4);
      // 确保正确项在 opts 中
      if (opts1.indexOf(correctOpt) < 0) opts1[0] = correctOpt;
      questions.push({
        id: 'q' + (qid++),
        type: 'mc',
        question: '以下哪个单词与 "' + (w0.cn || '主题') + '" 对应?',
        options: opts1,
        answer: indexOfAnswer(opts1, correctOpt),
        explain: w0.en + ' 的含义是 "' + (w0.cn || '') + '"'
      });
    }

    if (types.indexOf('mc') >= 0) {
      // 閫夋嫨棰? 姣忓崟璇嶄竴閬撻噴涔夊尮閰?(mc 类型)
      var need = Math.max(1, qcount - questions.length);
      sample.slice(0, need).forEach(function(w) {
        var correctOpt = w.cn || ('释义: ' + w.en);
        var pool = [correctOpt];
        var distractors = sample.filter(function(x) { return x.en !== w.en; }).slice(0, 6);
        distractors.forEach(function(d) { pool.push((d.cn || d.en) + ' / ' + d.en); });
        pool = shuffle(pool).slice(0, 4);
        if (pool.indexOf(correctOpt) < 0) pool[0] = correctOpt;
        pool = shuffle(pool);
        questions.push({
          id: 'q' + (qid++),
          type: 'mc',
          question: '"' + w.en + '" 的中文释义最接近:',
          options: pool,
          answer: indexOfAnswer(pool, correctOpt),
          explain: '该单词在单词库中释义为: ' + (w.cn || '暂无')
        });
      });
    }

    if (types.indexOf('cloze') >= 0 && sample.length) {
      // 瀹屽舰濉┖: 蹇呴』鐢?q.blanks 数组结构, renderClozeQuestion 才能渲染
      var target = sample[0];
      var optTexts = [target.en].concat(sample.slice(1, 4).map(function(x) { return x.en; })).slice(0, 4);
      optTexts = shuffle(optTexts);
      // 鐢?___ 浣滀负鎸栫┖鏍囪, renderClozeQuestion 会按 ___ 切分并插入下拉框
      var clozeContext = 'In this example, please fill in the blank: ___ means ' + (target.cn || 'something') + '.';
      var blank = {
        options: optTexts,
        answer: indexOfAnswer(optTexts, target.en),
        explain: '答案: ' + target.en + (target.cn ? ' (' + target.cn + ')' : '')
      };
      questions.push({
        id: 'q' + (qid++),
        type: 'cloze',
        question: '完形填空 (本地模板)',
        context: clozeContext,
        blanks: [blank]
      });
    }

    // 涓嶈冻鏁伴噺琛ラ€夋嫨棰?
    while (questions.length < qcount && sample.length) {
      var w2 = sample[questions.length % sample.length];
      var correctOpt2 = w2.cn || ('释义: ' + w2.en);
      var pool2 = [correctOpt2];
      // 用其他单词的释义做干扰项
      sample.forEach(function(x) { if (x.en !== w2.en && pool2.length < 4) pool2.push(x.cn || ('释义: ' + x.en)); });
      while (pool2.length < 2) pool2.push('(暂无释义)');
      pool2 = shuffle(pool2);
      questions.push({
        id: 'q' + (qid++),
        type: 'mc',
        question: '"' + w2.en + '" 的中文释义是?',
        options: pool2,
        answer: indexOfAnswer(pool2, correctOpt2),
        explain: '正确答案: ' + (w2.cn || '暂无释义')
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
    updateOfflinePracticeState(quiz);
    list.innerHTML = '';
    (quiz.questions || []).forEach(function(q, qi) {
      var qEl = el('article', { class: 'el-question', 'data-qid': q.id, style: '--el-i:' + Math.min(qi, 12) });
      var title = el('div', { class: 'el-q-title' });
      title.appendChild(el('span', { class: 'el-q-type', text: q.type === 'cloze' ? '??' : '??' }));
      title.appendChild(document.createTextNode('Q' + (qi + 1) + '. ' + (q.question || '题目')));
      qEl.appendChild(title);
      if (q.type === 'mc') renderMcQuestion(qEl, q);
      else if (q.type === 'cloze') renderClozeQuestion(qEl, q);
      qEl.appendChild(el('div', { class: 'el-q-explain', 'data-explain-for': q.id, style: 'display:none' }));
      list.appendChild(qEl);
    });
    if (meta) {
      var mc = (quiz.questions || []).filter(function(q) { return q.type === 'mc'; }).length;
      var cloze = (quiz.questions || []).filter(function(q) { return q.type === 'cloze'; }).length;
      meta.textContent = mc + ' 单选 · ' + cloze + ' 完形';
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
          var sel = el('select', { class: 'el-blank-sel', 'data-qid': q.id, 'data-bi': currentBlankIndex, 'aria-label': '填空 ' + (currentBlankIndex + 1) });
          sel.appendChild(el('option', { value: '-1', text: '空 ' + (currentBlankIndex + 1) }));
          (blank.options || []).forEach(function(opt, oi) {
            sel.appendChild(el('option', { value: String(oi), text: String.fromCharCode(65 + oi) }));
          });
          sel.addEventListener('change', function() {
            var v = parseInt(sel.value, 10);
            // selected 视觉态? 选了真答案?(>=0) 后加 selected
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
    optionPanel.appendChild(el('div', { class: 'el-cloze-ref-label', text: '选项参考' }));
    (q.blanks || []).forEach(function(blank, bi) {
      var group = el('div', { class: 'el-cloze-group' });
      group.appendChild(el('div', { class: 'el-cloze-label', text: '空' + (bi + 1) }));
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
    // locale-bar 濮嬬粓鏄剧ず, 璁?閲嶆柊鐢熸垚"鎸夐挳浠讳綍鏃跺€欓兘鍙
  }
  function hideQuestions() { var c = $('elQuestionsCard'); if (c) c.style.setProperty('display', 'none', 'important'); }
  function hideResult() { var c = $('elResultCard'); if (c) c.style.setProperty('display', 'none', 'important'); }

  /* ============ 边缘霓虹声波加载动画 (Siri 风格) ============
   * 鍦嗚鐭╁舰鍛ㄩ暱鍩哄噯鐐?+ 鍙?sine 干涉 + lighter 混合 + shadowBlur 泛光
   * - canvas 閫忔槑娴眰, 涓嶉樆鎸￠〉闈氦浜?
   * - 入场: overlay 浠庡簳閮?scaleY(0)鈫?, 澹版尝鍚屾浠庡井寮卞埌涓版弧
   * - 閫€鍦? 鍔?leaving 绫?scaleY 反向收缩, 停止 rAF
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
        l.setAttribute('data-state', 'loading');
        requestAnimationFrame(function() { requestAnimationFrame(function() { neonStart(); }); });
      } else {
        l.setAttribute('aria-busy', 'false');
        l.setAttribute('data-state', 'idle');
        neonStop();
        setTimeout(function() { if (l) l.hidden = true; }, 520);
      }
    }
    if (g) {
      g.disabled = on || getWordsForGeneration(false).length === 0;
      g.textContent = on ? '生成中...' : '生成专属练习';
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
    if (quiz.local) return; // 本地模板示例不写入历史
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
      question: q.question || (q.type === 'cloze' ? '完形填空' : '题目'),
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
    if (score) score.textContent = correct + ' / ' + total + ' · ' + pct + '%';
    if (text) {
      text.textContent = pct >= 80 ? '太棒了，掌握得很好！' :
        pct >= 60 ? '不错哦，继续加油！' :
        '别灰心，多练习会更好！';
    }
    card.style.removeProperty('display');
    // 不再自动 scrollIntoView, 避免页面跳动
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
        revealExplain(q.id, '正确答案: ' + optionText(q.options, q.answer) + ' · ' + (q.explain || ''));
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
    // 性能优化: 使用 rAF 合并多次 renderAll 调用, 避免连续触发 DOM 抖动
    if (renderAll._rafId) return;
    renderAll._rafId = requestAnimationFrame(function() {
      renderAll._rafId = 0;
      applySettingsToInputs();
      renderStats();
      renderWordList();
      renderBatchFeedback(S.batchFeedback);
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
    // 不再重置 page.scrollTop, 閬垮厤鐐瑰嚮鐢熸垚/閲嶆柊鐢熸垚鏃堕〉闈㈣烦鍒伴《閮?
  }

  function updateTabIndicator() {
    var tabs = document.querySelector('.el-tabs');
    var indicator = document.querySelector('.el-tab-indicator');
    var active = document.querySelector('.el-tab.active');
    if (!tabs || !indicator || !active) return;
    var tr = tabs.getBoundingClientRect();
    var ar = active.getBoundingClientRect();
    // 视觉上让 indicator 姣?cell 绐?8px (宸﹀彸鍚?4px), 鐪嬭捣鏉ュ儚涓€涓嫭绔嬭兌鍥?
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

    safeBind('elBatchInput', 'input', function() {
      updateBatchFeedbackFromInput();
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
        notify('请先选择要删除的单词');
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
      // 不再 scrollIntoView
    });
    safeBind('elNewChatBtn', 'click', function() {
      hideArticle();
      hideQuestions();
      hideResult();
      switchTab('practice');
    });
    safeBind('elDeleteBtn', 'click', function() {
      if (!confirm('确定清空全部单词、练习记录和错题吗？')) return;
      clearAll();
      renderAll();
      notify('已清空');
    });
    safeBindNode(window, 'resize', function() {
      setTimeout(updateTabIndicator, 80);
    }, 'window:resize');

  }

  /* ============================================================
   * Tabs 点击切换 + indicator 拖动切换 (iOS segmented control 风格)
   * ============================================================ */
  function initTabs() {
    var tabsContainer = document.querySelector('#panelEnglishLearning .el-tabs');
    if (!tabsContainer) return;
    var tabs = tabsContainer.querySelectorAll('.el-tab');
    tabs.forEach(function(tab) {
      // 防止重复绑定 (兼容 init() 重复调用)
      if (tab.dataset._elTabInited) return;
      tab.dataset._elTabInited = '1';
      tab.setAttribute('draggable', 'false');
      tab.addEventListener('click', function() {
        var name = tab.getAttribute('data-eltab');
        if (name) switchTab(name);
      });
    });

    // indicator 拖动切换 (借鉴 dock-bar drag 模式)
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
        // 鎭㈠寮规€ц繃娓?+ 鍒囧埌瀵瑰簲 tab
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
        // 鍙湪涓绘寚閽?瑙︽懜
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        // 点击 tab 鑷繁: 璧?click, 不抢拖动
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
          if (Math.abs(e.clientX - dragStartX) < 4) return; // 4px 死区
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
          // 娌＄湡步ｆ嫋鍔? 瑙ｉ櫎 capturing, 璁?click 璧?
        }
        try { tabsContainer.releasePointerCapture(e.pointerId); } catch (_) {}
        dragState = null;
      }
      tabsContainer.addEventListener('pointerup', endDrag);
      tabsContainer.addEventListener('pointercancel', endDrag);

      // 鎷栧姩缁撴潫鍚庣煭鏆傚拷鐣?click 防止误触 (借鉴 dockBar 模式)
      tabsContainer.addEventListener('click', function(e) {
        if (dragSuppressClick) {
          dragSuppressClick = false;
          e.stopPropagation();
          e.preventDefault();
        }
      }, true);
    }

    // 鍒濆鍖?indicator 位置
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


