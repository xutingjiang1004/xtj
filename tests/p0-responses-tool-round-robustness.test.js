// 合约测试：Responses 流式工具轮健壮性（"思考后调工具突然 AI 调用失败"修复）
// 背景：DeepSeek /responses 流式不以 data:[DONE] 结束，终止事件为
//   response.completed / response.incomplete / response.failed（官方文档）。
// 旧代码零处理 response.failed → 上游流内失败被当正常空回复，根因被吞。
"use strict";
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
const responsesFnStart = serverSrc.indexOf('async function callDeepSeekViaResponses(');
const responsesFnEnd = serverSrc.indexOf('\nasync function ', responsesFnStart + 10);
const responsesBody = serverSrc.slice(responsesFnStart, responsesFnEnd > 0 ? responsesFnEnd : responsesFnStart + 80000);
const strip = (s) => s.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const body = strip(responsesBody);

test('P0：流式解析必须处理 response.failed 终止事件并抛出带诊断的错误', () => {
  assert.match(body, /response\.failed/, '必须监听 response.failed 事件');
  assert.match(body, /PROVIDER_STREAM_FAILED/, '流内失败错误必须携带专用 code');
  assert.match(body, /response\.incomplete/, '必须至少记录 response.incomplete');
});

test('P0：function_call 必须归并 output_item.done 的 id（空 id 回传会被上游 400）', () => {
  assert.match(
    body,
    /output_item\.done' && sJson\.item && sJson\.item\.type === 'function_call'/,
    '必须监听 function_call 的 done 事件补全 id/arguments'
  );
});

test('P0：function_call_output 回传时空 id 必须有确定性占位兜底', () => {
  assert.match(
    body,
    /var _pairCallId = r\.fcId \|\| r\.fallbackId/,
    'id 缺失时回落到确定性占位，保证 function_call 与 function_call_output 配对非空'
  );
  // ★ 2026-09-22：占位 id 必须在 map 内部生成（旧实现在 forEach 里引用 map 的形参 fi，
  //   作用域外不存在 → 空 id 时抛 ReferenceError，整轮工具被吞成「AI 调用失败」）
  assert.match(
    body,
    /var fallbackId = 'call_r'/,
    'fallbackId 必须在 Promise.all 的 map 回调内生成并随结果返回'
  );
  assert.doesNotMatch(
    body,
    /r\.fcId \|\| \('call_r' \+ round \+ '_' \+ r\.fcName \+ '_' \+ fi\)/,
    '不得在 forEach 作用域内引用 map 的形参 fi（ReferenceError 隐患）'
  );
  // ★ 2026-09-22：function_call 回传必须同时写 id 与 call_id，兼容两种上游配对校验
  assert.match(
    body,
    /type: 'function_call', id: _pairCallId, call_id: _pairCallId/,
    'function_call 项必须同时携带 id 与 call_id（值相同），消除 id/call_id 不一致的 400'
  );
});

test('P0：工具轮回填 assistant 消息时不得写入空 content（上游 400）', () => {
  assert.match(
    body,
    /content: \(content && String\(content\)\.trim\(\)\) \? String\(content\) : '（正在调用工具）'/,
    '模型"只调工具不说话"时必须回传明确占位，而不是空串'
  );
});

test('P0：思考已关闭时不得再回填 reasoning 项（effort:none 与 reasoning 冲突会 400）', () => {
  assert.match(
    body,
    /if \(useThinking\) \{\s*\n\s*if \(roundReasoningItems\.length\)/,
    'reasoning 回填必须受 useThinking 闸门保护'
  );
});

test('P0：任何 400 都要按轮次做一次安全重试（剥离 reasoning + 补齐空 content）', () => {
  assert.match(
    body,
    /resp\.status === 400 && !_safe400RetryDone\['r' \+ round\]/,
    '400 重试必须按轮次记账，长工具链每轮都有自救机会'
  );
  const seg = body.slice(body.indexOf("resp.status === 400 && !_safe400RetryDone"), body.indexOf("resp.status === 400 && !_safe400RetryDone") + 1600);
  assert.match(seg, /_strippedInput/, '安全重试必须剥离 input 中的 reasoning 项');
  assert.match(seg, /effort: 'none'/, '安全重试必须关闭 reasoning');
});

test('P0：tools+thinking 被上游 400 拒绝时，降级重试必须同时剥离 reasoning 项', () => {
  const retryIdx = body.indexOf('__toolsThinkingFallbackDone = true');
  assert.ok(retryIdx > 0, '必须存在降级重试逻辑');
  const retrySeg = body.slice(retryIdx, retryIdx + 800);
  assert.match(retrySeg, /_strippedInput/, '重试请求必须剥离 input 中的 reasoning 项');
  assert.match(retrySeg, /effort: 'none'/, '重试必须关闭 reasoning');
});

test('P0：HTTP 5xx 与网络异常必须有一次自动重试', () => {
  assert.match(body, /upstream 5xx/, '5xx 需自动重试一次');
  assert.match(body, /network error/, '网络异常需自动重试一次');
});

test('P0：顶层错误分类不得让流内失败/5xx/网络错误落进笼统兜底文案', () => {
  assert.match(
    serverSrc,
    /_respErrCode === 'PROVIDER_STREAM_FAILED'/,
    '流内失败必须展示上游原因'
  );
  assert.ok(serverSrc.includes('/HTTP 5\\d\\d/'), '5xx 需要专属文案');
  assert.match(serverSrc, /ECONNRESET\|ETIMEDOUT/, '网络异常需要专属文案');
});
