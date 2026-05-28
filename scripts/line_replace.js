const fs = require('fs');

const corePath = 'js/core.js';
let lines = fs.readFileSync(corePath, 'utf8').split('\n');

// Fix specific lines by line number
const lineFixes = {
    1305: '                showToast("已退出登录");',
    1465: '            // ===================== 旧版发布（已废弃，下有更新版）=====================',
    1467: '                if (!currentUser) { showToast("请先登录"); return; }',
    1470: '                if (!content && !file) { showToast("请输入内容或选择文件"); return; }',
    1471: '                // 去掉危险内容检查，简化逻辑',
    1472: '                if (content.length > 2000) { showToast("内容不能超过2000字"); return; }',
    1473: '                var btn = document.getElementById("pubBtn"); btn.disabled = true; btn.textContent = "发布中...";',
    2493: '                    showToast("无权删除这条帖子");',
};

let fixed = 0;
for (const [lineNum, newContent] of Object.entries(lineFixes)) {
    const idx = parseInt(lineNum) - 1;
    if (idx >= 0 && idx < lines.length && lines[idx] !== newContent) {
        lines[idx] = newContent;
        fixed++;
    }
}

if (fixed > 0) {
    fs.writeFileSync(corePath, lines.join('\n'), 'utf8');
    console.log('Fixed ' + fixed + ' lines');
} else {
    console.log('All lines already correct');
}