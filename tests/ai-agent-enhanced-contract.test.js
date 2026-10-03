'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const aiAgent = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');

test('enhanced Cat AI terminal cleanup removes only transient per-message indicators', () => {
  assert.match(aiAgent, /function clearAssistantTransientStatus\(node\)/);
  assert.match(aiAgent, /\.ai-enhanced-status, \.ai-tool-status, \.ai-search-supplement/);
  assert.match(aiAgent, /clearAssistantTransientStatus\(node\);/);
  // Completion now awaits the unseen suffix rather than flashing it all at
  // once. Keep checking finalization after the drain and its cancellation guard.
  const done = aiAgent.slice(aiAgent.indexOf("if (evt.type === 'done') {", aiAgent.indexOf('async function handleSendMessage(')));
  assert.match(done, /ensureAssistantBubbleReady\(\);\s*clearInterval\(_idleCheckTimer\);\s*var drained = await contentRenderer\.drain\(aiContent, controller\.signal\);/);
  assert.match(done, /if \(!drained \|\| controller\.signal\.aborted\) throw new DOMException\('Reply cancelled', 'AbortError'\);\s*finishAiMessage\(assistantNode, aiContent, aiReasoning, evt\);/);
});

test('enhanced Cat AI uses a bounded server-owned search plan without entering deep research', () => {
  assert.match(server, /var enhancedSearchAllowed = responseProfile === 'enhanced'/);
  assert.match(server, /generateExpandedQueries\(message, \[_psQuery\], 2\)\.slice\(0, 2\)/);
  assert.match(server, /type: 'tool_pending', tool_name: 'search_web'/);
  assert.match(server, /type: 'enhanced_stage', stage: 'answer'/);
  assert.match(server, /Deep research remains a separate route/);
});
