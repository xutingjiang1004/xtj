'use strict';
// 真实启动 render-api/server.js（死 Supabase 地址、一次性密钥，不触达任何线上服务），
// 验证 SIGTERM 时：先停止接收新连接，在途请求拖住连接时 5 秒内强制收尾，并以退出码 0 结束。
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

test('SIGTERM：有未完成请求拖住连接时，仍在约 5 秒内以 0 退出，且不再接受新连接', { timeout: 60000 }, async () => {
  const port = await freePort();
  const env = {
    ...process.env, NODE_ENV: 'test', PORT: String(port), API_SECRET: 'shutdown-secret-0123456789abcdef0123456789',
    ADMIN_PASSWORD: 'shutdown-admin-password', SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_SERVICE_KEY: 'not-real-service-key',
    SUPABASE_ANON_KEY: 'not-real-anon-key', DEEPSEEK_API_KEY: '', OPENROUTER_API_KEY: ''
  };
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'render-api', 'server.js')], { env, cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', exited = null, exitAt = 0;
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  child.on('exit', (code, signal) => { exited = { code, signal }; exitAt = Date.now(); });
  try {
    let up = false;
    for (let i = 0; i < 80 && exited === null; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.status > 0) { up = true; break; } } catch (_) { /* booting */ }
      await sleep(250);
    }
    assert.ok(up, 'server must start: ' + log.slice(-400));
    // 一个只发了一半请求体的 POST，模拟一直不结束的在途请求。
    const hanging = net.connect(port, '127.0.0.1');
    hanging.on('error', () => {});
    hanging.write('POST /api/user/login HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"a"');
    await sleep(300);
    const sentAt = Date.now();
    child.kill('SIGTERM');
    await sleep(500);
    await assert.rejects(() => new Promise((resolve, reject) => {
      const s = net.connect(port, '127.0.0.1', () => { s.destroy(); resolve(); });
      s.on('error', reject);
    }), 'new connections must be refused while shutting down');
    for (let i = 0; i < 100 && exited === null; i++) await sleep(100);
    hanging.destroy();
    assert.ok(exited, 'process must exit after SIGTERM');
    assert.equal(exited.code, 0, log.slice(-400));
    assert.ok(exitAt - sentAt < 8000, 'shutdown took ' + (exitAt - sentAt) + 'ms');
  } finally {
    if (exited === null) child.kill('SIGKILL');
  }
});
