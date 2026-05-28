const fs = require('fs');

const corePath = 'js/core.js';
let lines = fs.readFileSync(corePath, 'utf8').split('\n');

// Read current line 1483, 1509, 2433, 2502 
console.log('L1483:', lines[1482].substring(0, 80));
console.log('L1509:', lines[1508].substring(0, 80));
console.log('L2433:', lines[2432].substring(0, 80));
console.log('L2502:', lines[2501].substring(0, 80));

// Fix them
const fixes = {};

// Line 1483: fix garbled in showToast
if (lines[1482]) {
    lines[1482] = lines[1482].replace(
        /showToast\("发布.*?:\s*"\s*\+\s*\(insertErr\.message\s*\|\|\s*"未.*?"\)\)/,
        'showToast("发布失败: " + (insertErr.message || "未知错误"))'
    );
    // Also fix the btn.textContent on same line
    lines[1482] = lines[1482].replace(
        /btn\.textContent\s*=\s*"发布.*?"/,
        'btn.textContent = "发布动态"'
    );
}

// Line 1509
if (lines[1508]) {
    lines[1508] = lines[1508].replace(
        /showToast\("请先.*?"\)/,
        'showToast("请先登录")'
    );
}

// Line 2433
if (lines[2432]) {
    lines[2432] = lines[2432].replace(
        /showToast\(".*"\)/,
        'showToast("无权编辑这条帖子")'
    );
}

// Line 2502
if (lines[2501]) {
    lines[2501] = lines[2501].replace(
        /showToast\("置.*操作失.*?:\s*"\s*\+\s*\(.*?\.message\s*\|\|\s*"未.*?"\)\)/,
        'showToast("置顶操作失败: " + ((result.error && result.error.message) || "未知错误"))'
    );
}

fs.writeFileSync(corePath, lines.join('\n'), 'utf8');
console.log('Fixed!');

// Verify
const revised = fs.readFileSync(corePath, 'utf8').split('\n');
console.log('L1483:', revised[1482].substring(0, 80));
console.log('L1509:', revised[1508].substring(0, 80));
console.log('L2433:', revised[2432].substring(0, 80));
console.log('L2502:', revised[2501].substring(0, 80));