// 搜索配额降级契约测试（遗留 1 + 遗留 2）
// 背景（用户报告 → 审计发现）：
//   ① Supabase 配额 RPC 抖动时，ai-quota.getQuota() 不会抛异常，而是返回
//      normalizeQuotaPayload({ ok:false, reason:'quota_unavailable' }) ——
//      该载荷 search_remaining 恒为 0。旧 enforceSearchQuota 直接拿它做
//      `search_remaining - usedNow <= 0` 判定，于是「配额服务挂了」被当成
//      「你今天的搜索次数用完了」，对用户撒谎、也让平台背锅。
//   ② HTTP 400 时只落一行状态码，看不到 DeepSeek 返回的 error.message，
//      无法区分「reasoning 未回传」「参数非法」「模型/tools 不兼容」三类 400。
//
// 本测试把这两条修复固化成不可回退的契约。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');
const quotaSrc = fs.readFileSync(path.join(root, 'render-api', 'ai-quota.js'), 'utf8');

// 截取某个函数体（大括号配平）
function extractFn(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start > -1, '未找到函数：' + signature);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('函数体未配平：' + signature);
}

// ───────────────────────────── 遗留 1 ─────────────────────────────

test('遗留1：ai-quota.getQuota 在 RPC 失败时不抛异常，而是返回 ok:false 载荷', () => {
  // 这是"必须显式识别降级载荷"的前提事实，也是旧实现踩坑的根源。
  const getQuotaFn = extractFn(quotaSrc, 'async function getQuota(userName) {');
  assert.match(getQuotaFn, /result\.error \|\| !result\.data/, 'getQuota 未处理 RPC 错误');
  assert.match(getQuotaFn, /reason:\s*'quota_unavailable'/, 'getQuota 失败时未返回 quota_unavailable 载荷');
});

test('遗留1：降级载荷会造成误判（null 载荷 remaining=0；对象载荷 remaining=默认额度）', () => {
  const q = require(path.join(root, 'render-api', 'ai-quota.js'));
  // 陷阱 A：checkBeforeChat 用的 normalizeQuotaPayload(null) —— remaining 恒 0，
  //   旧逻辑 `search_remaining - usedNow <= 0` 必然成立 → 服务故障被当成次数用尽。
  const nullPayload = q.normalizeQuotaPayload(null);
  assert.equal(nullPayload.ok, false, '空载荷必须标记 ok=false');
  assert.equal(nullPayload.search_remaining, 0, '空载荷 search_remaining 应为 0（误判来源 A）');
  // 陷阱 B：getQuota 失败路径用的 normalizeQuotaPayload({ ok:false, reason:'quota_unavailable' })
  //   —— remaining 会回落到默认日额度（看着"还有额度"），同样不可信。
  //   两条路径都不能靠 remaining 判断可用性，必须显式识别 ok=false。
  const degraded = q.normalizeQuotaPayload({ ok: false, reason: 'quota_unavailable' });
  assert.equal(degraded.ok, false, '降级载荷必须标记 ok=false（唯一可靠信号）');
});

test('遗留1：measureSearchQuota 显式区分「服务故障」与「配额用尽」', () => {
  const fn = extractFn(serverSrc, 'async function measureSearchQuota(userName, extraUsed) {');
  // 必须显式识别 ok=false / reason=quota_unavailable 载荷
  assert.match(fn, /quota\.ok === false/, '未显式识别降级载荷（ok===false）');
  assert.match(fn, /quota\.reason === 'quota_unavailable'/, '未显式识别 quota_unavailable');
  // 故障分支不得复用 search_limit
  assert.match(fn, /degraded:\s*true/, '故障分支缺少 degraded 标记');
  assert.match(fn, /reason:\s*SEARCH_QUOTA_FAIL_OPEN \? null : 'quota_unavailable'/,
    '故障分支的 reason 不应是 search_limit');
  // 故障分支必须早于 search_remaining 判定（否则又会被误判为用尽）
  const degradedIdx = fn.indexOf('if (rpcFailed)');
  const limitIdx = fn.indexOf('search_remaining - usedNow <= 0');
  assert.ok(degradedIdx > -1, '未找到故障分支');
  assert.ok(limitIdx > -1, '未找到配额判定');
  assert.ok(degradedIdx < limitIdx, '故障判定必须早于配额判定，否则服务故障会被误报为次数用尽');
});

