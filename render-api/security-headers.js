'use strict';

// 共享安全响应头：生产服务(render-api/server.js)与本地静态服务(scripts/serve-static.js)
// 必须使用同一份 CSP，防止两处漂移导致回归测试失效或生产配置错误。
// 注意：script-src 禁止使用 'strict-dynamic'（无 nonce/hash 时会拦截全部外部脚本）。

var CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://ithowxqignlhkwaykglt.supabase.co https://cdn.jsdelivr.net https://registry.npmmirror.com",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://registry.npmmirror.com https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' https:",
  // WebLLM 本地 Qwen：模型元数据在 huggingface.co，权重会重定向到区域 *.hf.co CDN，WASM 模型库在 raw.githubusercontent.com。
  "connect-src 'self' http://127.0.0.1:10000 http://localhost:10000 https://xtj.onrender.com https://ithowxqignlhkwaykglt.supabase.co wss://ithowxqignlhkwaykglt.supabase.co https://huggingface.co https://*.hf.co https://raw.githubusercontent.com",
  "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

var SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  'Content-Security-Policy': CSP
};

function applySecurityHeaders(res) {
  for (var key in SECURITY_HEADERS) {
    res.setHeader(key, SECURITY_HEADERS[key]);
  }
  return res;
}

module.exports = {
  CSP: CSP,
  SECURITY_HEADERS: SECURITY_HEADERS,
  applySecurityHeaders: applySecurityHeaders
};
