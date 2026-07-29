const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('frontend bootstrap does not depend on a third-party Supabase CDN', () => {
  assert.doesNotMatch(indexHtml, /cdn\.jsdelivr\.net[^"']*supabase/i);
  assert.match(indexHtml, /<script defer src="js\/vendor\/supabase\.min\.js\?v=[^"]+"><\/script>/);
  assert.ok(fs.statSync(path.join(root, 'js/vendor/supabase.min.js')).size > 100_000);
});

test('Supabase loads before core while both scripts remain non-blocking', () => {
  const sdkPosition = indexHtml.indexOf('js/vendor/supabase.min.js');
  const corePosition = indexHtml.indexOf('js/core.min.js');
  assert.ok(sdkPosition >= 0 && corePosition >= 0 && sdkPosition < corePosition);
});
