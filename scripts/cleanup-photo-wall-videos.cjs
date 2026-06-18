const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PHOTO_WALL_MARKER = '__photo_wall__';
const PAGE_SIZE = 200;

function loadEnvFromFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] == null) process.env[key] = value;
  });
}

function loadRuntimeEnv() {
  loadEnvFromFile(path.join(process.cwd(), 'render-api', '.env'));
  loadEnvFromFile(path.join(process.cwd(), '.env'));
}

function parseContent(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function isPhotoWallVideoRow(row) {
  const content = parseContent(row && row.content);
  const mediaKind = String(content.mediaKind || content.kind || '').toLowerCase();
  const mimeType = String(content.mimeType || row && row.mime_type || '').toLowerCase();
  return mediaKind === 'video' || /^video\//.test(mimeType);
}

function extractStoragePath(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/object\/public\/uploads\/(.*)$/) || parsed.pathname.match(/\/uploads\/(.*)$/);
    return match && match[1] ? decodeURIComponent(match[1]) : null;
  } catch (_) {
    return null;
  }
}

async function fetchPhotoWallRows(supabase) {
  const rows = [];
  for (let page = 0; ; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('posts')
      .select('id,media_url,content,created_at')
      .eq('media_type', PHOTO_WALL_MARKER)
      .order('created_at', { ascending: true })
      .range(from, to);
    if (error) throw error;
    const batch = Array.isArray(data) ? data : [];
    rows.push.apply(rows, batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

async function main() {
  loadRuntimeEnv();
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Set them before running this cleanup.');
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const rows = await fetchPhotoWallRows(supabase);
  const targets = rows.filter(isPhotoWallVideoRow);
  const storagePaths = new Set();
  targets.forEach((row) => {
    const content = parseContent(row.content);
    [row.media_url, content.thumb, content.thumbUrl].forEach((value) => {
      const storagePath = extractStoragePath(value);
      if (storagePath) storagePaths.add(storagePath);
    });
  });

  const summary = {
    matchedRows: targets.length,
    deletedRows: 0,
    failedRows: 0,
    deletedFiles: 0,
    failedFiles: 0,
    failedRowIds: [],
    failedFilePaths: []
  };

  const fileList = Array.from(storagePaths);
  for (let i = 0; i < fileList.length; i += 100) {
    const chunk = fileList.slice(i, i + 100);
    if (!chunk.length) continue;
    const { data, error } = await supabase.storage.from('uploads').remove(chunk);
    if (error) {
      summary.failedFiles += chunk.length;
      summary.failedFilePaths.push.apply(summary.failedFilePaths, chunk.map((item) => item + ' :: ' + error.message));
      continue;
    }
    const removedCount = Array.isArray(data) ? data.length : chunk.length;
    summary.deletedFiles += removedCount;
    if (removedCount < chunk.length) {
      const unresolved = chunk.slice(removedCount);
      summary.failedFiles += unresolved.length;
      summary.failedFilePaths.push.apply(summary.failedFilePaths, unresolved.map((item) => item + ' :: not confirmed removed'));
    }
  }

  for (const row of targets) {
    const { error } = await supabase.from('posts').delete().eq('id', row.id);
    if (error) {
      summary.failedRows += 1;
      summary.failedRowIds.push(String(row.id) + ' :: ' + error.message);
    } else {
      summary.deletedRows += 1;
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.failedRows || summary.failedFiles) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
