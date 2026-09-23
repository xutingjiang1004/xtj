/** Open-Meteo free weather lookup (no API key). */
'use strict';

// Open-Meteo 免费天气查询（无需 API Key）
// 城市坐标映射 — 常用城市优先命中；未命中时走 geocoding-api 解析任意城市名。
var CITY_COORDS = {
  '北京': { lat: 39.9042, lon: 116.4074 },
  '上海': { lat: 31.2304, lon: 121.4737 },
  '广州': { lat: 23.1291, lon: 113.2644 },
  '深圳': { lat: 22.5431, lon: 114.0579 },
  '杭州': { lat: 30.2741, lon: 120.1551 },
  '湖州': { lat: 30.8932, lon: 120.0963 },
  '安吉': { lat: 30.6249, lon: 119.6766 },
  '南京': { lat: 32.0603, lon: 118.7969 },
  '苏州': { lat: 31.2989, lon: 120.5853 },
  '成都': { lat: 30.5728, lon: 104.0668 },
  '重庆': { lat: 29.5630, lon: 106.5516 },
  '武汉': { lat: 30.5928, lon: 114.3055 },
  '西安': { lat: 34.3416, lon: 108.9398 },
  '天津': { lat: 39.3434, lon: 117.3616 },
  '青岛': { lat: 36.0671, lon: 120.3826 },
  '厦门': { lat: 24.4798, lon: 118.0894 },
  '长沙': { lat: 28.2282, lon: 112.9388 },
  '郑州': { lat: 34.7466, lon: 113.6254 },
  '合肥': { lat: 31.8206, lon: 117.2272 },
  '福州': { lat: 26.0745, lon: 119.2965 },
  '昆明': { lat: 25.0389, lon: 102.7183 },
  '大连': { lat: 38.9140, lon: 121.6147 },
  '宁波': { lat: 29.8683, lon: 121.5440 },
  '无锡': { lat: 31.4912, lon: 120.3119 },
  '东京': { lat: 35.6762, lon: 139.6503 },
  '大阪': { lat: 34.6937, lon: 135.5023 },
  '首尔': { lat: 37.5665, lon: 126.978 },
  '济州岛': { lat: 33.489, lon: 126.4983 },
  '巴黎': { lat: 48.8566, lon: 2.3522 },
  '伦敦': { lat: 51.5074, lon: -0.1278 },
  '纽约': { lat: 40.7128, lon: -74.006 },
  '新加坡': { lat: 1.3521, lon: 103.8198 },
  '香港': { lat: 22.3193, lon: 114.1694 },
  '台北': { lat: 25.0330, lon: 121.5654 },
  '洛杉矶': { lat: 34.0522, lon: -118.2437 },
  '旧金山': { lat: 37.7749, lon: -122.4194 },
  '悉尼': { lat: -33.8688, lon: 151.2093 },
  '曼谷': { lat: 13.7563, lon: 100.5018 },
  // ★ 2026-09-11 扩充：常见省市与热门旅游城市，减少对 geocoding 网络请求的依赖。
  //   内置命中是 0 延迟且 100% 可靠的路径；每多一个内置城市，
  //   就少一次可能失败的远程解析（此前用户反复遇到"未找到该地点的天气"）。
  '济南': { lat: 36.6512, lon: 117.1201 },
  '沈阳': { lat: 41.8057, lon: 123.4315 },
  '哈尔滨': { lat: 45.8038, lon: 126.5349 },
  '长春': { lat: 43.8171, lon: 125.3235 },
  '石家庄': { lat: 38.0428, lon: 114.5149 },
  '太原': { lat: 37.8706, lon: 112.5489 },
  '南昌': { lat: 28.6820, lon: 115.8579 },
  '贵阳': { lat: 26.6470, lon: 106.6302 },
  '南宁': { lat: 22.8170, lon: 108.3665 },
  '海口': { lat: 20.0444, lon: 110.1999 },
  '三亚': { lat: 18.2528, lon: 109.5119 },
  '兰州': { lat: 36.0611, lon: 103.8343 },
  '西宁': { lat: 36.6171, lon: 101.7782 },
  '银川': { lat: 38.4872, lon: 106.2309 },
  '乌鲁木齐': { lat: 43.8256, lon: 87.6168 },
  '拉萨': { lat: 29.6520, lon: 91.1721 },
  '呼和浩特': { lat: 40.8414, lon: 111.7519 },
  '温州': { lat: 27.9938, lon: 120.6994 },
  '佛山': { lat: 23.0219, lon: 113.1214 },
  '东莞': { lat: 23.0209, lon: 113.7518 },
  '珠海': { lat: 22.2707, lon: 113.5767 },
  '中山': { lat: 22.5170, lon: 113.3927 },
  '惠州': { lat: 23.1115, lon: 114.4152 },
  '泉州': { lat: 24.8741, lon: 118.6757 },
  '烟台': { lat: 37.4638, lon: 121.4479 },
  '威海': { lat: 37.5128, lon: 122.1201 },
  '洛阳': { lat: 34.6197, lon: 112.4540 },
  '徐州': { lat: 34.2058, lon: 117.2848 },
  '常州': { lat: 31.8107, lon: 119.9741 },
  '南通': { lat: 31.9802, lon: 120.8943 },
  '绍兴': { lat: 30.0303, lon: 120.5802 },
  '嘉兴': { lat: 30.7522, lon: 120.7500 },
  '桂林': { lat: 25.2736, lon: 110.2900 },
  '丽江': { lat: 26.8721, lon: 100.2299 },
  '张家界': { lat: 29.1170, lon: 110.4791 },
  '西藏': { lat: 29.6520, lon: 91.1721 },
  '千岛湖': { lat: 29.6050, lon: 119.0420 },
  '乌镇': { lat: 30.7450, lon: 120.4870 },
  '迪拜': { lat: 25.2048, lon: 55.2708 },
  '多伦多': { lat: 43.6532, lon: -79.3832 },
  '温哥华': { lat: 49.2827, lon: -123.1207 },
  '墨尔本': { lat: -37.8136, lon: 144.9631 },
  '柏林': { lat: 52.5200, lon: 13.4050 },
  '罗马': { lat: 41.9028, lon: 12.4964 },
  '米兰': { lat: 45.4642, lon: 9.1900 },
  '马德里': { lat: 40.4168, lon: -3.7038 },
  '巴塞罗那': { lat: 41.3874, lon: 2.1686 },
  '阿姆斯特丹': { lat: 52.3676, lon: 4.9041 },
  '苏黎世': { lat: 47.3769, lon: 8.5417 },
  '莫斯科': { lat: 55.7558, lon: 37.6173 },
  '孟买': { lat: 19.0760, lon: 72.8777 },
  '新德里': { lat: 28.6139, lon: 77.2090 },
  '吉隆坡': { lat: 3.1390, lon: 101.6869 },
  '雅加达': { lat: -6.2088, lon: 106.8456 },
  '马尼拉': { lat: 14.5995, lon: 120.9842 },
  '河内': { lat: 21.0278, lon: 105.8342 },
  '胡志明市': { lat: 10.8231, lon: 106.6297 },
  '釜山': { lat: 35.1796, lon: 129.0756 },
  '名古屋': { lat: 35.1815, lon: 136.9066 },
  '北海道': { lat: 43.0621, lon: 141.3544 },
  '札幌': { lat: 43.0621, lon: 141.3544 },
  '京都': { lat: 35.0116, lon: 135.7681 },
  '冲绳': { lat: 26.2124, lon: 127.6809 }
};

