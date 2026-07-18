'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const dataSource = fs.readFileSync(path.join(ROOT, 'js/photo-wall/data.js'), 'utf8');

function createPhotoDataRuntime(fetchImpl) {
  const storage = new Map();
  const windowListeners = {};
  const documentListeners = {};
  const window = {
    API_BASE: '',
    photoWallData: [],
    pwCurrentSortedPhotos: [],
    addEventListener(type, handler) { windowListeners[type] = handler; },
    getUserAuthHeaders: async () => ({ Authorization: 'Bearer test-token' })
  };
  const context = {
    window,
    document: {
      hidden: false,
      getElementById: () => null,
      addEventListener(type, handler) { documentListeners[type] = handler; },
      querySelector: () => null
    },
    localStorage: {
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    navigator: { onLine: true },
    fetch: fetchImpl,
    URL,
    Map,
    Set,
    console,
    setTimeout,
    clearTimeout,
    AbortController
  };
  vm.runInNewContext(dataSource, context, { filename: 'data.js' });
  return { window, storage, windowListeners, documentListeners };
}

test('public photo API loads even when window.sb is unavailable', async () => {
  let requested = '';
  const runtime = createPhotoDataRuntime(async url => {
    requested = String(url);
    return {
      ok: true,
      json: async () => ({ ok: true, data: [{ id: 'p1', user_name: 'u', media_url: 'https://example.test/p.jpg', created_at: '2026-01-01T00:00:00Z' }] })
    };
  });
  assert.equal(runtime.window.sb, undefined);
  const rows = await runtime.window.loadPhotoWallData(true);
  assert.match(requested, /^\/api\/photos\/public\?/);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'p1');
});

test('failed authenticated delete restores photo and removes local tombstone', async () => {
  const runtime = createPhotoDataRuntime(async (url, options) => {
    assert.equal(url, '/api/photo/delete');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return { ok: false, json: async () => ({ error: 'failed' }) };
  });
  const photo = { id: 'p2', cloudId: 'p2', username: 'owner', imageUrl: 'https://example.test/p2.jpg', timestamp: 1 };
  runtime.window.currentUser = 'owner';
  runtime.window.photoWallData = [photo];
  runtime.window.renderPhotoWallWithoutReload = () => {};
  const result = await runtime.window.deletePhotoWallPhoto(photo);
  assert.equal(result.ok, false);
  assert.equal(runtime.window.photoWallData.length, 1);
  assert.equal(runtime.window.photoWallData[0].id, 'p2');
  assert.deepEqual(JSON.parse(runtime.storage.get('xtj_photos_deleted') || '[]'), []);
});

test('delete tombstone rejects stale cloud snapshots during resume reconciliation', async () => {
  const staleRow = { id: 'p3', user_name: 'owner', media_url: 'https://example.test/p3.jpg', created_at: '2026-01-01T00:00:00Z' };
  const runtime = createPhotoDataRuntime(async url => {
    if (url === '/api/photo/delete') {
      return { ok: true, json: async () => ({ ok: true, deleted: true, cleanup_pending: true }) };
    }
    return { ok: true, json: async () => ({ ok: true, data: [staleRow] }) };
  });
  runtime.window.currentUser = 'owner';
  const photo = { id: 'p3', cloudId: 'p3', username: 'owner', imageUrl: staleRow.media_url, timestamp: 1 };
  runtime.window.photoWallData = [photo];
  runtime.window.renderPhotoWallWithoutReload = () => {};

  const result = await runtime.window.deletePhotoWallPhoto(photo);
  assert.equal(result.cleanup_pending, true);
  assert.equal(runtime.window.photoWallData.length, 0, 'stale delete response must not restore the photo');
  assert.deepEqual(JSON.parse(runtime.storage.get('xtj_photos') || '[]'), []);

  await runtime.windowListeners.online();
  assert.equal(runtime.window.photoWallData.length, 0, 'online reconciliation must retain the tombstone');
});

