const {test,expect}=require('@playwright/test');
async function setup(page){
 await page.addInitScript(()=>{localStorage.setItem('xtj_user','A');window.__voiceWorkers=[];window.Worker=class{constructor(){window.__voiceWorkers.push(this);}postMessage(data){this.data=data;setTimeout(()=>this.onmessage?.({data:{id:data.id,type:'progress',downloading:false}}),0);}terminate(){}};});
 await page.route('**/*.supabase.co/**',r=>r.fulfill({json:[]}));
 await page.route('**/api/**',r=>{const url=r.request().url();const owner=url.includes('/user/login')?JSON.parse(r.request().postData()).user_name:'A';return r.fulfill({json:{ok:true,token:'signed-'+owner,user_name:owner,is_admin:owner==='xxz',restrictions:{},data:[],items:[],conversations:[],friends:[],users:[]}});});
 await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.switchDockTab==='function' && typeof window.__xtjOpenAiChatFromDock==='function');
 await expect.poll(()=>page.evaluate(()=>window._xtjAuthState)).toBe('authenticated');
}
test('normal account can log in after a restored different account without an identity-mismatch loop',async({page})=>{
 await setup(page);await page.evaluate(()=>window.openAuthModal('login'));await page.locator('#loginNickInp').fill('B');await page.locator('#loginPwInp').fill('correct-password');await page.locator('#loginSubmitBtn').click();
 await expect.poll(()=>page.evaluate(()=>window.currentUser)).toBe('B');expect(await page.evaluate(()=>window.ensureProtectedOperationAuth())).toMatchObject({ok:true,user_name:'B'});await expect(page.locator('#loginModal')).not.toHaveClass(/active/);await expect(page.locator('#toastContainer')).not.toContainText('账号认证状态异常');
});
test('a late startup refresh cannot overwrite a successfully logged-in normal account',async({page})=>{
 let release,held=false,serverOwner='A';await page.addInitScript(()=>localStorage.setItem('xtj_user','A'));await page.route('**/*.supabase.co/**',r=>r.fulfill({json:[]}));
 await page.route('**/api/**',r=>r.fulfill({json:{ok:true,data:[],items:[],users:[],friends:[],conversations:[]}}));
 await page.route('**/api/user/refresh',async r=>{if(!held){held=true;await new Promise(resolve=>release=resolve);}await r.fulfill({json:{ok:true,token:'signed-'+serverOwner,user_name:serverOwner}});});
 await page.route('**/api/user/login',r=>{serverOwner='B';return r.fulfill({json:{ok:true,token:'signed-B',user_name:'B'}});});await page.goto('/',{waitUntil:'domcontentloaded'});await expect.poll(()=>typeof release).toBe('function');
  await page.evaluate(()=>window.openAuthModal('login'));await page.locator('#loginNickInp').fill('B');await page.locator('#loginPwInp').fill('correct-password');await page.locator('#loginSubmitBtn').click();release();await expect.poll(()=>page.evaluate(()=>window.currentUser)).toBe('B');await page.waitForTimeout(250);
 expect(await page.evaluate(()=>window.ensureProtectedOperationAuth())).toMatchObject({ok:true,user_name:'B'});expect(await page.evaluate(()=>window._xtjCanonicalUser)).toBe('B');
});
test('mobile AI keeps every Dock destination clickable and provides an independent back action',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);await page.evaluate(()=>document.documentElement.classList.add('xtj-ios-viewport'));
 await page.locator('.dock-tab[data-tab="ai-chat"]').click();await expect(page.locator('#panelAiChat')).toBeVisible();await expect(page.locator('#panelAiChat .ai-chat-back')).toBeVisible();
 for(const tab of ['posts','chat','ai','profile']){
  const button=page.locator('.dock-tab[data-tab="'+tab+'"]');await expect(button).toBeVisible();expect(await button.evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})).toBe(true);
  await button.click();await expect(page.locator('#panelAiChat')).toBeHidden();await page.locator('.dock-tab[data-tab="ai-chat"]').click();await expect(page.locator('#panelAiChat')).toBeVisible();
 }
 await page.locator('#panelAiChat .ai-chat-back').click();await expect(page.locator('#panelAiChat')).toBeHidden();await expect(page.locator('.dock-tab[data-tab="posts"]')).toBeVisible();
});
test('automatic voice transcript shows worker progress, saves text, and survives a stale reload',async({page})=>{
 await setup(page);
 const id='123e4567-e89b-42d3-a456-000000000071';
 // Real decodable PCM bytes exercise the browser decode path; inference is
 // independently validated with the actual pinned model on a public speech sample.
 const wave=Buffer.alloc(44+3200);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(16000,24);wave.writeUInt32LE(32000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(3200,40);
 await page.route('**/voice-fixture.wav',r=>r.fulfill({contentType:'audio/wav',body:wave}));
 await page.evaluate(id=>{window.__voiceSaved=[];window.xtjProtectedFetch=async(url,init={})=>{let body={ok:true,data:[],items:[],friends:[],conversations:[]};if(url.includes('/api/dm/messages'))body.data=[{id,user_name:'A',media_url:'B',media_type:'__dm__',created_at:new Date().toISOString(),content:JSON.stringify({media:{kind:'audio',url:location.origin+'/voice-fixture.wav',storage_path:'chat/voice.wav',bucket:'dm-private'}})}];else if(url.includes('/voice-url?'))body.url=location.origin+'/voice-fixture.wav';else if(url.includes('/messages/transcript')){window.__voiceSaved.push(JSON.parse(init.body));body.message={id,content:JSON.stringify({transcript:JSON.parse(init.body).text})};}else if(url.includes('/relationship?'))body.relationship={relation:'friend',can_message:true};else if(url.includes('/conversations/'))body.state={status:'ok'};return new Response(JSON.stringify(body),{status:200});};window.openChat('B');},id);
 await expect.poll(()=>page.evaluate(()=>window.__voiceWorkers[0]?.data?.id)).toBeTruthy();await expect(page.locator('.chat-transcription-status')).toContainText('正在识别语音');
 await page.evaluate(()=>{const w=window.__voiceWorkers[0];w.onmessage({data:{id:w.data.id,type:'result',text:'今天的照片很好看'}});});await expect(page.locator('.chat-transcript')).toContainText('今天的照片很好看');expect(await page.evaluate(()=>window.__voiceSaved.length)).toBe(1);
 await page.evaluate(()=>{window.openChat('another');window.openChat('B');});await expect(page.locator('.chat-transcript')).toContainText('今天的照片很好看');
});
