'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const evidence=require('../render-api/research-evidence');
const original=Array.from({length:180},(_,i)=>'第'+i+'段的实际材料与数据。').join('');
test('same headlines remain independent while tracking URL duplicates retain aliases',()=>{
 const result=evidence.dedupeSources([{title:'同一项政策发布分析A',url:'https://source.test/article?id=1&utm_source=a'},
 {title:'同一项政策发布分析B',url:'https://source.test/article?id=2'},{url:'https://source.test/article?id=1&utm_source=b'}]);
 assert.equal(result.unique_count,2);assert.equal(result.merged_count,1);assert.equal(result.sources[0].aliases.length,2);
 assert.equal(evidence.canonicalUrl('https://user:pass@source.test/'),'');assert.equal(evidence.canonicalUrl('javascript:alert(1)'),'');
});
test('actual repost bodies merge but short shared snippets and different bodies remain independent',()=>{
 const result=evidence.dedupeSources([{url:'https://a.test/',content:original},{url:'https://b.test/',content:original},
 {url:'https://c.test/',snippet:'政策公告'},{url:'https://d.test/',snippet:'政策公告'},{url:'https://e.test/',content:original.split('').reverse().join('')}]);
 assert.equal(result.unique_count,4);assert.equal(result.sources[0].aliases.length,2);assert.equal(result.sources[0].content_checked,true);
 assert.match(evidence.sourceManifest(result),/不能算作独立证据/);
});
test('body enrichment is bounded, skips known text, observes cancellation and reports actual completions',async()=>{
 const calls=[],events=[],abort=new AbortController();
 const rows=Array.from({length:20},(_,i)=>({url:'https://source.test/'+i}));rows[0].content=original;
 const result=await evidence.enrichSources(rows,{maxPages:4,signal:abort.signal,fetchPage:async(url,opts)=>{calls.push(url);assert.equal(opts.signal,abort.signal);return{content:original};},onProgress:e=>events.push(e)});
 assert.equal(calls.length,4);assert.equal(events.at(-1).completed,4);assert.equal(result.length,20);
 abort.abort();await evidence.enrichSources(rows,{signal:abort.signal,fetchPage:async()=>{throw Error('must not run');}});
});
test('search cleaning no longer silently discards distinct articles sharing a heading prefix',()=>{
 const {cleanSearchResults}=require('../render-api/search-providers');
 assert.equal(cleanSearchResults([{url:'https://a.test/',title:'最新政策调整对企业的影响一'},{url:'https://b.test/',title:'最新政策调整对企业的影响二'}],10).length,2);
});
