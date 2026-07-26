const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const codeAgent = fs.readFileSync('render-api/code-agent.js', 'utf8');
const server = fs.readFileSync('render-api/server.js', 'utf8');

// ============================================================
// 1. API Key 不出现在前端文件
// ============================================================
test('DEEPSEEK_API_KEY is read from deps, not hardcoded', () => {
  assert.match(codeAgent, /deps\.getDeepSeekApiKey/);
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

test('Code Agent JSON payload has a scoped large-body parser', () => {
  const codeParser = server.indexOf("app.use('/api/code', express.json({ limit: '64mb' }));");
  const defaultParser = server.indexOf("app.use(express.json({ limit: '5mb' }));");
  assert.ok(codeParser >= 0, 'missing /api/code JSON parser');
  assert.ok(defaultParser > codeParser, 'default parser must remain after scoped Code parser');
});

test('DeepSeek tool rounds preserve reasoning_content and clean abort listeners', () => {
  assert.match(server, /roundReasoning\s*\+=\s*sDelta\.reasoning_content/);
  assert.match(server, /assistantToolMessage\.reasoning_content\s*=\s*roundReasoning/);
  assert.match(server, /externalSignal\.removeEventListener\('abort', externalAbortHandler\)/);
  assert.match(server, /noToolAbortHandler = function\(\) \{ try \{ noToolController\.abort\(\)/);
  assert.match(server, /externalSignal\.removeEventListener\('abort', noToolAbortHandler\)/);
  assert.match(server, /sBuffer \+= decoder\.decode\(\);[\s\S]*sBuffer \+= '\\n';/);
  assert.match(server, /round === 0 && options && options\.first_tool_choice/);
  assert.match(codeAgent, /inferInitialToolChoice/);
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

// Phase 1: MAX_FILES and MAX_FILES_TOTAL_CONTENT are deprecated.
// Context is now managed via project index + token budget, not static file uploads.
test('code-agent uses the scoped project index through real tools', () => {
  assert.match(codeAgent, /codeIndex/);
  assert.match(codeAgent, /getIndexSummary/);
  assert.match(codeAgent, /createCodeToolExecutor/);
  assert.match(codeAgent, /workspace_generation/);
});

test('code-agent budgets against the configured model context window', () => {
  assert.match(codeAgent, /CODE_AGENT_CONTEXT_TOKENS/);
  assert.match(codeAgent, /inputBudget/);
  assert.match(codeAgent, /estimateTokens/);
});

test('code-agent no longer hard-blocks on file count or total content size', () => {
  // validateFiles should not contain the old hard-block error messages
  assert.ok(!/文件数量最多/.test(codeAgent), 'should not hard-block on file count');
  assert.ok(!/文件总内容不能超过/.test(codeAgent), 'should not hard-block on total content size');
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
test('code-agent delegates to the shared DeepSeek tool loop', () => {
  assert.match(codeAgent, /deps\.callDeepSeek/);
  assert.match(codeAgent, /tools:\s*CODE_AGENT_TOOLS/);
  assert.match(codeAgent, /tool_choice:\s*'auto'/);
  assert.match(codeAgent, /max_tool_rounds:\s*CODE_AGENT_MAX_TOOL_ROUNDS/);
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
  assert.match(codeAgent, /expert coding and document assistant/);
});

test('system prompt enforces update, create and document only', () => {
  assert.match(codeAgent, /Only use "update", "create", and "document"/);
  assert.match(codeAgent, /Do NOT use delete, rename, execute, terminal, or git/);
});

// ============================================================
// 15. 用户消息构建
// ============================================================
test('code-agent builds user message with code context', () => {
  assert.match(codeAgent, /function buildUserMessage/);
  assert.match(codeAgent, /项目代码/);
  assert.match(codeAgent, /SHA256/);
});

test('code-agent warns the model when the project index is partial', () => {
  assert.match(codeAgent, /project index is partial/);
  assert.match(codeAgent, /Never claim that the entire workspace was inspected/);
});

test('code-agent prioritizes open documents when the project index is missing', () => {
  assert.match(codeAgent, /do not ask to rebuild the project index/i);
  assert.match(codeAgent, /未建立（当前打开文件和上传资料仍可读取）/);
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

test('Code Agent web tools are server-only, freshness-guided, and key-authenticated', () => {
  assert.match(codeAgent, /CODE_AGENT_WEB_SEARCH_URL/);
  assert.match(codeAgent, /CODE_AGENT_WEB_SEARCH_API_KEY/);
  assert.match(codeAgent, /headers\.Authorization = 'Bearer ' \+ WEB_SEARCH_API_KEY/);
  assert.match(codeAgent, /published_at/);
  assert.match(codeAgent, /fetch_web_page/);
  assert.match(codeAgent, /isFreshnessQuery/);
  assert.match(codeAgent, /WEB_SEARCH_NOT_CONFIGURED/);
});

test('Code Agent web fetch enforces HTTPS, DNS/private-address checks, redirects and size limits', () => {
  assert.match(codeAgent, /parsed\.protocol !== 'https:'/);
  assert.match(codeAgent, /isBlockedWebHost/);
  assert.match(codeAgent, /isPrivateAddress/);
  assert.match(codeAgent, /WEB_MAX_REDIRECTS/);
  assert.match(codeAgent, /WEB_MAX_BYTES/);
  assert.match(codeAgent, /lookup:/);
});
