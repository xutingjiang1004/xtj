const fs = require('fs');
const iconv = require('iconv-lite');

const corePath = 'js/core.js';
let content = fs.readFileSync(corePath, 'utf8');

function fixText(text) {
    if (!text) return text;
    try {
        const gbk = iconv.encode(text, 'gbk');
        const fixed = gbk.toString('utf8');
        if (fixed !== text && /[\u4e00-\u9fa5]/.test(fixed)) return fixed;
    } catch(e) {}
    try {
        const buf = Buffer.from(text, 'binary');
        const fixed = iconv.decode(buf, 'binary');
        if (fixed !== text && /[\u4e00-\u9fa5]/.test(fixed)) return fixed;
    } catch(e) {}
    return text;
}

let count = 0;
content = content.replace(/(showToast\()"([^"]*)"/g, (full, prefix, msg) => {
    const fixed = fixText(msg);
    if (fixed !== msg) { count++; return prefix + '"' + fixed + '"'; }
    return full;
});

content = content.replace(/\.textContent\s*=\s*"([^"]*)"/g, (full, msg) => {
    const fixed = fixText(msg);
    if (fixed !== msg) { count++; return '.textContent = "' + fixed + '"'; }
    return full;
});

console.log('Fixed ' + count + ' strings');
fs.writeFileSync(corePath, content, 'utf8');