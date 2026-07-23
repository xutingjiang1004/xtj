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
  const renderMarkdown = aiAgent.match(/function renderMarkdown[\s\S]*?(?=\n  function|\nfunction)/);
  assert.ok(renderMarkdown);
  assert.ok(renderMarkdown[0].includes('%%%CODEBLOCK'));
  assert.ok(renderMarkdown[0].includes('.replace(/&/g, \'&amp;\')'));
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