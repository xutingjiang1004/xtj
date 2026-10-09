// 分页游标 + 稳定排序 + 私聊媒体授权 合同测试（2026-09-27）
//
// 背景：GPT 交接报告里承诺、但从未落到代码/数据库的三件后端补完工作。
// 本文件把它们的行为钉死，防止以后被"顺手改回 offset / 单时间戳游标"：
//   1) 私信分页必须用 (created_at, id) 复合 keyset 游标 —— 单时间戳会让同秒消息漏/重；
//   2) 照片墙两处列表必须有 id 兜底排序 —— offset 分页需要确定性全序；
//   3) 私聊媒体授权判定接口必须存在且鉴权（纯增量，不改渲染路径）；
//   4) 数据库迁移必须建好支撑上述查询的索引。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const server = read(path.join('render-api', 'server.js'));

function block(src, anchor, size) {
  const start = src.indexOf(anchor);
  assert.notEqual(start, -1, `找不到锚点: ${anchor}`);
  return src.slice(start, start + size);
}

function between(src, startAnchor, endAnchor) {
  const start = src.indexOf(startAnchor);
  assert.notEqual(start, -1, `找不到起始锚点: ${startAnchor}`);
  const end = src.indexOf(endAnchor, start + startAnchor.length);
  assert.notEqual(end, -1, `找不到结束锚点: ${endAnchor}`);
  return src.slice(start, end);
}

// =============================================================== 私信复合游标

test('DM 分页：必须解析复合游标（cursor=<ts>|<id> 或 before+before_id）', () => {
  const route = between(server, "app.get('/api/dm/messages'", "app.get('/api/dm/media/authorize'");
  assert.match(route, /parseDmCursor/, '必须解析合并游标串');
  assert.match(route, /indexOf\('\|'\)/, '游标串必须按 | 切分为时间与 id 两段');
  assert.match(route, /req\.query\.before_id/, '必须支持独立的 before_id 参数（增量能力）');
  assert.match(route, /req\.query\.cursor/, '必须支持 cursor 合并参数');
});

test('DM keyset SQL keeps timestamp precision and UUID ordering',()=>{
 const sql=fs.readFileSync('supabase/migrations/20261009102404_account_sessions_and_atomic_visibility.sql','utf8');
 assert.match(sql,/p.created_at<p_before/);assert.match(sql,/p.created_at=p_before AND p.id<p_before_id/);
 assert.match(sql,/ORDER BY p.created_at DESC,p.id DESC LIMIT/);
});

test('DM 分页：next_cursor 必须是复合游标并保留拆分字段', () => {
  const route = between(server, "app.get('/api/dm/messages'", "app.get('/api/dm/media/authorize'");
  assert.match(route, /next_cursor_ts/, '必须回传时间分量');
  assert.match(route, /next_cursor_id/, '必须回传 id 分量');
  assert.match(route, /nextCursorTs \+ '\|' \+ nextCursorId/, 'next_cursor 必须是 ts|id 复合串');
});

test('DM cursor remains optional and fetches one extra visible message',()=>{
 const route=between(server,"app.get('/api/dm/messages'","app.get('/api/dm/media/authorize'");
 assert.match(route,/p_limit: limit \+ 1/);assert.match(route,/p_before: before \|\| null/);
});
// =============================================================== 照片墙稳定排序

test('照片墙（公开列表）：必须有 id 兜底排序', () => {
  const route = between(server, "app.get('/api/photos/public'", "app.get('/api/avatar/:userName'");
  const createdIdx = route.indexOf(".order('created_at', { ascending: false })");
  const idIdx = route.indexOf(".order('id', { ascending: false })");
  assert.ok(createdIdx > 0, '必须按 created_at 倒序');
  assert.ok(idIdx > createdIdx, 'offset 分页必须有 id 兜底，否则同秒照片跨页重复/丢失');
});

test('照片墙（个人）：必须有 id 兜底排序', () => {
  const route = between(server, "app.get('/api/photos/wall/:userName'", "app.get('/api/photos/public'");
  const createdIdx = route.indexOf(".order('created_at', { ascending: false })");
  const idIdx = route.indexOf(".order('id', { ascending: false })");
  assert.ok(createdIdx > 0, '必须按 created_at 倒序');
  assert.ok(idIdx > createdIdx, 'offset 分页必须有 id 兜底排序');
});

// =============================================================== 私聊媒体授权

test('媒体授权：接口必须存在且要求登录', () => {
  const route = block(server, "app.get('/api/dm/media/authorize'", 400);
  assert.match(route, /authenticateUser/, '授权判定必须基于认证身份，不能匿名调用');
  assert.match(route, /rateLimit/, '必须限流，防止被当存在性探测器刷');
});

test('媒体授权：入参必须校验路径合法性，越界一律按未授权返回', () => {
  const route = between(server, "app.get('/api/dm/media/authorize'", '// Read state is server-authoritative');
  assert.match(route, /validateDmStoragePath/, '必须复用统一的存储路径校验');
  assert.match(route, /authorized: false, reason: 'invalid_path'/, '非法路径不得泄露校验细节，直接判未授权');
});

