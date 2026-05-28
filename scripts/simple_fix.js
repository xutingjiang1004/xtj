const fs = require('fs');
const path = require('path');

console.log('开始修复 core.js！');

const corePath = path.join(__dirname, '..', 'js', 'core.js');
let content = fs.readFileSync(corePath, 'utf8');

// 简单的修复，处理最关键的几个乱码:
const fixes = [
    ['鐐硅禐', '点赞'],
    ['璇勮?', '评论'],
    ['鎶?鍙?', '举报'],
    ['娴忚?', '浏览'],
    ['鏌ョ湅璧勬枡', '查看资料'],
    ['鏈夊鐧诲綍', '未登录'],
    ['鐐瑰嚮鐧诲綍', '点击登录'],
    ['涓炬姤', '举报'],
    ['鏈嶅姟鍔犺浇澶辫触锛岃鍒锋柊椤甸潰閲嶈瘯', '服务加载失败，请刷新页面重试'],
];

let total = 0;
for (const [from, to] of fixes) {
    const regex = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const matches = content.match(regex);
    if (matches) {
        total += matches.length;
        content = content.replace(regex, to);
        console.log(`修复了 ${from} → ${to} (${matches.length}处)`);
    }
}

if (total > 0) {
    fs.writeFileSync(corePath, content, 'utf8');
    console.log(`\n✅ 成功！共修复了 ${total} 处乱码！`);
} else {
    console.log('未找到需要修复的内容...');
}
