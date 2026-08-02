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
const MAX_SESSIONS = 200;
const MAX_SESSION_MESSAGES = 200;
const MAX_HISTORY_MSG_CHARS = 64 * 1024; // 每条历史消息 content 上限（64KB），防止缓存无界膨胀
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

// 截断单条历史消息的 content，防止超长工具结果撑爆内存缓存（不改原消息对象）
function clampHistoryMessage(msg) {
  if (!msg || typeof msg !== 'object') return msg;
  var content = msg.content;
  if (typeof content === 'string' && content.length > MAX_HISTORY_MSG_CHARS) {
    var copy = Object.assign({}, msg);
    copy.content = content.slice(0, MAX_HISTORY_MSG_CHARS) + '\n[内容过长，已截断]';
    return copy;
  }
  return msg;
}

function clampHistoryList(list) {
  if (!Array.isArray(list)) return list;
  return list.map(clampHistoryMessage);
}

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
  var safeHistory = clampHistoryList(history);
  var sessionData = {
    history: safeHistory || [],
    lastActive: Date.now(),
    userId: userId,
    workspaceId: workspaceId,
    generation: generation,
    createdAt: Date.now(),
    messageCount: Array.isArray(safeHistory) ? safeHistory.length : 0
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
    canWriteDocx: true,
    canReadXlsx: true,
    canWriteXlsx: true,
    canReadPdf: true,
    canWritePdf: false,
    canReadPptx: true,
    canWritePptx: true,
    // P1-5: 标记 DOCX/PPTX 修改为实验性
    docxExperimental: true,
    pptxExperimental: true,
    workspaceReadOnly: false
  };
}

