'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const r=require('../js/ai-core/reading-tools');
test('reading anchors include real turn ID and role without account/session separator collisions',()=>{
  assert.notEqual(r.messageId({client_request_id:'same',role:'user'},0),r.messageId({client_request_id:'same',role:'assistant'},0));
  assert.notEqual(r.positionKey('a:b','c'),r.positionKey('a','b:c'));
  assert.notEqual(r.positionKey('alice','conversation'),r.positionKey('bob','conversation'));
  assert.match(r.messageId({content:'no-id'},7),/^temporary:/);
});
test('light history placeholders estimate actual text wrap with bounded heights and narrower-screen differences',()=>{
  const short=r.estimateHeight({content:'短消息'},390),long=r.estimateHeight({content:'这是测试正文'.repeat(500)},390);
  assert.ok(long>short);assert.ok(r.estimateHeight({content:'段落'.repeat(1000)},320)>r.estimateHeight({content:'段落'.repeat(1000)},1440));
  assert.equal(r.estimateHeight({content:'x'.repeat(1000000)},320),9000);assert.ok(short>=76);
});
