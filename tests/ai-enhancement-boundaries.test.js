'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const output=require('../render-api/ai-assistant-output');
const evidence=require('../render-api/research-evidence');
const documents=require('../render-api/research-documents');
const {createResearchBoard}=require('../render-api/research-board');
const {buildReportPdf}=require('../render-api/ai-report-export');

test('every incomplete followup-opening prefix stays private on premature EOF while fenced examples remain exact',()=>{
  for(const make of [emit=>output.createSafeAssistantStream({emit}),emit=>output.createFollowupStream(emit)])for(let split=5;split<output.FOLLOWUP_OPEN.length;split++){
    const chunks=[],stream=make(text=>chunks.push(text));stream.push('实际正文。\n'+output.FOLLOWUP_OPEN.slice(0,split));const result=stream.finish();assert.equal(result.text,'实际正文。','footer prefix '+split);assert.equal(chunks.join('').trimEnd(),'实际正文。');
  }
  const example='```xml\n<xtj-foll\n```',chunks=[],stream=output.createSafeAssistantStream({emit:value=>chunks.push(value)});stream.push(example);assert.equal(stream.finish().text,example);assert.equal(chunks.join(''),example);
});
test('real usage null/empty totals fall back to valid itemized counts; absence never becomes reported zero',()=>{
  for(const total_tokens of [null,'',undefined]){
    const board=createResearchBoard();board.usage({prompt_tokens:100,completion_tokens:50,total_tokens});assert.equal(board.snapshot().usage.actual_tokens,150);assert.equal(board.snapshot().usage.returned_requests,1);
  }
  const missing=createResearchBoard();missing.usage({total_tokens:null});assert.equal(missing.snapshot().usage.actual_tokens,null);assert.equal(missing.snapshot().usage.returned_requests,0);assert.equal(missing.snapshot().usage.missing_requests,1);
  const zero=createResearchBoard();zero.usage({total_tokens:0});assert.equal(zero.snapshot().usage.actual_tokens,0);
});
test('long search summaries remain independent and enrichment still fetches their actual bodies',async()=>{
  const summary='这是一段搜索摘要，不能证明已经阅读完整文章。'.repeat(60),rows=[{url:'https://a.test/one',snippet:summary},{url:'https://b.test/two',snippet:summary}];
  const result=evidence.dedupeSources(rows);assert.equal(result.unique_count,2);assert.ok(result.sources.every(source=>source.content_checked===false));
  const calls=[];await evidence.enrichSources(rows,{fetchPage:async url=>{calls.push(url);return {content:'实际正文 '+url};}});assert.equal(calls.length,2);
});
test('only truly identical article bodies merge; near copies with conflicting signs or conclusions remain separate',()=>{
  const background=Array.from({length:120},(_,i)=>'第'+i+'项共同研究背景，保留所有实际事实。').join('\n');
  const rows=[{url:'https://source.test/a',content:background+'\n结论：预算增加+100万元。'},
    {url:'https://source.test/b',content:background+'\n结论：预算减少-100万元。'},
    {url:'https://source.test/c',content:background+'\n结论：预算增加+100万元。'}];
  const result=evidence.dedupeSources(rows);assert.equal(result.unique_count,2);assert.equal(result.merged_count,1);assert.equal(result.sources[0].aliases.length,2);assert.ok(result.sources.every(s=>s.content_checked));
});
test('last-document cancellation after parsing prevents both publication and any usable returned context',async()=>{
  const abort=new AbortController(),published=[];
  await assert.rejects(documents.prepareResearchDocuments([{name:'实际资料.pdf',dataUrl:'data:application/pdf;base64,YQ=='}],{signal:abort.signal,
    parseDocumentBuffer:async()=>{abort.abort();return {text:'不应进入模型的迟到文字'};},onDocument:record=>published.push(record)}),/暂停|取消|abort/i);
  assert.equal(published.length,0);
});
test('genuine CJK PDF export preserves literal Markdown syntax inside fenced code',async()=>{
  const answer='```js\nconst s = "**原样**";\nconst md = "[链接](https://example.org)";\n```';
  const buffer=await buildReportPdf({title:'代码原文核对',answer});assert.equal(buffer.subarray(0,5).toString(),'%PDF-');
  const parsed=await require('../render-api/file-parsers').parsePdfBuffer(buffer);assert.match(parsed.text,/\*\*原样\*\*/);assert.match(parsed.text,/\[链接\]\(https:\/\/example\.org\)/);
});
