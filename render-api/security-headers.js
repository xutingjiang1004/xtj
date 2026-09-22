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
  // 审计 🟡 CSP 记录（部分收敛，M-2）：
  //   ★ 2026-09-13 已完成：gsap 外部脚本（js/core-parts/01-bootstrap.js）补齐 SRI
  //     （sha384，随固定版本 gsap@3.12.5 绑定，注入 integrity + crossOrigin）。
  //     校验失败时仅动画降级，不崩站。有 tests/gsap-sri-contract.test.js 锁定。
  //   ⏳ 仍待排期：'unsafe-inline' 暂未移除——前端内联脚本与 on* 事件属性规模较大
  //     （实测 index.html 3 个内联 <script> + 95 个 on* 属性；admin.html 25 个 on*；
  //     13 个 JS 模块内另有约 232 处动态生成的 on* 属性，集中在 admin.js 108 处、
  //     core.js 50 处）。移除需先把这些全部改为 addEventListener / 事件委托，
  //     再配合 nonce 白名单，属独立改造工程，需与前端一起排期。
  //     在此之前 CSP 对 XSS 的兜底能力有限，主防线仍是 ai-sanitize.js + 各处转义。
  //   jsdelivr / npmmirror / Google Fonts 均为历史放行源：
  //   ★ 2026-09-23 收敛（第一轮）：`registry.npmmirror.com` 已从 script-src / style-src /
  //     font-src 全部移除。核实：全仓（排除 mcp-servers/*/package-lock.json 这类构建期
  //     产物）无任何运行时引用；`monaco` 全仓 0 命中，原 font-src 注释理由
  //     「Monaco loads its codicon font」不成立。
  //   ★ 2026-09-23 收敛（第二轮）：Google Fonts 两个域名同样移除。核实：
  //     ① css/ 下无任何 @font-face / @import；② 全站 font-family 为系统字体栈
  //     （-apple-system / BlinkMacSystemFont / "SF Pro Display" / "PingFang SC" / sans-serif）；
  //     ③ 唯一提及 Google Fonts 的是 js/core-parts/06-chat-and-nav.js:3252 的一行
  //     **更新日志文本**（"引入 Google Fonts Great Vibes 手写字体"），而 `Great Vibes`
  //     字体引用与 `.idol-` 命名空间均已从代码库移除 —— 即该字体从未被真正加载。
  //   现各指令只剩真正会被请求的来源：jsdelivr（gsap@3.12.5，已加 SRI）。
  //   script-src 对第三方 CDN 无法做路径级收窄（CSP 规范忽略 script-src 的路径）。
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https:",
  "media-src 'self' https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  // frame-src 放行同源与 blob:
  "frame-src 'self' blob:",
  // WebLLM 本地 Qwen：模型元数据在 huggingface.co，权重会重定向到区域 *.hf.co CDN，WASM 模型库在 raw.githubusercontent.com。
  "connect-src 'self' https://xtj.onrender.com https://ithowxqignlhkwaykglt.supabase.co wss://ithowxqignlhkwaykglt.supabase.co https://huggingface.co https://*.hf.co https://raw.githubusercontent.com",
  // jsdelivr 为 gsap 脚本来源；本站无外链字体（全站系统字体栈），故 font-src 只留 self。
  "font-src 'self'",
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
