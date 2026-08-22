'use strict';

// ★ 2026-08-22 修复：AI 生图占位图 bug
// 默认上游（trae-api-cn.mchost.guru /text_to_image）对未授权请求 302 到静态占位图
// .../page_image/default.jpeg（内容 "The image is generating... Please refresh page to
// preview."）。旧前端 <img src> 直连时占位图也是合法 JPEG，onload 照常触发，
// 占位图被当成生成成功展示。本契约锁定：
//   1) 后端代理 /api/agent/image-gen 存在且鉴权 + 限流
//   2) 服务端手动跟随跳转并识别占位图，返回明确 502 错误而不是占位图
//   3) 前端默认走后端代理（apiRequest），错误信息透传到 UI
//   4) 自定义 AI_IMAGE_GEN_BASE 直连契约保持不变

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
const aiAgent = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');
const aiAgentMin = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.min.js'), 'utf8');

function routeSource(startToken, endToken) {
  const start = server.indexOf(startToken);
  assert.notEqual(start, -1, `missing ${startToken}`);
  const end = endToken ? server.indexOf(endToken, start + startToken.length) : server.length;
  assert.ok(end > start, `could not isolate ${startToken}`);
  return server.slice(start, end);
}

test('image-gen proxy route is authenticated and rate limited', () => {
  const source = routeSource("app.get('/api/agent/image-gen'", "// GET /api/agent/quota");
  assert.match(source, /authenticateUser/);
  assert.match(source, /rateLimit\(60000, 10\)/);
});

test('image-gen proxy validates prompt and image size inputs', () => {
  const source = routeSource("app.get('/api/agent/image-gen'", "// GET /api/agent/quota");
  assert.match(source, /if \(!prompt\) return res\.status\(400\)/);
  assert.match(source, /prompt\.length > 500[\s\S]*status\(400\)/);
  assert.match(source, /AI_IMAGE_GEN_SIZES\.indexOf\(size\) < 0/);
});

test('image-gen proxy detects upstream placeholder redirect and returns explicit error', () => {
  const source = routeSource("app.get('/api/agent/image-gen'", "// GET /api/agent/quota");
  // 不自动跟随跳转：必须先检查 Location 是否为占位图
  assert.match(source, /redirect: 'manual'/);
  assert.match(source, /isAiImageGenPlaceholderUrl\(target\)/);
  assert.match(source, /IMAGE_GEN_UPSTREAM_UNAVAILABLE/);
  // 占位图绝不能作为成功结果下发（不能直接 res.json({ok:true}) 走到占位图 URL）
  const placeholderBranch = source.slice(
    source.indexOf('if (isAiImageGenPlaceholderUrl(target))'),
    source.indexOf('return res.json({ ok: true, url: target });')
  );
  assert.match(placeholderBranch, /status\(502\)/);
  assert.doesNotMatch(placeholderBranch, /ok: true/);
});

test('image-gen placeholder detection covers known default image assets', () => {
  assert.match(server, /function isAiImageGenPlaceholderUrl/);
  // 源码中的正则字面量为 /\/page_image\/default\.(jpe?g|png|webp)$/i（含转义反斜杠）
  assert.match(server, /page_image\\\/default\\\.\(jpe\?g\|png\|webp\)\$/);
});

test('image-gen proxy supports direct-image upstreams via data URL', () => {
  const source = routeSource("app.get('/api/agent/image-gen'", "// GET /api/agent/quota");
  assert.match(source, /contentType\.indexOf\('image\/'\) === 0/);
  assert.match(source, /'data:' \+ contentType \+ ';base64,'/);
  assert.match(source, /AI_IMAGE_GEN_MAX_BYTES/);
});

test('image-gen proxy upstream base is configurable via env', () => {
  const source = routeSource("app.get('/api/agent/image-gen'", "// GET /api/agent/quota");
  assert.match(source, /process\.env\.AI_IMAGE_GEN_BASE \|\| AI_IMAGE_GEN_DEFAULT_UPSTREAM/);
  assert.match(server, /AI_IMAGE_GEN_DEFAULT_UPSTREAM = 'https:\/\/trae-api-cn\.mchost\.guru\/api\/ide\/v1\/text_to_image'/);
});

test('frontend loadGenImage uses backend proxy by default and surfaces error messages', () => {
  const start = aiAgent.indexOf('function loadGenImage(prompt, onOk, onErr)');
  assert.ok(start >= 0, 'missing loadGenImage');
  const end = aiAgent.indexOf('function openImageGenModal()', start);
  assert.ok(end > start);
  const source = aiAgent.slice(start, end);
  // 默认走后端代理（带鉴权），不再 <img> 直连默认上游
  assert.match(source, /apiRequest\('GET', '\/image-gen\?prompt='/);
  assert.match(source, /timeoutMs: 60000/);
  // 失败路径必须把后端错误信息传给回调（占位图 502 → 用户可见明确错误）
  assert.match(source, /onErr\(\(r && r\.error\) \? String\(r\.error\) : '图片服务不可用，请稍后重试'\)/);
  // 成功前预载验证返回的图片 URL
  assert.match(source, /pre\.onload/);
  assert.doesNotMatch(source, /trae-api-cn\.mchost\.guru/);
});

test('frontend keeps direct-connection contract for custom AI_IMAGE_GEN_BASE', () => {
  const start = aiAgent.indexOf('function customImageGenBase()');
  assert.ok(start >= 0, 'missing customImageGenBase');
  const end = aiAgent.indexOf('function openImageGenModal()', start);
  const source = aiAgent.slice(start, end);
  assert.match(source, /window\.XTJ_CONFIG && window\.XTJ_CONFIG\.AI_IMAGE_GEN_BASE/);
  assert.match(source, /customBase \+ '\?prompt='/);
});

test('frontend image-gen error UI renders server-provided message', () => {
  assert.match(aiAgent, /statusEl\.textContent = '生成失败：' \+ \(errMsg \|\| '图片服务不可用，请稍后重试'\)/);
  assert.match(aiAgent, /notify\('生成失败：' \+ \(errMsg \|\| '图片服务不可用，请稍后重试'\)\)/);
});

test('minified ai-agent bundle carries the proxied image-gen path', () => {
  // min 产物必须与源码同步（防止只改源码忘跑 build）
  assert.match(aiAgentMin, /image-gen\?prompt=/);
  assert.match(aiAgentMin, /生成的图片加载失败/);
});
