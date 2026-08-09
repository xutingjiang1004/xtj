const fs = require('fs');
const server = fs.readFileSync('render-api/server.js', 'utf8');
const search = fs.readFileSync('render-api/search-providers.js', 'utf8');
console.log('server lines', server.split(/\n/).length, 'bytes', Buffer.byteLength(server));
console.log('has research', server.includes('Tavily Research'));
console.log('has researchCacheKey', server.includes('function researchCacheKey'));
console.log('has persistResearch', server.includes('function persistResearchRecord'));
console.log('has require search', server.includes("require('./search-providers')"));
console.log('inline searchWeb', server.includes('async function searchWeb'));
console.log('inline writeSse', server.includes('function writeSse'));
console.log('inline queryWeather', server.includes('function queryWeather'));
console.log('inline getMail', server.includes('function getMailTransporter'));
console.log('inline safeJsonParse', server.includes('function safeJsonParse'));
console.log('inline isNormalPost', server.includes('function isNormalPost'));
console.log('search module buildSearchQuery count', (search.match(/function buildSearchQuery/g) || []).length);
console.log('search module searchWeb count', (search.match(/async function searchWeb/g) || []).length);
console.log('search module has research', search.includes('Tavily Research'));

const sp = require('../render-api/search-providers');
console.log('searchWeb type', typeof sp.searchWeb);
console.log('buildSearchQuery weather =>', JSON.stringify(sp.buildSearchQuery('今天天气怎么样')));
console.log('buildSearchQuery news =>', JSON.stringify(sp.buildSearchQuery('最新新闻')));

const w = require('../render-api/weather');
console.log('CITY_COORDS Beijing', !!w.CITY_COORDS['北京']);

const r = require('../render-api/util-helpers');
console.log('safeJsonParse', r.safeJsonParse('{"a":1}'));

const pq = require('../render-api/post-query');
console.log('isNormalPost image', pq.isNormalPost({ media_type: 'image' }));
console.log('isNormalPost report', pq.isNormalPost({ media_type: '__report__' }));

const sse = require('../render-api/sse-write');
console.log('writeSse type', typeof sse.writeSse);

const mail = require('../render-api/mail-transport');
console.log('getMailTransporter type', typeof mail.getMailTransporter);
console.log('OK');
