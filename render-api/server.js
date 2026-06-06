// xtj Admin API service for Render deployment.
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const app = express();

// ===================== 配置 =====================
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'xxz';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const API_SECRET = process.env.API_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 hours

// Allowed frontend origins.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://xtj.onrender.com').split(',').map(s => s.trim());

if (!ADMIN_PASSWORD) {
  console.warn('[WARN] ADMIN_PASSWORD is not configured.');
}

// ===================== 输入校验 =====================
const MAX_USERNAME_LEN = 50;
const MAX_REASON_LEN = 500;
const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 5000;
const REPORT_MARKER = '__report__';

function sanitizeError(err) {
  if (!err) return '操作失败';
  console.error('[API Error]', err.message || err);
  if (err.code === '42501' || err.code === 'PGRST301') return '权限不足';
  if (err.code === '23505') return '数据已存在';
  return '操作失败，请稍后重试';
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

// ===================== 涓棿浠?=====================
// CORS 闄愬埗锛氫粎鍏佽鎸囧畾鍩熷悕
app.use(cors({
  origin: function (origin, callback) {
    // 鍏佽鏃?origin 鐨勮姹傦紙濡?curl銆丳ostman銆佸悓婧愯姹傦級
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    console.warn('[CORS] Rejected origin ' + origin);
    callback(new Error('涓嶅厑璁哥殑鏉ユ簮'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}));

app.use(express.json({ limit: '10mb' }));

// 安全响应头
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // 绉婚櫎 Express 榛樿鐨?X-Powered-By 澶?  res.removeHeader('X-Powered-By');
  // Remove Express default X-Powered-By header.
  res.removeHeader('X-Powered-By');

// 频率限制中间件
const rateLimitStore = new Map();
function rateLimit(windowMs, maxRequests) {
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
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
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    next();
  };
}

// ===================== Token 管理 =====================
const adminTokens = new Map(); // token -> { expiresAt }

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return res.status(401).json({ error: '未提供认证令牌' });
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

// ===================== 鍋ュ悍妫€鏌?=====================
app.get('/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

// ===================== 绠＄悊鍛樼櫥褰?=====================
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
  
  if (username !== ADMIN_USERNAME) {
    return res.status(401).json({ error: '账号不存在' });
  }
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: '服务器未配置管理员密码，请联系管理员' });
  }
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: '密码错误' });
  }
  
  const token = generateToken();
  adminTokens.set(token, { expiresAt: Date.now() + TOKEN_EXPIRY_MS });
  
  return res.json({ ok: true, token, username: ADMIN_USERNAME });
});

// 楠岃瘉 token 鏄惁鏈夋晥
app.get('/admin/verify', verifyToken, (req, res) => {
  return res.json({ ok: true });
});

// 绠＄悊鍛樼櫥鍑?app.post('/admin/logout', verifyToken, (req, res) => {
  adminTokens.delete(req.adminToken);
  return res.json({ ok: true });
});

// ===================== 鏁版嵁鍔犺浇锛堝彧璇伙紝浣嗛渶瑕佽璇侊級 =====================
app.get('/admin/data', verifyToken, rateLimit(60000, 30), async (req, res) => {
  try {
    const [postRes, likeRes, commRes, reportRes, banRes, muteRes, blacklistRes] = await Promise.all([
      supabase.from('posts').select('*').neq('media_type', '__avatar__').order('created_at', { ascending: false }).limit(5000),
      supabase.from('likes').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('comments').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('posts').select('*').eq('media_type', REPORT_MARKER).order('created_at', { ascending: false }).limit(500),
      supabase.from('bans').select('*').order('banned_at', { ascending: false }).limit(500),
      supabase.from('mutes').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('blacklist').select('*').order('created_at', { ascending: false }).limit(500)
    ]);
    
    return res.json({
      posts: postRes.data || [],
      likes: likeRes.data || [],
      comments: commRes.data || [],
      reports: reportRes.data || [],
      bans: banRes.data || [],
      mutes: muteRes.data || [],
      blacklist: blacklistRes.data || []
    });
  } catch (e) {
    console.error('[API] 鏁版嵁鍔犺浇澶辫触:', e.message);
    return res.status(500).json({ error: '鏁版嵁鍔犺浇澶辫触' });
  }
});

// ===================== 鍏憡绠＄悊 =====================
app.post('/admin/announcement', verifyToken, rateLimit(60000, 20), async (req, res) => {
  const { title, content } = req.body;
  if (!title && !content) {
    return res.status(400).json({ error: '璇疯嚦灏戝～鍐欐爣棰樻垨鍐呭' });
  }
  
  const titleVal = validateString(title, MAX_TITLE_LEN, '鏍囬');
  if (titleVal && titleVal.error) return res.status(400).json({ error: titleVal.error });
  const contentVal = validateString(content, MAX_CONTENT_LEN, '鍐呭');
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
  const { error } = await supabase.rpc('delete_post_with_actor', {
    p_post_id: id,
    p_actor_key: 'admin_' + Date.now()
  });
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true });
});

