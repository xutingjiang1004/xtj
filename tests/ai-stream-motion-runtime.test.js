'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const agent = fs.readFileSync('js/ai-agent.js', 'utf8');
const transport = fs.readFileSync('js/ai-core/transport.js', 'utf8');
function section(start, end) {
  const offset = agent.indexOf(start);
  assert.ok(offset >= 0);
  return agent.slice(offset, agent.indexOf(end, offset));
}
test('shared: loading Markdown after a plain prefix reparses the whole accepted reply', async () => {
  const { browser, page } = await fixture();
  try {
    const result = await page.evaluate(() => {
      const output = document.getElementById('output');
      delete XtjAiCore.Markdown;
      const renderer = XtjAiCore.StreamRenderer.create(output);
      renderer.append('plain prefix\n\n'); renderer.flush();
      XtjAiCore.Markdown = { render: text => '<p>' + text.toUpperCase().split('\n\n').filter(Boolean).join('</p><p>') + '</p>' };
      renderer.append('new tail'); renderer.flush();
      const text = output.textContent; renderer.finish(); return text;
    });
    assert.equal(result, 'PLAIN PREFIXNEW TAIL');
  } finally { await browser.close(); }
});
async function fixture() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent('<div id="output"></div><div id="timeline"></div>');
  await page.addStyleTag({ content: fs.readFileSync('css/ui-enhance.css', 'utf8') });
  await page.addStyleTag({ content: fs.readFileSync('css/ai-agent.css', 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync('js/ai-core/stream-renderer.js', 'utf8') });
  await page.evaluate(() => { window.XtjAiCore.Errors = {}; });
  await page.addScriptTag({ content: transport });
  await page.evaluate(({ stream, tools }) => {
    window.S = { paused: false, activeRenderers: [] };
    window.AI_DEBUG = false;
    window.prefersReducedMotion = () => false;
    window.renderMarkdown = text => '<span>' + text + '</span>';
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
for (const implementation of ['main', 'shared']) test(implementation + ': synthetic SSE receipt is compared with the next DOM frame while plain prose bypasses repeated Markdown parsing', async () => {
  const { browser, page } = await fixture();
  try {
    const result = await page.evaluate(async kind => {
      let markdownCalls = 0;
      const render = text => { markdownCalls++; return '<p>' + text.replace(/[&<>]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[ch])) + '</p>'; };
      window.renderMarkdown = render; XtjAiCore.Markdown = { render };
      const output = document.getElementById('output'), arrivals = [], samples = [];
      const renderer = kind === 'main'
        ? createSmoothTextRenderer(output, { onStreamMetrics: sample => { samples.push(sample); requestAnimationFrame(() => { sample.nextFrameAt = performance.now(); }); } })
        : XtjAiCore.StreamRenderer.create(output, { onStreamMetrics: sample => { samples.push(sample); requestAnimationFrame(() => { sample.nextFrameAt = performance.now(); }); } });
      const parts = ['先核对原始资料，', '再逐项比较时间，', '最后给出结论。'];
      const payload = parts.map(text => 'data: ' + JSON.stringify({ type: 'content', text }) + '\n\n').join('');
      const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(payload)); controller.close(); } });
      await XtjAiCore.Transport.readSSEStream(new Response(body), evt => {
        const receivedAt = performance.now(); arrivals.push(receivedAt); renderer.append(evt.text, receivedAt);
      });
      const callsDuringStream = markdownCalls;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const sample = samples[0];
      const beforeFinish = output.textContent;
      renderer.finish();
      return { callsDuringStream, callsAfterFinish: markdownCalls, beforeFinish, text: output.textContent,
        receivedCount: arrivals.length, sampleCount: samples.length, firstReceivedAt: sample && sample.receivedAt,
        lastReceivedAt: sample && sample.lastReceivedAt, firstArrival: arrivals[0], lastArrival: arrivals[arrivals.length - 1],
        receiveToDomMs: sample && sample.renderedAt - sample.lastReceivedAt, nextFrameAt: sample && sample.nextFrameAt, renderedAt: sample && sample.renderedAt };
    }, implementation);
    assert.equal(result.callsDuringStream, 0, JSON.stringify(result));
    assert.equal(result.callsAfterFinish, 1, JSON.stringify(result));
    assert.equal(result.receivedCount, 3); assert.equal(result.sampleCount, 1);
    assert.equal(result.firstReceivedAt, result.firstArrival); assert.equal(result.lastReceivedAt, result.lastArrival);
    assert.ok(result.receiveToDomMs >= 0 && result.receiveToDomMs < 100, JSON.stringify(result));
    assert.ok(result.nextFrameAt >= result.renderedAt, JSON.stringify(result));
    assert.equal(result.beforeFinish, '先核对原始资料，再逐项比较时间，最后给出结论。');
    assert.equal(result.text, result.beforeFinish);
  } finally { await browser.close(); }
});

