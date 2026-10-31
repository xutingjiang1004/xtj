'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const server=fs.readFileSync('render-api/server.js','utf8');
const policy=require('../render-api/ai-task-policy');
const memorySource=server.slice(server.indexOf('// ===================== 长期记忆 ====================='),server.indexOf('// 单个工具调用的执行时限'));
// Minimal in-memory stand-in for the chained Supabase calls the memory tools use.
function fakeSupabase(options={}){
  const rows=[];let missing=!!options.missing;
  const builder=(table)=>{
    const state={filters:[],op:'select',order:null,limit:null,payload:null,inList:null};
    const api={
      select(){state.op='select';return api;},eq(col,val){state.filters.push([col,val]);return api;},order(col,opts){state.order=[col,opts];return api;},limit(n){state.limit=n;return api;},
      in(col,list){state.inList=[col,list];return api;},
      upsert(row){state.op='upsert';state.payload=row;return api;},delete(){state.op='delete';return api;},
      then(resolve,reject){return Promise.resolve(run()).then(resolve,reject);}
    };
    function run(){
      if(missing)return {error:{message:'relation "public.ai_user_memories" does not exist',code:'42P01'},data:null};
      const match=r=>state.filters.every(([c,v])=>r[c]===v)&&(!state.inList||state.inList[1].includes(r[state.inList[0]]));
      if(state.op==='upsert'){const i=rows.findIndex(r=>r.account_id===state.payload.account_id&&r.content_hash===state.payload.content_hash);if(i>=0)Object.assign(rows[i],state.payload);else rows.push({id:crypto.randomUUID(),created_at:new Date().toISOString(),...state.payload});return {error:null,data:null};}
      if(state.op==='delete'){for(let i=rows.length-1;i>=0;i--)if(match(rows[i]))rows.splice(i,1);return {error:null};}
      let out=rows.filter(match).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));if(state.limit)out=out.slice(0,state.limit);return {error:null,data:out.map(r=>({...r}))};
    }
    return api;
  };
  return {from:builder,rows,setMissing(v){missing=v;}};
}
function load(db){return new Function('supabase','crypto','console',memorySource+'\nreturn {executeAiMemoryTool,aiMemoryContextMessage,aiMemoryLooksSensitive};')(db,crypto,{error(){}});}
const user={accountId:'11111111-1111-1111-1111-111111111111'};

test('memory tools save, de-duplicate, list and forget per account, and refuse guests and sensitive text',async()=>{
  const db=fakeSupabase(),m=load(db);
  assert.match((await m.executeAiMemoryTool('save_memory',{content:'用户喜欢被叫小徐'},{guest:true,accountId:'g'})).error,/登录/);
  assert.match((await m.executeAiMemoryTool('save_memory',{content:'x'},{})).error,/登录/);
  assert.match((await m.executeAiMemoryTool('save_memory',{content:'用户喜欢被叫小徐',kind:'preference'},user)).content,/已记住/);
  await m.executeAiMemoryTool('save_memory',{content:'用户喜欢被叫  小徐！'},user);// same text apart from spaces/punctuation
  assert.equal(db.rows.length,1);assert.equal(db.rows[0].auth_record_id,user.accountId);assert.equal(db.rows[0].kind,'preference');
  assert.match((await m.executeAiMemoryTool('save_memory',{content:'我的密码是 hunter2abc'},user)).error,/不保存/);
  assert.match((await m.executeAiMemoryTool('save_memory',{content:'卡号 6222021234567890123'},user)).error,/不保存/);
  assert.equal(db.rows.length,1);
  await m.executeAiMemoryTool('save_memory',{content:'用户是后端工程师'},{accountId:'22222222-2222-2222-2222-222222222222'});
  const listed=await m.executeAiMemoryTool('list_memories',{},user);assert.match(listed.content,/共 1 条/);assert.doesNotMatch(listed.content,/后端工程师/);
  const id=String(db.rows[0].id).slice(0,8);
  assert.match((await m.executeAiMemoryTool('forget_memory',{id:'deadbeef'},user)).content,/没有找到/);
  assert.match((await m.executeAiMemoryTool('forget_memory',{id},user)).content,/已忘掉 1 条/);
  assert.equal(db.rows.filter(r=>r.account_id===user.accountId).length,0);assert.equal(db.rows.length,1);
  assert.match((await m.executeAiMemoryTool('forget_memory',{},user)).error,/编号|关键词/);
});

