// 2026-09-24 生产 bug 回归合约（两连修）
// Bug A（发帖 IP 属地错误）：
//   - trust proxy 固定网段列表可能漏掉平台新增内网 hop → req.ip 落私网 →
//     XFF 兜底极端时误选客户端伪造的最左公网值 → 改函数判定（非公网即受信）
//   - 属地数据源全为海外库，对中国移动/广电等 IP 省市精度差甚至张冠李戴 →
//     国内源第一层（百度 opendata + pconline GBK）+ 海外库第二层
//   - 属地缓存 7 天过长，错误属地一周无法自愈 → 24 小时
//   - 新增取 IP 来源标记 + 发帖诊断日志，可在 Render 日志直接定位错在哪一环
// Bug B（小猫AI get_weather「天气服务暂时不可用」）：
//   - Render 共享出口 IP 触发 open-meteo 429 限流，每次提问实时外发无节流 →
//     10 分钟结果缓存 + wttr.in 备源兜底 + 状态码透出日志
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'render-api', 'server.js'), 'utf8');
const weather = require(path.join(ROOT, 'render-api', 'weather.js'));

// ───────────────────────── Bug A：IP 属地 ─────────────────────────

test('合约：getClientIp 标记取值来源（诊断"取错哪一环"）', () => {
  assert.ok(serverSrc.includes("req._clientIpSource = (i === 0 ? 'express_req_ip' : 'socket_remote');"),
    'req.ip/socket 分支必须有来源标记');
  assert.ok(serverSrc.includes("req._clientIpSource = 'xff_chain_public';"),
    'XFF 兜底分支必须有来源标记');
  assert.ok(serverSrc.includes("req._clientIpSource = 'fallback_private_or_unknown';"),
    '最终兜底分支必须有来源标记');
});

test('合约：发帖端点输出 [IP-DIAG] 诊断日志（含 xff 原文与解析结果）', () => {
  assert.ok(serverSrc.includes("[IP-DIAG] user="), '发帖端点必须有 IP 诊断日志');
  const idx = serverSrc.indexOf('[IP-DIAG] user=');
  const ctx = serverSrc.slice(idx, idx + 400);
  assert.ok(ctx.includes('_clientIpSource'), '日志必须含来源标记');
  assert.ok(ctx.includes('x-forwarded-for'), '日志必须含 XFF 原文');
  assert.ok(ctx.includes('region='), '日志必须含属地解析结果');
});

test('合约：属地解析第一层为国内源（百度 opendata + pconline），第二层海外库', () => {
  assert.ok(serverSrc.includes('https://opendata.baidu.com/api.php?query='), '国内第一层必须有百度 opendata');
  assert.ok(serverSrc.includes('https://whois.pconline.com.cn/ipJson.jsp?ip='), '国内第一层必须有 pconline');
  assert.ok(serverSrc.includes('const cnFetchers = ['), '必须存在国内源竞速层');
  assert.ok(serverSrc.includes('function raceWithDeadline('), '必须存在带截止时间的竞速辅助');
  assert.ok(serverSrc.includes("new TextDecoder('gbk')"), 'pconline GBK 文本必须用 TextDecoder 解码');
  // 国内层命中且省市齐全时不落第二层；省市全空（海外 IP）时补第二层
  assert.ok(serverSrc.includes("if (!racedResult || (!racedResult.region && !racedResult.city)) {"),
    '海外 IP（国内库只给国家级结果）必须落第二层海外库');
});

test('合约：属地缓存 TTL 为 24 小时（错误属地最多固化一天）', () => {
  assert.ok(serverSrc.includes('var IP_REGION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;'));
});

