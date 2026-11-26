// F-M3：私信删除（墓碑）前后端上限对齐 + 推送校验合并结果。
// 之前：前端 DM_DELETED_MAX=8000，服务端 cleanDmDeletedIds 只留 500，
// 且 pushDmDeletedToServer 在 resp.ok 后即清待补传队列，不校验服务端
// 返回的合并 ids —— 超出的删除在换设备后悄悄复活。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const server = fs.readFileSync('render-api/server.js', 'utf8');
const chat = fs.readFileSync('js/core-parts/06-chat-and-nav.js', 'utf8');

function capOf(src) {
  const m = src.match(/DM_DELETED_MAX\s*=\s*(\d+)/);
  assert.ok(m, '找不到 DM_DELETED_MAX');
  return Number(m[1]);
}

test('F-M3: 前后端删除墓碑上限一致，且不超过 RPC 单次上限', () => {
  const serverCap = capOf(server);
  const clientCap = capOf(chat);
  assert.equal(serverCap, clientCap, `服务端 ${serverCap} 与前端 ${clientCap} 不一致`);
  assert.ok(serverCap <= 3000, '不得超过 merge_dm_deleted_ids 单次 3000 条的上限');
  assert.ok(serverCap >= 500, '上限不应低于旧的服务端 500，否则已同步的删除会丢失');
});

function pushFixture(fetchImpl) {
  const cleared = [], enqueued = [];
  const c = {
    currentUser: 'alice', _authStateEpoch: 1,
    console: { warn() {} },
    enqueueDmDeletedPending(ids) { enqueued.push(ids.slice()); },
    clearDmDeletedPendingForCurrentAccount(ids) { cleared.push(ids.slice()); }
  };
  c.window = { xtjProtectedFetch: fetchImpl };
  vm.createContext(c);
  const start = chat.indexOf('            function pushDmDeletedToServer(ids) {');
  const end = chat.indexOf('            // ★ 2026-09-26：与服务端合并墓碑', start);
  assert.ok(start > 0 && end > start, '找不到 pushDmDeletedToServer');
  vm.runInContext(chat.slice(start, end), c);
  return { c, cleared, enqueued };
}

test('F-M3: 只清合并结果里有的 id，没合并的留待补传', async () => {
  const { c, cleared, enqueued } = pushFixture(async () => ({
    ok: true, json: async () => ({ ok: true, ids: ['a', 'c'] })
  }));
  const ok = await c.pushDmDeletedToServer(['a', 'b', 'c']);
  assert.equal(ok, false, '有 id 未被合并时必须返回 false');
  assert.deepEqual(cleared, [['a', 'c']], '只清已确认的 id');
  assert.deepEqual(enqueued, [['b']], '未合并的 id 必须留在待补传队列');
});

test('F-M3: 全部合并时返回 true 并清队', async () => {
  const { c, cleared, enqueued } = pushFixture(async () => ({
    ok: true, json: async () => ({ ok: true, ids: ['a', 'b'] })
  }));
  const ok = await c.pushDmDeletedToServer(['a', 'b']);
  assert.equal(ok, true);
  assert.deepEqual(cleared, [['a', 'b']]);
  assert.deepEqual(enqueued, []);
});

test('F-M3: 服务端没给合并结果时不算同步成功', async () => {
  const { c, cleared, enqueued } = pushFixture(async () => ({
    ok: true, json: async () => ({ ok: true })
  }));
  const ok = await c.pushDmDeletedToServer(['a']);
  assert.equal(ok, false, '无法验证合并结果时不得清队');
  assert.deepEqual(cleared, []);
  assert.deepEqual(enqueued, [['a']]);
});
