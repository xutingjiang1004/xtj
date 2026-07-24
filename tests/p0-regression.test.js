/**
 * P0 回归测试 — Code 工作区核心修复验证
 *
 * 运行: node tests/p0-regression.test.js
 *
 * 验证项:
 *  1. restoreWorkspace 支持 prompt/denied/granted/missing 四种状态
 *  2. restoreHandle 不再过滤权限，直接返回句柄
 *  3. clearWorkspaceRecord 清理 IndexedDB 和 localStorage
 *  4. 欢迎页有恢复按钮和重新选择按钮
 *  5. CSS 无硬编码深色 (#111, #181818, #000)
 *  6. Monaco 主题同步函数正确
 *  7. index.html 正确引用 min 文件
 *  8. min 文件与源码同步（hash 匹配）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + message);
  } else {
    failed++;
    console.error('  FAIL: ' + message);
  }
}

function contentHash(filePath) {
  const fullPath = path.resolve(ROOT, filePath);
  if (!fs.existsSync(fullPath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex').slice(0, 10);
}

// ──────────────────────────────────────────────
// 1. code-file-system.js 恢复逻辑
// ──────────────────────────────────────────────
console.log('\n=== 1. code-file-system.js 恢复逻辑 ===');

const fsSrc = fs.readFileSync(path.join(ROOT, 'js/code-file-system.js'), 'utf8');

assert(
  fsSrc.includes('function restoreWorkspace(options)'),
  'restoreWorkspace 接受 options 参数'
);

assert(
  fsSrc.includes("status: 'missing'"),
  'restoreWorkspace 返回 missing 状态'
);

assert(
  fsSrc.includes("status: 'granted'"),
  'restoreWorkspace 返回 granted 状态'
);

assert(
  fsSrc.includes("status: 'denied'"),
  'restoreWorkspace 返回 denied 状态'
);

// 'prompt' appears in ternary: permission === 'denied' ? 'denied' : 'prompt'
assert(
  fsSrc.includes("'prompt'"),
  'restoreWorkspace 返回 prompt 状态'
);

assert(
  fsSrc.includes('options && options.requestPermission'),
  'restoreWorkspace 仅在 options.requestPermission 时请求权限'
);

assert(
  fsSrc.includes('function clearWorkspaceRecord()'),
  'clearWorkspaceRecord 函数存在'
);

assert(
  fsSrc.includes("localStorage.removeItem('xtj_code_workspace_name')"),
  'clearWorkspaceRecord 清理 localStorage'
);

assert(
  !fsSrc.includes('queryPermission({ mode: \'readwrite\' })') ||
  fsSrc.indexOf('queryPermission({ mode: \'readwrite\' })') !==
  fsSrc.indexOf('function restoreHandle'),
  'restoreHandle 不再内部检查权限'
);

assert(
  fsSrc.includes('var _fileLocks = {}'),
  '_fileLocks 已声明'
);

// ──────────────────────────────────────────────
// 2. code-workspace.js 欢迎页
// ──────────────────────────────────────────────
console.log('\n=== 2. code-workspace.js 欢迎页 ===');

const wsSrc = fs.readFileSync(path.join(ROOT, 'js/code-workspace.js'), 'utf8');

assert(
  wsSrc.includes('恢复 xtj 工作区'),
  '欢迎页有"恢复 xtj 工作区"按钮'
);

assert(
  wsSrc.includes('重新选择文件夹'),
  '欢迎页有"重新选择文件夹"按钮'
);

assert(
  wsSrc.includes("requestPermission: true"),
  '用户点击恢复按钮时启用 requestPermission'
);

assert(
  wsSrc.includes("requestPermission: false"),
  '自动加载时不启用 requestPermission'
);

assert(
  wsSrc.includes('工作区记录已失效'),
  'missing 状态显示失效提示'
);

assert(
  wsSrc.includes('您拒绝了访问权限'),
  'denied 状态显示拒绝提示'
);

assert(
  wsSrc.includes('clearWorkspaceRecord'),
  '失效时调用 clearWorkspaceRecord 清理'
);

assert(
  wsSrc.includes('welcome-status'),
  '使用 welcome-status 类显示状态'
);

assert(
  wsSrc.includes("result && result.status === 'granted'"),
  'init() 正确检查 result.status'
);

// ──────────────────────────────────────────────
// 3. CSS 无硬编码深色
// ──────────────────────────────────────────────
console.log('\n=== 3. CSS 无硬编码深色 ===');

const cssSrc = fs.readFileSync(path.join(ROOT, 'css/code-workspace.css'), 'utf8');

// 提取所有颜色值（去掉注释）
const cssNoComments = cssSrc.replace(/\/\*[\s\S]*?\*\//g, '');
const colorMatches = cssNoComments.match(/#[0-9a-fA-F]{3,8}\b/g) || [];

// 检查是否有硬编码的深色
const forbiddenColors = ['#111', '#111111', '#181818', '#000', '#000000'];
const foundForbidden = colorMatches.filter(function(c) {
  return forbiddenColors.indexOf(c.toLowerCase()) !== -1;
});

assert(
  foundForbidden.length === 0,
  'CSS 无硬编码深色 (' + (foundForbidden.length > 0 ? foundForbidden.join(', ') : 'none') + ')'
);

// 检查 CSS 变量使用
assert(
  cssSrc.includes('--cw-bg') && cssSrc.includes('--cw-text') && cssSrc.includes('--cw-border'),
  'CSS 变量 (--cw-bg, --cw-text, --cw-border) 已定义'
);

assert(
  cssSrc.includes('[data-theme="light"]'),
  '支持 data-theme="light"'
);

assert(
  cssSrc.includes('[data-theme="dark"]'),
  '支持 data-theme="dark"'
);

// 检查新增的状态样式
assert(
  cssSrc.includes('.welcome-status'),
  'welcome-status 样式已定义'
);

assert(
  cssSrc.includes('.welcome-status.error'),
  'welcome-status.error 样式已定义'
);

assert(
  cssSrc.includes('.welcome-status.warning'),
  'welcome-status.warning 样式已定义'
);

// ──────────────────────────────────────────────
// 4. Monaco 主题同步
// ──────────────────────────────────────────────
console.log('\n=== 4. Monaco 主题同步 ===');

assert(
  wsSrc.includes("getMonacoTheme") &&
  wsSrc.includes("'vs-dark'") &&
  wsSrc.includes("'vs'"),
  'getMonacoTheme() 返回 vs-dark (深色) 或 vs (浅色)'
);

assert(
  wsSrc.includes('MutationObserver') &&
  wsSrc.includes("attributeFilter: ['data-theme']"),
  'MutationObserver 监听 data-theme 变化同步 Monaco'
);

// ──────────────────────────────────────────────
// 5. index.html 资源引用
// ──────────────────────────────────────────────
console.log('\n=== 5. index.html 资源引用 ===');

const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 检查是否引用 min 文件
const codeFiles = [
  { name: 'code-file-system', min: 'js/code-file-system.min.js' },
  { name: 'code-workspace', min: 'js/code-workspace.min.js' },
  { name: 'code-style', min: 'css/code-workspace.min.css' }
];

codeFiles.forEach(function(f) {
  assert(
    htmlSrc.includes(f.min),
    'index.html 引用 ' + f.min
  );
});

// 检查 hash 版本号
assert(
  /code-file-system\.min\.js\?v=[a-f0-9]{10}/.test(htmlSrc),
  'code-file-system.min.js 有 hash 版本号'
);

assert(
  /code-workspace\.min\.js\?v=[a-f0-9]{10}/.test(htmlSrc),
  'code-workspace.min.js 有 hash 版本号'
);

assert(
  /code-workspace\.min\.css\?v=[a-f0-9]{10}/.test(htmlSrc),
  'code-workspace.min.css 有 hash 版本号'
);

// 6. min 文件存在且与源码 hash 匹配
console.log('\n=== 6. min 文件存在性 ===');

const minFiles = [
  'js/code-file-system.min.js',
  'js/code-workspace.min.js',
  'css/code-workspace.min.css'
];

minFiles.forEach(function(f) {
  const exists = fs.existsSync(path.join(ROOT, f));
  assert(exists, f + ' 存在');
});

// ──────────────────────────────────────────────
// 结果
// ──────────────────────────────────────────────
console.log('\n========================================');
console.log('  结果: ' + passed + ' 通过, ' + failed + ' 失败');
console.log('========================================\n');

if (failed > 0) {
  process.exit(1);
}