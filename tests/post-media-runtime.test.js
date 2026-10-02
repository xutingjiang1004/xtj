'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), express = require('express'), request = require('supertest');
const { installPostMedia, createPostWithMedia, parsePostMediaUrl, isLocalUploadUrl } = require('../render-api/post-media');
function fixture() {
  const registry = new Map(), files = new Set(), posts = [], calls = [], removals = [];
  let failCleanup = false, failRpc = false;
  const supabase = {
    from(name) { assert.equal(name, 'post_media_uploads'); let path, change; const q = { update(v) { change=v; return q; }, then(a,b) { if(change&&registry.has(path)) Object.assign(registry.get(path),change); return Promise.resolve({data:[]}).then(a,b); }, select() { return q; }, eq(k, v) { if(k==='storage_path')path=v; return q; }, maybeSingle: async () => ({ data: registry.get(path) || null }), async insert(row) { if (registry.has(row.storage_path)) return { error: { code: '23505' } }; registry.set(row.storage_path, { ...row, status: 'pending' }); return { data: null }; } }; return q; },
    storage: { from() { return { exists: async path => ({ data: files.has(path) }), async remove(paths) { removals.push(paths); if (failCleanup) return { error: Error('offline') }; paths.forEach(p => files.delete(p)); return { data: paths.map(name => ({ name })) }; } }; } },
    async rpc(name, args) {
      calls.push([name, args]); if (failRpc) return { error: Error('RPC unavailable') };
      if (name === 'enqueue_storage_cleanup') return { data: { ok: true, queued: true, paths: args.p_paths, jobId: 'queue' } };
      const row = registry.get(args.p_path), owner = row && row.user_name === args.p_actor && row.upload_id === args.p_upload_id;
      if (!owner) return { data: { ok: false, code: 'media_ownership' } };
      if (name === 'claim_post_media_cleanup') {
        const referenced = posts.some(p => decodeURIComponent(new URL(p.media_url).pathname).endsWith('/' + args.p_path)); if (!referenced) row.status = 'cleanup';
        return { data: { ok: true, referenced } };
      }
      if (name === 'create_post_with_media') {
        if (row.status === 'cleanup') return { data: { ok: false, code: 'media_cleanup' } };
        const existing = posts.find(p => p.id === row.attached_post_id);
        if (existing) return { data: { ok: true, post: existing, duplicate: true } };
        row.status = 'attached'; const post = { ...args.p_payload, id: 'post-id-' + posts.length }; row.attached_post_id = post.id; posts.push(post); return { data: { ok: true, post } };
      }
      throw Error('Unexpected RPC');
    }
  };
  const app = express(); app.use(express.json());
  installPostMedia(app, { supabase, authenticateUser(req, res, next) { req.userName = req.get('authorization'); if (!req.userName) return res.sendStatus(401); next(); }, rateLimit: () => (_, __, next) => next(), userBanError: () => null });
  return { app, supabase, registry, files, posts, calls, removals, setFailCleanup(v) { failCleanup = v; }, setFailRpc(v) { failRpc = v; } };
}
const path = 'posts/用户_12345_photo.jpg', upload = '123e4567-e89b-42d3-a456-000000000001', origin = 'https://project.supabase.co';
const mediaUrl = origin + '/storage/v1/object/public/uploads/' + path.split('/').map(encodeURIComponent).join('/');
const body = { storage_path: path, upload_id: upload };
const post = { user_name: 'A', actor_key: 'web_key', content: '', media_url: mediaUrl, media_type: 'image', visibility: 'public' };

test('prepare authenticates and binds the exact path and upload id; guessed old objects are denied', async () => {
  const f = fixture(); await request(f.app).post('/api/post/media/prepare').send(body).expect(401);
  f.files.add(path); await request(f.app).post('/api/post/media/prepare').set('authorization', 'A').send(body).expect(409); f.files.clear();
  const prepared = await request(f.app).post('/api/post/media/prepare').set('authorization', 'A').send(body).expect(200);
  assert.equal(prepared.body.storage_path, path);
  await request(f.app).post('/api/post/media/prepare').set('authorization', 'B').send(body).expect(403);
  await request(f.app).post('/api/post/media/cleanup').set('authorization', 'B').send(body).expect(403); assert.equal(f.removals.length, 0);
});

