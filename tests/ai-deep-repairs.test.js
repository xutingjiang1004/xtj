'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConversationDocuments, prepareResearchDocuments } = require('../render-api/research-documents');
const { dedupeSources } = require('../render-api/research-evidence');

const documents = [{ id: 'F1', name: '原始资料.md', status: 'read', paragraphs: [{ id: 'P1', text: '最早上传且仍需引用的事实。' }] }];
function documentDatabase(rows, errorPage = -1) {
  const calls = [];
  let page = 0;
  return { calls, from(table) {
    assert.equal(table, 'posts');
    const filters = [];
    const query = {
      select() { return this; },
      eq(key, value) { filters.push(row => row[key] === value); calls.push([key, value]); return this; },
      filter(key, op, value) {
        calls.push([key, op, value]);
        if (key === 'media_url') filters.push(row => row.media_url.includes('"prepared_documents"'));
        return this;
      },
      order() { return this; },
      limit(count) { return this.range(0, count - 1); },
      range(start, end) {
        calls.push(['range', start, end]);
        if (page++ === errorPage) return Promise.resolve({ error: { message: 'isolated database failure' } });
        return Promise.resolve({ data: rows.filter(row => filters.every(filter => filter(row))).slice(start, end + 1) });
      }
    };
    return query;
  } };
}
function record(meta, user = 'alice') {
  return { user_name: user, media_type: '__ai_agent_msg__', media_url: JSON.stringify(meta) };
}
test('research can reuse original private documents after many ordinary conversation turns', async () => {
  const db = documentDatabase([
    ...Array.from({ length: 80 }, () => record({ convId: 'CURRENT1', role: 'user', content: '后续问题' })),
    record({ convId: 'CURRENT1', prepared_documents: documents }, 'bob'),
    record({ convId: 'OTHER', prepared_documents: documents }),
    record({ convId: 'CURRENT1', deleted: true, prepared_documents: documents }),
    record({ convId: 'CURRENT1', prepared_documents: documents })
  ]);
  assert.deepEqual(await loadConversationDocuments(db, 'alice', 'CURRENT1', 'ai_msg_conv_CURRENT1_%'), documents);
  assert.ok(db.calls.some(call => call[0] === 'user_name' && call[1] === 'alice'));
  assert.ok(db.calls.some(call => call[0] === 'actor_key' && call[2] === 'ai_msg_conv_CURRENT1_%'));
});
test('document lookup continues beyond a page of deleted or invalid research records and propagates read failures', async () => {
  const rows = [...Array.from({ length: 70 }, () => record({ convId: 'CURRENT1', deleted: true, prepared_documents: documents })), record({ convId: 'CURRENT1', prepared_documents: documents })];
  assert.deepEqual(await loadConversationDocuments(documentDatabase(rows), 'alice', 'CURRENT1', 'pattern'), documents);
  await assert.rejects(loadConversationDocuments(documentDatabase(rows, 1), 'alice', 'CURRENT1', 'pattern'), /暂时无法读取/);
  assert.deepEqual(await loadConversationDocuments(documentDatabase([record({ convId: 'CURRENT1', prepared_documents: [] }), ...rows]), 'alice', 'CURRENT1', 'pattern'), []);
});

const body = Array.from({ length: 100 }, (_, i) => '第' + i + '段核对过的真实正文与数据。').join('\n');
test('later complete text upgrades a URL-only source before merging identical repost bodies', () => {
  for (const rows of [
    [{ url: 'https://a.test/article', title: '原始研究标题', published_at: '2026-10-18', snippet: '旧摘要', content_unavailable: true }, { url: 'https://a.test/article?utm_source=next', content: body, content_complete: true }, { url: 'https://b.test/repost', content: body, content_complete: true }],
    [{ url: 'https://a.test/article', content: body, content_complete: true }, { url: 'https://b.test/repost', snippet: '旧摘要' }, { url: 'https://b.test/repost?utm_source=next', content: body, content_complete: true }]
  ]) {
    const result = dedupeSources(rows);
    assert.equal(result.unique_count, 1);
    assert.equal(result.merged_count, 2);
    assert.equal(result.sources[0].aliases.length, 3);
    assert.equal(result.sources[0].content_checked, true);
    assert.equal(result.sources[0].content_unavailable, false);
    assert.equal(result.sources[0].dedupe_basis, 'body');
    assert.match(result.sources[0].snippet, /核对过的真实正文/);
    if (rows[0].title) { assert.equal(result.sources[0].title, rows[0].title); assert.equal(result.sources[0].published_at, rows[0].published_at); }
  }
});
test('conflicting complete snapshots at one URL cannot merge independent sources by an obsolete body', () => {
  const result = dedupeSources([{ url: 'https://a.test/article', content: body + '\n预算增加+100。' }, { url: 'https://a.test/article?utm_source=next', content: body + '\n预算减少-100。' }, { url: 'https://b.test/article', content: body + '\n预算增加+100。' }]);
  assert.equal(result.unique_count, 2);
});
test('a research attachment accepted by the 50MiB composer reaches extraction without a hidden 20MiB rejection', async () => {
  const original = Buffer.alloc(21 * 1024 * 1024, 65);
  const result = await prepareResearchDocuments([{ name: 'large.png', data_url: 'data:image/png;base64,' + original.toString('base64') }], {
    ocrImageBuffer: async buffer => { assert.equal(Buffer.compare(buffer, original), 0); return { text: '', error: '图片超过 OCR 限制，未读取文字' }; }
  });
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].bytes, original.length);
  assert.equal(result.documents[0].status, 'unread');
  assert.match(result.context, /OCR 限制/);
});