// Only expose the deployment's configured model plus models returned by the
// authenticated provider probe. Never trust a client-supplied model string.
var CODE_THINKING_MODES = ['auto', 'off', 'low', 'medium', 'high', 'max'];
function getCodeModels(deps) {
  var capabilities = buildCodeCapabilities(deps);
  var configured = String(capabilities.model || '').trim();
  if (!configured) return { default_model: '', models: [] };
  var snapshot = {};
  if (typeof deps.getDeepSeekModelCatalog === 'function') {
    try { snapshot = deps.getDeepSeekModelCatalog() || {}; } catch (_) { snapshot = {}; }
  }
  var probed = Array.isArray(snapshot.models) ? snapshot.models : [];
  var ids = [configured];
  probed.forEach(function(entry) {
    var id = typeof entry === 'string' ? entry.trim() : String(entry && (entry.id || entry.name) || '').trim();
    if (id && ids.indexOf(id) < 0) ids.push(id);
  });
  var ready = snapshot.status === 'ready';
  return {
    default_model: configured,
    models: ids.map(function(id) {
      var entry = probed.filter(function(item) {
        var candidate = typeof item === 'string' ? item : (item && (item.id || item.name));
        return String(candidate || '').trim() === id;
      })[0];
      var modes = entry && Array.isArray(entry.supported_thinking_modes) ? entry.supported_thinking_modes.filter(function(mode) {
        return CODE_THINKING_MODES.indexOf(mode) >= 0;
      }) : CODE_THINKING_MODES.slice();
      return {
        id: id,
        name: String(entry && entry.display_name || id),
        provider: capabilities.provider || 'deepseek',
        description: id === configured ? '当前部署首选模型' : '已通过提供商探测的模型',
        supports_thinking: entry && typeof entry.supports_thinking === 'boolean' ? entry.supports_thinking : true,
        supported_thinking_modes: modes.length ? modes : ['auto', 'off'],
        supports_tools: capabilities.toolCallingEnabled === true,
        supports_attachments: true,
        supports_vision: !!(entry && entry.supports_vision === true),
        enabled: capabilities.agentEnabled === true && (id === configured || ready),
        availability: capabilities.agentEnabled !== true ? 'unavailable' :
          (ready ? 'ready' : (id === configured ? 'degraded' : 'unavailable')),
        probe_status: String(snapshot.status || 'idle'),
        capability_verified: !!(entry && (typeof entry.supports_thinking === 'boolean' || Array.isArray(entry.supported_thinking_modes) || typeof entry.supports_tools === 'boolean'))
      };
    })
  };
}
function resolveCodeModel(deps, requestedModelId) {
  var catalog = getCodeModels(deps);
  var requested = String(requestedModelId || catalog.default_model || '').trim();
  var model = catalog.models.filter(function(item) { return item.id === requested && item.enabled; })[0];
  return model ? { ok: true, model: model, catalog: catalog } : { ok: false, code: 'MODEL_NOT_AVAILABLE', model: null, catalog: catalog };
}
function resolveThinkingMode(requestedMode, message) {
  var requested = String(requestedMode || 'auto').trim().toLowerCase();
  if (CODE_THINKING_MODES.indexOf(requested) < 0) return { ok: false, requested: requested, effective: 'auto' };
  if (requested !== 'auto') return { ok: true, requested: requested, effective: requested };
  var simple = /^(列出|查看|打开|搜索|解释|有哪些|简单|怎么用|什么意思)/;
  return { ok: true, requested: requested, effective: simple.test(String(message || '').trim()) ? 'off' : 'high' };
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

function normalizeToolPath(p) {
  if (typeof p !== 'string' || !p.trim()) return '';
  var normalized = normalizeContextPath(p);
  return validatePath(normalized) ? normalized : '';
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
      if (docType !== 'xlsx' && docType !== 'docx' && docType !== 'pptx') continue;
      var docOps = op.document_operations;
      if (!Array.isArray(docOps) || docOps.length === 0) continue;
      var docOpsLimit = docType === 'docx' ? 30 : (docType === 'pptx' ? 20 : 20);
      ops.push({
        type: 'document',
        path: op.path.trim(),
        summary: summary,
        document_type: docType,
        document_operations: docOps.slice(0, docOpsLimit)
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

// The model can return syntactically valid line numbers that do not exist in
// the file it was actually given. Do this final context-aware check before an
// operation reaches the browser; otherwise the user only discovers the
// problem after clicking Apply. Truncated context is deliberately skipped so
// a partial preview never becomes a false rejection.
function validateOperationsAgainstContext(operations, files) {
  var byPath = new Map();
  (Array.isArray(files) ? files : []).forEach(function (file) {
    if (!file || typeof file.path !== 'string') return;
    byPath.set(normalizeContextPath(file.path), file);
  });

  var accepted = [];
  var rejected = [];
  (Array.isArray(operations) ? operations : []).forEach(function (op) {
    if (!op || op.type !== 'replace_range') {
      accepted.push(op);
      return;
    }

    var ext = String(op.path || '').split('.').pop().toLowerCase();
    if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx' || ext === 'pdf') {
      rejected.push({ path: op.path, code: 'DOCUMENT_OPERATION_REQUIRED' });
      return;
    }

    var file = byPath.get(normalizeContextPath(op.path));
    var content = file && typeof file.content === 'string' ? file.content : '';
    var isTruncated = content.indexOf('[Content truncated due to size limits]') >= 0;
    if (content && !isTruncated) {
      var totalLines = content.split('\n').length;
      if (op.start_line > totalLines || op.end_line > totalLines + 1) {
        rejected.push({
          path: op.path,
          code: 'LINE_RANGE_OUT_OF_BOUNDS',
          start_line: op.start_line,
          end_line: op.end_line,
          total_lines: totalLines
        });
        return;
      }
    }
    accepted.push(op);
  });

  return { operations: accepted, rejected: rejected };
}

function appendOperationWarnings(reply, rejected) {
  if (!Array.isArray(rejected) || rejected.length === 0) return reply;
  var details = rejected.slice(0, 5).map(function (item) {
    if (item.code === 'DOCUMENT_OPERATION_REQUIRED') {
      return item.path + ' requires a document operation';
    }
    return item.path + ' line range ' + item.start_line + '-' + item.end_line +
      ' is outside the supplied file (' + item.total_lines + ' lines)';
  });
  var warning = 'Some generated edits were skipped because they could not be safely applied: ' + details.join('; ') + '.';
  return reply ? reply + '\n\n' + warning : warning;
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
    '  - document_type: (for "document" type) "xlsx", "docx", or "pptx"',
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
    '- DOCX files can be modified. Use "document" type with document_type "docx" for DOCX text modifications. For modification requests, first confirm the target file and changes, then generate a document operation plan.',
    '- DOCX document operations: replace_text (replace specific text with optional occurrence for multi-match), insert_text (insert text at position), delete_text (delete specific text range), modify_paragraph (adjust paragraph content), modify_heading (change heading level=1-9 and/or text), modify_list (add/modify/remove list items with list_marker, action, item_text, item_index), modify_table_cell (change cell at row/col with table_marker).',
    '- PDF files are read-only for content analysis. Do not return document operations for PDF. For PDF modification requests, explain that PDF can be analyzed and you can generate a new markdown/text document based on the extracted content. PDF supports: text extraction, page analysis, and content summarization only.',
    '- PPTX files can be modified. Use "document" type with document_type "pptx" for slide text modifications. PPTX operations: replace_text (replace text on a slide, must specify slide number), insert_text (add text box to a slide), delete_text (remove text from a slide). Each operation MUST specify the target slide number (1-indexed). If slide is omitted or invalid, the operation will be rejected.',
    '',
    '【文档排版分析限制 - 必须遵守】',
    '- DOCX 文本通过 mammoth.extractRawText 提取，只能获得纯文本内容，无法可靠获得字体、字号、行距、页边距、真实分页和视觉布局。',
    '- 绝对禁止根据纯文本声称发现字体问题、字号问题、行距问题、表格布局问题、页数或标题样式问题。',
    '- 分析文档时，必须明确区分三类信息：',
    '  1. 正文内容分析（可判断）：逻辑结构、段落顺序、文字内容、明显的内容错误、重复段落、表述问题。',
    '  2. 结构信息分析（可判断）：文档中明确标注的标题级别、列表项顺序、表格行列数。',
    '  3. 视觉排版信息（不可判断）：字体名称、字体大小、行距、页边距、真实分页位置、颜色、对齐方式。',
    '- 当用户询问"文档排版有什么问题"或类似格式问题时，必须首先说明：当前仅基于纯文本提取，无法判断字体、字号、行距和视觉布局。只能分析内容逻辑和明显结构。',
    '- 只有后端明确提取并传入了相应的结构元数据（如字体、字号、样式信息），才允许做格式判断。如果未收到此类元数据，一律不得编造。',
    '- 文档提取的 metadata 中如果包含 messages 数组，那是 mammoth 的转换警告，不是排版分析结果，不得据此声称文档有格式问题。',
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
    '- 不得声称支持实际没有实现的文件修改能力。目前 DOCX 可读取、分析和修改；PDF 可读取和分析（不支持原位编辑，可生成新文档）；PPTX 可读取、分析和修改；XLSX 可读取、分析和修改。',
    '- 文件系统级的权限（如句柄可写）不代表你具备修改该格式的能力。如果文件格式不在支持修改的列表中，请明确告知仅支持读取。',
    '- 项目索引中的"文件数"和"代码块数"只表示索引规模，不代表这些内容已进入当前上下文。用户询问上下文使用时，必须区分索引规模和实际读取量。',
    '- 前端徽章、API capabilities 和你的自述必须使用同一数据源，不得矛盾。',
    '- 绝对禁止回答中包含以下内容：自称 Claude、自称 Anthropic 模型、声称 200K tokens 上下文、声称 15 万英文单词等编造数字。'
  ].join('\n');
}

function inferInitialToolChoice(message, indexSummary, openFiles, activePath) {
  var text = String(message || '').trim().toLowerCase();
  var hasOpenFiles = Array.isArray(openFiles) && openFiles.length > 0;

  // Identity questions must use server-provided runtime data. Relying only
  // on the prompt lets the provider guess its model or claim a wrong vendor.
  if (/^(你是谁|你叫什么|你是什么模型|who are you|what are you|what model are you)[\s\?\!\.,，。！？、]*$/i.test(text)) {
    return { type: 'function', function: { name: 'get_runtime_capabilities' } };
  }
  
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

  // P1-6: 根据当前消息判断是否需要注入文档正文
  // 能力咨询、普通聊天、简单问候不注入文档正文
  var shouldInjectDocs = needsDocumentContext(currentMessage);
  var injectedChars = 0;
  var fileContentChars = 0;
  
  if (shouldInjectDocs) {
    // 文档正文注入受 token 预算约束：预算充足时每文件最多 32000 字符，
    // 预算紧张时按比例缩减，避免单条 user 消息撑爆上下文。
    var docBudgetTokens = (typeof inputBudget === 'number' && inputBudget > 0) ? inputBudget : 64000;
    var docCharsPerFile = Math.max(4000, Math.min(32000, Math.floor(docBudgetTokens * 2)));
    var hasOpenFileContent = false;
    for (var ofi = 0; ofi < openFiles.length; ofi++) {
      var of = openFiles[ofi];
      if (of.content && of.content.trim()) {
        hasOpenFileContent = true;
        break;
      }
    }
    if (hasOpenFileContent) {
      stateLines.push('');
      stateLines.push('【打开文档正文】');
      for (var ofj = 0; ofj < openFiles.length; ofj++) {
        var of2 = openFiles[ofj];
        if (of2.content && of2.content.trim()) {
          stateLines.push('--- ' + of2.path + ' ---');
          // 限制单文档在状态块中的注入长度，避免撑爆上下文
          var trimmed = of2.content.slice(0, docCharsPerFile);
          stateLines.push(trimmed);
          injectedChars += trimmed.length + of2.path.length + 10;
        }
      }
      stateLines.push('--- 文档正文结束 ---');
    }
  }
  
  // 计算附件中已注入的字符数（用于日志）
  var totalStateChars = stateLines.join('\n').length;
  
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

  var userContent = stateLines.join('\n');
  messages.push({ role: 'user', content: userContent });
  
  // P1-6: 上下文预算日志
  console.log('[code-agent] context_budget: injected_chars=' + injectedChars +
    ' total_state_chars=' + userContent.length + 
    ' doc_injected=' + shouldInjectDocs +
    ' open_files=' + openFiles.length);
  
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
  var capabilityRE = /(你支持|你可以|你能|你会|你懂|你认识|你能做|能不能|可否|是否可以|是否支持).*(修改|读取|写|文件|docx|pdf|pptx|xlsx|文档|项目|word|excel|ppt|格式|能力|编辑|更改|变更)/i;
  if (capabilityRE.test(msg)) return false;

  // 简短的不明确问题不需要项目上下文（如 "？", "修改一下", "这个", "改"）
  if (msg.length <= 10 && !/(代码|bug|报错|错误|修复|项目|文件|代码|函数|重构|检查|查看|分析|找到|定位|追踪|为什么|怎么|如何)/i.test(msg)) return false;

  // 不明确的修改请求 — 缺少修改目标和内容
  var ambiguousModifyRE = /^(修改一下|改一下|改改|帮我改|修改这个|改这个|改|修改)$/i;
  if (ambiguousModifyRE.test(msg)) return false;

  // 文档内容提问 — 如果用户是针对已打开的文档内容提问，不需要项目索引
  var docContentRE = /(这个文档|这篇文章|这段内容|总结|概括|分析一下|帮我看看|内容|说了什么|讲什么|什么意思|帮我总结|概述)/i;
  if (docContentRE.test(msg) && msg.length < 200) return false;

  // 导出请求 — 不需要项目索引
  var exportRE = /(导出|下载|保存为|另存为|生成.*(pdf|文档|报告))/i;
  if (exportRE.test(msg)) return false;

  // 明确要求读取、检查、修改、分析项目、找bug、代码相关，需要项目上下文
  var requiresContextRE = /(分析.*项目|检查.*(整个项目|项目|bug)|修改.*(代码|文件)|总结.*文档|读取.*(项目|代码|文件|\.(js|ts|jsx|tsx|py|java|go|rs|html|css|json|md|docx?|pdf|xlsx?|pptx?)\b)|查找.*函数|修复.*报错|这个文件|看看|有什么问题|重构|解析|总结一下)/i;
  if (requiresContextRE.test(msg)) return true;

  // 如果不包含明确的项目操作词汇，就不强求重建索引（避免普通问题被拦截）
  return false;
}

// P1-6: 判断是否需要注入文档正文到上下文
// 能力咨询、普通聊天、简单问候不读取文档正文
function needsDocumentContext(message) {
  var msg = String(message || '').trim();
  if (!msg) return false;
  
  // 能力咨询不需要文档正文
  var capabilityRE = /(你支持|你可以|你能|你会|你懂|你认识|你能做|能不能|可否|是否支持|可以).*(修改|读取|写|docx|pdf|pptx|xlsx|文档|word|excel|ppt|格式|能力|编辑|更改|变更|文档|分析)/i;
  if (capabilityRE.test(msg)) return false;
  
  // 简单问候、聊天不需要文档正文
  var simpleChatRE = /^(你好|hi|hello|早上好|晚上好|下午好|再见|谢谢|多谢|辛苦了|ok|好的|嗯|哦|知道了|你是谁|你叫什么|你是什么模型|你在干嘛|在吗|有人吗|测试|test)[\s\?\!\。，、]*$/i;
  if (simpleChatRE.test(msg)) return false;
  
  // 运行时能力询问不需要文档正文
  var runtimeRE = /(上下文多大|还剩多少|最大输出|支持工具|当前思考|缓存命中|token|模型|provider)/i;
  if (runtimeRE.test(msg) && msg.length < 60) return false;
  
  // 文档相关的问题需要文档正文
  var docRelatedRE = /(文档|docx|doc|word|pdf|pptx|ppt|xlsx|excel|表格|文件|内容|段落|标题|排版|格式|字体|字号|修改|替换|删除|插入|添加|改写|编辑|调整|帮我|总结|分析|看看|检查|这个|这段|读取|打开)/i;
  return docRelatedRE.test(msg);
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
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { __parseError: true };
  } catch (_) {
    return { __parseError: true };
  }
}

function createCodeToolExecutor(scope, activePath, openFiles, attachments, trace, maxInputTokens, deps, runtimeCapabilities) {
  deps = deps || {};
  runtimeCapabilities = runtimeCapabilities || {};
  var overlay = new Map();
  var overlayFiles = openFiles.concat(attachments);
  var overlayBasenames = new Map();
  overlayFiles.forEach(function(file) {
    if (!overlay.has(file.path)) overlay.set(file.path, file);
    var basename = file.path.split('/').pop();
    if (!basename) return;
    if (overlayBasenames.has(basename)) overlayBasenames.set(basename, null);
    else overlayBasenames.set(basename, file);
  });
  var remainingTokens = Math.max(0, maxInputTokens);

  function resolveOverlayFile(path) {
    var normalized = normalizeToolPath(path);
    if (!normalized) return null;
    if (overlay.has(normalized)) return overlay.get(normalized);
    var basename = normalized.split('/').pop();
    return overlayBasenames.get(basename) || null;
  }

  function wildcardMatch(value, pattern) {
    if (!pattern) return true;
    try {
      var escaped = String(pattern).slice(0, 120).replace(/[.+^${}()|[\]\\]/g, '\\$&');
      return new RegExp('^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i').test(value);
    } catch (_) {
      return false;
    }
  }

  function listOverlayFiles(directory, depth, pattern) {
    var normalizedDirectory = directory ? normalizeToolPath(directory) : '';
    if (directory && !normalizedDirectory) return { ok: false, code: 'INVALID_PATH', error: '目录路径无效' };
    var maxDepth = Number.isSafeInteger(depth) ? Math.min(Math.max(depth, 0), 8) : 3;
    var prefix = normalizedDirectory ? normalizedDirectory.replace(/\/$/, '') + '/' : '';
    var files = [];
    var directories = {};
    overlayFiles.forEach(function(file) {
      var path = file.path;
      if (prefix && path.indexOf(prefix) !== 0) return;
      var relative = prefix ? path.slice(prefix.length) : path;
      var parts = relative.split('/');
      if (parts.length - 1 > maxDepth || !wildcardMatch(parts[parts.length - 1], pattern)) return;
      files.push({
        path: path,
        name: parts[parts.length - 1],
        language: file.language || '',
        size: Buffer.byteLength(file.content || '', 'utf8'),
        symbols: [],
        chunkCount: 0
      });
      for (var i = 0; i < parts.length - 1; i++) {
        var dirPath = prefix + parts.slice(0, i + 1).join('/');
        if (!directories[dirPath]) directories[dirPath] = 0;
        directories[dirPath]++;
      }
    });
    files.sort(function(a, b) { return a.path.localeCompare(b.path); });
    var totalFiles = files.length;
    var truncated = totalFiles > 200;
    if (truncated) files = files.slice(0, 200);
    return {
      ok: true,
      source: 'open_files',
      indexed: false,
      directory: normalizedDirectory || '/',
      directories: Object.keys(directories).sort().map(function(path) { return { path: path, fileCount: directories[path] }; }),
      files: files,
      totalFiles: totalFiles,
      returnedFiles: files.length,
      truncated: truncated,
      totalCount: totalFiles
    };
  }

  function searchOverlay(query, options) {
    var text = String(query || '').trim();
    if (!text) return { ok: false, code: 'QUERY_REQUIRED', error: 'Query is required' };
    options = options || {};
    var pathFilter = options.path ? normalizeToolPath(options.path) : '';
    if (options.path && !pathFilter) return { ok: false, code: 'INVALID_PATH', error: '文件路径无效' };
    var extensions = Array.isArray(options.extensions) ? options.extensions.slice(0, 20).map(function(ext) {
      ext = String(ext || '').toLowerCase();
      return ext.charAt(0) === '.' ? ext : '.' + ext;
    }) : null;
    var terms = text.split(/[\s,，。；;:：]+/).filter(Boolean).slice(0, 20);
    if (!terms.length) terms = [text];
    var maxResults = Math.min(Math.max(Number(options.maxResults) || 20, 1), 40);
    var allResults = [];
    overlayFiles.forEach(function(file) {
      if (pathFilter && file.path.indexOf(pathFilter) === -1) return;
      if (extensions && extensions.length && extensions.indexOf(file.path.slice(file.path.lastIndexOf('.')).toLowerCase()) === -1) return;
      var lines = String(file.content || '').split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var lower = line.toLowerCase();
        var matched = terms.some(function(term) { return lower.indexOf(String(term).toLowerCase()) >= 0; });
        if (!matched) continue;
        allResults.push({
          path: file.path,
          name: file.path.split('/').pop(),
          language: file.language || '',
          chunkId: 'overlay_' + file.path + '_' + (i + 1),
          startLine: i + 1,
          endLine: i + 1,
          content: line,
          score: 1,
          tokenEstimate: codeIndex.estimateTokens(line)
        });
      }
    });
    return {
      ok: true,
      source: 'open_files',
      indexed: false,
      query: text,
      results: allResults.slice(0, maxResults),
      totalHits: allResults.length,
      truncated: allResults.length > maxResults,
      keywords: terms
    };
  }

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
    if (result && result.code) entry.code = String(result.code).slice(0, 80);
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
    var normalizedPath = normalizeToolPath(path);
    if (!normalizedPath) return { ok: false, code: 'INVALID_PATH', error: '文件路径无效' };
    var overlayFile = resolveOverlayFile(normalizedPath);
    if (overlayFile) return fileToToolResult(overlayFile, startLine, endLine);
    var range = codeIndex.readFileRange(scope, normalizedPath, startLine || 1, endLine || 1000000);
    if (!range || !range.ok) return range;
    var actualStart = Array.isArray(range.lines) && range.lines.length ? range.lines[0].lineNum : range.startLine;
    var actualEnd = Array.isArray(range.lines) && range.lines.length ? range.lines[range.lines.length - 1].lineNum : actualStart;
    return {
      ok: true,
      path: normalizedPath,
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
    if (args && args.__parseError) return record(name, {}, startedAt, { ok: false, code: 'INVALID_TOOL_ARGUMENTS', error: '工具参数 JSON 无效' });
    if (remainingTokens < 1024 && name !== 'get_open_files') return record(name, args, startedAt, { ok: false, error: '本轮上下文预算已用完，请基于已读取内容回答' });
    try {
      if (name === 'list_files') {
        result = codeIndex.listFiles(scope, args.directory || '', Math.min(Math.max(Number(args.depth) || 3, 0), 8), args.pattern || '');
        if (result && result.code === 'INDEX_NOT_FOUND' && overlayFiles.length) result = listOverlayFiles(args.directory || '', Number(args.depth) || 3, args.pattern || '');
      } else if (name === 'search_code') {
        result = codeIndex.searchCode(scope, String(args.query || ''), { path: args.path || null, extensions: Array.isArray(args.extensions) ? args.extensions.slice(0, 20) : null, maxResults: Math.min(Math.max(Number(args.max_results) || 20, 1), 40) });
        if (result && result.code === 'INDEX_NOT_FOUND' && overlayFiles.length) result = searchOverlay(String(args.query || ''), { path: args.path || null, extensions: args.extensions, maxResults: args.max_results });
      } else if (name === 'read_file') {
        result = readPath(String(args.path || ''), 1, 1000000);
      } else if (name === 'read_file_range') {
        result = readPath(String(args.path || ''), Math.max(Number(args.start_line) || 1, 1), Math.min(Math.max(Number(args.end_line) || Number(args.start_line) || 1, 1), 1000000));
      } else if (name === 'get_symbols') {
        result = codeIndex.getFileSymbols(scope, normalizeToolPath(String(args.path || '')));
      } else if (name === 'get_active_file') {
        result = activePath ? readPath(activePath, 1, 1000000) : { ok: false, code: 'ACTIVE_FILE_MISSING', error: '当前没有打开文件' };
      } else if (name === 'get_open_files') {
        result = { ok: true, source: 'open_files', indexed: false, activePath: activePath || '', files: openFiles.concat(attachments).map(function(file) { return { path: file.path, name: file.name, sha256: file.sha256, source: file.source, size: Buffer.byteLength(file.content || '', 'utf8') }; }) };
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
        result = { ok: false, code: 'UNSUPPORTED_TOOL', error: '不支持的工具: ' + name };
      }
    } catch (error) {
      result = { ok: false, code: 'TOOL_EXECUTION_FAILED', error: error && error.message ? error.message : '工具执行失败' };
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

async function validateOfficeApplyInput(buffer, documentType, mimeType, fileName) {
  var expected = String(documentType || '').toLowerCase();
  var byName = detectMimeFromFileName(fileName);
  var expectedMime = expected === 'docx'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : (expected === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : (expected === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : ''));
  if (!expectedMime || (byName !== 'application/octet-stream' && byName !== expectedMime) ||
      (mimeType && mimeType !== expectedMime)) {
    throw new Error('文档类型与文件名或 MIME 类型不一致');
  }
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.subarray(0, 2).toString('ascii') !== 'PK') {
    throw new Error('Office 文件签名无效');
  }
  await validateOfficeArchive(buffer, expected);
  return expectedMime;
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

// ── DOCX modification operations ──────────────────────────────────────
var MAX_DOCX_OPS = 30;
var MAX_DOCX_TEXT_LEN = 50000;
var MAX_DOCX_NEW_SIZE = 50 * 1024 * 1024; // 50MB output limit

// P0-2: OOXML 结构化解析器 — 建立 paragraph/run/text node 映射
// 返回 { paragraphs: [...], flatText: '', charMap: [...] }
// charMap[i] = { pIdx, rIdx, tIdx, charInT }
function parseDocxDocumentXml(xml) {
  var paragraphs = [];
  var flatText = '';
  var charMap = []; // maps flatText char index -> { pIdx, rIdx, tIdx, charInT }

  // 找到所有 w:p 元素（处理嵌套和自闭合）
  var pRE = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  var pMatch;
  var pIdx = 0;
  
  while ((pMatch = pRE.exec(xml)) !== null) {
    var pXml = pMatch[0];
    var pStart = pMatch.index;
    var pEnd = pMatch.index + pXml.length;
    
    var runs = [];
    
    // 找到该段落内的所有 w:r 元素
    var rRE = /<w:r[\s>][\s\S]*?<\/w:r>/g;
    var rMatch;
    var rIdx = 0;
    
    while ((rMatch = rRE.exec(pXml)) !== null) {
      var rXml = rMatch[0];
      var rStartInP = rMatch.index;
      var rEndInP = rMatch.index + rXml.length;
      
      // 提取 w:rPr（样式信息）
      var rPr = '';
      var rPrMatch = rXml.match(/<w:rPr[\s>][\s\S]*?<\/w:rPr>/);
      if (rPrMatch) rPr = rPrMatch[0];
      
      var textNodes = [];
      
      // 找到该 run 内的所有 w:t 元素
      var tRE = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
      var tMatch;
      var tIdx = 0;
      
      while ((tMatch = tRE.exec(rXml)) !== null) {
        var tText = unescapeXml(tMatch[1] || '');
        var tStartInR = tMatch.index;
        var tEndInR = tMatch.index + tMatch[0].length;
        
        textNodes.push({
          text: tText,
          startInR: tStartInR,
          endInR: tEndInR,
          fullMatch: tMatch[0]
        });
        
        // 记录到 charMap
        for (var ci = 0; ci < tText.length; ci++) {
          charMap.push({
            pIdx: pIdx,
            rIdx: rIdx,
            tIdx: tIdx,
            charInT: ci
          });
        }
        
        flatText += tText;
        tIdx++;
      }
      
      // 处理没有文本的 run（如仅有图片或分隔符的 run）
      runs.push({
        xml: rXml,
        rPr: rPr,
        textNodes: textNodes,
        startInP: rStartInP,
        endInP: rEndInP,
        totalTextLen: textNodes.reduce(function(sum, tn) { return sum + tn.text.length; }, 0)
      });
      
      rIdx++;
    }
    
    // 提取段落属性
    var pPr = '';
    var pPrMatch = pXml.match(/<w:pPr[\s>][\s\S]*?<\/w:pPr>/);
    if (pPrMatch) pPr = pPrMatch[0];
    
    paragraphs.push({
      xml: pXml,
      pPr: pPr,
      runs: runs,
      start: pStart,
      end: pEnd,
      totalTextLen: runs.reduce(function(sum, r) { return sum + r.totalTextLen; }, 0)
    });
    
    // 段落间添加换行符
    if (pIdx > 0 && paragraphs[pIdx - 1].totalTextLen > 0) {
      flatText += '\n';
      charMap.push({ pIdx: pIdx, rIdx: -1, tIdx: -1, charInT: -1, isParaSep: true });
    }
    
    pIdx++;
  }
  
  return {
    paragraphs: paragraphs,
    flatText: flatText,
    charMap: charMap
  };
}

// P0-2: 在解析后的文档中查找文本，支持 occurrence
// 返回 { found: true, startCharIdx, endCharIdx, occurrences: [...] } 或 { found: false }
function findTextInParsedDoc(parsedDoc, searchText, occurrence) {
  var flatText = parsedDoc.flatText;
  var charMap = parsedDoc.charMap;
  
  if (!searchText || flatText.length === 0) {
    return { found: false, error: '搜索文本为空或文档无内容' };
  }
  
  // 收集所有匹配位置
  var occurrences = [];
  var searchFrom = 0;
  while (searchFrom < flatText.length) {
    var idx = flatText.indexOf(searchText, searchFrom);
    if (idx === -1) break;
    occurrences.push({ start: idx, end: idx + searchText.length });
    searchFrom = idx + 1;
  }
  
  if (occurrences.length === 0) {
    return { found: false, error: '在文档中未找到指定文本', occurrences: [] };
  }
  
  // 如果指定了 occurrence，只取对应位置
  if (typeof occurrence === 'number' && occurrence >= 0 && occurrence < occurrences.length) {
    var occ = occurrences[occurrence];
    return { found: true, startCharIdx: occ.start, endCharIdx: occ.end, occurrences: occurrences, selectedOccurrence: occurrence };
  }
  
  // 如果指定了 occurrence 但超出范围
  if (typeof occurrence === 'number' && occurrence >= occurrences.length) {
    return { found: false, error: 'occurrence ' + occurrence + ' 超出范围，共找到 ' + occurrences.length + ' 处匹配', occurrences: occurrences };
  }
  
  // 多个匹配但未指定 occurrence — 拒绝执行
  if (occurrences.length > 1) {
    return { found: false, error: '找到 ' + occurrences.length + ' 处匹配，请指定 occurrence 参数明确要修改哪一处（0-' + (occurrences.length - 1) + '）', occurrences: occurrences };
  }
  
  return { found: true, startCharIdx: occurrences[0].start, endCharIdx: occurrences[0].end, occurrences: occurrences };
}

// P0-2: 在解析后的文档中替换指定范围的文本
// 修改 charMap 中对应的 runs，只修改被影响的 runs
function replaceTextInParsedDoc(parsedDoc, startCharIdx, endCharIdx, newText) {
  var charMap = parsedDoc.charMap;
  var paragraphs = parsedDoc.paragraphs;
  
  if (startCharIdx < 0 || endCharIdx > charMap.length || startCharIdx >= endCharIdx) {
    return { ok: false, error: '替换范围无效' };
  }
  
  // 收集受影响的 (pIdx, rIdx, tIdx) 组合
  // 使用 Map 避免重复
  var affectedRuns = new Map(); // key: "pIdx:rIdx" -> { pIdx, rIdx, charStartInT, charEndInT }
  var affectedTextNodes = new Map(); // key: "pIdx:rIdx:tIdx" -> { pIdx, rIdx, tIdx, action }
  
  for (var ci = startCharIdx; ci < endCharIdx; ci++) {
    var cm = charMap[ci];
    if (!cm || cm.isParaSep) continue;
    
    var runKey = cm.pIdx + ':' + cm.rIdx;
    if (!affectedRuns.has(runKey)) {
      affectedRuns.set(runKey, { pIdx: cm.pIdx, rIdx: cm.rIdx });
    }
    
    var tnKey = cm.pIdx + ':' + cm.rIdx + ':' + cm.tIdx;
    if (!affectedTextNodes.has(tnKey)) {
      affectedTextNodes.set(tnKey, { pIdx: cm.pIdx, rIdx: cm.rIdx, tIdx: cm.tIdx });
    }
  }
  
  if (affectedRuns.size === 0) {
    return { ok: false, error: '没有找到可修改的文本节点' };
  }
  
  // 对每个受影响的 run，重新构建其文本
  var runModifications = []; // [{ pIdx, rIdx, oldXml, newXml }]
  var replacementInserted = false;
  
  affectedRuns.forEach(function(runInfo) {
    var pIdx = runInfo.pIdx;
    var rIdx = runInfo.rIdx;
    var paragraph = paragraphs[pIdx];
    if (!paragraph || !paragraph.runs[rIdx]) return;
    
    var run = paragraph.runs[rIdx];
    var textNodes = run.textNodes;
    
    // 构建该 run 中每个字符的原始索引
    var runStartInFlat = -1;
    for (var fi = 0; fi < charMap.length; fi++) {
      if (charMap[fi].pIdx === pIdx && charMap[fi].rIdx === rIdx && charMap[fi].tIdx === 0 && charMap[fi].charInT === 0) {
        runStartInFlat = fi;
        break;
      }
    }
    
    if (runStartInFlat === -1) return;
    
    // 重建该 run 的文本
    var newRunXml = run.xml;
    
    // 对每个 text node，检查是否需要修改
    for (var ti = 0; ti < textNodes.length; ti++) {
      var tn = textNodes[ti];
      var tnStart = -1;
      
      // 找到该 text node 在 flatText 中的起始位置
      for (var fj = 0; fj < charMap.length; fj++) {
        if (charMap[fj].pIdx === pIdx && charMap[fj].rIdx === rIdx && charMap[fj].tIdx === ti && charMap[fj].charInT === 0) {
          tnStart = fj;
          break;
        }
      }
      
      if (tnStart === -1) continue;
      var tnEnd = tnStart + tn.text.length;
      
      // 检查这个 text node 是否与替换范围重叠
      if (tnEnd <= startCharIdx || tnStart >= endCharIdx) {
        continue; // 不重叠，保持不变
      }
      
      // 计算新文本
      var newTnText = '';
      for (var ci2 = tnStart; ci2 < tnEnd; ci2++) {
        if (ci2 >= startCharIdx && ci2 < endCharIdx) {
          // 在替换范围内：使用新文本中的对应字符
          if (!replacementInserted && ci2 === Math.max(tnStart, startCharIdx)) {
            newTnText += newText;
            replacementInserted = true;
          }
          // 如果新文本比旧文本短，跳过
        } else {
          // 不在替换范围内：保留原字符
          if (ci2 < charMap.length && charMap[ci2] && !charMap[ci2].isParaSep) {
            // 原字符是 flatText 中的字符
            newTnText += flatTextAt(parsedDoc, ci2);
          }
        }
      }
      
      // 确保不会因多个 run 导致重复写入
      // 如果该 text node 完全在替换范围内，且是第一个 text node，替换整个内容
      // 替换该 text node
      var escapedNew = escapeXml(newTnText);
      var newTXml = tn.fullMatch.replace(/>([\s\S]*?)<\/w:t>/, '>' + (newTnText.match(/^\s|[\s\xA0]$/) ? ' xml:space="preserve"' : '') + escapedNew.replace(/^xml:space="preserve"/, '') + '</w:t>');
      // 简化：直接重建
      newTXml = tn.fullMatch.replace(/^<w:t[^>]*>/, '<w:t xml:space="preserve">').replace(/>[\s\S]*?<\/w:t>$/, '>' + escapedNew + '</w:t>');
      newRunXml = newRunXml.replace(tn.fullMatch, newTXml);
    }
    
    runModifications.push({
      pIdx: pIdx,
      rIdx: rIdx,
      oldXml: run.xml,
      newXml: newRunXml
    });
  });
  
  return { ok: true, runModifications: runModifications };
}

function flatTextAt(parsedDoc, idx) {
  if (idx >= 0 && idx < parsedDoc.flatText.length) {
    return parsedDoc.flatText[idx];
  }
  return '';
}

// P0-2: 将 run 修改写回完整 XML
function applyRunModsToXml(originalXml, paragraphs, runModifications) {
  var xml = originalXml;
  // 从后往前替换，避免偏移问题
  runModifications.sort(function(a, b) { return b.pIdx - a.pIdx || b.rIdx - a.rIdx; });
  
  for (var ri = 0; ri < runModifications.length; ri++) {
    var mod = runModifications[ri];
    var paragraph = paragraphs[mod.pIdx];
    if (!paragraph || !paragraph.runs[mod.rIdx]) continue;
    var run = paragraph.runs[mod.rIdx];
    
    // 在原始 XML 中找到该 run 并替换
    // 使用 run.startInP + paragraph.start 来定位
    var absStart = paragraph.start + run.startInP;
    var absEnd = paragraph.start + run.endInP;
    
    if (absStart >= 0 && absEnd <= xml.length) {
      xml = xml.slice(0, absStart) + mod.newXml + xml.slice(absEnd);
    }
  }
  
  return xml;
}

// P0-2: 只修改段落中第一个文本 run，保留样式
function modifyParagraphSingleRun(xml, paragraphs, pIdx, newText) {
  var paragraph = paragraphs[pIdx];
  if (!paragraph || paragraph.runs.length === 0) return { ok: false, error: '段落无文本 run' };
  
  // 找到第一个包含文本的 run
  var firstTextRunIdx = -1;
  for (var ri = 0; ri < paragraph.runs.length; ri++) {
    if (paragraph.runs[ri].textNodes.length > 0 && paragraph.runs[ri].textNodes[0].text.length > 0) {
      firstTextRunIdx = ri;
      break;
    }
  }
  
  if (firstTextRunIdx === -1) return { ok: false, error: '段落中无文本内容' };
  
  var run = paragraph.runs[firstTextRunIdx];
  var tn = run.textNodes[0];
  
  // 只修改第一个 text node
  var escapedNew = escapeXml(newText);
  var newTXml = '<w:t xml:space="preserve">' + escapedNew + '</w:t>';
  var newRunXml = run.xml.replace(tn.fullMatch, newTXml);
  
  // 清空其他 text nodes
  if (run.textNodes.length > 1) {
    for (var ti = 1; ti < run.textNodes.length; ti++) {
      newRunXml = newRunXml.replace(run.textNodes[ti].fullMatch, '<w:t></w:t>');
    }
  }
  
  // 清空其他 runs 的文本，保留样式
  var allMods = [{
    pIdx: pIdx,
    rIdx: firstTextRunIdx,
    newXml: newRunXml
  }];
  
  for (var ri2 = 0; ri2 < paragraph.runs.length; ri2++) {
    if (ri2 === firstTextRunIdx) continue;
    var otherRun = paragraph.runs[ri2];
    var otherNewXml = otherRun.xml;
    for (var ti2 = 0; ti2 < otherRun.textNodes.length; ti2++) {
      otherNewXml = otherNewXml.replace(otherRun.textNodes[ti2].fullMatch, '<w:t></w:t>');
    }
    allMods.push({
      pIdx: pIdx,
      rIdx: ri2,
      newXml: otherNewXml
    });
  }
  
  return { ok: true, runModifications: allMods };
}

async function applyDocxOperations(buffer, operations, fileName) {
  var JSZip = require('jszip');
  if (operations.length > MAX_DOCX_OPS) {
    return { ok: false, error: '单次最多支持 ' + MAX_DOCX_OPS + ' 个 DOCX 修改操作' };
  }

  try {
    var zip = await JSZip.loadAsync(buffer);
    var documentXml = zip.file('word/document.xml');
    if (!documentXml) {
      return { ok: false, error: 'DOCX 文件结构无效：缺少 word/document.xml' };
    }

    var xml = await documentXml.async('string');
    var originalXml = xml;
    var appliedOps = [];
    var changes = [];
    
    // P0-2: 解析文档结构
    var parsedDoc = parseDocxDocumentXml(xml);

    for (var i = 0; i < operations.length; i++) {
      var op = operations[i];
      if (!op || typeof op !== 'object') continue;

      try {
        if (op.type === 'replace_text') {
          var oldText = String(op.old_text || '');
          var newText = String(op.new_text || '');
          if (!oldText) { changes.push({ type: 'replace_text', error: '缺少要替换的文本' }); continue; }
          if (newText.length > MAX_DOCX_TEXT_LEN) { changes.push({ type: 'replace_text', error: '新文本超过最大长度限制' }); continue; }
          
          // P0-2: 使用结构化查找，支持 occurrence
          var occurrence = typeof op.occurrence === 'number' ? op.occurrence : undefined;
          var findResult = findTextInParsedDoc(parsedDoc, oldText, occurrence);
          
          if (!findResult.found) {
            changes.push({ type: 'replace_text', oldText: oldText.slice(0, 100), newText: newText.slice(0, 100), error: findResult.error, occurrences: findResult.occurrences ? findResult.occurrences.length : 0 });
            continue;
          }
          
          // P0-2: 精确替换，保留样式
          var replaceResult = replaceTextInParsedDoc(parsedDoc, findResult.startCharIdx, findResult.endCharIdx, newText);
          if (!replaceResult.ok) {
            changes.push({ type: 'replace_text', error: replaceResult.error });
            continue;
          }
          
          xml = applyRunModsToXml(xml, parsedDoc.paragraphs, replaceResult.runModifications);
          // 重新解析以更新映射
          parsedDoc = parseDocxDocumentXml(xml);
          
          appliedOps.push({ type: 'replace_text', oldText: oldText, newText: newText, occurrence: findResult.selectedOccurrence });
          changes.push({ type: 'replace_text', oldText: oldText.slice(0, 100), newText: newText.slice(0, 100), occurrence: findResult.selectedOccurrence });
          
        } else if (op.type === 'insert_text') {
          var markerText = String(op.marker_text || '');
          var insertText = String(op.insert_text || '');
          if (!insertText) { changes.push({ type: 'insert_text', error: '缺少要插入的文本' }); continue; }
          if (insertText.length > MAX_DOCX_TEXT_LEN) { changes.push({ type: 'insert_text', error: '插入文本超过最大长度限制' }); continue; }
          
          if (!markerText) {
            // Insert at end of body
            var bodyCloseIdx = xml.lastIndexOf('</w:body>');
            if (bodyCloseIdx === -1) { changes.push({ type: 'insert_text', error: 'DOCX 结构无效' }); continue; }
            var paraXml = '<w:p><w:r><w:t xml:space="preserve">' + escapeXml(insertText) + '</w:t></w:r></w:p>';
            xml = xml.slice(0, bodyCloseIdx) + paraXml + xml.slice(bodyCloseIdx);
            parsedDoc = parseDocxDocumentXml(xml);
          } else {
            var findResult2 = findTextInParsedDoc(parsedDoc, markerText, 0);
            if (!findResult2.found) {
              changes.push({ type: 'insert_text', error: '未找到标记文本"' + markerText.slice(0, 50) + '"' });
              continue;
            }
            // 在匹配文本之后插入
            var insertPos = findResult2.endCharIdx;
            var insertXml2 = escapeXml(insertText);
            // 简化：在标记后添加新 run
            var cmEnd = parsedDoc.charMap[insertPos - 1];
            if (cmEnd && cmEnd.pIdx >= 0 && cmEnd.rIdx >= 0) {
              var para = parsedDoc.paragraphs[cmEnd.pIdx];
              var run = para.runs[cmEnd.rIdx];
              var absPos = para.start + run.endInP;
              var newRunXml2 = '<w:r><w:rPr></w:rPr><w:t xml:space="preserve">' + insertXml2 + '</w:t></w:r>';
              xml = xml.slice(0, absPos) + newRunXml2 + xml.slice(absPos);
              parsedDoc = parseDocxDocumentXml(xml);
            } else {
              // H-6: 标记文本位于段落/run 边界时 charMap 无对应项，
              // 旧逻辑静默跳过却仍上报"成功"。改为显式失败，避免用户收到
              // 成功通知而文件实际未修改。
              changes.push({ type: 'insert_text', markerText: markerText.slice(0, 50), error: '标记文本位于段落边界，无法安全插入' });
              continue;
            }
          }
          appliedOps.push({ type: 'insert_text', markerText: markerText, insertText: insertText });
          changes.push({ type: 'insert_text', insertText: insertText.slice(0, 100) });
          
        } else if (op.type === 'delete_text') {
          var delText = String(op.text || '');
          if (!delText) { changes.push({ type: 'delete_text', error: '缺少要删除的文本' }); continue; }
          
          var occurrence3 = typeof op.occurrence === 'number' ? op.occurrence : undefined;
          var findResult3 = findTextInParsedDoc(parsedDoc, delText, occurrence3);
          
          if (!findResult3.found) {
            changes.push({ type: 'delete_text', text: delText.slice(0, 100), error: findResult3.error, occurrences: findResult3.occurrences ? findResult3.occurrences.length : 0 });
            continue;
          }
          
          var deleteResult = replaceTextInParsedDoc(parsedDoc, findResult3.startCharIdx, findResult3.endCharIdx, '');
          if (!deleteResult.ok) {
            changes.push({ type: 'delete_text', error: deleteResult.error });
            continue;
          }
          
          xml = applyRunModsToXml(xml, parsedDoc.paragraphs, deleteResult.runModifications);
          parsedDoc = parseDocxDocumentXml(xml);
          
          appliedOps.push({ type: 'delete_text', text: delText, occurrence: findResult3.selectedOccurrence });
          changes.push({ type: 'delete_text', text: delText.slice(0, 100) });
          
        } else if (op.type === 'modify_paragraph') {
          var paraMarker = String(op.paragraph_marker || '');
          var newParaText = String(op.new_text || '');
          if (!paraMarker || !newParaText) {
            changes.push({ type: 'modify_paragraph', error: '缺少段落标记或新文本' });
            continue;
          }
          if (newParaText.length > MAX_DOCX_TEXT_LEN) { changes.push({ type: 'modify_paragraph', error: '新文本超过最大长度限制' }); continue; }
          
          // P0-2: 找到包含标记文本的段落
          var findResult4 = findTextInParsedDoc(parsedDoc, paraMarker, 0);
          if (!findResult4.found) {
            changes.push({ type: 'modify_paragraph', error: '未找到段落标记"' + paraMarker.slice(0, 50) + '"' });
            continue;
          }
          
          var pIdx = parsedDoc.charMap[findResult4.startCharIdx].pIdx;
          var modParaResult = modifyParagraphSingleRun(xml, parsedDoc.paragraphs, pIdx, newParaText);
          if (!modParaResult.ok) {
            changes.push({ type: 'modify_paragraph', error: modParaResult.error });
            continue;
          }
          
          xml = applyRunModsToXml(xml, parsedDoc.paragraphs, modParaResult.runModifications);
          parsedDoc = parseDocxDocumentXml(xml);
          
          appliedOps.push({ type: 'modify_paragraph', paragraphMarker: paraMarker, newText: newParaText });
          changes.push({ type: 'modify_paragraph', newText: newParaText.slice(0, 100) });
          
        } else if (op.type === 'modify_heading') {
          var headingMarker = String(op.heading_marker || '');
          var newHeadingText = String(op.new_text || '');
          var newLevel = typeof op.level === 'number' ? Math.max(1, Math.min(9, op.level)) : 0;
          if (!headingMarker || (!newHeadingText && !newLevel)) {
            changes.push({ type: 'modify_heading', error: '缺少标题标记或修改内容' });
            continue;
          }
          if (newHeadingText.length > MAX_DOCX_TEXT_LEN) { changes.push({ type: 'modify_heading', error: '新文本超过最大长度限制' }); continue; }
          
          var findResult5 = findTextInParsedDoc(parsedDoc, headingMarker, 0);
          if (!findResult5.found) {
            changes.push({ type: 'modify_heading', error: '未找到标题"' + headingMarker.slice(0, 50) + '"' });
            continue;
          }
          
          var hpIdx = parsedDoc.charMap[findResult5.startCharIdx].pIdx;
          var headingPara = parsedDoc.paragraphs[hpIdx];
          
          var allMods = [];
          
          // 修改标题级别
          if (newLevel > 0) {
            var oldParaXml = headingPara.xml;
            var newParaXml = oldParaXml;
            // 移除旧的 pStyle
            newParaXml = newParaXml.replace(/<w:pStyle[^>]*\/>/g, '');
            // 添加新的 pStyle（标题级别）
            if (newParaXml.indexOf('<w:pPr>') !== -1) {
              newParaXml = newParaXml.replace('<w:pPr>', '<w:pPr><w:pStyle w:val="' + newLevel + '"/>');
            } else if (newParaXml.indexOf('<w:pPr ') !== -1) {
              newParaXml = newParaXml.replace(/(<w:pPr[^>]*>)/, '$1<w:pStyle w:val="' + newLevel + '"/>');
            } else {
              newParaXml = newParaXml.replace('<w:p>', '<w:p><w:pPr><w:pStyle w:val="' + newLevel + '"/></w:pPr>');
            }
            xml = xml.slice(0, headingPara.start) + newParaXml + xml.slice(headingPara.end);
            parsedDoc = parseDocxDocumentXml(xml);
            headingPara = parsedDoc.paragraphs[hpIdx];
          }
          
          // 修改标题文本
          if (newHeadingText) {
            var modHeadingResult = modifyParagraphSingleRun(xml, parsedDoc.paragraphs, hpIdx, newHeadingText);
            if (modHeadingResult.ok) {
              xml = applyRunModsToXml(xml, parsedDoc.paragraphs, modHeadingResult.runModifications);
              parsedDoc = parseDocxDocumentXml(xml);
            }
          }
          
          appliedOps.push({ type: 'modify_heading', headingMarker: headingMarker, newText: newHeadingText, level: newLevel });
          changes.push({ type: 'modify_heading', newText: (newHeadingText || headingMarker).slice(0, 100), level: newLevel });
          
        } else if (op.type === 'modify_list') {
          var listMarker = String(op.list_marker || '');
          var listAction = String(op.action || 'modify');
          var listItemText = String(op.item_text || '');
          var listItemIndex = typeof op.item_index === 'number' ? op.item_index : -1;
          if (!listMarker) {
            changes.push({ type: 'modify_list', error: '缺少列表标记' });
            continue;
          }
          
          var findResult6 = findTextInParsedDoc(parsedDoc, listMarker, 0);
          if (!findResult6.found) {
            changes.push({ type: 'modify_list', error: '未找到列表标记"' + listMarker.slice(0, 50) + '"' });
            continue;
          }
          
          var lpIdx = parsedDoc.charMap[findResult6.startCharIdx].pIdx;
          
          // P0-2: 检查该段落是否有 numbering 属性（真正的列表项）
          var listPara = parsedDoc.paragraphs[lpIdx];
          var isActualList = /<w:numPr|<w:ilvl|<w:numId/.test(listPara.pPr);
          
          if (listAction === 'add') {
            if (!listItemText) {
              changes.push({ type: 'modify_list', error: '缺少要添加的列表项文本' });
              continue;
            }
            if (listItemText.length > MAX_DOCX_TEXT_LEN) { changes.push({ type: 'modify_list', error: '列表项文本超过最大长度限制' }); continue; }
            
            // 在标记段落之后插入新列表项
            var insertIdx = listPara.end;
            var newItemXml = '<w:p><w:pPr>' + (isActualList ? listPara.pPr.replace(/<w:rPr[\s\S]*?<\/w:rPr>/g, '') : '<w:pStyle w:val="ListParagraph"/>') + '</w:pPr><w:r><w:rPr></w:rPr><w:t xml:space="preserve">' + escapeXml(listItemText) + '</w:t></w:r></w:p>';
            xml = xml.slice(0, insertIdx) + newItemXml + xml.slice(insertIdx);
            parsedDoc = parseDocxDocumentXml(xml);
            
            appliedOps.push({ type: 'modify_list', action: 'add', itemText: listItemText });
            changes.push({ type: 'modify_list', action: 'add', itemText: listItemText.slice(0, 100) });
          } else if (listAction === 'modify') {
            if (!listItemText || listItemIndex < 0) {
              changes.push({ type: 'modify_list', error: '缺少列表项文本或索引' });
              continue;
            }
            if (listItemText.length > MAX_DOCX_TEXT_LEN) { changes.push({ type: 'modify_list', error: '列表项文本超过最大长度限制' }); continue; }
            
            // P0-2: 查找第 n 个后续段落（按 numbering 结构定位）
            var targetPIdx = lpIdx + listItemIndex + 1;
            if (targetPIdx >= parsedDoc.paragraphs.length) {
              changes.push({ type: 'modify_list', error: '未找到第' + (listItemIndex + 1) + '个列表项' });
              continue;
            }
            
            var modListResult = modifyParagraphSingleRun(xml, parsedDoc.paragraphs, targetPIdx, listItemText);
            if (!modListResult.ok) {
              changes.push({ type: 'modify_list', error: modListResult.error });
              continue;
            }
            
            xml = applyRunModsToXml(xml, parsedDoc.paragraphs, modListResult.runModifications);
            parsedDoc = parseDocxDocumentXml(xml);
            
            appliedOps.push({ type: 'modify_list', action: 'modify', itemText: listItemText, itemIndex: listItemIndex });
            changes.push({ type: 'modify_list', action: 'modify', itemText: listItemText.slice(0, 100), itemIndex: listItemIndex });
          } else if (listAction === 'remove') {
            if (listItemIndex < 0) {
              changes.push({ type: 'modify_list', error: '缺少要删除的列表项索引' });
              continue;
            }
            
            var targetRmIdx = lpIdx + listItemIndex + 1;
            if (targetRmIdx >= parsedDoc.paragraphs.length) {
              changes.push({ type: 'modify_list', error: '未找到第' + (listItemIndex + 1) + '个列表项' });
              continue;
            }
            
            var rmPara = parsedDoc.paragraphs[targetRmIdx];
            xml = xml.slice(0, rmPara.start) + xml.slice(rmPara.end);
            parsedDoc = parseDocxDocumentXml(xml);
            
            appliedOps.push({ type: 'modify_list', action: 'remove', itemIndex: listItemIndex });
            changes.push({ type: 'modify_list', action: 'remove', itemIndex: listItemIndex });
          } else {
            changes.push({ type: 'modify_list', error: '不支持的操作: ' + listAction });
          }
          
        } else if (op.type === 'modify_table_cell') {
          var tableMarker = String(op.table_marker || '');
          var cellRow = typeof op.row === 'number' ? op.row : -1;
          var cellCol = typeof op.col === 'number' ? op.col : -1;
          var cellValue = String(op.value || '');
          if (!tableMarker || cellRow < 0 || cellCol < 0) {
            changes.push({ type: 'modify_table_cell', error: '缺少表格标记、行号或列号' });
            continue;
          }
          if (cellValue.length > MAX_DOCX_TEXT_LEN) { changes.push({ type: 'modify_table_cell', error: '单元格值超过最大长度限制' }); continue; }
          
          // P0-2: 使用结构化查找定位表格标记
          var findResult7 = findTextInParsedDoc(parsedDoc, tableMarker, 0);
          if (!findResult7.found) {
            changes.push({ type: 'modify_table_cell', error: '未找到表格标记"' + tableMarker.slice(0, 50) + '"' });
            continue;
          }
          
          // 找到包含该标记的段落，然后反向查找 <w:tbl>
          var tblPIdx = parsedDoc.charMap[findResult7.startCharIdx].pIdx;
          var tblPara = parsedDoc.paragraphs[tblPIdx];
          
          var tblStart = xml.lastIndexOf('<w:tbl', tblPara.start);
          var tblEnd = xml.indexOf('</w:tbl>', tblPara.end);
          if (tblStart === -1 || tblEnd === -1) {
            changes.push({ type: 'modify_table_cell', error: '无法定位表格边界' });
            continue;
          }
          
          var tblXml = xml.slice(tblStart, tblEnd + '</w:tbl>'.length);
          var tblParsed = parseDocxDocumentXml(tblXml);
          
          // P0-2: 按行/列定位单元格
          // 简单实现：找到所有 w:tr（行），然后所有 w:tc（列）
          var rowRE = /<w:tr[\s\S]*?<\/w:tr>/g;
          var rowMatches = [];
          var rowMatch;
          while ((rowMatch = rowRE.exec(tblXml)) !== null) {
            rowMatches.push({ index: rowMatch.index, text: rowMatch[0] });
          }
          
          if (cellRow >= rowMatches.length) {
            changes.push({ type: 'modify_table_cell', error: '行号超出表格范围（共' + rowMatches.length + '行）' });
            continue;
          }
          
          var targetRow = rowMatches[cellRow].text;
          var cellRE = /<w:tc[\s\S]*?<\/w:tc>/g;
          var cellMatches = [];
          var cellMatch;
          while ((cellMatch = cellRE.exec(targetRow)) !== null) {
            cellMatches.push({ index: cellMatch.index, text: cellMatch[0] });
          }
          
          if (cellCol >= cellMatches.length) {
            changes.push({ type: 'modify_table_cell', error: '列号超出表格范围（共' + cellMatches.length + '列）' });
            continue;
          }
          
          var targetCell = cellMatches[cellCol].text;
          
          // P0-2: 解析单元格内的 runs，只修改第一个文本 run
          var cellParsed = parseDocxDocumentXml(targetCell);
          var cellModResult = modifyParagraphSingleRun(targetCell, cellParsed.paragraphs, 0, cellValue);
          
          var newCell;
          if (cellModResult.ok && cellModResult.runModifications.length > 0) {
            newCell = applyRunModsToXml(targetCell, cellParsed.paragraphs, cellModResult.runModifications);
          } else {
            // 回退：替换所有文本 run
            newCell = targetCell.replace(/<w:r[\s>][\s\S]*?<\/w:r>/g, function(match) {
              if (match.indexOf('<w:t') !== -1) {
                return '<w:r><w:rPr></w:rPr><w:t xml:space="preserve">' + escapeXml(cellValue) + '</w:t></w:r>';
              }
              return match;
            });
            if (newCell === targetCell) {
              newCell = targetCell.replace(/<w:tcPr>[\s\S]*?<\/w:tcPr>/, function(m) {
                return m + '<w:p><w:r><w:t xml:space="preserve">' + escapeXml(cellValue) + '</w:t></w:r></w:p>';
              });
            }
          }
          
          var newRow = targetRow.replace(targetCell, newCell);
          var newTblXml = tblXml.replace(targetRow, newRow);
          xml = xml.slice(0, tblStart) + newTblXml + xml.slice(tblEnd + '</w:tbl>'.length);
          parsedDoc = parseDocxDocumentXml(xml);
          
          appliedOps.push({ type: 'modify_table_cell', tableMarker: tableMarker, row: cellRow, col: cellCol, value: cellValue });
          changes.push({ type: 'modify_table_cell', row: cellRow, col: cellCol, value: cellValue.slice(0, 100) });
          
        } else {
          changes.push({ type: op.type || 'unknown', error: '不支持的 DOCX 操作类型: ' + (op.type || 'unknown') });
        }
      } catch (opErr) {
        changes.push({ type: op.type || 'unknown', error: opErr.message || '操作失败' });
      }
    }

    if (appliedOps.length === 0 && operations.length > 0) {
      var errMsgs = changes.map(function(c) { return c.error || '未生效'; }).join('; ');
      return { ok: false, error: 'DOCX 修改失败，无任何操作生效: ' + errMsgs };
    }

    // P0-2: 检查 XML 是否被实际修改
    if (xml === originalXml && appliedOps.length > 0) {
      return { ok: false, error: 'DOCX 修改未生效：XML 内容未发生变化' };
    }

    // P0-2: 大小限制检查
    if (xml.length > MAX_DOCX_NEW_SIZE) {
      return { ok: false, error: '修改后文档过大（' + (xml.length / 1024 / 1024).toFixed(1) + 'MB），超过限制' };
    }

    // Update the document.xml in the zip
    zip.file('word/document.xml', xml);

    var newBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });

    // P0-3: 加强验证 — 保存后重新解压并提取文本，验证修改确实生效
    var verificationResult = await verifyDocxSave(newBuffer, operations, appliedOps, originalXml);
    if (!verificationResult.ok) {
      return { ok: false, error: 'DOCX 保存验证失败: ' + verificationResult.error };
    }

    return {
      ok: true,
      newBuffer: newBuffer,
      changes: changes,
      newMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileName: fileName,
      appliedOps: appliedOps,
      verification: verificationResult
    };
  } catch (e) {
    return { ok: false, error: 'DOCX 修改失败: ' + (e.message || '') };
  }
}

// P0-3: DOCX 保存后验证 — 重新解压、提取文本、验证修改生效
async function verifyDocxSave(newBuffer, operations, appliedOps, originalXml) {
  var JSZip = require('jszip');
  try {
    // 1. 验证 ZIP 可打开
    var verifyZip = await JSZip.loadAsync(newBuffer);
    if (!verifyZip.file('word/document.xml')) {
      return { ok: false, error: '保存后无法找到 word/document.xml' };
    }
    
    // 2. 验证 XML 可解析
    var newXml = await verifyZip.file('word/document.xml').async('string');
    if (!newXml || newXml.length === 0) {
      return { ok: false, error: '保存后 document.xml 为空' };
    }
    
    // 验证 XML 基本结构
    if (newXml.indexOf('<w:document') === -1 || newXml.indexOf('</w:document>') === -1) {
      return { ok: false, error: '保存后 document.xml 结构损坏' };
    }
    
    // 3. 验证必需关系文件存在
    if (!verifyZip.file('_rels/.rels')) {
      return { ok: false, error: '保存后缺少 _rels/.rels' };
    }
    if (!verifyZip.file('[Content_Types].xml')) {
      return { ok: false, error: '保存后缺少 [Content_Types].xml' };
    }
    
    // 4. 验证目标修改确实生效
    var newParsedDoc = parseDocxDocumentXml(newXml);
    var verificationDetails = [];
    
    for (var ai = 0; ai < appliedOps.length; ai++) {
      var aop = appliedOps[ai];
      if (aop.type === 'replace_text') {
        // 检查旧文本是否已不存在
        var oldFind = findTextInParsedDoc(newParsedDoc, aop.oldText);
        if (oldFind.found && oldFind.occurrences.length > 0) {
          // 如果是 occurrence 替换，检查指定的 occurrence 是否被替换
          if (typeof aop.occurrence === 'number') {
            verificationDetails.push({ type: 'replace_text', status: 'partial', detail: '部分 occurrence 可能未被替换' });
          } else {
            verificationDetails.push({ type: 'replace_text', status: 'failed', detail: '旧文本"' + aop.oldText.slice(0, 50) + '"仍然存在' });
          }
        } else {
          // 检查新文本是否存在
          var newFind = findTextInParsedDoc(newParsedDoc, aop.newText);
          if (newFind.found) {
            verificationDetails.push({ type: 'replace_text', status: 'verified', detail: '新文本已确认存在' });
          } else {
            verificationDetails.push({ type: 'replace_text', status: 'warning', detail: '旧文本已移除但新文本未找到（可能因 XML 转义）' });
          }
        }
      } else if (aop.type === 'delete_text') {
        var delFind = findTextInParsedDoc(newParsedDoc, aop.text);
        if (delFind.found && delFind.occurrences.length > 0) {
          verificationDetails.push({ type: 'delete_text', status: 'failed', detail: '文本"' + aop.text.slice(0, 50) + '"未被删除' });
        } else {
          verificationDetails.push({ type: 'delete_text', status: 'verified', detail: '文本已确认删除' });
        }
      }
    }
    
    // 5. 验证未修改的内容没有意外变化
    var originalParsedDoc = parseDocxDocumentXml(originalXml);
    if (newParsedDoc.flatText && originalParsedDoc.flatText) {
      // 检查文本长度是否合理变化（不应大幅缩小或增大）
      var lenDiff = Math.abs(newParsedDoc.flatText.length - originalParsedDoc.flatText.length);
      var expectedMaxDiff = appliedOps.reduce(function(sum, op) {
        if (op.type === 'replace_text') return sum + Math.abs((op.newText || '').length - (op.oldText || '').length);
        if (op.type === 'delete_text') return sum + (op.text || '').length;
        if (op.type === 'insert_text') return sum + (op.insertText || '').length;
        return sum;
      }, 0) + 100; // 100 字符容差
      
      if (lenDiff > expectedMaxDiff * 3) {
        return { ok: false, error: '验证失败：文档文本长度变化异常（变化 ' + lenDiff + ' 字符，预期最多 ' + expectedMaxDiff + ' 字符），可能存在数据损坏' };
      }
    }
    
    var hasFailure = verificationDetails.some(function(vd) { return vd.status === 'failed'; });
    
    return {
      ok: !hasFailure,
      error: hasFailure ? '部分修改未生效' : '',
      details: verificationDetails,
      xmlValid: true,
      relsValid: true,
      newTextLength: newParsedDoc.flatText.length
    };
  } catch (ve) {
    return { ok: false, error: 'DOCX 保存验证异常: ' + (ve.message || '') };
  }
}

function escapeXml(str) {
  if (typeof str !== 'string') str = String(str);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function unescapeXml(str) {
  if (typeof str !== 'string') str = String(str);
  return str.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

// ── PPTX modification operations ──────────────────────────────────────
var MAX_PPTX_OPS = 20;
var MAX_PPTX_TEXT_LEN = 50000;

// P1-4: 扫描 slide XML 中所有 cNvPr id，生成唯一新 ID
function generateUniqueShapeId(slideXml, baseId) {
  var existingIds = new Set();
  var idRE = /<p:cNvPr[^>]*\sid="(\d+)"/g;
  var idMatch;
  while ((idMatch = idRE.exec(slideXml)) !== null) {
    existingIds.add(parseInt(idMatch[1], 10));
  }
  // 同时检查 a:cNvPr
  var aIdRE = /<a:cNvPr[^>]*\sid="(\d+)"/g;
  var aIdMatch;
  while ((aIdMatch = aIdRE.exec(slideXml)) !== null) {
    existingIds.add(parseInt(aIdMatch[1], 10));
  }
  
  var newId = typeof baseId === 'number' && baseId > 0 ? baseId : 1000;
  while (existingIds.has(newId)) {
    newId++;
  }
  return newId;
}

// P1-4: PPTX slide 文本提取（用于解析后验证）
function extractPptxSlideText(slideXml) {
  var textParts = [];
  var textRegex = /<a:t[^>]*>([^<]*)<\/a:t>/g;
  var match;
  while ((match = textRegex.exec(slideXml)) !== null) {
    var t = match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    if (t.trim()) textParts.push(t);
  }
  return textParts.join('');
}

async function applyPptxOperations(buffer, operations, fileName) {
  var JSZip = require('jszip');
  if (operations.length > MAX_PPTX_OPS) {
    return { ok: false, error: '单次最多支持 ' + MAX_PPTX_OPS + ' 个 PPTX 修改操作' };
  }

  try {
    var zip = await JSZip.loadAsync(buffer);
    var appliedOps = [];
    var changes = [];

    // Find all slide XML files
    var slideFiles = [];
    zip.folder('ppt/slides').forEach(function (relativePath, file) {
      if (relativePath.match(/^slide\d+\.xml$/i)) {
        slideFiles.push({ name: relativePath, file: file });
      }
    });
    slideFiles.sort(function(a, b) {
      var na = parseInt((a.name.match(/\d+/) || [0])[0], 10);
      var nb = parseInt((b.name.match(/\d+/) || [0])[0], 10);
      return na - nb;
    });

    for (var i = 0; i < operations.length; i++) {
      var op = operations[i];
      if (!op || typeof op !== 'object') continue;

      try {
        var targetSlide = op.slide;
        var slideIdx = -1;
        
        // P1-4: 严格验证 slide 参数
        if (typeof targetSlide === 'number' && targetSlide >= 1 && targetSlide <= slideFiles.length) {
          slideIdx = targetSlide - 1;
        } else if (typeof targetSlide === 'string' && targetSlide.trim()) {
          slideIdx = slideFiles.findIndex(function(sf) { return sf.name === targetSlide.trim(); });
        } else {
          // P1-4: 缺少或无效 slide 编号时拒绝执行
          changes.push({ type: op.type || 'unknown', error: '缺少有效的幻灯片编号（slide 参数），当前共 ' + slideFiles.length + ' 页幻灯片' });
          continue;
        }
        
        // P1-4: 不再自动回退到第一页
        if (slideIdx < 0 || slideIdx >= slideFiles.length) {
          changes.push({ type: op.type || 'unknown', error: '无效的幻灯片编号 ' + targetSlide + '，当前共 ' + slideFiles.length + ' 页幻灯片' });
          continue;
        }

        var slideFile = slideFiles[slideIdx].file;
        var slideXml = await slideFile.async('string');
        var originalSlideXml = slideXml;

        if (op.type === 'replace_text') {
          var oldText = String(op.old_text || '');
          var newText = String(op.new_text || '');
          if (!oldText) { changes.push({ type: 'replace_text', error: '缺少要替换的文本' }); continue; }
          if (newText.length > MAX_PPTX_TEXT_LEN) { changes.push({ type: 'replace_text', error: '新文本超过最大长度限制' }); continue; }
          
          // P1-4: 支持跨 a:r/a:t 的文本定位
          var slideText = extractPptxSlideText(slideXml);
          var matchCount = 0;
          var searchFrom = 0;
          var matchPositions = [];
          while (searchFrom < slideText.length) {
            var idx = slideText.indexOf(oldText, searchFrom);
            if (idx === -1) break;
            matchPositions.push(idx);
            searchFrom = idx + 1;
          }
          
          if (matchPositions.length === 0) {
            changes.push({ type: 'replace_text', slide: slideIdx + 1, oldText: oldText.slice(0, 50), error: '未找到指定文本' });
            continue;
          }
          
          // 多个匹配时拒绝
          if (matchPositions.length > 1 && typeof op.occurrence !== 'number') {
            changes.push({ type: 'replace_text', slide: slideIdx + 1, oldText: oldText.slice(0, 50), error: '找到 ' + matchPositions.length + ' 处匹配，请指定 occurrence 参数', occurrences: matchPositions.length });
            continue;
          }
          
          // P1-4: 使用 a:t 级别的替换
          var escapedOld = escapeXml(oldText);
          var escapedNew = escapeXml(newText);
          var replaced = false;
          
          // 尝试在 a:t 标签内替换
          var atRE = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
          var atMatch;
          var newSlideXml = slideXml;
          var lastIndex = 0;
          var resultParts = [];
          
          while ((atMatch = atRE.exec(slideXml)) !== null) {
            var beforeText = slideXml.slice(lastIndex, atMatch.index);
            resultParts.push(beforeText);
            
            var atContent = atMatch[1];
            var newAtContent = atContent;
            
            if (atContent.indexOf(escapedOld) !== -1) {
              newAtContent = atContent.split(escapedOld).join(escapedNew);
              replaced = true;
            } else if (atContent.indexOf(oldText) !== -1) {
              newAtContent = atContent.split(oldText).join(escapedNew);
              replaced = true;
            }
            
            resultParts.push(atMatch[0].replace(/>[\s\S]*?<\/a:t>/, '>' + newAtContent + '</a:t>'));
            lastIndex = atMatch.index + atMatch[0].length;
          }
          
          if (lastIndex < slideXml.length) {
            resultParts.push(slideXml.slice(lastIndex));
          }
          
          if (replaced) {
            slideXml = resultParts.join('');
          } else {
            changes.push({ type: 'replace_text', slide: slideIdx + 1, oldText: oldText.slice(0, 50), error: '未找到指定文本（文本可能跨多个 a:t 标签）' });
            continue;
          }
          
          appliedOps.push({ type: 'replace_text', slide: slideIdx + 1, oldText: oldText, newText: newText });
          changes.push({ type: 'replace_text', slide: slideIdx + 1, oldText: oldText.slice(0, 50), newText: newText.slice(0, 50) });
          
        } else if (op.type === 'insert_text') {
          var insertText = String(op.insert_text || '');
          if (!insertText) { changes.push({ type: 'insert_text', error: '缺少要插入的文本' }); continue; }
          if (insertText.length > MAX_PPTX_TEXT_LEN) { changes.push({ type: 'insert_text', error: '插入文本超过最大长度限制' }); continue; }
          
          // Insert text at end of slide
          var spCloseIdx = slideXml.lastIndexOf('</p:spTree>');
          if (spCloseIdx === -1) { changes.push({ type: 'insert_text', error: 'PPTX 幻灯片结构无效' }); continue; }
          
          // P1-4: 扫描当前 slide 的 cNvPr id，生成唯一 ID
          var uniqueId = generateUniqueShapeId(slideXml);
          
          var textBoxXml = '<p:sp><p:nvSpPr><p:cNvPr id="' + uniqueId + '" name="AI Text"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="' + (914400 + i * 457200) + '"/><a:ext cx="8229600" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>' + escapeXml(insertText) + '</a:t></a:r></a:p></p:txBody></p:sp>';
          slideXml = slideXml.slice(0, spCloseIdx) + textBoxXml + slideXml.slice(spCloseIdx);
          
          appliedOps.push({ type: 'insert_text', slide: slideIdx + 1, insertText: insertText, shapeId: uniqueId });
          changes.push({ type: 'insert_text', slide: slideIdx + 1, insertText: insertText.slice(0, 100) });
          
        } else if (op.type === 'delete_text') {
          var delText = String(op.text || '');
          if (!delText) { changes.push({ type: 'delete_text', error: '缺少要删除的文本' }); continue; }
          
          var escapedDel = escapeXml(delText);
          var deleted = false;
          var newSlideXml2 = slideXml;
          
          // 只替换第一个出现位置，避免全局替换误删幻灯片中重复出现的文本
          var searchText = slideXml.indexOf(escapedDel) !== -1 ? escapedDel : (slideXml.indexOf(delText) !== -1 ? delText : null);
          if (searchText !== null) {
            var firstIdx = slideXml.indexOf(searchText);
            newSlideXml2 = slideXml.slice(0, firstIdx) + slideXml.slice(firstIdx + searchText.length);
            deleted = true;
          }
          
          if (!deleted) {
            changes.push({ type: 'delete_text', slide: slideIdx + 1, text: delText.slice(0, 50), error: '未找到指定文本' });
            continue;
          }
          
          slideXml = newSlideXml2;
          appliedOps.push({ type: 'delete_text', slide: slideIdx + 1, text: delText });
          changes.push({ type: 'delete_text', slide: slideIdx + 1, text: delText.slice(0, 50) });
          
        } else {
          changes.push({ type: op.type || 'unknown', error: '不支持的 PPTX 操作类型: ' + (op.type || 'unknown') });
        }

        zip.file('ppt/slides/' + slideFiles[slideIdx].name, slideXml);
      } catch (opErr) {
        changes.push({ type: op.type || 'unknown', error: opErr.message || '操作失败' });
      }
    }

    if (appliedOps.length === 0 && operations.length > 0) {
      var errMsgs = changes.map(function(c) { return c.error || '未生效'; }).join('; ');
      return { ok: false, error: 'PPTX 修改失败，无任何操作生效: ' + errMsgs };
    }

    var newBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    });

    // P1-4: 加强验证 — 保存后重新解析所有目标 slide XML
    try {
      var verifyZip = await JSZip.loadAsync(newBuffer);
      if (!verifyZip.folder('ppt/slides')) {
        return { ok: false, error: 'PPTX 生成验证失败：无法重新打开文件' };
      }
      
      // 验证所有修改过的 slide XML 可解析
      var verificationDetails = [];
      for (var vi = 0; vi < appliedOps.length; vi++) {
        var aop = appliedOps[vi];
        if (typeof aop.slide === 'number' && aop.slide >= 1 && aop.slide <= slideFiles.length) {
          var slideName = slideFiles[aop.slide - 1].name;
          var slideFile = verifyZip.file('ppt/slides/' + slideName);
          if (!slideFile) {
            verificationDetails.push({ slide: aop.slide, status: 'failed', error: 'slide 文件缺失' });
            continue;
          }
          var slideXml = await slideFile.async('string');
          var slideText = extractPptxSlideText(slideXml);
          
          if (aop.type === 'replace_text') {
            if (slideText.indexOf(aop.newText) !== -1) {
              verificationDetails.push({ slide: aop.slide, status: 'verified', detail: '新文本确认存在' });
            } else {
              verificationDetails.push({ slide: aop.slide, status: 'warning', detail: '文本替换可能未完全生效' });
            }
          } else if (aop.type === 'delete_text') {
            if (slideText.indexOf(aop.text) === -1) {
              verificationDetails.push({ slide: aop.slide, status: 'verified', detail: '文本已确认删除' });
            } else {
              verificationDetails.push({ slide: aop.slide, status: 'failed', detail: '文本未被删除' });
            }
          } else if (aop.type === 'insert_text') {
            if (slideText.indexOf(aop.insertText) !== -1) {
              verificationDetails.push({ slide: aop.slide, status: 'verified', detail: '插入文本确认存在' });
            } else {
              verificationDetails.push({ slide: aop.slide, status: 'warning', detail: '插入文本可能未生效' });
            }
          }
        }
      }
      
      var hasVerificationFailure = verificationDetails.some(function(vd) { return vd.status === 'failed'; });
    } catch (ve) {
      return { ok: false, error: 'PPTX 生成验证失败: ' + (ve.message || '') };
    }

    return {
      ok: true,
      newBuffer: newBuffer,
      changes: changes,
      newMimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      fileName: fileName,
      appliedOps: appliedOps,
      verification: verificationDetails || []
    };
  } catch (e) {
    return { ok: false, error: 'PPTX 修改失败: ' + (e.message || '') };
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
  // Prevent two requests with the same client_request_id from both reaching
  // the provider while the first database insert is still in flight.
  var pendingStreamCreations = new Map();

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
      var documentType = String(req.body.documentType || '').toLowerCase();

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
      try {
        mimeType = await validateOfficeApplyInput(buffer, documentType, mimeType, fileName);
      } catch (validationError) {
        return res.status(400).json({ ok: false, code: 'INVALID_OFFICE_DOCUMENT', error: sanitizeError ? sanitizeError(validationError) : 'Office 文档校验失败' });
      }

      var result;
      if (documentType === 'xlsx' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || mimeType === 'application/vnd.ms-excel') {
        result = await applyXlsxOperations(buffer, operations, fileName);
      } else if (documentType === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        result = await applyDocxOperations(buffer, operations, fileName);
      } else if (documentType === 'pptx' || mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
        result = await applyPptxOperations(buffer, operations, fileName);
      } else {
        return res.status(400).json({ ok: false, error: '不支持修改此类型文档 (' + (documentType || mimeType) + ')。支持的类型：DOCX、XLSX、PPTX' });
      }

      if (!result.ok) {
        return res.status(500).json({ ok: false, error: result.error });
      }
      var documentErrors = (result.changes || []).filter(function(change) {
        return change && change.error;
      });
      if (documentErrors.length > 0) {
        // Do not return a binary that contains only a subset of the requested
        // edits. The frontend cannot safely infer which operations succeeded
        // from a 200 binary response, so make partial application explicit.
        return res.status(422).json({
          ok: false,
          code: 'DOCUMENT_PARTIAL_FAILURE',
          error: documentErrors.map(function(change) { return change.error; }).join('; '),
          changes: result.changes || [],
          appliedOps: result.appliedOps || []
        });
      }

      var newBuffer = result.newBuffer;
      if (!newBuffer || !Buffer.isBuffer(newBuffer)) {
        return res.status(500).json({ ok: false, error: '生成文件失败' });
      }
      if (newBuffer.length > MAX_DOCUMENT_UPLOAD_BYTES * 2) {
        return res.status(413).json({ ok: false, code: 'DOCUMENT_OUTPUT_TOO_LARGE', error: '生成的文档过大，已拒绝下载' });
      }

      var extMap = { xlsx: '.xlsx', docx: '.docx', pptx: '.pptx' };
      var docExt = extMap[documentType] || (fileName.match(/\.[^.]+$/) || ['.docx'])[0];
      var outFileName = fileName.replace(/\.[^.]+$/, '') + '_AI修改版' + docExt;

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
      var isIncremental = body.incremental === true;
      var manifestPaths = Array.isArray(body.manifest_paths) ? body.manifest_paths : [];
      var deletedPaths = Array.isArray(body.deleted_paths) ? body.deleted_paths : [];
      if (isIncremental && manifestPaths.length === 0) {
        return res.status(400).json({ ok: false, code: 'INVALID_INCREMENTAL_INDEX', error: '增量索引需要完整文件清单' });
      }
      var useBatches = body.append === true || body.batch === true || body.finalize === true;
      // Batches are intentionally a full-build protocol.  Incremental uploads
      // must be merged atomically against a complete base index.
      if (isIncremental && useBatches) {
        return res.status(400).json({ ok: false, code: 'INVALID_INCREMENTAL_INDEX', error: '增量索引不支持分批提交' });
      }
      if (isIncremental && !codeIndex.getIndexSummary(scopeResult.value) && supabase) {
        try { await codeIndex.recoverIndexFromDB(supabase, scopeResult.value, scopeResult.value.workspaceId); } catch (_) {}
      }
      var result = isIncremental
        ? codeIndex.applyIncrementalIndex(scopeResult.value, body.files, {
          manifestPaths: manifestPaths,
          deletedPaths: deletedPaths,
          truncated: body.truncated === true
        })
        : (useBatches
        ? codeIndex.appendIndexBatch(scopeResult.value, body.files, {
          finalize: body.finalize === true,
          reset: body.reset === true || body.batchIndex === 0,
          truncated: body.truncated === true
        })
        : codeIndex.buildIndex(scopeResult.value, body.files, { truncated: body.truncated === true }));

      if (!result.ok) {
        var indexStatus = result.code === 'INDEX_REBUILD_REQUIRED' ? 409 : 400;
        return res.status(indexStatus).json({ ok: false, code: result.code || 'INDEX_BUILD_FAILED', error: result.error, retryable: result.code === 'INDEX_REBUILD_REQUIRED' });
      }

      if (result.status !== 'building') {
        console.log('[code-agent] Index built: ' + result.totalFiles + ' files, ' + result.totalChunks + ' chunks');
        // Phase 4: Persist to DB (fire-and-forget, non-blocking)
        if (result.status === 'ready' && supabase) {
          var resolved = codeIndex._resolveIndexForPersistence(scopeResult.value);
          if (resolved && resolved.ok && resolved.index) {
            codeIndex.persistIndexToDB(supabase, scopeResult.value.userId, scopeResult.value.workspaceId, resolved.index, {
              incremental: isIncremental,
              deletedPaths: deletedPaths
            })
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

  app.get('/api/code/models', rateLimit(60000, 60), authenticateUser, function(req, res) {
    var catalog = getCodeModels(deps);
    return res.json({ ok: true, default_model: catalog.default_model, models: catalog.models });
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
      var activePath = apResult.value ? normalizeContextPath(apResult.value) : '';
      if (activePath && !validatePath(activePath)) return sendError('INVALID_PATH', '当前路径无效', 400);
      var activeDocumentHint = /\.(docx?|pdf|pptx?|xlsx?)$/i.test(activePath);

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
      // P0 Fix: 当有打开文档或附件时，即使索引未建立也不拦截请求
      // 文档正文已通过 open_files/attachments 传入，Agent 可以直接使用
      var hasDocumentContent = openFiles.length > 0 || attachments.length > 0;
      if (!indexSummary && !hasDocumentContent && needsProjectContext(message) && !isFreshnessQuery(message) && !isExplicitSearch(message)) {
        if (activeDocumentHint) return sendError('DOCUMENT_CONTEXT_MISSING', '当前文档内容未随请求发送，请重新打开文档后重试', 409, { retryable: true });
        return sendError('INDEX_REBUILD_REQUIRED', '项目索引需要重新建立，但当前文档内容已可用，您可以继续提问', 409, { retryable: true, hasDocumentContent: false });
      }

      var apiKey = deps.getDeepSeekApiKey ? deps.getDeepSeekApiKey() : '';
      var model = deps.getDeepSeekModel ? deps.getDeepSeekModel() : '';
      if (!apiKey) return sendError('AI_NOT_CONFIGURED', 'AI 服务未配置', 503);
      if (!model) return sendError('MODEL_NOT_CONFIGURED', 'Code AI 模型未配置', 503);
      if (typeof deps.callDeepSeek !== 'function') return sendError('AGENT_NOT_AVAILABLE', 'Code Agent 未启用', 503);
      var modelSelection = resolveCodeModel(deps, body.model_id);
      if (!modelSelection.ok) return sendError(modelSelection.code, '所选模型当前不可用', 400);
      model = modelSelection.model.id;
      var thinkingSelection = resolveThinkingMode(body.thinking_mode, message);
      if (!thinkingSelection.ok) return sendError('INVALID_THINKING_MODE', '思考程度无效', 400);

      // Phase 3: Compute capabilities and thinkingMode BEFORE building messages
      // so that runtime identity and limits can be injected into the user message.
      var capabilities = buildCodeCapabilities(deps);
      // The catalog/config model is only the default. Once the request has
      // passed resolveCodeModel(), every runtime identity surface must use the
      // model the client actually selected.
      capabilities.model = model;
      var thinkingMode = thinkingSelection.effective;
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
        // P0 Fix: 使用 callDeepSeek 现在保留的 status/response/providerCode 等字段
        var errCode = err && err.code ? err.code : 'UNKNOWN';
        var errStatus = err && typeof err.status === 'number' ? err.status : 500;
        var errMsg = err && err.message ? err.message : String(err);
        var providerCode = (err && err.providerCode) || (err && err.response && err.response.data && err.response.data.error && err.response.data.error.code) || '';
        var providerType = (err && err.providerType) || (err && err.response && err.response.data && err.response.data.error && err.response.data.error.type) || '';
        var providerMsg = (err && err.providerMessage) || (err && err.response && err.response.data && err.response.data.error && err.response.data.error.message) || errMsg;
        var providerRequestId = (err && err.providerRequestId) || (err && err.response && err.response.data && err.response.data.request_id) || '';

        // 诊断日志
        console.error('[code-agent] callDeepSeek failed:', JSON.stringify({
          requestId: requestId,
          errCode: errCode,
          errStatus: errStatus,
          providerCode: providerCode,
          providerType: providerType,
          providerMsg: (providerMsg || '').slice(0, 200),
          providerRequestId: providerRequestId,
          thinkingMode: thinkingMode,
          hasTools: !!(Array.isArray(CODE_AGENT_TOOLS) && CODE_AGENT_TOOLS.length > 0),
          code: errCode
        }));

        // 分类错误
        var parsedError = errCode;
        if (parsedError === 'UNKNOWN' || parsedError.indexOf('PROVIDER_HTTP_') === 0) {
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
        }

        // P0 Fix: 仅当错误明确是 thinking 不兼容时才回退
        var isThinkingError = errCode === 'PROVIDER_INVALID_THINKING_MODE' || parsedError === 'PROVIDER_INVALID_THINKING_MODE';
        var shouldFallback = isThinkingError && thinkingMode !== 'off' && Array.isArray(CODE_AGENT_TOOLS) && CODE_AGENT_TOOLS.length > 0;

        if (shouldFallback) {
          console.warn('[code-agent] Thinking incompatible with current model. Retrying once with thinking=off. Reason:', parsedError);
          thinkingFallback = true;
          callArgs.thinking_mode = 'off';
          logPhase('thinking_fallback', { reason: parsedError, providerCode: providerCode });
          try {
            aiResult = await deps.callDeepSeek(messages, callArgs);
            aiResult.thinking_fallback = true;
            aiResult.thinking_mode = 'off';
            aiResult.thinkingFallbackReason = parsedError;
          } catch (fallbackErr) {
            console.error('[code-agent] Thinking fallback also failed:', fallbackErr && fallbackErr.message);
            fallbackErr.parsedCode = parsedError;
            throw fallbackErr;
          }
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
          sessionData.history.push(clampHistoryMessage({ role: 'user', content: message, message_id: userMsgId, turn_id: body.client_request_id || '' }));
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
            msg = clampHistoryMessage(msg);
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
        var checkedOperations = validateOperationsAgainstContext(operations, openFiles.concat(attachments));
        operations = checkedOperations.operations;
        var jsonBlockMatch = rawContent.match(JSON_BLOCK_RE);
        if (jsonBlockMatch) reply = (rawContent.slice(0, jsonBlockMatch.index) + rawContent.slice(jsonBlockMatch.index + jsonBlockMatch[0].length)).trim();
        reply = appendOperationWarnings(reply, checkedOperations.rejected);
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

    var aborted = false;
    var finalized = false;
    var terminalStarted = false;
    var finalizationPromise = null;
    var timedOut = false;
    var requestController = new AbortController();
    var timeoutTimer = null;
    var requestId = aiCoreRequestId.generateRequestId('code');
    var streamId = aiCoreRequestId.generateStreamId();
    var requestStartTime = Date.now();
    var toolTrace = [];
    var userId = String(req.userName || '');
    var clientRequestId = String((req.body && req.body.client_request_id) || '');

    function logPhase(phase, extra) {
      var logObj = {
        requestId: requestId,
        streamId: streamId,
        phase: phase,
        elapsedMs: Date.now() - requestStartTime
      };
      if (extra) Object.keys(extra).forEach(function(k) { logObj[k] = extra[k]; });
      console.log('[code-agent-stream] ' + JSON.stringify(logObj));
    }

    // Phase 3: Register controller for external cancellation

    var resumeEnabled = streamSession.isResumeEnabled();
    var creationKey = userId + ':' + clientRequestId;
    if (resumeEnabled && !supabase) {
      return res.status(503).json({ ok: false, code: 'STREAM_PERSISTENCE_UNAVAILABLE', error: '流式会话持久化不可用', retryable: true });
    }

    // Phase 3: Stream resume - check idempotency for same client_request_id.
    // A database query failure is not equivalent to not_found: stop before
    // accepted/provider work and let the client retry the same request.
    if (resumeEnabled && clientRequestId && pendingStreamCreations.has(creationKey)) {
      var pendingCreation = pendingStreamCreations.get(creationKey);
      var pendingSession = pendingCreation.session || null;
      if (!pendingSession && pendingCreation.promise) {
        var pendingResult = await pendingCreation.promise;
        pendingSession = pendingResult && pendingResult.ok === true ? pendingResult.data : null;
      }
      if (pendingSession) {
        var pendingStatus = pendingSession.status || 'running';
        return res.json({
          ok: true,
          stream_id: pendingSession.stream_id,
          request_id: pendingSession.request_id,
          client_request_id: pendingSession.client_request_id,
          status: pendingStatus,
          result_status: pendingStatus,
          terminal: pendingStatus !== 'running',
          duplicate: true,
          resume: { method: 'GET', path: '/api/code/chat/stream/resume?stream_id=' + encodeURIComponent(String(pendingSession.stream_id || '')) + '&client_request_id=' + encodeURIComponent(clientRequestId), after_event_id: Number(pendingSession.last_event_id) || 0 },
          message: '请求已存在，请使用恢复接口继续接收结果'
        });
      }
    }
    if (resumeEnabled && clientRequestId && supabase) {
      var existingResult = await streamSession.getStreamSessionByClientRequestId(supabase, userId, clientRequestId);
      if (existingResult && existingResult.query_failed) {
        return res.status(503).json({
          ok: false,
          code: 'STREAM_SESSION_QUERY_FAILED',
          error: '流式会话查询失败，请稍后重试',
          retryable: true,
          details: existingResult.error || null
        });
      }
      var existingSession = existingResult && existingResult.found === true ? existingResult.data : null;
      var duplicateStatuses = ['completed', 'running', 'failed', 'cancelled'];
      if (existingSession && duplicateStatuses.indexOf(existingSession.status) >= 0) {
        var duplicateStatus = existingSession.status;
        var resumePath = '/api/code/chat/stream/resume?stream_id=' + encodeURIComponent(String(existingSession.stream_id || '')) +
          '&client_request_id=' + encodeURIComponent(clientRequestId);
        return res.json({
          ok: true,
          stream_id: existingSession.stream_id,
          request_id: existingSession.request_id,
          client_request_id: existingSession.client_request_id,
          status: duplicateStatus,
          result_status: duplicateStatus,
          terminal: duplicateStatus !== 'running',
          duplicate: true,
          resume: { method: 'GET', path: resumePath, after_event_id: Number(existingSession.last_event_id) || 0 },
          message: duplicateStatus === 'running' ? '请求正在处理中，请使用恢复接口继续接收结果' :
            (duplicateStatus === 'completed' ? '请求已完成，请通过恢复接口获取结果' :
              (duplicateStatus === 'cancelled' ? '请求已取消，可通过恢复接口获取最终状态' : '请求已失败，可通过恢复接口获取错误结果'))
        });
      }
    }

    function onControllerAbort() {
      if (!timedOut) aborted = true;
    }
    requestController.signal.addEventListener('abort', onControllerAbort);

    function abortRequest() {
      aborted = true;
      try { requestController.abort(); } catch (_) {}
    }
    req.once('aborted', abortRequest);
    res.once('close', function() { if (!res.writableEnded) abortRequest(); });

    var nextEventId = aiCoreRequestId.generateEventId();

    var baseEvent = {
      stream_id: streamId,
      request_id: requestId,
      client_request_id: String(req.body.client_request_id || ''),
      conversation_id: String(req.body.conversation_id || ''),
      startTime: requestStartTime
    };

    var eventLogger = streamSession.createEventLogger(supabase, streamId, userId);
    // Create and verify the durable session before opening a recoverable SSE
    // stream or calling the provider. A failed insert must be an HTTP error,
    // never an apparently resumable stream.
    if (resumeEnabled) {
      var sessionParams = {
        userId: userId,
        streamId: streamId,
        requestId: requestId,
        clientRequestId: clientRequestId,
        conversationId: String(req.body.conversation_id || ''),
        workspaceId: String((req.body.workspace_id || req.body.workspace_name || '')).slice(0, 200),
        workspaceGeneration: Number(req.body.workspace_generation || 0),
        startedAt: new Date(requestStartTime).toISOString()
      };
      var sessionCreationPromise = streamSession.createStreamSession(supabase, sessionParams);
      if (clientRequestId) pendingStreamCreations.set(creationKey, { promise: sessionCreationPromise });
      var sessionCreateResult = await sessionCreationPromise;
      var createdSession = sessionCreateResult && sessionCreateResult.ok === true ? sessionCreateResult.data : null;
      var validCreatedSession = createdSession &&
        String(createdSession.stream_id || '') === streamId &&
        String(createdSession.status || '') === 'running' &&
        Number(createdSession.last_event_id || 0) === 0;
      if (!validCreatedSession) {
        // A concurrent request on another Render instance may have won the
        // unique (user_id, client_request_id) insert. Re-read the durable
        // winner and return the same resumable contract instead of surfacing
        // a false create failure or calling the provider twice.
        if (clientRequestId && sessionCreateResult && sessionCreateResult.error && String(sessionCreateResult.error.code || '') === '23505') {
          var conflictResult = await streamSession.getStreamSessionByClientRequestId(supabase, userId, clientRequestId);
          if (conflictResult && conflictResult.found === true && conflictResult.data) {
            var conflictSession = conflictResult.data;
            var conflictStatus = String(conflictSession.status || 'running');
            if (clientRequestId) pendingStreamCreations.delete(creationKey);
            return res.json({
              ok: true,
              stream_id: conflictSession.stream_id,
              request_id: conflictSession.request_id,
              client_request_id: conflictSession.client_request_id,
              status: conflictStatus,
              result_status: conflictStatus,
              terminal: conflictStatus !== 'running',
              duplicate: true,
              resume: { method: 'GET', path: '/api/code/chat/stream/resume?stream_id=' + encodeURIComponent(String(conflictSession.stream_id || '')) + '&client_request_id=' + encodeURIComponent(clientRequestId), after_event_id: Number(conflictSession.last_event_id) || 0 }
            });
          }
        }
        if (clientRequestId) pendingStreamCreations.delete(creationKey);
        return res.status(503).json({
          ok: false,
          code: 'STREAM_SESSION_CREATE_FAILED',
          error: sessionCreateResult && sessionCreateResult.error && sessionCreateResult.error.message ? sessionCreateResult.error.message : '流式会话创建失败，请稍后重试',
          retryable: !!(sessionCreateResult && sessionCreateResult.retryable),
          details: sessionCreateResult && sessionCreateResult.error ? sessionCreateResult.error : null
        });
      }
      if (clientRequestId) pendingStreamCreations.set(creationKey, { session: createdSession });
    }

    // Setup SSE only after durable session creation succeeds.
    aiCoreSSE.setupSSE(res, req);
    var writer = aiCoreSSE.createSSEWriter(res, req);
    streamAbortControllers.set(streamId, requestController);
    timeoutTimer = setTimeout(function() {
      if (finalized || aborted) return;
      timedOut = true;
      try { requestController.abort(); } catch (_) {}
    }, DEEPSEEK_TIMEOUT_MS);
    if (timeoutTimer && timeoutTimer.unref) timeoutTimer.unref();

    function sendSSE(type, data) {
      if (finalized || terminalStarted || (aborted && type !== 'cancelled')) return false;
      // Terminal events are emitted only by finalizeStream(), which persists
      // the event and updates the session before writing it to the client.
      if (type === 'done' || type === 'error' || type === 'cancelled') return false;
      var eventId = nextEventId();
      var event = aiCoreSSE.buildSSEEvent(
        Object.assign({}, baseEvent, { event_id: eventId }),
        type,
        data
      );
      // Phase 3: Persist event (non-blocking, fire-and-forget)
      if (streamSession.isPersistableEvent(type)) {
        eventLogger.logEvent(type, data, eventId).catch(function() {});
      }
      var wrote = writer.write(aiCoreSSE.formatSSEEvent(event));
      if (!wrote && type !== 'done') {
        aborted = true;
        try { requestController.abort(); } catch (_) {}
      }
      return wrote;
    }

    // Heartbeat
    var heartbeat = aiCoreSSE.createHeartbeat(writer, function() { return baseEvent; }, 10000);
    heartbeat.start();

    function cleanup() {
      heartbeat.stop();
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      requestController.signal.removeEventListener('abort', onControllerAbort);
      writer.cleanup();
      streamAbortControllers.delete(streamId);
      if (!res.writableEnded) res.end();
    }

    function writeUnpersistedTerminalError(code, message, phase) {
      if (!writer || res.writableEnded) return;
      var eventId = nextEventId();
      var event = aiCoreSSE.buildSSEEvent(Object.assign({}, baseEvent, { event_id: eventId }), 'error', {
        status: 'running',
        code: code,
        message: message,
        retryable: true,
        request_id: requestId,
        phase: phase || 'persistence'
      });
      writer.write(aiCoreSSE.formatSSEEvent(event));
    }

    function finalizeStream(status, type, data) {
      if (finalizationPromise) return finalizationPromise;
      if (finalized) return Promise.resolve({ ok: true, status: status });
      terminalStarted = true;
      finalizationPromise = (async function() {
        // Drain all non-terminal writes first. A failed flush means the
        // session is still recoverable; it must not be marked completed.
        var beforeResult = await eventLogger.flush();
        if (beforeResult && beforeResult.failed > 0) {
          throw { code: 'STREAM_EVENT_FLUSH_FAILED', message: '流式事件持久化失败', retryable: true };
        }

        var eventId = nextEventId();
        var event = aiCoreSSE.buildSSEEvent(Object.assign({}, baseEvent, { event_id: eventId }), type, data);
        var persisted = await eventLogger.logEvent(type, data, eventId);
        var terminalFlush = await eventLogger.flush();
        if (!persisted || persisted.failed > 0 || !terminalFlush || terminalFlush.failed > 0) {
          throw { code: 'STREAM_EVENT_FLUSH_FAILED', message: '终态事件持久化失败', retryable: true };
        }

        var lastEventId = Number(terminalFlush.lastPersistedEventId) || 0;
        if (resumeEnabled) {
          var updateResult = await streamSession.updateStreamSession(supabase, streamId, {
            last_event_id: lastEventId,
            status: status,
            completed_at: new Date().toISOString()
          }, {
            expectedStatus: 'running',
            // No non-terminal event updates the session cursor; the cursor is
            // advanced atomically with this terminal transition.
            expectedLastEventId: 0
          });
          if (!updateResult || updateResult.ok !== true || updateResult.updated !== true) {
            throw {
              code: 'STREAM_SESSION_UPDATE_FAILED',
              message: updateResult && updateResult.error && updateResult.error.message ? updateResult.error.message : '流式会话终态更新失败',
              retryable: !!(updateResult && updateResult.retryable)
            };
          }
        }

        var wrote = writer.write(aiCoreSSE.formatSSEEvent(event));
        if (!wrote) throw { code: 'STREAM_CLIENT_WRITE_FAILED', message: '客户端连接已关闭', retryable: true };
        finalized = true;
        if (clientRequestId) pendingStreamCreations.delete(creationKey);
        cleanup();
        return { ok: true, status: status, last_event_id: lastEventId };
      })().catch(function(error) {
        console.error('[code-agent-stream] finalizer failed:', error && error.message ? error.message : error);
        // Leave the persisted stream state untouched on a temporary failure.
        // The client receives a retryable signal and can use resume/status.
        writeUnpersistedTerminalError(error && error.code || 'STREAM_FINALIZE_FAILED', error && error.message || '流式终态保存失败，请稍后恢复', 'persistence');
        finalized = true;
        if (clientRequestId) pendingStreamCreations.delete(creationKey);
        cleanup();
        return { ok: false, status: 'running', retryable: true, error: error };
      });
      return finalizationPromise;
    }

    function sendStreamError(code, message, phase) {
      if (finalized || finalizationPromise) return finalizationPromise;
      var structured = aiCoreErrorMapper.buildErrorResponse(code, message, {
        requestId: requestId,
        phase: phase || 'stream',
        retryable: (code === 'PROVIDER_TIMEOUT' || code === 'RATE_LIMITED' ||
          code === 'PROVIDER_EMPTY_RESPONSE' || code === 'STREAM_INTERRUPTED')
      });
      return finalizeStream('failed', 'error', {
        status: 'failed',
        code: structured.code,
        message: structured.error,
        retryable: structured.retryable,
        request_id: structured.requestId,
        phase: structured.phase
      });
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
      var activePath = apResult.value ? normalizeContextPath(apResult.value) : '';
      if (activePath && !validatePath(activePath)) { sendStreamError('INVALID_PATH', '当前路径无效', 'validation'); return; }
      var activeDocumentHint2 = /\.(docx?|pdf|pptx?|xlsx?)$/i.test(activePath);

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
        if (sessionData) { sessionData.history = clampHistoryList(history.slice()); sessionData.messageCount = sessionData.history.length; touchSession(sessionData); }
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
      var hasDocumentContent2 = openFiles.length > 0 || attachments.length > 0;
      if (!indexSummary && !hasDocumentContent2 && needsProjectContext(message) && !isFreshnessQuery(message) && !isExplicitSearch(message)) {
        if (activeDocumentHint2) {
          sendStreamError('DOCUMENT_CONTEXT_MISSING', '当前文档内容未随请求发送，请重新打开文档后重试', 'validation');
          return;
        }
        sendStreamError('INDEX_REBUILD_REQUIRED', '项目索引需要重新建立，但当前文档内容已可用，您可以继续提问', 'validation');
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

      var modelSelection = resolveCodeModel(deps, body.model_id);
      if (!modelSelection.ok) { sendStreamError(modelSelection.code, 'MODEL_NOT_AVAILABLE', 'validated'); return; }
      model = modelSelection.model.id;
      var thinkingSelection = resolveThinkingMode(body.thinking_mode, message);
      if (!thinkingSelection.ok) { sendStreamError('INVALID_THINKING_MODE', 'INVALID_THINKING_MODE', 'validated'); return; }
      var capabilities = buildCodeCapabilities(deps);
      // Keep the runtime identity aligned with the validated per-request
      // selection instead of falling back to the deployment default model.
      capabilities.model = model;
      var thinkingMode = thinkingSelection.effective;
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
          // H-12: 单 chunk 超过 4000 字符时按 4000 拆分多条 answer_delta，
          // 避免超出部分被静默丢弃导致客户端收到残缺回答。
          var deltaText = String(chunk);
          var MAX_DELTA_CHARS = 4000;
          if (deltaText.length <= MAX_DELTA_CHARS) {
            sendSSE('answer_delta', { delta: deltaText });
          } else {
            for (var di = 0; di < deltaText.length; di += MAX_DELTA_CHARS) {
              sendSSE('answer_delta', { delta: deltaText.slice(di, di + MAX_DELTA_CHARS) });
            }
          }
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
      
      if (aborted || finalized) {
        if (aborted && !finalized) {
          await finalizeStream('cancelled', 'cancelled', {
            status: 'cancelled',
            code: 'REQUEST_CANCELLED',
            message: 'Request cancelled',
            retryable: false,
            phase: 'cancelled'
          });
        } else {
          cleanup();
        }
        return;
      }

      var rawContent = aiResult && typeof aiResult.content === 'string' ? aiResult.content : '';
      if (!rawContent.trim()) {
        sendStreamError('PROVIDER_EMPTY_RESPONSE', 'AI 返回了空响应', 'provider');
        return;
      }

      // Parse operations
      var operations = [];
      var reply = rawContent;
      var parsed = extractJsonFromText(rawContent);
      if (parsed && Array.isArray(parsed.operations)) {
        operations = parseOperations(parsed.operations);
        var checkedOperations = validateOperationsAgainstContext(operations, openFiles.concat(attachments));
        operations = checkedOperations.operations;
        var jsonBlockMatch = rawContent.match(JSON_BLOCK_RE);
        if (jsonBlockMatch) reply = (rawContent.slice(0, jsonBlockMatch.index) + rawContent.slice(jsonBlockMatch.index + jsonBlockMatch[0].length)).trim();
        reply = appendOperationWarnings(reply, checkedOperations.rejected);
      }
      reply = reply.trim();
      if (!reply && operations.length > 0) reply = '已生成可应用的修改建议。';
      if (!reply) {
        sendStreamError('PROVIDER_EMPTY_RESPONSE', 'AI 返回了空响应', 'provider');
        return;
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

      // Persist the terminal event and session state before exposing done to
      // the client. This keeps done, last_event_id, and session.status aligned.
      await finalizeStream('completed', 'done', {
        status: 'completed',
        reply: reply,
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

    } catch (err) {
      if (timedOut) {
        sendStreamError('PROVIDER_TIMEOUT', 'AI 请求超时，服务端任务已停止', 'provider');
        return;
      }
      if (aborted || (err && err.name === 'AbortError')) {
        await finalizeStream('cancelled', 'cancelled', { status: 'cancelled', code: 'REQUEST_CANCELLED', message: 'Request cancelled', retryable: false, phase: 'cancelled' });
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
      var sessionResult = await streamSession.getStreamSession(supabase, streamId);
      if (sessionResult && sessionResult.query_failed) {
        return res.status(503).json({ ok: false, code: 'STREAM_SESSION_QUERY_FAILED', error: 'Stream session query failed; retry later', retryable: true, details: sessionResult.error || null });
      }
      var session = sessionResult && sessionResult.data;
      if (!sessionResult || sessionResult.found !== true || !session) {
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
      var eventsResult = await streamSession.getEventsAfter(supabase, streamId, afterEventId);
      if (eventsResult && eventsResult.ok === false) {
        return res.status(503).json({ ok: false, code: 'STREAM_EVENTS_QUERY_FAILED', error: 'Stream event query failed; retry later', retryable: true, details: eventsResult.error || null });
      }
      var events = eventsResult && Array.isArray(eventsResult.events) ? eventsResult.events : [];

      // Determine response based on session status
      var response = {
        ok: true,
        stream_id: streamId,
        request_id: session.request_id,
        client_request_id: session.client_request_id,
        status: session.status,
        result_status: session.status,
        terminal: session.status !== 'running',
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
      } else {
        response.message = '流式会话状态未知';
      }

      return res.json(response);
    } catch (err) {
      console.error('[code-agent-resume] Error:', err.message);
      return res.status(500).json({ ok: false, code: 'RESUME_ERROR', error: '恢复失败，请稍后重试' });
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
      var sessionResult = await streamSession.getStreamSession(supabase, streamId);
      if (sessionResult && sessionResult.query_failed) {
        return res.status(503).json({ ok: false, code: 'STREAM_SESSION_QUERY_FAILED', error: 'Stream session query failed; retry later', retryable: true, details: sessionResult.error || null });
      }
      var session = sessionResult && sessionResult.data;
      if (!sessionResult || sessionResult.found !== true || !session) {
        return res.status(404).json({ ok: false, code: 'STREAM_NOT_FOUND', error: '流式会话不存在' });
      }
      if (session.user_id !== userId) {
        return res.status(403).json({ ok: false, code: 'STREAM_NOT_OWNED', error: '无权操作该流式会话' });
      }

      if (session.status !== 'running') {
        return res.json({
          ok: true,
          stream_id: streamId,
          status: session.status,
          result_status: session.status,
          terminal: true,
          already_terminal: true,
          message: session.status === 'completed' ? '流式会话已完成' :
            (session.status === 'cancelled' ? '流式会话已取消' : '流式会话已失败')
        });
      }

      // Phase 3-P0-3: Actually abort the running request
      var controller = streamAbortControllers.get(streamId);
      if (controller) {
        try { controller.abort(); } catch (_) {}
        streamAbortControllers.delete(streamId);
      }

      var cancelUpdateResult = await streamSession.updateStreamSession(supabase, streamId, {
        status: 'cancelled',
        completed_at: new Date().toISOString()
      }, {
        expectedStatus: 'running'
      });
      if (!cancelUpdateResult || cancelUpdateResult.ok !== true || cancelUpdateResult.updated !== true) {
        return res.status(503).json({
          ok: false,
          code: 'STREAM_CANCEL_UPDATE_FAILED',
          error: 'Stream cancellation was not confirmed; retry later',
          retryable: true,
          details: cancelUpdateResult && cancelUpdateResult.error ? cancelUpdateResult.error : null
        });
      }

      return res.json({ ok: true, stream_id: streamId, status: 'cancelled', message: '流式会话已取消' });
    } catch (err) {
      console.error('[code-agent-cancel] Error:', err.message);
      return res.status(500).json({ ok: false, code: 'CANCEL_ERROR', error: '取消失败，请稍后重试' });
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
    var conversationId = String(req.query.conversation_id || '').slice(0, 200);
    var clientRequestId = String(req.query.client_request_id || '').slice(0, 200);

    try {
      var result = await streamSession.getStreamSessions(supabase, userId, {
        workspaceId: workspaceId,
        workspaceGeneration: workspaceGeneration,
        conversationId: conversationId,
        clientRequestId: clientRequestId,
        limit: 10
      });
      if (!result || result.ok !== true) {
        return res.status(503).json({ ok: false, code: 'DB_ERROR', error: 'Stream status query failed; retry later', retryable: true, has_running: false, sessions: [] });
      }
      // Phase 1-P0-8: Database errors must not be disguised as empty results.
      if (result.error) {
        return res.status(500).json({
          ok: false,
          code: 'DB_ERROR',
          error: '查询流式会话失败',
          retryable: true,
          has_running: false,
          sessions: []
        });
      }

      var sessions = (result.sessions || []).map(function(s) {
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
      // Phase 1-P0-8: Surface unexpected errors instead of hiding them.
      return res.status(500).json({
        ok: false,
        code: 'STATUS_ERROR',
        error: '检查流式状态时发生异常',
        retryable: true,
        has_running: false,
        sessions: []
      });
    }
  });

};
