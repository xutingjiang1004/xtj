const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const codeWorkspaceSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'code-workspace.js'), 'utf8');
const codeWorkspaceCss = fs.readFileSync(path.join(__dirname, '..', 'css', 'code-workspace.css'), 'utf8');
function sse(events) {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

async function openCodeWorkspace(page, options = {}) {
  await page.addInitScript(({ resume, shared }) => {
    localStorage.setItem('CODE_STREAM_ENABLED', '1');
    localStorage.setItem('CODE_STREAM_RESUME_ENABLED', resume ? '1' : '0');
    localStorage.setItem('AI_SHARED_CORE_ENABLED', shared ? '1' : '0');
    window.showOpenFilePicker = async () => [{
      kind: 'file',
      name: 'stream-fixture.js',
      getFile: async () => new File(['export const fixture = true;'], 'stream-fixture.js', {
        type: 'text/javascript'
      })
    }];

    const nativeFetch = window.fetch.bind(window);
    const mock = {
      calls: [],
      queue: [],
      aborts: 0,
      signals: [],
      resumeCalls: []
    };
    window.__codeStreamMock = mock;
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      if (String(url).includes('/api/code/models')) {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          default_model: 'fixture-model',
          models: [{ id: 'fixture-model', name: 'Fixture model', enabled: true, supports_thinking: true, supported_thinking_modes: ['auto', 'off', 'low', 'medium', 'high'] }]
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (!String(url).includes('/api/code/chat')) return nativeFetch(input, init);

      let requestBody = null;
      try { requestBody = init.body ? JSON.parse(init.body) : null; } catch (_) {}
      const isResume = String(url).includes('/stream/resume');
      mock.calls.push({ url: String(url), body: requestBody });
      if (isResume) mock.resumeCalls.push(String(url));

      const fixture = mock.queue.shift() || {
        type: 'stream',
        body: sse([{ type: 'done', data: { reply: 'default fixture' } }])
      };
      if (init.signal) mock.signals.push(init.signal);

      if (fixture.type === 'pending') {
        return new Promise((resolve, reject) => {
          const onAbort = () => {
            mock.aborts += 1;
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          };
          if (init.signal && init.signal.aborted) return onAbort();
          if (init.signal) init.signal.addEventListener('abort', onAbort, { once: true });
        });
      }

      if (Array.isArray(fixture.streamChunks)) {
        const chunks = fixture.streamChunks.slice();
        const stream = new ReadableStream({
          start(controller) {
            let index = 0;
            const push = () => {
              if (index >= chunks.length) return;
              const chunk = chunks[index++];
              if (chunk.body) controller.enqueue(new TextEncoder().encode(chunk.body));
              if (index < chunks.length) setTimeout(push, chunk.delay || 0);
            };
            push();
          }
        });
        return Promise.resolve(new Response(stream, {
          status: fixture.status || 200,
          headers: { 'content-type': 'text/event-stream' }
        }));
      }

      const contentType = fixture.contentType || 'text/event-stream';
      const body = typeof fixture.body === 'string' ? fixture.body : JSON.stringify(fixture.body);
      return Promise.resolve(new Response(body, {
        status: fixture.status || 200,
        headers: { 'content-type': contentType }
      }));
    };
  }, { resume: options.resume === true, shared: options.shared === true });

  // External font faces are not part of the Code flow and can remain pending
  // in an offline browser, which makes screenshot-based layout assertions
  // hang after the UI itself has already settled.
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (/fonts\.googleapis\.com|fonts\.gstatic\.com|\.(?:woff2?|ttf|otf)(?:\?|$)/i.test(url)) {
      return route.abort();
    }
    return route.continue();
  });

  await page.route('**/api/code/capabilities', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      configured: true,
      agentEnabled: true,
      toolCallingEnabled: true,
      provider: 'fixture',
      model: 'fixture-model'
    })
  }));
  await page.route('**/api/code/models', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      default_model: 'fixture-model',
      models: [{ id: 'fixture-model', name: 'Fixture model', enabled: true, supports_thinking: true, supported_thinking_modes: ['auto', 'off', 'low', 'medium', 'high'] }]
    })
  }));
  await page.route('**/js/code-workspace.min.js*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: codeWorkspaceSource
  }));
  await page.route('**/css/code-workspace.min.css*', (route) => route.fulfill({
    status: 200,
    contentType: 'text/css',
    body: codeWorkspaceCss
  }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-desktop-tab="code"]').click();
  await page.locator('#codeWelcomeFileBtn').click();
  await expect(page.locator('#codeChatInput')).toBeVisible({ timeout: 15000 });
  // The application may install its authenticated wrapper after the module
  // loads. Route the Code request through the deterministic fetch mock before
  // the first user action.
  await page.evaluate(() => {
    window.xtjProtectedFetch = (url, init) => window.fetch(url, init || {});
    // The shell can install its authenticated fetch wrapper before our test
    // wrapper is attached. Seed the already server-shaped fixture so stream
    // cases exercise streaming rather than an unrelated model-loader race.
    const state = window.__xtjCodeWorkspaceAPI.getState();
    state.models = [{ id: 'fixture-model', name: 'Fixture model', enabled: true, supports_thinking: true, supported_thinking_modes: ['auto', 'off', 'low', 'medium', 'high'] }];
    state.selectedModelId = 'fixture-model';
    state.modelLoadError = '';
  });
}

