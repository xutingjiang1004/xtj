'use strict';

// Server-side SSE text pacing (render-api/sse-smooth.js + sse-write.js).
// The pacer only exists to stop a provider burst from being painted in one
// frame; these tests pin down ordering, character-exact delivery, the bounded
// latency and the backpressure handshake.

const assert = require('node:assert/strict');
const test = require('node:test');

const { endSse, writeSse } = require('../render-api/sse-write');
const { createTextPacer } = require('../render-api/sse-smooth');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function createRes(overrides) {
  const res = {
    headersSent: true,
    writableEnded: false,
    destroyed: false,
    _writes: [],
    _sseBuffer: [],
    _sseBufferBytes: 0,
    _sseDrainQueued: false,
    _acceptWrites: true,
    _handlers: new Map(),
    getHeader(name) {
      return String(name).toLowerCase() === 'content-type' ? 'text/event-stream; charset=utf-8' : undefined;
    },
    write(data) { this._writes.push({ at: Date.now(), data }); return this._acceptWrites; },
    flush() {},
    end() { this.writableEnded = true; this._endCalls = (this._endCalls || 0) + 1; },
    destroy() { this.destroyed = true; },
    on() { return this; },
    once(type, fn) {
      const list = this._handlers.get(type) || [];
      list.push(fn);
      this._handlers.set(type, list);
      return this;
    },
    removeListener(type, fn) {
      this._handlers.set(type, (this._handlers.get(type) || []).filter(item => item !== fn));
      return this;
    },
    emit(type) {
      const list = (this._handlers.get(type) || []).slice();
      this._handlers.set(type, []);
      for (const fn of list) fn();
    }
  };
  return Object.assign(res, overrides);
}

function events(res) {
  return res._writes.map(write => JSON.parse(write.data.slice('data: '.length)));
}

function textOf(res, type) {
  return events(res).filter(event => event.type === type).map(event => event.text).join('');
}

async function waitFor(predicate, timeoutMs = 600) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the pacer to finish');
    await delay(4);
  }
}

test('small deltas are written synchronously and never enter the queue', () => {
  const res = createRes();
  const pieces = ['你', '好', '，', '世', '界'];
  for (const piece of pieces) assert.equal(writeSse(res, { type: 'content', text: piece }), true);

  assert.equal(res._writes.length, pieces.length, 'one frame per small delta');
  assert.equal(textOf(res, 'content'), pieces.join(''));
  assert.equal(res._ssePacer.stats.frames, 0, 'no timer tick was needed');
  assert.equal(res._ssePacer.stats.pieces, 0, 'small deltas never enter the queue');
});

test('a large burst is split into frames spread over a short window', async () => {
  const res = createRes();
  const text = '流式输出'.repeat(80); // 320 chars: one provider burst
  writeSse(res, { type: 'content', text });

  assert.equal(res._writes.length, 1, 'the first frame is emitted immediately');
  assert.ok(events(res)[0].text.length <= 48, 'the burst is not written in one frame');

  await delay(280);
  assert.equal(textOf(res, 'content'), text, 'no character is lost or duplicated');
  const frames = events(res);
  assert.ok(frames.length > 4 && frames.length < 40, `expected a handful of frames, saw ${frames.length}`);
  const span = res._writes[res._writes.length - 1].at - res._writes[0].at;
  assert.ok(span >= 60, `frames should be spread over time, saw ${span}ms`);
  assert.equal(res._ssePacer.pending, 0);
});

test('followup tail, text and done keep the exact provider order', async () => {
  const res = createRes({ _aiFollowupEnabled: true });
  const visible = 'A'.repeat(240);
  writeSse(res, { type: 'content', text: visible });
  writeSse(res, { type: 'content', text: '\n<xtj-followups>["继续吗？"]</xtj-followups>' });
  writeSse(res, { type: 'done', content: visible, complete: true, conversation_id: 'c1' });

  const list = events(res);
  assert.equal(list[list.length - 1].type, 'done', 'done is the last event');
  assert.equal(list.filter(event => event.type !== 'done').length, list.length - 1);
  assert.equal(textOf(res, 'content'), visible + '\n', 'the followup marker never leaks');
  assert.deepEqual(list[list.length - 1].followups, ['继续吗？']);
  assert.equal(list[list.length - 1].content, visible);

  await delay(60);
  assert.equal(res._writes.length, list.length, 'nothing trickles out after done');
});

