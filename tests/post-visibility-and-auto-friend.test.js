'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { chromium } = require('playwright');

const {
  parsePostVisibility,
  canUserViewPost,
  applyPostVisibilityToContent,
  stripPostVisibilityAudience
} = require('../render-api/post-visibility');
const { createAuthorPosts } = require('../render-api/author-posts');
const { createPhotoAccess } = require('../render-api/photo-access');
const { installPostViews } = require('../render-api/post-views');
const { readFeedEngagement } = require('../render-api/post-interactions');
const { createProfileRecords } = require('../render-api/profile-records');
const {
  createChatSocialRouter,
  assertCanSendDirectMessage,
  recordAutoFriendOnMessage
} = require('../render-api/chat-social');

const ROOT = path.resolve(__dirname, '..');

function makePost(id, userName, text, mode, users, extra = {}) {
  const applied = applyPostVisibilityToContent(text, mode, users || [], userName);
  return Object.assign({
    id,
    user_name: userName,
    content: applied.content,
    visibility: applied.dbVisibility,
    media_type: 'text',
    media_url: null,
    is_deleted: false,
    views: 0,
    created_at: '2026-11-28T08:00:00.000Z'
  }, extra);
}

// =========================================================================
// 1. 帖子权限核心逻辑 + 真实服务端隔离测试（公开 / 私密 / 仅谁可见 / 仅谁不可见）
// =========================================================================

test('post-visibility: enforces public, private, allow_list, deny_list, fail-closed and strips audience list for non-authors', () => {
  const pub = makePost('11111111-1111-4111-8111-111111111111', 'alice', 'https://music.163.com/#/song?id=1 分享一首歌', 'public');
  const priv = makePost('22222222-2222-4222-8222-222222222222', 'alice', '私密日记', 'private');
  const allow = makePost('33333333-3333-4333-8333-333333333333', 'alice', '仅 bob 可见的视频帖', 'allow_list', ['bob', 'alice', 'bob'], { media_type: 'video' });
  const deny = makePost('44444444-4444-4444-8444-444444444444', 'alice', '不给 carol 看的照片帖', 'deny_list', ['carol'], { media_type: 'image' });
  const corruptUnlisted = { id: '55555555-5555-4555-8555-555555555555', user_name: 'alice', content: 'plain text', visibility: 'unlisted', is_deleted: false };

  // public: everyone including guest
  for (const viewer of ['alice', 'bob', 'carol', 'xxz', '']) {
    assert.equal(canUserViewPost(pub, viewer), true, `public visible to ${viewer || 'guest'}`);
  }

  // private: ONLY author (not bob, not admin xxz, not guest)
  assert.equal(canUserViewPost(priv, 'alice'), true);
  for (const viewer of ['bob', 'carol', 'xxz', '']) {
    assert.equal(canUserViewPost(priv, viewer), false, `private MUST NOT be visible to ${viewer || 'guest'}`);
  }

  // allow_list: ONLY author + bob (carol, admin xxz, guest ALL denied)
  assert.equal(canUserViewPost(allow, 'alice'), true);
  assert.equal(canUserViewPost(allow, 'bob'), true);
  assert.deepEqual(parsePostVisibility(allow).users, ['bob'], 'author deduplicated and excluded from users');
  for (const viewer of ['carol', 'xxz', '']) {
    assert.equal(canUserViewPost(allow, viewer), false, `allow_list MUST NOT be visible to ${viewer || 'guest'}`);
  }

  // deny_list: author + bob + xxz allowed; carol AND guest DENIED (cannot bypass via logout!)
  assert.equal(canUserViewPost(deny, 'alice'), true);
  assert.equal(canUserViewPost(deny, 'bob'), true);
  assert.equal(canUserViewPost(deny, 'xxz'), true);
  assert.equal(canUserViewPost(deny, 'carol'), false, 'denied user MUST NOT see deny_list post');
  assert.equal(canUserViewPost(deny, ''), false, 'guest MUST NOT see deny_list post (prevents logout bypass)');

  // corrupt unlisted row fails closed
  assert.equal(canUserViewPost(corruptUnlisted, 'alice'), true);
  assert.equal(canUserViewPost(corruptUnlisted, 'bob'), false);
  assert.equal(canUserViewPost(corruptUnlisted, ''), false);

  // Audience list stripping: bob cannot see visibility_users; author alice still sees it
  const strippedForBob = stripPostVisibilityAudience(allow, 'bob');
  const parsedBob = JSON.parse(strippedForBob.content);
  assert.equal(parsedBob.meta.visibility_users, undefined, 'non-author must NOT receive visibility_users');
  assert.equal(parsedBob.meta.visibility_mode, 'restricted');
  const keptForAlice = stripPostVisibilityAudience(allow, 'alice');
  assert.deepEqual(JSON.parse(keptForAlice.content).meta.visibility_users, ['bob']);
});

