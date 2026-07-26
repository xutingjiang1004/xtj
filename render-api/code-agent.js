'use strict';

// ===================== Code workspace AI chat API =====================
// Mounted in server.js as a route module.
// Handles POST /api/code/chat — AI-powered code operations.
// Also handles POST /api/code/document/extract and /api/code/document/apply
// Phase 1: Project index + Agent tool calls + Token budget management

const crypto = require('crypto');
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
const MAX_REQUEST_OVERLAY_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 800 * 1024;
const MAX_PDF_PAGES = 500;
const MAX_WORKBOOK_SHEETS = 100;
const MAX_PPTX_ENTRIES = 2000;
const MAX_PPTX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const OP_TYPES_ALLOWED = new Set(['update', 'create', 'document']);
const OP_TYPES_REJECTED = new Set(['delete', 'rename', 'execute', 'terminal', 'git']);
const SHA256_HEX_RE = /^[a-fA-F0-9]{64}$/;
const JSON_BLOCK_RE = /```json\s*([\s\S]*?)\s*```/i;
const JSON_OBJECT_RE = /"operations"\s*:/;

// ── Helpers ────────────────────────────────────────────────────────────

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
    if (!validatePath(f.path.trim())) continue;
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
      path: f.path.trim(),
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

function validatePath(p) {
  if (typeof p !== 'string' || !p.trim()) return false;
  if (p.indexOf('..') >= 0) return false;
  if (p.indexOf('\\') >= 0) return false;
  if (p.charCodeAt(0) === 47) return false;
  if (/^[A-Za-z]:/.test(p)) return false;
  var parts = p.split('/');
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) return false;
  }
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

    if (type === 'document') {
      var docType = (typeof op.document_type === 'string' ? op.document_type.trim().toLowerCase() : '');
      if (docType !== 'xlsx') continue;
      var docOps = op.document_operations;
      if (!Array.isArray(docOps) || docOps.length === 0) continue;
      if (typeof op.summary !== 'string' || !op.summary.trim()) continue;
      ops.push({
        type: 'document',
        path: op.path.trim(),
        summary: op.summary.trim().slice(0, 200),
        document_type: docType,
        document_operations: docOps.slice(0, 20)
      });
      continue;
    }

    if (type === 'update' && !isValidSha256(op.expected_sha256)) continue;
    if (typeof op.new_content !== 'string' || op.new_content === '') continue;
    if (Buffer.byteLength(op.new_content, 'utf8') > MAX_NEW_CONTENT_LEN) continue;
    if (typeof op.summary !== 'string' || !op.summary.trim()) continue;
    ops.push({
      type: type,
      path: op.path.trim(),
      summary: op.summary.trim().slice(0, 200),
      new_content: op.new_content,
      expected_sha256: type === 'update' ? op.expected_sha256.toLowerCase() : undefined
    });
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
    'You have real read-only project tools. Use them proactively before making claims about the workspace.',
    'For an explicit file name, locate and read that file. For a broad project question, list files first.',
    'For debugging, search relevant terms, then read the strongest matching files and ranges.',
    'Pinned, active and open files are priority hints, never prerequisites for reading other files.',
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
    '  - type: "update" (modify existing file), "create" (create new file), or "document" (modify a document)',
    '  - path: relative file path within the workspace (e.g., "src/components/App.jsx")',
    '  - expected_sha256: (for "update" type only) the SHA-256 hex hash of the file content you were given',
    '  - summary: a brief description of the change (max 200 chars)',
    '  - new_content: (for "update"/"create") the complete new file content as a string',
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
    '- Only return update, create, or document operations.',
    '- Return at most 10 file operations.',
    '- DOCX files are read-only. Do not return document operations for DOCX. For DOCX modification requests, explain that the file can currently be analyzed but cannot be safely rewritten while preserving the DOCX format.',
    '- For "update" operations, new_content must contain the ENTIRE file, not just the changed parts.',
    '- For "create" operations, new_content must contain the complete new file.',
    '- For "document" operations, include document_operations array with the specific changes.',
    '- Only use "update", "create", and "document" types. Do NOT use delete, rename, execute, terminal, or git.',
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
    '```'
  ].join('\n');
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
  { type: 'function', function: { name: 'get_open_files', description: 'List open editor files and uploaded documents. Read a selected file afterwards.', parameters: { type: 'object', properties: {}, additionalProperties: false } } }
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
    var path = typeof item.path === 'string' ? item.path.trim() :
      (typeof item.name === 'string' ? ('attachments/' + item.name.trim().replace(/[\/\\]/g, '_')) : '');
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

