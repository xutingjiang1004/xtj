// 工作模式 · 代码沙箱与新增工具 契约测试
// 覆盖：run_code 沙箱隔离性、process_json、encode_decode、date_calc、text_stats
// 目标：确保沙箱不可逃逸（无 process/require/global/Buffer/fetch），且有超时保护。
//
// ★ 2026-09-14 架构调整：
//   沙箱实现已从 server.js 迁移到 render-api/sandbox.js（isolated-vm 强隔离 +
//   vm 降级）。本测试改为直接消费 sandbox 模块的公开接口，不再从 server.js
//   抽取函数体 —— 这样测试与实现的耦合点从"源码文本"变为"行为契约"，更稳定。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
const sandbox = require(path.join(__dirname, '..', 'render-api', 'sandbox.js'));

// 沙箱执行入口（与生产代码同源）
function runInSandbox(code, input) {
  return sandbox.runInSandbox(code, input);
}

test('工具定义：AI_TOOLS 含 run_code / process_json / encode_decode / date_calc / text_stats', () => {
  ['run_code', 'process_json', 'encode_decode', 'date_calc', 'text_stats'].forEach((n) => {
    assert.match(serverSrc, new RegExp("name: '" + n + "'"), '缺少工具定义: ' + n);
    assert.match(serverSrc, new RegExp("case '" + n + "'"), '缺少执行分支: ' + n);
  });
});

test('沙箱：正常数据计算可用', () => {
  const r1 = runInSandbox('var a=[3,1,2,5,4]; a.sort(function(x,y){return x-y}); return a[Math.floor(a.length/2)];');
  assert.equal(String(r1).trim(), '3');
  const r2 = runInSandbox('return {sum: [1,2,3].reduce(function(a,b){return a+b},0)};');
  assert.match(r2, /"sum": 6/);
  const r3 = runInSandbox('return input.x * 2;', { x: 21 });
  assert.equal(String(r3).trim(), '42');
});

test('沙箱：console.log 输出被采集', () => {
  const r = runInSandbox('console.log("hello", 1+1);');
  assert.match(r, /hello 2/);
});

test('沙箱：禁止逃逸到 process / require / global / Buffer / fetch', () => {
  // 说明：isolated-vm 是独立 V8 堆，globalThis 作为语言内置对象始终存在，
  // 因此不断言 "typeof globalThis === undefined"（那在真隔离里不可能成立）。
  // 真正要保证的是：这些宿主能力**不可达**（包括经 globalThis 绕道）。
  const probes = ['process', 'require', 'global', 'Buffer', 'fetch', 'module'];
  probes.forEach((p) => {
    const r = runInSandbox('return typeof ' + p + ';');
    assert.equal(String(r).trim(), 'undefined', p + ' 必须不可用，实际: ' + r);
  });
  // globalThis 本身存在，但不得暴露任何宿主能力
  ['process', 'require', 'module'].forEach((p) => {
    const r = runInSandbox('return typeof globalThis.' + p + ';');
    assert.equal(String(r).trim(), 'undefined', 'globalThis.' + p + ' 必须不可用，实际: ' + r);
  });
});

test('沙箱：Function 构造器无法用于逃逸', () => {
  // 说明：isolated-vm 下 new Function 是合法的 JS 语言能力（可用于动态计算），
  // 必须保留；要封堵的是"用它去拿宿主能力"。旧 vm 沙箱靠整体封杀 Function
  // 来防御，属于语言级阉割；新沙箱靠堆隔离，防御更彻底且不牺牲可用性。
  const escapes = [
    'new Function("return process")()',
    'new Function("return require")()',
    '(function(){}).constructor("return process")()',
    '(function(){}).constructor("return this.process")()',
  ];
  escapes.forEach((expr, i) => {
    const r = String(runInSandbox('try { return typeof (' + expr + '); } catch(e) { return "blocked"; }')).trim();
    // 防御成功有两种表现：
    //   - "blocked"      ：直接抛错（process 未定义）
    //   - "undefined"    ：拿到了值但类型是 undefined（未触达宿主能力）
    // 只要不是 function/object，就说明没能拿到真实的宿主对象。
    assert.ok(
      r === 'blocked' || r === 'undefined',
      '逃逸手法 #' + (i + 1) + ' 可能触达宿主能力，实际返回类型: ' + r
    );
  });
  // 正常计算能力应保留
  const ok = runInSandbox('return new Function("a","b","return a+b")(1,2);');
  assert.equal(String(ok).trim(), '3', 'Function 的合法计算能力被误伤');
});

test('沙箱：原型链逃逸被封堵（constructor.constructor 取 process）', () => {
  const r = runInSandbox(
    'try { return typeof (function(){}).constructor("return process")(); } catch(e) { return "blocked"; }'
  );
  assert.ok(/blocked/.test(r), '原型链逃逸未被封堵，实际: ' + r);
});

