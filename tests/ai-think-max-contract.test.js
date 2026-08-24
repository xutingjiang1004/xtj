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
const corePartsSource = fs.readFileSync(path.join(ROOT, 'js', 'core-parts', '05-feed-stats.js'), 'utf8');
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
  const thinkSelect = agentSource.indexOf('aiPlusThinkSelect');
  const searchBtn = agentSource.indexOf('data-action="search"');
  assert.ok(thinkRow > -1, '思考Max 行缺失');
  assert.ok(thinkRow > thinkSelect, '思考Max 应位于 思考 之后');
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

// ── P0/P1 运行时行为契约（直接执行 server.js 中真实的 aiChatHistoryBudget）──
// 不从 require server.js（它 require 即 listen），改为从源码提取该纯函数在隔离作用域运行。
function loadAiChatHistoryBudget() {
  const src = serverSource;
  const start = src.indexOf('function aiChatHistoryBudget(ctx, maxMode) {');
  assert.ok(start > -1, '未找到 aiChatHistoryBudget');
  const brace = src.indexOf('{', start);
  assert.ok(src[brace] === '{', '函数体起始应为 {');
  let depth = 0, i = brace;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = src.slice(start, i + 1);
  // 该函数体只引用这些模块级常量 → 作为参数构造，在隔离作用域运行
  const factory = new Function(
    'AI_CHAT_HISTORY_LIMIT', 'AI_CHAT_HISTORY_LIMIT_MAX',
    'AI_CHAT_HISTORY_MSG_MAX_CHARS', 'AI_CHAT_HISTORY_MSG_MAX_CHARS_MAX',
    'return (' + body + ');'
  );
  return factory(256, 2048, 4000, 32000);
}

test('运行时：aiChatHistoryBudget 默认限制 256 条，思考Max 放大条数上限', () => {
  const budget = loadAiChatHistoryBudget();
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ role: 'user', content: 'm' + i }));
  const normal = budget({ history: mk(300) }, false);
  assert.equal(normal.length, 256, '默认应裁剪到 256 条');
  const maxed = budget({ history: mk(300) }, true);
  assert.equal(maxed.length, 300, '思考Max 应保留全部 300 条（不裁剪条数）');
});

test('运行时：aiChatHistoryBudget 超出字符预算丢弃更早内容且保底保留最近一条', () => {
  const budget = loadAiChatHistoryBudget();
  // 60 条 × 5000 字符：默认总预算 220000 会被约 44 条打满，更早的整条被丢弃
  const big = Array.from({ length: 60 }, (_, i) => ({ role: 'user', content: 'x'.repeat(5000) }));
  const out = budget({ history: big }, false);
  assert.ok(out.length > 0, '至少保底保留一条');
  assert.equal(out[out.length - 1].content.length, 5000, '保底保留最近一条不应被丢');
  assert.equal(out.length, 44, '默认预算 220000 应保留 44 条 5000 字符消息');
  // vision_urls 必须被保留（多模态连续追问依赖）
  const multi = [
    { role: 'user', content: '图', vision_urls: ['data:image/png;base64,AAA'] },
    { role: 'assistant', content: 'ok' }
  ];
  const kept = budget({ history: multi }, true);
  assert.equal(kept[0].role, 'user');
  assert.ok(Array.isArray(kept[0].vision_urls) && kept[0].vision_urls.length === 1, 'vision_urls 应保留');
});

test('后端接线：loadAiContext 单条截断随思考Max 放大（P0 修复不回归）', () => {
  // ① 单条截断显式按 maxMode 二选一（4000 / 32000）
  assert.match(serverSource, /var _msgCap = maxMode \? AI_CHAT_HISTORY_MSG_MAX_CHARS_MAX : AI_CHAT_HISTORY_MSG_MAX_CHARS;/);
  // ② 行级行前预算随 maxMode 放大，避免旧逻辑掐掉长消息
  assert.match(serverSource, /var HISTORY_TOKEN_BUDGET = maxMode \? 200000 : 12000;/);
  // ③ loadAiContext 第三个参数透传 maxMode，且两条聊天路由都穿 thinking_max
  assert.match(serverSource, /async function loadAiContext\(userName, convId, maxMode\)/);
  const passes = (serverSource.match(/loadAiContext\(userName, convId, !!!?\(req\.body && req\.body\.thinking_max === true\)\)/g) || []).length;
  assert.ok(passes >= 2, '至少两条聊天路由透传 maxMode，实得 ' + passes);
});