// 更彻底：对每个"连续非ASCII块"都尝试 GBK→UTF-8 解码
// 如果解码后是有效中文且比原文更合理（含更多合法常用字），则替换
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

/**
 * 对一段文本尝试解码：先按GBK编码为字节，再按UTF-8解释
 */
function tryDecode(text) {
  try {
    const bytes = iconv.encode(text, 'gbk');
    const decoded = bytes.toString('utf-8');
    
    // 验证：不能有连续多个 \ufffd
    if (decoded.includes('\ufffd\ufffd')) return null;
    // 必须包含至少1个汉字
    if (!/[\u4e00-\u9fa5]/.test(decoded)) return null;
    
    // 统计：解码后非控制字符的 "乱码特征字" 占比必须低于阈值
    // 乱码特征字 = GBK 高位区常见的生僻字/部首字
    const garbleChars = new Set(['鍒','鍙','鐢','甯','栧','瓙','绛','閿','鎷','闂','傛','垹','娅','棰','鎸','鏈','鍔','鐧','娉','纭','鏁','鎶','娑','堟','櫒','鍏','鎵','惧','埌','鐩','稿','叧','鐨','鎿','嶄','綔','瑕','佹','墽','琛屾','槸','涔嬶','鍜','灏','伓','璐','腑','搴','涓','€','鐪','嬭','浆','€','鍒?','绉','佸','瘑','鍐欎笅','鏃','曞ぇ','姘旀场','宸︿笂','浣犵殑','鎯虫硶','娆㈣繋','鍥炴潈','鏄电О','瀵嗙爜','鏂板嚭鐗堟湰','淇濈暀','璇︽儏','璐﹀彿','鏇存崲澶村儚','涓汉璧勬枡','鏃ュ織','缁熻','鎴戠殑','瀵艰叮']);
    let chineseCount = 0;
    let garbleCount = 0;
    for (const ch of decoded) {
      if (/[\u4e00-\u9fa5]/.test(ch)) {
        chineseCount++;
        if (garbleChars.has(ch)) garbleCount++;
      }
    }
    // 如果解码后汉字中，乱码特征字占比高于40%，说明是无效解码
    if (chineseCount > 0 && garbleCount / chineseCount > 0.4) return null;
    
    return decoded;
  } catch (e) {
    return null;
  }
}

/**
 * 判断一段文本块"原始是否就是乱码"
 * 依据：是否包含高频乱码特征字/特征串
 */
function isGarbled(text) {
  const garblePatterns = [
    /鍒嗛櫎|缂栬緫|鍔犺浇|涓婁紶|澶辫触|鎴愬姛|鐓х墖|椤甸潰|鏁版嵁|缃戠粶/,
    /瀹夊叏|妯″紡|浠ｇ爜|棰勮|鍒嗕韩|鏄剧ず|鏀寔|娲昏穬|鎶樺彔|闈㈡澘/,
    /鎺т欢|瑙﹀彂|杩斿洖|鏆楄壊|涓婚|棰滆壊|澶勭悊|浜掍氦|绉婚櫎|璇█/,
    /娴佺▼|淇″彿|璋冩暣|浣撲細|鍓嶇|娓呯悊|娈嬬暀/,
    /宸茶禐|宸茶援|娉ㄥ唽|閲嶈瘯|姝ｅ湪|鍘嬬缉|鍙戝竷|淇濆瓨|纭畾|鍒锋柊/,
    /鐢ㄦ埛ID|鐢ㄦ埛璧勬枡|鐓х墖璇︽儏|鐓х墖淇℃伅|鏃嬭浆|鍙戣〃璇勮/,
    /鍐欎笅浣犵殑鎯虫硶|缂栬緫甯栧瓙|淇敼甯栧瓙鍐呭|鍙鑼冨洿|绉佸瘑|鍏紡/,
    /纭鍒犻櫎|鍒涘缓璐﹀彿|閫€鍑?|妯℃€佹|鏂伴矞|宸茶|鏈|鍏ㄩ儴甯栧瓙|娌℃湁鎵惧埌鐩稿叧甯栧瓙/,
    /纭鎿嶄綔|纭畾瑕佹墽琛屾鎿嶄綔鍚楋紵|纭|娑堟伅|鍏憡|鏈煡閿欒|缃戠粶閿欒/,
    /鍔熻兘浼樺寲|Bug淇|鏂板|鏀硅繘|鏇存柊|淇|绛涢€|甯栧瓙|鐢ㄦ埛|鍐呭|鎸夐挳|涓炬姤|缃《/,
    /鍒嗕韩涓€鐐规柊椴滀簨|璇疯嚦灏戝～鍐欐爣棰樻垨|娴忚璁板綍|鍙戦€佸け璐/,
    /閿熸枻鎷烽敓鏂ゆ嫹|鐪嬬湅鎮ㄧ殑/,
    /鎴戠殑|鏄电О|瀵嗙爜|鏂板嚭鐗堟湰|淇濈暀|鏇存柊鏃ュ織|涓汉璧勬枡|鏈|宸茶|鏁板瓧|绾犲垵|淇濆瓨淇敼|鐨勬垜浠殑/,
    /鐓х墖淇℃伅寮圭獥|鍙戝竷璇勮|鍐欎笅浣犵殑鎯虫硶|鍙戝竷璇勮|缂栬緫甯栧瓙/,
    /妯℃€佹.*淇濈暀|缁熻璇︽儏|帖子璁℃暟|璐﹀彿宸茬粡娉ㄥ唽|楠岃瘉鐮佷笉姝ｇ‘|鐢ㄦ埛涓嶅瓨鍦?|鎮ㄧ殑鐢ㄦ埛鍚嶅凡琚垎閰?/,
    /鎮ㄧ殑璐﹀彿宸茬粡娉ㄩ攢|鎮ㄧ殑瀵嗙爜瑕佹眰鏈?灏戜负8浣?/
  ];
  for (const p of garblePatterns) {
    if (p.test(text)) return true;
  }
  return false;
}

