// ==================== AI Core: Stream Session Persistence ====================
// Persists SSE stream sessions and events to Supabase for resume capability.
// Feature flag: CODE_STREAM_RESUME_ENABLED
'use strict';

var STREAM_RESUME_TTL_MS = 60 * 60 * 1000;
var RESUME_ENABLED = false;
var MAX_PERSISTENCE_ATTEMPTS = 3;
var RETRYABLE_HTTP_STATUSES = [408, 429, 500, 502, 503, 504];

var classifySupabaseError = require('../db-result.js').classifySupabaseError;

function isResumeEnabled() {
  if (RESUME_ENABLED) return true;
  return String(process.env.CODE_STREAM_RESUME_ENABLED || '0') === '1';
}

function setResumeEnabledForTests(enabled) {
  RESUME_ENABLED = enabled === true;
}

// Keep the public backoff contract stable. Persistence operations use a
// shorter bounded delay so a request is not held for seconds on a transient
// database response, while still making repeated attempts observable.
function getBackoffDelay(retryCount) {
  return Math.min(1000 * Math.pow(2, retryCount), 30000);
}

function getPersistenceRetryDelay(retryCount) {
  return Math.min(25 * Math.pow(2, retryCount), 250);
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function getErrorStatus(error) {
  var value = error && (
    error.status || error.statusCode || error.httpStatus ||
    (error.response && (error.response.status || error.response.statusCode))
  );
  var status = Number(value);
  return Number.isFinite(status) ? status : 0;
}

function isRetryableHttpStatus(status) {
  return RETRYABLE_HTTP_STATUSES.indexOf(Number(status)) >= 0;
}

function classifyPersistenceError(error, fallbackCode) {
  var classified = classifySupabaseError(error || { code: fallbackCode || 'UNKNOWN', message: 'Persistence operation failed' });
  var status = getErrorStatus(error);
  var retryable = isRetryableHttpStatus(status) || classified.retryable === true;
  var details = Object.assign({}, classified.error || {}, {
    code: (classified.error && classified.error.code) || fallbackCode || 'UNKNOWN',
    message: (classified.error && classified.error.message) || 'Persistence operation failed'
  });
  if (status) details.status = status;
  return { retryable: retryable, error: details };
}

function emptySuccessResult() {
  return {
    ok: true,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    retryable: false,
    error: null
  };
}

function errorWriteResult(error, eventId) {
  var classified = classifyPersistenceError(error, 'PERSISTENCE_ERROR');
  return {
    ok: false,
    attempted: 1,
    succeeded: 0,
    failed: 1,
    retryable: classified.retryable,
    error: classified.error,
    eventId: eventId
  };
}

function aggregateWriteResults(results, lastPersistedEventId) {
  var aggregate = {
    ok: true,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    retryable: false,
    error: null,
    lastPersistedEventId: Number(lastPersistedEventId) || 0
  };
  (results || []).forEach(function(result) {
    if (!result) return;
    aggregate.attempted += Number(result.attempted) || 0;
    aggregate.succeeded += Number(result.succeeded) || 0;
    aggregate.failed += Number(result.failed) || 0;
    if (result.retryable === true) aggregate.retryable = true;
    if (!aggregate.error && result.error) aggregate.error = result.error;
  });
  aggregate.ok = aggregate.failed === 0 && !aggregate.error;
  return aggregate;
}

// Runs a read or idempotent update with a strict attempt limit. The query
// factory is rebuilt for each attempt because Supabase query builders are
// mutable and must not be reused after they have been awaited.
function runPersistenceQuery(queryFactory) {
  var attempt = 0;

  function run() {
    attempt += 1;
    var query;
    try {
      query = queryFactory();
    } catch (error) {
      return handleFailure(error);
    }
    return Promise.resolve(query).then(function(result) {
      if (result && result.error) return handleFailure(result.error);
      return { ok: true, data: result && result.data, attempts: attempt };
    }, handleFailure);
  }

  function handleFailure(error) {
    var classified = classifyPersistenceError(error, 'PERSISTENCE_QUERY_FAILED');
    if (classified.retryable && attempt < MAX_PERSISTENCE_ATTEMPTS) {
      return sleep(getPersistenceRetryDelay(attempt - 1)).then(run);
    }
    return {
      ok: false,
      data: null,
      attempts: attempt,
      retryable: classified.retryable,
      error: classified.error
    };
  }

  return run();
}

function normalizeRows(data) {
  if (Array.isArray(data)) return data;
  return data ? [data] : [];
}

function notFoundResult() {
  return {
    ok: true,
    state: 'not_found',
    found: false,
    not_found: true,
    query_failed: false,
    data: null,
    retryable: false,
    error: null
  };
}

function foundResult(data) {
  return {
    ok: true,
    state: 'found',
    found: true,
    not_found: false,
    query_failed: false,
    data: data,
    retryable: false,
    error: null
  };
}

function queryFailedResult(error, attempts) {
  var classified = classifyPersistenceError(error, 'PERSISTENCE_QUERY_FAILED');
  // A query failure is always retryable at the API boundary. The database
  // classifier may call a permission/schema error non-retryable, but callers
  // still must not turn an unknown query result into a new provider request.
  return {
    ok: false,
    state: 'query_failed',
    found: false,
    not_found: false,
    query_failed: true,
    retryable: true,
    db_retryable: classified.retryable,
    attempts: attempts || 1,
    data: null,
    error: classified.error
  };
}

// ==================== Idempotency query ====================

function queryIdempotencyKey(supabase, key, userId) {
  if (!isResumeEnabled() || !supabase || !key) return Promise.resolve(notFoundResult());
  return runPersistenceQuery(function() {
    var query = supabase.from('ai_stream_sessions').select('*')
      .eq('client_request_id', String(key));
    if (userId) query = query.eq('user_id', String(userId));
    return query.order('created_at', { ascending: false }).limit(1);
  }).then(function(result) {
    if (!result.ok) return queryFailedResult(result.error, result.attempts);
    var rows = normalizeRows(result.data);
    return rows[0] ? foundResult(rows[0]) : notFoundResult();
  });
}

// ==================== Session CRUD ====================

function createStreamSession(supabase, params) {
  params = params || {};
  if (!isResumeEnabled() || !supabase) {
    return Promise.resolve({
      ok: false,
      updated: false,
      retryable: false,
      error: { code: 'DISABLED', message: 'Stream resume is not enabled' }
    });
  }
  if (!params.userId || !params.streamId) {
    return Promise.resolve({
      ok: false,
      updated: false,
      retryable: false,
      error: { code: 'INVALID_SESSION', message: 'userId and streamId are required' }
    });
  }

  var payload = {
    user_id: String(params.userId),
    stream_id: String(params.streamId),
    request_id: String(params.requestId || ''),
    client_request_id: String(params.clientRequestId || ''),
    conversation_id: String(params.conversationId || ''),
    workspace_id: String(params.workspaceId || ''),
    workspace_generation: Number(params.workspaceGeneration || 0),
    status: 'running',
    last_event_id: 0,
    started_at: params.startedAt || new Date().toISOString(),
    expires_at: new Date(Date.now() + STREAM_RESUME_TTL_MS).toISOString()
  };

  var query;
  try {
    query = supabase.from('ai_stream_sessions').insert(payload).select('*');
  } catch (error) {
    var thrown = classifyPersistenceError(error, 'SESSION_CREATE_FAILED');
    return Promise.resolve({ ok: false, updated: false, retryable: thrown.retryable, error: thrown.error });
  }
  return Promise.resolve(query).then(function(result) {
    if (result && result.error) {
      var classified = classifyPersistenceError(result.error, 'SESSION_CREATE_FAILED');
      console.error('[stream-session] create session failed:', classified.error.message);
      return { ok: false, updated: false, retryable: classified.retryable, error: classified.error };
    }
    var rows = normalizeRows(result && result.data);
    var session = rows[0] || null;
    if (!session) {
      return {
        ok: false,
        updated: false,
        retryable: true,
        error: { code: 'EMPTY_RESULT', message: 'No session data returned' }
      };
    }
    return { ok: true, updated: true, retryable: false, error: null, data: session };
  }).catch(function(error) {
    var classified = classifyPersistenceError(error, 'SESSION_CREATE_FAILED');
    console.error('[stream-session] create session error:', classified.error.message);
    return { ok: false, updated: false, retryable: classified.retryable, error: classified.error };
  });
}

function updateStreamSession(supabase, streamId, updates, conditions) {
  conditions = conditions || {};
  if (!isResumeEnabled() || !supabase) {
    return Promise.resolve({
      ok: false,
      updated: false,
      retryable: false,
      error: { code: 'DISABLED', message: 'Stream resume is not enabled' }
    });
  }
  if (!streamId) {
    return Promise.resolve({
      ok: false,
      updated: false,
      retryable: false,
      error: { code: 'INVALID_STREAM_ID', message: 'streamId is required' }
    });
  }
  var payload = Object.assign({ updated_at: new Date().toISOString() }, updates || {});
  return runPersistenceQuery(function() {
    var query = supabase.from('ai_stream_sessions').update(payload).select('*')
      .eq('stream_id', String(streamId));
    if (conditions.expectedStatus) query = query.eq('status', String(conditions.expectedStatus));
    if (conditions.expectedLastEventId !== undefined && conditions.expectedLastEventId !== null) {
      query = query.eq('last_event_id', Number(conditions.expectedLastEventId) || 0);
    }
    return query;
  }).then(function(result) {
    if (!result.ok) {
      return {
        ok: false,
        updated: false,
        retryable: result.retryable === true,
        error: result.error,
        attempts: result.attempts
      };
    }
    var rows = normalizeRows(result.data);
    if (!rows[0]) {
      return {
        ok: false,
        updated: false,
        retryable: false,
        error: { code: 'STREAM_NOT_FOUND', message: 'Stream session was not updated because no row matched' },
        attempts: result.attempts
      };
    }
    if (payload.status && String(rows[0].status || '') !== String(payload.status)) {
      return {
        ok: false,
        updated: false,
        retryable: false,
        error: { code: 'STREAM_STATE_CONFLICT', message: 'Stream session terminal state changed concurrently' },
        attempts: result.attempts,
        data: rows[0]
      };
    }
    if (payload.last_event_id !== undefined && Number(rows[0].last_event_id) !== Number(payload.last_event_id)) {
      return {
        ok: false,
        updated: false,
        retryable: false,
        error: { code: 'STREAM_EVENT_STATE_CONFLICT', message: 'Stream session event cursor was not confirmed' },
        attempts: result.attempts,
        data: rows[0]
      };
    }
    return {
      ok: true,
      updated: true,
      retryable: false,
      error: null,
      data: rows[0],
      attempts: result.attempts
    };
  });
}

function getStreamSession(supabase, streamId) {
  if (!isResumeEnabled() || !supabase) return Promise.resolve(notFoundResult());
  return runPersistenceQuery(function() {
    return supabase.from('ai_stream_sessions').select('*')
      .eq('stream_id', String(streamId))
      .limit(1);
  }).then(function(result) {
    if (!result.ok) return queryFailedResult(result.error, result.attempts);
    var rows = normalizeRows(result.data);
    return rows[0] ? foundResult(rows[0]) : notFoundResult();
  });
}

function getStreamSessionByClientRequestId(supabase, userId, clientRequestId) {
  return queryIdempotencyKey(supabase, clientRequestId, userId);
}

function getStreamSessions(supabase, userId, filters) {
  filters = filters || {};
  if (!isResumeEnabled() || !supabase) {
    return Promise.resolve({ ok: true, sessions: [], retryable: false, error: null });
  }
  return runPersistenceQuery(function() {
    var query = supabase.from('ai_stream_sessions').select('*')
      .eq('user_id', String(userId))
      .order('started_at', { ascending: false })
      .limit(Number(filters.limit) || 10);
    if (filters.workspaceId) query = query.eq('workspace_id', String(filters.workspaceId));
    if (filters.workspaceGeneration) query = query.eq('workspace_generation', Number(filters.workspaceGeneration));
    if (filters.conversationId) query = query.eq('conversation_id', String(filters.conversationId));
    if (filters.clientRequestId) query = query.eq('client_request_id', String(filters.clientRequestId));
    return query;
  }).then(function(result) {
    if (!result.ok) {
      return { ok: false, sessions: null, retryable: true, error: result.error, attempts: result.attempts };
    }
    return { ok: true, sessions: normalizeRows(result.data), retryable: false, error: null, attempts: result.attempts };
  });
}

// ==================== Event persistence ====================

var PERSISTABLE_EVENT_TYPES = new Set([
  'accepted', 'planning', 'status', 'tool_start', 'tool_result',
  'answer_start', 'answer_delta', 'operation_preview',
  'usage', 'warning', 'done', 'error', 'cancelled'
]);
var DELTA_FLUSH_INTERVAL_MS = 300;
var DELTA_FLUSH_MIN_CHARS = 200;

function eventDataEquals(a, b) {
  if (a === b) return true;
  // 深度比较而非 JSON.stringify：JSONB 回读不保证键序，键序不同但内容相同的
  // 对象（{a:1,b:2} vs {b:2,a:1}）必须判定相等，否则幂等写入会被误判为冲突
  // 而重新申请 ID 重复落库。深度上限 5 防深嵌套爆栈，超深时退化为键序无关的
  // 规范序列化比较。
  return deepEquals(a, b, 0);
}

function deepEquals(a, b, depth) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (depth >= 5) return canonicalJson(a) === canonicalJson(b);
  var ak = Object.keys(a);
  var bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (var i = 0; i < ak.length; i++) {
    var k = ak[i];
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEquals(a[k], b[k], depth + 1)) return false;
  }
  return true;
}

