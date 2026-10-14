'use strict';
// Temporary recovery helper: build only with the repository's normal build, then
// publish public generated file bytes and Git blob hashes for exact restoration.
// Removed before release; never reads credentials or environment values.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
execFileSync(process.execPath,[path.join(root,'scripts/build.js')],{cwd:root,stdio:'inherit'});
const allowed=new Set(['js/ai-agent.min.js','js/ai-core/assistant-features.min.js','js/ai-core/tool-workbench.min.js','js/ai-core/voice-conversation.min.js','css/ai-assistant-features.min.css','index.html']);
const changed=execFileSync('git',['diff','--name-only','--'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
if(changed.some(file=>!allowed.has(file)))throw Error('Unexpected generated changes: '+changed.filter(file=>!allowed.has(file)).join(', '));
for(const file of changed){
 const bytes=fs.readFileSync(path.join(root,file)),sha=execFileSync('git',['hash-object','--',file],{cwd:root,encoding:'utf8'}).trim(),base64=bytes.toString('base64'),total=Math.ceil(base64.length/8192);
 for(let index=0;index<total;index++)console.log('XTJ_AI_BUILD_20261014 '+JSON.stringify({path:file,sha,bytes:bytes.length,index,total,data:base64.slice(index*8192,(index+1)*8192)}));
}
console.log('XTJ_AI_BUILD_20261014_DONE '+JSON.stringify({files:changed.length,paths:changed}));
