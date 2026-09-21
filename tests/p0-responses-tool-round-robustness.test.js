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
    /var _pairCallId = r\.fcId \|\| \('call_r'/,
    'id 缺失时生成确定性占位，保证 function_call 与 function_call_output 配对非空'
  );
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
