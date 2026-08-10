/**
 * 爱发电（afdian）支付集成 — Pro 会员自动开通。
 *
 * 官方文档：https://guide.afdian.com/creator/developer
 * - Webhook：平台订单成功时推送，需返回 {"ec":200,"em":""} 表示收到。
 * - API：主动查询订单（用于兜底对账），签名 sign = md5(token + "params" + params + "ts" + ts + "user_id" + user_id)
 *
 * 依赖环境变量：
 *   AFDIAN_USER_ID   爱发电开发者 user_id（后台 /dashboard/dev）
 *   AFDIAN_API_TOKEN 爱发电 API token（仅参与签名，不传输）
 *   AFDIAN_WEBHOOK_TOKEN 爱发电 Webhook Token（回调验签）
 *   AFDIAN_PLAN_ID   Pro 方案 plan_id（订单里校验是否购买 Pro）
 */
'use strict';

var crypto = require('crypto');

function md5(str) {
  return crypto.createHash('md5').update(String(str || '')).digest('hex');
}

// 爱发电 Webhook 回调验签：Header `X-Afdian-Token` 需等于配置的 Webhook Token。
function verifyWebhookToken(req, token) {
  if (!token) return false;
  var header = String((req.headers['x-afdian-token'] || req.headers['x-afdian-sign'] || '')).trim();
  // 兼容：部分配置把 token 放在 query 的 afdian_token
  var queryToken = String((req.query && req.query.afdian_token) || '').trim();
  return header === token || queryToken === token;
}

// 主动查询订单 API 签名
function buildApiSign(userId, token, params, ts) {
  // sign = md5(token + "params" + params + "ts" + ts + "user_id" + user_id)
  return md5(String(token) + 'params' + String(params) + 'ts' + String(ts) + 'user_id' + String(userId));
}

/**
 * 生成爱发电跳转支付链接（不依赖官方 SDK）。
 * 爱发电没有开放"创建订单"的 API，跳转链接指向创作者主页的方案，
 * 用户付款后由 Webhook 通知。
 */
function buildCheckoutUrl(cfg) {
  var base = 'https://afdian.com/a/' + String(cfg.userId || '').trim();
  if (cfg.planId) {
    base += '?plan=' + encodeURIComponent(cfg.planId);
  }
  return base;
}

/**
 * 校验 Webhook 回调的订单是否为 Pro 方案的成功订单。
 * 返回 { ok, order }，失败返回 { ok:false, reason }。
 */
function parseOrderNotification(body, cfg) {
  if (!body || typeof body !== 'object') {
    return { ok: false, reason: 'invalid_body' };
  }
  // 顶层 ec/em 是爱发电的返回标识（非错误时也是 200）
  var data = body.data;
  if (!data || !data.order) {
    return { ok: false, reason: 'no_order' };
  }
  var order = data.order;
  // status 2 = 交易成功
  if (Number(order.status) !== 2) {
    return { ok: false, reason: 'order_not_paid', status: order.status };
  }
  // 校验 plan_id 匹配（配置了才校验）
  if (cfg.planId && String(order.plan_id || '') !== String(cfg.planId).trim()) {
    return { ok: false, reason: 'plan_mismatch', plan_id: order.plan_id };
  }
  return { ok: true, order: order };
}

/**
 * 根据订单内容计算 Pro 到期时间。
 * 爱发电的 month 字段是订阅月数（如 1/3/6/12），从当前时间开始叠加。
 */
function computeExpiry(months, nowMs) {
  months = Math.max(1, parseInt(months, 10) || 1);
  if (months > 120) months = 120;
  return new Date((nowMs || Date.now()) + months * 30 * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * 幂等处理：订单号已存在则跳过重复开通。
 * 需要外部提供 dedupe 函数：async (outTradeNo) => boolean（是否已处理过）
 * 以及 markProcessed 函数：async (outTradeNo, meta) => void
 */
async function handleOrderDedupe(dedupe, markProcessed, order, cfg, nowMs) {
  var outTradeNo = String((order && order.out_trade_no) || '').trim();
  if (!outTradeNo) return { ok: false, reason: 'no_trade_no' };
  try {
    if (dedupe && await dedupe(outTradeNo)) {
      return { ok: true, duplicated: true, order: order };
    }
    var expiresAt = computeExpiry(order.month, nowMs);
    if (markProcessed) {
      await markProcessed(outTradeNo, { expires_at: expiresAt, order: order });
    }
    return { ok: true, duplicated: false, order: order, expires_at: expiresAt };
  } catch (e) {
    return { ok: false, reason: 'dedupe_error', error: e && e.message };
  }
}

module.exports = {
  md5: md5,
  verifyWebhookToken: verifyWebhookToken,
  buildApiSign: buildApiSign,
  buildCheckoutUrl: buildCheckoutUrl,
  parseOrderNotification: parseOrderNotification,
  computeExpiry: computeExpiry,
  handleOrderDedupe: handleOrderDedupe
};
