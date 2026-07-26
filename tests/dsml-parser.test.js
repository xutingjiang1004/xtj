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

let parseCode = serverCode.substring(startIdx, endIdx);
parseCode = '(function() { const options = { tools: [{ function: { name: "web_search", parameters: { properties: { query: { type: "string" } } } } }, { function: { name: "multi_search", parameters: { properties: { queries: { type: "array" } } } } }] }; return ' + parseCode + '})();';
const parseDsmlToolCalls = eval(parseCode);

test('parseDsmlToolCalls handles standard attribute-based format', () => {
  const raw = "<|DSML|tool_calls>\n<|DSML|invoke name=\"web_search\">\n<|DSML|parameter name=\"query\" string=\"hello\">\n</|DSML|invoke>\n<|DSML|end>";
  const result = parseDsmlToolCalls(raw, 1);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].function.name, 'web_search');
  assert.deepEqual(JSON.parse(result.calls[0].function.arguments).query, 'hello');
});

test('parseDsmlToolCalls handles nested block format', () => {
  const raw = "<|DSML|tool_calls>\n<|DSML|invoke name=\"web_search\">\n<|DSML|parameter name=\"query\" string=\"true\">\nhello world\n</|DSML|parameter>\n</|DSML|invoke>\n<|DSML|end>";
  const result = parseDsmlToolCalls(raw, 1);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].function.name, 'web_search');
  assert.deepEqual(JSON.parse(result.calls[0].function.arguments).query, 'hello world');
});

test('parseDsmlToolCalls handles JSON parameters in block format', () => {
  const raw = "<|DSML|tool_calls>\n<|DSML|invoke name=\"multi_search\">\n<|DSML|parameter name=\"queries\" json=\"true\">\n[\"a\", \"b\"]\n</|DSML|parameter>\n</|DSML|invoke>\n<|DSML|end>";
  const result = parseDsmlToolCalls(raw, 1);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].function.name, 'multi_search');
  assert.deepEqual(JSON.parse(result.calls[0].function.arguments).queries, ["a", "b"]);
});

test('parseDsmlToolCalls safely handles unclosed tool calls', () => {
  const raw = "<|DSML|tool_calls>\n<|DSML|invoke name=\"web_search\">\n<|DSML|parameter name=\"query\" string=\"true\">\nsome text";
  const result = parseDsmlToolCalls(raw, 1);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].function.name, 'web_search');
  assert.deepEqual(JSON.parse(result.calls[0].function.arguments).query, 'some text');
});
