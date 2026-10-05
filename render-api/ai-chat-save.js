'use strict';

// Inputs are prepared by the authenticated chat route, never a client-supplied row.
async function saveCustomChatTurn(options) {
  const { db, userName, convId, message, content, reasoning, model, thinkingMode,
    webSearch, processEvents, cards, visionUrls, buildMeta, marker, thinkingElapsedMs } = options;
  if (!userName || !convId || !content) return false;
  const now = Date.now();
  const userExtra = { chat_mode: 'normal', web_search: webSearch === true, vision_urls: visionUrls };
  const assistantExtra = { chat_mode: 'normal', web_search: webSearch === true,
    process_events: processEvents, site_cards: (cards || []).slice(0, 32) };
  const rows = [
    { user_name: userName, content: String(message).slice(0, 60000), media_type: marker,
      media_url: buildMeta('user', convId, null, null, 1, null, 0, userExtra),
      actor_key: 'ai_msg_conv_' + convId + '_user_' + userName + '_' + now },
    { user_name: userName, content: String(content).slice(0, 24000), media_type: marker,
      media_url: buildMeta('assistant', convId, {model, thinking_mode: thinkingMode},
        thinkingMode === 'off' ? '' : String(reasoning || '').slice(0, 64000), 2, null, thinkingElapsedMs, assistantExtra),
      actor_key: 'ai_msg_conv_' + convId + '_agent_' + userName + '_' + (now + 1) }
  ];
  try {
    const result = await db.from('posts').insert(rows);
    return !!result && !result.error;
  } catch (_) { return false; }
}
// Disconnected authenticated turns remain usable history, even without an answer.
async function saveInterruptedChatTurn(options) {
  const { db, userName, convId, message, buildMeta, marker } = options;
  if (!userName || !convId || !message || typeof message !== 'string') return false;
  const stamp = Number.isFinite(options.startedAt) ? options.startedAt : Date.now();
  const turnId = String(options.requestId || stamp).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  const extra = { chat_mode: 'normal', interrupted: true, complete: false,
    finish_reason: options.finishReason || 'cancelled', client_request_id: turnId };
  const rows = [{ user_name: userName, content: message.slice(0, 60000), media_type: marker,
    media_url: buildMeta('user', convId, null, null, 1, null, 0,
      Object.assign({}, extra, { vision_urls: options.visionUrls || [] })),
    actor_key: 'ai_msg_conv_' + convId + '_interrupted_' + userName + '_' + turnId + '_user',
    created_at: new Date(stamp).toISOString() }];
  const content = String(options.content || '').slice(0, 24000);
  const reasoning = String(options.reasoning || '').slice(0, 64000);
  if (content || reasoning || (options.processEvents || []).length) rows.push({
    user_name: userName, content, media_type: marker,
    media_url: buildMeta('assistant', convId, { model: options.model, thinking_mode: options.thinkingMode },
      reasoning, 2, null, options.thinkingElapsedMs || 0,
      Object.assign({}, extra, { process_events: options.processEvents || [], site_cards: (options.cards || []).slice(0, 32) })),
    actor_key: 'ai_msg_conv_' + convId + '_interrupted_' + userName + '_' + turnId + '_assistant',
    created_at: new Date(stamp + 1).toISOString()
  });
  try {
    const result = await db.from('posts').insert(rows);
    return !!result && (!result.error || result.error.code === '23505');
  } catch (_) { return false; }
}
module.exports = { saveCustomChatTurn, saveInterruptedChatTurn };