// ===================== 甯栧瓙绠＄悊 =====================
app.delete('/admin/post/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  // 鍏堣幏鍙栧笘瀛愮殑 actor_key
  const { data: post } = await supabase.from('posts').select('actor_key').eq('id', id).maybeSingle();
  const actorKey = (post && post.actor_key) || 'admin_' + Date.now();
  
  const { error } = await supabase.rpc('delete_post_with_actor', {
    p_post_id: id,
    p_actor_key: actorKey
  });
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true });
});

// ===================== 璇勮绠＄悊 =====================
app.delete('/admin/comment/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.rpc('delete_comment_v2', {
    p_comment_id: id,
    p_deleted_by: ADMIN_USERNAME
  });
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true, data });
});

// ===================== 鐓х墖绠＄悊 =====================
app.delete('/admin/photo/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('posts').delete().eq('id', id);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true });
});

// ===================== 灏佺绠＄悊 =====================
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

// ===================== 绂佽█绠＄悊 =====================
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

// ===================== 榛戝悕鍗曠鐞?=====================
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

// ===================== 涓炬姤绠＄悊 =====================
app.get('/admin/reports', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('posts').select('*').eq('media_type', REPORT_MARKER).order('created_at', { ascending: false }).limit(500);
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
  const { data: post, error: fetchErr } = await supabase.from('posts').select('content').eq('id', id).maybeSingle();
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
    const { data: post } = await supabase.from('posts').select('actor_key').eq('id', targetId).maybeSingle();
    const actorKey = (post && post.actor_key) || 'admin_' + Date.now();
    await supabase.rpc('delete_post_with_actor', {
      p_post_id: targetId,
      p_actor_key: actorKey
    });
  }
  // 标记举报已处理
  c.status = 'actioned';
  c.reviewed_at = new Date().toISOString();
  c.reviewed_by = ADMIN_USERNAME;
  await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', id);
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
      await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', id);
      return res.json({ ok: true, message: '该用户已被封禁，举报已标记为已处理' });
    }
    await supabase.from('bans').update({
      ban_reason: '举报处理：' + (reportReason || '违规内容'),
      ban_duration_hours: duration_hours || 0,
      ban_type: banType,
      banned_by: ADMIN_USERNAME,
      expires_at: expiresAt,
      is_active: true,
      banned_at: new Date().toISOString()
    }).eq('id', existing[0].id);
  } else {
    await supabase.from('bans').insert([{
      user_name: targetUser,
      ban_type: banType,
      ban_reason: '举报处理：' + (reportReason || '违规内容'),
      ban_duration_hours: duration_hours || 0,
      banned_by: ADMIN_USERNAME,
      expires_at: expiresAt,
      is_active: true
    }]);
  }
  
  // 标记举报已处理
  c.status = 'actioned';
  c.reviewed_at = new Date().toISOString();
  c.reviewed_by = ADMIN_USERNAME;
  await supabase.from('posts').update({ content: JSON.stringify(c) }).eq('id', id);
  
  return res.json({ ok: true });
});

// 用户提交举报
app.post('/api/report', rateLimit(60000, 10), async (req, res) => {
  const { reporter_name, target_type, target_id, target_user, report_category, report_reason } = req.body;
  if (!reporter_name || !target_type || !target_id || !report_category) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  const reporterVal = validateString(reporter_name, MAX_USERNAME_LEN, '举报人');
  if (reporterVal && reporterVal.error) return res.status(400).json({ error: reporterVal.error });
  const targetUserVal = validateString(target_user, MAX_USERNAME_LEN, '被举报用户');
  const reasonVal = validateString(report_reason, MAX_REASON_LEN, '举报原因');
  if (reasonVal && reasonVal.error) return res.status(400).json({ error: reasonVal.error });
  
  const reportContent = JSON.stringify({
    target_type, target_id, target_user: targetUserVal || null,
    report_category, report_reason: reasonVal || '',
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
  if (!userName) return res.status(400).json({ error: '缺少用户名' });
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

// ===================== 鐢ㄦ埛鏁版嵁锛堝彧璇伙級 =====================
app.get('/admin/users', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('posts')
    .select('user_name, created_at')
    .eq('media_type', '__user_info__')
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ data });
});

// ===================== 鍚姩 =====================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[xtj-admin-api] running on port ${port}`);
  console.log(`[xtj-admin-api] admin username: ${ADMIN_USERNAME}`);
  console.log(`[xtj-admin-api] password configured: ${ADMIN_PASSWORD ? 'yes' : 'no'}`);
  console.log(`[xtj-admin-api] allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
