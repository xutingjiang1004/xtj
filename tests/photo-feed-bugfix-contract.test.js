/**
 * 首页帖子 + 照片墙 bug 修复契约测试
 *
 * 覆盖本轮审计确认的问题（均已实测验证）：
 *   S1  浏览量永不增长 —— increment_post_views 硬编码 media_type='__photo_wall__'
 *   S2  照片墙删除失败恢复依赖 —— mergePhotoLists 只认 imageUrl，原始行会被丢弃
 *   M1  照片墙错误态被伪装成空态 —— catch 设置了 is-error 却不重渲染
 *   M2  照片墙 500 张硬截断无出口 —— 哨兵 disconnect 后永久无法加载更多
 *   M3  图片预热循环顺序错误 —— 先截断再判视口，第 7 张起永不预热
 *   M4  HEIC 等格式转码失败静默直传 → 浏览器破图
 *   M5  upload_id 退化分支含下划线，与服务端截断约定冲突
 *   M6  前端 MIME 白名单比服务端宽
 *   M7  多图上传异常断链 + failedJobs 丢失
 *   M8  浏览量显示替换正则无锚点，会误改文案里的其它数字
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const dataSource = read('js/photo-wall/data.js');
const renderSource = read('js/photo-wall/render.js');
const uploadSource = read('js/photo-wall/upload-ui.js');
const postsSource = read('js/core-parts/04-posts-interactions.js');
const m056 = read('supabase/migrations/056_fix_increment_post_views_scope.sql');

// ─────────────────────────── S1 浏览量 ───────────────────────────

test('S1: increment_post_views 不再硬编码 media_type 白名单', () => {
  // 去掉 SQL 行注释后判定 —— 文件注释里引用了旧的坏写法用于说明，不能误判为代码
  const code = m056
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
  assert.doesNotMatch(code, /media_type\s*=\s*'__photo_wall__'/, '不得再限定单一媒体类型');
  // 用字面量判定，避免 SQL 里反斜杠带来的正则转义歧义
  assert.ok(
    code.indexOf("NOT LIKE '\\_\\_%' ESCAPE '\\'") >= 0,
    "应改为 NOT LIKE '\\_\\_%' ESCAPE '\\' 排除系统 marker 行"
  );
  assert.ok(code.indexOf('media_type IS NULL OR') >= 0, '普通帖（media_type 为 NULL）必须计入');
});

test('S1: RPC 保持原子更新与签名兼容', () => {
  assert.match(m056, /CREATE OR REPLACE FUNCTION public\.increment_post_views\(p_post_id UUID\)/);
  assert.match(m056, /RETURNS INTEGER/, '返回类型不变，避免 031 的签名冲突问题重演');
  assert.match(m056, /SET views = COALESCE\(views, 0\) \+ 1/, '必须是单语句原子自增，不可读改写');
  assert.match(m056, /SECURITY DEFINER/);
  assert.match(m056, /SET search_path = pg_catalog, public/);
});

test('M8: 浏览量显示替换使用锚定正则，不再裸替换首个数字', () => {
  assert.match(postsSource, /\(\(\?:浏览\|👁\)\\s\*\)\(\\d\+\)/, '必须锚定「浏览」/👁 前缀');
  // 允许出现在注释里的旧写法说明，但代码中不得存在裸 replace(/\d+/
  const codeOnly = postsSource
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
  assert.doesNotMatch(codeOnly, /textContent\.replace\(\/\\d\+\//, '不得再裸替换文本中的第一个数字');
});

// ─────────────────────────── S2 删除失败恢复 ───────────────────────────

test('S2: 云端删除失败时先 normalize 再恢复，避免原始行被静默丢弃', () => {
  const failBranch = dataSource.slice(
    dataSource.indexOf('if (!deleteResult)'),
    dataSource.indexOf('// 云端删除成功后才标记为已删除')
  );
  assert.match(failBranch, /var restoredItem = normalizePhotoWallRow\(item\)/);
  assert.match(failBranch, /if \(!restoredItem \|\| !restoredItem\.imageUrl\) restoredItem = item/);
  assert.match(failBranch, /mergePhotoLists\(\[restoredItem\]/);
});

// ─────────────────────────── M1 错误态 ───────────────────────────

test('M1: 加载失败后强制重渲染，让错误态必然呈现', () => {
  const catchBranch = dataSource.slice(
    dataSource.indexOf("setPhotoWallSyncStatus('error', '同步失败')"),
    dataSource.indexOf("return window.photoWallData;\n    } finally {")
  );
  assert.match(catchBranch, /renderPhotoWallWithoutReload/, '失败后必须补一次渲染');
  // 空态分支仍需依赖 is-error 判断（render.js 侧）
  assert.match(renderSource, /is-error/, 'render.js 空态分支保留 is-error 判据');
});

// ─────────────────────────── M2 截断出口 ───────────────────────────

test('M2: DOM 达上限且服务端仍有更多时，保留可点击入口而非直接断开', () => {
  const start = renderSource.indexOf('if (domIds.length >= MAX_DOM_PHOTOS)');
  assert.ok(start >= 0, '未找到封顶分支');
  const limitBranch = renderSource.slice(start, start + 900);
  assert.match(limitBranch, /window\.hasMorePhotos\(\)/, '必须区分服务端是否还有数据');
  assert.match(limitBranch, /已达当前渲染上限，点击继续加载/);
  assert.match(limitBranch, /else \{[\s\S]*?disconnect\(\)/, 'disconnect 只能出现在 else 分支');
});

test('M2: IntersectionObserver 在上限时改为提示而非自动触发的空转循环', () => {
  assert.match(renderSource, /function domPhotoLimitReached\(\)/);
  assert.match(renderSource, /if \(domPhotoLimitReached\(\) && window\.hasMorePhotos\(\)\)/);
});

test('M2: resetSentinelText 支持 retryable 时绑定点击（否则"像按钮却点不动"）', () => {
  const fn = renderSource.slice(
    renderSource.indexOf('function resetSentinelText(grid, text, retryable)'),
    renderSource.indexOf('function observeAppendedImages')
  );
  assert.match(fn, /window\.__xtjPhotoWallLoadMore/, '必须复用闭包内的 doLoadMore');
  assert.match(fn, /sent\.onclick = handler/);
  // 暴露点必须存在
  assert.match(renderSource, /window\.__xtjPhotoWallLoadMore = doLoadMore/);
});

// ─────────────────────────── M3 图片预热 ───────────────────────────

test('M3: 图片预热先判视口、再消耗预算，不再预先截断数组', () => {
  const start = renderSource.indexOf('function loadVisiblePhotoWallImages(container, limit)');
  const raw = renderSource.slice(start, renderSource.indexOf('function observeImages(container)'));
  // 去掉行注释后判定，避免把"说明旧实现"的注释误判为代码
  const fn = raw
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
  assert.doesNotMatch(fn, /Math\.min\(images\.length/, '不得先 Math.min 截断候选集');
  assert.match(fn, /var queued = 0/);
  assert.match(fn, /queued < budget/, '预算应在循环条件中约束');
  assert.match(fn, /getBoundingClientRect\(\)/, '先判视口');
  assert.match(fn, /queued\+\+/, '命中视口才消耗预算');
});

// ─────────────────────────── M4 HEIC 破图 ───────────────────────────

test('M4: 浏览器不可解码的格式转码失败时明确报错，不静默直传', () => {
  assert.match(uploadSource, /BROWSER_UNDECODABLE = \/\^image\\\/\(heic\|heif\|bmp\|x-ms-bmp\|tiff\|tif\)\$\//i);
  assert.match(uploadSource, /if \(needsTranscode && BROWSER_UNDECODABLE\.test\(String\(type \|\| ''\)\)\)/);
  assert.match(uploadSource, /throw createPhotoUploadError\('unsupported_type'\)/, '复用既有错误码');
});

// ─────────────────────────── M5/M6 上传契约 ───────────────────────────

test('M5: genUploadId 退化分支不含下划线', () => {
  const start = uploadSource.indexOf('function genUploadId()');
  const fn = uploadSource.slice(start, uploadSource.indexOf('\n  }', start) + 4);
  assert.doesNotMatch(fn, /toString\(36\)\s*\+\s*'_'/, '不得再拼接下划线分隔符');
  assert.match(fn, /Date\.now\(\)\.toString\(36\) \+ Math\.random\(\)\.toString\(36\)\.slice\(2, 10\)/);
  // randomUUID 分支本身已去掉短横线
  assert.match(fn, /crypto\.randomUUID\(\)\.replace\(\/-\/g, ''\)/);
});

test('M6: 前端 MIME 白名单与服务端精确对齐', () => {
  const front = uploadSource.match(/PHOTO_WALL_ALLOWED_IMAGE_MIME = (\/[^\n]+\/i)/);
  const back = fs.readFileSync(path.join(ROOT, 'render-api/photo-create.js'), 'utf8')
    .match(/IMAGE_MIME_TYPE = (\/[^\n]+\/i)/);
  assert.ok(front && back, '两侧白名单都必须存在');
  // 比对类型枚举集合
  const types = (src) => (src.match(/[a-z-]+/g) || []).filter((t) => !['image', 'i'].includes(t)).sort();
  assert.deepStrictEqual(types(front[1]), types(back[1]), '前后端允许的 MIME 类型集合必须一致');
  assert.doesNotMatch(front[1], /\{0,126\}/, '不得再允许任意长后缀');
});

// ─────────────────────────── M7 上传异常链 ───────────────────────────

test('M7: worker 链补上 reject 兜底，单点异常不再中止整批', () => {
  assert.match(uploadSource, /\}\)\.then\(runOne, runOne\);/);
});

test('M7: performUpload 捕获批次异常，保证 failedJobs 仍被登记', () => {
  assert.match(uploadSource, /\} catch \(batchErr\) \{/);
  assert.match(uploadSource, /batch aborted/);
  // failedJobs 赋值必须在 try/catch 之外（catch 后继续执行）
  const catchIdx = uploadSource.indexOf('} catch (batchErr) {');
  const failedJobsIdx = uploadSource.indexOf('state.failedJobs = failures.map');
  assert.ok(failedJobsIdx > catchIdx, 'failedJobs 赋值应位于 catch 之后仍可到达');
});
