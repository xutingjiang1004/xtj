'use strict';

// Shared by the browser, Node API and the embedded Cloudflare login Worker.
function createIpLocationTools(cityData = []) {
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
Object.assign(IP_GEO_ZH_MAP, {"people's republic of china":'中国',prc:'中国','united states of america':'美国',
  'republic of korea':'韩国','russian federation':'俄罗斯','nei mongol':'内蒙古',neimenggu:'内蒙古',xizang:'西藏'});

function normalizeIpAddress(value) {
  let ip = typeof value === 'string' ? value.trim() : '';
  if (!ip || ip.includes(',')) return '';
  const bracketed = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) ip = bracketed[1];
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return ip.split('.').every(part => Number(part) <= 255 && String(Number(part)) === part) ? ip : '';
  }
  if (!ip.includes(':') || !/^[a-f\d:.]+(?:%[\w.-]+)?$/i.test(ip)) return '';
  try { ip = new URL('http://[' + ip.split('%')[0] + ']/').hostname.slice(1, -1).toLowerCase(); }
  catch (_) { return ''; }
  const mapped = ip.match(/^::ffff:([a-f\d]+):([a-f\d]+)$/);
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return ip;
}
function isIP(value) {
  if (typeof value !== 'string' || /[\[\],]/.test(value) || /^\d+\.\d+\.\d+\.\d+:/.test(value)) return 0;
  return normalizeIpAddress(value) ? value.includes(':') ? 6 : 4 : 0;
}
function addressBytes(value) {
  const address = normalizeIpAddress(value);
  if (!address) return [];
  if (!address.includes(':')) return address.split('.').map(Number);
  const halves = address.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const words = halves.length > 1 ? [...left, ...Array(8-left.length-right.length).fill('0'), ...right] : left;
  return words.flatMap(word => {const n = parseInt(word,16);return [n >> 8,n & 255];});
}
const unavailableRanges = [
  '0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16',
  '172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.168.0.0/16',
  '198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/3',
  '::/96','100::/64','64:ff9b:1::/48','2001:2::/48','2001:db8::/32',
  '2001:10::/28','2001:20::/28','3fff::/20','5f00::/16','fc00::/7',
  'fe80::/10','fec0::/10','ff00::/8','2a06:98c0:3600::103/128'
].map(cidr => {const [address,bits] = cidr.split('/');return {bytes:addressBytes(address),bits:Number(bits)};});
function isPublicIpAddress(value) {
  const bytes = addressBytes(value);
  if (!bytes.length) return false;
  return !unavailableRanges.some(range => range.bytes.length === bytes.length && range.bytes.every((byte,index) => {
    const bits = Math.min(8,Math.max(0,range.bits-index*8));
    return bits === 0 || (byte >> (8-bits)) === (bytes[index] >> (8-bits));
  }));
}
function cloudflareClientIp(request) {
  const connecting = normalizeIpAddress(request.headers.get('cf-connecting-ip') || '');
  let ip = connecting;
  // In Overwrite Headers mode Cloudflare preserves the real IPv6 in this
  // platform header while replacing CF-Connecting-IP with a Class E hash.
  if (/^24\d\.|^25[0-5]\./.test(connecting)) {
    const ipv6 = normalizeIpAddress(request.headers.get('cf-connecting-ipv6') || '');
    ip = ipv6.includes(':') ? ipv6 : '';
  }
  return isPublicIpAddress(ip) ? ip : '';
}

function normalizeIpGeoName(value) {
  const name = typeof value === 'string' ? value.trim().slice(0, 100) : '';
  if (!name) return '';
  if (/[\u4e00-\u9fff]/.test(name)) return name.replace(/(?:特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)$/, '');
  const raw = name.toLowerCase();
  const key = raw.replace(/\s*(?:sheng|province|shi|city|municipality|zizhiqu|autonomous region|prefecture)$/, '').replace(/\s+/g, ' ').trim();
  return Object.hasOwn(IP_GEO_ZH_MAP, key) ? IP_GEO_ZH_MAP[key] : Object.hasOwn(IP_GEO_ZH_MAP, raw) ? IP_GEO_ZH_MAP[raw] : name;
}

