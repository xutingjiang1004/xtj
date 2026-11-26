'use strict';
// 第二轮审计 重-1 / 重-3 / 影-2：照片墙切回全量重建与骨架残留。
// 重-1：切回照片墙必定全量重建网格（renderSorted 每次 innerHTML 重写，
//   没有任何“数据没变就跳过”逻辑）。修复：非相册分支在重建前算签名
//   （本页卡片 id/图址/作者/文案/时间/宽高/最近上传态 + 批次 + 总数
//   + 用户），签名相同且网格里已有卡片时直接跳过；浏览数不计入签名
//   （由 updatePhotoViewDisplays 定点更新，不走重建）。
// 重-3：.pw-skeleton 在每张卡片里永久存在（完成只是 CSS display:none），
//   ensurePhotoWallVisibleContent 用“存在即需重载”判断恒为真，每次都
//   强制全量重载。修复：只统计视口附近还没加载完成的卡片。
// 影-2：骨架隐藏完全依赖 CSS 兄弟选择器，JS 无兜底。修复：finishImg()
//   里直接把同卡片的骨架 span 藏掉；重试加载时再还给 CSS 控制。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const renderSrc = fs.readFileSync(path.join(root, 'js', 'photo-wall', 'render.js'), 'utf8');
const statsSrc = fs.readFileSync(path.join(root, 'js', 'core-parts', '05-feed-stats.js'), 'utf8');

test('重-1: renderSorted 数据没变时跳过全量重建', () => {
  const fnIdx = renderSrc.indexOf('function renderSorted(photos, preserveBatch)');
  assert.ok(fnIdx >= 0, '应有 renderSorted');
  const fnBody = renderSrc.slice(fnIdx, fnIdx + 6000);
  assert.ok(fnBody.includes('__xtjPwSig'), '应有渲染签名缓存');
  assert.ok(fnBody.includes("if (grid.__xtjPwSig === _renderSig && grid.querySelector('.photo-wall-item[data-photo-id]')) return;"),
    '签名相同且已有卡片时应直接返回，不重写 innerHTML');
  assert.ok(fnBody.includes("(p.cloudId || p.id)"), '签名应含照片 id');
  assert.ok(fnBody.includes("(p.thumbUrl || p.imageUrl || '')"), '签名应含图址');
  assert.ok(fnBody.includes("(p.caption || '')"), '签名应含文案');
  assert.ok(fnBody.includes("recentPhotos.has(String(p.id))"), '签名应含最近上传态');
  assert.ok(!fnBody.includes('p.views'), '签名不应含浏览数（定点更新，不走重建）');
});

test('重-3: 骨架检查只统计视口附近未完成的卡片', () => {
  assert.ok(statsSrc.includes('function hasVisiblePhotoWallSkeleton(grid)'),
    '应有视口骨架检查辅助函数');
  assert.ok(statsSrc.includes('hasSkeleton = hasVisiblePhotoWallSkeleton(grid);'),
    '重载判断应用视口骨架检查');
  assert.ok(!statsSrc.includes("querySelector('.pw-skeleton')"),
    '不得再用“.pw-skeleton 存在即重载”的恒真判断');
  const helper = statsSrc.slice(statsSrc.indexOf('function hasVisiblePhotoWallSkeleton(grid)'), statsSrc.indexOf('async function ensurePhotoWallVisibleContent'));
  assert.ok(helper.includes("img.classList.contains('pw-blur-done')"), '已完成的图不应计入骨架');
  assert.ok(helper.includes('getBoundingClientRect'), '应只统计视口附近的卡片');
});

test('影-2: finishImg 直接隐藏同卡片骨架，重试时还给 CSS', () => {
  const fnIdx = renderSrc.indexOf('function finishImg(img)');
  assert.ok(fnIdx >= 0, '应有 finishImg');
  const fnBody = renderSrc.slice(fnIdx, fnIdx + 900);
  assert.ok(fnBody.includes("classList.contains('pw-skeleton')"), 'finishImg 应找到同卡片骨架 span');
  assert.ok(fnBody.includes("_sk.style.display = 'none'"), 'finishImg 应直接藏掉骨架');
  const retryIdx = renderSrc.indexOf('function retryImageLoad(img)');
  const retryBody = renderSrc.slice(retryIdx, retryIdx + 1200);
  assert.ok(retryBody.includes("_skRetry.style.display = ''"), '重试时应把骨架还给 CSS 控制');
});
