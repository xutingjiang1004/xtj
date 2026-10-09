'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const ROOT=path.resolve(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
async function until(predicate,label){for(let i=0;i<100;i++){if(predicate())return;await tick();}throw new Error('did not reach '+label);}
async function photoRepro(){
  const testPath=path.join(ROOT,'tests/photo-wall-runtime-regression.test.js');
  const testSource=fs.readFileSync(testPath,'utf8');
  const prefix=testSource.slice(0,testSource.indexOf("test('authenticated photo API loads"));
  const createRuntime=new Function('require','__dirname',prefix+'\nreturn createPhotoDataRuntime;')(createRequire(testPath),path.dirname(testPath));
  const response=deferred();let started=false,epoch=0,renders=0;const warnings=[];
  const f=createRuntime(async url=>{assert.equal(url,'/api/photo/delete');started=true;return response.promise;});
  f.context.console={log(){},warn(...args){warnings.push(String(args[1]&&args[1].message||args[0]));},error(){}};
  f.window.__xtjGetAuthEpoch=()=>epoch;
  f.window.currentUser='A';f.windowListeners['auth-ready']();
  const photo={id:'A-photo',cloudId:'A-photo',username:'A',imageUrl:'https://example.invalid/A-photo.jpg',caption:'A-only-caption',timestamp:1};
  f.window.photoWallData=[photo];f.window.renderPhotoWallWithoutReload=()=>{renders++;};
  const deletion=f.window.deletePhotoWallPhoto(photo);
  await until(()=>started,'photo request');
  assert.equal(f.window.photoWallData.length,0);
  f.window.currentUser='B';epoch++;f.windowListeners['auth-ready']();
  assert.equal(f.window.photoWallData.length,0);assert.equal(f.storage.has('xtj_photos'),false);
  const rendersBeforeLate=renders;
  response.resolve({ok:true,json:async()=>({ok:true,deleted:true})});
  const result=await deletion;
  assert.equal(result.ok,false);
  assert.equal(f.window.photoWallData.length,0);
  assert.equal(f.storage.has('xtj_photos'),false);
  assert.equal(renders,rendersBeforeLate);

}
async function voiceRepro(){
  const decode=deferred(),recognition=deferred();const workers=[],states=[],results=[],saves=[],timerMap=new Map();let decodeCount=0,timerId=0,recognitionCalls=0;
  const source=fs.readFileSync(path.join(ROOT,'js/voice-transcription.js'),'utf8');
  const workerSource=fs.readFileSync(path.join(ROOT,'js/voice-transcription-worker.mjs'),'utf8').replace(/^import .*;\r?\n/m,'');
  const events={};
  class StubWorker {
    constructor(){
      this.posts=[];this.terminated=false;workers.push(this);
      const stub=this;
      const workerSelf={location:{origin:'https://example.invalid'},postMessage(data){if(!stub.terminated&&stub.onmessage)stub.onmessage({data});}};
      const env={backends:{onnx:{wasm:{}}}};
      const pipeline=async()=>async()=>{recognitionCalls++;return recognition.promise;};
      // Run the current worker body too; only its static third-party import is stubbed.
      vm.runInNewContext(workerSource,{self:workerSelf,env,pipeline,URL,Map,console},{filename:'voice-transcription-worker.mjs'});
      this.workerSelf=workerSelf;
    }
    postMessage(data){this.posts.push(data.id);void this.workerSelf.onmessage({data});}
    terminate(){this.terminated=true;}
  }
  const window={currentUser:'A',navigator:{hardwareConcurrency:8},addEventListener(type,fn){events[type]=fn;},
    AudioContext:class{async decodeAudioData(){decodeCount++;return decodeCount===1?decode.promise:{duration:1};}async close(){}},
    OfflineAudioContext:class{createBufferSource(){return{connect(){},start(){}};}async startRendering(){return{getChannelData:()=>new Float32Array(16000)};}},
    xtjProtectedFetch:async(path,init)=>{saves.push({path,init});return{ok:true,json:async()=>({ok:true,message:{id:'server-message'}})};}};
  const context={window,document:{currentScript:{src:'https://example.invalid/js/voice-transcription.js'}},Worker:StubWorker,URL,AbortController,fetch(){throw Error('network forbidden');},Float32Array,Map,console,
    setTimeout(fn,ms){const id=++timerId;timerMap.set(id,{fn,ms});return id;},clearTimeout(id){timerMap.delete(id);}};
  vm.runInNewContext(source,context,{filename:'voice-transcription.js'});
  function enqueue(id){window.XTJVoiceTranscription.enqueue({owner:'A',peer:'peer',id,sent:true,file:{size:12,arrayBuffer:async()=>new ArrayBuffer(12)},onState:j=>states.push({id,state:j.state,label:j.label}),onResult:text=>results.push({id,text})});}
  enqueue('old');await until(()=>decodeCount===1,'old decode');
  events.pagehide({persisted:true});
  enqueue('new');await until(()=>recognitionCalls===1,'new recognition');
  assert.equal(workers.length,1);assert.deepEqual(workers[0].posts,['A\npeer\nnew']);
  decode.resolve({duration:1});await tick();await tick();
  assert.deepEqual(workers[0].posts,['A\npeer\nnew']);
  recognition.resolve({text:'new transcript'});await tick();await tick();
  assert.equal(results.length,1);assert.equal(results[0].id,'new');assert.equal(saves.length,1);
  assert.equal([...timerMap.values()].filter(t=>t.ms===300000).length,0);
  window.XTJVoiceTranscription.reset();timerMap.clear();
}
test('a late photo deletion cannot restore another account’s photo or cache',photoRepro);
test('reset during decoding cannot replace the next voice job callback',voiceRepro);
