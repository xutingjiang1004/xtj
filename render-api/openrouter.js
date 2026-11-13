'use strict';

// This integration deliberately has no BYOK, arbitrary model or paid fallback.
// ★ 2026-10-27：原模型 minimax/minimax-m3.1-flash:free 已被 OpenRouter 下架（免费池里
//   已不存在该 :free 变体，只剩付费版），而本集成强制 max_price=0，因此必然 404。
//   现默认改用 nvidia/nemotron-3.5-lightning:free（100 万上下文、免费）。
//   模型标识做成**可配置**，免费模型下架时不必再改代码发版：设环境变量
//   OPENROUTER_MODEL=<openrouter 模型 id> 即可切换，前端目录随之后端返回。
// 免费池中参数量最大、综合能力最强的通用模型：550B MoE（55B 激活），100 万上下文。
const MODEL_DEFAULT = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const LABEL_DEFAULT = 'Nemotron 3 Ultra 550B 免费版';
const BASE_URL = 'https://openrouter.ai/api/v1';
// 兼容旧标识：前端与历史数据仍以 or_minimax_m31_free 作为托管模型 uid，
// 改模型不影响前端选择逻辑与已保存的引用。
const MODEL_UID = 'or_minimax_m31_free';
function modelId(env = process.env) {
  const raw = String(env.OPENROUTER_MODEL || '').trim();
  // 只接受 OpenRouter 风格的 model id，杜绝注入任意地址或付费别名。
  return /^[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(raw) && raw.endsWith(':free') ? raw : MODEL_DEFAULT;
}
function modelLabel(env = process.env) {
  const raw = String(env.OPENROUTER_MODEL_LABEL || '').trim();
  return raw ? raw.slice(0, 80) : LABEL_DEFAULT;
}
// ★ 2026-11-13 限时开放 15 天：站长把这个托管模型开放给所有用户（含未登录游客），
//   截止 2026-11-28 23:59:59 GMT+8（Unix 毫秒 1795881599000），与 server.js 的
//   GUEST_AI_OPEN_UNTIL 完全一致。用**绝对截止时间戳**而非「服务启动后 N 小时」——
//   后者在 Render 重启/重新部署后会被重置，变相变成无限期开放。
//   ★ 2026-11-13 限时开放 15 天：到期自动失效，无需改代码/无需重新部署/无需改环境变量，
//   publicWindowOpen() 到点自动返回 false，游客回落「仅站长」，窗口外一切回落原状。
const PUBLIC_UNTIL_DEFAULT = '2026-11-28T23:59:59+08:00';
const PUBLIC_CODE = 'OPENROUTER_PUBLIC_WINDOW';
const PUBLIC_ENDED_CODE = 'OPENROUTER_PUBLIC_ENDED';
function failure(code, message, status = 502, retryAfter) {
  const error = new Error(message);
  error.code = code;
  error.http_status = status;
  if (retryAfter != null && /^\d{1,6}$/.test(String(retryAfter))) error.retry_after = Number(retryAfter);
  return error;
}
// ★ 2026-11-13 限时开放 15 天：窗口判定改为纯硬编码，不再读取 OPENROUTER_PUBLIC_UNTIL，
//   避免 Render 残留上次 24 小时公开期的旧环境变量值覆盖新默认值、导致窗口打不开或永久开放；
//   与 server.js 的 guestAiPublicWindowOpen() 一样不依赖任何环境变量配置。
//   保留 env 入参仅为兼容既有调用签名；非法时间戳一律回退到默认绝对时间戳。
function publicUntil(env = process.env) {
  const raw = String(PUBLIC_UNTIL_DEFAULT).trim();
  if (/^\d{10,13}$/.test(raw)) {
    const ms = Number(raw);
    return ms < 1e12 ? ms * 1000 : ms;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Date.parse(PUBLIC_UNTIL_DEFAULT);
}
// 公开期是否仍然有效。过期后立即关闭，无需重新部署。
function publicWindowOpen(env = process.env, now = Date.now()) {
  return now < publicUntil(env);
}
function publicRemainingMs(env = process.env, now = Date.now()) {
  return Math.max(0, publicUntil(env) - now);
}
// 公开期内的访问者（含未登录游客）是否放行。站长永远放行。
function publicAllowed(userName, ownerName) {
  return !!userName && userName === ownerName;
}
function resolveConfig(userName, ownerName, input = {}, env = process.env) {
  // ★ 2026-11-13 限时开放 15 天：公开期内所有用户（含未登录游客）都可匿名访问；
  //   到期后 publicWindowOpen() 变 false，自动回退为仅站长（下方 OPENROUTER_PUBLIC_ENDED）。
  //   ★ 安全红线：模型、地址、Key 仍然全部由服务端锁定，下面的锁定校验一字未改，
  //   游客/BYOK 不能借此指定任意模型 ID、上游地址或 API Key。
  const owner = publicAllowed(userName, ownerName);
  if (!owner && !publicWindowOpen(env)) {
    // ★ 2026-11-13 限时开放 15 天：仅去掉过期的「24 小时」旧文案，错误码与「窗口外仅站长」语义不变
    throw failure(PUBLIC_ENDED_CODE, '限时开放的游客 AI 体验已结束，该模型恢复为仅站长可用', 403);
  }
  const model = modelId(env);
  if (input.provider && input.provider !== 'openrouter' || input.model && input.model !== model ||
      input.model_uid && input.model_uid !== MODEL_UID || input.base_url && (typeof input.base_url !== 'string' || input.base_url.replace(/\/+$/, '') !== BASE_URL) || input.api_key) {
    throw failure('OPENROUTER_FIXED_FREE_MODEL', '仅允许站长后端配置的免费模型，不能替换 Key、地址或模型', 400);
  }
  const key = String(env.OPENROUTER_API_KEY || '').trim();
  if (!key) throw failure('OPENROUTER_NOT_CONFIGURED', '请在后端配置 OPENROUTER_API_KEY 后重新部署服务', 503);
  const config = {provider:'openrouter',model:model,base_url:BASE_URL,uid:MODEL_UID,model_uid:MODEL_UID,server_managed:true};
  // Do not serialize credentials into checkpoints, histories or diagnostics.
  Object.defineProperty(config, 'api_key', {value:key,enumerable:false});
  return config;
}
function catalog(userName, ownerName, env = process.env) {
  if (!String(env.OPENROUTER_API_KEY || '').trim()) return [];
  // ★ 2026-11-13 限时开放 15 天：窗口内游客可读托管模型目录；到期 publicWindowOpen() 变 false 自动仅站长可见（逻辑随常量生效，无需改代码）
  if (!publicAllowed(userName, ownerName) && !publicWindowOpen(env)) return [];
  const open = !publicAllowed(userName, ownerName);
  return [{uid:MODEL_UID,provider:'openrouter',provider_label:'OpenRouter',label:modelLabel(env),
    model:modelId(env),base_url:BASE_URL,server_managed:true,public_access:open,public_until:publicUntil(env)}];
}
function freePayload(payload, env = process.env) {
  // Never accept routing aliases, :online, plugins, or a paid provider fallback.
  const out = {...payload,model:modelId(env),plugins:['web','file-parser','response-healing','fusion','pareto-router'].map(id => ({id,enabled:false})),provider:{allow_fallbacks:false,require_parameters:true,
    max_price:{prompt:0,completion:0,request:0,image:0}}};
  delete out.models;
  delete out.route;
  return out;
}
// ★ 2026-11-13 限时开放 15 天：预判函数改为「窗口内一律放行」——不再要求
//   X-XTJ-Model-Uid 头、不再只认 or_minimax_m31_free 单一托管模型、不再只认 provider=openrouter，
//   游客可用服务端目录内任意模型（自定义/第三方链路）；窗口外保留原「仅托管模型」预判兜底。
//   ★ 安全红线：这里只决定「是否允许匿名访问」，模型、地址、Key 仍由 resolveConfig 全部锁定，
//   游客/BYOK 不能借此指定任意上游 API 地址、API Key 或任意模型 ID。
function requestsOpenRouter(req, env = process.env, now = Date.now()) {
  // ★ 2026-11-13 限时开放 15 天：窗口内对所有请求放行全部模型，到期自动失效
  if (publicWindowOpen(env, now)) return true;
  try {
    const uid = String(req.headers['x-xtj-model-uid'] || '').trim().toLowerCase();
    if (uid === MODEL_UID) return true;
    // body 已在部分路由被解析（小体积接口），此时也能判断；大体积路由 body 尚未解析，
    // 依赖上面的请求头预判，不会因为读 body 而提前分配内存。
    const body = req.body;
    if (body && typeof body === 'object' && String(body.provider || '').trim().toLowerCase() === 'openrouter') return true;
  } catch (_) {}
  return false;
}
// 请求是否携带了 Bearer 凭证。带了凭证的请求必须走完整认证（否则已登录用户
// 会被降级成游客：个人自定义模型失效、额度不记账、封禁状态被绕过）。
function hasCredentials(req) {
  try {
    const auth = String(req.headers && req.headers.authorization || '');
    return auth.startsWith('Bearer ') && auth.slice(7).trim().length > 0;
  } catch (_) {}
  return false;
}
// ★ 2026-11-13 限时开放 15 天：游客鉴权窗口内统一放开——chat（allowAnonymous=false）
//   与 catalog（allowAnonymous=true）都放行全部匿名请求并置 req.guestAi=true
//   （server.js 所有游客分支依赖该标记）；不再要求 X-XTJ-Model-Uid 头、不再只认单一托管模型。
//   窗口外一律回落 authenticateUser，到期自动失效、回落原状。
//   allowAnonymous=true 分支仅跳过预判、不跳过下面的游客标记设置，故两个分支都会置 req.guestAi。
//   ★ 安全红线：只放开「是否允许匿名访问」这层；模型、地址、Key 仍全部由 resolveConfig 服务端锁定。
function createGuestOpenRouterAuth({ authenticateUser, env = process.env, now = () => Date.now(), allowAnonymous = false }) {
  return async function guestOpenRouterAuth(req, res, next) {
    // ★ 2026-11-13 限时开放 15 天：窗口外一切回落登录鉴权，到期自动失效
    if (!publicWindowOpen(env, now())) return authenticateUser(req, res, next);
    // 已登录（携带凭证）的请求一律走真实认证，保留封禁/账号状态等全部校验。
    if (hasCredentials(req)) return authenticateUser(req, res, next);
    // ★ 2026-11-13 限时开放 15 天：窗口内 requestsOpenRouter 恒放行，chat/catalog 一致通过；
    //   传入 env/now() 使预判与上面的窗口判定同源。
    if (!allowAnonymous && !requestsOpenRouter(req, env, now())) return authenticateUser(req, res, next);
    req.guestAi = true;
    req.userName = '';
    req.accountId = '';
    req.openRouterGuest = true;
    return next();
  };
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
module.exports = {MODEL:MODEL_DEFAULT,BASE_URL,MODEL_UID,MODEL_DEFAULT,modelId,modelLabel,resolveConfig,catalog,freePayload,upstreamError,checkPacket,appendReasoning,event,isError,
  publicWindowOpen,publicUntil,publicRemainingMs,publicAllowed,requestsOpenRouter,createGuestOpenRouterAuth,
  PUBLIC_UNTIL_DEFAULT,PUBLIC_CODE,PUBLIC_ENDED_CODE};
