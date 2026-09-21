'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'js', 'core.js'), 'utf8');
const coreMin = fs.readFileSync(path.join(root, 'js', 'core.min.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');

test('protected auth only clears a genuinely expired session', () => {
  // ★ 2026-09-22：刷新失败原因语义收紧。旧实现把 5xx / 网络异常也归到
  //   'unavailable' 并随之返回空 token（上层触发 clearAllAuthState + 弹登录框），
  //   这就是「刷新一下就要重新登录」的直接触发点。现改为：401→'expired'、
  //   403→'forbidden'（二者均确证会话失效，由上层处理）；5xx/409/429/网络异常
  //   改走重试，不再返回失效信号。契约同步为「401 映射 expired、403 映射 forbidden」。
  assert.match(core, /reason:\s*res\.status === 401 \? 'expired' : 'forbidden'/);
  assert.match(core, /if \(_lastRefreshAuthResult\.reason === 'expired'\) \{\s*handleProtectedAuthFailure\(\)/);
  assert.match(core, /reason: 'network_error'/);
});

test('login establishes the HttpOnly refresh-cookie session', () => {
  // 登录走 fetchWithTimeout 并携带 credentials:'include'（HttpOnly refresh-cookie 会话）
  assert.match(core, /fetchWithTimeout\(API_BASE \+ '\/api\/user\/login',[\s\S]*?credentials: 'include'/);
});

test('pin uses the shared protected request with one 401 refresh retry', () => {
  assert.match(core, /window\.xtjProtectedFetch = async function/);
  assert.match(core, /if \(response\.status === 401\) \{[\s\S]*?refreshUserToken\(true\)/);
  assert.match(core, /xtjProtectedFetch\('\/api\/post\/pin'/);
});

test('missing pin RPC (PGRST202/42883) uses the authenticated compatibility path', () => {
  // ★ 审计修复 M13 后的契约：仅"函数/迁移缺失"（PGRST202/42883）才降级 service_role
  //   直写兼容路径；42501（权限不足）/22P02（类型错误）为真实业务错误，禁止降级。
  assert.match(server, /var migrationMissing = rpcError\.code === 'PGRST202'/);
  assert.match(server, /migrationMissing[\s\S]*pinResult[\s\S]*unpinResult/);
  assert.match(server, /unpinResult/);
});

test('deployed minified bundle contains the protected auth fix', () => {
  assert.match(coreMin, /xtjProtectedFetch/);
  assert.match(coreMin, /network_error/);
});
