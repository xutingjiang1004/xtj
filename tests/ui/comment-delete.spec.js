const { test, expect } = require('@playwright/test');

test('a user can hard-delete only their own rendered comment', async ({ page }) => {
  let deleteRequests = 0;
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'author');
    localStorage.setItem('xtj_device_id', 'comment-delete-test');
  });
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/api/user/refresh', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'comment-delete-token' })
  }));
  await page.route('**/api/feed**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      posts: [{ id: 'comment-post', user_name: 'poster', content: 'post', created_at: '2026-07-20T08:00:00.000Z', visibility: 'public' }],
      comments: [
        { id: 'comment-owned', post_id: 'comment-post', user_name: 'author', content: 'my comment', created_at: '2026-07-20T08:01:00.000Z' },
        { id: 'comment-other', post_id: 'comment-post', user_name: 'other', content: 'other comment', created_at: '2026-07-20T08:02:00.000Z' }
      ],
      likes: [], next_offset: 1, endReached: true, total_post_count: 1
    })
  }));
  await page.route('**/api/post/comment/comment-owned', route => {
    deleteRequests += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, deleted_comment_id: 'comment-owned' }) });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-comment-id="comment-owned"] .comment-del-btn')).toHaveCount(1);
  await expect(page.locator('[data-comment-id="comment-other"] .comment-del-btn')).toHaveCount(0);
  await page.locator('[data-comment-id="comment-owned"] .comment-del-btn').click();
  await expect(page.locator('[data-comment-id="comment-owned"]')).toHaveCount(0);
  await expect(page.locator('[data-comment-id="comment-other"]')).toBeVisible();
  expect(deleteRequests).toBe(1);
});
