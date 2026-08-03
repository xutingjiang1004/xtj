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
const INDEX_HTML = path.join(ROOT, 'index.html');

// ─── 配置：源码 → 产物映射 ──────────────────────────────
const SOURCE_TO_MIN = {
  'js/desktop-shell.js': 'js/desktop-shell.min.js',
  'js/code-file-system.js': 'js/code-file-system.min.js',
  'js/code-workspace.js': 'js/code-workspace.min.js',
  'css/code-workspace.css': 'css/code-workspace.min.css',
  'js/core.js': 'js/core.min.js',
  'js/features.js': 'js/features.min.js',
  'js/core-animations.js': 'js/core-animations.min.js',
  'js/ui-effects.js': 'js/ui-effects.min.js',
  'js/theme-toggle.js': 'js/theme-toggle.min.js',
  'js/login-device.js': 'js/login-device.min.js',
  'js/ai-agent.js': 'js/ai-agent.min.js',
  'js/performance.js': 'js/performance.min.js',
  'js/config.js': 'js/config.min.js',
   'js/admin/admin.js': 'js/admin/admin.min.js',
  'js/ai-core/errors.js': 'js/ai-core/errors.min.js',
  'js/ai-core/request-controller.js': 'js/ai-core/request-controller.min.js',
  'js/ai-core/transport.js': 'js/ai-core/transport.min.js',
  'js/ai-core/markdown-renderer.js': 'js/ai-core/markdown-renderer.min.js',
  'js/ai-core/scroll-controller.js': 'js/ai-core/scroll-controller.min.js',
  'js/ai-core/stream-renderer.js': 'js/ai-core/stream-renderer.min.js',
  'js/ai-core/telemetry.js': 'js/ai-core/telemetry.min.js',
  'css/style.css': 'css/style.min.css',
  'css/desktop.css': 'css/desktop.min.css',
  'css/ai-agent.css': 'css/ai-agent.min.css',
  'css/visual-refinements.css': 'css/visual-refinements.min.css',
  'css/ui-enhance.css': 'css/ui-enhance.min.css',
  'css/ui-shell.css': 'css/ui-shell.min.css',
  'css/photo-preview.css': 'css/photo-preview.min.css',
  'css/admin.css': 'css/admin.min.css',
};

// photo-wall 特殊映射
const PHOTO_WALL_SOURCES = {
  'js/photo-wall/data.js': 'js/photo-wall/data.min.js',
  'js/photo-wall/render.js': 'js/photo-wall/render.min.js',
  'js/photo-wall/photo-wall.js': 'js/photo-wall/photo-wall.min.js',
  'js/photo-wall/upload-ui.js': 'js/photo-wall/upload-ui.min.js',
  'js/photo-wall/preview.js': 'js/photo-wall/preview.min.js',
  'js/photo-wall/preview-hotfix.js': 'js/photo-wall/preview-hotfix.min.js',
};

Object.assign(SOURCE_TO_MIN, PHOTO_WALL_SOURCES);

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

function fileSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function fileSha256Short(filePath) {
  return fileSha256(filePath).substring(0, 10).toLowerCase();
}

// ─── 1. 检查源码 → 产物时间戳 ──────────────────────────────
console.log('\n=== 1. 源码 vs 产物时间戳检查 ===');
for (const [src, min] of Object.entries(SOURCE_TO_MIN)) {
  const srcPath = path.join(ROOT, src);
  const minPath = path.join(ROOT, min);

  if (!fileExists(srcPath)) {
    warn('Source file not found: ' + src);
    continue;
  }
  if (!fileExists(minPath)) {
    error('Min file not found: ' + min + ' (source: ' + src + ')');
    continue;
  }

  const srcStat = fs.statSync(srcPath);
  const minStat = fs.statSync(minPath);

  // FAT/exFAT 时间戳粒度 2 秒，容忍 2.5s 以内的差值避免误报
  if (srcStat.mtimeMs - minStat.mtimeMs > 2500) {
    error('Source newer than min file: ' + src + ' (' + srcStat.mtime.toISOString() + ') > ' + min + ' (' + minStat.mtime.toISOString() + ')');
  } else {
    console.log('  OK: ' + src + ' -> ' + min);
  }
}

// ─── 2. 检查 HTML 引用的 Hash ─────────────────────────
const HTML_FILES = ['index.html', 'admin.html'];
const scriptRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/g;
const linkRegex = /<link[^>]+href=["']([^"']+)["'][^>]*>/g;
const metaRegex = /<meta[^>]+name=["']([^"']+)["'][^>]+content=["']([^"']+)["'][^>]*>/g;

