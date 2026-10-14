'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { aiPolishFixture, openModelPicker } = require('./helpers/ai-polish-fixture');
async function fixture(t,options) { const f = await aiPolishFixture(options); t.after(() => f.close()); return f; }
async function voiceMocks(page) {
  await page.evaluate(() => {
    window.testVoice = {recognitions:[],speeches:[],cancels:0};
    window.SpeechRecognition = class {
      constructor() { testVoice.recognitions.push(this); }
      start() { this.started = true; } stop() { this.stopped = true; } abort() { this.aborted = true; }
    };
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{cancel() { testVoice.cancels++; },getVoices:()=>[{lang:'zh-CN',localService:true}],speak:speech=>testVoice.speeches.push(speech)}});
  });
}
test('a second microphone click cancels native permission wait without a page error',{timeout:45000},async t=>{
 const f=await fixture(t),p=f.page;await voiceMocks(p);await p.locator('#aiChatVoiceBtn').click();await p.waitForFunction(()=>testVoice.recognitions.length===1);
 await p.evaluate(()=>{testVoice.recognitions[0].stop=()=>{throw new DOMException('not started','InvalidStateError');};});
 await p.locator('#aiChatVoiceBtn').click();await p.waitForFunction(()=>testVoice.recognitions[0].aborted);
 assert.equal(await p.locator('#aiChatVoiceBtn').evaluate(el=>el.classList.contains('listening')),false);assert.deepEqual(f.errors,[]);
});
test('queued reply speech has a usable stop control without a false speaking animation',{timeout:45000},async t=>{
 const f=await fixture(t),p=f.page;await voiceMocks(p);await p.locator('#aiChatMsgInput').fill('请回答这个问题');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
 await p.evaluate(()=>aiPolishEmit({type:'done',content:'这是一段真实回复。',conversation_id:'POLISH01',complete:true,saved:true}));
 await p.locator('.ai-msg-act-read').last().click();await p.waitForFunction(()=>document.querySelector('#aiVoiceStatus').dataset.stage==='speech_wait');
 const stop=p.getByRole('button',{name:'停止朗读',exact:true});assert.equal(await stop.isVisible(),true);
 assert.notEqual(await p.locator('.ai-voice-state-icon').evaluate(el=>getComputedStyle(el).animationName),'ai-voice-live');
 const before=await p.evaluate(()=>testVoice.cancels);await stop.click();assert.ok(await p.evaluate(()=>testVoice.cancels)>before);assert.equal(await stop.isVisible(),false);assert.deepEqual(f.errors,[]);
});
for(const width of [390,320])test('compact keyboard keeps voice, send and context controls reachable with multiline draft and ten original files at '+width+'px',{timeout:45000},async t=>{
 const f=await fixture(t,{ios:true,viewport:{width,height:844}}),p=f.page;await voiceMocks(p);
 await p.locator('#aiChatMsgInput').fill('请回答这个问题');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
 await p.evaluate(()=>aiPolishEmit({type:'done',content:'这是一段真实回复。',conversation_id:'POLISH01',complete:true,saved:true}));
 await p.locator('.ai-msg-act-read').last().waitFor();
 const draft='正在编辑的新草稿。\n第二行草稿。\n第三行草稿。\n第四行草稿。\n第五行草稿。';
 await p.locator('#aiChatMsgInput').fill(draft);
 await p.locator('#aiChatFileInp').setInputFiles(Array.from({length:10},(_,i)=>({name:'资料'+i+'.txt',mimeType:'text/plain',buffer:Buffer.from('完整原文'+i)})));
 await p.waitForFunction(()=>document.querySelector('#aiChatFilePreview .ai-file-info')?.textContent.includes('10 个文件'));
 await p.locator('.ai-msg-act-read').last().click();await p.waitForFunction(()=>document.querySelector('#aiVoiceStatus').dataset.stage==='speech_wait');
 await p.locator('#aiChatMsgInput').focus();await p.evaluate(()=>{Object.assign(testKeyboardViewport,{height:280,offsetTop:86});testKeyboardViewport.dispatchEvent(new Event('resize'));testKeyboardViewport.dispatchEvent(new Event('scroll'));});
 await p.waitForFunction(()=>document.documentElement.style.getPropertyValue('--xtj-visual-top')==='86px');
 await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const bounds=await p.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return{top:r.top,bottom:r.bottom};};const preview=document.querySelector('#aiChatFilePreview');return{header:rect('.ai-chat-header'),controls:['.ai-chat-input-bar','#aiChatSendBtn','#aiChatVoiceBtn','.ai-context-trigger','#aiVoiceStatus button'].map(rect),previewHeight:preview.clientHeight};});
 assert.ok(Math.abs(bounds.header.top-86)<=2);for(const r of bounds.controls){assert.ok(r.top>=86-2,JSON.stringify(bounds));assert.ok(r.bottom<=368,JSON.stringify(bounds));}assert.ok(bounds.previewHeight>0&&bounds.previewHeight<=48);
 await p.evaluate(()=>{Object.assign(testKeyboardViewport,{height:844,offsetTop:0});testKeyboardViewport.dispatchEvent(new Event('resize'));testKeyboardViewport.dispatchEvent(new Event('scroll'));});
 await p.waitForFunction(()=>!document.documentElement.classList.contains('xtj-keyboard-open'));assert.equal(await p.locator('#aiChatMsgInput').inputValue(),draft);
 await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===2);
 const request=await p.evaluate(()=>aiPolish.streams[1].body);assert.ok(request.message.startsWith(draft));assert.equal(request.attachments.length,10);
 for(let i=0;i<10;i++){assert.equal(request.attachments[i].name,'资料'+i+'.txt');assert.equal(Buffer.from(request.attachments[i].data_url.split(',')[1],'base64').toString(),'完整原文'+i);}
 assert.deepEqual(f.errors,[]);
});
test('model testing uses the form configuration and displays evidence-based statuses in the existing modal',{timeout:45000},async t => {
  const f = await fixture(t,{capabilityResults:[{name:'chat',status:'passed',detail:'本次实测通过'},{name:'tools',status:'unconfirmed',detail:'接口未返回工具调用'},{name:'vision',status:'failed',detail:'测试请求被拒绝'}]}),p=f.page;
  await openModelPicker(p); await p.getByRole('option',{name:'＋ 添加自定义模型',exact:true}).click();
  await p.locator('#aiCmApiKey').fill('isolated-only-key'); await p.locator('#aiCmCheckBtn').click();
  await p.waitForSelector('#aiCmCapabilities li');
  assert.match(await p.locator('#aiCmCapabilities').textContent(),/基础对话：实测通过/);
  assert.match(await p.locator('#aiCmCapabilities').textContent(),/工具调用：未确认/);
  assert.match(await p.locator('#aiCmCapabilities').textContent(),/图片理解：实测失败/);
  const request = await p.evaluate(() => aiPolish.calls.find(row => row.path.endsWith('/models/check')).body);
  assert.equal(request.api_key,'isolated-only-key'); assert.equal(request.model,'qwen-plus');
  await p.locator('#aiCmModel').fill('new-model'); assert.equal(await p.locator('#aiCmCapabilities').textContent(),'');
  assert.deepEqual(f.errors,[]);
});
test('late capability results cannot describe an edited configuration',{timeout:45000},async t => {
  const f = await fixture(t,{capabilityResults:[{name:'chat',status:'passed',detail:'OLD RESULT'}]}),p=f.page;
  await p.evaluate(() => aiPolish.waitCapability = true); await openModelPicker(p);
  await p.getByRole('option',{name:'＋ 添加自定义模型',exact:true}).click(); await p.locator('#aiCmApiKey').fill('isolated-only-key');
  await p.locator('#aiCmCheckBtn').click(); await p.waitForFunction(() => !!aiPolish.releaseCapability);
  await p.locator('#aiCmModel').fill('replacement-model'); await p.evaluate(() => aiPolish.releaseCapability());
  await p.waitForTimeout(100); assert.equal(await p.locator('#aiCmCapabilities').textContent(),''); assert.deepEqual(f.errors,[]);
});
test('voice conversation sends a final transcript, reads the reply and interrupts speech for the next question',{timeout:45000},async t => {
  const f = await fixture(t),p=f.page; await voiceMocks(p);
  await p.locator('.ai-plus-btn').click(); await p.getByRole('switch',{name:'语音对话',exact:true}).click();
  await p.waitForFunction(() => testVoice.recognitions.length === 1);
  await p.evaluate(() => { const rec = testVoice.recognitions[0], result = [{transcript:'第一个语音问题'}]; result.isFinal = true; rec.onresult({results:[result]}); rec.onend(); });
  await p.waitForFunction(() => aiPolish.streams.length === 1);
  assert.equal(await p.evaluate(() => aiPolish.streams[0].body.message),'第一个语音问题');
  await p.evaluate(() => { aiPolishEmit({type:'content',text:'这是一段真实回复。'}); aiPolishEmit({type:'done',content:'这是一段真实回复。',conversation_id:'POLISH01',complete:true,saved:true}); });
  await p.waitForFunction(() => testVoice.speeches.length === 1); assert.equal(await p.evaluate(() => testVoice.speeches[0].text),'这是一段真实回复。');
  const oldEnd = await p.evaluate(() => { window.testOldSpeechEnd = testVoice.speeches[0].onend; return !!testOldSpeechEnd; }); assert.ok(oldEnd);
  await p.locator('#aiChatVoiceBtn').click(); await p.waitForFunction(() => testVoice.recognitions.length === 2);
  await p.evaluate(() => testOldSpeechEnd()); assert.equal(await p.evaluate(() => testVoice.speeches.length),1);
  assert.equal(await p.locator('#aiChatVoiceBtn').getAttribute('aria-label'),'结束语音输入');
  await p.evaluate(() => __xtjCloseAiChat()); assert.equal(await p.evaluate(() => testVoice.recognitions[1].aborted),true); assert.deepEqual(f.errors,[]);
});
test('local recording fallback stops tracks and uses local transcription without writing a DM transcript',{timeout:45000},async t => {
  const f = await fixture(t),p=f.page; await p.evaluate(() => {
    delete window.SpeechRecognition; delete window.webkitSpeechRecognition; window.localVoice = {stopped:0,transcribed:0};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop() { localVoice.stopped++; }}]})}});
    window.MediaRecorder = class { static isTypeSupported() { return true; } constructor() { this.state='inactive';this.mimeType='audio/webm'; } start() { this.state='recording'; } stop() { this.state='inactive';this.ondataavailable?.({data:new Blob(['original-recorded-audio'],{type:this.mimeType})});this.onstop?.(); } };
    XTJVoiceTranscription.transcribeBlob = async(blob,options) => { localVoice.transcribed++;localVoice.bytes=await blob.text();options.onState({label:'正在识别语音…'});return '本地识别的问题'; };
  });
  await p.locator('#aiChatVoiceBtn').click(); await p.waitForFunction(() => document.querySelector('#aiVoiceStatus').textContent.includes('正在录音'));
  await p.locator('#aiChatVoiceBtn').click(); await p.waitForFunction(() => document.querySelector('#aiChatMsgInput').value === '本地识别的问题');
  const result = await p.evaluate(() => localVoice); assert.equal(result.stopped,1); assert.equal(result.transcribed,1); assert.equal(result.bytes,'original-recorded-audio');
  assert.equal(await p.evaluate(() => aiPolish.calls.some(row => row.path.includes('messages/transcript'))),false); assert.deepEqual(f.errors,[]);
});
test('research history continues a persisted frontier with its original conversation and keeps the next draft',{timeout:45000},async t => {
  const checkpoint = {id:'11111111-1111-4111-8111-111111111111',query:'需要继续的研究任务',conversation_id:'POLISH01',completed:2,total:3,resumable:true,status:'interrupted',stage:'workers'};
  const f = await fixture(t,{checkpoints:[checkpoint]}),p=f.page;
  await p.locator('#aiDeepThinkToggle').click(); await p.waitForSelector('#dtInput');
  await p.locator('#dtInput').fill('下一条研究草稿'); await p.locator('.dt-research-history-btn').click();
  await p.getByRole('button',{name:'继续研究',exact:true}).click(); await p.waitForFunction(() => aiPolish.streams.length > 0);
  const request = await p.evaluate(() => aiPolish.streams.at(-1));
  assert.equal(request.body.checkpoint_id,checkpoint.id); assert.equal(request.body.conversation_id,'POLISH01');
  assert.equal(await p.locator('#dtInput').inputValue(),'下一条研究草稿');
  await p.evaluate(() => { aiPolishEmit({type:'research_stage',stage:'resume',message:'复用 2 个方向'}); aiPolishEmit({type:'research_done',answer:'继续完成的报告',conversation_id:'POLISH01',saved:true}); });
  await p.waitForFunction(() => document.querySelector('#dtMessages').textContent.includes('继续完成的报告')); assert.deepEqual(f.errors,[]);
});
