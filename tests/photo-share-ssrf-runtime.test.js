'use strict';
// ★ 2026-11-16（审计 P0 U-S5）
// 分享页链接预览对游客开放，正文 URL 完全用户可控。验证：
//  1. 302 跳到内网/元数据地址时不再自动跟随；
//  2. 域名解析到私网地址时拒绝；
//  3. 正常公网页面仍可读取 og 标签。
const test = require('node:test'), assert = require('node:assert/strict');
const {
  publicLink, readHtmlHead, assertPublicLinkTarget
} = require('../render-api/photo-access');

// 只解析到公网地址的假 DNS
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
// 解析到内网/元数据的假 DNS
const privateLookup = async () => [{ address: '169.254.169.254', family: 4 }];

function htmlResponse(body, status = 200) {
  const buf = Buffer.from(String(body));
  let read = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => String(k).toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : '' },
    body: {
      getReader: () => ({
        read: async () => {
          if (read) return { done: true, value: undefined };
          read = true;
          return { done: false, value: buf };
        },
        cancel: async () => {}
      })
    },
    text: async () => buf.toString('utf8')
  };
}
function redirectResponse(location) {
  return {
    ok: false,
    status: 302,
    headers: { get: (k) => String(k).toLowerCase() === 'location' ? location : '' },
    body: null,
    text: async () => ''
  };
}

test('publicLink 保持既有黑名单：内网 IP / localhost / 元数据地址一律拒绝', () => {
  assert.equal(publicLink('http://127.0.0.1/x'), null);
  assert.equal(publicLink('http://192.168.1.4/x'), null);
  assert.equal(publicLink('http://169.254.169.254/latest/meta-data'), null);
  assert.equal(publicLink('http://localhost:3000/x'), null);
  assert.equal(publicLink('http://metadata.google.internal/x'), null);
  assert.equal(publicLink('file:///etc/passwd'), null);
  assert.ok(publicLink('https://example.com/page'));
});

test('★ U-S5: 302 跳到内网/元数据时不跟随，且返回空、不发起第二次请求', async () => {
  const targets = [
    'http://127.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'http://192.168.0.1/',
    'https://metadata.google.internal/computeMetadata/v1/'
  ];
  for (const to of targets) {
    let calls = 0;
    const page = await readHtmlHead('https://example.com/start', 300000, {
      lookupImpl: publicLookup,
      fetchImpl: async () => { calls += 1; return redirectResponse(to); }
    });
    assert.equal(page, '', '跳到 ' + to + ' 必须被拦下');
    assert.equal(calls, 1, '不得对内网目标发起第二次请求');
  }
});

test('★ U-S5: 域名解析到私网地址（DNS rebinding）时拒绝', async () => {
  let called = false;
  const target = await assertPublicLinkTarget('https://rebind.example.com/x', privateLookup);
  assert.equal(target, null);
  const page = await readHtmlHead('https://rebind.example.com/x', 300000, {
    lookupImpl: privateLookup,
    fetchImpl: async () => { called = true; return htmlResponse('<title>x</title>'); }
  });
  assert.equal(page, '');
  assert.equal(called, false, '解析到私网时不得发请求');
});

test('★ U-S5: 超过最大重定向跳数时终止，不会无限跟随', async () => {
  let calls = 0;
  const page = await readHtmlHead('https://example.com/hop', 300000, {
    lookupImpl: publicLookup,
    fetchImpl: async () => { calls += 1; return redirectResponse('https://example.com/hop' + calls); }
  });
  assert.equal(page, '');
  assert.ok(calls <= 4, '最多 4 次请求（3 跳 + 首跳）');
});

test('正常公网页面仍能读取 og 标签（防护不误伤功能）', async () => {
  const page = await readHtmlHead('https://example.com/article', 300000, {
    lookupImpl: publicLookup,
    fetchImpl: async () => htmlResponse('<html><head><meta property="og:title" content="标题"></head></html>')
  });
  assert.match(page, /og:title/);
  assert.match(page, /标题/);
});

test('八进制/整数形式的回环 IP 变形不能绕过（WHATWG URL 规范化后判定）', async () => {
  // 0177.0.0.1 与 2130706433 都会被 URL 规范化成 127.0.0.1
  for (const raw of ['http://0177.0.0.1/', 'http://2130706433/']) {
    const target = await assertPublicLinkTarget(raw, publicLookup);
    assert.equal(target, null, raw + ' 必须被拒绝');
  }
});
