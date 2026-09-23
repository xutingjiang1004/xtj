const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'mcp-servers');
const read = (server) => fs.readFileSync(path.join(root, server, 'server.js'), 'utf8');
const admin = read('xtj-admin');
const image = read('xtj-image');
const email = read('xtj-email');

test('admin API base requires HTTPS and explicit exact host allowlist', () => {
  assert.match(admin, /function validateApiBase\(/);
  assert.match(admin, /url\.protocol !== "https:"/);
  assert.match(admin, /XTJ_API_ALLOWED_HOSTS/);
  assert.match(admin, /allowed === host/);
  assert.match(admin, /NODE_ENV !== "production"[\s\S]*XTJ_MCP_ALLOW_LOCALHOST === "true"/);
  assert.match(admin, /pathname !== "\/"/);
});

test('admin high-risk writes are disabled by default and disclose approval limits', () => {
  assert.match(admin, /XTJ_MCP_ENABLE_HIGH_RISK_WRITES !== "true"/);
  assert.match(admin, /confirm 参数仅代表本次 MCP 请求[\s\S]*不是独立审批/);
  const gatedTools = [
    'admin_delete_user', 'admin_delete_post', 'admin_delete_comment', 'admin_delete_photo',
    'admin_delete_announcement', 'admin_ban_user', 'admin_mute_user', 'admin_add_blacklist',
    'admin_report_delete_post', 'admin_report_ban_user',
  ];
  for (const name of gatedTools) {
    const start = admin.indexOf(`server.tool("${name}"`);
    assert.notEqual(start, -1, `${name} registered`);
    const end = admin.indexOf('server.tool("', start + 12);
    const block = admin.slice(start, end < 0 ? admin.length : end);
    assert.match(block, /assertHighRiskWritesEnabled\(\)/, `${name} has default-off gate`);
    assert.match(block, /HIGH_RISK_NOTICE/, `${name} description is transparent`);
  }
});

test('image path checks cover source and output symlinks', () => {
  assert.match(image, /function isWithin\(/);
  assert.match(image, /realpathSync\(resolved\)/);
  assert.match(image, /realpathSync\(path\.dirname\(resolved\)\)/);
  assert.match(image, /fs\.existsSync\(resolved\)/);
  assert.match(image, /safeResolve\(out, \{ output: true \}\)/);
  assert.match(image, /输出符号链接指向允许目录之外/);
});

test('image processing bounds file bytes, batch count/bytes, dimensions, quality and thumbnail count', () => {
  assert.match(image, /MAX_FILE_SIZE = 100 \* 1024 \* 1024/);
  assert.match(image, /MAX_BATCH_FILES = 50/);
  assert.match(image, /MAX_BATCH_INPUT_BYTES = 250 \* 1024 \* 1024/);
  assert.match(image, /files\.length > MAX_BATCH_FILES/);
  assert.match(image, /inputBytes > MAX_BATCH_INPUT_BYTES/);
  assert.match(image, /MAX_THUMBNAIL_SIZES = 10/);
  assert.match(image, /sizes: z\.array[\s\S]*\.max\(MAX_THUMBNAIL_SIZES\)/);
  assert.match(image, /function validateDimension\(/);
  assert.match(image, /function validateQuality\(/);
});

test('email wildcard allow rules require explicit opt-in', () => {
  assert.match(email, /EMAIL_ALLOW_WILDCARD_RECIPIENTS === "true"/);
  assert.match(email, /通配收件人规则默认禁用/);
  assert.match(email, /if \(r === "\*"\) return WILDCARD_RECIPIENTS_ENABLED/);
  assert.match(email, /if \(!WILDCARD_RECIPIENTS_ENABLED\) return false/);
});

test('email raw HTML is length-limited and stripped to attribute-free formatting tags', () => {
  assert.match(email, /function sanitizeEmailHtml\(/);
  assert.match(email, /MAX_EMAIL_HTML_CHARS = 50000/);
  assert.match(email, /ALLOWED_HTML_TAGS = new Set/);
  assert.match(email, /const lower = name\.toLowerCase\(\)/);
  assert.match(email, /ALLOWED_HTML_TAGS\.has\(lower\)/);
  assert.match(email, /args\.html \? sanitizeEmailHtml\(args\.html\)/);
  assert.match(email, /subject: z\.string\(\)\.min\(1\)\.max\(MAX_EMAIL_SUBJECT_CHARS\)/);
  assert.match(email, /to: z\.string\(\)\.email\(\)\.max\(254\)/);
});
