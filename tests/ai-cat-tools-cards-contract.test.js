'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'render-api', 'server.js'), 'utf8');
const webFetch = fs.readFileSync(path.join(root, 'render-api', 'web-fetch.js'), 'utf8');
const imageOcr = fs.readFileSync(path.join(root, 'render-api', 'image-ocr.js'), 'utf8');
const weather = fs.readFileSync(path.join(root, 'render-api', 'weather.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'js', 'ai-agent.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'ai-agent.css'), 'utf8');

test('read_web_page tool is registered and executed with SSRF-safe fetch', () => {
  assert.match(server, /name:\s*'read_web_page'/);
  assert.match(server, /case 'read_web_page':/);
  assert.match(server, /fetchSafeWebPage/);
  assert.match(server, /require\('\.\/web-fetch'\)/);
  assert.match(webFetch, /function fetchSafeWebPage/);
  assert.match(webFetch, /isPrivateAddress/);
  assert.match(webFetch, /仅支持 HTTPS/);
  // Critical: Node dns.lookup requires callback — must use dns.promises.lookup
  assert.match(webFetch, /dns\.promises\.lookup|defaultDnsLookup/);
  assert.doesNotMatch(webFetch, /lookupImpl \|\| dns\.lookup/);
});

test('new usability tools calculate + convert_units are registered', () => {
  assert.match(server, /name:\s*'calculate'/);
  assert.match(server, /case 'calculate':/);
  assert.match(server, /name:\s*'convert_units'/);
  assert.match(server, /case 'convert_units':/);
  assert.match(server, /aiSiteCard\('calculate'/);
  assert.match(server, /aiSiteCard\('unit_convert'/);
  assert.match(client, /type === 'calculate'/);
  assert.match(client, /type === 'unit_convert'/);
  assert.match(client, /calculate: '精确计算'/);
  assert.match(client, /convert_units: '单位换算'/);
  // Safe math: no Function/eval injection path
  assert.match(server, /function safeEvalMath/);
  assert.doesNotMatch(server, /Function\(['"]use strict['"]; return \(/);
  // Model prompt lists the new tools
  assert.match(server, /calculate \/ convert_units|calculate \/ convert_units|\/ calculate \/ convert_units/);
  assert.match(server, /function normalizeMarketSymbol/);
});

test('weather supports geocoding beyond fixed city list', () => {
  assert.match(weather, /geocoding-api\.open-meteo\.com/);
  assert.match(weather, /function geocodeCity/);
  assert.match(weather, /function resolveCity|async function resolveCity/);
  assert.match(weather, /成都/);
});

test('image understanding uses OCR channel (no DeepSeek multimodal claim)', () => {
  assert.match(server, /ocrImageBuffer/);
  assert.match(server, /require\('\.\/image-ocr'\)/);
  assert.match(server, /用户上传图片的可读文字/);
  assert.doesNotMatch(server, /当前暂不支持图片识别/);
  assert.match(imageOcr, /api\.ocr\.space/);
  assert.match(imageOcr, /OCR_SPACE_API_KEY/);
});

test('tool results emit structured cards for weather/rate/stock/page/ocr/search', () => {
  assert.match(server, /aiSiteCard\('weather'/);
  assert.match(server, /aiSiteCard\('exchange_rate'/);
  assert.match(server, /aiSiteCard\('stock_quote'/);
  assert.match(server, /aiSiteCard\('page_read'/);
  assert.match(server, /aiSiteCard\('image_ocr'/);
  assert.match(server, /aiSiteCard\('web_search'/);
  assert.match(server, /aiSiteCard\('time'/);
  assert.match(server, /aiSiteCard\('calculate'/);
  assert.match(server, /aiSiteCard\('unit_convert'/);
  assert.match(weather, /function queryWeatherData/);
});

test('frontend renders structured tool cards', () => {
  assert.match(client, /type === 'weather'/);
  assert.match(client, /type === 'exchange_rate'/);
  assert.match(client, /type === 'stock_quote'/);
  assert.match(client, /type === 'page_read'/);
  assert.match(client, /type === 'image_ocr'/);
  assert.match(client, /type === 'web_search'/);
  assert.match(client, /read_web_page: '阅读网页'/);
  assert.match(css, /\.ai-tool-card-hero/);
  assert.match(css, /\.ai-tool-card-kv/);
});

test('attachment extract returns cards and stream merges them', () => {
  assert.match(server, /function unwrapAttachmentExtract/);
  assert.match(server, /attachmentCardsStream/);
  assert.match(server, /writeSse\(res, \{ type: 'card', card: card \}/);
});

test('image OCR does not trigger OCR-tech web search and strips attachment noise', () => {
  assert.match(server, /function stripAttachmentNoiseForSearch/);
  assert.match(server, /function messageHasImageOcrContent/);
  assert.match(server, /blockAutoSearchForOcr/);
  assert.match(server, /禁止联网搜索 OCR/);
  assert.match(server, /function prefetchUserLinks/);
  assert.match(server, /extractHttpsUrlsFromMessage/);
});

test('OCR card uses dedicated body class and text normalize exists', () => {
  assert.match(client, /ai-tool-card-ocr-text/);
  assert.match(imageOcr, /function normalizeOcrText/);
  assert.match(webFetch, /fetchViaJinaReader|via_jina|r\.jina\.ai/);
});
