// 工作模式 · Agent 循环健壮性 契约测试
// 覆盖本次修复的三类用户可见缺陷：
//   ① run_code 连续调用「没返回结果」—— 多轮工具链内容必须下发前端
//   ② 「明明在使用工具，工具调用却变成了回复正文」—— 内部协议不得外泄
//   ③ 工作模式「跟没打开一样」—— 思考开启时也必须挂载工具集
// 目标：把这些修复固化成不可回退的契约，避免后续改动无意回退。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');

// 从 server.js 中截取 callDeepSeekViaResponses 函数体（大括号配平）
function extractResponsesFn() {
  const start = serverSrc.indexOf('async function callDeepSeekViaResponses(messages, options) {');
  assert.ok(start > -1, '未找到 callDeepSeekViaResponses');
  let i = serverSrc.indexOf('{', start);
  let depth = 0;
  for (; i < serverSrc.length; i++) {
    const c = serverSrc[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return serverSrc.slice(start, i + 1); }
  }
  throw new Error('函数体未配平');
}

const responsesFn = extractResponsesFn();

test('修复①：多轮工具链不得关闭流式（否则内容无法下发前端）', () => {
  // 旧缺陷写法：if (round > 0) useStream = false;
  // 注意：必须同时守护 Responses 路径与旧 chat/completions 路径，两处都曾踩坑。
  const activeCloseStream = /^\s*if\s*\(\s*round\s*>\s*0\s*\)\s*useStream\s*=\s*false/gm;
  const offenders = [];
  let m;
  while ((m = activeCloseStream.exec(serverSrc)) !== null) {
    // 排除注释行
    const lineStart = serverSrc.lastIndexOf('\n', m.index) + 1;
    const line = serverSrc.slice(lineStart, m.index + m[0].length);
    if (!/^\s*(\/\/|\*)/.test(line)) offenders.push(line.trim());
  }
  assert.deepEqual(
    offenders, [],
    '不得在第 2 轮起强制关闭流式：onContentChunk 只在流式分支推送，关流后用户看不到任何输出'
  );
});

test('修复①：非流式分支也必须回调 onContentChunk/onThinkingChunk', () => {
  // 非流式段落中必须出现内容回调，否则关流场景下前端空白
  const nonStreamIdx = responsesFn.indexOf('// ===== 非流式 =====');
  assert.ok(nonStreamIdx > -1, '未找到非流式分支');
  const seg = responsesFn.slice(nonStreamIdx, nonStreamIdx + 2600);
  assert.match(seg, /hasContentCb\s*&&\s*content\s*\)\s*options\.onContentChunk/, '非流式分支缺少 onContentChunk 回调');
  assert.match(seg, /hasThinkCb\s*&&\s*roundReasoning\s*\)\s*options\.onThinkingChunk/, '非流式分支缺少 onThinkingChunk 回调');
});

test('修复①：达到轮数上限时给出工具调用摘要而非裸报错', () => {
  assert.match(responsesFn, /toolRoundsNarration/, '未引入工具轮次叙述缓冲');
  assert.match(responsesFn, /toolRoundsNarration\.length/, '未在兜底逻辑中使用叙述缓冲');
  assert.match(responsesFn, /已经连续调用了/, '缺少轮数上限的可读兜底文案');
});

test('修复②：工具轮次叙述必须做内部协议过滤后才可下发', () => {
  assert.match(responsesFn, /looksLikeToolArgsFragment\(trNarration\)/, '工具轮叙述未做参数残留过滤');
  assert.match(responsesFn, /suppressed internal tool protocol from tool-round narration/, '缺少协议过滤日志');
});

test('修复②：最终回复必须做内部协议过滤', () => {
  assert.match(
    responsesFn,
    /finalReplyContainsInternalProtocolGlobal\(content\)\s*\|\|\s*looksLikeToolArgsFragment\(content\)/,
    '最终回复未做协议过滤'
  );
  assert.match(responsesFn, /suppressed internal tool protocol from final reply/, '缺少最终回复过滤日志');
});

test('修复②：模块级协议检测函数存在且可独立复用', () => {
  ['containsDsmlProtocolGlobal', 'looksLikeToolArgsFragment', 'finalReplyContainsInternalProtocolGlobal'].forEach((fn) => {
    assert.match(serverSrc, new RegExp('function ' + fn + '\\('), '缺少模块级函数: ' + fn);
  });
});

