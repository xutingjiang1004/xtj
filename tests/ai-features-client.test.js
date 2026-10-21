'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function client(fetch,identity=()=> 'alice:1'){
  const window={XtjAiCore:{},location:{href:'https://xtj.test/'},crypto:require('node:crypto').webcrypto};
  vm.runInNewContext(fs.readFileSync('js/ai-core/assistant-features.js','utf8'),{window,URL,URLSearchParams,DOMException,AbortController,TextEncoder,TextDecoder,Blob,setTimeout,clearTimeout,console});
  return window.XtjAiCore.AssistantFeatures.createRequestClient({fetch,identity});
}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const attachment={name:'原文.txt',data_url:'data:text/plain;base64,'+Buffer.from('保留真实文件').toString('base64')};
const init=()=>({method:'POST',headers:{Authorization:'Bearer isolated-fake-user'},body:JSON.stringify({conversation_id:'conversation-a',message:'分析资料',attachments:[attachment]})});
test('AI transport uploads an attachment once, reuses authorized refs and never mutates the original input',async()=>{
  const calls=[],c=client(async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return url.endsWith('/attachments')?json({ok:true,attachment_ref:'a'.repeat(43),expires_at:Date.now()+60000}):json({ok:true});});
  const original=init();await c.fetch('https://xtj.test/api/agent/chat/stream',original);await c.fetch('https://xtj.test/api/agent/chat/stream',original);
  assert.equal(calls.filter(c=>c.url.endsWith('/attachments')).length,1);
  assert.equal(JSON.parse(original.body).attachments[0].data_url,attachment.data_url);
  for(const call of calls.filter(c=>c.url.endsWith('/chat/stream'))){assert.equal(call.body.attachments[0].attachment_ref,'a'.repeat(43));assert.equal(call.body.attachments[0].data_url,undefined);assert.equal(call.body.conversation_id,'conversation-a');}
});
test('only an explicit pre-generation expired-ref error permits one reupload; quota/network failures never repeat generation',async()=>{
  let uploads=0,requests=0;const c=client(async(url)=>url.endsWith('/attachments')?(uploads++,json({ok:true,attachment_ref:String.fromCharCode(96+uploads).repeat(43),expires_at:Date.now()+60000})):(requests++,requests===1?json({ok:false,code:'attachment_ref_expired'},410):json({ok:true})));
  assert.equal((await c.fetch('https://xtj.test/api/agent/custom-chat/stream',init())).status,200);assert.equal(uploads,2);assert.equal(requests,2);
  const denied=client(async url=>url.endsWith('/attachments')?json({ok:true,attachment_ref:'x'.repeat(43),expires_at:Date.now()+60000}):json({code:'quota'},429));assert.equal((await denied.fetch('https://xtj.test/api/agent/chat/stream',init())).status,429);
});
test('switching accounts during attachment preparation prevents private generation with the new account',async()=>{
  let owner='alice:1',release,calls=0;const c=client(async(url)=>{calls++;await new Promise(r=>release=r);return json({ok:true,attachment_ref:'a'.repeat(43),expires_at:Date.now()+60000});},()=>owner);
  const pending=c.fetch('https://xtj.test/api/agent/research/stream',init());await Promise.resolve();owner='bob:2';release();await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
});
test('older APIs keep the exact attachment transport and unrelated site requests are untouched',async()=>{
  const calls=[],c=client(async(url,options)=>{calls.push({url,options});return url.endsWith('/attachments')?json({ok:false},404):json({ok:true});});
  const original=init();await c.fetch('https://xtj.test/api/agent/chat/stream',original);assert.equal(calls.at(-1).options.body,original.body);
  await c.fetch('https://xtj.test/api/posts',original);assert.equal(calls.at(-1).options,original);
});