// 键序无关的规范序列化：对象键排序后输出，用于超深结构的兜底比较
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    var items = [];
    for (var i = 0; i < value.length; i++) items.push(canonicalJson(value[i]));
    return '[' + items.join(',') + ']';
  }
  var keys = Object.keys(value).sort();
  var parts = [];
  for (var j = 0; j < keys.length; j++) {
    parts.push(JSON.stringify(keys[j]) + ':' + canonicalJson(value[keys[j]]));
  }
  return '{' + parts.join(',') + '}';
}

function readStoredEventForCompare(supabase, streamId, eventId) {
  return supabase.from('ai_stream_events').select('event_data')
    .eq('stream_id', String(streamId))
    .eq('event_id', Number(eventId))
    .limit(1)
    .then(function(prev) {
      if (prev && prev.error) return null; // 读回失败按"内容不一致"处理，走重新申请分支
      var rows = normalizeRows(prev && prev.data);
      return rows[0] && rows[0].event_data != null ? rows[0].event_data : null;
    });
}

function insertEvent(supabase, streamId, userId, eventId, type, data, allocator, depth) {
  depth = Number(depth) || 0;
  if (!supabase || Number(eventId) <= 0) {
    return Promise.resolve(errorWriteResult({ code: 'INVALID_EVENT_ID', message: 'event_id must be greater than zero' }, eventId));
  }
  var query;
  try {
    query = supabase.from('ai_stream_events').insert({
      user_id: String(userId),
      stream_id: String(streamId),
      event_id: Number(eventId),
      event_type: type,
      event_data: data || {},
      expires_at: new Date(Date.now() + STREAM_RESUME_TTL_MS).toISOString()
    });
  } catch (error) {
    return Promise.resolve(errorWriteResult(error, eventId));
  }
  return Promise.resolve(query).then(function(result) {
    if (result && result.error) {
      // 23505 仅在写入内容与已存一致时才视为幂等成功。分片/后续事件可能复用
      // 了同一 event_id 且内容不同，此时必须重新申请新 ID 追加，禁止静默丢事件。
      if (String(result.error.code || '') === '23505') {
        return readStoredEventForCompare(supabase, streamId, eventId).then(function(stored) {
          if (stored !== null && eventDataEquals(stored, data)) {
            return { ok: true, attempted: 1, succeeded: 1, failed: 0, retryable: false, error: null, eventId: eventId, idempotent: true };
          }
          var freshId = allocator ? allocator() : 0;
          if (freshId && Number(freshId) > 0 && Number(freshId) !== Number(eventId)) {
            if (depth >= 5) {
              return {
                ok: false, attempted: 1, succeeded: 0, failed: 1, retryable: true,
                error: { code: 'EVENT_ID_COLLISION', message: 'event_id keeps colliding with different content' },
                eventId: eventId
              };
            }
            return insertEvent(supabase, streamId, userId, freshId, type, data, allocator, depth + 1);
          }
          return {
            ok: false, attempted: 1, succeeded: 0, failed: 1, retryable: true,
            error: { code: 'EVENT_ID_COLLISION', message: 'event_id collision with different content; no fresh id available' },
            eventId: eventId
          };
        });
      }
      var classified = classifyPersistenceError(result.error, 'EVENT_INSERT_FAILED');
      return {
        ok: false,
        attempted: 1,
        succeeded: 0,
        failed: 1,
        retryable: classified.retryable,
        error: classified.error,
        eventId: eventId
      };
    }
    return { ok: true, attempted: 1, succeeded: 1, failed: 0, retryable: false, error: null, eventId: eventId };
  }).catch(function(error) {
    return errorWriteResult(error, eventId);
  });
}

