const { test, expect } = require('@playwright/test');
const id = '123e4567-e89b-42d3-a456-000000000004';
const stamp = new Date(Date.now()-60000).toISOString();
async function setup(page) {
  await page.addInitScript(() => localStorage.setItem('xtj_user','tester'));
  await page.route('**/*.supabase.co/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, token: 'test-token', user_name: 'tester', data: [], items: [], conversations: [], friends: [], users: [] }) }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.switchDockTab === 'function');
  await page.evaluate(({id,stamp}) => {
    window.currentUser = 'tester'; window.ensureUserToken = async () => 'test';
    window.ensureProtectedOperationAuth = async () => ({ ok: true, token: 'test' });
    window.__chatTestCalls = []; window.__chatSearchDelay = 0; window.__chatContextText = 'hello world';
    const message = { id, user_name: 'tester', media_url: 'peer', media_type: '__dm__', created_at: stamp, content: JSON.stringify({text:'hello world'}) };
    window.xtjProtectedFetch = async (url, options = {}) => {
      window.__chatTestCalls.push({url, body: options.body});
      let result = {ok:true,data:[],items:[],conversations:[],friends:[]};
      if (url.includes('/history/search')) {
        if (window.__holdChatSearch) await new Promise(resolve=>{window.__releaseChatSearch=resolve;});
        await new Promise(r => setTimeout(r,window.__chatSearchDelay));
        const more = url.includes('cursor_id');
        result = {ok:true,items:[{message_id:id,peer_name:'peer',sender_name:'tester',body:more?'second page':'hello world',sent_at:stamp,message_type:'text'}],has_more:!more,next_cursor_at:stamp,next_cursor_id:id};
      } else if (url.includes('/history/context')) { const current={...message,content:JSON.stringify({text:window.__chatContextText})};result={ok:true,data:[current],focus_id:id}; }
      else if (url.includes('/api/dm/send')) {
        await new Promise(r=>setTimeout(r,window.__chatSendDelay || 500));
        const body=JSON.parse(options.body);
        result={ok:true,message:{...message,id:'123e4567-e89b-42d3-a456-000000000009',created_at:new Date().toISOString(),content:JSON.stringify({text:JSON.parse(body.content).text || '',media:body.kind ? {kind:body.kind,url:'https://example.invalid/sent.png',mimeType:body.mime_type,w:body.media_width,h:body.media_height} : null})}};
      }
      else if (url.includes('/presence/peer')) result={ok:true,presence:{last_seen_at:new Date(Date.now()-7*60000).toISOString()}};
      else if (url.includes('/api/dm/messages')) result={ok:true,data:window.__chatMessagesGone?[]:[message],has_more:false};
      else if (url.includes('/relationship?')) result={ok:true,relationship:{relation:'friend',can_message:true}};
      else if (url.includes('/conversations/')) result={ok:true,state:{status:'ok',draft_revision:0}};
      else if (url.includes('/messages/reply/validate')) result={ok:true,reply_to:{id,sender_name:'tester',text:'hello world'}};
      else if (url.includes('/messages/reactions')) result={ok:true,items:{}};
      else if (url.includes('/messages/edit')) { message.content=JSON.stringify({text:JSON.parse(options.body).text,edited_at:stamp});result={ok:true,message}; }
      return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
    };
    window.switchDockTab('chat',true); window.openChat('peer');
  }, {id,stamp});
}
test('search pages on the server and locates a result', async ({page}) => {
  await setup(page); await page.locator('#chatSearchButton').click(); await page.locator('[data-chat-search-mode="messages"]').click();
  await page.locator('#chatHistoryQuery').fill('hello'); await page.locator('#chatHistoryForm').dispatchEvent('submit');
  await expect(page.locator('.chat-history-result')).toHaveCount(1);
  await page.locator('#chatHistoryMore').click(); await expect(page.locator('.chat-history-result')).toHaveCount(2);
  const calls = await page.evaluate(()=>window.__chatTestCalls.filter(c=>c.url.includes('/history/search')));
  expect(calls[1].url).toContain('cursor_id='); expect(calls[0].url).toContain('limit=30');
  await page.locator('.chat-history-jump').first().click();
  await expect(page.locator('#chatHistoryPanel')).toBeHidden();
  await expect(page.locator('[data-message-id="'+id+'"]')).toContainText('hello world');
});
test('closing search discards a late response', async ({page}) => {
  await setup(page); await page.evaluate(()=>window.__holdChatSearch=true);
  await page.locator('#chatSearchButton').click(); await page.locator('[data-chat-search-mode="messages"]').click(); await page.locator('#chatHistoryQuery').fill('hello');
  await page.locator('#chatHistoryForm').dispatchEvent('submit');
  await page.waitForFunction(()=>typeof window.__releaseChatSearch==='function');
  await page.locator('#chatHistoryClose').click();
  await page.evaluate(()=>window.__releaseChatSearch());
  await expect(page.locator('#chatHistoryPanel')).toBeHidden();
  await expect(page.locator('.chat-history-result')).toHaveCount(0);
});
test('reply and edit use the existing message action menu', async ({page}) => {
  await setup(page); await page.waitForTimeout(800); const bubble=page.locator('[data-message-id="'+id+'"] .chat-msg'); await expect(bubble).toBeVisible();
  await bubble.click({button:'right'}); await page.getByRole('button',{name:'回复',exact:true}).click();
  await expect(page.locator('#chatMessageContext')).toContainText('hello world');
  await page.locator('#chatMessageContextClose').click(); await page.waitForTimeout(250);
  await bubble.click({button:'right'}); await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.locator('#dockChatInput').fill('edited message'); await page.locator('#dockChatSendBtn').click();
  await expect(bubble).toContainText('edited message'); await expect(page.locator('#chatMessageContext')).toBeHidden();
});
test('mobile search and composer fit a 375px viewport', async ({page}) => {
  await page.setViewportSize({width:375,height:812}); await setup(page);
  await page.locator('#chatMediaButton').click(); await expect(page.locator('#chatHistoryPanel')).toBeVisible();
  const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,right:document.getElementById('chatHistoryPanel').getBoundingClientRect().right}));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.width); expect(metrics.right).toBeLessThanOrEqual(metrics.width);
  await page.screenshot({path:'output/playwright/chat-mobile.png'});
});

test('recording cancel releases the microphone and restores the composer', async ({page}) => {
  await page.addInitScript(() => {
    window.__stoppedTracks = 0;
    Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){window.__stoppedTracks++;}}]})}});
    window.MediaRecorder = class {
      static isTypeSupported(){return true;}
      constructor(){this.state='inactive';this.mimeType='audio/webm';}
      start(){this.state='recording';}
      stop(){this.state='inactive';if(this.ondataavailable)this.ondataavailable({data:new Blob(['audio'],{type:'audio/webm'})});if(this.onstop)this.onstop();}
    };
  });
  await setup(page); await expect(page.locator('#dockChatInput')).toBeEnabled();
  await page.locator('#dockChatInput').fill('existing draft'); await page.locator('#chatVoiceButton').click();
  await expect(page.locator('#chatVoiceCancel')).toBeVisible(); await expect(page.locator('#dockChatInput')).toBeDisabled();
  await page.locator('#chatVoiceCancel').click(); await expect(page.locator('#dockChatInput')).toBeEnabled();
  await expect(page.locator('#dockChatInput')).toHaveValue('existing draft'); expect(await page.evaluate(()=>window.__stoppedTracks)).toBeGreaterThan(0);
});

