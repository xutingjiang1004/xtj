const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TERSER = path.resolve(ROOT, 'node_modules', '.bin', 'terser');
const CSSO = path.resolve(ROOT, 'node_modules', '.bin', 'csso');
const CLEAN_CSS = path.resolve(ROOT, 'node_modules', '.bin', 'cleancss');

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
  return 'sh ' + quote(binPath) + (quotedArgs ? ' ' + quotedArgs : '');
}

const JS_FILES = [
  'js/core.js',
  'js/performance.js',
  'js/features.js',
  'js/core-animations.js',
  'js/ui-effects.js',
  'js/pro-upgrade.js',
  'js/pro-style.js',
  'js/login-device.js',
  'js/ai-agent.js',
  'js/english-learning.js',
  'js/english-dict.js',
  'js/theme-toggle.js',
  'js/config.js',
  'js/photo-wall/upload-ui.js',
  'js/photo-wall/preview-hotfix.js',
  'js/admin/admin.js'
];

const CSS_FILES = [
  'css/style.css',
  'css/ui-enhance.css',
  'css/pro-style.css',
  'css/desktop.css',
  'css/visual-refinements.css',
  'css/admin.css',
  'css/ai-agent.css',
  'css/english-learning.css'
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
  const statsBefore = fs.statSync(fullPath).size;
  console.log(`[MINIFY-CSS] ${filePath} (${(statsBefore / 1024).toFixed(0)}KB)`);
  try {
    if (!fs.existsSync(CSSO)) {
      console.log('  csso not installed, trying clean-css...');
      if (!fs.existsSync(CLEAN_CSS)) {
        console.log('  No CSS minifier available, skipping CSS minification.');
        return false;
      }
      execSync(
        cliCommand(CLEAN_CSS, ['-o', outPath, fullPath]),
        { stdio: 'pipe', timeout: 30000 }
      );
    } else {
      execSync(
        cliCommand(CSSO, [fullPath, '--output', outPath]),
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
  }
}

console.log('=== xtj Build Script ===\n');
console.log(`Source: ${ROOT}\n`);

// 可选文件（缺失不报错）
const OPTIONAL_JS = ['js/photo-wall/upload-ui.js', 'js/photo-wall/preview-hotfix.js'];
const OPTIONAL_CSS = [];

// Minify JS
console.log('--- Minifying JS ---');
const jsResults = JS_FILES.map(function(f) { return minifyJS(f, OPTIONAL_JS.indexOf(f) >= 0); });

// Minify CSS
console.log('\n--- Minifying CSS ---');
const cssResults = CSS_FILES.map(function(f) { return minifyCSS(f, OPTIONAL_CSS.indexOf(f) >= 0); });

const failed = jsResults.concat(cssResults).filter(function(r) { return r === false; }).length;

if (failed > 0) {
  console.error(`\n=== Build Complete with ${failed} failed/skipped item(s) ===`);
  process.exitCode = 1;
} else {
  console.log('\n=== Build Complete ===');
}
