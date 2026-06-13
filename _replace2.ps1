param($Path)
$lines = [System.IO.File]::ReadAllLines($Path)

Write-Host "Total lines: $($lines.Length)"

# profileActivityMedia: img class line (index 1807)
$lines[1807] = $lines[1807].Replace('profile-activity-media', 'stat-record-thumb')

# profileActivityMedia: video div line (index 1810)
$lines[1810] = $lines[1810].Replace('profile-activity-video"', 'stat-record-thumb stat-record-thumb--video"')

Write-Host "profileActivityMedia updated"

# Build new section for map function body
$newPart = @()
$newPart += "                    var summary = post ? profileActivitySummary(post) : '（帖子已删除）';"
$newPart += "                    var hasMedia = !!(normalized && normalized.media_url);"
$newPart += "                    var canOpenPost = !!(post && item.post_id);"
$newPart += "                    var commentText = repairProfileActivityText(item.content || '');"
$newPart += "                    var noteHtml = '';"
$newPart += "                    if (!isLikes && commentText) {"
$newPart += "                        noteHtml = '<div class=""stat-record-note"">我的评论：' + escapeHtml(commentText) + '</div>';"
$newPart += "                    } else if (isLikes && post) {"
$newPart += "                        var postText = normalized ? repairProfileActivityText(normalized.content || '') : '';"
$newPart += "                        if (postText) {"
$newPart += "                            noteHtml = '<div class=""stat-record-note"">' + escapeHtml(postText.length > 36 ? postText.slice(0, 36) + '...' : postText) + '</div>';"
$newPart += "                        }"
$newPart += "                    }"
$newPart += "                    var actionHtml = isLikes"
$newPart += "                        ? '<button type=""button"" class=""stat-record-action is-danger"" onclick=""event.stopPropagation();unlikeFromProfile(\'' + safeJsStr(String(item.id || '')) + '\', \'' + safeJsStr(String(item.post_id)) + '\', this)"">取消点赞</button>'"
$newPart += "                        : '<button type=""button"" class=""stat-record-action is-danger"" onclick=""event.stopPropagation();deleteProfileComment(\'' + safeJsStr(String(item.id || '')) + '\', \'' + safeJsStr(String(item.post_id)) + '\', this)"">删除评论</button>';"
$newPart += "                    var cardAttrs = canOpenPost"
$newPart += "                        ? ' role=""button"" tabindex=""0"" onclick=""' + openPostOnclick + '"" onkeydown=""if(event.key===''Enter''||event.key==='' ''){event.preventDefault();' + openPostOnclick + '}'"'"
$newPart += "                        : '';"
$newPart += "                    return ["
$newPart += "                        '<article class=""stat-record-entry stat-row ' + (isLikes ? 'stat-like-item' : 'stat-comment-item') + (mediaHtml ? '' : ' stat-row--no-media') + (canOpenPost ? '' : ' is-disabled') + '""' + cardAttrs + ' style=""--xtj-enter-delay:' + Math.min(index * 26, 220) + 'ms;"">',"
$newPart += "                        statMediaColumnMarkup(mediaHtml),"
$newPart += "                        '<div class=""stat-row-main"">',"
$newPart += "                        '<div class=""stat-row-title"">' + escapeHtml(currentUser.user_metadata?.full_name || currentUser.email || '我') + (isLikes ? ' 点赞了：' : ' 评论了：') + '</div>',"
$newPart += "                        '<div class=""stat-row-copy"">' + escapeHtml(summary) + noteHtml + '</div>',"
$newPart += "                        '</div>',"
$newPart += "                        '<div class=""stat-row-side""><span class=""stat-row-time"">' + new Date(item.created_at).toLocaleString() + '</span>' + actionHtml + '</div>',"
$newPart += "                        '</article>'"
$newPart += "                    ].join('');"

# Rebuild file: before section (0-1839) + newPart + after section (1877-end)
$before = $lines[0..1839]
$after = $lines[1877..($lines.Length - 1)]

$newLines = New-Object System.Collections.ArrayList
$newLines.AddRange($before)
for ($i = 0; $i -lt $newPart.Length; $i++) {
    $null = $newLines.Add($newPart[$i])
}
$newLines.AddRange($after)

[System.IO.File]::WriteAllLines($Path, $newLines.ToArray(), [System.Text.Encoding]::UTF8)
Write-Host "DONE - file saved, new line count: $($newLines.Count)"
