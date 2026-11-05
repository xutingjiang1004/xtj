'use strict';
// requestPinnedHttps（read_web_page / read_zip 等共用）只有 socket 空闲超时：
// 慢速滴灌的站点每隔一会儿发一个字节，连接就一直被占着。这里用注入的假 https 层
// 复现「持续有数据、永不结束」的响应，要求总时限到点后请求被销毁并拒绝。
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { fetchSafeBuffer } = require('../render-api/web-fetch');

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

function installDripper(t) {
  const state = { destroyed: false, timer: null };
  const original = https.request;
  https.request = function (options, onResponse) {
    const request = new EventEmitter();
    request.setTimeout = () => request; // socket 空闲超时：数据一直在来，永远不触发
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = {};
      process.nextTick(() => onResponse(response));
      state.timer = setInterval(() => { if (!state.destroyed) response.emit('data', Buffer.from('x')); }, 5);
    };
    request.destroy = () => { state.destroyed = true; clearInterval(state.timer); };
    return request;
  };
  t.after(() => { https.request = original; clearInterval(state.timer); });
  return state;
}

test('a slow-drip response is cut off by the total deadline and its request destroyed', async t => {
  const state = installDripper(t);
  const started = Date.now();
  await assert.rejects(
    fetchSafeBuffer('https://example.com/slow', { lookupImpl: publicLookup, timeoutMs: 150, maxBytes: 10 * 1024 * 1024 }),
    /超时/
  );
  assert.ok(Date.now() - started < 2000);
  assert.equal(state.destroyed, true);
});