test('retired archive returns conversations and menu removes reactions and transcription', async ({page}) => {
  await setup(page); await page.waitForTimeout(800);
  await page.evaluate(()=>window.__xtjApplyConversationSnapshot([
    {peer_name:'active-peer',last_message:'active',last_message_at:new Date().toISOString()},
    {peer_name:'archived-peer',last_message:'archived',archived_at:new Date().toISOString()}
  ]));
  await expect(page.locator('#dockChatList [data-chat-user="active-peer"]')).toHaveCount(1);
  await expect(page.locator('#chatArchiveButton')).toHaveCount(0);
  await expect(page.locator('#dockChatList [data-chat-user="archived-peer"]')).toHaveCount(1);
  await expect(page.locator('#dockChatList [data-chat-user="active-peer"]')).toHaveCount(1);
  await page.locator('[data-message-id="'+id+'"] .chat-msg').click({button:'right'});
  await expect(page.getByRole('button',{name:'回应',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'转文字',exact:true})).toHaveCount(0);
  const buttons=page.locator('.dm-action-grid button');expect(await buttons.count()).toBeLessThanOrEqual(8);
  const boxes=await buttons.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().y));expect(new Set(boxes).size).toBe(2);
  await expect(page.locator('[data-dm-action="reply"] svg')).toBeVisible();
});

test('editing while viewing a search result updates the existing history window', async ({page}) => {
  await setup(page); await page.locator('#chatSearchButton').click(); await page.locator('[data-chat-search-mode="messages"]').click(); await page.locator('#chatHistoryQuery').fill('hello');
  await page.locator('#chatHistoryForm').dispatchEvent('submit'); await page.locator('.chat-history-jump').first().click();
  await expect(page.locator('[data-message-id="'+id+'"]')).toContainText('hello world');
  await page.evaluate((id)=>{window.__chatContextText='remote edit';window.__xtjRefreshChatMessageExtras({kind:'edit',peer:'peer',message_id:id});},id);
  await expect(page.locator('[data-message-id="'+id+'"]')).toContainText('remote edit');
});

test('a remote clear removes messages from a focused search window', async ({page}) => {
  await setup(page); await page.locator('#chatSearchButton').click(); await page.locator('[data-chat-search-mode="messages"]').click(); await page.locator('#chatHistoryQuery').fill('hello');
  await page.locator('#chatHistoryForm').dispatchEvent('submit'); await page.locator('.chat-history-jump').first().click();
  await expect(page.locator('[data-message-id="'+id+'"]')).toBeVisible();
  await page.evaluate(()=>{window.__chatMessagesGone=true;window.__xtjRefreshChatMessageExtras({kind:'clear',peer:'peer'});});
  await expect(page.locator('[data-message-id="'+id+'"]')).toHaveCount(0);
});


test('conversation settings live only in the detail header and reopen safely during exit', async ({page}) => {
  await setup(page);
  await page.evaluate(()=>window.__xtjApplyConversationSnapshot([{peer_name:'peer',last_message:'hello',last_message_at:new Date().toISOString()}]));
  await expect(page.locator('#dockChatList [data-chat-menu-peer]')).toHaveCount(0);
  await expect(page.locator('#panelChat .chat-header #dockChatSocialBtn')).toHaveCount(1);
  const trigger=page.locator('#dockChatConversationBtn');
  await expect(trigger).toBeVisible();
  await trigger.click();
  const menu=page.locator('#dockChatConversationMenu');
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded','true');
  await expect(menu).toContainText('搜索聊天记录');
  const geometry=await page.evaluate(()=>{
    const card=document.querySelector('.chat-conversation-menu-card').getBoundingClientRect();
    const head=document.querySelector('#panelChat .chat-header').getBoundingClientRect();
    return {top:card.top,header:head.top,width:card.width,right:card.right,viewport:innerWidth};
  });
  expect(geometry.top).toBeLessThan(geometry.header+100);
  expect(geometry.width).toBeLessThanOrEqual(321);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  // Reopen before the 140ms exit animation finishes; its old callback must not hide the menu.
  await trigger.dispatchEvent('click');
  await page.waitForTimeout(250);
  await expect(menu).toBeVisible();
  await page.locator('[data-chat-conversation-action="search"]').click();
  await expect(menu).toBeHidden();
  await expect(page.locator('#chatHistoryPanel')).toBeVisible();
});

test('text flies from the composer and settles without replay on acknowledgement', async ({page}) => {
  await setup(page); await page.evaluate(()=>window.__chatSendDelay=50); await expect(page.locator('#dockChatInput')).toBeEnabled();
  await page.locator('#dockChatInput').fill('a new message');
  await page.locator('#dockChatSendBtn').click();
  await expect(page.locator('.chat-send-flight')).toHaveCount(1);
  const frames=await page.evaluate(()=>document.querySelector('.chat-send-flight').getAnimations()[0].effect.getKeyframes());
  expect(frames[0].transform).toContain('translate3d(');
  expect(frames[0].transform).not.toBe(frames[1].transform);
  await expect(page.locator('[data-message-id="123e4567-e89b-42d3-a456-000000000009"]')).toHaveCount(1);
  await expect(page.locator('.chat-send-flight')).toHaveCount(0);
  await expect(page.locator('#dockChatMessages .chat-msg').last()).toContainText('a new message');
  await page.waitForTimeout(600);
  await expect(page.locator('.chat-send-flight')).toHaveCount(0);
  expect(await page.evaluate(()=>Array.from(document.querySelectorAll('#dockChatMessages .chat-msg')).every(n=>n.style.visibility!=='hidden'))).toBe(true);
});

test('incoming typing expires promptly and restores last-online status', async ({page}) => {
  await setup(page); await expect(page.locator('#dockChatPresence')).toContainText('7 分钟前在线');
  await page.evaluate(()=>window.__xtjApplyChatTyping({peer:'peer',active:true,at:Date.now()}));
  await expect(page.locator('#dockChatPresence')).toContainText('正在输入');
  await expect(page.locator('.chat-typing-dots i')).toHaveCount(3);
  await expect(page.locator('#dockChatPresence')).toContainText('7 分钟前在线',{timeout:6500});
  await page.evaluate(()=>window.__xtjApplyChatTyping({peer:'other',active:true,at:Date.now()}));
  await expect(page.locator('#dockChatPresence')).toContainText('7 分钟前在线');
  await page.evaluate(()=>window.__xtjApplyChatTyping({peer:'peer',active:true,at:Date.now()-20000}));
  await expect(page.locator('#dockChatPresence')).toContainText('7 分钟前在线');
});

test('switching peers clears typing and cancels an in-flight send', async ({page}) => {
  await setup(page); await expect(page.locator('#dockChatInput')).toBeEnabled();
  await page.evaluate(()=>window.__xtjApplyChatTyping({peer:'peer',active:true,at:Date.now()}));
  await page.locator('#dockChatInput').fill('sending before switch');
  await page.locator('#dockChatSendBtn').click();
  await expect(page.locator('.chat-send-flight')).toHaveCount(1);
  await page.evaluate(()=>window.openChat('other-peer'));
  await expect(page.locator('.chat-send-flight')).toHaveCount(0);
  await expect(page.locator('#dockChatPresence')).not.toContainText('正在输入');
  const stopped=await page.evaluate(()=>window.__chatTestCalls.some(c=>c.url.includes('/typing/peer') && JSON.parse(c.body).active===false));
  expect(stopped).toBe(true);
});

test('reduced motion skips the send flight and closes menus immediately', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'}); await setup(page);
  await page.locator('#dockChatConversationBtn').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#dockChatConversationMenu')).toBeHidden();
  await expect(page.locator('#dockChatInput')).toBeEnabled();
  await page.locator('#dockChatInput').fill('quiet motion');
  await page.locator('#dockChatSendBtn').click();
  await expect(page.locator('.chat-send-flight')).toHaveCount(0);
  await expect(page.locator('#dockChatMessages .chat-msg').last()).toContainText('quiet motion');
});


