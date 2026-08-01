// ==================== AI Core: Stream Session Persistence ====================
// Persists SSE stream sessions and events to Supabase for resume capability.
// Feature flag: CODE_STREAM_RESUME_ENABLED
'use strict';

var STREAM_RESUME_TTL_MS = 60 * 60 * 1000; // 1 hour
var RESUME_ENABLED = false;

// ── Error Classification ──────────────────────────────────────────────────

var { classifySupabaseError } = require('../db-result.js');

// ── Feature Flag ──────────────────────────────────────────────────────────

function isResumeEnabled() {
  if (RESUME_ENABLED) return true;
  return String(process.env.CODE_STREAM_RESUME_ENABLED || '0') === '1';
}

function setResumeEnabledForTests(enabled) {
  RESUME_ENABLED = enabled;
}

// ── Backoff Helper ────────────────────────────────────────────────────────

function getBackoffDelay(retryCount) {
  return Math.min(1000 * Math.pow(2, retryCount), 30000);
}

// ── Idempotency Query ─────────────────────────────────────────────────────

function queryIdempotencyKey(supabase, key) {
  if (!supabase || !key) return Promise.resolve({ found: false });
  return supabase.from('ai_stream_sessions').select('*')
    .eq('client_request_id', String(key))
    .limit(1)
    .then(function(r) {
      if (r.error) {
        return { query_failed: true, error: { code: r.error.code || 'UNKNOWN', message: r.error.message || 'Query failed' } };
      }
      if (r.data && r.data[0]) return { found: true, data: r.data[0] };
      return { found: false };
    }).catch(function(e) {
      return { query_failed: true, error: { code: 'UNKNOWN', message: e.message || 'Query failed' } };
    });
}

// ── Session CRUD ──────────────────────────────────────────────────────────

function createStreamSession(supabase, params) {
  if (!isResumeEnabled() || !supabase) {
    return Promise.resolve({ error: { code: 'DISABLED', message: 'Stream resume is not enabled' } });
  }
  return supabase.from('ai_stream_sessions').insert({
    user_id: String(params.userId || ''),
    stream_id: String(params.streamId || ''),
    request_id: String(params.requestId || ''),
    client_request_id: String(params.clientRequestId || ''),
    conversation_id: String(params.conversationId || ''),
    workspace_id: String(params.workspaceId || ''),
    workspace_generation: Number(params.workspaceGeneration || 0),
    status: 'running',
    last_event_id: 0,
    started_at: params.startedAt || new Date().toISOString(),
    expires_at: new Date(Date.now() + STREAM_RESUME_TTL_MS).toISOString()
  }).select('*').then(function(r) {
    if (r.error) {
      console.error('[stream-session] create session failed:', r.error.message);
      return { error: { code: r.error.code || 'UNKNOWN', message: r.error.message || 'Create session failed' } };
    }
    var session = r.data && (Array.isArray(r.data) ? r.data[0] : r.data) ? (Array.isArray(r.data) ? r.data[0] : r.data) : null;
    if (session) return { data: session };
    return { error: { code: 'EMPTY_RESULT', message: 'No session data returned' } };
  }).catch(function(e) {
    console.error('[stream-session] create session error:', e.message);
    return { error: { code: 'UNKNOWN', message: e.message || 'Create session error' } };
  });
}

function updateStreamSession(supabase, streamId, updates) {
  if (!isResumeEnabled() || !supabase) return Promise.resolve(null);
  var payload = Object.assign({ updated_at: new Date().toISOString() }, updates);
  return supabase.from('ai_stream_sessions').update(payload).select('*')
    .eq('stream_id', String(streamId))
    .then(function(r) {
      if (r.error) console.error('[stream-session] update failed:', r.error.message);
      return r.data && r.data[0] ? r.data[0] : null;
    }).catch(function(e) {
      console.error('[stream-session] update error:', e.message);
      return null;
    });
}

function getStreamSession(supabase, streamId) {
  if (!isResumeEnabled() || !supabase) return Promise.resolve(null);
  return supabase.from('ai_stream_sessions').select('*')
    .eq('stream_id', String(streamId))
    .limit(1)
    .then(function(r) {
      if (r.error) return null;
      return r.data && r.data[0] ? r.data[0] : null;
    }).catch(function() { return null; });
}

function getStreamSessionByClientRequestId(supabase, userId, clientRequestId) {
  if (!isResumeEnabled() || !supabase) return Promise.resolve(null);
  return supabase.from('ai_stream_sessions').select('*')
    .eq('user_id', String(userId))
    .eq('client_request_id', String(clientRequestId))
    .order('created_at', { ascending: false })
    .limit(1)
    .then(function(r) {
      if (r.error) return null;
      return r.data && r.data[0] ? r.data[0] : null;
    }).catch(function() { return null; });
}

