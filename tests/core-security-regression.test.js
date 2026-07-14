const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');

test('Pro gift IDs never enter an inline JavaScript handler', () => {
  assert.doesNotMatch(
    source,
    /pro-gift-claim-btn[^>]+onclick=/,
    'gift IDs must stay in data attributes and be read by a DOM listener'
  );
  assert.match(source, /window\.claimProGift\(button\.dataset\.giftId\)/);
  assert.match(source, /node\.dataset\.giftId === giftKey/);
  assert.doesNotMatch(source, /querySelector\('\.pro-gift-(?:claim-btn|card)\[data-gift-id=/);
});

test('post view count updates do not reparse existing HTML', () => {
  assert.doesNotMatch(source, /statsEl\.innerHTML\s*=\s*statsEl\.innerHTML\.replace/);
  assert.match(source, /statsEl\.textContent = statsEl\.textContent\.replace\(\/浏览/);
});

test('VIP request timeout is cleared for both resolve and reject paths', () => {
  assert.match(
    source,
    /resp = await fetch\(url, \{ signal: vc\.signal \}\);\s*\} finally \{\s*clearTimeout\(vt\);/
  );
});
