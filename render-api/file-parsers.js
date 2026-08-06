'use strict';

// 共享文件解析器模块 — 供 server.js 和 code-agent.js 共用，避免重复定义。
var pdfParser = null, mammothParser = null, xlsxParser = null;
var pdfParserLoaded = false, mammothParserLoaded = false, xlsxParserLoaded = false;

function loadFileParser(name) {
  try { return require(name); } catch(e) { console.warn('[PARSER] ' + name + ' not available'); return null; }
}

function getPdfParser() {
  if (!pdfParserLoaded) { pdfParser = loadFileParser('pdf-parse'); pdfParserLoaded = true; }
  return pdfParser;
}

function getMammothParser() {
  if (!mammothParserLoaded) { mammothParser = loadFileParser('mammoth'); mammothParserLoaded = true; }
  return mammothParser;
}

function getXlsxParser() {
  if (!xlsxParserLoaded) { xlsxParser = loadFileParser('xlsx'); xlsxParserLoaded = true; }
  return xlsxParser;
}

// code-agent.js 专用：PDF buffer 解析
async function parsePdfBuffer(buffer) {
  var library = getPdfParser();
  if (!library) throw new Error('PDF 解析库不可用');
  if (typeof library === 'function') return library(buffer);
  if (typeof library.PDFParse !== 'function') throw new Error('PDF 解析库版本不兼容');
  var parser = new library.PDFParse({ data: new Uint8Array(buffer) });
  try {
    var result = await parser.getText();
    return {
      text: result && result.text || '',
      numpages: result && Number(result.total) || 0,
      info: {}
    };
  } finally {
    try { await parser.destroy(); } catch (_) {}
  }
}

module.exports = { loadFileParser, getPdfParser, getMammothParser, getXlsxParser, parsePdfBuffer };