test('plain paragraphs resume direct appends after a split blank-line delimiter', async () => {
  const { browser, page } = await fixture();
  try {
    const result = await page.evaluate(() => {
      let calls = 0;
      const render = text => { calls++; return text.split('\n\n').map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join(''); };
      window.renderMarkdown = render; XtjAiCore.Markdown = { render };
      const output = document.getElementById('output'), renderer = createSmoothTextRenderer(output);
      renderer.append('第一段开头'); renderer.flush(); renderer.append('结束。\n'); renderer.flush();
      renderer.append('\n第二段'); renderer.flush();
      const callsAfterDelimiter = calls;
      for (let i = 0; i < 100; i++) { renderer.append('继续写'); renderer.flush(); }
      const callsAfterTail = calls;
      const visible = output.textContent;
      renderer.finish();
      return { callsAfterDelimiter, callsAfterTail, callsAfterFinish: calls, visible, final: output.textContent };
    });
    assert.ok(result.callsAfterDelimiter > 0);
    assert.equal(result.callsAfterTail, result.callsAfterDelimiter, JSON.stringify(result));
    assert.equal(result.callsAfterFinish, result.callsAfterDelimiter + 1);
    assert.equal(result.visible, '第一段开头结束。第二段' + '继续写'.repeat(100));
    assert.equal(result.final, result.visible);
  } finally { await browser.close(); }
});

test('live thought deltas avoid cumulative text reads and coalesce scroll measurement per frame', async () => {
  const { browser, page } = await fixture();
  try {
    const result = await page.evaluate(({ appendSource, scrollSource }) => {
      let textReads = 0, inkCreates = 0, rangeRecords = 0, queued = [];
      window.createAiStreamMetricsReporter = () => null;
      XtjAiCore.InkReveal = { create() { inkCreates++; return { begin(){}, record(){rangeRecords++;}, commit(){} }; } };
      window.eval(appendSource + '\n' + scrollSource);
      const chunk = document.createElement('div'), descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
      Object.defineProperty(chunk, 'textContent', { configurable: true, get() { textReads++; return descriptor.get.call(this); }, set(value) { descriptor.set.call(this, value); } });
      for (let i = 0; i < 5000; i++) appendStreamThoughtDelta(chunk, 'x', 10);
      const internalTextReads = textReads, finalText = chunk.textContent;
      const thought = { length: finalText.length, nodes: chunk.childNodes.length, textReads: internalTextReads, inkCreates, rangeRecords };
      const oldRaf = window.requestAnimationFrame;
      window.requestAnimationFrame = callback => { queued.push(callback); return queued.length; };
      const container = document.createElement('div'); document.body.appendChild(container); let heightReads = 0;
      Object.defineProperty(container, 'scrollHeight', { get() { heightReads++; return 120; } });
      let scrollTopValue = 0;
      Object.defineProperty(container, 'scrollTop', { get() { return scrollTopValue; }, set(value) { scrollTopValue = value; } });
      for (let i = 0; i < 12; i++) scheduleThoughtScrollBottom(container);
      const queuedFrames = queued.length; queued.shift()();
      window.requestAnimationFrame = oldRaf;
      return { thought, queuedFrames, heightReads, scrollTop: container.scrollTop };
    }, {
      appendSource: section('  function appendStreamThoughtDelta(', '  // Scroll only once per display frame'),
      scrollSource: section('  function scheduleThoughtScrollBottom(', '  /**\n   * 把深入研究阶段')
    });
    assert.equal(result.thought.length, 5000);
    assert.equal(result.thought.nodes, 7);
    assert.equal(result.thought.textReads, 1);
    assert.equal(result.thought.inkCreates, 1);
    assert.equal(result.queuedFrames, 1);
    assert.equal(result.heightReads, 1);
    assert.equal(result.scrollTop, 120);
  } finally { await browser.close(); }
});
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

