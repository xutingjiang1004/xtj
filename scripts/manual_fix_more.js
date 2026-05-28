const fs = require('fs');
const path = require('path');

const corePath = path.join(__dirname, '..', 'js', 'core.js');
let content = fs.readFileSync(corePath, 'utf8');

console.log('继续修复 core.js 浏览记录区域...\n');

let fixesApplied = 0;

function applyFix(oldStr, newStr, description) {
    if (content.includes(oldStr)) {
        const count = (content.match(new RegExp(oldStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        content = content.split(oldStr).join(newStr);
        fixesApplied += count;
        console.log(`✓ ${description} (${count}处)`);
    }
}

// 浏览记录和更多统计区域
applyFix('${userName} 閻ㄥ叏閮�ョ��子（�?${userPosts.length} 鏉★�?',
          '${userName} 的全部帖子（${userPosts.length}条）',
          '用户全部帖子标题');
applyFix('// 渲染总��セ览统�★紙�?localStorage 读取�ù�览历史�?',
          '// 渲染总浏览统计，从 localStorage 读取浏览历史',
          '浏览统计注释');
applyFix('<div style="font-size:13px;">暂��ゅù�览�︽��数据</div>',
          '<div style="font-size:13px;">暂无浏览记录数据</div>',
          '暂无浏览记录');
applyFix('<div style="font-size:12px; margin-top:12px; opacity:0.7;">浏览记录会在你查看帖�€��时自��З保��?/div>',
          '<div style="font-size:12px; margin-top:12px; opacity:0.7;">浏览记录会在你查看帖子时自动保存</div>',
          '保存浏览记录提示');
applyFix('<div style="font-size:12px; margin-top:8px; opacity:0.7;">当前已记录�€�浏览数�?{document.getElementById(\'sViews\').textContent} 濞?/div>',
          '<div style="font-size:12px; margin-top:8px; opacity:0.7;">当前已记录浏览数: ${document.getElementById(\'sViews\').textContent} 次</div>',
          '浏览计数');
applyFix('<div class="svi-target">浏览�?<b>${escapeHtml(v.post_author)}</b> 閻ㄥ笘�€�愶�?{escapeHtml(v.post_content)}</div>',
          '<div class="svi-target">浏览了 <b>${escapeHtml(v.post_author)}</b> 的帖子：${escapeHtml(v.post_content)}</div>',
          '浏览记录条目');
applyFix('// 渲染点赞和评论统�?',
          '// 渲染点赞和评论统计',
          '点赞评论统计注释');
applyFix('const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + \'...\' : \'(閸ュ墽澧?视��?\') : \'(已删�?\');',
          'const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + \'...\' : \'(图片/视频)\') : \'(已删除)\');',
          '帖子内容占位');
applyFix('const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + \'...\' : \'(閸ュ墽澧?视��?\') : \'(已删�?\');',
          'const postContent = post ? (post.content ? escapeHtml(post.content.slice(0, 20)) + \'...\' : \'(图片/视频)\') : \'(已删除)\');',
          '帖子内容占位2');
applyFix('<div class="sli-target">点赞了：${postContent}</div>',
          '<div class="sli-target">点赞了：${postContent}</div>',
          '点赞记录条目');
applyFix('<div class="sci-target">评论了�€?{postContent}銆嶏�?{escapeHtml(c.content)}</div>',
          '<div class="sci-target">评论了「${postContent}」：${escapeHtml(c.content)}</div>',
          '评论记录条目');
applyFix('<div class="stat-empty" style="padding:12px 0;">暂��ら���赞记��?/div>',
          '<div class="stat-empty" style="padding:12px 0;">暂无点赞记录</div>',
          '暂无点赞记录');
applyFix('<div class="stat-empty" style="padding:12px 0;">暂��ょ���论记��?/div>',
          '<div class="stat-empty" style="padding:12px 0;">暂无评论记录</div>',
          '暂无评论记录');

console.log(`\n总共又修复了 ${fixesApplied} 处！正在保存...`);

fs.writeFileSync(corePath, content, 'utf8');

console.log('✅ core.js 继续修复完成！');
