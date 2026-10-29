'use strict';

// Pages receives an allowlisted artifact, never the repository root.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { SECURITY_HEADERS } = require('../render-api/security-headers');
const { createPreviewWorker } = require('../cloudflare/pages-worker');
const { createAdminVerifier } = require('../cloudflare/admin-verifier');
const { createLoginBackend } = require('../cloudflare/login-backend');
const { createIpLocationTools } = require('../js/ip-location');
const ipCityData = require('../js/ip-city-data');
const { createAdminLoginStore } = require('../render-api/admin-login-ip');
const { REVOKED_TOKEN_MARKER } = require('../render-api/post-markers');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output', 'cloudflare-pages');
// Current product decision retires the manual workbench from production assets.
const RETIRED_FILES = new Set(['css/ai-workbench.css', 'css/ai-workbench.min.css', 'js/ai-core/tool-workbench.js', 'js/ai-core/tool-workbench.min.js']);
const ROOT_FILES = new Set(['index.html', 'admin.html', 'icon.svg', 'media-digest.js', 'media-originals-sw.js', 'chat-notifications-sw.js']);
function allowed(file) {
  if (RETIRED_FILES.has(file)) return false;
  if (file.split('/').some(segment => segment.startsWith('.'))) return false;
  return ROOT_FILES.has(file) || /^(js|css)\/(?!.*(?:^|\/)\.)[a-zA-Z0-9_./-]+\.(?:js|mjs|css)$/.test(file);
}
function buildPages() {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(allowed);
  for (const file of ROOT_FILES) if (!files.includes(file)) throw Error('Missing entrypoint: ' + file);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  let bytes = 0;
  for (const file of files) {
    const source = path.join(ROOT, file);
    if (fs.realpathSync(source) !== source || !fs.lstatSync(source).isFile()) throw Error('Unsafe asset: ' + file);
    const size = fs.statSync(source).size;
    if (size > 25 * 1024 * 1024) throw Error('Pages asset exceeds 25 MiB: ' + file);
    const target = path.join(OUT, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    bytes += size;
  }
  // A top-level 404 prevents Pages treating missing APIs/assets as the SPA shell.
  fs.writeFileSync(path.join(OUT, '404.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>404</title><h1>页面不存在</h1></html>\n');
  // Dock routes are client-side; only these exact paths fall back to the shell.
  // 尾斜杠路径先 301 到规范路径：index.html 用相对路径引用 js/、css/，
  // /photos/ 会被浏览器解析成 /photos/js/… 而 404 白屏。_redirects 按先匹配先生效，
  // 因此规范跳转必须排在 200 回退之前。
  fs.writeFileSync(path.join(OUT, '_redirects'), [
    '/photos/ /photos 301',
    '/chat/ /chat 301',
    '/profile/ /profile 301',
    '/ai/ /ai 301',
    '/posts/ /posts 301',
    '/photos /index.html 200',
    '/chat /index.html 200',
    '/profile /index.html 200',
    '/ai /index.html 200',
    '/posts /index.html 200'
  ].join('\n') + '\n');
  const headers = Object.entries(SECURITY_HEADERS).map(([key, value]) => `  ${key}: ${value}`).join('\n');
  fs.writeFileSync(path.join(OUT, '_headers'), `/*\n${headers}\n  Cache-Control: no-cache\n  X-Robots-Tag: noindex, nofollow\n`);
  // Only the public URL is copied from tracked frontend configuration. Runtime
  // public-key bindings are classified by the Worker; service keys never fall back.
  const configSource = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
  const publicUrl = configSource.match(/SUPABASE_URL\s*:\s*"(https:\/\/[^"\s]+)"/);
  if (!publicUrl) throw Error('Missing public Supabase URL in frontend configuration');
  fs.writeFileSync(path.join(OUT, '_worker.js'), `import * as nodeCrypto from 'node:crypto';\nimport { Buffer } from 'node:buffer';\nconst ipTools = (${createIpLocationTools.toString()})(${JSON.stringify(ipCityData)});\nconst adminIpStore = (${createAdminLoginStore.toString()})(nodeCrypto, ipTools);\nexport default (${createPreviewWorker.toString()})(${JSON.stringify(SECURITY_HEADERS)}, ${JSON.stringify(publicUrl[1])}, (${createAdminVerifier.toString()})(${JSON.stringify(publicUrl[1])}, ${JSON.stringify(REVOKED_TOKEN_MARKER)}), (${createLoginBackend.toString()})(${JSON.stringify(publicUrl[1])}, ${JSON.stringify(REVOKED_TOKEN_MARKER)}, nodeCrypto, Buffer, {}, ipTools, adminIpStore));\n`);
  // Pages canonicalizes admin.html to /admin; exclude both static entry forms
  // explicitly because Pages' wildcard routing can also match the bare prefix.
  fs.writeFileSync(path.join(OUT, '_routes.json'), JSON.stringify({ version: 1, include: ['/api', '/api/*', '/admin/*', '/health', '/health/*', '/share', '/share/*'], exclude: ['/admin', '/admin.html'] }, null, 2) + '\n');
  console.log(`Pages preview: ${files.length} assets, ${bytes} bytes, ${path.relative(ROOT, OUT)}`);
  return { out: OUT, files, bytes };
}
if (require.main === module) buildPages();
module.exports = { buildPages, allowed };
