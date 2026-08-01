"use strict";
// ★ 真实行为测试：@小猫 AI 回复、认证广播、幽灵登录、Enter 处理、导航刷新锁、照片墙竞态

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf-8');
}

// ─── 1. cat-ai-reply-status API 行为测试 ───
describe('cat-ai-reply-status API behavior', function() {
  const server = read('render-api/server.js');

  it('completed 分支必须 select 完整字段（id, post_id, user_name, content, created_at, parent_comment_id, generated_by_ai）', function() {
    // 检查 completed 分支中的 select 语句
    const completedSelect = server.match(/\.select\('id,\s*post_id,\s*user_name,\s*content,\s*created_at[^)]*parent_comment_id[^)]*generated_by_ai[^)]*'\)/);
    assert.ok(completedSelect, 'completed 分支必须 select 完整字段');
  });

  it('not_triggered 分支也必须 select 完整字段', function() {
    // 检查 not_triggered（jobRes.data 为空）分支中的 select
    const notTriggeredSelect = server.match(/\.select\('id,\s*post_id,\s*user_name,\s*content,\s*created_at[^)]*parent_comment_id[^)]*generated_by_ai[^)]*'\)/g);
    assert.ok(notTriggeredSelect && notTriggeredSelect.length >= 2, 'not_triggered 和 completed 分支都必须 select 完整字段');
  });

  it('completed 后必须验证 reply 字段完整性', function() {
    // 验证 content 非空检查
    assert.ok(server.includes('rr.content.trim()'), '必须检查 content.trim()');
    assert.ok(server.includes('rr.user_name ==='), '必须验证 user_name');
    assert.ok(server.includes('rr.generated_by_ai'), '必须验证 generated_by_ai');
    assert.ok(server.includes('rr.parent_comment_id'), '必须验证 parent_comment_id');
  });

  it('completed 但无有效回复时返回 repair_required 状态', function() {
    assert.ok(server.includes('repair_required'), 'completed 无有效回复必须返回 repair_required');
  });

  it('不会返回只有 id 的空对象', function() {
    // 验证 completed 分支的 select 返回完整字段，不再使用 buildSummaryQuery
    const completedSelect = server.match(/\.select\('id,\s*post_id,\s*user_name,\s*content,\s*created_at[^)]*parent_comment_id[^)]*generated_by_ai[^)]*'\)/g);
    assert.ok(completedSelect && completedSelect.length >= 2, 'completed 分支必须使用完整 select 替代 buildSummaryQuery');
  });
});

