'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { aiPolishFixture } = require('./helpers/ai-polish-fixture');
async function emit(p, event) { await p.evaluate(event => aiPolishEmit(event), event); }
const card = (id, type, title, data, call) => ({ type: 'card', card: { protocol: 'xtj.ai.ui.v1', id, type, title, tool_call_id: call, data } });
async function start(p, text) {
  await p.locator('#aiChatMsgInput').fill(text); await p.locator('#aiChatSendBtn').click(); await p.waitForFunction(() => aiPolish.streams.length >= 1);
}
async function finish(p, text) {
  await emit(p, { type: 'content', text }); await emit(p, { type: 'done', content: text, complete: true, saved: true, conversation_id: 'AGT01', thinking_elapsed_ms: 400, thinking_mode: 'low' });
  await p.waitForFunction(() => !document.querySelector('.ai-msg.generating'));
}

test('the new tools show readable Chinese step names, never raw tool ids', { timeout: 60000 }, async () => {
  const f = await aiPolishFixture(), p = f.page;
  try {
    await start(p, '帮我查几样东西');
    const tools = [['a', 'wiki_summary'], ['b', 'search_papers'], ['c', 'github_repo'], ['d', 'verify_claims'], ['e', 'parallel_subtasks'], ['f', 'workspace_files'], ['g', 'memory_update'], ['h', 'wayback']];
    await emit(p, { type: 'tool_calls', tools: tools.map(([id, name]) => ({ id, name, args: {} })) });
    await p.waitForFunction(() => document.querySelectorAll('.ai-process-rail .ai-tool-step').length === 8);
    const labels = await p.evaluate(() => [...document.querySelectorAll('.ai-process-rail .ai-tool-step')].map(n => n.textContent));
    for (const raw of ['wiki_summary', 'search_papers', 'github_repo', 'verify_claims', 'parallel_subtasks', 'workspace_files', 'memory_update', 'wayback']) assert.ok(!labels.some(t => t.includes(raw)), raw + ' leaked: ' + labels.join('|'));
    assert.ok(labels.some(t => /查询维基百科/.test(t)) && labels.some(t => /搜索论文/.test(t)) && labels.some(t => /核对事实/.test(t)) && labels.some(t => /并行处理子任务/.test(t)) && labels.some(t => /使用笔记空间/.test(t)));
    for (const [id, name] of tools) await emit(p, { type: 'tool_result', call_id: id, tool_name: name, success: true, summary: '完成' });
    await finish(p, '好了。');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('link and info cards render safe links and plain text only', { timeout: 60000 }, async () => {
  const f = await aiPolishFixture(), p = f.page;
  try {
    await start(p, '找几篇论文');
    await emit(p, { type: 'tool_calls', tools: [{ id: 'p1', name: 'search_papers', args: { query: 'x' } }] });
    await emit(p, card('papers', 'link_list', '论文检索 · 2 篇', { results: [
      { title: 'Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762', snippet: '提出 Transformer', meta: 'Vaswani · 2017 · arXiv' },
      { title: '<img src=x onerror=alert(1)>坏链接', url: 'javascript:alert(1)', snippet: '<b>不是粗体</b>', meta: '' }] }, 'p1'));
    await emit(p, { type: 'tool_result', call_id: 'p1', tool_name: 'search_papers', success: true, summary: '2 篇' });
    await emit(p, { type: 'tool_calls', tools: [{ id: 'g1', name: 'github_repo', args: {} }] });
    await emit(p, card('repo', 'info_card', 'GitHub · nodejs/node', { subtitle: 'Node.js runtime', text: '第一行\n第二行', url: 'https://github.com/nodejs/node', facts: [['star', '100000'], ['语言', 'JavaScript']] }, 'g1'));
    await emit(p, { type: 'tool_result', call_id: 'g1', tool_name: 'github_repo', success: true, summary: '完成' });
    await finish(p, '这是结果。');
    await p.waitForSelector('.ai-tool-card--link_list');
    const info = await p.evaluate(() => {
      const list = document.querySelector('.ai-tool-card--link_list'), links = [...list.querySelectorAll('a')], rows = [...list.querySelectorAll('.ai-tool-result')];
      const ic = document.querySelector('.ai-tool-card--info_card');
      return { links: links.map(a => [a.href, a.rel, a.target]), rows: rows.length, bad: rows[1].querySelector('b')?.textContent, imgs: document.querySelectorAll('.ai-tool-card img').length, boldInjected: !!list.querySelector('span b'),
        title: ic.querySelector('.ai-tool-card-page-title').textContent, text: ic.querySelector('.ai-tool-card-summary').textContent, kv: [...ic.querySelectorAll('.ai-tool-card-kv-row')].map(r => r.textContent), a: ic.querySelector('a.ai-tool-card-link')?.href };
    });
    assert.deepEqual(info.links[0], ['https://arxiv.org/abs/1706.03762', 'noopener noreferrer', '_blank']); assert.equal(info.links.length, 1, 'the javascript: link is not rendered as a link');
    assert.equal(info.rows, 2); assert.equal(info.bad, '<img src=x onerror=alert(1)>坏链接'); assert.equal(info.imgs, 0); assert.equal(info.boldInjected, false);
    assert.equal(info.title, 'Node.js runtime'); assert.equal(info.text, '第一行\n第二行'); assert.deepEqual(info.kv, ['star100000', '语言JavaScript']); assert.equal(info.a, 'https://github.com/nodejs/node');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('navigate cards act only on tap and only through whitelisted targets', { timeout: 60000 }, async () => {
  const f = await aiPolishFixture(), p = f.page;
  try {
    await start(p, '带我去照片墙');
    await p.evaluate(() => { window.navLog = []; window.switchDockTab = (tab) => navLog.push(['tab', tab]); window.openPostDetail = (id) => navLog.push(['post', id]); window.openUserProfile = (name) => navLog.push(['user', name]); window.openChat = (name) => navLog.push(['dm', name]); });
    const id = '22222222-2222-4222-8222-222222222222';
    await emit(p, { type: 'tool_calls', tools: [{ id: 'n1', name: 'site_navigate', args: {} }] });
    await emit(p, card('nav1', 'navigate', '站内跳转', { page: 'photos', label: '打开照片墙' }, 'n1'));
    await emit(p, card('nav2', 'navigate', '站内跳转', { page: 'post', target: id, label: '打开帖子' }, 'n1'));
    await emit(p, card('nav3', 'navigate', '站内跳转', { page: 'user', target: '小明', label: '查看 小明' }, 'n1'));
    await emit(p, card('nav4', 'navigate', '站内跳转', { page: 'post', target: 'not-a-uuid', label: '坏帖子' }, 'n1'));
    await emit(p, card('nav5', 'navigate', '站内跳转', { page: 'javascript:alert(1)', label: '坏页面' }, 'n1'));
    await emit(p, { type: 'tool_result', call_id: 'n1', tool_name: 'site_navigate', success: true, summary: '完成' });
    await finish(p, '点按钮就行。');
    await p.waitForFunction(() => document.querySelectorAll('.ai-tool-card--navigate').length === 5);
    assert.deepEqual(await p.evaluate(() => navLog), [], 'nothing navigates by itself');
    const buttons = p.locator('.ai-tool-card--navigate button.ai-clarify-option');
    assert.deepEqual(await buttons.allTextContents(), ['打开照片墙', '打开帖子', '查看 小明', '坏帖子', '坏页面']);
    // a real tap closes the chat panel, so all five buttons are pressed in one go (a detached button still runs its handler)
    await p.evaluate(() => [...document.querySelectorAll('.ai-tool-card--navigate button.ai-clarify-option')].forEach(b => b.click()));
    assert.deepEqual(await p.evaluate(() => navLog), [['tab', 'ai'], ['post', id], ['user', '小明']]);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('a research offer starts the research only after the tap, once, with the proposed topic', { timeout: 60000 }, async () => {
  const f = await aiPolishFixture(), p = f.page;
  try {
    await start(p, '帮我对比几个笔记软件的同步和隐私');
    await emit(p, { type: 'tool_calls', tools: [{ id: 'r1', name: 'deep_research', args: {} }] });
    await emit(p, card('offer1', 'research_offer', '建议深入研究', { topic: '对比 2026 年主流笔记软件的同步方案与隐私政策', note: '需要多来源核对' }, 'r1'));
    await emit(p, { type: 'tool_result', call_id: 'r1', tool_name: 'deep_research', success: true, summary: '完成' });
    await finish(p, '这个问题适合深入研究，点下面的按钮开始。');
    await p.waitForSelector('.ai-tool-card--research_offer .ai-clarify-option');
    assert.match(await p.locator('.ai-tool-card--research_offer .ai-clarify-question').textContent(), /对比 2026 年主流笔记软件/);
    assert.equal(await p.evaluate(() => aiPolish.streams.length), 1, 'no research request before the tap');
    await p.locator('.ai-tool-card--research_offer .ai-clarify-option').click();
    await p.waitForFunction(() => aiPolish.streams.some(s => s.path.endsWith('/research/stream')));
    const request = await p.evaluate(() => aiPolish.streams.find(s => s.path.endsWith('/research/stream')).body);
    assert.equal(request.query, '对比 2026 年主流笔记软件的同步方案与隐私政策');
    assert.equal(await p.locator('.ai-tool-card--research_offer .ai-clarify-option').textContent(), '已开始研究'); assert.equal(await p.locator('.ai-tool-card--research_offer .ai-clarify-option').isDisabled(), true);
    assert.equal(await p.evaluate(() => aiPolish.streams.filter(s => s.path.endsWith('/research/stream')).length), 1);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('rich cards draw compare tables, timelines, checklists and stats as text, in light and dark', { timeout: 60000 }, async () => {
  const f = await aiPolishFixture(), p = f.page;
  try {
    await start(p, '做几张卡片');
    await emit(p, { type: 'tool_calls', tools: [{ id: 'k1', name: 'render_card', args: {} }] });
    await emit(p, card('rc1', 'rich_card', '方案对比', { variant: 'compare', columns: ['方案', '价格', '优点'], rows: [['A', '10 元', '<b>快</b>'], ['B', '20 元', '稳']] }, 'k1'));
    await emit(p, card('rc2', 'rich_card', '进展', { variant: 'timeline', items: [{ time: '2026-01', title: '立项', detail: '启动会' }, { time: '2026-03', title: '发布', detail: '' }] }, 'k1'));
    await emit(p, card('rc3', 'rich_card', '待办', { variant: 'checklist', items: [{ text: '买菜', done: false }, { text: '写周报', done: true }] }, 'k1'));
    await emit(p, card('rc4', 'rich_card', '概览', { variant: 'stats', items: [{ label: '用户', value: '1,024', note: '较上周 +5%' }, { label: '收入', value: '¥ 8.6k' }] }, 'k1'));
    await emit(p, { type: 'tool_result', call_id: 'k1', tool_name: 'render_card', success: true, summary: '完成' });
    await finish(p, '结论：选 B。');
    await p.waitForFunction(() => document.querySelectorAll('.ai-tool-card--rich_card').length === 4);
    const state = await p.evaluate(() => {
      const cards = [...document.querySelectorAll('.ai-tool-card--rich_card')];
      return { head: [...cards[0].querySelectorAll('th')].map(n => n.textContent), cells: [...cards[0].querySelectorAll('tbody td')].map(n => n.textContent), injected: !!cards[0].querySelector('td b'),
        timeline: [...cards[1].querySelectorAll('li')].map(li => li.textContent), done: [...cards[2].querySelectorAll('li')].map(li => [li.classList.contains('is-done'), li.textContent]), stats: [...cards[3].querySelectorAll('.ai-rich-stat')].map(n => n.textContent) };
    });
    assert.deepEqual(state.head, ['方案', '价格', '优点']); assert.deepEqual(state.cells, ['A', '10 元', '<b>快</b>', 'B', '20 元', '稳']); assert.equal(state.injected, false);
    assert.deepEqual(state.timeline, ['2026-01立项启动会', '2026-03发布']); assert.deepEqual(state.done, [[false, '买菜'], [true, '✓写周报']]); assert.deepEqual(state.stats, ['1,024用户较上周 +5%', '¥ 8.6k收入']);
    for (const theme of ['light', 'dark']) {
      await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      const style = await p.evaluate(() => { const th = document.querySelector('.ai-rich-table th'), b = document.querySelector('.ai-rich-stat b'); return { th: getComputedStyle(th).color, stat: getComputedStyle(b).color }; });
      assert.ok(style.th && style.stat, theme);
      assert.notEqual(style.stat, theme === 'dark' ? 'rgb(23, 35, 30)' : 'rgb(230, 241, 237)', theme + ' text must be readable on its background');
    }
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
