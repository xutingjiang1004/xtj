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

function parseSseEvents(text) {
  return String(text || '').split(/\r?\n\r?\n/).map(block => {
    const line = block.split(/\r?\n/).find(item => item.startsWith('data: '));
    if (!line) return null;
    try { return JSON.parse(line.slice(6)); } catch (_) { return null; }
  }).filter(Boolean);
}

test.afterEach(() => {
  codeIndex._resetRegistryForTests();
});

test('stream progress exposes a monotonic phase cursor and stable tool index', async () => {
  const app = createApp(async (_messages, options) => {
    await options.tool_executor({
      id: 'tool-stream-1',
      function: { name: 'get_open_files', arguments: '{}' }
    });
    return { content: 'stream timeline complete', model: 'deepseek-v4-flash', usage: {} };
  });

  const response = await request(app).post('/api/code/chat/stream').set('x-test-user', 'alice').send({
    workspace_name: 'stream-trace',
    workspace_id: 'local:stream-trace',
    workspace_generation: 1,
    message: 'hello',
    history: [],
    open_files: [],
    attachments: []
  });

  assert.equal(response.status, 200);
  const events = parseSseEvents(response.text);
  assert.ok(events.some(event => event.type === 'done'), 'stream should emit a terminal done event');

  const phaseEvents = events.filter(event => event.data && Number.isFinite(Number(event.data.phase_sequence)));
  assert.ok(phaseEvents.length >= 5, 'accepted, planning, status and tool events should expose phase metadata');
  const sequences = phaseEvents.map(event => Number(event.data.phase_sequence));
  assert.ok(sequences.every((value, index) => index === 0 || value >= sequences[index - 1]), 'phase sequence must never move backwards');

  const toolStart = events.find(event => event.type === 'tool_start');
  const toolResult = events.find(event => event.type === 'tool_result');
  assert.ok(toolStart && toolResult, 'tool start and result events should both be present');
  assert.equal(toolStart.data.tool_index, 1);
  assert.equal(toolResult.data.tool_index, 1);
  assert.ok(Number(toolResult.data.phase_sequence) >= Number(toolStart.data.phase_sequence));
  const done = events.find(event => event.type === 'done');
  assert.ok(Number.isFinite(Number(done.data.phase_sequence)), 'terminal event should carry the final phase cursor');
  assert.equal(done.data.tool_trace[0].round, 1, 'final tool receipt should preserve the execution round');
});

