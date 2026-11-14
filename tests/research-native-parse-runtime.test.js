'use strict';
// 运行时测试：深入研究附件「官方解析混合增强」侧车模块。
// 全部用注入的 mock fetch / env，不发真实网络请求、不依赖 Supabase。
const test = require('node:test');
const assert = require('node:assert/strict');
const native = require('../render-api/research-native-parse');

const { createResearchNativeParse, needsEnhance, paragraphsFromText, FILES_URL, RESPONSES_URL, FLASH_MODEL } = native;

function pdfDataUrl(text) {
  return 'data:application/pdf;base64,' + Buffer.from(text || 'pdf bytes').toString('base64');
}
function doc(overrides) {
  return Object.assign({
    id: 'F1', name: 'report.pdf', bytes: 12, sha256: 'sha-1',
    status: 'unread', paragraphs: [], truncated: false, limitation: '', total_paragraphs: 0
  }, overrides || {});
}
function att(overrides) {
  return Object.assign({ name: 'report.pdf', type: 'application/pdf', data_url: pdfDataUrl() }, overrides || {});
}
function jsonResponse(ok, status, payload) {
  return { ok: ok, status: status, json: async () => payload };
}

/** 构造一个可编排的 fetchImpl：记录调用，按 url 返回预设响应。 */
function makeFetch(handlers) {
  const calls = [];
  const impl = async function(url, init) {
    calls.push({ url: url, init: init });
    const h = handlers[url];
    if (!h) return jsonResponse(false, 500, {});
    const out = typeof h === 'function' ? await h(init, calls.length) : h;
    return out;
  };
  impl.calls = calls;
  return impl;
}
function transcribeOk(text) {
  return jsonResponse(true, 200, {
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: text }] }]
  });
}
function uploadOk(id) {
  return jsonResponse(true, 200, { id: id || 'file-api-abc123', object: 'file', bytes: 12, filename: 'report.pdf', purpose: 'rich_layout_recognition' });
}
function env(key) {
  return { DEEPSEEK_API_KEY: key === undefined ? 'sk-test' : key };
}

