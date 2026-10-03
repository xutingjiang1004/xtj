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
  await page.addStyleTag({ content: fs.readFileSync('css/ai-agent.css', 'utf8') });
  await page.addScriptTag({ content: fs.readFileSync('js/ai-core/stream-renderer.js', 'utf8') });
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

// The user rejected the glyph fade. Assert readable, ordered stream updates instead.
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
test('shared: reset cancels the old drain and cannot modify the next answer', async () => {
 const {browser,page}=await fixture();try{
  const result=await page.evaluate(async()=>{const output=document.getElementById('output'),renderer=XtjAiCore.StreamRenderer.create(output);renderer.append('旧回答');renderer.flush();const drain=renderer.drain('旧回答'+('旧尾部'.repeat(100)));renderer.reset();renderer.append('新回答');renderer.finish();const old=await drain;await new Promise(r=>setTimeout(r,50));return{old,text:output.textContent,cursors:output.querySelectorAll('.ai-stream-cursor').length};});
  assert.deepEqual(result,{old:false,text:'新回答',cursors:0});
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
  },implementation);assert.equal(result.immediately,'第一段正文');assert.ok(result.frames.length>12);assert.ok(result.frames.every((s,i)=>i===0||s.startsWith(result.frames[i-1])));assert.ok(result.frames.slice(1).every((s,i)=>s.length-result.frames[i].length<=33));assert.equal(result.stable,true);assert.equal(result.text,'第一段正文'+('第二段英文 English answer. '.repeat(30)));assert.deepEqual(result.opacity,['1','1']);assert.equal(result.runs,0);
 }finally{await browser.close();}
});
for(const implementation of ['main','shared'])test(implementation+': a long stream keeps one text node and adds no glyph animation nodes',async()=>{
 const {browser,page}=await fixture();try{
  const result=await page.evaluate(kind=>{const output=document.getElementById('output'),renderer=kind==='main'?createSmoothTextRenderer(output):XtjAiCore.StreamRenderer.create(output);for(let i=0;i<110;i++){renderer.append('正文继续');renderer.flush();}const nodes=output.firstChild.childNodes.length;renderer.finish();return{nodes,text:output.textContent,runs:output.querySelectorAll('.ai-stream-reveal').length};},implementation);
  assert.deepEqual(result,{nodes:1,text:'正文继续'.repeat(110),runs:0});
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
   const output=document.getElementById('output'),renderer=kind==='main'?createSmoothTextRenderer(output):XtjAiCore.StreamRenderer.create(output);renderer.append('正文'.repeat(700));let changed=0,before='';
   for(let i=1;i<=24;i++){const entry=frames.entries().next().value;frames.delete(entry[0]);time=1000+i*1000/hz;entry[1](time);if(output.textContent!==before)changed++;before=output.textContent;}
   renderer.stop();return{changed,text:before};
  },{kind:implementation,hz,sharedSource:fs.readFileSync('js/ai-core/stream-renderer.js','utf8')});assert.equal(result.changed,24);assert.ok(result.text.length>24);
 }finally{await browser.close();}
});