function checkHtmlHashes(htmlFile) {
  console.log('\n=== 2.' + (HTML_FILES.indexOf(htmlFile) + 1) + '. ' + htmlFile + ' Hash 一致性检查 ===');
  const htmlPath = path.join(ROOT, htmlFile);
  if (!fileExists(htmlPath)) {
    error('HTML file not found: ' + htmlFile);
    return '';
  }
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  const resourceRefs = [];

  // 从 script 标签提取
  let match;
  scriptRegex.lastIndex = 0;
  while ((match = scriptRegex.exec(htmlContent)) !== null) {
    const src = match[1];
    if (src.includes('v=')) {
      resourceRefs.push({ type: 'script', fullPath: src, tag: 'script' });
    }
  }

  // 从 link 标签提取
  linkRegex.lastIndex = 0;
  while ((match = linkRegex.exec(htmlContent)) !== null) {
    const href = match[1];
    if (href.includes('v=') && href.endsWith('.css')) {
      resourceRefs.push({ type: 'css', fullPath: href, tag: 'link' });
    }
  }

  // 从 meta 标签提取
  metaRegex.lastIndex = 0;
  while ((match = metaRegex.exec(htmlContent)) !== null) {
    const name = match[1];
    const content = match[2];
    if (content.includes('v=') && (content.endsWith('.js') || content.endsWith('.css'))) {
      resourceRefs.push({ type: 'meta', fullPath: content, metaName: name, tag: 'meta' });
    }
  }

  for (const ref of resourceRefs) {
    const urlPart = ref.fullPath.split('?v=')[0];
    const hashPart = ref.fullPath.split('?v=')[1];
    const filePath = path.join(ROOT, urlPart);

    if (!fileExists(filePath)) {
      error('File referenced in ' + htmlFile + ' not found: ' + urlPart + ' (from ' + ref.tag + ')');
      continue;
    }

    const actualHash = fileSha256Short(filePath);
    if (actualHash !== hashPart) {
      error('Hash mismatch for ' + urlPart + ': expected ' + actualHash + ' but got ' + hashPart + ' (from ' + ref.tag + ', ' + htmlFile + ')');
    } else {
      console.log('  OK: ' + urlPart + '?v=' + hashPart);
    }
  }

  return htmlContent;
}

const htmlContent = checkHtmlHashes('index.html');
checkHtmlHashes('admin.html');

// ─── 3. 检查 Code 模块专用 meta 配置 ────────────────────────
console.log('\n=== 3. Code 模块 meta 配置检查 ===');
const codeMetaNames = [
  'xtj-module-code-fs',
  'xtj-module-code-workspace',
  'xtj-module-code-style'
];

for (const metaName of codeMetaNames) {
  const metaTag = htmlContent.match(new RegExp('<meta[^>]+name="' + metaName + '"[^>]+content="([^"]+)"[^>]*>'));
  if (!metaTag) {
    error('Missing meta tag: ' + metaName);
    continue;
  }
  const content = metaTag[1];
  const filePath = path.join(ROOT, content.split('?v=')[0]);
  if (!fileExists(filePath)) {
    error('Code module file not found: ' + content + ' (meta: ' + metaName + ')');
  } else {
    console.log('  OK: ' + metaName + ' = ' + content);
  }
}

// ─── 4. 检查关键模块导出 ────────────────────────────────────
console.log('\n=== 4. 关键模块导出检查 ===');
function checkSourceExport(filePath, exportName) {
  const fullPath = path.join(ROOT, filePath);
  if (!fileExists(fullPath)) return false;
  const content = fs.readFileSync(fullPath, 'utf-8');
  return content.includes('window.' + exportName + ' =') || content.includes('window[\'' + exportName + '\']');
}

const requiredExports = [
  { file: 'js/code-file-system.js', name: '__xtjCodeFS', api: 'readFileByPath' },
  { file: 'js/code-workspace.js', name: '__xtjCodeWorkspaceAPI', api: 'init' },
  { file: 'js/code-workspace.js', name: '__xtjCodeInit' },
];

for (const exp of requiredExports) {
  if (checkSourceExport(exp.file, exp.name)) {
    console.log('  OK: ' + exp.file + ' exports ' + exp.name);
  } else {
    error('Missing export ' + exp.name + ' in ' + exp.file);
  }
}

// ─── 5. 检查 desktop-shell.js 关键功能 ──────────────────────
console.log('\n=== 5. desktop-shell 关键功能检查 ===');
const dshellPath = path.join(ROOT, 'js/desktop-shell.js');
const dshellMinPath = path.join(ROOT, 'js/desktop-shell.min.js');

if (fileExists(dshellPath) && fileExists(dshellMinPath)) {
  const dshellContent = fs.readFileSync(dshellPath, 'utf-8');
  const dshellMinContent = fs.readFileSync(dshellMinPath, 'utf-8');

  const checks = [
    { name: 'loadModuleWithTimeout', pattern: 'loadModuleWithTimeout' },
    { name: 'per-module state tracking', pattern: 'modules:' },
    { name: 'detailed timeout error', pattern: '已等待' },
    { name: 'code error listeners', pattern: '_installCodeErrorListeners' },
    { name: 'pending promise tracking', pattern: '_pendingModulePromises' },
    { name: 'script deduplication', pattern: 'data-xtj-loading' },
    { name: 'CSS multi-dimension verify', pattern: 'code-welcome' },
    { name: 'currentTab tracking', pattern: 'currentTab' },
    { name: 'dual visibility check', pattern: 'offsetParent' },
    { name: 'retry function', pattern: 'retryCodeModuleLoad' },
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
    if (check.pattern === '已等待' || check.pattern === 'data-xtj-loading' || check.pattern === 'code-welcome') {
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