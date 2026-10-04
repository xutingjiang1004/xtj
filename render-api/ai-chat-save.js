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
module.exports = { saveCustomChatTurn };
