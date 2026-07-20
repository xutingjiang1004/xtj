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
  const detail = between(core, 'async function loadDockChatMessages(userName, forceScroll)', 'function renderDockMessages');
  assert.match(detail, /loadSeq\s*=\s*\+\+_dockChatLoadSeq/);
  assert.match(detail, /loadSeq !== _dockChatLoadSeq \|\| dockChatActiveUser !== userName/);
  assert.match(detail, /requestController/);
  assert.match(detail, /12000/);
  assert.match(detail, /querySelector\('\.chat-load-retry'\)[\s\S]*previousRetry\.remove\(\)/);
});

test('opening a chat does not immediately duplicate the detail request through polling', () => {
  const openChat = between(core, 'window.openChat = function(userName)', 'async function loadDockChatList()');
  assert.match(openChat, /startDMPolling\(60000, true\)/);
  assert.match(core, /startDMPolling\(300000, !!\(options && options\.source === 'openChat'\)\)/);
});
