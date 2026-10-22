'use strict';

const { isIP } = require('node:net');

var IP_GEO_ZH_MAP = {
  // 省级行政区（含港澳台）
  'beijing': '北京', 'shanghai': '上海', 'tianjin': '天津', 'chongqing': '重庆',
  'hebei': '河北', 'shanxi': '山西', 'liaoning': '辽宁', 'jilin': '吉林',
  'heilongjiang': '黑龙江', 'jiangsu': '江苏', 'zhejiang': '浙江', 'anhui': '安徽',
  'fujian': '福建', 'jiangxi': '江西', 'shandong': '山东', 'henan': '河南',
  'hubei': '湖北', 'hunan': '湖南', 'guangdong': '广东', 'hainan': '海南',
  'sichuan': '四川', 'guizhou': '贵州', 'yunnan': '云南', 'shaanxi': '陕西',
  'gansu': '甘肃', 'qinghai': '青海', 'taiwan': '台湾', 'inner mongolia': '内蒙古',
  'guangxi': '广西', 'guangxi zhuang': '广西', 'tibet': '西藏', 'ningxia': '宁夏',
  'ningxia hui': '宁夏', 'xinjiang': '新疆', 'xinjiang uygur': '新疆',
  'hong kong': '香港', 'macau': '澳门', 'macao': '澳门',
  // 常见城市
  'hangzhou': '杭州', 'ningbo': '宁波', 'wenzhou': '温州', 'shenzhen': '深圳',
  'guangzhou': '广州', 'dongguan': '东莞', 'foshan': '佛山', 'nanjing': '南京',
  'suzhou': '苏州', 'wuxi': '无锡', 'chengdu': '成都', 'wuhan': '武汉',
  'xian': '西安', 'changsha': '长沙', 'zhengzhou': '郑州', 'qingdao': '青岛',
  'jinan': '济南', 'dalian': '大连', 'shenyang': '沈阳', 'harbin': '哈尔滨',
  'changchun': '长春', 'shijiazhuang': '石家庄', 'taiyuan': '太原', 'hefei': '合肥',
  'nanchang': '南昌', 'fuzhou': '福州', 'xiamen': '厦门', 'kunming': '昆明',
  'nanning': '南宁', 'guiyang': '贵阳', 'lanzhou': '兰州', 'urumqi': '乌鲁木齐',
  'lasa': '拉萨', 'haikou': '海口',
  // 国家（海外 IP 属地展示用）
  'china': '中国', 'united states': '美国', 'japan': '日本', 'south korea': '韩国',
  'korea': '韩国', 'singapore': '新加坡', 'united kingdom': '英国', 'germany': '德国',
  'france': '法国', 'canada': '加拿大', 'australia': '澳大利亚', 'russia': '俄罗斯',
  'india': '印度', 'brazil': '巴西', 'thailand': '泰国', 'vietnam': '越南',
  'malaysia': '马来西亚', 'indonesia': '印度尼西亚', 'philippines': '菲律宾',
  'italy': '意大利', 'spain': '西班牙', 'netherlands': '荷兰', 'switzerland': '瑞士',
  'united arab emirates': '阿联酋', 'new zealand': '新西兰'
};

function normalizeIpAddress(value) {
  let ip = String(value || '').trim().split(',')[0].trim();
  const bracketed = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) ip = bracketed[1];
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6) return '';
  // Node accepts IPv6 scope IDs, while WHATWG URL deliberately rejects them.
  // Normalize the address bytes before URL canonicalization; the public-IP
  // classifier still rejects the resulting link-local/private address.
  ip = ip.split('%')[0];
  ip = new URL('http://[' + ip + ']/').hostname.slice(1, -1).toLowerCase();
  const mapped = ip.match(/^::ffff:([a-f\d]+):([a-f\d]+)$/);
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return ip;
}

function normalizeIpGeoName(value) {
  const name = typeof value === 'string' ? value.trim().slice(0, 100) : '';
  if (!name) return '';
  if (/[\u4e00-\u9fff]/.test(name)) return name.replace(/(?:特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)$/, '');
  const raw = name.toLowerCase();
  const key = raw.replace(/\s*(?:sheng|province|shi|city|municipality|zizhiqu|autonomous region|prefecture)$/, '').replace(/\s+/g, ' ').trim();
  return Object.hasOwn(IP_GEO_ZH_MAP, key) ? IP_GEO_ZH_MAP[key] : Object.hasOwn(IP_GEO_ZH_MAP, raw) ? IP_GEO_ZH_MAP[raw] : name;
}

