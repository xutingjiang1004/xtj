/**
 * AI token quota + Pro membership helpers.
 * Free: 100k tokens/day + 100 web searches/day
 * Pro:  1M tokens/day + unlimited searches
 *
 * Stripe is intentionally NOT wired here — only membership storage + stubs.
 */
'use strict';

var FREE_TOKEN_LIMIT = Math.max(1000, parseInt(process.env.AI_FREE_TOKEN_DAILY || '100000', 10) || 100000);
var PRO_TOKEN_LIMIT = Math.max(FREE_TOKEN_LIMIT, parseInt(process.env.AI_PRO_TOKEN_DAILY || '1000000', 10) || 1000000);
var FREE_SEARCH_LIMIT = Math.max(0, parseInt(process.env.AI_FREE_SEARCH_DAILY || '100', 10) || 100);

function limits() {
  return {
    free_token_limit: FREE_TOKEN_LIMIT,
    pro_token_limit: PRO_TOKEN_LIMIT,
    free_search_limit: FREE_SEARCH_LIMIT
  };
}

/**
 * Billable tokens: input + thinking/reasoning + output.
 * Prefer provider totals; never undercount when partial fields exist.
 */
function computeBillableTokens(usage, opts) {
  usage = usage && typeof usage === 'object' ? usage : {};
  opts = opts || {};
  var prompt = Math.max(0, Math.floor(Number(usage.prompt_tokens) || Number(usage.input_tokens) || 0));
  var completion = Math.max(0, Math.floor(Number(usage.completion_tokens) || Number(usage.output_tokens) || 0));
  var reasoning = Math.max(0, Math.floor(
    Number(usage.reasoning_tokens) ||
    Number(usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) ||
    Number(usage.output_tokens_details && usage.output_tokens_details.reasoning_tokens) ||
    0
  ));
  var total = Math.max(0, Math.floor(Number(usage.total_tokens) || 0));
  var sumParts = prompt + completion + reasoning;
  if (total > 0 || sumParts > 0) {
    return Math.max(total, sumParts);
  }
  // Fallback only when provider omitted usage entirely (should be rare).
  var msg = String(opts.message || '');
  var content = String(opts.content || '');
  var reasoningText = String(opts.reasoning || '');
  var est = Math.ceil((msg.length + content.length + reasoningText.length) / 4);
  return Math.max(1, est);
}

function normalizeQuotaPayload(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false,
      reason: 'quota_unavailable',
      plan: 'free',
      is_pro: false,
      tokens_used: 0,
      tokens_limit: FREE_TOKEN_LIMIT,
      tokens_remaining: 0,
      tokens_percent: 100,
      search_used: 0,
      search_limit: FREE_SEARCH_LIMIT,
      search_remaining: 0,
      search_unlimited: false,
      can_chat: false,
      can_search: false
    };
  }
  var isPro = raw.is_pro === true || raw.plan === 'pro';
  var tokensUsed = Math.max(0, Number(raw.tokens_used) || 0);
  // tokens_limit: -1 = 无限（与 search 语义一致）；0+ = 上限
  var tokensLimit = raw.tokens_limit == null
    ? (isPro ? PRO_TOKEN_LIMIT : FREE_TOKEN_LIMIT)
    : Number(raw.tokens_limit);
  var searchUsed = Math.max(0, Number(raw.search_used) || 0);
  // 自定义搜索额度：Pro 也可能不是无限（邀请码可配每日 N 次）
  var searchLimit = raw.search_limit == null
    ? (isPro ? -1 : FREE_SEARCH_LIMIT)
    : Number(raw.search_limit);
  var tokensUnlimited = tokensLimit < 0;
  var tokensRemaining = tokensUnlimited ? -1 : Math.max(0, tokensLimit - tokensUsed);
  var searchRemaining = searchLimit < 0 ? -1 : Math.max(0, searchLimit - searchUsed);
  var percent = !tokensUnlimited && tokensLimit > 0 ? Math.min(100, Math.round((tokensUsed * 1000) / tokensLimit) / 10) : 0;
  var searchUnlimited = searchLimit < 0;
  var canSearch = searchUnlimited || searchUsed < searchLimit;
  var canChat = tokensUnlimited || tokensUsed < tokensLimit;
  // 优先采用服务端 RPC 的权威字段
  if (typeof raw.can_search === 'boolean') canSearch = raw.can_search;
  if (typeof raw.can_chat === 'boolean') canChat = raw.can_chat;
  if (typeof raw.search_unlimited === 'boolean') searchUnlimited = raw.search_unlimited;
  if (typeof raw.tokens_unlimited === 'boolean') tokensUnlimited = raw.tokens_unlimited;
  return {
    ok: raw.ok !== false,
    user_name: raw.user_name || null,
    day_key: raw.day_key || null,
    plan: isPro ? 'pro' : 'free',
    is_pro: isPro,
    pro_expires_at: raw.pro_expires_at || null,
    tokens_used: tokensUsed,
    tokens_limit: tokensLimit,
    tokens_remaining: tokensRemaining,
    tokens_percent: typeof raw.tokens_percent === 'number' ? Number(raw.tokens_percent) : percent,
    search_used: searchUsed,
    search_limit: searchLimit,
    search_remaining: searchRemaining,
    search_unlimited: searchUnlimited,
    can_chat: canChat,
    can_search: canSearch,
    // 消费结果透传（recordUsage 后前端可知道实际扣了多少，尤其被 045/048 截断时）
    consumed_tokens: typeof raw.consumed_tokens === 'number' ? Number(raw.consumed_tokens) : null,
    consumed_search: typeof raw.consumed_search === 'number' ? Number(raw.consumed_search) : null,
    limits: limits()
  };
}

