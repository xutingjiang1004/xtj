'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const upload = read('js/photo-wall/upload-ui.js');
const preview = read('js/photo-wall/preview.js');
const render = read('js/photo-wall/render.js');
const previewCss = read('css/photo-preview.css');

// This audit test deliberately stays standalone: do not wire it through package.json.
test('photo uploads retain a bounded worker pool and continue after a worker callback throws', () => {
  assert.match(upload, /var CONCURRENCY = 3;/);
  assert.match(upload, /w < Math\.min\(workerLimit, Math\.max\(1, total\)\)/);
  assert.match(upload, /\.then\(runOne, runOne\)/);
});

test('original uploads never use canvas re-encoding and uncommon-format checks release resources', () => {
  assert.doesNotMatch(upload, /toBlob|drawImage|createImageBitmap/);
  assert.match(upload, /if \(ok\) resolve\(file\)/);
  assert.match(upload, /URL\.revokeObjectURL\(url\)/);
  assert.match(upload, /img\.onload = null/);
  assert.match(upload, /img\.onerror = null/);
  assert.match(upload, /else reject\(createPhotoUploadError\(cancelled \? 'cancelled' : 'unsupported_type'\)\)/);
});

test('thumbnail full-size preload is single-flight and tied to preview image lifecycle', () => {
  assert.match(preview, /image\._ppFullPreloadCleanup && image\._ppFullPreloadCleanup\(!0\)/);
  assert.match(preview, /J\._ppFullPreloadCleanup = cleanupFullPreload/);
  assert.match(preview, /cleanupFullPreload\(cancelRequest\)/);
  assert.match(preview, /if \(cancelRequest && wasPending\)[\s\S]*?preImg\.src = ''/);
  assert.match(preview, /preImg\.onerror = function\(\)\s*\{[\s\S]*?cleanupFullPreload\(!0\);[\s\S]*?fullRequestStarted = !0;[\s\S]*?J\.src = openFullUrl/);
  assert.match(preview, /if \(!\(_\._openLoadGen === ee && t === S && J && J\.isConnected\)\) return/);
  assert.match(preview, /J\._ppUrl !== openFullUrl/);
  // The active thumbnail path should not concurrently fetch the same original via the generic cache prewarmer.
  assert.match(preview, /S && S\.imageUrl && !\(S\.thumbUrl \|\| S\.thumb\) && U\(S\.imageUrl\)/);
});

test('preview track slots match the measured JS viewport and dynamic mobile viewport height', () => {
  assert.match(previewCss, /#ppSlideTrack > \.pp-slide-slot\s*\{\s*flex:\s*0 0 calc\(100% \/ 3\)/);
  assert.match(previewCss, /height:\s*100vh;\s*height:\s*100dvh;/);
  // The legacy global min-width:100vw rule is overridden only in the ready preview track.
  assert.match(previewCss, /min-width:\s*0;\s*max-width:\s*none;/);
});

test('visible image warmup scans beyond offscreen leading photos before spending its budget', () => {
  const start = render.indexOf('function loadVisiblePhotoWallImages(');
  const end = render.indexOf('function observeImages(', start);
  const body = render.slice(start, end);
  assert.match(body, /for \(var i = 0; i < images\.length && queued < budget; i\+\+\)/);
  assert.match(body, /if \(rect\.top > viewportLimit \|\| rect\.bottom < -120\) continue/);
  assert.match(body, /queued\+\+;/);
});

test('download object URL revocation and preview resize listeners have explicit cleanup paths', () => {
  assert.match(preview, /window\.URL\.createObjectURL\(e\)/);
  assert.match(preview, /window\.URL\.revokeObjectURL\(o\)/);
  assert.match(preview, /window\.removeEventListener\("resize", d\._ppResizeHandler\)/);
  assert.match(preview, /window\.removeEventListener\("orientationchange", d\._ppOrientationHandler\)/);
});
