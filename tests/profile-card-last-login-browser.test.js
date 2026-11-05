"use strict";
// 自己的资料卡「最近登录」必须取服务端 /api/user/profile，而不是匿名密钥直读 __user_info__
// （RLS 035/055 之后匿名读取恒为空，界面永远显示「最近登录：-」）。
const test = require("node:test"),
  assert = require("node:assert/strict");
const { postBrowserFixture } = require("./helpers/post-browser-fixture");

test("own profile card shows the authoritative last login time", { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ viewport: { width: 1280, height: 800 }, counts: [1] });
  try {
    const lastLogin = "2026-11-04T10:30:00.000Z";
    await f.page.route("**/api/user/profile", (route) =>
      route.fulfill({
        json: { ok: true, user_name: "alice", registered_at: "2026-01-01T00:00:00.000Z", info: { last_login: lastLogin } },
      }),
    );
    await f.page.evaluate(() => window.openUserProfile("alice"));
    await f.page.waitForFunction(() => !/加载中/.test(document.getElementById("upcLogin").textContent));
    const text = await f.page.locator("#upcLogin").textContent();
    const expected = await f.page.evaluate((iso) => "最近登录：" + new Date(iso).toLocaleString(), lastLogin);
    assert.equal(text, expected);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("another user's profile card keeps the placeholder and never reads the owner snapshot", { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ viewport: { width: 1280, height: 800 }, counts: [1] });
  try {
    let profileCalls = 0;
    await f.page.route("**/api/user/profile", (route) => {
      profileCalls++;
      return route.fulfill({ json: { ok: true, user_name: "alice", info: { last_login: "2026-11-04T10:30:00.000Z" } } });
    });
    await f.page.waitForTimeout(500);
    profileCalls = 0;
    await f.page.evaluate(() => window.openUserProfile("bob"));
    await f.page.waitForFunction(() => !/加载中/.test(document.getElementById("upcLogin").textContent));
    assert.equal(await f.page.locator("#upcLogin").textContent(), "最近登录：-");
    assert.equal(profileCalls, 0);
  } finally { await f.close(); }
});
