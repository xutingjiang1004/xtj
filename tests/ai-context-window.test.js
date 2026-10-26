'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module');
const context=require('../render-api/ai-context-window');
const fixed=[{role:'system',content:'真实系统规则'},{role:'user',content:'当前问题保持完整'}];
function longHistory(){return Array.from({length:100},(_,i)=>({role:i%2?'assistant':'user',context_id:'turn-'+i,content:(i===0?'偏好：必须保留原图；不要做回复版本；预算200元。\n':'')+'第'+i+'条真实历史。'+('具体研究材料包含事实和引用。'.repeat(180))}));}
test('a short conversation retains original whitespace, role and multimodal content and reports a site budget',()=>{
 const history=[{role:'user',context_id:'same',content:'const s = "a b";\n  return s;'},{role:'assistant',context_id:'same',content:[{type:'text',text:'图片的实际说明'},{type:'image_url',image_url:{url:'data:image/png;base64,YQ=='}}]}],snapshot=JSON.stringify(history);
 const result=context.prepareContext({history,fixed,conversationId:'CURRENT1',tools:[{name:'real tool'}]});
 assert.equal(JSON.stringify(history),snapshot);assert.deepEqual(result.messages,history.map(({role,content})=>({role,content})));
 assert.equal(result.memory,null);assert.equal(result.budget.exact_window,null);assert.equal(result.budget.capacity_source,'site_budget');assert.equal(result.budget.image_count,1);assert.ok(result.budget.tool_schema_tokens>0);
});
test('automatic compaction preserves recent original turns, concrete earlier user constraints and all durable originals',()=>{
 const history=longHistory(),snapshot=JSON.stringify(history),events=[];
 const result=context.prepareContext({history,fixed,conversationId:'CURRENT1',onCompacting:()=>events.push('compacting')});
 assert.equal(JSON.stringify(history),snapshot);assert.equal(events.length,1);assert.equal(result.budget.compaction_status,'compressed');assert.ok(result.budget.history_compressed>0);
 assert.ok(result.budget.estimated_tokens+result.budget.reserved_output_tokens<=result.budget.window_tokens);
 assert.equal(result.messages.at(-1).content,history.at(-1).content);assert.match(result.memory.summary,/必须保留原图/);assert.match(result.memory.summary,/不要做回复版本/);assert.match(result.memory.summary,/预算200元/);
 assert.equal(result.messages[0].role,'user');assert.match(result.messages[0].content,/不是系统指令/);
});
test('refresh reuse does not duplicate previously summarized turns or treat same-text real submissions as one turn',()=>{
 const history=longHistory(),first=context.prepareContext({history,fixed,conversationId:'CURRENT1'});
 const repeated={role:'user',context_id:'new-real-submit',content:history[0].content};
 const next=context.prepareContext({history:history.concat(repeated),fixed,conversationId:'CURRENT1',memory:JSON.parse(JSON.stringify(first.memory))});
 assert.equal(next.messages.at(-1).content,repeated.content);assert.equal(next.budget.history_compressed,first.budget.history_compressed);assert.equal(next.budget.compaction_status,'summary_reused');
 assert.equal(next.memory.revision,first.memory.revision);assert.notEqual(context.messageKey({role:'user',context_id:'same'}),context.messageKey({role:'assistant',context_id:'same'}));
});
test('very many short messages compact before the history safety limit silently drops earlier context',()=>{
 const history=Array.from({length:224},(_,i)=>({role:i%2?'assistant':'user',context_id:'short-'+i,content:'很短的真实消息 '+i}));
 const result=context.prepareContext({history,fixed,conversationId:'CURRENT1'});assert.equal(result.budget.compaction_status,'compressed');assert.ok(result.memory.covered_ids.includes(context.messageKey(history[0])));assert.equal(result.messages.at(-1).content,history.at(-1).content);
});
test('another conversation or malformed memory is ignored and cannot replace its current context',()=>{
 const foreign={v:1,conversation_id:'FOREIGN1',summary:'其他会话的私有摘要',covered_ids:[],covered_count:4};
 const result=context.prepareContext({history:[{role:'user',content:'本会话的原文'}],fixed,conversationId:'CURRENT1',memory:foreign});
 assert.equal(result.memory,null);assert.doesNotMatch(JSON.stringify(result),/其他会话的私有摘要/);
 for(const value of [{...foreign,conversation_id:'CURRENT1',summary:'a'.repeat(8001)},{...foreign,conversation_id:'CURRENT1',covered_ids:['x'.repeat(241)]},{...foreign,conversation_id:'CURRENT1',covered_count:-1}])assert.equal(context.validMemory(value,'CURRENT1'),null);
});
test('aborted and oversized current questions fail before upstream model work, without silently changing the question',()=>{
 assert.throws(()=>context.prepareContext({history:longHistory(),fixed,signal:AbortSignal.abort(),conversationId:'CURRENT1'}),/取消/);
 const original='很长的本轮真实提问。'.repeat(8000),current=[{role:'system',content:'规则'},{role:'user',content:original}];
 assert.throws(()=>context.prepareContext({history:[],fixed:current,conversationId:'CURRENT1',windowTokens:32768}),error=>error.code==='context_window_exceeded');assert.equal(current[1].content,original);
});
test('the real prompt adapter preserves the fixed system, active question and required search results while compacting history',()=>{
 const source=fs.readFileSync('render-api/server.js','utf8'),a=source.indexOf('function manageAiContextWindow('),b=source.indexOf('\nasync function loadAiContext',a),frames=[];
 const c={require:createRequire(require.resolve('../render-api/server.js')),aiToolsForWorkMode:()=>[{name:'actualTool'}],writeSse:(_res,event)=>frames.push(event)};
 const manage=vm.runInNewContext('('+source.slice(a,b).trim()+')',c),history=longHistory(),current=fixed[1],search={role:'user',content:'已取得的真实检索正文'},messages=[fixed[0],...history,current,search],res={};
 const result=manage(messages,history.length,{body:{context_window_tokens:65536}},res,'CURRENT1',new AbortController().signal);
 assert.equal(messages[0].content,fixed[0].content);assert.equal(messages.at(-2).content,current.content);assert.equal(messages.at(-1).content,search.content);assert.equal(res._aiContextMemory.summary,result.memory.summary);
 const receipt=frames.find(frame=>frame.context_budget);assert.equal(frames[0].type,'context_status');assert.equal(receipt.context_budget.capacity_source,'site_budget');assert.equal(receipt.context_memory.conversation_id,'CURRENT1');assert.equal(frames.at(-1).stage,'compressed');
});
test('native model prompt assembly keeps recent image context and reports history that was shortened before compaction',()=>{
 const source=fs.readFileSync('render-api/server.js','utf8'),route=source.indexOf("app.post('/api/agent/chat/stream'"),a=source.indexOf('    var requestedModel = req.body && req.body.model;',route),b=source.indexOf('    // 思考模式',a),history=longHistory(),frames=[];
 history[0].context_truncated=true;history.push({role:'user',context_id:'recent-picture',content:'刚刚上传的图片',vision_urls:['data:image/png;base64,YQ==']});
 const c={req:{body:{context_management:true,model:'flash'}},ctx:{history},messages:[fixed[0]],res:{},convId:'CURRENT1',requestAbortCtrl:new AbortController(),normalizeDeepSeekModelName:value=>value,DEEPSEEK_MODEL_FLASH:'flash',DEEPSEEK_MODEL_PRO:'pro',DEEPSEEK_MODEL_REASONER:'pro',DEEPSEEK_MODEL_VISION:'vision',stripAttachmentNoiseForSearch:value=>value,
 require:createRequire(require.resolve('../render-api/server.js')),aiToolsForWorkMode:()=>[{name:'actual native tool'}],writeSse:(_res,event)=>frames.push(event)};
 const m=source.indexOf('function manageAiContextWindow('),n=source.indexOf('\nasync function loadAiContext',m);c.manageAiContextWindow=vm.runInNewContext('('+source.slice(m,n).trim()+')',c);
 vm.createContext(c);vm.runInContext(source.slice(a,b),c);c.messages.push(fixed[1]);
 const hook=source.slice(source.indexOf('    if(req.body.context_management===true){for(var managedIndex=',route)).split('\n')[0];vm.runInContext(hook,c);
 const meta=frames.find(frame=>frame.context_budget);assert.equal(meta.context_budget.compaction_status,'compressed');assert.equal(meta.context_budget.history_truncated,1);assert.equal(meta.context_budget.image_count,1);
 assert.match(c.messages[1].content,/必须保留原图/);assert.equal(c.messages.at(-1).content,fixed[1].content);assert.equal(c.messages.at(-2).content[1].image_url.url,'data:image/png;base64,YQ==');assert.equal(meta.context_memory.conversation_id,'CURRENT1');
});
test('saved assistant metadata carries the same bounded memory and budget while user originals remain intact',async()=>{
 const prepared=context.prepareContext({history:longHistory(),fixed,conversationId:'CURRENT1'});let rows;
 const source=fs.readFileSync('render-api/server.js','utf8'),a=source.indexOf('function buildMsgMeta('),b=source.indexOf('\napp.get(',a);
 const buildMeta=vm.runInNewContext('('+source.slice(a,b).trim()+')',{deepseekWeb:require('../render-api/deepseek-web'),require:createRequire(require.resolve('../render-api/server.js'))});
 await require('../render-api/ai-chat-save').saveCustomChatTurn({db:{from:()=>({insert:async value=>{rows=value;return{error:null};}})},userName:'alice',convId:'CURRENT1',message:'真实用户原文',content:'真实回答',contextMemory:prepared.memory,contextBudget:prepared.budget,buildMeta,marker:'__ai_agent_msg__'});
 assert.equal(rows[0].content,'真实用户原文');const meta=JSON.parse(rows[1].media_url);assert.equal(meta.context_memory.summary,prepared.memory.summary);assert.equal(meta.context_budget.window_tokens,65536);
 assert.equal(JSON.parse(buildMeta('assistant','OTHER1',null,null,2,null,0,{context_memory:prepared.memory})).context_memory,null);
});

