// 可选：部署到 Render 的 API（防刷加强版）。
// 生产建议：前端只调这个 API，避免匿名写库。
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

app.get('/health', (_, res) => res.json({ ok: true }));

app.post('/like', async (req, res) => {
  const { post_id, user_name, actor_key } = req.body;
  const { error } = await supabase.from('likes').insert([{ post_id, user_name, actor_key }]);
  if (error && error.code === '23505') return res.status(409).json({ error: 'duplicate' });
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true });
});

// =============================================
// 举报 API
// =============================================
app.post('/report', async (req, res) => {
  const { reporter_name, target_type, target_id, target_user, report_category, report_reason, evidence_url } = req.body;
  if (!reporter_name || !target_type || !target_id || !report_category) {
    return res.status(400).json({ error: '缺少必填字段' });
  }
  const { data, error } = await supabase.from('reports').insert([{
    reporter_name, target_type, target_id,
    target_user: target_user || '',
    report_category, report_reason: report_reason || '',
    evidence_url: evidence_url || '',
    status: 'pending'
  }]).select().single();
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true, data });
});

app.get('/reports', async (req, res) => {
  const { status, limit, offset } = req.query;
  let query = supabase.from('reports').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (limit) query = query.limit(parseInt(limit));
  if (offset) query = query.range(parseInt(offset), parseInt(offset) + (parseInt(limit) || 50) - 1);
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ data });
});

app.put('/report/:id', async (req, res) => {
  const { id } = req.params;
  const { status, admin_note, reviewed_by } = req.body;
  const updates = { status, reviewed_at: new Date().toISOString() };
  if (admin_note) updates.admin_note = admin_note;
  if (reviewed_by) updates.reviewed_by = reviewed_by;
  const { data, error } = await supabase.from('reports').update(updates).eq('id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true, data });
});

// =============================================
// 封禁 API
// =============================================
app.post('/ban', async (req, res) => {
  const { user_name, ban_type, ban_reason, ban_duration_hours, banned_by } = req.body;
  if (!user_name || !ban_type) return res.status(400).json({ error: '缺少必填字段' });
  const expires_at = ban_type === 'temporary' && ban_duration_hours
    ? new Date(Date.now() + ban_duration_hours * 3600000).toISOString() : null;
  const { data, error } = await supabase.from('bans').insert([{
    user_name, ban_type, ban_reason: ban_reason || '违反社区规定',
    ban_duration_hours: ban_type === 'temporary' ? (ban_duration_hours || 24) : 0,
    banned_by: banned_by || 'admin', expires_at, is_active: true
  }]).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: '该用户已被封禁' });
    return res.status(400).json({ error: error.message });
  }
  return res.json({ ok: true, data });
});

app.get('/bans', async (req, res) => {
  const { active_only, limit } = req.query;
  let query = supabase.from('bans').select('*').order('banned_at', { ascending: false });
  if (active_only === 'true') query = query.eq('is_active', true);
  if (limit) query = query.limit(parseInt(limit));
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ data });
});

app.put('/ban/:id/unban', async (req, res) => {
  const { id } = req.params;
  const { lifted_by } = req.body;
  const { data, error } = await supabase.from('bans').update({
    is_active: false, lifted_at: new Date().toISOString(), lifted_by: lifted_by || 'admin'
  }).eq('id', id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true, data });
});

app.get('/ban/check/:user_name', async (req, res) => {
  const { user_name } = req.params;
  const { data } = await supabase.from('bans').select('*')
    .eq('user_name', user_name).eq('is_active', true).maybeSingle();
  if (!data) return res.json({ banned: false });
  const isExpired = data.expires_at && new Date(data.expires_at) <= new Date();
  if (isExpired) {
    await supabase.from('bans').update({ is_active: false, lifted_at: new Date().toISOString(), lifted_by: 'system' }).eq('id', data.id);
    return res.json({ banned: false });
  }
  return res.json({ banned: true, ban_type: data.ban_type, expires_at: data.expires_at, reason: data.ban_reason });
});

// =============================================
// 黑名单 API
// =============================================
app.post('/blacklist', async (req, res) => {
  const { user_name, reason, added_by } = req.body;
  if (!user_name) return res.status(400).json({ error: '缺少用户名' });
  const { data, error } = await supabase.from('blacklist').insert([{
    user_name, reason: reason || '', added_by: added_by || 'admin'
  }]).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: '该用户已在黑名单中' });
    return res.status(400).json({ error: error.message });
  }
  return res.json({ ok: true, data });
});

app.get('/blacklist', async (req, res) => {
  const { data, error } = await supabase.from('blacklist').select('*').order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ data });
});

app.delete('/blacklist/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('blacklist').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true });
});

app.get('/blacklist/check/:user_name', async (req, res) => {
  const { user_name } = req.params;
  const { data } = await supabase.from('blacklist').select('*').eq('user_name', user_name).maybeSingle();
  return res.json({ blacklisted: !!data, data });
});

// =============================================
// 照片管理 API
// =============================================
app.get('/photos', async (req, res) => {
  const { user_name, album_date, sort, limit, offset } = req.query;
  let query = supabase.from('photos').select('*');
  if (user_name) query = query.eq('user_name', user_name);
  if (album_date) query = query.eq('album_date', album_date);
  const sortField = sort === 'name' ? 'original_name' : sort === 'size' ? 'file_size' : 'created_at';
  query = query.order(sortField, { ascending: sort === 'name' || sort === 'date_asc' });
  if (limit) query = query.limit(parseInt(limit));
  if (offset) query = query.range(parseInt(offset), parseInt(offset) + (parseInt(limit) || 50) - 1);
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ data });
});

app.post('/photos', async (req, res) => {
  const { user_name, storage_path, public_url, original_name, file_size, mime_type, album_date, is_cover } = req.body;
  if (!user_name || !storage_path) return res.status(400).json({ error: '缺少必填字段' });
  const { data, error } = await supabase.from('photos').insert([{
    user_name, storage_path, public_url: public_url || '',
    original_name: original_name || '', file_size: file_size || 0,
    mime_type: mime_type || 'image/jpeg', album_date: album_date || '',
    is_cover: !!is_cover
  }]).select().single();
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true, data });
});

app.delete('/photos/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('photos').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true });
});

// =============================================
// 分页帖子 API
// =============================================
app.get('/posts/page', async (req, res) => {
  const { page, page_size } = req.query;
  const p = parseInt(page) || 0;
  const ps = parseInt(page_size) || 20;
  const from = p * ps;
  const to = from + ps - 1;
  const { data, error } = await supabase.from('posts')
    .select('*')
    .neq('media_type', '__avatar__')
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ data, page: p, page_size: ps, has_more: data && data.length >= ps });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`render api on :${port}`));