const fs = require('fs');
{
  const file = 'tests/code-document.test.js';
  let content = fs.readFileSync(file, 'utf8');

  content = content.replace(
    /\.attach\('file', buffer, 'test\.xlsx'\);/g,
    `.attach('file', buffer, 'test.xlsx')\n      .responseType('blob');`
  );

  fs.writeFileSync(file, content, 'utf8');
}
console.log('patched code-document.test.js for blob');