test('author-posts router: really isolates private / allow_list / deny_list across author, allowed, denied, admin, guest', async () => {
  const posts = [
    makePost('11111111-1111-4111-8111-111111111111', 'alice', '公开帖', 'public', [], { created_at: '2026-11-28T08:04:00.000Z' }),
    makePost('22222222-2222-4222-8222-222222222222', 'alice', '私密帖', 'private', [], { created_at: '2026-11-28T08:03:00.000Z' }),
    makePost('33333333-3333-4333-8333-333333333333', 'alice', '仅bob可见', 'allow_list', ['bob'], { created_at: '2026-11-28T08:02:00.000Z' }),
    makePost('44444444-4444-4444-8444-444444444444', 'alice', '仅carol不可见', 'deny_list', ['carol'], { created_at: '2026-11-28T08:01:00.000Z' })
  ];
  const supabase = {
    from(table) {
      if (table === 'post_attachments') {
        const q = { select() { return q; }, in() { return q; }, order() { return q; }, then(res) { return Promise.resolve({ data: [], error: null }).then(res); } };
        return q;
      }
      let orFilter = '';
      const q = {
        select() { return q; }, eq() { return q; }, not() { return q; },
        or(expr) { orFilter = String(expr || ''); return q; },
        order() { return q; },
        limit() {
          const m = orFilter.match(/created_at\.lt\.([^,)]+)/);
          const beforeAt = m ? m[1] : '';
          const rows = beforeAt ? posts.filter(p => p.created_at < beforeAt) : posts.slice();
          return Promise.resolve({ data: rows, error: null });
        }
      };
      return q;
    }
  };
  const app = express();
  app.use('/api/author-posts', createAuthorPosts({
    express,
    supabase,
    optionalAuth(req, _res, next) {
      req.userName = req.headers['x-test-user'] || undefined;
      next();
    }
  }));

  const getIds = async (user) => {
    const req = request(app).get('/api/author-posts/alice');
    if (user) req.set('x-test-user', user);
    const res = await req;
    assert.equal(res.status, 200);
    return res.body.posts;
  };

  const alicePosts = await getIds('alice');
  assert.equal(alicePosts.length, 4);
  assert.deepEqual(JSON.parse(alicePosts[2].content).meta.visibility_users, ['bob']);

  const bobPosts = await getIds('bob');
  assert.deepEqual(bobPosts.map(p => p.id), [posts[0].id, posts[2].id, posts[3].id]);
  for (const p of bobPosts) {
    assert.equal(JSON.parse(p.content).meta.visibility_users, undefined, 'bob must never see audience list');
  }

  const carolPosts = await getIds('carol');
  assert.deepEqual(carolPosts.map(p => p.id), [posts[0].id], 'carol only sees public post');

  const adminPosts = await getIds('xxz');
  assert.deepEqual(adminPosts.map(p => p.id), [posts[0].id, posts[3].id], 'admin cannot see private or non-included allow_list');

  const guestPosts = await getIds('');
  assert.deepEqual(guestPosts.map(p => p.id), [posts[0].id], 'guest only sees public post');
});

