'use strict';
// Group chat API (user request 2026-11-09). Every permission rule lives in the
// chat_group_* database functions (supabase/migrations/20261109120000_chat_groups.sql);
// this router only validates input shapes, uploads images to the private chat
// bucket, signs image URLs for members and fans out realtime notifications.
const crypto = require('crypto');

const GROUP_BUCKET = 'dm-private';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_FORMATS = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[a-f0-9]{32}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const ACTIONS = new Set(['set_nickname', 'set_muted', 'set_pinned', 'set_background', 'clear_history', 'mark_read', 'hide_message',
  'leave', 'withdraw', 'invite', 'approve_request', 'reject_request', 'list_requests', 'rename', 'announce', 'remove_member',
  'set_admin', 'unset_admin', 'ban', 'unban', 'transfer', 'set_mute_all', 'set_join_approval', 'set_invite_policy', 'reset_qr', 'dissolve']);
const REPORT_CATEGORIES = new Set(['spam', 'fraud', 'porn', 'violence', 'harassment', 'illegal', 'other']);

const MESSAGES = {
  account_unavailable: [401, '账号状态已失效，请重新登录'],
  not_member: [404, '你不在这个群聊中'],
  forbidden: [403, '只有群主或管理员可以进行此操作'],
  group_full: [409, '群成员已达上限（1000 人）'],
  members_required: [400, '请至少选择一位好友'],
  friend_required: [403, '只能邀请互相是好友且未拉黑的用户'],
  already_member: [409, '所选好友都已经在群里了'],
  invalid_name: [400, '群名称需为 1～30 个字'],
  invalid_nickname: [400, '群昵称最多 20 个字'],
  invalid_background: [400, '聊天背景无效'],
  announcement_too_long: [400, '群公告最多 2000 字'],
  empty_content: [400, '消息内容不能为空'],
  content_too_long: [400, '消息最多 2000 字'],
  invalid_reply: [400, '引用的消息已不可用'],
  invalid_media: [400, '图片无效'],
  invalid_kind: [400, '消息类型无效'],
  muted_all: [403, '群主已开启全员禁言'],
  banned: [403, '你已被禁言'],
  dissolved: [409, '该群聊已解散'],
  withdraw_expired: [409, '超过 2 分钟的消息不能撤回'],
  message_not_found: [404, '消息不存在或已不可用'],
  member_not_found: [404, '该成员已不在群里'],
  invalid_target: [400, '不能对自己执行该操作'],
  admin_limit: [409, '管理员最多 15 人'],
  request_not_found: [404, '该申请已处理'],
  user_not_found: [404, '该用户已注销'],
  invalid_token: [404, '二维码已失效或群聊不存在'],
  note_too_long: [400, '申请备注最多 120 字'],
  invalid_query: [400, '请输入 1～60 个字的关键词'],
  invalid_action: [400, '不支持的操作']
};

function fail(res, code, extra) {
  const entry = MESSAGES[code] || [400, '操作失败'];
  return res.status(entry[0]).json(Object.assign({ ok: false, code: code || 'group_error', error: entry[1] }, extra || {}));
}

function unavailable(res, error, where) {
  console.error('[chat-groups]', where, error && (error.code || error.message) || 'database_error');
  return res.status(503).json({ ok: false, code: 'group_unavailable', error: '群聊服务暂时不可用，请稍后重试', retryable: true });
}

function cleanText(value, max) {
  const text = String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return text.length > max ? null : text;
}

function cleanNames(list, max) {
  if (!Array.isArray(list) || list.length > max) return null;
  const out = [];
  for (const item of list) {
    const name = String(item == null ? '' : item).trim();
    if (!name || name.length > 64) return null;
    if (out.indexOf(name) < 0) out.push(name);
  }
  return out;
}

