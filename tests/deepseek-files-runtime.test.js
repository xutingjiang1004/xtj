'use strict';
// DeepSeek 文件解析（Files API 代理）：purpose 选择、multipart 字段顺序、
// 参数校验、上游错误映射，以及「未配置时明确失败」的回落信号。
const test = require('node:test'), assert = require('node:assert/strict');
const afterHook = require('node:test').after;
const http = require('node:http');
const express = require('express');
const {
  createDeepSeekFiles, purposeFor, safeFilename, decodeDataUrl,
  upstreamMessage, MAX_BYTES
} = require('../render-api/deepseek-files');

// 断言失败时测试会跳过显式 close，若不统一兜底，残留监听会让 node --test 永不退出。
const openServers = [];
afterHook(() => Promise.all(openServers.map(s => s.close())));

async function start(env, upstream) {
  const calls = [];
  const app = express();
  app.use('/api/agent/files', createDeepSeekFiles({
    express, env, timeoutMs: 400,
    guestAiAuth: (req, res, next) => next(),
    rateLimit: () => (req, res, next) => next(),
    fetchImpl: async (url, init) => { calls.push({ url, init }); return upstream(url, init); }
  }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let closed = false;
  const close = () => new Promise(r => { if (closed) return r(); closed = true; server.close(r); });
  const handle = {
    base: 'http://127.0.0.1:' + server.address().port + '/api/agent/files',
    calls,
    close
  };
  openServers.push(handle);
  return handle;
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body)
});
const okUpload = () => jsonResponse(200, { id: 'file-api-abc123', object: 'file', bytes: 12, filename: 'a.pdf', purpose: 'rich_layout_recognition' });

function payload(overrides) {
  return Object.assign({
    name: 'report.pdf',
    type: 'application/pdf',
    data_url: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 hello').toString('base64')
  }, overrides || {});
}
const post = body => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('purposeFor: PDF/Word/PPT 走版面解析，纯文本/表格/电子书走 user_data，图片与未知格式不代理', () => {
  assert.deepEqual(purposeFor('a.PDF'), { purpose: 'rich_layout_recognition' });
  assert.deepEqual(purposeFor('报告.docx'), { purpose: 'rich_layout_recognition' });
  assert.deepEqual(purposeFor('slides.pptx'), { purpose: 'rich_layout_recognition' });
  assert.deepEqual(purposeFor('data.xlsx'), { purpose: 'user_data' });
  assert.deepEqual(purposeFor('notes.txt'), { purpose: 'user_data' });
  assert.deepEqual(purposeFor('book.epub'), { purpose: 'user_data' });
  assert.equal(purposeFor('photo.png'), null);
  assert.equal(purposeFor('archive.zip'), null);
  assert.equal(purposeFor('noext'), null);
});

test('safeFilename: 去掉路径、控制字符与危险字符，长度有上限', () => {
  assert.equal(safeFilename('../../etc/passwd'), 'passwd');
  assert.equal(safeFilename('C:\\tmp\\a.pdf'), 'a.pdf');
  assert.equal(safeFilename('a\r\nb.txt'), 'a__b.txt');
  assert.ok(safeFilename('x'.repeat(400)).length <= 180);
  assert.equal(safeFilename(''), 'file');
});

test('decodeDataUrl: 只接受完整 base64 data URL，拒绝任意文本与超长数据', () => {
  const got = decodeDataUrl('data:application/pdf;base64,' + Buffer.from('abc').toString('base64'));
  assert.equal(got.buffer.toString(), 'abc');
  assert.equal(got.mime, 'application/pdf');
  assert.equal(decodeDataUrl('javascript:alert(1)'), null);
  assert.equal(decodeDataUrl('data:application/pdf;base64,%%%'), null);
  assert.equal(decodeDataUrl('data:application/pdf;base64,'), null);
  assert.equal(decodeDataUrl(null), null);
  assert.ok(MAX_BYTES > 1024);
});

test('upstreamMessage: 官方错误码映射成可执行的中文提示', () => {
  assert.match(upstreamMessage(400), /格式不支持|加密/);
  assert.match(upstreamMessage(413), /过大/);
  assert.match(upstreamMessage(429), /太多|稍后/);
  assert.match(upstreamMessage(504), /超时|拆分/);
  assert.match(upstreamMessage(503), /繁忙/);
});

test('status: 有密钥才可用，并回报上限与格式', async () => {
  let s = await start({}, okUpload);
  let r = await fetch(s.base + '/status');
  assert.equal((await r.json()).available, false);
  await s.close();
  s = await start({ DEEPSEEK_API_KEY: 'k' }, okUpload);
  const d = await (await fetch(s.base + '/status')).json();
  assert.equal(d.available, true);
  assert.ok(Array.isArray(d.supported) && d.supported.includes('pdf'));
  await s.close();
});

