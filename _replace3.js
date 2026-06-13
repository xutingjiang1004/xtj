const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'js', 'core.js');
let content = fs.readFileSync(filePath, 'utf8');
const EOL = '\r\n'; // Windows line endings

console.log('File length:', content.length, 'chars');
console.log('Has CRLF:', content.includes('\r\n'));

// 1. Replace ALL occurrences of profile-activity-btn with stat-record-action
const btnCount = (content.match(/profile-activity-btn is-danger/g) || []).length;
content = content.replace(/profile-activity-btn is-danger/g, 'stat-record-action is-danger');
console.log('btn class replaced, count:', btnCount);

// 2. Replace the return HTML structure (with CRLF)
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
].join(EOL);

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
].join(EOL);

const htmlIdx = content.indexOf(oldHtmlBlock);
if (htmlIdx >= 0) {
  content = content.slice(0, htmlIdx) + newHtmlBlock + content.slice(htmlIdx + oldHtmlBlock.length);
  console.log('HTML block replaced OK at index', htmlIdx);
} else {
  console.error('FAILED: HTML block not found - checking alternatives');
  // Try without \r\n
  const altBlock = oldHtmlBlock.replace(/\r\n/g, '\n');
  const altIdx = content.indexOf(altBlock);
  if (altIdx >= 0) {
    const altNewBlock = newHtmlBlock.replace(/\r\n/g, '\n');
    content = content.slice(0, altIdx) + altNewBlock + content.slice(altIdx + altBlock.length);
    console.log('HTML block replaced OK (LF mode) at index', altIdx);
  } else {
    console.error('STILL FAILED. Looking for Math.min(index * 28...');
    const idx = content.indexOf('Math.min(index * 28');
    if (idx >= 0) {
      console.log('Found at', idx);
      console.log('Context:', JSON.stringify(content.substring(Math.max(0, idx - 100), idx + 300)));
    }
  }
}

// 3. Double check: remove any leftover titlePrefix references
if (!content.includes('var titlePrefix')) {
  console.log('titlePrefix var removed (expected)');
} else {
  console.log('WARNING: titlePrefix still exists');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('DONE - file saved');
