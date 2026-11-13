// ★ 2026-11-14（用户要求）：小猫AI 定时任务 / 自动化。
// 用户在对话里用自然语言交代「什么时候做什么」，模型调用 schedule_task 工具
// 自主规划频率与时间并落库；本模块负责：
//   1) 规范化任务参数并计算下次运行时间（支持 单次/间隔/每天/每周，时区感知）；
//   2) 常驻调度器：周期性扫描到点任务，原子抢占后交给注入的 runTask 执行，
//      执行结果与错误回写任务行，once 任务执行完自动停用。
// 不 require server.js，supabase 与 runTask 均依赖注入，便于 node --test 用内存
// mock 验证调度与执行逻辑。

var SCHEDULE_KINDS = ['once', 'interval', 'daily', 'weekly'];
var WEEKDAY_NAMES = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
var WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad2(n) { return (n < 10 ? '0' : '') + n; }

// 用 Intl 取某时刻在指定时区的本地部件（年/月/日/时/分/秒/星期），不依赖运行环境时区。
function zonedParts(date, timeZone) {
  var dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
  });
  var map = {};
  dtf.formatToParts(date).forEach(function(p) { if (p.type !== 'literal') map[p.type] = p.value; });
  return {
    year: +map.year, month: +map.month, day: +map.day,
    hour: (+map.hour) % 24, minute: +map.minute, second: +map.second,
    weekday: WEEKDAY_NAMES[map.weekday] != null ? WEEKDAY_NAMES[map.weekday] : 0
  };
}

// 把「某时区里的一个本地时间」换算成 UTC 毫秒：先按 UTC 猜，再用该时区实际本地时间迭代校正。
function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  var guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (var i = 0; i < 4; i++) {
    var p = zonedParts(new Date(guess), timeZone);
    var want = Date.UTC(year, month - 1, day, hour, minute, 0);
    var have = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    var diff = want - have;
    if (!diff) break;
    guess += diff;
  }
  return guess;
}

function validTimeZone(tz) {
  try { zonedParts(new Date(0), tz); return true; } catch (e) { return false; }
}

function parseDailyTime(value) {
  var m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  if (!m) return null;
  return { hour: +m[1], minute: +m[2], text: pad2(+m[1]) + ':' + pad2(+m[2]) };
}

// 计算下次运行时间。返回 Date；once 已过期返回 null（表示不再运行）。
function computeNextRun(task, now) {
  now = now || new Date();
  var tz = task.timezone || 'Asia/Shanghai';
  var kind = task.schedule_kind;
  if (kind === 'once') {
    var at = new Date(task.run_at);
    if (isNaN(at.getTime())) throw new Error('run_at 无法解析');
    return at.getTime() > now.getTime() ? at : null;
  }
  if (kind === 'interval') {
    var mins = parseInt(task.interval_minutes, 10);
    if (!(mins >= 1)) throw new Error('interval_minutes 无效');
    return new Date(now.getTime() + mins * 60000);
  }
  var dt = parseDailyTime(task.daily_time);
  if (!dt) throw new Error('daily_time 需为 HH:MM');
  var p = zonedParts(now, tz);
  if (kind === 'daily') {
    var today = zonedTimeToUtc(p.year, p.month, p.day, dt.hour, dt.minute, tz);
    if (today > now.getTime()) return new Date(today);
    var nextDay = new Date(Date.UTC(p.year, p.month - 1, p.day) + 86400000);
    return new Date(zonedTimeToUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), dt.hour, dt.minute, tz));
  }
  if (kind === 'weekly') {
    var days = Array.isArray(task.weekdays) && task.weekdays.length ? task.weekdays : [p.weekday];
    for (var add = 0; add <= 7; add++) {
      var dayDate = new Date(Date.UTC(p.year, p.month - 1, p.day) + add * 86400000);
      var wd = new Date(dayDate.getTime() + (0)).getUTCDay();
      if (days.indexOf(wd) < 0) continue;
      var t = zonedTimeToUtc(dayDate.getUTCFullYear(), dayDate.getUTCMonth() + 1, dayDate.getUTCDate(), dt.hour, dt.minute, tz);
      if (t > now.getTime()) return new Date(t);
    }
    // 理论不可达：7 天内必有一天命中；兜底一周后的今天
    return new Date(now.getTime() + 7 * 86400000);
  }
  throw new Error('未知 schedule_kind: ' + kind);
}

// 校验并规范化工具/前端传入的任务参数，返回可直接落库的行（含 next_run_at）。
function normalizeTaskInput(args, now) {
  args = args || {};
  now = now || new Date();
  var prompt = String(args.prompt || '').trim();
  if (!prompt) throw new Error('prompt 不能为空');
  if (prompt.length > 4000) throw new Error('prompt 过长（最多 4000 字）');
  var kind = String(args.schedule_kind || '').trim();
  if (SCHEDULE_KINDS.indexOf(kind) < 0) throw new Error('schedule_kind 需为 once / interval / daily / weekly');
  var tz = String(args.timezone || 'Asia/Shanghai').trim() || 'Asia/Shanghai';
  if (!validTimeZone(tz)) throw new Error('timezone 无效：' + tz);
  var row = {
    owner_name: String(args.owner_name || '').trim(),
    prompt: prompt,
    title: String(args.title || '').trim().slice(0, 60) || prompt.slice(0, 24),
    schedule_kind: kind,
    timezone: tz,
    run_at: null,
    interval_minutes: null,
    daily_time: null,
    weekdays: null,
    conversation_id: args.conversation_id ? String(args.conversation_id).slice(0, 100) : null
  };
  if (kind === 'once') {
    var at = new Date(args.run_at);
    if (!args.run_at || isNaN(at.getTime())) throw new Error('once 任务需要可解析的 run_at（ISO 时间）');
    if (at.getTime() <= now.getTime()) throw new Error('run_at 必须是将来的时间');
    row.run_at = at.toISOString();
  } else if (kind === 'interval') {
    var mins = parseInt(args.interval_minutes, 10);
    if (!(mins >= 5 && mins <= 10080)) throw new Error('interval_minutes 需在 5–10080 分钟之间');
    row.interval_minutes = mins;
  } else {
    var dt = parseDailyTime(args.daily_time);
    if (!dt) throw new Error('daily_time 需为 HH:MM（24 小时制）');
    row.daily_time = dt.text;
    if (kind === 'weekly') {
      var days = Array.isArray(args.weekdays) ? args.weekdays : [];
      days = Array.from(new Set(days.map(function(d) { return parseInt(d, 10); }).filter(function(d) { return d >= 0 && d <= 6; }))).sort(function(a, b) { return a - b; });
      if (!days.length) throw new Error('weekly 任务需要 weekdays（0=周日 … 6=周六）');
      row.weekdays = days;
    }
  }
  row.next_run_at = computeNextRun(row, now).toISOString();
  return row;
}

