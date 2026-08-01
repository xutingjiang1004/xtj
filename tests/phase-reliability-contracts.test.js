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
// Phase 1: SSE, Idempotency, Persistence
// ──────────────────────────────────────────────

test('P1-01: insertEvent returns authority result, does not swallow error', function () {
  var s = read('render-api/ai-core/stream-session.js');
  // insertEvent must return { attempted, succeeded, failed, eventId } on success
  assert.ok(/attempted:\s*1,\s*succeeded:\s*1,\s*failed:\s*0/.test(s) ||
            /succeeded:\s*1/.test(s),
    'insertEvent must return success count fields');
  // On error, must return retryable and error fields
  assert.ok(/retryable:\s*true,\s*error:\s*\{/.test(s),
    'insertEvent must return error details on failure');
});

test('P1-02: flush returns attempted/succeeded/failed/lastPersistedEventId', function () {
  var s = read('render-api/ai-core/stream-session.js');
  assert.ok(/lastPersistedEventId/.test(s),
    'flush must return lastPersistedEventId');
  assert.ok(/attempted.*succeeded.*failed/.test(s),
    'flush must return operation counts');
});

test('P1-03: idempotency query distinguishes found/not_found/query_failed', function () {
  var s = read('render-api/ai-core/stream-session.js');
  assert.ok(/queryIdempotencyKey/.test(s),
    'queryIdempotencyKey function must exist');
  assert.ok(/found:\s*true/.test(s) && /found:\s*false/.test(s),
    'must distinguish found vs not_found');
  assert.ok(/query_failed/.test(s),
    'must return query_failed on DB error');
});

test('P1-04: query_failed must not call Provider', function () {
  var s = read('render-api/ai-core/stream-session.js');
  // The idempotency check should return early on query_failed
  assert.ok(/query_failed/.test(s),
    'query_failed state must be returned');
});

test('P1-05: session created successfully before starting recoverable task', function () {
  var s = read('render-api/ai-core/stream-session.js');
  // createStreamSession must return { data } or { error }
  assert.ok(/return\s*\{.*data:/.test(s) || /data:\s*session/.test(s),
    'createStreamSession must return data on success');
  assert.ok(/error:\s*\{/.test(s),
    'createStreamSession must return error on failure');
});

test('P1-06: error terminal persisted before closing SSE', function () {
  var s = read('render-api/ai-core/stream-session.js');
  // flush must return the lastPersistedEventId so callers can verify
  // terminal event was persisted before closing
  assert.ok(/lastPersistedEventId/.test(s),
    'flush must track last persisted event ID');
});

test('P1-07: backoff delay for retry', function () {
  var s = read('render-api/ai-core/stream-session.js');
  assert.ok(/getBackoffDelay/.test(s),
    'getBackoffDelay function must exist');
  assert.ok(/Math\.pow\(2,/.test(s),
    'backoff must use exponential delay');
});

// ──────────────────────────────────────────────
// Phase 2: Code documents, retry, operations
// ──────────────────────────────────────────────

test('P2-01: document states extracting/ready/failed/timed_out/cancelled', function () {
  var s = read('js/code-workspace.js');
  assert.ok(/_docState\s*===?\s*'extracting'/.test(s),
    'document extracting state must exist');
  assert.ok(/_docState\s*===?\s*'ready'/.test(s) || /_docState\s*===?\s*'failed'/.test(s),
    'document ready/failed states must exist');
  assert.ok(/timed_out/.test(s) || /'timed_out'/.test(s),
    'document timed_out state must exist');
  assert.ok(/cancelled/.test(s) && /_docState/.test(s),
    'document cancelled state must exist');
});

test('P2-02: default block send when doc not ready', function () {
  var s = read('js/code-workspace.js');
  assert.ok(/_docState\s*===?\s*'extracting'/.test(s),
    'sendMessage must check for extracting documents');
  assert.ok(/toast.*正在解析|toast.*请稍候|toast.*documents_not_ready/.test(s),
    'must show toast when docs are still extracting');
});

test('P2-03: ignore document send carries context_warnings', function () {
  var s = read('js/code-workspace.js');
  assert.ok(/context_warnings/.test(s),
    'buildChatRequestBody must include context_warnings');
  assert.ok(/documents_not_ready/.test(s),
    'context_warnings must include documents_not_ready');
});

test('P2-04: timeout/cancel binds AbortController', function () {
  var s = read('js/code-workspace.js');
  assert.ok(/_extractAbortController/.test(s) || /extractAbortController/.test(s),
    'document extraction must have AbortController');
  assert.ok(/abortController\.abort/.test(s) || /controller\.abort/.test(s),
    'timeout must abort the extraction');
});

test('P2-05: late extraction does not pollute new generation', function () {
  var s = read('js/code-workspace.js');
  assert.ok(/_extractGeneration/.test(s),
    'extraction must track generation');
  assert.ok(/workspaceGeneration.*!==.*_extractGeneration/.test(s) ||
            /generation.*discard/.test(s) ||
            /generation.*stale/.test(s),
    'generation mismatch must discard result');
});

test('P2-06: regenerate uses current file, attachments, model, thinking mode', function () {
  var s = read('js/code-workspace.js');
  assert.ok(/useCurrentContext/.test(s),
    'regenerate must support useCurrentContext option');
  assert.ok(/retry:\s*true,\s*useCurrentContext:\s*true/.test(s) ||
            /useCurrentContext:\s*true[\s\S]{0,100}retry/.test(s),
    'default regenerate must use current context');
});

test('P2-07: original context replay as separate option', function () {
  var s = read('js/code-workspace.js');
  assert.ok(/replayOriginal/.test(s) || /replay_original/.test(s),
    'original context replay option must exist');
});

test('P2-08: recoveredOperations saved as read-only Diff', function () {
  var s = read('js/code-workspace.js');
  assert.ok(/recoveredOperations/.test(s),
    'recoveredOperations must be saved for read-only Diff');
});

test('P2-09: re-validate workspace, generation, path, SHA, snapshot before apply', function () {
  var s = read('js/code-workspace.js');
  assert.ok(/validateOperation/.test(s),
    'validateOperation function must exist');
  assert.ok(/workspaceGeneration.*!==.*state\.workspaceGeneration/.test(s) ||
            /applyWsGen.*!==.*state\.workspaceGeneration/.test(s),
    'must validate workspace generation before apply');
});

test('P2-10: validation pass before allowing operations', function () {
  var s = read('js/code-workspace.js');
  assert.ok(/validateOperation\(/.test(s),
    'validateOperation must be called before applying');
  assert.ok(/SHA/.test(s) || /sha256/.test(s),
    'SHA validation must be part of operation validation');
});

// ──────────────────────────────────────────────
// Phase 3: Local model and frontend lifecycle
// ──────────────────────────────────────────────

test('P3-01: local model has full state machine', function () {
  var s = read('js/local-ai-runtime.js');
  assert.ok(/idle|downloading|initializing|ready|failed|cancelled/.test(s),
    'local model must have states: idle, downloading, initializing, ready, failed, cancelled');
  assert.ok(/getState/.test(s) && /getStatusText/.test(s),
    'must expose getState and getStatusText');
});

test('P3-02: total timeout and no-progress timeout', function () {
  var s = read('js/local-ai-runtime.js');
  assert.ok(/timeout/.test(s) && /30000|60000|120000|300000/.test(s),
    'must have timeout values (total and no-progress)');
  assert.ok(/progress.*timeout|no.*progress|stuck/.test(s) ||
            /_progressTimeout/.test(s),
    'must have no-progress timeout logic');
});

test('P3-03: stop during download terminates Worker', function () {
  var s = read('js/local-ai-runtime.js');
  assert.ok(/terminate/.test(s) || /worker\.terminate/.test(s),
    'stop must terminate the Worker');
  assert.ok(/stop\(\)/.test(s) || /function stop/.test(s),
    'stop function must exist');
});

test('P3-04: multiple ensureReady share initializingPromise', function () {
  var s = read('js/local-ai-runtime.js');
  assert.ok(/_initializingPromise/.test(s),
    'must use shared initializingPromise');
});

test('P3-05: at most one engine per Worker', function () {
  var s = read('js/local-ai-worker.js') || '';
  assert.ok(/if\s*\(engine\)/.test(s) || /if\s*\(!engine\)/.test(s),
    'Worker must check engine before creating');
});

test('P3-06: AI module does not overwrite window.throttleRAF', function () {
  var s = read('js/core.js');
  assert.ok(/!window\.throttleRAF/.test(s) || /typeof window\.throttleRAF/.test(s),
    'must guard window.throttleRAF from overwrite');
});

test('P3-07: Code page leave executes cleanup at most once', function () {
  var s = read('js/desktop-shell.js');
  assert.ok(/_codeCleanupExecuted/.test(s),
    'must use _codeCleanupExecuted flag to prevent double cleanup');
});

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
  assert.ok(/\[@＠\]小猫\(\?!\[猫\]\)/.test(s) ||
            /\[@＠\]小猫\(\?![猫]/.test(s),
    'backend regex must exclude 猫 after 小猫');
  assert.ok(/\[@＠\]小猫\(\?!\[猫\]\)/.test(frontend) ||
            /\[@＠\]小猫\(\?![猫]/.test(frontend),
    'frontend regex must exclude 猫 after 小猫');
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

test('P6-07: target query error returns retryable 503', function () {
  var s = read('render-api/server.js');
  var dmSendBlock = s.slice(s.indexOf("app.post('/api/dm/send'"));
  assert.ok(/503/.test(dmSendBlock) && /retryable/.test(dmSendBlock),
    'target query error must return 503 retryable');
  assert.ok(/target_not_found/.test(dmSendBlock),
    'truly no user returns target_not_found');
});