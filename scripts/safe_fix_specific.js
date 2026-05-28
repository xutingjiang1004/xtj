const fs = require('fs');

const corePath = 'js/core.js';
let content = fs.readFileSync(corePath, 'utf8');

// 只精确修复这几个用户明确指出的字符串
const fixes = [
    ['鏌ョ湅璧勬枡', '查看资料'],
    ['鏈夊鐧诲綍', '未登录'],
    ['鐐瑰嚮鐧诲綍', '点击登录'],
    ['涓炬姤鏍囩殑涓嶅瓨鍦�', '举报目标不存在'],
    ['涓炬姤', '举报'],
    ['閫€鍑�', '退出'],
    ['鐧诲綍', '登录'],
    ['娉ㄥ唽', '注册'],
    ['瑙嗛', '浏览'],
    ['鏈嶅姟鍔犺浇澶辫触锛岃鍒锋柊椤甸潰閲嶈瘯', '服务加载失败，请刷新页面重试'],
];

let fixedCount = 0;
for (const [from, to] of fixes) {
    if (content.includes(from)) {
        const regex = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const matches = (content.match(regex) || []).length;
        content = content.replace(regex, to);
        fixedCount += matches;
        console.log(`Fixed ${matches}x: ${from} → ${to}`);
    }
}

fs.writeFileSync(corePath, content, 'utf8');
console.log(`\nDone! Total fixes: ${fixedCount}`);