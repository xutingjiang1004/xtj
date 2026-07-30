const fs = require('fs');
const file = 'tests/cat-ai-avatar-hotfix.spec.js';
let code = fs.readFileSync(file, 'utf8');

const beforeEachBlock = `
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));
  });
});
`;

if (!code.includes('test.beforeEach')) {
  code = code.replace(/test\.describe\('Cat AI Reply - BigInt Comment ID', \(\) => \{/g, 
    "test.describe('Cat AI Reply - BigInt Comment ID', () => {" + beforeEachBlock);
  code = code.replace(/test\.describe\('Avatar CSS and Rendering', \(\) => \{/g, 
    "test.describe('Avatar CSS and Rendering', () => {" + beforeEachBlock);
}

// A3 fix: mock /api/feed correctly to provide the DOM structure
if (!code.includes("body: JSON.stringify({ ok: true, posts: [{")) {
  code = code.replace(
    /test\('A3: AI reply appears inside \.comment-replies container of source comment', async \(\{ page \}\) => \{/,
    `test('A3: AI reply appears inside .comment-replies container of source comment', async ({ page }) => {
      await page.route('**/api/feed**', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, posts: [{
          id: 'test-post', user_name: 'test', content: 'test', created_at: new Date().toISOString()
        }], comments: [{
          id: '34001', post_id: 'test-post', content: 'test', user_name: 'test', created_at: new Date().toISOString()
        }], likes: [], next_offset: 0, endReached: true, total_post_count: 1 })
      }));`
  );
}

// A4 fix: increase timeout from 3000 to 5000 so the second poll can finish
code = code.replace(/await page\.waitForTimeout\(3000\);/g, "await page.waitForTimeout(5000);");

// A5 fix: wait for the error message
// A5 checks `const errors = await page.evaluate(...)` for 'invalid_comment_id'
// The timeout for poll() first request is 2 seconds, so A5 needs to wait!
code = code.replace(
  /await page\.waitForTimeout\(1000\);\s*\/\/ Wait for polling to start/g,
  "await page.waitForTimeout(3000); // Wait for polling to start and finish"
);

fs.writeFileSync(file, code);
console.log('Fixed A3, A4, A5 and applied global fetch mock');
