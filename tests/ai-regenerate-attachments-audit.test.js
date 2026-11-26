'use strict';
// A-M3 回归：“重新生成”静默丢附件。
// 修复前：triggerRegenerate 只把本地 userMsg.attachments 交给 _resendFn；
//   缓存恢复的轮次附件 data_url 已被 sanitizeCacheMsgs 剥掉（只剩
//   data_unavailable 标记），_resendFn 又只看 resendAttachments[0].data_url，
//   不存在就静默跳过——带图提问重新生成时图悄悄没了，用户毫不知情。
// 修复后：重新生成时优先用服务端历史重建附件——先用本地 vision_urls
//   重建，缺失时拉取服务端历史再找该轮次的重建附件；确实找不回时明确
//   提示“原附件图片已无法恢复，将仅按文字重新生成”，不再静默丢图。
//   （“不替换旧答案”未改：服务端没有单轮删除接口，本地删旧答案刷新后
//   会从服务端历史复活，见汇报。）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

function fnBody(name) {
  const idx = src.indexOf('function ' + name + '(');
  assert.ok(idx >= 0, '应有 ' + name);
  // 取到下一个同级 function 声明为止（本文件函数均为顶层 function 声明）
  const next = src.indexOf('\n  function ', idx + 10);
  return src.slice(idx, next >= 0 ? next : idx + 12000);
}

test('A-M3: triggerRegenerate 优先用服务端历史/本地 vision_urls 重建附件', () => {
  const body = fnBody('triggerRegenerate');
  // 附件丢失时走重建路径（本地 vision_urls + 服务端历史）
  assert.ok(body.includes('rebuildRegenerateAttachments('), '附件丢失时应走服务端历史重建');
  assert.ok(body.includes('rebuildAttachmentsFromVisionUrls('), '应先看本地 vision_urls 重建附件');
  // 重建 helper 本身：拉服务端历史、按轮次找重建好的附件
  const rebuildBody = fnBody('rebuildRegenerateAttachments');
  assert.ok(rebuildBody.includes('loadHistory('), '重建时应拉取服务端历史');
  assert.ok(rebuildBody.includes('data_url'), '重建的附件应带 data_url');
});

test('A-M3: 附件确实找不回时明确提示，而不是静默按文字重发', () => {
  const body = fnBody('triggerRegenerate');
  assert.ok(body.includes('无法恢复'), '附件丢失且服务端也无图时应明确提示无法恢复');
  assert.ok(body.includes('仅按文字重新生成'), '提示应说明将仅按文字重新生成');
});

test('A-M3: _resendFn 不再只看第 0 个附件、有图就恢复、无图就提示', () => {
  const idx = src.indexOf('S._resendFn = function');
  assert.ok(idx >= 0, '应有 S._resendFn');
  const body = src.slice(idx, idx + 2500);
  assert.ok(!body.includes('resendAttachments[0] && resendAttachments[0].data_url'), '不应再只凭第 0 个附件决定是否恢复预览');
  assert.ok(body.includes('data_url'), '应过滤出带 data_url 的可用附件恢复预览');
  assert.ok(body.includes('无法恢复'), '附件全丢时 _resendFn 也应提示，而不是静默跳过');
});
