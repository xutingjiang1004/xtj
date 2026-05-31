const iconv = require('iconv-lite');
const fs = require('fs');

const filePath = 'js/core.js';

// Restore from backup first
fs.copyFileSync(filePath + '.bak', filePath);
console.log('Restored from backup');

// Read the file
const text = fs.readFileSync(filePath, 'utf8');
console.log('File chars:', text.length);

// Convert: encode mojibake as GBK -> decode as UTF-8 -> correct Chinese
const gbkBuf = iconv.encode(text, 'gbk');
console.log('GBK buffer bytes:', gbkBuf.length);

const fixedText = iconv.decode(gbkBuf, 'utf8');
console.log('Fixed text chars:', fixedText.length);

// Write back
fs.writeFileSync(filePath, fixedText, 'utf8');

// Verify by checking L16 characters
const verifyText = fs.readFileSync(filePath, 'utf8');
const lines = verifyText.split('\n');
const l16 = lines[15];
console.log('\nL16 content:');
console.log(l16);

console.log('\nL16 non-ASCII chars:');
for (const ch of l16) {
    const cp = ch.charCodeAt(0);
    if (cp > 127) {
        console.log('  U+' + cp.toString(16).toUpperCase() + ' (' + ch + ')');
    }
}

// Count all Chinese chars
let chineseCount = 0;
for (const ch of fixedText) {
    if (ch >= '\u4e00' && ch <= '\u9fff') {
        chineseCount++;
    }
}
console.log('\nTotal CJK chars:', chineseCount);
