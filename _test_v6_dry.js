// 只做"干运行"测试，打印变化
const fs = require('fs');

// 运行修复逻辑
function hasGarbleChar(text) {
  const GARBLE_CHARS = new Set([
    '鍒','鍙','鐢','甯','栧','瓙','绛','閿','鎷','闂','傢','垹','娅',
    '鎸','鏈','鍔','娉','纭','鎶','娑','堟','櫒','鍏','鎵','惧','埌','鐩',
    '稿','叧','鐨','鎿','嶄','綔','瑕','佹','墽','琛','槸','涔','鍜','灏',
    '伓','璐','腑','搴','涓','鐪','嬭','绉','佸','瘑','曞','ぇ','姘',
    '旀','浣','犵','殑','鎯','鏂版','嫨','嶆','槸','鏃ユ湡','鏇存',
    '鍙戞柊','鏂版潈','鐢靛瓙','绾㈣壊','鍟嗗搧','鏈嶅姟','鏂逛究','鏂囦欢','鐢靛奖','鏂瑰悜',
    '闈欓粯','鍒犻櫎','鎴愬姛','缁熻','鏃ュ織','瀹夊叏','鎴戠殑','璧勬枡','鏇存柊','澶村儚',
    '鐢ㄦ埛','娑堟伅','鎸夐挳','鍙鑼冨洿','鍏紑','绉佸瘑','鍒嗕韩','璁剧疆','纭畾',
    '淇濆瓨','淇濈暀','鏂扮殑','鐩稿叧','鎵惧埌','鐧诲綍','娉ㄩ攢','楠岃瘉','宸茬粡','浣跨敤',
    '婊氬姩鍒?','鎸囧畾','骞朵骇鐢?','楂樹寒','鍏ㄩ儴','閲嶆柊閫夋嫨','璁板綍','鏁版嵁','缃戠粶',
    '鍔犺浇','涓婁紶','鍙戦€?','鎿嶄綔','杩斿洖','瑙﹀彂','纭繚','寮哄埗','娓呴櫎','娈嬬暀',
    '鏁版嵁搴?','鏁版嵁搴擄紙DB锛?',
  ]);
  for (const c of text) if (GARBLE_CHARS.has(c)) return true;
  return false;
}

// 从core.js读取，打印前15行含乱码的行及修复结果
const iconv = require('iconv-lite');

function tryDecodeBlock(block) {
  if (block.length < 2) return null;
  if (!/[\u4e00-\u9fa5]/.test(block)) return null;
  try {
    const bytes = iconv.encode(block, 'gbk');
    const decoded = bytes.toString('utf-8');
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
    return decoded;
  } catch (e) { return null; }
}

const MAP_PAIRS = [
  ['鏁版嵁搴?', '数据库'],
  ['鏁版嵁搴撶殑鏁版嵁', '数据库的数据'],
  ['甯栧瓙', '帖子'],
  ['鏂扮殑甯栧瓙', '新的帖子'],
  ['鍒涘缓璐﹀彿', '创建账号'],
  ['鍏ㄩ儴', '全部'],
  ['閲嶆柊閫夋嫨', '重新选择'],
  ['婊氬姩', '滚动'],
  ['鎸囧畾', '指定'],
  ['楂樹寒', '高亮'],
  ['鏁版嵁', '数据'],
  ['鍔犺浇', '加载'],
  ['鐢ㄦ埛', '用户'],
  ['鏇存柊', '更新'],
  ['鍒犻櫎', '删除'],
  ['鎴愬姛', '成功'],
  ['璁剧疆', '设置'],
  ['鍒嗕韩', '分享'],
];

const content = fs.readFileSync('js/core.js', 'utf-8');
let lines = content.split('\n');
let shown = 0;

for (let li = 0; li < lines.length; li++) {
  const line = lines[li];
  if (!/[鍒鍙鐢甯栧瓙鏁版嵁鍏ㄩ儴閲嶆]/.test(line)) continue;
  if (shown >= 20) break;
  
  // 模拟修复
  let processed = line;
  for (const [from, to] of MAP_PAIRS) processed = processed.split(from).join(to);
  
  // 逐块尝试解码
  let finalLine = '';
  let i = 0;
  while (i < processed.length) {
    const code = processed.charCodeAt(i);
    if (code > 127) {
      let j = i;
      let asciiStreak = 0;
      while (j < processed.length) {
        const cj = processed.charCodeAt(j);
        if (cj > 127) { j++; asciiStreak = 0; }
        else if (/[0-9\s\-_,.:!?;:%&()=+<>\"'\/\[\]{}@#$^~*|\\]/.test(processed[j])) {
          if (asciiStreak < 4) { j++; asciiStreak++; } else break;
        } else break;
      }
      while (j > i && processed.charCodeAt(j-1) <= 127) j--;
      const block = processed.substring(i, j);
      if (hasGarbleChar(block)) {
        const d = tryDecodeBlock(block);
        if (d) { finalLine += d; i = j; continue; }
      }
      finalLine += block;
      i = j;
    } else {
      finalLine += processed[i];
      i++;
    }
  }
  
  if (finalLine !== line) {
    shown++;
    console.log('L' + (li+1) + ':');
    console.log('  原: ' + line.trim().slice(0, 140));
    console.log('  修: ' + finalLine.trim().slice(0, 140));
    console.log();
  }
}
console.log('\n显示了 ' + shown + ' 处变化');
