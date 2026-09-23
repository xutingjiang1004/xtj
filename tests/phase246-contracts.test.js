'use strict';

// Phase 2/4/6 regression tests for the overnight audit fix.
// These are static-contract tests: they read source files and verify that
// the fixed code patterns are present and the broken patterns are gone.

const assert = require('assert');
const test = require('node:test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
// 去掉整行注释后再做"禁止出现某模式"的断言：源码里常常用注释引用被废弃的旧写法
// 来说明修复背景，如果不剔除会把注释里的示例代码误判成仍然存在的坏模式。
function codeOnly(rel) {
  return read(rel)
    .split('\n')
    .filter((line) => line.trim().indexOf('//') !== 0)
    .join('\n');
}

// ──────────────────────────────────────────────
// Phase 4: Photo wall & media
// ──────────────────────────────────────────────

test('P4-15: empty cloud photo list clears local cache', function () {
  var s = read('js/photo-wall/data.js');
  // When rows.length === 0, window.photoWallData must be set to [], not local.
  var m = s.match(/if\s*\(\s*rows\.length\s*===\s*0\s*\)\s*\{[\s\S]*?window\.photoWallData\s*=\s*\[\]/);
  assert.ok(m, 'empty cloud result must clear photoWallData to empty array');
  // Ensure the old "preserve local" behavior is gone.
  var oldBehavior = s.match(/rows\.length\s*===\s*0[\s\S]{0,80}window\.photoWallData\s*=\s*local/);
  assert.ok(!oldBehavior, 'old preserve-local behavior must be removed');
});

test('P4-16: view-count sync goes through /api/photo/view and rolls back', function () {
  var s = codeOnly('js/photo-wall/data.js');
  assert.ok(/originalViews\s*=\s*Number\(item\.views/.test(s),
    'syncPhotoViewCount must save originalViews before optimistic update');

  // ★ P1-12 审计修复：前端不得再直连 Supabase RPC increment_post_views。
  //   056 迁移把该函数 GRANT 给了 anon，等同于公开一个"刷浏览量 + 读私密帖
  //   精确计数"的接口。计数必须改走后端 /api/photo/view。
  assert.ok(!/window\.sb\.rpc\(\s*['"]increment_post_views/.test(s),
    'syncPhotoViewCount must NOT call the increment_post_views RPC directly');
  assert.ok(/apiUrl\(\s*['"]\/api\/photo\/view['"]\s*\)/.test(s),
    'syncPhotoViewCount must POST to /api/photo/view');
  assert.ok(/method:\s*['"]POST['"]/.test(s) && /photo_id:\s*item\.cloudId/.test(s),
    'view request must be a POST carrying photo_id');
  assert.ok(/credentials:\s*['"]include['"]/.test(s),
    'view request must send credentials so optionalAuth can identify the viewer');

  // 失败必须回滚乐观自增：HTTP 非 2xx、业务 ok!==true、网络异常三条路径。
  assert.ok(/!viewResp\.ok\s*\|\|\s*!viewPayload\s*\|\|\s*viewPayload\.ok\s*!==\s*true[\s\S]*?rollbackView\(\)/.test(s),
    'non-ok HTTP / failed payload must roll back the optimistic increment');
  assert.ok(/\}\s*catch\s*\(_\)\s*\{[\s\S]{0,120}rollbackView\(\)/.test(s),
    'network exception must roll back the optimistic increment');
  // 以服务端返回的真实计数为准，避免本地乐观值长期漂移。
  assert.ok(/viewPayload\.views[\s\S]{0,120}item\.views\s*=\s*viewPayload\.views/.test(s),
    'successful sync must adopt the server-returned view count');
});

test('P4-17: cancel upload aborts Storage request via signal', function () {
  var s = read('js/photo-wall/upload-ui.js');
  // Storage upload must pass signal in options.
  assert.ok(/storage\.from\('uploads'\)\.upload\([\s\S]*?signal:\s*signal\s*\|\|\s*undefined/.test(s),
    'Storage upload must pass signal to support abort');
  // cancelCurrentUpload must abort batchController.
  assert.ok(/cancelCurrentUpload[\s\S]*?batchController\.abort\(\)/.test(s),
    'cancelCurrentUpload must abort batchController');
});

test('P4-18: pending uploads have expiry, backoff, and stale state', function () {
  var s = read('js/photo-wall/upload-ui.js');
  assert.ok(/retryCount:\s*0/.test(s) && /lastQueriedAt:\s*0/.test(s) && /stale:\s*false/.test(s),
    'pending records must have retryCount, lastQueriedAt, stale fields');
  assert.ok(/maxRetryCount\s*=\s*10/.test(s), 'max retry count must be defined');
  assert.ok(/minRetryInterval\s*=/.test(s), 'min retry interval must be defined');
  assert.ok(/entry\.stale\s*=\s*true/.test(s), 'expired entries must be marked stale');
});

test('P4-19: upload count text uses MAX_BATCH_COUNT constant', function () {
  var s = read('js/photo-wall/upload-ui.js');
  assert.ok(/最多\s*'\s*\+\s*MAX_BATCH_COUNT/.test(s),
    'subtitle text must use MAX_BATCH_COUNT constant, not hardcoded 9');
  // Ensure hardcoded "9" text is gone.
  assert.ok(!/最多\s*9\s*张/.test(s), 'hardcoded "9" in subtitle must be removed');
});

test('P4-20: broken images do not enter preview cache', function () {
  var s = read('js/photo-wall/preview.js');
  assert.ok(/naturalWidth\s*>\s*0\s*&&\s*cachePreviewImage/.test(s),
    'cachePreviewImage must only be called when naturalWidth > 0');
  assert.ok(/onerror\s*=\s*function[\s\S]*?do NOT cache/.test(s) || /onerror.*不.*cache/i.test(s),
    'onerror must NOT cache the broken image');
});

test('P4-21: preview.js has no duplicate function N', function () {
  var s = read('js/photo-wall/preview.js');
  // Count function N declarations (should be 1, not 2)
  var count = (s.match(/function\s+N\s*\(/g) || []).length;
  assert.strictEqual(count, 1, 'function N must be declared exactly once (was 2)');
  // Verify the dead toast N was removed.
  assert.ok(/removed duplicate function N/.test(s), 'comment documenting N removal must exist');
});

test('P4-22: preview.js inner T renamed to avoid shadowing', function () {
  var s = read('js/photo-wall/preview.js');
  // The inner cleanup function must be renamed (not T).
  assert.ok(/function _ppCleanupFn\(\)/.test(s), 'inner cleanup function must be renamed to _ppCleanupFn');
  assert.ok(/d\._cleanupPreview\s*=\s*_ppCleanupFn/.test(s), '_cleanupPreview must reference _ppCleanupFn');
});

// ──────────────────────────────────────────────
// Phase 6: DM & avatar
// ──────────────────────────────────────────────

test('P6-18: Storage upload error blocks DM send', function () {
  var s = read('js/core.js');
  assert.ok(/uploadResult\s*&&\s*uploadResult\.error/.test(s),
    'DM upload must check uploadResult.error');
  assert.ok(/throw new Error\('媒体上传失败/.test(s),
    'DM upload must throw on Storage error, blocking message send');
});

test('P6-19: audio is fully supported or rejected', function () {
  var s = read('js/core.js');
  // Upload branch must handle audio.
  assert.ok(/__dm_aud__/.test(s), 'audio actor key __dm_aud__ must exist in upload branch');
  assert.ok(/file\.type\.startsWith\('audio\/'\)/.test(s), 'audio type must be handled in upload branch');
  // resolveDockChatMedia must parse __dm_aud__.
  assert.ok(/actorKey\.indexOf\('__dm_aud__'\)/.test(s), 'resolveDockChatMedia must parse __dm_aud__');
  // buildDockChatBodyMarkup must render <audio>.
  assert.ok(/media\.kind\s*===\s*'audio'[\s\S]*?<audio/.test(s), 'audio must render with <audio> tag');
  // HTML input accept must include audio.
  var html = read('index.html');
  assert.ok(/accept="image\/\*,video\/\*,audio\/\*"/.test(html), 'HTML file input must accept audio');
});

test('P6-20: /api/dm/send forces media_type to DM_MARKER', function () {
  var s = read('render-api/server.js');
  // mediaType must be hardcoded to DM_MARKER, not from req.body.
  assert.ok(/var mediaType\s*=\s*DM_MARKER;/.test(s),
    'media_type must be forced to DM_MARKER, not from client');
  // Ensure old pattern (reading from req.body) is gone in the send handler.
  var sendBlock = s.slice(s.indexOf("app.post('/api/dm/send'"), s.indexOf("app.post('/api/dm/withdraw'"));
  assert.ok(!/var mediaType\s*=\s*String\(req\.body/.test(sendBlock),
    'media_type must not be read from req.body in /api/dm/send');
  // actor_key must be validated against allowed DM prefixes (ALLOWED_KINDS).
  assert.ok(/ALLOWED_KINDS/.test(sendBlock), 'actor_key must be validated against allowed DM prefixes (ALLOWED_KINDS)');
  // Path traversal must be blocked (on storagePath).
  assert.ok(/\.test\(storagePath\)/.test(sendBlock) || /storagePath.*\.\./.test(sendBlock),
    'storagePath must be tested for path traversal');
  assert.ok(sendBlock.indexOf('invalid_media_path') >= 0,
    'path traversal must be blocked with invalid_media_path error code');
});

test('P6-21: batch avatar endpoint returns null for missing avatars', function () {
  var s = read('render-api/server.js');
  var block = s.slice(s.indexOf("app.post('/api/avatar/batch'"), s.indexOf("// ===================== 私信列表"));
  assert.ok(/names\.forEach\(function\(name\)[\s\S]*?result\[name\]\s*=\s*null/.test(block),
    'batch avatar must return null for users without avatars');
});

test('P6-22: avatar null clears memory and localStorage cache', function () {
  var s = read('js/core.js');
  // hydrateDockChatAvatars must delete avatarCache on null.
  assert.ok(/v\s*===\s*null\s*&&\s*avatarCache\[k\][\s\S]*?delete\s+avatarCache\[k\]/.test(s),
    'hydrateDockChatAvatars must delete avatarCache[k] on null');
  // localStorage cache must also be cleared on null.
  assert.ok(/result\.avatars\[k2\]\s*===\s*null[\s\S]*?delete\s+cachedAvatars\[k2\]/.test(s),
    'localStorage avatar cache must be cleared on null');
  // fetchAvatarUrl must have TTL (not permanent short-circuit).
  assert.ok(/FETCH_TTL/.test(s), 'fetchAvatarUrl must have a TTL to expire stale avatars');
  // fetchAvatarUrl must clear cache on null response.
  assert.ok(/result\.avatar_url\s*===\s*null[\s\S]*?delete\s+avatarCache\[userName\]/.test(s),
    'fetchAvatarUrl must clear cache on null avatar_url');
});

test('P6-23: DM withdraw cleans up Storage media', function () {
  var s = read('render-api/server.js');
  var block = s.slice(s.indexOf("app.post('/api/dm/withdraw'"), s.indexOf("} catch (e) {", s.indexOf("app.post('/api/dm/withdraw'") + 100));
  // Must select actor_key when looking up the message.
  assert.ok(/select\('id,\s*user_name,\s*created_at,\s*content,\s*media_type,\s*actor_key'\)/.test(block),
    'dm withdraw must select actor_key when looking up message');
  // Must extract storage path from actor_key.
  assert.ok(/DM_MEDIA_PREFIXES/.test(block), 'dm withdraw must extract storage path from actor_key');
  // Must call supabase.storage.remove.
  assert.ok(/storage\.from\('uploads'\)\.remove\(\[storagePath\]\)/.test(block),
    'dm withdraw must remove Storage file');
});
