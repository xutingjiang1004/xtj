/**
 * 构建一致性检查脚本
 * 
 * 检查:
 * 1. 源码变更后对应 min.js / min.css 是否同步更新
 * 2. index.html 的资源 Hash 是否与文件内容一致
 * 3. index.html 引用的文件是否存在
 * 4. 禁止源码与压缩产物不一致
 * 
 * 检查失败时，exit code 非 0，CI 必须失败。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

// ─── 配置：源码 → 产物映射 ──────────────────────────────
// 清单与 build.js 共享（require build.js 导出的 JS_FILES/CSS_FILES），
// 避免两处维护导致遗漏。
const buildManifest = require('./build.js');
const JS_FILES = buildManifest.JS_FILES || [];
const CSS_FILES = buildManifest.CSS_FILES || [];
const OPTIONAL_JS = buildManifest.OPTIONAL_JS || [];
const HTML_FILES = buildManifest.HTML_ENTRYPOINTS || ['index.html', 'admin.html'];

const SOURCE_TO_MIN = {};
JS_FILES.forEach(function (f) { SOURCE_TO_MIN[f] = f.replace(/\.js$/, '.min.js'); });
CSS_FILES.forEach(function (f) { SOURCE_TO_MIN[f] = f.replace(/\.css$/, '.min.css'); });

// 可选对：源与 min 同时缺失（或 min 缺失）时降级 warn，不 exit 1
const OPTIONAL_PAIRS = new Set(OPTIONAL_JS);

let errors = [];
let warnings = [];

function error(msg) {
  errors.push(msg);
  console.error('  ERROR: ' + msg);
}

function warn(msg) {
  warnings.push(msg);
  console.warn('  WARN: ' + msg);
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

function lfNormalize(content) {
  return String(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function fileSha256(filePath) {
  // 与 build.js contentHash 一致：对 LF 归一化内容计算，行尾不参与指纹
  return crypto.createHash('sha256').update(lfNormalize(fs.readFileSync(filePath, 'utf8'))).digest('hex');
}

function fileSha256Short(filePath) {
  return fileSha256(filePath).substring(0, 10).toLowerCase();
}

// 解析 build.js 写入产物末尾的指纹注释：/*# src=<64位LF归一化源码sha256> */
function parseSrcFingerprint(minContent) {
  const m = /\/\*#\s+src=([0-9a-f]{64})\s*\*\//.exec(minContent);
  return m ? m[1].toLowerCase() : null;
}

// ─── 1. 检查源码 → 产物内容指纹 ──────────────────────────────
console.log('\n=== 1. 源码 vs 产物指纹检查 ===');
for (const [src, min] of Object.entries(SOURCE_TO_MIN)) {
  const srcPath = path.join(ROOT, src);
  const minPath = path.join(ROOT, min);
  const isOptional = OPTIONAL_PAIRS.has(src);

  if (!fileExists(srcPath)) {
    // 可选文件源与 min 同时缺失时降级 warn（不 exit 1）
    warn('Source file not found: ' + src);
    continue;
  }
  if (!fileExists(minPath)) {
    if (isOptional) {
      warn('Optional min file not found: ' + min + ' (source: ' + src + '; run build.js to produce it)');
    } else {
      error('Min file not found: ' + min + ' (source: ' + src + '; run build.js)');
    }
    continue;
  }

  // 基于 build.js 写入的 /*# src=<sha256> */ 指纹注释校验产物新鲜度（mtime 不可靠）
  const minContent = fs.readFileSync(minPath, 'utf8');
  const fingerprint = parseSrcFingerprint(minContent);
  if (!fingerprint) {
    error('Min file has no src fingerprint comment (unable to verify; run build.js first): ' + min);
    continue;
  }
  const srcHash = fileSha256(srcPath);
  if (fingerprint !== srcHash) {
    error('Source changed since min was built: ' + src + ' (min src=' + fingerprint + ', current source=' + srcHash + '; run build.js)');
  } else {
    console.log('  OK: ' + src + ' -> ' + min + ' (fingerprint matches)');
  }
}

// ─── 2. 检查 HTML 引用的 Hash ─────────────────────────
const scriptRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/g;
const linkRegex = /<link[^>]+href=["']([^"']+)["'][^>]*>/g;
const metaRegex = /<meta[^>]+name=["']([^"']+)["'][^>]+content=["']([^"']+)["'][^>]*>/g;

// 准入条件：本地 css/js 路径（非 http(s) 外链、非 data:）
function isLocalAsset(assetUrlPath) {
  return /^(?:css|js)\//.test(assetUrlPath.replace(/^\/+/, ''));
}

// 用 URL 解析取 v 参数（不再依赖字符串搜索 '?v='）
function parseAssetRef(rawRef) {
  try {
    const u = new URL(rawRef, 'http://127.0.0.1');
    return {
      urlPath: u.pathname, // 规范化后的路径（含前导 /，保留原百分号编码）
      version: u.searchParams.get('v')
    };
  } catch (_) {
    return null;
  }
}

