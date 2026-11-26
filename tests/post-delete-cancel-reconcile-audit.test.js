'use strict';
// E-M2 删除进行中关闭弹窗，服务端已删、界面仍留帖。
// 根因：关弹窗调 cleanupDeleteSession 置 session.cancelled=true，
// 删除请求的成功回调先判 cancelled 就直接 return，丢弃了在途结果。
// 修复：关弹窗只关确认框，不丢弃在途结果。成功回调按响应本身
// （服务端已确认删除）继续移除帖子；请求超时时仍以权威接口
// confirmPostDeleteStatus 确认一次再决定。弹窗的取消标记不再
// 成为“删除已发生却不执行”的理由。
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

const posts = fs.readFileSync('js/core-parts/04-posts-interactions.js', 'utf8');

test('删除成功回调不再因“关过弹窗”就丢弃服务端已确认的删除', () => {
  const resp = posts.indexOf('if (!deleteResponse.ok || !deleteResult.ok');
  assert.ok(resp > 0, '缺少删除响应处理');
  const guard = posts.slice(Math.max(0, resp - 300), resp);
  assert.doesNotMatch(guard, /session\.cancelled/,
    '成功回调前的守卫仍在用 session.cancelled 直接 return，关弹窗后服务端已删也不会移除');
  const apply = posts.indexOf('applyConfirmedPostDeletion(targetPostId, session);');
  assert.ok(apply > 0, '缺少 applyConfirmedPostDeletion 调用');
  const beforeApply = posts.slice(Math.max(0, apply - 300), apply);
  assert.doesNotMatch(beforeApply, /if \(session\.cancelled/,
    '执行删除前仍在用 session.cancelled 拦截');
});

test('删除请求超时后，关过弹窗也不跳过权威状态确认', () => {
  const race = posts.indexOf('} catch (raceErr) {');
  assert.ok(race > 0, '缺少删除超时处理');
  const timeoutBlock = posts.slice(race, race + 1500);
  assert.doesNotMatch(timeoutBlock, /if \(finished \|\| session\.cancelled/,
    '超时分支仍在用 session.cancelled 跳过权威确认');
  assert.match(timeoutBlock, /confirmPostDeleteStatus\(targetPostId, identity\)/,
    '超时分支应以 confirmPostDeleteStatus 确认');
  const confirmAt = timeoutBlock.indexOf('confirmPostDeleteStatus(targetPostId, identity)');
  const afterConfirm = timeoutBlock.slice(confirmAt, confirmAt + 600);
  assert.doesNotMatch(afterConfirm, /if \(finished \|\| session\.cancelled/,
    '权威确认后仍在用 session.cancelled 拦截删除执行');
});

test('关弹窗本身仍只关确认框，不中止在途请求（不改 cleanupDeleteSession 的取消语义）', () => {
  const cleanup = posts.indexOf('function cleanupDeleteSession');
  assert.ok(cleanup > 0, '缺少 cleanupDeleteSession');
  const block = posts.slice(cleanup, cleanup + 500);
  assert.match(block, /session\.cancelled = true/, 'cleanup 应继续标记 cancelled（供失败分支用）');
});
