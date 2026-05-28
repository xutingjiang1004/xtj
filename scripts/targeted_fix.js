const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');

const corePath = path.join(__dirname, '..', 'js', 'core.js');
let content = fs.readFileSync(corePath, 'utf8');

// Target specific lines by context to fix critical user-facing strings
// We'll use the surrounding stable (non-garbled) text as anchors

const fixes = [
    // Line ~1473: publish button text
    { find: 'btn.textContent = "发布?..";', replace: 'btn.textContent = "发布中...";' },
    // Line ~1483: publish error toast
    { find: 'showToast("发布失Е: ', replace: 'showToast("发布失败: ' },
    { find: 'btn.textContent = "发布︹偓";', replace: 'btn.textContent = "发布动态";' },
    // Line ~2675: no posts found
    { find: '"娌℃找到相关帖子"', replace: '"没有找到相关帖子"' },
    // Line ~2171: first post prompt
    { find: '快来发布第一″З态吧~', replace: '快来发布第一条动态吧~' },
    // Line ~2834: post deleted
    { find: '帖子不存ㄦ已被删除', replace: '帖子不存在或已被删除' },
    // Line ~2754: stat titles
    { find: "'总╅幀?- 按ら分?'", replace: "'总动态 - 按用户分组'" },
    { find: "'总浏?- 浏览记录'", replace: "'总浏览 - 浏览记录'" },
    { find: "'点赞和评?- 记?'", replace: "'点赞和评论 - 记录'" },
    // Line ~2866: likes section
    { find: '点赞﹀煕閿?', replace: '点赞用户（' },
    // Line ~2877: comments section  
    { find: '评论列€锛?', replace: '评论列表（' },
    // Stat modal views section
    { find: '浏览记录会在你查看帖€时自З保?', replace: '浏览记录会在你查看帖子时自动保存' },
    { find: '当前已记录€浏览数?', replace: '当前已记录的总浏览数：' },
    { find: '浏览?<b>', replace: '浏览了 <b>' },
    { find: '閻ㄥ笘€愶?', replace: '的帖子：' },
    { find: '点赞了：', replace: '点赞了：' },
    { find: '评论了€?{', replace: '评论了：{' },
    { find: '銆嶏?{', replace: '」（{' },
    // Announcement publish
    { find: "btn.disabled = true; btn.textContent = '发布?..';", replace: "btn.disabled = true; btn.textContent = '发布中...';" },
    { find: "'发布失Е: '", replace: "'发布失败: '" },
    { find: "$('#pubBtn').text('发布︹偓');", replace: "$('#pubBtn').text('发布公告');" },
    // Announcement delete
    { find: "'删除€鎲?, '确定要删よ繖鏉″叕鍛﹤鎮ч敍', '閺?',", replace: "'删除公告', '确定要删除这条公告吗？', '删除'," },
    { find: "'删除失Е: '", replace: "'删除失败: '" },
    // Toast messages
    { find: "'未￠误'", replace: "'未知错误'" },
    { find: "showToast('发布成\u529f: '", replace: "showToast('发布成功: '" },
];

let total = 0;
for (const {find, replace} of fixes) {
    if (content.includes(find)) {
        content = content.replace(find, replace);
        total++;
    }
}

console.log('Fixed ' + total + ' critical strings');

// Now use iconv-lite for general CJK cleanup one more time
content = content.replace(/[\u4e00-\u9fff\ue000-\uf8ff]{2,60}/g, (match) => {
    try {
        const gbkBytes = iconv.encode(match, 'gbk');
        const fixed = gbkBytes.toString('utf8');
        if (fixed !== match && /[\u4e00-\u9fa5]/.test(fixed)) return fixed;
    } catch(e) {}
    try {
        const gb18030Bytes = iconv.encode(match, 'gb18030');
        const fixed = gb18030Bytes.toString('utf8');
        if (fixed !== match && /[\u4e00-\u9fa5]/.test(fixed)) return fixed;
    } catch(e) {}
    return match;
});

fs.writeFileSync(corePath, content, 'utf8');
console.log('Done - file saved');