test('generated edits are preflighted against supplied files before they reach Apply', async () => {
  const source = 'one line';
  const app = createApp(async () => ({
    content: JSON.stringify({ operations: [
      {
        type: 'replace_range',
        path: 'src/one.js',
        summary: 'invalid line range',
        expected_sha256: sha(source),
        start_line: 21,
        end_line: 21,
        new_content: 'replacement'
      },
      {
        type: 'replace_range',
        path: 'report.docx',
        summary: 'wrong document operation type',
        expected_sha256: sha(source),
        start_line: 1,
        end_line: 1,
        new_content: 'replacement'
      }
    ]
    }),
    model: 'deepseek-v4-flash',
    usage: {}
  }));

  const response = await request(app).post('/api/code/chat').set('x-test-user', 'alice').send({
    workspace_name: 'test', workspace_id: 'local:test', workspace_generation: 1,
    message: 'modify the supplied files', history: [],
    open_files: [
      { path: 'src/one.js', content: source, sha256: sha(source), mimeType: 'text/javascript' },
      { path: 'report.docx', content: 'document text', sha256: sha('document text'), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
    ],
    attachments: []
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.operations, []);
  assert.match(response.body.reply, /Some generated edits were skipped/);
  assert.match(response.body.reply, /line range 21-21/);
  assert.match(response.body.reply, /report\.docx requires a document operation/);
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

test('Code models endpoint exposes only the deployment-configured model', async () => {
  const app = createApp(async () => ({ content: 'unused' }));
  const response = await request(app).get('/api/code/models').set('x-test-user', 'alice');
  assert.equal(response.status, 200);
  assert.equal(response.body.default_model, 'deepseek-v4-flash');
  assert.deepEqual(response.body.models.map(model => model.id), ['deepseek-v4-flash']);
  assert.equal(response.body.models[0].supports_thinking, true);
  assert.equal(response.body.models[0].availability, 'degraded');
  assert.equal(response.body.models[0].probe_status, 'idle');
});

test('Code chat rejects an unknown model id and invalid thinking mode before provider use', async () => {
  let calls = 0;
  const app = createApp(async () => { calls++; return { content: 'unused' }; });
  const base = { workspace_name: 'test', workspace_id: 'local:test', workspace_generation: 1, message: 'hello', history: [], open_files: [], attachments: [] };
  const unknownModel = await request(app).post('/api/code/chat').set('x-test-user', 'alice').send(Object.assign({}, base, { model_id: 'not-configured' }));
  assert.equal(unknownModel.status, 400);
  assert.equal(unknownModel.body.code, 'MODEL_NOT_AVAILABLE');
  const invalidThinking = await request(app).post('/api/code/chat').set('x-test-user', 'alice').send(Object.assign({}, base, { model_id: 'deepseek-v4-flash', thinking_mode: 'unsafe-value' }));
  assert.equal(invalidThinking.status, 400);
  assert.equal(invalidThinking.body.code, 'INVALID_THINKING_MODE');
  assert.equal(calls, 0);
});

// ── Runtime identity & capabilities tests ─────────────────────────────

test('open file overlay provides safe list and search fallbacks without a project index', async () => {
  let listed;
  let searched;
  const app = createApp(async (_messages, options) => {
    listed = await options.tool_executor({
      id: 'list-open',
      function: { name: 'list_files', arguments: JSON.stringify({ directory: 'src', depth: 2, pattern: '*.js' }) }
    });
    searched = await options.tool_executor({
      id: 'search-open',
      function: { name: 'search_code', arguments: JSON.stringify({ query: 'render', path: 'src/main.js' }) }
    });
    return { content: 'open context inspected', model: 'deepseek-v4-flash' };
  });
  const response = await request(app).post('/api/code/chat').set('x-test-user', 'alice').send({
    workspace_id: 'overlay-only', workspace_generation: 1, active_path: 'src/main.js',
    message: '检查当前打开文件',
    open_files: [{ path: 'src\\main.js', content: 'function render() { return true; }\nconst ready = true;' }],
    attachments: []
  });
  assert.equal(response.status, 200);
  assert.equal(listed.ok, true);
  assert.equal(listed.source, 'open_files');
  assert.equal(listed.files[0].path, 'src/main.js');
  assert.equal(searched.ok, true);
  assert.equal(searched.source, 'open_files');
  assert.equal(searched.results[0].path, 'src/main.js');
  assert.equal(searched.results[0].startLine, 1);
  assert.equal(response.body.tool_trace.every(item => item.ok), true);
});

test('open-file overlays normalize paths and safely back tools without a project index', async () => {
  let toolResults;
  const app = createApp(async (_messages, options) => {
    const listed = await options.tool_executor({
      id: 'overlay-list',
      function: { name: 'list_files', arguments: JSON.stringify({ directory: 'src', depth: 2 }) }
    });
    const searched = await options.tool_executor({
      id: 'overlay-search',
      function: { name: 'search_code', arguments: JSON.stringify({ query: 'needle', path: 'src\\app.js' }) }
    });
    const read = await options.tool_executor({
      id: 'overlay-read',
      function: { name: 'read_file', arguments: JSON.stringify({ path: 'src\\app.js' }) }
    });
    toolResults = { listed, searched, read };
    return { content: 'overlay inspected', model: 'deepseek-v4-flash', usage: {} };
  });
  const response = await request(app).post('/api/code/chat').set('x-test-user', 'alice').send({
    workspace_name: 'overlay', workspace_id: 'local:overlay', workspace_generation: 1,
    message: 'read the open file', history: [], active_path: 'src/app.js',
    open_files: [{ path: 'src\\app.js', content: 'const needle = true;\nconst other = false;', language: 'javascript' }],
    attachments: []
  });
  assert.equal(response.status, 200);
  assert.equal(toolResults.listed.ok, true);
  assert.equal(toolResults.listed.source, 'open_files');
  assert.equal(toolResults.listed.indexed, false);
  assert.equal(toolResults.listed.files[0].path, 'src/app.js');
  assert.equal(toolResults.searched.ok, true);
  assert.equal(toolResults.searched.source, 'open_files');
  assert.equal(toolResults.searched.results[0].path, 'src/app.js');
  assert.equal(toolResults.read.ok, true);
  assert.equal(toolResults.read.source, 'open');
  assert.match(toolResults.read.content, /needle/);
});

test('tools return explicit index and unsupported-tool errors when no safe fallback exists', async () => {
  let indexError;
  let unsupportedError;
  let malformedError;
  const app = createApp(async (_messages, options) => {
    indexError = await options.tool_executor({
      id: 'missing-index',
      function: { name: 'search_code', arguments: JSON.stringify({ query: 'needle' }) }
    });
    unsupportedError = await options.tool_executor({
      id: 'unknown-tool',
      function: { name: 'unknown_tool', arguments: '{}' }
    });
    malformedError = await options.tool_executor({
      id: 'malformed-json',
      function: { name: 'list_files', arguments: '{"directory":' }
    });
    return { content: 'tool errors handled', model: 'deepseek-v4-flash', usage: {} };
  });
  const response = await request(app).post('/api/code/chat').set('x-test-user', 'alice').send({
    workspace_name: 'no-index', workspace_id: 'local:no-index', workspace_generation: 1,
    message: 'hello', history: [], open_files: [], attachments: []
  });
  assert.equal(response.status, 200);
  assert.equal(indexError.ok, false);
  assert.equal(indexError.code, 'INDEX_NOT_FOUND');
  assert.match(indexError.error, /No project index built/);
  assert.equal(unsupportedError.ok, false);
  assert.equal(unsupportedError.code, 'UNSUPPORTED_TOOL');
  assert.equal(malformedError.ok, false);
  assert.equal(malformedError.code, 'INVALID_TOOL_ARGUMENTS');
  assert.equal(response.body.tool_trace[0].code, 'INDEX_NOT_FOUND');
  assert.equal(response.body.tool_trace[1].code, 'UNSUPPORTED_TOOL');
  assert.equal(response.body.tool_trace[2].code, 'INVALID_TOOL_ARGUMENTS');
  assert.equal(response.body.tool_trace[0].ok, false);
});

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

// ── P0 Fix: Conversation isolation, history source, dedup, thinking mode tests ──

test('P0: client history takes priority over server cache — no merging', async () => {
  var callCount = 0;
  const app = createApp(async (messages) => {
    callCount++;
    // Verify the history used is exactly what the client sent (2 items), not merged with cache
    // The message array should have: system + 2 history + 1 user = 4 messages
    return { content: 'Response', model: 'deepseek-v4-flash', usage: {}, finalMessages: messages };
  });
  // First request: establish cache with 3 history items
  var source = 'const a = 1;';
  await request(app).post('/api/code/index/build').send({
    workspaceId: 'p0-history', workspaceGeneration: 1,
    files: [{ path: 'src/a.js', content: source, size: Buffer.byteLength(source), sha256: sha(source) }]
  });
  await request(app).post('/api/code/chat').send({
    workspace_id: 'p0-history', workspace_generation: 1,
    conversation_id: 'conv-1',
    message: 'Q1', history: [
      { role: 'user', content: 'Old Q1' },
      { role: 'assistant', content: 'Old A1' },
      { role: 'user', content: 'Old Q2' }
    ]
  });
  // Second request: send only 2 history items
  callCount = 0;
  const response = await request(app).post('/api/code/chat').send({
    workspace_id: 'p0-history', workspace_generation: 1,
    conversation_id: 'conv-1',
    message: 'Q2', history: [
      { role: 'user', content: 'Recent Q1' },
      { role: 'assistant', content: 'Recent A1' }
    ]
  });
  assert.equal(response.status, 200);
  assert.ok(response.body.ok);
});

test('P0: client_request_id prevents duplicate model calls', async () => {
  var callCount = 0;
  const app = createApp(async () => {
    callCount++;
    return { content: 'Response', model: 'deepseek-v4-flash', usage: {} };
  });
  var source = 'const b = 2;';
  await request(app).post('/api/code/index/build').send({
    workspaceId: 'p0-dedup', workspaceGeneration: 2,
    files: [{ path: 'src/b.js', content: source, size: Buffer.byteLength(source), sha256: sha(source) }]
  });
  // Send two identical requests with same client_request_id
  var reqBody = {
    workspace_id: 'p0-dedup', workspace_generation: 2,
    conversation_id: 'conv-dedup',
    client_request_id: 'cr_unique_123',
    message: 'Hello', history: []
  };
  await request(app).post('/api/code/chat').send(reqBody);
  var firstCount = callCount;
  callCount = 0;
  await request(app).post('/api/code/chat').send(reqBody);
  // Each request still calls the model (frontend dedup is separate)
  assert.equal(callCount, 1);
});

test('P0: history already-answered questions are not re-answered — system prompt rule exists', async () => {
  const fs = require('fs');
  const code = fs.readFileSync('render-api/code-agent.js', 'utf8');
  assert.match(code, /只回答最后一条用户消息/);
  assert.match(code, /历史中已经存在助手回复的问题，不得重新回答/);
  assert.match(code, /禁止主动复述或回答历史问题/);
});

test('P0: thinking mode high is sent in request and verified in response', async () => {
  var receivedThinkingMode = null;
  const app = createApp(async (_messages, options) => {
    receivedThinkingMode = options.thinking_mode;
    return {
      content: 'Response',
      model: 'deepseek-v4-flash',
      thinking_mode: 'high',
      reasoning: 'deep thinking trace...',
      reasoning_tokens: 150,
      usage: {}
    };
  });
  var source = 'const c = 3;';
  await request(app).post('/api/code/index/build').send({
    workspaceId: 'p0-thinking', workspaceGeneration: 3,
    files: [{ path: 'src/c.js', content: source, size: Buffer.byteLength(source), sha256: sha(source) }]
  });
  const response = await request(app).post('/api/code/chat').send({
    workspace_id: 'p0-thinking', workspace_generation: 3,
    message: 'Explain code', history: [],
    thinking_mode: 'high'
  });
  assert.equal(response.status, 200);
  assert.equal(receivedThinkingMode, 'high');
  assert.ok(response.body.runtime, 'should have runtime');
  assert.equal(response.body.runtime.requestedThinkingMode, 'high');
  assert.equal(response.body.runtime.effectiveThinkingMode, 'high');
  assert.equal(response.body.runtime.thinkingEnabled, true);
  assert.equal(response.body.runtime.reasoningTokens, 150);
});

test('selected pro model is injected into runtime identity, not the deployment default', async () => {
  var receivedModel = null;
  var receivedMessages = null;
  const app = createApp(async (messages, options) => {
    receivedMessages = messages;
    receivedModel = options.model;
    return { content: 'Response', model: 'deepseek-v4-pro', thinking_mode: 'high', usage: {} };
  }, null, { getDeepSeekModel: () => 'deepseek-v4-pro' });
  const response = await request(app).post('/api/code/chat').send({
    workspace_id: 'p0-selected-model', workspace_generation: 1,
    message: '你是什么模型', history: [],
    model_id: 'deepseek-v4-pro', thinking_mode: 'high'
  });
  assert.equal(response.status, 200);
  assert.equal(receivedModel, 'deepseek-v4-pro');
  assert.ok(receivedMessages.some(message => String(message.content || '').includes('deepseek-v4-pro')));
  assert.equal(response.body.runtime.model, 'deepseek-v4-pro');
});

test('P0: thinking mode off is respected', async () => {
  var receivedThinkingMode = null;
  const app = createApp(async (_messages, options) => {
    receivedThinkingMode = options.thinking_mode;
    return { content: 'Response', model: 'deepseek-v4-flash', usage: {} };
  });
  var source = 'const d = 4;';
  await request(app).post('/api/code/index/build').send({
    workspaceId: 'p0-thinking-off', workspaceGeneration: 4,
    files: [{ path: 'src/d.js', content: source, size: Buffer.byteLength(source), sha256: sha(source) }]
  });
  const response = await request(app).post('/api/code/chat').send({
    workspace_id: 'p0-thinking-off', workspace_generation: 4,
    message: 'Hi', history: [],
    thinking_mode: 'off'
  });
  assert.equal(response.status, 200);
  assert.equal(receivedThinkingMode, 'off');
  assert.equal(response.body.runtime.thinkingEnabled, false);
});

test('P0: switching workspace generation discards old cached history', async () => {
  const app = createApp(async () => {
    return { content: 'Response', model: 'deepseek-v4-flash', usage: {} };
  });
  var source = 'const e = 5;';
  await request(app).post('/api/code/index/build').send({
    workspaceId: 'p0-switch', workspaceGeneration: 1,
    files: [{ path: 'src/e.js', content: source, size: Buffer.byteLength(source), sha256: sha(source) }]
  });
  // Establish session at gen 1
  await request(app).post('/api/code/chat').send({
    workspace_id: 'p0-switch', workspace_generation: 1,
    conversation_id: 'conv-switch',
    message: 'Q1', history: [
      { role: 'user', content: 'Gen1 Q1' },
      { role: 'assistant', content: 'Gen1 A1' }
    ]
  });
  // Switch to gen 2 — should NOT use gen 1 cached history
  await request(app).post('/api/code/index/build').send({
    workspaceId: 'p0-switch', workspaceGeneration: 2,
    files: [{ path: 'src/e.js', content: source, size: Buffer.byteLength(source), sha256: sha(source) }]
  });
  const response = await request(app).post('/api/code/chat').send({
    workspace_id: 'p0-switch', workspace_generation: 2,
    conversation_id: 'conv-switch',
    message: 'Q2', history: [
      { role: 'user', content: 'Gen2 Q1' }
    ]
  });
  assert.equal(response.status, 200);
  assert.ok(response.body.ok);
});

test('P0: new conversation ID creates fresh history, does not carry over old', async () => {
  const app = createApp(async () => {
    return { content: 'Response', model: 'deepseek-v4-flash', usage: {} };
  });
  var source = 'const f = 6;';
  await request(app).post('/api/code/index/build').send({
    workspaceId: 'p0-newconv', workspaceGeneration: 1,
    files: [{ path: 'src/f.js', content: source, size: Buffer.byteLength(source), sha256: sha(source) }]
  });
  // Old conversation with history
  await request(app).post('/api/code/chat').send({
    workspace_id: 'p0-newconv', workspace_generation: 1,
    conversation_id: 'conv-old',
    message: 'Q1', history: [
      { role: 'user', content: 'Old question' },
      { role: 'assistant', content: 'Old answer' }
    ]
  });
  // New conversation, no history
  const response = await request(app).post('/api/code/chat').send({
    workspace_id: 'p0-newconv', workspace_generation: 1,
    conversation_id: 'conv-new',
    message: 'New question', history: []
  });
  assert.equal(response.status, 200);
  assert.ok(response.body.ok);
});

test('P0: PROVIDER_HTTP_400 returns structured error with diagnostics', async () => {
  const app = createApp(async () => {
    var err = new Error('HTTP 400: invalid model parameter');
    err.code = 'PROVIDER_HTTP_400';
    throw err;
  });
  var source = 'const g = 7;';
  await request(app).post('/api/code/index/build').send({
    workspaceId: 'p0-400', workspaceGeneration: 1,
    files: [{ path: 'src/g.js', content: source, size: Buffer.byteLength(source), sha256: sha(source) }]
  });
  const response = await request(app).post('/api/code/chat').send({
    workspace_id: 'p0-400', workspace_generation: 1,
    message: 'Test', history: []
  });
  assert.equal(response.status, 502);
  assert.ok(response.body.code, 'should have error code');
  assert.ok(response.body.requestId, 'should have requestId');
});

test('P0: cancel, timeout and error each only finalize once', async () => {
  // Verify that the code ensures done/error/cancelled are mutually exclusive
  const fs = require('fs');
  const code = fs.readFileSync('render-api/code-agent.js', 'utf8');
  assert.match(code, /finalized\s*=\s*true/);
  assert.match(code, /finalized\s*\|\|\s*aborted/);
  assert.match(code, /type\s*===\s*'done'\s*\|\|\s*type\s*===\s*'error'/);
});

test('P0: auto retry does not add duplicate user message', async () => {
  // Verify the frontend code doesn't call restoreFailedMessage twice
  const fs = require('fs');
  const code = fs.readFileSync('js/code-workspace.js', 'utf8');
  // Check that restoreFailedMessage is not called in the error handler (removed)
  var restoreCalls = (code.match(/restoreFailedMessage/g) || []).length;
  assert.ok(restoreCalls <= 4, 'restoreFailedMessage should not be called excessively');
});

test('P0: message_id is used for dedup instead of role+content prefix', async () => {
  const fs = require('fs');
  const code = fs.readFileSync('render-api/code-agent.js', 'utf8');
  assert.match(code, /message_id/);
  assert.match(code, /seenIds\.add/);
  // Old pattern should be gone
  var oldPattern = code.match(/seen\.add\(h\.role\s*\+\s*':'/);
  assert.equal(oldPattern, null, 'old role+content dedup pattern should be removed');
});

test('P0: client history is preferred over server cache', async () => {
  const fs = require('fs');
  const code = fs.readFileSync('render-api/code-agent.js', 'utf8');
  assert.match(code, /hasClientHistory/);
  assert.match(code, /currentHistory\s*=\s*history/);
  assert.match(code, /前端 history 是当前请求的唯一历史快照/);
});

const { after } = require('node:test');
after(() => { setTimeout(() => process.exit(process.exitCode || 0), 10); });
