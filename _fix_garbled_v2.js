const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'js', 'core.js');
let content = fs.readFileSync(filePath, 'utf8');
let count = 0;

function replace(pattern, replacement, label) {
    const before = content;
    content = content.replace(pattern, replacement);
    if (content !== before) {
        const matches = [];
        let m;
        const re = new RegExp(pattern.source, 'g');
        while ((m = re.exec(before)) !== null) matches.push(m);
        count += matches.length;
        console.log(`  [${matches.length}x] ${label}`);
    } else {
        console.log(`  [SKIP] ${label}`);
    }
}

console.log('=== Fixing core.js garbled text ===\n');

// ==========================================
// Toast / User-visible messages (CRITICAL)
// ==========================================
replace(/showToast\("˳¼"\)/g, 'showToast("已退出登录")', 'logout toast');
replace(/profileName\.textContent = "δ¼"/g, 'profileName.textContent = "未登录"', 'unauthenticated profile');
replace(/msgBtn\.textContent = 'Լ'/g, "msgBtn.textContent = '自己'", 'msgBtn self');
replace(/msgBtn\.textContent = '\? Ϣ'/g, "msgBtn.textContent = '发消息'", 'msgBtn msg');
replace(/showToast\("ݲܳ2000"\)/g, 'showToast("内容过长，不能超过2000字")', 'content too long');
replace(/showToast\("ʧ: "\s*\+\s*\(insertErr\.message \|\| "δ֪"\)/g, 'showToast("发布失败: " + (insertErr.message || "未知")', 'publish err old');
replace(/showToast\("ʧ: "\s*\+\s*\(e\.message \|\| ""\)/g, 'showToast("发布失败: " + (e.message || "")', 'publish err catch');
replace(/showToast\("ɹ"\)/g, 'showToast("发布成功")', 'publish success');
replace(/btn\.textContent = "̬"/g, 'btn.textContent = "发布"', 'btn reset');
replace(/showToast\("۳ɹ"\)/g, 'showToast("评论成功")', 'comment success');
replace(/showToast\("ɾ"\)/g, 'showToast("删除成功")', 'delete success');
replace(/showToast\(nextVisibility === "private" \? "ѸΪ˽" : "ѸΪ"\)/g, 'showToast(nextVisibility === "private" ? "切换为私密" : "切换为公开")', 'visibility toggle');
replace(/showToast\(nextPinned \? "ö" : "ȡö"\)/g, 'showToast(nextPinned ? "置顶成功" : "取消置顶")', 'pin toggle');
replace(/showToast\(insertRes\.fallback \? "ɹѼݾݽṹ" : "ɹ"\)/g, 'showToast(insertRes.fallback ? "发布成功（已保存）" : "发布成功")', 'fallback publish');
replace(/escapeHtml\(err\.message \|\| "δ֪"\)/g, 'escapeHtml(err.message || "未知")', 'unknown err');

// ==========================================
// Loading text
// ==========================================
replace(/'ݼʧ'/g, "'加载失败'", 'loading fail');
replace(/'ʧ: '/g, "'失败: '", 'error prefix');
replace(/'ɸѡûھۺ'/g, "'筛选用户加载中'", 'filter user loading');
replace(/'ûи'/g, "'没有更多了'", 'no more');
replace(/'͵һϢ'/g, "'暂无消息'", 'no msg single');
replace(/"͵һϢ"/g, '"暂无消息"', 'no msg double');

// ==========================================
// Stat titles
// ==========================================
replace(/\{ posts: '̬ܶ - û', views: ' - ¼', likes: '޺ - ¼' \}/g, "{ posts: '动态统计', views: '浏览记录', likes: '点赞记录' }", 'stat titles');
replace(/titles\[type\] \|\| 'ͳ'/g, "titles[type] || '统计'", 'stat fallback');
replace(/'ƥ'/g, "'没有匹配的帖子'", 'no match');
replace(/'ȥһ̬~'/g, "'去发一条~'", 'go post');

// ==========================================
// Magic loading strings (in HTML templates)
// ==========================================
replace(/magicHtml\('', 'ٻ', 'feed'\)/g, "magicHtml('', '加载中...', 'feed')", 'magic loading 载 feed');
replace(/magicHtml\('', 'ڴ', 'feed'\)/g, "magicHtml('', '加载中...', 'feed')", 'magic loading 载 detail');
replace(/magicHtml\('', 'ھ',/g, "magicHtml('', '加载中...',", 'magic loading sub gen');
replace(/magicHtml\(forceRefresh \? 'ˢ' : 'ݼ',/g, "magicHtml(forceRefresh ? '刷新中...' : '加载中...',", 'magic loading force');
replace(/magicHtml\('', 'ɸѡûھۺ',/g, "magicHtml('', '筛选用户加载中',", 'magic user filter');

// ==========================================
// Specific loading texts
// ==========================================
replace(/subtitle \|\| 'ھ'/g, "subtitle || '加载中...'", 'subtitle 1');
replace(/subtitle \|\| 'ٻ'/g, "subtitle || '加载中...'", 'subtitle 2');

// ==========================================
// Empty states
// ==========================================
replace(/>薅态<\/div>/g, '>暂无数据</div>', 'empty 1');
replace(/>硬诨删<\/div>/g, '>暂无数据</div>', 'empty 2');
replace(/>权榭\?<\/div>/g, '>数据加载失败</div>', 'empty 3');
replace(/>失埽<\/div>/g, '>加载失败</div>', 'empty 4');

// ==========================================
// Feed loading HTML
// ==========================================
// "加载失败，刷新重试" is already correct in most places
// Check for specific garbled feed HTML
replace(/>ʧ: \$\{errMsg\}<\/div>/g, '>加载失败: ${errMsg}</div>', 'feed err html');
replace(/textContent = "ûи"/g, 'textContent = "没有更多了"', 'noMore textContent');

// ==========================================
// Comments that are garbled (less critical)
// ==========================================
replace(/\/\/ 获取没信息（注册时间等\)/g, '// 获取用户信息（注册时间等）', 'comment user info');

// ==========================================
// Post filter summary
// ==========================================
replace(/el\.textContent = "ҵ " \+ count \+ " "/g, 'el.textContent = "找到 " + count + " 条"', 'filter summary');

// ==========================================
// Heart emoji array fix
// ==========================================
replace(/"❤️","馃挄","馃挆","🤍","馃挅","馃挀"\]/g, '"❤️","💕","💖","🤍","💗","💘"]', 'heart emojis');

// ==========================================
// Post detail HTML template fixes
// ==========================================
replace(/浏览 \$\{vc\} \?点赞 \$\{likes\.length\} \?评论 \$\{comments\.length\}/g, '浏览 ${vc} · 点赞 ${likes.length} · 评论 ${comments.length}', 'post detail stats');
replace(/>❤️ 点赞用户\{likes\.length\}\/div>/g, '>❤️ 点赞用户 ${likes.length}</div>', 'like users title');
replace(/>💬 评论列表：\{comments\.length\}\/div>/g, '>💬 评论列表：${comments.length}条</div>', 'comment list title');

// ==========================================
// Post summary display
// ==========================================
replace(/'һͼƬ'/g, "'[图片]'", 'summary img');
replace(/'һƵ'/g, "'[视频]'", 'summary vid');

// ==========================================
// Profile detail
// ==========================================
replace(/无权查看这条帖子/g, '无权查看这条帖子', 'no perm placeholder'); // already correct

// ==========================================
// Chat section fixes
// ==========================================
replace(/innerHTML = magicHtml\('', '͵һϢ',/g, "innerHTML = magicHtml('', '暂无消息',", 'chat magic msg');
replace(/subtitle: '͵һϢ',/g, "subtitle: '暂无消息',", 'chat sub msg');
replace(/>͵一Ϣ<\/div>/g, '>暂无消息</div>', 'chat empty msg');
replace(/>Ϣ<\/div>/g, '>暂无消息</div>', 'chat empty msg 2');
replace(/页头始/g, '重新加载', 'chat reload hint');

fs.writeFileSync(filePath, content, 'utf8');
console.log(`\n=== Total: Fixed ${count} garbled text occurrences ===`);
