// H-1 实时投递合同（2026-09-25）
//
// 背景：DM 的 Realtime 订阅（postgres_changes on posts）**从来没能投递过** ——
//   · posts 不在 supabase_realtime publication（migration 022 只加了 comments）；
//   · posts 的 RLS 白名单显式排除 __dm__（migration 015 / 035）；
//   · 浏览器端 Realtime socket 从未用本应用 JWT 鉴权（全仓库没有 setAuth/setSession）。
// 因此新消息只能靠轮询到达。H-1 的修法是改成 Broadcast（按人隔离的不可猜频道名），
// 并**保留轮询兜底**。本文件把这些约束钉死，防止以后被"顺手优化"掉。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const server = read(path.join('render-api', 'server.js'));
const feed = read(path.join('js', 'core-parts', '05-feed-stats.js'));
const chat = read(path.join('js', 'core-parts', '06-chat-and-nav.js'));
const core = read(path.join('js', 'core.js'));

function block(src, anchor, size) {
  const start = src.indexOf(anchor);
  assert.notEqual(start, -1, `找不到锚点: ${anchor}`);
  return src.slice(start, start + size);
}

// ---------------------------------------------------------------- 服务端
test('H-1: 频道名由 service key 派生的 HMAC 生成（不可猜）', () => {
  const fn = block(server, 'function dmRealtimeTopic(userName) {', 400);
  assert.match(fn, /createHmac\('sha256'/, '必须用 HMAC-SHA256 派生频道名');
  assert.match(fn, /SUPABASE_SERVICE_KEY/, '密钥必须是只存在于服务端的 service key');
  assert.match(fn, /\.slice\(0, 32\)/, '频道名必须截断，避免泄露过长摘要');
  assert.match(fn, /return 'dm-' \+/, '频道名必须带固定前缀');
});

test('H-1: 换频道名的接口必须要求登录', () => {
  const route = block(server, "app.get('/api/dm/realtime-topic'", 500);
  assert.match(route, /authenticateUser/, '必须鉴权，否则任何人都能换取别人的频道名');
  assert.match(route, /dmRealtimeTopic\(req\.userName\)/, '只能返回调用者自己的频道名');
});

test('H-1: 发布走 Realtime Broadcast REST，且永不阻塞发送', () => {
  const fn = block(server, 'function publishDmRealtime(targetUser, message) {', 1200);
  assert.match(fn, /\/realtime\/v1\/api\/broadcast/, '必须用 Broadcast REST 端点');
  assert.match(fn, /private: false/, '公共频道 + 不可猜频道名（客户端没有本应用 JWT，无法走私有频道授权）');
  assert.match(fn, /apikey: SUPABASE_SERVICE_KEY/, '必须用 service_role apikey 发布，绕开 RLS/publication');
  assert.match(fn, /\.catch\(/, '必须有 catch，投递失败不能冒泡影响发送');
  assert.ok(!/await fetch\(/.test(fn), '发布必须 fire-and-forget，不得 await 阻塞 /api/dm/send');
});

test('H-1: /api/dm/send 在成功返回前发布消息', () => {
  const sendStart = server.indexOf("app.post('/api/dm/send'");
  const sendEnd = server.indexOf("app.post('/api/dm/withdraw'");
  assert.ok(sendStart > 0 && sendEnd > sendStart, '无法定位 /api/dm/send 区间');
  const body = server.slice(sendStart, sendEnd);
  const publishAt = body.indexOf('publishDmRealtime(targetUser, inserted)');
  const respondAt = body.indexOf('return res.json({ ok: true, message: inserted })');
  assert.ok(publishAt > 0, '/api/dm/send 必须在成功后调用 publishDmRealtime');
  assert.ok(respondAt > publishAt, '必须先发布再回响应，否则客户端可能先收到 HTTP 再收到广播');
});

// ---------------------------------------------------------------- 前端
test('H-1: 前端订阅自己的广播频道并带代次保护', () => {
  const fn = block(feed, 'async function subscribeToDmBroadcast() {', 2600);
  assert.match(fn, /xtjProtectedFetch\("\/api\/dm\/realtime-topic"\)/, '必须先向认证接口换取自己的频道名');
  assert.match(fn, /sb\.channel\(dmBroadcast\.topic/, '必须订阅服务端下发的 topic');
  assert.match(fn, /\.on\("broadcast", \{ event: "dm" \}/, '必须监听 dm 广播事件');
  assert.match(fn, /myEpoch !== dmBroadcast\.epoch/, '退避重连必须有代次校验（与 P1-01 同一教训）');
  assert.match(fn, /removeChannel\(dmBroadcast\.channel\)/, '重建订阅前必须移除旧频道，避免通道泄漏');
});

test('H-1 / P2-02: 收到广播后增量更新，不再全量回拉历史', () => {
  const fn = block(feed, 'function applyRealtimeDmMessage(message) {', 2000);
  assert.match(fn, /upsertDockChatCacheMessage\(otherUser, message\)/, '必须把 payload 增量并入会话缓存');
  assert.match(fn, /renderDockMessages\(otherUser, _chatCache\[key\] \|\| \[\], false\)/, '必须直接渲染缓存而非回拉');
  // 只看真实调用（注释里提到函数名是允许的）
  assert.ok(!/loadDockChatMessages\s*\(/.test(fn), 'P2-02：收到一条新消息不得触发整页回拉');
  assert.match(fn, /message\.media_type !== DM_MARKER/, '必须过滤非私信行');
  assert.match(fn, /message\.user_name !== window\.currentUser && message\.media_url !== window\.currentUser/,
    '必须确认这条消息与我有关，否则可能把别人的消息写进缓存');
  assert.match(fn, /window\.dockChatListCacheTime = 0;/, '会话列表缓存必须失效，下一次打开取权威值');
});

test('H-1: 会话列表就地改行前必须确认列表已渲染（避免被覆盖成一条）', () => {
  const idx = feed.indexOf('function applyRealtimeDmMessage(message) {');
  const seg = feed.slice(idx, idx + 2600);
  assert.match(seg, /querySelector\("\.chat-list-item"\)/,
    'applyDockChatConversationPreview 会整体重排渲染，列表为空时必须跳过');
});

test('H-1: 轮询兜底必须保留（复审 P2-03 明确不做）', () => {
  assert.match(feed, /function startDMPolling\(/, '轮询函数不得删除');
  assert.match(chat, /startDMPolling\(60000, true\)/, '必须仍有 60 秒轮询兜底');
  assert.match(feed, /function subscribeToMessages\(\) \{\n\s*\/\/ ★ H-1：顺带确保 Broadcast 订阅存在/,
    'Broadcast 订阅必须搭在 subscribeToMessages 上，覆盖启动/可见性/online/pageshow');
});

test('H-1: 不得放宽 posts 的 Realtime/RLS 来"修"投递（会泄露全站私信）', () => {
  const sqlFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.sql')) sqlFiles.push(full);
    }
  };
  walk(path.join(ROOT, 'supabase', 'migrations'));
  assert.ok(sqlFiles.length > 0, '找不到迁移文件');
  for (const file of sqlFiles) {
    const sql = fs.readFileSync(file, 'utf8');
    assert.ok(!/ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+(public\.)?posts/i.test(sql),
      `${path.basename(file)} 把 posts 加进了 supabase_realtime —— 那条订阅没有按人过滤，会泄露全站私信`);
  }
});

test('H-1: 组装后的 core.js 含有新订阅（core-parts 改动必须已构建）', () => {
  assert.match(core, /function subscribeToDmBroadcast\(\)/, 'core.js 缺少 subscribeToDmBroadcast —— 忘记跑 scripts/assemble-core.js');
  assert.match(core, /realtime-topic/, 'core.js 缺少 realtime-topic 端点调用');
});
