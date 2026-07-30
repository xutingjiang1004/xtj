const fs = require('fs');
const file = 'tests/cat-ai-avatar-hotfix.spec.js';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /Object\.defineProperty\(document, 'hidden', \{ configurable: true, get: \(\) => false \}\);/g,
  "Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });\n      window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));"
);

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed xtjProtectedFetch in tests');