function createChatGroupsRouter(options) {
  const { express, supabase, authenticateUser, rateLimit } = options;
  const publishMany = typeof options.publishMany === 'function' ? options.publishMany : function () {};
  const signPrivate = options.signPrivate;
  const removePrivate = typeof options.removePrivate === 'function' ? options.removePrivate : async function () {};
  const sendBlocked = typeof options.sendBlocked === 'function' ? options.sendBlocked : function () { return null; };
  const sharp = options.sharp;
  const reportMarker = options.reportMarker || '__report__';
  const router = express.Router();

  async function rpc(name, args) {
    const result = await supabase.rpc(name, args);
    if (!result || result.error) throw (result && result.error) || new Error(name + '_failed');
    if (!result.data || typeof result.data !== 'object') throw new Error(name + '_invalid');
    return result.data;
  }

  function notify(names, payload) {
    if (!Array.isArray(names) || !names.length) return;
    publishMany(names.filter(function (n) { return typeof n === 'string' && n; }), 'chat-group', payload);
  }

  // Members only ever receive a short-lived signed URL; the storage path stays server-side.
  async function hydrate(messages) {
    const list = Array.isArray(messages) ? messages : [];
    for (let offset = 0; offset < list.length; offset += 8) {
      await Promise.all(list.slice(offset, offset + 8).map(async function (msg) {
        const path = msg && msg.media_path;
        if (msg) delete msg.media_path;
        if (!path || !msg.has_media || typeof signPrivate !== 'function') return;
        try { msg.media_url = await signPrivate(path); } catch (_) { msg.media_unavailable = true; }
      }));
    }
    return list;
  }

  function groupId(req, res) {
    const id = String(req.params.id || '');
    if (!UUID_RE.test(id)) { fail(res, 'not_member'); return null; }
    return id;
  }

  router.get('/', rateLimit(60000, 120), authenticateUser, async function (req, res) {
    try {
      const data = await rpc('chat_group_list', { p_actor: req.userName });
      if (!data.ok) return fail(res, data.code);
      return res.json({ ok: true, groups: data.groups || [] });
    } catch (error) { return unavailable(res, error, 'list'); }
  });

  router.post('/', rateLimit(3600000, 20), authenticateUser, async function (req, res) {
    try {
      const blocked = sendBlocked(req);
      if (blocked) return res.status(blocked.status || 403).json({ ok: false, code: blocked.code, error: blocked.message });
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const name = cleanText(body.name, 30);
      const members = cleanNames(body.members, 999);
      if (name === null) return fail(res, 'invalid_name');
      if (!members || !members.length) return fail(res, members && members.length === 0 ? 'members_required' : 'group_full');
      const data = await rpc('chat_group_create', { p_actor: req.userName, p_name: name.trim(), p_members: members });
      if (!data.ok) return fail(res, data.code, { rejected: data.rejected || [] });
      notify(data.notify, { kind: 'created', group_id: data.group_id });
      return res.json({ ok: true, group_id: data.group_id, name: data.name, rejected: data.rejected || [] });
    } catch (error) { return unavailable(res, error, 'create'); }
  });

  router.get('/join/:token', rateLimit(60000, 30), authenticateUser, async function (req, res) {
    try {
      const token = String(req.params.token || '');
      if (!TOKEN_RE.test(token)) return fail(res, 'invalid_token');
      const data = await rpc('chat_group_token_preview', { p_actor: req.userName, p_token: token });
      if (!data.ok) return fail(res, data.code);
      return res.json({ ok: true, group: data.group });
    } catch (error) { return unavailable(res, error, 'preview'); }
  });

  router.post('/join/:token', rateLimit(60000, 10), authenticateUser, async function (req, res) {
    try {
      const token = String(req.params.token || '');
      if (!TOKEN_RE.test(token)) return fail(res, 'invalid_token');
      const blocked = sendBlocked(req);
      if (blocked) return res.status(blocked.status || 403).json({ ok: false, code: blocked.code, error: blocked.message });
      const note = cleanText(req.body && req.body.note, 120);
      if (note === null) return fail(res, 'note_too_long');
      const data = await rpc('chat_group_token_join', { p_actor: req.userName, p_token: token, p_note: note || null });
      if (!data.ok) return fail(res, data.code);
      notify(data.notify, { kind: data.pending ? 'request' : 'members', group_id: data.group_id });
      return res.json({ ok: true, group_id: data.group_id, joined: !!data.joined, pending: !!data.pending });
    } catch (error) { return unavailable(res, error, 'join'); }
  });

  router.get('/:id', rateLimit(60000, 120), authenticateUser, async function (req, res) {
    const id = groupId(req, res); if (!id) return;
    try {
      const data = await rpc('chat_group_detail', { p_actor: req.userName, p_group: id });
      if (!data.ok) return fail(res, data.code);
      return res.json({ ok: true, group: data.group, me: data.me, members: data.members || [] });
    } catch (error) { return unavailable(res, error, 'detail'); }
  });

  router.get('/:id/messages', rateLimit(60000, 240), authenticateUser, async function (req, res) {
    const id = groupId(req, res); if (!id) return;
    try {
      const q = req.query || {};
      const before = String(q.before || ''), after = String(q.after || '');
      const beforeId = String(q.before_id || ''), afterId = String(q.after_id || '');
      if ((before && !ISO_RE.test(before)) || (after && !ISO_RE.test(after)) ||
          (beforeId && !UUID_RE.test(beforeId)) || (afterId && !UUID_RE.test(afterId))) {
        return res.status(400).json({ ok: false, code: 'invalid_cursor', error: '无效的分页游标' });
      }
      const limit = Math.min(Math.max(parseInt(q.limit || '50', 10) || 50, 1), 200);
      const data = await rpc('chat_group_messages_page', {
        p_actor: req.userName, p_group: id, p_limit: limit,
        p_before_at: before || null, p_before_id: beforeId || null, p_after_at: after || null, p_after_id: afterId || null
      });
      if (!data.ok) return fail(res, data.code);
      return res.json({ ok: true, messages: await hydrate(data.messages), has_more: !!data.has_more });
    } catch (error) { return unavailable(res, error, 'messages'); }
  });

  router.get('/:id/search', rateLimit(60000, 30), authenticateUser, async function (req, res) {
    const id = groupId(req, res); if (!id) return;
    try {
      const query = String(req.query.q || '').trim();
      if (!query || query.length > 60) return fail(res, 'invalid_query');
      const before = String(req.query.before || '');
      if (before && !ISO_RE.test(before)) return res.status(400).json({ ok: false, code: 'invalid_cursor', error: '无效的分页游标' });
      const data = await rpc('chat_group_search', { p_actor: req.userName, p_group: id, p_query: query, p_limit: 30, p_before_at: before || null });
      if (!data.ok) return fail(res, data.code);
      return res.json({ ok: true, messages: await hydrate(data.messages) });
    } catch (error) { return unavailable(res, error, 'search'); }
  });

  async function deliver(res, req, id, kind, body, meta, replyTo, clientId) {
    const data = await rpc('chat_group_send', {
      p_actor: req.userName, p_group: id, p_kind: kind, p_body: body, p_meta: meta,
      p_reply_to: replyTo || null, p_client_id: clientId || null
    });
    if (!data.ok) return { failed: data };
    if (!data.idempotent) notify(data.notify, { kind: 'message', group_id: id, message_id: data.message && data.message.id });
    await hydrate([data.message]);
    return { message: data.message, idempotent: !!data.idempotent };
  }

  router.post('/:id/messages', rateLimit(60000, 60), authenticateUser, async function (req, res) {
    const id = groupId(req, res); if (!id) return;
    try {
      const blocked = sendBlocked(req);
      if (blocked) return res.status(blocked.status || 403).json({ ok: false, code: blocked.code, error: blocked.message });
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const text = cleanText(body.body, 2000);
      if (text === null) return fail(res, 'content_too_long');
      if (!text.trim()) return fail(res, 'empty_content');
      const replyTo = body.reply_to ? String(body.reply_to) : '';
      if (replyTo && !UUID_RE.test(replyTo)) return fail(res, 'invalid_reply');
      const clientId = body.client_id ? String(body.client_id) : '';
      if (clientId && !CLIENT_ID_RE.test(clientId)) return res.status(400).json({ ok: false, code: 'invalid_client_id', error: '消息标识无效' });
      const mentions = cleanNames(body.mentions || [], 50);
      if (!mentions) return res.status(400).json({ ok: false, code: 'invalid_mentions', error: '@ 成员无效' });
      const result = await deliver(res, req, id, 'text', text, mentions.length ? { mentions: mentions } : {}, replyTo, clientId);
      if (result.failed) return fail(res, result.failed.code, result.failed.banned_until ? { banned_until: result.failed.banned_until } : null);
      return res.json({ ok: true, message: result.message, idempotent: result.idempotent });
    } catch (error) { return unavailable(res, error, 'send'); }
  });

  router.post('/:id/images', rateLimit(3600000, 60), authenticateUser,
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/octet-stream'], limit: MAX_IMAGE_BYTES }),
    async function (req, res) {
      const id = groupId(req, res); if (!id) return;
      let storagePath = '';
      try {
        const blocked = sendBlocked(req);
        if (blocked) return res.status(blocked.status || 403).json({ ok: false, code: blocked.code, error: blocked.message });
        const clientId = req.query.client_id ? String(req.query.client_id) : '';
        if (clientId && !CLIENT_ID_RE.test(clientId)) return res.status(400).json({ ok: false, code: 'invalid_client_id', error: '消息标识无效' });
        const replyTo = req.query.reply_to ? String(req.query.reply_to) : '';
        if (replyTo && !UUID_RE.test(replyTo)) return fail(res, 'invalid_reply');
        const buffer = req.body;
        if (!Buffer.isBuffer(buffer) || !buffer.length) return fail(res, 'invalid_media');
        // Check membership and speaking rights before storing anything.
        const allowed = await rpc('chat_group_can_send', { p_actor: req.userName, p_group: id });
        if (!allowed.ok) return fail(res, allowed.code, allowed.banned_until ? { banned_until: allowed.banned_until } : null);
        let meta;
        try { meta = await sharp(buffer, { animated: true, limitInputPixels: 100000000 }).metadata(); } catch (_) { meta = null; }
        const format = meta && String(meta.format || '').toLowerCase();
        const mimeType = format && IMAGE_FORMATS[format];
        if (!mimeType) return res.status(400).json({ ok: false, code: 'invalid_image', error: '只支持 JPG、PNG、WebP、GIF 图片' });
        const uidHash = crypto.createHash('sha256').update(String(req.userName)).digest('hex').slice(0, 12);
        storagePath = 'chat/' + uidHash + '_private_grp' + crypto.randomUUID().replace(/-/g, '') + '.' + (format === 'jpeg' ? 'jpg' : format);
        const upload = await supabase.storage.from(GROUP_BUCKET).upload(storagePath, buffer, { contentType: mimeType, cacheControl: '31536000', upsert: false });
        if (!upload || upload.error) { storagePath = ''; return unavailable(res, upload && upload.error, 'image_upload'); }
        const height = meta.pageHeight && meta.pages > 1 ? meta.pageHeight : meta.height;
        const result = await deliver(res, req, id, 'image', '', {
          storage_path: storagePath, mime_type: mimeType, width: meta.width || null, height: height || null, size: buffer.length
        }, replyTo, clientId);
        if (result.failed) {
          await removePrivate([storagePath]).catch(function () {});
          return fail(res, result.failed.code);
        }
        if (result.idempotent) await removePrivate([storagePath]).catch(function () {});
        return res.json({ ok: true, message: result.message, idempotent: result.idempotent });
      } catch (error) {
        if (storagePath) await removePrivate([storagePath]).catch(function () {});
        return unavailable(res, error, 'image');
      }
    });

  router.post('/:id/actions', rateLimit(60000, 60), authenticateUser, async function (req, res) {
    const id = groupId(req, res); if (!id) return;
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const action = String(body.action || '');
      if (!ACTIONS.has(action)) return fail(res, 'invalid_action');
      const args = {};
      if (body.message_id !== undefined) { if (!UUID_RE.test(String(body.message_id))) return fail(res, 'message_not_found'); args.message_id = String(body.message_id); }
      if (body.request_id !== undefined) { if (!UUID_RE.test(String(body.request_id))) return fail(res, 'request_not_found'); args.request_id = String(body.request_id); }
      if (body.user_name !== undefined) { const n = String(body.user_name).trim(); if (!n || n.length > 80) return fail(res, 'member_not_found'); args.user_name = n; }
      if (body.members !== undefined) { const m = cleanNames(body.members, 999); if (!m) return fail(res, 'group_full'); args.members = m; }
      if (body.name !== undefined) { const n = cleanText(body.name, 30); if (n === null) return fail(res, 'invalid_name'); args.name = n; }
      if (body.nickname !== undefined) { const n = cleanText(body.nickname, 20); if (n === null) return fail(res, 'invalid_nickname'); args.nickname = n; }
      if (body.announcement !== undefined) { const n = cleanText(body.announcement, 2000); if (n === null) return fail(res, 'announcement_too_long'); args.announcement = n; }
      if (body.background !== undefined) { const n = body.background === null ? '' : String(body.background); if (n && !/^[a-z0-9-]{1,24}$/.test(n)) return fail(res, 'invalid_background'); args.background = n; }
      if (body.minutes !== undefined) { const n = Number(body.minutes); if (!Number.isInteger(n) || n < 1 || n > 43200) return res.status(400).json({ ok: false, code: 'invalid_minutes', error: '禁言时长无效' }); args.minutes = n; }
      ['muted', 'pinned', 'enabled'].forEach(function (key) { if (body[key] !== undefined) args[key] = body[key] === true; });
      if (body.policy !== undefined) args.policy = body.policy === 'admins' ? 'admins' : 'all';
      if (['invite', 'rename', 'announce'].indexOf(action) >= 0) {
        const blocked = sendBlocked(req);
        if (blocked) return res.status(blocked.status || 403).json({ ok: false, code: blocked.code, error: blocked.message });
      }
      const data = await rpc('chat_group_action', { p_actor: req.userName, p_group: id, p_action: action, p_args: args });
      if (!data.ok) return fail(res, data.code, data.rejected ? { rejected: data.rejected } : null);
      if (action === 'withdraw' && data.storage_path) await removePrivate([data.storage_path]).catch(function () {});
      notify(data.notify, { kind: action, group_id: id, message_id: args.message_id || undefined });
      const out = { ok: true };
      ['message', 'added', 'pending', 'rejected', 'requests', 'nickname', 'left'].forEach(function (key) { if (data[key] !== undefined) out[key] = data[key]; });
      if (out.message) await hydrate([out.message]);
      return res.json(out);
    } catch (error) { return unavailable(res, error, 'action'); }
  });

  // Complaints go into the existing report queue so the admin panel sees them.
  router.post('/:id/report', rateLimit(60000, 5), authenticateUser, async function (req, res) {
    const id = groupId(req, res); if (!id) return;
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const category = String(body.category || '');
      if (!REPORT_CATEGORIES.has(category)) return res.status(400).json({ ok: false, code: 'invalid_category', error: '请选择投诉原因' });
      const reason = cleanText(body.reason, 500);
      if (reason === null) return res.status(400).json({ ok: false, code: 'reason_too_long', error: '补充说明最多 500 字' });
      const detail = await rpc('chat_group_detail', { p_actor: req.userName, p_group: id });
      if (!detail.ok) return fail(res, detail.code);
      const content = JSON.stringify({
        target_type: 'group', target_id: id, target_user: String(detail.group.owner || '').slice(0, 50),
        report_category: category,
        report_reason: ('【群聊：' + String(detail.group.name || '') + '】' + (reason || '')).slice(0, 500),
        status: 'pending'
      });
      const inserted = await supabase.from('posts').insert([{
        user_name: req.userName, content: content, media_type: reportMarker,
        actor_key: reportMarker + ':' + crypto.randomUUID()
      }]);
      if (inserted && inserted.error) return unavailable(res, inserted.error, 'report');
      return res.json({ ok: true });
    } catch (error) { return unavailable(res, error, 'report'); }
  });

  return router;
}

module.exports = { createChatGroupsRouter, GROUP_BUCKET, MAX_IMAGE_BYTES };
