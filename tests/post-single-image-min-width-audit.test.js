'use strict';
// E-L5 单图超高被压窄：单图宽 = min(100%, aspect*520px, aspect*65vh)，
// 1:10 的图只有约 52px 宽。复核：按比例 contain 显示是设计取舍，
// 360–767 是否挤压未证实，所以不加新断点、不动 css/post-feed.css；
// 最小修复：尺寸宽高比下限 200/520，保证单图宽至少 200px，
// 真实比例（--post-image-ratio）不变，不拉伸图片；正常比例不受影响。
// 三处同公式：04 renderPostMediaGrid、04 syncPostImageRatio、
// early-feed paintMinimal。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

const posts = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');
const early = fs.readFileSync('js/early-feed.js', 'utf8');

test('列表渲染：单图尺寸宽高比有下限 200/520', () => {
  assert.match(posts, /Math\.max\(aspect, 200 \/ 520\)/,
    'renderPostMediaGrid 未给单图尺寸宽高比设下限');
});

test('真实尺寸同步：单图尺寸宽高比有下限 200/520', () => {
  assert.match(posts, /Math\.max\(ratio, 200 \/ 520\)/,
    'syncPostImageRatio 未给单图尺寸宽高比设下限');
});

test('早喂渲染：单图尺寸宽高比有下限 200/520', () => {
  assert.match(early, /Math\.max\(.*w \/ h.*200 \/ 520\)/,
    'early-feed paintMinimal 未给单图尺寸宽高比设下限');
});

test('真实比例不变：--post-image-ratio 不套下限，不拉伸图片', () => {
  assert.doesNotMatch(posts, /--post-image-ratio:' \+ Math\.max/,
    '真实比例被下限改写会拉伸图片');
  assert.doesNotMatch(early, /--post-image-ratio:' \+ Math\.max/,
    'early-feed 真实比例被下限改写会拉伸图片');
  assert.match(posts, /--post-image-ratio:' \+ ratio/,
    '列表渲染应保留真实比例');
});
