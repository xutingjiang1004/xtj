'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DIRS = ['js', 'render-api', 'scripts'];
const EXCLUDE = ['node_modules', '.git', 'dist', 'build', 'coverage'];

function walk(dir, files) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (EXCLUDE.some(e => fullPath.includes(e))) continue;
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.min.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

let allFiles = [];
for (const d of DIRS) {
  if (fs.existsSync(d)) {
    walk(d, allFiles);
  }
}

let failed = 0;
let passed = 0;

for (const file of allFiles) {
  try {
    execFileSync('node', ['--check', file], { stdio: 'pipe', timeout: 10000 });
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