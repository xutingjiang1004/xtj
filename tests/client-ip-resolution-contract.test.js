// 客户端 IP 解析合约测试（2026-09-21 修复回归）
// 背景：Render 内部为多层代理，原 `trust proxy = 1` 只信任一跳，
// 导致 req.ip 落成 Render 内网地址（如 10.193.27.131），属地解析全部失败。
// 修复：trust proxy 信任全部私有/保留网段 + getClientIp 私网跳过与
// X-Forwarded-For 右往左公网兜底。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'render-api', 'server.js');
const src = fs.readFileSync(SERVER, 'utf8');

test('合约：trust proxy 为函数判定（所有私网/保留地址视为受信代理 hop）', () => {
  // ★ 2026-09-24：固定网段列表可能漏掉平台新增内网 hop；改为函数判定后
  //   任何私网 hop 都被信任，req.ip 恒为第一个公网地址（真实客户端）。
  assert.ok(
    src.includes("app.set('trust proxy', function trustProxyHop(addr) {"),
    "server.js 必须设置 trust proxy 为函数模式"
  );
  assert.ok(
    src.includes('return isPrivateOrReservedIp(addr);'),
    'trust proxy 函数必须复用 isPrivateOrReservedIp 判定'
  );
});

// 从 server.js 提取三个纯函数做行为验证（不 require 整个服务）
function extractFn(name) {
  const re = new RegExp('\\n(?:async )?function ' + name + '\\([^)]*\\) \\{');
  const m = src.match(re);
  assert.ok(m, '在 server.js 中找到 function ' + name);
  const start = m.index + 1;
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return src.slice(start, end);
}

const code = [
  extractFn('normalizeClientIpValue'),
  extractFn('isPrivateOrReservedIp'),
  extractFn('firstPublicIpFromForwardedChain'),
].join('\n');
const factory = new Function(code + '; return { normalizeClientIpValue: normalizeClientIpValue, isPrivateOrReservedIp: isPrivateOrReservedIp, firstPublicIpFromForwardedChain: firstPublicIpFromForwardedChain };');
const { isPrivateOrReservedIp, firstPublicIpFromForwardedChain } = factory();

test('行为：私网/保留地址判定', () => {
  assert.equal(isPrivateOrReservedIp('10.193.27.131'), true, 'Render 内网 10/8');
  assert.equal(isPrivateOrReservedIp('172.20.1.9'), true, '172.16/12');
  assert.equal(isPrivateOrReservedIp('192.168.1.1'), true, '192.168/16');
  assert.equal(isPrivateOrReservedIp('100.100.1.1'), true, 'CGNAT');
  assert.equal(isPrivateOrReservedIp('169.254.3.4'), true, 'link-local');
  assert.equal(isPrivateOrReservedIp('127.0.0.1'), true, 'loopback');
  assert.equal(isPrivateOrReservedIp('::1'), true, 'IPv6 loopback');
  assert.equal(isPrivateOrReservedIp('fd12::1'), true, 'IPv6 ULA');
  assert.equal(isPrivateOrReservedIp('unknown'), true);
  assert.equal(isPrivateOrReservedIp(''), true);
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false, '公网 IPv4');
  assert.equal(isPrivateOrReservedIp('223.104.3.9'), false, '国内移动出口段（示例）');
  assert.equal(isPrivateOrReservedIp('2606:4700::1111'), false, '公网 IPv6');
});

test('行为：X-Forwarded-For 从右往左取第一个公网地址', () => {
  // Render 多跳：socket → 10.x → 10.x → client；客户端真实 IP 在链中段
  assert.equal(
    firstPublicIpFromForwardedChain({ headers: { 'x-forwarded-for': '1.2.3.4, 10.1.2.3' } }),
    '1.2.3.4'
  );
  assert.equal(
    firstPublicIpFromForwardedChain({ headers: { 'x-forwarded-for': '1.2.3.4, 172.19.0.5, 10.1.2.3' } }),
    '1.2.3.4'
  );
  // 客户端伪造值在最左侧：从右往左扫描永远不会选中伪造值
  assert.equal(
    firstPublicIpFromForwardedChain({ headers: { 'x-forwarded-for': '6.6.6.6, 1.2.3.4, 10.1.2.3' } }),
    '1.2.3.4',
    '伪造的 6.6.6.6 必须被忽略'
  );
  // 全私有链 → 空（不允许返回私网值）
  assert.equal(
    firstPublicIpFromForwardedChain({ headers: { 'x-forwarded-for': '10.1.2.3, 192.168.0.9' } }),
    ''
  );
  // 无头 → 空
  assert.equal(firstPublicIpFromForwardedChain({ headers: {} }), '');
  assert.equal(firstPublicIpFromForwardedChain(null), '');
});

test('行为：私网 IP 的属地解析在源头被拦截（不外发数据源）', () => {
  assert.ok(
    src.includes('async function resolveIpLocationUncached(ip) {\n  if (isPrivateOrReservedIp(ip)) return null;'),
    'resolveIpLocationUncached 必须前置拦截私网 IP'
  );
});

test('合约：管理端重解析端点对私网 IP 返回明确结论', () => {
  assert.ok(src.includes("code: 'private_ip'"), 'resolve-ip 端点必须返回 private_ip 错误码');
});

test('合约：帖子属地重试对私网 IP 直接落定失败', () => {
  assert.ok(
    src.includes("await setIpRegionFailed(postId, 'private_ip_unresolvable');"),
    'retryIpRegionAsync 必须对私网 IP 跳过无效重试'
  );
});
