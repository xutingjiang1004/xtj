'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),JSZip=require('jszip');
const { parseDocumentBuffer }=require('../render-api/file-parsers');
async function docx(text){const zip=new JSZip();zip.file('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>');return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});}
test('Word extraction runs off the HTTP event loop and keeps normal text',async()=>{
 const bytes=await docx('正常文档 original text');let tick=false;setImmediate(()=>tick=true);
 const result=await parseDocumentBuffer(bytes,'docx');assert.match(result.text,/正常文档 original text/);assert.equal(tick,true);
});
test('a tiny compressed Office archive cannot expand past its entry budget',async()=>{
 const bytes=await docx('x'.repeat(17*1024*1024));assert.ok(bytes.length<100000);
 await assert.rejects(parseDocumentBuffer(bytes,'docx'),/expansion_limit/);
 assert.match((await parseDocumentBuffer(await docx('after rejection'),'docx')).text,/after rejection/);
});
test('Excel extraction bounds sparse sheet ranges while retaining real cells',async()=>{
 const XLSX=require('xlsx'),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['原文',42],['row2',12]]),'Sheet1');
 const result=await parseDocumentBuffer(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),'xlsx');assert.match(result.text,/原文,42/);assert.match(result.text,/row2,12/);
});