test('photo flies from attachment preview with a visible local image', async ({page}) => {
  await page.setViewportSize({width:390,height:844}); await setup(page);
  await expect(page.locator('#dockChatInput')).toBeEnabled();
  const png=await page.evaluate(()=>{
    const canvas=document.createElement('canvas'); canvas.width=360; canvas.height=240;
    const context=canvas.getContext('2d'); context.fillStyle='#79c8a7'; context.fillRect(0,0,360,240);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.route('**/api/dm/upload?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,storage_path:'chat/test.png',public_url:'https://example.invalid/sent.png',kind:'image',mime_type:'image/png'})}));
  await page.route('https://example.invalid/**',route=>route.fulfill({status:200,contentType:'image/png',body:Buffer.from(png,'base64')}));
  await page.setInputFiles('#dockChatFileInp',{name:'photo.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await expect(page.locator('#dockChatFilePreview')).toBeVisible();
  await page.locator('#dockChatSendBtn').click();
  await expect(page.locator('.chat-send-flight img')).toBeVisible();
  const flight=await page.evaluate(()=>{
    const ghost=document.querySelector('.chat-send-flight');
    const frames=ghost.getAnimations()[0].effect.getKeyframes();
    return {src:ghost.querySelector('img').src,first:frames[0].transform,last:frames[1].transform};
  });
  expect(flight.src).toMatch(/^blob:/); expect(flight.first).not.toBe(flight.last);
  await expect(page.locator('.chat-send-flight')).toHaveCount(0);
  await expect(page.locator('#dockChatMessages .chat-msg.has-media img')).toBeVisible();
  await expect(page.locator('#dockChatFilePreview')).toBeHidden();
});


test('the site motion-off preference also skips send effects', async ({page}) => {
  await setup(page); await expect(page.locator('#dockChatInput')).toBeEnabled();
  await page.evaluate(()=>document.documentElement.setAttribute('data-xtj-motion','off'));
  await page.locator('#dockChatInput').fill('motion disabled');
  await page.locator('#dockChatSendBtn').click();
  await expect(page.locator('.chat-send-flight')).toHaveCount(0);
  await expect(page.locator('#dockChatMessages .chat-msg').last()).toContainText('motion disabled');
});

test('header contacts and account search use the existing protected user directory', async ({page}) => {
  await setup(page);
  const contacts=await page.locator('#dockChatSocialBtn').boundingBox(), search=await page.locator('#chatSearchButton').boundingBox();
  expect(contacts.x).toBeLessThan(search.x);
  await page.evaluate(()=>{
    const original=window.xtjProtectedFetch;
    window.xtjProtectedFetch=async(url,options)=>url.includes('/users/search') ? new Response(JSON.stringify({ok:true,users:[{user_name:'registered-user'}]}),{headers:{'Content-Type':'application/json'}}) : original(url,options);
  });
  await page.locator('#chatSearchButton').click(); await page.locator('[data-chat-search-mode="messages"]').click(); await page.locator('[data-chat-search-mode="users"]').click();
  await page.locator('#chatHistoryQuery').fill('registered'); await page.locator('#chatHistoryForm').dispatchEvent('submit');
  await expect(page.locator('.chat-account-result')).toContainText('registered-user');
  await page.locator('.chat-account-result').click(); await expect(page.locator('#dockChatSocialSheet')).toBeVisible();
  await expect(page.locator('#dockChatSocialSearchForm input')).toHaveValue('registered-user');
});

test('iPad viewport uses the available height and composer has one continuous background', async ({browser}) => {
  const context=await browser.newContext({viewport:{width:1194,height:834},hasTouch:true,userAgent:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
  const page=await context.newPage(); await page.addInitScript(()=>localStorage.setItem('xtj_theme','dark')); await setup(page);
  await expect(page.locator('#dockChatInput')).toBeEnabled();
  const layout=await page.evaluate(()=>{
    const box=document.getElementById('dockChatContainer').getBoundingClientRect(), input=getComputedStyle(document.getElementById('dockChatInput'));
    return {bottom:box.bottom,height:innerHeight,background:input.backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  expect(layout.height-layout.bottom).toBeLessThan(32); expect(layout.overflow).toBe(false); expect(layout.background).toBe('rgba(0, 0, 0, 0)');
  await page.screenshot({path:'output/chat-visual/ipad-responsive-dark.png'}); await context.close();
});

test('revisiting a conversation preserves bubble and avatar nodes', async ({page}) => {
  await setup(page); await expect(page.locator('[data-message-id="'+id+'"]')).toBeVisible();
  await page.evaluate(id=>{ window.__savedBubble=document.querySelector('[data-message-id="'+id+'"] .chat-msg'); window.__savedAvatar=document.querySelector('[data-message-id="'+id+'"] .chat-msg-avatar'); window.openChat('second-peer'); },id);
  await page.waitForTimeout(150); await page.evaluate(()=>window.openChat('peer'));
  await expect.poll(()=>page.evaluate(id=>window.__savedBubble===document.querySelector('[data-message-id="'+id+'"] .chat-msg') && window.__savedAvatar===document.querySelector('[data-message-id="'+id+'"] .chat-msg-avatar'),id)).toBe(true);
});

async function fakeMic(page,pending=false) {
  await page.addInitScript(pending=>{
    const buffer=new ArrayBuffer(44+48000),v=new DataView(buffer);const word=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i));};word(0,'RIFF');v.setUint32(4,48036,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,24000,true);v.setUint32(28,48000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,48000,true);
    window.__stoppedTracks=0;
    const stream={getTracks:()=>[{stop(){window.__stoppedTracks++;}}]};
    Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:()=>pending ? new Promise(resolve=>window.__resolveMic=()=>resolve(stream)) : Promise.resolve(stream)}});
    window.MediaRecorder=class {
      static isTypeSupported(){return true;} constructor(){this.state='inactive';this.mimeType='audio/webm';}
      start(){this.state='recording';} stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([buffer],{type:'audio/wav'})});this.onstop?.();}
    };
  },pending);
}

test('long press released while permission is pending never sends and releases the later stream', async ({page}) => {
  await fakeMic(page,true); await setup(page); await expect(page.locator('#dockChatInput')).toBeEnabled();
  const box=await page.locator('.chat-input-wrap').boundingBox(); await page.mouse.move(box.x+20,box.y+20); await page.mouse.down();
  await page.waitForFunction(()=>typeof window.__resolveMic==='function'); await page.mouse.up(); await page.evaluate(()=>window.__resolveMic());
  await expect.poll(()=>page.evaluate(()=>window.__stoppedTracks)).toBe(1); await expect(page.locator('#dockChatInput')).toBeEnabled();
  expect(await page.evaluate(()=>window.__chatTestCalls.filter(c=>c.url.includes('/api/dm/send')).length)).toBe(0);
});

test('long press slide-up cancels voice and keeps the microphone icon', async ({page}) => {
  await fakeMic(page); await setup(page); await expect(page.locator('#dockChatInput')).toBeEnabled();
  const box=await page.locator('.chat-input-wrap').boundingBox(); await page.mouse.move(box.x+20,box.y+20); await page.mouse.down();
  await expect(page.locator('#chatVoiceButton')).toHaveAttribute('aria-pressed','true');
  await page.mouse.move(box.x+20,box.y-80);
  await expect(page.locator('#chatRecordingIndicator')).toHaveClass(/is-cancelling/);
  await expect(page.locator('#chatVoiceStatus')).toContainText('取消');
  await page.mouse.up();
  await expect(page.locator('#chatRecordingIndicator')).toBeHidden();
  await expect(page.locator('#chatVoiceButton svg')).toBeVisible(); await expect(page.locator('#chatVoiceButton')).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(()=>window.__stoppedTracks)).toBeGreaterThan(0); await expect(page.locator('#dockChatFilePreview')).toBeHidden();
});

