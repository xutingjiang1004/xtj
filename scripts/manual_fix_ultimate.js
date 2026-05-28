const fs = require('fs');
const path = require('path');

const corePath = path.join(__dirname, '..', 'js', 'core.js');
let content = fs.readFileSync(corePath, 'utf8');

console.log('最后一次终极修复！核心帖子渲染区域！\n');

let fixesApplied = 0;

function applyFix(oldStr, newStr, description) {
    if (content.includes(oldStr)) {
        const regex = new RegExp(oldStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const matches = content.match(regex) || [];
        content = content.split(oldStr).join(newStr);
        fixesApplied += matches.length;
        console.log(`✓ ${description} (${matches.length}处)`);
    }
}

// 终极最后一批！
applyFix('// DEPRECATED_DO_NOT_EDIT ====== [已废��?下方�?479行有更新版��?======',
          '// DEPRECATED_DO_NOT_EDIT ====== [已废弃，下方第479行有更新版本======',
          '废弃注释1');
applyFix('// 显�ず�▽℃��更多�?',
          '// 显示没有更多',
          '显示注释');
applyFix('noMore.textContent = \'娌℃��更多�?;\',
          'noMore.textContent = \'没有更多了\';',
          '没有更多');
applyFix('// DEPRECATED_DO_NOT_EDIT ====== [已废��?下方�?503行有更新版��?======',
          '// DEPRECATED_DO_NOT_EDIT ====== [已废弃，下方第503行有更新版本======',
          '废弃注释2');
applyFix('<div class="post-stats-text">浏��?${p.views||0} 璺?点��?${pLikes.length} 璺?评��?${pComms.length}</div>',
          '<div class="post-stats-text">浏览 ${p.views||0} · 点赞 ${pLikes.length} · 评论 ${pComms.length}</div>',
          '帖子统计文字');
applyFix('<button class="action-btn ${isLiked?\'liked\':\'\'}" onclick="toggleLike(this, \'${escapeHtml(p.id).replace(/\'/g, "\\\\\'")}\')">${isLiked?\'鉂わ�?:\'点��?}</button>',
          '<button class="action-btn ${isLiked?\'liked\':\'\'}" onclick="toggleLike(this, \'${escapeHtml(p.id).replace(/\'/g, "\\\\\'")}\')">${isLiked?\'❤️\':\'点赞\'}</button>',
          '点赞按钮');
applyFix('<button class="action-btn" onclick="openComment(\'${escapeHtml(p.id).replace(/\'/g, "\\\\\'")}\')">评��?/button>',
          '<button class="action-btn" onclick="openComment(\'${escapeHtml(p.id).replace(/\'/g, "\\\\\'")}\')">评论</button>',
          '评论按钮');
applyFix('${canDelPost?`<button type="button" class="action-btn del" onclick="openDelete(\'${escapeHtml(p.id).replace(/\'/g, "\\\\\'")}\', \'${escapeHtml(p.actor_key).replace(/\'/g, "\\\\\'")}\')">删��?/button>`:\'\'}',
          '${canDelPost?`<button type="button" class="action-btn del" onclick="openDelete(\'${escapeHtml(p.id).replace(/\'/g, "\\\\\'")}\', \'${escapeHtml(p.actor_key).replace(/\'/g, "\\\\\'")}\')">删除</button>`:\'\'}',
          '删除按钮');
applyFix('// 閸?sentinel 之前插入新帖�€?',
          '// 在sentinel 之前插入新帖子',
          '插入帖子注释');

console.log(`\n这一波终极修复了 ${fixesApplied} 处！正在保存...`);

fs.writeFileSync(corePath, content, 'utf8');
console.log('✅ core.js 终极修复完成！');
