const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const shell = fs.readFileSync('js/desktop-shell.js', 'utf8');

test('dblclick handler exists for desktop nav items', () => {
  assert.match(shell, /dblclick/);
  assert.match(shell, /data-desktop-tab/);
});

test('refreshTab function exists with in-flight lock', () => {
  assert.match(shell, /var _refreshLocks = \{\}/);
  assert.match(shell, /function refreshTab\(tab\)/);
  assert.match(shell, /_refreshLocks\[tab\]/);
});

test('posts tab refresh calls loadFeed with force=true', () => {
  assert.match(shell, /case 'posts':/);
  assert.match(shell, /window\.loadFeed\(true\)/);
});

test('chat tab refresh refreshes contacts, unread, and current chat', () => {
  assert.match(shell, /case 'chat':/);
  assert.match(shell, /updateUnreadBadge/);
  assert.match(shell, /startDMPolling/);
  assert.match(shell, /loadDockChatMessages/);
});

test('ai tab refresh keeps session content, refreshes session list and config', () => {
  assert.match(shell, /case 'ai':/);
  assert.match(shell, /__xtjRefreshAiSession/);
  assert.match(shell, /__xtjRefreshAiConfig/);
});

test('photos tab refresh calls force sync', () => {
  assert.match(shell, /case 'photos':/);
  assert.match(shell, /__xtjPhotoWallForceSync/);
});

test('profile tab refresh refreshes profile, avatar, and stats', () => {
  assert.match(shell, /case 'profile':/);
  assert.match(shell, /loadCurrentUserInfoSnapshot/);
  assert.match(shell, /renderProfileActivity/);
});

test('double-click only triggers on active tab', () => {
  assert.match(shell, /classList\.contains\('is-active'\)/);
});

test('no location.reload() in refresh handlers', () => {
  // P0: location.reload() is only allowed in renderErrorPage (damaged state refresh button),
  // NOT in refreshTab or performRefresh handlers
  var refreshFn = shell.match(/function performRefresh[\s\S]*?(?=function \w+)/);
  assert.ok(refreshFn, 'performRefresh function should exist');
  assert.ok(!/location\.reload/.test(refreshFn[0]), 'performRefresh should NOT use location.reload');
  var refreshTabFn = shell.match(/function refreshTab[\s\S]*?(?=function \w+)/);
  assert.ok(refreshTabFn, 'refreshTab function should exist');
  assert.ok(!/location\.reload/.test(refreshTabFn[0]), 'refreshTab should NOT use location.reload');
});

test('refresh provides toast feedback', () => {
  assert.match(shell, /showToast\('正在刷新/);
});

test('in-flight lock prevents concurrent refreshes', () => {
  assert.match(shell, /_refreshLocks\[tab\] = performRefresh/);
  assert.match(shell, /delete _refreshLocks\[tab\]/);
});

test('click handler still works for tab switching', () => {
  assert.match(shell, /addEventListener\('click'/);
  assert.match(shell, /openTab\(tab\)/);
});