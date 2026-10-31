#!/usr/bin/env node
'use strict';
// Streaming benchmark for the small-cat AI page: feeds a mocked answer (thinking, a tool call, then a long Markdown answer)
// into the real client and measures frame gaps and long tasks while it renders, with an optional CPU throttle.
//   node scripts/maintenance/bench-ai.js [--throttle 2] [--chunks 300] [--interval 12] [--viewport 390x844]
// Run it before and after a change to the streaming code and report both lines. The answer grows to a few thousand
// characters with headings, a list, a code block and a table, which is what made long answers expensive before.
const { open } = require('./harness');
const ai = require('./ai-mock');
const { measure, format } = require('./probe-motion');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const throttle = Number(arg('throttle', 2));
const chunks = Number(arg('chunks', 300));
const interval = Number(arg('interval', 12));
const [w, h] = String(arg('viewport', '390x844')).split('x').map(Number);

const paragraph = (i) => `### 第 ${i + 1} 部分\n\n这是一段用来测试流式渲染的正文，包含**加粗**、\`行内代码\`和[链接](https://example.com/${i})。每一段都会继续增长，浏览器需要不断重排。\n\n- 要点一：路线难度适中\n- 要点二：需要带水\n- 要点三：避开周末高峰\n\n`;
const extras = '```js\nconst answer = [1, 2, 3].map((n) => n * 2);\nconsole.log(answer);\n```\n\n| 路线 | 距离 | 难度 |\n| --- | --- | --- |\n| 九溪十八涧 | 6 km | 低 |\n| 北高峰 | 9 km | 中 |\n\n';

(async () => {
  const s = await open({ viewport: { width: w, height: h }, mobile: w < 700 });
  await ai.wire(s.page);
  await ai.openChat(s.page);
  const timing = {};
  const m = await measure(s.page, async () => {
    const sentAt = Date.now();
    await ai.send(s.page, '帮我规划杭州周边的徒步路线，要详细一点');
    await ai.emit(s.page, { type: 'reasoning_start' });
    for (let i = 0; i < 20; i++) { await ai.emit(s.page, { type: 'reasoning', text: '先想一想路线的难度与季节。' }); await s.page.waitForTimeout(interval); }
    await ai.emit(s.page, { type: 'content', text: '我先查一下热门路线。' });
    await ai.emit(s.page, { type: 'tool_calls', tools: [{ id: 't1', call_id: 't1', name: 'search_web', tool_name: 'search_web', arguments: { query: '杭州 徒步' } }] });
    await s.page.waitForTimeout(300);
    await ai.emit(s.page, { type: 'tool_result', call_id: 't1', tool_name: 'search_web', success: true, count: 3, summary: '找到 3 条结果' });
    const firstAt = Date.now();
    for (let i = 0; i < chunks; i++) {
      // Characters arrive in small pieces, as a model would send them.
      const text = (i % 25 === 24 ? extras : '') + paragraph(Math.floor(i / 5)).slice((i % 5) * 40, (i % 5) * 40 + 40);
      await ai.emit(s.page, { type: 'content', text });
      await s.page.waitForTimeout(interval);
    }
    await ai.emit(s.page, { type: 'done' });
    await s.page.waitForTimeout(600);
    timing.totalMs = Date.now() - sentAt; timing.streamMs = Date.now() - firstAt;
  }, { throttle });
  const length = await s.page.evaluate(() => (document.querySelector('.ai-msg.assistant .ai-msg-bubble:last-of-type, .ai-msg.assistant:last-of-type .ai-msg-bubble') || {}).textContent?.length || 0);
  console.log(format(`AI stream (${chunks} chunks every ${interval} ms, ${length} characters shown)`, m));
  if (s.errors.length) console.log('page errors: ' + s.errors.join(' | '));
  await s.close();
})().catch((e) => { console.error(e); process.exit(2); });