test('thinking timer resumes only for a new active phase, sums its duration and freezes again at the answer',async()=>{
 const {browser,page}=await fixture();try{
  const result=await page.evaluate(source=>{
   let clock=1000;Date.now=()=>clock;window.setThinkingStatus=()=>{};window.setThinkingActive=()=>{};window.formatThinkingElapsed=String;
   window.eval(source);const timer=createThinkingTimer(document.getElementById('output'));timer.start();clock=1300;const first=timer.stop();
   clock=10000;timer.resume();clock=10400;const resumed=timer.stop();clock=20000;timer.start();const final=timer.stop();timer.cancel();return{first,resumed,final};
  },section('  function createThinkingTimer(', '  function buildReasoningNode('));
  assert.deepEqual(result,{first:300,resumed:700,final:700});
 }finally{await browser.close();}
});

// Existing text stays stable and readable while new text arrives.
for (const implementation of ['main', 'shared']) test(implementation + ': streamed text remains opaque and reuses the existing text node', async () => {
 const {browser,page}=await fixture();try{
  const result=await page.evaluate(kind=>{
   const output=document.getElementById('output'),create=()=>kind==='main'?createSmoothTextRenderer(output):XtjAiCore.StreamRenderer.create(output);
   const renderer=create();renderer.append('已有文字');renderer.flush();const prefix=output.firstElementChild, text=prefix.firstChild;
   renderer.append('新到达的文字🐈');renderer.flush();const stable=output.firstElementChild===prefix&&prefix.firstChild===text;
   const opacity=getComputedStyle(text.parentElement).opacity;renderer.finish();const complete=output.textContent;
   document.documentElement.setAttribute('data-xtj-motion','off');window.prefersReducedMotion=()=>true;output.replaceChildren();const quiet=create();quiet.append('立即显示');quiet.finish();
   return{stable,opacity,complete,runs:output.querySelectorAll('.ai-stream-reveal').length,quiet:output.textContent};
  },implementation);assert.deepEqual(result,{stable:true,opacity:'1',complete:'已有文字新到达的文字🐈',runs:0,quiet:'立即显示'});
 }finally{await browser.close();}
});

for (const implementation of ['main', 'shared']) test(implementation + ': a new text segment appears immediately without an ink wash or typing queue', async () => {
 const {browser,page}=await fixture();try{
  const result=await page.evaluate(async kind=>{
   const output=document.getElementById('output');output.className='ai-msg-bubble';
   const make=()=>kind==='main'?createSmoothTextRenderer(output,{plainStream:true}):XtjAiCore.StreamRenderer.create(output,{plainStream:true});
   const renderer=make(),prefix='已经清晰的文字。',suffix='这是一段新的中文🐈';
   renderer.append(prefix);renderer.flush();await new Promise(r=>setTimeout(r,220));
   const node=output.firstChild;renderer.append(suffix);renderer.flush();
   const matching=Array.from(CSS.highlights.entries()).filter(([name])=>name.startsWith('xtj-ai-ink-'));
   const ranges=matching.flatMap(([,highlight])=>Array.from(highlight));
   const animations=output.getAnimations({subtree:true}).filter(a=>a.effect?.getKeyframes().some(k=>Object.keys(k).some(x=>x.startsWith('--xtj-ai-ink-phase-'))));
   const stable=output.firstChild===node;
   const immediate=output.textContent;
   renderer.append('继续');renderer.flush();
   const prefixStillStable=output.firstChild===node&&output.textContent.startsWith(prefix);
   renderer.cancel();const afterCancel=Array.from(CSS.highlights.keys()).filter(name=>name.startsWith('xtj-ai-ink-')).length;
   output.replaceChildren();document.documentElement.setAttribute('data-xtj-motion','off');
   const quiet=make();quiet.append('降低动态效果时立即显示');quiet.flush();
   const reduced={text:output.textContent,highlights:Array.from(CSS.highlights.keys()).filter(name=>name.startsWith('xtj-ai-ink-')).length};quiet.cancel();
   return{count:ranges.length,animations:animations.length,stable,immediate,prefixStillStable,afterCancel,reduced};
  },implementation);
  assert.equal(result.count,0,JSON.stringify(result));assert.equal(result.animations,0);
  assert.equal(result.stable,true);assert.equal(result.prefixStillStable,true);assert.equal(result.immediate,'已经清晰的文字。这是一段新的中文🐈');
  assert.equal(result.afterCancel,0);assert.deepEqual(result.reduced,{text:'降低动态效果时立即显示',highlights:0});
 }finally{await browser.close();}
});

