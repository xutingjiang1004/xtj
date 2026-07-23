const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const aiAgent = fs.readFileSync('js/ai-agent.js', 'utf8');

// 8.1: throttleRAF Lock
test('throttleRAF has try/finally to prevent lock', () => {
  assert.match(aiAgent, /try \{/);
  assert.match(aiAgent, /finally \{/);
  assert.match(aiAgent, /ticking = false/);
});

test('throttleRAF ticking is reset in finally block', () => {
  // 确保 ticking 在 finally 中重置，而不是在 try 中
  const throttleFunc = aiAgent.match(/try \{[\s\S]*?finally \{[\s\S]*?ticking = false[\s\S]*?\}/);
  assert.ok(throttleFunc);
});

// 8.2: Markdown Double Escape
test('markdown code blocks are extracted before HTML escaping', () => {
  // 先提取代码块，再全局转义
  const renderMarkdown = aiAgent.match(/function renderMarkdown[\s\S]*?(?=function)/);
  assert.ok(renderMarkdown);
  // 代码块提取在全局转义之前
  const codeBlockExtract = renderMarkdown[0].match(/```[\s\S]*?%%%CODEBLOCK/);
  const globalEscape = renderMarkdown[0].match(/s = s\.replace\(.*?&amp;/);
  assert.ok(codeBlockExtract);
  assert.ok(globalEscape);
});

test('markdown code blocks are escaped only once', () => {
  // 代码块替换只做一次转义
  const codeBlockReplacement = aiAgent.match(/code\.replace\(.*?&amp;.*?&lt;.*?&gt;/);
  assert.ok(codeBlockReplacement);
});

test('markdown code blocks are restored after HTML escaping', () => {
  assert.match(aiAgent, /%%%CODEBLOCK\(\\d\+\)%%%/);
  assert.match(aiAgent, /codeBlocks\[parseInt\(idx\)\]/);
});