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
  const start = server.indexOf('var TAVILY_RESEARCH_PHASES');
  assert.notEqual(start, -1, 'missing TAVILY_RESEARCH_PHASES phase map');
  const fnStart = server.indexOf('async function tavilyResearchStream', start);
  assert.notEqual(fnStart, -1, 'missing async function tavilyResearchStream');
  const end = server.indexOf('async function searchBrave', fnStart);
  assert.ok(end > fnStart, 'could not isolate tavilyResearchStream');
  return server.slice(start, end);
}

test('tavilyResearchStream calls api.tavily.com/research with Bearer auth, stream=true and 10min timeout', () => {
  const source = researchFnSource();
  assert.match(source, /api\.tavily\.com\/research/);
  assert.match(source, /'Authorization':\s*'Bearer '\s*\+\s*apiKey/);
  assert.match(source, /AbortSignal\.timeout\(600000\)/);
  assert.match(source, /JSON\.stringify\(\{\s*input:\s*query/);
  assert.match(source, /stream:\s*true/);
  assert.doesNotMatch(source, /api_key:\s*apiKey/); // 老式鉴权不应出现在研究代理里
});

test('tavilyResearchStream emits tavily_not_configured when TAVILY_API_KEY is missing', () => {
  const source = researchFnSource();
  assert.match(source, /tavily_not_configured/);
  assert.match(source, /process\.env\.TAVILY_API_KEY/);
});

test('tavilyResearchStream normalizes upstream events to research_step/content/sources/done', () => {
  const source = researchFnSource();
  // 阶段映射：Planning=0, WebSearch=1, ResearchSubtopic=1, Generating=2
  assert.match(source, /Planning:\s*0/);
  assert.match(source, /WebSearch:\s*1/);
  assert.match(source, /ResearchSubtopic:\s*1/);
  assert.match(source, /Generating:\s*2/);
  assert.match(source, /research_step/);
  assert.match(source, /research_content/);
  assert.match(source, /research_sources/);
  assert.match(source, /research_done/);
  // 流结束补发 done（已累积 content），无 error 时
  assert.match(source, /!sentDone\s*&&\s*!sentError/);
  // SSE 解析：CRLF trim、data: 前缀、多行 data 用 \n 拼接
  assert.match(source, /\.trim\(\)/);
  assert.match(source, /data:/);
  assert.match(source, /dataLines\.join\('\\n'\)/);
});

test('POST /api/agent/research/stream is authenticated, rate-limited and SSE-forwarded', () => {
  const source = routeSource('post', '/api/agent/research/stream', "app.post('/api/agent/chat/delete'");
  assert.match(source, /authenticateUser/);
  assert.match(source, /rateLimit\(3600000,\s*10\)/);
  assert.match(source, /text\/event-stream/);
  assert.match(source, /flushHeaders\(\)/);
  // 心跳：每 4s 检查，沉默 ≥8s 发 heartbeat
  assert.match(source, /setInterval/);
  assert.match(source, /heartbeat/);
  assert.match(source, />= 8000/);
  // 校验 query（1-500 字）与 model 白名单
  assert.match(source, /validateString\(req\.body && req\.body\.query,\s*500/);
  assert.match(source, /'pro',\s*'mini',\s*'auto'/);
  assert.match(source, /tavilyResearchStream\(/);
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

test('enhanced pipeline: 24h LRU researchCache with sha256 key (cap 50, TTL 24h)', () => {
  const source = researchFnSource();
  assert.match(source, /var researchCache = new Map\(\)/);
  assert.match(source, /createHash\('sha256'\)/);
  assert.match(source, /RESEARCH_CACHE_MAX\s*=\s*50/);
  assert.match(source, /RESEARCH_CACHE_TTL\s*=\s*24 \* 60 \* 60 \* 1000/);
  assert.match(source, /researchCacheGet\(/);
  assert.match(source, /researchCacheSet\(/);
  // LRU：超限删最旧（Map 迭代顺序第一项）
  assert.match(source, /researchCache\.keys\(\)\.next\(\)\.value/);
});

test('enhanced pipeline: query rewrite via DeepSeek non-streaming with 8s timeout and silent fallback', () => {
  const source = researchFnSource();
  assert.match(source, /async function rewriteResearchQuery\(query\)/);
  assert.match(source, /你是研究问题优化助手/);
  assert.match(source, /max_tokens:\s*100/);
  assert.match(source, /AbortSignal\.timeout\(8000\)/);
  assert.match(source, /stream:\s*false/);
  // 失败静默回退原 query
  assert.match(source, /return query;/);
});

test('enhanced pipeline: research records persist to posts with tavily_research JSON content', () => {
  const source = researchFnSource();
  assert.match(source, /async function persistResearchRecord\(/);
  assert.match(source, /type:\s*'tavily_research'/);
  assert.match(source, /AI_AGENT_MESSAGE_MARKER/);
  assert.match(source, /ai_msg_conv_' \+ convId \+ '_' \+ nowTs/);
  assert.match(source, /console\.warn\('\[RESEARCH\] persist/);
});

test('POST /api/agent/research/stream supports rewrite + hybrid/direct modes with stage events', () => {
  const source = routeSource('post', '/api/agent/research/stream', "app.post('/api/agent/chat/delete'");
  // rewrite 预处理（默认 true，可关闭）
  assert.match(source, /var rewrite = !\(req\.body && req\.body\.rewrite === false\)/);
  assert.match(source, /research_stage/);
  assert.match(source, /stage:\s*'rewrite'/);
  assert.match(source, /正在优化研究问题/);
  assert.match(source, /stage:\s*'rewrite_done'/);
  assert.match(source, /rewriteResearchQuery\(/);
  // hybrid 混合模式（默认）与 direct 直连模式
  assert.match(source, /var mode = String\(req\.body && req\.body\.mode \|\| 'hybrid'\)/);
  assert.match(source, /if \(mode !== 'direct'\) mode = 'hybrid'/);
  assert.match(source, /stage:\s*'collect'/);
  assert.match(source, /多智能体并行研究中/);
  assert.match(source, /stage:\s*'synthesize'/);
  assert.match(source, /正在综合生成中文报告/);
  // DeepSeek 流式综合：fetch + stream:true + delta.content → research_content
  assert.match(source, /stream:\s*true/);
  assert.match(source, /delta\.content/);
  assert.match(source, /你是深度研究综合专家/);
  assert.match(source, /research_content', text: delta\.content/);
  // 缓存命中回放路径
  assert.match(source, /researchCacheGet\(cacheKey\)/);
  assert.match(source, /researchCacheSet\(cacheKey/);
  // 持久化 + message_id
  assert.match(source, /persistResearchRecord\(/);
  assert.match(source, /message_id/);
  assert.match(source, /conversation_id/);
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