test('research thinking updates keep their text node without an ink wash', async () => {
 const {browser,page}=await fixture();try{
  const result=await page.evaluate(async source=>{
   window.eval(source);const output=document.getElementById('output');output.className='ai-thought-chunk';
   updateStreamThought(output,'第一段思考。');await new Promise(r=>setTimeout(r,220));const node=output.firstChild;
   updateStreamThought(output,'第一段思考。继续查证🐈');
   const highlights=Array.from(CSS.highlights.keys()).filter(name=>name.startsWith('xtj-ai-ink-')).length;
   return {stable:output.firstChild===node,highlights,text:output.textContent};
  },section('  function updateStreamThought(', '  /**'));
  assert.deepEqual(result,{stable:true,highlights:0,text:'第一段思考。继续查证🐈'});
 }finally{await browser.close();}
});

test('lite devices show text immediately and stopping one stream leaves the other intact', async () => {
 const {browser,page}=await fixture();try{
  const result=await page.evaluate(()=>{
   document.documentElement.classList.add('perf-lite');document.documentElement.dataset.xtjPerfProfile='lite';
   const first=document.getElementById('output'),second=document.getElementById('timeline');first.className=second.className='ai-msg-bubble';
   const a=XtjAiCore.StreamRenderer.create(first,{plainStream:true}),b=XtjAiCore.StreamRenderer.create(second,{plainStream:true});
   const text='连续生成文字不会被动画排队。'.repeat(20);a.append(text);a.flush();b.append('另一段思考和正文');b.flush();
   const groups=()=>Array.from(CSS.highlights.entries()).filter(([name])=>name.startsWith('xtj-ai-ink-'));
   const rangeCount=groups().flatMap(([,h])=>Array.from(h)).filter(r=>first.contains(r.startContainer)).length;
   a.stop();const otherText=second.textContent;
   const complete=first.textContent===text;b.cancel();return{rangeCount,otherText,complete,remaining:groups().length};
  });
  assert.equal(result.rangeCount,0);assert.equal(result.otherText,'另一段思考和正文');assert.equal(result.complete,true);assert.equal(result.remaining,0);
 }finally{await browser.close();}
});
test('shared: reset cancels the old drain and cannot modify the next answer', async () => {
 const {browser,page}=await fixture();try{
  const result=await page.evaluate(async()=>{const output=document.getElementById('output'),renderer=XtjAiCore.StreamRenderer.create(output);renderer.append('旧回答');renderer.flush();const drain=renderer.drain('旧回答'+('旧尾部'.repeat(100)));renderer.reset();renderer.append('新回答');renderer.finish();const old=await drain;await new Promise(r=>setTimeout(r,50));return{old,text:output.textContent,cursors:output.querySelectorAll('.ai-stream-cursor').length};});
  assert.deepEqual(result,{old:false,text:'新回答',cursors:0});
 }finally{await browser.close();}
});