test('external delete removes cached entries by cloudId before reconciliation', async () => {
  const runtime = createPhotoDataRuntime(async () => ({ ok: true, json: async () => ({ ok: true, data: [] }) }));
  runtime.window.photoWallData = [{ id: 'local-copy', cloudId: 'cloud-p4', username: 'owner', imageUrl: 'https://example.test/p4.jpg' }];
  runtime.window.saveLocalPhotoWallData();
  runtime.windowListeners.storage({
    key: 'xtj_photo_sync_data',
    newValue: JSON.stringify({ type: 'photo_deleted', photoId: 'cloud-p4' })
  });
  assert.equal(runtime.window.photoWallData.length, 0);
  assert.deepEqual(JSON.parse(runtime.storage.get('xtj_photos') || '[]'), []);
});

test('photo production modules have source inputs and a single-settle image queue', () => {
  const build = fs.readFileSync(path.join(ROOT, 'scripts/build.js'), 'utf8');
  const pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  for (const name of ['data', 'render', 'photo-wall']) {
    assert.ok(fs.existsSync(path.join(ROOT, `js/photo-wall/${name}.js`)));
    assert.match(build, new RegExp(`js/photo-wall/${name}\\.js`));
    assert.match(pkg, new RegExp(`node --check js/photo-wall/${name}\\.js`));
  }
  const render = fs.readFileSync(path.join(ROOT, 'js/photo-wall/render.js'), 'utf8');
  assert.match(render, /if \(settled\) return;/);
  assert.match(render, /activeLoads = Math\.max\(0, activeLoads - 1\)/);
  assert.doesNotMatch(render, /if \(img\.complete[\s\S]{0,120}activeLoads -= 1/);
});

test('post and photo uploads clean storage records and preserve audio type', () => {
  const core = fs.readFileSync(path.join(ROOT, 'js/core.js'), 'utf8');
  const upload = fs.readFileSync(path.join(ROOT, 'js/photo-wall/upload-ui.js'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT, 'render-api/server.js'), 'utf8');
  assert.match(core, /file\.type\.startsWith\("audio\/"\) \? "audio"/);
  assert.match(core, /\[post-publish\] orphan cleanup failed/);
  assert.match(core, /<audio src=/);
  assert.match(upload, /if \(!createRes\.ok\)[\s\S]{0,500}await cleanupStorage\(path\)/);
  assert.match(upload, /MAX_PHOTO_UPLOAD_BYTES = 50 \* 1024 \* 1024/);
  const deleteIndex = server.indexOf('var hardDelete = await hardDeleteContent({');
  const storageIndex = server.indexOf("supabase.storage.from('uploads').remove", deleteIndex);
  assert.ok(deleteIndex >= 0 && storageIndex > deleteIndex, 'verified database delete must precede storage cleanup');
});

test('photo deletion converges after resume and reports durable cleanup state', () => {
  assert.match(dataSource, /window\.addEventListener\('online', reconcilePhotoWallAfterResume\)/);
  assert.match(dataSource, /window\.addEventListener\('pageshow', reconcilePhotoWallAfterResume\)/);
  assert.match(dataSource, /loadPhotoWallData\(true\)/);
  assert.match(dataSource, /deleteResult\.cleanup_pending/);
  assert.match(dataSource, /deleted\.indexOf\(identity\) >= 0/);
  assert.doesNotMatch(dataSource, /if \(window\.sb\) \{[\s\S]{0,120}loadPhotoWallData\(true\)/);
});

test('compact photo preview preserves 44px coarse-pointer controls', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  assert.match(css, /@media \(max-width: 375px\) and \(pointer: coarse\) \{[\s\S]*?#photoPreviewOverlay \.pp-preview-toolbar > button,[\s\S]*?min-width: 44px !important;[\s\S]*?min-height: 44px !important;/);
});
