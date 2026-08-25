/**
 * code-workbench.js — 小猫AI Code 云端代码工作区（独立二级页面）
 *
 * 能力：
 *  1. 连接 GitHub 仓库（输入仓库地址 + Personal Access Token）
 *  2. 文件树浏览 + 文件内容查看 / 在线编辑
 *  3. AI 助手（内置 DeepSeek 或第三方自定义模型）查看 / 修改代码
 *  4. 提交到 GitHub（直接提交 或 创建 Pull Request）
 *  5. 本地持久化：仓库信息 / Token / AI 对话 / 修改历史（localStorage）
 *
 * 安全：GitHub Token 只保存在用户浏览器 localStorage，仅在该用户发起操作时随
 *       请求经本站白名单代理（/api/code/gh-proxy，仅允许 api.github.com）转发，
 *       不在服务端持久化。
 *
 * 依赖：仅使用 window 全局（XTJ_CONFIG / ensureUserToken / currentUser /
 *       XTJSecondaryPageState / showToast），不依赖 ai-agent.js 内部实现。
 */
(function () {
  'use strict';
  if (window.__xtjCodeWorkbenchLoaded) return;
  window.__xtjCodeWorkbenchLoaded = true;

  // ── 常量 ──────────────────────────────────────────────────────
  var LS_REPO = 'xtj_code_repo';
  var LS_TOKEN = 'xtj_code_token';
  var LS_MODEL = 'xtj_code_model';
  var LS_CONV = 'xtj_code_conversation';
  var LS_HISTORY = 'xtj_code_history';
  var LS_PR = 'xtj_code_pr_mode';
  var LS_THINK = 'xtj_code_think';

  var DEFAULT_MODEL = 'deepseek-v4-flash-vision-exp';
  var DEFAULT_THINK = 'high'; // 默认开启深度思考（与主站档位一致）
  var THINK_LEVELS = [
    { id: 'off',    label: '关闭' },
    { id: 'low',    label: '轻度' },
    { id: 'medium', label: '中度' },
    { id: 'high',   label: '深度' },
    { id: 'max',    label: '极致' }
  ];
  var BUILTIN_MODELS = [
    { id: 'deepseek-v4-flash-vision-exp', label: 'DeepSeek V4 Flash（内置）' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro（内置）' }
  ];
  var CUSTOM_MODELS_KEY = 'xtj_ai_custom_models';
  var CUSTOM_PREFIX = 'custom:';
  // 与 ai-agent.js 一致的服务商模板（仅用于解析 base_url 默认值）
  var CUSTOM_MODEL_PROVIDERS = {
    qwen:    { label: '千问 Qwen',     base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
    doubao:  { label: '豆包 Doubao',    base: 'https://ark.cn-beijing.volces.com/api/v3',           defaultModel: 'doubao-1-5-pro-32k' },
    deepseek:{ label: 'DeepSeek',       base: 'https://api.deepseek.com',                           defaultModel: 'deepseek-chat' },
    kimi:    { label: 'Kimi 月之暗面',  base: 'https://api.moonshot.cn/v1',                         defaultModel: 'moonshot-v1-8k' },
    zhipu:   { label: '智谱 GLM',       base: 'https://open.bigmodel.cn/api/paas/v4',               defaultModel: 'glm-4-flash' },
    openai:  { label: 'OpenAI',         base: 'https://api.openai.com/v1',                          defaultModel: 'gpt-4o-mini' },
    custom:  { label: '自定义(OpenAI兼容)', base: '',                                                 defaultModel: '' }
  };

  // 文件树中跳过的垃圾目录 / 依赖锁文件
  var TREE_SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|\.next|\.nuxt|\.output|coverage|target|\.cache|\.idea|\.vscode|__pycache__|\.venv|venv|env|Pods|\.gradle|\.terraform|vendor)(\/|$)/i;
  var TREE_SKIP_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.DS_Store|npm-shrinkwrap\.json|\.gitignore|\.gitattributes)$/i;
  var MAX_FILE_BYTES = 2 * 1024 * 1024; // 查看/编辑单文件上限
  var MAX_AI_FILE_CHARS = 28000;        // 注入 AI 上下文的单文件字符上限

  var API_BASE = '';
  try { API_BASE = String((window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || window.location.origin || '').replace(/\/$/, ''); }
  catch (e) { API_BASE = String(window.location.origin || '').replace(/\/$/, ''); }

  // ── 状态 ──────────────────────────────────────────────────────
  var state = {
    repo: null,          // { owner, repo, branch, default_branch, full_name, html_url, branch_sha }
    token: '',
    model: DEFAULT_MODEL,
    prMode: false,
    thinking: DEFAULT_THINK,
    tree: [],            // [{ path, type: 'blob'|'tree' }]
    currentPath: '',
    currentSha: '',
    currentContent: '',
    busy: false,
    streaming: false,
    abortCtrl: null,
    aiLastOutput: ''
  };

  // ── 基础工具 ──────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === undefined || v === null) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'style') node.style.cssText = v;
        else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      }
    }
    if (children !== undefined && children !== null) {
      if (typeof children === 'string') node.textContent = children;
      else if (Array.isArray(children)) {
        children.forEach(function (c) {
          if (!c) return;
          node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
      }
    }
    return node;
  }

  function notify(msg, type) {
    try {
      if (typeof window.showToast === 'function') { window.showToast(msg, type || 'info'); return; }
      if (typeof window.showNotify === 'function') { window.showNotify(msg, type); return; }
    } catch (e) {}
    try { console.log('[CODE-WB]', msg); } catch (e) {}
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtTime(ts) {
    try {
      var d = new Date(ts);
      if (isNaN(d.getTime())) return '';
      var p = function (n) { return String(n).padStart(2, '0'); };
      return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (e) { return ''; }
  }

  function safeStorageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeStorageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) {}
  }
  function safeStorageRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) {}
  }

  // ── 本地持久化 ────────────────────────────────────────────────
  function loadRepo() {
    try {
      var raw = safeStorageGet(LS_REPO);
      if (!raw) return null;
      var r = JSON.parse(raw);
      if (r && r.owner && r.repo) return r;
    } catch (e) {}
    return null;
  }
  function saveRepo(r) {
    if (r) safeStorageSet(LS_REPO, JSON.stringify(r));
    else safeStorageRemove(LS_REPO);
  }
  function loadToken() { return safeStorageGet(LS_TOKEN) || ''; }
  function saveToken(t) { if (t) safeStorageSet(LS_TOKEN, t); else safeStorageRemove(LS_TOKEN); }
  function loadModel() { return safeStorageGet(LS_MODEL) || DEFAULT_MODEL; }
  function saveModel(m) { safeStorageSet(LS_MODEL, m); }
  function loadConversation() {
    try {
      var raw = safeStorageGet(LS_CONV);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.slice(-100) : [];
    } catch (e) { return []; }
  }
  function saveConversation(arr) { safeStorageSet(LS_CONV, JSON.stringify((arr || []).slice(-100))); }
  function loadHistory() {
    try {
      var raw = safeStorageGet(LS_HISTORY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.slice(-200) : [];
    } catch (e) { return []; }
  }
  function saveHistory(arr) { safeStorageSet(LS_HISTORY, JSON.stringify((arr || []).slice(-200))); }
  function loadPrMode() { return safeStorageGet(LS_PR) === '1'; }
  function loadThink() {
    var v = safeStorageGet(LS_THINK);
    var ok = { off: 1, low: 1, medium: 1, high: 1, max: 1 };
    return (v && ok[v]) ? v : DEFAULT_THINK;
  }
  function saveThink(t) { if (t) safeStorageSet(LS_THINK, t); else safeStorageRemove(LS_THINK); }

  // ── 模型工具 ──────────────────────────────────────────────────
  function loadCustomModels() {
    try {
      var raw = safeStorageGet(CUSTOM_MODELS_KEY);
      if (!raw) return [];
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      return list.filter(function (m) { return m && m.uid && m.api_key; });
    } catch (e) { return []; }
  }
  function isCustomModel(id) { return typeof id === 'string' && id.indexOf(CUSTOM_PREFIX) === 0; }
  function customDisplayName(id) {
    if (!isCustomModel(id)) return '';
    var uid = id.slice(CUSTOM_PREFIX.length);
    var list = loadCustomModels();
    for (var i = 0; i < list.length; i++) {
      if (list[i].uid === uid) return (list[i].label || list[i].model || '自定义模型') + (list[i].provider_label ? ' · ' + list[i].provider_label : '');
    }
    return '自定义模型';
  }
  function resolveCustomCfg(id) {
    if (!isCustomModel(id)) return null;
    var uid = id.slice(CUSTOM_PREFIX.length);
    var list = loadCustomModels();
    for (var i = 0; i < list.length; i++) {
      if (list[i].uid === uid) {
        var m = list[i];
        var p = CUSTOM_MODEL_PROVIDERS[m.provider] || {};
        return {
          provider: m.provider,
          api_key: String(m.api_key || ''),
          model: String(m.model || p.defaultModel || ''),
          base_url: String(m.base_url || p.base || ''),
          label: m.label || m.model || '自定义模型'
        };
      }
    }
    return null;
  }
  function buildModelOptions() {
    var opts = [];
    BUILTIN_MODELS.forEach(function (m) { opts.push({ id: m.id, label: m.label }); });
    var customs = loadCustomModels();
    customs.forEach(function (m) {
      var p = CUSTOM_MODEL_PROVIDERS[m.provider] || {};
      opts.push({ id: CUSTOM_PREFIX + m.uid, label: (m.label || m.model || '自定义模型') + (p.label ? ' · ' + p.label : '') });
    });
    return opts;
  }

  // ── 鉴权 ──────────────────────────────────────────────────────
  async function ensureAuth() {
    var preflight = window.ensureProtectedOperationAuth || window.ensureRealUserAuth;
    if (typeof preflight === 'function') {
      try {
        var a = await preflight();
        if (a && a.ok) return true;
        return false;
      } catch (e) { return false; }
    }
    return !!window.currentUser;
  }
  async function authHeaders() {
    var h = { 'Content-Type': 'application/json' };
    try {
      if (typeof window.ensureUserToken === 'function') {
        var t = await window.ensureUserToken();
        if (t) h.Authorization = 'Bearer ' + t;
      }
    } catch (e) {}
    return h;
  }

  // ── GitHub API 代理 ───────────────────────────────────────────
  async function ghRequest(method, path, ghBody, opts) {
    var headers = await authHeaders();
    var r;
    try {
      r = await fetch(API_BASE + '/api/code/gh-proxy', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          url: 'https://api.github.com' + path,
          method: method,
          token: state.token,
          body: ghBody
        }),
        signal: opts && opts.signal
      });
    } catch (e) {
      return { ok: false, status: 0, data: null, error: (e && e.message) || '网络错误' };
    }
    var data = null;
    try { data = await r.json(); } catch (e) {}
    if (!data || typeof data !== 'object') {
      return { ok: false, status: r.status, data: null, error: '仓库服务响应异常' };
    }
    return { ok: !!data.ok, status: data.status || r.status, data: data.data, raw: data.raw || '', error: data.error };
  }

  // ── 仓库解析 ──────────────────────────────────────────────────
  function parseRepoUrl(raw) {
    var s = String(raw || '').trim();
    if (!s) return null;
    s = s.replace(/^git@github\.com:/, 'https://github.com/');
    var m = s.match(/github\.com\/([^\/?#\s]+)\/([^\/?#\s]+)/i);
    if (!m) return null;
    var owner = m[1].replace(/\.git$/i, '');
    var repo = m[2].replace(/\.git$/i, '');
    if (!owner || !repo) return null;
    return { owner: owner, repo: repo };
  }

  function encodePath(p) {
    return String(p).split('/').map(function (seg) { return encodeURIComponent(seg); }).join('/');
  }

  // ── 通用 SSE 流式读取器（兼容 /api/code/ai 与 /api/agent/custom-chat/stream）──
  function streamAi(payload, callbacks) {
    return new Promise(function (resolve, reject) {
      var controller = new AbortController();
      state.abortCtrl = controller;
      var timer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, 180000);
      var settled = false;
      var fullText = '';
      function finish(ok, val) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { if (state.abortCtrl === controller) state.abortCtrl = null; } catch (e) {}
        if (ok) resolve(val); else reject(val);
      }
      // 站点已登录鉴权头（/api/code/ai 与 /api/agent/custom-chat/stream 都需
      // authenticateUser，不带 Bearer 会被 401 拒绝，AI 助手将无法工作）
      authHeaders().then(function (headers) {
        return fetch(API_BASE + payload.url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload.body),
          signal: controller.signal
        });
      }).then(function (resp) {
        if (!resp.ok) {
          return resp.text().then(function (t) {
            var err = { error: 'HTTP ' + resp.status, code: 'HTTP_' + resp.status };
            try { var j = JSON.parse(t); if (j && j.error) { err.error = j.error; if (j.code) err.code = j.code; } } catch (e) {}
            finish(false, err);
          });
        }
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        function processEvents() {
          var idx;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            var raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            var eventName = 'message';
            var dataLines = [];
            raw.split('\n').forEach(function (line) {
              if (line.indexOf('event:') === 0) eventName = line.slice(6).trim();
              else if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim());
            });
            if (!dataLines.length) continue;
            var evt = null;
            try { evt = JSON.parse(dataLines.join('\n')); } catch (e) { continue; }
            var type = evt.type || eventName;
            if (type === 'content') {
              if (evt.text) { fullText += evt.text; if (callbacks.onContent) callbacks.onContent(evt.text); }
            } else if (type === 'delta') {
              if (evt.content) { fullText += evt.content; if (callbacks.onContent) callbacks.onContent(evt.content); }
            } else if (type === 'reasoning') {
              if (evt.text && callbacks.onReasoning) callbacks.onReasoning(evt.text);
            } else if (type === 'message') {
              if (evt.content) { fullText += evt.content; if (callbacks.onContent) callbacks.onContent(evt.content); }
            } else if (type === 'done') {
              if (callbacks.onDone) callbacks.onDone(evt, fullText);
            } else if (type === 'error') {
              if (callbacks.onError) callbacks.onError(evt);
            }
            // heartbeat / search_status / meta / reasoning_start 等事件忽略
          }
        }
        function pump() {
          return reader.read().then(function (result) {
            if (result.done) {
              processEvents();
              if (callbacks.onEof) callbacks.onEof(fullText);
              finish(true, fullText);
              return;
            }
            buffer += decoder.decode(result.value, { stream: true });
            processEvents();
            return pump();
          }).catch(function (e) {
            finish(false, { error: '流式连接中断', code: 'ABORTED' });
          });
        }
        pump();
      }).catch(function (e) {
        finish(false, { error: '网络异常，请重试', code: 'NETWORK' });
      });
    });
  }

  // ── 界面构建 ──────────────────────────────────────────────────
  var ui = {}; // 缓存 DOM 引用
  var rootNode = null;

  function buildUi() {
    if (rootNode) return rootNode;
    rootNode = el('div', { class: 'cw-page' });

    // 头部
    var header = el('div', { class: 'cw-header' });
    var backBtn = el('button', { type: 'button', class: 'cw-back', 'aria-label': '返回', text: '← 返回' });
    backBtn.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); close(); });
    var title = el('div', { class: 'cw-header-title', text: 'Code 工作区' });
    var actions = el('div', { class: 'cw-actions' });
    var refreshBtn = el('button', { type: 'button', class: 'cw-action', id: 'cwRefreshBtn', text: '刷新' });
    refreshBtn.addEventListener('click', function () { refreshWorkspace(); });
    var disconnectBtn = el('button', { type: 'button', class: 'cw-action cw-danger', id: 'cwDisconnectBtn', text: '断开' });
    disconnectBtn.addEventListener('click', function () { disconnectRepo(); });
    actions.appendChild(refreshBtn);
    actions.appendChild(disconnectBtn);
    header.appendChild(backBtn);
    header.appendChild(title);
    header.appendChild(actions);
    rootNode.appendChild(header);

    // 主体
    var body = el('div', { class: 'cw-body' });
    rootNode.appendChild(body);

    // 连接视图
    var connectView = el('div', { class: 'cw-connect', id: 'cwConnectView' });
    var card = el('div', { class: 'cw-connect-card' });
    card.appendChild(el('div', { class: 'cw-connect-logo', html: '&lt;/&gt;' }));
    card.appendChild(el('h2', { class: 'cw-connect-title', text: '连接 GitHub 仓库' }));
    card.appendChild(el('p', { class: 'cw-connect-desc', text: '输入仓库地址并授权后，AI 可以查看、分析、修改并提交你的代码。' }));

    var repoField = el('div', { class: 'cw-field' });
    repoField.appendChild(el('label', { text: '仓库地址' }));
    var repoInput = el('input', { type: 'text', id: 'cwRepoUrl', class: 'cw-input', placeholder: 'https://github.com/owner/repo', spellcheck: 'false', autocomplete: 'off' });
    repoField.appendChild(repoInput);
    card.appendChild(repoField);

    var tokenField = el('div', { class: 'cw-field' });
    tokenField.appendChild(el('label', { text: 'GitHub Personal Access Token' }));
    var tokenInput = el('input', { type: 'password', id: 'cwToken', class: 'cw-input', placeholder: 'ghp_... 或 github_pat_...', autocomplete: 'off', spellcheck: 'false' });
    tokenField.appendChild(tokenInput);
    card.appendChild(tokenField);

    var modelField = el('div', { class: 'cw-field' });
    modelField.appendChild(el('label', { text: 'AI 模型' }));
    var modelSelect = el('select', { id: 'cwModel', class: 'cw-select' });
    modelField.appendChild(modelSelect);
    card.appendChild(modelField);

    var thinkField = el('div', { class: 'cw-field' });
    thinkField.appendChild(el('label', { text: '思考程度' }));
    var thinkSelect = el('select', { id: 'cwThink', class: 'cw-select' });
    thinkSelect.addEventListener('change', function () {
      state.thinking = thinkSelect.value;
      saveThink(state.thinking);
      try { if (ui.thinkSel) ui.thinkSel.value = state.thinking; } catch (e) {}
    });
    thinkField.appendChild(thinkSelect);
    card.appendChild(thinkField);

    var prRow = el('label', { class: 'cw-pr-row' });
    var prCheck = el('input', { type: 'checkbox', id: 'cwPrMode' });
    prRow.appendChild(prCheck);
    prRow.appendChild(el('span', { text: '提交时创建 Pull Request（不直接推送到主分支）' }));
    card.appendChild(prRow);

    var connectBtn = el('button', { type: 'button', class: 'cw-btn cw-btn-primary', id: 'cwConnectBtn', text: '连接仓库' });
    connectBtn.addEventListener('click', function () { connectRepo(); });
    card.appendChild(connectBtn);

    card.appendChild(el('div', { class: 'cw-connect-tip', text: 'Token 仅保存在你的浏览器本地，仅在你操作时经本站转发到 GitHub，不会上传服务器存储。' }));
    connectView.appendChild(card);
    body.appendChild(connectView);

    // 工作区视图
    var workspace = el('div', { class: 'cw-workspace hidden', id: 'cwWorkspace' });

    var sidebar = el('aside', { class: 'cw-sidebar' });
    var repoRow = el('div', { class: 'cw-repo-row' });
    var repoName = el('div', { class: 'cw-repo-name', id: 'cwRepoName', text: '' });
    var repoBranchWrap = el('div', { class: 'cw-repo-branch-row' });
    repoBranchWrap.appendChild(el('span', { text: '分支' }));
    var branchSel = el('select', { id: 'cwBranchSel', class: 'cw-branch-sel' });
    branchSel.addEventListener('change', function () { switchBranch(); });
    repoBranchWrap.appendChild(branchSel);
    repoRow.appendChild(repoName);
    repoRow.appendChild(repoBranchWrap);
    sidebar.appendChild(repoRow);

    var tabs = el('div', { class: 'cw-tabs' });
    var tabTree = el('button', { type: 'button', class: 'cw-tab on', 'data-tab': 'tree', text: '文件' });
    var tabHist = el('button', { type: 'button', class: 'cw-tab', 'data-tab': 'history', text: '修改历史' });
    tabTree.addEventListener('click', function () { switchTab('tree'); });
    tabHist.addEventListener('click', function () { switchTab('history'); });
    tabs.appendChild(tabTree);
    tabs.appendChild(tabHist);
    sidebar.appendChild(tabs);

    var treeBox = el('div', { class: 'cw-tree', id: 'cwTree' });
    sidebar.appendChild(treeBox);
    var historyBox = el('div', { class: 'cw-history hidden', id: 'cwHistory' });
    sidebar.appendChild(historyBox);
    workspace.appendChild(sidebar);

    var main = el('main', { class: 'cw-main' });
    var viewer = el('div', { class: 'cw-viewer' });
    var viewerHead = el('div', { class: 'cw-viewer-head' });
    var filePath = el('span', { class: 'cw-file-path', id: 'cwFilePath', text: '' });
    var viewerActions = el('div', { class: 'cw-viewer-actions' });
    var editBtn = el('button', { type: 'button', class: 'cw-mini-btn', id: 'cwEditBtn', text: '编辑' });
    editBtn.addEventListener('click', function () { enterEditMode(); });
    var cancelEditBtn = el('button', { type: 'button', class: 'cw-mini-btn hidden', id: 'cwCancelEditBtn', text: '取消编辑' });
    cancelEditBtn.addEventListener('click', function () { exitEditMode(); });
    var saveBtn = el('button', { type: 'button', class: 'cw-mini-btn cw-mini-btn-primary hidden', id: 'cwSaveBtn', text: '保存到仓库' });
    saveBtn.addEventListener('click', function () { startCommit(); });
    viewerActions.appendChild(editBtn);
    viewerActions.appendChild(cancelEditBtn);
    viewerActions.appendChild(saveBtn);
    viewerHead.appendChild(filePath);
    viewerHead.appendChild(viewerActions);
    viewer.appendChild(viewerHead);

    var viewerEmpty = el('div', { class: 'cw-empty', id: 'cwViewerEmpty', text: '从左侧选择文件查看 / 修改，或让 AI 直接改代码' });
    var codePre = el('pre', { class: 'cw-code hidden', id: 'cwCode' });
    var editor = el('textarea', { class: 'cw-editor hidden', id: 'cwEditor', spellcheck: 'false', wrap: 'off' });
    var commitBar = el('div', { class: 'cw-commit-bar hidden', id: 'cwCommitBar' });
    var commitMsg = el('input', { type: 'text', id: 'cwCommitMsg', class: 'cw-input cw-commit-input', placeholder: '提交信息，如：feat: 更新页面标题', spellcheck: 'false', autocomplete: 'off' });
    var commitHint = el('span', { class: 'cw-commit-hint', id: 'cwCommitHint', text: '' });
    var commitBtn = el('button', { type: 'button', class: 'cw-mini-btn cw-mini-btn-primary', id: 'cwCommitBtn', text: '确认提交' });
    commitBtn.addEventListener('click', function () { doCommit(); });
    var commitCancel = el('button', { type: 'button', class: 'cw-mini-btn', id: 'cwCommitCancel', text: '取消' });
    commitCancel.addEventListener('click', function () { cancelCommit(); });
    commitMsg.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doCommit(); }
    });
    commitBar.appendChild(commitMsg);
    commitBar.appendChild(commitHint);
    commitBar.appendChild(commitBtn);
    commitBar.appendChild(commitCancel);
    viewer.appendChild(viewerEmpty);
    viewer.appendChild(codePre);
    viewer.appendChild(editor);
    viewer.appendChild(commitBar);
    main.appendChild(viewer);

    var chat = el('div', { class: 'cw-chat' });
    var chatHead = el('div', { class: 'cw-chat-head' });
    chatHead.appendChild(el('span', { class: 'cw-chat-title', text: 'AI 助手' }));
    var chatModelSel = el('select', { id: 'cwModelSel', class: 'cw-chat-model-sel' });
    chatModelSel.addEventListener('change', function () { state.model = chatModelSel.value; saveModel(state.model); });
    chatHead.appendChild(chatModelSel);
    var thinkSel = el('select', { id: 'cwThinkSel', class: 'cw-chat-model-sel' });
    thinkSel.setAttribute('title', '思考程度');
    thinkSel.addEventListener('change', function () {
      state.thinking = thinkSel.value;
      saveThink(state.thinking);
      try { if (ui.thinkSelect) ui.thinkSelect.value = state.thinking; } catch (e) {}
    });
    chatHead.appendChild(thinkSel);
    var newChatBtn = el('button', { type: 'button', class: 'cw-mini-btn', id: 'cwNewChat', text: '新对话' });
    newChatBtn.addEventListener('click', function () { resetConversation(); });
    chatHead.appendChild(newChatBtn);
    chat.appendChild(chatHead);

    var chatMsgs = el('div', { class: 'cw-chat-msgs', id: 'cwChatMsgs' });
    chat.appendChild(chatMsgs);

    var chatInputBar = el('div', { class: 'cw-chat-input' });
    var chatInput = el('textarea', { id: 'cwChatInput', class: 'cw-chat-textarea', rows: '1', placeholder: '让 AI 修改代码，例如：把首页标题改成「小猫」' });
    var sendBtn = el('button', { type: 'button', class: 'cw-send-btn', id: 'cwChatSend', text: '发送' });
    sendBtn.addEventListener('click', function () { sendChat(); });
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });
    chatInput.addEventListener('input', function () { autoResizeChat(); });
    chatInputBar.appendChild(chatInput);
    chatInputBar.appendChild(sendBtn);
    chat.appendChild(chatInputBar);
    main.appendChild(chat);

    workspace.appendChild(main);
    body.appendChild(workspace);

    // 保存引用
    ui = {
      connectView: connectView,
      workspace: workspace,
      repoInput: repoInput,
      tokenInput: tokenInput,
      modelSelect: modelSelect,
      thinkSelect: thinkSelect,
      thinkSel: thinkSel,
      prCheck: prCheck,
      connectBtn: connectBtn,
      refreshBtn: refreshBtn,
      repoName: repoName,
      branchSel: branchSel,
      treeBox: treeBox,
      historyBox: historyBox,
      tabTree: tabTree,
      tabHist: tabHist,
      filePath: filePath,
      viewerEmpty: viewerEmpty,
      codePre: codePre,
      editor: editor,
      editBtn: editBtn,
      cancelEditBtn: cancelEditBtn,
      saveBtn: saveBtn,
      commitBar: commitBar,
      commitMsg: commitMsg,
      commitHint: commitHint,
      commitBtn: commitBtn,
      commitCancel: commitCancel,
      chatMsgs: chatMsgs,
      chatModelSel: chatModelSel,
      chatInput: chatInput,
      sendBtn: sendBtn
    };
    return rootNode;
  }

  function populateModelSelects() {
    var opts = buildModelOptions();
    var fill = function (sel, current) {
      sel.innerHTML = '';
      var hasCurrent = false;
      opts.forEach(function (o) {
        var opt = el('option', { value: o.id, text: o.label });
        if (o.id === current) { opt.selected = true; hasCurrent = true; }
        sel.appendChild(opt);
      });
      if (!hasCurrent && current) {
        var curOpt = el('option', { value: current, text: customDisplayName(current) || current, selected: true });
        sel.insertBefore(curOpt, sel.firstChild);
      }
    };
    fill(ui.modelSelect, state.model);
    fill(ui.chatModelSel, state.model);
  }

  function populateThinkingSelects() {
    var fill = function (sel, current) {
      if (!sel) return;
      sel.innerHTML = '';
      THINK_LEVELS.forEach(function (o) {
        var opt = el('option', { value: o.id, text: o.label });
        if (o.id === current) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.value = current;
    };
    fill(ui.thinkSelect, state.thinking);
    fill(ui.thinkSel, state.thinking);
  }

  // ── 打开 / 关闭 ───────────────────────────────────────────────
  function open() {
    var panel = document.getElementById('panelCode');
    if (!panel) { notify('代码工作区未就绪，请刷新后重试'); return; }
    if (panel._cwOpen) return;
    panel._cwOpen = true;
    panel.classList.remove('hidden');
    panel.classList.add('active');
    panel.setAttribute('aria-hidden', 'false');
    panel.innerHTML = '';
    panel.appendChild(buildUi());

    try { if (window.XTJSecondaryPageState) window.XTJSecondaryPageState.open('code-workbench'); } catch (e) {}

    // 恢复本地持久化
    state.repo = loadRepo();
    state.token = loadToken();
    state.model = loadModel() || DEFAULT_MODEL;
    state.prMode = loadPrMode();
    state.thinking = loadThink();
    populateModelSelects();
    populateThinkingSelects();
    ui.prCheck.checked = state.prMode;

    if (state.repo) {
      ui.repoInput.value = (state.repo.full_name ? 'https://github.com/' + state.repo.full_name : ('https://github.com/' + state.repo.owner + '/' + state.repo.repo));
    }
    ui.tokenInput.value = state.token;

    // 渲染对话历史
    renderConversation();

    if (state.repo && state.token) {
      // 已有连接，直接进入工作区
      ui.connectView.classList.add('hidden');
      ui.workspace.classList.remove('hidden');
      refreshWorkspace();
    } else {
      ui.connectView.classList.remove('hidden');
      ui.workspace.classList.add('hidden');
      ui.repoInput.focus();
    }
  }

  function close() {
    var panel = document.getElementById('panelCode');
    if (panel) {
      panel._cwOpen = false;
      panel.classList.add('hidden');
      panel.classList.remove('active');
      panel.setAttribute('aria-hidden', 'true');
      try { panel.innerHTML = ''; } catch (e) {}
    }
    abortStream();
    try { if (window.XTJSecondaryPageState) window.XTJSecondaryPageState.close('code-workbench'); } catch (e) {}
    try { if (window.restoreMainNavigationState) window.restoreMainNavigationState(); } catch (e) {}
  }

  function abortStream() {
    if (state.abortCtrl) {
      try { state.abortCtrl.abort(); } catch (e) {}
      state.abortCtrl = null;
    }
    state.streaming = false;
  }

  // ── 连接 / 断开 ───────────────────────────────────────────────
  async function connectRepo() {
    if (state.busy) return;
    var rawUrl = ui.repoInput.value;
    var token = ui.tokenInput.value.trim();
    var parsed = parseRepoUrl(rawUrl);
    if (!parsed) { notify('仓库地址无效，请输入形如 https://github.com/owner/repo 的地址'); return; }
    if (!token) { notify('请填写 GitHub Personal Access Token'); return; }
    state.busy = true;
    ui.connectBtn.disabled = true;
    ui.connectBtn.textContent = '连接中...';
    try {
      var okAuth = await ensureAuth();
      if (!okAuth) { notify('请先登录后再使用代码工作区'); return; }
      state.token = token;
      var r = await ghRequest('GET', '/repos/' + parsed.owner + '/' + parsed.repo);
      if (!r.ok) {
        if (r.status === 401) notify('Token 无效或已过期，请检查后重试');
        else if (r.status === 404) notify('仓库不存在，或当前 Token 无权访问该仓库');
        else notify((r.error && r.error.message) ? r.error.message : '连接仓库失败，请检查网络');
        return;
      }
      var info = r.data;
      var branch = (info && info.default_branch) || 'main';
      state.repo = {
        owner: parsed.owner,
        repo: parsed.repo,
        branch: branch,
        default_branch: branch,
        full_name: info.full_name || (parsed.owner + '/' + parsed.repo),
        html_url: info.html_url || ('https://github.com/' + parsed.owner + '/' + parsed.repo),
        branch_sha: ''
      };
      state.prMode = ui.prCheck.checked;
      saveRepo(state.repo);
      saveToken(state.token);
      safeStorageSet(LS_PR, state.prMode ? '1' : '0');
      ui.repoName.textContent = state.repo.full_name;
      ui.connectView.classList.add('hidden');
      ui.workspace.classList.remove('hidden');
      await loadBranches();
      await loadTree();
      notify('仓库连接成功：' + state.repo.full_name);
    } finally {
      state.busy = false;
      ui.connectBtn.disabled = false;
      ui.connectBtn.textContent = '连接仓库';
    }
  }

  function disconnectRepo() {
    abortStream();
    state.repo = null;
    state.token = '';
    state.tree = [];
    state.currentPath = '';
    state.currentSha = '';
    state.currentContent = '';
    saveRepo(null);
    saveToken('');
    ui.repoInput.value = '';
    ui.tokenInput.value = '';
    ui.workspace.classList.add('hidden');
    ui.connectView.classList.remove('hidden');
    ui.repoInput.focus();
    notify('已断开仓库连接');
  }

  // ── 分支 ──────────────────────────────────────────────────────
  async function loadBranches() {
    if (!state.repo) return;
    var r = await ghRequest('GET', '/repos/' + state.repo.owner + '/' + state.repo.repo + '/branches?per_page=100');
    if (r.ok && Array.isArray(r.data)) {
      ui.branchSel.innerHTML = '';
      var found = false;
      r.data.forEach(function (b) {
        var name = b.name;
        var opt = el('option', { value: name, text: name });
        if (name === state.repo.branch) { opt.selected = true; found = true; }
        ui.branchSel.appendChild(opt);
      });
      if (!found) {
        var curOpt = el('option', { value: state.repo.branch, text: state.repo.branch, selected: true });
        ui.branchSel.insertBefore(curOpt, ui.branchSel.firstChild);
      }
    }
    // 记录当前分支 head sha（PR 模式创建分支用）
    try {
      var headRef = await ghRequest('GET', '/repos/' + state.repo.owner + '/' + state.repo.repo + '/git/ref/heads/' + encodeURIComponent(state.repo.branch));
      if (headRef.ok && headRef.data && headRef.data.object) state.repo.branch_sha = headRef.data.object.sha;
    } catch (e) {}
  }

  function switchBranch() {
    if (!ui.branchSel.value || ui.branchSel.value === state.repo.branch) return;
    state.repo.branch = ui.branchSel.value;
    state.repo.branch_sha = '';
    saveRepo(state.repo);
    clearFileView();
    loadTree();
  }

  // ── 文件树 ────────────────────────────────────────────────────
  async function loadTree() {
    if (!state.repo) return;
    ui.treeBox.innerHTML = '';
    var loading = el('div', { class: 'cw-tree-loading', text: '加载中...' });
    ui.treeBox.appendChild(loading);
    try {
      var r = await ghRequest('GET', '/repos/' + state.repo.owner + '/' + state.repo.repo + '/git/trees/' + encodeURIComponent(state.repo.branch) + '?recursive=1');
      if (!r.ok) {
        ui.treeBox.innerHTML = '';
        ui.treeBox.appendChild(el('div', { class: 'cw-tree-empty', text: '文件树加载失败：' + esc((r.error && r.error.message) || '未知错误') }));
        return;
      }
      var flat = (r.data && r.data.tree) || [];
      var files = flat.filter(function (item) {
        if (!item || !item.path) return false;
        if (item.type === 'tree') return !TREE_SKIP_DIRS.test(item.path);
        if (TREE_SKIP_DIRS.test(item.path)) return false;
        if (item.type === 'blob' && TREE_SKIP_FILES.test(item.path)) return false;
        return item.type === 'blob' || item.type === 'tree';
      });
      state.tree = files.map(function (f) { return { path: f.path, type: f.type }; });
      renderTree();
      if (r.data && r.data.truncated) {
        ui.treeBox.appendChild(el('div', { class: 'cw-tree-empty', text: '提示：仓库文件较多，GitHub 单次仅返回部分文件。可刷新，或让 AI 直接按已知路径修改。' }));
      }
    } catch (e) {
      ui.treeBox.innerHTML = '';
      ui.treeBox.appendChild(el('div', { class: 'cw-tree-empty', text: '文件树加载失败' }));
    }
  }

  function renderTree() {
    var box = ui.treeBox;
    box.innerHTML = '';
    if (!state.tree.length) {
      box.appendChild(el('div', { class: 'cw-tree-empty', text: '仓库为空' }));
      return;
    }
    // 构建嵌套目录
    var root = { children: {} };
    state.tree.forEach(function (item) {
      var parts = item.path.split('/');
      var node = root;
      for (var i = 0; i < parts.length; i++) {
        var seg = parts[i];
        if (i === parts.length - 1) {
          if (!node.children[seg]) node.children[seg] = { name: seg, path: item.path, type: item.type, children: null };
        } else {
          if (!node.children[seg]) node.children[seg] = { name: seg, path: parts.slice(0, i + 1).join('/'), type: 'tree', children: {}, collapsed: false };
          node = node.children[seg];
          if (!node.children) node.children = {};
        }
      }
    });
    var wrap = el('div', { class: 'cw-tree-scroll' });
    var sortNodes = function (obj) {
      var keys = Object.keys(obj);
      keys.sort(function (a, b) {
        var na = obj[a], nb = obj[b];
        if ((na.children && nb.children) || (!na.children && !nb.children)) return a.localeCompare(b, 'zh');
        return na.children ? -1 : 1;
      });
      return keys;
    };
    function renderNode(parentNode, node, depth) {
      var pad = 'padding-left:' + (depth * 12 + 6) + 'px;';
      if (node.children) {
        // 目录
        var row = el('div', { class: 'cw-tree-dir', style: pad, text: '▸ ' + node.name, title: node.path });
        var childWrap = el('div', { class: 'cw-tree-children' });
        row.addEventListener('click', function () {
          node.collapsed = !node.collapsed;
          row.textContent = (node.collapsed ? '▸ ' : '▾ ') + node.name;
          childWrap.classList.toggle('hidden', !!node.collapsed);
        });
        parentNode.appendChild(row);
        parentNode.appendChild(childWrap);
        var keys = sortNodes(node.children);
        for (var i = 0; i < keys.length; i++) renderNode(childWrap, node.children[keys[i]], depth + 1);
      } else {
        var frow = el('div', { class: 'cw-tree-file' + (node.path === state.currentPath ? ' active' : ''), style: pad, text: node.name, title: node.path });
        frow.addEventListener('click', function () { openFile(node.path); });
        parentNode.appendChild(frow);
      }
    }
    var keys = sortNodes(root.children);
    for (var i = 0; i < keys.length; i++) renderNode(wrap, root.children[keys[i]], 0);
    box.appendChild(wrap);
  }

  // ── 文件查看 / 编辑 ───────────────────────────────────────────
  function clearFileView() {
    state.currentPath = '';
    state.currentSha = '';
    state.currentContent = '';
    ui.filePath.textContent = '';
    ui.codePre.textContent = '';
    ui.codePre.classList.add('hidden');
    ui.editor.classList.add('hidden');
    ui.viewerEmpty.classList.remove('hidden');
    ui.editBtn.classList.add('hidden');
    ui.cancelEditBtn.classList.add('hidden');
    ui.saveBtn.classList.add('hidden');
    ui.commitBar.classList.add('hidden');
  }

  async function openFile(path) {
    if (!state.repo) return;
    state.currentPath = path;
    state.currentSha = '';
    state.currentContent = '';
    // 更新树高亮
    var files = ui.treeBox.querySelectorAll('.cw-tree-file');
    for (var i = 0; i < files.length; i++) {
      files[i].classList.toggle('active', files[i].getAttribute('title') === path);
    }
    ui.filePath.textContent = path;
    ui.codePre.textContent = '加载中...';
    ui.codePre.classList.remove('hidden');
    ui.viewerEmpty.classList.add('hidden');
    ui.editBtn.classList.add('hidden');
    ui.cancelEditBtn.classList.add('hidden');
    ui.saveBtn.classList.add('hidden');
    ui.commitBar.classList.add('hidden');
    ui.editor.classList.add('hidden');
    try {
      var r = await ghRequest('GET', '/repos/' + state.repo.owner + '/' + state.repo.repo + '/contents/' + encodePath(path) + '?ref=' + encodeURIComponent(state.repo.branch));
      if (!r.ok) {
        ui.codePre.textContent = '加载失败：' + esc((r.error && r.error.message) || '未知错误');
        return;
      }
      var item = r.data;
      var isTruncated = false;
      var content = '';
      if (item.encoding === 'base64' && item.content) {
        try {
          content = decodeURIComponent(escape(atob(item.content.replace(/\s/g, ''))));
        } catch (e2) {
          try { content = atob(item.content.replace(/\s/g, '')); } catch (e3) { content = ''; }
        }
      } else if (item.content) {
        content = item.content;
      }
      var size = item.size || content.length;
      if (size > MAX_FILE_BYTES) {
        isTruncated = true;
        content = content.slice(0, MAX_FILE_BYTES);
      }
      state.currentSha = item.sha || '';
      state.currentContent = content;
      ui.codePre.textContent = content || '（空文件）';
      if (isTruncated) ui.codePre.textContent += '\n\n...（文件过大，仅展示前 ' + Math.round(MAX_FILE_BYTES / 1024) + 'KB）';
      ui.editBtn.classList.remove('hidden');
    } catch (e) {
      ui.codePre.textContent = '加载失败';
    }
  }

  function enterEditMode() {
    if (!state.currentPath) return;
    ui.codePre.classList.add('hidden');
    ui.editor.classList.remove('hidden');
    ui.editor.value = state.currentContent;
    ui.editBtn.classList.add('hidden');
    ui.cancelEditBtn.classList.remove('hidden');
    ui.saveBtn.classList.remove('hidden');
    ui.commitBar.classList.add('hidden');
    try { ui.editor.focus(); } catch (e) {}
    autoResizeEditor();
  }

  function exitEditMode() {
    ui.editor.classList.add('hidden');
    ui.codePre.classList.remove('hidden');
    ui.editBtn.classList.remove('hidden');
    ui.cancelEditBtn.classList.add('hidden');
    ui.saveBtn.classList.add('hidden');
    ui.commitBar.classList.add('hidden');
    ui.editor.value = '';
  }

  function autoResizeEditor() {
    try {
      ui.editor.style.height = 'auto';
      ui.editor.style.height = ui.editor.scrollHeight + 'px';
    } catch (e) {}
  }
  function autoResizeChat() {
    try {
      ui.chatInput.style.height = 'auto';
      ui.chatInput.style.height = Math.min(ui.chatInput.scrollHeight, 120) + 'px';
    } catch (e) {}
  }

  // ── 提交 ──────────────────────────────────────────────────────
  function startCommit() {
    if (!state.currentPath) return;
    if (!ui.editor.value.trim()) { notify('内容为空，无需提交'); return; }
    ui.commitBar.classList.remove('hidden');
    ui.commitHint.textContent = state.prMode ? 'PR 模式 · 分支 ' + state.repo.branch + ' → 新分支' : '提交到分支 ' + state.repo.branch;
    try { ui.commitMsg.focus(); } catch (e) {}
  }

  function cancelCommit() {
    ui.commitBar.classList.add('hidden');
    ui.commitMsg.value = '';
  }

  function b64encode(str) {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
      try { return btoa(str); } catch (e2) { return ''; }
    }
  }

  async function doCommit() {
    if (!state.repo || !state.currentPath) return;
    var message = ui.commitMsg.value.trim();
    if (!message) { notify('请填写提交信息'); return; }
    var newContent = ui.editor.value;
    if (state.currentContent === newContent) { notify('内容未变化，无需提交'); return; }
    ui.commitBtn.disabled = true;
    ui.commitBtn.textContent = '提交中...';
    try {
      var owner = state.repo.owner, repo = state.repo.repo, baseBranch = state.repo.branch;
      var commitResult;
      var targetBranch = baseBranch;
      var createdPr = null;
      if (state.prMode) {
        // 创建新分支
        targetBranch = 'code-wb-' + Date.now().toString(36);
        if (!state.repo.branch_sha) {
          var headRef = await ghRequest('GET', '/repos/' + owner + '/' + repo + '/git/ref/heads/' + encodeURIComponent(baseBranch));
          if (headRef.ok && headRef.data && headRef.data.object) state.repo.branch_sha = headRef.data.object.sha;
        }
        var refRes = await ghRequest('POST', '/repos/' + owner + '/' + repo + '/git/refs', {
          ref: 'refs/heads/' + targetBranch,
          sha: state.repo.branch_sha
        });
        if (!refRes.ok) {
          notify('创建分支失败：' + esc((refRes.error && refRes.error.message) || '未知错误'));
          return;
        }
        commitResult = await ghRequest('PUT', '/repos/' + owner + '/' + repo + '/contents/' + encodePath(state.currentPath), {
          message: message,
          content: b64encode(newContent),
          branch: targetBranch,
          sha: state.currentSha || undefined
        });
        if (commitResult.ok) {
          var prRes = await ghRequest('POST', '/repos/' + owner + '/' + repo + '/pulls', {
            title: message,
            head: targetBranch,
            base: baseBranch,
            body: '由 小猫AI Code 工作区自动创建'
          });
          if (prRes.ok) createdPr = prRes.data;
        }
      } else {
        commitResult = await ghRequest('PUT', '/repos/' + owner + '/' + repo + '/contents/' + encodePath(state.currentPath), {
          message: message,
          content: b64encode(newContent),
          branch: targetBranch,
          sha: state.currentSha || undefined
        });
      }
      if (!commitResult.ok) {
        var errMsg = (commitResult.error && commitResult.error.message) || '提交失败';
        if (commitResult.status === 409) errMsg = '提交冲突：文件已在远端被修改，请刷新后重试';
        else if (commitResult.status === 422) errMsg = '提交被拒绝：请检查 Token 的写入权限（需 repo/contents 权限）';
        notify(errMsg);
        return;
      }
      // 记录修改历史
      var record = {
        ts: Date.now(),
        path: state.currentPath,
        message: message,
        branch: targetBranch,
        base_branch: baseBranch,
        pr_mode: !!state.prMode,
        url: createdPr ? createdPr.html_url : ((commitResult.data && commitResult.data.commit && commitResult.data.commit.html_url) || ''),
        sha: (createdPr ? createdPr.head && createdPr.head.sha : (commitResult.data && commitResult.data.commit && commitResult.data.commit.sha)) || ''
      };
      var hist = loadHistory();
      hist.unshift(record);
      saveHistory(hist);
      // 更新本地内容为最新
      state.currentSha = (commitResult.data && commitResult.data.content && commitResult.data.content.sha) || '';
      state.currentContent = newContent;
      notify(createdPr ? '已创建 Pull Request' : '已提交到 ' + targetBranch);
      exitEditMode();
      if (state.prMode) {
        // PR 模式回到原分支并刷新
        state.repo.branch = baseBranch;
        ui.branchSel.value = baseBranch;
        saveRepo(state.repo);
      }
      renderHistoryList();
      loadTree();
    } catch (e) {
      notify('提交失败：' + esc((e && e.message) || '未知错误'));
    } finally {
      ui.commitBtn.disabled = false;
      ui.commitBtn.textContent = '确认提交';
    }
  }

  // ── 修改历史 ──────────────────────────────────────────────────
  function switchTab(tab) {
    ui.tabTree.classList.toggle('on', tab === 'tree');
    ui.tabHist.classList.toggle('on', tab === 'history');
    ui.treeBox.classList.toggle('hidden', tab !== 'tree');
    ui.historyBox.classList.toggle('hidden', tab !== 'history');
    if (tab === 'history') renderHistoryList();
  }

  function renderHistoryList() {
    var box = ui.historyBox;
    box.innerHTML = '';
    var hist = loadHistory();
    if (!hist.length) {
      box.appendChild(el('div', { class: 'cw-tree-empty', text: '暂无修改记录' }));
      return;
    }
    var wrap = el('div', { class: 'cw-tree-scroll' });
    hist.forEach(function (h) {
      if (!h || !h.path) return;
      var item = el('div', { class: 'cw-history-item' });
      var line = el('div', { class: 'cw-history-main' });
      line.appendChild(el('div', { class: 'cw-history-msg', text: h.message || '(无提交信息)' }));
      line.appendChild(el('div', { class: 'cw-history-meta', text: (h.pr_mode ? 'PR · ' : '提交 · ') + h.path }));
      line.appendChild(el('div', { class: 'cw-history-time', text: fmtTime(h.ts) + ' · ' + (h.branch || '') }));
      item.appendChild(line);
      if (h.url) {
        var link = el('a', { class: 'cw-history-link', href: h.url, target: '_blank', rel: 'noopener noreferrer', text: h.pr_mode ? '查看 PR' : '查看提交' });
        item.appendChild(link);
      }
      wrap.appendChild(item);
    });
    box.appendChild(wrap);
  }

  // ── AI 对话 ──────────────────────────────────────────────────
  function renderConversation() {
    var box = ui.chatMsgs;
    box.innerHTML = '';
    var conv = loadConversation();
    if (!conv.length) {
      box.appendChild(el('div', { class: 'cw-chat-empty', text: '让 AI 帮你改代码。当前打开的代码文件会自动作为 AI 的上下文。' }));
      return;
    }
    conv.forEach(function (m) {
      if (!m || typeof m.content !== 'string') return;
      box.appendChild(buildChatBubble(m.role, m.content));
    });
    scrollChat();
  }

  function buildChatBubble(role, text) {
    var wrap = el('div', { class: 'cw-msg ' + (role === 'user' ? 'cw-msg-user' : 'cw-msg-ai') });
    wrap.appendChild(el('div', { class: 'cw-msg-label', text: role === 'user' ? '你' : '小猫 AI' }));
    var contentDiv = el('div', { class: 'cw-msg-content' });
    var renderFn = (typeof window.renderMarkdown === 'function') ? window.renderMarkdown : null;
    if (renderFn) {
      try { contentDiv.innerHTML = renderFn(text); } catch (e) { contentDiv.textContent = text; }
    } else {
      contentDiv.textContent = text;
      contentDiv.style.whiteSpace = 'pre-wrap';
    }
    wrap.appendChild(contentDiv);
    return wrap;
  }

  function scrollChat() {
    try { ui.chatMsgs.scrollTop = ui.chatMsgs.scrollHeight; } catch (e) {}
  }

  function appendChatMessage(role, text) {
    var conv = loadConversation();
    conv.push({ role: role, content: text, ts: Date.now() });
    saveConversation(conv);
    ui.chatMsgs.appendChild(buildChatBubble(role, text));
    scrollChat();
  }

  function resetConversation() {
    abortStream();
    saveConversation([]);
    state.aiLastOutput = '';
    renderConversation();
    notify('已开始新对话');
  }

  function buildAiPrompt(request) {
    var lines = [];
    if (state.repo) lines.push('仓库：' + state.repo.full_name + '（当前分支：' + state.repo.branch + '）');
    if (state.currentPath) {
      lines.push('当前打开文件：' + state.currentPath);
    } else {
      lines.push('当前打开文件：无（请在左侧选择文件后再让 AI 修改）');
    }
    lines.push('');
    if (state.currentPath && state.currentContent) {
      var ctx = state.currentContent;
      if (ctx.length > MAX_AI_FILE_CHARS) ctx = ctx.slice(0, MAX_AI_FILE_CHARS) + '\n...（内容过长已截断）';
      lines.push('当前文件内容：\n```\n' + ctx + '\n```');
      lines.push('');
    }
    lines.push('用户需求：' + request);
    lines.push('');
    lines.push('规则：若需求涉及修改代码，请输出修改后的完整文件内容，放在单个代码块中，不要省略任何代码；若只是查看/解释，则直接回答。');
    return lines.join('\n');
  }

  async function sendChat() {
    if (state.streaming) { notify('AI 正在回复，请稍候'); return; }
    var text = ui.chatInput.value.trim();
    if (!text) return;
    if (text.length > 3000) { notify('消息过长（最多 3000 字）'); return; }
    var okAuth = await ensureAuth();
    if (!okAuth) { notify('请先登录后再使用 AI 助手'); return; }
    ui.chatInput.value = '';
    autoResizeChat();
    var prompt = buildAiPrompt(text);
    appendChatMessage('user', text);

    // 创建 AI 气泡
    var aiWrap = el('div', { class: 'cw-msg cw-msg-ai generating' });
    aiWrap.appendChild(el('div', { class: 'cw-msg-label', text: '小猫 AI' }));
    var contentDiv = el('div', { class: 'cw-msg-content cw-msg-stream' });
    contentDiv.textContent = '思考中...';
    aiWrap.appendChild(contentDiv);
    ui.chatMsgs.appendChild(aiWrap);
    scrollChat();

    var accumulated = '';
    state.streaming = true;
    ui.sendBtn.disabled = true;
    ui.sendBtn.textContent = '生成中';

    // 取历史（不含刚追加的这条 user）
    var conv = loadConversation();
    var history = [];
    for (var i = 0; i < conv.length - 1; i++) {
      var m = conv[i];
      if (m && typeof m.content === 'string') history.push({ role: m.role, content: m.content.slice(0, 6000) });
    }

    var isCustom = isCustomModel(state.model);
    var payload;
    if (isCustom) {
      var cfg = resolveCustomCfg(state.model);
      if (!cfg || !cfg.api_key) {
        contentDiv.textContent = '该自定义模型缺少 API Key，请先在 AI 设置中配置。';
        state.streaming = false;
        ui.sendBtn.disabled = false;
        ui.sendBtn.textContent = '发送';
        return;
      }
      var fullMsgs = [];
      history.forEach(function (h) { fullMsgs.push({ role: h.role, content: h.content }); });
      fullMsgs.push({ role: 'user', content: prompt });
      payload = {
        url: '/api/agent/custom-chat/stream',
        body: {
          provider: cfg.provider,
          api_key: cfg.api_key,
          model: cfg.model,
          base_url: cfg.base_url,
          message: prompt,
          messages: fullMsgs,
          thinking_mode: state.thinking,
          web_search: false,
          tools_enabled: false,
          client_request_id: 'cw_' + Date.now().toString(36),
          timeout_ms: 240000
        }
      };
    } else {
      payload = {
        url: '/api/code/ai',
        body: {
          message: prompt,
          history: history,
          model: state.model,
          thinking_mode: state.thinking
        }
      };
    }

    var done = false;
    try {
      await streamAi(payload, {
        onContent: function (chunk) {
          accumulated += chunk;
          if (typeof window.renderMarkdown === 'function') {
            try { contentDiv.innerHTML = window.renderMarkdown(accumulated); } catch (e) { contentDiv.textContent = accumulated; }
          } else {
            contentDiv.textContent = accumulated;
          }
          scrollChat();
        },
        onError: function (evt) {
          done = true;
          contentDiv.textContent = '出错了：' + esc((evt && (evt.error || evt.message)) || '未知错误');
        }
      });
    } catch (e) {
      done = true;
      var msg = (e && (e.error || e.message)) || '生成失败';
      if (e && e.code === 'ABORTED') msg = '已停止生成';
      contentDiv.textContent = '出错了：' + esc(msg);
    } finally {
      state.streaming = false;
      ui.sendBtn.disabled = false;
      ui.sendBtn.textContent = '发送';
    }

    var finalText = accumulated.trim();
    if (!done && finalText) {
      state.aiLastOutput = finalText;
      appendChatMessage('assistant', finalText);
      // 移除临时的 streaming 气泡
      try { if (aiWrap.parentNode) aiWrap.parentNode.removeChild(aiWrap); } catch (e) {}
      // 若 AI 返回了代码块，展示"应用到编辑器"按钮
      var fenced = extractCodeBlock(finalText);
      if (fenced && state.currentPath) {
        var applyWrap = el('div', { class: 'cw-msg cw-msg-apply' });
        var applyBtn = el('button', { type: 'button', class: 'cw-mini-btn cw-mini-btn-primary', text: '将 AI 结果应用到编辑器' });
        applyBtn.addEventListener('click', function () {
          applyAiOutput(fenced);
        });
        applyWrap.appendChild(applyBtn);
        ui.chatMsgs.appendChild(applyWrap);
        scrollChat();
      }
    } else if (!finalText && !done) {
      contentDiv.textContent = 'AI 没有返回内容，请重试';
    }
  }

  function extractCodeBlock(text) {
    if (!text) return '';
    var blocks = [];
    var re = /```[a-zA-Z0-9+#.\-_]*\s*\n?([\s\S]*?)```/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      blocks.push(m[1]);
    }
    if (blocks.length) return blocks[blocks.length - 1].replace(/^\n+/, '').replace(/\s+$/, '');
    // 无代码块：若内容看起来像代码，直接整体使用
    if (/[{};=<>]/g.test(text) && text.split('\n').length > 1) return text.trim();
    return '';
  }

  function applyAiOutput(code) {
    if (!state.currentPath) { notify('请先在左侧选择一个文件'); return; }
    if (!code) { notify('AI 结果中没有可用的代码'); return; }
    ui.codePre.classList.add('hidden');
    ui.editor.classList.remove('hidden');
    ui.editor.value = code;
    ui.editBtn.classList.add('hidden');
    ui.cancelEditBtn.classList.remove('hidden');
    ui.saveBtn.classList.remove('hidden');
    ui.commitBar.classList.add('hidden');
    autoResizeEditor();
    notify('已应用到编辑器，可继续编辑后点「保存到仓库」提交');
    try { ui.editor.focus(); } catch (e) {}
  }

  // ── 刷新 ──────────────────────────────────────────────────────
  async function refreshWorkspace() {
    if (!state.repo) return;
    ui.repoName.textContent = state.repo.full_name;
    ui.refreshBtn.disabled = true;
    ui.refreshBtn.textContent = '刷新中...';
    try {
      await loadBranches();
      await loadTree();
      notify('已刷新');
    } finally {
      ui.refreshBtn.disabled = false;
      ui.refreshBtn.textContent = '刷新';
    }
  }

  // ── 暴露 API ──────────────────────────────────────────────────
  window.xtjCodeWorkbench = {
    open: open,
    close: close,
    getState: function () { return state; }
  };
})();
