'use strict';
const {createHash}=require('node:crypto');
function routedFragment(url){return /^#(?:!?\/|!|\?|[^#]*[=/&?])/.test(url.hash);}
function canonicalUrl(value){
  try {
    const url=new URL(String(value||''));
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return '';
    if(!routedFragment(url))url.hash='';
    for(const key of [...url.searchParams.keys()])if(/^(utm_.+|fbclid|gclid|msclkid|spm|ref_src)$/i.test(key))url.searchParams.delete(key);
    url.searchParams.sort();return url.href;
  } catch(_){return '';}
}
function bodyText(source){return String(source.content||source.text||'').normalize('NFC').replace(/\r\n?/g,'\n').trim().slice(0,50000);}
function shingles(text){const set=new Set();for(let i=0;i+20<=text.length;i+=10)set.add(text.slice(i,i+20));return set;}
function similar(a,b){
  if(a.length<400||b.length<400||Math.min(a.length,b.length)/Math.max(a.length,b.length)<0.8)return false;
  if(a===b)return true;
  const aa=shingles(a),bb=shingles(b);let shared=0;
  for(const part of aa)if(bb.has(part))shared++;
  return shared/Math.max(aa.size,bb.size)>=0.9;
}
function dedupeSources(rows,max=50){
  const byUrl=new Map();let rawCount=0;
  for(const source of Array.isArray(rows)?rows:[]){
    if(!source)continue;const url=canonicalUrl(source.url);if(!url)continue;rawCount++;
    const body=bodyText(source),complete=source.content_complete!==false && String(source.content||source.text||'').length<=50000;
    const hash=body.length>=400 && complete?createHash('sha256').update(body).digest('hex'):'';
    const alias={title:String(source.title||url).slice(0,300),url:String(source.url),published_at:source.published_at||''};
    let group=byUrl.get(url);
    if(!group){group={canonical:url,body,hash,aliases:[],source,bodyHashes:new Set()};byUrl.set(url,group);}
    if(!group.aliases.some(a=>a.url===alias.url))group.aliases.push(alias);
    if(hash)group.bodyHashes.add(hash);
    // A later fetch can supply text missing from the original search result.
    // Prefer complete evidence, then the longer available preview.
    if(hash&&!group.hash||Boolean(hash)===Boolean(group.hash)&&body.length>group.body.length){
      group.body=body;group.hash=hash;
      group.source={...source,title:source.title||group.source.title,published_at:source.published_at||group.source.published_at,source:source.source||group.source.source};
    }
  }
  const groups=[];
  for(const group of byUrl.values()){
    // Conflicting snapshots of one URL are not proof that another article has
    // the same facts. Keep that URL group independent when bodies disagree.
    if(group.bodyHashes.size>1)group.hash='';
    const match=group.hash&&groups.find(g=>g.hash===group.hash);
    if(match){for(const alias of group.aliases)if(!match.aliases.some(a=>a.url===alias.url))match.aliases.push(alias);continue;}
    group.possiblyRelated=groups.some(g=>similar(group.body,g.body));
    groups.push(group);
  }
  const sources=groups.slice(0,max).map(g=>({
    title:String(g.source.title||g.canonical).slice(0,300),url:g.canonical,
    snippet:String(g.source.content||g.source.text||g.source.snippet||'').slice(0,1500),source:g.source.source||'web',
    published_at:g.source.published_at||'',aliases:g.aliases.slice(0,20),
    dedupe_basis:g.hash?'body':'url',content_checked:g.body.length>=400,possible_repost:g.possiblyRelated,content_unavailable:g.source.content_unavailable===true,content_truncated:g.source.content_complete===false
  }));
  return {sources,raw_count:rawCount,unique_count:groups.length,merged_count:rawCount-groups.length,shown_count:sources.length};
}
async function enrichSources(rows,{fetchPage,signal,maxPages=10,onProgress}={}){
  const enriched=(Array.isArray(rows)?rows:[]).slice(0,100).map(row=>({...row}));
  if(typeof fetchPage!=='function')return enriched;
  maxPages=Math.max(0,Math.min(10,Math.floor(Number(maxPages)||0)));
  const seen=new Set(),tasks=[];
  for(const row of enriched){
    const url=canonicalUrl(row.url);if(!url||seen.has(url)||bodyText(row).length>=400)continue;seen.add(url);
    // HTTP fetch cannot see the document selected by a client-side route.
    // Keep its link, without treating a shared app shell as article evidence.
    if(routedFragment(new URL(url))){row.content_unavailable=true;row.content_complete=false;continue;}
    if(tasks.length<maxPages)tasks.push(row);
  }
  let index=0,completed=0;
  await Promise.all([0,1].map(async()=>{while(index<tasks.length&&!(signal&&signal.aborted)){
    const row=tasks[index++];
    try {const page=await fetchPage(row.url,{signal,timeoutMs:6000,maxBytes:512*1024,allowJinaFallback:false});if(page&&String(page.content||'').trim()){row.content=String(page.content).slice(0,50000);row.content_complete=page.truncated===false && String(page.content).length<=50000;}else row.content_unavailable=true;}catch(_){row.content_unavailable=true;}
    completed++;if(onProgress)onProgress({completed,total:tasks.length});
  }}));return enriched;
}
function sourceManifest(dedup){
  return dedup.sources.map((s,i)=>'['+(i+1)+'] '+s.title+' '+s.url+(s.aliases.length>1?'（合并 '+s.aliases.length+' 个相同链接或正文来源；不能算作独立证据）':'')+'\n'+s.snippet).join('\n\n');
}
module.exports={canonicalUrl,bodyText,similar,dedupeSources,enrichSources,sourceManifest};
