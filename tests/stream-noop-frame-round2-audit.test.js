'use strict';
// 第二轮审计 点-6：流式渲染每帧全量 DOM diff，长回复占满主线程。
// 核查结论：两处 patchInnerHTML 已有增量快路径（tryExtendStreamHtml 纯追加、
// isEqualNode 跳过未变节点、定稿块冻结），“每帧全量”只发生在快路径 miss 或
// 内容完全没变又重复渲染时。本修复只做后者：html 与上一帧完全相同时直接
// 跳过整段 parse + diff（零行为变化，DOM 已是对的）。更深的增量 Markdown
// 解析重构风险高、无真机可测，不在本轮做。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const agentSrc = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const coreSrc = fs.readFileSync(path.join(root, 'js', 'ai-core', 'stream-renderer.js'), 'utf8');

function assertNoopSkip(src, file) {
  const idx = src.indexOf('function patchInnerHTML');
  assert.ok(idx >= 0, file + ' 应有 patchInnerHTML');
  const head = src.slice(idx, idx + 600);
  assert.ok(head.includes('if (targetEl.__xtjStreamHtml === html) return;'),
    file + ' 内容没变时应直接跳过全量 diff');
}

test('点-6: ai-agent.js 的 patchInnerHTML 内容没变时跳过全量 diff', () => {
  assertNoopSkip(agentSrc, 'js/ai-agent.js');
});

test('点-6: stream-renderer.js 的 patchInnerHTML 内容没变时跳过全量 diff', () => {
  assertNoopSkip(coreSrc, 'js/ai-core/stream-renderer.js');
});

test('点-6: 增量快路径仍保留（纯追加不走全量 diff）', () => {
  assert.ok(agentSrc.includes('tryExtendStreamHtml'), 'ai-agent.js 应保留 tryExtendStreamHtml 快路径');
  assert.ok(coreSrc.includes('tryExtendStreamHtml'), 'stream-renderer.js 应保留 tryExtendStreamHtml 快路径');
});
