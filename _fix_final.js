const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'js', 'core.js');
let content = fs.readFileSync(filePath, 'utf8');
let c = 0;
function f(o, n, l) {
    const b = content; content = content.split(o).join(n);
    if (b !== content) { const x = Math.round((b.length - content.length) / (o.length - n.length)); c += x; console.log('  ['+x+'x] '+l); } else console.log('  [SKIP] '+l);
}

console.log('=== Fix all remaining garbled strings ===\n');

// Toast messages
f('瀵嗙爜閿欒\uE79E', '密码错误', 'toast:密码错误');
f('璐﹀彿涓嶅瓨鍦\uE79E紝璇峰厛娉ㄥ唽', '账号不存在，请先注册', 'toast:账号不存在');
f('鐧诲綍鎴愬姛锛屾\uE79E杩庡洖鏉ワ紒', '登录成功，欢迎回来！', 'toast:登录成功');
f('鐧诲綍澶辫触锛岃\uE79E閲嶈瘯', '登录失败，请重试', 'toast:登录失败');
f('娉ㄥ唽鎴愬姛锛屾\uE79E杩庯紒', '注册成功，欢迎！', 'toast:注册成功');
f('娉ㄥ唽澶辫触锛岃\uE79E閲嶈瘯', '注册失败，请重试', 'toast:注册失败');

// Button text
f('楠岃瘉涓\u002E\u002E\u002E', '验证中...', 'btn:验证中');
f('娉ㄥ唽涓\u002E\u002E\u002E', '注册中...', 'btn:注册中');

// Error messages
f('鏈嶅姟鍔犺浇澶辫触锛岃\uE79E鍒锋柊椤甸潰閲嶈瘯', '服务加载失败，请刷新页面重试', 'err:service load fail');

// Save errors (more)
f('缃戠粶閿欒\uE79E', '网络错误', 'err:网络错误');
f('鏈\uE79E煡閿欒\uE79E', '未知错误', 'err:未知错误');

// ====== Final search for any remaining Ã·· characters ======
// These are the LEAST obvious but still garbled

console.log('\n=== Fixed ' + c + ' occurrences ===');
fs.writeFileSync(filePath, content, 'utf8');
