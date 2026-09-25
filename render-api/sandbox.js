// ============================================================================
// sandbox.js —— 受限 JavaScript 执行沙箱（isolated-vm 强隔离，fail-closed）
// ============================================================================
//
// 设计目标
//   1. 真隔离：用 isolated-vm（V8 独立 Isolate）执行。isolated-vm 的
//      memoryLimit / timeout 是 V8 层面的硬限制，可靠且可强制中断。
//   2. fail-closed（★ 2026-09-26 深度审计 P0-1 修复）：isolated-vm 是原生
//      模块（预编译二进制），若加载失败（ABI 不匹配、二进制损坏、平台不支持）
//      或运行期抛出基础设施异常，**一律拒绝执行**，绝不再降级到 Node 内置
//      vm 模块。原因：vm 只能做"同进程同 Isolate"的伪隔离，注入的宿主内置
//      对象（Math/JSON/console/...）都带宿主原型链，沙箱内一句
//      `Math.constructor.constructor('return process')()` 即可拿到宿主
//      process / require('fs') / child_process，等同任意代码执行；且注入宿主
//      Promise 后，微任务可逃出 vm 的 timeout 窗口并永久占满事件循环。
//      （上述逃逸与超时绕过的 PoC 见 audit-reports/2026-09-26-全栈深度审计报告.md）
//      沙箱不可用时 run_code 工具会向用户返回明确错误，而不是在更弱的环境
//      里重跑用户代码；`sandboxInfo()` 会给出 enabled/disabledReason 供
//      /health 与启动日志暴露该状态。
//   3. 预装库里：注入一批纯计算 npm 库（lodash / mathjs / papaparse /
//      dayjs / decimal.js / fast-xml-parser），让 AI 写代码时无需重复造轮子。
//
// 安全边界
//   - 沙箱内不存在：process / require / global / globalThis / Buffer /
//     fetch / setTimeout / setInterval / eval / Function / WebAssembly
//   - 无网络、无文件系统、无子进程
//   - 内存上限 32MB，执行超时 3000ms（可被调用方覆盖）
//   - 输出上限 8000 字符，日志条数上限 200
//
// isolated-vm API 要点（实测确认，避免误用）
//   - 编译脚本只能用 isolate.compileScriptSync(src)，**不存在** new ivm.Script()
//   - 写全局用 context.global.setSync(key, value)
//   - 跨堆传对象用 new ivm.ExternalCopy(v).copyInto()
//   - 宿主回调用 new ivm.Reference(fn)，沙箱内 __cb.applySync(undefined, [args])
//
// ============================================================================

'use strict';

const fs = require('fs');
const path = require('path');
// ★ 2026-09-26（P0-1）：不再 require('vm')。vm 模块无法提供安全边界
//   （同进程同 Isolate + 宿主对象原型链逃逸 + 微任务绕过 timeout），
//   任何"降级到 vm"的路径都已删除，沙箱统一 fail-closed。

// ---------------------------------------------------------------------------
// isolated-vm 加载：失败即 fail-closed（不降级、不静默继续）
// ---------------------------------------------------------------------------
let ivm = null;
let ivmLoadError = null;
try {
  ivm = require('isolated-vm');
  // 轻量探针：确认模块真的可用（部分环境 require 成功但调用即崩）
  const probe = new ivm.Isolate({ memoryLimit: 8 });
  probe.dispose();
} catch (e) {
  ivm = null;
  ivmLoadError = (e && e.message) || String(e);
  console.error('[SANDBOX] isolated-vm 不可用，代码沙箱已按 fail-closed 策略禁用（不会降级到 vm）：' + ivmLoadError);
}

function sandboxUnavailableError() {
  var err = new Error('代码沙箱暂不可用（isolated-vm 未加载），已拒绝执行以保护服务安全');
  err.code = 'SANDBOX_UNAVAILABLE';
  err.sandboxUnavailable = true;
  return err;
}

// ---------------------------------------------------------------------------
// 预装库：全部为纯计算库，无 IO / 无网络 / 无子进程
// 每个库都做可选加载 —— 缺失时跳过，不影响其他库
// ---------------------------------------------------------------------------
function tryRequire(name) {
  try { return require(name); } catch (e) { return undefined; }
}

const SANDBOX_LIBS = {
  lodash: tryRequire('lodash'),
  mathjs: tryRequire('mathjs'),
  Papa: tryRequire('papaparse'),
  dayjs: tryRequire('dayjs'),
  Decimal: tryRequire('decimal.js'),
  fxp: tryRequire('fast-xml-parser'),
};

