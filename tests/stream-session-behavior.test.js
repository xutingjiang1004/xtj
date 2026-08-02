'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const streamSession = require('../render-api/ai-core/stream-session');

function builder(resultFactory) {
  const state = { filters: [] };
  const query = {
    select() { return query; },
    insert() { return query; },
    update() { return query; },
    eq(...args) { state.filters.push(['eq', ...args]); return query; },
    gt(...args) { state.filters.push(['gt', ...args]); return query; },
    order(...args) { state.filters.push(['order', ...args]); return query; },
    limit(...args) { state.filters.push(['limit', ...args]); return query; },
    then(resolve, reject) {
      return Promise.resolve().then(() => resultFactory(state)).then(resolve, reject);
    },
    catch(reject) { return query.then(value => value, reject); }
  };
  return query;
}

function fakeSupabase(resultFactory) {
  let calls = 0;
  return {
    get calls() { return calls; },
    from(table) {
      calls += 1;
      return builder(state => resultFactory(table, state, calls));
    }
  };
}

test.before(() => streamSession.setResumeEnabledForTests(true));
test.after(() => streamSession.setResumeEnabledForTests(false));

test('idempotency query returns query_failed after bounded transient retries', async () => {
  const db = fakeSupabase(() => ({ error: { status: 503, code: 'PGRST503', message: 'temporary outage' } }));
  const result = await streamSession.queryIdempotencyKey(db, 'client-1', 'alice');

  assert.equal(result.state, 'query_failed');
  assert.equal(result.found, false);
  assert.equal(result.retryable, true);
  assert.equal(db.calls, 3);
});

test('idempotency query distinguishes not_found and found without guessing', async () => {
  const emptyDb = fakeSupabase(() => ({ data: [], error: null }));
  const empty = await streamSession.queryIdempotencyKey(emptyDb, 'client-2', 'alice');
  assert.deepEqual({ state: empty.state, found: empty.found, query_failed: empty.query_failed }, {
    state: 'not_found', found: false, query_failed: false
  });

  const row = { stream_id: 'stream-2', user_id: 'alice', status: 'running' };
  const foundDb = fakeSupabase(() => ({ data: [row], error: null }));
  const found = await streamSession.queryIdempotencyKey(foundDb, 'client-2', 'alice');
  assert.equal(found.state, 'found');
  assert.deepEqual(found.data, row);
});

test('updateStreamSession exposes ok/updated and retries temporary failures', async () => {
  const db = fakeSupabase((table, state, call) => call < 3
    ? { error: { status: 503, code: 'PGRST503', message: 'temporary outage' } }
    : { data: [{ stream_id: 'stream-3', status: 'completed' }], error: null });
  const result = await streamSession.updateStreamSession(db, 'stream-3', { status: 'completed' });

  assert.equal(result.ok, true);
  assert.equal(result.updated, true);
  assert.equal(result.data.status, 'completed');
  assert.equal(db.calls, 3);
});

test('updateStreamSession reports zero-row update instead of claiming success', async () => {
  const db = fakeSupabase(() => ({ data: [], error: null }));
  const result = await streamSession.updateStreamSession(db, 'missing-stream', { status: 'completed' });

  assert.equal(result.ok, false);
  assert.equal(result.updated, false);
  assert.equal(result.error.code, 'STREAM_NOT_FOUND');
});

test('event flush exposes failed persistence and never advances last event id', async () => {
  const db = fakeSupabase((table) => table === 'ai_stream_events'
    ? { error: { status: 503, code: 'PGRST503', message: 'event store unavailable' } }
    : { data: [{ stream_id: 'stream-4', status: 'running' }], error: null });
  const logger = streamSession.createEventLogger(db, 'stream-4', 'alice');

  const logged = await logger.logEvent('done', { status: 'completed' }, 17);
  const flushed = await logger.flush();

  assert.equal(logged.failed, 1);
  assert.equal(flushed.failed > 0, true);
  assert.equal(flushed.lastPersistedEventId, 0);
});

test('successful event flush reports durable event id and rejects event id zero', async () => {
  const db = fakeSupabase(() => ({ data: [{ ok: true }], error: null }));
  const logger = streamSession.createEventLogger(db, 'stream-5', 'alice');
  await logger.logEvent('done', { status: 'completed' }, 21);
  const flushed = await logger.flush();
  assert.equal(flushed.failed, 0);
  assert.equal(flushed.lastPersistedEventId, 21);

  const invalid = await streamSession.insertEvent(db, 'stream-5', 'alice', 0, 'done', {});
  assert.equal(invalid.failed, 1);
  assert.equal(invalid.error.code, 'INVALID_EVENT_ID');
});

test('event resume query surfaces database failure instead of returning an empty array', async () => {
  const db = fakeSupabase(() => ({ error: { status: 500, code: 'PGRST500', message: 'query failed' } }));
  const result = await streamSession.getEventsAfter(db, 'stream-6', 0);
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.equal(result.events, null);
});
