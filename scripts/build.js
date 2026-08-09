const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 直接用 node + 真实 JS 入口执行压缩器（数组参数方式），彻底规避 cmd.exe 转义/引号问题。
// csso v5+ 已将 CLI 拆分到 csso-cli 包，.bin shim 实际指向 csso-cli/bin/csso。
function resolveNodeBin(pkgEntry, binPath) {
  try {
    return path.resolve(path.dirname(require.resolve(pkgEntry + '/package.json')), binPath);
  } catch (_) {
    return null;
  }
}
const TERSER = resolveNodeBin('terser', 'bin/terser');
const CSSO = resolveNodeBin('csso-cli', 'bin/csso');
const CLEAN_CSS = resolveNodeBin('clean-css', 'bin/cleancss');


function lfNormalize(content) {
  return String(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function contentHash(filePath) {
  const fullPath = path.resolve(ROOT, filePath);
  if (!fs.existsSync(fullPath)) return null;
  // 对 LF 归一化后的内容计算 hash，使指纹与行尾（CRLF/LF）无关，
  // 避免 Windows core.autocrlf 击穿产物 hash 指纹。
  return crypto.createHash('sha256').update(lfNormalize(fs.readFileSync(fullPath, 'utf8'))).digest('hex').slice(0, 10);
}

function minifiedPath(filePath) {
  if (/\.min\.(css|js)$/.test(filePath)) return filePath;
  return filePath.replace(/\.css$/, '.min.css').replace(/\.js$/, '.min.js');
}

const HTML_ENTRYPOINTS = ['index.html', 'admin.html'];

// 引用了但缺失的资产清单：contentHash 返回 null 时记录，最终升级为 error，
// 不静默保留旧 hash（避免 minify 失败/文件缺失时 HTML 仍带着过期指纹上线）。
const missingAssets = [];

function localAssetRefs(html) {
  const refs = [];
  html.replace(/\b(href|src|content)="((?:css|js)\/[^"?#]+\.(?:css|js))(?:\?v=[^"#]*)?"/g, function(match, attr, assetPath) {
    refs.push({ attr: attr, assetPath: assetPath });
    return match;
  });
  return refs;
}

function updateHtmlAssetVersions(htmlFile) {
  const htmlPath = path.resolve(ROOT, htmlFile);
  if (!fs.existsSync(htmlPath)) return false;
  let html = fs.readFileSync(htmlPath, 'utf8');
  let changed = false;
  html = html.replace(/\b(href|src|content)="((?:css|js)\/[^"?#]+\.(?:css|js))(?:\?v=[^"#]*)?"/g, function(match, attr, assetPath) {
    const hash = contentHash(assetPath);
    if (!hash) {
      missingAssets.push(assetPath + ' (referenced by ' + htmlFile + ')');
      return match;
    }
    const next = attr + '="' + assetPath + '?v=' + hash + '"';
    if (next !== match) changed = true;
    return next;
  });
  if (changed) {
    // 保留原文件的行尾风格（CRLF/LF），避免 Windows 下整文件换行噪音
    const hadCRLF = /\r\n/.test(html);
    html = html.replace(/\r\n?/g, '\n');
    if (!html.endsWith('\n')) html += '\n';
    if (hadCRLF) html = html.replace(/\n/g, '\r\n');
    fs.writeFileSync(htmlPath, html, 'utf8');
    console.log('[HASH] ' + htmlFile + ' local CSS/JS query strings updated');
  } else {
    console.log('[HASH] ' + htmlFile + ' local CSS/JS query strings already current');
  }
  return changed;
}

function validateHtmlMinifiedRefs(htmlFile) {
  const htmlPath = path.resolve(ROOT, htmlFile);
  if (!fs.existsSync(htmlPath)) return true;
  const html = fs.readFileSync(htmlPath, 'utf8');
  const errors = [];
  localAssetRefs(html).forEach(function(ref) {
    const nextMin = minifiedPath(ref.assetPath);
    if (nextMin === ref.assetPath) return;
    if (!fs.existsSync(path.resolve(ROOT, nextMin))) {
      errors.push(ref.assetPath + ' references the source file but has no minified sibling ' + nextMin + '; add it to JS_FILES/CSS_FILES so the build produces the .min artifact');
      return;
    }
    errors.push(ref.assetPath + ' should use ' + nextMin);
  });
  if (!errors.length) {
    console.log('[CHECK] ' + htmlFile + ' minified asset refs OK');
    return true;
  }
  errors.forEach(function(msg) {
    console.error('[CHECK] ' + msg);
  });
  return false;
}