// ── Event Persistence ─────────────────────────────────────────────────────

// Events that should be persisted (not heartbeat)
var PERSISTABLE_EVENT_TYPES = new Set([
  'accepted', 'planning', 'tool_start', 'tool_result',
  'answer_start', 'answer_delta', 'operation_preview',
  'usage', 'warning', 'done', 'error', 'cancelled'
]);

// answer_delta batching: accumulate and flush periodically
var DELTA_FLUSH_INTERVAL_MS = 300;
var DELTA_FLUSH_MIN_CHARS = 200;

function insertEvent(supabase, streamId, userId, eventId, type, data) {
  return supabase.from('ai_stream_events').insert({
    user_id: String(userId),
    stream_id: String(streamId),
    event_id: Number(eventId),
    event_type: type,
    event_data: data || {},
    expires_at: new Date(Date.now() + STREAM_RESUME_TTL_MS).toISOString()
  }).then(function(r) {
    if (r.error) {
      // 23505 = unique violation, event already exists — treat as success
      if (r.error.code === '23505') {
        return { attempted: 1, succeeded: 1, failed: 0, eventId: eventId };
      }
      var classified = classifySupabaseError(r.error);
      console.error('[stream-session] insert event failed:', r.error.message);
      return {
        attempted: 1,
        succeeded: 0,
        failed: 1,
        retryable: classified.retryable,
        error: classified.error,
        eventId: eventId
      };
    }
    return { attempted: 1, succeeded: 1, failed: 0, eventId: eventId };
  }).catch(function(e) {
    var classified = classifySupabaseError(e);
    console.error('[stream-session] insert event error:', e.message);
    return {
      attempted: 1,
      succeeded: 0,
      failed: 1,
      retryable: classified.retryable,
      error: classified.error,
      eventId: eventId
    };
  });
}

function createEventLogger(supabase, streamId, userId) {
  if (!isResumeEnabled() || !supabase) {
    return {
      logEvent: function() { return Promise.resolve(); },
      flush: function() { return Promise.resolve({ attempted: 0, succeeded: 0, failed: 0, lastPersistedEventId: 0 }); },
      getEvents: function() { return Promise.resolve([]); }
    };
  }

  var pendingDeltas = [];
  var lastFlushTime = 0;
  var flushTimer = null;
  var flushed = false;
  var pendingWrites = new Set();
  // Phase 1-P0-3/4: Track the last delta event_id so flush() never uses 0.
  // All persisted event_ids must be > 0, unique, and monotonically increasing.
  var _lastDeltaEventId = 0;
  // Tracks the last event ID that was actually persisted (not just written to buffer)
  var _lastPersistedEventId = 0;
  // Event IDs are generated by the caller, including non-persisted heartbeat
  // events. Flushes must allocate above every ID already observed, otherwise
  // a terminal flush can collide with a real event ID.
  var _lastIssuedEventId = 0;

  function trackWrite(promise) {
    var tracked = Promise.resolve(promise);
    pendingWrites.add(tracked);
    tracked.then(function() { pendingWrites.delete(tracked); }, function() { pendingWrites.delete(tracked); });
    return tracked;
  }

  function waitForWrites() {
    if (pendingWrites.size === 0) return Promise.resolve();
    return Promise.all(Array.from(pendingWrites)).then(waitForWrites);
  }

  function doFlushDeltas() {
    if (flushed) return Promise.resolve();
    if (pendingDeltas.length === 0) return Promise.resolve();
    var combined = pendingDeltas.join('');
    pendingDeltas = [];
    lastFlushTime = 0;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    // Find the last event_id we used for deltas (or use a placeholder)
    // We use a single batch insert for the combined delta
    // event_id will be assigned by the caller
    return Promise.resolve(combined);
  }

  // Wraps insertEvent and tracks _lastPersistedEventId on success
  function persistEvent(eventId, type, data) {
    return insertEvent(supabase, streamId, userId, eventId, type, data).then(function(result) {
      if (result.succeeded > 0) {
        _lastPersistedEventId = eventId;
      }
      return result;
    });
  }

  function persistCombinedDelta(eventId, combined) {
    return persistEvent(eventId, 'answer_delta', { delta: combined.slice(0, 10000) }).then(function(result) {
      if (result && result.failed > 0) {
        // doFlushDeltas removes the batch before the async write. Put it back
        // on failure so a later terminal flush can retry instead of silently
        // losing the tail of the answer.
        pendingDeltas.unshift(combined);
      }
      return result;
    });
  }

  function logEvent(type, data, eventId) {
    if (!isResumeEnabled() || !supabase) return Promise.resolve();
    if (Number(eventId) > _lastIssuedEventId) _lastIssuedEventId = Number(eventId);

    // Batch answer_delta
    if (type === 'answer_delta') {
      var delta = (data && data.delta) ? String(data.delta) : '';
      if (!delta) return Promise.resolve();
      pendingDeltas.push(delta);
      // Phase 1-P0-4: Track the event_id of the latest batched delta
      _lastDeltaEventId = eventId;

      var now = Date.now();
      if (lastFlushTime === 0) lastFlushTime = now;

      if (pendingDeltas.join('').length >= DELTA_FLUSH_MIN_CHARS ||
          (now - lastFlushTime) >= DELTA_FLUSH_INTERVAL_MS) {
        return trackWrite(doFlushDeltas().then(function(combined) {
          if (!combined) return;
          // Phase 1-P0-3: Use the last delta's event_id (always > 0)
          return persistCombinedDelta(_lastDeltaEventId, combined);
        }));
      }
      return Promise.resolve();
    }

    // Flush pending deltas before logging other event types
    // Phase 1-P0-3: Use _lastDeltaEventId instead of eventId - 1 (which could be 0)
    var flushPromise = doFlushDeltas().then(function(combined) {
      if (combined) {
        return persistCombinedDelta(_lastDeltaEventId, combined);
      }
    });

    return trackWrite(flushPromise.then(function() {
      return persistEvent(eventId, type, sanitizeEventData(type, data));
    }));
  }

  function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    var flushResult = { attempted: 0, succeeded: 0, failed: 0, lastPersistedEventId: _lastPersistedEventId };
    return waitForWrites().then(function() { return doFlushDeltas(); }).then(function(combined) {
      if (combined) {
        // Allocate strictly above every event ID observed by this logger.
        // This cannot collide with the caller's sequential event generator.
        var flushEventId = Math.max(_lastDeltaEventId || 0, _lastIssuedEventId || 0) + 1;
        _lastDeltaEventId = flushEventId;
        _lastIssuedEventId = flushEventId;
        return persistCombinedDelta(flushEventId, combined).then(function(result) {
          flushResult.attempted += result.attempted;
          flushResult.succeeded += result.succeeded;
          flushResult.failed += result.failed;
          flushResult.lastPersistedEventId = _lastPersistedEventId;
          if (!result.failed) flushed = true;
          return flushResult;
        });
      }
      flushed = true;
      return flushResult;
    }).then(waitForWrites).then(function() {
      return flushResult;
    });
  }

  return {
    logEvent: logEvent,
    flush: flush,
    flushDeltas: doFlushDeltas
  };
}

