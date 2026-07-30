'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { dbResult, classifySupabaseError, NON_RETRYABLE_CODES } = require('../render-api/db-result');
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');

function routeSource(method, route, nextRoute) {
  const startToken = `app.${method}('${route}'`;
  const start = serverSrc.indexOf(startToken);
  assert.notEqual(start, -1, `missing ${method.toUpperCase()} ${route}`);
  const end = nextRoute ? serverSrc.indexOf(nextRoute, start + startToken.length) : serverSrc.length;
  assert.ok(end > start, `could not isolate ${route}`);
  return serverSrc.slice(start, end);
}

function sliceFn(name) {
  const startTok = `async function ${name}(`;
  const start = serverSrc.indexOf(startTok);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = serverSrc.indexOf('\n}', start + startTok.length);
  assert.ok(end > start, `could not isolate ${name}`);
  return serverSrc.slice(start, end + 2);
}

// ===================== dbResult 契约 =====================

test('dbResult 成功路径返回 ok=true 且无错误', () => {
  const r = dbResult('insert_security_alert', 1, 1, 0);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.partial, false);
  assert.strictEqual(r.operation, 'insert_security_alert');
  assert.strictEqual(r.attempted, 1);
  assert.strictEqual(r.succeeded, 1);
  assert.strictEqual(r.failed, 0);
  assert.strictEqual(r.retryable, false);
  assert.strictEqual(r.error, null);
});

test('dbResult 失败路径返回 ok=false 且带错误对象', () => {
  const r = dbResult('log_admin_audit', 1, 0, 1, {
    retryable: true,
    error: { code: 'CATCH_ERROR', message: 'boom' }
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.partial, false);
  assert.strictEqual(r.attempted, 1);
  assert.strictEqual(r.succeeded, 0);
  assert.strictEqual(r.failed, 1);
  assert.strictEqual(r.retryable, true);
  assert.deepStrictEqual(r.error, { code: 'CATCH_ERROR', message: 'boom' });
});

test('dbResult partial 路径表示部分成功', () => {
  const r = dbResult('cleanup_old_logs:login', 100, 80, 20);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.partial, true);
  assert.strictEqual(r.attempted, 100);
  assert.strictEqual(r.succeeded, 80);
  assert.strictEqual(r.failed, 20);
});

