'use strict';
// The OSS migration script and the abandoned-upload sweep, checked against the real database schema (all migrations applied to a
// throw-away local PostgreSQL): the writes the migration performs are not stopped by a trigger or constraint, the filters mean what the
// script thinks they mean, and the cleanup function never hands back a photo that is still in use. Skipped without a local database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { withBackendDatabase } = require('./helpers/backend-database-fixture');

const connectionString = process.env.XTJ_TEST_DATABASE_URL;
const SB = 'https://project.supabase.co';
const pub = path => SB + '/storage/v1/object/public/uploads/' + path;
const OSS = key => 'https://bucket.oss-cn-hangzhou.aliyuncs.com/' + key;

test('PostgreSQL: the migration script\'s reads select the right rows and its writes go through every trigger and constraint', { skip: !connectionString, timeout: 120000 }, async () => {
  await withBackendDatabase(async ({ db }) => {
    const insertPost = async (user, type, url, content, extra = '') => (await db.query(
      `INSERT INTO posts(user_name, media_type, media_url, content ${extra ? ',' + extra.split('=')[0] : ''}) VALUES($1,$2,$3,$4 ${extra ? ',' + extra.split('=')[1] : ''}) RETURNING id`, [user, type, url, content])).rows[0].id;
    const live = await insertPost('alice', 'video', pub('posts/alice_1_video.mp4'), JSON.stringify({ __type: '__xtj_post_v2__', text: 'v', meta: { poster_url: pub('posters/alice_1_poster.jpg'), thumbs: [pub('posts/thumb_alice_1.jpg')] } }));
    const album = await insertPost('alice', 'album', pub('posts/alice_2_a.png'), 'plain');
    const legacy = await insertPost('bob', 'image', pub('1777456621870_IMG_3381.jpeg'), 'plain');
    const deleted = await insertPost('bob', 'image', pub('posts/bob_3_deleted.png'), 'plain', 'is_deleted=true');
    const wall = await insertPost('bob', '__photo_wall__', pub('photos/wall.jpg'), '{}');
    const system = await insertPost('bob', '__report__', pub('posts/not_a_post.png'), '{}');
    const onOss = await insertPost('carol', 'image', OSS('posts/already.jpg'), 'plain');
    await db.query('INSERT INTO post_attachments(post_id, position, media_type, media_url, storage_path, file_size) VALUES($1,0,\'image\',$2,$3,1000),($1,1,\'image\',$4,$5,2000)',
      [album, pub('posts/alice_2_a.png'), 'posts/alice_2_a.png', pub('posts/alice_2_b.png'), 'posts/alice_2_b.png']);
    await db.query('INSERT INTO post_attachments(post_id, position, media_type, media_url, storage_path, file_size) VALUES($1,0,\'image\',$2,$3,1000)', [deleted, pub('posts/bob_3_deleted.png'), 'posts/bob_3_deleted.png']);

    // The same filters the script sends through PostgREST, written as SQL.
    const media = (await db.query(`SELECT id FROM posts WHERE (is_deleted IS NULL OR is_deleted = false) AND media_type IN ('image','video','audio','photo','album') AND media_url ILIKE '%/storage/v1/object/public/uploads/%' ORDER BY id`)).rows.map(r => r.id);
    assert.deepEqual(new Set(media), new Set([live, album, legacy]), 'live normal posts only: not deleted, not the photo wall, not system rows, not what is already on OSS');
    const withMeta = (await db.query(`SELECT id FROM posts WHERE (is_deleted IS NULL OR is_deleted = false) AND content ILIKE '%__xtj_post_v2__%' AND content ILIKE '%/storage/v1/object/public/uploads/%'`)).rows.map(r => r.id);
    assert.deepEqual(withMeta, [live], 'the post whose poster and thumbnail still live on Supabase');
    const attachments = (await db.query(`SELECT a.storage_path FROM post_attachments a JOIN posts p ON p.id = a.post_id WHERE a.media_url ILIKE '%/storage/v1/object/public/uploads/%' AND (p.is_deleted IS NULL OR p.is_deleted = false) ORDER BY a.storage_path`)).rows.map(r => r.storage_path);
    assert.deepEqual(attachments, ['posts/alice_2_a.png', 'posts/alice_2_b.png'], 'a deleted post\'s attachment is left alone');

    // The writes: compare-and-swap on a normal post, on its content, and on an attachment. Every trigger and constraint must let them through.
    const swapPost = await db.query('UPDATE posts SET media_url = $3 WHERE id = $1 AND media_url = $2 RETURNING id', [album, pub('posts/alice_2_a.png'), OSS('posts/alice_2_a.png')]);
    assert.equal(swapPost.rowCount, 1, 'the compare-and-swap updates exactly one row');
    const lost = await db.query('UPDATE posts SET media_url = $3 WHERE id = $1 AND media_url = $2 RETURNING id', [album, pub('posts/alice_2_a.png'), OSS('posts/x.png')]);
    assert.equal(lost.rowCount, 0, 'a stale old value changes nothing');
    const before = (await db.query('SELECT content FROM posts WHERE id=$1', [live])).rows[0].content;
    const after = before.split(pub('posters/alice_1_poster.jpg')).join(OSS('posters/alice_1_poster.jpg'));
    assert.equal((await db.query('UPDATE posts SET content = $3 WHERE id = $1 AND content = $2 RETURNING id', [live, before, after])).rowCount, 1);
    assert.equal(JSON.parse((await db.query('SELECT content FROM posts WHERE id=$1', [live])).rows[0].content).meta.poster_url, OSS('posters/alice_1_poster.jpg'));
    const swapAttachment = await db.query('UPDATE post_attachments SET media_url = $3 WHERE storage_path = $1 AND media_url = $2 RETURNING id', ['posts/alice_2_a.png', pub('posts/alice_2_a.png'), OSS('posts/alice_2_a.png')]);
    assert.equal(swapAttachment.rowCount, 1, 'the attachment accepts an OSS address (the row keeps its storage path)');
    assert.equal((await db.query('SELECT media_url FROM posts WHERE id=$1', [wall])).rows[0].media_url, pub('photos/wall.jpg'), 'the photo wall row was never part of it');
    // The 50MB ceiling is also enforced by the database for attachments.
    await assert.rejects(db.query('INSERT INTO post_attachments(post_id, position, media_type, media_url, storage_path, file_size) VALUES($1,5,\'image\',$2,$3,52428801)', [album, OSS('posts/huge.png'), 'posts/huge.png']), /file_size_check/);
  });
});

