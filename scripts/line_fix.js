const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');

const corePath = path.join(__dirname, '..', 'js', 'core.js');
let content = fs.readFileSync(corePath, 'utf8');

const lines = content.split('\n');
let fixed = 0;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check if line has garbled CJK characters
    const hasGarbled = /[\u5000-\u9fff]{2,}/.test(line) && !/[\u4e00-\u4e2f]{1,}/.test(line);
    // Actually, simpler: count CJK chars and check if any look garbled
    const cjkMatches = line.match(/[\u4e00-\u9fff\ue000-\uf8ff]{2,50}/g);
    if (cjkMatches) {
        for (const match of cjkMatches) {
            try {
                const gbkBytes = iconv.encode(match, 'gbk');
                const fixed_text = gbkBytes.toString('utf8');
                if (fixed_text !== match && /[\u4e00-\u9fa5]/.test(fixed_text)) {
                    lines[i] = lines[i].replace(match, fixed_text);
                    fixed++;
                }
            } catch(e) {}
        }
    }
}

if (fixed > 0) {
    fs.writeFileSync(corePath, lines.join('\n'), 'utf8');
    console.log('Fixed ' + fixed + ' more lines');
} else {
    console.log('Nothing more to fix');
}