'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {postBrowserFixture,wireAiChat}=require('./helpers/post-browser-fixture');

async function fixture(t){const f=await postBrowserFixture({counts:[1],publicPosts:true});t.after(()=>f.close());return f;}
async function loginAs(f,user){
  await f.page.route('**/api/user/login',route=>route.fulfill({json:{ok:true,token:user+'-fixture-token',user_name:user}}));
  await f.page.route('**/api/user/refresh',route=>route.fulfill({json:{ok:true,token:user+'-fixture-token',user_name:user}}));
  await f.page.evaluate(async user=>{document.getElementById('loginNickInp').value=user;document.getElementById('loginPwInp').value='local-fixture-password';await doLogin();},user);
  assert.equal(await f.page.evaluate(()=>currentUser),user);
}
async function researchHistory(page){
  await page.evaluate(()=>{
    window.fixtureHistoryReads=[];const base=fetch;
    window.fetch=async(url,options)=>{
      const parsed=new URL(url,location.href);
      if(parsed.pathname==='/api/agent/chat/history'&&parsed.searchParams.get('mode')==='deep_think'){
        const cid=parsed.searchParams.get('conversation_id');fixtureHistoryReads.push({owner:currentUser,cid});
        return new Response(JSON.stringify({ok:true,messages:[{role:'user',content:'RESEARCH '+currentUser+' '+cid}],has_more:false}),{headers:{'Content-Type':'application/json'}});
      }
      return base(url,options);
    };
  });
}

test('F01 logout removes private chat and rejects late stream data after another login',async t=>{
  const f=await fixture(t);await wireAiChat(f.page);
  await f.page.locator('#aiChatMsgInput').fill('PRIVATE QUESTION ALICE');await f.page.locator('#aiChatSendBtn').click();
  await f.page.waitForFunction(()=>!!window.testStream);
  await f.page.evaluate(()=>{window.oldFixtureStream=testStream;testEmit({type:'content',text:'PRIVATE ANSWER ALICE'});});
  await f.page.waitForFunction(()=>document.querySelector('.ai-msg.assistant')?.textContent.includes('PRIVATE ANSWER ALICE'));
  await f.page.evaluate(()=>doLogout());
  assert.equal(await f.page.locator('#aiChatRoot').count(),0);
  assert.equal(await f.page.evaluate(()=>typeof __xtjAbortAiRequests),'function');
  await loginAs(f,'bob');await wireAiChat(f.page);
  await f.page.evaluate(()=>{try{oldFixtureStream.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'content',text:'LATE ALICE SECRET'})+'\n\n'));}catch(_){} });
  assert.doesNotMatch(await f.page.locator('body').innerText(),/PRIVATE QUESTION ALICE|PRIVATE ANSWER ALICE|LATE ALICE SECRET/);
  await f.page.locator('#aiChatMsgInput').fill('BOB CONTROL');await f.page.locator('#aiChatSendBtn').click();
  await f.page.waitForFunction(()=>testStream!==oldFixtureStream);
  await f.page.evaluate(()=>{testEmit({type:'content',text:'BOB AUTHORIZED ANSWER'});testEmit({type:'done'});});
  await f.page.waitForFunction(()=>document.querySelector('.ai-msg.assistant')?.textContent.includes('BOB AUTHORIZED ANSWER'));
  assert.deepEqual(f.errors,[]);
});

test('F02 research cache is bound to the conversation and preserves the same authorized history',async t=>{
  const f=await fixture(t);await wireAiChat(f.page);await researchHistory(f.page);
  await f.page.evaluate(()=>__xtjAiAgent.openConversation('conversation-alpha','deep_think'));
  assert.match(await f.page.locator('#dtMessages').innerText(),/RESEARCH alice conversation-alpha/);
  await f.page.evaluate(()=>__xtjAiAgent.openConversation('conversation-alpha','deep_think'));
  assert.equal(await f.page.evaluate(()=>fixtureHistoryReads.length),1);
  await f.page.evaluate(()=>__xtjAiAgent.openConversation('conversation-beta','deep_think'));
  assert.match(await f.page.locator('#dtMessages').innerText(),/RESEARCH alice conversation-beta/);
  assert.doesNotMatch(await f.page.locator('#dtMessages').innerText(),/conversation-alpha/);
  assert.deepEqual(await f.page.evaluate(()=>fixtureHistoryReads.map(item=>item.cid)),['conversation-alpha','conversation-beta']);
  assert.equal(await f.page.evaluate(()=>localStorage.getItem('xtj_ai_dt_conversation_id')),null);
  assert.equal(await f.page.evaluate(()=>localStorage.getItem('xtj_ai_dt_conversation_id__alice')),'conversation-beta');
  assert.deepEqual(f.errors,[]);
});

