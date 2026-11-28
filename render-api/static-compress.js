'use strict';
// Zero-dependency Brotli / Gzip static asset & JSON response compression.
// Cuts initial page transfer (~1.5 MB raw JS+CSS -> ~320 KB compressed) while
// strictly skipping SSE (text/event-stream), media binaries, and Range requests.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

const ALLOWED_EXACT = new Set([
  '/index.html',
  '/admin.html',
  '/manifest.json',
  '/chat-notifications-sw.js',
  '/media-originals-sw.js',
  '/media-digest.js'
]);
const ALLOWED_PREFIXES = ['/js/', '/css/', '/icons/', '/assets/'];

function isAllowedStaticPath(decoded) {
  if (!decoded || decoded[0] !== '/') return false;
  if (decoded.indexOf('..') !== -1 || decoded.indexOf('\\') !== -1 || decoded.indexOf('\0') !== -1 || decoded.indexOf('//') !== -1) {
    return false;
  }
  if (/(^|\/)\./.test(decoded)) return false;
  if (ALLOWED_EXACT.has(decoded)) return true;
  for (let i = 0; i < ALLOWED_PREFIXES.length; i++) {
    if (decoded.startsWith(ALLOWED_PREFIXES[i])) return true;
  }
  return false;
}

function pickEncoding(headerValue) {
  const raw = String(headerValue || '').toLowerCase();
  if (!raw) return '';
  if (/\bbr\b/.test(raw)) return 'br';
  if (/\bgzip\b/.test(raw)) return 'gzip';
  return '';
}

function createStaticCompressor(rootDir, options) {
  const opts = options || {};
  const maxEntries = opts.maxEntries || 96;
  const maxTotalBytes = opts.maxTotalBytes || 24 * 1024 * 1024;
  const minBytes = opts.minBytes || 1024;
  const rootResolved = path.resolve(rootDir);
  const cache = new Map();
  let totalBytes = 0;

  function cacheSet(key, entry) {
    if (cache.has(key)) {
      totalBytes -= cache.get(key).buf.length;
      cache.delete(key);
    }
    while (cache.size >= maxEntries || totalBytes + entry.buf.length > maxTotalBytes) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) break;
      totalBytes -= cache.get(oldestKey).buf.length;
      cache.delete(oldestKey);
    }
    cache.set(key, entry);
    totalBytes += entry.buf.length;
  }

  return function staticCompressMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.headers.range) return next();
    const encoding = pickEncoding(req.headers['accept-encoding']);
    if (!encoding) return next();

    let relPath = req.path || '/';
    if (relPath === '/' || relPath === '/photos' || relPath === '/chat' || relPath === '/profile' || relPath === '/ai' || relPath === '/posts') {
      relPath = '/index.html';
    }
    const ext = path.extname(relPath).toLowerCase();
    const contentType = MIME_MAP[ext];
    if (!contentType) return next();

    let decoded;
    try { decoded = decodeURIComponent(relPath); } catch (_) { return next(); }
    if (/%[0-9a-fA-F]{2}/.test(decoded)) return next();
    if (!isAllowedStaticPath(decoded)) return next();

    const absPath = path.resolve(rootResolved, decoded.replace(/^\/+/, ''));
    if (absPath !== rootResolved && !absPath.startsWith(rootResolved + path.sep)) return next();

    fs.stat(absPath, function (statErr, stats) {
      if (statErr || !stats || !stats.isFile() || stats.size < minBytes || stats.size > 4 * 1024 * 1024) {
        return next();
      }
      const etag = 'W/"' + stats.size.toString(16) + '-' + Math.floor(stats.mtimeMs).toString(16) + '-' + encoding + '"';
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('ETag', etag);
      if (absPath.endsWith('.html') || absPath.endsWith('chat-notifications-sw.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (/\.(?:css|js)\?v=[a-f0-9]{10}(?:&|$)/i.test(String(req.originalUrl || ''))) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }

      const cacheKey = absPath + '|' + stats.size + '|' + Math.floor(stats.mtimeMs) + '|' + encoding;
      const hit = cache.get(cacheKey);
      if (hit) {
        // Refresh LRU order
        cache.delete(cacheKey);
        cache.set(cacheKey, hit);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Encoding', encoding);
        res.setHeader('Content-Length', String(hit.buf.length));
        if (req.method === 'HEAD') return res.status(200).end();
        return res.status(200).end(hit.buf);
      }

      fs.readFile(absPath, function (readErr, rawBuf) {
        if (readErr || !rawBuf) return next();
        const done = function (compErr, compBuf) {
          if (compErr || !compBuf || compBuf.length >= rawBuf.length) return next();
          cacheSet(cacheKey, { buf: compBuf });
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Encoding', encoding);
          res.setHeader('Content-Length', String(compBuf.length));
          if (req.method === 'HEAD') return res.status(200).end();
          return res.status(200).end(compBuf);
        };
        if (encoding === 'br' && typeof zlib.brotliCompress === 'function') {
          zlib.brotliCompress(rawBuf, {
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 }
          }, done);
        } else {
          zlib.gzip(rawBuf, { level: 6 }, done);
        }
      });
    });
  };
}

function jsonCompressMiddleware(req, res, next) {
  const encoding = pickEncoding(req.headers['accept-encoding']);
  if (!encoding || req.method === 'HEAD') return next();
  const origJson = res.json;
  res.json = function (body) {
    if (res.headersSent) return origJson.call(this, body);
    const ct = String(res.getHeader('Content-Type') || '');
    if (ct.includes('text/event-stream') || res.getHeader('Content-Encoding')) {
      return origJson.call(this, body);
    }
    let str;
    try { str = JSON.stringify(body); } catch (_) { return origJson.call(this, body); }
    if (!str || str.length < 1536) return origJson.call(this, body);
    const raw = Buffer.from(str, 'utf8');
    let compressed;
    try {
      compressed = encoding === 'br' && typeof zlib.brotliCompressSync === 'function'
        ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 3 } })
        : zlib.gzipSync(raw, { level: 5 });
    } catch (_) {
      return origJson.call(this, body);
    }
    if (!compressed || compressed.length >= raw.length) return origJson.call(this, body);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Encoding', encoding);
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Length', String(compressed.length));
    return res.end(compressed);
  };
  next();
}

module.exports = { createStaticCompressor, jsonCompressMiddleware, pickEncoding };