const CHINA_REGIONS = new Set(['北京','天津','河北','山西','内蒙古','辽宁','吉林','黑龙江','上海','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','广西','海南','重庆','四川','贵州','云南','西藏','陕西','甘肃','青海','宁夏','新疆','台湾','香港','澳门']);

function cleanCity(value, region) {
  const city = normalizeIpGeoName(value);
  return city === region || /^(?:全省|全市|未知|局域网|省直辖县级行政区划|市辖区|市辖县|其他|unknown)$/i.test(city) ? '' : city;
}

function matchesAddress(value, expectedIp) {
  return value == null || value === '' || !expectedIp || (typeof value === 'string' && isIP(value.trim()) && normalizeIpAddress(value) === normalizeIpAddress(expectedIp));
}

function parseBaiduGeoPayload(data, expectedIp) {
  if (!data || String(data.status) !== '0' || !Array.isArray(data.data)) return null;
  const row = data.data[0];
  if (!row || ['OriginQuery', 'origip', 'origipquery', 'query'].some(key => !matchesAddress(row[key], expectedIp))) return null;
  const location = String(row.location || '').trim();
  // Match administrative units, not an arbitrary remainder containing an ISP
  // or district. Some payloads prefix the location with 中国 or omit spaces.
  const main = location.replace(/^中国\s*/, '');
  const match = main.match(/^(北京市|上海市|天津市|重庆市|内蒙古自治区|广西壮族自治区|宁夏回族自治区|新疆维吾尔自治区|西藏自治区|香港特别行政区|澳门特别行政区|[^\s省市]{2,5}省)\s*(.*)$/);
  if (!match) return null;
  const region = normalizeIpGeoName(match[1]);
  if (!CHINA_REGIONS.has(region)) return null;
  const cityMatch = match[2].match(/^([^\s]{1,16}?(?:自治州|地区|市|盟))/);
  return { region, city: cleanCity(cityMatch && cityMatch[1] || '', region), addr: location.slice(0, 100) };
}

function parsePconlineGeoText(text, expectedIp) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  let row;
  try { row = JSON.parse(match[0]); } catch (_) { return null; }
  if (!row || typeof row !== 'object' || Array.isArray(row) || !matchesAddress(row.ip, expectedIp) || (row.err && String(row.err) !== '0')) return null;
  const region = normalizeIpGeoName(row.pro);
  // This endpoint also returns foreign countries in `pro`. They must not be
  // reinterpreted as a Chinese province merely because the provider is Chinese.
  if (!CHINA_REGIONS.has(region)) return null;
  const codesConflict = /^\d{6}$/.test(row.proCode) && /^\d{6}$/.test(row.cityCode) && String(row.proCode).slice(0, 2) !== String(row.cityCode).slice(0, 2);
  const city = codesConflict ? '' : cleanCity(row.city, region);
  return { region, city, addr: String(row.addr || '').slice(0, 100) };
}

