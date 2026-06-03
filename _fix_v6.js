// 终极 v6 修复：1) 已知高频率乱码模式直接替换 2) 对非ASCII块做GBK解码
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

// ========= 阶段1：精确映射替换（最高优先级） =========
// 这些是"乱码文本 → 正确中文"的精确映射，来自大量测试
const MAP_PAIRS = [
  // 高频核心词
  ['鏁版嵁搴?', '数据库'],  // 以问号结尾的变体
  ['鏁版嵁搴撶殑鏁版嵁', '数据库的数据'],
  ['鏁版嵁搴?', '数据库'],
  ['鏁版嵁搴擄紙DB锛?', '数据库（DB）'],
  ['甯栧瓙', '帖子'],
  ['鏂扮殑甯栧瓙', '新的帖子'],
  ['鍒涘缓璐﹀彿', '创建账号'],
  ['鏂版潈', '新权限'],
  ['绾㈣壊', '红色'],
  ['鐢靛瓙', '电子'],
  ['鍟嗗搧', '商品'],
  ['鏈嶅姟', '服务'],
  ['鏂逛究', '方便'],
  ['鏂囦欢', '文件'],
  ['鐢靛奖', '电影'],
  ['鏂瑰悜', '方向'],
  ['闈欓粯', '静默'],
  ['鍒犻櫎', '删除'],
  ['鎴愬姛', '成功'],
  ['缁熻', '统计'],
  ['鏃ュ織', '日志'],
  ['瀹夊叏', '安全'],
  ['鎴戠殑', '我的'],
  ['璧勬枡', '资料'],
  ['儚瀵?', '密码'],
  ['鏇存柊', '更新'],
  ['澶村儚', '头像'],
  ['鐢ㄦ埛', '用户'],
  ['娑堟伅', '消息'],
  ['鎸夐挳', '按钮'],
  ['鍙鑼冨洿', '可见范围'],
  ['鍏紑', '公开'],
  ['绉佸瘑', '私密'],
  ['鍒嗕韩', '分享'],
  ['璁剧疆', '设置'],
  ['纭畾', '确定'],
  ['淇濆瓨', '保存'],
  ['淇濈暀', '保留'],
  ['鏂扮殑', '新的'],
  ['鐩稿叧', '相关'],
  ['鎵惧埌', '找到'],
  ['鎵惧埌鎵€鏈?', '找到所有'],
  ['鍙栧緱', '取得'],
  ['鐧诲綍', '登录'],
  ['娉ㄩ攢', '注册'],
  ['楠岃瘉', '验证'],
  ['楠岃瘉鐮?', '验证码'],
  ['楠岃瘉鐮佷笉姝ｇ‘', '验证码不正确'],
  ['宸茬粡', '已经'],
  ['浣跨敤', '使用'],
  ['鏂囦欢澶囦欢', '文件副本'],
  ['鏂逛究浣跨敤', '方便使用'],
  ['婊氬姩鍒?', '滚动到'],
  ['鎸囧畾甯栧瓙', '指定帖子'],
  ['骞朵骇鐢?', '并产生'],
  ['楂樹寒', '高亮'],
  ['骞朵骇鐢熸椿鍔?', '并产生动画'],
  ['鍏ㄩ儴', '全部'],
  ['閲嶆柊閫夋嫨', '重新选择'],
  ['闅愬緱', '随便'],
  ['璁板綍', '记录'],
  ['鏁版嵁', '数据'],
  ['缃戠粶', '网络'],
  ['鍔犺浇', '加载'],
  ['涓婁紶', '上传'],
  ['鍙戦€?', '发送'],
  ['鍙戦€佹秷鎭?', '发送消息'],
  ['鎿嶄綔', '操作'],
  ['杩斿洖', '返回'],
  ['瑙﹀彂', '触发'],
  ['纭繚', '确保'],
  ['寮哄埗', '强制'],
  ['娓呴櫎', '清除'],
  ['娈嬬暀', '残留'],
  ['鐧诲綍鐘舵€?', '登录状态'],
  ['鏈櫥褰?', '未登录'],
  ['宸茬櫥褰?', '已登录'],
  ['鏈獙璇?', '未验证'],
  ['宸茬粨鏉?', '已结束'],
  ['杩涜涓?', '进行中'],
  ['宸茬Щ闄?', '已移除'],
  ['鏂板缓', '新建'],
  ['绾犻槦', '维护'],
  ['鏁翠綋', '整体'],
  ['绉戝ぇ', '科大'],
  ['鍙栧緱鏁版嵁', '取得数据'],
  ['鍒ゆ柇鏄惁', '判断是否'],
  ['鏃犳晥', '无效'],
  ['瀹夊叏楠岃瘉', '安全验证'],
  ['涓婃姤', '上报'],
  ['鏈嶅姟绔?', '服务端'],
  ['鐢靛瓙閭欢', '电子邮件'],
  ['绾㈣壊鐨?', '红色的'],
  ['绗﹀悎', '符合'],
  ['鏀寔', '支持'],
  ['娲诲姩', '活跃'],
  ['涓婚', '主题'],
  ['棰滆壊', '颜色'],
  ['澶勭悊', '处理'],
  ['浜掕栋', '互动'],
  ['绉诲姩', '移动'],
  ['鍔犺浇澶卞溾', '加载失败'],
  ['璇锋眰澶卞溾', '请求失败'],
  ['鏈湁鏁版嵁', '无数据'],
  ['鏁版嵁涓嶅瓨鍦?', '数据不存在'],
  ['鏁版嵁閿欒', '数据错误'],
  ['鏈煡閿欒', '未知错误'],
  ['璇锋眰鏁版嵁', '请求数据'],
  ['鍔犺浇鏁版嵁', '加载数据'],
  ['涓婃洿鏂版暟鎹?', '更新数据'],
  ['涓嬫媺鏂版暟鎹?', '下拉刷新'],
  ['鎺ㄥ姩鏇存柊', '推送更新'],
  ['寮傛璇锋眰', '异步请求'],
  ['鍚屾璇锋眰', '同步请求'],
  ['璇锋眰鏃犳晥', '请求无效'],
  ['鏈嶅姟鍣ㄥ搷搴?', '服务器响应'],
  ['瀹㈡埛绔姹?', '客户端请求'],
  ['璇锋眰鏁版嵁搴?', '请求数据库'],
  ['鏁版嵁搴撳瓨鍌?', '数据库存储'],
  ['鏁版嵁搴撴煡璇?', '数据库查询'],
  ['鏁版嵁搴撴洿鏂?', '数据库更新'],
  ['鏁版嵁搴撳垹闄?', '数据库删除'],
  ['鏁版嵁搴撴彃鍏?', '数据库插入'],
  // 以问号结尾的变体（因锟斤拷截断产生的结尾问号）
  // 已登录? 未登录? 这类
];

