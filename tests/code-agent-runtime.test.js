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

function createApp(callDeepSeek) {
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  registerCodeAgentRoutes(app, {
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
    callDeepSeek
  });
  return app;
}

test.afterEach(() => {
  codeIndex._resetRegistryForTests();
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
    ['list_files', 'search_code', 'read_file', 'read_file_range', 'get_symbols', 'get_active_file', 'get_open_files']
  );
  assert.equal(response.body.context_info.total_tool_calls, 2);
  assert.equal(response.body.context_info.files_read[0].path, 'src/example.js');
  assert.equal(response.body.usage.prompt_cache_hit_tokens, 900);
  assert.equal(response.body.usage.prompt_cache_hit_ratio, 0.75);
  assert.equal(response.body.capabilities.agentEnabled, true);
  assert.equal(response.body.capabilities.toolCallingEnabled, true);
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
  assert.equal(bob.body.rebuildRequired, true);
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
