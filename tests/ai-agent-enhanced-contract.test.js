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
  assert.match(aiAgent, /if \(assistantNode\) \{\s*ensureAssistantBubbleReady\(\);\s*finishAiMessage\(assistantNode, aiContent, aiReasoning, evt\);/s);
});

test('enhanced Cat AI uses a bounded server-owned search plan without entering deep research', () => {
  assert.match(server, /var enhancedSearchAllowed = responseProfile === 'enhanced'/);
  assert.match(server, /generateExpandedQueries\(message, \[_psQuery\], 2\)\.slice\(0, 2\)/);
  assert.match(server, /type: 'tool_pending', tool_name: 'search_web'/);
  assert.match(server, /type: 'enhanced_stage', stage: 'answer'/);
  assert.match(server, /Deep research remains a separate route/);
});
