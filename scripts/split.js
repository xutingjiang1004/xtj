const fs = require('fs');
const PATH = 'c:\\Users\\Administrator\\Desktop\\最新index\\xtj';
const content = fs.readFileSync(PATH + '\\index.html', 'utf-8');

// ========== Find all <script>...</script> boundaries ==========
function findAllScripts(text) {
    const scripts = [];
    let searchPos = 0;
    while (true) {
        // Find <script> (opening tag)
        const openStart = text.indexOf('<script>', searchPos);
        if (openStart === -1) break;
        
        // Find </script> (closing tag)
        const closeEnd = text.indexOf('</script>', openStart);
        if (closeEnd === -1) break;
        
        scripts.push({
            openTagStart: openStart,
            openTagEnd: openStart + '<script>'.length,
            contentStart: openStart + '<script>'.length,
            contentEnd: closeEnd,
            closeTagStart: closeEnd,
            closeTagEnd: closeEnd + '</script>'.length,
            content: text.substring(openStart + '<script>'.length, closeEnd)
        });
        
        searchPos = closeEnd + '</script>'.length;
    }
    return scripts;
}

// ========== Find CDN script tags (with src attribute) ==========
function findCdnScripts(text) {
    const cdns = [];
    // Match <script src="..."></script>
    const regex = /<script\s+src=["'][^"']*["']\s*><\/script>/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        cdns.push({
            start: match.index,
            end: match.index + match[0].length,
            content: match[0]
        });
    }
    return cdns;
}

// Find all script elements
const inlineScripts = findAllScripts(content);
const cdnScripts = findCdnScripts(content);

console.log('Found ' + inlineScripts.length + ' inline script blocks');
console.log('Found ' + cdnScripts.length + ' CDN script tags');

for (let i = 0; i < inlineScripts.length; i++) {
    console.log('  Script ' + i + ': ' + inlineScripts[i].content.length + ' chars, ~' + inlineScripts[i].content.split('\n').length + ' lines');
}

// ========== Define the split ==========
// Script 0 (index 0): Core JS → js/core.js
// Script 1 (index 1): Photo wall → js/photo-wall.js
// Script 2 (index 2): SVG calc → js/features.js (part 1)
// Script 3 (index 3): Profile sync → js/features.js (part 2)
// Script 4 (index 4): Report/ban/performance → js/features.js (part 3)

if (inlineScripts.length < 5) {
    console.error('ERROR: Expected 5 inline scripts, found ' + inlineScripts.length);
    process.exit(1);
}

// ========== 1. Extract CSS ==========
const styleOpen = content.indexOf('<style>');
const styleClose = content.indexOf('</style>');
const css = content.substring(styleOpen + '<style>'.length, styleClose);
fs.writeFileSync(PATH + '\\css\\style.css', css);
console.log('\n✓ css/style.css (' + css.split('\n').length + ' lines)');

// ========== 2. Extract JS files ==========
const coreJs = inlineScripts[0].content.trim();
fs.writeFileSync(PATH + '\\js\\core.js', coreJs);
console.log('✓ js/core.js (' + coreJs.split('\n').length + ' lines)');

const pwJs = inlineScripts[1].content.trim();
fs.writeFileSync(PATH + '\\js\\photo-wall.js', pwJs);
console.log('✓ js/photo-wall.js (' + pwJs.split('\n').length + ' lines)');

// Combine scripts 2-4 into features.js
const featuresPart1 = inlineScripts[2].content.trim();
const featuresPart2 = inlineScripts[3].content.trim();
const featuresPart3 = inlineScripts[4].content.trim();
const featuresJs = [featuresPart1, featuresPart2, featuresPart3].join('\n\n');
fs.writeFileSync(PATH + '\\js\\features.js', featuresJs);
console.log('✓ js/features.js (' + featuresJs.split('\n').length + ' lines, from 3 script blocks)');

// ========== 3. Build new index.html ==========
// Strategy: 
// - Replace inline <script>...</script> blocks with <script src="..."> tags
// - Keep CDN scripts as-is
// - Replace <style>...</style> with <link rel="stylesheet" href="css/style.css">
// - Keep everything else

let newHtml = '';
let lastPos = 0;

// Collect all regions to modify
const modifications = [];

// Add CSS replacement
modifications.push({
    start: styleOpen,
    end: styleClose + '</style>'.length,
    replacement: '<link rel="stylesheet" href="css/style.css" />'
});

// Add JS replacements
const scriptRefs = [
    '<script src="js/core.js"></script>',
    '<script src="js/photo-wall.js"></script>',
    null, // Scripts 2-4 combined
    null,
    null
];

// Scripts 2-4 are combined into features.js
// Use the first occurrence for the combined ref
let featuresRefAdded = false;

for (let i = inlineScripts.length - 1; i >= 0; i--) {
    const sc = inlineScripts[i];
    let replacement;
    
    if (i === 0) {
        replacement = scriptRefs[0];
    } else if (i === 1) {
        replacement = scriptRefs[1];
    } else {
        if (!featuresRefAdded) {
            replacement = '<script src="js/features.js"></script>';
            featuresRefAdded = true;
        } else {
            replacement = ''; // Remove duplicate entries
        }
    }
    
    modifications.push({
        start: sc.openTagStart,
        end: sc.closeTagEnd,
        replacement: replacement
    });
}

// Sort modifications by start position (descending for in-place editing)
modifications.sort((a, b) => b.start - a.start);

// Apply modifications
let modifiedContent = content;
for (const mod of modifications) {
    modifiedContent = modifiedContent.substring(0, mod.start) + mod.replacement + modifiedContent.substring(mod.end);
}

fs.writeFileSync(PATH + '\\index.html', modifiedContent);
console.log('✓ index.html (updated, ' + modifiedContent.split('\n').length + ' lines)');

console.log('\n=== DONE ===');