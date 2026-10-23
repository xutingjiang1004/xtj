// Historical IP localization contracts; 2026-10-22 replaces fastest-success
// selection with bounded source corroboration. Runtime cases cover conflicts,
// address binding, cache invalidation and post snapshots in ip-geolocation-runtime.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'render-api', 'server.js');
const src = fs.readFileSync(SERVER, 'utf8');
const geoSource = fs.readFileSync(path.join(ROOT, 'render-api', 'ip-geolocation.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'js', 'ip-location.js'), 'utf8');
const { normalizeIpGeoName } = require('../render-api/ip-geolocation');

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
    geoSource.includes("'https://ipwho.is/' + encoded + '?lang=zh-CN'"),
    'ipwho.is 必须请求中文结果，否则国内 IP 返回英文省市名'
  );
});

test('geolocation collects bounded parallel evidence instead of choosing the fastest success', () => {
  assert.match(geoSource, /Promise\.all\(/);
  assert.match(geoSource, /selectIpLocation/);
  assert.match(geoSource, /controller\.abort\(\)/);
  assert.doesNotMatch(geoSource, /Promise\.any\(/);
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
  const keys = (geoSource.match(/'([^']+)':/g) || []).length;
  assert.ok(keys >= 90, '映射表条目数应 >= 90，当前 ' + keys);
});
