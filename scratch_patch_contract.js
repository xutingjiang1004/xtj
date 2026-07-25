const fs = require('fs');
{
  const file = 'tests/code-agent-contract.test.js';
  let content = fs.readFileSync(file, 'utf8');

  content = content.replace(
    /assert\.match\(codeAgent, \/process\\\.env\\\.DEEPSEEK_API_KEY\/\);/g,
    `assert.match(codeAgent, /deps\\.getDeepSeekApiKey/);`
  );
  content = content.replace(
    /DEEPSEEK_API_KEY is read from process.env/g,
    `DEEPSEEK_API_KEY is read from deps`
  );

  fs.writeFileSync(file, content, 'utf8');
}
console.log('patched code-agent-contract.test.js');
