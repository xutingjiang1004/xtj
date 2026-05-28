const fs = require('fs');

const corePath = 'js/core.js';
let lines = fs.readFileSync(corePath, 'utf8').split('\n');

// Fix specific lines by line number
const fixMap = {
    // Line 1483: showToast + btn textContent
    1483: '                    if (insertErr) { showToast("发布失败: " + (insertErr.message || "未知错误")); btn.disabled = false; btn.textContent = "发布动态"; return; }',
    // Line 1509: showToast
    1509: '                if (!currentUser) { showToast("请先登录"); return; }',
    // Line 2433: showToast
    2433: '                    showToast("无权编辑这条帖子");',
    // Line 2502: showToast
    2502: '                    showToast("置顶操作失败: " + ((result.error && result.error.message) || "未知错误"));',
};

let fixed = 0;
for (const [lineNum, newContent] of Object.entries(fixMap)) {
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
    console.log('No changes needed');
}