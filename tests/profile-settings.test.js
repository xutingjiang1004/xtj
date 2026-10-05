'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),request=require('supertest'),sharp=require('sharp');
const {createProfileSettings,DEFAULTS,publicProfile}=require('../render-api/profile-settings');
const {createAuthorPosts}=require('../render-api/author-posts');
function fixture(){
 const accounts={alice:'11111111-1111-4111-8111-111111111111',bob:'22222222-2222-4222-8222-222222222222'},settings={},uploads=[];let failing=false;
 const db={from(table){const filters={};let q={select(){return q},eq(k,v){filters[k]=v;return q},order(){return q},limit(){return q},maybeSingle:async()=>{if(failing)return{error:Error('offline')};if(table==='posts')return{data:accounts[filters.user_name]?{id:accounts[filters.user_name]}:null};const row=settings[filters.user_name];return {data:row&&row.account_id===filters.account_id?row:null};}};return q;},rpc:async(name,args)=>{if(failing)return{error:Error('offline')};assert.equal(name,'save_account_profile_settings');assert.equal(accounts[args.p_user_name],args.p_account_id);const row=settings[args.p_user_name]||{settings:{}};settings[args.p_user_name]={account_id:args.p_account_id,settings:{...row.settings,...args.p_patch}};return{data:settings[args.p_user_name].settings};},storage:{from(){return{upload:async(path,body,options)=>{uploads.push({path,body:Buffer.from(body),options});return{}},getPublicUrl:path=>({data:{publicUrl:'https://test.supabase.co/storage/v1/object/public/uploads/'+path}})}}}};
 const app=express();app.use(express.json());app.use('/settings',createProfileSettings({express,supabase:db,sharp,authenticateUser(req,res,next){req.userName=req.get('x-user');if(!accounts[req.userName])return res.status(401).json({ok:false});next();}}));
 return{app,settings,uploads,db,fail(v){failing=v}};
}
test('profile preferences use verified owner, merge partial fields and publish only public cover/signature',async()=>{
 const f=fixture();await request(f.app).get('/settings').expect(401);
 await request(f.app).patch('/settings').set('x-user','alice').send({signature:'你好',timeline_visible:false,default_visibility:'private'}).expect(200);
 await request(f.app).patch('/settings').set('x-user','alice').send({theme:'dark',accent:'rose'}).expect(200);
 const a=await request(f.app).get('/settings').set('x-user','alice').expect(200);assert.equal(a.body.settings.signature,'你好');assert.equal(a.body.settings.timeline_visible,false);assert.equal(a.body.settings.default_visibility,'private');assert.equal(a.body.settings.theme,'dark');
 const b=await request(f.app).get('/settings').set('x-user','bob').expect(200);assert.deepEqual(b.body.settings,DEFAULTS);
 for(const patch of [{user_name:'bob'},{cover_url:'https://evil.test/image'},{background_url:'javascript:alert(1)'},{signature:'a'.repeat(121)},{timeline_visible:'false'},{accent:'evil'}])await request(f.app).patch('/settings').set('x-user','alice').send(patch).expect(400);
 assert.deepEqual(Object.keys(publicProfile(a.body.settings)).sort(),['cover_url','signature','timeline_visible']);f.fail(true);await request(f.app).get('/settings').set('x-user','alice').expect(503);await request(f.app).patch('/settings').set('x-user','alice').send({signature:'未保存'}).expect(503);assert.equal(f.settings.alice.settings.signature,'你好');
});
test('cover uploads preserve exact original bytes and reject SVG and forged metadata',async()=>{
 const f=fixture(),png=await sharp({create:{width:8,height:8,channels:4,background:'#76ba9f'}}).png().toBuffer();
 const r=await request(f.app).post('/settings/image?kind=cover').set('x-user','alice').set('Content-Type','application/octet-stream').send(png).expect(200);
 assert.deepEqual(f.uploads[0].body,png);assert.equal(f.uploads[0].options.contentType,'image/png');assert.ok(r.body.settings.cover_url.endsWith('.png'));assert.equal(f.settings.alice.settings.cover_url,r.body.settings.cover_url);
 await request(f.app).post('/settings/image?kind=cover').set('x-user','alice').set('Content-Type','application/octet-stream').send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>')).expect(400);
 await request(f.app).post('/settings/image?kind=other').set('x-user','alice').set('Content-Type','application/octet-stream').send(png).expect(400);assert.equal(f.uploads.length,1);
 await request(f.app).patch('/settings').set('x-user','alice').send({cover_url:''}).expect(200);assert.equal(f.settings.alice.settings.cover_url,'');
});
test('personal timeline privacy is enforced before reading posts; owner remains allowed and settings failures fail closed',async()=>{
 let reads=0,failed=false;const app=express(),db={from(){reads++;throw Error('no posts should be queried');}};
 app.use('/posts',createAuthorPosts({express,supabase:db,optionalAuth(req,res,next){req.userName=req.get('x-user');next()},readSettings:async()=>{if(failed)throw Error('offline');return{timeline_visible:false,cover_url:'https://test/cover.png',signature:'我的签名',background_url:'private-ui'};}}));
 const other=await request(app).get('/posts/alice').set('x-user','bob').expect(200);assert.equal(other.body.restricted,true);assert.deepEqual(other.body.posts,[]);assert.equal(other.body.profile.cover_url,undefined);assert.equal(other.body.profile.signature,undefined);assert.equal(other.body.profile.background_url,undefined);assert.equal(reads,0);
 await request(app).get('/posts/alice').set('x-user','alice').expect(503);assert.equal(reads,1);failed=true;await request(app).get('/posts/alice').set('x-user','bob').expect(503);assert.equal(reads,1);
});

 test('research process preserves only emitted stages/reasoning, merges parallel roles and bounds history',()=>{
 const {createResearchProcess}=require('../render-api/research-process'),log=createResearchProcess(60);
 log.record({type:'heartbeat'});log.record({type:'research_stage',stage:'collect',message:'实际检索'});log.record({type:'research_thinking',agent_role:'甲',chunk:'核对'});log.record({type:'research_thinking',agent_role:'乙',chunk:'比较'});log.record({type:'research_thinking',agent_role:'甲',chunk:'证据'});assert.equal(log.snapshot()[1].chunk,'核对证据');assert.equal(log.snapshot().length,3);log.record({type:'research_thinking',agent_role:'甲',chunk:'x'.repeat(100)});assert.equal(log.snapshot().reduce((n,e)=>n+e.chunk.length,0),60);assert.equal(log.snapshot()[2].chunk,'比较');
 });

test('guest restrictions and timeline ranges apply only to visitors while owner retains full history',async()=>{
 let filters=[],privacy={timeline_visible:true,guests_allowed:false,timeline_range:'3d'};
 const db={from(){const q={select(){return q},eq(){return q},not(){return q},or(filter){filters.push(filter);return q},order(){return q},limit(){return q},then(resolve){return Promise.resolve({data:[]}).then(resolve)}};return q;}};
 const app=express();app.use('/posts',createAuthorPosts({express,supabase:db,optionalAuth(req,res,next){req.userName=req.get('x-user');next()},readSettings:async()=>privacy}));
 const guest=await request(app).get('/posts/alice').expect(200);assert.equal(guest.body.restricted,true);assert.equal(filters.length,0);
 await request(app).get('/posts/alice').set('x-user','bob').expect(200);assert.match(filters.at(-1),/created_at.gte./);
 await request(app).get('/posts/alice').set('x-user','alice').expect(200);assert.doesNotMatch(filters.at(-1),/created_at.gte./);
});
