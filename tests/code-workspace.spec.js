const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// ============================================================
// Helper: read file relative to project root
// ============================================================
function readFile(relPath) {
  return fs.readFileSync(path.resolve(ROOT, relPath), 'utf8');
}

// ============================================================
// 1. 文件存在性检查
// ============================================================
test('all code workspace files exist', () => {
  assert.ok(fs.existsSync(path.resolve(ROOT, 'js/code-file-system.js')), 'code-file-system.js must exist');
  assert.ok(fs.existsSync(path.resolve(ROOT, 'js/code-workspace.js')), 'code-workspace.js must exist');
  assert.ok(fs.existsSync(path.resolve(ROOT, 'css/code-workspace.css')), 'code-workspace.css must exist');
  assert.ok(fs.existsSync(path.resolve(ROOT, 'render-api/code-agent.js')), 'code-agent.js must exist');
});

// ============================================================
// 2. 构建系统包含新文件
// ============================================================
test('build.js includes code workspace files', () => {
  const buildJS = readFile('scripts/build.js');
  assert.match(buildJS, /js\/code-file-system\.js/);
  assert.match(buildJS, /js\/code-workspace\.js/);
  assert.match(buildJS, /css\/code-workspace\.css/);
});

// ============================================================
// 3. min 文件存在
// ============================================================
test('minified files exist after build', () => {
  assert.ok(fs.existsSync(path.resolve(ROOT, 'js/code-file-system.min.js')), 'code-file-system.min.js must exist');
  assert.ok(fs.existsSync(path.resolve(ROOT, 'js/code-workspace.min.js')), 'code-workspace.min.js must exist');
  assert.ok(fs.existsSync(path.resolve(ROOT, 'css/code-workspace.min.css')), 'code-workspace.min.css must exist');
});

// ============================================================
// 4. index.html 引用 min 文件
// ============================================================
test('index.html references minified code files', () => {
  const html = readFile('index.html');
  assert.match(html, /js\/code-file-system\.min\.js/);
  assert.match(html, /js\/code-workspace\.min\.js/);
  assert.match(html, /css\/code-workspace\.min\.css/);
});

// ============================================================
// 5. 语法检查
// ============================================================
test('code-file-system.js syntax is valid', () => {
  const cp = require('node:child_process');
  cp.execSync('node --check js/code-file-system.js', { cwd: ROOT, stdio: 'pipe' });
});

test('code-workspace.js syntax is valid', () => {
  const cp = require('node:child_process');
  cp.execSync('node --check js/code-workspace.js', { cwd: ROOT, stdio: 'pipe' });
});

test('code-agent.js syntax is valid', () => {
  const cp = require('node:child_process');
  cp.execSync('node --check render-api/code-agent.js', { cwd: ROOT, stdio: 'pipe' });
});

// ============================================================
// 6. CSS 文件非空
// ============================================================
test('code-workspace.css is not empty', () => {
  var css = readFile('css/code-workspace.css');
  assert.ok(css.length > 100, 'CSS file should have meaningful content');
  assert.ok(/\.code-panel/.test(css), 'CSS should contain .code-panel');
  assert.ok(/\.code-main/.test(css), 'CSS should contain .code-main');
  assert.ok(/\.code-sidebar/.test(css), 'CSS should contain .code-sidebar');
  assert.ok(/\.code-file-tree/.test(css), 'CSS should contain .code-file-tree');
});

