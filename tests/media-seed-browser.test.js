'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const media='/api/photo/11111111-1111-4111-8111-111111111111/media';
const original=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1cAAAAASUVORK5CYII=','base64');
test('uploader seeds verified local bytes through HEAD; preview keys stay separate and failures never restore old private files',{timeout:45000},async()=>{
  let state=200,full=0,heads=0,conditionals=0,holdHead=null;
  const tag='"'+crypto.createHash('md5').update(original).digest('hex')+'"',previewTag='"preview-v1"';
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://local');
    if(url.pathname===media){
      if(req.method==='HEAD')heads++;
      if(req.method==='HEAD'&&holdHead)await holdHead;
      if(state!==200)return res.writeHead(state,{'Cache-Control':'no-store'}).end();
      const etag=url.searchParams.has('preview')?previewTag:tag;
      if(req.headers['if-none-match']===etag){conditionals++;return res.writeHead(304,{ETag:etag,'Cache-Control':'private, no-cache'}).end();}
      if(req.method!=='HEAD')full++;
      return res.writeHead(200,{'Content-Type':'image/png','Content-Length':original.length,ETag:etag,'Cache-Control':'private, no-cache'}).end(req.method==='HEAD'?undefined:original);
    }
    if(url.pathname==='/')return res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><script src="/js/media-cache.js"></script>');
    if(['/js/media-cache.js','/chat-notifications-sw.js','/media-originals-sw.js','/media-digest.js'].includes(url.pathname))return res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-cache'}).end(fs.readFileSync(path.join(process.cwd(),url.pathname)));
    res.writeHead(404).end();
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
    const context=await browser.newContext(),page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    const seed=bytes=>page.evaluate(async({media,bytes})=>xtjSeedOriginalMedia(media,new Blob([new Uint8Array(bytes)],{type:'image/png'})),{media,bytes:Array.from(bytes)});
    assert.equal(await seed(original),true);assert.equal(heads,1);assert.equal(full,0,'no original GET after upload');
    const read=url=>page.evaluate(async url=>{const r=await fetch(url);return{status:r.status,cached:r.headers.get('X-XTJ-Media-Cache'),bytes:(await r.arrayBuffer()).byteLength}},url);
    assert.equal((await read(media)).cached,'revalidated');assert.equal(full,0);assert.equal(conditionals,1);
    assert.equal((await read(media+'?preview=1')).cached,null);assert.equal(full,1,'a preview may not reuse original bytes');
    await page.waitForFunction(async media=>!!await(await caches.open('xtj-original-media-v1')).match(media+'?preview=1'),media);
    assert.equal((await read(media+'?preview=1&xtj_retry=manual')).cached,'revalidated');assert.equal(full,1);
    await page.evaluate(()=>xtjClearOriginalMediaCache());assert.equal(await seed(Buffer.from('wrong file')),false);
    assert.equal(await page.evaluate(async media=>!!await(await caches.open('xtj-original-media-v1')).match(media),media),false);
    state=403;assert.equal(await seed(original),false);state=200;assert.equal(await seed(original),true);
    for(state of [401,402,404,503]){const denied=await read(media);assert.equal(denied.status,state);assert.equal(denied.cached,null);}
    state=200;let release;holdHead=new Promise(r=>release=r);
    const pending=seed(original);await page.waitForTimeout(100);await page.evaluate(()=>xtjClearOriginalMediaCache());release();holdHead=null;
    assert.equal(await pending,false,'logout/clear invalidates a late seeding operation');
    assert.equal(await page.evaluate(async()=> (await(await caches.open('xtj-original-media-v1')).keys()).length),0);
    await context.close();
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
