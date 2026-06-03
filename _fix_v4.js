// 最终乱码修复：广泛的乱码模式检测 + GBK→UTF-8 解码
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

// 扩大的乱码模式：这些字符串几乎不可能出现在正常中文中
const GARBLE_PATTERNS = [
  /鍒嗛櫎|缂栬緫|鍔犺浇|涓婁紶|澶辫触|鎴愬姛|鐓х墖|椤甸潰|鏁版嵁|缃戠粶/,
  /瀹夊叏|妯″紡|浠ｇ爜|棰勮|鍒嗕韩|鏄剧ず|鏀寔|娲昏穬|鎶樺彔|闈㈡澘/,
  /鎺т欢|鏁板窘绔|瑙﹀彂|杩斿洖|鏆楄壊|涓婚|棰滆壊|澶勭悊|浜掍氦|绉婚櫎|璇█/,
  /娴佺▼|淇″彿|璋冩暣|浣撲細|鍓嶇|娓呯悊|娈嬬暀|宸茶禐|宸茶援|娉ㄥ唽|閲嶈瘯|姝ｅ湪/,
  /鍘嬬缉|鍙戝竷|淇濆瓨|纭畾|鍒锋柊|鐢ㄦ埛ID|鐢ㄦ埛璧勬枡|鐓х墖璇︽儏|鐓х墖淇℃伅|鏃嬭浆/,
  /鍙戣〃璇勮|鍐欎笅浣犵殑鎯虫硶|缂栬緫甯栧瓙|淇敼甯栧瓙鍐呭|鍙鑼冨洿|绉佸瘑|鍏紡|纭鍒犻櫎|鍒涘缓璐﹀彿/,
  /妯℃€佹|鏂伴矞|宸茶|鏈|鍏ㄩ儴甯栧瓙|娌℃湁鎵惧埌鐩稿叧甯栧瓙|纭鎿嶄綔|纭畾瑕佹墽琛屾鎿嶄綔鍚楋紵/,
  /娑堟伅|鍏憡|鏈煡閿欒|缃戠粶閿欒|鍔熻兘浼樺寲|鏂板|鏀硅繘|鏇存柊|淇|绛涢€/,
  /甯栧瓙|鐢ㄦ埛|鍐呭|鎸夐挳|涓炬姤|缃《|鍒嗕韩涓€鐐规柊椴滀簨|璇疯嚦灏戝～鍐欐爣棰樻垨/,
  /娴忚璁板綍|鍙戦€佸け璐?|閿熸枻鎷烽敓鏂ゆ嫹|鐪嬬湅鎮ㄧ殑|鎴戠殑|鏄电О|瀵嗙爜|鏂板嚭鐗堟湰|淇濈暀/,
  /鏇存柊鏃ュ織|涓汉璧勬枡|鏈|宸茶|鏁板瓧|绾犲垵|淇濆瓨淇敼|鐨勬垜浠殑/,
  /鐓х墖淇℃伅寮圭獥|鍙戝竷璇勮|鍐欎笅浣犵殑鎯虫硶|鍙戝竷璇勮|缂栬緫甯栧瓙/,
  /妯℃€佹.*淇濈暀|缁熻璇︽儏|帖子璁℃暟|璐﹀彿宸茬粡娉ㄥ唽|楠岃瘉鐮佷笉姝ｇ‘|鐢ㄦ埛涓嶅瓨鍦?|鎮ㄧ殑鐢ㄦ埛鍚嶅凡琚垎閰?/,
  /鎮ㄧ殑璐﹀彿宸茬粡娉ㄩ攢|鎮ㄧ殑瀵嗙爜瑕佹眰鏈?灏戜负8浣?/,
  /闃熷垪|鏈嶅姟|涓诲姩|娈嬬Щ|鍒涘缓|鐨勬柊|鍩虹|鏁版嵁搴擄紵|鑷姩|鎷垮埌|涓嬫媺|鏇存柊|鍙栨秷/,
  /鐧诲綍鎴愬姛|娉ㄥ唽鎴愬姛|鍙戦€佸け璐?|璐﹀彿宸茬粡娉ㄥ唽|鎮ㄧ殑鐢ㄦ埛鍚嶅凡琚垎閰?|楠岃瘉鐮佷笉姝ｇ‘/,
  /浣犵殑璐﹀彿宸茬粡娉ㄩ攢|娌℃湁鎵惧埌鐩稿叧甯栧瓙|纭鎿嶄綔|纭畾瑕佹墽琛屾鎿嶄綔鍚楋紵/,
  /宸茶|鏈|鑷冲皯鍐欐爣棰樻垨|鍒犻櫎鐨勬垜浠殑甯栧瓙|鐓х墖淇℃伅寮圭獥/,
  /鍒嗛櫎|缂栬緫|鍔犺浇涓?..|鍙戝竷璇勮|鍐欎笅浣犵殑鎯虫硶..|鍙栨秷|纭鍒犻櫎/,
  /鐓х墖璇︽儏|鐓х墖淇℃伅|鍒涘缓璐﹀彿|閫€鍑?|妯℃€佹|淇濈暀|鏂伴矞/,
  /鍏ㄩ儴甯栧瓙|娌℃湁鎵惧埌鐩稿叧甯栧瓙|纭鎿嶄綔|纭畾瑕佹墽琛屾鎿嶄綔鍚楋紵/,
  /娑堟伅|鍏憡|鏈煡閿欒|缃戠粶閿欒|鍔熻兘浼樺寲|Bug淇|鏂板|鏀硅繘|鏇存柊|淇|绛涢€|甯栧瓙|鐢ㄦ埛|鍐呭|鎸夐挳|涓炬姤|缃《/,
  /娆㈣繋鍥炴潈|鏇存崲澶村儚|鎴戠殑|鏄电О|瀵嗙爜|鏂板嚭鐗堟湰|淇濈暀|鏇存柊鏃ュ織|涓汉璧勬枡/,
  /淇濆瓨淇敼|鍙戝竷|鍐欎笅浣犵殑鎯虫硶|淇敼甯栧瓙鍐呭|鍙鑼冨洿|绉佸瘑|鍏紡/,
  /妯℃€佹.*淇濈暀|缁熻璇︽儏|璐﹀彿宸茬粡娉ㄥ唽|楠岃瘉鐮佷笉姝ｇ‘/,
];

