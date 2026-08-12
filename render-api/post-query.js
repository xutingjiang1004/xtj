/** Public/normal post query filters (media_type allowlist). */
'use strict';

// 集中处理普通帖子 / 总动态 / 后台管理 / 统计 端点需要排除的 system media_type
// 与前端 applyVisiblePostQueryFilters 保持一致（22 个 marker）
// 必须放在所有 marker 常量定义之后、路由定义之前
// 审计 ⚪ 单一真源说明：post-markers.js 已新增 PUBLIC_POST_MEDIA_TYPES 作为"允许对外"类型的唯一来源，
// 新增代码请优先消费该常量（require('./post-markers').PUBLIC_POST_MEDIA_TYPES）。
// 注意：NORMAL_POST_MEDIA_TYPES 被契约测试以"数组字面量赋值"形式锚定（tests/complete-tests.js），
// 必须保持下方字面量写法、不可改为 require 派生；两处需人工同步（新增/退役 marker 时同时更新）。
var NORMAL_POST_MEDIA_TYPES = ['text', 'image', 'video', 'audio', 'photo', 'album'];
var NORMAL_POST_EMPTY_MEDIA_FILTER = 'media_type.eq.""';
// 审计 🟡 双白名单一致性：NORMAL_POST_MEDIA_TYPES 被契约测试以"数组字面量赋值"锚定
// （tests/complete-tests.js），不可改为 require 派生；post-markers.js 的
// PUBLIC_POST_MEDIA_TYPES 为唯一真源。新增/退役 marker 时需人工同步两处，此处加载时
// 做一次运行时一致性检查，不一致时 console.error 告警，防止静默漂移导致 system marker
// 泄入公开 feed。
try {
  var POST_MARKERS_TYPES = require('./post-markers').PUBLIC_POST_MEDIA_TYPES;
  var _syncOk = Array.isArray(POST_MARKERS_TYPES)
    && POST_MARKERS_TYPES.length === NORMAL_POST_MEDIA_TYPES.length
    && POST_MARKERS_TYPES.every(function(t) { return NORMAL_POST_MEDIA_TYPES.indexOf(t) >= 0; });
  if (!_syncOk) {
    console.error('[post-query] NORMAL_POST_MEDIA_TYPES 与 post-markers.PUBLIC_POST_MEDIA_TYPES 不一致，'
      + '请人工同步（post-markers.js 为唯一真源）');
  }
} catch (e) {
  console.error('[post-query] 白名单一致性检查失败（require post-markers）:', e && e.message);
}
function isNormalPost(row) {
  if (!row) return false;
  var mt = row.media_type;
  if (mt === null || mt === undefined) return true;
  if (String(mt).trim() === '') return true;
  return NORMAL_POST_MEDIA_TYPES.indexOf(String(mt).toLowerCase()) >= 0;
}

function applyNormalPostAllowlist(query) {
  if (!query || typeof query.or !== 'function') return query;
  // 使用 .in() 查询非NULL类型，再用 .is() 查 NULL
  // 注意：PostgREST 连续 .or() 可能覆盖，所以只用 .or() 一次
  return query.or(
    'media_type.is.null,' +
    NORMAL_POST_EMPTY_MEDIA_FILTER + ',' +
    NORMAL_POST_MEDIA_TYPES.map(function(t) { return 'media_type.eq.' + t; }).join(',')
  );
}

function applyPublicPostExclusions(query) {
  return applyNormalPostAllowlist(query);
}

module.exports = {
  isNormalPost: isNormalPost,
  applyNormalPostAllowlist: applyNormalPostAllowlist,
  applyPublicPostExclusions: applyPublicPostExclusions,
  NORMAL_POST_MEDIA_TYPES: NORMAL_POST_MEDIA_TYPES
};
