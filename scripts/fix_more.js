const fs = require('fs');
const path = require('path');

const corePath = path.join(__dirname, '..', 'js', 'core.js');
let content = fs.readFileSync(corePath, 'utf8');

const fixes = [
    ['娴忚?', '浏览'],
    ['璇勮?', '评论'],
    ['鏆傛棤', '暂无'],
    ['鎬诲姩鎬?', '总动态'],
    ['鎬绘祻瑙?', '总浏览'],
    ['鎭㈠?', '总评论'],
    ['璁板綍', '记录'],
    ['鐢ㄦ埛', '用户'],
    ['淇?澶?', '修复'],
    ['鎶?鍙?', '举报'],
    ['鎶?鍙?鎸夐挳', '举报按钮'],
    ['鍙戝竷', '发布'],
    ['鍒犻櫎', '删除'],
    ['鏇存柊', '更新'],
    ['鍒锋柊', '刷新'],
    ['鍙栧彂', '发送'],
    ['娉ㄥ唽', '注册'],
    ['鏄电О', '昵称'],
    ['瀵嗙爜', '密码'],
    ['瀹屾垚', '完成'],
    ['寮€濮嬫垚', '开始'],
    ['缁撴潫', '结束'],
    ['鏆傚仠', '暂停'],
    ['缁х画', '继续'],
    ['鍋滄?', '停止'],
    ['閲嶈瘯', '重试'],
    ['鏌ヨ瘯', '查询'],
    ['鍓嶅線', '前往'],
    ['杩斿洖', '返回'],
    ['棣栭〉', '首页'],
    ['鍒楄〃', '列表'],
    ['璇︽儏', '详情'],
    ['缂栬緫', '编辑'],
    ['鏂板缓', '新建'],
    ['淇濆瓨', '保存'],
    ['鍙栧彂', '发送'],
    ['閫€鍑?', '退出'],
    ['鏈€鏈??', '登录'],
    ['鏈嶅姟', '服务'],
    ['鍔犺浇', '加载'],
];

let total = 0;
for (const [from, to] of fixes) {
    const regex = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const matches = content.match(regex);
    if (matches) {
        total += matches.length;
        content = content.replace(regex, to);
    }
}

if (total > 0) {
    fs.writeFileSync(corePath, content, 'utf8');
    console.log('继续修复了 ' + total + ' 处！');
} else {
    console.log('没有更多需要修复的了！');
}