// 英文/拼音别名 → 中文城市名（命中内置坐标）
var CITY_ALIASES = {
  beijing: '北京', shanghai: '上海', guangzhou: '广州', shenzhen: '深圳',
  hangzhou: '杭州', huzhou: '湖州', anji: '安吉', nanjing: '南京',
  suzhou: '苏州', chengdu: '成都', chongqing: '重庆', wuhan: '武汉',
  xian: '西安', "xi'an": '西安', tianjin: '天津', qingdao: '青岛',
  xiamen: '厦门', changsha: '长沙', zhengzhou: '郑州', hefei: '合肥',
  fuzhou: '福州', kunming: '昆明', dalian: '大连', ningbo: '宁波',
  wuxi: '无锡', tokyo: '东京', osaka: '大阪', seoul: '首尔',
  jeju: '济州岛', paris: '巴黎', london: '伦敦', 'new york': '纽约',
  newyork: '纽约', nyc: '纽约', singapore: '新加坡', hongkong: '香港',
  'hong kong': '香港', taipei: '台北', 'los angeles': '洛杉矶', la: '洛杉矶',
  'san francisco': '旧金山', sf: '旧金山', sydney: '悉尼', bangkok: '曼谷',
  // ★ 2026-09-11 扩充：模型常输出的英文/拼音城市名，命中内置表避免远程解析失败
  jinan: '济南', shenyang: '沈阳', harbin: '哈尔滨', changchun: '长春',
  shijiazhuang: '石家庄', taiyuan: '太原', nanchang: '南昌', guiyang: '贵阳',
  nanning: '南宁', haikou: '海口', sanya: '三亚', lanzhou: '兰州',
  xining: '西宁', yinchuan: '银川', urumqi: '乌鲁木齐', lhasa: '拉萨',
  hohhot: '呼和浩特', wenzhou: '温州', foshan: '佛山', dongguan: '东莞',
  zhuhai: '珠海', zhongshan: '中山', huizhou: '惠州', quanzhou: '泉州',
  yantai: '烟台', weihai: '威海', luoyang: '洛阳', xuzhou: '徐州',
  changzhou: '常州', nantong: '南通', shaoxing: '绍兴', jiaxing: '嘉兴',
  guilin: '桂林', lijiang: '丽江', zhangjiajie: '张家界', tibet: '西藏',
  dubai: '迪拜', toronto: '多伦多', vancouver: '温哥华', melbourne: '墨尔本',
  berlin: '柏林', rome: '罗马', milan: '米兰', madrid: '马德里',
  barcelona: '巴塞罗那', amsterdam: '阿姆斯特丹', zurich: '苏黎世',
  moscow: '莫斯科', mumbai: '孟买', 'new delhi': '新德里', delhi: '新德里',
  'kuala lumpur': '吉隆坡', jakarta: '雅加达', manila: '马尼拉',
  hanoi: '河内', 'ho chi minh': '胡志明市', busan: '釜山',
  nagoya: '名古屋', hokkaido: '北海道', sapporo: '札幌', kyoto: '京都',
  okinawa: '冲绳'
};


