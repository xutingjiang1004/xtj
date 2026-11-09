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
    async rpc(name, payload) {
      assert.equal(name, 'enqueue_storage_cleanup');
      jobs.push({ paths: payload.p_paths, photo_id: payload.p_photo_id });
      return insertResult.error ? insertResult : { data: { ok: true, queued: true, jobId: 'cleanup-1', paths: payload.p_paths } };
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

test('account removal (注销) clears the account itself, keeps every post, photo and DM, and preserves retention records', () => {
  // 2026-11-08 用户要求：删除账号 = 注销账号，发布过的内容和聊天消息一律保留（行为见 tests/profile-admin-delete-counts.test.js）。
  const accountRoute = serverSource.slice(serverSource.indexOf("app.delete('/admin/user/:userName'"), serverSource.indexOf('\nfunction firstNonEmptyValue()'));
  // 不再读取、删除私信，也不删除帖子、评论、点赞、私信媒体登记，不入队帖子/聊天/照片的存储清理
  assert.doesNotMatch(accountRoute, /readDmPages|deleteIdsInBatches|dmMessageIds|retireAccountPostMediaUploads\(/);
  assert.doesNotMatch(accountRoute, /from\('(?:likes|comments|dm_media_uploads)'\)\.delete/);
  assert.doesNotMatch(accountRoute, /\.in\('media_type', \[?'(?:text|image|video)/);
  // 清理的是账号本身和私有数据
  assert.match(accountRoute, /AUTH_DELETED_MARKER/);
  assert.match(accountRoute, /ai_search_results/);
  assert.match(accountRoute, /ai_drafts/);
  assert.match(accountRoute, /ai_action_confirmations/);
  assert.match(accountRoute, /retainedPolicyData/);
  assert.match(accountRoute, /content_retained/);
  // 封禁/禁言/拉黑、邀请、会员、额度记录不在注销范围内
  assert.doesNotMatch(accountRoute, /\.from\('(?:bans|mutes|blacklist|ai_invite_redemptions|ai_user_membership|ai_user_quota_daily)'\)\.delete\(/);
  // 存储清理只涉及头像文件
  const cleanups = accountRoute.match(/removeStorageWithQueue\(/g) || [];
  assert.equal(cleanups.length, 1, 'the only storage cleanup is the avatar file');
  assert.match(accountRoute, /photoId: 'account_avatar_'/);
});

test('DM sends retain existing public URL response format pending deployed bucket policy evidence', () => {
  const dmSend = serverSource.slice(serverSource.indexOf("app.post('/api/dm/send'"), serverSource.indexOf("app.post('/api/dm/withdraw'"));
  assert.match(dmSend, /getPublicUrl\(pathResult\.storagePath\)/);
  assert.match(dmSend, /mediaPayload = \{ kind: mediaKind, url: publicUrl, mimeType: mimeType \}/);
  assert.doesNotMatch(dmSend, /createSignedUrl\(/);
});
