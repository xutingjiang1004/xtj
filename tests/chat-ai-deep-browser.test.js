'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {postBrowserFixture,wireAiChat}=require('./helpers/post-browser-fixture');
async function fixture(t,options={}) { const f=await postBrowserFixture({counts:[1],publicPosts:true,...options}); t.after(()=>f.close()); return f; }
async function login(page,user) {
  for(const path of ['login','refresh'])await page.route('**/api/user/'+path,r=>r.fulfill({json:{ok:true,user_name:user,token:user+'-fixture-token'}}));
  await page.evaluate(async user=>{document.getElementById('loginNickInp').value=user;document.getElementById('loginPwInp').value='isolated-only';await doLogin();},user);
}
async function captureAiBodies(page) {
  await page.evaluate(()=>{const base=fetch;window.aiWitnessBodies=[];
    window.fetch=async(url,options={})=>{if(new URL(url,location.href).pathname==='/api/agent/chat/stream')aiWitnessBodies.push(JSON.parse(options.body));return base(url,options);};});
}
for (const user of ['bob','alice']) test('ask-about-message cancels a delayed private image across logout and login as '+user,{timeout:45000},async t=>{
  const f=await fixture(t);await wireAiChat(f.page);await captureAiBodies(f.page);
  await f.page.evaluate(()=>{const base=fetch;window.fetch=(url,options)=>new URL(url,location.href).pathname==='/api/dm/private-probe'
    ?new Promise(resolve=>{window.releasePrivateImage=resolve;}):base(url,options);
    askAiAboutDmMessage({content:JSON.stringify({text:'ALICE PRIVATE MESSAGE',media:{kind:'image',url:location.origin+'/api/dm/private-probe'}})});});
  await f.page.waitForFunction(()=>typeof releasePrivateImage==='function');
  await f.page.evaluate(()=>doLogout());await login(f.page,user);await f.page.evaluate(()=>__xtjOpenAiChat());
  await f.page.locator('#aiChatMsgInput').fill('BOB CURRENT DRAFT');
  await f.page.evaluate(png=>releasePrivateImage(new Response(Uint8Array.from(atob(png),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}})),f.png.toString('base64'));
  await f.page.waitForTimeout(600);
  assert.equal(await f.page.locator('#aiChatMsgInput').inputValue(),'BOB CURRENT DRAFT');
  assert.equal(await f.page.locator('#aiChatFilePreview img').count(),0);assert.equal(await f.page.evaluate(()=>aiWitnessBodies.length),0);
  assert.equal(await f.page.locator('#aiChatRoot').getByText('ALICE PRIVATE MESSAGE').count(),0);assert.deepEqual(f.errors,[]);
});
test('private custom-model fields are removed on logout and detached handlers cannot save them to the next account',{timeout:45000},async t=>{
  const f=await fixture(t);await wireAiChat(f.page);
  await f.page.locator('.ai-plus-btn').click();await f.page.locator('[data-action="open-model"]').click();
  await f.page.getByRole('option',{name:'＋ 添加自定义模型'}).click();
  await f.page.locator('#aiCmApiKey').fill('ALICE_SYNTHETIC_PRIVATE_KEY');await f.page.locator('#aiCmLabel').fill('PRIVATE ALICE CONFIG');
  await f.page.evaluate(()=>{window.detachedModelSave=document.getElementById('aiCmSaveBtn');window.detachedModelKey=document.getElementById('aiCmApiKey');});
  await f.page.evaluate(()=>doLogout());
  assert.equal(await f.page.locator('#aiCustomModelModal').count(),0);
  assert.equal(await f.page.evaluate(()=>detachedModelKey.value),'');
  await login(f.page,'bob');await f.page.evaluate(()=>detachedModelSave.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  assert.equal(await f.page.evaluate(()=>localStorage.getItem('xtj_ai_models_pending__bob')),null);
  assert.equal(await f.page.evaluate(()=>localStorage.getItem('xtj_ai_custom_models__bob')),null);assert.deepEqual(f.errors,[]);
});
test('invite dialogs clear private codes and cannot redeem through a detached button after switching accounts',{timeout:45000},async t=>{
  const f=await fixture(t);await wireAiChat(f.page);
  await f.page.evaluate(()=>{const base=fetch;window.inviteRedeems=0;window.fetch=(url,options)=>{
    if(new URL(url,location.href).pathname==='/api/agent/invite/redeem')inviteRedeems++;return base(url,options);};});
  await f.page.locator('.ai-plus-btn').click();await f.page.locator('[data-action="pro"]').click();
  await f.page.locator('#aiInviteCodeInput').fill('ALICECODE');
  await f.page.evaluate(()=>{window.detachedInviteButton=document.getElementById('aiInviteConfirmBtn');window.detachedInviteInput=document.getElementById('aiInviteCodeInput');});
  await f.page.evaluate(()=>doLogout());assert.equal(await f.page.locator('#aiInviteModal').count(),0);
  assert.equal(await f.page.evaluate(()=>detachedInviteInput.value),'');await login(f.page,'bob');
  await f.page.evaluate(()=>{detachedInviteInput.value='ALICECODE';detachedInviteButton.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
  await f.page.waitForTimeout(350);assert.equal(await f.page.evaluate(()=>inviteRedeems),0);assert.deepEqual(f.errors,[]);
});
test('research history opens the original conversation and reopening it does not invalidate an active answer',{timeout:45000},async t=>{
  const f=await fixture(t);await wireAiChat(f.page);
  await f.page.evaluate(()=>{const base=fetch;window.deepHistoryRequests=0;
    window.fetch=(url,options)=>{const p=new URL(url,location.href);
      if(p.pathname==='/api/agent/research/history')return Promise.resolve(new Response(JSON.stringify({ok:true,items:[{
        id:'record',conversation_id:'RECORD1',query:'SAVED RESEARCH QUESTION',answer:'SAVED REPORT',sources:[]
      }]}),{headers:{'Content-Type':'application/json'}}));
      if(p.pathname==='/api/agent/chat/history'&&p.searchParams.get('mode')==='deep_think') {
        deepHistoryRequests++;const saved=p.searchParams.get('conversation_id')==='RECORD1';
        return Promise.resolve(new Response(JSON.stringify({ok:true,conversation_id:p.searchParams.get('conversation_id'),messages:[{
          id:saved?'saved':'old',role:'assistant',content:saved?'SAVED REPORT':'CURRENT REPORT',created_at:'2026-10-12T08:00:00Z'
        }],has_more:false}),{headers:{'Content-Type':'application/json'}}));
      }
      if(p.pathname==='/api/agent/chat')return Promise.resolve(new Response(new ReadableStream({start(c){window.deepStream=c;}}),{headers:{'Content-Type':'text/event-stream'}}));
      return base(url,options);};return __xtjAiAgent.openConversation('CURRENT1','deep_think');});
  await f.page.waitForFunction(()=>document.getElementById('dtMessages').textContent.includes('CURRENT REPORT'));
  await f.page.locator('.dt-research-history-btn').click();await f.page.locator('.dt-research-history-body button').click();
  await f.page.waitForFunction(()=>document.getElementById('dtMessages').textContent.includes('SAVED REPORT'));
  assert.equal(await f.page.locator('#dtMessages').getByText('CURRENT REPORT').count(),0);
  assert.equal(await f.page.evaluate(()=>localStorage.getItem('xtj_ai_dt_conversation_id__alice')),'RECORD1');
  await f.page.locator('#dtInput').fill('CONTINUE THE SAVED RESEARCH');await f.page.locator('#dtSendBtn').click();
  await f.page.waitForFunction(()=>!!window.deepStream);const before=await f.page.evaluate(()=>deepHistoryRequests);
  await f.page.evaluate(()=>__xtjAiAgent.openConversation('RECORD1','deep_think'));
  assert.equal(await f.page.evaluate(()=>deepHistoryRequests),before);
  await f.page.evaluate(()=>{deepStream.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'answer_chunk',chunk:'LIVE RESEARCH ANSWER'})+'\n\n'));});
  await f.page.waitForFunction(()=>document.getElementById('dtMessages').textContent.includes('LIVE RESEARCH ANSWER'));
  assert.deepEqual(f.errors,[]);
});
test('ask-about-message sends one authorized image with its original bytes',{timeout:45000},async t=>{
  const f=await fixture(t);await wireAiChat(f.page);await captureAiBodies(f.page);
  await f.page.evaluate(png=>{const base=fetch;window.fetch=(url,options)=>new URL(url,location.href).pathname==='/api/dm/private-probe'
    ?Promise.resolve(new Response(Uint8Array.from(atob(png),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}})):base(url,options);
    askAiAboutDmMessage({content:JSON.stringify({text:'这是什么',media:{kind:'image',url:location.origin+'/api/dm/private-probe'}})});},f.png.toString('base64'));
  await f.page.waitForFunction(()=>aiWitnessBodies.length===1);
  const body=await f.page.evaluate(()=>aiWitnessBodies[0]);assert.match(body.message,/这是什么/);assert.equal(body.attachments.length,1);
  assert.equal(body.attachments[0].data_url,'data:image/png;base64,'+f.png.toString('base64'));assert.deepEqual(f.errors,[]);
});
test('successful empty AI history clears completed stale cache but retains an in-flight question',{timeout:45000},async t=>{
  const f=await fixture(t);await wireAiChat(f.page);
  await f.page.evaluate(()=>{const base=fetch;window.historyEmpty=false;window.historyHold=false;
    window.fetch=(url,options)=>{const p=new URL(url,location.href);if(p.pathname==='/api/agent/chat/history') {
      const response=()=>new Response(JSON.stringify({ok:true,conversation_id:p.searchParams.get('conversation_id')||'ABCDEF',messages:historyEmpty?[]:[{id:'question',role:'user',content:'REMOTE OLD QUESTION',created_at:'2026-10-12T07:59:00Z'},{id:'saved',role:'assistant',content:'REMOTE OLD ANSWER',created_at:'2026-10-12T08:00:00Z'}],has_more:false}),{headers:{'Content-Type':'application/json'}});
      return historyHold?new Promise(resolve=>{window.releaseAiHistory=()=>resolve(response());}):Promise.resolve(response());
    }return base(url,options);};return __xtjAiAgent.openConversation('ABCDEF','normal');});
  await f.page.waitForFunction(()=>document.getElementById('aiChatMessagesArea').textContent.includes('REMOTE OLD ANSWER'));
  await f.page.evaluate(()=>{historyEmpty=true;__xtjCloseAiChat();__xtjOpenAiChat();});
  await f.page.waitForFunction(()=>document.querySelector('#aiChatMessagesArea .ai-chat-empty'));
  assert.equal(await f.page.locator('#aiChatMessagesArea').getByText('REMOTE OLD ANSWER').count(),0);
  await f.page.evaluate(()=>{__xtjCloseAiChat();historyHold=true;__xtjOpenAiChat();});await f.page.waitForFunction(()=>!!window.releaseAiHistory);
  await f.page.locator('#aiChatMsgInput').fill('QUESTION WHILE HISTORY PENDING');await f.page.locator('#aiChatSendBtn').click();
  await f.page.waitForFunction(()=>!!window.testStream);await f.page.evaluate(()=>releaseAiHistory());
  await f.page.waitForFunction(()=>document.getElementById('aiChatMessagesArea').textContent.includes('QUESTION WHILE HISTORY PENDING'));
  assert.equal(await f.page.locator('.ai-msg.assistant.generating').count(),1);assert.deepEqual(f.errors,[]);
});
test('a pending chosen file survives initial history resolution and is cleared by explicit conversation switching',{timeout:45000},async t=>{
  const f=await fixture(t);await wireAiChat(f.page);
  await f.page.evaluate(()=>{__xtjCloseAiChat();const base=fetch;window.fetch=(url,options)=>new URL(url,location.href).pathname==='/api/agent/chat/history'
    ?new Promise(resolve=>{window.releaseInitialHistory=()=>resolve(new Response(JSON.stringify({ok:true,conversation_id:'ABCDEF',messages:[],has_more:false}),{headers:{'Content-Type':'application/json'}}));}):base(url,options);
    const Reader=FileReader;window.FileReader=class extends Reader{readAsDataURL(file){this.savedFile=file;window.pendingAiReader=this;}release(){super.readAsDataURL(this.savedFile);}};
    __xtjOpenAiChat();});
  await f.page.waitForFunction(()=>!!window.releaseInitialHistory);
  await f.page.locator('#aiChatFileInp').setInputFiles({name:'chosen.png',mimeType:'image/png',buffer:f.png});
  await f.page.waitForFunction(()=>!!window.pendingAiReader);await f.page.evaluate(()=>releaseInitialHistory());
  await f.page.waitForFunction(()=>__xtjAiAgent.getConversationId()==='ABCDEF');await f.page.evaluate(()=>pendingAiReader.release());
  await f.page.waitForSelector('#aiChatFilePreview .ai-file-thumb');
  await f.page.evaluate(()=>{const base=fetch;window.fetch=(url,options)=>new URL(url,location.href).pathname==='/api/agent/chat/history'
    ?Promise.resolve(new Response(JSON.stringify({ok:true,conversation_id:'SECOND',messages:[],has_more:false}),{headers:{'Content-Type':'application/json'}})):base(url,options);
    return __xtjAiAgent.openConversation('SECOND','normal');});
  assert.equal(await f.page.locator('#aiChatFilePreview img').count(),0);assert.deepEqual(f.errors,[]);
});
test('unconfirmed interrupted turns remain visible after reopening, then authoritative deletion clears confirmed turns',{timeout:45000},async t=>{
  const f=await fixture(t);await wireAiChat(f.page);await captureAiBodies(f.page);
  await f.page.locator('#aiChatMsgInput').fill('UNCONFIRMED QUESTION');await f.page.locator('#aiChatSendBtn').click();
  await f.page.waitForFunction(()=>!!window.testStream);await f.page.evaluate(()=>{testEmit({type:'reasoning',text:'UNCONFIRMED THINKING'});testEmit({type:'content',text:'UNCONFIRMED ANSWER'});});
  await f.page.waitForFunction(()=>document.getElementById('aiChatMessagesArea').textContent.includes('UNCONFIRMED ANSWER'));
  await f.page.locator('#aiChatPauseBtn').click();await f.page.evaluate(()=>{__xtjCloseAiChat();__xtjOpenAiChat();});
  await f.page.waitForFunction(()=>!document.querySelector('#aiChatMessagesArea[aria-busy="true"]'));
  assert.match(await f.page.locator('#aiChatMessagesArea').textContent(),/UNCONFIRMED QUESTION/);
  assert.match(await f.page.locator('#aiChatMessagesArea').textContent(),/UNCONFIRMED ANSWER/);
  await f.page.evaluate(()=>{const id=aiWitnessBodies[0].client_request_id;window.mockAiHistory=[
    {id:'confirmed-user',role:'user',content:'UNCONFIRMED QUESTION',client_request_id:id,interrupted:true},
    {id:'confirmed-answer',role:'assistant',content:'UNCONFIRMED ANSWER',reasoning:'UNCONFIRMED THINKING',client_request_id:id,interrupted:true}
  ];__xtjCloseAiChat();__xtjOpenAiChat();});
  await f.page.waitForFunction(()=>Array.from(document.querySelectorAll('#aiChatMessagesArea .ai-msg')).some(node=>node._msgRef?.id==='confirmed-user'));
  await f.page.evaluate(()=>{mockAiHistory=[];__xtjCloseAiChat();__xtjOpenAiChat();});
  await f.page.waitForFunction(()=>!!document.querySelector('#aiChatMessagesArea .ai-chat-empty'));
  assert.doesNotMatch(await f.page.locator('#aiChatMessagesArea').textContent(),/UNCONFIRMED/);assert.deepEqual(f.errors,[]);
});
test('AI history loads older conversation pages and keeps them available for retry',{timeout:45000},async t=>{
  const f=await fixture(t);await wireAiChat(f.page);
  await f.page.evaluate(()=>{const base=fetch;window.failOlder=true;
    window.fetch=(url,options)=>{const p=new URL(url,location.href);if(p.pathname==='/api/agent/chat/conversations')return Promise.resolve(new Response(JSON.stringify(p.searchParams.has('before')
      ?failOlder?{ok:false,error:'temporary failure'}:{ok:true,conversations:[{conversation_id:'OLDER1',title:'OLDER CONVERSATION'}],has_more:false}
      :{ok:true,conversations:[{conversation_id:'RECENT',title:'RECENT CONVERSATION'}],has_more:true,next_cursor:'older-page'}),{headers:{'Content-Type':'application/json'}}));return base(url,options);};});
  await f.page.locator('.ai-chat-hist-btn').click();await f.page.waitForSelector('.ai-conv-more');
  await f.page.locator('.ai-conv-more').click();await f.page.waitForFunction(()=>document.querySelector('.ai-conv-more')?.textContent.includes('加载失败'));
  assert.match(await f.page.locator('.ai-conv-item').textContent(),/RECENT CONVERSATION/);
  await f.page.evaluate(()=>failOlder=false);await f.page.locator('.ai-conv-more').click();await f.page.waitForFunction(()=>document.querySelectorAll('.ai-conv-item').length===2);
  assert.match(await f.page.locator('.ai-conv-item').last().textContent(),/OLDER CONVERSATION/);assert.deepEqual(f.errors,[]);
});
