'use strict';
function sniffDocument(buf, mime) {
  if (!Buffer.isBuffer(buf) || !buf.length) return { ok: false };
  const head = buf.subarray(0, 1024).toString('utf8');
  if (mime === 'application/pdf') return { ok: head.startsWith('%PDF-') };
  if (mime === 'application/rtf') return { ok: head.startsWith('{\\rtf') };
  if (mime === 'text/plain' || mime === 'text/csv') return {
    ok: !buf.includes(0) && !/^\s*(?:<!doctype\s+html|<html|<script|<svg)/i.test(head)
  };
  return { ok: buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b &&
    ((buf[2] === 3 && buf[3] === 4) || (buf[2] === 5 && buf[3] === 6)) };
}
module.exports = { sniffDocument };
