'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const aiAgent = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
const searchProviders = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'search-providers.js'), 'utf8');

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
  const fnBlock = searchProviders.match(/async function searchTavily\(query, maxResults, extraOpts\) \{[\s\S]*?signal: AbortSignal\.timeout\(15000\)[\s\S]*?\n    \}\);/);
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
  // ★ 2026-09-28（方案 D「工具名说人话」）：
  //   原先断言两处 nameMap 都写着 `tavily_search: 'Tavily搜索'`。
  //   现在映射收敛为单一 TOOL_LABELS，且 tavily_search 改为动作描述
  //   「搜索网页」（Tavily 是实现名，对用户无意义；内部名仍写入
  //   data-tool-name 供对账、title 供悬停）。
  //   测试意图保留：**tavily_search 必须有中文名且两处渲染都取得到**。
  assert.match(aiAgent, /var TOOL_LABELS\s*=\s*\{[\s\S]*?tavily_search:\s*'[^']+'/,
    '统一映射表 TOOL_LABELS 必须包含 tavily_search 的中文名');
  // 显示名不得再是产品名（说人话）
  assert.ok(!/tavily_search:\s*'Tavily搜索'/.test(aiAgent),
    'tavily_search 的显示名不应再是产品名「Tavily搜索」，应改为动作描述');
  // 两处渲染点都必须经 toolLabel 取值（tool_calls 用 t.name，tool_result 用 evt.tool_name）
  assert.match(aiAgent, /toolLabel\(t\.name\)/, 'tool_calls 分支必须经 toolLabel 取显示名');
  assert.match(aiAgent, /toolLabel\(evt\.tool_name\)/, 'tool_result 分支必须经 toolLabel 取显示名');
  // 对账用的内部名必须保留，不能被显示名顶掉
  assert.match(aiAgent, /setAttribute\('data-tool-name', String\(t\.name \|\| ''\)\)/,
    'data-tool-name 必须保留原始工具名，否则并行同工具的对账会错配');
});
