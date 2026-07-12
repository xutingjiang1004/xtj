'use strict';

const assert = require('assert');
const test = require('node:test');
const { MAX_IMAGE_SIZE, createPhotoRecord, parseStoragePhotoUrl, validatePhotoCreatePayload } = require('../render-api/photo-create');

const ORIGIN = 'https://ithowxqignlhkwaykglt.supabase.co';
const GOOD_URL = ORIGIN + '/storage/v1/object/public/uploads/photos/test.jpg';
function valid(overrides) { return Object.assign({ media_url: GOOD_URL, file_size: 12, original_size: 12, mime_type: 'image/jpeg' }, overrides || {}); }

function makeEmptyQuery() {
  var q = { maybeSingle: async function() { return { data: null, error: { message: 'not found' } }; } };
  q.eq = function() { return q; };
  q.select = function() { return q; };
  return q;
}

test('photo create rejects untrusted URLs and legacy fields', function() {
  [
    valid({ media_url: '' }), valid({ media_url: 'javascript:alert(1)' }), valid({ media_url: GOOD_URL.replace('https:', 'http:') }),
    valid({ media_url: GOOD_URL.replace(ORIGIN, 'https://example.com') }), valid({ media_url: GOOD_URL.replace('/uploads/photos/', '/avatars/photos/') }),
    valid({ media_url: GOOD_URL.replace('/photos/', '/other/') }), valid({ media_url: GOOD_URL + '?x=1' }), valid({ media_url: GOOD_URL + '#x' }),
    valid({ media_url: GOOD_URL + 'a'.repeat(2048) }), valid({ content: 'x'.repeat(3000) }), valid({ content: {} }), valid({ actor_key: 'x'.repeat(129) })
  ].forEach(function(body) { assert.strictEqual(validatePhotoCreatePayload(body, ORIGIN).ok, false); });
  assert.strictEqual(parseStoragePhotoUrl('https://example.com/storage/v1/object/public/uploads/photos/a.jpg', ORIGIN).ok, false);
});

test('photo create accepts bounded image metadata and owns actor key', function() {
  assert.strictEqual(validatePhotoCreatePayload(valid({ file_size: -1 }), ORIGIN).ok, false);
  assert.strictEqual(validatePhotoCreatePayload(valid({ original_size: MAX_IMAGE_SIZE + 1 }), ORIGIN).ok, false);
  assert.strictEqual(validatePhotoCreatePayload(valid({ mime_type: 'text/plain' }), ORIGIN).ok, false);
  const result = validatePhotoCreatePayload(valid({ mime_type: 'image/avif' }), ORIGIN);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.storagePath, 'photos/test.jpg');
  assert.deepStrictEqual(JSON.parse(result.content), { type: 'photo_wall', mediaKind: 'image', thumb: '', fileSize: 12, originalSize: 12, mimeType: 'image/avif', width: null, height: null, duration: null, storagePath: 'photos/test.jpg' });
});

test('upload_id must match pattern when provided', function() {
  assert.strictEqual(validatePhotoCreatePayload(valid({ upload_id: 'ab' }), ORIGIN).ok, false);
  assert.strictEqual(validatePhotoCreatePayload(valid({ upload_id: 'good_upload-id_123' }), ORIGIN).ok, true);
});

test('database failure awaits safe storage rollback and returns generic error', async function() {
  let removed = false;
  let logged = false;
  var failQuery = {
    maybeSingle: async function() { return { error: { message: 'db' } }; }
  };
  failQuery.eq = function() { return failQuery; };
  failQuery.select = function() { return failQuery; };
  var failInsert = { select: function() { return failQuery; } };
  const supabase = {
    from: function() {
      return {
        insert: function() { return failInsert; },
        eq: function() { return failQuery; },
        select: function() { return failQuery; }
      };
    },
    storage: { from: function() { return { remove: async function(paths) { await Promise.resolve(); removed = paths[0] === 'photos/test.jpg'; return { error: { message: 'storage' } }; } }; } }
  };
  const result = await createPhotoRecord({ body: valid(), userName: 'user', supabase: supabase, supabaseUrl: ORIGIN, logger: { error: function() { logged = true; } }, createActorKey: function() { return 'uuid'; } });
  assert.strictEqual(removed, true);
  assert.strictEqual(logged, true);
  assert.strictEqual(result.status, 500);
  assert.strictEqual(result.body.ok, false);
  assert.strictEqual(result.body.code, 'UPSTREAM_ERROR');
});

test('thrown database write also performs rollback', async function() {
  let removed = false;
  var errQuery = {
    maybeSingle: async function() { throw new Error('transport'); }
  };
  errQuery.eq = function() { return errQuery; };
  errQuery.select = function() { return errQuery; };
  const supabase = {
    from: function() {
      return {
        insert: function() { return { select: function() { return errQuery; } }; },
        eq: function() { return errQuery; },
        select: function() { return errQuery; }
      };
    },
    storage: { from: function() { return { remove: async function() { removed = true; return {}; } }; } }
  };
  const result = await createPhotoRecord({ body: valid(), userName: 'user', supabase: supabase, supabaseUrl: ORIGIN, logger: { error: function() {} } });
  assert.strictEqual(removed, true);
  assert.strictEqual(result.status, 500);
});

test('successful write uses a server-generated actor key', async function() {
  let inserted;
  var okQuery = { maybeSingle: async function() { return { data: { id: 1 } }; } };
  okQuery.eq = function() { return okQuery; };
  okQuery.select = function() { return okQuery; };
  var supabase = {
    from: function() {
      return {
        insert: function(rows) { inserted = rows[0]; return { select: function() { return okQuery; } }; },
        eq: function() { return okQuery; },
        select: function() { return okQuery; }
      };
    }
  };
  const result = await createPhotoRecord({ body: valid(), userName: 'user', supabase: supabase, supabaseUrl: ORIGIN, logger: { error: function() {} }, createActorKey: function() { return 'server-uuid'; } });
  assert.strictEqual(inserted.actor_key, 'photo_server-uuid');
  assert.strictEqual(result.status, 200);
});

test('upload_id idempotency: existing record returned without insert', async function() {
  const existingRow = { id: 42, user_name: 'user', media_url: GOOD_URL, actor_key: 'photo_existing' };
  let insertCalled = false;
  var existingQuery = { maybeSingle: async function() { return { data: existingRow, error: null }; } };
  existingQuery.eq = function() { return existingQuery; };
  existingQuery.select = function() { return existingQuery; };
  var supabase = {
    from: function() {
      return {
        insert: function() { insertCalled = true; throw new Error('should not insert'); },
        eq: function() { return existingQuery; },
        select: function() { return existingQuery; }
      };
    }
  };
  const result = await createPhotoRecord({ body: valid({ upload_id: 'good_upload-id_123' }), userName: 'user', supabase: supabase, supabaseUrl: ORIGIN, logger: { error: function() {} } });
  assert.strictEqual(insertCalled, false);
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.idempotent, true);
  assert.strictEqual(result.body.data.id, 42);
});

test('invalid URL never reaches rollback', async function() {
  let removed = false;
  const result = await createPhotoRecord({ body: valid({ media_url: 'https://evil.example/x' }), userName: 'user', supabase: { storage: { from: function() { return { remove: async function() { removed = true; } }; } } }, supabaseUrl: ORIGIN, logger: { error: function() {} } });
  assert.strictEqual(result.status, 400);
  assert.strictEqual(removed, false);
});
