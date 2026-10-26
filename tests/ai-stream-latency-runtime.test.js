'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('render-api/server.js','utf8');
function client(fetch,chat=false){
 const marker=chat?'async function callDeepSeek(messages, options)':'async function callDeepSeekViaResponses(';
 const start=source.indexOf(marker),end=chat?source.indexOf('// ===================== M:',start):source.indexOf('\nasync function ',start+10);
 const scope={fetch,AbortController,DOMException,TextDecoder,Response,setTimeout,clearTimeout,process,
  deepSeekPricing:require('../render-api/deepseek-pricing'),aiTaskPolicy:require('../render-api/ai-task-policy'),responsesContext:require('../render-api/responses-context'),
  console:{log(){},warn(){},error(){}},DEEPSEEK_API_KEY:'isolated-key',DEEPSEEK_RESPONSES_URL:'https://isolated.invalid/responses',DEEPSEEK_API_URL:'https://isolated.invalid/chat/completions',
  DEEPSEEK_RESPONSES_MODEL:'deepseek-flash',DEEPSEEK_MODEL_REASONER:'deepseek-flash',DEEPSEEK_TIMEOUT_MS:5000,DEEPSEEK_INPUT_PRICE_PER_1M:1,DEEPSEEK_OUTPUT_PRICE_PER_1M:2,DEEPSEEK_CACHE_HIT_PRICE_PER_1M:.02,DEEPSEEK_CURRENCY:'CNY',
  DEBUG_PROVIDER:false,DEBUG_PROVIDER_ALWAYS:false,getPreferredDeepSeekModel:value=>value,normalizeDeepSeekUsageModel:(value,fallback)=>value||fallback,
  executeToolCall:async()=>({ok:true}),finalReplyContainsInternalProtocolGlobal:()=>false,looksLikeToolArgsFragment:()=>false,responsesUsageToInternal:()=>({prompt_tokens:1,completion_tokens:1,total_tokens:2})};
 vm.createContext(scope);vm.runInContext(source.slice(start,end)+'\nglobalThis.call='+ (chat?'callDeepSeek':'callDeepSeekViaResponses')+';',scope);return scope.call;
}
function pipe(){
 let controller,closed=false,cancelled=0;
 const response=new Response(new ReadableStream({start(value){controller=value;},cancel(){closed=true;cancelled++;}}),{headers:{'Content-Type':'text/event-stream'}});
 return {response,send(event,compact=false,split=false){const bytes=new TextEncoder().encode('data:'+(compact?'':' ')+JSON.stringify(event)+'\r\n\r\n');if(split)for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));else controller.enqueue(bytes);},
  close(){if(!closed){closed=true;controller.close();}},get cancelled(){return cancelled;}};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const options=extra=>({thinking_mode:'low',onContentChunk(){},onThinkingChunk(){},...extra});
const messages=[{role:'user',content:'隔离协议检查'}];

for(const model of ['deepseek-flash','deepseek-v4-pro'])test(model+': a completed semantic event resolves without waiting for TCP EOF',async()=>{
 const channel=pipe();let settled=false;
 const call=client(async()=>channel.response),pending=call(messages,options({model}));pending.then(()=>{settled=true;},()=>{settled=true;});
 channel.send({type:'response.output_text.delta',delta:'实际回答'});channel.send({type:'response.completed',response:{output:[]}});
 try{await turn();assert.equal(settled,true,'the provider completed, but the client still waits for the connection to close');assert.equal((await pending).content,'实际回答');assert.equal(channel.cancelled,1);}
 finally{channel.close();await pending.catch(()=>{});}
});

