const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bootstrap = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'core-parts', '01-bootstrap.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');

/** 提取 gsap 模块定义块 */
function gsapDef(src) {
  const idx = src.indexOf('gsap: {');
  assert.notEqual(idx, -1, 'gsap 模块定义必须存在');
  // 取到闭合的 }（该定义很短，固定窗口足够）
  return src.slice(idx, idx + 600);
}

// --------------------------------------------------------- M-2 短期措施：SRI
test('M-2: gsap 外部脚本声明了 SRI integrity', () => {
  const block = gsapDef(bootstrap);
  assert.match(block, /integrity:\s*'sha384-[A-Za-z0-9+/=]+'/,
    'gsap 必须携带 sha384 integrity');
  assert.match(block, /crossOrigin:\s*'anonymous'/,
    '跨源 SRI 必须同时设置 crossOrigin');
});

test('M-2: SRI hash 与固定版本 URL 一一对应', () => {
  const block = gsapDef(bootstrap);
  const urlMatch = block.match(/url:\s*'(https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@([\d.]+)\/dist\/gsap\.min\.js)'/);
  assert.ok(urlMatch, 'gsap 必须使用带固定版本号的 jsdelivr URL');
  const version = urlMatch[2];
  assert.match(version, /^\d+\.\d+\.\d+$/, 'gsap 版本必须是精确的三段式版本号，禁止 latest/@3 之类浮动标签');

  // 已核验的 hash（openssl 与 Node crypto 双路径一致）
  assert.equal(
    block.match(/integrity:\s*'(sha384-[A-Za-z0-9+/=]+)'/)[1],
    'sha384-g4NTh/Iv5PPU4xPyhEWqPcwtNXOvdaDI8LLnyYfyNZOjKJeYQyjzQ9X5275eBjpt',
    'gsap@3.12.5 的 SRI hash 被改动 —— 若确为版本升级，请重新计算并同步更新此断言'
  );
});

test('M-2: 加载器会真正把 integrity 挂到 script 节点', () => {
  const start = bootstrap.indexOf('function loadModuleScript(');
  assert.notEqual(start, -1);
  const block = bootstrap.slice(start, start + 2600);
  assert.match(block, /node\.integrity\s*=\s*sriOpts\.integrity/);
  assert.match(block, /node\.crossOrigin\s*=\s*sriOpts\.crossOrigin\s*\|\|\s*'anonymous'/);
});

test('M-2: externalScripts 兼容字符串与对象两种形态', () => {
  // 回归保护：若只支持对象形态，旧的纯字符串写法会静默丢脚本
  const start = bootstrap.indexOf('(definition.externalScripts || []).forEach');
  assert.notEqual(start, -1);
  const block = bootstrap.slice(start, start + 700);
  assert.match(block, /typeof entry === 'string'/);
  assert.match(block, /entry && entry\.url/);
  // 无 url 的脏数据必须跳过而非抛错
  assert.match(block, /if \(!url\) return;/);
});

test('M-2: 拼装产物 core.js 与源码一致地包含 SRI', () => {
  const block = gsapDef(coreSource);
  assert.match(block, /integrity:\s*'sha384-/);
  assert.match(coreSource, /node\.integrity\s*=\s*sriOpts\.integrity/);
});
