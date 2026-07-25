const fs = require('fs');
{
  const file = 'tests/code-document.test.js';
  let content = fs.readFileSync(file, 'utf8');

  content = content.replace(
    /const outBuffer = res\.body;/g,
    `const outBuffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.text || '', 'binary');`
  );

  fs.writeFileSync(file, content, 'utf8');
}
console.log('patched code-document.test.js');