// 从 server.js 提取纯函数做行为验证（不 require 整个服务）
function extractFn(name) {
  const re = new RegExp('\\n(?:async )?function ' + name + '\\([^)]*\\) \\{');
  const m = serverSrc.match(re);
  assert.ok(m, '在 server.js 中找到 function ' + name);
  const start = m.index + 1;
  let i = serverSrc.indexOf('{', start), depth = 0, end = -1;
  for (; i < serverSrc.length; i++) {
    if (serverSrc[i] === '{') depth++;
    else if (serverSrc[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return serverSrc.slice(start, end);
}

function extractVar(name) {
  const marker = 'var ' + name + ' = {';
  const start = serverSrc.indexOf(marker);
  assert.ok(start >= 0, '在 server.js 中找到 var ' + name);
  let i = start + marker.length - 1, depth = 0, end = -1;
  for (; i < serverSrc.length; i++) {
    if (serverSrc[i] === '{') depth++;
    else if (serverSrc[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return serverSrc.slice(start, end);
}

const geoCode = [
  extractVar('IP_GEO_ZH_MAP'),
  extractFn('normalizeIpGeoName'),
  extractFn('parseBaiduGeoPayload'),
  extractFn('parsePconlineGeoText')
].join('\n');
const geoFactory = new Function(geoCode + '; return { parseBaiduGeoPayload: parseBaiduGeoPayload, parsePconlineGeoText: parsePconlineGeoText };');
const { parseBaiduGeoPayload, parsePconlineGeoText } = geoFactory();

test('行为：parseBaiduGeoPayload（省+市 / 直辖市去重 / 运营商剥离 / 非法与海外降级）', () => {
  const cn = parseBaiduGeoPayload({ status: '0', data: [{ location: '福建省福州市 电信' }] });
  assert.deepEqual({ region: cn.region, city: cn.city }, { region: '福建', city: '福州' });

  const direct = parseBaiduGeoPayload({ status: '0', data: [{ location: '北京市北京市 移动' }] });
  assert.equal(direct.region, '北京');
  assert.equal(direct.city, '', '直辖市省市重复必须去重');

  assert.equal(parseBaiduGeoPayload({ status: '1', data: [{ location: 'x' }] }), null, 'status 非 0 → null');
  assert.equal(parseBaiduGeoPayload({ status: '0', data: [] }), null, '空 data → null');
  assert.equal(parseBaiduGeoPayload({ status: '0', data: [{ location: '' }] }), null, '空 location → null');
  assert.equal(parseBaiduGeoPayload({ status: '0', data: [{ location: '美国' }] }), null, '海外无省市 → null（降级海外库）');
  assert.equal(parseBaiduGeoPayload(null), null);
});

test('行为：parsePconlineGeoText（GBK 解码后的文本 / 无 JSON / 空省市）', () => {
  const p = parsePconlineGeoText('{"ip":"223.104.3.9","pro":"福建省","proCode":"350000","city":"福州市","cityCode":"350100","addr":"福建省福州市 电信","err":""}');
  assert.deepEqual({ region: p.region, city: p.city }, { region: '福建', city: '福州' });

  const d = parsePconlineGeoText('{"pro":"北京市","city":"北京市","addr":"北京市 移通"}');
  assert.equal(d.region, '北京');
  assert.equal(d.city, '', '直辖市去重');

  assert.equal(parsePconlineGeoText('garbage no json'), null);
  assert.equal(parsePconlineGeoText('{"pro":"","city":""}'), null, '空省市 → null（降级海外库）');
  assert.equal(parsePconlineGeoText(''), null);
});

// ───────────────────────── Bug B：get_weather ─────────────────────────

test('合约：weather.js 有结果缓存与 wttr.in 备源；fetchForecast 失败必须抛错带状态码', () => {
  const wSrc = fs.readFileSync(path.join(ROOT, 'render-api', 'weather.js'), 'utf8');
  assert.ok(wSrc.includes('var WEATHER_CACHE = new Map();'), '必须有天气结果缓存');
  assert.ok(wSrc.includes('function fetchForecastViaWttr('), '必须有 wttr.in 备源函数');
  assert.ok(wSrc.includes('upErr.upstream_status = lastStatus;'),
    'open-meteo 全败必须抛出带 upstream_status 的错误（不再静默 return null）');
  assert.ok(wSrc.includes("fetchForecastViaWttr(matchedCity)"), 'queryWeatherData 主源全败必须走备源');
  assert.ok(!/\n  if \(!resp \|\| !resp\.ok\) return null;/.test(wSrc),
    'fetchForecast 不允许再静默返回 null');
});

test('合约：get_weather 工具失败时输出上游诊断日志（用户侧文案不变）', () => {
  assert.ok(serverSrc.includes("[get_weather] 上游失败:"), 'catch 分支必须有诊断日志');
  const idx = serverSrc.indexOf("[get_weather] 上游失败:");
  const ctx = serverSrc.slice(idx, idx + 600);
  assert.ok(ctx.includes('upstream_status'), '日志必须含上游状态码');
  assert.ok(serverSrc.includes('天气服务暂时不可用（网络或上游接口异常）'), '用户侧文案必须保留');
});

// 行为验证：mock global.fetch
const REAL_FETCH = global.fetch;
function makeRes(status, body, headers) {
  const h = new Map(Object.entries(headers || {}));
  return {
    ok: status >= 200 && status < 300,
    status: status,
    headers: { get: (k) => (h.has(String(k).toLowerCase()) ? h.get(String(k).toLowerCase()) : null) },
    text: async () => body
  };
}
const WTTR_J1 = JSON.stringify({
  current_condition: [{ temp_C: '21', humidity: '70', windspeedKmph: '12', weatherCode: '0' }],
  weather: [{ maxtempC: '26', mintempC: '18', hourly: [{ chanceofrain: '10' }, { chanceofrain: '40' }] }]
});

test('行为：open-meteo 限流 429 → wttr.in 备源兜底 → 结果写缓存（第二次调用零外发）', async () => {
  let openMeteoCalls = 0, wttrCalls = 0;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.indexOf('api.open-meteo.com') >= 0) { openMeteoCalls++; return makeRes(429, '{"error":true}', { 'retry-after': '0.2' }); }
    if (u.indexOf('wttr.in') >= 0) { wttrCalls++; return makeRes(200, WTTR_J1); }
    throw new Error('unexpected url: ' + u);
  };
  try {
    weather.WEATHER_CACHE.clear();
    const data1 = await weather.queryWeatherData('上海');
    assert.equal(data1.city, '上海', '备源成功必须返回城市');
    assert.equal(data1.condition, '晴天', 'wttr weatherCode 0 必须映射为中文');
    assert.equal(data1.temperature_c, 21);
    assert.ok(openMeteoCalls >= 3, '主源必须先重试满 3 次');
    assert.ok(wttrCalls >= 1, '主源全败后必须调用备源');
    const totalAfterFirst = openMeteoCalls + wttrCalls;
    const data2 = await weather.queryWeatherData('上海');
    assert.equal(data2.temperature_c, 21);
    assert.equal(openMeteoCalls + wttrCalls, totalAfterFirst, '第二次查询必须命中缓存，不再外发任何请求');
  } finally {
    global.fetch = REAL_FETCH;
    weather.WEATHER_CACHE.clear();
  }
});

test('行为：主备源全败 → 抛 upstream_failed 且透出主源状态码', async () => {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.indexOf('api.open-meteo.com') >= 0) return makeRes(429, '', { 'retry-after': '0.1' });
    if (u.indexOf('wttr.in') >= 0) return makeRes(503, 'overloaded');
    throw new Error('unexpected url: ' + u);
  };
  try {
    weather.WEATHER_CACHE.clear();
    await assert.rejects(
      () => weather.queryWeatherData('上海'),
      (e) => e && e.reason === 'upstream_failed' && e.upstream_status === 429,
      '全败必须抛 upstream_failed 并携带 open-meteo 的 429 状态码'
    );
  } finally {
    global.fetch = REAL_FETCH;
    weather.WEATHER_CACHE.clear();
  }
});

test('行为：缓存 TTL 过期后重新外发（不会永远吃旧数据）', async () => {
  let calls = 0;
  global.fetch = async (url) => {
    calls++;
    if (String(url).indexOf('wttr.in') >= 0) return makeRes(200, WTTR_J1);
    return makeRes(429, '', { 'retry-after': '0.1' });
  };
  try {
    weather.WEATHER_CACHE.clear();
    await weather.queryWeatherData('上海');
    const after1 = calls;
    // 直接把缓存条目改成已过期，模拟 10 分钟 TTL 流逝
    for (const [k, v] of weather.WEATHER_CACHE) v.expiresAt = Date.now() - 1;
    await weather.queryWeatherData('上海');
    assert.ok(calls > after1, '缓存过期后必须重新请求上游');
  } finally {
    global.fetch = REAL_FETCH;
    weather.WEATHER_CACHE.clear();
  }
});
