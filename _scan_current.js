const fs = require('fs');

// 扫描 index.html - 用户可见文本中的乱码
const idx = fs.readFileSync('index.html', 'utf-8');
const core = fs.readFileSync('js/core.js', 'utf-8');

// 在 index.html 中找非ASCII块
console.log('=== index.html 中的非ASCII内容 ===');
let matches = idx.match(/[\u0080-\uffff][\u0080-\uffff\s0-9\-]{0,30}[\u0080-\uffff]|[\u0080-\uffff]/g);
if (matches) {
  const uniq = Array.from(new Set(matches));
  for (const m of uniq.slice(0, 50)) console.log('  [' + m + ']');
}

console.log('\n=== js/core.js 中的乱码关键词 ===');
const garbleKeywords = ['甯栧瓙','鍏ㄩ儴','閲嶆柊','鎸夐挳','鎴戠殑','璁剧疆','鍒犻櫎','鍔犺浇','鐢ㄦ埛','娑堟伅','鍒嗕韩','鏂版潈','鏁版嵁','澶村儚','鍙戦€?','绾㈣壊','绉佸瘑','鍏紑','鍙鑼冨洿','纭畾','淇濆瓨','鏂扮殑','鐩稿叧','鎵惧埌','宸茬粡','浣跨敤','閫夋嫨','璁板綍','缃戠粶','涓婁紶','鎿嶄綔','杩斿洖','瑙﹀彂','纭繚','寮哄埗','娓呴櫎','瀛樺偍','鏁版嵁搴?','鍙栧緱','鏃犳晥','涓婃姤','鏈嶅姟绔?','鐢靛瓙閭欢','绗﹀悎','鏀寔','娲诲姩','涓婚','棰滆壊','澶勭悊','浜掕栋','绉诲姩','鑾峰彇','鍑烘潵','鏂板缓','绾犻槦','鏁翠綋','绉戝ぇ','鐢靛奖','鏂逛究','鏂囦欢','鏈嶅姟','鍟嗗搧','鏂瑰悜','闈欓粯','鎴愬姛','缁熻','鏃ュ織','瀹夊叏','璧勬枡'];
let found = [];
for (const kw of garbleKeywords) {
  if (core.includes(kw)) found.push(kw);
}
console.log('core.js 中剩余的乱码关键词 (' + found.length + '):');
for (const f of found) console.log('  ' + f);
