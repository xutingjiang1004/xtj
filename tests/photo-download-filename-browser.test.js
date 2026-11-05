'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('../scripts/maintenance/harness.js');
const id = '11111111-1111-4111-8111-111111111111';
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
// 照片墙的图片地址是 /api/photo/<id>/media，末段没有扩展名；下载时文件名不能直接叫 "media"，
// 否则手机或电脑保存下来的是一个没有扩展名、打不开的文件。
test('downloading a wall photo saves a named image file with an image extension', { timeout: 90000 }, async () => {
  const s = await h.open({ settleMs: 1500, viewport: { width: 390, height: 844 }, extraRoutes: async (url) => {
    if (!/^\/api\/photo\/[0-9a-f-]{36}\/media$/.test(url.pathname)) return null;
    return { status: 200, headers: { 'content-type': 'image/jpeg', etag: '"x"' }, body: JPEG };
  } });
  try {
    const p = s.page;
    await p.evaluate((photoId) => {
      const u = location.origin + '/api/photo/' + photoId + '/media';
      window.__downloads = [];
      HTMLAnchorElement.prototype.click = function () { window.__downloads.push({ download: this.download, href: this.href }); };
      window.openPhotoPreview(0, { photos: [{ id: photoId, imageUrl: u, thumbUrl: window.xtjMediaPreviewUrl(u), user_name: 'alice', width: 800, height: 1000, created_at: new Date().toISOString() }] });
    }, id);
    await p.waitForFunction(() => document.getElementById('photoPreviewOverlay')?.classList.contains('active'));
    await p.evaluate(() => window.ppConfirmDownload());
    await p.waitForFunction(() => window.__downloads.length > 0, null, { timeout: 10000 });
    const saved = await p.evaluate(() => window.__downloads[0]);
    assert.match(saved.download, /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i, 'saved as "' + saved.download + '"');
  } finally { await s.close(); }
});
