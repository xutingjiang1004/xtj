"use strict";
// 退出 / 会话失效后不能残留上一个账号的资料快照与聊天渲染态（审计 2026-11-05 profile）。
const test = require("node:test"),
  assert = require("node:assert/strict");
const { postBrowserFixture } = require("./helpers/post-browser-fixture");

async function seedResidue(page) {
  await page.evaluate(() => {
    window.currentUserInfoSnapshot = { email: "alice@example.com", ip_region_text: "浙江杭州" };
    const messages = document.getElementById("dockChatMessages");
    messages.dataset.chatUser = "bob";
    messages.innerHTML = '<div class="chat-msg-row" id="residueBubble">来自 bob 的私聊内容</div>';
    _chatCache = { bob: [{ id: "m1", content: "secret" }] };
  });
}
async function residue(page) {
  return page.evaluate(() => ({
    snapshot: window.currentUserInfoSnapshot,
    bubble: !!document.getElementById("residueBubble"),
    chatUser: document.getElementById("dockChatMessages").dataset.chatUser || "",
    cache: Object.keys(_chatCache || {}).length,
    user: window.currentUser,
  }));
}

test("another tab logging out clears the previous account's snapshot and chat panel", { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ viewport: { width: 1280, height: 800 }, counts: [1] });
  try {
    await seedResidue(f.page);
    await f.page.evaluate(() => {
      const other = new BroadcastChannel("xtj_auth_sync");
      other.postMessage({ type: "logout", eventId: "evt_other_tab_1", sourceTabId: "tab_other", reason: "manual" });
      other.close();
    });
    await f.page.waitForFunction(() => window.currentUser === "");
    const state = await residue(f.page);
    assert.equal(state.snapshot, null, "资料快照（邮箱/属地）必须清空");
    assert.equal(state.bubble, false, "旧账号聊天气泡必须清空");
    assert.equal(state.chatUser, "");
    assert.equal(state.cache, 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("an expired session clears the previous account's snapshot and chat panel", { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ viewport: { width: 1280, height: 800 }, counts: [1] });
  try {
    await seedResidue(f.page);
    await f.page.evaluate(() => window.handleProtectedAuthFailure({ background: true }));
    await f.page.waitForFunction(() => window.currentUser === "");
    const state = await residue(f.page);
    assert.equal(state.snapshot, null);
    assert.equal(state.bubble, false);
    assert.equal(state.cache, 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
