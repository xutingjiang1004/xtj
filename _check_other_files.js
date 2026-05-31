const iconv = require('iconv-lite');
const fs = require('fs');

// Check if a CJK character is "correct" by testing if its GBK -> UTF-8 round-trip produces valid UTF-8 that decodes back
function isGoodChinese(ch) {
    const cp = ch.charCodeAt(0);
    if (cp < 0x4e00 || cp > 0x9fff) return null;
    try {
        const buf = iconv.encode(ch, 'gbk');
        // Try to decode the buf as UTF-8
        const decoded = iconv.decode(buf, 'utf8');
        // If decoded has replacement chars, the GBK bytes aren't valid UTF-8
        // But this is EXPECTED for many Chinese chars in GBK
        // Instead, check if the character in the file is "reasonable" by checking 
        // if it's a common Chinese character that we'd expect
        return true; // We'll just trust the file for now
    } catch(e) {
        return false;
    }
}

// Actually, a better approach: just check the file for mojibake patterns
// Mojibake characters are CJK characters that DON'T make sense in context
// But detecting this programmatically is hard.
// 
// Instead, let's just verify that the other files have the CORRECT 
// Chinese text by reading a few lines from each

const files = [
    'js/core/auth.js',
    'js/core/chat.js',
    'js/core/env.js',
    'js/core/posts.js',
    'js/core/utils.js',
    'js/core/announcements.js',
    'js/features.js',
    'js/admin/admin.js',
    'js/photo-wall/photo-wall.js',
    'js/photo-wall/preview.js',
    'js/photo-wall/render.js',
    'js/photo-wall/upload.js',
    'js/photo-wall/data.js',
];

for (const f of files) {
    try {
        const text = fs.readFileSync(f, 'utf8');
        const lines = text.split('\n');
        console.log('=== ' + f + ' (' + lines.length + ' lines) ===');
        let shown = 0;
        for (const line of lines) {
            if (/[\u4e00-\u9fff]/.test(line)) {
                const chinese = line.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g);
                if (chinese) {
                    // Show code points to verify
                    const sample = chinese.slice(0, 3).join('');
                    const cps = [...sample].map(c => 'U+' + c.charCodeAt(0).toString(16).toUpperCase());
                    console.log('  ' + chinese.join(' | ') + ' || ' + cps.join(' '));
                    shown++;
                    if (shown >= 4) break;
                }
            }
        }
        if (shown === 0) console.log('  (no Chinese text found)');
    } catch(e) {
        console.log('=== ' + f + ' === ERROR: ' + e.message);
    }
}
