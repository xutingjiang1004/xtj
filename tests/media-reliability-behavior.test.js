'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  verifyStorageObject,
  claimDmMediaUpload,
  reserveDmMediaUpload
} = require('../render-api/dm-media');
const {
  removeStorageWithQueue
} = require('../render-api/storage-cleanup');
const {
  createPhotoRecord,
  createPhotoThumbnail
} = require('../render-api/photo-create');

const ORIGIN = 'https://ithowxqignlhkwaykglt.supabase.co';
const PHOTO_URL = ORIGIN + '/storage/v1/object/public/uploads/photos/test.jpg';

function chain(result) {
  const query = {};
  ['select', 'eq', 'in', 'order', 'limit', 'update'].forEach(function (name) {
    query[name] = function () { return query; };
  });
  query.maybeSingle = async function () { return result; };
  query.single = async function () { return result; };
  return query;
}

test('DM media ownership rejects a second uploader before storage enumeration', async function () {
  let listCalled = false;
  const supabase = {
    from: function (table) {
      assert.equal(table, 'dm_media_uploads');
      return chain({ data: {
        storage_path: 'chat/upload_a.jpg',
        uploader: 'alice',
        kind: 'image',
        mime_type: 'image/jpeg',
        status: 'uploaded'
      }, error: null });
    },
    storage: { from: function () {
      return { list: async function () { listCalled = true; return { data: [], error: null }; } };
    } }
  };
  const result = await claimDmMediaUpload(supabase, {
    storagePath: 'chat/upload_a.jpg',
    uploader: 'bob',
    kind: 'image',
    mimeType: 'image/jpeg'
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'forbidden');
  assert.equal(result.code, 'media_not_owned');
  assert.equal(listCalled, false);
});

test('DM storage verification uses exact search instead of enumerating chat/1000', async function () {
  let optionsSeen = null;
  const supabase = {
    storage: { from: function (bucket) {
      assert.equal(bucket, 'uploads');
      return { list: async function (directory, options) {
        assert.equal(directory, 'chat');
        optionsSeen = options;
        return { data: [{ name: 'exact_1.jpg', metadata: { size: 1234 } }], error: null };
      } };
    } }
  };
  const result = await verifyStorageObject(supabase, 'chat/exact_1.jpg');
  assert.equal(result.ok, true);
  assert.equal(result.size, 1234);
  assert.deepEqual(optionsSeen, { limit: 10, search: 'exact_1.jpg' });
});

test('DM media reservation uses a single CAS lease and rejects a fresh concurrent sender', async function () {
  let updateCalls = 0;
  const uploadedRow = {
    id: '00000000-0000-0000-0000-000000000011',
    storage_path: 'chat/lease_1.jpg',
    uploader: 'alice',
    kind: 'image',
    mime_type: 'image/jpeg',
    status: 'uploaded',
    updated_at: new Date().toISOString()
  };
  const supabase = {
    from: function (table) {
      assert.equal(table, 'dm_media_uploads');
      const q = chain({
        data: Object.assign({}, uploadedRow, { status: 'sending' }),
        error: null
      });
      q.update = function () { updateCalls += 1; return q; };
      return q;
    },
    storage: { from: function () {
      return { list: async function () { return { data: [{ name: 'lease_1.jpg' }], error: null }; } };
    } }
  };
  const reserved = await reserveDmMediaUpload(supabase, { row: uploadedRow });
  assert.equal(reserved.ok, true);
  assert.equal(reserved.state, 'reserved');
  assert.equal(reserved.data.status, 'sending');
  assert.equal(updateCalls, 1);

  const freshSending = Object.assign({}, uploadedRow, { status: 'sending', updated_at: new Date().toISOString() });
  const conflict = await reserveDmMediaUpload(supabase, { row: freshSending });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.state, 'conflict');
  assert.equal(conflict.code, 'media_send_in_progress');
});

