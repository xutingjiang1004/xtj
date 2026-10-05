"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  postBrowserFixture,
  wireAiChat,
} = require("./helpers/post-browser-fixture");
const { DEFAULTS } = require("../render-api/profile-settings");
async function preferences(f, initial = {}) {
  const settings = { ...DEFAULTS, signature: "账号中的签名", ...initial },
    patches = [],
    images = [];
  await f.page.route("**/api/profile/settings**", async (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      const patch = request.postDataJSON();
      patches.push(patch);
      Object.assign(settings, patch);
    }
    if (request.method() === "POST") {
      const kind = new URL(request.url()).searchParams.get("kind");
      images.push({ kind, body: request.postDataBuffer() });
      settings[kind + "_url"] = f.origin + "/test-image/new-" + kind + "-1.png";
    }
    await route.fulfill({ json: { ok: true, settings } });
  });
  await f.page.evaluate(() => {
    switchDockTab("profile", true);
    return __xtjReloadProfileSettings();
  });
  await f.page.waitForFunction(
    () =>
      document.getElementById("profilePreferences").dataset.syncState ===
      "synced",
  );
  return { settings, patches, images };
}
async function synced(page) {
  await page.waitForFunction(
    () =>
      document.getElementById("profilePreferences").dataset.syncState ===
      "synced",
  );
}
for (const [width, height, theme] of [[1280, 800, "light"], [1920, 900, "dark"], [1024, 600, "light"]])
  test(`${width}px: personal settings scroll down and back up with the mouse wheel`, { timeout: 45000 }, async () => {
    const f = await postBrowserFixture({ viewport: { width, height }, theme, counts: [1] });
    try {
      const { page } = f;
      await preferences(f, { theme });
      await page.evaluate(() => XTJModuleLoader.load("enhancements"));
      await page.waitForSelector("#xtjClearCacheBtn");
      await page.waitForTimeout(400);
      const panel = page.locator("#panelProfile");
      assert.equal(await panel.evaluate(n => getComputedStyle(n).overflowY), "auto");
      const sidebarBefore = await page.locator("#desktopWorkbenchSidebar").boundingBox();
      const box = await panel.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 2500);
      await page.waitForFunction(() => {
        const n = document.getElementById("panelProfile");
        return n.scrollTop > 100 && n.scrollTop + n.clientHeight >= n.scrollHeight - 2;
      });
      assert.equal(await page.locator("#xtjClearCacheBtn").evaluate(n => {
        const r = n.getBoundingClientRect(), p = document.getElementById("panelProfile").getBoundingClientRect();
        return r.top >= p.top && r.bottom <= p.bottom;
      }), true, "last general setting is reached by wheel scrolling");
      await page.mouse.wheel(0, -2500);
      await page.waitForFunction(() => document.getElementById("panelProfile").scrollTop === 0);
      assert.deepEqual(await page.locator("#desktopWorkbenchSidebar").boundingBox(), sidebarBefore);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
test("actual AI page stays in the content column at tablet, desktop and centered wide-screen widths", { timeout: 60000 }, async () => {
  for (const width of [834, 1280, 1920]) {
    const f = await postBrowserFixture({ viewport: { width, height: 880 }, theme: "dark", counts: [1] });
    try {
      await wireAiChat(f.page);
      await f.page.waitForTimeout(350);
      const bounds = await f.page.evaluate(() => {
        const rect = id => document.getElementById(id).getBoundingClientRect().toJSON();
        return { sidebar: rect("desktopWorkbenchSidebar"), content: rect("dockPanels"), ai: rect("panelAiChat") };
      });
      assert.ok(bounds.ai.left >= bounds.sidebar.right - 1, JSON.stringify(bounds));
      for (const edge of ["left", "right", "top", "bottom"]) assert.ok(Math.abs(bounds.ai[edge] - bounds.content[edge]) <= 1, edge + ": " + JSON.stringify(bounds));
      await f.page.locator('#aiChatMsgInput').fill("侧栏之外正常输入");
      await f.page.locator('.desktop-nav-item[data-desktop-tab="posts"]').click();
      assert.ok(await f.page.locator("#panelPosts").isVisible());
      assert.equal(await f.page.locator("#panelAiChat").isVisible(), false);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  }
});
for (const width of [390, 1280])
  test(
    width +
      "px: personal settings share one column, have no appearance block, and apply every privacy choice automatically",
    { timeout: 45000 },
    async () => {
      const f = await postBrowserFixture({
        viewport: { width, height: 880 },
        counts: [3],
      });
      try {
        const { page } = f,
          p = await preferences(f);
        assert.equal(
          await page.getByText("外观与个性化", { exact: true }).count(),
          0,
        );
        assert.equal(
          await page.getByText("个人资料与背景", { exact: true }).count(),
          0,
        );
        assert.equal(
          await page
            .getByRole("button", { name: "保存设置", exact: true })
            .count(),
          0,
        );
        assert.equal(
          await page.locator("#profileOwnCover img:visible").count(),
          0,
        );
        const boxes = await page
          .locator("#profileUserCard,.profile-activity-board,.profile-settings")
          .evaluateAll((nodes) =>
            nodes.map((n) => {
              const r = n.getBoundingClientRect();
              return { x: r.x, width: r.width };
            }),
          );
        assert.ok(
          boxes.every(
            (r) =>
              Math.abs(r.x - boxes[0].x) < 1 &&
              Math.abs(r.width - boxes[0].width) < 1,
          ),
          JSON.stringify(boxes),
        );
        for (const name of [
          "timeline_visible",
          "guests_allowed",
          "notification_preview",
          "message_notifications",
        ]) {
          await page
            .locator("[name=" + name + "]")
            .locator("..")
            .click();
          await synced(page);
          assert.equal(p.settings[name], false);
          await page
            .locator("[name=" + name + "]")
            .locator("..")
            .click();
          await synced(page);
          assert.equal(p.settings[name], true);
        }
        for (const value of ["3d", "1m", "6m", "all"]) {
          await page.locator("[name=timeline_range]").selectOption(value);
          await synced(page);
          assert.equal(p.settings.timeline_range, value);
        }
        await page.locator("[name=default_visibility]").selectOption("private");
        await synced(page);
        assert.equal(p.settings.default_visibility, "private");
        assert.equal(
          await page.locator("#postVisibility").inputValue(),
          "private",
        );
        await page.locator("[name=signature]").fill("新的个性签名");
        await page.locator("[name=signature]").blur();
        await synced(page);
        assert.equal(p.settings.signature, "新的个性签名");
        await page.evaluate(() => XTJModuleLoader.load("enhancements"));
        await page.waitForSelector("#xtjClearCacheBtn");
        assert.equal(
          await page
            .locator("#xtjFontScale,#xtjMotionMode,#profileThemeToggle")
            .count(),
          0,
        );
        await page.evaluate(() =>
          localStorage.setItem("xtj_test_cache", "stale"),
        );
        await page.locator("#xtjClearCacheBtn").click();
        assert.equal(
          await page.evaluate(() => localStorage.getItem("xtj_test_cache")),
          null,
        );
        assert.equal(await page.evaluate(() => currentUser), "alice");
        const exported = [];
        await page.route("**/api/user/export**", (r) => {
          exported.push(new URL(r.request().url()).searchParams.get("kind"));
          return r.fulfill({
            json: {
              ok: true,
              items: [],
              snapshot: "2026-10-05T00:00:00Z",
              has_more: false,
              account: { user_name: "alice" },
            },
          });
        });
        const download = page.waitForEvent("download");
        await page.locator("#xtjExportDataBtn").click();
        assert.match((await download).suggestedFilename(), /xtj-export-alice/);
        assert.equal(exported.length, 12);
        assert.equal(
          await page
            .locator("#panelProfile")
            .evaluate((n) => n.scrollWidth > n.clientWidth),
          false,
        );
        assert.deepEqual(f.errors, []);
      } finally {
        await f.close();
      }
    },
  );
for (const width of [390, 1280])
  test(
    width +
      "px: click background photos to replace or remove them; public timeline images stay at the left",
    { timeout: 45000 },
    async () => {
      const f = await postBrowserFixture({
        viewport: { width, height: 880 },
        counts: [1, 3],
      });
      try {
        const { page } = f,
          p = await preferences(f);
        for (const kind of ["cover", "background"]) {
          await page.locator("[data-image-kind=" + kind + "]").click();
          assert.ok(await page.locator("#profileImageMenu").isVisible());
          const chooser = page.waitForEvent("filechooser");
          await page.locator("[data-profile-image-action=choose]").click();
          await (
            await chooser
          ).setFiles({
            name: kind + ".png",
            mimeType: "image/png",
            buffer: f.png,
          });
          await synced(page);
          assert.equal(p.images.at(-1).kind, kind);
          assert.deepEqual(p.images.at(-1).body, f.png);
          await page.waitForFunction(
            (kind) =>
              !document.querySelector("[data-image-kind=" + kind + "] img")
                .hidden,
            kind,
          );
        }
        assert.equal(
          await page
            .locator("html")
            .evaluate((n) => n.classList.contains("profile-custom-background")),
          true,
        );
        await page.route("**/api/profile/posts/**", (route) =>
          route.fulfill({
            json: {
              ok: true,
              profile: p.settings,
              posts: f.posts.map((post) => ({ ...post, content: "" })),
              has_more: false,
            },
          }),
        );
        await page.evaluate(() => switchDockTab("posts", true));
        await page.locator("#feed .post .avatar").first().click();
        await page.waitForSelector(".author-post-row");
        assert.equal(
          await page.locator("#authorPostsCover img").getAttribute("src"),
          p.settings.cover_url,
        );
        for (const entry of await page.locator(".author-post-entry").all()) {
          const boxes = await entry.evaluate((n) => ({
            entry: n.getBoundingClientRect().x,
            image: n.querySelector("img").getBoundingClientRect().x,
          }));
          assert.ok(
            Math.abs(boxes.entry - boxes.image) < 1,
            JSON.stringify(boxes),
          );
        }
        assert.equal(await page.locator(".author-post-desc").count(), 0);
        await page.evaluate(() => closeModal("userProfileModal"));
        await page.evaluate(() => switchDockTab("profile", true));
        await synced(page);
        for (const kind of ["cover", "background"]) {
          await page.locator("[data-image-kind=" + kind + "] img").click();
          await page.locator("[data-profile-image-action=clear]").click();
          await synced(page);
          assert.equal(p.settings[kind + "_url"], "");
        }
        assert.equal(
          await page
            .locator("html")
            .evaluate((n) => n.classList.contains("profile-custom-background")),
          false,
        );
        assert.deepEqual(f.errors, []);
      } finally {
        await f.close();
      }
    },
  );
test(
  "automatic saves retain rapid choices across a slow request and let users retry failures",
  { timeout: 45000 },
  async () => {
    const f = await postBrowserFixture({ counts: [1] });
    let release;
    try {
      const { page } = f,
        p = await preferences(f);
      let fail = true;
      const patches = [];
      const hold = new Promise((r) => (release = r));
      await page.route("**/api/profile/settings", async (route) => {
        if (route.request().method() !== "PATCH")
          return route.fulfill({ json: { ok: true, settings: p.settings } });
        const patch = route.request().postDataJSON();
        patches.push(patch);
        if (fail)
          return route.fulfill({
            status: 503,
            json: { ok: false, error: "暂未同步，请重试" },
          });
        if (patch.default_visibility === "private") await hold;
        Object.assign(p.settings, patch);
        await route.fulfill({ json: { ok: true, settings: p.settings } });
      });
      await page.locator("[name=notification_preview]").locator("..").click();
      await page.waitForFunction(
        () => profilePreferences.dataset.syncState === "error",
      );
      assert.equal(
        await page.locator("[name=notification_preview]").isEnabled(),
        true,
      );
      assert.equal(
        await page.locator("[name=notification_preview]").isChecked(),
        false,
      );
      await page.evaluate(() =>
        showNotification("bob", "不应出现在通知里的内容"),
      );
      assert.equal(
        await page.locator(".notification-text").last().textContent(),
        "收到一条新消息",
      );
      fail = false;
      await page.locator("#profileSettingsRetry").click();
      await synced(page);
      assert.equal(p.settings.notification_preview, false);
      await page.locator("[name=default_visibility]").selectOption("private");
      await page.waitForFunction(
        () => profilePreferences.dataset.syncState === "saving",
      );
      await page.locator("[name=default_visibility]").selectOption("public");
      assert.equal(
        await page.locator("#postVisibility").inputValue(),
        "public",
      );
      release();
      await synced(page);
      assert.equal(p.settings.default_visibility, "public");
      assert.deepEqual(patches.slice(-2), [
        { default_visibility: "private" },
        { default_visibility: "public" },
      ]);
      await page.locator("[name=message_notifications]").locator("..").click();
      await synced(page);
      await page.evaluate(() => showNotification("bob", "不应弹出的消息"));
      assert.equal(await page.locator(".notification-bubble").count(), 0);
      assert.deepEqual(f.errors, []);
    } finally {
      if (release) release();
      await f.close();
    }
  },
);
test(
  "late reads and writes cannot apply account A preferences or pending operations to account B",
  { timeout: 45000 },
  async () => {
    const f = await postBrowserFixture({ counts: [1] });
    let release;
    try {
      const { page } = f;
      await preferences(f);
      const hold = new Promise((r) => (release = r));
      await page.route("**/api/profile/settings", async (route) => {
        if (route.request().method() === "PATCH") {
          await hold;
          return route.fulfill({
            json: {
              ok: true,
              settings: {
                ...DEFAULTS,
                signature: "旧账号的签名",
                default_visibility: "private",
              },
            },
          });
        }
        return route.fulfill({
          json: {
            ok: true,
            settings: { ...DEFAULTS, signature: "新账号的签名" },
          },
        });
      });
      await page.locator("[name=default_visibility]").selectOption("private");
      await page.waitForFunction(
        () => profilePreferences.dataset.syncState === "saving",
      );
      await page.evaluate(() => {
        window.__xtjBeginAuthIdentityChange();
        currentUser = "bob";
        window.currentUser = "bob";
        safeStorage.set("xtj_user", "bob");
        setUserToken("bob-test-token", "bob");
      });
      await synced(page);
      release();
      await page.waitForTimeout(100);
      assert.equal(
        await page.locator("#profileOwnSignature").textContent(),
        "新账号的签名",
      );
      assert.equal(
        await page.locator("[name=default_visibility]").inputValue(),
        "public",
      );
      assert.equal(
        await page.evaluate(() => __xtjProfileMessagePreferences.owner),
        "bob",
      );
      assert.deepEqual(f.errors, []);
    } finally {
      if (release) release();
      await f.close();
    }
  },
);
test(
  "blacklist in personal privacy opens the existing real block management and can unblock",
  { timeout: 45000 },
  async () => {
    const f = await postBrowserFixture({ counts: [1] });
    try {
      const { page } = f;
      await preferences(f);
      let blocked = true;
      await page.route("**/api/chat/blocks**", (route) => {
        if (route.request().method() === "DELETE") blocked = false;
        return route.fulfill({
          json: { ok: true, blocks: blocked ? [{ peer_name: "bob" }] : [] },
        });
      });
      await page.locator("#profileBlocksButton").click();
      await page.waitForFunction(
        () =>
          document
            .querySelector("[data-chat-social-tab=blocks]")
            .getAttribute("aria-selected") === "true",
      );
      await page.waitForSelector("[data-chat-social-action=block-remove]");
      await page.locator("[data-chat-social-action=block-remove]").click();
      await page.waitForFunction(
        () => !document.querySelector("[data-chat-social-action=block-remove]"),
      );
      assert.equal(blocked, false);
      assert.deepEqual(f.errors, []);
    } finally {
      await f.close();
    }
  },
);
for (const height of [880, 380])
  test(
    "iPad boot at " +
      height +
      "px: keyboard never exposes mobile navigation or switches research pages",
    { timeout: 45000 },
    async () => {
      const f = await postBrowserFixture({
        viewport: { width: 1280, height },
        ios: "ipad-desktop",
        engine: process.env.XTJ_PROFILE_WEBKIT === "1" ? "webkit" : "chromium",
        counts: [1],
      });
      try {
        const { page } = f;
        await wireAiChat(page);
        assert.equal(await page.locator("#dockBar").isVisible(), false);
        await page.locator("#aiChatMsgInput").fill("普通聊天");
        await page.setViewportSize({ width: 1280, height: 300 });
        await page.evaluate(() => {
          testKeyboardViewport.height = 280;
          testKeyboardViewport.dispatchEvent(new Event("resize"));
        });
        await page.waitForTimeout(80);
        assert.equal(await page.locator("#dockBar").isVisible(), false);
        assert.equal(
          await page.locator("#desktopWorkbenchSidebar").isVisible(),
          true,
        );
        await page.evaluate(() => __xtjAiAgent.openDeepThink());
        await page.locator("#dtInput").fill("新的研究问题");
        assert.equal(
          await page
            .locator("#panelAiChat")
            .evaluate((n) => getComputedStyle(n).visibility),
          "hidden",
        );
        assert.equal(
          await page.evaluate(
            () =>
              document.elementFromPoint(600, 160).closest("#panelDeepThink")
                ?.id,
          ),
          "panelDeepThink",
        );
        assert.equal(await page.locator("#dockBar").isVisible(), false);
        await page.locator("#dtInput").blur();
        await page.setViewportSize({ width: 1280, height: 880 });
        await page.evaluate(() => {
          testKeyboardViewport.height = 880;
          testKeyboardViewport.dispatchEvent(new Event("resize"));
        });
        await page.waitForTimeout(100);
        assert.ok(await page.locator("#panelDeepThink").isVisible());
        assert.equal(
          await page.locator("#dtInput").inputValue(),
          "新的研究问题",
        );
        await page.locator("#dtBackBtn").click();
        assert.ok(await page.locator("#panelAiChat").isVisible());
        assert.equal(await page.locator("#dockBar").isVisible(), false);
        assert.deepEqual(f.errors, []);
      } finally {
        await f.close();
      }
    },
  );

test(
  "phone: real conversation clicks slide in from the right, return slides out and rapid reopen keeps the new contact",
  { timeout: 45000 },
  async () => {
      const messages = ["bob", "carol"].map((name, i) => ({
        id: "44444444-4444-4444-8444-00000000000" + i,
        user_name: name,
        media_url: "alice",
        media_type: "__dm__",
        content: name + " 的消息",
        created_at: "2026-10-05T04:00:00Z",
      }));
    const f = await postBrowserFixture({ counts: [1], dmMessages: messages });
    try {
      const { page } = f;
      await page.route("**/api/dm/list**", (r) =>
        r.fulfill({ json: { ok: true, data: messages, muted_peers: [] } }),
      );
      await page.route("**/api/dm/messages**", (r) => {
        const peer = new URL(r.request().url()).searchParams.get("target");
        return r.fulfill({
          json: {
            ok: true,
            data: messages.filter((m) => m.user_name === peer),
          },
        });
      });
      await page.route("**/api/chat/relationship**", (r) =>
        r.fulfill({
          json: {
            ok: true,
            relationship: { status: "friends", can_message: true },
          },
        }),
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.evaluate(async () => {
        document.documentElement.dataset.xtjMotion = "system";
        dockChatListCacheTime = 0;
        if (window.__xtjInvalidateDmListShared) window.__xtjInvalidateDmListShared();
        await window.fetchDmListShared(180, { background: false });
        dockChatListCacheTime = 0;
        switchDockTab("chat", true);
      });
      await page.waitForSelector(".chat-list-item[data-chat-user=bob]");
      await page.evaluate(() => {
        window.testRouteFrames = [];
        const base = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const a = base.apply(this, args);
          if (this.id === "dockChatDetailView") {
            testRouteFrames.push({
              frames: a.effect.getKeyframes(),
              start: performance.now(),
            });
          }
          return a;
        };
      });
      await page.locator(".chat-list-item[data-chat-user=bob]").click();
      await page.waitForFunction(() => testRouteFrames.length === 1);
      assert.match(
        await page.evaluate(() => testRouteFrames[0].frames[0].transform),
        /100%/,
      );
      await page.waitForFunction(
        () =>
          !document.getElementById("dockChatDetailView").getAnimations().length,
      );
      assert.equal(await page.locator("#dockChatTitle").textContent(), "bob");
      assert.ok(
        await page
          .locator("#dockChatMessages")
          .getByText("bob 的消息", { exact: true })
          .isVisible(),
      );
      assert.ok(await page.locator("#dockChatInput").isEnabled());
      const dock = await page
        .locator("#dockBar")
        .evaluate((n) => [n.offsetWidth, n.offsetHeight]);
      await page.locator("#dockChatBackBtn").click();
      await page.waitForFunction(() => testRouteFrames.length === 2);
      assert.match(
        await page.evaluate(() => testRouteFrames[1].frames.at(-1).transform),
        /100%/,
      );
      await page.locator(".chat-list-item[data-chat-user=carol]").click();
      await page.waitForFunction(
        () =>
          !document.getElementById("dockChatDetailView").getAnimations().length,
      );
      assert.equal(await page.locator("#dockChatTitle").textContent(), "carol");
      assert.equal(await page.locator(".chat-route-layer").count(), 0);
      assert.equal(
        await page.locator("#dockChatDetailView").evaluate((n) => n.inert),
        false,
      );
      assert.equal(await page.locator("#dockChatListView").isVisible(), false);
      assert.deepEqual(
        await page
          .locator("#dockBar")
          .evaluate((n) => [n.offsetWidth, n.offsetHeight]),
        dock,
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.locator("#dockChatBackBtn").click();
      assert.equal(
        await page.locator("#dockChatDetailView").isVisible(),
        false,
      );
      assert.ok(await page.locator("#dockChatListView").isVisible());
      assert.deepEqual(f.errors, []);
    } finally {
      await f.close();
    }
  },
);
