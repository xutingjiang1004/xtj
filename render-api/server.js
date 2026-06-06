// xtj Admin API — 部署到 Render 的后端服务
// 所有管理操作通过此 API 执行，使用 SERVICE_ROLE_KEY，避免前端暴露敏感权限
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const app = express();

// ===================== 配置 =====================
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'xxz';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const API_SECRET = process.env.API_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24小时

// 允许的前端域名
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://xtj.onrender.com').split(',').map(s => s.trim());

if (!ADMIN_PASSWORD) {
  console.warn('[WARN] ADMIN_PASSWORD 环境变量未设置！请在生产环境中设置。');
}

// ===================== 输入校验 =====================
const MAX_USERNAME_LEN = 50;
const MAX_REASON_LEN = 500;
const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 5000;

function sanitizeError(err) {
  // 不暴露内部错误细节，只返回通用错误信息
  if (!err) return '操作失败';
  console.error('[API Error]', err.message || err);
  // 对于 Supabase RLS 错误，返回通用信息
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

// ===================== 中间件 =====================
// CORS 限制：仅允许指定域名
app.use(cors({
  origin: function (origin, callback) {
    // 允许无 origin 的请求（如 curl、Postman、同源请求）
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    console.warn('[CORS] 拒绝来自 ' + origin + ' 的请求');
    callback(new Error('不允许的来源'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}));

app.use(express.json({ limit: '10mb' }));

// 安全响应头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // 移除 Express 默认的 X-Powered-By 头
  res.removeHeader('X-Powered-By');
  next();
});

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

// 清理过期的限流记录（每5分钟）
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore) {
    if (now > record.resetAt) rateLimitStore.delete(key);
  }
}, 5 * 60 * 1000);

// ===================== Supabase 客户端（service_role） =====================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
  
  // 刷新过期时间
  session.expiresAt = Date.now() + TOKEN_EXPIRY_MS;
  req.adminToken = token;
  next();
}

// ===================== 健康检查 =====================
app.get('/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

// ===================== 管理员登录 =====================
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
  
  if (username !== ADMIN_USERNAME) {
    return res.status(401).json({ error: '账号或密码不正确' });
  }
  
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: '服务器未配置管理员密码，请联系管理员' });
  }
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: '账号或密码不正确' });
  }
  
  const token = generateToken();
  adminTokens.set(token, { expiresAt: Date.now() + TOKEN_EXPIRY_MS });
  
  return res.json({ ok: true, token, username: ADMIN_USERNAME });
});

// 验证 token 是否有效
app.get('/admin/verify', verifyToken, (req, res) => {
  return res.json({ ok: true });
});

// 管理员登出
app.post('/admin/logout', verifyToken, (req, res) => {
  adminTokens.delete(req.adminToken);
  return res.json({ ok: true });
});

// ===================== 数据加载（只读，但需要认证） =====================
app.get('/admin/data', verifyToken, rateLimit(60000, 30), async (req, res) => {
  try {
    const [postRes, likeRes, commRes, reportRes, banRes, muteRes, blacklistRes] = await Promise.all([
      supabase.from('posts').select('*').neq('media_type', '__avatar__').order('created_at', { ascending: false }).limit(5000),
      supabase.from('likes').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('comments').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(500),
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
    console.error('[API] 数据加载失败:', e.message);
    return res.status(500).json({ error: '数据加载失败' });
  }
});

// ===================== 公告管理 =====================
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
  const { error } = await supabase.rpc('delete_post_with_actor', {
    p_post_id: id,
    p_actor_key: 'admin_' + Date.now()
  });
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true });
});

// ===================== 帖子管理 =====================
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

// ===================== 评论管理 =====================
app.delete('/admin/comment/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.rpc('delete_comment_v2', {
    p_comment_id: id,
    p_deleted_by: ADMIN_USERNAME
  });
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true, data });
});

// ===================== 照片管理 =====================
app.delete('/admin/photo/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('posts').delete().eq('id', id);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true });
});

// ===================== 封禁管理 =====================
app.get('/admin/bans', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('bans').select('*').order('banned_at', { ascending: false }).limit(500);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ data });
});

