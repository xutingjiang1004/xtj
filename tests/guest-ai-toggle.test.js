'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');

const serverSource = fs.readFileSync('render-api/server.js', 'utf8');
const aiAgentSource = fs.readFileSync('js/ai-agent.js', 'utf8');
const adminSource = fs.readFileSync('js/admin/admin.js', 'utf8');

function serverGuestRuntime(config, options) {
  options = options || {};
  const start = serverSource.indexOf('// ===================== 访客 AI 开关');
  const end = serverSource.indexOf('// ★ 思考Max', start);
  assert.ok(start > 0 && end > start, '访客 AI 开关代码段必须存在');
  const calls = { auth: 0 };
  const context = {
    S: {},
    getAiConfig: async function() {
      if (options.configError) throw new Error('database_unavailable');
      return config;
    },
    _getTokenFromRequest: function(req) {
      const header = String((req && req.headers && req.headers.authorization) || '');
      if (header.indexOf('Bearer ') === 0) return header.slice(7);
      return (req && req.token) || '';
    },
    authenticateUser: async function(req, res) {
      calls.auth += 1;
      return res.status(401).json({ ok: false, error: '请先登录' });
    },
    rateLimit: function() { return function(req, res, next) { next(); }; },
    console: console,
    Date: Date
  };
  vm.createContext(context);
  vm.runInContext(serverSource.slice(start, end), context, { filename: 'guest-ai-block.js' });
  return { context: context, calls: calls };
}

function fakeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader: function(key, value) { this.headers[key] = value; },
    status: function(code) { this.statusCode = code; return this; },
    json: function(body) { this.body = body; return this; }
  };
}

async function invokeGuestAuth(config, options) {
  const runtime = serverGuestRuntime(config, options || {});
  const req = { headers: {}, token: '' , userName: '' };
  if (options && options.token) req.token = options.token;
  const res = fakeResponse();
  let nextCalled = false;
  await runtime.context.guestAiAuth(req, res, function() { nextCalled = true; });
  return { req: req, res: res, nextCalled: nextCalled, calls: runtime.calls };
}

test('访客开关关闭时，未登录请求继续走真实认证并返回 401', async function() {
  const result = await invokeGuestAuth({ allow_guest_ai: false });
  assert.equal(result.nextCalled, false);
  assert.equal(result.calls.auth, 1);
  assert.equal(result.res.statusCode, 401);
  assert.equal(result.req.guestAi, undefined);
  assert.equal(result.req.userName, '');
});

test('访客开关开启时，未登录请求被标记为游客且不写账号名', async function() {
  const result = await invokeGuestAuth({ allow_guest_ai: true });
  assert.equal(result.nextCalled, true);
  assert.equal(result.calls.auth, 0);
  assert.equal(result.req.guestAi, true);
  assert.equal(result.req.userName, '');
  assert.equal(result.req.accountId, '');
});

test('访客开关开启但请求携带凭证时仍走真实认证，不降级为游客', async function() {
  const result = await invokeGuestAuth({ allow_guest_ai: true }, { token: 'stale-token' });
  assert.equal(result.nextCalled, false);
  assert.equal(result.calls.auth, 1);
  assert.equal(result.req.guestAi, undefined);
});

test('读取配置失败时访客开关按关闭处理', async function() {
  const result = await invokeGuestAuth({ allow_guest_ai: true }, { configError: true });
  assert.equal(result.nextCalled, false);
  assert.equal(result.calls.auth, 1);
  assert.equal(result.req.guestAi, undefined);
});

