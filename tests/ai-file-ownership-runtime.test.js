'use strict';
// ★ 2026-11-16（审计 P0 U-S9 / U-S10 / U-S2）
// 官方 Files API 归属登记：上传登记 → 引用校验 → 剥离非本人 file_id → 删除清理。
const test = require('node:test'), assert = require('node:assert/strict');
const { createFileOwnership, isFileId } = require('../render-api/ai-file-ownership');

function fixture(opts) {
  let clock = 1000000;
  const o = createFileOwnership(Object.assign({
    now: () => clock,
    ipOf: (req) => req.realIp,
    ttlMs: 1000,
    max: 10
  }, opts || {}));
  return {
    o,
    advance: (ms) => { clock += ms; },
    req: (name, ip) => ({ userName: name || '', realIp: ip || '1.2.3.4' })
  };
}

test('isFileId: 只接受官方 file-api- 前缀的合法标识', () => {
  assert.equal(isFileId('file-api-abc123'), true);
  assert.equal(isFileId('file-api-A_b-9'), true);
  assert.equal(isFileId('file-api-'), false);
  assert.equal(isFileId('../../etc/passwd'), false);
  assert.equal(isFileId('javascript:alert(1)'), false);
  assert.equal(isFileId(''), false);
});

test('归属命名空间：登录用户用 userName，游客用真实 IP，永不用空串', () => {
  const { o, req } = fixture();
  assert.equal(o.ownerKeyOf(req('alice')), 'user:alice');
  assert.equal(o.ownerKeyOf(req('', '9.8.7.6')), 'guest:9.8.7.6');
  const a = o.ownerKeyOf(req('', '1.1.1.1'));
  const b = o.ownerKeyOf(req('', '2.2.2.2'));
  assert.notEqual(a, b, '不同 IP 的游客不得共享归属键');
  assert.notEqual(o.ownerKeyOf(req('alice')), o.ownerKeyOf(req('', '1.1.1.1')));
});

test('register / isOwnedBy：只有本人能引用，他人或未登记一律拒绝（fail-closed）', () => {
  const { o, req } = fixture();
  const alice = req('alice'), bob = req('bob');
  assert.equal(o.register('bad-id', alice), false, '非法 file_id 不登记');
  assert.equal(o.isOwnedBy('file-api-never', alice), false, '未登记不得放行');
  assert.equal(o.register('file-api-doc1', alice), true);
  assert.equal(o.isOwnedBy('file-api-doc1', alice), true);
  assert.equal(o.isOwnedBy('file-api-doc1', bob), false, '跨用户引用必须拒绝');
  assert.equal(o.isOwnedBy('file-api-doc1', req('', '1.2.3.4')), false, '游客不能引用登录用户文件');
});

test('TTL 过期后自动失效；容量上限淘汰最旧条目', () => {
  const { o, req, advance } = fixture();
  const alice = req('alice');
  o.register('file-api-t1', alice);
  advance(1001);
  assert.equal(o.isOwnedBy('file-api-t1', alice), false, '过期条目不得复用');

  const f2 = fixture({ max: 2 });
  f2.o.register('file-api-a', f2.req('x'));
  f2.o.register('file-api-b', f2.req('x'));
  f2.o.register('file-api-c', f2.req('x'));
  assert.ok(f2.o.size() <= 2, '容量上限生效');
  assert.equal(f2.o.isOwnedBy('file-api-a', f2.req('x')), false, '最旧条目被淘汰');
});

test('stripForeignFileIds：剥离请求体里不属于本人的 file_id，保留附件其它字段', () => {
  const { o, req } = fixture();
  const alice = req('alice'), bob = req('bob');
  o.register('file-api-mine', alice);
  const body = {
    attachments: [
      { name: 'a.pdf', data_url: 'data:application/pdf;base64,AAA', file_id: 'file-api-mine' },
      { name: 'b.pdf', data_url: 'data:application/pdf;base64,BBB', file_id: 'file-api-others' },
      { name: 'c.png', data_url: 'data:image/png;base64,CCC' }
    ],
    messages: [
      { role: 'user', attachments: [{ name: 'hist.pdf', file_id: 'file-api-others' }] }
    ]
  };
  const removed = o.stripForeignFileIds(body, alice);
  assert.equal(removed, 2, '顶层与 messages 里的非本人 file_id 都要剥离');
  assert.equal(body.attachments[0].file_id, 'file-api-mine', '本人文件保留');
  assert.equal(body.attachments[0].data_url, 'data:application/pdf;base64,AAA', '本地解析数据不能丢');
  assert.equal('file_id' in body.attachments[1], false);
  assert.equal('file_id' in body.messages[0].attachments[0], false);
  // 同一份 body 换 bob 看：他一个都不该拿到
  const body2 = { attachments: [{ name: 'a.pdf', file_id: 'file-api-mine' }] };
  assert.equal(o.stripForeignFileIds(body2, bob), 1);
  assert.equal('file_id' in body2.attachments[0], false);
});

test('drop 需归属匹配；forget 无条件清登记（供管理员删除后使用）', () => {
  const { o, req } = fixture();
  const alice = req('alice'), bob = req('bob');
  o.register('file-api-d1', alice);
  assert.equal(o.drop('file-api-d1', bob), false, '他人不得清登记');
  assert.equal(o.isOwnedBy('file-api-d1', alice), true);
  assert.equal(o.drop('file-api-d1', alice), true);
  assert.equal(o.isOwnedBy('file-api-d1', alice), false);

  o.register('file-api-d2', alice);
  assert.equal(o.forget('file-api-d2'), true);
  assert.equal(o.isOwnedBy('file-api-d2', alice), false, '删除后不得再被引用');
});
