'use strict';

// 共享安全响应头：生产服务(render-api/server.js)与本地静态服务(scripts/serve-static.js)
// 必须使用同一份 CSP，防止两处漂移导致回归测试失效或生产配置错误。
// 注意：script-src 禁止使用 'strict-dynamic'（无 nonce/hash 时会拦截全部外部脚本）。
// 生产 CSP 不放行 localhost；本地开发服务使用 CSP_LOCAL（含 127.0.0.1:10000 回环）。

var CSP = [
  "default-src 'self'",
  // WebLLM runs TVM/WebAssembly in a worker and needs these explicit runtime capabilities.
  // H-9: script-src 不放行 supabase.co——public 桶是用户可写源（可上传 JS 脚本），
  // 放进 script-src 等于允许「上传 JS → 白名单源加载」；supabase 仅用于 API 调用，
  // 由 connect-src 放行。jsdelivr/npmmirror 承载 supabase-js/Monaco/GSAP，必须保留。
  // H-16: 已移除 'unsafe-eval'（WebLLM 的 WASM 编译由 'wasm-unsafe-eval' 覆盖）。
  // 审计 🟡 CSP 记录（跳过原因）：
  //   'unsafe-inline' 暂未移除——前端 index.html/admin.html 存在内联脚本（含 WebLLM
  //   worker 初始化片段与直接内联的事件绑定），本环境无法确认其全部内联依赖；
  //   迁移到外部文件 + nonce 白名单属于前端 HTML 联动改造，需与前端一起排期。
  //   jsdelivr/npmmirror 为 supabase-js/Monaco/GSAP 加载源，已通过 connect-src 限定
  //   用途；script-src 对第三方 CDN 无法做路径级收窄（CSP 规范忽略 script-src 的路径），
  //   后续优先为固定版本资源加 Subresource Integrity (SRI)。
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://registry.npmmirror.com",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://registry.npmmirror.com https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  // frame-src 放行同源与 blob:
  "frame-src 'self' blob:",
  // WebLLM 本地 Qwen：模型元数据在 huggingface.co，权重会重定向到区域 *.hf.co CDN，WASM 模型库在 raw.githubusercontent.com。
  "connect-src 'self' https://xtj.onrender.com https://ithowxqignlhkwaykglt.supabase.co wss://ithowxqignlhkwaykglt.supabase.co https://huggingface.co https://*.hf.co https://raw.githubusercontent.com",
  // Monaco loads its codicon font from the same npm mirror allowed for its script/style assets.
  "font-src 'self' https://cdn.jsdelivr.net https://registry.npmmirror.com https://fonts.gstatic.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

// 本地开发版本：额外的回环地址放行（仅用于 scripts/serve-static.js，禁止用于生产）
var CSP_LOCAL = CSP.replace(
  "connect-src 'self' https://xtj.onrender.com",
  "connect-src 'self' http://127.0.0.1:10000 http://localhost:10000 https://xtj.onrender.com"
);

var SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  // X-XSS-Protection 已被现代浏览器废弃（Chrome 90+ 已移除该头），
  // 保留 mode=block 反而可能在旧版浏览器引入额外 XSS 向量，故删除。
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  // 审计 🟡：补充 COOP/COEP 家族的 COOP，配合 frame-ancestors 'none' 隔离跨源窗口
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': CSP
};

var SECURITY_HEADERS_LOCAL = Object.assign({}, SECURITY_HEADERS, {
  'Content-Security-Policy': CSP_LOCAL
});

function applySecurityHeaders(res) {
  for (var key in SECURITY_HEADERS) {
    res.setHeader(key, SECURITY_HEADERS[key]);
  }
  return res;
}

function applySecurityHeadersLocal(res) {
  for (var key in SECURITY_HEADERS_LOCAL) {
    res.setHeader(key, SECURITY_HEADERS_LOCAL[key]);
  }
  return res;
}

module.exports = {
  CSP: CSP,
  CSP_LOCAL: CSP_LOCAL,
  SECURITY_HEADERS: SECURITY_HEADERS,
  SECURITY_HEADERS_LOCAL: SECURITY_HEADERS_LOCAL,
  applySecurityHeaders: applySecurityHeaders,
  applySecurityHeadersLocal: applySecurityHeadersLocal
};
