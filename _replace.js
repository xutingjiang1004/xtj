const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'js', 'core.js');
let content = fs.readFileSync(filePath, 'utf8');

console.log('File length:', content.length, 'chars');

// 1. Replace profileActivityMedia class names
content = content.replace(
  'return \'<img class="profile-activity-media"',
  'return \'<img class="stat-record-thumb"'
);
content = content.replace(
  'return \'<div class="profile-activity-video"',
  'return \'<div class="stat-record-thumb stat-record-thumb--video"'
);
console.log('profileActivityMedia class names replaced');

// 2. Replace summary fallback
content = content.replace(
  "var summary = post ? profileActivitySummary(post) : '原帖已不可用';",
  "var summary = post ? profileActivitySummary(post) : '（帖子已删除）';"
);

// 3. Replace the map function body - noteParts -> noteHtml
const oldNotesBlock = [
  "                    var postText = normalized ? repairProfileActivityText(normalized.content || '') : '';",
  "                    var commentText = repairProfileActivityText(item.content || '');",
  "                    var titlePrefix = isLikes ? '点赞了这条帖子' : '评论了这条帖子';",
  "                    var noteParts = [];",
  "                    if (!isLikes && commentText) {",
  "                        noteParts.push('<div class=\"profile-activity-note profile-activity-note--accent\">我的评论：' + escapeHtml(commentText) + '</div>');",
  "                    }",
  "                    if (hasMedia && postText) {",
  "                        noteParts.push('<div class=\"profile-activity-note\">原帖：' + escapeHtml(postText.length > 48 ? postText.slice(0, 48) + '...' : postText) + '</div>');",
  "                    } else if (summary === '无文字内容') {",
  "                        noteParts.push('<div class=\"profile-activity-note\">原帖没有文字内容</div>');",
  "                    } else if (summary) {",
  "                        noteParts.push('<div class=\"profile-activity-note\">原帖：' + escapeHtml(summary) + '</div>');",
  "                    }",
  "                    if (!noteParts.length) {",
  "                        noteParts.push('<div class=\"profile-activity-note\">原帖已不可用</div>');",
  "                    }",
].join('\n');

const newNotesBlock = [
  "                    var commentText = repairProfileActivityText(item.content || '');",
  "                    var noteHtml = '';",
  "                    if (!isLikes && commentText) {",
  "                        noteHtml = '<div class=\"stat-record-note\">我的评论：' + escapeHtml(commentText) + '</div>';",
  "                    } else if (isLikes && post) {",
  "                        var postText = normalized ? repairProfileActivityText(normalized.content || '') : '';",
  "                        if (postText) {",
  "                            noteHtml = '<div class=\"stat-record-note\">' + escapeHtml(postText.length > 36 ? postText.slice(0, 36) + '...' : postText) + '</div>';",
  "                        }",
  "                    }",
].join('\n');

if (content.includes(oldNotesBlock)) {
  content = content.replace(oldNotesBlock, newNotesBlock);
  console.log('notes block replaced OK');
} else {
  console.error('FAILED: notes block not found');
  const idx = content.indexOf('var titlePrefix');
  if (idx >= 0) {
    console.log('Found var titlePrefix at', idx);
    console.log('Context:', content.substring(idx, 300));
  }
}

// 4. Replace action button class
content = content.replace(
  "class=\"profile-activity-btn is-danger\"",
  "class=\"stat-record-action is-danger\""
);
console.log('btn class replaced');

// 5. Replace the return HTML structure
const oldHtmlBlock = [
  "                    return [",
  "                        '<article class=\"profile-activity-item' + (hasMedia ? ' has-media' : ' no-media') + (canOpenPost ? '' : ' is-disabled') + '\"' + cardAttrs + ' style=\"--xtj-enter-delay:' + Math.min(index * 28, 180) + 'ms;\">',",
  "                        '<div class=\"profile-activity-main\">',",
  "                        '<div class=\"profile-activity-title\">' + escapeHtml(titlePrefix) + '</div>',",
  "                        '<div class=\"profile-activity-body\">' + noteParts.join('') + '</div>',",
  "                        '</div>',",
  "                        hasMedia ? '<div class=\"profile-activity-media-col\">' + mediaHtml + '</div>' : '',",
  "                        '<div class=\"profile-activity-side\"><span class=\"profile-activity-time\">' + new Date(item.created_at).toLocaleString() + '</span><div class=\"profile-activity-actions\">' + actionHtml + '</div></div>',",
  "                        '</article>'",
  "                    ].join('');",
].join('\n');

const newHtmlBlock = [
  "                    return [",
  "                        '<article class=\"stat-record-entry stat-row ' + (isLikes ? 'stat-like-item' : 'stat-comment-item') + (mediaHtml ? '' : ' stat-row--no-media') + (canOpenPost ? '' : ' is-disabled') + '\"' + cardAttrs + ' style=\"--xtj-enter-delay:' + Math.min(index * 26, 220) + 'ms;\">',",
  "                        statMediaColumnMarkup(mediaHtml),",
  "                        '<div class=\"stat-row-main\">',",
  "                        '<div class=\"stat-row-title\">' + escapeHtml(currentUser.user_metadata?.full_name || currentUser.email || '我') + (isLikes ? ' 点赞了：' : ' 评论了：') + '</div>',",
  "                        '<div class=\"stat-row-copy\">' + escapeHtml(summary) + noteHtml + '</div>',",
  "                        '</div>',",
  "                        '<div class=\"stat-row-side\"><span class=\"stat-row-time\">' + new Date(item.created_at).toLocaleString() + '</span>' + actionHtml + '</div>',",
  "                        '</article>'",
  "                    ].join('');",
].join('\n');

if (content.includes(oldHtmlBlock)) {
  content = content.replace(oldHtmlBlock, newHtmlBlock);
  console.log('HTML block replaced OK');
} else {
  console.error('FAILED: HTML block not found');
  const idx = content.indexOf('Math.min(index * 28');
  if (idx >= 0) {
    console.log('Found at', idx);
    console.log('Context:', content.substring(Math.max(0, idx - 50), idx + 200));
  }
}

// 6. Add hasMedia and canOpenPost declarations that might have been removed
// Check if they exist after the summary line
const checkVars = "var hasMedia = !!(normalized && normalized.media_url);";
if (!content.includes(checkVars)) {
  // They might have been removed with the notes block change, need to add them back
  const summaryLine = "var summary = post ? profileActivitySummary(post) : '（帖子已删除）';";
  const summaryIdx = content.indexOf(summaryLine);
  if (summaryIdx >= 0) {
    const afterSummary = content.indexOf('\n', summaryIdx) + 1;
    const insertVars = [
      "                    var hasMedia = !!(normalized && normalized.media_url);",
      "                    var canOpenPost = !!(post && item.post_id);",
    ].join('\n');
    content = content.slice(0, afterSummary) + insertVars + '\n' + content.slice(afterSummary);
    console.log('Added missing hasMedia/canOpenPost vars');
  }
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('DONE - file saved');
