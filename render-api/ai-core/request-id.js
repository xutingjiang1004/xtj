// ==================== AI Core: Request ID ====================
// Unified request ID generation for both Cat AI and Code agent endpoints.
'use strict';

const crypto = require('crypto');

function generateRequestId(prefix) {
  prefix = prefix || 'req';
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

function generateStreamId() {
  return 'stream_' + crypto.randomBytes(8).toString('hex');
}

function generateConversationId() {
  return 'conv_' + crypto.randomBytes(12).toString('hex');
}

// 返回一个工厂函数，每次调用返回递增的事件ID。
// 用法：var nextEventId = generateEventId(); var id = nextEventId();
// startFrom：计数器起始值（取自 session.last_event_id 或 DB 中该 stream 的最大
// event_id），避免进程重启后重新从 1 递增与已持久化的事件 ID 冲突。
function generateEventId(startFrom) {
  var id = Math.max(Number(startFrom) || 0, 0);
  return function () { return ++id; };
}

module.exports = {
  generateRequestId,
  generateStreamId,
  generateConversationId,
  generateEventId
};