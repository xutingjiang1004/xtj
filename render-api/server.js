// xtj Admin API service for Render deployment.
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
var nodemailer = null;
try { nodemailer = require('nodemailer'); } catch(e) {}

const app = express();

// 简单 cookie 解析中间件
app.use((req, res, next) => {
  req.cookies = {};
  var cookieHeader = req.headers.cookie || '';
  cookieHeader.split(';').forEach(function(pair) {
    var idx = pair.indexOf('=');
    if (idx > 0) {
      req.cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  });
  next();
});

// 信任反向代理（Render 会设置 X-Forwarded-For）
app.set('trust proxy', 1);

// 全局禁用 X-Powered-By（必须在任何路由之前）
app.disable('x-powered-by');

// ===================== 配置 =====================
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'xxz';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const API_SECRET = process.env.API_SECRET;
if (!API_SECRET) {
  console.error('[FATAL] API_SECRET 环境变量未设置，拒绝启动。在 Render Dashboard 中设置 API_SECRET。');
  process.exit(1);
}
const ADMIN_TOKEN_EXPIRY_HOURS = Math.min(
  Math.max(parseInt(process.env.ADMIN_TOKEN_EXPIRY_HOURS || '72', 10) || 72, 1),
  168
);
const TOKEN_EXPIRY_MS = ADMIN_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ithowxqignlhkwaykglt.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_SERVICE_KEY) {
  console.error('[FATAL] SUPABASE_SERVICE_KEY 环境变量未设置，拒绝启动。');
  process.exit(1);
}

// Allowed frontend origins.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
// 服务器自身域名（用于 CORS 自动检测同域请求）
const SERVER_HOSTNAME = process.env.SERVER_HOSTNAME || process.env.RENDER_EXTERNAL_HOSTNAME || '';
if (ALLOWED_ORIGINS.length === 0) {
  // 未配置时允许所有同源请求（自动检测当前部署域名）
  console.log('[CONFIG] ALLOWED_ORIGINS not set, will auto-detect from request origin');
  if (SERVER_HOSTNAME) console.log('[CONFIG] Server hostname: ' + SERVER_HOSTNAME);
}

if (!ADMIN_PASSWORD) {
  console.warn('[WARN] ADMIN_PASSWORD is not configured.');
}

// 初始化 Supabase 客户端（仅使用 service_role key，禁止 anon key 兜底）
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY
);

// ===================== DeepSeek AI 配置 =====================
// ★ DeepSeek API Key 只能放后端环境变量，绝对不能放前端
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL_REASONER = process.env.DEEPSEEK_MODEL_REASONER || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_TIMEOUT_MS = 25000; // 25 秒超时
const AI_AGENT_DAILY_LIMIT = 300; // 每用户每天 AI 调用次数
const AI_AGENT_HOURLY_LIMIT = 50; // 每用户每小时 AI 调用次数
// 单价配置（CNY / 1M tokens），可通过环境变量覆盖
// 默认值对应 deepseek-v4-flash 官方定价（2025年）：
//   缓存未命中输入 1 元/1M tokens → DEEPSEEK_INPUT_PRICE_PER_1M
//   缓存命中输入 0.02 元/1M tokens → DEEPSEEK_CACHE_HIT_PRICE_PER_1M
//   输出 2 元/1M tokens → DEEPSEEK_OUTPUT_PRICE_PER_1M
// 若使用 deepseek-v4-pro：INPUT=3, CACHE_HIT=0.025, OUTPUT=6
const DEEPSEEK_INPUT_PRICE_PER_1M   = parseFloat(process.env.DEEPSEEK_INPUT_PRICE_PER_1M   || '1');
const DEEPSEEK_OUTPUT_PRICE_PER_1M  = parseFloat(process.env.DEEPSEEK_OUTPUT_PRICE_PER_1M  || '2');
const DEEPSEEK_CACHE_HIT_PRICE_PER_1M = parseFloat(process.env.DEEPSEEK_CACHE_HIT_PRICE_PER_1M || '0.02');
const DEEPSEEK_CURRENCY = process.env.DEEPSEEK_CURRENCY || 'CNY';
console.log('[AI-CONFIG] DEEPSEEK_API_KEY:', DEEPSEEK_API_KEY ? '已设置' : '未设置（开发模式将使用 mock 回复）');
console.log('[AI-CONFIG] DEEPSEEK_MODEL_REASONER:', DEEPSEEK_MODEL_REASONER);

const AI_AGENT_CONVERSATION_LIST_LIMIT = 50;

// Web Search config
const SEARCH_CACHE_TTL_MS = 60000;
const searchCache = new Map();

// Open-Meteo 免费天气查询（无需 API Key）
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
    for (var cityName in CITY_COORDS) {
      if (query.indexOf(cityName) >= 0) {
        matchedCity = { name: cityName, coords: CITY_COORDS[cityName] };
        break;
      }
    }
    if (!matchedCity) return null;

    var lat = matchedCity.coords.lat;
    var lon = matchedCity.coords.lon;
    var weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FShanghai';

    var resp = await fetch(weatherUrl);
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
async function searchWeb(query, maxResults) {
  maxResults = maxResults || 5;
  var searchQuery = buildSearchQuery(query);
  if (!searchQuery) searchQuery = String(query || '').trim().slice(0, 120);
  var cacheKey = searchQuery.toLowerCase().trim().slice(0, 100);
  var cached = searchCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < SEARCH_CACHE_TTL_MS) return cached.results;

  var results = [];

  // Bing HTML 解析
  function searchBing() {
    var url = 'https://www.bing.com/search?q=' + encodeURIComponent(searchQuery) + '&count=' + maxResults + '&mkt=zh-CN';
    return fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml'
      },
      signal: AbortSignal.timeout(6000)
    }).then(function(r) {
      if (!r.ok) throw new Error('bing status=' + r.status);
      return r.text();
    }).then(function(html) {
      var items = [];
      var pos = 0;
      while (true) {
        var start = html.indexOf('b_algo', pos);
        if (start < 0) break;
        var liStart = html.lastIndexOf('<li', start);
        if (liStart < 0) { pos = start + 1; continue; }
        var liEnd = html.indexOf('</li>', liStart);
        if (liEnd < 0) { pos = start + 1; continue; }
        var block = html.slice(liStart, liEnd + 5);

        var aHref = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>/i);
        var title = aHref ? aHref[2].replace(/<[^>]+>/g, '').trim() : '';
        var urlVal = aHref ? aHref[1] : '';
        var pMatch = block.match(/<p[^>]*>(.*?)<\/p>/i);
        var snippet = pMatch ? pMatch[1].replace(/<[^>]+>/g, '').trim() : '';

        if (title && urlVal) items.push({ title: title, url: urlVal, snippet: snippet });
        pos = liEnd + 5;
      }
      return items;
    });
  }

  // SearXNG 并行
  function searchSearxng() {
    var searchApiUrl = process.env.SEARCH_API_URL || '';
    var instances = searchApiUrl ? [searchApiUrl] : [
      'https://search.sapti.me', 'https://searx.be', 'https://search.projectsegfau.lt'
    ];
    var category = /新闻|资讯|报道|新闻/i.test(searchQuery) ? 'news' : 'general';
    var fetchers = instances.map(function(baseUrl) {
      baseUrl = baseUrl.replace(/\/+$/, '');
      var url = baseUrl + '/search?q=' + encodeURIComponent(searchQuery) + '&format=json&language=zh-CN&safesearch=1&categories=' + category + '&pageno=1';
      return fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5000)
      }).then(function(r) {
        if (!r.ok) throw new Error('status=' + r.status);
        return r.json();
      }).then(function(data) {
        var raw = data && data.results;
        if (!Array.isArray(raw) || !raw.length) throw new Error('no results');
        return raw.map(function(r) {
          var title = String(r.title || '').trim();
          var url = String(r.url || '').trim();
          return { title: title, url: url, snippet: String(r.content || r.snippet || '').trim(), source: r.engine || 'web', published_at: r.publishedDate || '' };
        });
      }).catch(function(e) {
        throw new Error(baseUrl.slice(0, 30) + ': ' + (e.message || 'unknown'));
      });
    });
    return Promise.race([
      Promise.any(fetchers),
      new Promise(function(_, reject) { setTimeout(function() { reject(new Error('searxng timeout')); }, 7000); })
    ]);
  }

  // 并行跑 Bing 和 SearXNG，最快有效结果胜出
  try {
    var winner = await Promise.race([
      searchBing(),
      searchSearxng().catch(function() { return []; })
    ]);
    if (Array.isArray(winner)) {
      for (var ri = 0; ri < winner.length && results.length < maxResults; ri++) {
        var r2 = winner[ri];
        var title2 = String(r2.title || '').trim();
        var url2 = String(r2.url || '').trim();
        if (!title2 || !url2) continue;
        results.push({
          title: title2.slice(0, 200),
          url: url2,
          snippet: String(r2.snippet || '').trim().slice(0, 500),
          source: r2.source || 'web',
          published_at: r2.published_at || ''
        });
      }
    }
  } catch (e) {
    console.warn('[SEARCH] all engines failed:', e && e.message);
  }

  searchCache.set(cacheKey, { ts: Date.now(), results: results });
  return results;
}

function writeSse(res, payload) {
  if (res.headersSent) {
    try { res.write('data: ' + JSON.stringify(payload) + '\n\n'); } catch (e) {}
  }
}

function buildSearchQuery(message) {
  var q = String(message || '').trim();
  var cleaned = q.replace(/今天|现在|当前|实时|最新/g, '').trim();
  if (!cleaned) return q.slice(0, 120);
  if (/新闻|资讯|报道|快讯/i.test(q)) {
    return (cleaned + ' 新闻').slice(0, 120);
  }
  if (/价格|多少钱|售价/i.test(q)) {
    return (cleaned + ' 价格').slice(0, 120);
  }
  if (/天气|温度|下雨|降雨/i.test(q)) {
    return ''; // 天气不走搜素
  }
  return cleaned.slice(0, 120);
}

// ===================== Gmail SMTP 邮件配置 =====================
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';
// ★ 启动时打印邮件环境变量状态（便于 Render Dashboard Logs 调试）
console.log('[MAIL-CONFIG] GMAIL_USER:', GMAIL_USER ? '已设置' : '未设置');
console.log('[MAIL-CONFIG] GMAIL_APP_PASSWORD:', GMAIL_APP_PASSWORD ? '已设置' : '未设置');
console.log('[MAIL-CONFIG] SENDGRID_API_KEY:', process.env.SENDGRID_API_KEY ? '已设置' : '未设置');
console.log('[MAIL-CONFIG] GMAIL_GAS_URL:', process.env.GMAIL_GAS_URL ? '已设置' : '未设置');
var mailTransporter = null;
var mailTransporterPort = null;
function getMailTransporter() {
  if (mailTransporter && mailTransporterPort) return mailTransporter;
  if (!nodemailer) {
    console.warn('[MAIL] nodemailer 未安装，邮件功能不可用');
    return null;
  }
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.warn('[MAIL] GMAIL_USER 或 GMAIL_APP_PASSWORD 未配置，邮件功能不可用');
    return null;
  }
  // 优先使用 465 SSL，如果连接失败在 sendMail 时自动回退到 587
  mailTransporterPort = process.env.SMTP_PORT || '465';
  var isSecure = mailTransporterPort === '465';
  mailTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: parseInt(mailTransporterPort),
    secure: isSecure,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000
  });
  return mailTransporter;
}

// ===================== 输入校验 =====================
const MAX_USERNAME_LEN = 50;
const MAX_REASON_LEN = 500;
const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 5000;

// ===================== 系统 marker 常量（集中定义，避免 TDZ 问题） =====================
// 所有 media_type 字符串集中在文件前面定义，下方 helper / 路由可直接引用
const REPORT_MARKER = '__report__';
const DM_MARKER = '__dm__';
const AUTH_MARKER = '__auth__';
const VISIT_MARKER = '__visit__';
const ATTACK_MARKER = '__attack__';
const ADMIN_AUTH_MARKER = '__admin_auth__';
const ADMIN_META_MARKER = '__admin_meta__';
const USER_INFO_MARKER = '__user_info__';
const USER_VISIT_MARKER = '__user_visit__';
const LOGIN_EVENT_MARKER = '__login_event__';
const SECURITY_ALERT_MARKER = '__security_alert__';
const AUDIT_LOG_MARKER = '__admin_audit__';
const CLIENT_ERROR_MARKER = '__client_error__';
// VIP / Pro 相关
const VIP_MARKER = '__vip__';
const VIP_ORDER_MARKER = '__vip_order__';
const VIP_PLAN_MARKER = '__vip_plan__';
const PRO_GIFT_MARKER = '__pro_gift__';
const PRO_GIFT_CLAIM_MARKER = '__pro_gift_claim__';
// 公告已读（跨设备同步用户已读公告）
const ANN_READ_MARKER = '__ann_read__';
// 邮件 / 历史邮箱
const EMAIL_SENT_MARKER = '__email_sent__';
const EMAIL_RECIPIENT_MARKER = '__email_recipient_history__';

// ===================== AI 智能体 marker =====================
// 所有 AI 相关数据使用 posts 表 + marker 集中存储（与现有 Pro Gift / VIP / 公告同模式）
// ★ 必须加入 applyPublicPostExclusions() 避免出现在普通帖子 feed、统计、后台列表
const AI_AGENT_PROFILE_MARKER = '__ai_agent_profile__';
const AI_AGENT_MESSAGE_MARKER = '__ai_agent_msg__';
const AI_AGENT_MEMORY_MARKER = '__ai_agent_memory__';
const AI_AGENT_CONFIG_MARKER = '__ai_agent_config__';

const LOGIN_LOG_RETENTION_DAYS = 90;
const SECURITY_LOG_RETENTION_DAYS = 90;
const ERROR_LOG_RETENTION_DAYS = 30;

// ===================== 通用 posts 查询过滤 helper =====================
// 集中处理普通帖子 / 总动态 / 后台管理 / 统计 端点需要排除的 system media_type
// 与前端 applyVisiblePostQueryFilters 保持一致（22 个 marker）
// 必须放在所有 marker 常量定义之后、路由定义之前
function applyPublicPostExclusions(query) {
  if (!query || typeof query.neq !== 'function') return query;
  return query
    .neq('media_type', AUTH_MARKER)
    .neq('media_type', ADMIN_AUTH_MARKER)
    .neq('media_type', ADMIN_META_MARKER)
    .neq('media_type', DM_MARKER)
    .neq('media_type', REPORT_MARKER)
    .neq('media_type', '__avatar__')
    .neq('media_type', USER_INFO_MARKER)
    .neq('media_type', '__photo_wall__')
    .neq('media_type', VISIT_MARKER)
    .neq('media_type', ATTACK_MARKER)
    .neq('media_type', USER_VISIT_MARKER)
    .neq('media_type', '__ann__')
    .neq('media_type', VIP_MARKER)
    .neq('media_type', VIP_ORDER_MARKER)
    .neq('media_type', VIP_PLAN_MARKER)
    .neq('media_type', '__user_style__')
    .neq('media_type', PRO_GIFT_MARKER)
    .neq('media_type', PRO_GIFT_CLAIM_MARKER)
    .neq('media_type', LOGIN_EVENT_MARKER)
    .neq('media_type', SECURITY_ALERT_MARKER)
    .neq('media_type', AUDIT_LOG_MARKER)
    .neq('media_type', CLIENT_ERROR_MARKER)
    .neq('media_type', EMAIL_SENT_MARKER)
    .neq('media_type', EMAIL_RECIPIENT_MARKER)
    .neq('media_type', ANN_READ_MARKER)
    .neq('media_type', AI_AGENT_PROFILE_MARKER)
    .neq('media_type', AI_AGENT_MESSAGE_MARKER)
    .neq('media_type', AI_AGENT_MEMORY_MARKER)
    .neq('media_type', AI_AGENT_CONFIG_MARKER);
}

// 统计数据内存缓存（减少数据库查询，带 promise 锁防并发重复查询）
let statsCache = { data: null, ts: 0, pending: null };
const STATS_CACHE_TTL = 60000; // 1分钟

// 记录访问日志
async function logVisit(ip) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from('posts').insert([{
      user_name: ip || 'unknown',
      content: JSON.stringify({ date: today }),
      media_type: VISIT_MARKER,
      media_url: today,
      actor_key: 'visit_' + Date.now()
    }]);
  } catch(e) { /* 静默失败 */ }
}

// 记录攻击/拦截日志
async function logAttack(ip, type, detail) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from('posts').insert([{
      user_name: ip || 'unknown',
      content: JSON.stringify({ type, detail: String(detail || '').slice(0, 200), date: today }),
      media_type: ATTACK_MARKER,
      media_url: type,
      actor_key: 'attack_' + Date.now()
    }]);
  } catch(e) { /* 静默失败 */ }
}

// 访问计数去重（同IP同天只计一次，按天自动清理）
const visitCache = new Map(); // ip_date -> true
let visitCacheCleanupTimeout = null;
function shouldCountVisit(ip) {
  const today = new Date().toISOString().slice(0, 10);
  const key = ip + '_' + today;
  if (visitCache.has(key)) return false;
  visitCache.set(key, true);
  // ★ 修复 M7：异步延迟清理，避免同步 forEach 阻塞事件循环
  if (visitCache.size > 10000 && !visitCacheCleanupTimeout) {
    visitCacheCleanupTimeout = setTimeout(function() {
      visitCacheCleanupTimeout = null;
      var keysToDelete = [];
      visitCache.forEach(function(_, k) {
        if (!k.endsWith('_' + today)) keysToDelete.push(k);
      });
      keysToDelete.forEach(function(k) { visitCache.delete(k); });
    }, 100);
  }
  return true;
}

const ADMIN_STATS_PAGE_SIZE = 1000;

