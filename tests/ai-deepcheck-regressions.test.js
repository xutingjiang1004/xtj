'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const context=require('../render-api/ai-context-window');
const {probeCapabilities}=require('../render-api/ai-model-capabilities');
const fixed=[{role:'system',content:'规则'},{role:'user',content:'继续'}];
function history(n){return Array.from({length:n},(_,i)=>({role:i%2?'assistant':'user',context_id:'turn-'+i,content:(i===0?'必须保留原图，不要实现回复版本，预算200元。\n':'')+'研究资料。'.repeat(500)}));}
test('successive context compactions retain earlier user constraints and fit the actual work budget',()=>{
 const first=context.prepareContext({history:history(100),fixed,conversationId:'CURRENT1'});
 const next=context.prepareContext({history:history(200),fixed,conversationId:'CURRENT1',memory:JSON.parse(JSON.stringify(first.memory))});
 assert.equal(first.budget.compaction_status,'compressed');assert.equal(next.budget.compaction_status,'compressed');
 for(const requirement of ['必须保留原图','不要实现回复版本','预算200元'])assert.ok(next.messages[0].content.includes(requirement));
 assert.ok(next.budget.estimated_tokens+next.budget.reserved_output_tokens<=next.budget.window_tokens);
});
test('tight context budgets keep a nonempty summary before excluding the original covered turns',()=>{
 const rows=Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',context_id:'tight-'+i,content:'旧要求必须保留真实来源。'+'字'.repeat(1000)}));
 const result=context.prepareContext({history:rows,fixed:[{role:'system',content:'规则'},{role:'user',content:'字'.repeat(18000)}],conversationId:'CURRENT1',windowTokens:32768});
 assert.ok(result.budget.history_compressed>0);assert.ok(result.memory.summary.trim());assert.match(result.messages[0].content,/真实来源/);
 assert.ok(result.budget.estimated_tokens+result.budget.reserved_output_tokens<=32768);
});
test('empty saved memory cannot hide the original history on the server',()=>{
 const original={role:'user',context_id:'original',content:'必须保留的真实原文'};
 const result=context.prepareContext({history:[original],fixed,conversationId:'CURRENT1',memory:{v:1,conversation_id:'CURRENT1',summary:'',covered_ids:[context.messageKey(original)],covered_count:1,revision:1}});
 assert.equal(result.memory,null);assert.equal(result.messages[0].content,original.content);
});
function voiceFixture({recognition,mediaDevices,MediaRecorder}={}){
 const states=[],notifications=[],speeches=[],global=new EventTarget();
 Object.assign(global,{document:new EventTarget(),navigator:{mediaDevices},SpeechRecognition:recognition,MediaRecorder,SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},speechSynthesis:{cancel(){},getVoices:()=>[],speak:s=>speeches.push(s)}});
 vm.runInNewContext(fs.readFileSync('js/ai-core/voice-conversation.js','utf8'),{window:global,AbortController,Blob,setTimeout,clearTimeout});
 const controller=global.XtjAiCore.VoiceConversation.create({owner:()=>({user:'alice'}),current:()=>true,draft:()=>'',onState:s=>states.push(s),notify:s=>notifications.push(s),onTranscript(){},onSend(){},onInterrupt(){}});
 return{controller,states,notifications,speeches,global};
}
test('stopping native recognition before permission settles cancels safely',()=>{
 let rec;const f=voiceFixture({recognition:class{constructor(){rec=this;}start(){}stop(){throw new DOMException('not started','InvalidStateError');}abort(){this.aborted=true;}}});
 try{f.controller.listen();assert.doesNotThrow(()=>f.controller.listen());assert.equal(rec.aborted,true);assert.equal(f.states.at(-1).listening,false);}finally{f.controller.dispose();}
});
test('a second microphone click cancels pending local permission without requesting another stream',async()=>{
 const pending=[];let captures=0,stops=0;
 const f=voiceFixture({mediaDevices:{getUserMedia:()=>new Promise(resolve=>pending.push(resolve))},MediaRecorder:class{static isTypeSupported(){return false;}constructor(){captures++;}}});
 f.global.XTJVoiceTranscription={transcribeBlob:async()=>''};
 try{f.controller.listen();f.controller.listen();assert.equal(pending.length,1);pending[0]({getTracks:()=>[{stop(){stops++;}}]});await new Promise(setImmediate);assert.equal(stops,1);assert.equal(captures,0);assert.equal(f.states.at(-1).listening,false);}finally{f.controller.dispose();}
});
test('queued speech can be stopped before the browser actually starts speaking',()=>{
 const f=voiceFixture();try{f.controller.speak('真实回复。',false);assert.equal(f.states.at(-1).stage,'speech_wait');assert.equal(f.states.at(-1).speaking,false);assert.equal(f.controller.isSpeaking(),true);f.controller.stopSpeech();assert.equal(f.controller.isSpeaking(),false);}finally{f.controller.dispose();}
});
test('a stale recorder stop callback cannot release the microphone of a new recording',async()=>{
 const streams=[],captures=[];const f=voiceFixture({mediaDevices:{getUserMedia:async()=>{const track={stops:0,stop(){this.stops++;}},stream={track,getTracks:()=>[track]};streams.push(stream);return stream;}},MediaRecorder:class{static isTypeSupported(){return false;}constructor(){captures.push(this);this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';}}});
 f.global.XTJVoiceTranscription={transcribeBlob:async()=>''};
 try{f.controller.listen();await new Promise(setImmediate);const oldStop=captures[0].onstop;f.controller.cancelInput();f.controller.listen();await new Promise(setImmediate);await oldStop();assert.equal(streams[0].track.stops,1);assert.equal(streams[1].track.stops,0);assert.equal(f.states.at(-1).listening,true);}finally{f.controller.dispose();}
});
const probeConfig={provider:'custom',model:'fixture',api_key:'isolated-only-key',base_url:'https://fixture.test/v1'};
function probes(reply){return{safeUrl:async()=>({parsed:new URL(probeConfig.base_url),addresses:['93.184.216.34']}),transport:async(_url,_addresses,options)=>reply(JSON.parse(options.body))};}
test('model capability usage falls back to returned itemized tokens when a total is missing',async()=>{
 const result=await probeCapabilities(probeConfig,probes(payload=>({status:200,text:payload.stream?'data: '+JSON.stringify({choices:[{delta:{content:'OK'}}]})+'\n\ndata: '+JSON.stringify({usage:{prompt_tokens:2,completion_tokens:1}})+'\n\ndata: [DONE]\n':JSON.stringify({choices:[{message:{content:'OK'}}],usage:{prompt_tokens:2,completion_tokens:1}})})));
 assert.deepEqual(result.usage,{prompt_tokens:10,completion_tokens:5,total_tokens:15});
});
test('cumulative usage snapshots within one streaming capability request are counted once',async()=>{
 const result=await probeCapabilities(probeConfig,probes(payload=>({status:200,text:payload.stream?'data: '+JSON.stringify({choices:[{delta:{content:'OK'}}],usage:{prompt_tokens:2,completion_tokens:0,total_tokens:2}})+'\n\ndata: '+JSON.stringify({usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}})+'\n\ndata: [DONE]\n':JSON.stringify({choices:[{message:{content:'OK'}}],usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}})})));
 assert.deepEqual(result.usage,{prompt_tokens:10,completion_tokens:5,total_tokens:15});
});
test('the capability HTTP deadline ends the response and still records incurred usage',async()=>{
 const source=fs.readFileSync('render-api/ai-model-capabilities.js','utf8'),a=source.indexOf('function installModelCapabilities('),b=source.indexOf('\nmodule.exports',a);let handler,deadline,recorded;
 const install=vm.runInNewContext('('+source.slice(a,b).trim()+')',{ENDPOINTS:{},AbortController,setTimeout:fn=>{deadline=fn;return 1;},clearTimeout(){},probeCapabilities:async(_config,{signal})=>{await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return{results:[],usage:{total_tokens:3}};}});
 install({post(_path,...handlers){handler=handlers.at(-1);}},{authenticateUser(){},rateLimit:()=>()=>{},gate:async()=>({allowed:true}),record:async(_owner,usage)=>{recorded=usage;}});
 const req=new EventEmitter();req.body=probeConfig;req.userName='alice';const res=new EventEmitter();Object.assign(res,{headersSent:false,writableEnded:false,destroyed:false,status(value){this.statusCode=value;return this;},json(value){this.body=value;this.headersSent=true;this.writableEnded=true;return this;}});
 const running=handler(req,res);await new Promise(setImmediate);deadline();await running;
 assert.equal(res.statusCode,504);assert.equal(res.writableEnded,true);assert.equal(res.body.ok,false);assert.equal(recorded.total_tokens,3);
});
test('empty saved memory does not suppress original turns in the frontend context estimate',()=>{
 const global={};vm.runInNewContext(fs.readFileSync('js/ai-core/assistant-features.js','utf8'),{window:global});
 const result=global.XtjAiCore.AssistantFeatures.estimate([{role:'user',context_id:'original',content:'这是真实原文'}],'',false,{managed:true,windowTokens:65536,memory:{v:1,conversation_id:'CURRENT1',summary:'',covered_ids:['["user","original"]'],covered_count:1}});
 assert.equal(result.history_retained,1);assert.equal(result.history_compressed,0);
});
test('speech skips tilde and wider nested code fences while retaining surrounding prose',()=>{
 const f=voiceFixture();try{for(const code of ["~~~js\nconst raw = \"不应被朗读的代码\";\n~~~","\x60\x60\x60\x60markdown\n\x60\x60\x60js\nconst raw = \"不应被朗读的代码\";\n\x60\x60\x60\n\x60\x60\x60\x60"]){const text=f.global.XtjAiCore.VoiceConversation.speechText('说明段落。\n'+code+'\n结论段落。');assert.match(text,/说明段落/);assert.match(text,/结论段落/);assert.match(text,/代码片段/);assert.doesNotMatch(text,/const raw|不应被朗读/);}}finally{f.controller.dispose();}
});
test('audit repair: speech preserves multiplication, comparisons and literal symbols while removing actual Markdown',()=>{
 const f=voiceFixture();try{
  const text=f.global.XtjAiCore.VoiceConversation.speechText('## 数学核对\n**算式** 2*3*4=24，5>4，3<4，5>=4，3<=4，5!=4。\n> 引用里的 _结论_ 与 `C#`。\n- [真实来源](https://example.com)');
  assert.match(text,/2\s*乘以\s*3\s*乘以\s*4=24/);assert.match(text,/5\s*大于\s*4/);assert.match(text,/3\s*小于\s*4/);assert.match(text,/5\s*大于等于\s*4/);assert.match(text,/3\s*小于等于\s*4/);assert.match(text,/5\s*不等于\s*4/);assert.match(text,/C#/);assert.match(text,/引用里的 结论/);assert.doesNotMatch(text,/\*\*|##|https:\/\/|_结论_/);
 }finally{f.controller.dispose();}
});
test('editing input leaves queued and active speech callbacks attached to their own lifecycle',()=>{
 const f=voiceFixture();try{f.controller.speak('真实回复。',false);f.controller.cancelInput();assert.equal(f.states.at(-1).stage,'speech_wait');assert.equal(f.controller.isSpeaking(),true);f.speeches[0].onstart();assert.equal(f.states.at(-1).speaking,true);f.controller.cancelInput();assert.equal(f.states.at(-1).stage,'speaking');f.speeches[0].onend();assert.equal(f.controller.isSpeaking(),false);assert.equal(f.states.at(-1).stage,'idle');}finally{f.controller.dispose();}
});
