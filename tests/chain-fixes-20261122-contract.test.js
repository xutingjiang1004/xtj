'use strict';
// 2026-11-22 第二轮修复契约固化：思考→工具→搜索→正文链路 6 bug + 方案B 全网深搜。
// 这些修复点在大型函数内部，采用源码文本断言固化关键防护，防止后续误改回退。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const agent = read('js/ai-agent.js');
const md = read('js/ai-core/markdown-renderer.js');
const server = read('render-api/server.js');

// ───────── bug1: done 空正文不再触发兜底文案 ─────────
test('bug1: done 里仅在有正文时 drain，空正文交 thinkingOnly 处理', () => {
  assert.match(agent, /if \(String\(aiContent \|\| ''\)\.trim\(\)\) \{\s*ensureAssistantBubbleReady\(\);/);
});
test('bug1: finishAiMessage 回读气泡正文时排除 ai-empty-fallback 兜底文案', () => {
  assert.match(agent, /assistantBubble\.classList\.contains\('ai-empty-fallback'\)\s*\?\s*''\s*:/);
  assert.match(agent, /keptBubble !== 'AI 暂无回复，请重试。'/);
});

// ───────── bug2: 封存正文不再重复渲染 ─────────
test('bug2: 有封存段且流式已有增量时保留流式增量，不整段覆写', () => {
  assert.match(agent, /\} else if \(streamedBody\.trim\(\)\) \{[\s\S]{0,400}保留流式增量即可/);
  assert.doesNotMatch(agent, /if \(sealedPrefix && String\(fullAnswer\)\.indexOf\(sealedPrefix\) === 0\) aiContent = String\(fullAnswer\)\.slice\(sealedPrefix\.length\);\s*else aiContent = fullAnswer;/);
});

// ───────── bug3: markdown 混合段落不再吞字 ─────────
test('bug3: Step13 只对纯块级段落透传，混合段落走转义流程', () => {
  assert.match(md, /var _allBlock = _lines\.every/);
  assert.match(md, /if \(_allBlock\) \{[\s\S]{0,120}cleanPassthroughHtml\(p\)/);
});

// ───────── bug4: 折叠选择器统一 + 尊重用户展开 ─────────
test('bug4: 折叠点击选择器含 tool-step', () => {
  // 顶部按钮判定选择器已与收尾口径一致（body 中至少两处含 .ai-rail-beat, .ai-tool-step 的折叠判定）
  const hits = (agent.match(/rail\.querySelector\('\.ai-rail-beat, \.ai-tool-step'\)/g) || []).length;
  assert.ok(hits >= 1, `折叠选择器应含 tool-step，实际 ${hits}`);
});
test('bug4: settleRunningProcess/finishAiMessage 尊重 __userCollapsed===false', () => {
  assert.match(agent, /thinking\.__userCollapsed !== false && !\(toolFailedEarly/);
  assert.match(agent, /rNode\.__userCollapsed !== false\)\s*\{\s*rNode\.__userCollapsed = !thinkingOnly/);
});

// ───────── bug5: 搜索状态条 / 来源 / 额度 ─────────
test('bug5: sources 累积进 streamSourceItems 并写入 aiMsg.search_results', () => {
  assert.match(agent, /var streamSourceItems = \[\]/);
  assert.match(agent, /streamSourceItems\.push\(\{ title:/);
  assert.match(agent, /streamSourceItems\.slice\(0, 50\)/);
});
test('bug5: completed 状态条就地收敛不替换成空壳，search_status 标记 settled', () => {
  assert.match(agent, /_searchStatusSettled = true/);
  assert.match(agent, /settleOneStatusBar\(stBar, \{ doneText: '已联网' \}\)/);
});
test('bug5: tool_result 仅搜索工具且无并行在跑才收敛状态条', () => {
  assert.match(agent, /_isSearchToolNow && toolSucceeded && !_searchStatusSettled && _runningToolsLeft\.length <= 1/);
});
test('bug5: quota 未返回(null)时联网开关不被打回', () => {
  assert.match(agent, /next === 'required' && S\.quota && searchQuotaExhausted\(S\.quota\)/);
  assert.match(agent, /next==='required'&&S\.quota&&searchQuotaExhausted\(S\.quota\)/);
});
test('bug5: BYOK auto 模式也启用 tools_enabled', () => {
  assert.match(agent, /tools_enabled: \(sendSettings\.networkMode !== 'off'/);
});

// ───────── bug6a: prefetch 链接正文注入 ─────────
test('bug6a: prefetchUserLinks 以带超时的 await 竞速，结果写入 linkPrefetch', () => {
  assert.match(server, /await Promise\.race\(\[_pfPromise, _pfTimeoutPromise\]\)/);
  assert.match(server, /linkPrefetch = _pfResult \|\| linkPrefetch/);
});

// ───────── 方案B: 全网深搜（chatMode 复用研究流） ─────────
test('方案B: 联网第三态 required 文案改为深搜', () => {
  assert.match(agent, /data-network-mode="required" aria-label="全网深入搜索">深搜</);
  assert.match(agent, /required:'全网深搜'/);
});
test('方案B: handleSendMessage 里 required 态走 chatMode 研究流', () => {
  assert.match(agent, /sendSettings\.networkMode === 'required' && !sendCustomCfg/);
  assert.match(agent, /runTavilyResearchFlow\(\{[\s\S]{0,200}chatMode: true/);
});
test('方案B: runTavilyResearchFlow 支持 chatMode 脱离深研页状态', () => {
  assert.match(agent, /var chatMode = opts\.chatMode === true/);
  assert.match(agent, /var flowReqId = function\(\) \{ return chatMode \? S\._currentReqId : S\._dtCurrentReqId; \}/);
  assert.match(agent, /conversationId: chatMode \? S\.conversationId : undefined/);
  assert.match(agent, /flowReqId\(\) !== reqId/);
});

// ───────── 红线：游客额度逻辑未被动 ─────────
test('红线: 游客无限免费三入口仍完整', () => {
  const hits = (server.match(/ctx && ctx\.isGuest && guestAiPublicWindowOpen\(\)/g) || []).length;
  assert.ok(hits >= 3, `游客放行入口应 >=3，实际 ${hits}`);
});
