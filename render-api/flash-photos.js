'use strict';
const crypto=require('node:crypto'),multer=require('multer');
const {readAuthRecord}=require('./auth-record');
const {scanStorageOrphans}=require('./storage-orphan-scan');
const BUCKET='dm-flash',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function seal(bytes){const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);return{bytes:Buffer.concat([cipher.update(bytes),cipher.final()]),key,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64')};}
function unseal(bytes,key,iv,tag){const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));decipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([decipher.update(bytes),decipher.final()]);}
function createFlashPhotos({express,supabase,sharp,authenticateUser,verifyToken,rateLimit,canSend,banError,publish,notifyConsumed,audit,setPro}){
 const router=express.Router(),store=()=>supabase.storage.from(BUCKET);let timer,busy=false,inFlightUploads=0,orphanOffset=0;
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1,fields:2,fieldSize:200}}).single('image');
 async function checked(query){const r=await query;if(!r||r.error)throw Error('flash_store_unavailable');return r.data;}
 const limited=rateLimit?rateLimit(60000,30):(req,res,next)=>next();
 router.use((req,res,next)=>{res.set('Cache-Control','no-store, private, max-age=0');res.set('Pragma','no-cache');next();});
 function unavailable(res){return res.status(503).json({ok:false,error:'闪图暂时不可用，请稍后重试'});}
 async function remove(path,id){if(!UUID.test(path.replace(/\.bin$/,''))||!path.endsWith('.bin'))throw Error('invalid_flash_path');await checked(store().remove([path]));if(id)await checked(supabase.from('dm_flash_photos').update({cleaned_at:new Date().toISOString()}).eq('id',id));}
 router.get('/api/chat/flash/quota',authenticateUser,limited,async(req,res)=>{try{const q=await checked(supabase.rpc('dm_flash_quota',{p_actor:req.userName}));res.status(q.ok?200:401).json(q);}catch(_){unavailable(res);}});
 router.post('/api/chat/flash/send',authenticateUser,limited,(req,res,next)=>{const error=banError&&banError(req);if(error)return res.status(error.status||403).json({ok:false,error:error.message});if(inFlightUploads>=2)return res.status(429).json({ok:false,error:'上传繁忙，请稍后重试'});inFlightUploads++;let released=false;const release=()=>{if(!released){released=true;inFlightUploads--;}};req._flashRelease=release;const releaseIdle=()=>{if(!req._flashProcessing)release();};res.once('finish',releaseIdle);res.once('close',releaseIdle);upload(req,res,error=>{if(error)return res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({ok:false,error:'请选择一张不超过 20MB 的照片'});next();});},async(req,res)=>{
  req._flashProcessing=true;let encrypted,path;
  try{
   const actor=req.userName,peer=String(req.body&&req.body.target_user||'').trim(),client=String(req.body&&req.body.client_id||'');
   if(!peer||peer.length>64||peer===actor||!/^[a-zA-Z0-9_-]{8,100}$/.test(client)||!req.file)return res.status(400).json({ok:false,error:'闪图发送参数无效'});
   const permission=await canSend(actor,peer);if(!permission.ok)return res.status(403).json({ok:false,error:'当前无法向此用户发送消息'});
   const auth=await readAuthRecord(supabase,actor,'__auth__','id');if(!auth)return res.status(401).json({ok:false});
   const previous=await checked(supabase.from('dm_flash_photos').select('message_id,recipient_name').eq('sender_account',auth.id).eq('client_id',client).maybeSingle());
   if(previous){if(previous.recipient_name!==peer||!previous.message_id)return res.status(409).json({ok:false,error:'发送标识已失效'});const message=await checked(supabase.from('posts').select('id,user_name,content,media_url,created_at').eq('id',previous.message_id).maybeSingle());return res.json({ok:true,message,idempotent:true});}
   const quota=await checked(supabase.rpc('dm_flash_quota',{p_actor:actor}));if(!quota.ok)throw Error('quota_unavailable');if(quota.remaining===0)return res.status(429).json({ok:false,code:'flash_quota_exceeded',error:'今日闪图次数已用完',quota});
   let meta;try{meta=await sharp(req.file.buffer,{limitInputPixels:80000000}).metadata();}catch(_){return res.status(415).json({ok:false,error:'无法读取图片，请选择静态 JPEG、PNG 或 WebP'});}
   if(!['jpeg','png','webp'].includes(meta.format)||(meta.pages||1)>1)return res.status(415).json({ok:false,error:'闪图仅支持静态 JPEG、PNG 或 WebP'});
   encrypted=seal(req.file.buffer);const id=crypto.randomUUID();path=id+'.bin';
   await checked(store().upload(path,encrypted.bytes,{contentType:'application/octet-stream',upsert:false,cacheControl:'0'}));
   let result;
   try{result=await checked(supabase.rpc('dm_flash_send',{p_actor:actor,p_peer:peer,p_client:client,p_id:id,p_path:path,p_key:encrypted.key.toString('base64'),p_iv:encrypted.iv,p_tag:encrypted.tag,p_mime:'image/'+meta.format}));}
   catch(error){
    // A lost RPC response can follow a committed transaction. Preserve its ciphertext.
    const known=await checked(supabase.from('dm_flash_photos').select('message_id').eq('id',id).maybeSingle());
    if(!known){await remove(path);path=null;}throw error;
   }
   if(!result.ok){await remove(path);path=null;return res.status(result.code==='flash_quota_exceeded'?429:409).json({...result,error:result.code==='flash_quota_exceeded'?'今日闪图次数已用完':'闪图未发送，请重试'});}
   if(result.idempotent){await remove(path);path=null;}
   if(publish)publish(peer,result.message);res.json(result);
  }catch(_){unavailable(res);}
  finally{if(req._flashRelease)req._flashRelease();if(req.file&&req.file.buffer)req.file.buffer.fill(0);if(encrypted){encrypted.key.fill(0);encrypted.bytes.fill(0);}/* Unknown commit ciphertext stays private; sweep removes expired/orphaned objects. */}
 });
 router.post('/api/chat/flash/open',authenticateUser,limited,async(req,res)=>{
  const message=String(req.body&&req.body.message_id||''),view=String(req.body&&req.body.view_id||'');if(!UUID.test(message)||!UUID.test(view))return res.status(400).json({ok:false});
  let claim,key,bytes;
  try{
   claim=await checked(supabase.rpc('dm_flash_prepare',{p_actor:req.userName,p_message:message,p_view:view}));
   if(!claim.ok)return res.status(claim.code==='flash_expired'?410:claim.code==='flash_busy'?409:404).json({ok:false,code:claim.code,error:claim.code==='flash_expired'?'闪图已失效':claim.code==='flash_busy'?'闪图正在另一页面打开，请稍后重试':'闪图不可查看'});
   key=Buffer.from(claim.key,'base64');delete claim.key;
   const blob=await checked(store().download(claim.path));bytes=unseal(Buffer.from(await blob.arrayBuffer()),key,claim.iv,claim.tag);
   // Retain the sender's encrypted original. Only the recipient receipt consumes access.
   res.set('Content-Type',claim.mime);res.set('X-Flash-Role',claim.role);res.set('X-Flash-Duration',claim.role==='sender'?'0':'3000');res.set('X-Content-Type-Options','nosniff');const erase=()=>bytes.fill(0);res.once('finish',erase);res.once('close',erase);res.send(bytes);
  }catch(_){if(claim&&claim.role==='recipient')await checked(supabase.rpc('dm_flash_release',{p_actor:req.userName,p_message:message,p_view:view})).catch(()=>{});unavailable(res);}
  finally{if(key)key.fill(0);if(bytes&&(res.writableFinished||res.destroyed))bytes.fill(0);}
 });
 router.post('/api/chat/flash/viewed',authenticateUser,limited,async(req,res)=>{
  const message=String(req.body&&req.body.message_id||''),view=String(req.body&&req.body.view_id||'');if(!UUID.test(message)||!UUID.test(view))return res.status(400).json({ok:false});
  try{const result=await checked(supabase.rpc('dm_flash_viewed',{p_actor:req.userName,p_message:message,p_view:view}));
   if(!result.ok)return res.status(result.code==='flash_expired'?410:409).json({ok:false,error:'闪图未打开，请重试'});
   if(notifyConsumed&&!result.idempotent)void checked(supabase.from('posts').select('user_name,media_url').eq('id',message).maybeSingle()).then(row=>{if(row)notifyConsumed(row.user_name,row.media_url);}).catch(()=>console.warn('[flash] state notification will refresh on polling'));
   res.json(result);
  }catch(_){unavailable(res);}
 });
 router.post('/api/chat/flash/release',authenticateUser,limited,async(req,res)=>{
  const message=String(req.body&&req.body.message_id||''),view=String(req.body&&req.body.view_id||'');if(!UUID.test(message)||!UUID.test(view))return res.status(400).json({ok:false});
  try{await checked(supabase.rpc('dm_flash_release',{p_actor:req.userName,p_message:message,p_view:view}));res.json({ok:true});}catch(_){unavailable(res);}
 });
 router.get('/admin/flash-photos',verifyToken,async(req,res)=>{try{const settings=await checked(supabase.from('dm_flash_settings').select('free_daily,pro_daily').eq('id',true).single());const actor=String(req.query.user_name||'').trim();if(actor.length>64)return res.status(400).json({ok:false});const quota=actor?await checked(supabase.rpc('dm_flash_quota',{p_actor:actor})):null;res.json({ok:true,settings,quota});}catch(_){unavailable(res);}});
 router.post('/admin/flash-photos',verifyToken,limited,async(req,res)=>{try{
  req.body=req.body||{};const actor=String(req.body.user_name||'').trim();
  if(actor){const auth=await readAuthRecord(supabase,actor,'__auth__','id');if(!auth)return res.status(404).json({ok:false,error:'账号不存在'});const limit=req.body.daily_limit;if(limit!==null&&(!Number.isInteger(limit)||limit< -1||limit>10000))return res.status(400).json({ok:false,error:'额度无效'});
   if(req.body.pro!==undefined){if(typeof req.body.pro!=='boolean')return res.status(400).json({ok:false});const pro=await setPro(actor,req.body.pro);if(!pro.ok)throw Error('membership_save_failed');}
   await checked(supabase.from('dm_flash_limits').upsert({account_id:auth.id,user_name:actor,daily_limit:limit},{onConflict:'account_id'}));
  }else{const {free_daily,pro_daily}=req.body;if(![free_daily,pro_daily].every(n=>Number.isInteger(n)&&n>=0&&n<=10000))return res.status(400).json({ok:false,error:'额度必须为 0–10000 的整数'});if(req.body.apply_all!==undefined&&typeof req.body.apply_all!=='boolean')return res.status(400).json({ok:false});await checked(supabase.rpc('dm_flash_configure',{p_free:free_daily,p_pro:pro_daily,p_override_all:!!req.body.apply_all}));}
  if(audit)await audit('configure_flash_limits',req.adminName||'xxz','target='+ (actor||'defaults'));res.json({ok:true});
 }catch(_){unavailable(res);}});
 async function sweep(){if(busy)return;busy=true;try{
  const now=new Date().toISOString();const rows=await checked(supabase.from('dm_flash_photos').select('id,storage_path,message_id,consumed_at').is('cleaned_at',null).or('key_material.is.null,message_id.is.null').limit(50));
  for(const row of rows||[]){try{await checked(supabase.from('dm_flash_photos').update({key_material:null,consumed_at:row.consumed_at||now}).eq('id',row.id));if(row.message_id){const post=await checked(supabase.from('posts').select('content').eq('id',row.message_id).maybeSingle());if(post){let body=JSON.parse(post.content);if(body.flash){body.flash.state='expired';await checked(supabase.from('posts').update({content:JSON.stringify(body)}).eq('id',row.message_id));}}}await remove(row.storage_path,row.id);}catch(_){console.warn('[flash] object cleanup will retry');}}
  // Failed sends and account deletions can leave ciphertext with no ledger row.
  orphanOffset=await scanStorageOrphans({store:store(),offset:orphanOffset,lookup:path=>checked(supabase.from('dm_flash_photos').select('id').eq('storage_path',path).maybeSingle()),remove:path=>remove(path),onError:()=>console.warn('[flash] orphan cleanup will retry')});
 }catch(_){console.warn('[flash] cleanup will retry');}finally{busy=false;}}
 return{router,sweep,start(){void sweep();timer=setInterval(sweep,15000);timer.unref();},stop(){clearInterval(timer);}};
}
module.exports={createFlashPhotos,seal,unseal,BUCKET};
