'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/core-parts/06-chat-and-nav.js','utf8');
function extract(start,end){const a=source.indexOf(start);return source.slice(a,source.indexOf(end,a));}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function sendFixture(){
 const calls=[],input={value:'private draft'},c={currentUser:'A',_authStateEpoch:1,_chatSendFlight:null,_chatHistoryFocus:'',_chatRecordedFile:null,_chatVoice:null,_chatEditDraft:null,_chatReplyDraft:null,_dockChatDraftTimer:null,dockChatActiveUser:'peer',dockChatSending:false,_chatSendFlights:new Map(),_chatCommittedRevision:0,_chatCache:{},_chatRenderSignature:{},DM_MARKER:'__dm__',AbortController,Date,Math,URL:{createObjectURL(){return 'blob:local';},revokeObjectURL(){}},document:{getElementById(id){return id==='dockChatInput'?input:{files:[]};},querySelector(){return null;}},console:{warn(){}}};
 for(const name of ['showToast','sendDockChatTyping','renderDockMessages','animateDockChatSend','applyDockChatConversationPreview','clearDockChatFilePreview','touchUserSession','setDockChatUploadProgress','persistDockChatDraft'])c[name]=(...args)=>calls.push({name,args});
 Object.assign(c,{isUserMuted:()=>false,normalizeDockChatMediaFile:f=>f,isBlockedDmFile:()=>false,getChatUploadKind:f=>f.type.split('/')[0],isDmOriginalSendEnabled:()=>false,captureDockChatSendOrigin:()=>null,buildDMMessageContent:(m,p)=>JSON.stringify(p),getDMMessagePayload:m=>JSON.parse(m.content),getDockChatCacheKey:p=>c.currentUser+':'+p,upsertDockChatCacheMessage(p,m){calls.push({name:'cache',owner:c.currentUser,message:m});return[m];},replaceDockChatCacheMessage(p,t,m){calls.push({name:'cache',owner:c.currentUser,message:m});},releaseDockChatLocalPreview(){},buildDmStorageUploadPath:async()=> 'private-path',uploadDmMediaWithProgress:async()=>{calls.push({name:'upload'});return{storage_path:'private-path'};}});
 c.window={get currentUser(){return c.currentUser;},xtjProtectedFetch:async()=>{calls.push({name:'send'});return{ok:true,json:async()=>({ok:true,message:{id:'server',content:'{}'}})};}};
 c._chatContextSeq=0;c._dockChatLocalDrafts={};Object.defineProperty(c.window,'_authStateEpoch',{get(){return c._authStateEpoch;}});
 vm.createContext(c);vm.runInContext(extract('            function rememberDockChatDraft(', '            function persistDockChatDraft('),c);vm.runInContext(extract('            async function sendDockChatMessageSingle(', '            // ═════'),c);return{c,calls,input};
}
test('delivery acknowledgement leaves the next selected attachment intact',async()=>{
 const f=sendFixture(),d=deferred();f.c.window.xtjProtectedFetch=async()=>({ok:true,json:()=>d.promise});
 const pending=f.c.sendDockChatMessageSingle(null,'first message');await new Promise(r=>setImmediate(r));
 const before=f.calls.length;d.resolve({ok:true,message:{id:'server',content:'{}'}});await pending;
 assert.equal(f.calls.slice(before).filter(x=>x.name==='clearDockChatFilePreview').length,0);
 assert.equal(f.c._dockChatLocalDrafts['A\u0000peer'].value,'');
});
test('retrying a failed text does not send or discard the next draft attachment',async()=>{
 const f=sendFixture(),next={name:'next.png',size:10,type:'image/png'},bodies=[];
 f.c._chatRecordedFile=next;f.c.prepareDmImageForUpload=async file=>({file});f.c.getMediaUrl=()=> 'https://storage.invalid/next';
 f.c.window.xtjProtectedFetch=async(path,options)=>{bodies.push(JSON.parse(options.body));return{ok:true,json:async()=>({ok:true,message:{id:'server',content:'{}'}})};};
 await f.c.sendDockChatMessageSingle(null,'failed text',{isRetry:true,clientMessageId:'stable',replyDraft:null});
 assert.equal(bodies.length,1);assert.equal(bodies[0].storage_path,undefined);assert.equal(f.c._chatRecordedFile,next);
 assert.equal(f.input.value,'private draft');
});
test('retry action leaves composer text and quote intact and reuses the original quote',async()=>{
 const failed={id:'old',__tempId:'old',__failed:true,__clientMessageId:'stable',content:JSON.stringify({text:'failed text',reply_to:{id:'original-quote'}})};
 const input={value:'new draft'},quote={id:'new-quote'},calls=[];
 const c={currentUser:'A',_authStateEpoch:1,dockChatActiveUser:'peer',dockChatSending:false,
  _chatReplyDraft:quote,_chatCache:{peer:[failed]},_chatRenderSignature:{},
  document:{getElementById:id=>id==='dockChatInput'?input:{files:[]}},window:{currentUser:'A'},
  getDMMessagePayload:m=>JSON.parse(m.content),getDMMessageText:m=>JSON.parse(m.content).text,
  getDockChatCacheKey:()=> 'peer',isUserMuted:()=>false,showToast(){},renderDockMessages(){},releaseDockChatLocalPreview(){},
  sendDockChatMessageSingle:async(file,text,options)=>{calls.push({file,text,options,input:input.value});c._chatCache.peer.push({id:'server'});return{queued:true};}};
 vm.createContext(c);vm.runInContext(extract('            async function resendDmMessage(', '            // Search uses server keyset pagination'),c);
 await c.resendDmMessage(failed);assert.equal(calls[0].input,'new draft');assert.equal(input.value,'new draft');
 assert.equal(c._chatReplyDraft,quote);assert.equal(calls[0].options.replyDraft.id,'original-quote');
 assert.equal(calls[0].options.clientMessageId,'stable');assert.equal(c._chatCache.peer.some(x=>x.id==='old'),false);
});
test('an idempotent delivery acknowledgement deduplicates an already-polled server message',()=>{
 const c={_chatCache:{peer:[{id:'server',content:'{"text":"saved","read_at":"2026-10-12T08:00:00Z"}'},{id:'temp',__tempId:'temp',content:'{"text":"saved"}'}]},
  getDockChatCacheKey:()=> 'peer',getDMMessagePayload:m=>JSON.parse(m.content),sortDockChatMessages:m=>m,window:{}};
 vm.createContext(c);vm.runInContext(extract('            function reconcileDockChatMessage(', '            function removeDockChatCacheMessage('),c);
 const rows=c.replaceDockChatCacheMessage('peer','temp',{id:'server',content:'{"text":"saved"}'});
 assert.equal(rows.length,1);assert.equal(rows[0].id,'server');assert.equal(JSON.parse(rows[0].content).read_at,'2026-10-12T08:00:00Z');
});
test('a stale snapshot never restores withdrawn message content or an older edit',()=>{
 const c={_chatCache:{peer:[]},getDockChatCacheKey:p=>p,sortDockChatMessages:m=>m,
  getDMMessagePayload:m=>{try{return JSON.parse(m.content);}catch(_){return null;}},isDockChatLocalPendingMessage:()=>false};
 vm.createContext(c);vm.runInContext(extract('            function mergeDockChatMessages(', '            function upsertDockChatCacheMessage('),c);
 const old={id:'message',created_at:'2026-10-12T08:00:00Z',content:JSON.stringify({text:'secret',read_at:null})};
 c._chatCache.peer=[{...old,content:JSON.stringify({withdrawn:true,text:'',read_at:'2026-10-12T08:01:00Z'})}];
 assert.equal(JSON.parse(c.mergeDockChatMessages('peer',[old],0)[0].content).withdrawn,true);
 assert.equal(JSON.parse(c.mergeDockChatMessages('peer',[{...old,content:'legacy private text'}],0)[0].content).withdrawn,true);
 c._chatCache.peer=[{...old,content:JSON.stringify({text:'corrected',edited_at:'2026-10-12T08:02:00Z',read_at:'2026-10-12T08:01:00Z'})}];
 const merged=JSON.parse(c.mergeDockChatMessages('peer',[old],0)[0].content);
 assert.equal(merged.text,'corrected');assert.equal(merged.read_at,'2026-10-12T08:01:00Z');
});
test('late read receipts from a previous authentication epoch cannot restore withdrawn content',async()=>{
 const d=deferred(),fresh={id:'message',content:JSON.stringify({withdrawn:true,text:''})};
 const c={_authStateEpoch:1,dockChatActiveUser:'peer',_chatCache:{peer:[fresh]},getDockChatCacheKey:()=> 'peer',
  reconcileDockChatMessage:()=>{throw Error('old receipt must be discarded');},renderDockMessages(){},scheduleDockChatListRefresh(){},updateUnreadBadge(){},Map,Array};
 c.window={currentUser:'A',xtjProtectedFetch:async()=>({ok:true,json:()=>d.promise})};vm.createContext(c);
 const stats=fs.readFileSync('js/core-parts/05-feed-stats.js','utf8'),a=stats.indexOf('            async function markMessagesRead('),b=stats.indexOf('            window.markMessagesRead =',a);
 vm.runInContext(stats.slice(a,b),c);const task=c.markMessagesRead('peer',[],[{id:'message'}]);c._authStateEpoch+=2;
 d.resolve({ok:true,data:[{id:'message',content:'old private text'}]});await task;
 assert.equal(c._chatCache.peer[0],fresh);
});
test('editing response from a previous login cannot overwrite the new draft or unlock its send',async()=>{
 const d=deferred(),calls=[],input={value:'new private draft'};
 const c={currentUser:'A',_authStateEpoch:1,AbortController,dockChatActiveUser:'peer',dockChatSending:false,
  _chatEditDraft:{owner:'A',peer:'peer',id:'old'},_chatCache:{},_chatRenderSignature:{},
  chatFeatureApi:()=>d.promise,showToast:x=>calls.push(x),replaceDockChatCacheMessage:()=>calls.push('replace'),
  renderDockMessages(){},getDockChatCacheKey:()=>'',clearChatMessageDraft:()=>calls.push('clear'),
  document:{getElementById:()=>input}};
 c.window={get currentUser(){return c.currentUser;}};vm.createContext(c);
 vm.runInContext(extract('            async function sendChatEditedMessage(', '            async function setChatReaction('),c);
 const pending=c.sendChatEditedMessage('old edit');c._authStateEpoch+=2;
 c._chatEditDraft={owner:'A',peer:'peer',id:'new'};c.dockChatSending=true;
 d.resolve({message:{id:'old',content:'{}'}});await pending;
 assert.deepEqual(calls,[]);assert.equal(input.value,'new private draft');assert.equal(c.dockChatSending,true);
});
test('image preparation resumed after A→B→A cannot upload or mutate the new session',async()=>{const f=sendFixture(),d=deferred();f.c.prepareDmImageForUpload=()=>d.promise;const promise=f.c.sendDockChatMessageSingle({name:'private.jpg',size:10,type:'image/jpeg'},'secret');f.c.currentUser='B';f.c._authStateEpoch++;f.c.currentUser='A';f.c._authStateEpoch++;f.c._chatSendFlight={newFlight:true};f.c.dockChatSending=true;const before=f.calls.length;d.resolve({file:{name:'ready.jpg',size:5,type:'image/jpeg'},w:2,h:2});await promise;assert.equal(f.calls.slice(before).filter(x=>['upload','send','cache','clearDockChatFilePreview'].includes(x.name)).length,0);assert.equal(f.c.dockChatSending,true);});
test('late response body from account A never enters account B cache or unlocks its send',async()=>{const f=sendFixture(),d=deferred();f.c.window.xtjProtectedFetch=async()=>({ok:true,json:()=>d.promise});const promise=f.c.sendDockChatMessageSingle(null,'secret');await new Promise(r=>setImmediate(r));f.c.currentUser='B';f.c._authStateEpoch++;f.c._chatSendFlight={newFlight:true};const before=f.calls.length;d.resolve({ok:true,message:{id:'server',content:'{}'}});await promise;assert.equal(f.calls.slice(before).filter(x=>x.name==='cache').length,0);assert.equal(f.c.dockChatSending,true);});
test('empty stale snapshot retains only messages committed after read start',()=>{const c={_chatCache:{peer:[{id:'old',__committedRevision:1},{id:'new',__committedRevision:3}]},getDockChatCacheKey:p=>p,sortDockChatMessages:m=>m,isDockChatLocalPendingMessage:()=>false};vm.createContext(c);vm.runInContext(extract('            function mergeDockChatMessages(', '            function upsertDockChatCacheMessage('),c);assert.deepEqual(Array.from(c.mergeDockChatMessages('peer',[],2),m=>m.id),['new']);assert.equal(c.mergeDockChatMessages('peer',[],3).length,0);});
test('XHR 401 awaiting refresh refuses replacement identity token and progress',async()=>{const d=deferred(),requests=[],progress=[],c={currentUser:'A',_authStateEpoch:1,Promise,Error,encodeURIComponent,window:{API_BASE:'',ensureProtectedOperationAuth:async()=>({ok:true,token:'A-token'}),refreshUserToken:()=>d.promise},XMLHttpRequest:class{constructor(){this.upload={};requests.push(this);}open(){}setRequestHeader(){}send(){}abort(){this.onabort?.();}}};vm.createContext(c);vm.runInContext(extract('            function uploadDmMediaWithProgress(', '            // ★ 2026-09-25：muteLoadingSkeleton'),c);const promise=c.uploadDmMediaWithProgress('path','image',{type:'image/jpeg'},(...x)=>progress.push(x));const rejection=assert.rejects(promise,e=>e.code==='identity_changed');await new Promise(r=>setImmediate(r));requests[0].status=401;requests[0].responseText='{}';requests[0].onload();c.currentUser='B';c._authStateEpoch++;requests[0].upload.onprogress({lengthComputable:true,loaded:1,total:2});d.resolve('B-token');await rejection;assert.equal(requests.length,1);assert.equal(progress.length,0);});
test('SSE accepts CR-only and CRLF split across chunks without duplicate dispatch',async()=>{const c={window:{},TextDecoder,URL,Promise};vm.createContext(c);vm.runInContext(fs.readFileSync('js/ai-core/transport.js','utf8'),c);for(const chunks of [['event: delta\rdata: first\r\revent: delta\rdata: second\r\r'],['data: one\r','\n\r','\ndata: two\r','\n\r','\n']]){const events=[];const body=new ReadableStream({start(controller){chunks.forEach(x=>controller.enqueue(new TextEncoder().encode(x)));controller.close();}});await c.window.XtjAiCore.Transport.readSSEStream({body},e=>events.push(e));assert.deepEqual(events.map(e=>e.data),chunks.length===1?['first','second']:['one','two']);}});
test('multi-window push suppression matches the visible client peer rather than unrelated visible page',async()=>{const handlers={},shown=[],clients=[{id:'chat',url:'https://xtj.test/',visibilityState:'hidden'},{id:'home',url:'https://xtj.test/',visibilityState:'visible'}];let state={owner:'A',clients:{chat:{owner:'A',peer:'P'},home:{owner:'A',peer:''}}};const c={self:{location:{origin:'https://xtj.test'},addEventListener:(k,f)=>handlers[k]=f,clients:{matchAll:async()=>clients},registration:{showNotification:async(t,n)=>shown.push(n)}},caches:{open:async()=>({match:async()=>new Response(JSON.stringify(state)),put:async(u,r)=>state=await r.json()})},Response,URL,Set};vm.createContext(c);c.Request=Request;c.Headers=Headers;c.importScripts=file=>vm.runInContext(fs.readFileSync(require('node:path').join(process.cwd(),file),'utf8'),c);vm.runInContext(fs.readFileSync('chat-notifications-sw.js','utf8'),c);const push=async()=>{let p;handlers.push({data:{json:()=>({type:'chat-message',owner:'A',peer:'P',id:'id'})},waitUntil:x=>p=x});await p;};await push();assert.equal(shown.length,1);clients[0].visibilityState='visible';await push();assert.equal(shown.length,1);let p;handlers.message({source:clients[0],data:{type:'XTJ_CHAT_PUSH_STATE',owner:'B',peer:'P'},waitUntil:x=>p=x});await p;assert.equal(state.clients.chat.owner,'B');assert.equal(state.clients.home.owner,'A');});
test('pending push synchronization reruns for account B after delayed A config finishes',async()=>{const d=deferred(),posts=[],subscriptions=[],registration={active:{postMessage:m=>posts.push(m)},pushManager:{getSubscription:async()=>({options:{},toJSON:()=>({endpoint:'test'})})}},storage=new Map([['xtj_chat_push_A','on'],['xtj_chat_push_B','on']]);const c={currentUser:'A',_authStateEpoch:1,currentDockTab:'chat',dockChatActiveUser:'P',localStorage:{getItem:k=>storage.get(k)},navigator:{serviceWorker:{getRegistration:async()=>registration,register:async()=>registration,ready:Promise.resolve(registration)}},Notification:{permission:'granted'},Uint8Array,Promise,btoa:x=>Buffer.from(x).toString('base64'),atob:x=>Buffer.from(x,'base64').toString(),window:{}};c.window={isSecureContext:true,PushManager:class{},Notification:c.Notification,get currentUser(){return c.currentUser;},xtjProtectedFetch:async(path,opts)=>{if(path.endsWith('/config') && opts.authOwner==='A')return d.promise;if(path.endsWith('/subscribe'))subscriptions.push(opts.authOwner);return{ok:true,json:async()=>({ok:true,public_key:'YQ=='})};},__xtjSyncChatPush:()=>{c.followup=c.syncChatPushState();}};vm.createContext(c);vm.runInContext(extract('            var _chatPushSyncing=', '            async function toggleChatPush()'),c);const first=c.syncChatPushState();await new Promise(r=>setImmediate(r));c.currentUser='B';c._authStateEpoch++;await c.syncChatPushState();d.resolve({ok:true,json:async()=>({ok:true,public_key:'YQ=='})});await first;await c.followup;assert.deepEqual(subscriptions,['B']);assert.equal(posts.at(-1).owner,'B');});