for(const implementation of ['main','shared'])test(implementation+': a received CJK burst renders on the next display frame and leaves no idle rendering loop',async()=>{
 const {browser,page}=await fixture();try{
  const result=await page.evaluate(async kind=>{
   const output=document.getElementById('output'),expected='收到的中文按原始顺序显示，保留标点与小猫🐈。'.repeat(120);
   const nativeRequest=requestAnimationFrame,nativeCancel=cancelAnimationFrame,callbacks=new Map();let serial=0,clock=0;
   window.requestAnimationFrame=callback=>{callbacks.set(++serial,callback);return serial;};window.cancelAnimationFrame=id=>callbacks.delete(id);
   let renderer;
   try{
    renderer=kind==='main'?createSmoothTextRenderer(output):XtjAiCore.StreamRenderer.create(output);
    renderer.append(expected);const completion=renderer.drain(expected);let frames=0,ordered=true,firstLength=0,prefixNode=null,stable=true;
    while(callbacks.size&&frames<100){const work=Array.from(callbacks.values());callbacks.clear();clock+=16;work.forEach(callback=>callback(clock));frames++;
     const text=output.textContent;ordered=ordered&&expected.startsWith(text);if(!firstLength&&text.length)firstLength=text.length;
     if(!prefixNode&&output.firstElementChild)prefixNode=output.firstElementChild;else if(prefixNode)stable=stable&&output.firstElementChild===prefixNode;
    }
    if(callbacks.size)renderer.stop();
    const done=await completion;return{frames,ordered,firstLength,total:expected.length,stable,done,complete:output.textContent===expected,queued:callbacks.size};
   }finally{if(renderer)renderer.cancel();window.requestAnimationFrame=nativeRequest;window.cancelAnimationFrame=nativeCancel;}
  },implementation);
  assert.equal(result.frames,1,JSON.stringify(result));assert.equal(result.firstLength,result.total);
  assert.equal(result.ordered,true);assert.equal(result.stable,true);assert.equal(result.complete,true);assert.equal(result.done,true);assert.equal(result.queued,0);
 }finally{await browser.close();}
});
for(const implementation of ['main','shared'])test(implementation+': completion drains only the unseen suffix in reading order without a gray future paragraph',async()=>{
 const {browser,page}=await fixture();try{
  const result=await page.evaluate(async kind=>{
   renderMarkdown=text=>text.split('\n\n').map(part=>'<p>'+part+'</p>').join('');XtjAiCore.Markdown.render=renderMarkdown;
   const output=document.getElementById('output'),renderer=kind==='main'?createSmoothTextRenderer(output):XtjAiCore.StreamRenderer.create(output);
   renderer.append('第一段正文');renderer.flush();const first=output.querySelector('p'),text=first.firstChild,final='第一段正文\n\n'+('第二段英文 English answer. '.repeat(30));let frames=[],running=true;
   function sample(){frames.push(output.textContent);if(running)requestAnimationFrame(sample);}requestAnimationFrame(sample);
   const drain=renderer.drain(final);const immediately=output.textContent;await drain;running=false;const paragraphs=Array.from(output.querySelectorAll('p'));
   return{immediately,stable:paragraphs[0]===first&&first.firstChild===text,frames,text:output.textContent,opacity:paragraphs.map(p=>getComputedStyle(p).opacity),runs:output.querySelectorAll('.ai-stream-reveal,.ai-stream-cursor').length};
  },implementation);assert.equal(result.immediately,'第一段正文');assert.ok(result.frames.length>=1&&result.frames.length<=2,JSON.stringify(result.frames.map(s=>s.length)));assert.ok(result.frames.every((s,i)=>i===0||s.startsWith(result.frames[i-1])));assert.equal(result.stable,true);assert.equal(result.text,'第一段正文'+('第二段英文 English answer. '.repeat(30)));assert.deepEqual(result.opacity,['1','1']);assert.equal(result.runs,0);
 }finally{await browser.close();}
});
for(const implementation of ['main','shared'])test(implementation+': a long stream keeps one text node and adds no glyph animation nodes',async()=>{
 const {browser,page}=await fixture();try{
  const result=await page.evaluate(kind=>{const output=document.getElementById('output'),renderer=kind==='main'?createSmoothTextRenderer(output):XtjAiCore.StreamRenderer.create(output);for(let i=0;i<110;i++){renderer.append('正文继续');renderer.flush();}const nodes=output.firstChild.childNodes.length;renderer.finish();return{nodes,text:output.textContent,runs:output.querySelectorAll('.ai-stream-reveal').length};},implementation);
  assert.deepEqual(result,{nodes:1,text:'正文继续'.repeat(110),runs:0});
 }finally{await browser.close();}
});
for(const implementation of ['main','shared'])test(implementation+': a large complete suffix finishes promptly while retaining the existing paragraph and respecting prior cancellation',async()=>{
 const {browser,page}=await fixture();try{
  const result=await page.evaluate(async kind=>{renderMarkdown=text=>text.split('\n\n').map(part=>'<p>'+part+'</p>').join('');XtjAiCore.Markdown.render=renderMarkdown;const output=document.getElementById('output'),renderer=kind==='main'?createSmoothTextRenderer(output):XtjAiCore.StreamRenderer.create(output);renderer.append('已有段落');renderer.flush();const first=output.firstChild,final='已有段落\n\n'+('终稿原文'.repeat(10000));const done=await renderer.drain(final);const stable=output.firstChild===first,complete=output.textContent.endsWith('终稿原文'.repeat(10000));output.replaceChildren();const next=kind==='main'?createSmoothTextRenderer(output):XtjAiCore.StreamRenderer.create(output);next.append('保留原文');next.flush();const cancelled=await next.drain('不应显示的迟到正文'.repeat(2000),AbortSignal.abort());return {done,stable,complete,cancelled,text:output.textContent};},implementation);
  assert.deepEqual(result,{done:true,stable:true,complete:true,cancelled:false,text:'保留原文'});
 }finally{await browser.close();}
});
for(const implementation of ['main','shared'])test(implementation+': abort settles the drain once and sanitized replacements are immediately authoritative',async()=>{
 const {browser,page}=await fixture();try{
  const result=await page.evaluate(async kind=>{const output=document.getElementById('output'),create=()=>kind==='main'?createSmoothTextRenderer(output):XtjAiCore.StreamRenderer.create(output),renderer=create(),controller=new AbortController();renderer.append('前缀');renderer.flush();const drain=renderer.drain('前缀'+('尚未显示'.repeat(80)),controller.signal);controller.abort();const aborted=await drain;output.replaceChildren();const revised=create();revised.append('旧的内容');revised.flush();const completed=await revised.drain('修正后的安全正文');return{aborted,completed,text:output.textContent,cursors:output.querySelectorAll('.ai-stream-cursor').length};},implementation);
  assert.deepEqual(result,{aborted:false,completed:true,text:'修正后的安全正文',cursors:0});
 }finally{await browser.close();}
});
for(const implementation of ['main','shared'])for(const hz of [60,120])test(implementation+': a '+hz+' Hz display permits a text update on every scheduled frame',async()=>{
 const {browser,page}=await fixture();try{
  const result=await page.evaluate(({kind,hz,sharedSource})=>{
   let sequence=0,time=1000;const frames=new Map();window.requestAnimationFrame=fn=>{frames.set(++sequence,fn);return sequence;};window.cancelAnimationFrame=id=>frames.delete(id);Date.now=()=>Math.floor(time);if(kind==='shared')window.eval(sharedSource);
   const output=document.getElementById('output'),renderer=kind==='main'?createSmoothTextRenderer(output):XtjAiCore.StreamRenderer.create(output);let changed=0,before='';
   let scheduled=0;
   for(let i=1;i<=24;i++){renderer.append('正文'.repeat(30));const entry=frames.entries().next().value;if(!entry)break;frames.delete(entry[0]);time=1000+i*1000/hz;entry[1](time);scheduled++;if(output.textContent!==before)changed++;before=output.textContent;}
   renderer.stop();return{changed,scheduled,text:before};
  },{kind:implementation,hz,sharedSource:fs.readFileSync('js/ai-core/stream-renderer.js','utf8')});assert.equal(result.changed,result.scheduled);assert.ok(result.scheduled>0);assert.ok(result.text.length>24);assert.equal(result.scheduled,24);assert.equal(result.text,'正文'.repeat(720));
 }finally{await browser.close();}
});