function normalizeCountry(value) {
  const name = normalizeIpGeoName(value);
  if (/^(?:XX|ZZ|T1|A1|A2)$/i.test(name)) return '';
  if (!/^[a-z]{2}$/i.test(name)) return name;
  const codes = {CN:'中国',US:'美国',JP:'日本',KR:'韩国',SG:'新加坡',GB:'英国',DE:'德国',FR:'法国',CA:'加拿大',AU:'澳大利亚',RU:'俄罗斯',IN:'印度',BR:'巴西',TH:'泰国',VN:'越南',MY:'马来西亚',ID:'印度尼西亚',PH:'菲律宾',IT:'意大利',ES:'西班牙',NL:'荷兰',CH:'瑞士',AE:'阿联酋',NZ:'新西兰',HK:'香港',MO:'澳门',TW:'台湾'};
  if (Object.hasOwn(codes,name.toUpperCase())) return codes[name.toUpperCase()];
  try { return new Intl.DisplayNames(['zh-CN'], {type:'region'}).of(name.toUpperCase()) || ''; }
  catch (_) { return ''; }
}

const CHINA_REGIONS = new Set(['北京','天津','河北','山西','内蒙古','辽宁','吉林','黑龙江','上海','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','广西','海南','重庆','四川','贵州','云南','西藏','陕西','甘肃','青海','宁夏','新疆','台湾','香港','澳门']);
const MUNICIPAL_REGIONS = new Set(['北京','上海','天津','重庆','香港','澳门']);
// These romanizations identify different cities in different provinces. Never
// choose one using the flat display-name dictionary or a missing province.
const AMBIGUOUS_CITIES = {
  suzhou: {江苏:'苏州', 安徽:'宿州'}, fuzhou: {福建:'福州', 江西:'抚州'},
  taizhou: {江苏:'泰州', 浙江:'台州'}, yichun: {江西:'宜春', 黑龙江:'伊春'},
  yulin: {广西:'玉林', 陕西:'榆林'}
};
const CHINA_CITY_REGIONS = {
  杭州:'浙江',宁波:'浙江',温州:'浙江',台州:'浙江',深圳:'广东',广州:'广东',东莞:'广东',佛山:'广东',
  南京:'江苏',苏州:'江苏',无锡:'江苏',泰州:'江苏',宿州:'安徽',合肥:'安徽',成都:'四川',武汉:'湖北',
  西安:'陕西',榆林:'陕西',长沙:'湖南',郑州:'河南',青岛:'山东',济南:'山东',大连:'辽宁',沈阳:'辽宁',
  哈尔滨:'黑龙江',伊春:'黑龙江',长春:'吉林',吉林:'吉林',石家庄:'河北',太原:'山西',南昌:'江西',
  抚州:'江西',宜春:'江西',福州:'福建',厦门:'福建',昆明:'云南',南宁:'广西',玉林:'广西',贵阳:'贵州',
  兰州:'甘肃',乌鲁木齐:'新疆',拉萨:'西藏',海口:'海南'
};
const cityAliases = new Map();
const citiesByCode = new Map(), regionsByCode = new Map([['11','北京'],['12','天津'],['31','上海'],['50','重庆'],['71','台湾'],['81','香港'],['82','澳门']]);
for (const [region,city,aliases,code] of cityData) {
  CHINA_CITY_REGIONS[city] = region;
  if (code) {citiesByCode.set(code,city);regionsByCode.set(code.slice(0,2),region);}
  for (const alias of aliases) {
    if (!cityAliases.has(alias)) cityAliases.set(alias,new Map());
    cityAliases.get(alias).set(region,city);
  }
}

