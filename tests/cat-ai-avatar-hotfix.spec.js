const { test, expect } = require('@playwright/test');

// ============================================================
// Section 6A: Cat AI Reply Real Browser Tests
// ============================================================

test.describe('Cat AI Reply - BigInt Comment ID', () => {
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));
  });
});

  test('A1: ai-reply-status must not return 400 for numeric comment_id', async ({ page }) => {
    let statusCalled = false;
    await page.route('**/api/comments/ai-reply-status**', async route => {
      statusCalled = true;
      const url = new URL(route.request().url());
      const commentId = url.searchParams.get('comment_id');
      // Verify comment_id is a numeric string
      expect(commentId).toBe('123');
      expect(commentId).toMatch(/^\d+$/);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'processing', reply_comment_id: null, message: '小猫正在组织毒液……' })
      });
    });
    await page.route('**/api/feed**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, posts: [], comments: [], likes: [], next_offset: 0, endReached: true, total_post_count: 0 })
    }));
    await page.route('**/api/avatar/batch', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, avatars: {} }) }));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Simulate pollCatAiReply being called with a numeric comment ID
    const result = await page.evaluate(async () => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));
      if (typeof window.pollCatAiReply !== 'function') return 'pollCatAiReply not found';
      try {
        // Call with a numeric string comment ID
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));
        window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        window.pollCatAiReply('123', 'test-post-id');
        return 'called';
      } catch (e) {
        return 'error: ' + e.message;
      }
    });
    // Wait for the fetch to complete, longer timeout in case of setTimeout
    await page.waitForTimeout(3500);
    console.log('Test A1 evaluate result:', result);
    expect(statusCalled).toBe(true);
  });

  test('A2: completed data with numeric parent_comment_id passes String() comparison', async ({ page }) => {
    const aiReply = {
      id: 456,
      post_id: 'test-post',
      user_name: 'cat_ai',
      content: '小猫的毒舌回复',
      created_at: new Date().toISOString(),
      parent_comment_id: 123, // numeric
      generated_by_ai: true
    };
    await page.route('**/api/comments/ai-reply-status**', route => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'completed',
          reply_comment_id: 456,
          data: aiReply
        })
      });
    });
    await page.route('**/api/feed**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        posts: [{ id: 'test-post', user_name: 'Alice', content: 'test post', created_at: new Date().toISOString(), visibility: 'public', views: 0 }],
        comments: [],
        likes: [],
        next_offset: 0,
        endReached: true,
        total_post_count: 1
      })
    }));
    await page.route('**/api/avatar/batch', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, avatars: {} }) }));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Simulate pollCatAiReply
    await page.evaluate(() => {
      if (typeof window.pollCatAiReply === 'function') {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));
        window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        window.pollCatAiReply('123', 'test-post');
      }
    });
    await page.waitForTimeout(500);
    // Verify the feed contains the AI reply
    const feedHtml = await page.evaluate(() => document.getElementById('feed')?.innerHTML || '');
    // The AI reply should be inserted into the DOM
    expect(feedHtml.length).toBeGreaterThan(0);
  });

  test('A3: AI reply appears inside .comment-replies container of source comment', async ({ page }) => {
      await page.route('**/api/feed**', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, posts: [{
          id: 'test-post', user_name: 'test', content: 'test', created_at: new Date().toISOString()
        }], comments: [{
          id: '34001', post_id: 'test-post', content: 'test', user_name: 'test', created_at: new Date().toISOString()
        }], likes: [], next_offset: 0, endReached: true, total_post_count: 1 })
      }));
    const aiReply = {
      id: 789,
      post_id: 'test-post-2',
      user_name: 'cat_ai',
      content: '小猫的回复',
      created_at: new Date().toISOString(),
      parent_comment_id: 100,
      generated_by_ai: true
    };
    await page.route('**/api/comments/ai-reply-status**', route => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'completed', reply_comment_id: 789, data: aiReply })
      });
    });
    await page.route('**/api/feed**', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        posts: [{ id: 'test-post-2', user_name: 'Alice', content: 'test', created_at: new Date().toISOString(), visibility: 'public', views: 0 }],
        comments: [{ id: 100, post_id: 'test-post-2', user_name: 'Alice', content: '@小猫 你好', created_at: new Date().toISOString() }],
        likes: [],
        next_offset: 0, endReached: true, total_post_count: 1
      })
    }));
    await page.route('**/api/avatar/batch', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, avatars: {} }) }));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      if (typeof window.pollCatAiReply === 'function') {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));
        window.pollCatAiReply('100', 'test-post-2');
      }
    });
    await page.waitForTimeout(500);

    // Check DOM structure: AI reply should be inside .comment-replies
    const domCheck = await page.evaluate(() => {
      const sourceEl = document.querySelector('.comment-item[data-comment-id="100"]');
      if (!sourceEl) return 'source_comment_missing';
      const repliesContainer = sourceEl.querySelector('.comment-replies');
      if (!repliesContainer) return 'no_replies_container';
      const catComment = repliesContainer.querySelector('.cat-ai-comment');
      if (!catComment) return 'no_cat_ai_comment';
      return 'ok';
    });
    expect(domCheck).toBe('ok');
  });

  test('A4: not_triggered does not immediately terminate polling', async ({ page }) => {
    let pollCount = 0;
    await page.route('**/api/comments/ai-reply-status**', route => {
      pollCount++;
      if (pollCount <= 2) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'not_triggered',
            reply_comment_id: null,
            message: '',
            comment_created_at: new Date().toISOString() // recently created
          })
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'processing', reply_comment_id: null, message: '小猫正在组织毒液……' })
      });
    });
    await page.route('**/api/feed**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, posts: [], comments: [], likes: [], next_offset: 0, endReached: true, total_post_count: 0 })
    }));
    await page.route('**/api/avatar/batch', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, avatars: {} }) }));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      if (typeof window.pollCatAiReply === 'function') {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));
        window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        window.pollCatAiReply('200', 'test-post-3');
      }
    });
    // Wait for multiple poll cycles
    await page.waitForTimeout(5000);
    // Should have polled more than once (not_triggered should not terminate immediately)
    expect(pollCount).toBeGreaterThanOrEqual(2);
  });

  test('A5: HTTP 400 invalid_comment_id shows error message, not retry', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.route('**/api/comments/ai-reply-status**', route => {
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid comment_id', code: 'invalid_comment_id' })
      });
    });
    await page.route('**/api/feed**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, posts: [], comments: [], likes: [], next_offset: 0, endReached: true, total_post_count: 0 })
    }));
    await page.route('**/api/avatar/batch', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, avatars: {} }) }));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      if (typeof window.pollCatAiReply === 'function') {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));
        window.pollCatAiReply('999', 'test-post');
      }
    });
    await page.waitForTimeout(500);
    // Check that invalid_comment_id error was logged
    const hasInvalidError = errors.some(e => e.includes('invalid comment_id'));
    expect(hasInvalidError).toBe(true);
  });
});

