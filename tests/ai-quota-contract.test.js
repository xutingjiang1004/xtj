'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const quotaMod = require(path.join(ROOT, 'render-api', 'ai-quota.js'));
const serverSource = fs.readFileSync(path.join(ROOT, 'render-api', 'server.js'), 'utf8');
const agentSource = fs.readFileSync(path.join(ROOT, 'js', 'ai-agent.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '041_ai_token_quota_and_pro.sql'),
  'utf8'
);

test('billable tokens include prompt + completion + reasoning and never undercount total', () => {
  assert.equal(quotaMod.computeBillableTokens({
    prompt_tokens: 100,
    completion_tokens: 50,
    reasoning_tokens: 30
  }), 180);

  assert.equal(quotaMod.computeBillableTokens({
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 200
  }), 200);

  assert.equal(quotaMod.computeBillableTokens({
    prompt_tokens: 10,
    completion_tokens: 5,
    reasoning_tokens: 20,
    total_tokens: 15
  }), 35);

  // fallback estimate when provider omits usage
  var est = quotaMod.computeBillableTokens(null, {
    message: 'hello world',
    content: 'reply text here',
    reasoning: 'think'
  });
  assert.ok(est >= 1);
});

test('quota defaults match free 100k / pro 1M / free search 100', () => {
  assert.equal(quotaMod.FREE_TOKEN_LIMIT, 100000);
  assert.equal(quotaMod.PRO_TOKEN_LIMIT, 1000000);
  assert.equal(quotaMod.FREE_SEARCH_LIMIT, 100);
  var lim = quotaMod.limits();
  assert.equal(lim.free_token_limit, 100000);
  assert.equal(lim.pro_token_limit, 1000000);
  assert.equal(lim.free_search_limit, 100);
});

test('migration defines token quota tables and RPCs', () => {
  assert.match(migration, /ai_user_quota_daily/);
  assert.match(migration, /ai_user_membership/);
  assert.match(migration, /ai_token_usage_events/);
  assert.match(migration, /get_ai_user_quota/);
  assert.match(migration, /check_ai_token_quota/);
  assert.match(migration, /consume_ai_token_usage/);
  assert.match(migration, /set_ai_user_pro/);
  assert.match(migration, /100000/);
  assert.match(migration, /1000000/);
});

test('server wires token quota gates, recording, and invite-code integration', () => {
  assert.match(serverSource, /createAiQuota/);
  assert.match(serverSource, /enforceAiChatAccess/);
  assert.match(serverSource, /recordAiTurnUsage/);
  assert.match(serverSource, /app\.get\('\/api\/agent\/quota'/);
  assert.match(serverSource, /app\.post\('\/api\/agent\/pro\/checkout'/);
  assert.match(serverSource, /app\.post\('\/api\/agent\/pro\/activate'/);
  assert.match(serverSource, /app\.post\('\/api\/agent\/invite\/validate'/);
  assert.match(serverSource, /app\.post\('\/api\/agent\/invite\/redeem'/);
  assert.match(serverSource, /app\.post\('\/admin\/ai-agent\/invite-codes'/);
  assert.match(serverSource, /app\.get\('\/admin\/ai-agent\/invite-codes'/);
  assert.match(serverSource, /app\.delete\('\/admin\/ai-agent\/invite-codes\/:code'/);
  assert.match(serverSource, /app\.get\('\/admin\/ai-agent\/pro-users'/);
  assert.match(serverSource, /app\.get\('\/admin\/ai-agent\/invite-redemptions'/);
  assert.match(serverSource, /token_limit/);
  assert.match(serverSource, /search_limit/);
  // 已移除爱发电支付
  assert.doesNotMatch(serverSource, /afdian/);
  assert.doesNotMatch(serverSource, /AFDIAN/);
  assert.doesNotMatch(serverSource, /stripe_not_configured/);
  assert.doesNotMatch(serverSource, /app\.post\('\/api\/agent\/pro\/webhook'/);
  // 深入研究共用额度
  assert.match(serverSource, /app\.post\('\/api\/agent\/research\/stream'/);
  assert.match(serverSource, /researchGate = await enforceAiChatAccess/);
  assert.match(serverSource, /source: 'deep_research'/);
  assert.match(serverSource, /accumulateResearchUsage/);
  // Code 路由注入共用额度
  assert.match(serverSource, /enforceAiChatAccess: enforceAiChatAccess/);
  assert.match(serverSource, /recordAiTurnUsage: recordAiTurnUsage/);
});

test('code agent bills shared token quota', () => {
  const codeSource = fs.readFileSync(path.join(ROOT, 'render-api', 'code-agent.js'), 'utf8');
  assert.match(codeSource, /gateCodeQuota/);
  assert.match(codeSource, /billCodeUsage/);
  assert.match(codeSource, /source: 'code_chat'/);
  assert.match(codeSource, /source: 'code_chat_stream'/);
  assert.match(codeSource, /token_limit/);
});

test('frontend + menu has quota bar, pro card, ceremony, and secondary model/think pages', () => {
  assert.match(agentSource, /aiQuotaCard/);
  assert.match(agentSource, /aiQuotaBarFill/);
  assert.match(agentSource, /aiProOpenBtn/);
  assert.match(agentSource, /data-action="open-model"/);
  assert.match(agentSource, /data-action="open-think"/);
  assert.match(agentSource, /fetchAiQuota/);
  assert.match(agentSource, /canSendWithQuota/);
  assert.match(agentSource, /startQuotaPolling/);
  assert.match(agentSource, /showInviteCodeModal|invite\/redeem/);
  assert.match(agentSource, /playProActivatedCeremony/);
  assert.match(agentSource, /ai-pro-activate-overlay/);
  assert.match(agentSource, /forceCeremony/);
  // Pro 庆祝弹窗只在开通当下播一次，禁止每次进站用 null→pro 误触发
  assert.match(agentSource, /hadPriorQuota/);
  assert.match(agentSource, /markProCeremonySeen/);
  assert.match(agentSource, /already_redeemed/);
});

test('quota error messages distinguish token and search limits', () => {
  assert.match(quotaMod.getTokenQuotaErrorMessage('token_limit'), /额度已用完/);
  assert.match(quotaMod.getTokenQuotaErrorMessage('search_limit'), /搜索次数/);
  assert.match(quotaMod.getTokenQuotaErrorMessage('quota_unavailable'), /暂不可用/);
});

test('invite-code Pro flow is wired and payment channels removed', () => {
  const mig043 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/043_invite_code_pro.sql'), 'utf8');
  const mig044 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/044_invite_code_case_and_idempotent.sql'), 'utf8');
  assert.match(mig043, /ai_invite_codes/);
  assert.match(mig043, /ai_invite_redemptions/);
  assert.match(mig043, /token_limit_daily/);
  assert.match(mig044, /upper\(code\)/);
  assert.match(mig044, /already_redeemed/);
  assert.match(serverSource, /\/api\/agent\/invite\/validate/);
  assert.match(serverSource, /\/api\/agent\/invite\/redeem/);
  assert.match(serverSource, /\/admin\/ai-agent\/invite-codes/);
  assert.match(serverSource, /\/admin\/ai-agent\/pro-users\/cancel/);
  assert.doesNotMatch(serverSource, /afdian-pay|AFDIAN_/);
  assert.match(agentSource, /showInviteCodeModal|aiInviteModal/);
  assert.match(agentSource, /\/invite\/redeem/);
});

test('normalizeQuotaPayload respects custom Pro search limits', () => {
  const q = quotaMod.normalizeQuotaPayload({
    ok: true,
    is_pro: true,
    plan: 'pro',
    tokens_used: 10,
    tokens_limit: 50000,
    search_used: 20,
    search_limit: 20,
    can_chat: true,
    can_search: false,
    search_unlimited: false
  });
  assert.equal(q.is_pro, true);
  assert.equal(q.tokens_limit, 50000);
  assert.equal(q.search_limit, 20);
  assert.equal(q.search_unlimited, false);
  assert.equal(q.can_search, false);
});

test('invite migration defines tables and RPCs', () => {
  const inviteMigration = fs.readFileSync(
    path.join(ROOT, 'supabase', 'migrations', '043_invite_code_pro.sql'),
    'utf8'
  );
  assert.match(inviteMigration, /ai_invite_codes/);
  assert.match(inviteMigration, /ai_invite_redemptions/);
  assert.match(inviteMigration, /token_limit_daily/);
  assert.match(inviteMigration, /search_limit_daily/);
  assert.match(inviteMigration, /validate_ai_invite_code/);
  assert.match(inviteMigration, /redeem_ai_invite_code/);
  assert.match(inviteMigration, /max_uses/);
  assert.match(inviteMigration, /used_count/);
  // 自定义额度解析：自定义 > Pro 固定 > 免费
  assert.match(inviteMigration, /v_custom_token/);
  assert.match(inviteMigration, /v_custom_search/);
});

// ===================== 审计回归（2026-08-11） =====================

test('audit: -1 unlimited token does not block sending (frontend canSendWithQuota)', () => {
  // 回归：tokens_remaining = -1 时 `tokens_remaining <= 0` 会误拦无限额度用户
  const unlimited = quotaMod.normalizeQuotaPayload({
    ok: true, is_pro: true, plan: 'pro',
    tokens_used: 100, tokens_limit: -1, tokens_remaining: -1,
    search_used: 0, search_limit: -1, search_unlimited: true,
    can_chat: true, can_search: true
  });
  assert.equal(unlimited.tokens_limit, -1);
  assert.equal(unlimited.tokens_remaining, -1);
  assert.equal(unlimited.can_chat, true);
  // 前端判定逻辑：-1 时不能因 remaining<=0 拦截
  assert.ok(!(unlimited.tokens_remaining <= 0 && unlimited.tokens_limit !== -1));
});

test('audit: cancel-Pro is a transactional RPC (049)', () => {
  const mig049 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/049_audit_fixes.sql'), 'utf8');
  assert.match(mig049, /cancel_ai_user_pro/);
  assert.match(mig049, /UPDATE public\.ai_user_membership/);
  assert.match(mig049, /DELETE FROM public\.ai_user_quota_daily/);
  // server.js 的 cancel 端点必须调 RPC（而非两条裸 SQL）
  assert.match(serverSource, /rpc\('cancel_ai_user_pro'/);
  // set_ai_user_pro 新增 limits 参数
  assert.match(mig049, /p_token_limit_daily/);
  assert.match(mig049, /p_search_limit_daily/);
  // limit 列 CHECK 约束
  assert.match(mig049, /ai_invite_codes_token_limit_daily_check/);
  assert.match(mig049, /ai_user_membership_token_limit_daily_check/);
});

test('audit: code-agent web_search is quota-enforced via userId passthrough', () => {
  const codeSource = fs.readFileSync(path.join(ROOT, 'render-api/code-agent.js'), 'utf8');
  assert.match(codeSource, /userId: scope && scope\.userId/);
  assert.match(codeSource, /options\.webSearch\(/);
  assert.match(codeSource, /options\.userId \|\| ''/);
  assert.match(serverSource, /searchWebForUser\(userId, query, maxResults\)/);
});

test('audit: post-tools 429 carries quota for frontend refresh', () => {
  assert.match(serverSource, /toolAccess\.quota \|\| null/);
});

test('audit: deep-think workers and FC preflight searches are quota-enforced', () => {
  // buildToolExecutor 透传 userName → executeToolCall 做搜索配额校验（S1 修复）
  assert.match(serverSource, /buildToolExecutor\(sseSend, 'AI 智能体', sources, searchQueries, searchCountAccum, userName\)/);
  assert.match(serverSource, /buildToolExecutor\(sseSend, agent\.role, sources, queries, searchCountAccum, userName\)/);
  assert.match(serverSource, /executeToolCall\(tc, \{ userName: userName \|\| '', signal: signal \|\| null \}\)/);
  // FC 预检的补全/扩展搜索改用 searchWebForUser（S2 修复）
  assert.match(serverSource, /searchWebForUser\(userName, firstQuery, 20\)/);
  assert.match(serverSource, /searchWebForUser\(userName, eq, 20\)/);
  // autoSupplementSearch 支持 userName 配额透传
  assert.match(serverSource, /function autoSupplementSearch\(originalQuery, currentResults, maxR, userName\)/);
});

test('audit: search tool results filter non-http(s) URLs', () => {
  // search_web / tavily_search 的 URL 协议白名单（L3 修复）
  assert.match(serverSource, /var safeUrl = \/\^https\?:\\\/\\\/\/i\.test\(rawUrl\)/);
  assert.match(serverSource, /var tSafeUrl = \/\^https\?:\\\/\\\/\/i\.test\(tRawUrl\)/);
  // 错误信息脱敏：不把底层 provider 细节透传
  assert.match(serverSource, /搜索服务暂时不可用/);
  assert.doesNotMatch(serverSource, /error: e && e\.message \|\| '搜索失败'/);
});

test('audit: tool timeout aborts underlying fetch (read_web_page signal)', () => {
  // 工具级 AbortController：超时/取消时 abort 底层请求（M1 修复）
  assert.match(serverSource, /var toolAbortCtrl = new AbortController\(\);/);
  assert.match(serverSource, /toolExecutor\(toolCall, toolAbortCtrl\.signal\)/);
  assert.match(serverSource, /fetchSafeWebPage\(pageUrl, \{ signal: \(context && context\.signal\) \|\| null \}\)/);
  const webFetch = fs.readFileSync(path.join(ROOT, 'render-api/web-fetch.js'), 'utf8');
  assert.match(webFetch, /externalSignal\.addEventListener\('abort', onExternalAbort/);
  assert.match(webFetch, /request\.destroy\(new Error\('请求已取消'\)\)/);
});

test('audit: code-agent sensitive-file blacklist matches path segments', () => {
  const codeSource = fs.readFileSync(path.join(ROOT, 'render-api/code-agent.js'), 'utf8');
  assert.match(codeSource, /逐段匹配/);
  assert.match(codeSource, /\.npmrc/);
  assert.match(codeSource, /\.git-credentials/);
  assert.match(codeSource, /database/);
  assert.match(codeSource, /search_count: toolTrace\.filter\(function\(entry\) \{ return entry\.tool === 'web_search'; \}\)\.length/);
});
