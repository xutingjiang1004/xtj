'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('js/core-parts/06-chat-and-nav.js', 'utf8');
const start = source.indexOf('var CHAT_TIME_SEP_GAP_MS'), end = source.indexOf('function renderDockMessages(');
assert.ok(start > 0 && end > start, 'time separator helpers must sit before renderDockMessages');
const NOW = new Date(2026, 10, 1, 15, 0, 0); // Sun 1 Nov 2026, local time
class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); } }
function node(tag) {
  const attrs = {}, children = [];
  return { tag, className: '', textContent: '', children, attrs, appendChild(child) { children.push(child); this.firstChild = children[0]; return child; },
    setAttribute(k, v) { attrs[k] = v; }, getAttribute(k) { return attrs[k]; } };
}
const context = { Date: FakeDate, String, isFinite, isNaN, document: { createElement: node } };
vm.runInNewContext(source.slice(start, end) + '\nthis.fmt=formatChatSeparatorTime;this.need=chatNeedsTimeSeparator;this.make=getChatTimeSeparatorNode;', context);
const at = (...a) => new Date(...a).getTime();
test('labels read like iMessage: today, yesterday, weekday, date, year', () => {
  assert.equal(context.fmt(at(2026, 10, 1, 12, 37)), '今天 12:37');
  assert.equal(context.fmt(at(2026, 9, 31, 20, 5)), '昨天 20:05');
  assert.equal(context.fmt(at(2026, 9, 28, 9, 0)), '周三 09:00');
  assert.equal(context.fmt(at(2026, 9, 10, 8, 30)), '10月10日 08:30');
  assert.equal(context.fmt(at(2025, 11, 24, 23, 59)), '2025年12月24日 23:59');
  assert.equal(context.fmt(NaN), '');
});
test('a divider appears first, after a five minute pause and when the day changes', () => {
  const t = at(2026, 10, 1, 10, 0);
  assert.equal(context.need(t, 0), true, 'first message of the conversation');
  assert.equal(context.need(t + 4 * 60000, t), false, 'a quick reply stays in the same group');
  assert.equal(context.need(t + 5 * 60000, t), true, 'five minutes of silence starts a new group');
  assert.equal(context.need(at(2026, 10, 2, 0, 1), at(2026, 10, 1, 23, 59)), true, 'midnight starts a new group even after one minute');
  assert.equal(context.need(NaN, t), false, 'unparseable time never produces an empty divider');
});
test('an existing divider node is reused instead of rebuilt', () => {
  const stamp = at(2026, 10, 1, 12, 37), pool = {};
  const first = context.make(stamp, pool);
  assert.equal(first.className, 'chat-time-sep');
  assert.equal(first.attrs.role, 'separator');
  assert.equal(first.firstChild.textContent, '今天 12:37');
  pool[String(stamp)] = first;
  const again = context.make(stamp, pool);
  assert.equal(again, first); assert.equal(Object.keys(pool).length, 0, 'a used node leaves the pool so leftovers can be removed');
});
test('the renderer inserts dividers into the ordered nodes before reusing or rebuilding a row', () => {
  const loop = source.indexOf('msgs.forEach(function(message, index) {', source.indexOf('var existingTimeSeps'));
  const body = source.slice(loop, loop + 600);
  assert.match(body, /chatNeedsTimeSeparator\(messageStamp, previousMessageStamp\)\) orderedNodes\.push\(getChatTimeSeparatorNode/);
  assert.ok(body.indexOf('orderedNodes.push(getChatTimeSeparatorNode') < body.indexOf('getDockChatRowKey(message, index)'), 'divider goes in before the row that starts the group');
});
