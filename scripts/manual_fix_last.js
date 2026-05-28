const fs = require('fs');
const path = require('path');

const corePath = path.join(__dirname, '..', 'js', 'core.js');
let content = fs.readFileSync(corePath, 'utf8');

console.log('继续修复 core.js 中最后的漏网之鱼！\n');

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

// 最后一批！
applyFix('var vm = statsEl.textContent.match(/浏��?(\\d+)/);',
          'var vm = statsEl.textContent.match(/浏览(\\d+)/);',
          '浏览正则');
applyFix('statsEl.innerHTML = statsEl.innerHTML.replace(/浏��?\\d+/, \'浏��?\' + newVal);',
          'statsEl.innerHTML = statsEl.innerHTML.replace(/浏览\\d+/, \'浏览\' + newVal);',
          '浏览更新');
applyFix('post_content: rawContent.length > 200 ? rawContent.slice(0, 200) + \'...\' : (rawContent || \'(閸ュ墽澧?视��?\'),',
          'post_content: rawContent.length > 200 ? rawContent.slice(0, 200) + \'...\' : (rawContent || \'(图片/视频)\'),',
          '浏览历史内容');
applyFix('post_author: postInfoCache[postId].user_name || \'未��?\',',
          'post_author: postInfoCache[postId].user_name || \'未知\',',
          '未知作者');
applyFix('// ===================== 加载��︹偓?=====================',
          '// ===================== 加载帖子 =====================',
          '加载帖子注释');
applyFix('// 任��?：分�い�加载相关变�?',
          '// 任务：分页加载相关变量',
          '分页注释');
applyFix('// DEPRECATED_DO_NOT_EDIT ====== [已废��?下方�?412行有更新版��?======',
          '// DEPRECATED_DO_NOT_EDIT ====== [已废弃，下方第412行有更新版本======',
          '废弃注释');

console.log(`\n这一波又修复了 ${fixesApplied} 处！正在保存...`);

fs.writeFileSync(corePath, content, 'utf8');
console.log('✅ core.js 继续修复完成！');
