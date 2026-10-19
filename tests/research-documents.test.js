'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const research=require('../render-api/research-documents');
const file=(name,text)=>({name,dataUrl:'data:text/plain;base64,'+Buffer.from(text).toString('base64')});
test('later file questions reuse only private, undeleted documents from the same conversation',async()=>{
 const prepared=await research.prepareResearchDocuments([file('a.md','实际保留的段落')]),calls=[];
 const query={select(v){calls.push(['select',v]);return this;},eq(k,v){calls.push([k,v]);return this;},filter(k,op,v){calls.push([k,op,v]);return this;},order(){return this;},range(){return Promise.resolve({data:[{media_url:JSON.stringify({convId:'OTHER',prepared_documents:prepared.documents})},{media_url:JSON.stringify({convId:'CURRENT1',deleted:true,prepared_documents:prepared.documents})},{media_url:JSON.stringify({convId:'CURRENT1',prepared_documents:prepared.documents})}]});}};
 const result=await research.loadConversationDocuments({from:()=>query},'alice','CURRENT1','ai_msg_conv_CURRENT1_%');assert.equal(result[0].paragraphs[0].text,'实际保留的段落');assert.ok(calls.some(([k,v])=>k==='user_name'&&v==='alice'));
});
test('all comparison files get stable identifiers and real extracted paragraph references without changing originals',async()=>{
 const files=[file('规划一.md','第一段\n\n第二段'),file('规划二.txt','不同的实际内容')],copy=JSON.stringify(files);
 const result=await research.prepareResearchDocuments(files);
 assert.match(result.context,/\[F1:P2\] 第二段/);assert.match(result.context,/\[F2:P1\]/);assert.equal(JSON.stringify(files),copy);
 assert.equal(result.documents[0].sha256,createHash('sha256').update('第一段\n\n第二段').digest('hex'));
 assert.equal(research.publicDocuments(result.documents)[0].used_paragraphs,2);assert.doesNotMatch(JSON.stringify(research.publicDocuments(result.documents)),/dataUrl|paragraphs.*text/);
});
test('partial or unsupported documents remain visible with honest limits and never invent text or page numbers',async()=>{
 const result=await research.prepareResearchDocuments([file('long.md','x'.repeat(18000)),file('bad.docx','broken')],{parseDocumentBuffer:async()=>{throw Error('损坏文件')}});
 assert.equal(result.documents[0].truncated,true);assert.equal(result.documents[1].status,'unread');assert.match(result.context,/损坏文件/);
 assert.doesNotMatch(result.context,/页码|第1页/);assert.ok(result.context.length<15000);
});
test('file count, malformed data and cancellation are checked before model work',async()=>{
 await assert.rejects(research.prepareResearchDocuments(Array(11).fill(file('a.md','a'))),/10/);
 await assert.rejects(research.prepareResearchDocuments([{name:'x',dataUrl:'https://private.test/x'}]),/文件格式/);
 await assert.rejects(research.prepareResearchDocuments([file('a.md','a')],{signal:{aborted:true}}),/暂停/);
});
test('image OCR failure is explicit and Excel preview limits accompany real text',async()=>{
 const result=await research.prepareResearchDocuments([{name:'cat.png',dataUrl:'data:image/png;base64,YQ=='},file('sheet.xlsx','a')],{
 ocrImageBuffer:async()=>({error:'没有配置 OCR'}),parseDocumentBuffer:async()=>({text:'工作表1\nA,B\n1,2'})});
 assert.equal(result.documents[0].status,'unread');assert.match(result.documents[1].limitation,/200 行/);
 assert.match(result.context,/没有配置 OCR/);assert.match(result.context,/1,2/);
});
