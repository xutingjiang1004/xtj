'use strict';
// 第二轮审计 额-2 / 额-4：额度面板显示假默认值；多来源 quota 互洗。
// 额-2：S.quota 为 null（从来没拉到真实额度）时，renderQuotaUI 用
//   defaultQuotaShape() 渲染 0/100k、0/1M、0/10——用户发了消息也永远
//   是 0%。修复：没数据时显示“加载中”，并触发一次重拉。
// 额-4：applyQuota 旧写法 Object.assign(默认, 新) 会把新来源没带的字段
//   洗回默认值（“无限”被有限覆盖）。修复：默认 → 旧值 → 新值 三层合并，
//   新来源显式 null/undefined 的字段不参与合并。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');

test('额-2: S.quota 为 null 时 renderQuotaUI 显示加载中，不用假默认值', () => {
  const idx = src.indexOf('function renderQuotaUI()');
  assert.ok(idx >= 0, '应有 renderQuotaUI');
  const head = src.slice(idx, idx + 2200);
  assert.ok(!head.includes('var q = S.quota || defaultQuotaShape();'),
    '不得再用默认占位形状冒充真实额度');
  assert.ok(head.includes('if (!S.quota)'), 'null 额度应走加载态分支');
  assert.ok(head.includes('5小时: 加载中'), 'token 文案应显示加载中');
  assert.ok(head.includes('网页搜索：加载中'), '搜索行应显示加载中');
  assert.ok(head.includes('fetchAiQuota(false)'), '没数据时应触发一次重拉');
});

test('额-4: applyQuota 三层合并，缺失字段沿用旧值', () => {
  const idx = src.indexOf('function applyQuota(quota');
  assert.ok(idx >= 0, '应有 applyQuota');
  const body = src.slice(idx, idx + 1400);
  assert.ok(!/S\.quota = Object\.assign\(defaultQuotaShape\(\), quota\)/.test(body),
    '不得再用“默认+新”两层合并洗掉旧值');
  assert.ok(body.includes('Object.assign(defaultQuotaShape(), _prevQuota || {})'),
    '应先以默认形状打底，再叠旧值');
  assert.ok(body.includes('quota[k] !== null && quota[k] !== undefined'),
    '新来源显式 null/undefined 的字段不参与合并');
});
