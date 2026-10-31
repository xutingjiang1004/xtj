#!/usr/bin/env node
'use strict';
// Boots the real render-api/server.js on a free local port with throw-away secrets and a dead Supabase address (nothing can
// reach the production database), then checks that it starts, answers /health, serves the SPA shell and the public config,
// sets the security headers and refuses protected routes without a login. Exit code 1 when any check fails.
//   node scripts/maintenance/backend-smoke.js
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const port = await freePort();
  const env = {
    ...process.env, NODE_ENV: 'test', PORT: String(port), API_SECRET: 'smoke-secret-0123456789abcdef0123456789', ADMIN_PASSWORD: 'smoke-admin-password',
    SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_SERVICE_KEY: 'smoke-service-key-not-real', SUPABASE_ANON_KEY: 'smoke-anon-key-not-real',
    DEEPSEEK_API_KEY: '', OPENROUTER_API_KEY: '',
  };
  const child = spawn(process.execPath, [path.join('render-api', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  let exited = null;
  child.on('exit', (code) => { exited = code; });

  const origin = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 60 && exited === null; i++) {
    try { const r = await fetch(origin + '/health'); if (r.status > 0) { up = true; break; } } catch (_) { /* not listening yet */ }
    await sleep(500);
  }
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
  check('server starts and listens', up, exited !== null ? `exited with ${exited}` : '');
  if (up) {
    const get = async (p, init) => { try { const r = await fetch(origin + p, init); return { r, text: await r.text().catch(() => '') }; } catch (e) { return { err: e }; } };
    const health = await get('/health');
    // With the dead database address the service reports itself unhealthy (503): answering at all is what matters here.
    check('/health answers (200, or 503 because the smoke database is unreachable)', health.r && [200, 503].includes(health.r.status), health.r ? String(health.r.status) : String(health.err));
    const home = await get('/');
    check('/ serves the SPA shell', home.r && home.r.status === 200 && /<html/i.test(home.text), home.r ? String(home.r.status) : String(home.err));
    const hdrs = home.r ? home.r.headers : new Headers();
    check('security headers are set (CSP, nosniff)', hdrs.get('content-security-policy') && /nosniff/i.test(hdrs.get('x-content-type-options') || ''), `csp=${!!hdrs.get('content-security-policy')} nosniff=${hdrs.get('x-content-type-options')}`);
    const cfg = await get('/api/config/public');
    check('/api/config/public answers', cfg.r && cfg.r.status < 500, cfg.r ? String(cfg.r.status) : String(cfg.err));
    const secret = await get('/.env');
    check('/.env is refused', secret.r && secret.r.status >= 400, secret.r ? String(secret.r.status) : String(secret.err));
    const src = await get('/render-api/server.js');
    check('server source is not served', src.r && src.r.status >= 400, src.r ? String(src.r.status) : String(src.err));
    const noAuth = await get('/api/admin/users');
    check('admin route without login is refused', noAuth.r && [401, 403, 404].includes(noAuth.r.status), noAuth.r ? String(noAuth.r.status) : String(noAuth.err));
    const badJson = await get('/api/feed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    check('malformed JSON does not crash the server', badJson.r && badJson.r.status < 600, badJson.r ? String(badJson.r.status) : String(badJson.err));
    const again = await get('/health');
    check('server still alive after the checks', again.r && [200, 503].includes(again.r.status), again.r ? String(again.r.status) : String(again.err));
  }
  child.kill('SIGTERM');
  await sleep(500);
  if (exited === null) child.kill('SIGKILL');

  let failed = 0;
  for (const r of results) { if (!r.ok) failed += 1; console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : '  ' + r.detail}`); }
  if (failed || !up) console.log('--- server output (last 1200 chars)\n' + log.slice(-1200));
  console.log(failed ? `backend smoke: ${failed} failed` : 'backend smoke: all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