test('long press records, release prepares upload and sends audio through the existing pipeline', async ({page}) => {
  await fakeMic(page); await setup(page); await expect(page.locator('#dockChatInput')).toBeEnabled();
  await page.route('**/api/dm/upload?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,storage_path:'chat/test.webm',public_url:'https://example.invalid/voice.webm',kind:'audio',mime_type:'audio/webm'})}));
  const box=await page.locator('.chat-input-wrap').boundingBox(); await page.mouse.move(box.x+20,box.y+20); await page.mouse.down();
  await expect(page.locator('#chatVoiceButton')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#chatRecordingIndicator')).toBeVisible();
  await expect(page.locator('#chatVoiceStatus')).toContainText('录音');
  const wave=page.locator('#chatRecordingIndicator i').first();
  const first=await wave.evaluate(el=>getComputedStyle(el).transform);
  await expect.poll(()=>wave.evaluate(el=>getComputedStyle(el).transform)).not.toBe(first);
  await page.waitForTimeout(700); await page.mouse.up();
  await expect(page.locator('#chatRecordingIndicator')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>window.__chatTestCalls.some(c=>c.url.includes('/api/dm/send')&&JSON.parse(c.body).kind==='audio'))).toBe(true);
  await expect(page.locator('#dockChatInput')).toBeEnabled(); await expect(page.locator('#chatVoiceButton svg')).toBeVisible();
});

test('custom voice player plays real WAV media, pauses, and retains its node on read changes', async ({page}) => {
  const samples=16000, wav=Buffer.alloc(44+samples*2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)wav.writeInt16LE(Math.sin(i/16000*Math.PI*2*440)*2500,44+i*2);
  await page.route('https://example.invalid/voice.wav',route=>route.fulfill({status:200,contentType:'audio/wav',body:wav}));
  await page.setViewportSize({width:390,height:844}); await setup(page);
  await page.evaluate(({stamp})=>{
    const original=window.xtjProtectedFetch;
    window.__voiceRead=false;
    window.xtjProtectedFetch=async(url,options)=>{
      if(url.includes('/api/dm/messages')) return new Response(JSON.stringify({ok:true,has_more:false,data:[{id:'123e4567-e89b-42d3-a456-000000000010',user_name:'tester',media_url:'voice-peer',created_at:stamp,views:window.__voiceRead?1:0,content:JSON.stringify({text:'语音播放器验收',media:{kind:'audio',url:'https://example.invalid/voice.wav',mimeType:'audio/wav'},read_at:window.__voiceRead?stamp:null})}]}),{headers:{'Content-Type':'application/json'}});
      return original(url,options);
    };
    window.openChat('voice-peer');
  },{stamp});
  const player=page.locator('.chat-voice-player'); await expect(player).toBeVisible();
  await player.evaluate(el=>{const e=new Event('touchstart',{bubbles:true});Object.defineProperty(e,'touches',{value:[{clientX:100,clientY:100}]});el.dispatchEvent(e);});await page.waitForTimeout(480);await player.dispatchEvent('touchend',{touches:[]});await expect(page.locator('.dm-action-panel')).toBeVisible();await page.keyboard.press('Escape');await player.locator('button').click();
  await expect(player).toHaveClass(/is-playing/); await expect(player.locator('button')).toHaveAttribute('aria-pressed','true');
  await expect(player.locator('.voice-play-icon path')).toHaveAttribute('d','M7 5h4v14H7zM14 5h4v14h-4z');
  await player.locator('button').click(); await expect(player).not.toHaveClass(/is-playing/);
  await page.evaluate(()=>{window.__savedAudio=document.querySelector('.msg-audio');window.__voiceRead=true;window.openChat('voice-peer');});
  await expect.poll(()=>page.evaluate(()=>window.__savedAudio===document.querySelector('.msg-audio'))).toBe(true);
  await page.screenshot({path:'output/chat-visual/mobile-voice-player.png'});
  await page.locator('#dockChatSocialBtn').click(); await expect(page.locator('[data-chat-social-tab="friends"]')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#dockChatSocialSheet .chat-social-card')).toBeVisible();
  await page.waitForTimeout(220);
  const card=await page.locator('#dockChatSocialSheet .chat-social-card').boundingBox(); expect(card.y+card.height).toBeLessThan(845);
  await page.screenshot({path:'output/chat-visual/mobile-contacts.png'});
});

test('home navigation scrolls out with feed and restores the moon icon', async ({page}) => {
  await page.setViewportSize({width:390,height:844});await setup(page);
  // Put the scroll fixture outside the asynchronously refreshed feed.
  await page.evaluate(()=>{window.switchDockTab('posts');const spacer=document.createElement('div');spacer.style.height='2000px';spacer.textContent='滚动验收';document.getElementById('panelPosts').appendChild(spacer);});
  const before=await page.locator('.posts-nav').boundingBox();
  await page.evaluate(()=>document.getElementById('panelPosts').scrollTop=500);await page.waitForTimeout(100);
  const down=await page.locator('.posts-nav').boundingBox();
  await page.evaluate(()=>document.getElementById('panelPosts').scrollTop=100);await page.waitForTimeout(100);
  const up=await page.locator('.posts-nav').boundingBox();
  expect(down.y).toBeLessThan(-100);expect(up.y).toBeGreaterThan(down.y);
  await page.evaluate(()=>document.getElementById('panelPosts').scrollTop=0);
  await expect(page.locator('#themeToggle .theme-toggle-orb')).toBeVisible();
  const toggle=await page.locator('#themeToggle').boundingBox(),orb=await page.locator('#themeToggle .theme-toggle-orb').boundingBox();expect(toggle.width).toBe(52);expect(orb.x+orb.width).toBeLessThanOrEqual(toggle.x+toggle.width);
  await page.locator('#themeToggle').click();await expect(page.locator('#themeToggle')).toHaveClass(/is-dark/);
  await page.waitForTimeout(350);await page.locator('#themeToggle').click();await expect(page.locator('#themeToggle')).not.toHaveClass(/is-dark/);
  await expect(page.locator('.posts-nav')).not.toHaveClass(/hidden-header/);
  const auth=await page.locator('#authUI').boundingBox(), brand=await page.locator('.posts-nav-brand').boundingBox(); expect(Math.abs(auth.y-brand.y)).toBeLessThan(15);
  await page.screenshot({path:'output/chat-visual/mobile-home-stable.png'});
});
test('reply quote jumps to original and cleared chats reopen without skeletons',async({page})=>{
 await setup(page);await page.waitForTimeout(400);
 await page.evaluate(({id,stamp})=>{const original=window.xtjProtectedFetch;window.xtjProtectedFetch=async(url,options)=>{if(url.includes('/api/dm/messages'))return new Response(JSON.stringify({ok:true,data:[{id,user_name:'tester',media_url:'peer',created_at:stamp,content:JSON.stringify({text:'reply content',reply_to:{id:'123e4567-e89b-42d3-a456-000000000033',sender_name:'peer',text:'quoted original'}})}]}));return original(url,options);};window.openChat('peer');},{id,stamp});
 await page.getByRole('button',{name:'定位引用的消息'}).click();await expect.poll(()=>page.evaluate(()=>window.__chatTestCalls.some(c=>c.url.includes('message_id=123e4567-e89b-42d3-a456-000000000033')))).toBe(true);
 await page.evaluate(()=>{window.__chatMessagesGone=true;window.openChat('empty-peer');});
 await expect(page.locator('#dockChatMessages .xtj-loading-skeleton,#dockChatMessages .xtj-loading')).toHaveCount(0);
});
test('multi attachment selection supports reorder, removal and sends each selected photo',async({page})=>{
 await setup(page);await expect(page.locator('#dockChatInput')).toBeEnabled();
 await page.evaluate(()=>{const NativeXHR=window.XMLHttpRequest;class XHR extends NativeXHR{open(method,url,...rest){this.mockUpload=url.includes('/api/dm/upload?');if(!this.mockUpload)super.open(method,url,...rest);}setRequestHeader(...args){if(!this.mockUpload)super.setRequestHeader(...args);}send(file){if(!this.mockUpload)return super.send(file);window.__batchFiles=(window.__batchFiles||[]).concat(file.name);Object.defineProperty(this,'status',{value:200});Object.defineProperty(this,'responseText',{value:JSON.stringify({ok:true,storage_path:'chat/test.png',public_url:'https://example.invalid/sent.png'})});setTimeout(()=>this.onload(),10);}}window.XMLHttpRequest=XHR;window.__chatSendDelay=30;});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
 await page.locator('#dockChatFileInp').setInputFiles([{name:'one.png',mimeType:'image/png',buffer:png},{name:'two.png',mimeType:'image/png',buffer:png},{name:'three.png',mimeType:'image/png',buffer:png}]);
 await expect(page.locator('.chat-attachment-item')).toHaveCount(3);await page.getByRole('button',{name:'后移第 1 个附件'}).click();await page.getByRole('button',{name:'移除第 3 个附件'}).click();await expect(page.locator('.chat-attachment-item')).toHaveCount(2);
 await page.locator('#dockChatSendBtn').click();await expect.poll(()=>page.evaluate(()=>window.__batchFiles)).toEqual(['two.png','one.png']);await expect(page.locator('#dockChatSendBtn')).toBeEnabled();await page.waitForTimeout(500);expect(await page.evaluate(()=>window.__batchFiles)).toEqual(['two.png','one.png']);expect(await page.evaluate(()=>window.__chatTestCalls.filter(c=>c.url.includes('/api/dm/send')).length)).toBe(2);
});
test('actual MediaRecorder output contains nonzero audio and sending starts as a wave bubble',async({page})=>{
 await setup(page);test.skip(await page.evaluate(()=>typeof MediaRecorder!=='function'),'Cloud Linux WebKit lacks MediaRecorder; real WAV playback and mocked recording lifecycle are tested separately.');await expect(page.locator('#dockChatInput')).toBeEnabled();
 await page.evaluate(()=>{
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{async getUserMedia(){const ctx=new AudioContext();await ctx.resume();const source=ctx.createOscillator(),gain=ctx.createGain(),dest=ctx.createMediaStreamDestination();source.frequency.value=440;gain.gain.value=.2;source.connect(gain);gain.connect(dest);source.start();window.__realVoiceContext=ctx;return dest.stream;}}});
  class XHR{constructor(){this.upload={};this.status=200;}open(){}setRequestHeader(){}send(file){window.__capturedVoiceFile=file;this.responseText=JSON.stringify({ok:true,storage_path:'chat/voice.m4a',public_url:'https://example.invalid/voice.m4a'});setTimeout(()=>this.onload(),600);}abort(){}}window.XMLHttpRequest=XHR;
 });
 await page.locator('#chatVoiceButton').click();await expect(page.locator('#chatVoiceButton')).toHaveAttribute('aria-pressed','true');await page.waitForTimeout(1200);await page.locator('#chatVoiceButton').click();await expect(page.locator('#dockChatFilePreview')).toBeVisible();await page.locator('#dockChatSendBtn').click();
 await expect(page.locator('.chat-msg.pending .chat-voice-wave')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.__capturedVoiceFile?.size||0)).toBeGreaterThan(100);
 const audio=await page.evaluate(async()=>{const file=window.__capturedVoiceFile,ctx=window.__realVoiceContext,decoded=await ctx.decodeAudioData(await file.arrayBuffer()),values=decoded.getChannelData(0);let energy=0;for(const v of values)energy+=v*v;return {seconds:decoded.duration,rms:Math.sqrt(energy/values.length),mime:file.type};});
 expect(audio.seconds).toBeGreaterThan(.5);expect(audio.rms).toBeGreaterThan(.02);
});
test('account search is first and contact tabs preserve the loaded search node',async({page})=>{
 await setup(page);await page.locator('#chatSearchButton').click();await expect(page.locator('[data-chat-search-mode="users"]')).toHaveAttribute('aria-selected','true');await expect(page.locator('#chatHistoryScope')).toBeHidden();await page.locator('#chatHistoryClose').click();
 await page.locator('#dockChatSocialBtn').click();await page.locator('[data-chat-social-tab="search"]').click();await page.locator('#dockChatSocialSearchForm input').fill('my-search');await page.evaluate(()=>window.__savedSocialInput=document.querySelector('#dockChatSocialSearchForm input'));
 await page.locator('[data-chat-social-tab="blocks"]').click();await page.locator('[data-chat-social-tab="search"]').click();expect(await page.evaluate(()=>document.querySelector('#dockChatSocialSearchForm input')===window.__savedSocialInput)).toBe(true);await expect(page.locator('#dockChatSocialSearchForm input')).toHaveValue('my-search');
 await page.waitForTimeout(400);await page.screenshot({path:'output/chat-visual/contacts-redesign.png'});
});