async function enqueue(page, fixture) {
  await page.evaluate((next) => window.__codeStreamMock.queue.push(next), fixture);
}

async function send(page, message) {
  await page.locator('#codeChatInput').fill(message);
  await expect(page.locator('#codeChatSendBtn')).toBeEnabled();
  await page.locator('#codeChatSendBtn').click();
}

async function getSnapshot(page) {
  return page.evaluate(() => {
    const state = window.__xtjCodeWorkspaceAPI.getState();
    return {
      messages: state.messages.map((message) => ({
        role: message.role,
        content: message.content,
        stopped: message.stopped === true,
        errorCode: message.errorCode || ''
      })),
      sending: state.sending,
      pendingOperations: state.pendingOperations,
      calls: window.__codeStreamMock.calls,
      aborts: window.__codeStreamMock.aborts
    };
  });
}

test.describe('Code workspace stream state regressions', () => {
  test('streaming bubble is visibly waiting before the first answer token', async ({ page }) => {
    await openCodeWorkspace(page);
    await enqueue(page, { type: 'pending' });

    await send(page, '等待生成状态');
    await expect(page.locator('.code-chat-message.assistant.streaming')).toHaveCount(1);
    const ui = await page.locator('.code-stream-content').evaluate((content) => ({
      empty: content.textContent.trim() === '',
      placeholder: getComputedStyle(content, '::before').content,
      visible: getComputedStyle(content).display !== 'none'
    }));
    expect(ui.empty).toBe(true);
    expect(ui.placeholder).toContain('等待 AI');
    expect(ui.visible).toBe(true);
    await expect(page.locator('.code-stream-status')).toHaveAttribute('data-state', 'connecting');
    await page.locator('#codeChatCancelBtn').click();
  });

  test('tool failure remains readable in the live tool list', async ({ page }) => {
    await openCodeWorkspace(page);
    await enqueue(page, {
      streamChunks: [{
        body: sse([
          { type: 'tool_start', data: { tool_call_id: 'tool-1', tool: 'read_file', summary: '读取非常长的文件路径/src/example.js' } },
          { type: 'tool_result', data: { tool_call_id: 'tool-1', ok: false, error: '权限不足，无法读取该文件' } }
        ]),
        delay: 0
      }]
    });

    await send(page, '展示工具失败');
    const tool = page.locator('.code-stream-tool-item').first();
    await expect(tool).toBeVisible();
    await expect(tool.locator('.code-stream-tool-name')).toHaveText('read_file');
    await expect(tool.locator('.code-stream-tool-summary')).toContainText('权限不足');
    await expect(tool.locator('.code-stream-tool-state')).toHaveText('失败');
    await expect(tool).toHaveClass(/failed/);
    await expect(page.locator('.code-stream-status')).toHaveAttribute('data-state', 'tool-error');
    await page.locator('#codeChatCancelBtn').click();
  });

  test('SSE answer_delta plus done renders one non-empty assistant and clears sending', async ({ page }) => {
    await openCodeWorkspace(page);
    await enqueue(page, {
      body: sse([
        { type: 'answer_delta', data: { delta: '真实流式回复' } },
        { type: 'done', data: { reply: '' } }
      ])
    });

    await send(page, '流式问题');
    await expect(page.locator('#codeChatMessages')).toContainText('真实流式回复');
    await expect.poll(async () => (await getSnapshot(page)).sending).toBe(false);

    const snapshot = await getSnapshot(page);
    const assistants = snapshot.messages.filter((message) => message.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0].content).toBe('真实流式回复');
    await expect(page.locator('.code-chat-message.assistant.streaming')).toHaveCount(0);
    await expect(page.locator('#codeTypingIndicator')).toHaveCount(0);
  });

  test('done.reply is rendered when no answer_delta was received', async ({ page }) => {
    await openCodeWorkspace(page);
    await enqueue(page, {
      body: sse([{ type: 'done', data: { reply: '只有 done.reply 的回复' } }])
    });

    await send(page, '没有 delta 的问题');
    await expect(page.locator('#codeChatMessages')).toContainText('只有 done.reply 的回复');
    const snapshot = await getSnapshot(page);
    expect(snapshot.messages.filter((message) => message.role === 'assistant')).toEqual([
      expect.objectContaining({ content: '只有 done.reply 的回复' })
    ]);
  });

  test('empty done response renders one retryable assistant error', async ({ page }) => {
    await openCodeWorkspace(page);
    await enqueue(page, {
      body: sse([{ type: 'done', data: { reply: '' } }])
    });

    await send(page, 'empty response fixture');
    await expect(page.locator('.code-chat-message.assistant')).toHaveCount(1);
    await expect(page.locator('.code-chat-message.assistant').first()).toContainText('未返回有效内容');

    const snapshot = await getSnapshot(page);
    expect(snapshot.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    expect(snapshot.messages.find((message) => message.role === 'assistant').errorCode).toBe('EMPTY_RESPONSE');
    expect(snapshot.sending).toBe(false);
  });

  test('unknown stream errors stay out of the visible assistant reply', async ({ page }) => {
    await openCodeWorkspace(page);
    await enqueue(page, {
      body: sse([{
        type: 'error',
        data: { code: 'UNKNOWN', message: 'logPhase is not defined', retryable: true }
      }])
    });

    await send(page, 'unknown error fixture');
    await expect(page.locator('.code-chat-message.assistant')).toHaveCount(1);
    const visible = await page.locator('.code-chat-message.assistant').first().innerText();
    expect(visible).toContain('AI 请求失败');
    await expect(page.locator('.code-stream-error-heading')).toContainText('生成失败');
    await expect(page.locator('.code-stream-status')).toHaveAttribute('data-state', 'error');
    expect(visible).not.toContain('logPhase is not defined');
    expect(visible).not.toContain('[UNKNOWN]');

    const snapshot = await getSnapshot(page);
    expect(snapshot.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    expect(snapshot.messages.find((message) => message.role === 'assistant').errorCode).toBe('UNKNOWN');
    expect(snapshot.sending).toBe(false);
  });

  test('stream ending without done reports STREAM_ENDED_WITHOUT_DONE and keeps a non-empty UI result', async ({ page }) => {
    await openCodeWorkspace(page);
    await enqueue(page, {
      body: sse([{ type: 'answer_delta', data: { delta: '服务端提前结束' } }])
    });

    await send(page, '没有 done 的问题');
    await expect(page.locator('.code-chat-message.assistant').last()).toContainText('响应不完整');
    await expect.poll(async () => (await getSnapshot(page)).sending).toBe(false);
    const snapshot = await getSnapshot(page);
    const assistant = snapshot.messages.find((message) => message.role === 'assistant');
    expect(assistant).toBeTruthy();
    expect(assistant.content).toContain('响应不完整');
    expect(assistant.errorCode).toBe('STREAM_ENDED_WITHOUT_DONE');
    expect(snapshot.sending).toBe(false);
  });

  test('application/json duplicate completed is not parsed as SSE whitespace', async ({ page }) => {
    await openCodeWorkspace(page);
    await enqueue(page, {
      contentType: 'application/json',
      body: {
        ok: true,
        duplicate: true,
        status: 'completed',
        reply: 'duplicate 已完成的最终回复'
      }
    });

    await send(page, '重复完成请求');
    await expect(page.locator('#codeChatMessages')).toContainText('duplicate 已完成的最终回复');
    const snapshot = await getSnapshot(page);
    expect(snapshot.messages.filter((message) => message.role === 'assistant')).toEqual([
      expect.objectContaining({ content: 'duplicate 已完成的最终回复' })
    ]);
  });

  test('application/json duplicate running resumes without creating a blank assistant', async ({ page }) => {
    await openCodeWorkspace(page, { resume: true });
    await enqueue(page, {
      contentType: 'application/json',
      body: {
        ok: true,
        duplicate: true,
        status: 'running',
        stream_id: 'duplicate-running'
      }
    });
    await enqueue(page, {
      contentType: 'application/json',
      body: {
        ok: true,
        status: 'completed',
        events: [{ type: 'done', data: { reply: 'resume 后的回复' } }]
      }
    });

    await send(page, '重复运行请求');
    await expect(page.locator('#codeChatMessages')).toContainText('resume 后的回复');
    const snapshot = await getSnapshot(page);
    expect(snapshot.messages.filter((message) => message.role === 'assistant')).toEqual([
      expect.objectContaining({ content: 'resume 后的回复' })
    ]);
    expect(snapshot.calls.some((call) => call.url.includes('/stream/resume'))).toBe(true);
  });

  for (const status of ['failed', 'cancelled']) {
    test(`resumeStream ${status} produces an explicit terminal state`, async ({ page }) => {
      await openCodeWorkspace(page, { resume: true });
      await enqueue(page, {
        contentType: 'application/json',
        body: {
          ok: true,
          duplicate: true,
          status: 'running',
          stream_id: `resume-${status}`
        }
      });
      await enqueue(page, {
        contentType: 'application/json',
        body: { ok: true, status }
      });

      await send(page, `resume ${status}`);
      await expect.poll(async () => (await getSnapshot(page)).sending).toBe(false);
      const snapshot = await getSnapshot(page);
      expect(snapshot.calls.some((call) => call.url.includes('/stream/resume'))).toBe(true);
      const assistants = snapshot.messages.filter((message) => message.role === 'assistant');
      expect(assistants).toHaveLength(1);
      if (status === 'cancelled') {
        expect(assistants[0].stopped).toBe(true);
        expect(assistants[0].content).toBe('（已停止）');
      } else {
        expect(assistants[0].errorCode).toBe('STREAM_FAILED');
        expect(assistants[0].content.trim()).toBeTruthy();
      }
    });
  }

  test('stop aborts the real request, does not reference timeoutId, and finalizes once', async ({ page }) => {
    await openCodeWorkspace(page);
    await enqueue(page, { type: 'pending' });

    await send(page, '需要停止的问题');
    await expect(page.locator('.code-chat-message.assistant.streaming')).toHaveCount(1);
    await expect.poll(async () => (await getSnapshot(page)).calls.length).toBe(1);
    await page.locator('#codeChatCancelBtn').click();

    await expect.poll(async () => (await getSnapshot(page)).sending).toBe(false);
    const snapshot = await getSnapshot(page);
    expect(snapshot.aborts).toBe(1);
    expect(snapshot.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    expect(snapshot.messages.find((message) => message.role === 'assistant').stopped).toBe(true);
    await expect(page.locator('.code-chat-message.assistant')).toHaveCount(1);
    await expect(page.locator('.code-stream-error:visible')).toHaveCount(0);
    await expect(page.locator('.code-chat-message.assistant.streaming')).toHaveCount(0);
  });

  test('AbortError finalizes once and does not duplicate the stopped assistant', async ({ page }) => {
    await openCodeWorkspace(page);
    await enqueue(page, { type: 'pending' });

    await send(page, 'AbortError 问题');
    await expect.poll(async () => (await getSnapshot(page)).calls.length).toBe(1);
    await page.locator('#codeChatCancelBtn').click();
    await expect.poll(async () => (await getSnapshot(page)).sending).toBe(false);
    await page.waitForTimeout(50);

    const snapshot = await getSnapshot(page);
    const assistants = snapshot.messages.filter((message) => message.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0].stopped).toBe(true);
    expect(assistants.some((message) => message.content === '（已停止）')).toBe(true);
  });

  for (const shared of [false, true]) {
    test(`${shared ? 'shared' : 'local'} controller aborts its own signal without stale cleanup`, async ({ page }) => {
      await openCodeWorkspace(page, { shared });
      await enqueue(page, { type: 'pending' });
      await send(page, `${shared ? 'shared' : 'local'} controller`);
      await expect(page.locator('.code-chat-message.assistant.streaming')).toHaveCount(1);
      await expect.poll(async () => (await getSnapshot(page)).calls.length).toBe(1);

      const beforeCancel = await page.evaluate(() => {
        const state = window.__xtjCodeWorkspaceAPI.getState();
        return {
          hasShared: !!(state.activeRequest && state.activeRequest.sharedCtrl),
          signalAborted: !!(state.activeRequest && state.activeRequest.abortController.signal.aborted)
        };
      });
      expect(beforeCancel.hasShared).toBe(shared);
      expect(beforeCancel.signalAborted).toBe(false);

      await page.locator('#codeChatCancelBtn').click();
      await expect.poll(async () => (await getSnapshot(page)).sending).toBe(false);
      expect((await getSnapshot(page)).aborts).toBe(1);
    });
  }

  test('retry uses the original message once and does not depend on the cleared input', async ({ page }) => {
    await openCodeWorkspace(page);
    await enqueue(page, {
      body: sse([{ type: 'error', data: { code: 'TEMPORARY', message: '暂时失败', retryable: true } }])
    });
    await enqueue(page, {
      body: sse([{ type: 'done', data: { reply: '重试成功' } }])
    });

    await send(page, '原始失败消息');
    const retryButton = page.locator('.code-stream-retry-btn, .code-chat-retry-btn').last();
    await expect(retryButton).toBeVisible();
    await expect.poll(async () => (await getSnapshot(page)).sending).toBe(false);
    await retryButton.dblclick();
    await expect.poll(async () => (await getSnapshot(page)).calls.length).toBe(2);
    await expect(page.locator('#codeChatMessages')).toContainText('重试成功');

    const snapshot = await getSnapshot(page);
    expect(snapshot.calls.filter((call) => call.body && call.body.message === '原始失败消息')).toHaveLength(2);
    expect(snapshot.messages.filter((message) => message.role === 'user' && message.content === '原始失败消息')).toHaveLength(1);
  });

  test('a new done with no operations clears stale pendingOperations and diff UI', async ({ page }) => {
    await openCodeWorkspace(page);
    await enqueue(page, {
      body: sse([{ type: 'done', data: {
        reply: '带操作的回复',
        operations: [{ path: 'stream-fixture.js', type: 'replace', new_content: 'changed' }]
      } }])
    });
    await send(page, '先生成操作');
    await expect.poll(async () => (await getSnapshot(page)).pendingOperations.length).toBe(1);
    await expect.poll(async () => (await getSnapshot(page)).sending).toBe(false);

    await enqueue(page, {
      body: sse([{ type: 'done', data: { reply: '普通回复' } }])
    });
    await send(page, '再问普通问题');
    await expect.poll(async () => (await getSnapshot(page)).sending).toBe(false);

    const snapshot = await getSnapshot(page);
    expect(snapshot.pendingOperations).toEqual([]);
    await expect(page.locator('.code-diff-panel, .code-diff-view')).toHaveCount(0);
  });

  test('operation preview fills the editor column instead of collapsing to its content width', async ({ page }) => {
    await openCodeWorkspace(page);
    await enqueue(page, {
      body: sse([{ type: 'done', data: {
        reply: '已生成修改预览',
        operations: [{
          path: 'stream-fixture.js',
          type: 'replace_range',
          start_line: 1,
          end_line: 1,
          new_content: 'export const fixture = false;'
        }]
      } }])
    });
    await send(page, '请修改文件');
    await expect(page.locator('#codeDiffView')).toBeVisible();
    await expect.poll(async () => page.locator('#codeApplyBar').count()).toBe(1);

    const metrics = await page.evaluate(() => {
      const rect = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      return {
        editorArea: rect('#codeEditorArea'),
        diffView: rect('#codeDiffView'),
        diffBody: rect('.code-diff-body'),
        diffBefore: rect('.code-diff-before'),
        applyBar: rect('#codeApplyBar'),
        panel: rect('#panelCode')
      };
    });
    expect(metrics.diffView.width).toBeGreaterThan(metrics.editorArea.width * 0.95);
    expect(metrics.diffBody.width).toBeGreaterThan(metrics.editorArea.width * 0.95);
    expect(metrics.diffBefore.width).toBeGreaterThan(metrics.editorArea.width * 0.85);
    expect(metrics.applyBar.width).toBeGreaterThan(metrics.editorArea.width * 0.95);
    expect(metrics.applyBar.y + metrics.applyBar.height).toBeLessThanOrEqual(metrics.editorArea.y + metrics.editorArea.height + 1);
    // The geometry assertions above are the regression contract. Avoid making
    // the test depend on Playwright waiting forever for document.fonts.ready
    // when external font requests are unavailable in an offline run.
  });

  test('rapid send/cancel leaves no ghost or blank assistant and keeps DOM/state aligned', async ({ page }) => {
    await openCodeWorkspace(page);
    await enqueue(page, { type: 'pending' });
    await enqueue(page, { body: sse([{ type: 'done', data: { reply: '第二次真实回复' } }]) });

    await send(page, '第一次问题');
    await page.locator('#codeChatCancelBtn').click();
    await expect.poll(async () => (await getSnapshot(page)).sending).toBe(false);
    await send(page, '第二次问题');
    await expect(page.locator('#codeChatMessages')).toContainText('第二次真实回复');

    const snapshot = await getSnapshot(page);
    const domAssistants = await page.locator('.code-chat-message.assistant').evaluateAll((nodes) => nodes.map((node) => ({
      content: node.querySelector('.msg-content, .code-stream-content')?.textContent.trim() || '',
      streaming: node.classList.contains('streaming')
    })));
    const stateAssistants = snapshot.messages.filter((message) => message.role === 'assistant');
    expect(stateAssistants.every((message) => message.content.trim())).toBe(true);
    expect(domAssistants.every((message) => message.content && !message.streaming)).toBe(true);
    expect(stateAssistants).toHaveLength(2);
    expect(snapshot.sending).toBe(false);
  });

  test('DOM and state contain the same single assistant after a completed stream', async ({ page }) => {
    await openCodeWorkspace(page);
    await enqueue(page, {
      body: sse([
        { type: 'answer_delta', data: { delta: 'DOM 与 state 一致' } },
        { type: 'done', data: { reply: '' } }
      ])
    });
    await send(page, '一致性问题');

    await expect(page.locator('#codeChatMessages')).toContainText('DOM 与 state 一致');
    const snapshot = await getSnapshot(page);
    const domContents = await page.locator('.code-chat-message.assistant .msg-content').evaluateAll((nodes) => nodes
      .map((node) => node.textContent.trim())
      .filter(Boolean));
    const stateContents = snapshot.messages
      .filter((message) => message.role === 'assistant')
      .map((message) => message.content.trim());
    expect(stateContents).toEqual(['DOM 与 state 一致']);
    expect(domContents).toContain('DOM 与 state 一致');
    expect(snapshot.sending).toBe(false);
  });
});
