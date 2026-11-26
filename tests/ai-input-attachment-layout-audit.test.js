'use strict';
// B-05 回归：附件预览挤出输入框。
// 修复前：.ai-chat-input-bar 是 nowrap flex 行；.ai-chat-file-preview
//   flex-shrink:0、max-width:260px，与输入框抢同一行；360px 屏上固定件
//   （+40/语音 52/发送 50/边距 20/间距 32）已占 194px，剩 166px 既放不下
//   预览（内容下限约 88px）也放不下可用输入框（约 100px），而
//   .ai-chat-input-field 只有 flex:1 1 0、min-width:0，输入框被压到接近 0。
// 修复后：输入栏允许换行，附件预览独占一行（flex:1 1 100%）；输入框
//   加 min-width:120px 兜底，再紧也只会换行不被压扁。只作用于聊天输入栏，
//   .dt-file-preview（思考页）不受影响。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { postBrowserFixture, wireAiChat } = require('./helpers/post-browser-fixture');

const agentCss = fs.readFileSync('css/ai-agent.css', 'utf8');
const featuresCss = fs.readFileSync('css/ai-assistant-features.css', 'utf8');

test('B-05: 输入栏允许换行，附件预览独占一行', () => {
  const barIdx = agentCss.indexOf('.ai-chat-input-bar {');
  assert.ok(barIdx >= 0, '应有 .ai-chat-input-bar 规则');
  const barRule = agentCss.slice(barIdx, agentCss.indexOf('}', barIdx));
  assert.ok(/flex-wrap:\s*wrap/.test(barRule), '输入栏应允许换行，否则预览永远和输入框抢同一行');
  const scopedIdx = agentCss.indexOf('.ai-chat-input-bar .ai-chat-file-preview');
  assert.ok(scopedIdx >= 0, '应有仅作用于聊天输入栏的预览规则');
  const scopedRule = agentCss.slice(scopedIdx, agentCss.indexOf('}', scopedIdx));
  assert.ok(/flex:\s*1\s+1\s+100%/.test(scopedRule), '预览应独占一行（flex: 1 1 100%）');
  assert.ok(/max-width:\s*100%/.test(scopedRule), '独占行时预览不应再被 260px 封顶');
});

test('B-05: 输入框有最小可用宽度兜底', () => {
  const idx = featuresCss.indexOf('#panelAiChat .ai-chat-input-field');
  assert.ok(idx >= 0, '应有输入框容器规则');
  const rule = featuresCss.slice(idx, featuresCss.indexOf('}', idx));
  assert.ok(/min-width:\s*120px/.test(rule), '输入框应有 min-width:120px 兜底');
});

test('B-05: 思考页预览不受影响', () => {
  const idx = agentCss.indexOf('.ai-chat-file-preview,');
  assert.ok(idx >= 0, '应保留共享预览规则');
  const rule = agentCss.slice(idx, agentCss.indexOf('}', idx));
  assert.ok(/max-width:\s*260px/.test(rule), '共享规则仍应给 .dt-file-preview 保留 260px 上限');
  assert.ok(!/100%/.test(rule), '共享规则不应被改成 100%');
});

test('B-05: 360px 屏上挂附件后输入框仍可用', { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ viewport: { width: 360, height: 800 }, counts: [1] });
  try {
    await wireAiChat(f.page);
    await f.page.setInputFiles('#aiChatFileInp', {
      name: 'test.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVxkAAAAASUVORK5CYII=', 'base64'),
    });
    await f.page.waitForFunction(() => {
      const p = document.querySelector('#aiChatFilePreview');
      return p && getComputedStyle(p).display !== 'none';
    }, { timeout: 10000 });
    const m = await f.page.evaluate(() => {
      const preview = document.querySelector('#aiChatFilePreview').getBoundingClientRect();
      const input = document.querySelector('#aiChatMsgInput').getBoundingClientRect();
      return { previewBottom: preview.bottom, inputTop: input.top, inputWidth: input.width };
    });
    assert.ok(m.previewBottom <= m.inputTop + 1, '预览应在输入框上方独占一行，实际 previewBottom=' + m.previewBottom + ' inputTop=' + m.inputTop);
    assert.ok(m.inputWidth >= 120, '输入框宽度不应低于 120px，实际 ' + m.inputWidth);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