test('non-text events flush queued text before they are written', () => {
  const res = createRes({ _aiFollowupEnabled: false });
  const reasoning = 'R'.repeat(200);
  const content = 'C'.repeat(200);
  writeSse(res, { type: 'reasoning', text: reasoning });
  writeSse(res, { type: 'content', text: content });
  writeSse(res, { type: 'tool_pending', call_id: 'call-1', tool_name: 'search_web' });
  writeSse(res, { type: 'meta', conversation_id: 'c2' });

  const types = events(res).map(event => event.type);
  const firstNonText = types.findIndex(type => type === 'tool_pending');
  assert.ok(firstNonText > 0);
  assert.ok(types.slice(0, firstNonText).every(type => type === 'reasoning' || type === 'content'));
  assert.deepEqual(types.slice(firstNonText), ['tool_pending', 'meta']);
  assert.equal(textOf(res, 'reasoning'), reasoning);
  assert.equal(textOf(res, 'content'), content);
  assert.equal(res._ssePacer.pending, 0, 'the queue is empty right after a non-text event');
});

test('paced frames pause while the SSE writer waits for drain', async () => {
  const res = createRes();
  const text = '背压'.repeat(120); // 240 chars
  res._sseDrainQueued = true;
  writeSse(res, { type: 'content', text });

  await delay(80);
  assert.equal(res._writes.length, 0, 'nothing reaches the socket while stalled');
  assert.equal(res._sseBuffer.length, 0, 'the paced text does not grow the 256KB SSE buffer');
  assert.equal(res._ssePacer.pending, text.length, 'the text is retained in the pacer');

  res._sseDrainQueued = false;
  await waitFor(() => res._ssePacer.pending === 0);
  assert.equal(textOf(res, 'content'), text);
  assert.equal(res._sseBuffer.length, 0);
});

test('endSse flushes the whole queue before ending the response', async () => {
  const res = createRes();
  const text = 'x'.repeat(300);
  writeSse(res, { type: 'content', text });
  const result = await endSse(res);

  assert.equal(result, true);
  assert.equal(textOf(res, 'content'), text);
  assert.equal(res.writableEnded, true);
  assert.equal(res._ssePacer.pending, 0);
});

test('res.finish flushes the remaining queue synchronously', () => {
  const res = createRes();
  const text = '尾'.repeat(200);
  writeSse(res, { type: 'content', text });
  assert.ok(res._ssePacer.pending > 0);

  res.emit('finish');
  assert.equal(res._ssePacer.pending, 0);
  assert.equal(textOf(res, 'content'), text);
});

test('pacing is skipped for responses that are not streaming SSE', () => {
  const res = createRes({ getHeader: () => 'application/json' });
  const text = 'y'.repeat(400);
  writeSse(res, { type: 'content', text });

  assert.equal(res._ssePacer, undefined, 'no queue is created');
  assert.equal(res._writes.length, 1);
  assert.equal(events(res)[0].text, text);
});

test('pacer caps the time spent smoothing one burst', async () => {
  const written = [];
  const pacer = createTextPacer({
    write: payload => { written.push(payload); return true; },
    burstThreshold: 32,
    pieceSize: 16,
    intervalMs: 4,
    maxSmoothingMs: 24,
    maxQueuedChars: 20000
  });
  const text = 'z'.repeat(5000);
  const started = Date.now();
  pacer.push({ type: 'content', text }, 'text');
  assert.ok(written.length >= 1 && written.length < 40, 'a long burst degrades into bigger frames');
  assert.ok(pacer.pending > 0, 'the rest of the burst is still paced');
  await waitFor(() => pacer.pending === 0, 400);

  assert.equal(written.map(payload => payload.text).join(''), text);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 120, `smoothing a single burst took ${elapsed}ms`);
});

test('pacer flushes instead of pacing when the backlog is too large', async () => {
  const written = [];
  const pacer = createTextPacer({
    write: payload => { written.push(payload); return true; },
    canWrite: () => false, // stalled: everything stays in the pacer
    burstThreshold: 32,
    pieceSize: 16,
    intervalMs: 2,
    maxSmoothingMs: 8,
    maxQueuedChars: 100
  });
  const first = 'a'.repeat(80), second = 'b'.repeat(80);
  pacer.push({ type: 'content', text: first }, 'text');
  pacer.push({ type: 'content', text: second }, 'text');

  assert.equal(written.length, 2, 'the overflow is flushed synchronously');
  assert.equal(written.map(payload => payload.text).join(''), first + second);
  assert.equal(pacer.pending, 0);
  pacer.dispose(false);
});

test('split frames stay ordered and never cut a surrogate pair', async () => {
  const written = [];
  const pacer = createTextPacer({
    write: payload => { written.push(payload.text); return true; },
    burstThreshold: 8,
    pieceSize: 2,
    intervalMs: 1,
    maxSmoothingMs: 8
  });
  const text = '😀🙂中'.repeat(20);
  pacer.push({ type: 'content', text }, 'text');
  await waitFor(() => pacer.pending === 0, 400);

  assert.equal(written.join(''), text);
  for (const piece of written) {
    assert.doesNotMatch(piece, /[\uD800-\uDBFF]$/, 'a piece must not end on a high surrogate');
    assert.doesNotMatch(piece, /^[\uDC00-\uDFFF]/, 'a piece must not start on a low surrogate');
  }
});
