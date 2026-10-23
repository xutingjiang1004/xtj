'use strict';

const {normalizeIpAddress, normalizeIpGeoName, parseBaiduGeoPayload, parsePconlineGeoText, selectIpLocation} = require('../js/ip-location');
const {isIP} = require('node:net');
function matchesAddress(value, expectedIp) {
  return value == null || value === '' || !expectedIp || (typeof value === 'string' && isIP(value.trim()) && normalizeIpAddress(value) === normalizeIpAddress(expectedIp));
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
  async function uncached(ip, isCurrent) {
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
    if (isCurrent()) boundedSet(diagnostics, ip, entries);
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
    entry.promise = uncached(ip, () => ipLocationInflight.get(ip) === entry).then(result => {
      if (ipLocationInflight.get(ip) === entry) boundedSet(ipLocationCache, ip, {value: result, expires_at: now() + locationCacheTtl(result)});
      return result;
    }).finally(() => { if (ipLocationInflight.get(ip) === entry) ipLocationInflight.delete(ip); });
    ipLocationInflight.set(ip, entry);
    return entry.promise;
  }
  return {resolve, getDiagnostics: value => diagnostics.get(normalizeIpAddress(value)) || []};
}

module.exports = { normalizeIpAddress, normalizeIpGeoName, parseBaiduGeoPayload, parsePconlineGeoText, selectIpLocation, locationCacheTtl, createIpGeocoder };
