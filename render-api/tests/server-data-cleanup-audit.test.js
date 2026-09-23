'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { removeStorageWithQueue } = require('../storage-cleanup');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function cleanupQueueSupabase(insertResult) {
  const jobs = [];
  return {
    jobs,
    storage: {
      from() {
        return {
          async remove() {
            return { data: [{ name: 'chat/removed.jpg' }], error: null };
          }
        };
      }
    },
    from(table) {
      assert.equal(table, 'storage_cleanup_jobs');
      return {
        insert(payload) {
          jobs.push(payload);
          return {
            select() { return this; },
            async maybeSingle() { return insertResult; }
          };
        }
      };
    }
  };
}

test('partial Storage removal requeues only paths not returned as removed', async () => {
  const supabase = cleanupQueueSupabase({ data: { id: 'cleanup-1' }, error: null });
  const result = await removeStorageWithQueue(supabase, {
    bucket: 'uploads',
    paths: ['chat/removed.jpg', 'chat/remaining.jpg'],
    photoId: 'dm-message-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.removed, false);
  assert.equal(result.cleanup_pending, true);
  assert.deepEqual(result.paths, ['chat/remaining.jpg']);
  assert.deepEqual(supabase.jobs[0].paths, ['chat/remaining.jpg']);
});

test('partial Storage removal is not reported clean when durable requeue fails', async () => {
  const supabase = cleanupQueueSupabase({ data: null, error: { message: 'queue unavailable' } });
  const result = await removeStorageWithQueue(supabase, {
    bucket: 'uploads',
    paths: ['chat/removed.jpg', 'chat/remaining.jpg'],
    photoId: 'dm-message-2'
  });

  assert.equal(result.ok, false);
  assert.equal(result.cleanup_pending, false);
  assert.equal(result.queue_failed, true);
});

test('token revocation paths inspect Supabase errors before confirming success', () => {
  const revokeAll = serverSource.match(/async function revokeAllUserRefreshTokens\([\s\S]*?\n\}/);
  const persistRevoke = serverSource.match(/async function persistRevokedToken\([\s\S]*?\n\}/);
  assert.ok(revokeAll);
  assert.ok(persistRevoke);
  assert.match(revokeAll[0], /deletion && deletion\.error/);
  assert.match(revokeAll[0], /verification && verification\.error/);
  assert.match(revokeAll[0], /Refresh token rows remain after revoke/);
  assert.match(persistRevoke[0], /revokeInsert && revokeInsert\.error/);
});

test('photo cleanup reports pending if Storage cleanup or queue state is unconfirmed', () => {
  const photoRoute = serverSource.slice(serverSource.indexOf("app.post('/api/photo/delete'"), serverSource.indexOf("app.get('/api/photo/delete-status'"));
  const worker = serverSource.slice(serverSource.indexOf('async function processStorageCleanupJobs'), serverSource.indexOf("app.post('/api/photo/delete'"));
  assert.match(photoRoute, /removeStorageWithQueue\(supabase/);
  assert.match(photoRoute, /cleanup_pending: cleanupStatePending/);
  assert.match(photoRoute, /cleanupStateUpdate\.error \|\| !cleanupStateUpdate\.data/);
  assert.match(worker, /STORAGE_PARTIAL_DELETE/);
  assert.match(worker, /finalUpdate\.error \|\| !finalUpdate\.data/);
});

test('account removal follows both DM participants and preserves unknown retention records', () => {
  const accountRoute = serverSource.slice(serverSource.indexOf("app.delete('/admin/user/:userName'"), serverSource.indexOf('\nfunction firstNonEmptyValue()'));
  assert.match(accountRoute, /readDmPages\('user_name'\)/);
  assert.match(accountRoute, /readDmPages\('media_url'\)/);
  assert.match(accountRoute, /\.eq\('media_type', DM_MARKER\)\.eq\(column, userName\)/);
  assert.match(accountRoute, /\.eq\(column, userName\)/);
  assert.match(accountRoute, /deleteIdsInBatches\('posts', 'id', userPostIds\)/);
  assert.match(accountRoute, /deleteIdsInBatches\('posts', 'id', dmMessageIds, DM_MARKER\)/);
  assert.match(accountRoute, /\.eq\('media_type', marker\)/);
  assert.match(accountRoute, /dm_media_uploads/);
  assert.match(accountRoute, /ai_search_results/);
  assert.match(accountRoute, /ai_drafts/);
  assert.match(accountRoute, /ai_action_confirmations/);
  assert.match(accountRoute, /未知系统 marker[^\n]*[\s\S]*?retainedSystemPostCount/);
  assert.match(accountRoute, /retainedPolicyData/);
  assert.doesNotMatch(accountRoute, /\.from\('(?:bans|mutes|blacklist|ai_invite_redemptions|ai_user_membership|ai_user_quota_daily)'\)\.delete\(/);
  assert.match(accountRoute, /retained_system_posts/);
});

test('DM sends retain existing public URL response format pending deployed bucket policy evidence', () => {
  const dmSend = serverSource.slice(serverSource.indexOf("app.post('/api/dm/send'"), serverSource.indexOf("app.post('/api/dm/withdraw'"));
  assert.match(dmSend, /getPublicUrl\(pathResult\.storagePath\)/);
  assert.match(dmSend, /mediaPayload = \{ kind: mediaKind, url: publicUrl, mimeType: mimeType \}/);
  assert.doesNotMatch(dmSend, /createSignedUrl\(/);
});
