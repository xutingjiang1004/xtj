'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{adminPostPayload,mediaGatewayUrl}=require('../render-api/admin-operations');
const root=path.resolve(__dirname,'..'),origin='https://xtj-admin-fixes.invalid',storageOrigin='https://storage.test';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ZQAAAAASUVORK5CYII=','base64');
const uuid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',now=new Date().toISOString();
const raw=name=>storageOrigin+'/storage/v1/object/public/uploads/posts/'+name+'.png';
const tabs=['ann','stats','users','security','audit','behavior','errorlog','posts','likes','comments','reports','bans','mutes','support','photos','email','online','profile','ai'];
const options={headless:true,args:['--no-sandbox'],executablePath:process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)};
async function fixturePage(browser,state={}){
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],calls=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),p=url.pathname;calls.push({path:p,query:url.search,origin:url.origin,method:request.method()});
  if(url.origin!==origin)return route.fulfill({status:404,body:'isolated fixture'});
  if(p==='/js/config.min.js')return route.fulfill({contentType:'application/javascript',body:'window.XTJ_CONFIG='+JSON.stringify({API_BASE:origin})+';'});
  if(p.startsWith('/admin/') || p.startsWith('/api/')){
   if(p.startsWith('/api/photo/') || p==='/api/uploads/media')return route.fulfill({contentType:'image/png',body:png});
   var status=200,body={ok:true,data:[],users:[],daily:[],records:[],recipients:[],list:[],total:0};
   if(p==='/admin/login')body={ok:true,user_token:'fixture-user-token'};
   if(p==='/admin/verify' && state.verifyFailure){status=503;body={ok:false,code:'database_unavailable',retryable:true,error:'会话验证暂不可用'};}
   if(p==='/admin/data')body={posts:[adminPostPayload({id:uuid,user_name:'alice',media_type:'image',media_url:raw('first'),media_items:[{media_type:'image',media_url:raw('first')},{media_type:'image',media_url:raw('second')}],content:'审核多图帖子',created_at:now,views:1},storageOrigin)],likes:[{id:1,user_name:'bob',post_id:uuid,created_at:now}],comments:[{id:1,user_name:'bob',post_id:uuid,content:'评论',created_at:now}],bans:[],announcements:[]};
   if(p==='/admin/users')body={data:[{user_name:'alice',content:JSON.stringify({reg_time:now,auth_created_at:now,email:'alice@example.invalid'}),created_at:now},{user_name:'silent',content:JSON.stringify({reg_time:now,auth_created_at:now}),created_at:now}]};
   if(p==='/admin/photos')body={data:[{id:uuid,user_name:'alice',media_url:'/api/photo/'+uuid+'/media',content:JSON.stringify({thumb:'/api/photo/'+uuid+'/media',fileSize:100}),created_at:now}]};
   if(p==='/admin/photos' && state.photosFailure){status=402;body={ok:false,code:'egress_quota_exceeded',retryable:false,error:'数据服务暂时受限，请等待恢复'};}
   if(p==='/admin/security-settings')body={ok:true,settings:{record_device:false,browser_fingerprint:false,canvas_fingerprint:false,webgl_fingerprint:false,webrtc_local_ip:false,advanced_fingerprint:false,security_alerts:true}};
   if(p==='/admin/users/register-alerts')body={ok:true,unread_count:0,users:[]};
   if(p.startsWith('/api/avatar/public'))body={ok:true,avatar_url:mediaGatewayUrl(raw('avatar'),storageOrigin)};
   if(p==='/admin/author-support')body={ok:true,wechat_url:null,alipay_url:null,disclaimer:'自愿打赏'};
   if(p==='/admin/stats/online')body={online_count:0,users:[],device_stats:{}};
   if(p==='/admin/ai-agent/config')body={ok:true,config:{name:'小猫',avatar:'🐱',avatar_url:mediaGatewayUrl(raw('ai-avatar'),storageOrigin),model:{reasoner_model:'deepseek-v4-flash-vision-exp'}}};
   if(p==='/admin/ai-agent/effective-prompt')body={ok:true,core_prompt:'实际配置的提示词'};
   if(p==='/admin/ai-agent/usage-summary')body={ok:true,summary:{},currency:'CNY'};
   if(p==='/admin/ai-agent/users')body={ok:true,users:[{user_name:'alice',message_count:3}],window_days:30};
   if((p==='/admin/ai-agent/users'||p==='/admin/ai-agent/usage-summary') && state.aiUsageFailure){status=state.aiUsageFailure===503?503:402;body={ok:false,code:status===402?'egress_quota_exceeded':'database_unavailable',retryable:status!==402,error:'数据服务暂时受限，请等待恢复'};}
   if(p==='/admin/ai-agent/conversations')body={ok:true,conversations:[{conversation_id:'conv-1234',message_count:2,created_at:now,last_at:now}]};
   if(p==='/admin/ai-agent/conversations' && state.aiConvsFailure){status=503;body={ok:false,code:'database_unavailable',retryable:true,error:'会话暂不可用'};}
   if(p==='/admin/ai-agent/conversation')body=url.searchParams.has('before_id')?{ok:true,messages:[{id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',role:'user',content:'更早消息',created_at:'2026-10-10T01:00:00.123456+00:00'}]}:{ok:true,messages:[{id:uuid,role:'assistant',content:'最新消息',created_at:now}],next_cursor:{before_id:uuid,before_at:'2026-10-11T01:00:00.123456+00:00'}};
   if(p==='/admin/ai-agent/conversation' && state.aiDetailFailure){status=503;body={ok:false,code:'database_unavailable',retryable:true,error:'消息暂不可用'};}
   if(p==='/admin/users-with-email')body={users:[{user_name:'alice',email:'alice@example.invalid'},{user_name:'bob',email:'bob@example.invalid'}]};
   if(p==='/admin/send-email'){
    const payload=request.postDataJSON();(state.mailRequests ||= []).push(payload);
    if(state.mailRequests.length===1){status=207;body={ok:false,partial:true,status:'completed',request_id:payload.request_id,sent_count:1,failed_count:1,unknown_count:0,pending_count:0,recipients_detail:payload.recipients.map((r,i)=>({...r,status:i===0?'sent':'failed'}))};}
    else body={ok:false,status:'uncertain',request_id:payload.request_id,sent_count:0,failed_count:0,unknown_count:1,pending_count:0,recipients_detail:payload.recipients.map(r=>({...r,status:'unknown'}))};
   }
   if(p==='/admin/cleanup-logs'){status=207;body={ok:false,partial:true,total_succeeded:9,total_failed:1,results:[{operation:'login',succeeded:9,failed:1}]};}
   return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  }
  const file=path.join(root,p==='/'?'admin.html':p.slice(1));if(!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:'missing'});
  const ext=path.extname(file);return route.fulfill({body:fs.readFileSync(file),contentType:ext==='.html'?'text/html':ext==='.js'?'application/javascript':ext==='.css'?'text/css':'image/svg+xml'});
 });
 return {page,errors,calls};
}
async function login(page){await page.goto(origin+'/admin.html');await page.fill('#loginName','xxz');await page.fill('#loginPw','fixture-password');await page.click('#adminLoginForm button');await page.waitForSelector('#dashboard',{state:'visible'});}
async function switchTab(page,tab){await page.evaluate(tab=>window.switchTab(tab),tab);await page.waitForFunction(tab=>{const id=tab==='errorlog'?'ErrorLog':tab[0].toUpperCase()+tab.slice(1),el=document.getElementById('tab'+id);return el && el.textContent.length>0 && !el.hasAttribute('aria-busy');},tab);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
test('actual administrator minified UI covers every main tab and AI subtab, private album thumbnails, failure state and safe mail outcomes',{timeout:60000},async()=>{
 const browser=await chromium.launch(options);try{
  const state={},f=await fixturePage(browser,state),page=f.page;await login(page);
  for(const tab of tabs)await switchTab(page,tab);
  await switchTab(page,'ai');for(const [sub,label] of [['invite','生成邀请码'],['users','统计时间窗'],['settings','基础信息']]){await page.evaluate(sub=>window._switchAiAdminSubTab(sub),sub);await page.waitForFunction(label=>document.getElementById('aiAdminContent').textContent.includes(label),label);}
  await page.evaluate(()=>window._switchAiAdminSubTab('users'));await page.waitForFunction(()=>document.getElementById('aiAdminContent').textContent.includes('alice'));state.aiUsageFailure=true;await page.locator('#aiUsageDaysSel').dispatchEvent('change');await page.waitForFunction(()=>document.getElementById('aiAdminContent').textContent.includes('数据加载失败'));assert.match(await page.locator('#aiAdminContent').innerText(),/alice/);assert.match(await page.locator('#aiAdminContent').innerText(),/等待服务恢复/);assert.doesNotMatch(await page.locator('#aiAdminContent').innerText(),/暂无用户 AI/);state.aiUsageFailure=false;
  await switchTab(page,'posts');await page.waitForFunction(()=>{const images=Array.from(document.querySelectorAll('#tabPosts img'));return images.length>=2 && images.every(img=>img.complete && img.naturalWidth>0);});
  const sources=await page.locator('#tabPosts img').evaluateAll(nodes=>nodes.map(n=>n.src));assert.equal(sources.filter(src=>src.includes('/api/uploads/media')).length>=2,true);assert.equal(f.calls.some(call=>call.origin===storageOrigin),false);
  await switchTab(page,'users');assert.match(await page.locator('#tabUsers').innerText(),/silent/);const directoryCalls=f.calls.filter(c=>c.path==='/admin/users').length;await page.evaluate(()=>window.refreshAdminTab('users'));assert.match(await page.locator('#tabUsers').innerText(),/silent/);assert.equal(f.calls.filter(c=>c.path==='/admin/users').length,directoryCalls+1);
  await switchTab(page,'security');assert.equal(await page.locator('#tabSecurity input[type=checkbox]').count(),1);await page.evaluate(()=>{window.confirm=()=>true;return window.cleanupOldLogs();});assert.match(await page.locator('#cleanupResult').innerText(),/9.*1/);assert.equal(await page.locator('.toast-success').filter({hasText:'清理'}).count(),0);
  await switchTab(page,'photos');state.photosFailure=true;await page.evaluate(()=>window.refreshAdminTab('photos'));await switchTab(page,'photos');assert.match(await page.locator('#tabPhotos').innerText(),/等待恢复/);assert.match(await page.locator('#tabPhotos').innerText(),/alice/);assert.equal(await page.locator('#tabPhotos button').filter({hasText:'重新加载'}).count(),0);state.photosFailure=false;await page.evaluate(()=>window.refreshAdminTab('photos'));await page.waitForFunction(()=>!document.getElementById('tabPhotos').textContent.includes('数据加载失败'));
  await page.setViewportSize({width:375,height:812});await switchTab(page,'photos');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.setViewportSize({width:1280,height:900});
  await switchTab(page,'email');await page.waitForSelector('.email-checkbox');for(const checkbox of await page.locator('.email-checkbox').all())await checkbox.check();await page.fill('#emailSubjectInp','保留草稿的主题');await page.fill('#emailContentInp','保留草稿的正文');await page.click('#emailSendBtn');await page.click('#confirmOkBtn');await page.waitForFunction(()=>document.getElementById('emailResult').textContent.includes('失败 1 人'));
  assert.equal(await page.locator('.email-checkbox:checked').count(),1);assert.equal(await page.locator('#emailContentInp').inputValue(),'保留草稿的正文');assert.equal(await page.evaluate(()=>sessionStorage.getItem('xtj_email_draft_content')),'保留草稿的正文');
  await page.click('#emailSendBtn');await page.click('#confirmOkBtn');await page.waitForFunction(()=>!!sessionStorage.getItem('xtj_email_pending_job'));await page.waitForFunction(()=>document.getElementById('emailResult').textContent.includes('待确认 1 人'));
  await page.click('#emailSendBtn');await page.click('#confirmOkBtn');await page.waitForFunction(()=>!document.getElementById('emailSendBtn').disabled);assert.equal(state.mailRequests[1].request_id,state.mailRequests[2].request_id);
  await page.evaluate(()=>window.emailClearDraft());assert.ok(await page.evaluate(()=>sessionStorage.getItem('xtj_email_pending_job')));assert.deepEqual(f.errors,[]);
 }finally{await browser.close();}
});
test('actual administrator session restore retains its marker through 503 and recovers on a retry without re-entering a password',{timeout:30000},async()=>{
 const browser=await chromium.launch(options);try{
  const state={verifyFailure:true},f=await fixturePage(browser,state),page=f.page;
  await page.addInitScript(()=>localStorage.setItem('xtj_admin_session',JSON.stringify({t:Date.now()})));await page.goto(origin+'/admin.html');await page.waitForFunction(()=>document.getElementById('loginErr').textContent.includes('保留登录状态'));
  assert.ok(await page.evaluate(()=>localStorage.getItem('xtj_admin_session')));state.verifyFailure=false;await page.locator('#loginErr button').click();await page.waitForSelector('#dashboard',{state:'visible'});assert.deepEqual(f.errors,[]);
 }finally{await browser.close();}
});
test('retained AI views keep time-window, user, conversation and older-message actions after failed refreshes',{timeout:60000},async()=>{
 const browser=await chromium.launch(options);try{
  const state={},f=await fixturePage(browser,state),page=f.page;await login(page);await switchTab(page,'ai');await page.evaluate(()=>window._switchAiAdminSubTab('users'));await page.waitForSelector('#aiUsageDaysSel');
  state.aiUsageFailure=true;await page.locator('#aiUsageDaysSel').dispatchEvent('change');await page.waitForFunction(()=>document.getElementById('aiAdminContent').textContent.includes('数据加载失败'));state.aiUsageFailure=false;
  const windowRequest=page.waitForRequest(request=>{const u=new URL(request.url());return u.pathname==='/admin/ai-agent/users' && u.searchParams.get('days')==='7';},{timeout:5000});await page.locator('#aiUsageDaysSel').selectOption('7');await windowRequest;await page.waitForFunction(()=>!document.getElementById('aiAdminContent').textContent.includes('数据加载失败') && document.getElementById('aiUsageDaysSel')?.value==='7');
  state.aiUsageFailure=503;await page.locator('#aiUsageDaysSel').dispatchEvent('change');await page.waitForFunction(()=>document.getElementById('aiAdminContent').textContent.includes('数据加载失败'));state.aiUsageFailure=false;
  const userRequest=page.waitForRequest(request=>{const u=new URL(request.url());return u.pathname==='/admin/ai-agent/conversations' && u.searchParams.get('user_name')==='alice';},{timeout:5000});await page.locator('.ai-conv-users-list li').click();await userRequest;await page.waitForSelector('.ai-conversation-item');await page.locator('.ai-conversation-item').click();await page.waitForSelector('#aiAdminOlderMessages');await page.locator('#aiAdminContent .ai-admin-back').click();await page.waitForSelector('.ai-conversation-item');
  state.aiConvsFailure=true;await page.evaluate(()=>window._backAiConvList());await page.waitForFunction(()=>document.getElementById('aiAdminContent').textContent.includes('数据加载失败'));state.aiConvsFailure=false;
  const convRequest=page.waitForRequest(request=>{const u=new URL(request.url());return u.pathname==='/admin/ai-agent/conversation' && u.searchParams.get('user_name')==='alice' && u.searchParams.get('conversation_id')==='conv-1234';},{timeout:5000});await page.locator('.ai-conversation-item').click();await convRequest;await page.waitForSelector('#aiAdminOlderMessages');
  state.aiDetailFailure=true;await page.locator('#aiAdminOlderMessages').click();await page.waitForFunction(()=>document.getElementById('aiAdminContent').textContent.includes('数据加载失败'));await page.waitForFunction(()=>!document.getElementById('aiAdminOlderMessages').disabled);state.aiDetailFailure=false;
  const olderRequest=page.waitForRequest(request=>{const u=new URL(request.url());return u.pathname==='/admin/ai-agent/conversation' && u.searchParams.get('before_id')===uuid && u.searchParams.get('before_at')==='2026-10-11T01:00:00.123456+00:00';},{timeout:5000});await page.locator('#aiAdminOlderMessages').click();await olderRequest;await page.waitForFunction(()=>document.getElementById('aiAdminContent').textContent.includes('更早消息'));assert.match(await page.locator('#aiAdminContent').innerText(),/最新消息/);assert.deepEqual(f.errors,[]);
 }finally{await browser.close();}
});
