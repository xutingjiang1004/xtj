'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const digest=require('../media-digest');
test('local byte validation matches Storage single-part ETags across block boundaries and rejects opaque validators',async()=>{
  for(const n of [0,1,55,56,63,64,65,1024,65539]){
    const bytes=crypto.randomBytes(n),buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),expected=crypto.createHash('md5').update(bytes).digest('hex');
    assert.equal(digest.md5(buffer),expected);assert.equal(await digest.matches(new Blob([bytes]),'"'+expected+'"'),true);
  }
  assert.equal(await digest.matches(new Blob(['other']),'"'+crypto.createHash('md5').update('source').digest('hex')+'"'),false);
  assert.equal(await digest.matches(new Blob(['source']),'"multipart-2"'),false);
});
test('large local originals can validate multipart ETags without redownloading their server copy',async()=>{
  const partSize=5*1024*1024,bytes=crypto.randomBytes(partSize+123);
  const parts=[bytes.subarray(0,partSize),bytes.subarray(partSize)].map(b=>crypto.createHash('md5').update(b).digest());
  const etag=crypto.createHash('md5').update(Buffer.concat(parts)).digest('hex')+'-2';
  assert.equal(await digest.matches(new Blob([bytes]),'"'+etag+'"'),true);
  bytes[0]^=1;assert.equal(await digest.matches(new Blob([bytes]),'"'+etag+'"'),false);
});
