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
  var LS_SPLIT = 'xtj_code_split';

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
  // ── 批量读取整库代码（供 AI 全局分析/改 bug）──
  var BULK_MAX_FILES = 60;              // 单次最多加载文件数，控制 GitHub 请求量
  var BULK_MAX_FILE_BYTES = 120 * 1024; // 单文件读取上限
  var BULK_AI_TOTAL_CHARS = 120000;     // 一次性注入 AI 的全部文件总字符上限
  var BULK_CONCURRENCY = 5;             // 并发拉取数
  var WALK_CONCURRENCY = 4;             // 大目录树递归遍历并发
  var TREE_AI_MAX_CHARS = 15000;        // 注入 AI 的“文件清单”字符预算
  var CONTENTS_API_BYTES = 1024 * 1024; // GitHub Contents API 单次写入约 1MB，超过走 Git Database
  var BRANCH_PAGE_MAX = 500;            // 分支列表最多拉取数量（分页兜底）
  // 二进制/不可在线文本编辑的扩展名（图片/音视频/压缩包/字体/可执行等）
  var BINARY_EXT_RE = /.(png|jpe?g|gif|webp|bmp|ico|avif|svgz?|mp[34]|wav|ogg|flac|aac|m4a|avi|mov|mkv|webm|zip|rar|7z|gz|tar|bz2|xz|pdf|doc[xm]?|xls[xm]?|ppt[xm]?|ttf|otf|woff2?|eot|wasm|exe|dll|so|dylib|class|jar|bin|dat|apk|ipa|dmg|iso)$/i;
  var CODE_FILE_RE = /\.(js|jsx|mjs|cjs|ts|tsx|vue|svelte|py|java|kt|go|rs|c|h|cpp|cc|hpp|cs|rb|php|swift|scala|sh|bash|zsh|sql|html?|css|scss|less|json|ya?ml|xml|md|txt|ini|toml|gradle|dart|lua|exs?|prisma|graphql|gql|proto)$/i;
  var BULK_SKIP_RE = /(^|\/)(node_modules|dist|build|out|vendor|coverage|\.next|\.nuxt|target|bin|obj|\.git)(\/|$)/i;
  var LOCKFILE_RE = /(package-lock|yarn\.lock|pnpm-lock|composer\.lock|Gemfile\.lock|poetry\.lock|Cargo\.lock)/i;
  function isCodeFileForBulk(p) {
    p = String(p || '');
    if (!p || BULK_SKIP_RE.test(p) || LOCKFILE_RE.test(p)) return false;
    var base = p.split('/').pop() || '';
    if (/^(dockerfile|makefile|rakefile|gemfile)$/i.test(base)) return true;
    return CODE_FILE_RE.test(p);
  }

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
    bulkFiles: {},        // 批量读取的 {path: content}，供 AI 全局分析
    bulkBranch: '',       // bulkFiles 对应的分支，分支不一致时不注入
    bulkFailed: [],       // 批量读取失败/跳过的文件路径
    fileSeq: 0,           // 文件内容请求代次（防快速切换竞态）
    treeSeq: 0,           // 文件树请求代次（防快速切分支竞态）
    isNewFile: false,     // 当前编辑器是否为“新建文件”态（提交时不带 sha）
    undo: null,           // 最近一次 AI 应用前的编辑器快照 {path, content}
    busy: false,
    streaming: false,
    abortCtrl: null,
    aiLastOutput: ''
  };

  var splittersReady = false;

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
  function loadSplitLayout() {
    try {
      var raw = safeStorageGet(LS_SPLIT);
      if (!raw) return { sidebarW: 0, chatH: 0 };
      var p = JSON.parse(raw);
      return { sidebarW: Number(p.sidebarW) || 0, chatH: Number(p.chatH) || 0 };
    } catch (e) { return { sidebarW: 0, chatH: 0 }; }
  }
  function saveSplitLayout(l) { safeStorageSet(LS_SPLIT, JSON.stringify({ sidebarW: l.sidebarW || 0, chatH: l.chatH || 0 })); }

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

  // 代理返回的 error 是字符串；统一取出可读信息，避免 r.error.message 恒为 undefined
  function ghErr(r, fallback) {
    if (!r) return fallback || '请求失败';
    if (typeof r.error === 'string' && r.error) return r.error;
    if (r.error && typeof r.error.message === 'string' && r.error.message) return r.error.message;
    if (r.data && r.data.message) return r.data.message;
    return fallback || ('HTTP ' + (r.status || 0));
  }
  function isBinaryPath(p) { return BINARY_EXT_RE.test(String(p || '').split('?')[0]); }
  // 内容探测：含 NUL 或控制字符占比过高即视为二进制，避免 atob 乱码
  function looksBinaryText(str) {
    if (!str) return false;
    if (str.indexOf('\x00') >= 0) return true;
    var sample = str.slice(0, 4096), bad = 0;
    for (var i = 0; i < sample.length; i++) {
      var c = sample.charCodeAt(i);
      if (c < 9 || (c > 13 && c < 32)) bad++;
    }
    return sample.length > 0 && bad / sample.length > 0.02;
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
    var rememberToken = el('label', { class: 'cw-remember' });
    var rememberCheck = el('input', { type: 'checkbox', id: 'cwRememberToken' });
    rememberCheck.checked = true;
    rememberToken.appendChild(rememberCheck);
    rememberToken.appendChild(el('span', { text: '记住 Token（取消勾选则仅本次会话保留，更安全）' }));
    tokenField.appendChild(rememberToken);
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
    var mergeBtn = el('button', { type: 'button', class: 'cw-mini-btn', id: 'cwMergeBtn', text: '合并' });
    mergeBtn.setAttribute('title', '把其它分支合并到目标分支');
    mergeBtn.addEventListener('click', function () { openMergeBox(); });
    repoBranchWrap.appendChild(mergeBtn);
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

    var treeTools = el('div', { class: 'cw-tree-tools' });
    var bulkBtn = el('button', { type: 'button', class: 'cw-mini-btn', id: 'cwBulkBtn', text: '读取全部代码' });
    bulkBtn.setAttribute('title', '批量读取当前分支的代码文件，供 AI 全局分析与改 bug');
    bulkBtn.addEventListener('click', function () { bulkLoadAll(); });
    var bulkStatus = el('span', { class: 'cw-bulk-status', id: 'cwBulkStatus', text: '' });
    treeTools.appendChild(bulkBtn);
    treeTools.appendChild(bulkStatus);
    sidebar.appendChild(treeTools);

    var mergeBox = el('div', { class: 'cw-merge-box hidden', id: 'cwMergeBox' });
    mergeBox.appendChild(el('div', { class: 'cw-merge-title', text: '合并分支（在 GitHub 上直接合并）' }));
    var mergeRow1 = el('div', { class: 'cw-merge-row' });
    mergeRow1.appendChild(el('span', { text: '合入' }));
    var mergeBaseSel = el('select', { class: 'cw-merge-sel', id: 'cwMergeBase' });
    mergeRow1.appendChild(mergeBaseSel);
    mergeBox.appendChild(mergeRow1);
    var mergeRow2 = el('div', { class: 'cw-merge-row' });
    mergeRow2.appendChild(el('span', { text: '来源' }));
    var mergeHeadSel = el('select', { class: 'cw-merge-sel', id: 'cwMergeHead' });
    mergeRow2.appendChild(mergeHeadSel);
    mergeBox.appendChild(mergeRow2);
    var mergeMsg = el('input', { type: 'text', class: 'cw-input cw-merge-msg', id: 'cwMergeMsg', placeholder: '合并说明（可选）', autocomplete: 'off', spellcheck: 'false' });
    mergeBox.appendChild(mergeMsg);
    var mergePreview = el('div', { class: 'cw-merge-preview', id: 'cwMergePreview', text: '' });
    mergeBox.appendChild(mergePreview);
    mergeBaseSel.addEventListener('change', function () { updateMergePreview(); });
    mergeHeadSel.addEventListener('change', function () { updateMergePreview(); });
    var mergeBtns = el('div', { class: 'cw-merge-btns' });
    var mergeDoBtn = el('button', { type: 'button', class: 'cw-mini-btn cw-mini-btn-primary', id: 'cwMergeDo', text: '确认合并' });
    mergeDoBtn.addEventListener('click', function () { doMerge(); });
    var mergeCancelBtn = el('button', { type: 'button', class: 'cw-mini-btn', id: 'cwMergeCancel', text: '取消' });
    mergeCancelBtn.addEventListener('click', function () { closeMergeBox(); });
    mergeBtns.appendChild(mergeDoBtn);
    mergeBtns.appendChild(mergeCancelBtn);
    mergeBox.appendChild(mergeBtns);
    sidebar.appendChild(mergeBox);

    var treeBox = el('div', { class: 'cw-tree', id: 'cwTree' });
    sidebar.appendChild(treeBox);
    var historyBox = el('div', { class: 'cw-history hidden', id: 'cwHistory' });
    sidebar.appendChild(historyBox);
    workspace.appendChild(sidebar);
    var splitV = el('div', { class: 'cw-split cw-split-v', id: 'cwSplitV', title: '拖动调整侧栏宽度' });
    workspace.appendChild(splitV);

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
    var newFileBtn = el('button', { type: 'button', class: 'cw-mini-btn', id: 'cwNewFileBtn', text: '+ 新建' });
    newFileBtn.setAttribute('title', '在当前分支新建文件');
    newFileBtn.addEventListener('click', function () { newFile(); });
    var deleteFileBtn = el('button', { type: 'button', class: 'cw-mini-btn cw-danger-btn hidden', id: 'cwDeleteFileBtn', text: '删除' });
    deleteFileBtn.addEventListener('click', function () { deleteFile(); });
    var undoAiBtn = el('button', { type: 'button', class: 'cw-mini-btn hidden', id: 'cwUndoAiBtn', text: '撤销AI' });
    undoAiBtn.addEventListener('click', function () { undoAiApply(); });
    viewerActions.appendChild(editBtn);
    viewerActions.appendChild(newFileBtn);
    viewerActions.appendChild(deleteFileBtn);
    viewerActions.appendChild(undoAiBtn);
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
    var splitH = el('div', { class: 'cw-split cw-split-h', id: 'cwSplitH', title: '拖动调整 AI 对话高度' });
    main.appendChild(splitH);

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
      sidebarEl: sidebar,
      mainEl: main,
      chatEl: chat,
      splitV: splitV,
      splitH: splitH,
      repoInput: repoInput,
      tokenInput: tokenInput,
      rememberCheck: rememberCheck,
      modelSelect: modelSelect,
      thinkSelect: thinkSelect,
      thinkSel: thinkSel,
      prCheck: prCheck,
      connectBtn: connectBtn,
      refreshBtn: refreshBtn,
      repoName: repoName,
      branchSel: branchSel,
      treeBox: treeBox,
      bulkBtn: bulkBtn,
      bulkStatus: bulkStatus,
      mergeBtn: mergeBtn,
      mergeBox: mergeBox,
      mergeBaseSel: mergeBaseSel,
      mergeHeadSel: mergeHeadSel,
      mergeMsg: mergeMsg,
      mergeDoBtn: mergeDoBtn,
      mergePreview: mergePreview,
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
      newFileBtn: newFileBtn,
      deleteFileBtn: deleteFileBtn,
      undoAiBtn: undoAiBtn,
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

  // 可拖动的分割条：左侧文件列表 / 查看器 / AI 对话都可自由缩放，尺寸本地记忆
  function initSplitters() {
    if (!ui.workspace || !ui.sidebarEl || !ui.mainEl || !ui.chatEl) return;
    // 恢复上次尺寸
    var layout = loadSplitLayout();
    if (layout.sidebarW > 120) { try { ui.sidebarEl.style.flexBasis = layout.sidebarW + 'px'; } catch (e) {} }
    if (layout.chatH > 100) { try { ui.chatEl.style.flex = '0 1 ' + layout.chatH + 'px'; } catch (e) {} }
    if (splittersReady) return;
    splittersReady = true;

    function attach(handle, onDrag) {
      if (!handle) return;
      handle.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        try { handle.setPointerCapture(ev.pointerId); } catch (e) {}
        handle.classList.add('active');
        function move(ev2) { onDrag(ev2); }
        function up() {
          handle.classList.remove('active');
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
        }
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      });
    }

    // 横向分割条（侧栏 | 主区）：拖拽调侧栏宽度
    attach(ui.splitV, function (ev) {
      var wr = ui.workspace.getBoundingClientRect();
      var w = ev.clientX - wr.left;
      if (w < 130) w = 130;
      if (w > wr.width - 280) w = wr.width - 280;
      ui.sidebarEl.style.flexBasis = w + 'px';
      saveSplitLayout({ sidebarW: w, chatH: loadSplitLayout().chatH });
    });

    // 纵向分割条（查看器 | AI 对话）：拖拽调 AI 对话高度
    attach(ui.splitH, function (ev) {
      var mr = ui.mainEl.getBoundingClientRect();
      var h = ev.clientY - mr.top;
      if (h < 100) h = 100;
      if (h > mr.height - 160) h = mr.height - 160;
      ui.chatEl.style.flex = '0 1 ' + h + 'px';
      saveSplitLayout({ sidebarW: loadSplitLayout().sidebarW, chatH: h });
    });
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
    initSplitters();
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
        else notify(ghErr(r, '连接仓库失败，请检查网络'));
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
      if (ui.rememberCheck && ui.rememberCheck.checked) saveToken(state.token); else saveToken('');
      safeStorageSet(LS_PR, state.prMode ? '1' : '0');
      ui.repoName.textContent = state.repo.full_name;
      ui.connectView.classList.add('hidden');
      ui.workspace.classList.remove('hidden');
      await Promise.all([loadBranches(), loadTree()]);
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
    // 分页拉取全部分支（默认每页 100，>100 分支的仓库也不丢）
    var all = [], page = 1;
    while (page <= 5) {
      var r = await ghRequest('GET', '/repos/' + state.repo.owner + '/' + state.repo.repo + '/branches?per_page=100&page=' + page);
      if (!r.ok || !Array.isArray(r.data) || !r.data.length) break;
      all = all.concat(r.data);
      if (r.data.length < 100 || all.length >= BRANCH_PAGE_MAX) break;
      page++;
    }
    if (all.length) {
      ui.branchSel.innerHTML = '';
      var found = false;
      all.forEach(function (b) {
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
    // 记录当前分支最新 head sha（PR 模式创建分支用）
    try {
      var headRef = await ghRequest('GET', '/repos/' + state.repo.owner + '/' + state.repo.repo + '/git/ref/heads/' + encodeURIComponent(state.repo.branch));
      if (headRef.ok && headRef.data && headRef.data.object) state.repo.branch_sha = headRef.data.object.sha;
    } catch (e) {}
  }

  function switchBranch() {
    if (!ui.branchSel.value || ui.branchSel.value === state.repo.branch) return;
    state.repo.branch = ui.branchSel.value;
    state.repo.branch_sha = '';
    state.treeSeq++; // 作废在途的旧分支文件树
    saveRepo(state.repo);
    resetBulkCache();
    clearFileView();
    loadTree();
  }

  // ── 文件树 ────────────────────────────────────────────────────
  async function loadTree() {
    if (!state.repo) return;
    var seq = ++state.treeSeq;
    ui.treeBox.innerHTML = '';
    var loading = el('div', { class: 'cw-tree-loading', text: '加载中...' });
    ui.treeBox.appendChild(loading);
    try {
      var owner = state.repo.owner, repoName = state.repo.repo, branch = state.repo.branch;
      var r = await ghRequest('GET', '/repos/' + owner + '/' + repoName + '/git/trees/' + encodeURIComponent(branch) + '?recursive=1');
      if (seq !== state.treeSeq) return; // 已切换分支/刷新，丢弃过期响应
      if (!r.ok) {
        ui.treeBox.innerHTML = '';
        ui.treeBox.appendChild(el('div', { class: 'cw-tree-empty', text: '文件树加载失败：' + esc(ghErr(r, '未知错误')) }));
        return;
      }
      var flat = (r.data && r.data.tree) || [];
      var truncated = !!(r.data && r.data.truncated);
      var myItems = flat;
      // 递归树被截断：逐层遍历所有子树，确保当前分支的全部文件都被列出
      if (truncated) {
        var walked = await walkFullTree(owner, repoName, branch);
        if (walked && walked.length) myItems = walked;
      }
      var files = myItems.filter(function (item) {
        if (!item || !item.path) return false;
        if (item.type === 'tree') return !TREE_SKIP_DIRS.test(item.path);
        if (TREE_SKIP_DIRS.test(item.path)) return false;
        if (item.type === 'blob' && TREE_SKIP_FILES.test(item.path)) return false;
        return item.type === 'blob' || item.type === 'tree';
      });
      state.tree = files.map(function (f) { return { path: f.path, type: f.type }; });
      renderTree();
      if (truncated) {
        ui.treeBox.appendChild(el('div', { class: 'cw-tree-empty', text: '仓库较大，已全量加载所有文件。' }));
      }
    } catch (e) {
      ui.treeBox.innerHTML = '';
      ui.treeBox.appendChild(el('div', { class: 'cw-tree-empty', text: '文件树加载失败' }));
    }
  }

  // 全量遍历仓库目录树，返回所有文件（配合 truncated 兜底，不受 10 万项上限限制）
  async function walkFullTree(owner, repoName, branch) {
    var items = [];
    var refRes = await ghRequest('GET', '/repos/' + owner + '/' + repoName + '/commits/' + encodeURIComponent(branch));
    var rootSha = (refRes.data && refRes.data.commit && refRes.data.commit.tree && refRes.data.commit.tree.sha) || branch;
    // BFS 队列 + 固定并发池；递归前用 TREE_SKIP_DIRS 剪枝，避免钻进 node_modules 等浪费请求
    var queue = [{ sha: rootSha, prefix: '' }];
    async function worker() {
      while (queue.length) {
        var job = queue.shift();
        if (!job) return;
        var rr = await ghRequest('GET', '/repos/' + owner + '/' + repoName + '/git/trees/' + job.sha);
        if (!rr.ok || !rr.data || !Array.isArray(rr.data.tree)) continue;
        var entries = rr.data.tree;
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          if (!e || !e.path) continue;
          var full = job.prefix + e.path;
          if (e.type === 'tree') {
            if (TREE_SKIP_DIRS.test(full + '/')) continue;
            queue.push({ sha: e.sha, prefix: full + '/' });
          } else if (e.type === 'blob') {
            items.push({ path: full, type: 'blob' });
          }
        }
      }
    }
    var pool = [];
    for (var w = 0; w < WALK_CONCURRENCY; w++) pool.push(worker());
    await Promise.all(pool);
    return items;
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
    if (ui.deleteFileBtn) ui.deleteFileBtn.classList.add('hidden');
    if (ui.undoAiBtn) ui.undoAiBtn.classList.add('hidden');
    ui.commitBar.classList.add('hidden');
  }

  async function openFile(path) {
    if (!state.repo) return;
    var seq = ++state.fileSeq; // 请求代次：快速连点文件时，慢返回的旧请求作废
    state.isNewFile = false;
    state.undo = null;
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
    if (ui.undoAiBtn) ui.undoAiBtn.classList.add('hidden');
    try {
      var r = await ghRequest('GET', '/repos/' + state.repo.owner + '/' + state.repo.repo + '/contents/' + encodePath(path) + '?ref=' + encodeURIComponent(state.repo.branch));
      if (seq !== state.fileSeq) return; // 已切换到其它文件，丢弃过期响应
      if (!r.ok) {
        ui.codePre.textContent = '加载失败：' + esc(ghErr(r, '未知错误'));
        return;
      }
      var item = r.data;
      var isTruncated = false;
      var overContentsApi = false;
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
      // 二进制文件：不做文本展示/编辑，避免 atob 乱码
      if (isBinaryPath(path) || looksBinaryText(content)) {
        state.currentSha = item.sha || '';
        state.currentContent = '';
        ui.codePre.textContent = '二进制文件（' + Math.round((item.size || 0) / 1024) + 'KB），不支持在线查看与编辑，可在本地处理后上传，或点“删除”移除。';
        if (ui.deleteFileBtn) ui.deleteFileBtn.classList.remove('hidden');
        return;
      }
      var size = item.size || content.length;
      if (size > CONTENTS_API_BYTES) overContentsApi = true;
      if (size > MAX_FILE_BYTES) {
        isTruncated = true;
        content = content.slice(0, MAX_FILE_BYTES);
      }
      state.currentSha = item.sha || '';
      state.currentContent = content;
      ui.codePre.textContent = content || '（空文件）';
      if (isTruncated) ui.codePre.textContent += '\n\n...（文件过大，仅展示前 ' + Math.round(MAX_FILE_BYTES / 1024) + 'KB）';
      else if (overContentsApi) ui.codePre.textContent += '\n\n...（该文件超过 Contents 接口约 1MB 上限，提交时将自动改用 Git 接口）';
      ui.editBtn.classList.remove('hidden');
      if (ui.deleteFileBtn) ui.deleteFileBtn.classList.remove('hidden');
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

  // 通过 Git Database API 在指定分支一次性提交多个文件（绕开 Contents 接口约 1MB 上限，支持多文件/新建/删除）
  // changes: [{ path, content }]，content 为 null 表示删除该文件
  async function gitApiCommitMany(owner, repoName, branch, changes, message) {
    var ref = await ghRequest('GET', '/repos/' + owner + '/' + repoName + '/git/ref/heads/' + encodeURIComponent(branch));
    if (!ref.ok) return ref;
    var parentSha = ref.data.object.sha;
    var parentCommit = await ghRequest('GET', '/repos/' + owner + '/' + repoName + '/git/commits/' + parentSha);
    if (!parentCommit.ok) return parentCommit;
    var baseTree = parentCommit.data.tree.sha;
    var treeItems = [];
    for (var i = 0; i < changes.length; i++) {
      var ch = changes[i];
      if (ch.content === null || ch.content === undefined) {
        treeItems.push({ path: ch.path, mode: '100644', type: 'blob', sha: null }); // sha:null = 删除
      } else {
        var blob = await ghRequest('POST', '/repos/' + owner + '/' + repoName + '/git/blobs', { content: b64encode(ch.content), encoding: 'base64' });
        if (!blob.ok) return blob;
        treeItems.push({ path: ch.path, mode: '100644', type: 'blob', sha: blob.data.sha });
      }
    }
    var tree = await ghRequest('POST', '/repos/' + owner + '/' + repoName + '/git/trees', { base_tree: baseTree, tree: treeItems });
    if (!tree.ok) return tree;
    var newCommit = await ghRequest('POST', '/repos/' + owner + '/' + repoName + '/git/commits', { message: message, tree: tree.data.sha, parents: [parentSha] });
    if (!newCommit.ok) return newCommit;
    // force:false 快进更新；若期间分支又被推进，GitHub 返回 409/422，提示刷新，避免覆盖他人提交
    var upd = await ghRequest('PATCH', '/repos/' + owner + '/' + repoName + '/git/refs/heads/' + encodeURIComponent(branch), { sha: newCommit.data.sha, force: false });
    if (!upd.ok) return upd;
    return { ok: true, status: 200, data: { commit: newCommit.data } };
  }

  // Contents API 单次写入约 1MB；超过则自动改用 Git Database，保证大文件也能提交
  function shouldUseGitApi(content) {
    try { return b64encode(String(content == null ? '' : content)).length > 900000; } catch (e) { return false; }
  }
  async function commitOneFile(owner, repoName, branch, path, content, message, existingSha) {
    if (shouldUseGitApi(content)) return await gitApiCommitMany(owner, repoName, branch, [{ path: path, content: content }], message);
    var body = { message: message, content: b64encode(content), branch: branch };
    if (existingSha) body.sha = existingSha; // 新建文件不带 sha
    return await ghRequest('PUT', '/repos/' + owner + '/' + repoName + '/contents/' + encodePath(path), body);
  }

  async function doCommit() {
    if (!state.repo || !state.currentPath) return;
    var message = ui.commitMsg.value.trim();
    if (!message) { notify('请填写提交信息'); return; }
    var newContent = ui.editor.value;
    var wasNew = state.isNewFile;
    if (!newContent.trim()) { notify('内容为空，无需提交'); return; }
    if (!wasNew && state.currentContent === newContent) { notify('内容未变化，无需提交'); return; }
    // 直接推送到默认分支前二次确认，避免误改主分支
    if (!state.prMode && state.repo.branch === state.repo.default_branch) {
      if (!window.confirm('即将直接提交到默认分支「' + state.repo.default_branch + '」，是否继续？（也可勾选连接页的“创建 PR”模式以走评审）')) return;
    }
    ui.commitBtn.disabled = true;
    ui.commitBtn.textContent = '提交中...';
    try {
      var owner = state.repo.owner, repo = state.repo.repo, baseBranch = state.repo.branch;
      var targetBranch = baseBranch;
      var createdPr = null, prCreateFailed = false, leftoverBranch = '';
      var commitResult;
      if (state.prMode) {
        targetBranch = 'code-wb-' + Date.now().toString(36);
        // 每次都取基线分支最新 head，避免从旧点拉分支而丢失最新提交
        var headRef = await ghRequest('GET', '/repos/' + owner + '/' + repo + '/git/ref/heads/' + encodeURIComponent(baseBranch));
        var baseSha = (headRef.ok && headRef.data && headRef.data.object) ? headRef.data.object.sha : state.repo.branch_sha;
        if (!baseSha) { notify('无法获取基线分支最新提交，请刷新后重试'); return; }
        var refRes = await ghRequest('POST', '/repos/' + owner + '/' + repo + '/git/refs', { ref: 'refs/heads/' + targetBranch, sha: baseSha });
        if (!refRes.ok) { notify('创建分支失败：' + ghErr(refRes, '未知错误')); return; }
        leftoverBranch = targetBranch;
        commitResult = await commitOneFile(owner, repo, targetBranch, state.currentPath, newContent, message, wasNew ? '' : state.currentSha);
        if (commitResult.ok) {
          var prRes = await ghRequest('POST', '/repos/' + owner + '/' + repo + '/pulls', {
            title: message, head: targetBranch, base: baseBranch, body: '由 小猫AI Code 工作区自动创建'
          });
          if (prRes.ok) { createdPr = prRes.data; leftoverBranch = ''; }
          else prCreateFailed = true;
        }
      } else {
        commitResult = await commitOneFile(owner, repo, targetBranch, state.currentPath, newContent, message, wasNew ? '' : state.currentSha);
      }
      if (!commitResult.ok) {
        var errMsg = ghErr(commitResult, '提交失败');
        if (commitResult.status === 409) errMsg = '提交冲突：文件已在远端被修改，请刷新后重试';
        else if (commitResult.status === 422) errMsg = '提交被拒绝：请检查 Token 的 Contents 写入权限，或文件是否超出限制';
        if (leftoverBranch) errMsg += '（分支 ' + leftoverBranch + ' 已创建但提交未完成，可在 GitHub 删除）';
        notify(errMsg);
        return;
      }
      var newSha = '';
      if (commitResult.data) {
        if (commitResult.data.content && commitResult.data.content.sha) newSha = commitResult.data.content.sha;
        else if (commitResult.data.commit && commitResult.data.commit.sha) newSha = commitResult.data.commit.sha;
      }
      var record = {
        ts: Date.now(), path: state.currentPath, message: message,
        branch: targetBranch, base_branch: baseBranch, pr_mode: !!state.prMode,
        url: createdPr ? createdPr.html_url : ((commitResult.data && commitResult.data.commit && commitResult.data.commit.html_url) || ''),
        sha: (createdPr && createdPr.head && createdPr.head.sha) || newSha || ''
      };
      var hist = loadHistory(); hist.unshift(record); saveHistory(hist);
      state.currentSha = newSha;
      state.currentContent = newContent;
      // 同步整库缓存，避免 AI 继续基于旧内容分析
      if (state.bulkFiles && Object.prototype.hasOwnProperty.call(state.bulkFiles, state.currentPath)) state.bulkFiles[state.currentPath] = newContent;
      state.isNewFile = false;
      if (createdPr) notify('已创建 Pull Request：' + (createdPr.html_url || ''));
      else if (prCreateFailed) notify('代码已提交到分支 ' + targetBranch + '，但 Pull Request 创建失败，可到 GitHub 手动发起');
      else notify((wasNew ? '已新建并提交到 ' : '已提交到 ') + targetBranch);
      exitEditMode();
      if (state.prMode) { state.repo.branch = baseBranch; ui.branchSel.value = baseBranch; saveRepo(state.repo); }
      renderHistoryList();
      loadTree();
    } catch (e) {
      notify('提交失败：' + ((e && e.message) || '未知错误'));
    } finally {
      ui.commitBtn.disabled = false;
      ui.commitBtn.textContent = '确认提交';
    }
  }

  // 新建文件：填写路径后进入空白编辑器，提交时不带 sha 即由 GitHub 创建
  function newFile() {
    if (!state.repo) { notify('请先连接仓库'); return; }
    var p = window.prompt('新文件路径（相对仓库根，例如 src/foo.js）：');
    if (p === null) return;
    p = String(p || '').trim().replace(/^\/+\s*/, '');
    if (!p) return;
    if (isBinaryPath(p)) { notify('二进制文件不支持在线新建，请在本地上传'); return; }
    if (isKnownFilePath(p)) { openFile(p); return; }
    state.fileSeq++;
    state.currentPath = p; state.currentSha = ''; state.currentContent = ''; state.isNewFile = true; state.undo = null;
    ui.filePath.textContent = p + '（新文件）';
    ui.viewerEmpty.classList.add('hidden');
    ui.codePre.classList.add('hidden');
    ui.editor.classList.remove('hidden');
    ui.editor.value = '';
    ui.editBtn.classList.add('hidden');
    ui.cancelEditBtn.classList.remove('hidden');
    ui.saveBtn.classList.remove('hidden');
    ui.commitBar.classList.add('hidden');
    if (ui.undoAiBtn) ui.undoAiBtn.classList.add('hidden');
    autoResizeEditor();
    try { ui.editor.focus(); } catch (e) {}
    notify('新文件：填写内容后点「保存到仓库」提交');
  }

  // 删除当前文件：小文件走 contents DELETE（后端仅放行该类删除），大文件走 Git Database
  async function deleteFile() {
    if (!state.repo || !state.currentPath || state.isNewFile) return;
    if (!window.confirm('确定从分支「' + state.repo.branch + '」删除文件 ' + state.currentPath + ' ？')) return;
    var msg = window.prompt('提交信息：', 'chore: 删除 ' + state.currentPath);
    if (msg === null) return;
    msg = String(msg).trim() || ('chore: 删除 ' + state.currentPath);
    ui.saveBtn.disabled = true;
    try {
      var owner = state.repo.owner, repo = state.repo.repo, br = state.repo.branch;
      var r;
      if (shouldUseGitApi(state.currentContent)) {
        r = await gitApiCommitMany(owner, repo, br, [{ path: state.currentPath, content: null }], msg);
      } else {
        r = await ghRequest('DELETE', '/repos/' + owner + '/' + repo + '/contents/' + encodePath(state.currentPath), { message: msg, branch: br, sha: state.currentSha });
      }
      if (!r.ok) { notify('删除失败：' + ghErr(r, '未知错误')); return; }
      if (state.bulkFiles) { try { delete state.bulkFiles[state.currentPath]; } catch (e) {} }
      var h = loadHistory();
      h.unshift({ ts: Date.now(), path: state.currentPath, message: msg, branch: br, base_branch: br, pr_mode: false, url: '', sha: '', deleted: true });
      saveHistory(h);
      notify('已删除 ' + state.currentPath);
      clearFileView(); loadTree(); renderHistoryList();
    } catch (e) {
      notify('删除失败：' + ((e && e.message) || '未知错误'));
    } finally {
      ui.saveBtn.disabled = false;
    }
  }

  // ── 批量读取整库代码 + 分支合并 ─────────────────────────────
  function decodeGhContent(item) {
    if (!item) return '';
    if (item.encoding === 'base64' && item.content) {
      try { return decodeURIComponent(escape(atob(item.content.replace(/\s/g, '')))); }
      catch (e) { try { return atob(item.content.replace(/\s/g, '')); } catch (e2) { return ''; } }
    }
    return item.content || '';
  }
  function resetBulkCache() {
    state.bulkFiles = {};
    state.bulkBranch = '';
    updateBulkStatus();
  }
  function updateBulkStatus() {
    if (!ui.bulkStatus) return;
    var n = state.bulkFiles ? Object.keys(state.bulkFiles).length : 0;
    ui.bulkStatus.textContent = n ? ('已载入 ' + n + ' 个文件' + (state.bulkBranch ? ' · ' + state.bulkBranch : '') + ((state.bulkFailed && state.bulkFailed.length) ? ' · ' + state.bulkFailed.length + ' 个未读' : '')) : '';
    ui.bulkStatus.title = (state.bulkFailed && state.bulkFailed.length) ? ('未读取：\n' + state.bulkFailed.slice(0, 50).join('\n')) : '';
  }
  async function bulkLoadAll() {
    if (!state.repo || !state.tree || !state.tree.length) { notify('请先连接仓库并加载文件树'); return; }
    var candidates = [];
    for (var i = 0; i < state.tree.length; i++) {
      var node = state.tree[i];
      if (node.type !== 'blob') continue;
      if (!isCodeFileForBulk(node.path)) continue;
      if (node.size && node.size > BULK_MAX_FILE_BYTES) continue;
      candidates.push(node);
    }
    // 优先读小文件，保证在文件数上限内覆盖尽量多的核心代码
    candidates.sort(function (a, b) { return (a.size || 0) - (b.size || 0); });
    if (candidates.length > BULK_MAX_FILES) candidates = candidates.slice(0, BULK_MAX_FILES);
    if (!candidates.length) { notify('当前分支没有可批量读取的代码文件'); return; }
    state.bulkFiles = {};
    state.bulkFailed = [];
    state.bulkBranch = state.repo.branch;
    if (ui.bulkBtn) ui.bulkBtn.disabled = true;
    var total = candidates.length, done = 0, failed = 0;
    if (ui.bulkStatus) ui.bulkStatus.textContent = '0/' + total;
    async function fetchOne(n) {
      try {
        var r = await ghRequest('GET', '/repos/' + state.repo.owner + '/' + state.repo.repo + '/contents/' + encodePath(n.path) + '?ref=' + encodeURIComponent(state.repo.branch));
        if (r.ok && r.data) {
          var c = decodeGhContent(r.data);
          if (c.length > BULK_MAX_FILE_BYTES) c = c.slice(0, BULK_MAX_FILE_BYTES);
          state.bulkFiles[n.path] = c;
        } else { failed++; state.bulkFailed.push(n.path); }
      } catch (e) { failed++; state.bulkFailed.push(n.path); }
      done++;
      if (ui.bulkStatus) ui.bulkStatus.textContent = done + '/' + total;
    }
    var idx = 0;
    async function worker() { while (idx < candidates.length) { await fetchOne(candidates[idx++]); } }
    var pool = [];
    for (var w = 0; w < BULK_CONCURRENCY; w++) pool.push(worker());
    await Promise.all(pool);
    if (ui.bulkBtn) ui.bulkBtn.disabled = false;
    var loaded = Object.keys(state.bulkFiles).length;
    updateBulkStatus();
    notify(loaded ? ('已读取 ' + loaded + ' 个代码文件，AI 可全局分析' + (failed ? '，' + failed + ' 个跳过' : '')) : '读取失败，请检查 Token 权限');
  }
  function currentBranchNames() {
    var names = [];
    if (ui.branchSel) for (var i = 0; i < ui.branchSel.options.length; i++) names.push(ui.branchSel.options[i].value);
    return names.filter(Boolean);
  }
  function fillMergeSelect(sel, names, selected) {
    if (!sel) return;
    sel.innerHTML = '';
    names.forEach(function (nm) {
      var o = el('option', { value: nm, text: nm });
      if (nm === selected) o.selected = true;
      sel.appendChild(o);
    });
  }
  function openMergeBox() {
    if (!state.repo) { notify('请先连接仓库'); return; }
    var names = currentBranchNames();
    if (names.length < 2) { notify('该仓库目前只有一个分支，没有可合并的来源分支'); return; }
    fillMergeSelect(ui.mergeBaseSel, names, state.repo.branch);
    var other = names.filter(function (nm) { return nm !== state.repo.branch; })[0] || names[0];
    fillMergeSelect(ui.mergeHeadSel, names, other);
    ui.mergeBox.classList.remove('hidden');
    updateMergePreview();
  }
  // 合并前预检：对比 base...head，展示领先/落后/分叉与变更文件数
  async function updateMergePreview() {
    if (!ui.mergePreview || ui.mergeBox.classList.contains('hidden')) return;
    var base = ui.mergeBaseSel.value, head = ui.mergeHeadSel.value;
    if (!base || !head) { ui.mergePreview.textContent = ''; return; }
    if (base === head) { ui.mergePreview.textContent = '合入分支与来源分支相同'; return; }
    ui.mergePreview.textContent = '正在对比两个分支...';
    var r = await ghRequest('GET', '/repos/' + state.repo.owner + '/' + state.repo.repo + '/compare/' + encodeURIComponent(base) + '...' + encodeURIComponent(head));
    if (!r.ok) { ui.mergePreview.textContent = '对比失败：' + ghErr(r, '未知错误'); return; }
    var d = r.data || {};
    var statusMap = { identical: '内容一致（无需合并）', ahead: '可快进合并', behind: '来源落后于目标', diverged: '已分叉（可能存在冲突）' };
    var line = statusMap[d.status] || ('状态：' + (d.status || '未知'));
    if (d.status !== 'identical') line += '：' + head + ' 领先 ' + (d.ahead_by || 0) + ' / 落后 ' + (d.behind_by || 0) + '，变更文件 ' + (Array.isArray(d.files) ? d.files.length : 0) + ' 个';
    ui.mergePreview.textContent = line;
    ui.mergePreview.classList.toggle('cw-merge-warn', d.status === 'diverged');
  }
  function closeMergeBox() { if (ui.mergeBox) ui.mergeBox.classList.add('hidden'); }
  async function doMerge() {
    if (!state.repo) return;
    var base = ui.mergeBaseSel.value;
    var head = ui.mergeHeadSel.value;
    var msg = (ui.mergeMsg.value || '').trim();
    if (!base || !head) { notify('请选择合入分支与来源分支'); return; }
    if (base === head) { notify('合入分支与来源分支不能相同'); return; }
    ui.mergeDoBtn.disabled = true;
    ui.mergeDoBtn.textContent = '合并中...';
    try {
      var body = { base: base, head: head };
      if (msg) body.commit_message = msg;
      var r = await ghRequest('POST', '/repos/' + state.repo.owner + '/' + state.repo.repo + '/merges', body);
      if (r.ok && r.data) {
        notify('已将 ' + head + ' 合并到 ' + base);
        var rec = {
          ts: Date.now(), path: '(分支合并)', message: 'merge ' + head + ' -> ' + base,
          branch: base, base_branch: base, pr_mode: false,
          url: r.data.html_url || '', sha: (r.data.commit && r.data.commit.sha) || ''
        };
        var h = loadHistory(); h.unshift(rec); saveHistory(h); renderHistoryList();
        closeMergeBox();
        if (state.repo.branch === base) loadTree();
      } else if (r.status === 204) {
        notify('无需合并：' + head + ' 已包含在 ' + base + ' 中');
      } else if (r.status === 409) {
        notify('合并冲突：请先在本地解决 ' + head + ' 与 ' + base + ' 的冲突后再合并');
      } else {
        notify('合并失败：' + ghErr(r, 'HTTP ' + r.status));
      }
    } catch (e) {
      notify('合并失败：' + ((e && e.message) || '未知错误'));
    } finally {
      ui.mergeDoBtn.disabled = false;
      ui.mergeDoBtn.textContent = '确认合并';
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

  // 生成当前分支的完整文件清单，让 AI 一眼看到所有文件
  function buildFileTreeText() {
    if (!state.tree || !state.tree.length) return '';
    var files = [];
    for (var i = 0; i < state.tree.length; i++) {
      if (state.tree[i].type === 'blob') files.push(state.tree[i].path);
    }
    if (!files.length) return '';
    files.sort();
    var out = [], used = 0;
    for (var fi = 0; fi < files.length; fi++) {
      var ln = files[fi];
      if (used + ln.length + 1 > TREE_AI_MAX_CHARS) { out.push('...（文件清单过长，已省略其余 ' + (files.length - fi) + ' 项，可点名要求查看某个文件）'); break; }
      out.push(ln); used += ln.length + 1;
    }
    return out.join('\n');
  }

  function buildAiPrompt(request) {
    var lines = [];
    if (state.repo) lines.push('仓库：' + state.repo.full_name + '（当前分支：' + state.repo.branch + '）');
    if (state.currentPath) {
      lines.push('当前打开文件：' + state.currentPath);
    } else {
      lines.push('当前打开文件：无');
    }
    // 注入当前分支的完整文件清单，AI 可直接在整个仓库范围内工作，无需用户逐一手动选文件
    var treeText = buildFileTreeText();
    if (treeText) {
      lines.push('');
      lines.push('当前分支全部文件清单（你可在其中任意文件上直接修改；修改某个文件时，在代码块第一行用注释标出目标路径，例如：// path: src/foo.js）：');
      lines.push('```');
      lines.push(treeText);
      lines.push('```');
    }
    // 用户点“读取全部代码”后，把当前分支已读取文件的完整内容注入，支持全局改 bug
    if (state.bulkFiles && state.bulkBranch === (state.repo && state.repo.branch)) {
      var bulkPaths = Object.keys(state.bulkFiles).sort();
      var bulkBudget = BULK_AI_TOTAL_CHARS, bulkUsed = 0, bulkInjected = 0;
      var bulkOut = [];
      for (var bi = 0; bi < bulkPaths.length; bi++) {
        var bpth = bulkPaths[bi];
        var bcontent = String(state.bulkFiles[bpth] || '');
        if (!bcontent.trim()) continue;
        if (bcontent.length > MAX_AI_FILE_CHARS) bcontent = bcontent.slice(0, MAX_AI_FILE_CHARS) + '\n...（该文件过长已截断）';
        if (bulkUsed + bcontent.length > bulkBudget) { bulkOut.push('...（其余文件超出上下文预算已省略，可点名要求查看某个文件）'); break; }
        bulkUsed += bcontent.length; bulkInjected++;
        bulkOut.push('// ===== 文件: ' + bpth + ' =====\n' + bcontent);
      }
      if (bulkInjected) {
        lines.push('当前分支已读取的 ' + bulkInjected + ' 个代码文件完整内容如下（修改时仍在代码块首行用 // path: 标注目标文件，并输出该文件完整新内容，不得省略）：');
        lines.push(bulkOut.join('\n\n'));
        lines.push('');
      }
    }
    lines.push('');
    if (state.currentPath && state.currentContent) {
      var ctx = state.currentContent;
      if (ctx.length > MAX_AI_FILE_CHARS) ctx = ctx.slice(0, MAX_AI_FILE_CHARS) + '\n...（内容过长已截断）';
      lines.push('当前打开文件内容：\n```\n' + ctx + '\n```');
      lines.push('');
    }
    lines.push('用户需求：' + request);
    lines.push('');
    lines.push('规则：若需求涉及修改某文件，请输出该文件的完整新内容放在单个代码块中，并在代码块首行用注释标注目标文件路径 // path: xxx；不得省略任何代码；若只是查看/解释则直接回答。');
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
    // 思考过程折叠面板
    var thinkBody = el('div', { class: 'cw-think-body' });
    var thinkArrow = el('span', { class: 'cw-think-arrow', text: '▾' });
    var thinkHead = el('div', { class: 'cw-think-head' }, [thinkArrow, el('span', { text: '思考过程' })]);
    thinkHead.addEventListener('click', function () { thinkArrow.textContent = thinkBody.classList.toggle('hidden') ? '▸' : '▾'; });
    var thinkWrap = el('div', { class: 'cw-think hidden' });
    thinkWrap.appendChild(thinkHead);
    thinkWrap.appendChild(thinkBody);
    aiWrap.appendChild(thinkWrap);
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
        onReasoning: function (chunk) {
          if (chunk) {
            thinkWrap.classList.remove('hidden');
            thinkBody.textContent = (thinkBody.textContent || '') + chunk;
            scrollChat();
          }
        },
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
      try { if (aiWrap.parentNode) aiWrap.parentNode.removeChild(aiWrap); } catch (e) {}
      var truncated = isAiOutputTruncated(finalText);
      var groups = extractAllCodeBlocks(finalText);
      var fenced = extractCodeBlock(finalText);
      if (truncated) {
        // ① 输出疑似截断：绝不自动覆盖，防止半截代码写坏文件
        ui.chatMsgs.appendChild(el('div', { class: 'cw-msg cw-msg-warn', text: '⚠ AI 输出疑似不完整（代码块未闭合，可能达到输出长度上限）。已暂停自动应用：可让 AI“继续”，或点下方按钮强行应用。' }));
        if (fenced) addApplyBar(fenced);
        scrollChat();
      } else if (groups.length >= 2) {
        // ② 一次改多个文件：清单化，逐个应用或一次性提交
        renderMultiFileBar(groups);
      } else if (fenced) {
        // ③ 单文件：编辑器存在未保存手动修改时先确认，避免被覆盖；否则自动应用保持流畅
        var tp = extractTargetPath(fenced);
        var tpKnown = !!(tp && isKnownFilePath(tp));
        var editorDirty = !ui.editor.classList.contains('hidden') && ui.editor.value !== state.currentContent && !!ui.editor.value.trim();
        if (editorDirty && (!tpKnown || tp === state.currentPath)) {
          addApplyBar(fenced);
          notify('检测到编辑器有未保存修改，已暂停自动覆盖，请确认后点“应用”');
        } else if (tpKnown || state.currentPath) {
          applyAiOutput(fenced, tpKnown ? tp : state.currentPath);
        }
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

  var AI_FENCE = String.fromCharCode(96).repeat(3);
  // 解析输出中所有带 path 标记的代码块，返回 [{path, code}]，同路径保留最后一次
  function extractAllCodeBlocks(text) {
    if (!text) return [];
    var re = new RegExp(AI_FENCE + '[a-zA-Z0-9+#.\\-_]*\\s*\\n([\\s\\S]*?)' + AI_FENCE, 'g'), m, raw, res = [];
    while ((m = re.exec(text)) !== null) {
      raw = m[1].replace(/^\n+/, '');
      var p = extractTargetPath(raw);
      if (p) res.push({ path: p, code: stripPathMarker(raw) });
    }
    var map = {}, order = [];
    res.forEach(function (x) { if (!Object.prototype.hasOwnProperty.call(map, x.path)) order.push(x.path); map[x.path] = x.code; });
    return order.map(function (p) { return { path: p, code: map[p] }; });
  }
  // 代码围栏数量为奇数 => 存在未闭合代码块，输出疑似被 max_tokens 截断
  function isAiOutputTruncated(text) {
    if (!text) return false;
    var fences = text.match(new RegExp(AI_FENCE, 'g'));
    return !!(fences && fences.length % 2 === 1);
  }
  // 单个“应用到文件”按钮条
  function addApplyBar(code) {
    var p = extractTargetPath(code), known = !!(p && isKnownFilePath(p));
    var finalPath = known ? p : state.currentPath;
    var wrap = el('div', { class: 'cw-msg cw-msg-apply' });
    var btn = el('button', { type: 'button', class: 'cw-mini-btn cw-mini-btn-primary', text: '应用到「' + (finalPath || '请先选择文件') + '」' });
    btn.addEventListener('click', function () { applyAiOutput(code, finalPath); });
    wrap.appendChild(btn);
    ui.chatMsgs.appendChild(wrap);
    scrollChat();
  }
  // 多文件改动清单：逐个应用 / 一次性提交
  function renderMultiFileBar(groups) {
    var wrap = el('div', { class: 'cw-msg cw-msg-apply cw-multi-apply' });
    wrap.appendChild(el('div', { class: 'cw-multi-title', text: 'AI 一次修改了 ' + groups.length + ' 个文件：' }));
    groups.forEach(function (g) {
      var row = el('div', { class: 'cw-multi-row' });
      var known = isKnownFilePath(g.path);
      var b = el('button', { type: 'button', class: 'cw-mini-btn', text: (known ? '应用' : '新建') + '：' + g.path });
      b.addEventListener('click', function () { applyAiOutput(g.code, g.path); });
      row.appendChild(b); wrap.appendChild(row);
    });
    var all = el('button', { type: 'button', class: 'cw-mini-btn cw-mini-btn-primary', text: '一次性提交全部 ' + groups.length + ' 个文件' });
    all.addEventListener('click', function () { commitAllGroups(groups, all); });
    wrap.appendChild(all);
    ui.chatMsgs.appendChild(wrap);
    scrollChat();
  }
  async function commitAllGroups(groups, btn) {
    if (!state.repo || !groups || !groups.length) return;
    var input = window.prompt('本次提交信息：', 'fix: AI 批量修改 ' + groups.length + ' 个文件');
    if (input === null) return;
    var msg = String(input).trim() || ('fix: AI 批量修改 ' + groups.length + ' 个文件');
    var br = state.repo.branch;
    if (br === state.repo.default_branch) {
      if (!window.confirm('将直接提交 ' + groups.length + ' 个文件到默认分支「' + br + '」，是否继续？')) return;
    }
    if (btn) { btn.disabled = true; btn.textContent = '提交中...'; }
    try {
      var changes = groups.map(function (g) { return { path: g.path, content: stripPathMarker(g.code) }; });
      var r = await gitApiCommitMany(state.repo.owner, state.repo.repo, br, changes, msg);
      if (!r.ok) { notify('批量提交失败：' + ghErr(r, '未知错误')); return; }
      groups.forEach(function (g) { if (state.bulkFiles) state.bulkFiles[g.path] = g.code; });
      var h = loadHistory();
      h.unshift({ ts: Date.now(), path: groups.map(function (g) { return g.path; }).join(', '), message: msg, branch: br, base_branch: br, pr_mode: false, multi: groups.length, url: (r.data && r.data.commit && r.data.commit.html_url) || '', sha: (r.data && r.data.commit && r.data.commit.sha) || '' });
      saveHistory(h);
      notify('已一次性提交 ' + groups.length + ' 个文件到 ' + br);
      renderHistoryList(); loadTree();
    } catch (e) {
      notify('批量提交失败：' + ((e && e.message) || '未知错误'));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '一次性提交全部 ' + groups.length + ' 个文件'; }
    }
  }

  // 从 AI 输出的代码块首行解析目标文件路径（// path: a/b.js、# path: ...、<!-- path: ... -->）
  function extractTargetPath(code) {
    if (!code) return '';
    var firstLine = '\n' + code.split('\n')[0];
    // 仅处理首行出现 path: 标记的情况
    if (firstLine.indexOf('path:') === -1 && firstLine.indexOf('路径') === -1) return '';
    var m = firstLine.match(/(?:path|文件路径|保存为|保存到)\s*[:：]\s*([^\s`"'<>|;]+)/i);
    if (!m) return '';
    var p = String(m[1]).trim();
    // 去掉可能粘贴的结尾注释 / 分号
    p = p.replace(/\/\/.*$/, '').replace(/;\s*$/, '').trim();
    if (!p) return '';
    return p;
  }

  // 检查目标路径当前是否合法（在当前分支文件清单中）
  function isKnownFilePath(p) {
    if (!p) return false;
    for (var i = 0; i < state.tree.length; i++) {
      if (state.tree[i].type === 'blob' && state.tree[i].path === p) return true;
    }
    return false;
  }

  // 去掉代码块首行的路径标记（// path: xxx），避免写进文件
  function stripPathMarker(code) {
    if (!code) return code;
    var lines = code.split('\n');
    if (lines.length && /(path|文件路径|保存为|保存到)\s*[:：]/i.test(lines[0])) {
      lines.shift();
    }
    return lines.join('\n');
  }

  function applyAiOutput(code, targetPath) {
    var path = targetPath || state.currentPath;
    if (!path) { notify('请先在左侧选择一个文件，或让 AI 在代码块首行标注 // path:'); return; }
    if (!code) { notify('AI 结果中没有可用的代码'); return; }
    code = stripPathMarker(code);
    var known = isKnownFilePath(path);
    var apply = function () {
      // 记录覆盖前快照，供一键还原，避免 AI 覆盖手动修改后无法找回
      state.undo = {
        path: state.currentPath,
        isNew: state.isNewFile,
        content: state.isNewFile ? '' : (ui.editor.classList.contains('hidden') ? state.currentContent : ui.editor.value)
      };
      state.currentPath = path;
      state.isNewFile = !known;
      state.currentSha = known ? state.currentSha : '';
      if (!known) state.currentContent = '';
      ui.filePath.textContent = path + (known ? '' : '（新文件）');
      ui.codePre.classList.add('hidden');
      ui.editor.classList.remove('hidden');
      ui.editor.value = code;
      ui.editBtn.classList.add('hidden');
      ui.cancelEditBtn.classList.remove('hidden');
      ui.saveBtn.classList.remove('hidden');
      ui.commitBar.classList.add('hidden');
      if (ui.undoAiBtn) ui.undoAiBtn.classList.remove('hidden');
      autoResizeEditor();
      notify('已应用到编辑器，确认无误后点「保存到仓库」提交');
      try { ui.editor.focus(); } catch (e) {}
    };
    if (known && path !== state.currentPath) openFile(path).then(apply);
    else apply();
  }
  // 还原最近一次 AI 应用前的内容
  function undoAiApply() {
    if (!state.undo) { notify('没有可还原的 AI 修改'); return; }
    var u = state.undo;
    state.currentPath = u.path;
    state.isNewFile = u.isNew;
    ui.filePath.textContent = u.path + (u.isNew ? '（新文件）' : '');
    ui.codePre.classList.add('hidden');
    ui.editor.classList.remove('hidden');
    ui.editor.value = u.content || '';
    state.undo = null;
    if (ui.undoAiBtn) ui.undoAiBtn.classList.add('hidden');
    autoResizeEditor();
    notify('已还原 AI 修改前的内容');
  }

  // ── 刷新 ──────────────────────────────────────────────────────
  async function refreshWorkspace() {
    if (!state.repo) return;
    ui.repoName.textContent = state.repo.full_name;
    ui.refreshBtn.disabled = true;
    ui.refreshBtn.textContent = '刷新中...';
    var prevPath = state.currentPath;
    try {
      await Promise.all([loadBranches(), loadTree()]);
      // 远端可能已更新：重新拉取当前打开文件；整库缓存作废，避免 AI 基于旧代码
      resetBulkCache();
      if (prevPath) { try { await openFile(prevPath); } catch (e) {} }
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
