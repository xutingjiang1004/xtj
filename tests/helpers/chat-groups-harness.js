'use strict';
// Runs the real group-chat router (render-api/chat-groups.js) against a
// disposable PostgreSQL database with every migration applied, and wires it
// behind the real index.html in Chromium. supabase.rpc() is translated into a
// named-argument SQL call, so permission rules execute exactly as in production.
const http = require('node:http');
const express = require('express');
const sharp = require('sharp');
const { createChatGroupsRouter } = require('../../render-api/chat-groups');

function pgSupabase(db, store) {
  return {
    async rpc(name, args) {
      if (!/^chat_[a-z_]+$/.test(name)) throw new Error('unexpected rpc ' + name);
      const keys = Object.keys(args || {});
      const values = keys.map(k => {
        const v = args[k];
        return v && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v;
      });
      const sql = name === 'chat_list_friends'
        ? 'SELECT COALESCE(jsonb_agg(to_jsonb(f)), \'[]\'::jsonb) AS r FROM public.chat_list_friends($1) f'
        : `SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS r`;
      try { return { data: (await db.query(sql, values)).rows[0].r, error: null }; }
      catch (error) { return { data: null, error }; }
    },
    from(table) {
      return { insert: async rows => { store.inserts.push({ table, rows }); return { error: null }; } };
    },
    storage: {
      from(bucket) {
        return {
          async upload(path, buffer, options) { store.objects.set(path, { bucket, buffer, type: options.contentType }); return { data: { path }, error: null }; }
        };
      }
    }
  };
}

async function startGroupApi(db, { mediaOrigin }) {
  const store = { inserts: [], objects: new Map(), removed: [], events: [] };
  const supabase = pgSupabase(db, store);
  const app = express();
  app.use(express.json());
  const authenticateUser = (req, res, next) => { req.userName = req.get('x-test-user') || 'alice'; req.userRestrictions = {}; next(); };
  const rateLimit = () => (req, res, next) => next();
  app.get('/api/chat/friends', authenticateUser, async (req, res) => {
    const r = await supabase.rpc('chat_list_friends', { p_user_name: req.userName });
    res.json({ ok: true, friends: r.data || [] });
  });
  app.use('/api/groups', createChatGroupsRouter({
    express, supabase, authenticateUser, rateLimit, sharp,
    publishMany: (users, event, payload) => store.events.push({ users, event, payload }),
    signPrivate: async path => mediaOrigin + '/test-group-media/' + path + '?sig=test',
    removePrivate: async paths => { store.removed.push(...paths); paths.forEach(p => store.objects.delete(p)); },
    sendBlocked: () => null
  }));
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  return { base, store, supabase, close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }) };
}

// Forward the page's /api/groups and /api/chat/friends calls to the local API.
async function wirePage(page, api, user = 'alice') {
  await page.route(/\/api\/(groups(\/|\?|$)|chat\/friends)/, async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = { 'x-test-user': user };
    const type = request.headers()['content-type']; if (type) headers['content-type'] = type;
    const response = await fetch(api.base + url.pathname + url.search, { method: request.method(), headers, body: ['GET', 'HEAD'].includes(request.method()) ? undefined : request.postDataBuffer() });
    await route.fulfill({ status: response.status, headers: { 'content-type': 'application/json' }, body: Buffer.from(await response.arrayBuffer()) });
  });
  await page.route('**/test-group-media/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/test-group-media\//, '');
    const object = api.store.objects.get(decodeURIComponent(path));
    if (!object) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, headers: { 'content-type': object.type }, body: object.buffer });
  });
}

async function seedUsers(db, names) {
  await db.query("INSERT INTO posts(user_name,media_type,content) SELECT unnest($1::text[]),'__auth__','{}'", [names]);
}
async function befriend(db, a, others) {
  await db.query(`INSERT INTO chat_friendships(user_low_id,user_high_id)
    SELECT LEAST(x.id,y.id),GREATEST(x.id,y.id) FROM chat_users x JOIN chat_users y ON y.user_name = ANY($2::text[])
    WHERE x.user_name=$1 ON CONFLICT DO NOTHING`, [a, others]);
}
async function rpc(db, name, args) {
  const keys = Object.keys(args);
  const values = keys.map(k => args[k] && typeof args[k] === 'object' && !Array.isArray(args[k]) ? JSON.stringify(args[k]) : args[k]);
  return (await db.query(`SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS r`, values)).rows[0].r;
}

module.exports = { startGroupApi, wirePage, seedUsers, befriend, rpc };
