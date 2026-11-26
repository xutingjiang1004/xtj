'use strict';
// F-H1 回归：聊天实时投递只剩 Broadcast，断了靠 5 分钟轮询兜底。
// 修复前：
//   ① /api/dm/realtime-topic 拉取失败（非 ok / 异常）时直接 return，
//      没有任何重试，Broadcast 起不来就一直起不来，只能等用户切 tab；
//   ② 切回前台只重建订阅，Broadcast 若仍是断的，没有立即补拉，
//      隐藏期间的消息要等下一轮 300s 轮询。
// 修复后：topic 拉取失败按指数退避重试（代次守卫，30s 封顶）；
// 切回前台（visibilitychange/pageshow）立即跑一次 DM 补拉。
// 不在本次修复内：postgres_changes 从未投递——posts 不在
// publication 且 RLS 排除 __dm__，接通它需要数据库迁移 + RLS
// 变更（禁改项），且按人过滤缺失时放开会泄露全站私信，列入
// “待应用迁移/需用户决定”清单；原订阅作为防御性代码保留。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'core-parts', '05-feed-stats.js'), 'utf8');

test('F-H1: topic 拉取失败时安排指数退避重试，而非直接放弃', () => {
  const fnIdx = src.indexOf('async function subscribeToDmBroadcast()');
  assert.ok(fnIdx >= 0, '应有 subscribeToDmBroadcast');
  const body = src.slice(fnIdx, fnIdx + 6000);
  assert.ok(body.includes('/api/dm/realtime-topic'), '应拉取 realtime-topic');
  assert.ok(/scheduleDmBroadcastRetry|dmBroadcastRetry/.test(body), 'topic 失败路径应安排重试');
  assert.ok(/Math\.min\(1000 \* Math\.pow\(2, dmBroadcast\.attempts\), 30000\)/.test(body), '重试退避应指数增长、30s 封顶');
  assert.ok(body.includes('myEpoch !== dmBroadcast.epoch'), '重试应有代次守卫');
});

test('F-H1: 轮询单次执行被抽成可复用的 pollDmNow，供前台补拉调用', () => {
  assert.ok(/async function pollDmNow\(\)/.test(src), '应定义 pollDmNow');
  const startIdx = src.indexOf('function startDMPolling(');
  assert.ok(startIdx >= 0, '应有 startDMPolling');
  const startBody = src.slice(startIdx, startIdx + 2000);
  assert.ok(startBody.includes('setInterval(pollDmNow, interval)'), '轮询定时器应复用 pollDmNow');
  assert.ok(startBody.includes('pollDmNow()'), '立即轮询应走 pollDmNow');
});

test('F-H1: 切回前台时立即补拉一次 DM（不只重建订阅）', () => {
  const visIdx = src.indexOf("document.addEventListener('visibilitychange', function() {");
  assert.ok(visIdx >= 0, '应有 visibilitychange 处理');
  const visBody = src.slice(visIdx, visIdx + 2500);
  assert.ok(visBody.includes('pollDmNow()'), '可见性恢复时应立即补拉');
  const psIdx = src.indexOf("window.addEventListener('pageshow', function() {", visIdx);
  assert.ok(psIdx >= 0, '应有 pageshow 处理');
  const psBody = src.slice(psIdx, psIdx + 1200);
  assert.ok(psBody.includes('pollDmNow()'), 'pageshow 时也应立即补拉');
});

test('F-H1: postgres_changes 防御性订阅保留（待迁移，不擅自删除）', () => {
  assert.ok(src.includes("table: 'posts', filter: 'media_type=eq.' + DM_MARKER"), 'postgres_changes 订阅应保留');
});
