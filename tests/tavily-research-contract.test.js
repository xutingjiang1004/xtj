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
