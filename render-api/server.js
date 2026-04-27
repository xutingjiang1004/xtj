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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`render api on :${port}`));
