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
    process,
    setTimeout,
    clearTimeout,
    console: { log() {}, warn() {}, error() {} }
  };
  vm.createContext(sandbox);
  const dependencies = [
    "var DEEPSEEK_API_KEY = 'test-key';",
    "var DEEPSEEK_API_URL = 'https://api.deepseek.test/chat/completions';",
    "var DEEPSEEK_MODEL_REASONER = 'deepseek-v4-flash-vision-exp';",
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
    { model: 'deepseek-v4-flash-vision-exp', temperature: 0.25, onContentChunk() {} }
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
      model: 'deepseek-v4-flash-vision-exp',
      choices: [{ message: { content: '已完成', reasoning_content: '先分析' } }],
      usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 }
    });
  });

  const result = await callDeepSeek(
    [{ role: 'user', content: '请分析' }],
    { model: 'deepseek-v4-flash-vision-exp', thinking_mode: 'low' }
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
      model: 'deepseek-v4-flash-vision-exp',
      choices: [{
        message: {
          content: '',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"query":"hotel"}' } }]
        }
      }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6 }
    }),
    jsonResponse({
      model: 'deepseek-v4-flash-vision-exp',
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
      model: 'deepseek-v4-flash-vision-exp',
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

test('DSML content tool calls are parsed server-side, executed, and never returned as reply text', async () => {
  const seen = [];
  const requests = [];
  const responses = [
    jsonResponse({
      model: 'deepseek-v4-flash-vision-exp',
      choices: [{ message: { content: '<|DSML|tool_calls><|DSML|invoke name="read_file_range"><|DSML|parameter name="path" value="src/app.js"><|DSML|parameter name="start_line" value="12"><|DSML|parameter name="end_line" value="24"><|DSML|end>' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }),
    jsonResponse({
      model: 'deepseek-v4-flash-vision-exp',
      choices: [{ message: { content: '我已读取 src/app.js 的第 12 到 24 行。' } }],
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 }
    })
  ];
  const callDeepSeek = loadCallDeepSeek(async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return responses.shift();
  });
  const result = await callDeepSeek([{ role: 'user', content: '检查文件' }], {
    tools: [{ type: 'function', function: { name: 'read_file_range', parameters: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } }, required: ['path', 'start_line', 'end_line'], additionalProperties: false } } }],
    tool_executor: async call => { seen.push(JSON.parse(call.function.arguments)); return { ok: true, content: 'const ok = true;' }; }
  });
  assert.deepEqual(seen, [{ path: 'src/app.js', start_line: 12, end_line: 24 }]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages.at(-2).tool_calls[0].function.name, 'read_file_range');
  assert.doesNotMatch(requests[1].messages.at(-2).content, /DSML/);
  assert.equal(result.content, '我已读取 src/app.js 的第 12 到 24 行。');
  assert.doesNotMatch(result.content, /DSML|tool_calls|invoke|parameter|reasoning_content/i);
});

test('DSML supports multiple read_file_range calls in one response', async () => {
  const seen = [];
  const responses = [
    jsonResponse({ choices: [{ message: { content: '<|DSML|tool_calls><|DSML|invoke name="read_file_range"><|DSML|parameter name="path" value="a.js"><|DSML|parameter name="start_line" value="1"><|DSML|parameter name="end_line" value="2"><|DSML|invoke name="read_file_range"><|DSML|parameter name="path" value="b.js"><|DSML|parameter name="start_line" value="3"><|DSML|parameter name="end_line" value="4"><|DSML|end>' } }] }),
    jsonResponse({ choices: [{ message: { content: '已对比两个文件。' } }] })
  ];
  const callDeepSeek = loadCallDeepSeek(async () => responses.shift());
  const result = await callDeepSeek([{ role: 'user', content: '比较' }], {
    tools: [{ type: 'function', function: { name: 'read_file_range', parameters: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } }, required: ['path', 'start_line', 'end_line'], additionalProperties: false } } }],
    tool_executor: async call => { seen.push(JSON.parse(call.function.arguments)); return { ok: true }; }
  });
  assert.deepEqual(seen, [{ path: 'a.js', start_line: 1, end_line: 2 }, { path: 'b.js', start_line: 3, end_line: 4 }]);
  assert.equal(result.tool_calls_info.length, 2);
  assert.equal(result.content, '已对比两个文件。');
});

