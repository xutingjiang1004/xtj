'use strict';
// G-M7 vm 回归测试：浏览器二进制装不上（见 G-H1 的说明），用 vm + 手写桩
// 加载 js/photo-wall/upload-ui.js，调 window.__xtjSavePendingPhotoUpload。
// 修复前：pending 队列只留最新 50 条，超了最旧的记录静默丢失，对应
// Storage 孤儿文件再无人清理；修复后：上限 200 条。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo-wall', 'upload-ui.js'), 'utf8');

function loadUploadUi() {
  const storage = new Map();
  const window = {
    addEventListener() {},
    safeStorage: {
      get: k => storage.has(k) ? storage.get(k) : null,
      set: (k, v) => storage.set(k, String(v)),
      remove: k => storage.delete(k),
    },
  };
  const document = {
    readyState: 'loading', // boot() 延后到 DOMContentLoaded，本测试不触发
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, addEventListener() {} }; },
  };
  const sandbox = {
    window, document,
    console, Date,
    // 桩掉定时器：upload-ui.js 顶层注册了一个 30 分钟 setInterval（低频重试），
    // 用真定时器会让测试进程永不退出；本测试只测纯函数，不需要它跑。
    setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
    AbortController, Map, Set, Blob, URL, FormData, fetch: async () => { throw Error('no network in test'); },
    navigator: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'upload-ui.js' });
  return {
    window,
    readPending() { return JSON.parse(storage.get('xtj_photo_upload_pending') || '[]'); },
  };
}

function pendingInfo(i) {
  return { uploadId: 'up-' + i, path: 'photos/up-' + i + '.jpg', owner: 'owner', fileName: 'up-' + i + '.jpg' };
}

test('G-M7: 60 条待确认上传全保留，不再被 50 条上限截断', () => {
  const rt = loadUploadUi();
  for (let i = 0; i < 60; i++) rt.window.__xtjSavePendingPhotoUpload(pendingInfo(i));
  const kept = rt.readPending();
  assert.equal(kept.length, 60, '60 条应全保留');
  assert.equal(kept[0].uploadId, 'up-0', '最旧的记录也不应丢失');
  assert.equal(kept[59].uploadId, 'up-59');
});

test('G-M7: 上限仍存在但为 200 条，超了只丢最旧的', () => {
  const rt = loadUploadUi();
  for (let i = 0; i < 210; i++) rt.window.__xtjSavePendingPhotoUpload(pendingInfo(i));
  const kept = rt.readPending();
  assert.equal(kept.length, 200);
  assert.equal(kept[0].uploadId, 'up-10', '只丢最旧的 10 条');
  assert.equal(kept[199].uploadId, 'up-209');
});

test('G-M7: 同一 uploadId 多次保存仍只记一条（upsert 去重不变）', () => {
  const rt = loadUploadUi();
  rt.window.__xtjSavePendingPhotoUpload(pendingInfo(1));
  rt.window.__xtjSavePendingPhotoUpload({ uploadId: 'up-1', path: 'photos/up-1b.jpg', owner: 'owner' });
  const kept = rt.readPending();
  assert.equal(kept.length, 1);
  assert.equal(kept[0].attempt, 1, '第二次保存计为一次更新');
  assert.deepEqual(kept[0].allPaths, ['photos/up-1.jpg', 'photos/up-1b.jpg'], '历史路径不丢失');
});
