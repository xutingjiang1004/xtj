'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { aiPolishFixture, openModelPicker, models } = require('./helpers/ai-polish-fixture');
async function fixture(t, options) { const f = await aiPolishFixture(options); t.after(() => f.close()); return f; }
test('model and thinking disclosures support native keys, named lists and focus restoration', { timeout: 45000 }, async t => {
  const f = await fixture(t), p = f.page;
  await p.locator('.ai-plus-btn').click();
  assert.equal(await p.locator('#aiPlusPanelShell').getAttribute('role'), 'region');
  for (const kind of ['model', 'think']) {
    const row = p.locator('[data-action="open-' + kind + '"]');
    await row.focus(); await p.keyboard.press('Enter');
    await p.waitForSelector('.ai-select-pop');
    assert.ok(await p.locator('.ai-select-pop-list').getAttribute('aria-label'));
    assert.equal(await p.evaluate(() => document.activeElement.getAttribute('role')), 'option');
    await p.keyboard.press('End');
    assert.equal(await p.evaluate(() => document.activeElement === [...document.querySelectorAll('.ai-select-pop-list [role="option"]')].at(-1)), true);
    await p.keyboard.press('Home');
    assert.equal(await p.evaluate(() => document.activeElement === document.querySelector('.ai-select-pop-list [role="option"]')), true);
    await p.keyboard.press('Escape');
    assert.equal(await row.evaluate(n => document.activeElement === n), true);
    assert.equal(await row.getAttribute('aria-expanded'), 'false');
    assert.equal(await p.locator('.ai-plus-btn').getAttribute('aria-expanded'), 'true');
  }
  await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'aiPlusBtn');
  assert.deepEqual(f.errors, []);
});
for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) test('long model lists and the options panel stay reachable at ' + viewport.width, { timeout: 45000 }, async t => {
  const f = await fixture(t, { viewport, models: models(12) }), p = f.page;
  await openModelPicker(p);
  await p.waitForFunction(() => !document.querySelector('#aiPlusPanelShell').classList.contains('is-opening') && document.querySelector('.ai-select-pop').getAnimations().every(a => a.playState !== 'running'));
  const bounds = await p.evaluate(() => {
    const r = document.querySelector('.ai-select-pop').getBoundingClientRect(), panel = document.querySelector('#aiPlusPanelShell').getBoundingClientRect(), header = document.querySelector('.ai-chat-header').getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, panelTop: panel.top, headerBottom: header.bottom, height: innerHeight };
  });
  assert.ok(bounds.top >= 10 && bounds.bottom <= bounds.height - 10, JSON.stringify(bounds));
  assert.ok(bounds.panelTop >= bounds.headerBottom, JSON.stringify(bounds));
  await p.getByRole('option', { name: '＋ 添加自定义模型', exact: true }).click();
  await p.locator('#aiCmApiKey').fill('isolated-only-key'); await p.locator('#aiCmLabel').fill('第13个模型');
  await p.locator('#aiCmSaveBtn').click();
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('xtj_ai_custom_models__alice') || '[]').some(m => m.label === '第13个模型'));
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('xtj_ai_custom_models__alice')).length), 13);
  assert.match(await p.locator('#aiModelSummary').textContent(), /第13个模型/);
  assert.deepEqual(f.errors, []);
});
test('rapid picker replacement releases old nodes and repeated page opens release document listeners', { timeout: 60000 }, async t => {
  const f = await fixture(t), p = f.page, cdp = await p.context().newCDPSession(p);
  const scripts = new Map(); cdp.on('Debugger.scriptParsed', event => scripts.set(event.scriptId, event.url)); await cdp.send('Debugger.enable');
  async function listeners() {
    const object = await cdp.send('Runtime.evaluate', { expression: 'document', objectGroup: 'ai-polish' });
    const data = await cdp.send('DOMDebugger.getEventListeners', { objectId: object.result.objectId });
    return data.listeners.filter(l => (l.type === 'pointerdown' || l.type === 'keydown') && /\/ai-agent(?:\.min)?\.js/.test(scripts.get(l.scriptId) || '')).length;
  }
  const initial = await listeners(); assert.ok(initial > 0, 'CDP must identify the actual AI script listeners'); await openModelPicker(p);
  await p.evaluate(() => { for (let i = 0; i < 8; i++) { document.querySelector('.ai-select-pop:not(.is-closing) .ai-select-pop-close').click(); document.querySelector('[data-action="open-model"]').click(); } });
  assert.equal(await p.locator('.ai-select-pop').count(), 1);
  for (let i = 0; i < 4; i++) { await p.evaluate(() => __xtjCloseAiChat()); await p.evaluate(() => __xtjOpenAiChat()); await p.waitForFunction(() => document.activeElement.id === 'aiChatMsgInput'); }
  assert.equal(await p.locator('.ai-select-pop').count(), 0);
  assert.equal(await listeners(), initial);
  assert.deepEqual(f.errors, []);
});
test('custom-model modal traps focus, closes by Escape and restores the page', { timeout: 45000 }, async t => {
  const f = await fixture(t), p = f.page; await openModelPicker(p);
  await p.getByRole('option', { name: '＋ 添加自定义模型', exact: true }).click(); await p.waitForSelector('#aiCustomModelModal.is-ready');
  await p.locator('#aiCmSaveBtn').focus(); await p.keyboard.press('Tab');
  assert.equal(await p.evaluate(() => !!document.activeElement.closest('#aiCustomModelModal')), true);
  await p.keyboard.press('Shift+Tab');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'aiCmSaveBtn');
  await p.keyboard.press('Escape'); await p.waitForSelector('#aiCustomModelModal', { state: 'detached' });
  assert.equal(await p.evaluate(() => !!document.activeElement.closest('#aiChatRoot') && !document.activeElement.closest('[inert]')), true);
  assert.deepEqual(f.errors, []);
});
test('history survives close/reopen during its exit animation and its actions work by keyboard', { timeout: 45000 }, async t => {
  const f = await fixture(t), p = f.page, button = p.getByRole('button', { name: '历史会话', exact: true });
  await button.click(); await p.waitForSelector('.ai-conv-page-shell.is-open');
  await button.click(); await p.evaluate(() => document.querySelector('.ai-chat-hist-btn').click());
  await p.waitForSelector('.ai-conv-page-shell.is-open'); await p.waitForTimeout(350);
  assert.equal(await p.locator('.ai-conv-page-shell').count(), 1);
  assert.equal(await p.locator('.ai-conv-open').isVisible(), true);
  assert.equal(await p.locator('.ai-conv-rename').evaluate(n => n.tagName === 'BUTTON' && n.tabIndex === 0), true);
  await p.locator('.ai-conv-rename').focus(); await p.keyboard.press('Enter');
  await p.locator('.xtj-prompt-dialog input').waitFor(); await p.locator('.xtj-prompt-dialog input').fill('键盘重命名'); await p.keyboard.press('Enter');
  await p.locator('.ai-conv-title').filter({hasText:'键盘重命名'}).waitFor();
  assert.equal(await p.locator('.ai-conv-title').textContent(), '键盘重命名');
  await p.locator('.ai-conv-del').focus(); await p.keyboard.press('Enter');
  await p.waitForSelector('#ppConfirmOverlay.active'); await p.keyboard.press('Escape');
  await p.waitForSelector('#ppConfirmOverlay:not(.active)');
  assert.equal(await p.locator('.ai-conv-item').count(), 1);
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#aiChatInputBar').isVisible(), true);
  assert.deepEqual(f.errors, []);
});
test('model synchronization failures show pending status and the twenty-model limit preserves the form', { timeout: 60000 }, async t => {
  const f = await fixture(t, { modelWriteStatus: 503 }), p = f.page; await openModelPicker(p);
  await p.getByRole('option', { name: '＋ 添加自定义模型', exact: true }).click();
  await p.locator('#aiCmApiKey').fill('isolated-only-key'); await p.locator('#aiCmSaveBtn').click();
  await p.waitForFunction(() => [...document.querySelectorAll('#toastContainer .toast')].some(n => n.textContent.includes('密钥仅暂留本页')));
  assert.equal(await p.evaluate(() => !!localStorage.getItem('xtj_ai_models_pending__alice')), true);
  const capped = await fixture(t, { models: models(20) }), q = capped.page; await openModelPicker(q);
  await q.getByRole('option', { name: '＋ 添加自定义模型', exact: true }).click(); await q.locator('#aiCmApiKey').fill('isolated-only-key'); await q.locator('#aiCmSaveBtn').click();
  assert.match(await q.locator('#aiCmFeedback').textContent(), /最多保存 20/);
  assert.equal(await q.locator('#aiCustomModelModal').isVisible(), true);
  assert.equal(await q.evaluate(() => aiPolish.calls.filter(c => c.method === 'PUT').length), 0);
  assert.deepEqual(f.errors, []); assert.deepEqual(capped.errors, []);
});
test('sending speech input prevents even captured late recognition callbacks from replacing the next draft', { timeout: 45000 }, async t => {
  const f = await fixture(t), p = f.page;
  await p.evaluate(() => window.SpeechRecognition = class { constructor() { window.polishRecognition = this; } start() {} stop() {} abort() { this.aborted = true; } });
  await p.locator('#aiChatVoiceBtn').click();
  await p.evaluate(() => { window.lateRecognition = polishRecognition.onresult; lateRecognition({ results: [[{ transcript: '旧问题' }]] }); });
  await p.locator('#aiChatSendBtn').click(); await p.waitForFunction(() => aiPolish.streams.length > 0);
  await p.locator('#aiChatMsgInput').fill('下一条草稿'); await p.evaluate(() => lateRecognition({ results: [[{ transcript: '迟到的旧问题' }]] }));
  assert.equal(await p.locator('#aiChatMsgInput').inputValue(), '下一条草稿');
  assert.equal(await p.evaluate(() => polishRecognition.aborted), true);
  assert.equal(await p.locator('#aiChatVoiceBtn').evaluate(n => n.classList.contains('listening')), false);
  assert.deepEqual(f.errors, []);
});
test('reduced motion removes picker stagger and research history keeps keyboard focus within the content column', { timeout: 45000 }, async t => {
  const f = await fixture(t, { viewport: { width: 1440, height: 900 } }), p = f.page;
  await p.emulateMedia({ reducedMotion: 'reduce' }); await openModelPicker(p);
  const animation = await p.locator('.ai-select-pop-item').first().evaluate(n => ({ name: getComputedStyle(n).animationName, delay: getComputedStyle(n).animationDelay }));
  assert.equal(animation.name, 'none');
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.locator('#aiDeepThinkToggle').click(); await p.locator('.dt-research-history-btn').click();
  const bounds = await p.evaluate(() => { const r = document.querySelector('.dt-research-history-panel').getBoundingClientRect(), page = document.querySelector('#panelDeepThink .dt-page').getBoundingClientRect(); return { left: r.left, right: r.right, pageLeft: page.left, pageRight: page.right, focused: !!document.activeElement.closest('.dt-research-history-panel') }; });
  assert.ok(bounds.left >= bounds.pageLeft && bounds.right <= bounds.pageRight, JSON.stringify(bounds)); assert.equal(bounds.focused, true);
  await p.keyboard.press('Escape'); assert.equal(await p.locator('.dt-research-history-panel').count(), 0);
  assert.equal(await p.locator('.dt-research-history-btn').evaluate(n => document.activeElement === n), true);
  assert.deepEqual(f.errors, []);
});
test('native research batches burst packets and renders the authoritative completed answer', { timeout: 45000 }, async t => {
  const f = await fixture(t), p = f.page; await p.locator('#aiDeepThinkToggle').click();
  await p.locator('#dtInput').fill('研究显示测试'); await p.locator('#dtSendBtn').click();
  await p.waitForFunction(() => aiPolish.streams.some(s => s.path.endsWith('/research/stream')));
  await p.evaluate(() => {
    aiPolishEmit({ type: 'research_stage', stage: 'synthesize', message: '真实模拟汇总阶段' });
    const target = document.querySelector('#dtMessages .ai-think-answer'); window.polishMutations = 0;
    window.polishObserver = new MutationObserver(records => polishMutations += records.length); polishObserver.observe(target, { subtree: true, childList: true, characterData: true });
    for (let i = 0; i < 80; i++) aiPolishEmit({ type: 'research_content', content: '段落' + i + '。' });
  });
  await p.waitForFunction(() => document.querySelector('#dtMessages .ai-think-answer').textContent.includes('段落79'));
  assert.ok(await p.evaluate(() => polishMutations <= 6), 'one network burst must coalesce its eighty text-node updates');
  await p.evaluate(() => { polishObserver.disconnect(); aiPolishEmit({ type: 'research_done', answer: Array.from({ length: 80 }, (_, i) => '段落' + i + '。').join('') + '\n\n完整终稿的追加结论。', conversation_id: 'POLISHNEW01', message_id: 'local-report', saved: true }); });
  await p.waitForFunction(() => document.getElementById('dtMessages').textContent.includes('完整终稿的追加结论'));
  assert.deepEqual(f.errors, []);
});
test('stream cache preserves full Markdown semantics and skips parsing closed paragraphs on later frames', { timeout: 45000 }, async t => {
  const f = await fixture(t), p = f.page, source = fs.readFileSync('js/ai-agent.js', 'utf8');
  const section = (a, b) => { const start = source.indexOf(a); return source.slice(start, source.indexOf(b, start)); };
  await p.evaluate(code => { window.S = { activeRenderers: [], paused: false }; window.prefersReducedMotion = () => false; window.AI_DEBUG = false; window.escapeHtml = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); window.escapeAttr = window.escapeHtml; window.eval(code); }, section('  function aiDecodeHtmlEntities(', '  function setupBubbleCopy(') + '\n' + section('  function takeSmoothTextChunk(', '  function bindVisualViewport('));
  const result = await p.evaluate(() => {
    const output = document.createElement('div'); document.body.appendChild(output);
    const cases = ['第一段 **重点** 与 [来源](https://example.com?a=1&b=2)\n\n第二段尾部。', '- 第一项\n\n- 第二项\n\n正文', '前言\n\n```js\nconst a=1;\n\n// 空行\n```\n\n尾部', '前言\n\n**跨\n\n段落** 后续', '前言\n\n[尚未闭合\n\n的链接](https://example.com)', '前言\n\n|甲|乙|\n|---|---|\n|一|二|\n\n结论', '## 标题\n\n正文\n\n尾部', '原文 <script>alert(1)</script>\n\n安全正文'];
    const mismatches = [];
    for (const text of cases) {
      output.replaceChildren(); const renderer = createSmoothTextRenderer(output); let prefix = '';
      for (let i = 0; i < text.length; i += 7) { const chunk = text.slice(i, i + 7); prefix += chunk; renderer.append(chunk); renderer.flush(); const copy = output.cloneNode(true); copy.querySelectorAll('.ai-stream-cursor').forEach(n => n.remove()); if (copy.innerHTML !== renderMarkdown(prefix, true)) mismatches.push({ prefix, got: copy.innerHTML, expected: renderMarkdown(prefix, true) }); }
      renderer.finish(text);
    }
    const render = window.renderMarkdown, lengths = []; window.renderMarkdown = (text, live) => { lengths.push(text.length); return render(text, live); };
    output.replaceChildren(); const renderer = createSmoothTextRenderer(output); renderer.append('已完成 **重点** 与 [来源](https://example.com)。\n\n'.repeat(500)); renderer.flush(); const first = output.firstChild; lengths.length = 0;
    for (let i = 0; i < 20; i++) { renderer.append('正在增长的正文。'); renderer.flush(); }
    const measured = lengths.slice(), stable = output.firstChild === first; renderer.finish(); window.renderMarkdown = render;
    return { mismatches, maximumParsedSuffix: Math.max(...measured), stable };
  });
  assert.deepEqual(result.mismatches, []); assert.ok(result.maximumParsedSuffix < 1000, JSON.stringify(result)); assert.equal(result.stable, true);
  assert.deepEqual(f.errors, []);
});
