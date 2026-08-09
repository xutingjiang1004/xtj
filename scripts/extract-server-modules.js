/**
 * One-shot / maintainable extractor: pull pure-ish helpers out of render-api/server.js
 * into dedicated modules. Safe re-run: skips if already extracted.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const serverPath = path.join(ROOT, 'render-api', 'server.js');
let server = fs.readFileSync(serverPath, 'utf8');

function writeModule(rel, content) {
  const full = path.join(ROOT, rel);
  fs.writeFileSync(full, content.replace(/\r\n/g, '\n'), 'utf8');
  console.log('[write]', rel, Buffer.byteLength(content), 'bytes');
}

function mustFind(str, label) {
  const i = server.indexOf(str);
  if (i < 0) throw new Error('not found: ' + label + ' => ' + str.slice(0, 60));
  return i;
}

// ---------------------------------------------------------------------------
// 1) search-providers.js
// ---------------------------------------------------------------------------
if (!fs.existsSync(path.join(ROOT, 'render-api', 'search-providers.js'))) {
  const searchStart = mustFind('// Web Search 配置', 'web search config');
  // Include from Web Search config through end of searchWeb, then append buildSearchQuery+cleanSearchResults
  const sanitizeComment = mustFind('// AI visible-text sanitizer:', 'sanitize comment');
  let searchBody = server.slice(searchStart, sanitizeComment);

  // Remove Tavily Research pipeline from the search providers module (stays in server)
  const researchStart = searchBody.indexOf('// ===================== Tavily Research 增强流水线 =====================');
  const braveStart = searchBody.indexOf('// Provider 2: Brave Search API');
  if (researchStart < 0 || braveStart < 0) throw new Error('research/brave split markers missing in search body');
  const researchBlock = searchBody.slice(researchStart, braveStart);
  searchBody = searchBody.slice(0, researchStart) + searchBody.slice(braveStart);

  const bsq = mustFind('function buildSearchQuery(message)', 'buildSearchQuery');
  const mail = mustFind('// ===================== Gmail SMTP 邮件配置 =====================', 'mail section');
  const queryHelpers = server.slice(bsq, mail);

  // Remove buildSearchQuery/cleanSearchResults from server later; also remove from between finishStream and mail
  const moduleCode = [
    '/**',
    ' * Web search provider chain + query helpers.',
    ' * Priority: Tavily > Brave > Serper > Custom API > Bing HTML > SearXNG',
    ' */',
    "'use strict';",
    '',
    queryHelpers.trim(),
    '',
    searchBody.trim(),
    '',
    'module.exports = {',
    '  searchWeb: searchWeb,',
    '  searchTavily: searchTavily,',
    '  searchBrave: searchBrave,',
    '  searchSerper: searchSerper,',
    '  searchCustomApi: searchCustomApi,',
    '  searchSearxng: searchSearxng,',
    '  searchBingHtml: searchBingHtml,',
    '  buildSearchQuery: buildSearchQuery,',
    '  cleanSearchResults: cleanSearchResults,',
    '  withSearchProviderTimeout: withSearchProviderTimeout,',
    '  // for health diagnostics / tests',
    '  _searchCache: typeof searchCache !== "undefined" ? searchCache : null',
    '};',
    ''
  ].join('\n');

  // Fix order: searchWeb calls buildSearchQuery — with function decls order OK.
  // But we put queryHelpers BEFORE searchBody which is correct.
  writeModule('render-api/search-providers.js', moduleCode);

  // Stash research block to re-insert in server after require
  fs.writeFileSync(path.join(ROOT, 'render-api', '.research-block.tmp.js'), researchBlock, 'utf8');
}

