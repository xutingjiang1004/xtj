#!/usr/bin/env node
/**
 * 自动修复脚本：generate_pdf blocks 参数容错
 * 由 GitHub Actions workflow 调用，在服务器端修改 server.js
 */
'use strict';
var fs = require('fs');
var path = require('path');

var target = path.join(__dirname, '..', 'render-api', 'server.js');
var src = fs.readFileSync(target, 'utf8');

// 已经修复过则跳过
if (src.indexOf('gpAltRaw') !== -1) {
  console.log('[fix-pdf-blocks] Already patched, skipping.');
  process.exit(0);
}

// 精确匹配旧代码
var oldCode = [
  "    case 'generate_pdf': {",
  '      var gpBlocks = Array.isArray(args.blocks) ? args.blocks.slice(0, 200) : [];',
  "      if (!gpBlocks.length) return { tool_name: name, error: 'blocks 内容为空' };"
].join('\n');

var newCode = [
  "    case 'generate_pdf': {",
  '      var gpBlocks = Array.isArray(args.blocks) ? args.blocks.slice(0, 200) : [];',
  '      // ★ 2026-09-22 修复（generate_pdf 频繁报 "blocks 内容为空"）：',
  '      //   第三方模型对 function calling 参数结构理解不准，常把内容塞到',
  '      //   content/text/markdown/html 字段而非 blocks 数组，旧逻辑直接硬拒。',
  '      //   新策略：blocks 为空时自动从常见替代字段提取并归一化为 blocks。',
  '      if (!gpBlocks.length) {',
  "        var gpAltRaw = args.content || args.text || args.markdown || args.html || args.body || '';",
  "        if (typeof gpAltRaw === 'string' && gpAltRaw.trim()) {",
  '          var gpAltLines = gpAltRaw.split(/\\n{2,}/);',
  '          for (var gpAi = 0; gpAi < gpAltLines.length && gpBlocks.length < 200; gpAi++) {',
  '            var gpLine = gpAltLines[gpAi].trim();',
  '            if (!gpLine) continue;',
  '            if (/^#{1,3}\\s+/.test(gpLine)) {',
  '              var gpLevel = gpLine.match(/^(#+)/)[1].length;',
  "              gpBlocks.push({ type: 'h' + Math.min(gpLevel, 3), text: gpLine.replace(/^#+\\s+/, '') });",
  '            } else if (/^[-*•]\\s+/m.test(gpLine)) {',
  "              var gpItems = gpLine.split('\\n').map(function(l) { return l.replace(/^[-*•]\\s+/, '').trim(); }).filter(Boolean);",
  "              if (gpItems.length) gpBlocks.push({ type: 'ul', items: gpItems });",
  '            } else {',
  "              gpBlocks.push({ type: 'p', text: gpLine });",
  '            }',
  '          }',
  '        }',
  '      }',
  "      if (!gpBlocks.length) return { tool_name: name, error: 'blocks 内容为空：请传入 blocks 数组，每项形如 {\"type\":\"p\",\"text\":\"段落文字\"}；也可传 content/text 字段由系统自动分段' };"
].join('\n');

if (src.indexOf(oldCode) === -1) {
  console.error('[fix-pdf-blocks] ERROR: Could not find target code block. Server.js may have changed.');
  process.exit(1);
}

src = src.replace(oldCode, newCode);
fs.writeFileSync(target, src, 'utf8');
console.log('[fix-pdf-blocks] Successfully patched server.js.');

// 语法检查
try {
  new Function(src);
  console.log('[fix-pdf-blocks] Syntax check passed.');
} catch (e) {
  console.error('[fix-pdf-blocks] Syntax error after patch:', e.message);
  process.exit(1);
}
