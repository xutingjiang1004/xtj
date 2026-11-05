'use strict';
// 信息流视频的画中画状态（2026-11-02）：播完必须收回半宽封面态。
// 之前 is-expanded 加上去就没人移除，播过一次的视频永久满宽，停在原生「重播」
// 按钮上再点会出现有声无画的黑屏。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

const source = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');
const css = fs.readFileSync('css/style.css', 'utf8');

test('播放结束后移除 is-expanded 并复位播放器', () => {
  const start = source.indexOf("document.addEventListener('ended'");
  assert.ok(start > 0, '缺少 ended 监听');
  const block = source.slice(start, start + 900);
  assert.match(block, /\.media--video\.is-feed/);
  assert.match(block, /classList\.remove\('is-expanded'\)/);
  assert.match(block, /controls = false/);
  assert.match(block, /currentTime = 0/);
});

test('封面点击会从头播放，不接续上次的结尾', () => {
  const start = source.indexOf("closest('.media--video.is-feed .video-cover')");
  assert.ok(start > 0, '缺少封面点击处理');
  const block = source.slice(start, start + 900);
  assert.match(block, /classList\.add\('is-expanded'\)/);
  assert.match(block, /player\.ended\) player\.currentTime = 0/);
});

test('未展开时容器是半宽，展开才是满宽', () => {
  assert.match(css, /\.media\.media--video\.is-feed\s*\{[^}]*width:\s*min\(52%,\s*250px\)/);
  assert.match(css, /\.media\.media--video\.is-feed\.is-expanded\s*\{[^}]*width:\s*100%/);
});

test('封面截帧用 1080 上限，避免 3x 屏放大发虚', () => {
  const composer = fs.readFileSync('js/post-composer-media.js', 'utf8');
  assert.match(composer, /Math\.min\(1, 1080 \/ Math\.max\(w, h\)\)/);
});
