// 更可靠的乱码检测与修复
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

// 乱码高频字符黑名单（这些字几乎不会出现在正常的简体中文中）
// 这些是"正确的 UTF-8 中文被错误按 GBK 解码"后产生的典型字符
const GARBLE_BLACKLIST = new Set([
  '鍒','鍙','鐢','甯','栧','瓙','绛','閿','鎷','闂','傛','垹','娅',
  '棰','鎸','鏈','鍔','鐧','娉','纭','鏁','鎶','娑','堟','櫒','鍏','儴','鎵惧埌',
  '鐩稿叧','鎿嶄綔','瑕佹墽琛屾鎿嶄綔鍚楋紵','鍒嗛櫎','缂栬緫',
  '鍔犺浇','涓婁紶','鍙戦€','澶辫触','鎴愬姛','鐓х墖','椤甸潰','鏁版嵁',
  '缃戠粶','瀹夊叏','妯″紡','浠ｇ爜','棰勮','鍒嗕韩','鏄剧ず','鏀寔',
  '娲昏穬','鎶樺彔','闈㈡澘','鎺т欢','瑙﹀彂','杩斿洖','鏆楄壊','涓婚',
  '棰滆壊','澶勭悊','浜掑姩','绉婚櫎','璇█','娴佺▼','淇″彿','璋冩暣',
  '浣撲細','鍓嶇','娓呯悊','娈嬬暀','宸茶禐','宸茶援','娉ㄥ唽','閲嶈瘯',
  '姝ｅ湪','鍘嬬缉','鍙戝竷','淇濆瓨','纭畾','鍒锋柊','璇疯嚦灏戝～鍐欐爣棰樻垨',
  '娴忚璁板綍','鍙戦€佸け璐?','鐢ㄦ埛ID','鐢ㄦ埛璧勬枡','鐓х墖璇︽儏',
  '鐓х墖淇℃伅','鏃嬭浆','鍙戣〃璇勮','鍐欎笅浣犵殑鎯虫硶','缂栬緫甯栧瓙',
  '淇敼甯栧瓙鍐呭','鍙鑼冨洿','鍏紡','绉佸瘑','淇濆瓨淇敼',
  '纭鍒犻櫎','鍒涘缓璐﹀彿','閫€鍑?','妯℃€佹','淇濈暀','鏂伴矞',
  '宸茶','鏈','鍏ㄩ儴甯栧瓙','娌℃湁鎵惧埌鐩稿叧甯栧瓙','纭鎿嶄綔',
  '纭畾瑕佹墽琛屾鎿嶄綔鍚楋紵','纭','娑堟伅','鍏憡','鏈煡閿欒',
  '缃戠粶閿欒','鍔熻兘浼樺寲','Bug淇','鏂板','鏀硅繘','鏇存柊',
  '淇','绛涢€','甯栧瓙','鐢ㄦ埛','鍐呭','鎸夐挳','涓炬姤','缃《',
  '鏂板嚭鐗堟湰','銆愨儴',
]);

// 更全面：检查是否包含任意乱码2-grams或3-grams
const GARBLE_PATTERNS = [
  /鍒嗛櫎|缂栬緫|鍔犺浇|涓婁紶|澶辫触|鎴愬姛|鐓х墖|椤甸潰|鏁版嵁|缃戠粶/,
  /瀹夊叏|妯″紡|浠ｇ爜|棰勮|鍒嗕韩|鏄剧ず|鏀寔|娲昏穬|鎶樺彔|闈㈡澘/,
  /鎺т欢|鏁板窘绔|瑙﹀彂|杩斿洖|鏆楄壊|涓婚|棰滆壊|澶勭悊|浜掍氦|绉婚櫎/,
  /璇█|娴佺▼|淇″彿|寮傛ā|璋冩暣|浣撲細|鍓嶇|娓呯悊|娈嬬暀/,
  /宸茶禐|宸茶援|娉ㄥ唽|閲嶈瘯|姝ｅ湪|鍘嬬缉|鍙戝竷|淇濆瓨|纭畾|鍒锋柊/,
  /鐢ㄦ埛ID|鐢ㄦ埛璧勬枡|鐓х墖璇︽儏|鐓х墖淇℃伅|鏃嬭浆/,
  /鍙戣〃璇勮|鍐欎笅浣犵殑鎯虫硶|缂栬緫甯栧瓙|淇敼甯栧瓙/,
  /鍙鑼冨洿|鍏紡|绉佸瘑|淇濆瓨淇敼|纭鍒犻櫎|鍒涘缓璐﹀彿/,
  /妯℃€佹|淇濈暀|鏂伴矞|宸茶|鏈|鍏ㄩ儴甯栧瓙|娌℃湁鎵惧埌/,
  /纭鎿嶄綔|纭畾瑕佹墽琛屾鎿嶄綔鍚楋紵|纭|娑堟伅|鍏憡/,
  /鏈煡閿欒|缃戠粶閿欒|鍔熻兘浼樺寲|鏂板|鏀硅繘|鏇存柊|淇|绛涢€/,
  /甯栧瓙|鐢ㄦ埛|鍐呭|鎸夐挳|涓炬姤|缃《/,
  /淇℃伅寮圭獥|淇℃伅璇︽儏/,
  /鍒嗕韩涓€鐐规柊椴滀簨/,
  /閿熸枻鎷烽敓鏂ゆ嫹/,
];

