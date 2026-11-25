'use strict';
// 2026-11-25 用户要求：天气查询不要用内置 get_weather 工具，改为搜网页读最新天气数据。
// 本测试固化三处改动，防止"提示词说有天气工具 / 下发却没裁掉"的回归。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const server = fs.readFileSync('render-api/server.js', 'utf8');

test('W1: aiToolsForSearch 装配出口排除 get_weather（模型不可见）', () => {
  const fn = server.indexOf('function aiToolsForSearch(');
  assert.ok(fn > -1, '应存在 aiToolsForSearch 装配函数');
  const seg = server.slice(fn, fn + 1600);
  assert.match(seg, /name === 'get_weather'\) continue/, '装配循环里必须跳过 get_weather');
});

test('W2: 运行时验证 get_weather 不在下发清单，但 search_web / 其它工具仍在', () => {
  const fn = server.indexOf('function aiToolsForSearch(');
  const end = server.indexOf('function aiToolsForWorkMode(', fn);
  assert.ok(fn > -1 && end > fn);
  const code = server.slice(fn, end); // 含 aiToolsForSearch 与注释，止于下一个函数
  const mockTools = [
    { function: { name: 'get_weather' } },
    { function: { name: 'tavily_search' } },
    { function: { name: 'search_web' } },
    { function: { name: 'read_web_page' } },
    { function: { name: 'calculate' } }
  ];
  const ctx = {
    AI_TOOLS: mockTools,
    AI_WORKER_EXCLUDED_TOOLS: new Set([]),
    aiRequestFeatures: { tools: list => list }
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.__fn = aiToolsForSearch;', ctx);
  const names = ctx.__fn(true).map(t => t.function.name);
  assert.equal(names.includes('get_weather'), false, 'get_weather 必须从下发清单移除');
  assert.equal(names.includes('search_web'), true, 'search_web 必须保留');
  assert.equal(names.includes('read_web_page'), true, '读网页工具必须保留');
  assert.equal(names.includes('calculate'), true, '非联网工具不受影响');
  // 关闭 Tavily 开关时 tavily_search 被裁，但 get_weather 依旧不在
  const namesOff = ctx.__fn(false).map(t => t.function.name);
  assert.equal(namesOff.includes('get_weather'), false);
  assert.equal(namesOff.includes('tavily_search'), false);
});

test('W3: 提示词工具清单同步排除 get_weather（避免能力幻觉）', () => {
  const fn = server.indexOf('function buildCatAiToolSummary(');
  assert.ok(fn > -1);
  const seg = server.slice(fn, fn + 900);
  assert.match(seg, /nm === 'get_weather'\) continue/, '提示词清单生成处必须跳过 get_weather');
});

test('W4: 工具使用规范引导天气走网页搜索，不再引导内置天气工具', () => {
  const idx = server.indexOf('工具使用规范：');
  assert.ok(idx > -1, '应存在工具使用规范提示词');
  const seg = server.slice(idx, idx + 700);
  assert.match(seg, /天气.*网页搜索/, '必须引导天气用网页搜索');
  assert.match(seg, /read_web_page/, '必须引导读网页核对');
  assert.doesNotMatch(seg, /查天气时 location 只传规范城市名/, '旧的 get_weather 参数引导应移除');
});

test('W5: 底层天气模块与执行分支保留（不影响其它链路与既有能力）', () => {
  assert.match(server, /case 'get_weather': \{/, '执行分支应保留以兼容其它调用');
  assert.ok(fs.existsSync('render-api/weather.js'), 'weather.js 模块应保留');
});
