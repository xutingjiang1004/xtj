#!/usr/bin/env node
'use strict';
// 把存量的「无盐 SHA-256 口令校验值」加盐封装成 scrypt（见 render-api/password-verifier.js 的说明）。
//
//   node scripts/wrap-legacy-password-hashes.js            演练（默认）：只读数据库，统计各种口令校验值各有多少条，不改任何东西
//   node scripts/wrap-legacy-password-hashes.js --apply    真改：把无盐 SHA-256 逐条封装成 scrypt:v1w:…
//   选项：--limit=N  最多封装 N 条（先试几条）
//
// 环境变量（与服务端同名）：SUPABASE_URL、SUPABASE_SERVICE_KEY。
//
// 安全性：
//   - 不需要也不会知道任何人的明文密码：包装值 = scrypt(旧 SHA-256 十六进制串, 随机盐)。登录时服务端用同样方式校验
//     （见 server.js 的 verifyAuthPassword），成功后仍然照旧升级成标准 scrypt。封装前后用户用同一个密码登录，没有任何感知。
//   - 每条记录「旧值相同才改」（update … where media_url = 旧值），并发的登录升级不会被覆盖，也不会写坏别人的记录。
//   - 只处理 media_type=__auth__ 且形如 64 位十六进制的记录；盐值随机，重复运行是安全的（已封装的不再处理）。
//   - 输出里只有数量，不打印任何校验值、用户名或密码。
//   - 先在 Render 部署带有 scrypt:v1w: 校验支持的版本，再运行本脚本：旧版本服务端不认识封装值，会让这些用户登录失败。
const PAGE = 500;

function classifyVerifier(value) {
  if (typeof value !== 'string' || !value) return 'empty';
  if (value.indexOf('scrypt:v1w:') === 0) return 'wrapped';
  if (value.indexOf('scrypt:v1:') === 0) return value.split(':').length === 7 ? 'scrypt' : 'scrypt_legacy_params';
  if (/^[a-f0-9]{32}:[a-f0-9]{64}$/i.test(value)) return 'pbkdf2';
  if (/^[a-f0-9]{64}$/i.test(value)) return 'raw_sha256';
  return 'other';
}

function parseArgs(argv) {
  const args = { apply: false, limit: Infinity };
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true;
    else if (/^--limit=\d+$/.test(arg)) args.limit = Number(arg.slice(8));
    else throw new Error('未知参数：' + arg);
  }
  return args;
}

// deps: { listAuthRows(afterId, limit) → [{id, media_url}], swap(id, from, to) → boolean, wrap(rawHex) → Promise<string> }
async function run(deps, options) {
  const opts = options || {};
  const counts = { total: 0, empty: 0, wrapped: 0, scrypt: 0, scrypt_legacy_params: 0, pbkdf2: 0, raw_sha256: 0, other: 0 };
  const result = { counts, apply: !!opts.apply, wrapped_now: 0, skipped_changed: 0, failed: 0, limited: false };
  let after = '';
  const limit = opts.limit === undefined ? Infinity : opts.limit;
  while (true) {
    const rows = await deps.listAuthRows(after, PAGE);
    for (const row of rows) {
      counts.total++;
      const kind = classifyVerifier(row.media_url);
      counts[kind]++;
      if (kind !== 'raw_sha256' || !opts.apply) continue;
      if (result.wrapped_now >= limit) { result.limited = true; continue; }
      try {
        const wrapped = await deps.wrap(row.media_url);
        if (await deps.swap(row.id, row.media_url, wrapped)) result.wrapped_now++;
        else result.skipped_changed++; // 期间被登录升级或别的写入改过，下次再看
      } catch (_) { result.failed++; }
    }
    if (rows.length < PAGE) break;
    after = rows[rows.length - 1].id;
  }
  // 演练时「还剩多少」就是 raw_sha256；真改后再读一遍才是准确值，所以这里只报告本次动作。
  result.remaining_raw_sha256 = opts.apply ? counts.raw_sha256 - result.wrapped_now : counts.raw_sha256;
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { console.error('需要环境变量 SUPABASE_URL 和 SUPABASE_SERVICE_KEY'); process.exit(2); }
  const { createClient } = require('@supabase/supabase-js');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { wrapLegacyVerifier } = require('../render-api/password-verifier');
  const deps = {
    async listAuthRows(after, limit) {
      let query = db.from('posts').select('id,media_url').eq('media_type', '__auth__').order('id', { ascending: true }).limit(limit);
      if (after) query = query.gt('id', after);
      const { data, error } = await query;
      if (error) throw new Error('读取账号记录失败：' + (error.code || error.message));
      return data || [];
    },
    wrap: raw => wrapLegacyVerifier(raw),
    async swap(id, from, to) {
      const { data, error } = await db.from('posts').update({ media_url: to }).eq('id', id).eq('media_type', '__auth__').eq('media_url', from).select('id');
      if (error) throw new Error('写入失败：' + (error.code || error.message));
      return Array.isArray(data) && data.length === 1;
    }
  };
  console.log(args.apply ? '【真改】封装无盐 SHA-256 口令校验值' : '【演练】只统计，不修改任何数据（加 --apply 才会真改）');
  const result = await run(deps, { apply: args.apply, limit: args.limit });
  console.log(JSON.stringify(result, null, 2));
  if (!args.apply && result.counts.raw_sha256 > 0) console.log('\n有 ' + result.counts.raw_sha256 + ' 条无盐 SHA-256，确认服务端已部署后加 --apply 封装。');
  if (result.failed) process.exitCode = 1;
}

module.exports = { classifyVerifier, parseArgs, run, PAGE };
if (require.main === module) main().catch(error => { console.error(error.message || error); process.exit(1); });
