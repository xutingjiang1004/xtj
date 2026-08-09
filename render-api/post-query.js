/** Public/normal post query filters (media_type allowlist). */
'use strict';

// 集中处理普通帖子 / 总动态 / 后台管理 / 统计 端点需要排除的 system media_type
// 与前端 applyVisiblePostQueryFilters 保持一致（22 个 marker）
// 必须放在所有 marker 常量定义之后、路由定义之前
// 正常帖子白名单：只允许这些 media_type 作为帖子出现在搜索结果中
var NORMAL_POST_MEDIA_TYPES = ['text', 'image', 'video', 'audio', 'photo', 'album'];
var NORMAL_POST_EMPTY_MEDIA_FILTER = 'media_type.eq.""';
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
