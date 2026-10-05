const { test, expect } = require('@playwright/test');

test('publish button sends once, shows busy state, and inserts the returned post', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const createdId = '11111111-1111-4111-8111-111111111111';
  let createCalls = 0;
  let releaseCreate;
  const createWait = new Promise(resolve => { releaseCreate = resolve; });
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'publisher');
    localStorage.setItem('xtj_device_id', 'device_publish_test');
  });
  await page.route('**/api/user/refresh', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ token: 'test-access-token' })
  }));
  await page.route('**/api/post/create', async route => {
    createCalls += 1;
    await createWait;
    const request = route.request();
    expect(request.headers().authorization).toBe('Bearer test-access-token');
    const payload = request.postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          id: createdId,
          user_name: 'publisher',
          content: payload.content,
          media_url: '',
          media_type: '',
          actor_key: 'device_publish_test',
          visibility: 'public',
          views: 0,
          created_at: new Date().toISOString()
        }
      })
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.doPublish === 'function');
  await page.locator('#postInp').fill('发布按钮运行时验证');
  const button = page.locator('#pubBtn');
  await button.click();
  await page.evaluate(() => window.doPublish());
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(button).toBeDisabled();
  releaseCreate();
  await expect(page.locator(`.post[data-post-id="${createdId}"]`)).toBeVisible();
  await expect(button).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#postInp')).toHaveValue('');
  expect(createCalls).toBe(1);
  expect(pageErrors).toEqual([]);
});

test('a delayed feed refresh merges instead of removing a newly published post', async ({ page }) => {
  const createdId = '12121212-1212-4121-8121-121212121212';
  let releaseFeed;
  const delayedFeed = new Promise(resolve => { releaseFeed = resolve; });
  let deleteCalls = 0;
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'race-publisher');
    localStorage.setItem('xtj_device_id', 'race_publish_device');
  });
  await page.route('**/api/user/refresh', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ token: 'race-token' })
  }));
  await page.route('**/api/feed**', async route => {
    await delayedFeed;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, posts: [], comments: [], likes: [], next_offset: 0, endReached: true, total_post_count: 0 })
    });
  });
  await page.route('**/api/post/create', route => {
    const payload = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: {
        id: createdId,
        user_name: 'race-publisher',
        content: payload.content,
        media_url: '', media_type: '', actor_key: 'race_publish_device',
        visibility: 'public', views: 0, created_at: new Date().toISOString()
      } })
    });
  });
  await page.route('**/api/post/delete**', route => {
    deleteCalls += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.doPublish === 'function');
  await page.locator('#postInp').fill('发布期间遇到旧列表回包');
  await page.locator('#pubBtn').click();
  await expect(page.locator(`.post[data-post-id="${createdId}"]`)).toBeVisible();
  releaseFeed();
  await page.waitForTimeout(350);
  await expect(page.locator(`.post[data-post-id="${createdId}"]`)).toHaveCount(1);
  expect(deleteCalls).toBe(0);
});

test('inline comment composer sends once to its post', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const postId = '22222222-2222-4222-8222-222222222222';
  let commentCalls = 0;
  let submittedPostId = '';
  let releaseComment;
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'commenter');
    localStorage.setItem('xtj_device_id', 'device_comment_test');
  });
  await page.route('**/api/user/refresh', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ token: 'test-access-token' })
  }));
  await page.route('**/api/feed**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      posts: [{
        id: postId,
        user_name: 'commenter',
        content: 'A post with an inline comment composer.',
        media_url: '',
        media_type: '',
        actor_key: 'device_comment_test',
        visibility: 'public',
        views: 0,
        created_at: new Date().toISOString()
      }],
      comments: [],
      likes: [],
      next_offset: 1,
      endReached: true,
      total_post_count: 1
    })
  }));
  await page.route('**/api/post/comment', async route => {
    commentCalls += 1;
    const payload = route.request().postDataJSON();
    submittedPostId = payload.post_id;
    await new Promise(resolve => { releaseComment = resolve; });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          id: '33333333-3333-4333-8333-333333333333',
          post_id: postId,
          user_name: 'commenter',
          content: payload.content,
          actor_key: 'comment_runtime_test',
          created_at: new Date().toISOString()
        }
      })
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.openComment === 'function' && window.currentUser === 'commenter');
  const post = page.locator(`.post[data-post-id="${postId}"]`);
  await expect(post).toBeVisible();
  await post.locator('.actions button').filter({ hasText: '评论' }).click();
  const box = post.locator('.inline-comment-box');
  await expect(box.locator('.inline-comment-inp')).toBeVisible();
  await box.locator('.inline-comment-inp').fill('评论运行时验证');
  const button = box.getByRole('button', { name: '发送' });
  await button.click();
  await expect.poll(() => commentCalls).toBe(1);
  await expect(button).toBeDisabled();
  await page.evaluate(() => {
    const send = document.querySelector('.inline-comment-box button');
    if (send && typeof send.onclick === 'function') send.onclick();
  });
  expect(commentCalls).toBe(1);
  releaseComment();
  await expect(page.locator(`.post[data-post-id="${postId}"] .comments`)).toContainText('评论运行时验证');
  expect(commentCalls).toBe(1);
  expect(submittedPostId).toBe(postId);
  expect(pageErrors).toEqual([]);
});

test('delete timeout confirms both already-deleted and still-existing states', async ({ page }) => {
  const deletedId = '44444444-4444-4444-8444-444444444444';
  const existingId = '55555555-5555-4555-8555-555555555555';
  let nextCreateId = deletedId;
  let statusCalls = 0;
  await page.addInitScript(() => {
    localStorage.setItem('xtj_user', 'deleter');
    localStorage.setItem('xtj_device_id', 'device_delete_test');
    window.__xtjPostDeleteRequestTimeoutMs = 60;
    window.__xtjPostDeleteStatusTimeoutMs = 500;
  });
  await page.route('**/api/user/refresh', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ token: 'test-access-token' })
  }));
  await page.route('**/api/post/create', route => {
    const payload = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: {
        id: nextCreateId,
        user_name: 'deleter',
        content: payload.content,
        media_url: '', media_type: '', actor_key: 'device_delete_test',
        visibility: 'public', views: 0, created_at: new Date().toISOString()
      } })
    });
  });
  await page.route(/\/api\/post\/delete(?:\?.*)?$/, async route => {
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.abort('timedout').catch(() => {});
  });
  await page.route(/\/api\/post\/delete-status(?:\?.*)?$/, route => {
    statusCalls += 1;
    const id = route.request().postDataJSON().post_id;
    const exists = id === existingId;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, post_id: id, exists, deleted: !exists })
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.doPublish === 'function');
  let expectedStatusCalls = 0;
  for (const id of [existingId, deletedId]) {
    nextCreateId = id;
    await page.locator('#postInp').fill(`待删除 ${id}`);
    await page.locator('#pubBtn').click();
    await expect(page.locator(`.post[data-post-id="${id}"]`)).toBeVisible();
    await page.evaluate(postId => window.openDelete(postId, 'device_delete_test'), id);
    await page.locator('#delBtn').click();
    expectedStatusCalls += 1;
    await expect.poll(() => statusCalls).toBe(expectedStatusCalls);
    if (id === deletedId) {
      await expect(page.locator(`.post[data-post-id="${id}"]`)).toHaveCount(0);
    } else {
      await expect(page.locator(`.post[data-post-id="${id}"]`)).toBeVisible();
      await expect(page.locator('#delBtn')).toBeEnabled();
    }
  }
  expect(statusCalls).toBe(2);
});
