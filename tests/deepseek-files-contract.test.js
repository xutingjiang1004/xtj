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
  assert.match(s, /app\.use\('\/api\/agent\/files', require\('\.\/deepseek-files'\)\.createDeepSeekFiles\(\{ express, guestAiAuth, rateLimit \}\)\)/);
  assert.match(s, /'\/api\/agent\/files\/upload': true,/);
  assert.match(s, /express\.json\(\{\s*limit: '2mb'/);
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
  assert.match(s, /function collectDeepSeekFileIds\(attachments\)/);
  assert.match(s, /ids\.length < 20/);
  assert.match(s, /ids\.indexOf\(id\) < 0/);
  assert.match(s, /\^file-api-\[A-Za-z0-9_-\]\+\$/);
  // 主聊天流与非流式 /chat 两条路径都接入
  const hits = s.match(/input_files: collectDeepSeekFileIds\(req\.body && req\.body\.attachments\)/g) || [];
  assert.ok(hits.length >= 2, '内置流式与非流式路径都要支持文件解析');
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