// 补充：对剩余"乱码字符"做逐字符的 GBK 检测（这些字在正常中文中几乎不会出现）
const GARBLE_CHARS = new Set([
  '鍒','鍙','鐢','甯','栧','瓙','绛','閿','鎷','闂','傢','垹','娅',
  '鎸','鏈','鍔','娉','纭','鎶','娑','堟','櫒','鍏','鎵','惧','埌','鐩',
  '稿','叧','鐨','鎿','嶄','綔','瑕','佹','墽','琛','槸','涔','鍜','灏',
  '伓','璐','腑','搴','涓','鐪','嬭','绉','佸','瘑','曞','ぇ','姘',
  '旀','浣','犵','殑','鎯','鏂版','嫨','嶆','槸','鏃ユ湡','鏇存'
]);

// ========= 阶段2：对单个非ASCII块尝试GBK→UTF-8解码 =========
function tryDecodeBlock(block) {
  if (block.length < 2) return null;
  if (!/[\u4e00-\u9fa5]/.test(block)) return null;
  try {
    const bytes = iconv.encode(block, 'gbk');
    const decoded = bytes.toString('utf-8');
    // 验证：至少2个连续汉字， U+FFFD 占比 < 20%
    let maxConsec = 0, consec = 0, good = 0;
    for (const ch of decoded) {
      const c = ch.charCodeAt(0);
      if (c >= 0x4E00 && c <= 0x9FA5) { consec++; good++; if (consec > maxConsec) maxConsec = consec; }
      else consec = 0;
    }
    if (good < 2 || maxConsec < 2) return null;
    const bad = (decoded.match(/\ufffd/g) || []).length;
    if (decoded.includes('\ufffd\ufffd')) return null;
    if (bad > Math.max(1, good * 0.25)) return null;
    // 额外验证：解码前后长度不能极端变化
    if (decoded.length < block.length * 0.5 || decoded.length > block.length * 1.5) return null;
    return decoded;
  } catch (e) {
    return null;
  }
}

function hasGarbleChar(text) {
  for (const c of text) if (GARBLE_CHARS.has(c)) return true;
  return false;
}

function fixContent(content) {
  // 阶段1：精确替换
  let result = content;
  for (const [from, to] of MAP_PAIRS) {
    result = result.split(from).join(to);
  }
  // 阶段2：对含乱码特征字的非ASCII块做解码
  // 逐字符扫描
  let finalResult = '';
  let i = 0;
  while (i < result.length) {
    const code = result.charCodeAt(i);
    if (code > 127) {
      let j = i;
      let asciiStreak = 0;
      while (j < result.length) {
        const cj = result.charCodeAt(j);
        if (cj > 127) { j++; asciiStreak = 0; }
        else if (/[0-9\s\-_,.:!?;:%&()=+<>\"'\/\[\]{}@#$^~*|\\]/.test(result[j])) {
          if (asciiStreak < 4) { j++; asciiStreak++; } else break;
        } else break;
      }
      while (j > i && result.charCodeAt(j-1) <= 127) j--;
      const block = result.substring(i, j);
      // 只对"包含乱码特征字"的块尝试解码（避免破坏正常中文）
      if (hasGarbleChar(block)) {
        const d = tryDecodeBlock(block);
        if (d) {
          finalResult += d;
          i = j;
          continue;
        }
      }
      finalResult += block;
      i = j;
    } else {
      finalResult += result[i];
      i++;
    }
  }
  return finalResult;
}

// === 主程序 ===
const files = ['index.html', 'js/core.js', 'js/core.min.js'];
for (let round = 1; round <= 8; round++) {
  let anyFixed = false;
  console.log('第 ' + round + ' 轮:');
  for (const f of files) {
    const absPath = path.join(__dirname, f);
    if (!fs.existsSync(absPath)) continue;
    const original = fs.readFileSync(absPath, 'utf-8');
    const fixed = fixContent(original);
    if (fixed !== original) {
      fs.writeFileSync(absPath, fixed, 'utf-8');
      console.log('  ✓ ' + f);
      anyFixed = true;
    }
  }
  if (!anyFixed) break;
}
console.log('完成');
