'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMediaTraffic}=require('../render-api/media-traffic');
test('media observations count bytes once, rotate by Beijing day and retain only bounded anonymous aggregates',()=>{
  let now=Date.parse('2026-10-19T15:59:59Z');const meter=createMediaTraffic({now:()=>now,dailyBudget:100});
  meter.request('uploads','posts/private-name.jpg?token=SECRET');meter.read('uploads','posts/private-name.jpg?token=SECRET',81);meter.revalidated();meter.previewHit();
  const first=meter.snapshot();assert.equal(first.days[0].date,'2026-10-19');assert.equal(first.days[0].source_bytes,81);assert.equal(first.days[0].budget_warning,true);assert.doesNotMatch(JSON.stringify(first),/SECRET|private-name/);
  now+=2000;meter.generated();assert.equal(meter.snapshot().days[1].date,'2026-10-20');assert.equal(meter.snapshot().days[1].source_bytes,0);
  for(let n=0;n<600;n++)meter.request('photo-wall','photos/'+n);assert.equal(meter.snapshot().days[1].top_resources.length,10);
  for(let n=0;n<9;n++){now+=86400000;meter.previewHit()}assert.equal(meter.snapshot().days.length,7);
});
