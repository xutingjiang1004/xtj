const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('frontend bootstrap does not depend on a third-party Supabase CDN', () => {
  assert.doesNotMatch(indexHtml, /cdn\.jsdelivr\.net[^"']*supabase/i);
  assert.match(indexHtml, /<script defer src="js\/vendor\/supabase\.min\.js\?v=[^"]+"><\/script>/);
  assert.ok(fs.statSync(path.join(root, 'js/vendor/supabase.min.js')).size > 100_000);
});

test('Supabase loads before core while both scripts remain non-blocking', () => {
  const sdkPosition = indexHtml.indexOf('js/vendor/supabase.min.js');
  const corePosition = indexHtml.indexOf('js/core.min.js');
  assert.ok(sdkPosition >= 0 && corePosition >= 0 && sdkPosition < corePosition);
});

test('runtime Supabase config healing reconnects a login restored before the client exists', async () => {
  const vm=require('node:vm');
  const source=fs.readFileSync(path.join(root,'js/core-parts/01-bootstrap.js'),'utf8');
  const start=source.indexOf('            function _syncRuntimeConfig(done) {');
  const end=source.indexOf('            if (!_sbConfigOk) {',start);
  for(const user of ['tester',null]) {
    let reconnects=0;
    const client={};
    const sandbox={_runtimeConfigSynced:false,API_BASE:'http://127.0.0.1',XTJ_RUNTIME_CONFIG:{},_sbConfigOk:false,sb:null,console:{log(){},warn(){}},
      fetch:async()=>({ok:true,json:async()=>({supabase_url:'http://127.0.0.1',supabase_anon_key:'sb_publishable_test_only_key'})}),
      window:{currentUser:user,location:{origin:'http://127.0.0.1'},XTJ_CONFIG:{},supabase:{createClient:()=>client},subscribeToDmBroadcast:()=>{reconnects++;}}};
    vm.runInNewContext(source.slice(start,end),sandbox);
    const healed=await new Promise(resolve=>sandbox._syncRuntimeConfig(resolve));
    assert.equal(healed,true);assert.equal(sandbox.window.sb,client);assert.equal(reconnects,user?1:0);
  }
});
