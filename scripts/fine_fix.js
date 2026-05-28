const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');

const corePath = path.join(__dirname, '..', 'js', 'core.js');
let content = fs.readFileSync(corePath, 'utf8');

let fixCount = 0;

function tryFixSingle(char) {
    try {
        const gbkBytes = iconv.encode(char, 'gbk');
        const fixed = gbkBytes.toString('utf8');
        if (fixed.length === 1 && fixed !== char && /[\u4e00-\u9fa5]/.test(fixed)) {
            return fixed;
        }
    } catch (e) {}
    return null;
}

function tryFixPair(pair) {
    try {
        const gbkBytes = iconv.encode(pair, 'gbk');
        const fixed = gbkBytes.toString('utf8');
        if (fixed !== pair && /[\u4e00-\u9fa5]/.test(fixed) && fixed.length > 0) {
            return fixed;
        }
    } catch (e) {}
    return null;
}

// Try fixing individual CJK-range characters
const result1 = content.replace(/[\u4e00-\u9fff]/g, (char) => {
    const fixed = tryFixSingle(char);
    if (fixed && fixed !== char) {
        fixCount++;
        return fixed;
    }
    return char;
});

// Also try fixing pairs of CJK-range chars
let result2 = result1.replace(/[\u4e00-\u9fff]{2}/g, (pair) => {
    const fixed = tryFixPair(pair);
    if (fixed && fixed !== pair) {
        fixCount++;
        return fixed;
    }
    return pair;
});

// Try fixing mixed sequences (CJK + PUA + other)
result2 = result2.replace(/[\u4e00-\u9fff\ue000-\uf8ff\u3000-\u303f\uff00-\uffef]{2,50}/g, (seq) => {
    try {
        const gbkBytes = iconv.encode(seq, 'gbk');
        const fixed = gbkBytes.toString('utf8');
        if (fixed !== seq && /[\u4e00-\u9fa5]/.test(fixed)) {
            fixCount++;
            return fixed;
        }
    } catch (e) {}
    return seq;
});

console.log('Fine fix count: ' + fixCount);

fs.writeFileSync(corePath, result2, 'utf8');

// Count remaining non-Chinese CJK chars
const verify = fs.readFileSync(corePath, 'utf8');
const cnCount = (verify.match(/[\u4e00-\u9fa5]/g) || []).length;
console.log('Chinese chars: ' + cnCount);