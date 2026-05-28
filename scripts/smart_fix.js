const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');

const corePath = path.join(__dirname, '..', 'js', 'core.js');

let content = fs.readFileSync(corePath, 'utf8');
let fixCount = 0;
let failCount = 0;

function reverseEncoding(garbled) {
    try {
        const gbkBytes = iconv.encode(garbled, 'gbk');
        const fixed = gbkBytes.toString('utf8');
        if (fixed !== garbled && /[\u4e00-\u9fa5]/.test(fixed)) {
            return fixed;
        }
    } catch (e) {
        // ignore
    }
    return null;
}

// Find sequences of CJK + PUA characters (2-50 chars)
const result = content.replace(/[\u4e00-\u9fff\ue000-\uf8ff]{2,50}/g, (match) => {
    const fixed = reverseEncoding(match);
    if (fixed && fixed !== match) {
        fixCount++;
        process.stdout.write('.');
        return fixed;
    } else {
        failCount++;
        return match;
    }
});

console.log('\n');
console.log('Fixed: ' + fixCount + ', Failed: ' + failCount);

fs.writeFileSync(corePath, result, 'utf8');

// Verify
const verify = fs.readFileSync(corePath, 'utf8');
const cnCount = (verify.match(/[\u4e00-\u9fa5]/g) || []).length;
console.log('Chinese chars after fix: ' + cnCount);