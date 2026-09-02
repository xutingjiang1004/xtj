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
  '曼谷': { lat: 13.7563, lon: 100.5018 }
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
  'san francisco': '旧金山', sf: '旧金山', sydney: '悉尼', bangkok: '曼谷'
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

function formatWeatherText(data) {
  if (!data) return null;
  var result = '【天气工具结果】\n查询时间：' + data.queried_at + '（北京时间）\n地点：' + data.city +
    '\n天气状况：' + data.condition +
    '\n当前温度：' + data.temperature_c + '°C\n湿度：' + data.humidity + '%\n风速：' + data.wind_kmh + 'km/h';
  if (data.high_c !== undefined && data.high_c !== null) result += '\n今日最高：' + data.high_c + '°C';
  if (data.low_c !== undefined && data.low_c !== null) result += '\n今日最低：' + data.low_c + '°C';
  if (data.precip_prob !== undefined && data.precip_prob !== null) result += '\n降雨概率：' + data.precip_prob + '%';
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

/** Resolve any city name via Open-Meteo geocoding (cached). */
async function geocodeCity(query) {
  var q = String(query || '').trim().slice(0, 60);
  if (!q) return null;
  var cacheKey = q.toLowerCase();
  if (GEOCODE_CACHE[cacheKey]) return GEOCODE_CACHE[cacheKey];
  try {
    var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
      encodeURIComponent(q) + '&count=1&language=zh&format=json';
    var resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    // ★ 审计修复：geocode 分支此前直接 resp.json() 无大小上限（与 forecast 分支
    // 的 MAX_WEATHER_RESPONSE_BYTES 限量不一致）；改为与 forecast 相同的限量读取。
    var geocodeDeclaredLen = Number(resp.headers && resp.headers.get && resp.headers.get('content-length'));
    if (Number.isFinite(geocodeDeclaredLen) && geocodeDeclaredLen > MAX_WEATHER_RESPONSE_BYTES) return null;
    var geocodeRaw = await resp.text();
    if (Buffer.byteLength(geocodeRaw, 'utf8') > MAX_WEATHER_RESPONSE_BYTES) return null;
    var data;
    try { data = JSON.parse(geocodeRaw); } catch (_) { return null; }
    var hit = data && Array.isArray(data.results) && data.results[0];
    if (!hit || hit.latitude == null || hit.longitude == null) return null;
    var labelParts = [hit.name];
    if (hit.admin1 && hit.admin1 !== hit.name) labelParts.push(hit.admin1);
    if (hit.country && hit.country !== hit.name) labelParts.push(hit.country);
    var resolved = {
      name: labelParts.join(' · '),
      coords: { lat: Number(hit.latitude), lon: Number(hit.longitude) }
    };
    var keys = Object.keys(GEOCODE_CACHE);
    if (keys.length >= GEOCODE_CACHE_MAX) delete GEOCODE_CACHE[keys[0]];
    GEOCODE_CACHE[cacheKey] = resolved;
    return resolved;
  } catch (e) {
    console.error('[WEATHER] geocode error:', e && e.message);
    return null;
  }
}

async function resolveCity(query) {
  var builtin = matchBuiltinCity(query);
  if (builtin) return builtin;
  return geocodeCity(query);
}

async function fetchForecast(matchedCity) {
  var lat = matchedCity.coords.lat;
  var lon = matchedCity.coords.lon;
  var weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code' +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FShanghai';

  var resp = await fetch(weatherUrl, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) return null;
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
    queried_at: queriedAt
  };
}

/** Structured weather for result cards + model content. */
async function queryWeatherData(query) {
  try {
    var matchedCity = await resolveCity(query);
    if (!matchedCity) return null;
    return await fetchForecast(matchedCity);
  } catch (e) {
    console.error('[WEATHER] query error:', e && e.message);
    return null;
  }
}

async function queryWeather(query) {
  var data = await queryWeatherData(query);
  return formatWeatherText(data);
}

module.exports = {
  queryWeather: queryWeather,
  queryWeatherData: queryWeatherData,
  formatWeatherText: formatWeatherText,
  matchBuiltinCity: matchBuiltinCity,
  geocodeCity: geocodeCity,
  CITY_COORDS: CITY_COORDS
};
