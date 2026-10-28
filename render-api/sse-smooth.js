/**
 * Server-side text pacing for SSE chat streams.
 *
 * Providers deliver assistant text in irregular bursts (commonly 200-800 chars
 * in a single delta). The browser paints a whole burst inside one animation
 * frame, which is what users perceive as "the text appears in chunks / stutters".
 * This pacer spreads a large burst over a short window of small frames on the
 * server, so the client keeps its existing rendering pipeline and simply
 * receives many small deltas instead of a few huge ones.
 *
 * It is deliberately NOT a typing queue:
 *  - a delta at or below `burstThreshold` is written synchronously in the same
 *    call, with no timer involved (steady small chunks keep their natural pace);
 *  - only a burst is paced, and only for at most `maxSmoothingMs` (frames grow
 *    when the backlog grows, and the remainder is flushed when the budget is
 *    spent) — added latency is bounded per burst, not per turn;
 *  - the queue is FIFO, `flush()` writes the remainder synchronously, so a
 *    terminal/non-text event (`done`, `error`, `meta`, tool events, heartbeat)
 *    can never overtake text.
 */
'use strict';

const DEFAULTS = Object.freeze({
  // A delta larger than this is treated as a provider burst and is split.
  burstThreshold: 48,
  // Target characters per smoothed frame (24-40 keeps a 60Hz frame readable).
  pieceSize: 32,
  // ~one animation frame at 60Hz.
  intervalMs: 16,
  // Hard cap on the wall time spent smoothing a single burst.
  maxSmoothingMs: 160,
  // A backlog larger than this is flushed instead of paced (memory/latency cap).
  maxQueuedChars: 4000,
  // Do not schedule a final frame shorter than this; merge it into the previous.
  tailMergeChars: 12
});

function number(value, fallback, min) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

/**
 * Only a live SSE response is eligible: anything else (JSON helper, a closed
 * socket, an already-ended response) is written through untouched.
 */
function isStreamingSse(res) {
  if (!res || typeof res !== 'object' || typeof res.write !== 'function') return false;
  if (res.writableEnded || res.destroyed) return false;
  if (res.headersSent === false) return false;
  if (typeof res.getHeader === 'function') {
    let type = '';
    try { type = String(res.getHeader('Content-Type') || ''); } catch (_) { return false; }
    if (type && !/text\/event-stream/i.test(type)) return false;
  }
  return true;
}

// Never cut a UTF-16 surrogate pair in half: both code units must travel in the
// same frame or the client renders a replacement character for a frame.
function safeCut(text, start, end) {
  if (end <= start) return start;
  if (end >= text.length) return text.length;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) return Math.min(end + 1, text.length);
  return end;
}

/**
 * @param {object} config
 * @param {(payload: object, eventName?: string) => boolean} config.write
 *        Final sink for one frame (must be synchronous and ordered).
 * @param {() => boolean} [config.canWrite]
 *        False while the transport is stalled (backpressure) or closing.
 * @param {object} [config.res]
 *        Optional response: `finish`/`close`/`error` flush and dispose the queue.
 */