test('touch long press reply does not swallow the next quote click',async({page})=>{
 await setup(page);await page.waitForTimeout(400);
 await page.evaluate(({id,stamp})=>{const base=window.xtjProtectedFetch;window.xtjProtectedFetch=async(url,options)=>url.includes('/api/dm/messages')?new Response(JSON.stringify({ok:true,data:[{id,user_name:'tester',media_url:'peer',created_at:stamp,content:JSON.stringify({text:'touch reply',reply_to:{id,sender_name:'tester',text:'original'}})}]})):base(url,options);window.openChat('peer');},{id,stamp});
 const bubble=page.locator('[data-message-id="'+id+'"] .chat-msg');await expect(bubble).toContainText('touch reply');
 await bubble.evaluate(el=>{const e=new Event('touchstart',{bubbles:true});Object.defineProperty(e,'touches',{value:[{clientX:100,clientY:100}]});el.dispatchEvent(e);});await page.waitForTimeout(480);await bubble.dispatchEvent('touchend',{touches:[]});
 await page.getByRole('button',{name:'回复',exact:true}).click();await expect(page.locator('#chatMessageContext')).toBeVisible();
 await page.getByRole('button',{name:'定位引用的消息'}).click();await expect.poll(()=>page.evaluate(()=>window.__chatTestCalls.some(c=>c.url.includes('/history/context')))).toBe(true);
});
test('gallery fetches one metadata page then pages on demand and releases on logout',async({page})=>{
 await setup(page);await page.waitForTimeout(400);
 await page.evaluate(({id,stamp})=>{const base=window.xtjProtectedFetch;window.xtjProtectedFetch=async(url,options)=>{
 if(url.includes('/api/dm/messages'))return new Response(JSON.stringify({ok:true,data:[{id,user_name:'tester',media_url:'peer',created_at:stamp,content:JSON.stringify({text:'',media:{kind:'image',url:'https://example.invalid/photo.png',w:100,h:100}})}]}));
 if(url.includes('/history/search')){window.__galleryCalls=(window.__galleryCalls||0)+1;return new Response(JSON.stringify({ok:true,items:[],has_more:true,next_cursor_at:stamp,next_cursor_id:id}));}return base(url,options);};window.openChat('peer');},{id,stamp});
 await page.locator('.msg-img').click();await expect(page.locator('#chatGallery')).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.__galleryCalls)).toBe(1);await page.waitForTimeout(200);expect(await page.evaluate(()=>window.__galleryCalls)).toBe(1);
 await page.locator('[data-gallery="previous"]').click();await expect.poll(()=>page.evaluate(()=>window.__galleryCalls)).toBe(2);await page.evaluate(()=>window.__xtjResetChatPanels());await expect(page.locator('#chatGallery')).toHaveCount(0);
});

test('touch swipe replies while a vertical gesture remains scrolling',async({page})=>{
 await setup(page);await page.waitForTimeout(400);const bubble=page.locator('[data-message-id="'+id+'"] .chat-msg');
 await bubble.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:1,clientX:100,clientY:100});await bubble.dispatchEvent('pointermove',{pointerType:'touch',pointerId:1,clientX:105,clientY:145});await bubble.dispatchEvent('pointerup',{pointerType:'touch',pointerId:1,clientX:105,clientY:145});await expect(page.locator('#chatMessageContext')).toBeHidden();
 await bubble.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:2,clientX:100,clientY:100});await bubble.dispatchEvent('pointermove',{pointerType:'touch',pointerId:2,clientX:180,clientY:104});await bubble.dispatchEvent('pointerup',{pointerType:'touch',pointerId:2,clientX:180,clientY:104});await expect(page.locator('#chatMessageContext')).toContainText('hello world');
 await page.locator('#chatMessageContextClose').click();await page.locator('#chatSearchButton').click();await page.waitForTimeout(350);await page.screenshot({path:'output/chat-visual/account-search-redesign.png'});await page.locator('#chatHistoryClose').click();await bubble.click({button:'right'});await page.waitForTimeout(350);await page.screenshot({path:'output/chat-visual/message-menu-two-rows.png'});
});

