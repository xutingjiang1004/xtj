// xtj automated checks
var assert = require('assert');
var fs = require('fs');
var crypto = require('crypto');
var cp = require('child_process');
var vm = require('vm');

var passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ✅ ' + name); } catch(e) { failed++; console.log('  ❌ ' + name + ': ' + e.message); } }
function read(p){ return fs.readFileSync(p,'utf8'); }
function hash(p){ return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0,10); }

console.log('\n=== Syntax Checks ===');
['render-api/server.js','scripts/build.js','js/core.js','js/login-device.js','js/ai-agent.js','js/features.js','js/photo-wall/preview.js'].forEach(function(f){
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
test('photo upload sheet keeps keyboard focus and announces persistent results', function(){
  var html = read('index.html');
  var upload = read('js/photo-wall/upload-ui.js');
  assert.ok(/id="pwUploadResult"[^>]*role="alert"/.test(html), 'upload result alert missing');
  assert.ok(upload.indexOf('function focusUploadButton()') >= 0, 'upload button focus restore missing');
  assert.ok(upload.indexOf("byId('pwUploadReselectBtn') || byId('pwStartUploadBtn')") >= 0, 'sheet initial focus missing');
  assert.ok(upload.indexOf("event.key !== 'Escape' || state.uploading") >= 0, 'Escape upload guard missing');
  assert.ok(upload.indexOf('window.setPhotoUploadResult = setUploadResult') >= 0, 'upload result API missing');
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
  ['__auth__','__vip__','__pro_gift_claim__'].forEach(function(marker){
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
test('performance profile skips duplicate class mutations', function(){
  var s = read('js/performance.js');
  assert.ok(s.indexOf('var currentProfile = null') >= 0, 'missing current profile cache');
  assert.ok(s.indexOf('if (profile === currentProfile) return;') >= 0, 'missing no-op same-profile guard');
  assert.ok(s.indexOf('resizeApplyFrameId = requestAnimationFrame') >= 0, 'missing resize rAF coalescing');
});
test('features observer repairs only explicitly marked added nodes', function(){
  var s = read('js/features.js');
  assert.ok(s.indexOf("data-xtj-legacy-text") >= 0, 'explicit legacy marker missing');
  assert.ok(s.indexOf('record.addedNodes') >= 0, 'observer does not use addedNodes');
  assert.ok(s.indexOf('createTreeWalker') < 0, 'broad TreeWalker remains');
  assert.ok(s.indexOf('REPAIR_TARGET_SELECTORS') < 0, 'feed/chat root scans remain');
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
test('each local JavaScript entry module is statically referenced once', function(){
  var html = read('index.html');
  var refs = [];
  html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi, function(_, src) {
    if (!/^https?:\/\//i.test(src)) refs.push(src.split('?')[0]);
    return _;
  });
  var seen = Object.create(null);
  refs.forEach(function(src) { seen[src] = (seen[src] || 0) + 1; });
  Object.keys(seen).forEach(function(src) {
    assert.strictEqual(seen[src], 1, src + ' is referenced more than once');
  });
});
test('core has no legacy loaders for static entry modules', function(){
  var core = read('js/core.js');
  [
    'login-device', 'core-animations', 'features', 'ui-effects', 'pro-upgrade',
    'pro-style', 'ai-agent', 'upload-ui',
    'preview-hotfix'
  ].forEach(function(moduleName) {
    var loader = new RegExp("(?:xtjLoadScriptOnce|xtjLoadScriptSequence)[\\s\\S]{0,260}['\"][^'\"]*" + moduleName.replace(/[-/]/g, '\\$&') + "[^'\"]*['\"]");
    assert.ok(!loader.test(core), 'legacy loader remains for ' + moduleName);
  });
  assert.ok(core.indexOf('function scheduleInteractiveEnhancements') < 0, 'interactive enhancement scheduler remains');
  assert.ok(core.indexOf('function armCoreAnimationLoader') < 0, 'core animation loader remains');
  assert.ok(core.indexOf("gsap: { externalScripts: ['https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js'] }") >= 0, 'GSAP is not owned by the module loader');
});

test('feature modules have one retryable CSS-first loader', function(){
  var html = read('index.html');
  var core = read('js/core.js');
  assert.ok(core.indexOf('window.XTJModuleLoader = { load: loadXtjModule }') >= 0, 'public module loader missing');
  assert.ok(core.indexOf('if (xtjModulePromises[moduleName]) return xtjModulePromises[moduleName]') >= 0, 'module promise dedupe missing');
  assert.ok(core.indexOf('delete xtjModulePromises[moduleName]') >= 0, 'failed module cannot retry');
  assert.ok(core.indexOf('definition.styles') < core.indexOf('definition.scripts'), 'CSS is not loaded before scripts');
  ['ai-agent','pro-upgrade','pro-style','photo-wall/preview','photo-wall/preview-hotfix','photo-wall/upload-ui'].forEach(function(asset) {
    var escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.ok(!(new RegExp('<script[^>]+src="js/' + escaped + '\\.min\\.js')).test(html), asset + ' remains a static script');
  });
  assert.ok(!/<script[^>]+gsap@/.test(html), 'GSAP remains a first-load script');
});

test('legacy feature loaders and broad text scans are removed', function(){
  var source = read('js/features.js');
  ['xtj-echo-loader','xtj-sigil-loader','xtj-chat-loader--sigil','xtj-echo-particle','installSpellLoaderPatch','installMagicInteraction','spawnParticles','createTreeWalker','repairObservedRoots'].forEach(function(token) {
    assert.strictEqual(source.indexOf(token), -1, 'legacy feature token remains: ' + token);
  });
  assert.ok(source.indexOf("data-xtj-legacy-text") >= 0, 'legacy marker scope missing');
  assert.ok(/record\.addedNodes/.test(source), 'observer does not stay within addedNodes');
});

test('photo preview has maintainable source and no global error suppression', function(){
  var source = read('js/photo-wall/preview.js');
  var html = read('index.html');
  assert.ok(source.indexOf('function handleLoad()') >= 0 && source.indexOf('function handleError()') >= 0, 'slide preview handlers missing');
  assert.ok(source.indexOf('function handleOpenLoad()') >= 0 && source.indexOf('function handleOpenError()') >= 0 && source.indexOf('function cleanupOpenListeners()') >= 0, 'open preview handlers missing');
  assert.strictEqual(source.indexOf('function onLoad()'), -1, 'legacy onLoad handler remains');
  assert.strictEqual(source.indexOf('function onErr()'), -1, 'legacy onErr handler remains');
  assert.ok(source.indexOf('onErr is not defined') < 0 && source.indexOf('onLoad is not defined') < 0, 'preview source contains known error');
  assert.ok(html.indexOf('Suppressed preview.min.js known bug') < 0, 'preview error suppression remains');
  assert.ok(read('scripts/build.js').indexOf("'js/photo-wall/preview.js'") >= 0, 'preview source is not built');
});

test('debug performance metrics are opt-in and local-only', function(){
  var source = read('js/performance.js');
  assert.ok(source.indexOf("get('perf') === '1'") >= 0, 'perf query gate missing');
  ['dom-content-loaded','load','first-post-render','longtask','largest-contentful-paint','totalBytes'].forEach(function(metric) {
    assert.ok(source.indexOf(metric) >= 0, 'performance metric missing: ' + metric);
  });
  assert.ok(source.indexOf('fetch(') < 0 && source.indexOf('localStorage') < 0, 'performance metrics leave the browser');
  assert.ok(read('js/core.js').indexOf("mark('ai-first-open')") >= 0, 'AI first-open mark missing');
});

test('hashed assets and dynamic APIs have explicit cache policies', function(){
  var source = read('render-api/server.js');
  assert.ok(source.indexOf("public, max-age=31536000, immutable") >= 0, 'immutable asset cache policy missing');
  assert.ok(source.indexOf("res.setHeader('Cache-Control', 'no-cache')") >= 0, 'HTML no-cache policy missing');
  assert.ok(source.indexOf("res.setHeader('Cache-Control', 'no-store')") >= 0, 'dynamic API no-store policy missing');
});
test('login-device executes only from its single static entry', function(){
  var html = read('index.html');
  var core = read('js/core.js');
  assert.strictEqual((html.match(/<script[^>]+src="js\/login-device\.min\.js\?v=/g) || []).length, 1, 'login-device static script count');
  assert.ok(!/xtjLoadScript(?:Once|Sequence)[\s\S]{0,260}login-device/.test(core), 'core can load login-device twice');
});
test('photo upload progress is processed-based and reports safe batch outcomes', function(){
  var source = read('js/photo-wall/upload-ui.js');
  assert.ok(source.indexOf('var processed = 0;') >= 0, 'processed counter missing');
  assert.ok(source.indexOf('processed += 1;') >= 0, 'every settled item must advance progress');
  assert.ok(source.indexOf('updateUploadBatchProgress(processed, total, ok, fail') >= 0, 'batch progress helper unused');
  assert.ok(source.indexOf('uploadBatchPercent(processed, total)') >= 0, 'progress must not be success-based');
  assert.ok(source.indexOf("if (state.uploading) { toast('正在上传，请等待'); return; }") >= 0, 'duplicate start feedback missing');
  assert.ok(source.indexOf("setUploadResult(summary") >= 0, 'persistent batch result missing');
  assert.ok(source.indexOf("'文件类型不支持'") >= 0, 'safe type failure reason missing');
  assert.ok(source.indexOf("'图片已上传，但记录保存失败'") >= 0, 'safe record failure reason missing');
  assert.ok(source.indexOf("'后端不可达'") >= 0, 'safe network failure reason missing');
  assert.ok(source.indexOf('await new Promise(function(resolve){ setTimeout(resolve, 180); });') >= 0, 'final 100 percent state is not painted before close');
});
test('dock tab and indicator selectors were not edited by this optimization', function(){
  var diff = cp.execSync('git diff -- . ":(exclude)*.min.js" ":(exclude)*.min.css" ":(exclude)*.bak"', {encoding:'utf8'});
  assert.ok(!/^[+-](?!\+\+\+|---).*\.dock-(?:bar|tab|indicator)\b/m.test(diff), 'dock bar/tab/indicator selector changed');
});

console.log('\n=== Photo Upload Failure Behavior ===');
test('upload has centralized cleanupStorage helper', function(){
  var s = read('js/photo-wall/upload-ui.js');
  assert.ok(s.indexOf('function cleanupStorage(path)') >= 0, 'cleanupStorage helper missing');
  assert.ok(s.indexOf("console.error('[photo-upload] Storage cleanup error'") >= 0, 'cleanupStorage logs errors');
});
test('Storage upload success but fetch network error removes file', function(){
  var s = read('js/photo-wall/upload-ui.js');
  assert.ok(s.indexOf("await cleanupStorage(path)") >= 0, 'cleanupStorage not called after error');
  assert.ok(s.indexOf("fetchError.photoUploadCode = 'backend_unreachable'") >= 0, 'network error code missing');
});
test('fetch throws timeout sets AbortController and clears timer', function(){
  var s = read('js/photo-wall/upload-ui.js');
  assert.ok(s.indexOf('var controller = new AbortController()') >= 0, 'AbortController missing');
  assert.ok(s.indexOf('setTimeout(function() { controller.abort()') >= 0, 'timeout abort missing');
  assert.ok(s.indexOf('clearTimeout(timeoutTimer)') >= 0, 'timeout timer not cleaned up');
  assert.ok(s.indexOf("fetchError.photoUploadCode = 'timeout'") >= 0, 'timeout code missing');
  assert.ok(s.indexOf('PHOTO_UPLOAD_TIMEOUT_MS') >= 0, 'timeout constant missing');
});
test('HTTP non-2xx response leaves rollback to the server', function(){
  var s = read('js/photo-wall/upload-ui.js');
  var httpOkBlock = s.slice(s.indexOf('if (!createRes.ok)'), s.indexOf('var createData;'));
  assert.strictEqual(httpOkBlock.indexOf('await cleanupStorage(path)'), -1, 'HTTP error duplicates server rollback');
  assert.ok(httpOkBlock.indexOf("photoUploadStage = 'record'") >= 0, 'record stage marker missing');
});
test('JSON parse failure after HTTP response does not duplicate rollback', function(){
  var s = read('js/photo-wall/upload-ui.js');
  var parseCatch = s.slice(s.indexOf('catch (parseError)'));
  assert.strictEqual(parseCatch.indexOf('await cleanupStorage(path)'), -1, 'parse error duplicates server rollback');
});
test('response with missing data field remains a record failure', function(){
  var s = read('js/photo-wall/upload-ui.js');
  assert.ok(s.indexOf("if (!createData || !createData.data)") >= 0, 'missing data guard missing');
  var guardBlock = s.slice(s.indexOf("if (!createData || !createData.data)"), s.indexOf('return createData.data;'));
  assert.strictEqual(guardBlock.indexOf('await cleanupStorage(path)'), -1, 'missing data duplicates server rollback');
});

test('photo create headers always retain JSON content type', function(){
  var source = read('js/photo-wall/upload-ui.js');
  var match = source.match(/function buildPhotoCreateHeaders\(authHeaders\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(match, 'missing photo create header helper');
  var buildHeaders = vm.runInNewContext('(' + match[0] + ')', { Object: Object });
  function plain(value) { return JSON.parse(JSON.stringify(value)); }
  assert.deepStrictEqual(plain(buildHeaders({ 'Content-Type': 'application/custom', Authorization: 'Bearer test' })), {
    'Content-Type': 'application/custom', Authorization: 'Bearer test'
  });
  assert.deepStrictEqual(plain(buildHeaders({ Authorization: 'Bearer test' })), {
    'Content-Type': 'application/json', Authorization: 'Bearer test'
  });
  assert.deepStrictEqual(plain(buildHeaders(null)), { 'Content-Type': 'application/json' });
  assert.deepStrictEqual(plain(buildHeaders({})), { 'Content-Type': 'application/json' });
});

test('photo create request sends only controlled metadata', function(){
  var source = read('js/photo-wall/upload-ui.js');
  var request = source.slice(source.indexOf("fetch(apiUrl('/api/photo/create')"), source.indexOf('var createData;'));
  ['content:', 'actor_key:'].forEach(function(field) {
    assert.strictEqual(request.indexOf(field), -1, 'legacy client field remains: ' + field);
  });
  ['media_url:', 'file_size:', 'original_size:', 'mime_type:'].forEach(function(field) {
    assert.ok(request.indexOf(field) >= 0, 'missing controlled client field: ' + field);
  });
});
test('batch upload refresh failure does not swallow upload results', function(){
  var s = read('js/photo-wall/upload-ui.js');
  assert.ok(s.indexOf('var refreshFailed = false;') >= 0, 'refresh error boundary missing');
  assert.ok(s.indexOf('refreshFailed = true') >= 0, 'refresh failure flag missing');
  assert.ok(s.indexOf('列表刷新失败，请点击重试') >= 0, 'refresh failure message missing');
  assert.ok(s.indexOf("window.loadPhotoWallData") >= 0, 'list refresh code missing');
});
test('storage cleanup failure preserves original upload error and logs', function(){
  var s = read('js/photo-wall/upload-ui.js');
  assert.ok(s.indexOf("console.error('[photo-upload] Storage cleanup failed'") >= 0, 'cleanup failure not logged');
});
test('refresh failure does not re-upload files', function(){
  var s = read('js/photo-wall/upload-ui.js');
  assert.ok(s.indexOf("state.photoFiles = []") > s.indexOf("} finally {"), 'photoFiles cleared in finally before refresh');
});

test('showToast wrapper forwards all arguments after text repair', function(){
  var source = read('js/features.js');
  assert.ok(source.indexOf('original.apply(this, args)') >= 0, 'showToast wrapper does not forward all arguments');
  assert.ok(source.indexOf('args[0] = fixText') >= 0, 'showToast text repair missing');
});

test('wide Dock and iPad post layout use explicit visible and single-column overrides', function(){
  var source = read('css/ui-shell.css');
  assert.ok(/@media \(min-width: 1024px\)[\s\S]*?transform: translate\(-50%, 0\) !important/.test(source), 'wide Dock remains hidden');
  assert.ok(/@media \(min-width: 1024px\) and \(max-width: 1279px\)[\s\S]*?grid-template-areas: "stats" "publish" "filter" "feed"/.test(source), 'iPad post layout is not single-column');
  assert.ok(source.indexOf('grid-template-columns: repeat(3, minmax(0, 1fr)) !important') >= 0, 'iPad stats are not three columns');
});

console.log('\n=== English Module Regression Guards ===');
test('server.js public post filter excludes retired English marker', function(){
  var s = read('render-api/server.js');
  assert.ok(s.indexOf("__ai_english_learning__") >= 0, 'server.js missing __ai_english_learning__ filter');
  assert.ok(s.indexOf(".neq('media_type', AI_ENGLISH_LEARNING_MARKER)") >= 0 || s.indexOf(".neq('media_type', '__ai_english_learning__')") >= 0, 'server.js filter chain missing English marker');
});

test('core.js Supabase query excludes retired English marker', function(){
  var s = read('js/core.js');
  assert.ok(s.indexOf('neq("media_type", "__ai_english_learning__")') >= 0, 'core.js Supabase query missing English marker');
});

test('core.js cache filter excludes retired English marker', function(){
  var s = read('js/core.js');
  assert.ok(s.indexOf("p.media_type !== '__ai_english_learning__'") >= 0, 'core.js cachePosts filter missing English marker');
  assert.ok(s.indexOf("post.media_type !== \"__ai_english_learning__\"") >= 0, 'core.js stat filter missing English marker');
});

test('retired English source files do not exist', function(){
  assert.ok(!fileExists('render-api/english-generate.js'), 'english-generate.js still exists');
  assert.ok(!fileExists('js/english-learning.js'), 'english-learning.js still exists');
  assert.ok(!fileExists('js/english-dict.js'), 'english-dict.js still exists');
  assert.ok(!fileExists('css/english-learning.css'), 'english-learning.css still exists');
  assert.ok(!fileExists('tests/english-generate.test.js'), 'english-generate.test.js still exists');
});

test('index.html contains no English module references', function(){
  var s = read('index.html');
  assert.ok(s.indexOf('panelEnglishLearning') < 0, 'index.html contains panelEnglishLearning');
  assert.ok(s.indexOf('xtj-module-english-style') < 0, 'index.html contains xtj-module-english-style');
  assert.ok(s.indexOf('xtj-module-english-script') < 0, 'index.html contains xtj-module-english-script');
  assert.ok(s.indexOf('xtj-english-dict-src') < 0, 'index.html contains xtj-english-dict-src');
});

test('server.js contains no English API routes', function(){
  var s = read('render-api/server.js');
  assert.ok(s.indexOf('/api/agent/english/state') < 0, 'server.js contains /api/agent/english/state');
  assert.ok(s.indexOf('/api/agent/english/parse-batch') < 0, 'server.js contains /api/agent/english/parse-batch');
  assert.ok(s.indexOf('/api/agent/english/generate') < 0, 'server.js contains /api/agent/english/generate');
  assert.ok(s.indexOf('registerEnglishGenerateRoute') < 0, 'server.js contains registerEnglishGenerateRoute');
});

console.log('\n=== Results ===');
console.log('  Passed: ' + passed); console.log('  Failed: ' + failed);
if (failed) process.exit(1);