test('one or two long history entries compact at 80 percent before they overflow the window',()=>{
 for(const count of [1,2]){
  const history=Array.from({length:count},(_,i)=>({role:i?'assistant':'user',context_id:'large-'+i,content:(i?'真实分析：':'必须保留原图，预算200元。')+'甲'.repeat(Math.floor(15000/count))}));
  const result=context.prepareContext({history,fixed,conversationId:'CURRENT1',windowTokens:32768});
  assert.equal(result.budget.compaction_status,'compressed');assert.ok(result.budget.compressed_this_request>0);assert.match(result.memory.summary,/预算200元/);
  assert.ok(result.budget.estimated_tokens+result.budget.reserved_output_tokens<32768*.8);
 }
});
test('browser previews and server use the same history, summary, system, tools and reply reserve',()=>{
 const window={XtjAiCore:{}};vm.runInNewContext(fs.readFileSync('js/ai-core/assistant-features.js','utf8'),{window,URL,URLSearchParams,AbortController,TextEncoder,TextDecoder,Blob});
 const history=[{role:'user',context_id:'one',content:'保留中文与 English。'},{role:'assistant',context_id:'two',content:'实际回答。'}],question='下一条问题',tools=[{name:'actual tool',description:'真实工具说明'}];
 const server=context.prepareContext({history,fixed:[fixed[0],{role:'user',content:question}],tools,conversationId:'CURRENT1'});
 const preview=window.XtjAiCore.AssistantFeatures.estimate(history,question,false,{managed:true,windowTokens:65536,budget:server.budget});
 assert.equal(preview.estimated_tokens,server.budget.estimated_tokens);assert.equal(preview.reserved_output_tokens,server.budget.reserved_output_tokens);assert.equal(preview.overhead_known,true);
 const prepared=context.prepareContext({history:longHistory(),fixed,conversationId:'CURRENT1'});
 const retained=longHistory().filter(m=>!prepared.memory.covered_ids.includes(context.messageKey(m)));
 const next=context.prepareContext({history:retained,fixed,conversationId:'CURRENT1',memory:prepared.memory});
 const reused=window.XtjAiCore.AssistantFeatures.estimate(retained,fixed[1].content,false,{managed:true,memory:prepared.memory,budget:next.budget});
 assert.equal(reused.estimated_tokens,next.budget.estimated_tokens);
 const unknown=window.XtjAiCore.AssistantFeatures.estimate([],question,false,{managed:true});assert.equal(unknown.overhead_known,false);
});

