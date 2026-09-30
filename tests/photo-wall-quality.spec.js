const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');

async function fixture(page, hotfix = true) {
  await page.route('**/photo-test-fixture', route => route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="photoGrid"></div></body></html>'}));
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

async function uploadFixture(page) {
  await page.route('**/upload-test-fixture', route => route.fulfill({contentType:'text/html', body:'<!doctype html><html><body></body></html>'}));
  await page.goto('/upload-test-fixture');
  await page.evaluate(html => {
    const doc = new DOMParser().parseFromString(html,'text/html');
    for (const id of ['photoFileInput','pwUploadSheet','pwUploadProgressOverlay','pwUploadResult']) document.body.appendChild(doc.getElementById(id));
  },source('index.html'));
  await page.addStyleTag({content:source('css/style.css')});
  await page.addScriptTag({content:'window.currentUser="tester";window.showToast=function(){};window.getUserAuthHeaders=async()=>({});'+source('js/photo-wall/upload-ui.js')});
}

test('original upload keeps its bytes and renders committed rows without waiting for wall refresh', async ({page}) => {
  await uploadFixture(page);
  const buffer = await sharp({create:{width:1600,height:900,channels:3,background:'#28553e'}}).jpeg({quality:100}).toBuffer();
  let uploaded;
  await page.route('**/api/photo/upload?**', route => {
    uploaded = route.request().postDataBuffer();
    return route.fulfill({json:{ok:true,public_url:'https://example.test/original.jpg'}});
  });
  await page.route('**/api/photo/create', route => route.fulfill({json:{ok:true,data:{id:'original',media_url:'https://example.test/original.jpg'}}}));
  await page.evaluate(() => {
    window.photoWallData=[];
    window.normalizePhotoWallRow=row=>({id:row.id,imageUrl:row.media_url});
    window.renderPhotoWallWithoutReload=()=>{window.__rendered=window.photoWallData.map(p=>p.id);};
    window.loadPhotoWallData=()=>new Promise(()=>{});
  });
  await page.locator('#photoFileInput').setInputFiles({name:'original.jpg',mimeType:'image/jpeg',buffer});
  await expect(page.locator('#pwUploadSheetMeta')).toContainText('原图上传');
  await page.locator('#pwStartUploadBtn').click();
  await expect(page.locator('#pwUploadResultTitle')).toHaveText('上传成功');
  expect(uploaded.equals(buffer)).toBe(true);
  expect(await page.evaluate(() => window.__rendered)).toEqual(['original']);
  await expect(page.locator('#pwUploadProgressOverlay')).toBeHidden();
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

test('upload progress uses a single calm indicator and offers cancellation', async ({page}, testInfo) => {
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
  await expect(page.locator('#pwUploadProgressTrack')).toHaveAttribute('aria-valuenow','0');
  await page.screenshot({path:testInfo.outputPath('upload-progress.png')});
  await expect.poll(() => typeof finish).toBe('function');
  finish();
  await expect(page.locator('#pwUploadResultTitle')).toHaveText('上传成功');
});
