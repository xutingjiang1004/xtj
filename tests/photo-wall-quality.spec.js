const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');

async function fixture(page, hotfix = true) {
  await page.route('**/photo-test-fixture', route => route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="photoGrid"></div></body></html>'}));
  await page.goto('/photo-test-fixture');
  await page.addStyleTag({content: source('css/style.css') + source('css/photo-preview.css')});
  const images = await Promise.all(['#ff0000', '#00ff00', '#0000ff', '#ffff00'].map(background => sharp({create:{width:120,height:80,channels:3,background}}).png().toBuffer()));
  await page.route('**/quality-*.png', route => {
    const index = Number(route.request().url().match(/quality-(\d)/)[1]);
    return route.fulfill({contentType:'image/png', body:images[index]});
  });
  await page.addScriptTag({content:'window.showToast=function(){}; window.currentUser="tester"; window.updateAmbientBackground=function(){};'+source('js/photo-wall/preview.js')});
  if (hotfix) await page.addScriptTag({content:source('js/photo-wall/preview-hotfix.js')});
  await page.evaluate(() => window.openPhotoPreview(0, [0,1,2,3].map(i => ({id:String(i), imageUrl:location.origin+'/quality-'+i+'.png',username:'tester',timestamp:Date.now()}))));
  await expect(page.locator('#photoPreviewImage')).toHaveCSS('opacity','1');
  await expect(page.locator('#ppNextImg')).toHaveJSProperty('naturalWidth',120);
}

for (const hotfix of [false,true]) {
  test(`navigation never paints the photo beyond its incoming neighbour (hotfix=${hotfix})`, async ({page}) => {
    await fixture(page, hotfix);
    const frames = await page.evaluate(async () => {
      const samples = [];
      window.ppNextPhoto();
      const start = performance.now();
      while (performance.now() - start < 500) {
        await new Promise(requestAnimationFrame);
        const visible = [...document.querySelectorAll('.pp-slide-slot img')].filter(img => {
          const r = img.getBoundingClientRect();
          return r.right > 1 && r.left < innerWidth - 1 && getComputedStyle(img).opacity !== '0';
        });
        samples.push(visible.map(img => img.getAttribute('src')));
      }
      return samples.flat();
    });
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every(src => /quality-[01]\.png$/.test(src))).toBe(true);
    await expect(page.locator('#photoPreviewImage')).toHaveAttribute('src', /quality-1\.png$/);
    await page.evaluate(() => window.ppPrevPhoto());
    await expect(page.locator('#photoPreviewImage')).toHaveAttribute('src', /quality-0\.png$/);
  });
}

test('a child opacity transition cannot finish the slide early', async ({page}) => {
  await fixture(page, false);
  const current = await page.evaluate(() => {
    window.ppNextPhoto();
    document.getElementById('ppNextImg').dispatchEvent(new TransitionEvent('transitionend',{bubbles:true,propertyName:'opacity'}));
    return window.photoPreviewCurrent.id;
  });
  expect(current).toBe('0');
  await expect(page.locator('#photoPreviewImage')).toHaveAttribute('src', /quality-1\.png$/);
});

test('closing and reopening during navigation cancels the old destination', async ({page}) => {
  await fixture(page);
  await page.evaluate(() => {
    window.ppNextPhoto();
    window.closePhotoPreview();
    window.openPhotoPreview(0,[{id:'new',imageUrl:location.origin+'/quality-3.png',username:'tester',timestamp:Date.now()}]);
  });
  await page.waitForTimeout(650);
  await expect(page.locator('#photoPreviewImage')).toHaveAttribute('src', /quality-3\.png$/);
  expect(await page.evaluate(() => window.photoPreviewCurrent.id)).toBe('new');
});

test('touch dragging actually moves the track before committing the adjacent photo', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await fixture(page);
  const positions = await page.evaluate(async () => {
    const wrap = document.getElementById('ppImageWrapper');
    const track = document.getElementById('ppSlideTrack');
    function pointer(type,x) { wrap.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:9,pointerType:'touch',isPrimary:true,clientX:x,clientY:400})); }
    const before = track.getBoundingClientRect().left;
    pointer('pointerdown',300); pointer('pointermove',180);
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    const dragged = track.getBoundingClientRect().left;
    pointer('pointerup',120);
    return {before,dragged};
  });
  expect(positions.dragged).toBeLessThan(positions.before - 80);
  await expect(page.locator('#photoPreviewImage')).toHaveAttribute('src', /quality-1\.png$/);
});

