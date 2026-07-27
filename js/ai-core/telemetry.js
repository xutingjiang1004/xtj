// ==================== AI Core: Telemetry ====================
// Performance metrics: request timing, token usage, cancellation, errors.
// Defaults to debug-only / admin-visible; not shown on normal user UI.
(function () {
  'use strict';

  var CORE = window.XtjAiCore = window.XtjAiCore || {};

  function createTelemetry() {
    var metrics = {
      requestStartTime: 0,
      firstFeedbackTime: 0,
      firstTokenTime: 0,
      totalDurationMs: 0,
      toolCalls: 0,
      toolCallDurations: [],
      inputTokens: 0,
      outputTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      cancelReason: '',
      errorPhase: '',
      errorCode: '',
      requestId: '',
      clientRequestId: '',
      model: '',
      thinkingMode: '',
      finalState: 'pending'
    };

    function start(requestId, clientRequestId) {
      metrics.requestStartTime = Date.now();
      metrics.requestId = requestId || '';
      metrics.clientRequestId = clientRequestId || '';
      metrics.finalState = 'pending';
    }

    function markFirstFeedback() {
      if (!metrics.firstFeedbackTime) {
        metrics.firstFeedbackTime = Date.now();
      }
    }

    function markFirstToken() {
      if (!metrics.firstTokenTime) {
        metrics.firstTokenTime = Date.now();
      }
    }

    function recordToolCall(durationMs) {
      metrics.toolCalls++;
      if (typeof durationMs === 'number') {
        metrics.toolCallDurations.push(durationMs);
      }
    }

    function recordUsage(usage) {
      if (!usage) return;
      if (typeof usage.prompt_tokens === 'number') metrics.inputTokens = usage.prompt_tokens;
      if (typeof usage.completion_tokens === 'number') metrics.outputTokens = usage.completion_tokens;
      if (typeof usage.prompt_cache_hit_tokens === 'number') metrics.cacheHitTokens = usage.prompt_cache_hit_tokens;
      if (typeof usage.prompt_cache_miss_tokens === 'number') metrics.cacheMissTokens = usage.prompt_cache_miss_tokens;
      if (usage.model) metrics.model = usage.model;
      if (usage.thinking_mode) metrics.thinkingMode = usage.thinking_mode;
    }

    function finalize(state, err) {
      metrics.totalDurationMs = Date.now() - metrics.requestStartTime;
      metrics.finalState = state || 'done';
      if (state === 'error' || state === 'cancelled') {
        metrics.errorPhase = err ? err.phase || '' : '';
        metrics.errorCode = err ? err.code || '' : '';
        metrics.cancelReason = err ? err.message || '' : '';
      }
    }

    function getSummary() {
      return {
        requestId: metrics.requestId,
        clientRequestId: metrics.clientRequestId,
        model: metrics.model,
        thinkingMode: metrics.thinkingMode,
        totalDurationMs: metrics.totalDurationMs,
        firstFeedbackMs: metrics.firstFeedbackTime ? metrics.firstFeedbackTime - metrics.requestStartTime : 0,
        firstTokenMs: metrics.firstTokenTime ? metrics.firstTokenTime - metrics.requestStartTime : 0,
        toolCalls: metrics.toolCalls,
        toolCallDurations: metrics.toolCallDurations.slice(),
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        cacheHitTokens: metrics.cacheHitTokens,
        cacheMissTokens: metrics.cacheMissTokens,
        cancelReason: metrics.cancelReason,
        errorPhase: metrics.errorPhase,
        errorCode: metrics.errorCode,
        finalState: metrics.finalState
      };
    }

    function getDisplayLine() {
      var parts = [];
      if (metrics.model) parts.push(metrics.model);
      if (metrics.thinkingMode && metrics.thinkingMode !== 'off') parts.push('思考 ' + metrics.thinkingMode);
      if (metrics.inputTokens > 0) parts.push('入 ' + (metrics.inputTokens > 1000 ? (metrics.inputTokens / 1000).toFixed(1) + 'k' : metrics.inputTokens) + ' Token');
      if (metrics.outputTokens > 0) parts.push('出 ' + (metrics.outputTokens > 1000 ? (metrics.outputTokens / 1000).toFixed(1) + 'k' : metrics.outputTokens) + ' Token');
      if (metrics.totalDurationMs > 0) parts.push((metrics.totalDurationMs / 1000).toFixed(1) + 's');
      return parts.join(' · ');
    }

    return {
      start: start,
      markFirstFeedback: markFirstFeedback,
      markFirstToken: markFirstToken,
      recordToolCall: recordToolCall,
      recordUsage: recordUsage,
      finalize: finalize,
      getSummary: getSummary,
      getDisplayLine: getDisplayLine
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────
  CORE.Telemetry = {
    create: createTelemetry
  };

})();