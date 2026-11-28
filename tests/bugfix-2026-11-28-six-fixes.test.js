'use strict';
// 2026-11-28 六项已复核 Bug 修复的端到端与运行时回归测试：
// 1. 聊天页“发起群聊”图标错位与残留“添加好友”文案；
// 2. 群聊头像上传 / 更换 / 恢复默认（仅走 dm-private 私密桶，严禁 OSS/公开）；
// 3. 帖子锐评 AI 与 @小猫 支持直传 OSS 图片，前端透传服务端报错而非一刀切吞掉；
// 4. 帖子权限设置弹窗改为原生克制表单样式，去除浅绿大边框与渐变按钮；
// 5. 移动端冷启动 / ai-agent.min.css 尚未加载时点击“小猫AI”不与底层页面重叠；
// 6. 私聊与群聊查看后外面仍显示未读（缓存失效、5s 节流放行、manual_unread_at 独立清零、群聊快速返回不丢已读）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const sharp = require('sharp');
const { chromium } = require('playwright');
const { createChatGroupsRouter, GROUP_BUCKET, GROUP_AVATAR_MARKER } = require('../render-api/chat-groups');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
function section(rel, start, end) {
  const s = read(rel);
  const a = s.indexOf(start);
  assert.ok(a >= 0, 'missing start: ' + start);
  const b = s.indexOf(end, a);
  assert.ok(b > a, 'missing end: ' + end);
  return s.slice(a, b);
}

test('Bug 1: 聊天顶栏发起群聊使用多人+号图标且清理误导性添加好友文案', () => {
  const groupsJs = read('js/chat-groups.js');
  const html = read('index.html');
  const createBtnIdx = groupsJs.indexOf("button.id = 'chatGroupCreateButton'");
  assert.ok(createBtnIdx > 0);
  const svgSnippet = groupsJs.slice(createBtnIdx, createBtnIdx + 600);
  const circleCount = (svgSnippet.match(/<circle\b/g) || []).length;
  assert.ok(circleCount >= 2, '发起群聊图标应至少包含双人轮廓（2 个 circle），当前为 ' + circleCount);
  assert.match(svgSnippet, /M19 14v5M16\.5 16\.5h5/, '应保留右下角加号');
  assert.ok(!html.includes('aria-label="联系人与添加好友"'));
  assert.ok(html.includes('aria-label="联系人与好友"'));
  assert.ok(!html.includes('data-chat-social-tab="search" role="tab">添加好友<'));
  assert.ok(html.includes('data-chat-social-tab="search" role="tab">找人聊天<'));
  assert.ok(groupsJs.includes('id="grpGoAddFriend">去找人聊天</button>'));
});

