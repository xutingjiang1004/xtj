'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const source=fs.readFileSync('js/core-parts/04-posts-interactions.js','utf8');
function part(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
const options={headless:true,args:['--no-sandbox'],executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)};
test('built browser IP rules and actual post renderer keep server states, coarse public labels and chosen places separate',{timeout:30000},async()=>{
 const browser=await chromium.launch(options);try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main><h1>帖子 IP 显示回归</h1><p>隔离测试数据 · 使用实际帖子渲染函数与构建后的共用规则</p><section id="cases"></section></main>');
  await page.addStyleTag({path:'css/style.min.css'});
  await page.addStyleTag({content:'html,body{height:auto;overflow:visible;scroll-behavior:auto}body{display:block!important;margin:0;background:#f5f6fa}main{max-width:860px;margin:auto;padding:24px;box-sizing:border-box}h1{font-size:24px}p{color:#5b6270;font-size:13px}#cases{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}.post{margin:0;padding:20px;background:white;border:1px solid #dce0e7;border-radius:14px}.post h2{font-size:15px;margin:0 0 16px;color:#1f2937}.post-location-info{margin:0}.post-ip-region{color:#596273;font-size:13px;line-height:1.6}'});
  await page.addScriptTag({path:'js/ip-city-data.min.js'});await page.addScriptTag({path:'js/ip-location.min.js'});
  await page.evaluate(()=>{window.escapeHtml=value=>{const el=document.createElement('span');el.textContent=String(value);return el.innerHTML;};window.normalizePost=value=>value;window.postInfoCache={};});
  await page.addScriptTag({content:part('            function syncPostInfoCache(', '            let feedVisiblePostsCache')+part('            function postNeedsIpRefresh(', '            function refreshPublishedPostCard(')+part('            function buildPostLocationHtml(', '            // 供 core-parts/06')});
  const cases=[
   ['resolved','多源城市仅在后台可见',{ip_region_status:'resolved',ip_province:'浙江',ip_city:'湖州',ip_region_text:'浙江 湖州'},'IP属地：浙江'],
   ['pending','待解析时不会提前显示旧省市',{ip_region_status:'pending',ip_province:'广东',ip_city:'深圳',ip_region_text:'广东 深圳'},'IP属地：解析中'],
   ['failed','失败后不会复活内容中的旧地点',{ip_region_status:'failed',ip_region_text:null,ip_province:null,_contentMeta:{ip_province:'广东',ip_city:'深圳'}},'IP属地：未知'],
   ['legacy','仅有历史内容元数据',{_contentMeta:{ip_region_text:'广东 深圳',ip_province:'广东'}},'IP属地：历史未核对'],
   ['gps','主动选择的地点独立显示',{location_name:'用户选择地点',ip_region_status:'resolved',ip_province:'安徽',ip_city:'宿州'},'IP属地：安徽'],
   ['empty','服务端空值覆盖旧内容声明',{ip_region_status:null,ip_region_text:null,ip_province:null,_contentMeta:{ip_province:'广东',ip_city:'深圳'}},'']
  ];
  await page.evaluate(cases=>{document.getElementById('cases').innerHTML=cases.map(([id,title,data])=>{syncPostInfoCache({...data,id});const saved=postInfoCache[id];return '<article id="'+id+'" class="post visible"><h2>'+escapeHtml(title)+'</h2>'+buildPostLocationHtml(saved)+'</article>';}).join('');},cases);
  for(const [id,_title,_data,expected] of cases){assert.equal(await page.locator('#'+id+' .post-ip-region').count(),expected?1:0);if(expected)assert.equal(await page.locator('#'+id+' .post-ip-region').innerText(),expected);}
  assert.equal(await page.locator('#gps .post-location-display').innerText().then(value=>value.replace(/\s+/g,' ')),'📍 用户选择地点');
  assert.doesNotMatch(await page.locator('#cases').innerText(),/湖州|深圳|宿州/);
  assert.deepEqual(await page.evaluate(()=>[postNeedsIpRefresh(postInfoCache.pending),postNeedsIpRefresh(postInfoCache.failed),postNeedsIpRefresh(postInfoCache.resolved)]),[true,false,false]);
  for(const width of [1440,375]){
   await page.setViewportSize({width,height:width===375?812:1000});await page.evaluate(()=>scrollTo(0,0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.ok(await page.locator('h1').evaluate(el=>el.getBoundingClientRect().top)>=0);
   for(const [id] of cases)assert.equal(await page.locator('#'+id).evaluate(el=>getComputedStyle(el).opacity),'1');
   const directory=process.env.XTJ_ADMIN_FIX_SCREENSHOTS;if(directory){fs.mkdirSync(directory,{recursive:true});await page.screenshot({path:path.join(directory,'ip-full-posts-'+width+'.png'),fullPage:true,animations:'disabled'});}
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
