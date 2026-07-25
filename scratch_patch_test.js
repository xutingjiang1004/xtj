const fs = require('fs');
{
  const file = 'tests/code-document.test.js';
  let content = fs.readFileSync(file, 'utf8');

  content = content.replace(
    /assert\.ok\(res\.headers\['content-disposition'\]\.includes\('test_AI修改版\.xlsx'\)\);/g,
    `assert.ok(decodeURIComponent(res.headers['content-disposition']).includes('test_AI修改版.xlsx'));`
  );

  fs.writeFileSync(file, content, 'utf8');
}
console.log('patched code-document.test.js');
