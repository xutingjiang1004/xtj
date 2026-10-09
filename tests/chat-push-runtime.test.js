'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),express=require('express'),request=require('supertest'),vm=require('node:vm'),fs=require('node:fs');
const {createChatPush,validateSubscription,deriveVapid}=require('../render-api/chat-push');
function subscription(host='web.push.apple.com'){const e=crypto.createECDH('prime256v1');e.generateKeys();return {endpoint:'https://'+host+'/qa-test-endpoint',keys:{p256dh:e.getPublicKey().toString('base64url'),auth:crypto.randomBytes(16).toString('base64url')}};}
function fixture(){const rows=[],deliveries=[];let state={status:'ok'},failure=0;
 const supabase={rpc:async()=>({data:state,error:null}),from:()=>{let filters=[],remove=false,limit=Infinity;return {select(){return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},limit(n){limit=n;return this;},delete(){remove=true;return this;},async upsert(row){const i=rows.findIndex(r=>r.endpoint_hash===row.endpoint_hash);if(i<0)rows.push(row);else rows[i]=row;return {error:null,data:null};},then(resolve){const found=rows.filter(r=>filters.every(f=>f(r))).slice(0,limit);if(remove)found.forEach(r=>rows.splice(rows.indexOf(r),1));return Promise.resolve({data:found,error:null}).then(resolve);}};}};
 const app=express();app.use(express.json());const push=createChatPush({express,supabase,secret:'runtime-test-secret',authenticateUser:(req,res,next)=>{if(!req.headers.authorization)return res.sendStatus(401);req.userName=req.headers.authorization;next();},transport:{async sendNotification(sub,payload,opts){deliveries.push({sub,payload:JSON.parse(payload),opts});if(failure)throw {statusCode:failure};}}});app.use('/push',push.router);
 return {app,push,rows,deliveries,setState(s){state=s;},setFailure(n){failure=n;}};
}
test('subscriptions require authentication, public push endpoints and real key lengths',async()=>{
 const f=fixture();assert.equal((await request(f.app).get('/push/config')).status,401);
 for(const host of ['127.0.0.1','example.com','web.push.apple.com.evil.com'])assert.equal(validateSubscription(subscription(host)),null);
 assert.equal(validateSubscription({...subscription(),keys:{p256dh:'bad',auth:'bad'}}),null);
 const s=subscription();assert.ok(validateSubscription(s));assert.equal((await request(f.app).post('/push/subscribe').set('Authorization','actor').send({subscription:s})).status,200);
 assert.equal(f.rows[0].owner_name,'actor');assert.equal((await request(f.app).post('/push/unsubscribe').set('Authorization','other').send({endpoint:s.endpoint})).status,200);assert.equal(f.rows.length,1);
 assert.equal((await request(f.app).post('/push/unsubscribe').set('Authorization','actor').send({endpoint:s.endpoint})).status,200);assert.equal(f.rows.length,0);
});
test('notifications hide content, honor mute and delete state, and remove expired endpoints',async()=>{
 const f=fixture();await request(f.app).post('/push/subscribe').set('Authorization','actor').send({subscription:subscription()});
 await f.push.notify('actor','peer','message');assert.equal(f.deliveries.length,1);assert.equal(f.deliveries[0].payload.body,'打开聊天查看');assert.equal(f.deliveries[0].opts.TTL,3600);
 f.setState({status:'ok',muted_until:new Date(Date.now()+60000).toISOString()});await f.push.notify('actor','peer','message');assert.equal(f.deliveries.length,1);
 f.setState({status:'ok',deleted:true});await f.push.notify('actor','peer','message');assert.equal(f.deliveries.length,1);
 f.setState({status:'ok'});f.setFailure(410);await f.push.notify('actor','peer','message');assert.equal(f.rows.length,0);
});
test('VAPID keys are stable and library produces an encrypted authenticated Web Push request',()=>{
 const webPush=require('web-push'),vapid=deriveVapid('test secret');assert.equal(vapid.publicKey,deriveVapid('test secret').publicKey);assert.notEqual(vapid.publicKey,deriveVapid('different').publicKey);
 const details=webPush.generateRequestDetails(subscription(),'private message',{vapidDetails:vapid});assert.match(details.headers.Authorization,/vapid/);assert.equal(details.body.includes(Buffer.from('private message')),false);
});
test('service worker hides cross-account pushes, suppresses visible current chat and opens matching account',async()=>{
 const handlers={},shown=[],opened=[];let owner='actor',peer='peer',visible=false;
 const client={id:'window-one',url:'https://xtj.onrender.com/',get visibilityState(){return visible?'visible':'hidden';},postMessage(m){opened.push(m);},async focus(){}};
 const self={location:{origin:'https://xtj.onrender.com'},addEventListener(k,f){handlers[k]=f;},registration:{async showNotification(title,data){shown.push({title,data});}},clients:{async matchAll(){return [client];},async openWindow(url){opened.push(url);}}};
 const caches={async open(){return {async match(){return new Response(JSON.stringify({owner,clients:{'window-one':{owner,peer}}}));},async put(){}};}};
 const scope=vm.createContext({self,caches,URL,Response,Request,Headers});
 scope.importScripts=function(file){vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8'),scope);};
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../chat-notifications-sw.js'),'utf8'),scope);
 async function push(data){let promise;handlers.push({data:{json:()=>data},waitUntil(p){promise=p;}});await promise;}
 const data={type:'chat-message',owner:'actor',peer:'peer',id:'id',body:'DO NOT DISPLAY THIS'};
 await push(data);assert.equal(shown.length,1);assert.equal(shown[0].data.body,'打开聊天查看');visible=true;await push(data);assert.equal(shown.length,1);visible=false;owner='other';await push(data);assert.equal(shown.length,1);
 owner='actor';let pending;handlers.notificationclick({notification:{data:shown[0].data.data,close(){}},waitUntil(p){pending=p;}});await pending;assert.equal(opened[0].type,'XTJ_OPEN_CHAT');
});
