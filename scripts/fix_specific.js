const fs = require('fs');
const path = require('path');

const corePath = path.join(__dirname, '..', 'js', 'core.js');
let content = fs.readFileSync(corePath, 'utf8');

// 直接替换看到的具体乱码:
content = content.replace(/娴忚?/g, '浏览');
content = content.replace(/璇勮?/g, '评论');
content = content.replace(/鎸夌敤鎴峰垎缁/g, '按用户分组');
content = content.replace(/鍜岃瘎璁?/g, '和评论');
content = content.replace(/鐢ㄦ埛锛?/g, '用户（');
content = content.replace(/鏆傛棤点赞/g, '暂无点赞');
content = content.replace(/娓叉煋/g, '绘制');
content = content.replace(/璁板綍/g, '记录');
content = content.replace(/浜嗭細/g, '了：');
content = content.replace(/淇?澶?/g, '修复');
content = content.replace(/鎸夐挳鐐瑰嚮鏃犲搷搴旈棶棰?/g, '按钮点击无响应问题');
content = content.replace(/瀛楁?鍚嶅尮閰嶏紝娣诲姞/g, '字段名匹配，添加');
content = content.replace(/绉婚櫎/g, '移除');
content = content.replace(/寮圭獥鍐呰仈/g, '弹窗内容');
content = content.replace(/鐨勭粺涓€/g, '，统一');
content = content.replace(/鎺у埗/g, '控制');
content = content.replace(/鎸夐挳淇?澶?/g, '按钮修复');
content = content.replace(/鍙冲?榻愮疆搴曪紝閫氳繃/g, '右对齐置底，通过');
content = content.replace(/璋冪敤/g, '调用');
content = content.replace(/鍙婂睆骞曞昂鍒?/g, '和屏幕尺寸');
content = content.replace(/鏈?櫥褰曠敤鎴峰彧鑳芥煡鐪嬶紝涓嶈兘/g, '未登录用户只能查看，不能');
content = content.replace(/鍙戝竷/g, '发布');
content = content.replace(/璇勮?/g, '评论');

fs.writeFileSync(corePath, content, 'utf8');
console.log('修复完成！');
