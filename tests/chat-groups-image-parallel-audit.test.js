// F-M8：群聊图片串行发送 —— 之前 9 张图 for 循环 await deliverImage，
// 总耗时是单张之和。现在最多 3 路并行；失败仍由 deliverImage 内 catch
// 调 failLocal 单张标记，不阻塞其他图。
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

test('F-M8: 多图不再串行上传，并发有上限', () => {
  const body = fnBody('  async function sendImages(files) {', '  async function deliverImage(conv, msg, file, replyId) {');
  assert.ok(!/await deliverImage\(/.test(body), 'sendImages 里仍有串行 await deliverImage');
  assert.match(body, /inFlight < 3/, '并发必须有上限，不能 9 张全并行冲垮弱网');
  assert.match(body, /queue\.push\(/, '待传任务必须进队列，由 pump 按槽位放行');
  assert.match(body, /await drained/, '必须等全部传完再返回');
});

test('F-M8: 气泡仍按原顺序建，切走会话时后面的图不再建气泡', () => {
  const body = fnBody('  async function sendImages(files) {', '  async function deliverImage(conv, msg, file, replyId) {');
  assert.ok(body.indexOf('addLocal(conv, msg)') < body.indexOf('queue.push('),
    '本地气泡必须先于入队创建，保证显示顺序与选择顺序一致');
  assert.match(body, /if \(state\.active !== conv\)/, '切走会话必须停下，不再建后面图片的气泡');
  assert.match(body, /stopped = true/, '切走后排队的任务不得继续放行');
});

test('F-M8: 单张失败仍只标记自己，不阻塞其他图；类型/大小校验不变', () => {
  const send = fnBody('  async function sendImages(files) {', '  async function deliverImage(conv, msg, file, replyId) {');
  assert.match(send, /目前群聊只支持发送 PNG\/JPG\/GIF\/WebP 图片/, '类型校验不得丢');
  assert.match(send, /图片太大了/, '40MB 校验不得丢');
  const deliver = fnBody('  async function deliverImage(conv, msg, file, replyId) {', '  function retryLocal(conv, id) {');
  assert.match(deliver, /catch \(error\) \{ failLocal\(conv, msg, error/, '单张失败仍走 failLocal 标记，不抛到队列里');
  assert.match(deliver, /prepareImage\(file\)/, '压缩/转码仍在上传前做');
});
