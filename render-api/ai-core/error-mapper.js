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

// 客户端固定文案：内部错误的原始 message 绝不下发客户端，只按 code 映射固定文案。
// 原始 message 仅通过 logRawError 写入服务端日志，客户端用 requestId 关联排查。
const CLIENT_MESSAGES = {
  AUTH_FAILED:             '身份验证失败，请重新登录',
  PERMISSION_DENIED:       '权限不足，无法执行该操作',
  RATE_LIMITED:            '请求过于频繁，请稍后再试',
  PROVIDER_TIMEOUT:        '模型响应超时，请稍后重试',
  PROVIDER_EMPTY_RESPONSE: '模型未返回内容，请稍后重试',
  STREAM_INTERRUPTED:      '流式响应中断，请重试',
  REQUEST_CANCELLED:       '请求已取消',
  INDEX_NOT_FOUND:         '项目索引不存在，请先建立索引',
  INDEX_BUILD_FAILED:      '项目索引构建失败，请重试',
  INDEX_REBUILD_REQUIRED:  '项目索引需要重建',
  TOOL_FAILED:             '工具调用失败，请稍后重试',
  CONTEXT_TOO_LARGE:       '上下文过长，请精简内容后重试',
  VALIDATION_FAILED:       '请求参数校验失败',
  INTERNAL_ERROR:          '服务器内部错误，请稍后重试',
  NETWORK_ERROR:           '网络连接异常，请稍后重试',
  UNKNOWN:                 '操作失败，请稍后重试'
};

function clientMessageFor(code, fallback) {
  return CLIENT_MESSAGES[code] || fallback || CLIENT_MESSAGES.UNKNOWN;
}

function logRawError(code, err, options) {
  try {
    var raw = err && err.message ? String(err.message) : String(err || '');
    console.error('[error-mapper] code=' + (code || 'UNKNOWN') +
      ' requestId=' + (options && options.requestId || '') +
      ' phase=' + (options && options.phase || '') +
      ' message=' + raw);
  } catch (_) {}
}

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
  if (!err) return buildErrorResponse(ERROR_CODES.UNKNOWN, clientMessageFor(ERROR_CODES.UNKNOWN), options);

  // Already structured with one of our public codes
  if (err.code && typeof err.code === 'string' && Object.prototype.hasOwnProperty.call(HTTP_STATUS, err.code)) {
    logRawError(err.code, err, options);
    return buildErrorResponse(err.code, clientMessageFor(err.code), Object.assign({}, options, {
      retryable: err.retryable === true,
      toolTrace: err.toolTrace || null
    }));
  }

  var msg = String(err.message || err || '');
  var code = ERROR_CODES.UNKNOWN;
  var retryable = false;

  // Node/network errors also carry a `code` field, but codes such as
  // ECONNRESET are not client protocol codes. Classify them as retryable
  // network failures instead of leaking the internal code through unchanged.
  if (err.code && /^(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR)/i.test(String(err.code))) {
    logRawError(ERROR_CODES.NETWORK_ERROR, err, options);
    return buildErrorResponse(ERROR_CODES.NETWORK_ERROR, clientMessageFor(ERROR_CODES.NETWORK_ERROR), Object.assign({}, options, { retryable: true }));
  }

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

  logRawError(code, err, options);
  return buildErrorResponse(code, clientMessageFor(code), Object.assign({}, options, { retryable: retryable }));
}

// ── Send a structured error as JSON ──────────────────────────────────────
function sendErrorResponse(res, err, options) {
  var structured = classifyError(err, options);
  var status = structured.status || 500;
  if (res.headersSent || res.writableEnded) {
    if (!res.writableEnded && typeof res.end === 'function') res.end();
    return structured;
  }
  try {
    res.status(status).json({
      error: structured.error,
      code: structured.code,
      retryable: structured.retryable,
      requestId: structured.requestId,
      phase: structured.phase,
      tool_trace: structured.tool_trace
    });
  } catch (e) {
    if (!res.headersSent && !res.writableEnded && typeof res.end === 'function') res.end();
  }
  return structured;
}

module.exports = {
  ERROR_CODES: ERROR_CODES,
  HTTP_STATUS: HTTP_STATUS,
  buildErrorResponse: buildErrorResponse,
  classifyError: classifyError,
  sendErrorResponse: sendErrorResponse
};