test('F02 logout clears research DOM and another account cannot restore its conversation',async t=>{
  const f=await fixture(t);await wireAiChat(f.page);await researchHistory(f.page);
  await f.page.evaluate(()=>__xtjAiAgent.openConversation('alice-private-research','deep_think'));
  await f.page.evaluate(()=>doLogout());
  assert.equal(await f.page.locator('#dtMessages').innerText(),'');
  await loginAs(f,'bob');await f.page.evaluate(()=>__xtjAiAgent.openDeepThink());
  assert.doesNotMatch(await f.page.locator('#dtMessages').innerText(),/alice|alice-private-research/);
  await f.page.evaluate(()=>__xtjAiAgent.openConversation('bob-authorized-research','deep_think'));
  assert.match(await f.page.locator('#dtMessages').innerText(),/RESEARCH bob bob-authorized-research/);
  assert.deepEqual(f.errors,[]);
});

test('F03 AI close aborts speech recognition and detaches late result callbacks',async t=>{
  const f=await fixture(t);
  await f.page.evaluate(()=>{
    window.fixtureSpeech={starts:0,aborts:0};window.SpeechRecognition=class{constructor(){window.fixtureRecognition=this;}start(){fixtureSpeech.starts++;}stop(){this.onend?.();}abort(){fixtureSpeech.aborts++;this.onend?.();}};
  });
  await wireAiChat(f.page);await f.page.locator('#aiChatVoiceBtn').click();
  await f.page.evaluate(()=>{window.oldSpeechResult=fixtureRecognition.onresult;__xtjAiAgent.close();});
  assert.equal(await f.page.evaluate(()=>fixtureSpeech.aborts),1);
  assert.equal(await f.page.evaluate(()=>fixtureRecognition.onresult),null);
  await wireAiChat(f.page);
  await f.page.evaluate(()=>oldSpeechResult({results:[[{transcript:'LATE VOICE SECRET'}]]}));
  assert.equal(await f.page.locator('#aiChatMsgInput').inputValue(),'');
  await f.page.locator('#aiChatVoiceBtn').click();
  await f.page.evaluate(()=>fixtureRecognition.onresult({results:[[{transcript:'AUTHORIZED VOICE INPUT'}]]}));
  assert.equal(await f.page.locator('#aiChatMsgInput').inputValue(),'AUTHORIZED VOICE INPUT');
  assert.deepEqual(f.errors,[]);
});

