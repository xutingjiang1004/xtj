'use strict';
// B-02 回归：Markdown 图片无尺寸、无失败兜底。
// 修复前：markdown-renderer.js 生成裸 <img src alt loading="lazy" />，
//   无 class/onerror/宽高；css/ai-agent.css 全文无 .ai-msg-bubble img 规则；
//   超大图会撑破气泡，破图只剩浏览器破图图标、无任何提示。
// 修复后：渲染器给 Markdown 图片加 class="ai-md-img"（并放进透传白名单，
//   不被 cleanPassthroughHtml 洗掉）；CSS 约束气泡内 Markdown 图片
//   max-width:100%/max-height:400px；消息容器用捕获阶段委托监听 img 的
//   error 事件（内联 onerror 会被渲染器安全策略拦截），破图隐藏并换成
//   “图片加载失败”文字提示。data:image 内联图（.ai-uploaded-image，
//   行内 max-width:100%;max-height:300px）不受影响。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { postBrowserFixture, wireAiChat } = require('./helpers/post-browser-fixture');

const rendererSrc = fs.readFileSync('js/ai-core/markdown-renderer.js', 'utf8');
const agentSrc = fs.readFileSync('js/ai-agent.js', 'utf8');
const cssSrc = fs.readFileSync('css/ai-agent.css', 'utf8');

function chromiumOpts() {
  return { executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] };
}

test('B-02: 渲染器给 Markdown 图片加 ai-md-img，透传白名单放行 class', () => {
  assert.ok(rendererSrc.includes("class=\\\"ai-md-img\\\"") || rendererSrc.includes('class="ai-md-img"'), '渲染器生成的 img 应带 ai-md-img class');
  assert.ok(/img:\s*\{[^}]*class:1/.test(rendererSrc), '透传白名单 img 应放行 class，否则会被 cleanPassthroughHtml 洗掉');
  const imgGenIdx = rendererSrc.indexOf("6. Images: ![alt](url)");
  assert.ok(imgGenIdx >= 0, '应有图片生成处');
  const imgGen = rendererSrc.slice(imgGenIdx, imgGenIdx + 500);
  assert.ok(!/onerror\s*=/.test(imgGen), '生成的 img 不应带内联 onerror（会被安全策略拦截，改用容器委托）');
});

test('B-02: CSS 约束气泡内 Markdown 图片尺寸，不碰内联图', () => {
  assert.ok(cssSrc.includes('.ai-msg-bubble img.ai-md-img'), 'CSS 应有气泡内 Markdown 图片规则');
  const idx = cssSrc.indexOf('.ai-msg-bubble img.ai-md-img');
  const rule = cssSrc.slice(idx, cssSrc.indexOf('}', idx));
  assert.ok(/max-width:\s*100%/.test(rule), 'Markdown 图片应 max-width:100%');
  assert.ok(/max-height:\s*400px/.test(rule), 'Markdown 图片应 max-height:400px');
  assert.ok(!/\.ai-msg-bubble img\.ai-uploaded-image/.test(cssSrc), '不应另写规则覆盖内联图（它已有行内 300px 上限）');
});

test('B-02: 超宽 Markdown 图片被约束在气泡宽度内', { timeout: 30000 }, async () => {
  const browser = await chromium.launch(chromiumOpts());
  try {
    const page = await browser.newPage();
    await page.setContent('<div class="ai-msg-bubble" id="bubble" style="width:300px"><div id="output"></div></div>');
    await page.addStyleTag({ content: cssSrc });
    await page.evaluate((src) => { window.eval(src); }, rendererSrc);
    const r = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 2000; canvas.height = 800;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, 2000, 800);
      const dataUrl = canvas.toDataURL('image/png');
      output.innerHTML = window.XtjAiCore.Markdown.render('![宽图](' + dataUrl + ')');
      const img = output.querySelector('img');
      return { hasImg: !!img, cls: img ? img.className : '', width: img ? img.getBoundingClientRect().width : 0 };
    });
    assert.ok(r.hasImg, '应渲染出 img');
    assert.ok(String(r.cls).includes('ai-md-img'), 'img 应带 ai-md-img class，实际 ' + r.cls);
    assert.ok(r.width > 0 && r.width <= 300, '超宽图应被约束在气泡宽度内，实际 ' + r.width);
  } finally { await browser.close(); }
});

test('B-02: 破图被隐藏并换成“图片加载失败”提示', { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ counts: [1] });
  try {
    await wireAiChat(f.page);
    await f.page.locator('#aiChatMsgInput').fill('给一张图');
    await f.page.locator('#aiChatSendBtn').click();
    await f.page.waitForFunction(() => !!window.testStream);
    await f.page.evaluate(() => {
      testEmit({ type: 'content', text: '看这张图：\n\n![示意图](https://127.0.0.1:9/broken.png)\n\n就这些。' });
    });
    await f.page.evaluate(() => {
      testEmit({ type: 'done', complete: true, saved: true, content: '看这张图：\n\n![示意图](https://127.0.0.1:9/broken.png)\n\n就这些。', reasoning: '', thinking_mode: 'off' });
    });
    await f.page.waitForSelector('.ai-md-img-broken-note', { timeout: 20000 });
    const note = await f.page.locator('.ai-md-img-broken-note').first().textContent();
    assert.match(note, /图片加载失败/);
    const imgVisible = await f.page.locator('.ai-msg.assistant .ai-msg-bubble img.ai-md-img').first().isVisible().catch(() => false);
    assert.equal(imgVisible, false, '破图应被隐藏');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('B-02: 消息容器用捕获阶段委托监听 img 加载失败', () => {
  const idx = agentSrc.indexOf("messagesEl.addEventListener('error'");
  assert.ok(idx >= 0, '消息容器应监听 error 事件做破图兜底');
  const snippet = agentSrc.slice(idx, idx + 900);
  assert.ok(snippet.includes(', true'), 'error 事件不冒泡，应在捕获阶段监听');
  assert.ok(snippet.includes('ai-md-img-broken-note') || snippet.includes('图片加载失败'), '失败时应挂“图片加载失败”提示');
});
