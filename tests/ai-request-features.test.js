'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const features=require('../render-api/ai-request-features');
const file=(text,name='notes.txt')=>({name,data_url:'data:text/plain;base64,'+Buffer.from(text).toString('base64')});
async function scoped(body,action,cache=features.createAttachmentStore()){
  const req=Object.assign(new EventEmitter(),{accountId:'account-a',userName:'alice',body});
  const res=Object.assign(new EventEmitter(),{statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.value=value;this.emit('finish');},getHeader(){return '';}});
  return new Promise((resolve,reject)=>{features.makeMiddleware({store:cache})(req,res,()=>Promise.resolve().then(()=>action(req,res)).then(value=>{res.emit('finish');resolve(value);},reject)).then(()=>{if(res.value)reject(Object.assign(Error(res.value.error),{code:res.value.code,status:res.statusCode}));},reject);});
}
test('attachment references preserve exact bytes and are bound to account, conversation, expiry and capacity',()=>{
  let now=0;const cache=features.createAttachmentStore({now:()=>now,ttl:100,maxBytes:30,ownerBytes:24});
  const first=cache.add('account-a','conversation-a',file('一份原始文件'));
  assert.deepEqual(cache.get('account-a','conversation-a',first.attachment_ref).buffer,Buffer.from('一份原始文件'));
  assert.equal(cache.add('account-a','conversation-a',file('一份原始文件')).attachment_ref,first.attachment_ref);
  for(const [owner,cid]of[['account-b','conversation-a'],['account-a','conversation-b']])assert.throws(()=>cache.get(owner,cid,first.attachment_ref),{code:'attachment_ref_expired'});
  cache.add('account-a','conversation-a',file('第二份原文件'));
  assert.ok(cache.stats().bytes<=24);assert.throws(()=>cache.get('account-a','conversation-a',first.attachment_ref),{code:'attachment_ref_expired'});
  now=101;assert.deepEqual(cache.stats(),{entries:0,bytes:0});
});
test('request preflight restores references once, rejects hidden expansion and never forwards a foreign reference',async()=>{
  const cache=features.createAttachmentStore(),row=cache.add('account-a','conversation-a',file('原始内容'));
  await scoped({conversation_id:'conversation-a',attachments:[row]},async(req)=>{
    assert.equal(req.body.attachments[0].data_url,file('原始内容').data_url);
    assert.equal(features.current().documents.length,1);
  },cache);
  await assert.rejects(scoped({conversation_id:'conversation-a',attachments:Array(11).fill(row)},()=>{},cache),{code:'attachment_request_too_large'});
  await assert.rejects(scoped({conversation_id:'conversation-b',attachments:[row]},()=>{},cache),{code:'attachment_ref_expired'});
  cache.clear('account-a');assert.equal(cache.stats().entries,0);
});
test('local-only mode rejects external tools while local calculation and provided-document tools remain usable',async()=>{
  await scoped({network_mode:'off'},()=>{
    for(const name of ['search_web','read_web_page','get_weather','search_ai_history'])assert.throws(()=>features.guardTool(name),{code:'network_disabled'});
    assert.doesNotThrow(()=>features.guardTool('calculate'));
    assert.doesNotThrow(()=>features.guardTool('read_document_section'));
  });
  assert.doesNotThrow(()=>features.guardTool('search_web'),'outside an AI request the existing site features stay unaffected');
});
test('one request-wide search budget covers nested providers without double counting and has no cross-request state',async()=>{
  await scoped({task_budget:{max_searches:1}},async()=>{
    assert.equal(await features.search(()=>features.search(async()=>42)),42);
    assert.equal(features.current().policy.searches,1);
    assert.throws(()=>features.search(()=>0),{code:'task_search_budget_exceeded'});
  });
  await scoped({task_budget:{max_searches:1}},()=>assert.equal(features.search(()=>7),7));
  assert.throws(()=>features.parseBudget({network_mode:'required',task_budget:{max_searches:0}}),{code:'invalid_task_budget'});
  assert.throws(()=>features.parseBudget({task_budget:{max_duration_seconds:0}}),{code:'invalid_task_budget'});
});
test('document tools locate real text past the initial research preview and continue a long paragraph by offset',async()=>{
  const cache=features.createAttachmentStore(),body='前言\n'+Array.from({length:100},(_,i)=>'常规资料 '+i+' '+'.'.repeat(150)).join('\n')+'\n退款规则：三十天内可申请。\n'+'甲'.repeat(4000)+'后续内容';
  const row=cache.add('account-a','conversation-a',file(body));
  await scoped({conversation_id:'conversation-a',attachments:[row]},async()=>{
    const found=await features.executeDocument('search_document',{query:'退款规则'},()=>{throw Error('text must not use an Office parser');});
    assert.equal(found.results_count,1);assert.equal(found.hits[0].paragraph,102);assert.match(found.hits[0].text,/三十天/);
    const first=await features.executeDocument('read_document_section',{attachment_ref:row.attachment_ref,start_paragraph:103,count:1},()=>{});
    assert.equal(first.hits[0].next_offset,2000);
    const next=await features.executeDocument('read_document_section',{attachment_ref:row.attachment_ref,start_paragraph:103,offset:4000,count:1},()=>{});
    assert.equal(next.hits[0].text,'后续内容');assert.equal(next.hits[0].next_offset,null);
    const denied=await features.executeDocument('read_document_section',{attachment_ref:'a'.repeat(43),start_paragraph:1},()=>{});
    assert.equal(denied.code,'document_not_provided');
  },cache);
});
test('Office parsing is reused for matching authorized bytes, never across unrelated request inputs',async()=>{
  const cache=features.createAttachmentStore(),row=cache.add('account-a','conversation-a',file('office bytes','report.docx'));
  let calls=0;const parser=async()=>{calls++;return {text:'第一段\n第二段',numpages:1};};
  await scoped({conversation_id:'conversation-a',attachments:[row]},async()=>{
    await Promise.all([features.parseCached(Buffer.from('office bytes'),'docx',parser),features.parseCached(Buffer.from('office bytes'),'docx',parser)]);
    await features.executeDocument('search_document',{query:'第二段'},parser);
    assert.equal(calls,1);
    await features.parseCached(Buffer.from('other bytes'),'docx',parser);assert.equal(calls,2);
  },cache);
});
test('time budget emits a distinct terminal event, cancels upstream work and releases the existing transport once',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const events=[],req=Object.assign(new EventEmitter(),{accountId:'account-a',userName:'alice',body:{task_budget:{max_duration_seconds:30}}});let aborted=0;
  req.on('aborted',()=>aborted++);
  const res=Object.assign(new EventEmitter(),{headersSent:true,writableEnded:false,getHeader:()=> 'text/event-stream',end(){this.writableEnded=true;this.emit('finish');}});
  await features.makeMiddleware({writeSse:(_res,event)=>events.push(event)})(req,res,()=>{});
  t.mock.timers.tick(30000);assert.equal(aborted,1);assert.equal(events.length,1);assert.equal(events[0].code,'task_budget_exceeded');assert.ok(req.aiRequestScope.controller.signal.aborted);assert.equal(res.writableEnded,true);
  t.mock.timers.tick(60000);assert.equal(aborted,1);
});
test('aggregate reference bytes are checked before any Base64 expansion and root vision references restore exactly',async()=>{
  const row={ref:'a'.repeat(43),owner:'account-a',cid:'conversation-a',bytes:54*1024*1024,buffer:{toString(){throw Error('must not expand');}}};
  await assert.rejects(scoped({conversation_id:'conversation-a',attachments:[{attachment_ref:row.ref},{data_url:'data:text/plain;base64,YQ=='}]},()=>{}, {get:()=>row}),{code:'attachment_request_too_large'});
  const cache=features.createAttachmentStore(),saved=cache.add('account-a','conversation-a',file('image bytes','photo.png'));
  await scoped({conversation_id:'conversation-a',vision_urls:['xtj-attachment:'+saved.attachment_ref]},req=>assert.equal(req.body.vision_urls[0],file('image bytes','photo.png').data_url),cache);
});

test('ordinary-chat Chinese PDF tool produces a real downloadable PDF containing the actual requested text',async()=>{
  const result=await require('./helpers/ai-tool-executor').execute('generate_pdf',{filename:'核对报告',title:'真实中文报告',blocks:[{type:'p',text:'应退款三百元；不能把文件生成冒充成功。'},{type:'table',headers:['项目','金额'],rows:[['退款','300 元']]}]});
  assert.equal(result.error,undefined);const file=result.cards[0].data;assert.equal(file.format,'pdf');assert.equal(file.is_html_delivery,false);assert.match(file.data_url,/^data:application\/pdf;base64,/);
  const buffer=Buffer.from(file.data_url.split(',')[1],'base64');assert.equal(buffer.subarray(0,5).toString(),'%PDF-');const parsed=await require('../render-api/file-parsers').parsePdfBuffer(buffer);assert.match(parsed.text,/应退款三百元/);assert.match(parsed.text,/300 元/);
});
