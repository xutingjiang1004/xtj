'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {aiPolishFixture}=require('./helpers/ai-polish-fixture');
const ARTIFACTS=process.env.XTJ_AI_ENHANCEMENT_ARTIFACTS||(fs.existsSync('/workspace/scratch')?'/workspace/scratch/xtj-ai-enhancement-ui':path.join(os.tmpdir(),'xtj-ai-enhancement-ui'));
fs.mkdirSync(ARTIFACTS,{recursive:true});
async function fixture(t,options={}) {
  const f=await aiPolishFixture(options);t.after(()=>f.close());
  await f.page.evaluate(()=>{
    const previous=fetch;
    window.enhancementCalls=[];
    window.fetch=async(url,opts={})=>{
      const path=new URL(url,location.href).pathname,body=typeof opts.body==='string'?JSON.parse(opts.body):null;
      const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
      if(path==='/api/agent/workbench/tool'){
        enhancementCalls.push({path,method:opts.method||'GET',body});
        return json({ok:true,result:{tool_name:body.name,content:body.args.expression+' = 4',cards:[{type:'calculate',data:{expression:body.args.expression,result:4}}]}});
      }
      if(path==='/api/agent/research/export'){
        enhancementCalls.push({path,method:opts.method||'GET',body});
        const file=body.format==='pdf'?window.enhancementPdf:window.enhancementMarkdown;
        return json({ok:true,file});
      }
      const response=await previous(url,opts),stream=aiPolish.streams.at(-1);
      if(stream && stream.signal===opts.signal && stream.path===path && opts.signal&&!stream.enhancementAbortBound){
        stream.enhancementAbortBound=true;
        opts.signal.addEventListener('abort',()=>{try{stream.controller.error(new DOMException('Isolated transport aborted','AbortError'));}catch(_){}},{once:true});
      }
      return response;
    };
    window.enhancementEmit=(index,event)=>aiPolish.streams[index].controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n'));
  });
  return f;
}
async function emit(page,index,event){await page.evaluate(({index,event})=>enhancementEmit(index,event),{index,event});}
async function send(page,text,index=0){await page.locator('#aiChatMsgInput').fill(text);await page.locator('#aiChatSendBtn').click();await page.waitForFunction(index=>aiPolish.streams.length>index,index);}
async function finish(page,index,content,extra={}){await emit(page,index,{type:'content',text:content});await emit(page,index,{type:'done',content,conversation_id:'POLISH01',complete:true,saved:true,...extra});}
async function openMenu(page,label){await page.locator('.ai-plus-btn').click();await page.getByRole('button',{name:label,exact:true}).click();}
async function scrollUpToRead(page,messages){
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await messages.hover({position:{x:100,y:160}});await page.mouse.wheel(0,-1200);
  await page.waitForFunction(()=>{const node=document.querySelector('#aiChatMessagesArea');return node.scrollHeight-node.clientHeight-node.scrollTop>400;});
  const first=await messages.evaluate(node=>node.scrollTop);await page.mouse.wheel(0,-400);await page.waitForFunction(first=>document.querySelector('#aiChatMessagesArea').scrollTop<first-200,first);
  return messages.evaluate(node=>new Promise(resolve=>{let previous=node.scrollTop,stable=0,frames=0;function next(){const value=node.scrollTop;stable=Math.abs(value-previous)<.1?stable+1:0;previous=value;if(stable>=6||++frames>180)resolve(value);else requestAnimationFrame(next);}requestAnimationFrame(next);}));
}
async function assertPromptGeometry(prompt){
  const geometry=await prompt.evaluate(node=>({height:node.getBoundingClientRect().height,width:node.getBoundingClientRect().width,position:getComputedStyle(node).position,bottom:node.getBoundingClientRect().bottom,composerTop:document.querySelector('.ai-chat-input-bar').getBoundingClientRect().top}));
  assert.ok(geometry.height<=64&&geometry.width<=240,JSON.stringify(geometry));assert.equal(geometry.position,'absolute');assert.ok(geometry.bottom<=geometry.composerTop-4,'new-content prompt obscures composer: '+JSON.stringify(geometry));
}
async function rightClickSettledBubble(page,bubble){
  const point=await bubble.evaluate(node=>new Promise((resolve,reject)=>{
    const scroller=node.closest('.ai-chat-messages');let previous=null,stable=0,frame=0,finished=false,lastScroll=performance.now();
    const timer=setTimeout(()=>done(Error('historical bubble did not reach a stable visible layout')),5000);
    function onScroll(){lastScroll=performance.now();stable=0;}
    function done(error,value){if(finished)return;finished=true;clearTimeout(timer);cancelAnimationFrame(frame);window.removeEventListener('scroll',onScroll,true);error?reject(error):resolve(value);}
    window.addEventListener('scroll',onScroll,{capture:true,passive:true});
    function sample(){
      if(!node.isConnected||!scroller)return done(Error('historical bubble was removed'));
      const rect=node.getBoundingClientRect(),view=scroller.getBoundingClientRect(),values=[rect.x,rect.y,rect.width,rect.height,scroller.scrollTop,scroller.scrollHeight,view.height];
      const unchanged=previous&&values.every((value,index)=>Math.abs(value-previous[index])<.1);previous=values;
      stable=unchanged&&performance.now()-lastScroll>=150?stable+1:0;
      const x=Math.max(rect.left+10,Math.min(rect.left+30,view.right-12)),y=Math.max(rect.top+10,view.top+12);
      const target=document.elementFromPoint(x,y);
      if(stable>=8&&rect.height>100&&node.textContent.length>100&&y<Math.min(rect.bottom,view.bottom)-8&&(target===node||node.contains(target)))return done(null,{x,y});
      frame=requestAnimationFrame(sample);
    }
    frame=requestAnimationFrame(sample);
  }));
  await page.mouse.click(point.x,point.y,{button:'right'});
}
async function capture(page,name,scope){
  const filename=path.join(ARTIFACTS,name+'.png');await page.mouse.move(0,0);await page.waitForTimeout(350);await page.screenshot({path:filename});
  const localAxe='/workspace/scratch/xtj-audit/node_modules/axe-core/axe.min.js';let axe=null;
  if(fs.existsSync(localAxe)){if(!await page.evaluate(()=>typeof window.axe!=='undefined'))await page.addScriptTag({path:localAxe});axe=await page.evaluate(async scope=>(await window.axe.run(scope,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),scope);}
  const evidence={screenshot:filename,scope,axe};fs.writeFileSync(path.join(ARTIFACTS,name+'.json'),JSON.stringify(evidence,null,2));return evidence;
}
test('three followups send one selected question while retaining the next draft and its original attachment',{timeout:60000},async t=>{
  const f=await fixture(t),p=f.page;await send(p,'如何比较这两种方案？');
  await finish(p,0,'这两种方案的主要差异如下。',{followups:['可以列一个对照表吗？','有哪些限制？','我应该怎样选择？']});await p.locator('.ai-followup').nth(2).waitFor();assert.equal(await p.locator('.ai-followup').count(),3);
  await p.locator('#aiChatMsgInput').fill('下一条真实草稿');await p.locator('#aiChatFileInp').setInputFiles({name:'草稿资料.txt',mimeType:'text/plain',buffer:Buffer.from('留给下一轮的完整资料')});await p.locator('#aiChatFilePreview .ai-file-info').waitFor();
  const before=await p.evaluate(()=>aiPolish.streams.length);await p.locator('.ai-followup').filter({hasText:'可以列一个对照表吗？'}).click();await p.waitForFunction(before=>aiPolish.streams.length===before+1,before);
  const request=await p.evaluate(()=>aiPolish.streams.at(-1).body);assert.equal(request.message,'可以列一个对照表吗？');assert.ok(!request.attachments||request.attachments.length===0);assert.equal(await p.locator('#aiChatMsgInput').inputValue(),'下一条真实草稿');assert.match(await p.locator('#aiChatFilePreview').textContent(),/草稿资料.txt/);
  await finish(p,1,'下面给出对照表。',{followups:['还需要补充哪些条件？','能结合预算选择吗？','怎样验证这个结论？']});await p.waitForFunction(()=>document.querySelectorAll('.ai-followup').length===6);
  const evidence=await capture(p,'phone-followups-draft','#aiChatRoot');assert.deepEqual(evidence.axe||[],[]);assert.deepEqual(f.errors,[]);
});
test('actual menu opens tool workbench, authenticates calculation, and preserves the normal composer',{timeout:60000},async t=>{
  const f=await fixture(t,{viewport:{width:1440,height:960}}),p=f.page;await p.locator('#aiChatMsgInput').fill('工具执行期间保留的草稿');await openMenu(p,'工具工作台');await p.getByRole('dialog',{name:'小猫工具工作台',exact:true}).waitFor();await p.getByRole('tab',{name:'计算',exact:true}).click();await p.getByLabel('数学表达式',{exact:true}).fill('2+2');await p.getByLabel('输入数值与来源说明',{exact:true}).fill('两个已确认数值：2和2');await p.getByLabel('结果单位',{exact:true}).fill('份');await p.getByRole('button',{name:'计算并保留过程',exact:true}).click();await p.getByText('2+2 = 4 份',{exact:true}).waitFor();
  const calls=await p.evaluate(()=>enhancementCalls);assert.equal(calls.length,1);assert.equal(calls[0].body.name,'calculate');assert.equal(calls[0].body.args.expression,'2+2');assert.equal(await p.evaluate(()=>aiPolish.streams.length),0);
  const evidence=await capture(p,'desktop-workbench-calculation','.aw-overlay');assert.deepEqual(evidence.axe||[],[]);await p.getByRole('button',{name:'关闭',exact:true}).click();assert.equal(await p.locator('#aiChatMsgInput').inputValue(),'工具执行期间保留的草稿');assert.deepEqual(f.errors,[]);
});
test('two-model comparison runs sequentially and shows distinct real output without altering the ordinary draft',{timeout:60000},async t=>{
  const f=await fixture(t,{theme:'dark',viewport:{width:390,height:844}}),p=f.page;await p.locator('#aiChatMsgInput').fill('保留的普通聊天草稿');await openMenu(p,'双模型对比');await p.getByRole('dialog',{name:'双模型对比',exact:true}).waitFor();await p.getByLabel('用于对比的问题',{exact:true}).fill('这两个模型如何解释同一问题？');await p.getByRole('button',{name:'开始对比',exact:true}).click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  await emit(p,0,{type:'content',text:'第一模型的真实模拟输出。'});await p.locator('.ai-compare-answer').first().getByText('第一模型的真实模拟输出。',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>aiPolish.streams.length),1);assert.match(await p.locator('.ai-compare-status').nth(1).textContent(),/等待前一/);
  await emit(p,0,{type:'done',content:'第一模型的真实模拟输出。',complete:true,usage:{total_tokens:12}});await p.waitForFunction(()=>aiPolish.streams.length===2);assert.equal(await p.evaluate(()=>aiPolish.streams[1].body.model),'deepseek-v4-pro');await emit(p,1,{type:'content',text:'第二模型的独立模拟输出。'});await emit(p,1,{type:'done',content:'第二模型的独立模拟输出。',complete:true,usage:{total_tokens:18}});await p.waitForFunction(()=>document.querySelectorAll('.ai-compare-status')[1].textContent.includes('已完成'));
  const evidence=await capture(p,'dark-phone-two-models','.ai-compare-modal');assert.deepEqual(evidence.axe||[],[]);await p.getByRole('button',{name:'关闭',exact:true}).click();assert.equal(await p.locator('#aiChatMsgInput').inputValue(),'保留的普通聊天草稿');assert.deepEqual(f.errors,[]);
});
test('comparison pause and close abort the owned streams and never begin the waiting second model',{timeout:60000},async t=>{
  const f=await fixture(t),p=f.page;await p.locator('#aiChatMsgInput').fill('暂停前后保留的草稿');await openMenu(p,'双模型对比');await p.getByRole('button',{name:'开始对比',exact:true}).click();await p.waitForFunction(()=>aiPolish.streams.length===1);await p.getByRole('button',{name:'暂停',exact:true}).click();await p.waitForFunction(()=>aiPolish.streams[0].signal.aborted);await p.getByRole('button',{name:'开始对比',exact:true}).waitFor({state:'visible'});await p.waitForFunction(()=>!document.querySelector('.ai-compare-controls button').disabled);assert.equal(await p.evaluate(()=>aiPolish.streams.length),1);
  await p.getByRole('button',{name:'开始对比',exact:true}).click();await p.waitForFunction(()=>aiPolish.streams.length===2);await p.getByRole('button',{name:'关闭',exact:true}).click();await p.waitForFunction(()=>aiPolish.streams[1].signal.aborted);assert.equal(await p.evaluate(()=>aiPolish.streams.length),2);assert.equal(await p.locator('#aiChatMsgInput').inputValue(),'暂停前后保留的草稿');assert.deepEqual(f.errors,[]);
});
test('two original TXT files use file-only research, real board states, heading directory, and PDF/Markdown export without another model call',{timeout:60000},async t=>{
  const f=await fixture(t,{viewport:{width:1440,height:960}}),p=f.page;
  const answer='# 对照研究\n\n## 一、真实预算差异\n\n第一份资料预算10万元，第二份资料预算12万元。\n\n### 原文核对\n\n结论引用[F1:P1]与[F2:P1]。\n\n## 二、下一步\n\n请核对预算口径。';
  const pdf=await require('../render-api/ai-report-export').buildReportPdf({title:'两份预算资料对照',answer}),md=Buffer.from(answer);
  await p.evaluate(({pdf,md})=>{window.enhancementPdf={filename:'真实研究报告.pdf',mime_type:'application/pdf',data_url:'data:application/pdf;base64,'+pdf};window.enhancementMarkdown={filename:'真实研究报告.md',mime_type:'text/markdown',data_url:'data:text/markdown;base64,'+md};},{pdf:pdf.toString('base64'),md:md.toString('base64')});
  await p.locator('#aiDeepThinkToggle').click();await p.locator('#dtInput').waitFor();await p.locator('#dtFileInp').setInputFiles([{name:'预算一.txt',mimeType:'text/plain',buffer:Buffer.from('预算10万元；2026-10-14形成。')},{name:'预算二.txt',mimeType:'text/plain',buffer:Buffer.from('预算12万元；2026-10-15形成。')}]);await p.locator('#dtFilePreview .ai-file-chip').nth(1).waitFor();await p.locator('#dtInput').fill('请对照两份预算资料的差异');await p.locator('#dtSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  const request=await p.evaluate(()=>aiPolish.streams[0]);assert.equal(request.path,'/api/agent/research/stream');assert.equal(request.body.web_search,false);assert.equal(request.body.attachments.length,2);assert.equal(Buffer.from(request.body.attachments[0].data_url.split(',')[1],'base64').toString(),'预算10万元；2026-10-14形成。');assert.equal(Buffer.from(request.body.attachments[1].data_url.split(',')[1],'base64').toString(),'预算12万元；2026-10-15形成。');
  const documents=[{id:'F1',name:'预算一.txt',status:'read',used_paragraphs:1},{id:'F2',name:'预算二.txt',status:'read',used_paragraphs:1}],board={type:'research_board',stage:'workers',directions:[{id:'worker-0',role:'预算核对',status:'success'},{id:'worker-1',role:'日期口径',status:'running'}],completed:1,total:2,search_calls:0,unique_sources:0,raw_sources:0,merged_sources:0,documents,usage:{actual_tokens:120,estimated_tokens:16,returned_requests:1,missing_requests:1},save:{checkpoint:'saved',report:'pending'}};
  await emit(p,0,board);await p.getByText('研究看板 · 已完成 1 / 2 个方向',{exact:true}).waitFor();assert.match(await p.locator('.ai-research-board').textContent(),/120 tokens/);assert.match(await p.locator('.ai-research-board').textContent(),/研究断点 已保存 · 报告 待保存/);const progressEvidence=await capture(p,'desktop-research-board','#panelDeepThink');assert.deepEqual(progressEvidence.axe||[],[]);
  const completed={...board,stage:'complete',directions:board.directions.map(d=>({...d,status:'success'})),completed:2,usage:{actual_tokens:240,estimated_tokens:16,returned_requests:2,missing_requests:0},save:{checkpoint:'complete',report:'saved'}};await emit(p,0,{type:'research_content',text:answer});await emit(p,0,{type:'research_done',answer,conversation_id:'POLISH01',message_id:'research-test-turn',saved:true,board:completed,documents});await p.locator('.ai-reading-toc').waitFor();await p.locator('.ai-reading-toc summary').click();assert.ok(await p.locator('.ai-reading-toc-link').count()>=3);await p.getByRole('button',{name:'二、下一步',exact:true}).click();
  const directoryStyle=await p.locator('.ai-reading-toc-link').first().evaluate(node=>{const style=getComputedStyle(node);return {display:style.display,align:style.textAlign,background:style.backgroundColor};});assert.deepEqual(directoryStyle,{display:'block',align:'left',background:'rgba(0, 0, 0, 0)'});
  const researchPrompt=await p.locator('.dt-new-content').evaluate(node=>{const panel=node.closest('#panelDeepThink'),style=getComputedStyle(node),rect=node.getBoundingClientRect();return {position:style.position,positionedBottom:panel.getBoundingClientRect().bottom-parseFloat(style.bottom),messagesBottom:document.querySelector('#dtMessages').getBoundingClientRect().bottom,visible:!node.hidden,actualBottom:rect.bottom};});assert.equal(researchPrompt.position,'absolute');assert.ok(researchPrompt.positionedBottom<=researchPrompt.messagesBottom-4,JSON.stringify(researchPrompt));if(researchPrompt.visible)assert.ok(researchPrompt.actualBottom<=researchPrompt.messagesBottom-4,JSON.stringify(researchPrompt));
  const before=await p.evaluate(()=>aiPolish.streams.length);for(const label of ['导出 PDF','导出 Markdown']){const pending=p.waitForEvent('download');await p.getByRole('button',{name:label,exact:true}).click();const download=await pending,file=fs.readFileSync(await download.path());if(label==='导出 PDF'){assert.match(file.subarray(0,8).toString(),/^%PDF-/);assert.ok(file.length>1000);}else assert.equal(file.toString(),answer);}
  const exports=await p.evaluate(()=>enhancementCalls.filter(c=>c.path.endsWith('/research/export')));assert.deepEqual(exports.map(c=>c.body.format),['pdf','markdown']);assert.ok(exports.every(c=>c.body.answer===answer&&c.body.sources.some(s=>s.source_id==='F1')));assert.equal(await p.evaluate(()=>aiPolish.streams.length),before);const finalEvidence=await capture(p,'desktop-research-directory-export','#panelDeepThink');assert.deepEqual(finalEvidence.axe||[],[]);await p.locator('.ai-reading-toc').scrollIntoViewIfNeeded();const directoryEvidence=await capture(p,'desktop-research-directory-open','#panelDeepThink');assert.deepEqual(directoryEvidence.axe||[],[]);assert.deepEqual(f.errors,[]);
});
test('voice confirmation keeps recognized text unsent and animation follows actual recognition and speech start events',{timeout:60000},async t=>{
  const f=await fixture(t,{theme:'dark',viewport:{width:390,height:844}}),p=f.page;
  await p.evaluate(()=>{window.enhancementVoice={recognitions:[],speeches:[],cancelled:0};window.SpeechRecognition=class{constructor(){enhancementVoice.recognitions.push(this);}start(){}stop(){}abort(){this.aborted=true;}};window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{cancel(){enhancementVoice.cancelled++;},getVoices:()=>[{lang:'zh-CN',localService:true}],speak:speech=>enhancementVoice.speeches.push(speech)}});});
  await p.locator('.ai-plus-btn').click();await p.getByRole('switch',{name:'语音对话',exact:true}).click();await p.waitForFunction(()=>enhancementVoice.recognitions.length===1);assert.equal(await p.locator('#aiVoiceStatus').getAttribute('data-stage'),'permission');await p.getByRole('checkbox',{name:'语音发送前确认',exact:true}).check();await p.evaluate(()=>enhancementVoice.recognitions[0].onstart());assert.equal(await p.locator('#aiVoiceStatus').getAttribute('data-stage'),'listening');
  await p.evaluate(()=>{const result=[{transcript:'需要确认的语音问题'}];result.isFinal=true;enhancementVoice.recognitions[0].onresult({results:[result]});enhancementVoice.recognitions[0].onend();});await p.waitForFunction(()=>document.querySelector('#aiVoiceStatus').dataset.stage==='draft');assert.equal(await p.locator('#aiChatMsgInput').inputValue(),'需要确认的语音问题');assert.equal(await p.evaluate(()=>aiPolish.streams.length),0);const draftEvidence=await capture(p,'dark-phone-voice-confirmation','#aiChatRoot');assert.deepEqual(draftEvidence.axe||[],[]);
  await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);await finish(p,0,'这是经过确认之后的语音回复。');await p.waitForFunction(()=>enhancementVoice.speeches.length===1);assert.equal(await p.locator('#aiVoiceStatus').getAttribute('data-stage'),'speech_wait');await p.evaluate(()=>enhancementVoice.speeches[0].onstart());assert.equal(await p.locator('#aiVoiceStatus').getAttribute('data-stage'),'speaking');const speakingEvidence=await capture(p,'dark-phone-voice-speaking','#aiChatRoot');assert.deepEqual(speakingEvidence.axe||[],[]);assert.deepEqual(f.errors,[]);
});
test('reading older content shows a new-content prompt without moving the viewport',{timeout:60000},async t=>{
  const f=await fixture(t),p=f.page,messages=p.locator('#aiChatMessagesArea');
  const old=Array.from({length:120},(_,i)=>'第 '+i+' 段已完成的历史资料，需要保持阅读位置。').join('\n\n');
  await send(p,'请输出历史资料');await finish(p,0,old);
  await p.waitForFunction(()=>{const node=document.querySelector('#aiChatMessagesArea .ai-msg.assistant:not(.generating) .ai-msg-bubble');return node?.textContent.includes('第 119 段已完成的历史资料');});
  await send(p,'继续补充',1);await emit(p,1,{type:'content',text:'新的回复开始。'});
  await p.waitForFunction(()=>document.querySelector('#aiChatMessagesArea .generating .ai-msg-bubble')?.textContent.includes('新的回复开始。'));
  const before=await scrollUpToRead(p,messages);
  await emit(p,1,{type:'content',text:'持续收到的新内容。'.repeat(80)});const prompt=p.getByRole('button',{name:'查看最新回复',exact:true});await prompt.waitFor();
  await p.waitForFunction(()=>document.querySelector('#aiChatMessagesArea .generating .ai-msg-bubble')?.textContent.includes('持续收到的新内容。'));
  const after=await messages.evaluate(node=>node.scrollTop);assert.ok(Math.abs(after-before)<6,'reading position changed from '+before+' to '+after);
  await assertPromptGeometry(prompt);
  const evidence=await capture(p,'phone-reading-new-content','#aiChatRoot');assert.deepEqual(evidence.axe||[],[]);assert.deepEqual(f.errors,[]);
});
test('a done-only compatible reply keeps the old reading position and offers a working jump to the latest message',{timeout:60000},async t=>{
  const f=await fixture(t),p=f.page,messages=p.locator('#aiChatMessagesArea'),old=Array.from({length:120},(_,i)=>'第 '+i+' 段已经完成，可以向上滚动继续阅读。').join('\n\n');
  await send(p,'请输出可阅读的长资料');await finish(p,0,old);
  await p.waitForFunction(()=>document.querySelector('#aiChatMessagesArea .ai-msg.assistant:not(.generating) .ai-msg-bubble')?.textContent.includes('第 119 段已经完成'));
  await send(p,'仅终稿兼容回复',1);const before=await scrollUpToRead(p,messages);
  const content='只有 done 包返回的真实终稿。\n\n'+Array.from({length:10},(_,i)=>'终稿段落 '+i+'。').join('\n\n');
  await emit(p,1,{type:'done',content,conversation_id:'POLISH01',complete:true,saved:true});
  const prompt=p.getByRole('button',{name:'查看最新回复',exact:true});await prompt.waitFor();
  await p.waitForFunction(()=>Array.from(document.querySelectorAll('#aiChatMessagesArea .ai-msg.assistant:not(.generating) .ai-msg-bubble')).some(node=>node.textContent.includes('终稿段落 9。')));
  const after=await messages.evaluate(node=>node.scrollTop);assert.ok(Math.abs(after-before)<6,'done-only reply moved reading position from '+before+' to '+after);await assertPromptGeometry(prompt);
  await prompt.click();await p.waitForFunction(()=>{const node=document.querySelector('#aiChatMessagesArea');return node.scrollHeight-node.clientHeight-node.scrollTop<12;});assert.equal(await prompt.isVisible(),false);assert.deepEqual(f.errors,[]);
});
test('one client request keeps its reading anchor after cloud history adds a database ID',{timeout:60000},async t=>{
  const f=await fixture(t),p=f.page;const result=await p.evaluate(async()=>{
    const host=document.createElement('div');host.style.cssText='position:fixed;inset:20px 10px auto;z-index:9000;max-height:300px;height:300px;overflow:auto;background:white';document.body.append(host);
    const live=Array.from({length:24},(_,i)=>({role:'assistant',client_request_id:'actual-request-'+i,content:'同一次真实请求的消息 '+i}));
    const render=msg=>{const node=document.createElement('article');node.style.height='130px';node.textContent=msg.content;return node;};
    const create=()=>XtjAiCore.ReadingTools.create({container:host,owner:'alice',key:'live-cloud-reading-test',current:()=>true,renderMessage:render});let reader=create();live.forEach((msg,i)=>host.append(reader.makeMessage(msg,i,live.length)));host.scrollTop=750;reader.refresh();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));reader.remember();const saved=JSON.parse(localStorage.getItem(XtjAiCore.ReadingTools.positionKey('alice','live-cloud-reading-test')));reader.dispose();host.replaceChildren();reader=create();live.forEach((msg,i)=>host.append(reader.makeMessage({...msg,id:'cloud-db-'+i},i,live.length)));host.scrollTop=0;const restored=await reader.restore();const target=Array.from(host.children).find(node=>node.dataset.readingId===saved.anchor.id),offset=target?target.getBoundingClientRect().top-host.getBoundingClientRect().top:null;reader.dispose();host.remove();return {restored,offset,expected:saved.anchor.offset,id:saved.anchor.id};
  });assert.equal(result.restored,true);assert.match(result.id,/actual-request-/);assert.ok(Math.abs(result.offset-result.expected)<5);assert.deepEqual(f.errors,[]);
});
test('historical right-click copying survives lazy unloading, which cancels a pending touch menu',{timeout:60000},async t=>{
  const f=await fixture(t),p=f.page;
  await p.evaluate(()=>{
    __xtjCloseAiChat();
    const previous=window.fetch;
    window.enhancementHistory=Array.from({length:12},(_,i)=>({role:'assistant',id:'history-db-'+i,client_request_id:'history-real-request-'+i,created_at:new Date(Date.UTC(2026,9,14,6,i)).toISOString(),content:'已保存的完整历史正文 '+i+'。\n\n'+'用于核对复制时完整保留已保存内容。'.repeat(100)}));
    window.fetch=async(url,options)=>{
      if(new URL(url,location.href).pathname==='/api/agent/chat/history')return new Response(JSON.stringify({ok:true,conversation_id:'POLISH01',messages:enhancementHistory,has_more:false}),{headers:{'Content-Type':'application/json'}});
      return previous(url,options);
    };
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.enhancementCopied=text;}}});
    __xtjOpenAiChat();
  });
  await p.waitForFunction(()=>document.querySelector('#aiChatMessagesArea')?.querySelectorAll('.ai-msg.assistant').length===12&&document.activeElement.id==='aiChatMsgInput');
  await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const messages=p.locator('#aiChatMessagesArea'),first=p.locator('#aiChatMessagesArea > .ai-msg.assistant').first(),bubble=first.locator('.ai-msg-bubble');
  await messages.evaluate(node=>{node.scrollTop=0;node.dispatchEvent(new Event('scroll'));});await first.locator('.ai-reading-placeholder').waitFor({state:'detached'});await bubble.getByText('已保存的完整历史正文 0。',{exact:true}).waitFor();
  const expected=(await bubble.textContent()).trim();await rightClickSettledBubble(p,bubble);await p.locator('.ai-copy-menu .ai-copy-btn').click();await p.waitForFunction(expected=>window.enhancementCopied===expected,expected);
  await bubble.dispatchEvent('pointerdown',{pointerType:'touch',isPrimary:true,clientX:50,clientY:120});await messages.evaluate(node=>{node.scrollTop=node.scrollHeight;node.dispatchEvent(new Event('scroll'));});await first.locator('.ai-reading-placeholder').waitFor();await p.waitForTimeout(600);assert.equal(await p.locator('.ai-copy-menu').count(),0,'an unloaded bubble opened its pending touch menu');
  await messages.evaluate(node=>{node.scrollTop=0;node.dispatchEvent(new Event('scroll'));});await first.locator('.ai-reading-placeholder').waitFor({state:'detached'});await p.evaluate(()=>window.enhancementCopied=null);await rightClickSettledBubble(p,bubble);await p.locator('.ai-copy-menu .ai-copy-btn').click();await p.waitForFunction(expected=>window.enhancementCopied===expected,expected);assert.equal((await bubble.textContent()).trim(),expected);assert.deepEqual(f.errors,[]);
});
