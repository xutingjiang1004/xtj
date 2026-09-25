'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('chat list ignores stale responses and keeps one retry control', () => {
  const list = between(core, 'async function loadDockChatList()', 'function hydrateDockChatAvatars');
  assert.match(list, /listLoadSeq\s*=\s*\+\+_dockChatListLoadSeq/);
  assert.match(list, /if \(listLoadSeq !== _dockChatListLoadSeq\) return/);
  assert.match(list, /querySelector\('\.chat-load-retry'\)[\s\S]*previousRetry\.remove\(\)/);
});

test('chat detail ignores stale conversations and deduplicates retry controls', () => {
  // ★ 2026-09-25：签名新增 muteLoadingSkeleton（轮询/后台刷新不得重绘 loading 骨架）。
  const detail = between(core, 'async function loadDockChatMessages(userName, forceScroll, muteLoadingSkeleton)', 'function renderDockMessages');
  assert.match(detail, /loadSeq\s*=\s*\+\+_dockChatLoadSeq/);
  assert.match(detail, /loadSeq !== _dockChatLoadSeq \|\| dockChatActiveUser !== userName/);
  assert.match(detail, /requestController/);
  assert.match(detail, /12000/);
  assert.match(detail, /querySelector\('\.chat-load-retry'\)[\s\S]*previousRetry\.remove\(\)/);
});

// ★ 2026-09-25 回归测试：右键/长按操作菜单曾经**完全打不开**。
//   根因是 data-msg-key 挂在 .chat-msg-row 上（见 renderDockMessages 的
//   querySelectorAll('.chat-msg-row[data-msg-key]')），而 findDockMessageByRow
//   却从事件目标 closest('.chat-msg') 拿到的气泡上读，永远读到空串 → 恒返 null →
//   openDockMessageActions 静默 return。这条断言把该不变量钉住。
test('bubble action menu resolves the message from the row that owns data-msg-key', () => {
  const finder = between(core, 'function findDockMessageByRow(rowEl)', 'function buildDockMessageActions');
  assert.match(finder, /closest\('\.chat-msg-row'\)/, 'must normalise the bubble up to .chat-msg-row before reading the key');
  assert.match(finder, /getAttribute\('data-msg-key'\)/, 'must read data-msg-key from the row');
  assert.match(finder, /__tempId/, 'must keep the optimistic-message fallback');
  const bind = between(core, 'function bindDockChatMessageActions()', 'function showDockChatFilePreview');
  assert.match(bind, /addEventListener\('contextmenu'/, 'desktop right-click must open the menu');
  assert.match(bind, /closest\('\.chat-msg-row'\)/, 'right-click hit area is the whole row');
  assert.match(bind, /openDockMessageActions\(row\)/, 'right-click must actually open the action sheet');
});

test('opening a chat does not immediately duplicate the detail request through polling', () => {
  const openChat = between(core, 'window.openChat = function(userName)', 'async function loadDockChatList()');
  assert.match(openChat, /startDMPolling\(60000, true\)/);
  assert.match(core, /startDMPolling\(300000, !!\(options && options\.source === 'openChat'\)\)/);
});
