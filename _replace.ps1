$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$file = Join-Path $scriptDir "js\core.js"
$content = [System.IO.File]::ReadAllText($file)

$oldFunc = @'
            function profileActivityMedia(post, postId) {
                var normalized = normalizePost(post || {});
                if (!normalized.media_url) return '';
                var onclick = "event.stopPropagation();openProfileActivityMedia('" + safeJsStr(String(postId || normalized.id || '')) + "')";
                if (normalized.media_type === 'image') {
                    return '<img class="profile-activity-media" src="' + escapeHtml(normalized.media_url) + '" alt="" loading="lazy" decoding="async" fetchpriority="low" onclick="' + onclick + '" />';
                }
                if (normalized.media_type === 'video') {
                    return '<div class="profile-activity-video" onclick="' + onclick + '">视频</div>';
                }
                return '';
            }
'@

$newFunc = @'
            function profileActivityMedia(post, postId) {
                var normalized = normalizePost(post || {});
                if (!normalized.media_url) return '';
                var onclick = "event.stopPropagation();openProfileActivityMedia('" + safeJsStr(String(postId || normalized.id || '')) + "')";
                if (normalized.media_type === 'image') {
                    return '<img class="stat-record-thumb" src="' + escapeHtml(normalized.media_url) + '" alt="" loading="lazy" decoding="async" fetchpriority="low" onclick="' + onclick + '" />';
                }
                if (normalized.media_type === 'video') {
                    return '<div class="stat-record-thumb stat-record-thumb--video" onclick="' + onclick + '">视频</div>';
                }
                return '';
            }
'@

if ($content.Contains($oldFunc)) {
    $content = $content.Replace($oldFunc, $newFunc)
    Write-Host "OK: profileActivityMedia"
} else {
    Write-Host "FAIL: profileActivityMedia"
}

$oldBig = @'
            function buildProfileActivityListMarkup(kind, limit) {
                var isLikes = kind === 'likes';
                var items = isLikes ? (profileActivityState.likes || []) : (profileActivityState.comments || []);
                var totals = profileActivityState.totals || {};
                var exactCount = isLikes ? (totals.likes || 0) : (totals.comments || 0);
                if (!currentUser) {
                    return {
                        html: '<div class="profile-activity-empty">登录后，这里会显示你的点赞和评论记录。</div>',
                        totalCount: 0,
                        hasMore: false
                    };
                }
                if (!items.length) {
                    return {
                        html: '<div class="profile-activity-empty">' + (isLikes ? '你还没有点赞任何帖子。' : '你还没有留下评论记录。') + '</div>',
                        totalCount: 0,
                        hasMore: false
                    };
                }
                var visibleItems = typeof limit === 'number' ? items.slice(0, limit) : items.slice();
                var html = visibleItems.map(function(item, index) {
                    var post = getProfileActivityPost(item.post_id);
                    var normalized = normalizePost(post || {});
                    var mediaHtml = post ? profileActivityMedia(post, item.post_id) : '';
                    var openPostOnclick = "openProfileActivityPost('" + safeJsStr(String(item.post_id)) + "')";
                    var summary = post ? profileActivitySummary(post) : '原帖已不可用';
                    var hasMedia = !!(normalized && normalized.media_url);
                    var canOpenPost = !!(post && item.post_id);
                    var postText = normalized ? repairProfileActivityText(normalized.content || '') : '';
                    var commentText = repairProfileActivityText(item.content || '');
                    var titlePrefix = isLikes ? '点赞了这条帖子' : '评论了这条帖子';
                    var noteParts = [];
                    if (!isLikes && commentText) {
                        noteParts.push('<div class="profile-activity-note profile-activity-note--accent">我的评论：' + escapeHtml(commentText) + '</div>');
                    }
                    if (hasMedia && postText) {
                        noteParts.push('<div class="profile-activity-note">原帖：' + escapeHtml(postText.length > 48 ? postText.slice(0, 48) + '...' : postText) + '</div>');
                    } else if (summary === '无文字内容') {
                        noteParts.push('<div class="profile-activity-note">原帖没有文字内容</div>');
                    } else if (summary) {
                        noteParts.push('<div class="profile-activity-note">原帖：' + escapeHtml(summary) + '</div>');
                    }
                    if (!noteParts.length) {
                        noteParts.push('<div class="profile-activity-note">原帖已不可用</div>');
                    }
                    var actionHtml = isLikes
                        ? '<button type="button" class="profile-activity-btn is-danger" onclick="event.stopPropagation();unlikeFromProfile(\'' + safeJsStr(String(item.id || '')) + '\', \'' + safeJsStr(String(item.post_id)) + '\', this)">取消点赞</button>'
                        : '<button type="button" class="profile-activity-btn is-danger" onclick="event.stopPropagation();deleteProfileComment(\'' + safeJsStr(String(item.id || '')) + '\', \'' + safeJsStr(String(item.post_id)) + '\', this)">删除评论</button>';
                    var cardAttrs = canOpenPost
                        ? ' role="button" tabindex="0" onclick="' + openPostOnclick + '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + openPostOnclick + '}"'
                        : '';
                    return [
                        '<article class="profile-activity-item' + (hasMedia ? ' has-media' : ' no-media') + (canOpenPost ? '' : ' is-disabled') + '"' + cardAttrs + ' style="--xtj-enter-delay:' + Math.min(index * 28, 180) + 'ms;">',
                        '<div class="profile-activity-main">',
                        '<div class="profile-activity-title">' + escapeHtml(titlePrefix) + '</div>',
                        '<div class="profile-activity-body">' + noteParts.join('') + '</div>',
                        '</div>',
                        hasMedia ? '<div class="profile-activity-media-col">' + mediaHtml + '</div>' : '',
                        '<div class="profile-activity-side"><span class="profile-activity-time">' + new Date(item.created_at).toLocaleString() + '</span><div class="profile-activity-actions">' + actionHtml + '</div></div>',
                        '</article>'
                    ].join('');
                }).join('');
                return {
                    html: html,
                    totalCount: exactCount || items.length || 0,
                    hasMore: (exactCount || items.length || 0) > 1
                };
            }