test('dbResult 含 error 时不算 partial (partial 仅用于无错时)', () => {
  const r = dbResult('cleanup_old_logs:security', 100, 50, 50, {
    retryable: false,
    error: { code: '23505', message: 'duplicated' }
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.partial, false);
});

// ===================== classifySupabaseError =====================

test('classifySupabaseError 把 23505 unique_violation 标为不可重试', () => {
  const r = classifySupabaseError({ code: '23505', message: 'duplicate key' });
  assert.strictEqual(r.retryable, false);
  assert.strictEqual(r.error.code, '23505');
});

test('classifySupabaseError 把 42501 insufficient_privilege 标为不可重试', () => {
  const r = classifySupabaseError({ code: '42501', message: 'permission denied' });
  assert.strictEqual(r.retryable, false);
});

test('classifySupabaseError 把网络类错误标为可重试', () => {
  const r = classifySupabaseError({ code: '08000', message: 'connection error' });
  assert.strictEqual(r.retryable, true);
});

test('classifySupabaseError 把 503/超时类错误标为可重试', () => {
  const r = classifySupabaseError({ code: 'PGRST', message: 'connection terminated' });
  assert.strictEqual(r.retryable, true);
});

test('classifySupabaseError 处理 null 输入', () => {
  const r = classifySupabaseError(null);
  assert.strictEqual(r.retryable, false);
  assert.strictEqual(r.error, null);
});

test('NON_RETRYABLE_CODES 包含语义性错误码完整列表', () => {
  ['23505', '42501', '23503', '23502', '22P02', '23514', '42P01', '42703'].forEach(code => {
    assert.ok(NON_RETRYABLE_CODES.indexOf(code) >= 0, `missing ${code}`);
  });
});

// ===================== insertSecurityAlert 源码契约 =====================

test('insertSecurityAlert 使用 .select(id).limit(1) 检查真实结果', () => {
  const src = sliceFn('insertSecurityAlert');
  assert.match(src, /\.insert\(\[payload\]\)\.select\('id'\)\.limit\(1\)/);
});

test('insertSecurityAlert 不再 fire-and-forget 空 catch', () => {
  const src = sliceFn('insertSecurityAlert');
  // 旧版: } catch(e) { console.warn(...); } 然后函数返回 undefined
  // 新版: catch 中调用 _dbResult 返回结构化错误
  assert.match(src, /return _dbResult\(operation, 1, 0, 1/);
});

test('insertSecurityAlert 成功返回 _dbResult(operation, 1, 1, 0)', () => {
  const src = sliceFn('insertSecurityAlert');
  assert.match(src, /return _dbResult\(operation, 1, 1, 0\);/);
});

// ===================== logAdminAudit 源码契约 =====================

test('logAdminAudit 使用 .select(id).limit(1) 检查真实结果', () => {
  const src = sliceFn('logAdminAudit');
  assert.match(src, /\.insert\(\[payload\]\)\.select\('id'\)\.limit\(1\)/);
});

test('logAdminAudit 返回 _dbResult 不再丢弃错误', () => {
  const src = sliceFn('logAdminAudit');
  assert.match(src, /return _dbResult\(operation, 1, 0, 1, \{ retryable: cls\.retryable, error: cls\.error \}\);/);
});

// ===================== cleanupOldLogs 源码契约 =====================

test('cleanupOldLogs 查询失败不再返回 { deleted: 0 }', () => {
  const src = sliceFn('cleanupOldLogs');
  // 旧版: if (error || !data || !data.length) return { deleted: 0 };
  assert.doesNotMatch(src, /return \{ deleted: 0 \}/);
  // 新版: 查询错误时返回带 retryable/error 的 _dbResult
  assert.match(src, /if \(selectRes\.error\) \{[\s\S]*return _dbResult\(operation, 0, 0, 0, \{ retryable: cls1\.retryable, error: cls1\.error \}\);/);
});

test('cleanupOldLogs 删除批次使用 .select(id) 接收实际删除行数', () => {
  const src = sliceFn('cleanupOldLogs');
  assert.match(src, /\.delete\(\)\.in\('id', batch\)\.select\('id'\)/);
});

test('cleanupOldLogs 用 delRes.data.length 而非 batch.length 计数成功', () => {
  const src = sliceFn('cleanupOldLogs');
  assert.match(src, /actuallyDeleted = Array\.isArray\(delRes\.data\) \? delRes\.data\.length : 0/);
  assert.match(src, /succeeded \+= actuallyDeleted/);
});

test('cleanupOldLogs 真正空数据返回 ok=true 不是伪装', () => {
  const src = sliceFn('cleanupOldLogs');
  // if (!data.length) { return _dbResult(operation, 0, 0, 0); }
  assert.match(src, /if \(!data\.length\) \{[\s\S]*return _dbResult\(operation, 0, 0, 0\);/);
});

test('cleanupOldLogs 未知类型返回 INVALID_TYPE 错误', () => {
  const src = sliceFn('cleanupOldLogs');
  assert.match(src, /code: 'INVALID_TYPE'/);
});

// ===================== /admin/cleanup-logs 端点契约 =====================

test('/admin/cleanup-logs 返回 total_succeeded 和 total_failed 而非仅 total_deleted', () => {
  const src = routeSource('post', '/admin/cleanup-logs', "// ===================== 审计日志查询");
  assert.match(src, /total_succeeded: totalSucceeded/);
  assert.match(src, /total_failed: totalFailed/);
  assert.match(src, /total_attempted: totalAttempted/);
  assert.match(src, /partial: anyPartial/);
  assert.match(src, /retryable: anyRetryable/);
});

test('/admin/cleanup-logs 部分失败使用 207 Multi-Status', () => {
  const src = routeSource('post', '/admin/cleanup-logs', "// ===================== 审计日志查询");
  assert.match(src, /anyPartial \? 207 : 500/);
});

// ===================== /health 端点契约 =====================

test('/health 区分 node/config/database 三层状态', () => {
  const src = routeSource('get', '/health', "// 邮件配置健康检查");
  assert.match(src, /node: nodeStatus/);
  assert.match(src, /config: Object\.assign\(\{ ok: allConfigOk \}, configStatus\)/);
  assert.match(src, /database: \{[\s\S]*ok: dbOk[\s\S]*status: dbProbe\.status/);
});

test('/health DB 探针带 8s 超时缓存 15s', () => {
  // probeDatabaseConnectivity 函数定义在 app.get('/health') 之前，需在 serverSrc 全文中匹配
  assert.match(serverSrc, /function probeDatabaseConnectivity\(\) \{/);
  assert.match(serverSrc, /setTimeout\(function\(\) \{[\s\S]*?settled = true[\s\S]*?\}, 8000\)/);
  assert.match(serverSrc, /_HEALTH_DB_TTL_MS = 15000/);
});

test('/health 整体不可用时返回 503', () => {
  const src = routeSource('get', '/health', "// 邮件配置健康检查");
  assert.match(src, /res\.status\(overallOk \? 200 : 503\)/);
});

// ===================== SUPABASE_URL 生产检查 =====================

test('生产环境缺失 SUPABASE_URL 拒绝启动', () => {
  assert.match(serverSrc, /const _IS_PRODUCTION = \(/);
  assert.match(serverSrc, /if \(!SUPABASE_URL\) \{/);
  assert.match(serverSrc, /\[FATAL\] 生产环境缺少 SUPABASE_URL 环境变量，拒绝启动/);
  assert.match(serverSrc, /process\.exit\(1\)/);
});

test('非生产环境保留 SUPABASE_URL 兜底用于测试/开发', () => {
  assert.match(serverSrc, /SUPABASE_URL \|\| \(_IS_PRODUCTION \? null : 'https:\/\/ithowxqignlhkwaykglt\.supabase\.co'\)/);
});

test('server.js 通过 require 引入 db-result 模块', () => {
  assert.match(serverSrc, /require\('\.\/db-result'\)/);
});
