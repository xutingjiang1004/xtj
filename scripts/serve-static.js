'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

http.createServer(function (req, res) {
  var pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch (_) {
    res.writeHead(400).end('Bad request');
    return;
  }
  var relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  var file = path.resolve(root, relative);
  if (file !== root && file.indexOf(root + path.sep) !== 0) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    var real = fs.realpathSync(file);
    if (real !== file && real.indexOf(root + path.sep) !== 0 && real !== root) {
      res.writeHead(403).end('Forbidden');
      return;
    }
  } catch (_) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(file, function (statError, stat) {
    if (statError || !stat.isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    var stream = fs.createReadStream(file);
    stream.on('error', function() {
      if (!res.headersSent) res.writeHead(404).end('Not found');
      else res.destroy();
    });
    stream.pipe(res);
  });
}).listen(4173, '127.0.0.1');
