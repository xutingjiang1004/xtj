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
    initialized: false,
    syncStatus: 'local',
    syncTimer: null,
    saveInFlight: false,
    pendingSave: false,
    lastRemoteUpdatedAt: 0,
    openTimer: null,
    closeTimer: null,
    eventsBound: false
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
      '本机模式'
    );
  }

  async function loadRemoteState() {
    var headers = await getAuthHeaders();
    var body = addLegacyAuth({}, headers);
    if (!headers.Authorization && (!body.user_name || !body.password_hash)) {
      setSyncStatus('local', '本机模式');
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
    if (S.syncTimer) clearTimeout(S.syncTimer);
    S.syncTimer = setTimeout(saveRemoteState, SAVE_DEBOUNCE_MS);
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
        setSyncStatus('local', '本机模式');
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
   * 添加单词: 用户只输入英文时, 自动调 AI 补全中文释义
   * ============================================================ */
  async function handleAddWord() {
    var wordInput = $('elWordInput');
    var cnInput = $('elMeaningInput');
    if (!wordInput) return;
    var en = String(wordInput.value || '').trim();
    var cn = String(cnInput && cnInput.value || '').trim();
    if (!en) { notify('请输入英文单词'); return; }
    // 先本地添加 (有 cn 就直接用, 没 cn 也允许空 cn 留位)
    var w = addWord(en, cn);
    if (!w) return;
    if (wordInput) wordInput.value = '';
    if (cnInput) cnInput.value = '';
    renderAll();
    notify('已添加 ' + w.en + (w.cn ? ' · ' + w.cn : ' · AI 补全中...'));
    if (wordInput) wordInput.focus();
    // 没填 cn 时, 调 AI 补全
    if (!w.cn) {
      try {
        var headers = await getAuthHeaders();
        var resp = await fetch(apiBase() + '/english/explain-word', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ en: w.en })
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var json = await resp.json();
        if (json && json.ok && json.data && json.data.cn) {
          w.cn = json.data.cn;
          scheduleSave();
          renderAll();
          notify('AI 补全: ' + w.en + ' = ' + w.cn);
        }
      } catch (e) {
        try { console.warn('[EL] ai-fill-cn failed:', e && e.message); } catch (_) {}
        // 失败静默, 用户可以手动补
      }
    }
  }

  /* ============================================================
   * AI 解释单词: 点击单词卡 AI 按钮
   * 弹层显示 例句 / 同义词 / 记忆技巧
   * ============================================================ */
  async function aiExplainWord(w) {
    if (!w || !w.en) return;
    var cached = w._aiExplain;
    var modal = ensureAiModal();
    modal.title.textContent = w.en;
    modal.body.innerHTML = '<div class="el-ai-loading">AI 正在分析...</div>';
    modal.root.style.display = 'flex';
    requestAnimationFrame(function() { modal.root.classList.add('show'); });
    if (cached) {
      renderAiExplain(modal.body, w.en, cached);
      return;
    }
    try {
      var headers = await getAuthHeaders();
      var resp = await fetch(apiBase() + '/english/explain-word', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ en: w.en })
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var json = await resp.json();
      if (!json.ok || !json.data) throw new Error(json.error || 'AI 返回异常');
      w._aiExplain = json.data;
      renderAiExplain(modal.body, w.en, json.data);
    } catch (e) {
      modal.body.innerHTML = '<div class="el-ai-error">AI 解析失败: ' + (e.message || '网络异常') + '</div>';
    }
  }

  function renderAiExplain(body, en, data) {
    var html = '';
    html += '<div class="el-ai-cn">' + escapeHtml(data.cn || '—') + '</div>';
    if (data.tip) html += '<div class="el-ai-tip">💡 ' + escapeHtml(data.tip) + '</div>';
    if (Array.isArray(data.synonyms) && data.synonyms.length) {
      html += '<div class="el-ai-row"><div class="el-ai-label">近义词</div><div class="el-ai-tags">';
      data.synonyms.forEach(function(s) { html += '<span class="el-ai-tag">' + escapeHtml(s) + '</span>'; });
      html += '</div></div>';
    }
    if (Array.isArray(data.examples) && data.examples.length) {
      html += '<div class="el-ai-row"><div class="el-ai-label">例句</div>';
      data.examples.forEach(function(ex) {
        html += '<div class="el-ai-ex">• ' + escapeHtml(ex) + '</div>';
      });
      html += '</div>';
    }
    body.innerHTML = html;
  }

  function ensureAiModal() {
    var root = $('elAiModal');
    if (!root) {
      root = document.createElement('div');
      root.id = 'elAiModal';
      root.className = 'el-ai-modal';
      root.innerHTML = '<div class="el-ai-card"><div class="el-ai-head"><div class="el-ai-title">—</div><button type="button" class="el-ai-close" aria-label="关闭">×</button></div><div class="el-ai-body">—</div></div>';
      document.body.appendChild(root);
      root.addEventListener('click', function(e) { if (e.target === root) closeAiModal(); });
      root.querySelector('.el-ai-close').addEventListener('click', closeAiModal);
    }
    return {
      root: root,
      title: root.querySelector('.el-ai-title'),
      body: root.querySelector('.el-ai-body')
    };
  }

  function closeAiModal() {
    var root = $('elAiModal');
    if (!root) return;
    root.classList.remove('show');
    setTimeout(function() { root.style.display = 'none'; }, 220);
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
    if ((w.seen || 0) === 0) return '新词';
    if (m >= 80) return '掌握';
    if (m >= 60) return '熟悉';
    return '薄弱';
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
      list.appendChild(el('div', { class: 'el-empty-hint', text: S.words.length ? '没有匹配的单词。' : '还没有单词，添加一个开始学习。' }));
      return;
    }
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
        notify('已删除: ' + w.en);
      });
      var speakBtn = el('button', { type: 'button', class: 'el-word-speak', title: '发音', 'aria-label': '发音 ' + w.en, text: 'AI' });
      speakBtn.addEventListener('click', function() { aiExplainWord(w); });
      item.appendChild(cb);
      item.appendChild(main);
      item.appendChild(speakBtn);
      item.appendChild(delBtn);
      list.appendChild(item);
    });
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
    if (info) info.innerHTML = '将使用 <span id="elGenTotal">' + total + '</span> 个单词';
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
   * 批量导入: 智能判断格式, 必要时调 AI 解析
   * 1. 全部行都是 "en cn" 格式 (英文开头) → 本地解析, 不调用 AI
   * 2. 否则 (含中文句子/短语/不规范) → 调用 /english/parse-batch
   */
  async function doBatchImport(btn) {
    var input = $('elBatchInput');
    if (!input) { notify('批量导入输入框未找到', 'error'); return; }
    var text = String(input.value || '').trim();
    if (!text) { notify('请先输入要导入的单词'); return; }
    if (btn) { btn.disabled = true; btn.dataset._oldText = btn.textContent; btn.textContent = '解析中...'; }

    var parsed = null;
    var lines = text.split(/[\n\r]+/);
    var allEng = lines.every(function(line) {
      var t = line.trim();
      if (!t) return true;
      // 整行必须以英文单词开头
      return /^[a-zA-Z][a-zA-Z\s\-']*(\s|$)/.test(t);
    });

    if (allEng) {
      // 本地解析
      parsed = [];
      lines.forEach(function(line) {
        line = line.trim();
        if (!line) return;
        var m = line.match(/^([a-zA-Z][a-zA-Z\s\-']*?)\s+(.+)$/);
        var en, cn;
        if (m) { en = m[1].trim(); cn = m[2].trim(); }
        else { en = line; cn = ''; }
        parsed.push({ en: en, cn: cn });
      });
    } else {
      // 调用 AI 解析
      try {
        var headers = await getAuthHeaders();
        var resp = await fetch(apiBase() + '/english/parse-batch', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ text: text, max_count: 80 })
        });
        if (!resp.ok) {
          var ej = null;
          try { ej = await resp.json(); } catch (e) {}
          throw new Error((ej && ej.error) || ('HTTP ' + resp.status));
        }
        var json = await resp.json();
        if (!json.ok || !json.data || !Array.isArray(json.data.words)) throw new Error('AI 返回数据异常');
        parsed = json.data.words;
      } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = btn.dataset._oldText || '批量导入'; }
        notify('AI 解析失败: ' + (e.message || '未知错误'), 'error');
        return;
      }
    }

    if (!parsed || !parsed.length) {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset._oldText || '批量导入'; }
      notify('没有提取到有效单词, 请重试');
      return;
    }

    var before = S.words.length;
    var added = 0;
    parsed.forEach(function(p) {
      if (addWord(p.en, p.cn, true)) added++;
    });
    var totalAdded = S.words.length - before;
    if (input) input.value = '';
    renderAll();
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset._oldText || '批量导入'; }
    notify(totalAdded > 0 ? ('批量导入完成: +' + totalAdded + ' 词') : '这些词已经在单词库了');
  }

  async function generateQuiz(opts) {
    opts = opts || {};
    if (S.isGenerating) {
      notify('正在生成中, 请稍候...');
      return;
    }
    syncSettingsFromInputs();
    var words = getWordsForGeneration(true);
    if (!words.length) return;
    var types = getSelectedTypes();
    if (!types.length) {
      notify('请至少选择一种题目类型');
      return;
    }
    var level = getSelectedLevel();
    S.isGenerating = true;
    updateGenInfo();
    showLoading(true);
    hideResult();
    // 重新生成时只隐藏旧题/旧文章, 保留 scrollTop 体验更平滑
    if (opts.regenArticle || opts.regenQuiz) {
      hideArticle();
      hideQuestions();
    } else {
      hideArticle();
      hideQuestions();
    }
    scheduleSave();
    var headers;
    try {
      headers = await getAuthHeaders();
    } catch (e) {
      showLoading(false);
      S.isGenerating = false;
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
      var resp = await fetch(apiBase() + '/english/generate', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
      });
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
      try { console.error('[EL] generate error:', e2); } catch (e3) {}
      // 后端不可用时, 用本地模板兜底, 用户不至于完全卡住
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
          notify('已使用本地模板生成 (后端不可用, 题目为示例格式)');
          return;
        } catch (e4) {
          try { console.error('[EL] local fallback failed:', e4); } catch (_) {}
        }
      }
      var hint = emsg || '未知错误';
      if (/HTTP 501|Unsupported method/i.test(hint)) {
        hint = '本地服务不支持 POST, 已尝试本地模板失败';
      } else if (/HTTP 404|Not Found/i.test(hint)) {
        hint = '本地服务未启动, 已尝试本地模板失败';
      }
      notify('生成失败: ' + hint, 'error');
    } finally {
      showLoading(false);
      S.isGenerating = false;
      updateGenInfo();
    }
  }

  function renderArticle(quiz) {
    var card = $('elArticleCard');
    var text = $('elArticleText');
    var meta = $('elArticleMeta');
    var wordsBox = $('elArticleWords');
    if (!card || !text) return;
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
    card.style.display = '';
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
   * 本地兜底: 模板化生成文章 + 题目
   * 真正的 AI 内容需要后端, 这里只是不让用户卡住
   */
  function buildLocalQuiz(words, level, types, settings) {
    var sample = words.slice(0, Math.min(8, words.length));
    var used = sample.map(function(w) { return w.en; });
    var cnList = sample.map(function(w) { return w.cn || ''; });
    var article = 'Local Practice (offline mode)\n\n'
      + 'This is a sample article for offline practice. '
      + 'Words: ' + used.join(', ') + '. '
      + 'These words are great for your study: ' + cnList.join('; ') + '. '
      + 'You can add more words to your library and try again when the server is available.';
    var topic = (settings && settings.topic) ? settings.topic : 'general';
    var levelLabel = (level || 'cet4').toUpperCase();

    // 工具: 找到 opts 数组中正确项的位置 (answer 必须是数字索引, 与 renderMcQuestion 兼容)
    function indexOfAnswer(opts, ans) {
      for (var i = 0; i < opts.length; i++) {
        if (opts[i] === ans) return i;
      }
      return 0;
    }
    // Fisher-Yates 洗牌
    function shuffle(arr) {
      var out = arr.slice();
      for (var i = out.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
      }
      return out;
    }

    var questions = [];
    var qid = 1;
    var qcount = Math.max(2, Math.min(8, (settings && settings.questionCount) || 6));

    if (types.indexOf('reading') >= 0 && sample.length) {
      // 阅读理解: 匹配单词-释义 (mc 类型, 答案用索引)
      var w0 = sample[0];
      var correctOpt = w0.en + ' (' + (w0.cn || '主题词') + ')';
      var opts1 = sample.slice(0, Math.min(3, sample.length)).map(function(w) { return w.en + ' (' + (w.cn || '') + ')'; });
      opts1.push(correctOpt);
      opts1 = shuffle(opts1).slice(0, 4);
      // 确保正确项在 opts 中
      if (opts1.indexOf(correctOpt) < 0) opts1[0] = correctOpt;
      questions.push({
        id: 'q' + (qid++),
        type: 'mc',
        question: '下列哪个单词与 "' + (w0.cn || '主题') + '" 对应?',
        options: opts1,
        answer: indexOfAnswer(opts1, correctOpt),
        explain: '答案来自单词库中 ' + w0.en + ' 的释义。'
      });
    }

    if (types.indexOf('choice') >= 0) {
      // 选择题: 每单词一道释义匹配 (mc 类型)
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
      // 完形填空: 必须用 q.blanks 数组结构, renderClozeQuestion 才能渲染
      var target = sample[0];
      var optTexts = [target.en].concat(sample.slice(1, 4).map(function(x) { return x.en; })).slice(0, 4);
      optTexts = shuffle(optTexts);
      // 用 ___ 作为挖空标记, renderClozeQuestion 会按 ___ 切分并插入下拉框
      var clozeContext = 'In this example, please fill in the blank: ___ means ' + (target.cn || 'something') + '.';
      var blank = {
        options: optTexts,
        answer: indexOfAnswer(optTexts, target.en),
        explain: '完形填空示例 (本地模式)。'
      };
      questions.push({
        id: 'q' + (qid++),
        type: 'cloze',
        question: '完形填空 (本地模板)',
        context: clozeContext,
        blanks: [blank]
      });
    }

    // 不足数量补选择题
    while (questions.length < qcount && sample.length) {
      var w2 = sample[questions.length % sample.length];
      var correctOpt2 = w2.cn || ('释义: ' + w2.en);
      var pool2 = [correctOpt2, '其他含义', '不相关', '跳过'];
      pool2 = shuffle(pool2);
      questions.push({
        id: 'q' + (qid++),
        type: 'mc',
        question: '"' + w2.en + '" 的中文释义是?',
        options: pool2,
        answer: indexOfAnswer(pool2, correctOpt2),
        explain: '本地模板示例题。'
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
      title.appendChild(el('span', { class: 'el-q-type', text: q.type === 'cloze' ? '完形' : '单选' }));
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
    card.style.display = '';
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
          var sel = el('select', { class: 'el-blank-sel', 'data-qid': q.id, 'data-bi': currentBlankIndex, 'aria-label': '第 ' + (currentBlankIndex + 1) + ' 空' });
          sel.appendChild(el('option', { value: '-1', text: '空' + (currentBlankIndex + 1) }));
          (blank.options || []).forEach(function(opt, oi) {
            sel.appendChild(el('option', { value: String(oi), text: String.fromCharCode(65 + oi) }));
          });
          sel.addEventListener('change', function() {
            var v = parseInt(sel.value, 10);
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
    (q.blanks || []).forEach(function(blank, bi) {
      var group = el('div', { class: 'el-cloze-group' });
      group.appendChild(el('div', { class: 'el-cloze-label', text: '空 ' + (bi + 1) }));
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
    return text.replace(new RegExp('^\\s*' + letter + '[\\.|、\\)]\\s*', 'i'), '');
  }

  function hideArticle() { var c = $('elArticleCard'); if (c) c.style.display = 'none'; }
  function hideQuestions() { var c = $('elQuestionsCard'); if (c) c.style.display = 'none'; }
  function hideResult() { var c = $('elResultCard'); if (c) c.style.display = 'none'; }

  function showLoading(on) {
    var l = $('elLoading');
    var g = $('elGenBtn');
    if (l) l.style.display = on ? '' : 'none';
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
      userAnswer = typeof answer === 'number' ? optionText(q.options, answer) : '未作答';
    } else {
      var blank = q.blanks && q.blanks[blankIndex];
      correctAnswer = blank ? optionText(blank.options, blank.answer) : '';
      userAnswer = blank && typeof answer === 'number' ? optionText(blank.options, answer) : '未作答';
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
      text.textContent = pct >= 80 ? '表现稳定，继续保持。' :
        pct >= 60 ? '整体不错，多加练习会更稳。' :
        '建议再生成一组练习巩固薄弱词。';
    }
    card.style.display = '';
    try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
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
        var parts = (q.blanks || []).map(function(blank, bi) { return '空' + (bi + 1) + ': ' + optionText(blank.options, blank.answer); });
        revealExplain(q.id, '答案: ' + parts.join('；') + ' · ' + ((q.blanks && q.blanks[0] && q.blanks[0].explain) || ''));
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
    // 切 tab 时重置页面滚动到顶部, 避免停留在旧 tab 位置
    try {
      var page = document.querySelector('#panelEnglishLearning .el-page');
      if (page) page.scrollTop = 0;
    } catch (e) {}
  }

  function updateTabIndicator() {
    var tabs = document.querySelector('.el-tabs');
    var indicator = document.querySelector('.el-tab-indicator');
    var active = document.querySelector('.el-tab.active');
    if (!tabs || !indicator || !active) return;
    var tr = tabs.getBoundingClientRect();
    var ar = active.getBoundingClientRect();
    indicator.style.width = ar.width + 'px';
    indicator.style.transform = 'translateX(' + (ar.left - tr.left) + 'px)';
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

  function bindEvents() {
    var back = $('elBackBtn');
    if (back) back.addEventListener('click', closePage);

    document.querySelectorAll('.el-tab').forEach(function(tab) {
      tab.addEventListener('click', function() { switchTab(tab.getAttribute('data-eltab')); });
    });

    var addBtn = $('elAddWordBtn');
    if (addBtn) addBtn.addEventListener('click', function() {
      var word = $('elWordInput');
      var cn = $('elMeaningInput');
      var w = addWord(word && word.value, cn && cn.value);
      if (w) {
        notify('已添加: ' + w.en);
        if (word) word.value = '';
        if (cn) cn.value = '';
        renderAll();
        if (word) word.focus();
      }
    });

    ['elWordInput', 'elMeaningInput'].forEach(function(id) {
      var input = $(id);
      if (!input) return;
      input.addEventListener('keydown', function(ev) {
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
      wordInput.addEventListener('input', function() {
        if (acTimer) clearTimeout(acTimer);
        var q = wordInput.value.trim();
        if (!q) { hideAutocomplete(); return; }
        acTimer = setTimeout(function() { showAutocomplete(wordInput, getDictMatches(q, 8)); }, 160);
      });
      wordInput.addEventListener('focus', function() {
        var q = wordInput.value.trim();
        if (q) showAutocomplete(wordInput, getDictMatches(q, 8));
      });
      wordInput.addEventListener('blur', function() { setTimeout(hideAutocomplete, 180); });
    }

    var batchBtn = $('elBatchAddBtn');
    if (batchBtn) batchBtn.addEventListener('click', function() { doBatchImport(batchBtn); });

    var search = $('elSearchInput');
    if (search) search.addEventListener('input', function() {
      S.search = search.value || '';
      renderWordList();
    });

    document.querySelectorAll('.el-filter').forEach(function(btn) {
      btn.addEventListener('click', function() {
        S.filter = btn.getAttribute('data-filter') || 'all';
        document.querySelectorAll('.el-filter').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        renderWordList();
      });
    });

    var selectAll = $('elSelectAllCb');
    if (selectAll) selectAll.addEventListener('change', function() {
      document.querySelectorAll('.el-word-cb').forEach(function(cb) {
        cb.checked = selectAll.checked;
        cb.dispatchEvent(new Event('change'));
      });
    });

    var delSel = $('elDeleteSelBtn');
    if (delSel) delSel.addEventListener('click', function() {
      var ids = Array.from(document.querySelectorAll('.el-word-cb:checked')).map(function(cb) { return cb.getAttribute('data-id'); });
      if (!ids.length) { notify('请先选择要删除的单词'); return; }
      if (!confirm('确定删除选中的 ' + ids.length + ' 个单词?')) return;
      deleteSelected(ids);
      if (selectAll) selectAll.checked = false;
      renderAll();
    });

    document.querySelectorAll('input[name="elType"], input[name="elLevel"]').forEach(function(input) {
      input.addEventListener('change', function() {
        refreshChipStates();
        syncSettingsFromInputs();
        scheduleSave();
      });
    });
    ['elQuestionCount', 'elArticleLength', 'elFocusMode', 'elTopicInput'].forEach(function(id) {
      var node = $(id);
      if (node) node.addEventListener('change', function() {
        syncSettingsFromInputs();
        scheduleSave();
        updateGenInfo();
      });
    });

    var gen = $('elGenBtn');
    if (gen) gen.addEventListener('click', generateQuiz);
    var submit = $('elSubmitBtn');
    if (submit) submit.addEventListener('click', submitAnswers);
    var show = $('elShowAnswerBtn');
    if (show) show.addEventListener('click', showAllAnswers);
    var next = $('elNewPracticeBtn');
    if (next) next.addEventListener('click', function() {
      hideArticle(); hideQuestions(); hideResult();
      switchTab('practice');
      try { $('elGenCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
    });
    var topNew = $('elNewChatBtn');
    if (topNew) topNew.addEventListener('click', function() {
      hideArticle(); hideQuestions(); hideResult();
      switchTab('practice');
    });
    var clear = $('elDeleteBtn');
    if (clear) clear.addEventListener('click', function() {
      if (!confirm('确定清空全部单词吗?')) return;
      clearAll();
      renderAll();
      notify('已清空');
    });
    window.addEventListener('resize', function() { setTimeout(updateTabIndicator, 80); });
  }

  function bindEventsSafe() {
    if (S.eventsBound) return;
    S.eventsBound = true;

    safeBind('elBackBtn', 'click', closePage);

    safeForEach('.el-tab', function(tab) {
      safeBindNode(tab, 'click', function() {
        switchTab(tab.getAttribute('data-eltab'));
      }, 'el-tab');
    });

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
      var input = $('elBatchInput');
      if (!input) { notify('批量导入输入框未找到', 'error'); return; }
      var text = String(input.value || '').trim();
      if (!text) { notify('请先输入要导入的单词'); return; }
      var beforeCount = S.words.length;
      var lines = text.split(/[\n\r]+/);
      var added = 0;
      lines.forEach(function(line) {
        line = line.trim();
        if (!line) return;
        var parts = line.split(/\s+/);
        var en = parts[0];
        var cn = parts.slice(1).join(' ');
        if (addWord(en, cn, true)) added++;
      });
      var totalAdded = S.words.length - beforeCount;
      if (input) input.value = '';
      renderAll();
      notify(totalAdded > 0 ? '批量导入完成: +' + totalAdded + ' 词' : '没有新增有效单词，请检查格式（如: apple 苹果）');
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
    safeBind('elRegenQuizBtn', 'click', function() { generateQuiz({ regenQuiz: true }); });
    safeBind('elSubmitBtn', 'click', submitAnswers);
    safeBind('elShowAnswerBtn', 'click', showAllAnswers);
    safeBind('elNewPracticeBtn', 'click', function() {
      hideArticle();
      hideQuestions();
      hideResult();
      switchTab('practice');
      try { $('elGenCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
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

    // 初始化 tabs 点击切换 (拖拽调换顺序已禁用, 单词库和练习题位置固定)
    initTabs();
  }

  /* ============================================================
   * Tabs 点击切换 (单词库/生成练习位置固定, 不可拖拽调换)
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
    // 初始化 indicator 位置
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
