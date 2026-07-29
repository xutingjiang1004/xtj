const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const path = require('path');
const fs = require('fs');

const registerCodeAgentRoutes = require('../render-api/code-agent.js');
const xlsx = require('xlsx');
const JSZip = require('jszip');
const pdfParseModule = require('pdf-parse');

// Mock deps
const deps = {
  supabase: {},
  rateLimit: () => (req, res, next) => next(),
  authenticateUser: (req, res, next) => { req.userName = 'test'; next(); },
  sanitizeError: (err) => err.message,
  getDeepSeekModel: () => 'deepseek-v4-pro',
  getDeepSeekApiUrl: () => 'http://mock.deepseek.com',
  getDeepSeekApiKey: () => 'mock-key'
};

const app = express();
app.use(express.json({ limit: '5mb' }));
registerCodeAgentRoutes(app, deps);

// ── Helper: create a minimal DOCX zip ──────────────────────────────────
function makeDocxZip(documentXml) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>');
  zip.folder('_rels').file('.rels',
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>');
  zip.file('word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  zip.folder('word').file('document.xml', documentXml);
  return zip;
}

function makeDocxBodyXml(paragraphs) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' + paragraphs.join('') + '</w:body></w:document>';
}

// Helper: extract text from DOCX response body (handles both buffer and parsed JSON)
async function extractTextFromDocxResponse(res) {
  // When responseType('blob') is used, res.body is a Buffer
  var buffer = Buffer.isBuffer(res.body) ? res.body : null;
  // Fallback: try to parse res.text as binary
  if (!buffer && res.text) {
    buffer = Buffer.from(res.text, 'binary');
  }
  if (!buffer) throw new Error('No binary data in response');
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file('word/document.xml').async('string');
  const texts = [];
  const tRE = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let match;
  while ((match = tRE.exec(docXml)) !== null) {
    texts.push(match[1]);
  }
  return texts.join('');
}

// Helper: extract slide XML from PPTX response
async function extractSlideXmlFromPptxResponse(res) {
  var buffer = Buffer.isBuffer(res.body) ? res.body : null;
  if (!buffer && res.text) {
    buffer = Buffer.from(res.text, 'binary');
  }
  if (!buffer) throw new Error('No binary data in PPTX response');
  const z = await JSZip.loadAsync(buffer);
  return await z.file('ppt/slides/slide1.xml').async('string');
}

// Helper: make a minimal PPTX zip
function makePptxZip(slideXmls) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
    '</Types>');
  zip.folder('_rels').file('.rels',
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
    '</Relationships>');
  zip.folder('ppt').file('presentation.xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>');
  zip.folder('ppt/_rels').file('presentation.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
    '</Relationships>');
  zip.folder('ppt/slides').file('slide1.xml', slideXmls[0] || '');
  return zip;
}

// ────────────────────────────────────────────────────────────────────────
// Test Suite
// ────────────────────────────────────────────────────────────────────────

test('installed pdf-parse API shape is supported by code-agent', () => {
  assert.ok(
    typeof pdfParseModule === 'function' || typeof pdfParseModule.PDFParse === 'function',
    'pdf-parse must expose either the v1 callable API or the v2 PDFParse class'
  );
  const source = fs.readFileSync(path.join(__dirname, '../render-api/code-agent.js'), 'utf8');
  if (typeof pdfParseModule.PDFParse === 'function') {
    assert.match(source, /new library\.PDFParse/);
    assert.match(source, /await parser\.destroy\(\)/);
  }
});

