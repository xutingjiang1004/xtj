const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'mcp-servers', 'xtj-admin', 'server.js'), 'utf8');

// ---------------------------------------------------------------- M-3
// 高危写操作必须有 confirm 闸门，否则 AI 一次不带参数的调用即可永久封禁用户。
const HIGH_RISK_TOOLS = [
  'admin_ban_user',
  'admin_mute_user',
  'admin_add_blacklist',
  'admin_report_delete_post',
  'admin_report_ban_user',
  'admin_delete_user',
  'admin_delete_post',
  'admin_delete_comment',
];

/** 截取某个 server.tool("name", ...) 注册块的源码 */
function toolBlock(name) {
  const marker = `server.tool("${name}"`;
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `工具 ${name} 必须存在`);
  // 下一个 server.tool 注册处即边界；末尾工具则取到文件结束
  const next = src.indexOf('server.tool("', start + marker.length);
  return src.slice(start, next === -1 ? src.length : next);
}

test('M-3: 全部高危工具都声明了 confirm 布尔参数', () => {
  for (const name of HIGH_RISK_TOOLS) {
    const block = toolBlock(name);
    assert.match(block, /confirm:\s*z\.boolean\(\)/,
      `${name} 的 schema 必须包含 confirm: z.boolean()`);
    assert.match(block, /if \(!args\.confirm\)|if \(!confirm\)/,
      `${name} 必须在执行前校验 confirm`);
  }
});

test('M-3: 永久类操作需要 confirm_permanent 二道闸，避免缺省即永久', () => {
  // duration_hours 缺省 0 = 永久，因此"永久"必须有独立确认
  for (const name of ['admin_ban_user', 'admin_mute_user', 'admin_add_blacklist', 'admin_report_ban_user']) {
    const block = toolBlock(name);
    assert.match(block, /confirm_permanent:\s*z\.boolean\(\)/,
      `${name} 必须声明 confirm_permanent`);
    assert.match(block, /isPermanent\s*&&\s*!args\.confirm_permanent/,
      `${name} 必须在永久场景要求 confirm_permanent`);
  }
});

test('M-3: 高危写操作全部接入 logAudit 审计', () => {
  const AUDITED = [
    'admin_delete_user', 'admin_delete_post', 'admin_delete_comment',
    'admin_ban_user', 'admin_unban_user',
    'admin_mute_user', 'admin_unmute_user',
    'admin_add_blacklist', 'admin_lift_blacklist',
    'admin_report_delete_post', 'admin_report_ban_user',
  ];
  for (const name of AUDITED) {
    const block = toolBlock(name);
    assert.match(block, /logAudit\(/, `${name} 必须写审计日志`);
  }
});

test('M-3: 未传 confirm 时不得调用任何写接口', () => {
  // 防止"先执行后校验"的写法回归
  for (const name of HIGH_RISK_TOOLS) {
    const block = toolBlock(name);
    const guardIdx = Math.max(
      block.indexOf('if (!args.confirm)'), block.indexOf('if (!confirm)'));
    const firstWrite = Math.min(
      ...['apiRequest("POST"', 'apiRequest("PUT"', 'apiRequest("DELETE"']
        .map(p => block.indexOf(p)).filter(i => i !== -1).concat([Infinity]));
    assert.notEqual(guardIdx, -1, `${name} 必须有 confirm 守卫`);
    assert.ok(guardIdx < firstWrite,
      `${name} 的 confirm 守卫必须早于写请求（guard@${guardIdx} write@${firstWrite}）`);
  }
});

// ---------------------------------------------------------------- M-4
test('M-4: 登录成功后不回存明文密码到模块级变量', () => {
  const start = src.indexOf('async function login(username, password)');
  assert.notEqual(start, -1);
  const end = src.indexOf('function getAutoLoginCredential', start);
  assert.notEqual(end, -1, '必须存在 getAutoLoginCredential 定义');
  // 剔除注释行，只对可执行代码做断言（注释里可能提到旧写法作为说明）
  const block = src.slice(start, end)
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  assert.doesNotMatch(block, /adminPass\s*=\s*password/,
    'login() 不得把明文密码回存到 adminPass');
});

test('M-4: 不存在可长期驻留明文密码的模块级变量', () => {
  const codeOnly = src.split('\n')
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  assert.doesNotMatch(codeOnly, /^let\s+adminPass\s*=/m,
    '不应存在模块级 adminPass 变量（明文密码驻留内存）');
});

test('M-4: 自动重登凭据仅取自环境变量，且校验用户名一致', () => {
  const start = src.indexOf('function getAutoLoginCredential');
  assert.notEqual(start, -1);
  const block = src.slice(start, start + 700);
  assert.match(block, /process\.env\.XTJ_ADMIN_USER/);
  assert.match(block, /process\.env\.XTJ_ADMIN_PASS/);
  assert.match(block, /envUser\s*!==\s*adminUser/,
    '环境变量用户名与当前登录用户不一致时必须放弃自动重登');

  // ensureLoggedIn 不得再引用旧的 adminPass
  const es = src.indexOf('async function ensureLoggedIn');
  const ee = src.indexOf('async function login(', es);
  const esBlock = src.slice(es, ee);
  assert.doesNotMatch(esBlock, /adminPass/);
  assert.match(esBlock, /getAutoLoginCredential\(\)/);
});