function createEventLogger(supabase, streamId, userId) {
  if (!isResumeEnabled() || !supabase) {
    return {
      logEvent: function() { return Promise.resolve(emptySuccessResult()); },
      flush: function() { return Promise.resolve(Object.assign(emptySuccessResult(), { lastPersistedEventId: 0 })); },
      flushDeltas: function() { return Promise.resolve(emptySuccessResult()); },
      getEvents: function() { return Promise.resolve([]); }
    };
  }

  var pendingDeltas = [];
  var lastFlushTime = 0;
  var flushTimer = null;
  var flushed = false;
  var pendingWriteTasks = [];
  var writeTaskStats = { total: 0, succeeded: 0, failed: 0, retryable: false, lastError: null };
  var writeChain = Promise.resolve();
  var flushPromise = null;
  var lastDeltaEventId = 0;
  var lastPersistedEventId = 0;
  var lastIssuedEventId = 0;
  var lastAllocatedEventId = 0;

  // 连续事件 ID 分配器：起点取已签发/已持久化 ID 的最大值，保证分片等
  // 合成 ID 与 SSE writer 的后续事件 ID 不重叠。
  function allocateNextEventId() {
    var next = Math.max(
      Number(lastIssuedEventId) || 0,
      Number(lastPersistedEventId) || 0,
      Number(lastAllocatedEventId) || 0
    ) + 1;
    lastAllocatedEventId = next;
    return next;
  }

  function persistEvent(eventId, type, data) {
    return insertEvent(supabase, streamId, userId, eventId, type, sanitizeEventData(type, data), allocateNextEventId).then(function(result) {
      if (result && result.succeeded > 0) {
        // 冲突重申请时 eventId 可能被更换，以实际落库的 ID 为准
        lastPersistedEventId = Math.max(lastPersistedEventId, Number(result.eventId || eventId) || 0);
      }
      return result;
    });
  }

  // 长_delta 分片：每片最多 8000 字符，严格递增 event_id
  var DELTA_SHARD_MAX_CHARS = 8000;
  function persistCombinedDelta(eventId, combined) {
    if (combined.length <= DELTA_SHARD_MAX_CHARS) {
      return persistEvent(eventId, 'answer_delta', { delta: combined }).then(function(result) {
        if (result && result.failed > 0) pendingDeltas.unshift(combined);
        return result;
      });
    }
    // 分片写入：每片独立 event_id，严格递增。分片 ID 从分配器申请连续 ID
    // （而非 baseId+idx），避免与 SSE writer 后续事件 ID 碰撞后 23505 静默吞事件。
    var shards = [];
    for (var i = 0; i < combined.length; i += DELTA_SHARD_MAX_CHARS) {
      shards.push(combined.slice(i, i + DELTA_SHARD_MAX_CHARS));
    }
    var shardIds = [];
    for (var s = 0; s < shards.length; s++) {
      shardIds.push(allocateNextEventId());
    }
    var shardPromises = shards.map(function(shard, idx) {
      return persistEvent(shardIds[idx], 'answer_delta', { delta: shard });
    });
    return Promise.all(shardPromises).then(function(results) {
      var totalFailed = results.reduce(function(n, r) { return n + (r && r.failed || 0); }, 0);
      if (totalFailed > 0) pendingDeltas.unshift(combined);
      var lastShardId = shardIds[shardIds.length - 1] || Number(eventId) || 0;
      return aggregateWriteResults(results, lastShardId);
    });
  }

  function flushPendingDeltasInternal() {
    if (pendingDeltas.length === 0) return Promise.resolve(emptySuccessResult());
    var combined = pendingDeltas.join('');
    pendingDeltas = [];
    lastFlushTime = 0;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    // The event id belongs to the last delta that created this batch. It is
    // already allocated by the SSE writer, so no synthetic id can collide
    // with a later done/error event.
    var eventId = Number(lastDeltaEventId) || Math.max(Number(lastIssuedEventId) || 0, lastPersistedEventId) + 1;
    return persistCombinedDelta(eventId, combined);
  }

  function enqueue(operation) {
    var task = writeChain.then(operation, operation).catch(function(error) {
      return errorWriteResult(error, 0);
    });
    writeChain = task;
    pendingWriteTasks.push(task);
    // 任务 settle 后从数组移除自身，只保留计数与最近错误摘要，避免长流内存累积
    task.then(function(result) {
      var idx = pendingWriteTasks.indexOf(task);
      if (idx >= 0) pendingWriteTasks.splice(idx, 1);
      writeTaskStats.total += 1;
      var failed = !!(result && (result.failed > 0 || result.error));
      if (failed) {
        writeTaskStats.failed += 1;
        writeTaskStats.lastError = (result && result.error) || { code: 'WRITE_FAILED', message: 'write task failed' };
        if (result && result.retryable === true) writeTaskStats.retryable = true;
      } else {
        writeTaskStats.succeeded += 1;
      }
    }, function() {
      var idx = pendingWriteTasks.indexOf(task);
      if (idx >= 0) pendingWriteTasks.splice(idx, 1);
      writeTaskStats.total += 1;
      writeTaskStats.failed += 1;
      writeTaskStats.lastError = { code: 'WRITE_FAILED', message: 'write task rejected' };
    });
    return task;
  }

  function collectWriteTasks() {
    var tasks = pendingWriteTasks;
    pendingWriteTasks = [];
    return Promise.all(tasks);
  }

  function buildWriteAggregate() {
    // 用"计数 + 最近错误摘要"代替完整任务结果数组，内存恒定
    var pseudo = {
      attempted: writeTaskStats.total,
      succeeded: writeTaskStats.succeeded,
      failed: writeTaskStats.failed,
      retryable: writeTaskStats.retryable,
      error: writeTaskStats.lastError
    };
    var result = aggregateWriteResults([pseudo], lastPersistedEventId);
    result.lastPersistedEventId = lastPersistedEventId;
    return result;
  }

  function logEvent(type, data, eventId) {
    if (!PERSISTABLE_EVENT_TYPES.has(type)) return Promise.resolve(emptySuccessResult());
    if (Number(eventId) > lastIssuedEventId) lastIssuedEventId = Number(eventId);
    flushed = false;

    if (type === 'answer_delta') {
      var delta = data && data.delta ? String(data.delta) : '';
      if (!delta) return Promise.resolve(emptySuccessResult());
      pendingDeltas.push(delta);
      lastDeltaEventId = Number(eventId) || lastDeltaEventId;
      var now = Date.now();
      if (lastFlushTime === 0) lastFlushTime = now;
      if (pendingDeltas.join('').length >= DELTA_FLUSH_MIN_CHARS || now - lastFlushTime >= DELTA_FLUSH_INTERVAL_MS) {
        return enqueue(flushPendingDeltasInternal);
      }
      return Promise.resolve(emptySuccessResult());
    }

    return enqueue(function() {
      return flushPendingDeltasInternal().then(function(deltaResult) {
        if (deltaResult && deltaResult.failed > 0) return deltaResult;
        return persistEvent(eventId, type, data);
      });
    });
  }

  function flush() {
    if (flushPromise) return flushPromise;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushPromise = (async function() {
      await writeChain;
      await collectWriteTasks(); // 在途任务 settle 后其统计已并入 writeTaskStats
      if (pendingDeltas.length > 0) {
        await enqueue(flushPendingDeltasInternal);
        await writeChain;
        await collectWriteTasks();
      }
      var result = buildWriteAggregate();
      flushed = result.failed === 0 && pendingDeltas.length === 0;
      return result;
    })().then(function(result) {
      flushPromise = null;
      return result;
    }, function(error) {
      flushPromise = null;
      var failure = errorWriteResult(error, 0);
      failure.lastPersistedEventId = lastPersistedEventId;
      flushed = false;
      return failure;
    });
    return flushPromise;
  }

  function flushDeltas() {
    if (pendingDeltas.length === 0) return Promise.resolve(emptySuccessResult());
    return enqueue(flushPendingDeltasInternal);
  }

  return {
    logEvent: logEvent,
    flush: flush,
    flushDeltas: flushDeltas,
    getEvents: function() { return getEventsAfter(supabase, streamId, 0); }
  };
}

