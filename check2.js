const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\Administrator\\Desktop\\最新index\\xtj\\index.html', 'utf-8');
const lines = content.split('\n');

console.log('=== Checking for remaining issues ===\n');

// Count all vocab references
let vocabRefs = [];
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('vocab')) {
        vocabRefs.push({line: i+1, text: lines[i].substring(0, 150)});
    }
}
console.log('Vocab references (' + vocabRefs.length + '):');
vocabRefs.forEach(r => {
    // Skip changelog comments
    if (r.text.includes('changelog') || r.text.includes('更新') || r.text.includes('li>') || r.text.includes('&lt;')) return;
    console.log('  Line ' + r.line + ': ' + r.text);
});

// Check for language tabs
console.log('\n=== Language tabs section ===');
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('profile-lang-tab') || lines[i].includes('profileLang')) {
        console.log('Line ' + (i+1) + ': ' + lines[i].substring(0, 150));
    }
}

// Check en/ko in translations
console.log('\n=== Translations en/ko ===');
for (let i = 0; i < lines.length; i++) {
    if ((lines[i].includes("'en':") || lines[i].includes("'ko':") || lines[i].includes('en: {') || lines[i].includes('ko: {')) && lines[i].includes('translat') === false) {
        console.log('Line ' + (i+1) + ': ' + lines[i].substring(0, 150));
    }
}

// Check switchDockTab
console.log('\n=== switchDockTab ai handlers ===');
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("tab === 'ai'") || lines[i].includes('tab === "ai"')) {
        console.log('Line ' + (i+1) + ': ' + lines[i].substring(0, 200));
    }
}

// Check the photo wall section
console.log('\n=== Photo wall panel area ===');
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('panelAi')) {
        console.log('Line ' + (i+1) + ': ' + lines[i].substring(0, 150));
        for (let j = i+1; j < Math.min(i+10, lines.length); j++) {
            if (lines[j].includes('photo') || lines[j].includes('container') || lines[j].includes('panel')) {
                console.log('  Line ' + (j+1) + ': ' + lines[j].substring(0, 150));
            }
        }
        break;
    }
}

console.log('\n=== Done ===');
