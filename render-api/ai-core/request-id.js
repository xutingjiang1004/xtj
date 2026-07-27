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

function generateEventId() {
  var id = 0;
  return function () { return ++id; };
}

module.exports = {
  generateRequestId,
  generateStreamId,
  generateConversationId,
  generateEventId
};