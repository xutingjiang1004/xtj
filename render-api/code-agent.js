'use strict';

// ===================== Code workspace AI chat API =====================
// Mounted in server.js as a route module.
// Handles POST /api/code/chat — AI-powered code operations.

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
const OP_TYPES_ALLOWED = new Set(['update', 'create']);
const OP_TYPES_REJECTED = new Set(['delete', 'rename', 'execute', 'terminal', 'git']);
const SHA256_HEX_RE = /^[a-fA-F0-9]{64}$/;
const JSON_BLOCK_RE = /```json\s*([\s\S]*?)\s*```/i;
const JSON_OBJECT_RE = /\{[\s\S]*"operations"[\s\S]*\}/;

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
        content = content.substring(0, MAX_SINGLE_FILE_CONTENT - 1000) + truncateStr;
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
    if (type === 'update' && !isValidSha256(op.expected_sha256)) continue;
    if (typeof op.new_content !== 'string') continue;
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
      var candidate = objMatch[0];
      // Try to find balanced braces
      var depth = 0, start = objMatch.index;
      for (var i = start; i < text.length; i++) {
        if (text[i] === '{') depth++;
        if (text[i] === '}') depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, i + 1)); } catch (_) { break; }
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
    'You can only see files explicitly included in this request.',
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
    '  - type: "update" (modify existing file) or "create" (create new file)',
    '  - path: relative file path within the workspace (e.g., "src/components/App.jsx")',
    '  - expected_sha256: (for "update" type only) the SHA-256 hex hash of the file content you were given',
    '  - summary: a brief description of the change (max 200 chars)',
    '  - new_content: the complete new file content as a string',
    '',
    'IMPORTANT RULES:',
    '- Only return update or create operations.',
    '- Return at most 6 file operations.',
    '- For "update" operations, new_content must contain the ENTIRE file, not just the changed parts.',
    '- For "create" operations, new_content must contain the complete new file.',
    '- Only use "update" and "create" types. Do NOT use delete, rename, execute, terminal, or git.',
    '- Paths must be relative (no absolute paths, no ".." traversal).',
    '- expected_sha256 must be exactly the 64-character hex hash of the file content sent to you.',
    '- If information is missing, ask the user to add the required file to context.',
    '- If you are not making code changes, do NOT include the JSON block — just provide your explanation.',
    '- Always provide your reasoning and explanation FIRST, before the JSON block.',
    '',
    'Example response format:',
    '',
    'I will add a new utility function to handle date formatting...',
    '',
    '```json',
    '{',
    '  "operations": [',
    '    {',
    '      "type": "update",',
    '      "path": "src/utils/date.js",',
    '      "expected_sha256": "abc123...",',
    '      "summary": "Add formatDate utility function",',
    '      "new_content": "// ... complete file content ..."',
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

// ── Main route registration ────────────────────────────────────────────

module.exports = function registerCodeAgentRoutes(app, deps) {
  var supabase = deps.supabase;
  var rateLimit = deps.rateLimit;
  var authenticateUser = deps.authenticateUser;
  var sanitizeError = deps.sanitizeError;

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

      var model = process.env.DEEPSEEK_MODEL_REASONER || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

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
            // Client disconnected — not a timeout
            console.error('[code-agent] Request cancelled by client');
          } else {
            console.error('[code-agent] DeepSeek API timeout');
          }
          return;
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
          return res.status(500).json({ ok: false, error: 'AI 服务繁忙，请稍后重试' });
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
        // Still try to extract clean reply
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
      return res.json({
        ok: true,
        reply: reply,
        operations: operations
      });

    } catch (err) {
      console.error('[code-agent] Unhandled error:', err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, error: sanitizeError ? sanitizeError(err) : '操作失败' });
    }
  });
};