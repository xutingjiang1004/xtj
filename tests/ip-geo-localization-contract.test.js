// IP 属地本地化 / 并行竞速合约测试（2026-09-22 修复回归）
//
// 背景（三条都经实测确认）：
//   1) ipwho.is 不带语言参数时，国内 IP 返回英文（region="Zhejiang Sheng"、city="Hangzhou"）
//      → 前台显示「IP属地：Zhejiang Sheng Hangzhou」；
//   2) 第三源 ip-api.com 免费档**不支持 HTTPS**（实测 403），在顺序 fallback 里只会白等一次超时
//      （首次解析最坏 ~7s）；
//   3) /api/post/detail/:id 不返回 ip_region_*，详情弹窗没有属地（feed 有、详情没有）。
//
// 修复：
//   - ipwho.is 请求补 `lang=zh-CN`；
//   - 新增 normalizeIpGeoName + IP_GEO_ZH_MAP（97 条）兜底归一：中文去行政后缀、
//     英文按后缀剥离后映射为中文（并行竞速下不支持语言参数的 ipapi.co 可能先返回）；
//   - 三源改 `Promise.any` 并行竞速 + 整体 3s 截止；
//   - /api/post/detail 补返回 ip_region_text。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'render-api', 'server.js');
const src = fs.readFileSync(SERVER, 'utf8');

// ── 合约（源码级）────────────────────────────────────────────

test('合约：新测试已接入 npm test（否则不会在 CI 中被执行）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(
    String(pkg.scripts.test || '').indexOf('ip-geo-localization-contract') >= 0,
    '本测试文件必须登记在 package.json 的 scripts.test 中'
  );
});

test('合约：ipwho.is 请求必须带 lang=zh-CN', () => {
  assert.ok(
    src.includes("'https://ipwho.is/' + encodeURIComponent(ip) + '?lang=zh-CN'"),
    'ipwho.is 必须请求中文结果，否则国内 IP 返回英文省市名'
  );
});

test('合约：属地解析必须是并行竞速（Promise.any + 整体截止），不是顺序 fallback', () => {
  assert.ok(
    src.includes('Promise.race([Promise.any(fetchers.map('),
    '必须用 Promise.any 并行竞速（首个成功者胜出）'
  );
  assert.ok(/overall_deadline/.test(src), '必须有整体截止（overall_deadline），避免竞速无上限地等待');
});

test('合约：死源 ip-api.com 不得回归', () => {
  const live = src.match(/https?:\/\/ip-api\.com/g) || [];
  assert.equal(
    live.length,
    0,
    'ip-api.com 免费档不支持 HTTPS（实测 403），不得再作为数据源出现；如需恢复必须改用其付费 HTTPS 档'
  );
});

test('合约：/api/post/detail 必须返回 ip_region_text', () => {
  assert.ok(
    src.includes('ip_region_text: post.ip_region_text || null,'),
    '详情接口必须返回 ip_region_text，否则详情弹窗无法渲染属地（feed 有、详情没有）'
  );
});

test('合约：竞速结果的国家/省/市三处都要过 normalizeIpGeoName', () => {
  for (const f of ['country', 'region', 'city']) {
    assert.ok(
      src.includes('racedResult.' + f + ' = normalizeIpGeoName(racedResult.' + f + ');'),
      f + ' 字段必须归一为中文'
    );
  }
});

// ── 行为（抽出纯函数 + 映射表在裸函数沙箱中执行）────────────

function extractFn(name) {
  const re = new RegExp('\\n(?:async )?function ' + name + '\\([^)]*\\) \\{');
  const m = src.match(re);
  assert.ok(m, '在 server.js 中找到 function ' + name);
  const start = m.index + 1;
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return src.slice(start, end);
}

function extractMap(name) {
  const m = src.match(new RegExp('var ' + name + ' = \\{[\\s\\S]*?\\n\\};'));
  assert.ok(m, '在 server.js 中找到 var ' + name);
  return m[0];
}

const code = [extractMap('IP_GEO_ZH_MAP'), extractFn('normalizeIpGeoName')].join('\n');
const { normalizeIpGeoName } = new Function(
  code + '; return { normalizeIpGeoName: normalizeIpGeoName };'
)();

test('行为：中文结果去掉行政后缀（展示与主流平台一致）', () => {
  assert.equal(normalizeIpGeoName('浙江省'), '浙江');
  assert.equal(normalizeIpGeoName('杭州市'), '杭州');
  assert.equal(normalizeIpGeoName('广西壮族自治区'), '广西');
  assert.equal(normalizeIpGeoName('新疆维吾尔自治区'), '新疆');
  assert.equal(normalizeIpGeoName('香港特别行政区'), '香港');
  assert.equal(normalizeIpGeoName('内蒙古自治区'), '内蒙古');
});

test('行为：英文结果剥离后缀后映射为中文（ipapi.co 先返回的场景）', () => {
  assert.equal(normalizeIpGeoName('Zhejiang Sheng'), '浙江');
  assert.equal(normalizeIpGeoName('Zhejiang'), '浙江');
  assert.equal(normalizeIpGeoName('Hangzhou'), '杭州');
  assert.equal(normalizeIpGeoName('Hangzhou Shi'), '杭州');
  assert.equal(normalizeIpGeoName('Guangdong Province'), '广东');
  assert.equal(normalizeIpGeoName('Shanghai Municipality'), '上海');
  assert.equal(normalizeIpGeoName('Inner Mongolia'), '内蒙古');
  assert.equal(normalizeIpGeoName('China'), '中国');
});

test('行为：映射未命中的保留原文（好过显示空白），空值返回空串', () => {
  assert.equal(normalizeIpGeoName('Atlantis'), 'Atlantis');
  assert.equal(normalizeIpGeoName('Some Unknown Place'), 'Some Unknown Place');
  assert.equal(normalizeIpGeoName(''), '');
  assert.equal(normalizeIpGeoName('   '), '');
  assert.equal(normalizeIpGeoName(null), '');
  assert.equal(normalizeIpGeoName(undefined), '');
  assert.equal(normalizeIpGeoName('  浙江  '), '浙江', '结果必须 trim');
});

test('行为：映射表覆盖 34 个省级行政区 + 主要城市（抽检规模）', () => {
  const keys = (extractMap('IP_GEO_ZH_MAP').match(/'([^']+)':/g) || []).length;
  assert.ok(keys >= 90, '映射表条目数应 >= 90，当前 ' + keys);
});
