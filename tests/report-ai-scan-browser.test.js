'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { postBrowserFixture } = require('./helpers/post-browser-fixture');

async function openReport(f, post, scanResponse) {
  let scanCalls = 0;
  await f.page.route('**/api/agent/post-tools', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.action === 'report_scan') { scanCalls += 1; return scanResponse(route, body); }
    return route.fulfill({ status: 400, json: { error: 'unexpected' } });
  });
  await f.page.evaluate(id => window.openPostReport(id), post.id);
  return () => scanCalls;
}
const box = f => f.page.locator('#reportAiScanBox');

test('the report form shows the AI check of the reported post, once per opening', { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ counts: [1] });
  try {
    const post = f.posts[0];
    const calls = await openReport(f, post, route => route.fulfill({ json: { ok: true, scan: {
      suspected: true, risk_level: 'high', categories: ['垃圾广告', '虚假信息'], summary: '内容含有明显的推广链接', evidence: ['加微信领取', '点击链接'], suggested_reason: '垃圾广告' } } }));
    await f.page.waitForFunction(() => /疑似违规/.test(document.getElementById('reportAiScanBox').textContent), null, { timeout: 15000 });
    const text = await box(f).textContent();
    assert.match(text, /风险高/);
    assert.match(text, /内容含有明显的推广链接/);
    assert.match(text, /类型：垃圾广告、虚假信息/);
    assert.match(text, /依据：加微信领取；点击链接/);
    assert.equal(await f.page.locator('#reportAiScanField').evaluate(el => el.style.display), '', 'the AI check is visible inside the report form');
    assert.ok(await f.page.locator('#reportModal #reportAiScanField').count() === 1, 'it lives in the report form, between the content and the reason');
    assert.equal(calls(), 1, 'one AI call per opening');
  } finally { await f.close(); }
});

test('an AI failure says so and never blocks the report; a closed form drops late answers', { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ counts: [1] });
  try {
    const post = f.posts[0];
    await openReport(f, post, route => route.fulfill({ status: 502, json: { error: 'post_tool_failed' } }));
    await f.page.waitForFunction(() => /不影响举报/.test(document.getElementById('reportAiScanBox').textContent), null, { timeout: 15000 });
    assert.match(await box(f).textContent(), /AI 检测暂时不可用/);
    // Opening the form some other way clears the old result instead of showing it for the wrong post.
    await f.page.evaluate(() => window.openReportModal());
    assert.equal(await f.page.locator('#reportAiScanField').evaluate(el => el.style.display), 'none');
    assert.equal((await box(f).textContent()).trim(), '');
  } finally { await f.close(); }
});

test('a slow answer for an earlier opening cannot overwrite the current one', { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ counts: [1] });
  try {
    const post = f.posts[0];
    let releaseFirst; const first = new Promise(resolve => { releaseFirst = resolve; });
    let call = 0;
    await f.page.route('**/api/agent/post-tools', async route => {
      call += 1;
      if (call === 1) { await first; return route.fulfill({ json: { ok: true, scan: { suspected: true, risk_level: 'high', categories: [], summary: 'OLD-RESULT', evidence: [] } } }); }
      return route.fulfill({ json: { ok: true, scan: { suspected: false, risk_level: 'low', categories: [], summary: 'NEW-RESULT', evidence: [] } } });
    });
    await f.page.evaluate(id => window.openPostReport(id), post.id);
    await f.page.evaluate(id => window.openPostReport(id), post.id);
    await f.page.waitForFunction(() => /NEW-RESULT/.test(document.getElementById('reportAiScanBox').textContent), null, { timeout: 15000 });
    releaseFirst();
    await f.page.waitForTimeout(400);
    const text = await box(f).textContent();
    assert.match(text, /NEW-RESULT/);
    assert.doesNotMatch(text, /OLD-RESULT/);
  } finally { await f.close(); }
});

test('the AI check sits between the content and the reason, and no other label of the form changes', { timeout: 60000 }, async () => {
  const f = await postBrowserFixture({ counts: [1] });
  try {
    const post = f.posts[0];
    await openReport(f, post, route => route.fulfill({ json: { ok: true, scan: { suspected: false, risk_level: 'low', categories: [], summary: '未发现明确违规内容。', evidence: [] } } }));
    await f.page.waitForFunction(() => /风险/.test(document.getElementById('reportAiScanBox').textContent), null, { timeout: 15000 });
    await f.page.waitForTimeout(500);
    const order = await f.page.evaluate(() => [...document.querySelectorAll('#reportModalFormBody > *')].filter(e => e.getBoundingClientRect().height > 0)
      .map(e => ({ top: e.getBoundingClientRect().top, id: e.id || '', label: ((e.querySelector('label') || {}).textContent || '').trim() })).sort((a, b) => a.top - b.top).map(e => e.label || e.id));
    assert.deepEqual(order.slice(0, 4), ['选择举报类型', '选择要举报的内容', 'AI 检测', '举报原因'], 'the fields appear in this order: ' + JSON.stringify(order));
    const labels = await f.page.evaluate(() => [...document.querySelectorAll('#reportModalFormBody label')].map(l => l.textContent.trim()));
    assert.equal(labels.filter(x => x === '举报原因').length, 1, 'the reason label is not duplicated: ' + JSON.stringify(labels));
    assert.ok(labels.includes('AI 检测'), 'and the AI check keeps its own label');
    assert.equal(await f.page.evaluate(() => document.getElementById('reportSubmitBtn').getBoundingClientRect().top > document.getElementById('reportReasonGrid').getBoundingClientRect().top), true, 'the submit button is still below the reasons');
  } finally { await f.close(); }
});
