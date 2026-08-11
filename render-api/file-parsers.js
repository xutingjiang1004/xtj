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
// ★ 安全加固：体积上限 + 解析超时 + 并发信号量，防止恶意 PDF（zip-bomb/深层嵌套）
//   OOM 或挂死事件循环。pdf-parse 的同步解析无法被 Promise.race 中断，
//   因此用信号量限制同时解析数，把单事件循环被占满的窗口收敛到固定上限（审计 🟠）
var MAX_PDF_BUFFER_BYTES = 8 * 1024 * 1024; // 8MB（由 15MB 下调）
var PDF_PARSE_TIMEOUT_MS = 15000;
var MAX_CONCURRENT_PDF_PARSES = 2;
var _pdfParseInFlight = 0;
var _pdfParseWaiters = [];

// 进程级并发信号量：最多 MAX_CONCURRENT_PDF_PARSES 个 PDF 同时解析，
// 超出排队等待，防止并发恶意 PDF 反复占满事件循环。
async function withPdfParseSlot(fn) {
  if (_pdfParseInFlight >= MAX_CONCURRENT_PDF_PARSES) {
    await new Promise(function(resolve) { _pdfParseWaiters.push(resolve); });
  }
  _pdfParseInFlight++;
  try {
    return await fn();
  } finally {
    _pdfParseInFlight--;
    var next = _pdfParseWaiters.shift();
    if (next) next();
  }
}

async function parsePdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_PDF_BUFFER_BYTES) {
    throw new Error('PDF 文件大小超出允许范围');
  }
  var library = getPdfParser();
  if (!library) throw new Error('PDF 解析库不可用');
  return await withPdfParseSlot(async function() {
    if (typeof library === 'function') {
      return await withTimeout(Promise.resolve(library(buffer)), PDF_PARSE_TIMEOUT_MS, 'PDF 解析超时');
    }
    if (typeof library.PDFParse !== 'function') throw new Error('PDF 解析库版本不兼容');
    var parser = new library.PDFParse({ data: new Uint8Array(buffer) });
    try {
      var result = await withTimeout(parser.getText(), PDF_PARSE_TIMEOUT_MS, 'PDF 解析超时');
      return {
        text: result && result.text || '',
        numpages: result && Number(result.total) || 0,
        info: {}
      };
    } finally {
      try { await parser.destroy(); } catch (_) {}
    }
  });
}

function withTimeout(promise, ms, message) {
  var timer = null;
  var timeoutPromise = new Promise(function (_, reject) {
    timer = setTimeout(function () { reject(new Error(message)); }, ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeoutPromise]).finally(function () {
    if (timer) clearTimeout(timer);
  });
}

module.exports = { loadFileParser, getPdfParser, getMammothParser, getXlsxParser, parsePdfBuffer };