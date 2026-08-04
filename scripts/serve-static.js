'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
// 本地静态服务使用含回环地址放行的 CSP_LOCAL（生产版 CSP 不放行 localhost）
var { SECURITY_HEADERS_LOCAL } = require("../render-api/security-headers");

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

// 后端 API 代理目标（CI 环境中 render-api/server.js 监听 3000 端口）
var API_PROXY_TARGET = process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000';

http.createServer(function (req, res) {
  var pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch (_) {
    res.writeHead(400, SECURITY_HEADERS_LOCAL).end('Bad request');
    return;
  }

  // 代理 /api/* 请求到后端服务器
  if (pathname.indexOf('/api/') === 0) {
    // 不透传客户端 Host（API_PROXY_TARGET 的 Host 才准确），同时设 X-Forwarded-Proto
    var proxyHeaders = Object.assign({}, req.headers);
    delete proxyHeaders.host;
    proxyHeaders['x-forwarded-proto'] = 'http';
    var proxyReq = http.request(
      API_PROXY_TARGET + req.url,
      { method: req.method, headers: proxyHeaders },
      function (proxyRes) {
        res.writeHead(proxyRes.statusCode, Object.assign({}, proxyRes.headers, SECURITY_HEADERS_LOCAL));
        // L4 修复：监听上游/下游流错误，避免客户端中断或后端崩溃时未捕获 error 导致进程崩溃
        proxyRes.on('error', function (err) {
          console.error('[serve-static] upstream stream error:', err.message);
          try { res.destroy(); } catch (_) {}
        });
        res.on('error', function (err) {
          console.error('[serve-static] client stream error:', err.message);
          try { proxyRes.destroy(); } catch (_) {}
        });
        proxyRes.pipe(res);
      }
    );
    proxyReq.on('error', function (err) {
      console.error('[serve-static] API proxy error:', err.message);
      res.writeHead(502, Object.assign({ 'Content-Type': 'application/json' }, SECURITY_HEADERS_LOCAL));
      res.end(JSON.stringify({ error: 'Backend unavailable', code: 'proxy_error' }));
    });
    req.pipe(proxyReq);
    return;
  }
  var relative;
  if (pathname.indexOf('/vendor/webllm/') === 0) {
    // 本地开发镜像生产端 render-api/server.js 的 /vendor/webllm 静态路由，
    // 指向 node_modules/@mlc-ai/web-llm/lib（浏览器端本地 AI worker 依赖）。
    relative = 'node_modules/@mlc-ai/web-llm/lib/' + pathname.replace(/^\/vendor\/webllm\//, '');
  } else {
    relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  }
  var file = path.resolve(root, relative);
  if (file !== root && file.indexOf(root + path.sep) !== 0) {
    res.writeHead(403, SECURITY_HEADERS_LOCAL).end('Forbidden');
    return;
  }
  try {
    var real = fs.realpathSync(file);
    if (real !== file && real.indexOf(root + path.sep) !== 0 && real !== root) {
      res.writeHead(403, SECURITY_HEADERS_LOCAL).end('Forbidden');
      return;
    }
  } catch (_) {
    res.writeHead(403, SECURITY_HEADERS_LOCAL).end('Forbidden');
    return;
  }
  fs.stat(file, function (statError, stat) {
    if (statError || !stat.isFile()) {
      res.writeHead(404, SECURITY_HEADERS_LOCAL).end('Not found');
      return;
    }
    res.writeHead(200, Object.assign({ 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream' }, SECURITY_HEADERS_LOCAL));
    var stream = fs.createReadStream(file);
    stream.on('error', function() {
      if (!res.headersSent) res.writeHead(404, SECURITY_HEADERS_LOCAL).end('Not found');
      else res.destroy();
    });
    stream.pipe(res);
  });
}).listen(4173, '127.0.0.1');
