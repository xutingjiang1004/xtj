'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const server = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');

function routeLine() {
  const start = server.indexOf("app.post('/api/agent/research/stream'");
  assert.ok(start >= 0);
  return server.slice(start, server.indexOf('\n', start));
}

test('deep research shares the cat AI chat IP limit instead of its own hard-coded 20 per hour', () => {
  const line = routeLine();
  // ★ 2026-11-14：访客窗口开放后限流改由 guestAwareChatRateLimit 代理，
  //   其底座就是聊天用的 3600000/200 限流器，因此共享配额这一点不变。
  assert.match(line, /guestAwareChatRateLimit/);
  assert.doesNotMatch(line, /rateLimit\(3600000, 20\)/);
  assert.match(server, /var _guestAwareChatBaseLimiter = rateLimit\(3600000, AI_CHAT_HOURLY_IP_LIMIT\)/);
  // 登录用户仍然走同一个 token/每小时配额闸门（访客窗口内跳过，见 guestAiPublicWindowOpen 分支）
  assert.match(server, /researchGate = await enforceAiChatAccess\(userName, \{ needSearch: remainingSearch \}\)/);
});

test('research sub-agents report searches and pages as research_activity events with safe fields', () => {
  assert.match(server, /onActivity: emitActivity,/g);
  assert.equal((server.match(/onActivity: emitActivity,/g) || []).length, 2, 'workers and gap agents both report');
  const a = server.indexOf('function emitActivity(item)');
  assert.ok(a > 0);
  const body = server.slice(a, a + 1200);
  assert.match(body, /type: 'research_activity'/);
  assert.match(body, /activityCount >= 120/, 'activity is capped per run');
  assert.match(body, /new URL\(/);
  assert.match(body, /out\.url = \(u\.origin \+ u\.pathname\)/, 'query strings and fragments are not sent');
  // the sub-agent turns tool calls into activity
  const s = server.indexOf('async function runResearchSubAgent');
  const sub = server.slice(s, s + 14000);
  assert.match(sub, /name === 'search_web' \|\| name === 'tavily_search'/);
  assert.match(sub, /name === 'read_web_page'/);
});
