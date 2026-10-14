'use strict';
const PDFDocument = require('pdfkit');
const path = require('node:path');
const {setImmediate: yieldTurn} = require('node:timers/promises');
const FONT = path.join(__dirname, 'assets/fonts/wqy-microhei.ttc');
const MAX_CHARS = 500000, MAX_PDF_BYTES = 16 * 1024 * 1024;
let active = 0;
const waiting = [];
function safeUrl(value) { try { if(String(value||'').length>2000)return '';const url = new URL(String(value || '')); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch (_) { return ''; } }
function cancelled(signal){if(signal&&signal.aborted)throw Error('导出已取消');}
async function acquire(signal){
  cancelled(signal);
  if(active<2){active++;return;}
  if(waiting.length>=4)throw Error('报告导出繁忙，请稍后重试');
  await new Promise((resolve,reject)=>{
    const item={resolve:function(){if(signal)signal.removeEventListener('abort',abort);resolve();}};
    function abort(){const index=waiting.indexOf(item);if(index>=0)waiting.splice(index,1);if(signal)signal.removeEventListener('abort',abort);reject(Error('导出已取消'));}
    waiting.push(item);if(signal)signal.addEventListener('abort',abort,{once:true});
  });
}
function release(){const next=waiting.shift();if(next)next.resolve();else active--;}
function reportSources(value) {
  return (Array.isArray(value) ? value : []).slice(0, 200).map((item, index) => ({
    label: String(item && (item.label || item.source_id) || index + 1).slice(0, 40),
    title: String(item && (item.title || item.name) || '来源 ' + (index + 1)).slice(0, 300),
    url: safeUrl(item && (item.url || item.link)),
    detail: String(item && (item.location || item.file_name) || '').slice(0, 300),
    aliases:(Array.isArray(item&&item.aliases)?item.aliases:[]).slice(0,20).map(alias=>({title:String(alias.title||'合并出处').slice(0,300),url:safeUrl(alias.url)})).filter(alias=>alias.url)
  }));
}
function reportMarkdown(report) {
  const answer = String(report.answer || '');
  if (!answer.trim() || answer.length > MAX_CHARS) throw Error('报告正文为空或超过 50 万字符');
  const title = String(report.title || '深入研究报告').replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 160);
  const time = new Date(report.createdAt || Date.now());
  const lines = ['# ' + title, '', '导出时间：' + (Number.isFinite(time.getTime()) ? time.toISOString() : new Date().toISOString()), '', answer];
  const sources = reportSources(report.sources);
  if (sources.length) {
    lines.push('', '## 参考资料', '');
    sources.forEach(source => {lines.push('[' + source.label + '] ' + source.title + (source.detail ? ' · ' + source.detail : '') + (source.url ? '\n' + source.url : ''));source.aliases.forEach(alias=>{if(alias.url!==source.url)lines.push('  合并出处：'+alias.title+'\n  '+alias.url);});});
  }
  return lines.join('\n');
}
function blocksText(blocks) {
  const output = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'table') {
      const headers = Array.isArray(block.headers) ? block.headers : [];
      for (const [index,row] of (Array.isArray(block.rows) ? block.rows : []).entries()) {
        const cells = Array.isArray(row) ? row : [row];
        output.push('第 ' + (index + 1) + ' 行：' + cells.map((cell,i) => String(headers[i] || '列 ' + (i + 1)) + '：' + String(cell ?? '')).join('；'));
      }
    } else if (['list','ul','ol'].includes(block.type)) {
      for (const [index,item] of (Array.isArray(block.items) ? block.items : []).entries()) output.push((block.type==='ol'?(index+1)+'. ':'- ') + String(item));
    } else if (block.type === 'code') output.push('```\n'+String(block.text||block.content||'')+'\n```');
    else if (block.type === 'hr') output.push('---');
    else {
      const level=/^h[1-6]$/.test(block.type)?Number(block.type.slice(1)):block.type==='heading'?Math.min(6,Math.max(1,Number(block.level)||2)):0;
      output.push((level?'#'.repeat(level)+' ':'') + String(block.text || block.content || ''));
    }
  }
  return output.join('\n\n');
}
function parseBlocks(markdown) {
  const result = [];
  let fenced = false, code = [];
  for (const line of String(markdown).split('\n')) {
    if (/^\s*```/.test(line)) { if (fenced) {result.push({type:'code',text:code.join('\n')});code=[];} fenced=!fenced;continue; }
    if (fenced) {code.push(line);continue;}
    if (/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && /-/.test(line)) continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    result.push(heading ? {type:'heading',level:heading[1].length,text:heading[2]} : {type:'paragraph',text:line});
  }
  if (code.length) result.push({type:'code',text:code.join('\n')});
  return result;
}
async function buildReportPdf(report={}) {
  await acquire(report.signal);
  let doc;
  try {
    cancelled(report.signal);
    const answer = report.answer === undefined ? blocksText(report.blocks) : String(report.answer);
    const markdown = reportMarkdown({...report,answer});
    const title = String(report.title || '深入研究报告').slice(0,160);
    doc = new PDFDocument({size:'A4',margin:48,bufferPages:true,info:{Title:title,Author:'XTJ 小猫 AI'}});
    doc.registerFont('Wqy',FONT,'WenQuanYiMicroHei').font('Wqy');
    const chunks = [];let bytes=0;
    const completed = new Promise((resolve,reject) => {
      doc.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_PDF_BYTES){doc.destroy(Error('报告文件超过 16 MiB，请改用 Markdown 导出'));return;}chunks.push(chunk);});
      doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
    });
    // Attach rejection handling while content is being generated.
    completed.catch(()=>{});
    const blocks = parseBlocks(markdown);
    const headings = blocks.filter(block=>block.type==='heading'&&block.level>1).slice(0,100);
    doc.fillColor('#176743').fontSize(22).text(title,{paragraphGap:12});
    doc.fillColor('#526b60').fontSize(10).text('XTJ 小猫 AI · 研究成果\n' + new Date().toISOString(),{paragraphGap:16});
    if(headings.length){doc.fillColor('#16352e').fontSize(13).text('目录',{paragraphGap:8});for(const heading of headings)doc.fontSize(10).text(heading.text,{paragraphGap:4});}
    doc.addPage();
    let firstTitle=true;
    for (let index=0;index<blocks.length;index++) {
      if (report.signal && report.signal.aborted) throw Error('导出已取消');
      const block=blocks[index];
      if(firstTitle&&block.type==='heading'&&block.level===1){firstTitle=false;continue;}
      if(block.type==='heading'){
        if(doc.y>doc.page.height-110)doc.addPage();
        doc.moveDown(.6).fillColor('#176743').fontSize(block.level===2?15:12).text(block.text,{paragraphGap:7});
        doc.outline.addItem(block.text);
      }else if(!block.text.trim())doc.moveDown(.35);
      else{
        doc.fillColor('#16352e').fontSize(block.type==='code'?9:10.5);
        const text=block.type==='code'?block.text:block.text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,'$1 ($2)').replace(/\*\*([^*]+)\*\*/g,'$1');
        for(let offset=0;offset<text.length;offset+=2000){cancelled(report.signal);doc.text(text.slice(offset,offset+2000),{paragraphGap:4,lineGap:2});if(offset%8000===0)await yieldTurn();}
      }
      if(index%15===0)await yieldTurn();
      if(bytes>MAX_PDF_BYTES)throw Error('报告文件过大，请改用 Markdown 导出');
    }
    const range=doc.bufferedPageRange();
    for(let page=range.start;page<range.start+range.count;page++){
      doc.switchToPage(page);const margin=doc.page.margins.bottom;doc.page.margins.bottom=0;
      doc.fillColor('#526b60').fontSize(8).text('XTJ · '+(page+1)+' / '+range.count,48,doc.page.height-30,{width:doc.page.width-96,align:'center',lineBreak:false});doc.page.margins.bottom=margin;
    }
    cancelled(report.signal);doc.end();return await completed;
  } catch(error){if(doc)doc.destroy();throw error;}finally {release();}
}
function filename(value,extension) {return String(value||'深入研究报告').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100)+'.'+extension;}
function installReportExport(app,deps) {
  app.post('/api/agent/research/export',deps.authenticateUser,deps.rateLimit(60000,8),...(deps.jsonMiddleware?[deps.jsonMiddleware]:[]),async(req,res)=>{
    const controller=new AbortController(),abort=()=>controller.abort();req.once('aborted',abort);res.once('close',abort);
    try {
      const body=req.body||{},report={title:body.title,answer:body.answer,sources:body.sources,createdAt:body.created_at,signal:controller.signal};
      let buffer,mime,extension;
      if(body.format==='markdown'){buffer=Buffer.from(reportMarkdown(report));mime='text/markdown;charset=utf-8';extension='md';}
      else if(body.format==='pdf'){buffer=await buildReportPdf(report);mime='application/pdf';extension='pdf';}
      else return res.status(400).json({ok:false,error:'请选择 PDF 或 Markdown 格式'});
      if(!controller.signal.aborted&&!res.writableEnded)res.json({ok:true,file:{filename:filename(body.title,extension),mime_type:mime,data_url:'data:'+mime+';base64,'+buffer.toString('base64')}});
    }catch(error){if(!controller.signal.aborted&&!res.headersSent)res.status(/繁忙/.test(error.message)?503:400).json({ok:false,error:error.message||'报告导出失败'});}
    finally{req.removeListener('aborted',abort);res.removeListener('close',abort);}
  });
}
module.exports={buildReportPdf,reportMarkdown,blocksText,reportSources,filename,installReportExport};
