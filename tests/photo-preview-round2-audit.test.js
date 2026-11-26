'use strict';
// 第二轮审计 预-1 / 预-3 / 预-4：帖子照片预览。
// 预-1：预览图卡在打开动画起始态（小图 + 大圆角椭圆）。打开动画的收尾
//   只靠 220ms 的 re() 定时器；时序一错（定时器被清、切图打断）图片就
//   冻在起始态。修复：600ms 后再强制清一次 inline 起始态——此时动画早
//   该结束，清掉只会回到正确终态；已切图/已关闭时守卫直接返回。
//   完整单负责人重构（删原始 morph、统一走 WAAPI）需真机验证，本轮不做。
// 预-3：工具栏两套布局打架——photo-preview.css 是居中胶囊，
//   preview-hotfix.js 的 ensurePreviewToolbar 又用 inline !important 把它
//   钉成右下角透明横排，开预览的时机不同、看到的布局就不同。修复：以
//   内联样式为准，把本表也收敛成右下角透明横排（与放大/缩小叠在右上方
//   的位置配套），热修复加载前后一致，不再翻转。
// 预-4：syncPreviewImageFit 的 __ppFitSig 缓存没有旋转角；旋转 90° 后
//   视觉宽高互换，签名不变会跳过重算，横图转竖后溢出视口。修复：签名
//   加入旋转角，fit 用互换后的尺寸算；旋转后立即重算一次。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const previewSrc = fs.readFileSync(path.join(root, 'js', 'photo-wall', 'preview.js'), 'utf8');
const hotfixSrc = fs.readFileSync(path.join(root, 'js', 'photo-wall', 'preview-hotfix.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(root, 'css', 'photo-preview.css'), 'utf8');

test('预-1: 打开动画 600ms 后有强制收尾守卫', () => {
  const idx = previewSrc.indexOf("$ = setTimeout(re, 220)) : (J.style.opacity = \"1\",");
  assert.ok(idx >= 0, '应有打开动画的 re() 定时器');
  const guard = previewSrc.slice(idx, idx + 1200);
  assert.ok(guard.includes('}, 600);'), '应有 600ms 强制收尾定时器');
  assert.ok(guard.includes("J._ppUrl !== S.imageUrl"), '守卫应校验仍是同一张图');
  assert.ok(guard.includes('J.style.transform = "";'), '守卫应清掉残留的 inline transform');
  assert.ok(guard.includes('J.style.borderRadius = "";'), '守卫应清掉残留的大圆角');
  assert.ok(guard.includes('!J.isConnected'), '已关闭时守卫应直接返回');
});

test('预-3: 工具栏样式表与内联样式收敛成同一布局（右下角透明横排）', () => {
  const tbIdx = cssSrc.indexOf('#photoPreviewOverlay .pp-preview-toolbar {');
  assert.ok(tbIdx >= 0, '应有工具栏规则');
  const tbEnd = cssSrc.indexOf('\n}', tbIdx);
  const tb = cssSrc.slice(tbIdx, tbEnd);
  assert.ok(tb.includes('right: max(14px, env(safe-area-inset-right, 0px));'), '工具栏应在右下角');
  assert.ok(tb.includes('background: transparent;'), '工具栏应为透明（不再是胶囊）');
  assert.ok(tb.includes('transform: none;'), '工具栏不应再居中位移');
  assert.ok(!tb.includes('left: 50%'), '不得再用 left:50% 居中胶囊');
  assert.ok(!tb.includes('border-radius: 999px;'), '不得再有胶囊圆角');
  const activeIdx = cssSrc.indexOf('#photoPreviewOverlay.active .pp-preview-toolbar {');
  const active = cssSrc.slice(activeIdx, activeIdx + 300);
  assert.ok(active.includes('transform: none;'), '激活态也不应再居中位移');
  assert.ok(hotfixSrc.includes("setImportant(toolbar, 'right', 'max(14px, env(safe-area-inset-right, 0px))');"),
    '内联样式仍应钉住右下角，两边一致');
  assert.ok(hotfixSrc.includes("['ppDeleteBtn', 'ppInfoBtn', 'ppShareBtn', 'ppRotateBtn'].forEach(function (id) {"),
    '工具栏四个按钮应被移入工具栏');
  assert.ok(hotfixSrc.includes("'position:relative', 'left:auto', 'right:auto', 'top:auto', 'bottom:auto',"),
    '工具栏按钮应有 inline !important 横排兜底，样式表失效时也不散到四角');
});

test('预-4: fit 缓存含旋转角，旋转后重算且宽高互换', () => {
  const fnIdx = hotfixSrc.indexOf('function syncPreviewImageFit(img)');
  assert.ok(fnIdx >= 0, '应有 syncPreviewImageFit');
  const fnBody = hotfixSrc.slice(fnIdx, fnIdx + 1400);
  assert.ok(fnBody.includes("state.rotation"), '签名应含旋转角');
  assert.ok(fnBody.includes("(_rotated?img.naturalHeight:img.naturalWidth)"), '旋转 90° 时 fit 宽应用互换后的尺寸');
  assert.ok(fnBody.includes("(_rotated?img.naturalWidth:img.naturalHeight)"), '旋转 90° 时 fit 高应用互换后的尺寸');
  const rotIdx = hotfixSrc.indexOf('window.ppRotatePhoto = function ()');
  assert.ok(rotIdx >= 0, '应有 ppRotatePhoto');
  const rotBody = hotfixSrc.slice(rotIdx, rotIdx + 600);
  assert.ok(rotBody.includes('syncPreviewImageFit(_rotImg)'), '旋转后应立即重算 fit');
});
