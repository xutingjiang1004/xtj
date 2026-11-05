"use strict";
// 退出后必须复位本地「禁言/封禁」状态：否则同一个被禁言的账号重新登录时，限制状态与上次相同，
// 界面不会重画禁言条与发布框锁定（审计 2026-11-05 profile）。
const test = require("node:test"),
  assert = require("node:assert/strict");
const { postBrowserFixture } = require("./helpers/post-browser-fixture");

test("a muted account that logs out and back in sees the mute bar again", { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ viewport: { width: 1280, height: 800 }, counts: [1] });
  try {
    const { page } = f;
    await page.route("**/api/user/restrictions", (route) =>
      route.fulfill({ json: { ok: true, is_admin: false, restrictions: { is_banned: false, is_blacklisted: false, is_muted: true } } }),
    );
    await page.evaluate(() => checkUserRestrictions());
    await page.waitForSelector("#muteIndicator");

    await page.evaluate(() => window.doLogout());
    await page.waitForFunction(() => window.currentUser === "");
    assert.equal(await page.locator("#muteIndicator").count(), 0, "guest has no mute bar");
    assert.equal(await page.evaluate(() => isUserMuted()), false, "guest is not muted");

    // Same account signs in again; the server answers with the same restriction set.
    await page.evaluate(() => {
      currentUser = "alice";
      window.currentUser = "alice";
      window._xtjAuthState = "authenticated";
    });
    await page.evaluate(() => checkUserRestrictions());
    await page.waitForSelector("#muteIndicator", { timeout: 5000 });
    assert.equal(await page.evaluate(() => isUserMuted()), true);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
