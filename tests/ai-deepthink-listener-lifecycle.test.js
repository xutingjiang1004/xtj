const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'ai-agent.js'), 'utf8');

// --------------------------------------------------------- P-02 / P-15
test('P-02: bindDeepThinkPageEvents 内不存在绕过追踪表的直连监听', () => {
  const start = src.indexOf('function bindDeepThinkPageEvents()');
  const end = src.indexOf('\n  function openAiSearchTarget', start);
  assert.notEqual(start, -1, 'bindDeepThinkPageEvents 必须存在');
  assert.notEqual(end, -1, '函数结束边界必须可定位');
  const block = src.slice(start, end);

  // 允许的唯一 addEventListener 是 addDtListener 内部的实现
  const directHits = block.match(/(?<!function )\b(el|document|window)\.addEventListener\(/g) || [];
  const nonTracker = directHits.filter(h => !/^el\.addEventListener\(/.test(h));
  assert.equal(nonTracker.length, 0,
    `绑定函数内不得有 document/window 直连监听，实际发现: ${nonTracker.join(', ')}`);

  // 追踪表清理必须发生在绑定之前（先清后绑，否则本次绑定会被下次开头清掉）
  const clearIdx = block.indexOf('_dtListeners.forEach');
  const firstBindIdx = block.indexOf('addDtListener(');
  assert.notEqual(clearIdx, -1);
  assert.notEqual(firstBindIdx, -1);
  assert.ok(clearIdx < firstBindIdx, '必须先清理旧监听再重新绑定');
  assert.match(block, /_dtListeners = \[\];/);
});

test('P-02: 发送按钮走追踪表绑定，重复绑定不会导致重复发送', () => {
  const start = src.indexOf('function bindDeepThinkPageEvents()');
  const end = src.indexOf('\n  function openAiSearchTarget', start);
  const block = src.slice(start, end);
  assert.match(block, /addDtListener\(sendBtn, 'click', dtDoSend\)/);
  assert.doesNotMatch(block, /sendBtn\.addEventListener\('click', dtDoSend\)/,
    'sendBtn 不得直连绑定 dtDoSend（重复绑定会让消息发送两次）');
});

test('P-02: addDtListener 对空元素安全并登记反注册函数', () => {
  const start = src.indexOf('function addDtListener(el, event, handler)');
  assert.notEqual(start, -1);
  const block = src.slice(start, start + 300);
  assert.match(block, /if \(!el\) return;/);
  assert.match(block, /_dtListeners\.push\(function\(\) \{ el\.removeEventListener\(event, handler\); \}\)/);
});
