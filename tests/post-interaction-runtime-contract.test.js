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

test('publish and comment handlers reject duplicate in-flight submissions', () => {
  const publish = between('window.doPublish = async function', 'loadFeed = async function');
  assert.match(publish, /btn\.disabled\s*\|\|\s*btn\.getAttribute\('aria-busy'\) === 'true'/);
  assert.match(core, /btn\.onclick = async function\(\) \{[\s\S]*?if \(btn\.disabled\) return/);
});

test('comment keeps its target id and inserts the canonical response locally', () => {
  assert.match(core, /var targetPostId = String\(postId \|\| ''\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(core, /JSON\.stringify\(\{ post_id: targetPostId, content: content \}\)/);
  assert.match(core, /result\.data && String\(result\.data\.post_id\) === targetPostId/);
  assert.match(core, /feedAllComments[\s\S]*await renderFeedFromMemoryState\(\)/);
  assert.match(core, /data-post-id="' \+ targetPostId/);
});

test('delete timeout aborts the request and confirms authoritative server state', () => {
  const deletion = between('async function confirmPostDeleteStatus', 'window.openModal = function');
  assert.match(deletion, /AbortController/);
  assert.match(deletion, /\/api\/post\/delete-status/);
  assert.match(deletion, /delete request timed out; checking locally/);
  assert.match(deletion, /result\.deleted === true && result\.exists === false/);
  assert.doesNotMatch(deletion, /Promise\.race\(\[deletePromise, requestTimeout\]\)/);
});

test('pin transition scrolls the actual posts panel before rebuilding and animates the replacement card', () => {
  const pin = between('function pinMotionReduced', 'window.togglePostVisibility = async function');
  assert.match(pin, /document\.getElementById\('panelPosts'\)/);
  assert.match(pin, /actualSurface\.scrollTo\(\{ top: targetTop, behavior: 'smooth' \}\)/);
  assert.match(pin, /waitForPinScroll\(surface, targetTop, 620\)/);
  assert.match(pin, /post-pin-departing/);
  assert.match(pin, /post-pin-arriving/);
  assert.match(pin, /await rebuildFeedFromCurrentState\(\)[\s\S]*?await refreshPostDetailIfActive\(normalizedPostId\)[\s\S]*?completePinnedPostTransition\(normalizedPostId\)/);
  assert.doesNotMatch(pin, /window\.scrollTo\(/);
});

test('pin transition handles edge cases like concurrent requests and animation cleanup', () => {
  const pin = between('function pinMotionReduced', 'window.togglePostVisibility = async function');
  
  // Check for in-flight lock
  assert.match(pin, /inFlightPins\[normalizedPostId\]/);
  // Check for finally block cleanup
  assert.match(pin, /finally\s*\{[\s\S]*?postEl\.classList\.remove\('post-pin-departing'\)/);
  // Check for scroll completion logic
  assert.match(pin, /Math\.abs\(getScroll\(\) - targetTop\) <= 2/);
  assert.match(pin, /addEventListener\('scrollend'/);
  // Check for frontend failure differentiation
  assert.match(pin, /serverSucceeded/);
});
