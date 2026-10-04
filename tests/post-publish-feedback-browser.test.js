'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {postBrowserFixture} = require('./helpers/post-browser-fixture');

for (const [width,height,theme] of [[320,760,'light'],[390,844,'light'],[1024,768,'dark'],[1366,900,'light']]) {
  test(width+'px '+theme+': upload feedback fills two stable rows without squeezing controls or changing the Dock', {timeout:45000}, async () => {
    const f = await postBrowserFixture({counts:[3],realUploads:true,viewport:{width,height},theme});
    try {
      const {page} = f;
      await page.route('**/test-supabase/storage/v1/object/uploads/**', r => r.continue());
      await page.route('**/test-supabase/storage/v1/object/public/uploads/**', r => r.fulfill({body:f.png,contentType:'image/png'}));
      await page.locator('#fileInp').setInputFiles({name:'original.png',mimeType:'image/png',buffer:f.png});
      const before = await page.evaluate(() => ({height:document.getElementById('publishBox').offsetHeight,dock:[dockBar.offsetWidth,dockBar.offsetHeight]}));
      await page.locator('#pubBtn').click();
      await page.waitForFunction(() => Number(document.querySelector('#pubBtn [role="progressbar"]')?.getAttribute('aria-valuenow')) === 90);
      const geometry = await page.evaluate(() => {
        const box = selector => {const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};
        return {button:box('#pubBtn'),svg:box('#pubBtn .pw-garden svg'),track:box('#pubBtn [role="progressbar"]'),
          photo:box('.publish-footer .file-label'),visibility:box('#postVisibility'),label:box('.post-compose-label'),controls:box('.post-compose-controls'),
          height:publishBox.offsetHeight,dock:[dockBar.offsetWidth,dockBar.offsetHeight],overflow:document.body.scrollWidth>innerWidth};
      });
      assert.ok(geometry.button.h >= 80, 'feedback must use both toolbar rows');
      assert.ok(geometry.svg.h >= 58 && geometry.svg.w >= 60, 'garden must escape the generic 23px SVG rule');
      assert.ok(geometry.track.w >= 65 && geometry.track.h >= 5);
      assert.ok(geometry.button.x >= geometry.photo.right + 4, 'upload feedback must not cover the file picker');
      assert.ok(geometry.visibility.right <= geometry.button.x, 'visibility must stay outside the feedback area');
      assert.ok(geometry.label.h < 20, 'visibility label must remain on one line');
      assert.ok(Math.abs(geometry.controls.bottom - geometry.button.bottom) < 1);
      assert.equal(geometry.height,before.height,'upload state must not change the composer height');
      assert.deepEqual(geometry.dock,before.dock); assert.equal(geometry.overflow,false);
      assert.equal(f.storageRequests.length,1); assert.ok(f.storageRequests[0].body.includes(f.png));
      assert.equal(await page.locator('#pwUploadProgressOverlay').evaluate(e => e.classList.contains('active')),false);
      f.releaseStorageResponses();
      await page.waitForFunction(() => !pubBtn.disabled && !selectedPostMedia.length);
      assert.equal(await page.locator('#pubBtn [role="progressbar"]').count(),0); assert.deepEqual(f.errors,[]);
    } finally {await f.close()}
  });
}

for (const theme of ['light','dark']) {
  test(theme+': post tools animate both ways, reverse interrupted motion and retain all real actions', {timeout:45000}, async () => {
    const f = await postBrowserFixture({counts:[3],theme});
    try {
      const {page} = f;
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.evaluate(() => {document.documentElement.setAttribute('data-xtj-motion','full');window.testPostTools=[];
        window.requestPostTranslation=id => testPostTools.push(['translate',id]);
        window.openPostAiChat=id => testPostTools.push(['ask-ai',id]);
        window.openPostReport=id => testPostTools.push(['report',id]);
      });
      const trigger = page.locator('#feed .post-tools-trigger').first();
      // Read the animation in the same event task; a busy CI browser may finish
      // the 190ms opening before a second Playwright round trip arrives.
      const opening = await trigger.evaluate(button => {button.click();const e=document.querySelector('.post-tools-menu');return {duration:e.getAnimations()[0]?.effect.getTiming().duration,frames:e.getAnimations()[0]?.effect.getKeyframes(),items:Array.from(e.querySelectorAll('[data-post-tool]')).map(b => b.dataset.postTool)}});
      assert.equal(opening.duration,190); assert.equal(opening.frames[0].opacity,'0'); assert.equal(opening.frames.at(-1).opacity,'1');
      assert.deepEqual(opening.items,['translate','ask-ai','report']);
      const interrupted = await page.evaluate(() => {
        const menu=document.querySelector('.post-tools-menu'),trigger=document.querySelector('#feed .post-tools-trigger');
        window.closePostToolsMenu();
        const closeDuration=menu.getAnimations()[0]?.effect.getTiming().duration;
        const closing={inert:menu.inert,pointerEvents:getComputedStyle(menu).pointerEvents,expanded:trigger.getAttribute('aria-expanded')};
        trigger.click();
        return {closeDuration,closing,sameNode:document.querySelector('.post-tools-menu')===menu,count:document.querySelectorAll('.post-tools-menu').length,expanded:trigger.getAttribute('aria-expanded'),inert:menu.inert};
      });
      assert.equal(interrupted.closeDuration,150); assert.deepEqual(interrupted.closing,{inert:true,pointerEvents:'none',expanded:'false'});
      assert.equal(interrupted.sameNode,true); assert.equal(interrupted.count,1); assert.equal(interrupted.expanded,'true'); assert.equal(interrupted.inert,false);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.post-tools-menu'));
      for (const action of ['translate','ask-ai','report']) {
        await trigger.click(); await page.locator('[data-post-tool="'+action+'"]').click();
        await page.waitForFunction(() => !document.querySelector('.post-tools-menu'));
      }
      const id=f.posts[0].id; assert.deepEqual(await page.evaluate(() => testPostTools),[['translate',id],['ask-ai',id],['report',id]]);
      await trigger.click(); await page.evaluate(() => document.getElementById('panelPosts').dispatchEvent(new Event('scroll')));
      await page.waitForFunction(() => !document.querySelector('.post-tools-menu'));
      await trigger.click(); await page.evaluate(() => window.__xtjResetPostState());
      assert.equal(await page.locator('.post-tools-menu').count(),0,'account reset must remove all menu layers immediately');
      assert.deepEqual(f.errors,[]);
    } finally {await f.close()}
  });
}

test('post tools respect reduced motion and keep dismissal usable', {timeout:45000}, async () => {
  const f=await postBrowserFixture({counts:[3]});
  try {const {page}=f;await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#feed .post-tools-trigger').first().click();
    assert.equal(await page.locator('.post-tools-menu').evaluate(e => e.getAnimations().length),0);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.post-tools-menu').count(),0); assert.deepEqual(f.errors,[]);
  } finally {await f.close()}
});