var WEATHER_CODES = {
  0: '晴天', 1: '大部晴', 2: '多云', 3: '阴天', 45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '中毛毛雨', 55: '大毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨',
  71: '小雪', 73: '中雪', 75: '大雪', 80: '阵雨', 81: '中阵雨', 82: '大阵雨',
  85: '小阵雪', 86: '大阵雪', 95: '雷暴', 96: '雷暴加小冰雹', 99: '雷暴加大冰雹'
};
// 审计 🟢：外部 API 响应大小上限（Open-Meteo 正常 < 100KB，留足余量）
var MAX_WEATHER_RESPONSE_BYTES = 512 * 1024;
var GEOCODE_CACHE = Object.create(null);
var GEOCODE_CACHE_MAX = 80;

// ★ 2026-09-24 修复（线上 get_weather 反复"天气服务暂时不可用"）：
//   Render 共享出口 IP 极易触发 open-meteo 免费档限流（HTTP 429），
//   此前每次提问都实时外发请求，毫无节流 → 偶发限流被放大成持续故障。
//   新增天气结果缓存：同一坐标 10 分钟内直接复用，请求量下降一个数量级，
//   是防限流的治本第一道防线；叠加 wttr.in 备源消除单点。
var WEATHER_CACHE = new Map();
var WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;
var WEATHER_CACHE_MAX = 300;

function formatWeatherText(data) {
  if (!data) return null;
  var result = '【天气工具结果】\n查询时间：' + data.queried_at + '（北京时间）\n地点：' + data.city +
    '\n天气状况：' + data.condition +
    '\n当前温度：' + data.temperature_c + '°C\n湿度：' + data.humidity + '%\n风速：' + data.wind_kmh + 'km/h';
  if (data.high_c !== undefined && data.high_c !== null) result += '\n今日最高：' + data.high_c + '°C';
  if (data.low_c !== undefined && data.low_c !== null) result += '\n今日最低：' + data.low_c + '°C';
  if (data.precip_prob !== undefined && data.precip_prob !== null) result += '\n降雨概率：' + data.precip_prob + '%';
  // ★ 2026-09-22：输出紫外线，避免用户问 UV 时模型被迫去网页里抠
  var uvNow = (data.uv_index !== undefined && data.uv_index !== null) ? data.uv_index : null;
  var uvMax = (data.uv_index_max !== undefined && data.uv_index_max !== null) ? data.uv_index_max : null;
  if (uvNow !== null) {
    var uvDesc = describeUvIndex(uvNow);
    result += '\n当前紫外线指数：' + uvNow + (uvDesc ? '（' + uvDesc + '）' : '');
  }
  if (uvMax !== null) {
    var uvMaxDesc = describeUvIndex(uvMax);
    result += '\n今日紫外线峰值：' + uvMax + (uvMaxDesc ? '（' + uvMaxDesc + '）' : '');
  }
  result += '\n\n要求：必须基于以上工具结果回答，不准编造天气数据。';
  return result;
}

