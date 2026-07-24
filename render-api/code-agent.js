'use strict';

// ===================== Code workspace AI chat API =====================
// Mounted in server.js as a route module.
// Handles POST /api/code/chat — AI-powered code operations.
// Also handles POST /api/code/document/extract and /api/code/document/apply

const crypto = require('crypto');

// ── Constants ──────────────────────────────────────────────────────────
const MAX_MESSAGE_LEN = 4000;
const MAX_HISTORY_ITEMS = 20;
const MAX_FILES = 12;
const MAX_FILES_TOTAL_CONTENT = 600 * 1024; // 600 KB
const MAX_SINGLE_FILE_CONTENT = 1 * 1024 * 1024; // 1 MB
const MAX_OPERATIONS = 6;
const MAX_NEW_CONTENT_LEN = 1 * 1024 * 1024; // 1 MB per new_content
const DEEPSEEK_TIMEOUT_MS = 120000; // 120 秒超时
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
  if (files.length > MAX_FILES) return { ok: false, error: '文件数量最多 ' + MAX_FILES + ' 个' };
  var cleaned = [];
  var totalContent = 0;
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!f || typeof f !== 'object') continue;
    if (typeof f.path !== 'string' || !f.path.trim()) continue;
    if (!validatePath(f.path.trim())) continue;
    if (typeof f.content !== 'string') continue;

    var content = f.content;
    var contentBytes = Buffer.byteLength(content, 'utf8');

    // Truncate large files instead of rejecting
    if (contentBytes > MAX_SINGLE_FILE_CONTENT) {
      var truncateStr = '\n...[Content truncated due to size limits]...';
      // Rough truncation based on bytes
      var buffer = Buffer.from(content, 'utf8');
      content = buffer.subarray(0, MAX_SINGLE_FILE_CONTENT - 1000).toString('utf8') + truncateStr;
      contentBytes = Buffer.byteLength(content, 'utf8');
    }

    totalContent += contentBytes;
    if (totalContent > MAX_FILES_TOTAL_CONTENT) {
      return { ok: false, error: '文件总内容不能超过 600 KB' };
    }

    var item = {
      path: f.path.trim(),
      language: typeof f.language === 'string' ? f.language.trim() : '',
      content: content,
      sha256: typeof f.sha256 === 'string' ? f.sha256.trim() : ''
    };
    cleaned.push(item);
  }
  return { ok: true, value: cleaned };
}