function safeJsonParse(input) {
  try {
    const parsed = JSON.parse(input || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function toTimeMs(value) {
  if (!value) return NaN;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function pickEarlierIso(currentValue, candidateValue) {
  const currentMs = toTimeMs(currentValue);
  const candidateMs = toTimeMs(candidateValue);
  if (!Number.isFinite(candidateMs)) return currentValue || null;
  if (!Number.isFinite(currentMs) || candidateMs < currentMs) return candidateValue;
  return currentValue || null;
}

function pickLaterIso(currentValue, candidateValue) {
  const currentMs = toTimeMs(currentValue);
  const candidateMs = toTimeMs(candidateValue);
  if (!Number.isFinite(candidateMs)) return currentValue || null;
  if (!Number.isFinite(currentMs) || candidateMs > currentMs) return candidateValue;
  return currentValue || null;
}

function getUtcDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ms = toTimeMs(value);
  if (!Number.isFinite(ms)) {
    return typeof value === 'string' ? value.slice(0, 10) : '';
  }
  return new Date(ms).toISOString().slice(0, 10);
}

async function fetchAllPostsByMediaType(mediaType, selectFields) {
  let from = 0;
  let results = [];
  while (true) {
    const { data, error } = await supabase.from('posts')
      .select(selectFields)
      .eq('media_type', mediaType)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + ADMIN_STATS_PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = data || [];
    results = results.concat(chunk);
    if (chunk.length < ADMIN_STATS_PAGE_SIZE) break;
    from += ADMIN_STATS_PAGE_SIZE;
  }
  return results;
}

function buildAuthUserMap(authRows) {
  const authMap = {};
  (authRows || []).forEach(row => {
    const userName = String(row && row.user_name || '').trim();
    if (!userName) return;
    const createdAt = row.created_at || null;
    if (!authMap[userName]) {
      authMap[userName] = { user_name: userName, auth_created_at: createdAt };
      return;
    }
    authMap[userName].auth_created_at = pickEarlierIso(authMap[userName].auth_created_at, createdAt);
  });
  return authMap;
}

function buildUserInfoMap(userInfoRows) {
  const userInfoMap = {};
  (userInfoRows || []).forEach(row => {
    const userName = String(row && row.user_name || '').trim();
    if (!userName) return;
    const info = safeJsonParse(row.content);
    if (!userInfoMap[userName]) {
      userInfoMap[userName] = {
        reg_time: info.reg_time || null,
        last_login: info.last_login || null,
        last_visit: info.last_visit || null
      };
      return;
    }
    userInfoMap[userName].reg_time = pickEarlierIso(userInfoMap[userName].reg_time, info.reg_time);
    userInfoMap[userName].last_login = pickLaterIso(userInfoMap[userName].last_login, info.last_login);
    userInfoMap[userName].last_visit = pickLaterIso(userInfoMap[userName].last_visit, info.last_visit);
  });
  return userInfoMap;
}

function buildUserVisitMap(visitRows) {
  const userVisitMap = {};
  (visitRows || []).forEach(row => {
    const userName = String(row && row.user_name || '').trim();
    if (!userName) return;
    if (!userVisitMap[userName]) {
      userVisitMap[userName] = { total_visits: 0, daily_visits: {}, last_visit: null };
    }
    userVisitMap[userName].total_visits += 1;
    const content = safeJsonParse(row.content);
    const visitDateKey = getUtcDateKey(row.media_url || content.date || row.created_at);
    if (visitDateKey) {
      userVisitMap[userName].daily_visits[visitDateKey] = (userVisitMap[userName].daily_visits[visitDateKey] || 0) + 1;
    }
    userVisitMap[userName].last_visit = pickLaterIso(userVisitMap[userName].last_visit, row.created_at || null);
  });
  return userVisitMap;
}

function getEffectiveRegTime(authInfo, userInfo) {
  return userInfo && userInfo.reg_time || authInfo && authInfo.auth_created_at || null;
}

function buildAdminUsersPayload(authRows, userInfoRows) {
  const authMap = buildAuthUserMap(authRows);
  const userInfoMap = buildUserInfoMap(userInfoRows);
  const allUserNames = new Set([
    ...Object.keys(authMap),
    ...Object.keys(userInfoMap)
  ]);

  return Array.from(allUserNames).map(userName => {
    const authInfo = authMap[userName] || {};
    const info = userInfoMap[userName] || {};
    const effectiveRegTime = getEffectiveRegTime(authInfo, info);
    return {
      user_name: userName,
      created_at: effectiveRegTime,
      content: JSON.stringify({
        reg_time: effectiveRegTime,
        auth_created_at: authInfo.auth_created_at || null,
        last_login: info.last_login || null,
        last_visit: info.last_visit || null
      })
    };
  }).sort((a, b) => {
    const ta = toTimeMs(a.created_at);
    const tb = toTimeMs(b.created_at);
    if ((Number.isFinite(tb) ? tb : 0) !== (Number.isFinite(ta) ? ta : 0)) {
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    }
    return String(a.user_name || '').localeCompare(String(b.user_name || ''), 'zh-CN');
  });
}

function buildRegisteredUsersByDate(authMap) {
  const dateMap = {};
  Object.keys(authMap || {}).forEach(userName => {
    const authCreatedAt = authMap[userName] && authMap[userName].auth_created_at;
    const dateKey = getUtcDateKey(authCreatedAt);
    if (dateKey) dateMap[dateKey] = (dateMap[dateKey] || 0) + 1;
  });
  return dateMap;
}

async function getAdminMetaRecord(mediaUrl) {
  var query = supabase.from('posts')
    .select('id, content, created_at')
    .eq('media_type', ADMIN_META_MARKER)
    .eq('user_name', ADMIN_USERNAME);
  if (mediaUrl) query = query.eq('media_url', mediaUrl);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  return data && data.length ? data[0] : null;
}

async function saveAdminMetaFields(fields, mediaUrl) {
  var query = supabase.from('posts')
    .select('id, content, created_at')
    .eq('media_type', ADMIN_META_MARKER)
    .eq('user_name', ADMIN_USERNAME);
  if (mediaUrl) query = query.eq('media_url', mediaUrl);
  const { data: existingRows } = await query.order('created_at', { ascending: false }).limit(1);
  var existing = existingRows && existingRows.length ? existingRows[0] : null;
  const nextContent = Object.assign({}, safeJsonParse(existing && existing.content), fields || {});
  if (existing && existing.id) {
    const { error } = await supabase.from('posts')
      .update({ content: JSON.stringify(nextContent) })
      .eq('id', existing.id);
    if (error) throw error;
    return { id: existing.id, content: nextContent };
  }
  var insertPayload = {
    user_name: ADMIN_USERNAME,
    content: JSON.stringify(nextContent),
    media_type: ADMIN_META_MARKER,
    actor_key: ADMIN_META_MARKER
  };
  if (mediaUrl) insertPayload.media_url = mediaUrl;
  const { data, error } = await supabase.from('posts').insert([insertPayload]).select('id, content').limit(1);
  if (error) throw error;
  return data && data.length ? data[0] : { id: null, content: nextContent };
}

function buildUnreadRegisterAlertPayload(authMap, baselineIso) {
  const baselineMs = toTimeMs(baselineIso);
  const unreadUsers = Object.keys(authMap || {}).map(userName => {
    return {
      user_name: userName,
      register_time: authMap[userName] && authMap[userName].auth_created_at || null
    };
  }).filter(entry => {
    const registerMs = toTimeMs(entry.register_time);
    return Number.isFinite(registerMs) && Number.isFinite(baselineMs) && registerMs > baselineMs;
  }).sort((a, b) => {
    return (toTimeMs(b.register_time) || 0) - (toTimeMs(a.register_time) || 0);
  });
  return {
    unread_count: unreadUsers.length,
    latest_register_at: unreadUsers.length ? unreadUsers[0].register_time : null,
    users: unreadUsers
  };
}

function sanitizeError(err) {
  if (!err) return '操作失败';
  console.error('[API Error]', err.message || err);
  if (err.code === '42501' || err.code === 'PGRST301') return '权限不足';
  if (err.code === '23505') return '数据已存在';
  return '操作失败，请稍后重试';
}
async function sendAdminDm(toUserName, content) {
  if (!toUserName || !content || toUserName === ADMIN_USERNAME) return;
  try {
    await supabase.from('posts').insert([{
      user_name: ADMIN_USERNAME,
      content: String(content).slice(0, 2000),
      media_type: DM_MARKER,
      media_url: toUserName,
      actor_key: 'admin_notify_' + Date.now()
    }]);
  } catch(e) {
    console.error('[admin dm send]', e && e.message ? e.message : e);
  }
}
function validateString(val, maxLen, fieldName) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  if (s.length > maxLen) {
    return { error: `${fieldName}不能超过${maxLen}个字符` };
  }
  return s || null;
}

function isProtectedAdminTarget(userName) {
  return String(userName || '').trim() === ADMIN_USERNAME;
}

function validateDurationHours(value) {
  const raw = value === undefined || value === null || value === '' ? 0 : Number(value);
  if (!Number.isFinite(raw) || raw < 0) return { error: '时长格式不正确' };
  if (raw > 24 * 365) return { error: '时长不能超过1年' };
  return { value: Math.floor(raw) };
}

// ===================== 中间件 ======================
// CORS 限制：自动检测 + 白名单
app.use(cors({
  origin: function (origin, callback) {
    // 允许无 origin 的请求（如 curl、Postman、同源请求）
    if (!origin) return callback(null, true);
    // 检查白名单
    if (ALLOWED_ORIGINS.length > 0 && ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    // 自动检测模式：检查是否匹配服务器域名或已知域名
    if (ALLOWED_ORIGINS.length === 0) {
      try {
        var originHost = new URL(origin).hostname;
        // 允许同域名（通过 SERVER_HOSTNAME 或 Render 环境变量）、本地开发域名
        if (originHost === SERVER_HOSTNAME || originHost === 'localhost' || originHost === '127.0.0.1') {
          return callback(null, true);
        }
      } catch(e) {}
    }
    // 返回 403（错误由后续错误处理器记录日志并返回 403）
    var err = new Error('不允许的来源');
    err.status = 403;
    callback(err);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}));

// CORS 错误处理器（此处的 req 可用，用于记录攻击日志）
app.use(function corsErrorHandler(err, req, res, next) {
  if (err.message === '不允许的来源') {
    console.warn('[CORS] Rejected origin ' + (req.headers.origin || 'unknown'));
    logAttack(getRealIp(req), 'CORS', 'Rejected origin: ' + (req.headers.origin || '').slice(0, 100));
    return res.status(403).json({ error: '不允许的来源' });
  }
  next(err);
});

app.use(express.json({ limit: '1mb' }));

// HTTPS 重定向（生产环境强制跳转 HTTPS）
app.use((req, res, next) => {
  if (!req.secure && req.headers['x-forwarded-proto'] !== 'https') {
    const host = req.headers.host || '';
    // 仅在非本地开发环境重定向（避免本地 localhost 也被跳转）
    if (host && !host.startsWith('localhost:') && !host.startsWith('127.0.0.1:')) {
      return res.redirect(301, 'https://' + host + req.originalUrl);
    }
  }
  next();
});

// 安全响应头 + CSRF 防护 + 访问记录（放在静态文件之前，确保 HTML 也带上安全头）
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://ithowxqignlhkwaykglt.supabase.co https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob: https:; media-src 'self' https:; connect-src 'self' https://ithowxqignlhkwaykglt.supabase.co wss://ithowxqignlhkwaykglt.supabase.co; font-src 'self' https://cdn.jsdelivr.net; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});

// 访问记录 + CSRF 防护（必须放在 express.static 之前，否则 GET / 被静态文件截断不会记录）
app.use(function(req, res, next) {
  // 访问记录（只记录 GET /，排除 /health 避免 cron ping 产生垃圾数据）
  const ip = getRealIp(req);
  if (req.method === 'GET' && req.path === '/') {
    if (shouldCountVisit(ip)) {
      logVisit(ip);
    }
  }

  // CSRF 防护：对非 GET/HEAD/OPTIONS 请求检查 Origin/Referer
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers['origin'] || '';
    const referer = req.headers['referer'] || '';
    const host = req.headers['host'] || '';
    // 同源判断：无 origin（curl/Postman）、或 origin 匹配 Host 头、或匹配服务器域名
    const isSameOrigin = !origin || (function() {
      try {
        var originHost = new URL(origin).host;
        // 精确匹配：origin 的 host 必须等于 Host 头或服务器域名
        return originHost === host || originHost === SERVER_HOSTNAME;
      } catch(e) { return false; }
    })();
    const allowed = isSameOrigin || ALLOWED_ORIGINS.some(function(o) {
      return origin === o || referer.startsWith(o + '/');
    });
    if (!allowed && origin) {
      logAttack(ip, 'CSRF', 'Origin: ' + origin.slice(0, 100));
      return res.status(403).json({ error: '拒绝跨站请求' });
    }
  }

  next();
});

// 托管前端静态文件（index.html, admin.html, js/ 等）
app.use(express.static(path.join(__dirname, '..'), {
  maxAge: '1h',
  setHeaders: function(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// 频率限制中间件
const rateLimitStore = new Map();
// 每5分钟清理过期的限流记录，防止内存泄漏
setInterval(function() {
  var now = Date.now();
  rateLimitStore.forEach(function(record, key) {
    if (now > record.resetAt) rateLimitStore.delete(key);
  });
}, 300000);
function getRealIp(req) {
  // trust proxy 已配置，req.ip 返回真实客户端 IP
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// 获取客户端 IP（优先 X-Forwarded-For 第一段，用于登录事件记录）
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return first;
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// UA 解析（后端用，与前端 js/login-device.js 规则一致）
function detectDeviceTypeFromUA(ua) {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile\/\w+/i.test(ua))) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mobi/i.test(ua)) return 'Mobile';
  return 'Desktop';
}

function detectOSFromUA(ua) {
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile\/\w+/i.test(ua))) return 'iPadOS';
  if (/iPhone|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}

function detectBrowserFromUA(ua) {
  if (/MicroMessenger/i.test(ua)) return 'WeChat';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/Firefox/i.test(ua)) return 'Firefox';
  if (/Chrome/i.test(ua)) return 'Chrome';
  if (/Safari/i.test(ua)) return 'Safari';
  return 'Unknown';
}


// 根据屏幕参数推测 iPhone 疑似型号（iOS/Safari 不稳定暴露具体型号，非精确识别）
function getPossibleDeviceModel(info) {
  info = info || {};
  var ua = String(info.user_agent || '');
  var platform = String(info.platform || '');
  var maxTouchPoints = Number(info.max_touch_points || 0);
  var sw = Number(info.screen_width || info.visual_viewport_width || info.inner_width || (info.screen && String(info.screen).split('x')[0])) || 0;
  var sh = Number(info.screen_height || info.visual_viewport_height || info.inner_height || (info.screen && String(info.screen).split('x')[1])) || 0;
  var dpr = Number(info.device_pixel_ratio || info.dpr) || 0;
  var isIPhone = /iPhone/i.test(ua) || (/Mac/i.test(platform) && maxTouchPoints > 1 && Math.min(sw, sh) < 600);
  if (!isIPhone) return '';
  if (!sw || !sh) return '';
  var key = Math.min(sw, sh) + 'x' + Math.max(sw, sh) + '@' + (dpr || '');
  var modelMap = {
    '440x956@3': '疑似 iPhone 16 Pro Max / iPhone 17 Pro Max',
    '402x874@3': '疑似 iPhone 16 Pro / iPhone 17 / iPhone 17 Pro',
    '393x852@3': '疑似 iPhone 14 Pro / iPhone 15 / iPhone 15 Pro / iPhone 16',
    '430x932@3': '疑似 iPhone 14 Pro Max / iPhone 15 Plus / iPhone 15 Pro Max / iPhone 16 Plus',
    '428x926@3': '疑似 iPhone 12 Pro Max / iPhone 13 Pro Max / iPhone 14 Plus',
    '390x844@3': '疑似 iPhone 12 / iPhone 12 Pro / iPhone 13 / iPhone 13 Pro / iPhone 14',
    '375x812@3': '疑似 iPhone X / iPhone XS / iPhone 11 Pro / iPhone 12 mini / iPhone 13 mini',
    '414x896@3': '疑似 iPhone XS Max / iPhone 11 Pro Max',
    '414x896@2': '疑似 iPhone XR / iPhone 11',
    '414x736@3': '疑似 iPhone 6 Plus / 6s Plus / 7 Plus / 8 Plus',
    '375x667@2': '疑似 iPhone 6 / 6s / 7 / 8 / SE（第 2/3 代）',
    '320x568@2': '疑似 iPhone 5 / 5s / SE（第 1 代）'
  };
  return modelMap[key] || '';
}

// 记录管理员登录事件（静默，不影响登录流程）
async function logAdminLoginEvent(req) {
  try {
    const ip = getClientIp(req);
    const ua = String(req.headers['user-agent'] || '');
    const deviceId = 'admin_' + crypto.createHash('sha256').update(ip + '|' + ua).digest('hex').slice(0, 32);
    const loginAt = new Date().toISOString();
    const random = Math.random().toString(36).slice(2, 10);

    var ipLocation = null;
    try { ipLocation = await resolveIpLocation(ip); } catch(e) {}

    const { error } = await supabase.from('posts').insert([{
      user_name: ADMIN_USERNAME,
      media_type: LOGIN_EVENT_MARKER,
      media_url: deviceId,
      content: JSON.stringify({
        device_id: deviceId,
        device_type: detectDeviceTypeFromUA(ua),
        os: detectOSFromUA(ua),
        browser: detectBrowserFromUA(ua),
        user_agent: ua,
        ip: ip,
        ip_location: ipLocation,
        login_at: loginAt,
        is_admin: true,
        source: 'admin_login'
      }),
      actor_key: 'admin_login_' + Date.now() + '_' + random
    }]);
    if (error) {
      console.warn('[AdminLoginEvent] 写入失败:', error.message || error);
    }

    // 同步更新管理员 user_info
    if (!error) {
      try {
        const now = new Date().toISOString();
        const { data: existingInfo } = await supabase.from('posts')
          .select('id, content')
          .eq('user_name', ADMIN_USERNAME)
          .eq('media_type', USER_INFO_MARKER)
          .maybeSingle();

        var info = {};
        if (existingInfo) {
          try { info = JSON.parse(existingInfo.content || '{}'); } catch(e) {}
        }

        info.last_login = now;
        if (!info.last_visit) info.last_visit = now;
        info.last_device = detectDeviceTypeFromUA(ua) + ' · ' + detectOSFromUA(ua) + ' · ' + detectBrowserFromUA(ua);
        info.last_ip = ip;
        if (ipLocation) info.last_ip_location = ipLocation;

        if (existingInfo) {
          await supabase.from('posts').update({ content: JSON.stringify(info) }).eq('id', existingInfo.id);
        }
      } catch(e) {
        console.warn('[AdminLoginEvent] 同步 user_info 失败:', e.message || e);
      }
    }
  } catch(e) {
    console.warn('[AdminLoginEvent] 记录异常:', e.message || e);
  }
}

// IP 地区解析（多源 fallback: ip-api.com → ipapi.co → ipwho.is）
async function resolveIpLocation(ip) {
  if (!ip || ip === 'unknown') return null;
  if (ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return null;
  if (ip.match(/^172\.(1[6-9]|2\d|3[01])\./)) return null;
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return null;

  const fetchers = [
    async function() {
      var controller = new AbortController();
      var timeout = setTimeout(function() { controller.abort(); }, 2000);
      var resp = await fetch('https://ip-api.com/json/' + encodeURIComponent(ip) + '?fields=status,country,regionName,city,query,as,org,isp,mobile,proxy,hosting', { signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) throw new Error('ip-api.com HTTP ' + resp.status);
      var data = await resp.json();
      if (data.status !== 'success') throw new Error('ip-api.com status: ' + data.status);
      return { country: data.country || '', region: data.regionName || '', city: data.city || '', asn: data.as || '', isp: data.isp || '', org: data.org || '', is_mobile: !!data.mobile, is_proxy: !!data.proxy, is_hosting: !!data.hosting };
    },
    async function() {
      var controller = new AbortController();
      var timeout = setTimeout(function() { controller.abort(); }, 2500);
      var resp = await fetch('https://ipapi.co/' + encodeURIComponent(ip) + '/json/', { signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) throw new Error('ipapi.co HTTP ' + resp.status);
      var data = await resp.json();
      if (data.error) throw new Error('ipapi.co error: ' + (data.reason || data.error));
      return { country: data.country_name || '', region: data.region || '', city: data.city || '' };
    },
    async function() {
      var controller = new AbortController();
      var timeout = setTimeout(function() { controller.abort(); }, 2500);
      var resp = await fetch('https://ipwho.is/' + encodeURIComponent(ip), { signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) throw new Error('ipwho.is HTTP ' + resp.status);
      var data = await resp.json();
      if (!data.success) throw new Error('ipwho.is not success');
      return { country: data.country || '', region: data.region || '', city: data.city || '' };
    }
  ];

  for (var i = 0; i < fetchers.length; i++) {
    try {
      var result = await fetchers[i]();
      var parts = [result.country, result.region, result.city].filter(Boolean);
      return {
        country: result.country,
        region: result.region,
        city: result.city,
        text: parts.length > 0 ? parts.join(' · ') : '未知',
        asn: result.asn || '',
        isp: result.isp || '',
        org: result.org || '',
        is_mobile: result.is_mobile || false,
        is_proxy: result.is_proxy || false,
        is_hosting: result.is_hosting || false
      };
    } catch(e) {
      console.warn('[IP] 解析源 ' + (i + 1) + ' 失败:', e.message || e);
    }
  }
  console.warn('[IP] 所有解析源均失败，返回 null:', ip);
  return null;
}

// ===================== 安全检测逻辑 =====================

// 写入安全提醒到 posts 表
async function insertSecurityAlert(alert) {
  try {
    await supabase.from('posts').insert([{
      user_name: alert.user_name || 'system',
      media_type: SECURITY_ALERT_MARKER,
      media_url: alert.type || 'unknown',
      content: JSON.stringify({
        type: alert.type,
        level: alert.level || 'warning',
        user_name: alert.user_name,
        ip: alert.ip || null,
        ip_location_text: alert.ip_location_text || null,
        related_users: alert.related_users || [],
        reason: alert.reason || '',
        is_read: false,
        ignored: false,
        false_positive: false,
        reviewed_at: null,
        reviewed_by: null
      }),
      actor_key: 'sec_alert_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
    }]);
  } catch(e) {
    console.warn('[Security] 写入安全提醒失败:', e.message || e);
  }
}

// 管理员审计日志
async function logAdminAudit(action, operator, detail) {
  try {
    await supabase.from('posts').insert([{
      user_name: operator || 'system',
      media_type: AUDIT_LOG_MARKER,
      media_url: action,
      content: JSON.stringify({
        action: action,
        operator: operator,
        detail: String(detail || '').slice(0, 500),
        timestamp: new Date().toISOString()
      }),
      actor_key: 'audit_' + Date.now()
    }]);
  } catch(e) {
    console.warn('[Audit] 审计日志写入失败:', e.message);
  }
}

// 自动清理旧日志
async function cleanupOldLogs(type) {
  try {
    var days = type === 'error' ? ERROR_LOG_RETENTION_DAYS : (type === 'login' || type === 'security' ? LOGIN_LOG_RETENTION_DAYS : 90);
    var cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    var mediaType;
    if (type === 'login') mediaType = LOGIN_EVENT_MARKER;
    else if (type === 'security') mediaType = SECURITY_ALERT_MARKER;
    else if (type === 'error') mediaType = CLIENT_ERROR_MARKER;
    else return { deleted: 0 };

    var { data, error } = await supabase.from('posts')
      .select('id')
      .eq('media_type', mediaType)
      .lt('created_at', cutoff);
    if (error || !data || !data.length) return { deleted: 0 };

    var ids = data.map(function(r) { return r.id; });
    // Delete in batches of 100
    var deleted = 0;
    for (var i = 0; i < ids.length; i += 100) {
      var batch = ids.slice(i, i + 100);
      await supabase.from('posts').delete().in('id', batch);
      deleted += batch.length;
    }
    return { deleted: deleted };
  } catch(e) {
    console.warn('[Cleanup] 清理 ' + type + ' 日志失败:', e.message);
    return { deleted: 0, error: e.message };
  }
}

// 检查同 IP 24h 内多账号登录
async function checkSameIpMultiUsers(userName, ip, ipLocation) {
  if (!ip || ip === 'unknown') return;
  var since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    var { data } = await supabase.from('posts')
      .select('user_name, content')
      .eq('media_type', LOGIN_EVENT_MARKER)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);
    if (!data || !data.length) return;

    var ipUsers = {};
    data.forEach(function(row) {
      try {
        var c = JSON.parse(row.content || '{}');
        if (c.ip === ip && row.user_name !== userName) {
          ipUsers[row.user_name] = true;
        }
      } catch(e) {}
    });

    var related = Object.keys(ipUsers);
    if (related.length >= 1) {
      var ipLevel = related.length >= 3 ? 'high' : 'warning';
      // 去重检查
      var dupSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      var { data: existingAlert } = await supabase.from('posts')
        .select('id')
        .eq('media_type', SECURITY_ALERT_MARKER)
        .eq('media_url', 'same_ip_multi_users')
        .eq('user_name', userName)
        .gte('created_at', dupSince)
        .limit(1);
      if (existingAlert && existingAlert.length > 0) return;

      await insertSecurityAlert({
        type: 'same_ip_multi_users',
        level: ipLevel,
        user_name: userName,
        ip: ip,
        ip_location_text: ipLocation ? ipLocation.text : null,
        related_users: [userName].concat(related),
        reason: '同一 IP ' + ip + ' 在 24 小时内登录了 ' + (related.length + 1) + ' 个账号'
      });
    }
  } catch(e) {
    console.warn('[Security] checkSameIpMultiUsers 异常:', e.message || e);
  }
}

// 检查同 device_id 多账号登录
async function checkSameDeviceMultiUsers(userName, deviceId, ip, ipLocation) {
  if (!deviceId) return;
  try {
    var { data } = await supabase.from('posts')
      .select('user_name, content')
      .eq('media_type', LOGIN_EVENT_MARKER)
      .eq('media_url', deviceId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (!data || !data.length) return;

    var deviceUsers = {};
    data.forEach(function(row) {
      if (row.user_name !== userName) {
        deviceUsers[row.user_name] = true;
      }
    });

    var related = Object.keys(deviceUsers);
    if (related.length >= 1) {
      // 去重检查
      var dupSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      var { data: existingAlert } = await supabase.from('posts')
        .select('id')
        .eq('media_type', SECURITY_ALERT_MARKER)
        .eq('media_url', 'same_device_multi_users')
        .eq('user_name', userName)
        .gte('created_at', dupSince)
        .limit(1);
      if (existingAlert && existingAlert.length > 0) return;

      await insertSecurityAlert({
        type: 'same_device_multi_users',
        level: 'high',
        user_name: userName,
        ip: ip,
        ip_location_text: ipLocation ? ipLocation.text : null,
        related_users: [userName].concat(related),
        reason: '同一设备 ID ' + deviceId.slice(0, 12) + '... 登录了 ' + (related.length + 1) + ' 个账号'
      });
    }
  } catch(e) {
    console.warn('[Security] checkSameDeviceMultiUsers 异常:', e.message || e);
  }
}

// 检查同账号短时间内多 IP
async function checkMultiIpSameUser(userName, ip, ipLocation) {
  if (!ip || ip === 'unknown') return;
  var since = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1小时
  try {
    var { data } = await supabase.from('posts')
      .select('content, created_at')
      .eq('media_type', LOGIN_EVENT_MARKER)
      .eq('user_name', userName)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(50);
    if (!data || !data.length) return;

    var ips = {};
    data.forEach(function(row) {
      try {
        var c = JSON.parse(row.content || '{}');
        if (c.ip && c.ip !== ip) {
          ips[c.ip] = true;
        }
      } catch(e) {}
    });

    var diffIps = Object.keys(ips);
    if (diffIps.length >= 2) {
      // 去重检查
      var dupSince = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      var { data: existingAlert } = await supabase.from('posts')
        .select('id')
        .eq('media_type', SECURITY_ALERT_MARKER)
        .eq('media_url', 'multi_ip_same_user')
        .eq('user_name', userName)
        .gte('created_at', dupSince)
        .limit(1);
      if (existingAlert && existingAlert.length > 0) return;

      await insertSecurityAlert({
        type: 'multi_ip_same_user',
        level: 'high',
        user_name: userName,
        ip: ip,
        ip_location_text: ipLocation ? ipLocation.text : null,
        related_users: [userName],
        reason: '账号 ' + userName + ' 在 1 小时内使用了 ' + (diffIps.length + 1) + ' 个不同 IP'
      });
    }
  } catch(e) {
    console.warn('[Security] checkMultiIpSameUser 异常:', e.message || e);
  }
}

// 检查同账号地区变化
async function checkGeoChange(userName, ipLocation, currentLoginAt) {
  if (!ipLocation || !ipLocation.country) return;
  try {
    var { data } = await supabase.from('posts')
      .select('content')
      .eq('media_type', LOGIN_EVENT_MARKER)
      .eq('user_name', userName)
      .lt('created_at', currentLoginAt)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!data || !data.length) return;

    var lastLoc = null;
    for (var i = 0; i < data.length; i++) {
      try {
        var c = JSON.parse(data[i].content || '{}');
        if (c.ip_location && c.ip_location.country) {
          lastLoc = c.ip_location;
          break;
        }
      } catch(e) {}
    }

    if (lastLoc && lastLoc.country !== ipLocation.country) {
      // 去重检查
      var dupSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      var { data: existingAlert } = await supabase.from('posts')
        .select('id')
        .eq('media_type', SECURITY_ALERT_MARKER)
        .eq('media_url', 'geo_change')
        .eq('user_name', userName)
        .gte('created_at', dupSince)
        .limit(1);
      if (existingAlert && existingAlert.length > 0) return;

      await insertSecurityAlert({
        type: 'geo_change',
        level: 'info',
        user_name: userName,
        ip: null,
        ip_location_text: ipLocation.text,
        related_users: [userName],
        reason: '账号 ' + userName + ' 地区从 ' + (lastLoc.text || lastLoc.country) + ' 变为 ' + ipLocation.text
      });
    }
  } catch(e) {
    console.warn('[Security] checkGeoChange 异常:', e.message || e);
  }
}

// 检查同账号短时间内 page_visit 过多
async function checkHighFrequencyVisit(userName, source, ip, ipLocation) {
  if (source !== 'page_visit') return;
  var since = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5分钟
  try {
    var { data } = await supabase.from('posts')
      .select('id')
      .eq('media_type', LOGIN_EVENT_MARKER)
      .eq('user_name', userName)
      .gte('created_at', since)
      .limit(100);
    if (!data || data.length < 30) return;

    // 检查最近是否已生成同类提醒（去重）
    var recentSince = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    var { data: existing } = await supabase.from('posts')
      .select('id')
      .eq('media_type', SECURITY_ALERT_MARKER)
      .eq('media_url', 'high_frequency_visit')
      .eq('user_name', userName)
      .gte('created_at', recentSince)
      .limit(1);

    if (existing && existing.length > 0) return;

    await insertSecurityAlert({
      type: 'high_frequency_visit',
      level: 'info',
      user_name: userName,
      ip: ip,
      ip_location_text: ipLocation ? ipLocation.text : null,
      related_users: [userName],
      reason: '账号 ' + userName + ' 在 5 分钟内产生了 ' + data.length + ' 次页面访问'
    });
  } catch(e) {
    console.warn('[Security] checkHighFrequencyVisit 异常:', e.message || e);
  }
}

// 检查相同浏览器指纹多账号登录
async function checkSameBrowserFingerprintMultiUsers(userName, browserFp, ip, ipLocation) {
  if (!browserFp) return;
  var since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    var { data } = await supabase.from('posts')
      .select('user_name, content')
      .eq('media_type', LOGIN_EVENT_MARKER)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500);
    if (!data || !data.length) return;

    var fpUsers = {};
    data.forEach(function(row) {
      if (row.user_name === userName) return;
      try {
        var c = JSON.parse(row.content || '{}');
        if (c.browser_fingerprint_hash === browserFp) {
          fpUsers[row.user_name] = true;
        }
      } catch(e) {}
    });

    var related = Object.keys(fpUsers);
    if (related.length >= 1) {
      // 去重
      var dupSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      var { data: existingAlert } = await supabase.from('posts')
        .select('id')
        .eq('media_type', SECURITY_ALERT_MARKER)
        .eq('media_url', 'same_browser_fp_multi_users')
        .eq('user_name', userName)
        .gte('created_at', dupSince)
        .limit(1);
      if (existingAlert && existingAlert.length > 0) return;

      await insertSecurityAlert({
        type: 'same_browser_fp_multi_users',
        level: 'warning',
        user_name: userName,
        ip: ip,
        ip_location_text: ipLocation ? ipLocation.text : null,
        related_users: [userName].concat(related),
        reason: '相同浏览器指纹 ' + browserFp.slice(0, 12) + '... 登录了 ' + (related.length + 1) + ' 个账号'
      });
    }
  } catch(e) {
    console.warn('[Security] checkSameBrowserFingerprintMultiUsers 异常:', e.message || e);
  }
}

// 检查相同 Canvas 指纹多账号登录
async function checkSameCanvasFingerprintMultiUsers(userName, canvasFp, ip, ipLocation) {
  if (!canvasFp) return;
  var since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    var { data } = await supabase.from('posts')
      .select('user_name, content')
      .eq('media_type', LOGIN_EVENT_MARKER)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500);
    if (!data || !data.length) return;

    var fpUsers = {};
    data.forEach(function(row) {
      if (row.user_name === userName) return;
      try {
        var c = JSON.parse(row.content || '{}');
        if (c.canvas_fingerprint_hash === canvasFp) {
          fpUsers[row.user_name] = true;
        }
      } catch(e) {}
    });

    var related = Object.keys(fpUsers);
    if (related.length >= 1) {
      // 去重
      var dupSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      var { data: existingAlert } = await supabase.from('posts')
        .select('id')
        .eq('media_type', SECURITY_ALERT_MARKER)
        .eq('media_url', 'same_canvas_fp_multi_users')
        .eq('user_name', userName)
        .gte('created_at', dupSince)
        .limit(1);
      if (existingAlert && existingAlert.length > 0) return;

      await insertSecurityAlert({
        type: 'same_canvas_fp_multi_users',
        level: 'warning',
        user_name: userName,
        ip: ip,
        ip_location_text: ipLocation ? ipLocation.text : null,
        related_users: [userName].concat(related),
        reason: '相同 Canvas 指纹 ' + canvasFp.slice(0, 12) + '... 登录了 ' + (related.length + 1) + ' 个账号'
      });
    }
  } catch(e) {
    console.warn('[Security] checkSameCanvasFingerprintMultiUsers 异常:', e.message || e);
  }
}

// 统一安全检测入口（登录事件写入后调用）
async function runSecurityChecks(userName, deviceId, ip, ipLocation, source, currentLoginAt, browserFp, canvasFp) {
  // 检查安全提醒开关
  try {
    var { data: settingsData } = await supabase.from('posts')
      .select('content')
      .eq('media_type', ADMIN_META_MARKER)
      .eq('media_url', 'security_settings')
      .maybeSingle();
    if (settingsData && settingsData.content) {
      var s = JSON.parse(settingsData.content);
      if (s.security_alerts === false) return;
    }
  } catch(e) {}
  // 并行执行各项检查
  await Promise.allSettled
    ? await Promise.allSettled([
        checkSameIpMultiUsers(userName, ip, ipLocation),
        checkSameDeviceMultiUsers(userName, deviceId, ip, ipLocation),
        checkMultiIpSameUser(userName, ip, ipLocation),
        checkGeoChange(userName, ipLocation, currentLoginAt),
        checkHighFrequencyVisit(userName, source, ip, ipLocation),
        checkSameBrowserFingerprintMultiUsers(userName, browserFp, ip, ipLocation),
        checkSameCanvasFingerprintMultiUsers(userName, canvasFp, ip, ipLocation)
      ])
    : await Promise.all([
        checkSameIpMultiUsers(userName, ip, ipLocation).catch(function(){}),
        checkSameDeviceMultiUsers(userName, deviceId, ip, ipLocation).catch(function(){}),
        checkMultiIpSameUser(userName, ip, ipLocation).catch(function(){}),
        checkGeoChange(userName, ipLocation, currentLoginAt).catch(function(){}),
        checkHighFrequencyVisit(userName, source, ip, ipLocation).catch(function(){}),
        checkSameBrowserFingerprintMultiUsers(userName, browserFp, ip, ipLocation).catch(function(){}),
        checkSameCanvasFingerprintMultiUsers(userName, canvasFp, ip, ipLocation).catch(function(){})
      ]);
}

function rateLimit(windowMs, maxRequests) {
  return (req, res, next) => {
    const key = getRealIp(req) + ':' + req.path;
    const now = Date.now();
    const record = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > record.resetAt) {
      record.count = 1;
      record.resetAt = now + windowMs;
    } else {
      record.count++;
    }

    rateLimitStore.set(key, record);
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - record.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));

    if (record.count >= maxRequests) {
      logAttack(key, 'RATE_LIMIT', req.method + ' ' + req.path);
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    next();
  };
}

// ===================== DeepSeek 统一调用封装 =====================
// ★ 调用 DeepSeek API 的唯一入口
// - API Key 从后端 DEEPSEEK_API_KEY 读取，绝对不出现在前端 / 日志
// - 内置 25s 超时控制（AbortController），避免长请求拖死 Express 进程
// - 未配置 API Key 时返 mock 回复（开发模式 + 本地无 Key 测试）
// - 错误信息统一脱敏，不暴露 DeepSeek 原始错误给前端调用方
async function callDeepSeek(messages, options) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('AI 调用参数无效');
  }

  // 开发模式：API Key 未配置时返 mock 回复
  if (!DEEPSEEK_API_KEY) {
    var lastUser = null;
    for (var i = messages.length - 1; i >= 0; i--) {
      if (messages[i] && messages[i].role === 'user') { lastUser = messages[i].content; break; }
    }
    return {
      content: '[MOCK 回复 · DeepSeek API Key 未配置]\n' +
             '我已收到你的消息：' + String(lastUser || '').slice(0, 80) + '\n\n' +
             '请在 Render Dashboard 配置 DEEPSEEK_API_KEY 后重启服务即可使用真实模型。',
      usage: null
    };
  }

  var thinkingLevel = (options && options.thinking_mode) || 'off';
  var useThinking = thinkingLevel !== 'off';
  var model = DEEPSEEK_MODEL_REASONER;
  if (options && options.model) model = options.model;
  var reasoningEffort = useThinking ? thinkingLevel : '';
  try { console.log('[DEEPSEEK] thinking_mode:', thinkingLevel, 'useThinking:', useThinking, 'model:', model, 'reasoning_effort:', reasoningEffort); } catch (e) {}
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, useThinking ? 60000 : DEEPSEEK_TIMEOUT_MS);

  try {
    var apiBody = {
      model: model,
      messages: messages,
      stream: false
    };
    // DeepSeek v4 thinking 模式：
    //   - thinking: { type: 'enabled' }   启用思考
    //   - reasoning_effort: 'low' | 'medium' | 'high'   思考强度
    // 关闭时不传 thinking 字段，也不传 reasoning_effort
    if (useThinking) {
      apiBody.thinking = { type: 'enabled' };
      apiBody.reasoning_effort = thinkingLevel;
    }
    var resp = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + DEEPSEEK_API_KEY
      },
      body: JSON.stringify(apiBody),
      signal: controller.signal
    });
    clearTimeout(timer);

    var data = await resp.json().catch(function() { return {}; });

    if (!resp.ok) {
      var deepErr = data && data.error && data.error.message ? String(data.error.message).slice(0, 200) : '';
      console.error('[DEEPSEEK] API error', resp.status, deepErr);
      // 检测模型不支持思考模式：DeepSeek 返回的 error 包含 "thinking" / "reasoning_effort" 关键词
      if (useThinking && (deepErr.indexOf('thinking') >= 0 || deepErr.indexOf('reasoning_effort') >= 0 || resp.status === 400)) {
        throw new Error('AI 调用失败：当前模型不支持思考模式，请关闭思考模式后重试');
      }
      throw new Error('AI 调用失败（HTTP ' + resp.status + '）');
    }

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('[DEEPSEEK] unexpected response shape');
      throw new Error('AI 返回格式异常');
    }

    var content = data.choices[0].message.content;
    if (typeof content !== 'string') content = '';

    // ★ 关键：off 模式强制清空 reasoning，即使模型返回了 reasoning_content
    var reasoning = '';
    if (useThinking) {
      reasoning = data.choices[0].message.reasoning_content;
      if (typeof reasoning !== 'string') reasoning = '';
    }

    // 解析 usage
    var usage = null;
    if (data.usage) {
      usage = {
        prompt_tokens: data.usage.prompt_tokens || 0,
        completion_tokens: data.usage.completion_tokens || 0,
        total_tokens: data.usage.total_tokens || 0,
        prompt_cache_hit_tokens: typeof data.usage.prompt_cache_hit_tokens === 'number' ? data.usage.prompt_cache_hit_tokens : null,
        prompt_cache_miss_tokens: typeof data.usage.prompt_cache_miss_tokens === 'number' ? data.usage.prompt_cache_miss_tokens : null
      };
      // 计算费用
      // ★ 关键修复：prompt_cache_miss_tokens = 0 时不能再 fallback 到 prompt_tokens，
      //   否则全缓存命中会按全未命中计费（多花几倍钱）。
      //   用 typeof === 'number' 严格判断。
      //   老 API 字段：仅给 prompt_tokens 和 hit_tokens，miss = prompt - hit 算出来
      var cost = null;
      var hit = typeof usage.prompt_cache_hit_tokens === 'number' ? usage.prompt_cache_hit_tokens : 0;
      var miss;
      if (typeof usage.prompt_cache_miss_tokens === 'number') {
        miss = usage.prompt_cache_miss_tokens;
      } else {
        miss = Math.max(0, usage.prompt_tokens - hit);
      }
      if (DEEPSEEK_INPUT_PRICE_PER_1M || DEEPSEEK_OUTPUT_PRICE_PER_1M) {
        var inputCost  = (miss * DEEPSEEK_INPUT_PRICE_PER_1M / 1000000) + (hit * DEEPSEEK_CACHE_HIT_PRICE_PER_1M / 1000000);
        var outputCost = (usage.completion_tokens * DEEPSEEK_OUTPUT_PRICE_PER_1M / 1000000);
        cost = Math.round((inputCost + outputCost) * 1000000) / 1000000;
      }
      usage.cost = cost;
      usage.currency = DEEPSEEK_CURRENCY;
    }

    return { content: content, reasoning: reasoning, usage: usage, model: model };
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') {
      console.error('[DEEPSEEK] request timeout after', DEEPSEEK_TIMEOUT_MS, 'ms');
      throw new Error('AI 调用超时，请稍后再试');
    }
    if (e && e.message && (e.message.indexOf('AI 调用失败') === 0 || e.message.indexOf('AI 返回格式') === 0)) throw e;
    console.error('[DEEPSEEK] unexpected error:', e && e.message);
    throw new Error('AI 调用异常，请稍后再试');
  }
}

// ===================== AI 用户级限流（按 userName 而非 IP） =====================
// ★ AI 智能体调用按 userName 限流，避免 IP 共享用户互相挤占额度
// 限流维度：每用户每天 AI_AGENT_DAILY_LIMIT 次 / 每小时 AI_AGENT_HOURLY_LIMIT 次
var aiUserRateStore = new Map(); // userName -> { hourly: {count, resetAt}, daily: {count, resetAt} }
function checkAiUserRateLimit(userName) {
  if (!userName) return { allowed: false, reason: 'no_user' };
  var now = Date.now();
  var record = aiUserRateStore.get(userName) || {
    hourly: { count: 0, resetAt: now + 3600000 },
    daily:  { count: 0, resetAt: now + 86400000 }
  };

  // 重置窗口
  if (now > record.hourly.resetAt) {
    record.hourly = { count: 1, resetAt: now + 3600000 };
  } else {
    record.hourly.count++;
  }
  if (now > record.daily.resetAt) {
    record.daily = { count: 1, resetAt: now + 86400000 };
  } else {
    record.daily.count++;
  }
  aiUserRateStore.set(userName, record);

  if (record.hourly.count > AI_AGENT_HOURLY_LIMIT) {
    return { allowed: false, reason: 'hourly_limit', remainingHour: 0, remainingDay: Math.max(0, AI_AGENT_DAILY_LIMIT - record.daily.count) };
  }
  if (record.daily.count > AI_AGENT_DAILY_LIMIT) {
    return { allowed: false, reason: 'daily_limit', remainingHour: Math.max(0, AI_AGENT_HOURLY_LIMIT - record.hourly.count), remainingDay: 0 };
  }
  return {
    allowed: true,
    remainingHour: Math.max(0, AI_AGENT_HOURLY_LIMIT - record.hourly.count),
    remainingDay:  Math.max(0, AI_AGENT_DAILY_LIMIT  - record.daily.count)
  };
}

// ===================== Token 管理（无状态签名令牌，服务重启不掉登录） =====================
const adminTokens = new Map(); // token -> { expiresAt }（仅用于延长有效期跟踪）
const revokedTokens = new Map(); // token -> expiry（主动退出的令牌，过期前拒绝使用）
// 每10分钟清理过期 token
setInterval(function() {
  var now = Date.now();
  adminTokens.forEach(function(session, token) {
    if (now > session.expiresAt) adminTokens.delete(token);
  });
  revokedTokens.forEach(function(expiry, token) {
    if (now > expiry) revokedTokens.delete(token);
  });
}, 600000);

// 生成签名 token：base64(payload) + '.' + HMAC
function _signPayload(payload) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', API_SECRET).update(b64).digest('base64url');
  return b64 + '.' + sig;
}

