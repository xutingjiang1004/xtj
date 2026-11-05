'use strict';
// Express 5 leaves req.body undefined when a request carries no JSON body.
// The chat routers must answer 400 for it, not crash with a TypeError (500 + stack in the logs).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createChatPush } = require('../render-api/chat-push');
const { createChatFeatures } = require('../render-api/chat-features');

function app() {
  const server = express();
  server.use(express.json());
  const authenticateUser = (req, _res, next) => { req.userName = 'actor'; next(); };
  server.use('/push', createChatPush({ express, supabase: {}, authenticateUser, secret: 'empty-body-test' }).router);
  server.use('/chat', createChatFeatures({ express, supabase: {}, authenticateUser }).router);
  return server;
}

test('push subscribe and unsubscribe without a body are 400', async () => {
  const server = app();
  assert.equal((await request(server).post('/push/subscribe')).status, 400);
  assert.equal((await request(server).post('/push/unsubscribe')).status, 400);
  assert.equal((await request(server).post('/push/subscribe').set('Content-Type', 'text/plain').send('x')).status, 400);
});

test('chat feature writes without a body are 400, never a TypeError 500', async () => {
  const server = app();
  for (const path of ['/chat/messages/edit', '/chat/messages/reactions', '/chat/messages/transcript', '/chat/messages/transcribe']) {
    const response = await request(server).post(path);
    assert.equal(response.status, 400, path);
  }
});
