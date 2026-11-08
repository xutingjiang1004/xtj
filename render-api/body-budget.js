'use strict';
// 大请求体的全局内存预算。
//
// AI 对话接口为了带附件，JSON 解析上限是 80MB。每用户并发只有 2 个，但账号可以开很多个，
// 而 express.json 会把整个请求体读进内存再解析（Buffer + 字符串 + 对象，实际占用约为体积的 2~3 倍），
// 几个账号同时发大请求就能把只有几百 MB 的实例打垮。照片上传早有「全局缓冲字节预算」，这里给 AI 接口补上同样的闸：
// 按声明的 Content-Length（缺失时按解析上限）预留，响应结束时归还；超出预算返回可重试的 429。
// 小请求（默认 1MB 以内）不占预算，普通聊天不受影响。
const DEFAULT_BUDGET_MB = 160;
const SMALL_BODY_BYTES = 1024 * 1024;

function budgetBytes(env) {
  const raw = Number((env || process.env).AI_BODY_BUDGET_MB);
  const mb = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BUDGET_MB;
  return Math.floor(mb * 1024 * 1024);
}

function createBodyBudget(options) {
  const opts = options || {};
  const maxBytes = opts.maxBytes || budgetBytes();
  const parserLimit = opts.parserLimit || 80 * 1024 * 1024;
  let reserved = 0;
  function middleware(req, res, next) {
    const header = String(req.headers['content-length'] || '');
    const declared = /^\d+$/.test(header) ? Number(header) : NaN;
    // 没有声明长度（分块传输）时按解析上限预留，不能让它绕过预算。
    const bytes = Number.isSafeInteger(declared) ? declared : parserLimit;
    if (bytes <= SMALL_BODY_BYTES) return next();
    if (reserved + bytes > maxBytes) {
      res.set('Retry-After', '5');
      return res.status(429).json({ ok: false, code: 'ai_body_busy', retryable: true, retry_after: 5, error: '服务器正在处理其他大文件请求，请稍后再试' });
    }
    reserved += bytes;
    let released = false;
    const release = () => { if (released) return; released = true; reserved -= bytes; };
    res.once('finish', release);
    res.once('close', release);
    return next();
  }
  middleware.reserved = () => reserved;
  return middleware;
}

// 先过预算，再交给 JSON 解析器。
function withBodyBudget(jsonMiddleware, options) {
  const budget = createBodyBudget(options);
  const chained = function (req, res, next) {
    return budget(req, res, function (error) {
      if (error) return next(error);
      return jsonMiddleware(req, res, next);
    });
  };
  chained.reserved = budget.reserved;
  return chained;
}

module.exports = { createBodyBudget, withBodyBudget, budgetBytes, DEFAULT_BUDGET_MB, SMALL_BODY_BYTES };
