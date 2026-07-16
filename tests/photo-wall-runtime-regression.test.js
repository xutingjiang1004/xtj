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
  const window = {
    API_BASE: '',
    photoWallData: [],
    pwCurrentSortedPhotos: [],
    addEventListener() {},
    getUserAuthHeaders: async () => ({ Authorization: 'Bearer test-token' })
  };
  const context = {
    window,
    document: { getElementById: () => null, addEventListener() {}, querySelector: () => null },
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
    clearTimeout
  };
  vm.runInNewContext(dataSource, context, { filename: 'data.js' });
  return { window, storage };
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
  const rpcIndex = server.indexOf("supabase.rpc('delete_post_with_actor'");
  const storageIndex = server.indexOf("supabase.storage.from('uploads').remove", rpcIndex);
  assert.ok(rpcIndex >= 0 && storageIndex > rpcIndex, 'database delete must precede storage cleanup');
});
