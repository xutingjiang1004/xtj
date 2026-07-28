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
  assert.match(server, /webSearch:\s*searchWeb/);
});

test('Code Agent JSON payload has a scoped large-body parser', () => {
  const codeParser = server.indexOf("app.use('/api/code', express.json({ limit: '64mb' }));");
  const defaultParser = server.indexOf("app.use(express.json({ limit: '12mb' }));");
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
  assert.match(codeAgent, /s\.indexOf\('\\.\\.'\) >= 0/);
});

test('code-agent validatePath rejects absolute paths', () => {
  assert.match(codeAgent, /s\.charCodeAt\(0\) === 47/);
  assert.match(codeAgent, /\[A-Za-z\]:/);
});

test('code-agent validatePath rejects backslashes', () => {
  assert.match(codeAgent, /s\.indexOf\('\\\\'\) >= 0/);
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

test('system prompt enforces replace_range, create and document only', () => {
  assert.match(codeAgent, /Only use "replace_range", "create", and "document"/);
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
  assert.match(codeAgent, /项目索引不完整/);
  assert.match(codeAgent, /不要声称检查了整个工作区/);
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
  assert.match(codeAgent, /options\.webSearch/);
  assert.match(server, /webSearch:\s*searchWeb/);
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

test('DeepSeek capability snapshot reads provider limits from deployment metadata', () => {
  const snapshot = server.match(/function getDeepSeekCapabilitySnapshot\(\)[\s\S]*?\n\}/);
  assert.ok(snapshot, 'capability snapshot should exist');
  assert.match(snapshot[0], /DEEPSEEK_PROVIDER_CONTEXT_TOKENS/);
  assert.match(snapshot[0], /DEEPSEEK_PROVIDER_MAX_OUTPUT_TOKENS/);
  assert.match(snapshot[0], /providerContextTokens: providerContextTokens/);
  assert.match(snapshot[0], /providerMaxOutputTokens: providerMaxOutputTokens/);
  assert.doesNotMatch(snapshot[0], /providerContextTokens:\s*1000000/);
  assert.doesNotMatch(snapshot[0], /providerMaxOutputTokens:\s*384000/);
});

// ============================================================
// 18. Runtime identity & capabilities injection
// ============================================================
test('system prompt contains runtime identity rules forbidding Claude/GPT/Gemini claims', () => {
  assert.match(codeAgent, /运行时身份与能力规则/);
  assert.match(codeAgent, /不要声称自己是 Claude/);
  assert.match(codeAgent, /不要声称自己是.*Anthropic/);
  assert.match(codeAgent, /不要声称自己是.*GPT/);
  assert.match(codeAgent, /不要声称自己是.*Gemini/);
  assert.match(codeAgent, /自称 Claude.*Anthropic.*200K tokens.*15 万英文单词/);
});

test('get_runtime_capabilities tool is registered in CODE_AGENT_TOOLS', () => {
  assert.match(codeAgent, /name: 'get_runtime_capabilities'/);
  assert.match(codeAgent, /Return the current runtime capabilities/);
  assert.match(codeAgent, /provider.*model.*context window size.*output limits/);
});

test('runtime identity is injected into user message, not system prompt', () => {
  // The system prompt should be static (no dynamic provider/model injection)
  // The runtime info must be in the user message instead
  assert.match(codeAgent, /【运行时环境】/);
  assert.match(codeAgent, /Provider:.*caps\.provider/);
  assert.match(codeAgent, /模型:.*caps\.model/);
  assert.match(codeAgent, /站点配置上下文上限/);
  assert.match(codeAgent, /当前思考模式/);
  assert.match(codeAgent, /服务器提供的真实运行时数据/);
});

test('buildAgentMessages accepts capabilities and thinkingMode parameters', () => {
  assert.match(codeAgent, /function buildAgentMessages\(history, currentMessage, workspaceName, indexSummary, activePath, openFiles, attachments, capabilities, thinkingMode, inputBudget\)/);
});

test('response includes runtime field with provider, model, token stats', () => {
  assert.match(codeAgent, /runtime: runtimeInfo/);
  assert.match(codeAgent, /var runtimeInfo = \{/);
  assert.match(codeAgent, /provider: caps\.provider/);
  assert.match(codeAgent, /model: caps\.model/);
  assert.match(codeAgent, /configuredContextTokens/);
  assert.match(codeAgent, /inputBudgetTokens/);
  assert.match(codeAgent, /promptTokens/);
  assert.match(codeAgent, /toolReadTokens/);
  assert.match(codeAgent, /cacheHitTokens/);
  assert.match(codeAgent, /cacheMissTokens/);
  assert.match(codeAgent, /completionTokens/);
  assert.match(codeAgent, /remainingEstimatedTokens/);
});

test('context_info includes runtime sub-object', () => {
  assert.match(codeAgent, /context_info: \{/);
  assert.match(codeAgent, /runtime: runtimeInfo/);
});

test('remainingEstimatedTokens is computed from real data only', () => {
  assert.match(codeAgent, /var remainingEstimatedTokens = null/);
  assert.match(codeAgent, /caps\.maxContextTokens && typeof promptTokens === 'number'/);
  assert.match(codeAgent, /Math\.max\(0, caps\.maxContextTokens - promptTokens - readTokens - outputReserve\)/);
});

test('buildCodeCapabilities returns provider, model, configured, agentEnabled, toolCallingEnabled', () => {
  assert.match(codeAgent, /function buildCodeCapabilities/);
  assert.match(codeAgent, /provider: 'deepseek'/);
  assert.match(codeAgent, /agentEnabled:/);
  assert.match(codeAgent, /toolCallingEnabled:/);
  assert.match(codeAgent, /providerContextTokens:/);
  assert.match(codeAgent, /providerMaxOutputTokens:/);
  assert.match(codeAgent, /maxContextTokens:/);
  assert.match(codeAgent, /maxOutputTokens:/);
  assert.match(codeAgent, /maxToolRounds:/);
});

test('createCodeToolExecutor accepts runtimeCapabilities parameter', () => {
  assert.match(codeAgent, /function createCodeToolExecutor\(scope, activePath, openFiles, attachments, trace, maxInputTokens, deps, runtimeCapabilities\)/);
  assert.match(codeAgent, /runtimeCapabilities = runtimeCapabilities \|\| \{\}/);
});

test('get_runtime_capabilities handler returns provider, model, configured, limits, thinkingMode', () => {
  assert.match(codeAgent, /name === 'get_runtime_capabilities'/);
  assert.match(codeAgent, /provider: runtimeCapabilities\.provider/);
  assert.match(codeAgent, /model: runtimeCapabilities\.model/);
  assert.match(codeAgent, /configured: runtimeCapabilities\.configured === true/);
  assert.match(codeAgent, /agentEnabled: runtimeCapabilities\.agentEnabled === true/);
  assert.match(codeAgent, /toolCallingEnabled: runtimeCapabilities\.toolCallingEnabled === true/);
  assert.match(codeAgent, /providerContextTokens: runtimeCapabilities\.providerContextTokens/);
  assert.match(codeAgent, /providerMaxOutputTokens: runtimeCapabilities\.providerMaxOutputTokens/);
  assert.match(codeAgent, /maxContextTokens: runtimeCapabilities\.maxContextTokens/);
  assert.match(codeAgent, /maxOutputTokens: runtimeCapabilities\.maxOutputTokens/);
  assert.match(codeAgent, /maxToolRounds: runtimeCapabilities\.maxToolRounds/);
  assert.match(codeAgent, /thinkingMode: runtimeCapabilities\.thinkingMode/);
  assert.match(codeAgent, /inputBudgetTokens: typeof maxInputTokens === 'number' \? maxInputTokens : null/);
});

test('system prompt distinguishes project index scale from model context', () => {
  assert.match(codeAgent, /项目索引中的"文件数"和"代码块数"只表示索引规模/);
  assert.match(codeAgent, /不代表这些内容已进入当前上下文/);
  assert.match(codeAgent, /必须区分索引规模和实际读取量/);
});

test('user message warns about partial index in user message, not system prompt', () => {
  assert.match(codeAgent, /项目索引不完整/);
  // The warning should be inside the user message, not the system prompt
  assert.match(codeAgent, /stateLines\.push\('注意：项目索引不完整/);
});


// ============================================================
// 19. HTTP 400 Classification & Thinking Fallback
// ============================================================
test('code-agent classifies HTTP 400 errors properly', () => {
  assert.match(codeAgent, /PROVIDER_CONTEXT_TOO_LARGE/);
  assert.match(codeAgent, /PROVIDER_INVALID_THINKING_MODE/);
  assert.match(codeAgent, /PROVIDER_INVALID_MODEL/);
  assert.match(codeAgent, /PROVIDER_TOOL_CALL_UNSUPPORTED/);
});

test('code-agent falls back to off for thinking mode incompatibility', () => {
  assert.match(codeAgent, /thinking_mode\s*=\s*'off'/);
  assert.match(codeAgent, /isThinkingIncompatible/);
});