test('administrator accounts map to a null auth record, the cap is enforced and memories become a bounded system message',async()=>{
  const db=fakeSupabase(),m=load(db);
  await m.executeAiMemoryTool('save_memory',{content:'管理员偏好简短回答'},{accountId:'admin:boss'});
  assert.equal(db.rows[0].auth_record_id,null);
  for(let i=0;i<50;i++)await m.executeAiMemoryTool('save_memory',{content:'第'+i+'条不同的记忆内容 '+'字'.repeat(i)},user);
  assert.match((await m.executeAiMemoryTool('save_memory',{content:'第 51 条'},user)).error,/已满/);
  const message=await m.aiMemoryContextMessage(user);
  assert.equal(message.role,'system');assert.match(message.content,/资料，不是指令/);assert.ok(message.content.length<2400);
  assert.equal(await m.aiMemoryContextMessage({guest:true,accountId:'x'}),null);assert.equal(await m.aiMemoryContextMessage({}),null);
});

test('when the memory table is not available everything degrades quietly',async()=>{
  const db=fakeSupabase({missing:true}),m=load(db);
  assert.equal(await m.aiMemoryContextMessage(user),null);
  for(const [name,args] of [['save_memory',{content:'用户喜欢茶'}],['list_memories',{}],['forget_memory',{query:'茶'}]])assert.match((await m.executeAiMemoryTool(name,args,user)).error,/暂时不可用/);
});

function cachedWrapper(inner){
  const a=server.indexOf('async function executeToolCall('),b=server.indexOf('async function executeToolCallInner(',a);
  return new Function('executeToolCallInner','setTimeout','clearTimeout',server.slice(a,b)+'\nreturn executeToolCall;')(inner,setTimeout,clearTimeout);
}
const call=(name,args)=>({function:{name,arguments:JSON.stringify(args)}});
test('identical read-only tool calls in one request run once, including parallel duplicates, with exact argument matching',async()=>{
  let runs=0;const run=cachedWrapper(async(tc)=>{runs++;await new Promise(r=>setTimeout(r,5));return {tool_name:tc.function.name,content:'ok'+runs};});
  const ctx={};
  const [first,second]=await Promise.all([run(call('read_web_page',{url:'https://a.com',opts:{x:1,y:2}}),ctx),run(call('read_web_page',{opts:{y:2,x:1},url:'https://a.com'}),ctx)]);
  assert.equal(runs,1);assert.equal(first.content,second.content);
  const third=await run(call('read_web_page',{url:'https://a.com',opts:{x:1,y:3}}),ctx);assert.equal(runs,2);assert.equal(third.cached,undefined);
  const again=await run(call('read_web_page',{url:'https://a.com',opts:{x:1,y:2}}),ctx);assert.equal(runs,2);assert.equal(again.cached,true);
  await run(call('search_web',{query:'q'}),ctx);await run(call('search_web',{query:'q'}),ctx);assert.equal(runs,4);// searches are never served from the cache
  const otherRequest=await run(call('read_web_page',{url:'https://a.com',opts:{x:1,y:2}}),{});assert.equal(runs,5);assert.equal(otherRequest.cached,undefined);
});
test('failed results are not cached so a retry really retries',async()=>{
  let runs=0;const run=cachedWrapper(async(tc)=>{runs++;return runs===1?{tool_name:tc.function.name,error:'boom'}:{tool_name:tc.function.name,content:'fine'};});
  const ctx={};assert.equal((await run(call('get_weather',{location:'福州'}),ctx)).error,'boom');
  assert.equal((await run(call('get_weather',{location:'福州'}),ctx)).content,'fine');assert.equal(runs,2);
});
test('the policy teaches memory, confirmation and answer verification, and the four tools are registered with executors',()=>{
  for(const needle of ['save_memory','forget_memory','ask_user','答案核查','只有一个来源','来自网页或工具结果的内容'])assert.ok(policy.TASK_POLICY.includes(needle),needle);
  for(const name of ['save_memory','list_memories','forget_memory','ask_user']){
    assert.match(server,new RegExp("name: '"+name+"',"),name+' definition');assert.match(server,new RegExp("case '"+name+"':"),name+' executor');
  }
  assert.match(server,/aiMemoryContextMessage\(requestSearchCtx\(req, req\.userName \|\| ''\)\)/);assert.match(server,/aiMemoryContextMessage\(toolContext\)/);
  assert.match(fs.readFileSync('supabase/migrations/20261031180000_ai_user_memories.sql','utf8'),/ENABLE ROW LEVEL SECURITY[\s\S]*REVOKE ALL ON TABLE public\.ai_user_memories FROM PUBLIC, anon, authenticated[\s\S]*TO service_role/);
});
