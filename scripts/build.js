const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TERSER = path.resolve(ROOT, 'node_modules', '.bin', 'terser');
const CSSO = path.resolve(ROOT, 'node_modules', '.bin', 'csso');
const CLEAN_CSS = path.resolve(ROOT, 'node_modules', '.bin', 'cleancss');


function contentHash(filePath) {
  const fullPath = path.resolve(ROOT, filePath);
  if (!fs.existsSync(fullPath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex').slice(0, 10);
}

function minifiedPath(filePath) {
  if (/\.min\.(css|js)$/.test(filePath)) return filePath;
  return filePath.replace(/\.css$/, '.min.css').replace(/\.js$/, '.min.js');
}

const HTML_ENTRYPOINTS = ['index.html', 'admin.html'];

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
    if (!hash) return match;
    const next = attr + '="' + assetPath + '?v=' + hash + '"';
    if (next !== match) changed = true;
    return next;
  });
  if (changed) {
    fs.writeFileSync(htmlPath, html);
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
    if (!fs.existsSync(path.resolve(ROOT, nextMin))) return;
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

function quote(value) {
  return '"' + String(value).replace(/"/g, '\\"') + '"';
}

function cliCommand(binPath, args) {
  const quotedArgs = args.map(quote).join(' ');
  if (process.platform === 'win32') {
    var cmdPath = binPath.endsWith('.cmd') ? binPath : binPath + '.cmd';
    if (!fs.existsSync(cmdPath)) cmdPath = binPath;
    return quote(cmdPath) + (quotedArgs ? ' ' + quotedArgs : '');
  }
  return quote(binPath) + (quotedArgs ? ' ' + quotedArgs : '');
}

const JS_FILES = [
  'js/core.js',
  'js/performance.js',
  'js/features.js',
  'js/core-animations.js',
  'js/ui-effects.js',
  'js/login-device.js',
  'js/ai-agent.js',
  'js/theme-toggle.js',
  'js/config.js',
  'js/photo-wall/data.js',
  'js/photo-wall/render.js',
  'js/photo-wall/photo-wall.js',
  'js/photo-wall/upload-ui.js',
  'js/photo-wall/preview.js',
  'js/photo-wall/preview-hotfix.js',
  'js/admin/admin.js'
];

const CSS_FILES = [
  'css/style.css',
  'css/ui-enhance.css',
  'css/desktop.css',
  'css/visual-refinements.css',
  'css/admin.css',
  'css/ai-agent.css',
  'css/ui-shell.css',
  'css/photo-preview.css'
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
  const statsBefore = fs.statSync(fullPath).size;
  console.log(`[MINIFY] ${filePath} (${(statsBefore / 1024).toFixed(0)}KB)`);
  try {
    execSync(
      cliCommand(TERSER, [fullPath, '--compress', '--mangle', '--output', outPath]),
      { stdio: 'pipe', timeout: 30000 }
    );
    const statsAfter = fs.statSync(outPath).size;
    const saved = ((statsBefore - statsAfter) / statsBefore * 100).toFixed(0);
    console.log(`  => ${(statsAfter / 1024).toFixed(0)}KB (压缩 ${saved}%)`);
    return true;
  } catch (e) {
    console.error(`  => ERROR: ${e.message}`);
    return false;
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
  var normalizedInputPath = null;
  const statsBefore = fs.statSync(fullPath).size;
  console.log(`[MINIFY-CSS] ${filePath} (${(statsBefore / 1024).toFixed(0)}KB)`);
  try {
    // Git checks out text files with platform-specific line endings. Some CSS
    // constructs preserve enough whitespace for CSSO to emit different bytes
    // on Windows and Linux, which makes cache hashes and CI non-deterministic.
    // Always minify an LF-normalized temporary input and remove it afterward.
    var normalizedSource = fs.readFileSync(fullPath, 'utf8').replace(/\r\n?/g, '\n');
    var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xtj-css-'));
    normalizedInputPath = path.join(tempDir, path.basename(fullPath));
    fs.writeFileSync(normalizedInputPath, normalizedSource, 'utf8');
    if (!fs.existsSync(CSSO)) {
      console.log('  csso not installed, trying clean-css...');
      if (!fs.existsSync(CLEAN_CSS)) {
        console.log('  No CSS minifier available, skipping CSS minification.');
        return false;
      }
      execSync(
        cliCommand(CLEAN_CSS, ['-o', outPath, normalizedInputPath]),
        { stdio: 'pipe', timeout: 30000 }
      );
    } else {
      execSync(
        cliCommand(CSSO, [normalizedInputPath, '--output', outPath]),
        { stdio: 'pipe', timeout: 30000 }
      );
    }
    if (fs.existsSync(outPath)) {
      const statsAfter = fs.statSync(outPath).size;
      const saved = ((statsBefore - statsAfter) / statsBefore * 100).toFixed(0);
      console.log(`  => ${(statsAfter / 1024).toFixed(0)}KB (压缩 ${saved}%)`);
    }
    return true;
  } catch (e) {
    console.error(`  => ERROR: ${e.message}`);
    return false;
  } finally {
    if (normalizedInputPath) {
      try { fs.rmSync(path.dirname(normalizedInputPath), { recursive: true, force: true }); } catch (_) {}
    }
  }
}

console.log('=== xtj Build Script ===\n');
console.log(`Source: ${ROOT}\n`);

// 可选文件（缺失不报错）
const OPTIONAL_JS = ['js/photo-wall/upload-ui.js', 'js/photo-wall/preview.js', 'js/photo-wall/preview-hotfix.js'];
const OPTIONAL_CSS = [];

// Minify JS
console.log('--- Minifying JS ---');
const jsResults = JS_FILES.map(function(f) { return minifyJS(f, OPTIONAL_JS.indexOf(f) >= 0); });

// Minify CSS
console.log('\n--- Minifying CSS ---');
const cssResults = CSS_FILES.map(function(f) { return minifyCSS(f, OPTIONAL_CSS.indexOf(f) >= 0); });

const htmlAssetsUpdated = HTML_ENTRYPOINTS.map(updateHtmlAssetVersions).some(Boolean);
const htmlRefsValid = HTML_ENTRYPOINTS.map(validateHtmlMinifiedRefs).every(Boolean);

const failed = jsResults.concat(cssResults).filter(function(r) { return r === false; }).length + (htmlRefsValid ? 0 : 1);

if (failed > 0) {
  console.error(`\n=== Build Complete with ${failed} failed/skipped item(s) ===`);
  process.exitCode = 1;
} else {
  console.log('\n=== Build Complete ===');
}
