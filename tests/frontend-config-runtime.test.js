'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { bootstrapFixture } = require('./helpers/bootstrap-runtime-fixture');
const config = { supabase_url:'https://new-project.test', supabase_anon_key:'sb_publishable_new_fixture' };
const response = () => ({ok:true,json:async()=>config});

test('valid build credentials still sync the runtime URL/key pair at startup', async () => {
  let calls=0;
  const f=bootstrapFixture({fetch:async()=>{calls++;return response();}});
  f.listeners.get('DOMContentLoaded')();
  await f.sync();
  assert.equal(calls,1);assert.equal(f.clients.length,2);
  assert.equal(f.window.sb.url,config.supabase_url);assert.equal(f.window.sb.key,config.supabase_anon_key);
  assert.equal(f.context._runtimeConfigSynced,true);
  await f.sync();assert.equal(calls,1);
});

test('failed runtime config can retry; concurrent callers share one fetch and client', async () => {
  let calls=0, release;
  const f=bootstrapFixture({key:'eyJhbG...yDDA',fetch:async()=>{
    if(++calls===1)return {ok:false,status:503};
    await new Promise(resolve=>{release=resolve;});return response();
  }});
  assert.equal(await f.sync(),false);assert.equal(f.context._runtimeConfigSynced,false);
  const first=f.sync(),second=f.sync();assert.equal(first,second);assert.equal(calls,2);
  release();assert.equal(await first,true);assert.equal(await second,true);
  assert.equal(f.clients.length,1);assert.equal(f.context._runtimeConfigSynced,true);
});

test('invalid response or delayed SDK does not mark the configuration synchronized', async () => {
  const f=bootstrapFixture({sdk:false});assert.equal(await f.sync(),false);
  assert.equal(f.context._runtimeConfigSynced,false);
  f.installSdk();assert.equal(await f.sync(),true);
  for(const pair of [{...config,supabase_url:'javascript:alert(1)'},{...config,supabase_anon_key:'sb_secret_test'}]) {
    const bad=bootstrapFixture({fetch:async()=>({ok:true,json:async()=>pair})});
    assert.equal(await bad.sync(),false);assert.equal(bad.context._runtimeConfigSynced,false);
    assert.equal(bad.window.sb.url,'https://old-project.test');
  }
});

test('config timeout aborts the request and leaves a retryable synchronization state', async () => {
  let expire,aborted=false;
  const f=bootstrapFixture({timers:{setTimeout:fn=>{expire=fn;return 1;},clearTimeout(){}},fetch:async(url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>{aborted=true;reject(new Error('timeout'));});
  })});
  const pending=f.sync();expire();assert.equal(await pending,false);
  assert.equal(aborted,true);assert.equal(f.context._runtimeConfigSynced,false);
  f.context.fetch=async()=>response();assert.equal(await f.sync(),true);
});

test('startup configuration retries are bounded', async () => {
  const scheduled=new Map();let id=0,calls=0;
  const f=bootstrapFixture({fetch:async()=>{calls++;return {ok:false};},timers:{setTimeout:(fn,ms)=>{const key=++id;scheduled.set(key,{fn,ms});return key;},clearTimeout:key=>scheduled.delete(key)}});
  f.listeners.get('DOMContentLoaded')();
  for(let i=0;i<3;i++){
    await new Promise(resolve=>setImmediate(resolve));
    const next=[...scheduled].find(([,timer])=>timer.ms!==5000);
    if(next){scheduled.delete(next[0]);next[1].fn();}
  }
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,3);assert.equal(scheduled.size,0);assert.equal(f.context._runtimeConfigSynced,false);
});

test('asset injection updates both URLs and public keys and rejects privileged keys', () => {
  const build=fs.readFileSync('scripts/build.js','utf8');
  const start=build.indexOf('var CONFIG_ANON_PLACEHOLDER');const end=build.indexOf('\nconst CSS_FILES',start);
  const ctx={URL,Buffer,process:{env:{SUPABASE_URL:config.supabase_url,SUPABASE_ANON_KEY:config.supabase_anon_key}},console:{log(){},warn(){}}};
  vm.createContext(ctx);vm.runInContext(build.slice(start,end),ctx);
  for(const file of ['js/config.js','js/core.js']){
    const source='({SUPABASE_URL:"https://old-project.test",SUPABASE_ANON_KEY:"eyJhbG...yDDA"})';
    const injected=ctx.injectConfigSecrets(source,file);
    const result=vm.runInNewContext(injected);assert.equal(result.SUPABASE_URL,config.supabase_url);assert.equal(result.SUPABASE_ANON_KEY,config.supabase_anon_key);
  }
  const jwt='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.signature';
  ctx.process.env.SUPABASE_ANON_KEY=jwt;
  assert.throws(()=>ctx.injectConfigSecrets('"eyJhbG...yDDA"','js/config.js'),/privileged/);
});

test('F08 early feed gives structured service feedback and only retryable failures reload', async () => {
  const source=fs.readFileSync('js/early-feed.js','utf8');
  for(const retryable of [true,false]){
    const timers=new Map();let id=0,reloads=0;
    const feed={innerHTML:'内容加载中',querySelector:selector=>selector==='.post'?null:{}};
    const node={};
    const ctx={URL,AbortController,Promise,console,
      setTimeout:(fn,ms)=>{const key=++id;timers.set(key,{fn,ms});return key;},clearTimeout:key=>timers.delete(key),
      document:{getElementById:name=>name==='feed'?feed:node},
      window:{location:{origin:'https://site.test',reload:()=>reloads++},addEventListener(){}},
      fetch:async()=>({ok:false,status:retryable?503:402,json:async()=>({ok:false,code:retryable?'temporary':'egress_quota_exceeded',retryable,error:'受控服务提示 <script>'}),headers:{get:()=>null}})};
    vm.runInNewContext(source,ctx);await new Promise(resolve=>setImmediate(resolve));
    [...timers.values()].find(timer=>timer.ms===300).fn();
    assert.match(feed.innerHTML,/受控服务提示 &lt;script&gt;/);
    assert.doesNotMatch(feed.innerHTML,/Clash|FlClash|127\.0\.0\.1:7890|Ctrl\+F5|<script>/);
    assert.equal(typeof node.onclick,retryable?'function':'undefined');
    if(retryable){let prevented=false;node.onkeydown({key:'Enter',preventDefault:()=>prevented=true});assert.equal(prevented,true);assert.equal(reloads,1);}
    else assert.match(feed.innerHTML,/role="status"/);
  }
});

test('avatar media gateways resolve against API_BASE and retain existing query parameters', () => {
  const window={location:{origin:'https://site.test',href:'https://site.test/'}};
  vm.runInNewContext(fs.readFileSync('js/config.js','utf8'),{window,URL});
  window.XTJ_CONFIG.API_BASE='https://api.test';
  assert.equal(window.xtjUploadDisplayUrl('/api/uploads/media?path=avatars%2Ffixture.png'),'https://api.test/api/uploads/media?path=avatars%2Ffixture.png');
  const source=fs.readFileSync('js/ai-agent.js','utf8');
  const start=source.indexOf('  function aiAvatarDisplayUrl('),end=source.indexOf('  function renderHeaderAvatar',start);
  const ctx={window,URL,API_BASE:'https://api.test'};vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
  const result=new URL(ctx.aiAvatarDisplayUrl('/api/uploads/media?path=avatars%2Ffixture.png','a b'));
  assert.equal(result.origin,'https://api.test');assert.equal(result.searchParams.get('path'),'avatars/fixture.png');assert.equal(result.searchParams.get('v'),'a b');
});