test('storage removal queues every failed path and confirms the queue insert', async function () {
  let queuedPayload = null;
  const supabase = {
    storage: { from: function () {
      return { remove: async function () { return { error: { message: 'network unavailable' } }; } };
    } },
    from: function (table) {
      assert.equal(table, 'storage_cleanup_jobs');
      const q = chain({ data: { id: 7 }, error: null });
      q.insert = function (payload) { queuedPayload = payload; return q; };
      return q;
    }
  };
  const result = await removeStorageWithQueue(supabase, {
    bucket: 'uploads',
    photoId: '00000000-0000-0000-0000-000000000007',
    paths: ['photos/original.jpg', 'photos/thumb.webp']
  });
  assert.equal(result.ok, true);
  assert.equal(result.cleanup_pending, true);
  assert.deepEqual(queuedPayload.paths, ['photos/original.jpg', 'photos/thumb.webp']);
  assert.equal(queuedPayload.photo_id, '00000000-0000-0000-0000-000000000007');
});

test('storage removal reports queue_failed when durable cleanup cannot be recorded', async function () {
  const supabase = {
    storage: { from: function () {
      return { remove: async function () { return { error: { message: 'network unavailable' } }; } };
    } },
    from: function () {
      const q = chain({ data: null, error: { code: '42P01', message: 'queue table missing' } });
      q.insert = function () { return q; };
      return q;
    }
  };
  const result = await removeStorageWithQueue(supabase, { paths: ['chat/missing.jpg'] });
  assert.equal(result.ok, false);
  assert.equal(result.cleanup_pending, false);
  assert.equal(result.queue_failed, true);
});

test('photo thumbnail dimensions come from the final WebP output', async function () {
  const output = Buffer.from('webp-output');
  const image = {
    metadata: async function () { return { width: 4000, height: 3000, orientation: 1 }; },
    rotate: function () { return image; },
    resize: function () { return image; },
    webp: function () { return image; },
    toBuffer: async function (options) {
      assert.deepEqual(options, { resolveWithObject: true });
      return { data: output, info: { width: 321, height: 123 } };
    }
  };
  const uploaded = [];
  const supabase = {
    storage: { from: function () {
      return {
        download: async function () { return { data: { arrayBuffer: async function () { return new Uint8Array([1, 2, 3]); } } }; },
        upload: async function (path, buffer) { uploaded.push({ path: path, buffer: buffer }); return { data: { path: path }, error: null }; }
      };
    } }
  };
  const result = await createPhotoThumbnail({
    storagePath: 'photos/original.jpg',
    supabase: supabase,
    supabaseUrl: ORIGIN,
    sharp: function () { return image; }
  });
  assert.equal(result.width, 321);
  assert.equal(result.height, 123);
  assert.equal(result.fileSize, output.length);
  assert.equal(uploaded.length, 1);
});

test('same upload_id never removes the already referenced storage path', async function () {
  let removeCalled = false;
  const existing = {
    id: 'photo-1',
    user_name: 'alice',
    media_url: PHOTO_URL,
    content: JSON.stringify({ storagePath: 'photos/test.jpg', thumb: 'photos/thumbs/existing.webp' })
  };
  const supabase = {
    from: function (table) {
      assert.equal(table, 'posts');
      return chain({ data: existing, error: null });
    },
    storage: { from: function () {
      return {
        createSignedUrl: async function () { return { data: { signedUrl: 'signed' }, error: null }; },
        remove: async function () { removeCalled = true; return { data: [], error: null }; }
      };
    } }
  };
  const result = await createPhotoRecord({
    body: { media_url: PHOTO_URL, file_size: 12, original_size: 12, mime_type: 'image/jpeg', upload_id: 'upload_123' },
    userName: 'alice',
    supabase: supabase,
    supabaseUrl: ORIGIN
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.idempotent, true);
  assert.equal(removeCalled, false);
});
