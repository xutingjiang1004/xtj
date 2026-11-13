// ★ 2026-11-14：定时任务核心逻辑的运行时测试（不依赖外部服务，supabase 用内存 mock）。
const test = require('node:test');
const assert = require('node:assert/strict');
const scheduler = require('../render-api/ai-scheduler');

const NOW = new Date('2026-11-13T16:00:00Z'); // = 2026-11-14 00:00:00 Asia/Shanghai（周六）

// 内存版 supabase：支持本模块用到的 select/eq/lte/order/limit/update 链式调用。
function makeDb(rows) {
  function execute(state) {
    var matched = state.rows.filter(function(row) {
      return state.filters.every(function(f) {
        if (f.op === 'eq') return row[f.col] === f.val;
        if (f.op === 'lte') return row[f.col] != null && String(row[f.col]) <= String(f.val);
        return true;
      });
    });
    if (state.updateObj) {
      matched.forEach(function(row) { Object.assign(row, state.updateObj); });
      var projected = state.isSelect ? matched.map(function(r) { return { id: r.id }; }) : matched;
      return { data: projected, error: null };
    }
    if (state.order) {
      var col = state.order.col, asc = state.order.asc;
      matched = matched.slice().sort(function(a, b) {
        return (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1);
      });
    }
    if (state.limitN) matched = matched.slice(0, state.limitN);
    return { data: matched, error: null };
  }
  return {
    rows: rows,
    from: function() {
      var state = { rows: rows, filters: [], order: null, limitN: null, updateObj: null, isSelect: false };
      var api = {
        select: function() { state.isSelect = true; return api; },
        update: function(obj) { state.updateObj = obj; return api; },
        eq: function(col, val) { state.filters.push({ col: col, op: 'eq', val: val }); return api; },
        lte: function(col, val) { state.filters.push({ col: col, op: 'lte', val: val }); return api; },
        order: function(col, opts) { state.order = { col: col, asc: !opts || opts.ascending !== false }; return api; },
        limit: function(n) { state.limitN = n; return api; },
        then: function(resolve, reject) { return Promise.resolve(execute(state)).then(resolve, reject); }
      };
      return api;
    }
  };
}

test('computeNextRun: once 未来返回该时间，过去返回 null', () => {
  assert.equal(scheduler.computeNextRun({ schedule_kind: 'once', run_at: '2026-11-15T08:00:00+08:00' }, NOW).toISOString(), '2026-11-15T00:00:00.000Z');
  assert.equal(scheduler.computeNextRun({ schedule_kind: 'once', run_at: '2026-11-01T08:00:00+08:00' }, NOW), null);
});

test('computeNextRun: interval 按分钟累加', () => {
  assert.equal(scheduler.computeNextRun({ schedule_kind: 'interval', interval_minutes: 30 }, NOW).toISOString(), '2026-11-13T16:30:00.000Z');
  assert.equal(scheduler.computeNextRun({ schedule_kind: 'interval', interval_minutes: 1440 }, NOW).toISOString(), '2026-11-14T16:00:00.000Z');
});

test('computeNextRun: daily 未到点取今天，已过点取明天（时区 Asia/Shanghai）', () => {
  assert.equal(scheduler.computeNextRun({ schedule_kind: 'daily', daily_time: '08:00', timezone: 'Asia/Shanghai' }, NOW).toISOString(), '2026-11-14T00:00:00.000Z');
  // NOW 恰好是本地 00:00:00，严格大于才算「未到点」，故顺延到次日 00:00 CST = 2026-11-14T16:00:00Z
  assert.equal(scheduler.computeNextRun({ schedule_kind: 'daily', daily_time: '00:00', timezone: 'Asia/Shanghai' }, NOW).toISOString(), '2026-11-14T16:00:00.000Z');
  // UTC 时区下同一刻的 08:00 应落在 UTC 当天 08:00
  assert.equal(scheduler.computeNextRun({ schedule_kind: 'daily', daily_time: '08:00', timezone: 'UTC' }, NOW).toISOString(), '2026-11-14T08:00:00.000Z');
});

test('computeNextRun: weekly 找下一个匹配星期', () => {
  // NOW 是周六（Asia/Shanghai 2026-11-14），周一 09:00 应落在 2026-11-16 09:00+08:00
  assert.equal(scheduler.computeNextRun({ schedule_kind: 'weekly', daily_time: '09:00', weekdays: [1], timezone: 'Asia/Shanghai' }, NOW).toISOString(), '2026-11-16T01:00:00.000Z');
  // 周六当天但时间未到：仍是今天
  assert.equal(scheduler.computeNextRun({ schedule_kind: 'weekly', daily_time: '09:00', weekdays: [6], timezone: 'Asia/Shanghai' }, NOW).toISOString(), '2026-11-14T01:00:00.000Z');
});

