const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'js', 'core.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');

test('post actions expose only the fixed tools menu and no edit entry', () => {
  const actionSource = core.slice(core.indexOf('function buildPostActionHtml'), core.indexOf('function buildPostLocationHtml'));
  assert.match(actionSource, /data-post-tool="translate"/);
  assert.match(actionSource, /data-post-tool="ask-ai"/);
  assert.match(actionSource, /data-post-tool="report"/);
  assert.doesNotMatch(actionSource, /openEditPost|编辑/);
});

test('post tools are server-authoritative and expose an SSE post chat endpoint', () => {
  assert.match(server, /app\.post\('\/api\/agent\/post-tools', authenticateUser/);
  assert.match(server, /app\.post\('\/api\/agent\/post-chat\/stream', authenticateUser/);
  assert.match(server, /loadPostToolPost\(postId, req\.userName\)/);
  assert.match(server, /post\.is_deleted === true/);
  assert.match(server, /already_chinese/);
  assert.match(server, /event: message/);
  assert.match(server, /event: delta/);
  assert.match(server, /requestAbort\.abort\(\)/);
});

test('Dock source is not part of this change surface', () => {
  const diff = require('child_process').execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' });
  assert.doesNotMatch(diff, /dock/i);
});
