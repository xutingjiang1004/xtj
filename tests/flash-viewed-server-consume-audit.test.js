// F-L6：审计原文称「闪图已看靠本机记录」。核查后该前提已不成立：
// 服务端 /api/chat/flash/open 在图片字节发出（res finish）时就强制调
// dm_flash_viewed 标记消费，不再依赖客户端回调 /viewed；本机记录
// （xtj_flash_receipts_*/_flashConsumed）只是按钮置灰与“已查看”提示
// 的前置过滤，不是防重复查看的关卡。无需改代码，此测试锁定该行为，
// 防止以后有人把消费又改回只靠客户端回调。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('render-api/flash-photos.js', 'utf8');
const chat = fs.readFileSync('js/core-parts/06-chat-and-nav.js', 'utf8');

test('F-L6: 服务端发出闪图字节时必须强制消费，不靠客户端回调', () => {
  assert.match(server, /不再依赖客户端回调 \/viewed/,
    '服务端单次查看修复的说明注释不得删');
  const openIdx = server.indexOf("router.post('/api/chat/flash/open'");
  assert.ok(openIdx > 0, '找不到 /api/chat/flash/open');
  const openBody = server.slice(openIdx, server.indexOf("router.post('/api/chat/flash/viewed'", openIdx));
  assert.match(openBody, /res\.once\('finish',\(\)=>\{[\s\S]*?dm_flash_viewed/,
    'open 必须在 res finish 时调 dm_flash_viewed 强制消费');
  assert.match(openBody, /claim\.role!=='recipient'/,
    '强制消费只针对收件人，发送者预览永不消费');
});

test('F-L6: 客户端查看必先走服务端 open，本机记录只是前置过滤', () => {
  assert.match(chat, /window\.xtjProtectedFetch\('\/api\/chat\/flash\/open'/,
    '打开闪图必须先调服务端 /api/chat/flash/open');
  const openIdx = chat.indexOf('window.openChatFlash=async function(id){');
  assert.ok(openIdx > 0, '找不到 openChatFlash');
  const body = chat.slice(openIdx, openIdx + 6000);
  assert.match(body, /if\(flashLocallyViewed\(currentUser,id\)\)\{showToast\('闪图已查看'\);retryFlashReceipts\(\);return;\}/,
    '本机记录仍只作前置过滤：已看过就提示并重试未确认的回执，不直接放行图片');
});
