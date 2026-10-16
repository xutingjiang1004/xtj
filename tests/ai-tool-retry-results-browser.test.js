'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),fs=require('node:fs'),path=require('node:path');
const {aiPolishFixture}=require('./helpers/ai-polish-fixture'),{execute}=require('./helpers/ai-tool-executor');
const retry=require('../render-api/ai-tool-retry'),{appendProcessEvent,getProcessEvents}=require('../render-api/ai-process-events'),{toolFeedback}=require('../render-api/ai-tool-feedback');
async function fixture(t,options={}) {
 const app=express(),owner={userName:'alice',accountId:'isolated-account'},requests=[],historyWaiters=[];
 let record=null,saveFailures=options.saveFailures||0,holdSave=false,releaseSave=null,holdHistory=false,saveAborted=false,delayedReply=null;
 app.use((req,res,next)=>{res.set('Access-Control-Allow-Origin','*');res.set('Access-Control-Allow-Headers','content-type,authorization');if(req.method==='OPTIONS')return res.sendStatus(204);if(req.path==='/r')req.url='/api/agent/tools/retry';next();});app.use(express.json());
 app.get('/h',async(_req,res)=>{const value={ok:true,conversation_id:'POLISH01',messages:record?[{role:'user',id:'user-1',content:'请绘图',created_at:record.created_at},JSON.parse(JSON.stringify(record))]:[],has_more:false};if(holdHistory)await new Promise(resolve=>historyWaiters.push(resolve));res.json(value);});
 retry.installToolRetry(app,{authenticateUser(req,res,next){req.userName=owner.userName;req.accountId=owner.accountId;next();},rateLimit:()=>((req,res,next)=>next()),gate:async()=>({allowed:true}),execute:async call=>{requests.push(call);const result=await execute(call.function.name,JSON.parse(call.function.arguments));if(options.reverseSiblingReplies)result.cards=result.cards.map(card=>({...card,id:card.id+'-'+call.id}));return result;},feedback:toolFeedback,normalize:()=>null,
  store:{
   async inspect(_owner,_turn,callId){const step=record.process_events.flatMap(group=>group.tools||[]).find(step=>step.call_id===callId);return {completed:step.status==='done',step,record};},
   async save(_owner,turn,callId,feedback,cards,signal){
    assert.equal(turn.requestId,record.client_request_id);signal.addEventListener('abort',()=>saveAborted=true,{once:true});if(holdSave)await new Promise(resolve=>releaseSave=resolve);if(signal.aborted)throw new DOMException('cancelled','AbortError');if(saveFailures-->0)throw Error('isolated save failure');
    const stamp=new Date().toISOString();
    record={...record,site_cards:[...record.site_cards.filter(card=>card.tool_call_id!==callId),...cards],tool_retry_updated_at:stamp,tool_retry_revision:(record.tool_retry_revision||0)+1,process_events:record.process_events.map(group=>({...group,tools:group.tools.map(step=>step.call_id===callId?{...feedback,status:'done',retry_completed_at:stamp}:step)}))};
    const saved={completed:true,record:JSON.parse(JSON.stringify(record))};
    if(options.reverseSiblingReplies&&record.tool_retry_revision===1)await new Promise(resolve=>delayedReply=resolve);
    return saved;
   }
  }});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 const f=await aiPolishFixture(options),p=f.page;
 t.after(async()=>{holdHistory=false;historyWaiters.forEach(resolve=>resolve());if(releaseSave)releaseSave();if(delayedReply)delayedReply();await f.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 await p.route(origin+'/**',r=>r.continue());
 await p.evaluate(origin=>{const previous=fetch;window.fetch=async(url,opts={})=>{const name=new URL(url,location.href).pathname;if(name==='/api/agent/tools/retry')return previous(origin+'/r',{method:'POST',headers:{'Content-Type':'application/json'},body:opts.body,signal:opts.signal});if(name==='/api/agent/chat/history')return previous(origin+'/h',{signal:opts.signal});return previous(url,opts);};},origin);
 async function startFailure(type='tool_result',callCount=1) {
  await p.locator('#aiChatMsgInput').fill('请绘图');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);const requestId=await p.evaluate(()=>aiPolish.streams[0].body.client_request_id);
  const res={_aiRetryOwner:owner,_aiClientRequestId:requestId},args={type:'bar',title:'恢复并保存的图表',labels:['甲','乙'],series:[{name:'金额',data:[12,25]}]};retry.observe(res,{type:'meta',conversation_id:'POLISH01'});
  const call={type:'tool_calls',tools:Array.from({length:callCount},(_,index)=>({id:'chart-'+(index+1),name:'make_chart',args:{...args,title:args.title+(callCount>1?' '+(index+1):'')}}))};retry.observe(res,call);appendProcessEvent(res,call);
  const failures=call.tools.map(tool=>({type,call_id:tool.id,tool_name:'make_chart',success:false,error:'隔离的首次制图失败'}));for(const failure of failures){retry.observe(res,failure);appendProcessEvent(res,failure);}
  const done={type:'done',conversation_id:'POLISH01',saved:true,complete:true,content:'第一次工具失败，可重试这一步。'};retry.observe(res,done);
  record={role:'assistant',id:'123e4567-e89b-42d3-a456-000000000001',conversation_id:'POLISH01',client_request_id:requestId,content:done.content,created_at:new Date().toISOString(),process_events:getProcessEvents(res),site_cards:[]};
  for(const event of [call,...failures,{type:'content',text:done.content},done])await p.evaluate(e=>aiPolishEmit(e),event);
  await p.getByText(done.content,{exact:true}).waitFor();await p.getByRole('button',{name:'重试这一步',exact:true}).first().waitFor();
 }
 async function reopen(){
  // Cache rendering can precede the native history response. Inspect the final
  // DOM, except in the case that deliberately holds that response for a race.
  const loaded=holdHistory?null:p.waitForResponse(response=>response.url()===origin+'/h');
  await p.evaluate(()=>{__xtjCloseAiChat();__xtjOpenAiChat();});
  if(loaded)await (await loaded).finished();
  await p.getByText(record.content,{exact:true}).waitFor();
  if(!holdHistory)await p.waitForFunction(()=>{const area=document.querySelector('#aiChatMessagesArea');return area&&area.getAttribute('aria-busy')!=='true';});
  const process=p.getByRole('button',{name:'思考过程',exact:true}).last();if(await process.count()&&await process.getAttribute('aria-expanded')==='false')await process.click();
 }
 async function screenshot(name){if(!process.env.XTJ_RETRY_ARTIFACTS)return;fs.mkdirSync(process.env.XTJ_RETRY_ARTIFACTS,{recursive:true});await p.screenshot({path:path.join(process.env.XTJ_RETRY_ARTIFACTS,name+'.png')});}
 async function assertSaved(){await p.locator('[data-ai-card-id="test-make_chart"]').waitFor();assert.equal(await p.locator('.ai-tool-step.is-error').count(),0);assert.match(await p.locator('.ai-tool-step-status').last().textContent(),/重试已保存/);const message=await p.locator('.ai-msg.assistant').last().evaluate(n=>n._msgRef);assert.equal(message.site_cards.length,1);assert.ok(message.tool_retry_updated_at);assert.equal(record.site_cards.length,1);assert.deepEqual(f.errors,[]);}
 return {p,f,requests,startFailure,reopen,screenshot,assertSaved,get record(){return record;},set holdSave(value){holdSave=value;},releaseSave(){if(releaseSave)releaseSave();},async waitForSave(){for(let n=0;n<100&&!releaseSave;n++)await new Promise(r=>setTimeout(r,10));assert.ok(releaseSave);},async waitForSaveAbort(){for(let n=0;n<200&&!saveAborted;n++)await new Promise(r=>setTimeout(r,10));assert.ok(saveAborted);},async waitForDelayedReply(){for(let n=0;n<200&&!delayedReply;n++)await new Promise(r=>setTimeout(r,10));assert.ok(delayedReply);},releaseDelayedReply(){delayedReply();},set holdHistory(value){holdHistory=value;},releaseHistory(){holdHistory=false;historyWaiters.forEach(resolve=>resolve());},async waitForHistory(){for(let n=0;n<100&&!historyWaiters.length;n++)await new Promise(r=>setTimeout(r,10));assert.ok(historyWaiters.length);}};
}
test('actual retry route restores a real chart, corrects the step and preserves it on history reopen',{timeout:60000},async t=>{
 const f=await fixture(t,{viewport:{width:1440,height:900}});await f.startFailure();await f.p.locator('#aiChatMsgInput').fill('保留下一条草稿');await f.p.getByRole('button',{name:'重试这一步',exact:true}).click();await f.assertSaved();assert.equal(f.requests.length,1);assert.equal(await f.p.locator('#aiChatMsgInput').inputValue(),'保留下一条草稿');await f.screenshot('01-desktop-retry-saved');await f.reopen();await f.assertSaved();await f.screenshot('02-desktop-retry-reopened');
});
test('a failed save keeps recovery available and never reruns a successful tool on the next attempt',{timeout:60000},async t=>{
 const f=await fixture(t,{viewport:{width:390,height:844},theme:'dark',saveFailures:1});await f.startFailure('tool_error');await f.p.getByRole('button',{name:'重试这一步',exact:true}).click();await f.p.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='重试这一步'&&!b.disabled));assert.equal(await f.p.locator('[data-ai-card-id="test-make_chart"]').count(),0);await f.p.getByRole('button',{name:'重试这一步',exact:true}).click();await f.assertSaved();assert.equal(f.requests.length,1);await f.screenshot('03-dark-phone-retry-after-save-recovery');await f.reopen();await f.assertSaved();
});
test('a history read captured before save cannot overwrite the acknowledged result',{timeout:60000},async t=>{
 const f=await fixture(t);await f.startFailure();const before=await f.p.locator('.ai-msg.assistant').last().evaluate(n=>n._msgRef.process_events);assert.ok(before.some(group=>group.tools&&group.tools.some(step=>step.retry_token)));f.holdHistory=true;await f.reopen();await f.waitForHistory();await f.p.getByRole('button',{name:'重试这一步',exact:true}).click();await f.assertSaved();f.releaseHistory();await f.p.waitForFunction(()=>document.querySelector('#aiChatMessagesArea')?.getAttribute('aria-busy')!=='true');await f.assertSaved();assert.equal(f.requests.length,1);
});
test('closing chat cancels the old save; reopening can save its cached result without another tool execution',{timeout:60000},async t=>{
 const f=await fixture(t);await f.startFailure();f.holdSave=true;await f.p.getByRole('button',{name:'重试这一步',exact:true}).click();await f.waitForSave();await f.p.evaluate(()=>__xtjCloseAiChat());await f.waitForSaveAbort();f.releaseSave();f.holdSave=false;await f.reopen();assert.equal(await f.p.locator('[data-ai-card-id="test-make_chart"]').count(),0);await f.p.getByRole('button',{name:'重试这一步',exact:true}).click();await f.assertSaved();assert.equal(f.requests.length,1);
});
test('reversed sibling retry replies preserve the latest saved revision and both real chart cards',{timeout:60000},async t=>{
 const f=await fixture(t,{viewport:{width:390,height:844},theme:'dark',reverseSiblingReplies:true});await f.startFailure('tool_result',2);
 await f.p.locator('#aiChatMsgInput').fill('保留下一条草稿');
 await f.p.getByRole('button',{name:'重试这一步',exact:true}).first().click();await f.waitForDelayedReply();
 await f.p.getByRole('button',{name:'重试这一步',exact:true}).click();await f.p.waitForFunction(()=>document.querySelector('.ai-msg.assistant')._msgRef.tool_retry_revision===2);
 f.releaseDelayedReply();await f.p.waitForFunction(()=>document.querySelectorAll('.ai-tool-step.is-done').length===2);
 const message=await f.p.locator('.ai-msg.assistant').last().evaluate(node=>node._msgRef);
 assert.equal(message.tool_retry_revision,2);assert.equal(message.site_cards.length,2);assert.equal(message.process_events.flatMap(group=>group.tools||[]).filter(step=>step.status==='done').length,2);
 assert.equal(await f.p.locator('.ai-tool-card[data-tool-call-id]').count(),2);assert.equal(f.requests.length,2);assert.equal(await f.p.locator('#aiChatMsgInput').inputValue(),'保留下一条草稿');assert.deepEqual(f.f.errors,[]);
 await f.screenshot('04-reversed-sibling-retry-replies');await f.reopen();assert.equal(await f.p.locator('.ai-tool-card[data-tool-call-id]').count(),2);
});
