'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const operations=require('../render-api/admin-operations'),markers=require('../render-api/post-markers');
const history=require('../render-api/ai-history');
const admin=fs.readFileSync('js/admin/admin.js','utf8'),server=fs.readFileSync('render-api/server.js','utf8');
function section(src,start,end){const a=src.indexOf(start),b=src.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,start);return src.slice(a,b);}
function fluent(resolve,details={}){return new Proxy({}, {get(_,key){if(key==='then')return (ok,bad)=>Promise.resolve().then(()=>resolve(details)).then(ok,bad);return (...args)=>{if(['insert','update','delete','upsert'].includes(key)){details.operation=key;details.payload=args[0];}else if(key==='select'){details.operation ||= 'select';details.columns=args[0];}else if(key==='eq'){(details.filters ||= {})[args[0]]=args[1];}else if(key==='in'){(details.in ||= {})[args[0]]=args[1];}else if(key==='order'){(details.orders ||= []).push(args);}return fluent(resolve,details);};}});}
function node(){return {style:{},innerHTML:'',textContent:'',setAttribute(){},removeAttribute(){},appendChild(){},querySelector(){return null;},querySelectorAll(){return [];},classList:{add(){},remove(){}}};}
function context(extra={}){const nodes={};return vm.createContext({console:{warn(){},error(){},log(){}},Date,Map,Set,Promise,URL,URLSearchParams,crypto,_adminRequests:new Set(),Buffer,JSON,setTimeout,clearTimeout,AbortController,DOMException,...operations,...markers,...history,ADMIN_USERNAME:'xxz',window:{},document:{getElementById(id){return nodes[id] ||= node();},createElement:()=>node()},...extra});}
function response(){return {statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};}
function route(start,end,extra={}){const handlers={};const c=context({verifyToken(){},authenticateUser(){},rateLimit:()=>()=>{},securityRateLimit:()=>()=>{},app:Object.fromEntries(['get','post','put','delete'].map(method=>[method,(path,...handlersList)=>{handlers[method+' '+path]=handlersList.at(-1);} ])),...extra});vm.runInContext(section(server,start,end),c);return {c,handler:handlers[Object.keys(handlers)[0]],handlers};}
const uuid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',photoId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
test('admin directories and visitor aggregates retain prototype-shaped usernames without touching prototypes',()=>{
 const c=context({pickEarlierIso:(a,b)=>a||b,pickLaterIso:(a,b)=>b||a,safeJsonParse:s=>JSON.parse(s||'{}'),getUtcDateKey:s=>String(s||'').slice(0,10),toTimeMs:s=>Date.parse(s)});
 vm.runInContext(section(server,'function buildAuthUserMap','function buildRegisteredUsersByDate'),c);
 const names=['__proto__','constructor','toString','hasOwnProperty','普通用户'],rows=names.map(user_name=>({user_name,created_at:'2026-10-21T00:00:00Z',content:'{}'}));
 assert.deepEqual(Array.from(c.buildAdminUsersPayload(rows,rows),r=>r.user_name).sort(),names.slice().sort());
 for(const build of [c.buildAuthUserMap,c.buildUserInfoMap,c.buildUserVisitMap]){const map=build(rows);assert.equal(Object.getPrototypeOf(map),null);assert.equal(Object.keys(map).length,names.length);}
 assert.equal(c.buildUserVisitMap(rows).__proto__.total_visits,1);assert.equal(Object.prototype.auth_created_at,undefined);
});
test('activity and moderation caches handle special usernames and equal-length replacement data',()=>{
 const c=context({_userFlagsCache:null,_flagDataRefs:null,_userActivityCache:null,ADMIN:'xxz',bansData:[],mutesData:[],blacklistData:[],allPosts:[{user_name:'__proto__'}],allLikes:[],allComments:[]});
 vm.runInContext(section(admin,'function getUserStateFlags','function buildUserTagMarkup'),c);
 assert.equal(c.getUserActivityStats('__proto__').posts,1);assert.equal(c.getUserStateFlags('constructor').isBanned,false);
 c.allPosts=[{user_name:'constructor'}];assert.equal(c.getUserActivityStats('__proto__').posts,0);assert.equal(c.getUserActivityStats('constructor').posts,1);
 c.bansData=[{user_name:'__proto__',is_active:true}];assert.equal(c.getUserStateFlags('__proto__').isBanned,true);assert.equal(c.getUserStateFlags('constructor').isBanned,false);
});
test('comment RPC business failures and nonexistent moderation rows cannot report success',async()=>{
 for(const result of [{ok:false,code:'not_found'},{ok:false,code:'forbidden'},null]){
  const x=route("app.delete('/admin/comment/:id'",'// ===================== 举报通知辅助函数',{supabase:{rpc:async()=>({data:result,error:null})},logAdminAudit:()=>assert.fail('failed action cannot log success')}),r=response();await x.handler({params:{id:1}},r);assert.equal(r.body.ok,false);assert.equal(r.statusCode,result?.code==='not_found'?404:result?.code==='forbidden'?403:503);
 }
 for(const [start,end] of [["app.put('/admin/ban/:id/lift'",'// ===================== 禁言管理'],["app.put('/admin/mute/:id/lift'",'// ===================== 黑名单管理'],["app.put('/admin/blacklist/:id/lift'",'// ===================== 管理员删除用户账号']]){
  const x=route(start,end,{supabase:{from:()=>fluent(()=>({data:[],error:null}))},logAdminAudit:()=>assert.fail('missing record')}),r=response();await x.handler({params:{id:uuid}},r);assert.equal(r.statusCode,404);assert.equal(r.body.ok,false);
 }
});
test('attack list reports the independent filtered count and rejects an unavailable count',async()=>{
 for(const count of [517,null]){
  const x=route("app.get('/admin/stats/attacks'",'// 每日明细统计',{supabase:{from:()=>fluent(()=>({data:[{id:uuid,content:'{}'}],error:null,count}))}}),r=response();await x.handler({query:{limit:'1',offset:'400',type:'login'}},r);
  if(count===null){assert.equal(r.statusCode,503);assert.equal(r.body.ok,false);}else{assert.equal(r.body.total,517);assert.equal(r.body.has_more,true);assert.equal(r.body.data.length,1);}
 }
});
test('report endpoint forwards keyset/filter to RPC and retains independent pending totals',async()=>{
 const requests=[],x=route("app.get('/admin/reports'","app.put('/admin/report/:id'",{supabase:{rpc:async(name,args)=>{requests.push({name,args});return {data:{ok:true,rows:[{id:uuid,user_name:'alice',created_at:'2026-10-21',content:'{"target_user":"bob","status":"reviewed"}'}],total:705,pending_count:7,filtered_total:698,has_more:true,next_cursor:{before_id:uuid,before_at:'2026-10-21T00:00:00Z'}},error:null};}},parseReportRecordContent:s=>JSON.parse(s),firstNonEmptyValue:(...values)=>values.find(Boolean),formatAdminReportReason:(c,r)=>r||c||'-'}),r=response();
 await x.handler({query:{status:'reviewed',limit:'100',before_at:'2026-10-21T00:00:00.123456Z',before_id:uuid}},r);assert.equal(r.body.pending_count,7);assert.equal(r.body.total,705);assert.equal(r.body.data.length,1);assert.equal(requests[0].args.p_before_at,'2026-10-21T00:00:00.123456Z');assert.equal(requests[0].args.p_status,'reviewed');
 const bad=response();await x.handler({query:{before_id:uuid}},bad);assert.equal(bad.statusCode,400);assert.equal(requests.length,1);
});
test('durable admin audit blocks unrecorded actions, preserves committed results and covers sensitive AI reads',async()=>{
 const express=require('express'),request=require('supertest'),{createAdminAuditTrail}=require('../render-api/admin-audit-trail');
 for(const mode of ['ok','insert-failed','update-failed']){
  const records=new Map();let actions=0;const db={from:()=>fluent(q=>{if(q.operation==='insert'){if(mode==='insert-failed')return {error:Error('offline')};const row=q.payload[0];records.set(row.id,row);return {data:{id:row.id},error:null};}if(mode==='update-failed')return {error:Error('offline')};Object.assign(records.get(q.filters.id),q.payload);return {data:{id:q.filters.id},error:null};})};
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.adminName='xxz';next();});app.use(createAdminAuditTrail({supabase:db}).middleware);app.post('/admin/comment/123',(req,res)=>{actions++;res.json({ok:true,deleted:123});});
  const r=await request(app).post('/admin/comment/123').send({password:'never log me',content:'private body'});
  if(mode==='insert-failed'){assert.equal(r.status,503);assert.equal(actions,0);assert.equal(records.size,0);continue;}
  assert.equal(actions,1);assert.equal(r.body.ok,true);const stored=JSON.parse([...records.values()][0].content);assert.match(stored.detail,/resource_id=123/);assert.doesNotMatch(JSON.stringify([...records.values()]),/never log me|private body/);
  if(mode==='update-failed'){assert.equal(r.body.audit_pending,true);assert.equal(stored.outcome,'unconfirmed');assert.equal(r.body.audit_request_id,stored.request_id);}else assert.equal(stored.outcome,'succeeded');
 }
 let writes=0;const app=express();app.use((req,_res,next)=>{req.adminName='xxz';next();});app.use(createAdminAuditTrail({supabase:{from:()=>fluent(q=>{writes++;return {data:{id:q.payload?.[0]?.id || q.filters.id},error:null};})}}).middleware);app.get('/admin/ai-agent/conversation',(_req,res)=>res.json({ok:true,messages:[]}));await request(app).get('/admin/ai-agent/conversation?user_name=alice').expect(200);assert.equal(writes,2);
});
test('stalled audit storage has a bounded deadline and never starts the action',async()=>{
 const express=require('express'),request=require('supertest'),{createAdminAuditTrail}=require('../render-api/admin-audit-trail');let ran=false;
 const app=express();app.use((req,_res,next)=>{req.adminName='xxz';next();});app.use(createAdminAuditTrail({supabase:{from:()=>fluent(()=>new Promise(()=>{}))},timeoutMs:20}).middleware);app.post('/admin/example',(_req,res)=>{ran=true;res.json({ok:true});});const r=await request(app).post('/admin/example');assert.equal(r.status,503);assert.equal(ran,false);
});
test('audit outage cannot prevent session revocation',async()=>{
 const express=require('express'),request=require('supertest'),{createAdminAuditTrail}=require('../render-api/admin-audit-trail');let revoked=false;
 const app=express();app.use(createAdminAuditTrail({supabase:{from(){assert.fail('revocation must not depend on audit storage');}}}).middleware);app.post('/admin/logout',(_req,res)=>{revoked=true;res.json({ok:true});});await request(app).post('/admin/logout').expect(200);assert.equal(revoked,true);
});
test('audit matching follows Express case-insensitive routes and redacts invite codes and query credentials',()=>{
 const {operationPath}=require('../render-api/admin-audit-trail');
 assert.equal(operationPath({originalUrl:'/ADMIN/AI-AGENT/INVITE-CODES/SecretInvite?password=SecretPassword'}),'/admin/ai-agent/invite-codes/:code');
 assert.equal(operationPath({originalUrl:'/ADMIN/AI-AGENT/CONVERSATION/?user_name=Alice'}),'/admin/ai-agent/conversation');
});
test('audit request lookup finds durable unconfirmed entries independently of the latest window',async()=>{
 const queries=[],x=route("app.get('/admin/audit-logs'",'// ===================== 用户访问统计',{supabase:{from:()=>fluent(q=>{queries.push(q);return {data:[{id:uuid,user_name:'xxz',content:JSON.stringify({request_id:uuid,status:'started',outcome:'unconfirmed'})}],error:null};})}}),r=response();
 await x.handler({query:{request_id:uuid}},r);assert.equal(queries[0].filters.id,uuid);assert.equal(r.body.data[0].outcome,'unconfirmed');assert.equal(r.body.data[0].request_id,uuid);
 const bad=response();await x.handler({query:{request_id:'not-a-uuid'}},bad);assert.equal(bad.statusCode,400);assert.equal(queries.length,1);
});
const normalizePostId=id=>/^[a-f\d-]{36}$/i.test(String(id || ''))?String(id):null;
const sanitizeError=()=> 'database operation failed';
test('public runtime configuration exposes only anon/publishable keys and never privileged or unclassified JWTs',async()=>{
 const express=require('express'),request=require('supertest');const jwt=claims=>'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
 for(const key of ['sb_publishable_fixture',jwt({role:'anon'}),jwt({role:'service_role'}),jwt({role:'authenticated'}),jwt({}), 'eyJhbGciOiJIUzI1NiJ9.invalid.signature','sb_secret_fixture',null]){
  const app=express(),c=context({app,rateLimit:()=>((_req,_res,next)=>next()),SUPABASE_URL:'https://storage.test',process:{env:{SUPABASE_ANON_KEY:key,SUPABASE_SERVICE_ROLE_KEY:'must-never-fallback'}}});vm.runInContext(section(server,"app.get('/api/config/public'",'// 邮件配置健康检查'),c);
  const r=await request(app).get('/api/config/public').expect(200);assert.equal(r.body.supabase_anon_key,key===jwt({role:'anon'})||key==='sb_publishable_fixture'?key:null);assert.equal(r.body.supabase_url,'https://storage.test');assert.doesNotMatch(JSON.stringify(r.body),/must-never-fallback|sb_secret_fixture/);
 }
});
const statsExtra=()=>({AUTH_MARKER:'__auth__',VISIT_MARKER:'__visit__',ATTACK_MARKER:'__attack__',MAX_STATS_LIMIT:20000,STATS_CACHE_TTL:60000,statsCache:{data:null,ts:0,pending:null},fetchAllPostsByMediaType:async()=>[],buildAuthUserMap:()=>({}),buildRegisteredUsersByDate:()=>({}),applyPublicPostExclusions:q=>q,supabase:{from:()=>fluent(()=>({data:null,error:{code:'08006',message:'database unavailable'}}))}});
test('AB-04 summary and daily database failures never become cached zeros or empty history',async()=>{
 for(const [start,end] of [["app.get('/admin/stats'",'// 攻击详情 API'],["app.get('/admin/stats/daily'",'// 清除统计缓存']]){const x=route(start,end,statsExtra()),r=response();await x.handler({query:{}},r);assert.ok(r.statusCode>=500);assert.equal(r.body.total_posts,undefined);assert.equal(r.body.daily,undefined);assert.equal(x.c.statsCache.data,null);}
});
test('AB-04 AI users, conversations and message reads return failure rather than empty success',async()=>{
 for(const [start,end,query] of [["app.get('/admin/ai-agent/users'",'// GET /admin/ai-agent/conversations',{}],["app.get('/admin/ai-agent/conversations'",'// GET /admin/ai-agent/conversation?',{user_name:'alice'}],["app.get('/admin/ai-agent/conversation'",'// POST /admin/ai-agent/cleanup',{user_name:'alice',conversation_id:'123456'}]]){const x=route(start,end,{supabase:{from:()=>fluent(()=>({data:null,error:{code:'08006',message:'offline'}}))},normalizePostId}),r=response();await x.handler({query},r);assert.ok(r.statusCode>=500);assert.notEqual(r.body.ok,true);assert.equal(r.body.users,undefined);assert.equal(r.body.messages,undefined);}
});
test('AB-04 AI usage UI retains the successful snapshot for its window and never converts a failed read into an empty user list',async()=>{
 let fail=false;const c=context({_aiAdminSubTabGeneration:1,document:{getElementById:()=>null},safeJsStr:String,escapeHtml:String,apiCall:async(_method,url)=>{if(fail){const e=Error('服务暂时受限');e.retryable=false;throw e;}return url.includes('usage-summary')?{summary:{},window_days:30}:{users:[{user_name:'alice',message_count:3}],window_days:30};}});const panel=node();
 vm.runInContext(section(admin,'function renderAdminTabLoadError','// 供模板内联 onclick'),c);vm.runInContext(section(admin,'async function renderAiAdminUsageSummary','// ===================== AI 邀请码管理'),c);
 await c.renderAiAdminUsageSummary(panel);assert.match(panel.innerHTML,/alice/);assert.doesNotMatch(panel.innerHTML,/数据加载失败/);fail=true;await c.renderAiAdminUsageSummary(panel);assert.match(panel.innerHTML,/数据加载失败/);assert.match(panel.innerHTML,/alice/);assert.match(panel.innerHTML,/等待服务恢复/);assert.doesNotMatch(panel.innerHTML,/暂无用户 AI/);assert.doesNotMatch(panel.innerHTML,/重新加载/);
 c.window._aiUsageDays='7';await c.renderAiAdminUsageSummary(panel);assert.doesNotMatch(panel.innerHTML,/alice/);assert.match(panel.innerHTML,/数据加载失败/);
});
test('AI administrator history takes the latest window and accepts the exact microsecond/offset cursor returned by PostgreSQL',async()=>{
 const rows=Array.from({length:501},(_,i)=>({id:String(i+1).padStart(8,'0')+'-aaaa-aaaa-aaaa-aaaaaaaaaaaa',content:'message '+i,media_url:'{"role":"user"}',created_at:'2026-10-11T01:00:'+String(59-i%60).padStart(2,'0')+'.123456+00:00'}));let nextPage=false,queries=0;
 const x=route("app.get('/admin/ai-agent/conversation'",'// POST /admin/ai-agent/cleanup',{normalizePostId,parseMsgMeta:r=>JSON.parse(r.media_url),supabase:{from:()=>fluent(q=>{queries++;assert.equal(q.filters.user_name,'alice');assert.equal(q.filters.media_type,markers.AI_AGENT_MESSAGE_MARKER);assert.equal(q.orders[0][1].ascending,false);return {data:nextPage?[]:rows,error:null};})}}),r=response();
 await x.handler({query:{user_name:'alice',conversation_id:'123456'}},r);assert.equal(r.statusCode,200);assert.equal(r.body.messages.length,500);assert.equal(r.body.messages[0].content,rows[499].content);assert.equal(r.body.messages[499].content,rows[0].content);assert.equal(r.body.has_more,true);assert.equal(r.body.next_cursor.before_at,rows[499].created_at);
 nextPage=true;const older=response();await x.handler({query:{user_name:'alice',conversation_id:'123456',...r.body.next_cursor}},older);assert.equal(older.statusCode,200);assert.equal(older.body.has_more,false);assert.equal(queries,2);
 const invalid=response();await x.handler({query:{user_name:'alice',conversation_id:'123456',before_id:uuid,before_at:rows[499].created_at+',id.gt.0'}},invalid);assert.equal(invalid.statusCode,400);assert.equal(queries,2);
});
test('AB-05 photos and other list refresh failures retain their last success and remain retryable',async()=>{
 for(const [name,start,end,type] of [['photosAdminData','async function loadPhotosAdminData()','async function renderPhotosTab','photos'],['bansData','async function loadBansData()','window.showAddBanModal','bans'],['mutesData','async function loadMutesData()','window.showAddMuteModal','mutes'],['blacklistData','async function loadBlacklistData()','window.showAddBlacklistModal','blacklist']]){const c=context({API_BASE:'https://local',[name]:[{id:'previous'}],adminTabDataLoaded:{},apiCall:async()=>{throw Error('network unavailable');}});vm.runInContext(section(admin,start,end),c);if(type==='photos'){vm.runInContext(section(admin,'async function _loadSingleDataTypeUncached(dataType)','function escapeHtml'),c);await assert.rejects(c._loadSingleDataTypeUncached(type));assert.notEqual(c.adminTabDataLoaded.photos,true);}else await assert.rejects(c['load'+type[0].toUpperCase()+type.slice(1)+'Data']());assert.equal(c[name][0].id,'previous');}
});
test('AB-03 full refresh keeps silent registered users and invalidates directory, both login aliases and security alerts',async()=>{
 const calls=[];const c=context({API_BASE:'https://local',_allDataLoadPromise:null,_allDataLoadGeneration:0,_allDataAbortController:null,adminDataLoading:false,adminDataLoadedAt:0,adminTabDataLoaded:{users:true,logins:true,'login-events':true,'security-alerts':true},adminDataLoadPromises:{},allPosts:[],allLikes:[],allComments:[],annList:[],bansData:[],allUsers:[{name:'active',info:{}},{name:'silent',info:{email:'saved'}}],currentTab:'users',showToast(){},isFetchAbortError:()=>false,loadTabDataIfNeeded:async()=>{calls.push('reload');},apiCall:async()=>({posts:[{user_name:'active',media_type:'text'}],likes:[],comments:[]})});c.window.renderTab=()=>{};vm.runInContext(section(admin,'async function loadAllData(keepTab)','async function loadTabDataIfNeeded(tab)'),c);await c.loadAllData(true);assert.deepEqual(Array.from(c.allUsers,u=>u.name),['active','silent']);for(const key of ['users','logins','login-events','security-alerts'])assert.equal(c.adminTabDataLoaded[key],false);assert.deepEqual(calls,['reload']);
});
test('AB-03 authoritative directory refresh adds silent registrations and removes retired accounts without touching cached data on failure',async()=>{
 let fail=false;const c=context({allUsers:[{name:'deleted',info:{}},{name:'alice',info:{reg_time:'2025-01-01'}}],adminTabDataLoaded:{},mergeAdminUserInfo:(a,b)=>({...a,...b}),apiCall:async()=>{if(fail)throw Error('offline');return {data:[{user_name:'alice',content:'{"email":"new@example.invalid"}'},{user_name:'silent',content:'{}'}]};}});vm.runInContext(section(admin,'async function _loadSingleDataTypeUncached(dataType)','function escapeHtml'),c);await c._loadSingleDataTypeUncached('users');assert.deepEqual(Array.from(c.allUsers,u=>u.name),['alice','silent']);fail=true;await assert.rejects(c._loadSingleDataTypeUncached('users'));assert.equal(c.allUsers.length,2);
});
test('AB-06 AI config rejects failed checked read/write and does not invalidate the last successful cache',async()=>{
 for(const failedStep of ['select','update']){const x=route("app.post('/admin/ai-agent/config'",'// POST /api/admin/ai-agent/avatar',{migrateConfig:x=>x,AI_DEFAULT_CONFIG:{name:'default'},SUPABASE_URL:'https://storage.test',aiConfigCache:{name:'cached'},aiConfigFetchedAt:99,logAdminAudit:async()=>{},supabase:{from:()=>fluent(q=>q.operation===failedStep?{data:null,error:Error('write rejected')}:{data:{id:uuid,media_url:'{"name":"Old","avatar_url":""}'},error:null})}}),r=response();await x.handler({body:{name:'Unsaved'},adminName:'xxz'},r);assert.equal(r.statusCode,500);assert.notEqual(r.body.ok,true);assert.equal(x.c.aiConfigCache.name,'cached');}
});
test('AB-06 failed AI avatar config persistence routes the orphan original through storage cleanup',async()=>{
 const cleanup=[];const c=context({SUPABASE_URL:'https://storage.test',aiConfigCache:{name:'Old'},aiConfigFetchedAt:1,sanitizeError,readPersistedAiConfig:async()=>({row:{id:uuid},config:{name:'Old'}}),persistAiConfig:async()=>{throw Error('denied');},removeStorageWithQueue:async(_db,options)=>{cleanup.push(options);return {ok:true};},supabase:{storage:{from:()=>({upload:async()=>({error:null}),getPublicUrl:path=>({data:{publicUrl:'https://storage.test/storage/v1/object/public/uploads/'+path}})})}}});vm.runInContext(section(server,'async function handleAvatarUpload','app.post(\'/api/admin/ai-agent/avatar\''),c);const r=response();await c.handleAvatarUpload({body:{image:Buffer.alloc(40).toString('base64'),ext:'png'},adminName:'xxz'},r);assert.equal(r.statusCode,500);assert.equal(cleanup.length,1);assert.match(cleanup[0].paths[0],/^avatars\/ai_avatar_/);assert.equal(c.aiConfigCache.name,'Old');
});
test('AB-07 manual IP lookup uses the event guarded RPC for user authentication and checks its database outcome',async()=>{
 const args=[],lookups=[];const x=route("app.post('/admin/user/resolve-ip'",'// Sensitive per-user data',{require:name=>require('../render-api/'+name.slice(2)),normalizeClientIpValue:require('../render-api/ip-geolocation').normalizeIpAddress,isPrivateOrReservedIp:()=>false,resolveIpLocation:async(ip,options)=>{lookups.push({ip,options});return {text:'region'};},logAdminAudit:async()=>{},sanitizeError,supabase:{from:()=>fluent(()=>({data:{id:uuid,content:'{"ip":"1.1.1.1","authority":"server_authentication","method":"password","source":"login_success"}'},error:null})),rpc:async(name,arg)=>{args.push([name,arg]);return {data:null,error:{code:'08006'}};}}}),r=response();await x.handler({body:{user_name:'alice'}},r);assert.equal(r.statusCode,500);assert.notEqual(r.body.ok,true);assert.equal(lookups[0].ip,'1.1.1.1');assert.equal(lookups[0].options.forceRefresh,true);assert.equal(args.length,1);assert.equal(args[0][0],'record_auth_ip_location');assert.equal(args[0][1].p_event_id,uuid);
});
test('AB-08 review and its notification use one atomic RPC; errors prevent a success acknowledgement',async()=>{
 let args;const x=route("app.put('/admin/report/:id'",'// 管理员回复举报',{supabase:{rpc:async(_name,arg)=>{args=arg;return {data:null,error:{code:'08006'}};}}}),r=response();await x.handler({params:{id:uuid},body:{status:'actioned'}},r);assert.equal(r.statusCode,503);assert.equal(args.p_patch.status,'actioned');assert.equal(args.p_notification.action,'actioned');assert.notEqual(r.body.ok,true);
});
test('AB-08 notification mark-read uses the authenticated actor and cutoff, and reports database failures without hiding partial success',async()=>{
 const calls=[];const x=route("app.post('/api/report/notifications/mark-read'",'// ===================== 照片管理',{sanitizeError,supabase:{from:()=>fluent(q=>{assert.equal(q.filters.user_name,'alice');return {data:[{id:uuid},{id:photoId}],error:null};}),rpc:async(name,args)=>{calls.push([name,args]);return args.p_report_id===uuid?{data:{ok:true,marked:2},error:null}:{data:null,error:{code:'08006'}};}}}),r=response();
 await x.handler({userName:'alice',body:{user:'bob'}},r);
 assert.equal(r.statusCode,500);assert.equal(r.body.code,'report_mark_read_partial');assert.equal(r.body.marked,1);assert.equal(r.body.failed,1);assert.equal(calls.length,2);
 assert.equal(calls[0][0],'mutate_report_record');assert.equal(calls[0][1].p_reader,'alice');assert.equal(calls[0][1].p_read_before,calls[1][1].p_read_before);assert.ok(Number.isFinite(Date.parse(calls[0][1].p_read_before)));assert.equal(Object.keys(calls[0][1].p_patch).length,0);assert.equal(calls[0][1].p_notification,null);
});
test('AB-09 old photo_wall/photo_id and reported_username formats delete the correct target and unknown kinds are rejected',async()=>{
 for(const targetType of ['photo_wall','unsupported']){let deleted=0,mutation=0;const x=route("app.post('/admin/report/:id/delete-post'",'// 管理员处理举报 + 封禁用户',{normalizePostId,sanitizeError,collectPhotoStoragePaths:()=>[],processStorageCleanupJobs:async()=>{},sendAdminDm(){},hardDeleteContent:async options=>{deleted++;assert.equal(options.postId,photoId);assert.equal(options.expectPhoto,true);return {result:{ok:true}};},supabase:{from:()=>fluent(q=>({data:q.filters.id===uuid?{user_name:'reporter',content:JSON.stringify({target_type:targetType,photo_id:photoId,reported_username:'alice'})}:{id:photoId,media_type:'__photo_wall__'},error:null})),rpc:async(_name,args)=>{mutation++;assert.equal(args.p_patch.status,'actioned');return {data:{ok:true},error:null};}}});vm.runInContext(section(server,'function firstNonEmptyValue()','function formatAdminReportReason'),x.c);const r=response();await x.handler({params:{id:uuid}},r);assert.equal(deleted,targetType==='photo_wall'?1:0);assert.equal(mutation,targetType==='photo_wall'?1:0);assert.equal(r.statusCode,targetType==='photo_wall'?200:400);}
});
test('AB-09 a supported legacy reported_username is the actual ban target and status advances only after the write succeeds',async()=>{
 for(const fail of [false,true]){let inserted,mutations=0;const x=route("app.post('/admin/report/:id/ban-user'",'// 用户提交举报',{sanitizeError,sendAdminDm(){},supabase:{from:table=>fluent(q=>{
  if(table==='posts')return {data:q.filters.id?{user_name:'reporter',content:'{"reported_username":"alice","reason":"违规内容"}'}:{id:photoId},error:null};
  if(q.operation==='select')return {data:[],error:null};inserted=q.payload[0];return {data:null,error:fail?{code:'08006'}:null};
 }),rpc:async()=>{mutations++;return {data:{ok:true},error:null};}}});vm.runInContext(section(server,'function firstNonEmptyValue()','function formatAdminReportReason'),x.c);const r=response();await x.handler({params:{id:uuid},body:{duration_hours:24}},r);assert.equal(inserted.user_name,'alice');assert.equal(inserted.ban_duration_hours,24);assert.equal(mutations,fail?0:1);assert.equal(r.body.ok,!fail);
 }
});
test('AB-10 a duplicate mail request observes the original job and never invokes an external transport',async()=>{
 let attempts=0;const x=route("app.post('/admin/send-email'",'// 管理员：获取邮件发送历史',{normalizePostId,normalizeEmailAddress:e=>e && e.toLowerCase(),isValidEmailAddress:()=>true,sanitizeEmailHtml:x=>x,emailHtmlToText:x=>x,ADMIN_EMAIL_DAILY_MAX:500,GMAIL_USER:'from@example.invalid',deliverAdminEmail:async()=>{attempts++;},supabase:{rpc:async()=>({data:{ok:true,created:false,id:uuid,status:'completed',deliveries:[{email:'a@example.invalid',user_name:'a',status:'sent'}]},error:null})}}),r=response();await x.handler({body:{request_id:uuid,recipients:[{email:'a@example.invalid',user_name:'a'}],subject:'hello',content:'body'},adminName:'xxz'},r);assert.equal(attempts,0);assert.equal(r.body.sent_count,1);assert.equal(r.body.request_id,uuid);
});
test('AB-11 GAS only accepts explicit ok:true; invalid JSON or unknown acknowledgement is not sent success',async()=>{
 for(const value of [{ok:false,error:'mail_quota_exceeded'},null,'invalid']){const c=context({GMAIL_GAS_URL:'https://mail.invalid',fetchWithTimeout:async()=>({ok:true,status:200,json:async()=>{if(value==='invalid')throw SyntaxError('invalid');return value;}})});vm.runInContext(section(server,'async function sendViaGAS','// S-4: 邮件 HTML'),c);await assert.rejects(c.sendViaGAS('a@example.invalid','hello','text','html'),e=>e.deliveryState===(value && value.ok===false?'failed':'unknown'));}
});
test('AB-11 transport timeout cannot fall back to another provider and explicit rejection may do so',async()=>{
 for(const state of ['unknown','failed']){let second=0;const c=context({GMAIL_GAS_URL:'https://gas.invalid',SENDGRID_API_KEY:'test-only',GMAIL_USER:'from@example.invalid',sendViaGAS:async()=>{const error=Error('rejected');error.deliveryState=state;throw error;},sendViaSendGrid:async()=>{second++;},getMailTransporter:()=>null,getMailTransporterPort:()=> '465'});vm.runInContext(section(server,'function emailFailureState','// Atomically reserve'),c);if(state==='unknown')await assert.rejects(c.deliverAdminEmail({email:'a@example.invalid'},'hello','text','html'));else await c.deliverAdminEmail({email:'a@example.invalid'},'hello','text','html');assert.equal(second,state==='failed'?1:0);}
});
test('AB-12 failed recipient deletion/clear never report planned counts as actual success',async()=>{
 for(const [start,end] of [["app.post('/admin/email-recipient-history/delete'",'// 清空所有历史收件人'],["app.post('/admin/email-recipient-history/clear'",'// ===================== 客户端错误监控']]){const x=route(start,end,{sanitizeError,supabase:{from:()=>fluent(q=>q.operation==='select'?{data:[{id:uuid,content:'{"email":"a@example.invalid"}'}],error:null}:{data:null,error:{code:'08006'}})}}),r=response();await x.handler({body:{email:'a@example.invalid'}},r);assert.notEqual(r.body.ok,true);assert.notEqual(r.body.deleted_count,1);}
});
test('AB-13 retired diagnostics cannot be enabled and live security settings use the returned persisted values',async()=>{
 let calls=0;const c=context({securitySettings:{security_alerts:true},showToast(){},renderTab(){},apiCall:async()=>{calls++;return {settings:{record_device:false,security_alerts:false}};}});vm.runInContext(section(admin,'window.saveSecuritySetting = async function','window.cleanupOldLogs'),c);await c.window.saveSecuritySetting('record_device',true);assert.equal(calls,0);await c.window.saveSecuritySetting('security_alerts',false);assert.equal(c.securitySettings.security_alerts,false);assert.equal(c.securitySettings.record_device,false);
});
test('AB-14 maintenance partial outcome shows confirmed counts and never a success toast',async()=>{
 const toasts=[];const c=context({confirm:()=>true,apiCall:async()=>({ok:false,partial:true,total_succeeded:9,total_failed:1,results:[{succeeded:9,failed:1}]}),showToast:(message,type)=>toasts.push([message,type])});vm.runInContext(section(admin,'window.cleanupOldLogs = async function','window.setSecurityTypeFilter'),c);await c.window.cleanupOldLogs();assert.match(c.document.getElementById('cleanupResult').textContent,/9.*1/);assert.notEqual(toasts[0][1],'success');
});
test('AB-15 transient admin verification retains the restore marker; a verified 401 clears it',async()=>{
 for(const status of [503,401]){let clears=0;const c=context({API_BASE:'https://local',hasSession:()=>true,clearSession:()=>{clears++;},apiCall:async()=>{const e=Error('temporary');e.status=status;throw e;},initAdminClient:async()=>{},showToast(){}});vm.runInContext(section(admin,'async function tryRestoreAdminSession()','// 安全说明：'),c);assert.equal(await c.tryRestoreAdminSession(),false);assert.equal(clears,status===401?1:0);}
});
test('AB-16 admin errors preserve HTTP status, service code and retryability, and partial 207 is not generic success',async()=>{
 for(const [status,data] of [[402,{ok:false,code:'egress_quota_exceeded',retryable:false,error:'wait'}],[207,{ok:false,partial:true,total_succeeded:9,total_failed:1}]]){const c=context({API_BASE:'https://local',_adminSessionGeneration:0,getToken:()=>'',saveSession(){},clearSession(){},fetch:async()=>({status,ok:status>=200&&status<300,json:async()=>data})});vm.runInContext(section(admin,'function adminApiError','function showToast'),c);await assert.rejects(c.apiCall('GET','/admin/data'),e=>e.status===status && (status!==402 || (e.code==='egress_quota_exceeded' && e.retryable===false)));if(status===207)assert.equal((await c.apiCall('POST','/admin/cleanup-logs',null,{allowBusinessFailure:true})).partial,true);}
});
test('AB-16 malformed successful JSON is an explicit failure rather than a saved operation',async()=>{
 let saved=0;const c=context({API_BASE:'https://local',_adminSessionGeneration:0,getToken:()=>'',saveSession(){saved++;},clearSession(){},fetch:async()=>({status:200,ok:true,json:async()=>{throw SyntaxError('invalid json');}})});vm.runInContext(section(admin,'function adminApiError','function showToast'),c);await assert.rejects(c.apiCall('POST','/admin/ai-agent/config',{name:'Unsaved'}),e=>e.code==='invalid_response' && e.retryable===true);assert.equal(saved,0);
});
test('AB-16 ordinary administrator database routes classify restricted errors while credentials and validation remain distinct',async()=>{
 const express=require('express'),request=require('supertest'),availability=require('../render-api/supabase-availability').createSupabaseAvailability({fetchImpl:async()=>new Response('exceed_egress_quota',{status:402})});const app=express();app.use(availability.middleware);
 for(const url of ['/admin/data','/admin/stats','/admin/photos','/admin/ai-agent/users'])app.get(url,async(_req,res)=>{await availability.transport('https://storage.test/posts');res.status(503).json({ok:false,error:'database temporarily unavailable'});});
 app.get('/admin/login',(_req,res)=>res.status(400).json({error:'密码错误',code:'invalid_credentials'}));app.get('/admin/invalid',(_req,res)=>res.status(400).json({error:'无效参数'}));app.get('/admin/db-rejected',(_req,res)=>res.status(400).json({error:'exceed_egress_quota'}));
 for(const url of ['/admin/data','/admin/stats','/admin/photos','/admin/ai-agent/users','/admin/db-rejected']){const r=await request(app).get(url).expect(402);assert.equal(r.body.code,'egress_quota_exceeded');assert.equal(r.body.retryable,false);}
 assert.equal((await request(app).get('/admin/login').expect(400)).body.code,'invalid_credentials');assert.equal((await request(app).get('/admin/invalid').expect(400)).body.error,'无效参数');
});
test('AB-17 local-day anomalies include the first eight hours in Asia/Shanghai',()=>{
 const old=process.env.TZ;process.env.TZ='Asia/Shanghai';try{const ActualDate=Date;class FixedDate extends ActualDate {constructor(...args){super(...(args.length?args:['2026-10-11T04:00:00.000Z']));}}const c=context({Date:FixedDate,allSecurityAlerts:[{created_at:'2026-10-10T16:30:00.000Z',level:'high',type:'same_ip_multi_users'}],securityTypeFilter:'all',securitySettings:{security_alerts:true},escapeHtml:String,formatTime:x=>x,formatTimeDetailed:x=>x,safeJsStr:String});vm.runInContext(section(admin,'window.renderSecurityTab = function(el)','// 标记安全提醒已读'),c);const el=node();c.window.renderSecurityTab(el);assert.match(el.innerHTML,/今日异常/);assert.match(el.innerHTML,/>1<\/div><div class="lbl">今日异常/);}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
test('AB-18 IP geolocation retains an IP source rather than an authorized precise label',async()=>{
 const x=route("app.get('/admin/stats/online'",'// Compatibility endpoint',{safeJsonParse:x=>JSON.parse(x||'{}'),normalizeDeviceSnapshot:()=>({}),onlineLocationText:x=>x.text,onlineDeviceCategory:()=> 'unknown',sanitizeError,supabase:{from:()=>fluent(q=>({data:q.filters?.media_type==='__user_info__'?[]:[{user_name:'alice',content:'{"ip_location":{"text":"IP region"}}',created_at:new Date().toISOString()}],error:null}))}}),r=response();await x.handler({query:{}},r);assert.equal(r.statusCode,200);assert.equal(r.body.users[0].location_source,'ip');
});
test('AB-02 legacy uploads project to the gateway, including every album attachment and avatar query versions',()=>{
 const raw='https://storage.test/storage/v1/object/public/uploads/posts/first.png';const item=operations.adminPostPayload({media_url:raw,media_items:[{media_url:raw},{media_url:raw.replace('first','second')}]},'https://storage.test');assert.match(item.media_url,/^\/api\/uploads\/media\?path=/);assert.equal(item.media_items.length,2);for(const media of item.media_items)assert.match(media.media_url,/^\/api\/uploads\/media\?path=/);
 const c=context({API_BASE:'https://api.test'});vm.runInContext(section(admin,'function adminMediaSource','async function fetchAdminAvatar'),c);assert.equal(c.adminVersionedMedia(item.media_url,3),'https://api.test'+item.media_url+'&v=3');
});

test('AB-02 administrator cookie gateway enforces validation/revocation before reading a private post original',async()=>{
 const express=require('express'),request=require('supertest'),access=require('../render-api/upload-access');
 const origin='https://storage.test',path='posts/private.png',raw=origin+'/storage/v1/object/public/uploads/'+path;
 let bytesRead=0;const rows=[{id:uuid,user_name:'alice',media_type:'image',media_url:raw,visibility:'private',is_deleted:false}];
 const supabase={from:table=>fluent(()=>({data:table==='post_attachments'?[]:rows,error:null})),storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://storage.test/signed-original'}})})}};
 const app=express();app.use((req,_res,next)=>{req.cookies=Object.fromEntries(String(req.get('cookie') || '').split(';').filter(Boolean).map(p=>p.trim().split('=')));next();});
 const c=context({app,supabase,SUPABASE_URL:origin,rateLimit:()=>((_req,_res,next)=>next()),optionalAuth:(_req,_res,next)=>next(),waitForRevocationState:async()=>true,_getTokenFromRequest:req=>req.headers.authorization?.slice(7),isTokenRevoked:token=>token==='revoked',verifySignedToken:token=>token==='verified-admin'?{user:'xxz'}:null,adminTokens:new Map(),require:name=>{assert.equal(name,'./upload-access');return {...access,installUploadAccess:(_app,options)=>access.installUploadAccess(_app,{...options,fetchImpl:async()=>{bytesRead++;return new Response(Buffer.from('unchanged-original'),{headers:{'content-type':'image/png'}});}})};}});
 vm.runInContext(section(server,'async function verifyToken(req, res, next)','// ===================== 健康检查'),c);
 vm.runInContext(section(server,"require('./upload-access').installUploadAccess",'// The service-role backed chat social API'),c);
 await request(app).get('/api/uploads/media').query({path}).expect(404);
 await request(app).get('/api/uploads/media').query({path}).set('Cookie','xtj_admin_token=invalid').expect(401);
 await request(app).get('/api/uploads/media').query({path}).set('Cookie','xtj_admin_token=revoked').expect(401);
 assert.equal(bytesRead,0);
 const result=await request(app).get('/api/uploads/media').query({path}).set('Cookie','xtj_admin_token=verified-admin').expect(200);assert.equal(result.body.toString(),'unchanged-original');assert.equal(bytesRead,1);
 rows[0].is_deleted=true;await request(app).get('/api/uploads/media').query({path}).set('Cookie','xtj_admin_token=verified-admin').expect(404);assert.equal(bytesRead,1);
});

test('AB-10/11 complete mail handler persists failed channel outcome and never clears it as a sent success',async()=>{
 const deliveries=[{email:'a@example.invalid',user_name:'a',status:'reserved'}];const states=[];
 const db={rpc:async(name,args)=>{
  if(name==='reserve_admin_email_job')return {data:{ok:true,created:true,id:uuid,status:'processing',deliveries},error:null};
  if(name==='claim_admin_email_delivery'){deliveries[0].status='sending';return {data:{ok:true,claimed:true},error:null};}
  if(name==='settle_admin_email_delivery'){states.push(args.p_status);deliveries[0].status=args.p_status;return {data:{ok:true},error:null};}
  if(name==='finish_admin_email_job')return {data:{ok:true,id:uuid,status:'completed',deliveries},error:null};
  assert.fail(name);
 }};
 const x=route("app.post('/admin/send-email'",'// 管理员：获取邮件发送历史',{normalizePostId,normalizeEmailAddress:e=>e.toLowerCase(),isValidEmailAddress:()=>true,sanitizeEmailHtml:x=>x,emailHtmlToText:x=>x,ADMIN_EMAIL_DAILY_MAX:500,GMAIL_USER:'from@example.invalid',logAdminAudit:async()=>{},saveEmailRecipientHistory:async()=>{},deliverAdminEmail:async()=>{const e=Error('channel rejected');e.deliveryState='failed';throw e;},emailFailureState:e=>e.deliveryState,maskEmailSendError:()=> '发送失败',supabase:db}),r=response();
 await x.handler({body:{request_id:uuid,recipients:[{email:'a@example.invalid'}],subject:'hello',content:'text'}},r);assert.deepEqual(states,['failed']);assert.equal(r.body.ok,false);assert.equal(r.body.sent_count,0);assert.equal(r.body.failed_count,1);
});

test('AB-10 a finished delivery ledger is recoverable after a database outage without another mail send',async()=>{
 const calls=[];const job={id:uuid,status:'processing',deliveries:[{status:'sent'}]};
 const recovered=await operations.recoverEmailJob({rpc:async(name,args)=>{calls.push([name,args]);return {data:{ok:true,id:uuid,status:'completed',deliveries:job.deliveries},error:null};}},job,'from@example.invalid');
 assert.equal(recovered.status,'completed');assert.equal(calls.length,1);assert.equal(calls[0][0],'finish_admin_email_job');
 const inFlight={...job,deliveries:[{status:'sending'}]};assert.equal(await operations.recoverEmailJob({rpc:()=>assert.fail('live job may not be finalized')},inFlight),inFlight);
});
test('mail progress recovery removes only confirmed recipients from the old job and preserves newer selections and draft',async()=>{
 const cache=new Map([['xtj_email_pending_job',JSON.stringify({id:uuid})],['xtj_email_draft_content','new draft']]);const checkboxes=['sent','failed','new'].map(name=>({dataset:{email:name+'@example.invalid'},checked:true}));const tags=['sent','new'].map(name=>({dataset:{email:name+'@example.invalid'},removed:false,remove(){this.removed=true;}}));const nodes={};
 const c=context({sessionStorage:{getItem:key=>cache.get(key),removeItem:key=>cache.delete(key)},document:{getElementById:id=>nodes[id] ||= node(),querySelectorAll:selector=>selector==='.email-checkbox:checked'?checkboxes.filter(cb=>cb.checked):tags},emailUpdateCount(){},loadEmailHistory(){},showToast(){},apiCall:async()=>({status:'completed',sent_count:1,failed_count:1,unknown_count:0,recipients_detail:[{email:'sent@example.invalid',status:'sent'},{email:'failed@example.invalid',status:'failed'}]})});
 vm.runInContext(section(admin,'window.emailQueryPendingJob = async function','window.emailSend = async function'),c);await c.window.emailQueryPendingJob();assert.deepEqual(checkboxes.map(cb=>cb.checked),[false,true,true]);assert.deepEqual(tags.map(tag=>tag.removed),[true,false]);assert.equal(cache.get('xtj_email_draft_content'),'new draft');assert.equal(cache.has('xtj_email_pending_job'),false);
});