// ---------------------------------------------------------------------------
// 2) weather.js
// ---------------------------------------------------------------------------
if (!fs.existsSync(path.join(ROOT, 'render-api', 'weather.js'))) {
  const wStart = mustFind('// Open-Meteo 免费天气查询', 'weather');
  const wEnd = mustFind('const MAX_SSE_BUFFER_BYTES', 'sse max');
  const body = server.slice(wStart, wEnd).trim();
  writeModule('render-api/weather.js', [
    '/** Open-Meteo free weather lookup (no API key). */',
    "'use strict';",
    '',
    body,
    '',
    'module.exports = {',
    '  queryWeather: queryWeather,',
    '  CITY_COORDS: CITY_COORDS',
    '};',
    ''
  ].join('\n'));
}

// ---------------------------------------------------------------------------
// 3) sse-write.js
// ---------------------------------------------------------------------------
if (!fs.existsSync(path.join(ROOT, 'render-api', 'sse-write.js'))) {
  const sStart = mustFind('const MAX_SSE_BUFFER_BYTES = 256 * 1024;', 'sse const');
  const sEnd = mustFind('// 统一流结束收尾', 'finishStream comment');
  const body = server.slice(sStart, sEnd).trim();
  writeModule('render-api/sse-write.js', [
    '/** SSE write helper with backpressure protection. */',
    "'use strict';",
    '',
    body,
    '',
    'module.exports = {',
    '  writeSse: writeSse,',
    '  MAX_SSE_BUFFER_BYTES: MAX_SSE_BUFFER_BYTES',
    '};',
    ''
  ].join('\n'));
}

// ---------------------------------------------------------------------------
// 4) mail-transport.js
// ---------------------------------------------------------------------------
if (!fs.existsSync(path.join(ROOT, 'render-api', 'mail-transport.js'))) {
  const mStart = mustFind('// ===================== Gmail SMTP 邮件配置 =====================', 'mail');
  const mEnd = mustFind('// ===================== 输入校验 =====================', 'input validation');
  let body = server.slice(mStart, mEnd).trim();
  // nodemailer is optional in server — pass it in or require here
  writeModule('render-api/mail-transport.js', [
    '/** Gmail SMTP transporter (optional nodemailer). */',
    "'use strict';",
    '',
    'var nodemailer = null;',
    "try { nodemailer = require('nodemailer'); } catch (e) {",
    "  console.warn('[INIT] nodemailer not available in mail-transport, email disabled');",
    '}',
    '',
    body.replace(/^\/\/ =+ Gmail SMTP[^\n]*\n/, ''),
    '',
    'module.exports = {',
    '  getMailTransporter: getMailTransporter,',
    '  GMAIL_USER: GMAIL_USER,',
    '  GMAIL_APP_PASSWORD: GMAIL_APP_PASSWORD',
    '};',
    ''
  ].join('\n'));
}

// ---------------------------------------------------------------------------
// 5) post-query.js — normal post filters
// ---------------------------------------------------------------------------
if (!fs.existsSync(path.join(ROOT, 'render-api', 'post-query.js'))) {
  const pStart = mustFind('// ===================== 通用 posts 查询过滤 helper =====================', 'post query');
  const pEnd = mustFind('// 统计数据内存缓存', 'stats cache');
  const body = server.slice(pStart, pEnd).trim();
  writeModule('render-api/post-query.js', [
    '/** Public/normal post query filters (media_type allowlist). */',
    "'use strict';",
    '',
    body.replace(/^\/\/ =+ 通用 posts[^\n]*\n/, ''),
    '',
    'module.exports = {',
    '  isNormalPost: isNormalPost,',
    '  applyNormalPostAllowlist: applyNormalPostAllowlist,',
    '  applyPublicPostExclusions: applyPublicPostExclusions,',
    '  NORMAL_POST_MEDIA_TYPES: NORMAL_POST_MEDIA_TYPES',
    '};',
    ''
  ].join('\n'));
}

