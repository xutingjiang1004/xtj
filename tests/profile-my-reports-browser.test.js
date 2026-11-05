"use strict";
// 「举报记录」必须走服务端 /api/my-reports：匿名密钥读不到 __report__ 行（RLS 只放行公开帖子类型），
// 直读 posts 会让用户永远看到「你还没有举报记录」，也看不到管理员回复。
const test = require("node:test"),
  assert = require("node:assert/strict");
const { postBrowserFixture } = require("./helpers/post-browser-fixture");

const REPORT = {
  id: "11111111-1111-4111-8111-111111111111",
  created_at: "2026-11-03T08:00:00.000Z",
  reporter_name: "alice",
  target_type: "post",
  target_id: "8c1cb02d-74d0-4e45-9e15-000000000001",
  target_user: "bob",
  report_reason: "广告刷屏",
  status: "actioned",
  admin_response: "已删除该帖子，感谢反馈",
  reviewed_at: "2026-11-04T08:00:00.000Z",
};

test("report history lists the account's reports and admin replies from the server", { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ viewport: { width: 1280, height: 800 }, counts: [1] });
  try {
    let calls = 0;
    await f.page.route("**/api/my-reports", (route) => {
      calls++;
      return route.fulfill({ json: { data: [REPORT] } });
    });
    await f.page.evaluate(() => window.toggleReportRecords());
    await f.page.waitForSelector("#reportHistoryList .report-record-item");
    const text = await f.page.locator("#reportHistoryList").innerText();
    assert.match(text, /广告刷屏/);
    assert.match(text, /已删除该帖子，感谢反馈/);
    assert.match(text, /已处理/);
    assert.equal(calls, 1);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("report history shows a retry hint when the server is unavailable, not an empty list", { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ viewport: { width: 1280, height: 800 }, counts: [1] });
  try {
    await f.page.route("**/api/my-reports", (route) => route.fulfill({ status: 503, json: { error: "暂不可用" } }));
    await f.page.evaluate(() => window.toggleReportRecords());
    await f.page.waitForFunction(() => !/加载中/.test(document.getElementById("reportHistoryList").textContent));
    assert.match(await f.page.locator("#reportHistoryList").innerText(), /加载失败/);
  } finally { await f.close(); }
});

test("report history says so when the account has no reports", { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ viewport: { width: 1280, height: 800 }, counts: [1] });
  try {
    await f.page.route("**/api/my-reports", (route) => route.fulfill({ json: { data: [] } }));
    await f.page.evaluate(() => window.toggleReportRecords());
    await f.page.waitForFunction(() => !/加载中/.test(document.getElementById("reportHistoryList").textContent));
    assert.match(await f.page.locator("#reportHistoryList").innerText(), /还没有举报记录/);
  } finally { await f.close(); }
});
