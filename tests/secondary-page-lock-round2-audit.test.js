'use strict';
// 第二轮审计 点-4：XTJSecondaryPageState 的 owner 泄漏 → body 锁永久不释放。
// 根因：ai-agent.js 的 updateSecondaryPageState 调 open(owner) 时不传面板元素，
// owner 的 domRef 为 null，cleanStaleOwners 永远无法回收；一旦某条关闭路径
// 漏调 close，html/body 的 overflow:hidden + touch-action:none 就一直锁着。
// 修复：open 时按 owner 传面板元素（ai-chat→panelAiChat、deep-think→
// panelDeepThink、site-search→aiSiteSearchPanel），让 stale 清理能兜底。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const agentSrc = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const bootstrapSrc = fs.readFileSync(path.join(root, 'js', 'core-parts', '01-bootstrap.js'), 'utf8');

test('点-4: updateSecondaryPageState open 时必须把面板元素传给 XTJSecondaryPageState', () => {
  const mapIdx = agentSrc.indexOf('var SECONDARY_PAGE_PANELS');
  assert.ok(mapIdx >= 0, '应有 owner→面板的映射');
  const idx = agentSrc.indexOf('function updateSecondaryPageState');
  assert.ok(idx >= 0, '应有 updateSecondaryPageState');
  const body = agentSrc.slice(mapIdx, idx + 1500);
  assert.ok(/window\.XTJSecondaryPageState\.open\(owner, ownerEl\)/.test(body),
    'open 时必须传面板元素，不能只传 owner');
  assert.ok(body.includes("'ai-chat': 'panelAiChat'"), 'ai-chat 应映射到 panelAiChat');
  assert.ok(body.includes("'deep-think': 'panelDeepThink'"), 'deep-think 应映射到 panelDeepThink');
  assert.ok(body.includes("'site-search': 'aiSiteSearchPanel'"), 'site-search 应映射到 aiSiteSearchPanel');
});

test('点-4: XTJSecondaryPageState 收到 domRef 后，面板隐藏/断开时必须能回收 owner', () => {
  const idx = bootstrapSrc.indexOf('function cleanStaleOwners');
  assert.ok(idx >= 0, '应有 cleanStaleOwners');
  const body = bootstrapSrc.slice(idx, idx + 1200);
  assert.ok(body.includes('entry.domRef'), '清理必须看 domRef');
  assert.ok(body.includes("el.classList.contains('hidden')"), '面板变 hidden 时应回收 owner');
  assert.ok(body.includes('!el.isConnected'), '面板断开时应回收 owner');
  const openIdx = bootstrapSrc.indexOf('open: function(ownerName, domElement)');
  assert.ok(openIdx >= 0, 'open 应接受 domElement 参数');
  assert.ok(bootstrapSrc.slice(openIdx, openIdx + 1400).includes('new WeakRef(domElement)'),
    'open 应把 domElement 存成 WeakRef');
});
