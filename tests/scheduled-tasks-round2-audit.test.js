'use strict';
// 第二轮审计 定-5 / 定-6：定时任务面板与启动日志。
// 定-5：前端“自动化”面板 loadTasks() 吞掉 503 错误，任何失败都显示
//   “还没有定时任务”。修复：autoRenderList 增加 isError 分支，失败时
//   显示错误态 + 重试按钮（走现有 modal 委托点击处理）。
// 定-6：启动时不检查表是否存在，日志“调度器已启动”会误导人（表缺失时
//   调度器只会空转）。修复：启动后探查 ai_scheduled_tasks 表，表不可用
//   时打明确告警（含迁移文件名），表正常时才打“已启动”。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const agentSrc = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');

test('定-5: 任务列表加载失败显示错误态，不再冒充空列表', () => {
  const fnIdx = agentSrc.indexOf('function autoRenderList(box, tasks');
  assert.ok(fnIdx >= 0, '应有 autoRenderList');
  const fnBody = agentSrc.slice(fnIdx, fnIdx + 900);
  assert.ok(fnBody.includes('tasks, isError'), 'autoRenderList 应接受 isError 参数');
  assert.ok(fnBody.includes('定时任务列表加载失败'), '失败时应显示加载失败文案');
  assert.ok(fnBody.includes('data-auto-retry'), '失败态应有重试按钮');
  const loadIdx = agentSrc.indexOf('function loadTasks()');
  const loadBody = agentSrc.slice(loadIdx, loadIdx + 500);
  assert.ok(loadBody.includes('autoRenderList(listBox, [], true)'), '非 ok 响应与异常都应走错误态');
  assert.ok(agentSrc.includes("e.target.closest('[data-auto-retry]')"), '重试按钮应有点击处理');
});

test('定-6: 启动时探查任务表，缺表不打“已启动”', () => {
  const idx = serverSrc.indexOf("aiTaskScheduler.start();");
  assert.ok(idx >= 0, '应有调度器启动调用');
  const block = serverSrc.slice(idx, idx + 1200);
  assert.ok(block.includes("supabase.from('ai_scheduled_tasks').select('id').limit(1)"),
    '启动后应探查 ai_scheduled_tasks 表');
  assert.ok(block.includes('20261114000000_ai_scheduled_tasks.sql'),
    '表不可用时告警应指明迁移文件');
  assert.ok(block.includes("console.log('[SCHEDULER] 定时任务调度器已启动"),
    '表正常时才打“已启动”');
  assert.ok(!block.includes("aiTaskScheduler.start();\n    console.log('[SCHEDULER] 定时任务调度器已启动"),
    '不得再无条件紧跟启动打“已启动”');
});