test('Bug 2: 群聊头像接口支持群主/管理员上传与删除，普通成员 403，且仅存 dm-private 私密桶', async () => {
  const gid = '11111111-2222-4333-8444-555555555555';
  const uploaded = [];
  const removed = [];
  const published = [];
  const postRows = [];
  const roles = { alice: 'owner', bob: 'admin', carol: 'member' };

  const supabase = {
    async rpc(name, args) {
      if (name === 'chat_group_list') {
        return { data: { ok: true, groups: [{ id: gid, name: '测试群', member_count: 3 }] } };
      }
      if (name === 'chat_group_detail') {
        const role = roles[args.p_actor];
        if (!role) return { data: { ok: false, code: 'not_member' } };
        return {
          data: {
            ok: true,
            group: { id: gid, name: '测试群', member_count: 3, dissolved: false },
            me: { role },
            members: [{ user_name: 'alice' }, { user_name: 'bob' }, { user_name: 'carol' }]
          }
        };
      }
      return { data: { ok: false, code: 'invalid_action' } };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, GROUP_BUCKET, '群头像必须写入 dm-private 私密桶');
        return {
          async upload(storagePath, buffer, opts) {
            uploaded.push({ bucket, storagePath, size: buffer.length, contentType: opts.contentType });
            return { data: { path: storagePath }, error: null };
          }
        };
      }
    },
    from(table) {
      assert.equal(table, 'posts');
      const state = { eqs: {}, inMap: {} };
      return {
        select() { return this; },
        eq(k, v) { state.eqs[k] = v; return this; },
        in(k, arr) { state.inMap[k] = arr; return this; },
        order() {
          const filtered = postRows.filter(r => {
            if (state.eqs.media_type && r.media_type !== state.eqs.media_type) return false;
            if (state.inMap.actor_key && !state.inMap.actor_key.includes(r.actor_key)) return false;
            return true;
          }).slice().reverse();
          return Promise.resolve({ data: filtered, error: null });
        },
        async insert(rows) {
          for (const r of rows) {
            postRows.push({ ...r, created_at: new Date(Date.now() + postRows.length * 1000).toISOString() });
          }
          return { data: rows, error: null };
        }
      };
    }
  };

  const app = express();
  app.use(express.json());
  app.use('/api/groups', createChatGroupsRouter({
    express,
    supabase,
    sharp,
    authenticateUser: (req, res, next) => { req.userName = req.headers['x-user'] || 'alice'; next(); },
    rateLimit: () => (req, res, next) => next(),
    signPrivate: async p => 'https://signed.private.test/' + p + '?token=ok',
    removePrivate: async paths => { removed.push(...paths); },
    publishMany: (names, topic, payload) => { published.push({ names, topic, payload }); }
  }));

  const pngBuf = await sharp({
    create: { width: 64, height: 32, channels: 4, background: { r: 30, g: 160, b: 120, alpha: 1 } }
  }).png().toBuffer();

  // 普通成员禁止修改群头像
  const denied = await request(app).post('/api/groups/' + gid + '/avatar')
    .set('x-user', 'carol').set('Content-Type', 'image/png').send(pngBuf);
  assert.equal(denied.status, 403);
  assert.equal(uploaded.length, 0);

  // 非法文件内容拒绝
  const invalid = await request(app).post('/api/groups/' + gid + '/avatar')
    .set('x-user', 'alice').set('Content-Type', 'image/png').send(Buffer.from('not-an-image'));
  assert.equal(invalid.status, 400);

  // 群主上传成功：自动裁剪缩放为 JPEG 存入 dm-private，并通过签名 URL 返回
  const up1 = await request(app).post('/api/groups/' + gid + '/avatar')
    .set('x-user', 'alice').set('Content-Type', 'image/png').send(pngBuf);
  assert.equal(up1.status, 200);
  assert.equal(up1.body.ok, true);
  assert.match(up1.body.avatar_url, /^https:\/\/signed\.private\.test\/chat\/grp_avatar_/);
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].contentType, 'image/jpeg');
  assert.equal(postRows[0].media_type, GROUP_AVATAR_MARKER);
  assert.equal(postRows[0].visibility, 'private');
  assert.equal(published.length, 1);
  assert.equal(published[0].payload.kind, 'avatar');

  // 列表和详情均返回签名后的 avatar_url
  const listRes = await request(app).get('/api/groups').set('x-user', 'carol');
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.groups[0].avatar_url, up1.body.avatar_url);
  const detailRes = await request(app).get('/api/groups/' + gid).set('x-user', 'bob');
  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.body.group.avatar_url, up1.body.avatar_url);

  // 管理员可更换头像并回收旧文件
  const up2 = await request(app).post('/api/groups/' + gid + '/avatar')
    .set('x-user', 'bob').set('Content-Type', 'image/png').send(pngBuf);
  assert.equal(up2.status, 200);
  assert.notEqual(up2.body.avatar_url, up1.body.avatar_url);
  assert.equal(removed.length, 1);
  assert.equal(removed[0], uploaded[0].storagePath);

  // 恢复默认头像：写入空 tombstone，列表不再返回旧头像
  const delRes = await request(app).delete('/api/groups/' + gid + '/avatar').set('x-user', 'alice');
  assert.equal(delRes.status, 200);
  assert.equal(delRes.body.avatar_url, null);
  assert.equal(removed.length, 2);
  const afterDel = await request(app).get('/api/groups').set('x-user', 'alice');
  assert.equal(afterDel.body.groups[0].avatar_url, undefined);
});