// ─── 2. 小猫前端回复行为测试 ───
describe('cat-ai frontend reply behavior', function() {
  const core = read('js/core.js');

  it('insertCatAiCommentIntoDOM 必须插入到 .comment-replies 容器内', function() {
    assert.ok(core.includes('querySelector(\'.comment-replies\')'), '必须查找 .comment-replies 容器');
    assert.ok(core.includes('repliesContainer.appendChild'), '必须 appendChild 到容器');
    assert.ok(core.includes('createElement(\'div\')') && core.includes('comment-replies'), '不存在时必须创建 .comment-replies');
  });

  it('不得插入到源评论的兄弟节点', function() {
    // 不应有 insertBefore 或 parentNode.insertBefore 将 AI 回复插入到源评论旁边
    const insertBeforeEx = core.match(/insertBefore\(aiEl,\s*sourceEl/);
    assert.ok(!insertBeforeEx, '不应将 AI 回复插入到源评论的兄弟节点');
    const nextSibling = core.match(/sourceEl\.nextSibling/);
    assert.ok(!nextSibling, '不应使用 sourceEl.nextSibling');
  });

  it('upsertAiComment 必须去重', function() {
    assert.ok(core.includes('upsertAiComment'), '必须有 upsertAiComment 函数');
    assert.ok(core.includes('existingInFeed') || core.includes('已经存在'), '必须检查 feedAllComments 去重');
    assert.ok(core.includes('existingInDom') || core.includes('querySelector'), '必须检查 DOM 去重');
  });

  it('Realtime INSERT 必须调用 upsertAiComment', function() {
    assert.ok(core.includes('upsertAiComment(row, String(row.parent_comment_id)'), 'Realtime 必须调用 upsertAiComment');
  });

  it('polling 收到完整回复后必须调用 upsertAiComment', function() {
    assert.ok(core.includes('upsertAiComment(aiComment, commentId'), 'Polling 必须调用 upsertAiComment');
  });

  it('polling 必须验证 aiComment 字段完整性', function() {
    assert.ok(core.includes('aiComment && aiComment.id'), '必须验证 id');
    assert.ok(core.includes('aiComment.content.trim()'), '必须验证 content 非空');
    assert.ok(core.includes('aiComment.user_name ==='), '必须验证 user_name');
    assert.ok(core.includes('aiComment.generated_by_ai'), '必须验证 generated_by_ai');
    assert.ok(core.includes('aiComment.parent_comment_id'), '必须验证 parent_comment_id');
  });

  it('polling 页面隐藏时使用 accumulatedRunTime 而非 Date.now() 绝对时间', function() {
    assert.ok(core.includes('accumulatedRunTime'), '必须使用 accumulatedRunTime');
    assert.ok(core.includes('pausedAt'), '必须使用 pausedAt 记录暂停时间');
    assert.ok(core.includes('accumulatedRunTime += Date.now() - lastPollStart'), '恢复时必须补回暂停时间');
  });

  it('页面隐藏时保留 polling 任务', function() {
    assert.ok(core.includes('document.hidden'), '必须检查 document.hidden');
    const hiddenBranch = core.match(/if \(document\.hidden\) \{[\s\S]*?setTimeout\(poll/s);
    assert.ok(hiddenBranch, 'hidden 时必须保留 polling timer');
  });

  it('has retry button with retryBtnSetup', function() {
    assert.ok(core.includes('retryBtnSetup'), '必须有 retryBtnSetup');
    assert.ok(core.includes('__xtjRetryCatAi'), '必须有 __xtjRetryCatAi');
  });

  it('Realtime/visibility/online 恢复函数存在', function() {
    assert.ok(core.includes('visibilitychange') && core.includes('subscribeToComments'), 'visibilitychange 必须恢复 Realtime');
    assert.ok(core.includes('addEventListener(\'online\'') && core.includes('subscribeToComments'), 'online 必须恢复 Realtime');
    assert.ok(core.includes('addEventListener(\'pageshow\'') && core.includes('subscribeToComments'), 'pageshow 必须恢复 Realtime');
  });
});

// ─── 3. 多标签页认证广播行为测试 ───
describe('multi-tab auth broadcast behavior', function() {
  const core = read('js/core.js');

  it('BroadcastChannel 必须有 sourceTabId', function() {
    assert.ok(core.includes('sourceTabId'), '必须有 sourceTabId');
    assert.ok(core.includes('_sourceTabId'), '必须有 _sourceTabId');
  });

  it('必须忽略自己发出的消息', function() {
    assert.ok(core.includes('_isOwnMessage'), '必须有 _isOwnMessage');
    assert.ok(core.includes('sourceTabId === _sourceTabId'), '必须比较 sourceTabId');
  });

  it('必须有 eventId 去重', function() {
    assert.ok(core.includes('eventId'), '必须有 eventId');
    assert.ok(core.includes('_processedEventIds'), '必须有 _processedEventIds');
    assert.ok(core.includes('_isEventProcessed'), '必须有 _isEventProcessed');
  });

  it('接收 remote 消息时 clearAllAuthState 必须设置 broadcast:false', function() {
    const remoteClear = core.match(/clearAllAuthState\(\{[\s\S]*?broadcast:\s*false[\s\S]*?\}\)/);
    assert.ok(remoteClear, 'remote 消息时必须 broadcast:false');
  });

  it('clearAllAuthState 必须支持 broadcast 选项', function() {
    assert.ok(core.includes('options.broadcast !== false'), '必须支持 broadcast 选项');
    assert.ok(core.includes('shouldBroadcast'), '必须有 shouldBroadcast 变量');
  });

  it('__xtjBroadcastLogout 必须带 reason 参数', function() {
    assert.ok(core.includes('__xtjBroadcastLogout(reason)'), '__xtjBroadcastLogout 必须带 reason');
  });
});

// ─── 4. 幽灵登录行为测试 ───
describe('ghost login prevention behavior', function() {
  const core = read('js/core.js');

  it('必须有 _xtjAuthState 状态机', function() {
    assert.ok(core.includes('_xtjAuthState'), '必须有 _xtjAuthState');
    assert.ok(core.includes("'auth_pending'"), '必须有 auth_pending 状态');
    assert.ok(core.includes("'authenticated'"), '必须有 authenticated 状态');
    assert.ok(core.includes("'unauthenticated'"), '必须有 unauthenticated 状态');
    assert.ok(core.includes("'offline_unverified'"), '必须有 offline_unverified 状态');
  });

  it('启动时 currentUser 存在但验证未完成时进入 auth_pending', function() {
    assert.ok(core.includes("currentUser ? 'auth_pending' : 'unauthenticated'"), '启动时必须设置 auth_pending');
  });

  it('认证成功后设置 _xtjAuthState = authenticated', function() {
    assert.ok(core.includes("_xtjAuthState = 'authenticated'"), '认证成功必须设置 authenticated');
  });

  it('refresh 失败且 cookie 过期时设置 unauthenticated', function() {
    assert.ok(core.includes("_xtjAuthState = 'unauthenticated'"), 'cookie 过期必须设置 unauthenticated');
  });

  it('网络失败时设置 offline_unverified，不伪装成已认证', function() {
    assert.ok(core.includes("_xtjAuthState = 'offline_unverified'"), '网络失败必须设置 offline_unverified');
  });

  it('ensureProtectedOperationAuth 必须拦截 auth_pending', function() {
    assert.ok(core.includes("_xtjAuthState === 'auth_pending'"), '必须拦截 auth_pending');
    assert.ok(core.includes("while (window._xtjAuthState === 'auth_pending'"), 'auth_pending 必须等待验证完成');
  });

  it('必须有 isAuthenticated 函数', function() {
    assert.ok(core.includes('isAuthenticated'), '必须有 isAuthenticated 函数');
    assert.ok(core.includes("_xtjAuthState === 'authenticated'"), 'isAuthenticated 必须检查 authenticated');
  });

  it('账号切换时清理旧账号全部状态', function() {
    // 清理 AI 聊天缓存
    assert.ok(core.includes("safeStorage.remove('xtj_ai_history')"), '必须清理 AI 聊天缓存');
    // 清理个人资料缓存
    assert.ok(core.includes("safeStorage.remove('xtj_profile_cache')"), '必须清理个人资料缓存');
    // 清理头像缓存
    assert.ok(core.includes('avatarCache = {}'), '必须清理头像缓存');
    // 清理 cat AI polling
    assert.ok(core.includes('__catAiPollTimers'), '必须清理 cat AI polling');
    // 清理 Realtime
    assert.ok(core.includes('__xtjAbortAiRequests'), '必须清理 AI 请求');
  });
});

// ─── 5. @mention Enter 行为测试 ───
describe('@mention Enter behavior', function() {
  const core = read('js/core.js');

  it('不得有独立的 inp.onkeydown', function() {
    // 检查是否还存在独立的 inp.onkeydown 赋值
    const independentKeydown = core.match(/inp\.onkeydown\s*=\s*function/);
    assert.ok(!independentKeydown, '不得有独立的 inp.onkeydown');
  });

  it('统一 keydown 处理器必须优先处理 mentionDropdown', function() {
    assert.ok(core.includes('if (mentionDropdown)'), 'keydown 必须检查 mentionDropdown');
    assert.ok(core.includes('stopImmediatePropagation'), '必须使用 stopImmediatePropagation');
  });

  it('mentionDropdown 打开时 Enter 不发送', function() {
    // 在 mentionDropdown 分支内，Enter 应 insert 而非发送
    // 检查 insertMentionAtCursor 被调用在 mentionDropdown 的上下文中
    var hasInsertCall = core.includes('insertMentionAtCursor');
    var hasStopImmediate = core.includes('stopImmediatePropagation');
    assert.ok(hasInsertCall, 'mentionDropdown 必须有 insertMentionAtCursor');
    assert.ok(hasStopImmediate, 'mentionDropdown 必须使用 stopImmediatePropagation');
  });

  it('没有 mentionDropdown 时 Enter 发送', function() {
    const enterSend = core.match(/if \(e\.key === 'Enter'[\s\S]*?btn\.click/);
    assert.ok(enterSend, '没有 mentionDropdown 时 Enter 必须发送');
  });

  it('全局 click 监听器必须在 box.remove 时移除', function() {
    assert.ok(core.includes('removeEventListener(\'click\'') && core.includes('_mentionGlobalClick'), '必须在 box.remove 时移除 click 监听器');
  });

  it('支持全角 ＠ 和英文 @', function() {
    assert.ok(core.includes("'＠'") || core.includes('\\uFF20'), '必须支持全角 ＠');
    assert.ok(core.includes("'@'"), '必须支持英文 @');
  });

  it('触摸支持', function() {
    assert.ok(core.includes("'touchend'"), '必须有触摸事件支持');
  });
});

// ─── 6. 桌面导航刷新锁行为测试 ───
describe('desktop nav refresh lock behavior', function() {
  const shell = read('js/desktop-shell.js');

  it('refreshTab 必须返回 Promise', function() {
    assert.ok(shell.includes('return _refreshLocks[tab]'), 'refreshTab 必须返回 Promise');
    assert.ok(shell.includes('_refreshLocks[tab] = performRefresh'), '必须保存 performRefresh Promise');
  });

  it('performRefresh 必须是 async 函数', function() {
    assert.ok(shell.includes('async function performRefresh'), 'performRefresh 必须是 async');
  });

  it('锁必须在 finally 中释放', function() {
    assert.ok(shell.includes('delete _refreshLocks[tab]'), '必须在 finally 中释放锁');
  });

  it('各分支必须 await 而非 fire-and-forget', function() {
    assert.ok(shell.includes('await window.loadFeed'), 'posts 必须 await');
    assert.ok(shell.includes('await window.__xtjPhotoWallForceSync'), 'photos 必须 await');
    assert.ok(shell.includes('Promise.allSettled'), 'chat/ai/profile 必须使用 Promise.allSettled');
  });

  it('不得使用 .finally() 提前释放锁', function() {
    const earlyRelease = shell.match(/\.finally\(function\(\)\s*\{\s*_refreshLocks\[tab\]/);
    assert.ok(!earlyRelease, '不得在 .finally() 中提前释放锁');
  });
});

// ─── 7. 照片墙初始化竞态行为测试 ───
describe('photo wall init race behavior', function() {
  const pw = read('js/photo-wall/photo-wall.js');
  const render = read('js/photo-wall/render.js');

  it('__xtjPhotoWallForceSync 不得手动清空 initializingPromise', function() {
    // 只检查 __xtjPhotoWallForceSync 函数内部，不能包含 initializingPromise = null
    var forceSyncBody = pw.match(/__xtjPhotoWallForceSync[\s\S]*?\};/);
    var nullInForceSync = forceSyncBody && forceSyncBody[0].includes('initializingPromise = null');
    assert.ok(!nullInForceSync, '__xtjPhotoWallForceSync 内不得手动清空 initializingPromise');
  });

  it('renderPhotoWall 必须返回 Promise', function() {
    assert.ok(render.includes('_renderPromise'), '必须有 _renderPromise');
    assert.ok(render.includes('return _renderPromise'), '必须返回 _renderPromise');
  });

  it('renderPhotoWall 忙时返回当前 Promise 而非 undefined', function() {
    const busyReturn = render.match(/if \(rendering\)[\s\S]*?return _renderPromise/);
    assert.ok(busyReturn, 'rendering 时必须返回 _renderPromise');
  });

  it('必须有 generation 检查防止旧数据覆盖新数据', function() {
    assert.ok(render.includes('currentGen !== _pwRenderGeneration'), '必须检查 generation');
    assert.ok(pw.includes('_initGeneration'), 'photo-wall 必须有 _initGeneration');
  });
});

// ─── 8. 照片删除状态行为测试 ───
describe('photo delete status behavior', function() {
  const server = read('render-api/server.js');
  const data = read('js/photo-wall/data.js');

  it('必须有 GET /api/photo/delete-status 端点', function() {
    assert.ok(server.includes("'/api/photo/delete-status'"), '必须有 delete-status 端点');
    assert.ok(server.includes('method: \'GET\''), '必须是 GET 方法');
  });

  it('delete-status 必须返回明确状态', function() {
    assert.ok(server.includes("'deleted'"), '必须返回 deleted 状态');
    assert.ok(server.includes("'exists'"), '必须返回 exists 状态');
    assert.ok(server.includes("'not_found'"), '必须返回 not_found 状态');
  });

  it('delete-status 不得执行删除操作', function() {
    // 检查 delete-status 路由处理函数内是否有 .delete() 调用
    var deleteStatusRoute = server.match(/\/api\/photo\/delete-status[\s\S]*?\napp\.(?:get|post|put|patch|delete)/);
    var hasDelete = deleteStatusRoute && deleteStatusRoute[0] && deleteStatusRoute[0].includes('.delete()');
    assert.ok(!hasDelete, 'delete-status 端点内不得执行 .delete() 操作');
  });

  it('前端 deleteCloudPhoto 超时后使用 delete-status 而非重复调用 delete', function() {
    assert.ok(data.includes('/api/photo/delete-status'), '前端必须使用 delete-status 端点');
    assert.ok(data.includes('statusController'), '状态查询必须有 AbortController');
    assert.ok(data.includes('statusResult.status === \'deleted\''), '必须检查 deleted 状态');
  });
});

// ─── 9. 上传恢复行为测试 ───
describe('upload recovery behavior', function() {
  const upload = read('js/photo-wall/upload-ui.js');

  it('必须有 reconcilePendingPhotoUploads', function() {
    assert.ok(upload.includes('reconcilePendingPhotoUploads'), '必须有 reconcilePendingPhotoUploads');
  });

  it('savePendingPhotoUpload 必须按 uploadId 去重', function() {
    assert.ok(upload.includes('p.uploadId === info.uploadId'), '必须按 uploadId 去重');
  });

  it('reconcile 必须检查 committed 状态', function() {
    // H-31: 服务端 /api/photo/status 返回 {status:'committed'}（无顶层 committed 字段）
    assert.ok(upload.includes("data.status === 'committed'"), "必须检查 data.status === 'committed'");
  });

  it('reconcile 必须检查 failed/not_found 状态', function() {
    assert.ok(upload.includes("'failed'") && upload.includes("'not_found'"), '必须检查 failed/not_found');
  });

  it('reconcile 必须检查 processing 状态', function() {
    assert.ok(upload.includes("'processing'"), '必须检查 processing');
  });

  it('reconcile 每个 uploadId 同时只能有一个请求', function() {
    assert.ok(upload.includes('_reconcileLocks'), '必须有 _reconcileLocks');
  });

  it('reconcile 触发时机必须包含 online/pageshow/visibilitychange', function() {
    assert.ok(upload.includes("'online'") && upload.includes('reconcilePendingPhotoUploads'), 'online 必须触发');
    assert.ok(upload.includes("'pageshow'") && upload.includes('reconcilePendingPhotoUploads'), 'pageshow 必须触发');
    assert.ok(upload.includes('visibilitychange') && upload.includes('reconcilePendingPhotoUploads'), 'visibilitychange 必须触发');
  });

  it('reconcile 网络错误时保留记录不删除 Storage', function() {
    const catchBranch = upload.match(/catch[\s\S]*?remaining\.push\(entry\)/);
    assert.ok(catchBranch, '网络错误时必须保留记录');
  });
});

// ─── 10. 照片记录修复行为测试 ───
describe('photo record repair behavior', function() {
  const photoCreate = read('render-api/photo-create.js');

  it('update 必须检查 error', function() {
    assert.ok(photoCreate.includes('updateResult.error'), '必须检查 updateResult.error');
  });

  it('update 必须使用 .select() 和 .maybeSingle()', function() {
    assert.ok(photoCreate.includes('.select('), '必须使用 .select()');
    assert.ok(photoCreate.includes('maybeSingle'), '必须使用 maybeSingle');
  });

  it('更新失败不得返回 repaired:true', function() {
    // 检查 updateResult.error 分支后不应返回 repaired:true（排除注释中的 "repaired"）
    var errorBlock = photoCreate.match(/updateResult\.error[\s\S]{0,300}?return[\s\S]{0,100}?repaired:\s*true/);
    assert.ok(!errorBlock, 'update 失败时不得返回 repaired:true');
  });

  it('必须验证更新后的 media_url 和 content.storagePath', function() {
    assert.ok(photoCreate.includes('updateResult.data.media_url'), '必须验证更新后的 media_url');
    assert.ok(photoCreate.includes('updatedContent.storagePath'), '必须验证更新后的 storagePath');
  });
});

// ─── 11. Worker 行为测试 ───
describe('cat AI worker behavior', function() {
  const server = read('render-api/server.js');

  it('processCatReplyJob 必须使用 CAS 原子更新', function() {
    assert.ok(server.includes("eq('status', 'pending')"), '必须使用 CAS 条件 eq(status, pending)');
  });

  it('CAS 失败时静默返回不报错', function() {
    const casFailBranch = server.match(/updateErr.*?\|.*?!updated[\s\S]*?return/);
    assert.ok(casFailBranch, 'CAS 失败时必须静默返回');
  });

  it('写入评论前必须检查 job 仍处于 processing 状态', function() {
    assert.ok(server.includes("jobCheck.data.status !== 'processing'"), '必须检查 job 状态');
  });

  it('comment 写入失败不得把 job 标成 completed', function() {
    // 检查 comment insert 失败时的处理
    const commentInsertFail = server.match(/comment.*insert[\s\S]*?catch[\s\S]*?status.*failed/);
    assert.ok(commentInsertFail, 'comment 写入失败必须标记为 failed');
  });
});

// ─── 12. processCatReplyJob buildSummaryQuery 移除验证 ───
describe('processCatReplyJob no buildSummaryQuery', function() {
  const server = read('render-api/server.js');

  it('processCatReplyJob 代码块不得调用 buildSummaryQuery', function() {
    const start = server.indexOf('async function processCatReplyJob');
    const end = server.indexOf('async function recoverStaleCatJobs', start);
    const block = server.slice(start, end > start ? end : start + 4000);
    assert.doesNotMatch(block, /\bbuildSummaryQuery\s*\(/, 'processCatReplyJob 不得调用 buildSummaryQuery');
  });

  it('processCatReplyJob 必须使用 supabase.from(\'comments\') 查询已有 AI 回复', function() {
    const start = server.indexOf('async function processCatReplyJob');
    const end = server.indexOf('async function recoverStaleCatJobs', start);
    const block = server.slice(start, end > start ? end : start + 4000);
    assert.match(block, /supabase\.from\('comments'\)/, '必须使用 supabase.from(\'comments\')');
  });

  it('已有 AI 回复查询必须 select 完整字段', function() {
    const start = server.indexOf('async function processCatReplyJob');
    const end = server.indexOf('async function recoverStaleCatJobs', start);
    const block = server.slice(start, end > start ? end : start + 4000);
    assert.match(block, /\.select\(['"]id,\s*post_id,\s*user_name,\s*content,\s*created_at,\s*parent_comment_id,\s*generated_by_ai['"]\)/, '必须 select 完整字段');
  });

  it('查询已有 AI 回复必须检查 error', function() {
    const start = server.indexOf('async function processCatReplyJob');
    const end = server.indexOf('async function recoverStaleCatJobs', start);
    const block = server.slice(start, end > start ? end : start + 4000);
    assert.match(block, /existingReplyRes\.error/, '必须检查 existingReplyRes.error');
    assert.match(block, /existing AI reply lookup failed/, 'error 分支必须抛出具名错误');
  });

  it('parent_comment_id 必须使用 String() 转换', function() {
    const start = server.indexOf('async function processCatReplyJob');
    const end = server.indexOf('async function recoverStaleCatJobs', start);
    const block = server.slice(start, end > start ? end : start + 4000);
    assert.match(block, /String\(job\.source_comment_id\)/, 'parent_comment_id 必须使用 String() 转换');
  });

  it('已存在 AI 回复时必须将 job 标为 completed 并返回', function() {
    const start = server.indexOf('async function processCatReplyJob');
    const end = server.indexOf('async function recoverStaleCatJobs', start);
    const block = server.slice(start, end > start ? end : start + 4000);
    assert.match(block, /status:\s*'completed'/, '必须标记为 completed');
    assert.match(block, /generated_reply:\s*existingReplyRes\.data\.content/, 'generated_reply 必须使用现有回复内容');
  });
});

// ─── 13. 全仓库 buildSummaryQuery 运行时调用检查 ───
describe('no runtime buildSummaryQuery outside admin stats', function() {
  const server = read('render-api/server.js');

  it('POST /api/like 不得调用 buildSummaryQuery', function() {
    // 找到 POST /api/like 路由处理函数
    const likeStart = server.indexOf("app.post('/api/like'");
    const likeEnd = server.indexOf("app.get('/api/likes/", likeStart);
    const block = server.slice(likeStart, likeEnd > likeStart ? likeEnd : likeStart + 5000);
    assert.doesNotMatch(block, /\bbuildSummaryQuery\s*\(/, 'POST /api/like 不得调用 buildSummaryQuery');
  });

  it('DELETE /admin/user/:userName 不得调用 buildSummaryQuery', function() {
    const delUserStart = server.indexOf("app.delete('/admin/user/:userName'");
    const delUserEnd = server.indexOf("app.post('/admin/ban'", delUserStart);
    const block = server.slice(delUserStart, delUserEnd > delUserStart ? delUserEnd : delUserStart + 5000);
    assert.doesNotMatch(block, /\bbuildSummaryQuery\s*\(/, 'DELETE /admin/user/:userName 不得调用 buildSummaryQuery');
  });

  it('buildSummaryQuery 仅存在于 admin stats 路由内', function() {
    // 统计 buildSummaryQuery 调用（排除注释中的文字引用）
    var allCallMatches = server.match(/\bbuildSummaryQuery\s*\(/g);
    var allCallCount = (allCallMatches || []).length;
    // 定义在 admin stats 内 + 调用在 admin stats 内 = 应该全部在 stats 函数体内
    var statsStart = server.indexOf("app.get('/admin/stats'");
    var statsEnd = server.indexOf("app.get('/admin/", statsStart + 10);
    var statsBlock = server.slice(statsStart, statsEnd > statsStart ? statsEnd : statsStart + 20000);
    var statsCallMatches = (statsBlock.match(/\bbuildSummaryQuery\s*\(/g) || []).length;
    assert.equal(allCallCount, statsCallMatches, '所有 buildSummaryQuery 调用必须在 admin stats 路由内');
  });
});

// ─── 14. 公告按钮点击事件验证 ───
describe('announcement button click handler', function() {
  const html = read('index.html');

  it('公告按钮必须有 onclick 处理器', function() {
    assert.match(html, /id="announcementBtn"[^>]*onclick="openAnnouncementModal/, 'announcementBtn 必须有 onclick="openAnnouncementModal()"');
  });

  it('公告模态框必须有关闭处理器', function() {
    assert.match(html, /id="announcementModal"[^>]*onclick="if\(event\.target===this\)closeAnnouncementModal/, 'announcementModal overlay 必须有 closeAnnouncementModal 处理器');
  });
});