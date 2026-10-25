'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module'),{spawnSync}=require('node:child_process');
const {parseStatisticsRange}=require('../render-api/admin-statistics');
const source=fs.readFileSync('render-api/server.js','utf8');
function summary(n){return{total_posts:n,total_users:n,total_comments:n,total_likes:n,total_photos:n,total_visits:n,total_attacks:n,firewall_intercepts:0,daily_visits:{},daily_attacks:{},attack_types:{},truncated:false,cached_at:new Date().toISOString()};}
function routeFixture(){let handler;const requests=[];const context=vm.createContext({require:createRequire(require.resolve('../render-api/server.js')),Date,STATS_CACHE_TTL:60000,statsCache:{data:null,ts:0,pending:null},verifyToken(){},rateLimit:()=>null,app:{get(...args){handler=args.at(-1)}},supabase:{rpc(name,args){assert.equal(name,'admin_statistics');return new Promise(resolve=>requests.push({args,resolve}));}}});
 const a=source.indexOf("app.get('/admin/stats',"),b=source.indexOf('// 攻击详情 API',a);vm.runInContext(source.slice(a,b),context);
 const response=()=>({statusCode:200,status(n){this.statusCode=n;return this},json(value){this.body=value;return this}});
 return{context,requests,async request(query={}){const res=response();await handler({query},res);return res}};
}
test('statistics reject invalid dates without querying the database',()=>{
 for(const query of [{start:'0000-01-01'},{start:'2026-02-30'},{start:[]},{end:'2026-10-24T00:00Z'},{start:'2026-10-24',end:'2026-10-23'}])assert.throws(()=>parseStatisticsRange(query),{status:400});
 assert.deepEqual(parseStatisticsRange({start:'2026-10-23',end:'2026-10-24'}),{start:'2026-10-23',end:'2026-10-24'});
});
test('statistics cache deduplicates reads but an invalidated old generation cannot restore stale totals',async()=>{
 const f=routeFixture(),old=f.request(),same=f.request();assert.equal(f.requests.length,1);
 f.context.statsCache={data:null,ts:0,pending:null};const fresh=f.request();assert.equal(f.requests.length,2);
 f.requests[1].resolve({data:{summary:summary(22),daily:[]}});assert.equal((await fresh).body.total_posts,22);
 f.requests[0].resolve({data:{summary:summary(11),daily:[]}});await old;await same;assert.equal((await f.request()).body.total_posts,22);
});
test('invalid or failed filtered statistics never discard an unrelated in-flight global query',async()=>{
 const f=routeFixture(),pending=f.request();assert.equal((await f.request({start:'bad'})).statusCode,400);
 const filtered=f.request({start:'2026-10-24'});f.requests[1].resolve({error:{code:'08006'}});assert.equal((await filtered).statusCode,503);
 const shared=f.request();assert.equal(f.requests.length,2);f.requests[0].resolve({data:{summary:summary(10),daily:[]}});assert.equal((await pending).body.total_posts,10);assert.equal((await shared).body.total_posts,10);
});
test('sandbox bounds logs and return strings before host transfer, without retaining large backing stores',{timeout:60000},()=>{
 const child=spawnSync(process.execPath,['--expose-gc','--max-old-space-size=192','-e',`const s=require('./render-api/sandbox');s.runInSandbox('return 1');const results=[];for(const code of ['const text="x".repeat(1024*1024);for(let i=0;i<48;i++)console.log(text);return 1','return "x".repeat(24*1024*1024)','String.prototype.slice=function(){return this.toString()};console.log("x".repeat(24*1024*1024));return 1','String.prototype.slice=function(){return this.toString()};return "x".repeat(24*1024*1024)','return 1;})();return {text:"x".repeat(24*1024*1024),truncated:false};const ignored=(function(){','return 1;})();return {get text(){String.prototype.slice=function(){return this.toString()};return "x".repeat(24*1024*1024)}};const ignored=(function(){']){global.gc();const before=process.memoryUsage().heapUsed;const out=s.runInSandbox(code);global.gc();results.push({length:out.length,delta:process.memoryUsage().heapUsed-before});}console.log(JSON.stringify(results));`],{cwd:process.cwd(),timeout:45000,encoding:'utf8',maxBuffer:1024*1024});
 assert.equal(child.status,0,child.stderr);for(const row of JSON.parse(child.stdout.trim())){assert.ok(row.length<=8050);assert.ok(row.delta<8*1024*1024,JSON.stringify(row));}
 const sandbox=require('../render-api/sandbox');assert.equal(sandbox.runInSandbox('return typeof __hostLog'),'undefined');assert.match(sandbox.runInSandbox('console.warn("kept");return {value:42}'),/\[warn\] kept[\s\S]*"value": 42/);
});