test('PostgreSQL: the abandoned-upload sweep only gets back photos that no photo record uses, and marks them for removal', { skip: !connectionString, timeout: 120000 }, async () => {
  await withBackendDatabase(async ({ db }) => {
    const reg = (path, user, status, ageDays) => db.query(`INSERT INTO photo_upload_registry(storage_path, user_name, upload_id, status, created_at) VALUES($1,$2,$3,$4, now() - ($5 || ' days')::interval)`, [path, user, 'up_' + path.length + path.slice(-6), status, String(ageDays)]);
    await reg('photos/old-orphan.jpg', 'alice', 'pending', 30);
    await reg('photos/old-but-used.jpg', 'alice', 'pending', 30);
    await reg('photos/recent.jpg', 'alice', 'pending', 2);
    await reg('photos/attached.jpg', 'alice', 'attached', 60);
    await db.query(`INSERT INTO posts(user_name, media_type, media_url, content) VALUES('alice','__photo_wall__','https://storage/photo',$1)`, [JSON.stringify({ storagePath: 'photos/old-but-used.jpg' })]);
    // First line of defence: creating the photo record already marked its registry row as attached (a database trigger).
    assert.equal((await db.query(`SELECT status FROM photo_upload_registry WHERE storage_path='photos/old-but-used.jpg'`)).rows[0].status, 'attached');
    // Second line: pretend that marking was lost (a crash between the two steps) and the used photo is back to 'pending' and old.
    await db.query(`UPDATE photo_upload_registry SET status='pending' WHERE storage_path='photos/old-but-used.jpg'`);
    // What sweepAbandonedPhotoUploads asks the registry (14 days), written as SQL.
    const candidates = (await db.query(`SELECT storage_path FROM photo_upload_registry WHERE status='pending' AND user_name <> '__cleanup__' AND created_at < now() - interval '14 days' ORDER BY created_at LIMIT 100`)).rows.map(r => r.storage_path).sort();
    assert.deepEqual(candidates, ['photos/old-but-used.jpg', 'photos/old-orphan.jpg'], 'a recent upload and an attached one are not candidates');
    const claimed = (await db.query('SELECT claim_photo_cleanup_paths($1) result', [candidates])).rows[0].result;
    assert.deepEqual(claimed.paths, ['photos/old-orphan.jpg'], 'the photo a record still uses is never handed back for deletion');
    const status = Object.fromEntries((await db.query('SELECT storage_path, status FROM photo_upload_registry')).rows.map(r => [r.storage_path, r.status]));
    assert.equal(status['photos/old-orphan.jpg'], 'cleanup', 'the orphan is marked, so a later upload cannot reuse its path');
    assert.equal(status['photos/old-but-used.jpg'], 'attached', 'the used photo is protected from now on');
    assert.equal(status['photos/recent.jpg'], 'pending');
    const again = (await db.query(`SELECT storage_path FROM photo_upload_registry WHERE status='pending' AND user_name <> '__cleanup__' AND created_at < now() - interval '14 days'`)).rows;
    assert.deepEqual(again, [], 'a second sweep finds nothing to do');
  });
});
