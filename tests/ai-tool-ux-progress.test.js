/**
 * 回归守卫：Tool UX 与深度研究可观测性（2026-09-11）
 *
 * 覆盖三处产品级报障，均属"行为契约"而非实现细节，因此适合用源码断言长期钉住：
 *
 *   1) 调用工具时页面不跟随滚动  —— tool_calls / tool_pending / tool_result /
 *      tool_error / card 五类事件渲染后必须触发一次跟随滚动；
 *   2) 深度研究被误判"连接中断" —— 前端 idle 阈值必须显著大于旧值 45s，
 *      且 concurrent / 配额类错误不得回退到 deep think（共用同一并发闸门）；
 *   3) get_weather 反复报"未找到该地点" —— 地名候选生成必须支持
 *      行政后缀剥离、省名前缀剥离与国家前缀剥离。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const aiAgent = read('js/ai-agent.js');
const weather = read('render-api/weather.js');
const server = read('render-api/server.js');
const sseWrite = read('render-api/sse-write.js');

// ── 1. 工具事件必须跟随滚动 ────────────────────────────────────────────
test('tool progress events trigger follow-scroll', function () {
  assert.ok(aiAgent.indexOf('function followToolProgress') >= 0,
    'followToolProgress helper 缺失：工具事件将再次失去滚动跟随');

  // 五类工具事件分支内都必须调用 followToolProgress。
  // 通过定位各事件分支起点，截取到下一个 evt.type 分界或固定长窗口后查找调用。
  // 注意：tool_result 分支可达 5K+ 字符（含结果列表构建），窗口不能取太小。
  ['tool_calls', 'tool_pending', 'tool_result', 'tool_error'].forEach(function (evt) {
    var idx = aiAgent.indexOf("evt.type === '" + evt + "'");
    assert.ok(idx > 0, '未找到事件分支: ' + evt);
    // 优先用下一个分支起点界定边界；找不到时退回 8000 字符窗口
    var next = aiAgent.indexOf("if (evt.type === '", idx + 10);
    var block = next > idx ? aiAgent.slice(idx, next) : aiAgent.slice(idx, idx + 8000);
    assert.ok(block.indexOf('followToolProgress(messagesEl') >= 0,
      evt + ' 分支缺少 followToolProgress 调用，工具进展不会自动滚动');
  });

  // card 分支同样需要跟随
  var cardIdx = aiAgent.indexOf("evt.type === 'card'");
  assert.ok(cardIdx > 0);
  var cardNext = aiAgent.indexOf("if (evt.type === '", cardIdx + 10);
  var cardBlock = cardNext > cardIdx ? aiAgent.slice(cardIdx, cardNext) : aiAgent.slice(cardIdx, cardIdx + 3000);
  assert.ok(cardBlock.indexOf('followToolProgress(messagesEl') >= 0,
    'card 分支缺少 followToolProgress 调用');
});

test('follow-scroll distinguishes user scroll-up from layout growth', function () {
  // 必须有"用户主动上翻"状态，否则容器变高触发的 scroll 会被误判为用户意图，
  // 导致工具进展永远停止跟随。
  assert.ok(aiAgent.indexOf('_aiUserPinnedUp') >= 0, '_aiUserPinnedUp 状态缺失');
  assert.ok(aiAgent.indexOf('_aiAwayFromBottomCount') >= 0, '_aiAwayFromBottomCount 计数缺失');
});

// ── 2. 深度研究可观测性 ────────────────────────────────────────────────
test('research idle timeout is raised well above the legacy 45s', function () {
  assert.ok(aiAgent.indexOf('RESEARCH_IDLE_TIMEOUT_MS') >= 0,
    'RESEARCH_IDLE_TIMEOUT_MS 常量缺失');
  var m = aiAgent.match(/var RESEARCH_IDLE_TIMEOUT_MS\s*=\s*(\d+)/);
  assert.ok(m, '无法解析 RESEARCH_IDLE_TIMEOUT_MS 赋值');
  var ms = Number(m[1]);
  assert.ok(ms >= 120000,
    '研究 idle 阈值 ' + ms + 'ms 过短：Synthesizer 的 high 思考期会造成误判超时');
  // 45s 硬编码文案必须已被常量替换
  assert.ok(aiAgent.indexOf('研究超时（45 秒未收到数据）') < 0,
    '仍有硬编码 45 秒超时文案残留');
});

test('concurrent and quota errors must not fall back to deep think', function () {
  // 两类错误的判定必须存在
  assert.ok(aiAgent.indexOf('isConcurrent') >= 0, 'isConcurrent 判定缺失');
  assert.ok(aiAgent.indexOf('isQuota') >= 0, 'isQuota 判定缺失');
  // 必须是"先判定 terminal 再 fallback"的顺序
  var terminalIdx = aiAgent.indexOf('if (isConcurrent || isQuota)');
  var fallbackIdx = aiAgent.indexOf("console.warn('[AI] Tavily research 失败，回退到深度思考流程:'");
  assert.ok(terminalIdx > 0, '缺少 concurrent/quota 终结分支');
  assert.ok(fallbackIdx > terminalIdx,
    '回退分支必须位于终端错误判定之后，否则 concurrent 仍会回退并二次撞闸门');
});

test('research error event prefers human-readable message over code', function () {
  // 后端并发分支发 { error:'concurrent', code:'concurrent', message:'请等待...' }，
  // 前端若用 evt.error 作文案，用户会直接看到英文码。
  var m = aiAgent.match(/var ee = new Error\(([^)]*)\)/);
  assert.ok(m, '未找到研究 error 事件构造');
  assert.ok(/evt\.message\s*\|\|\s*evt\.error/.test(m[1]),
    'error 事件文案应优先取 message（可读），当前为: ' + m[1]);
});

test('research stream sets X-Accel-Buffering and flushes SSE frames', function () {
  var idx = server.indexOf("app.post('/api/agent/research/stream'");
  assert.ok(idx > 0, '未找到研究流路由');
  var head = server.slice(idx, idx + 1200);
  assert.ok(head.indexOf("X-Accel-Buffering") >= 0,
    '研究流缺少 X-Accel-Buffering: no，代理会缓冲导致进度帧延迟下发');
  assert.ok(head.indexOf('flushHeaders') >= 0, '研究流缺少 flushHeaders');

  // writeSse 必须主动 flush 当前帧
  assert.ok(sseWrite.indexOf('res.flush') >= 0,
    'writeSse 未调用 res.flush()，SSE 首帧可能被 socket/代理缓冲压住');
});

// ── 3. get_weather 地名健壮性 ──────────────────────────────────────────
test('weather geo candidates strip administrative suffixes', function () {
  assert.ok(weather.indexOf('function buildGeoQueryCandidates') >= 0,
    'buildGeoQueryCandidates 缺失');
  var w = require(path.join(ROOT, 'render-api', 'weather.js'));
  var c = w.buildGeoQueryCandidates('成都市武侯区');
  assert.ok(c.indexOf('成都') >= 0, '「成都市武侯区」应能剥离出「成都」，实际: ' + JSON.stringify(c));
});

test('weather geo candidates strip country and province prefixes', function () {
  var w = require(path.join(ROOT, 'render-api', 'weather.js'));
  assert.ok(w.buildGeoQueryCandidates('中国成都').indexOf('成都') >= 0,
    '应剥离「中国」前缀');
  // 省名前缀剥离：「四川成都武侯区」→ 含「成都」
  var c = w.buildGeoQueryCandidates('四川成都武侯区');
  assert.ok(c.some(function (x) { return x.indexOf('成都') >= 0; }),
    '应剥离省名前缀得到含「成都」的候选，实际: ' + JSON.stringify(c));
});

test('weather builtin city table is substantially expanded', function () {
  var w = require(path.join(ROOT, 'render-api', 'weather.js'));
  var cityCount = Object.keys(w.CITY_COORDS).length;
  var aliasCount = Object.keys(w.CITY_ALIASES).length;
  assert.ok(cityCount >= 80,
    '内置城市表仅 ' + cityCount + ' 条，过少会让远程 geocoding 承担过多失败风险');
  assert.ok(aliasCount >= 80,
    '英文/拼音别名仅 ' + aliasCount + ' 条，模型输出的英文城市名易解析失败');
});

test('weather distinguishes city-not-found from upstream failure', function () {
  // 服务故障不得再提示用户"换更具体的城市名"（会诱导无效重试）
  assert.ok(weather.indexOf("reason = 'city_not_found'") >= 0,
    'queryWeatherData 未标记 city_not_found');
  assert.ok(weather.indexOf("reason = 'upstream_failed'") >= 0,
    'queryWeatherData 未标记 upstream_failed');
  assert.ok(server.indexOf("e.reason === 'city_not_found'") >= 0,
    'server.js 未按 reason 区分提示文案');
  assert.ok(server.indexOf('无需更换城市名') >= 0,
    '服务故障时应明确告知"无需更换城市名"');
});

// ── 4. 模型升级（V4.1 Flash）────────────────────────────────────────────
test('deepseek flash model is migrated to the canonical V4.1 id', function () {
  var registry = read('render-api/provider-registry.js');
  assert.ok(registry.indexOf("'deepseek-flash'") >= 0,
    'provider-registry 未包含新模型 ID deepseek-flash');
  assert.ok(server.indexOf("const DEEPSEEK_MODEL_FLASH = 'deepseek-flash'") >= 0,
    'server.js 未切换到 deepseek-flash');
  assert.ok(aiAgent.indexOf("var DEFAULT_AI_MODEL = 'deepseek-flash'") >= 0,
    '前端默认模型未升级');
  // 显示名更换
  assert.ok(aiAgent.indexOf("'V4.1 Flash'") >= 0, '前端未显示 V4.1 Flash 名称');
});

test('legacy model ids are migrated rather than silently rejected', function () {
  // 存量 localStorage / 服务端配置里的旧 ID 必须被收敛，否则老用户会被踢回默认值
  assert.ok(aiAgent.indexOf('function normalizeAiModelId') >= 0,
    '前端缺少旧模型 ID 归一化函数');
  assert.ok(aiAgent.indexOf('LEGACY_AI_MODEL_ALIASES') >= 0,
    '前端缺少旧模型别名表');
  assert.ok(server.indexOf('DEEPSEEK_LEGACY_MODEL_ALIASES') >= 0,
    '后端缺少旧模型别名表');
  // 后端白名单必须走归一化，而不是与原值直接比较
  assert.ok(server.indexOf('var normalizedRequestedModel = normalizeDeepSeekModelName(requestedModel)') >= 0,
    '后端白名单未先归一化，存量旧 ID 会被判定非法');
});

// ── 5. 工具 UI 动画 ────────────────────────────────────────────────────
test('tool UI animations exist and respect motion preferences', function () {
  var css = read('css/ui-enhance.css');
  assert.ok(css.indexOf('@keyframes xtjToolStepIn') >= 0, '缺少步骤进入动画');
  // ★ 2026-09-13 行为变更：用户反馈动画"太吵"（图标 1.15s 高频闪烁 + 左侧 .75s
  //   跑马灯，同屏多处高频动效）。已移除 xtjToolPulse / xtjToolBarRun，
  //   改用单一 2.4s 柔和呼吸光晕 xtjToolGlow。断言随之更新为锁定"舒缓"契约。
  assert.ok(css.indexOf('@keyframes xtjToolGlow') >= 0, '缺少运行态呼吸光晕动画');
  assert.strictEqual(css.indexOf('@keyframes xtjToolPulse'), -1,
    'xtjToolPulse（高频闪烁）应已移除');
  assert.strictEqual(css.indexOf('@keyframes xtjToolBarRun'), -1,
    'xtjToolBarRun（跑马灯）应已移除');
  assert.ok(css.indexOf('@keyframes xtjToolResultIn') >= 0, '缺少结果卡片进入动画');
  // 运行态视觉指示
  assert.ok(css.indexOf('.ai-tool-step.is-running::before') >= 0, '缺少运行态进度条');
  // 呼吸周期必须足够缓慢，否则又变成"吵"
  var m = css.match(/animation:\s*xtjToolGlow\s+([\d.]+)s/);
  assert.ok(m && Number(m[1]) >= 2, '呼吸光晕周期应 >= 2s，实际: ' + (m && m[1]));
  // 必须同时尊重 prefers-reduced-motion 与项目自身的 motion 开关
  assert.ok(css.indexOf('html[data-xtj-motion=off] .ai-tool-step') >= 0,
    '工具动画未接入 data-xtj-motion 开关，会在低性能档位继续消耗资源');
});

// ── 6. 工具失败的可纠正性引导（准确性 / 辩解性）────────────────────────
test('tool failures carry recoverable flag and corrective instruction', function () {
  // 两条主路径都必须回传 recoverable + instruction，避免模型复述
  // 英文错误码或凭猜测编造数据。
  var hits = server.match(/recoverable:\s*_recoverable/g) || [];
  assert.ok(hits.length >= 2,
    '工具失败结果应至少在两处主路径回传 recoverable 标记，实际: ' + hits.length);
  var instr = server.match(/instruction:\s*_recoverable/g) || [];
  assert.ok(instr.length >= 2,
    '工具失败结果应至少在两处主路径回传 instruction 引导，实际: ' + instr.length);
  // 服务侧故障必须与参数问题区分
  assert.ok(server.indexOf('服务侧故障，与参数无关') >= 0,
    '缺少"服务侧故障与参数无关"的说明，模型会误导用户反复改参数');
});

test('get_weather tool schema enforces canonical city names', function () {
  // tool description 必须明确禁止行政区划后缀，从源头降低失败率
  assert.ok(server.indexOf('不要带行政区划后缀') >= 0,
    'get_weather 工具描述未约束地名格式，模型会继续传「成都市武侯区」这类输入');
  assert.ok(server.indexOf('规范城市名，不带“市/区/县/省”后缀') >= 0,
    'get_weather 参数描述未约束地名格式');
});
