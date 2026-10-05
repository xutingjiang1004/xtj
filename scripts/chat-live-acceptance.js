'use strict';
// Explicit opt-in production acceptance using two disposable accounts only.
// Never included in npm test / CI. Credentials stay in a mode-0600 checkpoint.
const { chromium, expect } = require('@playwright/test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.LIVE_CHAT_BASE_URL;
if (base !== 'https://xtj.onrender.com') throw new Error('Set LIVE_CHAT_BASE_URL explicitly to the authorized XTJ production origin');
const out = path.join(__dirname, '../output/chat-live');
fs.mkdirSync(out,{recursive:true});
const secretPath='/tmp/xtj-live-test-accounts.json';
const report={at:new Date().toISOString(),base,checks:[],errors:[],users:[]};
const record=(name,details={})=>{report.checks.push({name,ok:true,...details});console.log('PASS '+name);};
const save=()=>fs.writeFileSync(path.join(out,'chromium-report.json'),JSON.stringify(report,null,2));
async function main(){
 const browser=await chromium.launch({executablePath:process.env.CHAT_TEST_CHROMIUM || undefined,headless:true,proxy:process.env.HTTPS_PROXY ? {server:process.env.HTTPS_PROXY} : undefined});
 const contexts=[];
 const actors=[];
 function checkpoint(){const previous=fs.existsSync(secretPath)?JSON.parse(fs.readFileSync(secretPath,'utf8')):[];for(const actor of actors){const value={user:actor.user,password:actor.password,token:actor.token,tokens:[...new Set(actor.tokens||[])]};const index=previous.findIndex(p=>p.user===actor.user);if(index<0)previous.push(value);else previous[index]=value;}fs.writeFileSync(secretPath,JSON.stringify(previous),{mode:0o600});}
 try {
  const health=await (await browser.newContext()).request.get(base+'/health');
  const h=await health.json(); record('production version',{commit:h.node.commit,database:h.database.ok});
  const existing=fs.existsSync(secretPath)?JSON.parse(fs.readFileSync(secretPath,'utf8')):[];
  const suffix=existing.length ? existing[0].user.split('_')[1] : crypto.randomBytes(3).toString('hex');
  for (const tag of ['a','b']) {
   const user='qa0930_'+suffix+'_'+tag, previous=existing.find(a=>a.user===user), password=previous ? previous.password : crypto.randomBytes(24).toString('base64url');
   const context=await browser.newContext({viewport:{width:1280,height:800},ignoreHTTPSErrors:process.env.CHAT_TEST_IGNORE_HTTPS_ERRORS==='1'});contexts.push(context);
   const reg=await context.request.post(base+(previous ? '/api/user/login' : '/api/user/register'),{data:{user_name:user,password},headers:{Origin:base,'X-XTJ-Device-Id':'qa-'+tag}});
   const data=await reg.json(); if (!reg.ok() || !data.token) throw new Error('register '+tag+' status '+reg.status()+' '+(data.error||data.code||''));
   const actor={user,password,token:data.token,tokens:[...(previous?.tokens||[]),previous?.token].filter(Boolean),context};actors.push(actor);report.users.push(user);
   checkpoint();
   await context.addInitScript(({user,tag})=>{localStorage.setItem('xtj_user',user);localStorage.setItem('xtj_device_id','qa-'+tag);},{user,tag});
   const page=await context.newPage();actor.page=page;
   page.on('requestfailed',r=>{const u=new URL(r.url());if(u.pathname.includes('/typing') || u.hostname.includes('supabase')) report.errors.push({network:u.hostname+u.pathname,error:r.failure()?.errorText});});
   page.on('pageerror',e=>report.errors.push({user,message:e.message.slice(0,250)}));
   await page.goto(base,{waitUntil:'domcontentloaded',timeout:45000});
   await page.waitForFunction(u=>window.currentUser===u && typeof window.openChat==='function',user,{timeout:20000});
   record('authenticated browser '+tag);
  }
  const [a,b]=actors;
  async function api(actor,url,options={}){
   const response=await actor.context.request.fetch(base+url,{...options,headers:{Authorization:'Bearer '+actor.token,Origin:base,...options.headers}});
   const data=await response.json(); if(!response.ok())throw new Error(url+' '+response.status()+' '+(data.error||data.code||''));return data;
  }
  const relationship=await api(a,'/api/chat/relationship?target='+encodeURIComponent(b.user));
  if (!relationship.relationship?.can_message) {
   await api(a,'/api/chat/friend-requests',{method:'POST',data:{target_user:b.user,note:'临时联机验收，仅测试账号'}});
   const incoming=await api(b,'/api/chat/requests');
   const request=incoming.requests.find(r=>r.requester_name===a.user);
   if(!request)throw new Error('friend request missing');
   await api(b,'/api/chat/friend-requests/'+request.request_id+'/accept',{method:'POST',data:{}});
  }
  record('real friendship request and acceptance');
  const capabilities=await api(a,'/api/chat/transcription/capabilities');report.transcriptionEnabled=capabilities.enabled;record('production transcription capability checked',{enabled:capabilities.enabled});
  const push=await api(a,'/api/chat/push/config');if(!push.public_key)throw Error('push configuration unavailable');record('authenticated Web Push configuration');
  // Reload to bootstrap subscriptions with real refresh cookies and friend state.
  for(const actor of actors){await actor.page.reload({waitUntil:'domcontentloaded'});await actor.page.waitForFunction(u=>window.currentUser===u&&typeof window.openChat==='function',actor.user);}
  await a.page.evaluate(u=>window.openChat(u),b.user);
  await b.page.evaluate(u=>window.openChat(u),a.user);
  await expect(a.page.locator('#dockChatInput')).toBeEnabled({timeout:20000});
  await expect(b.page.locator('#dockChatInput')).toBeEnabled({timeout:20000});
  await expect(a.page.locator('#dockChatPresence')).toContainText('在线',{timeout:15000});
  record('real peer online status');
  await b.page.waitForFunction(()=>!!window.sb,null,{timeout:30000});
  await b.page.waitForFunction(()=>window.sb.getChannels().some(c=>c.state==='joined'),null,{timeout:30000});
  record('realtime channel states',{states:await b.page.evaluate(()=>typeof sb!=='undefined'&&sb ? sb.getChannels().map(c=>c.state) : [])});
  await a.page.locator('#dockChatInput').fill('正在输入验收');
  await expect(b.page.locator('#dockChatPresence')).toContainText('正在输入',{timeout:15000});
  record('real typing broadcast');
  await a.page.locator('#dockChatInput').fill('');
  await expect(b.page.locator('#dockChatPresence')).not.toContainText('正在输入',{timeout:7000});
  record('typing stopped');
  const text='联机验收 '+suffix+'-'+Date.now()+' · 中文与 emoji 📷';
  await a.page.locator('#dockChatInput').fill(text);
  const sent=Date.now();await a.page.locator('#dockChatSendBtn').click();
  await expect(b.page.locator('#dockChatMessages')).toContainText(text,{timeout:20000});
  record('real text delivery',{milliseconds:Date.now()-sent});
  const ownRow=a.page.locator('#dockChatMessages .chat-msg-row').filter({hasText:text});
  await expect(ownRow.locator('.msg-read-status')).toContainText('已读',{timeout:20000});
  record('real read receipt synchronization');
  await b.page.locator('.chat-msg-row').filter({hasText:text}).locator('.chat-msg').click({button:'right'});await b.page.getByRole('button',{name:'回复',exact:true}).click();
  const reply='引用验收 '+suffix;await b.page.locator('#dockChatInput').fill(reply);await b.page.locator('#dockChatSendBtn').click();
  await expect(a.page.locator('.chat-msg-row').filter({hasText:reply}).locator('.chat-reply-quote')).toBeVisible({timeout:20000});
  await a.page.locator('.chat-msg-row').filter({hasText:reply}).locator('.chat-reply-quote').click();await expect(a.page.locator('#dockChatMessages')).toContainText(text);record('real reply and original-context navigation');
  await a.page.locator('#dockChatJumpLatest').click().catch(()=>{});
  await b.page.locator('#dockChatInput').fill('收到 '+suffix);
  await b.page.locator('#dockChatSendBtn').click();
  await expect(a.page.locator('#dockChatMessages')).toContainText('收到 '+suffix,{timeout:20000});
  record('bidirectional real delivery');
  await a.page.locator('#dockChatConversationBtn').click();
  await expect(a.page.locator('#dockChatConversationMenu')).toBeVisible();
  await a.page.screenshot({path:path.join(out,'desktop-conversation-menu.png')});
  await a.page.keyboard.press('Escape');
  await expect(a.page.locator('#dockChatConversationMenu')).toBeHidden();
  record('production detail menu open and close');
  await a.page.setViewportSize({width:390,height:844});
  await a.page.screenshot({path:path.join(out,'mobile-chromium-chat.png')});
  const overflow=await a.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  if(overflow)throw new Error('mobile page overflows horizontally');
  record('production mobile viewport');
  // Exact supplied image belongs only to these temporary test accounts.
  const png=await a.page.evaluate(()=>{const c=document.createElement('canvas');c.width=360;c.height=240;const x=c.getContext('2d');x.fillStyle='#74bb9b';x.fillRect(0,0,360,240);return c.toDataURL('image/png').split(',')[1];});
  await a.page.setInputFiles('#dockChatFileInp',{name:'qa-photo.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await a.page.locator('#dockChatSendBtn').click();
  const image=b.page.locator('#dockChatMessages .chat-msg.has-image img').last();
  await expect(image).toBeVisible({timeout:30000});
  await expect.poll(()=>image.evaluate(n=>n.complete&&n.naturalWidth>0),{timeout:30000}).toBe(true);
  const imageSrc=await image.getAttribute('src');
  if(!imageSrc.includes('/object/sign/dm-private/'))throw new Error('new photo does not use private signed URL');
  record('real private image upload, delivery and decoding');
  await image.click();await expect(b.page.locator('#chatGallery')).toBeVisible();await b.page.locator('[data-gallery="close"]').click();record('production authorized image gallery');
  const samples=24000,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)wav.writeInt16LE(Math.sin(i/16000*Math.PI*2*440)*5000,44+i*2);
  await a.page.setInputFiles('#dockChatFileInp',{name:'qa-voice.wav',mimeType:'audio/wav',buffer:wav});await a.page.locator('#dockChatSendBtn').click();
  const voice=b.page.locator('.chat-voice-player').last();await expect(voice).toBeVisible({timeout:30000});await voice.locator('button').click();await expect.poll(()=>voice.locator('audio').evaluate(n=>n.currentTime),{timeout:10000}).toBeGreaterThan(.05);
  const sound=await voice.locator('audio').evaluate(async n=>{const response=await fetch(n.src);const ctx=new AudioContext();const decoded=await ctx.decodeAudioData(await response.arrayBuffer());const values=decoded.getChannelData(0);let energy=0;for(const value of values)energy+=value*value;await ctx.close();return {duration:decoded.duration,rms:Math.sqrt(energy/values.length),signed:n.src.includes('/object/sign/dm-private/')};});
  if(sound.rms<.02 || !sound.signed)throw Error('private audio is silent or unsigned');record('real private audio upload, delivery, playback and decoded sound',sound);
  // Replay after a genuine network interruption, not a simulated API response.
  await b.context.setOffline(true);
  const reconnectText='断线补收 '+suffix+'-'+Date.now();
  await a.page.locator('#dockChatInput').fill(reconnectText);await a.page.locator('#dockChatSendBtn').click();
  await expect(a.page.locator('#dockChatMessages')).toContainText(reconnectText,{timeout:15000});
  await b.context.setOffline(false);
  await expect(b.page.locator('#dockChatMessages')).toContainText(reconnectText,{timeout:30000});
  record('real offline/reconnect catch-up');
  for(const actor of actors) await actor.page.screenshot({path:path.join(out,actor===a?'sender-final.png':'recipient-final.png')});
  const history=await api(a,'/api/dm/messages?target='+encodeURIComponent(b.user)+'&limit=100');
  for(const message of history.data || []) {
   let payload={};try{payload=JSON.parse(message.content || '{}');}catch{}
   if(message.user_name===a.user && payload.media && !payload.withdrawn) {
    const cleanup=await api(a,'/api/dm/withdraw',{method:'POST',data:{id:message.id}});
    record('own test attachment withdrawn',{cleanupPending:!!cleanup.cleanup_pending});
   }
  }
  // Retain only session checkpoints until WebKit acceptance and database cleanup.
  for(const actor of actors)await actor.context.storageState({path:path.join(out,actor===a?'session-a.json':'session-b.json')});
 }catch(e){report.diagnostics=await Promise.all(actors.filter(a=>a.page).map(async a=>({user:a.user,state:await a.page.evaluate(()=>({sdk:!!window.supabase,client:!!window.sb,configKey:!!window.XTJ_CONFIG?.SUPABASE_ANON_KEY && !window.XTJ_CONFIG.SUPABASE_ANON_KEY.includes('...'),channels:window.sb?window.sb.getChannels().map(c=>c.state):[]})).catch(()=>({closed:true}))})));report.failure=e.message;console.error('FAIL '+e.message);process.exitCode=1;}
 finally{for(const actor of actors){const token=await actor.page?.evaluate(()=>window.getUserToken?.()).catch(()=>null);if(token)actor.tokens.push(token);}if(actors.length)checkpoint();save();for(const c of contexts)await c.close();await browser.close();}
}
main().catch(e=>{report.failure=e.message;save();console.error('FAIL '+e.message);process.exitCode=1;});
