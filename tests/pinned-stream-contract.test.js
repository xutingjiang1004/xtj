'use strict';

// P1-3 审计回归：自定义模型（用户可控 base_url）的上游请求必须真正做 DNS pin。
//
// 修复前 server.js 写成：
//   fetch(baseUrl + '/chat/completions', { ..., agent: createPinnedAgent(addrs) })
// 但 Node 内置 fetch 走 undici，只认 `dispatcher`，`agent` 被静默忽略 →
// fetch 自己再解析一次 DNS，与 assertSafeWebUrl 的解析相互独立，
// DNS rebinding 窗口（校验时公网 IP、连接时内网 IP）从未被真正关闭。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const webFetch = require(path.join(ROOT, 'render-api', 'web-fetch.js'));
const serverSrc = fs.readFileSync(path.join(ROOT, 'render-api', 'server.js'), 'utf8');
const serverCode = serverSrc.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n');

// ─────────────────── 静态契约 ───────────────────

test('P1-3: no fetch call still relies on the ignored `agent:` option', () => {
  assert.doesNotMatch(serverCode, /\bagent:\s*createPinnedAgent\(/,
    'Node built-in fetch ignores http.Agent; use requestPinnedStream instead');
  assert.doesNotMatch(serverCode, /\bagent:\s*_pinnedAgent/,
    'leftover pinned-agent option found on a fetch call');
});

test('P1-3: custom-model upstream calls go through requestPinnedStream', () => {
  assert.match(serverCode, /upstream = await requestPinnedStream\(_chatEndpoint, _safeCheck\.addresses/);
  assert.match(serverCode, /return requestPinnedStream\(_chatEndpoint2, _safe2\.addresses/);
  assert.match(serverCode, /requestPinnedStream,\s*fetchSafeRaw/,
    'requestPinnedStream must be imported from web-fetch');
  // 端点必须由已校验的 parsed 派生，而不是重新拼接用户可控字符串
  assert.match(serverCode, /_chatEndpoint = new URL\(_safeCheck\.parsed\.href/);
  assert.match(serverCode, /_chatEndpoint2 = new URL\(_safe2\.parsed\.href/);
});

test('P1-3: requestPinnedStream requires a non-empty verified address list', async () => {
  assert.equal(typeof webFetch.requestPinnedStream, 'function');
  const url = new URL('http://127.0.0.1:9/chat/completions');
  await assert.rejects(() => webFetch.requestPinnedStream(url, []), /非空/,
    'empty address list must be rejected instead of silently re-resolving DNS');
  await assert.rejects(() => webFetch.requestPinnedStream(url, null), /非空/);
});

// ─────────────────── 端到端行为 ───────────────────

function startServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function readAll(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

test('P1-3: pinned request streams an SSE body with fetch-compatible Response API', async () => {
  const server = await startServer((req, res) => {
    assert.equal(req.headers['accept-encoding'], 'identity');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"a":1}\n\n');
    setTimeout(() => { res.write('data: {"a":2}\n\n'); res.end(); }, 20);
  });
  try {
    const port = server.address().port;
    const url = new URL('http://localhost:' + port + '/chat/completions');
    // 关键：把 localhost 固定到 127.0.0.1 —— 若 lookup 被忽略也能连上，
    // 因此这条用例只验证「Response API 兼容 + 流分块可读」。
    const response = await webFetch.requestPinnedStream(url, ['127.0.0.1'], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'x', messages: [] })
    });
    assert.equal(response.status, 200);
    assert.equal(response.ok, true);
    assert.match(String(response.headers.get('content-type') || ''), /text\/event-stream/);
    const text = await readAll(response);
    assert.match(text, /data: \{"a":1\}/);
    assert.match(text, /data: \{"a":2\}/, 'streamed chunks must all be delivered');
  } finally {
    await stopServer(server);
  }
});

test('P1-3: the pinned lookup is actually used (not silently ignored)', async () => {
  // 服务只监听 127.0.0.2，而 URL 主机名是 localhost（正常解析到 127.0.0.1/::1）。
  //   若 pinnedLookup 生效 → 连到 127.0.0.2 → 成功；
  //   若被忽略（旧实现 `agent:` 的等效行为）→ 解析 localhost → 连不上 → 失败。
  // 这是一条**正向**证明，比"钉到不可达地址必然失败"更确定、也更快。
  const server = await new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => { res.writeHead(200); res.end('ok'); });
    s.listen(0, '127.0.0.2', () => resolve(s));
    s.on('error', reject);
  });
  try {
    const port = server.address().port;
    const url = new URL('http://localhost:' + port + '/chat/completions');
    const response = await webFetch.requestPinnedStream(url, ['127.0.0.2'], {
      method: 'POST', body: '{}', signal: AbortSignal.timeout(5000)
    });
    assert.equal(response.status, 200,
      'pinned address must be honoured — otherwise DNS would be re-resolved (SSRF TOCTOU)');
    assert.equal(await response.text(), 'ok');
  } finally {
    await stopServer(server);
  }
});

test('P1-3: non-2xx responses are surfaced (redirects are not followed)', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(302, { Location: 'http://127.0.0.1:1/inner' });
    res.end();
  });
  try {
    const port = server.address().port;
    const url = new URL('http://localhost:' + port + '/chat/completions');
    const response = await webFetch.requestPinnedStream(url, ['127.0.0.1'], { method: 'POST', body: '{}' });
    // https/http.request 从不跟随重定向 → 3xx 原样返回，由调用方显式拒绝
    assert.equal(response.status, 302);
    assert.equal(response.ok, false);
  } finally {
    await stopServer(server);
  }
});

test('P1-3: gzip responses are decompressed (https.request does not do it)', async () => {
  const server = await startServer((req, res) => {
    const body = zlibGzipSync('data: {"ok":true}\n\n');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Content-Encoding': 'gzip' });
    res.end(body);
  });
  try {
    const port = server.address().port;
    const url = new URL('http://localhost:' + port + '/chat/completions');
    const response = await webFetch.requestPinnedStream(url, ['127.0.0.1'], { method: 'POST', body: '{}' });
    const text = await readAll(response);
    assert.match(text, /data: \{"ok":true\}/, 'gzip body must be transparently decompressed');
    // 已解压后不应再保留会让调用方误判的长度/编码头
    assert.equal(response.headers.get('content-encoding'), null);
  } finally {
    await stopServer(server);
  }
});

test('P1-3: aborting the external signal rejects the pending request', async () => {
  const server = await startServer(() => { /* 永不响应 */ });
  try {
    const port = server.address().port;
    const url = new URL('http://localhost:' + port + '/chat/completions');
    const controller = new AbortController();
    const pending = webFetch.requestPinnedStream(url, ['127.0.0.1'], {
      method: 'POST', body: '{}', signal: controller.signal
    });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending, /请求已取消/);
  } finally {
    await stopServer(server);
  }
});

function zlibGzipSync(s) {
  // eslint-disable-next-line global-require
  return require('node:zlib').gzipSync(Buffer.from(s, 'utf8'));
}