function _verifyToken(token) {
  try {
    var parts = token.split('.');
    if (parts.length !== 2) return null;
    var b64 = parts[0], sig = parts[1];
    var expectedSig = crypto.createHmac('sha256', API_SECRET).update(b64).digest('base64url');
    var sigBuf = Buffer.from(sig);
    var expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    var payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch(e) { return null; }
}

function signToken() {
  return _signPayload({ exp: Date.now() + TOKEN_EXPIRY_MS, user: ADMIN_USERNAME });
}

function verifySignedToken(token) {
  return _verifyToken(token);
}

function signUserToken(userName, expireHours) {
  var USER_TOKEN_EXPIRY_MS = (expireHours || 720) * 60 * 60 * 1000;
  return _signPayload({ exp: Date.now() + USER_TOKEN_EXPIRY_MS, user_name: userName, type: 'user' });
}

function verifyUserToken(token) {
  var payload = _verifyToken(token);
  if (!payload || payload.type !== 'user' || !payload.user_name) return null;
  return payload;
}

function _getTokenFromRequest(req) {
  var authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return '';
}

// ===== 吊销 token 持久化 =====
const REVOKED_TOKEN_MARKER = '__revoked_token__';

async function persistRevokedToken(token, expiresAt) {
  try {
    await supabase.from('posts').insert([{
      content: JSON.stringify({ token_hash: crypto.createHash('sha256').update(token).digest('hex'), expires_at: expiresAt }),
      media_type: REVOKED_TOKEN_MARKER,
      media_url: crypto.createHash('sha256').update(token).digest('hex'),
      user_name: ADMIN_USERNAME
    }]);
    revokedTokenHashes.add(crypto.createHash('sha256').update(token).digest('hex'));
  } catch(e) { console.warn('[Revoke] 持久化撤销失败:', e.message); }
}

async function loadRevokedTokenHashes() {
  try {
    var now = new Date().toISOString();
    var { data } = await supabase.from('posts')
      .select('id, media_url, content')
      .eq('media_type', REVOKED_TOKEN_MARKER)
      .not('media_url', 'is', null);
    (data || []).forEach(function(row) {
      try {
        var info = JSON.parse(row.content || '{}');
        if (info.expires_at && new Date(info.expires_at).getTime() > Date.now()) {
          revokedTokenHashes.add(row.media_url);
        }
      } catch(e) {}
    });
    // 清理过期吊销记录
    for (var i = 0; i < (data || []).length; i++) {
      try {
        var r = data[i];
        var info = JSON.parse(r.content || '{}');
        if (info.expires_at && new Date(info.expires_at).getTime() <= Date.now()) {
          supabase.from('posts').delete().eq('id', r.id).then(function(){}).catch(function(){});
        }
      } catch(e) {}
    }
  } catch(e) { console.warn('[Revoke] 加载吊销列表失败:', e.message); }
}

var revokedTokenHashes = new Set();
loadRevokedTokenHashes().catch(function(){});

function isTokenRevoked(token) {
  if (revokedTokens.has(token)) return true;
  var hash = crypto.createHash('sha256').update(token).digest('hex');
  return revokedTokenHashes.has(hash);
}

function verifyToken(req, res, next) {
  var token = _getTokenFromRequest(req);

  // 从 HttpOnly Cookie 读取（优先级高于 Authorization header）
  if (!token && req.cookies && req.cookies.xtj_admin_token) {
    token = req.cookies.xtj_admin_token;
  }

  if (!token) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  if (isTokenRevoked(token)) {
    return res.status(401).json({ error: '令牌已注销，请重新登录' });
  }

  var payload = verifySignedToken(token);
  if (payload) {
    req.adminToken = token;
    req.adminName = payload.user || payload.user_name || 'admin';
    return next();
  }

  const session = adminTokens.get(token);
  if (!session || Date.now() > session.expiresAt) {
    adminTokens.delete(token);
    return res.status(401).json({ error: '令牌已过期或无效，请重新登录' });
  }

  session.expiresAt = Date.now() + TOKEN_EXPIRY_MS;
  req.adminToken = token;
  req.adminName = session.userName || 'admin';
  next();
}

// ===================== 健康检查 ======================
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// 邮件配置健康检查（无需鉴权，便于排查 GAS / SendGrid 配置）
app.get('/health/mail', (req, res) => {
  res.json({
    ok: true,
    mail_config: {
      GMAIL_USER: GMAIL_USER ? '已设置' : '未设置',
      GMAIL_APP_PASSWORD: GMAIL_APP_PASSWORD ? '已设置' : '未设置',
      SENDGRID_API_KEY: process.env.SENDGRID_API_KEY ? '已设置' : '未设置',
      GMAIL_GAS_URL: process.env.GMAIL_GAS_URL ? '已设置' : '未设置',
      active_provider: GMAIL_GAS_URL ? 'GAS' : (process.env.SENDGRID_API_KEY ? 'SendGrid' : 'Gmail_SMTP')
    }
  });
});

// ===================== 管理员登录 ======================
app.post('/admin/login', rateLimit(60000, 10), async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: '请输入账号和密码' });
  }
  
  // 输入长度校验
  if (username.length > MAX_USERNAME_LEN) {
    return res.status(400).json({ error: '账号格式不正确' });
  }
  if (password.length > 128) {
    return res.status(400).json({ error: '密码格式不正确' });
  }
  
  // 防止用户名枚举：无论用户名是否存在，都进行密码比对，返回统一错误
  if (username !== ADMIN_USERNAME || !ADMIN_PASSWORD) {
    // 用户名不存在或密码未配置 → 执行虚拟比对防时序
    const dummyPw = Buffer.from('dummy');
    const dummyAdmin = Buffer.from('dummy');
    crypto.timingSafeEqual(dummyPw, dummyAdmin);
    return res.status(401).json({ error: '账号或密码错误' });
  }
  // 使用 timingSafeEqual 防止时序侧信道攻击
  const pwBuf = Buffer.from(password);
  const adminBuf = Buffer.from(ADMIN_PASSWORD);
  const pwMatch = pwBuf.length === adminBuf.length && crypto.timingSafeEqual(pwBuf, adminBuf);
  if (!pwMatch) {
    return res.status(401).json({ error: '账号或密码错误' });
  }
  
  const token = signToken();
  adminTokens.set(token, { expiresAt: Date.now() + TOKEN_EXPIRY_MS });

  // 记录管理员登录设备/IP
  logAdminLoginEvent(req).catch(function(){});

  // 设置 HttpOnly Secure SameSite Cookie（XSS 无法窃取）
  try {
    var cookieOpts = {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: ADMIN_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000,
      path: '/'
    };
    res.cookie('xtj_admin_token', token, cookieOpts);
  } catch(e) {}

  return res.json({ ok: true, username: ADMIN_USERNAME });
});

// ===================== 用户 Token 认证（JWT 替代 password_hash） =====================
const USER_TOKEN_HEADER_HOURS = 720; // 用户 token 有效期 30 天

async function authenticateUser(req, res, next) {
  // 优先验证 Authorization header 中的用户 token
  var token = _getTokenFromRequest(req);
  if (token) {
    var payload = verifyUserToken(token);
    if (payload && payload.user_name) {
      // 确认该用户仍存在于系统中
      try {
        var { data: userExists } = await supabase.from('posts')
          .select('id')
          .eq('user_name', payload.user_name)
          .eq('media_type', AUTH_MARKER)
          .maybeSingle();
        if (!userExists) {
          return res.status(401).json({ error: '用户不存在或已注销' });
        }
      } catch(e) {
        return res.status(500).json({ error: '认证查询失败' });
      }
      req.userName = payload.user_name;
      return next();
    }
  }

  // 兼容旧 password_hash（逐步废弃）
  // ★ 关键修复：GET 请求 req.body 可能为空，必须从 req.query 兜底
  //   同时确保 password_hash 也能从 query 读取（前端 GET history 走 query 兜底）
  var body = req.body || {};
  var query = req.query || {};
  var password_hash = body.password_hash || query.password_hash || '';
  var userName = body.user_name || query.user_name || body.reporter_name || query.reporter_name || '';
  var userNameVal = validateString(userName, MAX_USERNAME_LEN, '用户名');
  if (!userNameVal || !password_hash) {
    return res.status(401).json({ error: '缺少身份验证' });
  }
  try {
    var { data: authRec } = await supabase.from('posts')
      .select('media_url')
      .eq('user_name', userNameVal)
      .eq('media_type', AUTH_MARKER)
      .maybeSingle();
    if (!authRec || authRec.media_url !== password_hash) {
      return res.status(403).json({ error: '身份验证失败' });
    }
    req.userName = userNameVal;
    next();
  } catch(e) {
    return res.status(500).json({ error: '认证查询失败' });
  }
}

// 用户登录/获取 token（用 password_hash 换取 JWT token）
app.post('/api/user/login', rateLimit(60000, 10), async (req, res) => {
  try {
    var { user_name, password_hash } = req.body;
    var userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
    if (!userNameVal || !password_hash) {
      return res.status(400).json({ error: '缺少用户名或密码' });
    }
    var { data: authRec } = await supabase.from('posts')
      .select('media_url')
      .eq('user_name', userNameVal)
      .eq('media_type', AUTH_MARKER)
      .maybeSingle();
    if (!authRec || authRec.media_url !== password_hash) {
      return res.status(401).json({ error: '账号或密码错误' });
    }
    var token = signUserToken(userNameVal);
    return res.json({ ok: true, token: token, user_name: userNameVal });
  } catch(e) {
    console.error('[API] 用户登录失败:', e.message);
    return res.status(500).json({ error: '登录失败' });
  }
});

// 验证 token 是否有效
app.get('/admin/verify', verifyToken, (req, res) => {
  return res.json({ ok: true });
});

// 管理员登出
app.post('/admin/logout', verifyToken, (req, res) => {
  var token = req.adminToken;
  adminTokens.delete(token);
  var payload = verifySignedToken(token);
  var exp = payload ? payload.exp : Date.now() + TOKEN_EXPIRY_MS;
  revokedTokens.set(token, exp);
  persistRevokedToken(token, exp).catch(function(){});
  res.clearCookie('xtj_admin_token', { path: '/' });
  return res.json({ ok: true });
});

// ===================== 自动过期函数 ======================
async function autoExpireOverdueRecords() {
  const now = new Date().toISOString();
  try {
    // 自动解除过期的封禁
    await supabase.from('bans').update({
      is_active: false, lifted_at: now, lifted_by: 'system'
    }).eq('is_active', true).lt('expires_at', now).not('expires_at', 'is', null);

    // 自动解除过期的禁言
    await supabase.from('mutes').update({
      is_active: false, lifted_at: now, lifted_by: 'system'
    }).eq('is_active', true).lt('expires_at', now).not('expires_at', 'is', null);

    // 自动解除过期的黑名单
    await supabase.from('blacklist').update({
      is_active: false, lifted_at: now, lifted_by: 'system'
    }).eq('is_active', true).lt('expires_at', now).not('expires_at', 'is', null);
  } catch (e) {
    console.warn('[auto-expire] 检查失败:', e.message);
  }
}

// ===================== 数据加载（只读，但需要认证） ======================
app.get('/admin/data', verifyToken, rateLimit(60000, 30), async (req, res) => {
  try {
    // 每次加载管理后台数据时，先检查并自动解除过期记录
    autoExpireOverdueRecords().catch(function() {});

    const [postRes, likeRes, commRes, banRes, annRes] = await Promise.all([
      applyPublicPostExclusions(supabase.from('posts').select('*')).order('created_at', { ascending: false }).limit(5000),
      supabase.from('likes').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('comments').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('bans').select('*').order('banned_at', { ascending: false }).limit(500),
      supabase.from('posts').select('*').eq('media_type', '__ann__').order('created_at', { ascending: false }).limit(500)
    ]);
    
    return res.json({
      posts: postRes.data || [],
      likes: likeRes.data || [],
      comments: commRes.data || [],
      bans: banRes.data || [],
      announcements: annRes.data || []
    });
  } catch (e) {
    console.error('[API] 数据加载失败:', e.message);
    return res.status(500).json({ error: '数据加载失败' });
  }
});

// ===================== 公告管理 ======================
app.post('/admin/announcement', verifyToken, rateLimit(60000, 20), async (req, res) => {
  const { title, content } = req.body;
  if (!title && !content) {
    return res.status(400).json({ error: '请至少填写标题或内容' });
  }
  
  const titleVal = validateString(title, MAX_TITLE_LEN, '标题');
  if (titleVal && titleVal.error) return res.status(400).json({ error: titleVal.error });
  const contentVal = validateString(content, MAX_CONTENT_LEN, '内容');
  if (contentVal && contentVal.error) return res.status(400).json({ error: contentVal.error });
  
  const storeData = JSON.stringify({ title: titleVal || '', content: contentVal || '' });
  const { data, error } = await supabase.from('posts').insert([{
    user_name: ADMIN_USERNAME,
    content: storeData,
    media_type: '__ann__',
    media_url: '',
    actor_key: 'admin_' + Date.now()
  }]).select().single();
  
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true, data });
});

app.delete('/admin/announcement/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { data: post } = await supabase.from('posts').select('actor_key').eq('id', id).maybeSingle();
  const actorKey = (post && post.actor_key) || 'admin_' + Date.now();
  const { error } = await supabase.rpc('delete_post_with_actor', {
    p_post_id: id,
    p_actor_key: actorKey
  });
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true });
});

// ===================== 公告已读（跨设备同步） ======================
// 复用 posts marker（media_type=__ann_read__, media_url=announcementId）
// 同一用户对同一公告只允许一条记录（actor_key 唯一 + 23505 错误处理）
app.get('/api/announcements/read', async (req, res) => {
  try {
    const auth = await authenticateUser(req);
    if (!auth) {
      return res.status(401).json({ error: '未授权' });
    }
    const { data, error } = await supabase
      .from('posts')
      .select('media_url, created_at')
      .eq('media_type', ANN_READ_MARKER)
      .eq('user_name', auth.userName);
    if (error) {
      console.error('[ann_read_get]', error);
      return res.status(500).json({ error: '查询已读记录失败' });
    }
    // 返回 {id: read_at_iso} 格式，前端可 Set 化
    const reads = {};
    (data || []).forEach(function(row) {
      if (row && row.media_url) {
        reads[String(row.media_url)] = row.created_at || null;
      }
    });
    return res.json({ reads: reads });
  } catch (err) {
    console.error('[ann_read_get_exception]', err);
    return res.status(500).json({ error: '查询失败' });
  }
});

app.post('/api/announcements/read', async (req, res) => {
  try {
    const auth = await authenticateUser(req);
    if (!auth) {
      return res.status(401).json({ error: '未授权' });
    }
    const body = req.body || {};
    let ids = body.announcement_ids;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'announcement_ids 必须是数组' });
    }
    if (ids.length > 100) {
      return res.status(400).json({ error: '一次最多 100 条' });
    }
    // 清洗 + 去重 + 限长
    const seen = new Set();
    const cleanIds = [];
    for (const raw of ids) {
      if (raw === undefined || raw === null) continue;
      const s = String(raw).trim();
      if (!s) continue;
      if (s.length > 128) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      cleanIds.push(s);
    }
    if (!cleanIds.length) {
      return res.json({ ok: true, marked: 0 });
    }
    // 查询已存在记录，避免重复插入
    const { data: existing, error: existErr } = await supabase
      .from('posts')
      .select('media_url')
      .eq('media_type', ANN_READ_MARKER)
      .eq('user_name', auth.userName)
      .in('media_url', cleanIds);
    if (existErr) {
      console.error('[ann_read_existing]', existErr);
      return res.status(500).json({ error: '查询已读失败' });
    }
    const existingSet = new Set((existing || []).map(function(r) { return r && r.media_url ? String(r.media_url) : null; }).filter(Boolean));
    const toInsert = cleanIds.filter(function(id) { return !existingSet.has(id); });
    if (!toInsert.length) {
      return res.json({ ok: true, marked: 0, already_read: cleanIds.length });
    }
    // 批量插入（每条记录 actor_key 唯一）
    const rows = toInsert.map(function(id) {
      return {
        user_name: auth.userName,
        content: '',
        media_type: ANN_READ_MARKER,
        media_url: id,
        actor_key: 'ann_read:' + auth.userName + ':' + id
      };
    });
    const { error: insErr } = await supabase
      .from('posts')
      .insert(rows);
    if (insErr) {
      // 23505 = 唯一约束冲突（并发情况），当作成功处理
      if (insErr.code === '23505') {
        return res.json({ ok: true, marked: toInsert.length, note: '部分已存在' });
      }
      console.error('[ann_read_insert]', insErr);
      return res.status(500).json({ error: '保存已读失败' });
    }
    return res.json({ ok: true, marked: toInsert.length });
  } catch (err) {
    console.error('[ann_read_post_exception]', err);
    return res.status(500).json({ error: '保存失败' });
  }
});

// ===================== 帖子管理 ======================
app.delete('/admin/post/:id', verifyToken, async (req, res) => {
  var auditUser = 'unknown';
  try {
    var token = (req.headers.authorization || '').replace('Bearer ', '');
    var parts = token.split('.');
    if (parts.length >= 2) {
      var payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      auditUser = payload.user || 'unknown';
    }
  } catch(e) {}
  const { id } = req.params;
  // 先获取帖子的 actor_key
  const { data: post } = await supabase.from('posts').select('actor_key').eq('id', id).maybeSingle();
  const actorKey = (post && post.actor_key) || 'admin_' + Date.now();
  
  const { error } = await supabase.rpc('delete_post_with_actor', {
    p_post_id: id,
    p_actor_key: actorKey
  });
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  await logAdminAudit('delete_post', auditUser, 'post_id:' + id);
  return res.json({ ok: true });
});

// ===================== 评论管理 ======================
app.delete('/admin/comment/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.rpc('delete_comment_v2', {
    p_comment_id: id,
    p_deleted_by: ADMIN_USERNAME
  });
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true, data });
});

// ===================== 举报通知辅助函数 ======================
async function addReportNotification(reportId, action, message) {
  try {
    const { data: post } = await supabase.from('posts').select('content').eq('id', reportId).maybeSingle();
    if (!post) return;
    var c = {};
    try { c = JSON.parse(post.content || '{}'); } catch(e) {}
    if (!Array.isArray(c.notifications)) c.notifications = [];
    c.notifications.push({
      action: action,
      message: message,
      is_read: false,
      created_at: new Date().toISOString()
    });
    await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', reportId);
  } catch(e) { console.warn('[notif] 通知写入失败:', e.message); }
}

// ===================== 举报通知查询 API ======================
app.get('/api/report/notifications', authenticateUser, async (req, res) => {
  const userName = req.userName;
  try {
    const { data, error } = await supabase.from('posts')
      .select('id, content')
      .eq('user_name', userName)
      .eq('media_type', '__report__')
      .order('created_at', { ascending: false })
      .limit(160);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    var unread = 0;
    (data || []).forEach(function(p) {
      try {
        var c = JSON.parse(p.content || '{}');
        if (Array.isArray(c.notifications)) {
          unread += c.notifications.filter(function(n) { return !n.is_read; }).length;
        }
      } catch(e) {}
    });
    return res.json({ unread: unread });
  } catch(e) { return res.status(500).json({ error: '查询失败' }); }
});

app.post('/api/report/notifications/mark-read', authenticateUser, async (req, res) => {
  const userName = req.userName;
  try {
    const { data, error } = await supabase.from('posts')
      .select('id, content')
      .eq('user_name', user_name)
      .eq('media_type', '__report__');
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    for (var i = 0; i < (data || []).length; i++) {
      var p = data[i];
      try {
        var c = JSON.parse(p.content || '{}');
        if (Array.isArray(c.notifications) && c.notifications.some(function(n) { return !n.is_read; })) {
          c.notifications.forEach(function(n) { n.is_read = true; });
          await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', p.id);
        }
      } catch(e) {}
    }
    return res.json({ ok: true });
  } catch(e) { return res.status(500).json({ error: '操作失败' }); }
});

// ===================== 照片管理 ======================
app.get('/admin/photos', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('posts')
    .select('id, user_name, content, media_url, actor_key, created_at, views, is_deleted, deleted_at, deleted_by')
    .eq('media_type', '__photo_wall__')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ data });
});

app.delete('/admin/photo/:id', verifyToken, async (req, res) => {
  var auditUser = 'unknown';
  try {
    var token = (req.headers.authorization || '').replace('Bearer ', '');
    var parts = token.split('.');
    if (parts.length >= 2) {
      var payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      auditUser = payload.user || 'unknown';
    }
  } catch(e) {}
  const { id } = req.params;
  const { error } = await supabase.from('posts').update({
    is_deleted: true,
    deleted_at: new Date().toISOString(),
    deleted_by: 'admin'
  }).eq('id', id).eq('media_type', '__photo_wall__');
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  await logAdminAudit('delete_photo', auditUser, 'photo_id:' + id);
  return res.json({ ok: true });
});

app.post('/admin/photo/restore/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('posts').update({
    is_deleted: false,
    deleted_at: null,
    deleted_by: null
  }).eq('id', id).eq('media_type', '__photo_wall__');
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true });
});

// ===================== 用户照片删除 API（使用 service_role 绕过 RLS） ======================
app.post('/api/photo/delete', rateLimit(60000, 20), async (req, res) => {
  try {
    const { photoId, username, password_hash, currentUser } = req.body;
    if (!photoId) return res.status(400).json({ error: '缺少照片ID' });
    if (!username) return res.status(400).json({ error: '缺少用户名' });

    // 优先验证 token（兼容旧 password_hash）
    var token = _getTokenFromRequest(req);
    var tokenUser = null;
    if (token) {
      var payload = verifyUserToken(token);
      if (payload && payload.user_name) tokenUser = payload.user_name;
    }

    const isAdmin = currentUser === ADMIN_USERNAME;

    if (isAdmin) {
      // 管理员：使用 password_hash 验证管理员身份标记（非 JWT admin token）
      if (!password_hash) return res.status(401).json({ error: '缺少身份验证' });
      const { data: adminAuth } = await supabase.from('posts')
        .select('media_url')
        .eq('user_name', ADMIN_USERNAME)
        .eq('media_type', ADMIN_AUTH_MARKER)
        .maybeSingle();
      if (!adminAuth || adminAuth.media_url !== password_hash) {
        return res.status(403).json({ error: '管理员身份验证失败' });
      }
    } else {
      // 普通用户：优先使用 token 认证，回退到 password_hash
      if (!tokenUser) {
        if (!password_hash) return res.status(401).json({ error: '缺少身份验证' });
        const { data: authRec } = await supabase.from('posts')
          .select('media_url')
          .eq('user_name', username)
          .eq('media_type', AUTH_MARKER)
          .maybeSingle();
        if (!authRec || authRec.media_url !== password_hash) {
          return res.status(403).json({ error: '身份验证失败' });
        }
      } else if (tokenUser !== username) {
        return res.status(403).json({ error: '身份验证失败' });
      }

      const { data: photo } = await supabase.from('posts')
        .select('user_name')
        .eq('id', photoId)
        .maybeSingle();

      if (!photo) return res.status(404).json({ error: '照片不存在' });
      if (photo.user_name !== username) return res.status(403).json({ error: '无权删除此照片' });
    }

    // 硬删除：获取 media_url 后从 Storage 和 DB 双清
    const { data: photo } = await supabase.from('posts')
      .select('media_url')
      .eq('id', photoId)
      .maybeSingle();
    var storagePath = null;
    if (photo && photo.media_url) {
      try {
        var parsed = new URL(photo.media_url);
        var match = parsed.pathname.match(/\/object\/public\/uploads\/(.*)$/) || parsed.pathname.match(/\/uploads\/(.*)$/);
        storagePath = match && match[1] ? decodeURIComponent(match[1]) : null;
        if (storagePath && storagePath.indexOf('..') >= 0) storagePath = null;
      } catch(_) {}
    }
    if (storagePath) {
      try { await supabase.storage.from('uploads').remove([storagePath]); } catch(_) {}
    }
    const { error } = await supabase.from('posts').delete().eq('id', photoId);
    if (error) return res.status(400).json({ error: sanitizeError(error) });

    return res.json({ ok: true });
  } catch(e) {
    console.error('[API] 照片删除失败:', e.message);
    return res.status(500).json({ error: '删除失败' });
  }
});

// ===================== 封禁管理 ======================
app.get('/admin/bans', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('bans').select('*').order('banned_at', { ascending: false }).limit(500);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ data });
});

app.post('/admin/ban', verifyToken, rateLimit(60000, 30), async (req, res) => {
  var auditUser = 'unknown';
  try {
    var token = (req.headers.authorization || '').replace('Bearer ', '');
    var parts = token.split('.');
    if (parts.length >= 2) {
      var payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      auditUser = payload.user || 'unknown';
    }
  } catch(e) {}
  const { user_name, duration_hours, reason } = req.body;
  const durationCheck = validateDurationHours(duration_hours);
  if (durationCheck.error) return res.status(400).json({ error: durationCheck.error });
  const durationHoursVal = durationCheck.value;
  if (!user_name) return res.status(400).json({ error: '缺少用户名' });
  
  const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
  if (userNameVal && userNameVal.error) return res.status(400).json({ error: userNameVal.error });
  if (isProtectedAdminTarget(userNameVal)) return res.status(403).json({ error: 'Operation not allowed for admin user' });
  const reasonVal = validateString(reason, MAX_REASON_LEN, '原因');
  if (reasonVal && reasonVal.error) return res.status(400).json({ error: reasonVal.error });
  
  const banType = durationHoursVal === 0 ? 'permanent' : 'temporary';
  let expiresAt = null;
  if (durationHoursVal > 0) {
    expiresAt = new Date(Date.now() + durationHoursVal * 3600000).toISOString();
  }
  
  const { data: existing } = await supabase.from('bans').select('id, is_active').eq('user_name', userNameVal);
  if (existing && existing.length) {
    const activeBan = existing.find(b => b.is_active);
    if (activeBan) return res.status(409).json({ error: '该用户已被拉黑封禁' });
    
    const { error } = await supabase.from('bans').update({
      ban_reason: reasonVal || '违反社区规定',
      ban_duration_hours: durationHoursVal,
      ban_type: banType,
      banned_by: ADMIN_USERNAME,
      expires_at: expiresAt,
      is_active: true,
      banned_at: new Date().toISOString()
    }).eq('id', existing[0].id);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
  } else {
    const { error } = await supabase.from('bans').insert([{
      user_name: userNameVal, ban_type: banType, ban_reason: reasonVal || '违反社区规定',
      ban_duration_hours: durationHoursVal,
      banned_by: ADMIN_USERNAME, expires_at: expiresAt, is_active: true
    }]);
    if (error) {
      if (error.code === '23505') {
        const { error: updErr } = await supabase.from('bans').update({
          ban_reason: reasonVal || '违反社区规定',
          ban_duration_hours: durationHoursVal,
          ban_type: banType,
          banned_by: ADMIN_USERNAME,
          expires_at: expiresAt,
          is_active: true,
          banned_at: new Date().toISOString()
        }).eq('user_name', userNameVal);
        if (updErr) return res.status(400).json({ error: sanitizeError(updErr) });
      } else {
        return res.status(400).json({ error: sanitizeError(error) });
      }
    }
  }
  
  await logAdminAudit('ban_user', auditUser, 'user:' + userNameVal);
  return res.json({ ok: true });
});

app.put('/admin/ban/:id/lift', verifyToken, async (req, res) => {
  var auditUser = 'unknown';
  try {
    var token = (req.headers.authorization || '').replace('Bearer ', '');
    var parts = token.split('.');
    if (parts.length >= 2) {
      var payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      auditUser = payload.user || 'unknown';
    }
  } catch(e) {}
  const { id } = req.params;
  const { error } = await supabase.from('bans').update({
    is_active: false, lifted_at: new Date().toISOString(), lifted_by: ADMIN_USERNAME
  }).eq('id', id);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  await logAdminAudit('unban_user', auditUser, 'ban_id:' + id);
  return res.json({ ok: true });
});

// ===================== 禁言管理 ======================
app.get('/admin/mutes', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('mutes').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ data });
});

app.post('/admin/mute', verifyToken, rateLimit(60000, 30), async (req, res) => {
  var auditUser = 'unknown';
  try {
    var token = (req.headers.authorization || '').replace('Bearer ', '');
    var parts = token.split('.');
    if (parts.length >= 2) {
      var payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      auditUser = payload.user || 'unknown';
    }
  } catch(e) {}
  const { user_name, duration_hours, reason } = req.body;
  const durationCheck = validateDurationHours(duration_hours);
  if (durationCheck.error) return res.status(400).json({ error: durationCheck.error });
  const durationHoursVal = durationCheck.value;
  if (!user_name) return res.status(400).json({ error: '缺少用户名' });
  
  const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
  if (userNameVal && userNameVal.error) return res.status(400).json({ error: userNameVal.error });
  const reasonVal = validateString(reason, MAX_REASON_LEN, '原因');
  if (reasonVal && reasonVal.error) return res.status(400).json({ error: reasonVal.error });
  if (isProtectedAdminTarget(userNameVal)) return res.status(403).json({ error: 'Operation not allowed for admin user' });
  
  let expiresAt = null;
  if (durationHoursVal > 0) {
    expiresAt = new Date(Date.now() + durationHoursVal * 3600000).toISOString();
  }
  
  const { error } = await supabase.from('mutes').insert([{
    user_name: userNameVal,
    reason: reasonVal || '违反社区规定',
    duration_hours: durationHoursVal,
    muted_by: ADMIN_USERNAME,
    expires_at: expiresAt,
    is_active: true
  }]);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  
  await logAdminAudit('mute_user', auditUser, 'user:' + userNameVal);
  return res.json({ ok: true });
});

app.put('/admin/mute/:id/lift', verifyToken, async (req, res) => {
  var auditUser = 'unknown';
  try {
    var token = (req.headers.authorization || '').replace('Bearer ', '');
    var parts = token.split('.');
    if (parts.length >= 2) {
      var payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      auditUser = payload.user || 'unknown';
    }
  } catch(e) {}
  const { id } = req.params;
  const { error } = await supabase.from('mutes').update({
    is_active: false, lifted_at: new Date().toISOString(), lifted_by: ADMIN_USERNAME
  }).eq('id', id);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  await logAdminAudit('unmute_user', auditUser, 'mute_id:' + id);
  return res.json({ ok: true });
});

// ===================== 黑名单管理 ======================
app.get('/admin/blacklist', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('blacklist').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ data });
});

app.post('/admin/blacklist', verifyToken, rateLimit(60000, 30), async (req, res) => {
  const { user_name, reason, duration_hours } = req.body;
  const durationCheck = validateDurationHours(duration_hours);
  if (durationCheck.error) return res.status(400).json({ error: durationCheck.error });
  const durationHoursVal = durationCheck.value;
  if (!user_name) return res.status(400).json({ error: '缺少用户名' });
  
  const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
  if (userNameVal && userNameVal.error) return res.status(400).json({ error: userNameVal.error });
  const reasonVal = validateString(reason, MAX_REASON_LEN, '原因');
  if (reasonVal && reasonVal.error) return res.status(400).json({ error: reasonVal.error });
  if (isProtectedAdminTarget(userNameVal)) return res.status(403).json({ error: 'Operation not allowed for admin user' });
  
  let expiresAt = null;
  if (durationHoursVal > 0) {
    expiresAt = new Date(Date.now() + durationHoursVal * 3600000).toISOString();
  }
  
  const { data: existing } = await supabase.from('blacklist').select('id, is_active').eq('user_name', userNameVal);
  if (existing && existing.length) {
    const activeEntry = existing.find(e => e.is_active);
    if (activeEntry) return res.status(409).json({ error: '该用户已在黑名单中' });
    
    const { error } = await supabase.from('blacklist').update({
      reason: reasonVal || '违反社区规定',
      duration_hours: durationHoursVal,
      added_by: ADMIN_USERNAME,
      expires_at: expiresAt,
      is_active: true,
      created_at: new Date().toISOString()
    }).eq('id', existing[0].id);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
  } else {
    const { error } = await supabase.from('blacklist').insert([{
      user_name: userNameVal,
      reason: reasonVal || '违反社区规定',
      duration_hours: durationHoursVal,
      added_by: ADMIN_USERNAME,
      expires_at: expiresAt,
      is_active: true
    }]);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
  }
  
  return res.json({ ok: true });
});

app.put('/admin/blacklist/:id/lift', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('blacklist').update({
    is_active: false, lifted_at: new Date().toISOString(), lifted_by: ADMIN_USERNAME
  }).eq('id', id);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true });
});

