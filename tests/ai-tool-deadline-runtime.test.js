'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const server=fs.readFileSync('render-api/server.js','utf8');
const policy=require('../render-api/ai-task-policy');
function wrapper(inner){
  const a=server.indexOf('async function executeToolCall('),b=server.indexOf('async function executeToolCallInner(',a);
  assert.ok(a>=0&&b>a,'wrapper must sit right before the inner implementation');
  return new Function('executeToolCallInner','setTimeout','clearTimeout',server.slice(a,b)+'\nreturn executeToolCall;')(inner,setTimeout,clearTimeout);
}
test('a tool that never answers is turned into a failed result at its deadline instead of stalling the round',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const run=wrapper(()=>new Promise(()=>{}));
  let settled=null;const pending=run({function:{name:'search_web',arguments:'{}'}},{}).then(r=>{settled=r;});
  t.mock.timers.tick(44999);await Promise.resolve();assert.equal(settled,null);
  t.mock.timers.tick(1);await pending;
  assert.equal(settled.tool_name,'search_web');assert.equal(settled.code,'TOOL_TIMEOUT');assert.match(settled.error,/45 秒/);
});
test('deadlines are longer for documents and sandboxed code, shorter for plain computation, and normal results pass through',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const hang=wrapper(()=>new Promise(()=>{}));
  for(const [name,ms] of [['read_document',60000],['run_code',75000],['calculate',30000]]){
    let out=null;const p=hang({function:{name,arguments:'{}'}},{}).then(r=>{out=r;});
    t.mock.timers.tick(ms-1);await Promise.resolve();assert.equal(out,null,name+' resolved early');t.mock.timers.tick(1);await p;assert.equal(out.code,'TOOL_TIMEOUT');
  }
  const ok=wrapper(async()=>({tool_name:'calculate',content:'5'}));
  assert.deepEqual(await ok({function:{name:'calculate',arguments:'{}'}},{}),{tool_name:'calculate',content:'5'});
});
test('every request carries the current date, and the agent policy covers parallel calls, failure recovery and a closing check',()=>{
  assert.doesNotMatch(server,/isTimeSensitive/);
  assert.match(server,/var timeContext = '\\n\\n【当前时间】北京时间：'/);
  assert.match(server,/weekday: 'long'/);
  for(const needle of ['同一轮里互不依赖','最多两次','绝不能因为某个工具失败就不回复用户','当前年份','给出结论前自检'])assert.ok(policy.TASK_POLICY.includes(needle),needle);
});
