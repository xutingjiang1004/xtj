'use strict';
// 2026-11-11 帖子板块检查发现的问题的回归测试（真实页面 + 接口拦截）。
const test = require('node:test'), assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

async function open(t, options) {
  const f = await postBrowserFixture(Object.assign({ publicPosts: true, counts: [2, 1] }, options));
  t.after(() => f.close());
  f.page.setDefaultTimeout(8000);
  await f.page.waitForFunction(() => document.querySelectorAll('#feed .post').length >= 2);
  return f;
}
const lum = color => { const m = color.match(/[\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };

test('a long user name does not squeeze the visibility badge onto two lines', { timeout: 60000 }, async t => {
  const f = await open(t), p = f.page;
  f.posts.unshift({ id: '8c1cb02d-74d0-4e45-9e15-000000000777', user_name: '一个非常非常非常非常非常长的用户名字abcdefghijklmnopqrstuvwxyz', content: '长名字', visibility: 'public', created_at: new Date().toISOString(), views: 0 });
  await p.evaluate(() => window.loadFeed(true));
  const badge = p.locator('#feed .post[data-post-id$="777"] .post-visibility-badge');
  await badge.waitFor();
  const box = await badge.boundingBox(), short = await p.locator('#feed .post[data-post-id$="001"] .post-visibility-badge').boundingBox();
  assert.ok(Math.abs(box.height - short.height) < 2, 'badge keeps its single-line height: ' + box.height + ' vs ' + short.height);
  assert.ok(box.x + box.width <= 390, 'badge stays inside the card');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(f.errors, []);
});

test('dark mode: private/pinned badges and the post detail window stay readable', { timeout: 60000 }, async t => {
  const f = await open(t, { theme: 'dark' }), p = f.page;
  f.posts.unshift({ id: '8c1cb02d-74d0-4e45-9e15-000000000778', user_name: 'alice', content: '私密置顶', visibility: 'private', is_pinned: true, created_at: new Date().toISOString(), views: 0 });
  await p.evaluate(() => window.loadFeed(true));
  await p.locator('#feed .post[data-post-id$="778"] .post-pin-badge').waitFor();
  const badges = await p.evaluate(() => Array.from(document.querySelectorAll('#feed .post[data-post-id$="778"] .post-badge-stack > span')).map(el => { const c = getComputedStyle(el); return { color: c.color, background: c.backgroundColor }; }));
  assert.equal(badges.length, 2);
  for (const b of badges) assert.ok(lum(b.color) - lum(b.background) > 0.45, 'badge text contrasts with its background: ' + JSON.stringify(b));
  await p.evaluate(id => window.openPostDetail(id), f.posts[1].id);
  await p.locator('#postDetailBody .post-detail-main-card').waitFor();
  const detail = await p.evaluate(() => ['.post-detail-main-card', '.post-detail-panel--stack'].map(sel => { const el = document.querySelector('#postDetailBody ' + sel), c = getComputedStyle(el); return { sel, color: c.color, background: c.backgroundColor }; })
    .concat((() => { const el = document.querySelector('#postDetailBody .post-detail-content'), c = getComputedStyle(el); return { sel: 'content', color: c.color, background: getComputedStyle(el.closest('.post-detail-main-card')).backgroundColor }; })()));
  for (const d of detail) {
    assert.ok(lum(d.background) < 0.3, d.sel + ' has a dark surface: ' + d.background);
    assert.ok(lum(d.color) > 0.7, d.sel + ' has light text: ' + d.color);
  }
  assert.deepEqual(f.errors, []);
});

test('the post tools menu opens above its button near the bottom instead of covering it and the bottom navigation', { timeout: 60000 }, async t => {
  const f = await open(t), p = f.page;
  for (const y of [760, 300]) {
    await p.evaluate(y => { const s = document.getElementById('panelPosts'), b = document.querySelectorAll('#feed .post')[1].querySelector('.post-tools-trigger'); s.scrollTop += b.getBoundingClientRect().top - y; }, y);
    await p.waitForTimeout(350);
    await p.evaluate(() => document.querySelectorAll('#feed .post')[1].querySelector('.post-tools-trigger').click());
    await p.locator('.post-tools-menu:not(.is-closing)').waitFor();
    const r = await p.evaluate(() => { const m = document.querySelector('.post-tools-menu:not(.is-closing)').getBoundingClientRect(), b = document.querySelectorAll('#feed .post')[1].querySelector('.post-tools-trigger').getBoundingClientRect(); return { top: m.top, bottom: m.bottom, bTop: b.top, bBottom: b.bottom, vh: innerHeight }; });
    assert.ok(r.bottom <= r.bTop || r.top >= r.bBottom, 'menu does not cover its trigger: ' + JSON.stringify(r));
    assert.ok(r.top >= 8 && r.bottom <= r.vh - 60, 'menu stays clear of the screen edges and the bottom navigation: ' + JSON.stringify(r));
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('.post-tools-menu'));
  }
  assert.deepEqual(f.errors, []);
});

test('reporting a post lists and selects that post even when the content query returns nothing', { timeout: 60000 }, async t => {
  const f = await open(t), p = f.page, target = f.posts[1].id;
  await p.evaluate(() => document.querySelectorAll('#feed .post')[1].querySelector('.post-tools-trigger').click());
  await p.locator('.post-tools-menu [data-post-tool="report"]').waitFor();
  await p.evaluate(() => document.querySelector('.post-tools-menu [data-post-tool="report"]').click());
  await p.waitForFunction(id => { const item = document.querySelector('#reportContentList .report-content-item[data-id="' + id + '"]'); return item && item.classList.contains('selected'); }, target);
  assert.deepEqual(f.errors, []);
});

test('a temporary server failure keeps the opened post and does not claim it was deleted', { timeout: 60000 }, async t => {
  const f = await open(t), p = f.page, id = f.posts[0].id;
  let status = 503, body = { ok: false, error: '网站数据服务流量额度已用完，服务暂时受限，请等待恢复', code: 'egress_quota_exceeded' };
  await p.route('**/api/post/detail/' + id, route => route.fulfill({ status, json: body }));
  await p.evaluate(id => window.openPostDetail(id), id);
  await p.waitForFunction(() => /点赞和评论加载失败/.test(document.getElementById('postDetailBody').textContent));
  const text = await p.locator('#postDetailBody').textContent();
  assert.match(text, /2 张图片：正文和媒体排版/, 'the post that was already shown stays');
  assert.match(text, /流量额度已用完/);
  assert.doesNotMatch(text, /不存在、已删除/);
  await p.keyboard.press('Escape');
  status = 404; body = { ok: false, error: 'post_not_found', message: '该帖子不存在、已删除或不可查看。' };
  await p.evaluate(id => window.openPostDetail(id), id);
  await p.waitForFunction(() => /该帖子不存在、已删除或不可查看/.test(document.getElementById('postDetailBody').textContent));
  assert.deepEqual(f.errors, []);
});

test('plain web addresses in a post are clickable links and nothing else becomes markup', { timeout: 60000 }, async t => {
  const f = await open(t), p = f.page;
  f.posts.unshift({ id: '8c1cb02d-74d0-4e45-9e15-000000000779', user_name: 'alice', visibility: 'public', created_at: new Date().toISOString(), views: 0,
    content: '看这个 https://example.com/a?b=1&c=2。还有 http://test.example.org/x). <img src=x onerror=alert(1)> javascript:alert(1) https://user:pw@evil.example.com/ ftp://files.example.com\n第二行 https://例子.example.com/路径' });
  await p.evaluate(() => window.loadFeed(true));
  const content = p.locator('#feed .post[data-post-id$="779"] .content');
  await content.waitFor();
  const links = await content.locator('a').evaluateAll(list => list.map(a => ({ href: a.getAttribute('href'), text: a.textContent, target: a.target, rel: a.rel })));
  assert.deepEqual(links.map(l => l.href), ['https://example.com/a?b=1&c=2', 'http://test.example.org/x', 'https://例子.example.com/路径']);
  for (const l of links) { assert.equal(l.text, l.href); assert.equal(l.target, '_blank'); assert.match(l.rel, /noopener/); assert.match(l.rel, /noreferrer/); }
  assert.equal(await content.locator('img,script').count(), 0);
  const text = await content.textContent();
  assert.match(text, /<img src=x onerror=alert\(1\)> javascript:alert\(1\) https:\/\/user:pw@evil\.example\.com\/ ftp:\/\/files\.example\.com/);
  assert.equal(await content.locator('br').count(), 1);
  // 点链接不触发帖子上的其他点击行为，也不改变当前页面。
  const popup = p.waitForEvent('popup').catch(() => null);
  await content.locator('a').first().click();
  await popup;
  assert.equal(new URL(p.url()).origin, f.origin);
  assert.deepEqual(f.errors, []);
});
