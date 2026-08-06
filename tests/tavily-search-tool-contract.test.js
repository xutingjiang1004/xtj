'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const aiAgent = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');

test('tavily_search tool is declared in AI_TOOLS with Tavily-specific params', () => {
  const toolBlock = server.match(/name: 'tavily_search',[\s\S]*?required: \['query'\][\s\S]*?\n    \},/);
  assert.ok(toolBlock, 'tavily_search definition missing in AI_TOOLS');
  assert.match(toolBlock[0], /普通网页搜索/);
  assert.match(toolBlock[0], /区别于深度研究/);
  assert.match(toolBlock[0], /max_results: \{ type: 'integer', description: '返回结果数量，默认 5，最大 10', default: 5 \}/);
  assert.match(toolBlock[0], /search_depth: \{ type: 'string', enum: \['basic', 'advanced'\]/);
  assert.match(toolBlock[0], /include_answer: \{ type: 'boolean'/);
  assert.match(toolBlock[0], /time_range: \{ type: 'string', enum: \['day', 'week', 'month', 'year'\]/);
  assert.match(toolBlock[0], /topic: \{ type: 'string', enum: \['general', 'news'\]/);
});

test('executeToolCall dispatches tavily_search and guards missing API key', () => {
  assert.match(server, /case 'tavily_search': \{/);
  assert.match(server, /if \(!tq\) return \{ tool_name: name, error: '搜索关键词为空' \};/);
  assert.match(server, /if \(!process\.env\.TAVILY_API_KEY\) return \{ tool_name: name, query: tq, error: 'Tavily 未配置（缺少 TAVILY_API_KEY 环境变量）' \};/);
  assert.match(server, /var tavilyResult = await searchTavily\(tq, tMax, \{/);
  assert.match(server, /results_count: tArr\.length,/);
});

test('searchTavily forwards advanced options (search_depth / include_answer / time_range / topic)', () => {
  const fnBlock = server.match(/async function searchTavily\(query, maxResults, extraOpts\) \{[\s\S]*?signal: AbortSignal\.timeout\(15000\)[\s\S]*?\n    \}\);/);
  assert.ok(fnBlock, 'searchTavily signature with extraOpts missing');
  assert.match(fnBlock[0], /search_depth: extraOpts\.search_depth === 'advanced' \? 'advanced' : 'basic'/);
  assert.match(fnBlock[0], /include_answer: !!extraOpts\.include_answer/);
  assert.match(fnBlock[0], /if \(extraOpts\.time_range\) tavilyBody\.time_range = extraOpts\.time_range;/);
  assert.match(fnBlock[0], /if \(extraOpts\.topic === 'news'\) tavilyBody\.topic = 'news';/);
});

test('search result collection covers tavily_search on both streaming paths', () => {
  // 带历史端点 /api/agent/chat 的 tool_executor wrapper
  assert.match(server, /res\.tool_name === 'search_web' \|\| res\.tool_name === 'tavily_search'/);
  // 流式端点 /api/agent/chat/stream 的 _toolSearchMeta 捕获
  assert.match(server, /toolResult\.tool_name === 'search_web' \|\| toolResult\.tool_name === 'tavily_search'/);
});

test('frontend renders tavily_search tool name in tool_calls and tool_result status bars', () => {
  assert.match(aiAgent, /var nameMap = \{ search_web: '联网搜索', tavily_search: 'Tavily搜索', get_weather: '查询天气', get_current_time: '获取时间' \};/);
  assert.match(aiAgent, /var nameMap = \{ search_web: '已联网搜索', tavily_search: '已Tavily搜索', get_weather: '已查询天气', get_current_time: '已获取时间' \};/);
});
