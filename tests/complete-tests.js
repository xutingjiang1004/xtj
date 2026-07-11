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
  var re = /\b(?:href|src|content)="((?:css|js)\/[^"?#]+\.(?:css|js))\?v=([a-f0-9]{10})"/g;
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
test('index.html uses minified local assets when a min build exists', function(){
  var html = read('index.html');
  var refs = [];
  html.replace(/\b(?:href|src|content)="((?:css|js)\/[^"?#]+\.(?:css|js))(?:\?v=[^"#]*)?"/g, function(_, assetPath) {
    refs.push(assetPath);
    return _;
  });
  refs.forEach(function(assetPath) {
    if (/\.min\.(css|js)$/.test(assetPath)) return;
    var minPath = assetPath.replace(/\.css$/, '.min.css').replace(/\.js$/, '.min.js');
    if (fs.existsSync(minPath)) assert.strictEqual(assetPath, minPath, assetPath + ' should use ' + minPath);
  });
});
test('build CSS list includes ui-shell and photo-preview', function(){
  var s = read('scripts/build.js');
  assert.ok(s.indexOf("'css/ui-shell.css'") >= 0, 'ui-shell.css missing from CSS_FILES');
  assert.ok(s.indexOf("'css/photo-preview.css'") >= 0, 'photo-preview.css missing from CSS_FILES');
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



console.log('\n=== Targeted Performance Optimization Static Checks ===');
test('english neon points and lines are performance-profiled', function(){
  var s = read('js/english-learning.js');
  assert.ok(s.indexOf('points: 360') >= 0 && s.indexOf('lines: 14') >= 0, 'missing perf-full neon config');
  assert.ok(s.indexOf('points: 220') >= 0 && s.indexOf('lines: 8') >= 0, 'missing perf-balanced neon config');
  assert.ok(s.indexOf('NEON_POINTS  = 600') < 0 && s.indexOf('NEON_LINES   = 26') < 0, 'old fixed neon constants remain');
});
test('perf-lite english neon does not start canvas rAF', function(){
  var s = read('js/english-learning.js');
  assert.ok(/lite:\s*\{[^}]*canvas:\s*false/.test(s), 'lite canvas flag missing');
  assert.ok(/if \(!_neonConfig\.canvas\) \{[\s\S]*?neonDrawStatic\(\);[\s\S]*?return;[\s\S]*?\}/.test(s), 'lite static path missing');
});
test('photo preview pointermove visual work is coalesced with rAF', function(){
  var s = read('js/photo-wall/preview-hotfix.js');
  assert.ok(s.indexOf('schedulePointerMoveVisual') >= 0, 'missing scheduler');
  assert.ok(s.indexOf('requestAnimationFrame(flushPendingMoveFrame)') >= 0, 'missing rAF flush');
  assert.ok(s.indexOf('cancelPendingMoveFrame') >= 0, 'missing pending rAF cleanup');
});
test('photo preview pending swipe-dismiss flushes before pointerup end logic', function(){
  var s = read('js/photo-wall/preview-hotfix.js');
  assert.ok(/function flushPendingMoveBeforePointerEnd\(\) \{[\s\S]*state\.pendingMove[\s\S]*cancelAnimationFrame\(state\.moveRaf\)[\s\S]*flushPendingMoveFrame\(\);[\s\S]*\}/.test(s), 'missing synchronous pending-move flush helper');
  var i = s.indexOf('function finishPointer(event)');
  assert.ok(i >= 0, 'missing finishPointer');
  var body = s.slice(i, s.indexOf("if (event.pointerType === 'touch')", i));
  assert.ok(body.indexOf('flushPendingMoveBeforePointerEnd();') >= 0, 'pointerup does not flush pending move first');
  assert.ok(body.indexOf('cancelPendingMoveFrame();') < 0, 'pointerup still discards pending move');
});
test('btn-primary hidden shimmer has no infinite animation', function(){
  var css = read('css/ui-enhance.css');
  var i = css.indexOf('.btn-primary::before');
  var block = css.slice(i, css.indexOf('}', i));
  assert.ok(/animation:\s*none/.test(block), 'base shimmer still animates');
  assert.ok(/\.btn-primary:hover::before,[\s\S]*\.btn-primary:focus-visible::before[\s\S]*xtjBtnShimmer/.test(css), 'interaction shimmer gate missing');
});
test('index no longer statically loads english-dict.js', function(){
  var html = read('index.html');
  assert.ok(!/<script[^>]+src="js\/english-dict\.js/.test(html), 'static english-dict.js script remains');
  assert.ok(/meta name="xtj-english-dict-src" content="js\/english-dict\.min\.js\?v=/.test(html), 'dynamic dictionary source meta missing');
});
test('english dictionary loader clears failed promise for retry', function(){
  var s = read('js/english-learning.js');
  assert.ok(/script\.onerror = function\(\) \{[\s\S]*englishDictionaryPromise = null;[\s\S]*resolve\(null\);[\s\S]*\};/.test(s), 'failed dictionary load cannot retry');
});
test('performance profile skips duplicate class mutations', function(){
  var s = read('js/performance.js');
  assert.ok(s.indexOf('var currentProfile = null') >= 0, 'missing current profile cache');
  assert.ok(s.indexOf('if (profile === currentProfile) return;') >= 0, 'missing no-op same-profile guard');
  assert.ok(s.indexOf('resizeApplyFrameId = requestAnimationFrame') >= 0, 'missing resize rAF coalescing');
});
test('features observer scope is limited and does not reattach document.body', function(){
  var s = read('js/features.js');
  ['#feed','#dockChatMessages','#dockChatList','#dockChatContainer','#toastContainer','#panelPosts','#panelChat'].forEach(function(selector){
    assert.ok(s.indexOf(selector) >= 0, 'missing observe target ' + selector);
  });
  assert.ok(s.indexOf('observe(document.body') < 0, 'document.body observer remains');
  assert.ok(s.indexOf('attributes:true') < 0, 'broad attribute observer remains');
  assert.ok(s.indexOf('REPAIR_ATTRS') >= 0, 'attribute repair helper missing');
});
test('photo preview css is sourced from css file rather than features injection', function(){
  var features = read('js/features.js');
  assert.ok(features.indexOf('#photoPreviewOverlay.photo-preview-overlay') < 0, 'preview overlay CSS still injected in features');
  assert.ok(features.indexOf('#photoPreviewOverlay .pp-rotate-btn .ui-icon') < 0, 'preview button CSS still injected in features');
  var css = read('css/photo-preview.css');
  assert.ok(css.indexOf('.pp-preview-toolbar') >= 0, 'photo preview toolbar CSS missing');
  assert.ok(css.indexOf('transform-origin: center center;') >= 0, 'photo preview info modal transform origin missing');
});
test('research card animator honors perf profiles and viewport visibility', function(){
  var s = read('js/ai-agent.js');
  assert.ok(s.indexOf("mode: 'lite'") >= 0 && s.indexOf('canvas: false') >= 0, 'lite research profile missing');
  assert.ok(s.indexOf("mode: 'balanced'") >= 0 && s.indexOf('maxNodes: 40') >= 0 && s.indexOf('fps: 30') >= 0, 'balanced research profile missing');
  assert.ok(s.indexOf("mode: 'full'") >= 0 && s.indexOf('maxNodes: 56') >= 0, 'full research profile missing');
  assert.ok(s.indexOf('IntersectionObserver') >= 0, 'viewport observer missing');
  assert.ok(s.indexOf('state.canToggle && card.classList.contains(\'collapsed\')') >= 0, 'collapsed-card pause guard missing');
});
test('english word list uses corrected selector, debounce, and delegated interactions', function(){
  var css = read('css/english-learning.css');
  assert.ok(css.indexOf('.el-word-list') < 0, 'old el-word-list selector remains');
  assert.ok(css.indexOf('.el-wordlist') >= 0, 'correct el-wordlist selector missing');
  assert.ok(css.indexOf('contain-intrinsic-size: 72px;') >= 0, 'word item intrinsic size missing');
  var s = read('js/english-learning.js');
  assert.ok(s.indexOf('var SEARCH_DEBOUNCE_MS = 100;') >= 0, 'search debounce constant missing');
  assert.ok(s.indexOf('safeBind(\'elWordList\', \'change\'') >= 0, 'word list change delegation missing');
  assert.ok(s.indexOf('safeBind(\'elWordList\', \'click\'') >= 0, 'word list click delegation missing');
  assert.ok(s.indexOf('resetWordListInteractiveNodes(list);') >= 0, 'interactive node reset missing');
});
test('dock tab and indicator selectors were not edited by this optimization', function(){
  var diff = cp.execSync('git diff -- css/ui-enhance.css css/ai-agent.css js/english-learning.js js/photo-wall/preview-hotfix.js js/performance.js index.html scripts/build.js tests/complete-tests.js', {encoding:'utf8'});
  assert.ok(!/^[+-](?!\+\+\+|---).*\.dock-(?:bar|tab|indicator)\b/m.test(diff), 'dock bar/tab/indicator selector changed');
});

console.log('\n=== Results ===');
console.log('  Passed: ' + passed); console.log('  Failed: ' + failed);
if (failed) process.exit(1);
