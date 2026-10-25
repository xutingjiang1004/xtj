'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const responsesContext=require('../render-api/responses-context');
const source=fs.readFileSync('render-api/server.js','utf8');
const start=source.indexOf('async function callDeepSeekViaResponses('),end=source.indexOf('\nasync function ',start+10);
function load(fetch){const c={deepSeekPricing:require('../render-api/deepseek-pricing'),fetch,AbortController,TextDecoder,Response,setTimeout,clearTimeout,aiTaskPolicy:require('../render-api/ai-task-policy'),responsesContext,console:{log(){},warn(){},error(){}},DEEPSEEK_API_KEY:'test',DEEPSEEK_RESPONSES_URL:'https://test.invalid/responses',DEEPSEEK_RESPONSES_MODEL:'deepseek-flash',DEBUG_PROVIDER:false,DEBUG_PROVIDER_ALWAYS:false,getPreferredDeepSeekModel:x=>x,executeToolCall:async()=>({ok:true}),finalReplyContainsInternalProtocolGlobal:()=>false,looksLikeToolArgsFragment:()=>false,responsesUsageToInternal:()=>({prompt_tokens:1,completion_tokens:1,total_tokens:2})};vm.createContext(c);vm.runInContext(source.slice(start,end)+'\nglobalThis.call=callDeepSeekViaResponses;',c);return c.call;}
function stream(events){return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});}
const tools=[{type:'function',function:{name:'lookup',parameters:{type:'object'}}}];
for(const streaming of [false,true])test('real Responses tool loop preserves provider reasoning_text, encrypted fields and distinct call IDs ('+streaming+')',async()=>{let requests=0,executed=0,body='';const raw={type:'reasoning',id:'reason-1',content:[{type:'reasoning_text',text:'核对原始来源'}],summary:[],encrypted_content:'opaque-context'};
 const call=load(async(_url,init)=>{const req=JSON.parse(init.body);requests++;assert.equal(req.reasoning.effort,'max');if(requests===1){const fc={type:'function_call',id:'item-search',call_id:'call-search',name:'lookup',arguments:'{"query":"福州"}'};if(!streaming)return new Response(JSON.stringify({output:[raw,fc]}));return stream([{type:'response.output_item.added',output_index:0,item:{type:'reasoning',id:'reason-1',content:[]}},{type:'response.reasoning_text.delta',item_id:'reason-1',output_index:0,content_index:0,delta:'核对原始来源'},{type:'response.output_item.done',output_index:0,item:raw},{type:'response.output_text.delta',delta:'我先核对。'},{type:'response.output_item.added',output_index:1,item:fc},{type:'response.completed',response:{output:[raw,fc]}}]);}
 const reasoning=req.input.find(i=>i.type==='reasoning');assert.deepEqual(reasoning,raw);const fc=req.input.find(i=>i.type==='function_call');assert.equal(fc.id,'item-search');assert.equal(fc.call_id,'call-search');assert.equal(req.input.find(i=>i.type==='function_call_output').call_id,'call-search');return streaming?stream([{type:'response.output_text.delta',delta:'核对完成。'},{type:'response.completed',response:{}}]):new Response(JSON.stringify({output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'核对完成。'}]}]}));});
 const options={tools,thinking_mode:'max',max_tool_rounds:10,tool_executor:async tc=>{executed++;assert.equal(tc.id,'call-search');return{ok:true};}};if(streaming){options.onThinkingChunk=()=>{};options.onContentChunk=x=>body+=x;}const result=await call([{role:'user',content:'核对'}],options);assert.equal(result.content,'核对完成。');assert.equal(requests,2);assert.equal(executed,1);if(streaming)assert.equal(body,'我先核对。\n\n核对完成。');
});
test('reasoning collector restores delta-only content and preserves authoritative completed items',()=>{const c=responsesContext.createReasoningCollector();c.add({type:'reasoning',id:'r',content:[]},0);c.delta({item_id:'r',output_index:0,content_index:0,delta:'第一段'});c.delta({item_id:'r',output_index:0,content_index:0,delta:'第二段'});assert.equal(responsesContext.reasoningText(c.items[0]),'第一段第二段');c.add({type:'reasoning',id:'r',content:[{type:'reasoning_text',text:'完整文本'}],encrypted_content:'opaque'},0);assert.equal(c.items.length,1);assert.equal(responsesContext.reasoningText(c.items[0]),'完整文本');assert.equal(c.items[0].encrypted_content,'opaque');});
test('parallel same-name function argument deltas stay with their output items',async()=>{let requests=0;const args=[];const call=load(async()=>{requests++;if(requests>1)return stream([{type:'response.output_text.delta',delta:'完成'},{type:'response.completed',response:{}}]);return stream([{type:'response.output_item.added',output_index:0,item:{type:'function_call',id:'i1',call_id:'c1',name:'lookup',arguments:''}},{type:'response.output_item.added',output_index:1,item:{type:'function_call',id:'i2',call_id:'c2',name:'lookup',arguments:''}},{type:'response.function_call_arguments.delta',item_id:'i1',output_index:0,delta:'{"query":"甲"}'},{type:'response.function_call_arguments.delta',item_id:'i2',output_index:1,delta:'{"query":"乙"}'},{type:'response.completed',response:{}}]);});await call([{role:'user',content:'两次搜索'}],{tools,thinking_mode:'off',onContentChunk(){},tool_executor:async tc=>{args.push([tc.id,JSON.parse(tc.function.arguments).query]);return{ok:true};}});assert.deepEqual(args,[['c1','甲'],['c2','乙']]);});

