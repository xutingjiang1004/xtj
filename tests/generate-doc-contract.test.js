/**
 * 文档生成（generate_pdf / HTML 交付）与工具集装配契约测试
 *
 * 背景（2026-09-13 线上问题，用户反馈）：
 *   1) "我让他生成一个 PDF 或者生成一个其他的文件，它会卡壳无法正常使用"
 *      根因：generate_pdf 对含中文的内容**直接报错拒绝**
 *      （"PDF 生成仅支持英文/数字内容"）—— PDF 内置字体无 CJK 字形。
 *      模型拿到硬错误后无法自愈，用户侧表现为"卡壳"。
 *      修复：中文内容改由 HTML 文档交付（浏览器打开可"打印→另存为 PDF"），
 *      纯 ASCII 仍走真 PDF；两种路径都成功返回。
 *   2) "为什么其他的工具它都没有啊？它说只有 8-9 个工具"
 *      根因：场景提示里**硬编码了 9 个工具名**，与真实下发的 35+ 个工具不一致。
 *      修复：工具清单改为从 AI_TOOLS 动态生成。
 *
 * 本测试锁定以上两点，防止回归。
 */
'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var toolHelpers = require('../render-api/tool-helpers.js');

var passed = 0;
var failed = 0;
var failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    failures.push({ name: name, err: e });
    console.log('  ✗ ' + name + '\n      ' + (e && e.message));
  }
}

var ROOT = path.join(__dirname, '..');
var SERVER_SRC = fs.readFileSync(path.join(ROOT, 'render-api', 'server.js'), 'utf8');

console.log('\n文档生成与工具集装配契约\n');

// ══════════════════════════════════════════════════════════════════════════
// 一、HTML 文档交付（中文不再卡壳）
// ══════════════════════════════════════════════════════════════════════════

test('导出 buildHtmlBuffer', function() {
  assert.strictEqual(typeof toolHelpers.buildHtmlBuffer, 'function');
});

test('含中文的文档能正常生成（此前会直接报错）', function() {
  var buf = toolHelpers.buildHtmlBuffer('季度报告', [
    { type: 'h1', text: '一、总体情况' },
    { type: 'p', text: '本季度营收同比增长 23%，主要由华东区贡献。' },
    { type: 'ul', items: ['华东区 +38%', '华南区 +12%', '华北区 -4%'] },
    { type: 'table', headers: ['区域', '营收'], rows: [['华东', '1200 万'], ['华南', '860 万']] }
  ]);
  assert.ok(Buffer.isBuffer(buf), '应返回 Buffer');
  assert.ok(buf.length > 0, '不应为空');
  var html = buf.toString('utf8');
  assert.ok(html.indexOf('季度报告') >= 0, '应含标题');
  assert.ok(html.indexOf('华东区 +38%') >= 0, '应含列表项');
  assert.ok(html.indexOf('<table>') >= 0, '应含表格');
  assert.ok(html.indexOf('1200 万') >= 0, '应含表格数据');
});

test('输出是自包含 HTML（含 DOCTYPE / charset / 打印样式）', function() {
  var html = toolHelpers.buildHtmlBuffer('T', [{ type: 'p', text: 'x' }]).toString('utf8');
  assert.ok(/^<!DOCTYPE html>/i.test(html), '应以 DOCTYPE 开头');
  assert.ok(html.indexOf('charset="UTF-8"') >= 0, '应声明 UTF-8（中文不乱码的前提）');
  assert.ok(html.indexOf('@media print') >= 0, '应含打印样式（另存为 PDF 的排版基础）');
  assert.ok(html.indexOf('@page') >= 0, '应声明 A4 页面尺寸');
});

test('HTML 交付无需内嵌字体（走系统字体栈，任何环境不乱码）', function() {
  var html = toolHelpers.buildHtmlBuffer('T', [{ type: 'p', text: '中文测试' }]).toString('utf8');
  assert.ok(html.indexOf('PingFang SC') >= 0 || html.indexOf('Microsoft YaHei') >= 0,
    '应包含中文字体优先级栈');
  assert.strictEqual(html.indexOf('@font-face'), -1, '不应内嵌字体（避免体积与部署依赖）');
});

