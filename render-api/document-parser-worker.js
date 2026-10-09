'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const zlib = require('node:zlib');
const MAX_TEXT = 200000;
function validateOfficeZip(buffer) {
  if (buffer.readUInt32LE(0) !== 0x04034b50) return; // legacy XLS is not a ZIP
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw Error('invalid_zip');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16), total = 0;
  if (count > 2000 || count === 65535) throw Error('document_expansion_limit');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw Error('invalid_zip_directory');
    const flags = buffer.readUInt16LE(offset + 8), method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20), size = buffer.readUInt32LE(offset + 24);
    const local = buffer.readUInt32LE(offset + 42);
    total += size;
    if (flags & 1 || size > 16 * 1024 * 1024 || total > 64 * 1024 * 1024 || local + 30 > buffer.length) throw Error('document_expansion_limit');
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw Error('invalid_zip_entry');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + compressed > offset || ![0, 8].includes(method)) throw Error('invalid_zip_entry');
    const input = buffer.subarray(start, start + compressed);
    // Verify the actual inflated length; directory sizes alone are untrusted.
    const output = method === 0 ? input : zlib.inflateRawSync(input, { maxOutputLength: Math.min(size + 1, 16 * 1024 * 1024 + 1) });
    if (output.length !== size) throw Error('invalid_zip_size');
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}
async function parse() {
  const buffer = Buffer.from(workerData.bytes);
  if (workerData.kind === 'pdf') {
    const library = require('pdf-parse');
    if (typeof library === 'function') return library(buffer);
    const parser = new library.PDFParse({ data: new Uint8Array(buffer) });
    try { const result = await parser.getText(); return { text: result.text, numpages: result.total }; }
    finally { await parser.destroy(); }
  }
  validateOfficeZip(buffer);
  if (workerData.kind === 'docx') {
    const result = await require('mammoth').extractRawText({ buffer });
    return { text: result.value };
  }
  const XLSX = require('xlsx'), workbook = XLSX.read(buffer, { type: 'buffer', sheetRows: 201, bookVBA: false, bookFiles: false });
  const parts = [];
  for (const name of workbook.SheetNames.slice(0, 20)) {
    const sheet = workbook.Sheets[name];
    if (!sheet || !sheet['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    range.e.r = Math.min(range.e.r, range.s.r + 199); range.e.c = Math.min(range.e.c, range.s.c + 59);
    parts.push('【工作表: ' + name + '】\n' + XLSX.utils.sheet_to_csv(sheet, { blankrows: false, range }));
    if (parts.join('').length >= MAX_TEXT) break;
  }
  return { text: parts.join('\n\n') };
}
parse().then(result => parentPort.postMessage({ ok:true, text:String(result.text || '').slice(0,MAX_TEXT), numpages:result.numpages || 0 }))
  .catch(error => parentPort.postMessage({ ok:false, error:error.message }));
