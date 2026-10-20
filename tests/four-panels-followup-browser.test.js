'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { postBrowserFixture, wireAiChat } = require('./helpers/post-browser-fixture');

test('image AI history retains the user line breaks, code indentation and original attachment', {timeout:45000}, async()=>{
  const f=await postBrowserFixture({counts:[1]});
  try {
    await wireAiChat(f.page);
    const text='请检查图片和代码：\n```js\nfunction value() {\n  return 42;\n}\n```\n\n第二段说明';
    const image='data:image/png;base64,'+f.png.toString('base64');
    await f.page.evaluate(({text,image})=>{
      window.mockAiHistory=[{id:'formatted-image',role:'user',content:text,vision_urls:[image]}];
      __xtjCloseAiChat();__xtjOpenAiChat();
    },{text,image});
    await f.page.waitForFunction(()=>Array.from(document.querySelectorAll('#aiChatMessagesArea .ai-msg')).some(n=>n._msgRef?.id==='formatted-image'));
    const content=await f.page.evaluate(()=>Array.from(document.querySelectorAll('#aiChatMessagesArea .ai-msg')).find(n=>n._msgRef?.id==='formatted-image')._msgRef);
    assert.ok(content.content.startsWith(text+'\n'),'restoring an image turn must preserve the actual formatted question');
    assert.equal(content.attachments[0].data_url,image);
    assert.deepEqual(f.errors,[]);
  } finally {await f.close();}
});

test('post critique retains partial output and offers retry when the server reports a stream interruption', {timeout:45000}, async()=>{
  const f=await postBrowserFixture({counts:[1]});
  try {
    let calls=0;
    await f.page.route('**/api/agent/post-chat/stream',route=>{
      calls++;
      const body=calls===1?'event: delta\ndata: {"content":"已经收到的锐评正文"}\n\nevent: error\ndata: {"partial":true,"error":"stream_interrupted"}\n\n'
        :'event: message\ndata: {"content":"重试后完整的锐评"}\n\nevent: done\ndata: {}\n\n';
      return route.fulfill({contentType:'text/event-stream',body});
    });
    await f.page.evaluate(id=>openPostAiChat(id),f.posts[0].id);
    await f.page.waitForSelector('.post-tool-critique.is-error');
    assert.match(await f.page.locator('.post-tool-critique').textContent(),/已经收到的锐评正文/);
    assert.match(await f.page.locator('.post-tool-critique').textContent(),/中断/);
    await f.page.evaluate(id=>openPostAiChat(id),f.posts[0].id);
    await f.page.waitForFunction(()=>document.querySelector('.post-tool-critique')?.textContent==='重试后完整的锐评');
    assert.equal(calls,2);assert.deepEqual(f.errors,[]);
  } finally {await f.close();}
});

test('post critique accepts split CRLF events and marks an early EOF without losing its partial text', {timeout:45000}, async()=>{
  const f=await postBrowserFixture({counts:[1]});
  try {
    await f.page.evaluate(()=>{
      const base=fetch;window.fetch=(url,options)=>new URL(url,location.href).pathname==='/api/agent/post-chat/stream'
        ?Promise.resolve(new Response(new ReadableStream({start(controller){
          ['event:delta\r','\ndata:{"content":"第一段"}\r','\n\r','\nevent:delta\r\ndata:{"content":"第二段"}\r\n\r\n'].forEach(chunk=>controller.enqueue(new TextEncoder().encode(chunk)));
          controller.close();
        }}),{headers:{'Content-Type':'text/event-stream'}})):base(url,options);
    });
    await f.page.evaluate(id=>openPostAiChat(id),f.posts[0].id);
    await f.page.waitForSelector('.post-tool-critique.is-error');
    assert.match(await f.page.locator('.post-tool-critique').textContent(),/第一段第二段/);
    assert.match(await f.page.locator('.post-tool-critique').textContent(),/中断/);
    assert.deepEqual(f.errors,[]);
  } finally {await f.close();}
});

async function galleryFixture(){
  const messages=[0,1].map(i=>({id:'44444444-4444-4444-8444-00000000000'+i,user_name:'bob',media_url:'alice',media_type:'__dm__',content:JSON.stringify({type:'dm',text:'',media:{kind:'image',url:'/test-image/0-'+i+'.png',name:'photo.png',w:400,h:300}}),created_at:'2026-10-20T00:00:0'+i+'Z'}));
  const f=await postBrowserFixture({counts:[1],dmMessages:messages}),p=f.page;
  await p.route('**/api/dm/messages**',r=>r.fulfill({json:{ok:true,data:messages}}));
  await p.route('**/api/chat/relationship**',r=>r.fulfill({json:{ok:true,relationship:{status:'friends',can_message:true}}}));
  await p.route('**/api/chat/history/search**',r=>r.fulfill({json:{ok:true,items:[],has_more:false}}));
  await p.locator('[data-tab="chat"]').filter({visible:true}).first().click();
  await p.locator('.chat-list-item[data-chat-user="bob"]').click();
  await p.locator('#dockChatMessages .chat-msg img').first().click();
  await p.waitForFunction(()=>document.querySelector('#chatGallery img')?.naturalWidth>0);
  return f;
}

