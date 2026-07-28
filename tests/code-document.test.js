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
  await t.test('Extract Text via multipart', async () => {
    // Generate a simple dummy docx or use a text file pretending to be docx
    // Wait, if mammoth parses it, it might fail if it's not real docx.
    // Let's just pass a text file and mimeType=text/plain to test multipart extract
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
    zip.folder('word').file('document.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:t>广州三日游：第一天参观陈家祠。</w:t></w:r></w:p>' +
      '</w:body></w:document>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const res = await request(app)
      .post('/api/code/document/extract')
      .attach('file', buffer, 'guangzhou.docx');

    assert.equal(res.status, 200);
    assert.match(res.body.text, /广州三日游/);
    assert.equal(res.body.ext, '.docx');
  });

  await t.test('Reject legacy DOC truthfully instead of pretending mammoth supports it', async () => {
    const res = await request(app)
      .post('/api/code/document/extract')
      .attach('file', Buffer.from('legacy binary'), 'old-guide.doc');

    assert.equal(res.status, 415);
    assert.equal(res.body.code, 'LEGACY_DOC_UNSUPPORTED');
    assert.match(res.body.error, /另存为 DOCX/);
  });

  await t.test('Reject renamed or corrupt binary documents instead of returning fake extracted text', async () => {
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

  await t.test('Apply DOCX operation succeeds', async () => {
    // Create a real DOCX with word/document.xml
    const JSZip = require('jszip');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
    zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello World</w:t></w:r></w:p></w:body></w:document>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.docx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .field('documentType', 'docx')
      .field('operations', JSON.stringify([{type: 'replace_text', old_text: 'Hello', new_text: 'Hi'}]))
      .attach('file', buffer, 'test.docx');

    // DOCX modification is now supported
    assert.equal(res.status, 200);
    assert.ok(res.body);
  });

  await t.test('Apply XLSX operation', async () => {
    // Create a real simple xlsx
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
    
    // Read the returned binary
    const outBuffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.text || '', 'binary'); // supertest returns buffer for application/octet-stream?
    // Wait, supertest parsing for binary needs responseType('blob') or similar, 
    // but we can just check headers first.
    assert.equal(res.headers['content-type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.ok(decodeURIComponent(res.headers['content-disposition']).includes('test_AI修改版.xlsx'));
    
    // Parse it back to verify
    const outWb = xlsx.read(outBuffer, { type: 'buffer' });
    const outWs = outWb.Sheets['Sheet1'];
    assert.equal(outWs['A1'].v, 'NewA1');
    assert.ok(outWb.Sheets['Sheet2'], 'Sheet2 should be created');
  });

  await t.test('Check models injection', async () => {
    const res = await request(app)
      .post('/api/code/chat')
      .send({ text: 'hi', files: [] }); // simple body
    
    // We expect it to at least start the chat and maybe fail or succeed, but not fail on 'deepseek-coder' missing.
    // Our mock deps provide 'deepseek-v4-pro'. 
    // We just verify it doesn't return 500 for missing model.
    assert.notEqual(res.status, 500); 
  });
});
