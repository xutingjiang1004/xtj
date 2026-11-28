'use strict';

// 帖子权限模型（公开 / 私密 / 仅谁可见 / 仅谁不可见）：
//   · public     -> DB visibility = 'public'   （所有人含访客可见）
//   · private    -> DB visibility = 'private'  （仅作者本人可见，管理员亦不可看）
//   · allow_list -> DB visibility = 'unlisted' （仅作者 + visibility_users 中用户可见，访客不可见）
//   · deny_list  -> DB visibility = 'unlisted' （作者 + 除 visibility_users 外的已登录用户可见，访客不可见以防登出绕过）
//
// 为什么 allow_list / deny_list 落到 DB visibility = 'unlisted'：
//   1. 线上 posts_visibility_check 已原生允许 ('public','private','unlisted')，无需数据库迁移；
//   2. Supabase 匿名 RLS 仅放行 visibility IS NULL OR visibility = 'public'，
//      因此任何未走后端鉴权的直连查询都无法读到 private 或 unlisted 帖子；
//   3. 缺少 content 或 metadata 异常的 unlisted 行默认 fail-closed 视为 private（仅作者可见）。

const POST_VISIBILITY_MODES = ['public', 'private', 'allow_list', 'deny_list'];
const MAX_VISIBILITY_USERS = 200;
const MAX_USERNAME_LEN = 64;

function cleanUsername(value) {
  const name = String(value == null ? '' : value).trim();
  if (!name || name.length > MAX_USERNAME_LEN || /[\x00-\x1f\x7f]/.test(name)) return '';
  return name;
}

