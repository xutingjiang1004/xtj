'use strict';
// 把网易云音乐 / QQ 音乐 / Apple Music 的分享链接解析成一张「歌曲卡片」（封面、歌名、歌手、平台）。
//
// 为什么是「链接」：这三个 App 的分享面板只会列出手机上装了的 App，网页没法出现在里面（iOS Safari 不支持 Web Share Target）。
// 所以做法和微信朋友圈一致：在 App 里点「复制链接」，粘贴进发帖框，发出去后帖子里自动变成歌曲卡片。
// 卡片是读帖子时按链接现解析的，不改数据库，帖子正文里仍然是原来的链接。
//
// 安全：只请求下面写死的几个主机（https），重定向逐跳手动检查主机，超时 4 秒，响应体最大 512KB；
// 任何失败都返回 null，由前端退回成一个普通的「歌曲链接」按钮。
const PLATFORMS = {
  apple: { name: 'Apple Music', hosts: /^(?:music|embed\.music|itunes)\.apple\.com$/i },
  netease: { name: '网易云音乐', hosts: /^(?:y\.)?music\.163\.com$|^163cn\.tv$/i },
  qq: { name: 'QQ音乐', hosts: /^(?:(?:i2?|c6?)\.)?y\.qq\.com$/i }
};
const TIMEOUT_MS = 4000, MAX_BYTES = 512 * 1024, MAX_HOPS = 3;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function platformOf(hostname) {
  const host = String(hostname || '').toLowerCase();
  for (const key of Object.keys(PLATFORMS)) if (PLATFORMS[key].hosts.test(host)) return key;
  return null;
}
function parseLink(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch (_) { return null; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  const platform = platformOf(url.hostname);
  if (!platform) return null;
  url.protocol = 'https:'; url.port = '';
  return { url, platform };
}
// 帖子正文里第一个支持的歌曲链接（前端也有同样的规则）。
function findMusicLink(text) {
  const re = /https?:\/\/[^\s<>"'，。！？、）)\]】]+/gi;
  let m;
  while ((m = re.exec(String(text || '')))) { const link = parseLink(m[0]); if (link) return m[0]; }
  return null;
}

async function readBody(res) {
  const declared = Number(res.headers && res.headers.get && res.headers.get('content-length'));
  if (declared > MAX_BYTES) throw new Error('too_large');
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('too_large');
  return text;
}
async function request(fetchImpl, url, options) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, Object.assign({ signal: controller.signal, redirect: 'manual', headers: { 'User-Agent': UA, 'Accept': 'application/json,text/html;q=0.8,*/*;q=0.5' } }, options));
  } finally { clearTimeout(timer); }
}
async function getJson(fetchImpl, url, options) {
  const res = await request(fetchImpl, url, options);
  if (!res.ok) throw new Error('upstream_' + res.status);
  return JSON.parse(await readBody(res));
}
// 短链接（163cn.tv、c6.y.qq.com/.../u?__=）：手动跟随重定向，每一跳都要还在允许的主机上。
async function followShortLink(fetchImpl, link) {
  let current = link;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const res = await request(fetchImpl, current.url.href, { method: 'GET' });
    if (res.body && res.body.cancel) { try { await res.body.cancel(); } catch (_) {} }
    const location = res.headers && res.headers.get && res.headers.get('location');
    if (!(res.status >= 300 && res.status < 400) || !location) return current;
    const next = parseLink(new URL(location, current.url).href);
    if (!next) return null;
    current = next;
    if (!/^163cn\.tv$|\/fcgi-bin\/u$/i.test(current.url.hostname + current.url.pathname)) return current;
  }
  return current;
}
const idIn = (text, name) => { const m = String(text || '').match(new RegExp('[?&#/]' + name + '=([A-Za-z0-9_-]+)')); return m ? m[1] : null; };

