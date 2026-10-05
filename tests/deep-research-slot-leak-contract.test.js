/**
 * 深度研究 / 深度思考并发名额泄漏契约测试（Request 9）
 *
 * 背景：用户反馈「深入研究页面有 bug，无法正常研究和回复」。
 *   现象：深度研究页发消息后卡片显示「连接中断 / 请等待上一个请求完成」，
 *        「查看思考过程（0 步）」，点「重试」永远撞同一堵墙，只有重启服务才恢复。
 *
 * 根因：handleDeepThinkChat 内并发名额 acquire 发生得**太早**——
 *   原顺序为 acquire → …约 60 行（trackActiveDeepThinkJob、若干函数定义）→ 注册
 *   req.on('aborted') / res.on('close')。若客户端在这段窗口内断开（或该段代码抛异常），
 *   名额已占用却没有任何监听器会调 releaseDeepResearch() → 名额永久泄漏。
 *   由于 DEEP_RESEARCH_MAX_PER_USER = 1，该用户此后所有深度研究/深度思考请求
 *   都会在闸门处被拒，且重试无效。
 *
 * 本测试锁定三项修复，防止回归：
 *   1. 「断开/关闭」监听必须在 tryAcquireDeepResearch 之前注册
 *   2. safeEnd() 必须兜底调用 releaseDeepResearch()（覆盖任何未预期的提前返回/抛错）
 *   3. releaseDeepResearch / safeEnd 必须幂等且对未 acquire 的情形安全
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverPath = path.join(__dirname, '..', 'render-api', 'server.js');
const source = fs.readFileSync(serverPath, 'utf8');

/**
 * 截取 handleDeepThinkChat 的主体。
 * 该函数很长（400+ 行），用下一个顶层 async function 作为结束边界。
 */
