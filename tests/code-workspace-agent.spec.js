// @ts-check
const { test, expect } = require('@playwright/test');

function json(route, status, body) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body)
  });
}

test.describe('Code workspace Agent browser flow', () => {
  test('GitHub workspace, document context, tool trace, themes and input recovery work end to end', async ({ page }) => {
    const githubCalls = [];
    const chatBodies = [];
    let chatAttempt = 0;

    await page.route('**/api/code/capabilities', (route) => json(route, 200, {
      ok: true,
      configured: true,
      agentEnabled: true,
      toolCallingEnabled: true,
      provider: 'DeepSeek',
      model: 'deepseek-v4-flash',
      maxToolRounds: 8,
      maxContextTokens: 1000000,
      supportedDocuments: ['docx', 'pdf', 'xlsx', 'pptx', 'txt', 'csv', 'md', 'json']
    }));

    await page.route('**/api/code/github/repos/xutingjiang1004/xtj**', async (route) => {
      const url = new URL(route.request().url());
      githubCalls.push(url.pathname + url.search);
      if (url.pathname.endsWith('/branches')) {
        return json(route, 200, { branches: [{ name: 'xtj-hotfix' }, { name: 'main' }] });
      }
      if (url.pathname.endsWith('/tree')) {
        return json(route, 200, {
          data: {
            tree: [
              { path: 'README.md', type: 'blob', sha: 'readme-sha', size: 22 },
              { path: 'src', type: 'tree', sha: 'src-sha' },
              { path: 'src/travel.js', type: 'blob', sha: 'travel-sha', size: 36 }
            ]
          }
        });
      }
      if (url.pathname.endsWith('/file')) {
        const path = url.searchParams.get('path');
        const source = path === 'README.md'
          ? '# XTJ\n旅行攻略工作区'
          : 'export const destination = "广州";';
        return json(route, 200, {
          content: Buffer.from(source, 'utf8').toString('base64'),
          encoding: 'base64',
          sha: path === 'README.md' ? 'readme-sha' : 'travel-sha',
          size: Buffer.byteLength(source),
          mimeType: path.endsWith('.md') ? 'text/markdown' : 'text/javascript'
        });
      }
      return json(route, 200, {
        repo: {
          full_name: 'xutingjiang1004/xtj',
          default_branch: 'xtj-hotfix',
          private: true,
          description: 'XTJ private workspace',
          updated_at: '2026-07-26T00:00:00.000Z'
        }
      });
    });

    await page.route('**/api/code/index/status', (route) => json(route, 200, {
      ok: true,
      summary: null,
      pinnedFiles: [],
      rebuildRequired: true
    }));
    await page.route('**/api/code/index/build', async (route) => {
      const body = route.request().postDataJSON();
      expect(body.workspaceId).toContain('github:');
      expect(body.files.map((file) => file.path)).toEqual(expect.arrayContaining(['README.md', 'src/travel.js']));
      return json(route, 200, {
        ok: true,
        totalFiles: body.files.length,
        totalChunks: body.files.length,
        skippedFiles: 0,
        failedFiles: 0,
        builtAt: '2026-07-26T00:00:00.000Z'
      });
    });
    await page.route('**/api/code/agent/pin_file', (route) => json(route, 200, { ok: true }));

    await page.route('**/api/code/document/extract', (route) => json(route, 200, {
      ok: true,
      name: '广州旅游计划.md',
      mimeType: 'text/markdown',
      text: '第一天：广州塔\n第二天：沙面',
      sha256: 'travel-document-sha',
      truncated: false
    }));

    await page.route('**/api/code/chat', async (route) => {
      chatAttempt += 1;
      const body = route.request().postDataJSON();
      chatBodies.push(body);
      if (chatAttempt === 2) {
        return json(route, 503, { error: '测试中的临时上游故障' });
      }
      return json(route, 200, {
        ok: true,
        reply: '已读取 src/travel.js 和旅行资料，可以据此生成广州三日攻略。',
        operations: [],
        capabilities: {
          agentEnabled: true,
          toolCallingEnabled: true,
          provider: 'DeepSeek',
          model: 'deepseek-v4-flash',
          maxToolRounds: 8
        },
        tool_trace: [{
          tool: 'read_file',
          arguments: { path: 'src/travel.js' },
          result: { path: 'src/travel.js', startLine: 1, endLine: 1 }
        }],
        context_info: {
          files_read: [{ path: 'src/travel.js', startLine: 1, endLine: 1 }],
          attachments: [{ path: 'attachments/广州旅游计划.md' }],
          estimated_tokens: 128,
          prompt_cache_hit_tokens: 96,
          prompt_cache_miss_tokens: 32
        }
      });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      // The Code APIs are login-only in production. This test isolates the Code
      // workspace flow while preserving the same-origin fetch path and cookies.
      window.xtjProtectedFetch = (path, options) => fetch(path, Object.assign({
        credentials: 'include'
      }, options || {}));
    });
    await page.locator('[data-desktop-tab="code"]').click();
    await expect(page.locator('#codeWelcomeGitHubBtn')).toBeVisible({ timeout: 15000 });

    await page.locator('#codeWelcomeGitHubBtn').click();
    await page.locator('#githubRepoInput').fill('xutingjiang1004/xtj');
    await page.locator('#githubRepoLoadBtn').click();
    await expect(page.locator('#githubOpenWorkspaceBtn')).toBeVisible();
    await page.locator('#githubOpenWorkspaceBtn').click();

    await expect(page.locator('.code-workspace-shell')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.chat-model-badge')).toContainText('DeepSeek · Agent');
    await expect(page.locator('.code-tree-item[data-path="README.md"]')).toBeVisible();
    await page.locator('.code-tree-item[data-path="src"]').click();
    await expect(page.locator('.code-tree-item[data-path="src/travel.js"]')).toBeVisible();
    await page.locator('.code-tree-item[data-path="src/travel.js"]').click();
    await expect(page.locator('.code-tab[data-path="src/travel.js"]')).toBeVisible();

    await page.locator('#codeAttachmentInput').setInputFiles({
      name: '广州旅游计划.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('第一天：广州塔\n第二天：沙面', 'utf8')
    });
    await expect(page.locator('.code-attachment-chip')).toContainText('广州旅游计划.md');

    await page.locator('#codeChatInput').fill('结合代码和资料帮我制作广州三日旅游攻略');
    await page.locator('#codeChatSendBtn').click();
    await expect(page.locator('#codeChatMessages')).toContainText('已读取 src/travel.js');
    await expect(page.locator('#codeContextPanel')).toContainText('src/travel.js');
    await expect(page.locator('#codeContextPanel')).toContainText('广州旅游计划.md');
    await expect(page.locator('#codeChatInput')).toBeEnabled();

    expect(chatBodies[0].attachments).toHaveLength(1);
    expect(chatBodies[0].attachments[0]).toMatchObject({
      path: 'attachments/广州旅游计划.md',
      source: 'attachment'
    });
    expect(chatBodies[0].attachments[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(chatBodies[0].open_files.map((file) => file.path)).toContain('src/travel.js');

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#codeChatMessages')).toContainText('已读取 src/travel.js');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('.code-attachment-chip')).toHaveCount(0);

    await page.locator('#codeChatInput').fill('再次请求以验证错误恢复');
    await page.locator('#codeChatSendBtn').click();
    await expect(page.locator('#codeChatMessages')).toContainText('测试中的临时上游故障');
    await expect(page.locator('#codeChatInput')).toBeEnabled();
    await expect(page.locator('#codeChatSendBtn')).toBeEnabled();
    await expect(page.locator('#codeChatInput')).toHaveValue('\u518d\u6b21\u8bf7\u6c42\u4ee5\u9a8c\u8bc1\u9519\u8bef\u6062\u590d');

    expect(githubCalls.filter((url) => /\/xtj$/.test(url)).length).toBe(1);
    expect(githubCalls.every((url) => url.startsWith('/api/code/github/'))).toBe(true);
  });
});
