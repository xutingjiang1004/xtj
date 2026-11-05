'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { readPostViewers, VIEW_SCAN_LIMIT } = require('../render-api/post-viewers');

function fakeDb(rows, error) {
  const calls = { filters: [], limit: null };
  const query = {
    select() { return query; },
    eq(column, value) { calls.filters.push([column, value]); return query; },
    order() { return query; },
    limit(n) { calls.limit = n; return Promise.resolve(error ? { error } : { data: rows }); }
  };
  return { calls, from(table) { calls.table = table; return query; } };
}
const at = (m) => new Date(Date.UTC(2026, 10, 1, 0, m)).toISOString();

test('viewers are one entry per person, newest visit first, and the total counts people not visits', async () => {
  const db = fakeDb([
    { user_name: 'Bob', created_at: at(50) }, { user_name: 'alice', created_at: at(40) },
    { user_name: 'bob', created_at: at(30) }, { user_name: 'Alice', created_at: at(20) }, { user_name: '  ', created_at: at(10) }, { user_name: 'carol', created_at: at(5) }
  ]);
  const page = await readPostViewers(db, 'p1', { limit: 50 });
  assert.deepEqual(page.data.map(row => row.user_name), ['Bob', 'alice', 'carol']);
  assert.equal(page.count, 3);
  assert.equal(page.has_more, false);
  assert.equal(page.next_cursor, null);
  assert.equal(db.calls.table, 'posts');
  assert.deepEqual(db.calls.filters, [['media_type', '__post_view__'], ['media_url', 'p1']], 'only the view rows of that post');
  assert.equal(db.calls.limit, VIEW_SCAN_LIMIT);
});

test('viewer pages continue from the cursor without repeating or skipping anyone', async () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ user_name: 'u' + i, created_at: at(59 - i) }));
  const seen = [];
  let cursor = null, guard = 0;
  do {
    const page = await readPostViewers(fakeDb(rows), 'p1', { limit: 3, cursor });
    seen.push(...page.data.map(row => row.user_name));
    assert.equal(page.count, 7);
    cursor = page.next_cursor;
  } while (cursor && ++guard < 10);
  assert.deepEqual(seen, rows.map(row => row.user_name));
});

test('a malformed cursor is rejected and a database error is passed through', async () => {
  for (const bad of ['-1', 'abc', '1e3', '12345678', '{"id":1}']) await assert.rejects(() => readPostViewers(fakeDb([]), 'p1', { cursor: bad }), /invalid_cursor/);
  const failure = await readPostViewers(fakeDb([], { message: 'down' }), 'p1', {});
  assert.ok(failure.error, 'the route turns this into a retryable 503');
});

test('the relations route serves views next to likes and comments and reports a total', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
  const route = server.slice(server.indexOf("app.get('/api/post/detail/:id/relations/:kind'"), server.indexOf("app.get('/api/post/detail/:id', optionalAuth"));
  assert.match(route, /\['likes','comments','engagement','views'\]/);
  assert.match(route, /readPostViewers\(supabase,id,/);
  assert.match(route, /total:/);
  assert.match(route, /visibility==='private'&&lookup\.data\.user_name!==/, 'private posts stay hidden before any viewer is read');
});
