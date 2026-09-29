'use strict';

const assert = require('assert');
const test = require('node:test');
const { MAX_IMAGE_SIZE, createPhotoRecord, findStoragePathRefs, parseStoragePhotoUrl, validatePhotoCreatePayload } = require('../render-api/photo-create');

const ORIGIN = 'https://ithowxqignlhkwaykglt.supabase.co';
const GOOD_URL = ORIGIN + '/storage/v1/object/public/uploads/photos/test.jpg';
function valid(overrides) { return Object.assign({ media_url: GOOD_URL, file_size: 12, original_size: 12, mime_type: 'image/jpeg' }, overrides || {}); }

function createStoragePathRefsSupabase(results) {
  const calls = [];
  return {
    calls,
    from: function(table) {
      return {
        select: function(columns, options) {
          const call = { table: table, columns: columns, options: options, filters: [] };
          calls.push(call);
          return {
            ilike: function(column, pattern) { call.filters.push({ type: 'ilike', column: column, value: pattern }); return this; },
            neq: function(column, value) { call.filters.push({ type: 'neq', column: column, value: value }); return this; },
            limit: function(limit) {
              call.limit = limit;
              return Promise.resolve(results[calls.length - 1]);
            }
          };
        }
      };
    }
  };
}

test('storage path reference lookup checks content and media_url then merges duplicate rows', async function() {
  const shared = { id: 'shared', user_name: 'owner' };
  const mediaOnly = { id: 'media-only', user_name: 'other' };
  const supabase = createStoragePathRefsSupabase([
    { data: [shared, { id: 'content-only', user_name: 'owner' }], count: 2, error: null },
    { data: [shared, mediaOnly], count: 2, error: null },
    { data: [mediaOnly, { id: 'encoded-only', user_name: 'other' }], count: 2, error: null }
  ]);

  const result = await findStoragePathRefs(supabase, 'photos/cat one.jpg', 'excluded-id');

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.truncated, false);
  assert.deepStrictEqual(result.refs.map(function(ref) { return ref.id; }).sort(), [
    'content-only', 'encoded-only', 'media-only', 'shared'
  ]);
  assert.strictEqual(new Set(result.refs.map(function(ref) { return String(ref.id); })).size, result.refs.length,
    'a post matching content and media_url must be returned only once');
  assert.deepStrictEqual(supabase.calls.map(function(call) {
    return call.filters.find(function(filter) { return filter.type === 'ilike'; }).column;
  }), ['content', 'media_url', 'media_url']);
  assert.deepStrictEqual(supabase.calls.map(function(call) {
    return call.filters.find(function(filter) { return filter.type === 'ilike'; }).value;
  }), ['%"photos/cat one.jpg"%', '%photos/cat one.jpg%', '%photos/cat\\%20one.jpg%']);
  supabase.calls.forEach(function(call) {
    assert.strictEqual(call.table, 'posts');
    assert.strictEqual(call.columns, 'id,user_name');
    assert.deepStrictEqual(call.options, { count: 'exact' });
    assert.strictEqual(call.limit, 50);
    assert.ok(call.filters.some(function(filter) { return filter.type === 'neq' && filter.column === 'id' && filter.value === 'excluded-id'; }));
  });
});

test('storage path reference lookup fails closed when any content or media_url query errors', async function() {
  const queryError = { message: 'media_url lookup unavailable' };
  const supabase = createStoragePathRefsSupabase([
    { data: [{ id: 'content-ref', user_name: 'other' }], count: 1, error: null },
    { data: [{ id: 'raw-url-ref', user_name: 'other' }], count: 1, error: null },
    { data: null, count: null, error: queryError }
  ]);

  const result = await findStoragePathRefs(supabase, 'photos/cat one.jpg', null);

  assert.strictEqual(supabase.calls.length, 3);
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.refs, [], 'partial matches must not be treated as a complete ownership check');
  assert.strictEqual(result.error, queryError);
});

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

test('database outcome failure preserves storage for reconciliation', async function() {
  let removed = false;
  let logged = false;
  var failQuery = {
    maybeSingle: async function() { return { error: { message: 'db' } }; }
  };
  failQuery.eq = function() { return failQuery; };
  failQuery.select = function() { return failQuery; };
  // C-2/C-3: 归属检查 findStoragePathRefs 走 select→ilike→limit 链，无引用返回空
  failQuery.ilike = function() { return failQuery; };
  failQuery.neq = function() { return failQuery; };
  failQuery.limit = async function() { return { data: [], error: null }; };
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
  assert.strictEqual(removed, false);
  assert.strictEqual(logged, false);
  // A failed insert followed by an inconclusive actor-key lookup may already
  // have committed. Keep the object and require a retry/reconciliation.
  assert.strictEqual(result.status, 503);
  assert.strictEqual(result.body.ok, false);
  assert.strictEqual(result.body.code, 'PHOTO_COMMIT_UNKNOWN');
});

test('thrown database write preserves storage for reconciliation', async function() {
  let removed = false;
  var errQuery = {
    maybeSingle: async function() { throw new Error('transport'); }
  };
  errQuery.eq = function() { return errQuery; };
  errQuery.select = function() { return errQuery; };
  // C-2/C-3: 归属检查 findStoragePathRefs 链
  errQuery.ilike = function() { return errQuery; };
  errQuery.neq = function() { return errQuery; };
  errQuery.limit = async function() { return { data: [], error: null }; };
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
  assert.strictEqual(removed, false);
  assert.strictEqual(result.status, 503);
  assert.strictEqual(result.body.code, 'PHOTO_COMMIT_UNKNOWN');
});

test('successful write uses a server-generated actor key', async function() {
  let inserted;
  var okQuery = { maybeSingle: async function() { return { data: { id: 1 } }; } };
  okQuery.eq = function() { return okQuery; };
  okQuery.select = function() { return okQuery; };
  // C-2/C-3: 归属检查 findStoragePathRefs 链
  okQuery.ilike = function() { return okQuery; };
  okQuery.neq = function() { return okQuery; };
  okQuery.limit = async function() { return { data: [], error: null }; };
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
  assert.match(inserted.actor_key, /^photo_[a-f0-9]{12}_server-uuid$/);
  assert.strictEqual(result.status, 200);
});

test('upload_id idempotency: existing record returned without insert', async function() {
  const existingRow = { id: 42, user_name: 'user', media_url: GOOD_URL, actor_key: 'photo_existing' };
  let insertCalled = false;
  var existingQuery = { maybeSingle: async function() { return { data: existingRow, error: null }; } };
  existingQuery.eq = function() { return existingQuery; };
  existingQuery.select = function() { return existingQuery; };
  // C-2/C-3: 归属检查 findStoragePathRefs 链（无他人引用 → 幂等返回）
  existingQuery.ilike = function() { return existingQuery; };
  existingQuery.neq = function() { return existingQuery; };
  existingQuery.limit = async function() { return { data: [], error: null }; };
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