test('lost create response reconciliation preserves referenced media; cleanup tombstone prevents later attach', async () => {
  const f = fixture(); await request(f.app).post('/api/post/media/prepare').set('authorization', 'A').send(body).expect(200); f.files.add(path);
  const saved = await createPostWithMedia(f.supabase, 'A', path, upload, post); assert.equal(saved.data.id, 'post-id-0');
  const retry = await createPostWithMedia(f.supabase, 'A', path, upload, post); assert.equal(retry.data.id, saved.data.id); assert.equal(f.posts.length, 1);
  const result = await request(f.app).post('/api/post/media/cleanup').set('authorization', 'A').send(body).expect(200);
  assert.equal(result.body.referenced, true); assert.equal(f.removals.length, 0);
  f.posts.length = 0; await request(f.app).post('/api/post/media/cleanup').set('authorization', 'A').send(body).expect(200);
  assert.equal(f.files.has(path), false); assert.equal((await createPostWithMedia(f.supabase, 'A', path, upload, post)).error.code, 'media_cleanup');
});

test('cleanup failures use the durable queue and RPC outages never delete', async () => {
  const f = fixture(); await request(f.app).post('/api/post/media/prepare').set('authorization', 'A').send(body).expect(200); f.files.add(path);
  f.setFailRpc(true); await request(f.app).post('/api/post/media/cleanup').set('authorization', 'A').send(body).expect(503); assert.equal(f.removals.length, 0);
  f.setFailRpc(false); f.setFailCleanup(true);
  const result = await request(f.app).post('/api/post/media/cleanup').set('authorization', 'A').send(body).expect(200);
  assert.equal(result.body.cleanup_pending, true); assert.equal(f.calls.at(-1)[0], 'enqueue_storage_cleanup');
});

test('local upload URLs cannot evade ownership using alternate query, credentials or another directory', () => {
  assert.equal(parsePostMediaUrl(mediaUrl, origin), path);
  assert.equal(isLocalUploadUrl(mediaUrl + '?x=1', origin), true); assert.equal(parsePostMediaUrl(mediaUrl + '?x=1', origin), null);
  for (const value of [origin + '/storage/v1/object/public/uploads/photos/a.jpg', 'https://user:pass@project.supabase.co/storage/v1/object/public/uploads/posts/a.jpg', origin + '/storage/v1/object/public/uploads/posts/a%252Ejpg']) assert.equal(parsePostMediaUrl(value, origin), null);
});

test('separate uploads from the same device actor_key publish separate posts', async () => {
  const f = fixture();
  for (let n = 0; n < 2; n++) {
    const storagePath = 'posts/photo-' + n + '.jpg', uploadId = upload.slice(0, -1) + n;
    await request(f.app).post('/api/post/media/prepare').set('authorization', 'A').send({ storage_path: storagePath, upload_id: uploadId }).expect(200);
    const created = await createPostWithMedia(f.supabase, 'A', storagePath, uploadId, { ...post, actor_key: 'same-device', media_url: origin + '/storage/v1/object/public/uploads/' + storagePath });
    assert.ok(created.data); assert.equal(created.error, null);
  }
  assert.equal(f.posts.length, 2); assert.notEqual(f.posts[0].id, f.posts[1].id);
});

