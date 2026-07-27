'use strict';

// ===================== Code workspace AI chat API =====================
// Mounted in server.js as a route module.
// Handles POST /api/code/chat — AI-powered code operations.
// Also handles POST /api/code/document/extract and /api/code/document/apply
// Phase 1: Project index + Agent tool calls + Token budget management

const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const https = require('https');
const { URL } = require('url');
const codeIndex = require('./code-index');

// ── Constants ──────────────────────────────────────────────────────────
const MAX_MESSAGE_LEN = 12000;
const MAX_HISTORY_ITEMS = 50;
// Phase 1: MAX_FILES and MAX_FILES_TOTAL_CONTENT are deprecated.
// Context is now managed via project index + token budget, not static file uploads.
// validateFiles still validates individual file size and path, but no longer
// hard-blocks on total file count or total content size.
const MAX_FILES_TOTAL_CONTENT = 900 * 1024; // Kept only for legacy fallback warning, not a hard block
const MAX_SINGLE_FILE_CONTENT = 2 * 1024 * 1024;
const MAX_OPERATIONS = 10;
const MAX_NEW_CONTENT_LEN = 2 * 1024 * 1024;
const DEEPSEEK_TIMEOUT_MS = 180000;
const CODE_AGENT_MAX_TOOL_ROUNDS = 8;
const CODE_AGENT_CONTEXT_TOKENS = Math.min(
  Math.max(parseInt(process.env.CODE_AI_CONTEXT_TOKENS, 10) || 1000000, 64000),
  1000000
);
const CODE_AGENT_MAX_OUTPUT_TOKENS = Math.min(
  Math.max(parseInt(process.env.CODE_AI_MAX_OUTPUT_TOKENS, 10) || 32768, 4096),
  65536
);
const MAX_OPEN_FILES = 12;
const MAX_ATTACHMENTS = 8;
const CHECKPOINT_KEEP = 12;
const MAX_HISTORY_CHECKPOINT = 50;
const MAX_SESSIONS = 200;
const MAX_SESSION_MESSAGES = 200;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const WEB_FETCH_HOSTS = String(process.env.CODE_AGENT_WEB_FETCH_HOSTS || '').split(',').map(function (host) { return host.trim().toLowerCase(); }).filter(Boolean);
const WEB_TIMEOUT_MS = Math.min(Math.max(Number(process.env.CODE_AGENT_WEB_TIMEOUT_MS) || 8000, 1000), 30000);
const WEB_MAX_BYTES = Math.min(Math.max(Number(process.env.CODE_AGENT_WEB_MAX_BYTES) || 2 * 1024 * 1024, 32 * 1024), 8 * 1024 * 1024);
const WEB_MAX_REDIRECTS = 3;
const MAX_REQUEST_OVERLAY_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 800 * 1024;
const MAX_PDF_PAGES = 500;
const MAX_WORKBOOK_SHEETS = 100;
const MAX_PPTX_ENTRIES = 2000;
const MAX_PPTX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_OFFICE_ARCHIVE_ENTRIES = 5000;
const MAX_OFFICE_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const OP_TYPES_ALLOWED = new Set(['replace_range', 'update', 'create', 'document']);
const OP_TYPES_REJECTED = new Set(['delete', 'rename', 'execute', 'terminal', 'git']);
const SHA256_HEX_RE = /^[a-fA-F0-9]{64}$/;
const JSON_BLOCK_RE = /```json\s*([\s\S]*?)\s*```/i;
const JSON_OBJECT_RE = /"operations"\s*:/;

// ── Session Cache (isolated by user + workspace + generation + conversationId) ──
const agentSessionCache = new Map();

function getSessionKey(userId, workspaceId, generation, conversationId) {
  return [
    String(userId || '').slice(0, 100),
    String(workspaceId || 'default').slice(0, 200),
    String(generation == null ? '0' : generation),
    String(conversationId || '').slice(0, 100)
  ].join(':');
}

function evictOldSessions() {
  var now = Date.now();
  var entries = Array.from(agentSessionCache.entries());
  // First pass: remove expired sessions
  for (var i = 0; i < entries.length; i++) {
    var key = entries[i][0], data = entries[i][1];
    if (now - data.lastActive > SESSION_TTL_MS) {
      agentSessionCache.delete(key);
    }
  }
  // Second pass: if still over capacity, remove oldest by lastActive (LRU)
  if (agentSessionCache.size > MAX_SESSIONS) {
    var remaining = Array.from(agentSessionCache.entries()).sort(function(a, b) {
      return a[1].lastActive - b[1].lastActive;
    });
    var toRemove = remaining.slice(0, remaining.length - MAX_SESSIONS);
    for (var j = 0; j < toRemove.length; j++) {
      agentSessionCache.delete(toRemove[j][0]);
    }
  }
}

function getSession(userId, workspaceId, generation, conversationId) {
  var key = getSessionKey(userId, workspaceId, generation, conversationId);
  var sessionData = agentSessionCache.get(key);
  if (!sessionData) return null;
  // Ownership validation
  if (sessionData.userId !== userId ||
      sessionData.workspaceId !== workspaceId ||
      sessionData.generation !== generation) {
    agentSessionCache.delete(key);
    return null;
  }
  // TTL check
  if (Date.now() - sessionData.lastActive > SESSION_TTL_MS) {
    agentSessionCache.delete(key);
    return null;
  }
  return sessionData;
}

function setSession(userId, workspaceId, generation, conversationId, history) {
  evictOldSessions();
  var key = getSessionKey(userId, workspaceId, generation, conversationId);
  var sessionData = {
    history: history || [],
    lastActive: Date.now(),
    userId: userId,
    workspaceId: workspaceId,
    generation: generation,
    createdAt: Date.now(),
    messageCount: Array.isArray(history) ? history.length : 0
  };
  agentSessionCache.set(key, sessionData);
  return sessionData;
}

function touchSession(sessionData) {
  if (sessionData) {
    sessionData.lastActive = Date.now();
  }
}

setInterval(function() {
  evictOldSessions();
}, 15 * 60 * 1000).unref();

// ── Helpers ────────────────────────────────────────────────────────────

function buildCodeCapabilities(deps, options) {
  options = options || {};
  var model = deps.getDeepSeekModel ? deps.getDeepSeekModel() : '';
  var keyConfigured = !!(deps.getDeepSeekApiKey && deps.getDeepSeekApiKey());
  var callable = typeof deps.callDeepSeek === 'function';
  var provider = {};
  if (typeof deps.getDeepSeekCapabilities === 'function') {
    try { provider = deps.getDeepSeekCapabilities() || {}; } catch (_) { provider = {}; }
  }
  var configured = keyConfigured && callable;
  var succeeded = options.requestSucceeded === true;
  var modelAvailable = typeof provider.modelAvailable === 'boolean' ? provider.modelAvailable : null;
  var probeStatus = typeof provider.probeStatus === 'string' ? provider.probeStatus : 'unknown';
  var available = succeeded || (configured && provider.verifiedAvailable === true);
  var availability = available ? 'ready' :
    (!configured ? 'unavailable' : (probeStatus === 'ready' && modelAvailable === false ? 'unavailable' : 'unknown'));
  var featureEnabled = configured && modelAvailable !== false;
  return {
    provider: 'deepseek',
    model: options.model || provider.model || model || '',
    configured: configured,
    available: available,
    availability: availability,
    probeStatus: probeStatus,
    probeError: typeof provider.probeError === 'string' ? provider.probeError.slice(0, 200) : '',
    modelAvailable: succeeded ? true : modelAvailable,
    agentEnabled: succeeded || featureEnabled,
    toolCallingEnabled: succeeded || featureEnabled,
    apiFormat: provider.apiFormat || 'openai-chat-completions',
    providerContextTokens: Number.isSafeInteger(Number(provider.providerContextTokens)) && Number(provider.providerContextTokens) > 0 ? Number(provider.providerContextTokens) : null,
    providerMaxOutputTokens: Number.isSafeInteger(Number(provider.providerMaxOutputTokens)) && Number(provider.providerMaxOutputTokens) > 0 ? Number(provider.providerMaxOutputTokens) : null,
    maxContextTokens: Math.min(CODE_AGENT_CONTEXT_TOKENS, Number.isSafeInteger(Number(provider.providerContextTokens)) && Number(provider.providerContextTokens) > 0 ? Number(provider.providerContextTokens) : CODE_AGENT_CONTEXT_TOKENS),
    maxOutputTokens: Math.min(CODE_AGENT_MAX_OUTPUT_TOKENS, Number.isSafeInteger(Number(provider.providerMaxOutputTokens)) && Number(provider.providerMaxOutputTokens) > 0 ? Number(provider.providerMaxOutputTokens) : CODE_AGENT_MAX_OUTPUT_TOKENS),
    maxToolRounds: Math.min(CODE_AGENT_MAX_TOOL_ROUNDS, 8),
    verifiedBy: succeeded ? 'chat_completion' : (available ? 'models_probe' : ''),
    
    // Explicit Document Capabilities for System Prompt alignment
    canReadCode: true,
    canWriteCode: true,
    canCreateFiles: true,
    canReadDocx: true,
    canWriteDocx: false,
    canReadXlsx: true,
    canWriteXlsx: true,
    canReadPdf: true,
    canWritePdf: false,
    canReadPptx: true,
    canWritePptx: false,
    workspaceReadOnly: false
  };
}

function hasOwn(obj, key) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function validateString(val, maxLen, fieldName) {
  if (val === undefined || val === null) return { ok: true, value: null };
  if (typeof val !== 'string') return { ok: false, error: fieldName + ' 格式无效' };
  var s = val.trim();
  if (!s.length) return { ok: true, value: null };
  if (s.length > maxLen) return { ok: false, error: fieldName + ' 不能超过 ' + maxLen + ' 个字符' };
  return { ok: true, value: s };
}

function validateHistory(history) {
  if (!Array.isArray(history)) return { ok: true, value: [] };
  if (history.length > MAX_HISTORY_ITEMS) return { ok: false, error: '历史记录最多 ' + MAX_HISTORY_ITEMS + ' 条' };
  var cleaned = [];
  for (var i = 0; i < history.length; i++) {
    var item = history[i];
    if (!item || typeof item !== 'object') continue;
    if (item.role !== 'user' && item.role !== 'assistant') continue;
    // 结构化过滤：检查 errorCode、status 等字段
    if (item.errorCode && typeof item.errorCode === 'string' && item.errorCode.trim()) continue;
    if (item.status === 'error' || item.status === 'cancelled' || item.status === 'stopped') continue;
    if (item.cancelled === true || item.stopped === true) continue;
    var contentStr = String(item.content || '');
    // 防御性过滤：包含错误标记的消息（不限于开头）
    if (contentStr.indexOf('[INDEX_REBUILD_REQUIRED]') >= 0) continue;
    if (contentStr.indexOf('[PROVIDER_') >= 0) continue;
    if (contentStr.indexOf('STREAM_INTERRUPTED') >= 0) continue;
    if (contentStr === '（已停止）' || contentStr === '（无响应）' || !contentStr.trim()) continue;
    if (typeof item.content !== 'string' || !item.content.trim()) continue;
    cleaned.push({ role: item.role, content: item.content.trim().slice(0, MAX_MESSAGE_LEN) });
  }
  return { ok: true, value: cleaned };
}

function validateFiles(files) {
  if (!Array.isArray(files)) return { ok: true, value: [] };
  // Phase 1: No hard limit on file count. Context is managed by project index + token budget.
  var cleaned = [];
  var totalContent = 0;
  var truncationWarnings = 0;
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!f || typeof f !== 'object') continue;
    if (typeof f.path !== 'string' || !f.path.trim()) continue;
    // 对上下文文件使用 normalizeContextPath 安全规范化路径
    var normalizedPath = normalizeContextPath(f.path);
    if (!validatePath(normalizedPath)) {
      console.warn('[code-agent] validateFiles: skipping file with unsafe path after normalization:', f.path);
      continue;
    }
    if (typeof f.content !== 'string') continue;

    var content = f.content;
    var contentBytes = Buffer.byteLength(content, 'utf8');

    if (contentBytes > MAX_SINGLE_FILE_CONTENT) {
      var truncateStr = '\n...[Content truncated due to size limits]...';
      var buffer = Buffer.from(content, 'utf8');
      content = buffer.subarray(0, MAX_SINGLE_FILE_CONTENT - 1000).toString('utf8') + truncateStr;
      contentBytes = Buffer.byteLength(content, 'utf8');
      truncationWarnings++;
    }

    totalContent += contentBytes;

    var item = {
      path: normalizedPath,
      language: typeof f.language === 'string' ? f.language.trim() : '',
      content: content,
      sha256: typeof f.sha256 === 'string' ? f.sha256.trim() : ''
    };
    cleaned.push(item);
  }

  // Log a warning if total content is large, but do NOT hard-block
  if (totalContent > MAX_FILES_TOTAL_CONTENT) {
    console.warn('[code-agent] Total files content (' + Math.round(totalContent / 1024) + 'KB) exceeds legacy ' + Math.round(MAX_FILES_TOTAL_CONTENT / 1024) + 'KB threshold. Project index and token budget will manage context.');
  }

  return { ok: true, value: cleaned, warnings: truncationWarnings > 0 ? { truncatedFiles: truncationWarnings } : undefined };
}

