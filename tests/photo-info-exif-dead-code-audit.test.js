'use strict';
// G-L4 源码断言测试：照片详情的 EXIF 字段是死代码——服务端
// inspectPhotoOriginal 只存 { orientation }，make/model/fNumber/
// exposureTime/iso/focalLength 永不存在，读它们的行永远不显示。
// 修复删掉三处死 EXIF 块（preview.js 的 J 与 hoisted Q 副本、
// preview-hotfix.js 的 buildPhotoInfoHtml），详情面板其余结构不变。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

const PREVIEW_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo-wall', 'preview.js'), 'utf8');
const HOTFIX_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'photo-wall', 'preview-hotfix.js'), 'utf8');
const DEAD_EXIF_READ = /exif\.(make|model|fNumber|exposureTime|iso|focalLength)/;

test('G-L4: preview.js 不再读不存在的 EXIF 字段', () => {
  assert.doesNotMatch(PREVIEW_SRC, DEAD_EXIF_READ);
  assert.doesNotMatch(PREVIEW_SRC, /EXIF 数据/, '死 EXIF 分区标题也应随之消失');
  // 详情面板其余结构保留：J 仍输出照片信息与文件信息两节。
  assert.match(PREVIEW_SRC, /function J\(e\)/);
  assert.match(PREVIEW_SRC, /照片信息/);
  assert.match(PREVIEW_SRC, /文件信息/);
});

test('G-L4: preview-hotfix.js 的 buildPhotoInfoHtml 不再读不存在的 EXIF 字段', () => {
  assert.doesNotMatch(HOTFIX_SRC, DEAD_EXIF_READ);
  assert.doesNotMatch(HOTFIX_SRC, /pp-info-section-title">EXIF</, '死 EXIF 分区标题也应随之消失');
  // 详情面板其余结构保留：有值才出行、空态仍在。
  assert.match(HOTFIX_SRC, /function buildPhotoInfoHtml\(photo\)/);
  assert.match(HOTFIX_SRC, /这张图片没有可显示的元数据/);
});
