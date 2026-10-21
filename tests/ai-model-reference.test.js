'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('render-api/server.js','utf8');
function resolver(snapshot){let lookup;const fn=vm.runInNewContext('('+source.slice(source.indexOf('async function resolveAiModelReference('),source.indexOf('// ★ 2026-09-24 修复（课题②',source.indexOf('async function resolveAiModelReference('))).trim()+')',{
  fetchLatestAiModelsSnapshot:async(user,account)=>{lookup={user,account};if(snapshot instanceof Error)throw snapshot;return snapshot;},decryptAiModelSecret:()=> 'isolated-test-only-secret'});
  return {fn,lookup:()=>lookup};}
const saved={models:[{uid:'model-one',provider:'custom',model:'test-model',base_url:'https://provider.example/v1',api_key_enc:{version:2,data:'cipher-only'}}],deletedUids:[]};
async function invoke(r,body){let passed=false;const req={userName:'alice',accountId:'verified-account-a',body};const res={status(code){this.code=code;return this;},json(value){this.body=value;}};await r.fn(req,res,()=>passed=true);return {passed,req,res};}
test('saved-model references restore a Key only on the backend and bind the lookup to the authenticated account',async()=>{
  const r=resolver(saved),result=await invoke(r,{model_uid:'model-one',api_key:'client-cannot-replace-saved-key'});assert.equal(result.passed,true);assert.equal(result.req.body.api_key,'isolated-test-only-secret');assert.deepEqual(r.lookup(),{user:'alice',account:'verified-account-a'});
});
test('saved keys cannot be transferred to another endpoint, provider, model or deleted UID',async()=>{
  for(const patch of [{base_url:'https://attacker.example/v1'},{provider:'openai'},{model:'changed-model'}]){const r=await invoke(resolver(saved),{model_uid:'model-one',...patch});assert.equal(r.passed,false);assert.equal(r.res.code,409);assert.doesNotMatch(JSON.stringify(r.res.body),/isolated-test-only-secret|cipher-only/);}
  const missing=await invoke(resolver({...saved,deletedUids:['model-one']}),{model_uid:'model-one'});assert.equal(missing.res.code,404);
  const failed=await invoke(resolver(Error('private internal detail')),{model_uid:'model-one'});assert.equal(failed.res.code,503);assert.doesNotMatch(JSON.stringify(failed.res.body),/private internal detail/);
});
