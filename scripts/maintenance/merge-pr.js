#!/usr/bin/env node
'use strict';
// Merges one PR head into the current (integration) branch without hand-merging generated files.
//   git fetch origin pull/<number>/head:pr-<number> && node scripts/maintenance/merge-pr.js pr-<number>
// - conflicts in *.min.js, *.min.css and js/core.js take the current branch's version (everything is rebuilt afterwards);
// - conflicts in index.html/admin.html that only differ by the "?v=<hash>" fingerprints are resolved the same way;
// - any other conflict is left in place: resolve the source files, `git add` them, then `git commit --no-edit`.
// After all PRs are merged run `npm run build` and commit the regenerated files.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const ref = process.argv[2];
if (!ref) { console.error('usage: merge-pr.js <ref>'); process.exit(2); }
const git = (...args) => { try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };

git('merge', '--no-ff', '--no-commit', ref);
const unmerged = () => git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);

for (const file of unmerged()) {
  if (/\.min\.(js|css)$/.test(file) || file === 'js/core.js') {
    git('checkout', '--ours', '--', file);
    git('add', file);
  } else if (/^(index|admin)\.html$/.test(file)) {
    // Resolve conflict blocks whose two sides are equal once the asset fingerprints are ignored.
    const text = fs.readFileSync(file, 'utf8');
    const norm = (s) => s.replace(/\?v=[0-9a-f]{6,16}/g, '?v=X');
    let open = 0;
    const out = text.replace(/<<<<<<< [^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> [^\n]*\n/g, (block, ours, theirs) => {
      if (norm(ours) === norm(theirs)) return ours;
      open += 1;
      return block;
    });
    fs.writeFileSync(file, out);
    if (!open) git('add', file);
  }
}

const left = unmerged();
if (left.length) {
  console.log('CONFLICTS left in source files (fix, git add, then git commit --no-edit):');
  left.forEach((f) => console.log('  ' + f));
  process.exit(1);
}
const message = `Merge ${ref}`;
const result = git('commit', '--no-edit', '-m', message);
console.log(/nothing to commit|already up to date/i.test(result) ? `${ref}: nothing to merge` : `merged ${ref}`);
