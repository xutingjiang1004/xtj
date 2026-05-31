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
        if (matches.length > 0) console.log(`  [${matches.length}x] ${label}`);
        else console.log(`  [OK-already] ${label}`);
    } else {
        console.log(`  [SKIP] ${label}`);
    }
}

function replaceText(oldText, newText, label) {
    const before = content;
    const escaped = oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    content = content.split(oldText).join(newText);
    const count = (before.length - content.length) / (oldText.length - newText.length);
    if (count > 0) console.log(`  [${Math.round(count)}x] ${label}`);
    else console.log(`  [SKIP] ${label}`);
}

console.log('=== v4 Fix: exact string matching ===\n');

// ====== Registration toast ======
replaceText('showToast("\u01F3 \'" + name + "\' \u0471\u05E2\u18EC\uBEFB\u04BB")', 'showToast("用户名 \'" + name + "\' 已存在，请换一个")', 'reg name exists');

// ====== Loading text: \u077C (looks like "菁") = '加', \u067B (looks like "倩") = '载' ======
// These appear in magic loading HTML
replaceText('\u077C', '加载中', 'garbled 菁→加载中');
replaceText('\u067B', '加载中', 'garbled 倩→加载中');
replaceText('\u06BE', '加载中', 'garbled 诰→加载中'); // U+06BE
replaceText('\u06B4', '加载中', 'garbled 诖→加载中'); // U+06B4

// Fix \u077C in strings specifically (it's used for "加载中" in loading contexts)
// But we already replaced all instances above

// ====== Error text ======
replaceText('\u02A7', '失败', 'garbled 失→失败');

// ====== Stat empty ======
replaceText('\u07B6\u032C', '暂无数据', 'garbled 薅态→暂无数据');
replaceText('\u04F2\u06BB\u027E', '暂无数据', 'garbled 硬诨删→暂无数据');
replaceText('\u0228\u003F', '暂无数据', 'garbled 权?→暂无数据');
replaceText('\u02A7\u0723', '加载失败', 'garbled 失埽→加载失败');

// ====== Stat titles ======
replaceText('\u0736\u032C - \u00FB', '帖子动态', 'garbled 芏态 - 没→帖子动态');
replaceText(' - \u00BC', '浏览记录', 'garbled  - 录→浏览记录');
replaceText('\u07BA - \u00BC', '点赞记录', 'garbled 藓 - 录→点赞记录');

// ====== Chat empty ======
replaceText('\u0375\u04BB\u03E2', '暂无消息', 'garbled 偷一息→暂无消息');

// ====== Chat loading ======
replaceText('\u06B4\u0368', '加载中...', 'garbled 诖通→加载中...');
replaceText('\u067B\u03E2', '加载中...', 'garbled 倩息→加载中...');

// ====== Other single-char garbled leftovers ======
replaceText('\u027E', '删除', 'garbled ɾ→删除'); // in showToast
replaceText('\u03F4', '上', 'garbled ϴ→上');
replaceText('\u0368', '通', 'garbled ͨ→通');
replaceText('\u05AA', '知', 'garbled ֪→知');
replaceText('\u00BC', '录', 'garbled ¼→录');
replaceText('\u01F3', '请', 'garbled ǳ→请');
replaceText('\u03E2', '消', 'garbled Ϣ→消');
replaceText('\u01F0', '当', 'garbled ǰ→当');
replaceText('\u047C', '浏', 'garbled Ѽ→浏');
replaceText('\u04BB', '新', 'garbled һ→新');
replaceText('\u022B', '全', 'garbled ȫ→全');
replaceText('\u0471', '修', 'garbled ѱ→修');
replaceText('\u0F2D', '编', 'garbled ༭→编');
replaceText('\u00F6', '置', 'garbled ö→置');
replaceText('\u0671', '备', 'garbled ٱ→备');

// ====== Emoji in HTML strings ======
replaceText('\uD83D\uDC95', '❤️', 'emoji ❤️');
replaceText('\uD83D\uDC96', '💕', 'emoji 💕');
replaceText('\uD83E\uDD0D', '🤍', 'emoji 🤍');
replaceText('\uD83D\uDC97', '💗', 'emoji 💗');
replaceText('\uD83D\uDC98', '💘', 'emoji 💘');

replaceText('\uD83D\uDD12', '🔒', 'emoji 🔒');
replaceText('\uD83D\uDD13', '🔓', 'emoji 🔓');
replaceText('\uD83D\uDCCC', '📌', 'emoji 📌');
replaceText('\uD83D\uDCAC', '💬', 'emoji 💬');
replaceText('\uD83D\uDDBC', '🖼', 'emoji 🖼');
replaceText('\uD83C\uDF9E', '🎞', 'emoji 🎞');

replaceText('\uD83D\uDCCB', '📋', 'emoji 📋');
replaceText('\uD83D\uDCCA', '📊', 'emoji 📊');
replaceText('\uD83D\uDCF7', '📷', 'emoji 📷');
replaceText('\uD83C\uDFAC', '🎬', 'emoji 🎬');
replaceText('\uD83C\uDF19', '🌙', 'emoji 🌙');
replaceText('\uD83D\uDCED', '📭', 'emoji 📭');
replaceText('\uD83D\uDD0A', '🔊', 'emoji 🔊');

// ====== HTML template text fixes ======
replaceText('娴忚\uE79E', '浏览', 'html 浏览 garbled');
replaceText('鐐硅禐', '点赞', 'html 点赞 garbled');
replaceText('璇勮\uE79E', '评论', 'html 评论 garbled');
replaceText('璁板綍', '记录', 'html 记录 garbled');
replaceText('鍥剧墖', '图片', 'html 图片 garbled');
replaceText('瑙嗛\uE79E', '视频', 'html 视频 garbled');
replaceText('绉佸瘑', '私密', 'html 私密 garbled');
replaceText('鍏\uE79E\uE74F', '公开', 'html 公开 garbled');
replaceText('缃\uE79E\u9876', '置顶', 'html 置顶 garbled');
replaceText('鏆傛棤', '暂无', 'html 暂无 garbled');
replaceText('鍏\uE79E\uE591', '公告', 'html 公告 garbled');
replaceText('娑堟伅', '消息', 'html 消息 garbled');
replaceText('鍔犺浇涓\u002E\u002E\u002E', '加载中...', 'html loading garbled');
replaceText('鍒锋柊涓\u002E\u002E\u002E', '刷新中...', 'html refresh garbled');
replaceText('绛涢\u20AC夌敤鎴峰姞杞戒腑', '筛选用户加载中', 'html filter loading garbled');
replaceText('鍘嬬缉澶辫触鏃跺洖閫\u20AC绛栫暐', '压缩失败时回退策略', 'changelog garbled');

// ====== Page reload ======
replaceText('\u9875\u5934\u59CB', '重新加载', 'page reload garbled');

// ====== View history footer ======
replaceText('\u01F0\u047C\u00BC\u047C', '当前浏览记录', 'view history footer');

// ====== Undo over-aggressive replacements from earlier ======
// The v3 script replaced || '失败'|| '失败' in the escapeHtml functions, breaking code
// Fix broken escape pattern
replaceText("|| '失败'|| '失败''", "\\'", "fix broken escape 1");
replaceText("|| '失败'''", "\\'", "fix broken escape 2");
replaceText("|| '失败''", "\\'", "fix broken escape 3");

console.log('\n=== v4 Fix complete ===');
fs.writeFileSync(filePath, content, 'utf8');