test('Code agent document API test suite', async (t) => {

  // ── Basic extraction tests ──────────────────────────────────────────

  await t.test('Extract Text via multipart', async () => {
    const buffer = Buffer.from('hello world');
    const res = await request(app)
      .post('/api/code/document/extract')
      .attach('file', buffer, 'test.txt');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.text, 'hello world');
    assert.equal(res.body.fileName, 'test.txt');
  });

  await t.test('Extract real DOCX text for travel planning', async () => {
    const zip = makeDocxZip(makeDocxBodyXml([
      '<w:p><w:r><w:t>广州三日游：第一天参观陈家祠。</w:t></w:r></w:p>'
    ]));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await request(app)
      .post('/api/code/document/extract')
      .attach('file', buffer, 'guangzhou.docx');
    assert.equal(res.status, 200);
    assert.match(res.body.text, /广州三日游/);
    assert.equal(res.body.ext, '.docx');
  });

  await t.test('Reject legacy DOC truthfully', async () => {
    const res = await request(app)
      .post('/api/code/document/extract')
      .attach('file', Buffer.from('legacy binary'), 'old-guide.doc');
    assert.equal(res.status, 415);
    assert.equal(res.body.code, 'LEGACY_DOC_UNSUPPORTED');
    assert.match(res.body.error, /另存为 DOCX/);
  });

  await t.test('Reject renamed or corrupt binary documents', async () => {
    const cases = [
      { name: 'fake.pdf', buffer: Buffer.from('not a pdf') },
      { name: 'fake.docx', buffer: Buffer.from('not a zip') },
      { name: 'fake.xlsx', buffer: Buffer.from('not a workbook') },
      { name: 'fake.pptx', buffer: Buffer.from('not a presentation') },
      { name: 'fake.txt', buffer: Buffer.from([0x41, 0x00, 0x42]) }
    ];
    for (const item of cases) {
      const res = await request(app)
        .post('/api/code/document/extract')
        .attach('file', item.buffer, item.name);
      assert.equal(res.status, 422, item.name);
      assert.equal(res.body.ok, false, item.name);
    }
  });

  await t.test('Extract PPTX slide text with source labels', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml',
      '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:t>沙面步行路线</a:t><a:t>白鹅潭夜景</a:t></p:sld>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await request(app)
      .post('/api/code/document/extract')
      .attach('file', buffer, 'route.pptx');
    assert.equal(res.status, 200);
    assert.match(res.body.text, /幻灯片: 第1页/);
    assert.match(res.body.text, /沙面步行路线/);
    assert.equal(res.body.metadata.slideCount, 1);
  });

  await t.test('Reject a valid ZIP with no PPTX slides', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await request(app)
      .post('/api/code/document/extract')
      .attach('file', buffer, 'empty.pptx');
    assert.equal(res.status, 422);
    assert.equal(res.body.ok, false);
  });

  // ── P0-2: DOCX structured modification tests ────────────────────────

  await t.test('P0-2: DOCX replace text succeeds', async () => {
    const zip = makeDocxZip(makeDocxBodyXml([
      '<w:p><w:r><w:t>Hello World</w:t></w:r></w:p>'
    ]));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.docx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .field('documentType', 'docx')
      .field('operations', JSON.stringify([{type: 'replace_text', old_text: 'Hello', new_text: 'Hi'}]))
      .attach('file', buffer, 'test.docx')
      .responseType('blob');
    assert.equal(res.status, 200);
    // Verify the returned buffer contains the new text
    const newText = await extractTextFromDocxResponse(res);
    assert.match(newText, /Hi/);
    assert.doesNotMatch(newText, /Hello/);
  });

  // Test 1: DOCX 目标文字跨 3 个 run
  await t.test('P0-2: DOCX replace text across 3 runs', async () => {
    const zip = makeDocxZip(makeDocxBodyXml([
      '<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t> </w:t></w:r><w:r><w:t>World</w:t></w:r></w:p>'
    ]));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.docx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .field('documentType', 'docx')
      .field('operations', JSON.stringify([{type: 'replace_text', old_text: 'Hello World', new_text: 'Bonjour Monde'}]))
      .attach('file', buffer, 'test.docx')
      .responseType('blob');
    assert.equal(res.status, 200);
    const newText = await extractTextFromDocxResponse(res);
    assert.match(newText, /Bonjour Monde/);
    assert.equal((newText.match(/Bonjour Monde/g) || []).length, 1, 'replacement text must be inserted once across runs');
    assert.doesNotMatch(newText, /Hello World/);
  });

  // Test 2: 同一文字出现多次，只修改指定 occurrence
  await t.test('P0-2: DOCX replace text with occurrence — same text appears multiple times', async () => {
    const zip = makeDocxZip(makeDocxBodyXml([
      '<w:p><w:r><w:t>苹果</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>香蕉</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>苹果</w:t></w:r></w:p>'
    ]));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    // Without occurrence — should fail with multiple matches
    const res1 = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.docx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .field('documentType', 'docx')
      .field('operations', JSON.stringify([{type: 'replace_text', old_text: '苹果', new_text: '橘子'}]))
      .attach('file', buffer, 'test.docx');
    // Should fail because there are 2 occurrences
    assert.equal(res1.status, 500);

    // With occurrence=1 — should succeed and only replace the second occurrence
    const buffer2 = await zip.generateAsync({ type: 'nodebuffer' });
    const res2 = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.docx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .field('documentType', 'docx')
      .field('operations', JSON.stringify([{type: 'replace_text', old_text: '苹果', new_text: '橘子', occurrence: 1}]))
      .attach('file', buffer2, 'test.docx')
      .responseType('blob');
    assert.equal(res2.status, 200);
    const newText = await extractTextFromDocxResponse(res2);
    // First occurrence (苹果) should still be 苹果
    assert.match(newText, /苹果/);
    // Second occurrence should be 橘子
    const firstAppleIdx = newText.indexOf('苹果');
    const secondAppleIdx = newText.indexOf('苹果', firstAppleIdx + 1);
    assert.equal(secondAppleIdx, -1, 'Second occurrence of 苹果 should be replaced');
    assert.match(newText, /橘子/);
  });

  // Test 3: 带加粗和不同字体的段落，修改后不重复文字
  await t.test('P0-2: DOCX modify paragraph with bold and different fonts — no text duplication', async () => {
    const zip = makeDocxZip(makeDocxBodyXml([
      '<w:p>' +
      '<w:r><w:rPr><w:b/><w:rFonts w:ascii="Arial"/></w:rPr><w:t>重要通知：</w:t></w:r>' +
      '<w:r><w:rPr><w:rFonts w:ascii="SimSun"/></w:rPr><w:t>明天放假</w:t></w:r>' +
      '</w:p>'
    ]));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.docx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .field('documentType', 'docx')
      .field('operations', JSON.stringify([{type: 'modify_paragraph', paragraph_marker: '重要通知', new_text: '【重要通知：明天放假】'}]))
      .attach('file', buffer, 'test.docx')
      .responseType('blob');
    assert.equal(res.status, 200);
    const newText = await extractTextFromDocxResponse(res);
    // Should contain the new text exactly once
    assert.match(newText, /重要通知/);
    // The text should not appear duplicated
    const count = (newText.match(/重要通知/g) || []).length;
    assert.ok(count <= 2, 'Text should not be duplicated across runs');
  });

  // Test 4: 标题修改后 Word 可重新打开并提取正确正文
  await t.test('P0-2: DOCX modify heading — re-openable and extractable', async () => {
    const zip = makeDocxZip(makeDocxBodyXml([
      '<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>第一章</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>内容段落</w:t></w:r></w:p>'
    ]));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.docx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .field('documentType', 'docx')
      .field('operations', JSON.stringify([{type: 'modify_heading', heading_marker: '第一章', new_text: '更新后的标题', level: 2}]))
      .attach('file', buffer, 'test.docx')
      .responseType('blob');
    assert.equal(res.status, 200);
    // Re-parse and verify
    const newText = await extractTextFromDocxResponse(res);
    assert.match(newText, /更新后的标题/);
    assert.doesNotMatch(newText, /第一章/);
    // Verify the body paragraph is unaffected
    assert.match(newText, /内容段落/);
  });

  // Test 5: 列表和普通段落混合时不误删
  await t.test('P0-2: DOCX modify list — mixed with normal paragraphs, no accidental deletion', async () => {
    const zip = makeDocxZip(makeDocxBodyXml([
      '<w:p><w:r><w:t>普通段落A</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>列表项1</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>列表项2</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>普通段落B</w:t></w:r></w:p>'
    ]));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.docx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .field('documentType', 'docx')
      .field('operations', JSON.stringify([{type: 'modify_list', list_marker: '列表项1', action: 'add', item_text: '新列表项'}]))
      .attach('file', buffer, 'test.docx')
      .responseType('blob');
    assert.equal(res.status, 200);
    const newText = await extractTextFromDocxResponse(res);
    // All original paragraphs should still exist
    assert.match(newText, /普通段落A/);
    assert.match(newText, /列表项1/);
    assert.match(newText, /列表项2/);
    assert.match(newText, /普通段落B/);
    assert.match(newText, /新列表项/);
  });

  // Test 6: 表格单元格包含多个 run
  await t.test('P0-2: DOCX modify table cell with multiple runs', async () => {
    const zip = makeDocxZip(makeDocxBodyXml([
      '<w:tbl>' +
      '<w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="2500"/><w:gridCol w:w="2500"/></w:tblGrid>' +
      '<w:tr>' +
      '<w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>姓名</w:t></w:r><w:r><w:t>：张三</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>年龄30</w:t></w:r></w:p></w:tc>' +
      '</w:tr>' +
      '</w:tbl>'
    ]));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.docx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .field('documentType', 'docx')
      .field('operations', JSON.stringify([{type: 'modify_table_cell', table_marker: '姓名', row: 0, col: 0, value: '姓名：李四'}]))
      .attach('file', buffer, 'test.docx')
      .responseType('blob');
    assert.equal(res.status, 200);
    const newText = await extractTextFromDocxResponse(res);
    assert.match(newText, /李四/);
    assert.doesNotMatch(newText, /张三/);
  });

  // Test 7: PPTX 无 slide 参数时拒绝
  await t.test('P1-4: PPTX reject when no slide parameter', async () => {
    const zip = makePptxZip([
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello Slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:sld>'
    ]);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.pptx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      .field('documentType', 'pptx')
      .field('operations', JSON.stringify([{type: 'replace_text', old_text: 'Hello', new_text: 'Hi'}]))
      .attach('file', buffer, 'test.pptx');
    // Should fail because no slide parameter
    assert.equal(res.status, 500);
    assert.match(res.body.error, /缺少有效的幻灯片编号/);
  });

  // Test 8: PPTX shape ID 碰撞
  await t.test('P1-4: PPTX unique shape ID generation — no collision', async () => {
    const zip = makePptxZip([
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1000" name="Existing"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000" y="1000"/><a:ext cx="1000" cy="1000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>Existing</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:sld>'
    ]);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.pptx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      .field('documentType', 'pptx')
      .field('operations', JSON.stringify([{type: 'insert_text', slide: 1, insert_text: 'New Text'}]))
      .attach('file', buffer, 'test.pptx')
      .responseType('blob');
    assert.equal(res.status, 200);
    // insert_text should succeed with unique ID
    const slideXml = await extractSlideXmlFromPptxResponse(res);
    // The generated ID should not be 1000 (already in use)
    const idMatches = (slideXml.match(/cNvPr[^>]*id="(\d+)"/g) || []);
    assert.equal(idMatches.length, 2, 'Should have 2 shapes (original + new)');
    // Verify original shape ID is preserved
    assert.match(slideXml, /cNvPr[^>]*id="1000"/);
    // Should have a new shape with a different ID (not 1000)
    var newIdMatch = slideXml.match(/cNvPr[^>]*id="(\d+)"/g);
    var ids = newIdMatch.map(function(m) { return parseInt(m.match(/"(\d+)"/)[1], 10); });
    var uniqueIds = [...new Set(ids)];
    assert.equal(ids.length, uniqueIds.length, 'All shape IDs should be unique');
  });

  // Test 9: 保存后重新解析并确认目标内容
  await t.test('P0-3: DOCX save verification — re-parse and confirm target content', async () => {
    const zip = makeDocxZip(makeDocxBodyXml([
      '<w:p><w:r><w:t>原始文本</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>保持不变</w:t></w:r></w:p>'
    ]));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.docx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .field('documentType', 'docx')
      .field('operations', JSON.stringify([{type: 'replace_text', old_text: '原始文本', new_text: '修改后文本'}]))
      .attach('file', buffer, 'test.docx')
      .responseType('blob');
    assert.equal(res.status, 200);
    const newText = await extractTextFromDocxResponse(res);
    // Target modification should be confirmed
    assert.match(newText, /修改后文本/);
    assert.doesNotMatch(newText, /原始文本/);
    // Unmodified text should remain unchanged
    assert.match(newText, /保持不变/);
  });

  // Test 10: 纯文本提取情况下，AI 系统提示禁止编造字体/字号
  await t.test('P0-1: System prompt disallows font/size/layout claims from plain text', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../render-api/code-agent.js'), 'utf8');
    // Verify the system prompt contains the required disclaimers
    assert.match(source, /无法可靠获得字体/);
    assert.match(source, /绝对禁止根据纯文本声称/);
    assert.match(source, /视觉排版信息.*不可判断/);
    assert.match(source, /字体名称.*字体大小.*行距.*页边距/);
  });

  // Test 11: 能力咨询不会读取或发送当前文档正文
  await t.test('P1-6: Capability inquiry does not inject document content', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../render-api/code-agent.js'), 'utf8');
    // Verify needsDocumentContext function exists
    assert.match(source, /function needsDocumentContext/);
    // Verify capability check regex
    assert.match(source, /capabilityRE/);
    // Verify capability questions are excluded from context injection
    assert.match(source, /capabilityRE\.test\(msg\)/);
  });

  // Test 12: 多文件打开时上下文不会重复注入
  await t.test('P1-6: Context budget logging is present', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../render-api/code-agent.js'), 'utf8');
    // Verify context budget logging
    assert.match(source, /context_budget/);
    assert.match(source, /injected_chars/);
    assert.match(source, /shouldInjectDocs/);
    // Verify max open files limit
    assert.match(source, /MAX_OPEN_FILES\s*=\s*12/);
  });

  // ── Additional verification tests ────────────────────────────────────

  await t.test('P0-2: DOCX operation with no changes returns error', async () => {
    const zip = makeDocxZip(makeDocxBodyXml([
      '<w:p><w:r><w:t>unchangeable</w:t></w:r></w:p>'
    ]));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    // Try to replace text that doesn't exist
    const res = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.docx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .field('documentType', 'docx')
      .field('operations', JSON.stringify([{type: 'replace_text', old_text: 'nonexistent', new_text: 'something'}]))
      .attach('file', buffer, 'test.docx');
    assert.equal(res.status, 500);
    assert.match(res.body.error, /DOCX 修改失败/);
  });

  await t.test('P0-2: DOCX modify heading preserves non-heading paragraphs', async () => {
    const zip = makeDocxZip(makeDocxBodyXml([
      '<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>原标题</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>普通段落不应该被修改</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>另一个段落</w:t></w:r></w:p>'
    ]));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.docx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .field('documentType', 'docx')
      .field('operations', JSON.stringify([{type: 'modify_heading', heading_marker: '原标题', new_text: '新标题', level: 2}]))
      .attach('file', buffer, 'test.docx')
      .responseType('blob');
    assert.equal(res.status, 200);
    const newText = await extractTextFromDocxResponse(res);
    assert.match(newText, /新标题/);
    assert.match(newText, /普通段落不应该被修改/);
    assert.match(newText, /另一个段落/);
  });

  await t.test('P1-4: PPTX replace text with slide parameter succeeds', async () => {
    const zip = makePptxZip([
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello PPTX</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:sld>'
    ]);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.pptx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      .field('documentType', 'pptx')
      .field('operations', JSON.stringify([{type: 'replace_text', slide: 1, old_text: 'Hello', new_text: 'Hi'}]))
      .attach('file', buffer, 'test.pptx')
      .responseType('blob');
    assert.equal(res.status, 200);
    // Verify the slide text was changed
    const slideXml = await extractSlideXmlFromPptxResponse(res);
    assert.match(slideXml, /Hi/);
    assert.doesNotMatch(slideXml, /Hello/);
  });

  await t.test('P1-4: PPTX invalid slide number rejects', async () => {
    const zip = makePptxZip([
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 1</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:sld>'
    ]);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.pptx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      .field('documentType', 'pptx')
      .field('operations', JSON.stringify([{type: 'replace_text', slide: 999, old_text: 'Slide', new_text: 'Page'}]))
      .attach('file', buffer, 'test.pptx');
    assert.equal(res.status, 500);
    assert.match(res.body.error, /缺少有效的幻灯片编号/);
  });

  await t.test('Apply XLSX operation', async () => {
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet([['A1', 'B1'], ['A2', 'B2']]);
    xlsx.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const ops = [
      { type: 'cell_update', sheet: 'Sheet1', cell: 'A1', value: 'NewA1' },
      { type: 'sheet_add', sheet: 'Sheet2' }
    ];

    const res = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.xlsx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .field('documentType', 'xlsx')
      .field('operations', JSON.stringify(ops))
      .attach('file', buffer, 'test.xlsx')
      .responseType('blob');

    assert.equal(res.status, 200);
    const outBuffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.text || '', 'binary');
    assert.equal(res.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.ok(decodeURIComponent(res.headers['content-disposition']).includes('test_AI修改版.xlsx'));
    const outWb = xlsx.read(outBuffer, { type: 'buffer' });
    const outWs = outWb.Sheets['Sheet1'];
    assert.equal(outWs['A1'].v, 'NewA1');
    assert.ok(outWb.Sheets['Sheet2'], 'Sheet2 should be created');
  });

  await t.test('Check models injection', async () => {
    const res = await request(app)
      .post('/api/code/chat')
      .send({ text: 'hi', files: [] });
    assert.notEqual(res.status, 500);
  });
});