'@

$newBig = @'
            function buildProfileActivityListMarkup(kind, limit) {
                var isLikes = kind === 'likes';
                var items = isLikes ? (profileActivityState.likes || []) : (profileActivityState.comments || []);
                var totals = profileActivityState.totals || {};
                var exactCount = isLikes ? (totals.likes || 0) : (totals.comments || 0);
                if (!currentUser) {
                    return {
                        html: '<div class="profile-activity-empty">登录后，这里会显示你的点赞和评论记录。</div>',
                        totalCount: 0,
                        hasMore: false
                    };
                }
                if (!items.length) {
                    return {
                        html: '<div class="profile-activity-empty">' + (isLikes ? '你还没有点赞任何帖子。' : '你还没有留下评论记录。') + '</div>',
                        totalCount: 0,
                        hasMore: false
                    };
                }
                var visibleItems = typeof limit === 'number' ? items.slice(0, limit) : items.slice();
                var html = visibleItems.map(function(item, index) {
                    var post = getProfileActivityPost(item.post_id);
                    var normalized = normalizePost(post || {});
                    var mediaHtml = post ? profileActivityMedia(post, item.post_id) : '';
                    var openPostOnclick = "openProfileActivityPost('" + safeJsStr(String(item.post_id)) + "')";
                    var summary = post ? profileActivitySummary(post) : '（帖子已删除）';
                    var hasMedia = !!(normalized && normalized.media_url);
                    var canOpenPost = !!(post && item.post_id);
                    var commentText = repairProfileActivityText(item.content || '');
                    var noteHtml = '';
                    if (!isLikes && commentText) {
                        noteHtml = '<div class="stat-record-note">我的评论：' + escapeHtml(commentText) + '</div>';
                    } else if (isLikes && post) {
                        var postText = normalized ? repairProfileActivityText(normalized.content || '') : '';
                        if (postText) {
                            noteHtml = '<div class="stat-record-note">' + escapeHtml(postText.length > 36 ? postText.slice(0, 36) + '...' : postText) + '</div>';
                        }
                    }
                    var actionHtml = isLikes
                        ? '<button type="button" class="stat-record-action is-danger" onclick="event.stopPropagation();unlikeFromProfile(\'' + safeJsStr(String(item.id || '')) + '\', \'' + safeJsStr(String(item.post_id)) + '\', this)">取消点赞</button>'
                        : '<button type="button" class="stat-record-action is-danger" onclick="event.stopPropagation();deleteProfileComment(\'' + safeJsStr(String(item.id || '')) + '\', \'' + safeJsStr(String(item.post_id)) + '\', this)">删除评论</button>';
                    var cardAttrs = canOpenPost
                        ? ' role="button" tabindex="0" onclick="' + openPostOnclick + '" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + openPostOnclick + '}"'
                        : '';
                    return [
                        '<article class="stat-record-entry stat-row ' + (isLikes ? 'stat-like-item' : 'stat-comment-item') + (mediaHtml ? '' : ' stat-row--no-media') + (canOpenPost ? '' : ' is-disabled') + '"' + cardAttrs + ' style="--xtj-enter-delay:' + Math.min(index * 26, 220) + 'ms;">',
                        statMediaColumnMarkup(mediaHtml),
                        '<div class="stat-row-main">',
                        '<div class="stat-row-title">' + escapeHtml(currentUser.user_metadata?.full_name || currentUser.email || '我') + (isLikes ? ' 点赞了：' : ' 评论了：') + '</div>',
                        '<div class="stat-row-copy">' + escapeHtml(summary) + noteHtml + '</div>',
                        '</div>',
                        '<div class="stat-row-side"><span class="stat-row-time">' + new Date(item.created_at).toLocaleString() + '</span>' + actionHtml + '</div>',
                        '</article>'
                    ].join('');
                }).join('');
                return {
                    html: html,
                    totalCount: exactCount || items.length || 0,
                    hasMore: (exactCount || items.length || 0) > 1
                };
            }
'@

if ($content.Contains($oldBig)) {
    $content = $content.Replace($oldBig, $newBig)
    Write-Host "OK: buildProfileActivityListMarkup"
} else {
    Write-Host "FAIL: buildProfileActivityListMarkup"
}

[System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::UTF8)
Write-Host "File written OK - done"