function getTokenQuotaErrorMessage(reason) {
  if (reason === 'token_limit') return '今日 AI 额度已用完，开通 Pro 可获得 10 倍额度';
  if (reason === 'search_limit') return '今日网页搜索次数已达上限，开通 Pro 可无限搜索';
  if (reason === 'quota_unavailable') return '额度服务暂不可用，请稍后重试';
  if (reason === 'no_user') return '请先登录后再使用小猫 AI';
  if (reason === 'hourly_limit') return '小猫太忙了，休息一下';
  if (reason === 'daily_limit') return '今日请求次数已达上限';
  return '今日小猫聊天额度已达上限';
}

// 归一化自定义日额度（setPro 的 token_limit_daily / search_limit_daily）：
// 非有限值（NaN / ±Infinity / 非数字字符串）回退 null（使用默认额度），
// 防止把 NaN 透传入库污染 ai_user_membership（审计 🟡：旧实现 Math.max(-1, NaN) = NaN）。
function normalizeDailyLimit(value) {
  if (value === null || value === undefined) return null;
  var num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(-1, Math.floor(num));
}

function createAiQuota(supabase) {
  if (!supabase) throw new Error('ai-quota requires supabase client');

  // 审计 🟠 TOCTOU 缓解（check/consume）：check_ai_token_quota 与 consume_ai_token_usage
  // 是两次独立 RPC，并发下 N 个请求可全部通过 check 再各自 consume，放大免费日额度。
  // 进程内按用户串行化（Map<userName, Promise>）只能缓解单进程内的竞态；
  // 真正修复依赖 DB 端把扣减原子化（consume_ai_token_usage 内以
  // UPDATE ... WHERE remaining >= cost RETURNING 原子扣减，超出本模块可见范围）。
  // 多进程部署仍需 RPC 侧原子性，本互斥不构成安全边界。
  var quotaChains = {}; // userName -> 链尾 Promise
  function runQuotaSerialized(userName, task) {
    var key = String(userName || '');
    var prev = quotaChains[key] || Promise.resolve();
    var next = prev.then(task, task);
    // 吞掉链尾拒绝：失败结果由任务自身返回给调用方，不能让链尾拒绝阻塞后续排队任务
    next.catch(function() {});
    quotaChains[key] = next;
    return next;
  }

  async function getQuota(userName) {
    try {
      var result = await supabase.rpc('get_ai_user_quota', {
        p_user_name: String(userName || ''),
        p_free_token_limit: FREE_TOKEN_LIMIT,
        p_pro_token_limit: PRO_TOKEN_LIMIT,
        p_free_search_limit: FREE_SEARCH_LIMIT
      });
      if (result.error || !result.data) {
        console.error('[AI-QUOTA] get unavailable:', result.error && result.error.message);
        return normalizeQuotaPayload({ ok: false, reason: 'quota_unavailable' });
      }
      return normalizeQuotaPayload(result.data);
    } catch (e) {
      console.error('[AI-QUOTA] get exception:', e && e.message);
      return normalizeQuotaPayload({ ok: false, reason: 'quota_unavailable' });
    }
  }

  async function checkBeforeChat(userName, needSearch) {
    return runQuotaSerialized(userName, async function() {
      try {
        var result = await supabase.rpc('check_ai_token_quota', {
          p_user_name: String(userName || ''),
          p_need_search: !!needSearch,
          p_free_token_limit: FREE_TOKEN_LIMIT,
          p_pro_token_limit: PRO_TOKEN_LIMIT,
          p_free_search_limit: FREE_SEARCH_LIMIT
        });
        if (result.error || !result.data) {
          console.error('[AI-QUOTA] check unavailable:', result.error && result.error.message);
          return { allowed: false, reason: 'quota_unavailable', quota: normalizeQuotaPayload(null) };
        }
        var data = result.data;
        return {
          allowed: data.allowed === true,
          reason: data.reason || null,
          quota: normalizeQuotaPayload(data.quota || data)
        };
      } catch (e) {
        console.error('[AI-QUOTA] check exception:', e && e.message);
        return { allowed: false, reason: 'quota_unavailable', quota: normalizeQuotaPayload(null) };
      }
    });
  }

  async function recordUsage(userName, usage, options) {
    options = options || {};
    var billable = computeBillableTokens(usage, options);
    var searchCount = Math.max(0, Math.floor(Number(options.search_count) || 0));
    // One chat turn that actually searched counts as 1 search credit.
    if (options.did_search && searchCount < 1) searchCount = 1;
    if (billable <= 0 && searchCount <= 0) {
      // 审计 🟠：零扣费路径兜底——即使 provider 完全没返回 usage 且无文本可估算，
      // 也至少计 1 token，避免"只读额度不消费"让请求永远绕开扣费。
      billable = 1;
    }
    var prompt = Math.max(0, Math.floor(Number(usage && usage.prompt_tokens) || Number(usage && usage.input_tokens) || 0));
    var completion = Math.max(0, Math.floor(Number(usage && usage.completion_tokens) || Number(usage && usage.output_tokens) || 0));
    var reasoning = Math.max(0, Math.floor(
      Number(usage && usage.reasoning_tokens) ||
      Number(usage && usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) ||
      0
    ));
    // 扣减 RPC 按用户串行化（与 checkBeforeChat 共用同一互斥链），缓解 check→consume
    // TOCTOU 并发放大；原子性仍依赖 DB RPC（见 createAiQuota 顶部注释）。
    return runQuotaSerialized(userName, async function() {
      try {
        var result = await supabase.rpc('consume_ai_token_usage', {
          p_user_name: String(userName || ''),
          p_tokens: billable,
          p_search_count: searchCount,
          p_conversation_id: options.conversation_id || null,
          p_prompt_tokens: prompt,
          p_completion_tokens: completion,
          p_reasoning_tokens: reasoning,
          p_model: options.model || null,
          p_source: options.source || 'chat',
          p_free_token_limit: FREE_TOKEN_LIMIT,
          p_pro_token_limit: PRO_TOKEN_LIMIT,
          p_free_search_limit: FREE_SEARCH_LIMIT
        });
        if (result.error || !result.data) {
          console.error('[AI-QUOTA] consume unavailable:', result.error && result.error.message);
          return normalizeQuotaPayload({ ok: false, reason: 'quota_unavailable' });
        }
        return normalizeQuotaPayload(result.data);
      } catch (e) {
        console.error('[AI-QUOTA] consume exception:', e && e.message);
        return normalizeQuotaPayload({ ok: false, reason: 'quota_unavailable' });
      }
    });
  }

  // ⚠️ 权限说明（审计 🟡）：本函数直接写 ai_user_membership（含 is_pro 与自定义额度
  // expires_at / token_limit_daily / search_limit_daily），模块内**不做任何角色校验**。
  // 调用方必须已通过管理员校验（requireAdmin）或来自受信任的 Stripe webhook /
  // 邀请码发放流程；禁止在未做权限判断的普通用户路由中调用本函数。
  async function setPro(userName, active, meta) {
    meta = meta || {};
    // 审计要求：记录 setPro 调用，便于发现非管理/webhook 入口的提权调用
    console.warn('[AI-QUOTA] setPro invoked (caller must be admin or trusted webhook-gated):', String(userName || ''), 'active=' + !!active);
    try {
      // 049 起 set_ai_user_pro 支持自定义额度列与 env limits，一次 RPC 原子完成，
      // 不再需要二次 UPDATE（此前二次写入还可能因大小写不一致匹配不到行）。
      var result = await supabase.rpc('set_ai_user_pro', {
        p_user_name: String(userName || ''),
        p_active: !!active,
        p_expires_at: meta.expires_at || null,
        p_stripe_customer_id: meta.stripe_customer_id || null,
        p_stripe_subscription_id: meta.stripe_subscription_id || null,
        p_free_token_limit: FREE_TOKEN_LIMIT,
        p_pro_token_limit: PRO_TOKEN_LIMIT,
        p_free_search_limit: FREE_SEARCH_LIMIT,
        p_token_limit_daily: meta.token_limit_daily !== undefined
          ? normalizeDailyLimit(meta.token_limit_daily)
          : null,
        p_search_limit_daily: meta.search_limit_daily !== undefined
          ? normalizeDailyLimit(meta.search_limit_daily)
          : null
      });
      if (result.error || !result.data) {
        console.error('[AI-QUOTA] setPro unavailable:', result.error && result.error.message);
        return { ok: false, reason: 'quota_unavailable' };
      }
      return normalizeQuotaPayload(result.data);
    } catch (e) {
      console.error('[AI-QUOTA] setPro exception:', e && e.message);
      return { ok: false, reason: 'quota_unavailable' };
    }
  }

  return {
    limits: limits,
    computeBillableTokens: computeBillableTokens,
    normalizeQuotaPayload: normalizeQuotaPayload,
    getQuota: getQuota,
    checkBeforeChat: checkBeforeChat,
    recordUsage: recordUsage,
    setPro: setPro
  };
}

module.exports = {
  FREE_TOKEN_LIMIT: FREE_TOKEN_LIMIT,
  PRO_TOKEN_LIMIT: PRO_TOKEN_LIMIT,
  FREE_SEARCH_LIMIT: FREE_SEARCH_LIMIT,
  limits: limits,
  computeBillableTokens: computeBillableTokens,
  normalizeQuotaPayload: normalizeQuotaPayload,
  getTokenQuotaErrorMessage: getTokenQuotaErrorMessage,
  createAiQuota: createAiQuota
};