function matchBuiltinCity(query) {
  var q = String(query || '').trim();
  if (!q) return null;
  var lower = q.toLowerCase();
  if (CITY_ALIASES[lower]) {
    var aliasName = CITY_ALIASES[lower];
    return { name: aliasName, coords: CITY_COORDS[aliasName] };
  }
  var cityNames = Object.keys(CITY_COORDS).sort(function(a, b) { return b.length - a.length; });
  for (var i = 0; i < cityNames.length; i++) {
    var cityName = cityNames[i];
    if (q.indexOf(cityName) >= 0) {
      return { name: cityName, coords: CITY_COORDS[cityName] };
    }
  }
  return null;
}

// ★ 2026-09-11 新增：地名清洗与候选生成。
//   模型（以及用户）给出的地名经常带冗余限定，例如：
//     「成都市」「四川成都」「中国成都市武侯区」「北京市朝阳区」「Los Angeles, CA」
//   原实现把整串直接丢给 geocoding API 且 count=1，这类长尾输入常常返回 0 条结果，
//   于是用户反复看到「未找到该地点的天气，请换更具体的城市名再试」——
//   讽刺的是提示让用户"换更具体的"，但问题恰恰出在"太具体"。
//   这里生成由粗到细的候选列表，逐级尝试，显著提升解析成功率。
var ADMIN_SUFFIX_RE = /(特别行政区|自治区|自治州|自治县|地区|盟|市辖区|新区|开发区|街道|办事处|镇|乡|市|区|县|省|州|盟)$/;
// 省级 / 直辖市 / 自治区名（用于"省名+城市名"前缀剥离）
var PROVINCE_NAMES = ['北京', '上海', '天津', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江',
  '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '海南',
  '四川', '贵州', '云南', '陕西', '甘肃', '青海', '台湾', '内蒙古', '广西', '西藏', '宁夏',
  '新疆', '香港', '澳门'];
