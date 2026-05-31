const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'js', 'core.js');
let content = fs.readFileSync(filePath, 'utf8');

function replace(pattern, replacement, label) {
    const before = content;
    content = content.replace(pattern, replacement);
    if (content !== before) {
        const re = new RegExp(pattern.source, 'g');
        const matches = [...before.matchAll(re)];
        console.log(`  [${matches.length}x] ${label}`);
    } else {
        console.log(`  [SKIP] ${label}`);
    }
}

console.log('=== v3 Fix: remaining garbled text ===\n');

// ====== Toast messages ======
replace(/showToast\("ǳ"\)/g, 'showToast("请输入用户名")', 'login empty name');
replace(/showToast\("3λ"\)/g, 'showToast("密码至少3位")', 'pw too short');

// Registration: "浅 '" + name + "' 驯注幔敶换一"
replace(/showToast\("ǳ '" \+ name \+ "' 训注幔敶换一"\)/g, 'showToast("用户名 \'" + name + "\' 已存在，请换一个")', 'reg name exists');
replace(/showToast\("ǳ '" \+ name \+ "' 驯注幔敶换一"\)/g, 'showToast("用户名 \'" + name + "\' 已存在，请换一个")', 'reg name exists alt');

// ====== Loading text ======
replace(/'菁'/g, "'加载中...'", 'loading 菁');
replace(/'倩'/g, "'加载中...'", 'loading 倩');
replace(/'诰'/g, "'加载中...'", 'loading 诰');
replace(/'诖'/g, "'加载中...'", 'loading 诖');
replace(/'诖通'/g, "'加载中...'", 'loading 诖通');

// ====== Chat empty/error ======
replace(/'倩息'/g, "'加载中...'", 'chat 倩息');
replace(/\|\| 'ʧ'/g, "|| '失败'", 'chat err fallback');
replace(/\\|\\| '失'/g, "|| '失败'", 'chat err fallback template');

// Chat empty message
replace(/>偷一息<\/div>/g, '>暂无消息</div>', 'chat empty 偷一息');
replace(/>͵一Ϣ<\/div>/g, '>暂无消息</div>', 'chat empty garbled');

// ====== User profile card login text ======
replace(/'¼'/g, "'加载中...'", 'login time placeholder');

// ====== Emoji fixes ======
replace(/"鉂わ笍"/g, '"❤️"', 'emoji heart');
replace(/"馃挄"/g, '"💕"', 'emoji heart 2');
replace(/"馃挅"/g, '"💖"', 'emoji heart 3');
replace(/"馃挆"/g, '"💗"', 'emoji heart 4');
replace(/"馃挊"/g, '"💘"', 'emoji heart 5');
replace(/"馃"/g, '"🤍"', 'emoji heart white');
replace(/"馃帪"/g, '"🎞️"', 'emoji video');
replace(/"馃寵"/g, '"🌙"', 'emoji moon');
replace(/'馃寵'/g, "'🌙'", 'emoji moon single');
replace(/"馃摥"/g, '"📭"', 'emoji empty mailbox');
replace(/"馃攰"/g, '"🔊"', 'emoji speaker');

// ====== Post visibility badges ======
replace(/'馃敀 绉佸瘑'/g, "'🔒 私密'", 'badge private');
replace(/'馃敁 鍏紑'/g, "'🔓 公开'", 'badge public');
replace(/'馃搶 缃《'/g, "'📌 置顶'", 'badge pinned');

