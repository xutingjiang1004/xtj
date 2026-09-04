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
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

// 敏感路径拒绝前缀：按 URL 路径段匹配，命中直接 403，防止源码/凭据/构建脚本泄露
// ★ 2026-09-04 审计修复：补 audit-reports（审计报告含内网/弱口令细节）
var SENSITIVE_SEGMENTS = ['.git', '.env', 'node_modules', 'render-api', 'tests', 'scripts', 'mcp-servers', 'supabase', 'backups', 'output', 'audit-reports'];
function hasSensitiveSegment(urlPath) {
  // ★ 修复：统一反斜杠并大小写不敏感比较（此前 %5c 解码后的 \\ 路径与 /.ENV 等大小写变体可绕过名单）
  var normalizedPath = String(urlPath || '').replace(/\\/g, '/').toLowerCase();
  return normalizedPath.split('/').some(function (seg) { return SENSITIVE_SEGMENTS.indexOf(seg) >= 0; });
}

// ★ 2026-09-04 审计修复：根级敏感文件后缀/文件名拦截（仓库根托管时这些文件
//   不在目录黑名单内，须按文件粒度拒绝）：
//   - *.sql（含仓库根 SUPABASE_FIX_051.sql 等修复脚本，可能携带生产修复 SQL）
//   - package.json / package-lock.json（依赖元信息与潜在 scripts 探测面）
function hasSensitiveFile(urlPath) {
  var lower = String(urlPath || '').toLowerCase();
  if (/\.sql$/.test(lower)) return true;
  if (/(^|\/)package(-lock)?\.json$/.test(lower)) return true;
  return false;
}

// 后端 API 代理目标（CI 环境中 render-api/server.js 监听 3000 端口）
var API_PROXY_TARGET = process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000';
(function validateProxyTarget() {
  try {
    var u = new URL(API_PROXY_TARGET);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('unsupported protocol');
  } catch (e) {
    console.error('[serve-static] invalid API_PROXY_TARGET (must be an http/https URL): ' + API_PROXY_TARGET);
    process.exit(1);
  }
})();

var server = http.createServer(function (req, res) {
  var pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch (_) {
    res.writeHead(400, SECURITY_HEADERS_LOCAL).end('Bad request');
    return;
  }

  // 代理 /api/* 请求到后端服务器
  if (pathname.indexOf('/api/') === 0) {
    var proxyTarget;
    try {
      // 用规范化 pathname+search 重建 URL，避免直接把原始 req.url 拼在 target 后
      var reqParsed = new URL(req.url, 'http://127.0.0.1');
      proxyTarget = API_PROXY_TARGET.replace(/\/+$/, '') + reqParsed.pathname + reqParsed.search;
    } catch (_) {
      res.writeHead(400, SECURITY_HEADERS_LOCAL).end('Bad request');
      return;
    }
    // 不透传客户端 Host（API_PROXY_TARGET 的 Host 才准确），同时设 X-Forwarded-Proto
    var proxyHeaders = Object.assign({}, req.headers);
    delete proxyHeaders.host;
    proxyHeaders['x-forwarded-proto'] = 'http';
    var proxyReq = http.request(
      proxyTarget,
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
    // 代理请求超时保护：超时销毁并走 502 分支
    proxyReq.setTimeout(15000);
    proxyReq.on('timeout', function () {
      console.error('[serve-static] API proxy timeout, aborting request');
      proxyReq.destroy();
    });
    proxyReq.on('error', function (err) {
      console.error('[serve-static] API proxy error:', err.message);
      res.writeHead(502, Object.assign({ 'Content-Type': 'application/json' }, SECURITY_HEADERS_LOCAL));
      res.end(JSON.stringify({ error: 'Backend unavailable', code: 'proxy_error' }));
    });
    req.pipe(proxyReq);
    return;
  }
  // 敏感路径前缀直接 403（.git / .env / node_modules / render-api / tests / scripts / mcp-servers / audit-reports）
  if (hasSensitiveSegment(pathname) || hasSensitiveFile(pathname)) {
    res.writeHead(403, SECURITY_HEADERS_LOCAL).end('Forbidden');
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
  } catch (e) {
    // ENOENT：文件不存在单独返回 404，其余（权限等）仍 403
    if (e && e.code === 'ENOENT') {
      res.writeHead(404, SECURITY_HEADERS_LOCAL).end('Not found');
    } else {
      res.writeHead(403, SECURITY_HEADERS_LOCAL).end('Forbidden');
    }
    return;
  }
  fs.stat(file, function (statError, stat) {
    if (statError || !stat.isFile()) {
      res.writeHead(404, SECURITY_HEADERS_LOCAL).end('Not found');
      return;
    }
    res.writeHead(200, Object.assign(
      { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream' },
      SECURITY_HEADERS_LOCAL,
      { 'Cache-Control': 'no-cache' }
    ));
    var stream = fs.createReadStream(file);
    stream.on('error', function() {
      if (!res.headersSent) res.writeHead(404, SECURITY_HEADERS_LOCAL).end('Not found');
      else res.destroy();
    });
    stream.pipe(res);
  });
});
var PORT = process.env.PORT || 4173;
server.on('error', function (err) {
  if (err && err.code === 'EADDRINUSE') {
    console.error('[serve-static] Port ' + PORT + ' already in use (EADDRINUSE): ' + err.message);
  } else {
    console.error('[serve-static] Server error: ' + (err && err.message ? err.message : err));
  }
  process.exit(1);
});
server.listen(PORT, '127.0.0.1');
