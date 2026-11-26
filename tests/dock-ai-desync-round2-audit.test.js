'use strict';
// 第二轮审计 点-1 回归：Dock 失同步 → 全屏 AI 面板盖住底部导航。
// 根因：非 Dock 入口（聊天页“问小猫” askAiAboutDmMessage、顶部 AI 工具等）
// 直接调 window.__xtjOpenAiChat() 打开面板时，currentDockTab 仍是旧值；
// 切到别的 tab 时 switchDockTab 只认 currentDockTab === 'ai-chat' 才收面板，
// 于是 z-index 9000 的全屏面板一直盖在 z-index 100 的 Dock 上面，全站看起来冻住。
// 修复：切 tab 时以面板实际状态 window.__xtjAiChatActive 为准，
// currentDockTab 是旧值时也要收面板。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const navSrc = fs.readFileSync(path.join(root, 'js', 'core-parts', '06-chat-and-nav.js'), 'utf8');
const agentSrc = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const agentCss = fs.readFileSync(path.join(root, 'css', 'ai-agent.css'), 'utf8');

test('点-1: 切 tab 收 AI 面板时必须同时认 __xtjAiChatActive，不能只认 currentDockTab', () => {
  const idx = navSrc.indexOf("离开小猫AI 到其它 tab");
  assert.ok(idx >= 0, '应有离开小猫 AI 的收面板分支');
  const branch = navSrc.slice(idx, idx + 1200);
  assert.ok(/if \(currentDockTab === 'ai-chat' \|\| window\.__xtjAiChatActive\)/.test(branch),
    '收面板条件必须包含 window.__xtjAiChatActive');
  assert.ok(branch.includes('__xtjHideAiChat'), '收面板分支必须调 __xtjHideAiChat');
});

test('点-1: 非 Dock 入口直接打开 AI 面板时不经过 switchDockTab（失同步的来源）', () => {
  // 聊天页“问小猫”直接调 __xtjOpenAiChat，不改 currentDockTab
  assert.ok(navSrc.includes('window.__xtjOpenAiChat();'),
    '应存在直接调 __xtjOpenAiChat 的非 Dock 入口');
  const askIdx = navSrc.indexOf('function askAiAboutDmMessage');
  assert.ok(askIdx >= 0, '应有 askAiAboutDmMessage');
  const askBody = navSrc.slice(askIdx, askIdx + 1500);
  assert.ok(askBody.includes('window.__xtjOpenAiChat()'), '问小猫入口应直接打开 AI 面板');
  assert.ok(!askBody.includes('switchDockTab'), '问小猫入口不走 switchDockTab，currentDockTab 保持旧值');
});

test('点-1: 全屏 AI 面板层级高于 Dock，收不掉就会盖住导航', () => {
  const panelZ = agentCss.match(/\.ai-secondary-panel[\s\S]{0,300}?z-index:\s*(\d+)/);
  assert.ok(panelZ, '应有 AI 二级面板层级');
  assert.ok(Number(panelZ[1]) > 1000, 'AI 面板应为全屏高层级（实际 ' + panelZ[1] + '）');
});

test('点-1: hideAiChatForTabSwitch 收起时必须清掉 __xtjAiChatActive', () => {
  const idx = agentSrc.indexOf('function hideAiChatForTabSwitch');
  assert.ok(idx >= 0, '应有 hideAiChatForTabSwitch');
  const body = agentSrc.slice(idx, idx + 4000);
  assert.ok(body.includes('window.__xtjAiChatActive = false'), '收起面板必须清掉 __xtjAiChatActive');
});