function validatePath(p) {
  if (typeof p !== 'string' || !p.trim()) return false;
  if (p.indexOf('..') >= 0) return false;
  if (p.indexOf('\\') >= 0) return false;
  // Reject absolute paths (Unix /foo/bar, Windows C:\foo)
  if (p.charCodeAt(0) === 47) return false; // '/'
  if (/^[A-Za-z]:/.test(p)) return false;
  // Reject empty segments
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
    // Reject dangerous operation types
    if (OP_TYPES_REJECTED.has(type)) continue;
    if (!isValidOperationType(type)) continue;
    if (!validatePath(op.path)) continue;

    if (type === 'document') {
      // Document operations: require document_type and document_operations
      var docType = (typeof op.document_type === 'string' ? op.document_type.trim().toLowerCase() : '');
      if (docType !== 'xlsx' && docType !== 'docx') continue;
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
    // new_content size limit
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
  // Try fenced JSON block first
  var match = text.match(JSON_BLOCK_RE);
  if (match) {
    try { return JSON.parse(match[1].trim()); } catch (_) {}
  }
  // Try to find a JSON object with "operations" field
  var objMatch = text.match(JSON_OBJECT_RE);
  if (objMatch) {
    try {
      // Find the nearest opening brace before "operations"
      var start = text.lastIndexOf('{', objMatch.index);
      if (start >= 0) {
        // Try to find balanced braces
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
    'You are an expert coding assistant integrated into a code workspace IDE.',
    'You can see the files that are included in the "项目文件" section below.',
    'Each file is labeled with its path, language, and SHA-256 hash.',
    'For document files (DOCX, XLSX), you will see their extracted text content.',
    'Never claim to have read or inspected files that were not provided.',
    'Do not claim tests, builds, commands, or Git operations were executed.',
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
    '  - document_type: (for "document" type) "xlsx" or "docx"',
    '  - document_operations: (for "document" type) array of sub-operations',
    '',
    'For XLSX document operations, use:',
    '  { "type": "cell_update", "sheet": "Sheet1", "cell": "A1", "value": "new value" }',
    '  { "type": "cell_delete", "sheet": "Sheet1", "cell": "A1" }',
    '  { "type": "sheet_add", "sheet": "NewSheet" }',
    '  { "type": "sheet_rename", "sheet": "OldName", "new_name": "NewName" }',
    '',
    'For DOCX document operations, use:',
    '  { "type": "text_replace", "find": "old text", "replace": "new text" }',
    '  { "type": "text_append", "content": "text to append" }',
    '  { "type": "text_prepend", "content": "text to prepend" }',
    '',
    'IMPORTANT RULES:',
    '- Only return update, create, or document operations.',
    '- Return at most 6 file operations.',
    '- For "update" operations, new_content must contain the ENTIRE file, not just the changed parts.',
    '- For "create" operations, new_content must contain the complete new file.',
    '- For "document" operations, include document_operations array with the specific changes.',
    '- Only use "update", "create", and "document" types. Do NOT use delete, rename, execute, terminal, or git.',
    '- Paths must be relative (no absolute paths, no ".." traversal).',
    '- expected_sha256 must be exactly the 64-character hex hash of the file content sent to you.',
    '- If information is missing, ask the user to add the required file to context.',
    '- If you are not making code changes, do NOT include the JSON block — just provide your explanation.',
    '- Always provide your reasoning and explanation FIRST, before the JSON block.',
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

function buildUserMessage(message, workspaceName, activePath, history, files) {
  var parts = [];

  if (workspaceName) {
    parts.push('【工作区】' + workspaceName);
  }
  if (activePath) {
    parts.push('【当前文件】' + activePath);
  }

  // Include file contents as context
  if (files && files.length > 0) {
    parts.push('');
    parts.push('【项目文件】');
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var shaSuffix = f.sha256 ? ' (SHA256: ' + f.sha256 + ')' : '';
      parts.push('--- ' + f.path + ' (' + f.language + ')' + shaSuffix + ' ---');
      parts.push(f.content);
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
    'application/vnd.ms-excel': '.xls',
    'application/msword': '.doc',
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
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

async function extractDocumentText(buffer, mimeType, fileName) {
  var text = '';
  var metadata = {};

  try {
    if (mimeType === 'application/pdf' && getPdfParser()) {
      var pdfData = await pdfParser(buffer);
      text = pdfData.text || '';
      metadata = { pages: pdfData.numpages || 0, info: pdfData.info || {} };
    } else if (
      (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
       mimeType === 'application/msword') && getMammothParser()
    ) {
      var mammothResult = await mammothParser.extractRawText({ buffer: buffer });
      text = mammothResult.value || '';
      metadata = mammothResult.messages || [];
    } else if (
      (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
       mimeType === 'application/vnd.ms-excel') && getXlsxParser()
    ) {
      var workbook = xlsxParser.read(buffer, { type: 'buffer' });
      var sheets = [];
      metadata = { sheetNames: workbook.SheetNames, sheetCount: workbook.SheetNames.length };
      workbook.SheetNames.forEach(function(sName) {
        var sheet = workbook.Sheets[sName];
        var csv = xlsxParser.utils.sheet_to_csv(sheet, { blankrows: false });
        sheets.push('【工作表: ' + sName + '】\n' + csv);
      });
      text = sheets.join('\n\n');
    } else if (mimeType === 'text/csv' || mimeType === 'text/plain') {
      text = buffer.toString('utf-8');
    } else {
      try {
        text = buffer.toString('utf-8').slice(0, 50000);
      } catch (e) {
        text = '';
      }
    }
  } catch (e) {
    console.error('[code-agent] Document extraction error:', e && e.message ? e.message : e);
    return { ok: false, error: '文档解析失败: ' + (e.message || '') };
  }

  return { ok: true, text: text, metadata: metadata };
}

// ── XLSX modification operations ──────────────────────────────────────
async function applyXlsxOperations(buffer, operations, fileName) {
  var xlsx = getXlsxParser();
  if (!xlsx) return { ok: false, error: 'XLSX 解析库不可用' };

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
          var cell = (op.cell || '').toUpperCase();
          var value = op.value !== undefined ? op.value : '';

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
            workbook.Sheets[sheetName][cell] = { t: 'n', f: value };
          } else if (typeof value === 'number') {
            workbook.Sheets[sheetName][cell] = { t: 'n', v: value };
          } else {
            workbook.Sheets[sheetName][cell] = { t: 's', v: String(value) };
          }

          appliedOps.push({ type: 'cell_update', sheet: sheetName, cell: cell, oldValue: oldValue, newValue: String(value) });
          changes.push({ type: 'cell_update', sheet: sheetName, cell: cell, old: oldValue, new: String(value) });
        } else if (op.type === 'cell_delete') {
          var sName = op.sheet || workbook.SheetNames[0];
          var cellRef = (op.cell || '').toUpperCase();
          if (workbook.Sheets[sName] && workbook.Sheets[sName][cellRef]) {
            var oldVal = String(workbook.Sheets[sName][cellRef].v || '');
            delete workbook.Sheets[sName][cellRef];
            appliedOps.push({ type: 'cell_delete', sheet: sName, cell: cellRef, oldValue: oldVal });
            changes.push({ type: 'cell_delete', sheet: sName, cell: cellRef, old: oldVal });
          }
        } else if (op.type === 'sheet_add') {
          var newSheetName = op.sheet || ('Sheet' + (workbook.SheetNames.length + 1));
          if (workbook.SheetNames.indexOf(newSheetName) === -1) {
            workbook.SheetNames.push(newSheetName);
            workbook.Sheets[newSheetName] = {};
            appliedOps.push({ type: 'sheet_add', sheet: newSheetName });
            changes.push({ type: 'sheet_add', sheet: newSheetName });
          }
        } else if (op.type === 'sheet_rename') {
          var oldName = op.sheet || '';
          var newName = op.new_name || '';
          var idx = workbook.SheetNames.indexOf(oldName);
          if (idx >= 0 && newName && workbook.SheetNames.indexOf(newName) === -1) {
            workbook.SheetNames[idx] = newName;
            workbook.Sheets[newName] = workbook.Sheets[oldName];
            delete workbook.Sheets[oldName];
            appliedOps.push({ type: 'sheet_rename', sheet: oldName, newName: newName });
            changes.push({ type: 'sheet_rename', old: oldName, new: newName });
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

    var newBuffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    var newFile = newBuffer.toString('base64');

    return {
      ok: true,
      newFile: newFile,
      newMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: fileName,
      beforeText: beforeText,
      afterText: afterText,
      changes: changes,
      appliedOps: appliedOps
    };
  } catch (e) {
    return { ok: false, error: 'XLSX 修改失败: ' + (e.message || '') };
  }
}

// ── DOCX text modification operations ─────────────────────────────────
async function applyDocxTextOperations(buffer, operations, fileName) {
  var mammoth = getMammothParser();
  if (!mammoth) return { ok: false, error: 'DOCX 解析库不可用' };

  try {
    var mammothResult = await mammoth.extractRawText({ buffer: buffer });
    var beforeText = mammothResult.value || '';
    var afterText = beforeText;
    var appliedOps = [];
    var changes = [];

    for (var i = 0; i < operations.length; i++) {
      var op = operations[i];
      if (!op || typeof op !== 'object') continue;

      try {
        if (op.type === 'text_replace') {
          var find = op.find || '';
          var replace = op.replace || '';
          if (find) {
            var count = 0;
            var escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            var regex = new RegExp(escaped, 'g');
            afterText = afterText.replace(regex, function() { count++; return replace; });
            appliedOps.push({ type: 'text_replace', find: find, replace: replace, count: count });
            changes.push({ type: 'text_replace', find: find, replace: replace, count: count });
          }
        } else if (op.type === 'text_append') {
          var content = op.content || '';
          afterText += '\n' + content;
          appliedOps.push({ type: 'text_append', content: content });
          changes.push({ type: 'text_append' });
        } else if (op.type === 'text_prepend') {
          var preContent = op.content || '';
          afterText = preContent + '\n' + afterText;
          appliedOps.push({ type: 'text_prepend', content: preContent });
          changes.push({ type: 'text_prepend' });
        }
      } catch (opErr) {
        changes.push({ type: op.type, error: opErr.message || '操作失败' });
      }
    }

    var newBuffer = Buffer.from(afterText, 'utf-8');
    var newFile = newBuffer.toString('base64');

    return {
      ok: true,
      newFile: newFile,
      newMimeType: 'text/plain',
      fileName: fileName ? fileName.replace(/\.(docx|doc)$/i, '_modified.txt') : 'modified.txt',
      beforeText: beforeText,
      afterText: afterText,
      changes: changes,
      appliedOps: appliedOps
    };
  } catch (e) {
    return { ok: false, error: 'DOCX 修改失败: ' + (e.message || '') };
  }
}

// ── Main route registration ────────────────────────────────────────────

module.exports = function registerCodeAgentRoutes(app, deps) {
  var supabase = deps.supabase;
  var rateLimit = deps.rateLimit;
  var authenticateUser = deps.authenticateUser;
  var sanitizeError = deps.sanitizeError;

  // ── Document text extraction ────────────────────────────────────────
  app.post('/api/code/document/extract', rateLimit(60000, 30), authenticateUser, async function(req, res) {
    try {
      var body = req.body;
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ ok: false, error: '请求无效' });
      }

      var base64Data = body.file || '';
      var mimeType = body.mimeType || '';
      var fileName = body.fileName || '';

      if (!base64Data) {
        return res.status(400).json({ ok: false, error: '缺少文件数据' });
      }

      if (!mimeType && fileName) {
        mimeType = detectMimeFromFileName(fileName);
      }

      if (!mimeType) {
        return res.status(400).json({ ok: false, error: '无法识别文件类型' });
      }

      if (base64Data.length > 70 * 1024 * 1024) {
        return res.status(400).json({ ok: false, error: '文件过大，最大支持 50MB' });
      }

      var buffer;
      try {
        buffer = Buffer.from(base64Data, 'base64');
      } catch (e) {
        return res.status(400).json({ ok: false, error: '文件数据解码失败' });
      }

      var extractResult = await extractDocumentText(buffer, mimeType, fileName);
      if (!extractResult.ok) {
        return res.status(500).json({ ok: false, error: extractResult.error });
      }

      var text = extractResult.text;
      var truncated = false;
      if (text.length > 100 * 1024) {
        text = text.slice(0, 100 * 1024) + '\n\n[内容过长，已截断]';
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
  app.post('/api/code/document/apply', rateLimit(60000, 15), authenticateUser, async function(req, res) {
    try {
      var body = req.body;
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ ok: false, error: '请求无效' });
      }

      var base64Data = body.file || '';
      var mimeType = body.mimeType || '';
      var fileName = body.fileName || '';

      if (!base64Data) {
        return res.status(400).json({ ok: false, error: '缺少文件数据' });
      }

      if (!mimeType && fileName) {
        mimeType = detectMimeFromFileName(fileName);
      }

      if (!mimeType) {
        return res.status(400).json({ ok: false, error: '无法识别文件类型' });
      }

      var operations = body.operations;
      if (!Array.isArray(operations) || operations.length === 0) {
        return res.status(400).json({ ok: false, error: '缺少修改操作' });
      }

      if (base64Data.length > 70 * 1024 * 1024) {
        return res.status(400).json({ ok: false, error: '文件过大，最大支持 50MB' });
      }

      var buffer;
      try {
        buffer = Buffer.from(base64Data, 'base64');
      } catch (e) {
        return res.status(400).json({ ok: false, error: '文件数据解码失败' });
      }

      var result;
      var isXlsx = mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                   mimeType === 'application/vnd.ms-excel';
      var isDocx = mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                   mimeType === 'application/msword';

      if (isXlsx && getXlsxParser()) {
        result = await applyXlsxOperations(buffer, operations, fileName);
      } else if (isDocx && getMammothParser()) {
        result = await applyDocxTextOperations(buffer, operations, fileName);
      } else {
        return res.status(400).json({ ok: false, error: '不支持的文件类型: ' + mimeType });
      }

      if (!result.ok) {
        return res.status(500).json({ ok: false, error: result.error });
      }

      return res.json({
        ok: true,
        newFile: result.newFile,
        newMimeType: result.newMimeType || mimeType,
        fileName: result.fileName || fileName,
        diff: {
          before: result.beforeText ? result.beforeText.slice(0, 50000) : '',
          after: result.afterText ? result.afterText.slice(0, 50000) : '',
          changes: result.changes || []
        },
        operations: result.appliedOps || []
      });
    } catch (err) {
      console.error('[code-agent] Document apply error:', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: sanitizeError ? sanitizeError(err) : '文档修改失败' });
    }
  });

  app.post('/api/code/chat', rateLimit(60000, 20), authenticateUser, async function(req, res) {
    var aborted = false;
    var deepSeekController = null;
    req.on('aborted', function() {
      aborted = true;
      if (deepSeekController) { try { deepSeekController.abort(); } catch (_) {} }
    });
    res.on('close', function() {
      if (!res.writableEnded) {
        aborted = true;
        if (deepSeekController) { try { deepSeekController.abort(); } catch (_) {} }
      }
    });

    try {
      var userName = req.userName;

      // ── Validate request body ──────────────────────────────────────
      var body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ ok: false, error: '请求无效' });
      }

      // message: required, string, max 4000 chars
      var msgResult = validateString(body.message, MAX_MESSAGE_LEN, '消息内容');
      if (!msgResult.ok) return res.status(400).json({ ok: false, error: msgResult.error });
      if (!msgResult.value) return res.status(400).json({ ok: false, error: '消息内容不能为空' });
      var message = msgResult.value;

      // workspace_name: optional string
      var wsResult = validateString(body.workspace_name, 200, '工作区名称');
      if (!wsResult.ok) return res.status(400).json({ ok: false, error: wsResult.error });
      var workspaceName = wsResult.value;

      // active_path: optional string, must pass path validation
      var apResult = validateString(body.active_path, 500, '当前路径');
      if (!apResult.ok) return res.status(400).json({ ok: false, error: apResult.error });
      var activePath = apResult.value;
      if (activePath && !validatePath(activePath)) {
        return res.status(400).json({ ok: false, error: '当前路径无效' });
      }

      // history: optional array, max 20 items
      var histResult = validateHistory(body.history);
      if (!histResult.ok) return res.status(400).json({ ok: false, error: histResult.error });
      var history = histResult.value;

      // files: optional array, max 12 items, with content size limits
      var filesResult = validateFiles(body.files);
      if (!filesResult.ok) return res.status(400).json({ ok: false, error: filesResult.error });
      var files = filesResult.value;

      // ── Build prompts ──────────────────────────────────────────────
      var systemPrompt = buildSystemPrompt();
      var userMessage = buildUserMessage(message, workspaceName, activePath, history, files);

      // ── Call DeepSeek API ──────────────────────────────────────────
      var apiKey = process.env.DEEPSEEK_API_KEY || '';
      if (!apiKey) {
        console.error('[code-agent] DEEPSEEK_API_KEY not configured');
        return res.status(500).json({ ok: false, error: 'AI 服务未配置' });
      }

      var baseUrl = process.env.DEEPSEEK_BASE_URL || process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
      // Ensure we have a valid URL ending
      if (!/\/chat\/completions$/.test(baseUrl)) {
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        if (!/\/chat\/completions$/.test(baseUrl)) {
          baseUrl = baseUrl + '/v1/chat/completions';
        }
      }

      var model = process.env.DEEPSEEK_MODEL_REASONER || process.env.DEEPSEEK_MODEL || 'deepseek-coder';

      deepSeekController = new AbortController();
      var timer = setTimeout(function() { deepSeekController.abort(); }, DEEPSEEK_TIMEOUT_MS);

      var apiResp;
      try {
        apiResp = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage }
            ],
            temperature: 0.3,
            max_tokens: 8192
          }),
          signal: deepSeekController.signal
        });
      } catch (err) {
        if (err.name === 'AbortError') {
          if (aborted) {
            console.error('[code-agent] Request cancelled by client');
            return;
          } else {
            console.error('[code-agent] DeepSeek API timeout');
            return res.status(504).json({ ok: false, error: 'AI 服务超时，请稍后重试' });
          }
        }
        console.error('[code-agent] DeepSeek API fetch error:', err.message || err);
        return res.status(500).json({ ok: false, error: 'AI 服务请求失败' });
      } finally {
        clearTimeout(timer);
      }

      if (aborted) return;

      if (!apiResp.ok) {
        var errText = '';
        try { errText = await apiResp.text(); } catch (_) {}
        console.error('[code-agent] DeepSeek API error ' + apiResp.status + ':', errText.slice(0, 500));
        if (apiResp.status === 429) {
          return res.status(429).json({ ok: false, error: 'AI 服务繁忙，请稍后重试' });
        }
        return res.status(500).json({ ok: false, error: 'AI 服务返回错误' });
      }

      var apiData;
      try {
        apiData = await apiResp.json();
      } catch (e) {
        console.error('[code-agent] Failed to parse DeepSeek response');
        return res.status(500).json({ ok: false, error: 'AI 服务响应解析失败' });
      }

      if (aborted) return;

      // ── Parse AI response ──────────────────────────────────────────
      var rawContent = '';
      if (apiData && apiData.choices && apiData.choices.length > 0) {
        var choice = apiData.choices[0];
        if (choice.message && typeof choice.message.content === 'string') {
          rawContent = choice.message.content;
        }
      }

      if (!rawContent) {
        console.error('[code-agent] Empty DeepSeek response');
        return res.status(500).json({ ok: false, error: 'AI 返回了空响应' });
      }

      // ── Extract operations from response ───────────────────────────
      var operations = [];
      var reply = rawContent;

      var parsed = extractJsonFromText(rawContent);
      if (parsed && parsed.operations && Array.isArray(parsed.operations)) {
        operations = parseOperations(parsed.operations);

        // Remove the JSON block from the reply text to avoid duplication
        var jsonBlockMatch = rawContent.match(JSON_BLOCK_RE);
        if (jsonBlockMatch) {
          reply = (rawContent.slice(0, jsonBlockMatch.index) + rawContent.slice(jsonBlockMatch.index + jsonBlockMatch[0].length)).trim();
        }
      }

      // If operations were not found in a fenced block, try to remove the inline JSON
      if (operations.length === 0 && parsed) {
        var objStart = rawContent.indexOf('{');
        if (objStart >= 0) {
          var depth = 0, end = -1;
          for (var i = objStart; i < rawContent.length; i++) {
            if (rawContent[i] === '{') depth++;
            if (rawContent[i] === '}') depth--;
            if (depth === 0) { end = i; break; }
          }
          if (end >= 0) {
            reply = (rawContent.slice(0, objStart) + rawContent.slice(end + 1)).trim();
          }
        }
      }

      // ── Build response ─────────────────────────────────────────────
      var tokenUsage = apiData.usage || null;
      if (tokenUsage) {
        console.log('[code-agent] API token usage:', tokenUsage);
      }

      return res.json({
        ok: true,
        reply: reply.trim(),
        operations: operations,
        usage: tokenUsage
      });
    } catch (err) {
      console.error('[code-agent] Unhandled error:', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: sanitizeError ? sanitizeError(err) : '操作失败' });
    }
  });
};