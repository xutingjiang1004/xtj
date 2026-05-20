const fs = require('fs');
const c = fs.readFileSync('c:\\Users\\Administrator\\Desktop\\最新index\\xtj\\index.html', 'utf-8');
const lines = c.split('\n');
console.log('Total lines:', lines.length);

let vocabCount = 0;
let vocabLines = [];
for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes('vocab')) {
        vocabCount++;
        if (vocabCount <= 20) vocabLines.push('  Line ' + (i+1) + ': ' + l.substring(0, 120));
    }
}
console.log('Total vocab refs:', vocabCount);
if (vocabLines.length > 0) {
    console.log('Vocab refs found:');
    vocabLines.forEach(v => console.log(v));
}

let photoCount = 0;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('photo-wall') || lines[i].includes('photoWall') || lines[i].includes('PhotoWall') || lines[i].includes('photo-preview')) {
        photoCount++;
    }
}
console.log('\nTotal photo-wall refs:', photoCount);

let langEnKo = 0;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('data-lang="en"') || lines[i].includes('data-lang="ko"') || lines[i].includes('"en":') || lines[i].includes('"ko":')) {
        langEnKo++;
        if (langEnKo <= 5) console.log('  Lang en/ko at line', i+1, ':', lines[i].substring(0, 120));
    }
}
console.log('\nLang en/ko refs remaining:', langEnKo);

// Check panelAi section
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('panelAi')) {
        console.log('\npanelAi at line', i+1, ':', lines[i].substring(0, 120));
        for (let j = i; j < Math.min(i+5, lines.length); j++) {
            console.log('  next line', j+1, ':', lines[j].substring(0, 120));
        }
    }
}

// Check switchDockTab ai handler
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("tab === 'ai'") || lines[i].includes('tab === "ai"')) {
        console.log('\nswitchDockTab ai at line', i+1, ':', lines[i].substring(0, 200));
    }
}
