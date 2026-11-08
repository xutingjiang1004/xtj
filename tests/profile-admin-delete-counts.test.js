"use strict";
// 管理员删除账号 = 注销账号（2026-11-08 用户要求）：只清除这个人（登录凭证、个人资料、AI 私有数据、会话），
// 他发布过的内容——帖子、照片、视频、评论、点赞、聊天消息、头像——一律保留；响应和审计日志里的条数必须是真实数量。
// supabase-js 的 delete() 只有传 { count: 'exact' } 才返回 count，否则恒为 null。
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const express = require("express"),
  request = require("supertest");

function fakeSupabase(tables) {
  function builder(table) {
    const state = { table, op: "select", opts: null, filters: [], from: 0, to: Infinity };
    const matches = (row) => state.filters.every((f) => f(row));
    const q = {
      select() { return q; },
      eq(k, v) { state.filters.push((r) => r[k] === v); return q; },
      neq(k, v) { state.filters.push((r) => r[k] !== v); return q; },
      in(k, v) { state.filters.push((r) => v.includes(r[k])); return q; },
      is(k, v) { state.filters.push((r) => (r[k] ?? null) === v); return q; },
      order() { return q; },
      limit(n) { state.to = state.from + n - 1; return q; },
      range(a, b) { state.from = a; state.to = b; return q; },
      maybeSingle() { state.single = true; return q; },
      delete(opts) { state.op = "delete"; state.opts = opts || null; return q; },
      update(values) { state.op = "update"; state.values = values; return q; },
      insert(values) { state.op = "insert"; state.values = values; return q; },
      then(resolve, reject) {
        const rows = tables[table] || (tables[table] = []);
        let result;
        if (state.op === "insert") {
          (Array.isArray(state.values) ? state.values : [state.values]).forEach((row, i) => rows.push({ id: "new-" + rows.length + "-" + i, ...row }));
          result = { data: null, error: null };
        } else if (state.op === "update") {
          const changed = rows.filter(matches);
          changed.forEach((r) => Object.assign(r, state.values));
          result = { data: changed.map((r) => ({ id: r.id })), error: null };
        } else if (state.op === "delete") {
          const removed = rows.filter(matches);
          tables[table] = rows.filter((r) => !matches(r));
          result = { data: null, error: null, count: state.opts && state.opts.count === "exact" ? removed.length : null };
        } else {
          const data = rows.filter(matches).slice(state.from, state.to + 1).map((r) => ({ ...r }));
          result = { data: state.single ? data[0] || null : data, error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return q;
  }
  return {
    from: builder,
    rpc: async () => ({ data: 0, error: null }),
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  };
}

function sliceRoute() {
  const source = fs.readFileSync("render-api/server.js", "utf8");
  const begin = source.indexOf("app.delete('/admin/user/:userName'"), end = source.indexOf("function firstNonEmptyValue()", begin);
  assert.ok(begin > 0 && end > begin);
  return source.slice(begin, end);
}
function buildApp(tables, extra) {
  const audits = [], storageCalls = [], revoked = [];
  const app = express();
  const context = vm.createContext(Object.assign({
    app,
    verifyToken: (req, res, next) => next(),
    rateLimit: () => (req, res, next) => next(),
    MAX_USERNAME_LEN: 50,
    ADMIN_USERNAME: "xxz",
    AUTH_MARKER: "__auth__", AUTH_DELETED_MARKER: "__auth_deleted__", USER_INFO_MARKER: "__user_info__",
    CUSTOM_AI_MODELS_MARKER: "__custom_ai_models__", REFRESH_TOKEN_MARKER: "__refresh_token__",
    supabase: fakeSupabase(tables),
    async removeStorageWithQueue(...args) { storageCalls.push(args); return { ok: true, removed: true, paths: [] }; },
    async retireAccountPostMediaUploads(...args) { storageCalls.push(args); return []; },
    async revokeAllUserRefreshTokens(name) { revoked.push(name); tables.posts = tables.posts.filter((r) => !(r.user_name === name && r.media_type === "__refresh_token__")); return true; },
    async logAdminAudit(...args) { audits.push(args); },
    console,
    Promise, Set, Map, Array, String, Number, Math, JSON, Date,
  }, extra || {}));
  vm.runInContext(sliceRoute(), context);
  return { app, audits, storageCalls, revoked };
}
function world() {
  return {
    posts: [
      { id: "p1", user_name: "bob", media_type: "text", content: "hello" },
      { id: "p2", user_name: "bob", media_type: "video", media_url: "https://oss/posts/bob_1.mp4" },
      { id: "p3", user_name: "bob", media_type: "album", media_url: "https://oss/posts/bob_2.jpg" },
      { id: "w1", user_name: "bob", media_type: "__photo_wall__", media_url: "photos/bob_1.jpg" },
      { id: "av", user_name: "bob", media_type: "__avatar__", media_url: "avatars/bob.png" },
      { id: "a1", user_name: "bob", media_type: "__auth__", media_url: "scrypt:v1:32768:4:1:salt:key", content: "__auth__" },
      { id: "u1", user_name: "bob", media_type: "__user_info__", content: JSON.stringify({ email: "bob@example.com", last_ip: "1.2.3.4" }) },
      { id: "m1", user_name: "bob", media_type: "__custom_ai_models__", content: "{}" },
      { id: "r1", user_name: "bob", media_type: "__refresh_token__", media_url: "jti-1" },
      { id: "l1", user_name: "bob", media_type: "__login_event__" },
      { id: "d1", user_name: "bob", media_type: "__dm__", media_url: "carol", content: "hi carol" },
      { id: "d2", user_name: "carol", media_type: "__dm__", media_url: "bob", content: "hi bob" },
      { id: "c1", user_name: "carol", media_type: "text", content: "carol's post" },
    ],
    likes: [{ id: 1, user_name: "bob", post_id: "c1" }, { id: 2, user_name: "carol", post_id: "p1" }],
    comments: [{ id: 1, user_name: "carol", post_id: "p1" }, { id: 2, user_name: "bob", post_id: "c1" }],
    ai_search_results: [{ id: "s1", owner_name: "bob" }, { id: "s2", owner_name: "carol" }],
    ai_drafts: [{ id: "x1", owner_name: "bob" }],
    ai_action_confirmations: [],
    bans: [{ id: 1, user_name: "bob" }],
  };
}

test("注销账号：登录记录变墓碑、个人资料与 AI 私有数据清除；发布过的内容和聊天消息一条不少，存储文件不动", async () => {
  const tables = world();
  const before = tables.posts.filter((r) => ["text", "video", "album", "__photo_wall__", "__avatar__", "__dm__", "__login_event__"].includes(r.media_type)).map((r) => r.id).sort();
  const f = buildApp(tables);
  const res = await request(f.app).delete("/admin/user/bob");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.account_deactivated, true); assert.equal(res.body.content_retained, true);
  assert.deepEqual(res.body.deleted, { auth_records: 1, user_info: 2, ai_search_results: 1, ai_drafts: 1, ai_action_confirmations: 0 });
  // 内容：帖子、视频、相册、照片墙、头像、发出和收到的私信、登录事件、评论、点赞全部还在
  const after = tables.posts.filter((r) => ["text", "video", "album", "__photo_wall__", "__avatar__", "__dm__", "__login_event__"].includes(r.media_type)).map((r) => r.id).sort();
  assert.deepEqual(after, before, "no content row is removed");
  assert.equal(tables.likes.length, 2); assert.equal(tables.comments.length, 2);
  // 身份：登录记录被删除（数据库里账号私有的 AI 数据挂在它的删除上），同时留下一行墓碑占住昵称（别人不能再注册同名账号）
  assert.equal(tables.posts.filter((r) => r.user_name === "bob" && r.media_type === "__auth__").length, 0);
  assert.equal(tables.posts.find((r) => r.id === "a1"), undefined, "the credential row is deleted, not just relabelled");
  const tomb = tables.posts.filter((r) => r.user_name === "bob" && r.media_type === "__auth_deleted__");
  assert.equal(tomb.length, 1); assert.equal(tomb[0].media_url, "deleted");
  assert.doesNotMatch(tomb[0].media_url + tomb[0].content, /scrypt/, "no credential is kept");
  // 私有数据与会话
  for (const type of ["__user_info__", "__custom_ai_models__", "__refresh_token__"]) assert.equal(tables.posts.filter((r) => r.media_type === type).length, 0, type);
  assert.deepEqual(f.revoked, ["bob"]);
  assert.deepEqual(tables.ai_search_results.map((r) => r.id), ["s2"], "other accounts' data untouched");
  assert.equal(tables.ai_drafts.length, 0);
  // 存储：既不清理聊天/照片/头像文件，也不清理帖子媒体登记
  assert.equal(f.storageCalls.length, 0, "no storage cleanup is queued for a deactivated account");
  assert.equal(tables.bans.length, 1, "moderation records are retained");
  assert.equal(res.body.retained_policy_data.bans, true);
  assert.match(f.audits.at(-1)[2], /action:deactivate content_retained:true auth_records:1 user_info:2/);
});

test("注销账号：重复执行安全，失败后可重试；不存在的用户 404；管理员账号不能注销", async () => {
  const tables = world();
  const f = buildApp(tables);
  assert.equal((await request(f.app).delete("/admin/user/bob")).status, 200);
  const again = await request(f.app).delete("/admin/user/bob");
  assert.equal(again.status, 200); assert.equal(again.body.already_deactivated, true);
  assert.equal(tables.posts.filter((r) => r.media_type === "__auth_deleted__").length, 1, "repeating never adds a second tombstone");
  assert.equal((await request(f.app).delete("/admin/user/nobody")).status, 404);
  assert.equal((await request(f.app).delete("/admin/user/xxz")).status, 403);

  // 清理途中失败：墓碑已经生效（不能登录），再来一次能继续清掉剩余的私有数据
  const partial = world(); let failOnce = true;
  const flaky = buildApp(partial, { async revokeAllUserRefreshTokens(name) { if (failOnce) { failOnce = false; throw new Error("offline"); } partial.posts = partial.posts.filter((r) => r.media_type !== "__refresh_token__"); return true; } });
  const first = await request(flaky.app).delete("/admin/user/bob");
  assert.equal(first.status, 500); assert.equal(first.body.code, "delete_user_partial"); assert.equal(first.body.content_retained, true);
  assert.equal(partial.posts.filter((r) => r.user_name === "bob" && r.media_type === "__auth__").length, 0, "already unable to log in");
  assert.equal(partial.posts.find((r) => r.id === "p1").content, "hello", "content untouched even on failure");
  const second = await request(flaky.app).delete("/admin/user/bob");
  assert.equal(second.status, 200, JSON.stringify(second.body)); assert.equal(partial.posts.filter((r) => r.media_type === "__user_info__").length, 0);
});

test("注销账号：写完昵称墓碑后删除登录记录失败，重试不会再插第二行墓碑，最终账号注销完成", async () => {
  const tables = world();
  const base = fakeSupabase(tables); let failed = false;
  const supabase = { ...base, from(table) {
    const q = base.from(table); if (table !== "posts") return q;
    let deleting = false, authFilter = false;
    const origDelete = q.delete, origEq = q.eq, origThen = q.then;
    q.delete = function (o) { deleting = true; return origDelete.call(q, o); };
    q.eq = function (k, v) { if (k === "media_type" && v === "__auth__") authFilter = true; return origEq.call(q, k, v); };
    q.then = function (resolve, reject) {
      if (deleting && authFilter && !failed) { failed = true; return Promise.resolve({ data: null, error: { message: "down" } }).then(resolve, reject); }
      return origThen.call(q, resolve, reject);
    };
    return q;
  } };
  const f = buildApp(tables, { supabase });
  const first = await request(f.app).delete("/admin/user/bob");
  assert.equal(first.status, 503); assert.equal(first.body.code, "delete_user_deactivate_failed");
  assert.equal(tables.posts.filter((r) => r.media_type === "__auth_deleted__").length, 1, "the name is already reserved");
  assert.equal(tables.posts.filter((r) => r.user_name === "bob" && r.media_type === "__auth__").length, 1, "nothing else was touched yet");
  assert.equal(tables.posts.find((r) => r.id === "p1").content, "hello");
  const second = await request(f.app).delete("/admin/user/bob");
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(tables.posts.filter((r) => r.media_type === "__auth_deleted__").length, 1, "no duplicate tombstone");
  assert.equal(tables.posts.filter((r) => r.user_name === "bob" && r.media_type === "__auth__").length, 0);
});

test("注销后的昵称仍被占用：别人注册同名账号被拒绝，账号墓碑不会被当成存在的账号", () => {
  const source = fs.readFileSync("render-api/server.js", "utf8");
  const register = source.slice(source.indexOf("app.post('/api/user/register'"), source.indexOf('// 限制状态只通过服务端按当前 access token 查询'));
  assert.match(register, /eq\('media_type', AUTH_DELETED_MARKER\)/, "tombstoned names are reserved");
  assert.ok(register.indexOf("AUTH_DELETED_MARKER") < register.indexOf("deriveAuthVerifier(password)"), "checked before any credential is created");
  const report = source.slice(source.indexOf("app.post('/api/report'"), source.indexOf("app.get('/api/my-reports'"));
  assert.match(report, /in\('media_type', \[AUTH_MARKER, AUTH_DELETED_MARKER\]\)/, "content of a deactivated account can still be reported");
  // 路由本身不再包含任何删除内容、聊天或存储文件的代码
  const route = sliceRoute();
  for (const forbidden of [/from\('likes'\)\.delete/, /from\('comments'\)\.delete/, /removeStorageWithQueue\(/, /retireAccountPostMediaUploads\(/, /deleteIdsInBatches\(/, /dm_media_uploads'\)\.delete/]) {
    assert.doesNotMatch(route, forbidden, String(forbidden));
  }
});
