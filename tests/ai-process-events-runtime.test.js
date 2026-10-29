'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {appendProcessEvent,getProcessEvents}=require('../render-api/ai-process-events');
test('thinking time accumulates resumed tool/reasoning phases and excludes the final prose and duplicate completion',()=>{
 const realNow=Date.now;let now=1000;Date.now=()=>now;
 try{
  const res={};appendProcessEvent(res,{type:'reasoning_start'});
  now=1600;appendProcessEvent(res,{type:'reasoning',text:'第一轮'});
  now=1700;appendProcessEvent(res,{type:'content',text:'我先查原文。'});assert.equal(res._aiThinkingElapsedMs,700);
  now=2000;appendProcessEvent(res,{type:'tool_calls',tools:[{id:'search-one',name:'search_web',args:{query:'原文'}}]});
  now=2600;appendProcessEvent(res,{type:'tool_result',call_id:'search-one',tool_name:'search_web',success:true,count:1});
  now=2800;appendProcessEvent(res,{type:'reasoning',text:'第二轮'});
  now=3000;appendProcessEvent(res,{type:'content',text:'根据原文得出结论。'});assert.equal(res._aiThinkingElapsedMs,1700);
  now=9000;appendProcessEvent(res,{type:'content',text:'后续正文'});appendProcessEvent(res,{type:'done'});assert.equal(res._aiThinkingElapsedMs,1700);
  // content 后紧跟 tool_calls 时，这句先存成 narration，排在工具前面；
  // 后面的「根据原文得出结论。」没有工具跟随，仍属于正文，不进过程事件。
  const events=getProcessEvents(res);
  assert.deepEqual(events.map(e=>e.type),['reasoning','narration','tools','reasoning']);
  assert.equal(events[1].text,'我先查原文。');
  assert.equal(res._aiThinkingActiveAt,null);
 }finally{Date.now=realNow;}
});
test('zero thinking duration stays measured zero after later body packets',()=>{
 const realNow=Date.now;let now=1000;Date.now=()=>now;
 try{const res={};appendProcessEvent(res,{type:'reasoning_start'});appendProcessEvent(res,{type:'content',text:'回答'});now=5000;appendProcessEvent(res,{type:'content',text:'继续'});assert.equal(res._aiThinkingElapsedMs,0);}finally{Date.now=realNow;}
});
test('local preparation and upstream waiting are never counted as model thinking',()=>{
 const realNow=Date.now;let now=1000;Date.now=()=>now;
 try{const res={};appendProcessEvent(res,{type:'reasoning_start',early:true,phase:'preparing'});now=3000;appendProcessEvent(res,{type:'reasoning_start',phase:'waiting'});assert.equal(res._aiThinkingStartedAt,undefined);now=4000;appendProcessEvent(res,{type:'reasoning',text:'实际思考'});now=4500;appendProcessEvent(res,{type:'content',text:'正文'});assert.equal(res._aiThinkingElapsedMs,500);}finally{Date.now=realNow;}
});