test('Bug 3: 前端锐评 AI 透传服务端真实报错并在空流时保留兜底提示', { timeout: 30000 }, async t => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--no-sandbox']
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div id="out"></div>');
  const snippet = section('js/core-parts/04-posts-interactions.js', '            function runPostAiRequest(', '            window.openPostAiChat =');
  await page.addScriptTag({
    content: `
      window.capturePostActionIdentity = () => ({ owner: 'alice', epoch: 1 });
      window.postActionIdentityCurrent = () => true;
      ${snippet}
      window.__runPostAiRequest = runPostAiRequest;
    `
  });

  // 场景 A: SSE 返回中文错误 -> 必须透传真实原因
  const sseText = await page.evaluate(async () => {
    const out = document.getElementById('out');
    window.xtjProtectedFetch = async () => new Response('event: error\ndata: {"error":"今日锐评额度已用完，请明天再试","code":"daily_limit"}\n\n', { status: 200 });
    const s = { output: out, controller: new AbortController(), requestId: 0, isClosed: false };
    window.__runPostAiRequest(s, { post_id: 'p1', initial: true });
    await new Promise(r => setTimeout(r, 80));
    return out.textContent;
  });
  assert.equal(sseText, '今日锐评额度已用完，请明天再试');

  // 场景 B: HTTP 429 JSON 错误 -> 透传服务端提示
  const httpText = await page.evaluate(async () => {
    const out = document.getElementById('out');
    window.xtjProtectedFetch = async () => new Response(JSON.stringify({ error: '请求太频繁，请 1 分钟后再试' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    const s = { output: out, controller: new AbortController(), requestId: 0, isClosed: false };
    window.__runPostAiRequest(s, { post_id: 'p1', initial: true });
    await new Promise(r => setTimeout(r, 80));
    return out.textContent;
  });
  assert.equal(httpText, '请求太频繁，请 1 分钟后再试');

  // 场景 C: 空流无错误消息 -> 保留“AI 暂时不可用。”兜底
  const emptyText = await page.evaluate(async () => {
    const out = document.getElementById('out');
    window.xtjProtectedFetch = async () => new Response('', { status: 200 });
    const s = { output: out, controller: new AbortController(), requestId: 0, isClosed: false };
    window.__runPostAiRequest(s, { post_id: 'p1', initial: true });
    await new Promise(r => setTimeout(r, 80));
    return out.textContent;
  });
  assert.equal(emptyText, 'AI 暂时不可用。');
});

test('Bug 4 & Bug 5: 帖子权限弹窗采用克制原生样式；移动端在 ai-agent.min.css 尚未加载时切入小猫AI 不重叠', { timeout: 60000 }, async t => {
  const f = await postBrowserFixture({ counts: [1], viewport: { width: 390, height: 844 }, theme: 'light' });
  t.after(() => f.close());
  const p = f.page;

  // 1) 验证 Bug 4: 权限弹窗精致半透玻璃质感（非薄荷绿、无渐变按钮、带图标徽章）
  const postId = f.posts[0].id;
  await p.evaluate(id => window.openPostVisibilityModal(id), postId);
  await p.locator('#postVisibilityModal .post-vis-dialog').waitFor();
  const modalStyle = await p.evaluate(() => {
    const d = getComputedStyle(document.querySelector('#postVisibilityModal .post-vis-dialog'));
    const save = getComputedStyle(document.querySelector('#postVisibilityModal .post-vis-save'));
    const icons = document.querySelectorAll('#postVisibilityModal .post-vis-icon svg').length;
    return { bg: d.backgroundColor, saveBgImage: save.backgroundImage, icons };
  });
  assert.match(modalStyle.bg, /^rgba?\(255,\s*255,\s*255/, '浅色权限弹窗应为精致白底玻璃，而非薄荷绿');
  assert.equal(modalStyle.saveBgImage, 'none', '保存按钮不应使用 AI 风格渐变背景');
  assert.equal(modalStyle.icons, 4, '4 个权限选项应各自配有矢量图标');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => !document.getElementById('postVisibilityModal'));

  // 2) 验证 Bug 5: 拦截 ai-agent.min.css 与 ai-agent.min.js 模拟冷启动/慢加载，从帖子页点击底部小猫AI
  await p.route('**/css/ai-agent*.css*', r => r.abort());
  await p.route('**/js/ai-agent*.js*', r => new Promise(() => {})); // 保持加载中以观测骨架态
  await p.evaluate(() => {
    // 清理可能被预加载注入的 ai-agent 样式表，模拟冷启动
    document.querySelectorAll('link[href*="ai-agent"]').forEach(el => el.remove());
  });
  await p.locator('.dock-tab[data-tab="ai-chat"]').click();
  await p.waitForFunction(() => {
    const panel = document.getElementById('panelAiChat');
    return panel && !panel.classList.contains('hidden') && panel.classList.contains('active');
  });
  const overlapCheck = await p.evaluate(() => {
    const panel = document.getElementById('panelAiChat');
    const panels = document.getElementById('dockPanels');
    const ps = getComputedStyle(panel);
    const ds = getComputedStyle(panels);
    const rect = panel.getBoundingClientRect();
    return {
      hasBodyOpenClass: document.body.classList.contains('xtj-ai-page-open'),
      inAppContainer: !!panel.closest('.app-container'),
      panelPosition: ps.position,
      panelZIndex: Number(ps.zIndex),
      panelBgColor: ps.backgroundColor,
      panelRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      dockPanelsVisibility: ds.visibility,
      dockPanelsPointerEvents: ds.pointerEvents
    };
  });
  assert.equal(overlapCheck.hasBodyOpenClass, true, '打开骨架屏时 body 应立即加上 xtj-ai-page-open');
  assert.equal(overlapCheck.inAppContainer, true, '#panelAiChat 必须移入 .app-container 与 Dock 同层叠上下文，防止 iOS 盖住底部导航栏');
  assert.equal(overlapCheck.panelPosition, 'fixed', '未加载 ai-agent.min.css 时 #panelAiChat 也必须 fixed 全屏覆盖');
  assert.equal(overlapCheck.panelZIndex, 60, '移动端 #panelAiChat 层级必须低于底部 Dock (100/70)');
  assert.ok(overlapCheck.panelRect.width >= 388 && overlapCheck.panelRect.height >= 800, '骨架屏应铺满视口');
  assert.notEqual(overlapCheck.panelBgColor, 'rgba(0, 0, 0, 0)', '未加载懒加载样式前也应有不透明背景');
  assert.equal(overlapCheck.dockPanelsVisibility, 'hidden', '移动端打开小猫AI 时底层 #dockPanels 必须 hidden，防止页面重叠');
  assert.equal(overlapCheck.dockPanelsPointerEvents, 'none');

  // 切回帖子页后立即恢复底层 #dockPanels 可见
  await p.locator('.dock-tab[data-tab="posts"]').click();
  await p.waitForFunction(() => !document.body.classList.contains('xtj-ai-page-open'));
  const afterBack = await p.evaluate(() => getComputedStyle(document.getElementById('dockPanels')).visibility);
  assert.equal(afterBack, 'visible');
});

test('Bug 6A & 6B: 私聊标已读清共享缓存、绕过 5 秒角标节流，且同时清除 manual_unread_at', { timeout: 30000 }, async t => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--no-sandbox']
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div id="dockChatMessages"></div><div id="dockChatList"><div class="chat-list-item" data-chat-user="bob"><span class="cli-badge">2</span></div></div>');

  const dmReadSection = section('js/core-parts/05-feed-stats.js', '            async function markMessagesRead(', '            function aggregateDmUnread(');
  const sharedSection = section('js/core-parts/05-feed-stats.js', '            var _dmListShared =', '            window.startDMPolling = startDMPolling;');
  const loadMsgSection = section('js/core-parts/06-chat-and-nav.js', '            async function loadDockChatMessages(', '            function renderDockMessages(');

  await page.addScriptTag({
    content: `
      window.currentUser = 'alice';
      window._authStateEpoch = 1;
      window.dockChatActiveUser = 'bob';
      window.currentDockTab = 'chat';
      window._chatHistoryFocus = '';
      window._chatRenderSignature = {};
      window._dockChatMessageLoad = null;
      window._dockChatLoadSeq = 0;
      window._chatCommittedRevision = 0;
      window._chatCache = {};
      window.avatarCache = {};
      window._chatPagination = {};
      window._dmUnreadFetchedAt = 0;
      window._dockChatConversationStates = { bob: { peer_name: 'bob', unread_count: 2, manual_unread_at: '2026-11-28T00:00:00Z' } };
      window.badgeCounts = [];
      window.fetchLog = [];
      window.refreshCount = 0;
      window.setUnreadBadgeCount = n => window.badgeCounts.push(n);
      window.observeDmSnapshot = () => {};
      window.aggregateDmUnread = () => ({ total: 0, bySender: {} });
      window.getDockChatCacheKey = peer => 'alice:' + peer;
      window.reconcileDockChatMessage = (m, a) => Object.assign({}, m, a);
      window.getDMMessageReadAt = m => m && m.read_at;
      window.readAvatarCacheFromStorage = () => ({});
      window.hydrateDockChatAvatars = () => {};
      window.patchDockChatMessageAvatars = () => {};
      window.renderDockMessages = () => {};
      window.mergeDockChatMessages = (_p, rows) => rows;
      window.mergeDockChatRowsById = rows => rows;
      window.isDmMessageLocallyDeleted = () => false;
      window.syncDockChatHistoryButton = () => {};
      window.refreshDockChatHistoryWindow = () => {};
      window.scheduleDockChatListRefresh = () => { window.refreshCount++; };
      ${sharedSection}
      ${dmReadSection}
      ${loadMsgSection}
      window.__loadDockChatMessages = loadDockChatMessages;
    `
  });

  const res = await page.evaluate(async () => {
    let serverUnread = 2;
    window.xtjProtectedFetch = async (url, opts) => {
      window.fetchLog.push({ url, method: (opts && opts.method) || 'GET', body: opts && opts.body });
      if (url.startsWith('/api/dm/list')) {
        return new Response(JSON.stringify({ ok: true, data: [], conversations: [{ peer_name: 'bob', unread_count: serverUnread }] }));
      }
      if (url.startsWith('/api/dm/messages')) {
        return new Response(JSON.stringify({ ok: true, data: [{ id: 'm1', user_name: 'bob', media_url: 'alice', content: 'hi', read_at: null }] }));
      }
      if (url === '/api/dm/read') {
        serverUnread = 0;
        return new Response(JSON.stringify({ ok: true, data: [{ id: 'm1', read_at: '2026-11-28T01:00:00Z' }] }));
      }
      if (url.startsWith('/api/chat/social/conversations/bob')) {
        serverUnread = 0;
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify({ ok: true }));
    };

    // 先触发一次角标刷新，填满 3 秒共享缓存与 5 秒节流窗口
    await window.updateUnreadBadge();
    const beforeBadge = window.badgeCounts[window.badgeCounts.length - 1];
    // 紧接着（< 100ms，仍在 3s 缓存 + 5s 节流期内）打开含未读消息且带 manual_unread_at 的会话
    await window.__loadDockChatMessages('bob', true);
    await new Promise(r => setTimeout(r, 120));
    return {
      beforeBadge,
      afterBadge: window.badgeCounts[window.badgeCounts.length - 1],
      dmListCalls: window.fetchLog.filter(x => x.url.startsWith('/api/dm/list')).length,
      dmReadCalls: window.fetchLog.filter(x => x.url === '/api/dm/read').length,
      convMarkReadCalls: window.fetchLog.filter(x => x.url.includes('/api/chat/social/conversations/bob') && x.method === 'PATCH').length,
      manualUnreadLeft: window._dockChatConversationStates.bob.manual_unread_at
    };
  });

  assert.equal(res.beforeBadge, 2);
  assert.equal(res.dmReadCalls, 1, '应调用 /api/dm/read 标已读');
  assert.equal(res.convMarkReadCalls, 1, '即使有未读消息，也必须独立调用 PATCH mark_read 清除 manual_unread_at');
  assert.equal(res.manualUnreadLeft, null);
  assert.equal(res.dmListCalls, 2, '标已读后必须失效 3s 缓存并绕过 5s 节流重拉最新列表');
  assert.equal(res.afterBadge, 0, '外面未读角标必须立即清零');
});

test('Bug 6C: 群聊进入含未读会话并在 50ms 内快速返回，服务端仍立即收到 mark_read', { timeout: 30000 }, async t => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
    args: ['--no-sandbox']
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`
    <div id="panelChat" class="dock-panel active">
      <div id="dockChatContainer">
        <div class="chat-header"><button id="dockChatSocialBtn"></button></div>
        <div id="dockChatListView"><div class="chat-list-tools"></div><div id="dockChatList"></div></div>
        <div id="dockChatDetailView"></div>
      </div>
    </div>
  `);
  const gid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  await page.evaluate(groupId => {
    window.currentUser = 'alice';
    window._authStateEpoch = 1;
    window.groupUnreadReports = [];
    window.groupRequests = [];
    window.__xtjSetGroupUnread = n => window.groupUnreadReports.push(n);
    window.xtjProtectedFetch = async (url, opts) => {
      window.groupRequests.push({ url, method: (opts && opts.method) || 'GET', body: opts && opts.body });
      if (url === '/api/groups') {
        return new Response(JSON.stringify({ ok: true, groups: [{ id: groupId, name: '测试群', member_count: 2, unread: 3 }] }));
      }
      if (url === '/api/groups/' + groupId) {
        return new Response(JSON.stringify({ ok: true, group: { id: groupId, name: '测试群', member_count: 2 }, me: { role: 'owner' }, members: [] }));
      }
      if (url.includes('/messages')) {
        return new Response(JSON.stringify({ ok: true, messages: [], has_more: false }));
      }
      if (url.endsWith('/actions')) {
        return new Response(JSON.stringify({ ok: true }));
      }
      return new Response(JSON.stringify({ ok: true }));
    };
  }, gid);
  await page.addScriptTag({ path: path.join(root, 'js', 'chat-groups.js') });
  await page.waitForSelector('#dockGroupList [data-group-id]');

  const result = await page.evaluate(async groupId => {
    window.__xtjChatGroups.open(groupId);
    // 仅停留 50ms（远小于旧的 400ms 延迟）即返回会话列表
    await new Promise(r => setTimeout(r, 50));
    window.__xtjChatGroups.close(true);
    await new Promise(r => setTimeout(r, 80));
    const markReads = window.groupRequests.filter(r => r.url.endsWith('/actions') && String(r.body || '').includes('"mark_read"'));
    const rowBadge = document.querySelector('#dockGroupList .cli-badge');
    return {
      markReadCount: markReads.length,
      lastUnreadTotal: window.groupUnreadReports[window.groupUnreadReports.length - 1],
      hasRowBadge: !!rowBadge
    };
  }, gid);

  assert.ok(result.markReadCount >= 1, '50ms 快速返回也必须已向服务端发送 mark_read');
  assert.equal(result.lastUnreadTotal, 0, '群聊总未读应立即归零');
  assert.equal(result.hasRowBadge, false, '列表行未读红点应立即消失');
});
