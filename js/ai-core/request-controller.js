// ==================== AI Core: Request Controller ====================
// Unified request lifecycle: abort, cancel, timeout, dedup, generation isolation.
// Each request enters exactly one final state: done | error | cancelled.
(function () {
  'use strict';

  var CORE = window.XtjAiCore = window.XtjAiCore || {};
  var Errors = CORE.Errors;

  // ── Feature Flag ───────────────────────────────────────────────────────
  var FEATURE_FLAG = (function () {
    try { return localStorage.getItem('AI_SHARED_CORE_ENABLED') === '1'; } catch (e) { return false; }
  })();

  // ── Request states ─────────────────────────────────────────────────────
  var STATE = { IDLE: 'idle', ACTIVE: 'active', DONE: 'done', ERROR: 'error', CANCELLED: 'cancelled' };

  function createRequestController(options) {
    options = options || {};
    var controller = new AbortController();
    var state = STATE.IDLE;
    var finalized = false;
    var requestId = options.requestId || ('req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    var clientRequestId = options.clientRequestId || '';
    var workspaceGeneration = options.workspaceGeneration || 0;
    var timeoutMs = options.timeoutMs || 0;
    var timeoutId = null;
    var startTime = Date.now();
    var cancelReason = '';

    // ── Finalize guards ──────────────────────────────────────────────────
    function finalize(targetState, reason) {
      if (finalized) return false;
      finalized = true;
      state = targetState;
      if (targetState === STATE.CANCELLED) cancelReason = reason || 'user_cancelled';
      clearTimers();
      return true;
    }

    function isActive() { return !finalized && state === STATE.ACTIVE; }
    function isCancelled() { return state === STATE.CANCELLED; }
    function isFinalized() { return finalized; }
    function getState() { return state; }
    function getId() { return requestId; }
    function getClientId() { return clientRequestId; }
    function getSignal() { return controller.signal; }
    function getElapsedMs() { return Date.now() - startTime; }
    function getCancelReason() { return cancelReason; }

    // ── Stall/Generation check ───────────────────────────────────────────
    function isStale(currentGen) {
      if (currentGen !== undefined && workspaceGeneration !== currentGen) return true;
      return false;
    }

    // ── Timeout ──────────────────────────────────────────────────────────
    function clearTimers() {
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
    }

    function start() {
      if (finalized) return false;
      state = STATE.ACTIVE;
      startTime = Date.now();
      if (timeoutMs > 0) {
        timeoutId = setTimeout(function () {
          if (!finalized) {
            cancel('timeout');
          }
        }, timeoutMs);
      }
      return true;
    }

    // ── Cancel ───────────────────────────────────────────────────────────
    function cancel(reason) {
      if (!finalize(STATE.CANCELLED, reason)) return false;
      try { controller.abort(reason || 'cancelled'); } catch (e) {}
      return true;
    }

    // ── Done ─────────────────────────────────────────────────────────────
    function done() {
      return finalize(STATE.DONE, '');
    }

    // ── Error ────────────────────────────────────────────────────────────
    function error(msg) {
      return finalize(STATE.ERROR, msg);
    }

    // ── Cleanup ──────────────────────────────────────────────────────────
    function dispose() {
      clearTimers();
      try { controller.abort('disposed'); } catch (e) {}
    }

    return {
      // State
      isActive: isActive,
      isCancelled: isCancelled,
      isFinalized: isFinalized,
      getState: getState,
      getId: getId,
      getClientId: getClientId,
      getSignal: getSignal,
      getElapsedMs: getElapsedMs,
      getCancelReason: getCancelReason,
      isStale: isStale,

      // Lifecycle
      start: start,
      cancel: cancel,
      done: done,
      error: error,
      dispose: dispose,

      // Raw access (for existing code)
      signal: controller.signal,
      _abort: function (r) { try { controller.abort(r); } catch (e) {} }
    };
  }

  // ── Duplicate request guard ────────────────────────────────────────────
  // Track in-flight requests by a key to prevent double-send
  var inFlight = {};
  function registerInFlight(key, controller) {
    unregisterInFlight(key);
    inFlight[key] = controller;
  }
  function unregisterInFlight(key) {
    if (inFlight[key]) {
      inFlight[key] = null;
      delete inFlight[key];
    }
  }
  function getInFlight(key) { return inFlight[key] || null; }

  function isDuplicate(key) {
    var existing = getInFlight(key);
    if (existing && existing.isActive && existing.isActive()) return true;
    return false;
  }

  // ── Public API ─────────────────────────────────────────────────────────
  CORE.RequestController = {
    FEATURE_FLAG: FEATURE_FLAG,
    STATE: STATE,
    create: createRequestController,
    registerInFlight: registerInFlight,
    unregisterInFlight: unregisterInFlight,
    getInFlight: getInFlight,
    isDuplicate: isDuplicate
  };

})();