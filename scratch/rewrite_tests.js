const fs = require('fs');
const file = 'tests/cat-ai-avatar-hotfix.spec.js';
let code = fs.readFileSync(file, 'utf8');

// For A1, A4, A5, ensure we properly wait for pollCatAiReply
code = code.replace(/window\.pollCatAiReply\('123'/g, 
  "window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));\n        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });\n        window.pollCatAiReply('123'");
code = code.replace(/window\.pollCatAiReply\('d7dd9'/g, 
  "window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));\n        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });\n        window.pollCatAiReply('d7dd9'");
code = code.replace(/window\.pollCatAiReply\('11966'/g, 
  "window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));\n        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });\n        window.pollCatAiReply('11966'");
code = code.replace(/window\.pollCatAiReply\('200'/g, 
  "window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));\n        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });\n        window.pollCatAiReply('200'");

// Fix B6 and B7 test flakiness by waiting for the locator explicitly
code = code.replace(
  /const img = page\.locator\('\.post\[data-post-id="avatar-test-post"\] \.avatar \.avatar-image'\);\s+const box = await img\.boundingBox\(\);/g,
  `const img = page.locator('.post[data-post-id="avatar-test-post"] .avatar .avatar-image');
    await img.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    const box = await img.boundingBox();`
);

// Fix route in A1
code = code.replace(
  /await page\.route\('\*\*\/api\/comments\/ai-reply-status\*', async route => \{/g,
  "await page.route('**/api/comments/ai-reply-status**', async route => {"
);

fs.writeFileSync(file, code);
console.log('Done rewriting tests');