test('immediate send preserves a quote while reply validation is delayed',async({page})=>{
 await setup(page);await page.waitForTimeout(400);await page.evaluate(()=>{const base=window.xtjProtectedFetch;window.xtjProtectedFetch=async(url,options)=>{if(url.includes('/messages/reply/validate'))return new Promise(resolve=>setTimeout(async()=>resolve(await base(url,options)),1500));return base(url,options);};});
 await page.locator('[data-message-id="'+id+'"] .chat-msg').click({button:'right'});await page.getByRole('button',{name:'回复',exact:true}).click();await expect(page.locator('#chatMessageContext')).toContainText('hello world');
 await page.locator('#dockChatInput').fill('instant reply');await page.locator('#dockChatSendBtn').click();await expect.poll(()=>page.evaluate(()=>{const call=window.__chatTestCalls.find(c=>c.url.includes('/api/dm/send'));return call && JSON.parse(JSON.parse(call.body).content).reply_to?.id;})).toBe(id);
 await expect(page.locator('#chatMessageContext')).toBeHidden();await page.waitForTimeout(1600);await expect(page.locator('#chatMessageContext')).toBeHidden();
});


for (const width of [390,744,820]) {
 test(`dark homepage and Dock stay coherent at ${width}px`,async({browser})=>{
  const device=width===390 ? 'iPhone' : 'iPad';
  const context=await browser.newContext({baseURL:'http://127.0.0.1:4173',viewport:{width,height:1180},hasTouch:true,userAgent:`Mozilla/5.0 (${device}; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1`});
  const page=await context.newPage();await page.addInitScript(()=>localStorage.setItem('xtj_theme','dark'));
  await setup(page);await page.evaluate(()=>window.switchDockTab('posts',true));
  await expect(page.locator('#themeToggle .theme-toggle-orb')).toBeVisible();
  const toggle=await page.locator('#themeToggle').boundingBox(),orb=await page.locator('#themeToggle .theme-toggle-orb').boundingBox();expect(toggle.width).toBe(52);expect(orb.x+orb.width).toBeLessThanOrEqual(toggle.x+toggle.width);
  const style=await page.evaluate(()=>{const s=e=>getComputedStyle(document.querySelector(e));return {nav:s('.posts-nav').backgroundColor,dock:s('#dockBar').backgroundColor,pointer:s('#dockBar').pointerEvents,filter:s('#dockBar').backdropFilter};});
  await expect(page.locator('#statsSection')).toHaveCount(0);
  expect(style.nav).toBe('rgb(23, 23, 31)');expect(style.dock).toBe('rgba(0, 0, 0, 0)');expect(style.pointer).toBe('none');expect(style.filter).toBe('none');
  const point=await page.evaluate(()=>{const dock=document.getElementById('dockBar'),r=dock.getBoundingClientRect(),probe=document.createElement('button');probe.id='dock-underlay-probe';probe.textContent='点赞';Object.assign(probe.style,{position:'fixed',left:r.left+'px',top:r.top+'px',width:'8px',height:'8px',padding:'0',zIndex:String((parseInt(getComputedStyle(dock).zIndex)||100)-1)});probe.onclick=()=>window.__probeClicked=true;document.body.append(probe);return {x:r.left+2,y:r.top+2};});
  await page.mouse.click(point.x,point.y);expect(await page.evaluate(()=>window.__probeClicked)).toBe(true);
  await page.locator('#dock-underlay-probe').evaluate(el=>el.remove());
  await page.screenshot({path:`output/chat-visual/dark-home-${width}.png`});
  const navControl=width>=768 ? page.locator('.desktop-nav-item[data-desktop-tab="chat"]') : page.locator('#dockBar [data-tab="chat"]');
  await navControl.click();await expect(page.locator('#panelChat')).toHaveClass(/active/);
  await context.close();
 });
}

test('contact tabs never restart entrance or replace unchanged loaded rows',async({page})=>{
 await page.setViewportSize({width:744,height:1180});await page.addInitScript(()=>localStorage.setItem('xtj_theme','dark'));await setup(page);
 await page.evaluate(()=>{const base=window.xtjProtectedFetch;window.xtjProtectedFetch=async(url,options)=>{
  if(url.endsWith('/friends'))return new Response(JSON.stringify({ok:true,friends:[{peer_name:'peer',note:''}]}));
  if(url.includes('/requests?'))return new Response(JSON.stringify({ok:true,requests:[{request_id:'req-one',requester_name:'newfriend',target_name:'tester'}]}));
  if(url.endsWith('/blocks'))return new Response(JSON.stringify({ok:true,blocks:[{peer_name:'blocked'}]}));
  return base(url,options);
 };});
 await page.locator('#dockChatSocialBtn').click();await expect(page.locator('#dockChatSocialContent .chat-social-user')).toHaveCount(1);await page.waitForTimeout(350);
 for(const tab of ['friends','requests','blocks']) {
  await page.locator(`[data-chat-social-tab="${tab}"]`).click();await expect(page.locator('#dockChatSocialContent .chat-social-user')).toHaveCount(1);await page.waitForTimeout(200);
  await page.evaluate(()=>{window.__contactRow=document.querySelector('#dockChatSocialContent .chat-social-user');window.__contactAvatar=window.__contactRow.querySelector('.chat-social-avatar').firstChild;});
  await page.locator('[data-chat-social-tab="search"]').click();await page.locator(`[data-chat-social-tab="${tab}"]`).click();
  const instant=await page.locator('.chat-social-card').evaluate(el=>({opacity:getComputedStyle(el).opacity,background:getComputedStyle(el).backgroundColor,animations:el.getAnimations().length}));
  expect(instant.opacity).toBe('1');expect(instant.background).toBe('rgb(25, 45, 37)');expect(instant.animations).toBe(0);
  await page.waitForTimeout(250);expect(await page.evaluate(()=>window.__contactRow===document.querySelector('#dockChatSocialContent .chat-social-user') && window.__contactAvatar===window.__contactRow.querySelector('.chat-social-avatar').firstChild)).toBe(true);
 }
 await page.screenshot({path:'output/chat-visual/dark-contacts-stable.png'});
});

test('native microphone obeys the shared HTTP policy and both recording entry points work',async({page,browserName,request})=>{
 test.skip(browserName!=='chromium','Linux WebKit exposes no microphone capture device; native Chromium exercises policy enforcement.');
 const response=await request.get('/');expect(response.headers()['permissions-policy']).toContain('microphone=(self)');
 await page.context().grantPermissions(['microphone'],{origin:'http://127.0.0.1:4173'});await setup(page);
 const policy=await page.evaluate(()=>{const p=document.permissionsPolicy||document.featurePolicy;return {mic:p.allowsFeature('microphone'),camera:p.allowsFeature('camera')};});expect(policy).toEqual({mic:true,camera:false});
 await page.locator('#chatVoiceButton').click();await expect(page.locator('#chatVoiceButton')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#chatVoiceStatus')).toBeVisible();await page.locator('#chatVoiceCancel').click();await expect(page.locator('#dockChatInput')).toBeEnabled();
 const box=await page.locator('.chat-input-wrap').boundingBox();await page.mouse.move(box.x+30,box.y+20);await page.mouse.down();await expect(page.locator('#chatVoiceButton')).toHaveAttribute('aria-pressed','true');await page.mouse.move(box.x+30,box.y-80);await page.mouse.up();await expect(page.locator('#dockChatInput')).toBeEnabled();
 // Negative control: the former production policy must reject actual native capture.
 await page.route('**/policy-negative',route=>route.fulfill({status:200,contentType:'text/html',headers:{'Permissions-Policy':'microphone=()'},body:'<!doctype html><title>Blocked microphone control</title>'}));await page.goto('/policy-negative');
 expect(await page.evaluate(async()=>{try{const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop());return 'allowed';}catch(e){return e.name;}})).toBe('NotAllowedError');
});

