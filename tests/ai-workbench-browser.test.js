'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {postBrowserFixture}=require('./helpers/post-browser-fixture');
const UUID='11111111-1111-4111-8111-111111111111';
async function fixture(options={}) {
  const f=await postBrowserFixture({counts:[1],publicPosts:true,...options});
  await f.page.addStyleTag({path:path.resolve('css/ai-workbench.css')});
  await f.page.addScriptTag({path:path.resolve('js/ai-core/tool-workbench.js')});
  await f.page.evaluate(({png,uuid})=>{
    window.wbCalls=[];window.wbAsk=[];window.wbRecords=[];window.wbCurrent=true;
    window.wbApi=async(path,opts={})=>{
      wbCalls.push({path,method:opts.method,body:opts.body});
      if(window.wbDelay && path.endsWith(wbDelay))await new Promise(resolve=>window.wbRelease=resolve);
      if(opts.signal?.aborted)throw new DOMException('cancelled','AbortError');
      if(path.endsWith('/tool')){
        const {name,args}=opts.body;
        if(name==='read_web_page'){if(window.wbFailRead){wbFailRead=false;return {ok:true,result:{error:'本地模拟读取失败'}};}return {ok:true,result:{url:args.url,title:'真实模拟来源',content:'2026-10-14 项目开始。\n\n2026-10-15 完成检查。'}};}
        if(name==='make_chart')return {ok:true,result:{cards:[{type:'make_chart',title:'图表',data:{image:png,title:args.title}}]}};
        if(name==='calculate')return {ok:true,result:{content:args.expression+' = 4',cards:[{type:'calculate',data:{expression:args.expression,result:4}}]}};
        if(name==='make_file')return {ok:true,result:{cards:[{data:{filename:args.filename+'.xlsx',data_url:'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,UEs='}}]}};
        if(name==='generate_pdf')return {ok:true,result:{cards:[{data:{filename:args.filename+'.pdf',data_url:'data:application/pdf;base64,JVBERg=='}}]}};
        return {ok:true,result:{content:'真实模拟工具结果'}};
      }
      if(path.endsWith('/parse'))return {ok:true,document:{name:opts.body.name,text:'2026-10-14 文件中的事件。',kind:'txt'}};
      if(path.endsWith('/ocr'))return {ok:true,result:{text:'框选中的真实模拟文字',provider:'isolated'}};
      if(path.endsWith('/assets')&&opts.method==='POST'){const record={...opts.body,id:opts.body.id||uuid,created_at:'2026-10-14'};wbRecords=wbRecords.filter(r=>r.id!==record.id);wbRecords.unshift(record);return {ok:true,record};}
      if(path.endsWith('/assets'))return {ok:true,records:wbRecords.map(({data,...rest})=>rest)};
      if(path.includes('/assets/')&&opts.method==='GET')return {ok:true,record:wbRecords.find(r=>r.id===path.split('/').at(-1))};
      if(path.includes('/assets/')&&opts.method==='DELETE'){wbRecords=wbRecords.filter(r=>r.id!==path.split('/').at(-1));return {ok:true,removed:true};}
      return {ok:true};
    };
    window.wbOpen=()=>window.wb=XtjAiCore.ToolWorkbench.open({owner:'alice',current:()=>wbCurrent,api:wbApi,onAsk:async payload=>{wbAsk.push(payload);}});
    wbOpen();
  },{png:'data:image/png;base64,'+f.png.toString('base64'),uuid:UUID});
  await f.page.getByRole('dialog',{name:'小猫工具工作台'}).waitFor();
  return f;
}
async function tab(page,name) {await page.getByRole('tab',{name,exact:true}).click();}
async function pasteCsv(page,text='项目,金额\n甲,12\n乙,3\n丙,25') {await page.getByLabel('或粘贴 CSV 数据',{exact:true}).fill(text);await page.getByRole('button',{name:'读取粘贴内容',exact:true}).click();await page.locator('.aw-table').waitFor();}
test('actual table preview filters numeric rows, creates chart, edits headers and downloads all CSV rows',async()=>{
  const f=await fixture();try{
    await pasteCsv(f.page);await f.page.getByLabel('筛选列',{exact:true}).selectOption('1');await f.page.getByLabel('条件',{exact:true}).selectOption('gt');await f.page.getByLabel('筛选值',{exact:true}).fill('10');await f.page.getByRole('button',{name:'筛选',exact:true}).click();assert.equal(await f.page.locator('.aw-table tbody tr').count(),2);
    await f.page.getByLabel('图表标题',{exact:true}).fill('真实金额对比');await f.page.getByRole('button',{name:'绘制图表',exact:true}).click();await f.page.locator('.aw-chart img').waitFor();const chart=await f.page.evaluate(()=>wbCalls.find(c=>c.body?.name==='make_chart'));assert.deepEqual(chart.body.args.series[0].data,[12,25]);
    await f.page.getByRole('button',{name:'编辑与导出成果',exact:true}).click();await f.page.getByLabel('列 2 名称',{exact:true}).fill('金额（元）');await f.page.getByLabel('成果标题',{exact:true}).fill('真实表格成果');await f.page.getByLabel('摘要 / 正文（可编辑）',{exact:true}).fill('筛选金额大于10的数据。');
    const pending=f.page.waitForEvent('download');await f.page.getByRole('button',{name:'下载完整 CSV',exact:true}).click();const download=await pending;assert.equal(download.suggestedFilename(),'真实表格成果.csv');
    await f.page.getByRole('button',{name:'生成正式文档',exact:true}).click();await f.page.getByText('PDF 文档已生成。',{exact:true}).waitFor();const pdf=await f.page.evaluate(()=>wbCalls.find(c=>c.body?.name==='generate_pdf'));assert.equal(pdf.body.args.blocks.find(b=>b.type==='table').headers[1],'金额（元）');assert.equal(pdf.body.args.blocks.find(b=>b.type==='table').rows.length,2);
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('web selection clipping persists original source and date, then lazily reads private saved content',async()=>{
  const f=await fixture();try{
    await tab(f.page,'网页摘录');await f.page.getByLabel('网页地址',{exact:true}).fill('https://example.com/source');await f.page.getByRole('button',{name:'读取网页',exact:true}).click();await f.page.getByLabel('选中要保留的正文段落',{exact:true}).waitFor();
    await f.page.getByLabel('选中要保留的正文段落',{exact:true}).evaluate(el=>el.setSelectionRange(0,20));await f.page.getByRole('button',{name:'保存选中段落',exact:true}).click();assert.equal(await f.page.locator('.aw-card a').getAttribute('href'),'https://example.com/source');
    await f.page.getByRole('button',{name:'编辑与导出',exact:true}).click();await f.page.getByRole('button',{name:'保存到我的账号',exact:true}).click();await f.page.getByText('成果已保存到当前账号',{exact:true}).waitFor();const save=await f.page.evaluate(()=>wbCalls.find(c=>c.path.endsWith('/assets')&&c.method==='POST'));assert.equal(save.body.kind,'clip');assert.equal(save.body.data.clips[0].url,'https://example.com/source');assert.match(save.body.data.clips[0].capturedAt,/^20\d\d-/);
    await f.page.getByRole('button',{name:'读取已保存成果',exact:true}).click();await f.page.getByRole('button',{name:'打开已保存成果',exact:true}).click();await f.page.waitForFunction(()=>wbCalls.some(c=>c.path.endsWith('/assets/11111111-1111-4111-8111-111111111111')&&c.method==='GET'));await f.page.getByLabel('成果标题',{exact:true}).fill('改名摘录');await f.page.getByRole('button',{name:'保存到我的账号',exact:true}).click();await f.page.waitForFunction(()=>wbCalls.filter(c=>c.path.endsWith('/assets')&&c.method==='POST').length===2);assert.equal((await f.page.evaluate(()=>wbCalls.filter(c=>c.path.endsWith('/assets')&&c.method==='POST').at(-1))).body.id,UUID);
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('timeline extracts actual dated paragraphs and decision matrix computes only entered scores',async()=>{
  const f=await fixture();try{
    await tab(f.page,'时间线');await f.page.getByLabel('粘贴资料文字',{exact:true}).fill('2026-10-14 项目完成。\n\n2025-02-29 日期无效。');await f.page.getByLabel('这份文字的来源名称',{exact:true}).fill('真实会议记录');await f.page.getByRole('button',{name:'加入文字资料',exact:true}).click();await f.page.getByRole('button',{name:'提取明确日期',exact:true}).click();assert.equal(await f.page.locator('.aw-timeline article').count(),1);assert.equal(await f.page.getByLabel('引用位置',{exact:true}).inputValue(),'真实会议记录 · 段落 1');await f.page.getByLabel('事件内容',{exact:true}).fill('人工校正：项目完成。');await f.page.getByRole('button',{name:'编辑与导出时间线',exact:true}).click();assert.match(await f.page.locator('.aw-table').textContent(),/人工校正/);
    await tab(f.page,'决策对比');await f.page.getByLabel('维度 1',{exact:true}).first().fill('成本');await f.page.getByLabel('维度 2',{exact:true}).first().fill('体验');await f.page.getByLabel('权重',{exact:true}).nth(0).fill('3');await f.page.getByLabel('权重',{exact:true}).nth(1).fill('1');await f.page.getByLabel('方案 1',{exact:true}).fill('方案甲');await f.page.getByLabel('方案 2',{exact:true}).fill('方案乙');await f.page.getByLabel('维度 1',{exact:true}).nth(1).fill('8');await f.page.getByLabel('维度 2',{exact:true}).nth(1).fill('4');await f.page.getByLabel('维度 1',{exact:true}).nth(2).fill('5');await f.page.getByLabel('维度 2',{exact:true}).nth(2).fill('9');await f.page.getByRole('button',{name:'计算综合分',exact:true}).click();assert.match(await f.page.locator('.aw-table tbody tr').first().textContent(),/方案甲7/);
    assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('image OCR sends independent crop while original bytes stay intact for multi-image comparison',async()=>{
  const f=await fixture();try{
    await tab(f.page,'图片');await f.page.locator('.aw-file-picker input').setInputFiles([{name:'原图甲.png',mimeType:'image/png',buffer:f.png},{name:'原图乙.png',mimeType:'image/png',buffer:f.png}]);await f.page.locator('.aw-image-grid canvas').nth(1).waitFor();const dimensions=await f.page.locator('.aw-image-grid .aw-note').first().textContent();assert.match(dimensions,/原图/);
    await f.page.getByLabel('框选坐标 x,y,宽,高（原图像素）',{exact:true}).first().fill('0,0,1,1');await f.page.getByRole('button',{name:'识别框选文字',exact:true}).first().click();await f.page.getByLabel('识别文字（可校正）',{exact:true}).waitFor();const crop=await f.page.evaluate(()=>wbCalls.find(c=>c.path.endsWith('/ocr')).body);assert.match(crop.name,/框选-/);assert.notEqual(crop.dataUrl,'data:image/png;base64,'+f.png.toString('base64'));
    await f.page.getByRole('button',{name:'让小猫对照这些原图',exact:true}).click();await f.page.waitForFunction(()=>wbAsk.length===1);const ask=await f.page.evaluate(()=>wbAsk[0]);assert.equal(ask.attachments.length,2);assert.equal(ask.attachments[0].name,'原图甲.png');assert.equal(ask.attachments[0].dataUrl,'data:image/png;base64,'+f.png.toString('base64'));assert.equal(await f.page.locator('.aw-overlay').count(),0);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('tool sequence records failure, retries only failed work, then preserves real completed steps',async()=>{
  const f=await fixture();try{
    await tab(f.page,'工具流程');await f.page.getByRole('button',{name:'网页 → 时间线 → 文档',exact:true}).click();await f.page.getByLabel('HTTPS 网页地址',{exact:true}).fill('https://example.com/source');await f.page.evaluate(()=>window.wbFailRead=true);await f.page.getByRole('button',{name:'执行未完成步骤',exact:true}).click();await f.page.locator('[data-step-status="failed"]').waitFor();assert.equal(await f.page.evaluate(()=>wbCalls.filter(c=>c.body?.name==='read_web_page').length),1);assert.equal(await f.page.evaluate(()=>wbCalls.filter(c=>c.body?.name==='generate_pdf').length),0);
    await f.page.getByRole('button',{name:'执行未完成步骤',exact:true}).click();await f.page.waitForFunction(()=>document.querySelectorAll('[data-step-status="done"]').length===3);assert.equal(await f.page.evaluate(()=>wbCalls.filter(c=>c.body?.name==='read_web_page').length),2);assert.equal(await f.page.evaluate(()=>wbCalls.filter(c=>c.body?.name==='generate_pdf').length),1);
    await f.page.getByRole('button',{name:'执行未完成步骤',exact:true}).click();assert.equal(await f.page.evaluate(()=>wbCalls.filter(c=>c.body?.name==='read_web_page').length),2);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('audio import shows actual local progress, permits transcript correction, and asks for summary only on click',async()=>{
  const f=await fixture();try{
    await tab(f.page,'音频');await f.page.evaluate(()=>{window.wbTranscribes=[];window.XTJVoiceTranscription={transcribeBlob:async(file,opts)=>{wbTranscribes.push({name:file.name,owner:opts.owner});opts.onState({label:'首次下载语音模型 35%'});await new Promise(resolve=>window.wbTranscribeRelease=resolve);if(opts.signal.aborted)throw new DOMException('cancelled','AbortError');return '会议确定周五检查项目。';}};});
    await f.page.locator('.aw-file-picker input').setInputFiles({name:'真实会议.wav',mimeType:'audio/wav',buffer:Buffer.from('isolated-audio-worker-input')});await f.page.getByRole('button',{name:'本地转写',exact:true}).click();await f.page.getByText('首次下载语音模型 35%',{exact:true}).waitFor();assert.equal(await f.page.evaluate(()=>wbAsk.length),0);await f.page.evaluate(()=>wbTranscribeRelease());await f.page.waitForFunction(()=>document.querySelector('.aw-field textarea')?.value.includes('会议确定'));await f.page.getByLabel('转写文字（可校正）',{exact:true}).fill('会议确定周五由小王检查项目。');await f.page.getByRole('button',{name:'整理摘要与待办',exact:true}).click();await f.page.waitForFunction(()=>wbAsk.length===1);const payload=await f.page.evaluate(()=>wbAsk[0]);assert.match(payload.text,/由小王/);assert.match(payload.text,/真实会议.wav/);assert.deepEqual(await f.page.evaluate(()=>wbTranscribes),[{name:'真实会议.wav',owner:'alice'}]);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('late requests after close/account change cannot append old private content; keyboard traps and tabs work',async()=>{
  const f=await fixture();try{
    await f.page.getByRole('tab',{name:'表格',exact:true}).focus();await f.page.keyboard.press('ArrowRight');assert.equal(await f.page.getByRole('tab',{name:'网页摘录',exact:true}).getAttribute('aria-selected'),'true');await f.page.getByLabel('网页地址',{exact:true}).fill('https://example.com/source');await f.page.evaluate(()=>window.wbDelay='/tool');await f.page.getByRole('button',{name:'读取网页',exact:true}).click();await f.page.waitForFunction(()=>typeof wbRelease==='function');await f.page.evaluate(()=>{wbCurrent=false;window.dispatchEvent(new Event('xtj:auth-changed'));wbRelease();});await f.page.waitForTimeout(30);assert.equal(await f.page.locator('.aw-overlay').count(),0);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
test('workbench fits compressed visible viewport and keeps focused form reachable without touching Dock',async()=>{
  const f=await fixture();try{
    const before=await f.page.evaluate(()=>document.querySelector('.dock')?.getAttribute('style')||'');await f.page.getByLabel('或粘贴 CSV 数据',{exact:true}).focus();await f.page.evaluate(()=>{const viewport=new EventTarget();Object.assign(viewport,{height:320,width:390,offsetTop:8});Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});wb.dispose();wbOpen();viewport.dispatchEvent(new Event('resize'));});await f.page.waitForTimeout(30);const after=await f.page.evaluate(()=>({dock:document.querySelector('.dock')?.getAttribute('style')||'',rect:document.querySelector('.aw-panel').getBoundingClientRect().toJSON()}));assert.equal(after.dock,before);assert.ok(after.rect.height<=320);assert.ok(after.rect.bottom<=328);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});