// 人类可读的频率描述（前端列表与模型回复共用）。
function describeSchedule(task) {
  var kind = task.schedule_kind;
  if (kind === 'once') return '单次 · ' + String(task.run_at || '').replace('T', ' ').slice(0, 16);
  if (kind === 'interval') {
    var m = task.interval_minutes;
    if (m % 1440 === 0) return '每 ' + (m / 1440) + ' 天一次';
    if (m % 60 === 0) return '每 ' + (m / 60) + ' 小时一次';
    return '每 ' + m + ' 分钟一次';
  }
  if (kind === 'daily') return '每天 ' + task.daily_time;
  if (kind === 'weekly') return '每' + (task.weekdays || []).map(function(d) { return WEEKDAY_CN[d]; }).join('、') + ' ' + task.daily_time;
  return kind;
}

// 常驻调度器：扫描到点任务 → 原子抢占（避免多实例/重复执行）→ 执行 → 回写结果。
function createScheduler(opts) {
  opts = opts || {};
  var supabase = opts.supabase;
  var runTask = opts.runTask;
  var logger = opts.logger || console;
  var intervalMs = opts.intervalMs || 30000;
  var nowFn = opts.now || function() { return new Date(); };
  var timer = null, running = false, stopped = false;
  // ★ 2026-11-14：表未创建 / DB 抖动时避免每 30 秒刷同一条告警，只在错误变化时打一次。
  var lastQueryError = '';

  async function tick() {
    if (running) return { ran: 0, skipped: 'busy' };
    running = true;
    var ran = 0;
    try {
      var now = nowFn();
      var due = await supabase.from('ai_scheduled_tasks').select('*')
        .eq('enabled', true).lte('next_run_at', now.toISOString())
        .order('next_run_at', { ascending: true }).limit(20);
      if (due.error) {
        var qmsg = String(due.error.message || due.error);
        if (qmsg !== lastQueryError) {
          lastQueryError = qmsg;
          logger.warn('[scheduler] 查询到点任务失败（同类错误只提示一次）:', qmsg);
        }
        return { ran: 0, error: qmsg };
      }
      lastQueryError = '';
      var rows = due.data || [];
      for (var i = 0; i < rows.length; i++) {
        var task = rows[i];
        var next;
        try { next = computeNextRun(task, now); }
        catch (e) {
          await supabase.from('ai_scheduled_tasks').update({ enabled: false, last_status: 'error', last_error: String(e.message).slice(0, 300) }).eq('id', task.id);
          continue;
        }
        // 原子抢占：仅当 next_run_at 仍是扫描时的值才更新，其他实例/重复 tick 不会重复执行。
        var claim = await supabase.from('ai_scheduled_tasks').update({
          next_run_at: next ? next.toISOString() : null,
          enabled: next ? true : false,
          last_run_at: now.toISOString(),
          updated_at: now.toISOString()
        }).eq('id', task.id).eq('next_run_at', task.next_run_at).select('id');
        if (claim.error || !claim.data || !claim.data.length) continue;
        ran++;
        try {
          var result = await runTask(task) || {};
          await supabase.from('ai_scheduled_tasks').update({
            last_status: 'success', last_error: null,
            last_summary: String(result.summary || '').slice(0, 2000),
            conversation_id: result.conversation_id || task.conversation_id,
            updated_at: nowFn().toISOString()
          }).eq('id', task.id);
        } catch (e) {
          logger.warn('[scheduler] 任务执行失败', task.id, e && e.message);
          await supabase.from('ai_scheduled_tasks').update({
            last_status: 'error', last_error: String((e && e.message) || e).slice(0, 500),
            updated_at: nowFn().toISOString()
          }).eq('id', task.id);
        }
      }
      return { ran: ran };
    } finally { running = false; }
  }

  return {
    tick: tick,
    start: function() {
      if (timer || stopped) return;
      timer = setInterval(function() {
        tick().catch(function(e) { logger.warn('[scheduler] tick 异常:', e && e.message); });
      }, intervalMs);
      if (timer.unref) timer.unref(); // 不阻止进程退出 / 测试收尾
      tick().catch(function() {});
    },
    stop: function() { stopped = true; if (timer) clearInterval(timer); timer = null; }
  };
}

module.exports = {
  SCHEDULE_KINDS: SCHEDULE_KINDS,
  zonedParts: zonedParts,
  zonedTimeToUtc: zonedTimeToUtc,
  computeNextRun: computeNextRun,
  normalizeTaskInput: normalizeTaskInput,
  describeSchedule: describeSchedule,
  createScheduler: createScheduler
};