for(const implementation of ['main','shared'])test(implementation+': repeated or adjusted wall clock values cannot suppress scheduled display frames',async()=>{
 const {browser,page}=await fixture();try{
  const result=await page.evaluate(({kind,sharedSource})=>{
   let sequence=0,wall=1000;const frames=new Map();
   window.requestAnimationFrame=fn=>{frames.set(++sequence,fn);return sequence;};
   window.cancelAnimationFrame=id=>frames.delete(id);Date.now=()=>wall;
   if(kind==='shared')window.eval(sharedSource);
   const output=document.getElementById('output'),renderer=kind==='main'?createSmoothTextRenderer(output):XtjAiCore.StreamRenderer.create(output);
   let changed=0,before='';
   for(let i=1;i<=24;i++){
    if(i===12)wall=900;
    renderer.append('正文'.repeat(30));
    const entry=frames.entries().next().value;frames.delete(entry[0]);entry[1](1000+i*1000/120);
    if(output.textContent!==before)changed++;before=output.textContent;
   }
   renderer.stop();return changed;
  },{kind:implementation,sharedSource:fs.readFileSync('js/ai-core/stream-renderer.js','utf8')});
  assert.equal(result,24);
 }finally{await browser.close();}
});

test('thinking duration freezes at the first answer and repeated terminal stops preserve a genuine zero',()=>{
 const vm=require('node:vm');let now=1000;const labels=[];
 const context={Date:{now:()=>now},setInterval:()=>1,clearInterval(){},setThinkingStatus:(_node,text)=>labels.push(text),setThinkingActive(){},formatThinkingElapsed:ms=>Math.floor(ms/1000)+'s'};
 const create=vm.runInNewContext('('+section('  function createThinkingTimer(', '  function buildReasoningNode(').trim()+')',context),node={isConnected:true},timer=create(node);
 timer.start();now=5000;assert.equal(timer.stop(),4000);now=30000;assert.equal(timer.stop(),4000);
 timer.syncFinal(0);now=40000;assert.equal(timer.stop(),0);assert.equal(labels.at(-1),'已思考 0s');
});
