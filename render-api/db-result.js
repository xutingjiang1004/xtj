// ==================== Database Result Contract ====================
// Phase 5-P0: 统一数据库结果契约。
// 所有写日志/清理日志的函数必须返回结构化结果，禁止用空值伪装失败。
// 契约字段：ok / partial / operation / attempted / succeeded / failed / retryable / error
'use strict';

// PostgreSQL/PostgREST 错误码：不可重试的语义性错误
// 23505 unique_violation, 42501 insufficient_privilege, 23503 foreign_key_violation,
// 23502 not_null_violation, 22P02 invalid_text_representation, 23514 exclusion_violation,
// 42P01 undefined_table, 42703 undefined_column
var NON_RETRYABLE_CODES = ['23505', '42501', '23503', '23502', '22P02', '23514', '42P01', '42703'];

function classifySupabaseError(error) {
  if (!error) return { retryable: false, error: null };
  var code = error.code ? String(error.code) : '';
  var message = error.message ? String(error.message) : String(error);
  var retryable = NON_RETRYABLE_CODES.indexOf(code) < 0;
  return {
    retryable: retryable,
    error: { code: code || 'UNKNOWN', message: message }
  };
}

function dbResult(operation, attempted, succeeded, failed, opts) {
  opts = opts || {};
  var err = opts.error || null;
  var retryable = opts.retryable !== undefined ? opts.retryable : false;
  return {
    ok: failed === 0 && !err,
    partial: !err && succeeded > 0 && failed > 0,
    operation: operation,
    attempted: attempted,
    succeeded: succeeded,
    failed: failed,
    retryable: retryable,
    error: err
  };
}

module.exports = {
  NON_RETRYABLE_CODES: NON_RETRYABLE_CODES,
  classifySupabaseError: classifySupabaseError,
  dbResult: dbResult
};