test('媒体授权：必须只对「参与者 + 未删除 + 未撤回」的消息放行', () => {
  const route = between(server, "app.get('/api/dm/media/authorize'", '// Read state is server-authoritative');
  assert.match(route, /sender !== me && recipient !== me/, '非收件人/发件人必须拒绝');
  assert.match(route, /not_participant/, '要有明确的拒绝原因码');
  assert.match(route, /is_deleted === true/, '软删消息不得授权');
  assert.match(route, /withdrawn === true/, '撤回消息不得授权');
  assert.match(route, /media_withdrawn/, '媒体级撤回要有独立原因码');
});

test('媒体授权：绝不签发任何 URL（纯增量，不改现有渲染路径）', () => {
  const route = between(server, "app.get('/api/dm/media/authorize'", '// Read state is server-authoritative');
  assert.ok(
    !/createSignedUrl/.test(route),
    '授权接口不得签发签名 URL —— 渲染路径仍是直连公共地址'
  );
  assert.ok(
    !/getPublicUrl/.test(route),
    '授权接口不得构造公共 URL，只回答 true/false'
  );
});

test('媒体授权：actor_key 前缀解析必须收敛为单一共享函数', () => {
  assert.match(server, /function resolveDmMediaPathFromActorKey\(actorKey\)/, '必须有共享解析函数');
  // 撤回处理器必须复用同一函数，不得自己再维护一份前缀表。
  // 注意区间方向：授权接口（约 15163 行）在 /api/dm/withdraw（约 16130 行）**之前**，
  // 所以 withdraw 区间要从它自己的锚点到下一个路由。
  const authorizeAt = server.indexOf("app.get('/api/dm/media/authorize'");
  const withdrawAt = server.indexOf("app.post('/api/dm/withdraw'");
  assert.ok(authorizeAt > 0 && withdrawAt > authorizeAt, '接口顺序前提失效，请更新本断言的区间锚点');
  const afterWithdraw = server.slice(withdrawAt, withdrawAt + 6000);
  assert.match(afterWithdraw, /resolveDmMediaPathFromActorKey/, '撤回路径必须复用共享解析函数');
  assert.ok(
    !/var DM_MEDIA_PREFIXES = \['__dm_img__', '__dm_vid__', '__dm_aud__'\]/.test(afterWithdraw),
    '不得在撤回处理器内重复定义前缀表（将来加 kind 会漏改）'
  );
  // 全仓库只应存在一处前缀表定义
  const prefixTableDefs = server.match(/DM_MEDIA_ACTOR_PREFIXES = \[/g) || [];
  assert.equal(prefixTableDefs.length, 1, '前缀表必须只定义一次');
});

// =============================================================== 数据库迁移

test('迁移 062：必须为私信复合游标建部分索引', () => {
  const sql = read(path.join('supabase', 'migrations', '062_pagination_cursors_and_indexes.sql'));
  assert.match(sql, /idx_posts_dm_direction_keyset/, '缺发件方向游标索引');
  assert.match(sql, /idx_posts_dm_inbound_keyset/, '缺收件方向游标索引');
  assert.match(sql, /created_at DESC, id DESC/, '索引排序键必须与查询 ORDER BY 对齐');
  assert.match(sql, /media_type = ''__dm__''/, '必须是 __dm__ 的部分索引');
});

test('迁移 062：必须为照片墙稳定排序建索引', () => {
  const sql = read(path.join('supabase', 'migrations', '062_pagination_cursors_and_indexes.sql'));
  assert.match(sql, /idx_posts_photo_wall_public_keyset/, '缺公开照片墙索引');
  assert.match(sql, /idx_posts_photo_wall_owner_keyset/, '缺个人照片墙索引');
  assert.match(sql, /visibility = ''public''/, '公开索引必须前置 visibility 过滤');
});

test('迁移 062：必须为私聊媒体注册表补查询路径', () => {
  const sql = read(path.join('supabase', 'migrations', '062_pagination_cursors_and_indexes.sql'));
  assert.match(sql, /idx_dm_media_uploads_storage_path/, '缺 storage_path 直达索引');
  assert.match(sql, /idx_dm_media_uploads_message_id/, '缺 message_id 索引');
});

test('迁移 062：必须幂等（IF NOT EXISTS + 表存在守卫）', () => {
  const sql = read(path.join('supabase', 'migrations', '062_pagination_cursors_and_indexes.sql'));
  // 只检查真正的 SQL 语句行：以 -- 开头的是注释（含验收示例里的 EXPLAIN 片段），
  // 且 CREATE INDEX IF NOT EXISTS 自身也包含 CREATE INDEX 子串，故用负向排除。
  const statements = sql
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('--'));
  const offenders = statements.filter((line) => /^CREATE\s+INDEX(?!\s+IF\s+NOT\s+EXISTS)/i.test(line));
  assert.equal(
    offenders.length, 0,
    `所有 CREATE INDEX 都必须是 IF NOT EXISTS，迁移才可重复执行；发现 ${offenders.length} 处：${offenders.join(' | ')}`
  );
  assert.ok((sql.match(/CREATE INDEX IF NOT EXISTS/g) || []).length >= 7, '索引数量不应少于预期');
  assert.match(sql, /IF EXISTS \(SELECT 1 FROM pg_tables/, '必须守卫目标表存在，避免在裁剪库上失败');
});
