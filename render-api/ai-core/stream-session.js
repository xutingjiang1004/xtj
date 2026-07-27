// ==================== AI Core: Stream Session Persistence ====================
// Persists SSE stream sessions and events to Supabase for resume capability.
// Feature flag: CODE_STREAM_RESUME_ENABLED
'use strict';

var STREAM_RESUME_TTL_MS = 60 * 60 * 1000; // 1 hour
var RESUME_ENABLED = false;

// ── Feature Flag ──────────────────────────────────────────────────────────

function isResumeEnabled() {
  if (RESUME_ENABLED) return true;
  return String(process.env.CODE_STREAM_RESUME_ENABLED || '0') === '1';
}

function setResumeEnabledForTests(enabled) {
  RESUME_ENABLED = enabled;
}

// ── Session CRUD ──────────────────────────────────────────────────────────

function createStreamSession(supabase, params) {
  if (!isResumeEnabled() || !supabase) return Promise.resolve(null);
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
  }).then(function(r) {
    if (r.error) {
      console.error('[stream-session] create session failed:', r.error.message);
      return null;
    }
    return r.data && r.data[0] ? r.data[0] : null;
  }).catch(function(e) {
    console.error('[stream-session] create session error:', e.message);
    return null;
  });
}

function updateStreamSession(supabase, streamId, updates) {
  if (!isResumeEnabled() || !supabase) return Promise.resolve(null);
  var payload = Object.assign({ updated_at: new Date().toISOString() }, updates);
  return supabase.from('ai_stream_sessions').update(payload)
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

function createEventLogger(supabase, streamId, userId) {
  if (!isResumeEnabled() || !supabase) {
    return {
      logEvent: function() { return Promise.resolve(); },
      flush: function() { return Promise.resolve(); },
      getEvents: function() { return Promise.resolve([]); }
    };
  }

  var pendingDeltas = [];
  var lastFlushTime = 0;
  var flushTimer = null;
  var flushed = false;

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

  function logEvent(type, data, eventId) {
    if (!isResumeEnabled() || !supabase) return Promise.resolve();

    // Batch answer_delta
    if (type === 'answer_delta') {
      var delta = (data && data.delta) ? String(data.delta) : '';
      if (!delta) return Promise.resolve();
      pendingDeltas.push(delta);

      var now = Date.now();
      if (lastFlushTime === 0) lastFlushTime = now;

      if (pendingDeltas.join('').length >= DELTA_FLUSH_MIN_CHARS ||
          (now - lastFlushTime) >= DELTA_FLUSH_INTERVAL_MS) {
        return doFlushDeltas().then(function(combined) {
          if (!combined) return;
          return insertEvent(supabase, streamId, userId, eventId, 'answer_delta', { delta: combined.slice(0, 10000) });
        });
      }
      return Promise.resolve();
    }

    // Flush pending deltas before logging other event types
    var flushPromise = doFlushDeltas().then(function(combined) {
      if (combined) {
        return insertEvent(supabase, streamId, userId, eventId - 1, 'answer_delta', { delta: combined.slice(0, 10000) });
      }
    });

    return flushPromise.then(function() {
      return insertEvent(supabase, streamId, userId, eventId, type, sanitizeEventData(type, data));
    });
  }

  function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    return doFlushDeltas().then(function(combined) {
      flushed = true;
      if (combined) {
        return insertEvent(supabase, streamId, userId, 0, 'answer_delta', { delta: combined.slice(0, 10000) });
      }
    });
  }

  return {
    logEvent: logEvent,
    flush: flush,
    flushDeltas: doFlushDeltas
  };
}

function insertEvent(supabase, streamId, userId, eventId, type, data) {
  return supabase.from('ai_stream_events').insert({
    user_id: String(userId),
    stream_id: String(streamId),
    event_id: Number(eventId),
    event_type: type,
    event_data: data || {},
    expires_at: new Date(Date.now() + STREAM_RESUME_TTL_MS).toISOString()
  }).then(function(r) {
    if (r.error && r.error.code !== '23505') { // 23505 = unique violation, ignore
      console.error('[stream-session] insert event failed:', r.error.message);
    }
  }).catch(function(e) {
    console.error('[stream-session] insert event error:', e.message);
  });
}

function sanitizeEventData(type, data) {
  if (!data || typeof data !== 'object') return {};
  var sanitized = {};
  // Whitelist safe fields per event type
  var keys = Object.keys(data);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = data[k];
    // Never store API keys, tokens, or sensitive data
    if (/key|token|secret|password|auth/i.test(k)) continue;
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
  STREAM_RESUME_TTL_MS: STREAM_RESUME_TTL_MS
};