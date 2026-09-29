'use strict';
const PREF_CACHE='xtj-chat-push-v1',PREF_URL='/__xtj_chat_push_owner';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
  const data=event.data || {};
  if(data.type!=='XTJ_CHAT_PUSH_STATE' || !event.source || !event.source.url || new URL(event.source.url).origin!==self.location.origin)return;
  event.waitUntil(caches.open(PREF_CACHE).then(cache=>cache.put(PREF_URL,new Response(JSON.stringify({owner:String(data.owner||'').slice(0,64),peer:String(data.peer||'').slice(0,64)}),{headers:{'Content-Type':'application/json'}}))));
});
self.addEventListener('push',event=>event.waitUntil((async()=>{
  let data;try{data=event.data.json();}catch(_){return;}
  if(data.type!=='chat-message' || typeof data.owner!=='string' || typeof data.peer!=='string' || data.peer.length>64 || typeof data.id!=='string')return;
  const cache=await caches.open(PREF_CACHE),saved=await cache.match(PREF_URL);if(!saved)return;
  const state=await saved.json();if(state.owner!==data.owner)return;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  if(state.peer===data.peer && windows.some(client=>client.visibilityState==='visible' && new URL(client.url).origin===self.location.origin))return;
  const url='/?chat_peer='+encodeURIComponent(data.peer)+'&chat_owner='+encodeURIComponent(data.owner);
  await self.registration.showNotification('XTJ · 新消息',{body:'打开聊天查看',tag:'xtj-chat-'+data.id,renotify:false,data:{owner:data.owner,peer:data.peer,url}});
})()));
self.addEventListener('notificationclick',event=>{
  event.notification.close();event.waitUntil((async()=>{
    const data=event.notification.data||{},cache=await caches.open(PREF_CACHE),saved=await cache.match(PREF_URL);if(!saved)return;
    const state=await saved.json();if(state.owner!==data.owner)return;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=windows.find(c=>new URL(c.url).origin===self.location.origin);
    if(client){client.postMessage({type:'XTJ_OPEN_CHAT',owner:data.owner,peer:data.peer});await client.focus();}
    else await self.clients.openWindow('/?chat_peer='+encodeURIComponent(data.peer)+'&chat_owner='+encodeURIComponent(data.owner));
  })());
});
