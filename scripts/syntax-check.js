'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['js', 'render-api', 'scripts', 'tests'];
const EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'coverage'];

function walk(dir, files) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (EXCLUDE_DIRS.some(e => fullPath.includes(path.sep + e + path.sep) || fullPath.startsWith(e + path.sep))) continue;
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (/\.(js|cjs|mjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

let allFiles = [];
const missingDirs = [];
for (const d of DIRS) {
  const dirPath = path.resolve(ROOT, d);
  if (fs.existsSync(dirPath)) {
    walk(dirPath, allFiles);
  } else {
    missingDirs.push(d);
  }
}

// 任一目标目录缺失或没有可检查文件时，直接失败（避免空跑误报 ALL PASSED）
if (missingDirs.length > 0) {
  console.error('Syntax check: missing directory(ies): ' + missingDirs.join(', '));
  process.exit(1);
}
if (allFiles.length === 0) {
  console.error('Syntax check: no files found under ' + DIRS.join(', '));
  process.exit(1);
}

let failed = 0;
let passed = 0;

for (const file of allFiles) {
  try {
    // .min.js 单独做非空 + node --check 校验，不参与 ESM 探测
    const isMin = /\.min\.js$/.test(file);
    let isEsm = /\.mjs$/.test(file);
    if (!isEsm && !isMin && !/\.cjs$/.test(file)) {
      // .js 文件用放宽的正则探测 ESM（import/export 语句），避免假失败
      isEsm = /^\s*(import|export)\b/m.test(fs.readFileSync(file, 'utf8'));
    }
    if (isMin) {
      if (!fs.statSync(file).size) throw new Error('empty minified file');
      execFileSync('node', ['--check', file], { stdio: ['pipe', 'ignore', 'pipe'], timeout: 10000 });
    } else if (isEsm) {
      execFileSync('node', ['--check', '--input-type=module', '-'], { input: fs.readFileSync(file), stdio: ['pipe', 'ignore', 'pipe'], timeout: 10000 });
    } else {
      execFileSync('node', ['--check', file], { stdio: ['pipe', 'ignore', 'pipe'], timeout: 10000 });
    }
    passed++;
  } catch (e) {
    failed++;
    const stderr = (e.stderr || '').toString().trim();
    const lines = stderr.split('\n');
    const errorLine = lines.find(l => l.includes('SyntaxError') || l.includes('Error')) || stderr.slice(0, 200);
    console.error('FAIL: ' + file + ' - ' + errorLine);
  }
}

console.log('Syntax check: ' + passed + ' passed, ' + failed + ' failed, ' + allFiles.length + ' total');
if (failed > 0) {
  process.exit(1);
}
console.log('ALL SYNTAX CHECKS PASSED');
