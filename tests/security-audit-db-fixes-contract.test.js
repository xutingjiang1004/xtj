'use strict';
// 文本契约测试：锁定 2026-11-16 安全审计数据库修复迁移的关键锚点。
// 本环境无本地 Postgres（XTJ_TEST_DATABASE_URL 未设置），db 测试会 skip，
// 因此用源码锚点断言防止修复被误删/回退；SQL 语义由线上 Supabase 执行保证。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migPath = path.join(root, 'supabase', 'migrations', '20261116000000_security_audit_db_fixes.sql');
const mig = fs.readFileSync(migPath, 'utf8');
const server = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');

test('DB 修复迁移：comment 新签名 search_path 依赖 pgcrypto 实际 schema', () => {
  assert.match(mig, /pg_get_function_identity_arguments\(p\.oid\) = 'bytea'/);
  assert.match(mig, /xtj_create_comment\(uuid,text,text,uuid,text,bigint\)/);
  assert.match(mig, /ALTER FUNCTION public\.xtj_create_comment\(uuid,text,text,uuid,text,bigint\) SET search_path = pg_catalog, %I/);
});

test('DB 修复迁移：chat_group_detail 在 admins 策略下隐藏 qr_token', () => {
  assert.match(mig, /CREATE OR REPLACE FUNCTION public\.chat_group_detail\(p_actor TEXT, p_group UUID\)/);
  assert.match(mig, /'qr_token', CASE WHEN v_g\.invite_policy = 'admins' AND v_m\.role NOT IN \('owner','admin'\) THEN NULL ELSE v_g\.qr_token END/);
  // 权限重申不能丢
  assert.match(mig, /GRANT EXECUTE ON FUNCTION public\.chat_group_detail\(text,uuid\) TO service_role/);
});

test('DB 修复迁移：保持幂等与 schema reload', () => {
  assert.match(mig, /^BEGIN;/m);
  assert.match(mig, /NOTIFY pgrst, 'reload schema'/);
  assert.match(mig, /^COMMIT;/m);
});

test('aiSiteSearch photos 未删除过滤独立于关键词 or()', () => {
  const pStart = server.indexOf("} else if (source === 'photos') {");
  const pEnd = server.indexOf("} else if (source === 'dm') {", pStart);
  assert.ok(pStart > 0 && pEnd > pStart, 'photos 分支定位失败');
  const branch = server.slice(pStart, pEnd);
  assert.match(branch, /\.eq\('is_deleted', false\)/);
  assert.doesNotMatch(branch, /\.or\('is_deleted\.is\.null,is_deleted\.eq\.false'\)/);
});
