'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {execute}=require('./helpers/ai-tool-executor'),helpers=require('../render-api/tool-helpers');

test('text equality and inequality filter actual distinct names without comparing invalid numeric conversions',async()=>{
  const rows=[{姓名:'张三'},{姓名:'李四'},{姓名:'王五'}];
  const equal=await execute('sort_filter',{rows,filter_field:'姓名',filter_op:'==',filter_value:'张三'});
  assert.equal(equal.returned,1);assert.match(equal.content,/张三/);assert.doesNotMatch(equal.content,/李四|王五/);
  const unequal=await execute('sort_filter',{rows,filter_field:'姓名',filter_op:'!=',filter_value:'张三'});
  assert.equal(unequal.returned,2);assert.match(unequal.content,/李四/);assert.match(unequal.content,/王五/);
});
test('unknown numeric cells never become zero and invalid relational targets fail explicitly',async()=>{
  const rows=[{金额:null},{金额:''},{金额:'未知'},{金额:false},{金额:0},{金额:'0.0'},{金额:-1}];
  const filtered=await execute('sort_filter',{rows,filter_field:'金额',filter_op:'<=',filter_value:'0'});
  assert.equal(filtered.returned,3);assert.doesNotMatch(filtered.content,/未知|false/);
  const invalid=await execute('sort_filter',{rows,filter_field:'金额',filter_op:'>',filter_value:'未知'});assert.match(invalid.error,/不是有效数字/);
  const defaultOperator=await execute('sort_filter',{rows:[{金额:1},{金额:3}],filter_field:'金额',filter_value:'2'});assert.equal(defaultOperator.returned,1);
});
test('deduplication preserves values matching Object prototype names and still removes genuine duplicates',async()=>{
  const result=await execute('sort_filter',{rows:['constructor','toString','__proto__','普通','普通'].map(值=>({值})),distinct_by:'值'});
  assert.equal(result.returned,4);for(const value of ['constructor','toString','__proto__'])assert.ok(result.content.includes(value));
});
test('numeric string sorting handles decimals, leading zeros, exponents and formatted amounts',async()=>{
  const result=await execute('sort_filter',{rows:['10.0','2.0','001','1,200','3e1'].map(金额=>({金额})),sort_by:'金额',order:'asc'});
  const values=result.content.split('\n').filter(line=>/^\| (?:10\.0|2\.0|001|1,200|3e1) \|$/.test(line));
  assert.deepEqual(values,['| 001 |','| 2.0 |','| 10.0 |','| 3e1 |','| 1,200 |']);
});
test('batch calculations report unknown fields as errors and keep real zero in valid-row statistics',async()=>{
  const result=await execute('batch_calc',{rows:[{price:'未知',qty:5},{price:null,qty:5},{price:0,qty:5},{price:'12.5',qty:2}],formula:'price*qty'});
  assert.equal(result.error_count,2);assert.match(result.content,/合计 25，平均 12\.5/);assert.match(result.content,/不是有效数字/);
});
test('batch and ordinary arithmetic agree on precedence, unary signs and exponent associativity',async()=>{
  for(const [expression,expected] of [['2*3^2',18],['2^3^2',512],['-2^2',-4],['(-2)^2',4],['2^-2',.25],['2^2*3+1',13],['1e2+2',102]]) {
    assert.equal(helpers.evaluateFormula(expression,{}),expected,expression);
    assert.equal((await execute('calculate',{expression})).cards[0].data.result,expected,expression);
  }
  for(const expression of ['1.2.3+4','1..2','1e+','1/0','sqrt(-1)','constructor(1)'])assert.throws(()=>helpers.evaluateFormula(expression,{}),undefined,expression);
  assert.ok(Math.abs(helpers.evaluateFormula('单价 * 数量 * (1 + 0.13)',{单价:'100.00',数量:3})-339)<1e-9);
});
test('numeric parsing rejects missing, trailing junk and invalid grouping while retaining actual numeric formats',()=>{
  for(const value of [null,undefined,false,{},'', '未知','12元','1,2',Infinity])assert.ok(Number.isNaN(helpers.toNum(value)),String(value));
  for(const [value,expected] of [['￥1,200.50',1200.5],['35%',35],['.5',.5],['1e2',100],['0.0',0]])assert.equal(helpers.toNum(value),expected);
});
test('CSV/TSV conversion writes exactly one header and retains quoted delimiters and rows',async()=>{
  let result=await execute('convert_data',{from:'csv',to:'tsv',data:'姓名,金额\n"张,三",10'});assert.equal((result.content.match(/姓名\t金额/g)||[]).length,1);assert.match(result.content,/张,三\t10/);assert.equal(result.row_count,1);
  result=await execute('convert_data',{from:'tsv',to:'csv',data:'姓名\t金额\n张三\t10'});assert.equal((result.content.match(/姓名,金额/g)||[]).length,1);
  result=await execute('convert_data',{from:'csv',to:'json',data:'姓名,金额\n张三,10'});assert.match(result.content,/"姓名": "张三"/);
});
test('invalid calendar dates never roll over or fall back to today while leap days and timezones remain usable',async()=>{
  for(const date1 of ['不是日期','2026-02-30','2025-02-29','2026-13-01','2026-10-16T24:00:00','2026-10-16T10:60:00'])for(const action of ['add','weekday','diff'])assert.ok((await execute('date_calc',{action,date1,date2:'2026-10-16',days:1})).error,date1+' '+action);
  for(const date1 of ['2024-02-29','2026/09/14','2026-09-14 21:30:00','2026-10-16T12:30:00+08:00'])assert.equal((await execute('date_calc',{action:'add',date1,days:1})).error,undefined,date1);
  assert.equal((await execute('date_calc',{action:'add',days:0})).error,undefined);
});
test('zero search quota survives configuration parsing and normal quota values retain their meanings',()=>{
  for(const [value,expected] of [['0',0],['3',3],['invalid',10]]){
    const actual=execFileSync(process.execPath,['-e',"process.stdout.write(String(require('./render-api/ai-quota').limits().free_search_limit))"],{cwd:require('node:path').resolve(__dirname,'..'),env:{...process.env,AI_FREE_SEARCH_DAILY:value},encoding:'utf8'});assert.equal(Number(actual),expected);
  }
});
test('model task policy names advertised tools and accurately describes file delivery limitations',()=>{
  const policy=require('../render-api/ai-task-policy').TASK_POLICY,definitions=require('./helpers/ai-tool-executor').definitions;
  const names=new Set(definitions.map(tool=>tool.function.name));
  for(const name of new Set(policy.match(/\b[a-z]+(?:_[a-z]+)+\b/g)||[]))assert.ok(names.has(name),'Unadvertised tool in task policy: '+name);
  const file=definitions.find(tool=>tool.function.name==='make_file').function;
  assert.deepEqual(file.parameters.properties.format.enum,['xlsx','csv']);assert.match(policy,/单工作表/);assert.match(policy,/不支持 TXT 或多工作表/);
  const pdf=definitions.find(tool=>tool.function.name==='generate_pdf').function.description;assert.match(pdf,/HTML/);assert.match(policy,/含中文或其他非 ASCII 内容交付 HTML/);
});
test('history reconciliation uses the durable revision, preserves deleted rows and never joins different message IDs',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('js/ai-agent.js','utf8');
  const start=source.indexOf('function reconcileAiToolRetryMetadata('),end=source.indexOf('async function retryAiToolStep(',start);
  const reconcile=vm.runInNewContext('('+source.slice(start,end).trim()+')');
  const local={id:'one',role:'assistant',client_request_id:'request',tool_retry_revision:2,tool_retry_updated_at:'2026-10-16T10:00:00.123456Z',site_cards:[{id:'new'}],process_events:[{type:'tools'}]};
  const old={...local,tool_retry_revision:1,tool_retry_updated_at:'2026-10-16T10:00:00.123123Z',site_cards:[]};
  reconcile([old],[local]);assert.equal(old.site_cards[0].id,'new');assert.equal(old.tool_retry_revision,2);
  const newer={...local,tool_retry_revision:3,site_cards:[{id:'remote-newer'}]};reconcile([newer],[local]);assert.equal(newer.site_cards[0].id,'remote-newer');
  const unrelated={...old,id:'different',tool_retry_revision:0,site_cards:[]};reconcile([unrelated],[local]);assert.equal(unrelated.site_cards.length,0);
  const deleted=[];reconcile(deleted,[local]);assert.equal(deleted.length,0);
});
