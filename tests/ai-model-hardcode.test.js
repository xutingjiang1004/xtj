'use strict';
// D-L1 回归：模型名硬编码 24 处（只收敛行为相关的重复硬编码）。
// 修复前：行为相关的默认回退三处直接写死 'deepseek-flash'（流式收尾记录
//   实际模型、模型选择器当前值、删除在用自定义模型后的回退）。
// 修复后：三处改用 DEFAULT_AI_MODEL（与别名表/ALLOWED_AI_MODELS 同源）。
// 不动的：别名表与 ALLOWED_AI_MODELS 本身、服务商声明、显示标签与默认值
//   （模型名→中文名映射、选择器选项、标题/描述分支、双模型对比默认对、
//   研究页 flash/pro 三元——拿不准的跳过）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

test('D-L1: 三处行为默认回退改用 DEFAULT_AI_MODEL', () => {
  assert.ok(src.includes("finalModelRef.value = evt.model || DEFAULT_AI_MODEL;"),
    '流式收尾记录实际模型时应回退到 DEFAULT_AI_MODEL');
  assert.ok(src.includes("? (S.selectedModel || DEFAULT_AI_MODEL)"),
    '模型选择器当前值回退应为 DEFAULT_AI_MODEL');
  assert.ok(src.includes('S.selectedModel = DEFAULT_AI_MODEL;'),
    '删除在用自定义模型后的回退应为 DEFAULT_AI_MODEL');
  assert.ok(!src.includes("evt.model || 'deepseek-flash'"), '不应再有 evt.model 的硬编码回退');
  assert.ok(!src.includes("(S.selectedModel || 'deepseek-flash')"), '不应再有 selectedModel 的硬编码回退');
});

test('D-L1: 集中处与显示标签/默认值不动', () => {
  assert.ok(src.includes("var DEFAULT_AI_MODEL = 'deepseek-flash';"), 'DEFAULT_AI_MODEL 定义应保留');
  assert.ok(src.includes("var ALLOWED_AI_MODELS = ['deepseek-flash', 'deepseek-v4-pro'];"), 'ALLOWED_AI_MODELS 应保留');
  assert.ok(src.includes("'deepseek-v4-pro': 'V4 Pro'"), '模型名→中文名显示映射不动');
  assert.ok(src.includes("{ value: 'deepseek-v4-pro', label: 'V4 Pro' }"), '选择器选项不动');
  assert.ok(src.includes("model: dtResearchModel === 'flash' ? DEFAULT_AI_MODEL : 'deepseek-v4-pro'"),
    '研究页 flash/pro 三元拿不准、跳过，保持原样');
});
