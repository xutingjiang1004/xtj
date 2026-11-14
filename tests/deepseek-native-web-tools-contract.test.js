'use strict';
// DeepSeek 原生联网（web tools）接入契约：声明方式、失败降级、引用来源透传。
// 依据官方文档：Responses API 的 tools 只写 {type:'deepseek_web_search'|'deepseek_read_url'}（不带 name），
// 与 function 工具可共存；上游拒绝时必须整体降级回原链路，不能把聊天打挂。
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');
const agent = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'ai-agent.css'), 'utf8');

test('Responses 路径按调用方声明追加官方 web 工具，且只写 type（Responses 格式不带 name）', () => {
  assert.match(server, /if \(options && Array\.isArray\(options\.web_tools\) && options\.web_tools\.length && !nativeWebOff\)/);
  assert.match(server, /nativeToolList\.push\('deepseek_web_search'\)/);
  assert.match(server, /nativeToolList\.push\('deepseek_read_url'\)/);
  assert.match(server, /nativeToolList\.map\(function\(n\) \{ return \{ type: n \}; \}\)/);
  assert.match(server, /apiBody\.tool_choice = 'auto';/);
  // 官方限制：这两个工具不能被 tool_choice 指定，所以只能 auto
  assert.doesNotMatch(server, /tool_choice\s*=\s*'deepseek_web_search'/);
});

test('安全审核与标题只在原生联网时下发，避免影响普通 function 工具链路', () => {
  assert.match(server, /if \(nativeToolList && options\.safety_check\) apiBody\.safety_check = \{ level: 'high' \};/);
  assert.match(server, /if \(nativeToolList && options\.title_enabled\) apiBody\.title = \{ enabled: true \};/);
});

test('上游拒绝 web 工具时整体摘掉扩展字段重试一次，退回原 function 工具', () => {
  assert.match(server, /resp\.status === 400 && nativeToolList && !nativeDown/);
  assert.match(server, /\/tool\|safety_check\|title\/i\.test\(_peekTxt\)/);
  assert.match(server, /delete apiBody\.safety_check;\s*\n\s*delete apiBody\.title;/);
  assert.match(server, /if \(tools && tools\.length\) apiBody\.tools = tools; else delete apiBody\.tools;/);
  // 降级不能变成无限重试
  assert.match(server, /var nativeDown = false, retried5xx = false, retriedNet = false;/);
  assert.match(server, /_fetchAttempt < 3/);
  // 一旦降级，后续轮次不再尝试原生工具（避免每轮先吃一个 400）
  assert.match(server, /var nativeWebOff = false;/);
  assert.match(server, /nativeDown = true;\s*\n\s*nativeWebOff = true;/);
});

test('主聊天路由：只在用户打开搜索且非工作模式时启用原生联网，并透传引用来源', () => {
  assert.match(server, /web_tools: \(!workModeEnabled && webSearchPref === true\) \? \['search', 'read_url'\] : null,/);
  assert.match(server, /safety_check: !workModeEnabled && webSearchPref === true,/);
  assert.match(server, /type: 'sources', items: sent\.slice\(0, 8\)/);
  assert.match(server, /var seenSources = Object\.create\(null\);/);
  // 引用按 URL 去重，避免同一来源重复刷屏
  assert.match(server, /if \(!\/\^https\?:\\\/\\\/\/i\.test\(u\) \|\| seenSources\[u\]\) return;/);
});

test('前端渲染引用来源，并按 URL 去重、最多 8 条', () => {
  assert.match(agent, /if \(evt\.type === 'sources' && Array\.isArray\(evt\.items\)/);
  assert.match(agent, /class: 'ai-sources'/);
  assert.match(agent, /srcWrap\._seen\[srcUrl\]/);
  assert.match(agent, /querySelectorAll\('\.ai-source-item'\)\.length >= 8/);
  assert.match(agent, /rel: 'noopener noreferrer'/);
});

test('来源样式存在且不引入卡片外框（沿用正文阅读排版）', () => {
  assert.match(css, /\.ai-sources \{/);
  assert.match(css, /\.ai-source-item \{/);
  assert.match(css, /\[data-theme="dark"\] \.ai-source-item/);
  assert.match(css, /@media \(max-width: 640px\)/);
});

test('朗读改走服务端 TTS，失败时回落浏览器语音合成', () => {
  const voice = fs.readFileSync(path.join(root, 'js', 'ai-core', 'voice-conversation.js'), 'utf8');
  assert.match(voice, /function serverSpeak\(/);
  assert.match(voice, /xtjProtectedFetch\('\/api\/agent\/tts'/);
  assert.match(voice, /if \(serverSpeak\(text, speechToken, speechCurrent, autoContinue\)\) return;/);
  assert.match(voice, /ttsUnavailable = true;\s*\n\s*browseSpeak\(/);
  assert.match(server, /app\.use\('\/api\/agent\/tts', require\('\.\/deepseek-tts'\)\.createDeepSeekTts/);
});
