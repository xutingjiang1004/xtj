const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const upload = fs.readFileSync('js/photo-wall/upload-ui.js', 'utf8');
const photoCreate = fs.readFileSync('render-api/photo-create.js', 'utf8');

test('upload timeout does not delete Storage for uncertain status', () => {
  // 状态不确定时不得删除 Storage
  assert.match(upload, /状态不确定（processing \/ 其他），不得删除 Storage/);
  assert.match(upload, /savePendingPhotoUpload/);
  assert.ok(!/状态不确定[\s\S]*?强制清理 Storage/.test(upload));
});

test('upload status query failure does not delete Storage', () => {
  assert.match(upload, /状态查询失败，不得删除 Storage/);
});

test('upload only deletes Storage for explicit not_found or failed', () => {
  assert.match(upload, /status === 'not_found'/);
  assert.match(upload, /status === 'failed'/);
  assert.match(upload, /cleanupStorage\(path\)/);
});

test('savePendingPhotoUpload saves upload state', () => {
  assert.match(upload, /function savePendingPhotoUpload/);
  assert.match(upload, /xtj_photo_upload_pending/);
  assert.match(upload, /uploadId: info\.uploadId/);
});

test('backend photo/create checks if old record file exists before deleting new file', () => {
  assert.match(photoCreate, /createSignedUrl/);
  assert.match(photoCreate, /fileExists/);
  assert.match(photoCreate, /_repaired = true/);
  assert.match(photoCreate, /repaired: true/);
});

test('backend photo/create does not delete new file if old file is missing', () => {
  assert.match(photoCreate, /旧文件丢失，使用新文件路径更新记录/);
});