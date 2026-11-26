'use strict';
// 第二轮审计 额-7（低）：render-api/ai-quota.js 两处无害死代码。
// (1) getModelTokenMultiplier 首行 return 后还有 3 行不可达代码；
// (2) computeBillableTokens 里 var total 声明了两次（var 重声明无害，
//   但第二行是纯重复）。删除后行为完全一致。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'render-api', 'ai-quota.js'), 'utf8');

test('额-7: getModelTokenMultiplier 不再有 return 后的不可达代码', () => {
  const fn = src.slice(src.indexOf('function getModelTokenMultiplier'), src.indexOf('function limits()'));
  assert.ok(fn.includes("return /pro/i.test(String(model || '')) ? V4_PRO_TOKEN_MULTIPLIER : 1;"),
    '应保留原有的 pro 判定返回');
  assert.ok(!fn.includes("var m = String(model || '').toLowerCase();"), '不可达的 var m 应删除');
  assert.ok(!fn.includes("m.indexOf('pro')"), '不可达的 pro 分支应删除');
});

test('额-7: computeBillableTokens 的 var total 只声明一次', () => {
  const count = (src.match(/var total = Math\.max\(0, Math\.floor\(Number\(usage\.total_tokens\) \|\| 0\)\);/g) || []).length;
  assert.equal(count, 1, 'var total 应只出现一次，实际 ' + count + ' 次');
});

test('额-7: 删死代码后模块仍可加载且行为不变', () => {
  const quota = require(path.join(root, 'render-api', 'ai-quota.js'));
  assert.equal(typeof quota.getModelTokenMultiplier, 'function');
  assert.equal(quota.getModelTokenMultiplier('gpt-pro'), 3);
  assert.equal(quota.getModelTokenMultiplier('flash'), 1);
  assert.equal(quota.computeBillableTokens({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, { model: 'flash' }), 15);
});
