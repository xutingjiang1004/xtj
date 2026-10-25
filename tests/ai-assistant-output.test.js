'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {createSafeAssistantStream,splitFollowups,normalizeFollowups} = require('../render-api/ai-assistant-output');
const forbidden = text => /<\s*[|｜\s/]*(?:DSML|tool_calls?|function_calls?|invoke|parameter|plugin_info)/i.test(text);
test('followup examples inside tilde and wider backtick code fences stay literal across incremental splits',()=>{
 const {createFollowupStream}=require('../render-api/ai-assistant-output');
 for(const fence of ['~~~xml','````markdown']){
  const end=fence.startsWith('~')?'~~~':'````';
  const example=fence+'\n'+(fence.startsWith('`')?'```xml\n':'')+'<xtj-followups>["问题一？","问题二？","问题三？"]</xtj-followups>\n'+(fence.startsWith('`')?'```\n':'')+end;
  for(const make of [emit=>createFollowupStream(emit),emit=>createSafeAssistantStream({emit})])for(let split=1;split<example.length;split++){
   const chunks=[],stream=make(text=>chunks.push(text));stream.push(example.slice(0,split));stream.push(example.slice(split));const result=stream.finish();assert.equal(result.text,example);assert.equal(chunks.join(''),example);assert.deepEqual(result.followups,[]);
  }
 }
});
test('real SSE writer streams only prose and retains generated questions when the completed body was already cleaned',()=>{
 const {writeSse}=require('../render-api/sse-write'),frames=[],res={headersSent:true,writableEnded:false,_aiFollowupEnabled:true,_aiFollowupQuestion:'分析材料',write(value){frames.push(JSON.parse(value.split('data: ')[1]));return true;}};
 writeSse(res,{type:'content',text:'实际正文。\n<xtj-foll'});writeSse(res,{type:'content',text:'owups>["这是问题一吗？","这是问题二吗？","这是问题三吗？"]</xtj-followups>'});
 writeSse(res,{type:'done',complete:true,content:'实际正文。',followups:[]});
 assert.equal(frames.filter(frame=>frame.type==='content').map(frame=>frame.text).join('').trimEnd(),'实际正文。');assert.deepEqual(frames.at(-1).followups,['这是问题一吗？']);
});
test('context capacity describes the real prepared prompt and does not invent a manufacturer remaining window',()=>{
 const {contextEstimate}=require('../render-api/ai-assistant-output');
 const value=contextEstimate([{role:'system',content:'真实系统提示'},{role:'user',content:[{type:'text',text:'实际用户问题'},{type:'image_url',image_url:{url:'data:image/png;base64,YQ=='}}]}],{supplied:50,retained:19});
 assert.equal(value.history_omitted,31);assert.equal(value.image_count,1);assert.equal(value.exact_window,null);assert.ok(value.estimated_tokens>0);assert.equal(value.includes_system_prompt,true);
});
function stream() { const chunks=[];return {chunks,gate:createSafeAssistantStream({emit:value=>chunks.push(value),containsProtocol:forbidden,looksLikeArgs:text=>/^\s*\{[\s\S]*"(?:query|tool_calls|arguments)"/.test(text)})}; }
test('a JSON envelope inside an opening fenced block stays private until final classification',()=>{
 const pieces=[],gate=createSafeAssistantStream({emit:value=>pieces.push(value),containsProtocol:text=>/"tool_calls"\s*:/.test(text)});
 gate.push('```json\n');for(const c of '{"tool_calls":[{"arguments":"private"}]}\n```')gate.push(c);
 assert.equal(gate.finish().text,'');assert.equal(pieces.join(''),'');
 const benign=[],code=createSafeAssistantStream({emit:value=>benign.push(value)});code.push('```json\n');code.push('{"result":4}\n```');assert.match(code.finish().text,/result/);assert.equal(benign.join(''),'```json\n{"result":4}\n```');
});
test('fenced private JSON never leaks when every opening byte and preceding whitespace arrive separately',()=>{
  const value=' \n```json\n{"tool_calls":[{"arguments":"private parameter"}]}\n```';
  for(let split=1;split<value.length;split++){
    const pieces=[],gate=createSafeAssistantStream({emit:piece=>pieces.push(piece),containsProtocol:text=>/"tool_calls"\s*:/.test(text)});
    gate.push(value.slice(0,split));gate.push(value.slice(split));assert.equal(gate.finish().text,'');assert.equal(pieces.join('').trim(),'');
  }
  const pieces=[],gate=createSafeAssistantStream({emit:piece=>pieces.push(piece),containsProtocol:text=>/"tool_calls"\s*:/.test(text)});
  for(const char of value)gate.push(char);assert.equal(gate.finish().text,'');assert.equal(pieces.join('').trim(),'');
  const ordinary=[],code=createSafeAssistantStream({emit:piece=>ordinary.push(piece)});
  for(const char of '```js\nconst x = 1;\n```')code.push(char);
  assert.ok(ordinary.join('').includes('const x = 1;'));assert.equal(code.finish().text,'```js\nconst x = 1;\n```');
});
test('clear prose is available before upstream terminal and completion does not duplicate it',()=>{
  const {chunks,gate}=stream();gate.push('这是最早收到的正文。');assert.equal(chunks.join(''),'这是最早收到的正文。');gate.push('后续内容。');assert.equal(gate.finish().text,'这是最早收到的正文。后续内容。');assert.equal(chunks.join(''),'这是最早收到的正文。后续内容。');
});
test('every split of DSML or XML markers keeps protocol and arguments private',()=>{
  for(const markup of ['<tool_calls><invoke name="search_web">secret</invoke></tool_calls>','<｜DSML｜invoke name="x">secret</｜DSML｜invoke>','<plugin_info>secret</plugin_info>'])for(let i=1;i<markup.length;i++){
    const {chunks,gate}=stream();gate.push(markup.slice(0,i));gate.push(markup.slice(i));gate.finish();assert.equal(chunks.join(''),'');
  }
});
test('leading JSON remains private until final classification while ordinary JSON can finish',()=>{
  const bad=stream();bad.gate.push('{"query":"private');assert.equal(bad.chunks.length,0);bad.gate.push('"}');assert.equal(bad.gate.finish().text,'');
  const good=stream();good.gate.push('{"answer":42}');assert.equal(good.gate.finish().text,'{"answer":42}');assert.equal(good.chunks.join(''),'{"answer":42}');
});
test('prose before a later tool block is kept while split arguments never leak',()=>{
  const {chunks,gate}=stream();gate.push('我会查找资料。\n<to');gate.push('ol_calls>secret');gate.finish();assert.equal(chunks.join(''),'我会查找资料。\n');
});
test('followup footer is withheld at every split and returned as a single question',()=>{
  const footer='\n<xtj-followups>["问题一？","问题二？","问题三？"]</xtj-followups>';
  for(let i=1;i<footer.length;i++){const {chunks,gate}=stream();gate.push('真实回答。'+footer.slice(0,i));gate.push(footer.slice(i));const result=gate.finish();assert.equal(chunks.join(''),'真实回答。\n');assert.deepEqual(result.followups,['问题一？']);}
});
test('unfinished footer is private on interrupted output, and quoted code examples stay content',()=>{
  const {gate,chunks}=stream();gate.push('真实回答。\n<xtj-followups>["尚未');assert.equal(gate.finish().text,'真实回答。');assert.equal(chunks.join(''),'真实回答。\n');
  const code='```xml\n<xtj-followups>[]</xtj-followups>\n```';assert.equal(splitFollowups(code).text,code);
});
test('invalid, oversized and repeated followups are discarded without template padding',()=>{
  assert.deepEqual(splitFollowups('回答\n<xtj-followups>["<script>bad",'+JSON.stringify('x'.repeat(101))+']</xtj-followups>').followups,[]);
  assert.deepEqual(normalizeFollowups(['福州天气？','明天福州会下雨吗？','还有呢？'],'福州天气'),['明天福州会下雨吗？']);
});

test('weather corrections with API/source wording never manufacture programming suggestions',()=>{
 const {writeSse}=require('../render-api/sse-write');
 for(const footer of ['', '\n<xtj-followups>[]</xtj-followups>', '\n<xtj-followups>["<script>bad"]</xtj-followups>']){
  const frames=[],res={headersSent:true,_aiFollowupEnabled:true,_aiFollowupQuestion:'不对',write(value){frames.push(JSON.parse(value.split('data: ')[1]));return true;}};
  const content='福州的天气数据来自工具接口，需要核对城市、日期和来源。'+footer;
  writeSse(res,{type:'content',text:content});writeSse(res,{type:'done',content,complete:true});
  assert.deepEqual(frames.at(-1).followups,[]);assert.doesNotMatch(frames.at(-1).content,/<xtj-followups>/);
 }
});
test('one model-generated followup stays intact and incomplete replies never recommend a question',()=>{
 const {writeSse}=require('../render-api/sse-write');
 for(const complete of [true,false]){
  const frames=[],res={headersSent:true,_aiFollowupEnabled:true,_aiFollowupQuestion:'福州天气',write(value){frames.push(JSON.parse(value.split('data: ')[1]));return true;}};
  writeSse(res,{type:'done',content:'福州的天气已按查询时间说明。',complete,followups:['这次查询对应福州的什么时间？']});
  assert.deepEqual(frames.at(-1).followups,complete?['这次查询对应福州的什么时间？']:[]);
 }
});
