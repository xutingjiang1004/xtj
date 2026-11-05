'use strict';
// 2026-11-05 第二轮审计：帖子页前端真实流程回归。
const test = require('node:test'), assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

async function publishText(f, text) {
  const before = f.calls.filter(c => c.path === '/api/post/create').length;
  await f.page.fill('#postInp', text);
  await f.page.locator('#pubBtn').click();
  await f.page.waitForFunction(() => { const b = document.getElementById('pubBtn'); return b && !b.disabled && b.getAttribute('aria-busy') !== 'true'; }, null, { timeout: 15000 });
  return f.calls.filter(c => c.path === '/api/post/create').slice(before).map(c => c.body.actor_key);
}

test('连续两次发布同样的文字：每次都是新的发布请求键，第二条不会被服务端当成重复而吞掉', { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ counts: [1] });
  try {
    const first = await publishText(f, '早安');
    const second = await publishText(f, '早安');
    assert.equal(first.length, 1); assert.equal(second.length, 1);
    assert.match(first[0], /^post_req_/); assert.match(second[0], /^post_req_/);
    assert.notEqual(first[0], second[0], 'a second identical post is a new post, not a retry of the first one');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('发布失败后重试同一草稿：沿用同一个发布请求键，丢了响应也不会发出两条', { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ counts: [1] });
  try {
    f.setFailCreate(true);
    const failed = await publishText(f, '重试内容');
    f.setFailCreate(false);
    const retry = await publishText(f, '重试内容');
    assert.equal(failed.length, 1); assert.equal(retry.length, 1);
    assert.equal(failed[0], retry[0], 'retrying the same draft must keep its idempotency key');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
