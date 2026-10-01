// Transformers.js 3.8.1, Apache-2.0; model revision is immutable.
import { pipeline, env } from './vendor/transformers-3.8.1.min.js';
env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
env.remoteHost = self.location.origin + '/api/voice-model/';
env.remotePathTemplate = '{model}/resolve/{revision}/';
const runtime = self.location.origin + '/api/voice-model/runtime/';
env.backends.onnx.wasm.wasmPaths = {
  mjs: runtime + 'ort-wasm-simd-threaded.jsep.mjs',
  wasm: runtime + 'ort-wasm-simd-threaded.jsep.wasm'
};
let recognizer;
let busy = false;
let phase = 'download';
const downloads = new Map();
async function repairModelCache(model){
  if(!self.caches)return false;
  for(const name of await caches.keys()){
    const cache=await caches.open(name);
    for(const request of await cache.keys()){
      const url=new URL(request.url);
      if(url.origin===self.location.origin&&url.pathname.startsWith('/api/voice-model/onnx-community/whisper-'+model+'/'))await cache.delete(request);
    }
  }
  return true;
}
self.onmessage = async ({ data }) => {
  if (busy || data.type !== 'transcribe') return;
  busy = true;
  const id = data.id, model = data.model === 'tiny' ? 'tiny' : 'base';
  try {
    phase='download';
    if (!recognizer) recognizer = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-'+model, {
      revision: model==='tiny'?'ff4177021cc41f7db950912b73ea4fdf7d01d8e7':'1846881b6b3a3024392c1eea3ad983695bc23925', device: 'wasm', dtype: 'q8',
      progress_callback: event => {
        if(event.status==='progress'||event.status==='done') downloads.set(event.file, {loaded:event.status==='done'?event.total:event.loaded,total:event.total});
        const values=[...downloads.values()].filter(v=>v.total>0);
        const total=values.reduce((n,v)=>n+v.total,0),loaded=values.reduce((n,v)=>n+(v.loaded||0),0);
        // Download completion is not runtime readiness: keep this below 100.
        self.postMessage({id,type:'progress',downloading:true,phase:event.status==='ready'?'initializing':'download',progress:total?Math.min(99,Math.floor(loaded/total*100)):null});
      }
    });
    phase='recognition';
    self.postMessage({ id, type: 'progress', downloading: false });
    const result = await recognizer(data.audio, {
      language: data.language || 'chinese', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5
    });
    const text = String(result.text || '').trim();
    self.postMessage({ id, type: 'result', text });
  } catch (error) {
    recognizer=null;
    const runtimeError=/wasm|memory|compile|instantiate|webassembly/i.test(String(error&&error.message));
    const cacheReset=(phase==='download'||runtimeError)?await repairModelCache(model).catch(()=>false):false;
    self.postMessage({ id, type: 'error', phase, cacheReset, fallbackModel:model==='base'&&(phase==='download'||runtimeError)?'tiny':null, code:runtimeError?'model_runtime_failed':phase==='download'?'model_download_failed':'recognition_failed', error:runtimeError?'语音模型初始化失败，请关闭多余页面后重试':phase==='download'?'语音模型下载未完成，请重试':'语音识别失败，请重试' });
  } finally { busy = false; }
};
