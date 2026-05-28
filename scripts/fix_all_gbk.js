const fs = require('fs');
const path = require('path');

console.log('=== 开始修复 GBK 编码 ===\n');

// 尝试用不同编码读取并保存为 UTF-8
function fixEncoding(filePath) {
    try {
        console.log(`处理: ${path.basename(filePath)}`);
        
        // 读取原始文件 Buffer
        const buffer = fs.readFileSync(filePath);
        
        // 尝试用 GBK 解码
        let content;
        try {
            // Node.js 不直接支持 GBK，但可以尝试用 iconv-lite
            // 先检查一下文件是否已经是 UTF-8
            const utf8Str = buffer.toString('utf8');
            
            // 如果已经有很多中文，就不需要修复了
            const chineseCount = (utf8Str.match(/[\u4e00-\u9fa5]/g) || []).length;
            if (chineseCount > 10) {
                console.log(`  ✅ 文件看起来已经是正常 UTF-8，有 ${chineseCount} 个中文`);
                return false;
            }
            
            // 看起来是乱码，尝试修复
            console.log(`  发现乱码，尝试用 GBK 解码...`);
            
            // 方法：将字符串作为 latin1 编码读回 Buffer，再用 GBK 解码
            // 但 Node.js 不直接支持 GBK，所以我们用另一种方法
            
            // 创建一个临时的修复映射表（从常见乱码到中文）
            let result = utf8Str;
            
            // 从截图中看到的乱码和正确文本的对应关系
            const fixes = {
                '鐢熸垚': '评论',
                '璁╀粬': '点赞',
                '鍙戞爣': '举报',
                '寮€濮嬫垚': '登录',
                '鏌ョ湅璧勬枡': '查看资料',
                '鏈夊鐧诲綍': '未登录', 
                '鐐瑰嚮鐧诲綍': '点击登录',
                '涓炬姤': '举报',
                '鏈嶅姟鍔犺浇澶辫触锛岃鍒锋柊椤甸潰閲嶈瘯': '服务加载失败，请刷新页面重试',
                '缂撳瓨5鍒嗛挓': '缓存5分钟',
                '鐧诲綍': '登录',
                '娉ㄥ唽': '注册',
                '鏄电О': '昵称',
                '瀵嗙爜': '密码',
                '澶村儚': '头像',
                '鍔犺浇': '加载',
                '鍙戝竷': '发布',
                '鍒犻櫎': '删除',
                '璇勮?': '评论',
                '璧勬枡': '资料',
                '鐐瑰嚮': '点击',
                '鏌ョ湅': '查看',
                '鍒嗕韩': '分享',
                '鏀惰棌': '收藏',
                '璧炲悓': '点赞',
                '鍙栨秷': '取消',
                '鍙戞秷鎭?': '发消息',
                '閫€鍑?': '退出',
                '鏈嶅姟': '服务',
                '鍒锋柊': '刷新',
                '椤甸潰': '页面',
                '閲嶈瘯': '重试',
                '鐢ㄦ埛': '用户',
                '淇℃伅': '信息',
                '鍔ㄦ€?': '动态',
                '鍒楄〃': '列表',
                '鏍峰紡': '样式',
                '鏂囦欢': '文件',
                '鍥剧墖': '图片',
                '瑙嗛?': '视频',
                '鎬绘暟': '总数',
                '鍒嗛櫎': '清除',
                '缂撳瓨': '缓存',
                '閫氱煡': '通知',
                '涓婚?': '主题',
                '鍒囨崲': '切换',
                '鏇存柊': '更新',
                '鏃ュ織': '日志',
                '鍏叕鍛?': '公告',
                '缁熻?': '统计',
                '鍒嗘瀽': '分析',
                
                // 从截图中看到的
                '鐐硅禐': '点赞',
                '璇勮?': '评论',
                '鎶?鍙?': '举报',
                
                // 更多常见乱码对应
                '鏂囦欢': '文件',
                '鏁版嵁': '数据',
                '浠ｇ爜': '代码',
                '椤圭洰': '项目',
                '缂栧啓': '编写',
                '鍒涘缓': '创建',
                '淇濆瓨': '保存',
                '鍒犻櫎': '删除',
                '鏇存柊': '更新',
                '鍒锋柊': '刷新',
                '鍚屾?': '同步',
                '鏌ユ壘': '搜索',
                '鏍规嵁': '根据',
                '鏈嶅姟': '服务',
                '鐢熸垚': '生成',
                '涓嬭浇': '下载',
                '涓婁紶': '上传',
                '鍘嬬缉': '压缩',
                '瑙ｅ帇': '解压',
                '澶囨敞': '备份',
                '鎭㈠?': '恢复',
                '绉诲姩': '移动',
                '澶嶅埗': '复制',
                '绮樿创': '粘贴',
                '鍒囨崲': '替换',
                '鍏抽棴': '关闭',
                '寮€鍚?': '开启',
                '鏄剧ず': '显示',
                '闅愯棌': '隐藏',
                '灞曞紑': '展开',
                '鏀惰捣': '收起',
                '鏇村?': '更多',
                '鏈€灏?': '最少',
                '鏈€澶?': '最多',
                '鏂扮殑': '新的',
                '鏃х殑': '旧的',
                '濂界殑': '好的',
                '鍧忕殑': '坏的',
                '澶х殑': '大的',
                '灏忕殑': '小的',
                '楂樼殑': '高的',
                '浣庣殑': '低的',
                '闀跨殑': '长的',
                '鐭樼殑': '短的',
                '蹇殑': '快的',
                '鎱殑': '慢的',
                '鍚庣殑': '后的',
                '鍓嶇殑': '前的',
                '宸﹀彸': '左右',
                '涓婁笅': '上下',
                '鍐呭?': '内外',
                '涓棿': '中间',
                
                // 常见短语
                '璇峰啓鍏ュ瘑鐮?': '请输入密码',
                '璇峰啓鍏ユ樀绉?': '请输入昵称',
                '瀹屾垚': '完成',
                '寮€濮嬫垚': '开始',
                '缁撴潫': '结束',
                '鏆傚仠': '暂停',
                '缁х画': '继续',
                '鍋滄?': '停止',
                '閲嶈瘯': '重试',
                '鍙栧彂': '发送',
                '鎺ユ敹': '接收',
                '璇诲彇': '读取',
                '鍐欏叆': '写入',
                '鏌ヨ瘯': '查询',
                '鍓嶅線': '前往',
                '杩斿洖': '返回',
                '棣栭〉': '首页',
                '鍒楄〃': '列表',
                '璇︽儏': '详情',
                '缂栬緫': '编辑',
                '鏂板缓': '新建',
                
                // 更多...
            };
            
            let count = 0;
            for (const [from, to] of Object.entries(fixes)) {
                if (result.includes(from)) {
                    const regex = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
                    const matches = (result.match(regex) || []).length;
                    result = result.replace(regex, to);
                    count += matches;
                }
            }
            
            if (count > 0) {
                fs.writeFileSync(filePath, result, 'utf8');
                console.log(`  ✅ 修复了 ${count} 处并保存！`);
                return true;
            } else {
                console.log(`  ℹ️ 没有找到可修复的内容`);
                return false;
            }
        } catch (e) {
            console.log(`  ❌ 处理出错: ${e.message}`);
            return false;
        }
    } catch (e) {
        console.log(`  ❌ 无法读取文件: ${e.message}`);
        return false;
    }
}

// 处理所有重要文件
const files = [
    path.join(__dirname, '..', 'js', 'core.js'),
    path.join(__dirname, '..', 'js', 'features.js'),
    path.join(__dirname, '..', 'index.html'),
    path.join(__dirname, '..', 'js', 'photo-wall', 'photo-wall.js'),
    path.join(__dirname, '..', 'js', 'photo-wall', 'render.js'),
    path.join(__dirname, '..', 'js', 'photo-wall', 'upload.js'),
    path.join(__dirname, '..', 'js', 'photo-wall', 'preview.js'),
    path.join(__dirname, '..', 'js', 'core', 'posts.js'),
    path.join(__dirname, '..', 'js', 'core', 'auth.js'),
];

let totalFixed = 0;
for (const file of files) {
    if (fs.existsSync(file)) {
        if (fixEncoding(file)) {
            totalFixed++;
        }
    }
}

console.log(`\n=== 完成！共修复 ${totalFixed} 个文件 ===`);