test('normalizeTaskInput: 参数校验与规范化', () => {
  assert.throws(() => scheduler.normalizeTaskInput({ schedule_kind: 'daily', daily_time: '08:00' }, NOW), /prompt/);
  assert.throws(() => scheduler.normalizeTaskInput({ prompt: '搜新闻', schedule_kind: 'interval', interval_minutes: 1 }, NOW), /interval_minutes/);
  assert.throws(() => scheduler.normalizeTaskInput({ prompt: 'x', schedule_kind: 'once', run_at: '2020-01-01' }, NOW), /将来/);
  assert.throws(() => scheduler.normalizeTaskInput({ prompt: 'x', schedule_kind: 'weekly', daily_time: '08:00' }, NOW), /weekdays/);
  assert.throws(() => scheduler.normalizeTaskInput({ prompt: 'x', schedule_kind: 'daily', daily_time: '25:00' }, NOW), /daily_time/);
  var row = scheduler.normalizeTaskInput({ prompt: '每天帮我搜 AI 新闻', schedule_kind: 'daily', daily_time: '8:05', owner_name: 'alice' }, NOW);
  assert.equal(row.daily_time, '08:05');
  assert.equal(row.owner_name, 'alice');
  assert.equal(row.next_run_at, '2026-11-14T00:05:00.000Z');
  assert.equal(row.title, '每天帮我搜 AI 新闻');
  assert.equal(row.timezone, 'Asia/Shanghai');
});

test('describeSchedule: 中文频率描述', () => {
  assert.equal(scheduler.describeSchedule({ schedule_kind: 'daily', daily_time: '08:00' }), '每天 08:00');
  assert.equal(scheduler.describeSchedule({ schedule_kind: 'weekly', daily_time: '09:00', weekdays: [1, 3] }), '每周一、周三 09:00');
  assert.equal(scheduler.describeSchedule({ schedule_kind: 'interval', interval_minutes: 120 }), '每 2 小时一次');
  assert.equal(scheduler.describeSchedule({ schedule_kind: 'interval', interval_minutes: 1440 }), '每 1 天一次');
});

test('scheduler.tick: 到点任务执行并推进下次时间，未到点不动，二次 tick 不重复', async () => {
  var rows = [
    { id: 'A', owner_name: 'alice', prompt: '搜新闻', schedule_kind: 'daily', daily_time: '08:00', timezone: 'Asia/Shanghai', enabled: true, next_run_at: '2026-11-13T00:00:00.000Z' },
    { id: 'B', owner_name: 'alice', prompt: '背单词', schedule_kind: 'daily', daily_time: '08:00', timezone: 'Asia/Shanghai', enabled: true, next_run_at: '2026-12-01T00:00:00.000Z' }
  ];
  var db = makeDb(rows);
  var ranTasks = [];
  var sch = scheduler.createScheduler({
    supabase: db, now: () => NOW, logger: { warn: function() {} },
    runTask: async function(task) { ranTasks.push(task.id); return { summary: '已完成 ' + task.id, conversation_id: 'CONV1' }; }
  });
  var r1 = await sch.tick();
  assert.equal(r1.ran, 1);
  assert.deepEqual(ranTasks, ['A']);
  assert.equal(rows[0].last_status, 'success');
  assert.equal(rows[0].last_summary, '已完成 A');
  assert.equal(rows[0].conversation_id, 'CONV1');
  assert.equal(rows[0].last_run_at, NOW.toISOString());
  assert.equal(rows[0].next_run_at, '2026-11-14T00:00:00.000Z'); // 推进到明天 08:00 CST
  assert.equal(rows[0].enabled, true);
  assert.equal(rows[1].last_status, undefined); // B 未被触碰
  var r2 = await sch.tick();
  assert.equal(r2.ran, 0); // A 的 next_run_at 已推进，不再到点
  assert.deepEqual(ranTasks, ['A']);
});

test('scheduler.tick: once 任务执行后自动停用', async () => {
  var rows = [{ id: 'C', owner_name: 'alice', prompt: '提醒我', schedule_kind: 'once', run_at: '2026-11-13T15:00:00.000Z', timezone: 'Asia/Shanghai', enabled: true, next_run_at: '2026-11-13T15:00:00.000Z' }];
  var db = makeDb(rows);
  var sch = scheduler.createScheduler({ supabase: db, now: () => NOW, logger: { warn: function() {} }, runTask: async function() { return { summary: 'ok' }; } });
  var r = await sch.tick();
  assert.equal(r.ran, 1);
  assert.equal(rows[0].enabled, false);
  assert.equal(rows[0].next_run_at, null);
  assert.equal(rows[0].last_status, 'success');
});

test('scheduler.tick: 执行失败记录 last_error，且不会重复抢占', async () => {
  var rows = [{ id: 'D', owner_name: 'alice', prompt: 'x', schedule_kind: 'interval', interval_minutes: 30, timezone: 'Asia/Shanghai', enabled: true, next_run_at: '2026-11-13T15:00:00.000Z' }];
  var db = makeDb(rows);
  var sch = scheduler.createScheduler({
    supabase: db, now: () => NOW, logger: { warn: function() {} },
    runTask: async function() { throw new Error('上游模型不可用'); }
  });
  await sch.tick();
  assert.equal(rows[0].last_status, 'error');
  assert.match(rows[0].last_error, /上游模型不可用/);
  assert.equal(rows[0].next_run_at, '2026-11-13T16:30:00.000Z'); // 仍按 interval 推进，30 分钟后重试
  var r2 = await sch.tick();
  assert.equal(r2.ran, 0);
});

test('scheduler.tick: 查询失败不误执行任务', async () => {
  var db = { from: function() { return { select: function() { return this; }, eq: function() { return this; }, lte: function() { return this; }, order: function() { return this; }, limit: function() { return Promise.resolve({ data: null, error: { message: 'relation does not exist' } }); } }; } };
  var called = 0;
  var sch = scheduler.createScheduler({ supabase: db, now: () => NOW, logger: { warn: function() {} }, runTask: async function() { called++; return {}; } });
  var r = await sch.tick();
  assert.equal(r.ran, 0);
  assert.equal(called, 0);
  assert.match(r.error, /does not exist/);
});
