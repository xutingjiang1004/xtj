// ★ 2026-11-14（用户要求）：定时任务 / 自动化的接线契约测试。
// 只读源码做字符串断言，验证「工具定义 → 工具分发 → 调度器启动 → HTTP 路由 → 迁移」
// 这条链路完整，防止后续重构把某一环悄悄改掉。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'render-api/server.js'), 'utf8');
const agent = fs.readFileSync(path.join(ROOT, 'js/ai-agent.js'), 'utf8');
const migration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261114000000_ai_scheduled_tasks.sql'), 'utf8');

test('server.js 引入调度模块并创建实例', () => {
  assert.match(server, /require\('\.\/ai-scheduler'\)/);
  assert.match(server, /aiScheduler\.createScheduler\(\{/);
  assert.match(server, /runTask:\s*runScheduledTask/);
});

test('runScheduledTask 走「规划关键词 → 联网 → 生成简报」并跳过游客落库', () => {
  assert.match(server, /async function runScheduledTask\(task\)/);
  assert.match(server, /stQueries/);
  assert.match(server, /await searchWeb\(/);
  assert.match(server, /callDeepSeekAI\(\{/);
  // 游客任务不写 posts，只回写任务行摘要
  assert.match(server, /if \(stIsGuest\) \{\s*\n\s*return \{ summary/);
  // 游客任务在窗口外自动停用
  assert.match(server, /stIsGuest && !guestAiPublicWindowOpen\(\)/);
});

test('三个定时任务工具已注册到 AI_TOOLS', () => {
  ['schedule_task', 'list_scheduled_tasks', 'cancel_scheduled_task'].forEach((name) => {
    const re = new RegExp("name:\\s*'" + name + "'");
    assert.match(server, re, '缺少工具定义：' + name);
  });
});

test('工具分发实现了三个 case', () => {
  ["schedule_task", "list_scheduled_tasks", "cancel_scheduled_task"].forEach((name) => {
    const re = new RegExp("case\\s+'" + name + "':\\s*\\{");
    assert.match(server, re, '缺少分发分支：' + name);
  });
});

test('调度器在服务启动回调里被拉起', () => {
  assert.match(server, /aiTaskScheduler\.start\(\)/);
  assert.match(server, /\[SCHEDULER\] 定时任务调度器已启动/);
});

test('HTTP 路由齐备（列表/创建/启停/删除/试跑）且走 guestAiAuth', () => {
  assert.match(server, /app\.get\('\/api\/agent\/scheduled-tasks',\s*guestAiAuth/);
  assert.match(server, /app\.post\('\/api\/agent\/scheduled-tasks',\s*guestAiAuth/);
  assert.match(server, /app\.post\('\/api\/agent\/scheduled-tasks\/:id\/toggle',\s*guestAiAuth/);
  assert.match(server, /app\.delete\('\/api\/agent\/scheduled-tasks\/:id',\s*guestAiAuth/);
  assert.match(server, /app\.post\('\/api\/agent\/scheduled-tasks\/:id\/run',\s*guestAiAuth/);
});

test('迁移文件建表 + 索引 + RLS 收紧', () => {
  assert.match(migration, /create table if not exists public\.ai_scheduled_tasks/);
  assert.match(migration, /ai_scheduled_tasks_due_idx/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.ai_scheduled_tasks from anon, authenticated/);
  ['owner_name', 'prompt', 'schedule_kind', 'next_run_at', 'enabled', 'conversation_id'].forEach((col) => {
    assert.ok(migration.includes(col), '迁移缺列：' + col);
  });
});

test('前端有自动化入口与面板实现', () => {
  assert.match(agent, /data-action="automation"/);
  assert.match(agent, /function openAutomationPanel\(\)/);
  assert.match(agent, /'\/scheduled-tasks'/);
  assert.match(agent, /\/scheduled-tasks\/:id\/run|'\/' \+ encodeURIComponent\(id\) \+ '\/run'/);
});

test('定时任务不触碰 AI 写工具确认链与管理端鉴权', () => {
  // 确认链仍是 authenticateUser（不允许游客）
  assert.match(server, /app\.post\('\/api\/agent\/actions\/:id\/confirm',\s*authenticateUser/);
  assert.match(server, /app\.post\('\/api\/agent\/actions\/:id\/cancel',\s*authenticateUser/);
  // 定时任务路由没有误挂 authenticateUser（否则游客在窗口内不可用）
  assert.doesNotMatch(server, /app\.get\('\/api\/agent\/scheduled-tasks',\s*authenticateUser/);
});
