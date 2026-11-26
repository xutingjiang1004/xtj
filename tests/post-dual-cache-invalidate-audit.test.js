'use strict';
// E-H4 双轨缓存：early-feed 的 v1 缓存 7 天，core 的 v8 缓存 5 分钟。
// 写操作（删帖/置顶/改可见性/发布）成功后 core 只清 v8，不清 v1；
// 下次回访服务器慢或失败时，early-feed 会把已删/已私密的旧帖子
// 从 v1 里再画出来。修复：写操作成功后同时清 v1；7 天离线兜底本身不动。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

const early = fs.readFileSync('js/early-feed.js', 'utf8');
const posts = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');

test('early-feed 暴露清 v1 缓存的入口', () => {
  assert.ok(early.indexOf('__xtjClearEarlyFeedCache') > 0, 'early-feed 缺少 __xtjClearEarlyFeedCache');
  const start = early.indexOf('__xtjClearEarlyFeedCache');
  const block = early.slice(start, start + 400);
  assert.match(block, /removeItem\(FEED_CACHE_KEY\)|removeItem\('xtj_feed_cache_v1'\)/,
    '清缓存入口应删除 v1 键');
});

test('帖子模块有“同时清 v8 + v1”的写操作失效入口', () => {
  const start = posts.indexOf('function invalidateFeedCaches');
  assert.ok(start > 0, '缺少 invalidateFeedCaches');
  const block = posts.slice(start, start + 800);
  assert.match(block, /clearFeedCache\(\)/, '应先清 v8');
  assert.match(block, /clearEarlyFeedCacheV1\(\)/, '应同时清 early-feed 的 v1');
  const v1start = posts.indexOf('function clearEarlyFeedCacheV1');
  assert.ok(v1start > 0, '缺少 clearEarlyFeedCacheV1');
  const v1block = posts.slice(v1start, v1start + 600);
  assert.match(v1block, /__xtjClearEarlyFeedCache|xtj_feed_cache_v1/,
    'clearEarlyFeedCacheV1 应删除 v1 键');
});

test('删帖确认后同时清两份缓存', () => {
  const start = posts.indexOf('function applyConfirmedPostDeletion');
  assert.ok(start > 0, '缺少 applyConfirmedPostDeletion');
  const block = posts.slice(start, start + 900);
  assert.match(block, /invalidateFeedCaches\(\)/, '删帖后应调用 invalidateFeedCaches');
});

test('改可见性成功后同时清两份缓存', () => {
  const start = posts.indexOf('已设为私密');
  assert.ok(start > 0, '缺少改可见性成功分支');
  const block = posts.slice(Math.max(0, start - 900), start + 200);
  assert.match(block, /invalidateFeedCaches\(\)/, '改可见性后应调用 invalidateFeedCaches');
});

test('发布成功后 v1 也失效（新帖不再被旧的第一页缓存挡住）', () => {
  const start = posts.indexOf("if (!insertPublishedPostIntoFeed(insertRes.data, !!publishMotion))");
  assert.ok(start > 0, '缺少发布成功分支');
  const block = posts.slice(start, start + 700);
  assert.match(block, /invalidateFeedCaches\(\)|clearEarlyFeedCacheV1\(\)/,
    '发布成功后应让 v1 失效');
});

test('搜索/筛选切换不碰 v1（7 天离线兜底不受影响）', () => {
  // 4492 附近：关键词变化时只清 v8 并重拉，不应顺带删掉离线可用的 v1。
  const start = posts.indexOf('markFeedStateChanged();clearFeedCache();return loadFeed(true);');
  assert.ok(start > 0, '搜索切换分支已变动，人工复核');
  assert.doesNotMatch(posts.slice(start, start + 120), /invalidateFeedCaches/,
    '搜索切换不应调用 invalidateFeedCaches');
});