// ===================== 管理员删除用户账号 =====================
app.delete('/admin/user/:userName', verifyToken, rateLimit(60000, 5), async (req, res) => {
  try {
    var userName = String(req.params.userName || '').trim();
    if (!userName || userName.length > MAX_USERNAME_LEN) return res.status(400).json({ error: '用户名无效' });
    if (userName === ADMIN_USERNAME) return res.status(403).json({ error: '不能删除管理员账号' });

    // 检查用户是否在任意表中存在（不仅 AUTH_MARKER）
    var existsChecks = await Promise.all([
      supabase.from('posts').select('id').eq('user_name', userName).limit(1),
      supabase.from('likes').select('id').eq('user_name', userName).limit(1),
      supabase.from('comments').select('id').eq('user_name', userName).limit(1),
      supabase.from('bans').select('id').eq('user_name', userName).limit(1),
      supabase.from('mutes').select('id').eq('user_name', userName).limit(1),
      supabase.from('blacklist').select('id').eq('user_name', userName).limit(1)
    ]);

    var exists = existsChecks.some(function(r) {
      return r && r.data && r.data.length > 0;
    });

    if (!exists) {
      return res.status(404).json({ error: '用户不存在或已被删除' });
    }

    // 先查询该用户发布的帖子 ID，用于级联删除点赞和评论
    var userPostIds = [];
    try {
      var { data: userPosts } = await supabase.from('posts').select('id').eq('user_name', userName);
      if (userPosts && userPosts.length) {
        userPostIds = userPosts.map(function(p) { return p.id; });
      }
    } catch(e) {
      console.warn('[admin] 查询用户帖子ID失败:', e.message);
    }

    // 查询并删除照片墙的 Storage 文件
    var storagePaths = [];
    try {
      var { data: photoRecords } = await supabase.from('posts')
        .select('media_url').eq('user_name', userName).eq('media_type', '__photo_wall__');
      if (photoRecords && photoRecords.length) {
        photoRecords.forEach(function(p) {
          if (p.media_url) {
            var url = p.media_url;
            var pathMatch = url.match(/\/uploads\/(.+?)(?:\?|$)/);
            if (pathMatch) storagePaths.push(pathMatch[1]);
          }
        });
      }
    } catch(storageErr) {
      console.warn('[admin] 查询照片路径失败:', storageErr.message);
    }

    // 删除 Storage 文件（失败不影响账号删除）
    var deletedStorage = 0;
    if (storagePaths.length > 0) {
      try {
        var { error: storageError } = await supabase.storage.from('uploads').remove(storagePaths);
        if (storageError) {
          console.warn('[admin] 删除照片文件失败:', storageError.message);
        } else {
          deletedStorage = storagePaths.length;
        }
      } catch(storageErr) {
        console.warn('[admin] 删除照片文件异常:', storageErr.message);
      }
    }

    var deletedPosts = 0, deletedLikes = 0, deletedComments = 0, deletedBans = 0, deletedMutes = 0, deletedBlacklist = 0;

    // 删除帖子的同时，级联删除该帖子下的点赞和评论
    if (userPostIds.length > 0) {
      // 级联删除这些帖子的点赞
      for (var pi = 0; pi < userPostIds.length; pi++) {
        try {
          var cascadeLikeRes = await supabase.from('likes').delete().eq('post_id', userPostIds[pi]);
          if (!cascadeLikeRes.error) deletedLikes += (cascadeLikeRes.count || 0);
        } catch(e) { console.warn('[admin] 级联删除 likes 失败:', e.message); }
      }
      // 级联删除这些帖子的评论
      for (var ci = 0; ci < userPostIds.length; ci++) {
        try {
          var cascadeCommentRes = await supabase.from('comments').delete().eq('post_id', userPostIds[ci]);
          if (!cascadeCommentRes.error) deletedComments += (cascadeCommentRes.count || 0);
        } catch(e) { console.warn('[admin] 级联删除 comments 失败:', e.message); }
      }
    }

    // 删除 posts 表（用户发布的帖子）
    var delPostsRes = await supabase.from('posts').delete().eq('user_name', userName);
    if (!delPostsRes.error) deletedPosts = (delPostsRes.count || 0);
    else console.warn('[admin] 删除 posts 失败:', delPostsRes.error.message);

    // 删除 likes 表（该用户自己点的赞）
    try {
      var delLikesRes = await supabase.from('likes').delete().eq('user_name', userName);
      if (!delLikesRes.error) deletedLikes += (delLikesRes.count || 0);
      else console.warn('[admin] 删除 likes 失败:', delLikesRes.error.message);
    } catch(e) { console.warn('[admin] 删除 likes 异常:', e.message); }

    // 删除 comments 表（该用户自己的评论）
    try {
      var delCommentsRes = await supabase.from('comments').delete().eq('user_name', userName);
      if (!delCommentsRes.error) deletedComments += (delCommentsRes.count || 0);
      else console.warn('[admin] 删除 comments 失败:', delCommentsRes.error.message);
    } catch(e) { console.warn('[admin] 删除 comments 异常:', e.message); }

    // 删除 bans 表
    var delBansRes = await supabase.from('bans').delete().eq('user_name', userName);
    if (!delBansRes.error) deletedBans = delBansRes.count || 0;
    else console.warn('[admin] 删除 bans 失败:', delBansRes.error.message);

    // 删除 mutes 表
    var delMutesRes = await supabase.from('mutes').delete().eq('user_name', userName);
    if (!delMutesRes.error) deletedMutes = delMutesRes.count || 0;
    else console.warn('[admin] 删除 mutes 失败:', delMutesRes.error.message);

    // 删除 blacklist 表
    var delBlacklistRes = await supabase.from('blacklist').delete().eq('user_name', userName);
    if (!delBlacklistRes.error) deletedBlacklist = delBlacklistRes.count || 0;
    else console.warn('[admin] 删除 blacklist 失败:', delBlacklistRes.error.message);

    // 写入审计日志
    await logAdminAudit('delete_user', ADMIN_USERNAME,
      'user:' + userName +
      ' posts:' + deletedPosts +
      ' likes:' + deletedLikes +
      ' comments:' + deletedComments +
      ' bans:' + deletedBans +
      ' mutes:' + deletedMutes +
      ' blacklist:' + deletedBlacklist +
      ' storage_files:' + deletedStorage
    );

    return res.json({
      ok: true,
      user_name: userName,
      deleted: {
        posts: deletedPosts,
        likes: deletedLikes,
        comments: deletedComments,
        bans: deletedBans,
        mutes: deletedMutes,
        blacklist: deletedBlacklist,
        storage_files: deletedStorage
      }
    });
  } catch(e) {
    console.error('[admin] 删除用户失败:', e.message || e);
    return res.status(500).json({ error: '删除用户失败' });
  }
});

function firstNonEmptyValue() {
  for (let i = 0; i < arguments.length; i++) {
    const value = arguments[i];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function parseReportRecordContent(rawContent) {
  let parsed = {};
  try { parsed = JSON.parse(rawContent || '{}'); } catch(e) {}
  const targetTypeRaw = firstNonEmptyValue(parsed.target_type, parsed.type, parsed.report_type, parsed.targetKind);
  return {
    target_type: targetTypeRaw === 'photo_wall' ? 'photo' : (targetTypeRaw || 'post'),
    target_id: firstNonEmptyValue(parsed.target_id, parsed.post_id, parsed.photo_id, parsed.report_target_id, parsed.target_post_id),
    target_user: firstNonEmptyValue(parsed.target_user, parsed.target_username, parsed.reported_user, parsed.reported_username, parsed.post_user),
    report_category: firstNonEmptyValue(parsed.report_category, parsed.category, parsed.reason_type, parsed.report_type_name),
    report_reason: firstNonEmptyValue(parsed.report_reason, parsed.reason, parsed.detail, parsed.description),
    status: firstNonEmptyValue(parsed.status, parsed.review_status) || 'pending',
    admin_response: firstNonEmptyValue(parsed.admin_response, parsed.response_text) || null,
    reviewed_at: firstNonEmptyValue(parsed.reviewed_at, parsed.handled_at, parsed.updated_at) || null,
    reviewed_by: firstNonEmptyValue(parsed.reviewed_by, parsed.handled_by, parsed.admin_name) || null,
    response_at: firstNonEmptyValue(parsed.response_at, parsed.reply_at) || null
  };
}

function formatAdminReportReason(category, reason) {
  const normalizedCategory = firstNonEmptyValue(category);
  const normalizedReason = firstNonEmptyValue(reason);
  if (!normalizedReason) return normalizedCategory || '-';
  if (!normalizedCategory) return normalizedReason;
  const cleanCategory = normalizedCategory.replace(/[：:]+$/, '');
  const otherLabels = ['其他', 'other', 'others'];
  const isOther = otherLabels.includes(cleanCategory.toLowerCase ? cleanCategory.toLowerCase() : cleanCategory);
  const prefixedReason = normalizedReason
    .replace(/^其他[：:\-\s]*/i, '')
    .replace(/^other[：:\-\s]*/i, '')
    .trim();
  if (isOther) {
    return prefixedReason ? ('其他-' + prefixedReason) : '其他';
  }
  if (normalizedReason === normalizedCategory) return normalizedReason;
  return normalizedReason;
}

// ===================== 举报管理 ======================
app.get('/admin/reports', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('posts').select('*').eq('media_type', REPORT_MARKER).order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(400).json({ error: sanitizeError(error) });

  const reports = (data || []).map(function(p) {
      const normalized = parseReportRecordContent(p.content);
      return {
          id: p.id,
          created_at: p.created_at,
          reporter_name: firstNonEmptyValue(p.user_name, normalized.reporter_name) || '-',
          target_type: normalized.target_type || 'post',
          target_id: normalized.target_id || '',
          target_user: normalized.target_user || '',
          report_category: normalized.report_category || '-',
          report_reason: formatAdminReportReason(normalized.report_category, normalized.report_reason),
          status: normalized.status || 'pending',
          admin_response: normalized.admin_response,
          reviewed_at: normalized.reviewed_at,
          reviewed_by: normalized.reviewed_by,
          response_at: normalized.response_at
      };
  });

  const missingTargetIds = Array.from(new Set(reports.filter(function(r) {
    return !r.target_user && r.target_id;
  }).map(function(r) {
    return r.target_id;
  })));

  if (missingTargetIds.length) {
    const { data: targetPosts } = await supabase.from('posts').select('id, user_name').in('id', missingTargetIds);
    const targetUserMap = {};
    (targetPosts || []).forEach(function(post) {
      if (post && post.id && post.user_name && !targetUserMap[post.id]) {
        targetUserMap[post.id] = post.user_name;
      }
    });
    reports.forEach(function(report) {
      if (!report.target_user) {
        report.target_user = targetUserMap[report.target_id] || '-';
      }
    });
  }

  reports.forEach(function(report) {
    if (!report.target_user) report.target_user = '-';
    if (!report.report_category) report.report_category = '-';
    report.report_reason = formatAdminReportReason(report.report_category, report.report_reason);
  });

  return res.json({ data: reports });
});

app.put('/admin/report/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const allowedStatuses = ['pending', 'reviewed', 'actioned', 'dismissed'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: '无效的状态值' });
  }
  // 从 posts 表获取举报数据（存储在 content JSON 中）
  const { data: post, error: fetchErr } = await supabase.from('posts').select('content').eq('id', id).maybeSingle();
  if (fetchErr) return res.status(400).json({ error: sanitizeError(fetchErr) });
  if (!post) return res.status(404).json({ error: '举报不存在' });
  var c = {};
  try { c = JSON.parse(post.content || '{}'); } catch(e) {}
  c.status = status;
  c.reviewed_at = new Date().toISOString();
  c.reviewed_by = ADMIN_USERNAME;
  const { error } = await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', id);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  var notifMsg = status === 'actioned' ? '管理员已将你的举报标记为已处理' : (status === 'dismissed' ? '管理员已驳回你的举报' : '管理员已审核你的举报');
  addReportNotification(id, status, notifMsg).catch(function(){});
  return res.json({ ok: true });
});

// 管理员回复举报
app.put('/admin/report/:id/respond', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { response } = req.body;
  if (!response || !String(response).trim()) {
    return res.status(400).json({ error: '回复内容不能为空' });
  }
  const responseVal = validateString(response, MAX_CONTENT_LEN, '回复');
  if (responseVal && responseVal.error) return res.status(400).json({ error: responseVal.error });
  // 从 posts 表获取举报数据（存储在 content JSON 中）
  const { data: post, error: fetchErr } = await supabase.from('posts').select('*').eq('id', id).maybeSingle();
  if (fetchErr) return res.status(400).json({ error: sanitizeError(fetchErr) });
  if (!post) return res.status(404).json({ error: '举报不存在' });
  var c = {};
  try { c = JSON.parse(post.content || '{}'); } catch(e) {}
  c.admin_response = responseVal;
  c.response_at = new Date().toISOString();
  c.status = 'actioned';
  c.reviewed_at = new Date().toISOString();
  c.reviewed_by = ADMIN_USERNAME;
  const { error } = await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', id);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  // 向举报人发送 DM 通知
  sendAdminDm(post.user_name, '[举报回复] ' + responseVal);
  addReportNotification(id, 'replied', '管理员已回复你的举报').catch(function(){});
  return res.json({ ok: true });
});

// 管理员处理举报 + 删除帖子
app.post('/admin/report/:id/delete-post', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    // 从 posts 表获取举报数据（存储在 content JSON 中）
    const { data: reportPost } = await supabase.from('posts').select('*').eq('id', id).maybeSingle();
    if (!reportPost) return res.status(404).json({ error: '举报不存在' });
    var c = {};
    try { c = JSON.parse(reportPost.content || '{}'); } catch(e) {}
    const targetType = c.target_type || 'post';
    const targetId = c.target_id || '';
    if (targetType === 'post' || targetType === 'photo') {
      const { data: post, error: fetchPostErr } = await supabase.from('posts').select('actor_key').eq('id', targetId).maybeSingle();
      if (fetchPostErr) return res.status(400).json({ error: sanitizeError(fetchPostErr) });
      const actorKey = (post && post.actor_key) || 'admin_' + Date.now();
      const { error: rpcErr } = await supabase.rpc('delete_post_with_actor', {
        p_post_id: targetId,
        p_actor_key: actorKey
      });
      if (rpcErr) return res.status(400).json({ error: sanitizeError(rpcErr) });
    }
    // 标记举报已处理
    const adminMsg = '被举报的' + (targetType === 'photo' ? '照片' : '帖子') + '已被删除';
    c.status = 'actioned';
    c.reviewed_at = new Date().toISOString();
    c.reviewed_by = ADMIN_USERNAME;
    c.admin_response = adminMsg;
    const { error: updErr } = await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', id);
    if (updErr) return res.status(400).json({ error: sanitizeError(updErr) });
    sendAdminDm(reportPost.user_name, '[举报处理] ' + adminMsg);
    addReportNotification(id, 'content_deleted', '管理员已删除被举报内容').catch(function(){});
    return res.json({ ok: true });
  } catch(e) {
    console.error('[admin] 举报处理删除帖子失败:', e.message || e);
    return res.status(500).json({ error: '处理失败：' + (e.message || '未知错误') });
  }
});

// 管理员处理举报 + 封禁用户
app.post('/admin/report/:id/ban-user', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { duration_hours } = req.body;
    // 从 posts 表获取举报数据（存储在 content JSON 中）
    const { data: reportPost } = await supabase.from('posts').select('*').eq('id', id).maybeSingle();
    if (!reportPost) return res.status(404).json({ error: '举报不存在' });
    var c = {};
    try { c = JSON.parse(reportPost.content || '{}'); } catch(e) {}
    const targetUser = c.target_user;
    const reportReason = c.report_reason || '';
    if (!targetUser) return res.status(400).json({ error: '无法确定被举报用户' });

    const banType = (duration_hours || 0) === 0 ? 'permanent' : 'temporary';
    let expiresAt = null;
    if (duration_hours > 0) {
      expiresAt = new Date(Date.now() + duration_hours * 3600000).toISOString();
    }

    // 检查是否已有封禁记录
    const { data: existing } = await supabase.from('bans').select('id, is_active').eq('user_name', targetUser);
    if (existing && existing.length) {
      const activeBan = existing.find(b => b.is_active);
      if (activeBan) {
        // 已经封禁，只更新举报状态
        c.status = 'actioned';
        c.reviewed_at = new Date().toISOString();
        c.reviewed_by = ADMIN_USERNAME;
        c.admin_response = '该用户已被封禁';
        const { error: updErr1 } = await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', id);
        if (updErr1) return res.status(400).json({ error: sanitizeError(updErr1) });
        sendAdminDm(reportPost.user_name, '[举报处理] 该用户已被封禁');
        addReportNotification(id, 'user_banned', '管理员已将举报用户封禁').catch(function(){});
        return res.json({ ok: true, message: '该用户已被封禁，举报已标记为已处理' });
      }
      const { error: updBanErr } = await supabase.from('bans').update({
        ban_reason: '举报处理：' + (reportReason || '违规内容'),
        ban_duration_hours: duration_hours || 0,
        ban_type: banType,
        banned_by: ADMIN_USERNAME,
        expires_at: expiresAt,
        is_active: true,
        banned_at: new Date().toISOString()
      }).eq('id', existing[0].id);
      if (updBanErr) {
        // 回滚举报状态
        await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', id);
        return res.status(400).json({ error: sanitizeError(updBanErr) });
      }
    } else {
      const { error: insErr } = await supabase.from('bans').insert([{
        user_name: targetUser,
        ban_type: banType,
        ban_reason: '举报处理：' + (reportReason || '违规内容'),
        ban_duration_hours: duration_hours || 0,
        banned_by: ADMIN_USERNAME,
        expires_at: expiresAt,
        is_active: true
      }]);
      if (insErr) return res.status(400).json({ error: sanitizeError(insErr) });
    }

    // 标记举报已处理
    const banMsg = banType === 'permanent' ? '用户已被永久封禁' : `用户已被封禁${duration_hours || 0}小时`;
    c.status = 'actioned';
    c.reviewed_at = new Date().toISOString();
    c.reviewed_by = ADMIN_USERNAME;
    c.admin_response = banMsg;
    const { error: finalUpdErr } = await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', id);
    if (finalUpdErr) return res.status(400).json({ error: sanitizeError(finalUpdErr) });
    sendAdminDm(reportPost.user_name, '[举报处理] ' + banMsg);
    addReportNotification(id, 'user_banned', '管理员已将举报用户封禁').catch(function(){});
    return res.json({ ok: true });
  } catch(e) {
    console.error('[admin] 举报处理封禁用户失败:', e.message || e);
    return res.status(500).json({ error: '处理失败：' + (e.message || '未知错误') });
  }
});

// 用户提交举报
app.post('/api/report', rateLimit(60000, 5), authenticateUser, async (req, res) => {
  const { reporter_name, target_type, target_id, target_user, report_category, report_reason } = req.body;
  const reporterVal = req.userName;
  if (!reporterVal || !target_type || !target_id || !report_category) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  const targetUserVal = validateString(target_user, MAX_USERNAME_LEN, '被举报用户');
  const reasonVal = validateString(report_reason, MAX_REASON_LEN, '举报原因');
  if (targetUserVal && targetUserVal.error) return res.status(400).json({ error: targetUserVal.error });
  if (reasonVal && reasonVal.error) return res.status(400).json({ error: reasonVal.error });
  
  const reportContent = JSON.stringify({
    target_type: String(target_type).slice(0, 20),
    target_id: String(target_id).slice(0, 100),
    target_user: String(targetUserVal || '').slice(0, 50),
    report_category: String(report_category).slice(0, 50),
    report_reason: String(reasonVal || '').slice(0, MAX_REASON_LEN),
    status: 'pending'
  });
  const { error } = await supabase.from('posts').insert([{
    user_name: reporterVal,
    content: reportContent,
    media_type: REPORT_MARKER,
    actor_key: REPORT_MARKER
  }]);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true });
});

// 用户查看自己的举报
app.get('/api/my-reports', rateLimit(60000, 20), authenticateUser, async (req, res) => {
  const userName = req.userName;
  const { data, error } = await supabase.from('posts')
    .select('*')
    .eq('media_type', REPORT_MARKER)
    .eq('user_name', userName)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  const reports = (data || []).map(function(p) {
    var c = {};
    try { c = JSON.parse(p.content || '{}'); } catch(e) {}
    return {
      id: p.id,
      created_at: p.created_at,
      reporter_name: p.user_name,
      target_type: c.target_type || 'post',
      target_id: c.target_id || '',
      target_user: c.target_user || '',
      report_category: c.report_category || '',
      report_reason: c.report_reason || '',
      status: c.status || 'pending',
      admin_response: c.admin_response || null,
      reviewed_at: c.reviewed_at || null,
      reviewed_by: c.reviewed_by || null,
      response_at: c.response_at || null
    };
  });
  return res.json({ data: reports });
});

// ===================== 用户数据（只读） ======================
app.get('/admin/users', verifyToken, async (req, res) => {
  try {
    const [authRows, userInfoRows] = await Promise.all([
      fetchAllPostsByMediaType(AUTH_MARKER, 'user_name, created_at'),
      fetchAllPostsByMediaType(USER_INFO_MARKER, 'user_name, content, created_at')
    ]);
    return res.json({ data: buildAdminUsersPayload(authRows, userInfoRows) });
  } catch (error) {
    return res.status(400).json({ error: sanitizeError(error) });
  }
});

// ===================== 数据统计 API =====================
const MAX_STATS_LIMIT = 20000;

// 汇总统计
app.get('/admin/stats', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    const startDate = req.query.start || '';
    const endDate = req.query.end || '';

    // 有日期筛选时不使用缓存
    if (!startDate && !endDate && statsCache.data && (Date.now() - statsCache.ts) < STATS_CACHE_TTL) {
      return res.json(statsCache.data);
    }
    // 简单锁：并发请求等待500ms后重试缓存
    if (!startDate && !endDate && statsCache.pending) {
      // 已有查询进行中，等待缓存更新
      await new Promise(function(r) { setTimeout(r, 500); });
      if (statsCache.data && (Date.now() - statsCache.ts) < STATS_CACHE_TTL) {
        return res.json(statsCache.data);
      }
    }

    // 构建带日期筛选的查询
    // 无日期筛选时也使用合理上限，避免拉取全表
    function buildSummaryQuery(table, selectFields, eqField, eqValue, dateField) {
      var q = supabase.from(table).select(selectFields);
      if (eqField) q = q.eq(eqField, eqValue);
      if (dateField === 'media_url') {
        if (startDate) q = q.gte('media_url', startDate);
        if (endDate) q = q.lte('media_url', endDate);
      } else if (startDate || endDate) {
        if (startDate) q = q.gte('created_at', startDate + 'T00:00:00.000Z');
        if (endDate) q = q.lte('created_at', endDate + 'T23:59:59.999Z');
      }
      q = q.order('created_at', { ascending: false });
      if (!startDate && !endDate) q = q.limit(MAX_STATS_LIMIT);
      return q;
    }

    // 创建 pending promise 防止并发重复查询
    if (!startDate && !endDate) {
      statsCache.pending = true;  // 简单锁标志
    }
    const [postsRes, authRowsRes, visitsRes, attacksRes, likesRes, commentsRes, photosRes] = await Promise.all([
      applyPublicPostExclusions(buildSummaryQuery('posts', 'id, media_type, content, created_at', null, null, 'created_at')),
      buildSummaryQuery('posts', 'user_name, created_at', 'media_type', AUTH_MARKER, 'created_at'),
      buildSummaryQuery('posts', 'id, content, media_url, created_at', 'media_type', VISIT_MARKER, 'media_url'),
      buildSummaryQuery('posts', 'id, content, media_url, created_at', 'media_type', ATTACK_MARKER, 'created_at'),
      supabase.from('likes').select('id'),
      supabase.from('comments').select('id'),
      supabase.from('posts').select('id').eq('media_type', '__photo_wall__'),
    ]);

    const posts = (postsRes.data || []).filter(p => {
      if (p.content) {
        try { var c = JSON.parse(p.content); if (c && c.target_type) return false; } catch(e) {}
      }
      return true;
    });
    const authRows = authRowsRes.data || [];
    const authUserMap = buildAuthUserMap(authRows);
    const visits = visitsRes.data || [];
    const attacks = attacksRes.data || [];
    const likes = likesRes.data || [];
    const comments = commentsRes.data || [];
    const photos = photosRes.data || [];

    // 按日期聚合访问数据
    const dailyVisits = {};
    visits.forEach(v => {
      var d = v.media_url || '';
      if (!d) { try { var c = JSON.parse(v.content || '{}'); d = c.date || ''; } catch(e) {} }
      if (d) dailyVisits[d] = (dailyVisits[d] || 0) + 1;
    });

    // 按日期聚合攻击数据
    const dailyAttacks = {};
    attacks.forEach(a => {
      var d = '';
      try { var c = JSON.parse(a.content || '{}'); d = c.date || a.media_url || ''; } catch(e) { d = a.media_url || ''; }
      if (d) dailyAttacks[d] = (dailyAttacks[d] || 0) + 1;
    });

    // 攻击类型分布
    const attackTypes = {};
    attacks.forEach(a => {
      var t = a.media_url || 'unknown';
      attackTypes[t] = (attackTypes[t] || 0) + 1;
    });

    // API防火墙拦截 = CORS + CSRF（RATE_LIMIT是速率限制，不计入拦截）
    var firewallIntercepts = (attackTypes['CORS'] || 0) + (attackTypes['CSRF'] || 0);

    const result = {
      total_users: Object.keys(authUserMap).length,
      total_posts: posts.length,
      total_comments: comments.length,
      total_likes: likes.length,
      total_photos: photos.length,
      total_visits: visits.length,
      total_attacks: attacks.length,
      firewall_intercepts: firewallIntercepts,
      daily_visits: dailyVisits,
      daily_attacks: dailyAttacks,
      attack_types: attackTypes,
      cached_at: new Date().toISOString()
    };

    if (!startDate && !endDate) {
      statsCache = { data: result, ts: Date.now(), pending: null };
    }
    return res.json(result);
  } catch (e) {
    statsCache.pending = null;
    console.error('[API] 统计加载失败:', e.message);
    return res.status(500).json({ error: '统计加载失败' });
  }
});

// 攻击详情 API（返回完整攻击记录，含 IP、时间、类型、详情）
app.get('/admin/stats/attacks', verifyToken, rateLimit(60000, 20), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    const offset = parseInt(req.query.offset) || 0;
    const typeFilter = req.query.type || ''; // 可选，按攻击类型筛选

    var query = supabase.from('posts')
      .select('id, user_name, content, media_url, created_at, actor_key')
      .eq('media_type', ATTACK_MARKER);

    if (typeFilter) {
      query = query.eq('media_url', typeFilter);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return res.status(400).json({ error: sanitizeError(error) });

    const attacks = (data || []).map(function(a) {
      var detail = {};
      try { detail = JSON.parse(a.content || '{}'); } catch(e) {}
      return {
        id: a.id,
        ip: a.user_name,
        type: a.media_url || detail.type || 'unknown',
        detail: detail.detail || '',
        attack_date: detail.date || '',
        created_at: a.created_at,
        actor_key: a.actor_key
      };
    });

    return res.json({ data: attacks, total: attacks.length });
  } catch (e) {
    console.error('[API] 攻击详情加载失败:', e.message);
    return res.status(500).json({ error: '攻击详情加载失败' });
  }
});

// 每日明细统计（支持日期筛选）
app.get('/admin/stats/daily', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    const startDate = req.query.start || '';
    const endDate = req.query.end || '';

    // 构建带日期筛选的查询（数据库级别筛选，避免limit截断旧数据）
    function buildQuery(table, selectFields, eqField, eqValue, dateField) {
      var q = supabase.from(table).select(selectFields);
      if (eqField) q = q.eq(eqField, eqValue);
      // visits/attacks 的日期在 media_url 字段，其他用 created_at
      if (dateField === 'media_url') {
        if (startDate) q = q.gte('media_url', startDate);
        if (endDate) q = q.lte('media_url', endDate);
      } else {
        if (startDate) q = q.gte('created_at', startDate + 'T00:00:00.000Z');
        if (endDate) q = q.lte('created_at', endDate + 'T23:59:59.999Z');
      }
      q = q.order('created_at', { ascending: false });
      // 无日期筛选时保留较大limit，有日期筛选时数据库层面已过滤无需limit
      if (!startDate && !endDate) q = q.limit(MAX_STATS_LIMIT);
      return q;
    }

    const [visitsRes, attacksRes, postsRes, commentsRes, likesRes, authRows] = await Promise.all([
      buildQuery('posts', 'id, content, media_url, created_at', 'media_type', VISIT_MARKER, 'media_url'),
      buildQuery('posts', 'id, content, media_url, created_at', 'media_type', ATTACK_MARKER, 'created_at'),
      applyPublicPostExclusions(buildQuery('posts', 'id, created_at', null, null, 'created_at')),
      buildQuery('comments', 'id, created_at', null, null, 'created_at'),
      buildQuery('likes', 'id, created_at', null, null, 'created_at'),
      fetchAllPostsByMediaType(AUTH_MARKER, 'user_name, created_at'),
    ]);

    // 辅助函数：按天聚合
    function aggregateByDate(records, dateField) {
      var map = {};
      (records || []).forEach(r => {
        var d = (r[dateField] || '').slice(0, 10);
        if (d) map[d] = (map[d] || 0) + 1;
      });
      return map;
    }

    // 辅助函数：过滤日期范围
    function filterByDate(map, start, end) {
      var result = {};
      var keys = Object.keys(map).sort();
      keys.forEach(function(k) {
        if ((!start || k >= start) && (!end || k <= end)) {
          result[k] = map[k];
        }
      });
      return result;
    }

    const dailyVisitsAll = {};
    (visitsRes.data || []).forEach(v => {
      var d = v.media_url || '';
      if (!d) { try { var c = JSON.parse(v.content || '{}'); d = c.date || ''; } catch(e) {} }
      if (d) dailyVisitsAll[d] = (dailyVisitsAll[d] || 0) + 1;
    });

    const dailyAttacksAll = {};
    (attacksRes.data || []).forEach(a => {
      var d = '';
      try { var c = JSON.parse(a.content || '{}'); d = c.date || a.media_url || ''; } catch(e) { d = a.media_url || ''; }
      if (d) dailyAttacksAll[d] = (dailyAttacksAll[d] || 0) + 1;
    });

    const dailyPostsMap = aggregateByDate(postsRes.data || [], 'created_at');
    const dailyCommentsMap = aggregateByDate(commentsRes.data || [], 'created_at');
    const dailyLikesMap = aggregateByDate(likesRes.data || [], 'created_at');
    const dailyUsersMap = buildRegisteredUsersByDate(buildAuthUserMap(authRows));

    // 合并所有日期
    var allDates = {};
    [dailyVisitsAll, dailyAttacksAll, dailyPostsMap, dailyCommentsMap, dailyLikesMap, dailyUsersMap].forEach(function(m) {
      Object.keys(m).forEach(function(d) { allDates[d] = true; });
    });

    var dailyArr = Object.keys(allDates).sort().map(function(d) {
      return {
        date: d,
        visits: dailyVisitsAll[d] || 0,
        attacks: dailyAttacksAll[d] || 0,
        posts: dailyPostsMap[d] || 0,
        comments: dailyCommentsMap[d] || 0,
        likes: dailyLikesMap[d] || 0,
        new_users: dailyUsersMap[d] || 0
      };
    });

    // 如果有日期筛选，过滤
    if (startDate || endDate) {
      dailyArr = dailyArr.filter(function(item) {
        return (!startDate || item.date >= startDate) && (!endDate || item.date <= endDate);
      });
    }

    return res.json({
      daily: dailyArr,
      date_range: { start: startDate || 'all', end: endDate || 'all' }
    });
  } catch (e) {
    console.error('[API] 每日统计加载失败:', e.message);
    return res.status(500).json({ error: '每日统计加载失败' });
  }
});

// 清除统计缓存
app.post('/admin/stats/refresh', verifyToken, (req, res) => {
  statsCache = { data: null, ts: 0, pending: null };
  return res.json({ ok: true });
});

// ===================== 用户访问日志（前端调用） =====================
app.post('/api/log-user-visit', rateLimit(60000, 30), authenticateUser, async (req, res) => {
  try {
    const userNameVal = req.userName;

    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    await supabase.from('posts').insert([{
      user_name: userNameVal,
      content: JSON.stringify({ date: today }),
      media_type: USER_VISIT_MARKER,
      media_url: today,
      actor_key: 'uvisit_' + Date.now()
    }]);

    // 更新用户最近登录时间
    const { data: existing } = await supabase.from('posts')
      .select('id, content')
      .eq('user_name', userNameVal)
      .eq('media_type', '__user_info__')
      .maybeSingle();

    if (existing) {
      var info = {};
      try { info = JSON.parse(existing.content || '{}'); } catch(e) {}
      info.last_visit = now;
      await supabase.from('posts').update({ content: JSON.stringify(info) }).eq('id', existing.id);
    }

    return res.json({ ok: true });
  } catch(e) {
    console.error('[API] 用户访问记录失败:', e.message);
    return res.status(500).json({ error: '记录失败' });
  }
});

