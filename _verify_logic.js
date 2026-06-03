// 验证：确保正常中文不被误改，同时乱码中文被修复
const iconv = require('iconv-lite');
const GARBLE_CHARS = new Set([
  '鍒','鍙','鐢','甯','栧','瓙','绛','閿','鎷','闂','傢','垹','娅',
  '鎸','鏈','鍔','娉','纭','鎶','娑','堟','櫒','鍏','鎵','惧','埌','鐩',
  '稿','叧','鐨','鎿','嶄','綔','瑕','佹','墽','琛','槸','涔','鍜','灏',
  '伓','璐','腑','搴','涓','鐪','嬭','绉','佸','瘑','曞','ぇ','姘',
  '旀','浣','犵','殑','鎯','嫨','嶆','瓙','嚭','鐗','鏇','鏂','澶村','儚',
]);

function hasGarbleChar(text) {
  for (const c of text) if (GARBLE_CHARS.has(c)) return true;
  return false;
}

function tryDecodeBlock(block) {
  if (block.length < 2) return null;
  if (block.includes('\ufffd')) return null;
  try {
    const bytes = iconv.encode(block, 'gbk');
    const decoded = bytes.toString('utf-8');
    if (decoded.includes('\ufffd')) return null;
    let maxConsec = 0, consec = 0, good = 0;
    for (const ch of decoded) {
      const c = ch.charCodeAt(0);
      if (c >= 0x4E00 && c <= 0x9FA5) { consec++; good++; if (consec > maxConsec) maxConsec = consec; }
      else consec = 0;
    }
    if (good < 2 || maxConsec < 2) return null;
    return decoded;
  } catch (e) { return null; }
}

const tests = [
  // 乱码文本（应修复）
  ['閬垮厤閲嶅璁板綍', '避免重复记录'],
  ['鐢ㄦ埛鐨勬暟鎹簱', '用户的数据库'],
  ['鍏ㄩ儴甯栧瓙', '全部帖子'],
  ['閲嶆柊閫夋嫨', '重新选择'],
  ['婊氬姩鍒版寚瀹氬笘瀛愬苟楂樹寒', '滚动到指定帖子并高亮'],
  // 正常文本（不应修改）
  ['当前用户', '当前用户'],
  ['删除按钮', '删除按钮'],
  ['避免重复记录', '避免重复记录'],
  ['全部帖子', '全部帖子'],
  ['蜡笔金属包边', '蜡笔金属包边'],  // 蜡笔是正常设计词汇
  ['数据库', '数据库'],
  ['消息', '消息'],
];

let ok = true;
for (const [input, expected] of tests) {
  let actual;
  if (hasGarbleChar(input)) {
    actual = tryDecodeBlock(input) || input;
  } else {
    actual = input;
  }
  const pass = actual === expected;
  if (!pass) ok = false;
  console.log((pass ? '✓ ' : '✗ ') + input + ' -> ' + actual + (pass ? '' : ' (期望: ' + expected + ')'));
}
console.log(ok ? '\n全部通过 ✓' : '\n有失败 ✗');
