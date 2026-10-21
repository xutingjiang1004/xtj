'use strict';
const { AsyncLocalStorage, AsyncResource } = require('node:async_hooks');
const { assertSafeWebUrl } = require('./web-fetch');
const turnUsage = new AsyncLocalStorage();
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const PRICE_VERSION = 'deepseek-web-2026-10';

function abortError() { return Object.assign(new Error('Web request cancelled'), { name: 'AbortError' }); }
function checkAbort(signal) { if (signal && signal.aborted) throw abortError(); }
// One rolling-window limiter per endpoint, shared by all keys in this process.
// The provider also enforces account-wide limits across application replicas.
function createLimiter(limit = 5, windowMs = 1000) {
  let starts = [], active = 0, timer = null;
  const queue = [];
  function pump() {
    if (timer) { clearTimeout(timer); timer = null; }
    starts = starts.filter(at => Date.now() - at < windowMs);
    while (queue.length && active < limit && starts.length < limit) {
      const job = queue.shift();
      job.signal?.removeEventListener('abort', job.abort);
      if (job.signal?.aborted) { job.reject(abortError()); continue; }
      starts.push(Date.now()); active++;
      Promise.resolve().then(job.fn).then(job.resolve, job.reject).finally(() => { active--; pump(); });
    }
    if (queue.length && starts.length >= limit) timer = setTimeout(pump, Math.max(1, windowMs - (Date.now() - starts[0])));
  }
  return (fn, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    if (queue.length >= 50) return reject(new Error('Web service busy'));
    const job = { fn:AsyncResource.bind(fn), signal, resolve, reject, abort: null };
    job.abort = () => { const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1); reject(abortError()); pump(); };
    signal?.addEventListener('abort', job.abort, { once: true }); queue.push(job); pump();
  });
}
const limiters = { search: createLimiter(), fetch: createLimiter() };
function credentials(options = {}) {
  if (process.env.DEEPSEEK_WEB_ENABLED === 'false') return '';
  // A caller-supplied key is used only for an authenticated official endpoint.
  if (options.deepseekKey) return options.deepseekKey;
  return process.env.DEEPSEEK_WEB_API_KEY || process.env.DEEPSEEK_API_KEY || '';
}
function middleware(req, res, next) {
  if (!/^\/api\/agent\//.test(req.path || req.url || '')) return next();
  turnUsage.run({ search: 0, fetch: 0, successful: 0, empty: 0, failed: 0, unknown: 0 }, () => {
    const original = res.json;
    res.json = function(body) { if (body && body.usage) body = { ...body, usage: enrichUsage(body.usage) }; return original.call(this, body); };
    next();
  });
}
function record(kind, outcome, options) {
  const targets = new Set([turnUsage.getStore(), options.context && (options.context.webUsage ||= { search: 0, fetch: 0, successful: 0, empty: 0, failed: 0, unknown: 0 })]);
  for (const target of targets) if (target) { target[kind]++; target[outcome]++; }
  console.info('[DEEPSEEK-WEB-REQUEST]',JSON.stringify({endpoint:kind,outcome:outcome,price_version:PRICE_VERSION}));
}
function enrichUsage(usage, context) {
  const web = context?.webUsage || turnUsage.getStore();
  if (!web || !(web.search + web.fetch)) return usage;
  const cost = Math.round(web.successful * 0.005 * 1e6) / 1e6;
  return { ...(usage || {}), web_usage: { ...web, estimated_cost: cost, currency: 'CNY', price_version: PRICE_VERSION, estimated: true } };
}
async function readJson(response) {
  if (Number(response.headers?.get('content-length')) > MAX_BODY_BYTES) throw new Error('Web response too large');
  if (!response.body?.getReader) return response.json();
  const reader = response.body.getReader(), parts = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > MAX_BODY_BYTES) throw new Error('Web response too large'); parts.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}
async function request(kind, body, options = {}) {
  const key = credentials(options); if (!key) throw new Error('DeepSeek web not configured');
  checkAbort(options.signal);
  return limiters[kind](async () => {
    checkAbort(options.signal);
    const budget = turnUsage.getStore() || (options.context && (options.context.webUsage ||= {search:0,fetch:0,successful:0,empty:0,failed:0,unknown:0}));
    if(budget){
      const maxRequests=Math.max(1,Math.min(200,Math.floor(Number(process.env.DEEPSEEK_WEB_MAX_REQUESTS_PER_TURN))||40));
      const configuredCost=Number(process.env.DEEPSEEK_WEB_MAX_COST_CNY ?? .2);
      const maxCost=Number.isFinite(configuredCost)&&configuredCost>=0?configuredCost:.2;
      if((budget.started||0)>=maxRequests || ((budget.started||0)+1)*5000>Math.round(maxCost*1e6))throw new Error('DeepSeek web turn budget reached');
      budget.started=(budget.started||0)+1;
    }
    const controller = new AbortController(); let sent = false, received = false, accepted = false, recorded = false;
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 12000);
    try {
      checkAbort(options.signal); sent = true;
      const response = await fetch('https://api.deepseek.com/v1/tools/' + kind, {
        method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal
      });
      received = true;
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error('DeepSeek web status ' + response.status); }
      accepted = true;
      const data = await readJson(response);
      const nonempty = kind === 'search' ? Array.isArray(data.results) && data.results.length > 0 : !!String(data.content || '').trim();
      record(kind, nonempty ? 'successful' : 'empty', options); recorded = true;
      checkAbort(options.signal); return data;
    } catch (error) {
      if (sent && !recorded) record(kind, accepted || !received || controller.signal.aborted ? 'unknown' : 'failed', options);
      if (options.signal?.aborted) throw abortError();
      throw new Error('DeepSeek web request failed');
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }, options.signal);
}
async function search(query, count, options = {}) {
  const points = Array.from(String(query || '').trim());
  if (!points.length || points.length > 128) throw new Error('Search query must contain 1–128 characters');
  const body = { query: points.join(''), count: Math.max(1, Math.min(50, Math.floor(count) || 10)), need_content: !!options.need_content };
  const data = await request('search', body, options);
  return { results: (data.results || []).slice(0, body.count).map(row => ({
    title: String(row.title || '').slice(0, 200), url: String(row.url || '').slice(0, 8192),
    snippet: String(row.snippet || '').slice(0, 500), summary: String(row.summary || '').slice(0, 2000),
    content: options.need_content ? String(row.content || '').slice(0, 12000) : '',
    source: String(row.site_name || 'deepseek').slice(0, 100), published_at: row.date || ''
  })).filter(row => /^https?:\/\//i.test(row.url)), error: null };
}
async function fetchPage(url, options = {}) {
  if (String(url).length > 8192) throw new Error('URL too long');
  checkAbort(options.signal); await assertSafeWebUrl(url); checkAbort(options.signal);
  const data = await request('fetch', { url }, options);
  const content = String(data.content || '');
  if (!content.trim()) throw new Error('Empty web page');
  return { url, title: String(data.title || '').slice(0, 300), content: content.slice(0, 24000), bytes: Buffer.byteLength(content), truncated: content.length > 24000, content_type: 'text/markdown', via_deepseek: true };
}
module.exports = {
  search: async (...args) => require('./ai-request-features').search(() => search(...args)),
  fetchPage: async (...args) => { require('./ai-request-features').assertNetwork(); return fetchPage(...args); },
  credentials, middleware, enrichUsage, createLimiter
};
