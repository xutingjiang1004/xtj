'use strict';
// 学习模式的服务端部分：清洗浏览器传来的学习资料，并生成追加的系统提示词。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { cleanStudyProfile, buildStudyPrompt } = require('../render-api/ai-study');

test('requests without a study object get no extra prompt', () => {
  for (const value of [undefined, null, '', 'ielts', 1, true, []]) {
    assert.equal(cleanStudyProfile(value), null);
    assert.equal(buildStudyPrompt(value), '');
  }
});

test('the profile is trimmed, capped and limited to known choices', () => {
  const clean = cleanStudyProfile({ exam: 'drop table', style: 'shout', textbook: '  剑桥雅思\n初级教程\u0000（新东方） ', unit: 'x'.repeat(500), note: 'n'.repeat(900), target: 6.5, extra: 'ignored' });
  assert.deepEqual(Object.keys(clean).sort(), ['exam', 'exam_other', 'note', 'style', 'target', 'textbook', 'unit']);
  assert.equal(clean.exam, ''); assert.equal(clean.style, 'detailed');
  assert.equal(clean.textbook, '剑桥雅思 初级教程 （新东方）');
  assert.equal(clean.unit.length, 60); assert.equal(clean.note.length, 300); assert.equal(clean.target, '6.5');
});

test('the prompt carries the learner profile, the answer order and the honesty rules', () => {
  const prompt = buildStudyPrompt({ exam: 'ielts', target: '6.5', textbook: '剑桥雅思初级教程（新东方）', unit: '第 1 单元', style: 'guided', note: '基础弱' });
  for (const part of ['【学习模式】', '雅思（IELTS），目标 6.5', '剑桥雅思初级教程（新东方）', '第 1 单元', '基础弱', '先引导后揭晓', '【考点】', '【思路】', '【答案】', '不要编造教材的页码', '看不清']) {
    assert.ok(prompt.includes(part), part);
  }
  const empty = buildStudyPrompt({});
  assert.ok(empty.includes('还没有填写学习资料'));
  assert.ok(empty.includes('讲解要详细'));
  assert.ok(buildStudyPrompt({ exam_other: '专四' }).includes('备考目标：专四'));
});

test('both chat routes add the study prompt as a system message', () => {
  const server = fs.readFileSync(path.join(__dirname, '../render-api/server.js'), 'utf8');
  assert.match(server, /require\('\.\/ai-study'\)\.buildStudyPrompt\(req\.body && req\.body\.study\);\s*if \(studyPrompt\) messages\.push\(\{ role: 'system', content: studyPrompt \}\);/);
  assert.match(server, /require\('\.\/ai-study'\)\.buildStudyPrompt\(body\.study\);\s*if \(customStudyPrompt\) conversation\.splice\(1, 0, \{ role: 'system', content: customStudyPrompt \}\);/);
});
