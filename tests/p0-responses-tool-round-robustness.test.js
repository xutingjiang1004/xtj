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



test('P0：思考已关闭时不得再回填 reasoning 项（effort:none 与 reasoning 冲突会 400）', () => {
  const {replayOutput}=require('../render-api/responses-context');
  const reasoning={type:'reasoning',id:'r',content:[{type:'reasoning_text',text:'原始推理'}]};
  const call={id:'call-one',itemId:'item-one',name:'lookup',arguments:'{}'};
  const input=replayOutput([reasoning,{type:'function_call',id:'item-one',call_id:'call-one'}],[reasoning],[call],'',false);
  assert.deepEqual(input.map(item=>item.type),['function_call']);assert.equal(input[0].call_id,'call-one');
});

test('P0：工具轮回传保持推理与调用顺序，不插入虚构的助手正文', () => {
  const {replayOutput}=require('../render-api/responses-context');
  const raw={type:'reasoning',id:'r',content:[{type:'reasoning_text',text:'完整原文'}],encrypted_content:'opaque'};
  const call={id:'c',itemId:'i',name:'lookup',arguments:'{}'};
  const input=replayOutput([raw,{type:'function_call',id:'i',call_id:'c'}],[raw],[call],'',true);
  assert.deepEqual(input.map(item=>item.type),['reasoning','function_call']);assert.deepEqual(input[0],raw);
  // Actual HTTP 400 behavior, including exact request and execution counts,
  // is covered by ai-responses-context.test.js with the real tool-loop function.
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
