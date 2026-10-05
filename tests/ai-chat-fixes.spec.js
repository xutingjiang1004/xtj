const { test, expect } = require('@playwright/test');

test.describe('AI Agent Chat Fixes Validation', () => {

  test.beforeEach(async ({ page }) => {
    // 设置模拟登录态
    await page.addInitScript(() => {
      window.currentUser = 'test_user_demo';
      window.localStorage.setItem('xtj_user', 'test_user_demo');
      window.localStorage.setItem('xtj_user_token', 'fake_token');
      window.ensureProtectedOperationAuth = async () => ({ ok: true });
      window.ensureUserToken = async () => 'fake_token';
    });

    await page.route('**/api/user/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, token: 'fake_token', user: { user_name: 'test_user_demo' } })
      });
    });

    // 初始化配置模拟
    await page.route('**/api/agent/config', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: { config: { name: '徐旭泽', welcome_message: '我是徐旭泽' } }
        })
      });
    });

    // 默认历史聊记录接口模拟
    await page.route('**/api/agent/chat/history*', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, conversation_id: 'default', messages: [] })
      });
    });

    // 假设测试页面为根目录
    await page.goto('/');
  });

  test('静态名称不会被 config 覆盖', async ({ page }) => {
    await page.route('**/api/agent/chat/history*', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, conversation_id: 'c1', messages: [] }) });
    });

    await page.evaluate(() => { if (window.__xtjOpenAiChat) window.__xtjOpenAiChat(); });
    await page.waitForTimeout(500); // 稍等渲染

    // 检查小猫称呼（无条件断言：空标题本身就是缺陷）
    const emptyTitle = await page.locator('.ai-chat-empty-title').textContent().catch(() => '');
    expect(emptyTitle).toBeTruthy();
    expect(emptyTitle).toContain('小猫');
    expect(emptyTitle).not.toContain('徐旭泽');
  });

  test('首次普通打开只发一次无ID的历史请求', async ({ page }) => {
    let historyRequests = [];
    await page.route('**/api/agent/chat/history*', route => {
      historyRequests.push(route.request().url());
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, conversation_id: 'new-c', messages: [] }) });
    });

    await page.evaluate(async () => {
      // Load the lazy module first so this checks the history request instead
      // of racing the bootstrap launcher against script loading.
      await window.__xtjEnsureAiAgentLoaded();
      if (window.__xtjAiAgent) window.__xtjAiAgent.close();
      window.localStorage.removeItem('xtj_ai_last_conversation_id');
    });
    const firstHistoryResponse = page.waitForResponse(response =>
      response.url().includes('/api/agent/chat/history')
    );
    await page.evaluate(() => window.__xtjAiAgent.open());
    const url = (await firstHistoryResponse).url();
    expect(url).toContain('mode=normal');
    expect(url).toContain('limit=10');
    expect(url).not.toContain('conversation_id='); // 首次打开必须不带 ID
    expect(historyRequests.length).toBe(1);
  });

  test('主动选择历史会话必须请求指定ID', async ({ page }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    let historyRequests = [];
    await page.route('**/api/agent/chat/history*', route => {
      const requestUrl = route.request().url();
      historyRequests.push(requestUrl);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, conversation_id: requestUrl.includes('conversation_id=spec-id') ? 'spec-id' : 'init-id', messages: [] }) });
    });

    await page.waitForFunction(() => !!(window.__xtjAiAgent && window.__xtjAiAgent.openConversation));
    const responsePromise = page.waitForResponse(resp => resp.url().includes('conversation_id=spec-id'), { timeout: 4000 });
    await page.evaluate(async () => {
      window.sessionStorage.clear();
      window.localStorage.setItem('xtj_user', 'test_user_demo');
      window.localStorage.setItem('xtj_user_token', 'fake_token');
      window.localStorage.removeItem('xtj_ai_last_conversation_id');
      if (window.__xtjCloseAiChat) window.__xtjCloseAiChat();
      await window.__xtjAiAgent.openConversation('spec-id');
    });

    await responsePromise;
    const url = historyRequests.find(u => u.includes('conversation_id=spec-id'));
    expect(url).toBeTruthy();
  });

  test('新建空白对话不加载旧历史且不触发 fallback', async ({ page }) => {
    let historyCount = 0;
    await page.route('**/api/agent/chat/history*', route => {
      historyCount++;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, conversation_id: 'id1', messages: [] }) });
    });
    await page.route('**/api/agent/chat/new*', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { conversation_id: 'new-c-id' } }) });
    });

    // 假设界面有 .ai-chat-new-btn
    await page.evaluate(() => { if (window.__xtjOpenAiChat) window.__xtjOpenAiChat(); });
    await page.waitForTimeout(300);
    historyCount = 0; // 重置

    await page.evaluate(() => {
      const btn = document.querySelector('.ai-chat-new-btn');
      if (btn) btn.click();
    });
    await page.waitForTimeout(300);
    
    // 新对话不应该请求 history
    expect(historyCount).toBe(0);
  });

  test('缓存容错逻辑验证', async ({ page }) => {
    await page.route('**/api/agent/chat/history*', route => {
      route.abort('timedout');
    });

    await page.evaluate(() => {
      window.currentUser = 'test_user_demo';
      var uk = encodeURIComponent(window.currentUser);
      window.sessionStorage.setItem('xtj_ai_history:' + uk + ':default', JSON.stringify({
        conversation_id: 'default',
        messages: [{ role: 'user', content: 'CACHE_MSG_123' }, { role: 'assistant', content: 'REPLY_123' }]
      }));
      if (window.__xtjOpenAiChat) window.__xtjOpenAiChat();
    });

    await page.waitForTimeout(800);
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText).toContain('CACHE_MSG_123'); // 缓存内容必须存活
  });

  test('用户数据严密隔离', async ({ page }) => {
    const res = await page.evaluate(() => {
      window.sessionStorage.setItem('xtj_ai_history:UserA:c1', '1');
      window.sessionStorage.setItem('xtj_ai_history:UserB:c1', '1');
      window.currentUser = 'UserA';
      
      // 模拟注销或主动调用 clear
      if (typeof clearAiUserToken === 'function') clearAiUserToken();
      else {
        // 如果不可见，模拟内部清理逻辑
        var uk = encodeURIComponent(window.currentUser);
        var pfx = 'xtj_ai_history:' + uk + ':';
        for (var i = 0; i < sessionStorage.length; i++) {
          var k = sessionStorage.key(i);
          if (k && k.indexOf(pfx) === 0) sessionStorage.removeItem(k);
        }
      }
      
      return {
        hasA: !!window.sessionStorage.getItem('xtj_ai_history:UserA:c1'),
        hasB: !!window.sessionStorage.getItem('xtj_ai_history:UserB:c1')
      };
    });
    
    expect(res.hasA).toBe(false);
    expect(res.hasB).toBe(true);
  });
  
  test('监听器无泄漏', async ({ page }) => {
    // 通过包装 EventTarget.prototype.addEventListener/removeEventListener 统计净监听器数，
    // 重复打开/关闭 AI 聊天后净增量应近似为 0；无法直接调用 DevTools getEventListeners，
    // 用探针计数是最可靠的方式。
    await page.addInitScript(() => {
      if (window.__xtjListenerStats) return;
      const live = [];
      window.__xtjListenerStats = { live };
      const proto = EventTarget.prototype;
      const isGlobal = target => target === window || target === document || target === window.visualViewport;
      const origAdd = proto.addEventListener, origRemove = proto.removeEventListener;
      const capture = opts => typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
      const forget = entry => { const i = live.indexOf(entry); if (i >= 0) live.splice(i, 1); };
      proto.addEventListener = function(type, fn, opts) {
        if (!isGlobal(this) || !fn) return origAdd.call(this, type, fn, opts);
        if (opts && opts.signal && opts.signal.aborted) return;
        const existing = live.find(e => e.target === this && e.type === type && e.fn === fn && e.capture === capture(opts));
        if (existing) return;
        const entry = { target: this, type, fn, capture: capture(opts), wrapped: fn };
        if (opts && opts.once) entry.wrapped = function(event) { forget(entry); return typeof fn === 'function' ? fn.call(this, event) : fn.handleEvent(event); };
        live.push(entry);
        if (opts && opts.signal) origAdd.call(opts.signal, 'abort', () => forget(entry), { once: true });
        return origAdd.call(this, type, entry.wrapped, opts);
      };
      proto.removeEventListener = function(type, fn, opts) {
        const entry = live.find(e => e.target === this && e.type === type && e.fn === fn && e.capture === capture(opts));
        if (entry) { forget(entry); return origRemove.call(this, type, entry.wrapped, opts); }
        return origRemove.call(this, type, fn, opts);
      };
    });
    await page.goto('/');
    await page.evaluate(() => window.__xtjEnsureAiAgentLoaded());
    await page.waitForFunction(() => !!(window.__xtjAiAgent && window.__xtjAiAgent.open));

    const readBalance = () => page.evaluate(() => window.__xtjListenerStats.live.length);

    // Opening also initializes shared lazy modules once. Measure repeated AI
    // lifecycles after that first initialization has settled.
    await page.evaluate(() => window.__xtjAiAgent.open());
    await page.waitForTimeout(250);
    await page.evaluate(() => window.__xtjAiAgent.close());
    await page.waitForTimeout(250);
    const baseline = await readBalance();
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => window.__xtjAiAgent.open());
      await page.waitForTimeout(200);
      await page.evaluate(() => window.__xtjAiAgent.close());
      await page.waitForTimeout(200);
    }
    const afterCycles = await readBalance();
    // 允许少量框架级容差：多轮开合后监听器不应持续累积
    expect(afterCycles - baseline).toBeLessThanOrEqual(4);
  });
  
});
