// xtj Admin API service for Render deployment.
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { AlipaySdk } = require('alipay-sdk');

const app = express();

// 信任反向代理（Render 会设置 X-Forwarded-For）
app.set('trust proxy', 1);

// 全局禁用 X-Powered-By（必须在任何路由之前）
app.disable('x-powered-by');

// ===================== 配置 =====================
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'xxz';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const API_SECRET = process.env.API_SECRET || crypto
  .createHash('sha256')
  .update([
    'xtj-admin-fallback-secret',
    process.env.ADMIN_USERNAME || 'xxz',
    process.env.ADMIN_PASSWORD || '',
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '',
    process.env.SUPABASE_URL || 'https://ithowxqignlhkwaykglt.supabase.co'
  ].join('|'))
  .digest('hex');
const TOKEN_EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 hours
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ithowxqignlhkwaykglt.supabase.co';
// SUPABASE SERVICE_KEY 优先，回退到 ANON KEY（本地开发/演示模式）
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_SERVICE_KEY) {
  // 从 config.js 读取 ANON KEY 作为最终回退
  console.warn('[WARN] SUPABASE_SERVICE_KEY not set. Using configured ANON KEY as fallback.');
} else {
  console.log('[SUPABASE] Service key loaded' + (process.env.SUPABASE_SERVICE_KEY ? '' : ' (anon fallback)'));
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
if (!process.env.API_SECRET) {
  console.warn('[WARN] API_SECRET not set. Using deterministic fallback secret; set API_SECRET in Render for stronger isolation.');
}
if (!SUPABASE_SERVICE_KEY) {
  console.error('[FATAL] No Supabase key available. Server will not start.');
  process.exit(1);
}

// 初始化 Supabase 客户端（仅使用 service_role key，禁止 anon key 兜底）
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY
);

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
function shouldCountVisit(ip) {
  const today = new Date().toISOString().slice(0, 10);
  const key = ip + '_' + today;
  if (visitCache.has(key)) return false;
  visitCache.set(key, true);
  // 每30分钟清理非今天的旧记录，避免full clear丢失去重数据
  if (visitCache.size > 10000) {
    var keysToDelete = [];
    visitCache.forEach(function(_, k) {
      if (!k.endsWith('_' + today)) keysToDelete.push(k);
    });
    keysToDelete.forEach(function(k) { visitCache.delete(k); });
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

async function getAdminMetaRecord() {
  const { data, error } = await supabase.from('posts')
    .select('id, content, created_at')
    .eq('media_type', ADMIN_META_MARKER)
    .eq('user_name', ADMIN_USERNAME)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data && data.length ? data[0] : null;
}

async function saveAdminMetaFields(fields) {
  const existing = await getAdminMetaRecord();
  const nextContent = Object.assign({}, safeJsonParse(existing && existing.content), fields || {});
  if (existing && existing.id) {
    const { error } = await supabase.from('posts')
      .update({ content: JSON.stringify(nextContent) })
      .eq('id', existing.id);
    if (error) throw error;
    return { id: existing.id, content: nextContent };
  }
  const { data, error } = await supabase.from('posts').insert([{
    user_name: ADMIN_USERNAME,
    content: JSON.stringify(nextContent),
    media_type: ADMIN_META_MARKER,
    actor_key: ADMIN_META_MARKER
  }]).select('id, content').limit(1);
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
    // 自动检测模式：检查是否匹配服务器域名或 Render 域名
    if (ALLOWED_ORIGINS.length === 0) {
      try {
        var originHost = new URL(origin).hostname;
        // 允许同域名（通过 SERVER_HOSTNAME 或 Render 环境变量）、Render/ Vercel 域名、本地开发域名
        if (originHost === SERVER_HOSTNAME || originHost.endsWith('.onrender.com') || originHost.endsWith('.vercel.app') || originHost === 'localhost' || originHost === '127.0.0.1') {
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

    if (record.count > maxRequests) {
      logAttack(key, 'RATE_LIMIT', req.method + ' ' + req.path);
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    next();
  };
}

// ===================== Token 管理（无状态签名令牌，服务重启不掉登录） =====================
const adminTokens = new Map(); // token -> { expiresAt }（仅用于延长有效期跟踪）
// 每10分钟清理过期 token
setInterval(function() {
  var now = Date.now();
  adminTokens.forEach(function(session, token) {
    if (now > session.expiresAt) adminTokens.delete(token);
  });
}, 600000);

// 生成无状态签名 token：base64(expiry) + '.' + HMAC
function signToken() {
  const payload = JSON.stringify({ exp: Date.now() + TOKEN_EXPIRY_MS, user: ADMIN_USERNAME });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', API_SECRET).update(b64).digest('base64url');
  return b64 + '.' + sig;
}

// 验证无状态 token（优先于 Map 检查）
function verifySignedToken(token) {
  try {
    var parts = token.split('.');
    if (parts.length !== 2) return null;
    var b64 = parts[0], sig = parts[1];
    var expectedSig = crypto.createHmac('sha256', API_SECRET).update(b64).digest('base64url');
    // timingSafeEqual 防止时序攻击
    var sigBuf = Buffer.from(sig);
    var expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    var payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch(e) { return null; }
}

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  // 优先验证无状态签名（服务重启后仍然有效）
  var payload = verifySignedToken(token);
  if (payload) {
    req.adminToken = token;
    return next();
  }

  // 回退到内存 Map（兼容旧 token）
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
  res.status(200).type('text/plain').send('ok');
});

// ===================== 管理员登录 ======================
app.post('/admin/login', rateLimit(60000, 10), async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: '璇疯緭鍏ヨ处鍙峰拰瀵嗙爜' });
  }
  
  // 杈撳叆闀垮害鏍￠獙
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
  
  return res.json({ ok: true, token, username: ADMIN_USERNAME });
});