// 清理 undefined，得到实际可用的库清单
const AVAILABLE_LIBS = Object.keys(SANDBOX_LIBS)
  .filter(function (k) { return SANDBOX_LIBS[k] !== undefined && SANDBOX_LIBS[k] !== null; });

// 库名 → require 包名（仅用于入口定位失败的兜底尝试）
const LIB_PKG_NAME = {
  lodash: 'lodash',
  mathjs: 'mathjs',
  Papa: 'papaparse',
  dayjs: 'dayjs',
  Decimal: 'decimal.js',
  fxp: 'fast-xml-parser',
};

// 库名 → 自包含入口文件（相对项目根目录）
//
// ★ 关键：必须选"自包含"（无相对 require）的入口，否则在 isolated-vm 沙箱内
//   求值时会因无法解析 './xxx' 而失败。经实测，以下入口均为单文件自包含：
//     - lodash    : UMD 单文件
//     - mathjs    : 官方 browser UMD 构建（lib/cjs/index.js 是 0.4KB 的转发桶，
//                   依赖数百个相对模块，**不可用**）
//     - papaparse : UMD 单文件
//     - dayjs     : UMD 单文件
//     - decimal.js: UMD 单文件
//     - fast-xml-parser: 预打包 CJS 单文件（lib/fxp.cjs）
const LIB_ENTRY = {
  lodash: 'node_modules/lodash/lodash.js',
  mathjs: 'node_modules/mathjs/lib/browser/math.js',
  Papa: 'node_modules/papaparse/papaparse.js',
  dayjs: 'node_modules/dayjs/dayjs.min.js',
  Decimal: 'node_modules/decimal.js/decimal.js',
  fxp: 'node_modules/fast-xml-parser/lib/fxp.cjs',
};

/**
 * 返回沙箱实际可用的库名列表（用于注入 prompt 与诊断）
 */
function listSandboxLibs() {
  return AVAILABLE_LIBS.slice();
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MEMORY_MB = 32;
const MAX_CODE_LEN = 20000;
const MAX_OUTPUT_LEN = 8000;
const MAX_LOGS = 200;
// 库注入的编译超时（mathjs 体积较大，给足余量）
const LIB_BOOTSTRAP_TIMEOUT_MS = 20000;

// ---------------------------------------------------------------------------
// 结果序列化：把沙箱返回值安全地转成字符串（处理循环引用等）
// ---------------------------------------------------------------------------
function safeStringify(value) {
  if (value === undefined) return undefined;
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return String(value);
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, function (k, v) {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      if (typeof v === 'function') return '[Function]';
      if (typeof v === 'undefined') return undefined;
      return v;
    }, 2);
  } catch (e) {
    try { return String(value); } catch (e2) { return '[无法序列化的对象]'; }
  }
}

// ---------------------------------------------------------------------------
// 预装库源码读取（供 isolated-vm 沙箱内重新求值使用）
//
// 为什么要在沙箱内重新求值而不是直接传对象？
//   isolated-vm 的 Isolate 是独立 V8 堆。宿主对象必须通过 Reference 代理
//   才能进入沙箱，每次属性访问都要跨边界调用，且函数调用开销极大 —— 对
//   lodash/mathjs 这种高频调用库完全不现实。把源码在沙箱内求值，得到的是
//   沙箱原生对象，零跨边界开销。
// ---------------------------------------------------------------------------
const LIB_SOURCE_CACHE = Object.create(null);

function getLibSource(libKey) {
  if (LIB_SOURCE_CACHE[libKey] !== undefined) return LIB_SOURCE_CACHE[libKey];
  let src = null;
  const rel = LIB_ENTRY[libKey];
  if (rel) {
    try {
      src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    } catch (e) {
      src = null;
    }
  }
  if (!src) {
    // 兜底：尝试 require.resolve 定位入口（可能是自包含的单文件包）
    try {
      src = fs.readFileSync(require.resolve(LIB_PKG_NAME[libKey] || libKey), 'utf8');
    } catch (e) {
      src = null;
    }
  }
  LIB_SOURCE_CACHE[libKey] = src;
  return src;
}