test('a parallel tool-only turn replays provider output before all matching receipts without inventing assistant messages',async()=>{
 let requests=0;const raw={type:'reasoning',id:'reason-original',content:[{type:'reasoning_text',text:'先比较两个独立来源'}],encrypted_content:'opaque'};
 const calls=[1,2].map(n=>({type:'function_call',id:'item-'+n,call_id:'call-'+n,name:'lookup',arguments:JSON.stringify({query:'来源'+n})}));
 const call=load(async(_url,init)=>{const body=JSON.parse(init.body);requests++;if(requests===1)return new Response(JSON.stringify({output:[raw,...calls]}));
  assert.deepEqual(body.input.slice(1).map(x=>x.type),['reasoning','function_call','function_call','function_call_output','function_call_output']);
  assert.deepEqual(body.input[1],raw);assert.deepEqual(body.input.slice(2,4),calls);assert.equal(body.reasoning.effort,'max');
  return new Response(JSON.stringify({output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'已对照两个来源。'}]}]}));
 });
 const result=await call([{role:'user',content:'比较来源'}],{tools,thinking_mode:'max',tool_executor:async()=>({ok:true})});assert.equal(result.content,'已对照两个来源。');assert.equal(requests,2);
});

test('three genuine tool rounds retain every reasoning item and original receipt when the final round has no reasoning',async()=>{
 let requests=0;const seen=[];const reasoning=n=>({type:'reasoning',id:'r'+n,content:[{type:'reasoning_text',text:'第'+n+'轮核对。'}]});
 const call=load(async(_url,init)=>{requests++;const body=JSON.parse(init.body);assert.equal(body.reasoning.effort,'high');
  assert.equal(body.input.filter(x=>x.type==='reasoning').length,requests-1);
  if(requests>1)assert.deepEqual(body.input.filter(x=>x.type==='reasoning'),Array.from({length:requests-1},(_,i)=>reasoning(i+1)));
  if(requests<=3)return new Response(JSON.stringify({output:[reasoning(requests),{type:'function_call',id:'i'+requests,call_id:'c'+requests,name:'lookup',arguments:JSON.stringify({query:['原始公告','统计口径','独立来源'][requests-1]})}]}));
  return new Response(JSON.stringify({output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'核对差异后给出结论。'}]}]}));
 });
 const result=await call([{role:'user',content:'核对有分歧的材料'}],{tools,thinking_mode:'high',max_tool_rounds:10,tool_executor:async tc=>{seen.push(JSON.parse(tc.function.arguments).query);return{ok:true};}});
 assert.equal(requests,4);assert.deepEqual(seen,['原始公告','统计口径','独立来源']);assert.equal(result.reasoning,'第1轮核对。第2轮核对。第3轮核对。');
});

test('completed-only output and done-only reasoning are delivered and can continue to a second tool round',async()=>{
 let requests=0,thinking='',visible='';const raw={type:'reasoning',id:'r-complete',content:[{type:'reasoning_text',text:'完成事件里的完整思考。'}]};
 const fc={type:'function_call',id:'i-complete',call_id:'c-complete',name:'lookup',arguments:'{"query":"原文"}'};
 const call=load(async(_url,init)=>{requests++;if(requests===1)return stream([{type:'response.completed',response:{output:[raw,fc]}}]);
  const body=JSON.parse(init.body);assert.deepEqual(body.input[1],raw);return stream([{type:'response.reasoning_text.done',item_id:'r-done',output_index:0,content_index:0,text:'只有完成事件的思考。'},{type:'response.completed',response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'只有完成事件的回答。'}]}]}}]);
 });
 const result=await call([{role:'user',content:'读取'}],{tools,thinking_mode:'low',onThinkingChunk:text=>thinking+=text,onContentChunk:text=>visible+=text});
 assert.equal(requests,2);assert.equal(result.content,'只有完成事件的回答。');assert.equal(visible,'只有完成事件的回答。');assert.equal(thinking,'完成事件里的完整思考。只有完成事件的思考。');assert.equal(result.reasoning,thinking);
});

