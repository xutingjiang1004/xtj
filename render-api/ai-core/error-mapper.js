// ==================== AI Core: Error Mapper ====================
// Unified error classification for backend endpoints.
// Maps internal errors to structured client-facing error objects.
'use strict';

const ERROR_CODES = {
  AUTH_FAILED:             'AUTH_FAILED',
  PERMISSION_DENIED:       'PERMISSION_DENIED',
  RATE_LIMITED:            'RATE_LIMITED',
  PROVIDER_TIMEOUT:        'PROVIDER_TIMEOUT',
  PROVIDER_EMPTY_RESPONSE: 'PROVIDER_EMPTY_RESPONSE',
  STREAM_INTERRUPTED:      'STREAM_INTERRUPTED',
  REQUEST_CANCELLED:       'REQUEST_CANCELLED',
  INDEX_NOT_FOUND:         'INDEX_NOT_FOUND',
  INDEX_BUILD_FAILED:      'INDEX_BUILD_FAILED',
  INDEX_REBUILD_REQUIRED:  'INDEX_REBUILD_REQUIRED',
  TOOL_FAILED:             'TOOL_FAILED',
  CONTEXT_TOO_LARGE:       'CONTEXT_TOO_LARGE',
  VALIDATION_FAILED:       'VALIDATION_FAILED',
  INTERNAL_ERROR:          'INTERNAL_ERROR',
  NETWORK_ERROR:           'NETWORK_ERROR',
  UNKNOWN:                 'UNKNOWN'
};

const HTTP_STATUS = {};
HTTP_STATUS[ERROR_CODES.AUTH_FAILED]             = 401;
HTTP_STATUS[ERROR_CODES.PERMISSION_DENIED]       = 403;
HTTP_STATUS[ERROR_CODES.RATE_LIMITED]            = 429;
HTTP_STATUS[ERROR_CODES.PROVIDER_TIMEOUT]        = 504;
HTTP_STATUS[ERROR_CODES.PROVIDER_EMPTY_RESPONSE] = 502;
HTTP_STATUS[ERROR_CODES.STREAM_INTERRUPTED]      = 500;
HTTP_STATUS[ERROR_CODES.REQUEST_CANCELLED]       = 499;
HTTP_STATUS[ERROR_CODES.INDEX_NOT_FOUND]         = 409;
HTTP_STATUS[ERROR_CODES.INDEX_BUILD_FAILED]      = 500;
HTTP_STATUS[ERROR_CODES.INDEX_REBUILD_REQUIRED]   = 409;
HTTP_STATUS[ERROR_CODES.TOOL_FAILED]             = 500;
HTTP_STATUS[ERROR_CODES.CONTEXT_TOO_LARGE]       = 413;
HTTP_STATUS[ERROR_CODES.VALIDATION_FAILED]       = 400;
HTTP_STATUS[ERROR_CODES.INTERNAL_ERROR]          = 500;
HTTP_STATUS[ERROR_CODES.NETWORK_ERROR]           = 502;
HTTP_STATUS[ERROR_CODES.UNKNOWN]                 = 500;

// ── Build a structured error response ────────────────────────────────────
function buildErrorResponse(code, message, options) {
  options = options || {};
  return {
    error: message || '操作失败',
    code: code || ERROR_CODES.UNKNOWN,
    retryable: options.retryable === true,
    requestId: options.requestId || '',
    phase: options.phase || '',
    tool_trace: options.toolTrace || null,
    status: HTTP_STATUS[code] || 500
  };
}

// ── Classify an error from various sources ───────────────────────────────
function classifyError(err, options) {
  options = options || {};
  if (!err) return buildErrorResponse(ERROR_CODES.UNKNOWN, '未知错误', options);

  // Already structured
  if (err.code && typeof err.code === 'string') {
    return buildErrorResponse(err.code, err.message, Object.assign({}, options, {
      retryable: err.retryable === true,
      toolTrace: err.toolTrace || null
    }));
  }

  var msg = String(err.message || err || '');
  var code = ERROR_CODES.UNKNOWN;
  var retryable = false;

  if (err.name === 'AbortError' || /abort|cancel|取消/i.test(msg)) {
    code = ERROR_CODES.REQUEST_CANCELLED;
  } else if (/timeout|超时/i.test(msg)) {
    code = ERROR_CODES.PROVIDER_TIMEOUT;
    retryable = true;
  } else if (/rate.*limit|429|频繁/i.test(msg)) {
    code = ERROR_CODES.RATE_LIMITED;
    retryable = true;
  } else if (/auth|token|unauthorized|登录|认证/i.test(msg)) {
    code = ERROR_CODES.AUTH_FAILED;
  } else if (/index|索引|rebuild/i.test(msg)) {
    if (/rebuild|重建/i.test(msg)) {
      code = ERROR_CODES.INDEX_REBUILD_REQUIRED;
      retryable = true;
    } else {
      code = ERROR_CODES.INDEX_NOT_FOUND;
      retryable = true;
    }
  } else if (/context.*(too|exceed|large|budget|超出|过大)/i.test(msg)) {
    code = ERROR_CODES.CONTEXT_TOO_LARGE;
  } else if (/tool|工具/i.test(msg)) {
    code = ERROR_CODES.TOOL_FAILED;
    retryable = true;
  } else if (/empty.*response|空响应/i.test(msg)) {
    code = ERROR_CODES.PROVIDER_EMPTY_RESPONSE;
    retryable = true;
  }

  return buildErrorResponse(code, msg, Object.assign({}, options, { retryable: retryable }));
}

// ── Send a structured error as JSON ──────────────────────────────────────
function sendErrorResponse(res, err, options) {
  var structured = classifyError(err, options);
  var status = structured.status || 500;
  try {
    res.status(status).json({
      error: structured.error,
      code: structured.code,
      retryable: structured.retryable,
      requestId: structured.requestId,
      phase: structured.phase,
      tool_trace: structured.toolTrace
    });
  } catch (e) {
    // Response already sent
  }
}

module.exports = {
  ERROR_CODES: ERROR_CODES,
  HTTP_STATUS: HTTP_STATUS,
  buildErrorResponse: buildErrorResponse,
  classifyError: classifyError,
  sendErrorResponse: sendErrorResponse
};