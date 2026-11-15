'use strict';
// 文件解析链路契约：前端上传 → 服务端代理 → Responses 以 input_file 引用 → 上游拒绝时降级。
// 这些断言锁住的是「关键接线」，避免后续改动把其中任意一环悄悄摘掉。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');

const read = p => fs.readFileSync(p, 'utf8');
const server = () => read('render-api/server.js');
const files = () => read('render-api/deepseek-files.js');
const agent = () => read('js/ai-agent.js');
const pkg = () => read('package.json');

test('服务端挂载 /api/agent/files，并让上传路径跳过 2mb 全局 JSON 限制', () => {
  const s = server();
  assert.match(s, /app\.use\('\/api\/agent\/files', require\('\.\/deepseek-files'\)\.createDeepSeekFiles\(\{ express, guestAiAuth, rateLimit, adminAuth: aiFilesAdminAuth \}\)\)/);
  assert.match(s, /'\/api\/agent\/files\/upload': true,/);
  assert.match(s, /express\.json\(\{\s*limit: '2mb'/);
  // ★ 2026-11-16（U-S9）：删除接口必须挂管理员鉴权，不能再挂 guestAiAuth
  assert.match(s, /const aiFilesAdminAuth = function \(req, res, next\)/);
  assert.match(s, /req\.userName !== ADMIN_USERNAME/);
});

test('Files API 代理：purpose 必须在 file 之前，三类 purpose 与官方一致', () => {
  const f = files();
  const purposeAt = f.indexOf("form.append('purpose', pick.purpose);");
  const fileAt = f.indexOf("form.append('file', new Blob(");
  assert.ok(purposeAt > 0 && fileAt > purposeAt, '官方要求 purpose 排在 file 前');
  assert.match(f, /rich_layout_recognition/);
  assert.match(f, /text_recognition|user_data/);
  assert.match(f, /https:\/\/api\.deepseek\.com\/files/);
  assert.match(f, /Authorization: 'Bearer '/);
  assert.match(f, /DEEPSEEK_FILES_ENABLED/);
});

test('上传代理校验：data URL 严格格式、文件名清洗、file_id 合法性、中文错误映射', () => {
  const f = files();
  assert.match(f, /const DATA_URL_RE = \/\^data:/);
  assert.match(f, /function safeFilename/);
  assert.match(f, /\/\^file-api-\[A-Za-z0-9_-\]\+\$\//);
  assert.match(f, /function upstreamMessage/);
  assert.match(f, /parse_timeout/);
  assert.match(f, /files_unconfigured/);
});

test('服务端只收集本轮合法 file_id，最多 20 个且去重', () => {
  const s = server();
  assert.match(s, /function collectDeepSeekFileIds\(attachments, req\)/);
  assert.match(s, /ids\.length < 20/);
  assert.match(s, /ids\.indexOf\(id\) < 0/);
  assert.match(s, /\^file-api-\[A-Za-z0-9_-\]\+\$/);
  // 主聊天流与非流式 /chat 两条路径都接入（带 req 用于归属校验）
  const hits = s.match(/input_files: collectDeepSeekFileIds\(req\.body && req\.body\.attachments, req\)/g) || [];
  assert.ok(hits.length >= 2, '内置流式与非流式路径都要支持文件解析');
});

// ★ 2026-11-16（审计 P0 U-S9 / U-S10 / U-S2 / U-S5）：四条越权/SSRF 修复的接线守卫。
test('P0：官方 file_id 归属登记在上传、引用、删除三处闭环', () => {
  const s = server(), f = files();
  assert.match(s, /require\('\.\/ai-file-ownership'\)/);
  assert.match(s, /setAiFileIpResolver\(getRealIp\)/);
  // 上传登记
  assert.match(f, /fileOwnership\.register\(fileId, req\)/);
  // 引用校验（collect 内部 + 三条入口剥离）
  assert.match(s, /aiFileOwnership\.isOwnedBy\(id, req\)/);
  const strips = s.match(/aiFileOwnership\.stripForeignFileIds\(req\.body, req\)/g) || [];
  assert.ok(strips.length >= 3, 'chat / chat-stream / research-stream 三条入口都要剥离非本人 file_id');
  // 删除路径：管理员鉴权为唯一门槛 + 删除后清登记（避免误伤运维清理）
  assert.match(f, /router\.delete\('\/:fileId', deleteGuard/);
  assert.match(f, /fileOwnership\.forget\(fileId\)/);
  assert.match(f, /const deleteGuard = typeof adminAuth === 'function'/);
});

test('P0：游客 cancel 越权改为严格归属键比对（不再用空串短路）', () => {
  const s = server();
  assert.match(s, /ownerKey: aiFileOwnership\.ownerKeyOf\(req\)/);
  assert.match(s, /var reqOwner = aiFileOwnership\.ownerKeyOf\(req\)/);
  assert.match(s, /if \(jobOwner !== reqOwner\)/);
  assert.ok(!/if \(job\.userName && job\.userName !== req\.userName\)/.test(s), '旧空串短路写法必须移除');
});

test('P0：分享页链接预览改为 manual 重定向 + 每跳公网校验', () => {
  const p = read('render-api/photo-access.js');
  assert.match(p, /redirect: 'manual'/);
  assert.match(p, /LINK_MAX_REDIRECTS/);
  assert.match(p, /async function assertPublicLinkTarget/);
  assert.match(p, /isPrivateAddress\(address\)/);
  assert.ok(!/redirect: 'follow'/.test(p.split('function readHtmlHead')[1] || ''), 'readHtmlHead 不得再自动跟随重定向');
});

test('Responses 输入：input_file 只挂在 user message 的 content 数组里', () => {
  const s = server();
  assert.match(s, /var nativeFileIds = \[\]/);
  assert.match(s, /var nativeFileParts = \[\{ type: 'input_text', text: String\(inputItems\[nfi2\]\.content\) \}\]/);
  assert.match(s, /\{ type: 'input_file', file_id: fid \}/);
  assert.match(s, /inputItems\[nfi2\]\.role === 'user'/);
  assert.match(s, /nativeFileIds\.length < 20/);
});

test('上游拒绝 input_file 时自动降级，退回本地文本解析而不失败', () => {
  const s = server();
  assert.match(s, /var nativeFilesOff = false;/);
  assert.match(s, /input_file rejected, retrying without file references/);
  assert.match(s, /\/input_file\|file_id\|document\|content\.\?part\|files\?\/i/);
  assert.match(s, /_p\.type === 'input_text'/);
});

test('前端发送前上传文档，图片与自定义模型不走 DeepSeek Files API', () => {
  const a = agent();
  assert.match(a, /async function uploadAiDocument\(att, headers, signal\)/);
  assert.match(a, /API_BASE \+ '\/files\/upload'/);
  assert.match(a, /att\.file_id = String\(data\.file_id\)/);
  assert.ok(a.includes("!/^image\\//i.test"), '图片不上传，继续走原有视觉链路');
  assert.match(a, /!isCustomModel && attachmentPayload && attachmentPayload\.length/);
  assert.match(a, /await ensureDeepSeekFileIds\(attachmentPayload, headers, controller\.signal\)/);
  assert.match(a, /'正在解析文件…'/);
  // 上传失败不阻断发送
  assert.match(a, /try \{ await uploadAiDocument\(one, headers, signal\); \} catch \(_\) \{\}/);
});

test('新测试已注册进 npm test 与语法检查', () => {
  const p = pkg();
  assert.match(p, /tests\/deepseek-files-runtime\.test\.js/);
  assert.match(p, /tests\/deepseek-files-contract\.test\.js/);
  assert.match(p, /node --check render-api\/deepseek-files\.js/);
});