test('recorder falls back when an advertised MIME format cannot be constructed',async({page})=>{
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
  window.__recorderFormats=[];window.MediaRecorder=class{static isTypeSupported(){return true;}constructor(stream,options){window.__recorderFormats.push(options?.mimeType||'default');if(options?.mimeType==='audio/mp4')throw new DOMException('Unsupported format','NotSupportedError');this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.onstop?.();}};
 });
 await setup(page);await page.locator('#chatVoiceButton').click();await expect(page.locator('#chatVoiceButton')).toHaveAttribute('aria-pressed','true');expect(await page.evaluate(()=>window.__recorderFormats)).toEqual(['audio/mp4','audio/webm;codecs=opus']);await page.locator('#chatVoiceCancel').click();await expect(page.locator('#dockChatInput')).toBeEnabled();
});

test('Safari playback-only session is switched before permission, and repeated recording works',async({page})=>{
 await page.addInitScript(()=>{
  window.__session={type:'playback'};Object.defineProperty(navigator,'audioSession',{configurable:true,value:window.__session});window.__captureCount=0;
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{async getUserMedia(){window.__captureCount++;if(navigator.audioSession.type!=='play-and-record')throw new DOMException('AudioSession category is not compatible with audio capture','InvalidStateError');return {getTracks:()=>[{stop(){}}]};}}});
  window.MediaRecorder=class{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/mp4';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['voice'],{type:'audio/mp4'})});this.onstop?.();}};
 });
 await setup(page);await expect(page.locator('#dockChatInput')).toBeEnabled();
 for(let i=0;i<3;i++){
  await page.locator('#chatVoiceButton').click();await expect(page.locator('#chatVoiceButton')).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>navigator.audioSession.type)).toBe('play-and-record');
  await page.locator('#chatVoiceCancel').click();await expect(page.locator('#dockChatInput')).toBeEnabled();
  expect(await page.evaluate(()=>navigator.audioSession.type)).toBe('auto');
 }
 expect(await page.evaluate(()=>window.__captureCount)).toBe(3);
 await page.evaluate(()=>navigator.audioSession.type='playback');
 const input=page.locator('#dockChatInput');await input.dispatchEvent('pointerdown',{button:0,pointerId:91,clientX:80,clientY:700});await page.waitForTimeout(650);
 await expect(page.locator('#chatVoiceButton')).toHaveAttribute('aria-pressed','true');
 await input.dispatchEvent('pointercancel',{pointerId:91});await expect(input).toBeEnabled();expect(await page.evaluate(()=>navigator.audioSession.type)).toBe('auto');
});

