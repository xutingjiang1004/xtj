'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express');
const {registerWorkbenchRoutes}=require('../render-api/ai-workbench');
const {parseDocumentBuffer}=require('../render-api/file-parsers');
const UUID='11111111-1111-4111-8111-111111111111';
async function fixture(options={}) {
  const calls=[],records=new Map(),app=express();
  app.use(express.json({limit:'2mb',type:req=>!['/api/agent/workbench/parse','/api/agent/workbench/ocr'].includes(req.path) && !!req.is('application/json')}));
  registerWorkbenchRoutes(app,{
    authenticateUser(req,res,next){calls.push('auth');if(req.headers.authorization!=='Bearer isolated-alice')return res.status(401).json({ok:false});req.userName='alice';req.accountId='alice-account';next();},
    rateLimit(){return (req,res,next)=>{calls.push('rate');next();};},
    jsonMiddleware(req,res,next){calls.push('large-json');express.json({limit:'12mb'})(req,res,next);},
    requestContext:req=>({searchConsumed:0,requestId:'isolated'}),
    async executeToolCall(tool,context){calls.push({tool,context});return options.execute?options.execute(tool,context):{tool_name:tool.function.name,content:'实际测试结果'};},
    parseDocumentBuffer,ocrImageBuffer:async()=>({text:'识别副本结果',provider:'isolated'}),
    exportDocument:options.exportDocument,
    assets:{
      async list(owner){calls.push({action:'list',owner});return [...records.values()].filter(v=>v.owner===owner.accountId).map(({data,owner,...value})=>value);},
      async get(owner,id){calls.push({action:'get',owner,id});const value=records.get(id);return value&&value.owner===owner.accountId?value:null;},
      async save(owner,value){calls.push({action:'save',owner,value});const record={...value,id:value.id||UUID,owner:owner.accountId};records.set(record.id,record);return record;},
      async remove(owner,id){calls.push({action:'remove',owner,id});if(records.get(id)?.owner!==owner.accountId)return false;return records.delete(id);}
    }
  });
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/api/agent/workbench';
  return {calls,records,server,async request(path,body,method='POST',auth=true,signal){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer isolated-alice'}:{})},body:body?JSON.stringify(body):undefined,signal});return {status:response.status,value:await response.json()};},async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
test('real authenticated route dispatches only bounded whitelisted tools and a server-owned account',async()=>{
  const f=await fixture();try{
    let result=await f.request('/tool',{name:'calculate',args:{expression:'2+2'}},'POST',false);assert.equal(result.status,401);assert.equal(f.calls.filter(c=>c.tool).length,0);
    result=await f.request('/tool',{name:'run_code',args:{code:'return 1'}});assert.equal(result.status,400);assert.equal(f.calls.filter(c=>c.tool).length,0);
    result=await f.request('/tool',{name:'calculate',args:{expression:'2+2'},accountId:'victim'});assert.equal(result.status,200);const call=f.calls.find(c=>c.tool);assert.equal(call.context.userName,'alice');assert.equal(call.context.accountId,'alice-account');assert.equal(call.tool.function.arguments,'{"expression":"2+2"}');assert.ok(call.context.signal instanceof AbortSignal);
  }finally{await f.close();}
});
test('large upload route authenticates and limits before parsing then reuses actual isolated Excel worker',async()=>{
  const f=await fixture();try{
    let r=await f.request('/parse',{name:'a.txt',dataUrl:'data:text/plain;base64,YQ=='},'POST',false);assert.equal(r.status,401);assert.deepEqual(f.calls,['auth']);
    const XLSX=require('xlsx'),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['名称','数量'],['甲',12],['乙',0]]),'实际数据');const buffer=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
    r=await f.request('/parse',{name:'实际.xlsx',dataUrl:'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,'+buffer.toString('base64')});assert.equal(r.status,200);assert.match(r.value.document.text,/实际数据/);assert.match(r.value.document.text,/甲,12/);assert.deepEqual(r.value.document.previewLimit,{sheets:20,rows:200,columns:60});assert.deepEqual(f.calls.slice(1,4),['auth','rate','large-json']);
    r=await f.request('/parse',{name:'../../server.js',dataUrl:'data:text/plain;base64,YQ=='});assert.equal(r.status,400);
  }finally{await f.close();}
});
test('asset list is metadata-only; individual read/update/delete all use the verified account',async()=>{
  const f=await fixture();try{
    let r=await f.request('/assets',{kind:'clip',title:'真实摘录',data:{text:'真实原文',url:'https://example.com'},owner_id:'victim'});assert.equal(r.status,200);assert.equal(r.value.record.owner,'alice-account');
    r=await f.request('/assets',undefined,'GET');assert.equal(r.value.records.length,1);assert.equal(r.value.records[0].data,undefined);
    r=await f.request('/assets/'+UUID,undefined,'GET');assert.equal(r.value.record.data.text,'真实原文');
    r=await f.request('/assets/'+UUID,undefined,'DELETE');assert.equal(r.value.removed,true);
    r=await f.request('/assets/'+UUID,undefined,'GET');assert.equal(r.status,404);
    r=await f.request('/assets',{kind:'note',title:'凭据',data:{api_key:'secret'}});assert.equal(r.status,400);
    assert.ok(f.calls.filter(c=>c.owner).every(c=>c.owner.userName==='alice'&&c.owner.accountId==='alice-account'));
  }finally{await f.close();}
});
test('OCR consumes only provided image bytes and PDF adapter returns the actual document format',async()=>{
  const f=await fixture({exportDocument:async(args,owner)=>({tool_name:'generate_pdf',cards:[{data:{filename:args.filename+'.pdf',data_url:'data:application/pdf;base64,JVBERg=='}}]})});try{
    let r=await f.request('/ocr',{name:'副本.png',dataUrl:'data:image/png;base64,'+Buffer.from('fake-png-for-mocked-ocr').toString('base64')});assert.equal(r.status,200);assert.equal(r.value.result.text,'识别副本结果');
    r=await f.request('/ocr',{name:'remote',dataUrl:'https://127.0.0.1/secret'});assert.equal(r.status,400);
    r=await f.request('/tool',{name:'generate_pdf',args:{title:'中文报告',filename:'中文报告',blocks:[{type:'p',text:'真实文字'}]}});assert.equal(r.status,200);assert.equal(r.value.result.cards[0].data.filename,'中文报告.pdf');assert.equal(f.calls.filter(c=>c.tool).length,0);
  }finally{await f.close();}
});
test('browser cancellation aborts the owned tool context and suppresses late replies',async()=>{
  let seen,release;const ready=new Promise(resolve=>seen=resolve),f=await fixture({execute:async(tool,context)=>{seen(context);await new Promise(resolve=>release=resolve);return {content:'late'};}});try{
    const abort=new AbortController(),pending=f.request('/tool',{name:'read_web_page',args:{url:'https://example.com'}},'POST',true,abort.signal);const context=await ready;
    const serverAborted=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server tool context did not abort')),5000);context.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
    abort.abort();await assert.rejects(pending,/abort/i);await serverAborted;assert.equal(context.signal.aborted,true);release();
  }finally{if(release)release();await f.close();}
});
