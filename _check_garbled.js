const fs = require('fs');

const files = ['index.html', 'js/core.js', 'js/core.min.js', 'js/features.js', 'js/features.min.js'];

// 这些是乱码特征字符串（GBK错误解码产生的）
const garbledStrs = [
  '鍒嗛櫎','鍒犻櫎','缂栬緫','鍔犺浇','涓婁紶','澶辫触','鎴愬姛','鐓х墖','椤甸潰','鏁版嵁','缃戠粶',
  '瀹夊叏','妯″紡','浠ｇ爜','棰勮','鍒嗕韩','鏄剧ず','鏀寔','娲诲姩','鎶樺彔','闈㈡澘',
  '鎺т欢','瑙﹀彂','杩斿洖','鏆楄壊','涓婚','棰滆壊','澶勭悊','浜掍氦','绉婚櫎','璇█',
  '娴佺▼','淇″彿','璋冩暣','浣撲細','鍓嶇','娓呯悊','娈嬬暀','宸茶禐','宸茶援','娉ㄥ唽',
  '閲嶈瘯','姝ｅ湪','鍘嬬缉','鍙戝竷','淇濆瓨','纭畾','鍒锋柊','鐢ㄦ埛ID','鐢ㄦ埛璧勬枡',
  '鐓х墖璇︽儏','鐓х墖淇℃伅','鏃嬭浆','鍙戣〃璇勮','鍐欎笅浣犵殑鎯虫硶','缂栬緫甯栧瓙',
  '淇敼甯栧瓙鍐呭','鍙鑼冨洿','绉佸瘑','鍏紡','纭鍒犻櫎','鍒涘缓璐﹀彿',
  '閫€鍑?','妯℃€佹','淇濈暀','鏂伴矞','宸茶','鏈','鍏ㄩ儴甯栧瓙','娌℃湁鎵惧埌',
  '鐩稿叧甯栧瓙','纭鎿嶄綔','纭畾瑕佹墽琛屾鎿嶄綔鍚楋紵','纭','娑堟伅','鍏憡',
  '鏈煡閿欒','缃戠粶閿欒','鍔熻兘浼樺寲','Bug淇','鏂板','鏀硅繘','鏇存柊',
  '淇','绛涢€','甯栧瓙','鐢ㄦ埛','鍐呭','鎸夐挳','涓炬姤','缃《',
  '鍒嗕韩涓€鐐规柊椴滀簨','璇疯嚦灏戝～鍐欐爣棰樻垨','娴忚璁板綍','鍙戦€佸け璐?',
  '閿熸枻鎷烽敓鏂ゆ嫹','鐪嬬湅鎮ㄧ殑','鎴戠殑','鏄电О','瀵嗙爜','鏂板嚭鐗堟湰','淇濈暀',
  '鏇存柊鏃ュ織','涓汉璧勬枡','鏈','宸茶','鏁板瓧','绾犲垵','淇濆瓨淇敼',
  '鐨勬垜浠殑','鐓х墖淇℃伅寮圭獥','鍙戝竷璇勮','鍐欎笅浣犵殑鎯虫硶',
  '缁熻璇︽儏','璐﹀彿宸茬粡娉ㄥ唽','楠岃瘉鐮佷笉姝ｇ‘','鐢ㄦ埛涓嶅瓨鍦?',
  '鎮ㄧ殑鐢ㄦ埛鍚嶅凡琚垎閰?','鎮ㄧ殑璐﹀彿宸茬粡娉ㄩ攢',
  '鎮ㄧ殑瀵嗙爜瑕佹眰鏈?灏戜负8浣?','娆㈣繋鍥炴潈','鏇存崲澶村儚','鍙栨秷',
];

let totalMatches = 0;
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const content = fs.readFileSync(f, 'utf-8');
  let matches = 0;
  for (const p of garbledStrs) {
    const idx = content.indexOf(p);
    if (idx >= 0) {
      const count = content.split(p).length - 1;
      matches += count;
      // 打印前几个示例
      if (count > 0) {
        const lineStart = content.lastIndexOf('\n', idx);
        const lineEnd = content.indexOf('\n', idx);
        const line = content.substring(lineStart + 1, lineEnd >= 0 ? lineEnd : idx + 60);
        console.log(`  [${f}] "${p}" (x${count}): ${line.trim().slice(0, 80)}`);
      }
    }
  }
  console.log(f + ': 发现 ' + matches + ' 处乱码');
  totalMatches += matches;
}
console.log('\n总计: ' + totalMatches + ' 处乱码');
