// CSRF 防护测试：同源请求 vs 跨域请求
const BASE = 'http://localhost:' + (process.env.PORT || 3000);

async function test(label, origin, host) {
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
    const passed = status === 200 || status === 401; // 200=成功, 401=密码错但未被CSRF拦
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${label} → ${status} ${body.slice(0, 80)}`);
  } catch (err) {
    console.log(`[FAIL] ${label} → ${err.message}`);
  }
}

console.log('=== CSRF 测试 ===\n');

// 1. 同源请求：Origin 匹配 Host → 应放行
await test('同源 POST (Origin=Host)', `http://localhost:${process.env.PORT || 3000}`, `localhost:${process.env.PORT || 3000}`);

// 2. 无 Origin（模拟 curl/Postman）→ 应放行
await test('无 Origin POST', null, `localhost:${process.env.PORT || 3000}`);

// 3. 跨域请求（恶意 Origin）→ 应拦截 403
await test('跨域 POST (恶意 Origin)', 'https://evil.com', `localhost:${process.env.PORT || 3000}`);

// 4. 跨域请求（白名单外的 Origin）→ 应拦截 403
await test('跨域 POST (未知 Origin)', 'https://unknown.com', `localhost:${process.env.PORT || 3000}`);

console.log('\n=== 完成 ===');
