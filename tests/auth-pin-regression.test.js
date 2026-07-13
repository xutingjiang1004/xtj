'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'js', 'core.js'), 'utf8');
const coreMin = fs.readFileSync(path.join(root, 'js', 'core.min.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');

test('protected auth only clears a genuinely expired session', () => {
  assert.match(core, /reason:\s*\(res\.status === 401 \|\| res\.status === 403\) \? 'expired' : 'unavailable'/);
  assert.match(core, /if \(_lastRefreshAuthResult\.reason === 'expired'\) \{\s*handleProtectedAuthFailure\(\)/);
  assert.match(core, /reason: 'network_error'/);
});

test('login establishes the HttpOnly refresh-cookie session', () => {
  assert.match(core, /fetch\(API_BASE \+ '\/api\/user\/login',[\s\S]*?credentials: 'include'/);
});

test('pin reuses preflight token and retries once after a real 401', () => {
  assert.match(core, /var response = await requestPin\(auth\.token\)/);
  assert.match(core, /if \(response\.status === 401\) \{[\s\S]*?refreshUserToken\(true\)[\s\S]*?requestPin\(renewedToken\)/);
  assert.match(core, /credentials: 'include'/);
});

test('missing pin migration is reported separately from authentication', () => {
  assert.match(server, /code: 'pin_migration_required'/);
  assert.match(core, /result\.code === 'pin_migration_required'/);
});

test('deployed minified bundle contains the auth and migration fixes', () => {
  assert.match(coreMin, /pin_migration_required/);
  assert.match(coreMin, /network_error/);
});