function majority(rows, field) {
  const groups = new Map();
  for (const row of rows) {
    const value = row[field];
    if (!value) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const total = ranked.reduce((sum, entry) => sum + entry[1].length, 0);
  const winner = ranked[0];
  return { value: winner && winner[1].length > total / 2 ? winner[0] : '',
    rows: winner && winner[1].length > total / 2 ? winner[1] : [], conflict: ranked.length > 1 };
}

function selectIpLocation(candidates, ip, now = Date.now()) {
  const seen = new Set();
  const rows = candidates.filter(Boolean).filter(row => {
    if (!row.provider || seen.has(row.provider)) return false;
    seen.add(row.provider); return true;
  }).map(row => ({ ...row, country: normalizeIpGeoName(row.country), region: normalizeIpGeoName(row.region), city: cleanCity(row.city, normalizeIpGeoName(row.region)) }));
  const country = majority(rows, 'country');
  if (!country.value) return null;
  const region = majority(country.rows, 'region');
  const regionRows = region.value ? region.rows : country.rows.filter(row => !row.region);
  const city = majority(regionRows, 'city');
  const cityValue = city.value;
  const evidence = cityValue ? city.rows : region.value ? region.rows : country.rows;
  const providers = evidence.map(row => row.provider).sort();
  const base = evidence[0] || {};
  return {
    source_ip: ip, country: country.value, region: region.value, city: cityValue,
    text: [country.value, region.value, cityValue].filter((value, index, all) => value && all.indexOf(value) === index).join(' · '),
    provider: providers.join('+'), providers, resolved_at: new Date(now).toISOString(),
    precision: cityValue ? 'approximate_city' : region.value ? 'region' : 'country',
    city_confidence: cityValue ? (city.rows.length > 1 ? 'corroborated' : 'single_source') : (city.conflict || region.conflict ? 'conflict' : 'unavailable'),
    region_confidence: region.value ? (region.rows.length > 1 ? 'corroborated' : 'single_source') : region.conflict ? 'conflict' : 'unavailable',
    has_conflict: country.conflict || region.conflict || city.conflict,
    // Bounded normalized evidence lets an administrator inspect disagreement.
    sources: rows.map(({provider, country, region, city}) => ({provider, country, region, city})),
    asn: String(base.asn || '').slice(0, 64), isp: String(base.isp || '').slice(0, 200), org: String(base.org || '').slice(0, 200), timezone: String(base.timezone || '').slice(0, 80),
    country_code: String(base.country_code || (country.value === '中国' ? 'CN' : '')).slice(0, 8),
    is_mobile: !!base.is_mobile, is_proxy: !!base.is_proxy, is_hosting: !!base.is_hosting,
    is_vpn: !!base.is_vpn, is_tor: !!base.is_tor,
    latitude: Number.isFinite(base.latitude) ? base.latitude : null,
    longitude: Number.isFinite(base.longitude) ? base.longitude : null, postal: String(base.postal || '').slice(0, 32)
  };
}

function locationCacheTtl(result) {
  if (!result) return 30_000;
  if (result.has_conflict) return 2 * 60_000;
  if (result.city_confidence === 'corroborated') return 60 * 60_000;
  if (result.city_confidence === 'single_source') return 10 * 60_000;
  return 5 * 60_000;
}

function createIpGeocoder({ fetch: fetchImpl = (...args) => fetch(...args), isPrivateOrReservedIp, now = Date.now, domesticTimeoutMs = 1800, overseasTimeoutMs = 2000, cacheMax = 500 } = {}) {
  if (typeof isPrivateOrReservedIp !== 'function') throw new TypeError('public IP classification is required');
  const ipLocationCache = new Map(), ipLocationInflight = new Map(), diagnostics = new Map();

  function boundedSet(map, key, value) {
    map.delete(key);
    if (map.size >= cacheMax) map.delete(map.keys().next().value);
    map.set(key, value);
  }
  async function readText(response, charset) {
    if (!response.body || typeof response.body.getReader !== 'function') {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 65_536) throw Error('payload_too_large');
      return new TextDecoder(charset).decode(buffer);
    }
    const reader = response.body.getReader(), chunks = [];
    let length = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > 65_536) throw Error('payload_too_large');
        chunks.push(part.value);
      }
    } finally { void reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder(charset).decode(bytes);
  }
  async function provider(name, ip, timeoutMs, entries) {
    const controller = new AbortController();
    const diag = {provider: name, resolved_at: new Date(now()).toISOString()};
    let timer;
    const work = async () => {
      const encoded = encodeURIComponent(ip);
      const url = name === 'baidu-opendata' ? 'https://opendata.baidu.com/api.php?query=' + encoded + '&co=&resource_id=6006&oe=utf8'
        : name === 'pconline' ? 'https://whois.pconline.com.cn/ipJson.jsp?ip=' + encoded + '&json=true'
        : name === 'ipwho.is' ? 'https://ipwho.is/' + encoded + '?lang=zh-CN'
        : 'https://ipapi.co/' + encoded + '/json/';
      const response = await fetchImpl(url, {signal: controller.signal, redirect: 'error'});
      diag.http_status = response.status;
      if (!response.ok) throw Error('http_' + response.status);
      const charset = name === 'pconline' && !/charset\s*=\s*["']?utf-?8/i.test(response.headers && response.headers.get('content-type') || '') ? 'gbk' : 'utf-8';
      const text = await readText(response, charset);
      if (name === 'baidu-opendata' || name === 'pconline') {
        const parsed = name === 'baidu-opendata' ? parseBaiduGeoPayload(JSON.parse(text), ip) : parsePconlineGeoText(text, ip);
        if (!parsed) throw Error('invalid_payload');
        return {provider: name, country: '中国', region: parsed.region, city: parsed.city, isp: parsed.addr};
      }
      const data = JSON.parse(text);
      if (!data || Array.isArray(data) || !matchesAddress(data.ip, ip) || data.error || (name === 'ipwho.is' && data.success !== true)) throw Error('invalid_payload');
      const country = data.country_name || data.country || (data.country_code === 'CN' ? '中国' : '');
      if (!country) throw Error('invalid_payload');
      return {provider: name, country, region: data.region || '', city: data.city || '', country_code: data.country_code || '',
        asn: data.asn || data.connection && data.connection.asn || '', isp: data.org || data.connection && data.connection.isp || '',
        org: data.org || data.connection && data.connection.org || '', latitude: data.latitude, longitude: data.longitude,
        postal: data.postal || '', timezone: typeof data.timezone === 'string' ? data.timezone : data.timezone && data.timezone.id || '',
        is_proxy: !!(data.security && (data.security.proxy || data.security.vpn || data.security.tor)),
        is_hosting: !!(data.security && data.security.hosting), is_vpn: !!(data.security && data.security.vpn), is_tor: !!(data.security && data.security.tor)};
    };
    try {
      // The deadline includes reading the body and still settles if a transport
      // ignores abort. A slow provider cannot determine the winning city.
      const result = await Promise.race([work(), new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(Error('timeout')); }, timeoutMs);
      })]);
      diag.response_schema_valid = true;
      return result;
    } catch (error) {
      diag.error_code = controller.signal.aborted ? 'timeout' : /^(?:http_\d+|payload_too_large|invalid_payload)$/.test(error.message) ? error.message : 'provider_unavailable';
      return null;
    } finally { clearTimeout(timer); controller.abort(); entries.push(diag); }
  }
  async function uncached(ip) {
    const entries = [];
    const domestic = await Promise.all(['baidu-opendata','pconline'].map(name => provider(name, ip, domesticTimeoutMs, entries)));
    let result = selectIpLocation(domestic, ip, now());
    const municipal = result && ['北京','上海','天津','重庆','香港','澳门'].includes(result.region);
    // Both domestic answers are collected. A province-only fast answer cannot
    // prevent a slower city answer, and disagreement gets additional evidence.
    if (!result || result.has_conflict || (result.city_confidence !== 'corroborated' && !(municipal && domestic.every(Boolean)))) {
      const overseas = await Promise.all(['ipwho.is','ipapi.co'].map(name => provider(name, ip, overseasTimeoutMs, entries)));
      result = selectIpLocation([...domestic, ...overseas], ip, now());
    }
    boundedSet(diagnostics, ip, entries);
    return result;
  }
  function resolve(value, options = {}) {
    const ip = normalizeIpAddress(value);
    if (!ip || isPrivateOrReservedIp(ip)) return Promise.resolve(null);
    const active = ipLocationInflight.get(ip);
    if (options.forceRefresh) {
      ipLocationCache.delete(ip);
      if (active && active.forced) return active.promise;
    } else {
      const cached = ipLocationCache.get(ip);
      if (cached && cached.expires_at > now()) return Promise.resolve(cached.value);
      if (cached) ipLocationCache.delete(ip);
      if (active) return active.promise;
    }
    const entry = {forced: !!options.forceRefresh};
    entry.promise = uncached(ip).then(result => {
      if (ipLocationInflight.get(ip) === entry) boundedSet(ipLocationCache, ip, {value: result, expires_at: now() + locationCacheTtl(result)});
      return result;
    }).finally(() => { if (ipLocationInflight.get(ip) === entry) ipLocationInflight.delete(ip); });
    ipLocationInflight.set(ip, entry);
    return entry.promise;
  }
  return {resolve, getDiagnostics: value => diagnostics.get(normalizeIpAddress(value)) || []};
}

module.exports = { normalizeIpAddress, normalizeIpGeoName, parseBaiduGeoPayload, parsePconlineGeoText, selectIpLocation, locationCacheTtl, createIpGeocoder };