test('沙箱：死循环被超时中断', () => {
  assert.throws(() => runInSandbox('while(true){}'), /timed out|timeout/i, '死循环未被超时中断');
});

test('沙箱：超长代码被拒绝', () => {
  const longCode = 'var a=1;'.repeat(4000);
  assert.throws(() => runInSandbox(longCode), /过长/, '超长代码未被拒绝');
});

test('沙箱：server.js 已委派到 sandbox 模块且保留安全说明', () => {
  // server.js 不再自带实现，改为委派
  assert.match(serverSrc, /require\('\.\/sandbox'\)/, '未引入 sandbox 模块');
  assert.match(serverSrc, /sandboxModule\.runInSandbox/, 'runInSandbox 未委派');
  // 安全设计说明必须保留（便于后续维护者理解边界）
  assert.match(serverSrc, /代码沙箱/);
  assert.match(serverSrc, /20000/);
  // 旧的内联 vm 沙箱实现应已移除
  assert.ok(!/vm\.createContext\(sandbox\)/.test(serverSrc), '旧的 vm 沙箱实现未清理');
});

test('沙箱：实现内部保留关键安全护栏', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'sandbox.js'), 'utf8');
  assert.match(src, /memoryLimit/, '缺少内存上限');
  assert.match(src, /MAX_CODE_LEN\s*=\s*20000/, '缺少代码长度上限');
  // isolated-vm 路径：硬超时
  assert.match(src, /timeout:\s*timeout/, '缺少硬超时');
  // 降级路径：显式封堵危险全局
  assert.match(src, /sandbox\.process = undefined/);
  assert.match(src, /sandbox\.require = undefined/);
  assert.match(src, /sandbox\.Function = undefined/);
  // 降级必须存在，保证服务不会因 ivm 加载失败而起不来
  assert.match(src, /function runInVmFallback/);
});

test('工作模式：system prompt 注入含工作模式指令与沙箱提示', () => {
  assert.match(serverSrc, /【工作模式】/);
  assert.match(serverSrc, /run_code（在强隔离沙箱里跑 JavaScript/);
  // 两条聊天路径均应注入
  const cnt = (serverSrc.match(/【工作模式】/g) || []).length;
  assert.ok(cnt >= 2, '工作模式 prompt 应注入到两条聊天路径，实际: ' + cnt);
});

test('工具定义：AI_TOOLS 含 read_document / make_file / web_extract / task_plan', () => {
  ['read_document', 'make_file', 'web_extract', 'task_plan'].forEach((n) => {
    assert.match(serverSrc, new RegExp("name: '" + n + "'"), '缺少工具定义: ' + n);
    assert.match(serverSrc, new RegExp("case '" + n + "'"), '缺少执行分支: ' + n);
  });
});

test('工作模式：prompt 明确提示文档/文件/网页/计划四类新工具', () => {
  assert.match(serverSrc, /read_document（支持 PDF \/ Word \/ Excel \/ CSV \/ TXT/);
  assert.match(serverSrc, /make_file（生成 CSV \/ Excel \/ TXT/);
  assert.match(serverSrc, /web_extract 能抓网页正文/);
  assert.match(serverSrc, /task_plan 列出计划/);
});

test('前端：工具中文名映射覆盖新增工具', () => {
  const jsSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');
  ['read_document', 'make_file', 'web_extract', 'task_plan', 'run_code', 'search_social'].forEach((n) => {
    const cnt = (jsSrc.match(new RegExp(n + ": '", 'g')) || []).length;
    assert.ok(cnt >= 2, '工具 ' + n + ' 应在两处 nameMap 中都有中文名，实际: ' + cnt);
  });
});

test('前端：make_file / task_plan 卡片有渲染分支', () => {
  const jsSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');
  assert.match(jsSrc, /type === 'make_file'/);
  assert.match(jsSrc, /type === 'task_plan'/);
});

test('工作模式：工具轮数提升到 8 且保留硬上限', () => {
  assert.match(serverSrc, /max_tool_rounds: workModeEnabled \? 8 : 4/);
  assert.match(serverSrc, /Math\.min\(Math\.max\(parseInt\(options && options\.max_tool_rounds\) \|\| 4, 1\), 8\)/);
});

test('工作模式：绕过关键词意图预判', () => {
  // ★ 2026-09-21：去掉 !useThinking 限制——工作模式 + 思考也不允许"零工具裸跑"，
  //   否则模型只能在正文里输出 DSML 协议文本假装调用（截图实证的 P0）。
  assert.match(serverSrc, /if \(workModeEnabled && !aborted\) needsFcCheck = true;/);
});