test('F04 logout terminates transcription and same-account relogin rejects the previous job',async t=>{
  const f=await fixture(t);
  await f.page.evaluate(()=>{
    window.fixtureVoice={terminated:0,results:[]};
    window.AudioContext=class{async decodeAudioData(){return {duration:1};}async close(){}};
    window.OfflineAudioContext=class{createBufferSource(){return {connect(){},start(){}};}async startRendering(){return {getChannelData:()=>new Float32Array(16000)};}};
    window.Worker=class{constructor(){window.fixtureWorker=this;}postMessage(data){this.data=data;}terminate(){fixtureVoice.terminated++;}};
  });
  await f.page.addScriptTag({url:f.origin+'/js/voice-transcription.js'});
  await f.page.evaluate(()=>XTJVoiceTranscription.enqueue({owner:currentUser,peer:'charlie',id:'voice-fixture',sent:false,file:{size:12,arrayBuffer:async()=>new ArrayBuffer(12)},onResult:text=>fixtureVoice.results.push(text)}));
  await f.page.waitForFunction(()=>!!window.fixtureWorker?.data);
  await f.page.evaluate(()=>{window.oldVoiceWorker=fixtureWorker;window.oldVoiceResult=fixtureWorker.onmessage;});
  await f.page.evaluate(()=>doLogout());
  assert.ok(await f.page.evaluate(()=>fixtureVoice.terminated)>0);
  assert.equal(await f.page.evaluate(()=>oldVoiceWorker.onmessage),null);
  await loginAs(f,'alice');
  await f.page.evaluate(()=>oldVoiceResult({data:{id:oldVoiceWorker.data.id,type:'result',text:'OLD SESSION TRANSCRIPT'}}));
  await f.page.evaluate(()=>XTJVoiceTranscription.enqueue({owner:currentUser,peer:'charlie',id:'new-voice-fixture',sent:false,file:{size:12,arrayBuffer:async()=>new ArrayBuffer(12)},onResult:text=>fixtureVoice.results.push(text)}));
  await f.page.waitForFunction(()=>fixtureWorker!==oldVoiceWorker&&!!fixtureWorker.data);
  await f.page.evaluate(()=>fixtureWorker.onmessage({data:{id:fixtureWorker.data.id,type:'result',text:'NEW SESSION TRANSCRIPT'}}));
  await f.page.waitForFunction(()=>fixtureVoice.results.length===1);
  assert.deepEqual(await f.page.evaluate(()=>fixtureVoice.results),['NEW SESSION TRANSCRIPT']);
  await f.page.evaluate(()=>XTJVoiceTranscription.reset());assert.deepEqual(f.errors,[]);
});

test('F05 successful empty refresh clears old posts while an actual failure preserves them',async t=>{
  const f=await fixture(t);assert.equal(await f.page.locator('#feed .post').count(),1);
  await f.page.evaluate(id=>openPostDetail(id),f.posts[0].id);
  await f.page.route('**/api/feed*',route=>route.fulfill({status:503,json:{ok:false,error:'temporary fixture failure',retryable:true}}));
  await f.page.route('**/test-supabase/rest/**',route=>route.fulfill({status:503,json:{message:'temporary fixture database failure'}}));
  await f.page.evaluate(()=>loadFeed(true));assert.equal(await f.page.locator('#feed .post').count(),1);
  assert.ok(await f.page.evaluate(()=>!!window.__xtjPostDetailSnapshot));
  await f.page.unroute('**/api/feed*');await f.page.unroute('**/test-supabase/rest/**');f.posts.splice(0);
  await f.page.evaluate(()=>loadFeed(true));assert.equal(await f.page.locator('#feed .post').count(),0);
  assert.equal(await f.page.evaluate(()=>window.__xtjPostDetailSnapshot),null);
  assert.equal(await f.page.locator('#postDetailBody').innerText(),'');
  assert.match(await f.page.locator('#feed').innerText(),/发布第一条动态/);assert.deepEqual(f.errors,[]);
});

test('F06 photo wall preserves structured errors and shows retry only for retryable failures',async t=>{
  const f=await fixture(t);
  let retryable=false;
  await f.page.route('**/api/photos/public*',route=>route.fulfill({status:retryable?503:402,json:{ok:false,code:retryable?'temporary':'egress_quota_exceeded',retryable,error:retryable?'临时故障，请重试':'数据服务受限，请等待恢复'}}));
  await f.page.evaluate(()=>ensurePhotoWallLoaded());await f.page.waitForFunction(()=>typeof initPhotoWall==='function'&&typeof renderPhotoWall==='function');
  await f.page.evaluate(async()=>{switchDockTab('ai',true);await initPhotoWall(true);await loadPhotoWallData(true);});
  assert.match(await f.page.locator('#photoGrid').innerText(),/数据服务受限，请等待恢复/,await f.page.evaluate(()=>photoWallLoadError?.stack));
  assert.equal(await f.page.locator('#photoGrid button').count(),0);
  assert.ok(await f.page.evaluate(()=>window.__xtjServiceRestrictedUntil||0)>0);
  assert.deepEqual(await f.page.evaluate(()=>({status:photoWallLoadError.status,code:photoWallLoadError.code,retryable:photoWallLoadError.retryable})),{status:402,code:'egress_quota_exceeded',retryable:false});
  retryable=true;await f.page.evaluate(()=>loadPhotoWallData(true));
  assert.equal(await f.page.locator('#photoGrid button').count(),1);assert.deepEqual(f.errors,[]);
});
