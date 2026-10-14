'use strict';

// An authenticated, bounded facade over existing tools. This is deliberately
// separate from the model executor: a browser cannot request run_code, server
// paths, arbitrary tool names, or another account's private assets.
const TOOL_FIELDS = Object.freeze({
  read_web_page: ['url'], calculate: ['expression'],
  convert_units: ['value','from_unit','to_unit'],
  make_chart: ['type','title','labels','series','x_label','y_label'],
  make_file: ['format','filename','headers','rows','sheet_name'],
  generate_pdf: ['filename','title','blocks'],
  diff_text: ['old_text','new_text'], text_stats: ['text'],
  sort_filter: ['rows','sort_by','order','filter_field','filter_op','filter_value','limit','unique_by'],
  date_calc: ['action','date1','date2','days','unit']
});
const KINDS = new Set(['clip','table','timeline','decision','note','workflow']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function inputError(message, code='invalid_workbench_input') { return Object.assign(new Error(message),{status:400,code}); }
function jsonSize(value, max, label) {
  let encoded;
  try { encoded=JSON.stringify(value); } catch (_) { throw inputError(label+'格式无效'); }
  if (!encoded || Buffer.byteLength(encoded,'utf8')>max) throw inputError(label+'超过大小上限');
  if (/(?:"(?:__proto__|prototype|constructor)"\s*:)/.test(encoded)) throw inputError(label+'包含不允许的字段');
  return encoded;
}
function validateToolInput(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(TOOL_FIELDS,body.name)) throw inputError('工作台不支持这项工具');
  if (!body.args || typeof body.args!=='object' || Array.isArray(body.args)) throw inputError('工具参数无效');
  jsonSize(body.args,700*1024,'工具输入');
  const args={};
  for (const key of Object.keys(body.args)) {
    if (!TOOL_FIELDS[body.name].includes(key)) throw inputError('工具参数包含不支持的字段');
    args[key]=body.args[key];
  }
  if (body.name==='read_web_page') {
    let url; try { url=new URL(String(args.url||'')); } catch (_) { throw inputError('请输入完整的 HTTPS 网页地址'); }
    if (url.protocol!=='https:' || url.username || url.password || url.href.length>2000) throw inputError('只支持不含账号密码的 HTTPS 公网地址');
    args.url=url.href; // The real executor still performs DNS pin and SSRF checks.
  }
  if (body.name==='calculate' && (typeof args.expression!=='string' || args.expression.length>200)) throw inputError('计算表达式最多 200 个字符');
  if (args.rows && (!Array.isArray(args.rows) || args.rows.length>5000)) throw inputError('表格最多支持 5000 行');
  if (args.headers && (!Array.isArray(args.headers) || args.headers.length>60)) throw inputError('表格最多支持 60 列');
  if (body.name==='make_chart' && (!Array.isArray(args.series) || args.series.length>6 || args.series.some(s=>!s || !Array.isArray(s.data) || s.data.length>200))) throw inputError('图表最多 6 个系列、每个系列 200 个点');
  return {name:body.name,args};
}
function decodeUpload(body, maxBytes) {
  if (!body || typeof body.dataUrl!=='string') throw inputError('请选择文件');
  const match=/^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(body.dataUrl);
  if (!match || !match[2].length || match[2].length%4 || match[2].length>Math.ceil(maxBytes/3)*4) throw inputError('文件格式或大小无效');
  const buffer=Buffer.from(match[2],'base64');
  if (!buffer.length || buffer.length>maxBytes || buffer.toString('base64')!==match[2]) throw inputError('文件超过大小上限或编码无效');
  const name=String(body.name||'文件').replace(/[\x00-\x1f\\/]/g,'').slice(0,160)||'文件';
  return {buffer,mime:match[1].toLowerCase(),name};
}
function validateAsset(value) {
  if (!value || !KINDS.has(value.kind)) throw inputError('成果类型无效');
  if (value.id && !UUID.test(String(value.id))) throw inputError('成果标识无效');
  if (value.updated_at && (typeof value.updated_at!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.updated_at) || !Number.isFinite(Date.parse(value.updated_at)))) throw inputError('成果修改时间无效');
  const title=String(value.title||'').trim();
  if (!title || title.length>120) throw inputError('成果标题需要 1–120 个字符');
  if (!value.data || typeof value.data!=='object' || Array.isArray(value.data)) throw inputError('成果内容无效');
  jsonSize(value.data,1024*1024,'成果内容');
  // Raw originals remain in the user's files; durable assets contain editable
  // text/rows only. This also prevents accidentally persisting a model secret.
  if (/(?:"(?:api_key|access_token|authorization|dataUrl|data_url|image|audio)"\s*:)/i.test(JSON.stringify(value.data))) throw inputError('成果只能保存文本、表格和引用，请移除原文件或凭据');
  return {id:value.id||undefined,updated_at:value.updated_at||undefined,kind:value.kind,title,data:value.data};
}
function registerWorkbenchRoutes(app,deps) {
  if (!app || !deps || typeof deps.authenticateUser!=='function' || typeof deps.rateLimit!=='function' || typeof deps.executeToolCall!=='function') throw Error('workbench dependencies missing');
  const prefix='/api/agent/workbench';
  const guard=[deps.authenticateUser,deps.rateLimit(60000,20)];
  const json=deps.jsonMiddleware ? [deps.jsonMiddleware] : [];
  function handle(fn) { return async function(req,res) {
    const abort=new AbortController(); let timer;
    const onAbort=()=>abort.abort();
    req.once('aborted',onAbort); res.once('close',onAbort);
    try {
      const owner={userName:String(req.userName||''),accountId:String(req.accountId||'')};
      if (!owner.userName || !owner.accountId) return res.status(401).json({ok:false,error:'登录身份不可用，请重新登录',code:'workbench_identity_required'});
      timer=setTimeout(function(){onAbort();if(!res.headersSent && !res.destroyed)res.status(504).json({ok:false,code:'workbench_timeout',error:'工具执行超时，可以重试这一步'});},45000);
      const value=await fn(req,abort.signal,owner);
      if (!abort.signal.aborted && !res.headersSent) res.json({ok:true,...value});
    } catch(error) {
      if (!abort.signal.aborted && !res.headersSent) {
        const status=error.status===400 ? 400 : error.code==='asset_not_found' ? 404 : ['asset_conflict','asset_limit'].includes(error.code) ? 409 : 503;
        res.status(status).json({ok:false,code:error.code||'workbench_unavailable',error:status===400?error.message:status===404?'成果不存在或已删除':error.code==='asset_limit'?'账号最多保存 50 项、合计 10MiB，请删除不用的成果或缩小内容后再保存':status===409?'成果已在另一处更新，请重新打开保存记录后再编辑':'工具暂时不可用，请稍后重试'});
      }
    } finally { clearTimeout(timer);req.removeListener('aborted',onAbort);res.removeListener('close',onAbort); }
  }; }
  app.post(prefix+'/tool',...guard,handle(async(req,signal,owner)=> {
    const input=validateToolInput(req.body);
    const context=Object.assign({},typeof deps.requestContext==='function'?deps.requestContext(req):{},owner,{signal});
    const result=input.name==='generate_pdf' && typeof deps.exportDocument==='function'
      ? await deps.exportDocument(input.args,owner,signal)
      : await deps.executeToolCall({id:'workbench',type:'function',function:{name:input.name,arguments:JSON.stringify(input.args)}},context);
    return {result};
  }));
  app.post(prefix+'/parse',...guard,...json,handle(async(req,signal)=> {
    const upload=decodeUpload(req.body,8*1024*1024);
    const extension=upload.name.split('.').pop().toLowerCase();
    const kind=['pdf','docx'].includes(extension)?extension:['xlsx','xls'].includes(extension)?'xlsx':null;
    if (!kind && !['txt','md','csv','tsv'].includes(extension)) throw inputError('支持 PDF、DOCX、XLSX、XLS、CSV、TSV、TXT 和 Markdown');
    if (kind!=='pdf' && upload.buffer.length>6*1024*1024 || !kind && upload.buffer.length>2*1024*1024) throw inputError('Office 文件最多 6MiB，文本文件最多 2MiB');
    if (signal.aborted) throw Error('cancelled');
    const parsed=kind?await deps.parseDocumentBuffer(upload.buffer,kind):{text:upload.buffer.toString('utf8')};
    return {document:{name:upload.name,kind:kind||extension,text:String(parsed.text||'').slice(0,200000),pages:Number(parsed.numpages)||0,previewLimit:kind==='xlsx'?{sheets:20,rows:200,columns:60}:null}};
  }));
  app.post(prefix+'/ocr',...guard,...json,handle(async(req,signal)=> {
    const upload=decodeUpload(req.body,6*1024*1024);
    if (!['image/png','image/jpeg','image/webp'].includes(upload.mime)) throw inputError('识别副本支持 PNG、JPEG 和 WebP');
    const result=await deps.ocrImageBuffer(upload.buffer,upload.mime,upload.name,{sharp:deps.sharp,signal});
    return {result:{text:String(result.text||'').slice(0,200000),provider:result.provider||'none',error:result.error?String(result.error).slice(0,200):undefined}};
  }));
  if (deps.assets) {
    app.get(prefix+'/assets',...guard,handle(async(req,signal,owner)=>({records:await deps.assets.list(owner)})));
    app.get(prefix+'/assets/:id',...guard,handle(async(req,signal,owner)=> {
      if (!UUID.test(String(req.params.id||''))) throw inputError('成果标识无效');
      const record=await deps.assets.get(owner,req.params.id);
      if (!record) throw Object.assign(new Error('not found'),{code:'asset_not_found'});
      return {record};
    }));
    app.post(prefix+'/assets',...guard,handle(async(req,signal,owner)=>({record:await deps.assets.save(owner,validateAsset(req.body))})));
    app.delete(prefix+'/assets/:id',...guard,handle(async(req,signal,owner)=> {
      if (!UUID.test(String(req.params.id||''))) throw inputError('成果标识无效');
      return {removed:await deps.assets.remove(owner,req.params.id)};
    }));
  }
}
module.exports={registerWorkbenchRoutes,validateToolInput,validateAsset,decodeUpload,TOOL_FIELDS};
