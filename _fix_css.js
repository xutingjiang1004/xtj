var fs = require('fs');
var path = require('path');
var fp = path.join(__dirname, 'css', 'style.css');
var c = fs.readFileSync(fp, 'utf8');

// Normalize CRLF to LF
c = c.replace(/\r\n/g, '\n');

function safeReplace(find, repl) {
  if (find.indexOf('\r') > -1) {
    find = find.replace(/\r\n/g, '\n');
  }
  var idx = c.indexOf(find);
  if (idx === -1) {
    console.log('WARN not found:', JSON.stringify(find.slice(0, 60)));
    return false;
  }
  c = c.slice(0, idx) + repl + c.slice(idx + find.length);
  console.log('OK replaced at index', idx, ':', JSON.stringify(find.slice(0, 50)));
  return true;
}

// === Base border section ===
safeReplace(
  '#statModal .stat-row,\n#statRecordsModal .stat-row {\n  width: 100%;',
  '#statModal .stat-row,\n#statRecordsModal .stat-row,\n#profileActivityModal .stat-row {\n  width: 100%;'
);

safeReplace(
  '#statModal .stat-row:first-child,\n#statRecordsModal .stat-row:first-child {',
  '#statModal .stat-row:first-child,\n#statRecordsModal .stat-row:first-child,\n#profileActivityModal .stat-row:first-child {'
);

safeReplace(
  '#statModal .stat-record-thumb,\n#statRecordsModal .stat-record-thumb,',
  '#statModal .stat-record-thumb,\n#statRecordsModal .stat-record-thumb,\n#profileActivityModal .stat-record-thumb,'
);

// === Grid layout ===
safeReplace(
  '#statModal .stat-row,\n#statRecordsModal .stat-row {\n  display: grid;\n  grid-template-columns: 62px minmax(0, 1fr) auto;',
  '#statModal .stat-row,\n#statRecordsModal .stat-row,\n#profileActivityModal .stat-row {\n  display: grid;\n  grid-template-columns: 62px minmax(0, 1fr) auto;'
);

safeReplace(
  '#statModal .stat-row--no-media,\n#statRecordsModal .stat-row--no-media {',
  '#statModal .stat-row--no-media,\n#statRecordsModal .stat-row--no-media,\n#profileActivityModal .stat-row--no-media {'
);

safeReplace(
  '#statModal .stat-row:not([role="button"]),\n#statRecordsModal .stat-row:not([role="button"]) {',
  '#statModal .stat-row:not([role="button"]),\n#statRecordsModal .stat-row:not([role="button"]),\n#profileActivityModal .stat-row:not([role="button"]) {'
);

safeReplace(
  '#statModal .stat-row:hover,\n#statRecordsModal .stat-row:hover {',
  '#statModal .stat-row:hover,\n#statRecordsModal .stat-row:hover,\n#profileActivityModal .stat-row:hover {'
);

safeReplace(
  '#statModal .stat-row-main,\n#statRecordsModal .stat-row-main {',
  '#statModal .stat-row-main,\n#statRecordsModal .stat-row-main,\n#profileActivityModal .stat-row-main {'
);

// === Background scoped section ===
safeReplace(
  '#statModal .stat-surface-card,\n#statModal .stat-user-group,\n#statModal .stat-like-item,\n#statModal .stat-view-item,\n#statModal .stat-comment-item,\n#statModal .stat-two-col .stat-col {',
  '#statModal .stat-surface-card,\n#statModal .stat-user-group,\n#statModal .stat-like-item,\n#statModal .stat-view-item,\n#statModal .stat-comment-item,\n#profileActivityModal .stat-like-item,\n#profileActivityModal .stat-view-item,\n#profileActivityModal .stat-comment-item,\n#statModal .stat-two-col .stat-col {'
);

// === Layout/padding section ===
safeReplace(
  '#statModal .stat-like-item,\n#statModal .stat-view-item,\n#statModal .stat-comment-item {\n  padding: 16px 16px 14px;\n  border-radius: 22px;',
  '#statModal .stat-like-item,\n#statModal .stat-view-item,\n#statModal .stat-comment-item,\n#profileActivityModal .stat-like-item,\n#profileActivityModal .stat-view-item,\n#profileActivityModal .stat-comment-item {\n  padding: 16px 16px 14px;\n  border-radius: 22px;'
);

safeReplace(
  '#statModal .stat-like-item + .stat-like-item,\n#statModal .stat-view-item + .stat-view-item,\n#statModal .stat-comment-item + .stat-comment-item {',
  '#statModal .stat-like-item + .stat-like-item,\n#statModal .stat-view-item + .stat-view-item,\n#statModal .stat-comment-item + .stat-comment-item,\n#profileActivityModal .stat-like-item + .stat-like-item,\n#profileActivityModal .stat-view-item + .stat-view-item,\n#profileActivityModal .stat-comment-item + .stat-comment-item {'
);

safeReplace(
  '#statModal .stat-like-item:hover,\n#statModal .stat-view-item:hover,\n#statModal .stat-comment-item:hover,\n#statModal .stat-user-group:hover,',
  '#statModal .stat-like-item:hover,\n#statModal .stat-view-item:hover,\n#statModal .stat-comment-item:hover,\n#profileActivityModal .stat-like-item:hover,\n#profileActivityModal .stat-view-item:hover,\n#profileActivityModal .stat-comment-item:hover,\n#statModal .stat-user-group:hover,'
);

