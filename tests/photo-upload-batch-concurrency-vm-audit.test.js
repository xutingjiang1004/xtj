'use strict';
// G-H3 vm 回归测试：浏览器二进制装不上（见 G-H1 的说明），用 vm + 手写桩
// 加载 js/photo-wall/upload-ui.js，测按整批总字节算并发上限的纯函数
// window.__xtjPhotoWallBatchWorkerLimit。原图本身不压缩、只调并发。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo-wall', 'upload-ui.js'), 'utf8');

function loadUploadUi() {
  const window = { addEventListener() {} };
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
    console,
    // 桩掉定时器：upload-ui.js 顶层注册了一个 30 分钟 setInterval（低频重试），
    // 用真定时器会让测试进程永不退出；本测试只测纯函数，不需要它跑。
    setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
    AbortController, Map, Set, Blob, URL, FormData, fetch: async () => { throw Error('no network in test'); },
    navigator: {},
  };
  sandbox.window = window;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'upload-ui.js' });
  return window.__xtjPhotoWallBatchWorkerLimit;
}

const MB = 1024 * 1024;
const jobs = (sizes) => sizes.map(s => ({ file: { size: s * MB } }));

test('G-H3: 批量总字节 ≤30MB 保持 3 路并发，>30MB 降 2 路，>60MB 降 1 路', () => {
  const limit = loadUploadUi();
  assert.equal(typeof limit, 'function');
  assert.equal(limit(jobs([5, 5, 5])), 3, '15MB 仍 3 路');
  assert.equal(limit(jobs([10, 10, 10])), 3, '30MB 整仍 3 路');
  assert.equal(limit(jobs([10, 10, 11])), 2, '31MB 降 2 路');
  assert.equal(limit(jobs([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5])), 2, '12 张 × 5MB = 60MB 降 2 路');
  assert.equal(limit(jobs([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10])), 1, '12 张 × 10MB = 120MB 降 1 路');
  assert.equal(limit([]), 3, '空批默认 3 路');
  assert.equal(limit([{ file: null }, { file: { size: 5 * MB } }]), 3, '无 file 的 job 按 0 字节计');
});

test('G-H3: 单张 >20MB 的旧规则仍生效（至多 2 路），且不抬高总量规则的下限', () => {
  const limit = loadUploadUi();
  assert.equal(limit(jobs([25])), 2, '单张 25MB 降 2 路');
  assert.equal(limit(jobs([25, 25, 25])), 1, '3 张 25MB 共 75MB 仍降 1 路');
  assert.equal(limit(jobs([20])), 3, '单张 20MB 整不触发大文件规则');
});
