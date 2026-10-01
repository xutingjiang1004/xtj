const {test,expect} = require('@playwright/test');

async function setup(page, width=390) {
  await page.setViewportSize({width,height:844});
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user','viewer');
    localStorage.setItem('xtj_device_id','ui-polish-test');
  });
  await page.route('**/*.supabase.co/**',route=>route.fulfill({json:[]}));
  await page.route('**/api/**',route=> {
    const url=route.request().url();
    const data={ok:true,token:'ui-test-token',user_name:'viewer',data:[],posts:[],comments:[],likes:[],friends:[],requests:[],blocks:[],avatars:{},items:[],totals:{posts:2,views:2,likes:2,comments:2},endReached:true};
    if(url.includes('/profile/records?')) {
      data.items=[{id:'r1',post_id:'p1',available:true,author:'viewer',created_at:'2026-09-26T01:48:00Z',text:'可以正常阅读的长记录。\n第一行内容。\n第二行内容。\n第三行内容。\n第四行内容。',comment:url.includes('comments')?'完整的评论内容。\n可以自然换行。':''},{id:'r2',post_id:null,available:false,author:'',created_at:'2026-09-20T01:48:00Z',text:'此动态已删除或不可见'}];
    }
    return route.fulfill({json:data});
  });
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.switchDockTab==='function'&&window.currentUser==='viewer');
  await expect(page.locator('#authUI')).toBeVisible();
}

async function contacts(page) {
  await page.evaluate(()=>window.switchDockTab('chat'));
  await page.locator('#dockChatSocialBtn').click();
  await expect(page.locator('#dockChatSocialSheet')).toBeVisible();
}

test('contacts have no grey frame, equal tabs, working taps, dragging and keyboard',async({page},testInfo)=>{
  await setup(page);
  await contacts(page);
  const rail=page.locator('#dockChatSocialTabs');
  const buttons=rail.locator('[role=tab]');
  const widths=await buttons.evaluateAll(nodes=>nodes.map(el=>el.getBoundingClientRect().width));
  expect(Math.max(...widths)-Math.min(...widths)).toBeLessThan(1);
  await expect(page.locator('#dockChatSocialSheet')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await buttons.nth(0).click();
  await expect(buttons.nth(0)).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#dockChatSocialSearchForm')).toBeVisible();
  const box=await rail.boundingBox();
  await page.mouse.move(box.x+box.width/8,box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width*0.70,box.y+box.height/2,{steps:8});
  const sliderX=await rail.locator('.chat-social-slider').evaluate(el=>el.getBoundingClientRect().left);
  expect(sliderX).toBeGreaterThan(box.x+box.width/2);
  await page.mouse.move(box.x+box.width*0.875,box.y+box.height/2,{steps:4});
  await page.mouse.up();
  await expect(buttons.nth(3)).toHaveAttribute('aria-selected','true');
  await buttons.nth(3).focus();
  await page.keyboard.press('Home');
  await expect(buttons.nth(0)).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('ArrowRight');
  await expect(buttons.nth(1)).toHaveAttribute('aria-selected','true');
  await page.screenshot({path:testInfo.outputPath('contacts.png')});
});

for(const kind of ['posts','views','likes','comments']) {
  test(`${kind} records are left-aligned reading rows without capsules or clipping`,async({page},testInfo)=>{
    await setup(page);
    await page.evaluate(kind=>{window.switchDockTab('profile');window.toggleProfileActivity(kind);},kind);
    const body=page.locator('#profileActivityModal .personal-record-body').first();
    await expect(body).toBeVisible();
    await expect(body).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    await expect(body).toHaveCSS('border-radius','0px');
    await expect(body).toHaveCSS('text-align','left');
    const text=body.locator('.personal-record-text');
    await expect(text).toContainText('第四行内容');
    const sizes=await text.evaluate(el=>({scroll:el.scrollHeight,client:el.clientHeight}));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client+1);
    const unavailable=page.locator('.personal-record.is-unavailable .personal-record-body');
    await expect(unavailable).toBeDisabled();
    await expect(unavailable).toHaveText(/已删除或不可见/);
    if(kind==='comments') {
      await expect(body.locator('.personal-record-comment')).toHaveCSS('text-align','left');
      await expect(page.locator('.personal-record-action').first()).toHaveText('删除评论');
    }
    await expect(page.locator('#profileActivityModal .profile-activity-modal')).toHaveCSS('background-color','rgb(248, 252, 250)');
    await expect(page.locator('#profileActivityModal .profile-activity-modal')).toHaveCSS('opacity','1');
    await expect(page.locator('#profileActivityModal')).toHaveCSS('opacity','1');
    await page.screenshot({path:testInfo.outputPath(kind+'-records.png')});
  });
}

