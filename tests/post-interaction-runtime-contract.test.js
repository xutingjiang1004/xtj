const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');

function between(start, end) {
  const startIndex = core.indexOf(start);
  const endIndex = core.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return core.slice(startIndex, endIndex);
}

test('publish, comment, and edit handlers reject duplicate in-flight submissions', () => {
  const publish = between('window.doPublish = async function', 'loadFeed = async function');
  const comment = between('if (commBtn) commBtn.onclick = async', '// ===================== 删除帖子');
  const edit = between('window.saveEditPost = async function', 'window._legacyTogglePostPinBase');
  assert.match(publish, /btn\.disabled\s*\|\|\s*btn\.getAttribute\('aria-busy'\) === 'true'/);
  assert.match(comment, /if \(commBtn\.disabled\) return/);
  assert.match(edit, /if \(!btn \|\| btn\.disabled\) return/);
});

test('comment keeps the target id after modal reset and inserts the canonical response locally', () => {
  const comment = between('if (commBtn) commBtn.onclick = async', '// ===================== 删除帖子');
  assert.match(comment, /const targetPostId = String\(activePostId \|\| ''\)/);
  assert.match(comment, /JSON\.stringify\(\{ post_id: targetPostId, content: content \}\)/);
  assert.match(comment, /result\.data && String\(result\.data\.post_id\) === targetPostId/);
  assert.match(comment, /feedAllComments[\s\S]*renderFeedFromMemoryState\(\)/);
  assert.match(comment, /data-post-id="' \+ targetPostId/);
});

test('delete timeout aborts the request and confirms authoritative server state', () => {
  const deletion = between('async function confirmPostDeleteStatus', 'window.openModal = function');
  assert.match(deletion, /AbortController/);
  assert.match(deletion, /\/api\/post\/delete-status/);
  assert.match(deletion, /delete request timed out; checking locally/);
  assert.match(deletion, /result\.deleted === true && result\.exists === false/);
  assert.match(deletion, /删除超时，帖子仍然存在，请重试/);
  assert.doesNotMatch(deletion, /Promise\.race\(\[deletePromise, requestTimeout\]\)/);
});