// ---------- needsEnhance：触发条件 ----------
test('needsEnhance: 只有「本地未读出 / 被截断」的非图片、官方支持格式、且带原始数据的文档才补', () => {
  assert.equal(needsEnhance(doc({ status: 'unread' }), att()), true);
  assert.equal(needsEnhance(doc({ status: 'read', truncated: true }), att()), true);
  assert.equal(needsEnhance(doc({ status: 'read', truncated: false }), att()), false, '正常读全的不触发，控成本');
  assert.equal(needsEnhance(doc({ status: 'unread' }), att({ type: 'image/png', name: 'cat.png', data_url: 'data:image/png;base64,YQ==' })), false, '图片守边界');
  assert.equal(needsEnhance(doc({ status: 'unread', name: 'cat.png' }), att({ name: 'cat.png', data_url: pdfDataUrl() })), false, '图片扩展名也排除');
  assert.equal(needsEnhance(doc({ status: 'unread' }), att({ name: 'weird.xyz' })), false, '官方不支持的格式不补');
  assert.equal(needsEnhance(doc({ status: 'unread' }), att({ data_url: '' })), false, '没有原始文件数据不补');
  assert.equal(needsEnhance(doc({ status: 'unread' }), att({ data_url: 'https://private.test/x' })), false);
  assert.equal(needsEnhance(null, att()), false);
  assert.equal(needsEnhance(doc({ status: 'unread' }), null), false);
  // PPT / 扫描件这类本地明确不支持但官方支持的格式要能救回来
  assert.equal(needsEnhance(doc({ status: 'unread', name: 'slides.pptx' }), att({ name: 'slides.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })), true);
});

// ---------- paragraphsFromText：编号与截断 ----------
test('paragraphsFromText: 按空行/换行切段，编号接续已有段落，超长总量截断', () => {
  const r = paragraphsFromText('甲段落\n\n乙段落\n丙段落', 2);
  assert.deepEqual(r.paragraphs.map(p => p.id), ['P3', 'P4', 'P5'], '编号接在 startIndex=2 之后');
  assert.equal(r.paragraphs[0].text, '甲段落');
  assert.equal(r.truncated, false);
  const big = paragraphsFromText('x'.repeat(native.MAX_TRANSCRIBE_CHARS + 500), 0);
  assert.equal(big.truncated, true, '超过总上限要标注截断');
  assert.ok(big.paragraphs[0].text.length <= native.MAX_PARAGRAPH_CHARS, '单段不超过 4000');
  const total = big.paragraphs.reduce((n, p) => n + p.text.length, 0);
  assert.ok(total <= native.MAX_TRANSCRIBE_CHARS);
  assert.deepEqual(paragraphsFromText('', 0), { paragraphs: [], truncated: false });
  assert.deepEqual(paragraphsFromText('   \n\n  ', 0), { paragraphs: [], truncated: false });
});

// ---------- 开关与空输入 ----------
test('未配置密钥 / 显式关闭 / 空输入时完全不产生上游请求', async () => {
  const f = makeFetch({ [FILES_URL]: uploadOk(), [RESPONSES_URL]: transcribeOk('文本') });
  const noKey = createResearchNativeParse({ env: env(''), fetchImpl: f });
  const r1 = await noKey.enhance([doc()], [att()], {});
  assert.equal(r1.enhanced, 0);
  assert.equal(f.calls.length, 0);

  const off = createResearchNativeParse({ env: { DEEPSEEK_API_KEY: 'sk-test', RESEARCH_NATIVE_PARSE_ENABLED: 'false' }, fetchImpl: f });
  const r2 = await off.enhance([doc()], [att()], {});
  assert.equal(r2.enhanced, 0);
  assert.equal(f.calls.length, 0);

  const filesOff = createResearchNativeParse({ env: { DEEPSEEK_API_KEY: 'sk-test', DEEPSEEK_FILES_ENABLED: 'false' }, fetchImpl: f });
  assert.equal(filesOff.enabled(), false);

  const on = createResearchNativeParse({ env: env(), fetchImpl: f });
  const r3 = await on.enhance([doc({ status: 'read' })], [att()], {});
  assert.equal(r3.enhanced, 0, '正常读全的文件不触发');
  assert.equal(f.calls.length, 0);
  const r4 = await on.enhance([], [], {});
  assert.equal(r4.enhanced, 0);
  const r5 = await on.enhance(null, null, {});
  assert.equal(r5.enhanced, 0);
});

// ---------- 成功链路 ----------
test('本地未读出的 PDF：上传 + 官方转写 → 追加 [F:P] 段落并标记为已读取', async () => {
  const f = makeFetch({ [FILES_URL]: uploadOk(), [RESPONSES_URL]: transcribeOk('标题：季度报告\n\n营收 120 万\n\n图：增长曲线 12%→18%') });
  const parse = createResearchNativeParse({ env: env(), fetchImpl: f });
  const documents = [doc({ paragraphs: [{ id: 'P1', text: '本地仅有的一小段' }], status: 'unread', limitation: '本地解析失败' })];
  const enhancedDocs = [];
  const result = await parse.enhance(documents, [att()], {
    cacheKey: 'alice|fp',
    onEnhanced: d => enhancedDocs.push(d.id)
  });
  assert.equal(result.enhanced, 1);
  assert.equal(result.attempted, 1);
  assert.equal(documents[0].status, 'read');
  assert.equal(documents[0].native_parsed, true);
  assert.deepEqual(documents[0].paragraphs.map(p => p.id), ['P1', 'P2', 'P3', 'P4'], '新段落编号接在 P1 之后，引用体系不冲突');
  assert.match(documents[0].paragraphs[2].text, /营收 120 万/);
  assert.match(documents[0].paragraphs[3].text, /增长曲线/);
  assert.match(documents[0].limitation, /官方版面解析/);
  assert.match(documents[0].limitation, /\[F:P\] 段落编号/, '明确告知引用仍以段落编号为准');
  assert.match(documents[0].limitation, /本地解析失败/, '保留原有 limitation');
  assert.equal(documents[0].total_paragraphs, 4);
  assert.deepEqual(enhancedDocs, ['F1'], 'onEnhanced 回调可用于刷新前端 research_document');
  assert.equal(f.calls.length, 2);
});

test('上传请求：purpose 严格排在 file 之前，且按扩展名选 rich_layout_recognition', async () => {
  const f = makeFetch({ [FILES_URL]: uploadOk(), [RESPONSES_URL]: transcribeOk('正文') });
  const parse = createResearchNativeParse({ env: env(), fetchImpl: f });
  await parse.enhance([doc()], [att()], {});
  const up = f.calls.find(c => c.url === FILES_URL);
  assert.ok(up);
  assert.equal(up.init.method, 'POST');
  assert.match(up.init.headers.Authorization, /^Bearer sk-test$/);
  const keys = Array.from(up.init.body.keys());
  assert.deepEqual(keys, ['purpose', 'file'], '官方硬性要求顺序，错了直接 400');
  assert.equal(up.init.body.get('purpose'), 'rich_layout_recognition');

  const tr = f.calls.find(c => c.url === RESPONSES_URL);
  const body = JSON.parse(tr.init.body);
  assert.equal(body.model, FLASH_MODEL, '官方要求文件引用配 deepseek-flash');
  assert.deepEqual(body.reasoning, { effort: 'none' });
  assert.equal(body.stream, false);
  const parts = body.input[0].content;
  assert.equal(parts[0].type, 'input_text');
  assert.deepEqual(parts[1], { type: 'input_file', file_id: 'file-api-abc123' });
  assert.match(parts[0].text, /只转写/, '指令要求忠实转写，不总结不编造');
});

test('纯文本文件用 user_data，PPT 用 rich_layout_recognition', async () => {
  const f = makeFetch({ [FILES_URL]: uploadOk(), [RESPONSES_URL]: transcribeOk('正文') });
  const parse = createResearchNativeParse({ env: env(), fetchImpl: f });
  await parse.enhance(
    [doc({ name: 'notes.md', sha256: 's-md' }), doc({ id: 'F2', name: 'slides.pptx', sha256: 's-ppt' })],
    [att({ name: 'notes.md', type: 'text/markdown' }), att({ name: 'slides.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })],
    {}
  );
  const ups = f.calls.filter(c => c.url === FILES_URL);
  assert.equal(ups.length, 2);
  assert.equal(ups[0].init.body.get('purpose'), 'user_data');
  assert.equal(ups[1].init.body.get('purpose'), 'rich_layout_recognition');
});

// ---------- 降级：任何失败都静默，不阻断研究 ----------
test('上传失败（400/413/429/504）与上游返回异常一律静默，documents 保持原样', async () => {
  for (const status of [400, 413, 429, 504]) {
    const f = makeFetch({ [FILES_URL]: jsonResponse(false, status, { error: { message: 'bad' } }), [RESPONSES_URL]: transcribeOk('文本') });
    const parse = createResearchNativeParse({ env: env(), fetchImpl: f });
    const documents = [doc()];
    const r = await parse.enhance(documents, [att()], {});
    assert.equal(r.enhanced, 0, 'status ' + status);
    assert.equal(documents[0].status, 'unread');
    assert.equal(documents[0].paragraphs.length, 0);
    assert.equal(documents[0].native_parsed, undefined);
    assert.equal(f.calls.length, 1, '上传失败就不该再调转写');
  }
  // 上传返回非法 id
  const f2 = makeFetch({ [FILES_URL]: uploadOk('not-a-valid-id'), [RESPONSES_URL]: transcribeOk('文本') });
  const parse2 = createResearchNativeParse({ env: env(), fetchImpl: f2 });
  const d2 = [doc()];
  assert.equal((await parse2.enhance(d2, [att()], {})).enhanced, 0);
  assert.equal(d2[0].status, 'unread');
});

test('转写失败 / 返回空文本 / fetch 抛异常时一律静默回落', async () => {
  const cases = [
    makeFetch({ [FILES_URL]: uploadOk(), [RESPONSES_URL]: jsonResponse(false, 500, {}) }),
    makeFetch({ [FILES_URL]: uploadOk(), [RESPONSES_URL]: transcribeOk('') }),
    makeFetch({ [FILES_URL]: uploadOk(), [RESPONSES_URL]: transcribeOk('   ') }),
    async function() { throw new Error('network reset'); }
  ];
  for (const fetchImpl of cases) {
    const parse = createResearchNativeParse({ env: env(), fetchImpl: fetchImpl });
    const documents = [doc()];
    await assert.doesNotReject(() => parse.enhance(documents, [att()], {}));
    assert.equal(documents[0].status, 'unread');
    assert.equal(documents[0].paragraphs.length, 0);
  }
});

test('上游 400 且带 max_output_tokens 时去掉该字段重试一次，仍失败就放弃', async () => {
  let bodies = [];
  const f = makeFetch({
    [FILES_URL]: uploadOk(),
    [RESPONSES_URL]: async (init) => {
      bodies.push(JSON.parse(init.body));
      return bodies.length === 1 ? jsonResponse(false, 400, { error: { message: 'max_output_tokens unsupported' } }) : transcribeOk('重试成功的内容');
    }
  });
  const parse = createResearchNativeParse({ env: env(), fetchImpl: f });
  const documents = [doc()];
  const r = await parse.enhance(documents, [att()], {});
  assert.equal(r.enhanced, 1);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].max_output_tokens, 6000);
  assert.equal(bodies[1].max_output_tokens, undefined, '重试时摘掉不兼容字段');
  assert.equal(documents[0].paragraphs[0].text, '重试成功的内容');

  // 两次都 400 → 不再无限重试
  let n = 0;
  const f2 = makeFetch({ [FILES_URL]: uploadOk(), [RESPONSES_URL]: async () => { n++; return jsonResponse(false, 400, {}); } });
  const d2 = [doc()];
  assert.equal((await createResearchNativeParse({ env: env(), fetchImpl: f2 }).enhance(d2, [att()], {})).enhanced, 0);
  assert.equal(n, 2, '最多一次降级重试');
  assert.equal(d2[0].status, 'unread');
});

test('用户取消（signal 已 aborted）时不产生任何上游请求', async () => {
  const f = makeFetch({ [FILES_URL]: uploadOk(), [RESPONSES_URL]: transcribeOk('文本') });
  const parse = createResearchNativeParse({ env: env(), fetchImpl: f });
  const ctrl = new AbortController();
  ctrl.abort();
  const r = await parse.enhance([doc()], [att()], { signal: ctrl.signal });
  assert.equal(r.enhanced, 0);
  assert.equal(f.calls.length, 0);
  const ctrl2 = new AbortController();
  const parse2 = createResearchNativeParse({ env: env(), fetchImpl: f });
  const p = parse2.enhance([doc()], [att()], { signal: ctrl2.signal });
  ctrl2.abort();
  await p; // 不抛错
});

// ---------- 成本与复用 ----------
test('最多补 3 个候选文件，避免一次研究放大成本', async () => {
  const f = makeFetch({ [FILES_URL]: uploadOk(), [RESPONSES_URL]: transcribeOk('正文') });
  const parse = createResearchNativeParse({ env: env(), fetchImpl: f });
  const documents = [], attachments = [];
  for (let i = 0; i < 6; i++) {
    documents.push(doc({ id: 'F' + (i + 1), name: 'f' + i + '.pdf', sha256: 's' + i }));
    attachments.push(att({ name: 'f' + i + '.pdf' }));
  }
  const r = await parse.enhance(documents, attachments, {});
  assert.equal(r.attempted, native.MAX_CANDIDATES);
  assert.equal(r.enhanced, 3);
  assert.equal(documents[0].status, 'read');
  assert.equal(documents[2].status, 'read');
  assert.equal(documents[3].status, 'unread', '第 4 个起不补');
  assert.equal(f.calls.filter(c => c.url === FILES_URL).length, 3);
});

test('相同资料（同 cacheKey+sha256+name）二次研究命中进程内缓存，不重复上传/转写/计费', async () => {
  const f = makeFetch({ [FILES_URL]: uploadOk(), [RESPONSES_URL]: transcribeOk('缓存的正文') });
  const parse = createResearchNativeParse({ env: env(), fetchImpl: f });
  const opts = { cacheKey: 'alice|fp' };
  const d1 = [doc()];
  const r1 = await parse.enhance(d1, [att()], opts);
  assert.equal(r1.enhanced, 1);
  assert.equal(f.calls.length, 2);
  const d2 = [doc()];
  const r2 = await parse.enhance(d2, [att()], opts);
  assert.equal(r2.enhanced, 1);
  assert.equal(f.calls.length, 2, '第二次零上游请求');
  assert.equal(d2[0].paragraphs[0].text, '缓存的正文');
  assert.equal(d2[0].status, 'read');
  // 换一个 sha256 视为新文件，应重新解析
  const d3 = [doc({ sha256: 'sha-new' })];
  await parse.enhance(d3, [att()], opts);
  assert.equal(f.calls.length, 4);
});

test('附件已带合法 file_id 时跳过上传，直接转写', async () => {
  const f = makeFetch({ [FILES_URL]: uploadOk(), [RESPONSES_URL]: transcribeOk('复用 id 的正文') });
  const parse = createResearchNativeParse({ env: env(), fetchImpl: f });
  const documents = [doc()];
  const r = await parse.enhance(documents, [att({ file_id: 'file-api-ready123' })], {});
  assert.equal(r.enhanced, 1);
  const ups = f.calls.filter(c => c.url === FILES_URL);
  assert.equal(ups.length, 0, '不该重复上传计费');
  const tr = f.calls.find(c => c.url === RESPONSES_URL);
  assert.equal(JSON.parse(tr.init.body).input[0].content[1].file_id, 'file-api-ready123');
});

test('documentsContext 能把补读出的段落原样渲染成 [F:P] 引用，无需改研究主链路', async () => {
  const f = makeFetch({ [FILES_URL]: uploadOk(), [RESPONSES_URL]: transcribeOk('甲事实\n\n乙数据') });
  const parse = createResearchNativeParse({ env: env(), fetchImpl: f });
  const research = require('../render-api/research-documents');
  const documents = [doc()];
  await parse.enhance(documents, [att()], {});
  const context = research.documentsContext(documents);
  assert.match(context, /\[F1:P1\] 甲事实/);
  assert.match(context, /\[F1:P2\] 乙数据/);
  assert.match(context, /官方版面解析/);
  const pub = research.publicDocuments(documents)[0];
  assert.equal(pub.status, 'read');
  assert.equal(pub.used_paragraphs, 2);
  assert.doesNotMatch(JSON.stringify(pub), /data_url|dataUrl/, '公开结构不泄露原始文件');
});

test('原始 attachments 不被修改（密钥与文件数据只在服务端内存流转）', async () => {
  const f = makeFetch({ [FILES_URL]: uploadOk(), [RESPONSES_URL]: transcribeOk('正文') });
  const parse = createResearchNativeParse({ env: env(), fetchImpl: f });
  const attachments = [att()];
  const copy = JSON.stringify(attachments);
  await parse.enhance([doc()], attachments, {});
  assert.equal(JSON.stringify(attachments), copy);
});
