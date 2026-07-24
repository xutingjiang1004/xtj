const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const indexHtml = fs.readFileSync('index.html', 'utf8');
const desktopShell = fs.readFileSync('js/desktop-shell.js', 'utf8');
const codeFS = fs.readFileSync('js/code-file-system.js', 'utf8');
const codeWorkspace = fs.readFileSync('js/code-workspace.js', 'utf8');

// ============================================================
// 1. 电脑端存在 Code 导航
// ============================================================
test('desktop nav has Code button with data-desktop-tab="code"', () => {
  assert.match(indexHtml, /data-desktop-tab="code"/);
  assert.match(indexHtml, /<span>Code<\/span>/);
});

// ============================================================
// 2. 移动端 Dock 未增加 Code
// ============================================================
test('mobile dock does not have Code button', () => {
  // Mobile dock buttons should not have data-desktop-tab="code"
  // The mobile dock is identified by class "dock-nav" or similar
  // Verify that data-desktop-tab="code" only appears in the desktop nav section
  var codeMatches = indexHtml.match(/data-desktop-tab="code"/g);
  assert.ok(codeMatches, 'Code tab should exist in desktop nav');
  // The Code button should be in the desktop-workbench-sidebar, not in mobile dock
  assert.match(indexHtml, /desktop-workbench-sidebar[\s\S]*?data-desktop-tab="code"/);
  // Mobile dock should not contain data-desktop-tab="code"
  var mobileDockSection = indexHtml.match(/class="dock-nav"[\s\S]*?<\/nav>/);
  if (mobileDockSection) {
    assert.ok(!/data-desktop-tab="code"/.test(mobileDockSection[0]), 'Mobile dock should not have Code');
  }
});

// ============================================================
// 3. 点击 Code 显示 panelCode
// ============================================================
test('panelCode exists in dockPanels', () => {
  assert.match(indexHtml, /id="panelCode"/);
  assert.match(indexHtml, /code-panel/);
});

// ============================================================
// 4. 现有其他导航仍可切换
// ============================================================
test('existing nav buttons are preserved', () => {
  // Extract the desktop nav section from HTML
  var navMatch = indexHtml.match(/desktop-workbench-nav[\s\S]*?<\/nav>/);
  assert.ok(navMatch, 'desktop-workbench-nav should exist');
  var navSection = navMatch[0];
  assert.match(navSection, /data-desktop-tab="posts"/);
  assert.match(navSection, /data-desktop-tab="chat"/);
  assert.match(navSection, /data-desktop-tab="ai"/);
  assert.match(navSection, /data-desktop-tab="profile"/);
  assert.match(navSection, /data-desktop-tab="code"/);
});

// ============================================================
// 5. 文件树使用懒加载
// ============================================================
test('file tree uses lazy loading — expandDirectory', () => {
  assert.match(codeFS, /expandDirectory/);
  assert.match(codeFS, /function expandDirectory/);
});

test('file tree does not recursively read entire project', () => {
  // buildFileTree should not call expandDirectory recursively
  assert.match(codeFS, /function buildFileTree/);
  // Children should be left empty for lazy loading (check the buildFileTree function)
  assert.match(codeFS, /children:\s*entries/);
  // Verify expandDirectory is a separate function for lazy loading
  assert.match(codeFS, /function expandDirectory/);
});

// ============================================================
// 6. node_modules 和 .git 被跳过
// ============================================================
test('SKIP_DIRS includes .git and node_modules', () => {
  assert.match(codeFS, /'\.git'/);
  assert.match(codeFS, /'node_modules'/);
  assert.match(codeFS, /'dist'/);
  assert.match(codeFS, /'build'/);
  assert.match(codeFS, /'coverage'/);
  assert.match(codeFS, /'\.cache'/);
  assert.match(codeFS, /'\.next'/);
});

test('shouldSkip checks SKIP_DIRS', () => {
  assert.match(codeFS, /function shouldSkip/);
  assert.match(codeFS, /SKIP_DIRS\.indexOf/);
});

// ============================================================
// 7. 文本文件可读取
// ============================================================
test('readFile handles text files', () => {
  assert.match(codeFS, /function readFile/);
  assert.match(codeFS, /file\.text\(\)/);
  assert.match(codeFS, /fileType === 'text'/);
});

