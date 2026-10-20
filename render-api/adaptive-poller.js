'use strict';
function createAdaptivePoller({ task, baseDelay = 3000, idleDelay = 60000, errorDelay = 300000, isRestricted = () => false,
  setTimer = setTimeout, clearTimer = clearTimeout, onError = () => {} } = {}) {
  let timer = null, running = false, stopped = true, wakePending = false, delay = baseDelay, lastError = '';
  function schedule(ms) {
    if (stopped) return;
    if (timer) clearTimer(timer);
    timer = setTimer(tick, ms); if (timer && timer.unref) timer.unref();
  }
  async function tick() {
    timer = null; if (stopped || running) return;
    if (isRestricted()) { schedule(errorDelay); return; }
    running = true; wakePending = false;
    try {
      const result = await task(); lastError = '';
      delay = result === 'worked' ? baseDelay : Math.min(idleDelay, Math.max(baseDelay, delay * 2));
    } catch (error) {
      const code = String(error && (error.code || error.name) || 'poll_failed');
      if (lastError !== code) { onError(code); lastError = code; }
      delay = Math.min(errorDelay, Math.max(15000, delay * 2));
    } finally { running = false; schedule(wakePending ? 0 : delay); }
  }
  return { start() { if (stopped) { stopped = false; delay = baseDelay; schedule(0); } },
    wake() { if (stopped) return; delay = baseDelay; if (running) wakePending = true; else schedule(0); },
    stop() { stopped = true; if (timer) clearTimer(timer); timer = null; },
    state: () => ({ running, stopped, delay }) };
}
module.exports = { createAdaptivePoller };
