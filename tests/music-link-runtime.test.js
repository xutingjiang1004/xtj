'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const music = require('../render-api/music-link');
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: new Map([['content-length', String(JSON.stringify(body).length)]]), text: async () => JSON.stringify(body) });
const redirect = (location) => ({ ok: false, status: 302, headers: { get: (k) => k.toLowerCase() === 'location' ? location : null }, body: null, text: async () => '' });
const fakeFetch = (routes, calls) => async (url, options) => {
  calls.push({ url: String(url), options });
  for (const [pattern, reply] of routes) if (pattern.test(String(url))) return typeof reply === 'function' ? reply(url, options) : reply;
  throw new Error('unexpected request ' + url);
};
test('only the music hosts are accepted, with no credentials or odd ports', () => {
  assert.equal(music.parseLink('https://music.apple.com/cn/album/x/1?i=2').platform, 'apple');
  assert.equal(music.parseLink('http://163cn.tv/abc123').platform, 'netease');
  assert.equal(music.parseLink('https://y.music.163.com/m/song?id=1901371647').platform, 'netease');
  assert.equal(music.parseLink('https://c6.y.qq.com/base/fcgi-bin/u?__=abc').platform, 'qq');
  for (const bad of ['https://evil.com/music.163.com', 'https://music.163.com.evil.com/song?id=1', 'https://user:pw@music.163.com/song?id=1', 'https://music.163.com:8443/song?id=1', 'ftp://music.163.com/', 'javascript:alert(1)', '', 'not a url']) assert.equal(music.parseLink(bad), null, bad);
});
test('the first music link is found inside a share text and trailing punctuation is left out', () => {
  assert.equal(music.findMusicLink('分享Dennis Kuo的单曲《Sweet Saturn》: http://163cn.tv/abc123 (来自@网易云音乐)'), 'http://163cn.tv/abc123');
  assert.equal(music.findMusicLink('看这个 https://example.com/a 和 https://music.apple.com/cn/song/x/123456，好听'), 'https://music.apple.com/cn/song/x/123456');
  assert.equal(music.findMusicLink('没有链接'), null);
});
test('Apple Music links resolve through the public lookup API', async () => {
  const calls = [];
  const card = await music.resolveMusicLink('https://music.apple.com/cn/album/in-between-dreams/1440857781?i=1440857800&l=en', fakeFetch([[/itunes\.apple\.com\/lookup/, json({ results: [{ wrapperType: 'track', trackName: 'Better Together', artistName: 'Jack Johnson', collectionName: 'In Between Dreams', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg', previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a', trackViewUrl: 'https://music.apple.com/cn/album/x/1?i=2' }] })]], calls));
  assert.equal(calls[0].url, 'https://itunes.apple.com/lookup?id=1440857800&country=cn');
  assert.deepEqual([card.platform, card.type, card.title, card.artist], ['apple', 'song', 'Better Together', 'Jack Johnson']);
  assert.match(card.cover, /300x300bb\.jpg$/); assert.match(card.previewUrl, /^https:\/\//);
});
test('NetEase short links are followed by hand and then resolved through the song detail endpoint', async () => {
  music._cache.clear();
  const calls = [];
  const card = await music.resolveMusicLink('http://163cn.tv/abc123', fakeFetch([
    [/163cn\.tv\/abc123/, redirect('http://music.163.com/song?id=1901371647&uct2=xyz')],
    [/music\.163\.com\/api\/song\/detail/, json({ songs: [{ name: '孤勇者', artists: [{ name: '陈奕迅' }], album: { name: '孤勇者', picUrl: 'https://p1.music.126.net/x.jpg' } }] })]
  ], calls));
  assert.equal(calls[0].options.redirect, 'manual', 'redirects are never followed automatically');
  assert.ok(calls.some(c => /song\/detail\/\?id=1901371647&ids=%5B1901371647%5D/.test(c.url)));
  assert.deepEqual([card.platform, card.title, card.artist, card.cover, card.url], ['netease', '孤勇者', '陈奕迅', 'https://p1.music.126.net/x.jpg?param=300y300', 'https://music.163.com/song?id=1901371647']);
});
test('QQ Music links resolve through the song detail module', async () => {
  music._cache.clear();
  const calls = [];
  const card = await music.resolveMusicLink('https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV', fakeFetch([[/u\.y\.qq\.com\/cgi-bin\/musicu\.fcg/, json({ songinfo: { data: { track_info: { name: '晴天', singer: [{ name: '周杰伦' }], album: { name: '叶惠美', mid: '000MkMni19ClKG' } } } } })]], calls));
  assert.equal(JSON.parse(calls[0].options.body).songinfo.param.song_mid, '0039MnYb0qxYhV');
  assert.deepEqual([card.platform, card.title, card.artist], ['qq', '晴天', '周杰伦']);
  assert.match(card.cover, /T002R300x300M000000MkMni19ClKG\.jpg$/);
});
test('a redirect to a host outside the list, an upstream failure and a missing song all give nothing, and failures are remembered briefly', async () => {
  music._cache.clear();
  const calls = [];
  assert.equal(await music.resolveMusicLink('http://163cn.tv/evil', fakeFetch([[/163cn\.tv\/evil/, redirect('https://evil.example/steal')]], calls)), null);
  assert.equal(calls.length, 1, 'nothing was requested from the foreign host');
  const failing = [];
  assert.equal(await music.resolveMusicLink('https://music.163.com/song?id=123456', fakeFetch([[/music\.163\.com\/api/, json({}, 500)]], failing)), null);
  assert.equal(await music.resolveMusicLink('https://music.163.com/song?id=123456', fakeFetch([], failing)), null, 'served from the short failure cache');
  assert.equal(failing.length, 1);
  assert.equal(await music.resolveMusicLink('https://music.apple.com/cn/playlist/x/pl.abc', fakeFetch([], [])), null, 'unsupported kinds make no request');
});
test('the resolve route is public, rate limited and only talks to the music module', () => {
  const fs = require('node:fs'), server = fs.readFileSync('render-api/server.js', 'utf8');
  const at = server.indexOf("app.get('/api/music/resolve'");
  assert.ok(at > 0); const route = server.slice(at, at + 700);
  assert.match(route, /rateLimit\(60000, 60\)/); assert.match(route, /resolveMusicLink\(musicUrl, fetch\)/); assert.match(route, /unsupported_link/);
});
