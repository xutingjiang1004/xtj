'use strict';
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVxkAAAAASUVORK5CYII=','base64');
async function postBrowserFixture({viewport={width:390,height:844},theme='light',engine='chromium',counts=[2,3,4,9,15,18],holdImages=false}={}){
 const root=path.resolve('.'),mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.mjs':'application/javascript'};
 const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname.startsWith('/test-image/')){const colors=['#71b8a3','#d3a579','#849ebe','#c78998'];const index=Number(pathname.match(/-(\d+)\.png$/)?.[1]||0)%colors.length;const svg='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="'+colors[index]+'"/><circle cx="300" cy="70" r="45" fill="#ffffff" opacity=".55"/><path d="M0 300L150 120L400 300Z" fill="#163e35" opacity=".4"/></svg>';res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'max-age=3600'}).end(svg);return;}
  const file=path.join(root,pathname==='/'?'index.html':pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(data);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 let browser;try{browser=await (engine==='webkit'?webkit:chromium).launch(engine==='webkit'?{headless:true}:{executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});}catch(error){server.close();throw error;}
 const page=await browser.newPage({viewport});let releaseImages;const imageWait=new Promise(resolve=>releaseImages=resolve);const calls=[],errors=[],uploads=new Set();let failUploadAt=0,uploadNumber=0,failCreate=false,created=null;
 const posts=counts.map((count,n)=>({id:`8c1cb02d-74d0-4e45-9e15-${String(n+1).padStart(12,'0')}`,user_name:'alice',content:`${count} 张图片：正文和媒体排版`,media_type:count>1?'album':'image',media_url:origin+'/test-image/'+n+'-0.png',visibility:'private',created_at:'2026-10-03T12:00:00.000Z',views:4,ip_region_text:'福建',ip_region_status:'resolved',media_items:Array.from({length:count},(_,i)=>({id:`attachment-${n}-${i}`,position:i,media_type:'image',media_url:origin+`/test-image/${n}-${i}.png`,width:400,height:300,file_size:png.length}))}));
 const comments=Array.from({length:6},(_,i)=>({id:`33333333-3333-4333-8333-${String(i+1).padStart(12,'0')}`,post_id:posts[0].id,user_name:i===2?'cat_ai':'alice',generated_by_ai:i===2,parent_comment_id:i===1?`33333333-3333-4333-8333-000000000001`:null,content:'评论 '+i,created_at:`2026-10-03T12:0${i}:00.000Z`})),likes=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(theme=>{localStorage.setItem('xtj_user','alice');localStorage.setItem('xtj_theme',theme);},theme);
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(holdImages&&url.pathname.startsWith('/test-image/'))await imageWait;if(url.origin!==origin){await route.abort();return;}
  if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/test-supabase/')){await route.continue();return;}
  const body=route.request().postData()?(()=>{try{return route.request().postDataJSON()}catch(_){return null}})():null;calls.push({path:url.pathname,body});
  let data={ok:true,data:[],users:[],items:[],totals:{posts:posts.length,views:4,likes:0,comments:comments.length}},status=200;
  if(url.pathname==='/api/config/public')data={supabase_url:origin+'/test-supabase',supabase_anon_key:'sb_publishable_test_only_never_production'};
  if(url.pathname==='/api/user/refresh')data={token:'test-only-token',user_name:'alice'};
  if(url.pathname==='/api/feed')data={ok:true,posts,comments,likes,next_offset:posts.length,next_cursor:null,endReached:true,total_post_count:posts.length};
  if(url.pathname==='/api/avatar/batch')data={ok:true,avatars:{}};
  if(url.pathname==='/api/post/like'){const liked=body.liked;const i=likes.findIndex(l=>l.post_id===body.post_id&&l.user_name==='alice');if(liked&&i<0)likes.push({id:'like-'+body.post_id,post_id:body.post_id,user_name:'alice'});if(!liked&&i>=0)likes.splice(i,1);data={ok:true,liked,like_count:likes.filter(l=>l.post_id===body.post_id).length};}
  if(url.pathname==='/api/post/comment'){const comment={id:'33333333-3333-4333-8333-000000009999',post_id:body.post_id,user_name:'alice',content:body.content,created_at:'2026-10-03T12:20:00.000Z'};comments.push(comment);data={ok:true,data:comment};}
  if(url.pathname==='/api/post/view')data={ok:true,views:4};
  if(url.pathname==='/api/post/delete'){const index=posts.findIndex(p=>p.id===body.post_id);if(index>=0)posts.splice(index,1);data={ok:true,deleted:true,post_id:body.post_id};}
  if(url.pathname.startsWith('/api/post/detail/')){const post=posts.find(p=>p.id===url.pathname.split('/').at(-1));data={ok:true,post:{...post,like_count:likes.filter(l=>l.post_id===post.id).length,comment_count:comments.filter(c=>c.post_id===post.id).length},likes:likes.filter(l=>l.post_id===post.id),comments:comments.filter(c=>c.post_id===post.id)};}
  if(url.pathname==='/api/post/media/prepare')data={ok:true,storage_path:body.storage_path,upload_id:body.upload_id};
  if(url.pathname==='/api/post/media/cleanup'){uploads.delete(body.storage_path);data={ok:true};}
  if(url.pathname.startsWith('/test-supabase/storage/v1/object/uploads/')){uploadNumber++;const path=url.pathname.slice('/test-supabase/storage/v1/object/uploads/'.length);if(failUploadAt===uploadNumber){status=500;data={statusCode:'500',error:'Upload failed',message:'Injected upload failure'};}else{uploads.add(path);data={Key:'uploads/'+path};}}
  else if(url.pathname.startsWith('/test-supabase/'))data=[];
  if(url.pathname==='/api/post/create'){if(failCreate){status=503;data={ok:false,error:'Injected create failure'};}else{created={id:'8c1cb02d-74d0-4e45-9e15-000000009999',user_name:'alice',...body,media_items:body.attachments||undefined,created_at:'2026-10-03T12:30:00.000Z',ip_region_text:'福建',ip_region_status:'resolved',location_name:'福州'};data={ok:true,data:created};}}
  await route.fulfill({status,json:data});
 });
 await page.goto(origin,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.currentUser==='alice'&&document.querySelector('#feed .post-media-grid img'));
 await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
 return{page,posts,comments,likes,calls,errors,uploads,origin,png,releaseImages, setFailUploadAt(n){failUploadAt=n;uploadNumber=0;},setFailCreate(v){failCreate=v;},getCreated(){return created;},async close(){await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
module.exports={postBrowserFixture};
