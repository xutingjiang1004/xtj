/** Open-Meteo free weather lookup (no API key). */
'use strict';

// Open-Meteo 免费天气查询（无需 API Key）
// 城市坐标映射 — 用于天气查询。如需扩展，可考虑迁移到外部配置文件或数据库。
var CITY_COORDS = {
  '北京': { lat: 39.9042, lon: 116.4074 },
  '上海': { lat: 31.2304, lon: 121.4737 },
  '广州': { lat: 23.1291, lon: 113.2644 },
  '深圳': { lat: 22.5431, lon: 114.0579 },
  '杭州': { lat: 30.2741, lon: 120.1551 },
  '湖州': { lat: 30.8932, lon: 120.0963 },
  '安吉': { lat: 30.6249, lon: 119.6766 },
  '东京': { lat: 35.6762, lon: 139.6503 },
  '大阪': { lat: 34.6937, lon: 135.5023 },
  '首尔': { lat: 37.5665, lon: 126.978 },
  '济州岛': { lat: 33.489, lon: 126.4983 },
  '巴黎': { lat: 48.8566, lon: 2.3522 },
  '伦敦': { lat: 51.5074, lon: -0.1278 },
  '纽约': { lat: 40.7128, lon: -74.006 }
};

var WEATHER_CODES = {
  0: '晴天', 1: '大部晴', 2: '多云', 3: '阴天', 45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '中毛毛雨', 55: '大毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨',
  71: '小雪', 73: '中雪', 75: '大雪', 80: '阵雨', 81: '中阵雨', 82: '大阵雨',
  85: '小阵雪', 86: '大阵雪', 95: '雷暴', 96: '雷暴加小冰雹', 99: '雷暴加大冰雹'
};
// 审计 🟢：外部 API 响应大小上限（Open-Meteo 正常 < 100KB，留足余量）
var MAX_WEATHER_RESPONSE_BYTES = 512 * 1024;

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

/** Structured weather for result cards + model content. */
async function queryWeatherData(query) {
  try {
    var matchedCity = null;
    var cityNames = Object.keys(CITY_COORDS).sort(function(a, b) { return b.length - a.length; });
    for (var i = 0; i < cityNames.length; i++) {
      var cityName = cityNames[i];
      if (String(query || '').indexOf(cityName) >= 0) {
        matchedCity = { name: cityName, coords: CITY_COORDS[cityName] };
        break;
      }
    }
    if (!matchedCity) return null;

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
  CITY_COORDS: CITY_COORDS
};
