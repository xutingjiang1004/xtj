/**
 * 首帧延迟契约测试（Request 5）
 *
 * 背景：用户反馈「从发消息到他开始思考，这个过程有点慢」。
 * 根因：/api/agent/chat/stream 原先在 `await enforceAiChatAccess()`（内含 2~3 次
 * Supabase 往返）**之后**才 flush SSE 并发 meta，导致前端在额度校验期间收不到
 * 任何事件；叠加 heartbeat 的 8s 静默窗口，主观感受就是"干等"。
 *
 * 本测试锁定三项修复，防止回归：
 *   1. meta / early reasoning_start 必须早于 enforceAiChatAccess 下发
 *   2. enforceAiChatAccess 内部两项独立校验必须并行（Promise.all）
 *   3. 内置主链路的心跳静默窗口必须收紧（研究/第三方链路保持 8s 不动）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const serverPath = path.join(__dirname, '..', 'render-api', 'server.js');
const source = fs.readFileSync(serverPath, 'utf8');

/** 截取内置主聊天路由的主体（从路由定义到下一个路由定义） */
function chatRouteSource() {
  const start = source.indexOf("app.post('/api/agent/chat/stream'");
  assert.ok(start >= 0, '未找到 /api/agent/chat/stream 路由');
  // 从**当前路由定义之后**开始找下一个路由，避免匹配到自身
  const rest = source.slice(start + "app.post('/api/agent/chat/stream'".length);
  const nextRoute = rest.search(/\napp\.(get|post|put|delete)\(/);
  return nextRoute >= 0 ? rest.slice(0, nextRoute) : rest;
}

/**
 * 去掉行注释后再匹配 —— 本路由内新增的说明性注释里也出现了
 * `await enforceAiChatAccess()` 等字样，直接 indexOf 会命中注释造成误判。
 */
function stripLineComments(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
}

/** 在“去掉行注释”的路由源码里定位真实代码 */
function chatRouteCode() {
  return stripLineComments(chatRouteSource());
}

test('首帧延迟：meta 事件早于额度校验下发', () => {
  const route = chatRouteCode();
  const metaIdx = route.indexOf("writeSse(res, { type: 'meta'");
  const gateIdx = route.indexOf('var rl = await enforceAiChatAccess(');
  assert.ok(metaIdx >= 0, '未找到 meta 事件下发');
  assert.ok(gateIdx >= 0, '未找到 enforceAiChatAccess 调用');
  assert.ok(
    metaIdx < gateIdx,
    'meta 必须早于 enforceAiChatAccess —— 否则额度校验的 2~3 次 Supabase 往返期间前端完全静默'
  );
});

test('首帧延迟：early reasoning_start 早于额度校验下发', () => {
  const route = chatRouteCode();
  const earlyIdx = route.indexOf('early: true');
  const gateIdx = route.indexOf('var rl = await enforceAiChatAccess(');
  assert.ok(earlyIdx >= 0, '未找到 early reasoning_start 事件');
  assert.ok(earlyIdx < gateIdx, 'early reasoning_start 必须早于额度校验，让前端立刻稳固「思考中」态');
});

test('首帧延迟：SSE 头在校验前已 flush（含禁用代理缓冲）', () => {
  const route = chatRouteCode();
  const gateIdx = route.indexOf('var rl = await enforceAiChatAccess(');
  const headerBlock = route.slice(0, gateIdx);
  assert.match(headerBlock, /X-Accel-Buffering['"]\s*,\s*['"]no/);
  assert.match(headerBlock, /flushHeaders\(\)/);
});

test('首帧延迟：convId 生成前置且纯字符串运算（无 IO）', () => {
  const route = chatRouteCode();
  const gateIdx = route.indexOf('var rl = await enforceAiChatAccess(');
  const convIdx = route.indexOf('convId = genConvId()');
  assert.ok(convIdx >= 0, '未找到 genConvId 调用');
  assert.ok(convIdx < gateIdx, 'convId 生成必须前置到校验之前，才能保证 meta 先发');
});

test('首帧延迟：额度校验失败仍走 terminateWithError（补发终结 done）', () => {
  const route = chatRouteCode();
  // 校验失败分支不再自行 flushHeaders（已提前 flush），但必须仍走统一错误出口
  assert.match(route, /if \(!rl\.allowed\)\s*\{\s*return terminateWithError\(/);
});

test('首帧延迟：重复请求 409 分支同样走 terminateWithError', () => {
  const route = chatRouteCode();
  assert.match(route, /code:\s*'duplicate_request'/);
  const dupIdx = route.indexOf("'duplicate_request'");
  const before = route.slice(Math.max(0, dupIdx - 400), dupIdx);
  assert.match(before, /return terminateWithError\(/);
});

test('首帧延迟：enforceAiChatAccess 内部两项独立校验并行执行', () => {
  const start = source.indexOf('async function enforceAiChatAccess(');
  assert.ok(start >= 0, '未找到 enforceAiChatAccess 定义');
  const body = source.slice(start, start + 2600);
  assert.match(body, /await Promise\.all\(\[/, '额度与频次校验必须并行，否则总耗时是两者相加');
  assert.match(body, /aiQuota\.checkBeforeChat\(/);
  assert.match(body, /checkAiUserRateLimit\(/);
  // 两个分支都必须有 catch 兜底，避免单点异常导致整体 500
  assert.match(body, /checkBeforeChat\([\s\S]{0,220}?\.catch\(/);
  assert.match(body, /checkAiUserRateLimit\([\s\S]{0,220}?\.catch\(/);
});

test('首帧延迟：判定顺序保持「先额度、后频次」（错误文案不变）', () => {
  const start = source.indexOf('async function enforceAiChatAccess(');
  const body = source.slice(start, start + 2600);
  const quotaIdx = body.indexOf('if (!tokenGate.allowed)');
  const rateIdx = body.indexOf('if (!rl.allowed)');
  assert.ok(quotaIdx >= 0 && rateIdx >= 0, '未找到两条判定分支');
  assert.ok(quotaIdx < rateIdx, '必须先判额度后判频次，保持既有错误文案');
});

test('首帧延迟：内置主链路心跳静默窗口收紧到 2.5s', () => {
  const route = chatRouteCode();
  assert.match(route, /lastWrite >= 2500/);
  assert.match(route, /\},\s*1500\);/);
  assert.ok(!/lastWrite >= 8000/.test(route), '内置链路不应再保留 8s 静默窗口');
});

const RESEARCH_ROUTE = "app.post('/api/agent/research/stream'";
const CUSTOM_ROUTE = "app.post('/api/agent/custom-chat/stream'";

/** 按路由定义字符串截取路由主体 */
function routeBody(routeDef) {
  const start = source.indexOf(routeDef);
  assert.ok(start >= 0, `未找到路由 ${routeDef}`);
  const rest = source.slice(start + routeDef.length);
  const nextRoute = rest.search(/\napp\.(get|post|put|delete)\(/);
  return nextRoute >= 0 ? rest.slice(0, nextRoute) : rest;
}

test('首帧延迟：研究流链路心跳保持 8s（未被本次改动波及）', () => {
  const route = routeBody(RESEARCH_ROUTE);
  assert.match(route, />= 8000/, '研究流链路是独立设计，阈值不应被连带修改');
});

test('首帧延迟：第三方自定义链路心跳保持 8s（未被本次改动波及）', () => {
  const route = routeBody(CUSTOM_ROUTE);
  assert.match(route, />= 8000/, '第三方链路是独立设计，阈值不应被连带修改');
});
