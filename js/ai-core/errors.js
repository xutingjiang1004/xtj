// ==================== AI Core: Error Classification ====================
// Shared error taxonomy for both Cat AI chat and Code workspace.
// All errors follow a uniform structure: { code, message, retryable, request_id, phase }
(function () {
  'use strict';

  var CORE = window.XtjAiCore = window.XtjAiCore || {};

  // ── Error Codes ──────────────────────────────────────────────────────
  var ERROR_CODES = {
    AUTH_FAILED:            'AUTH_FAILED',
    PERMISSION_DENIED:      'PERMISSION_DENIED',
    RATE_LIMITED:           'RATE_LIMITED',
    PROVIDER_TIMEOUT:       'PROVIDER_TIMEOUT',
    PROVIDER_EMPTY_RESPONSE:'PROVIDER_EMPTY_RESPONSE',
    STREAM_INTERRUPTED:     'STREAM_INTERRUPTED',
    REQUEST_CANCELLED:      'REQUEST_CANCELLED',
    INDEX_NOT_FOUND:        'INDEX_NOT_FOUND',
    INDEX_BUILD_FAILED:     'INDEX_BUILD_FAILED',
    INDEX_REBUILD_REQUIRED: 'INDEX_REBUILD_REQUIRED',
    TOOL_FAILED:            'TOOL_FAILED',
    CONTEXT_TOO_LARGE:      'CONTEXT_TOO_LARGE',
    VALIDATION_FAILED:      'VALIDATION_FAILED',
    INTERNAL_ERROR:         'INTERNAL_ERROR',
    NETWORK_ERROR:          'NETWORK_ERROR',
    UNKNOWN:                'UNKNOWN'
  };

  // ── User-facing messages ──────────────────────────────────────────────
  var USER_MESSAGES = {};
  USER_MESSAGES[ERROR_CODES.AUTH_FAILED]              = '登录已失效，请重新登录';
  USER_MESSAGES[ERROR_CODES.PERMISSION_DENIED]        = '权限不足，无法执行此操作';
  USER_MESSAGES[ERROR_CODES.RATE_LIMITED]             = '请求过于频繁，请稍后重试';
  USER_MESSAGES[ERROR_CODES.PROVIDER_TIMEOUT]         = 'AI 响应超时，请稍后重试';
  USER_MESSAGES[ERROR_CODES.PROVIDER_EMPTY_RESPONSE]  = 'AI 返回了空响应，请重试';
  USER_MESSAGES[ERROR_CODES.STREAM_INTERRUPTED]       = '响应流已中断，请重试';
  USER_MESSAGES[ERROR_CODES.REQUEST_CANCELLED]        = '请求已取消';
  USER_MESSAGES[ERROR_CODES.INDEX_NOT_FOUND]          = '项目索引未找到，请先刷新索引';
  USER_MESSAGES[ERROR_CODES.INDEX_BUILD_FAILED]       = '项目索引构建失败';
  USER_MESSAGES[ERROR_CODES.INDEX_REBUILD_REQUIRED]   = '项目索引需要重建';
  USER_MESSAGES[ERROR_CODES.TOOL_FAILED]              = '工具执行失败';
  USER_MESSAGES[ERROR_CODES.CONTEXT_TOO_LARGE]        = '上下文过大，请减少文件或精简请求';
  USER_MESSAGES[ERROR_CODES.VALIDATION_FAILED]        = '请求验证失败';
  USER_MESSAGES[ERROR_CODES.INTERNAL_ERROR]           = '内部服务错误，请稍后重试';
  USER_MESSAGES[ERROR_CODES.NETWORK_ERROR]            = '网络连接失败，请检查网络';

  // ── Classify errors from various sources ───────────────────────────────
  function classifyError(err, options) {
    options = options || {};
    var code = ERROR_CODES.UNKNOWN;
    var retryable = false;
    var phase = options.phase || 'unknown';

    if (!err) return buildError(ERROR_CODES.UNKNOWN, '未知错误', false, options);

    // Already structured
    if (err.code && typeof err.code === 'string') {
      code = err.code;
      retryable = err.retryable === true;
      return buildError(code, err.message || USER_MESSAGES[code] || '操作失败', retryable, options);
    }

    // AbortError
    if (err.name === 'AbortError') {
      return buildError(ERROR_CODES.REQUEST_CANCELLED, USER_MESSAGES[ERROR_CODES.REQUEST_CANCELLED], false, options);
    }

    var msg = String(err.message || err || '');

    // HTTP status classification
    if (options.httpStatus) {
      if (options.httpStatus === 401) {
        return buildError(ERROR_CODES.AUTH_FAILED, USER_MESSAGES[ERROR_CODES.AUTH_FAILED], false, options);
      }
      if (options.httpStatus === 403) {
        return buildError(ERROR_CODES.PERMISSION_DENIED, USER_MESSAGES[ERROR_CODES.PERMISSION_DENIED], false, options);
      }
      if (options.httpStatus === 429) {
        return buildError(ERROR_CODES.RATE_LIMITED, USER_MESSAGES[ERROR_CODES.RATE_LIMITED], true, options);
      }
      if (options.httpStatus === 413) {
        return buildError(ERROR_CODES.CONTEXT_TOO_LARGE, USER_MESSAGES[ERROR_CODES.CONTEXT_TOO_LARGE], false, options);
      }
      if (options.httpStatus >= 500) {
        return buildError(ERROR_CODES.INTERNAL_ERROR, msg || USER_MESSAGES[ERROR_CODES.INTERNAL_ERROR], true, options);
      }
    }

    // Message pattern matching
    if (/timeout|超时|TIMEOUT/i.test(msg)) {
      return buildError(ERROR_CODES.PROVIDER_TIMEOUT, USER_MESSAGES[ERROR_CODES.PROVIDER_TIMEOUT], true, options);
    }
    if (/cancel|abort|取消|中止/i.test(msg)) {
      return buildError(ERROR_CODES.REQUEST_CANCELLED, USER_MESSAGES[ERROR_CODES.REQUEST_CANCELLED], false, options);
    }
    if (/network|fetch|网络|连接/i.test(msg)) {
      return buildError(ERROR_CODES.NETWORK_ERROR, USER_MESSAGES[ERROR_CODES.NETWORK_ERROR], true, options);
    }
    if (/index|索引|rebuild/i.test(msg)) {
      if (/rebuild|重建/i.test(msg)) {
        return buildError(ERROR_CODES.INDEX_REBUILD_REQUIRED, USER_MESSAGES[ERROR_CODES.INDEX_REBUILD_REQUIRED], true, options);
      }
      return buildError(ERROR_CODES.INDEX_NOT_FOUND, USER_MESSAGES[ERROR_CODES.INDEX_NOT_FOUND], true, options);
    }
    if (/tool|工具/i.test(msg)) {
      return buildError(ERROR_CODES.TOOL_FAILED, msg, true, options);
    }
    if (/rate|limit|频繁|429/i.test(msg)) {
      return buildError(ERROR_CODES.RATE_LIMITED, USER_MESSAGES[ERROR_CODES.RATE_LIMITED], true, options);
    }
    if (/auth|login|登录|认证|token/i.test(msg)) {
      return buildError(ERROR_CODES.AUTH_FAILED, USER_MESSAGES[ERROR_CODES.AUTH_FAILED], false, options);
    }

    return buildError(ERROR_CODES.UNKNOWN, msg || '操作失败，请稍后重试', false, options);
  }

  function buildError(code, message, retryable, options) {
    return {
      code: code,
      message: message || '操作失败',
      retryable: retryable === true,
      request_id: options.requestId || '',
      client_request_id: options.clientRequestId || '',
      phase: options.phase || 'unknown',
      httpStatus: options.httpStatus || 0,
      toolTrace: options.toolTrace || null
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────
  CORE.Errors = {
    CODES: ERROR_CODES,
    MESSAGES: USER_MESSAGES,
    classify: classifyError,
    build: buildError,
    // 用户可见消息：不显示错误码
    formatUserMessage: function (err) {
      var classified = classifyError(err, {});
      if (classified.code === ERROR_CODES.INDEX_REBUILD_REQUIRED) {
        return '项目索引尚未建立，但文档内容已可用。您可以继续提问，系统会使用文档正文回答。';
      }
      if (classified.code && classified.code.indexOf('PROVIDER_') === 0) {
        return 'AI 服务暂时无法处理该请求，请稍后重试。';
      }
      // P0: 区分文档相关错误
      if (classified.code === 'DOCUMENT_NOT_PARSED') {
        return '文档正在解析中，请等待解析完成后重试。';
      }
      if (classified.code === 'NO_WRITE_PERMISSION') {
        return '没有文件写入权限，请重新授权写入权限后再试。';
      }
      if (classified.code === 'FORMAT_NOT_EDITABLE') {
        return '该文件格式暂不支持修改。PDF 可读取和分析，DOCX/PPTX/XLSX 可修改。';
      }
      if (classified.code === 'DOCUMENT_WRITE_FAILED') {
        return '文档写入失败：' + (classified.message || '未知错误');
      }
      if (classified.code === 'SAVE_VERIFICATION_FAILED') {
        return '保存验证失败，文件可能已损坏，请重试。';
      }
      if (classified.code === 'AMBIGUOUS_REQUEST') {
        return '请明确说明要修改什么内容，例如："将标题改为XXX"或"在第三段后插入XXX"。';
      }
      return classified.message;
    },
    // 调试详情：显示错误码和 request_id
    formatDebugDetails: function (err) {
      var classified = classifyError(err, {});
      var details = [];
      if (classified.code && classified.code !== ERROR_CODES.UNKNOWN) {
        details.push('错误码: ' + classified.code);
      }
      if (classified.request_id) {
        details.push('请求ID: ' + classified.request_id);
      }
      if (classified.phase) {
        details.push('请求阶段: ' + classified.phase);
      }
      details.push('是否可重试: ' + (classified.retryable ? '是' : '否'));
      return details;
    },
    // 格式化显示（保留向后兼容，但不再自动添加错误码前缀）
    formatDisplay: function (err) {
      var classified = classifyError(err, {});
      return classified.message;
    }
  };

})();