function sanitizeEventData(type, data) {
  if (!data || typeof data !== 'object') return {};
  // 敏感键判定：显式清单 + 高信号后缀匹配，禁止裸子串 'key'
  // （旧实现 indexOf('key') 会误伤 monkey/keyboard/keyCode/keyframes/hockey/key_name）。
  // 规范化：小写 + 去 [-_]。判定 = 精确命中清单，或以 token/secret/password 等
  // 高信号后缀结尾；'key' 只允许精确键名（apiKey/accessKey/secretKey 等）命中。
  // 审计 ⚪ 文档说明：'auth' 作为精确敏感键——嵌套对象里 { auth: {...} } 会被整体
  // [redacted]。对事件完整性是安全取舍：宁可误伤业务 auth 字段，也不能让凭据结构泄漏。
  var SENSITIVE_KEY_EXACT = [
    'key', 'apikey', 'accesskey', 'secretkey', 'privatekey', 'sessionkey',
    'token', 'accesstoken', 'apitoken', 'refreshtoken', 'idtoken', 'awssessiontoken',
    'secret', 'clientsecret', 'secretid',
    'password', 'passwd', 'pwd', 'passphrase',
    'authorization', 'auth', 'bearer', 'cookie', 'cookies', 'session',
    'credential', 'credentials', 'awsaccesskeyid', 'awssecretaccesskey'
  ];
  var SENSITIVE_KEY_SUFFIXES = [
    'token', 'secret', 'password', 'passwd', 'passphrase',
    'credential', 'authorization', 'bearer',
    'apikey', 'accesskey', 'secretkey', 'privatekey', 'sessionkey'
  ];
  function isSensitiveKey(key) {
    var normalizedKey = String(key).replace(/[-_]/g, '').toLowerCase();
    if (SENSITIVE_KEY_EXACT.indexOf(normalizedKey) >= 0) return true;
    for (var i = 0; i < SENSITIVE_KEY_SUFFIXES.length; i++) {
      var suffix = SENSITIVE_KEY_SUFFIXES[i];
      if (normalizedKey.length > suffix.length &&
          normalizedKey.slice(-suffix.length) === suffix) return true;
    }
    return false;
  }
  // 值级正则脱敏：Bearer token、sk-、GitHub token、私钥块等
  var VALUE_SENSITIVE_PATTERNS = [
    /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
    /sk-[A-Za-z0-9]{8,}/gi,
    /gh[pousr]_[A-Za-z0-9]{16,}/gi,
    /-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH|PGP)\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA|EC|DSA|OPENSSH|PGP)\s+PRIVATE\s+KEY-----/gi,
    /(?:api[_-]?key|access[_-]?key|client[_-]?secret)\s*[:=]\s*['"][A-Za-z0-9_\-.]{12,}['"]/gi
  ];
  function maskSensitiveValues(value) {
    var out = value;
    for (var i = 0; i < VALUE_SENSITIVE_PATTERNS.length; i++) {
      out = out.replace(VALUE_SENSITIVE_PATTERNS[i], function(match) {
        return String(match).slice(0, 8) + '...[redacted]';
      });
    }
    return out;
  }
  function sanitizeValue(key, value, depth, seen) {
    // L6 修复：递归过滤嵌套对象/数组中的敏感键，避免 data.tool_result 等嵌套结构里的
    // apiKey/token 等泄漏到持久化事件中。depth<=8 与 WeakSet 循环检测防止深嵌套/环状结构爆栈。
    depth = Number(depth) || 0;
    seen = seen || new WeakSet();
    if (depth > 8) return '[max-depth]';
    if (typeof value === 'string') {
      var masked = maskSensitiveValues(value);
      if (masked !== value) return masked;
      if (isSensitiveKey(key) || value.length > 10000) {
        return value.slice(0, 10000) + '...[truncated]';
      }
      return value;
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) return '[circular]';
      seen.add(value);
      var arr = value.map(function(item, idx) { return sanitizeValue(String(idx), item, depth + 1, seen); });
      seen.delete(value);
      return arr;
    }
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[circular]';
      seen.add(value);
      var out = {};
      try {
        Object.keys(value).forEach(function(k) {
          if (isSensitiveKey(k)) { out[k] = '[redacted]'; return; }
          out[k] = sanitizeValue(k, value[k], depth + 1, seen);
        });
      } catch (_) { out = null; }
      seen.delete(value);
      return out;
    }
    return value;
  }
  var sanitized = {};
  Object.keys(data).forEach(function(key) {
    if (isSensitiveKey(key)) { sanitized[key] = '[redacted]'; return; }
    sanitized[key] = sanitizeValue(key, data[key], 0, new WeakSet());
  });
  return sanitized;
}

