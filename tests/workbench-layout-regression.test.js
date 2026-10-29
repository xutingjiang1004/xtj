'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ROOT = path.resolve(__dirname, '..');

const shellCss = fs.readFileSync(path.join(ROOT, 'css/ui-shell.css'), 'utf8');
const aiCss = fs.readFileSync(path.join(ROOT, 'css/ai-agent.css'), 'utf8');

test('desktop workbench keeps its padded content inside the viewport', () => {
  assert.match(shellCss, /grid-template-rows:\s*minmax\(0,\s*1fr\)/);
  assert.match(shellCss, /height:\s*100dvh/);
  assert.match(shellCss, /box-sizing:\s*border-box/);
  assert.match(shellCss, /#dockPanels\s*\{[\s\S]*?height:\s*100%/);
});

test('AI never renders an empty pending assistant bubble', () => {
  assert.match(aiCss, /\.ai-msg\.assistant \.ai-msg-bubble\.ai-reply-pending:empty\s*\{[\s\S]*?display:\s*none/);
});

test('desktop history stays a closable overlay instead of a stuck left column', () => {
  const featuresCss = fs.readFileSync(path.join(ROOT, 'css/ai-assistant-features.css'), 'utf8');
  const agentJs = fs.readFileSync(path.join(ROOT, 'js/ai-agent.js'), 'utf8');
  assert.doesNotMatch(aiCss, /#aiChatRoot:has\(\.ai-conv-item/);
  assert.doesNotMatch(featuresCss, /:has\(\.ai-conv-item,\s*\.ai-no-history\)/);
  assert.match(aiCss, /#aiChatRoot > \.ai-conversation-list\s*\{[^}]*display:\s*none\s*!important/);
  assert.match(aiCss, /showing-history:has\(>\s*\.ai-conversation-list\)/);
  assert.match(aiCss, /\.ai-conv-page-shell \.ai-conv-list-bar\s*\{[^}]*display:\s*none/);
  assert.match(agentJs, /function conversationListShown\(/);
  assert.match(agentJs, /aria-label': '关闭历史会话'/);
});

test('thinking panel uses one stable width while it opens', () => {
  const thinking = aiCss.match(/\.ai-thinking\s*\{[^}]*\}/);
  const panel = aiCss.match(/\.ai-thinking-panel\s*\{[^}]*\}/);
  assert.ok(thinking && panel);
  assert.match(thinking[0], /width:\s*100%/);
  assert.match(panel[0], /width:\s*100%/);
  assert.doesNotMatch(thinking[0], /fit-content/);
  assert.doesNotMatch(panel[0], /fit-content/);
  assert.match(aiCss, /\.ai-thinking-body\s*\{[^}]*white-space:\s*normal/);
  assert.match(aiCss, /\.ai-thinking\.expanded \.ai-thinking-body,\s*\.ai-thinking\.expanded \.ai-thinking-panel > \.ai-thinking-body\s*\{[^}]*overflow:\s*visible/);
});