test('post media endpoint + share page: enforces private, allow_list and deny_list on media downloads', async () => {
  const postId = '33333333-3333-4333-8333-333333333333';
  const ossUrl = 'https://xtj-media-2026.oss-cn-hangzhou.aliyuncs.com/posts/test_photo.jpg';
  const prevBucket = process.env.OSS_BUCKET;
  const prevEndpoint = process.env.OSS_ENDPOINT;
  process.env.OSS_BUCKET = 'xtj-media-2026';
  process.env.OSS_ENDPOINT = 'oss-cn-hangzhou.aliyuncs.com';

  try {
    let currentPost = makePost(postId, 'alice', '照片', 'private', [], { media_type: 'image', media_url: ossUrl });
    const supabase = {
      from(table) {
        if (table === 'post_attachments') {
          const q = { select() { return q; }, in() { return q; }, order() { return q; }, then(res) { return Promise.resolve({ data: [], error: null }).then(res); } };
          return q;
        }
        const q = {
          select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; },
          maybeSingle() { return Promise.resolve({ data: currentPost, error: null }); }
        };
        return q;
      }
    };
    const app = express();
    createPhotoAccess({
      app,
      supabase,
      supabaseUrl: 'https://test.supabase.co',
      secret: 'test-secret-0123456789abcdef',
      authenticateUser(req, res, next) { if (!req.headers['x-test-user']) return res.status(401).end(); req.userName = req.headers['x-test-user']; next(); },
      verifyToken(_req, res) { return res.status(401).end(); },
      optionalAuth(req, _res, next) { req.userName = req.headers['x-test-user'] || undefined; next(); },
      rateLimit: () => (_req, _res, next) => next(),
      adminName: 'xxz',
      normalPostAllowed: () => true
    });

    const hitMedia = (user) => {
      const r = request(app).get(`/api/post/${postId}/media/0`);
      if (user) r.set('Authorization', 'Bearer test-token').set('x-test-user', user);
      return r;
    };

    // private: only alice gets 302; bob, xxz, guest get 404; /share/posts/:id gets 404
    assert.equal((await hitMedia('alice')).status, 302);
    assert.equal((await hitMedia('bob')).status, 404);
    assert.equal((await hitMedia('xxz')).status, 404);
    assert.equal((await hitMedia('')).status, 404);
    assert.equal((await request(app).get(`/share/posts/${postId}`)).status, 404);

    // allow_list: ['bob'] -> alice & bob get 302; carol, xxz, guest get 404; share page 404
    currentPost = makePost(postId, 'alice', '照片', 'allow_list', ['bob'], { media_type: 'image', media_url: ossUrl });
    assert.equal((await hitMedia('alice')).status, 302);
    assert.equal((await hitMedia('bob')).status, 302);
    assert.equal((await hitMedia('carol')).status, 404);
    assert.equal((await hitMedia('xxz')).status, 404);
    assert.equal((await hitMedia('')).status, 404);
    assert.equal((await request(app).get(`/share/posts/${postId}`)).status, 404);

    // deny_list: ['carol'] -> alice & bob get 302; carol & guest get 404; share page 404
    currentPost = makePost(postId, 'alice', '照片', 'deny_list', ['carol'], { media_type: 'image', media_url: ossUrl });
    assert.equal((await hitMedia('alice')).status, 302);
    assert.equal((await hitMedia('bob')).status, 302);
    assert.equal((await hitMedia('carol')).status, 404);
    assert.equal((await hitMedia('')).status, 404);
    assert.equal((await request(app).get(`/share/posts/${postId}`)).status, 404);
  } finally {
    if (prevBucket === undefined) delete process.env.OSS_BUCKET; else process.env.OSS_BUCKET = prevBucket;
    if (prevEndpoint === undefined) delete process.env.OSS_ENDPOINT; else process.env.OSS_ENDPOINT = prevEndpoint;
  }
});