test('★ 关键：HTML 转义防止文档内容 XSS', function() {
  var html = toolHelpers.buildHtmlBuffer('标题', [
    { type: 'p', text: '<script>alert(1)</script>' },
    { type: 'p', text: '<img src=x onerror=alert(2)>' }
  ]).toString('utf8');
  var bodyIdx = html.indexOf('<body>');
  var body = html.slice(bodyIdx);
  // 关键断言：正文区不得出现「未转义的」危险标签起始符。
  // 注：转义后 onerror= 字样仍会作为纯文本存在（`&lt;img src=x onerror=...&gt;`），
  // 这在 HTML 里是文本而非属性，无害；判定标准应是"标签是否真的成立"。
  assert.strictEqual(body.indexOf('<script>'), -1, '正文不得出现可执行的 script 标签');
  assert.strictEqual(body.indexOf('<img '), -1, '正文不得出现可解析的 img 标签');
  assert.ok(body.indexOf('&lt;script&gt;') >= 0, '应输出转义实体');
  assert.ok(body.indexOf('&lt;img src=x') >= 0, 'img 标签应被整体转义为文本');
});

test('HTML 支持全部块类型（h1/h2/h3/ul/ol/table/hr/quote/code/p）', function() {
  var html = toolHelpers.buildHtmlBuffer('', [
    { type: 'h1', text: 'H1' }, { type: 'h2', text: 'H2' }, { type: 'h3', text: 'H3' },
    { type: 'ul', items: ['a'] }, { type: 'ol', items: ['b'] },
    { type: 'table', headers: ['h'], rows: [['v']] },
    { type: 'hr' }, { type: 'quote', text: 'q' }, { type: 'code', text: 'c' },
    { type: 'p', text: 'p' }
  ]).toString('utf8');
  ['<h2>', '<h3>', '<h4>', '<ul>', '<ol>', '<table>', '<hr>', '<blockquote>', '<pre>', '<p>'].forEach(function(tag) {
    assert.ok(html.indexOf(tag) >= 0, '应含 ' + tag);
  });
});

test('纯字符串块按段落处理（兼容简写）', function() {
  var html = toolHelpers.buildHtmlBuffer('', ['一句中文']).toString('utf8');
  assert.ok(html.indexOf('<p>一句中文</p>') >= 0);
});

test('空块数组不崩溃，输出占位内容', function() {
  var html = toolHelpers.buildHtmlBuffer('', []).toString('utf8');
  assert.ok(html.indexOf('空文档') >= 0);
});

test('段落内换行转 <br> 保留排版意图', function() {
  var html = toolHelpers.buildHtmlBuffer('', [{ type: 'p', text: '第一行\n第二行' }]).toString('utf8');
  assert.ok(html.indexOf('第一行<br>第二行') >= 0);
});

// ══════════════════════════════════════════════════════════════════════════
// 二、generate_pdf 不再对中文报错（静态源码契约）
// ══════════════════════════════════════════════════════════════════════════

test('★ 关键：server.js 不再存在"PDF 仅支持英文/数字"的硬拒绝分支', function() {
  // 说明：该文案在代码中以「注释形式」保留（用于说明历史根因），
  // 关键是不得再出现在**会执行的错误返回**里。
  var idx = SERVER_SRC.indexOf("case 'generate_pdf'");
  assert.ok(idx > 0, '应存在 generate_pdf 分支');
  var seg = SERVER_SRC.slice(idx, idx + 5000);
  assert.strictEqual(
    seg.indexOf("error: 'PDF 生成仅支持英文/数字内容"),
    -1,
    '硬拒绝的 error 返回必须已移除（它正是"卡壳"的根因）'
  );
  assert.strictEqual(
    seg.indexOf('写入会变成乱码）。'),
    -1,
    '不应再有以乱码为由拒绝中文的分支'
  );
});

