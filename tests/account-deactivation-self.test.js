'use strict';
// 用户自己在「我的」页面注销账号（2026-11-08）：必须再输一次密码；注销范围与管理员「删除用户」一致；前端入口存在且走密码确认。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');

const SERVER = fs.readFileSync('render-api/server.js', 'utf8');
function routeSource() {
  const a = SERVER.indexOf("app.post('/api/user/deactivate'");
  return SERVER.slice(a, SERVER.indexOf('function parseReportRecordContent(', a));
}
function build(options) {
  const opts = options || {};
  const calls = { deactivate: [], invalidated: [], verified: [] };
  const app = express(); app.use(express.json());
  const context = vm.createContext({
    app, console, String, Promise,
    authenticateUser(req, res, next) { if (!req.get('x-user')) return res.sendStatus(401); req.userName = req.get('x-user'); next(); },
    securityRateLimit: () => (req, res, next) => next(),
    ADMIN_USERNAME: 'xxz', AUTH_MARKER: '__auth__', PHOTO_COOKIE: 'xtj_photo', POST_MEDIA_COOKIE: 'xtj_post_media', supabase: {},
    async readAuthRecord() { if (opts.lookupError) throw new Error('offline'); return opts.noRecord ? null : { id: 'a1', media_url: 'stored-verifier' }; },
    async verifyAuthPassword(stored, password, user) { calls.verified.push([stored, password, user]); return password === 'right-password'; },
    async deactivateAccount(name, actor) { calls.deactivate.push([name, actor]); return opts.outcome || { status: 200, body: { ok: true, account_deactivated: true } }; },
    authCache: { invalidate(name) { calls.invalidated.push(name); } }
  });
  vm.runInContext(routeSource(), context);
  return { app, calls };
}
const post = (f, user, body) => request(f.app).post('/api/user/deactivate').set('x-user', user).send(body);

test('自助注销：必须登录、必须带正确的当前密码；密码错、缺密码、管理员账号都不会触发注销', async () => {
  const f = build();
  await request(f.app).post('/api/user/deactivate').send({ password: 'right-password' }).expect(401);
  assert.equal((await post(f, 'bob', {})).body.code, 'password_required');
  assert.equal((await post(f, 'bob', { password: 123 })).status, 400);
  assert.equal((await post(f, 'bob', { password: 'x'.repeat(129) })).status, 400);
  const wrong = await post(f, 'bob', { password: 'nope' });
  assert.equal(wrong.status, 401); assert.equal(wrong.body.code, 'wrong_password');
  assert.equal((await post(f, 'xxz', { password: 'right-password' })).status, 403);
  assert.equal(f.calls.deactivate.length, 0, 'nothing was deactivated');
  assert.equal(build({ noRecord: true }).calls.deactivate.length, 0);
  assert.equal((await post(build({ noRecord: true }), 'bob', { password: 'right-password' })).status, 401);
  assert.equal((await post(build({ lookupError: true }), 'bob', { password: 'right-password' })).status, 503);
});

test('自助注销：密码正确才执行，只注销自己；清掉会话 Cookie，认证缓存立刻失效', async () => {
  const f = build();
  const res = await post(f, 'bob', { password: 'right-password' });
  assert.equal(res.status, 200); assert.equal(res.body.account_deactivated, true); assert.equal(res.body.content_retained, true); assert.equal(res.body.cleanup_pending, false);
  assert.deepEqual(f.calls.deactivate, [['bob', 'bob']]);
  assert.deepEqual(f.calls.invalidated, ['bob']);
  assert.deepEqual(f.calls.verified, [['stored-verifier', 'right-password', 'bob']]);
  const cookies = res.headers['set-cookie'].join('\n');
  for (const name of ['xtj_user_refresh', 'xtj_photo', 'xtj_post_media']) assert.match(cookies, new RegExp(name + '=;'));
  // 请求体里伪造别人的名字没有用：只认令牌里的账号
  const forged = build(); await post(forged, 'bob', { password: 'right-password', user_name: 'alice', userName: 'alice' });
  assert.deepEqual(forged.calls.deactivate, [['bob', 'bob']]);
});

test('自助注销：登录记录已删除后剩余清理失败也算注销成功（用户没法再重试，交给管理员）；删除前失败则可重试', async () => {
  const partial = build({ outcome: { status: 500, body: { code: 'delete_user_partial' } } });
  const done = await post(partial, 'bob', { password: 'right-password' });
  assert.equal(done.status, 200); assert.equal(done.body.cleanup_pending, true); assert.deepEqual(partial.calls.invalidated, ['bob']);
  const early = build({ outcome: { status: 503, body: { code: 'delete_user_deactivate_failed' } } });
  const failed = await post(early, 'bob', { password: 'right-password' });
  assert.equal(failed.status, 503); assert.equal(failed.body.retryable, true);
  assert.deepEqual(early.calls.invalidated, [], 'the account still exists, so the session stays valid for a retry');
  assert.equal(early.calls.deactivate.length, 1);
});

test('自助注销：用户的审计记录标明来源；被禁言的用户也能注销；路径在 /api/user 下，额度受限提示生效', () => {
  assert.match(SERVER, /async function deactivateAccount\(userName, actor\)/);
  assert.match(SERVER, /actor \|\| ADMIN_USERNAME/);
  assert.match(SERVER, /source:self/);
  const skip = SERVER.slice(SERVER.indexOf('function shouldSkipWriteRestriction('), SERVER.indexOf('function applyAuthenticatedWriteRestrictions('));
  assert.match(skip, /'\/api\/user\/deactivate'/);
  const admin = SERVER.slice(SERVER.indexOf("app.delete('/admin/user/:userName'"), SERVER.indexOf('async function deactivateAccount('));
  assert.match(admin, /deactivateAccount\(req\.params\.userName\)/, 'the admin route shares the same implementation');
});

test('「我的」页面有注销账号入口：二次确认、密码输入框（type=password）、请求带密码，成功后退出并给提示', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /<button type="button" class="profile-detail-deactivate-btn" onclick="deactivateMyAccount\(\)">注销账号<\/button>/);
  const modal = html.slice(html.indexOf('id="profileDetailModal"'), html.indexOf('id="userProfileModal"'));
  assert.ok(modal.includes('deactivateMyAccount()'), 'the entry sits inside the profile detail modal');
  const part = fs.readFileSync('js/core-parts/03-profile-report-ai.js', 'utf8');
  const fn = part.slice(part.indexOf('window.deactivateMyAccount = async function'), part.indexOf('window.switchAccount = function'));
  assert.match(fn, /xtjConfirm\('注销账号'/);
  assert.match(fn, /xtjPrompt\([^)]*\{ type: 'password'/);
  assert.match(fn, /xtjProtectedFetch\('\/api\/user\/deactivate', \{ method: 'POST', body: JSON\.stringify\(\{ password: password \}\) \}\)/);
  assert.ok(fn.indexOf('xtjConfirm') < fn.indexOf('xtjPrompt') && fn.indexOf('xtjPrompt') < fn.indexOf('xtjProtectedFetch'), 'confirm, then password, then request');
  assert.match(fn, /await window\.doLogout\(\)/);
  assert.match(fn, /_isDeactivating/, 'no double submit');
  for (const file of ['js/core.js', 'js/core.min.js']) assert.ok(fs.readFileSync(file, 'utf8').includes('/api/user/deactivate'), file + ' is rebuilt');
  assert.match(fs.readFileSync('js/core-parts/01-bootstrap.js', 'utf8'), /input\.type = options\.type === 'password' \? 'password' : 'text'/);
});