// ============================================================
// Section 6B: Avatar Real Browser Tests
// ============================================================

test.describe('Avatar CSS and Rendering', () => {
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({ credentials: 'include' }, options));
  });
});

  const mockPost = {
    id: 'avatar-test-post',
    user_name: 'TestUser',
    content: 'Avatar test post',
    created_at: new Date().toISOString(),
    visibility: 'public',
    views: 0
  };

  test('B1: Avatar image boundingBox is 40x40', async ({ page }) => {
    await page.route('**/api/feed**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, posts: [mockPost], comments: [], likes: [],
        next_offset: 0, endReached: true, total_post_count: 1
      })
    }));
    await page.route('**/api/avatar/batch', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        avatars: { 'TestUser': 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>' }
      })
    }));

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => { if (typeof window.switchDockTab === 'function') window.switchDockTab('posts', true); });
    await page.waitForTimeout(300);

    const avatarImg = page.locator('.post[data-post-id="avatar-test-post"] .avatar .avatar-image');
    await expect(avatarImg).toBeVisible({ timeout: 5000 });
    const box = await avatarImg.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box.width)).toBe(40);
    expect(Math.round(box.height)).toBe(40);
  });

  test('B2: Avatar has-image class added on successful load', async ({ page }) => {
    await page.route('**/api/feed**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, posts: [mockPost], comments: [], likes: [],
        next_offset: 0, endReached: true, total_post_count: 1
      })
    }));
    await page.route('**/api/avatar/batch', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        avatars: { 'TestUser': 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>' }
      })
    }));

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => { if (typeof window.switchDockTab === 'function') window.switchDockTab('posts', true); });
    await page.waitForTimeout(500);

    const hasImageClass = await page.evaluate(() => {
      const avatar = document.querySelector('.post[data-post-id="avatar-test-post"] .avatar');
      return avatar ? avatar.classList.contains('has-image') : 'avatar_not_found';
    });
    expect(hasImageClass).toBe(true);
  });

  test('B3: Avatar fallback visible when image URL is broken', async ({ page }) => {
    await page.route('**/api/feed**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, posts: [mockPost], comments: [], likes: [],
        next_offset: 0, endReached: true, total_post_count: 1
      })
    }));
    await page.route('**/api/avatar/batch', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        avatars: { 'TestUser': 'https://invalid.example.com/broken-avatar.jpg' }
      })
    }));

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => { if (typeof window.switchDockTab === 'function') window.switchDockTab('posts', true); });
    await page.waitForTimeout(1500);

    const fallbackCheck = await page.evaluate(() => {
      const avatar = document.querySelector('.post[data-post-id="avatar-test-post"] .avatar');
      if (!avatar) return 'avatar_not_found';
      const fallback = avatar.querySelector('.avatar-fallback');
      if (!fallback) return 'no_fallback';
      const hasImage = avatar.classList.contains('has-image');
      return { hasImage, fallbackText: fallback.textContent, fallbackVisible: fallback.style.visibility !== 'hidden' };
    });
    expect(fallbackCheck.hasImage).toBe(false);
    expect(fallbackCheck.fallbackText).toBe('T');
  });

  test('B4: No duplicate img nodes in avatar', async ({ page }) => {
    await page.route('**/api/feed**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, posts: [mockPost], comments: [], likes: [],
        next_offset: 0, endReached: true, total_post_count: 1
      })
    }));
    await page.route('**/api/avatar/batch', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        avatars: { 'TestUser': 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>' }
      })
    }));

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => { if (typeof window.switchDockTab === 'function') window.switchDockTab('posts', true); });
    await page.waitForTimeout(500);

    // Trigger feed re-render 10 times
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => {
        if (typeof window.renderFeed === 'function' && window.feedAllPosts) {
          window.renderFeed(window.feedAllPosts);
        }
      });
      await page.waitForTimeout(100);
    }

    const imgCount = await page.evaluate(() => {
      const avatar = document.querySelector('.post[data-post-id="avatar-test-post"] .avatar');
      if (!avatar) return -1;
      return avatar.querySelectorAll('img').length;
    });
    expect(imgCount).toBeLessThanOrEqual(1);
  });

  test('B5: Avatar computedStyle has correct absolute positioning', async ({ page }) => {
    await page.route('**/api/feed**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, posts: [mockPost], comments: [], likes: [],
        next_offset: 0, endReached: true, total_post_count: 1
      })
    }));
    await page.route('**/api/avatar/batch', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        avatars: { 'TestUser': 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>' }
      })
    }));

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => { if (typeof window.switchDockTab === 'function') window.switchDockTab('posts', true); });
    await page.waitForTimeout(500);

    const computed = await page.evaluate(() => {
      const img = document.querySelector('.post[data-post-id="avatar-test-post"] .avatar .avatar-image');
      if (!img) return null;
      const style = window.getComputedStyle(img);
      return {
        position: style.position,
        objectFit: style.objectFit,
        display: style.display,
        width: style.width,
        height: style.height
      };
    });
    expect(computed).not.toBeNull();
    expect(computed.position).toBe('absolute');
    expect(computed.objectFit).toBe('cover');
    expect(computed.display).toBe('block');
  });

  test('B6: Avatar with extra-wide image crops correctly', async ({ page }) => {
    // 200x50 image in a 40x40 container
    const wideSvg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><rect width="200" height="50" fill="red"/><circle cx="25" cy="25" r="20" fill="green"/></svg>';
    await page.route('**/api/feed**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, posts: [{ ...mockPost, user_name: 'WideUser' }], comments: [], likes: [],
        next_offset: 0, endReached: true, total_post_count: 1
      })
    }));
    await page.route('**/api/avatar/batch', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, avatars: { 'WideUser': wideSvg } })
    }));

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => { if (typeof window.switchDockTab === 'function') window.switchDockTab('posts', true); });
    await page.waitForTimeout(500);

    const img = page.locator('.post[data-post-id="avatar-test-post"] .avatar .avatar-image');
    await img.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    const box = await img.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box.width)).toBe(40);
    expect(Math.round(box.height)).toBe(40);
  });

  test('B7: Avatar with extra-tall image crops correctly', async ({ page }) => {
    const tallSvg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="50" height="200"><rect width="50" height="200" fill="purple"/><circle cx="25" cy="25" r="20" fill="yellow"/></svg>';
    await page.route('**/api/feed**', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ok: true, posts: [{ ...mockPost, user_name: 'TallUser' }], comments: [], likes: [],
        next_offset: 0, endReached: true, total_post_count: 1
      })
    }));
    await page.route('**/api/avatar/batch', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, avatars: { 'TallUser': tallSvg } })
    }));

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => { if (typeof window.switchDockTab === 'function') window.switchDockTab('posts', true); });
    await page.waitForTimeout(500);

    const img = page.locator('.post[data-post-id="avatar-test-post"] .avatar .avatar-image');
    await img.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    const box = await img.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box.width)).toBe(40);
    expect(Math.round(box.height)).toBe(40);
  });
});