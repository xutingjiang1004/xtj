'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{adminPostPayload,mediaGatewayUrl}=require('../render-api/admin-operations');
const root=path.resolve(__dirname,'..'),origin='https://xtj-admin-fixes.invalid',storageOrigin='https://storage.test';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ZQAAAAASUVORK5CYII=','base64');
const uuid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',now=new Date().toISOString();
const raw=name=>storageOrigin+'/storage/v1/object/public/uploads/posts/'+name+'.png';
const tabs=['ann','stats','users','security','audit','behavior','errorlog','posts','likes','comments','reports','bans','mutes','support','photos','email','online','profile','ai'];
const options={headless:true,args:['--no-sandbox'],executablePath:process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)};
async function screenshot(page,name,fullPage=true){const directory=process.env.XTJ_ADMIN_FIX_SCREENSHOTS;if(!directory)return;fs.mkdirSync(directory,{recursive:true});await page.screenshot({path:path.join(directory,name+'.png'),fullPage,animations:'disabled'});}
async function fixturePage(browser,state={}){
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],calls=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),p=url.pathname;calls.push({path:p,query:url.search,origin:url.origin,method:request.method()});
  if(url.origin!==origin)return route.fulfill({status:404,body:'isolated fixture'});
  if(p==='/js/config.min.js')return route.fulfill({contentType:'application/javascript',body:'window.XTJ_CONFIG='+JSON.stringify({API_BASE:origin})+';'});
  if(p.startsWith('/admin/') || p.startsWith('/api/')){
   if(state.expired && p!=='/admin/login')return route.fulfill({status:401,contentType:'text/html',body:'expired gateway response'});
   if(p.startsWith('/api/photo/') || p==='/api/uploads/media')return route.fulfill({contentType:'image/png',body:png});
   var status=200,body={ok:true,data:[],users:[],daily:[],records:[],recipients:[],list:[],total:0};
   if(p==='/admin/login')body={ok:true,user_token:'fixture-user-token'};
   if(p==='/admin/verify' && state.verifyFailure){status=503;body={ok:false,code:'database_unavailable',retryable:true,error:'会话验证暂不可用'};}
   if(p==='/admin/data')body={posts:[adminPostPayload({id:uuid,user_name:'alice',media_type:'image',media_url:raw('first'),media_items:[{media_type:'image',media_url:raw('first')},{media_type:'image',media_url:raw('second')}],content:'审核多图帖子',created_at:now,views:1},storageOrigin)],likes:[{id:1,user_name:'bob',post_id:uuid,created_at:now}],comments:[{id:1,user_name:'bob',post_id:uuid,content:'评论',created_at:now}],bans:[],announcements:[]};
   if(p==='/admin/data' && state.commentDeleted)body.comments=[];
   if(p==='/admin/users')body={data:[{user_name:'alice',content:JSON.stringify({reg_time:now,auth_created_at:now,email:'alice@example.invalid'}),created_at:now},{user_name:'silent',content:JSON.stringify({reg_time:now,auth_created_at:now}),created_at:now}]};
   if(p==='/admin/users' && state.users)body={data:state.users};
   if(p==='/admin/user-data')body=state.userData||{info:{email:'private-detail@example.invalid',last_ip:'192.0.2.10'},posts:[],likes:[],comments:[],login_events:[],behavior_events:[],security_alerts:[]};
   if(p==='/admin/reports' && state.pagedReports){
    const rows=state.pagedReports,filter=url.searchParams.get('status')||'all',filtered=rows.filter(r=>filter==='all'||r.status===filter),cursor=url.searchParams.get('before_id'),offset=cursor?filtered.findIndex(r=>r.id===cursor)+1:0,limit=Number(url.searchParams.get('limit'))||100,data=filtered.slice(offset,offset+limit),has_more=offset+data.length<filtered.length;
    body={data,total:rows.length,pending_count:rows.filter(r=>r.status==='pending').length,actioned_count:rows.filter(r=>r.status==='actioned').length,filtered_total:filtered.length,has_more,next_cursor:has_more?{before_id:data.at(-1).id,before_at:data.at(-1).created_at}:null};
    if(cursor&&state.moreFailure){status=503;body={ok:false,code:'reports_unavailable',error:'分页暂时失败，请重试',retryable:true};}
   }
   if(p.startsWith('/admin/comment/') && request.method()==='DELETE' && state.commentFailure){status=503;body={ok:false,code:'delete_not_applied',error:'评论删除未完成'};}
   if(p.startsWith('/admin/comment/') && request.method()==='DELETE' && !state.commentFailure)state.commentDeleted=true;
   if(p.startsWith('/admin/comment/') && request.method()==='DELETE' && state.auditPending)body={ok:true,audit_pending:true,audit_warning:'操作已完成，审计结果待确认，请勿重复执行',audit_request_id:uuid};
   if(p==='/admin/photos')body={data:[{id:uuid,user_name:'alice',media_url:'/api/photo/'+uuid+'/media',content:JSON.stringify({thumb:'/api/photo/'+uuid+'/media',fileSize:100}),created_at:now}]};
   if(p==='/admin/photos' && state.photosFailure){status=402;body={ok:false,code:'egress_quota_exceeded',retryable:false,error:'数据服务暂时受限，请等待恢复'};}
   if(p==='/admin/security-settings')body={ok:true,settings:{record_device:false,browser_fingerprint:false,canvas_fingerprint:false,webgl_fingerprint:false,webrtc_local_ip:false,advanced_fingerprint:false,security_alerts:true}};
   if(p==='/admin/users/register-alerts')body={ok:true,unread_count:0,users:[]};
   if(p.startsWith('/api/avatar/public'))body={ok:true,avatar_url:mediaGatewayUrl(raw('avatar'),storageOrigin)};
   if(p==='/admin/author-support')body={ok:true,wechat_url:null,alipay_url:null,disclaimer:'自愿打赏'};
   if(p==='/admin/stats')body={total_posts:21005,total_users:42,total_comments:1205,total_likes:1205,total_photos:17,total_visits:306,total_attacks:2,firewall_intercepts:1,daily_visits:{'2026-10-23':306},daily_attacks:{'2026-10-23':2},attack_types:{CORS:1,constructor:1},truncated:false,cached_at:now};
   if(p==='/admin/stats/daily')body={daily:[{date:'2026-10-23',posts:21005,comments:1205,likes:1205,new_users:42,visits:306,attacks:2}],date_range:{start:'all',end:'all'}};
   if(p==='/admin/stats/online')body={online_count:0,users:[],device_stats:{}};
   if(p==='/admin/stats/online' && state.online)body=state.online;
   if(p==='/admin/user-profile' && state.profile)body=state.profile;
   if(p==='/admin/ai-agent/config')body={ok:true,config:{name:'小猫',avatar:'🐱',avatar_url:mediaGatewayUrl(raw('ai-avatar'),storageOrigin),model:{reasoner_model:'deepseek-v4-flash-vision-exp'}}};
   if(p==='/admin/ai-agent/effective-prompt')body={ok:true,core_prompt:'实际配置的提示词'};
   if(p==='/admin/ai-agent/invite-codes')body={ok:true,list:state.inviteCodes||[]};
   if(p==='/admin/ai-agent/usage-summary')body={ok:true,window_days:url.searchParams.get('days')==='all'?'all':30,summary:{today_calls:3,today_total_tokens:9,today_cost:0.01,total_calls:3,total_tokens:9,total_users:1,total_cost:0.01,currency:'CNY'},currency:'CNY'};
   if(p==='/admin/ai-agent/users')body={ok:true,users:[{user_name:'alice',message_count:3,conversation_count:1,total_tokens:9,last_at:now}],window_days:url.searchParams.get('days')==='all'?'all':30};
   if(state.aiPartial && (p==='/admin/ai-agent/users'||p==='/admin/ai-agent/usage-summary'))Object.assign(body,{truncated:true,loaded_rows:3,matched_rows:1005});
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
test('actual administrator UI binds directory, details, online users and profile cities to the current server IP',{timeout:45000},async()=>{
 const browser=await chromium.launch(options);try{
  const ip='8.8.8.8',nextIp='1.1.1.1',before='2026-10-23T01:00:00Z',after='2026-10-23T02:00:00Z';
  const geo=(address=ip)=>({source_ip:address,country:'中国',region:'浙江',city:'湖州',text:'中国 · 浙江 · 湖州',city_confidence:'single_source',providers:['cloudflare'],resolved_at:before});
  const state={users:[{user_name:'alice',content:JSON.stringify({reg_time:before,last_login:before,last_ip:ip,last_ip_location:geo(),last_ip_location_ip:ip}),created_at:before}],
   userData:{info:{last_login:before,last_ip:ip,last_ip_location:geo(),last_ip_location_ip:ip},login_events:[]},
   online:{online_count:2,device_stats:{desktop:2},users:[{user_name:'alice',ip,ip_location:geo(),last_active:now},{user_name:'bob',ip:nextIp,ip_location:geo(),location:'活动城市不得回填',last_active:now}]},
   profile:{user_name:'alice',latest_ip:ip,latest_location:{...geo(),latitude:0,longitude:0},unique_ips:[],recent_logins:[],visit_trend:[],device_stats:{}}};
  const f=await fixturePage(browser,state),page=f.page;await login(page);await switchTab(page,'users');
  await page.waitForFunction(()=>document.getElementById('tabUsers').textContent.includes('湖州'));
  assert.match(await page.locator('#tabUsers').innerText(),/8\.8\.8\.8/);assert.match(await page.locator('#tabUsers').innerText(),/单一来源/);
  for(const width of [1440,375]){await page.setViewportSize({width,height:width===375?812:1000});await screenshot(page,'ip-full-directory-'+width);}
  state.userData.login_events=[{id:'new-event',user_name:'alice',created_at:after,content:JSON.stringify({ip:nextIp,login_at:after,authority:'server_authentication',method:'password',source:'login_success',ip_location:{...geo(nextIp),region:'安徽',city:'宿州',text:'中国 · 安徽 · 宿州',city_confidence:'corroborated',providers:['baidu-opendata','pconline']}})}];
  await page.evaluate(()=>window.showUserDetailModal('alice'));await page.waitForFunction(()=>document.getElementById('detailModal').textContent.includes('宿州'));
  const current=(await page.locator('#detailModal').innerText()).split('最近登录记录')[0];assert.match(current,/1\.1\.1\.1/);assert.doesNotMatch(current,/湖州|8\.8\.8\.8/);
  for(const width of [1440,375]){await page.setViewportSize({width,height:width===375?812:1000});await screenshot(page,'ip-full-newest-login-'+width);}
  state.userData={info:{},login_events:[]};await page.evaluate(()=>window.showUserDetailModal('alice'));await page.waitForFunction(()=>!document.getElementById('detailModal').textContent.includes('宿州'));
  assert.doesNotMatch((await page.locator('#detailModal').innerText()).split('最近登录记录')[0],/8\.8\.8\.8|1\.1\.1\.1|湖州|宿州/);await page.keyboard.press('Escape');
  await switchTab(page,'online');await page.waitForFunction(()=>document.getElementById('tabOnline').textContent.includes('bob'));
  const online=await page.locator('#tabOnline tbody tr').allInnerTexts();assert.match(online[0],/湖州.*单一来源/);assert.match(online[1],/未解析/);assert.doesNotMatch(online[1],/湖州|活动城市/);
  for(const width of [1440,375]){await page.setViewportSize({width,height:width===375?812:1000});await screenshot(page,'ip-full-online-'+width);}
  await page.evaluate(()=>window.loadUserProfile('alice'));await page.waitForFunction(()=>document.getElementById('tabProfile').textContent.includes('IP 估计坐标'));
  const profile=await page.locator('#tabProfile').innerText();assert.match(profile,/IP 推测地区/);assert.match(profile,/单一来源/);assert.match(profile,/0, 0/);assert.doesNotMatch(profile,/GPS 坐标/);
  for(const width of [1440,375]){await page.setViewportSize({width,height:width===375?812:1000});await screenshot(page,'ip-full-profile-'+width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  assert.deepEqual(f.errors,[]);
 }finally{await browser.close();}
});
test('administrator city ambiguity, same-named province/city and canonical IPv6 show accurate evidence',{timeout:30000},async()=>{
 const browser=await chromium.launch(options);try{
  const {selectIpLocation}=require('../render-api/ip-geolocation'),ip='8.8.8.8';
  const cn=(provider,region,city)=>({provider,country:'中国',region,city});
  const cases=[
   ['suzhou-anhui',[cn('a','安徽','宿州'),cn('b','安徽','Suzhou'),cn('c','安徽','Suzhou')],'宿州','苏州'],
   ['fuzhou-jiangxi',[cn('a','江西','抚州'),cn('b','江西','Fuzhou'),cn('c','江西','Fuzhou')],'抚州','福州'],
   ['jilin-city',[cn('a','吉林','吉林市'),cn('b','Jilin','Jilin')],'吉林市',''],
   ['province-conflict',[cn('a','浙江','杭州'),cn('b','广东','深圳'),cn('c','','Hangzhou'),cn('d','','Hangzhou')],'城市待核实','杭州']
  ];
  const state={userData:{info:{last_ip:'0:0:0:0:0:ffff:808:808',last_ip_location_ip:ip},login_events:[]}},f=await fixturePage(browser,state),page=f.page;await login(page);
  for(const [name,rows,expected,absent] of cases){
   state.userData.info.last_ip_location=selectIpLocation(rows,ip);
   await page.evaluate(()=>window.showUserDetailModal('alice'));await page.waitForFunction(text=>document.getElementById('detailModal').textContent.includes(text),expected);
   const text=await page.locator('#detailModal').innerText();assert.ok(text.includes(expected));if(absent)assert.equal(text.includes(absent),false);
   for(const width of [1440,375]){await page.setViewportSize({width,height:width===375?812:1000});await screenshot(page,'ip-deep-'+name+'-'+width);}
  }
  assert.deepEqual(f.errors,[]);
 }finally{await browser.close();}
});
test('administrator IP city evidence explains conflicts and never borrows a GPS or different login city',{timeout:30000},async()=>{
 const browser=await chromium.launch(options);try{
  const ip='8.8.8.8',location={source_ip:ip,country:'中国',region:'浙江',city:'',text:'中国 · 浙江',precision:'region',city_confidence:'conflict',providers:['baidu-opendata','pconline'],resolved_at:now};
  const state={userData:{info:{last_ip:ip,last_ip_location:location,last_ip_location_ip:ip,last_location:{address:'GPS 地址不得作为 IP 城市'}},login_events:[]}};
  const f=await fixturePage(browser,state),page=f.page;await login(page);
  await page.evaluate(()=>window.showUserDetailModal('alice'));await page.waitForFunction(()=>document.getElementById('detailModal').textContent.includes('城市待核实'));
  assert.match(await page.locator('#detailModal').innerText(),/baidu-opendata.*pconline/);
  assert.doesNotMatch(await page.locator('#detailModal').innerText(),/GPS 地址不得作为 IP 城市/);
  for(const width of [1440,375]){await page.setViewportSize({width,height:width===375?812:1000});await screenshot(page,'ip-city-conflict-'+width);}
  state.userData.info.last_ip_location={...location,city:'杭州',text:'中国 · 浙江 · 杭州',precision:'approximate_city',city_confidence:'corroborated'};
  await page.evaluate(()=>window.showUserDetailModal('alice'));await page.waitForFunction(()=>document.getElementById('detailModal').textContent.includes('城市多源一致'));
  assert.doesNotMatch(await page.locator('#detailModal').innerText(),/城市待核实/);
  for(const width of [1440,375]){await page.setViewportSize({width,height:width===375?812:1000});await screenshot(page,'ip-city-corroborated-'+width);}
  state.userData.info.last_ip='1.1.1.1';
  state.userData.login_events=[{user_name:'alice',content:JSON.stringify({ip,login_at:now,ip_location:{text:'旧登录城市',source_ip:ip}}),created_at:now}];
  await page.evaluate(()=>window.showUserDetailModal('alice'));await page.waitForFunction(()=>document.getElementById('detailModal').textContent.includes('1.1.1.1'));
  const summary=(await page.locator('#detailModal').innerText()).split('最近登录记录')[0];
  assert.match(summary,/暂未解析/);assert.doesNotMatch(summary,/旧登录城市|杭州|GPS 地址不得作为 IP 城市/);
  for(const width of [1440,375]){await page.setViewportSize({width,height:width===375?812:1000});await screenshot(page,'ip-city-unmatched-'+width);}
  assert.deepEqual(f.errors,[]);
 }finally{await browser.close();}
});
test('fixed admin dialogs trap and restore focus, Escape closes them, and expiry or logout clears every private surface',{timeout:45000},async()=>{
 const browser=await chromium.launch(options);try{
  const state={},f=await fixturePage(browser,state),page=f.page;await login(page);await switchTab(page,'users');
  await page.locator('#tabUsersBtn').focus();await page.evaluate(()=>window.showUserDetailModal('alice'));await page.waitForFunction(()=>document.getElementById('detailModal').textContent.includes('192.0.2.10'));
  const detail=page.locator('#detailModal');assert.equal(await detail.getAttribute('role'),'dialog');assert.equal(await detail.getAttribute('aria-modal'),'true');
  for(let i=0;i<15;i++){await page.keyboard.press(i%2?'Shift+Tab':'Tab');assert.equal(await page.evaluate(()=>document.getElementById('detailModal').contains(document.activeElement)),true);}
  await screenshot(page,'dialog-user-detail');await page.keyboard.press('Escape');assert.equal(await detail.innerHTML(),'');assert.equal(await page.evaluate(()=>document.activeElement.id),'tabUsersBtn');
  await page.evaluate(()=>window.showUserDetailModal('alice'));state.expired=true;await page.evaluate(()=>window.refreshAdminTab('users'));await page.waitForSelector('#loginWrap',{state:'visible'});
  assert.equal(await detail.innerHTML(),'');assert.doesNotMatch(await page.locator('#dashboard').innerText(),/192\.0\.2\.10|private-detail@example\.invalid/);assert.equal(await page.evaluate(()=>localStorage.getItem('xtj_admin_session')),null);assert.equal(await page.locator('body').innerText().then(s=>s.includes('192.0.2.10')),false);await screenshot(page,'session-expired-cleared');
  state.expired=false;await login(page);await switchTab(page,'photos');await page.locator('#tabPhotosBtn').focus();await page.evaluate(id=>window.previewAdminPhoto('/api/photo/'+id+'/media','','alice','private-photo-time'),uuid);
  const photo=page.locator('#photoPreviewModal');assert.equal(await photo.getAttribute('role'),'dialog');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.getElementById('photoPreviewModal').contains(document.activeElement)),true);await screenshot(page,'dialog-photo-preview');await page.keyboard.press('Escape');assert.equal(await page.locator('#photoPreviewImg').getAttribute('src'),null);assert.equal(await page.locator('#photoPreviewInfo').innerText(),'');assert.equal(await page.evaluate(()=>document.activeElement.id),'tabPhotosBtn');
  await page.evaluate(id=>window.previewAdminPhoto('/api/photo/'+id+'/media','','alice','private-photo-time'),uuid);await page.evaluate(()=>{window.showConfirm('private-confirm-title','private-confirm-content','确认',()=>{});sessionStorage.setItem('xtj_email_draft_content','private draft');sessionStorage.setItem('xtj_email_pending_job',JSON.stringify({id:'pending-id',signature:'private message'}));return window.doAdminLogout();});
  await page.waitForSelector('#loginWrap',{state:'visible'});assert.equal(await photo.isVisible(),false);assert.equal(await page.locator('#confirmModal').isVisible(),false);assert.doesNotMatch(await page.locator('#confirmModal').textContent(),/private-confirm/);assert.equal(await page.locator('#photoPreviewImg').getAttribute('src'),null);assert.equal(await page.locator('#photoPreviewImg').getAttribute('alt'),'');assert.equal(await page.evaluate(()=>sessionStorage.getItem('xtj_email_draft_content')),null);assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('xtj_email_pending_job'))),{id:'pending-id'});await screenshot(page,'logout-photo-cleared');assert.deepEqual(f.errors,[]);
 }finally{await browser.close();}
});
test('report pages retain failed-page retries, reach old pending work and expose accessible action dialogs',{timeout:45000},async()=>{
 const browser=await chromium.launch(options);try{
  const rows=Array.from({length:602},(_,i)=>({id:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),created_at:now,reporter_name:'reporter-'+i,target_user:'alice',target_type:'post',target_id:uuid,report_category:'其他',report_reason:'举报-'+i,status:i===601?'pending':'reviewed'}));
  const state={pagedReports:rows},f=await fixturePage(browser,state),page=f.page;await login(page);await switchTab(page,'reports');assert.match(await page.locator('#tabReports').innerText(),/602/);assert.equal(await page.locator('#reportBadge').textContent(),'1');assert.equal(await page.locator('#tabReports tbody tr').count(),100);
  state.moreFailure=true;await page.click('#reportsMore');await page.waitForFunction(()=>document.getElementById('tabReports').textContent.includes('分页暂时失败'));assert.equal(await page.locator('#tabReports tbody tr').count(),100);await screenshot(page,'reports-page-error-retained',false);state.moreFailure=false;
  for(let i=0;i<6;i++){await page.click('#reportsMore');await page.waitForFunction(expected=>document.querySelectorAll('#tabReports tbody tr').length===expected,Math.min(602,(i+2)*100));}
  assert.equal(await page.locator('#reportsMore').count(),0);assert.match(await page.locator('#tabReports').innerText(),/举报-601/);await page.locator('#tabReports tbody tr').last().scrollIntoViewIfNeeded();await screenshot(page,'reports-older-than-500',false);
  await page.selectOption('#reportsStatus','pending');await page.waitForFunction(()=>document.querySelectorAll('#tabReports tbody tr').length===1);assert.match(await page.locator('#tabReports').innerText(),/举报-601/);await screenshot(page,'reports-pending-filter');
  const trigger=page.locator('#tabReports tbody button').first();await trigger.click();const modal=page.locator('.report-detail-modal');assert.equal(await modal.getAttribute('role'),'dialog');for(let i=0;i<6;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.querySelector('.report-detail-modal').contains(document.activeElement)),true);}await screenshot(page,'dialog-report-action');
  await modal.locator('button').filter({hasText:'删除内容'}).click();await page.waitForSelector('#confirmModal.active');assert.equal(await page.evaluate(()=>Number(getComputedStyle(document.getElementById('confirmModal')).zIndex)>Number(getComputedStyle(document.querySelector('.report-detail-modal')).zIndex)),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#confirmModal').isVisible(),false);assert.equal(await modal.count(),1);assert.equal(await modal.evaluate(n=>n.contains(document.activeElement)),true);
  await page.keyboard.press('Escape');assert.equal(await modal.count(),0);assert.equal(await trigger.evaluate(n=>n===document.activeElement),true);assert.deepEqual(f.errors,[]);
 }finally{await browser.close();}
});
test('comment confirmation describes permanent deletion and business/audit failures stay explicit',{timeout:30000},async()=>{
 const browser=await chromium.launch(options);try{
  const state={commentFailure:true},f=await fixturePage(browser,state),page=f.page;await login(page);await switchTab(page,'comments');await page.evaluate(()=>window.deleteAdminComment(1));assert.match(await page.locator('#confirmMsg').innerText(),/回复.*彻底删除.*无法恢复/);await screenshot(page,'comment-permanent-delete-confirmation');await page.click('#confirmOkBtn');await page.waitForFunction(()=>document.querySelector('.toast-error')?.textContent.includes('删除未完成'));assert.equal(await page.locator('.toast-success').count(),0);assert.equal(await page.locator('#tabComments tbody tr').count(),1);
  state.commentFailure=false;state.auditPending=true;await page.evaluate(()=>window.deleteAdminComment(1));await page.click('#confirmOkBtn');await page.waitForFunction(()=>Array.from(document.querySelectorAll('.toast-error')).some(n=>n.textContent.includes('审计结果待确认')));await page.waitForFunction(()=>document.querySelectorAll('.toast-item').length===0);assert.equal(await page.locator('#tabComments tbody tr').count(),0);await page.waitForSelector('#adminAuditNotice',{state:'visible'});assert.match(await page.locator('#adminAuditNotice').innerText(),/请求编号.*核对本次审计/);await screenshot(page,'audit-pending-no-repeat');assert.equal(f.calls.filter(c=>c.method==='DELETE'&&c.path==='/admin/comment/1').length,2);assert.deepEqual(f.errors,[]);
 }finally{await browser.close();}
});
test('all 19 fixed administrator tabs fit desktop, tablet and phone screenshots with a compact mobile header',{timeout:90000},async()=>{
 const browser=await chromium.launch(options);try{
  const f=await fixturePage(browser),page=f.page;await login(page);
  for(const [name,width,height] of [['desktop',1440,1000],['tablet',768,1024],['phone',375,812]]){
   await page.setViewportSize({width,height});
   for(const tab of tabs){await switchTab(page,tab);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+':'+tab);if(tab==='stats'){assert.match(await page.locator('#tabStats').innerText(),/21005/);assert.match(await page.locator('#tabStats').innerText(),/1205/);}await screenshot(page,name+'-'+tab);}
   if(name==='phone'){
    assert.ok(await page.locator('.dash-header').evaluate(n=>n.getBoundingClientRect().height)<100);await page.click('#adminNavToggle');assert.equal(await page.locator('#adminNavToggle').getAttribute('aria-expanded'),'true');await screenshot(page,'phone-menu-open',false);await page.locator('#tabUsersBtn').click();await page.waitForSelector('#tabUsers.active');assert.equal(await page.locator('#adminNavToggle').getAttribute('aria-expanded'),'false');const wrap=page.locator('#tabUsers .table-wrap');assert.ok(await wrap.evaluate(n=>n.scrollWidth>n.clientWidth));assert.equal(await wrap.getAttribute('tabindex'),'0');
   }
  }
  assert.deepEqual(f.errors,[]);
 }finally{await browser.close();}
});
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

