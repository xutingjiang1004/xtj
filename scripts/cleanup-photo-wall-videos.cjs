// ============================================================================
// ⚠️ 一次性补丁/诊断脚本 —— 请勿重跑
// ----------------------------------------------------------------------------
// 本脚本针对特定历史代码状态编写（部分以源码行号偏移 + 字符串锚点改写
// js/* 与 js/core-parts/*），对应改动已合入当前源码；直接重跑可能因锚点
// 失效而报错或静默误改源码。请仅作历史排查参考，使命完成后可移入
// scripts/archive/。
// ============================================================================

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PHOTO_WALL_MARKER = '__photo_wall__';
const PAGE_SIZE = 200;

const ROOT = path.resolve(__dirname, '..');

function loadEnvFromFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // strip 首尾引号（.env 中值常带单/双引号）
    if (value.length >= 2 && ((value[0] === '"' && value[value.length - 1] === '"') || (value[0] === "'" && value[value.length - 1] === "'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] == null) process.env[key] = value;
  });
}

function loadRuntimeEnv() {
  // 基于 __dirname 锚定仓库根，避免从任意 cwd 运行时报错
  loadEnvFromFile(path.join(__dirname, '..', 'render-api', '.env'));
  loadEnvFromFile(path.join(__dirname, '..', '.env'));
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

function extractStoragePath(url, supabaseUrl) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    // host 校验前置：仅接受项目 Storage 域名下的链接（与 /uploads/ 兜底正则的
    // 校验一致），外部 URL 即使命中 /object/public/uploads/ 模式也返回 null，
    // 防止反向引用归零时误删桶内与外部链接同名的文件。
    if (supabaseUrl) {
      const expectedHost = new URL(supabaseUrl).host;
      if (parsed.host !== expectedHost) return null;
    }
    // 标准 Supabase 公开桶路径
    const match = parsed.pathname.match(/\/object\/public\/uploads\/(.*)$/);
    if (match && match[1]) return decodeURIComponent(match[1]);
    // /uploads/ 兜底正则仅在与 SUPABASE_URL 同 host 时使用，避免误删外部链接
    const fallback = parsed.pathname.match(/\/uploads\/(.*)$/);
    return fallback && fallback[1] ? decodeURIComponent(fallback[1]) : null;
  } catch (_) {
    return null;
  }
}

