'use strict';
// G-L6 回归测试：排序“按用户”不是拼音序。旧实现按 Unicode 码点逐字比较，
// 中文用户名排出来是刘、张、李、王、陈；修复后用 localeCompare(..., 'zh-CN')，
// 按拼音排：陈、李、刘、王、张。
// 两处同改：data.js comparePhotoWallOrder 与 render.js sortPhotoWallData 的
// 无 data.js 兜底分支。服务端 RPC 仍用 COLLATE "C"（改它需迁移，见需决定清单）。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createPhotoDataRuntime } = require('./helpers/photo-data-runtime-fixture');

const NAMES_PINYIN = ['陈六', '李四', '刘七', '王五', '张三'];
const NAMES_CODEPOINT = ['刘七', '张三', '李四', '王五', '陈六'];

test('G-L6: data.js 按用户排序用拼音序', () => {
  const runtime = createPhotoDataRuntime(async () => ({ ok: true, json: async () => ({ ok: true, data: [] }) }));
  const photos = NAMES_CODEPOINT.map((username, i) => ({ username, timestamp: Date.UTC(2026, 9, 12) - i * 1000 }));
  const sorted = photos.slice().sort((a, b) => runtime.window.__xtjComparePhotoWallOrder(a, b, 'name'));
  assert.deepEqual(Array.from(sorted.map(p => p.username)), NAMES_PINYIN);
});

test('G-L6: render.js 无 data.js 时的兜底排序也用拼音序', () => {
  const RENDER_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo-wall', 'render.js'), 'utf8');
  const window = { currentUser: 'owner', addEventListener() {} };
  const document = {
    getElementById() { return null; },
    createElement() { return { style: {}, addEventListener() {} }; },
    addEventListener() {},
    querySelector() { return null; },
  };
  const sandbox = {
    window, document, console, Date, Map, Set, Promise,
    requestAnimationFrame(fn) { fn(); },
    setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(RENDER_SRC, sandbox, { filename: 'photo-wall-render.js' });
  const photos = NAMES_CODEPOINT.map((username, i) => ({
    id: 'p' + i, username, timestamp: Date.UTC(2026, 9, 12) - i * 1000,
    imageUrl: 'https://example.test/p' + i + '.jpg',
  }));
  const sorted = window.sortPhotoWallData(photos, 'name');
  assert.deepEqual(Array.from(sorted.map(p => p.username)), NAMES_PINYIN);
});
