// xtj 完整业务测试
// 运行: node tests/complete-tests.js

var assert = require('assert');

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✅ ' + name);
  } catch (e) {
    failed++;
    console.log('  ❌ ' + name + ': ' + e.message);
  }
}

function assertEqual(a, b) { if (a !== b) throw new Error('Expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }

console.log('\n=== Syntax Checks ===');
test('server.js', function() { require('child_process').execSync('node --check render-api/server.js', {stdio:'pipe'}); });
test('core.js', function() { require('child_process').execSync('node --check js/core.js', {stdio:'pipe'}); });
test('ai-agent.js', function() { require('child_process').execSync('node --check js/ai-agent.js', {stdio:'pipe'}); });
test('english-learning.js', function() { require('child_process').execSync('node --check js/english-learning.js', {stdio:'pipe'}); });
test('english-dict.js', function() { require('child_process').execSync('node --check js/english-dict.js', {stdio:'pipe'}); });

console.log('\n=== Garbled String Check ===');
test('no 错误错误 in visible strings', function() {
  var c = require('fs').readFileSync('js/ai-agent.js', 'utf8');
  var e = require('fs').readFileSync('js/english-learning.js', 'utf8');
  if (c.indexOf('错误错误') >= 0) throw new Error('ai-agent.js has 错误错误');
  if (e.indexOf('错误错误') >= 0) throw new Error('english-learning.js has 错误错误');
});

test('no password_hash in english-learning.js', function() {
  var c = require('fs').readFileSync('js/english-learning.js', 'utf8');
  if (c.indexOf('password_hash') >= 0) throw new Error('still has password_hash');
});

console.log('\n=== Static Sensitive Path Check ===');
var sensitive = ['/render-api/', '/scripts/', '/tests/', '/supabase/', '/mcp-servers/', '/package.json', '/package-lock.json', '/render.yaml'];
test('sensitive paths blocked', function() {
  // This test just verifies the blocklist logic exists
  var s = require('fs').readFileSync('render-api/server.js', 'utf8');
  if (s.indexOf('return res.status(404).end()') < 0) throw new Error('No blocklist found');
});

console.log('\n=== Results ===');
console.log('  Passed: ' + passed);
console.log('  Failed: ' + failed);
if (failed > 0) process.exit(1);