test('an empty terminal reasoning part cannot erase already received deltas',()=>{
 const c=responsesContext.createReasoningCollector();c.delta({item_id:'r-empty',output_index:0,delta:'必须保留的推理'});
 c.add({type:'reasoning',id:'r-empty',status:'completed',content:[{type:'reasoning_text',text:''}]},0);
 assert.equal(responsesContext.reasoningText(c.items[0]),'必须保留的推理');
});

test('blank assistant output parts do not create an invalid empty message between reasoning and a tool call',()=>{
 const raw={type:'reasoning',id:'r',content:[{type:'reasoning_text',text:'原始推理'}]},call={id:'c',itemId:'i',name:'lookup',arguments:'{}'};
 const input=responsesContext.replayOutput([raw,{type:'message',role:'assistant',content:[{type:'output_text',text:''}]},{type:'function_call',id:'i',call_id:'c'}],[raw],[call],'',true);
 assert.deepEqual(input.map(item=>item.type),['reasoning','function_call']);assert.deepEqual(input[0],raw);
});

test('a protocol 400 after a real tool call never silently disables thinking or executes the tool twice',async()=>{
 let requests=0,executed=0;const call=load(async(_url,init)=>{requests++;const body=JSON.parse(init.body);assert.equal(body.reasoning.effort,'max');
  if(requests===1)return new Response(JSON.stringify({output:[{type:'reasoning',id:'r',content:[{type:'reasoning_text',text:'原始推理'}]},{type:'function_call',id:'i',call_id:'c',name:'lookup',arguments:'{}'}]}));
  return new Response(JSON.stringify({error:{code:'invalid_request_error',message:'The reasoning_text in thinking mode must be passed back to the API.'}}),{status:400});
 });
 await assert.rejects(call([{role:'user',content:'保留推理'}],{tools,thinking_mode:'max',tool_executor:async()=>{executed++;return{ok:true};}}),error=>error.code==='PROVIDER_HTTP_400'&&/reasoning_text/.test(error.providerMessage));
 assert.equal(requests,2);assert.equal(executed,1);
});

test('a missing provider call ID receives one deterministic identity shared by execution and the next request',async()=>{
 let requests=0,executed='';const call=load(async(_url,init)=>{requests++;if(requests===1)return stream([{type:'response.output_item.added',output_index:0,item:{type:'function_call',name:'lookup',arguments:'{}'}},{type:'response.completed',response:{}}]);
  const body=JSON.parse(init.body),fc=body.input.find(x=>x.type==='function_call'),receipt=body.input.find(x=>x.type==='function_call_output');assert.ok(fc.call_id);assert.equal(fc.call_id,executed);assert.equal(receipt.call_id,executed);
  assert.equal(body.input.some(x=>x.type==='message'&&x.role==='assistant'),false);
  return stream([{type:'response.output_text.delta',delta:'完成'},{type:'response.completed',response:{}}]);
 });
 const result=await call([{role:'user',content:'读取'}],{tools,thinking_mode:'off',onContentChunk(){},tool_executor:async tc=>{executed=tc.id;return{ok:true};}});assert.equal(result.content,'完成');assert.equal(requests,2);
});

test('a late call_id replaces the added item ID for receipt matching while the original item ID stays intact',async()=>{
 let requests=0;const call=load(async(_url,init)=>{requests++;if(requests===1)return stream([{type:'response.output_item.added',output_index:0,item:{type:'function_call',id:'output-item',name:'lookup',arguments:''}},{type:'response.output_item.done',output_index:0,item:{type:'function_call',id:'output-item',call_id:'actual-call',name:'lookup',arguments:'{}'}},{type:'response.completed',response:{}}]);
  const body=JSON.parse(init.body),fc=body.input.find(x=>x.type==='function_call');assert.equal(fc.id,'output-item');assert.equal(fc.call_id,'actual-call');assert.equal(body.input.find(x=>x.type==='function_call_output').call_id,'actual-call');return stream([{type:'response.output_text.delta',delta:'完成'},{type:'response.completed',response:{}}]);
 });
 await call([{role:'user',content:'读取'}],{tools,thinking_mode:'off',onContentChunk(){},tool_executor:async tc=>{assert.equal(tc.id,'actual-call');return{ok:true};}});assert.equal(requests,2);
});
