'use strict';
// A withdrawn message is invisible to every read path, so it must not stay in the unread count.
const test = require('node:test');
const assert = require('node:assert/strict');
const { withBackendDatabase } = require('./helpers/backend-database-fixture');

test('conversation unread count ignores withdrawn messages', { skip: !process.env.XTJ_TEST_DATABASE_URL, timeout: 300000 }, async () => {
  await withBackendDatabase(async ({ db }) => {
    for (const name of ['alice', 'bob']) {
      await db.query("INSERT INTO posts(user_name,media_type,content,actor_key) VALUES($1,'__auth__','{}',$2)", [name, '__auth__' + name]);
    }
    const request = (await db.query("SELECT public.chat_request_friend('alice','bob',null) r")).rows[0].r;
    await db.query("SELECT public.chat_finish_friend_request('bob',$1::uuid,'accept')", [request.request_id]);
    const send = async (key, text) => (await db.query("INSERT INTO posts(user_name,media_type,media_url,content,actor_key) VALUES('alice','__dm__','bob',$1,$2) RETURNING id",
      [JSON.stringify({ text, read_at: null }), key])).rows[0].id;
    const unread = async () => (await db.query("SELECT public.chat_list_conversations('bob') r")).rows[0].r.find(c => c.peer_name === 'alice').unread_count;
    const first = await send('dm_w1', 'one');
    await send('dm_w2', 'two');
    assert.equal(await unread(), 2);
    await db.query('UPDATE posts SET content=$2 WHERE id=$1', [first, JSON.stringify({ text: '[消息已撤回]', withdrawn: true, read_at: null })]);
    assert.equal(await unread(), 1, 'the withdrawn message cannot be read, so it must not count');
  });
});
