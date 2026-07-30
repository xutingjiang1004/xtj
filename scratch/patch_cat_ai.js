const fs = require('fs');
const file = 'tests/cat-ai-avatar-hotfix.spec.js';
let content = fs.readFileSync(file, 'utf8');

// Replace exact route matches
content = content.replace(/'\/api\/comments\/ai-reply-status\*/g, "'**/api/comments/ai-reply-status*");

// Replace window.pollCatAiReply( calls to include hidden mock
content = content.replace(/window\.pollCatAiReply\(/g, "Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });\n        window.pollCatAiReply(");

// Fix A3, A4, A5 DOM injection
// For A3:
content = content.replace(
  /await page\.setContent\([\s\S]*?`\s*<div id="posts-feed">[\s\S]*?<\/div>\s*`\);\s*await page\.goto\('\/', \{ waitUntil: 'domcontentloaded' \}\);/g,
  `await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      document.body.innerHTML = \`<div id="posts-feed">
        <div class="post-item" data-post-id="test-post">
          <div class="comment-list">
            <div class="comment-item" data-comment-id="34001">
              <div class="comment-replies"></div>
            </div>
          </div>
        </div>
      </div>\`;
    });`
);

// For A4:
content = content.replace(
  /await page\.setContent\([\s\S]*?`\s*<div id="posts-feed">[\s\S]*?data-comment-id="d7dd9"[\s\S]*?<\/div>\s*`\);\s*await page\.goto\('\/', \{ waitUntil: 'domcontentloaded' \}\);/g,
  `await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      document.body.innerHTML = \`<div id="posts-feed">
        <div class="post-item" data-post-id="test-post">
          <div class="comment-list">
            <div class="comment-item" data-comment-id="d7dd9">
              <div class="comment-replies"></div>
            </div>
          </div>
        </div>
      </div>\`;
    });`
);

// For A5:
content = content.replace(
  /await page\.setContent\([\s\S]*?`\s*<div id="posts-feed">[\s\S]*?data-comment-id="11966"[\s\S]*?<\/div>\s*`\);\s*await page\.goto\('\/', \{ waitUntil: 'domcontentloaded' \}\);/g,
  `await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      document.body.innerHTML = \`<div id="posts-feed">
        <div class="post-item" data-post-id="test-post">
          <div class="comment-list">
            <div class="comment-item" data-comment-id="11966">
              <div class="comment-replies"></div>
            </div>
          </div>
        </div>
      </div>\`;
    });`
);


fs.writeFileSync(file, content, 'utf8');
console.log('Fixed A1-A5');
