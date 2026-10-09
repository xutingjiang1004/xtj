'use strict';
const test=require('node:test');
const assert = require('node:assert/strict');
const { createProfileRecords } = require('../render-api/profile-records');
const { createLocationHistory } = require('../render-api/location-history');
const id = '00000000-0000-4000-8000-000000000010';
const at = '2026-10-09T07:00:00.123456Z';
const missed = '2026-10-09T07:00:00.123400Z';
function setup(factory) {
  const routes = {}, filters = [];
  const router = { use() {}, get(path, ...handlers) { routes[path] = handlers.at(-1); } };
  const q = new Proxy({}, { get(_, key) { if (key === 'then') return resolve => resolve({ data: [], count: 0 }); return (...args) => { if (key === 'or') filters.push(args[0]); return q; }; } });
  factory({ express: { Router: () => router }, supabase: { from: () => q }, authenticateUser() {}, verifyToken() {} });
  return { routes, filters };
}
const response = { set() {}, status() { return this; }, json() {} };
test('keyset queries preserve PostgreSQL microsecond timestamps',async () => {
  const profile = setup(createProfileRecords);
  await profile.routes['/']({ userName: 'audit-fixture', query: { kind: 'likes', before_at: at, before_id: id } }, response);
  const location = setup(createLocationHistory);
  await location.routes['/api/user/location-history']({ userName: 'audit-fixture', query: { cursor: Buffer.from(JSON.stringify({ at, id })).toString('base64url') } }, response);
  for (const [label, filters] of [['profile', profile.filters], ['location', location.filters]]) {
    assert.equal(filters.length, 1);
    assert.ok(filters[0].includes(at));
    assert.ok(filters[0].includes('.123456'));
    // PostgreSQL compares full timestamp precision; this older row falls above
    // the truncated boundary and is excluded by both lt and eq clauses.
    const digits = s => BigInt(s.match(/\.(\d+)/)[1].padEnd(6, '0'));
    assert.ok(digits(missed) < digits(at));
    assert.ok(digits(missed) > digits(new Date(at).toISOString()));

  }
});
