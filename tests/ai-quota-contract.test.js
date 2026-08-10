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

test('server wires token quota gates, recording, and Stripe stubs', () => {
  assert.match(serverSource, /createAiQuota/);
  assert.match(serverSource, /enforceAiChatAccess/);
  assert.match(serverSource, /recordAiTurnUsage/);
  assert.match(serverSource, /app\.get\('\/api\/agent\/quota'/);
  assert.match(serverSource, /app\.post\('\/api\/agent\/pro\/checkout'/);
  assert.match(serverSource, /app\.post\('\/api\/agent\/pro\/webhook'/);
  assert.match(serverSource, /app\.post\('\/api\/agent\/pro\/activate'/);
  assert.match(serverSource, /stripe_not_configured/);
  assert.match(serverSource, /token_limit/);
  assert.match(serverSource, /search_limit/);
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
  assert.match(agentSource, /\/pro\/checkout/);
  assert.match(agentSource, /今日 AI 额度/);
  assert.match(agentSource, /playProActivatedCeremony/);
  assert.match(agentSource, /ai-pro-activate-overlay/);
  assert.match(agentSource, /forceCeremony/);
});

test('quota error messages distinguish token and search limits', () => {
  assert.match(quotaMod.getTokenQuotaErrorMessage('token_limit'), /额度已用完/);
  assert.match(quotaMod.getTokenQuotaErrorMessage('search_limit'), /搜索次数/);
  assert.match(quotaMod.getTokenQuotaErrorMessage('quota_unavailable'), /暂不可用/);
});