// ====== Stat section emojis ======
replace(/"馃挰/g, '"💬', 'emoji speech 1');
replace(/'馃挰/g, "'💬", 'emoji speech 2');
replace(/"馃柤/g, '"🖼', 'emoji frame');
replace(/"馃搵/g, '"📋', 'emoji clipboard 1');
replace(/'馃搵/g, "'📋", 'emoji clipboard 2');
replace(/"馃搳/g, '"📊', 'emoji chart 1');
replace(/'馃搳/g, "'📊", 'emoji chart 2');
replace(/"馃摲/g, '"📷', 'emoji camera');
replace(/"馃幀/g, '"🎬', 'emoji movie');

// ====== Stat/HTML template strings ======
replace(/路 /g, '· ', 'middle dot');

// Post detail stats garbled
replace(/婵忚/g, '浏览', 'stat 浏览 garbled');
replace(/鐐硅禐/g, '点赞', 'stat 点赞 garbled');
replace(/璇勮/g, '评论', 'stat 评论 garbled');

// ====== Loading text in feed/stat ======
replace(/>ʧ: \$\{errMsg\}</g, '>失败: ${errMsg}<', 'feed err msg');
replace(/\|\| 'ʧ'/g, "|| '失败'", 'fallback err');

// ====== MOJIBAKE_PAIRS table fix ======
// This table is used for runtime DOM text repair
// Each entry should map garbled → correct
replace(
    /const pairs = \[\s*\[(?:'[^']*'|"")\s*,\s*(?:'[^']*'|"")\](?:,\s*\[(?:'[^']*'|"")\s*,\s*(?:'[^']*'|"")\])*\s*\];/,
    `const pairs = [
                ['', ''],
                ['\u077C', '\u52A0'],
                ['\u02E2', '\u5237'],
                ['', ''],
                ['\u01F3', '\u8BF7'],
                ['', ''],
                ['', ''],
                ['', ''],
                ['', ''],
                ['', ''],
                ['\u027E', '\u5220'],
                ['', ''],
                ['', ''],
                ['\u0671', '\u5907'],
                ['\u0F2D', '\u7F16'],
                ['\u00F6', '\u7F6E'],
                ['', ''],
                ['', ''],
                ['\u02F9', '\u79C1'],
                ['\u03E2', '\u6D88'],
                ['\u0375\u04BB\u03E2', '\u6682\u65E0\u6D88\u606F'],
                ['\u06B4', '\u8F7D'],
                ['\u03F4', '\u4E0A'],
                ['\u06B1', '\u52A0'],
                ['\u03F4', '\u4E0A'],
                ['\u03F4\u02A7\u0723', '\u4E0A\u4F20\u5931\u8D25'],
                ['\u0279\u03F4', '\u4E0A\u4F20\u6210\u529F'],
                ['\u00BC', '\u5F55'],
                ['\u022B', '\u5168'],
                ['\u0736\u032C', '\u52A8\u6001'],
                ['', ''],
                ['\u07BA', '\u8D5E']
            ];`,
    'MOJIBAKE_PAIRS table'
);

// Magic loading v3: fix garbled strings in the loader
// Line ~5514: subtitle || '诰'
replace(/fixed = repairString\(current\);/g, 'fixed = repairString(current);', 'noop');

// Fix magic loading subtitle defaults  
// These appear in multiple places with different garbled text
// The fix above with /'诰'/, /'诖'/ etc. should handle most cases

// ====== Feed loading / magic loading ======
replace(/>鍔犺浇涓?\.\.\.<\/span>/g, '>加载中...</span>', 'loading text span garbled');
replace(/'鍒锋柊涓?..'/g, "'刷新中...'", 'refresh text garbled');
replace(/'鍔犺浇涓?..'/g, "'加载中...'", 'loading text garbled full');
replace(/"鍒锋柊涓?\.\."/g, '"刷新中..."', 'refresh text garbled dq');
replace(/"鍔犺浇涓?\.\."/g, '"加载中..."', 'loading text garbled dq');

// ====== Stat empty / stat titles ======
replace(/>薅态</g, '>暂无数据<', 'stat empty 薅态');
replace(/>硬诨删</g, '>暂无数据<', 'stat empty 硬诨删');
replace(/>权榭</g, '>加载失败<', 'stat empty 权榭');
replace(/>失埽</g, '>加载失败<', 'stat empty 失埽');

replace(/'芏态 - 没'/g, "'帖子动态'", 'stat title posts');
replace(/' - 录'/g, "'浏览记录'", 'stat title views');
replace(/'藓 - 录'/g, "'点赞记录'", 'stat title likes');

// ====== Stat view history ======
replace(/>前鸭录鸭</g, '>当前浏览记录<', 'view history footer');

// ====== Announcement toast ======
replace(/showToast\('删'\)/g, "showToast('删除成功')", 'announcement delete toast');

// ====== Test notification fix ======
replace(
    /showNotification\('', 'һϢ֪ͨıʾǷ'\)/g,
    "showNotification('测试', '这是一条测试通知消息')",
    'test notification'
);
replace(
    /showNotification\('', 'һǳǳĲϢıضЧô300ַҲַ򻵡'\)/g,
    "showNotification('测试', '这是一条很长的测试通知消息，用于验证超过300字符时的显示效果')",
    'test notification long'
);

// ====== Changelog/HTML comments - less critical but fix ======
// These are inside template literals, less visible to users

// ====== Final pass for remaining garbled ======
// 娴忚 → 浏览 (in various contexts)
replace(/娴忚/g, '浏览', 'browse garbled fix');
// 璁板綍 → 记录 (in various contexts)
replace(/璁板綍/g, '记录', 'record garbled fix');
// 鍥剧墖 → 图片
replace(/鍥剧墖/g, '图片', 'image garbled fix');
// 瑙嗛 → 视频
replace(/瑙嗛/g, '视频', 'video garbled fix');
// 绉佸瘑 → 私密
replace(/绉佸瘑/g, '私密', 'private garbled fix');
// 鍏紑 → 公开
replace(/鍏紑/g, '公开', 'public garbled fix');
// 缃《 → 置顶
replace(/缃《/g, '置顶', 'pin garbled fix');
// 鏆傛棤 → 暂无
replace(/鏆傛棤/g, '暂无', 'none garbled fix');
// 鍏憡 → 公告
replace(/鍏憡/g, '公告', 'announcement garbled fix');
// 娑堟伅 → 消息
replace(/娑堟伅/g, '消息', 'message garbled fix');
// 鍔犺浇涓?.. → 加载中...
replace(/鍔犺浇涓?\.\.\./g, '加载中...', 'loading garbled fix full');
replace(/鍔犺浇涓?\.\./g, '加载中...', 'loading garbled fix');

// ====== Page reload hint ======
replace(/页头始/g, '重新加载', 'page reload hint alt');

// ====== Remaining magicHtml fallback strings ======
// These were already addressed by the character-level fixes above

fs.writeFileSync(filePath, content, 'utf8');
console.log('\n=== v3 Fix complete ===');