test('未配置密钥：上传返回 503 files_unconfigured，不会去请求上游', async () => {
  const s = await start({}, okUpload);
  const r = await fetch(s.base + '/upload', post(payload()));
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, 'files_unconfigured');
  assert.equal(s.calls.length, 0);
  await s.close();
});

test('上传成功：purpose 严格排在 file 之前，带 Bearer 鉴权，返回 file_id', async () => {
  const s = await start({ DEEPSEEK_API_KEY: 'secret' }, okUpload);
  const r = await fetch(s.base + '/upload', post(payload()));
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.file_id, 'file-api-abc123');
  assert.equal(d.purpose, 'rich_layout_recognition');
  assert.equal(d.filename, 'report.pdf');
  assert.equal(d.bytes, 14);

  const call = s.calls[0];
  assert.equal(call.url, 'https://api.deepseek.com/files');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, 'Bearer secret');
  const keys = Array.from(call.init.body.keys());
  assert.deepEqual(keys, ['purpose', 'file']);   // 官方硬性要求
  assert.equal(call.init.body.get('purpose'), 'rich_layout_recognition');
  assert.equal(call.init.body.get('file').name, 'report.pdf');
  await s.close();
});

test('纯文本走 user_data，不触发计费的版面解析', async () => {
  const s = await start({ DEEPSEEK_API_KEY: 'k' }, okUpload);
  const r = await fetch(s.base + '/upload', post(payload({ name: 'note.txt', type: 'text/plain', data_url: 'data:text/plain;base64,' + Buffer.from('hello').toString('base64') })));
  assert.equal((await r.json()).purpose, 'user_data');
  assert.equal(s.calls[0].init.body.get('purpose'), 'user_data');
  await s.close();
});

test('不支持的格式 / 无效数据：本地直接 400，不打上游', async () => {
  const s = await start({ DEEPSEEK_API_KEY: 'k' }, okUpload);
  let r = await fetch(s.base + '/upload', post(payload({ name: 'a.zip' })));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'unsupported_file');
  r = await fetch(s.base + '/upload', post(payload({ data_url: 'not-a-data-url' })));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'invalid_file_data');
  assert.equal(s.calls.length, 0);
  await s.close();
});

test('上游 400/413/504：透传状态码并给出中文提示', async () => {
  const cases = [[400, 'bad file'], [413, 'too large'], [504, 'timeout']];
  for (const [status, msg] of cases) {
    const s = await start({ DEEPSEEK_API_KEY: 'k' }, () => jsonResponse(status, { error: { message: msg } }));
    const r = await fetch(s.base + '/upload', post(payload()));
    assert.equal(r.status, status);
    const d = await r.json();
    assert.equal(d.ok, false);
    assert.ok(d.error && !/bad file|too large|timeout/i.test(d.error), '不把上游英文原文丢给用户');
    await s.close();
  }
});

test('上游返回体缺少合法 file_id：502，绝不把伪造 id 交给前端', async () => {
  const s = await start({ DEEPSEEK_API_KEY: 'k' }, () => jsonResponse(200, { object: 'file' }));
  const r = await fetch(s.base + '/upload', post(payload()));
  assert.equal(r.status, 502);
  assert.equal((await r.json()).code, 'bad_upload_response');
  await s.close();
});

test('网络异常 → 502；解析超时 → 504', async () => {
  let s = await start({ DEEPSEEK_API_KEY: 'k' }, async () => { throw new Error('ECONNRESET'); });
  let r = await fetch(s.base + '/upload', post(payload()));
  assert.equal(r.status, 502);
  assert.equal((await r.json()).code, 'upstream_unreachable');
  await s.close();

  s = await start({ DEEPSEEK_API_KEY: 'k' }, async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); });
  r = await fetch(s.base + '/upload', post(payload()));
  assert.equal(r.status, 504);
  assert.equal((await r.json()).code, 'parse_timeout');
  await s.close();
});

test('DELETE: 校验 file_id 格式，合法时转发删除', async () => {
  const s = await start({ DEEPSEEK_API_KEY: 'k' }, () => jsonResponse(200, { deleted: true }));
  let r = await fetch(s.base + '/not-a-file-id', { method: 'DELETE' });
  assert.equal(r.status, 400);
  r = await fetch(s.base + '/file-api-abc123', { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal(s.calls[0].init.method, 'DELETE');
  await s.close();
});