const JS_FILES = [
  'js/core-utils.js',
  'js/core.js',
  'js/performance.js',
  'js/features.js',
  'js/core-animations.js',
  'js/ui-effects.js',
  'js/login-device.js',
   'js/ai-agent.js',
  'js/theme-toggle.js',
  'js/desktop-shell.js',
  'js/config.js',
  'js/photo-wall/data.js',
  'js/photo-wall/render.js',
  'js/photo-wall/photo-wall.js',
  'js/photo-wall/upload-ui.js',
  'js/photo-wall/preview.js',
  'js/photo-wall/preview-hotfix.js',
  'js/admin/admin.js',
  'js/code-file-system.js',
  'js/code-workspace.js',
  'js/ai-core/errors.js',
  'js/ai-core/request-controller.js',
  'js/ai-core/transport.js',
  'js/ai-core/markdown-renderer.js',
  'js/ai-core/scroll-controller.js',
  'js/ai-core/stream-renderer.js',
  'js/ai-core/telemetry.js'
];

// ★ 修复（Bug 2）：前端直连 Supabase 的 ANON key 注入。
// 仓库是 public repo，config.js 与 core.js（XTJ_RUNTIME_CONFIG 默认值）中仅保留
// 占位符（eyJhbG...yDDA）作为安全默认；构建时若设置了 SUPABASE_ANON_KEY 环境变量，
// 则替换占位符后压缩，使 feed 失败回退 / 浏览统计 RPC / 照片墙统计等直连功能在生产可用。
// 未设置时保持占位符（功能静默降级，但绝不泄露真实 key 到源码）。
// 同时注入 js/config.js 和 js/core.js（两处占位符均为带引号的 "eyJhbG...yDDA"）。
var CONFIG_ANON_PLACEHOLDER = 'eyJhbG...yDDA';
function injectConfigSecrets(source, filePath) {
  if (filePath !== 'js/config.js' && filePath !== 'js/core.js') return source;
  var anonKey = process.env.SUPABASE_ANON_KEY || '';
  anonKey = String(anonKey).trim();
  if (!anonKey || anonKey.indexOf('...') !== -1 || anonKey === CONFIG_ANON_PLACEHOLDER) {
    return source;
  }
  var occurrences = source.split(CONFIG_ANON_PLACEHOLDER).length - 1;
  if (occurrences > 0) {
    var injected = source.split(CONFIG_ANON_PLACEHOLDER).join(anonKey);
    console.log('[INJECT] SUPABASE_ANON_KEY: replaced ' + occurrences + ' placeholder occurrence(s) in ' + filePath + ' (from env)');
    return injected;
  }
  // 占位符不存在时绝不能假装成功：源文件可能已被误写入真实 key（泄漏风险）
  console.warn('[INJECT] WARNING: placeholder (' + CONFIG_ANON_PLACEHOLDER + ') NOT found in ' + filePath + ' - nothing injected; check that ' + filePath + ' still holds the placeholder');
  return source;
}

const CSS_FILES = [
  'css/style.css',
  'css/ui-enhance.css',
  'css/desktop.css',
  'css/visual-refinements.css',
  'css/admin.css',
  'css/ai-agent.css',
  'css/ui-shell.css',
  'css/photo-preview.css',
  'css/code-workspace.css',
  'css/code-claude-style.css'
];

