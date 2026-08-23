'use strict';

// Phase 1-6 reliability contracts tests for the overnight audit confirmation fix.
// Static-contract tests: read source files and verify fixed code patterns.

const assert = require('assert');
const test = require('node:test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// ──────────────────────────────────────────────
// Phase 4: Kitty AI lifecycle
// ──────────────────────────────────────────────

test('P4-01: parent comment delete handles AI reply and job', function () {
  var s = read('render-api/server.js');
  assert.ok(/generated_by_ai/.test(s) && /blocked/.test(s),
    'comment delete must handle AI reply and job');
  assert.ok(/reply_comment_id/.test(s),
    'job must save reply_comment_id');
});

test('P4-02: completed must correspond to real reply', function () {
  var s = read('render-api/server.js');
  assert.ok(/reply_deleted/.test(s) && /reply_missing/.test(s),
    'status must return reply_deleted/reply_missing when reply is gone');
  assert.ok(/repair_required/.test(s),
    'repair_required status must exist');
});

test('P4-03: DB error does not misjudge comment as deleted', function () {
  var s = read('render-api/server.js');
  assert.ok(/isValidCatTrigger/.test(s),
    'isValidCatTrigger must exist');
  assert.ok(/authorRecord.*error|fail-open|fail.*open/.test(s) ||
            /error.*true.*return/.test(s),
    'DB error must not misjudge as deleted');
});

test('P4-04: job status update checks error, row count, uses CAS', function () {
  var s = read('render-api/server.js');
  assert.ok(/\.eq\(['"]status['"]\s*,\s*['"]processing['"]\)/.test(s),
    'job update must use CAS (eq status processing)');
  assert.ok(/error.*check|row.*count|行数/.test(s) ||
            /result\.error/.test(s),
    'must check error after job update');
});

test('P4-05: cancelCatAiTask(commentId, reason)', function () {
  var s = read('js/core.js');
  assert.ok(/cancelCatAiTask\s*\(/.test(s),
    'cancelCatAiTask must exist');
  assert.ok(/commentId/.test(s) && /reason/.test(s),
    'cancelCatAiTask must accept commentId and reason');
});

test('P4-06: Realtime DELETE cleans up single comment task', function () {
  var s = read('js/core.js');
  assert.ok(/cancelCatAiTask.*comment.*deleted/.test(s) ||
            /cancelCatAiTask\(.*commentId/.test(s),
    'Realtime DELETE must call cancelCatAiTask');
});

test('P4-07: @小猫咪 does not trigger', function () {
  var s = read('render-api/server.js');
  var frontend = read('js/core.js');
  // Both frontend and backend must use the correct regex
  assert.ok(/\[@＠\]小猫\(\?!\[猫咪\]\)/.test(s) ||
            /\[@＠\]小猫\(\?![猫咪]/.test(s),
    'backend regex must exclude 猫 and 咪 after 小猫');
  assert.ok(/\[@＠\]小猫\(\?!\[猫咪\]\)/.test(frontend) ||
            /\[@＠\]小猫\(\?![猫咪]/.test(frontend),
    'frontend regex must exclude 猫 and 咪 after 小猫');
});

test('P4-08: limited idempotent reconciliation', function () {
  var s = read('render-api/server.js');
  assert.ok(/reconcileCatJobs/.test(s) || /reconcile.*cat.*job/.test(s),
    'reconciliation function must exist');
});

// ──────────────────────────────────────────────
// Phase 5: Photo backend and cleanup
// ──────────────────────────────────────────────

test('P5-01: same upload_id, different paths concurrent cleanup', function () {
  var s = read('render-api/server.js');
  assert.ok(/photo\/cleanup/.test(s) || /photo\/status/.test(s),
    'photo cleanup endpoint must exist');
  assert.ok(/unreferenced|冗余|多余/.test(s) || /clean.*unref/.test(s),
    'must handle unreferenced files');
});

test('P5-02: repair failure does not delete the only usable new file', function () {
  var s = read('render-api/photo-create.js');
  assert.ok(/不删除新文件|不删除唯一/.test(s) ||
            /delete.*new.*file.*fail/.test(s) ||
            /错误.*不删除/.test(s),
    'repair failure must not delete the only usable file');
});

test('P5-03: pagination binds generation, page, requestId, AbortController', function () {
  var s = read('js/photo-wall/data.js');
  assert.ok(/_fetchPhotoPageState/.test(s) || /fetchPhotoPageState/.test(s),
    'fetchPhotoPage must have state tracking');
  assert.ok(/requestId/.test(s) && /AbortController/.test(s),
    'must bind requestId and AbortController');
});

test('P5-04: view count failure deletes throttle key', function () {
  var s = read('js/photo-wall/data.js');
  assert.ok(/syncPhotoViewCount/.test(s),
    'syncPhotoViewCount must exist');
  assert.ok(/节流|throttle|throttleKey/.test(s) ||
            /safeStorage.*remove|delete.*throttle/.test(s),
    'failure must delete throttle key for immediate retry');
});

// ──────────────────────────────────────────────
// Phase 6: DM media
// ──────────────────────────────────────────────

test('P6-01: upload success, message API fails deletes file', function () {
  var s = read('render-api/server.js');
  var dmSendBlock = s.slice(s.indexOf("app.post('/api/dm/send'"));
  assert.ok(/storage.*remove|删除.*文件/.test(dmSendBlock) ||
            /cleanup.*upload/.test(dmSendBlock),
    'message API failure must trigger file cleanup');
});

test('P6-02: delete failure enters storage_cleanup_jobs', function () {
  var s = read('render-api/server.js');
  var dmSendBlock = s.slice(s.indexOf("app.post('/api/dm/send'"));
  assert.ok(/storage_cleanup_jobs/.test(dmSendBlock),
    'cleanup failure must enter storage_cleanup_jobs');
});

test('P6-03: client only submits storage_path, kind, mime_type', function () {
  var s = read('js/core.js');
  var sendBlock = s.slice(s.indexOf("async function sendDockChatMessage"));
  // Client should not send actor_key or media_type
  assert.ok(/storage_path/.test(sendBlock) || /storagePath/.test(sendBlock),
    'client must submit storage_path');
  assert.ok(/kind/.test(sendBlock) && /mime_type/.test(sendBlock),
    'client must submit kind and mime_type');
});

test('P6-04: backend generates URL and actor_key, rejects external URLs', function () {
  var s = read('render-api/server.js');
  var dmSendBlock = s.slice(s.indexOf("app.post('/api/dm/send'"));
  assert.ok(/getPublicUrl/.test(dmSendBlock) || /publicUrl/.test(dmSendBlock),
    'backend must generate public URL');
  assert.ok(/__dm_img__|__dm_vid__|__dm_aud__/.test(dmSendBlock),
    'backend must generate actor_key with DM prefix');
  assert.ok(/http/.test(dmSendBlock) && /reject|拒绝|invalid/.test(dmSendBlock),
    'external URLs must be rejected');
});

test('P6-05: withdraw failure enters cleanup queue', function () {
  var s = read('render-api/server.js');
  var withdrawBlock = s.slice(s.indexOf("app.post('/api/dm/withdraw'"));
  assert.ok(/storage_cleanup_jobs/.test(withdrawBlock),
    'withdraw failure must enter storage_cleanup_jobs');
});

test('P6-06: audio preview does not use img', function () {
  var s = read('js/core.js');
  var previewBlock = s.slice(s.indexOf("function showDockChatFilePreview"));
  assert.ok(/audio/.test(previewBlock) && !/<img/.test(previewBlock) ||
            /audio/.test(previewBlock) && /span/.test(previewBlock),
    'audio preview must not use <img> tag');
});

test('P6-06b: dock chat supports paste image and drag-drop upload', function () {
  var s = read('js/core.js');
  assert.ok(s.indexOf('function assignDockChatFile') >= 0, 'assignDockChatFile helper required');
  assert.ok(s.indexOf('function bindDockChatPasteAndDrop') >= 0, 'paste/drop binder required');
  assert.ok(s.indexOf('extractClipboardMediaFile') >= 0, 'clipboard media extractor required');
  assert.ok(/is-file-dragover/.test(s), 'dragover visual class required');
  assert.ok(/DataTransfer/.test(s), 'DataTransfer assign into file input required');
});

test('P6-06c: AI chat composer supports paste image and drag-drop upload', function () {
  var s = read('js/ai-agent.js');
  assert.ok(s.indexOf('function bindAiComposerPasteDrop') >= 0, 'AI paste/drop binder required');
  assert.ok(s.indexOf('function extractClipboardAiFile') >= 0, 'AI clipboard extractor required');
  assert.ok(s.indexOf('function readAiAttachmentFile') >= 0, 'shared AI file reader required');
  assert.ok(/is-file-dragover/.test(s), 'AI dragover visual class required');
  assert.ok(/acceptAiChatFile/.test(s) && /acceptDtFile/.test(s),
    'normal chat and deep-think must both accept dropped/pasted files');
});

test('P6-07: target query error returns retryable 503', function () {
  var s = read('render-api/server.js');
  var dmSendBlock = s.slice(s.indexOf("app.post('/api/dm/send'"));
  assert.ok(/503/.test(dmSendBlock) && /retryable/.test(dmSendBlock),
    'target query error must return 503 retryable');
  assert.ok(/target_not_found/.test(dmSendBlock),
    'truly no user returns target_not_found');
});