function cleanVisibilityUsers(list, authorName) {
  if (!Array.isArray(list)) return [];
  const author = cleanUsername(authorName);
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length && out.length < MAX_VISIBILITY_USERS; i++) {
    const name = cleanUsername(list[i]);
    if (!name || (author && name === author) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function extractPostContentMeta(post) {
  if (!post || typeof post !== 'object') return null;
  if (post._contentMeta && typeof post._contentMeta === 'object' && !Array.isArray(post._contentMeta)) {
    return post._contentMeta;
  }
  const raw = typeof post.content === 'string' ? post.content : '';
  if (!raw || (raw.charAt(0) !== '{' && !/^\s*\{/.test(raw))) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.__type === '__xtj_post_v2__' && parsed.meta && typeof parsed.meta === 'object' && !Array.isArray(parsed.meta)) {
      return parsed.meta;
    }
  } catch (_) {}
  return null;
}

function dbVisibilityForMode(mode) {
  const m = String(mode || 'public').trim().toLowerCase();
  if (m === 'private') return 'private';
  if (m === 'allow_list' || m === 'deny_list') return 'unlisted';
  return 'public';
}

function parsePostVisibility(post) {
  if (!post || typeof post !== 'object') {
    return { mode: 'private', users: [], dbVisibility: 'private' };
  }
  const dbVis = String(post.visibility == null ? 'public' : post.visibility).trim().toLowerCase() || 'public';
  if (dbVis === 'private') {
    return { mode: 'private', users: [], dbVisibility: 'private' };
  }
  const meta = extractPostContentMeta(post);
  if (dbVis === 'unlisted') {
    const rawMode = String(meta && meta.visibility_mode || '').trim().toLowerCase();
    if (rawMode === 'allow_list' || rawMode === 'deny_list') {
      return {
        mode: rawMode,
        users: cleanVisibilityUsers(meta.visibility_users, post.user_name),
        dbVisibility: 'unlisted'
      };
    }
    // Fail-closed：unlisted 行缺少合法受众元数据时，退化为仅作者可见。
    return { mode: 'private', users: [], dbVisibility: 'unlisted' };
  }
  if (dbVis === 'public') {
    return { mode: 'public', users: [], dbVisibility: 'public' };
  }
  // 未知 visibility 值同样 fail-closed
  return { mode: 'private', users: [], dbVisibility: dbVis };
}

function canUserViewPost(post, viewerUserName) {
  if (!post || typeof post !== 'object' || post.is_deleted === true) return false;
  const viewer = cleanUsername(viewerUserName);
  const author = cleanUsername(post.user_name);
  const vis = parsePostVisibility(post);
  if (vis.mode === 'public') return true;
  if (!viewer) return false; // 私密 / 仅谁可见 / 仅谁不可见 对未登录访客一律不可见
  if (author && viewer === author) return true;
  if (vis.mode === 'private') return false;
  if (vis.mode === 'allow_list') return vis.users.indexOf(viewer) >= 0;
  if (vis.mode === 'deny_list') return vis.users.indexOf(viewer) < 0;
  return false;
}

function applyPostVisibilityToContent(rawContent, mode, users, authorName) {
  const safeMode = POST_VISIBILITY_MODES.indexOf(String(mode || '').trim().toLowerCase()) >= 0
    ? String(mode).trim().toLowerCase()
    : 'public';
  const dbVis = dbVisibilityForMode(safeMode);
  const cleanUsers = (safeMode === 'allow_list' || safeMode === 'deny_list')
    ? cleanVisibilityUsers(users, authorName)
    : [];

  const textStr = String(rawContent == null ? '' : rawContent);
  let text = textStr;
  let meta = {};
  if (textStr.charAt(0) === '{' || /^\s*\{/.test(textStr)) {
    try {
      const parsed = JSON.parse(textStr);
      if (parsed && parsed.__type === '__xtj_post_v2__' && typeof parsed === 'object') {
        text = typeof parsed.text === 'string' ? parsed.text : '';
        meta = parsed.meta && typeof parsed.meta === 'object' && !Array.isArray(parsed.meta)
          ? Object.assign({}, parsed.meta)
          : {};
      }
    } catch (_) {}
  }

  meta.visibility = dbVis;
  meta.visibility_mode = safeMode;
  if (cleanUsers.length) {
    meta.visibility_users = cleanUsers;
  } else {
    delete meta.visibility_users;
  }

  return {
    dbVisibility: dbVis,
    mode: safeMode,
    users: cleanUsers,
    content: JSON.stringify({ __type: '__xtj_post_v2__', text: text, meta: meta })
  };
}

// 非作者查看有受众名单的帖子时，剥离 visibility_users 与 visibility_mode，
// 防止通过抓包窥探作者设置的可见/不可见用户名单。
function stripPostVisibilityAudience(post, viewerUserName) {
  if (!post || typeof post !== 'object') return post;
  const viewer = cleanUsername(viewerUserName);
  const author = cleanUsername(post.user_name);
  if (viewer && author && viewer === author) return post;
  const raw = typeof post.content === 'string' ? post.content : '';
  if (!raw || (raw.charAt(0) !== '{' && !/^\s*\{/.test(raw))) return post;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.__type !== '__xtj_post_v2__' || !parsed.meta || typeof parsed.meta !== 'object' || Array.isArray(parsed.meta)) {
      return post;
    }
    const hasUsers = Object.prototype.hasOwnProperty.call(parsed.meta, 'visibility_users');
    const hasCustomMode = parsed.meta.visibility_mode === 'allow_list' || parsed.meta.visibility_mode === 'deny_list';
    if (!hasUsers && !hasCustomMode) return post;
    const nextMeta = Object.assign({}, parsed.meta);
    delete nextMeta.visibility_users;
    if (hasCustomMode) nextMeta.visibility_mode = 'restricted';
    return Object.assign({}, post, {
      content: JSON.stringify({ __type: '__xtj_post_v2__', text: parsed.text || '', meta: nextMeta })
    });
  } catch (_) {
    return post;
  }
}

module.exports = {
  POST_VISIBILITY_MODES,
  MAX_VISIBILITY_USERS,
  cleanVisibilityUsers,
  dbVisibilityForMode,
  parsePostVisibility,
  canUserViewPost,
  applyPostVisibilityToContent,
  stripPostVisibilityAudience
};
