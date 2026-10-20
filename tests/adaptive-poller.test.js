'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAdaptivePoller}=require('../render-api/adaptive-poller');
function fixture(task){let next=null,blocked=false;const errors=[];const p=createAdaptivePoller({task,isRestricted:()=>blocked,setTimer:(fn,ms)=>(next={fn,ms}),clearTimer:()=>{next=null},onError:code=>errors.push(code)});return{p,errors,get next(){return next},setBlocked:v=>blocked=v,async tick(){const n=next;next=null;await n.fn()}}}
test('idle polls back off, new jobs wake immediately and quota restriction suppresses work',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;return'idle'});f.p.start();assert.equal(f.next.ms,0);
  for(let i=0;i<8;i++)await f.tick();assert.equal(f.next.ms,60000);f.p.wake();assert.equal(f.next.ms,0);
  f.setBlocked(true);await f.tick();assert.equal(calls,8);assert.equal(f.next.ms,300000);
  f.setBlocked(false);await f.tick();assert.equal(calls,9);f.p.stop();assert.equal(f.next,null);
});
test('failing queues have bounded retries and rate-limited errors; waking a running poll cannot overlap it',async()=>{
  let fail=true;const f=fixture(async()=>{if(fail)throw Object.assign(Error('sensitive query'),{code:'42703'});return'worked'});f.p.start();
  for(let i=0;i<8;i++)await f.tick();assert.equal(f.next.ms,300000);assert.deepEqual(f.errors,['42703']);fail=false;await f.tick();assert.equal(f.next.ms,3000);f.p.stop();
  let resolve,calls=0;const g=fixture(()=>{calls++;return new Promise(r=>resolve=r)});g.p.start();const running=g.tick();g.p.wake();assert.equal(calls,1);assert.equal(g.next,null);resolve('idle');await running;assert.equal(g.next.ms,0);g.p.stop();
});
test('the existing cat worker fills three slots with one queue query and preserves completion wakeups',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('render-api/server.js','utf8');
  const begin=source.indexOf('async function processNextCatJob()'),end=source.indexOf('var catWorkerPoller =',begin);
  let queries=0,limit=0,wakes=0;const releases=[],jobs=[{id:1},{id:2},{id:3}];
  const q={select(){return q},eq(){return q},or(){return q},order(){return q},limit(n){limit=n;queries++;return{data:jobs.slice(0,n)}}};
  const context=vm.createContext({Date,Promise,currentCatAiWorkers:0,MAX_CAT_AI_WORKERS:3,supabase:{from:()=>q},catWorkerPoller:{wake:()=>wakes++},processCatReplyJob:()=>new Promise(r=>releases.push(r))});
  vm.runInContext(source.slice(begin,end),context);assert.equal(await context.processNextCatJob(),'worked');assert.equal(queries,1);assert.equal(limit,3);assert.equal(context.currentCatAiWorkers,3);
  assert.equal(await context.processNextCatJob(),'idle');assert.equal(queries,1);
  releases.forEach(r=>r());await new Promise(setImmediate);assert.equal(context.currentCatAiWorkers,0);assert.equal(wakes,3);
});