function cleanCity(value, region, country = '中国') {
  const raw = typeof value === 'string' ? value.trim().toLowerCase().replace(/\s*(?:shi|city|prefecture)$/, '').trim().normalize('NFD').replace(/[\u0300-\u036f'’\s_-]/g,'') : '';
  let city = normalizeIpGeoName(value);
  if (country === '中国') {
    if (cityAliases.has(raw)) {
      const choices = cityAliases.get(raw);
      city = choices.get(region) || (!region && choices.size === 1 ? choices.values().next().value : '');
    }
    if (Object.hasOwn(AMBIGUOUS_CITIES, raw)) {
      const choices = AMBIGUOUS_CITIES[raw];
      city = Object.hasOwn(choices, region) ? choices[region] : '';
    }
    if (region && Object.hasOwn(CHINA_CITY_REGIONS, city) && CHINA_CITY_REGIONS[city] !== region) return '';
    if (city === region && (MUNICIPAL_REGIONS.has(region) || city !== '吉林')) return '';
  }
  return /^(?:全省|全市|未知|局域网|(?:省|自治区)直辖县级行政区划|市辖区|市辖县|其他|unknown|null|none|n\/a)$/i.test(city) ? '' : city;
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
  const provinceCode = String(row.proCode || '');
  if (/^\d{6}$/.test(provinceCode) && regionsByCode.has(provinceCode.slice(0,2)) && regionsByCode.get(provinceCode.slice(0,2)) !== region) return null;
  const codesConflict = /^\d{6}$/.test(row.proCode) && /^\d{6}$/.test(row.cityCode) && String(row.proCode).slice(0, 2) !== String(row.cityCode).slice(0, 2);
  const cityCode = String(row.cityCode || '');
  const codedCity = /^\d{6}$/.test(cityCode) ? citiesByCode.get(cityCode.slice(0,4)+'00') : '';
  let city = codesConflict ? '' : cleanCity(row.city, region);
  if (codedCity && city && city !== codedCity) city = '';
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
  }).map(row => {
    const country = normalizeCountry(row.country), region = normalizeIpGeoName(row.region);
    const invalidRegion = country === '中国' && region && !CHINA_REGIONS.has(region);
    const city = invalidRegion ? '' : cleanCity(row.city,region,country);
    return {...row,country,region:invalidRegion?'':region,city,
      raw_region:invalidRegion?String(row.region).slice(0,100):undefined,
      raw_city:row.city && !city?String(row.city).slice(0,100):undefined};
  });
  const country = majority(rows, 'country');
  if (!country.value) return null;
  const region = majority(country.rows, 'region');
  // A missing province is an abstention, not evidence that can overrule a
  // province tie and manufacture a corroborated city below that conflict.
  const regionRows = region.value ? region.rows : region.conflict ? [] : country.rows.filter(row => !row.region);
  const city = majority(regionRows, 'city');
  const cityValue = city.value;
  const evidence = cityValue ? city.rows : region.value ? region.rows : country.rows;
  const providers = evidence.map(row => row.provider).sort();
  const base = evidence[0] || {};
  return {
    source_ip: ip, country: country.value, region: region.value, city: cityValue,
    text: [country.value, region.value, country.value === '中国' && cityValue === '吉林' && region.value === '吉林' ? '吉林市' : cityValue]
      .filter((value,index,all)=>value && all.indexOf(value) === index).join(' · '),
    provider: providers.join('+'), providers, resolved_at: new Date(now).toISOString(),
    precision: cityValue ? 'approximate_city' : region.value ? 'region' : 'country',
    city_confidence: cityValue ? (city.rows.length > 1 ? 'corroborated' : 'single_source') : (city.conflict || region.conflict ? 'conflict' : 'unavailable'),
    region_confidence: region.value ? (region.rows.length > 1 ? 'corroborated' : 'single_source') : region.conflict ? 'conflict' : 'unavailable',
    has_conflict: country.conflict || region.conflict || city.conflict,
    // Bounded normalized evidence lets an administrator inspect disagreement.
    sources: rows.map(({provider, country, region, city, raw_region, raw_city}) => ({provider, country, region, city,...(raw_region?{raw_region}:{}),...(raw_city?{raw_city}:{})})),
    asn: String(base.asn || '').slice(0, 64), isp: String(base.isp || '').slice(0, 200), org: String(base.org || '').slice(0, 200), timezone: String(base.timezone || '').slice(0, 80),
    country_code: String(base.country_code || (country.value === '中国' ? 'CN' : '')).slice(0, 8),
    is_mobile: !!base.is_mobile, is_proxy: !!base.is_proxy, is_hosting: !!base.is_hosting,
    is_vpn: !!base.is_vpn, is_tor: !!base.is_tor,
    latitude: Number.isFinite(base.latitude) && Math.abs(base.latitude) <= 90 ? base.latitude : null,
    longitude: Number.isFinite(base.longitude) && Math.abs(base.longitude) <= 180 ? base.longitude : null, postal: String(base.postal || '').slice(0, 32)
  };
}
function cloudflareLocation(request, ip, now = Date.now()) {
  if (!ip || cloudflareClientIp(request) !== normalizeIpAddress(ip)) return null;
  const cf = request.cf;
  if (!cf || typeof cf !== 'object' || !cf.country) return null;
  const country = normalizeCountry(cf.country);
  if (!country) return null;
  const codes = {BJ:'北京',TJ:'天津',HE:'河北',SX:'山西',NM:'内蒙古',LN:'辽宁',JL:'吉林',HL:'黑龙江',SH:'上海',JS:'江苏',ZJ:'浙江',AH:'安徽',FJ:'福建',JX:'江西',SD:'山东',HA:'河南',HB:'湖北',HN:'湖南',GD:'广东',GX:'广西',HI:'海南',CQ:'重庆',SC:'四川',GZ:'贵州',YN:'云南',XZ:'西藏',SN:'陕西',GS:'甘肃',QH:'青海',NX:'宁夏',XJ:'新疆',TW:'台湾',HK:'香港',MO:'澳门'};
  let region = normalizeIpGeoName(cf.region);
  let conflict = false;
  if (country === '中国') {
    const code = String(cf.regionCode || '').toUpperCase().replace(/^CN-/, '');
    const coded = Object.hasOwn(codes, code) ? codes[code] : '';
    conflict = !!(coded && CHINA_REGIONS.has(region) && coded !== region);
    region = conflict ? '' : CHINA_REGIONS.has(region) ? region : coded;
  }
  const location = selectIpLocation([{provider:'cloudflare',country,region,city:conflict ? '' : cf.city || '',asn:cf.asn,org:cf.asOrganization,country_code:cf.country}],ip,now);
  if (location && conflict) Object.assign(location,{has_conflict:true,city_confidence:'conflict',region_confidence:'conflict'});
  return location;
}