test('a post critique transport timeout does not leave a permanent thinking placeholder', {timeout:45000}, async()=>{
  const f=await postBrowserFixture({counts:[1]});
  try {
    await f.page.evaluate(async id=>{
      const base=fetch;window.fetch=(url,options)=>new URL(url,location.href).pathname==='/api/agent/post-chat/stream'
        ?Promise.reject(new DOMException('Transport deadline','AbortError')):base(url,options);
      openPostAiChat(id);await new Promise(requestAnimationFrame);
    },f.posts[0].id);
    assert.equal(await f.page.locator('.post-tool-critique').evaluate(node=>node.classList.contains('is-error')),true);
    assert.doesNotMatch(await f.page.locator('.post-tool-critique').textContent(),/正在锐评/);
    assert.deepEqual(f.errors,[]);
  } finally {await f.close();}
});

test('chat picture save stays bound to the chosen picture while the viewer moves to the next one', {timeout:45000}, async()=>{
  const f=await galleryFixture();let release;
  try {
    const p=f.page,gate=new Promise(resolve=>release=resolve);let saving=false;
    await p.route('**/test-image/0-0.png',async route=>{
      if(route.request().resourceType()!=='fetch')return route.continue();
      saving=true;await gate;return route.fulfill({body:f.png,contentType:'image/png'}).catch(()=>{});
    });
    const download=p.waitForEvent('download');
    await p.locator('#chatGallery [data-gallery="save"]').click();
    await p.waitForFunction(()=>document.querySelector('#chatGallery [data-gallery="save"]').disabled);
    assert.equal(saving,true);
    await p.locator('#chatGallery [data-gallery="next"]').click();release();
    const saved=await download;
    assert.equal(saved.suggestedFilename(),'chat-photo-0.png');
    assert.deepEqual(fs.readFileSync(await saved.path()),f.png);
    assert.deepEqual(f.errors,[]);
  } finally {if(release)release();await f.close();}
});

test('closing chat picture preview aborts its pending save without a late download or error toast', {timeout:45000}, async()=>{
  const f=await galleryFixture();
  try {
    const p=f.page;
    await p.evaluate(()=>{
      const base=fetch;window.saveAborted=false;window.savePending=false;
      window.fetch=(url,options)=>new URL(url,location.href).pathname==='/test-image/0-0.png'
        ?new Promise((resolve,reject)=>{savePending=true;if(options?.signal)options.signal.addEventListener('abort',()=>{saveAborted=true;reject(new DOMException('Stopped','AbortError'));},{once:true});}):base(url,options);
    });
    await p.locator('#chatGallery [data-gallery="save"]').click();await p.waitForFunction(()=>savePending);
    await p.locator('#chatGallery [data-gallery="close"]').click();
    assert.equal(await p.evaluate(()=>saveAborted),true,'leaving preview must release its owned transfer');
    assert.equal(await p.locator('.toast').filter({hasText:'图片暂时无法保存'}).count(),0);
    assert.deepEqual(f.errors,[]);
  } finally {await f.close();}
});

test('late chat picture history cannot pull the viewer back after the user has moved to another image', {timeout:45000}, async()=>{
  const f=await galleryFixture();
  try {
    const p=f.page;
    await p.evaluate(()=>{
      document.getElementById('chatGallery').__close();
      const base=fetch;window.fetch=(url,options)=>new URL(url,location.href).pathname==='/api/chat/history/search'
        ?new Promise(resolve=>{window.deliverGalleryHistory=()=>resolve(new Response(JSON.stringify({ok:true,has_more:false,items:[{message_id:'44444444-4444-4444-8444-000000000999',sent_at:'2026-10-19T00:00:00Z',payload:{media:{kind:'image',url:'/test-image/0-9.png'}}}]}),{headers:{'Content-Type':'application/json'}}));}):base(url,options);
      const image=document.querySelector('#dockChatMessages .chat-msg img');openChatGallery(image.src,image);
    });
    await p.waitForFunction(()=>!!window.deliverGalleryHistory);
    await p.locator('#chatGallery [data-gallery="next"]').click();
    await p.evaluate(()=>deliverGalleryHistory());
    await p.waitForFunction(()=>document.querySelector('.chat-gallery-title')?.textContent.includes('/ 3'));
    assert.match(await p.locator('#chatGallery img').getAttribute('src'),/\/test-image\/0-1\.png$/);
    assert.deepEqual(f.errors,[]);
  } finally {await f.close();}
});

