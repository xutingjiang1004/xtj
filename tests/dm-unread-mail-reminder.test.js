'use strict';
// 未读私信邮件提醒：旧的已读/已提醒消息不能挤占查询窗口，发信期间的已读回执不能被覆盖回去。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('render-api/server.js', 'utf8');

function fixture(rows, { onSend } = {}) {
  const updates = [];
  function table() {
    const checks = [];
    let order = null, cap = Infinity, patch = null;
    const q = {
      select() { return q; },
      eq(k, v) { checks.push(r => r[k] === v); return q; },
      lt(k, v) { checks.push(r => String(r[k]) < String(v)); return q; },
      not(k, op, v) {
        assert.equal(op, 'like');
        const needle = String(v).replace(/%/g, '');
        checks.push(r => !String(r[k] || '').includes(needle.replace(/_/g, '_')));
        return q;
      },
      order(k, o) { order = [k, o.ascending]; return q; },
      limit(n) { cap = n; return q; },
      update(v) { patch = v; return q; },
      then(resolve) {
        let found = rows.filter(r => checks.every(c => c(r)));
        if (patch) {
          found.forEach(r => Object.assign(r, patch));
          updates.push({ count: found.length, patch });
          return resolve({ data: found, error: null });
        }
        if (order) found = found.slice().sort((a, b) => String(a[order[0]]).localeCompare(String(b[order[0]])) * (order[1] ? 1 : -1));
        return resolve({ data: found.slice(0, cap).map(r => Object.assign({}, r)), error: null });
      }
    };
    return q;
  }
  const sent = [];
  const context = vm.createContext({
    console, Date, JSON, String, Array, Set, Object,
    GMAIL_USER: 'sender@example.com', GMAIL_APP_PASSWORD: 'x', ADMIN_DM_NOTIFY_EMAIL: 'admin@example.com', ADMIN_DM_NOTIFY_USER: 'xxz',
    DM_NOTIFY_TIMEOUT: 0, DM_UNREAD_NOTIFY_TIMEOUT: 10 * 60 * 1000, DM_MARKER: '__dm__',
    escapeHtml: x => String(x),
    supabase: { from: table },
    getMailTransporter: () => ({ sendMail: async mail => { sent.push(mail); if (onSend) onSend(); } }),
    dmUnreadNotifiedIds: new Set(), dmUnreadNotifyBusy: false,
  });
  const start = source.indexOf('async function checkUnreadDmForAdmin');
  const end = source.indexOf('function startDmUnreadNotifier', start);
  assert.ok(start > 0 && end > start, 'could not isolate checkUnreadDmForAdmin');
  vm.runInContext(source.slice(start, end), context);
  return { run: () => context.checkUnreadDmForAdmin(), sent, updates };
}

const old = Date.now() - 3 * 3600 * 1000;
function row(n, extra) {
  return Object.assign({
    id: 'id-' + n, user_name: 'bob', media_url: 'xxz', media_type: '__dm__', views: 0,
    content: JSON.stringify({ text: 'message ' + n, read_at: null }), created_at: new Date(old + n * 1000).toISOString()
  }, extra);
}

test('old read messages to the administrator do not starve the reminder of a newer unread one', async () => {
  const rows = [];
  for (let n = 0; n < 60; n++) rows.push(row(n, { views: 1, content: JSON.stringify({ text: 'old ' + n, read_at: '2026-01-01T00:00:00Z' }) }));
  rows.push(row(100));
  const f = fixture(rows);
  await f.run();
  assert.equal(f.sent.length, 1, 'the unread message must still be reported');
  assert.match(f.sent[0].html, /message 100/);
});

test('already reminded messages do not hide newer unread ones and are not reminded twice', async () => {
  const rows = [];
  for (let n = 0; n < 55; n++) rows.push(row(n, { content: JSON.stringify({ text: 'reminded ' + n, read_at: null, dm_notified_at: '2026-01-01T00:00:00Z' }) }));
  rows.push(row(200));
  const f = fixture(rows);
  await f.run();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].html, /message 200/);
  assert.doesNotMatch(f.sent[0].html, /reminded/);
});

test('a read receipt that lands while the mail is being sent is not overwritten by the reminder mark', async () => {
  const rows = [row(1)];
  const f = fixture(rows, { onSend() {
    rows[0].views = 1;
    rows[0].content = JSON.stringify({ text: 'message 1', read_at: '2026-11-05T10:00:00Z' });
  } });
  await f.run();
  assert.equal(f.sent.length, 1);
  assert.equal(JSON.parse(rows[0].content).read_at, '2026-11-05T10:00:00Z', 'read_at must survive');
});
