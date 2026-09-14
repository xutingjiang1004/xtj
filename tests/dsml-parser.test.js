'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '../render-api/server.js');
const serverCode = fs.readFileSync(serverPath, 'utf8');

const startIdx = serverCode.indexOf('function parseDsmlToolCalls(rawText, roundNumber) {');
const endIdx = serverCode.indexOf('function finalReplyContainsInternalProtocol(text) {', startIdx);
if (startIdx === -1 || endIdx === -1) {
  throw new Error("Could not find parseDsmlToolCalls bounds in server.js");
}

// parseDsmlToolCalls 依赖模块级的 DSML 正则常量，需一并提取，
// 否则测试环境会因 _DSML_MARKER_SRC 未定义而失败。
const constIdx = serverCode.indexOf('var _DSML_PIPE');
if (constIdx === -1) throw new Error('Could not find DSML regex constants in server.js');
const dsmlConsts = serverCode.substring(constIdx, startIdx);

let parseCode = serverCode.substring(startIdx, endIdx);
parseCode = '(function() { const options = { tools: [{ function: { name: "web_search", parameters: { properties: { query: { type: "string" } } } } }, { function: { name: "multi_search", parameters: { properties: { queries: { type: "array" } } } } }] }; ' + dsmlConsts + ' return ' + parseCode + '})();';
const parseDsmlToolCalls = eval(parseCode);

test('parseDsmlToolCalls handles standard attribute-based format', () => {
  const raw = "<|DSML|tool_calls>\n<|DSML|invoke name=\"web_search\">\n<|DSML|parameter name=\"query\" string=\"hello\">\n</|DSML|invoke>\n<|DSML|end>";
  const result = parseDsmlToolCalls(raw, 1);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].function.name, 'web_search');
  assert.deepEqual(JSON.parse(result.calls[0].function.arguments).query, 'hello');
});

test('parseDsmlToolCalls parses block format with a type flag (实机观测格式)', () => {
  // 实机观测（用户截图）：模型把参数写成 `<parameter name="query" string="true">真实值</parameter>`，
  // 其中 string="true" 是「该参数为字符串类型」的类型声明，真正的值在标签体内。
  // 解析器必须从标签体取值，而不是把类型标记的布尔 true 当成参数值。
  const raw = "<|DSML|tool_calls>\n<|DSML|invoke name=\"web_search\">\n<|DSML|parameter name=\"query\" string=\"true\">\nhello world\n</|DSML|parameter>\n</|DSML|invoke>\n<|DSML|end>";
  const result = parseDsmlToolCalls(raw, 1);
  assert.equal(result.detected, true);
  assert.equal(result.calls.length, 1, '块格式应被正确解析: ' + JSON.stringify(result.error));
  assert.equal(result.calls[0].function.name, 'web_search');
  assert.deepEqual(JSON.parse(result.calls[0].function.arguments).query, 'hello world');
});

test('parseDsmlToolCalls parses JSON parameters in block format', () => {
  // json="true" 声明的参数，其标签体是 JSON 字符串，解析后应得到真正的数组/对象。
  const raw = "<|DSML|tool_calls>\n<|DSML|invoke name=\"multi_search\">\n<|DSML|parameter name=\"queries\" json=\"true\">\n[\"a\", \"b\"]\n</|DSML|parameter>\n</|DSML|invoke>\n<|DSML|end>";
  const result = parseDsmlToolCalls(raw, 1);
  assert.equal(result.detected, true);
  assert.equal(result.calls.length, 1, 'JSON 块格式应被正确解析: ' + JSON.stringify(result.error));
  assert.equal(result.calls[0].function.name, 'multi_search');
  assert.deepEqual(JSON.parse(result.calls[0].function.arguments).queries, ['a', 'b']);
});

test('parseDsmlToolCalls safely handles unclosed tool calls', () => {
  // 未闭合的工具调用一律拒绝：不执行、也不作为正文泄漏。
  const raw = "<|DSML|tool_calls>\n<|DSML|invoke name=\"web_search\">\n<|DSML|parameter name=\"query\" string=\"true\">\nsome text";
  const result = parseDsmlToolCalls(raw, 1);
  assert.equal(result.detected, true);
  assert.equal(result.calls.length, 0, '未闭合调用不得被执行');
  assert.ok(result.error, 'expected a parse error, got: ' + JSON.stringify(result));
});
