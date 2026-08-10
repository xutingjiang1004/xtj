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
  var tokensLimit = Math.max(1, Number(raw.tokens_limit) || (isPro ? PRO_TOKEN_LIMIT : FREE_TOKEN_LIMIT));
  var searchUsed = Math.max(0, Number(raw.search_used) || 0);
  var searchLimit = raw.search_limit == null ? (isPro ? -1 : FREE_SEARCH_LIMIT) : Number(raw.search_limit);
  var tokensRemaining = Math.max(0, tokensLimit - tokensUsed);
  var searchRemaining = searchLimit < 0 ? -1 : Math.max(0, searchLimit - searchUsed);
  var percent = tokensLimit > 0 ? Math.min(100, Math.round((tokensUsed * 1000) / tokensLimit) / 10) : 100;
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
    search_unlimited: searchLimit < 0 || isPro,
    can_chat: tokensUsed < tokensLimit,
    can_search: isPro || searchUsed < (searchLimit < 0 ? Infinity : searchLimit),
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

function createAiQuota(supabase) {
  if (!supabase) throw new Error('ai-quota requires supabase client');

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
  }

  async function recordUsage(userName, usage, options) {
    options = options || {};
    var billable = computeBillableTokens(usage, options);
    var searchCount = Math.max(0, Math.floor(Number(options.search_count) || 0));
    // One chat turn that actually searched counts as 1 search credit.
    if (options.did_search && searchCount < 1) searchCount = 1;
    if (billable <= 0 && searchCount <= 0) {
      return getQuota(userName);
    }
    var prompt = Math.max(0, Math.floor(Number(usage && usage.prompt_tokens) || Number(usage && usage.input_tokens) || 0));
    var completion = Math.max(0, Math.floor(Number(usage && usage.completion_tokens) || Number(usage && usage.output_tokens) || 0));
    var reasoning = Math.max(0, Math.floor(
      Number(usage && usage.reasoning_tokens) ||
      Number(usage && usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) ||
      0
    ));
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
  }

  async function setPro(userName, active, meta) {
    meta = meta || {};
    try {
      var result = await supabase.rpc('set_ai_user_pro', {
        p_user_name: String(userName || ''),
        p_active: !!active,
        p_expires_at: meta.expires_at || null,
        p_stripe_customer_id: meta.stripe_customer_id || null,
        p_stripe_subscription_id: meta.stripe_subscription_id || null
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
