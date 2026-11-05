"use strict";
// 昵称规则：只由 ZWJ / 变体选择符 / 键帽符 / 标签字符组成的昵称在界面上是空白，必须拒绝（审计 2026-11-05 profile）。
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const express = require("express"),
  request = require("supertest");
const { postBrowserFixture } = require("./helpers/post-browser-fixture");

const INVISIBLE = ["‍‍", "️️", "⃣⃣", "‍️", "\u{E0020}\u{E0021}"];
const VISIBLE = ["小猫", "ab", "😀😀", "❤️", "a_", "👨‍👩‍👧", "\u{1F1E8}\u{1F1F3}"];

function registerApp() {
  const source = fs.readFileSync("render-api/server.js", "utf8");
  const begin = source.indexOf("app.post('/api/user/register'"),
    end = source.indexOf("// 限制状态只通过服务端", begin);
  const app = express();
  app.use(express.json());
  const context = vm.createContext({
    app,
    securityRateLimit: () => (req, res, next) => next(),
    validateString: (v) => (typeof v === "string" ? v.trim() || null : null),
    MAX_USERNAME_LEN: 50,
    AUTH_MARKER: "__auth__",
    ADMIN_USERNAME: "xxz",
    supabase: {
      from: () => ({
        select() { return this; },
        eq() { return this; },
        // A visible nickname passes validation and reaches this "already registered" answer.
        async maybeSingle() { return { data: { id: "existing" }, error: null }; },
      }),
    },
    console,
    Array,
    String,
  });
  vm.runInContext(source.slice(begin, end), context);
  return app;
}

test("registration rejects nicknames that render as blank", async () => {
  const app = registerApp();
  for (const name of INVISIBLE) {
    const res = await request(app).post("/api/user/register").send({ user_name: name, password: "secret1" });
    assert.equal(res.status, 400, JSON.stringify(name));
    assert.equal(res.body.error, "昵称格式不正确");
  }
});

test("registration still accepts visible nicknames, including emoji sequences", async () => {
  const app = registerApp();
  for (const name of VISIBLE) {
    const res = await request(app).post("/api/user/register").send({ user_name: name, password: "secret1" });
    assert.equal(res.status, 409, JSON.stringify(name));
  }
});

test("the register form refuses a blank-looking nickname before calling the server", { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ viewport: { width: 1280, height: 800 }, counts: [1] });
  try {
    for (const name of INVISIBLE) {
      const before = f.calls.filter((c) => c.path === "/api/user/register").length;
      await f.page.evaluate(async (nick) => {
        document.getElementById("regNickInp").value = nick;
        document.getElementById("regPwInp").value = "secret1";
        document.getElementById("regEmailInp").value = "";
        await doRegister();
      }, name);
      assert.equal(f.calls.filter((c) => c.path === "/api/user/register").length, before, JSON.stringify(name));
    }
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
