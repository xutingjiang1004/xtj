const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');

const corePath = path.join(__dirname, '..', 'js', 'core.js');
let content = fs.readFileSync(corePath, 'utf8');

let fixed = 0;

// Match CJK sequences
const result = content.replace(/[\u4e00-\u9fff\ue000-\uf8ff\u3000-\u303f\uff00-\uffef]{2,60}/g, (match) => {
    try {
        const gbkBytes = iconv.encode(match, 'gbk');
        const fixed_text = gbkBytes.toString('utf8');
        // Only replace if the conversion changed the text AND produces valid Chinese
        if (fixed_text !== match && /[\u4e00-\u9fa5]/.test(fixed_text)) {
            fixed++;
            return fixed_text;
        }
    } catch(e) {}
    return match;
});

console.log('Fixed: ' + fixed);

fs.writeFileSync(corePath, result, 'utf8');

const verify = fs.readFileSync(corePath, 'utf8');
const cnCount = (verify.match(/[\u4e00-\u9fa5]/g) || []).length;
console.log('Chinese chars: ' + cnCount);

// Run again until convergence
let passes = 0;
let lastFixed = fixed;
while (passes < 3) {
    passes++;
    let newContent = verify.replace(/[\u4e00-\u9fff\ue000-\uf8ff\u3000-\u303f\uff00-\uffef]{2,60}/g, (match) => {
        try {
            const gbkBytes = iconv.encode(match, 'gbk');
            const fixed_text = gbkBytes.toString('utf8');
            if (fixed_text !== match && /[\u4e00-\u9fa5]/.test(fixed_text)) {
                fixed++;
                return fixed_text;
            }
        } catch(e) {}
        return match;
    });
    fs.writeFileSync(corePath, newContent, 'utf8');
    console.log('Pass ' + passes + ' fixed: ' + (fixed - lastFixed) + ' more');
    lastFixed = fixed;
}

console.log('Total fixed: ' + fixed);