// ===================== 登录设备/IP 记录（前端调用） =====================
app.post('/api/log-login-event', rateLimit(60000, 30), authenticateUser, async (req, res) => {
  try {
    const { device_id, device_type, os, browser, user_agent, source, device_meta, exact_device_model, browser_fingerprint_hash, canvas_fingerprint_hash, webgl_fingerprint_hash, webgl_meta, webrtc_local_ips } = req.body;

    const VALID_SOURCES = ['login_success', 'page_visit', 'register_success'];
    const srcVal = VALID_SOURCES.includes(source) ? source : 'login_success';

    const userNameVal = req.userName;

    const deviceIdVal = validateString(device_id, 120, '设备ID');
    if (!deviceIdVal) return res.status(400).json({ error: '缺少设备ID' });

    // IP 由后端获取，前端不允许传 ip
    const ip = getClientIp(req);
    const loginAt = new Date().toISOString();
    const random = Math.random().toString(36).slice(2, 10);

    // 解析 IP 地区（多源 fallback，失败有日志）
    var ipLocation = null;
    try { ipLocation = await resolveIpLocation(ip); } catch(e) {}

    // 加载安全设置，按开关决定是否写入
    var securitySettings = { record_device: true, browser_fingerprint: false, canvas_fingerprint: false, webgl_fingerprint: false, webrtc_local_ip: false, advanced_fingerprint: false };
    try {
      var { data: settingsData } = await supabase.from('posts')
        .select('content')
        .eq('media_type', ADMIN_META_MARKER)
        .eq('media_url', 'security_settings')
        .maybeSingle();
      if (settingsData && settingsData.content) {
        var parsed = JSON.parse(settingsData.content);
        if (typeof parsed.record_device === 'boolean') securitySettings.record_device = parsed.record_device;
        if (typeof parsed.browser_fingerprint === 'boolean') securitySettings.browser_fingerprint = parsed.browser_fingerprint;
        if (typeof parsed.canvas_fingerprint === 'boolean') securitySettings.canvas_fingerprint = parsed.canvas_fingerprint;
        if (typeof parsed.webgl_fingerprint === 'boolean') securitySettings.webgl_fingerprint = parsed.webgl_fingerprint;
        if (typeof parsed.webrtc_local_ip === 'boolean') securitySettings.webrtc_local_ip = parsed.webrtc_local_ip;
        if (typeof parsed.advanced_fingerprint === 'boolean') securitySettings.advanced_fingerprint = parsed.advanced_fingerprint;
      }
    } catch(e) {}

    var finalDeviceMeta = securitySettings.record_device ? (device_meta || null) : null;
    var possibleDeviceModel = '';
    if (finalDeviceMeta && typeof finalDeviceMeta === 'object') {
      possibleDeviceModel = getPossibleDeviceModel(Object.assign({}, finalDeviceMeta, { user_agent: user_agent || '' }));
      if (possibleDeviceModel) finalDeviceMeta.possible_device_model = possibleDeviceModel;
    }
    var finalBrowserFp = securitySettings.browser_fingerprint ? (browser_fingerprint_hash || null) : null;
    var finalCanvasFp = securitySettings.canvas_fingerprint ? (canvas_fingerprint_hash || null) : null;
    var finalWebglFp = securitySettings.webgl_fingerprint ? (webgl_fingerprint_hash || null) : null;
    var finalWebglMeta = securitySettings.webgl_fingerprint ? (webgl_meta || null) : null;
    var finalWebrtcIps = securitySettings.webrtc_local_ip ? (webrtc_local_ips || null) : null;

    // HTTP Header 顺序指纹（记录 header 名称的排列顺序）
    var headerOrderHash = null;
    var headerOrderPreview = null;
    try {
      if (req.rawHeaders && req.rawHeaders.length > 0) {
        var headerNames = [];
        for (var hi = 0; hi < req.rawHeaders.length; hi += 2) {
          var headerName = String(req.rawHeaders[hi] || '').toLowerCase().trim();
          if (headerName) headerNames.push(headerName);
        }
        if (headerNames.length > 0) {
          headerOrderHash = crypto.createHash('sha256').update(headerNames.join('|')).digest('hex');
          headerOrderPreview = headerNames.slice(0, 12);
        }
      }
    } catch(e) {}

    // TLS 指纹（尝试获取，云平台可能不可用）
    var tlsInfo = null;
    try {
      var socket = req.socket || req.connection;
      if (socket && socket.getCipher && socket.getCipher()) {
        var cipher = socket.getCipher();
        tlsInfo = {
          name: cipher.name || '',
          version: cipher.version || '',
          protocol: (socket.getProtocol && socket.getProtocol()) || ''
        };
      }
    } catch(e) {}

    // 确定最终 ASN/ISP 信息
    var asnInfo = null;
    if (ipLocation && (ipLocation.asn || ipLocation.isp || ipLocation.is_proxy || ipLocation.is_hosting)) {
      asnInfo = {
        asn: ipLocation.asn || '',
        isp: ipLocation.isp || '',
        org: ipLocation.org || '',
        is_mobile: ipLocation.is_mobile || false,
        is_proxy: ipLocation.is_proxy || false,
        is_hosting: ipLocation.is_hosting || false
      };
    }

    // 写入 posts 表（短期方案，不新建表）
    const { error } = await supabase.from('posts').insert([{
      user_name: userNameVal,
      media_type: LOGIN_EVENT_MARKER,
      media_url: deviceIdVal,
      content: JSON.stringify({
        device_id: deviceIdVal,
        device_type: device_type || 'unknown',
        os: os || 'Unknown',
        browser: browser || 'Unknown',
        user_agent: user_agent || '',
        possible_device_model: possibleDeviceModel,
        ip: ip,
        ip_location: ipLocation,
        login_at: loginAt,
        source: srcVal,
        device_meta: finalDeviceMeta,
        exact_device_model: exact_device_model || null,
        browser_fingerprint_hash: finalBrowserFp,
        canvas_fingerprint_hash: finalCanvasFp,
        webgl_fingerprint_hash: finalWebglFp,
        webgl_meta: finalWebglMeta,
        webrtc_local_ips: finalWebrtcIps,
        asn_info: asnInfo,
        header_order_hash: headerOrderHash,
        header_order_preview: headerOrderPreview,
        tls_info: tlsInfo
      }),
      actor_key: 'login_' + Date.now() + '_' + random
    }]);
    if (error) return res.status(400).json({ error: sanitizeError(error) });

    // 同步更新 user_info（记录最近设备/IP/地区/登录时间）
    try {
      const now = new Date().toISOString();
      const { data: existingInfo } = await supabase.from('posts')
        .select('id, content')
        .eq('user_name', userNameVal)
        .eq('media_type', USER_INFO_MARKER)
        .maybeSingle();

      var info = {};
      if (existingInfo) {
        try { info = JSON.parse(existingInfo.content || '{}'); } catch(e) {}
      }

      if (srcVal === 'login_success' || srcVal === 'register_success') {
        info.last_login = now;
      }
      if (srcVal === 'page_visit') {
        info.last_visit = now;
      }
      // 同时设置 last_visit 作为兜底
      if (!info.last_visit) info.last_visit = now;

      info.last_device = (device_type || 'unknown') + ' · ' + (os || 'Unknown') + ' · ' + (browser || 'Unknown');
      info.last_ip = ip;
      if (ipLocation) info.last_ip_location = ipLocation;

      if (existingInfo) {
        await supabase.from('posts').update({ content: JSON.stringify(info) }).eq('id', existingInfo.id);
      } else {
        await supabase.from('posts').insert([{
          user_name: userNameVal,
          media_type: USER_INFO_MARKER,
          content: JSON.stringify(info),
          actor_key: 'user_info_' + Date.now()
        }]);
      }
    } catch(e) {
      console.warn('[API] 同步 user_info 失败:', e.message || e);
    }

    // 异步执行安全检测（不影响响应速度，错误静默处理）
    runSecurityChecks(userNameVal, deviceIdVal, ip, ipLocation, srcVal, loginAt, browser_fingerprint_hash || null, canvas_fingerprint_hash || null).catch(function(e) {
      console.warn('[Security] 安全检测异常:', e.message || e);
    });

    return res.json({ ok: true });
  } catch(e) {
    console.error('[API] 登录事件记录失败:', e.message);
    return res.status(500).json({ error: '记录失败' });
  }
});

// ===================== 安全设置（前端公开读取） =====================
app.get('/api/security-settings', rateLimit(60000, 60), async (req, res) => {
  try {
    var { data } = await supabase.from('posts')
      .select('content')
      .eq('media_type', ADMIN_META_MARKER)
      .eq('media_url', 'security_settings')
      .maybeSingle();
    var settings = { record_device: true, browser_fingerprint: false, canvas_fingerprint: false, webgl_fingerprint: false, webrtc_local_ip: false, advanced_fingerprint: false, security_alerts: true };
    if (data && data.content) {
      try {
        var parsed = JSON.parse(data.content);
        if (parsed.record_device !== undefined) settings.record_device = parsed.record_device;
        if (parsed.browser_fingerprint !== undefined) settings.browser_fingerprint = parsed.browser_fingerprint;
        if (parsed.canvas_fingerprint !== undefined) settings.canvas_fingerprint = parsed.canvas_fingerprint;
        if (parsed.webgl_fingerprint !== undefined) settings.webgl_fingerprint = parsed.webgl_fingerprint;
        if (parsed.webrtc_local_ip !== undefined) settings.webrtc_local_ip = parsed.webrtc_local_ip;
        if (parsed.advanced_fingerprint !== undefined) settings.advanced_fingerprint = parsed.advanced_fingerprint;
        if (parsed.security_alerts !== undefined) settings.security_alerts = parsed.security_alerts;
      } catch(e) {}
    }
    return res.json({ settings: settings });
  } catch(e) {
    return res.json({ settings: { record_device: true, browser_fingerprint: false, canvas_fingerprint: false, webgl_fingerprint: false, webrtc_local_ip: false, advanced_fingerprint: false, security_alerts: true } });
  }
});

// ===================== 登录事件查询（管理员） =====================
app.get('/admin/login-events', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    const { data, error } = await supabase.from('posts')
      .select('id, user_name, content, media_url, created_at')
      .eq('media_type', LOGIN_EVENT_MARKER)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    return res.json({ data: data || [] });
  } catch(e) {
    console.error('[API] 登录事件查询失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// ===================== 安全提醒查询（管理员） =====================
app.get('/admin/security-alerts', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var limit = parseInt(req.query.limit) || 200;
    if (limit > 500) limit = 500;
    var query = supabase.from('posts')
      .select('id, user_name, content, media_url, created_at')
      .eq('media_type', SECURITY_ALERT_MARKER)
      .order('created_at', { ascending: false })
      .limit(limit);

    // 支持按类型筛选
    if (req.query.type) {
      query = query.eq('media_url', req.query.type);
    }

    var { data, error } = await query;
    if (error) return res.status(400).json({ error: sanitizeError(error) });

    // 解析 content JSON
    var alerts = (data || []).map(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      return {
        id: row.id,
        user_name: row.user_name,
        created_at: row.created_at,
        type: info.type || row.media_url,
        level: info.level || 'warning',
        ip: info.ip || null,
        ip_location_text: info.ip_location_text || null,
        related_users: info.related_users || [],
        reason: info.reason || '',
        is_read: info.is_read || false,
        ignored: info.ignored || false,
        false_positive: info.false_positive || false,
        reviewed_at: info.reviewed_at || null,
        reviewed_by: info.reviewed_by || null
      };
    });

    return res.json({ data: alerts });
  } catch(e) {
    console.error('[API] 安全提醒查询失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// ===================== 标记安全提醒已读 =====================
app.post('/admin/security-alerts/read', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var alertId = req.body.id;
    if (!alertId) return res.status(400).json({ error: '缺少提醒ID' });

    var { data: existing } = await supabase.from('posts')
      .select('content')
      .eq('id', alertId)
      .eq('media_type', SECURITY_ALERT_MARKER)
      .maybeSingle();

    if (!existing) return res.status(404).json({ error: '提醒不存在' });

    var info = {};
    try { info = JSON.parse(existing.content || '{}'); } catch(e) {}
    info.is_read = true;

    var { error } = await supabase.from('posts')
      .update({ content: JSON.stringify(info) })
      .eq('id', alertId);

    if (error) return res.status(400).json({ error: sanitizeError(error) });
    return res.json({ ok: true });
  } catch(e) {
    console.error('[API] 标记安全提醒已读失败:', e.message);
    return res.status(500).json({ error: '操作失败' });
  }
});

// ===================== 安全提醒状态管理 =====================
app.post('/admin/security-alerts/status', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var { id, status } = req.body;
    if (!id || !status) return res.status(400).json({ error: '缺少参数' });
    var VALID_STATUSES = ['read', 'ignored', 'false_positive'];
    if (VALID_STATUSES.indexOf(status) === -1) return res.status(400).json({ error: '无效状态' });

    var { data: existing } = await supabase.from('posts')
      .select('content')
      .eq('id', id)
      .eq('media_type', SECURITY_ALERT_MARKER)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: '提醒不存在' });

    var info = {};
    try { info = JSON.parse(existing.content || '{}'); } catch(e) {}
    info.is_read = true;
    if (status === 'ignored') info.ignored = true;
    if (status === 'false_positive') { info.false_positive = true; info.ignored = true; }
    info.reviewed_at = new Date().toISOString();
    info.reviewed_by = ADMIN_USERNAME;

    var { error } = await supabase.from('posts')
      .update({ content: JSON.stringify(info) })
      .eq('id', id);
    if (error) return res.status(400).json({ error: sanitizeError(error) });

    await logAdminAudit('review_security_alert', ADMIN_USERNAME, 'alert:' + id + ' status:' + status);
    return res.json({ ok: true });
  } catch(e) {
    console.error('[API] 安全提醒状态更新失败:', e.message);
    return res.status(500).json({ error: '操作失败' });
  }
});

// ===================== 安全设置 =====================
app.get('/admin/security-settings', verifyToken, rateLimit(60000, 20), async (req, res) => {
  try {
    var { data } = await supabase.from('posts')
      .select('content')
      .eq('media_type', ADMIN_META_MARKER)
      .eq('media_url', 'security_settings')
      .maybeSingle();
    var settings = { record_device: true, browser_fingerprint: false, canvas_fingerprint: false, webgl_fingerprint: false, webrtc_local_ip: false, advanced_fingerprint: false, security_alerts: true };
    if (data && data.content) {
      try { var parsed = JSON.parse(data.content); Object.assign(settings, parsed); } catch(e) {}
    }
    return res.json({ settings: settings });
  } catch(e) {
    console.error('[API] 安全设置查询失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

app.post('/admin/security-settings', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var { record_device, browser_fingerprint, canvas_fingerprint, webgl_fingerprint, webrtc_local_ip, advanced_fingerprint, security_alerts } = req.body;
    var settings = {};
    if (typeof record_device === 'boolean') settings.record_device = record_device;
    if (typeof browser_fingerprint === 'boolean') settings.browser_fingerprint = browser_fingerprint;
    if (typeof canvas_fingerprint === 'boolean') settings.canvas_fingerprint = canvas_fingerprint;
    if (typeof webgl_fingerprint === 'boolean') settings.webgl_fingerprint = webgl_fingerprint;
    if (typeof webrtc_local_ip === 'boolean') settings.webrtc_local_ip = webrtc_local_ip;
    if (typeof advanced_fingerprint === 'boolean') settings.advanced_fingerprint = advanced_fingerprint;
    if (typeof security_alerts === 'boolean') settings.security_alerts = security_alerts;

    var { data: existing } = await supabase.from('posts')
      .select('id')
      .eq('media_type', ADMIN_META_MARKER)
      .eq('media_url', 'security_settings')
      .maybeSingle();

    var oldSettings = {};
    if (existing) {
      // Merge with existing
      var { data: oldData } = await supabase.from('posts')
        .select('content')
        .eq('id', existing.id)
        .maybeSingle();
      if (oldData && oldData.content) {
        try { oldSettings = JSON.parse(oldData.content); } catch(e) {}
      }
      Object.assign(oldSettings, settings);
      await supabase.from('posts').update({ content: JSON.stringify(oldSettings) }).eq('id', existing.id);
    } else {
      await supabase.from('posts').insert([{
        user_name: ADMIN_USERNAME,
        media_type: ADMIN_META_MARKER,
        media_url: 'security_settings',
        content: JSON.stringify(settings),
        actor_key: 'sec_settings_' + Date.now()
      }]);
    }

    // Audit log
    await logAdminAudit('update_security_settings', ADMIN_USERNAME, JSON.stringify(settings));

    return res.json({ ok: true, settings: oldSettings });
  } catch(e) {
    console.error('[API] 安全设置更新失败:', e.message);
    return res.status(500).json({ error: '更新失败' });
  }
});

// ===================== 日志清理 =====================
app.post('/admin/cleanup-logs', verifyToken, rateLimit(60000, 3), async (req, res) => {
  try {
    var types = req.body.types || ['login', 'security', 'error'];
    if (typeof types === 'string') types = [types];
    var VALID_TYPES = ['login', 'security', 'error', 'all'];
    var results = {};
    var totalDeleted = 0;

    if (types.indexOf('all') >= 0) types = ['login', 'security', 'error'];

    for (var i = 0; i < types.length; i++) {
      var t = types[i];
      if (VALID_TYPES.indexOf(t) < 0 || t === 'all') continue;
      results[t] = await cleanupOldLogs(t);
      totalDeleted += results[t].deleted || 0;
    }

    await logAdminAudit('cleanup_logs', ADMIN_USERNAME, 'types:' + types.join(',') + ' deleted:' + totalDeleted);
    return res.json({ ok: true, results: results, total_deleted: totalDeleted });
  } catch(e) {
    console.error('[API] 日志清理失败:', e.message);
    return res.status(500).json({ error: '清理失败' });
  }
});

// ===================== 审计日志查询 =====================
app.get('/admin/audit-logs', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var limit = parseInt(req.query.limit) || 200;
    if (limit > 500) limit = 500;
    var { data, error } = await supabase.from('posts')
      .select('id, user_name, content, media_url, created_at')
      .eq('media_type', AUDIT_LOG_MARKER)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    var logs = (data || []).map(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      return {
        id: row.id,
        action: info.action || row.media_url,
        operator: info.operator || row.user_name,
        detail: info.detail || '',
        timestamp: info.timestamp || row.created_at,
        created_at: row.created_at
      };
    });
    return res.json({ data: logs });
  } catch(e) {
    console.error('[API] 审计日志查询失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// ===================== 用户访问统计（管理员） =====================
app.get('/admin/stats/users', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    const [authRows, userInfoRows, visitRows] = await Promise.all([
      fetchAllPostsByMediaType(AUTH_MARKER, 'user_name, created_at'),
      fetchAllPostsByMediaType(USER_INFO_MARKER, 'user_name, content, created_at'),
      fetchAllPostsByMediaType(USER_VISIT_MARKER, 'user_name, content, media_url, created_at')
    ]);

    const authMap = buildAuthUserMap(authRows);
    const userInfoMap = buildUserInfoMap(userInfoRows);
    const userVisitMap = buildUserVisitMap(visitRows);
    const allUserNames = new Set([
      ...Object.keys(authMap),
      ...Object.keys(userInfoMap),
      ...Object.keys(userVisitMap)
    ]);

    const result = Array.from(allUserNames).map(userName => {
      const authInfo = authMap[userName] || {};
      const info = userInfoMap[userName] || {};
      const visitInfo = userVisitMap[userName] || { total_visits: 0, daily_visits: {}, last_visit: null };
      const effectiveRegTime = getEffectiveRegTime(authInfo, info);
      return {
        user_name: userName,
        total_visits: visitInfo.total_visits || 0,
        daily_visits: visitInfo.daily_visits || {},
        last_visit: visitInfo.last_visit || info.last_visit || info.last_login || authInfo.auth_created_at || null,
        last_login: info.last_login || null,
        reg_time: effectiveRegTime,
        auth_created_at: authInfo.auth_created_at || null
      };
    });

    result.sort((a, b) => {
      if ((b.total_visits || 0) !== (a.total_visits || 0)) return (b.total_visits || 0) - (a.total_visits || 0);
      const ta = toTimeMs(a.last_visit || a.last_login || a.auth_created_at);
      const tb = toTimeMs(b.last_visit || b.last_login || b.auth_created_at);
      if ((Number.isFinite(tb) ? tb : 0) !== (Number.isFinite(ta) ? ta : 0)) return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      return String(a.user_name || '').localeCompare(String(b.user_name || ''), 'zh-CN');
    });

    return res.json({ users: result, total: result.length });
  } catch(e) {
    console.error('[API] 用户访问统计失败:', e.message);
    return res.status(500).json({ error: '用户访问统计加载失败' });
  }
});

app.get('/admin/users/register-alerts', verifyToken, rateLimit(60000, 20), async (req, res) => {
  try {
    const [metaRecord, authRows] = await Promise.all([
      getAdminMetaRecord('register_alerts'),
      fetchAllPostsByMediaType(AUTH_MARKER, 'user_name, created_at')
    ]);
    const meta = safeJsonParse(metaRecord && metaRecord.content);
    const lastSeenAt = meta.last_seen_register_alert_at || null;
    const fallbackBaselineIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const baselineIso = Number.isFinite(toTimeMs(lastSeenAt)) ? lastSeenAt : fallbackBaselineIso;
    const authMap = buildAuthUserMap(authRows);
    const payload = buildUnreadRegisterAlertPayload(authMap, baselineIso);
    return res.json({
      ok: true,
      unread_count: payload.unread_count,
      last_seen_at: lastSeenAt,
      latest_register_at: payload.latest_register_at,
      users: payload.users
    });
  } catch (e) {
    console.error('[API] 新用户注册提醒加载失败:', e.message);
    return res.status(500).json({ error: '新用户注册提醒加载失败' });
  }
});

app.post('/admin/users/register-alerts/read', verifyToken, rateLimit(60000, 20), async (req, res) => {
  try {
    const nowIso = new Date().toISOString();
    await saveAdminMetaFields({ last_seen_register_alert_at: nowIso }, 'register_alerts');
    return res.json({ ok: true, last_seen_at: nowIso });
  } catch (e) {
    console.error('[API] 新用户注册提醒已读写入失败:', e.message);
    return res.status(500).json({ error: '新用户注册提醒已读写入失败' });
  }
});

// ===================== 管理员邮件通知 API =====================
// 使用 Gmail SMTP 发送，需在 Render 环境变量设置：GMAIL_USER / GMAIL_APP_PASSWORD
// EMAIL_SENT_MARKER / EMAIL_RECIPIENT_MARKER 已在文件前面集中定义（行 135-136）

// 通用：邮箱归一化（trim + lowercase）
function normalizeEmailAddress(email) {
  return String(email || '').trim().toLowerCase();
}

// 通用：邮箱格式校验
function isValidEmailAddress(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

// 通用：归一化收件人 user_name
// 手动外部邮箱的 user_name 经常是邮箱本身，这种情况下应让 user_name == email 以便识别
function normalizeRecipientUserName(recipient, email) {
  var name = String((recipient && recipient.user_name) || '').trim();
  if (!name) return email;
  return name;
}

// 通用：保存收件人到历史邮箱
// recipients: [{ email, user_name? }, ...]
// 失败只 console.warn，不抛错
async function saveEmailRecipientHistory(recipients) {
  if (!Array.isArray(recipients) || !recipients.length) return 0;
  // 1) 本次发送去重 + 校验
  var histMap = {};
  recipients.forEach(function(r) {
    var e = normalizeEmailAddress(r && r.email);
    if (!e || !isValidEmailAddress(e)) return;
    if (histMap[e]) return;
    var name = normalizeRecipientUserName(r, e);
    histMap[e] = { email: e, user_name: name, last_sent_at: new Date().toISOString(), source: (name && name !== e) ? 'send_email' : 'manual' };
  });
  var histList = Object.values(histMap);
  if (!histList.length) return 0;
  // 2) 一次性查已有记录（避免 N+1）
  var existRows = [];
  try {
    var { data } = await supabase.from('posts')
      .select('id, media_url, content')
      .eq('media_type', EMAIL_RECIPIENT_MARKER)
      .eq('user_name', ADMIN_USERNAME);
    existRows = data || [];
  } catch (qe) {
    console.warn('[Email Recipient History] 查询已有记录失败:', qe.message || qe);
  }
  // 3) 索引：email -> { id, user_name }
  var existMap = {};
  existRows.forEach(function(row) {
    try {
      var eiInfo = row.content ? JSON.parse(row.content) : {};
      var eEmail = normalizeEmailAddress(eiInfo.email || row.media_url || '');
      if (eEmail) existMap[eEmail] = { id: row.id, user_name: eiInfo.user_name || '' };
    } catch (pe) {}
  });
  var saved = 0;
  for (var hi = 0; hi < histList.length; hi++) {
    var hInfo = histList[hi];
    var exist = existMap[hInfo.email];
    if (exist) {
      // 已有：保留更好的名字（如果新名字是邮箱且旧有非邮箱名字，则保留旧名字）
      if (hInfo.user_name === hInfo.email && exist.user_name && exist.user_name !== exist.user_name.toLowerCase()) {
        hInfo.user_name = exist.user_name;
      }
      try {
        await supabase.from('posts').update({ content: JSON.stringify(hInfo) }).eq('id', exist.id);
        saved++;
      } catch (ue) {
        console.warn('[Email Recipient History] 更新失败:', ue.message || ue);
      }
    } else {
      // 新增：必须带 actor_key 与 media_url，避免数据库字段限制或后续查询不稳定
      try {
        await supabase.from('posts').insert([{
          user_name: ADMIN_USERNAME,
          media_type: EMAIL_RECIPIENT_MARKER,
          media_url: hInfo.email,
          content: JSON.stringify(hInfo),
          actor_key: 'email_recipient_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
        }]);
        saved++;
      } catch (ie) {
        console.warn('[Email Recipient History] 插入失败:', ie.message || ie);
      }
    }
  }
  return saved;
}

app.get('/admin/users-with-email', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    const { data, error } = await supabase.from('posts')
      .select('user_name, content, created_at')
      .eq('media_type', '__user_info__')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    const users = [];
    (data || []).forEach(function(row) {
      try {
        const info = JSON.parse(row.content || '{}');
        if (info.email) {
          users.push({
            user_name: row.user_name,
            email: info.email,
            reg_time: info.reg_time || row.created_at,
            last_login: info.last_login
          });
        }
      } catch(e) {}
    });
    return res.json({ users, total: users.length });
  } catch (e) {
    console.error('[Email API] 获取用户邮箱列表失败:', e.message);
    return res.status(500).json({ error: '获取用户邮箱列表失败' });
  }
});

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || ''; // 优先 const 防止误覆盖
const GMAIL_GAS_URL = process.env.GMAIL_GAS_URL || ''; // Google Apps Script Web App URL（走 HTTPS 443，绕过 Render SMTP 端口封锁）

async function fetchWithTimeout(url, options, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, timeoutMs || 15000);
  var fetchOptions = Object.assign({}, options || {}, { signal: controller.signal });
  try {
    return await fetch(url, fetchOptions);
  } finally {
    clearTimeout(timer);
  }
}

// SendGrid API 发送（HTTPS 443，不受云平台 SMTP 端口封锁影响）
async function sendViaSendGrid(to, subject, text, html) {
  var resp = await fetchWithTimeout('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + SENDGRID_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: GMAIL_USER, name: 'XTJ 管理员' },
      subject: subject,
      content: [
        { type: 'text/plain', value: text || '' },
        { type: 'text/html', value: html || '' }
      ]
    })
  }, 15000);
  if (!resp.ok) {
    var body = await resp.text().catch(function(){ return ''; });
    throw new Error('SendGrid HTTP ' + resp.status + (body ? ': ' + body.slice(0, 200) : ''));
  }
}

// Google Apps Script 邮件中转（HTTPS 443，绕过 Render SMTP 端口封锁）
// 部署方法：script.google.com 新建项目，粘贴以下代码（修改 from 即可）后部署为 Web App：
//   function doPost(e) {
//     var d = JSON.parse(e.postData.contents);
//     GmailApp.sendEmail(d.to, d.subject, d.text, { htmlBody: d.html, from: '你的Gmail@gmail.com' });
//     return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
//   }
async function sendViaGAS(to, subject, text, html) {
  var resp = await fetchWithTimeout(GMAIL_GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: to, subject: subject, text: text || '', html: html || '' })
  }, 15000);
  if (!resp.ok) {
    var body = await resp.text().catch(function(){ return ''; });
    throw new Error('GAS HTTP ' + resp.status + (body ? ': ' + body.slice(0, 200) : ''));
  }
  return await resp.json().catch(function(){ return { ok: true }; });
}

// 发送邮件（优先 GAS HTTPS > SendGrid HTTPS > Gmail SMTP）
app.post('/admin/send-email', verifyToken, rateLimit(60000, 5), async (req, res) => {
  try {
    const { recipients, subject, content, content_type } = req.body;
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: '请至少选择一个收件人' });
    }
    if (!subject || !subject.trim()) {
      return res.status(400).json({ error: '请输入邮件主题' });
    }
    if (!content || !content.trim()) {
      return res.status(400).json({ error: '请输入邮件内容' });
    }
    const MAX_RECIPIENTS = 100;
    if (recipients.length > MAX_RECIPIENTS) {
      return res.status(400).json({ error: '单次最多发送 ' + MAX_RECIPIENTS + ' 人' });
    }
    const subjectVal = subject.trim().slice(0, 200);
    const isHtml = content_type === 'html';
    const bodyText = isHtml ? content.replace(/<[^>]*>/g, '') : content;
    const bodyHtml = isHtml ? content : content.split('\n').map(function(l) { return '<p>' + l.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</p>'; }).join('');
    var transporter = null;
    if (!SENDGRID_API_KEY && !GMAIL_GAS_URL) {
      transporter = getMailTransporter();
      if (!transporter) {
        return res.status(500).json({ error: '邮件服务未配置，请在 Render Dashboard 设置 GMAIL_GAS_URL（推荐）或 GMAIL_USER + GMAIL_APP_PASSWORD' });
      }
    }

    // 先保存收件人到历史（无论发送是否成功，都先存下来，包含名字）
    // 使用统一 helper，失败只 console.warn，不阻断邮件发送
    try {
      await saveEmailRecipientHistory(recipients);
    } catch(e) { console.warn('[Email] 保存收件人历史失败:', e.message || e); }

    var usedPort = mailTransporterPort;
    const sent = [];
    const failed = [];
    for (const r of recipients) {
      try {
        if (GMAIL_GAS_URL) {
          // 优先 Google Apps Script（HTTPS 443，绕过 Render SMTP 端口封锁）
          await sendViaGAS(r.email, subjectVal, bodyText, bodyHtml);
        } else if (SENDGRID_API_KEY) {
          await sendViaSendGrid(r.email, subjectVal, bodyText, bodyHtml);
        } else {
          await transporter.sendMail({
            from: '"XTJ 管理员" <' + GMAIL_USER + '>',
            to: r.email,
            subject: subjectVal,
            text: bodyText,
            html: bodyHtml
          });
        }
        sent.push(r.user_name || r.email);
      } catch (e) {
        console.error('[Email] 发送给 ' + r.email + ' 失败: ' + (e.code || '') + ' - ' + e.message);
        // GAS 失败 → 回退 SendGrid → 回退 SMTP
        if (GMAIL_GAS_URL && SENDGRID_API_KEY) {
          try {
            console.log('[Email] GAS 失败，回退到 SendGrid');
            await sendViaSendGrid(r.email, subjectVal, bodyText, bodyHtml);
            sent.push(r.user_name || r.email);
            continue;
          } catch(e2) {
            console.error('[Email] SendGrid 回退也失败: ' + e2.message);
            failed.push({ user: r.user_name || r.email, error: 'GAS失败，SendGrid也失败: ' + e2.message });
            continue;
          }
        }
        if (GMAIL_GAS_URL && !SENDGRID_API_KEY) {
          // GAS 失败且无 SendGrid，回退到 SMTP
          try {
            var gasFallbackT = getMailTransporter();
            if (gasFallbackT) {
              await gasFallbackT.sendMail({
                from: '"XTJ 管理员" <' + GMAIL_USER + '>',
                to: r.email,
                subject: subjectVal,
                text: bodyText,
                html: bodyHtml
              });
              sent.push(r.user_name || r.email);
              continue;
            }
          } catch(e2) {
            console.error('[Email] SMTP 回退也失败: ' + (e2.code || '') + ' - ' + e2.message);
          }
        }
        if (SENDGRID_API_KEY && !GMAIL_GAS_URL) {
          // SendGrid 失败 → 回退到 SMTP（不再重置常量，只走本地逻辑开关）
          var sendgridBroken = true;
          try {
            var sgTransporter = getMailTransporter();
            if (sgTransporter) {
              await sgTransporter.sendMail({
                from: '"XTJ 管理员" <' + GMAIL_USER + '>',
                to: r.email,
                subject: subjectVal,
                text: bodyText,
                html: bodyHtml
              });
              sent.push(r.user_name || r.email);
              continue;
            }
          } catch(e2) {
            console.error('[Email] SMTP 回退也失败: ' + (e2.code || '') + ' - ' + e2.message);
          }
        } else if (!GMAIL_GAS_URL && usedPort === '465' && (e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' || e.message.indexOf('timeout') > -1 || e.message.indexOf('connect') > -1)) {
          try {
            usedPort = '587';
            console.log('[Email] 465 连接失败，回退到 587 STARTTLS');
            mailTransporter = nodemailer.createTransport({
              host: 'smtp.gmail.com',
              port: 587,
              secure: false,
              requireTLS: true,
              auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
              connectionTimeout: 10000,
              greetingTimeout: 10000,
              socketTimeout: 10000
            });
            transporter = mailTransporter;
            mailTransporterPort = '587';
            await transporter.sendMail({
              from: '"XTJ 管理员" <' + GMAIL_USER + '>',
              to: r.email,
              subject: subjectVal,
              text: bodyText,
              html: bodyHtml
            });
            sent.push(r.user_name || r.email);
            continue;
          } catch(e2) {
            console.error('[Email] 587 回退也失败: ' + (e2.code || '') + ' - ' + e2.message);
            failed.push({ user: r.user_name || r.email, error: '465/587 均连接失败: ' + e2.message });
            continue;
          }
        }
        failed.push({ user: r.user_name || r.email, error: (GMAIL_GAS_URL ? 'GAS失败' : SENDGRID_API_KEY ? 'SendGrid失败，SMTP也失败: ' : '发送失败: ') + e.message });
      }
    }
    try {
      // 构建详细的收件人列表（包含名字、邮箱、发送结果）
      var detailList = recipients.map(function(r) {
        var email = String(r.email || '').trim().toLowerCase();
        var name = String(r.user_name || '').trim();
        var isSent = sent.indexOf(r.user_name || r.email) >= 0;
        var failInfo = null;
        if (!isSent) {
          for (var fi = 0; fi < failed.length; fi++) {
            if (failed[fi].user === (r.user_name || r.email)) { failInfo = failed[fi].error; break; }
          }
        }
        return { email: email, user_name: name || email, status: isSent ? 'sent' : 'failed', error: failInfo };
      });
      await supabase.from('posts').insert([{
        user_name: ADMIN_USERNAME,
        media_type: EMAIL_SENT_MARKER,
        content: JSON.stringify({
          from_email: GMAIL_USER,
          subject: subjectVal,
          sent_count: sent.length,
          failed_count: failed.length,
          total_recipients: recipients.length,
          recipients_detail: detailList,
          sent_at: new Date().toISOString()
        }),
        actor_key: 'email_' + Date.now()
      }]);
    } catch(e) {
      console.warn('[Email] 保存发送记录失败:', e.message);
    }
    if (sent.length === 0 && failed.length > 0) {
      var firstErr = failed[0].error || '';
      if (firstErr.indexOf('connect') > -1 || firstErr.indexOf('timeout') > -1 || firstErr.indexOf('ETIMEDOUT') > -1) {
        return res.json({
          ok: false,
          sent_count: 0,
          failed_count: failed.length,
          sent: sent,
          failed: failed,
          hint: 'SMTP 465/587 出站端口被云平台封锁，重启 Render 实例可能换到未封锁的宿主机。或者在 Render Dashboard 手动 Deploy 触发重启。'
        });
      }
    }
    return res.json({
      ok: true,
      sent_count: sent.length,
      failed_count: failed.length,
      sent: sent,
      failed: failed
    });
  } catch (e) {
    console.error('[Email API] 发送邮件失败:', e.message);
    return res.status(500).json({ error: '发送邮件失败' });
  }
});

