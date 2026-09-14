// A 档零成本工具集 · 契约测试
// 覆盖：16 个新工具的辅助函数实现 + 执行分支 + 前端卡片渲染 + 工具注册完整性
// 目标：确保 ① 每个工具都有 AI_TOOLS 定义与 executeToolCall 分支；
//       ② tool-helpers 纯函数输出正确（图表/PDF/二维码/diff/表格/公式等）；
//       ③ 前端能渲染对应的卡片类型（否则用户看不到成果）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');
const frontendSrc = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(root, 'css', 'ai-agent.css'), 'utf8');
const helpers = require(path.join(root, 'render-api', 'tool-helpers.js'));

const A_TIER = [
  'make_chart', 'generate_pdf', 'read_zip', 'image_info', 'image_process',
  'diff_text', 'sort_filter', 'markdown_table', 'qr_code', 'password_tool',
  'regex_test', 'url_parse', 'convert_data', 'batch_calc', 'page_meta', 'extract_links'
];

test('A 档：每个工具都有 AI_TOOLS 定义', () => {
  A_TIER.forEach((name) => {
    assert.match(serverSrc, new RegExp("name: '" + name + "'"), '缺少工具定义: ' + name);
  });
});

test('A 档：每个工具都有 executeToolCall 执行分支', () => {
  A_TIER.forEach((name) => {
    assert.match(serverSrc, new RegExp("case '" + name + "':"), '缺少执行分支: ' + name);
  });
});

