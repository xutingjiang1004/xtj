'use strict';
// 2026-11-22 复查修复契约：深入研究链路 4 项用户可见问题（R1-R4）。
// 关键逻辑在超长函数内部，这里用源码文本断言固化行为，防止回归。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const agent = read('js/ai-agent.js');
const server = read('render-api/server.js');

// ───────── R1: 游客并发 key 改为会话级，同 IP 不再互相阻塞 ─────────
test('R1: guestAiAuth 为游客签发并发身份 Cookie', () => {
  assert.match(server, /ensureGuestSessionId\(req, res\)/);
  assert.match(server, /GUEST_CONCURRENCY_COOKIE = 'xtj_guest_id'/);
  assert.match(server, /guestSessionId\(req\) \|\| getRealIp\(req\)/);
});

test('R1: 研究流与深度思考共用会话级 guestResearchKey', () => {
  const hits = (server.match(/tryAcquireDeepResearch\((?:guestWindow \? )?guestResearchKey\(req\)/g) || []).length;
  assert.ok(hits >= 2, `research/stream 与 handleDeepThinkChat 都应使用 guestResearchKey，实际 ${hits}`);
  assert.doesNotMatch(server, /tryAcquireDeepResearch\('guest:' \+ getRealIp\(req\)\)/);
});

// ───────── R2: 纯工具协议兜底后追加一次自然语言重答 ─────────
test('R2: Responses 纯协议兜底会再请求一次自然语言正文', () => {
  assert.match(server, /var protocolOnlyFallback = false;/);
  assert.match(server, /if \(protocolOnlyFallback && !controller\.signal\.aborted\)/);
  assert.match(server, /上一次回复只包含工具调用标记，用户没有看到任何正文/);
  // 重试请求必须不带 tools，避免再次得到同一段工具协议
  const start = server.indexOf('if (protocolOnlyFallback && !controller.signal.aborted)');
  const end = server.indexOf('if (!finalContent || !String(finalContent).trim())', start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(server.slice(start, end), /\btools\s*:/);
});

// ───────── R3: 超时不再让研究卡停在旧阶段 ─────────
test('R3: 前端处理 research_stage=timeout 并立即收尾', () => {
  assert.match(agent, /else if \(stage === 'timeout'\) \{[\s\S]{0,240}markResearchCardOutcome\(progressCard, 'timeout'/);
  assert.match(agent, /errCode === 'research_timeout'/);
});

test('R3: 后端墙钟超时补发终止事件（区分用户取消）', () => {
  assert.match(server, /cancelToken\.wallTimedOut = true/);
  assert.match(server, /if \(!aborted && cancelToken && cancelToken\.wallTimedOut && !res\.writableEnded\)/);
  assert.match(server, /code: 'research_timeout'/);
});

// ───────── R4: 游客 saved:false 不再当作保存失败 ─────────
test('R4: 研究卡只有登录用户 saved:false 才标红', () => {
  assert.match(agent, /if \(result && result\.saved === false && readUserName\(\)\)/);
});

test('R4: 深度思考收尾不向游客显示“未保存”红字', () => {
  assert.match(agent, /if \(evt\.saved === false && readUserName\(\) && aiNodeRef\.value\)/);
});