async function uploadFixture(page, origin = '') {
  await page.route('**/upload-test-fixture', route => route.fulfill({contentType:'text/html', body:'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>'}));
  await page.goto(origin+'/upload-test-fixture');
  await page.evaluate(html => {
    const doc = new DOMParser().parseFromString(html,'text/html');
    for (const id of ['photoFileInput','pwUploadSheet','pwUploadProgressOverlay','pwUploadResult']) document.body.appendChild(doc.getElementById(id));
  },source('index.html'));
  await page.addStyleTag({content:source('css/style.css')});
  await page.addScriptTag({content:'window.currentUser="tester";window.showToast=function(){};window.getUserAuthHeaders=async()=>({});window.safeStorage={get:key=>localStorage.getItem(key),set:(key,value)=>localStorage.setItem(key,value)};'+source('js/photo-wall/upload-ui.js')});
}

test('original upload keeps its bytes and renders committed rows without waiting for wall refresh', async ({page}) => {
  const buffer = await sharp({create:{width:1600,height:900,channels:3,background:'#28553e'}}).jpeg({quality:100}).toBuffer();
  let uploaded,created;
  // WebKit does not expose every File-backed body through its route inspector.
  // Check the bytes actually received by HTTP in both browser engines.
  const server = http.createServer((req,res) => {
    const chunks=[];
    req.on('data',chunk=>chunks.push(chunk));
    req.on('end',()=>{
      const upload=req.url.startsWith('/api/photo/upload?');
      if(upload) uploaded=Buffer.concat(chunks); else created=JSON.parse(Buffer.concat(chunks).toString());
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify(upload ? {ok:true,public_url:'https://example.test/original.jpg'} : {ok:true,data:{id:'original',media_url:'https://example.test/original.jpg'}}));
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
  await uploadFixture(page,'http://127.0.0.1:'+server.address().port);
  await page.evaluate(() => {
    window.photoWallData=[];
    window.normalizePhotoWallRow=row=>({id:row.id,imageUrl:row.media_url});
    window.renderPhotoWallWithoutReload=()=>{window.__rendered=window.photoWallData.map(p=>p.id);};
    window.loadPhotoWallData=()=>new Promise(()=>{});
  });
  await page.locator('#photoFileInput').setInputFiles({name:'original.jpg',mimeType:'image/jpeg',buffer});
  await expect(page.locator('#pwUploadSheetMeta')).toContainText('原图上传');
  await page.locator('.pw-photo-caption').fill('雪山下的一天');
  await page.locator('#pwStartUploadBtn').click();
  await expect(page.locator('#pwUploadResultTitle')).toHaveText('上传成功');
  expect(created.caption).toBe('雪山下的一天');
  expect(uploaded.equals(buffer)).toBe(true);
  expect(await page.evaluate(() => window.__rendered)).toEqual(['original']);
  await expect(page.locator('#pwUploadProgressOverlay')).toBeHidden();
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
});

test('upload panel stays within a narrow dark viewport and supports reduced motion', async ({page}, testInfo) => {
  await page.setViewportSize({width:320,height:700});
  await page.emulateMedia({reducedMotion:'reduce'});
  await uploadFixture(page);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme','dark'));
  const buffer = await sharp({create:{width:12,height:12,channels:3,background:'#28553e'}}).png().toBuffer();
  await page.locator('#photoFileInput').setInputFiles({name:'photo.png',mimeType:'image/png',buffer});
  const card = page.locator('.pw-upload-sheet-card');
  await expect(card).toBeVisible();
  const bounds = await card.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await expect(card).toHaveCSS('background-color','rgb(26, 36, 32)');
  await page.screenshot({path:testInfo.outputPath('upload-dark-mobile.png')});
  expect(await card.evaluate(el => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(0.001);
});

test('a delayed original from the previous photo cannot overwrite the new photo', async ({page}) => {
  await fixture(page);
  const buffer = await sharp({create:{width:400,height:300,channels:3,background:'#905070'}}).png().toBuffer();
  await page.route('**/delayed-original.png', async route => {
    await new Promise(resolve => setTimeout(resolve,800));
    await route.fulfill({contentType:'image/png',body:buffer});
  });
  await page.evaluate(() => {
    window.closePhotoPreview();
    window.openPhotoPreview(0,[
      {id:'slow',imageUrl:location.origin+'/delayed-original.png',thumbUrl:location.origin+'/quality-0.png',username:'tester',timestamp:Date.now()},
      {id:'next',imageUrl:location.origin+'/quality-1.png',username:'tester',timestamp:Date.now()}
    ]);
    window.ppNextPhoto();
  });
  await page.waitForTimeout(1100);
  await expect(page.locator('#photoPreviewImage')).toHaveAttribute('src',/quality-1\.png$/);
  await expect(page.locator('#photoPreviewImage')).toHaveCSS('opacity','1');
  expect(await page.evaluate(() => window.photoPreviewCurrent.id)).toBe('next');
});

test('upload uses a growing stitched garden and waits for record confirmation', async ({page}, testInfo) => {
  await uploadFixture(page);
  const buffer = await sharp({create:{width:100,height:100,channels:3,background:'#28553e'}}).png().toBuffer();
  let finish;
  await page.route('**/api/photo/upload?**', async route => {
    await new Promise(resolve => {finish=resolve;});
    await route.fulfill({json:{ok:true,public_url:'https://example.test/original.png'}});
  });
  await page.route('**/api/photo/create', route => route.fulfill({json:{ok:true,data:{id:'original'}}}));
  await page.locator('#photoFileInput').setInputFiles({name:'original.png',mimeType:'image/png',buffer});
  await page.locator('#pwStartUploadBtn').click();
  await expect(page.locator('#pwUploadProgressCancel')).toBeVisible();
  await expect(page.locator('#pwUploadProgressText')).toHaveText('已完成 0 / 1 张');
  await expect(page.locator('#pwUploadGarden svg')).toBeVisible();
  await expect(page.locator('#pwUploadGarden')).toHaveClass(/is-growing/);
  await expect(page.locator('#pwUploadProgressOverlay .pw-upload-progress-spinner')).toHaveCount(0);
  const pct=Number(await page.locator('#pwUploadProgressTrack').getAttribute('aria-valuenow'));
  expect(pct).toBeGreaterThanOrEqual(0);expect(pct).toBeLessThanOrEqual(94);
  await expect(page.locator('#pwUploadProgressBytes')).toContainText('已传');
  await page.screenshot({path:testInfo.outputPath('upload-progress.png')});
  await expect.poll(() => typeof finish).toBe('function');
  finish();
  await expect(page.locator('#pwUploadResultTitle')).toHaveText('上传成功');
});

test('byte events drive progress while storage and record saving remain separate',async({page})=>{
  await uploadFixture(page);
  await page.evaluate(()=>{
    window.XMLHttpRequest=class {
      constructor(){this.upload={};window.__photoXHR=this;}
      open(){}setRequestHeader(){}send(file){this.file=file;}abort(){if(this.onabort)this.onabort();}
    };
  });
  const buffer=await sharp({create:{width:100,height:100,channels:3,background:'#28553e'}}).png().toBuffer();
  let confirm;
  await page.route('**/api/photo/create',async route=>{await new Promise(resolve=>{confirm=resolve;});await route.fulfill({json:{ok:true,data:{id:'saved'}}});});
  await page.locator('#photoFileInput').setInputFiles({name:'original.png',mimeType:'image/png',buffer});
  await page.locator('#pwStartUploadBtn').click();
  await page.waitForFunction(()=>window.__photoXHR && window.__photoXHR.file);
  await page.evaluate(()=>{const xhr=window.__photoXHR;xhr.upload.onprogress({lengthComputable:true,loaded:xhr.file.size/2,total:xhr.file.size});});
  await expect(page.locator('#pwUploadProgressTrack')).toHaveAttribute('aria-valuenow','44');
  await expect(page.locator('#pwUploadProgressStage')).toHaveText('正在上传照片…');
  await page.evaluate(()=>window.__photoXHR.upload.onload());
  await expect(page.locator('#pwUploadProgressTrack')).toHaveAttribute('aria-valuenow','88');
  await expect(page.locator('#pwUploadProgressStage')).toHaveText('正在上传照片…');
  await page.evaluate(()=>{const xhr=window.__photoXHR;xhr.status=200;xhr.responseText=JSON.stringify({ok:true,public_url:'https://example.test/original.png'});xhr.onload();});
  await expect(page.locator('#pwUploadProgressTrack')).toHaveAttribute('aria-valuenow','94');
  await expect.poll(()=>typeof confirm).toBe('function');confirm();
  await expect(page.locator('#pwUploadResultTitle')).toHaveText('上传成功');
});

test('cancelling the browser upload aborts its request and leaves a path for reconciliation',async({page})=>{
  await uploadFixture(page);let release;
  const failed=[];page.on('requestfailed',r=>{if(r.url().includes('/api/photo/upload?'))failed.push(r.url());});
  await page.route('**/api/photo/upload?**',async route=>{await new Promise(resolve=>{release=resolve;});await route.fulfill({json:{ok:true,public_url:'https://example.test/original.png'}}).catch(()=>{});});
  const buffer=await sharp({create:{width:100,height:100,channels:3,background:'#28553e'}}).png().toBuffer();
  await page.locator('#photoFileInput').setInputFiles({name:'original.png',mimeType:'image/png',buffer});
  await page.locator('#pwStartUploadBtn').click();await expect.poll(()=>typeof release).toBe('function');
  await page.locator('#pwUploadProgressCancel').click();release();
  await expect(page.locator('#pwUploadProgressOverlay')).toBeHidden();
  await expect.poll(()=>failed.length).toBe(1);
  const pending=await page.evaluate(()=>JSON.parse(localStorage.getItem('xtj_photo_upload_pending')));
  expect(pending).toHaveLength(1);expect(pending[0].path).toMatch(/^photos\//);
});

test('historical derivatives and cached thumbnails resolve to the original storage object',async({page})=>{
  await page.route('**/quality-data-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
  await page.goto('/quality-data-fixture');await page.addScriptTag({content:source('js/photo-wall/data.js')});
  const result=await page.evaluate(()=>{
    window.XTJ_CONFIG={SUPABASE_URL:'https://example.supabase.co'};
    const original='photos/upload_original.jpg';
    return window.normalizePhotoWallRow({id:'legacy',media_url:'https://example.supabase.co/storage/v1/object/public/uploads/photos/rotated/old.webp',content:JSON.stringify({storagePath:original,thumb:'https://example.supabase.co/thumbnail.webp'})});
  });
  expect(result.imageUrl).toBe('https://example.supabase.co/storage/v1/object/public/uploads/photos/upload_original.jpg');
  expect(result.thumbUrl).toBe('');expect(result.thumb).toBe('');
});

test('upload selection removes any photo, updates counts, and disables upload when empty',async({page})=>{
 await uploadFixture(page);const buffer=await sharp({create:{width:12,height:12,channels:3,background:'#28553e'}}).png().toBuffer();
 await page.locator('#photoFileInput').setInputFiles(['one.png','two.png','three.png'].map(name=>({name,mimeType:'image/png',buffer})));
 await expect(page.locator('.pw-upload-remove')).toHaveCount(3);
 await page.getByRole('textbox',{name:'照片说明：two.png',exact:true}).fill('保留下来的第二张说明');
 await page.getByRole('button',{name:'移除第 3 张照片：three.png',exact:true}).click();await expect(page.locator('#pwUploadSheetMeta')).toContainText('2 张');
 await page.getByRole('button',{name:'移除第 1 张照片：one.png',exact:true}).click();await expect(page.locator('.pw-upload-remove')).toHaveCount(1);
 await expect(page.locator('.pw-upload-remove')).toHaveAttribute('data-file-name','two.png');
 await expect(page.getByRole('textbox',{name:'照片说明：two.png',exact:true})).toHaveValue('保留下来的第二张说明');
 await page.locator('.pw-upload-remove').click();await expect(page.locator('#pwStartUploadBtn')).toBeDisabled();
 await page.locator('#photoFileInput').setInputFiles({name:'one.png',mimeType:'image/png',buffer});await expect(page.locator('#pwStartUploadBtn')).toBeEnabled();
});
for(const hotfix of [false,true])test(`preview hides unauthorized deletion and unlocks after failure and success (${hotfix})`,async({page})=>{
 await fixture(page,hotfix);
 await page.evaluate(()=>{window.__deleteCalls=[];window.showConfirm=(a,b,c,callback)=>{window.__confirm=callback;};window.deletePhotoWallPhoto=async photo=>{window.__deleteCalls.push(photo.id);if(window.__deleteFail)throw Error('network');return {ok:true};};});
 await page.locator('#ppDeleteBtn').click();await page.evaluate(()=>window.__confirm());await expect(page.locator('#photoPreviewOverlay')).not.toHaveClass(/active/);
 await page.evaluate(()=>window.openPhotoPreview(0,[{id:'next',username:'tester',imageUrl:location.origin+'/quality-1.png',timestamp:Date.now()}]));await expect(page.locator('#ppDeleteBtn')).toBeEnabled();
 await page.evaluate(()=>window.__deleteFail=true);await page.locator('#ppDeleteBtn').click();await page.evaluate(()=>window.__confirm());await expect(page.locator('#ppDeleteBtn')).toBeEnabled();await expect(page.locator('#photoPreviewOverlay')).toHaveClass(/active/);
 await page.evaluate(()=>{window.closePhotoPreview();window.currentUser='B';window.isAdmin=()=>true;window.openPhotoPreview(0,[{id:'victim',username:'A',imageUrl:location.origin+'/quality-0.png',timestamp:Date.now()}]);});
 await expect(page.locator('#ppDeleteBtn')).toBeHidden();await page.evaluate(()=>window.deletePhotoFromPreview());expect(await page.evaluate(()=>window.__deleteCalls)).toEqual(['0','next']);
 await page.evaluate(()=>{window.currentUser='xxz';window.dispatchEvent(new CustomEvent('xtj:permissions-ready'));});await expect(page.locator('#ppDeleteBtn')).toBeVisible();
});
async function albumFixture(page){
 await page.route('**/album-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><section id="panelAi" class="active"><div id="photoWallContainer"><button id="pwAlbumToggle" type="button" onclick="toggleAlbumView()">相册</button><div id="photoGrid" class="photo-wall-grid"></div></div></section>'}));await page.goto('/album-fixture');
 await page.addStyleTag({content:source('css/style.css')+source('css/visual-refinements.css')+source('css/ui-shell.css')+source('css/desktop.css')});
 const img=await sharp({create:{width:800,height:600,channels:3,background:'#6e9684'}}).jpeg().toBuffer();await page.route('**/album-photo.jpg',r=>r.fulfill({contentType:'image/jpeg',body:img}));
 await page.addScriptTag({content:source('js/photo-wall/render.js')});await page.evaluate(()=>{window.photoWallData=Array.from({length:6},(_,i)=>({id:String(i),username:'xtj',timestamp:Date.UTC(2026,9,1-Math.floor(i/2)),imageUrl:location.origin+'/album-photo.jpg'}));window.renderPhotoWallWithoutReload();});
}
test('album cards use rectangular covers and animate entering, grouping, returning and rapid toggles',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await albumFixture(page);await page.locator('#pwAlbumToggle').click();await expect(page.locator('.pw-album-card')).toHaveCount(3);
 expect(await page.locator('#photoGrid').evaluate(e=>e.getAnimations().length)).toBeGreaterThan(0);await expect(page.locator('#pwAlbumToggle')).toHaveAttribute('aria-pressed','true');await expect(page.locator('.pw-album-card').first()).toHaveCSS('border-radius','0px');await expect(page.locator('.pw-album-card').first()).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await expect(page.locator('.pw-album-cover').first()).toHaveJSProperty('naturalWidth',800);await page.waitForTimeout(240);await page.screenshot({path:info.outputPath('albums-light.png')});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:info.outputPath('albums-dark.png')});
 await page.locator('.pw-album-card').first().click();await expect(page.locator('.photo-wall-item')).toHaveCount(2);expect(await page.locator('#photoGrid').evaluate(e=>e.getAnimations().length)).toBeGreaterThan(0);await page.locator('.pw-album-back-btn').click();await expect(page.locator('.pw-album-card')).toHaveCount(3);
 await page.locator('#pwAlbumToggle').click();await expect(page.locator('.photo-wall-item')).toHaveCount(6);expect(await page.locator('#photoGrid').evaluate(e=>e.getAnimations().length)).toBeGreaterThan(0);
 await page.evaluate(()=>{for(let i=0;i<9;i++)window.toggleAlbumView();});await expect(page.locator('.pw-album-card')).toHaveCount(3);await page.waitForTimeout(260);await expect(page.locator('#photoGrid')).toHaveCSS('opacity','1');expect(await page.locator('#photoGrid').evaluate(e=>e.getAnimations().length)).toBe(0);
});
test('album transitions honor reduced motion without delaying content',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await albumFixture(page);await page.locator('#pwAlbumToggle').click();await expect(page.locator('.pw-album-card')).toHaveCount(3);expect(await page.locator('#photoGrid').evaluate(e=>e.getAnimations().length)).toBe(0);await page.locator('#pwAlbumToggle').click();await expect(page.locator('.photo-wall-item')).toHaveCount(6);
});
