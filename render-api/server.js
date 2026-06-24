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

// ===================== Gmail SMTP 邮件配置 =====================
const GMAIL_USER = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';
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
const LOGIN_LOG_RETENTION_DAYS = 90;
const SECURITY_LOG_RETENTION_DAYS = 90;
const ERROR_LOG_RETENTION_DAYS = 30;

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
    return next();
  }

  const session = adminTokens.get(token);
  if (!session || Date.now() > session.expiresAt) {
    adminTokens.delete(token);
    return res.status(401).json({ error: '令牌已过期或无效，请重新登录' });
  }

  session.expiresAt = Date.now() + TOKEN_EXPIRY_MS;
  req.adminToken = token;
  next();
}

// ===================== 健康检查 ======================
app.get('/health', (req, res) => {
  res.json({ ok: true });
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
  var password_hash = req.body.password_hash || '';
  var userName = req.body.user_name || req.query.user_name || req.body.reporter_name || '';
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
      supabase.from('posts').select('*').neq('media_type', '__avatar__').neq('media_type', '__user_info__').neq('media_type', '__ann__').neq('media_type', ADMIN_AUTH_MARKER).neq('media_type', ADMIN_META_MARKER).neq('media_type', '__photo_wall__').neq('media_type', REPORT_MARKER).neq('media_type', DM_MARKER).neq('media_type', AUTH_MARKER).neq('media_type', VISIT_MARKER).neq('media_type', ATTACK_MARKER).neq('media_type', '__user_visit__').neq('media_type', '__vip__').neq('media_type', '__vip_order__').neq('media_type', LOGIN_EVENT_MARKER).neq('media_type', SECURITY_ALERT_MARKER).neq('media_type', CLIENT_ERROR_MARKER).neq('media_type', AUDIT_LOG_MARKER).neq('media_type', '__email_sent__').neq('media_type', '__email_recipient_history__').order('created_at', { ascending: false }).limit(5000),
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
});

// 管理员处理举报 + 封禁用户
app.post('/admin/report/:id/ban-user', verifyToken, async (req, res) => {
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
      buildSummaryQuery('posts', 'id, media_type, content, created_at', null, null, 'created_at')
        .neq('media_type', '__avatar__').neq('media_type', '__user_info__')
        .neq('media_type', '__photo_wall__').neq('media_type', '__ann__').neq('media_type', '__vip__').neq('media_type', '__vip_order__')
        .neq('media_type', REPORT_MARKER).neq('media_type', DM_MARKER)
        .neq('media_type', AUTH_MARKER).neq('media_type', ADMIN_AUTH_MARKER).neq('media_type', ADMIN_META_MARKER)
        .neq('media_type', VISIT_MARKER).neq('media_type', ATTACK_MARKER)
        .neq('media_type', '__user_visit__').neq('media_type', LOGIN_EVENT_MARKER),
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
      buildQuery('posts', 'id, created_at', null, null, 'created_at')
        .neq('media_type', '__avatar__').neq('media_type', USER_INFO_MARKER)
        .neq('media_type', REPORT_MARKER).neq('media_type', DM_MARKER)
        .neq('media_type', AUTH_MARKER).neq('media_type', VISIT_MARKER)
        .neq('media_type', ATTACK_MARKER).neq('media_type', '__photo_wall__').neq('media_type', '__ann__').neq('media_type', '__vip__').neq('media_type', '__vip_order__').neq('media_type', ADMIN_AUTH_MARKER).neq('media_type', ADMIN_META_MARKER)
        .neq('media_type', USER_VISIT_MARKER).neq('media_type', LOGIN_EVENT_MARKER).neq('media_type', SECURITY_ALERT_MARKER).neq('media_type', AUDIT_LOG_MARKER).neq('media_type', CLIENT_ERROR_MARKER),
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
const EMAIL_SENT_MARKER = '__email_sent__';

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

var SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';

// SendGrid API 发送（HTTPS 443，不受云平台 SMTP 端口封锁影响）
async function sendViaSendGrid(to, subject, text, html) {
  var resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
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
  });
  if (!resp.ok) {
    var body = await resp.text().catch(function(){ return ''; });
    throw new Error('SendGrid HTTP ' + resp.status + (body ? ': ' + body.slice(0, 200) : ''));
  }
}

