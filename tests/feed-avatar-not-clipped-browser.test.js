'use strict';
// The feed avatar is 42px but its role="button" shell (.avatar-wrap) is 40px, and the generic button rule gives
// [role="button"] overflow:hidden: the shell cut 2px off the right and bottom of the picture (about 5%, a notch at the
// lower right and a flattened corner). The first render of the page uses a different markup (no shell), so only a
// re-render with the avatar already cached shows it; this test renders that markup.
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('../scripts/maintenance/harness.js');

test('the feed avatar picture is not cut by its button shell: right and bottom edges are hit-testable and the shell does not clip', { timeout: 60000 }, async () => {
  const s = await h.open({ settleMs: 2400, viewport: { width: 390, height: 844 }, mobile: true, dsf: 3, extraRoutes: async (url, req, body) => {
    if (url.pathname === '/api/avatar/batch') { const av = {}; ((body && body.users) || []).forEach((u) => { av[u] = '/api/avatar/image/' + u + '?v=1'; }); return { status: 200, json: { ok: true, avatars: av } }; }
    if (url.pathname.startsWith('/api/avatar/image/')) return { status: 200, headers: { 'content-type': 'image/svg+xml' }, body: h.svgImg(3, 200, 200) };
    return null; } });
  try {
    const p = s.page;
    await p.waitForSelector('#feed .post-feed-item img.avatar-image', { timeout: 8000 });
    // Render again with the avatar cache warm: that is the markup with the role="button" shell.
    await p.evaluate(() => renderFeed({ posts: feedAllPosts, comments: feedAllComments, likes: feedAllLikes }));
    await p.waitForSelector('#feed .post-feed-item .avatar-wrap img.avatar-image');
    const r = await p.evaluate(() => {
      const wrap = document.querySelector('#feed .post-feed-item .avatar-wrap'), av = wrap.querySelector('.avatar'), img = av.querySelector('img');
      av.scrollIntoView({ block: 'center' });
      const a = av.getBoundingClientRect(), w = wrap.getBoundingClientRect();
      const at = (x, y) => { const e = document.elementFromPoint(x, y); return e === img || e === av; };
      return { wrapOverflow: getComputedStyle(wrap).overflow, avatar: [a.width, a.height], wrap: [w.width, w.height],
        bottomRight: at(a.right - 6, a.bottom - 6), rightMiddle: at(a.right - 1.5, a.top + a.height / 2), bottomMiddle: at(a.left + a.width / 2, a.bottom - 1.5) };
    });
    assert.notEqual(r.wrapOverflow, 'hidden', 'the shell does not clip its avatar: ' + r.wrapOverflow);
    assert.ok(r.avatar[0] > r.wrap[0], 'the avatar really is bigger than the shell here (' + r.avatar + ' vs ' + r.wrap + '), which is why the shell must not clip');
    assert.ok(r.rightMiddle && r.bottomMiddle && r.bottomRight, 'the right and bottom edges of the picture are on screen: ' + JSON.stringify(r));
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