// ============================================================
// 7. 模块使用 IIFE
// ============================================================
test('code-file-system.js uses IIFE', () => {
  const content = readFile('js/code-file-system.js');
  assert.match(content, /\(function\s*\(\)\s*\{/);
  assert.match(content, /'use strict'/);
  assert.match(content, /window\.__xtjCodeFS/);
});

test('code-workspace.js uses IIFE', () => {
  const content = readFile('js/code-workspace.js');
  assert.match(content, /\(function\s*\(\)\s*\{/);
  assert.match(content, /'use strict'/);
});

// ============================================================
// 8. 全局 API 导出
// ============================================================
test('code-file-system exports __xtjCodeFS', () => {
  const content = readFile('js/code-file-system.js');
  assert.match(content, /window\.__xtjCodeFS\s*=/);
  assert.match(content, /selectDirectory/);
  assert.match(content, /readFileByPath/);
  assert.match(content, /writeFileByPath/);
  assert.match(content, /getSHA256/);
});

test('code-workspace exports __xtjCodeInit and API', () => {
  const content = readFile('js/code-workspace.js');
  assert.match(content, /window\.__xtjCodeInit\s*=/);
  assert.match(content, /window\.__xtjCodeRefreshWorkspace\s*=/);
  assert.match(content, /window\.__xtjCodeWorkspaceAPI\s*=/);
});

// ============================================================
// 9. 模块防重复加载
// ============================================================
test('code-file-system prevents double loading', () => {
  const content = readFile('js/code-file-system.js');
  assert.match(content, /window\.__xtjCodeFS\s*\)\s*return/);
});

test('code-workspace prevents double loading', () => {
  const content = readFile('js/code-workspace.js');
  assert.match(content, /window\.__xtjCodeWorkspace\s*\)\s*return/);
});

// ============================================================
// 10. 状态对象独立
// ============================================================
test('code-workspace state is independent', () => {
  const content = readFile('js/code-workspace.js');
  assert.match(content, /var state = \{/);
  assert.match(content, /active:\s*false/);
  assert.match(content, /directoryHandle:\s*null/);
  assert.match(content, /openTabs:\s*\[\]/);
  assert.match(content, /contextPaths:\s*\{/);
  assert.match(content, /pendingOperations:\s*\[\]/);
  assert.match(content, /snapshots:\s*\{/);
});

// ============================================================
// 11. 编辑功能
// ============================================================
test('code-workspace supports multiple open tabs', () => {
  const content = readFile('js/code-workspace.js');
  assert.match(content, /openTabs\.push/);
  assert.match(content, /closeTab/);
  assert.match(content, /renderTabs/);
});

test('code-workspace supports file save', () => {
  const content = readFile('js/code-workspace.js');
  assert.match(content, /function saveFile/);
  assert.match(content, /writeFileByPath/);
});

// ============================================================
// 12. AI 聊天功能
// ============================================================
test('code-workspace has chat panel', () => {
  const content = readFile('js/code-workspace.js');
  assert.match(content, /function renderChatPanel/);
  assert.match(content, /function sendMessage/);
  assert.match(content, /\/api\/code\/chat/);
});

// ============================================================
// 13. Context 管理
// ============================================================
test('code-workspace supports context management', () => {
  const content = readFile('js/code-workspace.js');
  assert.match(content, /function toggleContext/);
  assert.match(content, /function renderContextPanel/);
  assert.match(content, /添加到 AI 上下文/);
});

// ============================================================
// 14. SVG 图标格式
// ============================================================
test('Code nav button uses hand-drawn SVG icon', () => {
  const html = readFile('index.html');
  assert.match(html, /data-desktop-tab="code"/);
  // Check for SVG with correct attributes
  assert.match(html, /fill="none"/);
  assert.match(html, /stroke="currentColor"/);
  assert.match(html, /stroke-width="1\.7"/);
  assert.match(html, /stroke-linecap="round"/);
  assert.match(html, /stroke-linejoin="round"/);
});

// ============================================================
// 15. Hash 验证
// ============================================================
test('index.html hashes match minified file content', () => {
  const html = readFile('index.html');
  const crypto = require('node:crypto');
  function hash(p) {
    return crypto.createHash('sha256').update(fs.readFileSync(path.resolve(ROOT, p))).digest('hex').slice(0, 10);
  }
  var re = /\b(?:href|src|content)="((?:css|js)\/[^"?#]+\.(?:css|js))\?v=([a-f0-9]{10})"/g;
  var m;
  while ((m = re.exec(html))) {
    if (m[1].includes('code-file-system') || m[1].includes('code-workspace') || m[1].includes('code-workspace.css')) {
      assert.strictEqual(m[2], hash(m[1]), m[1] + ' hash mismatch');
    }
  }
});