test('AI administrator all-history labels and nonzero usage match the selected server window',{timeout:45000},async()=>{
 const browser=await chromium.launch(options);try{
  const f=await fixturePage(browser),page=f.page;await login(page);await switchTab(page,'ai');await page.evaluate(()=>window._switchAiAdminSubTab('users'));await page.waitForSelector('#aiUsageDaysSel');await page.selectOption('#aiUsageDaysSel','all');
  await page.waitForFunction(()=>document.getElementById('aiAdminContent').textContent.includes('用户列表（1 人 · 全部历史）'));
  const text=await page.locator('#aiAdminContent').innerText();assert.doesNotMatch(text,/近 all 天|undefined|NaN/);assert.match(text,/北京时间/);assert.match(text,/累计 Token\s*9/i);await screenshot(page,'ai-usage-all');assert.deepEqual(f.errors,[]);
 }finally{await browser.close();}
});

test('AI administrator settings, prompt, usage selector and invite fields remain readable in both themes',{timeout:60000},async()=>{
 const browser=await chromium.launch(options);try{
  const f=await fixturePage(browser,{aiPartial:true,inviteCodes:[
   {code:'READABLE-A',days:30,max_uses:1,used_count:0},
   {code:'READABLE-B',days:30,max_uses:1,used_count:1},
   {code:'READABLE-C',days:30,max_uses:1,used_count:0,expires_at:'2020-01-01T00:00:00Z'}
  ]}),page=f.page;await login(page);await page.addStyleTag({content:'*,*::before,*::after{transition:none !important;animation:none !important;}'});
  async function checkContrast(selector){
   const rows=await page.locator(selector).evaluateAll(nodes=>{
    const color=s=>(s.match(/[\d.]+/g)||[]).map(Number);
    const over=(a,b)=>{const alpha=a.length>3?a[3]:1;return [0,1,2].map(i=>a[i]*alpha+b[i]*(1-alpha));};
    function background(node){const chain=[];while(node){chain.unshift(node);node=node.parentElement;}return chain.reduce((c,n)=>over(color(getComputedStyle(n).backgroundColor),c),[255,255,255]);}
    function luminance(c){const a=c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*a[0]+.7152*a[1]+.0722*a[2];}
    return nodes.filter(n=>n.getClientRects().length).map(n=>{const bg=background(n),fg=over(color(getComputedStyle(n).color),bg),a=luminance(fg),b=luminance(bg);return {theme:document.documentElement.dataset.theme,field:n.id||n.textContent.trim().slice(0,35),foreground:fg,background:bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
   });
   assert.ok(rows.length>0,selector);assert.deepEqual(rows.filter(row=>row.ratio<4.5),[],'Text contrast below 4.5: '+JSON.stringify(rows.filter(row=>row.ratio<4.5)));
  }
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
   for(const width of [1440,375]){
    await page.setViewportSize({width,height:900});await switchTab(page,'ai');await page.evaluate(()=>window._switchAiAdminSubTab('settings'));await page.waitForSelector('#aiCfgName');
    assert.equal(await page.locator('#aiCfgName').inputValue(),'小猫');
    await checkContrast('.ai-settings-section h4,.ai-admin-settings label,#aiCfgName,#aiCfgSysPrompt,.ai-admin-settings select,.ai-admin-tab:not(.active)');
    await page.click('#aiLoadEffectiveBtn');await page.waitForSelector('#aiEffectivePromptContent',{state:'visible'});assert.match(await page.locator('#aiEffectivePromptContent').innerText(),/实际配置的提示词/);await checkContrast('#aiEffectivePromptContent');
    await screenshot(page,'ai-readable-'+theme+'-'+width);
    await page.evaluate(()=>window._switchAiAdminSubTab('users'));await page.waitForSelector('#aiUsageDaysSel');assert.equal(await page.locator('.ai-partial-warning').count(),2);await checkContrast('#aiUsageDaysSel,.ai-usage-toolbar span,.ai-usage-card .lbl,.ai-partial-warning');
    await page.evaluate(()=>window._switchAiAdminSubTab('invite'));await page.waitForSelector('#aiInviteCount');await checkContrast('.ai-invite-card h3,.ai-invite-field label,.ai-invite-field input,.ai-invite-table-wrap th,.ai-invite-table-wrap td,.ai-invite-code,.ai-status-pill,.ai-invite-copy-btn,.ai-invite-del-btn');
    await page.locator('#aiInviteCount').focus();await checkContrast('#aiInviteCount');await screenshot(page,'ai-invite-readable-'+theme+'-'+width);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   }
  }
  assert.deepEqual(f.errors,[]);
 }finally{await browser.close();}
});
