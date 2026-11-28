'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function loadMarkdownRenderer() {
  const src = read('js/ai-core/markdown-renderer.js');
  const windowObj = { XtjAiCore: {}, location: { origin: 'https://xtj.local' } };
  const ctx = vm.createContext({
    window: windowObj,
    document: { createElement: () => ({}) },
    URL,
    console,
    Math,
    Date,
    RegExp,
    Array,
    Object,
    String,
    Number
  });
  vm.runInContext(src, ctx);
  return windowObj.XtjAiCore.Markdown;
}

test('AI-01: markdown sanitizer blocks placeholder injection, unquoted event handlers, and srcdoc without corrupting prose', () => {
  const md = loadMarkdownRenderer();
  assert.ok(md && typeof md.render === 'function' && typeof md.sanitize === 'function');

  const xss1 = md.sanitize('<img src=x onerror=/**/alert(1)//>');
  assert.doesNotMatch(xss1, /onerror/i, 'unquoted event handler with /**/ must be stripped');
  const xss1Render = md.render('<img src=x onerror=/**/alert(1)//>');
  assert.doesNotMatch(xss1Render, /<img\b[^>]*onerror/i, 'raw img tag in markdown must not execute event handlers');

  const xss2 = md.render('<div><a href="&#1;INLINE0&#1;">click</a></div>\n\n`"`');
  assert.doesNotMatch(xss2, /href="[^"]*<code>/i, 'entity-encoded placeholder token must not expand inside href');
  const mdSrc = read('js/ai-core/markdown-renderer.js');
  assert.ok(mdSrc.includes('makePassthroughNonce'), 'passthrough mask must use per-call random nonce');
  assert.ok(mdSrc.includes('if (unmaskRe) rawVal = rawVal.replace(unmaskRe, \'\');'), 'attribute values must strip placeholder tokens');

  const xss3 = md.sanitize('<iframe srcdoc="<script>alert(1)</script>"></iframe><form action="/" formaction="javascript:alert(1)"></form>');
  assert.doesNotMatch(xss3, /srcdoc|formaction|javascript:/i, 'srcdoc and formaction must be blocked');

  const prose = md.render('one=1 and online=true and style=dashed and expression(x)');
  assert.ok(prose.includes('one=1'), 'prose containing one=1 must remain intact');
  assert.ok(prose.includes('online=true'), 'prose containing online=true must remain intact');
  assert.ok(prose.includes('style=dashed'), 'prose containing style=dashed must remain intact');
  assert.ok(prose.includes('expression(x)'), 'prose containing expression(x) must remain intact');
});

test('AI-02/AI-03/AI-05..AI-24: Cat AI P0/P1 fixes hold', () => {
  const ai = read('js/ai-agent.js');
  const stream = read('js/ai-core/stream-renderer.js');
  const voice = read('js/ai-core/voice-conversation.js');
  const ux = read('js/ux-features.js');

  // AI-02: comment search targets allow comments source
  assert.match(ai, /target\.type === 'comment'\s*\?\s*\(item\.source === 'posts' \|\| item\.source === 'comments'\)/);

  // AI-03: applyServerStudyPrefs defers push when called inside fetchServerCustomModels
  assert.ok(ai.includes('applyServerStudyPrefs(data.ai_prefs && data.ai_prefs.study, { deferPush: true })'));
  assert.ok(ai.includes('if (opts && opts.deferPush)'));

  // AI-05 & AI-06: synchronous scroll anchor + aligned splice
  assert.ok(ai.includes('var syncDelta = messagesEl.scrollHeight - oldScroll;'));
  assert.ok(ai.includes('if (keepCount > 0) S.messages.splice(keepCount, drop);'));

  // AI-07 & AI-08: nullable exhausted_window + abort-like timeout check
  assert.ok(ai.includes("['exhausted_window', 'window_5h_reset_at', 'window_7d_reset_at']"));
  assert.ok(ai.includes('var isAbortLike = (fetchErr && fetchErr.name === \'AbortError\')'));

  // AI-09 & AI-12: tryExtendStreamHtml closing tag check & hidden tab drain finish
  assert.ok(stream.includes('/^(?:<\\/[a-z0-9]+>)+$/i.test(suffix)'));
  assert.ok(stream.includes('document.hidden'));
  assert.ok(ai.includes('/^(?:<\\/[a-z0-9]+>)+$/i.test(suffix)'));

  // AI-19: preserve stored_reference when keeping existing key
  assert.ok(ai.includes('if (_prev.stored_reference) record.stored_reference = _prev.stored_reference;'));

  // AI-20 & AI-21: automation modal bound with bindAiModalIdentity + askConfirm; memory modal auth-close + ready toggle guard
  assert.ok(ai.includes('var modalOwner = bindAiModalIdentity(modal);'));
  assert.ok(ai.includes("askConfirm('删除定时任务'"));
  assert.ok(ux.includes('toggle.disabled = !state.ready || toggleBusy;'));
  assert.ok(ux.includes("window.addEventListener('xtj:auth-changed', onAuthChanged);"));

  // AI-22 & AI-23: voice guest guard + TTS cooldown
  assert.ok(voice.includes('ttsUnavailableUntil'));
  assert.ok(voice.includes('!!ttsAbort || !!ttsAudio'));

  // AI-24: study landing protected from applyConfigToUI overwrite
  assert.ok(ai.includes(':not(.ai-study-landing)'));
});