test('refresh client retains its random nonce across failed attempts and a reload, then clears only its acknowledged intent',async()=>{
 const crypto=require('node:crypto'),storage=new Map(),requests=[];
 const script=fs.readFileSync('js/core-parts/01-bootstrap.js','utf8'),start=script.indexOf('var _authStateEpoch = 0;'),end=script.indexOf('            /**',script.indexOf('async function refreshUserTokenViaCookie()',start));
 function client(success){const context=vm.createContext({window:{crypto:crypto.webcrypto},navigator:{},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},API_BASE:'',getXtjDeviceId:()=>'',setUserToken(){},Date,setTimeout:fn=>fn(),fetch:async(url,options)=>{requests.push(JSON.parse(options.body));if(!success)throw Error('response lost');return{ok:true,status:200,json:async()=>({token:'confirmed',user_name:'alice'})}}});vm.runInContext(script.slice(start,end),context);return context;}
 assert.equal((await client(false).refreshUserTokenViaCookie()).token,'');assert.equal(requests.length,2);const nonce=requests[0].refresh_request_id;assert.match(nonce,/^[0-9a-f-]{36}$/);assert.equal(requests[1].refresh_request_id,nonce);assert.equal(storage.get('xtj_pending_refresh_request'),nonce);
 const reloaded=client(true);assert.equal((await reloaded.refreshUserTokenViaCookie()).token,'confirmed');assert.equal(requests[2].refresh_request_id,nonce);assert.equal(storage.size,0);
 await reloaded.refreshUserTokenViaCookie();assert.notEqual(requests[3].refresh_request_id,nonce);
 storage.set('xtj_pending_refresh_request','another-intent');reloaded.clearPendingRefreshRequest(nonce);assert.equal(storage.get('xtj_pending_refresh_request'),'another-intent');
});
test('relation cursors reject already-rounded unsafe JSON numeric identifiers',()=>{
 const {parseRelationCursor}=require('../render-api/post-interactions');assert.throws(()=>parseRelationCursor({id:9007199254740992,at:'2026-10-24T00:00:00Z'}),/invalid_cursor/);assert.equal(parseRelationCursor({id:'9223372036854775807',at:'2026-10-24T00:00:00Z'}).id,'9223372036854775807');
});

test('AI administrator indices preserve prototype-shaped names, report actual server caps and use the quota calendar day',async()=>{
 const {createRequire}=require('node:module'),RealDate=Date;class Clock extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-24T01:00:00Z']));}static now(){return RealDate.parse('2026-10-24T01:00:00Z');}}
 const rows=['constructor','__proto__','toString'].map((name,i)=>({id:'local-'+i,user_name:name,media_url:JSON.stringify({role:'assistant',convId:'constructor',usage:{total_tokens:3,prompt_tokens:1,completion_tokens:2}}),content:'reply',created_at:i===0?'2026-10-23T20:00:00.000Z':'2026-10-24T00:00:00.000Z'}));
 const routes=new Map(),context=vm.createContext({Date:Clock,require:createRequire(require.resolve('../render-api/server.js')),console,AI_AGENT_MESSAGE_MARKER:'__ai_agent_msg__',DEEPSEEK_CURRENCY:'CNY',DEEPSEEK_MODEL_REASONER:'deepseek',normalizeDeepSeekUsageModel:x=>x,aiConversationActorPattern:x=>x,verifyToken(){},securityRateLimit(){},app:{get(path,...parts){routes.set(path,parts.at(-1))}},supabase:{from(){const q={select(fields,options){assert.equal(options.count,'exact');return q},eq(){return q},gte(){return q},filter(){return q},or(){return q},order(){return q},limit(){return q},then(resolve,reject){return Promise.resolve({data:rows,count:1005}).then(resolve,reject)}};return q}}});
 const metaStart=source.indexOf('function parseMsgMeta(');vm.runInContext(source.slice(metaStart,source.indexOf('function getConvIdFromActorKey(',metaStart)),context);
 const start=source.indexOf("app.get('/admin/ai-agent/usage-summary',"),end=source.indexOf('// POST /admin/ai-agent/cleanup',start);vm.runInContext(source.slice(start,end),context);
 async function request(path,query={}){const res={statusCode:200,status(n){this.statusCode=n;return this},json(body){this.body=body;return this}};await routes.get(path)({query},res);assert.equal(res.statusCode,200);return res.body;}
 const summary=await request('/admin/ai-agent/usage-summary');assert.equal(summary.summary.total_users,3);assert.equal(summary.summary.today_calls,3,'00:00 Shanghai includes the preceding UTC evening');assert.equal(summary.truncated,true);assert.equal(summary.loaded_rows,3);assert.equal(summary.matched_rows,1005);
 const allUsers=await request('/admin/ai-agent/users',{days:'all'});assert.equal(allUsers.window_days,'all');
 const users=await request('/admin/ai-agent/users');assert.deepEqual(new Set(users.users.map(u=>u.user_name)),new Set(rows.map(r=>r.user_name)));assert.ok(users.users.every(u=>u.message_count===1&&u.conversation_count===1&&u.total_tokens===3));assert.equal(users.truncated,true);
 const conversations=await request('/admin/ai-agent/conversations',{user_name:'alice'});assert.equal(conversations.conversations[0].conversation_id,'constructor');assert.equal(conversations.conversations[0].message_count,3);assert.equal(conversations.truncated,true);
 const legacy=await request('/admin/ai-agent/conversation',{user_name:'alice',conversation_id:'legacy'});assert.equal(legacy.truncated,true);
 const detail=await request('/admin/ai-agent/conversation',{user_name:'alice',conversation_id:'constructor'});assert.equal(detail.has_more,true);assert.ok(detail.next_cursor);
 assert.equal(vm.runInContext('Object.prototype.message_count',context),undefined);
});
