import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const SUPABASE_URL = "https://ithowxqignlhkwaykglt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0aG93eHFpZ25saGt3YXlrZ2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNzE1MTEsImV4cCI6MjA5Mjc0NzUxMX0.fNmh0HjNuIZaJTa56gMITwKpJMQfJ8mBN41HMhvyDDA";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const MARKER = '__photo_wall__';
const MAX = 1 * 1024 * 1024;

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
  const r = await fetch(url);
  if (!r.ok) return null;
  const a = await r.arrayBuffer();
  return { buf: Buffer.from(a), size: a.byteLength };
}

async function comp(buf, tgt) {
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) return { buf, size: buf.length, ok: false };
  let q = 85, best = null, bestSz = Infinity;
  while (q >= 15) {
    const b = await sharp(buf).jpeg({ quality: q, mozjpeg: true }).toBuffer();
    if (b.length <= tgt) return { buf: b, size: b.length, ok: b.length < buf.length };
    if (b.length < bestSz) { best = b; bestSz = b.length; }
    q -= 12;
  }
  if (best) return { buf: best, size: bestSz, ok: bestSz < buf.length };
  return { buf, size: buf.length, ok: false };
}

async function validate(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return `HTTP ${r.status}`;
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length < 100) return '太小';
    const m = await sharp(b).metadata();
    return m.width > 0 ? `OK ${m.width}x${m.height} ${fmt(b.length)}` : '尺寸0';
  } catch(e) { return e.message; }
}

async function one(p, i) {
  const row = { i: i + 1, user: (p.user_name || '').slice(0, 12), before: 0, after: 0, saved: 0, status: '', chk: '' };
  try {
    const pt = storagePath(p.media_url);
    if (!pt) { row.status = 'SKIP'; row.chk = '无路径'; skip++; return row; }

    const d = await dl(p.media_url);
    if (!d) { row.status = 'FAIL'; row.chk = '下载失败'; fail++; return row; }

    row.before = d.size;
    if (d.size <= MAX) {
      row.status = 'SKIP'; row.after = d.size; row.chk = '≤1MB';
      skip++; return row;
    }

    process.stdout.write(`  [${i + 1}] ${fmt(d.size)} → 压缩中...\r`);
    const c = await comp(d.buf, MAX);
    row.after = c.size;
    row.saved = d.size - c.size;
    saved += row.saved;

    const up = await sb.storage.from('uploads').upload(pt, c.buf, { upsert: true, contentType: 'image/jpeg' });
    if (up.error) { row.status = 'FAIL'; row.chk = up.error.message; fail++; return row; }

    row.chk = await validate(p.media_url);

    let ex = {};
    try { ex = p.content ? JSON.parse(p.content) : {}; } catch(_) {}
    ex.fileSize = c.size;
    const db = await sb.from('posts').update({ content: JSON.stringify(ex) }).eq('id', p.id);
    if (db.error) { row.status = 'FAIL'; row.chk = 'DB: ' + db.error.message; fail++; return row; }

    row.status = 'OK';
    done++;
  } catch(e) {
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
    const mark = row.status === 'OK' ? '✓' : (row.status === 'SKIP' ? '-' : '✗');
    console.log(`  ${mark} #${row.i} ${row.user.padEnd(12)} ${fmt(row.before).padStart(10)} → ${fmt(row.after).padStart(10)} | ${row.status === 'OK' ? '节省 ' + fmt(row.saved).padStart(8) : ''}${row.status === 'OK' ? '' : '  ' + row.chk}`);
  }

  const total = photos.length;
  const ok = done, sk = skip, fl = fail;
  console.log(`\n========================================`);
  console.log(`  总计: ${total}  成功: ${ok}  跳过: ${sk}  失败: ${fl}`);
  console.log(`  总节省: ${fmt(saved)}`);
  console.log(`========================================\n`);

  // Report
  console.log('完整报告:');
  console.log('#\t用户\t\t原始\t\t压缩后\t\t结果\t校验');
  for (const row of results) {
    console.log(`${row.i}\t${row.user.padEnd(12)}\t${fmt(row.before).padStart(10)}\t${fmt(row.after).padStart(10)}\t${row.status}\t${row.chk}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