test('a reasoning done snapshot publishes its unseen suffix before the later answer or terminal event',async()=>{
 const channel=pipe();let thought='';
 const pending=client(async()=>channel.response)(messages,options({onThinkingChunk:chunk=>thought+=chunk}));
 channel.send({type:'response.output_item.added',output_index:0,item:{type:'reasoning',id:'r1',content:[]}});
 channel.send({type:'response.reasoning_text.delta',item_id:'r1',output_index:0,content_index:0,delta:'先'});
 channel.send({type:'response.reasoning_text.done',item_id:'r1',output_index:0,content_index:0,text:'先核对原文。'});
 try{await turn();assert.equal(thought,'先核对原文。','known reasoning text must not wait until the entire answer finishes');}
 finally{channel.send({type:'response.completed',response:{output:[]}});channel.close();await pending;}
});

test('semantic completion starts the next genuine tool round while the previous HTTP connection stays open',async()=>{
 const first=pipe();let requests=0,executed=0;
 const call=client(async()=>{requests++;return requests===1?first.response:new Response('data: '+JSON.stringify({type:'response.completed',response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'核对完成'}]}]}})+'\n\n');});
 const pending=call(messages,options({tools:[{type:'function',function:{name:'lookup',parameters:{type:'object'}}}],tool_executor:async()=>{executed++;return{ok:true};}}));
 first.send({type:'response.completed',response:{output:[{type:'reasoning',id:'r1',content:[{type:'reasoning_text',text:'先读取原文'}]},{type:'function_call',id:'i1',call_id:'c1',name:'lookup',arguments:'{}'}]}});
 try{await turn();assert.equal(executed,1);assert.equal(requests,2);assert.equal((await pending).content,'核对完成');}
 finally{first.close();await pending.catch(()=>{});}
});

test('standard SSE with no space after data and split UTF-8 keeps the complete Chinese answer',async()=>{
 const channel=pipe(),chunks=[];
 const pending=client(async()=>channel.response)(messages,options({onContentChunk:chunk=>chunks.push(chunk)}));
 channel.send({type:'response.output_text.delta',delta:'中文🐈完整显示。'},true,true);channel.send({type:'response.completed',response:{output:[]}},true,true);channel.close();
 const result=await pending;assert.equal(result.content,'中文🐈完整显示。');assert.equal(chunks.join(''),result.content);
});

test('a failed provider stream releases its reader and preserves its structured failure',async()=>{
 const channel=pipe(),pending=client(async()=>channel.response)(messages,options());
 channel.send({type:'response.failed',response:{error:{code:'isolated_failure',message:'isolated failure'}}});
 try{await assert.rejects(pending,{code:'PROVIDER_STREAM_FAILED'});assert.equal(channel.cancelled,1);}
 finally{channel.close();}
});

test('an incomplete response never executes truncated tools or claims normal completion',async()=>{
 let executed=0,requests=0;const chunks=[];
 const call=client(async()=>{requests++;return new Response('data: '+JSON.stringify(requests===1?{type:'response.incomplete',response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'确实生成的部分回答'}]},{type:'function_call',id:'unfinished',call_id:'unfinished',name:'lookup',arguments:'{"query":'}],incomplete_details:{reason:'max_output_tokens'},usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}:{type:'response.completed',response:{output:[]}})+'\n\n');});
 await assert.rejects(call(messages,options({onContentChunk:chunk=>chunks.push(chunk),tool_executor:async()=>{executed++;return{ok:true};}})),{code:'PROVIDER_STREAM_INCOMPLETE'});
 assert.equal(executed,0);assert.equal(requests,1);assert.equal(chunks.join(''),'确实生成的部分回答');
});

test('an early EOF retains actual text but reports the missing terminal event',async()=>{
 const chunks=[];
 await assert.rejects(client(async()=>new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'已收到的部分正文'})+'\n\n'))(messages,options({onContentChunk:chunk=>chunks.push(chunk)})),{code:'PROVIDER_STREAM_INCOMPLETE'});
 assert.equal(chunks.join(''),'已收到的部分正文');
});

test('Chat Completions forwards an entire large reasoning delta instead of silently dropping its tail',async()=>{
 const thought='真实思考🐈。'.repeat(1000),chunks=[];
 const call=client(async()=>new Response('data: '+JSON.stringify({choices:[{delta:{reasoning_content:thought}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{content:'实际正文'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'),true);
 const result=await call(messages,options({model:'deepseek-v4-pro',onThinkingChunk:chunk=>chunks.push(chunk)}));
 assert.equal(chunks.join('').length,thought.length);assert.equal(result.reasoning.length,thought.length);
});

test('tool-capable Chat Completions publishes genuine reasoning before its round completes',async()=>{
 const channel=pipe();let thought='';
 const pending=client(async()=>channel.response,true)(messages,options({tools:[{type:'function',function:{name:'lookup',parameters:{type:'object'}}}],onThinkingChunk:chunk=>thought+=chunk}));
 channel.send({choices:[{delta:{reasoning_content:'先核对原文，再决定下一步。'}}]});
 try{await turn();assert.equal(thought,'先核对原文，再决定下一步。','tools must not defer the entire genuine thinking stream');}
 finally{channel.send({choices:[{delta:{content:'核对完成'},finish_reason:'stop'}]});channel.close();await pending;}
});

test('a DSML marker split at every character is held without hiding safe reasoning or leaking protocol',async()=>{
 const channel=pipe();let thought='';
 const pending=client(async()=>channel.response,true)(messages,options({tools:[{type:'function',function:{name:'lookup',parameters:{type:'object'}}}],onThinkingChunk:chunk=>thought+=chunk}));
 channel.send({choices:[{delta:{reasoning_content:'已确认用户问题。'}}]});await turn();
 try{
  assert.equal(thought,'已确认用户问题。');
  for(const char of '<| | DSML | | calls>hidden tool payload'){
   channel.send({choices:[{delta:{reasoning_content:char}}]});await turn();assert.equal(thought,'已确认用户问题。');
  }
 }finally{channel.send({choices:[{delta:{content:'安全正文'},finish_reason:'stop'}]});channel.close();await pending;}
});

for(const kind of ['Thinking','Answer'])test('research '+kind.toLowerCase()+' buffer forwards its complete payload within bounded transport packets',()=>{
 const start=source.indexOf('  function _flush'+kind+'Chunk()'),end=source.indexOf('\n  }',start)+4;
 assert.ok(start>=0&&end>start);const events=[],text='真实原文🐈。'.repeat(2400),field=kind==='Thinking'?'_thinkingChunkBuf':'_answerChunkBuf';
 const context={clearTimeout(){},_agentGuard:()=>false,sseSend:event=>events.push(event),[field]:text,[kind==='Thinking'?'_thinkingChunkTimer':'_answerChunkTimer']:null};
 vm.runInNewContext(source.slice(start,end)+'\n_flush'+kind+'Chunk();',context);
 assert.equal(events.map(event=>event.chunk.length).reduce((a,b)=>a+b,0),text.length,'buffer flush discarded received text');
 assert.equal(events.map(event=>event.chunk).join(''),text);
 assert.ok(events.every(event=>event.chunk.length<= (kind==='Thinking'?4000:8000)));
 assert.equal(context[field],'');
});

test('a terminal-only snapshot publishes actual reasoning before its answer',async()=>{
 const seen=[];
 const call=client(async()=>new Response('data: '+JSON.stringify({type:'response.completed',response:{output:[{type:'reasoning',id:'r1',content:[{type:'reasoning_text',text:'先核对原文。'}]},{type:'message',role:'assistant',content:[{type:'output_text',text:'原文确认后的结论。'}]}]}})+'\n\n'));
 await call(messages,options({onThinkingChunk:chunk=>seen.push(['thinking',chunk]),onContentChunk:chunk=>seen.push(['answer',chunk])}));
 assert.deepEqual(seen,[['thinking','先核对原文。'],['answer','原文确认后的结论。']]);
});
