'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildReportPdf,reportMarkdown,blocksText,reportSources}=require('../render-api/ai-report-export');
test('report export includes real source labels and ignores unsafe links',()=>{
  const report={title:'对照研究',answer:'## 核心结论\n资料明确支持。',createdAt:'2026-10-14T00:00:00Z',sources:[{label:'F2§3',title:'第二份文档',location:'段落3'},{url:'javascript:alert(1)',title:'坏链接'}]};
  const result=reportMarkdown(report);assert.match(result,/\[F2§3\] 第二份文档 · 段落3/);assert.doesNotMatch(result,/javascript:/);assert.match(result,/2026-10-14T00:00:00.000Z/);
});
test('CJK PDF is genuine PDF and Chinese content survives text extraction',async()=>{
  const buffer=await buildReportPdf({title:'中文研究报告',answer:'## 核心结论\n两份文件的预算存在差异。\n## 对照结果\n第一份十万元；第二份十二万元。',sources:[{url:'https://example.org/source',title:'实际来源'}]});
  assert.equal(buffer.subarray(0,5).toString(),'%PDF-');assert.ok(buffer.includes(Buffer.from('/FontFile2')));
  const result=await require('../render-api/file-parsers').parsePdfBuffer(buffer);assert.match(result.text,/预算存在差异/);assert.match(result.text,/第二份十二万元/);assert.match(result.text,/实际来源/);
});
test('structured table conversion never silently drops columns or rows',()=>{
  const headers=Array.from({length:15},(_,i)=>'列'+i),rows=Array.from({length:350},(_,i)=>headers.map((_,j)=>i+':'+j));
  const text=blocksText([{type:'table',headers,rows}]);assert.match(text,/349:14/);assert.match(text,/第 350 行/);
});
test('empty, oversized and cancelled report exports are explicit failures',async()=>{
  assert.throws(()=>reportMarkdown({answer:''}),/为空/);assert.throws(()=>reportMarkdown({answer:'x'.repeat(500001)}),/50 万/);
  await assert.rejects(buildReportPdf({answer:'正文',signal:AbortSignal.abort()}),/取消/);
  assert.equal(reportSources([{url:'https://user:secret@example.org'}])[0].url,'');
});
test('authenticated HTTP export accepts a long Chinese report and rejects unauthorized bodies before parsing',async()=>{
  const express=require('express'),request=require('supertest'),{installReportExport}=require('../render-api/ai-report-export');
  const app=express();let parsed=0;
  app.use(express.json({limit:'1mb',type:req=>req.path!=='/api/agent/research/export'}));
  installReportExport(app,{
    authenticateUser:(req,res,next)=>req.get('authorization')==='Bearer local-export-test'?next():res.status(401).json({ok:false}),
    rateLimit:()=> (_req,_res,next)=>next(),
    jsonMiddleware:[express.json({limit:'6mb'}),(req,res,next)=>{parsed++;next();}]
  });
  const answer='超长中文研究资料，仍然需要完整导出。'.repeat(20000);
  const rejected=await request(app).post('/api/agent/research/export').send({format:'markdown',answer});
  assert.equal(rejected.status,401);assert.equal(parsed,0);
  const accepted=await request(app).post('/api/agent/research/export').set('Authorization','Bearer local-export-test').send({format:'markdown',title:'完整资料',answer,sources:[{title:'原始来源',url:'https://original.example/article',aliases:[{title:'转载出处',url:'https://repost.example/article'}]}]});
  assert.equal(accepted.status,200);assert.equal(parsed,1);
  const text=Buffer.from(accepted.body.file.data_url.split(',')[1],'base64').toString();
  assert.ok(text.includes(answer));assert.match(text,/合并出处：转载出处/);assert.match(text,/https:\/\/repost.example\/article/);
});
test('aborting a queued PDF releases its queue entry and later exports still succeed',async()=>{
  const answer=('第一节 实际长报告段落。\n\n').repeat(2500),controller=new AbortController();
  const first=buildReportPdf({title:'在导出一',answer}),second=buildReportPdf({title:'在导出二',answer});
  const queued=buildReportPdf({title:'已取消队列',answer:'不应生成',signal:controller.signal});
  controller.abort();await assert.rejects(queued,/取消/);
  await Promise.all([first,second]);
  const final=await buildReportPdf({answer:'队列取消后仍可以导出。'});
  assert.equal(final.subarray(0,5).toString(),'%PDF-');
});
