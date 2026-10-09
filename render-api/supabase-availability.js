'use strict';
const QUOTA_CODE = 'egress_quota_exceeded';
const QUOTA_MESSAGE = '网站数据服务流量额度已用完，服务暂时受限，请等待恢复';
function createSupabaseAvailability({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  let restrictedAt = 0, sequence = 0, observed = 0;
  function restricted() { return restrictedAt > 0 && now() - restrictedAt < 60000; }
  async function transport(...args) {
    const order = ++sequence, response = await fetchImpl(...args);
    let limited = false;
    if (response.status === 402) {
      try { limited = /exceed_egress_quota/.test(await response.clone().text()); } catch (_) {}
    }
    if (order >= observed && (limited || response.ok)) {
      observed = order; restrictedAt = limited ? now() : 0;
    }
    return response;
  }
  function middleware(req, res, next) {
    if (!/^(?:\/api\/(?:user|profile|photos?|post|feed|uploads)(?:\/|$)|\/health$|\/admin\/login$)/.test(req.path)) return next();
    const json = res.json;
    res.json = function (body) {
      if (res.statusCode >= 500 && restricted()) {
        res.status(402).set('X-XTJ-Service-Status', QUOTA_CODE).set('Cache-Control', 'no-store');
        body = Object.assign({}, body, { ok: false, code: QUOTA_CODE, error: QUOTA_MESSAGE, retryable: false });
      }
      return json.call(this, body);
    };
    next();
  }
  return { transport, middleware, restricted, message: QUOTA_MESSAGE };
}
module.exports = { createSupabaseAvailability, QUOTA_CODE, QUOTA_MESSAGE };
