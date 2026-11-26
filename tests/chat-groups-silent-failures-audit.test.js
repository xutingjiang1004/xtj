// F-M4：群聊三处失败静默吞掉 —— fetchNewer / fetchOlder / markRead。
// 之前：fetchNewer 与 fetchOlder 是 catch(_){}，markRead 先清角标、POST
// 失败用 .catch(function(){}) 空吞。私聊子项复核已证实失实（06 里重试
// 按钮一直存在），本文件只钉群聊三处。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const src = fs.readFileSync('js/chat-groups.js', 'utf8');

function fnBody(anchor, nextAnchor) {
  const start = src.indexOf(anchor);
  assert.ok(start > 0, '找不到锚点: ' + anchor);
  const end = nextAnchor ? src.indexOf(nextAnchor, start) : src.length;
  assert.ok(end > start, '找不到结束锚点: ' + nextAnchor);
  return src.slice(start, end);
}

test('F-M4: fetchNewer 失败不再静默，记日志并节流提示', () => {
  const body = fnBody('  async function fetchNewer(conv) {', '  async function fetchOlder(conv) {');
  assert.ok(!/catch \(_\) \{\s*\}/.test(body), 'fetchNewer 仍有空 catch');
  assert.match(body, /console\.warn\('\[group\] fetchNewer failed:/, '失败必须记日志');
  assert.match(body, /fetchFailedToastAt/, '离线连续失败时提示必须节流，不能每轮都弹');
  assert.match(body, /toast\('群消息同步失败，稍后自动重试'\)/, '必须给用户一次可见提示');
});

test('F-M4: fetchOlder 失败给出重试入口，成功前不隐藏槽位', () => {
  const body = fnBody('  async function fetchOlder(conv) {', '  function markRead(conv) {');
  assert.ok(!/catch \(_\) \{\s*\}/.test(body), 'fetchOlder 仍有空 catch');
  assert.match(body, /console\.warn\('\[group\] fetchOlder failed:/, '失败必须记日志');
  assert.match(body, /data-grp="retry-older"/, '失败后必须在 older 槽位放重试按钮');
  assert.match(body, /showRetry/, '失败时 finally 不得直接隐藏槽位把重试按钮盖掉');
  assert.match(body, /grp-spinner/, '下一次拉取必须先恢复 spinner');
  const handler = fnBody("else if (what === 'retry' && conv) fetchLatest(conv);", "if (event.target.closest('#groupAnnounceBar'))");
  assert.match(handler, /retry-older.*fetchOlder\(conv\)/, '委托点击必须把 retry-older 路由到 fetchOlder');
});

test('F-M4: markRead 失败补发一次，再失败用列表刷新纠正角标', () => {
  const body = fnBody('  function markRead(conv) {', '  // ---- rendering');
  assert.ok(!/\.catch\(function \(\) \{\}\)/.test(body), 'markRead 仍有空 catch');
  assert.match(body, /console\.warn\('\[group\] mark_read failed:/, '失败必须记日志');
  assert.match(body, /5000/, '失败后 5 秒补发一次');
  assert.match(body, /scheduleListRefresh\(0\)/, '补发再失败必须刷新列表，让角标回到服务端真实值');
  assert.match(body, /group\.unread = 0/, '乐观清角标的即时体验保持不变');
});
