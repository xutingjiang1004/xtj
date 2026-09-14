// ============================================================================
// tests/sandbox-contract.test.js
// 强隔离沙箱契约测试
//
// 保护点（任何一项失败都意味着安全或可用性回退）：
//   1. sandbox.js 存在且导出 runInSandbox / listSandboxLibs / sandboxInfo
//   2. server.js 已委派到 sandbox 模块（不再自行实现 vm 沙箱）
//   3. isolated-vm 能正常加载并作为首选引擎
//   4. 预装库在沙箱内可用（lodash / mathjs / Papa / dayjs / Decimal / fxp）
//   5. 安全边界：process / require / Buffer / fetch / setTimeout 不可见
//   6. 原型链逃逸被阻断（经典 vm 逃逸手法）
//   7. 资源限制：硬超时 + 内存上限真实生效
//   8. 降级路径：isolated-vm 不可用时仍能执行（vm 兜底）
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SANDBOX_PATH = path.join(ROOT, 'render-api', 'sandbox.js');
const SERVER_PATH = path.join(ROOT, 'render-api', 'server.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✅ ' + name); passed++; }
  catch (e) { console.log('  ❌ ' + name + '\n     ' + ((e && e.message) || e)); failed++; }
}

console.log('=== 强隔离沙箱契约测试 ===\n');

// ---------------------------------------------------------------------------
// 1. 模块存在性与导出
// ---------------------------------------------------------------------------
console.log('【1】模块结构与导出');

test('sandbox.js 文件存在', () => {
  assert.ok(fs.existsSync(SANDBOX_PATH), 'render-api/sandbox.js 不存在');
});

const sb = require(SANDBOX_PATH);

test('导出 runInSandbox 为函数', () => {
  assert.strictEqual(typeof sb.runInSandbox, 'function');
});

test('导出 listSandboxLibs 为函数且返回数组', () => {
  assert.strictEqual(typeof sb.listSandboxLibs, 'function');
  assert.ok(Array.isArray(sb.listSandboxLibs()));
});

test('导出 sandboxInfo 为函数', () => {
  assert.strictEqual(typeof sb.sandboxInfo, 'function');
  const info = sb.sandboxInfo();
  assert.ok(info && typeof info === 'object');
  assert.ok(typeof info.engine === 'string');
});

// ---------------------------------------------------------------------------
// 2. server.js 已委派
// ---------------------------------------------------------------------------
console.log('\n【2】server.js 委派关系');

const serverSrc = fs.readFileSync(SERVER_PATH, 'utf8');

