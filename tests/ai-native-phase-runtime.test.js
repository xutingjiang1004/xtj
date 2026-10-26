'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('render-api/server.js', 'utf8');
function section(start, end, from = 0) {
  const a = source.indexOf(start, from), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'extract actual ordinary-chat phase');
  return source.slice(a, b);
}

test('ordinary Pro chat attaches tools to its first streaming request without an extra blocking non-streaming preflight', async () => {
  const preflight = section('    var isShortMsg = message.length', '    var _sharedSearchMeta;');
  const construction = section('    var apiBody = {\n      model: usedModel,\n      messages: roundMessages,', '    // ★ H-3 修复（真正生效）');
  const requests = [], tools = [{type:'function',function:{name:'lookup'}}];
  const scope = {AbortController, setTimeout, clearTimeout, console:{error(){},log(){}},
    useThinking:false, aborted:false, workModeEnabled:true, allowSearch:true, weatherResult:null,
    message:'请阅读这个链接并对比不同资料 https://isolated.invalid/evidence', explicitSearchIntent:true, liveInfoIntent:false, siteToolIntent:false,
    messages:[{role:'user',content:'核对资料'}], usedModel:'deepseek-v4-pro', thinkingMode:'off',
    attachmentCardsStream:[],linkPrefetch:{cards:[]},T_stage:{},DEEPSEEK_API_URL:'https://isolated.invalid/chat/completions',DEEPSEEK_API_KEY:'isolated-key',
    aiToolsForSearch:()=>tools,aiToolsForWorkMode:()=>tools,fetch:async(_url,init)=>{requests.push(JSON.parse(init.body));return{ok:false};}};
  await vm.runInNewContext('(async function(){'+preflight+'\nvar roundMessages = messages;\n'+construction+'\nthis.body = apiBody;})()',scope);
  assert.equal(requests.length,0,'a redundant non-streaming request delays the actual tool-capable stream');
  assert.equal(scope.body.stream,true);assert.deepEqual(scope.body.tools,tools);assert.equal(scope.body.thinking.type,'disabled');
});

for (const kind of ['native','DSML fallback']) test(kind+': ordinary Pro tool continuation sends only the current round reasoning with its assistant call',()=>{
  const nativeStart=source.indexOf('// 先 push assistant(tool_calls)，再依次 push 各 tool 结果。');
  const fallbackStart=source.indexOf("    if (dsmlFallbackCalls && dsmlFallbackCalls.length && !aborted) {");
  const start=kind==='native'?nativeStart:fallbackStart;
  const pushStart=source.indexOf('      roundMessages.push({ role:',start);
  // Include an extracted construction if the route needs a local message variable.
  const construction=source.indexOf('      var assistantToolRoundMessage',start);
  const actualStart=construction>=0&&construction<pushStart?construction:pushStart;
  const end=source.indexOf(kind==='native'?'      for (var ti':'      for (var dti',actualStart);
  assert.ok(start>=0&&actualStart>=0&&end>actualStart);
  const scope={useThinking:true,persistentReasoning:'上一轮原文。本轮真实思考。',roundReasoningStart:'上一轮原文。'.length,
    contentBuffer:'上一轮前言。本轮前言。',roundContentStart:'上一轮前言。'.length,roundMessages:[],
    toolCallsArr:[{id:'c2',name:'lookup',args:'{}'}],dsmlFallbackCalls:[{id:'c2',type:'function',function:{name:'lookup',arguments:'{}'}}]};
  vm.runInNewContext(source.slice(actualStart,end),scope);
  const message=JSON.parse(JSON.stringify(scope.roundMessages[0]));
  assert.equal(message.reasoning_content,'本轮真实思考。','missing reasoning causes the next thinking/tool request to fail');
  assert.equal(message.content,'本轮前言。');assert.equal(message.tool_calls[0].id,'c2');
});

test('automatic Flash chat starts its model with available search tools instead of waiting for redundant legacy presearch', async () => {
  const preparation = section('      var shouldServerSearch = ', '      // ★ 修复（P0「工具调用被当成正文回复」根因之二）');
  let searches = 0;
  const scope = {workModeEnabled:true,webSearchPref:false,thirdPartySearchOk:true,allowSearch:true,blockAutoSearchForOcr:false,
    useTavilyCluster:false,hasImageOcrMsg:false,useThinking:true,proactiveSearch:true,explicitSearchIntent:true,liveInfoIntent:true,
    _preloadedQuery:'',searchCleanMessage:'核对今天的原始公告',_preloadedSearchPromise:null,userName:'isolated',req:{_searchApiCalls:{}},
    searchWebForUser:async()=>{searches++;return{results:[]};},console:{error(){}}};
  await vm.runInNewContext('(async function(){'+preparation+'})()', scope);
  assert.equal(searches,0,'the tool-capable model is unnecessarily held behind an extra search');
});

test('ordinary Pro coalescing retains thinking/answer phase order within the same received packet',()=>{
  const start=source.indexOf('    var SSE_COALESCE_MS = 40;');
  const setup=section('    var SSE_COALESCE_MS = 40;','    var pendingToolCalls = {};',start);
  const deltas=section('        if (delta.reasoning_content) {','        // 收集 tool calls',start);
  const events=[];
  const scope={Date,aborted:false,res:{writableEnded:false},setTimeout:()=>1,clearTimeout(){},scrubStreamToolProtocol:text=>text,
    writeSse:(_res,event)=>{events.push(JSON.parse(JSON.stringify(event)));return true;},
    hasReasoningContent:false,reasoningBuffer:'',persistentReasoning:'',reasoningSent:false,thinkingMode:'low',contentBuffer:'',
    deltas:[{reasoning_content:'思考第一步。'},{content:'正文第一段。'},{reasoning_content:'进一步核对。'},{content:'正文第二段。'}]};
  vm.runInNewContext(setup+'\nfor (var delta of deltas) {\n'+deltas+'\n}\nflushContentCoalesce();flushReasoningCoalesce();',scope);
  assert.deepEqual(events.filter(e=>['reasoning','content'].includes(e.type)).map(e=>[e.type,e.text]),[
    ['reasoning','思考第一步。'],['content','正文第一段。'],['reasoning','进一步核对。'],['content','正文第二段。']]);
});