var PROVINCE_PREFIX_RE = new RegExp('^(' + PROVINCE_NAMES.join('|') + ')');
function buildGeoQueryCandidates(raw) {
  var q = String(raw || '').trim();
  if (!q) return [];
  var out = [];
  function push(v) {
    v = String(v || '').trim();
    // ★ 防御：单字行政名（「省」「市」「区」）无检索价值，直接丢弃。
    if (v.length < 2) return;
    // ★ 防御：以孤立行政后缀开头的残留（「省深圳市南山」）同样丢弃。
    if (/^[省市区县州盟乡镇]/.test(v)) return;
    // ★ 防御：丢弃"省名 + 单字残片"的切分产物（「浙江杭」「四川成」）。
    //   这类候选既不是城市也不是省名，geocoding 只会返回空，白白消耗一次请求。
    //   注意：纯省名本身（「浙江」「四川」）是有效输入，必须保留。
    if (PROVINCE_PREFIX_RE.test(v)) {
      var rest = v.replace(PROVINCE_PREFIX_RE, '');
      if (rest.length === 1) return;
    }
    if (out.indexOf(v) < 0) out.push(v);
  }
  push(q);

  // 去掉国家前缀（中国/China）与常见分隔符后缀（Los Angeles, CA / 北京·朝阳）
  var noCountry = q.replace(/^(中国|china|中华人民共和国)\s*[·,，]?\s*/i, '').trim();
  push(noCountry);
  var noComma = q.split(/[·,，]/)[0].trim();
  push(noComma);

  // 逐级剥离行政后缀：「成都市」→「成都」
  var stripped = noComma;
  for (var i = 0; i < 4; i++) {
    var next = stripped.replace(ADMIN_SUFFIX_RE, '').trim();
    if (!next || next === stripped) break;
    stripped = next;
    push(stripped);
  }

  // ★ 2026-09-11 补充：处理"行政字内嵌"的复合地名。
  //   例如「成都市武侯区」按后缀剥离只能得到「成都市武侯」（因为末字是"侯"、
  //   不匹配任何行政后缀，循环直接退出），仍然无法命中内置的「成都」。
  //   这类输入的正确切法是【在第一个行政字处截断】：取「成都」。
  var ADMIN_CHAR_RE = /[省市区县州盟乡镇]/;
  var cutIdx = noComma.search(ADMIN_CHAR_RE);
  if (cutIdx >= 2) push(noComma.slice(0, cutIdx));
  // 对后缀剥离后的形式也做一次同样处理
  var innerCutIdx = stripped.search(ADMIN_CHAR_RE);
  if (innerCutIdx >= 2) push(stripped.slice(0, innerCutIdx));

  // ★ 省/自治区名前缀再剥一层：「四川成都武侯」→「成都武侯」，供 geocoding 命中省会。
  //   仅当去前缀后仍有 ≥2 字时才加入，避免把「西藏」这类本身即为目的地的输入削空。
  var withoutProvince = stripped.replace(PROVINCE_PREFIX_RE, '').trim();
  if (withoutProvince && withoutProvince !== stripped && withoutProvince.length >= 2) {
    push(withoutProvince);
    // 再对去省后的结果做一次后缀剥离（「成都武侯」→「成都」）
    var stripped2 = withoutProvince;
    for (var j = 0; j < 3; j++) {
      var next2 = stripped2.replace(ADMIN_SUFFIX_RE, '').trim();
      if (!next2 || next2 === stripped2) break;
      stripped2 = next2;
      push(stripped2);
    }
  }
  return out;
}

/** Resolve any city name via Open-Meteo geocoding (cached). */
async function geocodeCity(query) {
  var raw = String(query || '').trim().slice(0, 60);
  if (!raw) return null;
  var cacheKey = raw.toLowerCase();
  if (GEOCODE_CACHE[cacheKey]) return GEOCODE_CACHE[cacheKey];

  // ★ 2026-09-11：候选列表 + 语言回退。
  //   language=zh 在部分非中文地名上返回空（例如纯英文长名），
  //   因此每个候选先试 zh 再试默认语言；命中即返回。
  var candidates = buildGeoQueryCandidates(raw);
  var languages = ['zh', ''];
  for (var ci = 0; ci < candidates.length; ci++) {
    for (var li = 0; li < languages.length; li++) {
      var hit = await geocodeOnce(candidates[ci], languages[li]);
      if (hit) {
        var keys = Object.keys(GEOCODE_CACHE);
        if (keys.length >= GEOCODE_CACHE_MAX) delete GEOCODE_CACHE[keys[0]];
        GEOCODE_CACHE[cacheKey] = hit;
        return hit;
      }
    }
  }
  return null;
}

/** 单次 geocoding 查询（count=3 取最优候选）。 */
async function geocodeOnce(term, language) {
  var q = String(term || '').trim().slice(0, 60);
  if (!q) return null;
  try {
    var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
      encodeURIComponent(q) + '&count=3&format=json' + (language ? ('&language=' + language) : '');
    // ★ 2026-09-11：超时由 8s 缩短到 6s，配合多候选轮询控制总耗时。
    var resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return null;
    // ★ 审计修复：geocode 分支此前直接 resp.json() 无大小上限（与 forecast 分支
    // 的 MAX_WEATHER_RESPONSE_BYTES 限量不一致）；改为与 forecast 相同的限量读取。
    var geocodeDeclaredLen = Number(resp.headers && resp.headers.get && resp.headers.get('content-length'));
    if (Number.isFinite(geocodeDeclaredLen) && geocodeDeclaredLen > MAX_WEATHER_RESPONSE_BYTES) return null;
    var geocodeRaw = await resp.text();
    if (Buffer.byteLength(geocodeRaw, 'utf8') > MAX_WEATHER_RESPONSE_BYTES) return null;
    var data;
    try { data = JSON.parse(geocodeRaw); } catch (_) { return null; }
    var results = data && Array.isArray(data.results) ? data.results : null;
    if (!results || !results.length) return null;
    // 取首个坐标完整的候选（result[0] 相关度最高，保留其优先权）
    var hit = null;
    for (var ri = 0; ri < results.length; ri++) {
      var cand = results[ri];
      if (cand && cand.latitude != null && cand.longitude != null) { hit = cand; break; }
    }
    if (!hit) return null;
    var labelParts = [hit.name];
    if (hit.admin1 && hit.admin1 !== hit.name) labelParts.push(hit.admin1);
    if (hit.country && hit.country !== hit.name) labelParts.push(hit.country);
    return {
      name: labelParts.join(' · '),
      coords: { lat: Number(hit.latitude), lon: Number(hit.longitude) }
    };
  } catch (e) {
    console.error('[WEATHER] geocode error:', q, e && e.message);
    return null;
  }
}