test('generate_pdf 在含中文时改走 buildHtmlBuffer', function() {
  var idx = SERVER_SRC.indexOf("case 'generate_pdf'");
  assert.ok(idx > 0, '应存在 generate_pdf 分支');
  var seg = SERVER_SRC.slice(idx, idx + 5000);
  assert.ok(seg.indexOf('buildHtmlBuffer') >= 0, '应调用 buildHtmlBuffer');
  assert.ok(seg.indexOf('isPureAscii') >= 0, '应据 isPureAscii 分流');
});

test('generate_pdf 两种路径都返回成功卡片（不再抛硬错误）', function() {
  var idx = SERVER_SRC.indexOf("case 'generate_pdf'");
  var seg = SERVER_SRC.slice(idx, idx + 5000);
  assert.ok(seg.indexOf('aiSiteCard') >= 0, '应产出结果卡片');
  assert.ok(seg.indexOf('is_html_delivery') >= 0, '应标记 HTML 交付，供前端自适应文案');
});

test('generate_pdf 工具描述不再谎称"中文字体已内置"', function() {
  assert.strictEqual(
    SERVER_SRC.indexOf('中文字体已内置，可直接输出中文'),
    -1,
    '该描述与实现不符，是模型误用的诱因，必须移除'
  );
});

test('generate_pdf 工具描述明确告知两种输出格式', function() {
  var idx = SERVER_SRC.indexOf("name: 'generate_pdf'");
  assert.ok(idx > 0);
  var seg = SERVER_SRC.slice(idx, idx + 1200);
  assert.ok(seg.indexOf('HTML') >= 0, '应说明中文走 HTML');
  assert.ok(/失败|道歉/.test(seg), '应指示模型不要声称失败');
});

// ══════════════════════════════════════════════════════════════════════════
// 三、工具集装配与提示词一致性
// ══════════════════════════════════════════════════════════════════════════

test('★ 关键：prompt 中不再硬编码 9 项工具清单', function() {
  assert.strictEqual(
    SERVER_SRC.indexOf('search_web / tavily_search / read_web_page / get_weather / get_current_time / get_exchange_rate / get_stock_quote / calculate / convert_units'),
    -1,
    '硬编码清单是"AI 说只有 9 个工具"的直接来源，必须移除'
  );
});

test('prompt 工具清单由 AI_TOOLS 动态生成', function() {
  assert.ok(SERVER_SRC.indexOf('buildCatAiToolSummary') >= 0, '应存在动态生成函数');
  assert.ok(SERVER_SRC.indexOf('CAT_AI_TOOL_SUMMARY') >= 0, '应存在动态清单常量');
});

test('动态清单在 AI_TOOLS 定义之后求值（保证拿到完整名单）', function() {
  var toolsIdx = SERVER_SRC.indexOf('const AI_TOOLS = [');
  var summaryIdx = SERVER_SRC.indexOf('const CAT_AI_TOOL_SUMMARY =');
  var siteRegistryIdx = SERVER_SRC.indexOf('const AI_SITE_TOOL_REGISTRY =');
  assert.ok(toolsIdx > 0 && summaryIdx > toolsIdx, '清单常量应在 AI_TOOLS 之后');
  assert.ok(siteRegistryIdx > 0 && summaryIdx > siteRegistryIdx,
    '清单常量应在站内工具注册之后（否则漏掉 7 个 search_* 工具）');
});

