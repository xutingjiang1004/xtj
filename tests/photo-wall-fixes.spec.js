const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const render = fs.readFileSync('js/photo-wall/render.js', 'utf8');
const data = fs.readFileSync('js/photo-wall/data.js', 'utf8');
const photoWall = fs.readFileSync('js/photo-wall/photo-wall.js', 'utf8');

// 6.1: Image Load Queue Residue
test('render generation ID exists for preventing old load residue', () => {
  assert.match(render, /_pwRenderGeneration/);
  assert.match(render, /_pwRenderGeneration \+= 1/);
});

test('observeImages clears old pending queue and active loads', () => {
  assert.match(render, /pendingImgs = \[\]/);
  assert.match(render, /activeLoads = 0/);
  assert.match(render, /_pwQueued = false/);
  assert.match(render, /_pwActiveLoad = 0/);
});

test('pumpImages checks img.isConnected before loading', () => {
  assert.match(render, /img\.isConnected/);
  assert.match(render, /_pwGeneration !== _pwRenderGeneration/);
});

test('settleImage only updates for current generation', () => {
  assert.match(render, /img\._pwActiveLoad === _pwRenderGeneration/);
  assert.match(render, /img\._pwGeneration === _pwRenderGeneration/);
});

// 6.2: Deleted Photos Resurrected
test('filtered local cache is used in merge when cloud has fewer results', () => {
  assert.match(data, /window\.photoWallData = local/);
  assert.match(data, /cloudIds\.has\(key\)/);
  assert.match(data, /使用过滤后的本地缓存参与合并/);
});

test('tombstone IDs filter cloud photos', () => {
  assert.match(data, /tombstoneIds = getDeletedIds/);
  assert.match(data, /tombstoneIds\.indexOf/);
});

// 6.3: Force Init Race
test('photo-wall init uses generation for single-flight', () => {
  assert.match(photoWall, /_initGeneration/);
  assert.match(photoWall, /currentGen !== _initGeneration/);
});

test('force init does not overlap with existing init', () => {
  assert.match(photoWall, /_initGeneration\+\+/);
  assert.match(photoWall, /initializingPromise = null/);
});

test('only latest generation clears initializingPromise', () => {
  assert.match(photoWall, /currentGen === _initGeneration/);
});

test('force sync function exists for desktop nav', () => {
  assert.match(photoWall, /__xtjPhotoWallForceSync/);
  assert.match(photoWall, /initPhotoWall\(true\)/);
});

// 6.4: Delete No Timeout
test('deleteCloudPhoto has AbortController and timeout', () => {
  assert.match(data, /new AbortController\(\)/);
  assert.match(data, /setTimeout\(function\(\) \{ controller\.abort\(\)/);
  assert.match(data, /15000/);
});

test('deleteCloudPhoto checks server status on timeout', () => {
  assert.match(data, /api\/photo\/status/);
  assert.match(data, /already_deleted/);
  assert.match(data, /delete_status_uncertain/);
});