async function resolveCity(query) {
  var builtin = matchBuiltinCity(query);
  if (builtin) return builtin;
  // ★ 2026-09-11：对带行政后缀的国家/省市组合再试一次内置表。
  //   例如「中国成都」「四川成都」——matchBuiltinCity 用 indexOf 已能命中"成都"，
  //   但「西藏」这类只在内置表、且前缀带国家的输入，剥前缀后命中率更高。
  var candidates = buildGeoQueryCandidates(query);
  for (var ci = 0; ci < candidates.length; ci++) {
    var builtin2 = matchBuiltinCity(candidates[ci]);
    if (builtin2) return builtin2;
  }
  return geocodeCity(query);
}

async function fetchForecast(matchedCity) {
  var lat = matchedCity.coords.lat;
  var lon = matchedCity.coords.lon;
  // ★ 2026-09-22：补上紫外线字段（uv_index / uv_index_max）。
  //   此前只请求温湿度风速，用户问「福州天气 紫外线」时工具拿不到 UV，
  //   模型只能绕道 tavily_search + read_web_page 去网页里抠数据 —— 既慢又容易抠错。
  var weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,uv_index' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max' +
    '&timezone=Asia%2FShanghai';

  // ★ 2026-09-11：加一次重试。预报接口偶发抖动/超时时，此前直接返回 null，
  //   上层把它渲染成「未找到该地点的天气」——把"网络问题"误报为"地名不存在"，
  //   引导用户去换城市名，永远换不对。重试一次可显著降低这类假失败。
  // ★ 2026-09-22：2 次 → 3 次，并在重试之间加退避。
  //   无间隔的连续重试在"上游短暂过载"时几乎必然一起失败；
  //   退避后再试可把偶发抖动与真实故障区分开，显著降低假失败率。
  // ★ 2026-09-24：记录每次失败的 HTTP 状态码；429 时读取 Retry-After 做退避
  //   （上限 5s），避免无间隔连打加深限流；全败后抛出带 upstream_status 的
  //   错误，由 queryWeatherData 走 wttr.in 备源，不再静默 return null。
  var resp = null;
  var lastStatus = 0;
  var lastErr = '';
  for (var attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise(function (r) { setTimeout(r, attempt * 600); });
    }
    try {
      resp = await fetch(weatherUrl, { signal: AbortSignal.timeout(10000) });
      if (resp && resp.ok) break;
      lastStatus = resp ? (resp.status || 0) : 0;
      if (lastStatus === 429 && attempt < 2) {
        var ra = Number(resp && resp.headers && resp.headers.get && resp.headers.get('retry-after'));
        var backoff = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 5000) : 1500;
        await new Promise(function (r) { setTimeout(r, backoff); });
      }
      resp = null;
    } catch (eFetch) {
      lastErr = (eFetch && eFetch.message) || 'fetch_error';
      console.error('[WEATHER] forecast fetch attempt', attempt + 1, 'failed:', lastErr);
      resp = null;
    }
  }
  if (!resp || !resp.ok) {
    var upErr = new Error('open-meteo forecast failed' + (lastStatus ? ' HTTP ' + lastStatus : '') + (lastErr ? ' ' + lastErr : ''));
    upErr.reason = 'upstream_failed';
    upErr.upstream_status = lastStatus;
    throw upErr;
  }
  // 审计 🟢：先查 content-length，再限量读取 body，异常大响应直接丢弃
  var declaredLen = Number(resp.headers && resp.headers.get && resp.headers.get('content-length'));
  if (Number.isFinite(declaredLen) && declaredLen > MAX_WEATHER_RESPONSE_BYTES) return null;
  var rawBody = await resp.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEATHER_RESPONSE_BYTES) return null;
  var data;
  try { data = JSON.parse(rawBody); } catch (_) { return null; }
  if (!data || !data.current) return null;

  var current = data.current;
  var daily = data.daily;
  var wmoCode = current.weather_code;
  var weatherDesc = WEATHER_CODES[wmoCode] || ('天气代码 ' + wmoCode);
  var queriedAt = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });

  return {
    city: matchedCity.name,
    condition: weatherDesc,
    temperature_c: current.temperature_2m,
    humidity: current.relative_humidity_2m,
    wind_kmh: current.wind_speed_10m,
    high_c: daily && daily.temperature_2m_max ? daily.temperature_2m_max[0] : null,
    low_c: daily && daily.temperature_2m_min ? daily.temperature_2m_min[0] : null,
    precip_prob: daily && daily.precipitation_probability_max ? daily.precipitation_probability_max[0] : null,
    weather_code: wmoCode,
    uv_index: (current && current.uv_index !== undefined && current.uv_index !== null) ? current.uv_index : null,
    uv_index_max: (daily && daily.uv_index_max && daily.uv_index_max[0] !== undefined) ? daily.uv_index_max[0] : null,
    queried_at: queriedAt
  };
}