function batchFixture(count, queueFails = false) {
  const rows = Array.from({ length: count }, (_, n) => ({ storage_path: 'posts/' + String(n).padStart(5, '0') + '.jpg', user_name: 'A', upload_id: upload + n, status: 'pending', created_at: '2020-01-01', cleaned_at: null }));
  const queues = [], removals = [], auth = [{id:'auth',user_name:'A',media_type:'__auth__'}];
  const db = { from(name) { const source = name==='posts'?auth:rows;let removing=false;let filters = [], cap = Infinity, change = null; const q = { delete() { removing=true;return q; }, maybeSingle:async()=>({data:source.filter(r=>filters.every(f=>f(r)))[0]||null}), select() { return q; }, eq(k,v) { filters.push(r=>r[k]===v);return q; }, in(k,vs) { filters.push(r=>vs.includes(r[k]));return q; }, is(k,v) { filters.push(r=>r[k]===v);return q; }, lt(k,v) { filters.push(r=>r[k]<v);return q; }, gt(k,v) { filters.push(r=>r[k]>v);return q; }, order() { return q; }, limit(n) { cap=n;return q; }, update(v) { change=v;return q; }, then(a,b) { const selected=source.filter(r=>filters.every(f=>f(r))).slice(0,cap); if(removing)selected.forEach(r=>source.splice(source.indexOf(r),1)); if(change)selected.forEach(r=>Object.assign(r,change)); return Promise.resolve({data:selected}).then(a,b); } }; return q; },
    storage: { from() { return { remove: async paths => { removals.push(...paths); return { data: paths.map(name=>({name})) }; } }; } },
    async rpc(name,args) { if(name==='enqueue_storage_cleanup') { queues.push(args.p_paths);return queueFails?{error:Error('offline')}:{data:{ok:true,queued:true,paths:args.p_paths}}; } const row=rows.find(r=>r.storage_path===args.p_path); if(row.referenced){row.status='attached';return{data:{ok:true,referenced:true}};}row.status='cleanup';return{data:{ok:true,referenced:false}}; }
  }; return { db, rows, queues, removals, auth };
}

test('abandoned upload sweep keeps fresh/attached media and reaches later pages beyond its bounded batch', async () => {
  const { sweepPostMediaUploads } = require('../render-api/post-media');
  const f=batchFixture(53);f.rows[0].created_at=new Date().toISOString();f.rows[1].status='attached';f.rows[2].referenced=true;
  let cursor=await sweepPostMediaUploads(f.db);assert.ok(cursor);cursor=await sweepPostMediaUploads(f.db,{cursor});assert.equal(cursor,'');
  assert.equal(f.removals.length,50);assert.equal(f.rows[0].status,'pending');assert.equal(f.rows[1].status,'attached');assert.equal(f.rows[2].status,'attached');assert.ok(f.rows[52].cleaned_at);
});

test('account retirement reads every pending path and durably queues before caller deletes registry metadata', async () => {
  const { retireAccountPostMediaUploads } = require('../render-api/post-media');
  const f=batchFixture(501);assert.equal((await retireAccountPostMediaUploads(f.db,'A')).length,501);assert.deepEqual(f.queues.map(q=>q.length),[500,1]);assert.ok(f.rows.every(r=>r.status==='cleanup'));
  const offline=batchFixture(1,true);await assert.rejects(retireAccountPostMediaUploads(offline.db,'A'));assert.equal(offline.rows.length,1);
});

test('prepare after account retirement last page retains metadata until authenticated orphan cleanup', async () => {
  const { retireAccountPostMediaUploads, deleteQueuedAccountPostMediaUploads, sweepPostMediaUploads } = require('../render-api/post-media');
  const f=batchFixture(1);const queued=await retireAccountPostMediaUploads(f.db,'A');
  const late={storage_path:'posts/99999-late.jpg',user_name:'A',upload_id:'late-upload',status:'pending',created_at:'2020-01-01',cleaned_at:null};f.rows.push(late);
  await deleteQueuedAccountPostMediaUploads(f.db,'A',queued);
  assert.deepEqual(f.rows,[late]);assert.deepEqual(f.queues[0],queued);
  f.auth.length=0;await sweepPostMediaUploads(f.db);
  assert.deepEqual(f.removals,[late.storage_path]);assert.equal(f.rows.length,0);
});

test('already cleaned tombstone is removed after account disappears, without deleting storage again', async () => {
  const { sweepPostMediaUploads } = require('../render-api/post-media');const f=batchFixture(1);f.rows[0].status='cleanup';f.rows[0].cleaned_at='2020-01-02';
  await sweepPostMediaUploads(f.db);assert.equal(f.rows.length,1);
  f.auth.length=0;await sweepPostMediaUploads(f.db);assert.equal(f.rows.length,0);assert.equal(f.removals.length,0);
});
