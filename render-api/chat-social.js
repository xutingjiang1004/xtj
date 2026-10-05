'use strict';

function cleanName(value) {
  var name = String(value == null ? '' : value).trim();
  return name && name.length <= 64 ? name : '';
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function callChatRpc(supabase, name, args) {
  var result = await supabase.rpc(name, args);
  if (result && result.error) throw result.error;
  return result ? result.data : null;
}

async function getChatRelationship(supabase, userName, peerName) {
  var data = await callChatRpc(supabase, 'chat_get_relationship', {
    p_user_name: userName,
    p_peer_name: peerName
  });
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('chat_relationship_unavailable');
  }
  return data;
}

async function listChatConversations(supabase, userName) {
  var data = await callChatRpc(supabase, 'chat_list_conversations', { p_actor_name: userName });
  if (!Array.isArray(data)) throw new Error('chat_conversations_unavailable');
  return data;
}

async function getChatConversationState(supabase, userName, peerName) {
  var data = await callChatRpc(supabase, 'chat_get_conversation_state', {
    p_actor_name: userName, p_peer_name: peerName
  });
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('chat_conversation_unavailable');
  return data;
}

async function assertCanSendDirectMessage(supabase, senderName, targetName, adminName) {
  var relationship = await getChatRelationship(supabase, senderName, targetName);
  if (relationship.status === 'blocked_by_me' || relationship.status === 'blocked_by_peer') {
    return { ok: false, code: 'chat_blocked', status: relationship.status };
  }
  if (relationship.can_message === true) return { ok: true, relationship: relationship };

  // Preserve the existing administrator support conversation. A block still
  // wins above, so this compatibility path cannot bypass user privacy choices.
  if (adminName && (senderName === adminName || targetName === adminName) &&
      ['none', 'request_sent', 'request_received'].indexOf(relationship.status) >= 0) {
    return { ok: true, relationship: relationship, adminConversation: true };
  }
  return { ok: false, code: 'friend_required', status: relationship.status };
}

function errorResponse(res, error, code) {
  var errCode = error && error.code ? String(error.code).slice(0, 80) : '';
  console.error('[chat-social]', code, errCode || 'database_error');
  return res.status(503).json({
    ok: false,
    error: '好友服务暂时不可用，请稍后重试',
    code: code || 'chat_social_unavailable',
    retryable: true
  });
}