// ---------------------------------------------------------------------------
// 6) util-helpers.js — pure time/json helpers used by admin builders
// ---------------------------------------------------------------------------
if (!fs.existsSync(path.join(ROOT, 'render-api', 'util-helpers.js'))) {
  // Find safeJsonParse through getUtcDateKey
  const uStart = mustFind('function safeJsonParse(input)', 'safeJsonParse');
  const uEnd = mustFind('async function fetchAllPostsByMediaType', 'fetchAllPosts');
  const body = server.slice(uStart, uEnd).trim();
  writeModule('render-api/util-helpers.js', [
    '/** Pure JSON/time helpers (no I/O). */',
    "'use strict';",
    '',
    body,
    '',
    'module.exports = {',
    '  safeJsonParse: safeJsonParse,',
    '  toTimeMs: toTimeMs,',
    '  pickEarlierIso: pickEarlierIso,',
    '  pickLaterIso: pickLaterIso,',
    '  getUtcDateKey: getUtcDateKey',
    '};',
    ''
  ].join('\n'));
}

console.log('[extract] module files written. Now wiring server.js...');

// Re-read server in case we only wrote modules
server = fs.readFileSync(serverPath, 'utf8');

// ---------------------------------------------------------------------------
// Wire requires into server.js
// ---------------------------------------------------------------------------
const injectAfter = "const { sanitizeAssistantVisibleText } = require('./ai-sanitize');";
if (!server.includes("require('./search-providers')")) {
  if (!server.includes(injectAfter)) throw new Error('injectAfter missing');
  const inject = [
    injectAfter,
    "const {",
    '  searchWeb,',
    '  searchTavily,',
    '  searchBrave,',
    '  searchSerper,',
    '  searchCustomApi,',
    '  searchSearxng,',
    '  searchBingHtml,',
    '  buildSearchQuery,',
    '  cleanSearchResults,',
    '  withSearchProviderTimeout',
    "} = require('./search-providers');",
    "const { queryWeather, CITY_COORDS } = require('./weather');",
    "const { writeSse } = require('./sse-write');",
    "const { getMailTransporter, GMAIL_USER, GMAIL_APP_PASSWORD } = require('./mail-transport');",
    "const { isNormalPost, applyNormalPostAllowlist, applyPublicPostExclusions, NORMAL_POST_MEDIA_TYPES } = require('./post-query');",
    "const { safeJsonParse, toTimeMs, pickEarlierIso, pickLaterIso, getUtcDateKey } = require('./util-helpers');"
  ].join('\n');
  server = server.replace(injectAfter, inject);
}

// Remove old nodemailer require block if mail-transport handles it — keep server nodemailer var for other uses?
// server still has: var nodemailer = null; try { nodemailer = require('nodemailer')
// mail-transport has its own. OK to leave both.

// Replace search section with research block only
{
  const searchStart = server.indexOf('// Web Search 配置');
  const sanitizeComment = server.indexOf('// AI visible-text sanitizer:');
  if (searchStart < 0 || sanitizeComment < 0) throw new Error('search replace bounds missing');
  let researchBlock = '';
  const tmp = path.join(ROOT, 'render-api', '.research-block.tmp.js');
  if (fs.existsSync(tmp)) {
    researchBlock = fs.readFileSync(tmp, 'utf8');
    fs.unlinkSync(tmp);
  } else {
    // extract from current slice
    const slice = server.slice(searchStart, sanitizeComment);
    const rs = slice.indexOf('// ===================== Tavily Research 增强流水线 =====================');
    const bs = slice.indexOf('// Provider 2: Brave Search API');
    if (rs >= 0 && bs > rs) researchBlock = slice.slice(rs, bs);
  }
  server = server.slice(0, searchStart) +
    '// Web search providers: see ./search-providers.js (imported above)\n\n' +
    researchBlock +
    server.slice(sanitizeComment);
}

// Remove weather block
{
  const wStart = server.indexOf('// Open-Meteo 免费天气查询');
  const wEnd = server.indexOf('const MAX_SSE_BUFFER_BYTES');
  // after previous edits, MAX_SSE might still be there or already removed
  if (wStart >= 0) {
    const next = server.indexOf('// 统一流结束收尾', wStart);
    // Prefer cutting to MAX_SSE or finishStream
    let end = server.indexOf('const MAX_SSE_BUFFER_BYTES', wStart);
    if (end < 0) end = server.indexOf('function writeSse', wStart);
    if (end < 0) end = next;
    if (end > wStart) {
      server = server.slice(0, wStart) +
        '// Weather: see ./weather.js (imported above as queryWeather)\n\n' +
        server.slice(end);
    }
  }
}