// ============================================================
// 8. 图片和 PDF 可预览
// ============================================================
test('image preview is supported', () => {
  assert.match(codeWorkspace, /renderImagePreview/);
  assert.match(codeWorkspace, /function renderImagePreview/);
});

test('PDF preview is supported', () => {
  assert.match(codeWorkspace, /renderPdfPreview/);
  assert.match(codeWorkspace, /function renderPdfPreview/);
});

// ============================================================
// 9. 大文件被拒绝
// ============================================================
test('SIZE_LIMITS are defined', () => {
  assert.match(codeFS, /SIZE_LIMITS/);
  assert.match(codeFS, /text.*1.*1024.*1024/);
  assert.match(codeFS, /image.*15.*1024.*1024/);
  assert.match(codeFS, /pdf.*30.*1024.*1024/);
});

test('file size exceeds limit is rejected', () => {
  assert.match(codeFS, /exceeds.*size limit/);
  assert.match(codeFS, /file\.size > limit/);
});

// ============================================================
// 10. 上下文最多 12 个文件
// ============================================================
test('context limit is 12 files', () => {
  assert.match(codeWorkspace, /count >= 12/);
  assert.match(codeWorkspace, /最多添加 12 个文件/);
});

// ============================================================
// 12. API Key 不出现在前端文件
// ============================================================
test('DEEPSEEK_API_KEY not in frontend files', () => {
  assert.ok(!/DEEPSEEK_API_KEY/.test(codeFS), 'API Key should not be in code-file-system.js');
  assert.ok(!/DEEPSEEK_API_KEY/.test(codeWorkspace), 'API Key should not be in code-workspace.js');
  assert.ok(!/DEEPSEEK_API_KEY/.test(desktopShell), 'API Key should not be in desktop-shell.js');
});

// ============================================================
// 13. 非法路径被拒绝
// ============================================================
test('validatePath rejects empty path', () => {
  assert.match(codeFS, /path\.trim\(\) === ''/);
  assert.match(codeFS, /non-empty string/);
});

test('validatePath rejects absolute Windows paths', () => {
  assert.match(codeFS, /\[a-zA-Z\]:\[\\\\\/\]/);
  assert.match(codeFS, /absolute Windows paths are not allowed/);
});

test('validatePath rejects absolute Unix paths', () => {
  assert.match(codeFS, /absolute Unix paths are not allowed/);
});

// ============================================================
// 14. .. 路径被拒绝
// ============================================================
test('validatePath rejects .. traversal', () => {
  assert.match(codeFS, /parts\[i\] === '\.\.'/);
  assert.match(codeFS, /path traversal is not allowed/);
});

test('code-workspace also validates paths', () => {
  assert.match(codeWorkspace, /path\.indexOf\('\.\.'\) !== -1/);
  assert.match(codeWorkspace, /Path traversal is not allowed/);
});

// ============================================================
// 17. 未点击应用时不写文件
// ============================================================
test('pending operations are stored, not automatically applied', () => {
  assert.match(codeWorkspace, /state\.pendingOperations = data\.operations/);
  assert.match(codeWorkspace, /pendingOperations\.length > 0/);
});

// ============================================================
// 18. 应用后写入成功
// ============================================================
test('applyAllOperations exists', () => {
  assert.match(codeWorkspace, /function applyAllOperations/);
  assert.match(codeWorkspace, /writeFileByPath/);
});

// ============================================================
// 19. 写入失败时保留原文件和快照
// ============================================================
test('snapshots are saved before applying', () => {
  assert.match(codeWorkspace, /state\.snapshots\[op\.path\]/);
});

// ============================================================
// 20. 撤销能恢复原内容
// ============================================================
test('undoOperations restores snapshots', () => {
  assert.match(codeWorkspace, /function undoOperations/);
  assert.match(codeWorkspace, /state\.snapshots\[p\]/);
  assert.match(codeWorkspace, /已撤销所有更改/);
});

// ============================================================
// 21. 页面重复进入不积累监听器
// ============================================================
test('cleanup function exists', () => {
  assert.match(codeWorkspace, /function cleanup/);
  assert.match(codeWorkspace, /revokeAllUrls/);
  assert.match(codeWorkspace, /disposeMonaco/);
});