function locationForIp(location, ip, boundIp) {
  const current = normalizeIpAddress(ip);
  if (!current || !location || (typeof location !== 'string' && (typeof location !== 'object' || Array.isArray(location)))) return null;
  if (typeof location === 'string' ? !location.trim() : !(location.text || location.country || location.region || location.city)
    || ['gps','precise','geolocation'].includes(location.source) || location.precision === 'precise') return null;
  const source = typeof location === 'object' && location.source_ip;
  if (source && normalizeIpAddress(source) !== current) return null;
  if (boundIp && normalizeIpAddress(boundIp) !== current) return null;
  if (!source && !normalizeIpAddress(boundIp)) return null;
  return location;
}
function ipSnapshot(info = {}, event = {}, preferEvent = false) {
  info = info || {}; event = event || {};
  const infoAt = Date.parse(info.last_login) || 0;
  const eventAt = Date.parse(event.recorded_at || event.created_at || event.login_at) || 0;
  const fromEvent = !!event.ip && (preferEvent || !info.last_ip || eventAt > infoAt);
  const ip = normalizeIpAddress(fromEvent ? event.ip : info.last_ip);
  const saved = locationForIp(info.last_ip_location, ip, info.last_ip_location_ip);
  const historical = locationForIp(event.ip_location, ip, event.ip);
  const bound = info.last_auth_event_id && event.id && String(info.last_auth_event_id) === String(event.id);
  const location = fromEvent ? historical || (bound || infoAt >= eventAt ? saved : null)
    : saved || (bound || (!info.last_auth_event_id && (!infoAt || eventAt >= infoAt)) ? historical : null);
  return {ip, location, at:fromEvent ? event.recorded_at || event.created_at || event.login_at || null : info.last_login || null,
    source:fromEvent ? 'login_event' : 'user_info'};
}
function isAuthenticationEvent(event) {
  return !!event && ((event.authority === 'server_authentication' && event.method === 'password'
    && ['login_success','register_success'].includes(event.source)) || (event.source === 'admin_login' && event.is_admin === true));
}
function userInfoSnapshot(info = {}, registeredAt = null) {
  info = info || {};
  const snapshot = ipSnapshot(info);
  return {reg_time:registeredAt || info.reg_time || null,last_login:info.last_login || null,
    last_ip:snapshot.ip || null,last_ip_location:snapshot.location,
    last_ip_location_ip:snapshot.location ? snapshot.ip : null,last_auth_event_id:info.last_auth_event_id || null,
    email:typeof info.email === 'string' ? info.email.slice(0,254) : ''};
}
function postIpView(post = {}) {
  const meta = post._contentMeta && typeof post._contentMeta === 'object' ? post._contentMeta : {};
  const keys = ['ip_region_status','ip_region_text','ip_province','ip_city','ip_lookup_started_at'];
  // Presence of authoritative columns, including explicit null, defeats cached
  // content metadata. A stale city must not resurrect a failed or pending row.
  const authoritative = keys.some(key => Object.hasOwn(post, key));
  if (!authoritative) return {status:'unverified',text:keys.some(key=>meta[key])?'历史未核对':''};
  const source = authoritative ? post : meta;
  const status = String(source.ip_region_status || '').trim();
  if (status === 'pending') return {status, text:'解析中'};
  if (status === 'failed') return {status, text:'未知'};
  const province = normalizeIpGeoName(source.ip_province);
  if (province && !CHINA_REGIONS.has(province) && (Object.hasOwn(CHINA_CITY_REGIONS,province) || cityAliases.has(province.toLowerCase()))) return {status,text:'未知'};
  let text = province || String(source.ip_region_text || '').trim();
  if (!text) return {status, text:status === 'resolved' || source.ip_lookup_started_at ? '未知' : ''};
  // Public labels retain province/country only, even for legacy city-only text.
  const chinaText = text.replace(/^(?:中国|China)\s*[·|,，]?\s*/i, '');
  const match = chinaText.match(/^(北京市?|天津市?|上海市?|重庆市?|河北省?|山西省?|辽宁省?|吉林省?|黑龙江省?|江苏省?|浙江省?|安徽省?|福建省?|江西省?|山东省?|河南省?|湖北省?|湖南省?|广东省?|海南省?|四川省?|贵州省?|云南省?|陕西省?|甘肃省?|青海省?|台湾省?|内蒙古(?:自治区)?|广西(?:壮族自治区)?|西藏(?:自治区)?|宁夏(?:回族自治区)?|新疆(?:维吾尔自治区)?|香港(?:特别行政区)?|澳门(?:特别行政区)?)/);
  if (match) text = normalizeIpGeoName(match[1]);
  else if (!province) {
    const parts = text.split(/\s*[·|,，]\s*/).filter(Boolean);
    if (/^(?:中国|China)$/i.test(parts[0] || '')) text = CHINA_REGIONS.has(normalizeIpGeoName(parts[1])) ? normalizeIpGeoName(parts[1]) : '中国';
    else {
      const coarse = normalizeIpGeoName(parts[0]);
      const englishProvince = normalizeIpGeoName(text.split(/\s+/)[0]);
      const countries = ['中国','美国','日本','韩国','新加坡','英国','德国','法国','加拿大','澳大利亚','俄罗斯','印度','巴西','泰国','越南','马来西亚','印度尼西亚','菲律宾','意大利','西班牙','荷兰','瑞士','阿联酋','新西兰'];
      text = CHINA_REGIONS.has(englishProvince) ? englishProvince : countries.includes(coarse) ? coarse : '未知';
    }
  }
  return {status, text};
}
return {normalizeIpAddress, isPublicIpAddress, cloudflareClientIp, cloudflareLocation, normalizeIpGeoName, normalizeIpCity:cleanCity, parseBaiduGeoPayload, parsePconlineGeoText, selectIpLocation, locationForIp, ipSnapshot, userInfoSnapshot, postIpView, isAuthenticationEvent};
}

if (typeof module !== 'undefined' && module.exports) module.exports = {createIpLocationTools, ...createIpLocationTools(require('./ip-city-data'))};
else globalThis.XtjIpLocation = createIpLocationTools(globalThis.XtjIpCityData);