async function resolveApple(fetchImpl, link) {
  const u = link.url, parts = u.pathname.split('/').filter(Boolean);
  const country = /^[a-z]{2}$/i.test(parts[0] || '') ? parts[0].toLowerCase() : 'cn';
  const songId = idIn(u.search, 'i') || (parts[1] === 'song' ? parts[parts.length - 1] : null);
  const albumId = parts[1] === 'album' ? parts[parts.length - 1] : null;
  const id = /^\d+$/.test(songId || '') ? songId : /^\d+$/.test(albumId || '') ? albumId : null;
  if (!id) return null;
  const data = await getJson(fetchImpl, 'https://itunes.apple.com/lookup?id=' + id + '&country=' + country);
  const row = data && data.results && data.results[0];
  if (!row) return null;
  const art = String(row.artworkUrl100 || row.artworkUrl60 || '').replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/i, '/300x300bb.$2');
  const isSong = row.wrapperType === 'track';
  return { platform: 'apple', platformName: PLATFORMS.apple.name, type: isSong ? 'song' : 'album', title: isSong ? row.trackName : row.collectionName,
    artist: row.artistName || '', album: isSong ? row.collectionName || '' : '', cover: art, previewUrl: isSong && /^https:\/\//.test(row.previewUrl || '') ? row.previewUrl : '',
    url: String(isSong ? row.trackViewUrl : row.collectionViewUrl || link.url.href) };
}
async function resolveNetease(fetchImpl, link) {
  const u = link.url, where = u.pathname + u.hash;
  const id = idIn(u.search, 'id') || idIn(u.hash, 'id');
  if (!/^\d{3,}$/.test(id || '')) return null;
  const isAlbum = /\/album/i.test(where) && !/\/song/i.test(where);
  if (isAlbum) {
    const data = await getJson(fetchImpl, 'https://music.163.com/api/album/' + id, { headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' } });
    const album = data && data.album;
    if (!album) return null;
    return { platform: 'netease', platformName: PLATFORMS.netease.name, type: 'album', title: album.name, artist: (album.artist && album.artist.name) || '', album: '', cover: album.picUrl ? album.picUrl + '?param=300y300' : '', previewUrl: '', url: 'https://music.163.com/album?id=' + id };
  }
  if (/\/(playlist|program|djradio|mv|video)/i.test(where)) return null;
  const data = await getJson(fetchImpl, 'https://music.163.com/api/song/detail/?id=' + id + '&ids=%5B' + id + '%5D', { headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' } });
  const song = data && data.songs && data.songs[0];
  if (!song) return null;
  const album = song.album || song.al || {};
  const artists = song.artists || song.ar || [];
  const pic = album.picUrl || '';
  return { platform: 'netease', platformName: PLATFORMS.netease.name, type: 'song', title: song.name, artist: artists.map(a => a.name).filter(Boolean).join(' / '), album: album.name || '', cover: pic ? pic + '?param=300y300' : '', previewUrl: '', url: 'https://music.163.com/song?id=' + id };
}
async function resolveQq(fetchImpl, link) {
  const u = link.url;
  const mid = (u.pathname.match(/\/songDetail\/([A-Za-z0-9]+)/) || [])[1] || idIn(u.search, 'songmid') || idIn(u.hash, 'songmid');
  if (!/^[A-Za-z0-9]{8,20}$/.test(mid || '')) return null;
  const body = JSON.stringify({ comm: { ct: 24, cv: 0 }, songinfo: { method: 'get_song_detail_yqq', module: 'music.pf_song_detail_svr', param: { song_mid: mid } } });
  const data = await getJson(fetchImpl, 'https://u.y.qq.com/cgi-bin/musicu.fcg', { method: 'POST', body, headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Referer: 'https://y.qq.com/' } });
  const info = data && data.songinfo && data.songinfo.data && data.songinfo.data.track_info;
  if (!info) return null;
  const albumMid = info.album && info.album.mid;
  return { platform: 'qq', platformName: PLATFORMS.qq.name, type: 'song', title: info.name || info.title, artist: (info.singer || []).map(s => s.name).filter(Boolean).join(' / '), album: (info.album && info.album.name) || '',
    cover: albumMid ? 'https://y.qq.com/music/photo_new/T002R300x300M000' + albumMid + '.jpg' : '', previewUrl: '', url: 'https://y.qq.com/n/ryqq/songDetail/' + mid };
}

const cache = new Map(), CACHE_MAX = 500, HIT_MS = 12 * 3600 * 1000, MISS_MS = 2 * 60 * 1000;
function remember(key, value, ms) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { value, until: Date.now() + ms });
}
async function resolveMusicLink(raw, fetchImpl) {
  const first = parseLink(raw);
  if (!first) return null;
  const key = first.url.href;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  let card = null;
  try {
    let link = first;
    if (/^163cn\.tv$/i.test(link.url.hostname) || (link.platform === 'qq' && /\/fcgi-bin\/u$/i.test(link.url.pathname))) link = await followShortLink(fetchImpl, link);
    if (link) {
      if (link.platform === 'apple') card = await resolveApple(fetchImpl, link);
      else if (link.platform === 'netease') card = await resolveNetease(fetchImpl, link);
      else if (link.platform === 'qq') card = await resolveQq(fetchImpl, link);
    }
  } catch (_) { card = null; }
  if (card) { card.title = String(card.title || '').slice(0, 120); card.artist = String(card.artist || '').slice(0, 120); card.album = String(card.album || '').slice(0, 120); }
  if (card && !card.title) card = null;
  remember(key, card, card ? HIT_MS : MISS_MS);
  return card;
}
module.exports = { resolveMusicLink, findMusicLink, parseLink, platformOf, PLATFORMS, _cache: cache };