function normalizeContextPath(p) {
  if (typeof p !== 'string' || !p.trim()) return 'unnamed';
  var s = p.trim().replace(/\\/g, '/');
  if (s.charCodeAt(0) === 47 || /^[A-Za-z]:/.test(s) || s.indexOf('//') >= 0) {
    var parts = s.split('/');
    s = parts[parts.length - 1] || 'unnamed';
  }
  s = s.replace(/\.\./g, '').replace(/\/\//g, '/');
  if (s.charCodeAt(0) === 47) s = s.substring(1);
  return s;
}

function validatePath(p) {
  if (typeof p !== 'string' || !p.trim()) return false;
  var s = p.trim();
  if (s.indexOf('..') >= 0) return false;
  if (s.indexOf('//') >= 0 || s.indexOf('\\\\') >= 0) return false;
  if (s.charCodeAt(0) === 47) return false;
  if (/^[A-Za-z]:/.test(s)) return false;
  if (s.indexOf('\\') >= 0) return false;
  if (/\0/.test(s)) return false;
  return true;
}

function isValidOperationType(type) {
  return OP_TYPES_ALLOWED.has(type);
}

function isValidSha256(hex) {
  return typeof hex === 'string' && SHA256_HEX_RE.test(hex);
}

function parseOperations(raw) {
  var ops = [];
  if (!Array.isArray(raw)) return ops;
  for (var i = 0; i < raw.length; i++) {
    if (ops.length >= MAX_OPERATIONS) break;
    var op = raw[i];
    if (!op || typeof op !== 'object') continue;
    var type = (typeof op.type === 'string' ? op.type.trim().toLowerCase() : '');
    if (OP_TYPES_REJECTED.has(type)) continue;
    if (!isValidOperationType(type)) continue;
    if (!validatePath(op.path)) continue;

    // summary is required for all operation types
    if (typeof op.summary !== 'string' || !op.summary.trim()) continue;
    var summary = op.summary.trim().slice(0, 200);

    if (type === 'document') {
      var docType = (typeof op.document_type === 'string' ? op.document_type.trim().toLowerCase() : '');
      if (docType !== 'xlsx') continue;
      var docOps = op.document_operations;
      if (!Array.isArray(docOps) || docOps.length === 0) continue;
      ops.push({
        type: 'document',
        path: op.path.trim(),
        summary: summary,
        document_type: docType,
        document_operations: docOps.slice(0, 20)
      });
      continue;
    }

    if (type === 'create') {
      if (typeof op.new_content !== 'string') continue;
      if (Buffer.byteLength(op.new_content, 'utf8') > MAX_NEW_CONTENT_LEN) continue;
      ops.push({
        type: 'create',
        path: op.path.trim(),
        summary: summary,
        new_content: op.new_content
      });
      continue;
    }

    // update (legacy): full-file replacement, requires expected_sha256 for safety
    if (type === 'update' && !isValidSha256(op.expected_sha256)) continue;
    if (type === 'update' && typeof op.new_content !== 'string') continue;
    if (type === 'update' && Buffer.byteLength(op.new_content, 'utf8') > MAX_NEW_CONTENT_LEN) continue;
    if (type === 'update') {
      ops.push({
        type: 'update',
        path: op.path.trim(),
        summary: summary,
        new_content: op.new_content,
        expected_sha256: op.expected_sha256.toLowerCase()
      });
      continue;
    }

    // replace_range: strict validation - ALL fields required, no fallback to full file overwrite
    if (type === 'replace_range') {
      // Validate expected_sha256: required, must be 64-char hex
      if (!isValidSha256(op.expected_sha256)) continue;
      var expectedSha256 = op.expected_sha256.toLowerCase();

      // Validate start_line: required, must be safe integer >= 1
      if (!Number.isSafeInteger(op.start_line) || op.start_line < 1) continue;
      var startLine = op.start_line;

      // Validate end_line: required, must be safe integer >= start_line
      if (!Number.isSafeInteger(op.end_line) || op.end_line < startLine) continue;
      var endLine = op.end_line;

      // Validate new_content: required, non-empty string
      if (typeof op.new_content !== 'string') continue;
      if (Buffer.byteLength(op.new_content, 'utf8') > MAX_NEW_CONTENT_LEN) continue;

      ops.push({
        type: 'replace_range',
        path: op.path.trim(),
        summary: summary,
        new_content: op.new_content,
        expected_sha256: expectedSha256,
        start_line: startLine,
        end_line: endLine
      });
      continue;
    }
  }
  return ops;
}

function extractJsonFromText(text) {
  var match = text.match(JSON_BLOCK_RE);
  if (match) {
    try { return JSON.parse(match[1].trim()); } catch (_) {}
  }
  var objMatch = text.match(JSON_OBJECT_RE);
  if (objMatch) {
    try {
      var start = text.lastIndexOf('{', objMatch.index);
      if (start >= 0) {
        var depth = 0;
        for (var i = start; i < text.length; i++) {
          if (text[i] === '{') depth++;
          if (text[i] === '}') depth--;
          if (depth === 0) {
            try { return JSON.parse(text.slice(start, i + 1)); } catch (_) { break; }
          }
        }
      }
    } catch (_) {}
  }
  return null;
}

// ── System prompt builder ──────────────────────────────────────────────

function buildSystemPrompt() {
  return [
    'You are the XTJ Code Agent, an expert coding and document assistant embedded in a workspace IDE.',
    '',
    '【对话规则 - 必须遵守】',
    '- 只回答最后一条用户消息。历史消息仅用于理解上下文。',
    '- 历史中已经存在助手回复的问题，不得重新回答。',
    '- 除非用户明确要求总结、回顾或继续旧问题，否则禁止主动复述或回答历史问题。',
    '- 用户发送"78是什么"就只回答"78是什么"，不得把之前的 Code、文档或工作区问题一起重新回答。',
    '- 每次只处理当前用户提出的一个任务，不要合并处理历史中的多个问题。',
    '',
    'You have real read-only project tools. Use them proactively before making claims about the workspace.',
    'For an explicit file name, locate and read that file. For a broad project question, list files first.',
    'For debugging, search relevant terms, then read the strongest matching files and ranges.',
    'Pinned, active and open files are priority hints, never prerequisites for reading other files.',
    'If an open file or uploaded document is available, use get_active_file/get_open_files and read_file before answering; do not ask to rebuild the project index just because the index is missing.',
    'For current, latest, price, opening-hours, weather, news, release or other time-sensitive questions, call web_search first; use fetch_web_page only for a result URL when details are needed.',
    'Web tools return structured results. For every time-sensitive conclusion, cite the source title/URL and published time when provided. If web search is not configured, failed, or a URL is rejected by safety policy, explain that clearly and do not invent current facts or claim verification.',
    'When the user asks to view, summarize or plan from a document, read the supplied document context first and cite the file name in your answer.',
    'Never claim to have read a file unless a tool returned it successfully in this turn.',
    'Never claim tests, builds, terminal commands or Git operations were executed; no such tools exist.',
    'Do not modify unrelated files.',
    '',
    'When asked to modify code, you MUST respond with TWO parts:',
    '1. FIRST: Your reasoning and explanation in plain text. Explain what you\'re doing and why.',
    '2. SECOND: A JSON block containing the operations array.',
    '',
    'The JSON block must be fenced with ```json and ``` markers, and must contain an object with an "operations" array.',
    'Each operation in the array must have:',
    '  - type: "replace_range" (modify existing file), "create" (create new file), or "document" (modify a document)',
    '  - path: relative file path within the workspace (e.g., "src/components/App.jsx")',
    '  - expected_sha256: (for "replace_range" only) the SHA-256 hex hash of the file content you were given',
    '  - summary: a brief description of the change (max 200 chars)',
    '  - start_line: (for "replace_range" only) the 1-indexed starting line number of the text to replace',
    '  - end_line: (for "replace_range" only) the 1-indexed ending line number of the text to replace',
    '  - new_content: (for "replace_range"/"create") the new content snippet to insert or the complete new file',
    '  - document_type: (for "document" type) "xlsx"',
    '  - document_operations: (for "document" type) array of sub-operations',
    '',
    'For XLSX document operations, use:',
    '  { "type": "cell_update", "sheet": "Sheet1", "cell": "A1", "value": "new value" }',
    '  { "type": "cell_delete", "sheet": "Sheet1", "cell": "A1" }',
    '  { "type": "sheet_add", "sheet": "NewSheet" }',
    '  { "type": "sheet_rename", "sheet": "OldName", "new_name": "NewName" }',
    '',

    'IMPORTANT RULES:',
    '- Only return replace_range, create, or document operations.',
    '- Return at most 10 file operations.',
    '- DOCX files are read-only. Do not return document operations for DOCX. For DOCX modification requests, explain that the file can currently be analyzed but cannot be safely rewritten while preserving the DOCX format.',
    '- For "replace_range" operations, new_content must ONLY contain the replacement snippet, NOT the entire file. You MUST specify start_line and end_line accurately.',
    '- For "create" operations, new_content must contain the complete new file.',
    '- For "document" operations, include document_operations array with the specific changes.',
    '- Only use "replace_range", "create", and "document" types. Do NOT use delete, rename, execute, terminal, or git.',
    '- Paths must be relative (no absolute paths, no ".." traversal).',
    '- expected_sha256 must be exactly the 64-character hex hash of the file content sent to you.',
    '- If information is missing, use the project tools to locate it before asking the user.',
    '- If you are not making code changes, do NOT include the JSON block — just provide your explanation.',
    '- Always provide your reasoning and explanation FIRST, before the JSON block.',
    '- The user may be writing travel guides or other documents. Help them with content creation, editing, and analysis.',
    '',
    'Example document operation format:',
    '',
    '```json',
    '{',
    '  "operations": [',
    '    {',
    '      "type": "document",',
    '      "path": "data/report.xlsx",',
    '      "document_type": "xlsx",',
    '      "summary": "Update cell A1 and add new sheet",',
    '      "document_operations": [',
    '        { "type": "cell_update", "sheet": "Sheet1", "cell": "A1", "value": "新标题" },',
    '        { "type": "sheet_add", "sheet": "汇总" }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    '【运行时身份与能力规则】',
    '- 你是 XTJ Code Agent，站点部署在 DeepSeek 平台上。你的 provider 和 model 由服务器配置决定。',
    '- 不要声称自己是 Claude、Anthropic、GPT、OpenAI、Gemini、Google 或其他提供商的模型。',
    '- 用户询问"你是什么模型""你的上下文多大""上下文窗口""还剩多少上下文""最大输出""支持工具调用吗""当前思考模式""缓存命中"时，必须调用 get_runtime_capabilities 工具获取真实数据后回答。',
    '- 不要根据训练知识猜测当前模型规格或上下文窗口大小。',
    '- 如果你从工具获取的数据中某个字段为 null 或不存在，诚实说明"服务器未提供该数据"，不得编造。',
    '- 必须根据 runtime capability 返回的字段来回答你的真实能力。',
    '- 不得声称支持实际没有实现的文件修改能力。目前 DOCX 和 PDF 只能读取和分析，XLSX 才支持文件内容级别的修改（生成 document operation）。',
    '- 文件系统级的权限（如句柄可写）不代表你具备修改该格式的能力。如果文件格式不在支持修改的列表中，请明确告知仅支持读取。',
    '- 项目索引中的"文件数"和"代码块数"只表示索引规模，不代表这些内容已进入当前上下文。用户询问上下文使用时，必须区分索引规模和实际读取量。',
    '- 前端徽章、API capabilities 和你的自述必须使用同一数据源，不得矛盾。',
    '- 绝对禁止回答中包含以下内容：自称 Claude、自称 Anthropic 模型、声称 200K tokens 上下文、声称 15 万英文单词等编造数字。'
  ].join('\n');
}

function inferInitialToolChoice(message, indexSummary, openFiles, activePath) {
  var text = String(message || '').toLowerCase();
  var hasOpenFiles = Array.isArray(openFiles) && openFiles.length > 0;
  
  if (isExplicitSearch(text)) {
    return { type: 'function', function: { name: 'web_search' } };
  }
  
  // Public freshness questions must still search even when an editor tab is
  // open. Only explicit project/file wording gets priority over Web tools.
  if (isFreshnessQuery(text) && !/(project|workspace|repository|directory|file|code|[\u4ee3\u7801\u9879\u76ee\u5de5\u4f5c\u533a\u6587\u4ef6\u4ed3\u5e93])/i.test(text)) {
    return { type: 'function', function: { name: 'web_search' } };
  }
  if (!indexSummary && hasOpenFiles) {
    return { type: 'function', function: { name: 'get_open_files' } };
  }
  if (!indexSummary) return null;
  // Explicit current-file questions must begin with a real overlay-backed
  // read instead of relying only on the model prompt.
  if (activePath && /(current|active|open|this)\s+(file|document|code)|read|view|explain|修改|查看|读取|当前|打开|这个文件/i.test(text)) {
    return { type: 'function', function: { name: 'get_active_file' } };
  }
  if (/(聊天|发送|发消息|实时|realtime|消息|评论|登录|加载|卡住|报错|失败|bug|error)/i.test(text)) {
    return { type: 'function', function: { name: 'search_code' } };
  }
  if (/(项目|工作区|目录|文件树|左侧|整体|全部|所有|检查|问题|bug|代码库|仓库|project|workspace|directory|file tree|repository)/i.test(text)) {
    return { type: 'function', function: { name: 'list_files' } };
  }
  return null;
}

function buildUserMessage(message, workspaceName, activePath, history, contextChunks) {
  var parts = [];

  if (workspaceName) {
    parts.push('【工作区】' + workspaceName);
  }
  if (activePath) {
    parts.push('【当前文件】' + activePath);
  }

  // Include context chunks from index
  if (contextChunks && contextChunks.length > 0) {
    parts.push('');
    parts.push('【项目代码】');
    for (var i = 0; i < contextChunks.length; i++) {
      var chunk = contextChunks[i];
      var shaSuffix = chunk.sha256 ? ' (SHA256: ' + chunk.sha256 + ')' : '';
      parts.push('--- ' + chunk.path + ' (' + (chunk.language || '') + ') L' + chunk.startLine + '-L' + chunk.endLine + shaSuffix + ' ---');
      parts.push(chunk.content);
      parts.push('');
    }
  }

  // Include conversation history
  if (history && history.length > 0) {
    parts.push('');
    parts.push('【对话历史】');
    for (var h = 0; h < history.length; h++) {
      var roleLabel = history[h].role === 'user' ? '用户' : '助手';
      parts.push(roleLabel + ': ' + history[h].content);
    }
    parts.push('');
  }

  parts.push('');
  parts.push('【用户消息】');
  parts.push(message);

  return parts.join('\n');
}

// ── Document parser helpers ─────────────────────────────────────────────

const CODE_AGENT_TOOLS = [
  { type: 'function', function: { name: 'list_files', description: 'List indexed project files. Use first for broad workspace questions.', parameters: { type: 'object', properties: { directory: { type: 'string' }, depth: { type: 'integer', minimum: 0, maximum: 8 }, pattern: { type: 'string' } }, additionalProperties: false } } },
  { type: 'function', function: { name: 'search_code', description: 'Search project paths, symbols and content. Chinese product terms are expanded to code aliases.', parameters: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' }, extensions: { type: 'array', items: { type: 'string' } }, max_results: { type: 'integer', minimum: 1, maximum: 40 } }, required: ['query'], additionalProperties: false } } },
  { type: 'function', function: { name: 'read_file', description: 'Read an entire text file from the editor overlay or project index.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'read_file_range', description: 'Read an inclusive line range from a text file.', parameters: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'integer', minimum: 1 }, end_line: { type: 'integer', minimum: 1 } }, required: ['path', 'start_line', 'end_line'], additionalProperties: false } } },
  { type: 'function', function: { name: 'get_symbols', description: 'Return indexed functions, classes, exports and imports for a file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'get_active_file', description: 'Return the active editor file, including unsaved content when available.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_open_files', description: 'List open editor files and uploaded documents. Read a selected file afterwards.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'get_runtime_capabilities', description: 'Return the current runtime capabilities: provider, model, context window size, output limits, token budget, thinking mode, and cache statistics. Call this when the user asks about your identity, model, context size, token usage, or current capacity.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'web_search', description: 'Search current web information. Use for latest, current, prices, hours, weather, news, releases or other time-sensitive questions.', parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 240 }, max_results: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'], additionalProperties: false } } },
  { type: 'function', function: { name: 'fetch_web_page', description: 'Fetch and extract readable text from one HTTPS web page found by web_search.', parameters: { type: 'object', properties: { url: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['url'], additionalProperties: false } } }
];

function validateWorkspaceScope(req, body) {
  var workspaceId = typeof body.workspace_id === 'string' ? body.workspace_id.trim() :
    (typeof body.workspace_name === 'string' ? body.workspace_name.trim() : '');
  if (!workspaceId) workspaceId = 'default';
  if (workspaceId.length > 200 || /[\u0000-\u001f]/.test(workspaceId)) return { ok: false, error: '工作区 ID 无效' };
  var generation = body.workspace_generation === undefined || body.workspace_generation === null || body.workspace_generation === '' ?
    null : Number(body.workspace_generation);
  if (generation !== null && (!Number.isInteger(generation) || generation < 0 || generation > Number.MAX_SAFE_INTEGER)) {
    return { ok: false, error: '工作区版本无效' };
  }
  return { ok: true, value: { userId: String(req.userName || ''), workspaceId: workspaceId, generation: generation } };
}

function validateRequestFiles(files, limit, fieldName) {
  if (!Array.isArray(files)) return { ok: true, value: [] };
  if (files.length > limit) return { ok: false, error: fieldName + ' 最多 ' + limit + ' 个文件' };
  var cleaned = [];
  var totalBytes = 0;
  for (var i = 0; i < files.length; i++) {
    var item = files[i];
    if (!item || typeof item !== 'object') continue;
    var rawPath = typeof item.path === 'string' ? item.path.trim() :
      (typeof item.name === 'string' ? ('attachments/' + item.name.trim().replace(/[\/\\]/g, '_')) : '');
    // 对上下文文件使用 normalizeContextPath 安全规范化路径
    var path = normalizeContextPath(rawPath);
    if (!validatePath(path) || typeof item.content !== 'string') continue;
    var bytes = Buffer.byteLength(item.content, 'utf8');
    totalBytes += bytes;
    if (bytes > MAX_SINGLE_FILE_CONTENT || totalBytes > MAX_REQUEST_OVERLAY_BYTES) return { ok: false, error: fieldName + ' 内容过大' };
    cleaned.push({
      path: path,
      name: typeof item.name === 'string' ? item.name.slice(0, 200) : path.split('/').pop(),
      language: typeof item.language === 'string' ? item.language.slice(0, 40) : '',
      mimeType: typeof item.mimeType === 'string' ? item.mimeType.slice(0, 160) : '',
      content: item.content,
      sha256: isValidSha256(item.sha256) ? item.sha256.toLowerCase() : crypto.createHash('sha256').update(item.content, 'utf8').digest('hex'),
      source: item.source === 'attachment' ? 'attachment' : 'open'
    });
  }
  return { ok: true, value: cleaned };
}

function fileToToolResult(file, startLine, endLine) {
  var allLines = String(file.content || '').split('\n');
  var start = Math.max(1, Number(startLine) || 1);
  var end = Math.min(allLines.length, Number(endLine) || allLines.length);
  if (end < start) end = start;
  return { ok: true, path: file.path, name: file.name || file.path.split('/').pop(), sha256: file.sha256 || '', mimeType: file.mimeType || '', startLine: start, endLine: end, totalLines: allLines.length, content: allLines.slice(start - 1, end).join('\n'), source: file.source || 'open' };
}

// Phase 2: System prompt is 100% static to maximize KV Cache prefix hits.
// All dynamic state (workspace name, open files, active path, index info) goes
// into the user message. Never inject dynamic content into the system prompt.
// Phase 3: Runtime capabilities are injected into the user message so the
// model knows its real identity (provider/model) and actual limits instead of
// hallucinating Claude/GPT/200K from training data.
function buildAgentMessages(history, currentMessage, workspaceName, indexSummary, activePath, openFiles, attachments, capabilities, thinkingMode, inputBudget) {
  // Static system prompt — never modified per-request (KV Cache friendly)
  var systemPrompt = buildSystemPrompt();
  var messages = [{ role: 'system', content: systemPrompt }];
  for (var i = 0; i < history.length; i++) messages.push(history[i]);

  // Build dynamic state block as a user message
  var caps = capabilities || {};
  var stateLines = [
    '【本轮工作区状态】',
    '- 工作区: ' + (workspaceName || '未命名'),
    '- 索引: ' + (indexSummary ? (indexSummary.totalFiles + ' files / ' + indexSummary.totalChunks + ' chunks') : '未建立（当前打开文件和上传资料仍可读取）'),
    '- 当前文件: ' + (activePath || '无'),
    '- 打开文件: ' + openFiles.map(function(file) { return file.path; }).join(', '),
    '- 已上传资料: ' + attachments.map(function(file) { return file.path; }).join(', ')
  ];
  // Partial index note — placed in user message, not system prompt
  if (indexSummary && indexSummary.truncated === true) {
    stateLines.push('');
    stateLines.push('注意：项目索引不完整（扫描数量达到上限）。不要声称检查了整个工作区，请说明仅使用了已索引的范围。');
  }

  // Runtime capabilities — real server-verified identity and limits
  stateLines.push('');
  stateLines.push('【运行时环境】');
  stateLines.push('- Provider: ' + (caps.provider || 'deepseek'));
  stateLines.push('- 模型: ' + (caps.model || '服务器未声明'));
  stateLines.push('- 站点配置上下文上限: ' + (caps.maxContextTokens ? caps.maxContextTokens.toLocaleString() + ' Token' : '服务器未声明'));
  stateLines.push('- 站点配置最大输出: ' + (caps.maxOutputTokens ? caps.maxOutputTokens.toLocaleString() + ' Token' : '服务器未声明'));
  stateLines.push('- 最大工具轮数: ' + (caps.maxToolRounds || '服务器未声明'));
  stateLines.push('- 当前思考模式: ' + (thinkingMode || 'off'));
  stateLines.push('- 本轮工具输入预算: ' + (typeof inputBudget === 'number' && inputBudget > 0 ? inputBudget.toLocaleString() + ' Token' : '未知'));
  stateLines.push('');
  stateLines.push('重要：以上是服务器提供的真实运行时数据。用户询问身份、模型、上下文窗口、输出上限等问题时，必须使用以上信息回答。');
  stateLines.push('如果某个字段显示"服务器未声明"，诚实告知用户该数据当前不可用，不得编造。');
  stateLines.push('项目索引规模（文件数/代码块数）不等于当前上下文使用量，Agent 只会按需读取所需文件。');

  stateLines.push('');
  stateLines.push('【用户消息】');
  stateLines.push(currentMessage);

  messages.push({ role: 'user', content: stateLines.join('\n') });
  return messages;
}

function isFreshnessQuery(message) {
  return /(最新|今天|昨日|昨天|明天|本周|本月|实时|截至|价格|票价|开放时间|营业时间|天气|新闻|版本|发布|更新|开通了吗|通车了吗|上线了吗|发布了吗|现在能用吗|现在能坐吗|是否运营|还营业吗|目前状态|latest|today|recent|real[- ]?time|price|opening hours|weather|news|release|updated)/i.test(String(message || ''));
}

function isExplicitSearch(message) {
  return /(帮我上网搜|联网查一下|官网查一下|核实一下|查最新消息|上网搜|上网查一下|百度一下|谷歌一下)/i.test(String(message || ''));
}

function needsProjectContext(message) {
  var msg = String(message || '').trim();
  if (!msg) return false;
  
  // 基础聊天、身份询问、功能说明不需要项目上下文 (allow symbols like ? ! etc)
  var noContextRE = /^(你好|你是谁|你能做什么|怎么使用|解释功能|介绍一下|hi|hello|who are you|what can you do)[\s\?\!\。，、]*$/i;
  if (noContextRE.test(msg)) return false;
  
  // 能力咨询不需要项目上下文
  var capabilityRE = /(你支持|你可以|你能|你会|你懂|你认识).*(修改|读取|写|文件|docx|pdf|项目)/i;
  if (capabilityRE.test(msg)) return false;

  // 明确要求读取、检查、修改、分析项目、找bug、代码相关，需要项目上下文
  var requiresContextRE = /(分析.*项目|检查.*(整个项目|项目|bug)|修改.*(代码|文件)|总结.*文档|读取.*(项目|代码)|查找.*函数|修复.*报错|这个文件|看看|有什么问题|重构|解析|总结一下)/i;
  if (requiresContextRE.test(msg)) return true;

  // 如果不包含明确的项目操作词汇，就不强求重建索引（避免普通问题被拦截）
  // 比如用户随意输入 "啊", "测试", "哈哈"
  return false;
}

function isPrivateAddress(address) {
  var value = String(address || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(value) === 4) {
    var octets = value.split('.').map(Number);
    var first = octets[0];
    return first === 0 || first === 10 || first === 127 || first >= 224 ||
      (first === 100 && octets[1] >= 64 && octets[1] <= 127) ||
      (first === 169 && octets[1] === 254) ||
      (first === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (first === 192 && (octets[1] === 168 || octets[1] === 0 && octets[2] === 0 || octets[1] === 0 && octets[2] === 2)) ||
      (first === 198 && (octets[1] === 18 || octets[1] === 19 || octets[1] === 51)) ||
      (first === 203 && octets[1] === 0 && octets[2] === 113);
  }
  if (net.isIP(value) === 6) {
    if (value.indexOf('::ffff:') === 0) {
      var mapped = value.slice(7).split(':');
      if (mapped.length === 2) {
        var hi = parseInt(mapped[0], 16), lo = parseInt(mapped[1], 16);
        if (Number.isFinite(hi) && Number.isFinite(lo)) {
          if (isPrivateAddress([(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.'))) return true;
        }
      }
    }
    return value === '::' || value === '::1' || value.indexOf('fc') === 0 || value.indexOf('fd') === 0 ||
      /^(fe[89ab]):/i.test(value) || value.indexOf('::ffff:127.') === 0 || value.indexOf('::ffff:10.') === 0 ||
      value.indexOf('::ffff:192.168.') === 0 || value.indexOf('::ffff:169.254.') === 0;
  }
  return false;
}

function isBlockedWebHost(hostname) {
  var host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    host === 'metadata.google.internal' || host === 'metadata' || host.endsWith('.internal') || isPrivateAddress(host);
}

function hostAllowed(hostname) {
  if (!WEB_FETCH_HOSTS.length) return true;
  var host = String(hostname || '').toLowerCase();
  return WEB_FETCH_HOSTS.some(function (allowed) {
    return host === allowed || host.endsWith('.' + allowed);
  });
}

async function assertSafeWebUrl(rawUrl, lookupImpl) {
  var parsed;
  try { parsed = new URL(String(rawUrl || '')); } catch (_) { throw new Error('网址格式无效'); }
  if (parsed.protocol !== 'https:') throw new Error('仅支持 HTTPS 网页');
  if (parsed.username || parsed.password) throw new Error('网址不允许包含凭据');
  if (isBlockedWebHost(parsed.hostname) || !hostAllowed(parsed.hostname)) throw new Error('网址主机不在允许范围内');
  var lookup = lookupImpl || dns.lookup;
  var addresses;
  try { addresses = await lookup(parsed.hostname, { all: true, verbatim: true }); } catch (_) { throw new Error('无法解析网页主机'); }
  if (!Array.isArray(addresses) || !addresses.length || addresses.some(function (item) { return isPrivateAddress(item && item.address); })) {
    throw new Error('网页主机解析到禁止访问的内网地址');
  }
  return { parsed: parsed, addresses: addresses.map(function (item) { return item.address; }) };
}

function requestPinnedHttps(parsed, addresses, maxBytes, timeoutMs, headers) {
  return new Promise(function (resolve, reject) {
    var chunks = [], total = 0, settled = false;
    var request = https.request({
      protocol: 'https:', hostname: parsed.hostname, port: parsed.port || 443, path: parsed.pathname + parsed.search,
      method: 'GET', servername: parsed.hostname, rejectUnauthorized: true,
      headers: Object.assign({ Host: parsed.host, Accept: 'text/html,application/xhtml+xml,text/plain,application/json' }, headers || {}),
      lookup: function (_hostname, _options, callback) { callback(null, addresses[0], net.isIP(addresses[0]) || 4); }
    }, function (response) {
      var declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) { request.destroy(); reject(new Error('网页内容超过大小限制')); return; }
      response.on('data', function (chunk) {
        total += chunk.length;
        if (total > maxBytes) { request.destroy(); if (!settled) { settled = true; reject(new Error('网页内容超过大小限制')); } return; }
        chunks.push(chunk);
      });
      response.on('end', function () {
        if (settled) return; settled = true;
        var body = Buffer.concat(chunks, total);
        resolve({ status: response.statusCode || 0, ok: (response.statusCode || 0) >= 200 && (response.statusCode || 0) < 300, headers: { get: function (key) { return response.headers[String(key).toLowerCase()] || null; } }, arrayBuffer: function () { return Promise.resolve(body); } });
      });
      response.on('error', function (err) { if (!settled) { settled = true; reject(err); } });
    });
    request.setTimeout(timeoutMs, function () { request.destroy(new Error('网页请求超时')); });
    request.on('error', function (err) { if (!settled) { settled = true; reject(err); } });
    request.end();
  });
}

async function readWebResponse(response, maxBytes) {
  var declared = Number(response && response.headers && response.headers.get && response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('网页内容超过大小限制');
  if (!response || !response.body || typeof response.body.getReader !== 'function') {
    var buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error('网页内容超过大小限制');
    return buffer;
  }
  var reader = response.body.getReader();
  var chunks = [], total = 0;
  while (true) {
    var part = await reader.read();
    if (part.done) break;
    total += part.value ? part.value.byteLength : 0;
    if (total > maxBytes) { try { await reader.cancel(); } catch (_) {} throw new Error('网页内容超过大小限制'); }
    chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks, total);
}

function normalizeWebText(buffer, contentType) {
  var text = buffer.toString('utf8');
  if (/html/i.test(contentType || '')) {
    text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 120000);
}

async function fetchSafeWebPage(rawUrl, options) {
  options = options || {};
  var fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, code: 'WEB_FETCH_UNAVAILABLE', error: '服务器未配置网页抓取能力' };
  var lookupImpl = options.lookupImpl || dns.lookup;
  var current = String(rawUrl || '');
  for (var redirect = 0; redirect <= WEB_MAX_REDIRECTS; redirect++) {
    var safeTarget = await assertSafeWebUrl(current, lookupImpl);
    var parsed = safeTarget.parsed;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, options.timeoutMs || WEB_TIMEOUT_MS);
    var response;
    try {
      var requestHeaders = Object.assign({ Accept: 'text/html,application/xhtml+xml,text/plain,application/json' }, options.headers || {});
      response = options.fetchImpl ? await fetchImpl(parsed.toString(), { method: 'GET', redirect: 'manual', signal: controller.signal, headers: requestHeaders }) : await requestPinnedHttps(parsed, safeTarget.addresses, options.maxBytes || WEB_MAX_BYTES, options.timeoutMs || WEB_TIMEOUT_MS, requestHeaders);
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error('网页请求超时');
      throw new Error('网页请求失败');
    } finally { clearTimeout(timer); }
    if (response && response.status >= 300 && response.status < 400) {
      if (redirect === WEB_MAX_REDIRECTS) throw new Error('网页重定向次数过多');
      var location = response.headers && response.headers.get ? response.headers.get('location') : '';
      if (!location) throw new Error('网页重定向缺少目标');
      current = new URL(location, parsed).toString();
      continue;
    }
    if (!response || !response.ok) throw new Error('网页返回 HTTP ' + (response && response.status || 0));
    var body = await readWebResponse(response, options.maxBytes || WEB_MAX_BYTES);
    var contentType = response.headers && response.headers.get ? response.headers.get('content-type') || '' : '';
    return { ok: true, url: parsed.toString(), status: response.status, content_type: contentType.split(';')[0], bytes: body.length, content: normalizeWebText(body, contentType), truncated: body.length >= (options.maxBytes || WEB_MAX_BYTES) };
  }
  throw new Error('网页重定向失败');
}

function normalizeWebSearchResults(payload, maxResults) {
  var rows = payload && (payload.results || payload.organic || payload.web || payload.data && payload.data.results);
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, maxResults).map(function (item) {
    var published = item.published_at || item.publishedAt || item.date || item.published_time || null;
    return { title: String(item.title || item.name || '').slice(0, 240), url: String(item.url || item.link || item.href || '').slice(0, 2000), snippet: String(item.snippet || item.description || item.content || '').slice(0, 1000), source: String(item.source || 'web').slice(0, 80), published_at: published == null ? null : String(published).slice(0, 80) };
  }).filter(function (item) { try { var u = new URL(item.url); return u.protocol === 'https:' && !isBlockedWebHost(u.hostname) && hostAllowed(u.hostname); } catch (_) { return false; } });
}

async function searchWebForCode(query, maxResults, options) {
  options = options || {};
  if (typeof options.webSearch !== 'function') {
    return { ok: false, code: 'WEB_SEARCH_NOT_CONFIGURED', error: '网站联网搜索服务未接入，请检查服务器搜索供应商配置' };
  }
  var injected = await options.webSearch(String(query || '').slice(0, 240), Math.min(maxResults || 5, 10));
  if (injected && injected.error && !(Array.isArray(injected.results) && injected.results.length)) {
    return { ok: false, code: 'WEB_SEARCH_FAILED', error: '搜索失败，无法核实最新信息，请明确告知用户，禁止编造虚假信息或日期。' };
  }
  return { ok: true, query: String(query || '').slice(0, 240), results: normalizeWebSearchResults(injected, maxResults || 5), diagnostics: injected && injected.diagnostics ? injected.diagnostics : undefined, used_provider: injected && injected.used_provider ? injected.used_provider : null };
}

function parseToolArguments(toolCall) {
  var raw = toolCall && toolCall.function ? toolCall.function.arguments : '{}';
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function createCodeToolExecutor(scope, activePath, openFiles, attachments, trace, maxInputTokens, deps, runtimeCapabilities) {
  deps = deps || {};
  runtimeCapabilities = runtimeCapabilities || {};
  var overlay = new Map();
  openFiles.concat(attachments).forEach(function(file) { overlay.set(file.path, file); });
  var remainingTokens = Math.max(0, maxInputTokens);

  function record(name, args, startedAt, result) {
    var content = result && typeof result.content === 'string' ? result.content : '';
    var resultJson = (result && result.error) ? JSON.stringify({ error: result.error }) : JSON.stringify(result || {});
    var jsonBytes = Buffer.byteLength(resultJson, 'utf8');
    var tokens = codeIndex.estimateTokens(content || resultJson);
    var estimatedTokens = Math.max(tokens, Math.ceil(jsonBytes / 4)); // rough token estimate
    remainingTokens = Math.max(0, remainingTokens - estimatedTokens);
    var entry = {
      round: trace.length + 1,
      tool: name,
      args: args,
      ok: !!(result && result.ok !== false && !result.error),
      duration_ms: Date.now() - startedAt,
      context_tokens: tokens,
      result_bytes: jsonBytes,
      result_estimated_tokens: estimatedTokens
    };
    if (result && result.path) entry.path = result.path;
    if (result && (result.startLine || result.endLine)) entry.ranges = [[result.startLine || 1, result.endLine || result.startLine || 1]];
    if (result && Array.isArray(result.results)) {
      entry.files = result.results.map(function(item) { return { path: item.path, ranges: [[item.startLine || 1, item.endLine || item.startLine || 1]] }; });
    }
    if (result && result.error) entry.error = String(result.error).slice(0, 240);
    if (result && result.truncated === true) entry.truncated = true;
    if (result && typeof result.totalFiles === 'number') entry.totalFiles = result.totalFiles;
    trace.push(entry);
    console.log('[code-agent] tool', JSON.stringify(entry));
    return result;
  }

  function readPath(path, startLine, endLine) {
    if (!validatePath(path)) return { ok: false, error: '文件路径无效' };
    if (overlay.has(path)) return fileToToolResult(overlay.get(path), startLine, endLine);
    var range = codeIndex.readFileRange(scope, path, startLine || 1, endLine || 1000000);
    if (!range || !range.ok) return range;
    var actualStart = Array.isArray(range.lines) && range.lines.length ? range.lines[0].lineNum : range.startLine;
    var actualEnd = Array.isArray(range.lines) && range.lines.length ? range.lines[range.lines.length - 1].lineNum : actualStart;
    return {
      ok: true,
      path: path,
      sha256: range.sha256 || '',
      startLine: actualStart,
      endLine: actualEnd,
      totalLines: range.totalFileLines || actualEnd,
      content: Array.isArray(range.lines) ? range.lines.map(function(line) { return line.text; }).join('\n') : '',
      source: 'index'
    };
  }

  return async function executeCodeTool(toolCall) {
    var startedAt = Date.now();
    var name = toolCall && toolCall.function ? String(toolCall.function.name || '') : '';
    var args = parseToolArguments(toolCall);
    var result;
    if (remainingTokens < 1024 && name !== 'get_open_files') return record(name, args, startedAt, { ok: false, error: '本轮上下文预算已用完，请基于已读取内容回答' });
    if (name === 'list_files') {
      result = codeIndex.listFiles(scope, args.directory || '', Math.min(Math.max(Number(args.depth) || 3, 0), 8), args.pattern || '');
    } else if (name === 'search_code') {
      result = codeIndex.searchCode(scope, String(args.query || ''), { path: args.path || null, extensions: Array.isArray(args.extensions) ? args.extensions.slice(0, 20) : null, maxResults: Math.min(Math.max(Number(args.max_results) || 20, 1), 40) });
    } else if (name === 'read_file') {
      result = readPath(String(args.path || ''), 1, 1000000);
    } else if (name === 'read_file_range') {
      result = readPath(String(args.path || ''), Math.max(Number(args.start_line) || 1, 1), Math.min(Math.max(Number(args.end_line) || Number(args.start_line) || 1, 1), 1000000));
    } else if (name === 'get_symbols') {
      result = codeIndex.getFileSymbols(scope, String(args.path || ''));
    } else if (name === 'get_active_file') {
      result = activePath ? readPath(activePath, 1, 1000000) : { ok: false, error: '当前没有打开文件' };
    } else if (name === 'get_open_files') {
      result = { ok: true, activePath: activePath || '', files: openFiles.concat(attachments).map(function(file) { return { path: file.path, name: file.name, sha256: file.sha256, source: file.source, size: Buffer.byteLength(file.content || '', 'utf8') }; }) };
    } else if (name === 'get_runtime_capabilities') {
      result = {
        ok: true,
        provider: runtimeCapabilities.provider || 'deepseek',
        model: runtimeCapabilities.model || '服务器未声明',
        configured: runtimeCapabilities.configured === true,
        agentEnabled: runtimeCapabilities.agentEnabled === true,
        toolCallingEnabled: runtimeCapabilities.toolCallingEnabled === true,
        providerContextTokens: runtimeCapabilities.providerContextTokens || null,
        providerMaxOutputTokens: runtimeCapabilities.providerMaxOutputTokens || null,
        maxContextTokens: runtimeCapabilities.maxContextTokens || null,
        maxOutputTokens: runtimeCapabilities.maxOutputTokens || null,
        maxToolRounds: runtimeCapabilities.maxToolRounds || 8,
        thinkingMode: runtimeCapabilities.thinkingMode || 'off',
        inputBudgetTokens: typeof maxInputTokens === 'number' ? maxInputTokens : null,
        currentPromptTokens: runtimeCapabilities.currentPromptTokens || null,
        cacheHitTokens: runtimeCapabilities.cacheHitTokens || null,
        cacheMissTokens: runtimeCapabilities.cacheMissTokens || null,
        canReadCode: runtimeCapabilities.canReadCode !== false,
        canWriteCode: runtimeCapabilities.canWriteCode !== false,
        canCreateFiles: runtimeCapabilities.canCreateFiles !== false,
        canReadDocx: runtimeCapabilities.canReadDocx === true,
        canWriteDocx: runtimeCapabilities.canWriteDocx === true,
        canReadXlsx: runtimeCapabilities.canReadXlsx === true,
        canWriteXlsx: runtimeCapabilities.canWriteXlsx === true,
        canReadPdf: runtimeCapabilities.canReadPdf === true,
        canWritePdf: runtimeCapabilities.canWritePdf === true,
        canReadPptx: runtimeCapabilities.canReadPptx === true,
        canWritePptx: runtimeCapabilities.canWritePptx === true,
        workspaceReadOnly: runtimeCapabilities.workspaceReadOnly === true
      };
    } else if (name === 'web_search') {
      result = await searchWebForCode(String(args.query || ''), Math.min(Math.max(Number(args.max_results) || 5, 1), 10), {
        webSearch: deps.webSearch,
        fetchImpl: deps.fetchImpl,
        lookupImpl: deps.lookupImpl
      });
    } else if (name === 'fetch_web_page') {
      try {
        result = await fetchSafeWebPage(String(args.url || ''), { fetchImpl: deps.fetchImpl, lookupImpl: deps.lookupImpl });
      } catch (error) {
        result = { ok: false, code: 'WEB_FETCH_FAILED', error: error && error.message ? error.message : '网页抓取失败' };
      }
    } else {
      result = { ok: false, error: '不支持的工具: ' + name };
    }
    return record(name, args, startedAt, result || { ok: false, error: '工具无响应' });
  };
}

var pdfParser = null, mammothParser = null, xlsxParser = null;
var pdfParserLoaded = false, mammothParserLoaded = false, xlsxParserLoaded = false;

function loadFileParser(name) {
  try { return require(name); } catch(e) { console.warn('[code-agent] ' + name + ' not available'); return null; }
}

function getPdfParser() {
  if (!pdfParserLoaded) { pdfParser = loadFileParser('pdf-parse'); pdfParserLoaded = true; }
  return pdfParser;
}

async function parsePdfBuffer(buffer) {
  var library = getPdfParser();
  if (!library) throw new Error('PDF 解析库不可用');
  // pdf-parse v1 exported a callable function; v2 exports PDFParse.
  if (typeof library === 'function') return library(buffer);
  if (typeof library.PDFParse !== 'function') throw new Error('PDF 解析库版本不兼容');
  var parser = new library.PDFParse({ data: new Uint8Array(buffer) });
  try {
    var result = await parser.getText();
    return {
      text: result && result.text || '',
      numpages: result && Number(result.total) || 0,
      info: {}
    };
  } finally {
    try { await parser.destroy(); } catch (_) {}
  }
}

function getMammothParser() {
  if (!mammothParserLoaded) { mammothParser = loadFileParser('mammoth'); mammothParserLoaded = true; }
  return mammothParser;
}

function getXlsxParser() {
  if (!xlsxParserLoaded) { xlsxParser = loadFileParser('xlsx'); xlsxParserLoaded = true; }
  return xlsxParser;
}

function getExtFromMime(mimeType) {
  var map = {
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/vnd.ms-excel': '.xls',
    'text/csv': '.csv',
    'text/plain': '.txt'
  };
  return map[mimeType] || '';
}

function detectMimeFromFileName(fileName) {
  var lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.json')) return 'text/plain';
  return 'application/octet-stream';
}

async function validateOfficeArchive(buffer, kind) {
  var JSZip = require('jszip');
  var zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (_) {
    throw new Error(String(kind || 'Office').toUpperCase() + ' 文件结构无效');
  }
  var names = Object.keys(zip.files);
  if (names.length > MAX_OFFICE_ARCHIVE_ENTRIES) {
    throw new Error('Office 文档内部文件数量过多');
  }
  var uncompressedBytes = 0;
  for (var i = 0; i < names.length; i++) {
    var entry = zip.files[names[i]];
    if (entry && entry._data && Number(entry._data.uncompressedSize)) {
      uncompressedBytes += Number(entry._data.uncompressedSize);
      if (uncompressedBytes > MAX_OFFICE_UNCOMPRESSED_BYTES) {
        throw new Error('Office 文档解压后内容过大');
      }
    }
  }
  var required = kind === 'docx'
    ? 'word/document.xml'
    : (kind === 'xlsx' ? 'xl/workbook.xml' : null);
  if (required && !zip.files[required]) {
    throw new Error(String(kind || 'Office').toUpperCase() + ' 文件结构无效');
  }
  if (kind === 'pptx' && !names.some(function(name) { return /^ppt\/slides\/slide\d+\.xml$/i.test(name); })) {
    throw new Error('PPTX 文件中没有可读取的幻灯片');
  }
  return zip;
}

async function extractDocumentText(buffer, mimeType, fileName) {
  var text = '';
  var metadata = {};

  try {
    if (mimeType === 'application/pdf' && getPdfParser()) {
      if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('PDF 文件结构无效');
      var pdfData = await parsePdfBuffer(buffer);
      if ((pdfData.numpages || 0) > MAX_PDF_PAGES) throw new Error('PDF 页数超过 ' + MAX_PDF_PAGES + ' 页');
      text = pdfData.text || '';
      metadata = { pages: pdfData.numpages || 0, info: pdfData.info || {} };
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && getMammothParser()
    ) {
      await validateOfficeArchive(buffer, 'docx');
      var mammothResult = await mammothParser.extractRawText({ buffer: buffer });
      text = mammothResult.value || '';
      metadata = mammothResult.messages || [];
    } else if (
      (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
       mimeType === 'application/vnd.ms-excel') && getXlsxParser()
    ) {
      if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
        await validateOfficeArchive(buffer, 'xlsx');
      } else {
        var xlsMagic = buffer.subarray(0, 8).toString('hex');
        if (xlsMagic !== 'd0cf11e0a1b11ae1') throw new Error('XLS 文件结构无效');
      }
      var workbook = xlsxParser.read(buffer, { type: 'buffer' });
      if (workbook.SheetNames.length > MAX_WORKBOOK_SHEETS) throw new Error('工作表数量超过 ' + MAX_WORKBOOK_SHEETS + ' 个');
      var sheets = [];
      metadata = { sheetNames: workbook.SheetNames, sheetCount: workbook.SheetNames.length };
      workbook.SheetNames.forEach(function(sName) {
        var sheet = workbook.Sheets[sName];
        var csv = xlsxParser.utils.sheet_to_csv(sheet, { blankrows: false });
        sheets.push('【工作表: ' + sName + '】\n' + csv);
      });
      text = sheets.join('\n\n');
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ) {
      await validateOfficeArchive(buffer, 'pptx');
      var pptxResult = await extractPptxText(buffer);
      text = pptxResult.text;
      metadata = pptxResult.metadata;
    } else if (mimeType === 'text/csv' || mimeType === 'text/plain') {
      if (buffer.includes(0)) throw new Error('文本文件包含二进制内容');
      text = buffer.toString('utf-8');
    } else {
      return { ok: false, error: '不支持的文件类型: ' + (mimeType || '未知') + '（支持 PDF、DOCX、XLSX、XLS、PPTX、CSV、TXT、MD）' };
    }
  } catch (e) {
    console.error('[code-agent] Document extraction error:', e && e.message ? e.message : e);
    return { ok: false, error: '文档解析失败: ' + (e.message || '') };
  }

  return { ok: true, text: text, metadata: metadata };
}

async function extractPptxText(buffer) {
  var JSZip = require('jszip');
  var slides = [];
  var slideNames = [];

  try {
    var zip = await JSZip.loadAsync(buffer);
    var zipEntries = Object.keys(zip.files);
    if (zipEntries.length > MAX_PPTX_ENTRIES) throw new Error('PPTX 内部文件数量过多');
    var uncompressedBytes = 0;
    zipEntries.forEach(function(name) {
      var entry = zip.files[name];
      if (entry && entry._data && Number(entry._data.uncompressedSize)) uncompressedBytes += Number(entry._data.uncompressedSize);
    });
    if (uncompressedBytes > MAX_PPTX_UNCOMPRESSED_BYTES) throw new Error('PPTX 解压后内容过大');
    var slideFiles = [];
    zip.folder("ppt/slides").forEach(function (relativePath, file) {
      if (relativePath.match(/^slide\d+\.xml$/i)) {
        slideFiles.push(file);
      }
    });

    for (var i = 0; i < slideFiles.length; i++) {
      var file = slideFiles[i];
      var slideNum = file.name.match(/slide(\d+)\.xml/i);
      var slideLabel = slideNum ? '第' + slideNum[1] + '页' : file.name;

      var xml = await file.async("string");
      var textParts = [];
      var textRegex = /<a:t[^>]*>([^<]*)<\/a:t>/g;
      var match;
      while ((match = textRegex.exec(xml)) !== null) {
        var t = match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
        if (t.trim()) textParts.push(t);
      }

      if (textParts.length > 0) {
        slideNames.push(slideLabel);
        slides.push('【幻灯片: ' + slideLabel + '】\n' + textParts.join('\n'));
      }
    }
  } catch (e) {
    console.error('[code-agent] PPTX extraction error:', e.message);
    throw e;
  }

  if (slides.length === 0) {
    return { text: '[无法从PPTX中提取文本内容]', metadata: { slideCount: 0 } };
  }

  return {
    text: slides.join('\n\n'),
    metadata: { slideCount: slides.length, slideNames: slideNames }
  };
}

// ── XLSX modification operations ──────────────────────────────────────
var CELL_REF_RE = /^[A-Z]{1,3}[1-9]\d{0,6}$/;
var MAX_DOC_OPS = 50;
var MAX_CELL_VALUE_LEN = 32767;
var MAX_SHEET_NAME_LEN = 31;
var SHEET_NAME_FORBIDDEN = /[\\\/\?\*\[\]:]/;

function validateCellRef(cell) {
  if (!cell || typeof cell !== 'string') return false;
  var upper = cell.toUpperCase().trim();
  if (!CELL_REF_RE.test(upper)) return false;
  var colMatch = upper.match(/^([A-Z]{1,3})/);
  if (!colMatch) return false;
  var col = colMatch[1];
  if (col.length === 3) {
    if (col > 'XFD') return false;
  }
  var rowMatch = upper.match(/(\d+)$/);
  if (!rowMatch) return false;
  var row = parseInt(rowMatch[1], 10);
  if (row < 1 || row > 1048576) return false;
  return true;
}

function validateSheetName(name) {
  if (!name || typeof name !== 'string') return false;
  var trimmed = name.trim();
  if (!trimmed.length || trimmed.length > MAX_SHEET_NAME_LEN) return false;
  if (SHEET_NAME_FORBIDDEN.test(trimmed)) return false;
  if (trimmed === '__proto__' || trimmed === 'constructor' || trimmed === 'prototype') return false;
  return true;
}

function updateSheetRef(workbook, sheetName, xlsx) {
  try {
    var sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    var range = xlsx.utils.decode_range(sheet['!ref'] || 'A1');
    var keys = Object.keys(sheet).filter(function(k) { return k.charAt(0) !== '!'; });
    var maxR = range.e.r, maxC = range.e.c;
    for (var i = 0; i < keys.length; i++) {
      var addr = xlsx.utils.decode_cell(keys[i]);
      if (addr.r > maxR) maxR = addr.r;
      if (addr.c > maxC) maxC = addr.c;
    }
    sheet['!ref'] = xlsx.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  } catch (e) { /* ignore range update errors */ }
}

async function applyXlsxOperations(buffer, operations, fileName) {
  var xlsx = getXlsxParser();
  if (!xlsx) return { ok: false, error: 'XLSX 解析库不可用' };

  if (operations.length > MAX_DOC_OPS) {
    return { ok: false, error: '单次最多支持 ' + MAX_DOC_OPS + ' 个修改操作' };
  }

  var workbook, beforeText, afterText, appliedOps = [], changes = [];

  try {
    workbook = xlsx.read(buffer, { type: 'buffer' });

    var beforeParts = [];
    workbook.SheetNames.forEach(function(sName) {
      var sheet = workbook.Sheets[sName];
      var csv = xlsx.utils.sheet_to_csv(sheet, { blankrows: false });
      beforeParts.push('【工作表: ' + sName + '】\n' + csv);
    });
    beforeText = beforeParts.join('\n\n');

    for (var i = 0; i < operations.length; i++) {
      var op = operations[i];
      if (!op || typeof op !== 'object') continue;

      try {
        if (op.type === 'cell_update') {
          var sheetName = op.sheet || workbook.SheetNames[0];
          var cell = (op.cell || '').toUpperCase().trim();
          var value = op.value !== undefined ? op.value : '';

          if (!validateSheetName(sheetName)) {
            changes.push({ type: 'cell_update', sheet: sheetName, cell: cell || '(empty)', error: '无效的工作表名称' });
            continue;
          }

          if (!validateCellRef(cell)) {
            changes.push({ type: 'cell_update', sheet: sheetName, cell: cell || '(empty)', error: '无效的单元格地址' });
            continue;
          }

          var strValue = String(value);
          if (strValue.length > MAX_CELL_VALUE_LEN) {
            changes.push({ type: 'cell_update', sheet: sheetName, cell: cell, error: '单元格值超过最大长度 ' + MAX_CELL_VALUE_LEN });
            continue;
          }

          if (!workbook.Sheets[sheetName]) {
            if (op.create_sheet) {
              workbook.SheetNames.push(sheetName);
              workbook.Sheets[sheetName] = {};
            } else {
              changes.push({ type: 'cell_update', sheet: sheetName, cell: cell, error: '工作表不存在' });
              continue;
            }
          }

          var oldValue = '';
          if (workbook.Sheets[sheetName][cell]) {
            oldValue = String(workbook.Sheets[sheetName][cell].v || '');
          }

          if (typeof value === 'string' && value.startsWith('=')) {
            workbook.Sheets[sheetName][cell] = { t: 'n', f: value.slice(1) };
          } else if (typeof value === 'number') {
            workbook.Sheets[sheetName][cell] = { t: 'n', v: value };
          } else {
            workbook.Sheets[sheetName][cell] = { t: 's', v: String(value) };
          }

          updateSheetRef(workbook, sheetName, xlsx);

          appliedOps.push({ type: 'cell_update', sheet: sheetName, cell: cell, oldValue: oldValue, newValue: String(value) });
          changes.push({ type: 'cell_update', sheet: sheetName, cell: cell, old: oldValue, new: String(value) });
        } else if (op.type === 'cell_delete') {
          var sName = op.sheet || workbook.SheetNames[0];
          var cellRef = (op.cell || '').toUpperCase().trim();
          if (!validateCellRef(cellRef)) {
            changes.push({ type: 'cell_delete', sheet: sName, cell: cellRef || '(empty)', error: '无效的单元格地址' });
            continue;
          }
          if (workbook.Sheets[sName] && workbook.Sheets[sName][cellRef]) {
            var oldVal = String(workbook.Sheets[sName][cellRef].v || '');
            delete workbook.Sheets[sName][cellRef];
            appliedOps.push({ type: 'cell_delete', sheet: sName, cell: cellRef, oldValue: oldVal });
            changes.push({ type: 'cell_delete', sheet: sName, cell: cellRef, old: oldVal });
          }
        } else if (op.type === 'sheet_add') {
          var newSheetName = op.sheet || ('Sheet' + (workbook.SheetNames.length + 1));
          if (!validateSheetName(newSheetName)) {
            changes.push({ type: 'sheet_add', sheet: newSheetName, error: '无效的工作表名称' });
            continue;
          }
          if (workbook.SheetNames.indexOf(newSheetName) === -1) {
            workbook.SheetNames.push(newSheetName);
            workbook.Sheets[newSheetName] = {};
            appliedOps.push({ type: 'sheet_add', sheet: newSheetName });
            changes.push({ type: 'sheet_add', sheet: newSheetName });
          } else {
            changes.push({ type: 'sheet_add', sheet: newSheetName, error: '工作表名称重复' });
          }
        } else if (op.type === 'sheet_rename') {
          var oldName = op.sheet || '';
          var newName = op.new_name || '';
          if (!validateSheetName(newName)) {
            changes.push({ type: 'sheet_rename', old: oldName, new: newName, error: '无效的工作表名称' });
            continue;
          }
          var idx = workbook.SheetNames.indexOf(oldName);
          if (idx >= 0 && newName && workbook.SheetNames.indexOf(newName) === -1) {
            workbook.SheetNames[idx] = newName;
            workbook.Sheets[newName] = workbook.Sheets[oldName];
            delete workbook.Sheets[oldName];
            appliedOps.push({ type: 'sheet_rename', sheet: oldName, newName: newName });
            changes.push({ type: 'sheet_rename', old: oldName, new: newName });
          } else {
            changes.push({ type: 'sheet_rename', old: oldName, new: newName, error: '工作表名称重复或不存在' });
          }
        }
      } catch (opErr) {
        changes.push({ type: op.type, error: opErr.message || '操作失败' });
      }
    }

    var afterParts = [];
    workbook.SheetNames.forEach(function(sName) {
      var sheet = workbook.Sheets[sName];
      var csv = xlsx.utils.sheet_to_csv(sheet, { blankrows: false });
      afterParts.push('【工作表: ' + sName + '】\n' + csv);
    });
    afterText = afterParts.join('\n\n');

    if (appliedOps.length === 0 && operations.length > 0) {
      var errMsgs = changes.map(function(c) { return c.error || '未生效'; }).join('; ');
      return { ok: false, error: 'XLSX 修改失败，无任何操作生效: ' + errMsgs };
    }

    var newBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    try {
      var verifyWorkbook = xlsx.read(newBuffer, { type: 'buffer' });
      if (!verifyWorkbook || !verifyWorkbook.SheetNames) {
        return { ok: false, error: 'XLSX 生成验证失败：无法重新打开文件' };
      }
      for (var v = 0; v < appliedOps.length; v++) {
        var aop = appliedOps[v];
        if (aop.type === 'cell_update') {
          var verifySheet = verifyWorkbook.Sheets[aop.sheet];
          if (!verifySheet) {
            return { ok: false, error: 'XLSX 生成验证失败：工作表 ' + aop.sheet + ' 不存在' };
          }
          if (!verifySheet[aop.cell]) {
            return { ok: false, error: 'XLSX 生成验证失败：单元格 ' + aop.cell + ' 不存在' };
          }
        }
      }
    } catch (ve) {
      return { ok: false, error: 'XLSX 生成验证失败: ' + (ve.message || '') };
    }

    return {
      ok: true,
      newBuffer: newBuffer,
      changes: changes,
      newMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: fileName,
      beforeText: beforeText,
      afterText: afterText,
      appliedOps: appliedOps
    };
  } catch (e) {
    return { ok: false, error: 'XLSX 修改失败: ' + (e.message || '') };
  }
}

// ── Main route registration ────────────────────────────────────────────

module.exports = function registerCodeAgentRoutes(app, deps) {
  var supabase = deps.supabase;
  var rateLimit = deps.rateLimit;
  var authenticateUser = deps.authenticateUser;
  var sanitizeError = deps.sanitizeError;

  var multer = require('multer');
  var upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DOCUMENT_UPLOAD_BYTES, files: 1, fields: 10 } });
  function documentUpload(req, res, next) {
    upload.single('file')(req, res, function(err) {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, code: 'FILE_TOO_LARGE', error: '文件过大，最大支持 20MB' });
      return res.status(400).json({ ok: false, code: 'INVALID_UPLOAD', error: '文件上传格式无效' });
    });
  }

  // ── Phase 3: Stream abort controller registry ──────────────────────
  // Track active stream controllers so cancel requests can abort them.
  var streamAbortControllers = new Map();

  // ── Document text extraction ────────────────────────────────────────
    app.post('/api/code/document/extract', rateLimit(60000, 30), authenticateUser, documentUpload, async function(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: '缺少文件数据' });
      }

      var buffer = req.file.buffer;
      var mimeType = req.body.mimeType || req.file.mimetype || '';
      var fileName = req.body.fileName || req.file.originalname || '';
      var detectedMime = detectMimeFromFileName(fileName);

      if (/\.doc$/i.test(fileName) || mimeType === 'application/msword') {
        return res.status(415).json({ ok: false, code: 'LEGACY_DOC_UNSUPPORTED', error: '暂不支持旧版 DOC，请先另存为 DOCX 后上传' });
      }

      if (detectedMime && detectedMime !== 'application/octet-stream') mimeType = detectedMime;

      if (!mimeType) {
        return res.status(400).json({ ok: false, error: '无法识别文件类型' });
      }

      if (buffer.length > MAX_DOCUMENT_UPLOAD_BYTES) {
        return res.status(413).json({ ok: false, error: '文件过大，最大支持 20MB' });
      }

      var extractResult = await extractDocumentText(buffer, mimeType, fileName);
      if (!extractResult.ok) {
        var unsupported = /^不支持的文件类型/.test(extractResult.error || '');
        return res.status(unsupported ? 415 : 422).json({ ok: false, error: extractResult.error });
      }

      var text = extractResult.text;
      var truncated = false;
      if (text.length > MAX_EXTRACTED_TEXT_CHARS) {
        text = text.slice(0, MAX_EXTRACTED_TEXT_CHARS) + '\n\n[内容过长，已截断]';
        truncated = true;
      }

      return res.json({
        ok: true,
        text: text,
        truncated: truncated,
        textLength: text.length,
        metadata: extractResult.metadata,
        fileName: fileName,
        mimeType: mimeType,
        ext: getExtFromMime(mimeType)
      });
    } catch (err) {
      console.error('[code-agent] Document extract error:', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: sanitizeError ? sanitizeError(err) : '文档提取失败' });
    }
  });

  // ── Document modification (apply AI operations) ──────────────────────
    app.post('/api/code/document/apply', rateLimit(60000, 15), authenticateUser, documentUpload, async function(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: '缺少文件数据' });
      }

      var buffer = req.file.buffer;
      var mimeType = req.body.mimeType || req.file.mimetype || '';
      var fileName = req.body.fileName || req.file.originalname || '';
      var documentType = req.body.documentType || '';

      var operations;
      try {
        operations = JSON.parse(req.body.operations || '[]');
      } catch (e) {
        return res.status(400).json({ ok: false, error: '修改操作数据无效' });
      }

      if (!Array.isArray(operations) || operations.length === 0) {
        return res.status(400).json({ ok: false, error: '未提供修改操作' });
      }

      if (buffer.length > MAX_DOCUMENT_UPLOAD_BYTES) {
        return res.status(413).json({ ok: false, error: '文件过大，最大支持 20MB' });
      }

      var result;
      if (documentType === 'xlsx' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || mimeType === 'application/vnd.ms-excel') {
        result = await applyXlsxOperations(buffer, operations, fileName);
      } else {
        return res.status(400).json({ ok: false, error: '不支持修改此类型文档 (' + (documentType || mimeType) + ')' });
      }

      if (!result.ok) {
        return res.status(500).json({ ok: false, error: result.error });
      }

      var newBuffer = result.newBuffer;
      if (!newBuffer || !Buffer.isBuffer(newBuffer)) {
        return res.status(500).json({ ok: false, error: '生成文件失败' });
      }

      var outFileName = fileName.replace(/\.[^.]+$/, '') + '_AI修改版.xlsx';

      res.setHeader('Content-Type', result.newMimeType);
      res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(outFileName) + '"');
      res.setHeader('X-Document-Changes', encodeURIComponent(JSON.stringify({ changes: result.changes || [], appliedOps: result.appliedOps || [] })));

      return res.send(newBuffer);
    } catch (err) {
      console.error('[code-agent] Document apply error:', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: sanitizeError ? sanitizeError(err) : '文档修改应用失败' });
    }
  });

  // ── Phase 1: Project Index Build ────────────────────────────────────
  app.post('/api/code/index/build', rateLimit(60000, 10), authenticateUser, async function(req, res) {
    try {
      var body = req.body;
      if (!body || !body.files || !Array.isArray(body.files)) {
        return res.status(400).json({ ok: false, error: '缺少文件列表' });
      }

      var scopeResult = validateWorkspaceScope(req, {
        workspace_id: body.workspaceId || body.workspace_id || 'default',
        workspace_generation: body.workspaceGeneration === undefined ? body.workspace_generation : body.workspaceGeneration
      });
      if (!scopeResult.ok) return res.status(400).json({ ok: false, error: scopeResult.error });
      var useBatches = body.append === true || body.batch === true || body.finalize === true;
      var result = useBatches
        ? codeIndex.appendIndexBatch(scopeResult.value, body.files, {
          finalize: body.finalize === true,
          reset: body.reset === true || body.batchIndex === 0,
          truncated: body.truncated === true
        })
        : codeIndex.buildIndex(scopeResult.value, body.files, { truncated: body.truncated === true });

      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      if (result.status !== 'building') {
        console.log('[code-agent] Index built: ' + result.totalFiles + ' files, ' + result.totalChunks + ' chunks');
        // Phase 4: Persist to DB (fire-and-forget, non-blocking)
        if (result.status === 'ready' && supabase) {
          var resolved = codeIndex._resolveIndexForPersistence(scopeResult.value);
          if (resolved && resolved.ok && resolved.index) {
            codeIndex.persistIndexToDB(supabase, scopeResult.value.userId, scopeResult.value.workspaceId, resolved.index)
              .catch(function(e) { console.error('[code-agent] DB persist failed (non-blocking):', e.message); });
          }
        }
      }

      return res.json({
        ok: true,
        totalFiles: result.totalFiles,
        totalChunks: result.totalChunks,
        builtAt: result.builtAt,
        workspaceId: result.workspaceId,
        generation: result.generation,
        scannedFiles: result.scannedFiles,
        indexedFiles: result.indexedFiles,
        skippedFiles: result.skippedFiles || 0,
        failedFiles: result.failedFiles || 0,
        truncated: result.truncated === true,
        status: result.status,
        totalBytes: result.totalBytes || 0,
        batchComplete: result.batchComplete === true,
        finalizeRequired: result.finalizeRequired === true
      });
    } catch (err) {
      console.error('[code-agent] Index build error:', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: sanitizeError ? sanitizeError(err) : '索引构建失败' });
    }
  });

  // ── Phase 1: Project Index Status ───────────────────────────────────
  app.post('/api/code/index/status', rateLimit(60000, 30), authenticateUser, async function(req, res) {
    try {
      var body = req.body || {};
      var scopeResult = validateWorkspaceScope(req, body);
      if (!scopeResult.ok) return res.status(400).json({ ok: false, error: scopeResult.error });
      var summary = codeIndex.getIndexSummary(scopeResult.value);
      var pinnedFiles = codeIndex.getPinnedFiles(scopeResult.value);

      // Phase 4: Try DB recovery if no in-memory index
      var recovered = null;
      if (!summary && supabase) {
        try {
          recovered = await codeIndex.recoverIndexFromDB(supabase, scopeResult.value, scopeResult.value.workspaceId);
          if (recovered && recovered.ok) {
            summary = recovered.summary || codeIndex.getIndexSummary(scopeResult.value);
          }
        } catch (e) { /* DB recovery is best-effort */ }
      }

      return res.json({
        ok: true,
        summary: summary,
        pinnedFiles: pinnedFiles,
        rebuildRequired: !summary,
        recovered: !!(recovered && recovered.ok)
      });
    } catch (err) {
      console.error('[code-agent] Index status error:', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: sanitizeError ? sanitizeError(err) : '索引状态查询失败' });
    }
  });

  // ── Phase 4: Manifest comparison endpoint ───────────────────────────
  app.post('/api/code/index/manifest', rateLimit(60000, 30), authenticateUser, async function(req, res) {
    try {
      var body = req.body || {};
      var scopeResult = validateWorkspaceScope(req, body);
      if (!scopeResult.ok) return res.status(400).json({ ok: false, error: scopeResult.error });

      var files = Array.isArray(body.files) ? body.files : [];
      if (files.length === 0) {
        return res.status(400).json({ ok: false, error: '缺少文件清单' });
      }

      // Validate manifest entries
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        if (!f || typeof f.path !== 'string' || !f.path) {
          return res.status(400).json({ ok: false, error: '清单文件缺少 path' });
        }
      }

      var persistentIndexMod = null;
      try { persistentIndexMod = require('./ai-core/persistent-index'); } catch (e) {}

      if (!persistentIndexMod || !persistentIndexMod.isPersistEnabled() || !supabase) {
        // Persistence not enabled, return all files for upload
        return res.json({
          ok: true,
          upload_paths: files.map(function(f) { return f.path; }),
          unchanged_paths: [],
          delete_paths: [],
          rebuild_required: false,
          persist_enabled: false
        });
      }

      var workspaceKey = persistentIndexMod.generateWorkspaceKey(
        scopeResult.value.userId, 'local_folder', scopeResult.value.workspaceId
      );
      var ws = await persistentIndexMod.getWorkspace(supabase, scopeResult.value.userId, workspaceKey);

      if (!ws) {
        // No workspace found, full upload needed
        return res.json({
          ok: true,
          upload_paths: files.map(function(f) { return f.path; }),
          unchanged_paths: [],
          delete_paths: [],
          rebuild_required: true,
          persist_enabled: true
        });
      }

      var manifest = await persistentIndexMod.compareManifest(supabase, ws.id, files.map(function(f) {
        return {
          path: f.path,
          size: f.size || 0,
          modifiedAt: f.modified_at || f.modifiedAt || null,
          sha256: f.sha256 || ''
        };
      }));

      return res.json({
        ok: true,
        upload_paths: manifest.uploadPaths || [],
        unchanged_paths: manifest.unchangedPaths || [],
        delete_paths: manifest.deletePaths || [],
        rebuild_required: manifest.rebuildRequired === true,
        persist_enabled: true,
        workspace_id: ws.id,
        workspace_generation: body.workspace_generation || ws.generation
      });
    } catch (err) {
      console.error('[code-agent] Manifest error:', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: sanitizeError ? sanitizeError(err) : '清单比较失败' });
    }
  });

  // ── Phase 1: Agent Tool - list_files ────────────────────────────────
  app.post('/api/code/agent/list_files', rateLimit(60000, 30), authenticateUser, async function(req, res) {
    try {
      var body = req.body || {};
      var scopeResult = validateWorkspaceScope(req, body);
      if (!scopeResult.ok) return res.status(400).json({ ok: false, error: scopeResult.error });
      var result = codeIndex.listFiles(scopeResult.value, body.directory, body.depth, body.pattern);
      return res.json(result);
    } catch (err) {
      console.error('[code-agent] list_files error:', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: sanitizeError ? sanitizeError(err) : '文件列表获取失败' });
    }
  });

  // ── Phase 1: Agent Tool - search_code ───────────────────────────────
  app.post('/api/code/agent/search_code', rateLimit(60000, 30), authenticateUser, async function(req, res) {
    try {
      var body = req.body || {};
      if (!body.query) {
        return res.status(400).json({ ok: false, error: '缺少查询关键词' });
      }
      var scopeResult = validateWorkspaceScope(req, body);
      if (!scopeResult.ok) return res.status(400).json({ ok: false, error: scopeResult.error });
      var result = codeIndex.searchCode(scopeResult.value, body.query, {
        path: body.path,
        extensions: body.extensions,
        maxResults: body.maxResults || 20
      });
      return res.json(result);
    } catch (err) {
      console.error('[code-agent] search_code error:', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: sanitizeError ? sanitizeError(err) : '代码搜索失败' });
    }
  });

  // ── Phase 1: Agent Tool - read_file ─────────────────────────────────
  app.post('/api/code/agent/read_file', rateLimit(60000, 30), authenticateUser, async function(req, res) {
    try {
      var body = req.body || {};
      if (!body.path) {
        return res.status(400).json({ ok: false, error: '缺少文件路径' });
      }
      var scopeResult = validateWorkspaceScope(req, body);
      if (!scopeResult.ok) return res.status(400).json({ ok: false, error: scopeResult.error });
      var result = codeIndex.readFileRange(scopeResult.value, body.path, body.startLine || 1, body.endLine || 999999);
      return res.json(result);
    } catch (err) {
      console.error('[code-agent] read_file error:', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: sanitizeError ? sanitizeError(err) : '文件读取失败' });
    }
  });

  // ── Phase 1: Agent Tool - get_symbols ───────────────────────────────
  app.post('/api/code/agent/get_symbols', rateLimit(60000, 30), authenticateUser, async function(req, res) {
    try {
      var body = req.body || {};
      if (!body.path) {
        return res.status(400).json({ ok: false, error: '缺少文件路径' });
      }
      var scopeResult = validateWorkspaceScope(req, body);
      if (!scopeResult.ok) return res.status(400).json({ ok: false, error: scopeResult.error });
      var result = codeIndex.getFileSymbols(scopeResult.value, body.path);
      return res.json(result);
    } catch (err) {
      console.error('[code-agent] get_symbols error:', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: sanitizeError ? sanitizeError(err) : '符号获取失败' });
    }
  });

  // ── Phase 1: Agent Tool - pin_file ──────────────────────────────────
  app.post('/api/code/agent/pin_file', rateLimit(60000, 30), authenticateUser, async function(req, res) {
    try {
      var body = req.body || {};
      if (!body.path) {
        return res.status(400).json({ ok: false, error: '缺少文件路径' });
      }
      var scopeResult = validateWorkspaceScope(req, body);
      if (!scopeResult.ok) return res.status(400).json({ ok: false, error: scopeResult.error });
      var result = codeIndex.pinFile(scopeResult.value, body.path, body.pinned !== false);
      return res.json(result);
    } catch (err) {
      console.error('[code-agent] pin_file error:', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: sanitizeError ? sanitizeError(err) : '文件固定失败' });
    }
  });

  // ── Phase 1: Agent Tool - clear_index ───────────────────────────────
  app.post('/api/code/agent/clear_index', rateLimit(60000, 10), authenticateUser, async function(req, res) {
    try {
      var scopeResult = validateWorkspaceScope(req, req.body || {});
      if (!scopeResult.ok) return res.status(400).json({ ok: false, error: scopeResult.error });
      var result = codeIndex.clearIndex(scopeResult.value);
      return res.json(result);
    } catch (err) {
      console.error('[code-agent] clear_index error:', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: sanitizeError ? sanitizeError(err) : '索引清除失败' });
    }
  });

  app.get('/api/code/capabilities', rateLimit(60000, 60), authenticateUser, function(req, res) {
    return res.json(Object.assign({ ok: true }, buildCodeCapabilities(deps)));
  });

  // ── Code chat: a real DeepSeek tool-calling agent ───────────────────
  app.post('/api/code/chat', rateLimit(60000, 20), authenticateUser, async function(req, res) {
    var aborted = false;
    var requestController = new AbortController();
    var requestId = 'req_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 8);
    var requestStartTime = Date.now();
    var requestPhase = 'init';
    function abortRequest() {
      aborted = true;
      try { requestController.abort(); } catch (_) {}
    }
    req.once('aborted', abortRequest);
    res.once('close', function() { if (!res.writableEnded) abortRequest(); });

    function logPhase(phase, extra) {
      requestPhase = phase;
      var logObj = {
        requestId: requestId,
        phase: phase,
        elapsedMs: Date.now() - requestStartTime
      };
      if (extra) Object.keys(extra).forEach(function(k) { logObj[k] = extra[k]; });
      console.log('[code-agent] ' + JSON.stringify(logObj));
    }

    function sendError(code, message, status, extra) {
      extra = extra || {};
      var body = {
        ok: false,
        code: code,
        error: message,
        requestId: requestId,
        phase: requestPhase
      };
      if (extra.retryable !== undefined) body.retryable = extra.retryable;
      if (extra.tool_trace && Array.isArray(extra.tool_trace)) body.tool_trace = extra.tool_trace;
      logPhase('error_response', { errorCode: code, errorMessage: message, httpStatus: status });
      return res.status(status).json(body);
    }

    try {
      var body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return sendError('INVALID_REQUEST', '请求无效', 400);

      var msgResult = validateString(body.message, MAX_MESSAGE_LEN, '消息内容');
      if (!msgResult.ok) return sendError('INVALID_MESSAGE', msgResult.error, 400);
      if (!msgResult.value) return sendError('EMPTY_MESSAGE', '消息内容不能为空', 400);
      var message = msgResult.value;

      var wsResult = validateString(body.workspace_name, 200, '工作区名称');
      if (!wsResult.ok) return sendError('INVALID_WORKSPACE', wsResult.error, 400);
      var workspaceName = wsResult.value || '';
      var scopeResult = validateWorkspaceScope(req, body);
      if (!scopeResult.ok) return sendError('INVALID_WORKSPACE_SCOPE', scopeResult.error, 400);
      var scope = scopeResult.value;

      var apResult = validateString(body.active_path, 500, '当前路径');
      if (!apResult.ok) return sendError('INVALID_PATH', apResult.error, 400);
      var activePath = apResult.value || '';
      if (activePath && !validatePath(activePath)) return sendError('INVALID_PATH', '当前路径无效', 400);

      var histResult = validateHistory(body.history);
      if (!histResult.ok) return sendError('INVALID_HISTORY', histResult.error, 400);
      var history = histResult.value;

      var conversationId = String(body.conversation_id || '').trim();
      var sessionData = null;
      if (conversationId) {
        sessionData = getSession(scope.userId, scope.workspaceId, scope.generation, conversationId);
        if (!sessionData) {
          sessionData = setSession(scope.userId, scope.workspaceId, scope.generation, conversationId, history);
        } else {
          touchSession(sessionData);
        }
      }
      // P0 Fix: 前端 history 是当前请求的唯一历史快照。
      // 当请求携带 history 时，以本次 history 为准，不合并服务端缓存。
      // 服务端缓存仅在前端未提交 history 时作为回退。
      var hasClientHistory = history.length > 0;
      var currentHistory;
      if (hasClientHistory) {
        currentHistory = history;
        if (sessionData) { sessionData.history = history.slice(); sessionData.messageCount = history.length; touchSession(sessionData); }
      } else {
        currentHistory = sessionData ? sessionData.history : [];
      }

      var openResult = validateRequestFiles(body.open_files, MAX_OPEN_FILES, '打开文件');
      if (!openResult.ok) return sendError('OPEN_FILES_TOO_LARGE', openResult.error, 413);
      var attachmentInput = Array.isArray(body.attachments) ? body.attachments : body.files;
      var attachmentResult = validateRequestFiles(attachmentInput, MAX_ATTACHMENTS, '上传资料');
      if (!attachmentResult.ok) return sendError('ATTACHMENTS_TOO_LARGE', attachmentResult.error, 413);
      var openFiles = openResult.value;
      var attachments = attachmentResult.value.map(function(file) { file.source = 'attachment'; return file; });

      var pinnedPaths = [];
      if (Array.isArray(body.pinned_paths)) {
        for (var p = 0; p < body.pinned_paths.length && pinnedPaths.length < 50; p++) {
          if (validatePath(body.pinned_paths[p])) pinnedPaths.push(body.pinned_paths[p]);
        }
      }
      // Pinned hints are surfaced through deterministic open-file ordering.
      openFiles.sort(function(a, b) {
        var ap = a.path === activePath ? 2 : (pinnedPaths.indexOf(a.path) >= 0 ? 1 : 0);
        var bp = b.path === activePath ? 2 : (pinnedPaths.indexOf(b.path) >= 0 ? 1 : 0);
        return bp - ap || a.path.localeCompare(b.path);
      });

      var indexSummary = codeIndex.getIndexSummary(scope);
      logPhase('validated', { workspaceId: scope.workspaceId, workspaceGeneration: scope.generation, hasIndex: !!indexSummary, hasOpenFiles: openFiles.length > 0, hasAttachments: attachments.length > 0, thinkingMode: String(body.thinking_mode || 'auto') });
      if (!indexSummary && openFiles.length === 0 && attachments.length === 0 && needsProjectContext(message) && !isFreshnessQuery(message) && !isExplicitSearch(message)) {
        return sendError('INDEX_REBUILD_REQUIRED', '项目索引需要重新建立', 409, { retryable: true });
      }

      var apiKey = deps.getDeepSeekApiKey ? deps.getDeepSeekApiKey() : '';
      var model = deps.getDeepSeekModel ? deps.getDeepSeekModel() : '';
      if (!apiKey) return sendError('AI_NOT_CONFIGURED', 'AI 服务未配置', 503);
      if (!model) return sendError('MODEL_NOT_CONFIGURED', 'Code AI 模型未配置', 503);
      if (typeof deps.callDeepSeek !== 'function') return sendError('AGENT_NOT_AVAILABLE', 'Code Agent 未启用', 503);

      // Phase 3: Compute capabilities and thinkingMode BEFORE building messages
      // so that runtime identity and limits can be injected into the user message.
      var capabilities = buildCodeCapabilities(deps);
      var thinkingMode = String(body.thinking_mode || 'high');
      // P0 Fix: 前端明确发送的 thinking_mode 直接使用，不再用 auto 正则覆盖
      // 只有当前端发送 'auto' 时才做推断
      if (thinkingMode === 'auto') {
        var simpleTaskRE = /^(列出|查看|打开|搜索|读|找|这个|解释|有哪些|简单|查询|怎么用|什么意思)/;
        thinkingMode = simpleTaskRE.test(message.trim()) ? 'off' : 'high';
      } else {
        thinkingMode = /^(off|low|medium|high|max)$/.test(thinkingMode) ? thinkingMode : 'high';
      }
      var requestedThinkingMode = thinkingMode;
      var firstToolChoice = inferInitialToolChoice(message, indexSummary, openFiles, activePath);

      // Build runtime capabilities for the tool executor
      var runtimeCapabilities = {
        provider: capabilities.provider,
        model: capabilities.model,
        configured: capabilities.configured,
        agentEnabled: capabilities.agentEnabled,
        toolCallingEnabled: capabilities.toolCallingEnabled,
        providerContextTokens: capabilities.providerContextTokens,
        providerMaxOutputTokens: capabilities.providerMaxOutputTokens,
        maxContextTokens: capabilities.maxContextTokens,
        maxOutputTokens: capabilities.maxOutputTokens,
        maxToolRounds: capabilities.maxToolRounds,
        thinkingMode: thinkingMode,
        currentPromptTokens: null,
        cacheHitTokens: null,
        cacheMissTokens: null,
        // 文档能力 — 来源必须是 buildCodeCapabilities()
        canReadCode: capabilities.canReadCode === true,
        canWriteCode: capabilities.canWriteCode === true,
        canCreateFiles: capabilities.canCreateFiles === true,
        canReadDocx: capabilities.canReadDocx === true,
        canWriteDocx: capabilities.canWriteDocx === true,
        canReadXlsx: capabilities.canReadXlsx === true,
        canWriteXlsx: capabilities.canWriteXlsx === true,
        canReadPdf: capabilities.canReadPdf === true,
        canWritePdf: capabilities.canWritePdf === true,
        canReadPptx: capabilities.canReadPptx === true,
        canWritePptx: capabilities.canWritePptx === true,
        workspaceReadOnly: capabilities.workspaceReadOnly === true
      };

      // Step 1: Build messages with initial estimate to get stable inputBudget
      var messages = buildAgentMessages(currentHistory, message, workspaceName, indexSummary, activePath, openFiles, attachments, capabilities, thinkingMode, null);
      var promptTokens = codeIndex.estimateTokens(JSON.stringify(messages)) + codeIndex.estimateTokens(JSON.stringify(CODE_AGENT_TOOLS));
      var inputBudget = Math.max(8192, CODE_AGENT_CONTEXT_TOKENS - CODE_AGENT_MAX_OUTPUT_TOKENS - promptTokens - 8192);

      // Step 2: Rebuild messages with the now-known inputBudget for final calculation
      messages = buildAgentMessages(currentHistory, message, workspaceName, indexSummary, activePath, openFiles, attachments, capabilities, thinkingMode, inputBudget);
      promptTokens = codeIndex.estimateTokens(JSON.stringify(messages)) + codeIndex.estimateTokens(JSON.stringify(CODE_AGENT_TOOLS));
      inputBudget = Math.max(8192, CODE_AGENT_CONTEXT_TOKENS - CODE_AGENT_MAX_OUTPUT_TOKENS - promptTokens - 8192);

      // Step 3: Finalize runtime capabilities and create executor with CORRECT inputBudget
      runtimeCapabilities.inputBudgetTokens = inputBudget;
      runtimeCapabilities.currentPromptTokens = promptTokens;
      var toolTrace = [];
      var executor = createCodeToolExecutor(scope, activePath, openFiles, attachments, toolTrace, inputBudget, deps, runtimeCapabilities);

      logPhase('ai_request_start', { model: model, thinkingMode: thinkingMode, firstToolChoice: firstToolChoice ? firstToolChoice.function.name : 'none', promptTokens: promptTokens, inputBudget: inputBudget });

      // 脱敏诊断日志：跟踪 DOCX 上下文链路
      console.log('[code-agent] request_diagnostics:', JSON.stringify({
        request_id: requestId,
        message_length: message ? message.length : 0,
        history_count: currentHistory ? currentHistory.length : 0,
        open_files_count: openFiles.length,
        attachments_count: attachments.length,
        open_files: openFiles.map(function(f) { return { path: f.path, content_length: f.content ? f.content.length : 0, mimeType: f.mimeType || '' }; }),
        thinking_mode: thinkingMode,
        tools_enabled: !!(Array.isArray(CODE_AGENT_TOOLS) && CODE_AGENT_TOOLS.length > 0),
        prompt_tokens_estimate: promptTokens
      }));

      var callArgs = {
        model: model,
        thinking_mode: thinkingMode,
        tools: CODE_AGENT_TOOLS,
        tool_choice: 'auto',
        first_tool_choice: firstToolChoice,
        tool_executor: executor,
        max_tool_rounds: CODE_AGENT_MAX_TOOL_ROUNDS,
        max_tool_result_chars: Math.min(inputBudget * 4, 2000000),
        max_tokens: CODE_AGENT_MAX_OUTPUT_TOKENS,
        signal: requestController.signal
      };

      var aiResult;
      var thinkingFallback = false;
      try {
        aiResult = await deps.callDeepSeek(messages, callArgs);
      } catch (err) {
        var errMsg = err && err.message ? err.message : String(err);
        var errStatus = err && err.status ? err.status : (errMsg.indexOf('400') >= 0 ? 400 : 500);
        var providerCode = err && err.response && err.response.data && err.response.data.error && err.response.data.error.code ? err.response.data.error.code : 'unknown';
        var providerType = err && err.response && err.response.data && err.response.data.error && err.response.data.error.type ? err.response.data.error.type : 'unknown';
        var providerMsg = err && err.response && err.response.data && err.response.data.error && err.response.data.error.message ? err.response.data.error.message : errMsg;
        
        var parsedError = 'PROVIDER_HTTP_400';
        if (providerCode === 'context_length_exceeded' || providerMsg.indexOf('context_length') >= 0 || providerMsg.indexOf('maximum context length') >= 0) {
          parsedError = 'PROVIDER_CONTEXT_TOO_LARGE';
        } else if (providerCode === 'invalid_request_error' && providerMsg.indexOf('messages') >= 0) {
          parsedError = 'PROVIDER_INVALID_MESSAGES';
        } else if (providerMsg.indexOf('model not found') >= 0 || providerCode === 'model_not_found') {
          parsedError = 'PROVIDER_INVALID_MODEL';
        } else if (providerMsg.indexOf('tool') >= 0 || providerMsg.indexOf('function') >= 0 || providerCode === 'tool_calls_unsupported') {
          parsedError = 'PROVIDER_TOOL_CALL_UNSUPPORTED';
        } else if (providerMsg.indexOf('thinking') >= 0 || providerMsg.indexOf('reasoning') >= 0) {
          parsedError = 'PROVIDER_INVALID_THINKING_MODE';
        }

        var isThinkingIncompatible = parsedError === 'PROVIDER_INVALID_THINKING_MODE' || 
                                     (parsedError === 'PROVIDER_TOOL_CALL_UNSUPPORTED' && thinkingMode !== 'off') ||
                                     (errStatus === 400 && providerMsg.indexOf('thinking') >= 0);

        if (errStatus === 400 && isThinkingIncompatible && thinkingMode !== 'off' && CODE_AGENT_TOOLS && CODE_AGENT_TOOLS.length > 0) {
          console.warn('[code-agent] HTTP 400 explicitly incompatible with thinking + tools. Retrying once with thinking=off.');
          thinkingFallback = true;
          callArgs.thinking_mode = 'off';
          logPhase('thinking_fallback', { reason: parsedError });
          aiResult = await deps.callDeepSeek(messages, callArgs);
          aiResult.thinking_fallback = true;
          aiResult.thinking_mode = 'off';
          aiResult.thinkingFallbackReason = parsedError;
        } else {
          err.parsedCode = parsedError;
          throw err;
        }
      }

      if (aborted) return;

      logPhase('ai_request_done', { toolCalls: toolTrace.length, toolTrace: toolTrace.map(function(t) { return { tool: t.tool, ok: t.ok, duration_ms: t.duration_ms }; }), usage: aiResult.usage ? { prompt: aiResult.usage.prompt_tokens, completion: aiResult.usage.completion_tokens } : null, thinkingFallback: thinkingFallback });

      var rawContent = aiResult && typeof aiResult.content === 'string' ? aiResult.content : '';
      if (!rawContent) {
        return sendError('PROVIDER_EMPTY_RESPONSE', 'AI 返回了空响应', 502, { tool_trace: toolTrace, retryable: true });
      }
      var rawReasoning = aiResult && typeof aiResult.reasoning === 'string' ? aiResult.reasoning : '';

      // Transcript normalization: single source of truth from finalMessages
      // Avoid duplicate assistant messages
      if (sessionData && aiResult.finalMessages && Array.isArray(aiResult.finalMessages)) {
        var initialMsgsLen = messages.length;
        var newMsgs = aiResult.finalMessages.slice(initialMsgsLen);

        // P0 Fix: 使用稳定 message_id 去重，不再依赖 "role + 前200字符"
        var seenIds = new Set();
        for (var m = 0; m < sessionData.history.length; m++) {
          var h = sessionData.history[m];
          if (h.message_id) seenIds.add(h.message_id);
        }

        // Add current user message with stable ID
        var userMsgId = body.client_request_id || ('umsg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 8));
        var userKey = 'user:' + String(message).slice(0, 200);
        if (!seenIds.has(userMsgId)) {
          sessionData.history.push({ role: 'user', content: message, message_id: userMsgId, turn_id: body.client_request_id || '' });
          seenIds.add(userMsgId);
        }

        // Add new messages from provider (tool calls, tool results, assistant)
        for (var i = 0; i < newMsgs.length; i++) {
          var msg = newMsgs[i];
          if (!msg || typeof msg !== 'object') continue;
          if (msg.reasoning_content) {
            msg = Object.assign({}, msg);
            delete msg.reasoning_content;
          }
          var msgId = msg.message_id || ('amsg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 8) + '_' + i);
          if (!seenIds.has(msgId)) {
            msg.message_id = msgId;
            sessionData.history.push(msg);
            seenIds.add(msgId);
          }
        }

        // Enforce max session messages
        if (sessionData.history.length > MAX_SESSION_MESSAGES) {
          var keepHead = Math.floor(CHECKPOINT_KEEP / 2);
          var keepTail = MAX_SESSION_MESSAGES - keepHead - 2;
          var totalMsgs = sessionData.history.length;
          if (totalMsgs > keepHead + keepTail + 2) {
            var msgHead = sessionData.history.slice(0, keepHead);
            var msgTail = sessionData.history.slice(totalMsgs - keepTail);
            sessionData.history = msgHead.concat([
              { role: 'user', content: '[早期对话已自动压缩，当前继续最近上下文。]' },
              { role: 'assistant', content: '已理解，将继续基于当前上下文回复。' }
            ]).concat(msgTail);
            console.log('[code-agent] History compressed: ' + totalMsgs + ' -> ' + sessionData.history.length + ' messages');
          }
        }
        sessionData.messageCount = sessionData.history.length;
        touchSession(sessionData);
      }
      var operations = [];
      var reply = rawContent;
      var parsed = extractJsonFromText(rawContent);
      if (parsed && Array.isArray(parsed.operations)) {
        operations = parseOperations(parsed.operations);
        var jsonBlockMatch = rawContent.match(JSON_BLOCK_RE);
        if (jsonBlockMatch) reply = (rawContent.slice(0, jsonBlockMatch.index) + rawContent.slice(jsonBlockMatch.index + jsonBlockMatch[0].length)).trim();
      }

      var filesReadMap = {};
      var readTokens = 0;
      toolTrace.forEach(function(entry) {
        readTokens += entry.context_tokens || 0;
        if (entry.path) {
          if (!filesReadMap[entry.path]) filesReadMap[entry.path] = [];
          (entry.ranges || []).forEach(function(range) { filesReadMap[entry.path].push(range); });
        }
        (entry.files || []).forEach(function(file) {
          if (!filesReadMap[file.path]) filesReadMap[file.path] = [];
          (file.ranges || []).forEach(function(range) { filesReadMap[file.path].push(range); });
        });
      });
      var filesRead = Object.keys(filesReadMap).sort().map(function(path) { return { path: path, ranges: filesReadMap[path] }; });
      var usage = aiResult.usage || null;
      if (usage && typeof usage.prompt_cache_hit_tokens === 'number') {
        var cacheTotal = usage.prompt_cache_hit_tokens + (Number(usage.prompt_cache_miss_tokens) || 0);
        usage.prompt_cache_hit_ratio = cacheTotal > 0 ? usage.prompt_cache_hit_tokens / cacheTotal : 0;
      }
      var caps = buildCodeCapabilities(deps, {
        requestSucceeded: true,
        model: aiResult.model || model
      });
      var remainingEstimatedTokens = null;
      if (caps.maxContextTokens && typeof promptTokens === 'number' && typeof readTokens === 'number') {
        var outputReserve = caps.maxOutputTokens || CODE_AGENT_MAX_OUTPUT_TOKENS;
        remainingEstimatedTokens = Math.max(0, caps.maxContextTokens - promptTokens - readTokens - outputReserve);
      }
      var runtimeInfo = {
        provider: caps.provider,
        model: caps.model,
        configuredContextTokens: caps.maxContextTokens || null,
        providerContextTokens: caps.providerContextTokens || null,
        inputBudgetTokens: inputBudget,
        promptTokens: promptTokens,
        toolReadTokens: readTokens,
        cacheHitTokens: usage && usage.prompt_cache_hit_tokens != null ? usage.prompt_cache_hit_tokens : null,
        cacheMissTokens: usage && usage.prompt_cache_miss_tokens != null ? usage.prompt_cache_miss_tokens : null,
        completionTokens: usage && usage.completion_tokens != null ? usage.completion_tokens : null,
        remainingEstimatedTokens: remainingEstimatedTokens,
        // P0 Fix: 思考模式验证字段
        requestedThinkingMode: requestedThinkingMode,
        effectiveThinkingMode: aiResult && aiResult.thinking_mode ? aiResult.thinking_mode : (thinkingFallback ? 'off' : thinkingMode),
        thinkingEnabled: !!(aiResult && aiResult.reasoning && aiResult.reasoning.length > 0),
        reasoningTokens: aiResult && typeof aiResult.reasoning_tokens === 'number' ? aiResult.reasoning_tokens : (aiResult && aiResult.reasoning ? '供应商未返回' : null),
        thinkingFallback: (aiResult && aiResult.thinking_fallback === true) ? true : false,
        thinkingFallbackReason: aiResult && aiResult.thinkingFallbackReason ? aiResult.thinkingFallbackReason : null,
        // AI 文档能力 — 来源必须是 buildCodeCapabilities()
        canReadDocx: capabilities.canReadDocx === true,
        canWriteDocx: capabilities.canWriteDocx === true,
        canReadXlsx: capabilities.canReadXlsx === true,
        canWriteXlsx: capabilities.canWriteXlsx === true,
        canReadPdf: capabilities.canReadPdf === true,
        canWritePdf: capabilities.canWritePdf === true,
        canReadPptx: capabilities.canReadPptx === true,
        canWritePptx: capabilities.canWritePptx === true,
        workspaceReadOnly: capabilities.workspaceReadOnly === true
      };
      return res.json({
        ok: true,
        requestId: requestId,
        reply: reply.trim(),
        operations: operations,
        usage: usage,
        capabilities: capabilities,
        runtime: runtimeInfo,
        tool_trace: toolTrace,
        context_info: {
          indexed: !!indexSummary,
          index: indexSummary,
          pinned_files: pinnedPaths,
          active_file: activePath || null,
          open_files: openFiles.map(function(file) { return file.path; }),
          attachments: attachments.map(function(file) { return file.path; }),
          files_read: filesRead,
          total_files_read: filesRead.length,
          total_tool_calls: toolTrace.length,
          total_tokens: readTokens,
          budget_tokens: inputBudget,
          cache_hit_tokens: usage && usage.prompt_cache_hit_tokens,
          cache_miss_tokens: usage && usage.prompt_cache_miss_tokens,
          runtime: runtimeInfo
        }
      });
    } catch (err) {
      if (aborted || (err && err.name === 'AbortError')) {
        logPhase('cancelled', {});
        return;
      }
      var errMsg = err && err.message ? err.message : '';
      var errCode = err && err.code ? err.code : '';
      console.error('[code-agent] Unhandled error:', errMsg || err, 'phase:', requestPhase);
      logPhase('error', { errorMessage: errMsg, errorCode: errCode || 'UNKNOWN' });

      // Phase 2: Map known error patterns to structured error codes
      var code = errCode || 'INTERNAL_ERROR';
      var status = 502;
      var retryable = true;

      if (/超时|timeout/i.test(errMsg)) {
        code = 'PROVIDER_TIMEOUT';
        status = 504;
      } else if (/HTTP 429|频繁|rate.?limit/i.test(errMsg)) {
        code = 'PROVIDER_HTTP_429';
        status = 429;
      } else if (/HTTP 400/i.test(errMsg)) {
        code = 'PROVIDER_HTTP_400';
        status = 502;
        // P0 Fix: 提取真实上游错误响应
        var providerResponse = null;
        if (err && err.response && err.response.data) {
          providerResponse = err.response.data;
        }
        var providerError = (providerResponse && providerResponse.error) ? providerResponse.error : {};
        var diagnoseInfo = {
          requestId: requestId,
          model: model,
          phase: requestPhase || 'unknown',
          thinkingMode: thinkingMode,
          hasTools: !!(Array.isArray(CODE_AGENT_TOOLS) && CODE_AGENT_TOOLS.length > 0),
          toolChoice: firstToolChoice ? firstToolChoice.function.name : 'auto',
          msgCount: messages ? messages.length : 0,
          promptTokens: typeof promptTokens === 'number' ? promptTokens : 'unknown',
          upstreamStatus: 400,
          upstreamCode: errCode || providerError.code || '',
          upstreamType: providerError.type || '',
          upstreamMessage: (providerError.message || errMsg || '').slice(0, 300),
          upstreamRequestId: providerResponse && providerResponse.request_id ? providerResponse.request_id : ''
        };
        console.error('[code-agent] PROVIDER_HTTP_400 diagnostics:', JSON.stringify(diagnoseInfo));
        // 根据上游错误信息细分
        if (/model/i.test(errMsg)) {
          code = 'PROVIDER_INVALID_MODEL';
        } else if (/thinking|reasoning/i.test(errMsg)) {
          code = 'PROVIDER_INVALID_THINKING_MODE';
        } else if (/tool|function/i.test(errMsg)) {
          code = 'PROVIDER_TOOL_CALL_UNSUPPORTED';
        } else if (/context|token|length/i.test(errMsg)) {
          code = 'PROVIDER_CONTEXT_TOO_LARGE';
        } else if (/invalid|format|parse/i.test(errMsg)) {
          code = 'PROVIDER_INVALID_REQUEST';
        }
      } else if (/HTTP 401/i.test(errMsg)) {
        code = 'PROVIDER_HTTP_401';
        status = 502;
        retryable = false;
      } else if (/HTTP 403/i.test(errMsg)) {
        code = 'PROVIDER_HTTP_403';
        status = 502;
        retryable = false;
      } else if (/取消|cancel|abort/i.test(errMsg)) {
        code = 'REQUEST_CANCELLED';
        status = 499;
        retryable = true;
      } else if (/工具调用解析失败|DSML|tool_call/i.test(errMsg)) {
        code = 'TOOL_TRANSCRIPT_INVALID';
        status = 502;
      } else if (/上下文预算|context.*budget|token.*budget/i.test(errMsg)) {
        code = 'CONTEXT_BUDGET_EXCEEDED';
        status = 413;
      } else if (/工具结果.*大|tool.*result.*large|超过.*限制/i.test(errMsg)) {
        code = 'TOOL_RESULT_TOO_LARGE';
        status = 413;
      } else if (/序列化|serialize|JSON.*parse/i.test(errMsg)) {
        code = 'INTERNAL_SERIALIZATION_ERROR';
        status = 500;
        retryable = false;
      }

      return sendError(code, sanitizeError ? sanitizeError(err) : ('Code AI 请求失败: ' + (errMsg || '未知错误')), status, { retryable: retryable });
    }
  });

  // ── Phase 2: Tool summary helpers for SSE events ────────────────────────
  function getToolSummary(toolName, toolCall) {
    var args = parseToolArguments(toolCall);
    switch (toolName) {
      case 'list_files':
        return '列出项目文件' + (args.directory ? ' (' + String(args.directory).slice(0, 60) + ')' : '');
      case 'search_code':
        return '搜索代码: ' + String(args.query || '').slice(0, 80);
      case 'read_file':
        return '读取文件: ' + String(args.path || '').slice(0, 120);
      case 'read_file_range':
        return '读取文件片段: ' + String(args.path || '').slice(0, 80) + ' L' + (args.start_line || '') + '-' + (args.end_line || '');
      case 'get_symbols':
        return '获取符号: ' + String(args.path || '').slice(0, 120);
      case 'get_active_file':
        return '获取当前活动文件';
      case 'get_open_files':
        return '获取打开文件列表';
      case 'get_runtime_capabilities':
        return '获取运行时能力';
      case 'web_search':
        return '联网搜索: ' + String(args.query || '').slice(0, 80);
      case 'fetch_web_page':
        return '抓取网页: ' + String(args.url || '').slice(0, 120);
      default:
        return '执行工具: ' + String(toolName || 'unknown').slice(0, 40);
    }
  }

  function getToolResultSummary(toolName, result, ok) {
    if (!ok) {
      var errMsg = (result && result.error) ? String(result.error).slice(0, 80) : '执行失败';
      return '失败: ' + errMsg;
    }
    switch (toolName) {
      case 'list_files':
        var total = (result && typeof result.totalFiles === 'number') ? result.totalFiles : 0;
        return '找到 ' + total + ' 个文件';
      case 'search_code':
        var results = (result && Array.isArray(result.results)) ? result.results.length : 0;
        return '找到 ' + results + ' 个相关位置';
      case 'read_file':
      case 'read_file_range':
        var lines = (result && typeof result.totalLines === 'number') ? result.totalLines : 0;
        var start = (result && typeof result.startLine === 'number') ? result.startLine : 1;
        var end = (result && typeof result.endLine === 'number') ? result.endLine : start;
        if (result && result.truncated) return '已读取 L' + start + '-' + end + ' (共' + lines + '行，已截断)';
        return '已读取 L' + start + '-' + end + ' (共' + lines + '行)';
      case 'get_symbols':
        var symbols = (result && Array.isArray(result.symbols)) ? result.symbols.length : 0;
        return '获取到 ' + symbols + ' 个符号';
      case 'get_active_file':
        return '已获取当前文件';
      case 'get_open_files':
        var files = (result && Array.isArray(result.files)) ? result.files.length : 0;
        return '已获取 ' + files + ' 个打开文件';
      case 'get_runtime_capabilities':
        return '已获取运行时能力';
      case 'web_search':
        var webResults = (result && Array.isArray(result.results)) ? result.results.length : 0;
        return '搜索到 ' + webResults + ' 条结果';
      case 'fetch_web_page':
        var bytes = (result && typeof result.bytes === 'number') ? result.bytes : 0;
        return '已抓取网页 (' + (bytes > 1024 ? (bytes / 1024).toFixed(1) + 'KB' : bytes + 'B') + ')';
      default:
        return '工具执行完成';
    }
  }

  // ── Phase 2: Streaming SSE endpoint ────────────────────────────────────
  var aiCoreSSE = require('./ai-core/sse');
  var aiCoreRequestId = require('./ai-core/request-id');
  var aiCoreErrorMapper = require('./ai-core/error-mapper');
  var streamSession = require('./ai-core/stream-session');

  app.post('/api/code/chat/stream', rateLimit(60000, 20), authenticateUser, async function(req, res) {
    var streamEnabled = String(process.env.CODE_STREAM_ENABLED || '0') === '1';
    if (!streamEnabled) {
      return res.status(503).json({ ok: false, code: 'STREAM_DISABLED', error: '流式接口未启用，请使用 /api/code/chat' });
    }

    var aborted = false;
    var finalized = false;
    var requestController = new AbortController();
    var requestId = aiCoreRequestId.generateRequestId('code');
    var streamId = aiCoreRequestId.generateStreamId();
    var requestStartTime = Date.now();
    var toolTrace = [];
    var userId = String(req.userName || '');
    var clientRequestId = String(req.body.client_request_id || '');

    // Phase 3: Register controller for external cancellation
    streamAbortControllers.set(streamId, requestController);

    // Phase 3: Stream resume — check idempotency for same client_request_id
    if (streamSession.isResumeEnabled() && clientRequestId && supabase) {
      var existingSession = await streamSession.getStreamSessionByClientRequestId(supabase, userId, clientRequestId);
      if (existingSession && existingSession.status === 'completed') {
        return res.json({
          ok: true,
          stream_id: existingSession.stream_id,
          status: 'completed',
          duplicate: true,
          message: '请求已完成，请通过恢复接口获取结果'
        });
      }
      if (existingSession && existingSession.status === 'running') {
        // Return existing stream_id so client can resume
        return res.json({
          ok: true,
          stream_id: existingSession.stream_id,
          status: 'running',
          duplicate: true,
          message: '请求正在处理中，请使用 stream_id 恢复'
        });
      }
    }

    function abortRequest() {
      aborted = true;
      try { requestController.abort(); } catch (_) {}
    }
    req.once('aborted', abortRequest);
    res.once('close', function() { if (!res.writableEnded) abortRequest(); });

    // Setup SSE
    aiCoreSSE.setupSSE(res, req);
    var writer = aiCoreSSE.createSSEWriter(res, req);
    var nextEventId = aiCoreRequestId.generateEventId();

    var baseEvent = {
      stream_id: streamId,
      request_id: requestId,
      client_request_id: String(req.body.client_request_id || ''),
      conversation_id: String(req.body.conversation_id || ''),
      startTime: requestStartTime
    };

    // Phase 3: Stream resume — create session and event logger
    var eventLogger = streamSession.createEventLogger(supabase, streamId, userId);
    if (streamSession.isResumeEnabled() && supabase) {
      streamSession.createStreamSession(supabase, {
        userId: userId,
        streamId: streamId,
        requestId: requestId,
        clientRequestId: clientRequestId,
        conversationId: String(req.body.conversation_id || ''),
        workspaceId: String((req.body.workspace_id || req.body.workspace_name || '')).slice(0, 200),
        workspaceGeneration: Number(req.body.workspace_generation || 0),
        startedAt: new Date(requestStartTime).toISOString()
      }).catch(function(e) { console.error('[code-agent-stream] session create error:', e.message); });
    }

    function sendSSE(type, data) {
      if (finalized || aborted) return false;
      if (type === 'done' || type === 'error') finalized = true;
      var eventId = nextEventId();
      var event = aiCoreSSE.buildSSEEvent(
        Object.assign({}, baseEvent, { event_id: eventId }),
        type,
        data
      );
      // Phase 3: Persist event (non-blocking, fire-and-forget)
      if (streamSession.isPersistableEvent(type)) {
        eventLogger.logEvent(type, data, eventId).catch(function() {});
        // Update last_event_id in session
        if (streamSession.isResumeEnabled() && supabase) {
          streamSession.updateStreamSession(supabase, streamId, { last_event_id: eventId }).catch(function() {});
        }
      }
      return writer.write(aiCoreSSE.formatSSEEvent(event));
    }

    // Heartbeat
    var heartbeat = aiCoreSSE.createHeartbeat(writer, function() { return baseEvent; }, 10000);
    heartbeat.start();

    function cleanup() {
      heartbeat.stop();
      writer.cleanup();
      streamAbortControllers.delete(streamId);
    }

    function sendStreamError(code, message, phase) {
      if (finalized) return;
      var structured = aiCoreErrorMapper.buildErrorResponse(code, message, {
        requestId: requestId,
        phase: phase || 'stream',
        retryable: (code === 'PROVIDER_TIMEOUT' || code === 'RATE_LIMITED')
      });
      sendSSE('error', {
        code: structured.code,
        message: structured.error,
        retryable: structured.retryable,
        request_id: structured.requestId,
        phase: structured.phase
      });
      // Phase 3: Mark session as failed
      if (streamSession.isResumeEnabled() && supabase) {
        streamSession.updateStreamSession(supabase, streamId, {
          status: 'failed',
          completed_at: new Date().toISOString()
        }).catch(function() {});
      }
      cleanup();
    }

    try {
      var body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        sendStreamError('VALIDATION_FAILED', '请求无效', 'validation');
        return;
      }

      var msgResult = validateString(body.message, MAX_MESSAGE_LEN, '消息内容');
      if (!msgResult.ok) { sendStreamError('INVALID_MESSAGE', msgResult.error, 'validation'); return; }
      if (!msgResult.value) { sendStreamError('EMPTY_MESSAGE', '消息内容不能为空', 'validation'); return; }
      var message = msgResult.value;

      var wsResult = validateString(body.workspace_name, 200, '工作区名称');
      if (!wsResult.ok) { sendStreamError('INVALID_WORKSPACE', wsResult.error, 'validation'); return; }
      var workspaceName = wsResult.value || '';
      var scopeResult = validateWorkspaceScope(req, body);
      if (!scopeResult.ok) { sendStreamError('INVALID_WORKSPACE_SCOPE', scopeResult.error, 'validation'); return; }
      var scope = scopeResult.value;

      var apResult = validateString(body.active_path, 500, '当前路径');
      if (!apResult.ok) { sendStreamError('INVALID_PATH', apResult.error, 'validation'); return; }
      var activePath = apResult.value || '';
      if (activePath && !validatePath(activePath)) { sendStreamError('INVALID_PATH', '当前路径无效', 'validation'); return; }

      var histResult = validateHistory(body.history);
      if (!histResult.ok) { sendStreamError('INVALID_HISTORY', histResult.error, 'validation'); return; }
      var history = histResult.value;

      var conversationId = String(body.conversation_id || '').trim();
      var sessionData = null;
      if (conversationId) {
        sessionData = getSession(scope.userId, scope.workspaceId, scope.generation, conversationId);
        if (!sessionData) {
          sessionData = setSession(scope.userId, scope.workspaceId, scope.generation, conversationId, history);
        } else {
          touchSession(sessionData);
        }
      }
      // P0 Fix: 前端 history 是当前请求的唯一历史快照。
      var hasClientHistory2 = history.length > 0;
      var currentHistory;
      if (hasClientHistory2) {
        currentHistory = history;
        if (sessionData) { sessionData.history = history.slice(); sessionData.messageCount = history.length; touchSession(sessionData); }
      } else {
        currentHistory = sessionData ? sessionData.history : [];
      }

      var openResult = validateRequestFiles(body.open_files, MAX_OPEN_FILES, '打开文件');
      if (!openResult.ok) { sendStreamError('OPEN_FILES_TOO_LARGE', openResult.error, 'validation'); return; }
      var attachmentInput = Array.isArray(body.attachments) ? body.attachments : body.files;
      var attachmentResult = validateRequestFiles(attachmentInput, MAX_ATTACHMENTS, '上传资料');
      if (!attachmentResult.ok) { sendStreamError('ATTACHMENTS_TOO_LARGE', attachmentResult.error, 'validation'); return; }
      var openFiles = openResult.value;
      var attachments = attachmentResult.value.map(function(file) { file.source = 'attachment'; return file; });

      var pinnedPaths = [];
      if (Array.isArray(body.pinned_paths)) {
        for (var p = 0; p < body.pinned_paths.length && pinnedPaths.length < 50; p++) {
          if (validatePath(body.pinned_paths[p])) pinnedPaths.push(body.pinned_paths[p]);
        }
      }
      openFiles.sort(function(a, b) {
        var ap = a.path === activePath ? 2 : (pinnedPaths.indexOf(a.path) >= 0 ? 1 : 0);
        var bp = b.path === activePath ? 2 : (pinnedPaths.indexOf(b.path) >= 0 ? 1 : 0);
        return bp - ap || a.path.localeCompare(b.path);
      });

      var indexSummary = codeIndex.getIndexSummary(scope);
      if (!indexSummary && openFiles.length === 0 && attachments.length === 0 && needsProjectContext(message) && !isFreshnessQuery(message) && !isExplicitSearch(message)) {
        sendStreamError('INDEX_REBUILD_REQUIRED', '项目索引需要重新建立', 'validation');
        return;
      }

      // Send accepted
      sendSSE('accepted', {
        mode: 'modify',
        workspace_id: scope.workspaceId,
        workspace_generation: scope.generation,
        has_index: !!indexSummary,
        open_files_count: openFiles.length,
        attachments_count: attachments.length
      });

      // Send planning
      sendSSE('planning', { message: '正在分析任务和相关项目结构' });

      var apiKey = deps.getDeepSeekApiKey ? deps.getDeepSeekApiKey() : '';
      var model = deps.getDeepSeekModel ? deps.getDeepSeekModel() : '';
      if (!apiKey) { sendStreamError('AI_NOT_CONFIGURED', 'AI 服务未配置', 'init'); return; }
      if (!model) { sendStreamError('MODEL_NOT_CONFIGURED', 'Code AI 模型未配置', 'init'); return; }
      if (typeof deps.callDeepSeek !== 'function') { sendStreamError('AGENT_NOT_AVAILABLE', 'Code Agent 未启用', 'init'); return; }

      var capabilities = buildCodeCapabilities(deps);
      var thinkingMode = String(body.thinking_mode || 'high');
      if (thinkingMode === 'auto') {
        var simpleTaskRE = /^(列出|查看|打开|搜索|读|找|这个|解释|有哪些|简单|查询|怎么用|什么意思)/;
        thinkingMode = simpleTaskRE.test(message.trim()) ? 'off' : 'high';
      } else {
        thinkingMode = /^(off|low|medium|high|max)$/.test(thinkingMode) ? thinkingMode : 'high';
      }
      var requestedThinkingMode = thinkingMode;
      var firstToolChoice = inferInitialToolChoice(message, indexSummary, openFiles, activePath);

      var runtimeCapabilities = {
        provider: capabilities.provider,
        model: capabilities.model,
        configured: capabilities.configured,
        agentEnabled: capabilities.agentEnabled,
        toolCallingEnabled: capabilities.toolCallingEnabled,
        providerContextTokens: capabilities.providerContextTokens,
        providerMaxOutputTokens: capabilities.providerMaxOutputTokens,
        maxContextTokens: capabilities.maxContextTokens,
        maxOutputTokens: capabilities.maxOutputTokens,
        maxToolRounds: capabilities.maxToolRounds,
        thinkingMode: thinkingMode,
        currentPromptTokens: null,
        cacheHitTokens: null,
        cacheMissTokens: null,
        // 文档能力 — 来源必须是 buildCodeCapabilities()
        canReadCode: capabilities.canReadCode === true,
        canWriteCode: capabilities.canWriteCode === true,
        canCreateFiles: capabilities.canCreateFiles === true,
        canReadDocx: capabilities.canReadDocx === true,
        canWriteDocx: capabilities.canWriteDocx === true,
        canReadXlsx: capabilities.canReadXlsx === true,
        canWriteXlsx: capabilities.canWriteXlsx === true,
        canReadPdf: capabilities.canReadPdf === true,
        canWritePdf: capabilities.canWritePdf === true,
        canReadPptx: capabilities.canReadPptx === true,
        canWritePptx: capabilities.canWritePptx === true,
        workspaceReadOnly: capabilities.workspaceReadOnly === true
      };

      var messages = buildAgentMessages(currentHistory, message, workspaceName, indexSummary, activePath, openFiles, attachments, capabilities, thinkingMode, null);
      var promptTokens = codeIndex.estimateTokens(JSON.stringify(messages)) + codeIndex.estimateTokens(JSON.stringify(CODE_AGENT_TOOLS));
      var inputBudget = Math.max(8192, CODE_AGENT_CONTEXT_TOKENS - CODE_AGENT_MAX_OUTPUT_TOKENS - promptTokens - 8192);

      messages = buildAgentMessages(currentHistory, message, workspaceName, indexSummary, activePath, openFiles, attachments, capabilities, thinkingMode, inputBudget);
      promptTokens = codeIndex.estimateTokens(JSON.stringify(messages)) + codeIndex.estimateTokens(JSON.stringify(CODE_AGENT_TOOLS));
      inputBudget = Math.max(8192, CODE_AGENT_CONTEXT_TOKENS - CODE_AGENT_MAX_OUTPUT_TOKENS - promptTokens - 8192);

      runtimeCapabilities.inputBudgetTokens = inputBudget;
      runtimeCapabilities.currentPromptTokens = promptTokens;

      // Phase 2: Wrapped tool executor that emits SSE events
      var rawExecutor = createCodeToolExecutor(scope, activePath, openFiles, attachments, toolTrace, inputBudget, deps, runtimeCapabilities);
      var wrappedExecutor = function(toolCall) {
        var toolCallId = toolCall.id || ('tool_' + (toolTrace.length + 1));
        var toolName = toolCall.function ? toolCall.function.name : (toolCall.name || 'unknown');
        var toolSummary = getToolSummary(toolName, toolCall);

        sendSSE('tool_start', {
          tool_call_id: toolCallId,
          tool: toolName,
          summary: toolSummary
        });

        var toolStart = Date.now();
        return rawExecutor(toolCall).then(function(result) {
          var duration = Date.now() - toolStart;
          var ok = !(result && result.error);
          sendSSE('tool_result', {
            tool_call_id: toolCallId,
            tool: toolName,
            ok: ok,
            duration_ms: duration,
            summary: getToolResultSummary(toolName, result, ok)
          });
          return result;
        }).catch(function(err) {
          var duration = Date.now() - toolStart;
          sendSSE('tool_result', {
            tool_call_id: toolCallId,
            tool: toolName,
            ok: false,
            duration_ms: duration,
            summary: '工具执行失败: ' + (err && err.message ? err.message.slice(0, 100) : '未知错误')
          });
          throw err;
        });
      };

      // Send answer_start
      sendSSE('answer_start', { model: model, thinking_mode: thinkingMode });

      // 脱敏诊断日志：跟踪 DOCX 上下文链路（SSE 流式路径）
      console.log('[code-agent] stream_request_diagnostics:', JSON.stringify({
        request_id: requestId,
        stream_id: streamId,
        message_length: message ? message.length : 0,
        history_count: currentHistory ? currentHistory.length : 0,
        open_files_count: openFiles.length,
        attachments_count: attachments.length,
        open_files: openFiles.map(function(f) { return { path: f.path, content_length: f.content ? f.content.length : 0, mimeType: f.mimeType || '' }; }),
        thinking_mode: thinkingMode,
        tools_enabled: !!(Array.isArray(CODE_AGENT_TOOLS) && CODE_AGENT_TOOLS.length > 0),
        prompt_tokens_estimate: promptTokens
      }));

      var hasStartedStreaming = false;
      var callArgs = {
        model: model,
        thinking_mode: thinkingMode,
        tools: CODE_AGENT_TOOLS,
        tool_choice: 'auto',
        first_tool_choice: firstToolChoice,
        tool_executor: wrappedExecutor,
        max_tool_rounds: CODE_AGENT_MAX_TOOL_ROUNDS,
        max_tool_result_chars: Math.min(inputBudget * 4, 2000000),
        max_tokens: CODE_AGENT_MAX_OUTPUT_TOKENS,
        signal: requestController.signal,
        onContentChunk: function(chunk) {
          if (aborted || finalized) return;
          hasStartedStreaming = true;
          sendSSE('answer_delta', { delta: String(chunk).slice(0, 4000) });
        }
      };

      var aiResult;
      var thinkingFallback = false;
      try {
        aiResult = await deps.callDeepSeek(messages, callArgs);
      } catch (err) {
        var errMsg = err && err.message ? err.message : String(err);
        var errStatus = err && err.status ? err.status : (errMsg.indexOf('400') >= 0 ? 400 : 500);
        var providerCode = err && err.response && err.response.data && err.response.data.error && err.response.data.error.code ? err.response.data.error.code : 'unknown';
        var providerType = err && err.response && err.response.data && err.response.data.error && err.response.data.error.type ? err.response.data.error.type : 'unknown';
        var providerMsg = err && err.response && err.response.data && err.response.data.error && err.response.data.error.message ? err.response.data.error.message : errMsg;
        
        var parsedError = 'PROVIDER_HTTP_400';
        if (providerCode === 'context_length_exceeded' || providerMsg.indexOf('context_length') >= 0 || providerMsg.indexOf('maximum context length') >= 0) {
          parsedError = 'PROVIDER_CONTEXT_TOO_LARGE';
        } else if (providerCode === 'invalid_request_error' && providerMsg.indexOf('messages') >= 0) {
          parsedError = 'PROVIDER_INVALID_MESSAGES';
        } else if (providerMsg.indexOf('model not found') >= 0 || providerCode === 'model_not_found') {
          parsedError = 'PROVIDER_INVALID_MODEL';
        } else if (providerMsg.indexOf('tool') >= 0 || providerMsg.indexOf('function') >= 0 || providerCode === 'tool_calls_unsupported') {
          parsedError = 'PROVIDER_TOOL_CALL_UNSUPPORTED';
        } else if (providerMsg.indexOf('thinking') >= 0 || providerMsg.indexOf('reasoning') >= 0) {
          parsedError = 'PROVIDER_INVALID_THINKING_MODE';
        }

        var isThinkingIncompatible = parsedError === 'PROVIDER_INVALID_THINKING_MODE' || 
                                     (parsedError === 'PROVIDER_TOOL_CALL_UNSUPPORTED' && thinkingMode !== 'off') ||
                                     (errStatus === 400 && providerMsg.indexOf('thinking') >= 0);

        if (errStatus === 400 && isThinkingIncompatible && !hasStartedStreaming && thinkingMode !== 'off' && CODE_AGENT_TOOLS && CODE_AGENT_TOOLS.length > 0) {
          console.warn('[code-agent] HTTP 400 explicitly incompatible with thinking + tools. Retrying once with thinking=off.');
          thinkingFallback = true;
          callArgs.thinking_mode = 'off';
          logPhase('thinking_fallback', { reason: parsedError });
          sendSSE('answer_start', { model: model, thinking_mode: 'off' });
          aiResult = await deps.callDeepSeek(messages, callArgs);
          aiResult.thinking_fallback = true;
          aiResult.thinking_mode = 'off';
          aiResult.thinkingFallbackReason = parsedError;
        } else {
          err.parsedCode = parsedError;
          throw err;
        }
      }
      
      if (aborted || finalized) { cleanup(); return; }

      var rawContent = aiResult && typeof aiResult.content === 'string' ? aiResult.content : '';
      if (!rawContent) {
        sendStreamError('PROVIDER_EMPTY_RESPONSE', 'AI 返回了空响应', 'provider');
        return;
      }

      // Parse operations
      var operations = [];
      var reply = rawContent;
      var parsed = extractJsonFromText(rawContent);
      if (parsed && Array.isArray(parsed.operations)) {
        operations = parseOperations(parsed.operations);
        var jsonBlockMatch = rawContent.match(JSON_BLOCK_RE);
        if (jsonBlockMatch) reply = (rawContent.slice(0, jsonBlockMatch.index) + rawContent.slice(jsonBlockMatch.index + jsonBlockMatch[0].length)).trim();
      }

      // Send operation_preview
      if (operations.length > 0) {
        sendSSE('operation_preview', {
          operation_count: operations.length,
          files: operations.map(function(op) { return op.path || ''; }).filter(Boolean).slice(0, 20)
        });
      }

      // Update session
      if (sessionData && aiResult.finalMessages && Array.isArray(aiResult.finalMessages)) {
        var initialMsgsLen = messages.length;
        var newMsgs = aiResult.finalMessages.slice(initialMsgsLen);
        // P0 Fix: 使用稳定 message_id 去重
        var seenIds = new Set();
        for (var m = 0; m < sessionData.history.length; m++) {
          var h = sessionData.history[m];
          if (h.message_id) seenIds.add(h.message_id);
        }
        var userMsgId = body.client_request_id || ('umsg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 8));
        if (!seenIds.has(userMsgId)) {
          sessionData.history.push({ role: 'user', content: message, message_id: userMsgId, turn_id: body.client_request_id || '' });
          seenIds.add(userMsgId);
        }
        for (var i = 0; i < newMsgs.length; i++) {
          var msg = newMsgs[i];
          if (!msg || typeof msg !== 'object') continue;
          if (msg.reasoning_content) {
            msg = Object.assign({}, msg);
            delete msg.reasoning_content;
          }
          var msgId = msg.message_id || ('amsg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 8) + '_' + i);
          if (!seenIds.has(msgId)) {
            msg.message_id = msgId;
            sessionData.history.push(msg);
            seenIds.add(msgId);
          }
        }
        if (sessionData.history.length > MAX_SESSION_MESSAGES) {
          var keepHead = Math.floor(CHECKPOINT_KEEP / 2);
          var keepTail = MAX_SESSION_MESSAGES - keepHead - 2;
          var totalMsgs = sessionData.history.length;
          if (totalMsgs > keepHead + keepTail + 2) {
            var msgHead = sessionData.history.slice(0, keepHead);
            var msgTail = sessionData.history.slice(totalMsgs - keepTail);
            sessionData.history = msgHead.concat([
              { role: 'user', content: '[早期对话已自动压缩，当前继续最近上下文。]' },
              { role: 'assistant', content: '已理解，将继续基于当前上下文回复。' }
            ]).concat(msgTail);
          }
        }
        sessionData.messageCount = sessionData.history.length;
        touchSession(sessionData);
      }

      // Build context info
      var filesReadMap = {};
      var readTokens = 0;
      toolTrace.forEach(function(entry) {
        readTokens += entry.context_tokens || 0;
        if (entry.path) {
          if (!filesReadMap[entry.path]) filesReadMap[entry.path] = [];
          (entry.ranges || []).forEach(function(range) { filesReadMap[entry.path].push(range); });
        }
        (entry.files || []).forEach(function(file) {
          if (!filesReadMap[file.path]) filesReadMap[file.path] = [];
          (file.ranges || []).forEach(function(range) { filesReadMap[file.path].push(range); });
        });
      });
      var filesRead = Object.keys(filesReadMap).sort().map(function(path) { return { path: path, ranges: filesReadMap[path] }; });
      var usage = aiResult.usage || null;
      if (usage && typeof usage.prompt_cache_hit_tokens === 'number') {
        var cacheTotal = usage.prompt_cache_hit_tokens + (Number(usage.prompt_cache_miss_tokens) || 0);
        usage.prompt_cache_hit_ratio = cacheTotal > 0 ? usage.prompt_cache_hit_tokens / cacheTotal : 0;
      }

      // Send usage
      sendSSE('usage', {
        model: aiResult.model || model,
        input_tokens: usage ? usage.prompt_tokens : null,
        output_tokens: usage ? usage.completion_tokens : null,
        cache_hit_tokens: usage ? usage.prompt_cache_hit_tokens : null,
        cache_miss_tokens: usage ? usage.prompt_cache_miss_tokens : null,
        tool_read_tokens: readTokens,
        tool_calls: toolTrace.length,
        total_duration_ms: Date.now() - requestStartTime
      });

      // Send done
      sendSSE('done', {
        reply: reply.trim(),
        operations: operations,
        context_info: {
          indexed: !!indexSummary,
          active_file: activePath || null,
          open_files: openFiles.map(function(file) { return file.path; }),
          files_read: filesRead,
          total_files_read: filesRead.length,
          total_tool_calls: toolTrace.length,
          total_tokens: readTokens
        },
        tool_trace: toolTrace.map(function(t) {
          return { tool: t.tool, ok: t.ok, duration_ms: t.duration_ms, summary: t.summary || '' };
        }),
        runtime: {
          model: aiResult.model || model,
          thinking_mode: thinkingMode,
          requestedThinkingMode: requestedThinkingMode,
          effectiveThinkingMode: aiResult && aiResult.thinking_mode ? aiResult.thinking_mode : thinkingMode,
          thinkingEnabled: !!(aiResult && aiResult.reasoning && aiResult.reasoning.length > 0),
          reasoningTokens: aiResult && typeof aiResult.reasoning_tokens === 'number' ? aiResult.reasoning_tokens : (aiResult && aiResult.reasoning ? '供应商未返回' : null),
          thinkingFallback: (aiResult && aiResult.thinking_fallback === true) ? true : false,
          prompt_tokens: promptTokens,
          completion_tokens: usage ? usage.completion_tokens : null,
          total_duration_ms: Date.now() - requestStartTime,
          // AI 文档能力
          canReadDocx: capabilities.canReadDocx === true,
          canWriteDocx: capabilities.canWriteDocx === true,
          canReadXlsx: capabilities.canReadXlsx === true,
          canWriteXlsx: capabilities.canWriteXlsx === true,
          canReadPdf: capabilities.canReadPdf === true,
          canWritePdf: capabilities.canWritePdf === true
        },
        usage: usage
      });

      // Phase 3: Flush pending deltas and mark session as completed
      eventLogger.flush().catch(function() {});
      if (streamSession.isResumeEnabled() && supabase) {
        streamSession.updateStreamSession(supabase, streamId, {
          status: 'completed',
          completed_at: new Date().toISOString()
        }).catch(function() {});
      }

      cleanup();
    } catch (err) {
      if (aborted || (err && err.name === 'AbortError')) {
        if (!finalized) {
          sendSSE('error', { code: 'REQUEST_CANCELLED', message: '请求已取消', retryable: false, phase: 'cancelled' });
        }
        // Phase 3: Mark session as cancelled
        if (streamSession.isResumeEnabled() && supabase) {
          eventLogger.flush().catch(function() {});
          streamSession.updateStreamSession(supabase, streamId, {
            status: 'cancelled',
            completed_at: new Date().toISOString()
          }).catch(function() {});
        }
        cleanup();
        return;
      }
      var errMsg = err && err.message ? err.message : String(err);
      console.error('[code-agent-stream] Error:', errMsg, 'phase:', finalized ? 'finalized' : 'active');
      var structured = aiCoreErrorMapper.classifyError(err, { requestId: requestId, phase: 'stream' });
      sendStreamError(structured.code, structured.error, structured.phase);
    }
  });

  // ── Phase 3: Stream resume endpoint ────────────────────────────────────
  app.get('/api/code/chat/stream/resume', rateLimit(60000, 30), authenticateUser, async function(req, res) {
    var resumeEnabled = streamSession.isResumeEnabled();
    if (!resumeEnabled) {
      return res.status(503).json({ ok: false, code: 'RESUME_DISABLED', error: '流式恢复功能未启用' });
    }

    var streamId = String(req.query.stream_id || '');
    var afterEventId = parseInt(req.query.after_event_id, 10) || 0;
    var userId = String(req.userName || '');
    var workspaceId = String(req.query.workspace_id || '').slice(0, 200);
    var workspaceGeneration = parseInt(req.query.workspace_generation, 10) || 0;
    var clientRequestId = String(req.query.client_request_id || '');

    if (!streamId) {
      return res.status(400).json({ ok: false, code: 'INVALID_STREAM_ID', error: '缺少 stream_id' });
    }

    try {
      // Validate session
      var session = await streamSession.getStreamSession(supabase, streamId);
      if (!session) {
        return res.status(404).json({ ok: false, code: 'STREAM_NOT_FOUND', error: '流式会话不存在' });
      }

      // Ownership check
      if (session.user_id !== userId) {
        return res.status(403).json({ ok: false, code: 'STREAM_NOT_OWNED', error: '无权访问该流式会话' });
      }

      // Phase 3-P0-4: Validate workspace_generation to prevent stale session recovery
      if (workspaceGeneration && session.workspace_generation != null &&
          session.workspace_generation !== workspaceGeneration) {
        return res.status(409).json({ ok: false, code: 'GENERATION_MISMATCH', error: '工作区版本不匹配，可能已重建索引' });
      }

      // Phase 3-P0-4: Validate client_request_id to prevent cross-request recovery
      if (clientRequestId && session.client_request_id !== clientRequestId) {
        return res.status(409).json({ ok: false, code: 'REQUEST_ID_MISMATCH', error: '请求ID不匹配' });
      }

      // Workspace match
      if (workspaceId && session.workspace_id && workspaceId !== session.workspace_id) {
        return res.status(409).json({ ok: false, code: 'WORKSPACE_MISMATCH', error: '工作区不匹配' });
      }

      // Expired check
      if (session.status === 'expired' || (session.expires_at && new Date(session.expires_at) < new Date())) {
        return res.status(410).json({ ok: false, code: 'STREAM_EXPIRED', error: '流式会话已过期' });
      }

      // Get events after the given event_id
      var events = await streamSession.getEventsAfter(supabase, streamId, afterEventId);

      // Determine response based on session status
      var response = {
        ok: true,
        stream_id: streamId,
        request_id: session.request_id,
        client_request_id: session.client_request_id,
        status: session.status,
        last_event_id: session.last_event_id,
        events: events,
        started_at: session.started_at,
        completed_at: session.completed_at
      };

      if (session.status === 'completed') {
        response.message = '流式会话已完成';
      } else if (session.status === 'running') {
        response.message = '流式会话仍在进行中';
      } else if (session.status === 'failed') {
        response.message = '流式会话已失败';
      } else if (session.status === 'cancelled') {
        response.message = '流式会话已取消';
      }

      return res.json(response);
    } catch (err) {
      console.error('[code-agent-resume] Error:', err.message);
      return res.status(500).json({ ok: false, code: 'RESUME_ERROR', error: '恢复失败: ' + (err.message || '') });
    }
  });

  // ── Phase 3: Stream cancel endpoint ────────────────────────────────────
  app.post('/api/code/chat/stream/cancel', rateLimit(60000, 30), authenticateUser, async function(req, res) {
    var resumeEnabled = streamSession.isResumeEnabled();
    if (!resumeEnabled) {
      return res.status(503).json({ ok: false, code: 'CANCEL_DISABLED', error: '取消功能未启用' });
    }

    var streamId = String(req.body.stream_id || '');
    var userId = String(req.userName || '');

    if (!streamId) {
      return res.status(400).json({ ok: false, code: 'INVALID_STREAM_ID', error: '缺少 stream_id' });
    }

    try {
      var session = await streamSession.getStreamSession(supabase, streamId);
      if (!session) {
        return res.status(404).json({ ok: false, code: 'STREAM_NOT_FOUND', error: '流式会话不存在' });
      }
      if (session.user_id !== userId) {
        return res.status(403).json({ ok: false, code: 'STREAM_NOT_OWNED', error: '无权操作该流式会话' });
      }

      // Phase 3-P0-3: Actually abort the running request
      var controller = streamAbortControllers.get(streamId);
      if (controller) {
        try { controller.abort(); } catch (_) {}
        streamAbortControllers.delete(streamId);
      }

      await streamSession.updateStreamSession(supabase, streamId, {
        status: 'cancelled',
        completed_at: new Date().toISOString()
      });

      return res.json({ ok: true, stream_id: streamId, status: 'cancelled', message: '流式会话已取消' });
    } catch (err) {
      console.error('[code-agent-cancel] Error:', err.message);
      return res.status(500).json({ ok: false, code: 'CANCEL_ERROR', error: '取消失败: ' + (err.message || '') });
    }
  });

  // ── Phase 3: Stream status check (for page-refresh recovery) ───────────
  app.get('/api/code/chat/stream/status', rateLimit(60000, 30), authenticateUser, async function(req, res) {
    var resumeEnabled = streamSession.isResumeEnabled();
    if (!resumeEnabled) {
      return res.json({ ok: true, has_running: false, sessions: [] });
    }

    var userId = String(req.userName || '');
    var workspaceId = String(req.query.workspace_id || '').slice(0, 200);
    var workspaceGeneration = parseInt(req.query.workspace_generation, 10) || 0;

    try {
      var query = supabase.from('ai_stream_sessions').select('*')
        .eq('user_id', userId)
        .eq('status', 'running')
        .order('started_at', { ascending: false })
        .limit(5);

      if (workspaceId) {
        query = query.eq('workspace_id', workspaceId);
      }

      var result = await query;
      if (result.error) {
        return res.json({ ok: true, has_running: false, sessions: [] });
      }

      var sessions = (result.data || []).map(function(s) {
        return {
          stream_id: s.stream_id,
          request_id: s.request_id,
          client_request_id: s.client_request_id,
          conversation_id: s.conversation_id,
          workspace_id: s.workspace_id,
          workspace_generation: s.workspace_generation,
          status: s.status,
          last_event_id: s.last_event_id,
          started_at: s.started_at,
          expires_at: s.expires_at
        };
      });

      return res.json({ ok: true, has_running: sessions.length > 0, sessions: sessions });
    } catch (err) {
      return res.json({ ok: true, has_running: false, sessions: [] });
    }
  });

};
