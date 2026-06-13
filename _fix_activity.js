var fs = require('fs');
var path = require('path');
var fp = path.join(__dirname, 'js', 'core.js');
var c = fs.readFileSync(fp, 'utf8');

var startMarker = 'function buildProfileActivityListMarkup(kind, limit) {';
var endMarker = 'function renderProfileActivityList(kind) {';

var si = c.indexOf(startMarker);
var ei = c.indexOf(endMarker);
if (si === -1 || ei === -1) { console.log('NOT FOUND'); process.exit(1); }

var before = c.slice(0, si);
var after = c.slice(ei);

var newFunc = 
'            function buildProfileActivityListMarkup(kind, limit) {\n' +
'                var isLikes = kind === \'likes\';\n' +
'                var items = isLikes ? (profileActivityState.likes || []) : (profileActivityState.comments || []);\n' +
'                var totals = profileActivityState.totals || {};\n' +
'                var exactCount = isLikes ? (totals.likes || 0) : (totals.comments || 0);\n' +
'                if (!currentUser) {\n' +
'                    return {\n' +
'                        html: \'<div class="profile-activity-empty">登录后，这里会显示你的点赞和评论记录。</div>\',\n' +
'                        totalCount: 0,\n' +
'                        hasMore: false\n' +
'                    };\n' +
'                }\n' +
'                if (!items.length) {\n' +
'                    return {\n' +
'                        html: \'<div class="profile-activity-empty">\' + (isLikes ? \'你还没有点赞任何帖子。\' : \'你还没有留下评论记录。\') + \'</div>\',\n' +
'                        totalCount: 0,\n' +
'                        hasMore: false\n' +
'                    };\n' +
'                }\n' +
'                var visibleItems = typeof limit === \'number\' ? items.slice(0, limit) : items.slice();\n' +
'                var html = visibleItems.map(function(item, index) {\n' +
'                    var post = getProfileActivityPost(item.post_id);\n' +
'                    var normalized = normalizePost(post || {});\n' +
'                    var mediaHtml = post ? profileActivityMedia(post, item.post_id) : \'\';\n' +
'                    var openPostOnclick = "openProfileActivityPost(\'" + safeJsStr(String(item.post_id)) + "\')";\n' +
'                    var summary = post ? profileActivitySummary(post) : \'（帖子已删除）\';\n' +
'                    var canOpenPost = !!(post && item.post_id);\n' +
'                    var commentText = repairProfileActivityText(item.content || \'\');\n' +
'                    var noteHtml = \'\';\n' +
'                    if (!isLikes && commentText) {\n' +
'                        noteHtml = \'<div class="stat-record-note">我的评论：\' + escapeHtml(commentText) + \'</div>\';\n' +
'                    } else if (isLikes && post) {\n' +
'                        var postText = normalized ? repairProfileActivityText(normalized.content || \'\') : \'\';\n' +
'                        if (postText) {\n' +
'                            noteHtml = \'<div class="stat-record-note">\' + escapeHtml(postText.length > 36 ? postText.slice(0, 36) + \'...\' : postText) + \'</div>\';\n' +
'                        }\n' +
'                    }\n' +
'                    var actionHtml = isLikes\n' +
"                        ? '<button type=\"button\" class=\"stat-record-action is-danger\" onclick=\"event.stopPropagation();unlikeFromProfile(\\'' + safeJsStr(String(item.id || '')) + '\\', \\'' + safeJsStr(String(item.post_id)) + '\\', this)\">取消点赞</button>'" +
'\n' +
"                        : '<button type=\"button\" class=\"stat-record-action is-danger\" onclick=\"event.stopPropagation();deleteProfileComment(\\'' + safeJsStr(String(item.id || '')) + '\\', \\'' + safeJsStr(String(item.post_id)) + '\\', this)\">删除评论</button>';" +
'\n' +
'                    var cardAttrs = canOpenPost\n' +
"                        ? ' role=\"button\" tabindex=\"0\" onclick=\"' + openPostOnclick + '\" onkeydown=\"if(event.key===\\'Enter\\'||event.key===\\' \\'){event.preventDefault();' + openPostOnclick + '}\"' +" +
'\n' +
"                        : '';" +
'\n' +
'                    return [\n' +
"                        '<article class=\"stat-record-entry stat-row ' + (isLikes ? 'stat-like-item' : 'stat-comment-item') + (mediaHtml ? '' : ' stat-row--no-media') + (canOpenPost ? '' : ' is-disabled') + '\"' + cardAttrs + ' style=\"--xtj-enter-delay:' + Math.min(index * 26, 220) + 'ms;\">'," +
'\n' +
'                        statMediaColumnMarkup(mediaHtml),\n' +
"                        '<div class=\"stat-row-main\">'," +
'\n' +
"                        '<div class=\"stat-row-title\">' + escapeHtml(currentUser.user_metadata?.full_name || currentUser.email || '我') + (isLikes ? ' 点赞了：' : ' 评论了：') + '</div>'," +
'\n' +
"                        '<div class=\"stat-row-copy\">' + escapeHtml(summary) + noteHtml + '</div>'," +
'\n' +
"                        '</div>'," +
'\n' +
"                        '<div class=\"stat-row-side\"><span class=\"stat-row-time\">' + new Date(item.created_at).toLocaleString() + '</span>' + actionHtml + '</div>'," +
'\n' +
"                        '</article>'" +
'\n' +
'                    ].join(\'\');\n' +
'                }).join(\'\');\n' +
'                return {\n' +
'                    html: html,\n' +
'                    totalCount: exactCount || items.length || 0,\n' +
'                    hasMore: (exactCount || items.length || 0) > 1\n' +
'                };\n' +
'            }\n' +
'            \n';

c = before + '\n' + newFunc + after;
fs.writeFileSync(fp, c, 'utf8');
console.log('DONE - replaced function successfully');