function isGarbled(text) {
  for (const p of GARBLE_PATTERNS) {
    if (p.test(text)) return true;
  }
  return false;
}

function tryDecode(text) {
  try {
    const bytes = iconv.encode(text, 'gbk');
    const decoded = bytes.toString('utf-8');
    if (decoded.includes('\ufffd\ufffd')) return null;
    if (!/[\u4e00-\u9fa5]/.test(decoded)) return null;
    if (isGarbled(decoded)) return null;
    return decoded;
  } catch (e) {
    return null;
  }
}

function fixContent(content) {
  let result = '';
  let i = 0;
  let changed = false;

  while (i < content.length) {
    const ch = content[i];
    if (ch.charCodeAt(0) > 127) {
      let j = i;
      let asciiCount = 0;
      while (j < content.length) {
        const cj = content[j];
        if (cj.charCodeAt(0) > 127) {
          j++;
          asciiCount = 0;
        } else if (/[0-9a-zA-Z\s]/.test(cj) && j > i) {
          if (asciiCount < 5) {
            j++;
            asciiCount++;
          } else break;
        } else {
          break;
        }
      }
      const block = content.substring(i, j);

      if (isGarbled(block)) {
        const decoded = tryDecode(block);
        if (decoded && decoded !== block) {
          result += decoded;
          changed = true;
          i = j;
          continue;
        }
      }
      result += block;
      i = j;
    } else {
      result += ch;
      i++;
    }
  }
  return { content: result, changed };
}

// ========== 修复文件 ==========
const filesToFix = [
  'index.html',
  'js/core.js',
  'js/core.min.js',
];

console.log('--- 修复文件 ---');
for (const f of filesToFix) {
  const absPath = path.join(__dirname, f);
  if (!fs.existsSync(absPath)) continue;
  let content = fs.readFileSync(absPath, 'utf-8');
  let anyChange = false;
  for (let round = 1; round <= 3; round++) {
    const { content: fixed, changed } = fixContent(content);
    if (!changed) break;
    content = fixed;
    anyChange = true;
  }
  if (anyChange) {
    fs.writeFileSync(absPath, content, 'utf-8');
    console.log(`  ✓ ${f} 已修复`);
  } else {
    console.log(`  - ${f} 无需修复`);
  }
}