test('post-views & feed-engagement & profile-records: enforce audience isolation end-to-end', async () => {
  const postId = '66666666-6666-4666-8666-666666666666';
  const allowPost = makePost(postId, 'alice', '仅 bob 可见', 'allow_list', ['bob'], { views: 3 });
  const viewRows = [];
  const supabase = {
    async rpc(name) {
      if (name === 'record_post_view') return { data: { ok: true, views: allowPost.views + 1, counted: true }, error: null };
      if (name === 'xtj_feed_engagement') return { data: { posts: [], comments: [], likes: [] }, error: null };
      return { data: null, error: null };
    },
    from(table) {
      let filterMediaType = null;
      let filterActorKey = null;
      const q = {
        select() { return q; },
        eq(col, val) {
          if (col === 'media_type') filterMediaType = val;
          if (col === 'actor_key') filterActorKey = val;
          return q;
        },
        in() { return q; },
        order() { return q; },
        limit() { return q; },
        maybeSingle() {
          if (filterMediaType === '__post_view__') {
            const hit = viewRows.find(r => r.actor_key === filterActorKey);
            return Promise.resolve({ data: hit || null, error: null });
          }
          return Promise.resolve({ data: allowPost, error: null });
        },
        insert(row) {
          viewRows.push(row);
          return Promise.resolve({ data: row, error: null });
        },
        update(patch) {
          if (patch.views != null) allowPost.views = patch.views;
          return {
            eq() { return { select() { return { maybeSingle() { return Promise.resolve({ data: { views: allowPost.views }, error: null }); } }; } }; }
          };
        },
        then(res) {
          if (table === 'likes') return Promise.resolve({ data: [{ id: '1', post_id: postId, user_name: 'bob', created_at: '2026-11-28T08:05:00Z' }], error: null }).then(res);
          if (table === 'comments') return Promise.resolve({ data: [{ id: '2', post_id: postId, user_name: 'alice', content: 'hi bob', parent_comment_id: null, generated_by_ai: false, created_at: '2026-11-28T08:06:00Z' }], error: null }).then(res);
          return Promise.resolve({ data: [allowPost], count: 1, error: null }).then(res);
        }
      };
      return q;
    }
  };

  // post-views
  const app = express();
  app.use(express.json());
  installPostViews(app, {
    supabase,
    authenticateUser(req, _res, next) { req.userName = req.headers['x-test-user']; next(); },
    rateLimit: () => (_req, _res, next) => next(),
    normalizePostId: id => id
  });
  // carol (not in allow_list) -> 404
  assert.equal((await request(app).post('/api/post/view').set('x-test-user', 'carol').send({ post_id: postId })).status, 404);
  // admin xxz (not in allow_list) -> 404
  assert.equal((await request(app).post('/api/post/view').set('x-test-user', 'xxz').send({ post_id: postId })).status, 404);
  // bob (allowed!) -> 200 & counted, then deduped on second call
  const v1 = await request(app).post('/api/post/view').set('x-test-user', 'bob').send({ post_id: postId });
  assert.equal(v1.status, 200);
  assert.equal(v1.body.counted, true);
  assert.equal(v1.body.views, 4);
  const v2 = await request(app).post('/api/post/view').set('x-test-user', 'bob').send({ post_id: postId });
  assert.equal(v2.status, 200);
  assert.equal(v2.body.counted, false);

  // readFeedEngagement: bob gets engagement stats for authorized unlisted post
  const eng = await readFeedEngagement(supabase, [allowPost], 'bob');
  assert.equal(eng.posts.length, 1);
  assert.equal(eng.posts[0].like_count, 1);
  assert.equal(eng.posts[0].comment_count, 1);
  assert.equal(eng.posts[0].liked_by_me, true);
  assert.equal(eng.comments.length, 1);

  // profile-records: carol cannot see allow_list post content via historical like record
  const recApp = express();
  const recDb = {
    from(table) {
      const q = {
        select() { return q; }, eq() { return q; }, in() { return q; }, not() { return q; }, or() { return q; }, order() { return q; },
        limit() {
          if (table === 'likes') return Promise.resolve({ data: [{ id: '1', post_id: postId, created_at: '2026-11-28T08:05:00Z' }], count: 1, error: null });
          return Promise.resolve({ data: [allowPost], count: 1, error: null });
        },
        then(res) { return Promise.resolve({ data: [allowPost], count: 1, error: null }).then(res); }
      };
      return q;
    }
  };
  recApp.use('/records', createProfileRecords({
    express,
    supabase: recDb,
    authenticateUser(req, _res, next) { req.userName = req.headers['x-test-user']; next(); }
  }));
  const carolRec = await request(recApp).get('/records?kind=likes').set('x-test-user', 'carol');
  assert.equal(carolRec.status, 200);
  assert.equal(carolRec.body.items[0].available, false);
  assert.equal(carolRec.body.items[0].post_id, null);
  const bobRec = await request(recApp).get('/records?kind=likes').set('x-test-user', 'bob');
  assert.equal(bobRec.body.items[0].available, true);
  assert.equal(bobRec.body.items[0].post_id, postId);
});

