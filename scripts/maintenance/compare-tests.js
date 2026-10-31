#!/usr/bin/env node
'use strict';
// Compares two run-tests.sh output directories by failing subtest names.
//   node scripts/maintenance/compare-tests.js <new-out> --failing            prints the files with failures (one per line)
//   node scripts/maintenance/compare-tests.js <new-out> <base-out>           prints failures that main does not have
// Exit code 1 when the new tree has a failure that the baseline does not have (or a file with no baseline log).
// A file that timed out or produced no TAP summary on the new tree while the baseline produced one is also reported.
const fs = require('node:fs');
const path = require('node:path');

const [, , newDir, second] = process.argv;
if (!newDir || !second) {
  console.error('usage: compare-tests.js <new-out> (--failing | <base-out>)');
  process.exit(2);
}

function summaryLines(dir) {
  const file = path.join(dir, '_summary.txt');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    const [name, code] = line.split(' ');
    return { name, code: Number(code) };
  });
}

function read(dir, name) {
  const file = path.join(dir, name + '.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function failingNames(text) {
  const names = new Set();
  const re = /^not ok \d+ - (.+)$/gm;
  let m;
  while ((m = re.exec(text))) names.add(m[1].trim());
  return names;
}

const hasSummary = (text) => /^# pass \d+/m.test(text || '');
const newRuns = summaryLines(newDir);

if (second === '--failing') {
  newRuns.filter((r) => r.code !== 0).forEach((r) => console.log(r.name));
  process.exit(0);
}

const baseRuns = summaryLines(second);
const problems = [];
let comparable = 0;
for (const run of newRuns) {
  if (run.code === 0) continue;
  comparable += 1;
  const text = read(newDir, run.name) || '';
  const baseText = read(second, run.name);
  if (baseText === null) {
    const base = baseRuns.find((r) => r.name === run.name);
    const why = base && base.code === 127 ? 'new test file that fails (it does not exist on main)' : 'no baseline log (run the failing files on main first)';
    problems.push({ name: run.name, why, tests: [...failingNames(text)].slice(0, 3) });
    continue;
  }
  const extra = [...failingNames(text)].filter((n) => !failingNames(baseText).has(n));
  if (extra.length) problems.push({ name: run.name, why: 'fails here but not on main', tests: extra.slice(0, 5) });
  else if (!hasSummary(text) && hasSummary(baseText)) problems.push({ name: run.name, why: 'no result here (timeout or crash) while main has one', tests: [] });
}

console.log(`${newRuns.length} files run, ${comparable} failing here, ${problems.length} not explained by the baseline`);
for (const p of problems) {
  console.log(`  ${p.name}: ${p.why}`);
  for (const t of p.tests) console.log(`      - ${t}`);
}
process.exit(problems.length ? 1 : 0);