/** 紫外线指数分级（WHO 标准）→ 中文描述 */
function describeUvIndex(uv) {
  var v = Number(uv);
  if (!Number.isFinite(v) || v < 0) return '';
  if (v < 3) return '低';
  if (v < 6) return '中等';
  if (v < 8) return '高';
  if (v < 11) return '很高';
  return '极高';
}

// ★ 2026-09-24 新增：wttr.in 备源（免 Key、免注册）。open-meteo 整体不可用
//   （被 Render 共享出口 IP 触发限流 / 上游宕机）时兜底，消除
//   "单一上游限流 = get_weather 持续失败"的单点故障。
//   wttr.in 的 weatherCode 同为 WMO 代码，直接复用 WEATHER_CODES 映射中文；
//   无紫外线字段 → 置 null，formatWeatherText 会自动跳过。
async function fetchForecastViaWttr(matchedCity) {
  var lat = Number(matchedCity.coords.lat);
  var lon = Number(matchedCity.coords.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    var bad = new Error('wttr.in bad coords');
    bad.reason = 'upstream_failed';
    throw bad;
  }
  var wttrUrl = 'https://wttr.in/' + lat.toFixed(2) + ',' + lon.toFixed(2) + '?format=j1';
  var data = null;
  var lastStatus = 0;
  for (var attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise(function (r) { setTimeout(r, 800); });
    }
    try {
      var resp = await fetch(wttrUrl, { signal: AbortSignal.timeout(8000) });
      lastStatus = resp.status || 0;
      if (!resp.ok) continue;
      var declared = Number(resp.headers && resp.headers.get && resp.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_WEATHER_RESPONSE_BYTES) continue;
      var raw = await resp.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_WEATHER_RESPONSE_BYTES) continue;
      data = JSON.parse(raw);
      break;
    } catch (eW) {
      console.error('[WEATHER] wttr.in attempt', attempt + 1, 'failed:', eW && eW.message);
      data = null;
    }
  }
  var cur = data && Array.isArray(data.current_condition) && data.current_condition[0];
  var day = data && Array.isArray(data.weather) && data.weather[0];
  if (!cur || Number.isNaN(Number(cur.temp_C))) {
    var wErr = new Error('wttr.in fallback failed' + (lastStatus ? ' HTTP ' + lastStatus : ''));
    wErr.reason = 'upstream_failed';
    wErr.upstream_status = lastStatus;
    throw wErr;
  }
  // 当天降雨概率：取 hourly 各时段 chanceofrain 的最大值
  var rainProb = null;
  if (day && Array.isArray(day.hourly)) {
    for (var hi = 0; hi < day.hourly.length; hi++) {
      var v = Number(day.hourly[hi] && day.hourly[hi].chanceofrain);
      if (Number.isFinite(v)) rainProb = (rainProb === null) ? v : Math.max(rainProb, v);
    }
  }
  var queriedAt = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  var wmo = Number(cur.weatherCode);
  return {
    city: matchedCity.name,
    condition: WEATHER_CODES[wmo] || '天气代码 ' + cur.weatherCode,
    temperature_c: Number(cur.temp_C),
    humidity: Number(cur.humidity),
    wind_kmh: Number(cur.windspeedKmph),
    high_c: (day && day.maxtempC !== undefined && day.maxtempC !== '' && day.maxtempC !== null) ? Number(day.maxtempC) : null,
    low_c: (day && day.mintempC !== undefined && day.mintempC !== '' && day.mintempC !== null) ? Number(day.mintempC) : null,
    precip_prob: rainProb,
    weather_code: wmo,
    uv_index: null,
    uv_index_max: null,
    queried_at: queriedAt
  };
}

