'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMOJI = new Set(['❤️', '👍', '😂', '😮', '😢', '🔥']);
const { createChatTranscription } = require('./chat-transcription');
const FIELDS = 'id,user_name,content,media_url,media_type,actor_key,views,created_at';
function name(value) { const n = String(value || '').trim(); return n.length <= 64 ? n : ''; }
function date(value, end) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('invalid_date');
  const d = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== value) throw new Error('invalid_date');
  if (end) d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}
async function data(query) { const r = await query; if (!r || r.error) throw (r && r.error || new Error('database_error')); return r.data; }

function createChatFeatures(options) {
  const { express, supabase, authenticateUser, rateLimit, publishChatEvent } = options;
  const router = express.Router();
  const transcription = createChatTranscription(options);
  router.use(authenticateUser);
  if (rateLimit) router.use(rateLimit(60000, 90));
  async function context(actor, peer) {
    const state = await data(supabase.rpc('chat_get_conversation_state', { p_actor_name: actor, p_peer_name: peer }));
    if (!state || state.status !== 'ok' || state.deleted || !state.conversation_id) return null;
    const user = await data(supabase.from('chat_users').select('id').eq('user_name', actor).eq('is_registered', true).is('deleted_at', null).maybeSingle());
    return user ? { state, actorId: user.id } : null;
  }
  async function visible(ctx, id) {
    let m = await data(supabase.from('chat_messages').select('*').eq('conversation_id', ctx.state.conversation_id).eq('id', id).is('withdrawn_at', null).maybeSingle());
    if (!m) m = await data(supabase.from('chat_messages').select('*').eq('conversation_id', ctx.state.conversation_id).eq('legacy_post_id', id).is('withdrawn_at', null).maybeSingle());
    if (!m || (ctx.state.cleared_before && Date.parse(m.sent_at) <= Date.parse(ctx.state.cleared_before))) return null;
    const s = await data(supabase.from('chat_message_user_state').select('hidden_at').eq('message_id', m.id).eq('user_id', ctx.actorId).maybeSingle());
    return s && s.hidden_at ? null : m;
  }
  async function validateReply(actor, peer, id) {
    if (!UUID.test(String(id || ''))) return null;
    const ctx = await context(actor, peer);
    const m = ctx && await visible(ctx, id);
    return m ? { id: m.id, sender_name: m.sender_name_snapshot, text: String(m.body || '').slice(0, 500), message_type: m.message_type } : null;
  }
  function publish(actor, peer, kind, id) {
    if (!publishChatEvent) return;
    publishChatEvent(actor, 'chat-state', { kind, peer, message_id: id });
    publishChatEvent(peer, 'chat-state', { kind, peer: actor, message_id: id });
  }
  function fail(res, err) {
    console.error('[chat-features]', err && err.code || 'database_error');
    return res.status(503).json({ ok: false, retryable: true, error: '聊天功能暂时不可用，请重试' });
  }
  router.get('/voice-url', async (req, res) => {
    const peer = name(req.query.peer), id = String(req.query.message_id || '');
    if (!peer || !UUID.test(id)) return res.status(400).json({ ok: false });
    try {
      const ctx = await context(req.userName, peer), message = ctx && await visible(ctx, id);
      if (!message || message.message_type !== 'audio') return res.status(404).json({ ok: false });
      const media = message.payload && message.payload.media;
      if (!media || !options.privateStorage) return res.status(404).json({ ok: false });
      const url = media.bucket === 'dm-private'
        ? await options.privateStorage.sign(media.storage_path, true) : media.url;
      if (!url || !/^https:\/\//i.test(url)) return res.status(404).json({ ok: false });
      res.json({ ok: true, url });
    } catch (error) { fail(res, error); }
  });
  router.get('/history/search', async (req, res) => {
    let from, to;
    const peer = req.query.peer ? name(req.query.peer) : null;
    const q = String(req.query.q || '').trim(), kind = String(req.query.kind || 'all');
    const at = req.query.cursor_at || null, id = req.query.cursor_id || null;
    try { from = date(req.query.from, false); to = date(req.query.to, true); }
    catch (_) { return res.status(400).json({ ok: false, code: 'invalid_date' }); }
    if ((req.query.peer && !peer) || q.length > 120 || (kind === 'all' && q.length < 2) ||
        !['all', 'media', 'image', 'video', 'audio', 'file', 'link'].includes(kind) ||
        (from && to && from > to) || !!at !== !!id || (at && (!Number.isFinite(Date.parse(at)) || !UUID.test(id)))) {
      return res.status(400).json({ ok: false, code: 'invalid_search' });
    }
    try {
      const result = await data(supabase.rpc('chat_search_messages', {
        p_actor_name: req.userName, p_peer_name: peer, p_query: q, p_kind: kind, p_from: from, p_to: to,
        p_before_at: at, p_before_id: id, p_limit: Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30))
      }));
      if (!result || result.status !== 'ok') return res.status(404).json({ ok: false, code: 'not_found' });
      res.json({ ok: true, ...result });
    } catch (e) { fail(res, e); }
  });
  router.get('/history/context', async (req, res) => {
    const peer = name(req.query.peer), id = String(req.query.message_id || '');
    if (!peer || !UUID.test(id)) return res.status(400).json({ ok: false });
    try {
      const ctx = await context(req.userName, peer), focus = ctx && await visible(ctx, id);
      if (!focus) return res.status(404).json({ ok: false });
      async function side(older) {
        const op = older ? 'lt' : 'gt';
        let query = supabase.from('chat_messages').select('id,legacy_post_id,sent_at')
          .eq('conversation_id', ctx.state.conversation_id).is('withdrawn_at', null)
          .or('sent_at.' + op + '.' + focus.sent_at + ',and(sent_at.eq.' + focus.sent_at + ',id.' + op + '.' + focus.id + ')');
        if (ctx.state.cleared_before) query = query.gt('sent_at', ctx.state.cleared_before);
        return data(query.order('sent_at', { ascending: !older }).order('id', { ascending: !older }).limit(100));
      }
      const [older, newer] = await Promise.all([side(true), side(false)]);
      const rows = older.concat([focus], newer), ids = rows.map(m => m.id);
      const hidden = await data(supabase.from('chat_message_user_state').select('message_id')
        .eq('user_id', ctx.actorId).in('message_id', ids).not('hidden_at', 'is', null));
      const hiddenIds = new Set((hidden || []).map(s => s.message_id));
      const a = older.filter(m => !hiddenIds.has(m.id)), b = newer.filter(m => !hiddenIds.has(m.id));
      const window = a.slice(0, 24).reverse().concat([focus], b.slice(0, 24));
      const posts = await data(supabase.from('posts').select(FIELDS).eq('media_type', '__dm__').in('id', window.map(m => m.legacy_post_id).filter(Boolean)));
      const map = new Map((posts || []).map(p => [p.id, p]));
      res.json({ ok: true, data: window.map(m => map.get(m.legacy_post_id)).filter(Boolean), focus_id: focus.legacy_post_id, has_older: a.length > 24, has_newer: b.length > 24 });
    } catch (e) { fail(res, e); }
  });
  router.post('/messages/reply/validate', async (req, res) => {
    try {
      const reply = await validateReply(req.userName, name(req.body.peer), req.body.message_id);
      res.status(reply ? 200 : 404).json(reply ? { ok: true, reply_to: reply } : { ok: false });
    } catch (e) { fail(res, e); }
  });
  router.post('/messages/edit', async (req, res) => {
    const peer = name(req.body.peer), id = String(req.body.message_id || ''), text = String(req.body.text || '').replace(/\0/g, '').trim();
    if (!peer || !UUID.test(id) || !text || text.length > 500) return res.status(400).json({ ok: false });
    try {
      const ctx = await context(req.userName, peer), m = ctx && await visible(ctx, id);
      if (!m || m.sender_name_snapshot !== req.userName || m.message_type !== 'text' || (m.payload&&m.payload.flash)) return res.status(404).json({ ok: false });
      if (!Number.isFinite(Date.parse(m.sent_at)) || Date.now() - Date.parse(m.sent_at) > 900000) return res.status(409).json({ ok: false, error: '超过 15 分钟，无法编辑' });
      const post = await data(supabase.from('posts').select(FIELDS).eq('id', m.legacy_post_id).eq('user_name', req.userName).eq('media_url', peer).eq('media_type', '__dm__').maybeSingle());
      if (!post) return res.status(404).json({ ok: false });
      const payload = JSON.parse(post.content);
      if (payload.withdrawn || payload.media) return res.status(409).json({ ok: false });
      payload.text = text; payload.edited_at = new Date().toISOString();
      const updated = await data(supabase.from('posts').update({ content: JSON.stringify(payload), updated_at: payload.edited_at })
        .eq('id', post.id).eq('content', post.content).eq('user_name', req.userName).select(FIELDS).maybeSingle());
      if (!updated) return res.status(409).json({ ok: false, code: 'edit_conflict', retryable: true });
      publish(req.userName, peer, 'edit', id); res.json({ ok: true, message: updated });
    } catch (e) { fail(res, e); }
  });
  router.get('/messages/reactions', async (req, res) => {
    const peer = name(req.query.peer), raw = String(req.query.ids || '').split(','), ids = [...new Set(raw)];
    if (!peer || !ids.length || ids.length > 80 || ids.length !== raw.length || ids.some(id => !UUID.test(id))) return res.status(400).json({ ok: false });
    try {
      const ctx = await context(req.userName, peer);
      if (!ctx) return res.status(404).json({ ok: false });
      let query = supabase.from('chat_messages').select('id').eq('conversation_id', ctx.state.conversation_id).in('id', ids).is('withdrawn_at', null);
      if (ctx.state.cleared_before) query = query.gt('sent_at', ctx.state.cleared_before);
      const messages = await data(query);
      if (!messages.length) return res.json({ ok: true, items: {} });
      const hidden = await data(supabase.from('chat_message_user_state').select('message_id').eq('user_id', ctx.actorId).in('message_id', messages.map(m => m.id)).not('hidden_at', 'is', null));
      const hiddenIds = new Set(hidden.map(s => s.message_id)), visibleIds = messages.map(m => m.id).filter(id => !hiddenIds.has(id));
      const items = {};
      if (visibleIds.length) {
        const reactions = await data(supabase.from('chat_message_reactions').select('message_id,user_id,emoji').in('message_id', visibleIds));
        for (const r of reactions) {
          const buckets = items[r.message_id] || (items[r.message_id] = []);
          let bucket = buckets.find(b => b.emoji === r.emoji);
          if (!bucket) { bucket = { emoji: r.emoji, count: 0, mine: false }; buckets.push(bucket); }
          bucket.count++; bucket.mine ||= r.user_id === ctx.actorId;
        }
      }
      res.json({ ok: true, items });
    } catch (e) { fail(res, e); }
  });
  router.post('/messages/reactions', async (req, res) => {
    const peer = name(req.body.peer), id = String(req.body.message_id || ''), emoji = String(req.body.emoji || '');
    if (!peer || !UUID.test(id) || (emoji && !EMOJI.has(emoji))) return res.status(400).json({ ok: false });
    try {
      const ctx = await context(req.userName, peer), m = ctx && await visible(ctx, id);
      if (!m) return res.status(404).json({ ok: false });
      await data(emoji ? supabase.from('chat_message_reactions').upsert({ message_id: id, user_id: ctx.actorId, emoji, updated_at: new Date().toISOString() }, { onConflict: 'message_id,user_id' })
        : supabase.from('chat_message_reactions').delete().eq('message_id', id).eq('user_id', ctx.actorId));
      publish(req.userName, peer, 'reaction', id); res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
  router.get('/friends/mutual', async (req, res) => {
    const peer = name(req.query.peer), cursor = req.query.cursor ? name(req.query.cursor) : null;
    if (!peer || (req.query.cursor && !cursor)) return res.status(400).json({ ok: false });
    try {
      const value = await data(supabase.rpc('chat_mutual_friends', { p_actor_name: req.userName, p_peer_name: peer, p_before: cursor }));
      res.status(value.status === 'ok' ? 200 : 404).json({ ok: value.status === 'ok', ...value });
    } catch (e) { fail(res, e); }
  });
  // Device-side Whisper has no API key or per-minute charge. Only the sender
  // can attach its result; updating the legacy projection invokes the existing
  // canonical-message trigger, preserving both readers' normal message flow.
  router.post('/messages/transcript', async (req, res) => {
    const peer = name(req.body.peer), id = String(req.body.message_id || '');
    const text = typeof req.body.text === 'string' ? req.body.text.replace(/\0/g, '').trim() : '';
    if (!peer || !UUID.test(id) || !text || text.length > 5000) return res.status(400).json({ ok: false });
    try {
      const ctx = await context(req.userName, peer), m = ctx && await visible(ctx, id);
      if (!m || m.message_type !== 'audio' || m.sender_name_snapshot !== req.userName) return res.status(404).json({ ok: false });
      // A read receipt can arrive during inference. Retry a compare-and-swap
      // using the newest payload, never replace a receipt or resurrect a withdrawal.
      for (let attempt = 0; attempt < 3; attempt++) {
        const post = await data(supabase.from('posts').select(FIELDS).eq('id', m.legacy_post_id)
          .eq('user_name', req.userName).eq('media_url', peer).eq('media_type', '__dm__').maybeSingle());
        if (!post) return res.status(404).json({ ok: false });
        const payload = JSON.parse(post.content);
        if (payload.withdrawn || !payload.media || payload.media.kind !== 'audio') return res.status(409).json({ ok: false });
        if (payload.transcript) return res.json({ ok: true, message: post });
        payload.transcript = text;
        payload.transcript_source = 'device-whisper-tiny';
        const updated = await data(supabase.from('posts').update({ content: JSON.stringify(payload) })
          .eq('id', post.id).eq('content', post.content).eq('user_name', req.userName).select(FIELDS).maybeSingle());
        if (updated) {
          publish(req.userName, peer, 'transcript', post.id);
          return res.json({ ok: true, message: updated });
        }
      }
      res.status(409).json({ ok: false, retryable: true, code: 'transcript_conflict' });
    } catch (error) { fail(res, error); }
  });
  router.get('/transcription/capabilities', (req, res) => res.json({ ok: true, enabled: true, mode: 'device', server_enabled: transcription.enabled }));
  router.post('/messages/transcribe', async (req, res) => {
    const peer = name(req.body.peer), id = String(req.body.message_id || '');
    if (!peer || !UUID.test(id)) return res.status(400).json({ ok: false });
    if (!transcription.enabled) return res.status(503).json({ ok: false, code: 'transcription_unavailable', error: '服务器语音转写尚未配置' });
    try {
      const ctx = await context(req.userName, peer), m = ctx && await visible(ctx, id);
      if (!m || m.message_type !== 'audio') return res.status(404).json({ ok: false });
      res.status(202).json({ ok: true, ...await transcription.enqueue(m.id) });
    } catch (e) { fail(res, e); }
  });
  return { router, validateReply, transcription };
}
module.exports = { createChatFeatures, UUID, EMOJI };
