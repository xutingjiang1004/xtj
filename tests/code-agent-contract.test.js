const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const codeAgent = fs.readFileSync('render-api/code-agent.js', 'utf8');
const server = fs.readFileSync('render-api/server.js', 'utf8');

// ============================================================
// 1. API Key 不出现在前端文件
// ============================================================
test('DEEPSEEK_API_KEY is read from process.env, not hardcoded', () => {
  assert.match(codeAgent, /process\.env\.DEEPSEEK_API_KEY/);
  assert.ok(!/sk-[a-zA-Z0-9]{20,}/.test(codeAgent), 'API key should not be hardcoded in code-agent.js');
});

// ============================================================
// 2. 路由注册 — POST /api/code/chat
// ============================================================
test('code-agent registers POST /api/code/chat route', () => {
  assert.match(codeAgent, /app\.post\('\/api\/code\/chat'/);
  assert.match(codeAgent, /module\.exports/);
});

// ============================================================
// 3. 认证中间件
// ============================================================
test('code-agent uses authenticateUser middleware', () => {
  assert.match(codeAgent, /authenticateUser/);
  // The route should have authenticateUser in middleware chain
  assert.match(codeAgent, /app\.post\('\/api\/code\/chat'.*authenticateUser/);
});

// ============================================================
// 4. 速率限制
// ============================================================
test('code-agent uses rateLimit middleware', () => {
  assert.match(codeAgent, /rateLimit/);
  assert.match(codeAgent, /app\.post\('\/api\/code\/chat'.*rateLimit/);
});

// ============================================================
// 5. server.js 注册了 code-agent
// ============================================================
test('server.js requires and registers code-agent', () => {
  assert.match(server, /require\('\.\/code-agent'\)/);
  assert.match(server, /registerCodeAgentRoutes/);
  assert.match(server, /registerCodeAgentRoutes\(app,\s*\{/);
});

// ============================================================
// 6. 请求验证
// ============================================================
test('code-agent validates message length', () => {
  assert.match(codeAgent, /MAX_MESSAGE_LEN/);
  assert.match(codeAgent, /12000/);
});

test('code-agent validates history length', () => {
  assert.match(codeAgent, /MAX_HISTORY_ITEMS/);
  assert.match(codeAgent, /50/);
});

test('code-agent validates files count', () => {
  assert.match(codeAgent, /MAX_FILES/);
  assert.match(codeAgent, /50/);
});

test('code-agent validates files total content size', () => {
  assert.match(codeAgent, /MAX_FILES_TOTAL_CONTENT/);
  assert.match(codeAgent, /900 \* 1024/);
});

test('code-agent validates single file content size', () => {
  assert.match(codeAgent, /MAX_SINGLE_FILE_CONTENT/);
  assert.match(codeAgent, /2 \* 1024 \* 1024/);
});

// ============================================================
// 7. 路径安全校验
// ============================================================
test('code-agent validatePath rejects ..', () => {
  assert.match(codeAgent, /p\.indexOf\('\.\.'\) >= 0/);
});

test('code-agent validatePath rejects absolute paths', () => {
  assert.match(codeAgent, /p\.charCodeAt\(0\) === 47/);
  assert.match(codeAgent, /\[A-Za-z\]:/);
});

test('code-agent validatePath rejects backslashes', () => {
  assert.match(codeAgent, /p\.indexOf\('\\\\'\) >= 0/);
});

// ============================================================
// 8. 操作类型限制
// ============================================================
test('code-agent only allows update, create and document operations', () => {
  assert.match(codeAgent, /OP_TYPES_ALLOWED/);
  assert.match(codeAgent, /'update'.*'create'.*'document'/);
});

test('code-agent rejects dangerous operation types', () => {
  assert.match(codeAgent, /OP_TYPES_REJECTED/);
  assert.match(codeAgent, /'delete'/);
  assert.match(codeAgent, /'rename'/);
  assert.match(codeAgent, /'execute'/);
  assert.match(codeAgent, /'terminal'/);
  assert.match(codeAgent, /'git'/);
});

// ============================================================
// 9. SHA-256 校验
// ============================================================
test('code-agent validates SHA-256 hex format', () => {
  assert.match(codeAgent, /SHA256_HEX_RE/);
  assert.match(codeAgent, /\[a-fA-F0-9\]\{64\}/);
});

test('code-agent requires expected_sha256 for update operations', () => {
  assert.match(codeAgent, /type === 'update' && !isValidSha256/);
});

// ============================================================
// 10. JSON 解析
// ============================================================
test('code-agent extracts JSON from response', () => {
  assert.match(codeAgent, /function extractJsonFromText/);
  assert.match(codeAgent, /JSON_BLOCK_RE/);
});

test('code-agent handles malformed JSON gracefully', () => {
  assert.match(codeAgent, /catch\s*\(_\)/);
  // When JSON is invalid, operations should be empty
  assert.match(codeAgent, /operations = parseOperations/);
});

// ============================================================
// 11. DeepSeek API 调用
// ============================================================
test('code-agent calls DeepSeek API', () => {
  assert.match(codeAgent, /fetch\(baseUrl/);
  assert.match(codeAgent, /Authorization.*Bearer/);
  assert.match(codeAgent, /apiKey/);
});

test('code-agent handles DeepSeek timeout', () => {
  assert.match(codeAgent, /DEEPSEEK_TIMEOUT_MS/);
  assert.match(codeAgent, /AbortController/);
  assert.match(codeAgent, /AbortError/);
});

// ============================================================
// 12. 响应格式
// ============================================================
test('code-agent returns ok, reply, and operations', () => {
  assert.match(codeAgent, /ok:\s*true/);
  assert.match(codeAgent, /reply:\s*reply/);
  assert.match(codeAgent, /operations:\s*operations/);
});

// ============================================================
// 13. 错误处理
// ============================================================
test('code-agent uses sanitizeError in catch handler', () => {
  assert.match(codeAgent, /sanitizeError/);
});

test('code-agent handles aborted requests', () => {
  assert.match(codeAgent, /aborted\s*=\s*true/);
  assert.match(codeAgent, /if\s*\(aborted\)\s*return/);
});

// ============================================================
// 14. 系统提示词
// ============================================================
test('code-agent has system prompt builder', () => {
  assert.match(codeAgent, /function buildSystemPrompt/);
  assert.match(codeAgent, /expert coding assistant/);
});

test('system prompt enforces update, create and document only', () => {
  assert.match(codeAgent, /Only use "update", "create", and "document"/);
  assert.match(codeAgent, /Do NOT use delete, rename, execute, terminal, or git/);
});

// ============================================================
// 15. 用户消息构建
// ============================================================
test('code-agent builds user message with file context', () => {
  assert.match(codeAgent, /function buildUserMessage/);
  assert.match(codeAgent, /项目文件/);
  assert.match(codeAgent, /SHA256/);
});

// ============================================================
// 16. 操作解析
// ============================================================
test('code-agent parseOperations validates paths', () => {
  assert.match(codeAgent, /function parseOperations/);
  assert.match(codeAgent, /validatePath\(op\.path\)/);
});

test('code-agent parseOperations validates new_content', () => {
  assert.match(codeAgent, /typeof op\.new_content !== 'string'/);
});

// ============================================================
// 17. Deps 注入
// ============================================================
test('code-agent accepts deps (supabase, rateLimit, authenticateUser, sanitizeError)', () => {
  assert.match(codeAgent, /function registerCodeAgentRoutes\(app,\s*deps\)/);
  assert.match(codeAgent, /deps\.supabase/);
  assert.match(codeAgent, /deps\.rateLimit/);
  assert.match(codeAgent, /deps\.authenticateUser/);
  assert.match(codeAgent, /deps\.sanitizeError/);
});