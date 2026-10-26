'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {aiPolishFixture}=require('./helpers/ai-polish-fixture');
const frames=p=>p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function ingress(p,kind,target,files){
 await p.evaluate(({kind,target,files})=>{
  const data=new DataTransfer();for(const file of files)data.items.add(new File([file.text],file.name,{type:file.type||'text/plain'}));
  const event=kind==='paste'?new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}):new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true});
  document.querySelector(target).dispatchEvent(event);
 },{kind,target,files});
}
const files=[{name:'01-原图要求.txt',text:'必须保留原图。'},{name:'02-预算.txt',text:'预算200元。'}];
for(const [width,height,theme,kind] of [[320,568,'light','drop'],[390,844,'dark','paste'],[1280,900,'light','drop']])test(width+'px '+kind+' keeps both original files and a full composer row',{timeout:30000},async()=>{
 const f=await aiPolishFixture({viewport:{width,height},theme}),p=f.page;
 try{
  const before=await p.locator('.ai-chat-input-field').boundingBox();
  await ingress(p,kind,kind==='paste'?'#aiChatMsgInput':'#aiChatInputBar',files);
  await p.waitForFunction(()=>document.getElementById('aiChatFilePreview').textContent.includes('2 个文件'),null,{timeout:2500});
  assert.match(await p.locator('#aiChatFilePreview .ai-file-info').textContent(),/约 1KB/);
  await p.locator('#aiChatMsgInput').fill('核对两份资料');await frames(p);
  const layout=await p.evaluate(()=>{const rect=id=>document.getElementById(id).getBoundingClientRect().toJSON();return{field:document.querySelector('.ai-chat-input-field').getBoundingClientRect().toJSON(),preview:rect('aiChatFilePreview'),plus:rect('aiPlusBtn'),mic:rect('aiChatVoiceBtn'),send:rect('aiChatSendBtn')};});
  assert.ok(Math.abs(layout.field.width-before.width)<1,JSON.stringify(layout));
  assert.ok(layout.preview.bottom<=layout.field.top+1,JSON.stringify(layout));
  assert.ok(Math.abs(layout.plus.bottom-layout.send.bottom)<2&&Math.abs(layout.mic.bottom-layout.send.bottom)<2,JSON.stringify(layout));
  const hit=await p.locator('#aiChatSendBtn').evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});assert.equal(hit,true);
  await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  const sent=await p.evaluate(()=>aiPolish.streams[0].body.attachments);assert.deepEqual(sent.map(file=>file.name),files.map(file=>file.name));
  assert.deepEqual(sent.map(file=>Buffer.from(file.data_url.split(',')[1],'base64').toString('utf8')),files.map(file=>file.text));
  assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('a bubbling clipboard file is read once while ordinary text paste remains native',{timeout:30000},async()=>{
 const f=await aiPolishFixture(),p=f.page;try{
  await p.evaluate(()=>{const read=FileReader.prototype.readAsDataURL;window.ingressReads=[];FileReader.prototype.readAsDataURL=function(file){ingressReads.push(file.name);return read.call(this,file);};});
  await ingress(p,'paste','#aiChatMsgInput',[files[0]]);await p.waitForFunction(()=>document.getElementById('aiChatFilePreview').textContent.includes('01-原图要求'));
  assert.deepEqual(await p.evaluate(()=>ingressReads),[files[0].name]);
  const native=await p.evaluate(()=>{const data=new DataTransfer();data.setData('text/plain','这段文字应由浏览器粘贴');const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});document.getElementById('aiChatMsgInput').dispatchEvent(event);return!event.defaultPrevented;});assert.equal(native,true);
  await p.locator('.ai-file-remove').click();assert.equal(await p.locator('#aiChatFilePreview').isVisible(),false);assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('research receives one ordered batch when multiple files are pasted into its nested composer',{timeout:30000},async()=>{
 const f=await aiPolishFixture(),p=f.page;try{
  await p.locator('.ai-deep-think-toggle').click();await p.waitForSelector('#panelDeepThink.active');
  await p.evaluate(()=>{const read=FileReader.prototype.readAsDataURL;window.ingressReads=[];FileReader.prototype.readAsDataURL=function(file){ingressReads.push(file.name);return read.call(this,file);};});
  await ingress(p,'paste','#dtInput',files);await p.waitForFunction(()=>document.querySelectorAll('#dtFilePreview .ai-file-chip').length===2,null,{timeout:2500});
  assert.deepEqual(await p.evaluate(()=>ingressReads),files.map(file=>file.name));
  assert.deepEqual(await p.locator('#dtFilePreview .ai-file-info').allTextContents(),files.map(file=>file.name+' · 1KB'));assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
test('a clipboard screenshot without a useful filename keeps its original image data',{timeout:30000},async()=>{
 const f=await aiPolishFixture(),p=f.page;try{
  await p.evaluate(bytes=>{const data=new DataTransfer();data.items.add(new File([new Uint8Array(bytes)],'blob',{type:'image/png'}));document.getElementById('aiChatMsgInput').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},[...f.png]);
  await p.locator('#aiChatFilePreview .ai-file-thumb').waitFor();await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  const sent=await p.evaluate(()=>aiPolish.streams[0].body.attachments);assert.equal(sent.length,1);assert.match(sent[0].name,/^paste-\d+\.png$/);assert.equal(sent[0].type,'image/png');assert.equal(sent[0].data_url.split(',')[1],f.png.toString('base64'));assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});
