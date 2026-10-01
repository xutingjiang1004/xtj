'use strict';
// Only immutable, verified ASR files. No caller-selected host or arbitrary path.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const REVISION = 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7';
const MODEL = 'onnx-community/whisper-tiny';
const JSON_FILES = ['config.json','generation_config.json','preprocessor_config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','added_tokens.json'];
const WEIGHTS = {
 'onnx/encoder_model_quantized.onnx': { size:10124990, sha:'2af4a414ca47aa30f61246017e5fe82b0a8d229281d1255ba666a2a7f6b84d19' },
 'onnx/decoder_model_merged_quantized.onnx': { size:30719241, sha:'25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3' }
};
const BASE_REVISION = '1846881b6b3a3024392c1eea3ad983695bc23925';
const BASE_WEIGHTS = {
  "onnx/decoder_model_merged_quantized.onnx": {
    "size": 53693315,
    "sha": "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b"
  },
  "onnx/encoder_model_quantized.onnx": {
    "size": 23201314,
    "sha": "5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46"
  }
};
const RUNTIME = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/';
function assetFor(urlPath) {
 for(const definition of [{model:MODEL,revision:REVISION,weights:WEIGHTS,key:'model-'},{model:'onnx-community/whisper-base',revision:BASE_REVISION,weights:BASE_WEIGHTS,key:'base-model-'}]) {
  const prefix=definition.model+'/resolve/'+definition.revision+'/';
  if(!urlPath.startsWith(prefix))continue;
  const file=urlPath.slice(prefix.length);
  if(!JSON_FILES.includes(file)&&!definition.weights[file])return null;
  return {url:'https://huggingface.co/'+prefix+file,key:definition.key+file.replaceAll('/','-'),type:file.endsWith('.json')?'application/json':'application/octet-stream',...(definition.weights[file]||{})};
 }
 if(/^runtime\/ort-wasm-simd-threaded\.jsep\.(mjs|wasm)$/.test(urlPath)) {
  const file=urlPath.slice(8);return {url:RUNTIME+file,key:file,type:file.endsWith('.mjs')?'text/javascript':'application/wasm',sha:file.endsWith('.mjs')?'08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9':'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39'};
 }
 return null;
}
function createVoiceModelAssets({express,fetchImpl=fetch,cacheDir=path.join(os.tmpdir(),'xtj-voice-model-v1')}={}) {
 const router=express.Router(),pending=new Map();
 async function cached(asset) {
  await fs.promises.mkdir(cacheDir,{recursive:true});const file=path.join(cacheDir,asset.key),proof=file+'.verified';
  try {const stat=await fs.promises.stat(file);const marker=JSON.parse(await fs.promises.readFile(proof,'utf8'));if(stat.size===marker.size&&stat.mtimeMs===marker.mtime&&(!asset.size||stat.size===asset.size))return file;}catch(_){}
  if(pending.has(asset.key))return pending.get(asset.key);
  const work=(async()=>{
   const temp=file+'.'+crypto.randomUUID()+'.part';
   try {
    const response=await fetchImpl(asset.url,{signal:AbortSignal.timeout(180000),redirect:'follow'});
    if(!response.ok||!response.body)throw new Error('model_download_failed');
    const hash=crypto.createHash('sha256');let size=0;
    const check=new Transform({transform(chunk,encoding,callback){size+=chunk.length;if(size>80*1024*1024)return callback(new Error('model_too_large'));hash.update(chunk);callback(null,chunk);}});
    await pipeline(Readable.fromWeb(response.body),check,fs.createWriteStream(temp,{flags:'wx'}));
    if(!size||(asset.size&&size!==asset.size)||(asset.sha&&hash.digest('hex')!==asset.sha))throw new Error('model_integrity_failed');
    if(asset.type==='application/json')JSON.parse(await fs.promises.readFile(temp,'utf8'));
    if(asset.type==='application/wasm'){const handle=await fs.promises.open(temp,'r');try{const magic=Buffer.alloc(4);await handle.read(magic,0,4,0);if(magic.toString('hex')!=='0061736d')throw new Error('wasm_integrity_failed');}finally{await handle.close();}}
    await fs.promises.rename(temp,file);const stat=await fs.promises.stat(file);await fs.promises.writeFile(proof,JSON.stringify({size,mtime:stat.mtimeMs}));return file;
   } finally {await fs.promises.unlink(temp).catch(()=>{});}
  })().finally(()=>pending.delete(asset.key));pending.set(asset.key,work);return work;
 }
 router.use(async(req,res,next)=>{
  if(!['GET','HEAD'].includes(req.method))return res.status(405).end();
  const asset=assetFor(req.path.replace(/^\//,''));if(!asset)return res.status(404).json({ok:false,error:'模型文件不存在'});
  try {const file=await cached(asset);res.set({'Content-Type':asset.type,'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'});res.sendFile(file,error=>{if(error&&!res.headersSent)res.status(503).end();});}
  catch(_){res.set('Cache-Control','no-store');res.status(503).json({ok:false,code:'model_download_unavailable',error:'语音模型暂时无法下载，请稍后重试'});}
 });
 return router;
}
module.exports={createVoiceModelAssets,assetFor,REVISION,MODEL};
