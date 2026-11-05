'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const server = fs.readFileSync(require('node:path').join(__dirname, '../render-api/server.js'), 'utf8');
function section(start, end) {
  const a = server.indexOf(start), b = server.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return server.slice(a, b);
}

// 内存表：支持 select/eq/or(忽略)/order/limit/insert/update，记录写入。
function fakeDb(tables) {
  const writes = [];
  function builder(table) {
    const eqs = [];
    let op = 'select', payload = null;
    const api = {
      select() { return api; },
      eq(c, v) { eqs.push([c, v]); return api; },
      order() { return api; }, limit() { return api; }, or() { return api; }, gt() { return api; },
      insert(rows) { op = 'insert'; payload = rows; return api; },
      update(p) { op = 'update'; payload = p; return api; },
      then(ok, bad) {
        const matched = tables[table].filter(r => eqs.every(([c, v]) => r[c] === v));
        if (op !== 'select') writes.push({ table, op, payload });
        return Promise.resolve({ data: op === 'select' ? matched : null, error: null }).then(ok, bad);
      }
    };
    return api;
  }
  return { from: builder, writes };
}

function run(start, end, tables) {
  const db = fakeDb(tables);
  const handlers = {};
  const app = { post(path, ...stack) { handlers[path] = stack[stack.length - 1]; } };
  const ctx = vm.createContext({
    console, Date, JSON, Number, Math, String, Promise, app, supabase: db,
    verifyToken() {}, rateLimit: () => () => {}, securityRateLimit: () => () => {},
    ADMIN_USERNAME: 'xxz', MAX_USERNAME_LEN: 50, MAX_REASON_LEN: 200,
    validateString: v => String(v), isProtectedAdminTarget: n => n === 'xxz',
    validateDurationHours: v => ({ value: Number(v) || 0 }),
    sendAdminDbFailure: (res, e) => res.status(503).json({ ok: false, error: e && e.message }),
    revokeAllUserRefreshTokens: async () => {}, logAdminAudit: async () => {}
  });
  vm.runInContext(section('function moderationRecordIsLive', '// ===================== 中间件'), ctx);
  vm.runInContext(section(start, end), ctx);
  return { handlers, db };
}
function res() { return { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; } }; }
const past = new Date(Date.now() - 3600000).toISOString();
const future = new Date(Date.now() + 3600000).toISOString();

const CASES = [
  { name: 'ban', path: '/admin/ban', start: "app.post('/admin/ban'", end: "app.put('/admin/ban/:id/lift'", table: 'bans', body: { user_name: 'bob', duration_hours: 2 } },
  { name: 'mute', path: '/admin/mute', start: "app.post('/admin/mute'", end: "app.put('/admin/mute/:id/lift'", table: 'mutes', body: { user_name: 'bob', duration_hours: 2 } },
  { name: 'blacklist', path: '/admin/blacklist', start: "app.post('/admin/blacklist'", end: "app.put('/admin/blacklist/:id/lift'", table: 'blacklist', body: { user_name: 'bob', duration_hours: 2 } }
];

for (const c of CASES) {
  test(c.name + '：已过期但 is_active 仍为 true 的旧记录不再导致 409，可以重新处置', async () => {
    const tables = { bans: [], mutes: [], blacklist: [] };
    tables[c.table] = [{ id: 1, user_name: 'bob', is_active: true, expires_at: past, banned_at: past }];
    const { handlers, db } = run(c.start, c.end, tables);
    const r = res();
    await handlers[c.path]({ body: c.body, adminName: 'xxz' }, r);
    assert.equal(r.statusCode, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.ok(db.writes.some(w => w.table === c.table), '必须真正写入新的处置记录');
  });

  test(c.name + '：未过期的有效记录仍返回 409，永久记录也不被覆盖', async () => {
    for (const expires_at of [future, null]) {
      const tables = { bans: [], mutes: [], blacklist: [] };
      tables[c.table] = [{ id: 1, user_name: 'bob', is_active: true, expires_at, banned_at: past }];
      const { handlers, db } = run(c.start, c.end, tables);
      const r = res();
      await handlers[c.path]({ body: c.body, adminName: 'xxz' }, r);
      assert.equal(r.statusCode, 409);
      assert.equal(db.writes.length, 0);
    }
  });
}
