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
});

test('image understanding uses OCR channel (no DeepSeek multimodal claim)', () => {
  assert.match(server, /ocrImageBuffer/);
  assert.match(server, /require\('\.\/image-ocr'\)/);
  assert.match(server, /图片 OCR 识别结果/);
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
