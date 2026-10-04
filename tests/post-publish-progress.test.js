'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 class Element{constructor(){this.classList={add(){}};this.children=[];this.attrs={};this.style={};}append(...nodes){this.children.push(...nodes)}appendChild(node){this.append(node)}replaceChildren(...nodes){this.children=nodes}setAttribute(k,v){this.attrs[k]=v}removeAttribute(k){delete this.attrs[k]}cloneNode(){return new Element()}querySelector(){return null}}
 const xhrs=[];class XHR{constructor(){this.upload={};this.headers={};xhrs.push(this)}open(method,url){this.url=url}setRequestHeader(k,v){this.headers[k]=v}send(body){this.body=body}getAllResponseHeaders(){return'content-type: application/json'}abort(){if(this.onabort)this.onabort()}}
 const button=new Element(),files=[{size:100},{size:300}];let active=true;
 const c={document:{createElement:()=>new Element(),getElementById:()=>new Element()},window:{XTJ_CONFIG:{SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public-key'},supabase:{createClient:(url,key,options)=>({storage:{from:()=>({upload:async(path,file)=>{try{const r=await options.global.fetch(url+'/storage/v1/object/uploads/'+path,{method:'POST',headers:{apikey:key},body:file});return r.ok?{error:null}:{error:new Error('upload failed')}}catch(error){return{error}}}})}})}},Headers,Response,XMLHttpRequest:XHR,DOMException,URL,fetch};
 vm.runInNewContext(fs.readFileSync('js/post-publish-progress.js','utf8'),c);const progress=c.window.XtjPostPublishProgress.begin(button,files,()=>active);const copy=button.children[0].children[1];return{progress,files,xhrs,label:copy.children[0],track:copy.children[1],deactivate(){active=false}};
}
test('publish progress weights actual bytes, stays below completion until confirmed and retains originals',async()=>{
 const f=fixture(),a=f.progress.upload({},'posts/a',f.files[0],0),b=f.progress.upload({},'posts/b',f.files[1],1);
 assert.equal(f.xhrs[0].body,f.files[0]);assert.equal(f.xhrs[0].headers.apikey,'public-key');f.xhrs[0].upload.onprogress({lengthComputable:true,total:100,loaded:50});assert.equal(f.track.attrs['aria-valuenow'],'11');f.xhrs[1].upload.onprogress({lengthComputable:true,total:300,loaded:150});assert.equal(f.track.attrs['aria-valuenow'],'45');
 for(const xhr of f.xhrs){xhr.upload.onload();xhr.status=200;xhr.responseText='{}';xhr.onload()}await Promise.all([a,b]);assert.equal(f.track.attrs['aria-valuenow'],'90');f.progress.saving();assert.equal(f.track.attrs['aria-valuenow'],'95');assert.match(f.label.textContent,/保存中/);f.progress.confirmed();assert.equal(f.track.attrs['aria-valuenow'],'100');
});
test('identity change aborts all in-flight uploads and prevents late progress updates',async()=>{
 const f=fixture(),pending=f.progress.upload({},'posts/a',f.files[0],0);f.deactivate();f.progress.cancel();const result=await pending;assert.ok(result.error);assert.equal(f.xhrs[0].upload.onprogress,null);assert.equal(f.track.attrs['aria-valuenow'],'0');
});
test('storage failure does not report successful completion',async()=>{
 const f=fixture(),pending=f.progress.upload({},'posts/a',f.files[0],0);f.xhrs[0].upload.onprogress({lengthComputable:true,total:100,loaded:80});f.xhrs[0].status=500;f.xhrs[0].responseText='{}';f.xhrs[0].onload();assert.ok((await pending).error);assert.ok(Number(f.track.attrs['aria-valuenow'])<100);
});