// ==================== Resume ====================

var RESUME_PAGE_SIZE = 100;
var RESUME_MAX_BYTES = 2 * 1024 * 1024; // 2MB 单次响应字节上限

// 截断单个事件 payload，保证序列化后不超 maxBytes（保留 event_id 以推进游标）
function truncateEventPayload(payload, maxBytes) {
  var json = JSON.stringify(payload);
  if (Buffer.byteLength(json, 'utf8') <= maxBytes) return payload;
  var out;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    out = {};
    Object.keys(payload).forEach(function(k) {
      var v = payload[k];
      if (typeof v === 'string') {
        var bytes = Buffer.byteLength(v, 'utf8');
        if (bytes > maxBytes) {
          var ratio = Math.max(0, (maxBytes * 0.7) / bytes);
          v = v.slice(0, Math.floor(v.length * ratio)) + '...[truncated]';
        }
        out[k] = v;
      } else {
        out[k] = v;
      }
    });
  } else if (typeof payload === 'string') {
    out = payload;
    var b = Buffer.byteLength(payload, 'utf8');
    if (b > maxBytes) {
      var r = Math.max(0, (maxBytes * 0.7) / b);
      out = payload.slice(0, Math.floor(payload.length * r)) + '...[truncated]';
    }
  } else {
    return payload;
  }
  var outJson = JSON.stringify(out);
  if (Buffer.byteLength(outJson, 'utf8') > maxBytes) {
    // 兜底：直接截断 JSON 字符串，保证不超过上限
    var s = outJson;
    while (Buffer.byteLength(s, 'utf8') > maxBytes) s = s.slice(0, Math.floor(s.length * 0.9));
    try { return JSON.parse(s); } catch (_) { return { delta: s }; }
  }
  return out;
}