function fixContent(content) {
  let result = '';
  let i = 0;
  let changed = false;
  
  while (i < content.length) {
    const ch = content[i];
    const code = ch.charCodeAt(0);
    
    if (code > 127) {
      // 非ASCII：收集连续的非ASCII块（允许中间夹杂少量数字/空格）
      let j = i;
      let asciiCount = 0;
      while (j < content.length) {
        const cj = content[j];
        if (cj.charCodeAt(0) > 127) {
          j++;
          asciiCount = 0;
        } else if (/[0-9a-zA-Z\s]/.test(cj) && j > i) {
          // 允许中间少量 ASCII（最多5个字符）
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
        if (decoded && decoded !== block && !isGarbled(decoded)) {
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

// ========== 测试 ==========
console.log('--- 测试解码 ---');
const testCases = [
  '<textarea placeholder="鍒嗕韩涓€鐐规柊椴滀簨..."></textarea>',
  '<label>鍙鑼冨洿</label>',
  '<option value="private">绉佸瘑</option>',
  '<span class="pp-info-modal-title">鐓х墖璇︽儏</span>',
  '<p class="af-title">娆㈣繋鍥炴潈</p>',
  '<input placeholder="鏄电О" />',
  '<input placeholder="瀵嗙爜" />',
  '<span class="dt-label">鎴戠殑</span>',
  '<!-- 鐓х墖淇℃伅寮圭獥 -->',
  '<button>鍙栨秷</button>',
  '<button>纭鍒犻櫎</button>',
  '<textarea placeholder="鍐欎笅浣犵殑鎯虫硶..."></textarea>',
  '<span>鏇存崲澶村儚</span>',
  '<h3>涓汉璧勬枡</h3>',
  '<h3 id="statModalTitle">缁熻璇︽儏</h3>',
  '<!-- 淇敼甯栧瓙鍐呭 -->',
  '<button>鍙戝竷</button>',
  '<span>鏇存柊鏃ュ織</span>',
  '<button>淇濆瓨淇敼</button>',
  '正常中文：我的帖子发布按钮 - 不应该被修改',
  'loading - 纯英文保留',
];
let ok = 0;
for (const t of testCases) {
  const { content: fixed, changed } = fixContent(t);
  const isOk = !(/[\u4e00-\u9fa5]/.test(t) && changed && /[鍒鍙鐢甯栧瓙绛閿鎷闂]/.test(fixed));
  if (isOk) ok++;
  console.log((changed ? '[FIXED] ' : '[OK]    ') + t.slice(0, 70));
  console.log('         => ' + fixed.trim().slice(0, 70));
  console.log();
}
console.log(`测试: ${ok}/${testCases.length}`);

// ========== 修复文件 ==========
const filesToFix = [
  'index.html',
  'js/core.js',
  'js/core.min.js',
];
console.log('\n--- 修复文件 ---');
for (const f of filesToFix) {
  const absPath = path.join(__dirname, f);
  if (!fs.existsSync(absPath)) continue;
  let totalChanged = 0;
  let content = fs.readFileSync(absPath, 'utf-8');
  // 最多3轮迭代，确保彻底修复
  for (let round = 1; round <= 3; round++) {
    const { content: fixed, changed } = fixContent(content);
    if (!changed) break;
    content = fixed;
    totalChanged++;
  }
  if (totalChanged > 0) {
    fs.writeFileSync(absPath, content, 'utf-8');
    console.log(`  ✓ 已修复 ${f} (${totalChanged}轮)`);
  } else {
    console.log(`  - 无需修复 ${f}`);
  }
}