for(const width of [390,744,1194])test(`personal page has four compact records, readable paging and coherent theme at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});await setup(page);
 await page.evaluate(()=>{
  const prior=window.xtjProtectedFetch;
  window.xtjProtectedFetch=async(url,options)=>{
   if(url.includes('/api/profile/records')){
    const body=url.includes('/summary')?{ok:true,totals:{posts:12,views:31,likes:24,comments:10}}:{ok:true,items:[{id:'123e4567-e89b-42d3-a456-000000000001',post_id:'123e4567-e89b-42d3-a456-000000000002',author:'xtj',text:url.includes('before_id')?'下一页的动态':'周末去散步，记录一点日常。',comment:url.includes('comments')?'看起来很舒服':'' ,created_at:'2026-09-30T07:00:00Z',available:true}],has_more:!url.includes('before_id'),next_cursor:{at:'2026-09-30T07:00:00Z',id:'123e4567-e89b-42d3-a456-000000000001'}};
    return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
   }return prior(url,options);
  };
  window.switchDockTab('profile',true);
 });
 await expect(page.locator('#profilePostsCount')).toHaveText('12');await expect(page.locator('#profileViewsCount')).toHaveText('31');
 await expect(page.locator('#panelProfile .profile-activity-card')).toHaveCount(4);
 const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,heights:[...document.querySelectorAll('#panelProfile .profile-activity-card')].map(e=>e.getBoundingClientRect().height),avatar:document.getElementById('profileAvatar').getBoundingClientRect().toJSON()}));
 expect(metrics.scroll).toBeLessThanOrEqual(metrics.width);expect(Math.max(...metrics.heights)).toBeLessThan(100);expect(metrics.avatar.width).toBe(metrics.avatar.height);
 await page.screenshot({path:`output/social-refresh/profile-light-${width}.png`,fullPage:true});
 await page.locator('#profileViewsCard').click();await expect(page.locator('.personal-record')).toHaveCount(1);await page.locator('.profile-record-more').click();await expect(page.locator('.personal-record')).toHaveCount(2);await expect(page.locator('.profile-record-more')).toHaveCount(0);
 await page.locator('#profileActivityModal .stat-close-btn').click();
 await page.evaluate(()=>window.XTJThemeController.setMode('dark'));await page.waitForTimeout(350);await page.screenshot({path:`output/social-refresh/profile-dark-${width}.png`,fullPage:true});
 await page.locator('#profileCommentsCard').click();await expect(page.locator('.personal-record-comment')).toHaveText('我的评论 · 看起来很舒服');
 await page.screenshot({path:`output/social-refresh/records-dark-${width}.png`});
});

test('sun and moon retain clear shapes in both themes, and retired Code is absent from AI',async({page})=>{
 await setup(page);await page.evaluate(()=>window.switchDockTab('posts',true));
 await expect(page.locator('#themeToggle .theme-symbol-sun')).toHaveCSS('opacity','1');await expect(page.locator('#themeToggle .theme-symbol-moon')).toHaveCSS('opacity','0');
 await page.locator('#themeToggle').click();await expect(page.locator('#themeToggle .theme-symbol-moon')).toHaveCSS('opacity','1');await expect(page.locator('#themeToggle .theme-symbol-sun')).toHaveCSS('opacity','0');
 await page.evaluate(async()=>{await window.XTJModuleLoader.load('ai-agent');window.switchDockTab('ai-chat',true);});await expect(page.locator('#aiChatRoot')).toBeVisible();await expect(page.locator('#aiCodeToggle')).toHaveCount(0);
});

test('AAC MP4 voice plays with progressing time, and permission failure does not refresh or replace the row',async({page})=>{
 test.skip(!await page.evaluate(()=>!!document.createElement('audio').canPlayType('audio/mp4; codecs="mp4a.40.2"')),'This Chromium build omits licensed AAC; WebKit executes the AAC playback case.');
 const voice=require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/voice-aac.m4a'));
 await page.route('https://example.invalid/voice.m4a',r=>r.fulfill({status:200,contentType:'audio/mp4',body:voice}));await setup(page);
 await page.evaluate(({stamp})=>{
  const prior=window.xtjProtectedFetch;window.__voiceURLRefreshes=0;
  window.xtjProtectedFetch=async(url,options)=>{
   if(url.includes('/api/dm/messages'))return new Response(JSON.stringify({ok:true,has_more:false,data:[{id:'123e4567-e89b-42d3-a456-000000000010',user_name:'tester',media_url:'aac-peer',created_at:stamp,content:JSON.stringify({media:{kind:'audio',url:'https://example.invalid/voice.m4a',mimeType:'audio/mp4',duration:2}})}]}));
   if(url.includes('/voice-url')){window.__voiceURLRefreshes++;return new Response(JSON.stringify({ok:true,url:'https://example.invalid/voice.m4a'}));}return prior(url,options);
  };window.openChat('aac-peer');
 },{stamp});
 const player=page.locator('.chat-voice-player');await expect(player).toBeVisible();
 await player.evaluate(el=>{window.__voiceRow=el;window.__playOriginal=el.querySelector('audio').play;el.querySelector('audio').play=()=>Promise.reject(new DOMException('requires gesture','NotAllowedError'));});
 await player.locator('button').click();expect(await page.evaluate(()=>window.__voiceURLRefreshes)).toBe(0);expect(await page.evaluate(()=>window.__voiceRow===document.querySelector('.chat-voice-player'))).toBe(true);
 await player.evaluate(el=>el.querySelector('audio').play=window.__playOriginal);await player.locator('button').click();
 await expect(player).toHaveClass(/is-playing/);await expect.poll(()=>player.locator('audio').evaluate(el=>el.currentTime)).toBeGreaterThan(.2);
 expect(await player.locator('audio').evaluate(el=>el.error)).toBeNull();
});

test('damaged native recording recovers PCM and plays both before and after delivery',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await setup(page);await expect(page.locator('#dockChatInput')).toBeEnabled();
 let uploaded=null;
 await page.route('**/api/dm/upload?**',async route=>{
  uploaded=route.request().postDataBuffer();
  // WebKit's protocol omits binary XHR bodies; inspect the exact File passed to send.
  if(!uploaded || !uploaded.length)uploaded=Buffer.from(await page.evaluate(async()=>Array.from(new Uint8Array(await window.__roundtripUploadFile.arrayBuffer()))));expect(route.request().url()).toContain('mime_type=audio%2Fwav');
  return route.fulfill({json:{ok:true,storage_path:'chat/roundtrip.wav',public_url:'https://example.invalid/roundtrip.wav',kind:'audio',mime_type:'audio/wav'}});
 });
 await page.route('https://example.invalid/roundtrip.wav',route=>route.fulfill({contentType:'audio/wav',body:uploaded}));
 await page.evaluate(()=>{
  const nativeSend=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(file){window.__roundtripUploadFile=file;return nativeSend.call(this,file);};
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{async getUserMedia(){
   const ctx=new AudioContext();await ctx.resume();const oscillator=ctx.createOscillator(),gain=ctx.createGain(),dest=ctx.createMediaStreamDestination();
   oscillator.frequency.value=440;gain.gain.value=.2;oscillator.connect(gain);gain.connect(dest);oscillator.start();window.__roundtripContext=ctx;return dest.stream;
  }}});
  window.MediaRecorder=class{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/mp4';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['damaged MP4 container'],{type:'audio/mp4'})});this.onstop();}};
  const prior=window.xtjProtectedFetch;window.__deliveredVoice=null;
  window.xtjProtectedFetch=async(url,options={})=>{
   if(url.includes('/api/dm/send')){
    const body=JSON.parse(options.body);window.__deliveredVoice={id:'123e4567-e89b-42d3-a456-000000000099',user_name:'tester',media_url:'peer',created_at:new Date().toISOString(),content:JSON.stringify({type:'dm',text:'',media:{kind:'audio',url:'https://example.invalid/roundtrip.wav',mimeType:body.mime_type,duration:body.voice_duration}})};
    return new Response(JSON.stringify({ok:true,message:window.__deliveredVoice}));
   }
   if(url.includes('/api/dm/messages')&&window.__deliveredVoice)return new Response(JSON.stringify({ok:true,data:[window.__deliveredVoice],has_more:false}));
   return prior(url,options);
  };
 });
 await page.locator('#chatVoiceButton').click();await expect(page.locator('#chatRecordingIndicator')).toBeVisible();
 await expect(page.locator('#chatRecordingTimer')).toHaveText('00:01');await page.waitForTimeout(250);
 await page.locator('#chatVoiceButton').click();await expect(page.locator('#dockChatFilePreview')).toBeVisible();
 await page.locator('#dockChatSendBtn').click();await expect.poll(()=>uploaded?.length||0).toBeGreaterThan(1000);
 expect(uploaded.subarray(0,4).toString()).toBe('RIFF');expect(uploaded.subarray(8,12).toString()).toBe('WAVE');
 await expect(page.locator('#dockChatMessages [data-message-id="123e4567-e89b-42d3-a456-000000000099"]')).toBeVisible();
 const player=page.locator('#dockChatMessages .chat-voice-player');await expect(player).toBeVisible();
 await player.locator('button').click();
 await expect.poll(()=>player.locator('audio').evaluate(a=>a.currentTime)).toBeGreaterThan(.2);
 const audio=await page.evaluate(async base64=>{const bytes=await window.__roundtripContext.decodeAudioData(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)).buffer);const values=bytes.getChannelData(0);let power=0;for(const value of values)power+=value*value;return {duration:bytes.duration,rms:Math.sqrt(power/values.length)};},uploaded.toString('base64'));
 expect(audio.duration).toBeGreaterThan(.7);expect(audio.rms).toBeGreaterThan(.02);
 await player.locator('button').click();
 await page.evaluate(()=>{window.__xtjReleaseDmLocalPreview(document.querySelector('#dockChatMessages .msg-audio').src);window.openChat('other-peer');});
 await expect(page.locator('#dockChatInput')).toBeEnabled();await page.evaluate(()=>window.openChat('peer'));
 await expect(player.locator('audio')).toHaveAttribute('src','https://example.invalid/roundtrip.wav');
 await player.locator('button').click();await expect.poll(()=>player.locator('audio').evaluate(a=>a.currentTime)).toBeGreaterThan(.2);
 expect(await player.locator('audio').evaluate(a=>a.error)).toBeNull();
 await page.evaluate(()=>window.__roundtripContext.close());
});

test('undecodable recording without PCM is rejected before upload and restores input',async({page})=>{
 await fakeMic(page);await setup(page);await expect(page.locator('#dockChatInput')).toBeEnabled();
 await page.evaluate(()=>{MediaRecorder.prototype.stop=function(){this.state='inactive';this.ondataavailable({data:new Blob(['broken'],{type:'audio/mp4'})});this.onstop();};});
 await page.locator('#chatVoiceButton').click();await expect(page.locator('#chatRecordingIndicator')).toBeVisible();await page.locator('#chatVoiceButton').click();
 await expect(page.locator('#dockChatInput')).toBeEnabled();await expect(page.locator('#chatRecordingIndicator')).toBeHidden();
 await expect(page.locator('#dockChatFilePreview')).toBeHidden();
 expect(await page.evaluate(()=>window.__chatTestCalls.some(call=>call.url.includes('/api/dm/send')))).toBe(false);
});
test('chat gallery zoom occupies the full viewport, pans freely and keeps close controls clickable',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await setup(page);await page.waitForTimeout(400);
 const sharp=require('sharp'),image=await sharp({create:{width:900,height:1200,channels:3,background:'#769683'}}).jpeg().toBuffer();await page.route('https://example.invalid/gallery-photo.jpg',r=>r.fulfill({contentType:'image/jpeg',body:image}));
 await page.evaluate(({id,stamp})=>{const base=window.xtjProtectedFetch;window.xtjProtectedFetch=async(url,options)=>{if(url.includes('/api/dm/messages'))return new Response(JSON.stringify({ok:true,data:[{id,user_name:'peer',media_url:'tester',created_at:stamp,content:JSON.stringify({media:{kind:'image',url:'https://example.invalid/gallery-photo.jpg',w:900,h:1200}})}]}));if(url.includes('/history/search'))return new Response(JSON.stringify({ok:true,items:[],has_more:false}));return base(url,options);};window.openChat('peer');},{id,stamp});
 await page.locator('.msg-img').click();await expect(page.locator('#chatGallery img')).toHaveJSProperty('naturalWidth',900);await expect.poll(async()=>Math.abs((await page.locator('.chat-gallery-stage').boundingBox()).y)).toBeLessThan(.01);const stage=await page.locator('.chat-gallery-stage').boundingBox();expect(Math.abs(stage.y)).toBeLessThan(.01);expect(stage.height).toBe(844);
 await page.locator('.chat-gallery-stage').dblclick({position:{x:195,y:422}});await expect.poll(()=>page.locator('#chatGallery img').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a)).toBe(2);const enlarged=await page.locator('#chatGallery img').boundingBox();expect(enlarged.y).toBeLessThan(0);expect(enlarged.y+enlarged.height).toBeGreaterThan(844);
 await page.mouse.move(195,422);await page.mouse.down();await page.mouse.move(260,480,{steps:8});await page.mouse.up();expect(await page.locator('#chatGallery img').evaluate(e=>Math.abs(new DOMMatrix(getComputedStyle(e).transform).m41))).toBeGreaterThan(20);await page.screenshot({path:info.outputPath('chat-fullscreen-zoom.png')});await page.locator('[data-gallery="close"]').click();await expect(page.locator('#chatGallery')).toHaveCount(0);
});