function minifyJS(filePath, optional) {
  const fullPath = path.resolve(ROOT, filePath);
  if (!fs.existsSync(fullPath)) {
    if (optional) {
      console.log(`[SKIP] ${filePath} not found (optional)`);
      return null;
    }
    console.error(`[FAIL] ${filePath} not found (core file)`);
    return false;
  }
  const outPath = fullPath.replace(/\.js$/, '.min.js');
  var tempInputPath = null;
  var tempOutPath = null;
  const statsBefore = fs.statSync(fullPath).size;
  console.log(`[MINIFY] ${filePath} (${(statsBefore / 1024).toFixed(0)}KB)`);
  try {
    if (!TERSER) throw new Error('terser binary not found (run npm install)');
    var normalizedSource = fs.readFileSync(fullPath, 'utf8').replace(/\x0d\n?/g, '\n');
    // 指纹注释记录 LF 归一化源码哈希（注入前），供 check-build-consistency 校验产物新鲜度
    var fingerprint = crypto.createHash('sha256').update(normalizedSource).digest('hex');
    // ★ 修复（Bug 2）：config.js / core.js 构建时注入 SUPABASE_ANON_KEY（若有设置）
    normalizedSource = injectConfigSecrets(normalizedSource, filePath);
    var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xtj-js-'));
    tempInputPath = path.join(tempDir, path.basename(fullPath));
    // 临时输出放目标同目录，rename 才能同卷原子替换（跨盘 rename 会抛 EXDEV）
    tempOutPath = outPath + '.tmp-' + process.pid;
    fs.writeFileSync(tempInputPath, normalizedSource, 'utf8');
    // execFileSync(process.execPath, [真实JS入口, ...args]) 数组参数方式，规避 cmd.exe 转义问题
    execFileSync(
      process.execPath,
      [TERSER, tempInputPath, '--compress', '--mangle', '--output', tempOutPath],
      { stdio: 'pipe', timeout: 30000 }
    );
    if (fs.existsSync(tempOutPath)) {
      var outRaw = fs.readFileSync(tempOutPath, 'utf8');
      var outNormalized = outRaw.replace(/\r\n?/g, '\n');
      if (!outNormalized.endsWith('\n')) outNormalized += '\n';
      outNormalized += '/*# src=' + fingerprint + ' */\n';
      fs.writeFileSync(tempOutPath, outNormalized, 'utf8');
      // 全部成功后再原子替换；失败时保留旧产物（不 unlink），
      // 缺失/陈旧引用由 contentHash 返回 null 时升级为 error。
      fs.renameSync(tempOutPath, outPath);
      tempOutPath = null;
      const statsAfter = fs.statSync(outPath).size;
      const saved = ((statsBefore - statsAfter) / statsBefore * 100).toFixed(0);
      console.log(`  => ${(statsAfter / 1024).toFixed(0)}KB (压缩 ${saved}%)`);
    }
    return true;
  } catch (e) {
    console.error(`  => ERROR: ${e.message}`);
    if (e.stderr) console.error('  stderr: ' + e.stderr.toString());
    return false;
  } finally {
    if (tempOutPath) {
      try { fs.unlinkSync(tempOutPath); } catch (_) {}
    }
    if (tempInputPath) {
      try { fs.rmSync(path.dirname(tempInputPath), { recursive: true, force: true }); } catch (_) {}
    }
  }
}

function minifyCSS(filePath, optional) {
  const fullPath = path.resolve(ROOT, filePath);
  if (!fs.existsSync(fullPath)) {
    if (optional) {
      console.log(`[SKIP] ${filePath} not found (optional)`);
      return null;
    }
    console.error(`[FAIL] ${filePath} not found (core file)`);
    return false;
  }
  const outPath = fullPath.replace(/\.css$/, '.min.css');
  var tempInputPath = null;
  var tempOutPath = null;
  const statsBefore = fs.statSync(fullPath).size;
  console.log(`[MINIFY-CSS] ${filePath} (${(statsBefore / 1024).toFixed(0)}KB)`);
  try {
    // Git checks out text files with platform-specific line endings. Some CSS
    // constructs preserve enough whitespace for CSSO to emit different bytes
    // on Windows and Linux, which makes cache hashes and CI non-deterministic.
    // Always minify an LF-normalized temporary input and remove it afterward.
    var normalizedSource = fs.readFileSync(fullPath, 'utf8').replace(/\r\n?/g, '\n');
    // 指纹注释记录 LF 归一化源码哈希，供 check-build-consistency 校验产物新鲜度
    var fingerprint = crypto.createHash('sha256').update(normalizedSource).digest('hex');
    var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xtj-css-'));
    tempInputPath = path.join(tempDir, path.basename(fullPath));
    // 临时输出放目标同目录，rename 才能同卷原子替换（跨盘 rename 会抛 EXDEV）
    tempOutPath = outPath + '.tmp-' + process.pid;
    fs.writeFileSync(tempInputPath, normalizedSource, 'utf8');
    if (!CSSO || !fs.existsSync(CSSO)) {
      console.log('  csso not installed, trying clean-css...');
      if (!CLEAN_CSS || !fs.existsSync(CLEAN_CSS)) {
        console.log('  No CSS minifier available, skipping CSS minification.');
        return false;
      }
      execFileSync(process.execPath, [CLEAN_CSS, '-o', tempOutPath, tempInputPath], { stdio: 'pipe', timeout: 30000 });
    } else {
      execFileSync(process.execPath, [CSSO, tempInputPath, '--output', tempOutPath], { stdio: 'pipe', timeout: 30000 });
    }
    if (fs.existsSync(tempOutPath)) {
      var cssRaw = fs.readFileSync(tempOutPath, 'utf8');
      var cssNormalized = cssRaw.replace(/\r\n?/g, '\n');
      if (!cssNormalized.endsWith('\n')) cssNormalized += '\n';
      cssNormalized += '/*# src=' + fingerprint + ' */\n';
      fs.writeFileSync(tempOutPath, cssNormalized, 'utf8');
      // 全部成功后再原子替换；失败时保留旧产物（不 unlink）
      fs.renameSync(tempOutPath, outPath);
      tempOutPath = null;
      const statsAfter = fs.statSync(outPath).size;
      const saved = ((statsBefore - statsAfter) / statsBefore * 100).toFixed(0);
      console.log(`  => ${(statsAfter / 1024).toFixed(0)}KB (压缩 ${saved}%)`);
    }
    return true;
  } catch (e) {
    console.error(`  => ERROR: ${e.message}`);
    if (e.stderr) console.error('  stderr: ' + e.stderr.toString());
    return false;
  } finally {
    if (tempOutPath) {
      try { fs.unlinkSync(tempOutPath); } catch (_) {}
    }
    if (tempInputPath) {
      try { fs.rmSync(path.dirname(tempInputPath), { recursive: true, force: true }); } catch (_) {}
    }
  }
}

