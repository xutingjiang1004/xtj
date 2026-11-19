'use strict';
// 游客无限免费契约测试（2026-11-19）
// 背景：线上 d18a801 把游客纳入"双主体配额记账"（guest cookie + IP），
// 每次发消息都查 Supabase RPC。当 Supabase egress 流量额度耗尽、数据库
// 被平台拒写时，游客与登录用户一起报 "quota_unavailable"，彻底无法使用。
// 而 15 天公开窗口（到 2026-11-28）的设计本意是"窗口内游客不限额度"。
// 修复：在三个 *ForContext 配额入口里，窗口内游客直接放行/跳过，不碰数据库。
// 本测试把该行为固化为不可回退契约。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');

function extractFn(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start > -1, '未找到函数：' + signature);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('函数体未配平：' + signature);
}

test('enforceAiChatAccessForContext：窗口内游客直接放行，不查配额 RPC', () => {
  const fn = extractFn(serverSrc, 'async function enforceAiChatAccessForContext(ctx, opts) {');
  assert.match(fn, /ctx && ctx\.isGuest && guestAiPublicWindowOpen\(\)/, '未用窗口+游客判定');
  assert.match(fn, /return \{ allowed: true, reason: null, quota: null \}/, '游客未直接放行');
});

test('getEffectiveQuotaForContext：窗口内游客返回无限额度载荷，不查库', () => {
  const fn = extractFn(serverSrc, 'async function getEffectiveQuotaForContext(ctx) {');
  assert.match(fn, /ctx && ctx\.isGuest && guestAiPublicWindowOpen\(\)/, '未用窗口+游客判定');
  assert.match(fn, /tokens_limit: -1/, 'token 未设为无限');
  assert.match(fn, /can_chat: true/, '未允许聊天');
  assert.match(fn, /can_search: true/, '未允许搜索');
});

test('recordAiTurnUsageForContext：窗口内游客跳过扣费写库', () => {
  const fn = extractFn(serverSrc, 'async function recordAiTurnUsageForContext(ctx, usage, opts) {');
  assert.match(fn, /ctx && ctx\.isGuest && guestAiPublicWindowOpen\(\)/, '未用窗口+游客判定');
  assert.match(fn, /return null;/, '游客未跳过扣费');
});

test('放行判断绑定公开窗口开关，到期后自动失效（非永久后门）', () => {
  // 三处都必须经过 guestAiPublicWindowOpen()，确保 11-28 到期或逃生口关闭后自动恢复配额
  const fn = extractFn(serverSrc, 'async function enforceAiChatAccessForContext(ctx, opts) {');
  const guestBypass = fn.match(/ctx && ctx\.isGuest && guestAiPublicWindowOpen\(\)/g) || [];
  assert.ok(guestBypass.length >= 1, '游客放行未绑定窗口开关');
  const winFn = extractFn(serverSrc, 'function guestAiPublicWindowOpen() {');
  assert.match(winFn, /Date\.now\(\) < GUEST_AI_OPEN_UNTIL/, '窗口开关未绑定截止时间');
});