function sanitizeEventData(type, data) {
  if (!data || typeof data !== 'object') return {};
  var sanitized = {};
  // Whitelist safe fields per event type
  var keys = Object.keys(data);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = data[k];
    // Only drop exact credential-shaped fields. A substring filter would
    // incorrectly remove legitimate protocol data such as `keywords`,
    // `author`, and `key_map` needed when a stream is resumed.
    var normalizedKey = String(k).replace(/[-_]/g, '').toLowerCase();
    if (['apikey', 'accesstoken', 'refreshtoken', 'clientsecret', 'password', 'authorization', 'cookie', 'setcookie', 'token', 'secret', 'auth'].indexOf(normalizedKey) >= 0) continue;
    if (typeof v === 'string' && v.length > 10000) {
      sanitized[k] = v.slice(0, 10000) + '...[truncated]';
    } else if (typeof v === 'object' && v !== null) {
      try { sanitized[k] = JSON.parse(JSON.stringify(v)); } catch (_) { sanitized[k] = null; }
    } else {
      sanitized[k] = v;
    }
  }
  return sanitized;
}

// ── Resume ────────────────────────────────────────────────────────────────

function getEventsAfter(supabase, streamId, afterEventId) {
  if (!isResumeEnabled() || !supabase) return Promise.resolve([]);
  return supabase.from('ai_stream_events').select('event_id, event_type, event_data')
    .eq('stream_id', String(streamId))
    .gt('event_id', Number(afterEventId) || 0)
    .order('event_id', { ascending: true })
    .then(function(r) {
      if (r.error) return [];
      return (r.data || []).map(function(row) {
        return {
          event_id: row.event_id,
          stream_id: streamId,
          type: row.event_type,
          data: row.event_data || {}
        };
      });
    }).catch(function() { return []; });
}

// ── Heartbeat filter ──────────────────────────────────────────────────────

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
  createEventLogger: createEventLogger,
  getEventsAfter: getEventsAfter,
  isPersistableEvent: isPersistableEvent,
  queryIdempotencyKey: queryIdempotencyKey,
  getBackoffDelay: getBackoffDelay,
  STREAM_RESUME_TTL_MS: STREAM_RESUME_TTL_MS
};
