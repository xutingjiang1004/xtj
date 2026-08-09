'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
const renderYaml = fs.readFileSync(path.join(__dirname, '..', 'render.yaml'), 'utf8');

function routeSource(method, route, nextRoute) {
  const startToken = `app.${method}('${route}'`;
  const start = server.indexOf(startToken);
  assert.notEqual(start, -1, `missing ${method.toUpperCase()} ${route}`);
  const end = nextRoute ? server.indexOf(nextRoute, start + startToken.length) : server.length;
  assert.ok(end > start, `could not isolate ${route}`);
  return server.slice(start, end);
}

function researchFnSource() {
  // ★ 2026-08-08: 深度研究已重构为自托管多智能体（runSelfResearchFlow），
  //   Tavily 流式代理（tavilyResearchStream / TAVILY_RESEARCH_PHASES）已删除。
  //   缓存/改写/持久化核心仍保留在 Tavily Research 增强流水线区段，改从该区段截取。
  // ★ searchBrave 等 provider 已移入 search-providers.js,research 段结束锚点改用"输入校验"分段。
  const start = server.indexOf('var researchCache = new Map()');
  assert.notEqual(start, -1, 'missing researchCache (Tavily Research pipeline)');
  const end = server.indexOf('// ===================== 输入校验', start);
  assert.ok(end > start, 'could not isolate research pipeline');
  return server.slice(start, end);
}

