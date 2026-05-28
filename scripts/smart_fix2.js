const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');

const corePath = path.join(__dirname, '..', 'js', 'core.js');
let content = fs.readFileSync(corePath, 'utf8');

let pass2Count = 0;

function tryFix(garbled) {
    try {
        const gbkBytes = iconv.encode(garbled, 'gbk');
        const fixed = gbkBytes.toString('utf8');
        if (fixed !== garbled && /[\u4e00-\u9fa5]/.test(fixed)) return fixed;
    } catch (e) {}
    return null;
}

// Second pass: find any remaining CJK sequences (2-50 chars)
const result = content.replace(/[\u4e00-\u9fff\ue000-\uf8ff]{2,50}/g, (match) => {
    const fixed = tryFix(match);
    if (fixed && fixed !== match) {
        pass2Count++;
        return fixed;
    }
    return match;
});

console.log('Pass 2 fixed: ' + pass2Count + ' more entries');

fs.writeFileSync(corePath, result, 'utf8');

// Count remaining garbled
const verify = fs.readFileSync(corePath, 'utf8');
const remaining = verify.match(/[\u4e00-\u9fff\ue000-\uf8ff]{2,50}/g) || [];
// Filter to find still-garbled ones
let stillCount = 0;
const stillSet = new Set();
for (const m of remaining) {
    const f = tryFix(m);
    if (!f || f === m) {
        stillCount++;
        if (stillCount <= 30) stillSet.add(m);
    }
}
console.log('Still garbled: ' + stillCount);
console.log('Sample remaining:');
for (const s of [...stillSet].slice(0, 20)) {
    console.log('  ' + s);
}