// 管理员：获取邮件发送历史
app.get('/admin/email-history', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var limit = Math.min(parseInt(req.query.limit || '50'), 200);
    var { data, error } = await supabase.from('posts')
      .select('id, content, created_at')
      .eq('media_type', EMAIL_SENT_MARKER)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    var records = (data || []).map(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      return {
        id: row.id,
        from_email: info.from_email || GMAIL_USER || '',
        subject: info.subject || '',
        sent_count: info.sent_count || 0,
        failed_count: info.failed_count || 0,
        total_recipients: info.total_recipients || 0,
        recipients_detail: Array.isArray(info.recipients_detail) ? info.recipients_detail : [],
        sent_at: info.sent_at || row.created_at
      };
    });
    return res.json({ ok: true, records: records });
  } catch(e) {
    console.error('[Email History] 查询失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// ===================== 管理员邮件收件人历史 API =====================
// EMAIL_RECIPIENT_MARKER 已在前面定义（与 helper 一起放在邮件 API 区块顶部）
// 获取历史收件人
app.get('/admin/email-recipient-history', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var limit = Math.min(parseInt(req.query.limit || '100'), 200);
    var { data, error } = await supabase.from('posts')
      .select('id, content, media_url, created_at')
      .eq('media_type', EMAIL_RECIPIENT_MARKER)
      .eq('user_name', ADMIN_USERNAME)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    var seen = new Set();
    var recipients = [];
    (data || []).forEach(function(row) {
      try {
        var info = row.content ? JSON.parse(row.content) : {};
        // 兼容：info.email / row.media_url / 旧 sent_at
        var email = normalizeEmailAddress(info.email || row.media_url || '');
        if (!email || !isValidEmailAddress(email)) return;
        if (seen.has(email)) return;
        seen.add(email);
        var userName = String(info.user_name || '').trim() || email;
        recipients.push({
          id: row.id,
          email: email,
          user_name: userName,
          last_sent_at: info.last_sent_at || info.sent_at || row.created_at,
          source: info.source || ''
        });
      } catch(e) {}
    });
    return res.json({ ok: true, recipients: recipients });
  } catch(e) {
    console.error('[Email Recipient History] 查询失败:', e.message || e);
    return res.status(500).json({ error: '查询失败' });
  }
});

// 保存收件人到历史（兼容旧 emails 数组与新 recipients 数组）
app.post('/admin/email-recipient-history', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var body = req.body || {};
    var recipients = [];
    if (Array.isArray(body.recipients) && body.recipients.length) {
      // 新格式：[{ email, user_name }]
      recipients = body.recipients.map(function(r) {
        if (typeof r === 'string') return { email: r, user_name: r };
        return { email: r && r.email, user_name: r && r.user_name };
      });
    } else if (Array.isArray(body.emails) && body.emails.length) {
      // 旧格式：["a@qq.com", "b@qq.com"]
      recipients = body.emails.map(function(e) { return { email: e, user_name: e }; });
    } else {
      return res.status(400).json({ error: '缺少 recipients 或 emails' });
    }
    var saved = await saveEmailRecipientHistory(recipients);
    return res.json({ ok: true, saved: saved });
  } catch(e) {
    console.error('[Email Recipient History] 保存失败:', e.message || e);
    return res.status(500).json({ error: '保存失败' });
  }
});

// 删除指定的历史收件人（按 id 精确删除）
app.post('/admin/email-recipient-history/delete', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: '缺少邮箱' });
    var { data, error } = await supabase.from('posts')
      .select('id, content')
      .eq('media_type', EMAIL_RECIPIENT_MARKER)
      .eq('user_name', ADMIN_USERNAME);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    var idsToDelete = [];
    (data || []).forEach(function(row) {
      try {
        var info = JSON.parse(row.content || '{}');
        if ((info.email || '').trim().toLowerCase() === email) {
          idsToDelete.push(row.id);
        }
      } catch(e) {}
    });
    if (idsToDelete.length === 0) {
      return res.json({ ok: true, deleted_count: 0 });
    }
    for (var di = 0; di < idsToDelete.length; di++) {
      await supabase.from('posts').delete().eq('id', idsToDelete[di]).catch(function(){});
    }
    return res.json({ ok: true, deleted_count: idsToDelete.length });
  } catch(e) {
    console.error('[Email Recipient History] 删除失败:', e.message);
    return res.status(500).json({ error: '删除失败' });
  }
});

// 清空所有历史收件人
app.post('/admin/email-recipient-history/clear', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    await supabase.from('posts')
      .delete()
      .eq('media_type', EMAIL_RECIPIENT_MARKER)
      .eq('user_name', ADMIN_USERNAME);
    return res.json({ ok: true });
  } catch(e) {
    console.error('[Email Recipient History] 清空失败:', e.message);
    return res.status(500).json({ error: '清空失败' });
  }
});

// ===================== VIP 会员 API =====================
// VIP_MARKER / VIP_ORDER_MARKER / VIP_PLAN_MARKER 已在文件前面集中定义（行 129-131）

const VIP_PLANS = [
  {
    id: 'pro_monthly',
    name: 'XTJ Pro',
    price: 3,
    currency: 'CNY',
    duration_days: 30,
    features: ['custom_theme', 'pro_chat_bubble', 'pro_post_style']
  }
];

// 获取可用套餐列表
// 2026-06-25：Pro 改为限量/限定/限时活动制，不再开放常驻购买
app.get('/api/vip/plans', rateLimit(60000, 30), (req, res) => {
  return res.json({
    plans: [],
    message: 'Pro 购买暂未开放，请通过管理员活动领取'
  });
});

// 验证用户是否存在的辅助函数
async function verifyUserExists(userName) {
  const { data } = await supabase.from('posts')
    .select('id')
    .eq('user_name', userName)
    .eq('media_type', AUTH_MARKER)
    .limit(1);
  return data && data.length > 0;
}

// 创建订单
// 2026-06-25：Pro 改为限量/限定/限时活动制，create-order 不再直接激活 Pro
// 也不再写 __vip_order__ 记录（避免脏数据）
// 真正开通 Pro 的唯一合法路径是 /api/pro-gifts/claim
app.post('/api/vip/create-order', rateLimit(60000, 10), async (req, res) => {
  return res.status(403).json({
    ok: false,
    error: '暂未开放购买，请通过管理员发布的 Pro 活动领取'
  });
});

// 直接激活VIP（免支付流程）- 2026-06-25 永久禁用（所有环境）
// 真正开通 Pro 的唯一合法路径是 /api/pro-gifts/claim
app.post('/api/vip/activate-test', rateLimit(60000, 5), async (req, res) => {
  return res.status(404).json({
    ok: false,
    error: '测试激活端点已永久禁用，请通过管理员发布的 Pro 活动领取'
  });
});

// 处理VIP支付完成（修复：先写VIP记录再更新订单，保证数据一致性）
async function processVipPayment(userName, orderNo, plan) {
  const now = new Date();
  const expireAt = new Date(now.getTime() + plan.duration_days * 24 * 60 * 60 * 1000).toISOString();
  const vipContent = JSON.stringify({
    plan_id: plan.id,
    plan_name: plan.name,
    price: plan.price,
    is_active: true,
    order_no: orderNo,
    start_at: now.toISOString(),
    expire_at: expireAt,
    features: plan.features,
    activated_at: now.toISOString()
  });

  // ★ 修复 B1：先写VIP记录（"真金白银"），再更新订单状态（辅助记录）
  // 如果VIP记录写入失败，订单仍为pending，用户可重试——不会出现"钱付了但VIP没开通"
  const { error: vipErr } = await supabase.from('posts').insert([{
    user_name: userName,
    content: vipContent,
    media_type: VIP_MARKER,
    media_url: plan.id,
    actor_key: 'vip_' + Date.now()
  }]);

  if (vipErr) throw vipErr;

  // VIP记录写入成功后，再更新订单状态为paid
  const { data: orders } = await supabase.from('posts')
    .select('id')
    .eq('media_type', VIP_ORDER_MARKER)
    .eq('media_url', orderNo)
    .limit(1);

  if (orders && orders.length > 0) {
    try {
      var orderData = JSON.parse(orders[0].content || '{}');
      orderData.status = 'paid';
      orderData.paid_at = now.toISOString();
      await supabase.from('posts').update({ content: JSON.stringify(orderData) }).eq('id', orders[0].id);
    } catch(e) {
      console.error('[VIP] 更新订单状态失败（VIP记录已写入）:', e.message);
      // 订单状态更新失败不影响VIP生效——VIP记录已写入
    }
  }

  return {
    ok: true,
    user_name: userName,
    plan_name: plan.name,
    expire_at: expireAt,
    is_active: true
  };
}

// 查询VIP状态
app.get('/api/vip/status', rateLimit(60000, 60), async (req, res) => {
  try {
    const userName = req.query.user_name;
    if (!userName) return res.status(400).json({ error: '缺少用户名' });

    const { data: vipRecords } = await supabase.from('posts')
      .select('*')
      .eq('user_name', userName)
      .eq('media_type', VIP_MARKER)
      .order('created_at', { ascending: false })
      .limit(5);

    var activeVip = null;
    var allVips = (vipRecords || []).map(function(r) {
      try {
        var c = JSON.parse(r.content || '{}');
        if (c.is_active && c.expire_at && new Date(c.expire_at) > new Date() && !activeVip) {
          activeVip = c;
        }
        return c;
      } catch(e) { return null; }
    }).filter(Boolean);

    return res.json({
      is_vip: !!activeVip,
      active_vip: activeVip,
      history: allVips
    });
  } catch(e) {
    console.error('[VIP] 查询状态失败:', e.message);
    return res.status(500).json({ error: '查询VIP状态失败' });
  }
});

// ===================== Pro 赠送活动管理 =====================
// PRO_GIFT_MARKER / PRO_GIFT_CLAIM_MARKER 已在文件前面集中定义（行 132-133）
const VISUAL_PRO_FEATURES = ['custom_theme', 'pro_chat_bubble', 'pro_post_style'];
const DEFAULT_GIFT_FEATURES = VISUAL_PRO_FEATURES.slice();

function normalizeVisualProFeatures(features) {
  var arr = Array.isArray(features) ? features : [];
  var clean = arr.filter(function(f) {
    return VISUAL_PRO_FEATURES.indexOf(String(f || '')) >= 0;
  });
  return clean.length ? clean : VISUAL_PRO_FEATURES.slice();
}

// 管理员：获取全部 Pro 赠送活动
// 2026-06-25：返回完整字段，包含 claim_limit / allowed_users / exclusive / start_at / end_at
// claimed_count 必须从 __pro_gift_claim__ 实时统计（不信 content 里的 claimed_count）
app.get('/admin/pro-gifts', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    const [giftsRes, claimsRes] = await Promise.all([
      supabase.from('posts')
        .select('id, user_name, content, created_at')
        .eq('media_type', PRO_GIFT_MARKER)
        .order('created_at', { ascending: false })
        .limit(200),
      // 实时统计领取数
      supabase.from('posts')
        .select('id, content')
        .eq('media_type', PRO_GIFT_CLAIM_MARKER)
        .limit(2000)
    ]);
    if (giftsRes.error) return res.status(400).json({ error: sanitizeError(giftsRes.error) });

    // 索引：campaign_id -> claimed_count
    var claimedMap = {};
    (claimsRes.data || []).forEach(function(row) {
      try {
        var ci = JSON.parse(row.content || '{}');
        var cid = String(ci.campaign_id || '').trim();
        if (cid) claimedMap[cid] = (claimedMap[cid] || 0) + 1;
      } catch(e) {}
    });

    var gifts = (giftsRes.data || []).map(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      // 兼容字段别名：allowed_users / exclusive_users / target_users
      var allowedArr = Array.isArray(info.allowed_users) ? info.allowed_users
                      : Array.isArray(info.exclusive_users) ? info.exclusive_users
                      : Array.isArray(info.target_users) ? info.target_users
                      : [];
      var limitNum = parseInt(info.claim_limit != null ? info.claim_limit : (info.limit != null ? info.limit : (info.max_claims != null ? info.max_claims : 0)));
      if (!Number.isFinite(limitNum) || limitNum < 0) limitNum = 0;
      // 实时统计 claimed_count（不信任 content 里的 claimed_count）
      var claimedCount = claimedMap[String(row.id)] || 0;
      var remainingCount = limitNum > 0 ? Math.max(0, limitNum - claimedCount) : null;
      return {
        id: row.id,
        created_by: row.user_name,
        created_at: row.created_at,
        title: info.title || '',
        description: info.description || '',
        features: normalizeVisualProFeatures(info.features),
        duration_days: parseInt(info.duration_days) || 30,
        start_at: info.start_at || '',
        end_at: info.end_at || '',
        claim_expire_at: info.claim_expire_at || '',
        claim_limit: limitNum,
        claimed_count: claimedCount,
        remaining_count: remainingCount,
        allowed_users: allowedArr,
        exclusive_users: Array.isArray(info.exclusive_users) ? info.exclusive_users : [],
        target_users: Array.isArray(info.target_users) ? info.target_users : [],
        exclusive: !!info.exclusive,
        is_active: info.is_active !== false,
        is_published: !!info.is_published,
        published_at: info.published_at || '',
        updated_at: info.updated_at || ''
      };
    });
    return res.json({ ok: true, gifts: gifts });
  } catch(e) {
    console.error('[ProGift] 查询失败:', e.message || e);
    return res.status(500).json({ error: '查询失败' });
  }
});

// 管理员：创建/编辑 Pro 赠送活动
app.post('/admin/pro-gifts/save', verifyToken, rateLimit(60000, 20), async (req, res) => {
  try {
    var { id, title, description, features, duration_days, claim_expire_at,
          claim_limit, allowed_users, exclusive, start_at, end_at } = req.body;
    var titleVal = String(title || '').trim().slice(0, 100);
    var descVal = String(description || '').trim().slice(0, 500);
    if (!titleVal) return res.status(400).json({ error: '请输入活动标题' });
    if (!duration_days || duration_days < 1 || duration_days > 3650) return res.status(400).json({ error: '有效期1-3650天' });
    var featuresArr = normalizeVisualProFeatures(features);
    // 解析限定用户（支持字符串 "xxz, abc" 或数组）
    var allowedArr = [];
    if (Array.isArray(allowed_users)) {
      allowedArr = allowed_users.map(function(u) { return String(u || '').trim(); }).filter(Boolean);
    } else if (typeof allowed_users === 'string' && allowed_users.trim()) {
      allowedArr = allowed_users.split(/[,，\n;；\s]+/).map(function(u) { return String(u || '').trim(); }).filter(Boolean);
    }
    var limitNum = parseInt(claim_limit);
    if (!Number.isFinite(limitNum) || limitNum < 0) limitNum = 0;
    var isExclusive = !!exclusive;
    var startAtISO = start_at ? new Date(start_at).toISOString() : '';
    var endAtISO = end_at ? new Date(end_at).toISOString() : '';
    var claimExpireISO = claim_expire_at ? new Date(claim_expire_at).toISOString() : (endAtISO || '');
    var info = {
      title: titleVal,
      description: descVal,
      features: featuresArr,
      duration_days: Math.min(3650, Math.max(1, parseInt(duration_days) || 30)),
      claim_expire_at: claimExpireISO,
      start_at: startAtISO,
      end_at: endAtISO,
      claim_limit: limitNum,
      allowed_users: allowedArr,
      exclusive: isExclusive,
      is_published: false,
      updated_at: new Date().toISOString()
    };
    const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'xxz';
    if (id) {
      // 编辑已有的
      var { data: existing } = await supabase.from('posts')
        .select('content').eq('id', id).eq('media_type', PRO_GIFT_MARKER).maybeSingle();
      if (!existing) return res.status(404).json({ error: '活动不存在' });
      var oldInfo = {};
      try { oldInfo = JSON.parse(existing.content || '{}'); } catch(e) {}
      // 保留原发布状态
      info.is_published = !!oldInfo.is_published;
      info.published_at = oldInfo.published_at || '';
      info.created_at = oldInfo.created_at || new Date().toISOString();
      var { error: updateErr } = await supabase.from('posts')
        .update({ content: JSON.stringify(info) })
        .eq('id', id);
      if (updateErr) return res.status(400).json({ error: sanitizeError(updateErr) });
    } else {
      // 新建
      info.created_at = new Date().toISOString();
      var { error: insertErr } = await supabase.from('posts').insert([{
        user_name: ADMIN_USERNAME,
        media_type: PRO_GIFT_MARKER,
        content: JSON.stringify(info),
        actor_key: 'pro_gift_' + Date.now()
      }]);
      if (insertErr) return res.status(400).json({ error: sanitizeError(insertErr) });
    }
    return res.json({ ok: true });
  } catch(e) {
    console.error('[ProGift] 保存失败:', e.message);
    return res.status(500).json({ error: '保存失败' });
  }
});

// 管理员：发布/取消发布 Pro 赠送活动
app.post('/admin/pro-gifts/toggle-publish', verifyToken, rateLimit(60000, 20), async (req, res) => {
  try {
    var { id, publish } = req.body;
    if (!id) return res.status(400).json({ error: '缺少活动ID' });
    var { data: existing } = await supabase.from('posts')
      .select('content').eq('id', id).eq('media_type', PRO_GIFT_MARKER).maybeSingle();
    if (!existing) return res.status(404).json({ error: '活动不存在' });
    var info = {};
    try { info = JSON.parse(existing.content || '{}'); } catch(e) {}
    info.is_published = !!publish;
    if (publish && !info.published_at) info.published_at = new Date().toISOString();
    info.updated_at = new Date().toISOString();
    var { error: updateErr } = await supabase.from('posts')
      .update({ content: JSON.stringify(info) })
      .eq('id', id);
    if (updateErr) return res.status(400).json({ error: sanitizeError(updateErr) });
    return res.json({ ok: true, is_published: !!publish, published_at: info.published_at });
  } catch(e) {
    console.error('[ProGift] 发布操作失败:', e.message);
    return res.status(500).json({ error: '操作失败' });
  }
});

// 管理员：删除 Pro 赠送活动
app.post('/admin/pro-gifts/delete', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var { id } = req.body;
    if (!id) return res.status(400).json({ error: '缺少活动ID' });
    var { error } = await supabase.from('posts')
      .delete().eq('id', id).eq('media_type', PRO_GIFT_MARKER);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    return res.json({ ok: true });
  } catch(e) {
    console.error('[ProGift] 删除失败:', e.message);
    return res.status(500).json({ error: '删除失败' });
  }
});