function getEventsAfter(supabase, streamId, afterEventId, pageSize) {
  if (!isResumeEnabled() || !supabase) return Promise.resolve({ ok: true, events: [], retryable: false, error: null, next_after_event_id: null, has_more: false });
  var limit = Math.min(Math.max(Number(pageSize) || RESUME_PAGE_SIZE, 1), 500);
  return runPersistenceQuery(function() {
    return supabase.from('ai_stream_events').select('event_id, event_type, event_data')
      .eq('stream_id', String(streamId))
      .gt('event_id', Number(afterEventId) || 0)
      .order('event_id', { ascending: true })
      .limit(limit + 1); // 多取 1 条判断 has_more
  }).then(function(result) {
    if (!result.ok) return { ok: false, events: null, retryable: true, error: result.error, attempts: result.attempts, next_after_event_id: null, has_more: false };
    var rows = normalizeRows(result.data);
    var hasMore = rows.length > limit;
    if (hasMore) rows = rows.slice(0, limit);
    var events = rows.map(function(row) {
      return { event_id: row.event_id, stream_id: streamId, type: row.event_type, data: row.event_data || {} };
    });
    // 字节上限检查
    var totalBytes = 0;
    var truncated = false;
    var originalLength = events.length;
    for (var i = 0; i < events.length; i++) {
      var evtSize = Buffer.byteLength(JSON.stringify(events[i].data || {}), 'utf8');
      if (totalBytes + evtSize > RESUME_MAX_BYTES) {
        if (i === 0) {
          // 首条事件本身超限：返回截断版本并推进游标，杜绝 has_more=true 但
          // next_after_event_id=null 的死循环（客户端无法翻页）。
          var tdata = truncateEventPayload(events[0].data || {}, RESUME_MAX_BYTES);
          events = [Object.assign({}, events[0], { data: tdata })];
          totalBytes = Buffer.byteLength(JSON.stringify(tdata || {}), 'utf8');
        } else {
          events = events.slice(0, i);
        }
        truncated = true;
        hasMore = true;
        break;
      }
      totalBytes += evtSize;
    }
    var nextAfterEventId = null;
    if (hasMore && events.length > 0) {
      nextAfterEventId = events[events.length - 1].event_id;
    }
    return {
      ok: true,
      events: events,
      retryable: false,
      error: null,
      attempts: result.attempts,
      next_after_event_id: nextAfterEventId,
      has_more: hasMore,
      truncated: truncated,
      original_length: originalLength
    };
  });
}

function isPersistableEvent(type) {
  return PERSISTABLE_EVENT_TYPES.has(type);
}

module.exports = {
  isResumeEnabled: isResumeEnabled,
  setResumeEnabledForTests: setResumeEnabledForTests,
  createStreamSession: createStreamSession,
  updateStreamSession: updateStreamSession,
  getStreamSession: getStreamSession,
  getStreamSessionByClientRequestId: getStreamSessionByClientRequestId,
  getStreamSessions: getStreamSessions,
  createEventLogger: createEventLogger,
  getEventsAfter: getEventsAfter,
  isPersistableEvent: isPersistableEvent,
  queryIdempotencyKey: queryIdempotencyKey,
  insertEvent: insertEvent,
  getBackoffDelay: getBackoffDelay,
  RETRYABLE_HTTP_STATUSES: RETRYABLE_HTTP_STATUSES,
  STREAM_RESUME_TTL_MS: STREAM_RESUME_TTL_MS
};
