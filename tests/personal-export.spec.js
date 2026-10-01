const {test,expect}=require('@playwright/test'),fs=require('fs');
const code=fs.readFileSync(require.resolve('../js/ux-features.js'),'utf8'),start=code.indexOf('  async function exportMyData()'),end=code.indexOf('  function injectProfileSettings()',start);
async function fixture(page){
 await page.route('**/export-fixture',r=>r.fulfill({contentType:'text/html',body:'<button id="xtjExportDataBtn">导出</button><span id="status"></span>'}));await page.goto('/export-fixture');
 await page.addScriptTag({content:code.slice(start,end)+`window.currentUser='A';window.showToast=(text)=>document.getElementById('status').textContent=text;window.__export=exportMyData;window.xtjProtectedFetch=async path=>{var url=new URL(path,location.origin),kind=url.searchParams.get('kind'),after=Number(url.searchParams.get('after')||0);var rows=kind==='posts'?Array.from({length:225},(_,k)=>({id:k+1,user_name:'A',content:'记录'+k})).filter(r=>r.id>after):[];return new Response(JSON.stringify({ok:true,kind,snapshot:'2026-01-01T00:00:00Z',items:rows.slice(0,200),has_more:rows.length>200,next_cursor:rows.length>200?200:null,account:kind==='profile'?{user_name:'A',registered_at:'2020-01-01'}:null}));};document.getElementById('xtjExportDataBtn').onclick=exportMyData;`});
}
test('export reads every server page and category before creating its download',async({page})=>{
 await fixture(page);const downloadPromise=page.waitForEvent('download');await page.locator('#xtjExportDataBtn').click();const download=await downloadPromise,payload=JSON.parse(fs.readFileSync(await download.path(),'utf8'));expect(payload.data.posts).toHaveLength(225);expect(payload.counts.posts).toBe(225);expect(payload.account.registered_at).toBe('2020-01-01');expect(Object.keys(payload.data)).toHaveLength(12);await expect(page.locator('#xtjExportDataBtn')).toBeEnabled();
});
test('export cannot create a partial success download after failure or a switched account',async({page})=>{
 await fixture(page);let downloads=0;page.on('download',()=>downloads++);
 await page.evaluate(()=>window.xtjProtectedFetch=async()=>new Response(JSON.stringify({ok:false,error:'服务暂不可用'}),{status:503}));await page.locator('#xtjExportDataBtn').click();await expect(page.locator('#status')).toHaveText('服务暂不可用');expect(downloads).toBe(0);
 await page.evaluate(()=>window.xtjProtectedFetch=async()=>{window.currentUser='B';return new Response(JSON.stringify({ok:true,items:[],snapshot:'2026-01-01'}));});await page.locator('#xtjExportDataBtn').click();await expect(page.locator('#status')).toContainText('账号已切换');expect(downloads).toBe(0);await expect(page.locator('#xtjExportDataBtn')).toBeEnabled();
});
