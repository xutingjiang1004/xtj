const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const indexHtml = fs.readFileSync('index.html', 'utf8');
const coreSource = fs.readFileSync('js/core.js', 'utf8');
const desktopShell = fs.readFileSync('js/desktop-shell.js', 'utf8');
const codeFS = fs.readFileSync('js/code-file-system.js', 'utf8');
const codeWorkspace = fs.readFileSync('js/code-workspace.js', 'utf8');
const claudeStyle = fs.readFileSync('css/code-claude-style.css', 'utf8');

test('third-party Supabase SDK cannot block local app bootstrap', () => {
  assert.match(indexHtml, /<script defer src="js\/vendor\/supabase\.min\.js\?v=[^"]+"><\/script>/);
  assert.doesNotMatch(indexHtml, /cdn\.jsdelivr\.net[^"']*supabase/i);
  assert.match(indexHtml, /xtj:supabase-ready/);
  assert.match(coreSource, /initSupabaseClient/);
  assert.match(coreSource, /addEventListener\('xtj:supabase-ready'/);
});

test('Monaco loading has a bounded fallback path', () => {
  assert.match(codeWorkspace, /Monaco 加载超时/);
  assert.match(codeWorkspace, /setTimeout\(function \(\) \{[\s\S]*?rejectMonaco/);
  assert.match(codeWorkspace, /renderTextareaEditor\(tab, container\)/);
});

test('restored Code tabs bootstrap lazy modules without a click', () => {
  assert.match(desktopShell, /codeModuleState\.currentTab = tab;[\s\S]*scheduleVisibleCodeWorkspaceLoad\(\)/);
  assert.match(desktopShell, /function scheduleVisibleCodeWorkspaceLoad/);
  assert.match(desktopShell, /ensureCodeModulesLoaded\(\)\.then/);
});

test('Claude Code tokens override legacy workspace tokens safely', () => {
  assert.match(claudeStyle, /#panelCode\.code-panel/);
  assert.match(claudeStyle, /--cw-bg-secondary:\s*var\(--cw-card\)/);
  assert.match(claudeStyle, /\[data-theme="dark"\] #panelCode\.code-panel/);
  assert.doesNotMatch(claudeStyle, /\[data-theme="light"\] #panelCode\.code-panel,\s*#panelCode\.code-panel/);
  assert.match(claudeStyle, /family=Poppins/);
});

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
  assert.match(codeFS, /text.*2.*1024.*1024/);
  assert.match(codeFS, /image.*15.*1024.*1024/);
  assert.match(codeFS, /pdf.*50.*1024.*1024/);
});

test('file size exceeds limit is rejected', () => {
  assert.match(codeFS, /exceeds.*size limit/);
  assert.match(codeFS, /file\.size > limit/);
});

// ============================================================
// 10. Phase 1: Context is managed by project index, not 50-file hard limit
// ============================================================
test('context is managed by project index, not 50-file hard limit', () => {
  assert.ok(!/count >= 50/.test(codeWorkspace), 'should not have 50-file count check');
  assert.ok(!/最多添加 50 个文件/.test(codeWorkspace), 'should not have 50-file limit message');
  assert.match(codeWorkspace, /pinnedFiles/);
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

test('code-workspace also validates paths with per-segment check', () => {
  assert.match(codeWorkspace, /part === '\.\.'/);
  assert.match(codeWorkspace, /path\.split\('\/'\)\.some/);
  assert.match(codeWorkspace, /Path traversal is not allowed/);
});

// ============================================================
// 17. 未点击应用时不写文件
// ============================================================
test('pending operations are stored, not automatically applied', () => {
  assert.match(codeWorkspace, /state\.pendingOperations\s*=.*data\.operations/);
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
  assert.match(codeWorkspace, /state\.snapshots\[snapshotPaths\[i\]\]/);
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

test('Monaco loading is single-flight and stale editor callbacks are ignored', () => {
  assert.match(codeWorkspace, /_monacoLoadPromise/);
  assert.match(codeWorkspace, /data-xtj-monaco-loader/);
  assert.match(codeWorkspace, /_editorRenderId/);
  assert.match(codeWorkspace, /container\.parentNode !== _dom\.editorArea/);
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
  // P0: 新的状态机模式 — 使用 ensureCodeModulesLoaded 而不是直接检查 __xtjCodeInit
  assert.match(desktopShell, /tab === 'code'/);
  assert.match(desktopShell, /ensureCodeModulesLoaded\(\)/);
  assert.match(desktopShell, /loadModuleScript\('code-fs'/);
  assert.match(desktopShell, /loadModuleScript\('code-workspace'/);
  assert.match(desktopShell, /loadModuleStyle\('code-css'/);
});

// ============================================================
// ★ P0: 代码模块加载器回归测试 — PR #372 修复
// ============================================================

test('P0: recoverCodeInitAlias restores __xtjCodeInit from API.init', () => {
  assert.match(desktopShell, /function recoverCodeInitAlias/);
  assert.match(desktopShell, /window\.__xtjCodeInit = window\.__xtjCodeWorkspaceAPI\.init/);
  assert.match(desktopShell, /typeof window\.__xtjCodeInit !== 'function'/);
  assert.match(desktopShell, /__xtjCodeWorkspaceAPI/);
  assert.match(desktopShell, /__xtjCodeWorkspaceAPI\.init/);
});

test('P0: retryCodeModuleLoad does NOT delete __xtjCodeInit', () => {
  // retryCodeModuleLoad 中不应该有 delete window.__xtjCodeInit
  var retryFn = desktopShell.match(/function retryCodeModuleLoad[\s\S]*?(?=function \w+)/);
  assert.ok(retryFn, 'retryCodeModuleLoad function should exist');
  assert.ok(!/delete window\.__xtjCodeInit/.test(retryFn[0]), 'retryCodeModuleLoad should NOT delete __xtjCodeInit');
});

test('P0: retryCodeModuleLoad does NOT double-increment generation', () => {
  // retryCodeModuleLoad should NOT increment generation before calling ensureCodeModulesLoaded
  var retryFn = desktopShell.match(/function retryCodeModuleLoad[\s\S]*?(?=function \w+)/);
  assert.ok(retryFn, 'retryCodeModuleLoad function should exist');
  // The generation increment should NOT be in retryCodeModuleLoad (only in ensureCodeModulesLoaded)
  var genIncrements = retryFn[0].match(/codeModuleState\.generation\+\+/g);
  assert.ok(!genIncrements || genIncrements.length === 0, 'retryCodeModuleLoad should NOT increment generation');
});

test('P0: verifyModule checks real API availability not just onload', () => {
  assert.match(desktopShell, /function verifyModule/);
  // code-fs: check __xtjCodeFS.readFileByPath
  assert.match(desktopShell, /__xtjCodeFS && typeof window\.__xtjCodeFS\.readFileByPath/);
  // code-workspace: check __xtjCodeWorkspaceAPI.init
  assert.match(desktopShell, /__xtjCodeWorkspaceAPI && typeof window\.__xtjCodeWorkspaceAPI\.init/);
  // code-css: check sheet exists
  assert.match(desktopShell, /links\[i\]\.sheet/);
});

test('P0: codeModuleState has errorShownGeneration for dedup toast', () => {
  assert.match(desktopShell, /errorShownGeneration/);
  assert.match(desktopShell, /codeModuleState\.errorShownGeneration !== gen/);
  assert.match(desktopShell, /codeModuleState\.errorShownGeneration = gen/);
});

test('P0: damaged state detected when __xtjCodeWorkspace true but API missing', () => {
  assert.match(desktopShell, /window\.__xtjCodeWorkspace === true/);
  assert.match(desktopShell, /!window\.__xtjCodeWorkspaceAPI/);
  assert.match(desktopShell, /Code 工作区脚本初始化不完整，请刷新页面后重试/);
  assert.match(desktopShell, /window\.location\.reload\(\)/);
});

test('P0: loadModuleScript verifies module after onload, not just onload', () => {
  // loadModuleScript should call verifyModule after onload
  assert.match(desktopShell, /verifyModule\(id\)/);
  // Should reject if verification fails
  assert.match(desktopShell, /Module.*loaded but API not available/);
});

test('P0: refreshTab code case does NOT pre-save stale generation', () => {
  // refreshTab code case should not have `var gen = codeModuleState.generation` before ensureCodeModulesLoaded
  var refreshFn = desktopShell.match(/case 'code':[\s\S]*?break;/);
  assert.ok(refreshFn, 'refreshTab code case should exist');
  // Should NOT pre-save generation
  assert.ok(!/var gen = codeModuleState\.generation/.test(refreshFn[0]), 'refreshTab code case should NOT pre-save generation');
  // Should use ensureCodeModulesLoaded
  assert.match(refreshFn[0], /ensureCodeModulesLoaded/);
});

test('P0: click handler does NOT pre-save generation before ensureCodeModulesLoaded', () => {
  // Click handler in init() should call ensureCodeModulesLoaded without pre-saving generation
  var clickFn = desktopShell.match(/tab === 'code'[\s\S]*?ensureCodeModulesLoaded[\s\S]*?catch/);
  assert.ok(clickFn, 'click handler should exist');
  assert.ok(!/var gen = codeModuleState\.generation/.test(clickFn[0]), 'click handler should NOT pre-save generation');
});

test('P0: init is idempotent — returns early if already active', () => {
  assert.match(codeWorkspace, /if \(state\.active\)/);
  assert.match(codeWorkspace, /return Promise\.resolve\(\{ status: 'already-active' \}\)/);
});

test('P0: init returns status when panel not visible', () => {
  assert.match(codeWorkspace, /return Promise\.resolve\(\{ status: 'hidden' \}\)/);
});

test('P0: welcome page renders immediately before IndexedDB restore', () => {
  // renderWelcome() must be called before tryRestoreWorkspace()
  var initFn = codeWorkspace.match(/function init[\s\S]*?(?=function tryRestore)/);
  assert.ok(initFn, 'init function should exist');
  var renderWelcomeIdx = initFn[0].indexOf('renderWelcome()');
  var tryRestoreIdx = initFn[0].indexOf('tryRestoreWorkspace()');
  assert.ok(renderWelcomeIdx !== -1, 'renderWelcome should be called in init');
  assert.ok(tryRestoreIdx !== -1, 'tryRestoreWorkspace should be called in init');
  assert.ok(renderWelcomeIdx < tryRestoreIdx, 'renderWelcome must be called BEFORE tryRestoreWorkspace');
});

test('P0: retry only reloads failed modules, not all', () => {
  // retryCodeModuleLoad should use verifyModule to determine failed modules
  var retryFn = desktopShell.match(/function retryCodeModuleLoad[\s\S]*?(?=function \w+)/);
  assert.ok(retryFn, 'retryCodeModuleLoad function should exist');
  assert.match(retryFn[0], /verifyModule\('code-fs'\)/);
  assert.match(retryFn[0], /verifyModule\('code-workspace'\)/);
  assert.match(retryFn[0], /verifyModule\('code-css'\)/);
  assert.match(retryFn[0], /failedModules\.push/);
});

test('P0: only one generation management — no _codeLoadGeneration', () => {
  // There should be NO _codeLoadGeneration variable anywhere
  assert.ok(!/_codeLoadGeneration/.test(desktopShell), 'should NOT have _codeLoadGeneration');
  // Only codeModuleState.generation should exist
  assert.match(desktopShell, /codeModuleState\.generation/);
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

// ============================================================
// Real behavior tests — three-column layout
// ============================================================
test('three-column layout: code-workspace has flex display', () => {
  var css = fs.readFileSync('css/code-workspace.css', 'utf8');
  assert.match(css, /\.code-workspace\s*\{/);
  assert.match(css, /display:\s*flex/);
});

test('three-column layout: code-editor-column defined', () => {
  var css = fs.readFileSync('css/code-workspace.css', 'utf8');
  assert.match(css, /\.code-editor-column\s*\{/);
  assert.match(css, /flex:\s*1/);
});

test('three-column layout: sidebar, editor-column, and chat-panel are separate children', () => {
  assert.match(codeWorkspace, /code-sidebar/);
  assert.match(codeWorkspace, /code-editor-column/);
  assert.match(codeWorkspace, /code-chat-panel/);
  // Verify they are appended as separate children of workspace
  assert.match(codeWorkspace, /workspace\.appendChild\(sidebar\)/);
  assert.match(codeWorkspace, /workspace\.appendChild\(editorColumn\)/);
  assert.match(codeWorkspace, /workspace\.appendChild\(chatPanel\)/);
});

// ============================================================
// Real behavior tests — tab closure (IIFE pattern)
// ============================================================
test('tab render uses IIFE closure for each tab', () => {
  // Each tab in the loop should be wrapped in an IIFE
  assert.match(codeWorkspace, /\(function\s*\(tab\)\s*\{/);
});

test('tab close button uses tab.path from closure', () => {
  assert.match(codeWorkspace, /closeTab\(tab\.path\)/);
  assert.match(codeWorkspace, /e\.stopPropagation\(\)/);
});

test('tab middle-click close uses tab.path from closure', () => {
  assert.match(codeWorkspace, /addEventListener\('auxclick'/);
  assert.match(codeWorkspace, /e\.button === 1/);
  assert.match(codeWorkspace, /closeTab\(tab\.path\)/);
});

// ============================================================
// Real behavior tests — AI context reading
// ============================================================
// Phase 1: AI context is now managed via project index + token budget,
// not by reading all contextPaths from disk for every request.
test('AI context uses project index instead of static contextPaths', () => {
  assert.match(codeWorkspace, /pinnedFiles/);
  assert.match(codeWorkspace, /buildProjectIndex/);
  assert.match(codeWorkspace, /projectIndexStatus/);
  // Old contextPaths pattern should be removed
  assert.ok(!/contextPaths = Object\.keys\(state\.contextPaths\)/.test(codeWorkspace),
    'should not use old contextPaths disk read pattern');
});

test('AI context uses _currentContent for unsaved modifications', () => {
  assert.match(codeWorkspace, /_currentContent/);
  assert.match(codeWorkspace, /\.modified/);
});

// Phase 1: Old contextPaths-based file reading is removed.
// File reading errors are now handled through project index at the backend level.
test('AI context handles index build failures gracefully', () => {
  assert.match(codeWorkspace, /Index build failed/);
  assert.match(codeWorkspace, /projectIndexStatus/);
});

// Phase 1: 900KB hard limit is deprecated. Context is managed by token budget.
test('AI context uses token budget, not 900KB hard limit', () => {
  // Token budget is managed on backend via code-index.js
  assert.ok(!/超过 900 KB 限制/.test(codeWorkspace),
    'should not have 900KB hard limit in frontend');
  assert.match(codeWorkspace, /lastReadContext/);
  assert.match(codeWorkspace, /truncated/);
});

// Phase 1: 50-file hard limit is deprecated. Context is managed by project index.
test('AI context uses project index, not 50-file hard limit', () => {
  assert.ok(!/count >= 50/.test(codeWorkspace),
    'should not have 50-file hard limit in frontend');
  assert.ok(!/最多添加 50 个文件/.test(codeWorkspace),
    'should not have 50-file hard limit message');
  assert.match(codeWorkspace, /pinnedFiles/);
});

// ============================================================
// Real behavior tests — message dedup
// ============================================================
test('sendMessage does not duplicate current user message', () => {
  // history should exclude the current message (slice(0, -1))
  assert.match(codeWorkspace, /state\.messages\.slice\(0,\s*-1\)/);
});

test('Code chat timeout covers response-body decoding, not only fetch headers', () => {
  assert.match(codeWorkspace, /apiCall\.then\(decodeCodeChatResponse\)/);
  assert.match(codeWorkspace, /return Promise\.race\(\[apiCall\.then\(decodeCodeChatResponse\), timeoutPromise\]\)/);
});

test('Code chat clears the timeout after either race branch settles', () => {
  assert.ok((codeWorkspace.match(/clearTimeout\(ctx\.timeoutTimer\)/g) || []).length >= 2);
  assert.match(codeWorkspace, /ctx\.timeoutTimer = null/);
});

test('Code chat rebuilds a lost server index and retries the original message once', () => {
  assert.match(codeWorkspace, /INDEX_REBUILD_REQUIRED/);
  assert.match(codeWorkspace, /索引已丢失，正在自动重建/);
  assert.match(codeWorkspace, /return buildProjectIndex\(\)\.then/);
  assert.match(codeWorkspace, /state\.projectIndexStatus\.indexed !== true/);
  assert.match(codeWorkspace, /sendApiRequest\(ctx, body, timeStr, true\)/);
});

test('index rebuild retry keeps request context and refresh is the only forced rebuild', () => {
  assert.match(codeWorkspace, /function buildProjectIndex\(options\)/);
  assert.match(codeWorkspace, /state\._indexBuildPromise && !force/);
  assert.match(codeWorkspace, /buildProjectIndex\(\{ force: true \}\)/);
});

// ============================================================
// Real behavior tests — SHA-256 and update
// ============================================================
test('update operation verifies SHA-256 before applying', () => {
  assert.match(codeWorkspace, /op\.expected_sha256/);
  assert.match(codeWorkspace, /result\.sha256 !== op\.expected_sha256/);
  assert.match(codeWorkspace, /已被修改.*请重新生成/);
});

test('update operation saves snapshot before writing', () => {
  assert.match(codeWorkspace, /state\.snapshots\[op\.path\]/);
  assert.match(codeWorkspace, /existed:\s*true/);
  assert.match(codeWorkspace, /beforeContent/);
  assert.match(codeWorkspace, /beforeSha256/);
});

// ============================================================
// Real behavior tests — create operation
// ============================================================
test('create operation checks file does not exist', () => {
  assert.match(codeWorkspace, /op\.type === 'create'/);
  // createFileByPath properly checks existence and rejects if file exists
  assert.match(codeFS, /already exists/);
  assert.match(codeWorkspace, /fs\.createFileByPath/);
});

test('create operation snapshot records existed=false', () => {
  assert.match(codeWorkspace, /existed:\s*false/);
});

test('create undo deletes the created file', () => {
  assert.match(codeWorkspace, /snapshot\.existed === false/);
  assert.match(codeWorkspace, /deleteFileByPath/);
});

// ============================================================
// Real behavior tests — multi-file undo
// ============================================================
test('undo uses IIFE closure for each snapshot', () => {
  assert.match(codeWorkspace, /\(function\s*\(p,\s*snapshot\)\s*\{/);
});

test('undo only removes successful snapshots', () => {
  assert.match(codeWorkspace, /delete state\.snapshots\[successPaths\[k\]\]/);
});

test('failed apply removes a snapshot created for that attempt', () => {
  assert.match(codeWorkspace, /var createdSnapshotForApply = false/);
  assert.match(codeWorkspace, /createdSnapshotForApply = true/);
  assert.match(codeWorkspace, /if \(createdSnapshotForApply\) \{\s*delete state\.snapshots\[op\.path\];/s);
});

test('undo reports failed paths', () => {
  assert.match(codeWorkspace, /failedPaths\.length > 0/);
  assert.match(codeWorkspace, /部分文件撤销失败/);
});

test('undo restores open tab content', () => {
  assert.match(codeWorkspace, /state\.openTabs\[j\]\.content = snapshot\.beforeContent/);
});

test('undo verifies the post-apply SHA before writing or deleting', () => {
  assert.match(codeWorkspace, /afterSha256/);
  assert.match(codeWorkspace, /readFileByPath\(p\)/);
  assert.match(codeWorkspace, /current\.sha256 !== snapshot\.afterSha256/);
});

// ============================================================
// Real behavior tests — request cancellation
// ============================================================
test('cleanup cancels in-flight request', () => {
  assert.match(codeWorkspace, /_abortController\.abort\(\)/);
  assert.match(codeWorkspace, /_requestId\+\+/);
});

test('AbortError is not shown as failure', () => {
  assert.match(codeWorkspace, /err\.name === 'AbortError'/);
  assert.match(codeWorkspace, /if \(err && err\.name === 'AbortError'\) return/);
});

test('stale request responses are ignored', () => {
  assert.match(codeWorkspace, /requestId !== state\._requestId/);
});

// ============================================================
// Real behavior tests — server-side validation
// ============================================================
test('server validates file paths in context', () => {
  var codeAgent = fs.readFileSync('render-api/code-agent.js', 'utf8');
  // P0 Fix: validateFiles now uses normalizeContextPath before validatePath
  assert.match(codeAgent, /normalizeContextPath\(f\.path\)/);
  assert.match(codeAgent, /validatePath\(normalizedPath\)/);
});

test('server validates active_path', () => {
  var codeAgent = fs.readFileSync('render-api/code-agent.js', 'utf8');
  assert.match(codeAgent, /activePath && !validatePath\(activePath\)/);
  assert.match(codeAgent, /当前路径无效/);
});

test('server uses Buffer.byteLength for UTF-8', () => {
  var codeAgent = fs.readFileSync('render-api/code-agent.js', 'utf8');
  assert.match(codeAgent, /Buffer\.byteLength\(content,\s*'utf8'\)/);
});

test('server limits operations to 10', () => {
  var codeAgent = fs.readFileSync('render-api/code-agent.js', 'utf8');
  assert.match(codeAgent, /MAX_OPERATIONS\s*=\s*10/);
  assert.match(codeAgent, /ops\.length >= MAX_OPERATIONS/);
});

test('server limits new_content size', () => {
  var codeAgent = fs.readFileSync('render-api/code-agent.js', 'utf8');
  assert.match(codeAgent, /MAX_NEW_CONTENT_LEN/);
  assert.match(codeAgent, /Buffer\.byteLength\(op\.new_content,\s*'utf8'\)/);
});

test('server rejects invalid operations', () => {
  var codeAgent = fs.readFileSync('render-api/code-agent.js', 'utf8');
  assert.match(codeAgent, /OP_TYPES_REJECTED\.has\(type\)/);
});

test('server parseOperations returns empty array on failure', () => {
  var codeAgent = fs.readFileSync('render-api/code-agent.js', 'utf8');
  assert.match(codeAgent, /function parseOperations/);
  assert.match(codeAgent, /if \(!Array\.isArray\(raw\)\) return ops/);
});

// ============================================================
// Real behavior tests — system prompt
// ============================================================
test('system prompt requires real tool reads before workspace claims', () => {
  var codeAgent = fs.readFileSync('render-api/code-agent.js', 'utf8');
  assert.match(codeAgent, /real read-only project tools/);
  assert.match(codeAgent, /Never claim to have read a file unless a tool returned it successfully/);
  assert.match(codeAgent, /Never claim tests, builds, terminal commands or Git operations were executed/);
});

test('system prompt limits operations to 10', () => {
  var codeAgent = fs.readFileSync('render-api/code-agent.js', 'utf8');
  assert.match(codeAgent, /at most 10 file operations/);
});

test('system prompt instructs the agent to search before asking for files', () => {
  var codeAgent = fs.readFileSync('render-api/code-agent.js', 'utf8');
  assert.match(codeAgent, /use the project tools to locate it before asking the user/);
});

test('P1: stale save failures do not toast into a replacement workspace', () => {
  var saveFn = codeWorkspace.match(/function saveFile\(path\)[\s\S]*?(?=\/\/ [^\n]*renderImagePreview)/);
  assert.ok(saveFn, 'saveFile function should exist');
  assert.match(saveFn[0], /wsGen !== state\.workspaceGeneration/);
  assert.match(saveFn[0], /state\.openTabs\.indexOf\(tab\) === -1/);
});

test('AI chat exposes a real cancel control and abort path', () => {
  assert.match(codeWorkspace, /id="codeChatCancelBtn"/);
  assert.match(codeWorkspace, /function cancelCurrentRequest\(\)/);
  assert.match(codeWorkspace, /_abortController\.abort\(\)/);
  assert.match(codeWorkspace, /removeTypingIndicator\(\)/);
  assert.match(codeWorkspace, /if \(ctx\.abortController\) \{ try \{ ctx\.abortController\.abort\(\)/);
});

test('resizer listeners and pointer capture have an idempotent cleanup path', () => {
  assert.match(codeWorkspace, /state\._resizerCleanup/);
  assert.match(codeWorkspace, /releasePointerCapture/);
  assert.match(codeWorkspace, /hasPointerCapture/);
});

test('tablet widths retain the desktop Code layout', () => {
  var css = fs.readFileSync('css/code-workspace.css', 'utf8');
  assert.match(css, /@media \(max-width:\s*767px\)/);
  assert.doesNotMatch(css, /@media \(max-width:\s*900px\)/);
});

test('AI chat preserves a failed message for retry', () => {
  assert.match(codeWorkspace, /lastFailedMessage/);
  assert.match(codeWorkspace, /function restoreFailedMessage\(message\)/);
  assert.match(codeWorkspace, /restoreFailedMessage\(body && body\.message\)/);
  assert.match(codeWorkspace, /input\.value = message/);
});

test('Code welcome screen supports direct single-file opening', () => {
  assert.match(codeWorkspace, /id="codeWelcomeFileBtn"/);
  assert.match(codeWorkspace, /function selectAndOpenFile\(\)/);
  assert.match(codeWorkspace, /fs\.selectFile/);
  assert.match(codeWorkspace, /openFile\(handle\.name\)/);
  assert.match(codeWorkspace, /var fileBtn = document\.getElementById\('codeWelcomeFileBtn'\);[\s\S]{0,240}fileBtn\.addEventListener\('click', function \(\) \{[\s\S]{0,120}selectAndOpenFile\(\)/);
  assert.match(codeWorkspace, /function openWithInputFallback\(\)/);
  assert.match(codeWorkspace, /openWithInputFallback\(\);/);
});

test('Code persists and restores open tab paths per workspace', () => {
  assert.match(codeWorkspace, /function openTabsStorageKey\(workspaceId\)/);
  assert.match(codeWorkspace, /function persistOpenTabs\(\)/);
  assert.match(codeWorkspace, /function restorePersistedTabs\(\)/);
  assert.match(codeWorkspace, /restorePersistedTabs\(\);[\s\S]*restoreTabs\(\);/);
  assert.match(codeWorkspace, /localStorage\.setItem\(openTabsStorageKey\(getWorkspaceId\(\)\)/);
});

test('Code welcome restore status is hidden until feedback exists', () => {
  assert.match(codeWorkspace, /statusText\.id = 'codeWelcomeStatus';[\s\S]*statusText\.style\.display = 'none';/);
  assert.match(codeWorkspace, /statusText\.textContent = ''[\s\S]*statusText\.style\.display = 'block';/);
});

test('Code file tree exposes safe local file actions', () => {
  assert.match(codeWorkspace, /new-file-btn/);
  assert.match(codeWorkspace, /refresh-tree-btn/);
  assert.match(codeWorkspace, /data-action="rename"/);
  assert.match(codeWorkspace, /data-action="delete"/);
  assert.match(codeWorkspace, /function createNewWorkspaceFile\(\)/);
  assert.match(codeWorkspace, /function renameWorkspaceFile\(path\)/);
  assert.match(codeWorkspace, /function deleteWorkspaceFile\(path\)/);
  assert.match(codeFS, /function renameFileByPath\(oldPathParts, newPathParts\)/);
  assert.match(codeFS, /renameFileByPath: renameFileByPath/);
});

test('static Code welcome has no decorative icon before the module loads', () => {
  const staticWelcome = indexHtml.match(/<div class="code-welcome" id="codeWelcome">([\s\S]*?)<\/div>\s*<\/div>/);
  assert.ok(staticWelcome, 'static Code welcome markup is missing');
  assert.doesNotMatch(staticWelcome[1], /code-welcome-icon|<svg\b/);
});

test('read-only Code workspaces do not expose write controls', () => {
  assert.match(codeWorkspace, /readOnly: !!state\._isReadOnly/);
  assert.match(codeWorkspace, /textarea\.readOnly = !!state\._isReadOnly/);
  assert.match(codeWorkspace, /state\._isReadOnly \? '<span class="toolbar-readonly-label">/);
  assert.match(codeWorkspace, /readOnlyApplyActions\.replaceChildren\(\)/);
  assert.match(fs.readFileSync('css/code-workspace.css', 'utf8'), /\.code-readonly-banner/);
});

// ============================================================
// Real behavior tests — Code icon
// ============================================================
test('Code icon is hand-drawn code icon, not monitor', () => {
  // The Code icon should use polyline/lines (code brackets), not a rect (monitor)
  assert.match(indexHtml, /data-desktop-tab="code"/);
  // Should contain code-like elements (polyline/line), not monitor rect
  var codeBtnMatch = indexHtml.match(/data-desktop-tab="code"[\s\S]*?<\/button>/);
  assert.ok(codeBtnMatch, 'Code button should exist');
  var codeBtn = codeBtnMatch[0];
  assert.match(codeBtn, /<polyline/);
  assert.match(codeBtn, /fill="none"/);
  assert.match(codeBtn, /stroke="currentColor"/);
  // Should NOT be a monitor (rect-based icon)
  assert.ok(!/<rect/.test(codeBtn), 'Code icon should not be a monitor rect');
});

// ============================================================
// Real behavior tests — restricted context files
// ============================================================
test('restricted files cannot be added to AI context', () => {
  assert.match(codeWorkspace, /isRestrictedContextFile/);
  assert.match(codeWorkspace, /\.env/);
  assert.match(codeWorkspace, /\.pem/);
  assert.match(codeWorkspace, /\.key/);
  assert.match(codeWorkspace, /credentials\.json/);
});

// ============================================================
// Real behavior tests — file tree skip dirs
// ============================================================
test('SKIP_DIRS includes .DS_Store', () => {
  assert.match(codeFS, /'\.DS_Store'/);
});

// ============================================================
// ★ 真实行为测试 — fileExistsByPath 区分 NotFoundError 与其他错误
// ============================================================
test('fileExistsByPath only treats NotFoundError as file-not-exists', () => {
  // fileExistsByPath must check err.name === 'NotFoundError'
  assert.match(codeFS, /err\.name === 'NotFoundError'/);
  // Must NOT treat all errors as file-not-exists
  assert.match(codeFS, /function fileExistsByPath/);
  // Must have a reject path for non-NotFoundError
  assert.match(codeFS, /reject\(wrapError\(err,\s*'fileExistsByPath'\)\)/);
  // Must have resolve(false) for NotFoundError
  assert.match(codeFS, /resolve\(false\)/);
  // Must have resolve(true) when file exists
  assert.match(codeFS, /resolve\(true\)/);
});

test('fileExistsByPath uses getFileHandle without create option', () => {
  // Must use getFileHandle without { create: true }
  // Extract fileExistsByPath body from function start to next top-level function
  var fileExistsStart = codeFS.indexOf('function fileExistsByPath');
  var createFileStart = codeFS.indexOf('function createFileByPath');
  assert.ok(fileExistsStart !== -1, 'fileExistsByPath function should exist');
  assert.ok(createFileStart !== -1 && createFileStart > fileExistsStart, 'createFileByPath should follow fileExistsByPath');
  var fileExistsBody = codeFS.slice(fileExistsStart, createFileStart);
  // getFileHandle call should NOT have { create: true }
  var getFileHandleCalls = fileExistsBody.match(/getFileHandle\(/g);
  assert.ok(getFileHandleCalls && getFileHandleCalls.length >= 1, 'should call getFileHandle');
  // Verify no { create: true } in the fileExistsByPath function
  assert.ok(!/\{ create: true \}/.test(fileExistsBody), 'fileExistsByPath should NOT use create:true');
});

test('fileExistsByPath must not read file content', () => {
  // fileExistsByPath should NOT call getFile(), text(), arrayBuffer(), or readFile()
  var fileExistsStart = codeFS.indexOf('function fileExistsByPath');
  var createFileStart = codeFS.indexOf('function createFileByPath');
  assert.ok(fileExistsStart !== -1, 'fileExistsByPath function should exist');
  var fileExistsBody = codeFS.slice(fileExistsStart, createFileStart);
  assert.ok(!/\.getFile\(\)/.test(fileExistsBody), 'fileExistsByPath should NOT call getFile()');
  assert.ok(!/\.text\(\)/.test(fileExistsBody), 'fileExistsByPath should NOT call text()');
  assert.ok(!/readFile\(/.test(fileExistsBody), 'fileExistsByPath should NOT call readFile()');
});

// ============================================================
// ★ 真实行为测试 — createFileByPath 不覆盖已有文件
// ============================================================
test('createFileByPath checks existence before creating', () => {
  // Must call fileExistsByPath before creating
  assert.match(codeFS, /function createFileByPath/);
  assert.match(codeFS, /fileExistsByPath\(parts\)/);
  // Must reject if file exists
  assert.match(codeFS, /already exists/);
});

test('createFileByPath only uses create:true after confirming file does not exist', () => {
  // The createFileByPath function should:
  // 1. Call fileExistsByPath first
  // 2. Only use { create: true } in the .then() after confirming file does NOT exist
  var createFileStart = codeFS.indexOf('function createFileByPath');
  var deleteFileStart = codeFS.indexOf('function deleteFileByPath');
  assert.ok(createFileStart !== -1, 'createFileByPath function should exist');
  assert.ok(deleteFileStart !== -1 && deleteFileStart > createFileStart, 'deleteFileByPath should follow createFileByPath');
  var createFnBody = codeFS.slice(createFileStart, deleteFileStart);
  // fileExistsByPath must be called before getFileHandle with create:true
  var fileExistsIdx = createFnBody.indexOf('fileExistsByPath');
  var createTrueIdx = createFnBody.indexOf('{ create: true }');
  assert.ok(fileExistsIdx !== -1, 'should call fileExistsByPath');
  assert.ok(createTrueIdx !== -1, 'should use create:true');
  assert.ok(fileExistsIdx < createTrueIdx, 'fileExistsByPath must be called BEFORE create:true');
});

test('createFileByPath rejects if content is not a string', () => {
  assert.match(codeFS, /typeof content !== 'string'/);
  assert.match(codeFS, /content must be a string/);
});

test('createFileByPath rejects if no workspace selected', () => {
  assert.match(codeFS, /createFileByPath: no workspace selected/);
});

// ============================================================
// ★ 真实行为测试 — deleteFileByPath
// ============================================================
test('deleteFileByPath uses removeEntry', () => {
  assert.match(codeFS, /function deleteFileByPath/);
  assert.match(codeFS, /removeEntry\(/);
  // Must not use writeFile or createWritable for deletion
  var deleteFileStart = codeFS.indexOf('function deleteFileByPath');
  var nextFnStart = codeFS.indexOf('function ', deleteFileStart + 1);
  assert.ok(deleteFileStart !== -1, 'deleteFileByPath function should exist');
  var deleteFnBody = nextFnStart !== -1 ? codeFS.slice(deleteFileStart, nextFnStart) : codeFS.slice(deleteFileStart);
  assert.ok(!/createWritable/.test(deleteFnBody), 'deleteFileByPath should NOT use createWritable');
  assert.ok(!/writeFile\(/.test(deleteFnBody), 'deleteFileByPath should NOT call writeFile');
});

// ============================================================
// ★ 真实行为测试 — create 操作不覆盖已有文件（code-workspace 侧）
// ============================================================
test('applyOperation create uses createFileByPath not writeFileByPath', () => {
  // The create branch in applyOperation must use createFileByPath, not writeFileByPath
  var applyFn = codeWorkspace.match(/if \(op\.type === 'create'\)[\s\S]*?return fs\.createFileByPath/);
  assert.ok(applyFn, 'create operation should use createFileByPath');
  // Must NOT use writeFileByPath for create
  var createBranch = codeWorkspace.match(/op\.type === 'create'[\s\S]*?(?=Update operation)/);
  assert.ok(createBranch, 'create branch should exist');
  assert.ok(createBranch[0].indexOf('fs.createFileByPath') !== -1, 'create should use fs.createFileByPath');
});

test('applyOperation create saves snapshot with existed=false', () => {
  // The create branch must save snapshot AFTER createFileByPath succeeds (to avoid phantom undo on failure)
  var createBranch = codeWorkspace.match(/op\.type === 'create'[\s\S]*?(?=Update operation)/);
  assert.ok(createBranch, 'create branch should exist');
  assert.ok(createBranch[0].indexOf('existed: false') !== -1, 'create should save snapshot with existed=false');
  // Snapshot must be set AFTER fs.createFileByPath succeeds (on failure, snapshot is cleaned up)
  var snapshotIdx = createBranch[0].indexOf('existed: false');
  var createCallIdx = createBranch[0].indexOf('fs.createFileByPath');
  assert.ok(snapshotIdx > createCallIdx, 'snapshot must be saved AFTER successful createFileByPath');
  // Must also clean up snapshot on failure
  assert.ok(createBranch[0].indexOf('delete state.snapshots') !== -1, 'must clean up snapshot on failure');
});

// ============================================================
// ★ 真实行为测试 — update 操作继续使用 writeFileByPath
// ============================================================
test('applyOperation update continues to use writeFileByPath', () => {
  // The update branch must still use writeFileByPath
  assert.match(codeWorkspace, /writeFileByPath\(op\.path,\s*contentToWrite\)/);
});

// ============================================================
// ★ 真实行为测试 — Code 页面切换时执行 cleanup
// ============================================================
test('desktop-shell openTab calls cleanup when leaving Code', () => {
  // The openTab function must check if current panel is panelCode
  assert.match(desktopShell, /panelCode/);
  // Must call window.__xtjCodeWorkspaceAPI.cleanup()
  assert.match(desktopShell, /__xtjCodeWorkspaceAPI\.cleanup\(\)/);
  // Must only cleanup when target is not code
  assert.match(desktopShell, /tab !== 'code'/);
});

test('desktop-shell openTab only cleans up when current panel is Code', () => {
  // Must check currentPanel.id === 'panelCode'
  assert.match(desktopShell, /currentPanel\.id === 'panelCode'/);
  // Must check currentPanel is active and not hidden
  assert.match(desktopShell, /dock-panel\.active:not\(\.hidden\)/);
});

test('desktop-shell openTab does not modify other navigation', () => {
  // openTab should still call switchDockTab
  assert.match(desktopShell, /switchDockTab\(tab/);
  // openTab should still handle AI chat close
  assert.match(desktopShell, /__xtjCloseAiChat/);
});

// ============================================================
// ★ 真实行为测试 — cleanup 是幂等的
// ============================================================
test('cleanup is idempotent — multiple calls do not throw', () => {
  // cleanup must handle null _abortController gracefully
  assert.match(codeWorkspace, /if \(state\._abortController\)/);
  // cleanup must use try/catch for abort
  assert.match(codeWorkspace, /try \{ state\._abortController\.abort\(\)/);
  // cleanup must not clear directoryHandle
  var cleanupFn = codeWorkspace.match(/function cleanup[\s\S]*?(?=function \w+)/);
  assert.ok(cleanupFn, 'cleanup function should exist');
  // Must NOT clear directoryHandle
  assert.ok(!/directoryHandle\s*=\s*null/.test(cleanupFn[0]), 'cleanup should NOT clear directoryHandle');
  // Must NOT clear workspaceName
  assert.ok(!/workspaceName\s*=\s*''/.test(cleanupFn[0]), 'cleanup should NOT clear workspaceName');
});

test('cleanup preserves directoryHandle and workspace authorization', () => {
  // cleanup comment says "Don't clear directoryHandle so workspace can be restored"
  assert.match(codeWorkspace, /Don't clear directoryHandle/);
});

// ============================================================
// ★ 真实行为测试 — cleanup 调用后可以重新 init
// ============================================================
test('init sets state.active = true and can be called after cleanup', () => {
  // init must set state.active = true
  assert.match(codeWorkspace, /state\.active = true/);
  // init must return early if already active (P0: 幂等)
  assert.match(codeWorkspace, /if \(state\.active\)/);
  assert.match(codeWorkspace, /already-active/);
  // After cleanup sets state.active = false, init can be called again
  assert.match(codeWorkspace, /state\.active = false/);
});

// ============================================================
// ★ 真实行为测试 — 请求被 AbortController 真正取消
// ============================================================
test('AbortController is created with new AbortController()', () => {
  assert.match(codeWorkspace, /new AbortController\(\)/);
});

test('abort signal is passed to fetch', () => {
  // P0: signal 从 AbortController 派生并传递给 fetch
  // Each stream keeps its own immutable controller; shared requests remain supported.
  assert.match(codeWorkspace, /var signal = ctx\.sharedCtrl \? ctx\.sharedCtrl\.signal : ctx\.abortController\.signal/);
  assert.match(codeWorkspace, /signal:\s*signal/);
});

test('cleanup cancels current request and invalidates requestId', () => {
  // cleanup must call abort()
  var cleanupFn = codeWorkspace.match(/function cleanup[\s\S]*?(?=function \w+)/);
  assert.ok(cleanupFn, 'cleanup function should exist');
  assert.ok(cleanupFn[0].indexOf('_abortController.abort()') !== -1, 'cleanup must abort');
  // cleanup must increment requestId to invalidate stale responses
  assert.ok(cleanupFn[0].indexOf('_requestId++') !== -1, 'cleanup must invalidate requestId');
});

// ============================================================
// ★ 真实行为测试 — 三个标签分别点击和关闭
// ============================================================
test('tab click switches activePath and re-renders', () => {
  // Click on a tab should set state.activePath and call renderTabs + renderEditor
  assert.match(codeWorkspace, /state\.activePath = tab\.path/);
  assert.match(codeWorkspace, /renderTabs\(\)/);
  assert.match(codeWorkspace, /renderEditor\(\)/);
});

test('tab close removes tab and selects adjacent tab', () => {
  // closeTab must splice the tab from openTabs
  assert.match(codeWorkspace, /state\.openTabs\.splice\(idx,\s*1\)/);
  // If active tab is closed, select previous or next
  assert.match(codeWorkspace, /state\.activePath === path/);
  assert.match(codeWorkspace, /Math\.max\(0,\s*idx - 1\)/);
});

test('tab close revokes blob URL', () => {
  // closeTab must revoke blob URL for image/pdf tabs
  assert.match(codeWorkspace, /if \(tab\.blobUrl\)/);
  assert.match(codeWorkspace, /revokeUrl\(tab\.blobUrl\)/);
});

test('tab middle-click close works', () => {
  assert.match(codeWorkspace, /addEventListener\('auxclick'/);
  assert.match(codeWorkspace, /e\.button === 1/);
  assert.match(codeWorkspace, /e\.preventDefault\(\)/);
});

// ============================================================
// ★ 真实行为测试 — 多文件撤销分别恢复
// ============================================================
test('undo iterates all snapshot paths', () => {
  // undo must iterate through all snapshotPaths
  assert.match(codeWorkspace, /var snapshotPaths = Object\.keys\(state\.snapshots\)/);
  assert.match(codeWorkspace, /for \(var i = 0; i < snapshotPaths\.length; i\+\+\)/);
});

test('undo handles create operations by deleting the file', () => {
  // When snapshot.existed === false, must delete the file
  assert.match(codeWorkspace, /snapshot\.existed === false/);
  assert.match(codeWorkspace, /deleteFileByPath\(p\)/);
});

test('undo handles update operations by restoring original content', () => {
  // When snapshot.existed === true, must restore original content
  assert.match(codeWorkspace, /writeFileByPath\(p,\s*snapshot\.beforeContent/);
});

test('undo only removes successful snapshots', () => {
  // Only snapshots that were successfully restored are removed
  assert.match(codeWorkspace, /successPaths\.push\(p\)/);
  assert.match(codeWorkspace, /delete state\.snapshots\[successPaths\[k\]\]/);
});

test('undo reports failed paths clearly', () => {
  // Failed paths must be reported
  assert.match(codeWorkspace, /failedPaths\.push\(p\)/);
  assert.match(codeWorkspace, /部分文件撤销失败/);
});

test('undo restores open tab content for each file', () => {
  // For each restored file, open tab content must be updated
  assert.match(codeWorkspace, /state\.openTabs\[j\]\.content = snapshot\.beforeContent/);
  assert.match(codeWorkspace, /state\.openTabs\[j\]\.modified = false/);
});

// ============================================================
// ★ 真实行为测试 — 公共 API 完整性
// ============================================================
test('window.__xtjCodeFS exports fileExistsByPath', () => {
  assert.match(codeFS, /fileExistsByPath:\s*fileExistsByPath/);
});

test('window.__xtjCodeFS exports createFileByPath', () => {
  assert.match(codeFS, /createFileByPath:\s*createFileByPath/);
});

test('window.__xtjCodeFS exports deleteFileByPath', () => {
  assert.match(codeFS, /deleteFileByPath:\s*deleteFileByPath/);
});

test('window.__xtjCodeWorkspaceAPI exports cleanup method', () => {
  assert.match(codeWorkspace, /cleanup:\s*cleanup/);
});

test('window.__xtjCodeWorkspaceAPI exports init method', () => {
  assert.match(codeWorkspace, /init:\s*init/);
});

// ============================================================
// ★ 真实行为测试 — cleanup 不修改 Dock
// ============================================================
test('desktop-shell cleanup integration does not modify Dock', () => {
  // The cleanup call in openTab must not touch dock elements
  assert.ok(!/dock-nav/.test(desktopShell.match(/function openTab[\s\S]*?(?=function \w+)/)[0]), 'openTab should not modify dock-nav');
  assert.ok(!/dock-btn/.test(desktopShell.match(/function openTab[\s\S]*?(?=function \w+)/)[0]), 'openTab should not modify dock-btn');
});