test('修复②：第三方自定义模型路径同样不得泄漏协议', () => {
  // 自定义模型路径曾逐片直推 content，导致 DSML 原文外泄
  assert.match(serverSrc, /suppressed internal tool protocol from tool-round narration/, '自定义路径缺少工具轮过滤');
  assert.match(serverSrc, /suppressed internal tool protocol from final reply/, '自定义路径缺少最终回复过滤');
});

test('修复③：工作模式下思考开启时也必须挂载工具集', () => {
  // 旧缺陷：var responsesTools = useThinking ? [] : (...)
  assert.doesNotMatch(
    serverSrc,
    /var responsesTools = useThinking \? \[\]/,
    '工作模式下不得因思考开启而清空工具集'
  );
  assert.match(
    serverSrc,
    /var responsesTools = \(useThinking && !workModeEnabled\)/,
    '工作模式应无视思考开关挂载工具集'
  );
});

test('修复③：Responses 请求体不得在思考模式下无条件丢弃 tools', () => {
  assert.match(serverSrc, /allowToolsWithThinking/, '缺少思考+工具共存的判定');
  assert.doesNotMatch(
    serverSrc,
    /if \(!useThinking\) apiBody\.tools = tools;/,
    '旧的「非思考才挂 tools」写法必须移除'
  );
});

test('修复③：思考+工具被上游拒绝时有降级重试兜底', () => {
  assert.match(serverSrc, /_isToolsThinkingConflict/, '缺少思考+工具冲突识别');
  assert.match(serverSrc, /tools\+thinking rejected by provider, retrying with reasoning disabled/, '缺少降级重试日志');
});

