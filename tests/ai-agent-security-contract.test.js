const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');

test('AI module does not read legacy password-equivalent hashes', () => {
  assert.doesNotMatch(source, /PW_HASH_KEYS|readPwHash|hasLocalPasswordHash/);
});

test('AI cancellation obtains auth through the shared token helper', () => {
  assert.match(source, /window\.ensureUserToken/);
  assert.doesNotMatch(source, /localStorage\.getItem\(['"]xtj_user_token['"]\)/);
});

test('server-provided thought labels are HTML escaped', () => {
  assert.doesNotMatch(source, /ai-thought-role[^\n]+\+ roleLabel \+/);
  assert.doesNotMatch(source, /escapeHtml\([^\n]+\) \+ roundLabel/);
  assert.match(source, /escapeHtml\(roleLabel\) \+ escapeHtml\(roundLabel\)/);
});

test('AI close clears recurring status and configuration timers', () => {
  const closeStart = source.indexOf('function closeAiChat()');
  assert.notEqual(closeStart, -1);
  const closeBody = source.slice(closeStart, source.indexOf('function ', closeStart + 30));
  assert.match(closeBody, /clearInterval\(S\.statusTimer\)/);
  assert.match(closeBody, /clearInterval\(S\._configRefreshTimer\)/);
});