/**
 * 判断一段中文连续文本是否是乱码
 */
function looksLikeGarbled(text) {
  if (!text) return false;
  // 统计中文汉字
  let chineseChars = [];
  for (const ch of text) {
    if (/[\u4e00-\u9fa5]/.test(ch)) {
      chineseChars.push(ch);
    }
  }
  if (chineseChars.length < 2) return false;
  
  // 检查匹配的乱码模式
  for (const pattern of GARBLE_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  
  // 检查乱码单字（高频乱码字）
  let garbleCount = 0;
  for (const ch of chineseChars) {
    if (GARBLE_BLACKLIST.has(ch)) garbleCount++;
  }
  if (garbleCount / chineseChars.length >= 0.3) return true;
  
  return false;
}

/**
 * 对一段"疑似乱码的中文"进行 GBK→UTF-8 解码
 */
function tryFixBlock(block) {
  try {
    const bytes = iconv.encode(block, 'gbk');
    const decoded = bytes.toString('utf-8');
    
    // 验证解码后必须是有效中文
    // 1) 不能有大量 \ufffd
    if (decoded.includes('\ufffd\ufffd')) return null;
    // 2) 必须至少有2个连续汉字
    if (!/[\u4e00-\u9fa5]{2,}/.test(decoded)) return null;
    // 3) 不能再包含高频乱码字
    if (looksLikeGarbled(decoded)) return null;
    
    return decoded;
  } catch (e) {
    return null;
  }
}

/**
 * 修复一行文本：提取中文连续块，逐个判断是否是乱码
 */
function fixLine(line) {
  if (!/[\u4e00-\u9fa5]/.test(line)) return line;
  
  // 逐字符扫描，识别中文块
  let result = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (/[\u4e00-\u9fa5]/.test(ch)) {
      // 找到中文块的结尾
      let j = i;
      // 允许中文块中夹杂的少量非中文 (标点符号如锛孿枩)
      while (j < line.length && /[\u4e00-\u9fa5]/.test(line[j])) {
        j++;
      }
      const block = line.substring(i, j);
      
      if (looksLikeGarbled(block)) {
        const fixed = tryFixBlock(block);
        if (fixed) {
          result += fixed;
        } else {
          result += block;
        }
      } else {
        result += block;
      }
      i = j;
    } else {
      result += ch;
      i++;
    }
  }
  return result;
}

// ============== 测试 ==============
console.log('--- 测试解码 ---');
const testLines = [
  '<textarea id="postInp" placeholder="鍒嗕韩涓€鐐规柊椴滀簨..."></textarea>',
  '<label class="post-compose-label" for="postVisibility">鍙鑼冨洿</label>',
  '<!-- 淇暱铚＄瑪 - rotate(25)浣跨瑪灏栨洿鍊炬枩锛岃窡鐫€璺緞鏂瑰悜鐢?-->',
  '<button class="pp-share-btn" title="鍒嗕韩">',
  '<span class="pp-info-modal-title">鐓х墖璇︽儏</span>',
];
for (const line of testLines) {
  const fixed = fixLine(line);
  console.log('原文: ' + line.slice(0, 60));
  console.log('修复: ' + fixed.slice(0, 60));
  console.log();
}