test('AI_TOOLS 工具数量符合预期（35 基础 + 7 站内 = 42）', function() {
  var m = SERVER_SRC.match(/const AI_TOOLS = \[([\s\S]*?)\n\];/);
  assert.ok(m, '应能匹配 AI_TOOLS 定义');
  var base = (m[1].match(/name: '[a-z_0-9]+'/g) || []).length;
  assert.strictEqual(base, 35, 'AI_TOOLS 基础工具应为 35 个，实际 ' + base);

  var siteM = SERVER_SRC.match(/const AI_SITE_TOOL_REGISTRY = \{([\s\S]*?)\n\};/);
  assert.ok(siteM, '应能匹配站内工具注册表');
  var site = (siteM[1].match(/search_[a-z_]+:\s*\{/g) || []).length;
  assert.strictEqual(site, 7, '站内工具应为 7 个，实际 ' + site);
});

test('★ 关键：工作模式不再因配额裁剪工具可见性', function() {
  assert.ok(SERVER_SRC.indexOf('function aiToolsForWorkMode') >= 0,
    '应存在工作模式专用工具集函数');
  var idx = SERVER_SRC.indexOf('function aiToolsForWorkMode');
  var seg = SERVER_SRC.slice(idx, idx + 500);
  assert.ok(/return AI_TOOLS/.test(seg), '工作模式应恒返回全量工具');
});

test('移除无效的内置 web_search tool 声明（API 会忽略）', function() {
  var declCount = (SERVER_SRC.match(/var tools = \[\{ type: 'web_search' \}\]/g) || []).length;
  assert.strictEqual(declCount, 0,
    '不应再声明 { type: "web_search" }（DeepSeek Responses API 明确忽略该 tool type）');
});

// ══════════════════════════════════════════════════════════════════════════
// 四、reasoning 回传（"AI 调用失败 HTTP 400"根因）
// ══════════════════════════════════════════════════════════════════════════

test('★ 关键：Responses 路径收集并回传 reasoning 项', function() {
  assert.ok(SERVER_SRC.indexOf('roundReasoningItems') >= 0,
    '应存在 reasoning 项收集变量');
  assert.ok(SERVER_SRC.indexOf("type: 'reasoning'") >= 0,
    '应构造 reasoning 类型的 input item 回传');
});

test('reasoning 回填发生在工具轮 assistant 消息之后', function() {
  var assistantIdx = SERVER_SRC.indexOf('var assistantInput = { type: \'message\', role: \'assistant\'');
  var reasoningPushIdx = SERVER_SRC.indexOf('if (roundReasoningItems.length) {');
  assert.ok(assistantIdx > 0, '应存在 assistant 回填');
  assert.ok(reasoningPushIdx > assistantIdx,
    'reasoning 应在 assistant 消息之后回填（顺序需符合协议）');
});

// ══════════════════════════════════════════════════════════════════════════
// 五、前端搜索状态收敛（"已搜完仍显示正在搜索中"）
// ══════════════════════════════════════════════════════════════════════════

var AI_AGENT_SRC = fs.readFileSync(path.join(ROOT, 'js', 'ai-agent.js'), 'utf8');

test('★ 关键：前端存在 settleSearchStatus 状态收敛函数', function() {
  assert.ok(AI_AGENT_SRC.indexOf('function settleSearchStatus') >= 0,
    '应有统一的搜索状态收敛入口');
});

test('终态收口（clearAssistantTransientStatus）会收敛搜索状态', function() {
  var idx = AI_AGENT_SRC.indexOf('function clearAssistantTransientStatus');
  assert.ok(idx > 0);
  var seg = AI_AGENT_SRC.slice(idx, idx + 2000);
  assert.ok(seg.indexOf('settleSearchStatus') >= 0,
    '所有终态路径（done/error/中断）都应经此收敛');
});

test('search_status 事件区分运行态与完成态', function() {
  var idx = AI_AGENT_SRC.indexOf("evt.type === 'search_status'");
  assert.ok(idx > 0);
  var seg = AI_AGENT_SRC.slice(idx, idx + 1200);
  assert.ok(seg.indexOf('is-settled') >= 0, 'completed 应标记 is-settled（停动画）');
  assert.ok(seg.indexOf('is-running') >= 0, 'in_progress 应标记 is-running');
});

test('search 事件到达即标记完成态（不依赖 done）', function() {
  var idx = AI_AGENT_SRC.indexOf("if (evt.type === 'search') {");
  assert.ok(idx > 0);
  var seg = AI_AGENT_SRC.slice(idx, idx + 1200);
  assert.ok(seg.indexOf("classList.add('is-settled')") >= 0,
    '搜索结果到达即应停动画，避免"搜完了还在转"');
});

test('工具步骤残留 is-running 会在终态被清理', function() {
  var idx = AI_AGENT_SRC.indexOf('function clearAssistantTransientStatus');
  var seg = AI_AGENT_SRC.slice(idx, idx + 3000);
  assert.ok(seg.indexOf('.ai-tool-step.is-running') >= 0,
    '中断/超时导致工具步骤残留 running 时也应收敛');
});

// ══════════════════════════════════════════════════════════════════════════
// 六、动画舒缓化（"动画太吵"）
// ══════════════════════════════════════════════════════════════════════════

var UI_ENHANCE_SRC = fs.readFileSync(path.join(ROOT, 'css', 'ui-enhance.css'), 'utf8');
var AI_CSS_SRC = fs.readFileSync(path.join(ROOT, 'css', 'ai-agent.css'), 'utf8');

test('★ 关键：移除高频闪烁动画 xtjToolPulse', function() {
  assert.strictEqual(
    (UI_ENHANCE_SRC.match(/animation:\s*xtjToolPulse/g) || []).length, 0,
    'xtjToolPulse（1.15s 图标闪烁）太吵，必须移除'
  );
});

test('★ 关键：移除跑马灯动画 xtjToolBarRun', function() {
  assert.strictEqual(
    (UI_ENHANCE_SRC.match(/animation:\s*xtjToolBarRun/g) || []).length, 0,
    'xtjToolBarRun（.75s 跑马灯）太吵，必须移除'
  );
});

test('改用柔和呼吸光晕，且周期足够缓慢（>= 2s）', function() {
  assert.ok(UI_ENHANCE_SRC.indexOf('xtjToolGlow') >= 0, '应使用 xtjToolGlow');
  var m = UI_ENHANCE_SRC.match(/animation:\s*xtjToolGlow\s+([\d.]+)s/);
  assert.ok(m, '应能解析出 xtjToolGlow 周期');
  assert.ok(Number(m[1]) >= 2, '呼吸周期应 >= 2s（原 .75s 太快），实际 ' + m[1] + 's');
});

test('搜索状态呼吸动画周期 >= 2s', function() {
  var m = AI_CSS_SRC.match(/animation:\s*xtjSearchBreath\s+([\d.]+)s/);
  assert.ok(m, '应存在搜索状态呼吸动画');
  assert.ok(Number(m[1]) >= 2, '周期应 >= 2s，实际 ' + m[1] + 's');
});

test('进度卡 shimmer 已降速（>= 3s）且改为透明度变化', function() {
  var m = AI_CSS_SRC.match(/animation:\s*progress-shimmer\s+([\d.]+)s/);
  assert.ok(m, '应存在 progress-shimmer 动画');
  assert.ok(Number(m[1]) >= 3, '原 2.6s 太快，应 >= 3s，实际 ' + m[1] + 's');
  var kfIdx = AI_CSS_SRC.indexOf('@keyframes progress-shimmer');
  var kfSeg = AI_CSS_SRC.slice(kfIdx, kfIdx + 200);
  assert.strictEqual(kfSeg.indexOf('translateX'), -1,
    'shimmer 不应再有横扫位移（改为纯透明度变化，更安静）');
});

test('降级规则仍保留（prefers-reduced-motion / data-xtj-motion）', function() {
  assert.ok(UI_ENHANCE_SRC.indexOf('prefers-reduced-motion') >= 0, '应尊重系统减少动效偏好');
  assert.ok(UI_ENHANCE_SRC.indexOf('data-xtj-motion') >= 0, '应尊重站内动效开关');
  assert.ok(AI_CSS_SRC.indexOf('prefers-reduced-motion') >= 0, 'ai-agent.css 同样需覆盖');
  assert.ok(AI_CSS_SRC.indexOf('data-xtj-motion') >= 0, 'ai-agent.css 同样需覆盖');
});

test('禁改红线：不得触碰 dock 相关样式', function() {
  // 本次修复只涉及工具步骤/搜索状态/进度卡动画，不应出现 dock 相关选择器
  assert.strictEqual(
    (UI_ENHANCE_SRC.match(/dock-capsule|dock-bar/g) || []).length, 0,
    '本次改动不得涉及 dock bar / dock capsule'
  );
});

console.log('\n────────────────────────────');
console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
if (failed) {
  failures.forEach(function(f) { console.log('  FAILED: ' + f.name); });
  process.exitCode = 1;
}