test('P-01..P-08 & PW-01..PW-15: Posts and Photo Wall P0/P1 fixes hold', () => {
  const core03 = read('js/core-parts/03-profile-report-ai.js');
  const core07 = read('js/core-parts/07-final-overrides.js');
  const pwRender = read('js/photo-wall/render.js');
  const pwData = read('js/photo-wall/data.js');
  const pwPreview = read('js/photo-wall/preview.js');
  const pwHotfix = read('js/photo-wall/preview-hotfix.js');

  // P-02/P-03/P-04/PW-01
  assert.ok(core03.includes("getElementById('postStatsModal')"));
  assert.ok(core07.includes("root.closest('.dock-panel:not(.active)')"));
  assert.ok(core07.includes('window.syncHeaderModalBodyLock'));
  assert.ok(core07.includes('.grp-sheet'));
  assert.ok(core07.includes('#aiSiteSearchPanel'));

  // PW-03/05/06/07/08/11/15
  assert.ok(pwRender.includes('refreshLoadMoreSentinel'));
  assert.ok(pwData.includes('compareServerPageOrder'));
  assert.ok(pwPreview.includes('dlOv.id = "ppDownloadOverlay"'));
  assert.ok(pwHotfix.includes('.pp-download-overlay'));
  assert.ok(pwHotfix.includes('clampPan'));
});

test('CH-A1..CH-A8 & CH-B1..CH-B13: DM & Group Chat P0/P1 fixes hold', () => {
  const core03 = read('js/core-parts/03-profile-report-ai.js');
  const core05 = read('js/core-parts/05-feed-stats.js');
  const core06 = read('js/core-parts/06-chat-and-nav.js');
  const grpClient = read('js/chat-groups.js');
  const grpServer = read('render-api/chat-groups.js');

  // CH-A1: uid hash keyed by owner
  assert.ok(core05.includes('window.__xtjResetDmUidHash'));
  assert.ok(core05.includes('_dmUidHashCache.owner === u'));

  // CH-A2: logout unsubscribes Web Push + 409 resubscribe recovery
  assert.ok(core03.includes('/api/chat/push/unsubscribe'));
  assert.ok(core06.includes('subErr.status === 409'));

  // CH-A3 & AI-04: reset chat panels clears active peer & askAiAboutDmMessage resolves #aiChatRoot dynamically
  assert.ok(core06.includes('dockChatActiveUser = null;'));
  assert.ok(core06.includes("var liveRoot = document.getElementById('aiChatRoot');"));

  // CH-A6/A7/A8: manual unread clear, queued return value, drain queue on edit/flash
  assert.ok(core06.includes('return { queued: true, tempId: queuedTempId };'));
  assert.ok(core06.includes('window.__xtjDeactivateDmForGroup = function()'));

  // CH-B1: realtime withdraw broadcast includes withdrawn_by and client patches immediately
  assert.ok(grpServer.includes("withdrawn_by: action === 'withdraw' ? req.userName : undefined"));
  assert.ok(grpClient.includes("payload.kind === 'withdraw' && payload.message_id"));

  // CH-B3/B4/B7/B13: QR guard, no devicePixelRatio mutation, data-full-src, single-pass linkify & highlightEsc
  assert.ok(grpClient.includes('if (!g.qr_token)'));
  assert.ok(!grpClient.includes('window.devicePixelRatio = 1'));
  assert.ok(grpClient.includes('data-full-src='));
  assert.ok(grpClient.includes('function highlightEsc(rawText)'));
});
