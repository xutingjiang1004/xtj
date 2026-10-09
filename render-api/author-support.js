'use strict';
const crypto = require('node:crypto');
const DISCLAIMER = '打赏完全自愿，金额由你自行决定，用于感谢作者对本站的开发与维护。打赏不对应任何商品、付费服务或权益承诺，请确认收款人后量力而行。感谢你的支持。';
const PROVIDERS = new Set(['wechat', 'alipay']);
function createAuthorSupport({ express, supabase, sharp, authenticateUser, verifyToken, rateLimit, adminName }) {
  const router = express.Router();
  let writes = Promise.resolve();
  const storage = () => supabase.storage.from('uploads');
  async function result(query) { const r = await query; if (!r || r.error) throw new Error('support_storage_failed'); return r.data; }
  async function read() {
    const rows = await result(supabase.from('posts').select('id,content').eq('media_type','__admin_meta__')
      .eq('user_name',adminName).eq('media_url','author_support').order('created_at',{ascending:false}).limit(1));
    const row = rows && rows[0];
    let codes = {}; try { codes = JSON.parse(row && row.content || '{}'); } catch (_) {}
    if (!codes || typeof codes!=='object' || Array.isArray(codes)) codes={};
    return { row, codes };
  }
  function publicConfig(codes) {
    const out = { ok:true, author:adminName, disclaimer:DISCLAIMER, wechat_url:null, alipay_url:null };
    for (const provider of PROVIDERS) {
      const path = codes[provider];
      if (typeof path === 'string' && /^site-support\/(wechat|alipay)_[a-f0-9-]+\.(png|jpg|webp)$/.test(path)) {
        out[provider + '_url'] = '/api/uploads/media?path=' + encodeURIComponent(path);
      }
    }
    return out;
  }
  async function get(req,res) {
    try { res.setHeader('Cache-Control','no-store'); res.json(publicConfig((await read()).codes)); }
    catch (_) { res.status(503).json({ok:false,error:'收款码暂时无法加载，请重试'}); }
  }
  router.get('/api/chat/author-support', authenticateUser, rateLimit(60000,60), get);
  router.get('/admin/author-support', verifyToken, get);
  router.post('/admin/author-support', verifyToken, rateLimit(60000,10), async (req,res) => {
    const provider = req.body && req.body.provider, raw = req.body && req.body.image;
    if (!PROVIDERS.has(provider) || typeof raw !== 'string' || raw.length > 3 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
      return res.status(400).json({ok:false,error:'请选择微信或支付宝收款码，图片不超过 2MB'});
    }
    const bytes = Buffer.from(raw,'base64');
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) return res.status(400).json({ok:false,error:'图片不超过 2MB'});
    let meta;
    try { meta = await sharp(bytes,{limitInputPixels:16000000}).metadata(); }
    catch (_) { return res.status(400).json({ok:false,error:'无法读取收款码图片'}); }
    if (!['png','jpeg','webp'].includes(meta.format) || (meta.pages || 1) > 1) return res.status(400).json({ok:false,error:'收款码请使用静态 PNG、JPEG 或 WebP 图片'});
    const path = 'site-support/' + provider + '_' + crypto.randomUUID() + '.' + (meta.format === 'jpeg' ? 'jpg' : meta.format);
    const save = async () => {
      const { row, codes } = await read();
      await result(storage().upload(path,bytes,{contentType:'image/' + meta.format,upsert:false,cacheControl:'31536000'}));
      const next = { ...codes, [provider]:path };
      try {
        await result(row ? supabase.from('posts').update({content:JSON.stringify(next)}).eq('id',row.id)
          : supabase.from('posts').insert({user_name:adminName,media_type:'__admin_meta__',media_url:'author_support',actor_key:'author_support',content:JSON.stringify(next)}));
      } catch (error) { await storage().remove([path]).catch(()=>{}); throw error; }
      // Unique URLs make replacement immediate without a stale CDN QR code.
      if (codes[provider] && /^site-support\//.test(codes[provider])) await storage().remove([codes[provider]]).catch(()=>{});
      return publicConfig(next);
    };
    const pending = writes.then(save); writes = pending.catch(()=>{});
    try { res.json(await pending); }
    catch (_) { res.status(503).json({ok:false,error:'收款码保存失败，请重试'}); }
  });
  return router;
}
module.exports = { createAuthorSupport, DISCLAIMER };
