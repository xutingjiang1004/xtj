'use strict';
// 2026-11-22 两份 Gemini 审计报告合并修复的契约固化测试。
// 覆盖：Markdown XSS（控制字符/协议白名单/DSML 前置剥离/相邻 on* 收敛）、
//       transport DOMException 数字码放行、errors 分类（SyntaxError/504/Timeout）、
//       ai-quota 补齐 tokens_unlimited/window_week_remaining、
//       游客无限免费额度逻辑保持（不被本轮修复破坏）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function loadAiCore(file) {
  const sandbox = { window: {}, console };
  sandbox.window.escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // markdown-renderer 的 decodeHtmlEntities 依赖 document.createElement('textarea')
  sandbox.document = {
    createElement() {
      const el = {
        // textarea.innerHTML=... 后 .value 给出解码后的文本（RCDATA）
        set innerHTML(v) {
          el._v = String(v).replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
            .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
            .replace(/&amp;/g, '&');
        },
        get innerHTML() { return el._v || ''; },
        get value() { return el._v || ''; },
        set value(v) { el._v = v; },
        get textContent() { return el._v || ''; },
        set textContent(v) { el._v = v; }
      };
      return el;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(read(file), sandbox, { filename: file });
  sandbox._Error = sandbox.Error; // 暴露沙箱内构造函数供 instanceof 断言
  return { core: sandbox.window.XtjAiCore, sandbox };
}

// ───────────────────────── Markdown XSS ─────────────────────────
test('Markdown.sanitize: javascript: 与协议相对 URL 被拦为 #', () => {
  const M = loadAiCore('js/ai-core/markdown-renderer.js').core.Markdown;
  assert.match(M.sanitize('<a href="javascript:alert(1)">x</a>'), /href="#"/);
  assert.match(M.sanitize('<a href="//evil.com/x">x</a>'), /href="#"/);
  assert.match(M.sanitize('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>'), /href="#"/);
});

test('Markdown.sanitize: C0/空白控制字符不能拆分出 javascript: 协议', () => {
  const M = loadAiCore('js/ai-core/markdown-renderer.js').core.Markdown;
  // 用制表/换行/控制字符拆分协议，剥离空白后仍应被识别并拦截
  const evil = '<a href="java\tscri\npt:alert(1)">x</a>';
  assert.doesNotMatch(M.sanitize(evil), /javascript:/i);
  assert.match(M.sanitize(evil), /href="#"/);
});

test('Markdown.sanitize: 相邻 on* 属性收敛，不留可用事件处理器', () => {
  const M = loadAiCore('js/ai-core/markdown-renderer.js').core.Markdown;
  const out = M.sanitize('<img src="x"style="width:1px"onerror=alert(1)>');
  assert.doesNotMatch(out, /onerror/i);
  assert.doesNotMatch(out, /onload/i);
});

test('Markdown.sanitize: DSML/tool_calls/reasoning 原文在前置阶段被剥离', () => {
  const M = loadAiCore('js/ai-core/markdown-renderer.js').core.Markdown;
  // 组A#1：sanitizeHtml 最前置剥离三类协议原文，防止拆分敏感标签绕过
  const dsml = M.sanitize('<|DSML|>invoke name="x"<|/DSML|>正文');
  assert.doesNotMatch(dsml, /DSML/i);
  assert.match(dsml, /正文/);
  const toolCalls = M.sanitize('{"tool_calls":[{"name":"x"}]}正文');
  assert.doesNotMatch(toolCalls, /tool_calls/i);
  const reasoning = M.sanitize('{"reasoning_content":"内部纠结"}正文');
  assert.doesNotMatch(reasoning, /reasoning_content/i);
});

test('Markdown.render 入口剥离 NUL/SOH 控制字符，不抛错', () => {
  const M = loadAiCore('js/ai-core/markdown-renderer.js').core.Markdown;
  const out = M.render('a\u0000\u0001b');
  assert.doesNotMatch(out, /[\u0000\u0001]/);
});

// ───────────────────────── transport / errors ─────────────────────────
test('transport: 原生 DOMException 数字码不被当作业务错误码放行', () => {
  const src = read('js/ai-core/transport.js');
  assert.match(src, /typeof err\.code === 'string' && err\.code/,
    '必须只对字符串型业务错误码放行，放行数字码会绕过 classifyError');
});

test('transport: SSE idle 超时派发 PROVIDER_TIMEOUT', () => {
  const src = read('js/ai-core/transport.js');
  assert.match(src, /idleTimeoutMs/);
  assert.match(src, /Errors\.CODES\.PROVIDER_TIMEOUT/);
  assert.match(src, /flushPendingEvent\(\)/, '断流前须刷新残帧');
});

test('errors: SyntaxError -> INTERNAL_ERROR，不误判登录失效', () => {
  const { core, sandbox } = loadAiCore('js/ai-core/errors.js');
  const E = core.Errors;
  // 用沙箱内的 SyntaxError 构造，保证 instanceof 判定与源码同一 realm
  const syntaxErr = vm.runInContext("new SyntaxError(\"Unexpected token '<'\")", sandbox);
  const c = E.classify(syntaxErr, {});
  assert.equal(c.code, 'INTERNAL_ERROR');
});

test('errors: 504 与 timeout AbortError -> PROVIDER_TIMEOUT', () => {
  const E = loadAiCore('js/ai-core/errors.js').core.Errors;
  assert.equal(E.classify(new Error('x'), { httpStatus: 504 }).code, 'PROVIDER_TIMEOUT');
  assert.equal(E.classify(new Error('timeout'), { name: 'AbortError' }).code, 'PROVIDER_TIMEOUT');
});

// ───────────────────────── ai-quota 字段补齐 ─────────────────────────
test('ai-quota normalizeQuotaPayload 输出 tokens_unlimited / window_week_remaining', () => {
  const src = read('render-api/ai-quota.js');
  // 三条返回路径都要有这两个字段（正常返回 + !raw 兜底对象）
  assert.match(src, /tokens_unlimited:\s*tokensUnlimited/);
  assert.match(src, /window_week_remaining:[\s\S]*tokensUnlimited \? -1/);
});

// ───────────────────────── 游客额度红线不被破坏 ─────────────────────────
test('游客无限免费逻辑保持：三个入口仍有窗口内放行/跳过', () => {
  const server = read('render-api/server.js');
  // 每处放行都以 isGuest && guestAiPublicWindowOpen() 为条件
  const hits = (server.match(/ctx && ctx\.isGuest && guestAiPublicWindowOpen\(\)/g) || []).length;
  assert.ok(hits >= 3, `游客放行入口应 >=3 处，实际 ${hits}`);
  assert.match(server, /return \{ allowed: true, reason: null, quota: null \}/);
  assert.match(server, /tokens_unlimited: true, tokens_remaining: -1/);
});
