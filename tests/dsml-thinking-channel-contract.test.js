'use strict';

// 验证：DSML 出现在思考通道（reasoning_content）时不会泄漏给前端。
// 截图里用户看到的那一大段 <| | DSML | | ...> XML 正是从思考区漏出来的。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadCallDeepSeek(fetchImpl) {
  const source = fs.readFileSync('render-api/server.js', 'utf8');
  const start = source.indexOf('async function callDeepSeek(messages, options)');
  const end = source.indexOf('// ===================== M:', start);
  assert.ok(start >= 0 && end > start, 'callDeepSeek 源码应可提取');

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
  const deps = [
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
  vm.runInContext(deps + '\n' + source.slice(start, end) + '\nglobalThis.callDeepSeekForTest = callDeepSeek;', sandbox);
  return sandbox.callDeepSeekForTest;
}

function jsonResponse(data) {
  return { ok: true, json: async () => data };
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
          }
        };
      }
    }
  };
}

function sse(obj) { return 'data: ' + JSON.stringify(obj) + '\n\n'; }

const RUN_CODE_TOOL = {
  type: 'function',
  function: {
    name: 'run_code',
    parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'], additionalProperties: false }
  }
};

test('思考通道里的 DSML 不会泄漏给前端（截图场景）', async () => {
  const thinking = [];
  const contents = [];
  // DSML 被故意拆成多个 chunk，模拟流式切片
  const dsmlParts = [
    '<| | DSML | | calls>\n',
    '<| | DSML | | invoke name="run_code">\n',
    '<| | DSML | | parameter name="code" string="true">print(5050)</| | DSML | | parameter>\n',
    '</| | DSML | | invoke>\n</| | DSML | | calls>'
  ];
  const events = [];
  dsmlParts.forEach((p) => events.push(sse({ choices: [{ delta: { reasoning_content: p } }] })));
  events.push(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
  events.push('data: [DONE]\n\n');

  let requests = 0;
  const callDeepSeek = loadCallDeepSeek(async () => {
    requests += 1;
    if (requests === 1) return streamResponse(events);
    return jsonResponse({ choices: [{ message: { content: '已算出结果 5050。' } }] });
  });

  const result = await callDeepSeek([{ role: 'user', content: '算 1..100 的和' }], {
    model: 'deepseek-v4-flash-exp',
    tools: [RUN_CODE_TOOL],
    tool_choice: 'auto',
    max_tool_rounds: 4,
    tool_executor: async () => ({ ok: true, content: '沙箱输出: 5050' }),
    onThinkingChunk: (t) => thinking.push(t),
    onContentChunk: (t) => contents.push(t)
  });

  const allThinking = thinking.join('');
  const allContent = contents.join('');
  assert.doesNotMatch(allThinking, /DSML/i, '思考通道不得出现 DSML 原文');
  assert.doesNotMatch(allThinking, /<\s*[|\uff5c]/, '思考通道不得出现协议尖括号标记');
  assert.doesNotMatch(allContent, /DSML/i, '正文不得出现 DSML 原文');
  assert.doesNotMatch(String(result.content || ''), /DSML/i, '最终回答不得出现 DSML 原文');
});

test('非工具轮次的正常思考内容仍会推送给用户', async () => {
  const thinking = [];
  const events = [
    sse({ choices: [{ delta: { reasoning_content: '让我先分析一下这个问题。' } }] }),
    sse({ choices: [{ delta: { content: '答案是 42。' } }] }),
    sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    'data: [DONE]\n\n'
  ];
  const callDeepSeek = loadCallDeepSeek(async () => streamResponse(events));
  await callDeepSeek([{ role: 'user', content: '随便问个问题' }], {
    model: 'deepseek-v4-flash-exp',
    onThinkingChunk: (t) => thinking.push(t),
    onContentChunk: () => {}
  });
  const allThinking = thinking.join('');
  assert.match(allThinking, /让我先分析一下这个问题/, '无协议风险的正常思考内容应照常显示');
  assert.doesNotMatch(allThinking, /DSML/i);
});

// 截图实测的真实变体：`<| | DSML | |` 简写帧名 calls + string="true" 类型标记 + 多行代码体
const SCREENSHOT_DSML = [
  '<| | DSML | | calls>',
  '<| | DSML | | invoke name="run_code">',
  '<| | DSML | | parameter name="code" string="true">import sys, platform',
  'print("Python:", sys.version.split()[0])',
  'print("Sum 1..100 =", sum(range(1, 101)))</| | DSML | | parameter>',
  '</| | DSML | | invoke>',
  '</| | DSML | | calls>'
].join('\n');

test('截图实测 DSML 变体被解析为真实工具调用（不再当正文吐出）', async () => {
  const executed = [];
  let requests = 0;
  const callDeepSeek = loadCallDeepSeek(async () => {
    requests += 1;
    if (requests === 1) return jsonResponse({ choices: [{ message: { content: SCREENSHOT_DSML } }] });
    return jsonResponse({ choices: [{ message: { content: '已执行沙箱计算，1..100 求和为 5050。' } }] });
  });

  const result = await callDeepSeek([{ role: 'user', content: '用沙箱算 1 到 100 的和' }], {
    model: 'deepseek-v4-flash-exp',
    tools: [RUN_CODE_TOOL],
    tool_choice: 'auto',
    max_tool_rounds: 4,
    tool_executor: async (toolCall) => {
      const raw = toolCall && toolCall.function ? toolCall.function.arguments : '{}';
      let args = {};
      try { args = JSON.parse(raw); } catch (e) {}
      executed.push({ name: toolCall.function.name, args });
      return { ok: true, content: '沙箱输出: 5050' };
    }
  });

  assert.equal(executed.length, 1, 'DSML 简写变体应被解析并执行 1 次工具调用');
  assert.equal(executed[0].name, 'run_code');
  assert.equal(typeof executed[0].args.code, 'string', 'code 必须是字符串，不能被 string="true" 覆盖成布尔');
  assert.notEqual(executed[0].args.code, true, 'code 不能是布尔 true');
  assert.match(String(executed[0].args.code), /import sys, platform/, '代码体必须完整保留');
  assert.match(String(executed[0].args.code), /sum\(range\(1, 101\)\)/, '多行代码不能被截断');
  assert.doesNotMatch(String(result.content || ''), /DSML/i, '最终回答不得含 DSML 协议文本');
  assert.match(String(result.content || ''), /5050/, '最终回答应为自然语言结果');
});

test('全角竖线与标准无空格 DSML 格式仍然兼容', async () => {
  let requests = 0;
  const executed = [];
  const callDeepSeek = loadCallDeepSeek(async () => {
    requests += 1;
    if (requests === 1) {
      return jsonResponse({
        choices: [{ message: { content: '<\uff5cDSML\uff5ctool_calls><\uff5cDSML\uff5cinvoke name="run_code"><\uff5cDSML\uff5cparameter name="code" string="true">return 1+1;<\/\uff5cDSML\uff5cparameter><\/\uff5cDSML\uff5cinvoke><\/\uff5cDSML\uff5ctool_calls>' } }]
      });
    }
    return jsonResponse({ choices: [{ message: { content: '结果是 2。' } }] });
  });
  await callDeepSeek([{ role: 'user', content: '算 1+1' }], {
    model: 'deepseek-v4-flash-exp',
    tools: [RUN_CODE_TOOL],
    tool_choice: 'auto',
    max_tool_rounds: 2,
    tool_executor: async (toolCall) => {
      let args = {};
      try { args = JSON.parse(toolCall.function.arguments); } catch (e) {}
      executed.push(args);
      return { ok: true, content: 'ok' };
    }
  });
  assert.equal(executed.length, 1, '全角竖线变体应解析成功');
  assert.equal(String(executed[0].code), 'return 1+1;');
});

test('非法工具名与缺必填参数仍被拒绝（安全护栏不放宽）', async () => {
  const cases = [
    '<| | DSML | | calls><| | DSML | | invoke name="delete_everything"><| | DSML | | parameter name="x" string="true">boom</| | DSML | | parameter></| | DSML | | invoke></| | DSML | | calls>',
    '<| | DSML | | calls><| | DSML | | invoke name="run_code"><| | DSML | | parameter name="input" value="{}"></| | DSML | | parameter></| | DSML | | invoke></| | DSML | | calls>'
  ];
  for (const content of cases) {
    let executions = 0;
    const callDeepSeek = loadCallDeepSeek(async () => jsonResponse({ choices: [{ message: { content } }] }));
    const result = await callDeepSeek([{ role: 'user', content: '测试' }], {
      model: 'deepseek-v4-flash-exp',
      tools: [RUN_CODE_TOOL],
      tool_choice: 'auto',
      max_tool_rounds: 2,
      tool_executor: async () => { executions += 1; return { ok: true }; }
    });
    assert.equal(executions, 0, '非法调用不得执行：' + content.slice(0, 40));
    assert.doesNotMatch(String(result.content || ''), /DSML/i, 'DSML 原文不得泄漏');
    assert.doesNotMatch(String(result.content || ''), /<\s*[|\uff5c]/, '协议标记不得泄漏');
  }
});

// ===== 工作模式可见性契约 =====
// 用户反馈「开了工作模式跟没打开一样」：除了工具调用失败外，
// 界面没有任何可视反馈也是一大原因。以下断言保证徽标链路完整。
const fsTop = require('node:fs');
const pathTop = require('node:path');
const serverSrcTop = fsTop.readFileSync(pathTop.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
const jsSrcTop = fsTop.readFileSync(pathTop.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

test('后端：done 事件与落库元数据都带 work_mode 标记', () => {
  assert.match(serverSrcTop, /work_mode: workModeForStream/, 'done/落库应带 work_mode');
  assert.match(serverSrcTop, /req\._workMode = workModeEnabled/, '应在请求级记录工作模式');
  // ★ 2026-09-22 修正断言：原断言把错误实现钉死了 —— finishStream(res, opt) 是顶层函数，
  //   其作用域内没有 req（也不是参数），`!!(req && req._workMode === true)` 每次执行都会
  //   抛 ReferenceError（读取未声明标识符必抛），而所有调用点又都没传 opt.workMode，
  //   于是 work_mode 实际从未生效、且 finishStream 每次都在此处中断。
  //   修正后：由调用方经 opt.reqWorkMode 透传请求级标记。
  assert.match(serverSrcTop, /var workModeForStream = opt\.workMode === true \|\| opt\.reqWorkMode === true/, 'work_mode 应取 opt.workMode 或调用方透传的 reqWorkMode');
  assert.match(serverSrcTop, /reqWorkMode: req\._workMode === true/, '各 finishStream 调用点应透传请求级 work_mode');
});

test('前端：工作模式徽标与工具调用计数已接线', () => {
  assert.match(jsSrcTop, /ai-msg-work-badge/, '应有工作模式徽标样式类');
  assert.match(jsSrcTop, /text: '工作模式'/, '徽标文案应为「工作模式」');
  assert.match(jsSrcTop, /streamWorkMode/, '应追踪本次是否工作模式');
  assert.match(jsSrcTop, /streamToolCount/, '应统计工具调用次数');
  assert.match(jsSrcTop, /调用工具 ' \+ streamToolCount \+ ' 次'/, '应展示调用次数');
  assert.match(jsSrcTop, /if \(typeof evt\.work_mode === 'boolean'\) streamWorkMode = evt\.work_mode;/, '应以服务端回传为准');
});

test('前端：工作模式徽标样式已定义（含暗色主题）', () => {
  const css = fsTop.readFileSync(pathTop.join(__dirname, '..', 'css', 'ai-agent.css'), 'utf8');
  assert.match(css, /\.ai-msg-work-badge/);
  assert.match(css, /\[data-theme="dark"\] \.ai-msg-work-badge/);
});
