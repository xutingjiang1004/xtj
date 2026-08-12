// ==================== Database Result Contract ====================
// Phase 5-P0: 统一数据库结果契约。
// 所有写日志/清理日志的函数必须返回结构化结果，禁止用空值伪装失败。
// 契约字段：ok / partial / operation / attempted / succeeded / failed / retryable / error
'use strict';

// PostgreSQL/PostgREST 错误码：不可重试的语义性错误
// 23505 unique_violation, 42501 insufficient_privilege, 23503 foreign_key_violation,
// 23502 not_null_violation, 22P02 invalid_text_representation, 23514 exclusion_violation,
// 42P01 undefined_table, 42703 undefined_column
// 审计 ⚪：该常量在 isRetryableError 中显式短路返回不可重试（原先仅导出未使用，
// 属死导出；现作为"明确不可重试"清单参与判定，白名单外的其他码仍默认不可重试）。
var NON_RETRYABLE_CODES = ['23505', '42501', '23503', '23502', '22P02', '23514', '42P01', '42703'];

// 白名单判定 retryable：
//   - SQLSTATE 08*（连接类）与 40001（serialization_failure）可重试
//   - HTTP 状态 408/429/5xx 可重试
//   - 其余（含各种语义性 SQLSTATE）默认不可重试
//   - 无码错误按异常类型单独判定：AbortError/TimeoutError、
//     TypeError 且 message 含 "fetch failed" 视为可重试
function isRetryableError(error) {
  if (!error) return false;
  var code = error.code ? String(error.code) : '';
  var message = error.message ? String(error.message) : String(error);
  if (code) {
    // 明确不可重试的语义性错误（见 NON_RETRYABLE_CODES 定义），先短路返回
    if (NON_RETRYABLE_CODES.indexOf(code) >= 0) return false;
    if (/^08/.test(code)) return true;
    if (code === '40001') return true;
    // PostgREST 连接类错误（PGRST100 无响应 / PGRST102 网络错误 / PGRST205 连接终止，
    // 以及裸 PGRST + 连接类 message——旧版 supabase-js 的常见形态）属瞬态故障，必须可重试；
    // 语义类（PGRST116 多行、PGRST203 无记录等）不可重试
    if (/^PGRST/i.test(code)) {
      if (/^PGRST(100|102|205)$/i.test(code)) return true;
      if (/connection terminated|network|timeout|socket|fetch failed|ECONNRESET|ETIMEDOUT/i.test(message)) return true;
      return false;
    }
    // 连接池耗尽 / 服务端关停等瞬态 SQLSTATE（53 类资源不足、57 类 shutdown）
    if (/^5[37]/.test(code)) return true;
    return false;
  }
  var status = Number(
    error.status || error.statusCode ||
    (error.response && (error.response.status || error.response.statusCode))
  ) || 0;
  if (status) {
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    return false;
  }
  var name = String(error.name || '');
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  if (error instanceof TypeError && /fetch failed/i.test(message)) return true;
  // 无码错误对象：message 含连接/超时类关键词视为可重试（PostgREST 网关错误常见形态）
  if (/connection terminated|fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|timeout/i.test(message)) return true;
  return false;
}

function classifySupabaseError(error) {
  if (!error) return { retryable: false, error: null };
  var code = error.code ? String(error.code) : '';
  var message = error.message ? String(error.message) : String(error);
  var retryable = isRetryableError(error);
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
