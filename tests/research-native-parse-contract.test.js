'use strict';
// 契约测试：确保「官方解析混合增强」接入位置正确、不破坏既有引用体系与缓存，
// 且前端零改动。全部为源码字符串锚点断言，不启动服务、不发网络请求。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('render-api/server.js', 'utf8');
const moduleSrc = fs.readFileSync('render-api/research-native-parse.js', 'utf8');
const docs = fs.readFileSync('render-api/research-documents.js', 'utf8');
const frontend = fs.readFileSync('js/ai-agent.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

test('server.js 挂载模块级单例，并复用已有 DEEPSEEK_API_KEY（密钥不下放前端）', () => {
  assert.match(server, /var researchNativeParse = require\('\.\/research-native-parse'\)\.createResearchNativeParse\(\{ env: process\.env, fetchImpl: fetch \}\)/);
  assert.match(moduleSrc, /env\.DEEPSEEK_API_KEY/);
  assert.doesNotMatch(moduleSrc, /createDeepSeekFiles|express\.Router|app\.use/, '侧车模块不暴露新路由，不新增攻击面');
  assert.match(server, /app\.use\('\/api\/agent\/files', require\('\.\/deepseek-files'\)/);
});

test('增强调用夹在 prepareResearchDocuments 与「全部未读出就抛错」之间', () => {
  const prepareAt = server.indexOf("await require('./research-documents').prepareResearchDocuments(req.body.attachments");
  const enhanceAt = server.indexOf('await researchNativeParse.enhance(documents, req.body.attachments');
  const throwAt = server.indexOf("throw Error('文件没有提取到可用文字");
  assert.ok(prepareAt > 0 && enhanceAt > 0 && throwAt > 0);
  assert.ok(prepareAt < enhanceAt, '必须在本地解析拿到 documents 之后');
  assert.ok(enhanceAt < throwAt, '必须在抛错之前：纯 PPT / 扫描件要靠官方解析救回来');
  // 增强失败不能把研究打挂
  assert.match(server, /catch \(_eNativeParse\) \{[\s\S]{0,200}console\.warn\('\[RESEARCH-NATIVE\] skipped:'/);
});

test('增强不改 documentFingerprint → 24h 缓存 key 与断点状态完全不受影响', () => {
  assert.match(server, /documents=preparedDocuments\.documents;documentFingerprint=preparedDocuments\.fingerprint;/);
  const seg = server.slice(server.indexOf('await researchNativeParse.enhance'), server.indexOf('var cacheKey = researchCacheKey'));
  assert.doesNotMatch(seg, /documentFingerprint\s*=/, '增强段内不得重算指纹');
  assert.match(server, /documentFingerprint \+ '\|'/); // cacheKey 仍用原指纹
  assert.match(server, /documents:documents,webSearch:allowResearchSearch/, 'documents 原样传给多智能体流程');
});

test('引用体系、段落结构与 limitation 约定保持原样，主链路一行未改', () => {
  assert.match(docs, /function documentsContext\(documents\)/);
  assert.match(docs, /\['\s*\+\s*d\.id\s*\+\s*':'/, '仍按 [F:P] 编号渲染');
  assert.match(docs, /P 是提取文本的段落编号，不是 PDF 页码/);
  assert.match(docs, /status:'read'/);
  // 主链路的 documentContext 注入点未变
  assert.match(server, /var documentContext = researchDocuments\.documentsContext\(documents\)/);
  assert.match(server, /if \(documents\.length\) sharedPrefix \+= '\\n' \+ researchDocuments\.INSTRUCTION/);
  // 补充段落仍按 [F:P] 编号且带 limitation 说明
  assert.match(moduleSrc, /'P' \+ \(startIndex \+ paragraphs\.length \+ 1\)/);
  assert.match(moduleSrc, /引用仍按 \[F:P\] 段落编号/);
  // 段落生成器只产出 P 编号，不得伪造「第N页」——沿用 research-documents 的约定。
  // （转写指令里「保留原文页码」是要求如实保留文档自带页码，属合理要求，故只校验生成器片段。）
  const generator = moduleSrc.slice(moduleSrc.indexOf('function paragraphsFromText'), moduleSrc.indexOf('function combinationSignal'));
  assert.doesNotMatch(generator, /第\\d\+页|页码/);
  assert.match(moduleSrc, /不代表看过原文件全部页面/, 'limitation 明确不夸大为看过全文');
});

test('触发条件收紧：只补本地未读出/截断的非图片文档，正常读全的不触发', () => {
  assert.match(moduleSrc, /doc\.status !== 'unread' && doc\.truncated !== true\) return false/);
  assert.match(moduleSrc, /if \(mime\.indexOf\('image\/'\) === 0\) return false/);
  assert.match(moduleSrc, /if \(\/\^data:image\\\/\//);
  assert.match(moduleSrc, /if \(!purposeFor\(name\)\) return false/);
  assert.match(moduleSrc, /MAX_CANDIDATES = 3/);
  assert.match(moduleSrc, /RESEARCH_NATIVE_PARSE_ENABLED/);
  assert.match(moduleSrc, /DEEPSEEK_FILES_ENABLED/);
});

test('侧车用官方 flash + input_file，purpose 严格排在 file 之前', () => {
  assert.match(moduleSrc, /FLASH_MODEL = 'deepseek-flash'/);
  assert.match(moduleSrc, /type: 'input_file', file_id: fileId/);
  assert.match(moduleSrc, /reasoning: \{ effort: 'none' \}/);
  const purposeAt = moduleSrc.indexOf("form.append('purpose', pick.purpose)");
  const fileAt = moduleSrc.indexOf("form.append('file', new Blob");
  assert.ok(purposeAt > 0 && fileAt > 0 && purposeAt < fileAt, '官方硬性要求顺序，错了直接 400');
  assert.match(moduleSrc, /side|侧车|转写/);
  assert.match(moduleSrc, /TRANSCRIBE_INSTRUCTION/);
});

test('任何上游失败都静默回落，绝不阻断研究', () => {
  assert.match(moduleSrc, /绝不抛错|绝不阻断|不抛错/);
  assert.match(moduleSrc, /catch \(_\) \{[\s\S]{0,120}return ''/);
  assert.match(moduleSrc, /await resp\.json\(\)\.catch\(function\(\) \{ return null; \}\)/);
  assert.match(moduleSrc, /if \(!resp\.ok\) return ''/);
});

test('前端零改动：研究请求仍带原附件，不新增上传调用与 UI 变更', () => {
  assert.match(frontend, /attachments:opts&&opts\.attachments/);
  const researchFetch = frontend.indexOf("API_BASE + '/research/stream'");
  assert.ok(researchFetch > 0);
  assert.doesNotMatch(frontend, /research\/stream[\s\S]{0,1200}files\/upload/);
  // 既有 ensureDeepSeekFileIds 只服务普通聊天发送，研究侧不改动
  assert.match(frontend, /ensureDeepSeekFileIds\(attachmentPayload, headers, controller\.signal\)/);
});

test('新模块与测试已注册到 package.json 的语法检查和测试脚本', () => {
  assert.match(pkg.scripts['test:syntax'], /render-api\/research-native-parse\.js/);
  assert.match(pkg.scripts.test, /tests\/research-native-parse-runtime\.test\.js/);
  assert.match(pkg.scripts.test, /tests\/research-native-parse-contract\.test\.js/);
});
