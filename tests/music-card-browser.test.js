'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('../scripts/maintenance/harness.js');
test('a pasted song link becomes a song card in the feed, the share caption stays, and an unresolvable link stays a plain link card', { timeout: 60000 }, async () => {
  const asked = [];
  const s = await h.open({ settleMs: 2200, viewport: { width: 390, height: 844 }, mobile: true, extraRoutes: async (url) => {
    if (url.pathname === '/api/feed') {
      const t = Date.now(), post = (id, content, ago) => ({ id, user_name: 'xxz', content, created_at: new Date(t - ago).toISOString(), visibility: 'public', views: 1 });
      return { status: 200, json: { ok: true, posts: [post('p-m1', '分享Dennis Kuo的单曲《Sweet Saturn》: http://163cn.tv/abc123 (来自@网易云音乐)', 60000), post('p-m2', '循环中 https://music.apple.com/cn/album/x/1440857781?i=1440857800', 120000), post('p-m3', '看 https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV', 180000), post('p-m4', '普通链接 https://example.com/a', 240000)], comments: [], likes: [], next_offset: 4, next_cursor: null, endReached: true, total_post_count: 4 } };
    }
    if (url.pathname === '/api/music/resolve') {
      const u = url.searchParams.get('url'); asked.push(u);
      if (/163cn/.test(u)) return { status: 200, json: { ok: true, card: { platform: 'netease', platformName: '网易云音乐', type: 'song', title: 'Sweet Saturn', artist: 'Dennis Kuo', cover: '', url: 'https://music.163.com/song?id=1', previewUrl: '' } } };
      if (/apple/.test(u)) return { status: 200, json: { ok: true, card: { platform: 'apple', platformName: 'Apple Music', type: 'song', title: 'Better Together', artist: 'Jack Johnson', cover: '', url: 'https://music.apple.com/cn/song/x/1', previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a' } } };
      return { status: 404, json: { ok: false, code: 'unsupported_link' } };
    }
    return null; } });
  try {
    const p = s.page;
    await p.waitForFunction(() => document.querySelectorAll('#feed .xtj-music-card.has-card').length >= 2, null, { timeout: 8000 });
    const cards = await p.evaluate(() => [...document.querySelectorAll('#feed .xtj-music-card')].map(c => ({ pending: c.classList.contains('is-pending'), title: c.querySelector('.xtj-music-title').textContent, sub: c.querySelector('.xtj-music-sub').textContent, href: c.getAttribute('href'), play: !!c.querySelector('.xtj-music-play') })));
    assert.equal(cards.length, 3, 'three music links, the plain link is not a card');
    assert.deepEqual(cards[0], { pending: false, title: 'Sweet Saturn', sub: 'Dennis Kuo · 网易云音乐', href: 'https://music.163.com/song?id=1', play: false });
    assert.equal(cards[1].play, true, 'a preview clip gives a play button');
    assert.equal(cards[2].pending, true); assert.equal(cards[2].title, '歌曲链接'); assert.equal(cards[2].sub, 'QQ音乐'); assert.equal(cards[2].href, 'https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV');
    const text = await p.evaluate(() => document.querySelector('#feed .post-feed-item .content').childNodes[0].textContent);
    assert.equal(text, '分享Dennis Kuo的单曲《Sweet Saturn》', 'the share caption stays, the raw link and the app signature are gone');
    assert.ok(!asked.some(u => /example\.com/.test(u)), 'only music links are sent to the resolver');
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
