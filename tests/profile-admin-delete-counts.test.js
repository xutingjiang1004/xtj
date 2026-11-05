"use strict";
// 管理员删除账号：响应和审计日志里的删除条数必须是真实数量。
// supabase-js 的 delete() 只有传 { count: 'exact' } 才返回 count，否则恒为 null，
// 之前响应与审计日志永远写「posts:0 likes:0 comments:0」。
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
      then(resolve, reject) {
        const rows = tables[table] || (tables[table] = []);
        let result;
        if (state.op === "delete") {
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

test("admin account deletion reports real deleted counts in the response and the audit log", async () => {
  const source = fs.readFileSync("render-api/server.js", "utf8");
  const begin = source.indexOf("app.delete('/admin/user/:userName'"),
    end = source.indexOf("function firstNonEmptyValue()", begin);
  const tables = {
    posts: [
      { id: "p1", user_name: "bob", media_type: "text" },
      { id: "a1", user_name: "bob", media_type: "__auth__" },
      { id: "l1", user_name: "bob", media_type: "__login_event__" },
    ],
    likes: [
      { id: 1, user_name: "bob", post_id: "other" },
      { id: 2, user_name: "carol", post_id: "p1" },
    ],
    comments: [{ id: 1, user_name: "carol", post_id: "p1" }],
  };
  const audits = [];
  const app = express();
  const context = vm.createContext({
    app,
    verifyToken: (req, res, next) => next(),
    rateLimit: () => (req, res, next) => next(),
    MAX_USERNAME_LEN: 50,
    ADMIN_USERNAME: "xxz",
    DM_MARKER: "__dm__",
    PHOTO_BUCKET: "photo-wall",
    supabase: fakeSupabase(tables),
    async retireAccountPostMediaUploads() { return []; },
    async deleteQueuedAccountPostMediaUploads() { return { error: null, count: 0 }; },
    async removeStorageWithQueue() { return { ok: true, removed: true, paths: [] }; },
    safePhotoPath: () => false,
    async revokeAllUserRefreshTokens() { return true; },
    async logAdminAudit(...args) { audits.push(args); },
    console,
    Promise, Set, Map, Array, String, Number, Math,
  });
  vm.runInContext(source.slice(begin, end), context);
  const res = await request(app).delete("/admin/user/bob");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.deleted.posts, 2, "p1 + __auth__ row");
  assert.equal(res.body.deleted.likes, 2, "carol's like on bob's post + bob's own like");
  assert.equal(res.body.deleted.comments, 1);
  assert.match(audits.at(-1)[2], /posts:2 likes:2 comments:1/);
  assert.equal(res.body.deleted.retained_system_posts, 1);
  assert.equal(tables.posts.length, 1, "only the retained login event is left");
});
