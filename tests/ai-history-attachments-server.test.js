'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
const helpersStart = serverSource.indexOf('const AI_CHAT_HISTORY_ATTACHMENT_DATA_BUDGET =');
const helpersEnd = serverSource.indexOf('\n\nasync function loadAiContext', helpersStart);
assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'server history attachment helper block exists');
const helpersSource = serverSource.slice(helpersStart, helpersEnd);

function loadHistoryHelpers(extractVisionImageUrls, extractChatAttachments) {
  return new Function('extractVisionImageUrls', 'extractChatAttachments',
    helpersSource + '\nreturn { createAiHistoryAttachmentBudget, prepareAiHistoryMessage };'
  )(extractVisionImageUrls, extractChatAttachments);
}

test('builtin non-vision history OCRs prior vision_urls instead of dropping image context', async function() {
  const calls = [];
  const helpers = loadHistoryHelpers(function(attachments) {
    return attachments.filter(function(item) { return /^image\//i.test(item.type); }).map(function(item) { return item.data_url; });
  }, async function(content, attachments, options) {
    calls.push({ attachments: attachments, skipImageOcr: options.skipImageOcr });
    return { text: content + (options.skipImageOcr ? ' [vision image]' : ' [OCR text from prior image]') };
  });
  const imageUrl = 'data:image/png;base64,QUJD';
  const budget = helpers.createAiHistoryAttachmentBudget([]);
  const entry = await helpers.prepareAiHistoryMessage({
    role: 'user',
    content: 'What is in this picture?',
    vision_urls: [imageUrl]
  }, budget, 4000, false);

  assert.equal(calls[0].skipImageOcr, false);
  assert.equal(calls[0].attachments[0].type, 'image/png');
  assert.equal(entry.vision_urls, undefined);
  assert.match(entry.content, /OCR text from prior image/);
});

test('vision-capable history forwards image_url and skips OCR', async function() {
  const calls = [];
  const helpers = loadHistoryHelpers(function(attachments) {
    return attachments.filter(function(item) { return /^image\//i.test(item.type); }).map(function(item) { return item.data_url; });
  }, async function(content, attachments, options) {
    calls.push({ attachments: attachments, skipImageOcr: options.skipImageOcr });
    return { text: content + ' [image placeholder]' };
  });
  const imageUrl = 'data:image/jpeg;base64,QUJD';
  const entry = await helpers.prepareAiHistoryMessage({
    role: 'user',
    content: 'Describe it',
    attachments: [{ name: 'cat.jpg', type: 'image/jpeg', data_url: imageUrl }]
  }, helpers.createAiHistoryAttachmentBudget([]), 4000, true);

  assert.equal(calls[0].skipImageOcr, true);
  assert.deepEqual(entry.vision_urls, [imageUrl]);
  assert.equal(calls[0].attachments[0].name, 'cat.jpg');
});

test('history attachment count budget is shared across prior turns', async function() {
  const helpers = loadHistoryHelpers(function() { return []; }, async function(content) { return { text: content }; });
  const budget = helpers.createAiHistoryAttachmentBudget([]);
  for (let i = 0; i < 10; i++) {
    await helpers.prepareAiHistoryMessage({
      role: 'user', content: 'turn ' + i,
      attachments: [{ name: 'doc-' + i + '.txt', type: 'text/plain', data_url: 'data:text/plain;base64,QQ==' }]
    }, budget, 4000, false);
  }
  const overflow = await helpers.prepareAiHistoryMessage({
    role: 'user', content: 'latest',
    attachments: [{ name: 'latest.txt', type: 'text/plain', data_url: 'data:text/plain;base64,QQ==' }]
  }, budget, 4000, false);

  assert.equal(budget.remainingCount, 0);
  assert.match(overflow.content, /此前附件未随本次请求发送：latest.txt/);
  assert.equal(helpers.createAiHistoryAttachmentBudget(new Array(10).fill({ data_url: 'x' })).remainingCount, 0);
});

test('history attachment payloads over the remaining encoded-size budget are omitted', async function() {
  const helpers = loadHistoryHelpers(function() { return []; }, async function(content) { return { text: content }; });
  const budget = helpers.createAiHistoryAttachmentBudget([]);
  budget.remainingChars = 4;
  const entry = await helpers.prepareAiHistoryMessage({
    role: 'user', content: 'old turn',
    attachments: [{ name: 'large.pdf', type: 'application/pdf', data_url: 'data:application/pdf;base64,QQ==' }]
  }, budget, 4000, false);

  assert.equal(budget.remainingCount, 10);
  assert.match(entry.content, /此前附件未随本次请求发送：large.pdf/);
});

test('builtin history processing receives the selected model vision capability', function() {
  assert.match(serverSource, /allowVision:\s*_visionEligibleEarly/);
  assert.match(serverSource, /prepareAiHistoryMessage\([\s\S]*?historyOptions \? historyOptions\.allowVision : true/);
});
