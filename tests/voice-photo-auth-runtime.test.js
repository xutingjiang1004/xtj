'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {readAuthRecord}=require('../render-api/auth-record');const {ownsPhotoUpload}=require('../render-api/photo-ownership');const {validatePhotoCreatePayload}=require('../render-api/photo-create');
const source=fs.readFileSync(require.resolve('../render-api/server'),'utf8');
function db(results){const calls=[];return {calls,from(){const q={select(v){calls.push(v);return this;},eq(){return this;},order(){calls.push('latest');return this;},limit(){return this;},async maybeSingle(){return results.shift();}};return q;}};}
test('account lookup separates missing accounts, transient database errors and duplicate fallback errors',async()=>{
 assert.equal(await readAuthRecord(db([{data:null,error:null}]),'B','__auth__'),null);
 for(const results of [[{error:{code:'timeout'}}],[{error:{code:'PGRST116'}},{error:{code:'timeout'}}]])await assert.rejects(readAuthRecord(db(results),'B','__auth__'),e=>e.code==='timeout');
 const d=db([{error:{code:'PGRST116'}},{data:{id:'B'},error:null}]);assert.equal((await readAuthRecord(d,'B','__auth__')).id,'B');assert.ok(d.calls.includes('latest'));
});
function handlerFixture(api,actor,lookupError=false){
 const posts=[{id:'photo-a',user_name:'A',media_type:'__photo_wall__',actor_key:'photo-a'}, {id:'post-a',user_name:'A',media_type:'image',actor_key:'post-a'}];let route,passed=false;const calls=[];
 const supabase={from(table){let filters=[];return {select(){return this;},eq(k,v){filters.push([k,v]);return this;},async maybeSingle(){const type=filters.find(([k])=>k==='media_type');if(type && type[1]==='__auth__')return lookupError?{data:null,error:{code:'timeout'}}:{data:{id:'registered'},error:null};const candidates=table==='photo_upload_registry'?[{storage_path:'photos/known-id_1700000000000_rand_photo.jpg',user_name:'A',upload_id:'known-id'}]:posts;return {data:candidates.find(p=>filters.every(([k,v])=>p[k]===v)) || null,error:null};}};}};
 const context={console,Date,readAuthRecord,ownsPhotoUpload,validatePhotoCreatePayload,SUPABASE_URL:'https://example.supabase.co',userBanError:()=>null,supabase,AUTH_MARKER:'__auth__',ADMIN_USERNAME:'xxz',waitForRevocationState:async()=>true,_getTokenFromRequest:r=>r.headers.authorization,verifyUserAccessToken:token=>token===actor+'-signed'?{user_name:actor}:null,isTokenRevoked:()=>false,loadUserRestrictions:async()=>({}),applyAuthenticatedWriteRestrictions:()=>null,normalizePostId:x=>x,collectPhotoStoragePaths:()=>[],isNormalPost:p=>p.media_type==='image',sanitizeError:()=>'',rateLimit:()=>()=>{},app:{post(path,...args){route=args;}},hardDeleteContent:async params=>{calls.push(params);return {result:{ok:true,deleted:true}};}};
 vm.createContext(context);const start=source.indexOf('async function authenticateUser('),end=source.indexOf('\nconst dmPrivateStorage',start);vm.runInContext(source.slice(start,end),context);
 const a=source.indexOf("app.post('"+api+"'"),b=source.indexOf('\n});',a)+5;assert.ok(a>0&&b>a);vm.runInContext(source.slice(a,b),context);
 const req={headers:{authorization:actor+'-signed'},body:{path:'photos/known-id_1700000000000_rand_photo.jpg',upload_id:'known-id',media_url:'https://example.supabase.co/storage/v1/object/public/uploads/photos/known-id_1700000000000_rand_photo.jpg',file_size:100,original_size:100,mime_type:'image/jpeg',photoId:'photo-a',post_id:'post-a',user_name:'A',is_admin:true,actor_user:'xxz'}};const res={statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
 return {calls,res,async run(){await route[0](req,res,()=>{passed=true;});if(passed)await route.at(-1)(req,res);return res;}};
}
test('forged owner and administrator fields cannot delete another user’s photo or post; owners and xxz retain deletion',async()=>{
 for(const api of ['/api/photo/delete','/api/post/delete']){
  const other=handlerFixture(api,'B');await other.run();assert.equal(other.res.statusCode,403);assert.equal(other.calls.length,0);
  for(const actor of ['A','xxz']){const own=handlerFixture(api,actor);await own.run();assert.equal(own.res.statusCode,200);assert.equal(own.calls.length,1);assert.equal(own.calls[0].actorUser,actor);assert.equal(own.calls[0].isAdmin,actor==='xxz');}
  const outage=handlerFixture(api,'B',true);await outage.run();assert.equal(outage.res.statusCode,503);assert.equal(outage.res.body.retryable,true);assert.equal(outage.calls.length,0);
 }
});
function transcriptionFixture(sent=true){const workers=[],states=[],calls=[],results=[];let saveFails=false;
 const window={currentUser:'A',addEventListener(){},AudioContext:class{async decodeAudioData(){return {duration:1};}async close(){}},OfflineAudioContext:class{createBufferSource(){return {connect(){},start(){}};}async startRendering(){return {getChannelData:()=>new Float32Array(16000)};}},xtjProtectedFetch:async(path,init)=>{calls.push({path,init});return {ok:!saveFails,json:async()=>saveFails?{ok:false,error:'保存失败'}:{ok:true,message:{id:'voice'}}};}};
 class Worker{constructor(){workers.push(this);}postMessage(data){this.data=data;}terminate(){this.terminated=true;}}
 const context={window,document:{currentScript:{src:'https://example.test/js/voice-transcription.js'}},Worker,URL,AbortController,fetch,Float32Array,Map,setTimeout,clearTimeout,console};vm.runInNewContext(fs.readFileSync(require.resolve('../js/voice-transcription.js'),'utf8'),context);
 const options={owner:'A',peer:'B',id:'voice',sent,file:{size:12,arrayBuffer:async()=>new ArrayBuffer(12)},onState:j=>states.push({state:j.state,label:j.label}),onResult:(...v)=>results.push(v)};
 return {window,workers,states,calls,results,options,setSaveFails(v){saveFails=v;},enqueue(){window.XTJVoiceTranscription.enqueue(options);},result(){const w=workers.at(-1);w.onmessage({data:{id:w.data.id,type:'result',text:'你好，照片很好看'}});}};
}
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}assert.fail('timed out');}
test('device transcription queues once and retries failed persistence without recognizing twice',async()=>{
 const f=transcriptionFixture();f.setSaveFails(true);f.enqueue();f.enqueue();await until(()=>f.workers[0]?.data);assert.equal(f.workers.length,1);f.result();await until(()=>f.states.at(-1).state==='error');assert.equal(f.results.length,0);
 f.setSaveFails(false);f.window.XTJVoiceTranscription.retry('B','voice');await until(()=>f.results.length===1);assert.equal(f.workers.length,1);assert.equal(f.calls.length,2);assert.equal(JSON.parse(f.calls[1].init.body).text,'你好，照片很好看');f.window.XTJVoiceTranscription.reset();
});
test('received voice is transcribed locally and account changes discard late results',async()=>{
 const local=transcriptionFixture(false);local.enqueue();await until(()=>local.workers[0]?.data);local.result();await until(()=>local.results.length===1);assert.equal(local.calls.length,0);local.window.XTJVoiceTranscription.reset();
 const stale=transcriptionFixture();stale.enqueue();await until(()=>stale.workers[0]?.data);stale.window.currentUser='C';stale.result();await new Promise(r=>setTimeout(r,20));assert.equal(stale.calls.length,0);assert.equal(stale.results.length,0);stale.window.XTJVoiceTranscription.reset();
});

test('a known original path and forged actor fields cannot create or clean another actor’s pending upload',async()=>{for(const api of ['/api/photo/create','/api/photo/cleanup']){const f=handlerFixture(api,'B');await f.run();assert.equal(f.res.statusCode,403);assert.equal(f.calls.length,0);}});
