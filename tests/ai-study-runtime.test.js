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

test('word-passage rules are part of the prompt', () => {
  const prompt = buildStudyPrompt({ exam: 'cet4' });
  for (const part of ['单词短文', '提取图片里的全部英文单词', '不要猜', '自然的英文短文', '四级约 250–350 词', '雅思约 400–600 词', '答案与解析', '导出 PDF']) assert.ok(prompt.includes(part), part);
});

test('synced learning data is cleaned before it is stored with the account', () => {
  const { cleanStudyPrefs } = require('../render-api/ai-study');
  assert.equal(cleanStudyPrefs(null), null);
  assert.equal(cleanStudyPrefs('x'), null);
  const clean = cleanStudyPrefs({
    profile: { exam: 'other', exam_other: '专四', textbook: 't'.repeat(200), hack: 1 },
    convs: ['ABCDEF1', 'bad id', 'ABCDEF1', 7, 'x', ...Array.from({ length: 400 }, (_, i) => 'CONV' + String(i).padStart(4, '0'))],
    reading: { level: 'gre', count: 99 }, updated_at: 'soon', extra: true
  });
  assert.deepEqual(Object.keys(clean).sort(), ['convs', 'profile', 'reading', 'updated_at']);
  assert.equal(clean.profile.exam, 'other'); assert.equal(clean.profile.exam_other, '专四'); assert.equal(clean.profile.textbook.length, 80);
  assert.equal(clean.convs.length, 300); assert.ok(!clean.convs.includes('bad id')); assert.equal(new Set(clean.convs).size, 300);
  assert.deepEqual(clean.reading, { level: '', count: 5 }); assert.equal(clean.updated_at, 0);
  assert.deepEqual(cleanStudyPrefs({ reading: { level: 'ielts', count: 8 }, updated_at: 1234.9 }).reading, { level: 'ielts', count: 8 });
  const server = fs.readFileSync(path.join(__dirname, '../render-api/server.js'), 'utf8');
  assert.match(server, /var studyPrefs = require\('\.\/ai-study'\)\.cleanStudyPrefs\(input\.study\);\s*if \(studyPrefs\) out\.study = studyPrefs;/);
});

test('the study PDF layout has no cover page and tidies tables, bullets and inline marks', async () => {
  const { buildReportPdf, studyLine } = require('../render-api/ai-report-export');
  assert.equal(studyLine('| harbour | n. | 港口 |'), 'harbour    n.    港口');
  assert.equal(studyLine('- the *quiet* `bay`'), '• the quiet bay');
  assert.equal(studyLine('2 * 3 = 6'), '2 * 3 = 6');
  const answer = '## Passage\n\nThe **harbour** was quiet.\n\n## 答案与解析\n\n1. A';
  const study = await buildReportPdf({ layout: 'study', title: '学习笔记', answer, sources: [] });
  const report = await buildReportPdf({ title: '学习笔记', answer, sources: [] });
  assert.equal(study.subarray(0, 5).toString(), '%PDF-');
  const pages = buffer => (buffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
  assert.equal(pages(study), 1); assert.equal(pages(report), 2, 'the research layout keeps its cover page');
});