test('a stale photo batch failure cannot replace the loading control of a newly selected sort', {timeout:45000}, async()=>{
  const f=await postBrowserFixture({counts:[1]});
  try {
    const p=f.page;
    await p.evaluate(()=>{window.IntersectionObserver=undefined;});
    await p.addScriptTag({path:'js/photo-wall/render.js'});
    await p.evaluate(()=>{
      photoWallData=[{id:'wall-a',username:'alice',imageUrl:location.origin+'/test-image/0-0.png',timestamp:Date.now()}];
      window.pwSortKey='date_desc';window.hasMorePhotos=()=>true;
      window.loadMorePhotos=()=>new Promise((resolve,reject)=>{window.rejectOldBatch=reject;});
      renderPhotoWallWithoutReload();window.oldBatch=showNextPhotoBatch();
      window.pwSortKey='name';renderPhotoWallWithoutReload();
      window.newBatchLabel=document.querySelector('#photoGrid .pw-load-more-indicator').textContent;
    });
    await p.evaluate(async()=>{rejectOldBatch(Error('old request failed'));await oldBatch;});
    assert.equal(await p.locator('#photoGrid .pw-load-more-indicator').textContent(),await p.evaluate(()=>newBatchLabel));
    assert.deepEqual(f.errors,[]);
  } finally {await f.close();}
});

test('photo batch navigation still advances when its own successful page refreshes the current view', {timeout:45000}, async()=>{
  const f=await postBrowserFixture({counts:[1]});
  try {
    const p=f.page;
    await p.evaluate(()=>{window.IntersectionObserver=undefined;});
    await p.addScriptTag({path:'js/photo-wall/render.js'});
    await p.evaluate(image=>{
      photoWallData=Array.from({length:500},(_,i)=>({id:'wall-'+i,username:'alice',imageUrl:image,timestamp:1000000-i}));
      window.pwSortKey='date_desc';window.hasMorePhotos=()=>true;
      window.loadMorePhotos=async()=>{
        const next={id:'wall-next',username:'alice',imageUrl:image,timestamp:1};
        photoWallData.push(next);renderPhotoWallWithoutReload({preserveBatch:true});return[next];
      };
      renderPhotoWallWithoutReload();
      return showNextPhotoBatch();
    },'data:image/png;base64,'+f.png.toString('base64'));
    assert.equal(await p.locator('#photoGrid .photo-wall-item').count(),1);
    assert.equal(await p.locator('#photoGrid .photo-wall-item').getAttribute('data-photo-id'),'wall-next');
    assert.deepEqual(f.errors,[]);
  } finally {await f.close();}
});

test('a same-view photo repaint still receives its pending page without forcing another fetch', {timeout:45000}, async()=>{
  const f=await postBrowserFixture({counts:[1]});
  try {
    const p=f.page;await p.evaluate(()=>{window.IntersectionObserver=undefined;});await p.addScriptTag({path:'js/photo-wall/render.js'});
    await p.evaluate(image=>{
      photoWallData=[{id:'first',username:'alice',imageUrl:image,timestamp:10}];window.pwSortKey='date_desc';window.hasMorePhotos=()=>true;
      window.loadMorePhotos=()=>new Promise(resolve=>{window.deliverPage=()=>{const row={id:'second',username:'alice',imageUrl:image,timestamp:1};photoWallData.push(row);resolve([row]);};});
      renderPhotoWallWithoutReload();window.__xtjPhotoWallLoadMore();renderPhotoWallWithoutReload();
    },'data:image/png;base64,'+f.png.toString('base64'));
    await p.evaluate(async()=>{deliverPage();await new Promise(requestAnimationFrame);});
    assert.equal(await p.locator('#photoGrid .photo-wall-item').count(),2);
    assert.deepEqual(f.errors,[]);
  } finally {await f.close();}
});

test('returning to a previous photo batch is not undone by an older pending next-batch request', {timeout:45000}, async()=>{
  const f=await postBrowserFixture({counts:[1]});
  try {
    const p=f.page;await p.evaluate(()=>{window.IntersectionObserver=undefined;});await p.addScriptTag({path:'js/photo-wall/render.js'});
    await p.evaluate(async image=>{
      photoWallData=Array.from({length:1000},(_,i)=>({id:'wall-'+i,username:'alice',imageUrl:image,timestamp:1000000-i}));
      window.pwSortKey='date_desc';window.hasMorePhotos=()=>true;
      window.loadMorePhotos=()=>new Promise(resolve=>{window.deliverNextBatch=()=>{const next={id:'later',username:'alice',imageUrl:image,timestamp:1};photoWallData.push(next);resolve([next]);};});
      renderPhotoWallWithoutReload();await showNextPhotoBatch();window.waitingNextBatch=showNextPhotoBatch();showPreviousPhotoBatch();
      deliverNextBatch();await waitingNextBatch;
    },'data:image/png;base64,'+f.png.toString('base64'));
    assert.equal(await p.locator('#photoGrid .photo-wall-item').first().getAttribute('data-photo-id'),'wall-0');
    assert.deepEqual(f.errors,[]);
  } finally {await f.close();}
});
