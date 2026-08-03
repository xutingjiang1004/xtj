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

function insertEvent(supabase, streamId, userId, eventId, type, data) {
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
      // A duplicate event is idempotent: it is already durable.
      if (String(result.error.code || '') === '23505') {
        return { ok: true, attempted: 1, succeeded: 1, failed: 0, retryable: false, error: null, eventId: eventId };
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
  var writeChain = Promise.resolve();
  var flushPromise = null;
  var lastDeltaEventId = 0;
  var lastPersistedEventId = 0;
  var lastIssuedEventId = 0;

  function persistEvent(eventId, type, data) {
    return insertEvent(supabase, streamId, userId, eventId, type, sanitizeEventData(type, data)).then(function(result) {
      if (result && result.succeeded > 0) {
        lastPersistedEventId = Math.max(lastPersistedEventId, Number(eventId) || 0);
      }
      return result;
    });
  }

  function persistCombinedDelta(eventId, combined) {
    return persistEvent(eventId, 'answer_delta', { delta: combined.slice(0, 10000) }).then(function(result) {
      if (result && result.failed > 0) pendingDeltas.unshift(combined);
      return result;
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
    return task;
  }

  function collectWriteTasks() {
    var tasks = pendingWriteTasks;
    pendingWriteTasks = [];
    return Promise.all(tasks);
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
      var allResults = [];
      await writeChain;
      allResults = allResults.concat(await collectWriteTasks());
      if (pendingDeltas.length > 0) {
        await enqueue(flushPendingDeltasInternal);
        await writeChain;
      }
      allResults = allResults.concat(await collectWriteTasks());
      var result = aggregateWriteResults(allResults, lastPersistedEventId);
      result.lastPersistedEventId = lastPersistedEventId;
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
  var sanitized = {};
  Object.keys(data).forEach(function(key) {
    var value = data[key];
    var normalizedKey = String(key).replace(/[-_]/g, '').toLowerCase();
    if (['apikey', 'accesstoken', 'refreshtoken', 'clientsecret', 'password', 'authorization', 'cookie', 'setcookie', 'token', 'secret', 'auth'].indexOf(normalizedKey) >= 0) return;
    if (typeof value === 'string' && value.length > 10000) {
      sanitized[key] = value.slice(0, 10000) + '...[truncated]';
    } else if (typeof value === 'object' && value !== null) {
      try { sanitized[key] = JSON.parse(JSON.stringify(value)); } catch (_) { sanitized[key] = null; }
    } else {
      sanitized[key] = value;
    }
  });
  return sanitized;
}

// ==================== Resume ====================

function getEventsAfter(supabase, streamId, afterEventId) {
  if (!isResumeEnabled() || !supabase) return Promise.resolve({ ok: true, events: [], retryable: false, error: null });
  return runPersistenceQuery(function() {
    return supabase.from('ai_stream_events').select('event_id, event_type, event_data')
      .eq('stream_id', String(streamId))
      .gt('event_id', Number(afterEventId) || 0)
      .order('event_id', { ascending: true });
  }).then(function(result) {
    if (!result.ok) return { ok: false, events: null, retryable: true, error: result.error, attempts: result.attempts };
    var events = normalizeRows(result.data).map(function(row) {
      return { event_id: row.event_id, stream_id: streamId, type: row.event_type, data: row.event_data || {} };
    });
    return { ok: true, events: events, retryable: false, error: null, attempts: result.attempts };
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
