'use strict';
// Read-only production acceptance: native capture with a simulated device. No account,
// upload or database write. This verifies HTTP policy enforcement, not real iOS hardware.
const { chromium } = require('@playwright/test');
(async function () {
  const url = process.env.CHAT_MIC_CHECK_URL || 'https://xtj.onrender.com';
  const browser = await chromium.launch({
    ...(process.env.CHAT_TEST_CHROMIUM ? { executablePath: process.env.CHAT_TEST_CHROMIUM } : {}),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  });
  try {
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const policy = response.headers()['permissions-policy'] || '';
    if (!policy.includes('microphone=(self)') || !policy.includes('camera=()')) throw new Error('Unexpected production Permissions-Policy');
    const result = await page.evaluate(async function () {
      const policy = document.permissionsPolicy || document.featurePolicy;
      if (!policy.allowsFeature('microphone') || policy.allowsFeature('camera')) throw new Error('Browser effective policy does not match');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      try {
        const recorder = new MediaRecorder(stream), chunks = [];
        const live = stream.getAudioTracks().every(track => track.readyState === 'live');
        const stopped = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = reject; });
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.start(250);
        await new Promise(resolve => setTimeout(resolve, 1500));
        recorder.stop(); await stopped;
        const audio = new Blob(chunks, { type: recorder.mimeType });
        return { live, audioBytes: audio.size, mime: recorder.mimeType, simulatedDevice: true };
      } finally { stream.getTracks().forEach(track => track.stop()); }
    });
    if (!result.live || result.audioBytes < 1000) throw new Error('Native recording did not produce usable audio');
    console.log(JSON.stringify({ ok: true, policy, ...result }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