// 可选文件（缺失不报错）
const OPTIONAL_JS = ['js/photo-wall/upload-ui.js', 'js/photo-wall/preview.js', 'js/photo-wall/preview-hotfix.js'];
const OPTIONAL_CSS = [];

// 供 check-build-consistency.js 复用构建清单（避免两处维护导致遗漏）
module.exports = {
  JS_FILES: JS_FILES,
  CSS_FILES: CSS_FILES,
  OPTIONAL_JS: OPTIONAL_JS,
  OPTIONAL_CSS: OPTIONAL_CSS,
  HTML_ENTRYPOINTS: HTML_ENTRYPOINTS,
  contentHash: contentHash
};

// 只有作为主入口直接运行 build.js 时才执行构建，
// require('./build.js')（check-build-consistency）不产生副作用。
if (require.main === module) {
  console.log('=== xtj Build Script ===\n');
  console.log(`Source: ${ROOT}\n`);

  // Assemble core.js from js/core-parts before minify (source-of-truth split).
  try {
    const { assemble } = require('./assemble-core');
    console.log('--- Assembling core.js ---');
    assemble();
  } catch (e) {
    console.error('[assemble-core] failed:', e && e.message);
    process.exitCode = 1;
  }

  // Minify JS
  console.log('--- Minifying JS ---');
  const jsResults = JS_FILES.map(function(f) { return minifyJS(f, OPTIONAL_JS.indexOf(f) >= 0); });

  // Minify CSS
  console.log('\n--- Minifying CSS ---');
  const cssResults = CSS_FILES.map(function(f) { return minifyCSS(f, OPTIONAL_CSS.indexOf(f) >= 0); });

  // L5 修复：htmlAssetsUpdated 结果仅作日志用（原为未使用变量）
  const htmlAssetsUpdated = HTML_ENTRYPOINTS.map(updateHtmlAssetVersions).some(Boolean);
  if (htmlAssetsUpdated) console.log('[HASH] HTML asset versions were refreshed by this build');
  if (missingAssets.length > 0) {
    console.error('[HASH] ERROR: ' + missingAssets.length + ' referenced asset(s) missing; refusing to keep stale hash:');
    missingAssets.forEach(function(a) { console.error('  - ' + a); });
  }
  const htmlRefsValid = HTML_ENTRYPOINTS.map(validateHtmlMinifiedRefs).every(Boolean);

  const failed = jsResults.concat(cssResults).filter(function(r) { return r === false; }).length
    + (htmlRefsValid ? 0 : 1)
    + missingAssets.length;

  if (failed > 0) {
    console.error(`\n=== Build Complete with ${failed} failed/skipped item(s) ===`);
    process.exitCode = 1;
  } else {
    console.log('\n=== Build Complete ===');
  }
}
