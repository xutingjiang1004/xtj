/**
 * 回归守卫（2026-09-29）：管理端 AI 配置保存 500「保存失败」
 *
 * 根因：提交 6ae00e15（2026-09-14）把 AI_DEFAULT_CONFIG.admin_debug 整行
 * 并进了上一行 security 的行尾注释，defaults 从此丢失 admin_debug key。
 * 后果（已本地实跑复现）：
 *   ① 管理端保存必带 admin_debug 对象 → migrateConfig 里
 *      safeAssignShallow(merged.admin_debug=undefined, …) 抛 TypeError
 *      → /admin/ai-agent/config 恒 500，前端报「保存异常: 保存失败」；
 *   ② getAiConfig() 读已落库配置同样要过 migrateConfig，同样抛错被 catch
 *      吞掉 → 用户端 AI 配置（人设/欢迎语/模型设置）静默回退默认值。
 *
 * 本文件两层防护：
 *   A. 行为层 —— 从 server.js 按锚点切片实际执行 migrateConfig，
 *      钉死「真实管理端 payload 不抛错」与「defaults 漂移不抛错」；
 *   B. 文本层 —— 钉死 admin_debug 必须是 defaults 里的独立 key、
 *      safeAssignShallow 必须带 target 兜底，防止同类注释吞行复发。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'render-api/server.js'), 'utf8');

// 从 server.js 切出 migrateConfig 链路所需的最小函数集并实际执行
function loadMigrateModule() {
  const p1Start = serverSrc.indexOf('const DEEPSEEK_MODEL_FLASH');
  const p1End = serverSrc.indexOf('const DEEPSEEK_MODELS_URL');
  assert.notEqual(p1Start, -1, '未找到 DEEPSEEK_MODEL_FLASH 定义');
  assert.notEqual(p1End, -1, '未找到 DEEPSEEK_MODELS_URL 定义');
  const part1 = serverSrc.slice(p1Start, p1End);

  const p2Start = serverSrc.indexOf('const AI_DEFAULT_CONFIG = {');
  const p2End = serverSrc.indexOf('async function getAiConfig');
  assert.notEqual(p2Start, -1, '未找到 AI_DEFAULT_CONFIG 定义');
  assert.notEqual(p2End, -1, '未找到 getAiConfig 定义');
  const part2 = serverSrc.slice(p2Start, p2End);

  const code = 'const deepseekModelCatalog = { fetchedAt: 0, status: "idle", error: "", models: [], availableSet: new Set() };\n'
    + part1 + '\n' + part2 + '\nmodule.exports = { migrateConfig: migrateConfig, AI_DEFAULT_CONFIG: AI_DEFAULT_CONFIG };';
  const mod = { exports: {} };
  new Function('module', code)(mod);
  return mod.exports;
}

// 管理端保存按钮（js/admin/admin.js aiCfgSaveBtn）构造的完整 payload 形态
function buildAdminPayload() {
  return {
    name: '小猫', description: 'x', welcome_message: 'hi', persona: '', tone: '',
    system_prompt: '', avatar: '🤖',
    reply_style: { directness: 'direct', detail_level: 'medium', humor_level: 'low', sarcasm_level: 'low', warmth_level: 'medium', use_markdown: true, use_emoji: false, max_reply_chars: 1200 },
    roleplay: { enabled: true, allow_stage_directions: true, allow_cat_actions: true, forbidden_action_patterns: [] },
    output_rules: { must: ['a'], avoid: ['b'], format: ['c'] },
    search: { allow_web_search: true, search_provider: 'searxng', max_results: 5, timeout_ms: 4000, use_weather_tool: true },
    model: { reasoner_model: 'deepseek-flash', default_thinking_mode: 'low', allow_user_thinking_switch: true, multi_agent: false },
    deep_think: { enabled: true, default_thinking_mode: 'max', max_workers: 6, min_workers: 0, force_split_min_length: 24, worker_max_tool_rounds: 5, low_max_tokens: 4096, medium_max_tokens: 16384, high_max_tokens: 32768, low_max_tool_rounds: 0, medium_max_tool_rounds: 2, high_max_tool_rounds: 4, require_history_injection: true },
    security: { hide_system_prompt_in_reasoning: true },
    admin_debug: { show_effective_prompt: true, show_model_info: true, show_reasoning_length: true }
  };
}

// ---------------------------------------------------------------- A 行为层

test('admin 配置保存：真实管理端 payload 过 migrateConfig 不抛错且 admin_debug 保留', () => {
  const { migrateConfig } = loadMigrateModule();
  var out = migrateConfig(buildAdminPayload());  // 修复前此处抛 TypeError: Cannot set properties of undefined
  assert.equal(out.admin_debug.show_effective_prompt, true);
  assert.equal(out.admin_debug.show_model_info, true);
  assert.equal(out.admin_debug.show_reasoning_length, true);
  assert.equal(out.version, 2);
});

test('admin 配置保存：defaults 漂移（缺失子对象）时 migrateConfig 也不再抛错', () => {
  const { migrateConfig, AI_DEFAULT_CONFIG } = loadMigrateModule();
  delete AI_DEFAULT_CONFIG.admin_debug;  // 模拟 6ae00e15 式 defaults 漂移
  var out = migrateConfig(buildAdminPayload());
  assert.equal(out.admin_debug.show_effective_prompt, true);
});

// ---------------------------------------------------------------- B 文本层

test('AI_DEFAULT_CONFIG.admin_debug 必须是独立 key（不得被行尾注释吞掉）', () => {
  assert.match(serverSrc, /^  admin_debug:\s*\{\s*show_effective_prompt:\s*true/m,
    'admin_debug 应作为 AI_DEFAULT_CONFIG 的独立字段存在（6ae00e15 曾把整行并进注释导致保存恒 500）');
  // security 行的行尾注释里不得再出现 admin_debug 定义
  const secLine = serverSrc.split('\n').find(l => /^  security: \{ hide_system_prompt_in_reasoning/.test(l)) || '';
  assert.doesNotMatch(secLine, /admin_debug:\s*\{/, 'security 行尾注释不得包含 admin_debug 定义');
});

test('safeAssignShallow 必须对缺失 target 兜底（防同类 defaults 漂移再演变成 500）', () => {
  const start = serverSrc.indexOf('function safeAssignShallow(');
  assert.notEqual(start, -1, '未找到 safeAssignShallow');
  const body = serverSrc.slice(start, serverSrc.indexOf('\n}', start));
  assert.match(body, /if\s*\(!target\s*\|\|\s*typeof target !== 'object'\)\s*target = \{\};/,
    'target 非对象时应初始化为空对象，而不是往 undefined 上赋值抛 TypeError');
});

test('migrateConfig 子对象合并必须走 safeMergeInto（漂移时字段写回 merged 而非局部临时对象）', () => {
  const start = serverSrc.indexOf('function migrateConfig(config) {');
  const body = serverSrc.slice(start, serverSrc.indexOf('\nasync function', start));
  assert.match(body, /function safeMergeInto|safeMergeInto\(/, '未找到 safeMergeInto 定义或调用');
  ['reply_style', 'roleplay', 'output_rules', 'search', 'model', 'deep_think', 'security', 'admin_debug'].forEach(k => {
    assert.match(body, new RegExp('safeMergeInto\\(merged, \'' + k + '\''), k + ' 分支应走 safeMergeInto');
  });
  assert.doesNotMatch(body, /safeAssignShallow\(merged\./, '不得再直接对 merged.X 调 safeAssignShallow（漂移时字段会静默丢失）');
});

test('AI_DEFAULT_CONFIG.admin_debug 三个调试开关默认值存在', () => {
  assert.match(serverSrc, /admin_debug:\s*\{[^}]*show_effective_prompt:\s*true[^}]*\}/);
  assert.match(serverSrc, /admin_debug:\s*\{[^}]*show_model_info:\s*true[^}]*\}/);
  assert.match(serverSrc, /admin_debug:\s*\{[^}]*show_reasoning_length:\s*true[^}]*\}/);
});