function createTextPacer(config) {
  const options = config || {};
  const write = typeof options.write === 'function' ? options.write : null;
  const canWrite = typeof options.canWrite === 'function' ? options.canWrite : () => true;
  const res = options.res && typeof options.res === 'object' ? options.res : null;

  const burstThreshold = number(options.burstThreshold, DEFAULTS.burstThreshold, 1);
  const pieceSize = number(options.pieceSize, DEFAULTS.pieceSize, 1);
  const intervalMs = Math.round(number(options.intervalMs, DEFAULTS.intervalMs, 1));
  const maxSmoothingMs = number(options.maxSmoothingMs, DEFAULTS.maxSmoothingMs, 0);
  const maxQueuedChars = number(options.maxQueuedChars, DEFAULTS.maxQueuedChars, pieceSize);
  const tailMergeChars = number(options.tailMergeChars, DEFAULTS.tailMergeChars, 0);

  const queue = [];
  const stats = { frames: 0, pieces: 0, characters: 0, flushes: 0, dropped: 0 };
  let timer = null;
  let flushing = false;
  let disposed = false;
  let startedAt = 0;

  function queuedCharacters() {
    let total = 0;
    for (let index = 0; index < queue.length; index++) total += queue[index].text.length - queue[index].pos;
    return total;
  }

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function drop() {
    if (queue.length) stats.dropped += queue.length;
    queue.length = 0;
    clearTimer();
    startedAt = 0;
  }

  function detach() {
    if (!res || typeof res.removeListener !== 'function') return;
    res.removeListener('finish', onFinish);
    res.removeListener('close', onClose);
    res.removeListener('error', onClose);
  }

  function schedule(delay) {
    if (disposed || timer || !queue.length) return;
    timer = setTimeout(tick, delay === undefined ? intervalMs : delay);
  }

  // One frame = one shallow copy of the original payload with a text slice, so
  // every other field (conversation_id, call_id, phase, ...) travels unchanged.
  function frame(job, text) {
    return Object.assign({}, job.payload, { [job.key]: text });
  }

  function emitBudget(budget) {
    // Writes at most `budget` characters but always at least one piece, so the
    // queue can never stall. Frames never span two payloads (a content frame is
    // never merged with a reasoning frame) and order is strictly FIFO.
    let left = Math.max(1, budget);
    while (queue.length && left > 0) {
      const job = queue[0];
      const available = job.text.length - job.pos;
      if (available <= 0) { queue.shift(); continue; }
      const end = safeCut(job.text, job.pos, job.pos + Math.min(left, available));
      const text = job.text.slice(job.pos, end);
      job.pos = end;
      left -= text.length;
      if (job.pos >= job.text.length) queue.shift();
      if (!text) continue;
      stats.pieces++;
      stats.characters += text.length;
      let ok = true;
      try { ok = write(frame(job, text), job.eventName) !== false; } catch (_) { ok = false; }
      // The sink refused (stream closed / buffer limit reached): stop pacing.
      if (!ok) { drop(); return false; }
    }
    return true;
  }

  function tick() {
    timer = null;
    if (disposed || !queue.length) return;
    // Backpressure: keep the text in this queue instead of growing the SSE
    // buffer while Node is still waiting for 'drain'.
    if (!canWrite()) { schedule(); return; }
    const elapsed = startedAt ? Date.now() - startedAt : 0;
    if (maxSmoothingMs <= 0 || elapsed >= maxSmoothingMs) { flush(); return; }
    const remaining = queuedCharacters();
    const framesLeft = Math.max(1, Math.floor((maxSmoothingMs - elapsed) / intervalMs));
    let budget = Math.max(pieceSize, Math.ceil(remaining / framesLeft));
    // A 1-3 char tail frame is invisible but costs a full interval: merge it.
    if (remaining - budget < tailMergeChars) budget = remaining;
    stats.frames++;
    if (!emitBudget(budget)) return;
    if (queue.length) schedule();
    else { startedAt = 0; clearTimer(); }
  }

  /** Writes every queued character synchronously, in order. */
  function flush() {
    if (flushing) return queue.length === 0;
    if (!queue.length) { clearTimer(); startedAt = 0; return true; }
    flushing = true;
    stats.flushes++;
    let ok = true;
    try {
      while (queue.length) {
        const job = queue.shift();
        const text = job.pos > 0 ? job.text.slice(job.pos) : job.text;
        job.pos = job.text.length;
        if (!text) continue;
        stats.pieces++;
        stats.characters += text.length;
        if (write(frame(job, text), job.eventName) === false) { ok = false; break; }
      }
    } catch (_) { ok = false; }
    flushing = false;
    if (!ok && queue.length) { stats.dropped += queue.length; queue.length = 0; }
    clearTimer();
    startedAt = 0;
    return ok && queue.length === 0;
  }

  /**
   * Queues one text payload. Returns false only when this pacer cannot handle
   * it (disposed / no sink), so the caller can fall back to a direct write.
   */
  function push(payload, key, eventName) {
    if (disposed || !write) return false;
    const text = payload && key && typeof payload[key] === 'string' ? payload[key] : '';
    // Non-string/empty text keeps the old behaviour (a write, not a queue slot).
    if (!text) { flush(); write(payload, eventName); return true; }
    if (!queue.length && text.length <= burstThreshold) { write(payload, eventName); return true; }
    if (!startedAt) startedAt = Date.now();
    queue.push({ payload, key, text, pos: 0, eventName });
    if (queuedCharacters() > maxQueuedChars) { return flush(); }
    // Emit the first frame immediately so the burst starts without a delay;
    // the remaining frames follow on the interval.
    if (!timer) tick();
    return true;
  }

  function onFinish() { dispose(true); }
  function onClose() { dispose(true); }

  /** Flushes (optional) and permanently stops this pacer. */
  function dispose(flushFirst) {
    if (disposed) return;
    if (flushFirst && !flushing) flush();
    drop();
    disposed = true;
    detach();
  }

  if (res && typeof res.once === 'function') {
    res.once('finish', onFinish);
    res.once('close', onClose);
    res.once('error', onClose);
  }

  return {
    push: push,
    flush: flush,
    dispose: dispose,
    get pending() { return queuedCharacters(); },
    get stats() { return Object.assign({}, stats); }
  };
}

module.exports = { createTextPacer, isStreamingSse, DEFAULTS };
