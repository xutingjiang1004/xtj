'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const registerCodeAgentRoutes = require('../render-api/code-agent');
const codeIndex = require('../render-api/code-index');

function sha(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function createApp(callDeepSeek, capabilitySnapshot, extras) {
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  registerCodeAgentRoutes(app, Object.assign({
    supabase: {},
    rateLimit: () => (req, res, next) => next(),
    authenticateUser: (req, res, next) => {
      req.userName = req.get('x-test-user') || 'alice';
      next();
    },
    sanitizeError: err => err && err.message ? err.message : 'error',
    getDeepSeekModel: () => 'deepseek-v4-flash',
    getDeepSeekApiUrl: () => 'https://api.deepseek.com/chat/completions',
    getDeepSeekApiKey: () => 'test-key',
    getDeepSeekCapabilities: capabilitySnapshot ? () => capabilitySnapshot : undefined,
    callDeepSeek
  }, extras || {}));
  return app;
}

test.afterEach(() => {
  codeIndex._resetRegistryForTests();
});

test('freshness questions select web_search and return structured server results', async () => {
  let toolResult;
  const app = createApp(async (_messages, options) => {
    toolResult = await options.tool_executor({
      id: 'web-1',
      function: { name: 'web_search', arguments: JSON.stringify({ query: 'today Guangzhou weather', max_results: 2 }) }
    });
    return { content: '根据联网结果回答', model: 'deepseek-v4-flash', usage: {} };
  }, null, {
    webSearch: async () => ({ results: [{ title: 'Weather', url: 'https://example.com/weather', snippet: 'Sunny', published_at: '2026-07-26T08:00:00Z' }] })
  });
  const response = await request(app).post('/api/code/chat').set('x-test-user', 'alice').send({
    workspace_name: 'travel', workspace_id: 'local:travel', workspace_generation: 1,
    message: '今天广州天气怎么样？', history: [], open_files: [], attachments: []
  });
  assert.equal(response.status, 200);
  assert.equal(toolResult.ok, true);
  assert.equal(toolResult.results[0].url, 'https://example.com/weather');
  assert.equal(toolResult.results[0].published_at, '2026-07-26T08:00:00Z');
  assert.equal(response.body.tool_trace[0].tool, 'web_search');
});

test('web tools fail clearly when search is not configured', async () => {
  let toolResult;
  const app = createApp(async (_messages, options) => {
    toolResult = await options.tool_executor({ id: 'web-2', function: { name: 'web_search', arguments: JSON.stringify({ query: 'latest news' }) } });
    return { content: '未配置', model: 'deepseek-v4-flash', usage: {} };
  });
  const response = await request(app).post('/api/code/chat').set('x-test-user', 'alice').send({
    workspace_name: 'travel', workspace_id: 'local:travel', workspace_generation: 2,
    message: '最新新闻有什么？', history: [], open_files: [], attachments: []
  });
  assert.equal(response.status, 200);
  assert.equal(toolResult.ok, false);
  assert.equal(toolResult.code, 'WEB_SEARCH_NOT_CONFIGURED');
  assert.match(toolResult.error, /网站联网搜索服务未接入/);
});

test('fetch_web_page rejects localhost and private-network targets before fetch', async () => {
  let calls = 0;
  const app = createApp(async (_messages, options) => {
    const result = await options.tool_executor({ id: 'web-3', function: { name: 'fetch_web_page', arguments: JSON.stringify({ url: 'https://localhost/admin' }) } });
    calls++;
    assert.equal(result.ok, false);
    assert.equal(result.code, 'WEB_FETCH_FAILED');
    assert.match(result.error, /主机/);
    return { content: '已拒绝', model: 'deepseek-v4-flash', usage: {} };
  }, null, { fetchImpl: async () => { throw new Error('must not fetch'); } });
  const response = await request(app).post('/api/code/chat').set('x-test-user', 'alice').send({
    workspace_name: 'travel', workspace_id: 'local:travel', workspace_generation: 3,
    message: '请查看最新网页内容', history: [], open_files: [], attachments: []
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test('fetch_web_page rejects DNS rebinding to private addresses', async () => {
  let fetched = false;
  const app = createApp(async (_messages, options) => {
    const result = await options.tool_executor({ id: 'web-4', function: { name: 'fetch_web_page', arguments: JSON.stringify({ url: 'https://public.example/page' }) } });
    assert.equal(result.ok, false);
    assert.match(result.error, /内网地址/);
    return { content: '已拒绝', model: 'deepseek-v4-flash', usage: {} };
  }, null, {
    lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
    fetchImpl: async () => { fetched = true; throw new Error('must not fetch'); }
  });
  const response = await request(app).post('/api/code/chat').set('x-test-user', 'alice').send({
    workspace_name: 'travel', workspace_id: 'local:travel', workspace_generation: 4,
    message: '请查看最新网页内容', history: [], open_files: [], attachments: []
  });
  assert.equal(response.status, 200);
  assert.equal(fetched, false);
});

test('capabilities distinguish configured from verified model availability', async () => {
  const app = createApp(async () => ({ content: 'unused' }), {
    model: 'deepseek-v4-flash',
    probeStatus: 'error',
    probeError: 'HTTP 503',
    modelAvailable: null,
    verifiedAvailable: false,
    providerContextTokens: 1000000,
    providerMaxOutputTokens: 384000,
    apiFormat: 'openai-chat-completions'
  });
  const response = await request(app).get('/api/code/capabilities').set('x-test-user', 'alice');
  assert.equal(response.status, 200);
  assert.equal(response.body.configured, true);
  assert.equal(response.body.available, false);
  assert.equal(response.body.availability, 'unknown');
  assert.equal(response.body.agentEnabled, true);
  assert.equal(response.body.probeStatus, 'error');
  assert.equal(response.body.maxContextTokens, 1000000);
  assert.equal(response.body.maxOutputTokens, 32768);
});

test('capabilities disable an agent when a successful model probe excludes its model', async () => {
  const app = createApp(async () => ({ content: 'unused' }), {
    model: 'deepseek-v4-flash',
    probeStatus: 'ready',
    modelAvailable: false,
    verifiedAvailable: false
  });
  const response = await request(app).get('/api/code/capabilities').set('x-test-user', 'alice');
  assert.equal(response.status, 200);
  assert.equal(response.body.configured, true);
  assert.equal(response.body.available, false);
  assert.equal(response.body.availability, 'unavailable');
  assert.equal(response.body.agentEnabled, false);
  assert.equal(response.body.toolCallingEnabled, false);
});

test('capabilities do not fabricate provider limits when the backend has no model metadata', async () => {
  const app = createApp(async () => ({ content: 'unused' }), {});
  const response = await request(app).get('/api/code/capabilities').set('x-test-user', 'alice');
  assert.equal(response.status, 200);
  assert.equal(response.body.providerContextTokens, null);
  assert.equal(response.body.providerMaxOutputTokens, null);
  assert.equal(response.body.maxContextTokens, 1000000);
  assert.equal(response.body.maxOutputTokens, 32768);
});

test('runs a real multi-step code tool flow and reports actual reads plus cache usage', async () => {
  let receivedOptions;
  const app = createApp(async (messages, options) => {
    receivedOptions = options;
    const listed = await options.tool_executor({
      id: 'call-list',
      function: { name: 'list_files', arguments: JSON.stringify({ directory: '', depth: 3 }) }
    });
    assert.equal(listed.ok, true);
    assert.equal(listed.files[0].path, 'src/example.js');

    const read = await options.tool_executor({
      id: 'call-read',
      function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/example.js' }) }
    });
    assert.match(read.content, /module\.exports/);
    assert.equal(read.sha256, sha(source));

    return {
      content: '我读取了 src/example.js，它导出了 planTrip。',
      model: 'deepseek-v4-flash',
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 80,
        total_tokens: 1280,
        prompt_cache_hit_tokens: 900,
        prompt_cache_miss_tokens: 300
      },
      tool_calls_info: [{ name: 'list_files' }, { name: 'read_file' }]
    };
  });

  const source = 'function planTrip() { return "Guangzhou"; }\nmodule.exports = { planTrip };';
  const build = await request(app)
    .post('/api/code/index/build')
    .set('x-test-user', 'alice')
    .send({
      workspaceId: 'travel-code',
      workspaceGeneration: 1,
      files: [{
        path: 'src/example.js',
        name: 'example.js',
        language: 'javascript',
        content: source,
        size: Buffer.byteLength(source),
        sha256: sha(source)
      }]
    });
  assert.equal(build.status, 200);

  const response = await request(app)
    .post('/api/code/chat')
    .set('x-test-user', 'alice')
    .send({
      workspace_id: 'travel-code',
      workspace_generation: 1,
      workspace_name: 'travel-code',
      message: '你能看到项目吗？读取 src/example.js',
      active_path: 'src/example.js',
      history: [],
      open_files: [],
      attachments: []
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(receivedOptions.tool_choice, 'auto');
  assert.equal(receivedOptions.max_tool_rounds, 8);
  assert.deepEqual(
    receivedOptions.tools.map(tool => tool.function.name),
    ['list_files', 'search_code', 'read_file', 'read_file_range', 'get_symbols', 'get_active_file', 'get_open_files', 'get_runtime_capabilities', 'web_search', 'fetch_web_page']
  );
  assert.equal(response.body.context_info.total_tool_calls, 2);
  assert.equal(response.body.context_info.files_read[0].path, 'src/example.js');
  assert.equal(response.body.usage.prompt_cache_hit_tokens, 900);
  assert.equal(response.body.usage.prompt_cache_hit_ratio, 0.75);
  assert.equal(response.body.capabilities.agentEnabled, true);
  assert.equal(response.body.capabilities.toolCallingEnabled, true);
});

test('forces a first directory tool call for broad project questions', async () => {
  let receivedOptions;
  const app = createApp(async (_messages, options) => {
    receivedOptions = options;
    return { content: 'project inspected', model: 'deepseek-v4-flash' };
  });
  const source = 'const project = true;';
  const build = await request(app).post('/api/code/index/build').set('x-test-user', 'alice').send({
    workspaceId: 'broad-project', workspaceGeneration: 1,
    files: [{ path: 'src/app.js', content: source, size: Buffer.byteLength(source), sha256: sha(source) }]
  });
  assert.equal(build.status, 200);
  const response = await request(app).post('/api/code/chat').set('x-test-user', 'alice').send({
    workspace_id: 'broad-project', workspace_generation: 1,
    message: 'inspect the entire project workspace', history: []
  });
  assert.equal(response.status, 200);
  assert.deepEqual(receivedOptions.first_tool_choice, { type: 'function', function: { name: 'list_files' } });
});

test('forces a first directory tool call for broad Chinese project questions', async () => {
  let receivedOptions;
  const app = createApp(async (_messages, options) => {
    receivedOptions = options;
    return { content: '项目已检查', model: 'deepseek-v4-flash' };
  });
  const source = 'const project = true;';
  const build = await request(app).post('/api/code/index/build').set('x-test-user', 'alice').send({
    workspaceId: 'broad-project-cn', workspaceGeneration: 1,
    files: [{ path: 'src/app.js', content: source, size: Buffer.byteLength(source), sha256: sha(source) }]
  });
  assert.equal(build.status, 200);
  const response = await request(app).post('/api/code/chat').set('x-test-user', 'alice').send({
    workspace_id: 'broad-project-cn', workspace_generation: 1,
    message: '检查一下整个项目还有什么问题', history: []
  });
  assert.equal(response.status, 200);
  assert.deepEqual(receivedOptions.first_tool_choice, { type: 'function', function: { name: 'list_files' } });
});

test('forces a first active-file read for explicit current-file questions', async () => {
  let receivedOptions;
  const app = createApp(async (_messages, options) => {
    receivedOptions = options;
    return { content: 'active file inspected', model: 'deepseek-v4-flash' };
  });
  const source = 'const app = true;';
  const build = await request(app).post('/api/code/index/build').set('x-test-user', 'alice').send({
    workspaceId: 'active-file', workspaceGeneration: 1,
    files: [{ path: 'src/app.js', content: source, size: Buffer.byteLength(source), sha256: sha(source) }]
  });
  assert.equal(build.status, 200);
  const response = await request(app).post('/api/code/chat').set('x-test-user', 'alice').send({
    workspace_id: 'active-file', workspace_generation: 1,
    active_path: 'src/app.js',
    open_files: [{ path: 'src/app.js', content: source }],
    message: '请查看当前文件并解释这段代码', history: []
  });
  assert.equal(response.status, 200);
  assert.deepEqual(receivedOptions.first_tool_choice, { type: 'function', function: { name: 'get_active_file' } });
});

test('keeps indexes isolated by authenticated user and asks for rebuild after restart/miss', async () => {
  const app = createApp(async () => {
    throw new Error('AI must not run without an index');
  });
  const source = 'const owner = "alice";';
  const build = await request(app)
    .post('/api/code/index/build')
    .set('x-test-user', 'alice')
    .send({
      workspaceId: 'private-project',
      workspaceGeneration: 4,
      files: [{
        path: 'secret.js',
        content: source,
        size: Buffer.byteLength(source),
        sha256: sha(source)
      }]
    });
  assert.equal(build.status, 200);

  const bob = await request(app)
    .post('/api/code/chat')
    .set('x-test-user', 'bob')
    .send({
      workspace_id: 'private-project',
      workspace_generation: 4,
      message: '读取 secret.js'
    });
  assert.equal(bob.status, 409);
  assert.equal(bob.body.code, 'INDEX_REBUILD_REQUIRED');
  assert.equal(bob.body.retryable, true);
});

test('accepts bounded index batches and keeps partial indexes private until finalization', async () => {
  const app = createApp(async () => ({ content: 'ok', model: 'deepseek-v4-flash' }));
  const firstSource = 'const first = true;';
  const secondSource = 'const second = true;';
  const makeFile = (path, content) => ({ path, content, size: Buffer.byteLength(content), sha256: sha(content) });

  const first = await request(app).post('/api/code/index/build').set('x-test-user', 'alice').send({
    workspaceId: 'batch-project', workspaceGeneration: 1,
    append: true, finalize: false, files: [makeFile('first.js', firstSource)]
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.status, 'building');
  assert.equal(first.body.finalizeRequired, true);

  const status = await request(app).post('/api/code/index/status').set('x-test-user', 'alice').send({
    workspaceId: 'batch-project', workspaceGeneration: 1
  });
  assert.equal(status.body.summary, null);
  assert.equal(status.body.rebuildRequired, true);

  const final = await request(app).post('/api/code/index/build').set('x-test-user', 'alice').send({
    workspaceId: 'batch-project', workspaceGeneration: 1,
    append: true, finalize: true, files: [makeFile('second.js', secondSource)]
  });
  assert.equal(final.status, 200);
  assert.equal(final.body.status, 'ready');
  assert.equal(final.body.totalFiles, 2);
});

test('uploaded travel documents are available to tools without a project index', async () => {
  const app = createApp(async (_messages, options) => {
    const open = await options.tool_executor({
      id: 'open-docs',
      function: { name: 'get_open_files', arguments: '{}' }
    });
    assert.equal(open.files[0].path, 'attachments/guangzhou.md');
    const read = await options.tool_executor({
      id: 'read-doc',
      function: { name: 'read_file', arguments: '{"path":"attachments/guangzhou.md"}' }
    });
    assert.match(read.content, /陈家祠/);
    return {
      content: '根据资料，建议第一天游览陈家祠。',
      model: 'deepseek-v4-flash',
      usage: null
    };
  });

  const response = await request(app)
    .post('/api/code/chat')
    .send({
      workspace_id: 'travel-materials',
      workspace_generation: 1,
      message: '根据上传资料制定广州行程',
      attachments: [{
        name: 'guangzhou.md',
        path: 'attachments/guangzhou.md',
        mimeType: 'text/markdown',
        content: '景点：陈家祠、沙面。住宿：越秀区。',
        source: 'attachment'
      }]
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.context_info.indexed, false);
  assert.deepEqual(response.body.context_info.attachments, ['attachments/guangzhou.md']);
  assert.equal(response.body.context_info.files_read[0].path, 'attachments/guangzhou.md');
});

// ── Runtime identity & capabilities tests ─────────────────────────────

test('response includes runtime identity with provider=deepseek and model', async () => {
  const app = createApp(async (_messages, _options) => {
    return { content: '我是 XTJ Code Agent，运行在 DeepSeek 平台上。', model: 'deepseek-v4-flash', usage: { prompt_tokens: 100, completion_tokens: 50 } };
  });
  // Build a minimal index so the chat request is accepted
  const source = 'const x = 1;';
  await request(app).post('/api/code/index/build').send({
    workspaceId: 'local:runtime-id', workspaceGeneration: 1,
    files: [{ path: 'src/main.js', content: source, size: Buffer.byteLength(source), sha256: sha(source) }]
  });
  const response = await request(app).post('/api/code/chat').send({
    workspace_id: 'local:runtime-id', workspace_generation: 1,
    message: '你是什么模型？', history: [], open_files: [], attachments: []
  });
  assert.equal(response.status, 200);
  assert.ok(response.body.runtime, 'response should have runtime field');
  assert.equal(response.body.runtime.provider, 'deepseek');
  assert.ok(response.body.runtime.model, 'runtime should have model');
  assert.ok(response.body.context_info.runtime, 'context_info should have runtime');
  assert.equal(response.body.context_info.runtime.provider, 'deepseek');
});

test('system prompt forbids claiming to be Claude, GPT, or Gemini', async () => {
  const codeAgent = require('fs').readFileSync('render-api/code-agent.js', 'utf8');
  assert.match(codeAgent, /不要声称自己是 Claude/);
  assert.match(codeAgent, /不要声称自己是.*Anthropic/);
  assert.match(codeAgent, /不要声称自己是.*GPT/);
  assert.match(codeAgent, /不要声称自己是.*Gemini/);
  assert.match(codeAgent, /自称 Claude.*Anthropic.*200K tokens.*15 万英文单词/);
});

test('get_runtime_capabilities tool returns real server data', async () => {
  let toolResult;
  const app = createApp(async (_messages, options) => {
    toolResult = await options.tool_executor({
      id: 'cap-1',
      function: { name: 'get_runtime_capabilities', arguments: '{}' }
    });
    return { content: '根据运行时数据，我是 deepseek-v4-flash。', model: 'deepseek-v4-flash', usage: {} };
  }, { provider: 'deepseek', model: 'deepseek-v4-flash', verifiedAvailable: true, providerContextTokens: 128000, providerMaxOutputTokens: 32768, apiFormat: 'openai-chat-completions', probeStatus: 'ready' });
  // Build a minimal index
  var source = 'const x = 1;';
  await request(app).post('/api/code/index/build').set('x-test-user', 'alice').send({
    workspaceId: 'local:rt-cap', workspaceGeneration: 1,
    files: [{ path: 'src/main.js', content: source, size: Buffer.byteLength(source), sha256: sha(source) }]
  });
  const response = await request(app).post('/api/code/chat').set('x-test-user', 'alice').send({
    workspace_name: 'test', workspace_id: 'local:rt-cap', workspace_generation: 1,
    message: '你是什么模型？', history: [], open_files: [], attachments: []
  });
  assert.equal(response.status, 200);
  assert.ok(toolResult, 'get_runtime_capabilities should have been called');
  assert.equal(toolResult.ok, true);
  assert.equal(toolResult.provider, 'deepseek');
  assert.equal(toolResult.model, 'deepseek-v4-flash');
  assert.equal(toolResult.configured, true);
  assert.equal(toolResult.agentEnabled, true);
  assert.equal(toolResult.toolCallingEnabled, true);
  assert.equal(toolResult.maxToolRounds, 8);
  assert.ok(typeof toolResult.thinkingMode === 'string');
});

test('get_runtime_capabilities returns null for unknown providerContextTokens', async () => {
  let toolResult;
  const app = createApp(async (_messages, options) => {
    toolResult = await options.tool_executor({
      id: 'cap-2',
      function: { name: 'get_runtime_capabilities', arguments: '{}' }
    });
    return { content: '服务器未提供理论上下文上限。', model: 'deepseek-v4-flash', usage: {} };
  }, { provider: 'deepseek', model: 'deepseek-v4-flash', verifiedAvailable: true, apiFormat: 'openai-chat-completions', probeStatus: 'ready' });
  // Build a minimal index
  var source = 'const x = 1;';
  await request(app).post('/api/code/index/build').set('x-test-user', 'alice').send({
    workspaceId: 'local:rt-cap2', workspaceGeneration: 2,
    files: [{ path: 'src/main.js', content: source, size: Buffer.byteLength(source), sha256: sha(source) }]
  });
  const response = await request(app).post('/api/code/chat').set('x-test-user', 'alice').send({
    workspace_name: 'test', workspace_id: 'local:rt-cap2', workspace_generation: 2,
    message: '你的上下文窗口多大？', history: [], open_files: [], attachments: []
  });
  assert.equal(response.status, 200);
  assert.equal(toolResult.providerContextTokens, null);
  assert.equal(toolResult.providerMaxOutputTokens, null);
  // AI should not answer 200K when providerContextTokens is null
  assert.ok(!/200K|200,000|200 k/i.test(response.body.reply), 'should not fabricate 200K when data is null');
});

test('runtime response includes remainingEstimatedTokens when data is complete', async () => {
  const app = createApp(async (_messages, _options) => {
    return {
      content: '上下文分析完成。',
      model: 'deepseek-v4-flash',
      usage: { prompt_tokens: 500, completion_tokens: 200, prompt_cache_hit_tokens: 300, prompt_cache_miss_tokens: 100 }
    };
  }, { provider: 'deepseek', model: 'deepseek-v4-flash', verifiedAvailable: true, providerContextTokens: 128000, providerMaxOutputTokens: 32768, apiFormat: 'openai-chat-completions', probeStatus: 'ready' });
  // Build a minimal index
  var source = 'const x = 1;';
  await request(app).post('/api/code/index/build').send({
    workspaceId: 'local:rt-remain', workspaceGeneration: 3,
    files: [{ path: 'src/main.js', content: source, size: Buffer.byteLength(source), sha256: sha(source) }]
  });
  const response = await request(app).post('/api/code/chat').send({
    workspace_id: 'local:rt-remain', workspace_generation: 3,
    message: '还剩多少上下文？', history: [], open_files: [], attachments: []
  });
  assert.equal(response.status, 200);
  assert.ok(response.body.runtime, 'should have runtime');
  assert.ok(typeof response.body.runtime.remainingEstimatedTokens === 'number', 'remainingEstimatedTokens should be a number');
  assert.ok(response.body.runtime.remainingEstimatedTokens >= 0, 'remainingEstimatedTokens should be >= 0');
  assert.equal(response.body.runtime.cacheHitTokens, 300);
  assert.equal(response.body.runtime.cacheMissTokens, 100);
  assert.equal(response.body.runtime.completionTokens, 200);
});

test('context_info.runtime separates project index from model context', async () => {
  const app = createApp(async (_messages, _options) => {
    return { content: '项目有 3 个文件，但本轮只读了 1 个。', model: 'deepseek-v4-flash', usage: { prompt_tokens: 200, completion_tokens: 80 } };
  });
  // Build index via API
  var source = 'const c = 3;\n'.repeat(50);
  var buildRes = await request(app).post('/api/code/index/build').send({
    workspaceId: 'local:idx-sep', workspaceGeneration: 1,
    files: [
      { path: 'src/a.js', language: 'javascript', content: 'const a = 1;', sha256: sha('const a = 1;'), size: 12 },
      { path: 'src/b.js', language: 'javascript', content: 'const b = 2;', sha256: sha('const b = 2;'), size: 12 },
      { path: 'src/c.js', language: 'javascript', content: source, sha256: sha(source), size: Buffer.byteLength(source) }
    ]
  });
  assert.equal(buildRes.status, 200, 'index build should succeed');
  assert.ok(buildRes.body.ok, 'index build should return ok');
  const response = await request(app).post('/api/code/chat').send({
    workspace_id: 'local:idx-sep', workspace_generation: 1,
    message: '项目有多少文件？', history: [], open_files: [], attachments: []
  });
  assert.equal(response.status, 200);
  assert.ok(response.body.context_info.runtime, 'context_info should have runtime');
  assert.ok(response.body.context_info.index, 'should have index summary');
  // Index scale and runtime context are separate fields
  assert.ok(response.body.context_info.index.totalFiles > 0, 'index should show file count');
  assert.ok(response.body.context_info.runtime.provider, 'runtime should show provider');
  // The reply should NOT equate index chunks with context usage
  assert.ok(!/23966.*Token|400K/i.test(response.body.reply), 'reply should not claim index chunks = context usage');
});

test('first_tool_choice for identity question should call get_runtime_capabilities', async () => {
  // Verify that inferInitialToolChoice does NOT force list_files for identity questions
  const codeAgent = require('fs').readFileSync('render-api/code-agent.js', 'utf8');
  // The system prompt instructs the model to call get_runtime_capabilities for identity questions
  assert.match(codeAgent, /get_runtime_capabilities/);
  assert.match(codeAgent, /你是什么模型.*get_runtime_capabilities/);
});

test('runtime info is present even when no tools were called', async () => {
  const app = createApp(async (_messages, _options) => {
    return { content: '你好！', model: 'deepseek-v4-flash', usage: { prompt_tokens: 50, completion_tokens: 10 } };
  });
  // Build a minimal index
  var source = 'const x = 1;';
  await request(app).post('/api/code/index/build').send({
    workspaceId: 'local:rt-no-tools', workspaceGeneration: 4,
    files: [{ path: 'src/main.js', content: source, size: Buffer.byteLength(source), sha256: sha(source) }]
  });
  const response = await request(app).post('/api/code/chat').send({
    workspace_id: 'local:rt-no-tools', workspace_generation: 4,
    message: '你好', history: [], open_files: [], attachments: []
  });
  assert.equal(response.status, 200);
  assert.ok(response.body.runtime, 'should have runtime even without tool calls');
  assert.equal(response.body.runtime.provider, 'deepseek');
  assert.equal(response.body.runtime.toolReadTokens, 0);
  assert.ok(response.body.runtime.promptTokens > 0, 'should have promptTokens');
});

const { after } = require('node:test');
after(() => { setTimeout(() => process.exit(process.exitCode || 0), 10); });
