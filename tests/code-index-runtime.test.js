'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const codeIndex = require('../render-api/code-index');

function sha(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function file(path, content, language) {
  return {
    path,
    content,
    language: language || 'javascript',
    size: Buffer.byteLength(content, 'utf8'),
    sha256: sha(content)
  };
}

test.afterEach(() => {
  codeIndex._resetRegistryForTests();
});

test('isolates indexes, pins, and clear operations by user and workspace', () => {
  const scopeA = { userId: 'alice', workspaceId: 'same', generation: 1 };
  const scopeB = { userId: 'bob', workspaceId: 'same', generation: 1 };

  assert.equal(codeIndex.buildIndex(scopeA, [file('src/alice.js', 'const aliceSecret = 1;')]).ok, true);
  assert.equal(codeIndex.buildIndex(scopeB, [file('src/bob.js', 'const bobSecret = 2;')]).ok, true);

  assert.equal(codeIndex.readFileRange(scopeA, 'src/alice.js', 1, 2).ok, true);
  assert.equal(codeIndex.readFileRange(scopeB, 'src/alice.js', 1, 2).ok, false);
  assert.equal(codeIndex.searchCode(scopeA, 'bobSecret').results.length, 0);
  assert.equal(codeIndex.searchCode(scopeB, 'bobSecret').results.length, 1);

  assert.equal(codeIndex.pinFile(scopeA, 'src/alice.js', true).ok, true);
  assert.deepEqual(codeIndex.getPinnedFiles(scopeA), ['src/alice.js']);
  assert.deepEqual(codeIndex.getPinnedFiles(scopeB), []);

  assert.equal(codeIndex.clearIndex(scopeA).cleared, true);
  assert.equal(codeIndex.getIndexSummary(scopeA), null);
  assert.equal(codeIndex.getIndexSummary(scopeB).totalFiles, 1);
});

test('rejects stale generation and enforces an exact generation when reading', () => {
  const gen2 = { userId: 'alice', workspaceId: 'project', generation: 2 };
  const gen1 = { userId: 'alice', workspaceId: 'project', generation: 1 };
  const gen3 = { userId: 'alice', workspaceId: 'project', generation: 3 };
  assert.equal(codeIndex.buildIndex(gen2, [file('src/v2.js', 'const version = 2;')]).ok, true);

  const stale = codeIndex.buildIndex(gen1, [file('src/v1.js', 'const version = 1;')]);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'STALE_GENERATION');
  assert.equal(stale.currentGeneration, 2);

  const mismatch = codeIndex.listFiles(gen1);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, 'GENERATION_MISMATCH');
  assert.equal(codeIndex.getIndexSummary(gen2).generation, 2);

  assert.equal(codeIndex.buildIndex(gen3, [file('src/v3.js', 'const version = 3;')]).ok, true);
  assert.equal(codeIndex.readFileRange(gen2, 'src/v2.js', 1, 1).ok, true);
  assert.equal(codeIndex.getIndexSummary({ userId: 'alice', workspaceId: 'project' }).generation, 3);
});

test('validates duplicate paths, traversal, size, and SHA-256', () => {
  const scope = { userId: 'alice', workspaceId: 'project', generation: 1 };
  const good = file('src/app.js', 'const app = true;');

  assert.equal(codeIndex.buildIndex(scope, [good, good]).code, 'DUPLICATE_PATH');
  assert.equal(codeIndex.buildIndex(scope, [{ ...good, path: '../secret.js' }]).code, 'INVALID_PATH');
  assert.equal(codeIndex.buildIndex(scope, [{ ...good, size: -1 }]).code, 'INVALID_SIZE');
  assert.equal(codeIndex.buildIndex(scope, [{ ...good, sha256: 'bad' }]).code, 'INVALID_SHA256');
  assert.equal(codeIndex.buildIndex(scope, [{ ...good, sha256: '0'.repeat(64) }]).code, 'SHA256_MISMATCH');
});