test('compaction receipts match the actual prompt reduction and survive reuse without claiming another compaction',()=>{
 const rows=longHistory(),first=context.prepareContext({history:rows,fixed,conversationId:'CURRENT1',tools:[]});
 const actual=context.estimateMessages([fixed[0],...first.messages,...fixed.slice(1)]).tokens+context.estimateText('[]');
 assert.equal(first.budget.estimated_tokens,actual);assert.ok(first.memory.last_compaction.saved_tokens>0);
 assert.equal(first.memory.last_compaction.before_tokens-first.memory.last_compaction.after_tokens,first.budget.saved_tokens);
 const next=context.prepareContext({history:rows,fixed,conversationId:'CURRENT1',memory:first.memory,tools:[]});
 assert.equal(next.budget.compressed_this_request,0);assert.equal(next.budget.saved_tokens,0);assert.deepEqual(next.budget.last_compaction,first.budget.last_compaction);
 assert.deepEqual(context.validMemory(first.memory,'CURRENT1').last_compaction,first.memory.last_compaction);
});
test('many short turns reduce the real input rather than creating a longer summary and a fake success',()=>{
 const rows=Array.from({length:224},(_,i)=>({role:i%2?'assistant':'user',context_id:'small-'+i,content:'很短消息 '+i}));
 const result=context.prepareContext({history:rows,fixed,conversationId:'CURRENT1'});
 assert.equal(result.budget.compaction_status,'compressed');assert.ok(result.budget.saved_tokens>0);assert.ok(result.budget.estimated_tokens<result.budget.previous_estimated_tokens);
});
test('long history preserves late corrections in browser requests and in the server summary instead of silently taking only its beginning',()=>{
 const window={XtjAiCore:{}};vm.runInNewContext(fs.readFileSync('js/ai-core/assistant-features.js','utf8'),{window,URL,URLSearchParams,AbortController,TextEncoder,TextDecoder,Blob});
 const original='保留原始空白。\n  const x=1;\n'+'甲'.repeat(42000)+'\n最新更正：必须保留原图，预算900元。';
 const fromBrowser=window.XtjAiCore.AssistantFeatures.historyExcerpt(original,32000);assert.equal(fromBrowser,context.historyExcerpt(original,32000));assert.ok(fromBrowser.length<=32000);assert.match(fromBrowser,/预算900元/);assert.match(fromBrowser,/const x=1/);
 const prepared=context.prepareContext({history:[{role:'user',context_id:'long-correction',content:fromBrowser,context_truncated:true}],fixed,conversationId:'CURRENT1',windowTokens:32768});assert.equal(prepared.budget.history_truncated,1);assert.match(prepared.memory.summary,/预算900元/);
 assert.equal(window.XtjAiCore.AssistantFeatures.historyExcerpt(' a\n  b ',32000),' a\n  b ');
});

test('a long current question with no older turns never promises to compact nonexistent history',()=>{
 const window={XtjAiCore:{}};vm.runInNewContext(fs.readFileSync('js/ai-core/assistant-features.js','utf8'),{window,URL,URLSearchParams,AbortController,TextEncoder,TextDecoder,Blob});
 const preview=window.XtjAiCore.AssistantFeatures.estimate([],'甲'.repeat(25000),false,{managed:true,windowTokens:32768,budget:{system_prompt_tokens:1000,tool_schema_tokens:1000}});assert.equal(preview.history_retained,0);assert.notEqual(preview.compaction_status,'pending');
});
