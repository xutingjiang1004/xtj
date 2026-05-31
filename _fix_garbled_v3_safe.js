const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'js', 'core.js');
let content = fs.readFileSync(filePath, 'utf8');
let count = 0;

function replaceStr(oldStr, newStr, label) {
    const before = content;
    content = content.split(oldStr).join(newStr);
    const n = (before.length - content.length) / (oldStr.length - newStr.length);
    if (n > 0) {
        count += Math.round(n);
        console.log('  [' + Math.round(n) + 'x] ' + label);
    } else {
        console.log('  [SKIP] ' + label);
    }
}

console.log('=== Safe string-based garbled text fix ===\n');

// ====== Toast messages ======
replaceStr('璇峰厛鐧诲綍', '请先登录', 'toast: 请先登录');
replaceStr('瀵嗙爜閿欒\uE79E', '密码错误', 'toast: 密码错误');
replaceStr('璐﹀彿涓嶅瓨鍦\uE79E紝璇峰厛娉ㄥ唽', '账号不存在，请先注册', 'toast: 账号不存在');
replaceStr('鐧诲綍鎴愬姛锛屾\uE79E杩庡洖鏉ワ紒', '登录成功，欢迎回来！', 'toast: 登录成功');
replaceStr('鐧诲綍澶辫触锛岃\uE79E閲嶈瘯', '登录失败，请重试', 'toast: 登录失败');
replaceStr('娉ㄥ唽澶辫触: ', '注册失败: ', 'toast: 注册失败');
replaceStr('娉ㄥ唽鎴愬姛锛屾\uE79E杩庯紒', '注册成功，欢迎！', 'toast: 注册成功');
replaceStr('娉ㄥ唽澶辫触锛岃\uE79E閲嶈瘯', '注册失败，请重试', 'toast: 注册失败重试');
replaceStr('璇勮\uE79E澶辫触: ', '评论失败: ', 'toast: 评论失败');
replaceStr('鍒犻櫎澶辫触: ', '删除失败: ', 'toast: 删除失败');
replaceStr('鍒犻櫎甯栧瓙澶辫触', '删除帖子失败', 'toast: 删除帖子失败');
replaceStr('鏃犳潈缂栬緫杩欐潯甯栧瓙', '无权编辑这条帖子', 'toast: 无权编辑');
replaceStr('淇濆瓨澶辫触: ', '保存失败: ', 'toast: 保存失败');
replaceStr('缃戠粶閿欒\uE79E', '网络错误', 'toast: 网络错误');
replaceStr('鏈\uE79E煡閿欒\uE79E', '未知错误', 'toast: 未知错误');
replaceStr('鏃犳潈缃\uE79E\u9876杩欐潯甯栧瓙', '无权置顶这条帖子', 'toast: 无权置顶');
replaceStr('缃\uE79E\u9876鎿嶄綔澶辫触: ', '置顶操作失败: ', 'toast: 置顶失败');
replaceStr('鍙戝竷澶辫触: ', '发布失败: ', 'toast: 发布失败');
replaceStr('鍙戦\uE79E佸け璐\? ', '发送失败: ', 'toast: 发送失败');

// ====== Chat/announcement toasts ======
replaceStr('姝ｅ湪鍒锋柊鐓х墖澧\u002E\u002E\u002E', '正在刷新照片墙...', 'toast: 刷新照片墙');
replaceStr('鍒锋柊瀹屾垚', '刷新完成', 'toast: 刷新完成');
replaceStr('姝ｅ湪鍒锋柊\u002E\u002E\u002E', '正在刷新...', 'toast: 正在刷新');
replaceStr('璇疯嚦灏戝\uE79E鍐欐爣棰樻垨鍐呭\uE79E', '请至少填写标题或内容', 'toast: 填写内容');
replaceStr('鍏\uE79E憡鍙戝竷鎴愬姛', '公告发布成功', 'toast: 公告成功');
replaceStr('鍙戝竷澶辫触: ', '发布失败: ', 'toast: 发布失败2');
replaceStr('鍒犻櫎澶辫触: ', '删除失败: ', 'toast: 删除失败2');

// ====== Avatar upload toasts ======
replaceStr('璇烽\u20AC夋嫨鍥剧墖鏂囦欢', '请选择图片文件', 'toast: 选择图片');
replaceStr('鍥剧墖澶у皬涓嶈兘瓒呰繃10MB', '图片大小不能超过10MB', 'toast: 图片过大');
replaceStr('姝ｅ湪鍘嬬缉骞朵笂浼犲ご鍍\u002E\u002E\u002E', '正在压缩并上传头像...', 'toast: 上传头像');
replaceStr('涓婁紶澶辫触: ', '上传失败: ', 'toast: 上传失败');
replaceStr('澶村儚鏇存柊鎴愬姛', '头像更新成功', 'toast: 头像成功');
replaceStr('涓婁紶澶辫触锛岃\uE79E閲嶈瘯', '上传失败，请重试', 'toast: 上传失败重试');

// ====== Button text ======
replaceStr('鍙戝竷涓\u002E\u002E\u002E', '发布中...', 'btn: 发布中');
replaceStr('鍙戦\uE79E佷腑\u002E\u002E\u002E', '发送中...', 'btn: 发送中');
replaceStr('鍙戝竷鍔ㄦ\u20AC', '发布动态', 'btn: 发布动态');
replaceStr('楠岃瘉涓\u002E\u002E\u002E', '验证中...', 'btn: 验证中');
replaceStr('娉ㄥ唽涓\u002E\u002E\u002E', '注册中...', 'btn: 注册中');
replaceStr('鎻愪氦涓\u002E\u002E\u002E', '提交中...', 'btn: 提交中');

// ====== Image viewer ======
replaceStr('鏃犳硶鍔犺浇鍥剧墖锛屽彲鑳藉洜璺ㄥ煙闄愬埗鎴栨枃浠朵笉瀛樺湪', '无法加载图片，可能因跨域限制或文件不存在', 'html: 图片加载失败');

// ====== File upload ======
replaceStr('浠呮敮鎸佸浘鐗囧拰瑙嗛\uE79E', '仅支持图片和视频', 'html: 文件类型');
replaceStr('鏂囦欢澶у皬涓嶈兘瓒呰繃50MB', '文件大小不能超过50MB', 'html: 文件大小');

console.log('\n=== Fixed ' + count + ' garbled text occurrences ===');
fs.writeFileSync(filePath, content, 'utf8');
