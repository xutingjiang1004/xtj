'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../render-api/server.js'), 'utf8');

// 模拟 PostgREST：DELETE 带 limit 却没有 order 时直接报错（PGRST 要求 limit 必须配 order）。
function fakeSupabase(rows) {
  function builder() {
    const f = { eq: [], lt: [], inIds: null, limit: null, order: null, isDelete: false };
    const api = {
      select() { return api; },
      delete() { f.isDelete = true; return api; },
      eq(c, v) { f.eq.push([c, v]); return api; },
      lt(c, v) { f.lt.push([c, v]); return api; },
      in(c, v) { f.inIds = v; return api; },
      order() { f.order = true; return api; },
      limit(n) { f.limit = n; return api; },
      then(resolve) {
        if (f.isDelete && f.limit != null && !f.order) return resolve({ data: null, error: { message: 'limit requires order' } });
        let out = rows.filter(r => f.eq.every(([c, v]) => r[c] === v) && f.lt.every(([c, v]) => r[c] < v) && (!f.inIds || f.inIds.includes(r.id)));
        if (f.limit != null) out = out.slice(0, f.limit);
        if (f.isDelete) { out.forEach(r => rows.splice(rows.indexOf(r), 1)); }
        return resolve({ data: out.map(r => ({ id: r.id })), error: null });
      }
    };
    return api;
  }
  return { from() { return builder(); } };
}

function loadHelper(rows) {
  const start = source.indexOf('async function deleteAiMessageBatch(');
  assert.ok(start > 0, 'deleteAiMessageBatch should exist');
  const end = source.indexOf('\n}\n', start) + 3;
  const context = { supabase: fakeSupabase(rows), AI_AGENT_MESSAGE_MARKER: '__ai__' };
  return vm.runInNewContext('(function(){' + source.slice(start, end) + '; return deleteAiMessageBatch;})()', context);
}

test('AI 记录清理的批量删除不使用无 order 的 DELETE ... LIMIT，而是先查 id 再按 id 删除', async () => {
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push({ id: 'old' + i, media_type: '__ai__', created_at: '2026-01-0' + (i + 1) });
  rows.push({ id: 'fresh', media_type: '__ai__', created_at: '2026-11-01' });
  rows.push({ id: 'other', media_type: 'text', created_at: '2026-01-01' });
  const del = loadHelper(rows);
  assert.equal(await del('2026-10-01', 3), 3);
  assert.equal(await del('2026-10-01', 3), 2);
  assert.equal(await del('2026-10-01', 3), 0);
  assert.deepEqual(rows.map(r => r.id).sort(), ['fresh', 'other']);
});

test('两处清理入口都走同一个批量删除函数', () => {
  assert.doesNotMatch(source, /\.delete\(\)\s*\.select\('id'\)[^;]*\.limit\(/, '不应再有 delete().select().limit()');
  assert.equal((source.match(/await deleteAiMessageBatch\(/g) || []).length, 2);
});