test('server.js 引入 sandbox 模块', () => {
  assert.ok(/require\(\s*['"]\.\/sandbox['"]\s*\)/.test(serverSrc),
    '未发现 require("./sandbox")');
});

test('server.js 的 runInSandbox 委派给模块', () => {
  assert.ok(/sandboxModule\.runInSandbox\s*\(/.test(serverSrc),
    'runInSandbox 未委派到 sandboxModule');
});

test('server.js 不再直接调用 vm.runInContext 执行用户代码', () => {
  // 允许 vm 用于其他用途，但不应在沙箱实现里出现 createContext + runInContext 组合
  const hasOldSandbox = /vm\.createContext\(sandbox\)/.test(serverSrc);
  assert.ok(!hasOldSandbox, 'server.js 仍存在旧的 vm.createContext(sandbox) 沙箱实现');
});

test('health 端点暴露沙箱状态', () => {
  assert.ok(/sandbox:\s*sandboxStatus/.test(serverSrc),
    'health 未返回 sandbox 状态字段');
});

test('run_code 工具描述提到预装库', () => {
  const idx = serverSrc.indexOf("name: 'run_code'");
  assert.ok(idx > 0, '未找到 run_code 工具定义');
  const seg = serverSrc.slice(idx, idx + 1400);
  assert.ok(/lodash/.test(seg), 'run_code 描述未提及 lodash');
  assert.ok(/mathjs|math\.evaluate/.test(seg), 'run_code 描述未提及 mathjs');
  assert.ok(/Papa/.test(seg), 'run_code 描述未提及 Papa');
  assert.ok(/dayjs/.test(seg), 'run_code 描述未提及 dayjs');
});

test('工作模式 prompt 提示沙箱预装库（两处）', () => {
  const matches = serverSrc.match(/run_code 沙箱已预装常用库/g) || [];
  assert.ok(matches.length >= 2,
    '应在两处工作模式 prompt 中各提示一次，实际 ' + matches.length + ' 处');
});

// ---------------------------------------------------------------------------
// 3. 引擎
// ---------------------------------------------------------------------------
console.log('\n【3】执行引擎');

test('isolated-vm 可用（首选引擎）', () => {
  const info = sb.sandboxInfo();
  assert.strictEqual(info.engine, 'isolated-vm',
    'isolated-vm 未生效，当前引擎：' + info.engine +
    (info.loadError ? '（加载错误：' + info.loadError + '）' : ''));
});

test('预装库全部可用', () => {
  const libs = sb.listSandboxLibs();
  ['lodash', 'mathjs', 'Papa', 'dayjs', 'Decimal', 'fxp'].forEach(k => {
    assert.ok(libs.indexOf(k) >= 0, '缺少预装库：' + k);
  });
});

// ---------------------------------------------------------------------------
// 4. 基础执行
// ---------------------------------------------------------------------------
console.log('\n【4】基础执行能力');

test('基本计算与 input 注入', () => {
  const r = sb.runInSandbox('return input.a + input.b', { a: 2, b: 3 });
  assert.strictEqual(String(r).trim(), '5');
});

test('console.log 采集', () => {
  const r = sb.runInSandbox('console.log("hi", 42); return "ok";');
  assert.ok(/hi 42/.test(r), 'console.log 未采集，实际：' + r);
  assert.ok(/ok/.test(r), '返回值未输出，实际：' + r);
});

test('无输出时给出友好提示', () => {
  const r = sb.runInSandbox('var x = 1;');
  assert.ok(/无输出/.test(r), '实际：' + r);
});

test('空代码被拒绝', () => {
  assert.throws(() => sb.runInSandbox('   '), /代码为空/);
});

test('超长代码被拒绝', () => {
  assert.throws(() => sb.runInSandbox('x'.repeat(20001)), /代码过长/);
});

test('循环引用返回值不崩溃', () => {
  const r = sb.runInSandbox('var o = {a:1}; o.self = o; return o;');
  assert.ok(/Circular/.test(r), '实际：' + r);
});

// ---------------------------------------------------------------------------
// 5. 预装库实际可用
// ---------------------------------------------------------------------------
console.log('\n【5】预装库实际可用性');

test('lodash 可用（_ 别名）', () => {
  const r = sb.runInSandbox('return _.sum([1,2,3,4])');
  assert.strictEqual(String(r).trim(), '10');
});

test('lodash 可用（lodash 全名）', () => {
  const r = sb.runInSandbox('return lodash.chunk([1,2,3,4,5], 2).length');
  assert.strictEqual(String(r).trim(), '3');
});

test('lodash.groupBy 可用', () => {
  const r = sb.runInSandbox('return Object.keys(_.groupBy([1,2,3,4], n => n % 2)).join(",")');
  assert.ok(/0,1/.test(r), '实际：' + r);
});

test('mathjs 可用（math 别名）', () => {
  const r = sb.runInSandbox('return math.evaluate("sqrt(16) + 2^10")');
  assert.strictEqual(String(r).trim(), '1028');
});

test('mathjs 可用（mathjs 全名）', () => {
  const r = sb.runInSandbox('return mathjs.round(mathjs.pi, 4)');
  assert.ok(/3\.1416/.test(r), '实际：' + r);
});

test('Papa 解析 CSV', () => {
  const r = sb.runInSandbox('return Papa.parse("a,b\\n1,2\\n3,4", {header:true}).data.length');
  assert.ok(/2/.test(r), '实际：' + r);
});

test('dayjs 日期运算', () => {
  const r = sb.runInSandbox('return dayjs("2026-01-01").add(1, "day").format("YYYY-MM-DD")');
  assert.ok(/2026-01-02/.test(r), '实际：' + r);
});

test('Decimal 高精度运算', () => {
  const r = sb.runInSandbox('return new Decimal(0.1).plus(0.2).toString()');
  assert.ok(/^0\.3/.test(String(r).trim()), '实际：' + r);
});

test('fast-xml-parser 解析 XML', () => {
  const r = sb.runInSandbox('return new fxp.XMLParser().parse("<a><b>1</b></a>").a.b');
  assert.ok(/1/.test(r), '实际：' + r);
});

// ---------------------------------------------------------------------------
// 6. 安全边界
// ---------------------------------------------------------------------------
console.log('\n【6】安全边界');

const HIDDEN = ['process', 'require', 'Buffer', 'fetch', 'setTimeout', 'setInterval', 'module'];
HIDDEN.forEach(name => {
  test(name + ' 在沙箱内不可见', () => {
    const r = String(sb.runInSandbox('return typeof ' + name)).trim();
    assert.strictEqual(r, 'undefined', name + ' 可见，实际类型：' + r);
  });
});

test('原型链逃逸被阻断（constructor.constructor）', () => {
  const r = sb.runInSandbox(
    'try { return typeof (function(){}).constructor("return process")(); }' +
    ' catch(e) { return "blocked"; }'
  );
  assert.ok(/blocked/.test(r), '逃逸未阻断，实际：' + r);
});

test('globalThis.process 不存在', () => {
  const r = String(sb.runInSandbox('return typeof globalThis.process')).trim();
  assert.strictEqual(r, 'undefined', '实际：' + r);
});

test('沙箱内无法访问宿主文件系统', () => {
  const r = sb.runInSandbox(
    'try { (function(){}).constructor("return this.process.mainModule.require(\'fs\')")(); return "escaped"; }' +
    ' catch(e) { return "blocked"; }'
  );
  assert.ok(/blocked/.test(r), '逃逸未阻断，实际：' + r);
});

// ---------------------------------------------------------------------------
// 7. 资源限制
// ---------------------------------------------------------------------------
console.log('\n【7】资源限制');

test('死循环触发硬超时', () => {
  assert.throws(
    () => sb.runInSandbox('while(true){}'),
    /timed out|timeout/i,
    '死循环未超时'
  );
});

test('内存爆炸触发内存上限', () => {
  assert.throws(
    () => sb.runInSandbox('var a=[]; while(true){ a.push(new Array(100000).fill(0)); }'),
    /memory limit|disposed/i,
    '内存未受限'
  );
});

test('超时后不影响后续调用（隔离性）', () => {
  let threw = false;
  try { sb.runInSandbox('while(true){}'); } catch (e) { threw = true; }
  assert.ok(threw, '前置超时未抛出');
  const r = sb.runInSandbox('return 1 + 1');
  assert.strictEqual(String(r).trim(), '2', '超时后沙箱状态被污染');
});

// ---------------------------------------------------------------------------
// 8. 降级路径
// ---------------------------------------------------------------------------
console.log('\n【8】降级路径（vm 兜底）');

test('sandbox.js 包含 vm 降级实现', () => {
  const src = fs.readFileSync(SANDBOX_PATH, 'utf8');
  assert.ok(/function runInVmFallback/.test(src), '未找到 runInVmFallback');
  assert.ok(/vm\.createContext/.test(src), '降级实现未使用 vm.createContext');
});

test('isolated-vm 加载失败时降级（require 失败被捕获）', () => {
  const src = fs.readFileSync(SANDBOX_PATH, 'utf8');
  assert.ok(/ivm\s*=\s*null;\s*ivmLoadError/.test(src),
    '未捕获 isolated-vm 加载失败');
});

test('runInSandbox 在 ivm 缺失时走降级分支', () => {
  const src = fs.readFileSync(SANDBOX_PATH, 'utf8');
  assert.ok(/return runInVmFallback\(src, input\);/.test(src),
    '未在 ivm 缺失时降级');
});

test('区分用户代码错误与沙箱基础设施错误', () => {
  const src = fs.readFileSync(SANDBOX_PATH, 'utf8');
  assert.ok(/isUserError/.test(src), '未区分用户错误与基础设施错误');
  // 用户语法错误应原样抛出，而不是被降级吞掉
  assert.throws(() => sb.runInSandbox('this is not valid js !!!'), /./);
});

// ---------------------------------------------------------------------------
// 9. 真实场景回归（对应 run_code 常见用法）
// ---------------------------------------------------------------------------
console.log('\n【9】真实场景回归');

test('场景：数组中位数', () => {
  const r = sb.runInSandbox('var a=[3,1,2]; a.sort((x,y)=>x-y); return a[Math.floor(a.length/2)]');
  assert.strictEqual(String(r).trim(), '2');
});

test('场景：CSV 数值求和', () => {
  const r = sb.runInSandbox(
    'var rows = Papa.parse(input, {header:true}).data;' +
    'return _.sumBy(rows, r => Number(r.amount));',
    'name,amount\nA,10\nB,20\nC,30'
  );
  assert.ok(/60/.test(r), '实际：' + r);
});

test('场景：分组统计', () => {
  const r = sb.runInSandbox(
    'var g = _.groupBy(input, "type");' +
    'return _.mapValues(g, arr => arr.length);',
    [{ type: 'a' }, { type: 'b' }, { type: 'a' }]
  );
  assert.ok(/"a":\s*2/.test(r), '实际：' + r);
});

test('场景：日期差计算', () => {
  const r = sb.runInSandbox('return dayjs("2026-12-31").diff(dayjs("2026-01-01"), "day")');
  assert.strictEqual(String(r).trim(), '364');
});

test('场景：高精度金额累加', () => {
  const r = sb.runInSandbox(
    'return input.reduce((s, v) => s.plus(v), new Decimal(0)).toString()',
    ['0.1', '0.2', '0.3']
  );
  assert.ok(/^0\.6/.test(String(r).trim()), '实际：' + r);
});

// ---------------------------------------------------------------------------
console.log('\n=== 结果 ===');
console.log('  Passed: ' + passed);
console.log('  Failed: ' + failed);
if (failed > 0) process.exitCode = 1;
