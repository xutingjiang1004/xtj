const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');
test('retired Pro modules are not shipped', () => {
  for (const asset of ['js/pro-upgrade.js', 'js/pro-style.js', 'css/pro-style.css']) {
    assert.equal(fs.existsSync(path.join(__dirname, '..', asset)), false, `${asset} must stay retired`);
  }
});

test('post view count updates do not reparse existing HTML', () => {
  assert.doesNotMatch(source, /statsEl\.innerHTML\s*=\s*statsEl\.innerHTML\.replace/);
  assert.match(source, /statsEl\.textContent = statsEl\.textContent\.replace/);
});

test('avatar updates use the authenticated API and have no anon posts insert fallback', () => {
  const start = source.indexOf('window.handleAvatarUpload');
  const end = source.indexOf('function updateAllAvatarElements', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = source.slice(start, end);
  assert.match(block, /window\.API_BASE/);
  assert.match(block, /\/api\/avatar/);
  assert.doesNotMatch(block, /sb\.from\(["']posts["']\)\.insert/);
});
