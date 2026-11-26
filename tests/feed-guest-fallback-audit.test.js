'use strict';
// E-H1 回归：帖子回退绕过访客 10 条限制 + select *。
// 修复前：/api/feed 失败后回退 Supabase 直连，访客可无限翻页
// （绕过服务端 GUEST_FEED_LIMIT=10），且 getFeedBasePostQuery
// 用 select("*") 把 actor_key、IP 属地等整行拉到浏览器。
// 修复后：回退路径对访客同样只给最新 10 条（start>=10 直接空页
// 并置 feedGuestLimited，显示“登录后可查看更早的帖子”）；
// 回退查询改用显式字段白名单，不含 actor_key。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'core-parts', '04-posts-interactions.js'), 'utf8');

function baseQueryFn() {
  const idx = src.indexOf('function getFeedBasePostQuery()');
  assert.ok(idx >= 0, '应有 getFeedBasePostQuery');
  return src.slice(idx, idx + 600);
}

test('E-H1: 回退查询不用 select *，用显式字段且不含 actor_key', () => {
  const fn = baseQueryFn();
  assert.ok(!fn.includes('select("*")'), 'getFeedBasePostQuery 不应再用 select("*")');
  assert.ok(fn.includes('FEED_FALLBACK_SELECT'), '应使用显式字段常量');
  const constIdx = src.indexOf('FEED_FALLBACK_SELECT');
  assert.ok(constIdx >= 0, '应定义 FEED_FALLBACK_SELECT');
  const constBody = src.slice(constIdx, constIdx + 800);
  assert.ok(!constBody.includes('actor_key'), '回退字段白名单不应含 actor_key');
  for (const f of ['id', 'user_name', 'content', 'created_at', 'visibility', 'media_type']) {
    assert.ok(constBody.includes(f), '白名单应含 ' + f);
  }
});

function fallbackBlock() {
  const marker = src.indexOf('// 回退：Supabase 直连');
  assert.ok(marker >= 0, '应有回退分支注释');
  const fbIdx = src.lastIndexOf('if (!usedApi) {', marker);
  assert.ok(fbIdx >= 0, '应有回退分支');
  return src.slice(fbIdx, fbIdx + 4500);
}

test('E-H1: 回退路径对访客执行与 /api/feed 相同的 10 条限制', () => {
  const block = fallbackBlock();
  assert.ok(block.includes('feedGuestLimited = true') || block.includes('feedGuestLimited=true'), '访客回退应置 feedGuestLimited');
  assert.ok(/start\s*>=\s*(fallbackGuestLimit|GUEST_FEED_LIMIT|10)/.test(block), '访客 start>=10 时应不再拉取');
  assert.ok(/endReached = (true|posts\.length < FEED_PAGE_SIZE)/.test(block), '访客到限时应结束分页（空页即 endReached）');
});

test('E-H1: 访客回退的 range/limit 也按剩余名额截断', () => {
  const block = fallbackBlock();
  assert.ok(/Math\.min\(end|Math\.min\(FEED_PAGE_SIZE/.test(block), '访客回退应截断 range 或 limit');
});
