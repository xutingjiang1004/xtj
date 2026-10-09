'use strict';
importScripts('/media-originals-sw.js');
const PREF_CACHE='xtj-chat-push-v1',PREF_URL='/__xtj_chat_push_owner';
let stateWrites=Promise.resolve();
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
async function readState(cache){const saved=await cache.match(PREF_URL);return saved?await saved.json():{owner:'',clients:{}};}
self.addEventListener('message',event=>{
  const data=event.data || {},source=event.source;
  if(data.type!=='XTJ_CHAT_PUSH_STATE' || !source || !source.id || !source.url || new URL(source.url).origin!==self.location.origin)return;
  stateWrites=stateWrites.catch(()=>{}).then(async()=>{
    const cache=await caches.open(PREF_CACHE),state=await readState(cache),windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const live=new Set(windows.map(client=>client.id));state.clients=state.clients||{};
    for(const id of Object.keys(state.clients))if(!live.has(id))delete state.clients[id];
    state.owner=String(data.owner||'').slice(0,64);
    state.clients[source.id]={owner:state.owner,peer:String(data.peer||'').slice(0,64)};
    await cache.put(PREF_URL,new Response(JSON.stringify(state),{headers:{'Content-Type':'application/json'}}));
  });event.waitUntil(stateWrites);
});
self.addEventListener('push',event=>event.waitUntil((async()=>{
  let data;try{data=event.data.json();}catch(_){return;}
  if(data.type!=='chat-message' || typeof data.owner!=='string' || typeof data.peer!=='string' || data.peer.length>64 || typeof data.id!=='string')return;
  await stateWrites.catch(()=>{});
  const cache=await caches.open(PREF_CACHE),state=await readState(cache);
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const matching=windows.filter(client=>new URL(client.url).origin===self.location.origin && state.clients?.[client.id]?.owner===data.owner);
  if(!matching.length && state.owner!==data.owner)return;
  if(matching.some(client=>client.visibilityState==='visible' && state.clients[client.id].peer===data.peer))return;
  const url='/?chat_peer='+encodeURIComponent(data.peer)+'&chat_owner='+encodeURIComponent(data.owner);
  await self.registration.showNotification('XTJ · 新消息',{body:'打开聊天查看',tag:'xtj-chat-'+data.id,renotify:false,data:{owner:data.owner,peer:data.peer,url}});
})()));
self.addEventListener('notificationclick',event=>{
  event.notification.close();event.waitUntil((async()=>{
    await stateWrites.catch(()=>{});
    const data=event.notification.data||{},cache=await caches.open(PREF_CACHE),state=await readState(cache);
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=windows.find(c=>new URL(c.url).origin===self.location.origin && state.clients?.[c.id]?.owner===data.owner);
    if(client){client.postMessage({type:'XTJ_OPEN_CHAT',owner:data.owner,peer:data.peer});await client.focus();}
    else if(state.owner===data.owner)await self.clients.openWindow('/?chat_peer='+encodeURIComponent(data.peer)+'&chat_owner='+encodeURIComponent(data.owner));
  })());
});
