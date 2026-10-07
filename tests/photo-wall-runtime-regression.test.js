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
    currentUser: 'owner',
    photoWallData: [],
    pwCurrentSortedPhotos: [],
    addEventListener(type, handler) { windowListeners[type] = handler; },
    getUserAuthHeaders: async () => ({ Authorization: 'Bearer test-token' }),
    safeStorage: {
      get: key => storage.has(key) ? storage.get(key) : null,
      set: (key, value) => storage.set(key, String(value)),
      remove: key => storage.delete(key)
    }
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
    AbortController,
    Date
  };
  vm.runInNewContext(dataSource, context, { filename: 'data.js' });
  return { window, storage, windowListeners, documentListeners, context };
}

test('authenticated photo API loads even when window.sb is unavailable', async () => {
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

test('anonymous wall reads clear stale originals without requesting data', async () => {
  let calls = 0;
  const f = createPhotoDataRuntime(async () => { calls++; throw Error('unexpected'); });
  f.window.currentUser = '';
  f.window.photoWallData = [{id:'secret',imageUrl:'https://example.test/private.jpg'}];
  f.storage.set('xtj_photos', JSON.stringify(f.window.photoWallData));
  f.storage.set('xtj_photos_owner', JSON.stringify('owner'));
  assert.equal((await f.window.loadPhotoWallData(true)).length,0);
  assert.equal(f.window.photoWallData.length,0);assert.equal(calls,0);assert.equal(f.storage.has('xtj_photos'),false);
});

test('a delayed wall response cannot refill photos after logout or identity change', async () => {
  let release;
  const f = createPhotoDataRuntime(() => new Promise(resolve => { release=resolve; }));
  const load = f.window.loadPhotoWallData(true);
  await new Promise(resolve => setImmediate(resolve));
  f.window.currentUser = '';
  f.window.__xtjResetPhotoWallAccess();
  release({ok:true,json:async()=>({ok:true,data:[{id:'secret',media_url:'https://example.test/private.jpg'}]})});
  await load;assert.equal(f.window.photoWallData.length,0);assert.equal(f.storage.has('xtj_photos'),false);
});

test('normal wall navigation loads the new account after logout without requiring force refresh', async () => {
  let calls = 0;
  const f = createPhotoDataRuntime(async () => ({ok:true,json:async()=>({ok:true,data:[{id:'photo-'+(++calls),user_name:f.window.currentUser,media_url:'https://example.test/photo.jpg'}]})}));
  const grid = {innerHTML:'',get children(){return this.innerHTML ? [1] : [];}};
  f.context.document.getElementById = id => id === 'photoGrid' ? grid : null;
  f.window.requestAnimationFrame = callback => callback();
  f.window.renderPhotoWallWithoutReload = () => {grid.innerHTML=f.window.photoWallData.length?'photo':'empty-state';};
  f.window.renderPhotoWall = async () => {await f.window.loadPhotoWallData();f.window.renderPhotoWallWithoutReload();};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'js/photo-wall/photo-wall.js'),'utf8'),f.context);
  await f.window.initPhotoWall();assert.equal(calls,1);
  f.window.currentUser='';f.window.__xtjResetPhotoWallAccess();
  f.window.currentUser='new-owner';f.windowListeners['auth-ready']();
  await f.window.initPhotoWall();
  assert.equal(calls,2);assert.equal(f.window.photoWallData[0].username,'new-owner');assert.equal(grid.innerHTML,'photo');
});

