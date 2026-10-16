'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runRegex}=require('../render-api/regex-tool'),{execute}=require('./helpers/ai-tool-executor');
test('bounded worker retains captures, flags, empty Unicode matches and normal model-tool output',async()=>{
  assert.deepEqual(await runRegex({pattern:'(甲)(\\d+)',flags:'g',text:'甲12 甲3'}),[{match:'甲12',index:0,groups:['甲','12']},{match:'甲3',index:4,groups:['甲','3']}]);
  assert.deepEqual((await runRegex({pattern:'(?:)',flags:'gu',text:'😀'})).map(m=>m.index),[0,2]);
  assert.equal((await execute('regex_test',{pattern:'a+',flags:'i',text:'AAA'})).match_count,1);
});
test('backtracking and overlapping alternatives time out without blocking main-thread work',async()=>{
  for(const [pattern,text] of [['^(a+)+$','a'.repeat(30)+'!'],['^(a|aa)+$','a'.repeat(45)+'!']]){
    const pending=execute('regex_test',{pattern,text});const outcome=pending.then(()=> 'matched',()=> 'ended');
    assert.equal(await Promise.race([outcome,new Promise(resolve=>setTimeout(()=>resolve('main-thread-responsive'),20))]),'main-thread-responsive');
    assert.match((await pending).error,/超时/);
  }
  assert.equal((await runRegex({pattern:'a+',text:'aaaa'}))[0].match,'aaaa');
});
test('concurrency, cancellation and validation keep worker capacity bounded and recoverable',async()=>{
  const first=new AbortController(),second=new AbortController();
  const jobs=[runRegex({pattern:'^(a+)+$',text:'a'.repeat(30)+'!'},{signal:first.signal}),runRegex({pattern:'^(a+)+$',text:'a'.repeat(30)+'!'},{signal:second.signal})];
  await assert.rejects(runRegex({pattern:'a',text:'a'}),/繁忙/);first.abort();second.abort();const results=await Promise.allSettled(jobs);assert.ok(results.every(r=>r.status==='rejected'&&r.reason.name==='AbortError'));
  for(const args of [{pattern:'a',flags:'gg'},{pattern:'a',flags:'x'},{pattern:'('},{pattern:'a'.repeat(1001)},{pattern:'a',text:'a'.repeat(100001)}])await assert.rejects(runRegex(args));
  assert.equal((await runRegex({pattern:'a',text:'a'})).length,1);
});