/** Structured weather for result cards + model content. */
async function queryWeatherData(query) {
  try {
    var matchedCity = await resolveCity(query);
    if (!matchedCity) {
      // ★ 2026-09-11：用带 reason 的错误区分两类失败，避免上层一律输出
      //   「未找到该地点的天气，请换更具体的城市名再试」而误导用户。
      var notFound = new Error('未找到该地点');
      notFound.reason = 'city_not_found';
      throw notFound;
    }
    // ★ 2026-09-24：主/备源共享的结果缓存 —— 同一坐标 10 分钟内直接复用，
    //   大幅降低对 open-meteo 的请求量，防 Render 共享出口 IP 触发限流。
    var cacheKey = Number(matchedCity.coords.lat).toFixed(2) + ',' + Number(matchedCity.coords.lon).toFixed(2);
    var cached = WEATHER_CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) WEATHER_CACHE.delete(cacheKey);

    var forecast = null;
    var primaryErr = null;
    try {
      forecast = await fetchForecast(matchedCity);
    } catch (ePrimary) {
      primaryErr = ePrimary;
      console.error('[WEATHER] open-meteo 主源失败:', ePrimary && ePrimary.message);
    }
    if (!forecast) {
      // ★ 2026-09-24：主源全败 → wttr.in 备源兜底
      try {
        forecast = await fetchForecastViaWttr(matchedCity);
      } catch (eFallback) {
        console.error('[WEATHER] wttr.in 备源也失败:', eFallback && eFallback.message);
      }
    }
    if (!forecast) {
      var upstream = new Error('天气服务无响应' +
        (primaryErr && primaryErr.upstream_status ? '（open-meteo HTTP ' + primaryErr.upstream_status + '）' : ''));
      upstream.reason = 'upstream_failed';
      upstream.upstream_status = (primaryErr && primaryErr.upstream_status) || 0;
      throw upstream;
    }
    if (WEATHER_CACHE.size >= WEATHER_CACHE_MAX) {
      var oldestKey = WEATHER_CACHE.keys().next().value;
      if (oldestKey !== undefined) WEATHER_CACHE.delete(oldestKey);
    }
    WEATHER_CACHE.set(cacheKey, { value: forecast, expiresAt: Date.now() + WEATHER_CACHE_TTL_MS });
    return forecast;
  } catch (e) {
    if (e && e.reason) throw e;
    console.error('[WEATHER] query error:', e && e.message);
    var unknown = new Error('天气服务异常');
    unknown.reason = 'upstream_failed';
    throw unknown;
  }
}

async function queryWeather(query) {
  // ★ 2026-09-11：queryWeatherData 现在以异常表达失败（带 reason），
  //   这里是纯文本包装入口，失败时返回 null 而不是抛出，保持既有调用方不变。
  try {
    var data = await queryWeatherData(query);
    return formatWeatherText(data);
  } catch (e) {
    return null;
  }
}

module.exports = {
  queryWeather: queryWeather,
  queryWeatherData: queryWeatherData,
  formatWeatherText: formatWeatherText,
  matchBuiltinCity: matchBuiltinCity,
  geocodeCity: geocodeCity,
  // ★ 2026-09-11：导出候选生成器，便于单测覆盖地名清洗逻辑
  buildGeoQueryCandidates: buildGeoQueryCandidates,
  describeUvIndex: describeUvIndex,
  // ★ 2026-09-24：导出备源与缓存引用，供单测/上层复用
  fetchForecastViaWttr: fetchForecastViaWttr,
  WEATHER_CACHE: WEATHER_CACHE,
  CITY_COORDS: CITY_COORDS,
  CITY_ALIASES: CITY_ALIASES
};