// =========================================================================
// 2. 聊天发消息自动单向 -> 双向好友（状态机 + 路由全链路测试）
// =========================================================================

function createStatefulChatDb(users) {
  const validUsers = new Set(users);
  const friendships = new Set(); // key: low\0high
  const pending = new Map();     // key: requester\0target -> { request_id, requester_name, target_name, created_at }
  const blocks = new Set();      // key: blocker\0blocked
  let seq = 1;
  const pairKey = (a, b) => (a < b ? a + '\0' + b : b + '\0' + a);
  const uuidOf = (n) => '123e4567-e89b-42d3-a456-' + String(n).padStart(12, '0');

  return {
    block(a, b) {
      blocks.add(a + '\0' + b);
      friendships.delete(pairKey(a, b));
      pending.delete(a + '\0' + b);
      pending.delete(b + '\0' + a);
    },
    async rpc(name, args) {
      if (name === 'chat_get_relationship') {
        const a = args.p_user_name, b = args.p_peer_name;
        if (!validUsers.has(a)) return { data: { status: 'account_unavailable', can_message: false }, error: null };
        if (!validUsers.has(b)) return { data: { status: 'user_not_found', can_message: false }, error: null };
        if (a === b) return { data: { status: 'self', can_message: false }, error: null };
        if (blocks.has(a + '\0' + b)) return { data: { status: 'blocked_by_me', can_message: false }, error: null };
        if (blocks.has(b + '\0' + a)) return { data: { status: 'blocked_by_peer', can_message: false }, error: null };
        if (friendships.has(pairKey(a, b))) return { data: { status: 'friends', can_message: true }, error: null };
        if (pending.has(a + '\0' + b)) return { data: { status: 'request_sent', can_message: false, outgoing_request_id: pending.get(a + '\0' + b).request_id }, error: null };
        if (pending.has(b + '\0' + a)) return { data: { status: 'request_received', can_message: false, incoming_request_id: pending.get(b + '\0' + a).request_id }, error: null };
        return { data: { status: 'none', can_message: false }, error: null };
      }
      if (name === 'chat_request_friend') {
        const a = args.p_requester_name, b = args.p_target_name;
        if (!validUsers.has(a)) return { data: { status: 'account_unavailable' }, error: null };
        if (!validUsers.has(b)) return { data: { status: 'user_not_found' }, error: null };
        if (a === b) return { data: { status: 'self' }, error: null };
        if (blocks.has(a + '\0' + b) || blocks.has(b + '\0' + a)) return { data: { status: 'blocked' }, error: null };
        if (friendships.has(pairKey(a, b))) return { data: { status: 'already_friends' }, error: null };
        if (pending.has(b + '\0' + a)) {
          const rev = pending.get(b + '\0' + a);
          pending.delete(b + '\0' + a);
          friendships.add(pairKey(a, b));
          return { data: { status: 'accepted', request_id: rev.request_id }, error: null };
        }
        if (pending.has(a + '\0' + b)) {
          return { data: { status: 'request_pending', request_id: pending.get(a + '\0' + b).request_id }, error: null };
        }
        const row = { request_id: uuidOf(seq++), requester_name: a, target_name: b, created_at: '2026-11-28T09:00:00Z' };
        pending.set(a + '\0' + b, row);
        return { data: { status: 'request_sent', request_id: row.request_id }, error: null };
      }
      if (name === 'chat_list_friends') {
        const me = args.p_user_name;
        const rows = [];
        for (const k of friendships) {
          const [u1, u2] = k.split('\0');
          if (u1 === me) rows.push({ peer_name: u2, friend_since: '2026-11-28T09:05:00Z', note: null });
          else if (u2 === me) rows.push({ peer_name: u1, friend_since: '2026-11-28T09:05:00Z', note: null });
        }
        return { data: rows, error: null };
      }
      if (name === 'chat_list_requests') {
        const me = args.p_user_name, dir = args.p_direction;
        const rows = [];
        for (const row of pending.values()) {
          if (dir === 'outgoing' && row.requester_name === me) rows.push(row);
          if (dir === 'incoming' && row.target_name === me) rows.push(row);
        }
        return { data: rows, error: null };
      }
      if (name === 'chat_finish_friend_request') {
        const me = args.p_actor_name, reqId = args.p_request_id, act = args.p_action;
        for (const [k, row] of pending.entries()) {
          if (row.request_id === reqId && act === 'cancel' && row.requester_name === me) {
            pending.delete(k);
            return { data: { status: 'canceled', request_id: reqId }, error: null };
          }
        }
        return { data: { status: 'request_not_found' }, error: null };
      }
      if (name === 'chat_remove_friend') {
        const a = args.p_actor_name, b = args.p_peer_name;
        const existed = friendships.delete(pairKey(a, b));
        return { data: { status: existed ? 'removed' : 'not_friends' }, error: null };
      }
      return { data: null, error: null };
    }
  };
}