// 用户：获取可领取的 Pro 赠送活动（严格按用户身份过滤）
app.get('/api/pro-gifts/available', rateLimit(60000, 30), authenticateUser, async (req, res) => {
  try {
    var userName = String((req.userName || req.query.user_name) || '').trim();
    if (!userName) return res.status(401).json({ error: '请先登录' });
    var now = new Date();
    var nowISO = now.toISOString();
    // 一次性查出所有已发布的活动
    var { data: gifts } = await supabase.from('posts')
      .select('id, content, created_at')
      .eq('media_type', PRO_GIFT_MARKER)
      .order('created_at', { ascending: false })
      .limit(200);
    // 一次性查用户的所有领取记录（用于标记已领取 + 统计每活动总数）
    var { data: userClaims } = await supabase.from('posts')
      .select('media_url, content')
      .eq('media_type', PRO_GIFT_CLAIM_MARKER)
      .eq('user_name', userName)
      .limit(500);
    var userClaimedIds = new Set();
    (userClaims || []).forEach(function(c) {
      if (c.media_url) userClaimedIds.add(String(c.media_url));
    });
    // 查所有领取记录（按 campaign_id 统计总量，用于 claim_limit）
    var claimCountByCampaign = {};
    var { data: allClaims } = await supabase.from('posts')
      .select('media_url')
      .eq('media_type', PRO_GIFT_CLAIM_MARKER)
      .limit(5000);
    (allClaims || []).forEach(function(c) {
      if (c.media_url) claimCountByCampaign[c.media_url] = (claimCountByCampaign[c.media_url] || 0) + 1;
    });

    var available = [];
    (gifts || []).forEach(function(g) {
      var info = {};
      try { info = JSON.parse(g.content || '{}'); } catch(e) {}
      // 1. 必须已发布
      if (!info.is_published && info.status !== 'published') return;
      // 2. 不可禁用
      if (info.is_active === false) return;
      // 3. start_at 未到
      if (info.start_at && new Date(info.start_at) > now) return;
      // 4. end_at 已过
      if (info.end_at && new Date(info.end_at) < now) return;
      // 5. claim_expire_at 已过
      if (info.claim_expire_at && new Date(info.claim_expire_at) < now) return;
      // 6. 限定用户检查（allowed_users / exclusive_users / target_users 任一非空）
      var allowedArr = [];
      if (Array.isArray(info.allowed_users)) allowedArr = allowedArr.concat(info.allowed_users);
      if (Array.isArray(info.exclusive_users)) allowedArr = allowedArr.concat(info.exclusive_users);
      if (Array.isArray(info.target_users)) allowedArr = allowedArr.concat(info.target_users);
      allowedArr = allowedArr.map(function(u) { return String(u || '').trim(); }).filter(Boolean);
      var hasAllowList = info.exclusive === true || allowedArr.length > 0;
      if (hasAllowList && allowedArr.indexOf(userName) === -1) return; // 用户不在白名单，不返回
      // 7. claim_limit 限制
      var claimLimit = parseInt(info.claim_limit || info.limit || info.max_claims) || 0;
      var claimedCount = claimCountByCampaign[g.id] || 0;
      var alreadyClaimed = userClaimedIds.has(String(g.id));
      // 已领取的即使名额满也要返回（用于展示"已领取"）
      if (claimLimit > 0 && claimedCount >= claimLimit && !alreadyClaimed) return; // 名额已满且未领取，不返回
      var remainingCount = claimLimit > 0 ? Math.max(0, claimLimit - claimedCount) : null;

      available.push({
        id: g.id,
        title: info.title || '',
        description: info.description || '',
        features: normalizeVisualProFeatures(info.features),
        duration_days: info.duration_days || 30,
        start_at: info.start_at || '',
        end_at: info.end_at || '',
        claim_expire_at: info.claim_expire_at || '',
        claim_limit: claimLimit,
        claimed_count: claimedCount,
        remaining_count: remainingCount,
        exclusive: !!info.exclusive || (allowedArr.length > 0),
        allowed_users: allowedArr,
        already_claimed: alreadyClaimed,
        published_at: info.published_at || ''
      });
    });
    return res.json({ ok: true, gifts: available });
  } catch(e) {
    console.error('[ProGift] 查询可用活动失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// 用户：领取 Pro 赠送活动（强校验：身份、发布状态、时间、限定用户、名额、重复领取）
app.post('/api/pro-gifts/claim', rateLimit(60000, 10), authenticateUser, async (req, res) => {
  try {
    var { user_name, gift_id } = req.body;
    var userNameVal = String(user_name || req.userName || '').trim();
    // 强制以 req.userName 为准（认证中间件写入），避免 body 传任意 user_name 替别人领
    if (req.userName) userNameVal = String(req.userName).trim();
    var giftId = String(gift_id || '').trim();
    if (!userNameVal) return res.status(401).json({ error: '请先登录' });
    if (!giftId) return res.status(400).json({ error: '缺少活动ID' });
    var now = new Date();
    var nowISO = now.toISOString();
    // 1. 活动存在 + media_type 正确
    var { data: gift } = await supabase.from('posts')
      .select('content').eq('id', giftId).eq('media_type', PRO_GIFT_MARKER).maybeSingle();
    if (!gift) return res.status(404).json({ error: '活动不存在' });
    var giftInfo = {};
    try { giftInfo = JSON.parse(gift.content || '{}'); } catch(e) {}
    // 2. 已发布
    if (!giftInfo.is_published && giftInfo.status !== 'published') return res.status(400).json({ error: '活动未发布' });
    // 3. 未禁用
    if (giftInfo.is_active === false) return res.status(400).json({ error: '活动已禁用' });
    // 4. 时间窗口
    if (giftInfo.start_at && new Date(giftInfo.start_at) > now) return res.status(400).json({ error: '活动未开始' });
    if (giftInfo.end_at && new Date(giftInfo.end_at) < now) return res.status(400).json({ error: '活动已结束' });
    if (giftInfo.claim_expire_at && new Date(giftInfo.claim_expire_at) < now) return res.status(400).json({ error: '活动已过期' });
    // 5. 限定用户白名单
    var allowedArr = [];
    if (Array.isArray(giftInfo.allowed_users)) allowedArr = allowedArr.concat(giftInfo.allowed_users);
    if (Array.isArray(giftInfo.exclusive_users)) allowedArr = allowedArr.concat(giftInfo.exclusive_users);
    if (Array.isArray(giftInfo.target_users)) allowedArr = allowedArr.concat(giftInfo.target_users);
    allowedArr = allowedArr.map(function(u) { return String(u || '').trim(); }).filter(Boolean);
    var hasAllowList = giftInfo.exclusive === true || allowedArr.length > 0;
    if (hasAllowList && allowedArr.indexOf(userNameVal) === -1) {
      return res.status(403).json({ error: '你不在本次活动领取名单中' });
    }
    // 6. 查当前活动领取总数（用于 claim_limit 二次校验）
    var claimLimit = parseInt(giftInfo.claim_limit || giftInfo.limit || giftInfo.max_claims) || 0;
    if (claimLimit > 0) {
      var { data: allClaimRows } = await supabase.from('posts')
        .select('id')
        .eq('media_type', PRO_GIFT_CLAIM_MARKER)
        .eq('media_url', giftId)
        .limit(5000);
      if (allClaimRows && allClaimRows.length >= claimLimit) {
        return res.status(400).json({ error: '活动名额已满' });
      }
    }
    // 7. 当前用户是否已领取同一活动（强校验，不依赖前端）
    var { data: existingClaim } = await supabase.from('posts')
      .select('id').eq('media_type', PRO_GIFT_CLAIM_MARKER)
      .eq('user_name', userNameVal)
      .eq('media_url', giftId)
      .maybeSingle();
    if (existingClaim) return res.status(400).json({ error: '你已经领取过该活动' });

    var durationDays = giftInfo.duration_days || 30;
    var expireAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    var features = normalizeVisualProFeatures(giftInfo.features);
    // 写入领取记录（先写，防并发重复领取）
    var claimContent = JSON.stringify({
      campaign_id: giftId,
      campaign_title: giftInfo.title || '',
      user_name: userNameVal,
      claimed_at: nowISO,
      vip_expire_at: expireAt,
      features: features,
      duration_days: durationDays
    });
    var { data: claimData, error: claimErr } = await supabase.from('posts').insert([{
      user_name: userNameVal,
      media_type: PRO_GIFT_CLAIM_MARKER,
      media_url: giftId,
      content: claimContent,
      actor_key: 'pro_claim_' + Date.now()
    }]).select('id').maybeSingle();
    if (claimErr) return res.status(400).json({ error: sanitizeError(claimErr) });
    // 写入 VIP 激活记录
    var vipContent = JSON.stringify({
      plan_id: 'pro_gift_' + giftId,
      plan_name: 'XTJ Pro (' + (giftInfo.title || '赠送') + ')',
      price: 0,
      is_active: true,
      order_no: 'GIFT_' + Date.now(),
      start_at: nowISO,
      expire_at: expireAt,
      features: features,
      activated_at: nowISO,
      source: 'pro_gift'
    });
    var { error: vipErr } = await supabase.from('posts').insert([{
      user_name: userNameVal,
      media_type: VIP_MARKER,
      media_url: 'pro_monthly',
      content: vipContent,
      actor_key: 'vip_' + Date.now()
    }]);
    if (vipErr) {
      // VIP 写入失败时回滚领取记录
      console.warn('[ProGift] VIP记录写入失败，回滚领取记录:', vipErr.message);
      try {
        if (claimData && claimData.id) {
          await supabase.from('posts').delete().eq('id', claimData.id);
        }
      } catch (rollbackErr) {
        console.error('[ProGift] 回滚领取记录失败:', rollbackErr.message);
      }
      return res.status(500).json({ error: 'VIP激活失败，请重试' });
    }
    return res.json({
      ok: true,
      user_name: userNameVal,
      plan_name: 'XTJ Pro (' + (giftInfo.title || '赠送') + ')',
      expire_at: expireAt,
      is_active: true,
      features: features,
      source: 'pro_gift'
    });
  } catch(e) {
    console.error('[ProGift] 领取失败:', e.message);
    return res.status(500).json({ error: '领取失败' });
  }
});

// 管理员：手动赠送 Pro 给指定用户
app.post('/admin/pro-gifts/manual-gift', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var { user_name, duration_days, features, reason } = req.body;
    var userNameVal = String(user_name || '').trim();
    if (!userNameVal) return res.status(400).json({ error: '请输入用户名' });
    var days = Math.min(3650, Math.max(1, parseInt(duration_days) || 30));
    var featuresArr = normalizeVisualProFeatures(features);
    var reasonVal = String(reason || '管理员手动赠送').trim().slice(0, 200);
    var now = new Date();
    var nowISO = now.toISOString();
    var expireAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    // 写入 VIP 激活记录
    var vipContent = JSON.stringify({
      plan_id: 'admin_gift_' + Date.now(),
      plan_name: 'XTJ Pro (管理员赠送)',
      price: 0,
      is_active: true,
      order_no: 'ADMIN_GIFT_' + Date.now(),
      start_at: nowISO,
      expire_at: expireAt,
      features: featuresArr,
      activated_at: nowISO,
      source: 'admin_gift',
      reason: reasonVal
    });
    var { error: vipErr } = await supabase.from('posts').insert([{
      user_name: userNameVal,
      media_type: VIP_MARKER,
      media_url: 'pro_monthly',
      content: vipContent,
      actor_key: 'vip_' + Date.now()
    }]);
    if (vipErr) return res.status(400).json({ error: sanitizeError(vipErr) });
    return res.json({
      ok: true,
      user_name: userNameVal,
      plan_name: 'XTJ Pro (管理员赠送)',
      expire_at: expireAt,
      is_active: true,
      features: featuresArr,
      source: 'admin_gift'
    });
  } catch(e) {
    console.error('[ProGift] 手动赠送失败:', e.message);
    return res.status(500).json({ error: '赠送失败' });
  }
});

// 管理员：获取全部 Pro 激活/领取历史记录
app.get('/admin/pro-gifts/history', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    // 查询所有 VIP 激活记录
    var { data: vipRecords } = await supabase.from('posts')
      .select('user_name, content, media_type, media_url, created_at')
      .eq('media_type', VIP_MARKER)
      .order('created_at', { ascending: false })
      .limit(500);
    // 查询所有 Pro 赠送领取记录
    var { data: claimRecords } = await supabase.from('posts')
      .select('user_name, content, media_type, media_url, created_at')
      .eq('media_type', PRO_GIFT_CLAIM_MARKER)
      .order('created_at', { ascending: false })
      .limit(500);
    // 查询所有订单记录 (paid)
    var { data: orderRecords } = await supabase.from('posts')
      .select('user_name, content, media_type, media_url, created_at')
      .eq('media_type', VIP_ORDER_MARKER)
      .order('created_at', { ascending: false })
      .limit(500);

    var records = [];

    // 处理 VIP 激活记录
    (vipRecords || []).forEach(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      var source = info.source || 'unknown';
      var sourceLabel = '其他';
      if (source === 'pro_gift') sourceLabel = '活动领取';
      else if (source === 'admin_gift') sourceLabel = '管理员赠送';
      else if (source === 'frontend_direct') sourceLabel = '自主开通';
      else if (source === 'paid' || source === 'payment') sourceLabel = '付费购买';
      records.push({
        type: 'vip_activation',
        user_name: row.user_name,
        source: source,
        source_label: sourceLabel,
        activated_at: info.activated_at || info.start_at || row.created_at,
        expire_at: info.expire_at || '',
        plan_name: info.plan_name || 'XTJ Pro',
        price: info.price || 0,
        features: normalizeVisualProFeatures(info.features),
        created_at: row.created_at
      });
    });

    // 处理领取记录
    (claimRecords || []).forEach(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      records.push({
        type: 'gift_claim',
        user_name: row.user_name,
        source: 'pro_gift',
        source_label: '免费赠送',
        gift_id: info.campaign_id || row.media_url,
        gift_title: info.campaign_title || '',
        activated_at: info.claimed_at || row.created_at,
        expire_at: info.vip_expire_at || '',
        duration_days: info.duration_days || 0,
        features: normalizeVisualProFeatures(info.features),
        created_at: row.created_at
      });
    });

    // 处理订单 (支付记录)
    (orderRecords || []).forEach(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      if (info.status === 'paid') {
        records.push({
          type: 'order_paid',
          user_name: row.user_name,
          source: 'paid',
          source_label: '付费购买',
          order_no: info.order_no || row.media_url,
          amount: info.amount || 0,
          paid_at: info.paid_at || row.created_at,
          created_at: row.created_at
        });
      }
    });

    // 按时间倒序排列
    records.sort(function(a, b) {
      var ta = a.activated_at || a.paid_at || a.created_at || '';
      var tb = b.activated_at || b.paid_at || b.created_at || '';
      return tb.localeCompare(ta);
    });

    // 统计每个用户的 Pro 次数和来源
    var userStats = {};
    records.forEach(function(r) {
      var un = r.user_name;
      if (!userStats[un]) userStats[un] = { count: 0, sources: [], first_at: '', last_at: '', last_expire: '' };
      userStats[un].count++;
      if (!userStats[un].sources.includes(r.source_label)) userStats[un].sources.push(r.source_label);
      var t = r.activated_at || r.paid_at || r.created_at || '';
      if (t && (!userStats[un].first_at || t < userStats[un].first_at)) userStats[un].first_at = t;
      if (t && (!userStats[un].last_at || t > userStats[un].last_at)) userStats[un].last_at = t;
      if (r.expire_at && (!userStats[un].last_expire || r.expire_at > userStats[un].last_expire)) userStats[un].last_expire = r.expire_at;
    });

    return res.json({ ok: true, records: records, user_stats: userStats });
  } catch(e) {
    console.error('[ProGift] 查询历史失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// ===================== 客户端错误监控 =====================
app.post('/api/client-error-log', rateLimit(60000, 30), async (req, res) => {
  try {
    var { type, message, stack, url, line, col, user_agent, timestamp } = req.body;
    var errorType = (type || 'unknown').slice(0, 50);
    var errorMsg = (message || '').slice(0, 500);
    var errorStack = (stack || '').slice(0, 1000);
    var pageUrl = (url || '').slice(0, 500);
    var ua = (user_agent || '').slice(0, 500);

    await supabase.from('posts').insert([{
      user_name: 'system',
      media_type: CLIENT_ERROR_MARKER,
      media_url: errorType,
      content: JSON.stringify({
        type: errorType,
        message: errorMsg,
        stack: errorStack,
        url: pageUrl,
        line: line || null,
        col: col || null,
        user_agent: ua,
        timestamp: timestamp || new Date().toISOString()
      }),
      actor_key: 'cl_err_' + Date.now()
    }]);
    return res.json({ ok: true });
  } catch(e) {
    return res.status(500).json({ error: '记录失败' });
  }
});

app.get('/admin/error-logs', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var limit = parseInt(req.query.limit) || 200;
    if (limit > 500) limit = 500;
    var query = supabase.from('posts')
      .select('id, content, media_url, created_at')
      .eq('media_type', CLIENT_ERROR_MARKER)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (req.query.type) {
      query = query.eq('media_url', req.query.type);
    }

    var { data, error } = await query;
    if (error) return res.status(400).json({ error: sanitizeError(error) });

    var logs = (data || []).map(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      return {
        id: row.id,
        type: info.type || row.media_url,
        message: info.message || '',
        stack: info.stack || '',
        url: info.url || '',
        line: info.line,
        col: info.col,
        user_agent: info.user_agent || '',
        timestamp: info.timestamp || row.created_at,
        created_at: row.created_at
      };
    });
    return res.json({ data: logs });
  } catch(e) {
    console.error('[API] 错误日志查询失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// ===================== AI 聊天接口（徐旭泽的小猫）=====================
// ★ 所有 AI 路由必须：
// 1. 走 authenticateUser 中间件（验证用户身份）
// 2. 走 checkAiUserRateLimit 限流（防滥用，按 userName）
// 3. 字段严格验证（防注入 + 长度限制）
// 4. 数据存 posts 表 + AI_AGENT_*_MARKER（已加入 applyPublicPostExclusions 过滤）

const AI_CHAT_MESSAGE_MAX_LEN = Math.min(
  Math.max(parseInt(process.env.AI_CHAT_MESSAGE_MAX_LEN || '8000', 10) || 8000, 1000),
  20000
);
const AI_CHAT_HISTORY_LIMIT = 10;
const AI_CHAT_HOURLY_IP_LIMIT = 30;
const AI_MEMORY_MAX_LEN = 800;
const AI_MEMORY_SUMMARIZE_HISTORY = 10;

// 生成简短的 conversation_id
function genConvId() {
  return Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

// 解析 media_url 中的元数据：新数据为 JSON {role, convId, usage}，旧数据为纯字符串 role
function parseMsgMeta(r) {
  var raw = r.media_url || '';
  if (raw.indexOf('{') === 0) {
    try { return JSON.parse(raw); } catch(e) { return { role: 'user' }; }
  }
  return { role: raw === 'assistant' ? 'assistant' : 'user' };
}

function getConvIdFromActorKey(actorKey) {
  var ak = String(actorKey || '');
  var prefix = 'ai_msg_conv_';
  if (ak.indexOf(prefix) !== 0) return '';
  var rest = ak.slice(prefix.length);
  var markerUser = '_user_';
  var markerAgent = '_agent_';
  var idxUser = rest.indexOf(markerUser);
  var idxAgent = rest.indexOf(markerAgent);
  var idx = -1;
  if (idxUser >= 0 && idxAgent >= 0) idx = Math.min(idxUser, idxAgent);
  else if (idxUser >= 0) idx = idxUser;
  else if (idxAgent >= 0) idx = idxAgent;
  if (idx < 0) return '';
  return rest.slice(0, idx);
}

function resolveConvId(r) {
  var meta = parseMsgMeta(r);
  if (meta && meta.convId) return String(meta.convId);
  return getConvIdFromActorKey(r.actor_key);
}

function buildMsgMeta(role, convId, usage, reasoning, seq) {
  var obj = { role: role, convId: convId };
  if (usage) obj.usage = usage;
  if (reasoning) obj.reasoning = reasoning;
  if (typeof seq === 'number') obj.seq = seq;
  return JSON.stringify(obj);
}

app.get('/api/agent/profile', authenticateUser, async (req, res) => {
  return res.status(410).json({ error: '已废弃，AI 配置由管理员统一管理' });
});

// GET /api/agent/config - 普通用户获取当前 AI 公共配置（不含 system_prompt）
app.get('/api/agent/config', authenticateUser, async (req, res) => {
  try {
    var config = await getAiConfig();
    return res.json({
      ok: true,
      config: {
        name: config.name || '徐旭泽的小猫',
        avatar: config.avatar || '🐱',
        avatar_url: config.avatar_url || '',
        avatar_type: config.avatar_type || 'emoji',
        avatar_version: config.avatar_version || 0,
        description: config.description || '陪你聊天的小猫',
        welcome_message: config.welcome_message || '喵，来聊天吧。',
        allow_web_search: config.allow_web_search === true
      }
    });
  } catch (e) {
    console.error('[AI-CONFIG] GET /api/agent/config error:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

app.post('/api/agent/profile', authenticateUser, async (req, res) => {
  return res.status(403).json({ error: '该接口已关闭，AI 配置由管理员统一管理' });
});

// ===================== AI 智能体 chat 接口 =====================
//
// ★ 缓存优化设计（DeepSeek prompt cache）：
//   DeepSeek 按 token 序列前缀匹配缓存。把 system prompt 拆成两段：
//   - 第 1 段（core）：人格 + 规则 → 完全固定，命中缓存概率最高
//   - 第 2 段（dynamic）：用户当前数据 + 长期记忆 → 独立 token 段，不污染 core 缓存
//   历史 user/assistant 消息按时间顺序追加，结构稳定 → 缓存命中良好。
//
// ★ 长期记忆（long-term memory）：
//   - 存储：posts 表 + media_type = AI_AGENT_MEMORY_MARKER
//   - 读取：loadAiContext 每次 chat 时拉取，作为 dynamic context 第二段
//   - 写入：chat 完成后异步（不阻塞响应）调用 AI 总结最近 10 条 + 已有 memory → 写回
//
// 1. 走 authenticateUser 中间件
// ★ 完全固定，DeepSeek 缓存命中段
function buildAiCorePrompt(config) {
  var name = String(config.name || '徐旭泽的小猫').slice(0, 30);
  var persona = String(config.persona || '').slice(0, 500);
  var tone = String(config.tone || '').slice(0, 200);
  var sysPrompt = String(config.system_prompt || '').slice(0, 2000);

  // 硬编码规则在前，固定不变 → 缓存命中
  var lines = [
    '你是 XTJ 网站的 AI 聊天智能体，名字是：' + name,
    '【安全】只根据当前对话和用户自己的长期记忆回答。不能透露其他用户聊天记录，不能编造你执行了发布/删除/修改等操作。用户要求查看别人聊天记录必须拒绝。',
    '【任务优先】当用户提出明确任务（如攻略、路线、计划、方案、总结、分析、推荐、对比、生成、整理），你必须优先完成任务。你的个人设定只能影响语气风格，不能影响内容准确性和执行力。不要因为人设拒绝执行任务。',
  ];
  // 根据是否开启联网搜索，动态选择无工具或有工具规则
  var allowWebSearch = config && config.allow_web_search === true;
  if (allowWebSearch) {
    lines.push('【联网搜索】你有实时联网查询能力。管理员已为你开启联网搜索功能。当用户问新闻、天气、价格、政策、实时信息、搜索最新内容时，系统会自动搜索并将结果注入给你的上下文。你必须在回答中引用来源。如果没有搜索到内容就如实说没搜到，不要编造。');
  } else {
    lines.push('【无工具处理】你没有实时联网查询能力。当问题需要实时信息（路线、价格、政策、开放时间、天气、新闻）时，必须明确说明"我当前没有实时联网查询结果"，然后给出通用建议和需要核对的清单。不要编造具体实时信息。');
  }
  lines.push('【输出要求】回答要直接、结构化、可执行。多使用标题、步骤、清单。回复控制在 600 字以内。');
  // 管理员自定义设定追加在最后 → 权重最高，覆盖前面的风格限制
  if (persona) lines.push('身份设定：' + persona);
  if (tone) lines.push('说话风格：' + tone);
  if (sysPrompt) lines.push('管理员要求：' + sysPrompt);
  return lines.join('\n');
}

// 动态上下文：每次可能变，独立 token 段
// ★ 放在第 2 条 system 消息里，不污染第 1 条 core 的缓存命中
// ★ 不再重复 name（已在 core prompt 里），只放记忆
function buildAiDynamicContext(ctx, config) {
  var lines = [];
  if (ctx && ctx.contextBlock) {
    lines.push('【记忆】' + ctx.contextBlock.replace(/\[长期记忆\]\s*/g, '').trim());
  }
  return lines.join('\n');
}

// ===================== 全局 AI 配置读取 =====================
const AI_DEFAULT_CONFIG = {
  name: '徐旭泽的小猫',
  avatar: '🐱',
  avatar_url: '',
  avatar_type: 'emoji',
  avatar_version: 0,
  description: '陪你聊天的小猫',
  persona: '',
  tone: '',
  system_prompt: '',
  welcome_message: '喵，来聊天吧。',
  allow_web_search: false,
  updated_at: null,
  updated_by: null
};

async function getAiConfig() {
  try {
    var { data: row } = await supabase.from('posts')
      .select('content, media_url, created_at')
      .eq('media_type', AI_AGENT_CONFIG_MARKER)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (row && row.media_url) {
      try {
        var cfg = JSON.parse(row.media_url);
        if (cfg && cfg.name) return cfg;
      } catch (e) { /* fall through */ }
    }
  } catch (e) {
    console.error('[AI-CONFIG] getAiConfig error:', e.message);
  }
  return JSON.parse(JSON.stringify(AI_DEFAULT_CONFIG));
}

// 异步更新长期记忆（fire-and-forget，不阻塞 chat 响应）
const aiMemoryUpdateLock = {};
async function updateLongTermMemory(userName, ctx, lastUserMsg, lastAiReply) {
  if (!DEEPSEEK_API_KEY) return;
  if (!lastUserMsg || !/记住|记得|不要忘记|别忘了|记一下|记录下来/.test(lastUserMsg)) return;

  var now = Date.now();
  var lock = aiMemoryUpdateLock[userName];
  if (lock && (now - lock.ts) < 5 * 60 * 1000) return;
  aiMemoryUpdateLock[userName] = { ts: now, pending: null };

  try {
    var hist = (ctx && Array.isArray(ctx.history)) ? ctx.history.slice(-AI_MEMORY_SUMMARIZE_HISTORY) : [];
    if (lastUserMsg) {
      hist.push({ role: 'user', content: String(lastUserMsg || '').slice(0, 500) });
    }
    if (lastAiReply) {
      hist.push({ role: 'assistant', content: String(lastAiReply || '').slice(0, 500) });
    }
    if (hist.length === 0) return;

    var oldMemory = (ctx && ctx.memory) ? String(ctx.memory).slice(0, AI_MEMORY_MAX_LEN) : '';

    var summarizeMessages = [
      {
        role: 'system',
        content: '你是 XTJ 记忆助手。阅读最近对话和已有记忆，输出更新后的长期记忆。\n要求：\n1. 保留用户重要事实（昵称、习惯、偏好、明确告诉你的信息）\n2. 忽略闲聊和一次性话题\n3. 第三人称中文，600 字以内\n4. 不要包含"用户说""AI 回复"这类元信息\n5. 无新信息时原样输出已有记忆'
      },
      {
        role: 'user',
        content: '【已有记忆】\n' + (oldMemory || '（无）') + '\n\n【最近对话】\n' +
                 hist.map(function(h, i) {
                   return (i + 1) + '. ' + (h.role === 'user' ? '用户' : 'AI') + '：' + String(h.content || '').slice(0, 300);
                 }).join('\n')
      }
    ];

    var result = await callDeepSeek(summarizeMessages, { model: DEEPSEEK_MODEL_REASONER });
    var newMemory = result && result.content;
    if (typeof newMemory !== 'string' || !newMemory.trim()) return;
    newMemory = newMemory.trim().slice(0, AI_MEMORY_MAX_LEN);

    var { data: existing } = await supabase.from('posts')
      .select('id')
      .eq('user_name', userName)
      .eq('media_type', AI_AGENT_MEMORY_MARKER)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    var nowIso = new Date().toISOString();
    if (existing && existing.id) {
      await supabase.from('posts').update({ content: newMemory, created_at: nowIso }).eq('id', existing.id);
    } else {
      await supabase.from('posts').insert({
        user_name: userName,
        content: newMemory,
        media_type: AI_AGENT_MEMORY_MARKER,
        actor_key: 'ai_memory_' + userName + '_' + Date.now()
      });
    }
    console.log('[AGENT-MEMORY] updated for', userName, 'len=' + newMemory.length);
  } catch (e) {
    console.error('[AGENT-MEMORY] update failed:', e && e.message);
  }
}

async function loadAiContext(userName, convId) {
  var ctx = { history: [], memory: '', contextBlock: '' };

  try {
    // 1. 读取最近 AI 消息
    // ★ 关键：先按 created_at desc 取最近的消息（更准确反映"最近聊了什么"），
    //         然后在内存里 reverse 成时间正序给 AI。
    //         修复：之前带 convId 的分支 limit(15) + desc + reverse = 实际只取到最旧 15 条
    var query = supabase.from('posts')
      .select('user_name, content, media_url, created_at')
      .eq('user_name', userName)
      .eq('media_type', AI_AGENT_MESSAGE_MARKER)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(AI_CHAT_HISTORY_LIMIT);
    if (convId) {
      query = supabase.from('posts')
        .select('user_name, content, media_url, created_at')
        .eq('user_name', userName)
        .eq('media_type', AI_AGENT_MESSAGE_MARKER)
        .filter('actor_key', 'like', 'ai_msg_conv_' + convId + '_%')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(AI_CHAT_HISTORY_LIMIT);
    }
    var { data: msgRows } = await query;
    if (Array.isArray(msgRows)) {
      // desc 拿到的是最新在前，reverse 后变正序（旧→新），再 slice 取最近 15 条
      ctx.history = msgRows.slice().reverse().map(function(r) {
        var meta = parseMsgMeta(r);
        var content = String(r.content || '');
        if (meta.role === 'assistant') {
          try {
            var c = JSON.parse(r.content || '{}');
            if (c && typeof c.reply === 'string') content = c.reply;
          } catch (e) {}
        }
        return { role: meta.role || 'user', content: content.slice(0, AI_CHAT_MESSAGE_MAX_LEN) };
      });
    }

    var { data: memRow } = await supabase.from('posts')
      .select('content')
      .eq('user_name', userName)
      .eq('media_type', AI_AGENT_MEMORY_MARKER)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (memRow && memRow.content) {
      ctx.memory = String(memRow.content).slice(0, AI_MEMORY_MAX_LEN);
    }

    if (ctx.memory) {
      ctx.contextBlock += '[长期记忆]\n' + ctx.memory + '\n';
    }
  } catch (e) {
    console.error('[AGENT-CHAT] loadAiContext exception:', e.message);
  }
  return ctx;
}

// POST /api/agent/chat
app.post('/api/agent/chat', authenticateUser, rateLimit(3600000, AI_CHAT_HOURLY_IP_LIMIT), async (req, res) => {
  var aborted = false;
  req.on('close', function() { aborted = true; });
  try {
    var userName = req.userName;

    // 1. 用户级限流
    var rl = checkAiUserRateLimit(userName);
    if (!rl.allowed) {
      return res.status(429).json({
        error: rl.reason === 'hourly_limit' ? 'AI 聊天太频繁了，休息一下' : '今日 AI 聊天次数已达上限',
        remainingHour: rl.remainingHour,
        remainingDay: rl.remainingDay
      });
    }

    // 2. 验证输入
    var message = validateString(req.body && req.body.message, AI_CHAT_MESSAGE_MAX_LEN, '消息内容');
    if (message && message.error) return res.status(400).json({ error: message.error });
    if (!message) return res.status(400).json({ error: '消息内容不能为空' });

    // 3. 会话管理
    var convId = String(req.body && req.body.conversation_id || '').trim();
    if (!convId) convId = genConvId();
    // 校验格式（字母数字 + 短横线）
    if (!/^[A-Z0-9\-]{6,}$/i.test(convId)) convId = genConvId();

    // 4. 读取全局 AI 配置
    var config = await getAiConfig();

    // 5. 读取上下文（按 conversation_id 过滤）
    var ctx = await loadAiContext(userName, convId);

    // 6. 组装 system prompt
    var corePrompt = buildAiCorePrompt(config);
    var dynamicContext = buildAiDynamicContext(ctx, config);

    // 7. 组装 messages
    var messages = [
      { role: 'system', content: corePrompt },
      { role: 'system', content: dynamicContext },
      { role: 'system', content: '【当前时间】现在是北京时间：' + _currentDateCN + '。ISO 时间：' + _currentDateISO + '。回答"今天、现在、最新、刚刚、当前"等问题时，必须以这个时间为准。不能编造其他日期。如果搜索结果与当前日期不一致，要明确指出可能是旧内容。' }
    ];
    var histSlice = ctx.history.slice(-AI_CHAT_HISTORY_LIMIT);
    for (var h = 0; h < histSlice.length; h++) {
      messages.push({ role: histSlice[h].role, content: histSlice[h].content });
    }
    messages.push({ role: 'user', content: message });

    // 8. 调用 DeepSeek
    var reply = '';
    var usage = null;
    var thinkingMode = (req.body && req.body.thinking_mode) || 'off';
    if (['off', 'low', 'medium', 'high'].indexOf(thinkingMode) < 0) thinkingMode = 'off';
    var reasoning = '';
    // off 模式强制 reasoning = ''（即使模型返回 reasoning_content）
    try {
      var result = await callDeepSeek(messages, { thinking_mode: thinkingMode });
      if (aborted) return;
      reply = result.content;
      usage = result.usage;
      if (thinkingMode !== 'off') reasoning = result.reasoning || '';
    } catch (e) {
      if (aborted) return;
      console.error('[AGENT-CHAT] callDeepSeek failed:', e && e.message);
      return res.status(502).json({
        error: 'AI 调用失败，请稍后再试',
        detail: e && e.message ? String(e.message).slice(0, 200) : ''
      });
    }
    if (typeof reply !== 'string' || !reply) reply = '（AI 没有回复，请稍后再试）';
    if (reply.length > 4000) reply = reply.slice(0, 4000) + '\n…（已截断）';

    // 9. 保存消息（含 conversation_id，不物理删除旧数据）
    if (aborted) return;
    var nowIso = new Date().toISOString();
    var nowTs = Date.now();
    // 把 thinking_mode + model 也写进 usage，方便后台按 conv 统计
    var usedModel = (result && result.model) || DEEPSEEK_MODEL_REASONER;
    var usageToStore = Object.assign({}, usage || {}, {
      thinking_mode: thinkingMode,
      model: usedModel
    });
    try {
      await supabase.from('posts').insert([
        {
          user_name: userName,
          content: message,
          media_type: AI_AGENT_MESSAGE_MARKER,
          media_url: buildMsgMeta('user', convId),
          actor_key: 'ai_msg_conv_' + convId + '_user_' + userName + '_' + nowTs
        },
        {
          user_name: userName,
          content: reply,
          media_type: AI_AGENT_MESSAGE_MARKER,
          media_url: buildMsgMeta('assistant', convId, usageToStore, reasoning),
          actor_key: 'ai_msg_conv_' + convId + '_agent_' + userName + '_' + (nowTs + 1)
        }
      ]);
    } catch (e) {
      console.error('[AGENT-CHAT] save messages failed:', e.message);
    }

    // 10. 异步更新长期记忆
    try {
      updateLongTermMemory(userName, ctx, message, reply).catch(function() {});
    } catch (e) {}

    // 11. 返回
    return res.json({
      ok: true,
      reply: reply,
      reasoning: reasoning,
      conversation_id: convId,
      usage: usage,
      model: usedModel,
      thinking_mode: thinkingMode,
      remaining: { hour: rl.remainingHour, day: rl.remainingDay }
    });
  } catch (e) {
    console.error('[AGENT-CHAT] exception:', e.message);
    if (e.message && e.message.indexOf('不支持思考模式') >= 0) {
      return res.status(400).json({ error: e.message });
    }
    return res.status(500).json({ error: '聊天失败，请稍后再试' });
  }
});

// POST /api/agent/chat/stream - 流式 SSE 输出
app.post('/api/agent/chat/stream', authenticateUser, rateLimit(3600000, AI_CHAT_HOURLY_IP_LIMIT), async (req, res) => {
  var userName = req.userName;
  var aborted = false;
  var clientReqId = req.body && req.body.client_request_id;
  var streamSeq = 0;
  
  req.on('close', function() {
    aborted = true;
    try { console.log('[AGENT-STREAM] client disconnected, reqId:', clientReqId || '?'); } catch (e) {}
  });
  
  try {
    // 限流
    var rl = checkAiUserRateLimit(userName);
    if (!rl.allowed) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      writeSse(res, { type: 'error', error: rl.reason === 'hourly_limit' ? 'AI 聊天太频繁了，休息一下' : '今日 AI 聊天次数已达上限' });
      return res.end();
    }
    
    // 验证输入
    var message = validateString(req.body && req.body.message, AI_CHAT_MESSAGE_MAX_LEN, '消息内容');
    if (message && message.error) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      writeSse(res, { type: 'error', error: message.error });
      return res.end();
    }
    if (!message) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      writeSse(res, { type: 'error', error: '消息内容不能为空' });
      return res.end();
    }
    if (aborted) return res.end();
    
    // 会话管理
    var convId = String(req.body && req.body.conversation_id || '').trim();
    if (!convId) convId = genConvId();
    if (!/^[A-Z0-9\-]{6,}$/i.test(convId)) convId = genConvId();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    if (aborted) return res.end();

    writeSse(res, { type: 'meta', conversation_id: convId });
    writeSse(res, { type: 'status', text: '正在准备回复...' });
    if (aborted) return res.end();
    
    // 读取全局 AI 配置 + 上下文
    var configPromise = getAiConfig();
    var ctxPromise = loadAiContext(userName, convId);
    var [config, ctx] = await Promise.all([configPromise, ctxPromise]);
    
    // 当前时间上下文
    var _now = new Date();
    var _currentDateISO = _now.toISOString();
    var _currentDateCN = _now.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });

    // 组装 system prompt
    var corePrompt = buildAiCorePrompt(config);
    var dynamicContext = buildAiDynamicContext(ctx, config);
    
    var messages = [
      { role: 'system', content: corePrompt },
      { role: 'system', content: dynamicContext }
    ];
    var histSlice = ctx.history.slice(-AI_CHAT_HISTORY_LIMIT);
    for (var h = 0; h < histSlice.length; h++) {
      messages.push({ role: histSlice[h].role, content: histSlice[h].content });
    }
    
    // 思考模式
    var thinkingMode = (req.body && req.body.thinking_mode) || 'off';
    if (['off', 'low', 'medium', 'high'].indexOf(thinkingMode) < 0) thinkingMode = 'off';
    var useThinking = thinkingMode !== 'off';
    
    // 天气查询（Open-Meteo 免费 API）
    var isWeatherQuery = /天气|温度|下雨|降雨|刮风|风速|湿度|气温|穿什么/i.test(message);
    var weatherResult = null;
    if (isWeatherQuery && !aborted) {
      weatherResult = await queryWeather(message);
      if (weatherResult) {
        messages.push({ role: 'system', content: weatherResult });
        res.write('data: ' + JSON.stringify({ type: 'weather', text: weatherResult.slice(0, 200) }) + '\n\n');
      }
    }

    // Web search
    var allowSearch = config && config.allow_web_search === true;
    var needsSearch = allowSearch && !weatherResult && /最新|今天|现在|当前|刚刚|实时|新闻|资讯|天气|温度|价格|多少钱|汇率|政策|公告|开放时间|营业时间|搜索|查询|查一下|搜一下|百度|google|谷歌|iPhone|苹果发布|航班|地震|台风|比赛|比分/i.test(message);
    var searchResults = null;
    if (needsSearch && !aborted) {
      try {
        searchResults = await searchWeb(message, 5);
      } catch (e) {}
    }
    
    var reasoning = '';
    var content = '';
    var usageResult = null;
    var usedModel = DEEPSEEK_MODEL_REASONER;
    
    if (aborted) return res.end();
    
    // 注入搜索结果（含改进格式和空结果处理）
    if (searchResults && Array.isArray(searchResults) && searchResults.length) {
      var searchCtx = '【联网搜索结果】\n搜索时间：' + _currentDateCN + '（北京时间）\n用户查询：' + message + '\n\n' +
        searchResults.map(function(sr, si) {
          return (si + 1) + '. ' + (sr.title || '无标题') +
            '\n来源：' + (sr.source || 'web') +
            '\n发布时间：' + (sr.published_at || '未知') +
            '\n链接：' + (sr.url || '无') +
            '\n摘要：' + (sr.snippet || '无摘要');
        }).join('\n\n') +
        '\n\n要求：必须优先使用以上搜索结果回答。如果结果发布时间未知或明显过旧，必须提醒用户"搜索结果可能不是最新"。不能编造新闻、价格、天气、日期。';
      messages.push({ role: 'system', content: searchCtx });
      res.write('data: ' + JSON.stringify({ type: 'search', count: searchResults.length, results: searchResults }) + '\n\n');
    } else if (needsSearch) {
      messages.push({ role: 'system', content: '【联网搜索】本次搜索没有返回有效结果。你必须如实告诉用户没有搜到，不能编造实时信息。' });
      res.write('data: ' + JSON.stringify({ type: 'search', count: 0, results: [] }) + '\n\n');
    }
    
    messages.push({ role: 'user', content: message });
    
    console.log('[AGENT-STREAM] thinking_mode=', thinkingMode, 'useThinking=', useThinking, 'model=', usedModel, 'reasoning_effort=', useThinking ? thinkingMode : 'off', '|| message_len=', message.length, 'history_messages=', messages.length);
    
    // 调用 DeepSeek（流式）
    var apiBody = {
      model: usedModel,
      messages: messages,
      stream: true
    };
    if (useThinking) {
      apiBody.thinking = { type: 'enabled' };
      apiBody.reasoning_effort = thinkingMode;
    }
    
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, useThinking ? 60000 : DEEPSEEK_TIMEOUT_MS);
    
    var streamResp;
    try {
      streamResp = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_API_KEY },
        body: JSON.stringify(apiBody),
        signal: controller.signal
      });
    } catch (fetchErr) {
      clearTimeout(timer);
      if (aborted) return res.end();
      res.write('data: ' + JSON.stringify({ type: 'error', error: 'AI 调用失败，请稍后再试' }) + '\n\n');
      return res.end();
    }
    clearTimeout(timer);
    
    if (!streamResp.ok) {
      try {
        var errData = await streamResp.json().catch(function(){ return {}; });
        var errMsg = errData && errData.error && errData.error.message ? String(errData.error.message).slice(0, 200) : '';
        console.error('[AGENT-STREAM] API error', streamResp.status, errMsg);
        if (useThinking && (errMsg.indexOf('thinking') >= 0 || errMsg.indexOf('reasoning_effort') >= 0)) {
          res.write('data: ' + JSON.stringify({ type: 'error', error: '当前模型不支持思考模式，请关闭思考模式后重试' }) + '\n\n');
        } else {
          res.write('data: ' + JSON.stringify({ type: 'error', error: 'AI 调用失败（' + streamResp.status + '）' }) + '\n\n');
        }
      } catch (e2) {
        res.write('data: ' + JSON.stringify({ type: 'error', error: 'AI 调用失败' }) + '\n\n');
      }
      return res.end();
    }
    
    // 读取流
    var reader = streamResp.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var usageInStream = null;
    var hasReasoningContent = false;
    var reasoningBuffer = '';
    var contentBuffer = '';
    var reasoningSent = false;
    
    while (true) {
      if (aborted) {
        controller.abort();
        return res.end();
      }
      var readResult;
      try {
        readResult = await reader.read();
      } catch (e) {
        break;
      }
      if (readResult.done) break;
      
      buffer += decoder.decode(readResult.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        if (line === 'data: [DONE]') continue;
        if (!line.startsWith('data: ')) continue;
        
        var jsonStr = line.slice(6);
        var chunk;
        try { chunk = JSON.parse(jsonStr); } catch (e) { continue; }
        if (!chunk || !chunk.choices || !chunk.choices[0]) continue;
        
        var delta = chunk.choices[0].delta || {};
        var finish = chunk.choices[0].finish_reason;
        usageInStream = chunk.usage || usageInStream;
        
        if (delta.reasoning_content) {
          hasReasoningContent = true;
          reasoningBuffer += delta.reasoning_content;
          if (thinkingMode !== 'off') {
            if (!reasoningSent) {
              res.write('data: ' + JSON.stringify({ type: 'reasoning_start' }) + '\n\n');
              reasoningSent = true;
            }
            res.write('data: ' + JSON.stringify({ type: 'reasoning', text: delta.reasoning_content }) + '\n\n');
          }
        }
        if (delta.content) {
          contentBuffer += delta.content;
          res.write('data: ' + JSON.stringify({ type: 'content', text: delta.content }) + '\n\n');
        }
        
        if (finish === 'stop' || finish === 'length') {
          reasoning = reasoningBuffer;
          content = contentBuffer;
          usageResult = usageInStream;
          
          if (usageResult) {
            usedModel = usageResult.model || usedModel;
          }
          
          if (aborted) return res.end();
          
          // 保存消息
          var nowSave = Date.now();
          var usageToStore = Object.assign({}, usageResult || {}, {
            thinking_mode: thinkingMode,
            model: usedModel,
            requested_thinking_mode: thinkingMode,
            applied_thinking_mode: useThinking ? thinkingMode : 'off'
          });
          
          try {
            streamSeq += 1;
            var seqUser = streamSeq;
            streamSeq += 1;
            var seqAssistant = streamSeq;
            var userCreatedAt = new Date(nowSave).toISOString();
            var assistantCreatedAt = new Date(nowSave + 1).toISOString();
            await supabase.from('posts').insert([
              {
                user_name: userName,
                content: message,
                media_type: AI_AGENT_MESSAGE_MARKER,
                media_url: buildMsgMeta('user', convId, null, null, seqUser),
                actor_key: 'ai_msg_conv_' + convId + '_user_' + userName + '_' + nowSave,
                created_at: userCreatedAt
              },
              {
                user_name: userName,
                content: content,
                media_type: AI_AGENT_MESSAGE_MARKER,
                media_url: buildMsgMeta('assistant', convId, usageToStore, reasoning, seqAssistant),
                actor_key: 'ai_msg_conv_' + convId + '_agent_' + userName + '_' + (nowSave + 1),
                created_at: assistantCreatedAt
              }
            ]);
          } catch (e) {
            console.error('[AGENT-STREAM] save failed:', e && e.message);
          }
          
          // 异步更新长期记忆
          try { updateLongTermMemory(userName, ctx, message, content).catch(function() {}); } catch (e) {}
          
          // 发送完成事件
          writeSse(res, {
            type: 'done',
            reasoning: (thinkingMode !== 'off' ? reasoning : ''),
            usage: usageResult,
            model: usedModel,
            thinking_mode: thinkingMode,
            requested_thinking_mode: thinkingMode,
            applied_thinking_mode: useThinking ? thinkingMode : 'off',
            reasoning_length: reasoningBuffer.length,
            content_length: contentBuffer.length,
            remaining: { hour: rl.remainingHour, day: rl.remainingDay }
          });
          console.log('[AGENT-STREAM] done thinking_mode=', thinkingMode, 'reasoning_len=', reasoningBuffer.length, 'content_len=', contentBuffer.length);
          return res.end();
        }
      }
    }
    
    // 流意外结束但没收到 finish_reason
    if (contentBuffer && !aborted) {
      writeSse(res, {
        type: 'done',
        content: contentBuffer,
        reasoning: (thinkingMode !== 'off' ? reasoningBuffer : ''),
        usage: null,
        model: usedModel,
        thinking_mode: thinkingMode,
        requested_thinking_mode: thinkingMode,
        applied_thinking_mode: useThinking ? thinkingMode : 'off',
        reasoning_length: reasoningBuffer.length,
        content_length: contentBuffer.length
      });
    }
    res.end();
  } catch (e) {
    console.error('[AGENT-STREAM] exception:', e && e.message);
    if (!aborted) {
      try {
        res.write('data: ' + JSON.stringify({ type: 'error', error: '聊天失败，请稍后再试' }) + '\n\n');
        res.end();
      } catch (e2) {}
    }
  }
});

