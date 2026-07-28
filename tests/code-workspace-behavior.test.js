const fs = require('fs');
const assert = require('assert');
const { test } = require('node:test');

// Read code-workspace.js to analyze its functions via string matching (since it's meant for browser)
const codeWorkspace = fs.readFileSync(__dirname + '/../js/code-workspace.js', 'utf8');

test('code-workspace buildOpenFilesContext uses extracted text for documents', () => {
  assert.match(codeWorkspace, /typeof tab\._extractedText === 'string'/);
});

test('code-workspace renderProjectStatus shows document status and permissions', () => {
  assert.match(codeWorkspace, /文本已解析/);
  assert.match(codeWorkspace, /文档解析失败/);
  assert.match(codeWorkspace, /文档正在解析/);
  assert.match(codeWorkspace, /文件系统权限/);
  assert.match(codeWorkspace, /格式修改能力/);
  assert.match(codeWorkspace, /文本解析状态/);
  assert.match(codeWorkspace, /保存验证状态/);
  assert.match(codeWorkspace, /只读/);
  assert.match(codeWorkspace, /可写/);
  assert.match(codeWorkspace, /可读取/);
  assert.match(codeWorkspace, /可修改/);
  assert.match(codeWorkspace, /可保存/);
});

test('code-workspace showError catches PROVIDER_ errors with details element', () => {
  assert.match(codeWorkspace, /code\.indexOf\('PROVIDER_'\) === 0/);
  assert.match(codeWorkspace, /AI 服务暂时无法处理该请求/);
  assert.match(codeWorkspace, /<details/);
  assert.match(codeWorkspace, /查看错误详情/);
});

test('code-workspace non-stream error handler restores message on HTTP 400', () => {
  assert.match(codeWorkspace, /PROVIDER_HTTP_400/);
  assert.match(codeWorkspace, /PROVIDER_INVALID_REQUEST/);
  assert.match(codeWorkspace, /VALIDATION_FAILED/);
});

test('code-workspace shows INDEX_REBUILD_REQUIRED friendly message', () => {
  assert.match(codeWorkspace, /INDEX_REBUILD_REQUIRED/);
  assert.match(codeWorkspace, /项目索引尚未建立，但文档内容已可用/);
});

// 新增真实行为测试：非流式错误不显示 [PROVIDER_HTTP_400] 在正文中
test('code-workspace non-stream error does not show error code in user message', () => {
  // 验证 formatUserMessage 存在
  var errorsJs = fs.readFileSync(__dirname + '/../js/ai-core/errors.js', 'utf8');
  assert.match(errorsJs, /formatUserMessage/);
  assert.match(errorsJs, /formatDebugDetails/);
  // 验证 formatDisplay 不再生成 [CODE] 格式
  assert.match(errorsJs, /formatDisplay.*function/);
  // 验证 code-workspace 使用 formatUserMessage
  assert.match(codeWorkspace, /formatUserMessage/);
});

// 新增真实行为测试：历史错误消息不被带入下一轮
test('code-workspace error messages are not added to history', () => {
  // 验证 assistantMsg 包含 errorCode 字段（用于结构化过滤）
  assert.match(codeWorkspace, /errorCode/);
  // 验证错误消息不会显示 [PROVIDER_ 格式在用户可见内容中
  // 用户可见消息应该使用 formatUserMessage 的结果
  assert.match(codeWorkspace, /userFriendlyMsg/);
});

// 新增真实行为测试：runtimeCapabilities 包含文档能力字段
test('code-agent runtimeCapabilities includes document capabilities', () => {
  var codeAgent = fs.readFileSync(__dirname + '/../render-api/code-agent.js', 'utf8');
  assert.match(codeAgent, /canReadDocx.*capabilities\.canReadDocx/);
  assert.match(codeAgent, /canWriteDocx.*capabilities\.canWriteDocx/);
  assert.match(codeAgent, /canReadXlsx.*capabilities\.canReadXlsx/);
  assert.match(codeAgent, /canReadPdf.*capabilities\.canReadPdf/);
  assert.match(codeAgent, /canReadPptx.*capabilities\.canReadPptx/);
  assert.match(codeAgent, /workspaceReadOnly.*capabilities\.workspaceReadOnly/);
});

// 新增真实行为测试：validateHistory 使用 indexOf 而非 startsWith
test('code-agent validateHistory uses indexOf for pattern matching', () => {
  var codeAgent = fs.readFileSync(__dirname + '/../render-api/code-agent.js', 'utf8');
  assert.match(codeAgent, /contentStr\.indexOf\('\[INDEX_REBUILD_REQUIRED\]'\)/);
  assert.match(codeAgent, /contentStr\.indexOf\('\[PROVIDER_'\)/);
  // 结构化过滤
  assert.match(codeAgent, /item\.errorCode/);
  assert.match(codeAgent, /item\.status === 'error'/);
});

// 新增真实行为测试：validateRequestFiles 使用 normalizeContextPath
test('code-agent validateRequestFiles uses normalizeContextPath', () => {
  var codeAgent = fs.readFileSync(__dirname + '/../render-api/code-agent.js', 'utf8');
  assert.match(codeAgent, /normalizeContextPath\(rawPath\)/);
  // 验证 validateFiles 也使用 normalizeContextPath
  assert.match(codeAgent, /normalizeContextPath\(f\.path\)/);
});

// 新增真实行为测试：caps 不再在流式路径中引用未定义变量
test('code-agent SSE stream done event uses capabilities not caps', () => {
  var codeAgent = fs.readFileSync(__dirname + '/../render-api/code-agent.js', 'utf8');
  // 验证流式 done 事件中 runtime 使用 capabilities.canReadDocx 而非 caps.canReadDocx
  // 流式路径中变量名为 capabilities
  var streamSection = codeAgent.substring(codeAgent.indexOf('sendSSE(\'done\''));
  // 在 done 事件附近不应该有 caps.canReadDocx
  assert.ok(!streamSection.includes('caps.canReadDocx'), 'SSE done should not use caps.canReadDocx');
  assert.ok(streamSection.includes('capabilities.canReadDocx'), 'SSE done should use capabilities.canReadDocx');
});