test('same-account token refresh after guest login keeps the loaded wall and preview', async () => {
  const f = createPhotoDataRuntime(async()=>({ok:true,json:async()=>({ok:true,data:[{id:'photo',user_name:'new-owner',media_url:'https://example.test/photo.jpg'}]})}));
  f.window.currentUser='';f.windowListeners['auth-ready']();
  // Login commits the token before currentUser, so this first event is a guest.
  f.windowListeners['auth-ready']();f.window.currentUser='new-owner';
  await f.window.loadPhotoWallData();
  let closed=0;f.window.forceClosePhotoPreview=()=>closed++;
  f.windowListeners['auth-ready']();
  assert.equal(f.window.photoWallData.length,1);assert.equal(closed,0);
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

test('a delayed delete blocks stale force-refresh snapshots until the server confirms', async () => {
  let resolveDelete;
  const staleRow = { id: 'p-pending', user_name: 'owner', media_url: 'https://example.test/pending.jpg', created_at: '2026-01-01T00:00:00Z' };
  const runtime = createPhotoDataRuntime((url) => {
    if (url === '/api/photo/delete') {
      return new Promise(resolve => { resolveDelete = () => resolve({ ok: true, json: async () => ({ ok: true, deleted: true }) }); });
    }
    return Promise.resolve({ ok: true, json: async () => ({ ok: true, data: [staleRow] }) });
  });
  const photo = { id: 'p-pending', cloudId: 'p-pending', username: 'owner', imageUrl: staleRow.media_url, timestamp: 1 };
  runtime.window.currentUser = 'owner';
  runtime.window.photoWallData = [photo];
  runtime.window.renderPhotoWallWithoutReload = () => {};

  const deletion = runtime.window.deletePhotoWallPhoto(photo);
  await Promise.resolve();
  await runtime.window.loadPhotoWallData(true);
  assert.equal(runtime.window.photoWallData.length, 0, 'stale cloud data must not reinsert a pending deletion');

  resolveDelete();
  await deletion;
  assert.equal(runtime.window.pendingDeletedPhotoIds.size, 0, 'pending deletion must clear after success');
  assert.deepEqual(JSON.parse(runtime.storage.get('xtj_photos_deleted') || '[]'), ['p-pending']);
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
  // Type selection now runs for every file in the bounded upload worker.
  assert.match(core, /media_type: selectedFile\.type\.split\('\/'\)\[0\]/);
  assert.equal(require('../js/post-media').validateSelection([{type:'audio/mpeg',name:'recording.mp3',size:100}])[0].type, 'audio/mpeg');
  assert.match(core, /\[post-publish\] orphan cleanup failed/);
  assert.match(core, /<audio src=/);
  assert.match(upload, /if \(!createRes\.ok\)[\s\S]{0,700}await cleanupStorage\(path(?:, uploadId, cleanupAfterCreateOptions)?\)/);
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

test('realtime channel recovers properly after pagehide and visibility changes', async () => {
  let fetchedCount = 0;
  const runtime = createPhotoDataRuntime(async () => {
    fetchedCount++;
    return { ok: true, json: async () => ({ ok: true, data: [] }) };
  });

  let unsubscribedCount = 0;
  let subscribedCount = 0;
  let mockChannel = null;

  runtime.window.sb = {
    channel: (name) => {
      subscribedCount++;
      const ch = {
        name,
        state: 'SUBSCRIBED',
        handlers: {},
        on: function(event, options, callback) {
          if (event === 'postgres_changes') {
            this.handlers.postgres_changes = callback;
          }
          return this;
        },
        subscribe: function(cb) {
          if (cb) cb('SUBSCRIBED');
          return this;
        },
        unsubscribe: () => { unsubscribedCount++; }
      };
      mockChannel = ch;
      return ch;
    }
  };

  assert.equal(subscribedCount, 0, '初始只创建一个 Realtime channel(此时还未加载)');

  // 1. 初次加载触发订阅
  await runtime.window.loadPhotoWallData(true);
  assert.equal(subscribedCount, 1);
  assert.ok(mockChannel);
  
  // 2. pagehide 调用 unsubscribe 并清空
  runtime.windowListeners.pagehide();
  assert.equal(unsubscribedCount, 1, 'pagehide 后调用 unsubscribe');
  
  // 3. pageshow 重新创建 channel 和对账
  let preFetch = fetchedCount;
  // 模拟时间流逝绕过 5 秒节流
  const realDateNow = Date.now;
  Date.now = () => realDateNow() + 6000;
  
  await runtime.windowListeners.pageshow();
  Date.now = realDateNow; // 恢复
  
  assert.equal(subscribedCount, 2, 'pageshow 后重新创建 channel');
  assert.equal(fetchedCount, preFetch + 1, 'pageshow 后执行 loadPhotoWallData(true)');
  
  // 4. 多次 pageshow 不创建重复 channel
  Date.now = () => realDateNow() + 12000;
  await runtime.windowListeners.pageshow();
  Date.now = realDateNow;
  
  assert.equal(subscribedCount, 2, '多次 pageshow 不创建重复 channel');
  
  // 5. 重新订阅后可处理远端 DELETE
  runtime.window.photoWallData = [{ id: 'test1', cloudId: 'test1', imageUrl: 'url1', username: 'u' }];
  let renderCalled = false;
  runtime.window.renderPhotoWallWithoutReload = () => { renderCalled = true; };
  
  mockChannel.handlers.postgres_changes({
    eventType: 'DELETE',
    old: { id: 'test1' }
  });
  
  // mock handlers sync calls set timeout
  await new Promise(r => setTimeout(r, 150));
  assert.equal(runtime.window.photoWallData.length, 0, '重新订阅后可处理远端 DELETE');
  
  // 6. CHANNEL_ERROR 等状态后允许重新订阅
  mockChannel.state = 'CHANNEL_ERROR';
  Date.now = () => realDateNow() + 18000;
  await runtime.documentListeners.visibilitychange();
  Date.now = realDateNow;
  
  assert.equal(unsubscribedCount, 2, '遇到 CHANNEL_ERROR 先取消订阅');
  assert.equal(subscribedCount, 3, '遇到 CHANNEL_ERROR 允许重新订阅');
});

// ---- P1 修复回归：删除失败恢复、重试单一绑定、级联分页 ----
const uploadSource = fs.readFileSync(path.join(ROOT, 'js/photo-wall/upload-ui.js'), 'utf8');
const renderSource = fs.readFileSync(path.join(ROOT, 'js/photo-wall/render.js'), 'utf8');

function createPhotoWallRenderRuntime(photos, options = {}) {
  let markup = '';
  let sentinel = null;
  let hasMore = !!options.hasMore;
  let innerHTMLWrites = 0;

  function tokenAnchor(tokenHtml, onRemove) {
    return {
      parentNode: grid,
      remove() {
        markup = markup.replace(tokenHtml, '');
        this.parentNode = null;
        if (onRemove) onRemove();
      },
      insertAdjacentHTML(position, html) {
        if (position === 'beforebegin') markup = markup.replace(tokenHtml, String(html) + tokenHtml);
      }
    };
  }

  function photoCards() {
    const cards = [];
    const pattern = /<div class="photo-wall-item pw-stagger-enter" data-photo-id="([^"]*)" style="[^"]*" onclick="openPhotoWallPreviewAt\((\d+), this\)">/g;
    let match;
    while ((match = pattern.exec(markup))) {
      const id = match[1];
      const index = Number(match[2]);
      cards.push({
        id,
        previewIndex: index,
        style: {},
        classList: { add() {}, remove() {} },
        getAttribute(name) { return name === 'data-photo-id' ? id : null; }
      });
    }
    return cards;
  }

  const grid = {
    classList: { toggle() {} },
    get innerHTML() { return markup; },
    set innerHTML(value) {
      markup = String(value || '');
      sentinel = null;
      innerHTMLWrites++;
    },
    appendChild(node) {
      sentinel = node;
      node.parentNode = grid;
      markup += node.outerHTML;
      return node;
    },
    insertAdjacentHTML(position, html) {
      if (position === 'beforeend') markup += String(html);
    },
    querySelector(selector) {
      if (selector === '.pw-load-more-sentinel') return sentinel;
      if (selector === '.pw-batch-nav') {
        const match = markup.match(/<div class="pw-batch-nav"[\s\S]*?<\/div>/);
        return match ? tokenAnchor(match[0]) : null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.photo-wall-item[data-photo-id]' || selector === '.photo-wall-item.pw-stagger-enter') return photoCards();
      return [];
    },
    getPhotoCards: photoCards,
    getInnerHTMLWrites() { return innerHTMLWrites; }
  };

  function makeSentinel() {
    const indicator = { textContent: '' };
    const node = {
      className: '',
      innerHTML: '',
      outerHTML: '<div class="pw-load-more-sentinel"><div class="pw-load-more-indicator"></div></div>',
      parentNode: null,
      attributes: {},
      classList: { toggle() {} },
      querySelector(selector) { return selector === '.pw-load-more-indicator' ? indicator : null; },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      removeAttribute(name) { delete this.attributes[name]; },
      insertAdjacentHTML(position, html) {
        if (position === 'beforebegin') markup = markup.replace(this.outerHTML, String(html) + this.outerHTML);
      },
      remove() {
        markup = markup.replace(this.outerHTML, '');
        this.parentNode = null;
        if (sentinel === this) sentinel = null;
      },
      indicator
    };
    return node;
  }

  const toggle = { classList: { toggle() {} }, setAttribute() {} };
  const window = {
    currentUser: 'owner',
    photoWallData: photos.slice(),
    pwCurrentSortedPhotos: [],
    pwSortKey: 'date_desc',
    pwAlbumView: false,
    pwAlbumGroupKey: '',
    addEventListener() {},
    hasMorePhotos() { return hasMore; },
    setHasMore(value) { hasMore = !!value; },
    openPhotoPreview(index, config) { this.lastPreview = { index, config }; }
  };
  if (typeof options.loadMorePhotos === 'function') {
    window.loadMorePhotos = () => options.loadMorePhotos(window, value => { hasMore = !!value; });
  }

  const document = {
    getElementById(id) {
      if (id === 'photoGrid') return grid;
      if (id === 'pwAlbumToggle') return toggle;
      return null;
    },
    createElement() { return makeSentinel(); },
    querySelector() { return null; }
  };
  const context = {
    window,
    document,
    console,
    Date,
    Map,
    Set,
    Promise,
    requestAnimationFrame(callback) { callback(); },
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(renderSource, context, { filename: 'photo-wall-render.js' });
  return { window, grid, context };
}

function makeRenderablePhotos(count, sameDay = false) {
  const day = new Date(2026, 4, 12, 12, 0, 0).getTime();
  return Array.from({ length: count }, (_, index) => ({
    id: `photo-${index}`,
    timestamp: sameDay ? day + index : count - index,
    thumbUrl: `https://example.test/photo-${index}.jpg`,
    imageUrl: `https://example.test/photo-${index}.jpg`
  }));
}

test('cloud delete failure restores the card and re-renders unconditionally', () => {
  // 修复前：失败分支调用 removePhotoLocal（移除而非恢复），且仅在 opts.render !== false 时重渲染；
  // 预览弹窗删除传 {render:false}，导致 DOM 卡片消失但数据仍在。
  // 二次修复：mergePhotoLists 只接受已 normalize 的项（按 imageUrl 判有效性），
  // 若传入原始数据库行（media_url 字段）会被静默丢弃 → 照片永久消失。
  // 故恢复前先 normalizePhotoWallRow，再做合并。
  const failBranch = dataSource.slice(dataSource.indexOf('if (!deleteResult)'), dataSource.indexOf('// 云端删除成功后才标记为已删除'));
  assert.match(failBranch, /var restoredItem = normalizePhotoWallRow\(item\)/);
  assert.match(failBranch, /mergePhotoLists\(\[restoredItem\]\.concat\(window\.photoWallData \|\| \[\]\), \[\]\)/);
  assert.doesNotMatch(failBranch, /removePhotoLocal\(id, opts\.render !== false\)/);
  assert.doesNotMatch(failBranch, /opts\.render !== false &&/);
  assert.match(failBranch, /if \(typeof window\.renderPhotoWallWithoutReload === 'function'\) window\.renderPhotoWallWithoutReload\(\)/);
});

test('retry-failed button has a single binding path and a concurrency guard', () => {
  // 修复前：按钮同时被 attachPhotoUploadUi 直接绑定 + 父容器 data-action 委托监听，
  // 一次点击并发执行两次 retryFailedUploads，产生孤儿 Storage 文件。
  assert.doesNotMatch(uploadSource, /__xtjRetryBound/);
  assert.doesNotMatch(uploadSource, /retryBtn\.addEventListener\('click', retryFailedUploads\)/);
  // 并发守卫：isBusy() 封装 uploading/retrying 锁 + try/finally 释放
  assert.match(uploadSource, /function isBusy\(\)/);
  assert.match(uploadSource, /state\.uploading \|\| state\.retrying/);
  assert.match(uploadSource, /state\.retrying = true;/);
  assert.match(uploadSource, /finally \{\s*state\.retrying = false;\s*\}/);
});

test('load-more sentinel debounces cascade paging and offers retry on real failure', () => {
  // 分组视图级联：新页照片不属于当前分组时停止自动加载
  assert.match(renderSource, /_lastMoreLoadAt/);
  assert.match(renderSource, /当前分组暂无更多照片/);
  // ★ 修复后：按日期 key 逐张判断新页照片是否属于当前分组（不再用 groupByDate(more)，
  // 后者按新页日期分组几乎永远匹配不上当前分组，导致分组页加载更多永久中断）
  assert.match(renderSource, /mKey === window\.pwAlbumGroupKey/);
  // 失败重试：真实失败显示可点击重试，AbortError（被刷新/切换取代）静默恢复
  assert.match(renderSource, /加载失败，点击重试/);
  assert.match(renderSource, /err\.name === 'AbortError'/);
});

test('upload progress percentage is actually written to the stats row', () => {
  // 修复前：pwUploadProgressPct 只在 index.html 中出现一次，从未被 JS 更新，恒显示 0%
  assert.match(uploadSource, /pwUploadProgressPct/);
  assert.match(uploadSource, /pctEl\.textContent = \(typeof pct === 'number'\) \? Math\.round\(pct\) \+ '%' : '0%'/);
  assert.match(uploadSource, /if \(pctEl\) pctEl\.textContent = '0%';/);
});

test('photo view count is wired when the preview opens', () => {
  // 修复前：syncPhotoViewCount 定义并导出但从未被调用，"浏览"数永远不涨
  assert.match(dataSource, /window\.syncPhotoViewCount = syncPhotoViewCount/);
  const openPreview = renderSource.slice(renderSource.indexOf('function openPhotoWallPreviewAt'), renderSource.indexOf('function photoCardHtml'));
  assert.match(fs.readFileSync(path.join(ROOT, 'js/photo-wall/preview.js'), 'utf8'), /window\.syncPhotoViewCount/);
  assert.doesNotMatch(openPreview, /window\.syncPhotoViewCount/);
});

test('photo wall renders 500-item batches at 500, 501, and 1001 photo boundaries', async () => {
  for (const total of [500, 501, 1001]) {
    const runtime = createPhotoWallRenderRuntime(makeRenderablePhotos(total));
    runtime.window.renderPhotoWallWithoutReload();

    assert.equal(runtime.grid.getPhotoCards().length, Math.min(total, 500), `${total} photos: first batch is capped at 500`);
    assert.equal(runtime.window.pwCurrentSortedPhotos.length, total, `${total} photos: preview source retains the full sorted list`);

    if (total <= 500) {
      assert.doesNotMatch(runtime.grid.innerHTML, /pw-batch-nav/);
      continue;
    }

    assert.match(runtime.grid.innerHTML, /下一批/);
    await runtime.window.showNextPhotoBatch();
    const secondBatch = runtime.grid.getPhotoCards();
    assert.equal(secondBatch.length, Math.min(total - 500, 500));
    assert.equal(secondBatch[0].id, 'photo-500');
    assert.equal(secondBatch[0].previewIndex, 500, 'batch card onclick indices stay global');

    const previewCard = secondBatch[secondBatch.length - 1];
    runtime.window.openPhotoWallPreviewAt(previewCard.previewIndex, previewCard);
    assert.equal(runtime.window.lastPreview.config.photos.length, total);
    assert.equal(runtime.window.lastPreview.config.photos[previewCard.previewIndex].id, previewCard.id);

    if (total === 1001) {
      await runtime.window.showNextPhotoBatch();
      assert.equal(runtime.grid.getPhotoCards().length, 1, 'the final partial batch remains visible');
      assert.equal(runtime.grid.getPhotoCards()[0].id, 'photo-1000');
      assert.equal(runtime.grid.getPhotoCards()[0].previewIndex, 1000);
      await runtime.window.showPreviousPhotoBatch();
      assert.equal(runtime.grid.getPhotoCards().length, 500, 'previous from the tail returns to batch two');
      assert.equal(runtime.grid.getPhotoCards()[0].id, 'photo-500');
    }

    await runtime.window.showPreviousPhotoBatch();
    assert.equal(runtime.grid.getPhotoCards().length, 500, 'previous returns to the first batch');
    assert.equal(runtime.grid.getPhotoCards()[0].id, 'photo-0');
  }
});

test('photo wall next-batch request does not navigate to an empty tail after filtering', async () => {
  const runtime = createPhotoWallRenderRuntime(makeRenderablePhotos(60), {
    hasMore: true,
    async loadMorePhotos(window, setHasMore) {
      setHasMore(false);
      return [{ id: 'filtered-video', mediaKind: 'video', mimeType: 'video/mp4', imageUrl: '' }];
    }
  });
  runtime.window.renderPhotoWallWithoutReload();
  await runtime.window.showNextPhotoBatch();
  assert.equal(runtime.grid.getPhotoCards().length, 60);
  assert.equal(runtime.grid.getPhotoCards()[0].id, 'photo-0');
  assert.doesNotMatch(runtime.grid.innerHTML, /下一批/);
});

test('photo album detail paginates within the selected date and preserves preview indices', async () => {
  const photos = makeRenderablePhotos(501, true);
  const runtime = createPhotoWallRenderRuntime(photos);
  runtime.window.pwAlbumView = true;
  const date = new Date(photos[0].timestamp);
  runtime.window.pwAlbumGroupKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  runtime.window.renderPhotoWallWithoutReload();

  assert.equal(runtime.grid.getPhotoCards().length, 500);
  assert.match(runtime.grid.innerHTML, /返回相册/);
  await runtime.window.showNextPhotoBatch();
  assert.equal(runtime.grid.getPhotoCards().length, 1);
  assert.equal(runtime.grid.getPhotoCards()[0].previewIndex, 500);
  assert.equal(runtime.window.pwCurrentSortedPhotos.length, 501);
  await runtime.window.showPreviousPhotoBatch();
  assert.equal(runtime.grid.getPhotoCards().length, 500, 'previous keeps the album detail active and returns to its first batch');
  assert.match(runtime.grid.innerHTML, /返回相册/);
});

test('photo wall sentinel remains keyboard operable without IntersectionObserver and appends without replacing existing cards', async () => {
  const runtime = createPhotoWallRenderRuntime(makeRenderablePhotos(60), {
    hasMore: true,
    async loadMorePhotos(window, setHasMore) {
      window.photoWallData.push({
        id: 'photo-60', timestamp: 0,
        thumbUrl: 'https://example.test/photo-60.jpg', imageUrl: 'https://example.test/photo-60.jpg'
      });
      setHasMore(false);
      return [window.photoWallData[window.photoWallData.length - 1]];
    }
  });
  runtime.window.renderPhotoWallWithoutReload();
  assert.equal(runtime.window.IntersectionObserver, undefined);
  assert.equal(runtime.grid.getPhotoCards().length, 60);
  assert.equal(runtime.grid.getInnerHTMLWrites(), 1);
  const sentinel = runtime.grid.querySelector('.pw-load-more-sentinel');
  assert.equal(sentinel.attributes.role, 'button');
  assert.equal(sentinel.attributes.tabindex, '0');
  assert.equal(typeof sentinel.onclick, 'function');

  let prevented = false;
  sentinel.onkeydown({ key: 'Enter', preventDefault() { prevented = true; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.equal(runtime.grid.getPhotoCards().length, 61);
  assert.equal(runtime.grid.getPhotoCards()[60].id, 'photo-60');
  assert.equal(runtime.grid.getInnerHTMLWrites(), 1, 'incremental loading preserves the existing grid instead of rebuilding it');
  assert.equal(runtime.grid.querySelector('.pw-load-more-sentinel'), null, 'sentinel is removed after the last page');
});

test('an in-flight batch request does not apply its offset after the user changes photo-wall view', async () => {
  let resolvePage;
  const photos = makeRenderablePhotos(60, true);
  const date = new Date(photos[0].timestamp);
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const runtime = createPhotoWallRenderRuntime(photos, {
    hasMore: true,
    loadMorePhotos(window, setHasMore) {
      return new Promise(resolve => {
        resolvePage = () => {
          const photo = { id: 'photo-60', timestamp: photos[0].timestamp + 1, thumbUrl: 'https://example.test/photo-60.jpg', imageUrl: 'https://example.test/photo-60.jpg' };
          window.photoWallData.push(photo);
          setHasMore(false);
          resolve([photo]);
        };
      });
    }
  });
  runtime.window.renderPhotoWallWithoutReload();
  const pendingNext = runtime.window.showNextPhotoBatch();
  runtime.window.pwAlbumView = true;
  runtime.window.pwAlbumGroupKey = dateKey;
  runtime.window.renderPhotoWallWithoutReload();
  resolvePage();
  await pendingNext;

  assert.equal(runtime.grid.getPhotoCards().length, 60);
  assert.match(runtime.grid.innerHTML, /返回相册/);
  assert.equal(runtime.grid.getPhotoCards()[0].previewIndex, 0);
});

test('confirmed deletion resolves while public refresh is still pending',async()=>{
 let releaseRefresh;const runtime=createPhotoDataRuntime(async url=>String(url).includes('/api/photo/delete') ? {ok:true,json:async()=>({ok:true,deleted:true})} : new Promise(resolve=>{releaseRefresh=resolve;}));
 const photo={id:'p-fast',cloudId:'p-fast',username:'owner',imageUrl:'https://example.test/fast.jpg',timestamp:1};runtime.window.currentUser='owner';runtime.window.photoWallData=[photo];
 const result=await Promise.race([runtime.window.deletePhotoWallPhoto(photo),new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),200))]);
 assert.equal(result.ok,true);assert.equal(runtime.window.photoWallData.length,0);if(releaseRefresh)releaseRefresh({ok:true,json:async()=>({ok:true,data:[]})});
});
test('normal users cannot use stale admin flags or forged ownership to delete another photo',async()=>{
 let requests=0;const runtime=createPhotoDataRuntime(async()=>{requests++;return {ok:true,json:async()=>({ok:true})};});
 runtime.window.currentUser='B';runtime.window.isAdmin=()=>true;
 const photo={id:'victim',username:'A',imageUrl:'https://example.test/a.jpg',timestamp:1};runtime.window.photoWallData=[photo];
 assert.equal((await runtime.window.deletePhotoWallPhoto(photo)).ok,false);assert.equal(requests,0);assert.equal(runtime.window.photoWallData.length,1);
 runtime.window.currentUser='A';assert.equal(runtime.window.canDeletePhotoWallPhoto(photo),true);
 runtime.window.currentUser='xxz';assert.equal(runtime.window.canDeletePhotoWallPhoto(photo),true);
});
