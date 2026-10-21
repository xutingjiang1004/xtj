'use strict';
const CID=/^[A-Za-z0-9-]{6,128}$/, UUID=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const messages={history_metadata_conflict:'另一台设备已修改标题，请刷新后再保存',bookmark_limit:'最多收藏 200 条消息，请先整理已有收藏',history_metadata_limit:'已达到会话标题保存上限',conversation_missing:'会话或消息已删除，或不属于当前账号',account_changed:'账号状态已变化，请重新登录'};
function input(message){return Object.assign(Error(message),{status:400});}
function filters(query){
  const value={query:String(query.q||'').trim(),model:String(query.model||'').trim(),mode:String(query.mode||'')};
  if(value.query.length>120||value.model.length>128||!['','normal','deep_think'].includes(value.mode))throw input('历史筛选条件无效');
  for(const key of ['date_from','date_to'])if(query[key]){const date=String(query[key]);if(date.length>40||!Number.isFinite(Date.parse(date)))throw input('历史日期无效');value[key]=new Date(date).toISOString();}
  if(value.date_from&&value.date_to&&value.date_from>value.date_to)throw input('开始日期不能晚于结束日期');
  if(query.before){let cursor;try{cursor=JSON.parse(query.before);}catch(_){throw input('历史游标无效');}if(!cursor||!UUID.test(cursor.id||'')||typeof cursor.at!=='string'||cursor.at.length>40||!Number.isFinite(Date.parse(cursor.at)))throw input('历史游标无效');value.before_at=cursor.at;value.before_id=cursor.id;}
  return value;
}
function install(app,deps){
  const auth=deps.authenticateUser,rate=deps.rateLimit(60000,60);
  async function call(req,op,value){
    const result=await deps.db.rpc('ai_conversation_features',{p_user_name:req.userName,p_account_id:req.accountId,p_op:op,p_value:value});
    if(!result||result.error||!result.data)throw Object.assign(Error('历史服务暂时不可用，请重试'),{status:503});
    if(result.data.ok!==true){const code=result.data.code||'history_operation_failed';throw Object.assign(Error(messages[code]||'历史操作未完成，请刷新后重试'),{code,status:code==='history_metadata_conflict'?409:code==='account_changed'?401:code==='conversation_missing'?404:400});}
    return result.data;
  }
  function handle(fn){return async(req,res)=>{res.setHeader('Cache-Control','no-store');try{res.json(await fn(req));}catch(error){res.status(error.status||503).json({ok:false,code:error.code||'history_features_unavailable',error:error.status?error.message:'历史服务暂时不可用，请重试'});}};}
  app.post('/api/agent/chat/metadata/read',auth,rate,handle(req=>{
    const ids=req.body?.conversation_ids;if(!Array.isArray(ids)||ids.length>100||!ids.every(id=>typeof id==='string'&&CID.test(id)))throw input('会话列表无效');
    return call(req,'metadata',{conversation_ids:ids});
  }));
  app.post('/api/agent/chat/metadata',auth,rate,handle(req=>{
    const body=req.body||{};
    if(!CID.test(body.conversation_id||'')||typeof body.title!=='string'||body.title.length>80||!Number.isSafeInteger(body.revision)||body.revision<0)throw input('标题或会话信息无效');
    return call(req,'set_title',{conversation_id:body.conversation_id,title:body.title.trim(),revision:body.revision});
  }));
  app.get('/api/agent/chat/search',auth,rate,handle(req=>call(req,'search',{...filters(req.query),limit:30})));
  app.get('/api/agent/chat/message/:id',auth,rate,handle(async req=>{
    if(!UUID.test(req.params.id||''))throw input('消息标识无效');
    const result=await call(req,'message',{message_id:req.params.id,limit:1});
    if(!result.items.length)throw Object.assign(Error('消息已删除或不可访问'),{status:404});return result;
  }));
  app.get('/api/agent/chat/bookmarks',auth,rate,handle(req=>call(req,'bookmarks',{...filters(req.query),limit:30})));
  app.get('/api/agent/chat/bookmarks/export',auth,deps.rateLimit(60000,20),handle(req=>call(req,'bookmarks_export',{...filters(req.query),limit:30})));
  app.post('/api/agent/chat/bookmarks',auth,rate,handle(req=>{
    const body=req.body||{},id=body.message_id,requestId=body.client_request_id;
    if(!CID.test(body.conversation_id||'')||!UUID.test(id||'')&&!/^[A-Za-z0-9_-]{1,128}$/.test(requestId||''))throw input('请等待消息保存后再收藏');
    return call(req,'bookmark',{conversation_id:body.conversation_id,...(UUID.test(id||'')?{message_id:id}:{client_request_id:requestId})});
  }));
  app.delete('/api/agent/chat/bookmarks/:id',auth,rate,handle(req=>{
    const cid=req.body?.conversation_id;if(!CID.test(cid||'')||!UUID.test(req.params.id||''))throw input('收藏信息无效');
    return call(req,'remove_bookmark',{conversation_id:cid,message_id:req.params.id});
  }));
  app.get('/api/agent/chat/export',auth,deps.rateLimit(60000,20),handle(req=>{
    const cid=String(req.query.conversation_id||'');if(!CID.test(cid))throw input('请选择需要导出的会话');
    return call(req,'export',{...filters(req.query),conversation_id:cid,limit:30,query:'',model:'',mode:''});
  }));
  return {call};
}
module.exports={install,filters};
