#!/usr/bin/env node
'use strict';
// Rule check for a branch or PR head, used by the integrator before merging and by module sessions before opening a PR.
//   node scripts/maintenance/pr-check.js [base] [head] [--integrator]       defaults: origin/main and HEAD
// Exit code 1 when a HARD rule is broken. WARN lines need a human-style judgement in the PR description.
// --integrator additionally allows the one edit only the integrator makes: new test files in the "test" script of package.json.
const { execFileSync } = require('node:child_process');

const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const integrator = flags.includes('--integrator');
const base = args[0] || 'origin/main';
const head = args[1] || 'HEAD';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const nameStatus = git('diff', '--name-status', '--no-renames', `${base}...${head}`).split('\n').filter(Boolean).map((l) => {
  const [status, ...rest] = l.split('\t');
  return { status, file: rest.join('\t') };
});
const files = nameStatus.map((e) => e.file);
const isGenerated = (f) => /\.min\.(js|css)$/.test(f) || f === 'js/core.js';
const isFrontSource = (f) => !isGenerated(f) && /^(css|js|index\.html|admin\.html)/.test(f);
const isBackSource = (f) => /^render-api\//.test(f) && !/^render-api\/(tests\/|package(-lock)?\.json$)/.test(f);
const isSource = (f) => isFrontSource(f) || isBackSource(f);
const hard = [], warn = [];

// Dock selectors in changed source lines.
const dockRe = /dock-bar|dock-tab|dock-indicator|dockBar|dock-liquid|\.dt-icon|\.dt-label/;
const frontFiles = files.filter(isFrontSource);
if (frontFiles.length) {
  const patch = git('diff', '-U0', `${base}...${head}`, '--', ...frontFiles);
  const bad = patch.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l) && dockRe.test(l));
  if (bad.length) hard.push(`Dock selectors in the diff (${bad.length} lines), e.g. ${bad[0].slice(0, 100)}`);
}

// Hand-edited generated files: a generated file changed although its source did not.
for (const f of files.filter(isGenerated)) {
  const source = f === 'js/core.js' ? files.some((x) => x.startsWith('js/core-parts/')) : files.includes(f.replace(/\.min\.(js|css)$/, '.$1'));
  if (!source) hard.push(`generated file changed without its source: ${f}`);
}

// Reports, screenshots and other artefacts that must not be committed.
for (const e of nameStatus.filter((x) => x.status === 'A')) {
  if (/(audit|report|acceptance|verification)[^/]*\.(md|json|html|csv)$/i.test(e.file) && !e.file.startsWith('tests/')) hard.push(`added a report-like file: ${e.file}`);
  if (/\.(png|jpe?g|webp|gif|mp4|webm)$/i.test(e.file) && !/^(images|img|assets|icons|public)\//.test(e.file)) warn.push(`added an image/binary: ${e.file}`);
}

// Deployment, dependency and configuration files are decided by the user, never by a daily session.
for (const f of files) {
  if (/^(\.github\/|cloudflare\/|wrangler\.jsonc$|render\.yaml$|\.env)/.test(f)) hard.push(`deployment/CI/config file changed: ${f}`);
  else if (/^package-lock\.json$|^render-api\/package(-lock)?\.json$/.test(f)) hard.push(`dependency file changed: ${f}`);
  else if (f === 'package.json') {
    const patch = git('diff', '-U0', `${base}...${head}`, '--', 'package.json').split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
    const onlyTestList = patch.length > 0 && patch.every((l) => /^[+-]\s+"test":/.test(l));
    if (!(integrator && onlyTestList)) hard.push('package.json changed (only the integrator may add new test files to the "test" script; sessions put tests in tests/ and leave package.json alone)');
  } else if (/^scripts\//.test(f) && !/^scripts\/maintenance\//.test(f)) hard.push(`build/tooling script changed: ${f}`);
  else if (/^scripts\/maintenance\//.test(f)) warn.push(`maintenance toolkit changed: ${f} (explain why in the PR)`);
  else if (/^(miniprogram|mcp-servers|audit-reports)\//.test(f) || /^SUPABASE_FIX.*\.sql$/.test(f)) warn.push(`outside the daily scope (website front end and back end): ${f}`);
}

// Database: migrations are written, never applied by a session. A new file is allowed, an existing one is never edited.
for (const e of nameStatus.filter((x) => /^supabase\//.test(x.file))) {
  if (/^supabase\/migrations\/[^/]+\.sql$/.test(e.file)) {
    if (e.status === 'A') warn.push(`new migration ${e.file}: it is NOT applied automatically; the code must keep working without it; list it under "需要你决定 / 待应用迁移"`);
    else hard.push(`existing migration ${e.status === 'D' ? 'deleted' : 'edited'}: ${e.file} (migrations already applied to the database are immutable; add a new one)`);
  } else hard.push(`database configuration changed: ${e.file}`);
}

// Secrets in added lines.
const secretRes = [/sk-[A-Za-z0-9_-]{24,}/, /eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/, /gh[pousr]_[A-Za-z0-9]{30,}/, /xox[abp]-[A-Za-z0-9-]{20,}/, /sb_secret_[A-Za-z0-9_-]{16,}/];
const addedLines = git('diff', '-U0', `${base}...${head}`, '--', ...files.filter((f) => !isGenerated(f))).split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
const secretHit = addedLines.find((l) => secretRes.some((re) => re.test(l)));
if (secretHit) hard.push(`something that looks like a secret was added: ${secretHit.slice(0, 40)}...`);

// Size of the human-written change (sources only, no generated files, tests or docs).
let changed = 0;
const numstat = git('diff', '--numstat', `${base}...${head}`).split('\n').filter(Boolean);
for (const line of numstat) {
  const [add, del, file] = line.split('\t');
  if (isGenerated(file) || /^(tests|docs)\//.test(file) || /^render-api\/tests\//.test(file) || file === 'CHANGELOG.md' || file === 'AGENTS.md' || file === 'package.json' || /^scripts\/maintenance\//.test(file)) continue;
  changed += (Number(add) || 0) + (Number(del) || 0);
}
if (changed > 800) hard.push(`change is too large: ${changed} source lines (limit 800 per PR)`);
else if (changed > 300) warn.push(`large change: ${changed} source lines (aim for at most 200 per fix, 3 fixes per PR)`);

// A fix without a regression test.
const hasTest = files.some((f) => /^(tests\/|render-api\/tests\/)/.test(f));
if (files.some(isSource) && !hasTest) warn.push('source changed but no test file changed (every fix needs a regression test)');

// Backend: reminders that cannot be checked mechanically.
const backend = files.filter(isBackSource);
if (backend.length) warn.push(`backend changed (${backend.slice(0, 3).join(', ')}${backend.length > 3 ? ', ...' : ''}): response shapes the front end reads must stay compatible (grep the callers), and the PR must say what a failure looks like for users`);

// Posts-page styles are frozen: bug fixes only, no visible change.
const postStyles = files.filter((f) => /^css\/(post-feed|author-posts)\.css$/.test(f));
if (postStyles.length) warn.push(`posts-page style files changed: ${postStyles.join(', ')} (bug fixes only; run posts-diff and explain every difference)`);

console.log(`${base}...${head}: ${files.length} files, ${changed} source lines changed`);
hard.forEach((m) => console.log('HARD  ' + m));
warn.forEach((m) => console.log('WARN  ' + m));
if (!hard.length && !warn.length) console.log('ok');
process.exit(hard.length ? 1 : 0);