for(const width of [320,390,768,1440]) {
  test(`header separates four tools from the fixed theme/account edges at ${width}px`,async({page})=>{
    await setup(page,width);
    const nav=page.locator('.posts-nav');
    const tools=nav.locator('.posts-nav-tools');
    const icons=tools.locator('.posts-nav-icon-btn');
    await expect(icons).toHaveCount(4);
    for (const mode of ['light','dark']) {
      await page.evaluate(mode=>window.XTJThemeController.setMode(mode),mode);
      for (const icon of await icons.all()) {
        await expect(icon).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
        await expect(icon).toHaveCSS('border-width','0px');
        await expect(icon).toHaveCSS('box-shadow','none');
        await expect(icon.locator('svg')).toHaveCSS('width','18px');
        await expect(icon.locator('svg')).toHaveCSS('height','18px');
      }
    }
    const boxes=await icons.evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,right:r.right,width:r.width};}));
    const theme=await page.locator('#themeToggle').boundingBox();
    const auth=await page.locator('.nav-auth').boundingBox();
    expect(boxes[0].x).toBeGreaterThanOrEqual(theme.x+theme.width);
    expect(boxes[3].right).toBeLessThanOrEqual(auth.x+1);
    for(let i=1;i<4;i++)expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i-1].right);
    if(width<768) {
      const gaps=boxes.slice(1).map((b,i)=>b.x-boxes[i].right);
      expect(Math.max(...gaps)-Math.min(...gaps)).toBeLessThan(2);
    }
    await expect(tools.locator('.posts-nav-icon-btn').nth(3)).toHaveAttribute('id','filterToggleBtn');
    await page.locator('#filterToggleBtn').click();
    await expect(page.locator('#filterToggleBtn')).toHaveAttribute('aria-expanded','true');
    await expect(page.locator('#postFilterPanel')).toBeVisible();
  });
}

