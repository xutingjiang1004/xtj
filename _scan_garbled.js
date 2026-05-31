const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'js', 'core.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

// Define Unicode ranges for normal CJK and ASCII
function isSuspicious(char) {
    const code = char.charCodeAt(0);
    // ASCII range (printable)
    if (code >= 0x20 && code <= 0x7E) return false;
    // CJK Unified Ideographs
    if (code >= 0x4E00 && code <= 0x9FFF) return false;
    // CJK Compatibility Ideographs
    if (code >= 0xF900 && code <= 0xFAFF) return false;
    // CJK Unified Ideographs Extension A
    if (code >= 0x3400 && code <= 0x4DBF) return false;
    // Fullwidth forms
    if (code >= 0xFF00 && code <= 0xFFEF) return false;
    // Common CJK punctuation
    if (code >= 0x3000 && code <= 0x303F) return false;
    // Halfwidth and fullwidth forms (FF00-FFEF already covered)
    // General punctuation (some)
    if (code >= 0x2000 && code <= 0x206F) return false;
    // Arrows
    if (code >= 0x2190 && code <= 0x21FF) return false;
    // Box Drawing
    if (code >= 0x2500 && code <= 0x257F) return false;
    // Block Elements
    if (code >= 0x2580 && code <= 0x259F) return false;
    // Geometric Shapes
    if (code >= 0x25A0 && code <= 0x25FF) return false;
    // Dingbats
    if (code >= 0x2700 && code <= 0x27BF) return false;
    // Supplemental Arrows-A
    if (code >= 0x27F0 && code <= 0x27FF) return false;
    // Supplemental Arrows-B
    if (code >= 0x2900 && code <= 0x297F) return false;
    // C0 Controls (tab, newline, carriage return)
    if (code === 0x09 || code === 0x0A || code === 0x0D) return false;
    // Various useful symbols
    if (code >= 0x2300 && code <= 0x23FF) return false; // Miscellaneous Technical
    if (code === 0xFE0F) return false; // Variation Selector-16 (emojo)
    // Spacing Modifier Letters (for IPA)
    if (code >= 0x02B0 && code <= 0x02FF) return false;
    // Phonetic Extensions
    if (code >= 0x1D00 && code <= 0x1D7F) return false;
    // Private Use Area - allow but flag
    if (code >= 0xE000 && code <= 0xF8FF) return true;
    // All other ranges are suspicious (likely garbled)
    return true;
}

console.log('=== Lines with suspicious (likely garbled) characters ===\n');
let totalSuspiciousLines = 0;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const suspiciousChars = [];
    for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (isSuspicious(char)) {
            const code = char.charCodeAt(0);
            const hex = 'U+' + code.toString(16).toUpperCase().padStart(4, '0');
            suspiciousChars.push({ char, code, hex, pos: j });
        }
    }
    if (suspiciousChars.length > 0) {
        totalSuspiciousLines++;
        const lineNum = i + 1;
        const charsInfo = suspiciousChars.map(c => `${c.char}(U+${c.code.toString(16).toUpperCase().padStart(4, '0')})`).join(' ');
        console.log(`Line ${lineNum} (${suspiciousChars.length} suspicious chars):`);
        
        // Print the line with context (showing a window around suspicious areas)
        let displayLine = line;
        // Truncate if too long
        if (displayLine.length > 200) {
            // Find first and last suspicious position
            const firstPos = suspiciousChars[0].pos;
            const lastPos = suspiciousChars[suspiciousChars.length - 1].pos;
            const start = Math.max(0, firstPos - 20);
            const end = Math.min(displayLine.length, lastPos + 30);
            displayLine = (start > 0 ? '...' : '') + displayLine.substring(start, end) + (end < line.length ? '...' : '');
        }
        console.log(`  ${displayLine}`);
        console.log(`  Characters: ${charsInfo}`);
        console.log('');
    }
}

console.log(`Total lines with suspicious characters: ${totalSuspiciousLines}`);
