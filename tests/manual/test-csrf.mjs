// CSRF 防护测试：同源请求 vs 跨域请求
const BASE = 'http://localhost:' + (process.env.PORT || 3000);

let failed = 0;

async function test(label, origin, host, expectBlocked) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers['origin'] = origin;
  if (host) headers['host'] = host;

  try {
    const res = await fetch(BASE + '/admin/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ username: 'test', password: 'test' })
    });
    const status = res.status;
    const body = await res.text().catch(() => '');
    // expectBlocked=true 的跨域用例：期望被 CSRF 拦截为 403；
    // 否则（同源/无 Origin）期望放行：200=成功, 401=密码错但未被 CSRF 拦。
    const passed = expectBlocked ? status === 403 : (status === 200 || status === 401);
    if (!passed) failed++;
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${label} → ${status} ${body.slice(0, 80)}`);
  } catch (err) {
    failed++;
    console.log(`[FAIL] ${label} → ${err.message}`);
  }
}

console.log('=== CSRF 测试 ===\n');

// 1. 同源请求：Origin 匹配 Host → 应放行
await test('同源 POST (Origin=Host)', `http://localhost:${process.env.PORT || 3000}`, `localhost:${process.env.PORT || 3000}`, false);

// 2. 无 Origin（模拟 curl/Postman）→ 应放行
await test('无 Origin POST', null, `localhost:${process.env.PORT || 3000}`, false);

// 3. 跨域请求（恶意 Origin）→ 应拦截 403
await test('跨域 POST (恶意 Origin)', 'https://evil.com', `localhost:${process.env.PORT || 3000}`, true);

// 4. 跨域请求（白名单外的 Origin）→ 应拦截 403
await test('跨域 POST (未知 Origin)', 'https://unknown.com', `localhost:${process.env.PORT || 3000}`, true);

console.log('\n=== 完成 ===');
process.exit(failed ? 1 : 0);
