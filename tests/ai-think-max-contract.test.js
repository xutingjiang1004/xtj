'use strict';

// 思考Max 契约测试：验证「思考Max」开关的前后端接线一致性。
//   未开启思考Max：上下文限制在 256 条，超过自动压缩（便宜/更快但略笨）。
//   开启思考Max：不自动压缩，尽量榨干模型上下文与性能（thinking_max=true）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(ROOT, 'render-api', 'server.js'), 'utf8');
const agentSource = fs.readFileSync(path.join(ROOT, 'js', 'ai-agent.js'), 'utf8');
// switchDockTab 跨 05/06 两个 part 文件（2026 修复拆分边界后），契约逻辑读两者拼合
const corePartsSource = fs.readFileSync(path.join(ROOT, 'js', 'core-parts', '05-feed-stats.js'), 'utf8')
  + fs.readFileSync(path.join(ROOT, 'js', 'core-parts', '06-chat-and-nav.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('后端：默认上下文上限为 256，思考Max 时放大上限', () => {
  assert.match(serverSource, /const AI_CHAT_HISTORY_LIMIT = 256;/);
  assert.match(serverSource, /const AI_CHAT_HISTORY_LIMIT_MAX = 2048;/);
  assert.match(serverSource, /const AI_CHAT_HISTORY_MSG_MAX_CHARS_MAX = 32000;/);
});

test('后端：两条主聊天路由都通过 aiChatHistoryBudget 按 thinking_max 决定上下文', () => {
  // 两条 /chat/stream 构建历史消息处都用 helper，不再直接 slice 固定 20 条
  const uses = (serverSource.match(/aiChatHistoryBudget\(ctx, _ctxMaxSite\d\);/g) || []).length;
  assert.ok(uses >= 2, 'expected at least 2 chat routes to use aiChatHistoryBudget, got ' + uses);
  assert.match(serverSource, /_ctxMaxSite\d = !!!?\(req\.body && req\.body\.thinking_max === true\)/);
  assert.match(serverSource, /thinking_max === true/);
});

test('后端：aiChatHistoryBudget 实现限量 + 自动压缩 + 保底最近一条 + 保留 vision_urls', () => {
  // helper 返回新数组但保留原对象，多模态 vision_urls 不被剥落
  assert.match(serverSource, /function aiChatHistoryBudget\(ctx, maxMode\)/);
  assert.match(serverSource, /histRaw\.slice\(-limit\)/);
  assert.match(serverSource, /保底保留最近一条/);
});

test('前端：存在思考Max 状态、持久化键与 256 上下文常量', () => {
  assert.match(agentSource, /thinkMax: false/);
  assert.match(agentSource, /xtj_ai_think_max/);
  assert.match(agentSource, /var CONTEXT_LIMIT_NORMAL = 256;/);
  assert.match(agentSource, /var CONTEXT_LIMIT_MAX = 2048;/);
});

test('前端：加号菜单含思考Max 开关行，且位于思考 与 网页搜索 之间', () => {
  const thinkRow = agentSource.indexOf('data-action="think-max"');
  const thinkRowSel = agentSource.indexOf('data-action="open-think"');
  const searchBtn = agentSource.indexOf('data-action="search"');
  assert.ok(thinkRow > -1, '思考Max 行缺失');
  assert.ok(thinkRow > thinkRowSel, '思考Max 应位于 思考 之后');
  assert.ok(searchBtn > thinkRow, '思考Max 应位于 网页搜索 之前');
  assert.match(agentSource, /updateThinkMaxStatus/);
});

test('前端：请求体携带 thinking_max，关闭时上下文限制 256 并压缩，开启时放大', () => {
  assert.equal((agentSource.match(/thinking_max: S\.thinkMax === true/g) || []).length, 2);
  assert.match(agentSource, /var _ctxCap = S\.thinkMax \? CONTEXT_LIMIT_MAX : CONTEXT_LIMIT_NORMAL;/);
  assert.match(agentSource, /S\.messages\.slice\(-_ctxCap\)/);
});

test('前端：思考Max 开关切回默认不自动压缩（think-max 点击处理）', () => {
  assert.match(agentSource, /if \(action === 'think-max'\)/);
  assert.match(agentSource, /S\.thinkMax = !S\.thinkMax;/);
  assert.match(agentSource, /localStorage\.setItem\('xtj_ai_think_max'/);
});

test('移动端：dock 新增小猫AI 中间按钮 + 打开时隐藏多余返回按钮', () => {
  // index.html dock 含 data-tab="ai-chat"，位于 chat 与 ai(照片墙) 之间（第三个）
  const dockTabs = ['posts', 'chat', 'ai-chat', 'ai', 'profile'];
  let prev = -1;
  for (const t of dockTabs) {
    const at = htmlSource.indexOf('data-tab="' + t + '"');
    assert.ok(at > prev, 'dock tab 顺序错误或缺失: ' + t);
    prev = at;
  }
  // 核心切换逻辑：ai-chat 打开 dock 模式；离开时关闭小猫AI 浮层
  assert.match(corePartsSource, /if \(tab === 'ai-chat'\)/);
  assert.match(corePartsSource, /__xtjOpenAiChatFromDock \|\| window\.__xtjOpenAiChat/);
  assert.match(corePartsSource, /__xtjCloseAiChat/);
  // ai-agent dock 模式隐藏返回按钮
  assert.match(agentSource, /ai-chat-dock/);
  assert.match(agentSource, /function openAiChat\(opts\)/);
  assert.match(agentSource, /__xtjOpenAiChatFromDock = function/);
  assert.match(agentSource, /if \(!S\._dockMode\)/);
});

test('移动端：小猫AI 作为首页打开时无多余左上返回按钮但仍可经 dock 切换（CSS 上移）', () => {
  assert.match(agentSource, /ai-chat-root ai-idle' \+ \(S\._dockMode \? ' ai-chat-dock' : ''\)/);
  assert.match(agentSource, /S\._dockMode = !!!?\(opts && opts\.dock\)/);
  assert.match(agentSource, /_dockMode = false/); // 关闭时复位 dock 标记
});