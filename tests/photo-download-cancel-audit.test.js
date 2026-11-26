'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('../scripts/maintenance/harness.js');
const id = '11111111-1111-4111-8111-111111111111';
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

// G-H1：预览下载曾是 fetch 无取消、无超时、setInterval 把进度条假推到 85%，
// 慢网下卡死且无法重试。现在：取消按钮中止 fetch、60 秒无数据停滞超时、
// 进度按实际收到字节算（有 Content-Length 时），未收到字节时进度条不动。
function openPreview(p, photoId) {
  return p.evaluate((pid) => {
    const u = location.origin + '/api/photo/' + pid + '/media';
    window.__downloads = [];
    HTMLAnchorElement.prototype.click = function () { window.__downloads.push({ download: this.download, href: this.href }); };
    window.openPhotoPreview(0, { photos: [{ id: pid, imageUrl: u, thumbUrl: window.xtjMediaPreviewUrl(u), user_name: 'alice', width: 800, height: 1000, created_at: new Date().toISOString() }] });
  }, photoId);
}
const overlayShown = () => document.getElementById('ppDownloadOverlay')?.style.display === 'flex';
const barWidth = () => parseFloat((document.getElementById('ppDownloadProgressBar')?.style.width || '0%').replace('%', '')) || 0;

test('download progress stays at 0 while waiting for the first byte (no fake progress)', { timeout: 90000 }, async () => {
  const s = await h.open({ settleMs: 1500, viewport: { width: 390, height: 844 }, extraRoutes: async (url) => {
    if (!/^\/api\/photo\/[0-9a-f-]{36}\/media$/.test(url.pathname)) return null;
    await new Promise(r => setTimeout(r, 3000));
    return { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(JPEG.length), etag: '"x"' }, body: JPEG };
  } });
  try {
    const p = s.page;
    await openPreview(p, id);
    await p.waitForFunction(() => document.getElementById('photoPreviewOverlay')?.classList.contains('active'));
    await p.evaluate(() => window.ppConfirmDownload());
    await p.waitForFunction(overlayShown, null, { timeout: 10000 });
    await p.waitForTimeout(1200);
    // 旧实现 150ms 一跳、+2%，1.2 秒后已假推到约 25%；新实现未收到字节时不动。
    assert.equal(await p.evaluate(barWidth), 0, 'bar must not advance before any byte arrives');
    await p.waitForFunction(() => window.__downloads.length > 0, null, { timeout: 10000 });
    assert.match(await p.evaluate(() => window.__downloads[0].download), /\.(jpe?g|png|webp|gif|avif)$/i);
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

test('cancelling a download aborts the fetch, hides the overlay and allows a retry', { timeout: 90000 }, async () => {
  const s = await h.open({ settleMs: 1500, viewport: { width: 390, height: 844 }, extraRoutes: async (url) => {
    if (!/^\/api\/photo\/[0-9a-f-]{36}\/media$/.test(url.pathname)) return null;
    await new Promise(r => setTimeout(r, 8000));
    return { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(JPEG.length), etag: '"x"' }, body: JPEG };
  } });
  try {
    const p = s.page;
    await openPreview(p, id);
    await p.waitForFunction(() => document.getElementById('photoPreviewOverlay')?.classList.contains('active'));
    await p.evaluate(() => window.ppConfirmDownload());
    await p.waitForFunction(overlayShown, null, { timeout: 10000 });
    await p.waitForTimeout(500);
    // 遮罩上有取消按钮，点它（旧实现遮罩无取消、ppCancelDownload 只关确认弹窗）。
    assert.ok(await p.evaluate(() => !!document.querySelector('#ppDownloadOverlay .pp-download-cancel-btn')), 'overlay carries a cancel button');
    await p.evaluate(() => document.querySelector('#ppDownloadOverlay .pp-download-cancel-btn').click());
    await p.waitForFunction(() => document.getElementById('ppDownloadOverlay')?.style.display === 'none', null, { timeout: 10000 });
    await p.waitForTimeout(300);
    assert.equal(await p.evaluate(() => window.__downloads.length), 0, 'cancelled download must not save a file');
    // E 标志已复位：可以再次发起下载（遮罩重新出现），而不是点下载无反应。
    await p.evaluate(() => window.ppConfirmDownload());
    await p.waitForFunction(overlayShown, null, { timeout: 10000 });
    await p.evaluate(() => window.ppCancelDownload());
    await p.waitForFunction(() => document.getElementById('ppDownloadOverlay')?.style.display === 'none', null, { timeout: 10000 });
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});
