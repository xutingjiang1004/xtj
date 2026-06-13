const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'js', 'core.js');
let content = fs.readFileSync(filePath, 'utf8');

// Use universal newline split
const lines = content.split(/\r?\n/);
console.log('Total lines:', lines.length);

let changed = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // 1. profileActivityMedia: img class
  if (line.includes("return '<img class=\"profile-activity-media\"")) {
    lines[i] = line.replace('profile-activity-media', 'stat-record-thumb');
    changed++;
    console.log('Line', i, ': img class');
  }

  // 2. profileActivityMedia: video class
  if (line.includes("return '<div class=\"profile-activity-video\"")) {
    lines[i] = line.replace('profile-activity-video"', 'stat-record-thumb stat-record-thumb--video"');
    changed++;
    console.log('Line', i, ': video class');
  }

  // 3. summary fallback
  if (line.includes("var summary = post ? profileActivitySummary") && line.includes("原帖已不可用")) {
    lines[i] = "                    var summary = post ? profileActivitySummary(post) : '（帖子已删除）';";
    changed++;
    console.log('Line', i, ': summary');
  }

  // 4. Remove var postText declaration (it was moved)
  if (line.includes("var postText = normalized ? repairProfileActivityText")) {
    lines[i] = ''; // will be removed later
    changed++;
    console.log('Line', i, ': removed postText');
  }

  // 5. Remove var titlePrefix
  if (line.includes("var titlePrefix = isLikes ?")) {
    lines[i] = ''; // will be removed later
    changed++;
    console.log('Line', i, ': removed titlePrefix');
  }

  // 6. Replace var noteParts = []
  if (line.includes("var noteParts = [];")) {
    lines[i] = "                    var noteHtml = '';";
    changed++;
    console.log('Line', i, ': noteHtml init');
  }

  // 7. Replace noteParts.push calls
  if (line.includes("noteParts.push('<div class=\"profile-activity-note")) {
    if (line.includes('profile-activity-note--accent')) {
      lines[i] = "                        noteHtml = '<div class=\"stat-record-note\">我的评论：' + escapeHtml(commentText) + '</div>';";
    } else {
      // Remove old push lines
      lines[i] = '';
    }
    changed++;
    console.log('Line', i, ': note replacement');
  }

  // 8. Replace the if/else chain for showing post text
  if (line.includes("if (hasMedia && postText) {")) {
    lines[i] = "                    } else if (isLikes && post) {";
    changed++;
    console.log('Line', i, ': if hasMedia');
  }

  if (line.includes("noteParts.push('<div class=\"profile-activity-note\">原帖：' + escapeHtml(postText.length > 48 ? postText.slice(0, 48) + '...' : postText)")) {
    lines[i] = "                        var postText = normalized ? repairProfileActivityText(normalized.content || '') : '';";
    changed++;
    console.log('Line', i, ': noteParts orig post');
  }

  if (line.includes("} else if (summary === '无文字内容') {")) {
    lines[i] = "                        if (postText) {";
    changed++;
    console.log('Line', i, ': no text');
  }

  if (line.includes("noteParts.push('<div class=\"profile-activity-note\">原帖没有文字内容</div>')")) {
    lines[i] = "                            noteHtml = '<div class=\"stat-record-note\">' + escapeHtml(postText.length > 36 ? postText.slice(0, 36) + '...' : postText) + '</div>';";
    changed++;
    console.log('Line', i, ': no text note');
  }

  if (line.includes("} else if (summary) {")) {
    lines[i] = "                        }";
    changed++;
    console.log('Line', i, ': else summary');
  }

  if (line.includes("noteParts.push('<div class=\"profile-activity-note\">原帖：' + escapeHtml(summary) + '</div>')")) {
    lines[i] = ''; // removed
    changed++;
    console.log('Line', i, ': summary note');
  }

  if (line.includes("if (!noteParts.length) {")) {
    lines[i] = ''; // removed
    changed++;
    console.log('Line', i, ': no parts check');
  }

  if (line.includes("noteParts.push('<div class=\"profile-activity-note\">原帖已不可用</div>')")) {
    lines[i] = ''; // removed
    changed++;
    console.log('Line', i, ': unavailable note');
  }

  // 9. Replace action button class
  if (line.includes('profile-activity-btn is-danger')) {
    lines[i] = line.replace(/profile-activity-btn is-danger/g, 'stat-record-action is-danger');
    changed++;
    console.log('Line', i, ': btn class');
  }

  // 10. Replace the return HTML structure
  if (line.includes("'<article class=\"profile-activity-item' + (hasMedia")) {
    lines[i] = "                        '<article class=\"stat-record-entry stat-row ' + (isLikes ? 'stat-like-item' : 'stat-comment-item') + (mediaHtml ? '' : ' stat-row--no-media') + (canOpenPost ? '' : ' is-disabled') + '\"' + cardAttrs + ' style=\"--xtj-enter-delay:' + Math.min(index * 26, 220) + 'ms;\">',";
    changed++;
    console.log('Line', i, ': article class');
  }

  if (line.includes("'<div class=\"profile-activity-main\">'")) {
    lines[i] = "                        statMediaColumnMarkup(mediaHtml),";
    changed++;
    console.log('Line', i, ': main -> media');
  }

  if (line.includes("'<div class=\"profile-activity-title\">' + escapeHtml(titlePrefix) + '</div>'")) {
    lines[i] = "                        '<div class=\"stat-row-main\">',";
    changed++;
    console.log('Line', i, ': title -> row-main');
  }

  if (line.includes("'<div class=\"profile-activity-body\">' + noteParts.join('') + '</div>'")) {
    lines[i] = "                        '<div class=\"stat-row-title\">' + escapeHtml(currentUser.user_metadata?.full_name || currentUser.email || '我') + (isLikes ? ' 点赞了：' : ' 评论了：') + '</div>',";
    changed++;
    console.log('Line', i, ': body -> row-title');
  }

  if (line.includes("hasMedia ? '<div class=\"profile-activity-media-col\">' + mediaHtml + '</div>' : ''")) {
    lines[i] = "                        '<div class=\"stat-row-copy\">' + escapeHtml(summary) + noteHtml + '</div>',";
    changed++;
    console.log('Line', i, ': media-col -> row-copy');
  }

  if (line.includes("'<div class=\"profile-activity-side\">")) {
    lines[i] = "                        '</div>',";
    changed++;
    console.log('Line', i, ': side -> /div');
  }

  if (line.includes("'<div class=\"profile-activity-side\"><span class=\"profile-activity-time\">' + new Date(item.created_at).toLocaleString() + '</span><div class=\"profile-activity-actions\">' + actionHtml + '</div></div>'")) {
    // Already handled by the previous match, this is a backup
    lines[i] = "                        '<div class=\"stat-row-side\"><span class=\"stat-row-time\">' + new Date(item.created_at).toLocaleString() + '</span>' + actionHtml + '</div>',";
    changed++;
    console.log('Line', i, ': side/time/actions');
  }
}

// Now rebuild, removing empty lines
const cleaned = lines.filter(l => l !== '').join('\n');
fs.writeFileSync(filePath, cleaned, 'utf8');
console.log('DONE - changed:', changed, 'lines, output lines:', cleaned.split('\n').length);