function createChatSocialRouter(options) {
  options = options || {};
  var express = options.express;
  var supabase = options.supabase;
  var authenticateUser = options.authenticateUser;
  var rateLimit = options.rateLimit;
  var publishEvent = typeof options.publishEvent === 'function' ? options.publishEvent : function() {};
  function notifyBoth(actor, peer, kind) {
    publishEvent(actor, 'chat-state', { kind:kind, peer:peer });
    if (peer && peer !== actor) publishEvent(peer, 'chat-state', { kind:kind, peer:actor });
  }
  var router = express.Router();

  function authenticatedReadLimit() { return rateLimit ? rateLimit(60000, 120) : function(req, res, next) { next(); }; }
  function authenticatedWriteLimit() { return rateLimit ? rateLimit(60000, 30) : function(req, res, next) { next(); }; }

  router.use(authenticateUser);

  router.get('/conversations', authenticatedReadLimit(), async function(req, res) {
    try { return res.json({ ok: true, conversations: await listChatConversations(supabase, req.userName) }); }
    catch (e) { return errorResponse(res, e, 'chat_conversations_unavailable'); }
  });

  router.get('/conversations/:peerName', authenticatedReadLimit(), async function(req, res) {
    var peerName = cleanName(req.params.peerName);
    if (!peerName) return res.status(400).json({ ok: false, code: 'invalid_target' });
    try {
      var state = await getChatConversationState(supabase, req.userName, peerName);
      if (state.status === 'not_found') return res.status(404).json({ ok: false, code: 'not_found' });
      return res.json({ ok: true, state: state });
    } catch (e) { return errorResponse(res, e, 'chat_conversation_unavailable'); }
  });

  router.patch('/conversations/:peerName', authenticatedWriteLimit(), async function(req, res) {
    var peerName = cleanName(req.params.peerName);
    var action = String(req.body && req.body.action || '');
    if (!peerName || ['pin','unpin','mute','unmute','mark_read','mark_unread','clear','delete','draft','archive','unarchive'].indexOf(action) < 0) {
      return res.status(400).json({ ok: false, code: 'invalid_action' });
    }
    var draft = req.body && req.body.draft_text;
    var revision = req.body && req.body.draft_revision;
    if (action === 'draft' && (typeof draft !== 'string' || draft.length > 500 || !Number.isSafeInteger(revision) || revision < 0)) {
      return res.status(400).json({ ok: false, code: 'invalid_draft' });
    }
    try {
      var result = await callChatRpc(supabase, 'chat_manage_conversation', {
        p_actor_name: req.userName, p_peer_name: peerName, p_action: action,
        p_draft_text: action === 'draft' ? draft : null,
        p_draft_revision: action === 'draft' ? revision : null
      });
      if (result && result.status === 'ok') {
        if (action === 'mark_read') await callChatRpc(supabase,'chat_sync_legacy_read_receipts',{
          p_actor_name:req.userName,p_peer_name:peerName
        });
        publishEvent(req.userName, 'chat-state', { kind:action, peer:peerName });
        if (action === 'mark_read') publishEvent(peerName, 'chat-state', { kind:'read', peer:req.userName });
        return res.json({ ok: true, state: result });
      }
      if (result && result.status === 'revision_conflict') return res.status(409).json({ ok: false, code: 'revision_conflict', draft_revision: result.draft_revision });
      if (result && result.status === 'not_found') return res.status(404).json({ ok: false, code: 'not_found' });
      if (result && result.status === 'deleted') return res.status(409).json({ ok: false, code: 'deleted' });
      return res.status(400).json({ ok: false, code: result && result.status || 'invalid_action' });
    } catch (e) { return errorResponse(res, e, 'chat_conversation_update_unavailable'); }
  });

  router.get('/users/search', authenticatedReadLimit(), async function(req, res) {
    var query = String(req.query.q || '').trim();
    if (query.length < 2 || query.length > 64) {
      return res.status(400).json({ ok: false, error: '请输入 2 到 64 个字符', code: 'invalid_query' });
    }
    try {
      var users = await callChatRpc(supabase, 'chat_search_users', {
        p_user_name: req.userName,
        p_query: query,
        p_limit: 20
      });
      return res.json({ ok: true, users: Array.isArray(users) ? users : [] });
    } catch (e) { return errorResponse(res, e, 'chat_user_search_unavailable'); }
  });

  router.get('/relationship', authenticatedReadLimit(), async function(req, res) {
    var peerName = cleanName(req.query.target);
    if (!peerName) return res.status(400).json({ ok: false, error: '目标用户无效', code: 'invalid_target' });
    try {
      var relationship = await getChatRelationship(supabase, req.userName, peerName);
      return res.json({ ok: true, relationship: relationship });
    } catch (e) { return errorResponse(res, e, 'chat_relationship_unavailable'); }
  });

  router.get('/friends', authenticatedReadLimit(), async function(req, res) {
    try {
      var friends = await callChatRpc(supabase, 'chat_list_friends', { p_user_name: req.userName });
      return res.json({ ok: true, friends: Array.isArray(friends) ? friends : [] });
    } catch (e) { return errorResponse(res, e, 'chat_friends_unavailable'); }
  });

  router.get('/requests', authenticatedReadLimit(), async function(req, res) {
    var direction = String(req.query.direction || 'incoming');
    if (direction !== 'incoming' && direction !== 'outgoing') {
      return res.status(400).json({ ok: false, error: '申请方向无效', code: 'invalid_direction' });
    }
    try {
      var requests = await callChatRpc(supabase, 'chat_list_requests', {
        p_user_name: req.userName,
        p_direction: direction
      });
      return res.json({ ok: true, requests: Array.isArray(requests) ? requests : [] });
    } catch (e) { return errorResponse(res, e, 'chat_requests_unavailable'); }
  });

  router.get('/blocks', authenticatedReadLimit(), async function(req, res) {
    try {
      var blocks = await callChatRpc(supabase, 'chat_list_blocks', { p_user_name: req.userName });
      return res.json({ ok: true, blocks: Array.isArray(blocks) ? blocks : [] });
    } catch (e) { return errorResponse(res, e, 'chat_blocks_unavailable'); }
  });

  router.post('/presence/heartbeat', rateLimit ? rateLimit(60000, 60) : authenticatedWriteLimit(), async function(req,res) {
    try {
      var outcome = await callChatRpc(supabase,'chat_touch_presence',{ p_actor_name:req.userName });
      if (!outcome || outcome.status !== 'ok') return res.status(403).json({ ok:false,code:'account_unavailable' });
      if (outcome.became_online) {
        var friends = await callChatRpc(supabase,'chat_list_friends',{ p_user_name:req.userName });
        (Array.isArray(friends) ? friends : []).forEach(function(friend) {
          if (friend && friend.peer_name) publishEvent(friend.peer_name,'presence',{ peer:req.userName,last_seen_at:outcome.last_seen_at });
        });
      }
      return res.json({ ok:true,last_seen_at:outcome.last_seen_at });
    } catch(e) { return errorResponse(res,e,'chat_presence_unavailable'); }
  });

  router.get('/presence/:peerName', authenticatedReadLimit(), async function(req,res) {
    var peerName = cleanName(req.params.peerName);
    if (!peerName) return res.status(400).json({ok:false,code:'invalid_target'});
    try {
      var presence = await callChatRpc(supabase,'chat_get_presence',{
        p_actor_name:req.userName,p_peer_name:peerName
      });
      if (!presence || presence.status !== 'ok') return res.status(403).json({ok:false,code:'forbidden'});
      return res.json({ok:true,presence:presence});
    } catch(e) { return errorResponse(res,e,'chat_presence_unavailable'); }
  });

  router.post('/typing/:peerName', rateLimit ? rateLimit(60000, 30) : authenticatedWriteLimit(), async function(req,res) {
    var peerName = cleanName(req.params.peerName);
    if (!peerName) return res.status(400).json({ok:false,code:'invalid_target'});
    try {
      var permission = await assertCanSendDirectMessage(supabase,req.userName,peerName,options.adminName);
      if (!permission.ok) return res.status(403).json({ok:false,code:permission.code});
      publishEvent(peerName,'typing',{peer:req.userName,active:req.body && req.body.active === true,at:Date.now()});
      return res.json({ok:true});
    } catch(e) { return errorResponse(res,e,'chat_typing_unavailable'); }
  });

  router.post('/friend-requests', authenticatedWriteLimit(), async function(req, res) {
    var peerName = cleanName(req.body && (req.body.target_user || req.body.target));
    var note = String(req.body && req.body.note || '').trim();
    if (!peerName) return res.status(400).json({ ok: false, error: '目标用户无效', code: 'invalid_target' });
    if (note.length > 240) return res.status(400).json({ ok: false, error: '申请说明不能超过 240 个字符', code: 'note_too_long' });
    try {
      var outcome = await callChatRpc(supabase, 'chat_request_friend', {
        p_requester_name: req.userName,
        p_target_name: peerName,
        p_note: note || null
      });
      var status = outcome && outcome.status;
      if (status === 'request_sent') { notifyBoth(req.userName,peerName,'friend_request'); return res.status(201).json({ ok: true, result: outcome }); }
      if (status === 'accepted' || status === 'already_friends' || status === 'request_pending') {
        if (status === 'accepted') notifyBoth(req.userName,peerName,'friendship');
        return res.json({ ok: true, result: outcome });
      }
      if (status === 'blocked') return res.status(403).json({ ok: false, error: '当前无法向该用户发送好友申请', code: 'chat_blocked' });
      if (status === 'user_not_found') return res.status(404).json({ ok: false, error: '用户不存在', code: 'user_not_found' });
      if (status === 'self') return res.status(400).json({ ok: false, error: '不能添加自己', code: 'self_request' });
      if (status === 'note_too_long') return res.status(400).json({ ok: false, error: '申请说明过长', code: 'note_too_long' });
      return res.status(403).json({ ok: false, error: '当前账号暂不可添加好友', code: status || 'account_unavailable' });
    } catch (e) { return errorResponse(res, e, 'chat_friend_request_unavailable'); }
  });

  router.post('/friend-requests/:requestId/:action', authenticatedWriteLimit(), async function(req, res) {
    var requestId = String(req.params.requestId || '');
    var action = String(req.params.action || '');
    if (!isUuid(requestId)) return res.status(400).json({ ok: false, error: '申请编号无效', code: 'invalid_request_id' });
    if (['accept', 'reject', 'cancel'].indexOf(action) < 0) {
      return res.status(400).json({ ok: false, error: '操作无效', code: 'invalid_action' });
    }
    try {
      var pendingRows = [];
      try {
        pendingRows = await callChatRpc(supabase,'chat_list_requests',{
          p_user_name:req.userName,p_direction:action === 'cancel' ? 'outgoing' : 'incoming'
        });
      } catch(_) { /* The action RPC remains authoritative; polling repairs a missed signal. */ }
      var pending = (Array.isArray(pendingRows) ? pendingRows : []).find(function(row) { return String(row.request_id) === requestId; });
      var otherName = pending ? (pending.requester_name === req.userName ? pending.target_name : pending.requester_name) : '';
      var outcome = await callChatRpc(supabase, 'chat_finish_friend_request', {
        p_actor_name: req.userName,
        p_request_id: requestId,
        p_action: action
      });
      var status = outcome && outcome.status;
      if (['accepted', 'rejected', 'canceled'].indexOf(status) >= 0) {
        notifyBoth(req.userName,otherName,'friend_request');
        return res.json({ ok: true, result: outcome });
      }
      if (status === 'request_not_found') return res.status(404).json({ ok: false, error: '好友申请不存在', code: status });
      if (status === 'request_not_pending') return res.status(409).json({ ok: false, error: '好友申请已处理', code: status });
      if (status === 'forbidden' || status === 'blocked') return res.status(403).json({ ok: false, error: '无权处理这条好友申请', code: status });
      return res.status(403).json({ ok: false, error: '当前账号暂不可处理好友申请', code: status || 'account_unavailable' });
    } catch (e) { return errorResponse(res, e, 'chat_friend_request_update_unavailable'); }
  });

  router.delete('/friends/:peerName', authenticatedWriteLimit(), async function(req, res) {
    var peerName = cleanName(req.params.peerName);
    if (!peerName) return res.status(400).json({ ok: false, error: '目标用户无效', code: 'invalid_target' });
    try {
      var outcome = await callChatRpc(supabase, 'chat_remove_friend', {
        p_actor_name: req.userName,
        p_peer_name: peerName
      });
      if (outcome && outcome.status === 'removed') { notifyBoth(req.userName,peerName,'friendship'); return res.json({ ok: true, result: outcome, history_preserved: true }); }
      if (outcome && outcome.status === 'not_friends') return res.status(404).json({ ok: false, error: '好友关系不存在', code: 'not_friends' });
      if (outcome && outcome.status === 'user_not_found') return res.status(404).json({ ok: false, error: '用户不存在', code: 'user_not_found' });
      return res.status(403).json({ ok: false, error: '当前账号暂不可删除好友', code: (outcome && outcome.status) || 'account_unavailable' });
    } catch (e) { return errorResponse(res, e, 'chat_friend_remove_unavailable'); }
  });

  router.put('/friends/:peerName/note', authenticatedWriteLimit(), async function(req, res) {
    var peerName = cleanName(req.params.peerName);
    var note = String(req.body && req.body.note || '').trim();
    if (!peerName) return res.status(400).json({ ok: false, error: '目标用户无效', code: 'invalid_target' });
    if (note.length > 80) return res.status(400).json({ ok: false, error: '备注不能超过 80 个字符', code: 'note_too_long' });
    try {
      var outcome = await callChatRpc(supabase, 'chat_set_friend_note', {
        p_owner_name: req.userName,
        p_peer_name: peerName,
        p_note: note
      });
      if (outcome && outcome.status === 'ok') { publishEvent(req.userName,'chat-state',{kind:'friend_note',peer:peerName}); return res.json({ ok: true, note: outcome.note || null }); }
      if (outcome && outcome.status === 'not_friends') return res.status(409).json({ ok: false, error: '只能给好友设置备注', code: 'not_friends' });
      if (outcome && outcome.status === 'user_not_found') return res.status(404).json({ ok: false, error: '用户不存在', code: 'user_not_found' });
      return res.status(403).json({ ok: false, error: '当前账号暂不可修改好友备注', code: (outcome && outcome.status) || 'account_unavailable' });
    } catch (e) { return errorResponse(res, e, 'chat_friend_note_unavailable'); }
  });

  router.post('/blocks/:peerName', authenticatedWriteLimit(), async function(req, res) {
    var peerName = cleanName(req.params.peerName);
    if (!peerName) return res.status(400).json({ ok: false, error: '目标用户无效', code: 'invalid_target' });
    try {
      var outcome = await callChatRpc(supabase, 'chat_block_user', {
        p_actor_name: req.userName,
        p_peer_name: peerName
      });
      if (outcome && ['blocked', 'already_blocked'].indexOf(outcome.status) >= 0) {
        if (outcome.status === 'blocked') notifyBoth(req.userName,peerName,'block');
        return res.json({ ok: true, result: outcome, history_preserved: true });
      }
      if (outcome && outcome.status === 'user_not_found') return res.status(404).json({ ok: false, error: '用户不存在', code: 'user_not_found' });
      return res.status(400).json({ ok: false, error: '无法拉黑该用户', code: (outcome && outcome.status) || 'invalid_target' });
    } catch (e) { return errorResponse(res, e, 'chat_block_unavailable'); }
  });

  router.delete('/blocks/:peerName', authenticatedWriteLimit(), async function(req, res) {
    var peerName = cleanName(req.params.peerName);
    if (!peerName) return res.status(400).json({ ok: false, error: '目标用户无效', code: 'invalid_target' });
    try {
      var outcome = await callChatRpc(supabase, 'chat_unblock_user', {
        p_actor_name: req.userName,
        p_peer_name: peerName
      });
      if (outcome && ['unblocked', 'not_blocked'].indexOf(outcome.status) >= 0) {
        if (outcome.status === 'unblocked') notifyBoth(req.userName,peerName,'block');
        return res.json({ ok: true, result: outcome });
      }
      if (outcome && outcome.status === 'user_not_found') return res.status(404).json({ ok: false, error: '用户不存在', code: 'user_not_found' });
      return res.status(400).json({ ok: false, error: '无法解除拉黑', code: (outcome && outcome.status) || 'invalid_target' });
    } catch (e) { return errorResponse(res, e, 'chat_unblock_unavailable'); }
  });

  return router;
}

module.exports = {
  cleanName: cleanName,
  listChatConversations: listChatConversations,
  getChatConversationState: getChatConversationState,
  getChatRelationship: getChatRelationship,
  assertCanSendDirectMessage: assertCanSendDirectMessage,
  createChatSocialRouter: createChatSocialRouter
};