function buildAgentMessages(history, currentMessage, workspaceName, indexSummary, activePath, openFiles, attachments) {
  var messages = [{ role: 'system', content: buildSystemPrompt() }];
  for (var i = 0; i < history.length; i++) messages.push(history[i]);
  messages.push({
    role: 'user',
    content: [
      '【本轮工作区状态】',
      '- 工作区: ' + (workspaceName || '未命名'),
      '- 索引: ' + (indexSummary ? (indexSummary.totalFiles + ' files / ' + indexSummary.totalChunks + ' chunks') : '需要重新建立'),
      '- 当前文件: ' + (activePath || '无'),
      '- 打开文件: ' + openFiles.map(function(file) { return file.path; }).join(', '),
      '- 已上传资料: ' + attachments.map(function(file) { return file.path; }).join(', '),
      '',
      '【用户消息】',
      currentMessage
    ].join('\n')
  });
  return messages;
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

function createCodeToolExecutor(scope, activePath, openFiles, attachments, trace, maxInputTokens) {
  var overlay = new Map();
  openFiles.concat(attachments).forEach(function(file) { overlay.set(file.path, file); });
  var remainingTokens = Math.max(0, maxInputTokens);

  function record(name, args, startedAt, result) {
    var content = result && typeof result.content === 'string' ? result.content : '';
    var tokens = codeIndex.estimateTokens(content || JSON.stringify(result || {}));
    remainingTokens = Math.max(0, remainingTokens - tokens);
    var entry = { round: trace.length + 1, tool: name, args: args, ok: !!(result && result.ok !== false && !result.error), duration_ms: Date.now() - startedAt, context_tokens: tokens };
    if (result && result.path) entry.path = result.path;
    if (result && (result.startLine || result.endLine)) entry.ranges = [[result.startLine || 1, result.endLine || result.startLine || 1]];
    if (result && Array.isArray(result.results)) {
      entry.files = result.results.map(function(item) { return { path: item.path, ranges: [[item.startLine || 1, item.endLine || item.startLine || 1]] }; });
    }
    if (result && result.error) entry.error = String(result.error).slice(0, 240);
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

async function extractDocumentText(buffer, mimeType, fileName) {
  var text = '';
  var metadata = {};

  try {
    if (mimeType === 'application/pdf' && getPdfParser()) {
      var pdfData = await pdfParser(buffer);
      if ((pdfData.numpages || 0) > MAX_PDF_PAGES) throw new Error('PDF 页数超过 ' + MAX_PDF_PAGES + ' 页');
      text = pdfData.text || '';
      metadata = { pages: pdfData.numpages || 0, info: pdfData.info || {} };
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && getMammothParser()
    ) {
      var mammothResult = await mammothParser.extractRawText({ buffer: buffer });
      text = mammothResult.value || '';
      metadata = mammothResult.messages || [];
    } else if (
      (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
       mimeType === 'application/vnd.ms-excel') && getXlsxParser()
    ) {
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
      var pptxResult = await extractPptxText(buffer);
      text = pptxResult.text;
      metadata = pptxResult.metadata;
    } else if (mimeType === 'text/csv' || mimeType === 'text/plain') {
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
      var result = codeIndex.buildIndex(scopeResult.value, body.files);

      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      console.log('[code-agent] Index built: ' + result.totalFiles + ' files, ' + result.totalChunks + ' chunks');

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
        status: result.status
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
      return res.json({
        ok: true,
        summary: summary,
        pinnedFiles: pinnedFiles,
        rebuildRequired: !summary
      });
    } catch (err) {
      console.error('[code-agent] Index status error:', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: sanitizeError ? sanitizeError(err) : '索引状态查询失败' });
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
    var model = deps.getDeepSeekModel ? deps.getDeepSeekModel() : '';
    var configured = !!(deps.getDeepSeekApiKey && deps.getDeepSeekApiKey());
    return res.json({
      ok: true,
      provider: 'deepseek',
      model: model || '',
      configured: configured,
      agentEnabled: configured && typeof deps.callDeepSeek === 'function',
      toolCallingEnabled: configured && typeof deps.callDeepSeek === 'function',
      maxContextTokens: CODE_AGENT_CONTEXT_TOKENS,
      maxOutputTokens: CODE_AGENT_MAX_OUTPUT_TOKENS,
      maxToolRounds: CODE_AGENT_MAX_TOOL_ROUNDS
    });
  });

  // ── Code chat: a real DeepSeek tool-calling agent ───────────────────
  app.post('/api/code/chat', rateLimit(60000, 20), authenticateUser, async function(req, res) {
    var aborted = false;
    var requestController = new AbortController();
    function abortRequest() {
      aborted = true;
      try { requestController.abort(); } catch (_) {}
    }
    req.once('aborted', abortRequest);
    res.once('close', function() { if (!res.writableEnded) abortRequest(); });

    try {
      var body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ ok: false, error: '请求无效' });

      var msgResult = validateString(body.message, MAX_MESSAGE_LEN, '消息内容');
      if (!msgResult.ok) return res.status(400).json({ ok: false, error: msgResult.error });
      if (!msgResult.value) return res.status(400).json({ ok: false, error: '消息内容不能为空' });
      var message = msgResult.value;

      var wsResult = validateString(body.workspace_name, 200, '工作区名称');
      if (!wsResult.ok) return res.status(400).json({ ok: false, error: wsResult.error });
      var workspaceName = wsResult.value || '';
      var scopeResult = validateWorkspaceScope(req, body);
      if (!scopeResult.ok) return res.status(400).json({ ok: false, error: scopeResult.error });
      var scope = scopeResult.value;

      var apResult = validateString(body.active_path, 500, '当前路径');
      if (!apResult.ok) return res.status(400).json({ ok: false, error: apResult.error });
      var activePath = apResult.value || '';
      if (activePath && !validatePath(activePath)) return res.status(400).json({ ok: false, error: '当前路径无效' });

      var histResult = validateHistory(body.history);
      if (!histResult.ok) return res.status(400).json({ ok: false, error: histResult.error });
      var history = histResult.value;

      var openResult = validateRequestFiles(body.open_files, MAX_OPEN_FILES, '打开文件');
      if (!openResult.ok) return res.status(413).json({ ok: false, error: openResult.error });
      var attachmentInput = Array.isArray(body.attachments) ? body.attachments : body.files;
      var attachmentResult = validateRequestFiles(attachmentInput, MAX_ATTACHMENTS, '上传资料');
      if (!attachmentResult.ok) return res.status(413).json({ ok: false, error: attachmentResult.error });
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
      if (!indexSummary && openFiles.length === 0 && attachments.length === 0) {
        return res.status(409).json({
          ok: false,
          code: 'INDEX_REBUILD_REQUIRED',
          error: '项目索引需要重新建立',
          rebuildRequired: true
        });
      }

      var apiKey = deps.getDeepSeekApiKey ? deps.getDeepSeekApiKey() : '';
      var model = deps.getDeepSeekModel ? deps.getDeepSeekModel() : '';
      if (!apiKey) return res.status(503).json({ ok: false, code: 'AI_NOT_CONFIGURED', error: 'AI 服务未配置' });
      if (!model) return res.status(503).json({ ok: false, code: 'MODEL_NOT_CONFIGURED', error: 'Code AI 模型未配置' });
      if (typeof deps.callDeepSeek !== 'function') return res.status(503).json({ ok: false, code: 'AGENT_NOT_AVAILABLE', error: 'Code Agent 未启用' });

      var messages = buildAgentMessages(history, message, workspaceName, indexSummary, activePath, openFiles, attachments);
      var promptTokens = codeIndex.estimateTokens(JSON.stringify(messages)) + codeIndex.estimateTokens(JSON.stringify(CODE_AGENT_TOOLS));
      var inputBudget = Math.max(8192, CODE_AGENT_CONTEXT_TOKENS - CODE_AGENT_MAX_OUTPUT_TOKENS - promptTokens - 8192);
      var toolTrace = [];
      var executor = createCodeToolExecutor(scope, activePath, openFiles, attachments, toolTrace, inputBudget);
      var thinkingMode = /^(off|low|medium|high)$/.test(String(body.thinking_mode || 'low')) ? String(body.thinking_mode || 'low') : 'low';

      var aiResult = await deps.callDeepSeek(messages, {
        model: model,
        thinking_mode: thinkingMode,
        tools: CODE_AGENT_TOOLS,
        tool_choice: 'auto',
        tool_executor: executor,
        max_tool_rounds: CODE_AGENT_MAX_TOOL_ROUNDS,
        max_tool_result_chars: Math.min(inputBudget * 4, 2000000),
        max_tokens: CODE_AGENT_MAX_OUTPUT_TOKENS,
        signal: requestController.signal
      });
      if (aborted) return;

      var rawContent = aiResult && typeof aiResult.content === 'string' ? aiResult.content : '';
      if (!rawContent) return res.status(502).json({ ok: false, error: 'AI 返回了空响应' });
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
      var capabilities = {
        provider: 'deepseek',
        model: aiResult.model || model,
        agentEnabled: true,
        toolCallingEnabled: true,
        maxContextTokens: CODE_AGENT_CONTEXT_TOKENS,
        maxOutputTokens: CODE_AGENT_MAX_OUTPUT_TOKENS,
        maxToolRounds: CODE_AGENT_MAX_TOOL_ROUNDS
      };
      return res.json({
        ok: true,
        reply: reply.trim(),
        operations: operations,
        usage: usage,
        capabilities: capabilities,
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
          cache_miss_tokens: usage && usage.prompt_cache_miss_tokens
        }
      });
    } catch (err) {
      if (aborted || (err && err.name === 'AbortError')) return;
      var message = err && err.message ? err.message : '';
      console.error('[code-agent] Unhandled error:', message || err);
      var status = /超时/.test(message) ? 504 : (/频繁|HTTP 429/.test(message) ? 429 : 502);
      return res.status(status).json({ ok: false, error: sanitizeError ? sanitizeError(err) : 'Code AI 请求失败' });
    }
  });
};