test('fragmented streamed DSML is buffered and never emitted through content chunks', async () => {
  const chunks = [];
  const dsml = '<|DSML|tool_calls><|DSML|invoke name="get_open_files"><|DSML|end>';
  const events = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: dsml.slice(0, 31) } }] }) + '\n\n',
    'data: ' + JSON.stringify({ choices: [{ delta: { content: dsml.slice(31) } }] }) + '\n\n',
    'data: [DONE]\n\n'
  ];
  let requests = 0;
  const callDeepSeek = loadCallDeepSeek(async () => {
    requests += 1;
    return requests === 1 ? streamResponse(events) : jsonResponse({ choices: [{ message: { content: '已查看当前打开的文件。' } }] });
  });
  const result = await callDeepSeek([{ role: 'user', content: '查看' }], {
    tools: [{ type: 'function', function: { name: 'get_open_files', parameters: { type: 'object', properties: {}, additionalProperties: false } } }],
    tool_executor: async () => ({ ok: true, files: [] }),
    onContentChunk: text => chunks.push(text)
  });
  assert.equal(result.content, '已查看当前打开的文件。');
  assert.equal(chunks.join(''), '已查看当前打开的文件。');
  assert.doesNotMatch(chunks.join(''), /DSML/);
});

test('incomplete or illegal DSML is not executed and returns a safe parse error', async () => {
  const invalidCases = [
    '<|DSML|tool_calls><|DSML|invoke name="read_file_range"><|DSML|parameter name="path" value="src/app.js"><|DSML|end>',
    '<|DSML|tool_calls><|DSML|invoke name="read_file_range"><|DSML|parameter name="path" value="../secret.js"><|DSML|parameter name="start_line" value="1"><|DSML|parameter name="end_line" value="2"><|DSML|end>'
  ];
  for (const content of invalidCases) {
    let executions = 0;
    const callDeepSeek = loadCallDeepSeek(async () => jsonResponse({ choices: [{ message: { content } }] }));
    const result = await callDeepSeek([{ role: 'user', content: '检查' }], {
      tools: [{ type: 'function', function: { name: 'read_file_range', parameters: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } }, required: ['path', 'start_line', 'end_line'], additionalProperties: false } } }],
      tool_executor: async () => { executions += 1; return { ok: true }; }
    });
    assert.equal(executions, 0);
    assert.equal(result.content, '（工具调用解析失败，请重试。）');
    assert.doesNotMatch(result.content, /DSML|tool_calls|invoke|parameter/i);
  }
});

test('a DSML tool execution failure is returned to the model without leaking the protocol', async () => {
  const requests = [];
  const responses = [
    jsonResponse({ choices: [{ message: { content: '<|DSML|tool_calls><|DSML|invoke name="read_file"><|DSML|parameter name="path" value="missing.js"><|DSML|end>' } }] }),
    jsonResponse({ choices: [{ message: { content: '未能读取 missing.js，因此无法确认该文件的实现。' } }] })
  ];
  const callDeepSeek = loadCallDeepSeek(async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return responses.shift();
  });
  const result = await callDeepSeek([{ role: 'user', content: '读取不存在的文件' }], {
    tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } } }],
    tool_executor: async () => ({ ok: false, error: '文件不存在' })
  });
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages.at(-1).content, /文件不存在/);
  assert.equal(result.content, '未能读取 missing.js，因此无法确认该文件的实现。');
  assert.doesNotMatch(result.content, /DSML|tool_calls|invoke|parameter|reasoning_content/i);
});

