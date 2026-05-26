import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const SUPABASE_URL = "https://ithowxqignlhkwaykglt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0aG93eHFpZ25saGt3YXlrZ2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNzE1MTEsImV4cCI6MjA5Mjc0NzUxMX0.fNmh0HjNuIZaJTa56gMITwKpJMQfJ8mBN41HMhvyDDA";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const MARKER = '__photo_wall__';
const MAX = 1 * 1024 * 1024;
const MAX_DIM = 2048;

let done = 0, skip = 0, fail = 0, saved = 0;
const results = [];

function fmt(b) {
  if (!b && b !== 0) return '0 B';
  if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

function storagePath(url) {
  if (!url) return null;
  const m = url.match(/\/uploads\/(.+?)(?:\?|$)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function dl(url) {
  console.log(`    下载: ${url}`);
  try {
    const r = await fetch(url, { 
      timeout: 30000,
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!r.ok) {
      console.log(`    下载失败: HTTP ${r.status}`);
      return null;
    }
    const a = await r.arrayBuffer();
    console.log(`    下载成功: ${fmt(a.byteLength)}`);
    return { buf: Buffer.from(a), size: a.byteLength };
  } catch (e) {
    console.log(`    下载异常: ${e.message}`);
    return null;
  }
}

async function comp(buf, tgt) {
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) {
      return { buf: buf, size: buf.length, ok: false, rotated: false, reason: '无法读取图片' };
    }

    console.log(`    原始信息: ${meta.width}x${meta.height}, orientation=${meta.orientation || 'undefined'}, format=${meta.format}`);

    let pipeline = sharp(buf);
    let needsRotation = meta.orientation && meta.orientation > 1;
    let needsResize = meta.width > MAX_DIM || meta.height > MAX_DIM;
    let processed = false;
    
    if (needsRotation) {
      pipeline = pipeline.rotate();
      processed = true;
      console.log(`    自动旋转: orientation=${meta.orientation}`);
    }

    let width = meta.width;
    let height = meta.height;
    
    if (needsResize) {
      const ratio = MAX_DIM / Math.max(width, height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
      pipeline = pipeline.resize(width, height, { fit: 'inside', withoutEnlargement: true });
      processed = true;
      console.log(`    调整尺寸: ${meta.width}x${meta.height} -> ${width}x${height}`);
    }

    let q = 85, best = null, bestSz = Infinity;
    while (q >= 15) {
      const b = await pipeline.clone().jpeg({ quality: q, mozjpeg: true }).toBuffer();
      if (b.length <= tgt) {
        console.log(`    压缩成功: 质量=${q}, 大小=${fmt(b.length)}`);
        return { buf: b, size: b.length, ok: true, rotated: needsRotation, reason: '压缩成功' };
      }
      if (b.length < bestSz) { best = b; bestSz = b.length; }
      q -= 8;
    }
    if (best) {
      console.log(`    压缩到最小质量: 大小=${fmt(bestSz)}`);
      return { buf: best, size: bestSz, ok: processed || bestSz < buf.length, rotated: needsRotation, reason: processed ? '尺寸调整' : '质量压缩' };
    }
    return { buf: buf, size: buf.length, ok: processed, rotated: needsRotation, reason: processed ? '仅调整尺寸' : '无需处理' };
  } catch (e) {
    console.error('压缩错误:', e.message);
    return { buf: buf, size: buf.length, ok: false, rotated: false, reason: '压缩异常: ' + e.message };
  }
}

async function validate(url) {
  try {
    const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) return `HTTP ${r.status}`;
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length < 100) return '太小';
    const m = await sharp(b).metadata();
    return m.width > 0 ? `OK ${m.width}x${m.height} ${fmt(b.length)}` : '尺寸0';
  } catch(e) { return e.message; }
}

async function one(p, i) {
  const row = { i: i + 1, user: (p.user_name || '').slice(0, 12), before: 0, after: 0, saved: 0, status: '', chk: '', rotated: false, reason: '' };
  try {
    const pt = storagePath(p.media_url);
    if (!pt) { row.status = 'SKIP'; row.chk = '无路径'; skip++; return row; }

    console.log(`\n处理 #${i + 1}: ${pt}`);
    const d = await dl(p.media_url);
    if (!d) { row.status = 'FAIL'; row.chk = '下载失败'; fail++; return row; }

    row.before = d.size;
    
    const c = await comp(d.buf, MAX);
    row.rotated = c.rotated;
    row.reason = c.reason;
    
    if (!c.ok) {
      row.status = 'SKIP'; row.after = d.size; row.chk = c.reason;
      skip++; 
      console.log(`    跳过: ${c.reason}`);
      return row;
    }

    row.after = c.size;
    row.saved = d.size - c.size;
    saved += row.saved;

    console.log(`    上传到: ${pt}`);
    const up = await sb.storage.from('uploads').upload(pt, c.buf, { upsert: true, contentType: 'image/jpeg' });
    if (up.error) { 
      console.log(`    上传失败: ${up.error.message}`);
      row.status = 'FAIL'; row.chk = up.error.message; fail++; return row; 
    }

    row.chk = await validate(p.media_url);
    console.log(`    校验: ${row.chk}`);

    let ex = {};
    try { ex = p.content ? JSON.parse(p.content) : {}; } catch(_) {}
    ex.fileSize = c.size;
    const db = await sb.from('posts').update({ content: JSON.stringify(ex) }).eq('id', p.id);
    if (db.error) { 
      console.log(`    DB更新失败: ${db.error.message}`);
      row.status = 'FAIL'; row.chk = 'DB: ' + db.error.message; fail++; return row; 
    }

    row.status = 'OK';
    done++;
    console.log(`    完成! 节省: ${fmt(row.saved)}`);
  } catch(e) {
    console.log(`    异常: ${e.message}`);
    row.status = 'FAIL'; row.chk = e.message; fail++;
  }
  return row;
}

async function main() {
  console.log('查询照片墙数据...');
  const r = await sb.from('posts')
    .select('id,user_name,media_url,content,created_at')
    .eq('media_type', MARKER)
    .order('created_at', { ascending: false })
    .limit(500);
  if (r.error) { console.error('查询失败:', r.error.message); return; }

  const photos = (r.data || []).filter(p => p.media_url);
  console.log(`共 ${photos.length} 张照片\n`);

  for (let i = 0; i < photos.length; i++) {
    const row = await one(photos[i], i);
    results.push(row);
  }

  const total = photos.length;
  const ok = done, sk = skip, fl = fail;
  console.log(`\n========================================`);
  console.log(`  总计: ${total}  成功: ${ok}  跳过: ${sk}  失败: ${fl}`);
  console.log(`  总节省: ${fmt(saved)}`);
  console.log(`========================================\n`);

  console.log('完整报告:');
  console.log('#\t用户\t\t原始\t\t压缩后\t\t节省\t\t结果\t旋转\t原因');
  for (const row of results) {
    console.log(`${row.i}\t${row.user.padEnd(12)}\t${fmt(row.before).padStart(10)}\t${fmt(row.after).padStart(10)}\t${fmt(row.saved).padStart(10)}\t${row.status}\t${row.rotated ? '是' : ''}\t${row.reason}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });