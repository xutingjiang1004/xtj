#!/usr/bin/env node
'use strict';
// Integrator helper: appends test files that are not yet part of "npm test" to the main group of the "test" script in
// package.json. Sessions never edit that line themselves (it is one giant line, so two PRs adding a test would always conflict).
//   node scripts/maintenance/register-tests.js [--check]        with --check nothing is written; exit 1 when a file is missing
//   node scripts/maintenance/register-tests.js tests/a.test.js ...   register exactly these files
// Without file arguments every tests/*.test.js and render-api/tests/*.test.js that was added since origin/main is considered.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const check = process.argv.includes('--check');
let wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!wanted.length) {
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=A', 'origin/main...HEAD', '--', 'tests', 'render-api/tests'], { encoding: 'utf8' });
  wanted = out.split('\n').filter((f) => /\.test\.js$/.test(f));
}

const text = fs.readFileSync('package.json', 'utf8');
const pkg = JSON.parse(text);
const script = pkg.scripts.test;
const missing = wanted.filter((f) => !script.includes(f));
if (!missing.length) { console.log('all test files are registered'); process.exit(0); }
console.log((check ? 'not registered: ' : 'registering: ') + missing.join(' '));
if (check) process.exit(1);

// The largest "node --test --test-concurrency=2" group takes the new files, after its last test file.
const groups = script.split(' && ');
let target = -1, best = -1;
groups.forEach((g, i) => {
  const n = (g.match(/\.test\.js/g) || []).length;
  if (/--test-concurrency=2/.test(g) && n > best) { best = n; target = i; }
});
if (target < 0) { console.error('no test group found in package.json'); process.exit(2); }
groups[target] = groups[target].trimEnd() + ' ' + missing.join(' ');
const next = groups.join(' && ');
const oldLine = JSON.stringify(script);
if (!text.includes(oldLine)) { console.error('could not find the test script line verbatim'); process.exit(2); }
fs.writeFileSync('package.json', text.replace(oldLine, JSON.stringify(next)));
JSON.parse(fs.readFileSync('package.json', 'utf8'));
console.log('package.json updated');
