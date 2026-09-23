'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const agent = read('js/ai-agent.js');
const aiCss = read('css/ai-agent.css');
const shellCss = read('css/ui-shell.css');

test('AI transcript sizing allows flex/grid children and bubbles to shrink within the viewport', () => {
  assert.match(aiCss, /\.ai-chat-root\s*\{[^}]*min-width:\s*0;[^}]*box-sizing:\s*border-box;/s);
  assert.match(aiCss, /\.ai-chat-messages\s*\{[^}]*min-width:\s*0;/s);
  assert.match(aiCss, /\.ai-msg\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
  assert.match(aiCss, /\.ai-msg-bubble\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*min\(92%,\s*720px\);[^}]*box-sizing:\s*border-box;/s);
  assert.match(shellCss, /#panelChat \.dock-chat-container,[\s\S]*?#panelChat \.chat-list\s*\{[^}]*min-width:\s*0;[^}]*box-sizing:\s*border-box;/);
});

test('desktop AI messages and cards stay in the main grid column without an empty min-content rail', () => {
  assert.match(aiCss, /\.ai-secondary-panel #aiChatRoot > \.ai-chat-messages\s*\{[^}]*min-width:\s*0;[^}]*box-sizing:\s*border-box;/s);
  assert.match(aiCss, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*var\(--ai-desktop-context\)\);/);
  assert.match(aiCss, /\.ai-secondary-panel #aiChatRoot > \.ai-chat-messages > \.ai-tool-card\s*\{[^}]*grid-column:\s*1;[^}]*min-width:\s*0;/s);
  assert.match(aiCss, /\.ai-tool-card-kv\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
});

test('tool_calls promotes pending placeholders instead of duplicating the same tool row', () => {
  const calls = agent.slice(agent.indexOf("if (evt.type === 'tool_calls')"), agent.indexOf("if (evt.type === 'enhanced_stage')"));
  assert.match(calls, /pendingRounds = timeline\.querySelectorAll\('\.ai-tool-round\.is-running'\)/);
  assert.match(calls, /pendingTitles\[pt\]\.textContent === '准备工具'/);
  assert.match(calls, /existing\.setAttribute\('data-tool-step', stepId\)/);
  assert.match(calls, /existing\.querySelector\('\.ai-tool-step-detail'\)/);
});

test('tool results match active same-name calls and only explicit success is shown as success', () => {
  const resultStart = agent.indexOf("if (evt.type === 'tool_result') {");
  const resultEnd = agent.indexOf("if (evt.type === 'error') {", resultStart);
  const result = agent.slice(resultStart, resultEnd);
  assert.match(result, /var toolSucceeded = evt\.success === true && !evt\.error/);
  assert.match(result, /exactRunningStep \|\| firstRunningStep \|\| exactNamedStep/);
  assert.match(result, /matchStep\.classList\.remove\('is-running', 'is-done', 'is-error'\)/);
  assert.match(result, /class: 'ai-tool-result-error'/);
  assert.match(result, /Array\.isArray\(itemsArr\)/);
});

test('a tool failure does not falsely settle parallel siblings, and unresolved tools are not marked completed', () => {
  const toolError = agent.slice(agent.indexOf("if (evt.type === 'tool_error')"), agent.indexOf("if (evt.type === 'tool_result')"));
  assert.doesNotMatch(toolError, /notify\(/);
  assert.doesNotMatch(toolError, /settleSearchStatus\(/);
  assert.doesNotMatch(toolError, /\.ai-tool-step\.is-running/);
  assert.match(toolError, /refreshOwningToolRound\(errMatch\)/);
  const cleanup = agent.slice(agent.indexOf('function clearAssistantTransientStatus'), agent.indexOf('function attachContinueGenerateBtn'));
  assert.match(cleanup, /rsEl\.classList\.add\('is-error'\)/);
  assert.match(cleanup, /未收到结果/);
  assert.doesNotMatch(cleanup, /rsEl\.classList\.add\('is-done'\)/);
});
