'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const agent = fs.readFileSync('js/ai-agent.js', 'utf8');
function section(start, end) {
  const offset = agent.indexOf(start);
  assert.ok(offset >= 0);
  return agent.slice(offset, agent.indexOf(end, offset));
}
async function fixture() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent('<div id="output"></div><div id="timeline"></div>');
  await page.addStyleTag({ content: fs.readFileSync('css/ui-enhance.css', 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync('js/ai-core/stream-renderer.js', 'utf8') });
  await page.evaluate(({ stream, tools }) => {
    window.S = { paused: false, activeRenderers: [] };
    window.AI_DEBUG = false;
    window.prefersReducedMotion = () => false;
    window.renderMarkdown = text => '<span class="ai-stream-soft">' + text + '</span>';
    window.XtjAiCore.Markdown = { render: window.renderMarkdown };
    window.el = (tag, attrs) => {
      const node = document.createElement(tag);
      for (const key in attrs) key === 'text' ? node.textContent = attrs[key] : node.setAttribute(key, attrs[key]);
      return node;
    };
    window.toolActivityDoneLabel = () => '已使用工具';
    window.moveToolAreaBelowBubble = () => {};
    window.eval(stream + '\n' + tools);
  }, {
    stream: section('  function takeSmoothTextChunk(', '  function bindVisualViewport('),
    tools: section('  function ensureToolActivity(', '  function settleOrganizingStep(')
  });
  return { browser, page };
}
for (const implementation of ['main', 'shared']) {
  test(`${implementation}: growing text keeps existing elements, animation and code scroll`, async () => {
    const { browser, page } = await fixture();
    try {
      const result = await page.evaluate(kind => {
        const output = document.getElementById('output');
        const renderer = kind === 'main' ? createSmoothTextRenderer(output) : XtjAiCore.StreamRenderer.create(output);
        renderer.append('hello <pre style="width:60px;overflow:auto"><code>xxxxxxxxxxxxxxxxxxxxxxxx</code></pre>');
        renderer.flush();
        const span = output.firstChild, pre = output.querySelector('pre'), code = pre.firstChild;
        pre.scrollLeft = 30;
        const originalScroll = pre.scrollLeft;
        renderer.append(' world'); renderer.flush();
        const stable = output.firstChild === span && output.querySelector('pre') === pre && pre.firstChild === code;
        const scroll = pre.scrollLeft === originalScroll;
        const animation = span.getAnimations()[0];
        renderer.append('!'); renderer.flush();
        const sameAnimation = !animation || span.getAnimations()[0] === animation;
        renderer.finish();
        return { stable, scroll, sameAnimation, text: output.textContent, cursors: output.querySelectorAll('.ai-stream-cursor').length };
      }, implementation);
      assert.equal(result.stable, true);
      assert.equal(result.scroll, true);
      assert.equal(result.sameAnimation, true);
      assert.equal(result.text, 'hello xxxxxxxxxxxxxxxxxxxxxxxx world!');
      assert.equal(result.cursors, 0);
    } finally { await browser.close(); }
  });
  test(`${implementation}: finish drains queued text once; stop blocks late chunks`, async () => {
    const { browser, page } = await fixture();
    try {
      const result = await page.evaluate(kind => {
        const output = document.getElementById('output');
        let done = 0;
        const create = opts => kind === 'main' ? createSmoothTextRenderer(output, opts) : XtjAiCore.StreamRenderer.create(output, opts);
        const renderer = create({ plainStream: true, onDone: () => done++ });
        renderer.append('<literal>猫🐈尾部'); renderer.finish(); renderer.finish(); renderer.append('late');
        const final = output.textContent;
        output.replaceChildren();
        const stopped = create({ plainStream: true });
        stopped.append('before'); stopped.stop(); stopped.append('after'); stopped.flush();
        const stoppedText = output.textContent;
        const classAfterStop = output.classList.contains('ai-streaming-soft');
        const cursorAfterStop = output.querySelectorAll('.ai-stream-cursor').length;
        output.replaceChildren();
        const cancelled = create(); cancelled.append('discard'); cancelled.flush(); cancelled.cancel();
        return { done, final, stoppedText, classAfterStop, cursorAfterStop, classAfterCancel: output.classList.contains('ai-streaming-soft'), active: S.activeRenderers.length };
      }, implementation);
      assert.deepEqual(result, { done: 1, final: '<literal>猫🐈尾部', stoppedText: 'before', classAfterStop: false, cursorAfterStop: 0, classAfterCancel: false, active: 0 });
    } finally { await browser.close(); }
  });
}
test('completed tool activity remembers user expansion across late updates; empty rounds settle accessibly', async () => {
  const { browser, page } = await fixture();
  try {
    const result = await page.evaluate(() => {
      const activity = ensureToolActivity(document.getElementById('timeline'));
      const round = createToolRound('搜索', 'r1');
      activity.__body.appendChild(round.box);
      round.list.appendChild(el('div', { class: 'ai-tool-step is-done' }));
      updateToolRoundState(round.box);
      activity.querySelector('.ai-tool-activity-head').click(); round.head.click();
      updateToolRoundState(round.box); updateToolActivity(activity);
      const expanded = !activity.classList.contains('is-collapsed') && !round.box.classList.contains('is-collapsed');
      const aria = activity.querySelector('.ai-tool-activity-head').getAttribute('aria-expanded');
      const empty = createToolRound('等待', 'r2'); activity.__body.appendChild(empty.box);
      updateToolRoundState(empty.box);
      return { expanded, aria, emptyAria: empty.head.getAttribute('aria-expanded'), emptyLabel: empty.box.querySelector('.ai-tool-round-label').textContent, running: empty.box.classList.contains('is-running') };
    });
    assert.deepEqual(result, { expanded: true, aria: 'true', emptyAria: 'false', emptyLabel: '未调用工具', running: false });
    await page.evaluate(() => document.documentElement.setAttribute('data-xtj-motion', 'off'));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ai-tool-step')).animationName), 'none');
  } finally { await browser.close(); }
});
test('shared renderer reset clears a queued frame and the previous plain text node', async () => {
  const { browser, page } = await fixture();
  try {
    const result = await page.evaluate(async () => {
      const output = document.getElementById('output');
      const renderer = XtjAiCore.StreamRenderer.create(output, { plainStream: true });
      renderer.append('old'); renderer.flush(); renderer.append('queued'); renderer.reset();
      const afterReset = output.textContent;
      renderer.append('new'); renderer.finish();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { afterReset, final: output.textContent, cursors: output.querySelectorAll('.ai-stream-cursor').length };
    });
    assert.deepEqual(result, { afterReset: '', final: 'new', cursors: 0 });
  } finally { await browser.close(); }
});