/**
 * 生成沙箱内求值预装库的引导代码。
 *
 * 由于选用的入口均为自包含单文件（UMD / 预打包 CJS），沙箱内不需要真正的
 * 模块解析器，只需提供最小的 CommonJS 外壳即可：
 *
 *   var __libs = {};
 *   (function(){ var module = { exports: {} }; var exports = module.exports;
 *     (function(module, exports, require){ <库源码> })(module, exports, __stubRequire);
 *     __libs['lodash'] = module.exports; })();
 *   ...
 *   var lodash = __libs.lodash, _ = __libs.lodash, math = __libs.mathjs, ...;
 *
 * __stubRequire 仅在库内部有意外 require 时抛出明确错误，便于诊断。
 */
function buildIvmLibBootstrap(libKeys) {
  const chunks = [];
  chunks.push('"use strict";');
  chunks.push('var __libs = {};');
  chunks.push(
    'function __stubRequire(id){ throw new Error("沙箱内不支持外部模块: " + id); }'
  );
  let injected = 0;
  for (const key of libKeys) {
    const src = getLibSource(key);
    if (!src) continue;
    injected++;
    chunks.push(
      '(function(){' +
      '  var module = { exports: {} }; var exports = module.exports;' +
      '  (function(module, exports, require, global, globalThis, window, self, process, Buffer){' +
      '\n' + src + '\n' +
      '  })(module, exports, __stubRequire, undefined, undefined, undefined, undefined, undefined, undefined);' +
      '  __libs[' + JSON.stringify(key) + '] = module.exports;' +
      '})();'
    );
  }
  // 全局别名：让沙箱内可直接用 _ / lodash / math / mathjs / Papa / dayjs / Decimal / fxp
  const aliases = [];
  if (libKeys.indexOf('lodash') >= 0) { aliases.push('var lodash = __libs.lodash;'); aliases.push('var _ = __libs.lodash;'); }
  if (libKeys.indexOf('mathjs') >= 0) { aliases.push('var mathjs = __libs.mathjs;'); aliases.push('var math = __libs.mathjs;'); }
  if (libKeys.indexOf('Papa') >= 0) aliases.push('var Papa = __libs.Papa;');
  if (libKeys.indexOf('dayjs') >= 0) aliases.push('var dayjs = __libs.dayjs;');
  if (libKeys.indexOf('Decimal') >= 0) aliases.push('var Decimal = __libs.Decimal;');
  if (libKeys.indexOf('fxp') >= 0) aliases.push('var fxp = __libs.fxp;');
  chunks.push(aliases.join('\n'));
  chunks.push('void 0;');
  return { source: chunks.join('\n'), injected: injected };
}

// ---------------------------------------------------------------------------
// 实现 A：isolated-vm 强隔离执行（同步）
// ---------------------------------------------------------------------------
function runInIsolatedVm(code, input, opts) {
  const timeout = opts && opts.timeout ? opts.timeout : DEFAULT_TIMEOUT_MS;
  const memoryMb = opts && opts.memoryLimitMb ? opts.memoryLimitMb : DEFAULT_MEMORY_MB;

  const isolate = new ivm.Isolate({ memoryLimit: memoryMb });
  let context = null;
  let injectedLibs = 0;
  try {
    context = isolate.createContextSync();
    const guest = context.global;

    // ---- 1) console 采集：沙箱内 __hostLog.applySync 回传 ----
    const logBuffer = [];
    const logRef = new ivm.Reference(function (level, text) {
      if (logBuffer.length >= MAX_LOGS) return;
      const lv = String(level);
      logBuffer.push(lv === 'log' ? String(text) : '[' + lv + '] ' + String(text));
    });
    guest.setSync('__hostLog', logRef);

    const consoleBootstrap =
      'var console = (function(){' +
      '  function fmt(v){ try { return (typeof v === "object" && v !== null) ? JSON.stringify(v) : String(v); } catch(e){ return String(v); } }' +
      '  function send(level, args){ var parts=[]; for (var i=0;i<args.length;i++) parts.push(fmt(args[i])); __hostLog.applySync(undefined, [level, parts.join(" ")]); }' +
      '  return { log:function(){send("log",arguments);}, info:function(){send("info",arguments);},' +
      '           warn:function(){send("warn",arguments);}, error:function(){send("error",arguments);} };' +
      '})();';
    isolate.compileScriptSync(consoleBootstrap).runSync(context, { timeout: 2000 });

    // ---- 2) 注入预装库 ----
    const libKeys = AVAILABLE_LIBS.slice();
    if (libKeys.length) {
      try {
        const boot = buildIvmLibBootstrap(libKeys);
        isolate.compileScriptSync(boot.source).runSync(context, { timeout: LIB_BOOTSTRAP_TIMEOUT_MS });
        injectedLibs = boot.injected;
      } catch (e) {
        // 库注入失败不应阻断执行，只记录提示
        logBuffer.push('[warn] 预装库注入失败：' + ((e && e.message) || e));
      }
    }

    // ---- 3) 注入 input ----
    try {
      const copyable = (input === undefined || input === null) ? null : input;
      guest.setSync('input', new ivm.ExternalCopy(copyable).copyInto());
    } catch (e) {
      guest.setSync('input', null);
    }

    // ---- 4) 执行用户代码 ----
    // 用 IIFE 包裹，兼容用户在顶层写 return 的习惯
    const wrapped = '"use strict";\n(function(){\n' + code + '\n})();';
    const raw = isolate.compileScriptSync(wrapped).runSync(context, { timeout: timeout, copy: true });

    // ---- 5) 组装输出 ----
    const out = [];
    if (logBuffer.length) out.push(logBuffer.join('\n'));
    if (raw !== undefined && raw !== null) {
      const s = safeStringify(raw);
      if (s !== undefined) out.push((out.length ? '【返回值】\n' : '') + s);
    }

    if (!out.length) return '（代码执行完毕，无输出。请用 return 或 console.log 返回结果）';
    let text = out.join('\n');
    if (text.length > MAX_OUTPUT_LEN) text = text.slice(0, MAX_OUTPUT_LEN) + '\n...(输出过长已截断)';
    return text;
  } finally {
    try { isolate.dispose(); } catch (e) { /* 忽略 */ }
  }
}