function collectStoragePaths(row, supabaseUrl) {
  const paths = [];
  const content = parseContent(row.content);
  [row.media_url, content.thumb, content.thumbUrl].forEach((value) => {
    const storagePath = extractStoragePath(value, supabaseUrl);
    if (storagePath) paths.push(storagePath);
  });
  return paths;
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
      // 复合稳定排序：created_at 相同时按 id 稳定分页
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    const batch = Array.isArray(data) ? data : [];
    rows.push.apply(rows, batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

// 全表反向引用扫描：分页读取全部 posts 行（不限 media_type），统计每个存储路径的引用数
async function fetchAllRows(supabase) {
  const rows = [];
  for (let page = 0; ; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('posts')
      .select('id,media_url,content')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    const batch = Array.isArray(data) ? data : [];
    rows.push.apply(rows, batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

// 只读解析仓库 HEAD（不执行 git 命令，兼容非 git 部署目录）
function readRepoHead() {
  try {
    const gitDir = path.join(ROOT, '.git');
    const headFile = path.join(gitDir, 'HEAD');
    if (!fs.existsSync(headFile)) return null;
    const headContent = fs.readFileSync(headFile, 'utf8').trim();
    const refMatch = headContent.match(/^ref:\s*(.+)$/);
    if (refMatch) {
      const refPath = path.join(gitDir, refMatch[1]);
      if (!fs.existsSync(refPath)) return null;
      return fs.readFileSync(refPath, 'utf8').trim();
    }
    return /^[0-9a-f]+$/i.test(headContent) ? headContent : null;
  } catch (_) {
    return null;
  }
}

function isCommitRef(value) {
  return /^[0-9a-f]{40}$/.test(value) || /^[0-9a-f]{64}$/.test(value);
}

async function main() {
  // 默认 dry-run；真实删除需 --apply 且 --confirm 精确匹配当前仓库 HEAD（二次确认）
  const APPLY = process.argv.includes('--apply');
  const confirmArg = process.argv.find((a) => a.indexOf('--confirm=') === 0);
  const confirmRef = confirmArg ? confirmArg.slice('--confirm='.length) : '';
  const repoHead = readRepoHead();
  let confirmOk = APPLY && isCommitRef(confirmRef);
  if (repoHead && confirmOk) confirmOk = confirmRef === repoHead;
  if (!confirmOk) {
    console.log('[DRY-RUN] 默认安全模式：仅预览，不执行实际删除操作。');
    if (repoHead) {
      console.log('[DRY-RUN] 执行真实删除需：--apply --confirm=' + repoHead + '（当前仓库 HEAD）');
    } else {
      console.log('[DRY-RUN] 执行真实删除需：--apply --confirm=<40/64 位 git commit 哈希>');
    }
    if (APPLY && confirmRef && !isCommitRef(confirmRef)) {
      console.log('[DRY-RUN] 提示：--confirm 必须是 commit 哈希格式，已拒绝非哈希值。');
    }
    if (repoHead && confirmRef && isCommitRef(confirmRef) && confirmRef !== repoHead) {
      console.log('[DRY-RUN] 提示：--confirm 与当前 HEAD 不一致（HEAD=' + repoHead + '），已拒绝执行。');
    }
  }
  const dryRun = !confirmOk;

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

  // 全表反向引用扫描：统计每个存储路径被多少行引用
  const refCounts = new Map();
  const allRows = await fetchAllRows(supabase);
  allRows.forEach((row) => {
    collectStoragePaths(row, supabaseUrl).forEach((p) => {
      refCounts.set(p, (refCounts.get(p) || 0) + 1);
    });
  });
  const targetRefs = new Map();
  targets.forEach((row) => {
    collectStoragePaths(row, supabaseUrl).forEach((p) => {
      targetRefs.set(p, (targetRefs.get(p) || 0) + 1);
    });
  });

  // 仅删除删除这些行后引用计数归零的对象；仍被其他行引用的文件保留
  const storagePaths = new Set();
  const skippedFilePaths = [];
  targets.forEach((row) => {
    collectStoragePaths(row, supabaseUrl).forEach((p) => {
      const remaining = (refCounts.get(p) || 0) - (targetRefs.get(p) || 0);
      if (remaining > 0) {
        skippedFilePaths.push(p + ' :: still referenced by ' + remaining + ' other row(s)');
      } else {
        storagePaths.add(p);
      }
    });
  });
  const fileList = Array.from(storagePaths);

  const summary = {
    matchedRows: targets.length,
    deletedRows: 0,
    failedRows: 0,
    deletedFiles: 0,
    failedFiles: 0,
    skippedFiles: skippedFilePaths.length,
    failedRowIds: [],
    failedFilePaths: [],
    skippedFilePaths: skippedFilePaths
  };

  // 执行前把 targets 导出为带时间戳的 JSON 备份文件
  const backupFile = path.join(
    ROOT,
    'backups',
    'photo-wall-cleanup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'
  );
  const backupData = {
    exportedAt: new Date().toISOString(),
    dryRun: dryRun,
    confirmRef: confirmRef,
    targetCount: targets.length,
    fileCount: fileList.length,
    targets: targets.map((row) => ({
      id: row.id,
      media_url: row.media_url,
      content: row.content,
      created_at: row.created_at
    }))
  };
  fs.mkdirSync(path.dirname(backupFile), { recursive: true });
  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf8');
  console.log('[BACKUP] targets exported to ' + backupFile);

  if (dryRun) {
    console.log('[DRY-RUN] 将删除 ' + fileList.length + ' 个存储文件:');
    fileList.forEach((f) => console.log('  ' + f));
    if (skippedFilePaths.length) {
      console.log('[DRY-RUN] 跳过 ' + skippedFilePaths.length + ' 个仍被其他行引用的文件:');
      skippedFilePaths.forEach((f) => console.log('  ' + f));
    }
  } else {
    for (let i = 0; i < fileList.length; i += 100) {
      const chunk = fileList.slice(i, i + 100);
      if (!chunk.length) continue;
      const { data, error } = await supabase.storage.from('uploads').remove(chunk);
      if (error) {
        summary.failedFiles += chunk.length;
        summary.failedFilePaths.push.apply(summary.failedFilePaths, chunk.map((item) => item + ' :: ' + error.message));
        continue;
      }
      // 按真实返回项构造 Set 求差集，避免 data 顺序/部分返回导致的误判
      const removedSet = new Set(
        (Array.isArray(data) ? data : [])
          .map((item) => (typeof item === 'string' ? item : item && item.name))
          .filter(Boolean)
      );
      summary.deletedFiles += removedSet.size;
      const unresolved = chunk.filter((f) => !removedSet.has(f));
      if (unresolved.length) {
        summary.failedFiles += unresolved.length;
        summary.failedFilePaths.push.apply(summary.failedFilePaths, unresolved.map((item) => item + ' :: not confirmed removed'));
      }
    }
  } // end if (!dryRun) for storage deletion

  if (dryRun) {
    console.log('[DRY-RUN] 将删除 ' + targets.length + ' 条 posts 记录');
  } else {
    for (const row of targets) {
      const { error } = await supabase.from('posts').delete().eq('id', row.id);
      if (error) {
        summary.failedRows += 1;
        summary.failedRowIds.push(String(row.id) + ' :: ' + error.message);
      } else {
        summary.deletedRows += 1;
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.failedRows || summary.failedFiles) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