function deepThinkSource() {
  const start = source.indexOf('async function handleDeepThinkChat(req, res) {');
  assert.ok(start >= 0, '未找到 handleDeepThinkChat');
  const rest = source.slice(start + 1);
  // 下一个顶层声明（顶格的关键字）
  const m = rest.search(/\n(async function |function [a-zA-Z_$]|app\.(get|post|put|delete)\()/);
  return m >= 0 ? source.slice(start, start + 1 + m) : rest;
}

/**
 * 逐字符剥离 `//` 行注释（同时跳过字符串字面量内的 `//`）。
 * 说明性注释里常出现被引用的代码片段（例如「此前这些错误统一 return 'fallback'」），
 * 直接 indexOf 会把注释当成真实代码，造成假阳性/假阴性。
 */
function stripComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    // 处理字符串字面量：原样保留，避免把 'http://x' 里的 // 当注释
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        if (text[i] === '\\') { out += text[i] + (text[i + 1] || ''); i += 2; continue; }
        out += text[i];
        if (text[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

test('S9-1: 断开监听注册必须早于并发名额 acquire', () => {
  const code = stripComments(deepThinkSource());

  const abortIdx = code.indexOf("req.on('aborted', markDeepThinkDisconnected)");
  assert.ok(abortIdx >= 0, '必须注册 req.on(\'aborted\', markDeepThinkDisconnected)');

  const closeIdx = code.indexOf("res.on('close'");
  assert.ok(closeIdx >= 0, '必须注册 res.on(\'close\')');

  const acquireIdx = code.indexOf('tryAcquireDeepResearch(userName)');
  assert.ok(acquireIdx >= 0, '必须调用 tryAcquireDeepResearch(userName)');

  assert.ok(abortIdx < acquireIdx,
    `req.on('aborted') 必须在 acquire 之前注册（实际 ${abortIdx} vs ${acquireIdx}）；` +
    '否则 acquire 与注册之间的窗口内客户端断开会导致名额永久泄漏');
  assert.ok(closeIdx < acquireIdx,
    `res.on('close') 必须在 acquire 之前注册（实际 ${closeIdx} vs ${acquireIdx}）`);
});

test('S9-1: 断开监听只注册一次（不重复绑定导致重复释放/重复记账）', () => {
  const code = stripComments(deepThinkSource());
  const abortedRegs = code.match(/req\.on\('aborted',\s*markDeepThinkDisconnected\)/g) || [];
  const closeRegs = code.match(/res\.on\('close',/g) || [];
  assert.equal(abortedRegs.length, 1,
    `req.on('aborted') 应恰好注册 1 次，实际 ${abortedRegs.length} 次`);
  assert.equal(closeRegs.length, 1,
    `res.on('close') 应恰好注册 1 次，实际 ${closeRegs.length} 次`);
});

test('S9-2: safeEnd 必须兜底释放并发名额', () => {
  const code = stripComments(deepThinkSource());
  const start = code.indexOf('function safeEnd()');
  assert.ok(start >= 0, 'handleDeepThinkChat 内必须定义 safeEnd');
  const block = code.slice(start, start + 400);
  assert.match(block, /releaseDeepResearch\(\)/,
    'safeEnd 内必须调用 releaseDeepResearch()，覆盖任何未预期的提前 return / 抛错路径');
  // 释放必须在 end() 之前，避免 res.end() 触发 close 事件时名额尚未归还
  const relIdx = block.indexOf('releaseDeepResearch()');
  const endIdx = block.indexOf('res.end()');
  assert.ok(endIdx === -1 || relIdx < endIdx,
    'releaseDeepResearch() 必须先于 res.end() 调用');
});

test('S9-2: releaseDeepResearch 对「尚未 acquire」的情形安全', () => {
  const code = stripComments(deepThinkSource());
  const start = code.indexOf('function releaseDeepResearch()');
  assert.ok(start >= 0, 'handleDeepThinkChat 内必须定义 releaseDeepResearch');
  const block = code.slice(start, start + 400);
  // releaseDeep 在 acquire 前为 undefined，必须有真值守卫
  assert.match(block, /if \(releaseDeep\) releaseDeep\(\)/,
    'releaseDeepResearch 必须用 if (releaseDeep) 守卫，否则 acquire 前触发的断开会抛 TypeError');
});

test('S9-3: markDeepThinkDisconnected 必须对未初始化绑定安全并释放名额', () => {
  const code = stripComments(deepThinkSource());
  const start = code.indexOf('function markDeepThinkDisconnected()');
  assert.ok(start >= 0);
  const block = code.slice(start, start + 2200);
  assert.match(block, /releaseDeepResearch\(\)/,
    'markDeepThinkDisconnected 必须调用 releaseDeepResearch 归还名额');
  assert.match(block, /if \(aborted\) return;/,
    '必须用 aborted 标志保证断开处理只执行一次');
  // message 声明在函数体很靠后，提前注册监听后可能读到 hoisted undefined
  assert.match(block, /typeof message === 'string'/,
    '对 message 必须做 typeof 守卫，避免提前注册时的 ReferenceError/误记账');
});

test('S9-4: tryAcquireDeepResearch 的释放函数必须幂等', () => {
  const start = source.indexOf('function tryAcquireDeepResearch(userName) {');
  assert.ok(start >= 0, '未找到 tryAcquireDeepResearch');
  const block = source.slice(start, start + 800);
  assert.match(block, /var released = false;/);
  assert.match(block, /if \(released\) return;/,
    '释放函数必须幂等，否则 safeEnd 兜底释放与正常释放叠加会导致计数变负/误删他人名额');
  assert.match(block, /activeDeepResearchCount = Math\.max\(0, activeDeepResearchCount - 1\)/,
    '全局计数必须用 Math.max(0, ...) 兜底');
  // 归属校验：只删除自己那一格
  assert.match(block, /var next = \(activeDeepResearchByUser\.get\(userName\) \|\| 1\) - 1;/);
  assert.match(block, /if \(next <= 0\) activeDeepResearchByUser\.delete\(userName\);/);
});

test('S9-5: 研究流接口本身的名额管理顺序正确（回归哨兵）', () => {
  const start = source.indexOf("app.post('/api/agent/research/stream'");
  assert.ok(start >= 0, '未找到 /api/agent/research/stream');
  const rest = source.slice(start + 1);
  const m = rest.search(/\napp\.(get|post|put|delete)\(/);
  const block = stripComments(m >= 0 ? source.slice(start, start + 1 + m) : rest);

  const abortIdx = block.indexOf("req.on('aborted', markStreamDisconnected)");
  const acquireIdx = block.indexOf('researchRelease = tryAcquireDeepResearch(userName)');
  assert.ok(abortIdx >= 0 && acquireIdx >= 0, '两者都必须存在');
  assert.ok(abortIdx < acquireIdx,
    '研究流接口同样是「先注册监听、后 acquire」；若被改回相反顺序会引入同类泄漏');

  // safeEnd 必须释放
  const safeStart = block.indexOf('function safeEnd()');
  assert.ok(safeStart >= 0);
  const safeBlock = block.slice(safeStart, safeStart + 500);
  assert.match(safeBlock, /if \(researchRelease\) \{ try \{ researchRelease\(\); \} catch \(e\) \{\} researchRelease = null; \}/,
    'research/stream 的 safeEnd 必须释放并置空 researchRelease');
});

test('S9-6: 前端对 concurrent 不得回退到 deep think（否则必然二次撞墙）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');
  const start = src.indexOf('async function runTavilyResearchFlow(opts) {');
  assert.ok(start >= 0, '未找到 runTavilyResearchFlow');

  // 用 catch 块本身作为定位锚点，避免被函数内注释分隔线误导
  const catchIdx = src.indexOf("} catch (err) {", start);
  assert.ok(catchIdx > start, '未找到 runTavilyResearchFlow 的 catch 块');
  // ★ 必须剥注释：修复说明里本身就写着「此前这些错误统一 return 'fallback'」，
  //   直接 indexOf 会命中注释中的这段文字，造成"终结分支在 fallback 之后"的假阴性。
  const block = stripComments(src.slice(catchIdx, catchIdx + 4000));

  assert.match(block, /var isConcurrent = errCode === 'concurrent' \|\| \/上一个\(研究\)\?请求\|请等待上一个\/\.test\(errMsg\);/,
    '必须识别 concurrent 类错误');
  assert.match(block, /if \(isConcurrent \|\| isQuota\) \{/,
    'concurrent / 配额类错误必须走终结分支');
  // 终结分支必须在 `return 'fallback'` 之前
  const terminalIdx = block.indexOf('if (isConcurrent || isQuota) {');
  const fallbackIdx = block.indexOf("return 'fallback'");
  assert.ok(terminalIdx >= 0 && fallbackIdx >= 0);
  assert.ok(terminalIdx < fallbackIdx,
    'concurrent 终结分支必须早于 return \'fallback\'，否则会回退到同样被闸门拦住的 deep think');
  // 且必须早于 removeTavilyCard（回退路径会移除研究卡）
  const removeIdx = block.indexOf('removeTavilyCard()');
  assert.ok(removeIdx === -1 || terminalIdx < removeIdx,
    'concurrent 应在移除研究卡之前终结，让用户看到准确原因');
});

test('S9-7: 并发闸门常量符合设计（每用户 1、全局 5）', () => {
  assert.match(source, /DEEP_RESEARCH_MAX_GLOBAL = 5/);
  assert.match(source, /DEEP_RESEARCH_MAX_PER_USER = 1/);
  // 每用户上限为 1 是本次事故放大的关键：一旦泄漏，用户就彻底无法再发起
  const m = source.match(/DEEP_RESEARCH_MAX_PER_USER = (\d+)/);
  assert.equal(m[1], '1', '每用户上限为 1 时，泄漏即等于该用户永久不可用');
});