test('moon uses a complete SVG with no rectangular core background',async({page},testInfo)=>{
  await setup(page);
  await page.evaluate(()=>window.XTJThemeController.setMode('dark'));
  const moon=page.locator('#themeToggle .theme-symbol-moon');
  await expect(moon).toHaveCSS('opacity','1');
  await expect(moon).toHaveCSS('width','20px');
  await expect(moon).toHaveCSS('height','20px');
  await expect(page.locator('#themeToggle .theme-toggle-core')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(page.locator('#themeToggle .theme-toggle-core')).toHaveCSS('box-shadow','none');
  await page.locator('.posts-nav').screenshot({path:testInfo.outputPath('dark-header.png')});
});

test('account avatar opens information immediately, including switch and logout actions',async({page})=>{
  await setup(page);
  await page.locator('#myAvatar').click();
  await expect(page.locator('#profileDetailModal')).toBeVisible();
  await expect(page.locator('#profileDetailName')).toHaveText('viewer');
  await expect(page.locator('.profile-detail-switch-btn')).toBeVisible();
  await expect(page.locator('.profile-detail-logout-btn')).toBeVisible();
});

test('logout clears the account and private UI before a slow revocation response',async({page})=>{
  await setup(page);
  let release;
  await page.route('**/api/user/logout',async route=>{
    await new Promise(resolve=>{release=resolve;});
    await route.fulfill({json:{ok:true}});
  });
  await page.locator('.nav-account-logout').click();
  await expect(page.locator('#unauthUI')).toBeVisible({timeout:1500});
  await expect(page.locator('#authUI')).toBeHidden();
  expect(await page.evaluate(()=>({user:window.currentUser,saved:localStorage.getItem('xtj_user')}))).toEqual({user:'',saved:null});
  await expect.poll(()=>typeof release).toBe('function');
  release();
});

test('switch account opens login immediately and serializes new login after cookie revocation',async({page})=>{
  await setup(page);
  let release,logins=0;
  await page.route('**/api/user/logout',async route=>{
    await new Promise(resolve=>{release=resolve;});
    await route.fulfill({json:{ok:true}});
  });
  await page.route('**/api/user/login',route=>{logins++;return route.fulfill({json:{ok:false,error:'test completed'}});});
  await page.locator('#myAvatar').click();
  await page.locator('.profile-detail-switch-btn').click();
  await expect(page.locator('#loginNickInp')).toBeVisible({timeout:1500});
  await page.locator('#loginNickInp').fill('nextuser');
  await page.locator('#loginPwInp').fill('test-password');
  await page.locator('#loginSubmitBtn').click();
  expect(logins).toBe(0);
  await expect.poll(()=>typeof release).toBe('function');
  release();
  await expect.poll(()=>logins).toBe(1);
});

test('touch slider tracks the finger and cancelling returns to the selected tab',async({page,browserName})=>{
  test.skip(browserName!=='chromium','CDP touch input is only supported by Chromium.');
  await setup(page);
  await contacts(page);
  const rail=page.locator('#dockChatSocialTabs'), selected=rail.locator('[aria-selected="true"]');
  const current=await selected.getAttribute('data-chat-social-tab');
  const box=await rail.boundingBox();
  const client=await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*0.375,y:box.y+box.height/2}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*0.75,y:box.y+box.height/2}]});
  await expect(rail).toHaveClass(/is-dragging/);
  const x=await rail.locator('.chat-social-slider').evaluate(el=>el.getBoundingClientRect().x);
  expect(x).toBeGreaterThan(box.x+box.width/2);
  await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await expect(rail).not.toHaveClass(/is-dragging/);
  await expect(selected).toHaveAttribute('data-chat-social-tab',current);
});

test.describe('continuous contact touch drag',()=>{
 test.use({hasTouch:true});
 test('touch moves follow the finger, reverse immediately, snap and recover from cancellation',async({page,browserName})=>{
  test.skip(browserName!=='chromium','Chromium CDP verifies browser-generated touch input; WebKit retains pointer and tap coverage.');
  await setup(page);await contacts(page);await page.locator('[data-chat-social-tab="search"]').click();const rail=page.locator('#dockChatSocialTabs'),box=await rail.boundingBox(),cdp=await page.context().newCDPSession(page),x=box.x+box.width/8,y=box.y+box.height/2;
  async function touch(type,dx){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x:x+dx,y}],modifiers:0});}
  await touch('touchStart',0);await touch('touchMove',box.width*.55);await expect(rail).toHaveClass(/is-dragging/);const first=await rail.locator('.chat-social-slider').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m41);await touch('touchMove',box.width*.3);await expect.poll(()=>rail.locator('.chat-social-slider').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m41)).toBeLessThan(first-30);await touch('touchEnd',0);await expect(page.locator('[data-chat-social-tab="friends"]')).toHaveAttribute('aria-selected','true');
  await touch('touchStart',0);await touch('touchMove',box.width*.55);await touch('touchCancel',0);await expect(rail).not.toHaveClass(/is-dragging/);await expect(page.locator('[data-chat-social-tab="friends"]')).toHaveAttribute('aria-selected','true');
 });
});