test('chat auto-friend: new user messages peer -> one-way friend; peer replies -> mutual friends; blocks still deny', async () => {
  const db = createStatefulChatDb(['new_user', 'bob', 'carol', 'dave']);
  const events = [];
  const publishEvent = (user, event, payload) => events.push({ user, event, payload });
  const app = express();
  app.use(express.json());
  app.use('/api/chat', createChatSocialRouter({
    express,
    supabase: db,
    authenticateUser(req, res, next) {
      const u = req.headers['x-test-user'];
      if (!u) return res.status(401).json({ ok: false });
      req.userName = u;
      next();
    },
    rateLimit: () => (_req, _res, next) => next(),
    adminName: 'xxz',
    publishEvent
  }));

  // Step 1: new_user has no friends yet, but can immediately message bob
  const rel0 = await request(app).get('/api/chat/relationship?target=bob').set('x-test-user', 'new_user');
  assert.equal(rel0.status, 200);
  assert.equal(rel0.body.relationship.can_message, true);
  assert.equal(rel0.body.relationship.is_contact, false);
  assert.equal(rel0.body.relationship.is_mutual_friend, false);

  const perm1 = await assertCanSendDirectMessage(db, 'new_user', 'bob', 'xxz');
  assert.equal(perm1.ok, true);

  // Step 2: new_user sends DM to bob -> auto one-way friend on new_user's side ONLY
  const auto1 = await recordAutoFriendOnMessage(db, 'new_user', 'bob', publishEvent);
  assert.equal(auto1.status, 'request_sent');
  assert.equal(auto1.one_way, true);
  assert.equal(auto1.mutual, false);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { user: 'new_user', event: 'chat-state', payload: { kind: 'contact_added', peer: 'bob' } });

  const newUserFriends1 = await request(app).get('/api/chat/friends').set('x-test-user', 'new_user');
  assert.equal(newUserFriends1.status, 200);
  assert.equal(newUserFriends1.body.friends.length, 1);
  assert.equal(newUserFriends1.body.friends[0].peer_name, 'bob');
  assert.equal(newUserFriends1.body.friends[0].mutual, false);
  assert.equal(newUserFriends1.body.friends[0].relation_status, 'one_way');

  // bob does NOT have new_user in bob's friends list yet!
  const bobFriends1 = await request(app).get('/api/chat/friends').set('x-test-user', 'bob');
  assert.equal(bobFriends1.status, 200);
  assert.deepEqual(bobFriends1.body.friends, []);

  // Step 3: bob replies to new_user -> BOTH automatically become mutual friends!
  const perm2 = await assertCanSendDirectMessage(db, 'bob', 'new_user', 'xxz');
  assert.equal(perm2.ok, true);
  const auto2 = await recordAutoFriendOnMessage(db, 'bob', 'new_user', publishEvent);
  assert.equal(auto2.status, 'accepted');
  assert.equal(auto2.mutual, true);
  assert.equal(auto2.one_way, false);

  const newUserFriends2 = await request(app).get('/api/chat/friends').set('x-test-user', 'new_user');
  assert.equal(newUserFriends2.body.friends.length, 1);
  assert.equal(newUserFriends2.body.friends[0].peer_name, 'bob');
  assert.equal(newUserFriends2.body.friends[0].mutual, true);
  assert.equal(newUserFriends2.body.friends[0].relation_status, 'friends');

  const bobFriends2 = await request(app).get('/api/chat/friends').set('x-test-user', 'bob');
  assert.equal(bobFriends2.body.friends.length, 1);
  assert.equal(bobFriends2.body.friends[0].peer_name, 'new_user');
  assert.equal(bobFriends2.body.friends[0].mutual, true);
  assert.equal(bobFriends2.body.friends[0].relation_status, 'friends');

  // Step 4: deleting a one-way contact works cleanly without 404
  await recordAutoFriendOnMessage(db, 'new_user', 'dave', publishEvent);
  const delOneWay = await request(app).delete('/api/chat/friends/dave').set('x-test-user', 'new_user');
  assert.equal(delOneWay.status, 200);
  assert.equal(delOneWay.body.result.one_way, true);
  const afterDel = await request(app).get('/api/chat/friends').set('x-test-user', 'new_user');
  assert.deepEqual(afterDel.body.friends.map(f => f.peer_name), ['bob']);

  // Step 5: blocked users STILL cannot message
  db.block('carol', 'new_user');
  const blockedPerm = await assertCanSendDirectMessage(db, 'new_user', 'carol', 'xxz');
  assert.equal(blockedPerm.ok, false);
  assert.equal(blockedPerm.code, 'chat_blocked');
  const blockedRel = await request(app).get('/api/chat/relationship?target=carol').set('x-test-user', 'new_user');
  assert.equal(blockedRel.body.relationship.can_message, false);
});

