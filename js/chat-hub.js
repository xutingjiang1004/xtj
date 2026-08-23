/* =========================================================================
 * chat-hub.js —「AI 对话中转站」Hub（CODE工作台首页）
 *
 * 目标：把 CODE工作台打开后的默认页做成类似 ChatGPT / Claude / 豆包官网的
 *   对话界面：左侧会话栏 + 顶部模型选择 + 聊天输入区。
 * 能力（复用小猫AI整套基座，不重复造轮子）：
 *   - 内置模型 + 用户通过 localStorage(xtj_ai_custom_models) 添加的第三方
 *     BYOK 模型（千问/豆包/DeepSeek/Kimi/智谱/OpenAI/自定义 OpenAI 兼容）。
 *   - 内置模型对话经 /api/agent/chat/stream 持久化到登录账号；会话列表经
 *     /api/agent/chat/conversations、历史经 /chat/history、新建经 /chat/new。
 *   - 自定义模型经 /api/agent/custom-chat/stream 转发（思考档位 + 联网搜索
 *     按供应商映射）；其 Key 与对话仅存本机（第三方数据不属于本站服务器）。
 *   - 兼容桌面壳通过 window.__xtjChatHubAPI.{init,enterCode,isActive} 挂载。
 * ------------------------------------------------------------------ */