function checkHtmlHashes(htmlFile) {
  console.log('\n=== 2.' + (HTML_FILES.indexOf(htmlFile) + 1) + '. ' + htmlFile + ' Hash 一致性检查 ===');
  const htmlPath = path.join(ROOT, htmlFile);
  if (!fileExists(htmlPath)) {
    error('HTML file not found: ' + htmlFile);
    return '';
  }
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  const resourceRefs = [];

  // 从 script 标签提取（仅本地 .js 路径）
  let match;
  scriptRegex.lastIndex = 0;
  while ((match = scriptRegex.exec(htmlContent)) !== null) {
    const src = match[1];
    const parsed = parseAssetRef(src);
    if (!parsed) continue;
    const urlPath = parsed.urlPath.replace(/^\/+/, '');
    if (!isLocalAsset(urlPath) || !urlPath.endsWith('.js')) continue;
    resourceRefs.push({ type: 'script', fullPath: src, urlPath: urlPath, version: parsed.version, tag: 'script' });
  }

  // 从 link 标签提取（仅本地 css/js 路径）
  linkRegex.lastIndex = 0;
  while ((match = linkRegex.exec(htmlContent)) !== null) {
    const href = match[1];
    const parsed = parseAssetRef(href);
    if (!parsed) continue;
    const urlPath = parsed.urlPath.replace(/^\/+/, '');
    if (!isLocalAsset(urlPath) || !(urlPath.endsWith('.css') || urlPath.endsWith('.js'))) continue;
    resourceRefs.push({ type: 'css', fullPath: href, urlPath: urlPath, version: parsed.version, tag: 'link' });
  }

  // 从 meta 标签提取（仅本地 css/js 路径）
  metaRegex.lastIndex = 0;
  while ((match = metaRegex.exec(htmlContent)) !== null) {
    const name = match[1];
    const content = match[2];
    const parsed = parseAssetRef(content);
    if (!parsed) continue;
    const urlPath = parsed.urlPath.replace(/^\/+/, '');
    if (!isLocalAsset(urlPath) || !(urlPath.endsWith('.js') || urlPath.endsWith('.css'))) continue;
    resourceRefs.push({ type: 'meta', fullPath: content, urlPath: urlPath, version: parsed.version, metaName: name, tag: 'meta' });
  }

  for (const ref of resourceRefs) {
    // 本地 css/js 引用必须带 ?v= 版本号
    if (!ref.version) {
      error('Local asset not versioned (no ?v=): ' + ref.fullPath + ' (from ' + ref.tag + ', ' + htmlFile + ')');
      continue;
    }
    const filePath = path.join(ROOT, ref.urlPath);

    if (!fileExists(filePath)) {
      error('File referenced in ' + htmlFile + ' not found: ' + ref.urlPath + ' (from ' + ref.tag + ')');
      continue;
    }

    const actualHash = fileSha256Short(filePath);
    if (actualHash !== ref.version) {
      error('Hash mismatch for ' + ref.urlPath + ': expected ' + actualHash + ' but got ' + ref.version + ' (from ' + ref.tag + ', ' + htmlFile + ')');
    } else {
      console.log('  OK: ' + ref.urlPath + '?v=' + ref.version);
    }
  }

  return htmlContent;
}

const htmlContent = checkHtmlHashes('index.html');
checkHtmlHashes('admin.html');

// ─── 3. 检查关键模块导出 ────────────────────────────────────
console.log('\n=== 3. 关键模块导出检查 ===');
function checkSourceExport(filePath, exportName) {
  const fullPath = path.join(ROOT, filePath);
  if (!fileExists(fullPath)) return false;
  const content = fs.readFileSync(fullPath, 'utf-8');
  return content.includes('window.' + exportName + ' =') || content.includes('window[\'' + exportName + '\']');
}

const requiredExports = [
  { file: 'js/ai-agent.js', name: '__xtjAiAgent', api: 'open' },
];

for (const exp of requiredExports) {
  if (checkSourceExport(exp.file, exp.name)) {
    console.log('  OK: ' + exp.file + ' exports ' + exp.name);
  } else {
    error('Missing export ' + exp.name + ' in ' + exp.file);
  }
}

// ─── 4. 检查 desktop-shell.js 关键功能 ──────────────────────
console.log('\n=== 4. desktop-shell 关键功能检查 ===');
const dshellPath = path.join(ROOT, 'js/desktop-shell.js');
const dshellMinPath = path.join(ROOT, 'js/desktop-shell.min.js');

if (fileExists(dshellPath) && fileExists(dshellMinPath)) {
  const dshellContent = fs.readFileSync(dshellPath, 'utf-8');
  const dshellMinContent = fs.readFileSync(dshellMinPath, 'utf-8');

  const checks = [
    { name: 'openTab function', pattern: 'function openTab' },
    { name: 'syncActiveTab function', pattern: 'function syncActiveTab' },
    { name: 'performRefresh function', pattern: 'function performRefresh' },
    { name: 'dock tab click handling', pattern: 'data-desktop-tab' },
    { name: 'ai-chat action handling', pattern: 'data-desktop-action' },
    { name: 'correct execution order', pattern: 'openTab(tab)' },
  ];

  for (const check of checks) {
    if (dshellContent.includes(check.pattern)) {
      console.log('  OK: ' + check.name + ' found in source');
    } else {
      error('Missing: ' + check.name + ' not found in source');
    }
    // 检查 min.js 是否也包含（允许变量名被混淆）
    // 对于字符串常量，检查 min.js
    if (check.pattern === 'data-desktop-tab' || check.pattern === 'data-desktop-action') {
      if (dshellMinContent.includes(check.pattern)) {
        console.log('  OK: ' + check.name + ' found in min.js');
      } else {
        error('Missing: ' + check.name + ' not found in min.js');
      }
    }
  }
}

// ─── 结果汇总 ────────────────────────────────────────────────
console.log('\n=== 结果汇总 ===');
console.log('  Errors: ' + errors.length);
console.log('  Warnings: ' + warnings.length);

if (errors.length > 0) {
  console.log('\n构建一致性检查失败!');
  console.log('请修复以下错误后重新构建:');
  errors.forEach((e, i) => console.log('  ' + (i + 1) + '. ' + e));
  process.exit(1);
} else {
  console.log('\n构建一致性检查通过!');
  if (warnings.length > 0) {
    console.log('警告 (不影响构建):');
    warnings.forEach((w, i) => console.log('  ' + (i + 1) + '. ' + w));
  }
  process.exit(0);
}