// Remove writeSse block (keep finishStream)
{
  const sStart = server.indexOf('const MAX_SSE_BUFFER_BYTES = 256 * 1024;');
  const sEnd = server.indexOf('// 统一流结束收尾');
  if (sStart >= 0 && sEnd > sStart) {
    server = server.slice(0, sStart) +
      '// SSE write: see ./sse-write.js (imported above as writeSse)\n\n' +
      server.slice(sEnd);
  } else {
    // maybe only function writeSse remains
    const fn = server.indexOf('function writeSse(res, payload)');
    if (fn >= 0 && sEnd > fn) {
      // walk back for const MAX or comment
      server = server.slice(0, fn) +
        '// SSE write: see ./sse-write.js (imported above as writeSse)\n\n' +
        server.slice(sEnd);
    }
  }
}

// Remove buildSearchQuery + cleanSearchResults (between finishStream return and mail)
{
  const bsq = server.indexOf('function buildSearchQuery(message)');
  const mail = server.indexOf('// ===================== Gmail SMTP 邮件配置 =====================');
  if (bsq >= 0 && mail > bsq) {
    server = server.slice(0, bsq) +
      '// Search query helpers: see ./search-providers.js\n\n' +
      server.slice(mail);
  }
}

// Remove mail block
{
  const mStart = server.indexOf('// ===================== Gmail SMTP 邮件配置 =====================');
  const mEnd = server.indexOf('// ===================== 输入校验 =====================');
  if (mStart >= 0 && mEnd > mStart) {
    server = server.slice(0, mStart) +
      '// Mail transport: see ./mail-transport.js (imported above)\n\n' +
      server.slice(mEnd);
  }
}

// Remove post-query block
{
  const pStart = server.indexOf('// ===================== 通用 posts 查询过滤 helper =====================');
  const pEnd = server.indexOf('// 统计数据内存缓存');
  if (pStart >= 0 && pEnd > pStart) {
    server = server.slice(0, pStart) +
      '// Post query filters: see ./post-query.js (imported above)\n\n' +
      server.slice(pEnd);
  }
}

// Remove util helpers
{
  const uStart = server.indexOf('function safeJsonParse(input)');
  const uEnd = server.indexOf('async function fetchAllPostsByMediaType');
  if (uStart >= 0 && uEnd > uStart) {
    server = server.slice(0, uStart) +
      '// Time/JSON helpers: see ./util-helpers.js (imported above)\n\n' +
      server.slice(uEnd);
  }
}

// Remove duplicate nodemailer init? Keep for any code that uses nodemailer directly
// Guard against double function definitions
const forbidden = [
  'async function searchWeb(',
  'async function searchTavily(',
  'async function queryWeather(',
  'function writeSse(',
  'function getMailTransporter(',
  'function buildSearchQuery(',
  'function cleanSearchResults(',
  'function isNormalPost(',
  'function applyPublicPostExclusions(',
  'function safeJsonParse('
];
for (const f of forbidden) {
  if (server.includes(f)) {
    console.warn('[warn] still has inline:', f);
  }
}

fs.writeFileSync(serverPath, server.replace(/\r\n/g, '\n'), 'utf8');
console.log('[wire] server.js bytes', Buffer.byteLength(server));

// syntax check
const { execSync } = require('child_process');
const files = [
  'render-api/search-providers.js',
  'render-api/weather.js',
  'render-api/sse-write.js',
  'render-api/mail-transport.js',
  'render-api/post-query.js',
  'render-api/util-helpers.js',
  'render-api/server.js'
];
for (const f of files) {
  execSync('node --check ' + f, { cwd: ROOT, stdio: 'inherit' });
}
console.log('[ok] all modules syntax-checked');
