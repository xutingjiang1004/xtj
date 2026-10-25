'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const serverSource = fs.readFileSync('render-api/server.js', 'utf8');
const providersSource = fs.readFileSync('render-api/search-providers.js', 'utf8');
const feedbackSource = fs.readFileSync('render-api/ai-tool-feedback.js', 'utf8');
const aiAgentSource = fs.readFileSync('js/ai-agent.js', 'utf8');
const adminSource = fs.readFileSync('js/admin/admin.js', 'utf8');

test('搜索 provider 链：DeepSeek 官方是第一优先级，官方限定开关只保留官方', function() {
  const deepseekIndex = providersSource.indexOf("name:'DeepSeek'");
  const tavilyIndex = providersSource.indexOf("name: 'Tavily'");
  assert.ok(deepseekIndex > 0 && tavilyIndex > deepseekIndex, 'DeepSeek 官方必须排在第三方之前');
  assert.match(providersSource, /if \(options\.officialOnly \|\| officialOnlySearch\) \{\s*providerList = providerList\.filter\(function\(provider\) \{ return provider\.name === 'DeepSeek'; \}\);/);
  assert.match(providersSource, /function setOfficialOnlySearch\(value\) \{ officialOnlySearch = value === true; \}/);
});

test('后台配置 official_only 同步到 provider 链并在保存后立即生效', function() {
  assert.match(serverSource, /function syncOfficialOnlySearch\(config\) \{[\s\S]*?setOfficialOnlySearch\(sc\.official_only === true\);/);
  assert.match(serverSource, /syncOfficialOnlySearch\(aiConfigCache\);/);
  assert.match(serverSource, /syncOfficialOnlySearch\(payload\);/);
  assert.match(serverSource, /search: \{ allow_web_search: false, search_provider: 'searxng', official_only: false,/);
  assert.match(adminSource, /id="searchOfficialOnly"/);
  assert.match(adminSource, /official_only: cfgChecked\('searchOfficialOnly'\)/);
});

test('搜索结果向客户端透出真实 provider，前端据此显示官方搜索', function() {
  assert.match(serverSource, /provider: \(result && result\.used_provider\) \|\| null,/);
  assert.match(serverSource, /provider: \(result && result\.used_provider\) \|\| '' \}\)/);
  assert.match(feedbackSource, /if \(provider\) event\.provider = provider\.slice\(0, 40\);/);
  assert.match(aiAgentSource, /SEARCH_PROVIDER_LABELS = \{ DeepSeek: 'DeepSeek 官方搜索' \};/);
  assert.match(aiAgentSource, /text: '来源：' \+ providerTag/);
});

test('官方搜索禁用第三方时，缓存键与开关状态绑定', function() {
  assert.match(providersSource, /!!options\.freeOnly, officialOnlySearch, deepseekWeb\.credentials\(options\)/);
});
