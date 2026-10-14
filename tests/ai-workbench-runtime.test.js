'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const w=require('../js/ai-core/tool-workbench');
const api=require('../render-api/ai-workbench');

test('CSV preview handles quoted multiline cells, escaped quotes, BOM, blanks and TSV',()=>{
  const t=w.parseCsv('\ufeff名称,备注,数值\r\n甲,"两行\n文字",12\r\n乙,"包含""引号",0\r\n\r\n');
  assert.deepEqual(t.headers,['名称','备注','数值']);assert.deepEqual(t.rows,[['甲','两行\n文字','12'],['乙','包含"引号','0']]);assert.equal(t.totalRows,2);
  assert.deepEqual(w.parseCsv('名称\t数值\n甲\t-1','\t').rows,[['甲','-1']]);
  assert.throws(()=>w.parseCsv('a,b\n"unclosed,x'),/未闭合/);assert.throws(()=>w.parseCsv('a\n"x"junk'),/无效/);
});
test('CSV bounds are explicit and preview keeps source row counts without fabricating cells',()=>{
  const t=w.parseCsv('a\n'+Array.from({length:5100},(_,i)=>i).join('\n'));assert.equal(t.rows.length,5000);assert.equal(t.totalRows,5100);assert.equal(t.truncated,true);
  assert.throws(()=>w.parseCsv(Array.from({length:61},(_,i)=>'c'+i).join(',')),/60 列/);
  assert.throws(()=>w.parseCsv('x'.repeat(2*1024*1024+1)),/2MiB/);
});
test('CSV export protects formula-like text while preserving real negative numbers',()=>{
  const output=w.csvStringify(['名称','数值'],[['=HYPERLINK("https://example.com")','-2.5'],['+SUM(A1)','普通,文字'],['@evil','-cmd']]);
  assert.match(output,/'=HYPERLINK/);assert.match(output,/'\+SUM/);assert.match(output,/'@evil/);assert.match(output,/'-cmd/);assert.match(output,/,-2\.5/);assert.doesNotMatch(output,/'-2\.5/);
});
test('filtering uses actual selected columns, exact numeric values, and never turns unknowns into zero',()=>{
  const table={headers:['项目','数量'],rows:[['甲','3'],['乙','未知'],['甲乙','0'],['乙','']]};
  assert.deepEqual(w.filterRows(table,0,'contains','甲'),[['甲','3'],['甲乙','0']]);assert.deepEqual(w.filterRows(table,1,'gte','0'),[['甲','3'],['甲乙','0']]);assert.deepEqual(w.filterRows(table,1,'equals','未知'),[['乙','未知']]);
});
test('bounded Excel parser output creates selectable true sheets without executing cells',()=>{
  const sheets=w.spreadsheetTables('【工作表: 销售】\n月份,金额\n一月,12\n二月,14\n\n【工作表: 库存】\n商品,数量\n甲,3');
  assert.equal(sheets.length,2);assert.equal(sheets[0].name,'销售');assert.deepEqual(sheets[1].rows,[['甲','3']]);assert.equal(sheets[0].previewOnly,true);
});
test('timeline keeps real date, excerpt and paragraph citation; invalid/missing dates are omitted',()=>{
  const events=w.extractTimeline([{name:'项目记录.txt',text:'2026年10月14日 发布候选版。\n\n2024-02-29 完成测试。\n\n2025-02-29 无效日期。\n\n10月15日 没有年份。\n\n2026/10/14 2026/10/14 重复日期。',url:'https://example.com/a'}]);
  assert.equal(events.length,3);assert.equal(events[0].date,'2024-02-29');assert.equal(events[0].source,'项目记录.txt · 段落 2');assert.match(events[0].excerpt,/完成测试/);assert.equal(events[0].url,'https://example.com/a');assert.equal(events[0].edited,false);assert.equal(w.validDate(2025,2,29),'');
});
test('decision matrix normalizes supplied weights and rejects missing or invented scores',()=>{
  const dimensions=[{name:'成本',weight:3},{name:'体验',weight:1}];
  assert.deepEqual(w.weightedDecision(dimensions,[{name:'甲',scores:[8,4]},{name:'乙',scores:[5,9]}]),[{name:'甲',score:7,scores:[8,4]},{name:'乙',score:6,scores:[5,9]}]);
  for(const scores of [[null,5],['',5],[11,2],[-1,2],['未知',2]])assert.throws(()=>w.weightedDecision(dimensions,[{name:'甲',scores}]),/评分/);
  assert.throws(()=>w.weightedDecision([{name:'成本',weight:0}],[{name:'甲',scores:[1]}]),/大于零/);
  assert.equal(w.weightedDecision([{name:'成本',weight:1e308},{name:'体验',weight:1e308}],[{name:'甲',scores:[8,4]}])[0].score,6);
});
test('Markdown export retains complete rows and captured real source dates',()=>{
  const md=w.buildMarkdown({title:'研究成果',date:'2026-10-14',headers:['项目','备注'],rows:[['甲','a|b\nc']],clips:[{text:'真实原文',url:'https://example.com/source',capturedAt:'2026-10-14T10:00:00Z'}]});
  assert.match(md,/a\\\|b<br>c/);assert.match(md,/https:\/\/example.com\/source/);assert.match(md,/摘录日期：2026-10-14T10:00:00Z/);
  const bounded=w.buildMarkdown({title:'预览',previewOnly:true,sourceLimit:'原文件5100行，仅载入5000行',steps:[{kind:'calculate',config:{expression:'2+2'},previousStatus:'done',resultText:'2+2 = 4'}]});assert.match(bounded,/仅载入5000行/);assert.match(bounded,/2\+2 = 4/);assert.match(bounded,/执行状态：done/);
});
test('workbench tool facade rejects arbitrary code, paths, unsafe protocols, unknown fields and oversized work',()=>{
  assert.deepEqual(api.validateToolInput({name:'calculate',args:{expression:'2^10'}}),{name:'calculate',args:{expression:'2^10'}});
  for(const name of ['run_code','constructor','__proto__','delete_user','read_document'])assert.throws(()=>api.validateToolInput({name,args:{}}),/不支持/);
  for(const url of ['file:///etc/passwd','http://example.com','https://user:pass@example.com','javascript:alert(1)'])assert.throws(()=>api.validateToolInput({name:'read_web_page',args:{url}}));
  assert.throws(()=>api.validateToolInput({name:'calculate',args:{expression:'1',owner_id:'victim'}}),/字段/);
  assert.throws(()=>api.validateToolInput({name:'make_chart',args:{series:[{data:Array(201).fill(1)}]}}),/200/);
  assert.throws(()=>api.validateToolInput({name:'make_file',args:{rows:Array(5001).fill([])}}),/5000/);
});
test('private assets permit bounded text/results, not credentials, originals or fake IDs',()=>{
  const value={kind:'clip',title:'摘录',data:{text:'真实内容',url:'https://example.com'}};assert.deepEqual(api.validateAsset(value).data,value.data);
  const stamp='2026-10-14T01:23:45.123456+00:00';assert.equal(api.validateAsset({...value,updated_at:stamp}).updated_at,stamp);assert.throws(()=>api.validateAsset({...value,updated_at:'not-a-timestamp'}),/时间/);
  assert.equal(api.validateAsset({kind:'workflow',title:'流程',data:{steps:[{kind:'calculate',config:{expression:'2+2'}}]}}).kind,'workflow');
  for(const data of [{api_key:'secret'},{dataUrl:'data:image/png;base64,AAA='},{image:'原文件'},{constructor:{}}])assert.throws(()=>api.validateAsset({...value,data}));
  assert.throws(()=>api.validateAsset({...value,id:'another-account'}),/标识/);assert.throws(()=>api.validateAsset({...value,data:{text:'x'.repeat(1024*1024)}}),/上限/);
});
test('upload decoder accepts canonical bounded base64 and rejects paths or invalid/oversized data',()=>{
  const decoded=api.decodeUpload({name:'../../资料.txt',dataUrl:'data:text/plain;base64,'+Buffer.from('真实资料').toString('base64')},100);assert.equal(decoded.name,'....资料.txt');assert.equal(decoded.buffer.toString(),'真实资料');
  for(const dataUrl of ['https://example.com/document','data:text/plain;base64,AAAA==','data:text/plain;base64,%20','data:text/plain;base64,'])assert.throws(()=>api.decodeUpload({dataUrl},100));
  assert.throws(()=>api.decodeUpload({dataUrl:'data:text/plain;base64,'+Buffer.alloc(101).toString('base64')},100));
});
