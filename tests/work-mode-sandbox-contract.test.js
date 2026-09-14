// 工作模式 · 代码沙箱与新增工具 契约测试
// 覆盖：run_code 沙箱隔离性、process_json、encode_decode、date_calc、text_stats
// 目标：确保沙箱不可逃逸（无 process/require/global/Buffer/fetch），且有超时保护。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');

// 从 server.js 提取 runInSandbox 实现用于独立测试（与生产代码同源，避免测试与实现漂移）
function loadRunInSandbox() {
  const start = serverSrc.indexOf('function runInSandbox(code, input) {');
  const end = serverSrc.indexOf('\n// 按点/中括号路径提取 JSON 值');
  assert.ok(start > -1 && end > start, '未找到 runInSandbox 实现');
  const fnCode = serverSrc.slice(start, end);
  return new Function('vm', fnCode + '\nreturn runInSandbox;')(vm);
}

test('工具定义：AI_TOOLS 含 run_code / process_json / encode_decode / date_calc / text_stats', () => {
  ['run_code', 'process_json', 'encode_decode', 'date_calc', 'text_stats'].forEach((n) => {
    assert.match(serverSrc, new RegExp("name: '" + n + "'"), '缺少工具定义: ' + n);
    assert.match(serverSrc, new RegExp("case '" + n + "'"), '缺少执行分支: ' + n);
  });
});

test('沙箱：正常数据计算可用', () => {
  const runInSandbox = loadRunInSandbox();
  const r1 = runInSandbox('var a=[3,1,2,5,4]; a.sort(function(x,y){return x-y}); return a[Math.floor(a.length/2)];');
  assert.equal(String(r1).trim(), '3');
  const r2 = runInSandbox('return {sum: [1,2,3].reduce(function(a,b){return a+b},0)};');
  assert.match(r2, /"sum": 6/);
  const r3 = runInSandbox('return input.x * 2;', { x: 21 });
  assert.equal(String(r3).trim(), '42');
});

test('沙箱：console.log 输出被采集', () => {
  const runInSandbox = loadRunInSandbox();
  const r = runInSandbox('console.log("hello", 1+1);');
  assert.match(r, /hello 2/);
});

test('沙箱：禁止逃逸到 process / require / global / Buffer / fetch', () => {
  const runInSandbox = loadRunInSandbox();
  const probes = ['process', 'require', 'global', 'globalThis', 'Buffer', 'fetch'];
  probes.forEach((p) => {
    const r = runInSandbox('return typeof ' + p + ';');
    assert.equal(String(r).trim(), 'undefined', p + ' 必须不可用，实际: ' + r);
  });
});

test('沙箱：Function 构造器被封堵', () => {
  const runInSandbox = loadRunInSandbox();
  let escaped = false;
  try {
    const r = runInSandbox('try { return (new Function("return 1"))(); } catch(e) { return "blocked"; }');
    escaped = !/blocked/.test(r);
  } catch (e) {
    escaped = false; // 抛错也视为已封堵
  }
  assert.equal(escaped, false, 'Function 构造器逃逸未被封堵');
});

test('沙箱：死循环被 3 秒超时中断', () => {
  const runInSandbox = loadRunInSandbox();
  assert.throws(() => runInSandbox('while(true){}'), /timed out|timeout/i, '死循环未被超时中断');
});

test('沙箱：超长代码被拒绝', () => {
  const runInSandbox = loadRunInSandbox();
  const longCode = 'var a=1;'.repeat(4000);
  assert.throws(() => runInSandbox(longCode), /过长/, '超长代码未被拒绝');
});

test('沙箱：源码包含安全护栏注释与关键封堵', () => {
  assert.match(serverSrc, /var vm = require\('vm'\)/);
  assert.match(serverSrc, /timeout: 3000/);
  assert.match(serverSrc, /sandbox\.process = undefined/);
  assert.match(serverSrc, /sandbox\.require = undefined/);
  assert.match(serverSrc, /src\.length > 20000/);
});

test('工作模式：system prompt 注入含工作模式指令与沙箱提示', () => {
  assert.match(serverSrc, /【工作模式】/);
  assert.match(serverSrc, /沙箱跑 run_code/);
  // 两条聊天路径均应注入
  const cnt = (serverSrc.match(/【工作模式】/g) || []).length;
  assert.ok(cnt >= 2, '工作模式 prompt 应注入到两条聊天路径，实际: ' + cnt);
});

test('工作模式：工具轮数提升到 8 且保留硬上限', () => {
  assert.match(serverSrc, /max_tool_rounds: workModeEnabled \? 8 : 4/);
  assert.match(serverSrc, /Math\.min\(Math\.max\(parseInt\(options && options\.max_tool_rounds\) \|\| 4, 1\), 8\)/);
});

test('工作模式：绕过关键词意图预判', () => {
  assert.match(serverSrc, /if \(workModeEnabled && !useThinking && !aborted\) needsFcCheck = true;/);
});
