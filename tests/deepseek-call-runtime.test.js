'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadCallDeepSeek(fetchImpl) {
  const source = fs.readFileSync('render-api/server.js', 'utf8');
  const start = source.indexOf('async function callDeepSeek(messages, options)');
  const end = source.indexOf('// ===================== M:', start);
  assert.ok(start >= 0 && end > start, 'callDeepSeek source should be extractable');

  const sandbox = {
    fetch: fetchImpl,
    AbortController,
    DOMException,
    TextDecoder,
    setTimeout,
    clearTimeout,
    console: { log() {}, warn() {}, error() {} }
  };
  vm.createContext(sandbox);
  const dependencies = [
    "var DEEPSEEK_API_KEY = 'test-key';",
    "var DEEPSEEK_API_URL = 'https://api.deepseek.test/chat/completions';",
    "var DEEPSEEK_MODEL_REASONER = 'deepseek-v4-flash';",
    'var DEEPSEEK_TIMEOUT_MS = 5000;',
    'var DEEPSEEK_INPUT_PRICE_PER_1M = 1;',
    'var DEEPSEEK_OUTPUT_PRICE_PER_1M = 2;',
    'var DEEPSEEK_CACHE_HIT_PRICE_PER_1M = 0.02;',
    "var DEEPSEEK_CURRENCY = 'CNY';",
    'function getPreferredDeepSeekModel(model) { return model; }',
    'function normalizeDeepSeekUsageModel(model, fallback) { return model || fallback; }',
    'async function executeToolCall() { return { ok: true }; }'
  ].join('\n');
  vm.runInContext(dependencies + '\n' + source.slice(start, end) + '\nglobalThis.callDeepSeekForTest = callDeepSeek;', sandbox);
  return sandbox.callDeepSeekForTest;
}

function jsonResponse(data) {
  return {
    ok: true,
    json: async () => data
  };
}

function streamResponse(events) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= events.length) return { done: true };
            return { done: false, value: encoder.encode(events[index++]) };
          },
          async cancel() {}
        };
      }
    }
  };
}

test('streaming requests include usage and preserve cache counters from the empty-choice usage chunk', async () => {
  let requestBody;
  const callDeepSeek = loadCallDeepSeek(async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return streamResponse([
      'data: {"choices":[{"delta":{"content":"完成"}}],"usage":null}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":30,"completion_tokens":2,"total_tokens":32,"prompt_cache_hit_tokens":20,"prompt_cache_miss_tokens":10}}\n\n',
      'data: [DONE]\n\n'
    ]);
  });

  const result = await callDeepSeek(
    [{ role: 'user', content: '测试' }],
    { model: 'deepseek-v4-flash', temperature: 0.25, onContentChunk() {} }
  );

  assert.equal(requestBody.stream, true);
  assert.deepEqual(requestBody.stream_options, { include_usage: true });
  assert.deepEqual(requestBody.thinking, { type: 'disabled' });
  assert.equal(requestBody.reasoning_effort, undefined);
  assert.equal(requestBody.temperature, 0.25);
  assert.equal(result.content, '完成');
  assert.equal(result.usage.prompt_tokens, 30);
  assert.equal(result.usage.prompt_cache_hit_tokens, 20);
  assert.equal(result.usage.prompt_cache_miss_tokens, 10);
});

test('thinking mode is explicit and carries the requested effort level', async () => {
  let requestBody;
  const callDeepSeek = loadCallDeepSeek(async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return jsonResponse({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: '已完成', reasoning_content: '先分析' } }],
      usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 }
    });
  });

  const result = await callDeepSeek(
    [{ role: 'user', content: '请分析' }],
    { model: 'deepseek-v4-flash', thinking_mode: 'low' }
  );

  assert.deepEqual(requestBody.thinking, { type: 'enabled' });
  assert.equal(requestBody.reasoning_effort, 'low');
  assert.equal(result.content, '已完成');
  assert.equal(result.reasoning, '先分析');
});

test('multi-round tool calls aggregate usage and cache counters', async () => {
  const requests = [];
  const responses = [
    jsonResponse({
      model: 'deepseek-v4-flash',
      choices: [{
        message: {
          content: '',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"query":"hotel"}' } }]
        }
      }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6 }
    }),
    jsonResponse({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: '工具完成', tool_calls: [] } }],
      usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23, prompt_cache_hit_tokens: 8, prompt_cache_miss_tokens: 12 }
    })
  ];
  const callDeepSeek = loadCallDeepSeek(async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return responses.shift();
  });

  const result = await callDeepSeek(
    [{ role: 'user', content: '查酒店' }],
    {
      model: 'deepseek-v4-flash',
      tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
      tool_choice: 'auto',
      max_tool_rounds: 4,
      tool_executor: async () => ({ ok: true, hotels: ['A'] })
    }
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0].tool_choice, 'auto');
  assert.equal(requests[1].messages.at(-1).role, 'tool');
  assert.equal(result.content, '工具完成');
  assert.equal(result.usage.prompt_tokens, 30);
  assert.equal(result.usage.prompt_cache_hit_tokens, 12);
  assert.equal(result.usage.prompt_cache_miss_tokens, 18);
  assert.equal(result.usage.tool_call_count, 1);
});

test('a stream read failure rejects instead of returning a partial successful answer', async () => {
  const callDeepSeek = loadCallDeepSeek(async () => ({
    ok: true,
    body: {
      getReader() {
        return {
          async read() {
            throw new Error('socket reset');
          },
          async cancel() {}
        };
      }
    }
  }));

  await assert.rejects(
    () => callDeepSeek([{ role: 'user', content: '测试' }], { onContentChunk() {} }),
    /AI 调用异常/
  );
});

test('external cancellation is distinguished from an internal timeout', async () => {
  const callDeepSeek = loadCallDeepSeek(async (_url, init) => {
    if (init.signal.aborted) throw new DOMException('aborted', 'AbortError');
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
  });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => callDeepSeek([{ role: 'user', content: '测试' }], { signal: controller.signal }),
    error => error && error.code === 'AI_CANCELLED' && error.message === 'AI 调用已取消'
  );
});
