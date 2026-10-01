const {test,expect}=require('@playwright/test');
const sharp=require('sharp');
const {DISCLAIMER}=require('../render-api/author-support');
const id='123e4567-e89b-42d3-a456-000000000081';
const codeURL='https://test-codes.invalid/wechat.png';
async function setup(page,owner='tester') {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(owner=>{localStorage.setItem('xtj_user',owner);localStorage.setItem('xtj_theme','dark');},owner);
  await page.route('**/*.supabase.co/**',r=>r.fulfill({json:[]}));
  await page.route('**/api/**',r=>r.fulfill({json:{ok:true,token:'test-token',user_name:owner,data:[],posts:[],items:[],conversations:[],friends:[],users:[]}}));
  await page.route(codeURL,r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cNnsAAAAASUVORK5CYII=','base64')}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.openChat==='function' && typeof window.xtjProtectedFetch==='function');
  await page.evaluate(({owner,id,codeURL,disclaimer})=>{
    window.currentUser=owner;window.ensureUserToken=async()=> 'test';
    window.__supportCalls=[];window.__supportDelay=0;window.__voiceMissingText=false;
    window.xtjProtectedFetch=async(url,options={})=>{
      window.__supportCalls.push(url);let body={ok:true,data:[],items:[],friends:[],conversations:[]};
      if(url.includes('author-support')) {
        await new Promise(r=>setTimeout(r,window.__supportDelay));
        body={ok:true,author:'xxz',wechat_url:codeURL,alipay_url:null,disclaimer};
      } else if(url.includes('/api/dm/messages')) {
        const peer=new URL(url,location.origin).searchParams.get('target');
        if(peer==='peer')body.data=[{id,user_name:owner,media_type:'__dm__',media_url:'peer',created_at:'2026-09-30T02:00:00Z',content:JSON.stringify({kind:'audio',media:{kind:'audio',bucket:'dm-private',storage_path:'chat/owned.webm',url:''},...(window.__voiceMissingText?{}:{transcript:'这段文字离开聊天后仍然保留'})})}];
      } else if(url.includes('/relationship?')) body={ok:true,relationship:{relation:'friend',can_message:true}};
      else if(url.includes('/conversations/'))body={ok:true,state:{status:'ok',draft_revision:0}};
      else if(url.includes('/voice-url?'))body={ok:true,url:'https://test-codes.invalid/voice.webm'};
      return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
    };
    window.switchDockTab('chat',true);window.openChat('peer');
  },{owner,id,codeURL,disclaimer:DISCLAIMER});
  return errors;
}
test('only the administrator conversation offers tipping and the small dark dialog fits',async({page},info)=>{
  await page.setViewportSize({width:320,height:700});const errors=await setup(page);
  await expect(page.locator('#authorSupportButton')).toBeHidden();
  await page.evaluate(()=>window.openChat('xxz'));await expect(page.locator('#authorSupportButton')).toBeVisible();
  await page.locator('#authorSupportButton').click();const dialog=page.locator('#authorSupportDialog');
  await expect(dialog).toBeVisible();await expect(dialog.getByAltText('微信收款码')).toBeVisible();
  await expect(dialog).toContainText('作者暂未设置支付宝收款码');await expect(page.locator('#authorSupportDisclaimer')).toHaveText(DISCLAIMER);
  const b=await dialog.boundingBox();expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(320);
  expect(b.y).toBeGreaterThanOrEqual(0);expect(b.y+b.height).toBeLessThanOrEqual(700);
  await page.screenshot({path:info.outputPath('author-support-dark-mobile.png')});
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(page.locator('#authorSupportButton')).toBeFocused();
  await page.evaluate(()=>window.openChat('other-peer'));await expect(page.locator('#authorSupportButton')).toBeHidden();
  expect(errors).toEqual([]);
});
test('the administrator cannot see a self-tipping button',async({page})=>{
  const errors=await setup(page,'xxz');await page.evaluate(()=>window.openChat('xxz'));
  await expect(page.locator('#authorSupportButton')).toBeHidden();expect(errors).toEqual([]);
});
test('leaving or resetting the account closes the dialog and ignores its late response',async({page})=>{
  const errors=await setup(page);await page.evaluate(()=>window.openChat('xxz'));
  await expect(page.locator('#authorSupportButton')).toBeVisible();await page.evaluate(()=>window.__supportDelay=500);
  await page.locator('#authorSupportButton').click();await page.evaluate(()=>window.openChat('peer'));
  await page.waitForTimeout(600);await expect(page.locator('#authorSupportDialog')).toBeHidden();
  await expect(page.locator('#authorSupportCodes img')).toHaveCount(0);
  await page.evaluate(()=>{window.__supportDelay=0;window.openChat('xxz');});await page.locator('#authorSupportButton').click();
  await expect(page.locator('#authorSupportCodes img')).toHaveCount(1);
  await page.evaluate(()=>window.__xtjResetChatPanels());await expect(page.locator('#authorSupportDialog')).toBeHidden();
  expect(errors).toEqual([]);
});
test('a voice transcript survives a stale snapshot after leaving and reopening the chat',async({page})=>{
  const errors=await setup(page);const row=page.locator('[data-message-id="'+id+'"]');
  await expect(row.locator('.chat-transcript')).toContainText('这段文字离开聊天后仍然保留');
  await expect(row.locator('.chat-voice-player')).toBeVisible();
  await expect(row.locator('audio')).not.toHaveAttribute('src');
  await page.evaluate(()=>{window.__voiceMissingText=true;window.openChat('other-peer');});
  await page.evaluate(()=>window.openChat('peer'));
  await expect(row.locator('.chat-transcript')).toContainText('这段文字离开聊天后仍然保留');
  await expect(page.locator('#dockChatMessages')).not.toContainText('消息加载失败');
  await row.locator('.chat-voice-player button').click();
  await expect.poll(()=>page.evaluate(()=>window.__supportCalls.filter(url=>url.includes('/voice-url?')).length)).toBe(1);
  await expect(row.locator('.chat-transcript')).toContainText('这段文字离开聊天后仍然保留');
  expect(errors).toEqual([]);
});
test('administrator uploads the original QR image and immediately previews the new version',async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('xtj_admin_session',JSON.stringify({t:Date.now()}));localStorage.setItem('xtj_admin_tab','support');});
  const buffer=await sharp({create:{width:240,height:240,channels:3,background:'#456d5a'}}).png().toBuffer();let uploaded;
  await page.route('**/api/**',r=>r.fulfill({json:{ok:true}}));
  await page.route('**/admin/**',r=>{
    if(!new URL(r.request().url()).pathname.startsWith('/admin/'))return r.fallback();
    if(r.request().url().endsWith('/author-support')) {
      if(r.request().method()==='POST')uploaded=JSON.parse(r.request().postData());
      return r.fulfill({json:{ok:true,author:'xxz',wechat_url:uploaded?codeURL:null,alipay_url:null,disclaimer:DISCLAIMER}});
    }
    return r.fulfill({json:{ok:true,data:[],users:[],stats:{},admin_name:'xxz'}});
  });
  await page.route(codeURL,r=>r.fulfill({contentType:'image/png',body:buffer}));
  await page.goto('/admin.html');await page.locator('#tabSupportBtn').click();
  const input=page.locator('#adminSupportCodes input[aria-label="微信收款码"]');await expect(input).toBeAttached();
  await input.setInputFiles({name:'wechat.png',mimeType:'image/png',buffer});
  await expect(page.locator('#adminSupportStatus')).toHaveText('微信收款码已保存');
  expect(uploaded.provider).toBe('wechat');expect(Buffer.from(uploaded.image,'base64').equals(buffer)).toBe(true);
  await expect(page.locator('#adminSupportCodes img[alt="微信收款码"]')).toBeVisible();
});

test('prefetched support code opens immediately, supports full-screen zoom and returns to tipping dialog',async({page})=>{
 const errors=await setup(page);await page.evaluate(()=>window.openChat('xxz'));await expect(page.locator('#authorSupportButton')).toBeVisible();await page.locator('#authorSupportButton').click();await expect(page.locator('.author-support-image-button img')).toBeVisible();await page.locator('.author-support-image-button').click();await expect(page.locator('#supportCodePreview')).toBeVisible();await expect(page.locator('#supportCodePreview img')).toHaveAttribute('src',codeURL);await page.locator('#supportCodePreview img').dblclick();expect(await page.locator('#supportCodePreview img').evaluate(e=>getComputedStyle(e).transform)).not.toBe('none');await page.locator('.support-code-close').click();await expect(page.locator('#supportCodePreview')).toBeHidden();await expect(page.locator('#authorSupportDialog')).toBeVisible();await page.keyboard.press('Escape');
 await page.evaluate(()=>window.__supportDelay=500);await page.locator('#authorSupportButton').click();await expect(page.locator('.author-support-image-button img')).toBeVisible();expect(errors).toEqual([]);
});