test('research pipeline: cache/rewrite/persist helpers remain intact', () => {
  const source = researchFnSource();
  // 缓存：24h TTL + LRU（Map 迭代顺序第一项最旧）
  assert.match(source, /var researchCache = new Map\(\)/);
  assert.match(source, /RESEARCH_CACHE_MAX\s*=\s*50/);
  assert.match(source, /RESEARCH_CACHE_TTL\s*=\s*24 \* 60 \* 60 \* 1000/);
  assert.match(source, /createHash\('sha256'\)/);
  assert.match(source, /researchCache\.keys\(\)\.next\(\)\.value/);
  // 改写：DeepSeek 非流式 8s 超时，失败静默回退
  assert.match(source, /async function rewriteResearchQuery\(query\)/);
  assert.match(source, /你是研究问题优化助手/);
  assert.match(source, /max_tokens:\s*100/);
  assert.match(source, /AbortSignal\.timeout\(8000\)/);
  assert.match(source, /stream:\s*false/);
  assert.match(source, /return query;/);
  // 持久化：posts 表 tavily_research JSON
  assert.match(source, /async function persistResearchRecord\(/);
  assert.match(source, /type:\s*'tavily_research'/);
  assert.match(source, /AI_AGENT_MESSAGE_MARKER/);
  assert.match(source, /ai_msg_conv_' \+ convId \+ '_' \+ nowTs/);
  assert.match(source, /console\.warn\('\[RESEARCH\] persist/);
});

test('POST /api/agent/research/stream is authenticated, rate-limited and SSE-forwarded', () => {
  const source = routeSource('post', '/api/agent/research/stream', "app.post('/api/agent/chat/delete'");
  assert.match(source, /authenticateUser/);
  assert.match(source, /rateLimit\(3600000,\s*20\)/);
  assert.match(source, /text\/event-stream/);
  assert.match(source, /flushHeaders\(\)/);
  // 心跳：每 4s 检查，沉默 ≥8s 发 heartbeat
  assert.match(source, /setInterval/);
  assert.match(source, /heartbeat/);
  assert.match(source, />= 8000/);
  // 校验 query（1-500 字）与 model 白名单
  assert.match(source, /validateString\(req\.body && req\.body\.query,\s*500/);
  assert.match(source, /'pro',\s*'mini',\s*'auto'/);
  assert.match(source, /runSelfResearchFlow\(/);
  assert.match(source, /req\.on\('aborted'/);
  assert.match(source, /safeEnd\(\)/);
});

test('GET /api/agent/config exposes tavily_research capability flag', () => {
  const source = routeSource('get', '/api/agent/config', "app.post('/api/agent/profile'");
  assert.match(source, /tavily_research:\s*\{/);
  assert.match(source, /enabled:\s*!!process\.env\.TAVILY_API_KEY/);
  assert.match(source, /models:\s*\[\s*'pro',\s*'mini',\s*'auto'\s*\]/);
});

test('render.yaml declares TAVILY_API_KEY as a manual secret near SUPABASE_ANON_KEY', () => {
  assert.match(renderYaml, /- key: TAVILY_API_KEY\s*\r?\n\s*sync: false/);
  const anonIdx = renderYaml.indexOf('- key: SUPABASE_ANON_KEY');
  const tavilyIdx = renderYaml.indexOf('- key: TAVILY_API_KEY');
  assert.ok(anonIdx >= 0 && tavilyIdx > anonIdx, 'TAVILY_API_KEY should follow SUPABASE_ANON_KEY');
});

test('POST /api/agent/research/stream supports rewrite + modes and self-hosted multi-agent research flow', () => {
  const source = routeSource('post', '/api/agent/research/stream', "app.post('/api/agent/chat/delete'");
  // rewrite 预处理（默认 true，可关闭）
  assert.match(source, /var rewrite = !\(req\.body && req\.body\.rewrite === false\)/);
  // hybrid 混合模式（默认）与 direct 直连模式（当前仅用于缓存 key 兼容）
  assert.match(source, /var mode = String\(req\.body && req\.body\.mode \|\| 'hybrid'\)/);
  assert.match(source, /if \(mode !== 'direct'\) mode = 'hybrid'/);
  // ★ 2026-08-08: 深度研究已重构为自托管多智能体主流程（runSelfResearchFlow），
  //   不再调用 Tavily 流式代理；事件契约（research_step/content/sources/done）保持兼容。
  assert.match(source, /runSelfResearchFlow\(/);
  assert.match(source, /self_research_failed/);
  assert.match(source, /researchCacheGet\(cacheKey\)/);
  assert.match(source, /researchCacheSet\(cacheKey/);
  assert.match(source, /persistResearchRecord\(/);
  assert.match(source, /message_id/);
  assert.match(source, /conversation_id/);
  // 多智能体主流程：阶段事件 research_stage（rewrite → rewrite_done → collect → gapfill → synthesize）
  const researchFlowStart = server.indexOf('async function runSelfResearchFlow');
  assert.ok(researchFlowStart > 0, 'missing runSelfResearchFlow');
  const researchFlowEnd = server.indexOf('// POST /api/agent/research/stream - 自托管多智能体深度研究', researchFlowStart);
  assert.ok(researchFlowEnd > researchFlowStart, 'could not isolate runSelfResearchFlow');
  const flowSource = server.slice(researchFlowStart, researchFlowEnd);
  assert.match(flowSource, /type:\s*'research_stage'/);
  assert.match(flowSource, /stage:\s*'rewrite'/);
  assert.match(flowSource, /stage:\s*'rewrite_done'/);
  assert.match(flowSource, /stage:\s*'collect'/);
  assert.match(flowSource, /stage:\s*'synthesize'/);
  assert.match(flowSource, /总指挥正在交叉验证与深度研判/);
  assert.match(flowSource, /research_content/);
  // research_sources / research_done 由路由处理器（缓存命中回放 + 完成路径）发送
  assert.match(source, /research_sources/);
  assert.match(source, /research_done/);
});

test('GET /api/agent/research/history is authenticated, rate-limited and filters tavily_research rows', () => {
  const source = routeSource('get', '/api/agent/research/history', "app.post('/api/agent/chat/delete'");
  assert.match(source, /authenticateUser/);
  assert.match(source, /rateLimit\(60000,\s*30\)/);
  assert.match(source, /\.filter\('actor_key',\s*'like',\s*'ai_msg_conv_%'\)/);
  assert.match(source, /hParsed\.type !== 'tavily_research'/);
  // ★ 2026-08-05: 历史详情返回完整 answer（此前截断 200 字导致历史报告看不全）
  assert.doesNotMatch(source, /String\(hParsed\.answer[^)]*\)\.slice\(0,\s*200\)/);
  assert.match(source, /research_history_failed/);
  assert.match(source, /created_at/);
  assert.match(source, /ascending:\s*false/);
});
