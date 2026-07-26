const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const path = require('path');
const fs = require('fs');

const registerCodeAgentRoutes = require('../render-api/code-agent.js');
const xlsx = require('xlsx');
const JSZip = require('jszip');

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

  await t.test('Apply DOCX operation should be rejected', async () => {
    const buffer = Buffer.from('dummy docx');
    const res = await request(app)
      .post('/api/code/document/apply')
      .field('fileName', 'test.docx')
      .field('mimeType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .field('documentType', 'docx')
      .field('operations', JSON.stringify([{type: 'text_replace', find: 'a', replace: 'b'}]))
      .attach('file', buffer, 'test.docx');

    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /不支持修改此类型文档/);
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