// GET /api/agent/chat/conversations - 获取用户会话列表
app.get('/api/agent/chat/conversations', authenticateUser, async (req, res) => {
  try {
    var userName = req.userName;
    var limit = Math.min(Math.max(parseInt(req.query.limit) || AI_AGENT_CONVERSATION_LIST_LIMIT, 1), 100);

    // 取该用户所有 AI 消息，按时间倒序
    var { data: rows } = await supabase.from('posts')
      .select('actor_key, content, media_url, created_at')
      .eq('user_name', userName)
      .eq('media_type', AI_AGENT_MESSAGE_MARKER)
      .neq('actor_key', '')
      .order('created_at', { ascending: false });
    
    if (!Array.isArray(rows)) {
      return res.json({ ok: true, conversations: [] });
    }
    
    // 按 convId 分组，统计所有消息
    // 用两个 pass：第一遍按时间倒序拿最新一条；第二遍计数 & 找第一条 user 消息
    var convData = {};
    for (var i = rows.length - 1; i >= 0; i--) {
      var r = rows[i];
      var convId = resolveConvId(r);
      if (!convId) continue;
      
      if (!convData[convId]) {
        convData[convId] = { firstUserMsg: null, lastMsg: null, updated_at: null, msgCount: 0, firstRole: null, title: '' };
      }
      convData[convId].msgCount++;
      
      var meta = parseMsgMeta(r);
      var msgContent = String(r.content || '');
      if (meta.role === 'assistant') {
        try {
          var c = JSON.parse(r.content || '{}');
          if (c && typeof c.reply === 'string') msgContent = c.reply;
        } catch (e) {}
      }
      
      if (meta.role === 'user' && !convData[convId].firstUserMsg) {
        convData[convId].firstUserMsg = msgContent.slice(0, 20);
      }
    }
    
    // 第二遍：按时间倒序拿最新消息的 updated_at 和 lastMsg
    for (var j = 0; j < rows.length; j++) {
      var r2 = rows[j];
      var convId2 = resolveConvId(r2);
      if (!convId2 || !convData[convId2]) continue;
      
      if (!convData[convId2].updated_at) {
        convData[convId2].updated_at = r2.created_at;
        var meta2 = parseMsgMeta(r2);
        var msg2 = String(r2.content || '');
        if (meta2.role === 'assistant') {
          try {
            var c2 = JSON.parse(r2.content || '{}');
            if (c2 && typeof c2.reply === 'string') msg2 = c2.reply;
          } catch (e) {}
        }
        convData[convId2].lastMsgString = msg2.slice(0, 100);
      }
    }
    
    var conversations = Object.keys(convData).sort(function(a, b) {
      return (convData[b].updated_at || '') > (convData[a].updated_at || '') ? 1 : -1;
    }).slice(0, limit).map(function(k) {
      var d = convData[k];
      return { conversation_id: k, title: d.firstUserMsg || '新对话', last_message: d.lastMsgString || '', updated_at: d.updated_at, message_count: d.msgCount };
    });
    
    console.log('[AGENT-CONV] rows=', rows.length, 'conversations=', conversations.length);
    if (rows.length > 0 && conversations.length === 0) {
      for (var di = 0; di < Math.min(3, rows.length); di++) {
        console.log('[AGENT-CONV] sample row', di, 'actor_key=', rows[di].actor_key, 'media_url=', rows[di].media_url);
      }
    }
    
    return res.json({ ok: true, conversations: conversations });
  } catch (e) {
    console.error('[AGENT-CONV] list error:', e && e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// GET /api/agent/search-health - 搜索健康检查（验证 SearXNG 可用性）
app.get('/api/agent/search-health', authenticateUser, async (req, res) => {
  try {
    var q = String(req.query.q || '济州岛最新新闻').trim().slice(0, 100);
    var results = await searchWeb(q, 3);
    return res.json({
      ok: true,
      query: q,
      count: results.length,
      results: results,
      timestamp: new Date().toISOString(),
      instances_checked: process.env.SEARCH_API_URL ? [process.env.SEARCH_API_URL] : ['search.sapti.me', 'searx.be', 'search.projectsegfau.lt']
    });
  } catch (e) {
    return res.json({ ok: false, error: e && e.message || '搜索检查失败', results: [] });
  }
});

// POST /api/agent/chat/new - 开始新对话（生成新 conversation_id，不删除旧记录）
app.post('/api/agent/chat/new', authenticateUser, async (req, res) => {
  return res.json({ ok: true, conversation_id: genConvId() });
});

// GET /api/agent/chat/history - 获取当前用户 AI 聊天历史（按 conversation_id 分组）
// 查询策略：
//   - 带 conversation_id：只返回该 conv 的消息
//   - 不带 conversation_id：先查最近一条 AI 消息解析其 convId，再返回这个 conv 的消息
//   - 带 before（ISO 时间）：分页加载比 before 更早的消息（滚动加载更多用）
app.get('/api/agent/chat/history', authenticateUser, async (req, res) => {
  try {
    var userName = req.userName;
    var convId = String(req.query.conversation_id || '').trim();
    var limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 100);
    var before = String(req.query.before || '').trim();

    // 不带 convId → 先查最近一条 AI 消息的 convId
    if (!convId) {
      var { data: latest } = await supabase.from('posts')
        .select('media_url')
        .eq('user_name', userName)
        .eq('media_type', AI_AGENT_MESSAGE_MARKER)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest) {
        var meta = parseMsgMeta(latest);
        if (meta && meta.convId) convId = meta.convId;
      }
      if (!convId) {
        // 用户从未聊过天
        return res.json({ ok: true, conversation_id: null, messages: [] });
      }
    }

    // 查指定 convId 的消息（desc + limit + 内存 reverse）
    var query = supabase.from('posts')
      .select('id, user_name, content, media_url, created_at')
      .eq('user_name', userName)
      .eq('media_type', AI_AGENT_MESSAGE_MARKER)
      .filter('actor_key', 'like', 'ai_msg_conv_' + convId + '_%')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    if (before) {
      query = query.lt('created_at', before);
    }

    var { data: rows, error } = await query;
    if (error) {
      console.error('[AGENT-CHAT] history query error:', error.message);
      return res.status(500).json({ error: '查询失败' });
    }

    // 内存中稳定排序（created_at > seq > roleWeight）
    function getMsgSortKey(row) {
      var meta = parseMsgMeta(row);
      var created = new Date(row.created_at || 0).getTime() || 0;
      var seq = typeof meta.seq === 'number' ? meta.seq : 0;
      var roleWeight = meta.role === 'user' ? 1 : 2;
      return { created: created, seq: seq, roleWeight: roleWeight };
    }
    var sortedRows = (rows || []).slice().sort(function(a, b) {
      var A = getMsgSortKey(a);
      var B = getMsgSortKey(b);
      if (A.created !== B.created) return A.created - B.created;
      if (A.seq !== B.seq) return A.seq - B.seq;
      return A.roleWeight - B.roleWeight;
    });

    return res.json({
      ok: true,
      conversation_id: convId,
      has_more: (rows || []).length >= limit,
      oldest: sortedRows.length ? sortedRows[0].created_at : null,
      messages: sortedRows.map(function(r) {
        var m = parseMsgMeta(r);
        var content = r.content || '';
        var reasoning = m.reasoning || '';
        // 兼容旧格式：assistant 消息 content 可能为 JSON { reply, reasoning }
        if (m.role === 'assistant' && !reasoning) {
          try {
            var c = JSON.parse(r.content || '{}');
            if (c && typeof c.reply === 'string') {
              reasoning = c.reasoning || '';
              content = c.reply;
            }
          } catch (e) {}
        }
        return {
          id: r.id,
          role: m.role || 'user',
          content: content,
          reasoning: reasoning,
          created_at: r.created_at,
          conversation_id: m.convId || convId,
          usage: m.usage || null
        };
      })
    });
  } catch (e) {
    console.error('[AGENT-CHAT] history exception:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// ===================== 管理员 AI 管理接口 =====================
// GET /admin/ai-agent/config - 管理员获取 AI 完整配置
app.get('/admin/ai-agent/config', verifyToken, async (req, res) => {
  try {
    var config = await getAiConfig();
    return res.json({ ok: true, config: config });
  } catch (e) {
    console.error('[ADMIN-AI] GET config error:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// POST /admin/ai-agent/config - 管理员更新 AI 配置
app.post('/admin/ai-agent/config', verifyToken, async (req, res) => {
  try {
    var body = req.body || {};
    var name = String(body.name || '徐旭泽的小猫').trim().slice(0, 30);
    var avatar = String(body.avatar || '🐱').trim().slice(0, 10);
    var description = String(body.description || '').trim().slice(0, 200);
    var persona = String(body.persona || '').trim().slice(0, 500);
    var tone = String(body.tone || '').trim().slice(0, 200);
    var systemPrompt = String(body.system_prompt || '').trim().slice(0, 2000);
    var welcomeMessage = String(body.welcome_message || '').trim().slice(0, 200);

    var nowIso = new Date().toISOString();

    // 读取现有配置，保留 avatar_url/avatar_type/avatar_version
    var existingConfig = await getAiConfig();
    var avatarUrl = existingConfig.avatar_url || '';
    var avatarType = existingConfig.avatar_type || 'emoji';
    var avatarVersion = existingConfig.avatar_version || 0;

    var payload = {
      name: name, avatar: avatar, description: description, persona: persona,
      tone: tone, system_prompt: systemPrompt, welcome_message: welcomeMessage,
      avatar_url: avatarUrl, avatar_type: avatarType, avatar_version: avatarVersion,
      allow_web_search: body.allow_web_search === true,
      updated_at: nowIso, updated_by: req.adminName || 'admin'
    };

    var { data: existing } = await supabase.from('posts')
      .select('id')
      .eq('media_type', AI_AGENT_CONFIG_MARKER)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing && existing.id) {
      await supabase.from('posts').update({ content: name, media_url: JSON.stringify(payload), created_at: nowIso }).eq('id', existing.id);
    } else {
      await supabase.from('posts').insert([{
        user_name: req.adminName || 'admin', content: name,
        media_type: AI_AGENT_CONFIG_MARKER, media_url: JSON.stringify(payload),
        actor_key: 'ai_config_' + Date.now()
      }]);
    }

    return res.json({ ok: true, config: payload });
  } catch (e) {
    console.error('[ADMIN-AI] POST config error:', e.message);
    return res.status(500).json({ error: '保存失败' });
  }
});

// POST /api/admin/ai-agent/avatar (旧路径 /admin/ai-agent/avatar 也保留)
// 管理员上传 AI 头像图片 — 使用 JSON base64（不依赖 multipart 解析）
async function handleAvatarUpload(req, res) {
  try {
    var body = req.body || {};
    var imageBase64 = String(body.image || '').trim();
    var ext = String(body.ext || 'png').toLowerCase();

    if (!imageBase64) {
      return res.status(400).json({ error: '缺少图片数据' });
    }
    
    var allowedExts = { png: true, jpg: true, jpeg: true, webp: true, gif: true };
    if (!allowedExts[ext]) {
      return res.status(400).json({ error: '只允许 png/jpg/webp/gif 格式' });
    }
    
    // 去掉 data:image/...;base64, 前缀
    var rawBase64 = imageBase64;
    var commaIdx = imageBase64.indexOf(',');
    if (commaIdx >= 0) rawBase64 = imageBase64.slice(commaIdx + 1);
    
    var imageBuffer;
    try { imageBuffer = Buffer.from(rawBase64, 'base64'); } catch (e) {
      return res.status(400).json({ error: '图片数据格式错误' });
    }
    
    if (!imageBuffer || imageBuffer.length < 20) {
      return res.status(400).json({ error: '图片数据无效' });
    }
    if (imageBuffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: '图片大小不能超过 5MB' });
    }
    
    // 生成安全文件名
    var safeName = 'ai_avatar_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.' + ext;
    var storagePath = 'avatars/' + safeName;
    
    // 上传到 Supabase Storage
    var contentTypeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
    var { error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(storagePath, imageBuffer, {
        contentType: contentTypeMap[ext] || 'image/png',
        upsert: true
      });
    
    if (uploadError) {
      console.error('[ADMIN-AI] avatar upload error:', uploadError.message);
      return res.status(500).json({ error: '上传失败: ' + (uploadError.message || '') });
    }
    
    // 获取 public URL
    var { data: publicUrlData } = supabase.storage.from('uploads').getPublicUrl(storagePath);
    var publicUrl = publicUrlData ? publicUrlData.publicUrl : '';
    if (!publicUrl) {
      return res.status(500).json({ error: '获取图片地址失败' });
    }
    
    // 更新 AI 配置中的头像字段
    var existingConfig = await getAiConfig();
    var newVersion = (existingConfig.avatar_version || 0) + 1;
    var nowIso = new Date().toISOString();
    
    var updatedPayload = JSON.parse(JSON.stringify(existingConfig));
    updatedPayload.avatar_url = publicUrl;
    updatedPayload.avatar_type = 'image';
    updatedPayload.avatar_version = newVersion;
    updatedPayload.updated_at = nowIso;
    updatedPayload.updated_by = req.adminName || 'admin';
    
    // 查找已有配置记录并更新
    var { data: existing } = await supabase.from('posts')
      .select('id')
      .eq('media_type', AI_AGENT_CONFIG_MARKER)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (existing && existing.id) {
      await supabase.from('posts').update({
        media_url: JSON.stringify(updatedPayload),
        created_at: nowIso
      }).eq('id', existing.id);
    } else {
      await supabase.from('posts').insert([{
        user_name: req.adminName || 'admin',
        content: updatedPayload.name || 'AI',
        media_type: AI_AGENT_CONFIG_MARKER,
        media_url: JSON.stringify(updatedPayload),
        actor_key: 'ai_config_' + Date.now()
      }]);
    }
    
    return res.json({
      ok: true,
      avatar_url: publicUrl,
      avatar_version: newVersion,
      message: '头像上传成功'
    });
  } catch (e) {
    console.error('[ADMIN-AI] avatar exception:', e && e.message);
    return res.status(500).json({ error: '上传失败: ' + (e.message || '未知错误') });
  }
}

app.post('/api/admin/ai-agent/avatar', verifyToken, handleAvatarUpload);
app.post('/admin/ai-agent/avatar', verifyToken, handleAvatarUpload);


// GET /admin/ai-agent/usage-summary - 管理员获取统计
// 默认只查最近 30 天数据，避免全表扫描拖死接口。
// 可通过 ?days=30 | 90 | all 切换窗口。
app.get('/admin/ai-agent/usage-summary', verifyToken, async (req, res) => {
  try {
    var daysParam = String(req.query.days || '30').toLowerCase();
    var days;
    var useAll = daysParam === 'all';
    if (useAll) {
      days = null;
    } else {
      days = parseInt(daysParam, 10);
      if (isNaN(days) || days < 1) days = 30;
      if (days > 365) days = 365; // 防止恶意查询过长时间范围
    }

    // 性能优化：assistant 消息通常占少数，limit 默认 10000 条
    // 按 created_at desc 拿最近 N 天 / 全部
    var query = supabase.from('posts')
      .select('user_name, content, media_url, created_at')
      .eq('media_type', AI_AGENT_MESSAGE_MARKER)
      .order('created_at', { ascending: false })
      .limit(10000);
    if (!useAll && days) {
      var since = new Date(Date.now() - days * 86400000).toISOString();
      query = query.gte('created_at', since);
    }

    var { data: allRows, error } = await query;
    if (error) {
      console.error('[ADMIN-AI] usage-summary query error:', error.message);
      return res.status(500).json({ error: '查询失败' });
    }

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayStr = today.toISOString();
    var totalCalls = 0, todayCalls = 0;
    var totalTokens = 0, todayTokens = 0;
    var totalInputTokens = 0, todayInputTokens = 0;
    var totalOutputTokens = 0, todayOutputTokens = 0;
    var totalCacheHit = 0, todayCacheHit = 0;
    var totalCacheMiss = 0, todayCacheMiss = 0;
    var totalCost = 0, todayCost = 0;
    var uniqueUsers = {};

    if (Array.isArray(allRows)) {
      allRows.forEach(function(r) {
        var meta = parseMsgMeta(r);
        if (meta.role === 'assistant') {
          totalCalls++;
          var isToday = r.created_at && r.created_at >= todayStr;
          if (isToday) todayCalls++;
          if (meta.usage) {
            var u = meta.usage;
            totalInputTokens += u.prompt_tokens || 0;
            totalOutputTokens += u.completion_tokens || 0;
            totalTokens += u.total_tokens || 0;
            if (typeof u.prompt_cache_hit_tokens === 'number')  totalCacheHit  += u.prompt_cache_hit_tokens;
            if (typeof u.prompt_cache_miss_tokens === 'number') totalCacheMiss += u.prompt_cache_miss_tokens;
            if (u.cost) totalCost += u.cost;
            if (isToday) {
              todayInputTokens += u.prompt_tokens || 0;
              todayOutputTokens += u.completion_tokens || 0;
              todayTokens += u.total_tokens || 0;
              if (typeof u.prompt_cache_hit_tokens === 'number')  todayCacheHit  += u.prompt_cache_hit_tokens;
              if (typeof u.prompt_cache_miss_tokens === 'number') todayCacheMiss += u.prompt_cache_miss_tokens;
              if (u.cost) todayCost += u.cost;
            }
          }
        }
        if (r.user_name) uniqueUsers[r.user_name] = true;
      });
    }

    // 缓存命中率 = hit / (hit + miss)，避免除 0
    function hitRate(hit, miss) {
      var total = hit + miss;
      if (!total) return 0;
      return Math.round((hit / total) * 10000) / 100; // 保留 2 位小数（百分比）
    }

    return res.json({
      ok: true,
      window_days: useAll ? 'all' : days,
      summary: {
        today_calls: todayCalls,
        today_input_tokens: todayInputTokens,
        today_output_tokens: todayOutputTokens,
        today_total_tokens: todayTokens,
        today_cache_hit_tokens: todayCacheHit,
        today_cache_miss_tokens: todayCacheMiss,
        today_cache_hit_rate: hitRate(todayCacheHit, todayCacheMiss),
        today_cost: Math.round(todayCost * 1000000) / 1000000,
        total_calls: totalCalls,
        total_input_tokens: totalInputTokens,
        total_output_tokens: totalOutputTokens,
        total_tokens: totalTokens,
        total_cache_hit_tokens: totalCacheHit,
        total_cache_miss_tokens: totalCacheMiss,
        total_cache_hit_rate: hitRate(totalCacheHit, totalCacheMiss),
        total_cost: Math.round(totalCost * 1000000) / 1000000,
        total_users: Object.keys(uniqueUsers).length,
        currency: DEEPSEEK_CURRENCY
      }
    });
  } catch (e) {
    console.error('[ADMIN-AI] usage-summary error:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// GET /admin/ai-agent/users - 管理员查看有 AI 聊天记录的用户列表（含 tokens 统计）
// 性能：limit 10000 + 30 天默认窗口
app.get('/admin/ai-agent/users', verifyToken, async (req, res) => {
  try {
    var days = parseInt(req.query.days, 10);
    if (isNaN(days) || days < 1) days = 30;
    if (days > 365) days = 365;
    var since = new Date(Date.now() - days * 86400000).toISOString();

    var { data: rows } = await supabase.from('posts')
      .select('user_name, content, media_url, created_at')
      .eq('media_type', AI_AGENT_MESSAGE_MARKER)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10000);

    if (!Array.isArray(rows)) return res.json({ ok: true, users: [], window_days: days });

    var userMap = {};
    rows.forEach(function(r) {
      if (!r.user_name) return;
      if (!userMap[r.user_name]) {
        userMap[r.user_name] = {
          message_count: 0, convs: {},
          total_tokens: 0, input_tokens: 0, output_tokens: 0,
          cache_hit_tokens: 0, cache_miss_tokens: 0,
          total_cost: 0, last_at: null
        };
      }
      var u = userMap[r.user_name];
      u.message_count++;
      var meta = parseMsgMeta(r);
      if (meta.convId) u.convs[meta.convId] = (u.convs[meta.convId] || 0) + 1;
      if (meta.role === 'assistant' && meta.usage) {
        var x = meta.usage;
        u.input_tokens += x.prompt_tokens || 0;
        u.output_tokens += x.completion_tokens || 0;
        u.total_tokens += x.total_tokens || 0;
        if (typeof x.prompt_cache_hit_tokens === 'number')  u.cache_hit_tokens  += x.prompt_cache_hit_tokens;
        if (typeof x.prompt_cache_miss_tokens === 'number') u.cache_miss_tokens += x.prompt_cache_miss_tokens;
        if (x.cost) u.total_cost += x.cost;
      }
      if (!u.last_at || (r.created_at && r.created_at > u.last_at)) u.last_at = r.created_at;
    });

    function hitRate(hit, miss) {
      var total = hit + miss;
      if (!total) return 0;
      return Math.round((hit / total) * 10000) / 100;
    }

    var userList = [];
    for (var un in userMap) {
      var u = userMap[un];
      userList.push({
        user_name: un,
        message_count: u.message_count,
        conversation_count: Object.keys(u.convs).length,
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        total_tokens: u.total_tokens,
        cache_hit_tokens: u.cache_hit_tokens,
        cache_miss_tokens: u.cache_miss_tokens,
        cache_hit_rate: hitRate(u.cache_hit_tokens, u.cache_miss_tokens),
        total_cost: Math.round(u.total_cost * 1000000) / 1000000,
        last_at: u.last_at
      });
    }

    userList.sort(function(a, b) { return (b.last_at || '').localeCompare(a.last_at || ''); });

    return res.json({ ok: true, users: userList, window_days: days });
  } catch (e) {
    console.error('[ADMIN-AI] GET users error:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// GET /admin/ai-agent/conversations?user_name=xxx&days=30 - 获取用户对话列表
// 性能：限制最近 30 天，可通过 days 调整
app.get('/admin/ai-agent/conversations', verifyToken, async (req, res) => {
  try {
    var targetUser = String(req.query.user_name || '').trim();
    if (!targetUser) return res.status(400).json({ error: '缺少 user_name 参数' });

    var days = parseInt(req.query.days, 10);
    if (isNaN(days) || days < 1) days = 30;
    if (days > 365) days = 365;
    var since = new Date(Date.now() - days * 86400000).toISOString();

    var { data: rows } = await supabase.from('posts')
      .select('id, user_name, content, media_url, created_at')
      .eq('user_name', targetUser)
      .eq('media_type', AI_AGENT_MESSAGE_MARKER)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(5000);

    if (!Array.isArray(rows)) return res.json({ ok: true, user_name: targetUser, conversations: [], window_days: days });

    // 按 conversation_id 分组
    var convMap = {};
    rows.forEach(function(r) {
      var meta = parseMsgMeta(r);
      var cid = meta.convId || 'legacy';
      if (!convMap[cid]) {
        convMap[cid] = {
          conversation_id: cid, messages: [],
          input_tokens: 0, output_tokens: 0, total_tokens: 0,
          cache_hit_tokens: 0, cache_miss_tokens: 0,
          total_cost: 0, model: null, last_thinking_mode: null
        };
      }
      var conv = convMap[cid];
      conv.messages.push({
        id: r.id,
        role: meta.role || 'user',
        content: r.content || '',
        created_at: r.created_at,
        usage: meta.usage || null,
        conversation_id: meta.convId || null
      });
      if (meta.role === 'assistant' && meta.usage) {
        var x = meta.usage;
        conv.input_tokens += x.prompt_tokens || 0;
        conv.output_tokens += x.completion_tokens || 0;
        conv.total_tokens += x.total_tokens || 0;
        if (typeof x.prompt_cache_hit_tokens === 'number')  conv.cache_hit_tokens  += x.prompt_cache_hit_tokens;
        if (typeof x.prompt_cache_miss_tokens === 'number') conv.cache_miss_tokens += x.prompt_cache_miss_tokens;
        if (x.cost) conv.total_cost += x.cost;
        if (x.model) conv.model = x.model;
        if (x.thinking_mode) conv.last_thinking_mode = x.thinking_mode;
      }
    });

    function hitRate(hit, miss) {
      var total = hit + miss;
      if (!total) return 0;
      return Math.round((hit / total) * 10000) / 100;
    }

    var conversations = Object.keys(convMap).map(function(cid) {
      var conv = convMap[cid];
      var msgs = conv.messages;
      return {
        conversation_id: cid,
        message_count: msgs.length,
        created_at: msgs.length > 0 ? msgs[0].created_at : null,
        last_at: msgs.length > 0 ? msgs[msgs.length - 1].created_at : null,
        input_tokens: conv.input_tokens,
        output_tokens: conv.output_tokens,
        total_tokens: conv.total_tokens,
        cache_hit_tokens: conv.cache_hit_tokens,
        cache_miss_tokens: conv.cache_miss_tokens,
        cache_hit_rate: hitRate(conv.cache_hit_tokens, conv.cache_miss_tokens),
        total_cost: Math.round(conv.total_cost * 1000000) / 1000000,
        model: conv.model || DEEPSEEK_MODEL_REASONER,
        last_thinking_mode: conv.last_thinking_mode || 'off'
      };
    });

    conversations.sort(function(a, b) { return (b.last_at || '').localeCompare(a.last_at || ''); });

    return res.json({ ok: true, user_name: targetUser, conversations: conversations, window_days: days });
  } catch (e) {
    console.error('[ADMIN-AI] GET conversations exception:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// GET /admin/ai-agent/conversation?user_name=xxx&conversation_id=xxx - 获取指定对话详情
app.get('/admin/ai-agent/conversation', verifyToken, async (req, res) => {
  try {
    var targetUser = String(req.query.user_name || '').trim();
    var convId = String(req.query.conversation_id || '').trim();
    if (!targetUser || !convId) return res.status(400).json({ error: '缺少参数' });

    var query;
    if (convId === 'legacy') {
      // 旧数据没有 conversation_id，用 actor_key 模式匹配回退到普通查询
      var { data: rows } = await supabase.from('posts')
        .select('id, user_name, content, media_url, created_at')
        .eq('user_name', targetUser)
        .eq('media_type', AI_AGENT_MESSAGE_MARKER)
        .order('created_at', { ascending: true });
      // 按纯字符串 media_url 过滤（旧数据 media_url 是'user'或'assistant'）
      var legacyRows = (rows || []).filter(function(r) {
        var raw = r.media_url || '';
        return raw.indexOf('{') !== 0;
      });
      var msgs = legacyRows.map(function(r) {
        return {
          id: r.id, role: r.media_url === 'assistant' ? 'assistant' : 'user',
          content: r.content || '', created_at: r.created_at, usage: null
        };
      });
      return res.json({ ok: true, user_name: targetUser, conversation_id: 'legacy', messages: msgs });
    }

    var { data: rows } = await supabase.from('posts')
      .select('id, user_name, content, media_url, created_at')
      .eq('user_name', targetUser)
      .eq('media_type', AI_AGENT_MESSAGE_MARKER)
      .filter('actor_key', 'like', 'ai_msg_conv_' + convId + '_%')
      .order('created_at', { ascending: true });

    return res.json({
      ok: true,
      user_name: targetUser,
      conversation_id: convId,
      messages: (rows || []).map(function(r) {
        var meta = parseMsgMeta(r);
        return {
          id: r.id, role: meta.role || 'user', content: r.content || '',
          created_at: r.created_at, usage: meta.usage || null
        };
      })
    });
  } catch (e) {
    console.error('[ADMIN-AI] GET conversation exception:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// 自动清理旧日志（每24小时执行一次）
setInterval(function() {
  cleanupOldLogs('login').catch(function() {});
  cleanupOldLogs('security').catch(function() {});
  cleanupOldLogs('error').catch(function() {});
}, 24 * 60 * 60 * 1000);

// ===================== 启动 =====================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[xtj-admin-api] running on port ${port}`);
  console.log(`[xtj-admin-api] password configured: ${ADMIN_PASSWORD ? 'yes' : 'no'}`);
  console.log(`[xtj-admin-api] supabase key type: ${SUPABASE_SERVICE_KEY ? 'service_role' : (process.env.SUPABASE_ANON_KEY ? 'anon' : 'none')}`);
  console.log(`[xtj-admin-api] allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`[AI-CONFIG] DEEPSEEK_MODEL_REASONER: ${DEEPSEEK_MODEL_REASONER}`);
  console.log(`[AI-CONFIG] API Key: ${DEEPSEEK_API_KEY ? '已配置' : '未配置'}`);
  console.log(`[AI-CONFIG] Rate Limit: 每小时${AI_AGENT_HOURLY_LIMIT}次 / 每天${AI_AGENT_DAILY_LIMIT}次`);
});