window.__xtjChatHub = (function () {
  'use strict';

  var ROOT = String((window.XTJ_CONFIG && window.XTJ_CONFIG.API_BASE) || (window.location.origin || '')).replace(/\/+$/, '');
  var API_BASE = ROOT + '/api/agent';
  var MODELS_KEY = 'xtj_ai_custom_models';
  var THINK_MODES = ['off', 'low', 'medium', 'high', 'max'];
  var BUILTIN_MODELS = [
    { value: 'deepseek-v4-flash-vision-exp', label: 'V4 Flash Vision' },
    { value: 'deepseek-v4-pro', label: 'V4 Pro' }
  ];
  var PROVIDERS = [
    { key: 'qwen',    label: '千问 Qwen',       base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
    { key: 'doubao',  label: '豆包 Doubao',      base: 'https://ark.cn-beijing.volces.com/api/v3',           defaultModel: 'doubao-1-5-pro-32k' },
    { key: 'deepseek', label: 'DeepSeek',       base: 'https://api.deepseek.com',                           defaultModel: 'deepseek-chat' },
    { key: 'kimi',    label: 'Kimi 月之暗面',    base: 'https://api.moonshot.cn/v1',                         defaultModel: 'moonshot-v1-8k' },
    { key: 'zhipu',   label: '智谱 GLM',        base: 'https://open.bigmodel.cn/api/paas/v4',               defaultModel: 'glm-4-flash' },
    { key: 'openai',  label: 'OpenAI',          base: 'https://api.openai.com/v1',                          defaultModel: 'gpt-4o-mini' },
    { key: 'custom',  label: '自定义(OpenAI兼容)', base: '',                                                  defaultModel: '' }
  ];

  // ---- 状态 ----
  var host = null;
  var root = null;
  var active = false;
  var onEnterCode = null;
  var convId = null;                 // 当前内置会话 conversation_id
  var messages = [];                 // 当前会话消息 [{role,content,reasoning}]
  var selected = { type: 'builtin', value: 'deepseek-v4-flash-vision-exp', custom: null };
  var thinkMode = 'off';
  var webSearch = false;
  var streaming = false;
  var streamingAssistant = null;   // 流式进行中累积的 AI 回复，完成后提交进 messages
  var _streamSeq = 0;
  var activeStreamId = 0;          // 当前生效的流号，旧请求 finalize 据此忽略，防止串扰新流

  // ─── 用户偏好持久化（思考档位 / 模型 / 联网） ───
  function loadHubPrefs() {
    try {
      var t = localStorage.getItem('xtj_hub_think_mode');
      if (t && THINK_MODES && THINK_MODES.indexOf(t) >= 0) thinkMode = t;
      var ws = localStorage.getItem('xtj_hub_web_search');
      webSearch = (ws === '1');
      var vt = localStorage.getItem('xtj_hub_model_type');
      var vv = localStorage.getItem('xtj_hub_model_value');
      if (vt === 'custom' && vv) {
        var cm = loadCustomModels().filter(function (x) { return x.uid === vv; })[0];
        if (cm) selected = { type: 'custom', value: 'custom:' + cm.uid, custom: cm };
      } else if (vv) {
        var bm = BUILTIN_MODELS.filter(function (b) { return b.value === vv; })[0];
        if (bm) selected = { type: 'builtin', value: vv, custom: null };
      }
    } catch (e) {}
  }
  function saveHubPrefs() {
    try {
      localStorage.setItem('xtj_hub_think_mode', thinkMode);
      localStorage.setItem('xtj_hub_web_search', webSearch ? '1' : '0');
      localStorage.setItem('xtj_hub_model_type', selected.type);
      localStorage.setItem('xtj_hub_model_value', selected.type === 'custom' ? (selected.custom && selected.custom.uid) : selected.value);
    } catch (e) {}
  }
  var aborter = null;
  var conversations = [];
  var _attachFile = null;   // 当前待发送附件 { name, type, dataUrl, size }
  var _els = {};

  function isLoggedIn() {
    return !!(window.currentUser);
  }

  async function tokenHeaders() {
    var h = { 'Content-Type': 'application/json' };
    var t = '';
    try { if (typeof window.ensureUserToken === 'function') t = await window.ensureUserToken(); } catch (e) { t = ''; }
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }

  function loadCustomModels() {
    try {
      var raw = localStorage.getItem(MODELS_KEY);
      if (!raw) return [];
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      return list.filter(function (m) { return m && m.uid && m.api_key; });
    } catch (e) { return []; }
  }
  function saveCustomModels(list) {
    try { localStorage.setItem(MODELS_KEY, JSON.stringify(list || [])); } catch (e) {}
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function md(text) {
    if (typeof window.renderMarkdown === 'function') {
      try { return window.renderMarkdown(text || ''); } catch (e) {}
    }
    return '<div style="white-space:pre-wrap">' + esc(text) + '</div>';
  }

  function showToast(msg) {
    if (!root) return;
    var t = document.createElement('div');
    t.className = 'hub-toast';
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(function () { t.classList.add('hub-toast-hide'); }, 2600);
    setTimeout(function () { try { t.remove(); } catch (e) {} }, 3200);
  }

  // ─── API ───
  async function apiGet(path) {
    var r = await fetch(API_BASE + path, { method: 'GET', headers: await tokenHeaders() });
    var j = await r.json().catch(function () { return {}; });
    return { ok: r.ok, status: r.status, data: j };
  }
  async function apiPost(path, body) {
    var r = await fetch(API_BASE + path, { method: 'POST', headers: await tokenHeaders(), body: JSON.stringify(body || {}) });
    var j = await r.json().catch(function () { return {}; });
    return { ok: r.ok, status: r.status, data: j };
  }

  // ─── 会话列表 ───
  async function refreshConversations() {
    if (!_els.list) return;
    _els.list.innerHTML = '';
    var label = document.createElement('div');
    label.className = 'hub-conv-label';
    label.textContent = '最近对话';
    _els.list.appendChild(label);
    try {
      var res = await apiGet('/chat/conversations?limit=50');
      conversations = (res.ok && res.data && Array.isArray(res.data.conversations)) ? res.data.conversations : [];
    } catch (e) { conversations = []; }
    if (!conversations.length) {
      var empty = document.createElement('div');
      empty.className = 'hub-conv-empty';
      empty.textContent = '暂无历史会话';
      _els.list.appendChild(empty);
      return;
    }
    conversations.forEach(function (c) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'hub-conv-item' + (convId && c.conversation_id === convId ? ' is-active' : '');
      var title = document.createElement('div');
      title.className = 'hub-conv-title';
      title.textContent = c.title || '新对话';
      var sub = document.createElement('div');
      sub.className = 'hub-conv-sub';
      sub.textContent = c.last_message || '';
      var time = document.createElement('div');
      time.className = 'hub-conv-time';
      time.textContent = fmtTime(c.updated_at);
      item.appendChild(title); item.appendChild(sub); item.appendChild(time);
      item.addEventListener('click', function () { openConversation(c.conversation_id); });
      var del = document.createElement('span');
      del.className = 'hub-conv-del';
      del.textContent = '✕';
      del.title = '删除会话';
      del.addEventListener('click', function (ev) { ev.stopPropagation(); deleteConversation(c.conversation_id); });
      item.appendChild(del);
      _els.list.appendChild(item);
    });
  }

  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function currentModelLabel() {
    if (selected.type === 'custom' && selected.custom) {
      return (selected.custom.label || selected.custom.model || '自定义') +
        (selected.custom.providerLabel ? ' · ' + selected.custom.providerLabel : '');
    }
    var m = BUILTIN_MODELS.filter(function (b) { return b.value === selected.value; })[0];
    return m ? m.label : selected.value;
  }
  function modelId() {
    if (selected.type === 'custom' && selected.custom) return 'custom:' + selected.custom.uid;
    return selected.value;
  }

  // ─── 新建 / 打开 / 删除 ───
  async function newConversation() {
    if (streaming) stopStream();
    messages = [];
    convId = null;
    renderMessages();
    try {
      var canNew = selected.type === 'custom' || isLoggedIn();
      if (!canNew) { showToast('请先登录，或使用第三方模型'); return; }
      if (selected.type === 'builtin') {
        var res = await apiPost('/chat/new', {});
        if (res.ok && res.data && res.data.conversation_id) convId = res.data.conversation_id;
      }
    } catch (e) {}
    refreshConversations();
    focusInput();
  }

  async function openConversation(id) {
    if (streaming) stopStream();
    convId = id || null;
    messages = [];
    renderMessages();
    _els.empty.classList.add('hidden');
    _els.thread.classList.remove('hub-thread-empty');
    try {
      var res = await apiGet('/chat/history?conversation_id=' + encodeURIComponent(id || ''));
      var items = (res.ok && res.data && Array.isArray(res.data.messages)) ? res.data.messages : [];
      if (res.ok && res.data && res.data.conversation_id) convId = res.data.conversation_id;
      messages = items.map(function (m) {
        return { role: m.role, content: m.content, reasoning: m.reasoning || '' };
      }).filter(function (m) { return m.content || m.reasoning; });
      renderMessages();
    } catch (e) {}
    refreshConversations();
  }

  async function deleteConversation(id) {
    if (!window.confirm('确定删除该会话吗？')) return;
    try {
      await apiPost('/chat/delete', { conversation_id: id, mode: 'normal' });
    } catch (e) {}
    if (convId === id) { messages = []; convId = null; renderMessages(); }
    refreshConversations();
  }

  // ─── 消息渲染 ───
  function renderMessages() {
    if (!_els.thread) return;
    _els.thread.innerHTML = '';
    if (!messages.length) {
      _els.empty.classList.remove('hidden');
      _els.thread.classList.add('hub-thread-empty');
      var suggest = document.createElement('div');
      suggest.className = 'hub-suggest';
      [
        '帮我写一段 Python 快速排序',
        '用通俗的话解释微积分',
        '总结这篇文章的要点'
      ].forEach(function (q) {
        var b = document.createElement('button');
        b.className = 'hub-suggest-chip';
        b.textContent = q;
        b.addEventListener('click', function () { if (_els.input) _els.input.value = q; focusInput(); });
        suggest.appendChild(b);
      });
      _els.empty.textContent = '开始一段新对话';
      _els.empty.appendChild(suggest);
      // ★ 修复：renderMessages 开头 thread.innerHTML='' 已把 empty 移出 DOM，须重新挂回，否则欢迎屏永久空白
      _els.thread.appendChild(_els.empty);
      return;
    }
    _els.empty.classList.add('hidden');
    _els.thread.classList.remove('hub-thread-empty');
    messages.forEach(function (m) { appendMessageEl(m, m._streaming === true); });
    scrollBottom();
  }

  function appendMessageEl(m, isStreaming) {
    var wrap = document.createElement('div');
    wrap.className = 'hub-msg hub-msg-' + (m.role === 'assistant' ? 'ai' : 'user');
    var body = document.createElement('div');
    body.className = 'hub-msg-body';
    // 思考折叠
    if (m.reasoning) {
      var rw = document.createElement('div');
      rw.className = 'hub-reason';
      var rt = document.createElement('div');
      rt.className = 'hub-reason-title';
      rt.textContent = '⧉ 深度思考';
      var rc = document.createElement('div');
      rc.className = 'hub-reason-content';
      rc.innerHTML = md(m.reasoning);
      rw.appendChild(rt); rw.appendChild(rc);
      rt.addEventListener('click', function () { rw.classList.toggle('open'); });
      body.appendChild(rw);
    }
    var content = document.createElement('div');
    content.className = 'hub-msg-content';
    var bodyHtml;
    if (isStreaming) {
      bodyHtml = '';
    } else {
      // AI 消息缺失正文时显示占位，避免点进历史/流中断后看起来"空白没显示"
      var hasBody = (m.content && String(m.content).trim());
      bodyHtml = md(hasBody ? m.content : (m.role === 'assistant' ? '（AI 未生成正文，可重新生成重试）' : ''));
    }
    content.innerHTML = bodyHtml;
    if (isStreaming) { content.className += ' is-streaming'; }
    body.appendChild(content);
    wrap.appendChild(body);
    _els.thread.appendChild(wrap);
    return { wrap: wrap, contentEl: content };
  }

  function appendStreamingRow() {
    var el = appendMessageEl({ role: 'assistant', content: '' }, true);
    if (!el) return null;
    return el;
  }

  function scrollBottom() {
    if (_els.thread) _els.thread.scrollTop = _els.thread.scrollHeight;
  }

  // ─── 发送 ───
  async function send() {
    var input = _els.input;
    var text = (input.value || '').trim();
    var attach = _attachFile;
    if ((!text && !attach) || streaming) return;
    if (input) input.value = '';
    autoGrow();
    var display = text || (attach ? '🖼 上传了 ' + attach.name : '');
    messages.push({ role: 'user', content: display });
    renderMessages();
    if (text) { input.value = ''; autoGrow(); }
    // 发送后清空附件并隐藏预览
    _attachFile = null;
    renderAttachPreview();
    startStream(text, attach);
  }

  function stopStream() {
    if (aborter) { try { aborter.abort(); } catch (e) {} aborter = null; }
    if (streaming) { streaming = false; setStreamingUI(false); }
  }

  function buildHistory() {
    var hl = [];
    var tail = messages.slice(-20);
    for (var i = 0; i < tail.length; i++) {
      var m = tail[i];
      if (!m || !m.content) continue;
      var c = String(m.content);
      if (!c.trim()) continue;
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      // 排除仍处于待回复状态的最后一条 user（正文已入队，避免与 stream 重复）
      if (i === tail.length - 1 && m.role === 'user' && m._pending) continue;
      hl.push({ role: m.role, content: c.slice(0, 8000) });
    }
    return hl;
  }

  async function startStream(text, attach) {
    // 标记这条 user 为待回复
    messages[messages.length - 1]._pending = true;
    var isCustom = selected.type === 'custom' && selected.custom;
    var reqId = 'hub_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
    var url = isCustom ? (API_BASE + '/custom-chat/stream') : (API_BASE + '/chat/stream');
    streaming = true;
    setStreamingUI(true);
    aborter = new AbortController();
    var status = appendStreamingRow({});
    var assistant = { role: 'assistant', content: '', reasoning: '' };
    streamingAssistant = assistant;
    // ★ 竞态隔离：记录本请求流号，旧请求最终的 finalize 不得串扰新流
    var streamId = ++_streamSeq;
    activeStreamId = streamId;
    function doFinalize(result) {
      if (activeStreamId !== streamId) return; // 旧请求被新流取代时忽略
      finalizeStream(result);
    }

    var payload;
    if (isCustom) {
      // 第三方模型：图片以 dataURL 内联进消息，保证视觉可用
      var fwdText = text;
      if (attach && String(attach.type).indexOf('image/') === 0) {
        fwdText = (text ? text + '\n' : '') + '![image](' + attach.dataUrl + ')';
      } else if (!text && attach) {
        fwdText = '[附件: ' + attach.name + ']';
      }
      payload = {
        provider: selected.custom.provider,
        api_key: selected.custom.api_key,
        model: selected.custom.model,
        base_url: selected.custom.base_url,
        message: fwdText,
        messages: messages.map(function (mm) {
          return mm.role === 'user' && mm._pending
            ? { role: 'user', content: fwdText }
            : { role: mm.role, content: String(mm.content || '') };
        }).filter(function (mm) { return (mm.content || '').trim(); }),
        thinking_mode: thinkMode,
        web_search: webSearch === true,
        client_request_id: reqId,
        timeout_ms: 180000
      };
    } else {
      payload = {
        message: text || (attach ? '（上传了附件：' + attach.name + '，请查看并回复）' : ''),
        conversation_id: convId || undefined,
        client_request_id: reqId,
        thinking_mode: thinkMode,
        web_search: webSearch === true,
        model: selected.value,
        attachments: attach ? [{ name: attach.name, type: attach.type, data_url: attach.dataUrl }] : undefined
      };
    }

    var resp;
    try {
      var h = await tokenHeaders();
      var needToken = !isCustom;
      if (needToken && !h.Authorization) { throw new Error('NO_LOGIN'); }
      if (needToken && !isLoggedIn()) { throw new Error('NO_LOGIN'); }
      resp = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(payload), signal: aborter.signal });
    } catch (e) {
      doFinalize({ ok: false, err: (e && e.message === 'NO_LOGIN') ? '请先登录后再使用内置模型' : '网络错误，请重试' });
      return;
    }

    if (!resp.ok) {
      var msg = '请求失败(' + resp.status + ')';
      try {
        var ej = await resp.json().catch(function () { return null; });
        if (ej && ej.error) msg = String(ej.error);
      } catch (e) {}
      doFinalize({ ok: false, err: msg });
      return;
    }

    var reader = resp.body.getReader();
    var decoder = new TextDecoder('utf-8');
    var buf = '';
    var done = false;
    var sawContent = false;

    try {
      for (;;) {
        var cr = await reader.read();
        if (cr.done) break;
        buf += decoder.decode(cr.value, { stream: true });
        var idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
          var line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          if (line.indexOf('data:') === 0) line = line.slice(5).trim();
          var evt = null;
          try { evt = JSON.parse(line); } catch (e) { continue; }
          if (!evt || !evt.type) continue;
          if (evt.type === 'heartbeat') continue;
          if (evt.type === 'meta') {
            if (evt.conversation_id) { convId = evt.conversation_id; }
            continue;
          }
          if (evt.type === 'reasoning') {
            // 后端 reasoning 事件字段是 text（如 {type:'reasoning', text}）
            assistant.reasoning += String(evt.text || evt.reasoning || evt.delta || '');
            updateStreamingRow(status, assistant);
            continue;
          }
          if (evt.type === 'content') {
            // 后端 content 事件字段是 text（{type:'content', text}），此前误用 delta/content 读不到内容
            var d = String(evt.text || evt.delta || evt.content || '');
            if (d) { sawContent = true; assistant.content += d; updateStreamingRow(status, assistant); }
            continue;
          }
          if (evt.type === 'broken') {
            assistant.content += String(evt.text || evt.delta || evt.reasoning_part || '');
            updateStreamingRow(status, assistant);
            continue;
          }
          if (evt.type === 'done') {
            if (evt.conversation_id) convId = evt.conversation_id;
            // 兜底：流式 delta 若未捕获到正文（缺包/清空），用 done 携带的完整内容补全
            if (evt.content && !assistant.content) {
              assistant.content = String(evt.content);
              sawContent = true;
              updateStreamingRow(status, assistant);
            }
            done = true;
            // 清除待回复标记
            clearPendingFlag();
            break;
          }
          if (evt.type === 'error') {
            doFinalize({ ok: false, err: String(evt.error || '出错了'), reason: evt.code });
            return;
          }
        }
        if (done) break;
      }
      doFinalize({ ok: true });
    } catch (e) {
      if (e && e.name === 'AbortError') {
        doFinalize({ ok: false, err: '已取消', aborted: true });
      } else {
        // 流中断：保留已收到的内容并给出准确提示，不再笼统报错丢内容
        var keepContent = !!(assistant && (assistant.content || assistant.reasoning));
        doFinalize({
          ok: !!keepContent,
          err: keepContent ? null : '读取流失败，请重试',
          notice: keepContent ? '连接中断，回复可能不完整' : null
        });
      }
    }
  }

  function clearPendingFlag() {
    for (var i = 0; i < messages.length; i++) { if (messages[i] && messages[i]._pending) messages[i]._pending = false; }
  }

  function ensureStreamReasonEl(wrap, contentEl) {
    var reasonEl = wrap.querySelector('.hub-reason');
    if (!reasonEl) {
      reasonEl = document.createElement('div');
      reasonEl.className = 'hub-reason open';
      var rt = document.createElement('div');
      rt.className = 'hub-reason-title';
      rt.textContent = '⧉ 深度思考';
      var rc = document.createElement('div');
      rc.className = 'hub-reason-content';
      reasonEl.appendChild(rt); reasonEl.appendChild(rc);
      wrap.insertBefore(reasonEl, contentEl);
      (function(el){ rt.addEventListener('click', function(){ el.classList.toggle('open'); }); })(reasonEl);
    }
    return reasonEl;
  }

  function updateStreamingRow(status, assistant) {
    if (!status || !status.contentEl) return;
    status.contentEl.innerHTML = '';
    var fragment = document.createElement('div');
    fragment.innerHTML = md(assistant.content || '');
    status.contentEl.appendChild(fragment);
    // 思考块刷新：节点缺失时先创建，避免 querySelector 返回 null 抛 TypeError 中断整个流
    var reasonText = String(assistant.reasoning || '');
    var reasonEl = status.wrap.querySelector('.hub-reason');
    if (reasonText && !reasonEl) {
      reasonEl = ensureStreamReasonEl(status.wrap, status.contentEl);
    }
    if (!reasonText && reasonEl) { try { reasonEl.remove(); } catch (eRe) {} reasonEl = null; }
    if (reasonEl) {
      var rc = reasonEl.querySelector('.hub-reason-content');
      if (rc) rc.innerHTML = md(reasonText);
    }
    scrollBottom();
  }

  function finalizeStream(result) {
    streaming = false;
    setStreamingUI(false);
    clearPendingFlag();
    // ★ 修复：把流式累积的 AI 回复提交进 messages。此前 assistant 只渲染在临时
    //   流式行里，从未写入 messages，renderMessages() 重绘后回复即消失。
    var pending = streamingAssistant;
    streamingAssistant = null;
    try {
      if (pending && !pending._committed && (pending.content || pending.reasoning)) {
        var committed = {
          role: 'assistant',
          content: pending.content || '',
          reasoning: pending.reasoning || '',
          created_at: new Date().toISOString()
        };
        pending._committed = true; // 可靠去重：同一 pending 只提交一次
        messages.push(committed);
      }
    } catch (eCommit) {}
    // 移除临时思考行占位，重新按最终内容渲染
    renderMessages();
    if (result) {
      if (result.notice && !result.aborted) {
        showToast(result.notice);
      } else if (!result.ok && result.err && !result.aborted) {
        showToast(result.err);
      }
    }
    refreshConversations();
    focusInput();
  }

  function setStreamingUI(on) {
    if (!_els.sendBtn) return;
    _els.sendBtn.textContent = on ? '暂停' : '发送';
    _els.sendBtn.classList.toggle('is-busy', on);
  }

  // ─── 模型选择 ───
  function renderModelPop() {
    if (!_els.pop) return;
    _els.pop.innerHTML = '';
    var section = document.createElement('div');
    section.className = 'hub-pop-label';
    section.textContent = '内置模型';
    _els.pop.appendChild(section);
    BUILTIN_MODELS.forEach(function (b) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'hub-pop-item' + (selected.type === 'builtin' && selected.value === b.value ? ' is-sel' : '');
      item.textContent = b.label;
      item.addEventListener('click', function () {
        selected = { type: 'builtin', value: b.value, custom: null };
        _els.modelBtn.textContent = currentModelLabel();
        closePop();
        saveHubPrefs();
        refreshConversations();
      });
      _els.pop.appendChild(item);
    });
    var customs = loadCustomModels();
    if (customs.length) {
      var label = document.createElement('div');
      label.className = 'hub-pop-label';
      label.textContent = '我的模型';
      _els.pop.appendChild(label);
      customs.forEach(function (m) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'hub-pop-item hub-pop-item-custom' + (selected.type === 'custom' && selected.custom && selected.custom.uid === m.uid ? ' is-sel' : '');
        item.textContent = (m.label || m.model || '自定义') + ' · ' + (m.providerLabel || m.provider || '');
        var del = document.createElement('span');
        del.className = 'hub-pop-del';
        del.textContent = '✕';
        del.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var list = loadCustomModels().filter(function (x) { return x.uid !== m.uid; });
          saveCustomModels(list);
          if (selected.type === 'custom' && selected.custom && selected.custom.uid === m.uid) {
            selected = { type: 'builtin', value: 'deepseek-v4-flash-vision-exp', custom: null };
            _els.modelBtn.textContent = currentModelLabel();
            saveHubPrefs();
          }
          renderModelPop();
          refreshConversations();
        });
        item.appendChild(del);
        item.addEventListener('click', function () {
          selected = { type: 'custom', value: 'custom:' + m.uid, custom: m };
          _els.modelBtn.textContent = currentModelLabel();
          closePop();
          saveHubPrefs();
        });
        _els.pop.appendChild(item);
      });
    }
    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'hub-pop-add';
    add.textContent = '＋ 添加自定义模型';
    add.addEventListener('click', function () { openAddModal(); });
    _els.pop.appendChild(add);
  }

  function openAddModal() {
    if (!root) return;
    var bg = document.createElement('div');
    bg.className = 'hub-modal-bg';
    var box = document.createElement('div');
    box.className = 'hub-modal';
    box.innerHTML =
      '<div class="hub-modal-title">添加第三方模型</div>' +
      '<label class="hub-field">服务商' +
      '<select id="hubAddProvider">' +
      PROVIDERS.map(function (p) { return '<option value="' + p.key + '">' + esc(p.label) + '</option>'; }).join('') +
      '</select></label>' +
      '<label class="hub-field">API Key<input id="hubAddKey" type="password" placeholder="sk-... " autocomplete="off"></label>' +
      '<label class="hub-field">模型名<input id="hubAddModel" type="text" placeholder="qwen-plus"></label>' +
      '<label class="hub-field" style="display:none" id="hubCustomBaseField">接口地址<input id="hubAddBase" type="text" placeholder="https://.../v1"></label>' +
      '<div class="hub-modal-actions">' +
      '<button type="button" class="hub-btn ghost" id="hubAddCancel">取消</button>' +
      '<button type="button" class="hub-btn primary" id="hubAddSave">保存并使用</button>' +
      '</div>';
    bg.appendChild(box);
    root.appendChild(bg);

    var sel = box.querySelector('#hubAddProvider');
    var keyInput = box.querySelector('#hubAddKey');
    var modelInput = box.querySelector('#hubAddModel');
    var baseField = box.querySelector('#hubCustomBaseField');
    var baseInput = box.querySelector('#hubAddBase');

    function syncFields() {
      var p = PROVIDERS.filter(function (x) { return x.key === sel.value; })[0];
      if (!p) return;
      modelInput.placeholder = p.defaultModel || '模型名';
      if (!modelInput.value) modelInput.value = p.defaultModel || '';
      baseField.style.display = p.key === 'custom' ? '' : 'none';
      if (p.key === 'custom' && !baseInput.value) baseInput.value = 'https://';
    }
    sel.addEventListener('change', function () { modelInput.value = ''; syncFields(); });
    syncFields();

    function close() { try { bg.remove(); } catch (e) {} }
    box.querySelector('#hubAddCancel').addEventListener('click', close);
    bg.addEventListener('click', function (ev) { if (ev.target === bg) close(); });
    box.querySelector('#hubAddSave').addEventListener('click', function () {
      var key = gv(keyInput);
      var model = gv(modelInput);
      var prov = gv(sel);
      if (!prov) { showToast('请选择服务商'); return; }
      if (!key) { showToast('请填写 API Key'); return; }
      var p = PROVIDERS.filter(function (x) { return x.key === prov; })[0];
      if (!p) return;
      var base = gv(baseInput) || p.base;
      var uid = 'cm_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
      var list = loadCustomModels();
      list.push({ uid: uid, provider: p.key, providerLabel: p.label, label: model || uiName(model, p), api_key: key, model: model || p.defaultModel, base_url: base });
      saveCustomModels(list);
      selected = { type: 'custom', value: 'custom:' + uid, custom: list[list.length - 1] };
      _els.modelBtn.textContent = currentModelLabel();
      renderModelPop();
      close();
      showToast('已添加并切换到 ' + currentModelLabel());
      refreshConversations();
    });
    setTimeout(function () { keyInput.focus(); }, 50);
  }

  function uiName(model, p) {
    return model || p.defaultModel || p.label;
  }
  function gv(inp) { return inp ? String(inp.value || '').trim() : ''; }

  function closePop() { if (_els.pop) { _els.pop.classList.remove('open'); } }

  // ─── 导出对话（Markdown） ───
  function exportConversation() {
    var msgs = (messages || []).filter(function (m) { return m && m.content && (m.role === 'user' || m.role === 'assistant'); });
    if (!msgs.length) { showToast('当前对话还没有可导出的内容'); return; }
    var displayName = 'AI 对话';
    var modelLabel = currentModelLabel();
    function fmtHms(t) {
      try { var d = new Date(t); return d.toLocaleString(); } catch (e) { return ''; }
    }
    var lines = ['# ' + displayName + ' 记录', '', '导出时间：' + new Date().toLocaleString(), '模型：' + modelLabel, ''];
    msgs.forEach(function (m) {
      var role = m.role === 'assistant' ? '🤖 ' + displayName : '🧑 我';
      lines.push('## ' + role + (m.created_at ? ' · ' + fmtHms(m.created_at) : ''));
      lines.push('');
      lines.push(String(m.content));
      lines.push('');
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '对话_' + (convId ? convId.slice(-6) : new Date().getTime().toString(36)) + '.md';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} if (a.parentNode) a.parentNode.removeChild(a); }, 500);
    showToast('已导出 Markdown 文件');
  }

  // ─── 附件 / 语音（从原聊天界面迁回） ───
  function readAttachmentFile(rawFile) {
    var type = String(rawFile.type || '');
    var isImage = type.indexOf('image/') === 0;
    var okName = /\.(pdf|docx|txt|csv|xlsx?)$/i.test(rawFile.name || '');
    if (!isImage && !okName) { showToast('仅支持图片、PDF、DOCX、TXT、CSV 和 XLSX 文件'); return; }
    if (rawFile.size > 7 * 1024 * 1024) { showToast('文件不能超过 7MB'); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      _attachFile = { name: rawFile.name, type: type || 'application/octet-stream', dataUrl: e.target.result, size: rawFile.size };
      renderAttachPreview();
    };
    reader.onerror = function () { showToast('读取文件失败，请重试'); };
    reader.readAsDataURL(rawFile);
  }

  function renderAttachPreview() {
    var fp = _els.filePreview;
    if (!fp) return;
    if (!_attachFile) { fp.style.display = 'none'; fp.innerHTML = ''; return; }
    fp.innerHTML = '';
    var isImage = String(_attachFile.type).indexOf('image/') === 0;
    var thumb = isImage ? '<img class="hub-file-thumb" src="' + _attachFile.dataUrl + '">' : '<span class="hub-file-icon">📄</span>';
    var kb = Math.round((_attachFile.dataUrl.length * 3 / 4) / 1024);
    fp.innerHTML = thumb + '<span class="hub-file-info">' + esc(_attachFile.name) + ' (' + kb + 'KB)</span><button type="button" class="hub-file-remove" title="移除">×</button>';
    fp.style.display = 'flex';
    var rm = fp.querySelector('.hub-file-remove');
    if (rm) rm.addEventListener('click', function () { _attachFile = null; renderAttachPreview(); });
  }

  function bindVoiceInput(btn, input) {
    if (!btn || !input) return;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var rec = null;
    var listening = false;
    var baseText = '';
    btn.addEventListener('click', function () {
      if (!SR) { showToast('当前浏览器不支持语音输入，请用桌面版 Chrome 或 Edge'); return; }
      if (listening) { try { rec.stop(); } catch (e) {} return; }
      try {
        rec = new SR();
        rec.lang = 'zh-CN';
        rec.interimResults = true;
        rec.continuous = false;
        listening = true;
        baseText = String(input.value || '').replace(/\s+$/, '');
        btn.classList.add('listening');
        rec.onresult = function (ev) {
          var transcript = '';
          for (var i = 0; i < ev.results.length; i++) { if (ev.results[i] && ev.results[i][0]) transcript += ev.results[i][0].transcript; }
          if (!transcript) return;
          input.value = baseText ? (baseText + ' ' + transcript) : transcript;
          autoGrow();
        };
        rec.onend = function () { listening = false; btn.classList.remove('listening'); };
        rec.onerror = function (ev) {
          listening = false; btn.classList.remove('listening');
          if (ev && ev.error && ev.error !== 'aborted' && ev.error !== 'no-speech') showToast('语音识别失败：' + ev.error);
        };
        rec.start();
      } catch (e) { listening = false; btn.classList.remove('listening'); showToast('语音输入不可用'); }
    });
  }

  // ─── 额度获取与显示 ───
  function loadQuota() {
    var badge = _els.quotaBadge;
    if (!badge) return;
    badge.textContent = '额度…';
    tokenHeaders().then(function (h) {
      return fetch(API_BASE + '/quota', { method: 'GET', headers: h });
    }).then(function (r) {
      return r.ok ? r.json().catch(function () { return {}; }) : null;
    }).then(function (data) {
      var q = data && data.quota ? data.quota : null;
      if (!q) { badge.textContent = '额度—'; return; }
      var tUsage = Number(q.tokens_used) || 0;
      var tLimit = Number(q.tokens_limit);
      var tStr = tLimit > 0 ? (Math.max(0, tLimit - tUsage) + ' 剩余') : '不限量';
      var sUsed = Number(q.search_used) || 0;
      var sLimit = Number(q.search_limit);
      var sStr = (q.search_unlimited === true || sLimit < 0) ? '搜索不限' : ('搜索剩 ' + Math.max(0, (sLimit - sUsed)));
      var plan = q.is_pro ? 'Pro' : '免费';
      badge.textContent = plan + ' · ' + tStr + ' · ' + sStr;
    }).catch(function () { badge.textContent = '额度—'; });
  }

  // ─── DOM ───
  function autoGrow() {
    var t = _els.input;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.min(200, t.scrollHeight) + 'px';
  }
  function focusInput() { if (_els.input) { try { _els.input.focus(); } catch (e) {} } }

  function build() {
    loadHubPrefs();
    root.innerHTML = '';
    root.classList.add('hub-scale', 'hub-root');

    var aside = document.createElement('aside');
    aside.className = 'hub-sidebar';
    var logoRow = document.createElement('div');
    logoRow.className = 'hub-logo-row';
    var logo = document.createElement('div');
    logo.className = 'hub-logo';
    logo.textContent = 'AI 对话';
    var foldBtn = document.createElement('button');
    foldBtn.type = 'button';
    foldBtn.className = 'hub-fold';
    foldBtn.title = '折叠 / 展开左侧栏';
    foldBtn.innerHTML = '<span class="hub-fold-caret">‹</span>';
    foldBtn.addEventListener('click', function () {
      // ★ 折叠整个左侧栏（含 AI 对话、新建对话、历史列表），而非只收起最近对话
      var sb = _els.sidebar;
      if (!sb) return;
      var collapsed = !sb.classList.contains('hub-collapsed');
      sb.classList.toggle('hub-collapsed', collapsed);
      foldBtn.classList.toggle('is-collapsed', collapsed);
    });
    logoRow.appendChild(logo); logoRow.appendChild(foldBtn);
    var newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'hub-new';
    newBtn.innerHTML = '<span class="hub-new-plus">＋</span> 新建对话';
    newBtn.addEventListener('click', newConversation);
    var listWrap = document.createElement('div');
    listWrap.className = 'hub-conv-list';
    listWrap.id = 'hubConvList';
    var asideBottom = document.createElement('div');
    asideBottom.className = 'hub-sidebar-foot';
    asideBottom.textContent = isLoggedIn() ? '已登录' : '未登录';
    aside.appendChild(logoRow); aside.appendChild(newBtn);
    aside.appendChild(listWrap); aside.appendChild(asideBottom);
    _els.sidebar = aside; _els.list = listWrap;

    var main = document.createElement('section');
    main.className = 'hub-main';

    var header = document.createElement('header');
    header.className = 'hub-header';
    var pick = document.createElement('div');
    pick.className = 'hub-modelpick';
    var modelBtn = document.createElement('button');
    modelBtn.type = 'button';
    modelBtn.className = 'hub-modelbtn';
    modelBtn.id = 'hubModelBtn';
    modelBtn.textContent = currentModelLabel();
    var pop = document.createElement('div');
    pop.className = 'hub-modelpop';
    pop.id = 'hubModelPop';
    modelBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      renderModelPop();
      pop.classList.toggle('open');
    });
    document.addEventListener('click', function (ev) {
      if (_els.pop && !_els.pop.contains(ev.target) && !_els.modelBtn.contains(ev.target)) closePop();
    });
    pick.appendChild(modelBtn); pick.appendChild(pop);
    _els.modelBtn = modelBtn; _els.pop = pop;

    var tools = document.createElement('div');
    tools.className = 'hub-tools';
    var searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.className = 'hub-tool';
    searchBtn.id = 'hubSearchBtn';
    searchBtn.textContent = '🌐 联网';
    searchBtn.classList.toggle('is-on', webSearch);
    searchBtn.addEventListener('click', function () {
      webSearch = !webSearch;
      searchBtn.classList.toggle('is-on', webSearch);
      saveHubPrefs();
    });
    var thinkSel = document.createElement('select');
    thinkSel.className = 'hub-tool hub-select';
    thinkSel.id = 'hubThinkSel';
    THINK_MODES.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m;
      o.textContent = m === 'off' ? '思考：关' : '思考：' + m;
      thinkSel.appendChild(o);
    });
    thinkSel.value = thinkMode;
    thinkSel.addEventListener('change', function () { thinkMode = thinkSel.value; saveHubPrefs(); });
    var researchBtn = document.createElement('button');
    researchBtn.type = 'button';
    researchBtn.className = 'hub-tool';
    researchBtn.id = 'hubResearchBtn';
    researchBtn.title = '深度研究：多步检索与长文分析';
    researchBtn.innerHTML = '<svg class="hub-research-icon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><ellipse cx="12" cy="17" rx="5.2" ry="4.4"/><circle cx="6.4" cy="9.6" r="1.7"/><circle cx="10" cy="6.5" r="1.8"/><circle cx="14" cy="6.5" r="1.8"/><circle cx="17.6" cy="9.6" r="1.7"/></svg> 深度研究';
    researchBtn.addEventListener('click', function () {
      if (window.__xtjAiAgent && typeof window.__xtjAiAgent.openDeepThink === 'function') window.__xtjAiAgent.openDeepThink();
    });
    var siteSearchBtn = document.createElement('button');
    siteSearchBtn.type = 'button';
    siteSearchBtn.className = 'hub-tool';
    siteSearchBtn.id = 'hubSiteSearchBtn';
    siteSearchBtn.textContent = '🔍 站内搜索';
    siteSearchBtn.title = '搜帖子与评论';
    siteSearchBtn.addEventListener('click', function () {
      if (window.__xtjAiAgent && typeof window.__xtjAiAgent.openSiteSearch === 'function') window.__xtjAiAgent.openSiteSearch();
    });
    var codeBtn = document.createElement('button');
    codeBtn.type = 'button';
    codeBtn.className = 'hub-tool hub-codebtn';
    codeBtn.textContent = '⌨ 进入代码工作区';
    codeBtn.addEventListener('click', function () { if (onEnterCode) onEnterCode(); });
    tools.appendChild(searchBtn); tools.appendChild(thinkSel);
    tools.appendChild(researchBtn); tools.appendChild(siteSearchBtn);
    tools.appendChild(codeBtn);
    header.appendChild(pick); header.appendChild(tools);

    var thread = document.createElement('div');
    thread.className = 'hub-thread';
    thread.id = 'hubThread';
    var empty = document.createElement('div');
    empty.className = 'hub-empty';
    empty.id = 'hubEmpty';
    thread.appendChild(empty);
    _els.thread = thread; _els.empty = empty;

    var composer = document.createElement('footer');
    composer.className = 'hub-composer';
    var voiceBtn = document.createElement('button');
    voiceBtn.type = 'button';
    voiceBtn.className = 'hub-voice';
    voiceBtn.id = 'hubVoiceBtn';
    voiceBtn.title = '语音输入' + (window.SpeechRecognition || window.webkitSpeechRecognition ? '' : '（当前浏览器不支持）');
    voiceBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg>';
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'hubAttachInput';
    fileInput.accept = 'image/*,.pdf,.docx,.txt,.csv,.xlsx,audio/*';
    fileInput.multiple = false;
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (f) readAttachmentFile(f);
      this.value = '';
    });
    // 左下角「＋」菜单（上传 / 生图 / 新对话 / 导出 / 开通Pro / 额度）
    var plusWrap = document.createElement('div');
    plusWrap.className = 'hub-plus';
    var plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'hub-plusbtn';
    plusBtn.id = 'hubPlusBtn';
    plusBtn.title = '更多选项';
    plusBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    var plusMenu = document.createElement('div');
    plusMenu.className = 'hub-plusmenu';
    plusMenu.id = 'hubPlusMenu';
    function hidePlusMenu() { if (_els.plus) _els.plus.classList.remove('open'); }
    function menuItem(label, fn, className) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'hub-menu-item' + (className ? ' ' + className : '');
      b.textContent = label;
      b.addEventListener('click', function () { hidePlusMenu(); fn(); });
      plusMenu.appendChild(b);
      return b;
    }
    menuItem('📎 上传照片或文件', function () { fileInput.click(); });
    menuItem('🎨 AI生图', function () {
      if (window.__xtjAiAgent && typeof window.__xtjAiAgent.openImageGen === 'function') window.__xtjAiAgent.openImageGen();
      else showToast('AI生图暂不可用');
    });
    menuItem('＋ 新对话', function () { newConversation(); });
    menuItem('📤 导出对话', function () { exportConversation(); });
    menuItem('⭐ 开通 Pro', function () {
      if (window.__xtjAiAgent && typeof window.__xtjAiAgent.openPro === 'function') window.__xtjAiAgent.openPro();
      else showToast('Pro 暂不可用');
    }, 'hub-menu-item--pro');
    var quotaItem = menuItem('额度…', function () { loadQuota(); });
    _els.quotaBadge = quotaItem;
    plusBtn.addEventListener('click', function (ev) { ev.stopPropagation(); plusMenu.classList.toggle('open'); });
    document.addEventListener('click', function (ev) {
      if (_els.plus && !_els.plus.contains(ev.target) && _els.plusBtn && !_els.plusBtn.contains(ev.target)) hidePlusMenu();
    });
    plusWrap.appendChild(plusBtn); plusWrap.appendChild(plusMenu);
    _els.plus = plusMenu; _els.plusBtn = plusBtn;
    var filePreview = document.createElement('div');
    filePreview.className = 'hub-file-preview';
    filePreview.id = 'hubAttachPreview';
    filePreview.style.display = 'none';
    _els.filePreview = filePreview;
    var ta = document.createElement('textarea');
    ta.id = 'hubInput';
    ta.rows = 1;
    ta.placeholder = '给 ' + currentModelLabel() + ' 发消息…（Enter 发送，Shift+Enter 换行）';
    ta.addEventListener('input', autoGrow);
    ta.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); }
    });
    var sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'hub-send';
    sendBtn.id = 'hubSendBtn';
    sendBtn.textContent = '发送';
    sendBtn.addEventListener('click', function () {
      if (streaming) stopStream(); else send();
    });
    composer.appendChild(plusWrap);
    composer.appendChild(voiceBtn);
    composer.appendChild(fileInput);
    composer.appendChild(ta);
    composer.appendChild(sendBtn);
    _els.input = ta; _els.sendBtn = sendBtn;
    bindVoiceInput(voiceBtn, ta);
    composer.insertBefore(filePreview, ta);

    main.appendChild(header); main.appendChild(thread); main.appendChild(composer);
    root.appendChild(aside); root.appendChild(main);

    // 页面显示后渲染初始状态
    renderModelPop();
    renderMessages();
    refreshConversations();
    loadQuota();
    return root;
  }

  // ─── 对外 API ───
  return {
    init: function (hostEl, opts) {
      opts = opts || {};
      if (!hostEl) return { status: 'no-host' };
      onEnterCode = opts.onEnterCode || onEnterCode;
      host = hostEl;
      root = document.createElement('div');
      root.className = 'hub-root';
      build();
      while (hostEl.firstChild) hostEl.removeChild(hostEl.firstChild);
      hostEl.appendChild(root);
      active = true;
      return { status: 'ok' };
    },
    enterCode: function (cb) { if (typeof cb === 'function') onEnterCode = cb; if (onEnterCode) onEnterCode(); },
    isActive: function () {
      // ★ 修复：需同时校验 .hub-root 仍挂在文档中。否则面板被 loading/欢迎态覆写后
      // active 仍为 true，会错误地短路跳过 re-init，导致界面停留在空白/加载态。
      return active && !!(root && root.isConnected);
    }
  };
})();