test('malformed tool calls are normalized before the next provider round', async () => {
  const requests = [];
  const responses = [
    jsonResponse({
      model: 'deepseek-v4-flash-vision-exp',
      choices: [{ message: {
        content: '',
        tool_calls: [{ type: 'function', function: { name: 'lookup', arguments: '{broken' } }]
      } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }),
    jsonResponse({
      model: 'deepseek-v4-flash-vision-exp',
      choices: [{ message: { content: '宸插畬鎴愭煡璇�', tool_calls: [] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    })
  ];
  const callDeepSeek = loadCallDeepSeek(async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return responses.shift();
  });

  await callDeepSeek(
    [{ role: 'user', content: '璇锋煡璇�' }],
    {
      model: 'deepseek-v4-flash-vision-exp',
      tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
      tool_executor: async tc => ({ ok: true, received: tc.function.arguments })
    }
  );

  assert.equal(requests.length, 2);
  const assistant = requests[1].messages.at(-2);
  const tool = requests[1].messages.at(-1);
  assert.match(assistant.tool_calls[0].id, /^call_1_1$/);
  assert.equal(assistant.tool_calls[0].function.arguments, '{}');
  assert.equal(tool.tool_call_id, assistant.tool_calls[0].id);
});

test('max_tokens is finite and clamped to the provider output limit', async () => {
  let requestBody;
  const callDeepSeek = loadCallDeepSeek(async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return jsonResponse({
      model: 'deepseek-v4-flash-vision-exp',
      choices: [{ message: { content: 'ok', tool_calls: [] } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    });
  });

  await callDeepSeek([{ role: 'user', content: 'test' }], {
    model: 'deepseek-v4-flash-vision-exp',
    max_tokens: 999999
  });
  assert.equal(requestBody.max_tokens, 384000);
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

test('external cancellation interrupts a pending tool round', async () => {
  const callDeepSeek = loadCallDeepSeek(async () => jsonResponse({
    model: 'deepseek-v4-flash-vision-exp',
    choices: [{ message: {
      content: '',
      tool_calls: [{ id: 'call_pending', type: 'function', function: { name: 'lookup', arguments: '{}' } }]
    } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  }));
  const controller = new AbortController();
  const pendingTool = callDeepSeek(
    [{ role: 'user', content: '绛夊緟宸ュ叿' }],
    {
      tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
      signal: controller.signal,
      tool_executor: async () => new Promise(() => {})
    }
  );
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(
    () => Promise.race([
      pendingTool,
      new Promise((_, reject) => setTimeout(() => reject(new Error('tool cancellation timed out')), 500))
    ]),
    error => error && error.code === 'AI_CANCELLED'
  );
});

test('external cancellation propagates through the no-tool recovery request', async () => {
  let requestCount = 0;
  const callDeepSeek = loadCallDeepSeek(async (_url, init) => {
    requestCount += 1;
    if (requestCount === 1) {
      return jsonResponse({
        model: 'deepseek-v4-flash-vision-exp',
        choices: [{ message: {
          content: '',
          tool_calls: [{ id: 'call_recovery', type: 'function', function: { name: 'lookup', arguments: '{}' } }]
        } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      });
    }
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
  });
  const controller = new AbortController();
  const pending = callDeepSeek(
    [{ role: 'user', content: 'continue after tool round' }],
    {
      signal: controller.signal,
      tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
      max_tool_rounds: 1,
      tool_executor: async () => ({ ok: true })
    }
  );
  setTimeout(() => controller.abort(), 15);
  await assert.rejects(
    () => Promise.race([
      pending,
      new Promise((_, reject) => setTimeout(() => reject(new Error('recovery cancellation timed out')), 500))
    ]),
    error => error && error.code === 'AI_CANCELLED'
  );
  assert.equal(requestCount, 2);
});

test('request timeout signal is wired into pending tool cancellation', () => {
  const source = fs.readFileSync('render-api/server.js', 'utf8');
  const start = source.indexOf('async function executeToolWithAbort(toolCall)');
  const end = source.indexOf('for (var round = 0;', start);
  assert.ok(start >= 0 && end > start);
  const helper = source.slice(start, end);
  assert.match(helper, /controller\.signal/);
  assert.match(helper, /Promise\.race/);
  assert.match(helper, /removeEventListener/);
});
