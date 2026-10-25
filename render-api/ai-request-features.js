'use strict';
const {AsyncLocalStorage} = require('node:async_hooks');
const {createHash, randomBytes} = require('node:crypto');
const requests = new AsyncLocalStorage();
const CID = /^[A-Za-z0-9-]{6,100}$/;
const REF = /^[A-Za-z0-9_-]{43}$/;
const DEFAULT_TASK_BUDGET = Object.freeze({max_searches:30,max_duration_seconds:600});
function failure(code, message, status=400) { return Object.assign(Error(message), {code,status}); }
function current() { return requests.getStore(); }
function ownerOf(req) { if(!req.userName || !req.accountId)throw failure('auth_required','请先登录',401);return String(req.accountId); }
function createAttachmentStore(options={}) {
  const rows=new Map(),now=options.now||Date.now,maxBytes=options.maxBytes||64*1024*1024,ownerBytes=options.ownerBytes||54*1024*1024,ttl=options.ttl||20*60*1000;
  let bytes=0;
  function remove(key){const row=rows.get(key);if(row){bytes-=row.bytes;rows.delete(key);}}
  function prune(){for(const [key,row] of rows)if(row.expires<=now())remove(key);}
  function add(owner,cid,attachment){
    if(!owner||!CID.test(cid))throw failure('attachment_scope_invalid','附件需要有效的账号和会话');
    const {decodeUpload}=require('./ai-workbench');
    const decoded=decodeUpload({name:attachment.name,dataUrl:attachment.data_url||attachment.dataUrl},50*1024*1024);
    const digest=createHash('sha256').update(decoded.buffer).digest('hex');prune();
    for(const row of rows.values())if(row.owner===owner&&row.cid===cid&&row.digest===digest&&row.name===decoded.name){row.used=now();return publicRow(row);}
    let own=0;for(const row of rows.values())if(row.owner===owner)own+=row.bytes;
    if(decoded.buffer.length>ownerBytes||decoded.buffer.length>maxBytes)throw failure('attachment_cache_full','附件超过复用缓存容量，请拆分文件',413);
    const sorted=Array.from(rows.values()).sort((a,b)=>a.used-b.used);
    // Apply the owner and global budgets independently; the global pass must
    // revisit older foreign rows skipped while satisfying the owner budget.
    for(const row of sorted){if(own+decoded.buffer.length<=ownerBytes)break;if(row.owner===owner){remove(row.ref);own-=row.bytes;}}
    for(const row of sorted){if(bytes+decoded.buffer.length<=maxBytes&&rows.size<128)break;remove(row.ref);}
    if(own+decoded.buffer.length>ownerBytes||bytes+decoded.buffer.length>maxBytes||rows.size>=128)throw failure('attachment_cache_full','附件复用缓存已满，请重试',413);
    const row={ref:randomBytes(32).toString('base64url'),owner,cid,digest,name:decoded.name,mime:decoded.mime,buffer:decoded.buffer,bytes:decoded.buffer.length,used:now(),expires:now()+ttl,parsed:null};
    rows.set(row.ref,row);bytes+=row.bytes;return publicRow(row);
  }
  function publicRow(row){return {attachment_ref:row.ref,name:row.name,type:row.mime,bytes:row.bytes,expires_at:row.expires};}
  function get(owner,cid,ref){
    prune();const row=rows.get(ref);
    if(!REF.test(String(ref||''))||!row||row.owner!==owner||row.cid!==cid)throw failure('attachment_ref_expired','附件复用已失效，请重新提交原文件',410);
    row.used=now();return row;
  }
  function clear(owner){for(const [key,row] of rows)if(row.owner===owner)remove(key);}
  return {add,get,clear,stats(){prune();return {entries:rows.size,bytes};}};
}
const store=createAttachmentStore();
function dataUrl(row){return 'data:'+row.mime+';base64,'+row.buffer.toString('base64');}
function parseBudget(body){
  const mode=body.network_mode==null?(body.web_search===true?'required':'auto'):body.network_mode;
  if(!['auto','required','off'].includes(mode))throw failure('invalid_network_mode','请选择有效的联网方式');
  const input=body.task_budget||{};
  if(typeof input!=='object'||Array.isArray(input))throw failure('invalid_task_budget','任务限额格式无效');
  function limit(key,min,max){if(input[key]==null)return null;const n=input[key];if(!Number.isInteger(n)||n<min||n>max)throw failure('invalid_task_budget','任务限额超出允许范围');return n;}
  const maxSearches=limit('max_searches',0,30),maxSeconds=limit('max_duration_seconds',30,600);
  if(mode==='required'&&maxSearches===0)throw failure('invalid_task_budget','必须检索时，请允许至少一次检索');
  return {mode,maxSearches,maxSeconds,searches:0};
}
function instructions(){const scope=current();if(!scope)return '';return '【本轮任务设置，优先遵守】'+(scope.policy.mode==='off'?'仅使用当前对话和已提供文件，禁止外部网页、实时信息或其他站内记录读取；不能声称已联网。':scope.policy.mode==='required'?'本次要求实际执行检索，若额度或服务限制导致无法检索，须明确说明，不能声称已查证。':'按需要决定是否检索。')+(scope.policy.maxSearches!==null?' 本轮最多 '+scope.policy.maxSearches+' 个检索动作，达到上限保留已有结果，不重复尝试绕过。':'')+(scope.policy.maxSeconds?' 最长 '+scope.policy.maxSeconds+' 秒，遇限制如实说明。':'');}
function assertNetwork(){const scope=current();if(scope?.policy.mode==='off')throw failure('network_disabled','本次仅使用当前对话和已提供资料，未进行联网读取');if(scope?.controller.signal.aborted)throw failure('task_budget_exceeded','本次任务已达到时间限额');}
function search(task){
  const scope=current();assertNetwork();
  if(scope&&!scope.searchDepth){if(scope.policy.maxSearches!==null&&scope.policy.searches>=scope.policy.maxSearches)throw failure('task_search_budget_exceeded','本次检索次数已达到设置的上限，已保留现有结果');scope.policy.searches++;}
  return scope?requests.run({...scope,searchDepth:(scope.searchDepth||0)+1},task):task();
}
const NETWORK_TOOLS=new Set(['search_web','tavily_search','search_social','get_weather','get_exchange_rate','get_stock_quote','read_web_page','read_document','web_extract','read_zip','image_info','image_process','page_meta','extract_links','search_posts','search_comments','search_photos','search_dm_messages','search_ai_history','search_users','search_everything']);
function guardTool(name){if(NETWORK_TOOLS.has(name))assertNetwork();}
function makeMiddleware(deps={}){
  const cache=deps.store||store;
  return async function(req,res,next){
    let scope,timer;
    try{
      const body=req.body||{},owner=req.guestAi?('guest:'+String(req.ip||'')):ownerOf(req);
      const config=deps.getAiConfig?await deps.getAiConfig():{};
      // Only administrator settings control limits. Ignore retired client values,
      // including old local-storage preferences and hand-crafted request bodies.
      const policy=parseBudget({...body,task_budget:{...DEFAULT_TASK_BUDGET,...config?.task_budget}}),cid=String(body.conversation_id||'');
      delete body.task_budget;
      scope={owner,cid,policy,officialOnly:config?.search?.official_only===true,documents:[],controller:new AbortController(),cache};
      const refs=new Map(),urls=new Map();let attachmentBytes=0,attachmentCount=0;
      function inspect(attachment){
        if(!attachment||typeof attachment!=='object')return;
        if(attachment.attachment_ref){const row=cache.get(owner,cid,attachment.attachment_ref);refs.set(row.ref,row);attachmentBytes+=row.bytes;attachmentCount++;}
        else {const url=attachment.data_url||attachment.dataUrl;if(typeof url==='string'&&url.startsWith('data:')){const comma=url.indexOf(','),encoded=url.slice(comma+1);attachmentBytes+=Math.max(0,Math.floor(encoded.length*3/4)-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0));attachmentCount++;}}
        if(attachmentCount>10||attachmentBytes>54*1024*1024)throw failure('attachment_request_too_large','每次最多提供 10 份附件，合计最多 54MiB',413);
      }
      function inspectMessage(message){if(!message||typeof message!=='object')return;if(Array.isArray(message.attachments))message.attachments.forEach(inspect);if(Array.isArray(message.vision_urls))message.vision_urls.forEach(url=>{if(typeof url==='string'&&url.startsWith('xtj-attachment:'))inspect({attachment_ref:url.slice(15)});else if(typeof url==='string'&&url.startsWith('data:'))inspect({data_url:url});});}
      inspectMessage(body);for(const name of ['messages','history'])if(Array.isArray(body[name]))body[name].forEach(inspectMessage);
      function bytesFor(row){if(!urls.has(row.ref))urls.set(row.ref,dataUrl(row));return urls.get(row.ref);}
      function restore(attachment){
        if(!attachment||typeof attachment!=='object'||!attachment.attachment_ref)return attachment;
        if(!CID.test(cid))throw failure('attachment_scope_invalid','附件的会话已失效，请重新提交');
        const row=cache.get(owner,cid,attachment.attachment_ref);refs.set(row.ref,row);
        const restored={...attachment,name:row.name,type:row.mime,data_url:bytesFor(row)};delete restored.dataUrl;return restored;
      }
      if(Array.isArray(body.attachments))body.attachments=body.attachments.map(restore);
      if(Array.isArray(body.vision_urls))body.vision_urls=body.vision_urls.map(url=>{if(typeof url!=='string'||!url.startsWith('xtj-attachment:'))return url;const row=cache.get(owner,cid,url.slice(15));refs.set(row.ref,row);return bytesFor(row);});
      for(const name of ['messages','history'])if(Array.isArray(body[name]))body[name]=body[name].map(message=>{
        if(!message||typeof message!=='object')return message;
        const copy={...message};if(Array.isArray(copy.attachments))copy.attachments=copy.attachments.map(restore);
        if(Array.isArray(copy.vision_urls))copy.vision_urls=copy.vision_urls.map(url=>{if(typeof url!=='string'||!url.startsWith('xtj-attachment:'))return url;const row=cache.get(owner,cid,url.slice(15));refs.set(row.ref,row);return bytesFor(row);});return copy;
      });
      scope.documents=Array.from(refs.values()).slice(0,10);
      if(body.network_mode==='off')body.web_search=false;
      if(body.network_mode==='required')body.web_search=true;
      req.aiRequestScope=scope;
      function cleanup(){if(timer)clearTimeout(timer);res.removeListener('finish',cleanup);res.removeListener('close',cleanup);scope.controller.abort();}
      res.once('finish',cleanup);res.once('close',cleanup);
      if(policy.maxSeconds)timer=setTimeout(()=>{
        if(res.writableEnded||res.destroyed)return;
        scope.controller.abort();req.aiBudgetExceeded=true;
        const error={type:'error',code:'task_budget_exceeded',error:'本次任务达到网站设置的时间限额，已保留已收到的内容；可以继续提问。'};
        if(res.headersSent){if(String(res.getHeader('Content-Type')||'').includes('text/event-stream'))deps.writeSse(res,error);}
        else res.status(408).json({ok:false,...error});
        // The existing transports all release their upstream work on this event.
        // The terminal event above distinguishes a budget deadline from a user stop.
        req.emit('aborted');if(!res.writableEnded)require('./sse-write').endSse(res);
      },policy.maxSeconds*1000);
      requests.run(scope,next);
    }catch(error){if(timer)clearTimeout(timer);res.status(error.status||400).json({ok:false,code:error.code||'attachment_invalid',error:error.message});}
  };
}
function install(app,deps){
  const json=deps.jsonMiddleware;
  app.post('/api/agent/attachments',deps.authenticateUser,deps.rateLimit(60000,30),json,(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try{res.json({ok:true,...store.add(ownerOf(req),String(req.body.conversation_id||''),req.body.attachment||{})});}
    catch(error){res.status(error.status||400).json({ok:false,code:error.code||'attachment_invalid',error:error.message});}
  });
  app.delete('/api/agent/attachments',deps.authenticateUser,(req,res)=>{store.clear(ownerOf(req));res.json({ok:true});});
  return makeMiddleware({...deps,store});
}
async function parseCached(buffer,kind,parse){
  const scope=current(),digest=scope?createHash('sha256').update(buffer).digest('hex'):'';
  const row=scope?.documents.find(item=>item.digest===digest);
  if(!row)return parse(buffer,kind);
  if(!(row.parsed instanceof Map))row.parsed=new Map();
  if(!row.parsed.has(kind))row.parsed.set(kind,Promise.resolve().then(()=>parse(buffer,kind)).then(value=>({...value,text:String(value.text||'').slice(0,200000)})).catch(error=>{row.parsed.delete(kind);throw error;}));
  return {...await row.parsed.get(kind)};
}
const DOCUMENT_TOOLS=[
  {type:'function',function:{name:'search_document',description:'在本次对话已提供的文件中查找相关原文。返回真实段落编号与摘录，段落编号不是 PDF 页码。',parameters:{type:'object',properties:{attachment_ref:{type:'string',description:'当前附件目录中的引用，可选；不填搜索全部已提供文件'},query:{type:'string',description:'需要查找的词句'},limit:{type:'integer',description:'最多返回 1–12 个片段'}},required:['query']}}},
  {type:'function',function:{name:'read_document_section',description:'读取已提供文件的指定连续段落。仅返回实际提取内容，明确文件提取上限，不能声称已读完整文件。',parameters:{type:'object',properties:{attachment_ref:{type:'string'},start_paragraph:{type:'integer',description:'从 1 开始的真实提取段落编号'},offset:{type:'integer',description:'长段落的字符偏移，默认 0，可沿返回的 next_offset 继续'},count:{type:'integer',description:'读取段数，1–20'}},required:['attachment_ref','start_paragraph']}}}
];
function tools(list){
  const scope=current(),catalog=scope?.documents.map((row,index)=>`F${index+1}: ${JSON.stringify(row.name)} · attachment_ref=${row.ref}`).join('\n')||'本次没有可检索的附件引用；请用户先提供文件。';
  return list.map(tool=>DOCUMENT_TOOLS.some(item=>item.function.name===tool.function?.name)?{...tool,function:{...tool.function,description:tool.function.description+'\n当前附件目录：\n'+catalog}}:tool);
}
async function paragraphs(row,parse){
  let text;
  const kind=row.name.split('.').pop().toLowerCase();
  if(['pdf','docx','xlsx','xls'].includes(kind))text=(await parseCached(row.buffer,kind==='xls'?'xlsx':kind,parse)).text;
  else if(['txt','md','csv','tsv','json','log','html','xml'].includes(kind)||row.mime.startsWith('text/')){if(row.bytes>2*1024*1024)throw failure('document_too_large','文本检索文件最多 2MiB');text=row.buffer.toString('utf8').slice(0,200000);}
  else throw failure('document_not_text','该附件未提供可检索文字；图片请使用现有图片分析流程');
  const result=String(text||'').replace(/\r\n?/g,'\n').split(/\n\s*\n|\n/).map(item=>item.trim()).filter(Boolean).slice(0,10000);
  if(!result.length)throw failure('document_empty','没有提取到可检索文字');return result;
}
async function executeDocument(name,args,parse){
  const scope=current();if(!scope||!scope.documents.length)return {tool_name:name,error:'本次没有可检索的文件，请先上传文件'};
  try{
    if(scope.controller.signal.aborted)throw failure('task_budget_exceeded','本次任务已停止');
    const chosen=args.attachment_ref?scope.documents.filter(row=>row.ref===args.attachment_ref):scope.documents;
    if(!chosen.length)throw failure('document_not_provided','该文件不在当前对话提供的附件中');
    const hits=[];
    if(name==='read_document_section'&&(!args.attachment_ref||!Number.isInteger(args.start_paragraph)||args.start_paragraph<1||args.offset!=null&&(!Number.isInteger(args.offset)||args.offset<0)))throw failure('paragraph_invalid','请提供文件引用、从 1 开始的段落和有效字符偏移');
    const query=String(args.query||'').trim().slice(0,200),limit=Number.isInteger(args.limit)?Math.min(12,Math.max(1,args.limit)):8;
    if(name==='search_document'&&!query)throw failure('document_query_empty','请提供需要查找的词句');
    let chars=0;
    for(const row of chosen){
      const parts=await paragraphs(row,parse),file='F'+(scope.documents.indexOf(row)+1),count=Number.isInteger(args.count)?Math.min(20,Math.max(1,args.count)):5;
      if(scope.controller.signal.aborted)throw failure('task_budget_exceeded','本次任务已停止');
      let read=0;
      for(let i=0;i<parts.length;i++){
        const selected=name==='read_document_section'?i>=args.start_paragraph-1&&read<count:parts[i].toLocaleLowerCase().includes(query.toLocaleLowerCase());
        if(!selected)continue;
        const offset=name==='read_document_section'&&i===args.start_paragraph-1?args.offset||0:Math.max(0,parts[i].toLocaleLowerCase().indexOf(query.toLocaleLowerCase())-200);
        if(offset>=parts[i].length)throw failure('paragraph_offset_invalid','字符偏移超出该段实际长度');
        const text=parts[i].slice(offset,offset+Math.min(2000,16000-chars));if(!text)break;chars+=text.length;
        hits.push({file:row.name,attachment_ref:row.ref,citation:`${file}:P${i+1}`,paragraph:i+1,text,offset,next_offset:offset+text.length<parts[i].length?offset+text.length:null,total_extracted_paragraphs:parts.length});read++;
        if(chars>=16000)break;
        if(hits.length>=limit&&name==='search_document'||read>=count&&name==='read_document_section')break;
      }
      if(chars>=16000||hits.length>=limit&&name==='search_document')break;
    }
    return {tool_name:name,results_count:hits.length,hits,content:JSON.stringify({hits,returned_chars:chars,coverage:'仅检索当前已提取文字（每文件最多 200000 字符）；P 是提取段落编号，不是 PDF 页码。Excel 仍受原有工作表与行列提取上限约束。未找到不代表未提取部分不存在。'})};
  }catch(error){return {tool_name:name,error:error.message,code:error.code||'document_read_failed'};}
}
module.exports={current,createAttachmentStore,store,install,makeMiddleware,parseCached,DOCUMENT_TOOLS,tools,executeDocument,guardTool,assertNetwork,search,parseBudget,instructions,DEFAULT_TASK_BUDGET};
