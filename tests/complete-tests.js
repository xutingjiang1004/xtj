// xtj automated checks
var assert = require('assert');
var fs = require('fs');
var crypto = require('crypto');
var cp = require('child_process');

var passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ✅ ' + name); } catch(e) { failed++; console.log('  ❌ ' + name + ': ' + e.message); } }
function read(p){ return fs.readFileSync(p,'utf8'); }
function hash(p){ return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0,10); }

console.log('\n=== Syntax Checks ===');
['render-api/server.js','scripts/build.js','js/core.js','js/login-device.js','js/ai-agent.js','js/english-learning.js','js/english-dict.js'].forEach(function(f){
  test(f, function(){ cp.execSync('node --check '+f, {stdio:'pipe'}); });
});

console.log('\n=== Build Hash Checks ===');
test('index.html CSS/JS query hashes match file content', function(){
  var html = read('index.html');
  var re = /\b(?:href|src)="((?:css|js)\/[^"?#]+\.(?:css|js))\?v=([a-f0-9]{10})"/g;
  var m, count=0;
  while ((m = re.exec(html))) {
    assert.ok(fs.existsSync(m[1]), 'missing '+m[1]);
    assert.strictEqual(m[2], hash(m[1]), m[1]+' hash mismatch');
    count++;
  }
  assert.ok(count > 10, 'too few hashed local assets');
});
test('no manual date version query remains for local CSS/JS', function(){
  var html = read('index.html');
  assert.ok(!/\b(?:css|js)\/[^"?#]+\.(?:css|js)\?v=20\d{6,}/.test(html));
});

console.log('\n=== English Sync / Pro RPC Static Checks ===');
test('english conflict response uses RPC server_content and fallback row', function(){
  var s = read('render-api/server.js');
  assert.ok(s.indexOf('rpcResult.data.server_content') >= 0, 'missing server_content parse');
  assert.ok(s.indexOf('loadEnglishLearningRow(userName)') >= 0, 'missing fallback load');
  assert.ok(s.indexOf('sanitizeEnglishLearningState(JSON.parse(content))') < 0, 'client payload used as conflict server');
});
test('pro claim route calls claim_pro_gift RPC and rejects nonnumeric id', function(){
  var s = read('render-api/server.js');
  var route = s.slice(s.indexOf("/api/pro-gifts/claim"), s.indexOf("// 管理员：手动赠送 Pro"));
  assert.ok(route.indexOf("supabase.rpc('claim_pro_gift'") >= 0, 'missing RPC call');
  assert.ok(route.indexOf('/^\\d+$/') >= 0, 'missing numeric guard');
  ['claimCount','postClaimCount','rollback','claimLocks'].forEach(function(x){ assert.ok(route.indexOf(x) < 0, 'old flow remains: '+x); });
});
test('pro RPC migration locks gift and validates JSON fields atomically', function(){
  var s = read('supabase/migrations/005_harden_rpc_rls.sql');
  ['FOR UPDATE','allowed_users 字段必须是数组','claim_limit 或 duration_days 字段必须是数字','__pro_gift_claim__','__vip__'].forEach(function(x){ assert.ok(s.indexOf(x)>=0, 'missing '+x); });
});

console.log('\n=== RLS Static Checks ===');
test('anon posts writes revoked and public read allowlisted', function(){
  var s = read('supabase/migrations/005_harden_rpc_rls.sql');
  assert.ok(/REVOKE ALL ON posts FROM anon/.test(s));
  assert.ok(/CREATE POLICY anon_posts_public_read/.test(s));
  ['__auth__','__vip__','__ai_english_learning__','__pro_gift_claim__'].forEach(function(marker){
    var policy = s.slice(s.indexOf('CREATE POLICY anon_posts_public_read'), s.indexOf('DROP POLICY IF EXISTS bans'));
    assert.ok(policy.indexOf(marker) < 0, 'system marker allowlisted: '+marker);
  });
  assert.ok(!/ON bans[\s\S]{0,120}(USING \(true\)[\s\S]{0,80}WITH CHECK \(true\)|WITH CHECK \(true\)[\s\S]{0,80}USING \(true\))/.test(s));
});

test('likes/comments anon inserts require user, object and content constraints', function(){
  var s = read('supabase/migrations/005_harden_rpc_rls.sql');
  assert.ok(s.indexOf('post_id IS NOT NULL') >= 0);
  assert.ok(s.indexOf("btrim(user_name) <> ''") >= 0);
  assert.ok(s.indexOf("btrim(content) <> ''") >= 0);
  assert.ok(s.indexOf('WITH CHECK (true)') < 0);
});

console.log('\n=== CSS Surface / Motion Checks ===');
test('english core selectors are not redefined at top level', function(){
  var css = read('css/english-learning.css');
  ['el-page','el-header','el-sync','el-hero','el-main','el-card','el-dashboard-grid','el-practice-grid','el-tabs'].forEach(function(c){
    var re = new RegExp('^#panelEnglishLearning \\.'+c+'\\s*\\{','gm');
    var n = (css.match(re)||[]).length;
    assert.strictEqual(n, 1, c+' count '+n);
  });
});
test('english page has single safe-area bottom owner and card/tabs no blur', function(){
  var css = read('css/english-learning.css');
  assert.ok(/\.el-page[\s\S]*padding-bottom: calc\(24px \+ env\(safe-area-inset-bottom\)\)/.test(css));
  assert.ok(!/\.el-main[\s\S]{0,160}safe-area-inset-bottom/.test(css));
  function block(sel){ var i=css.indexOf(sel+' {'); assert.ok(i>=0, sel+' missing'); return css.slice(i, css.indexOf('}', i)); }
  assert.ok(block('#panelEnglishLearning .el-card').indexOf('backdrop-filter') < 0);
  assert.ok(block('#panelEnglishLearning .el-tabs').indexOf('backdrop-filter') < 0);
});
test('chat list and main chat surfaces stay flat', function(){
  var css = read('css/style.css') + '\n' + read('css/ui-enhance.css');
  assert.ok(css.indexOf('#panelChat .chat-list-item') >= 0);
  assert.ok(!/#panelChat \.chat-list-item[\s\S]{0,180}backdrop-filter:\s*blur/.test(css));
  function cssBlock(sel){ var i=css.indexOf(sel+' {'); assert.ok(i>=0, sel+' missing'); return css.slice(i, css.indexOf('}', i)); }
  assert.ok(cssBlock('.chat-header').indexOf('backdrop-filter') < 0);
  assert.ok(cssBlock('.chat-input-area').indexOf('backdrop-filter') < 0);
});
test('invisible shimmer and blur-heavy list entry animations are removed', function(){
  var css = read('css/style.css') + '\n' + read('css/ui-enhance.css');
  assert.ok(!/xtjFloatIn[\s\S]{0,140}filter:\s*blur\(5px\)/.test(css));
  assert.ok(!/post\.visible[\s\S]{0,180}filter:\s*blur\(6px\)/.test(css));
  assert.ok(/\.btn-primary:hover::before|\.btn-primary:focus-visible::before/.test(css), 'shimmer not gated by interaction');
});

test('ui-effects keeps only deprecated compatibility object', function(){
  var s = read('js/ui-effects.js');
  assert.ok(s.indexOf('deprecated') >= 0);
  ['rippleButtonSelector','getPerfMode','motionReduced'].forEach(function(x){ assert.ok(s.indexOf(x)<0, x+' remains'); });
});

console.log('\n=== Results ===');
console.log('  Passed: ' + passed); console.log('  Failed: ' + failed);
if (failed) process.exit(1);