// =========================================================================
// 3. 真实浏览器（Playwright Chromium）验证：帖子「•••」菜单「权限」入口与弹窗交互
// =========================================================================

test('browser UI: post three-dots menu shows 权限 only for author across all post types and saves allow_list via /api/post/visibility', async (t) => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--no-sandbox']
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });

  const bootstrapSrc = fs.readFileSync(path.join(ROOT, 'js/core-parts/01-bootstrap.js'), 'utf8');
  const postsSrc = fs.readFileSync(path.join(ROOT, 'js/core-parts/04-posts-interactions.js'), 'utf8');

  const normSlice = bootstrapSrc.slice(
    bootstrapSrc.indexOf('        function parsePostContent(post)'),
    bootstrapSrc.indexOf('        function canEditPost(post)')
  );
  const toolsSlice = postsSrc.slice(
    postsSrc.indexOf('            var activePostToolsMenu = null;'),
    postsSrc.indexOf('            var activePostAiSession = null;')
  );
  const modalSlice = postsSrc.slice(
    postsSrc.indexOf('            // ============== 帖子权限设置弹窗'),
    postsSrc.indexOf('            // ============== Global click delegation')
  );

  await page.setContent(`
    <div id="feed">
      <div class="post" data-post-id="p-music"><button class="post-tools-trigger" data-post-id="p-music">•••</button></div>
      <div class="post" data-post-id="p-other"><button class="post-tools-trigger" data-post-id="p-other">•••</button></div>
    </div>
  `);
  await page.addStyleTag({ path: path.join(ROOT, 'css/style.css') });
  await page.evaluate(() => {
    window.currentUser = 'alice';
    window._authStateEpoch = 1;
    window.POST_METADATA_MARKER = '__xtj_post_v2__';
    window.POST_META_DEFAULTS = { visibility: 'public' };
    window.escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.toasts = [];
    window.showToast = msg => window.toasts.push(msg);
    window.patchedCards = [];
    window.patchSinglePostCard = id => window.patchedCards.push(id);
    window.refreshPostDetailIfActive = () => {};
    window.markFeedStateChanged = () => {};
    window.writeFeedCacheSnapshot = () => {};
    window.clearEarlyFeedCacheV1 = () => {};
    window.capturePostActionIdentity = () => ({ owner: window.currentUser, epoch: window._authStateEpoch });
    window.assertPostActionIdentity = () => {};
    window.feedAllPosts = [
      { id: 'p-music', user_name: 'alice', content: 'https://music.163.com/#/song?id=123', media_type: 'text', visibility: 'public' },
      { id: 'p-other', user_name: 'bob', content: 'bob post', media_type: 'image', visibility: 'public' }
    ];
    window.getPostShareSource = id => window.feedAllPosts.find(p => String(p.id) === String(id)) || null;
    window.savedRequests = [];
    window.xtjProtectedFetch = async (url, opts) => {
      if (url.startsWith('/api/users/directory')) {
        return { ok: true, json: async () => ({ ok: true, users: [{ user_name: 'bob' }, { user_name: 'carol' }] }) };
      }
      if (url === '/api/post/visibility') {
        const body = JSON.parse(opts.body);
        window.savedRequests.push(body);
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: {
              id: body.post_id,
              user_name: 'alice',
              visibility: body.mode === 'public' ? 'public' : (body.mode === 'private' ? 'private' : 'unlisted'),
              content: JSON.stringify({
                __type: '__xtj_post_v2__',
                text: 'https://music.163.com/#/song?id=123',
                meta: { visibility: 'unlisted', visibility_mode: body.mode, visibility_users: body.users }
              })
            }
          })
        };
      }
      return { ok: false, json: async () => ({ ok: false }) };
    };
  });
  await page.addScriptTag({ content: normSlice + '\n' + toolsSlice + '\n' + modalSlice + '\nwindow.__openTools = openPostToolsMenu;' });

  // 1. Author's post menu MUST include 「权限」
  await page.evaluate(() => window.__openTools(document.querySelector('[data-post-id="p-music"].post-tools-trigger')));
  const ownItems = await page.locator('.post-tools-menu:not(.is-closing) [data-post-tool]').evaluateAll(els => els.map(e => ({ tool: e.dataset.postTool, text: e.textContent.trim() })));
  assert.ok(ownItems.some(x => x.tool === 'visibility' && x.text === '权限'), 'author menu must contain 权限 button');

  // 2. Non-author's post menu MUST NOT include 「权限」
  await page.evaluate(() => window.__openTools(document.querySelector('[data-post-id="p-other"].post-tools-trigger')));
  const otherItems = await page.locator('.post-tools-menu:not(.is-closing) [data-post-tool]').evaluateAll(els => els.map(e => e.dataset.postTool));
  assert.equal(otherItems.includes('visibility'), false, 'non-author menu must NOT contain 权限 button');

  // 3. Open modal -> pick 仅谁可见 -> select bob -> save -> verify payload and client state
  await page.evaluate(() => window.openPostVisibilityModal('p-music'));
  await page.locator('#postVisibilityModal input[value="allow_list"]').check();
  await page.locator('#postVisibilityModal [data-pick-user="bob"]').waitFor();
  await page.locator('#postVisibilityModal [data-pick-user="bob"]').click();
  await page.locator('#postVisibilityModal .post-vis-save').click();
  await page.waitForFunction(() => !document.getElementById('postVisibilityModal'));

  const result = await page.evaluate(() => ({
    saved: window.savedRequests,
    post: window.feedAllPosts.find(p => p.id === 'p-music'),
    patched: window.patchedCards,
    toasts: window.toasts
  }));
  assert.deepEqual(result.saved, [{ post_id: 'p-music', mode: 'allow_list', users: ['bob'] }]);
  assert.equal(result.post.visibility, 'unlisted');
  assert.equal(result.post.visibility_mode, 'allow_list');
  assert.deepEqual(result.post.visibility_users, ['bob']);
  assert.deepEqual(result.patched, ['p-music']);
  assert.ok(result.toasts.some(m => m.includes('仅 1 人可见')));
});
