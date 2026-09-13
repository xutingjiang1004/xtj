const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const loginDevice = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'login-device.js'), 'utf8');
const earlyFeed = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'early-feed.js'), 'utf8');
const chatNav = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'core-parts', '06-chat-and-nav.js'), 'utf8');
const coreSource = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'core.js'), 'utf8');

// ---------------------------------------------------------- S-1（定时器生命周期）
// 背景：现代浏览器进入 bfcache 不触发 beforeunload；只靠 beforeunload 清理的定时器
// 会跨页存活，返回后可能对已恢复的 DOM 做覆盖。以下锁定 pagehide 覆盖率。

test('S-1: 错误去重清理定时器在 pagehide 时清理', () => {
  const idx = loginDevice.indexOf('var _errorCleanupTimer = setInterval(');
  assert.notEqual(idx, -1, '错误清理定时器必须存在');
  const block = loginDevice.slice(idx, idx + 900);
  assert.match(block, /addEventListener\('pagehide',\s*function\(\)\s*\{\s*clearInterval\(_errorCleanupTimer\)/,
    '必须在 pagehide 清理（beforeunload 在 bfcache 场景不触发）');
});

test('S-1: 错误去重表有容量上限，不会随动态 key 无限增长', () => {
  const start = loginDevice.indexOf('function sendClientError(');
  assert.notEqual(start, -1);
  const block = loginDevice.slice(start, start + 900);
  assert.match(block, /capErrorSent/, '必须有容量上限保护');
  assert.match(block, /keys\.length\s*<=\s*500/, '上限阈值必须存在');
  assert.match(block, /delete errorSent\[keys\[i\]\]/, '超限时按最旧淘汰');
});

test('S-1: feed 看门狗在 pagehide 时清理', () => {
  const idx = chatNav.indexOf('function setupFeedBootWatchdog()');
  assert.notEqual(idx, -1);
  const block = chatNav.slice(idx, idx + 3200);
  assert.match(block, /addEventListener\('pagehide',\s*function\(\)\s*\{\s*clearInterval\(timer\)/,
    'feed 看门狗必须在 pagehide 清理');
  // 原有的自清路径必须保留（有内容/有错误时立即停）
  assert.match(block, /if \(hasPosts \|\| hasError\)/);
});

test('S-1: early-feed 的延迟回调在页面隐藏后跳过 DOM 改写', () => {
  // 标记与双事件监听
  assert.match(earlyFeed, /var pageHidden = false;/);
  assert.match(earlyFeed, /addEventListener\('pagehide',\s*function\s*\(\)\s*\{\s*pageHidden = true;/);
  assert.match(earlyFeed, /pageshow/);
  assert.match(earlyFeed, /e\.persisted\)\s*pageHidden = false/,
    'bfcache 恢复时必须复位标记，否则页面重新可见后正常渲染被永久跳过');

  // 4 处延迟回调全部有守卫
  const guards = earlyFeed.match(/if \(pageHidden\) return;/g) || [];
  assert.equal(guards.length, 4,
    `early-feed 应有 4 处 pageHidden 守卫，实际 ${guards.length} 处`);

  // paintMinimal / showError 的调用点必须都在守卫之后
  // 注意：需排除函数定义行本身（function paintMinimal(data) { ... }）
  const callSites = earlyFeed.split('\n')
    .map((line, i) => ({ line: line, no: i + 1 }))
    .filter(x => /paintMinimal\(data\)|showError\('帖子加载超时/.test(x.line))
    .filter(x => !/function\s+paintMinimal/.test(x.line));

  assert.ok(callSites.length >= 3,
    `应至少有 3 处 paintMinimal/showError 调用点，实际 ${callSites.length}`);

  for (const site of callSites) {
    // 向上找最近的守卫或函数体开头
    const lines = earlyFeed.split('\n');
    let guarded = false;
    for (let i = site.no - 1; i >= Math.max(0, site.no - 8); i--) {
      if (/if \(pageHidden\) return;/.test(lines[i])) { guarded = true; break; }
      // 遇到新的 setTimeout 边界即停止回溯（说明该调用不在守卫作用域内）
      if (/setTimeout\(function/.test(lines[i])) break;
    }
    assert.ok(guarded, `第 ${site.no} 行的调用点缺少 pageHidden 守卫: ${site.line.trim()}`);
  }
});

test('S-1: 拼装产物 core.js 包含 feed 看门狗的 pagehide 清理', () => {
  assert.match(coreSource, /addEventListener\('pagehide',\s*function\(\)\s*\{\s*clearInterval\(timer\)/);
});
