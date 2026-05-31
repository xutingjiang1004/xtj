const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'js', 'core.js');
let content = fs.readFileSync(filePath, 'utf8');
let count = 0;

function fix(from, to, label) {
    const idx = content.indexOf(from);
    if (idx === -1) { console.log('  [SKIP] ' + label); return; }
    const before = content;
    content = content.split(from).join(to);
    const n = Math.round((before.length - content.length) / (from.length - to.length));
    count += n;
    console.log('  [' + n + 'x] ' + label);
}

console.log('=== Fixing post rendering garbled text ===\n');

// ====== Post stats text (most visible) ======
fix('娴忚\uE79E', '浏览', 'stats: 浏览');
fix('鐐硅禐', '点赞', 'stats: 点赞');
fix('璇勮\uE79E', '评论', 'stats: 评论');
fix('\u748B\u003F', ' | ', 'stats: separator |');

// ====== Like button emoji ======
fix('鉂わ笍', '❤️', 'btn: liked heart');

// ====== Post action buttons ======
fix('鍒犻櫎', '删除', 'btn: 删除');
fix('缂栬緫', '编辑', 'btn: 编辑');
fix('缃\uE79E\u9876', '置顶', 'btn: 置顶');
fix('鍙栨秷缃\uE79E\u9876', '取消置顶', 'btn: 取消置顶');

// ====== Post visibility badges ======
fix('\uD83D\uDD12 绉佸瘑', '🔒 私密', 'badge: private');
fix('\uD83D\uDD13 鍏\uE79E\uE74F', '🔓 公开', 'badge: public');
fix('\uD83D\uDCCC 缃\uE79E\u9876', '📌 置顶', 'badge: pinned');

// ====== Post detail rendering ======
fix('甯栧瓙涓嶅瓨鍦\uE79E垨宸插垹闄\u002F', '帖子不存在或已删除<', 'detail: post deleted');
fix('鏃犳潈\uFFFD介\uFFFD杩欐潯甯栧瓙', '无权查看这条帖子', 'detail: no permission');
fix('鏆傛棤鐐硅禐', '暂无点赞', 'detail: no likes');
fix('鏆傛棤璇勮\uE79E', '暂无评论', 'detail: no comments');
fix('\uD83D\uDCAC 璇勮\uE79E閸掓\uE79E銆\uE79E敍\u003F', '💬 评论列表：', 'detail: comment header');
fix('鉂わ笍 鐐硅禐鐢ㄦ埛閿\u003F', '❤️ 点赞用户 ', 'detail: like users header');

// ====== Format post summary ======
fix('\uD83D\uDDBC 鍥剧墖', '🖼 图片', 'summary: image tag');
fix('\uD83C\uDF9E 瑙嗛\uE79E', '🎞 视频', 'summary: video tag');

// ====== Empty feed text ======
fix('蹇\uE79E潵鍙戝竷绗\uE79E竴鏉″姩鎬佸惂~', '快来发布第一条动态吧~', 'feed: empty prompt');

// ====== Stat empty states ======
fix('鏆傛棤鍔\uE79E\uFFFD芥暟\uFFFD', '暂无数据', 'stat: empty');
fix('鍔犺浇澶辫触锛岃\uE79E閲嶈瘯', '加载失败，请重试', 'stat: load error');
fix('鐐瑰嚮鏌ョ湅甯栧瓙璇︽儏', '点击查看帖子详情', 'stat: click to view');

// ====== Format post time ======
fix(' 路 宸茬紪杈?', ' · 已编辑', 'time: edited');

// ====== load feed loading text ======
fix("'内容加载中', '正在召回数据'", "'加载中', '加载中'", 'loading: loadFeed');

// ====== Post detail loading ======
fix("'加载中', '正在打开帖子详情'", "'加载中', '加载中'", 'loading: post detail');

// ====== Stat loading ======
fix("'加载中', '正在召回数据'", "'加载中', '加载中'", 'loading: stat');

console.log('\n=== Fixed ' + count + ' occurrences ===');
fs.writeFileSync(filePath, content, 'utf8');
