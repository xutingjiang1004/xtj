'use strict';
// E-M1 处置：不修（审计建议“从 /api/feed 剥离 actor_key”会改坏正常功能）。
// actor_key 不是密钥，是每帖的幂等/身份键，前端删帖、照片预览删除都依赖它：
//  - 删除按钮 openDelete(id, actorKey)，服务端再以 actor_key 调
//    delete_post_with_actor 删帖；
//  - 照片预览 context.actorKey 供删除当前照片使用；
//  - 点赞以 like.actor_key 做身份去重。
// 删掉它会让列表里的删帖和照片删除直接失效；改动接口的写操作服务端
// 仍先校验作者/管理员身份，单凭看到别人的 actor_key 删不了别人的帖。
// 本测试是护栏：以后任何人再提“剥离 actor_key”时先看到它会先失败。
// ip_lookup_started_at 同样保留：前端用它显示“IP 属地查询中”状态，
// ip_province/ip_city/ip_region_text 是用户明确要求展示的属地信息。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

const server = fs.readFileSync('render-api/server.js', 'utf8');
const posts = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');

test('/api/feed 必须继续返回 actor_key（删帖与照片删除依赖它）', () => {
  const start = server.indexOf("var selectFields = 'id, user_name, media_type");
  assert.ok(start > 0, '/api/feed 的 selectFields 已变动，人工复核');
  const block = server.slice(start, start + 600);
  assert.match(block, /actor_key/, 'selectFields 缺少 actor_key：列表删帖会失效');
});

test('删除按钮必须继续把 actor_key 传给 openDelete', () => {
  assert.match(posts, /openDelete\(\\'' \+ idJs \+ '\\', \\'' \+ actorKeyJs \+ '\\'\)/,
    '删除按钮不再传 actor_key，删帖会失效');
});

test('照片预览 context 必须继续携带 actorKey', () => {
  assert.match(posts, /actorKey: photo\.__xtjActorKey \|\| ''/,
    '照片预览 context 缺少 actorKey，预览里删除照片会失效');
});

test('IP 属地查询状态字段必须继续返回（前端用它显示查询中）', () => {
  const start = server.indexOf("var selectFields = 'id, user_name, media_type");
  const block = server.slice(start, start + 600);
  assert.match(block, /ip_lookup_started_at/, 'selectFields 缺少 ip_lookup_started_at：属地“查询中”状态会坏');
  assert.match(block, /ip_province, ip_city, ip_region_text/, 'selectFields 缺少属地展示字段');
});