// ============================================================
// 22. object URL 被正确释放
// ============================================================
test('revokeAllUrls exists', () => {
  assert.match(codeFS, /function revokeAllUrls/);
  assert.match(codeFS, /URL\.revokeObjectURL/);
  assert.match(codeWorkspace, /function revokeAllUrls/);
});

// ============================================================
// 23. 不修改 Dock
// ============================================================
test('Dock-related code is not modified in code files', () => {
  // Code files should not reference dock DOM elements
  assert.ok(!/dock-nav/.test(codeFS), 'code-file-system.js should not modify dock');
  assert.ok(!/dock-nav/.test(codeWorkspace), 'code-workspace.js should not modify dock');
  assert.ok(!/dock-btn/.test(codeFS), 'code-file-system.js should not modify dock buttons');
  assert.ok(!/dock-btn/.test(codeWorkspace), 'code-workspace.js should not modify dock buttons');
});

// ============================================================
// 24. 不修改无关按钮
// ============================================================
test('code files do not modify other navigation buttons', () => {
  // Code files should not reference other tab names
  assert.ok(!/data-desktop-tab="posts"/.test(codeFS), 'code-fs should not modify posts tab');
  assert.ok(!/data-desktop-tab="chat"/.test(codeFS), 'code-fs should not modify chat tab');
  assert.ok(!/data-desktop-tab="ai"/.test(codeFS), 'code-fs should not modify ai tab');
});

// ============================================================
// Additional: Monaco editor lazy-load
// ============================================================
test('Monaco is lazy-loaded', () => {
  assert.match(codeWorkspace, /function loadMonaco/);
  assert.match(codeWorkspace, /monaco-editor@0\.45\.0/);
});

test('Monaco failure falls back to textarea', () => {
  assert.match(codeWorkspace, /function renderTextareaEditor/);
  assert.match(codeWorkspace, /textarea/);
});

// ============================================================
// Additional: IndexedDB storage
// ============================================================
test('IndexedDB is used for handle storage', () => {
  assert.match(codeFS, /xtj_code_workspace/);
  assert.match(codeFS, /function storeHandle/);
  assert.match(codeFS, /function restoreHandle/);
  assert.match(codeFS, /queryPermission/);
});

// ============================================================
// Additional: SHA-256 computation
// ============================================================
test('SHA-256 is computed for files', () => {
  assert.match(codeFS, /function getSHA256/);
  assert.match(codeFS, /crypto\.subtle\.digest.*SHA-256/);
});

// ============================================================
// Additional: Code module lazy loading via meta tags
// ============================================================
test('index.html has Code module meta tags', () => {
  assert.match(indexHtml, /xtj-module-code-fs/);
  assert.match(indexHtml, /xtj-module-code-workspace/);
  assert.match(indexHtml, /xtj-module-code-style/);
});

// ============================================================
// Additional: desktop-shell has Code refresh and lazy loading
// ============================================================
test('desktop-shell has code refreshTab case', () => {
  assert.match(desktopShell, /case 'code':/);
  assert.match(desktopShell, /__xtjCodeRefreshWorkspace/);
});

test('desktop-shell lazy-loads code modules on click', () => {
  assert.match(desktopShell, /tab === 'code' && typeof window\.__xtjCodeInit !== 'function'/);
  assert.match(desktopShell, /loadModuleScript\('code-fs'/);
  assert.match(desktopShell, /loadModuleScript\('code-workspace'/);
  assert.match(desktopShell, /loadModuleStyle\('code-css'/);
});

// ============================================================
// Additional: Diff view
// ============================================================
test('Diff view is rendered for pending operations', () => {
  assert.match(codeWorkspace, /function renderDiffView/);
  assert.match(codeWorkspace, /function computeDiff/);
  assert.match(codeWorkspace, /code-diff-line/);
});

// ============================================================
// Additional: Apply lock
// ============================================================
test('apply lock prevents concurrent applies', () => {
  assert.match(codeWorkspace, /_applyLock/);
  assert.match(codeWorkspace, /state\._applyLock = true/);
});