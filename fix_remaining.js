const fs = require('fs');
const path = 'c:\\Users\\Administrator\\Desktop\\最新index\\xtj\\index.html';
let content = fs.readFileSync(path, 'utf-8');

// 1. Remove remaining vocab JS variables and functions
// Remove from "let vocabMode = 'en2zh';" to the end of the vocab functions
const vocabVarStart = content.indexOf("let vocabMode = 'en2zh';");
// Find the end of the surrounding section - this is inside a large IIFE
// Let's find where the vocab quiz code ends - search for the next major section
const afterVocabCode = content.indexOf("// --- TTS", vocabVarStart);
const actualEnd = content.indexOf("function initVocabQuiz", vocabVarStart);

if (vocabVarStart >= 0) {
    // Find the section boundary - look for the SVG Animation comment or the translation section
    const svgAnimMarker = "<!-- SVG Animation Path Length Calculator -->";
    const svgIdx = content.indexOf(svgAnimMarker);
    
    // Also find the end of the vocab IIFE - look for the closing of the containing block
    // The vocab code is inside: (function() { ... })();
    // We need to find where the IIFE for vocab ends
    
    // Find the enclosing anonymous function
    const iifeStart = content.lastIndexOf("(function() {", vocabVarStart);
    if (iifeStart >= 0) {
        // The IIFE ends with "})();" - find the next one after our code
        let searchPos = vocabVarStart;
        let iifeEnd = -1;
        while (searchPos < content.length) {
            const nextEnd = content.indexOf("})();", searchPos);
            if (nextEnd < 0) break;
            // Check if this ends our vocab section
            const middle = content.substring(vocabVarStart, nextEnd);
            if (middle.includes("function initVocabQuiz")) {
                iifeEnd = nextEnd + 5; // include "})();"
                break;
            }
            searchPos = nextEnd + 5;
        }
        
        if (iifeEnd > vocabVarStart) {
            // Remove everything from vocabVarStart to iifeEnd
            const before = content.substring(0, vocabVarStart);
            const after = content.substring(iifeEnd);
            content = before + after;
            console.log('1. Removed vocab JS variables and functions');
        } else {
            console.log('1. ERROR: Could not find IIFE end for vocab code');
        }
    } else {
        console.log('1. ERROR: Could not find IIFE start');
    }
} else {
    console.log('1. Already cleaned or not found');
}

// 2. Update the scroll handler in switchDockTab for 'ai' tab
const oldScrollHandler = "const vocabPage = document.querySelector('.vocab-container');\n                        if (vocabPage) vocabPage.scrollTo({ top: 0, behavior: 'smooth' });";
const newScrollHandler = "const photoWallPage = document.getElementById('photoWallContainer');\n                        if (photoWallPage) photoWallPage.scrollTo({ top: 0, behavior: 'smooth' });";

if (content.indexOf(oldScrollHandler) >= 0) {
    content = content.split(oldScrollHandler).join(newScrollHandler);
    console.log('2. Updated scroll handler for photo wall');
} else {
    console.log('2. Scroll handler not found or already updated');
}

// 3. Remove English and Korean language tabs from HTML
// Find the profile setting item for language
const profileLangItem = content.indexOf('profile-setting-item');
let foundLangItem = -1;
for (let i = 0; i < 10; i++) {
    const idx = content.indexOf('<div class="profile-setting-item"', profileLangItem + i * 10);
    if (idx >= 0) {
        const snippet = content.substring(idx, idx + 300);
        if (snippet.includes('profile-lang-tabs') || snippet.includes('语言') || snippet.includes('data-lang="zh"')) {
            foundLangItem = idx;
            break;
        }
    }
}

if (foundLangItem >= 0) {
    // Find the boundaries of this setting item
    const itemEnd = content.indexOf('</div>', content.indexOf('profileLang', foundLangItem) + 20);
    if (itemEnd > foundLangItem) {
        const fullItem = content.substring(foundLangItem, itemEnd + 6);
        
        // Remove en and ko buttons from lang tabs
        let modified = fullItem.replace(/<button class="profile-lang-tab" data-lang="en"[^>]*>.*?<\/button>\s*/g, '');
        modified = modified.replace(/<button class="profile-lang-tab" data-lang="ko"[^>]*>.*?<\/button>\s*/g, '');
        modified = modified.replace(/<option value="en">.*?<\/option>\s*/g, '');
        modified = modified.replace(/<option value="ko">.*?<\/option>\s*/g, '');
        
        // Make sure zh tab is active
        modified = modified.replace(/<button class="profile-lang-tab" data-lang="zh"/g, '<button class="profile-lang-tab active" data-lang="zh"');
        
        content = content.substring(0, foundLangItem) + modified + content.substring(itemEnd + 6);
        console.log('3. Removed English and Korean language tabs');
    } else {
        console.log('3. ERROR: Could not find language setting item end');
    }
} else {
    console.log('3. ERROR: Could not find language setting item');
}

// 4. Remove the translations object for en and ko (if still present)
const transObj = content.indexOf('const translations = {');
if (transObj >= 0) {
    // Find the en: { ... }, section
    const enSection = content.indexOf("'en': {", transObj);
    if (enSection < 0) {
        // Try without quotes
        const enSection2 = content.indexOf('en: {', transObj);
        if (enSection2 >= 0) {
            // Find the end of en section - look for "}," followed by next key or "};"
            let braceCount = 1;
            let pos = content.indexOf('{', enSection2) + 1;
            while (braceCount > 0 && pos < content.length) {
                if (content[pos] === '{') braceCount++;
                else if (content[pos] === '}') braceCount--;
                pos++;
            }
            // Also remove the trailing comma
            const afterEnd = content.substring(pos);
            const commaMatch = afterEnd.match(/^,?\s*\n/);
            const removeEnd = commaMatch ? pos + commaMatch[0].length : pos;
            content = content.substring(0, enSection2) + content.substring(removeEnd);
            console.log('4a. Removed en translations');
        }
    }
    
    const koSection = content.indexOf("'ko': {", transObj);
    if (koSection < 0) {
        const koSection2 = content.indexOf('ko: {', transObj);
        if (koSection2 >= 0) {
            let braceCount = 1;
            let pos = content.indexOf('{', koSection2) + 1;
            while (braceCount > 0 && pos < content.length) {
                if (content[pos] === '{') braceCount++;
                else if (content[pos] === '}') braceCount--;
                pos++;
            }
            const afterEnd = content.substring(pos);
            const commaMatch = afterEnd.match(/^,?\s*\n/);
            const removeEnd = commaMatch ? pos + commaMatch[0].length : pos;
            content = content.substring(0, koSection2) + content.substring(removeEnd);
            console.log('4b. Removed ko translations');
        }
    }
}

// 5. Remove duplicate trailing comma in translations
content = content.replace(/,\s*(\n\s*};)/g, '$1');

// 6. Check for and remove the vocab audio element if present
if (content.indexOf('vocabPlayBtn') >= 0) {
    // This is likely in changelog text, ignore
    console.log('Note: vocabPlayBtn found in changelog/comments only');
}

// Write back
fs.writeFileSync(path, content, 'utf-8');
console.log('\n=== FIXES APPLIED ===');
