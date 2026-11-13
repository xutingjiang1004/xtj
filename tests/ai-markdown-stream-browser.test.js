'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const {postBrowserFixture,wireAiChat}=require('./helpers/post-browser-fixture');
const agent=fs.readFileSync('js/ai-agent.js','utf8');
function section(a,b){const start=agent.indexOf(a);assert.ok(start>=0);return agent.slice(start,agent.indexOf(b,start));}
async function rendererFixture(){const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || (require('node:fs').existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});const page=await browser.newPage();await page.setContent('<div class="ai-chat-messages" style="height:220px;overflow:auto"><div id="output"></div></div>');await page.addStyleTag({content:fs.readFileSync('css/ai-agent.css','utf8')});await page.evaluate(({markdown,stream})=>{window.S={activeRenderers:[],paused:false};window.prefersReducedMotion=()=>false;window.escapeHtml=s=>{const n=document.createElement('span');n.textContent=String(s);return n.innerHTML};window.escapeAttr=s=>escapeHtml(s).replace(/"/g,'&quot;');window.aiDecodeHtmlEntities=s=>{const n=document.createElement('textarea');n.innerHTML=s;return n.value};window.eval(markdown+'\n'+stream);},{markdown:section('  function renderMarkdown(', '  function setupBubbleCopy('),stream:section('  function takeSmoothTextChunk(', '  function bindVisualViewport(')});return{browser,page};}
test('collapsed provider headings and tables render while literal code and safe links survive',async()=>{const f=await rendererFixture();try{const r=await f.page.evaluate(()=>{output.innerHTML=renderMarkdown('说明 ## 福州对比 | 景点 | 客流 | |---|---| | 福州 | 35 | | 烟台山 | 80 |\n\n```text\n原样 ## 标题 |甲|乙| |---|---|\n```\n\n`原样 ## 标题`\n\n[x](javascript:alert(1))');return{head:output.querySelector('h2')?.textContent,rows:output.querySelectorAll('tbody tr').length,cells:[...output.querySelectorAll('td')].map(n=>n.textContent),code:[...output.querySelectorAll('code')].map(n=>n.textContent),badLinks:output.querySelectorAll('a[href^="javascript:"]').length,text:output.textContent};});assert.equal(r.head,'福州对比');assert.equal(r.rows,2);assert.deepEqual(r.cells,['福州','35','烟台山','80']);assert.ok(r.code.includes('原样 ## 标题'));assert.ok(r.code.some(x=>x.includes('|---|---|')));assert.equal(r.badLinks,0);}finally{await f.browser.close();}});
test('large packets append strictly in source order and keep the growing text node',async()=>{const f=await rendererFixture();try{const r=await f.page.evaluate(async()=>{const text=Array.from({length:100},(_,i)=>String(i).padStart(3,'0')+'猫').join('');const renderer=createSmoothTextRenderer(output,{onRender(value){window.samples.push(value);}});window.samples=[];renderer.append(text);await new Promise(r=>setTimeout(r,80));const node=output.querySelector('p')?.firstChild;await renderer.drain();renderer.finish();return{final:output.textContent,stable:node===output.querySelector('p')?.firstChild,forward:samples.every((s,i)=>text.startsWith(s)&&(!i||s.startsWith(samples[i-1]))),frames:samples.length,anchor:getComputedStyle(output.parentElement).overflowAnchor};});assert.equal(r.forward,true);assert.equal(r.stable,true);assert.equal(r.frames,2);assert.equal(r.final,Array.from({length:100},(_,i)=>String(i).padStart(3,'0')+'猫').join(''));assert.equal(r.anchor,'none');}finally{await f.browser.close();}});
test('real chat formats before completion; the live thinking stays open while the answer streams and folds when the reply completes', {timeout:30000},async()=>{
 const f=await postBrowserFixture({counts:[1]});try{
  await wireAiChat(f.page);await f.page.locator('#aiChatMsgInput').fill('排版与工具过程');await f.page.locator('#aiChatSendBtn').click();await f.page.waitForFunction(()=>!!testStream);
  await f.page.evaluate(()=>{testEmit({type:'reasoning',text:'先核对资料'});testEmit({type:'content',text:'## 结论\n\n|项目|数字|\n|---|---|\n|福州|35|\n\n第一段。'});});
  await f.page.waitForSelector('.ai-msg.assistant table');await f.page.waitForFunction(()=>document.querySelector('.ai-msg.assistant .ai-msg-bubble').textContent.includes('第一段'));
  // The thinking is shown directly while the reply is produced, including reasoning that arrives after the answer began.
  assert.equal(await f.page.locator('.ai-thinking.expanded').count(),1);
  await f.page.evaluate(()=>testEmit({type:'reasoning',text:'补充核对另一个来源'}));
  await f.page.waitForFunction(()=>document.querySelector('.ai-thinking-body').textContent.includes('补充核对'));
  assert.equal(await f.page.locator('.ai-msg.assistant table').count(),1);
  // When the reply completes the thinking folds into the single header and the answer stays in place.
  await f.page.evaluate(()=>testEmit({type:'done',complete:true,saved:true,content:'## 结论\n\n|项目|数字|\n|---|---|\n|福州|35|\n\n第一段。',reasoning:'先核对资料补充核对另一个来源',thinking_mode:'max'}));
  await f.page.waitForFunction(()=>!document.querySelector('.ai-msg.assistant.generating'));
  assert.equal(await f.page.locator('.ai-thinking.expanded').count(),0);
  assert.match(await f.page.locator('.ai-msg.assistant .ai-msg-bubble').textContent(),/第一段/);
  await f.page.locator('.ai-thinking-toggle').first().click();await f.page.waitForFunction(()=>document.querySelector('.ai-thinking-body').textContent.includes('补充核对'));assert.deepEqual(f.errors,[]);
 }finally{await f.close();}
});

test('Chinese paragraphs following a streamed table never jump in front of the table',{timeout:30000},async()=>{
 const f=await rendererFixture();try{
  const result=await f.page.evaluate(async()=>{
   const raw='## 福州天气\n\n先核对时间。\n\n| 项目 | 数值 |\n|---|---|\n| 温度 | 26℃ |\n\n之后再安排出行。',failures=[];
   for(let i=1;i<=raw.length;i++){
    output.innerHTML=renderMarkdown(raw.slice(0,i),true);
    const text=output.textContent;if(text.includes('之后')&&text.indexOf('之后')<text.indexOf('26℃'))failures.push(i);
   }
   output.replaceChildren();const samples=[],renderer=createSmoothTextRenderer(output,{onRender(){samples.push(output.textContent);}});
   renderer.append(raw);await renderer.drain(raw);
   return {failures,samples,order:Array.from(output.children).map(n=>n.tagName),text:output.textContent};
  });
  assert.deepEqual(result.failures,[]);assert.deepEqual(result.order,['H2','P','TABLE','P']);assert.ok(result.samples.every(s=>!s.includes('之后')||s.indexOf('之后')>s.indexOf('26℃')));
  assert.ok(result.text.endsWith('之后再安排出行。'));
 }finally{await f.browser.close();}
});

test('streaming block cache matches a full render at every prefix for list-heavy answers and keeps caching after lists',{timeout:60000},async()=>{
 const f=await rendererFixture();try{
  const result=await f.page.evaluate(()=>{
   const docs=[
    '## 概览\n这是第一段，带**加粗**。\n\n- 要点一\n- 要点二\n\n结论段落在这里。\n\n1. 步骤一\n2. 步骤二\n\n最后一段。',
    '- 甲\n\n- 乙\n\n文字\n\n- 丙\n\n  续行缩进\n\n- 丁\n\n收尾',
    '前言\n\n- 外层\n  - 内层\n\n之后\n\n```js\n- 不是列表\n\n还是代码\n```\n\n尾声',
    '列表后接表格\n\n- 一\n- 二\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n结束',
    '1. 一\n\n2. 二\n\n3. 三\n\n总结'
   ],failures=[];
   for(const doc of docs){
    const cache=createStreamingMarkdownCache(renderMarkdown);
    for(let i=1;i<=doc.length;i++){const text=doc.slice(0,i);if(cache(text)!==renderMarkdown(text,true)){failures.push([doc.slice(0,12),i]);break;}}
   }
   // cost: after the first list, earlier blocks must not be re-rendered every frame
   const calls=[];const counting=(t,x)=>{calls.push(t.length);return renderMarkdown(t,x);};
   const cache=createStreamingMarkdownCache(counting);let doc='';
   for(let i=0;i<60;i++)doc+='## 小节'+i+'\n第'+i+'段内容，含**加粗**。\n\n- 要点一\n- 要点二\n\n';
   let sizes=[];for(let i=0;i<doc.length;i+=7){calls.length=0;cache(doc.slice(0,i+1));sizes.push(calls.reduce((a,b)=>a+b,0)/(i+1));}
   return {failures,lateRatio:Math.max(...sizes.slice(-20))};
  });
  assert.deepEqual(result.failures,[]);
  assert.ok(result.lateRatio<0.6,'late frames still re-render most of the text: '+result.lateRatio);
 }finally{await f.browser.close();}
});

test('finished code blocks and tables are frozen too, and every prefix still matches a full render',{timeout:60000},async()=>{
 const f=await rendererFixture();try{
  const result=await f.page.evaluate(()=>{
   const docs=[
    '开头\n\n```js\nconst a = 1;\n\nconsole.log(a);\n```\n\n中间一段，带**加粗**。\n\n| 词 | 义 |\n|---|---|\n| harbour | 港口 |\n| quiet | 安静 |\n\n结尾一段。\n\n- 甲\n- 乙\n\n完',
    '| a | b |\n|---|---|\n| 1 | 2 |\n\n| c | d |\n|---|---|\n| 3 | 4 |\n\n两张表之后\n\n```\n| 不是表格 |\n```\n\n完',
    '```py\nprint("```")\n```\n\n文字\n\n```\n未闭合的代码\n\n还在代码里',
    '表格后直接跟行\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n紧跟文字\n\n完'
   ],failures=[];
   for(const doc of docs){
    const cache=createStreamingMarkdownCache(renderMarkdown);
    for(let i=1;i<=doc.length;i++){const text=doc.slice(0,i);if(cache(text)!==renderMarkdown(text,true)){failures.push([doc.slice(0,10),i]);break;}}
   }
   // 代价：出现过表格和代码块之后，后面的帧不能再把整篇重新解析。
   const calls=[];const counting=(t,x)=>{calls.push(t.length);return renderMarkdown(t,x);};
   const cache=createStreamingMarkdownCache(counting);let doc='';
   for(let i=0;i<40;i++)doc+='## 小节'+i+'\n第'+i+'段内容。\n\n| 时态 | 结构 |\n|---|---|\n| 现在完成时 | have done |\n\n```js\nconst x = '+i+';\n```\n\n';
   const sizes=[];for(let i=0;i<doc.length;i+=9){calls.length=0;cache(doc.slice(0,i+1));sizes.push(calls.reduce((a,b)=>a+b,0)/(i+1));}
   const late=sizes.slice(-40).sort((a,b)=>a-b);
   return {failures,lateMedian:late[20]};
  });
  assert.deepEqual(result.failures,[]);
  assert.ok(result.lateMedian<0.2,'late frames still re-render most of the text: '+result.lateMedian);
 }finally{await f.browser.close();}
});

test('half-typed Markdown never shows raw markers while a reply streams one character at a time',{timeout:60000},async()=>{
 const f=await rendererFixture();try{
  const result=await f.page.evaluate(async()=>{
   const target=document.getElementById('output');
   const renderer=createSmoothTextRenderer(target,{flowPace:true});
   const text='这是**加粗**和`code`以及[链接](https://a.com)。\n\n## 标题\n\n- 列表项\n- 第二项\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet a = 1;\n```\n\n结尾。';
   const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const raw=[];let shown=0;
   for(const ch of text){
    renderer.append(ch);await frame();
    const visible=target.cloneNode(true);visible.querySelectorAll('pre,code,.ai-stream-cursor').forEach(n=>n.remove());
    const plain=visible.textContent;
    if(/\*\*|`|\]\(|https:|^\s*\||\|\s*$|^#|^- /m.test(plain))raw.push(plain.slice(-24));
    shown=Math.max(shown,target.textContent.length);
   }
   renderer.finish(text);await frame();
   return {raw,html:target.innerHTML,full:renderMarkdown(text,false)===target.innerHTML.replace(/<span class="ai-stream-cursor"[^>]*><\/span>/,'')};
  });
  assert.deepEqual(result.raw,[]);
  assert.match(result.html,/<strong>加粗<\/strong>/);assert.match(result.html,/<table>/);assert.match(result.html,/<pre>/);
 }finally{await f.browser.close();}
});

test('arrived prose still lands on the next frame, and an unfinished table row is released when the stream stalls or ends',{timeout:60000},async()=>{
 const f=await rendererFixture();try{
  const result=await f.page.evaluate(async()=>{
   const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const out={};
   let target=document.getElementById('output');
   let renderer=createSmoothTextRenderer(target,{flowPace:true});
   renderer.append('已经送达的文字应当立刻显示。');await frame();out.prose=target.textContent;
   renderer.append('\n\n| 半行');await frame();out.held=target.textContent;
   renderer.finish('已经送达的文字应当立刻显示。\n\n| 半行');await frame();out.finished=target.textContent;
   target.innerHTML='';renderer=createSmoothTextRenderer(target,{flowPace:true});
   renderer.append('| 停住的半行');await frame();out.before=target.textContent;
   await new Promise(r=>setTimeout(r,1100));await frame();out.after=target.textContent;
   // 链接文字先出现，地址到齐后变成链接；中途改写不能把文字重复一遍。
   target.innerHTML='';renderer=createSmoothTextRenderer(target,{flowPace:true});
   for(const part of ['见[链','接','](https://a.com)','。'])renderer.append(part),await frame(),(out.link=out.link||[]).push(target.textContent);
   return out;
  });
  assert.equal(result.prose,'已经送达的文字应当立刻显示。');
  assert.equal(result.held,'已经送达的文字应当立刻显示。');
  assert.match(result.finished,/\| 半行/);
  assert.equal(result.before,'');assert.equal(result.after,'| 停住的半行');
  assert.deepEqual(result.link,['见链','见链接','见链接','见链接。']);
 }finally{await f.browser.close();}
});