test('遗留1：配额服务故障默认 fail-open 放行（可经 env 关闭）', () => {
  assert.match(serverSrc, /var SEARCH_QUOTA_FAIL_OPEN = process\.env\.SEARCH_QUOTA_FAIL_OPEN !== 'false'/,
    '未定义 fail-open 开关');
  const fn = extractFn(serverSrc, 'async function measureSearchQuota(userName, extraUsed) {');
  assert.match(fn, /allowed:\s*!!SEARCH_QUOTA_FAIL_OPEN/, '故障分支未按 fail-open 开关决定是否放行');
});

test('遗留1：用户不存在 / 管理员豁免语义未被破坏', () => {
  const fn = extractFn(serverSrc, 'async function measureSearchQuota(userName, extraUsed) {');
  assert.match(fn, /if \(!userName\) return \{ allowed: false, reason: 'no_user'/,
    '空 userName 必须拒绝（防配额绕过）');
  assert.match(fn, /if \(userName === ADMIN_USERNAME\) return \{ allowed: true, reason: null/,
    '管理员必须豁免');
});

test('遗留1：错误文案不得把「服务故障」冒充为「次数用尽」', () => {
  const fn = extractFn(serverSrc, 'function searchQuotaErrorPayload(reason) {');
  assert.match(fn, /quota_unavailable/, '未分支处理 quota_unavailable');
  assert.match(fn, /quota_service_unavailable:\s*true/, '服务故障必须带可识别标记');
  // 「今日次数已达上限」只能出现在真正用尽的分支里，且该分支必须标记配额用尽。
  // 判据：从"拒绝"分支（no_user 之后）到函数结尾这一段，只应有最后一个分支含用尽标记。
  const limitIdx = fn.indexOf('今日网页搜索次数已达上限');
  assert.ok(limitIdx > -1, '缺少配额用尽文案');
  const tail = fn.slice(limitIdx);
  assert.match(tail, /search_quota_exceeded:\s*true/, '配额用尽分支必须标记 search_quota_exceeded=true');
  // 服务故障分支不得含"已达上限"字样（否则又会误导用户）
  const unavailableStart = fn.indexOf("if (reason === 'quota_unavailable')");
  const unavailableEnd = fn.indexOf('}', fn.indexOf('quota_service_unavailable: true'));
  const unavailableSeg = fn.slice(unavailableStart, unavailableEnd);
  assert.doesNotMatch(unavailableSeg, /已达上限/, '服务故障分支不得声称次数已达上限');
});

test('遗留1：三个搜索工具分支都走新 gate 与分档文案', () => {
  const cases = ["case 'search_web': {", "case 'tavily_search': {", "case 'search_social_accounts': {"];
  let found = 0;
  cases.forEach(function(sig) {
    const idx = serverSrc.indexOf(sig);
    if (idx < 0) return;
    found++;
    const seg = serverSrc.slice(idx, idx + 2200);
    assert.match(seg, /measureSearchQuota/, sig + ' 未使用新 gate');
    assert.match(seg, /searchQuotaErrorPayload/, sig + ' 未使用分档错误文案');
    assert.doesNotMatch(seg, /return \{ tool_name: name[^}]*error: '今日网页搜索次数已达上限/,
      sig + ' 仍在使用一刀切文案（服务故障会被误报为次数用尽）');
  });
  assert.ok(found >= 2, '至少应覆盖 search_web 与 tavily_search 两个分支');
});

test('遗留1：searchWebForUser 透传 degraded 标记供调用方/前端识别', () => {
  const fn = extractFn(serverSrc, 'async function searchWebForUser(userName, query, maxResults, searchApiCounter) {');
  assert.match(fn, /quota_service_unavailable:\s*gate\.reason === 'quota_unavailable'/,
    'gate 拒绝时未透传服务故障标记');
  assert.match(fn, /quota_degraded/, '放行但降级时未透传 quota_degraded');
});

test('遗留1：enforceSearchQuota 保留为兼容别名（既有调用点/测试不破）', () => {
  const fn = extractFn(serverSrc, 'async function enforceSearchQuota(userName, extraUsed) {');
  assert.match(fn, /return measureSearchQuota\(userName, extraUsed\)/, '兼容别名未委派到新实现');
});

// ───────────────────────────── 遗留 2 ─────────────────────────────

test('遗留2：上游错误日志辅助函数存在且做长度截断', () => {
  const fn = extractFn(serverSrc, 'function logProviderErrorDetail(tag, status, info) {');
  assert.match(fn, /error_message/, '未记录 error.message');
  assert.match(fn, /request_id/, '未记录 request_id');
  assert.match(fn, /error_code/, '未记录 error.code');
  assert.match(fn, /slice\(0,\s*500\)/, '错误消息未做长度截断（防日志膨胀）');
  assert.match(fn, /console\.error/, '未输出到日志');
  // 不得记录请求正文（防用户内容泄漏）
  assert.doesNotMatch(fn, /apiBody\.input/, '日志函数不应触碰请求正文');
});

test('遗留2：日志开关默认开启（此前 400 时没有任何线索）', () => {
  assert.match(serverSrc, /const DEBUG_PROVIDER_ALWAYS = process\.env\.CODE_DEBUG_PROVIDER_FORCE !== 'false'/,
    '未定义默认开启的 provider 错误日志开关');
});

test('遗留2：chat/completions 路径调用日志（code/type/message/request_id 全量）', () => {
  const idx = serverSrc.indexOf("logProviderErrorDetail('DEEPSEEK'");
  assert.ok(idx > -1, 'DEEPSEEK 路径未接入错误详情日志');
  const seg = serverSrc.slice(idx, idx + 460);
  assert.match(seg, /errTxt/, '未带 error.message');
  assert.match(seg, /errRequestId/, '未带 request_id');
  assert.match(seg, /tools_count/, '未带本轮工具数（区分 tools 相关 400 的关键）');
});

test('遗留2：Responses 路径调用日志并带轮次/输入项数（400 定位核心）', () => {
  const idx = serverSrc.indexOf("logProviderErrorDetail('RESPONSES'");
  assert.ok(idx > -1, 'Responses 路径未接入错误详情日志');
  const seg = serverSrc.slice(idx, idx + 520);
  assert.match(seg, /round/, '未带轮次');
  assert.match(seg, /input_items/, '未带 input 项数（reasoning 回传问题会体现在这里）');
  assert.match(seg, /reasoning_effort/, '未带 reasoning.effort');
});

test('遗留2：非 JSON / 空错误体也要留证据', () => {
  assert.match(serverSrc, /provider error body \(unparsed\)/, '解析失败的返回体未被记录');
  assert.match(serverSrc, /\(non-json or empty body\)/, '空错误体未被显式标记');
});

test('遗留2：降级重试（reasoning off）失败时记录重试那次的错误体', () => {
  const idx = serverSrc.indexOf("logProviderErrorDetail('RESPONSES-RETRY'");
  assert.ok(idx > -1, '降级重试失败未记录错误详情');
});

test('遗留2：错误对象携带 provider 详情且不携带请求正文', () => {
  const idx = serverSrc.indexOf('apiErr.providerMessage');
  assert.ok(idx > -1, 'apiErr 未携带 providerMessage');
  const seg = serverSrc.slice(idx, idx + 600);
  assert.match(seg, /providerRequestId/, '未携带 providerRequestId');
  // 不得把上游完整错误体挂到错误对象上（历史上 fullErrorBody 曾被她挂载并回显）。
  const apiErrSeg = serverSrc.slice(serverSrc.indexOf('var apiErr = new Error'),
    serverSrc.indexOf('throw apiErr;', serverSrc.indexOf('var apiErr = new Error')) + 12);
  assert.doesNotMatch(apiErrSeg, /apiErr\.fullErrorBody/, '不应把完整错误体挂到 apiErr 上');
});

test('遗留2：SSE 错误日志透出 provider 详情，便于线上定位', () => {
  const idx = serverSrc.indexOf('[AGENT-STREAM] Responses API failed:');
  assert.ok(idx > -1, '未找到 SSE 错误日志');
  const seg = serverSrc.slice(idx, idx + 700);
  assert.match(seg, /provider_message=/, 'SSE 错误日志未透出 provider_message');
  assert.match(seg, /request_id=/, 'SSE 错误日志未透出 request_id');
});

test('遗留2：面向用户的文案依据 provider 具体原因分档（不再只会说"参数被拒绝"）', () => {
  const marker = '/HTTP 4\\d\\d/.test(_respErrMsg)';
  const idx = serverSrc.indexOf(marker);
  assert.ok(idx > -1, '未找到 HTTP 4xx 文案分支');
  const seg = serverSrc.slice(idx, idx + 1100);
  assert.match(seg, /providerMessage/, '文案未参考 provider 具体错误说明');
  assert.match(seg, /工具与思考模式冲突/, '未区分「工具 vs 思考」冲突');
  assert.match(seg, /超过模型上限/, '未区分「上下文超长」');
});