// 发送邮件（优先 SendGrid HTTPS API，其次 Gmail SMTP）
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
    if (!SENDGRID_API_KEY) {
      transporter = getMailTransporter();
      if (!transporter) {
        return res.status(500).json({ error: '邮件服务未配置，请在 Render Dashboard 设置 GMAIL_USER 和 GMAIL_APP_PASSWORD' });
      }
    }

    // 先保存收件人到历史（无论发送是否成功，都先存下来）
    try {
      var histEmails = [];
      recipients.forEach(function(r) {
        var e = String(r.email || '').trim().toLowerCase();
        if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && histEmails.indexOf(e) === -1) histEmails.push(e);
      });
      for (var hi = 0; hi < histEmails.length; hi++) {
        await supabase.from('posts').insert([{
          user_name: ADMIN_USERNAME,
          content: JSON.stringify({ email: histEmails[hi], sent_at: new Date().toISOString() }),
          media_type: '__email_recipient_history__'
        }]).catch(function(err) { console.warn('[Email] 保存历史收件人失败:', err && err.message); });
      }
    } catch(e) { console.warn('[Email] 保存收件人历史失败:', e.message); }

    var usedPort = mailTransporterPort;
    const sent = [];
    const failed = [];
    for (const r of recipients) {
      try {
        if (SENDGRID_API_KEY) {
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
        if (SENDGRID_API_KEY) {
          SENDGRID_API_KEY = '';
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
        } else if (usedPort === '465' && (e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' || e.message.indexOf('timeout') > -1 || e.message.indexOf('connect') > -1)) {
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
        failed.push({ user: r.user_name || r.email, error: (SENDGRID_API_KEY ? 'SendGrid失败，SMTP也失败: ' : '发送失败: ') + e.message });
      }
    }
    try {
      await supabase.from('posts').insert([{
        user_name: ADMIN_USERNAME,
        media_type: EMAIL_SENT_MARKER,
        content: JSON.stringify({
          subject: subjectVal,
          sent_count: sent.length,
          failed_count: failed.length,
          total_recipients: recipients.length,
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
        subject: info.subject || '',
        sent_count: info.sent_count || 0,
        failed_count: info.failed_count || 0,
        total_recipients: info.total_recipients || 0,
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
const EMAIL_RECIPIENT_MARKER = '__email_recipient_history__';

// 获取历史收件人
app.get('/admin/email-recipient-history', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var limit = Math.min(parseInt(req.query.limit || '100'), 200);
    var { data, error } = await supabase.from('posts')
      .select('content, created_at')
      .eq('media_type', EMAIL_RECIPIENT_MARKER)
      .eq('user_name', ADMIN_USERNAME)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    var seen = new Set();
    var recipients = [];
    (data || []).forEach(function(row) {
      try {
        var info = JSON.parse(row.content || '{}');
        var email = (info.email || '').trim().toLowerCase();
        if (email && !seen.has(email)) {
          seen.add(email);
          recipients.push({ email: email, sent_at: info.sent_at || row.created_at });
        }
      } catch(e) {}
    });
    return res.json({ ok: true, recipients: recipients });
  } catch(e) {
    console.error('[Email Recipient History] 查询失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// 保存收件人到历史（去重，最大200条）
app.post('/admin/email-recipient-history', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    var emails = Array.isArray(req.body.emails) ? req.body.emails : [];
    var saved = 0;
    for (var i = 0; i < emails.length; i++) {
      var email = String(emails[i] || '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      await supabase.from('posts').insert([{
        user_name: ADMIN_USERNAME,
        content: JSON.stringify({ email: email, sent_at: new Date().toISOString() }),
        media_type: EMAIL_RECIPIENT_MARKER
      }]).catch(function(){});
      saved++;
    }
    return res.json({ ok: true, saved: saved });
  } catch(e) {
    console.error('[Email Recipient History] 保存失败:', e.message);
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
const VIP_MARKER = '__vip__';
const VIP_ORDER_MARKER = '__vip_order__';
const VIP_PLAN_MARKER = '__vip_plan__';

const VIP_PLANS = [
  {
    id: 'pro_monthly',
    name: 'XTJ Pro',
    price: 3,
    currency: 'CNY',
    duration_days: 30,
    features: ['vip_badge', 'photo_wall_unlimited', 'large_file_upload', 'pin_post']
  }
];

// 获取可用套餐列表
app.get('/api/vip/plans', rateLimit(60000, 30), (req, res) => {
  return res.json({ plans: VIP_PLANS });
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
app.post('/api/vip/create-order', rateLimit(60000, 10), async (req, res) => {
  try {
    const { user_name, plan_id } = req.body;
    const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
    if (!userNameVal) return res.status(400).json({ error: '缺少用户名' });

    // 验证用户存在
    const userExists = await verifyUserExists(userNameVal);
    if (!userExists) return res.status(400).json({ error: '用户不存在' });

    const plan = VIP_PLANS.find(p => p.id === plan_id);
    if (!plan) return res.status(400).json({ error: '无效的套餐ID' });

    // 检查是否已是VIP有效期内
    const { data: activeVip } = await supabase.from('posts')
      .select('*')
      .eq('user_name', userNameVal)
      .eq('media_type', VIP_MARKER)
      .order('created_at', { ascending: false })
      .limit(1);

    if (activeVip && activeVip.length > 0) {
      try {
        var vipInfo = JSON.parse(activeVip[0].content || '{}');
        if (vipInfo.is_active && vipInfo.expire_at && new Date(vipInfo.expire_at) > new Date()) {
          return res.json({ error: '您已经是VIP会员，无需重复购买' });
        }
      } catch(e) {}
    }

    // 生成订单号
    const orderNo = 'XTJ' + Date.now() + String(Math.random()).slice(2, 8);
    const now = new Date().toISOString();
    const orderContent = JSON.stringify({
      user_name: userNameVal,
      plan_id: plan.id,
      plan_name: plan.name,
      amount: plan.price,
      currency: plan.currency,
      status: 'pending',
      order_no: orderNo,
      created_at: now
    });

    const { error: orderErr } = await supabase.from('posts').insert([{
      user_name: userNameVal,
      content: orderContent,
      media_type: VIP_ORDER_MARKER,
      media_url: orderNo,
      actor_key: 'vip_order_' + Date.now()
    }]);

    if (orderErr) return res.status(400).json({ error: sanitizeError(orderErr) });

    // 立即完成激活
    const orderResult = await processVipPayment(userNameVal, orderNo, plan);
    return res.json({ order_no: orderNo, amount: plan.price, test_mode: true, result: orderResult });
  } catch(e) {
    console.error('[VIP] 创建订单失败:', e.message);
    return res.status(500).json({ error: '创建订单失败' });
  }
});

// 直接激活VIP（免支付流程）
app.post('/api/vip/activate-test', rateLimit(60000, 5), async (req, res) => {
  try {
    const { user_name } = req.body;
    const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
    if (!userNameVal) return res.status(400).json({ error: '缺少用户名' });

    const userExists = await verifyUserExists(userNameVal);
    if (!userExists) return res.status(400).json({ error: '用户不存在' });

    const plan = VIP_PLANS[0];
    const orderNo = 'TEST' + Date.now() + String(Math.random()).slice(2, 6);
    const result = await processVipPayment(userNameVal, orderNo, plan);
    return res.json(result);
  } catch(e) {
    console.error('[VIP] 测试激活失败:', e.message);
    return res.status(500).json({ error: '激活失败' });
  }
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
const PRO_GIFT_MARKER = '__pro_gift__';
const PRO_GIFT_CLAIM_MARKER = '__pro_gift_claim__';
const DEFAULT_GIFT_FEATURES = ['vip_badge', 'photo_wall_unlimited', 'large_file_upload', 'pin_post', 'custom_theme', 'profile_effects'];

// 管理员：获取全部 Pro 赠送活动
app.get('/admin/pro-gifts', verifyToken, rateLimit(60000, 10), async (req, res) => {
  try {
    const { data, error } = await supabase.from('posts')
      .select('id, user_name, content, created_at')
      .eq('media_type', PRO_GIFT_MARKER)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return res.status(400).json({ error: sanitizeError(error) });
    const gifts = (data || []).map(function(row) {
      var info = {};
      try { info = JSON.parse(row.content || '{}'); } catch(e) {}
      return {
        id: row.id,
        created_by: row.user_name,
        created_at: row.created_at,
        title: info.title || '',
        description: info.description || '',
        features: info.features || DEFAULT_GIFT_FEATURES,
        duration_days: info.duration_days || 30,
        claim_expire_at: info.claim_expire_at || '',
        is_published: !!info.is_published,
        published_at: info.published_at || ''
      };
    });
    return res.json({ ok: true, gifts: gifts });
  } catch(e) {
    console.error('[ProGift] 查询失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// 管理员：创建/编辑 Pro 赠送活动
app.post('/admin/pro-gifts/save', verifyToken, rateLimit(60000, 20), async (req, res) => {
  try {
    var { id, title, description, features, duration_days, claim_expire_at } = req.body;
    var titleVal = String(title || '').trim().slice(0, 100);
    var descVal = String(description || '').trim().slice(0, 500);
    if (!titleVal) return res.status(400).json({ error: '请输入活动标题' });
    if (!duration_days || duration_days < 1 || duration_days > 3650) return res.status(400).json({ error: '有效期1-3650天' });
    var featuresArr = Array.isArray(features) && features.length ? features : DEFAULT_GIFT_FEATURES;
    var info = {
      title: titleVal,
      description: descVal,
      features: featuresArr,
      duration_days: Math.min(3650, Math.max(1, parseInt(duration_days) || 30)),
      claim_expire_at: claim_expire_at || '',
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

// 用户：获取可领取的 Pro 赠送活动
app.get('/api/pro-gifts/available', rateLimit(60000, 30), async (req, res) => {
  try {
    var userName = String(req.query.user_name || '').trim();
    if (!userName) return res.status(400).json({ error: '缺少用户名' });
    var now = new Date().toISOString();
    var { data: gifts } = await supabase.from('posts')
      .select('id, content, created_at')
      .eq('media_type', PRO_GIFT_MARKER)
      .order('created_at', { ascending: false })
      .limit(50);
    var available = [];
    var claimedIds = [];
    // 查用户已领取记录
    var { data: claims } = await supabase.from('posts')
      .select('media_url')
      .eq('media_type', PRO_GIFT_CLAIM_MARKER)
      .eq('user_name', userName)
      .limit(200);
    if (claims) {
      claims.forEach(function(c) { if (c.media_url) claimedIds.push(c.media_url); });
    }
    (gifts || []).forEach(function(g) {
      var info = {};
      try { info = JSON.parse(g.content || '{}'); } catch(e) {}
      if (!info.is_published) return;
      if (info.claim_expire_at && info.claim_expire_at < now) return;
      var alreadyClaimed = claimedIds.indexOf(String(g.id)) >= 0;
      available.push({
        id: g.id,
        title: info.title || '',
        description: info.description || '',
        features: info.features || DEFAULT_GIFT_FEATURES,
        duration_days: info.duration_days || 30,
        claim_expire_at: info.claim_expire_at || '',
        published_at: info.published_at || '',
        already_claimed: alreadyClaimed
      });
    });
    return res.json({ ok: true, gifts: available });
  } catch(e) {
    console.error('[ProGift] 查询可用活动失败:', e.message);
    return res.status(500).json({ error: '查询失败' });
  }
});

// 用户：领取 Pro 赠送活动
app.post('/api/pro-gifts/claim', rateLimit(60000, 10), async (req, res) => {
  try {
    var { user_name, gift_id } = req.body;
    var userNameVal = String(user_name || '').trim();
    var giftId = String(gift_id || '').trim();
    if (!userNameVal) return res.status(400).json({ error: '缺少用户名' });
    if (!giftId) return res.status(400).json({ error: '缺少活动ID' });
    var now = new Date();
    var nowISO = now.toISOString();
    // 查活动是否存在且已发布
    var { data: gift } = await supabase.from('posts')
      .select('content').eq('id', giftId).eq('media_type', PRO_GIFT_MARKER).maybeSingle();
    if (!gift) return res.status(404).json({ error: '活动不存在' });
    var giftInfo = {};
    try { giftInfo = JSON.parse(gift.content || '{}'); } catch(e) {}
    if (!giftInfo.is_published) return res.status(400).json({ error: '活动未发布' });
    if (giftInfo.claim_expire_at && giftInfo.claim_expire_at < nowISO) return res.status(400).json({ error: '活动已过期' });
    // 查是否已领取过
    var { data: existingClaim } = await supabase.from('posts')
      .select('id').eq('media_type', PRO_GIFT_CLAIM_MARKER)
      .eq('user_name', userNameVal)
      .eq('media_url', giftId)
      .maybeSingle();
    if (existingClaim) return res.status(400).json({ error: '已领取过此活动' });
    var durationDays = giftInfo.duration_days || 30;
    var expireAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    var features = giftInfo.features || DEFAULT_GIFT_FEATURES;
    // 写入领取记录（先写，防重复领取）
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
    // 写入 VIP 激活记录（复用现有VIP系统）
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
      // ★ 关键修复：VIP 写入失败时回滚领取记录，避免"已领取但没VIP"
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
    var featuresArr = Array.isArray(features) && features.length ? features : DEFAULT_GIFT_FEATURES;
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
        features: info.features || [],
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
        features: info.features || [],
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
});
