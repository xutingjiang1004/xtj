'use strict';
// A-M7 回归：「暂停」其实是取消，没有恢复。
// 修复前：S.paused 从未赋 true，暂停按钮直接调 interruptCurrentChat()，
//   中断后恢复靠「继续生成」；按钮却叫「暂停」，暗示能恢复。
// 修复后：按钮文案/语义改成「停止」（主聊天按钮、深入研究按钮、双模型对比
//   的中止按钮及相关提示），不另造假的暂停恢复功能；S.paused 不赋 true
//   的现状不变，内部变量名不动。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const featSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-core', 'assistant-features.js'), 'utf8');

test('A-M7: 主聊天暂停按钮改叫「停止」（文案 + aria-label），仍调取消', () => {
  assert.ok(aiSrc.includes("'aria-label': '停止'"), '暂停按钮 aria-label 应为「停止」');
  assert.ok(!aiSrc.includes("'aria-label': '暂停'"), '不应再有 aria-label「暂停」');
  assert.ok(aiSrc.includes("}, '停止');"), '暂停按钮可见文案应为「停止」');
  const clickIdx = aiSrc.indexOf("pauseBtn.addEventListener('click'");
  assert.ok(clickIdx >= 0, '应有暂停按钮点击绑定');
  const handler = aiSrc.slice(clickIdx, clickIdx + 200);
  assert.ok(handler.includes('interruptCurrentChat()'), '停止按钮仍直接调 interruptCurrentChat()（取消语义不变）');
  assert.ok(!/S\.paused = true/.test(aiSrc), '不应凭空造出 S.paused = true 的假暂停恢复');
});

test('A-M7: 所有暂停按钮的 textContent 复位都不再写「暂停」', () => {
  const leftovers = (aiSrc.match(/textContent = '暂停'/g) || []).length;
  assert.equal(leftovers, 0, 'pauseBtnEl/dtPauseBtn 的 textContent 复位应全部改成「停止」，残留 ' + leftovers + ' 处');
  const stops = (aiSrc.match(/textContent = '停止'/g) || []).length;
  assert.ok(stops >= 9, '应有 9 处暂停按钮文案复位改成「停止」，实得 ' + stops + ' 处');
});

test('A-M7: 深入研究页的暂停按钮（静态 HTML + JS）也改叫「停止」', () => {
  assert.ok(!html.includes('aria-label="暂停"'), 'index.html 里深入研究暂停按钮的 aria-label 应改成「停止」');
  assert.ok(html.includes('id="dtPauseBtn"'), '深入研究暂停按钮本身应还在');
  assert.ok(html.includes('aria-label="停止">停止</button>') || html.includes('aria-label="停止"'),
    '深入研究暂停按钮可见文案应为「停止」');
  assert.ok(aiSrc.includes('取消）SSE 请求'), '深入研究暂停按钮注释应写明它是取消而非暂停');
});

test('A-M7: 相关提示文案与双模型对比的中止按钮同步改成「停止」', () => {
  assert.ok(aiSrc.includes('请先停止当前回复'), '推荐问题/资料发送的拦截提示应说「停止」而非「暂停」');
  assert.ok(aiSrc.includes('当前回复完成或停止后'), '双模型对比的拦截提示应说「停止」而非「暂停」');
  assert.ok(featSrc.includes("stop=node('button','','停止')"), '双模型对比的中止按钮应叫「停止」');
  assert.ok(!featSrc.includes('已暂停'), '对比中断状态不应再写「已暂停」，应为「已停止」');
});
