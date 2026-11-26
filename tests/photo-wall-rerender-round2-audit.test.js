'use strict';
// 第二轮审计 重-2 / 重-4：照片墙重复渲染与列表缓存。
// 重-2：单次切回可能触发 2–3 次重建。renderPhotoWall 旧逻辑：任何并发
//   调用都置 pendingRender，第二遍先写 loading 占位再重建——切回慢加载
//   时 100ms 兜底与首轮重叠，同一份数据被建两次、在途下载被抛弃。
//   修复：在途渲染已覆盖本次请求时不再排队第二遍，只有 force 请求才
//   需要第二遍。
// 重-4：列表缓存 TTL 只有 20 秒，切走几十秒回来必定重新拉列表。
//   修复：放宽到 60 秒。实时订阅 + BroadcastChannel 本就会即时推送
//   新增/删除，列表拉取只是兜底，不影响新鲜度。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const renderSrc = fs.readFileSync(path.join(root, 'js', 'photo-wall', 'render.js'), 'utf8');
const dataSrc = fs.readFileSync(path.join(root, 'js', 'photo-wall', 'data.js'), 'utf8');

test('重-2: 并发非 force 渲染不再排队第二遍', () => {
  const fnIdx = renderSrc.indexOf('async function renderPhotoWall(options)');
  assert.ok(fnIdx >= 0, '应有 renderPhotoWall');
  const fnBody = renderSrc.slice(fnIdx, fnIdx + 1200);
  assert.ok(!fnBody.includes('pendingForce = pendingForce || !!(options && options.force);'),
    '不得再无条件把并发调用记成待处理');
  assert.ok(fnBody.includes('if (_force) { pendingForce = true; pendingRender = true; }'),
    '只有 force 并发调用才排队第二遍');
  assert.ok(fnBody.includes('return _renderPromise;'),
    '并发非 force 调用应直接返回在途 promise');
});

test('重-4: 列表缓存 TTL 放宽到 60 秒', () => {
  assert.ok(dataSrc.includes('var LOAD_CACHE_TTL_MS = 60000;'), 'TTL 应为 60000');
  assert.ok(!dataSrc.includes('var LOAD_CACHE_TTL_MS = 20000;'), '不得再用 20 秒 TTL');
});
