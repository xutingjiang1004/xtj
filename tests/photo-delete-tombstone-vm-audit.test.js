'use strict';
// G-M4 回归测试：删除墓碑只留最新 500 条，删图超过 500 后最旧墓碑丢失，
// 滞后快照里的已删照片会“复活”。修复后墓碑改存 [{id, at}]，按时间
// （30 天）+ 容量（2000 条）双重淘汰。
const test = require('node:test'), assert = require('node:assert/strict');
const { createPhotoDataRuntime } = require('./helpers/photo-data-runtime-fixture');

const DAY = 24 * 60 * 60 * 1000;

function readTombstones(runtime) {
  return JSON.parse(runtime.storage.get('xtj_photos_deleted') || '[]');
}

test('G-M4: 删 600 张后墓碑全保留，不再被 500 条上限截断', () => {
  const runtime = createPhotoDataRuntime(async () => ({ ok: true, json: async () => ({ ok: true, data: [] }) }));
  for (let i = 0; i < 600; i++) runtime.window.addDeletedPhotoId('gone-' + i);
  const ids = runtime.window.__xtjGetDeletedPhotoIds();
  assert.equal(ids.length, 600, '600 条墓碑应全保留');
  assert.equal(ids[0], 'gone-0', '最旧的墓碑也不应被丢弃');
  assert.equal(ids[599], 'gone-599');
  const stored = readTombstones(runtime);
  assert.equal(stored.length, 600);
  assert.ok(stored.every(e => typeof e.id === 'string' && Number.isFinite(e.at)), '存储为 [{id, at}]');
});

test('G-M4: 重复删除同一张不重复记墓碑', () => {
  const runtime = createPhotoDataRuntime(async () => ({ ok: true, json: async () => ({ ok: true, data: [] }) }));
  runtime.window.addDeletedPhotoId('dup');
  runtime.window.addDeletedPhotoId('dup');
  assert.deepEqual(Array.from(runtime.window.__xtjGetDeletedPhotoIds()), ['dup']);
  assert.equal(readTombstones(runtime).length, 1);
});

test('G-M4: 旧格式纯字符串墓碑迁移时保留，不批量过期', () => {
  const runtime = createPhotoDataRuntime(async () => ({ ok: true, json: async () => ({ ok: true, data: [] }) }));
  runtime.storage.set('xtj_photos_deleted', JSON.stringify(['legacy-1', 'legacy-2']));
  runtime.window.addDeletedPhotoId('fresh');
  const ids = Array.from(runtime.window.__xtjGetDeletedPhotoIds());
  assert.deepEqual(ids, ['legacy-1', 'legacy-2', 'fresh'], '旧墓碑应保留并带上新鲜时间戳');
  assert.ok(readTombstones(runtime).every(e => Number.isFinite(e.at)));
});

test('G-M4: 超过 30 天的墓碑在下次写入时淘汰，新鲜的保留', () => {
  const runtime = createPhotoDataRuntime(async () => ({ ok: true, json: async () => ({ ok: true, data: [] }) }));
  const now = Date.now();
  runtime.storage.set('xtj_photos_deleted', JSON.stringify([
    { id: 'old', at: now - 40 * DAY },
    { id: 'fresh', at: now - 1 * DAY },
  ]));
  runtime.window.addDeletedPhotoId('newest');
  assert.deepEqual(Array.from(runtime.window.__xtjGetDeletedPhotoIds()), ['fresh', 'newest'], '40 天前的墓碑应淘汰，1 天前的保留');
  assert.deepEqual(readTombstones(runtime).map(e => e.id), ['fresh', 'newest'], '淘汰应写回存储');
});

test('G-M4: 墓碑仍能挡住滞后快照里的已删照片', async () => {
  const staleRow = { id: 'gone', user_name: 'owner', media_url: 'https://example.test/gone.jpg', created_at: '2026-01-01T00:00:00Z' };
  const keptRow = { id: 'kept', user_name: 'owner', media_url: 'https://example.test/kept.jpg', created_at: '2026-01-02T00:00:00Z' };
  const runtime = createPhotoDataRuntime(async () => ({ ok: true, json: async () => ({ ok: true, data: [staleRow, keptRow] }) }));
  runtime.window.currentUser = 'owner';
  runtime.window.renderPhotoWallWithoutReload = () => {};
  runtime.window.addDeletedPhotoId('gone');
  await runtime.window.loadPhotoWallData(true);
  assert.deepEqual(Array.from(runtime.window.photoWallData.map(p => p.id)), ['kept'], '已删照片不应从滞后快照里复活');
});