// === Animation section (first block) ===
safeReplace(
  '#statModal .stat-user-group,\n#statModal .stat-post-item,\n#statModal .stat-like-item,\n#statModal .stat-view-item,\n#statModal .stat-comment-item,\n.chat-list-item {\n  animation: xtjFloatIn',
  '#statModal .stat-user-group,\n#statModal .stat-post-item,\n#statModal .stat-like-item,\n#statModal .stat-view-item,\n#statModal .stat-comment-item,\n#profileActivityModal .stat-like-item,\n#profileActivityModal .stat-view-item,\n#profileActivityModal .stat-comment-item,\n.chat-list-item {\n  animation: xtjFloatIn'
);

// === Animation section (reduced motion) ===
safeReplace(
  '#statModal .stat-user-group,\n  #statModal .stat-post-item,\n  #statModal .stat-like-item,\n  #statModal .stat-view-item,\n  #statModal .stat-comment-item,\n  .chat-list-item {\n    animation: none;',
  '#statModal .stat-user-group,\n  #statModal .stat-post-item,\n  #statModal .stat-like-item,\n  #statModal .stat-view-item,\n  #statModal .stat-comment-item,\n  #profileActivityModal .stat-like-item,\n  #profileActivityModal .stat-view-item,\n  #profileActivityModal .stat-comment-item,\n  .chat-list-item {\n    animation: none;'
);

// === Responsive 720px ===
safeReplace(
  '#statModal .stat-row,\n  #statRecordsModal .stat-row {\n    grid-template-columns: 58px minmax(0, 1fr);\n  }\n\n  #statModal .stat-row-side,\n  #statRecordsModal .stat-row-side {',
  '#statModal .stat-row,\n  #statRecordsModal .stat-row,\n  #profileActivityModal .stat-row {\n    grid-template-columns: 58px minmax(0, 1fr);\n  }\n\n  #statModal .stat-row-side,\n  #statRecordsModal .stat-row-side,\n  #profileActivityModal .stat-row-side {'
);

// === Modal override section - selectors shared with stat modals ===
safeReplace(
  '#profileActivityModal .profile-activity-title,\n#statModal .stat-row-title,',
  '#profileActivityModal .stat-row-title,\n#statModal .stat-row-title,'
);
safeReplace(
  '#profileActivityModal .profile-activity-inline-summary,\n#profileActivityModal .profile-activity-body,\n#profileActivityModal .profile-activity-body * {',
  '#profileActivityModal .stat-row-copy .stat-record-note {'
);
safeReplace(
  '#profileActivityModal .profile-activity-body,\n#statModal .stat-row-copy,',
  '#profileActivityModal .stat-row-copy,\n#statModal .stat-row-copy,'
);
safeReplace(
  '#profileActivityModal .profile-activity-note,\n#statModal .stat-record-note,',
  '#profileActivityModal .stat-record-note,\n#statModal .stat-record-note,'
);
safeReplace(
  '#profileActivityModal .profile-activity-note--accent,\n#statModal .stat-record-note:first-child,',
  '#profileActivityModal .stat-record-note:first-child,\n#statModal .stat-record-note:first-child,'
);
safeReplace(
  '#profileActivityModal .profile-activity-media-col,\n#statModal .stat-row-media,',
  '#profileActivityModal .stat-row-media,\n#statModal .stat-row-media,'
);
safeReplace(
  '#profileActivityModal .profile-activity-media,\n#profileActivityModal .profile-activity-video,\n#statModal .stat-record-thumb,',
  '#statModal .stat-record-thumb,\n#profileActivityModal .stat-record-thumb,'
);
safeReplace(
  '#profileActivityModal .profile-activity-side,\n#statModal .stat-record-entry .stat-row-side,\n#statModal .stat-view-item .stat-row-side,',
  '#profileActivityModal .stat-row-side,\n#statModal .stat-record-entry .stat-row-side,\n#statModal .stat-view-item .stat-row-side,'
);
safeReplace(
  '#profileActivityModal .profile-activity-time,\n#profileActivityModal .profile-activity-kicker,',
  '#profileActivityModal .stat-row-time,'
);
safeReplace(
  '#profileActivityModal .profile-activity-actions,\n#statModal .stat-record-entry .stat-row-side .stat-record-action,\n#statModal .stat-view-item .stat-row-side .stat-record-action,',
  '#statModal .stat-record-entry .stat-row-side .stat-record-action,\n#statModal .stat-view-item .stat-row-side .stat-record-action,\n#profileActivityModal .stat-record-entry .stat-row-side .stat-record-action,'
);

// === Dark mode ===
safeReplace(
  '[data-theme="dark"] .post-detail-header,\n        [data-theme="dark"] .post-detail-content,\n        [data-theme="dark"] .stat-like-item,\n        [data-theme="dark"] .stat-view-item,\n        [data-theme="dark"] .stat-comment-item,',
  '[data-theme="dark"] .post-detail-header,\n        [data-theme="dark"] .post-detail-content,\n        [data-theme="dark"] .stat-like-item,\n        [data-theme="dark"] .stat-view-item,\n        [data-theme="dark"] .stat-comment-item,\n        #profileActivityModal .stat-like-item,\n        #profileActivityModal .stat-view-item,\n        #profileActivityModal .stat-comment-item,'
);

// Write back with LF
fs.writeFileSync(fp, c, 'utf8');
console.log('CSS DONE');
