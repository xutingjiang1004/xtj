'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const {
  createChatSocialRouter,
  assertCanSendDirectMessage
} = require('../render-api/chat-social');

function buildApp(rpc) {
  const app = express();
  app.use(express.json());
  const calls = [];
  const supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return rpc(name, args);
    }
  };
  const authenticateUser = (req, res, next) => {
    if (req.headers.authorization !== 'Bearer valid-test-token') {
      return res.status(401).json({ ok: false, code: 'auth_expired' });
    }
    req.userName = 'trusted-actor';
    return next();
  };
  app.use('/api/chat', createChatSocialRouter({
    express,
    supabase,
    authenticateUser,
    rateLimit: () => (req, res, next) => next(),
    adminName: 'admin'
  }));
  return { app, calls, supabase };
}

const token = { Authorization: 'Bearer valid-test-token' };

test('friend APIs require the signed user middleware and do not call RPC anonymously', async () => {
  const fixture = buildApp(() => ({ data: [], error: null }));
  const response = await request(fixture.app).get('/api/chat/friends');
  assert.equal(response.status, 401);
  assert.equal(fixture.calls.length, 0);
});

test('user search rejects short input before database access', async () => {
  const fixture = buildApp(() => ({ data: [], error: null }));
  const response = await request(fixture.app).get('/api/chat/users/search?q=a').set(token);
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'invalid_query');
  assert.equal(fixture.calls.length, 0);
});

test('friend request actor identity comes from the verified token, not the request body', async () => {
  const fixture = buildApp(() => ({ data: { status: 'blocked' }, error: null }));
  const response = await request(fixture.app)
    .post('/api/chat/friend-requests')
    .set(token)
    .send({ requester_name: 'victim', target_user: 'peer' });
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'chat_blocked');
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].name, 'chat_request_friend');
  assert.equal(fixture.calls[0].args.p_requester_name, 'trusted-actor');
  assert.equal(fixture.calls[0].args.p_target_name, 'peer');
});

test('friend request route validates payload and enforces the database result', async () => {
  const fixture = buildApp((name) => ({
    data: name === 'chat_request_friend' ? { status: 'request_sent', request_id: 'id' } : null,
    error: null
  }));
  const tooLong = await request(fixture.app)
    .post('/api/chat/friend-requests').set(token)
    .send({ target_user: 'peer', note: 'x'.repeat(241) });
  assert.equal(tooLong.status, 400);
  assert.equal(fixture.calls.length, 0);

  const sent = await request(fixture.app)
    .post('/api/chat/friend-requests').set(token)
    .send({ target_user: 'peer', note: 'Hello' });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.result.status, 'request_sent');
  assert.equal(fixture.calls.length, 1);
});

test('request action rejects invalid IDs/actions before RPC and reports ownership denial', async () => {
  const fixture = buildApp(() => ({ data: { status: 'forbidden' }, error: null }));
  const invalidId = await request(fixture.app)
    .post('/api/chat/friend-requests/not-a-uuid/accept').set(token);
  assert.equal(invalidId.status, 400);
  const invalidAction = await request(fixture.app)
    .post('/api/chat/friend-requests/123e4567-e89b-42d3-a456-426614174000/approve').set(token);
  assert.equal(invalidAction.status, 400);
  assert.equal(fixture.calls.length, 0);

  const forbidden = await request(fixture.app)
    .post('/api/chat/friend-requests/123e4567-e89b-42d3-a456-426614174000/accept').set(token);
  assert.equal(forbidden.status, 403);
  assert.equal(fixture.calls[0].args.p_actor_name, 'trusted-actor');
});

test('message authorization fails closed for pending/non-friend states and blocks admin bypass when blocked', async () => {
  let relationship = { status: 'request_sent', can_message: false };
  const supabase = { rpc: async () => ({ data: relationship, error: null }) };
  assert.equal((await assertCanSendDirectMessage(supabase, 'alice', 'bob', 'admin')).code, 'friend_required');
  assert.equal((await assertCanSendDirectMessage(supabase, 'alice', 'admin', 'admin')).ok, true);
  relationship = { status: 'blocked_by_me', can_message: false };
  assert.equal((await assertCanSendDirectMessage(supabase, 'alice', 'admin', 'admin')).code, 'chat_blocked');
  relationship = { status: 'friends', can_message: true };
  assert.equal((await assertCanSendDirectMessage(supabase, 'alice', 'bob', 'admin')).ok, true);
  const unavailable = { rpc: async () => ({ data: null, error: { code: '08006' } }) };
  await assert.rejects(assertCanSendDirectMessage(unavailable, 'alice', 'bob', 'admin'));
});
