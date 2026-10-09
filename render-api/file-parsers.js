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


const { Worker } = require('node:worker_threads');
const path = require('node:path');
let active = 0;
const waiters = [];
async function parseDocumentBuffer(buffer, kind) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > (kind === 'pdf' ? 8 : 20) * 1024 * 1024) throw Error('文档大小超出允许范围');
  if (!['pdf','docx','xlsx'].includes(kind)) throw Error('不支持的文档类型');
  if (active >= 2) {
    if (waiters.length >= 8) throw Error('文档解析繁忙，请稍后重试');
    await new Promise(resolve => waiters.push(resolve));
  } else active++;
  try {
    return await new Promise((resolve,reject) => {
      const worker = new Worker(path.join(__dirname,'document-parser-worker.js'), {
        workerData:{bytes:buffer,kind},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}
      });
      let done = false;
      const finish = async (error,result) => {
        if (done) return; done = true; clearTimeout(timer);
        await worker.terminate();
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(Error('文档解析超时')),15000);
      worker.once('message', result => finish(result.ok ? null : Error(result.error),result));
      worker.once('error', error => finish(error));
      worker.once('exit', () => { if (!done) finish(Error('文档解析已停止')); });
    });
  } finally { const next=waiters.shift(); if(next)next(); else active--; }
}
function parsePdfBuffer(buffer) { return parseDocumentBuffer(buffer,'pdf'); }
module.exports = { loadFileParser, getPdfParser, getMammothParser, getXlsxParser, parsePdfBuffer, parseDocumentBuffer };
