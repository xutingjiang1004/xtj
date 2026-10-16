'use strict';

// Pages receives an allowlisted artifact, never the repository root.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { SECURITY_HEADERS } = require('../render-api/security-headers');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output', 'cloudflare-pages');
const ROOT_FILES = new Set(['index.html', 'admin.html', 'icon.svg', 'media-originals-sw.js', 'chat-notifications-sw.js']);
function allowed(file) {
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
  const headers = Object.entries(SECURITY_HEADERS).map(([key, value]) => `  ${key}: ${value}`).join('\n');
  fs.writeFileSync(path.join(OUT, '_headers'), `/*\n${headers}\n  Cache-Control: no-cache\n  X-Robots-Tag: noindex, nofollow\n`);
  // Preview deliberately has no production bindings or automatic Render fallback.
  fs.writeFileSync(path.join(OUT, '_worker.js'), `export default { async fetch(request) {
    const headers = ${JSON.stringify({...SECURITY_HEADERS, 'Cache-Control':'no-store, private', 'Content-Type':'application/json; charset=utf-8', 'X-Robots-Tag':'noindex, nofollow'})};
    return new Response(request.method === 'HEAD' ? null : JSON.stringify({ok:false, code:'preview_backend_unavailable', error:'预览后端尚未迁移，此环境不能用于生产。'}), {status:503, headers});
  }};\n`);
  fs.writeFileSync(path.join(OUT, '_routes.json'), JSON.stringify({ version: 1, include: ['/api', '/api/*', '/health', '/health/*', '/share/*'], exclude: [] }, null, 2) + '\n');
  console.log(`Pages preview: ${files.length} assets, ${bytes} bytes, ${path.relative(ROOT, OUT)}`);
  return { out: OUT, files, bytes };
}
if (require.main === module) buildPages();
module.exports = { buildPages, allowed };
