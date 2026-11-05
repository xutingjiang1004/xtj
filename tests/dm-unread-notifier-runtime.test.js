'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../render-api/server.js'), 'utf8');

// 最小的 PostgREST 查询构造器：按 eq/lt/like/not(like) 在内存里过滤，再 order + limit。
function fakeSupabase(rows) {
  function like(value, pattern) {
    const re = new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 's');
    return re.test(String(value));
  }
  function builder() {
    const filters = [];
    let order = null, max = Infinity, mode = 'select';
    const api = {
      select() { return api; },
      eq(col, val) { filters.push(r => r[col] === val); return api; },
      lt(col, val) { filters.push(r => r[col] < val); return api; },
      like(col, pat) { filters.push(r => like(r[col], pat)); return api; },
      not(col, op, pat) { assert.equal(op, 'like', 'fake only supports not like'); filters.push(r => !like(r[col], pat)); return api; },
      order(col, opts) { order = { col, asc: !opts || opts.ascending !== false }; return api; },
      limit(n) { max = n; return api; },
      update() { mode = 'update'; return api; },
      then(resolve, reject) {
        try {
          let out = rows.filter(r => filters.every(f => f(r)));
          if (mode === 'update') return resolve({ data: null, error: null });
          if (order) out = out.slice().sort((a, b) => (a[order.col] < b[order.col] ? -1 : 1) * (order.asc ? 1 : -1));
          return resolve({ data: out.slice(0, max), error: null });
        } catch (e) { return reject(e); }
      }
    };
    return api;
  }
  return { from() { return builder(); } };
}

function loadNotifier(rows, sent, hold) {
  const start = source.indexOf('var dmUnreadNotifyBusy = false;');
  const end = source.indexOf('function startDmUnreadNotifier()', start);
  assert.ok(start > 0 && end > start, 'notifier source should exist');
  const context = {
    GMAIL_USER: 'robot@example.test', GMAIL_APP_PASSWORD: 'x', ADMIN_DM_NOTIFY_EMAIL: 'admin@example.test', ADMIN_DM_NOTIFY_USER: 'xxz',
    DM_MARKER: '__dm__', DM_UNREAD_NOTIFY_TIMEOUT: 600000, dmUnreadNotifiedIds: new Set(),
    supabase: fakeSupabase(rows),
    getMailTransporter: () => ({ sendMail: async mail => { sent.push(mail); if (hold) await hold; } }),
    escapeHtml: s => String(s), console: { log() {}, error() {}, warn() {} }, Date, JSON, Set, Array
  };
  return vm.runInNewContext('(function(){' + source.slice(start, end) + '; return checkUnreadDmForAdmin;})()', context);
}

function dm(id, minutesAgo, payload) {
  return { id, user_name: 'alice', media_type: '__dm__', media_url: 'xxz', views: payload && payload.read_at ? 1 : 0, created_at: new Date(Date.now() - minutesAgo * 60000).toISOString(), content: JSON.stringify(payload) };
}

test('管理员的已读私信积累超过 50 条后，新的未读私信仍会触发邮件提醒', async () => {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push(dm('read-' + i, 5000 - i, { text: 'old ' + i, read_at: '2026-10-01T00:00:00.000Z' }));
  rows.push(dm('fresh-unread', 30, { text: '新的未读消息', read_at: null }));
  const sent = [];
  await loadNotifier(rows, sent)();
  assert.equal(sent.length, 1, '最新的未读私信必须被查到并发出提醒');
  assert.match(sent[0].html, /新的未读消息/);
});

test('已提醒过的未读私信不会重复发邮件', async () => {
  const rows = [dm('notified', 30, { text: 'ping', read_at: null, dm_notified_at: '2026-11-04T00:00:00.000Z' })];
  const sent = [];
  await loadNotifier(rows, sent)();
  assert.equal(sent.length, 0);
});

test('上一轮检查尚未结束时，下一轮不会并发重复发信', async () => {
  const rows = [dm('slow', 30, { text: 'slow mail', read_at: null })];
  const sent = [];
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const run = loadNotifier(rows, sent, hold);
  const first = run();
  await new Promise(r => setImmediate(r));
  const second = run();
  await new Promise(r => setImmediate(r));
  release();
  await Promise.all([first, second]);
  assert.equal(sent.length, 1, 'SMTP 慢于轮询间隔时同一封提醒不能发两遍');
});