test('修复③：工作模式在非流式 /chat 路径同样生效', () => {
  // ★ 2026-09-13 行为变更：工作模式不再经 aiToolsFilteredForThirdParty
  //   （该路径曾按搜索配额裁剪工具可见性，导致"AI 说它只有几个工具"且用户
  //   无法从界面看出原因），改用专用的 aiToolsForWorkMode() —— 恒定全量工具，
  //   配额只在真正发起搜索时 gate。断言随之锁定该新契约。
  assert.match(
    serverSrc,
    /tools: workModeEnabled\s*\n?\s*\?\s*aiToolsForWorkMode\(\)/,
    '非流式路径未按工作模式挂载完整工具集'
  );
  assert.match(
    serverSrc,
    /function aiToolsForWorkMode\(\)\s*\{\s*return AI_TOOLS;/,
    '工作模式工具集应恒返回全量 AI_TOOLS'
  );
});

test('修复③：工具可见性不因第三方搜索配额被裁剪', () => {
  // 配额 gate 应发生在 executeToolCall 内部（搜索分支各自调 enforceSearchQuota），
  // 而不是在装配层把工具从模型视野里删掉。
  const fnIdx = serverSrc.indexOf('function aiToolsFilteredForThirdParty');
  assert.ok(fnIdx > -1, '应保留兼容别名函数');
  const seg = serverSrc.slice(fnIdx, fnIdx + 400);
  assert.match(seg, /return aiToolsForSearch\(true\)/,
    '兼容别名的语义应统一为"全量工具"，不得再按配额过滤');
  // 搜索分支内部仍必须有配额 gate（避免真的绕过计费）
  const swIdx = serverSrc.indexOf("case 'search_web': {");
  assert.ok(swIdx > -1, '应存在 search_web 分支');
  const swSeg = serverSrc.slice(swIdx, swIdx + 1500);
  assert.match(swSeg, /enforceSearchQuota/, 'search_web 内部必须做配额 gate');
});

test('体验：工具调用进度通过 tool_calls 事件下发（与既有协议一致）', () => {
  assert.match(serverSrc, /onToolCall: function\(list\)/, 'Responses 路径未透传工具调用进度');
  assert.match(serverSrc, /type: 'tool_calls', tools: tcs/, '未按既有 tool_calls 协议下发');
});

// 定位 Responses 路径的 tool_executor（其特征是内部调用 writeSse 下发事件；
// 另有旧 chat/completions 路径的 tool_executor 不做 SSE 下发，需要区分开）
function findResponsesToolExecutor() {
  let idx = -1;
  while ((idx = serverSrc.indexOf('tool_executor: async function(toolCall)', idx + 1)) > -1) {
    const seg = serverSrc.slice(idx, idx + 5000);
    if (seg.includes('writeSse')) return { start: idx, seg };
  }
  return null;
}

test('体验：工具结果含 cards 时下发 card 事件（A 档图表/文件可见）', () => {
  const te = findResponsesToolExecutor();
  assert.ok(te, '未找到 Responses 路径的 tool_executor');
  assert.match(te.seg, /type: 'card', card: card/, 'Responses 的 tool_executor 内未下发工具卡片');
  assert.match(te.seg, /type: 'tool_result'/, 'Responses 的 tool_executor 内未下发工具结果回执');
});

test('体验：工具结果回执携带成功/失败与计数', () => {
  const te = findResponsesToolExecutor();
  assert.ok(te, '未找到 Responses 路径的 tool_executor');
  const trIdx = te.seg.indexOf("type: 'tool_result'");
  assert.ok(trIdx > -1, '未找到 tool_result 下发');
  const trSeg = te.seg.slice(trIdx, trIdx + 800);
  assert.match(trSeg, /success:/, 'tool_result 缺少 success 字段');
  assert.match(trSeg, /count:/, 'tool_result 缺少 count 字段');
});

test('工作模式 prompt 覆盖 A 档可视化工具说明', () => {
  // 注：page_meta 与 extract_links 在 prompt 中合并为一条说明（"· page_meta / extract_links —— "），
  //     因此按「条目」而非「单个工具名」断言，避免把正常合并写法误判为缺失。
  const promptEntries = [
    'make_chart —— ', 'generate_pdf —— ', 'markdown_table —— ', 'qr_code —— ',
    'image_info / image_process —— ', 'read_zip —— ', 'diff_text —— ',
    'sort_filter —— ', 'batch_calc —— ', 'convert_data —— ', 'regex_test —— ',
    'url_parse —— ', 'page_meta / extract_links —— ', 'password_tool —— '
  ];
  promptEntries.forEach((entry) => {
    assert.match(serverSrc, new RegExp(entry.replace(/[/+]/g, '\$&')), '工作模式 prompt 缺少说明条目: ' + entry);
  });
  // 必须同时说明「不得用文字假装生成了图表或文件」的行为约束
  assert.match(serverSrc, /不要用文字假装生成了图表或文件/, '缺少防假装产出的行为约束');
});

// ── 模块级协议检测函数的行为验证（与实现同源抽取）──

function loadGlobalProtocolHelpers() {
  const s1 = serverSrc.indexOf('function containsDsmlProtocolGlobal(text) {');
  const e1 = serverSrc.indexOf('// Responses API 的 usage 字段名');
  assert.ok(s1 > -1 && e1 > s1, '未找到模块级协议检测函数区段');
  const code = serverSrc.slice(s1, e1);
  return new Function(code + '\nreturn { containsDsmlProtocolGlobal, looksLikeToolArgsFragment, finalReplyContainsInternalProtocolGlobal };')();
}

test('协议检测：识别 DSML 各种书写变体', () => {
  const { containsDsmlProtocolGlobal } = loadGlobalProtocolHelpers();
  assert.equal(containsDsmlProtocolGlobal('<|DSML|tool_calls>'), true, '标准写法未识别');
  assert.equal(containsDsmlProtocolGlobal('<| | DSML | |tool_calls>'), true, '空格变体未识别');
  assert.equal(containsDsmlProtocolGlobal('<｜DSML｜tool_calls>'), true, '全角竖线未识别');
  assert.equal(containsDsmlProtocolGlobal('这是一段正常的中文回答。'), false, '正常文本被误判');
});

test('协议检测：识别裸工具参数 JSON 残留', () => {
  const { looksLikeToolArgsFragment } = loadGlobalProtocolHelpers();
  assert.equal(looksLikeToolArgsFragment('{"query":"北京天气"}'), true, 'query 参数残留未识别');
  assert.equal(looksLikeToolArgsFragment('{"code":"return 1+1"}'), true, 'code 参数残留未识别');
  assert.equal(looksLikeToolArgsFragment('{"股票":"贵州茅台","涨幅":"3.2%"}'), false, '正常结果对象被误判');
  assert.equal(looksLikeToolArgsFragment('{'), false, '不完整 JSON 不应命中');
});

test('协议检测：最终回复检测不误伤正常 JSON 数据', () => {
  const { finalReplyContainsInternalProtocolGlobal } = loadGlobalProtocolHelpers();
  assert.equal(finalReplyContainsInternalProtocolGlobal('{"tool_calls":[],"function":{"name":"x"}}'), true, '工具调用 JSON 未识别');
  assert.equal(finalReplyContainsInternalProtocolGlobal('这是正常回答'), false, '正常文本被误判');
});
