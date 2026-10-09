'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), http = require('node:http'), zlib = require('node:zlib');
const { EventEmitter } = require('node:events');
const { matchesAccount } = require('../render-api/account-identity');
const secrets = require('../render-api/ai-model-secrets');
const { requestPinnedStream } = require('../render-api/web-fetch');
test('recreated names reject both bound and legacy sessions; existing accounts keep legacy sessions',()=>{
  const expiry=Date.now()+900000, old={id:'old',created_at:'2020-01-01T00:00:00Z'}, fresh={id:'new',created_at:new Date().toISOString()};
  assert.equal(matchesAccount({account_id:'old',exp:expiry},old,900000),true);
  assert.equal(matchesAccount({account_id:'old',exp:expiry},fresh,900000),false);
  assert.equal(matchesAccount({exp:expiry},old,900000),true);
  assert.equal(matchesAccount({exp:expiry},fresh,900000),false);
  assert.equal(matchesAccount({account_id:'old'},null,900000),false);
});
test('independent encryption survives signing-secret rotation and retains legacy ciphertext compatibility',()=>{
  const env={API_SECRET:'old-signing',ENCRYPTION_KEY:'independent'};
  const saved=secrets.encrypt('provider-key',env);
  assert.equal(saved.version,2); assert.equal(secrets.decrypt(saved,{...env,API_SECRET:'rotated'}),'provider-key');
  const legacy=secrets.encrypt('legacy-key',{API_SECRET:'old-signing'});
  assert.equal(secrets.decrypt(legacy,env),'legacy-key');
  assert.equal(secrets.decrypt(legacy,{...env,API_SECRET:'rotated',AI_MODELS_LEGACY_SECRETS:'old-signing'}),'legacy-key');
  assert.throws(()=>secrets.decrypt(saved,{ENCRYPTION_KEY:'wrong'}),/key_unavailable/);
});
function guards(){
  const source=fs.readFileSync('render-api/server.js','utf8');
  const begin=source.indexOf('const PHOTO_UPLOAD_QUOTA_BYTES'),end=source.indexOf("app.post('/api/photo/upload'",begin);
  const context={Map,Date,Number,console,setInterval(){return{unref(){}};},PHOTO_UPLOAD_MAX_SINGLE_BYTES:50*1024*1024};
  vm.createContext(context);vm.runInContext(source.slice(begin,end),context);return context;
}
test('photo ingress reserves before body parsing; overflow, parser failure and abort release exactly once',()=>{
  const g=guards(), held=[];
  function ingress(owner,bytes){ const req={userName:owner,headers:{'content-length':String(bytes)}},res=new EventEmitter();res.status=n=>(res.code=n,res);res.json=body=>(res.body=body,res);let accepted=false;g.photoUploadBudgetPrecheck(req,res,()=>accepted=true);return{req,res,accepted}; }
  for(let i=0;i<3;i++){const r=ingress('alice',1024);assert.equal(r.accepted,true);held.push(r);}
  const fourth=ingress('alice',1024);assert.equal(fourth.accepted,true);held.push(fourth);
  assert.equal(ingress('alice',1024).res.code,429);
  held[0].res.emit('close');held[0].res.emit('finish');assert.equal(ingress('alice',1024).accepted,true);
  const one=ingress('bob',50*1024*1024),two=ingress('carol',50*1024*1024);
  assert.equal(one.accepted,true);assert.equal(two.accepted,true);assert.equal(ingress('dave',50*1024*1024).res.code,429);
  one.res.emit('finish');assert.equal(ingress('dave',50*1024*1024).accepted,true);
  assert.equal(ingress('no-length','bad').res.code,411);
});
async function server(handler){const instance=http.createServer(handler);await new Promise(r=>instance.listen(0,'127.0.0.1',r));return instance;}
test('abort remains attached after upstream headers and closes the unfinished response',async()=>{
  let closed;const disconnected=new Promise(r=>closed=r);
  const host=await server((req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: first\n\n');res.on('close',closed);});
  try { const controller=new AbortController();const response=await requestPinnedStream(new URL('http://127.0.0.1:'+host.address().port),[{address:'127.0.0.1',family:4}],{signal:controller.signal});const reader=response.body.getReader();await reader.read();controller.abort();await assert.rejects(reader.read());await disconnected; }
  finally {host.closeAllConnections();await new Promise(r=>host.close(r));}
});
test('compressed and decoded upstream bodies have a real size ceiling',async()=>{
  const host=await server((req,res)=>{res.writeHead(200,{'content-encoding':'gzip'});res.end(zlib.gzipSync(Buffer.alloc(100000,'x')));});
  try {const response=await requestPinnedStream(new URL('http://127.0.0.1:'+host.address().port),[{address:'127.0.0.1',family:4}],{maxResponseBytes:1024});await assert.rejects(response.text(),/limit|large|exceed|上限|过大|大小/i);}
  finally {host.closeAllConnections();await new Promise(r=>host.close(r));}
});
test('revocation refresh reads beyond a truncated server page and retains concurrent successful writes',async()=>{
 const source=fs.readFileSync('render-api/server.js','utf8'),start=source.indexOf('async function loadRevokedTokenHashes()'),end=source.indexOf('var revokedTokenHashes =',start);
 const rows=Array.from({length:1201},(_,i)=>({id:String(i).padStart(5,'0'),media_url:'hash-'+i,content:JSON.stringify({expires_at:Date.now()+60000})}));let calls=0;
 const context={console,Date,Set,Map,REVOKED_TOKEN_MARKER:'__revoked_token__',revokedTokenHashes:new Set(),revokedTokenHashExpiries:new Map(),supabase:{from(){let after='';const q={select(){return q;},eq(){return q;},not(){return q;},order(){return q;},limit(){return q;},gt(k,v){after=v;return q;},then(resolve){calls++;if(calls===2)context.revokedTokenHashExpiries.set('racing-write',Date.now()+60000);return Promise.resolve({data:rows.filter(r=>r.id>after).slice(0,400)}).then(resolve);}};return q;}}};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 await context.loadRevokedTokenHashes();assert.equal(context.revokedTokenHashes.size,1202);assert.equal(context.revokedTokenHashes.has('hash-1200'),true);assert.equal(context.revokedTokenHashes.has('racing-write'),true);assert.equal(calls,5);
});