// ---------------------------------------------------------------------------
// 实现 B（已删除）：vm 降级执行
//
// ★ 2026-09-26（审计 P0-1）：原 runInVmFallback() 已整体移除。
//   它把宿主内置对象（Math/JSON/console/Promise/Date/...）直接注入 vm 上下文，
//   沙箱内一句 `Math.constructor.constructor('return process')()` 即可拿到宿主
//   process，再经 process.mainModule.require('fs'|'child_process') 读写文件、
//   起子进程（本次审计已实测逃逸成功）；注入宿主 Promise 后微任务还能逃出
//   vm 的 timeout 窗口，把事件循环永久占满。vm 模块与宿主同进程同 Isolate，
//   本质上无法充当安全边界，因此不再保留任何形式。
//   若将来确实需要"无 isolated-vm 也能执行代码"，正确做法是 worker_threads
//   子进程 + 资源限额，而不是回到 vm。
// ---------------------------------------------------------------------------
// 统一入口：同步签名（保持与旧 runInSandbox 调用方兼容）
//
// 注意：isolated-vm 提供原生同步 API（compileScriptSync / runSync），因此
// 无需把调用方改成 async。这也是选同步 API 的原因 —— server.js 中
// executeToolCall 是同步函数，改成 async 会波及整条工具链。
//
// ★ 2026-09-26（审计 P0-1）：本函数不再有 try/catch 降级分支——isolated-vm
//   抛出的任何异常（用户代码错误、超时、内存超限、内部故障）都原样向上抛出，
//   由调用方按失败反馈给用户。绝不在"隔离更弱的环境"里重跑用户代码。
// ---------------------------------------------------------------------------
function runInSandbox(code, input, opts) {
  const src = String(code || '');
  if (!src.trim()) throw new Error('代码为空');
  if (src.length > MAX_CODE_LEN) throw new Error('代码过长（上限 ' + MAX_CODE_LEN + ' 字符）');

  if (!ivm) throw sandboxUnavailableError();

  return runInIsolatedVm(src, input, opts);
}


// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------
module.exports = {
  runInSandbox: runInSandbox,
  listSandboxLibs: listSandboxLibs,
  // 诊断信息（供 /health 或管理端展示）
  sandboxInfo: function () {
    return {
      // ★ 2026-09-26（审计 P0-1）：engine 只会是 'isolated-vm' 或 'disabled'，
      //   不再出现 'vm(fallback)'；enabled=false 表示 run_code 已被 fail-closed 禁用。
      engine: ivm ? 'isolated-vm' : 'disabled',
      enabled: !!ivm,
      disabledReason: ivm ? null : (ivmLoadError || 'isolated-vm unavailable'),
      loadError: ivmLoadError,
      libs: AVAILABLE_LIBS.slice(),
      memoryLimitMb: DEFAULT_MEMORY_MB,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxCodeLen: MAX_CODE_LEN
    };
  }
};
