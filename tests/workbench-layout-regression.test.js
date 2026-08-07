'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ROOT = path.resolve(__dirname, '..');

const shellCss = fs.readFileSync(path.join(ROOT, 'css/ui-shell.css'), 'utf8');
const codeCss = fs.readFileSync(path.join(ROOT, 'css/code-workspace.css'), 'utf8');
const codeJs = fs.readFileSync(path.join(ROOT, 'js/code-workspace.js'), 'utf8');
const aiCss = fs.readFileSync(path.join(ROOT, 'css/ai-agent.css'), 'utf8');

test('desktop workbench keeps its padded content inside the viewport', () => {
  assert.match(shellCss, /grid-template-rows:\s*minmax\(0,\s*1fr\)/);
  assert.match(shellCss, /height:\s*100dvh/);
  assert.match(shellCss, /box-sizing:\s*border-box/);
  assert.match(shellCss, /#dockPanels\s*\{[\s\S]*?height:\s*100%/);
});

test('Code resizers expose a real hit target and keyboard fallback', () => {
  assert.match(codeCss, /\.code-resizer-left,[\s\S]*?width:\s*8px/);
  assert.match(codeCss, /\.code-resizer-context\s*\{[\s\S]*?height:\s*8px/);
  assert.match(codeJs, /document\.addEventListener\('pointermove', onPointerMove/);
  assert.match(codeJs, /function onKeyDown\(e, type\)/);
  assert.match(codeJs, /resizerLeft\.addEventListener\('keydown'/);
});

test('AI never renders an empty pending assistant bubble', () => {
  assert.match(aiCss, /\.ai-msg\.assistant \.ai-msg-bubble\.ai-reply-pending:empty\s*\{[\s\S]*?display:\s*none/);
});
