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
        await new Promise(r => setTimeout(r,window.__chatSearchDelay));
        const more = url.includes('cursor_id');
        result = {ok:true,items:[{message_id:id,peer_name:'peer',sender_name:'tester',body:more?'second page':'hello world',sent_at:stamp,message_type:'text'}],has_more:!more,next_cursor_at:stamp,next_cursor_id:id};
      } else if (url.includes('/history/context')) { const current={...message,content:JSON.stringify({text:window.__chatContextText})};result={ok:true,data:[current],focus_id:id}; }
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
  await setup(page); await page.locator('#chatSearchButton').click();
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
  await setup(page); await page.evaluate(()=>window.__chatSearchDelay=600);
  await page.locator('#chatSearchButton').click(); await page.locator('#chatHistoryQuery').fill('hello');
  await page.locator('#chatHistoryForm').dispatchEvent('submit'); await page.locator('#chatHistoryClose').click();
  await page.waitForTimeout(750); await expect(page.locator('#chatHistoryPanel')).toBeHidden();
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

test('archive separates the current-user list and reactions use the selected message', async ({page}) => {
  await setup(page); await page.waitForTimeout(800);
  await page.evaluate(()=>window.__xtjApplyConversationSnapshot([
    {peer_name:'active-peer',last_message:'active',last_message_at:new Date().toISOString()},
    {peer_name:'archived-peer',last_message:'archived',archived_at:new Date().toISOString()}
  ]));
  await expect(page.locator('#dockChatList [data-chat-user="active-peer"]')).toHaveCount(1);
  await expect(page.locator('#dockChatList [data-chat-user="archived-peer"]')).toHaveCount(0);
  await page.locator('#chatArchiveButton').click();
  await expect(page.locator('#dockChatList [data-chat-user="archived-peer"]')).toHaveCount(1);
  await expect(page.locator('#dockChatList [data-chat-user="active-peer"]')).toHaveCount(0);
  await page.locator('[data-message-id="'+id+'"] .chat-msg').click({button:'right'});
  await page.getByRole('button',{name:'回应',exact:true}).click();
  await page.locator('.chat-reaction-picker button').filter({hasText:'👍'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__chatTestCalls.some(c=>c.url.includes('/messages/reactions')&&c.body&&JSON.parse(c.body).emoji==='👍'))).toBe(true);
});

test('editing while viewing a search result updates the existing history window', async ({page}) => {
  await setup(page); await page.locator('#chatSearchButton').click(); await page.locator('#chatHistoryQuery').fill('hello');
  await page.locator('#chatHistoryForm').dispatchEvent('submit'); await page.locator('.chat-history-jump').first().click();
  await expect(page.locator('[data-message-id="'+id+'"]')).toContainText('hello world');
  await page.evaluate((id)=>{window.__chatContextText='remote edit';window.__xtjRefreshChatMessageExtras({kind:'edit',peer:'peer',message_id:id});},id);
  await expect(page.locator('[data-message-id="'+id+'"]')).toContainText('remote edit');
});

test('a remote clear removes messages from a focused search window', async ({page}) => {
  await setup(page); await page.locator('#chatSearchButton').click(); await page.locator('#chatHistoryQuery').fill('hello');
  await page.locator('#chatHistoryForm').dispatchEvent('submit'); await page.locator('.chat-history-jump').first().click();
  await expect(page.locator('[data-message-id="'+id+'"]')).toBeVisible();
  await page.evaluate(()=>{window.__chatMessagesGone=true;window.__xtjRefreshChatMessageExtras({kind:'clear',peer:'peer'});});
  await expect(page.locator('[data-message-id="'+id+'"]')).toHaveCount(0);
});
