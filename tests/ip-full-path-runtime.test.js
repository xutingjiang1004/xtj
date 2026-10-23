'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const express=require('express'),request=require('supertest');
const tools=require('../js/ip-location'),cityData=require('../js/ip-city-data');
const {createIpGeocoder}=require('../render-api/ip-geolocation');
const {installAccountProfile}=require('../render-api/account-events');
const server=fs.readFileSync('render-api/server.js','utf8'),admin=fs.readFileSync('js/admin/admin.js','utf8');
const posts=fs.readFileSync('js/core-parts/04-posts-interactions.js','utf8'),auth=fs.readFileSync('js/core-parts/02-auth-restrictions.js','utf8');
const ip='8.8.8.8',nextIp='1.1.1.1',ipv6='2001:4860:4860::8888',before='2026-10-23T01:00:00.000Z',after='2026-10-23T02:00:00.000Z';
const location=(address=ip)=>({source_ip:address,country:'中国',region:'浙江',city:'湖州',text:'中国 · 浙江 · 湖州',city_confidence:'single_source',resolved_at:before});
const event=(address=ip)=>({ip:address,source:'login_success',authority:'server_authentication',method:'password',login_at:before});
function part(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function queryStore(resolver){return{from(){const q={filters:{}};const chain={select(){return chain;},eq(k,v){q.filters[k]=v;return chain;},in(){return chain;},gte(){return chain;},order(){return chain;},limit(){return chain;},maybeSingle(){q.single=true;return chain;},then(ok,bad){return Promise.resolve().then(()=>resolver(q)).then(data=>ok({data:q.single?data[0]||null:data,error:null}),bad);}};return chain;},async rpc(){return{data:{},error:null};}};}
function response(){return{statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};}

test('offline city snapshot is bounded, code-unique, and resolves independently chosen cities and ambiguous aliases',()=>{
 assert.equal(cityData.length,333);assert.equal(new Set(cityData.map(row=>row[3])).size,333);
 for(const [region,name,aliases,code] of cityData){assert.ok(region&&name&&aliases.length);assert.match(code,/^\d{6}$/);}
 for(const [region,english,chinese] of [['浙江','Huzhou','湖州'],['宁夏','Yinchuan','银川'],['安徽',"Lu'an",'六安'],['内蒙古','Ordos','鄂尔多斯'],
  ['内蒙古','Hohhot','呼和浩特'],['河北','Qinhuangdao','秦皇岛'],['福建','Ningde','宁德'],['广西','Fangchenggang','防城港'],
  ['江西','Jingdezhen','景德镇'],['西藏','Shigatse','日喀则'],['新疆','Karamay','克拉玛依'],['黑龙江','Qiqihar','齐齐哈尔'],['安徽','Su Zhou','宿州'],['江西','Fuzhou City','抚州']]){
   const value=tools.selectIpLocation(['a','b'].map(provider=>({provider,country:'CN',region,city:english})),ip);
   assert.equal(value.city,chinese,region+' '+english);assert.equal(value.city_confidence,'corroborated');
 }
 const invalid=tools.selectIpLocation(['a','b'].map(provider=>({provider,country:'CN',region:'安徽',city:'湖州'})),ip);
 assert.equal(invalid.city,'');assert.equal(invalid.sources[0].raw_city,'湖州');
 const unknown=tools.selectIpLocation([{provider:'a',country:'CN',region:'constructor',city:'Suzhou'}],ip);
 assert.equal(unknown.region,'');assert.equal(unknown.city,'');assert.equal(unknown.sources[0].raw_region,'constructor');
});
test('Pconline names cannot contradict province or prefecture codes even within the same province',()=>{
 const parse=row=>tools.parsePconlineGeoText(JSON.stringify({ip,err:'',...row}),ip);
 assert.equal(parse({pro:'安徽省',proCode:'330000',city:'合肥市',cityCode:'330100'}),null);
 assert.equal(parse({pro:'浙江省',proCode:'330000',city:'湖州市',cityCode:'330100'}).city,'');
 assert.equal(parse({pro:'浙江省',proCode:'330000',city:'湖州市',cityCode:'330500'}).city,'湖州');
});
test('provider coordinates preserve valid zero and reject out-of-range estimates',()=>{
 for(const invalid of [false,true]){
  const value=tools.selectIpLocation([{provider:'a',country:'US',region:'California',city:'Los Angeles',latitude:invalid?91:0,longitude:invalid?181:0}],ip);
  assert.equal(value.latitude,invalid?null:0);assert.equal(value.longitude,invalid?null:0);
 }
});
test('autonomous-prefecture short names agree, and overseas duplicates never invent a Chinese city suffix',()=>{
 const value=tools.selectIpLocation([{provider:'a',country:'CN',region:'吉林',city:'延边'},{provider:'b',country:'中国',region:'吉林',city:'延边朝鲜族自治州'}],ip);
 assert.equal(value.city,'延边朝鲜族自治州');assert.equal(value.city_confidence,'corroborated');
 const overseas=tools.selectIpLocation([{provider:'a',country:'Singapore',region:'Singapore',city:'Singapore'}],ip);
 assert.equal(overseas.text,'新加坡');assert.doesNotMatch(overseas.text,/市/);
});
test('browser and Node instantiate identical address, range, snapshot and public-label rules',()=>{
 const browser=vm.createContext({URL});
 vm.runInContext(fs.readFileSync('js/ip-city-data.js','utf8')+'\n'+fs.readFileSync('js/ip-location.js','utf8'),browser);
 for(const address of [ip,'::ffff:808:808',ipv6,'[2001:4860:4860:0:0:0:0:8888]:443','fe80::1%eth0','2a06:98c0:3600::103','192.0.2.1','unknown','8.8.8.8, 1.1.1.1']){
  assert.equal(browser.XtjIpLocation.normalizeIpAddress(address),tools.normalizeIpAddress(address));assert.equal(browser.XtjIpLocation.isPublicIpAddress(address),tools.isPublicIpAddress(address));
 }
 const rows=[{provider:'a',country:'CN',region:'浙江',city:'Huzhou'},{provider:'b',country:'中国',region:'浙江',city:'湖州'}];
 assert.deepEqual(JSON.parse(JSON.stringify(browser.XtjIpLocation.selectIpLocation(rows,ip,1))),tools.selectIpLocation(rows,ip,1));
});
test('public labels give explicit server states precedence over stale columns and embedded metadata',()=>{
 for(const [post,text] of [[{ip_region_status:'failed',ip_province:'浙江',ip_region_text:'浙江 湖州'},'未知'],
  [{ip_region_status:'pending',ip_province:'浙江',_contentMeta:{ip_region_text:'广东 深圳'}},'解析中'],
  [{ip_region_status:null,ip_region_text:null,ip_province:null,_contentMeta:{ip_region_status:'resolved',ip_province:'广东'}},''],
  [{_contentMeta:{ip_region_text:'China · Zhejiang · Hangzhou'}},'历史未核对'],[{ip_region_text:'中国 · 广东 · 深圳'},'广东'],
  [{ip_region_text:'杭州市'},'未知'],[{ip_province:'杭州市'},'未知'],[{ip_province:'California',ip_city:'Los Angeles'},'California']]){
   assert.equal(tools.postIpView(post).text,text);
 }
});
test('post cache keeps explicit null/status fields and terminal states stop polling',()=>{
 const context=vm.createContext({normalizePost:value=>value,postInfoCache:{},window:{XtjIpLocation:tools},escapeHtml:String});
 vm.runInContext(part(posts,'            function syncPostInfoCache(', '            let feedVisiblePostsCache'),context);
 vm.runInContext(part(posts,'            function postNeedsIpRefresh(', '            function refreshPublishedPostCard('),context);
 vm.runInContext(part(posts,'            function buildPostLocationHtml(', '            // 供 core-parts/06'),context);
 context.syncPostInfoCache({id:'post',ip_region_status:'failed',ip_province:null,ip_region_text:null,ip_lookup_started_at:before,_contentMeta:{ip_province:'广东',ip_city:'深圳'}});
 assert.match(context.buildPostLocationHtml(context.postInfoCache.post),/IP属地：未知/);assert.equal(context.postNeedsIpRefresh(context.postInfoCache.post),false);
 assert.equal(context.postNeedsIpRefresh({id:'p',ip_region_status:'resolved',ip_lookup_started_at:before}),false);
 assert.equal(context.postNeedsIpRefresh({id:'p',ip_region_status:'pending',ip_region_text:'stale'}),true);
});
test('current IP, geography and time are one snapshot, with no older-event or GPS fallback',()=>{
 const saved={last_ip:nextIp,last_login:after,last_auth_event_id:'new',last_ip_location:null,last_precise_location:{country:'中国',city:'GPS 城市'}};
 assert.equal(tools.ipSnapshot(saved,{...event(ip),created_at:before,ip_location:location()}).ip,nextIp);
 assert.equal(tools.ipSnapshot(saved,{...event(nextIp),id:'old',created_at:before,ip_location:location(nextIp)}).location,null);
 assert.equal(tools.ipSnapshot({last_ip:ip,last_login:before,last_ip_location:location()}, {...event(nextIp),created_at:after,ip_location:location(nextIp)}).ip,nextIp);
 assert.equal(tools.locationForIp({...location(),source:'gps'},ip,ip),null);
 assert.equal(tools.locationForIp(location(),nextIp,nextIp),null);
 assert.equal(tools.locationForIp({},ip,ip),null);
 assert.equal(tools.locationForIp(location(),'::ffff:808:808',ip).city,'湖州');
});
test('administrator directory merges preserve IP/event binding and explicit clears rather than reviving old cities',()=>{
 const context=vm.createContext({pickEarlierAdminIso:(a,b)=>a||b});
 vm.runInContext(part(admin,'    function mergeAdminUserInfo(', '    // ★ 修复：头像请求'),context);
 const newer={last_login:after,last_ip:nextIp,last_ip_location:location(nextIp),last_ip_location_ip:nextIp,last_auth_event_id:'new'};
 const older={last_login:before,last_ip:ip,last_ip_location:location(),last_ip_location_ip:ip,last_auth_event_id:'old'};
 const value=context.mergeAdminUserInfo(newer,older);assert.equal(value.last_ip,nextIp);assert.equal(value.last_auth_event_id,'new');
 const empty=context.mergeAdminUserInfo(newer,{});assert.equal(empty.last_ip,null);assert.equal(empty.last_ip_location,null);assert.equal(empty.last_login,null);
});
test('backend directory serialization retains the newest complete IP binding rather than mixing duplicate snapshots',()=>{
 const context=vm.createContext({safeJsonParse:value=>JSON.parse(value||'{}'),pickEarlierIso:(a,b)=>a&&b?(a<b?a:b):a||b||null,pickLaterIso:(a,b)=>a&&b?(a>b?a:b):a||b||null,toTimeMs:value=>Date.parse(value)});
 vm.runInContext(part(server,'function buildAuthUserMap(', 'function buildRegisteredUsersByDate('),context);
 const rows=[{user_name:'alice',content:JSON.stringify({last_login:before,last_ip:ip,last_ip_location:location(),last_ip_location_ip:ip,last_auth_event_id:'old'})},
 {user_name:'alice',content:JSON.stringify({last_login:after,last_ip:nextIp,last_ip_location:null,last_ip_location_ip:null,last_auth_event_id:'new'})}];
 const value=JSON.parse(context.buildAdminUsersPayload([],rows)[0].content);
 assert.equal(value.last_ip,nextIp);assert.equal(value.last_ip_location,null);assert.equal(value.last_auth_event_id,'new');
});
function route(start,end,db){let handler;const context=vm.createContext({require,console:{error(){}},supabase:db,verifyToken(){},rateLimit:()=>()=>{},ADMIN_USERNAME:'xxz',
 ...require('../render-api/post-markers'),
 app:{get(_path,...args){handler=args.at(-1);}},safeJsonParse:value=>JSON.parse(value||'{}'),normalizeDeviceSnapshot:()=>({type:'Desktop'}),onlineDeviceCategory:()=> 'desktop',
 onlineLocationText:value=>value?.text||'',logAdminAudit:async()=>{},sendAdminDbFailure(){assert.fail('unexpected database failure');}});
 vm.runInContext(part(server,start,end),context);return handler;}
test('online API uses matching authenticated facts and refuses stale-profile, activity and GPS cities',async()=>{
 const db=queryStore(q=>q.filters.media_type==='__user_info__'?[{user_name:'alice',content:JSON.stringify({last_login:after,last_ip:nextIp,last_ip_location:location(),last_ip_location_ip:ip,last_precise_location:{text:'GPS 城市'}})}]
  :q.filters.media_type==='__login_event__'?[{id:'old',user_name:'alice',content:JSON.stringify({...event(),ip_location:location()}),created_at:before}]
  :[{user_name:'alice',content:JSON.stringify({ip:'6.6.6.6',ip_location:{text:'活动伪造城市'}}),created_at:after}]);
 const res=response();await route("app.get('/admin/stats/online'",'// Compatibility endpoint',db)({query:{}},res);
 assert.equal(res.statusCode,200);assert.equal(res.body.users[0].ip,nextIp);assert.equal(res.body.users[0].location,'');assert.equal(res.body.users[0].location_source,'unavailable');
});
test('profile API groups mapped addresses and keeps current geography tied to current IP',async()=>{
 const rows=[{...event('::ffff:808:808'),ip_location:location()},{...event(),ip_location:location()}, {ip:'6.6.6.6',source:'page_visit',login_at:after}];
 const db=queryStore(q=>q.filters.media_type==='__user_info__'?[{content:JSON.stringify({last_login:after,last_ip:nextIp,last_ip_location:location(),last_ip_location_ip:ip})}]
  :q.filters.media_type==='__login_event__'?rows.map((row,index)=>({id:'e'+index,content:JSON.stringify(row),created_at:before})):[]);
 const res=response();await route("app.get('/admin/user-profile'",'// ===================== 实时在线用户',db)({query:{user_name:'alice'}},res);
 assert.equal(res.statusCode,200);assert.equal(res.body.latest_ip,nextIp);assert.equal(res.body.latest_location,null);assert.equal(res.body.unique_ips.length,1);assert.equal(res.body.unique_ips[0].count,2);
});
test('own-profile endpoint scopes every read to the authenticated user and omits mismatched geography and GPS',async()=>{
 const calls=[];const db=queryStore(q=>{calls.push(q);assert.equal(q.filters.user_name,'alice');return q.filters.media_type==='__auth__'?[{created_at:before}]:[{content:JSON.stringify({last_login:after,last_ip:ip,last_ip_location:location(nextIp),last_ip_location_ip:nextIp,last_precise_location:{text:'private GPS'}})}];});
 const app=express();installAccountProfile(app,{supabase:db,authenticateUser(req,res,next){req.userName='alice';next();},rateLimit:()=> (_req,_res,next)=>next()});
 const res=await request(app).get('/api/user/profile?user_name=bob');assert.equal(res.status,200);assert.equal(res.body.info.last_ip,ip);assert.equal(res.body.info.last_ip_location,null);assert.doesNotMatch(JSON.stringify(res.body),/private GPS|bob/);assert.equal(calls.length,2);
});
test('browser reads server facts without direct database writes, preserves confidence and rejects delayed other-account results',async()=>{
 const requests=[];const context=vm.createContext({currentUser:'alice',_authStateEpoch:1,window:{XtjIpLocation:tools,xtjProtectedFetch:(_path,options)=>{const pending=deferred();requests.push({pending,options});return pending.promise;}},sb:{from(){assert.fail('browser must not access private profile rows');}}});
 vm.runInContext(part(auth,'            function normalizeUserInfoSnapshot(', '            var authModalFocusOrigin'),context);
 const first=context.loadCurrentUserInfoSnapshot('alice');context.loadCurrentUserInfoSnapshot('alice');assert.equal(requests.length,1);
 context.currentUser='bob';context._authStateEpoch=2;const second=context.loadCurrentUserInfoSnapshot('bob');
 requests[1].pending.resolve({ok:true,json:async()=>({ok:true,user_name:'bob',registered_at:before,info:{last_login:after,last_ip:nextIp,last_ip_location:location(nextIp),last_ip_location_ip:nextIp}})});await second;
 requests[0].pending.resolve({ok:true,json:async()=>({ok:true,user_name:'alice',info:{last_ip:ip,last_ip_location:location(),last_ip_location_ip:ip}})});await first;
 assert.equal(context.window.currentUserInfoSnapshot.last_ip,nextIp);assert.equal(context.window.currentUserInfoSnapshot.last_ip_location.city_confidence,'single_source');
 await context.saveUserInfo('alice');assert.equal(requests.length,2);
});
test('CF metadata belongs to the platform client IP, never colo, request body or forged city headers',()=>{
 const req=new Request('https://x.invalid',{headers:{'cf-connecting-ip':ip,'cf-ipcity':'ForgedCity'}});Object.defineProperty(req,'cf',{value:{country:'CN',region:'Zhejiang',regionCode:'ZJ',city:'Huzhou',colo:'HKG'}});
 const value=tools.cloudflareLocation(req,ip,1);assert.equal(value.city,'湖州');assert.equal(value.city_confidence,'single_source');assert.equal(value.provider,'cloudflare');
 assert.equal(tools.cloudflareLocation(req,nextIp),null);assert.equal(tools.cloudflareLocation(new Request('https://x.invalid',{headers:{'cf-connecting-ip':ip}}),ip),null);
 const conflicted=new Request(req);Object.defineProperty(conflicted,'cf',{value:{country:'CN',region:'Zhejiang',regionCode:'GD',city:'Huzhou'}});
 assert.equal(tools.cloudflareLocation(conflicted,ip).city,'');assert.equal(tools.cloudflareLocation(conflicted,ip).city_confidence,'conflict');
});
test('Pseudo IPv4 recovery requires actual CF trust and anonymous cross-zone relays never become visitors',()=>{
 const {getClientIp}=new Function('require','isPrivateOrReservedIp',part(server,'function normalizeClientIpValue(', '// AI site tools')+';return {getClientIp};')(
  name=>name.startsWith('./')?require('../render-api/'+name.slice(2)):require(name),value=>!tools.isPublicIpAddress(value));
 const headers={'x-forwarded-for':'241.1.1.1, 173.245.48.1','cf-connecting-ip':'241.1.1.1','cf-connecting-ipv6':ipv6};
 assert.equal(getClientIp({ip:'241.1.1.1',socket:{remoteAddress:'173.245.48.1'},headers}),ipv6);
 assert.notEqual(getClientIp({ip:'241.1.1.1',socket:{remoteAddress:'10.0.0.1'},headers:{...headers,'x-forwarded-for':'241.1.1.1, 10.0.0.1'}}),ipv6);
 assert.equal(getClientIp({ip:nextIp,socket:{remoteAddress:nextIp},headers}),nextIp);
 assert.equal(getClientIp({ip:'2a06:98c0:3600::103',socket:{remoteAddress:'173.245.48.1'},headers:{'x-forwarded-for':'8.8.8.8, 2a06:98c0:3600::103, 173.245.48.1'}}),'unknown');
 assert.equal(tools.cloudflareClientIp(new Request('https://x.invalid',{headers:{'cf-connecting-ip':'241.1.1.1','cf-connecting-ipv6':ipv6}})),ipv6);
 assert.equal(tools.cloudflareClientIp(new Request('https://x.invalid',{headers:{'cf-connecting-ip':'2a06:98c0:3600::103'}})),'');
});
test('late pre-refresh failures cannot replace the newest lookup diagnostics',async()=>{
 const old=[];let fresh=false;
 const geocoder=createIpGeocoder({isPrivateOrReservedIp:value=>!tools.isPublicIpAddress(value),fetch:async url=>{
  const host=new URL(url).hostname;
  if(!fresh){const pending=deferred();old.push(pending);return pending.promise;}
  if(host==='opendata.baidu.com')return new Response(JSON.stringify({status:'0',data:[{location:'浙江省湖州市'}]}));
  if(host==='whois.pconline.com.cn')return new Response(JSON.stringify({ip,pro:'浙江省',city:'湖州市'}),{headers:{'content-type':'application/json;charset=utf-8'}});
  return new Response('',{status:503});
 }});
 const first=geocoder.resolve(ip);await tick();fresh=true;await geocoder.resolve(ip,{forceRefresh:true});old.forEach(pending=>pending.resolve(new Response('',{status:503})));await first;
 assert.equal(geocoder.getDiagnostics(ip).length,2);assert.ok(geocoder.getDiagnostics(ip).every(row=>row.response_schema_valid===true));
});