app.post('/admin/ban', verifyToken, rateLimit(60000, 30), async (req, res) => {
  const { user_name, duration_hours, reason } = req.body;
  if (!user_name) return res.status(400).json({ error: '缺少用户名' });
  
  const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
  if (userNameVal && userNameVal.error) return res.status(400).json({ error: userNameVal.error });
  const reasonVal = validateString(reason, MAX_REASON_LEN, '原因');
  if (reasonVal && reasonVal.error) return res.status(400).json({ error: reasonVal.error });
  
  const banType = (duration_hours || 0) === 0 ? 'permanent' : 'temporary';
  let expiresAt = null;
  if (duration_hours > 0) {
    expiresAt = new Date(Date.now() + duration_hours * 3600000).toISOString();
  }
  
  // 检查是否已有记录
  const { data: existing } = await supabase.from('bans').select('id, is_active').eq('user_name', userNameVal);
  if (existing && existing.length) {
    const activeBan = existing.find(b => b.is_active);
    if (activeBan) return res.status(409).json({ error: '该用户已被拉黑封禁' });
    
    const { error } = await supabase.from('bans').update({
      ban_reason: reasonVal || '违反社区规定',
      ban_duration_hours: duration_hours || 0,
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
      ban_duration_hours: duration_hours || 0,
      banned_by: ADMIN_USERNAME, expires_at: expiresAt, is_active: true
    }]);
    if (error) {
      if (error.code === '23505') {
        // 并发冲突，改为更新
        const { error: updErr } = await supabase.from('bans').update({
          ban_reason: reasonVal || '违反社区规定',
          ban_duration_hours: duration_hours || 0,
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

// ===================== 禁言管理 =====================
app.get('/admin/mutes', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('mutes').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ data });
});

app.post('/admin/mute', verifyToken, rateLimit(60000, 30), async (req, res) => {
  const { user_name, duration_hours, reason } = req.body;
  if (!user_name) return res.status(400).json({ error: '缺少用户名' });
  
  const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
  if (userNameVal && userNameVal.error) return res.status(400).json({ error: userNameVal.error });
  const reasonVal = validateString(reason, MAX_REASON_LEN, '原因');
  if (reasonVal && reasonVal.error) return res.status(400).json({ error: reasonVal.error });
  
  let expiresAt = null;
  if (duration_hours > 0) {
    expiresAt = new Date(Date.now() + duration_hours * 3600000).toISOString();
  }
  
  const { error } = await supabase.from('mutes').insert([{
    user_name: userNameVal,
    reason: reasonVal || '违反社区规定',
    duration_hours: duration_hours || 0,
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

// ===================== 黑名单管理 =====================
app.get('/admin/blacklist', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('blacklist').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ data });
});

app.post('/admin/blacklist', verifyToken, rateLimit(60000, 30), async (req, res) => {
  const { user_name, reason, duration_hours } = req.body;
  if (!user_name) return res.status(400).json({ error: '缺少用户名' });
  
  const userNameVal = validateString(user_name, MAX_USERNAME_LEN, '用户名');
  if (userNameVal && userNameVal.error) return res.status(400).json({ error: userNameVal.error });
  const reasonVal = validateString(reason, MAX_REASON_LEN, '原因');
  if (reasonVal && reasonVal.error) return res.status(400).json({ error: reasonVal.error });
  
  let expiresAt = null;
  if (duration_hours > 0) {
    expiresAt = new Date(Date.now() + duration_hours * 3600000).toISOString();
  }
  
  // 检查是否已在黑名单中
  const { data: existing } = await supabase.from('blacklist').select('id, is_active').eq('user_name', userNameVal);
  if (existing && existing.length) {
    const activeEntry = existing.find(e => e.is_active);
    if (activeEntry) return res.status(409).json({ error: '该用户已在黑名单中' });
    
    const { error } = await supabase.from('blacklist').update({
      reason: reasonVal || '违反社区规定',
      duration_hours: duration_hours || 0,
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
      duration_hours: duration_hours || 0,
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

// ===================== 举报管理 =====================
app.get('/admin/reports', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ data });
});

app.put('/admin/report/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const allowedStatuses = ['pending', 'reviewed', 'actioned', 'dismissed'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: '无效的状态值' });
  }
  const { error } = await supabase.from('reports').update({
    status, reviewed_at: new Date().toISOString(), reviewed_by: ADMIN_USERNAME
  }).eq('id', id);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ ok: true });
});

// ===================== 用户数据（只读） =====================
app.get('/admin/users', verifyToken, async (req, res) => {
  const { data, error } = await supabase.from('posts')
    .select('user_name, created_at')
    .eq('media_type', '__user_info__')
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) return res.status(400).json({ error: sanitizeError(error) });
  return res.json({ data });
});

// ===================== 启动 =====================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[xtj-admin-api] 运行在端口 ${port}`);
  console.log(`[xtj-admin-api] 管理员账号: ${ADMIN_USERNAME}`);
  console.log(`[xtj-admin-api] 密码已${ADMIN_PASSWORD ? '通过环境变量设置' : '【未设置！】'}`);
  console.log(`[xtj-admin-api] 允许的域名: ${ALLOWED_ORIGINS.join(', ')}`);
});