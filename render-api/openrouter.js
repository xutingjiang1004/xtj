'use strict';

// This integration deliberately has no BYOK, arbitrary model or paid fallback.
const MODEL = 'minimax/minimax-m3.1-flash:free';
const BASE_URL = 'https://openrouter.ai/api/v1';
const MODEL_UID = 'or_minimax_m31_free';
function failure(code, message, status = 502, retryAfter) {
  const error = new Error(message);
  error.code = code;
  error.http_status = status;
  if (retryAfter != null && /^\d{1,6}$/.test(String(retryAfter))) error.retry_after = Number(retryAfter);
  return error;
}
function resolveConfig(userName, ownerName, input = {}, env = process.env) {
  if (!userName || userName !== ownerName) throw failure('OPENROUTER_OWNER_ONLY', '此 OpenRouter 模型仅授权站长使用', 403);
  if (input.provider && input.provider !== 'openrouter' || input.model && input.model !== MODEL ||
      input.model_uid && input.model_uid !== MODEL_UID || input.base_url && (typeof input.base_url !== 'string' || input.base_url.replace(/\/+$/, '') !== BASE_URL) || input.api_key) {
    throw failure('OPENROUTER_FIXED_FREE_MODEL', '仅允许站长后端配置的 MiniMax M3.1 Flash 免费模型，不能替换 Key、地址或模型', 400);
  }
  const key = String(env.OPENROUTER_API_KEY || '').trim();
  if (!key) throw failure('OPENROUTER_NOT_CONFIGURED', '请在后端配置 OPENROUTER_API_KEY 后重新部署服务', 503);
  const config = {provider:'openrouter',model:MODEL,base_url:BASE_URL,uid:MODEL_UID,model_uid:MODEL_UID,server_managed:true};
  // Do not serialize credentials into checkpoints, histories or diagnostics.
  Object.defineProperty(config, 'api_key', {value:key,enumerable:false});
  return config;
}
function catalog(userName, ownerName, env = process.env) {
  if (!userName || userName !== ownerName || !String(env.OPENROUTER_API_KEY || '').trim()) return [];
  return [{uid:MODEL_UID,provider:'openrouter',provider_label:'OpenRouter',label:'MiniMax M3.1 Flash 免费版',
    model:MODEL,base_url:BASE_URL,server_managed:true}];
}
function freePayload(payload) {
  // Never accept routing aliases, :online, plugins, or a paid provider fallback.
  const out = {...payload,model:MODEL,plugins:['web','file-parser','response-healing','fusion','pareto-router'].map(id => ({id,enabled:false})),provider:{allow_fallbacks:false,require_parameters:true,
    max_price:{prompt:0,completion:0,request:0,image:0}}};
  delete out.models;
  delete out.route;
  return out;
}
function upstreamError(status, retryAfter) {
  status = Number(status) || 502;
  if (status === 401) return failure('OPENROUTER_AUTH', 'OpenRouter 鉴权失败，请站长检查后端 Key', 401);
  if (status === 403) return failure('OPENROUTER_PERMISSION', 'OpenRouter 拒绝访问，请检查 Key 权限、账户限制及隐私设置', 403);
  if (status === 402) return failure('OPENROUTER_BALANCE', 'OpenRouter 账户余额或预算不足；即使免费模型也可能被账户限制。未切换付费模型', 402);
  if (status === 429) return failure('OPENROUTER_FREE_LIMIT', 'OpenRouter 免费请求额度已用完或服务商限流，请等待额度恢复后重试。未切换付费模型', 429, retryAfter);
  if (status === 404 || status === 503) return failure('OPENROUTER_MODEL_UNAVAILABLE', 'MiniMax 免费模型暂不可用或没有满足零价格限制的服务商，请稍后重试', status);
  if (status === 408 || status === 504) return failure('OPENROUTER_TIMEOUT', 'OpenRouter 响应超时，已保留收到的内容，请稍后重试', 504);
  if (status === 400 || status === 422) return failure('OPENROUTER_CAPABILITY', 'MiniMax 免费接口拒绝了本次参数、工具或图片。请使用模型能力检测核实支持情况；未移除附件或切换模型', status);
  return failure('OPENROUTER_UPSTREAM', 'OpenRouter 请求失败，请稍后重试；未切换付费模型', status);
}
function checkPacket(packet) {
  const choice = packet && packet.choices && packet.choices[0];
  if (packet && packet.error || choice && choice.finish_reason === 'error') {
    throw upstreamError(packet && packet.error && packet.error.code);
  }
  return packet;
}
function appendReasoning(target, details) {
  for (const detail of details || []) {
    if (!detail || typeof detail !== 'object') continue;
    const previous = target.find(item => item.index === detail.index && item.type === detail.type && (!detail.id || !item.id || item.id === detail.id));
    if (!previous) target.push({...detail});
    else for (const [key,value] of Object.entries(detail)) {
      if ((key === 'text' || key === 'data') && typeof value === 'string') previous[key] = (previous[key] || '') + value;
      else previous[key] = value;
    }
  }
}
function event(error) {
  return {type:'error',code:error.code,error:error.message,http_status:error.http_status,retry_after:error.retry_after};
}
function isError(error) { return !!(error && /^OPENROUTER_/.test(error.code || '')); }
module.exports = {MODEL,BASE_URL,MODEL_UID,resolveConfig,catalog,freePayload,upstreamError,checkPacket,appendReasoning,event,isError};
