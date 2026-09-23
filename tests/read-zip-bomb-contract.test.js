'use strict';

// P1-11 审计回归：read_zip 的解压侧限制（ZIP 炸弹 / 目录爆炸）。
//
// 下载侧早就有 30MB 上限，但 ZIP 是压缩格式：一个几十 KB 的包可以声明出上 GB
// 的解压后体积（zip bomb），而修复前的实现**完全没有解压侧限制** —— 清单分支会
// 遍历全部条目，取文件分支会把单个条目整体解压进内存。
//
// 本文件把 server.js 里 `case 'read_zip': { ... }` 的真实代码抽出来执行
// （注入 fetchSafeBuffer / assertSafeWebUrl / toolHelpers 等依赖），
// 因此这些是行为测试而非纯静态断言。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'render-api', 'server.js'), 'utf8');
const toolHelpers = require(path.join(ROOT, 'render-api', 'tool-helpers.js'));

// 抽取 case 'read_zip' 的块体，编译成可执行函数（注入外部依赖）。
function loadReadZip() {
  const start = serverSrc.indexOf("case 'read_zip': {");
  assert.ok(start >= 0, "read_zip branch must exist");
  const open = serverSrc.indexOf('{', start) + 1;
  let depth = 1;
  let i = open;
  while (depth > 0 && i < serverSrc.length) {
    const c = serverSrc[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  const body = serverSrc.slice(open, i - 1);
  // 分支体内有 await，必须用 AsyncFunction 构造
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  // eslint-disable-next-line no-new-func
  return new AsyncFunction(
    'require', 'assertSafeWebUrl', 'fetchSafeBuffer', 'toolHelpers', 'name', 'args', 'context',
    body
  );
}

const readZip = loadReadZip();

const okUrl = async () => ({ parsed: new URL('https://example.com/a.zip'), addresses: ['93.184.216.34'] });

async function callReadZip(args, buffer) {
  return readZip(
    require,
    okUrl,
    async () => ({ ok: true, status: 200, buffer: buffer, bytes: buffer.length }),
    toolHelpers,
    'read_zip',
    args,
    {}
  );
}

async function zipWithTextFiles(files) {
  const zip = new JSZip();
  Object.keys(files).forEach((k) => zip.file(k, files[k]));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('P1-11: a normal zip still lists its entries', async () => {
  const buf = await zipWithTextFiles({ 'a.txt': 'hello', 'b.txt': 'world', 'notes/readme.txt': 'hi' });
  const out = await callReadZip({ url: 'https://example.com/a.zip' }, buf);
  assert.equal(out.error, undefined, 'normal zip must not be rejected: ' + (out.error || ''));
  assert.equal(out.file_count, 3);
  assert.match(out.content, /【压缩包清单】/);
  assert.match(out.content, /a\.txt/);
});

test('P1-11: a normal text entry can still be read', async () => {
  const buf = await zipWithTextFiles({ 'a.txt': 'hello zip' });
  const out = await callReadZip({ url: 'https://example.com/a.zip', entry: 'a.txt' }, buf);
  assert.equal(out.error, undefined, out.error);
  assert.match(out.content, /hello zip/);
});

test('P1-11: a zip bomb entry is rejected before decompression', async () => {
  // 12MB 的重复字节 —— DEFLATE 后只有几十 KB，解压后却远超 8MB 单文件上限。
  const payload = 'A'.repeat(12 * 1024 * 1024);
  const buf = await zipWithTextFiles({ 'bomb.txt': payload });
  assert.ok(buf.length < 1024 * 1024, 'fixture must be a genuinely high-ratio zip: ' + buf.length);

  const out = await callReadZip({ url: 'https://example.com/a.zip', entry: 'bomb.txt' }, buf);
  assert.match(String(out.error || ''), /超过单文件/,
    'oversized entry must be rejected by its declared uncompressed size');
  assert.equal(out.content, undefined, 'rejected entry must not be decompressed into the response');
});

test('P1-11: an entry-count explosion is rejected', async () => {
  // 10001 个空文件 —— 中央目录足够小，但条目数超过 10000 上限。
  const files = {};
  for (let i = 0; i < 10001; i++) files['f' + i + '.txt'] = '';
  const buf = await zipWithTextFiles(files);
  const out = await callReadZip({ url: 'https://example.com/a.zip' }, buf);
  assert.match(String(out.error || ''), /条目过多/,
    'zip with too many entries must be rejected');
});

test('P1-11: limits are declared in the source (static contract)', () => {
  const code = serverSrc.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n');
  assert.match(code, /ZIP_MAX_ENTRIES\s*=\s*\d+/, 'entry-count cap must be defined');
  assert.match(code, /ZIP_MAX_ENTRY_UNCOMPRESSED\s*=\s*\d+/, 'per-entry size cap must be defined');
  assert.match(code, /rzAllNames\.length > ZIP_MAX_ENTRIES/, 'entry cap must actually be enforced');
  assert.match(code, /rzTargetSize > ZIP_MAX_ENTRY_UNCOMPRESSED/, 'per-entry cap must actually be enforced');
  // 清单分支不应因为"声明的总大小"巨大而输出离谱数字
  assert.match(code, /ZIP_LIST_TOTAL_CAP/, 'listing total must be capped');
});
