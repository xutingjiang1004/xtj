const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TERSER = path.resolve(ROOT, 'node_modules', '.bin', 'terser');

const JS_FILES = [
  'js/core.js',
  'js/performance.js',
  'js/features.js',
  'js/photo-wall/data.js',
  'js/photo-wall/render.js',
  'js/photo-wall/upload.js',
  'js/photo-wall/preview.js',
  'js/photo-wall/photo-wall.js',
  'js/admin/admin.js'
];

const CSS_FILE = 'css/style.css';

function minifyJS(filePath) {
  const fullPath = path.resolve(ROOT, filePath);
  if (!fs.existsSync(fullPath)) {
    console.log(`[SKIP] ${filePath} not found`);
    return false;
  }
  const outPath = fullPath.replace(/\.js$/, '.min.js');
  const statsBefore = fs.statSync(fullPath).size;
  console.log(`[MINIFY] ${filePath} (${(statsBefore / 1024).toFixed(0)}KB)`);
  try {
    execSync(
      `"${TERSER}" "${fullPath}" --compress --mangle --output "${outPath}"`,
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

function minifyCSS(filePath) {
  const fullPath = path.resolve(ROOT, filePath);
  if (!fs.existsSync(fullPath)) {
    console.log(`[SKIP] ${filePath} not found`);
    return false;
  }
  const outPath = fullPath.replace(/\.css$/, '.min.css');
  const statsBefore = fs.statSync(fullPath).size;
  console.log(`[MINIFY-CSS] ${filePath} (${(statsBefore / 1024).toFixed(0)}KB)`);
  try {
    const csso = path.resolve(ROOT, 'node_modules', '.bin', 'csso');
    if (!fs.existsSync(csso)) {
      console.log('  csso not installed, trying clean-css...');
      const cleanCSS = path.resolve(ROOT, 'node_modules', '.bin', 'cleancss');
      if (!fs.existsSync(cleanCSS)) {
        console.log('  No CSS minifier available, skipping CSS minification.');
        return false;
      }
      execSync(
        `"${cleanCSS}" -o "${outPath}" "${fullPath}"`,
        { stdio: 'pipe', timeout: 30000 }
      );
    } else {
      execSync(
        `"${csso}" "${fullPath}" --output "${outPath}"`,
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

// Minify JS
console.log('--- Minifying JS ---');
JS_FILES.forEach(minifyJS);

// Minify CSS
console.log('\n--- Minifying CSS ---');
minifyCSS(CSS_FILE);

console.log('\n=== Build Complete ===');
