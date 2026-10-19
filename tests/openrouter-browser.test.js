'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {aiPolishFixture,openModelPicker,models}=require('./helpers/ai-polish-fixture');
const managed={uid:'or_minimax_m31_free',provider:'openrouter',model:'minimax/minimax-m3.1-flash:free',base_url:'https://openrouter.ai/api/v1',label:'MiniMax M3.1 Flash 免费版',provider_label:'OpenRouter',server_managed:true};
async function fixture(t,options={}){const f=await aiPolishFixture({serverModels:[managed],...options});t.after(()=>f.close());return f;}
async function picker(p){await p.waitForFunction(()=>!document.querySelector('#aiPlusPanelShell')?.classList.contains('is-closing'));if(await p.locator('.ai-plus-btn').getAttribute('aria-expanded')!=='true')await p.locator('.ai-plus-btn').click();await p.locator('[data-action="open-model"]').click();}
async function openTemplate(p){await picker(p);await p.getByRole('option',{name:'＋ 添加自定义模型',exact:true}).click();await p.locator('#aiCmProvider').selectOption('openrouter');}
async function selectFree(p){await openTemplate(p);await p.locator('#aiCmSaveBtn').click();await p.waitForSelector('#aiCustomModelModal',{state:'detached'});}
test('existing model UI keeps DeepSeek default and uses a backend-only free preset with no browser key', {timeout:45000},async t=>{
  const f=await fixture(t,{serverModels:[{...managed,api_key:'must-never-cache-this-unexpected-field'}]}),p=f.page;
  await p.waitForFunction(()=>aiPolish.calls.some(c=>c.path.endsWith('/custom-models')));
  assert.equal(await p.evaluate(()=>localStorage.getItem('xtj_ai_model')||'deepseek-flash'),'deepseek-flash');
  await openTemplate(p);assert.equal(await p.locator('#aiCmApiKey').isDisabled(),true);assert.equal(await p.locator('#aiCmApiKey').inputValue(),'');
  assert.equal(await p.locator('#aiCmModel').inputValue(),managed.model);assert.equal(await p.locator('#aiCmModel').getAttribute('readonly'),'');assert.equal(await p.locator('#aiCmBase').getAttribute('readonly'),'');
  assert.match(await p.locator('#aiCmProviderNote').textContent(),/每日|频率/);
  await p.locator('#aiCmCheckBtn').click();await p.waitForFunction(()=>aiPolish.calls.some(c=>c.path.endsWith('/models/check')));
  const check=await p.evaluate(()=>aiPolish.calls.find(c=>c.path.endsWith('/models/check')).body);assert.equal(check.model_uid,managed.uid);assert.equal(check.api_key,undefined);
  await p.locator('#aiCmSaveBtn').click();await p.waitForSelector('#aiCustomModelModal',{state:'detached'});
  await p.locator('#aiChatMsgInput').fill('普通对话使用免费模型');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  const req=await p.evaluate(()=>({path:aiPolish.streams[0].path,body:aiPolish.streams[0].body}));assert.equal(req.path,'/api/agent/custom-chat/stream');assert.equal(req.body.model,managed.model);assert.equal(req.body.model_uid,managed.uid);assert.equal(req.body.api_key,undefined);
  await p.evaluate(()=>{aiPolishEmit({type:'content',text:'真实模拟的流式正文。'});aiPolishEmit({type:'done',content:'真实模拟的流式正文。',model:'minimax/minimax-m3.1-flash:free',saved:true,complete:true});aiPolish.streams.at(-1).controller.close();});
  await p.waitForFunction(()=>!document.querySelector('.ai-msg.generating'));
  const storage=await p.evaluate(()=>JSON.stringify({...localStorage}));assert.doesNotMatch(storage,/must-never-cache|api_key|server_managed/);
  assert.equal(await p.evaluate(()=>aiPolish.calls.filter(c=>c.method==='PUT').length),0);assert.deepEqual(f.errors,[]);
});
test('managed model does not consume the twenty saved slots or enter pending account snapshots', {timeout:45000},async t=>{
  const f=await fixture(t,{models:models(20),modelWriteStatus:503}),p=f.page;await selectFree(p);await openTemplate(p);
  assert.equal(await p.locator('.ai-cm-item').count(),21);const row=p.locator('.ai-cm-item').filter({hasText:'MiniMax M3.1 Flash 免费版'});assert.equal(await row.locator('.ai-cm-item-del').isVisible(),false);
  await p.locator('#aiCmProvider').selectOption('qwen');assert.equal(await p.locator('#aiCmApiKey').isDisabled(),false);assert.equal(await p.locator('#aiCmModel').getAttribute('readonly'),null);
  await p.locator('#aiCmApiKey').fill('isolated-only-key');await p.locator('#aiCmSaveBtn').click();assert.match(await p.locator('#aiCmFeedback').textContent(),/最多保存 20/);
  await p.locator('.ai-cm-item').filter({hasText:'本地模型0 ·'}).locator('.ai-cm-item-edit').click();await p.locator('#aiCmLabel').fill('更新原有配置');await p.locator('#aiCmSaveBtn').click();
  await p.waitForFunction(()=>aiPolish.calls.some(c=>c.method==='PUT'));
  const pending=await p.evaluate(()=>JSON.parse(localStorage.getItem('xtj_ai_models_pending__alice')));assert.equal(pending.models.length,20);assert.equal(pending.models.some(m=>m.provider==='openrouter'||m.server_managed),false);
  assert.deepEqual(f.errors,[]);
});
test('free model stop cancels existing stream and an account switch clears the private model catalog', {timeout:45000},async t=>{
  const f=await fixture(t),p=f.page;await selectFree(p);await p.locator('#aiChatMsgInput').fill('停止这次回复');await p.locator('#aiChatSendBtn').click();await p.waitForFunction(()=>aiPolish.streams.length===1);
  await p.locator('#aiChatPauseBtn').click();await p.waitForFunction(()=>aiPolish.streams[0].signal.aborted);
  await p.evaluate(()=>{__xtjAbortAiRequests();aiPolish.serverModels=[];window.currentUser='bob';window._authStateEpoch++;window.dispatchEvent(new Event('auth-ready'));__xtjOpenAiChat();});
  await p.waitForSelector('#aiChatMsgInput');await picker(p);assert.equal(await p.getByRole('option',{name:/MiniMax M3.1 Flash 免费版/}).count(),0);assert.deepEqual(f.errors,[]);
});
test('research selects the same free reference and quota errors end without retrying another model', {timeout:45000},async t=>{
  const f=await fixture(t),p=f.page;await selectFree(p);await p.locator('#aiDeepThinkToggle').click();
  const select=p.locator('.dt-research-model-select');
  await select.locator('option[value="custom:'+managed.uid+'"]').waitFor({state:'attached'});
  await select.selectOption('custom:'+managed.uid);await p.locator('#dtInput').fill('请深入研究这个主题并核对来源');await p.locator('#dtSendBtn').click();
  await p.waitForFunction(()=>aiPolish.streams.length===1);assert.equal(await p.evaluate(()=>aiPolish.streams[0].body.research_model),'custom:'+managed.uid);
  await p.evaluate(()=>{aiPolishEmit({type:'error',code:'OPENROUTER_FREE_LIMIT',error:'免费请求额度已用完，请等待恢复'});aiPolish.streams[0].controller.close();});
  await p.waitForFunction(()=>document.querySelector('#dtMessages').textContent.includes('免费请求额度已用完'));
  assert.equal(await p.evaluate(()=>aiPolish.streams.length),1);assert.deepEqual(f.errors,[]);
});
test('a missing managed credential preserves the chosen free model instead of switching to paid defaults', {timeout:45000},async t=>{
  const f=await fixture(t),p=f.page;await selectFree(p);await p.locator('#aiDeepThinkToggle').click();await p.locator('.dt-research-model-select').selectOption('custom:'+managed.uid);
  await p.locator('#dtBackBtn').click();
  await p.evaluate(()=>{aiPolish.serverModels=[];__xtjAiAgent.close();__xtjAiAgent.open();});
  await p.waitForSelector('#aiChatMsgInput');await picker(p);
  assert.equal(await p.evaluate(()=>localStorage.getItem('xtj_ai_model')),'custom:'+managed.uid);
  assert.match(await p.locator('#aiModelSummary').textContent(),/MiniMax/);
  await p.keyboard.press('Escape');await p.keyboard.press('Escape');await p.locator('#aiDeepThinkToggle').click();
  assert.equal(await p.locator('.dt-research-model-select').inputValue(),'custom:'+managed.uid);assert.match(await p.locator('.dt-research-model-select option:checked').textContent(),/暂不可用/);
  assert.deepEqual(f.errors,[]);
});