// 楠岃瘉 token 鏄惁鏈夋晥
app.get('/admin/verify', verifyToken, (req, res) => {
  return res.json({ ok: true });
});

// 管理员登出
app.post('/admin/logout', verifyToken, (req, res) => {
  adminTokens.delete(req.adminToken);
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

    const [postRes, likeRes, commRes, reportRes, banRes, muteRes, blacklistRes, annRes] = await Promise.all([
      supabase.from('posts').select('*').neq('media_type', '__avatar__').neq('media_type', '__user_info__').neq('media_type', '__ann__').neq('media_type', ADMIN_AUTH_MARKER).neq('media_type', ADMIN_META_MARKER).neq('media_type', '__photo_wall__').neq('media_type', REPORT_MARKER).neq('media_type', DM_MARKER).neq('media_type', AUTH_MARKER).neq('media_type', VISIT_MARKER).neq('media_type', ATTACK_MARKER).neq('media_type', '__user_visit__').neq('media_type', '__vip__').neq('media_type', '__vip_order__').order('created_at', { ascending: false }).limit(5000),
      supabase.from('likes').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('comments').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('posts').select('*').eq('media_type', REPORT_MARKER).order('created_at', { ascending: false }).limit(500),
      supabase.from('bans').select('*').order('banned_at', { ascending: false }).limit(500),
      supabase.from('mutes').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('blacklist').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('posts').select('*').eq('media_type', '__ann__').order('created_at', { ascending: false }).limit(500)
    ]);
    
    return res.json({
      posts: postRes.data || [],
      likes: likeRes.data || [],
      comments: commRes.data || [],
      reports: reportRes.data || [],
      bans: banRes.data || [],
      mutes: muteRes.data || [],
      blacklist: blacklistRes.data || [],
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
  const { id } = req.params;
  // 先获取帖子的 actor_key
  const { data: post } = await supabase.from('posts').select('actor_key').eq('id', id).maybeSingle();
  const actorKey = (post && post.actor_key) || 'admin_' + Date.now();
  
  const { error } = await supabase.rpc('delete_post_with_actor', {
    p_post_id: id,
    p_actor_key: actorKey
  });
  if (error) return res.status(400).json({ error: sanitizeError(error) });
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
app.get('/api/report/notifications', async (req, res) => {
  const { user } = req.query;
  if (!user) return res.status(400).json({ error: '缺少用户名' });
  try {
    const { data, error } = await supabase.from('posts')
      .select('id, content')
      .eq('user_name', user)
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

app.post('/api/report/notifications/mark-read', async (req, res) => {
  const { user } = req.body;
  if (!user) return res.status(400).json({ error: '缺少用户名' });
  try {
    const { data, error } = await supabase.from('posts')
      .select('id, content')
      .eq('user_name', user)
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
  const { id } = req.params;
  const { error } = await supabase.from('posts').update({
    is_deleted: true,
    deleted_at: new Date().toISOString(),
    deleted_by: 'admin'
  }).eq('id', id).eq('media_type', '__photo_wall__');
  if (error) return res.status(400).json({ error: sanitizeError(error) });
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
    if (!password_hash) return res.status(401).json({ error: '缺少身份验证' });

    // 判断是否为管理员（xxz）执行删除
    const isAdmin = currentUser === ADMIN_USERNAME;

    if (isAdmin) {
      // 管理员：验证管理员身份标记
      const { data: adminAuth } = await supabase.from('posts')
        .select('media_url')
        .eq('user_name', ADMIN_USERNAME)
        .eq('media_type', ADMIN_AUTH_MARKER)
        .maybeSingle();
      if (!adminAuth || adminAuth.media_url !== password_hash) {
        return res.status(403).json({ error: '管理员身份验证失败' });
      }
      // 管理员可删除任意照片，跳过所有者校验
    } else {
      // 普通用户：验证用户身份标记
      const { data: authRec } = await supabase.from('posts')
        .select('media_url')
        .eq('user_name', username)
        .eq('media_type', AUTH_MARKER)
        .maybeSingle();
      if (!authRec || authRec.media_url !== password_hash) {
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
  const { user_name, duration_hours, reason } = req.body;
  const durationCheck = validateDurationHours(duration_hours);
  if (durationCheck.error) return res.status(400).json({ error: durationCheck.error });
  const durationHoursVal = durationCheck.value;
  if (!user_name) return res.status(400).json({ error: '缺少用户名' });
  
  const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
  if (userNameVal && userNameVal.error) return res.status(400).json({ error: userNameVal.error });
  if (isProtectedAdminTarget(userNameVal)) return res.status(403).json({ error: 'Operation not allowed for admin user' });
  const reasonVal = validateString(reason, MAX_REASON_LEN, '鍘熷洜');
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
      ban_reason: reasonVal || '杩濆弽绀惧尯瑙勫畾',
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
      user_name: userNameVal, ban_type: banType, ban_reason: reasonVal || '杩濆弽绀惧尯瑙勫畾',
      ban_duration_hours: durationHoursVal,
      banned_by: ADMIN_USERNAME, expires_at: expiresAt, is_active: true
    }]);
    if (error) {
      if (error.code === '23505') {
        const { error: updErr } = await supabase.from('bans').update({
          ban_reason: reasonVal || '杩濆弽绀惧尯瑙勫畾',
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
  
  return res.json({ ok: true });
});

app.put('/admin/ban/:id/lift', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('bans').update({
    is_active: false, lifted_at: new Date().toISOString(), lifted_by: ADMIN_USERNAME
  }).eq('id', id);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true });
});

// ===================== 禁言管理 ======================
app.get('/admin/mutes', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('mutes').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ data });
});

app.post('/admin/mute', verifyToken, rateLimit(60000, 30), async (req, res) => {
  const { user_name, duration_hours, reason } = req.body;
  const durationCheck = validateDurationHours(duration_hours);
  if (durationCheck.error) return res.status(400).json({ error: durationCheck.error });
  const durationHoursVal = durationCheck.value;
  if (!user_name) return res.status(400).json({ error: '缺少用户名' });
  
  const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
  if (userNameVal && userNameVal.error) return res.status(400).json({ error: userNameVal.error });
  const reasonVal = validateString(reason, MAX_REASON_LEN, '鍘熷洜');
  if (reasonVal && reasonVal.error) return res.status(400).json({ error: reasonVal.error });
  if (isProtectedAdminTarget(userNameVal)) return res.status(403).json({ error: 'Operation not allowed for admin user' });
  
  let expiresAt = null;
  if (durationHoursVal > 0) {
    expiresAt = new Date(Date.now() + durationHoursVal * 3600000).toISOString();
  }
  
  const { error } = await supabase.from('mutes').insert([{
    user_name: userNameVal,
    reason: reasonVal || '杩濆弽绀惧尯瑙勫畾',
    duration_hours: durationHoursVal,
    muted_by: ADMIN_USERNAME,
    expires_at: expiresAt,
    is_active: true
  }]);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  
  return res.json({ ok: true });
});

app.put('/admin/mute/:id/lift', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('mutes').update({
    is_active: false, lifted_at: new Date().toISOString(), lifted_by: ADMIN_USERNAME
  }).eq('id', id);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
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
  const reasonVal = validateString(reason, MAX_REASON_LEN, '鍘熷洜');
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
      reason: reasonVal || '杩濆弽绀惧尯瑙勫畾',
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
      reason: reasonVal || '杩濆弽绀惧尯瑙勫畾',
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
app.post('/api/report', rateLimit(60000, 5), async (req, res) => {
  const { reporter_name, target_type, target_id, target_user, report_category, report_reason } = req.body;
  if (!reporter_name || !target_type || !target_id || !report_category) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  const reporterVal = validateString(reporter_name, MAX_USERNAME_LEN, '举报人');
  if (reporterVal && reporterVal.error) return res.status(400).json({ error: reporterVal.error });
  const targetUserVal = validateString(target_user, MAX_USERNAME_LEN, '被举报用户');
  const reasonVal = validateString(report_reason, MAX_REASON_LEN, '举报原因');
  if (reasonVal && reasonVal.error) return res.status(400).json({ error: reasonVal.error });
  
  // 验证举报人账号存在
  const { data: userCheck } = await supabase.from('posts')
    .select('id')
    .eq('user_name', reporterVal)
    .eq('media_type', AUTH_MARKER)
    .limit(1);
  if (!userCheck || userCheck.length === 0) {
    return res.status(400).json({ error: '举报人账号不存在' });
  }
  
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
app.get('/api/my-reports', rateLimit(60000, 20), async (req, res) => {
  const userName = req.query.user_name;
  const password_hash = req.query.password_hash;
  if (!userName) return res.status(400).json({ error: '缺少用户名' });
  if (!password_hash) return res.status(401).json({ error: '缺少身份验证' });

  // 验证密码 hash
  const { data: authRec } = await supabase.from('posts')
    .select('media_url')
    .eq('user_name', userName)
    .eq('media_type', AUTH_MARKER)
    .maybeSingle();
  if (!authRec || authRec.media_url !== password_hash) {
    return res.status(403).json({ error: '身份验证失败' });
  }
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
        .neq('media_type', '__user_visit__'),
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
        .neq('media_type', USER_VISIT_MARKER),
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
app.post('/api/log-user-visit', rateLimit(60000, 30), async (req, res) => {
  try {
    const { user_name, password_hash } = req.body;
    const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
    if (!userNameVal) return res.status(400).json({ error: '缺少用户名' });

    // 验证密码 hash
    if (!password_hash) return res.status(401).json({ error: '缺少身份验证' });
    const { data: authRec } = await supabase.from('posts')
      .select('media_url')
      .eq('user_name', userNameVal)
      .eq('media_type', AUTH_MARKER)
      .maybeSingle();
    if (!authRec || authRec.media_url !== password_hash) {
      return res.status(403).json({ error: '身份验证失败' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    // 记录用户访问（用 __user_visit__ 标记，区别于 IP 级别的 __visit__）
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
app.post('/api/log-login-event', rateLimit(60000, 30), async (req, res) => {
  try {
    const { user_name, password_hash, device_id, device_type, os, browser, user_agent } = req.body;

    const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
    if (!userNameVal) return res.status(400).json({ error: '缺少用户名' });

    const deviceIdVal = validateString(device_id, 120, '设备ID');
    if (!deviceIdVal) return res.status(400).json({ error: '缺少设备ID' });

    // 验证密码 hash（与 /api/log-user-visit 相同验证方式）
    if (!password_hash) return res.status(401).json({ error: '缺少身份验证' });
    const { data: authRec } = await supabase.from('posts')
      .select('media_url')
      .eq('user_name', userNameVal)
      .eq('media_type', AUTH_MARKER)
      .maybeSingle();
    if (!authRec || authRec.media_url !== password_hash) {
      return res.status(403).json({ error: '身份验证失败' });
    }

    // IP 由后端获取，前端不允许传 ip
    const ip = getClientIp(req);
    const loginAt = new Date().toISOString();
    const random = Math.random().toString(36).slice(2, 10);

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
        ip: ip,
        ip_location: null,
        login_at: loginAt
      }),
      actor_key: 'login_' + Date.now() + '_' + random
    }]);
    if (error) return res.status(400).json({ error: sanitizeError(error) });

    return res.json({ ok: true });
  } catch(e) {
    console.error('[API] 登录事件记录失败:', e.message);
    return res.status(500).json({ error: '记录失败' });
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
      getAdminMetaRecord(),
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
    await saveAdminMetaFields({ last_seen_register_alert_at: nowIso });
    return res.json({ ok: true, last_seen_at: nowIso });
  } catch (e) {
    console.error('[API] 新用户注册提醒已读写入失败:', e.message);
    return res.status(500).json({ error: '新用户注册提醒已读写入失败' });
  }
});

// ===================== VIP 会员 API =====================
const VIP_MARKER = '__vip__';
const VIP_ORDER_MARKER = '__vip_order__';
const VIP_PLAN_MARKER = '__vip_plan__';
// 测试模式：无需支付宝凭证即可支付
// 当 ALIPAY_APP_ID 和 ALIPAY_PUBLIC_KEY 都配置时使用真实沙箱支付
const LOCAL_TEST_MODE = !(process.env.ALIPAY_APP_ID && process.env.ALIPAY_PUBLIC_KEY);

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

// ===================== 支付宝 SDK 初始化 =====================
let alipaySdk = null;
if (!LOCAL_TEST_MODE) {
  try {
    const privateKeyPath = process.env.ALIPAY_APP_PRIVATE_KEY_PATH || path.join(__dirname, 'alipay_private_key.pem');
    const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

    alipaySdk = new AlipaySdk({
      appId: process.env.ALIPAY_APP_ID,
      privateKey: privateKey,
      alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY,
      gateway: process.env.ALIPAY_GATEWAY || 'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
      signType: 'RSA2'
    });
    console.log('[Alipay] SDK initialized (sandbox mode)');
  } catch(e) {
    console.error('[Alipay] SDK init failed:', e.message);
    console.warn('[Alipay] Falling back to local test mode');
  }
}
if (!alipaySdk) {
  // 如果 SDK 初始化失败，仍然保持测试模式
  console.log('[Alipay] Using local test mode (no Alipay)');
}

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

    if (LOCAL_TEST_MODE) {
      // 测试模式：立即完成支付
      const orderResult = await processVipPayment(userNameVal, orderNo, plan);
      return res.json({ order_no: orderNo, amount: plan.price, test_mode: true, result: orderResult });
    }

    // 生产模式返回支付宝支付表单/URL（需要配置 ALIPAY_APP_ID 等环境变量）
    return res.json({
      order_no: orderNo,
      amount: plan.price,
      pay_url: '/api/vip/pay/' + orderNo,
      test_mode: false
    });
  } catch(e) {
    console.error('[VIP] 创建订单失败:', e.message);
    return res.status(500).json({ error: '创建订单失败' });
  }
});

// 测试模式：直接激活VIP（免支付流程）
app.post('/api/vip/activate-test', rateLimit(60000, 5), async (req, res) => {
  if (!LOCAL_TEST_MODE) return res.status(403).json({ error: '生产模式下不支持测试激活' });
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

// 处理VIP支付完成
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

  // 更新订单状态
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
    } catch(e) {}
  }

  // 写入VIP记录
  const { error: vipErr } = await supabase.from('posts').insert([{
    user_name: userName,
    content: vipContent,
    media_type: VIP_MARKER,
    media_url: plan.id,
    actor_key: 'vip_' + Date.now()
  }]);

  if (vipErr) throw vipErr;

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

// 生产模式：获取支付宝支付URL（需配置真实支付宝参数）
app.get('/api/vip/pay/:orderNo', async (req, res) => {
  const orderNo = req.params.orderNo;
  const { data: orders } = await supabase.from('posts')
    .select('*')
    .eq('media_type', VIP_ORDER_MARKER)
    .eq('media_url', orderNo)
    .limit(1);

  if (!orders || orders.length === 0) return res.status(404).json({ error: '订单不存在' });

  try {
    var orderData = JSON.parse(orders[0].content || '{}');
    if (orderData.status === 'paid') return res.json({ error: '订单已支付' });

    if (!alipaySdk) {
      // 测试模式：直接跳转成功页
      return res.redirect('/?vip=success');
    }

    // ===== 支付宝手机网站支付 alipay.trade.wap.pay =====
    const bizContent = {
      out_trade_no: orderNo,
      product_code: 'QUICK_WAP_WAY',
      total_amount: (orderData.amount || 3).toFixed(2),
      subject: 'XTJ Pro 会员',
      body: 'XTJ Pro ' + (orderData.plan_name || '月度会员'),
      quit_url: process.env.ALIPAY_RETURN_URL || 'http://localhost:3000',
      time_expire: new Date(Date.now() + 30 * 60 * 1000).toISOString().replace(/\.\d{3}/, '')
    };

    try {
      // 使用 pageExec 生成自动跳转表单
      const form = await alipaySdk.pageExec('alipay.trade.wap.pay', {
        notifyUrl: process.env.ALIPAY_NOTIFY_URL || 'http://localhost:3000/api/vip/alipay/notify',
        returnUrl: process.env.ALIPAY_RETURN_URL + '/?vip=success&order=' + orderNo
      }, bizContent);

      // 返回完整的自动提交HTML表单
      return res.type('text/html; charset=utf-8').send(form);
    } catch(alipayErr) {
      console.error('[Alipay] pageExec error:', alipayErr.message);
      return res.status(500).json({ error: '支付宝支付链接生成失败: ' + alipayErr.message });
    }
  } catch(e) {
    console.error('[VIP] 支付跳转失败:', e.message);
    return res.status(500).json({ error: '支付跳转失败' });
  }
});

// 支付宝异步通知接收（生产环境使用）
app.post('/api/vip/notify', async (req, res) => {
  // 验签：需验证 sign 参数
  const params = req.body;
  if (!params || !params.sign) {
    return res.status(400).send('fail');
  }

  // 验证 trade_status
  if (params.trade_status === 'TRADE_SUCCESS' || params.trade_status === 'TRADE_FINISHED') {
    const orderNo = params.out_trade_no;
    const tradeNo = params.trade_no;
    const totalAmount = parseFloat(params.total_amount || '0');

    // 查询对应订单
    const { data: orders } = await supabase.from('posts')
      .select('*')
      .eq('media_type', VIP_ORDER_MARKER)
      .eq('media_url', orderNo)
      .limit(1);

    if (orders && orders.length > 0) {
      try {
        var orderData = JSON.parse(orders[0].content || '{}');
        if (orderData.status === 'paid') return res.send('success');

        // 核对金额
        if (Math.abs(orderData.amount - totalAmount) > 0.01) {
          console.error('[VIP] 金额不匹配:', orderNo, orderData.amount, totalAmount);
          return res.send('fail');
        }

        const plan = VIP_PLANS.find(p => p.id === orderData.plan_id);
        if (plan) {
          await processVipPayment(orderData.user_name, orderNo, plan);
        }
      } catch(e) {
        console.error('[VIP] 通知处理失败:', e.message);
        return res.send('fail');
      }
    }
  }

  res.send('success');
});

// ===================== 启动 =====================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[xtj-admin-api] running on port ${port}`);
  console.log(`[xtj-admin-api] password configured: ${ADMIN_PASSWORD ? 'yes' : 'no'}`);
  console.log(`[xtj-admin-api] supabase key type: ${SUPABASE_SERVICE_KEY ? 'service_role' : (process.env.SUPABASE_ANON_KEY ? 'anon' : 'none')}`);
  console.log(`[xtj-admin-api] allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`[xtj-admin-api] vip local test mode: ${LOCAL_TEST_MODE ? 'enabled' : 'disabled'}`);
});