test('官方搜索默认开启且游客小时上限放宽', function() {
  assert.match(serverSource, /allow_web_search: true,/);
  assert.match(serverSource, /const GUEST_AI_HOURLY_LIMIT = 100;/);
  // search_web 工具第一优先级就是 DeepSeek 官方 Search API（deepseek-web / v1/tools/search）
  const deepseekWebSource = fs.readFileSync('render-api/deepseek-web.js', 'utf8');
  assert.match(deepseekWebSource, /https:\/\/api\.deepseek\.com\/v1\/tools\/' \+ kind/);
  const providersSource = fs.readFileSync('render-api/search-providers.js', 'utf8');
  assert.match(providersSource, /name:\s*'DeepSeek'/);
  assert.match(providersSource, /enabled: !options\.freeOnly && !!deepseekWeb\.credentials\(options\)/);
});

function guestExpressApp(config) {
  const runtime = serverGuestRuntime(config);
  const app = express();
  app.use(express.json());
  app.post('/api/agent/chat/stream', runtime.context.guestAiAuth, function(req, res) {
    return res.json({ ok: true, guest: req.guestAi === true, userName: req.userName });
  });
  return app;
}

test('真实 HTTP 路由：开关开启放行访客，关闭立即返回 401', async function() {
  const enabled = await request(guestExpressApp({ allow_guest_ai: true }))
    .post('/api/agent/chat/stream')
    .send({ message: 'hi' });
  assert.equal(enabled.status, 200);
  assert.deepEqual(enabled.body, { ok: true, guest: true, userName: '' });

  const disabled = await request(guestExpressApp({ allow_guest_ai: false }))
    .post('/api/agent/chat/stream')
    .send({ message: 'hi' });
  assert.equal(disabled.status, 401);
  assert.equal(disabled.body.ok, false);
});

test('真实 HTTP 路由：开关开启时携带 Authorization 仍不接受游客观光', async function() {
  const response = await request(guestExpressApp({ allow_guest_ai: true }))
    .post('/api/agent/chat/stream')
    .set('Authorization', 'Bearer expired-or-stale')
    .send({ message: 'hi' });
  assert.equal(response.status, 401);
});

function guestAppWithRealAiMiddleware(config) {
  const runtime = serverGuestRuntime(config);
  const aiRequestFeatures = require('../render-api/ai-request-features');
  const registrationApp = { post: function() {}, delete: function() {} };
  const aiMiddleware = aiRequestFeatures.install(registrationApp, {
    authenticateUser: async function() {},
    rateLimit: function() { return function(req, res, next) { next(); }; },
    writeSse: function() {},
    jsonMiddleware: express.json({ limit: '1mb' })
  });
  const app = express();
  app.use(express.json());
  app.post('/api/agent/chat/stream', runtime.context.guestAiAuth, aiMiddleware, function(req, res) {
    return res.json({ ok: true, guest: req.guestAi === true, owner: req.aiRequestScope && req.aiRequestScope.owner });
  });
  return app;
}

test('真实 aiRequestMiddleware 不再把游客聊天请求拒绝为 auth_required', async function() {
  const response = await request(guestAppWithRealAiMiddleware({ allow_guest_ai: true }))
    .post('/api/agent/chat/stream')
    .send({ message: 'hi' });
  assert.equal(response.status, 200);
  assert.equal(response.body.guest, true);
  assert.match(String(response.body.owner), /^guest:/);
});

test('真实 aiRequestMiddleware 在开关关闭时仍由认证中间件拦截', async function() {
  const response = await request(guestAppWithRealAiMiddleware({ allow_guest_ai: false }))
    .post('/api/agent/chat/stream')
    .send({ message: 'hi' });
  assert.equal(response.status, 401);
});

test('聊天流路由挂载访客鉴权、游客限流和每日上限', function() {
  assert.match(serverSource, /app\.post\('\/api\/agent\/chat\/stream', guestAiAuth, aiChatConcurrencyGate, rateLimit\(3600000, AI_CHAT_HOURLY_IP_LIMIT\), guestAiAdmission,/);
  assert.match(serverSource, /app\.get\('\/api\/agent\/guest-mode', rateLimit\(60000, 60\), async function/);
  assert.match(serverSource, /allow_guest_ai: allowGuestAi/);
  assert.match(serverSource, /typeof body\.allow_guest_ai === 'boolean'/);
  assert.match(serverSource, /skipDb: !!req\.guestAi/);
});

test('访客聊天跳过额度校验、数据库历史与消息落库', function() {
  const start = serverSource.indexOf("app.post('/api/agent/chat/stream'");
  const end = serverSource.indexOf("app.post('/api/agent/research/stream'", start);
  const streamBlock = serverSource.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(streamBlock, /var rl = req\.guestAi\s*\?\s*\{ allowed: true, quota: null \}/);
  assert.match(streamBlock, /if \(!req\.guestAi\) \{\s*try \{\s*var _responsesSaveResult/);
  assert.match(streamBlock, /if \(!req\.guestAi\) \{\s*try \{\s*responsesQuota = await recordAiTurnUsage/);
  assert.match(streamBlock, /if \(!userName \|\| req\.guestAi \|\| interruptedSave/);
  assert.match(streamBlock, /req\.guestAi \? GUEST_AI_MESSAGE_MAX_LEN : AI_CHAT_MESSAGE_MAX_LEN/);
});

test('后台 AI 设置包含访客开关并随配置保存', function() {
  assert.match(adminSource, /id="guestAiEnabled"/);
  assert.match(adminSource, /访客用户可使用AI/);
  assert.match(adminSource, /allow_guest_ai: cfgChecked\('guestAiEnabled'\)/);
  assert.match(serverSource, /allow_guest_ai: true,/);
});

function frontendGuestModeRuntime() {
  const start = aiAgentSource.indexOf('// 后台「访客用户可使用AI」开关');
  const end = aiAgentSource.indexOf('function buildUsageLine', start);
  assert.ok(start > 0 && end > start, '前端访客开关代码段必须存在');
  let user = '';
  let requests = 0;
  let response = { ok: true, data: { enabled: true } };
  const context = {
    S: {},
    readUserName: function() { return user; },
    apiRequest: async function() {
      requests += 1;
      if (response instanceof Error) throw response;
      return response;
    },
    console: console,
    Date: Date
  };
  vm.createContext(context);
  vm.runInContext(aiAgentSource.slice(start, end), context, { filename: 'guest-mode-block.js' });
  return {
    context: context,
    setUser: function(value) { user = value; },
    setResponse: function(value) { response = value; },
    getRequests: function() { return requests; }
  };
}

test('前端每次发送都重新查询访客开关，关闭后立即不再放行', async function() {
  const runtime = frontendGuestModeRuntime();
  assert.equal(await runtime.context.ensureGuestAiMode(), true);
  assert.equal(runtime.context.S.guestAi, true);
  runtime.setResponse({ ok: true, data: { enabled: false } });
  assert.equal(await runtime.context.ensureGuestAiMode(), false);
  assert.equal(runtime.context.S.guestAi, false);
  assert.equal(runtime.getRequests(), 2);
});

test('前端已登录时不查询访客开关', async function() {
  const runtime = frontendGuestModeRuntime();
  runtime.setUser('alice');
  assert.equal(await runtime.context.ensureGuestAiMode(), false);
  assert.equal(runtime.getRequests(), 0);
});

function frontendAuthRuntime() {
  const start = aiAgentSource.indexOf('  async function ensureUserAuthOrNotify(options)');
  const end = aiAgentSource.indexOf('  // ===================== Tavily Deep Research', start);
  assert.ok(start > 0 && end > start, '前端认证门禁代码段必须存在');
  let user = '';
  let guest = true;
  const notices = [];
  let preflights = 0;
  const context = {
    readUserName: function() { return user; },
    ensureGuestAiMode: async function() { return guest; },
    notify: function(message) { notices.push(message); },
    window: {
      ensureProtectedOperationAuth: async function() { preflights += 1; return { ok: true }; }
    },
    console: console
  };
  vm.createContext(context);
  vm.runInContext(aiAgentSource.slice(start, end), context, { filename: 'ai-auth-block.js' });
  return {
    context: context,
    setUser: function(value) { user = value; },
    setGuest: function(value) { guest = value; },
    notices: notices,
    preflights: function() { return preflights; }
  };
}

test('游客聊天在开关开启时放行，关闭时提示登录', async function() {
  const runtime = frontendAuthRuntime();
  assert.equal(await runtime.context.ensureUserAuthOrNotify({ allowGuest: true }), true);
  assert.deepEqual(runtime.notices, []);
  runtime.setGuest(false);
  assert.equal(await runtime.context.ensureUserAuthOrNotify({ allowGuest: true }), false);
  assert.equal(runtime.notices[0], '请先登录后再和小猫聊天');
});

test('游客访问研究/站内搜索等入口仍被登录门禁拦截', async function() {
  const runtime = frontendAuthRuntime();
  assert.equal(await runtime.context.ensureUserAuthOrNotify(), false);
  assert.equal(runtime.notices[0], '请先登录后再和小猫聊天');
  assert.equal(runtime.preflights(), 0);
});

test('已登录用户继续走原有认证预检，不受访客开关影响', async function() {
  const runtime = frontendAuthRuntime();
  runtime.setUser('alice');
  assert.equal(await runtime.context.ensureUserAuthOrNotify({ allowGuest: true }), true);
  assert.equal(runtime.preflights(), 1);
  assert.deepEqual(runtime.notices, []);
});
