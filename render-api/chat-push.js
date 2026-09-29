'use strict';
const crypto = require('node:crypto');
const webPush = require('web-push');
function validateSubscription(input) {
  if (!input || typeof input.endpoint !== 'string' || input.endpoint.length > 2000) return null;
  let endpoint; try { endpoint = new URL(input.endpoint); } catch (_) { return null; }
  const host = endpoint.hostname.toLowerCase();
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port ||
      !(['fcm.googleapis.com','web.push.apple.com','push.services.mozilla.com'].includes(host) || host.endsWith('.push.services.mozilla.com') || host.endsWith('.notify.windows.com'))) return null;
  const keys = input.keys || {};
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || !/^[\w-]+={0,2}$/.test(keys.p256dh) || !/^[\w-]+={0,2}$/.test(keys.auth)) return null;
  const publicKey = Buffer.from(keys.p256dh,'base64url'), auth = Buffer.from(keys.auth,'base64url');
  if (publicKey.length !== 65 || publicKey[0] !== 4 || auth.length !== 16) return null;
  try { crypto.ECDH.convertKey(publicKey,'prime256v1'); } catch (_) { return null; }
  return { endpoint: endpoint.href, keys: {p256dh: keys.p256dh, auth: keys.auth} };
}
function deriveVapid(secret) {
  const ecdh=crypto.createECDH('prime256v1');
  // Domain separation keeps notification signing distinct from session token signing.
  ecdh.setPrivateKey(Buffer.from(crypto.hkdfSync('sha256',secret,'xtj-web-push-v1','vapid-signing',32)));
  return {subject:'https://xtj.onrender.com',publicKey:ecdh.getPublicKey().toString('base64url'),privateKey:ecdh.getPrivateKey().toString('base64url')};
}
function createChatPush({express,supabase,authenticateUser,rateLimit,secret,transport=webPush}) {
  const router=express.Router(), vapid=deriveVapid(secret), table='chat_push_subscriptions';
  async function result(q){const r=await q;if(r.error)throw r.error;return r.data;}
  router.use(authenticateUser);
  if(rateLimit)router.use(rateLimit(60000,25));
  router.get('/config',(_req,res)=>res.json({ok:true,public_key:vapid.publicKey}));
  router.post('/subscribe',async(req,res)=>{
    const subscription=validateSubscription(req.body.subscription);
    if(!subscription)return res.status(400).json({ok:false,error:'通知订阅无效'});
    try {
      const endpointHash=crypto.createHash('sha256').update(subscription.endpoint).digest('hex');
      const rows=await result(supabase.from(table).select('endpoint_hash').eq('owner_name',req.userName));
      if(rows.length>=6 && !rows.some(r=>r.endpoint_hash===endpointHash))return res.status(409).json({ok:false,error:'最多开启 6 个设备的通知'});
      await result(supabase.from(table).upsert({endpoint_hash:endpointHash,owner_name:req.userName,subscription,updated_at:new Date().toISOString()},{onConflict:'endpoint_hash'}));
      return res.json({ok:true});
    } catch(_){return res.status(503).json({ok:false,error:'通知设置暂时无法保存，请重试'});}
  });
  router.post('/unsubscribe',async(req,res)=>{
    const endpoint=String(req.body.endpoint||'');if(!endpoint || endpoint.length>2000)return res.status(400).json({ok:false});
    try {await result(supabase.from(table).delete().eq('owner_name',req.userName).eq('endpoint_hash',crypto.createHash('sha256').update(endpoint).digest('hex')));return res.json({ok:true});}
    catch(_){return res.status(503).json({ok:false,error:'通知设置暂时无法保存，请重试'});}
  });
  async function notify(owner,peer,messageId){
    try {
      const state=await result(supabase.rpc('chat_get_conversation_state',{p_actor_name:owner,p_peer_name:peer}));
      if(!state || state.status!=='ok' || state.deleted || (state.muted_until && Date.parse(state.muted_until)>Date.now()))return;
      const rows=await result(supabase.from(table).select('endpoint_hash,subscription').eq('owner_name',owner).limit(6));
      const payload=JSON.stringify({type:'chat-message',owner,peer,id:messageId,title:'XTJ · 新消息',body:'打开聊天查看',url:'/?chat_peer='+encodeURIComponent(peer)+'&chat_owner='+encodeURIComponent(owner)});
      await Promise.allSettled(rows.map(async(row)=>{
        const subscription=validateSubscription(row.subscription);if(!subscription)return;
        try {await transport.sendNotification(subscription,payload,{vapidDetails:vapid,TTL:3600,urgency:'normal',timeout:10000});}
        catch(error){if(error.statusCode===404 || error.statusCode===410)await result(supabase.from(table).delete().eq('owner_name',owner).eq('endpoint_hash',row.endpoint_hash));}
      }));
    }catch(_){console.warn('[chat-push] notification delivery unavailable');}
  }
  return {router,notify,publicKey:vapid.publicKey};
}
module.exports={createChatPush,validateSubscription,deriveVapid};
