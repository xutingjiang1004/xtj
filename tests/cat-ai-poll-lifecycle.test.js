const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const coreSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');
const bootstrapSource = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'core-parts', '01-bootstrap.js'), 'utf8');
const aiPartSource = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'core-parts', '03-profile-report-ai.js'), 'utf8');

// ---------------------------------------------------------------- S-1（bfcache）
test('S-1: bfcache 恢复路径清理陈旧小猫 AI 轮询状态', () => {
  // 恢复钩子必须存在，且在 pageshow(persisted) 分支被调用
  assert.match(bootstrapSource, /window\.__xtjResetCatAiPollStateForBfcache\s*=\s*function/);
  const pageshowIdx = bootstrapSource.indexOf("window.addEventListener('pageshow'");
  assert.notEqual(pageshowIdx, -1, 'pageshow 监听器必须存在');
  const pageshowBlock = bootstrapSource.slice(pageshowIdx, pageshowIdx + 600);
  assert.match(pageshowBlock, /e\.persisted/);
  assert.match(pageshowBlock, /__xtjResetCatAiPollStateForBfcache\(\)/,
    'bfcache 恢复时必须调用轮询状态重置');

  // 重置必须真正把四张表清空，否则死句柄仍会被 visibilitychange 复活
  const resetIdx = bootstrapSource.indexOf('window.__xtjResetCatAiPollStateForBfcache = function');
  const resetBlock = bootstrapSource.slice(resetIdx, resetIdx + 1400);
  for (const key of ['__catAiPollTimers', '__catAiPollControllers', '__catAiPollStatus', '__catAiCancelledByComment']) {
    assert.match(resetBlock, new RegExp(key + '\\s*=\\s*\\{\\}'), `bfcache 重置必须清空 ${key}`);
  }
  assert.match(resetBlock, /_catAiCancelled\s*=\s*\(window\._catAiCancelled \|\| 0\) \+ 1/,
    'bfcache 重置必须递增取消纪元，让在途回调失效');
});

test('S-1: 拼装产物 core.js 包含 bfcache 重置钩子', () => {
  assert.match(coreSource, /window\.__xtjResetCatAiPollStateForBfcache\s*=\s*function/);
  assert.match(coreSource, /__xtjResetCatAiPollStateForBfcache\(\)/);
});

// ---------------------------------------------------------------- S-2（重试按钮）
test('S-2: showCatAiStatus 的 3s 定时器不会摘掉重试按钮', () => {
  const start = aiPartSource.indexOf('function showCatAiStatus(');
  assert.notEqual(start, -1);
  const end = aiPartSource.indexOf('function removeCatAiStatus(', start);
  assert.notEqual(end, -1);
  const block = aiPartSource.slice(start, end);

  // 必须存在"容器内已有重试按钮"的判定函数
  assert.match(block, /_catAiHasRetryBtn\s*=\s*function/);
  assert.match(block, /\.cat-ai-retry-btn/);
  assert.match(block, /textContent\.indexOf\('重试'\)\s*!==\s*-1/);

  // 两处 3000ms 定时器回调都必须先判定再移除
  const timers = block.match(/setTimeout\(function\(\)\s*\{[\s\S]*?\},\s*3000\);/g) || [];
  assert.equal(timers.length, 2, 'showCatAiStatus 应有两处 3s 淡出定时器');
  for (const t of timers) {
    assert.match(t, /_catAiHasRetryBtn\(/, '每个 3s 定时器都必须做重试按钮二次判定');
  }

  // 旧写法（直接 removeChild，无判定）不得残留
  assert.doesNotMatch(block,
    /setTimeout\(function\(\)\s*\{\s*if \((existing|statusEl)\.parentNode\)\s*(existing|statusEl)\.parentNode\.removeChild\((existing|statusEl)\);\s*\},\s*3000\);/);
});

test('S-2: retryBtnSetup 注入的文案含"重试"，可被判定函数识别', () => {
  const start = aiPartSource.indexOf('function retryBtnSetup(');
  assert.notEqual(start, -1);
  // 函数体很短，取固定窗口即可（避免被字符串里的 window.__xtjRetryCatAi 干扰）
  const block = aiPartSource.slice(start, start + 500);
  assert.match(block, /cat-ai-retry-btn/);
  assert.match(block, /重试/);
});