test('builds large indexes through bounded batches and publishes only on finalize', () => {
  const scope = { userId: 'alice', workspaceId: 'batched-project', generation: 1 };
  const first = codeIndex.appendIndexBatch(scope, [file('src/first.js', 'const first = true;')]);
  assert.equal(first.ok, true);
  assert.equal(first.status, 'building');
  assert.equal(codeIndex.getIndexSummary(scope), null);

  const duplicate = codeIndex.appendIndexBatch(scope, [file('src/first.js', 'const changed = true;')]);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, 'DUPLICATE_PATH');

  const rejectedBatch = codeIndex.appendIndexBatch(scope, [
    file('src/second.js', 'const second = true;'),
    file('src/first.js', 'const duplicate = true;')
  ]);
  assert.equal(rejectedBatch.ok, false);

  const final = codeIndex.appendIndexBatch(scope, [file('src/second.js', 'const second = true;')], { finalize: true });
  assert.equal(final.ok, true);
  assert.equal(final.status, 'ready');
  assert.equal(final.totalFiles, 2);
  assert.equal(codeIndex.searchCode(scope, 'second').results.length, 1);
});

test('expands Chinese search intent into code aliases', () => {
  const scope = { userId: 'alice', workspaceId: 'project', generation: 1 };
  const content = 'function authenticateToken(token) { return Boolean(token); }';
  assert.equal(codeIndex.buildIndex(scope, [file('src/security.js', content)]).ok, true);

  const result = codeIndex.searchCode(scope, '请帮我检查登录功能');
  assert.equal(result.ok, true);
  assert.ok(result.keywords.includes('登录'));
  assert.ok(result.keywords.includes('auth'));
  assert.equal(result.results[0].path, 'src/security.js');
});

test('selection never exceeds the supplied token budget', () => {
  const scope = { userId: 'alice', workspaceId: 'project', generation: 1 };
  const content = Array.from({ length: 240 }, (_, i) => 'const item' + i + ' = "token budget";').join('\n');
  assert.equal(codeIndex.buildIndex(scope, [file('src/large.js', content)]).ok, true);

  const selection = codeIndex.selectBestChunks(scope, 'token budget', 180, [], null);
  assert.equal(selection.ok, true);
  assert.ok(selection.usedTokens <= 180);
  assert.ok(selection.selected.every(chunk => chunk.tokenEstimate <= 180));

  const budget = new codeIndex.TokenBudget(30000);
  const before = budget.available();
  budget.allocate({ content: 'abcd'.repeat(100), tokenEstimate: 100 });
  assert.equal(budget.available(), before - 100);
});

test('reclaims least-recently-used and expired workspaces', () => {
  codeIndex.configureRegistry({ maxWorkspaces: 2, ttlMs: 1000 });
  const a = { userId: 'a', workspaceId: 'one', generation: 1 };
  const b = { userId: 'b', workspaceId: 'two', generation: 1 };
  const c = { userId: 'c', workspaceId: 'three', generation: 1 };

  codeIndex.buildIndex(a, [file('a.js', 'const a = 1;')]);
  codeIndex.buildIndex(b, [file('b.js', 'const b = 1;')]);
  codeIndex.getIndexSummary(a); // touch a, so b becomes LRU
  codeIndex.buildIndex(c, [file('c.js', 'const c = 1;')]);

  assert.notEqual(codeIndex.getIndexSummary(a), null);
  assert.equal(codeIndex.getIndexSummary(b), null);
  assert.notEqual(codeIndex.getIndexSummary(c), null);
  assert.equal(codeIndex.getRegistryStats().workspaceCount, 2);

  codeIndex.cleanupExpired(Date.now() + 2000);
  assert.equal(codeIndex.getRegistryStats().workspaceCount, 0);
});

test('keeps legacy single-workspace signatures operational', () => {
  assert.equal(codeIndex.buildIndex('legacy-project', [file('legacy.js', 'const legacy = true;')]).ok, true);
  assert.equal(codeIndex.getIndexSummary().workspaceId, 'legacy-project');
  assert.equal(codeIndex.listFiles().files[0].path, 'legacy.js');
  assert.equal(codeIndex.searchCode('legacy').results[0].path, 'legacy.js');
  assert.equal(codeIndex.readFileRange('legacy.js', 1, 1).lines[0].text, 'const legacy = true;');
});