test('A 档：server.js 已引入 tool-helpers 模块', () => {
  assert.match(serverSrc, /require\(['"]\.\/tool-helpers['"]\)/, '未引入 tool-helpers');
});

test('A 档：可视化类工具在卡片中返回可渲染载荷', () => {
  // make_chart 返回 image（栅格化或 SVG data URL）
  assert.match(serverSrc, /aiSiteCard\('make_chart'/, 'make_chart 缺少卡片');
  // generate_pdf / image_process 返回下载链接
  assert.match(serverSrc, /aiSiteCard\('generate_pdf'/, 'generate_pdf 缺少卡片');
  assert.match(serverSrc, /aiSiteCard\('image_process'/, 'image_process 缺少卡片');
  // qr_code 返回图片
  assert.match(serverSrc, /aiSiteCard\('qr_code'/, 'qr_code 缺少卡片');
  // markdown_table 返回结构化行供前端渲染表格
  assert.match(serverSrc, /aiSiteCard\('markdown_table'/, 'markdown_table 缺少卡片');
  assert.match(serverSrc, /rows_data:/, 'markdown_table 卡片缺少结构化行');
  // page_meta 返回链接预览
  assert.match(serverSrc, /aiSiteCard\('page_meta'/, 'page_meta 缺少卡片');
});

test('前端：渲染 A 档新增卡片类型', () => {
  ['make_chart', 'generate_pdf', 'qr_code', 'image_process', 'page_meta', 'markdown_table'].forEach((type) => {
    assert.match(frontendSrc, new RegExp("type === '" + type + "'"), '前端缺少卡片渲染分支: ' + type);
  });
});

test('前端：工具中文名映射覆盖全部 A 档工具', () => {
  A_TIER.forEach((name) => {
    assert.match(frontendSrc, new RegExp(name + ":\\s*'"), '缺少中文名映射: ' + name);
  });
});

test('CSS：为新增卡片类型提供样式', () => {
  ['ai-tool-card-chart', 'ai-tool-card-qr', 'ai-tool-card-table', 'ai-tool-card-img'].forEach((cls) => {
    assert.match(cssSrc, new RegExp('.' + cls), '缺少样式: ' + cls);
  });
});

// ── tool-helpers 纯函数正确性 ──

test('tool-helpers：buildChartSvg 支持四种图表类型', () => {
  ['bar', 'line', 'pie', 'scatter'].forEach((type) => {
    const svg = helpers.buildChartSvg(type, 'T', ['a', 'b', 'c'], [{ name: 's', data: [1, 2, 3] }]);
    assert.ok(typeof svg === 'string' && svg.indexOf('<svg') === 0, type + ' 未生成 SVG');
  });
});

test('tool-helpers：buildPdfBuffer 生成可解析的 PDF 结构', () => {
  const buf = helpers.buildPdfBuffer('Report', [
    { type: 'h1', text: 'Title' },
    { type: 'p', text: 'Hello world.' },
    { type: 'ul', items: ['one', 'two'] }
  ]);
  assert.ok(Buffer.isBuffer(buf), '未返回 Buffer');
  const head = buf.slice(0, 8).toString('latin1');
  assert.match(head, /%PDF-1\./, 'PDF 头不正确');
  assert.ok(buf.includes(Buffer.from('%%EOF')), 'PDF 缺少 EOF 标记');
});

test('tool-helpers：isPureAscii 正确拒绝中文', () => {
  assert.equal(helpers.isPureAscii('Hello 123'), true);
  assert.equal(helpers.isPureAscii('中文内容'), false);
  assert.equal(helpers.isPureAscii('Hello 小猫'), false);
});

test('tool-helpers：diffLines 正确识别增删改', () => {
  const d = helpers.diffLines('a\nb\nc', 'a\nX\nc');
  const types = d.map((x) => x.type);
  assert.deepEqual(types, ['same', 'del', 'add', 'same']);
});

test('tool-helpers：buildMarkdownTable 输出规范表格', () => {
  const md = helpers.buildMarkdownTable(['A', 'B'], [['1', '2'], ['3', '4']]);
  assert.equal(md, '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
});

test('tool-helpers：parseDelimited 处理引号内逗号', () => {
  const rows = helpers.parseDelimited('a,b\n1,"x,y"\n2,z');
  assert.deepEqual(rows, [['a', 'b'], ['1', 'x,y'], ['2', 'z']]);
});

test('tool-helpers：evaluateFormula 支持字段名与四则运算', () => {
  const v = helpers.evaluateFormula('单价 * 数量 * (1 + 0.13)', { 单价: 100, 数量: 3 });
  assert.ok(Math.abs(v - 339) < 1e-6, '公式结果错误: ' + v);
});

test('tool-helpers：evaluateFormula 不执行任意代码（白名单解析）', () => {
  // 不应能访问 process / require 等宿主对象
  assert.throws(() => helpers.evaluateFormula('process.exit(1)', {}));
  assert.throws(() => helpers.evaluateFormula('require("fs")', {}));
});

test('tool-helpers：buildQrSvg 生成有效矩阵', () => {
  const r = helpers.buildQrSvg('HELLO', 256, 4);
  assert.ok(r && r.version >= 1, '未生成二维码');
  // modules = 矩阵模块数（v1 为 21×21），size = 渲染像素边长，二者含义不同
  assert.equal(r.modules, 21, 'v1 模块数应为 21');
  assert.ok(r.size > 0, '渲染尺寸无效');
  assert.match(r.svg, /<svg/);
});

test('tool-helpers：buildQrSvg 拒绝超长内容', () => {
  const tooLong = 'x'.repeat(300);
  const r = helpers.buildQrSvg(tooLong, 256, 4);
  assert.equal(r, null, '超长内容应返回 null');
});

test('tool-helpers：generatePassword 与强度评估', () => {
  const pwd = helpers.generatePassword(16, { symbols: true });
  assert.equal(pwd.length, 16);
  const e = helpers.evaluatePasswordStrength(pwd);
  assert.ok(e.score >= 50, '强密码评分异常: ' + e.score);
  const weak = helpers.evaluatePasswordStrength('abc123');
  assert.ok(weak.score < 40, '弱密码评分异常: ' + weak.score);
});

test('tool-helpers：extractMetaFromHtml 提取标题与 OG', () => {
  const html = '<html><head><title>T</title><meta name="description" content="D">' +
    '<meta property="og:title" content="OT"><meta property="og:image" content="https://e.com/i.png">' +
    '</head><body><h1>H</h1></body></html>';
  const m = helpers.extractMetaFromHtml(html, 'https://example.com/');
  assert.equal(m.title, 'T');
  assert.equal(m.description, 'D');
  assert.equal(m.og.title, 'OT');
  assert.equal(m.og.image, 'https://e.com/i.png');
});

test('tool-helpers：extractLinksFromHtml 区分内外链', () => {
  const html = '<a href="/a">A</a><a href="https://other.com/b">B</a>';
  const r = helpers.extractLinksFromHtml(html, 'https://example.com/', 'all', '');
  assert.ok(r.internal_count >= 1, '未识别内链');
  assert.ok(r.external_count >= 1, '未识别外链');
});

test('A 档：generate_pdf 明确拒绝中文内容（避免乱码文件）', () => {
  assert.match(serverSrc, /isPureAscii\(gpAllText\)/, 'generate_pdf 未做纯 ASCII 校验');
  assert.match(serverSrc, /PDF 生成仅支持英文\/数字内容/, '缺少中文拒绝提示');
});

test('A 档：网络类工具做 SSRF 校验', () => {
  ['read_zip', 'image_info', 'image_process', 'page_meta', 'extract_links'].forEach((name) => {
    const idx = serverSrc.indexOf("case '" + name + "':");
    assert.ok(idx > -1, '未找到分支: ' + name);
    const seg = serverSrc.slice(idx, idx + 2000);
    assert.match(seg, /assertSafeWebUrl/, name + ' 缺少 SSRF 校验');
  });
});
