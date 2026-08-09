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

async function queryWeather(query) {
  try {
    var matchedCity = null;
    // ★ U3: 按城市名长度倒序匹配, 避免"济州岛"先匹配到"济"或"京"等子串
    var cityNames = Object.keys(CITY_COORDS).sort(function(a, b) { return b.length - a.length; });
    for (var i = 0; i < cityNames.length; i++) {
      var cityName = cityNames[i];
      if (query.indexOf(cityName) >= 0) {
        matchedCity = { name: cityName, coords: CITY_COORDS[cityName] };
        break;
      }
    }
    if (!matchedCity) return null;

    var lat = matchedCity.coords.lat;
    var lon = matchedCity.coords.lon;
    var weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FShanghai';

    var resp = await fetch(weatherUrl, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    var data = await resp.json();
    if (!data || !data.current) return null;

    var current = data.current;
    var daily = data.daily;

    // WMO 天气代码转中文
    var weatherCodes = { 0:'晴天', 1:'大部晴', 2:'多云', 3:'阴天', 45:'雾', 48:'雾凇', 51:'小毛毛雨', 53:'中毛毛雨', 55:'大毛毛雨', 61:'小雨', 63:'中雨', 65:'大雨', 71:'小雪', 73:'中雪', 75:'大雪', 80:'阵雨', 81:'中阵雨', 82:'大阵雨', 85:'小阵雪', 86:'大阵雪', 95:'雷暴', 96:'雷暴加小冰雹', 99:'雷暴加大冰雹' };
    var wmoCode = current.weather_code;
    var weatherDesc = weatherCodes[wmoCode] || ('天气代码 ' + wmoCode);

    var result = '【天气工具结果】\n查询时间：' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) + '（北京时间）\n地点：' + matchedCity.name + '\n天气状况：' + weatherDesc + '\n当前温度：' + current.temperature_2m + '°C\n湿度：' + current.relative_humidity_2m + '%\n风速：' + current.wind_speed_10m + 'km/h';
    if (daily) {
      if (daily.temperature_2m_max && daily.temperature_2m_max[0] !== undefined) result += '\n今日最高：' + daily.temperature_2m_max[0] + '°C';
      if (daily.temperature_2m_min && daily.temperature_2m_min[0] !== undefined) result += '\n今日最低：' + daily.temperature_2m_min[0] + '°C';
      if (daily.precipitation_probability_max && daily.precipitation_probability_max[0] !== undefined) result += '\n降雨概率：' + daily.precipitation_probability_max[0] + '%';
    }
    result += '\n\n要求：必须基于以上工具结果回答，不准编造天气数据。';
    return result;
  } catch (e) {
    console.error('[WEATHER] query error:', e && e.message);
    return null;
  }
}

// 网页搜素函数 - 双引擎并行：Bing（全局可用）+ SearXNG（Render US 可用）
// 无需 API Key，取最快返回有效结果的那一个

module.exports = {
  queryWeather: queryWeather,
  CITY_COORDS: CITY_COORDS
};
