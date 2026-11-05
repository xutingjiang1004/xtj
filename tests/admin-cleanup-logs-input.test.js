'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const server = fs.readFileSync(path.join(__dirname, '../render-api/server.js'), 'utf8');

function load(calls) {
  const a = server.indexOf("app.post('/admin/cleanup-logs'");
  const b = server.indexOf('// ===================== 审计日志查询', a);
  assert.ok(a > 0 && b > a);
  const handlers = {};
  const ctx = vm.createContext({
    console: { error() {}, warn() {}, log() {} }, Date, JSON, Array, String,
    app: { post(p, ...stack) { handlers[p] = stack[stack.length - 1]; } },
    verifyToken() {}, rateLimit: () => () => {}, ADMIN_USERNAME: 'xxz',
    cleanupOldLogs: async type => { calls.push(type); return { ok: true, attempted: 0, succeeded: 0, failed: 0 }; },
    logAdminAudit: async () => {}
  });
  vm.runInContext(server.slice(a, b), ctx);
  return handlers['/admin/cleanup-logs'];
}
function res() { return { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; } }; }

test('日志清理：缺少请求体或 types 类型不对时返回 400，不泄露内部异常文本，也不执行清理', async () => {
  for (const body of [undefined, { types: { a: 1 } }, { types: 5 }, { types: ['login', 7] }]) {
    const calls = [];
    const r = res();
    await load(calls)({ body }, r);
    assert.equal(r.statusCode, 400, JSON.stringify(body));
    assert.doesNotMatch(JSON.stringify(r.body), /Cannot read|undefined|TypeError/);
    assert.deepEqual(calls, []);
  }
});

test('日志清理：合法 types 与缺省 types 行为不变', async () => {
  let calls = [];
  let r = res();
  await load(calls)({ body: {} }, r);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(calls, ['login', 'security', 'error', 'behavior']);
  calls = []; r = res();
  await load(calls)({ body: { types: 'error' } }, r);
  assert.deepEqual(calls, ['error']);
  calls = []; r = res();
  await load(calls)({ body: { types: ['login', 'bogus'] } }, r);
  assert.deepEqual(calls, ['login']);
});
