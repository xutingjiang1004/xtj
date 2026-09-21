#!/usr/bin/env node
/**
 * auto-fix-tool-promise.js
 *
 * 修复 render-api/server.js 标准流式 SSE 路径中 Promise.all 并行执行工具时
 * 缺少 try/catch 的 bug：
 *
 * 旧代码（约第23297行）：
 *   var toolResults = await Promise.all(toolCallsArr.map(async function(tc) {
 *     var tcExec = { function: { name: tc.name, arguments: tc.args } };
 *     var execResult = await executeToolCall(tcExec, { userName: userName });
 *     ...
 *     return { result: execResult, id: tc.id, name: tc.name };
 *   }));
 *   clearInterval(_toolProgressTimer);
 *
 * 问题：executeToolCall 若抛出未捕获异常（executeAiSiteTool 内部异常、
 * 未被 case 内 try/catch 覆盖的错误等），Promise.all 整体 reject，导致：
 *   1. tool_result / tool_error SSE 事件全部不发送；
 *   2. clearInterval 不执行，tool_progress 定时器泄漏，每 3s 持续推送；
 *   3. 前端工具步骤永久停留在“搜索中”，与用户截图现象一致。
 *
 * 修复：内层 try/catch 把异常转成 { tool_name, error } 结果（与 DeepSeek
 * 路径第8131行、DSML 兜底路径第23391行对齐），外层 try/finally 保证
 * 进度定时器在任何情况下都被清理。
 */

'use strict';
var fs = require('fs');
var path = require('path');

var TARGET = path.join(__dirname, '..', 'render-api', 'server.js');

var OLD = [
  '      // 并行执行所有工具',
  '      var toolResults = await Promise.all(toolCallsArr.map(async function(tc) {',
  '        var tcExec = { function: { name: tc.name, arguments: tc.args } };',
  '        var execResult = await executeToolCall(tcExec, { userName: userName });',
  '        // F-1: 标准流式路径工具驱动的真实搜索调用计入请求级计数器',
  '        if (execResult && (execResult.tool_name === \'search_web\' || execResult.tool_name === \'tavily_search\') && !execResult.error && req._searchApiCalls) req._searchApiCalls.n = (req._searchApiCalls.n || 0) + 1;',
  '        return { result: execResult, id: tc.id, name: tc.name };',
  '      }));',
  '      clearInterval(_toolProgressTimer);'
].join('\n');

var NEW = [
  '      // 并行执行所有工具',
  '      // ★ 2026-09-22 修复：单个工具抛异常不能让整批 Promise.all reject，',
  '      //   否则 tool_result/tool_error 事件全部不发、进度定时器泄漏，前端',
  '      //   步骤永久停在“搜索中”。内层 catch 把异常转成 error 结果，与',
  '      //   DeepSeek 路径及第23391行 DSML 兜底路径对齐；外层 finally 保证',
  '      //   进度定时器在任何情况下都被清理。',
  '      var toolResults;',
  '      try {',
  '        toolResults = await Promise.all(toolCallsArr.map(async function(tc) {',
  '          var tcExec = { function: { name: tc.name, arguments: tc.args } };',
  '          var execResult;',
  '          try {',
  '            execResult = await executeToolCall(tcExec, { userName: userName });',
  '          } catch (toolErr) {',
  '            execResult = { tool_name: tc.name, error: (toolErr && toolErr.message) || \'工具执行失败\' };',
  '          }',
  '          // F-1: 标准流式路径工具驱动的真实搜索调用计入请求级计数器',
  '          if (execResult && (execResult.tool_name === \'search_web\' || execResult.tool_name === \'tavily_search\') && !execResult.error && req._searchApiCalls) req._searchApiCalls.n = (req._searchApiCalls.n || 0) + 1;',
  '          return { result: execResult, id: tc.id, name: tc.name };',
  '        }));',
  '      } finally {',
  '        clearInterval(_toolProgressTimer);',
  '      }'
].join('\n');

function main() {
  var src = fs.readFileSync(TARGET, 'utf8');

  // 幂等：已修复则直接退出
  if (src.indexOf('★ 2026-09-22 修复：单个工具抛异常不能让整批 Promise.all reject') !== -1) {
    console.log('[auto-fix] Already patched, nothing to do.');
    process.exit(0);
  }

  var idx = src.indexOf(OLD);
  if (idx === -1) {
    console.error('[auto-fix] ERROR: target code block not found. File may have changed.');
    process.exit(1);
  }

  // 确保只匹配到一处
  var secondIdx = src.indexOf(OLD, idx + 1);
  if (secondIdx !== -1) {
    console.error('[auto-fix] ERROR: target code block matched more than once.');
    process.exit(1);
  }

  var patched = src.slice(0, idx) + NEW + src.slice(idx + OLD.length);

  // 语法自检：new Function 能解析全部语法（不执行）
  try {
    new Function(patched);
  } catch (syntaxErr) {
    console.error('[auto-fix] ERROR: syntax check failed after patch:', syntaxErr.message);
    process.exit(1);
  }

  fs.writeFileSync(TARGET, patched, 'utf8');

  var oldLines = OLD.split('\n').length;
  var newLines = NEW.split('\n').length;
  console.log('[auto-fix] OK. Replaced ' + oldLines + ' lines with ' + newLines + ' lines.');
  console.log('[auto-fix] File size: ' + src.length + ' -> ' + patched.length + ' bytes.');
}

main();
