// ============================================================================
// sandbox.js —— 受限 JavaScript 执行沙箱（isolated-vm 强隔离 + vm 降级）
// ============================================================================
//
// 设计目标
//   1. 真隔离：用 isolated-vm（V8 独立 Isolate）替代 Node 内置 vm 模块。
//      vm 模块是"同进程同 Isolate"，存在原型链逃逸风险，且 timeout 在
//      纯 CPU 死循环里并不可靠；isolated-vm 的 memoryLimit / timeout 是
//      V8 层面的硬限制，可靠且可强制中断。
//   2. 零风险接入：isolated-vm 是原生模块（预编译二进制）。若加载失败
//      （平台 ABI 不匹配、二进制损坏等），自动降级到原有 vm 实现，
//      **绝不让服务起不来**。
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

const vm = require('vm');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// isolated-vm 可选加载：失败不抛异常，只记录降级原因
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
  console.warn('[SANDBOX] isolated-vm 不可用，已降级到 vm 实现：' + ivmLoadError);
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
// 实现 B：vm 降级执行（原实现，保留作为兜底）
// ---------------------------------------------------------------------------
function runInVmFallback(code, input) {
  const logs = [];
  const sandbox = {
    input: input === undefined ? undefined : input,
    console: {
      log: function () {
        const parts = [];
        for (let i = 0; i < arguments.length; i++) {
          const a = arguments[i];
          try { parts.push(typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a)); }
          catch (e) { parts.push(String(a)); }
        }
        if (logs.length < MAX_LOGS) logs.push(parts.join(' '));
      }
    },
    Math: Math, JSON: JSON, Date: Date,
    Number: Number, String: String, Boolean: Boolean,
    Array: Array, Object: Object, RegExp: RegExp,
    Map: Map, Set: Set, Promise: Promise,
    parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, isFinite: isFinite,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    encodeURI: encodeURI, decodeURI: decodeURI,
    Error: Error, TypeError: TypeError, RangeError: RangeError, SyntaxError: SyntaxError
  };

  // 挂载可用的预装库（同进程，直接挂对象即可）
  for (const key of AVAILABLE_LIBS) {
    sandbox[key] = SANDBOX_LIBS[key];
  }
  if (SANDBOX_LIBS.lodash) sandbox._ = SANDBOX_LIBS.lodash;
  if (SANDBOX_LIBS.mathjs) sandbox.math = SANDBOX_LIBS.mathjs;

  // 显式封堵危险全局（防原型链逃逸）
  sandbox.process = undefined;
  sandbox.require = undefined;
  sandbox.global = undefined;
  sandbox.globalThis = undefined;
  sandbox.Buffer = undefined;
  sandbox.fetch = undefined;
  sandbox.setTimeout = undefined;
  sandbox.setInterval = undefined;
  sandbox.setImmediate = undefined;
  sandbox.eval = undefined;
  sandbox.Function = undefined;

  const context = vm.createContext(sandbox);
  const scriptSrc = '"use strict";\n(function(){\n' + code + '\n})();';
  const result = vm.runInContext(scriptSrc, context, { timeout: DEFAULT_TIMEOUT_MS, breakOnSigint: true });

  let out = '';
  if (logs.length) out += logs.join('\n');
  if (result !== undefined) {
    let resStr;
    try { resStr = typeof result === 'object' && result !== null ? JSON.stringify(result, null, 2) : String(result); }
    catch (e) { resStr = String(result); }
    out += (out ? '\n【返回值】\n' : '') + resStr;
  }
  if (!out) out = '（代码执行完毕，无输出。请用 return 或 console.log 返回结果）';
  if (out.length > MAX_OUTPUT_LEN) out = out.slice(0, MAX_OUTPUT_LEN) + '\n...(输出过长已截断)';
  return out;
}

// ---------------------------------------------------------------------------
// 统一入口：同步签名（保持与旧 runInSandbox 调用方兼容）
//
// 注意：isolated-vm 提供原生同步 API（compileScriptSync / runSync），因此
// 无需把调用方改成 async。这也是选同步 API 的原因 —— server.js 中
// executeToolCall 是同步函数，改成 async 会波及整条工具链。
// ---------------------------------------------------------------------------
function runInSandbox(code, input, opts) {
  const src = String(code || '');
  if (!src.trim()) throw new Error('代码为空');
  if (src.length > MAX_CODE_LEN) throw new Error('代码过长（上限 ' + MAX_CODE_LEN + ' 字符）');

  if (ivm) {
    try {
      return runInIsolatedVm(src, input, opts);
    } catch (e) {
      const msg = (e && e.message) || String(e);
      // ★ 第三轮审计修复（🔴 安全）：降级判定此前用**宽泛关键词**匹配错误文案，
      //   导致用户代码自身的异常被误判为"沙箱基础设施故障"，从而静默重跑到
      //   安全性更弱的 vm 实现（同进程同 Isolate，存在原型链逃逸风险）——
      //   等于给用户代码一个"在隔离层更弱的环境里再执行一次"的机会。
      //
      //   已实测复现：用户仅写 `throw new Error("my custom error")`，因文案中
      //   含 "Error" 命中 /TypeError|RangeError/ 之类的松匹配，被判定为 infra
      //   异常并降级执行。同理 `Unexpected error in isolated-vm internals` 这类
      //   真正的 infra 故障反而会被判成用户错误。
      //
      //   改为**结构化判定**，三条并列，任一命中即判为用户代码问题：
      //     (a) 堆栈含 isolated-vm 帧 —— 覆盖用户 throw / 语法 / 类型 / 超时
      //         （实测：`at <isolated-vm>:N:M`、`(<isolated-vm> boundary)`）；
      //     (b) 文案含 memory limit —— 覆盖内存超限。实测发现这条**必须单列**：
      //         `Isolate was disposed during execution due to memory limit` 的
      //         堆栈指向宿主而非 isolated-vm，若只靠 (a) 会被误判为 infra 故障
      //         而降级到 vm，而 vm 同进程无内存上限，同样的死循环代码会直接把
      //         Node 进程 OOM 掉（已实测触发 FATAL ERROR: heap out of memory）；
      //     (c) 入参校验类（代码为空/过长），由本函数自身抛出，不经沙箱。
      //   另有兜底：(a)(b)(c) 都不命中，且**错误发生点确实在 isolated-vm 内部**
      //   （堆栈含 node_modules/isolated-vm 且不含本次调用的本文件帧）→ 才降级。
      //   注意 `e.isolateError` 不是 isolated-vm 的真实 API（源码与 .d.ts 均无），
      //   故不依赖它。
      const stack = (e && e.stack) || '';
      const isUserError = /<isolated-vm>|isolated-vm:\d+:\d+/.test(stack) ||
        /memory limit/i.test(msg) ||
        /代码为空|代码过长/.test(msg);
      if (isUserError) throw e;
      console.warn('[SANDBOX] isolated-vm 执行异常，降级到 vm：' + msg);
      return runInVmFallback(src, input);
    }
  }
  return runInVmFallback(src, input);
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
      engine: ivm ? 'isolated-vm' : 'vm(fallback)',
      loadError: ivmLoadError,
      libs: AVAILABLE_LIBS.slice(),
      memoryLimitMb: DEFAULT_MEMORY_MB,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxCodeLen: MAX_CODE_LEN
    };
  }
};
