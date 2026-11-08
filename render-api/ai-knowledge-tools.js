'use strict';

// Public-knowledge tools for the cat AI: Wikipedia, papers, GitHub, package registries, vulnerabilities,
// Q&A sites, Hacker News, Wikidata, a dictionary, RSS, news and the Wayback Machine.
// Every request goes through the same SSRF-safe transport as read_web_page (DNS pinned, https only, size and
// time limits, redirects re-validated), and the transport is injectable so tests never touch the network.
// Results carry a short text for the model (`content`) and a card for the user (`cards`).
const crypto = require('node:crypto');

const UA = 'XTJ-CatAI/1.0 (+https://xtj.onrender.com)';
const WIKI_LANGS = new Set(['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'it', 'pt', 'ar', 'vi', 'th']);
const SE_SITES = new Set(['stackoverflow', 'superuser', 'serverfault', 'askubuntu', 'math', 'stats', 'unix', 'tex', 'softwareengineering', 'dba', 'gis', 'english', 'physics', 'security', 'apple', 'electronics']);
const OSV_ECOSYSTEMS = { npm: 'npm', pypi: 'PyPI', go: 'Go', maven: 'Maven', 'crates.io': 'crates.io', cargo: 'crates.io', rubygems: 'RubyGems', nuget: 'NuGet', packagist: 'Packagist', composer: 'Packagist' };

const TOOL_NAMES = ['wiki_summary', 'search_papers', 'paper_by_doi', 'cite_format', 'github_repo', 'github_issues', 'npm_pypi_lookup', 'vuln_check', 'stackexchange_search', 'hn_search', 'wikidata_facts', 'dictionary', 'rss_read', 'news_gdelt', 'wayback'];
// These reach the public network, so "no network" requests refuse them. cite_format is pure unless it is given a DOI.
const NETWORK_TOOL_NAMES = TOOL_NAMES.filter(name => name !== 'cite_format');

function tool(name, description, properties, required) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required: required || [] } } };
}
const str = (description, extra) => Object.assign({ type: 'string', description }, extra || {});
const int = (description, min, max) => ({ type: 'integer', description, minimum: min, maximum: max });

const TOOL_DEFS = [
  tool('wiki_summary', '查维基百科词条摘要（多语言），适合人物、地点、概念、事件的权威简介。比网页搜索稳定。', {
    query: str('词条名或关键词'), lang: str('语言代码，默认 zh', { enum: Array.from(WIKI_LANGS) })
  }, ['query']),
  tool('search_papers', '搜索学术论文（OpenAlex / arXiv / Crossref），返回标题、作者、年份、期刊、引用数、DOI。', {
    query: str('检索词，英文效果更好'), source: str('数据源，默认 openalex', { enum: ['openalex', 'arxiv', 'crossref'] }),
    limit: int('条数，默认 6', 1, 10), year_from: int('起始年份', 1900, 2100)
  }, ['query']),
  tool('paper_by_doi', '按 DOI 取一篇论文的详细信息（作者、期刊、摘要、引用数）。', { doi: str('DOI，如 10.1038/nature14539，可带 https://doi.org/ 前缀') }, ['doi']),
  tool('cite_format', '把论文信息格式化成引用：BibTeX、GB/T 7714、APA、MLA。可只给 DOI，也可自己提供字段。', {
    doi: str('DOI，给了就自动取信息'), title: str('题名'), authors: { type: 'array', items: { type: 'string' }, description: '作者，"姓, 名" 或 "名 姓" 或中文全名' },
    year: int('年份', 1000, 2100), venue: str('期刊或会议名'), volume: str('卷'), issue: str('期'), pages: str('页码，如 12-20'),
    publisher: str('出版社'), url: str('链接'), type: str('类型', { enum: ['journal', 'book', 'conference', 'web'] }),
    style: str('格式，默认 all', { enum: ['bibtex', 'gbt7714', 'apa', 'mla', 'all'] })
  }),
  tool('github_repo', '查 GitHub 公开仓库：简介、star、语言、许可证、最近更新、最新 release、README 摘要。', {
    repo: str('owner/name 或仓库网址'), include_readme: { type: 'boolean', description: '是否带 README 摘要，默认 true' }
  }, ['repo']),
  tool('github_issues', '搜索 GitHub 公开仓库的 issue 或 PR。', {
    repo: str('owner/name 或仓库网址'), query: str('关键词，可空'), state: str('状态，默认 open', { enum: ['open', 'closed', 'all'] }),
    kind: str('类型，默认 issue', { enum: ['issue', 'pr', 'both'] }), limit: int('条数，默认 6', 1, 10)
  }, ['repo']),
  tool('npm_pypi_lookup', '查 npm 或 PyPI 包的最新版本、简介、许可证、依赖、近一周下载量。', {
    ecosystem: str('npm 或 pypi', { enum: ['npm', 'pypi'] }), name: str('包名'), version: str('指定版本，可空')
  }, ['ecosystem', 'name']),
  tool('vuln_check', '查依赖包的已知漏洞（OSV 数据库）。尽量提供版本号，否则会返回该包历史上的全部漏洞。', {
    ecosystem: str('生态', { enum: ['npm', 'pypi', 'go', 'maven', 'crates.io', 'rubygems', 'nuget', 'packagist'] }), name: str('包名'), version: str('版本号')
  }, ['ecosystem', 'name']),
  tool('stackexchange_search', '搜索 StackOverflow 等问答站，返回高相关问题，可附带已采纳答案。', {
    query: str('问题关键词'), site: str('站点，默认 stackoverflow', { enum: Array.from(SE_SITES) }),
    tags: str('标签，分号分隔，可空'), limit: int('条数，默认 5', 1, 8), with_answer: { type: 'boolean', description: '是否附上第一个已采纳答案' }
  }, ['query']),
  tool('hn_search', '搜索 Hacker News 的帖子或评论，或看当前首页热帖。', {
    query: str('关键词，查首页时可空'), kind: str('类型，默认 story', { enum: ['story', 'comment', 'front_page'] }),
    sort: str('排序，默认 relevance', { enum: ['relevance', 'date'] }), limit: int('条数，默认 6', 1, 10)
  }),
  tool('wikidata_facts', '查维基数据里一个实体的结构化事实：出生日期、国家、人口、成立时间、总部、官网等。', {
    entity: str('实体名称'), id: str('Wikidata 编号如 Q42，给了就不用 entity'), lang: str('语言，默认 zh', { enum: ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru'] })
  }),
  tool('dictionary', '查英文单词的词典释义、词性、例句、同义词、发音。', { word: str('英文单词') }, ['word']),
  tool('rss_read', '读一个 RSS 或 Atom 订阅源，返回最新条目。', { url: str('订阅源 https 地址'), limit: int('条数，默认 8', 1, 15) }, ['url']),
  tool('news_gdelt', '检索全球新闻标题（GDELT），可限定时间范围；只返回标题、来源和链接，需要正文再用 read_web_page。', {
    query: str('关键词，多个词用空格；短语用英文引号'), timespan: str('时间范围，默认 3d', { enum: ['1d', '3d', '1w', '1m'] }),
    limit: int('条数，默认 8', 1, 12)
  }, ['query']),
  tool('wayback', '查网页在 Wayback Machine 的历史快照，页面已删除或改版时用。返回最接近指定日期的快照链接。', {
    url: str('原网页地址'), timestamp: str('目标日期 YYYYMMDD，可空，默认最新')
  }, ['url'])
];

// ---------- small helpers ----------
function clip(value, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, Math.max(0, max - 1)) + '…' : text;
}
function stripHtml(html) {
  // Block-level tags become line breaks; inline tags (code, b, i, a ...) vanish without leaving stray spaces.
  return decodeEntities(String(html == null ? '' : html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|li|pre|div|h[1-6]|tr|blockquote)>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// Like clip(), but keeps line breaks (answers and READMEs read better with their paragraphs).
function clipText(value, max) {
  const text = String(value == null ? '' : value).replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > max ? text.slice(0, Math.max(0, max - 1)) + '…' : text;
}
function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const key = e.toLowerCase();
    if (key === 'amp') return '&'; if (key === 'lt') return '<'; if (key === 'gt') return '>';
    if (key === 'quot') return '"'; if (key === 'apos') return "'"; if (key === 'nbsp') return ' ';
    const code = key[1] === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
  });
}
function enc(value) { return encodeURIComponent(String(value)); }
function safeHttpUrl(value) {
  try { const u = new URL(String(value || '')); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : ''; } catch (_) { return ''; }
}
function count(value, fallback, min, max) {
  const n = Number(value);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function plainError(name, message) { return { tool_name: name, error: message }; }

// ---------- citation formatting (pure) ----------
const CJK = /[㐀-鿿豈-﫿]/;
function parseAuthor(raw) {
  const text = clip(raw, 80);
  if (!text) return null;
  if (text.includes(',')) { const [family, given] = text.split(',').map(s => s.trim()); return { family, given: given || '' }; }
  if (CJK.test(text) || !text.includes(' ')) return { family: text, given: '', cjk: CJK.test(text) };
  const parts = text.split(/\s+/);
  return { family: parts.pop(), given: parts.join(' ') };
}
function initials(given) {
  return String(given || '').split(/[\s-]+/).filter(Boolean).map(p => p[0].toUpperCase() + '.').join(' ');
}
function normalizeRecord(input) {
  const authors = (Array.isArray(input.authors) ? input.authors : []).map(parseAuthor).filter(Boolean).slice(0, 30);
  return {
    title: clip(input.title, 300), authors, year: Number.isInteger(input.year) ? input.year : '', venue: clip(input.venue, 200),
    volume: clip(input.volume, 20), issue: clip(input.issue, 20), pages: clip(input.pages, 30).replace(/\s*[-–—]+\s*/, '-'),
    publisher: clip(input.publisher, 120), doi: clip(input.doi, 120).replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''), url: safeHttpUrl(input.url),
    type: ['journal', 'book', 'conference', 'web'].includes(input.type) ? input.type : 'journal'
  };
}
function bibKey(r) {
  const family = r.authors[0] ? r.authors[0].family : 'anon';
  const ascii = family.normalize('NFKD').replace(/[^\x00-\x7f]/g, '').replace(/[^A-Za-z]/g, '').toLowerCase() || 'anon';
  const word = (r.title.match(/[A-Za-z]{4,}/) || [''])[0].toLowerCase();
  return ascii + (r.year || '') + word;
}
function bibEscape(text) { return String(text).replace(/([{}\\&%$#_])/g, '\\$1'); }
function formatBibtex(r) {
  const kind = r.type === 'book' ? 'book' : r.type === 'conference' ? 'inproceedings' : r.type === 'web' ? 'misc' : 'article';
  const venueField = kind === 'article' ? 'journal' : kind === 'inproceedings' ? 'booktitle' : '';
  const fields = [['title', r.title], ['author', r.authors.map(a => a.given ? a.family + ', ' + a.given : a.family).join(' and ')], [venueField, r.venue],
    ['year', r.year], ['volume', r.volume], ['number', r.issue], ['pages', r.pages.replace('-', '--')], ['publisher', r.publisher], ['doi', r.doi], ['url', r.url]]
    .filter(([k, v]) => k && v !== '' && v != null);
  return '@' + kind + '{' + bibKey(r) + ',\n' + fields.map(([k, v]) => '  ' + k + ' = {' + (k === 'doi' || k === 'url' ? v : bibEscape(v)) + '}').join(',\n') + '\n}';
}
function formatGbt(r) {
  const cjk = r.authors.some(a => a.cjk) || CJK.test(r.title);
  const names = r.authors.map(a => a.cjk || !a.given ? a.family : (a.family.toUpperCase() + ' ' + initials(a.given).replace(/\./g, '')));
  const shown = names.length > 3 ? names.slice(0, 3).join(', ') + (cjk ? ', 等' : ', et al') : names.join(', ');
  const mark = r.type === 'book' ? '[M]' : r.type === 'conference' ? '[C]' : r.type === 'web' ? '[EB/OL]' : '[J]';
  let out = (shown ? shown + '. ' : '') + r.title + mark + '. ';
  if (r.type === 'book') out += (r.publisher ? r.publisher + ', ' : '') + (r.year || '');
  else {
    out += (r.venue ? r.venue + ', ' : '') + (r.year || '');
    if (r.volume) out += ', ' + r.volume + (r.issue ? '(' + r.issue + ')' : '');
    if (r.pages) out += ': ' + r.pages;
  }
  out = out.replace(/[,\s]+$/, '') + '.';
  if (r.doi) out += ' DOI:' + r.doi + '.';
  else if (r.url) out += ' ' + r.url + '.';
  return out.replace(/\.\./g, '.');
}
function formatApa(r) {
  const list = r.authors.map(a => a.given ? a.family + ', ' + initials(a.given) : a.family);
  let who = list.length > 1 ? list.slice(0, -1).join(', ') + ', & ' + list[list.length - 1] : (list[0] || '');
  if (list.length > 20) who = list.slice(0, 19).join(', ') + ', … ' + list[list.length - 1];
  let out = (who ? who + ' ' : '') + '(' + (r.year || 'n.d.') + '). ' + r.title.replace(/\.$/, '') + '.';
  if (r.venue) out += ' ' + r.venue + (r.volume ? ', ' + r.volume + (r.issue ? '(' + r.issue + ')' : '') : '') + (r.pages ? ', ' + r.pages : '') + '.';
  else if (r.publisher) out += ' ' + r.publisher + '.';
  if (r.doi) out += ' https://doi.org/' + r.doi;
  else if (r.url) out += ' ' + r.url;
  return out.trim();
}
function formatMla(r) {
  let who = '';
  if (r.authors.length === 1) who = r.authors[0].given ? r.authors[0].family + ', ' + r.authors[0].given : r.authors[0].family;
  else if (r.authors.length === 2) { const [a, b] = r.authors; who = (a.given ? a.family + ', ' + a.given : a.family) + ', and ' + (b.given ? b.given + ' ' + b.family : b.family); }
  else if (r.authors.length > 2) { const a = r.authors[0]; who = (a.given ? a.family + ', ' + a.given : a.family) + ', et al'; }
  let out = (who ? who.replace(/\.$/, '') + '. ' : '') + '"' + r.title.replace(/\.$/, '') + '." ';
  const bits = [];
  if (r.venue) bits.push(r.venue);
  if (r.volume) bits.push('vol. ' + r.volume);
  if (r.issue) bits.push('no. ' + r.issue);
  if (r.year) bits.push(String(r.year));
  if (r.pages) bits.push('pp. ' + r.pages);
  out += bits.join(', ') + (bits.length ? '.' : '');
  if (r.doi) out += ' https://doi.org/' + r.doi + '.';
  else if (r.url) out += ' ' + r.url + '.';
  return out.trim();
}
function formatCitations(input, style) {
  const record = normalizeRecord(input || {});
  if (!record.title) return null;
  const all = { bibtex: formatBibtex(record), gbt7714: formatGbt(record), apa: formatApa(record), mla: formatMla(record) };
  return style && style !== 'all' && all[style] ? { [style]: all[style] } : all;
}

function normalizeDoi(raw) {
  const doi = String(raw || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  return /^10\.\d{4,9}\/\S{1,200}$/.test(doi) ? doi : '';
}

// ---------- the tools ----------
function createKnowledgeTools(options) {
  const opts = options || {};
  const http = opts.http || defaultHttp(opts.web);
  const makeCard = opts.makeCard || ((type, title, data) => ({ protocol: 'xtj.ai.ui.v1', id: 'card_' + crypto.randomUUID(), type, title, data: data || {}, actions: [] }));
  const githubToken = opts.githubToken === undefined ? process.env.GITHUB_API_TOKEN : opts.githubToken;
  const parseXml = opts.parseXml || (() => { const { XMLParser } = require('fast-xml-parser'); const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: true }); return text => p.parse(text); })();

  async function get(url, extra) {
    const res = await http.get(url, Object.assign({ headers: { 'User-Agent': UA, Accept: 'application/json' }, timeoutMs: 12000, maxBytes: 2 * 1024 * 1024 }, extra || {}));
    return res;
  }
  async function getJson(name, url, extra) {
    const res = await get(url, extra);
    if (!res.ok) { const e = new Error('上游返回 ' + res.status); e.status = res.status; e.headers = res.headers; e.body = res.text; throw e; }
    try { return JSON.parse(res.text); } catch (_) { const e = new Error('上游返回的不是有效数据'); e.invalid = true; throw e; }
  }
  function failure(name, error, hint) {
    const status = error && error.status;
    let message;
    if (error && error.invalid) message = '数据源返回了无法识别的内容，请稍后再试，或换其他来源';
    else if (status === 404) message = hint || '没有找到对应内容';
    else if (status === 429 || (status === 403 && error.headers && String(error.headers.get && error.headers.get('x-ratelimit-remaining')) === '0')) message = '这个公开数据源访问太频繁，已被限流，请稍后再试，或换其他来源';
    else if (status) message = '数据源暂时不可用（' + status + '），请稍后再试，或换其他来源';
    else message = '暂时连不上数据源（' + clip(error && error.message || '网络错误', 60) + '），请稍后再试，或换其他来源';
    return plainError(name, message);
  }
  const linkCard = (title, results) => makeCard('link_list', title, { results: results.slice(0, 12).map(r => ({ title: clip(r.title, 140), url: safeHttpUrl(r.url), snippet: clip(r.snippet, 200), meta: clip(r.meta, 120) })) });
  const infoCard = (title, data) => makeCard('info_card', title, Object.assign({}, data, { url: safeHttpUrl(data.url), text: clip(data.text, 600), facts: (data.facts || []).slice(0, 14).map(([k, v]) => [clip(k, 20), clip(v, 120)]) }));

  async function wiki_summary(args) {
    const query = clip(args.query, 120); if (!query) return plainError('wiki_summary', '请提供要查的词条');
    const lang = WIKI_LANGS.has(String(args.lang)) ? String(args.lang) : 'zh';
    const base = 'https://' + lang + '.wikipedia.org';
    try {
      const found = await getJson('wiki_summary', base + '/w/rest.php/v1/search/page?q=' + enc(query) + '&limit=4');
      const pages = (found.pages || []).filter(p => p && p.key);
      if (!pages.length) return plainError('wiki_summary', '维基百科（' + lang + '）没有找到「' + query + '」，可换个说法或换语言再查');
      const top = pages[0];
      // The summary endpoint is rate limited per IP far more tightly than search; when it refuses, the search hit still has a short description and excerpt.
      const sum = await getJson('wiki_summary', base + '/api/rest_v1/page/summary/' + enc(top.key)).catch(() => ({
        title: top.title, description: top.description || '', extract: stripHtml(top.excerpt || ''), fallback: true
      }));
      const url = (sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page) || (base + '/wiki/' + enc(top.key));
      const others = pages.slice(1).map(p => p.title).filter(Boolean);
      const lines = [sum.title + (sum.description ? '（' + sum.description + '）' : ''), clip(sum.extract, 1500)];
      if (sum.type === 'disambiguation') lines.push('注意：这是消歧义页，可能有多个含义。');
      if (others.length) lines.push('其他相关条目：' + others.join('、'));
      lines.push('来源：' + url);
      return { tool_name: 'wiki_summary', query, title: sum.title, url, content: lines.join('\n'), cards: [infoCard('维基百科 · ' + sum.title, { subtitle: sum.description, text: sum.extract, url, source: 'Wikipedia (' + lang + ')' })] };
    } catch (error) { return failure('wiki_summary', error); }
  }

  function abstractFrom(index) {
    if (!index || typeof index !== 'object') return '';
    const words = [];
    Object.keys(index).forEach(word => (index[word] || []).forEach(pos => { if (Number.isInteger(pos) && pos < 2000) words[pos] = word; }));
    return words.filter(Boolean).join(' ');
  }
  function paperLine(p, i) {
    return (i + 1) + '. ' + p.title + '｜' + (p.authors || '作者未知') + '｜' + (p.year || '年份未知') + (p.venue ? '｜' + p.venue : '') + (p.cited != null ? '｜被引 ' + p.cited : '') + (p.doi ? '｜DOI ' + p.doi : '') + (p.abstract ? '\n   摘要：' + clip(p.abstract, 240) : '') + '\n   链接：' + p.url;
  }
  async function search_papers(args) {
    const query = clip(args.query, 200); if (!query) return plainError('search_papers', '请提供检索词');
    const source = ['openalex', 'arxiv', 'crossref'].includes(args.source) ? args.source : 'openalex';
    const limit = count(args.limit, 6, 1, 10);
    const yearFrom = Number.isInteger(args.year_from) && args.year_from >= 1900 ? args.year_from : 0;
    const fromOpenAlex = async () => {
      const filter = yearFrom ? '&filter=from_publication_date:' + yearFrom + '-01-01' : '';
      const key = opts.openalexKey === undefined ? process.env.OPENALEX_API_KEY : opts.openalexKey;
      const data = await getJson('search_papers', 'https://api.openalex.org/works?search=' + enc(query) + '&per-page=' + limit + filter + (key ? '&api_key=' + enc(key) : '') + '&select=id,doi,title,publication_year,cited_by_count,authorships,primary_location,abstract_inverted_index');
      return (data.results || []).map(w => ({
        title: clip(w.title, 200), authors: (w.authorships || []).slice(0, 4).map(a => a.author && a.author.display_name).filter(Boolean).join('、') + ((w.authorships || []).length > 4 ? ' 等' : ''),
        year: w.publication_year, venue: w.primary_location && w.primary_location.source && w.primary_location.source.display_name || '', cited: w.cited_by_count,
        doi: String(w.doi || '').replace(/^https?:\/\/doi\.org\//, ''), abstract: abstractFrom(w.abstract_inverted_index), url: w.doi || w.id
      }));
    };
    const fromCrossref = async () => {
      const filter = yearFrom ? '&filter=from-pub-date:' + yearFrom : '';
      const data = await getJson('search_papers', 'https://api.crossref.org/works?query=' + enc(query) + '&rows=' + limit + filter + '&select=DOI,title,author,issued,container-title,is-referenced-by-count,URL');
      return ((data.message && data.message.items) || []).map(w => ({
        title: clip((w.title || [])[0], 200), authors: (w.author || []).slice(0, 4).map(a => [a.given, a.family].filter(Boolean).join(' ')).join('、') + ((w.author || []).length > 4 ? ' 等' : ''),
        year: w.issued && w.issued['date-parts'] && w.issued['date-parts'][0] && w.issued['date-parts'][0][0], venue: (w['container-title'] || [])[0] || '',
        cited: w['is-referenced-by-count'], doi: w.DOI || '', abstract: '', url: w.URL || (w.DOI ? 'https://doi.org/' + w.DOI : '')
      }));
    };
    const fromArxiv = async () => {
      const res = await get('https://export.arxiv.org/api/query?search_query=all:' + enc(query) + '&max_results=' + limit + '&sortBy=relevance', { headers: { 'User-Agent': UA, Accept: 'application/atom+xml' } });
      if (!res.ok) { const e = new Error('arXiv ' + res.status); e.status = res.status; throw e; }
      const feed = parseXml(res.text).feed || {};
      return [].concat(feed.entry || []).map(e => {
        const year = Number(String(e.published || '').slice(0, 4)) || '';
        return { title: clip(typeof e.title === 'object' ? e.title['#text'] : e.title, 200), authors: [].concat(e.author || []).slice(0, 4).map(a => a.name).join('、'), year, venue: 'arXiv',
          cited: null, doi: '', abstract: clip(typeof e.summary === 'object' ? e.summary['#text'] : e.summary, 400), url: typeof e.id === 'string' ? e.id : '' };
      }).filter(p => !yearFrom || !p.year || p.year >= yearFrom);
    };
    const sources = { openalex: fromOpenAlex, crossref: fromCrossref, arxiv: fromArxiv };
    try {
      let papers = [];
      let usedSource = source, note = '';
      try { papers = await sources[source](); }
      catch (error) {
        // OpenAlex limits anonymous traffic hard; Crossref covers the same ground, so a refusal there falls back instead of failing.
        if (source !== 'openalex') throw error;
        papers = await fromCrossref(); usedSource = 'crossref'; note = '（OpenAlex 暂时不可用，已改用 Crossref）';
      }
      papers = papers.filter(p => p.title);
      if (!papers.length) return { tool_name: 'search_papers', query, results_count: 0, content: '没有找到相关论文，可换英文关键词或换数据源（openalex / arxiv / crossref）。' };
      return { tool_name: 'search_papers', query, results_count: papers.length, content: '数据源：' + usedSource + note + '\n' + papers.map(paperLine).join('\n'),
        cards: [linkCard('论文检索 · ' + papers.length + ' 篇', papers.map(p => ({ title: p.title, url: p.url, snippet: p.abstract, meta: [p.authors, p.year, p.venue].filter(Boolean).join(' · ') })))] };
    } catch (error) { return failure('search_papers', error); }
  }

  async function fetchCrossrefRecord(doi) {
    const data = await getJson('paper_by_doi', 'https://api.crossref.org/works/' + enc(doi));
    const m = data.message || {};
    const authors = (m.author || []).map(a => [a.family, a.given].filter(Boolean).join(', ') || a.name).filter(Boolean);
    const year = m.issued && m.issued['date-parts'] && m.issued['date-parts'][0] && m.issued['date-parts'][0][0];
    const typeMap = { 'journal-article': 'journal', book: 'book', monograph: 'book', 'proceedings-article': 'conference' };
    return {
      record: { title: (m.title || [])[0] || '', authors, year: Number.isInteger(year) ? year : '', venue: (m['container-title'] || [])[0] || '', volume: m.volume || '', issue: m.issue || '', pages: m.page || '',
        publisher: m.publisher || '', doi, url: m.URL || ('https://doi.org/' + doi), type: typeMap[m.type] || 'journal' },
      abstract: stripHtml(m.abstract || ''), cited: m['is-referenced-by-count'], kind: m.type
    };
  }
  async function paper_by_doi(args) {
    const doi = normalizeDoi(args.doi); if (!doi) return plainError('paper_by_doi', 'DOI 格式不对，应类似 10.1038/nature14539');
    try {
      const { record, abstract, cited, kind } = await fetchCrossrefRecord(doi);
      if (!record.title) return plainError('paper_by_doi', '这个 DOI 没有可用的题录信息');
      const content = [record.title, '作者：' + (record.authors.join('；') || '未知'), '年份：' + (record.year || '未知') + (record.venue ? '｜' + record.venue : '') + (record.volume ? ' ' + record.volume + (record.issue ? '(' + record.issue + ')' : '') : '') + (record.pages ? ' ' + record.pages : ''),
        '出版社：' + (record.publisher || '未知') + '｜类型：' + (kind || '未知') + (cited != null ? '｜被引 ' + cited : ''), abstract ? '摘要：' + clip(abstract, 1200) : '（Crossref 没有收录摘要）', '链接：' + record.url].join('\n');
      return { tool_name: 'paper_by_doi', url: record.url, title: record.title, content, cards: [infoCard('论文 · ' + clip(record.title, 60), { subtitle: [record.venue, record.year].filter(Boolean).join(' · '), text: abstract, url: record.url,
        facts: [['作者', record.authors.slice(0, 4).join('；') + (record.authors.length > 4 ? ' 等' : '')], ['DOI', doi], ['被引', cited != null ? String(cited) : '']].filter(f => f[1]) })] };
    } catch (error) { return failure('paper_by_doi', error, '没有找到这个 DOI，请核对'); }
  }

  async function cite_format(args) {
    let input = args;
    if (args.doi && !args.title) {
      const doi = normalizeDoi(args.doi); if (!doi) return plainError('cite_format', 'DOI 格式不对');
      try { input = Object.assign({}, (await fetchCrossrefRecord(doi)).record, { style: args.style }); }
      catch (error) { return failure('cite_format', error, '没有找到这个 DOI，请核对，或自己提供题名、作者、年份'); }
    }
    const cites = formatCitations(input, args.style);
    if (!cites) return plainError('cite_format', '至少需要题名（或可用的 DOI）');
    const labels = { bibtex: 'BibTeX', gbt7714: 'GB/T 7714', apa: 'APA', mla: 'MLA' };
    const content = Object.keys(cites).map(k => labels[k] + '：\n' + cites[k]).join('\n\n');
    return { tool_name: 'cite_format', content, cards: [makeCard('info_card', '引用格式', { text: Object.keys(cites).map(k => labels[k] + '  ' + cites[k]).join('\n\n').slice(0, 3000), facts: [] })] };
  }

  function repoOf(raw) {
    const text = String(raw || '').trim();
    const m = text.match(/^(?:https?:\/\/github\.com\/)?([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?(?:[/?#].*)?$/);
    return m ? { owner: m[1], name: m[2] } : null;
  }
  function ghHeaders(accept) {
    const h = { 'User-Agent': UA, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (githubToken) h.Authorization = 'Bearer ' + githubToken;
    return h;
  }
  async function github_repo(args) {
    const repo = repoOf(args.repo); if (!repo) return plainError('github_repo', '请给出 owner/name 形式的仓库，如 nodejs/node');
    const base = 'https://api.github.com/repos/' + enc(repo.owner) + '/' + enc(repo.name);
    try {
      const info = await getJson('github_repo', base, { headers: ghHeaders() });
      const [release, readme] = await Promise.all([
        getJson('github_repo', base + '/releases/latest', { headers: ghHeaders() }).catch(() => null),
        args.include_readme === false ? Promise.resolve(null) : get(base + '/readme', { headers: ghHeaders('application/vnd.github.raw+json'), maxBytes: 600 * 1024 }).then(r => r.ok ? r.text : null).catch(() => null)
      ]);
      const facts = [['star', String(info.stargazers_count)], ['fork', String(info.forks_count)], ['未关闭 issue', String(info.open_issues_count)], ['语言', info.language || ''], ['许可证', info.license && info.license.spdx_id || ''],
        ['最近推送', String(info.pushed_at || '').slice(0, 10)], ['创建', String(info.created_at || '').slice(0, 10)], ['最新版本', release ? release.tag_name + '（' + String(release.published_at || '').slice(0, 10) + '）' : '']].filter(f => f[1] && f[1] !== 'undefined');
      const lines = [info.full_name + (info.archived ? '（已归档）' : '') + '：' + (info.description || '无简介'), facts.map(f => f[0] + ' ' + f[1]).join('｜'),
        info.topics && info.topics.length ? '话题：' + info.topics.slice(0, 10).join('、') : '', info.homepage ? '主页：' + info.homepage : '', readme ? 'README 摘要：\n' + clip(readme.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]+>/g, ' '), 2500) : '', '链接：' + info.html_url].filter(Boolean);
      return { tool_name: 'github_repo', url: info.html_url, title: info.full_name, content: lines.join('\n'), cards: [infoCard('GitHub · ' + info.full_name, { subtitle: info.description, url: info.html_url, text: '', facts })] };
    } catch (error) { return failure('github_repo', error, '没有找到这个公开仓库（可能不存在或是私有的）'); }
  }
  async function github_issues(args) {
    const repo = repoOf(args.repo); if (!repo) return plainError('github_issues', '请给出 owner/name 形式的仓库');
    const state = ['open', 'closed', 'all'].includes(args.state) ? args.state : 'open';
    const kind = ['issue', 'pr', 'both'].includes(args.kind) ? args.kind : 'issue';
    const limit = count(args.limit, 6, 1, 10);
    const q = ['repo:' + repo.owner + '/' + repo.name, kind === 'issue' ? 'is:issue' : kind === 'pr' ? 'is:pr' : '', state === 'all' ? '' : 'is:' + state, clip(args.query, 120).replace(/[\r\n]/g, ' ')].filter(Boolean).join(' ');
    try {
      const data = await getJson('github_issues', 'https://api.github.com/search/issues?q=' + enc(q) + '&per_page=' + limit + '&sort=updated&order=desc', { headers: ghHeaders() });
      const items = (data.items || []).map(i => ({ title: i.title, url: i.html_url, snippet: clip(i.body, 160), meta: (i.pull_request ? 'PR' : 'issue') + ' #' + i.number + ' · ' + i.state + ' · ' + (i.user && i.user.login) + ' · ' + i.comments + ' 评论 · 更新 ' + String(i.updated_at || '').slice(0, 10) }));
      if (!items.length) return { tool_name: 'github_issues', query: q, results_count: 0, content: '没有匹配的 issue / PR。' };
      return { tool_name: 'github_issues', query: q, results_count: items.length, content: '共匹配 ' + (data.total_count || items.length) + ' 条，显示 ' + items.length + ' 条：\n' + items.map((i, n) => (n + 1) + '. ' + i.title + '｜' + i.meta + (i.snippet ? '\n   ' + i.snippet : '') + '\n   ' + i.url).join('\n'),
        cards: [linkCard('GitHub · ' + repo.owner + '/' + repo.name, items)] };
    } catch (error) { return failure('github_issues', error); }
  }

  async function npm_pypi_lookup(args) {
    const eco = String(args.ecosystem || '').toLowerCase(); const name = clip(args.name, 120); const version = clip(args.version, 40);
    if (!['npm', 'pypi'].includes(eco) || !/^(@[a-z0-9~][a-z0-9._~-]*\/)?[A-Za-z0-9~][A-Za-z0-9._~-]*$/.test(name)) return plainError('npm_pypi_lookup', '请提供 ecosystem（npm 或 pypi）和有效的包名');
    if (version && !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/.test(version)) return plainError('npm_pypi_lookup', '版本号格式不对');
    try {
      if (eco === 'npm') {
        const path = name.startsWith('@') ? '/' + name.replace('/', '%2F') : '/' + enc(name);
        const [pkg, dl] = await Promise.all([getJson('npm_pypi_lookup', 'https://registry.npmjs.org' + path + '/' + enc(version || 'latest')), getJson('npm_pypi_lookup', 'https://api.npmjs.org/downloads/point/last-week/' + (name.startsWith('@') ? name.replace('/', '%2F') : enc(name))).catch(() => null)]);
        const deps = Object.keys(pkg.dependencies || {});
        const homepage = safeHttpUrl(pkg.homepage) || 'https://www.npmjs.com/package/' + name;
        const content = [name + '@' + pkg.version + '：' + (pkg.description || '无简介'), '许可证：' + (typeof pkg.license === 'string' ? pkg.license : pkg.license && pkg.license.type || '未声明') + (dl ? '｜近一周下载 ' + dl.downloads : ''),
          '依赖 ' + deps.length + ' 个' + (deps.length ? '：' + deps.slice(0, 15).join('、') + (deps.length > 15 ? ' 等' : '') : ''), pkg.engines ? '运行环境：' + JSON.stringify(pkg.engines) : '', '链接：' + homepage].filter(Boolean).join('\n');
        return { tool_name: 'npm_pypi_lookup', url: homepage, title: name + '@' + pkg.version, content, cards: [infoCard('npm · ' + name, { subtitle: pkg.description, url: homepage, facts: [['版本', pkg.version], ['许可证', typeof pkg.license === 'string' ? pkg.license : ''], ['周下载', dl ? String(dl.downloads) : ''], ['依赖数', String(deps.length)]].filter(f => f[1]) })] };
      }
      const data = await getJson('npm_pypi_lookup', 'https://pypi.org/pypi/' + enc(name) + (version ? '/' + enc(version) : '') + '/json', { maxBytes: 4 * 1024 * 1024 });
      const info = data.info || {};
      const files = (data.urls || [])[0];
      const requires = (info.requires_dist || []).filter(r => !/extra\s*==/.test(r)).map(r => String(r).split(/[;\s(<>=!~]/)[0]).filter(Boolean);
      const homepage = safeHttpUrl(info.project_url || info.home_page) || 'https://pypi.org/project/' + name + '/';
      const content = [name + '==' + info.version + '：' + (info.summary || '无简介'), '许可证：' + (info.license && String(info.license).length < 80 ? info.license : '见项目主页') + '｜要求 Python ' + (info.requires_python || '未声明') + (files && files.upload_time_iso_8601 ? '｜发布 ' + String(files.upload_time_iso_8601).slice(0, 10) : ''),
        '依赖 ' + requires.length + ' 个' + (requires.length ? '：' + requires.slice(0, 15).join('、') + (requires.length > 15 ? ' 等' : '') : ''), '链接：' + homepage].join('\n');
      return { tool_name: 'npm_pypi_lookup', url: homepage, title: name + '==' + info.version, content, cards: [infoCard('PyPI · ' + name, { subtitle: info.summary, url: homepage, facts: [['版本', info.version], ['Python', info.requires_python || ''], ['依赖数', String(requires.length)]].filter(f => f[1]) })] };
    } catch (error) { return failure('npm_pypi_lookup', error, '没有找到这个包（或这个版本）'); }
  }

  async function vuln_check(args) {
    const ecosystem = OSV_ECOSYSTEMS[String(args.ecosystem || '').toLowerCase()]; const name = clip(args.name, 160); const version = clip(args.version, 60);
    if (!ecosystem || !name) return plainError('vuln_check', '请提供生态（如 npm / pypi）和包名');
    try {
      const res = await http.post('https://api.osv.dev/v1/query', JSON.stringify(Object.assign({ package: { name, ecosystem } }, version ? { version } : {})), { headers: { 'User-Agent': UA, 'Content-Type': 'application/json' }, timeoutMs: 12000, maxBytes: 3 * 1024 * 1024 });
      if (!res.ok) { const e = new Error('OSV ' + res.status); e.status = res.status; throw e; }
      const data = JSON.parse(res.text || '{}');
      const vulns = data.vulns || [];
      if (!vulns.length) return { tool_name: 'vuln_check', query: name + (version ? '@' + version : ''), results_count: 0, content: (version ? name + '@' + version : name) + ' 在 OSV 数据库里没有已知漏洞记录（不代表绝对安全，只代表已公开的没有）。' };
      const rows = vulns.slice(0, 10).map(v => {
        const fixed = []; (v.affected || []).forEach(a => (a.ranges || []).forEach(r => (r.events || []).forEach(e => { if (e.fixed) fixed.push(e.fixed); })));
        const cves = (v.aliases || []).filter(a => /^CVE-/.test(a));
        return { id: v.id, cves, summary: clip(v.summary || v.details, 160), fixed: Array.from(new Set(fixed)).slice(0, 4), modified: String(v.modified || '').slice(0, 10) };
      });
      const content = (version ? name + '@' + version : name) + ' 共 ' + vulns.length + ' 条漏洞记录' + (vulns.length > 10 ? '（显示前 10 条）' : '') + (version ? '' : '。注意：没有提供版本号，这是该包历史上的全部记录，请再给版本号核对。') + '\n' +
        rows.map((r, i) => (i + 1) + '. ' + r.id + (r.cves.length ? '（' + r.cves.join('、') + '）' : '') + '：' + r.summary + (r.fixed.length ? '｜修复于 ' + r.fixed.join(' / ') : '｜暂无修复版本信息') + '｜更新 ' + r.modified).join('\n');
      return { tool_name: 'vuln_check', query: name, results_count: vulns.length, content, cards: [linkCard('漏洞检查 · ' + name + ' · ' + vulns.length + ' 条', rows.map(r => ({ title: r.id + (r.cves[0] ? ' · ' + r.cves[0] : ''), url: 'https://osv.dev/vulnerability/' + r.id, snippet: r.summary, meta: r.fixed.length ? '修复于 ' + r.fixed.join(' / ') : '暂无修复版本信息' })))] };
    } catch (error) { return failure('vuln_check', error); }
  }

  async function stackexchange_search(args) {
    const query = clip(args.query, 200); if (!query) return plainError('stackexchange_search', '请提供问题关键词');
    const site = SE_SITES.has(String(args.site)) ? String(args.site) : 'stackoverflow';
    const limit = count(args.limit, 5, 1, 8);
    const tags = clip(args.tags, 80).replace(/[^A-Za-z0-9#.+;_-]/g, '');
    try {
      const data = await getJson('stackexchange_search', 'https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=' + enc(query) + '&site=' + site + '&pagesize=' + limit + (tags ? '&tagged=' + enc(tags) : ''));
      const items = (data.items || []).map(i => ({ title: decodeEntities(i.title), url: i.link, score: i.score, answers: i.answer_count, answered: i.is_answered, accepted: i.accepted_answer_id, tags: (i.tags || []).slice(0, 5) }));
      if (!items.length) return { tool_name: 'stackexchange_search', query, results_count: 0, content: '没有找到相关问题，可换关键词。' };
      let answer = '';
      const withAnswer = args.with_answer === true && items.find(i => i.accepted);
      if (withAnswer) {
        const a = await getJson('stackexchange_search', 'https://api.stackexchange.com/2.3/answers/' + withAnswer.accepted + '?site=' + site + '&filter=withbody').catch(() => null);
        const body = a && a.items && a.items[0] && a.items[0].body;
        if (body) answer = '\n\n第 ' + (items.indexOf(withAnswer) + 1) + ' 条的已采纳答案：\n' + clipText(stripHtml(body), 1800);
      }
      return { tool_name: 'stackexchange_search', query, results_count: items.length, content: items.map((i, n) => (n + 1) + '. ' + i.title + '｜评分 ' + i.score + '｜' + i.answers + ' 个回答' + (i.accepted ? '（有已采纳）' : '') + '｜' + i.tags.join(',') + '\n   ' + i.url).join('\n') + answer,
        cards: [linkCard('问答 · ' + site, items.map(i => ({ title: i.title, url: i.url, snippet: '', meta: '评分 ' + i.score + ' · ' + i.answers + ' 回答 · ' + i.tags.join(', ') })))] };
    } catch (error) { return failure('stackexchange_search', error); }
  }

  async function hn_search(args) {
    const kind = ['story', 'comment', 'front_page'].includes(args.kind) ? args.kind : 'story';
    const query = clip(args.query, 200); const limit = count(args.limit, 6, 1, 10);
    if (kind !== 'front_page' && !query) return plainError('hn_search', '请提供搜索关键词（或用 front_page 看首页热帖）');
    const endpoint = args.sort === 'date' && kind !== 'front_page' ? 'search_by_date' : 'search';
    const tags = kind === 'front_page' ? 'front_page' : kind;
    try {
      const data = await getJson('hn_search', 'https://hn.algolia.com/api/v1/' + endpoint + '?tags=' + tags + '&hitsPerPage=' + limit + (query && kind !== 'front_page' ? '&query=' + enc(query) : ''));
      const hits = (data.hits || []).map(h => {
        const discussion = 'https://news.ycombinator.com/item?id=' + h.objectID;
        return kind === 'comment' ? { title: clip(stripHtml(h.comment_text), 140), url: discussion, snippet: '', meta: h.author + ' · ' + String(h.created_at || '').slice(0, 10) + ' · 属于《' + clip(h.story_title, 50) + '》' }
          : { title: h.title, url: safeHttpUrl(h.url) || discussion, snippet: '', meta: h.points + ' 分 · ' + h.num_comments + ' 评论 · ' + h.author + ' · ' + String(h.created_at || '').slice(0, 10) + ' · 讨论 ' + discussion };
      }).filter(h => h.title);
      if (!hits.length) return { tool_name: 'hn_search', query, results_count: 0, content: '没有找到相关内容。' };
      return { tool_name: 'hn_search', query, results_count: hits.length, content: hits.map((h, i) => (i + 1) + '. ' + h.title + '｜' + h.meta + '\n   ' + h.url).join('\n'), cards: [linkCard('Hacker News · ' + (kind === 'front_page' ? '首页' : query), hits)] };
    } catch (error) { return failure('hn_search', error); }
  }

  const WD_PROPS = [['P31', '类型'], ['P17', '国家'], ['P27', '国籍'], ['P569', '出生日期'], ['P19', '出生地'], ['P570', '逝世日期'], ['P106', '职业'], ['P571', '成立时间'], ['P159', '总部所在地'], ['P112', '创始人'], ['P169', '首席执行官'],
    ['P36', '首都'], ['P38', '货币'], ['P1082', '人口'], ['P2046', '面积(km²)'], ['P577', '发布日期'], ['P50', '作者'], ['P57', '导演'], ['P856', '官网']];
  function wdTime(value) {
    const m = String(value && value.time || '').match(/^([+-])(\d{4,})-(\d\d)-(\d\d)/); if (!m) return '';
    const year = m[1] === '-' ? '公元前' + Number(m[2]) : String(Number(m[2]));
    const p = value.precision;
    return p >= 11 ? year + '-' + m[3] + '-' + m[4] : p === 10 ? year + '-' + m[3] : year;
  }
  async function wikidata_facts(args) {
    const lang = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru'].includes(args.lang) ? args.lang : 'zh';
    let id = String(args.id || '').trim().toUpperCase();
    try {
      if (!/^Q\d{1,12}$/.test(id)) {
        const entity = clip(args.entity, 100); if (!entity) return plainError('wikidata_facts', '请提供实体名称或 Wikidata 编号');
        const found = await getJson('wikidata_facts', 'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&limit=3&language=' + lang + '&uselang=' + lang + '&search=' + enc(entity));
        const top = (found.search || [])[0]; if (!top) return plainError('wikidata_facts', '维基数据里没有找到「' + entity + '」');
        id = top.id;
      }
      const data = await getJson('wikidata_facts', 'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels|descriptions|claims&languages=' + lang + '|en&ids=' + id, { maxBytes: 4 * 1024 * 1024 });
      const entity = data.entities && data.entities[id]; if (!entity || entity.missing !== undefined) return plainError('wikidata_facts', '没有找到这个实体');
      const pick = obj => obj && (obj[lang] || obj.en) && (obj[lang] || obj.en).value || '';
      const pending = []; const raw = [];
      WD_PROPS.forEach(([pid, label]) => {
        const claims = (entity.claims && entity.claims[pid] || []).filter(c => c.mainsnak && c.mainsnak.datavalue && c.rank !== 'deprecated').slice(0, 4);
        const values = claims.map(c => c.mainsnak.datavalue);
        if (!values.length) return;
        const row = { label, items: values.map(v => {
          if (v.type === 'wikibase-entityid') { const qid = v.value.id; pending.push(qid); return { qid }; }
          if (v.type === 'time') return { text: wdTime(v.value) };
          if (v.type === 'quantity') return { text: String(Number(v.value.amount)) };
          if (v.type === 'monolingualtext') return { text: v.value.text };
          return { text: typeof v.value === 'string' ? v.value : '' };
        }) };
        raw.push(row);
      });
      let labels = {};
      const unique = Array.from(new Set(pending)).slice(0, 50);
      if (unique.length) {
        const lab = await getJson('wikidata_facts', 'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=' + lang + '|en&ids=' + unique.join('|')).catch(() => null);
        Object.keys(lab && lab.entities || {}).forEach(q => { labels[q] = pick(lab.entities[q].labels) || q; });
      }
      const facts = raw.map(r => [r.label, r.items.map(i => i.qid ? (labels[i.qid] || i.qid) : i.text).filter(Boolean).join('、')]).filter(f => f[1]);
      const label = pick(entity.labels) || id; const desc = pick(entity.descriptions);
      const url = 'https://www.wikidata.org/wiki/' + id;
      return { tool_name: 'wikidata_facts', url, title: label, content: label + (desc ? '（' + desc + '）' : '') + ' [' + id + ']\n' + (facts.length ? facts.map(f => f[0] + '：' + f[1]).join('\n') : '没有收录常见属性。') + '\n来源：' + url,
        cards: [infoCard('维基数据 · ' + label, { subtitle: desc, url, facts })] };
    } catch (error) { return failure('wikidata_facts', error); }
  }

  async function dictionary(args) {
    const word = clip(args.word, 60).toLowerCase();
    if (!word) return plainError('dictionary', '请提供一个英文单词');
    if (CJK.test(word) || !/^[a-z][a-z' -]{0,58}$/.test(word)) return plainError('dictionary', '这个词典只支持英文单词；中文词语请用 wiki_summary 或直接解释');
    try {
      const data = await getJson('dictionary', 'https://api.dictionaryapi.dev/api/v2/entries/en/' + enc(word));
      const entry = Array.isArray(data) ? data[0] : null;
      if (!entry) return plainError('dictionary', '没有找到这个词条');
      const phonetic = entry.phonetic || (entry.phonetics || []).map(p => p.text).find(Boolean) || '';
      const meanings = (entry.meanings || []).slice(0, 4).map(m => ({ pos: m.partOfSpeech, defs: (m.definitions || []).slice(0, 3), syn: (m.synonyms || []).slice(0, 6) }));
      const content = entry.word + (phonetic ? ' ' + phonetic : '') + '\n' + meanings.map(m => '[' + m.pos + '] ' + m.defs.map((d, i) => (i + 1) + '. ' + d.definition + (d.example ? '（例：' + d.example + '）' : '')).join(' ') + (m.syn.length ? ' 同义词：' + m.syn.join(', ') : '')).join('\n');
      return { tool_name: 'dictionary', query: word, title: entry.word, content, cards: [infoCard('词典 · ' + entry.word, { subtitle: phonetic, text: meanings.map(m => '[' + m.pos + '] ' + (m.defs[0] ? m.defs[0].definition : '')).join('\n'), facts: [] })] };
    } catch (error) { return failure('dictionary', error, '没有找到这个词条，请检查拼写'); }
  }

  async function rss_read(args) {
    const url = String(args.url || '').trim(); const limit = count(args.limit, 8, 1, 15);
    if (!/^https:\/\//i.test(url) || url.length > 1000) return plainError('rss_read', '请提供 https 开头的订阅源地址');
    try {
      const res = await get(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.5' }, maxBytes: 3 * 1024 * 1024 });
      if (!res.ok) { const e = new Error('订阅源返回 ' + res.status); e.status = res.status; throw e; }
      let doc; try { doc = parseXml(res.text); } catch (_) { return plainError('rss_read', '这个地址返回的不是有效的 RSS / Atom'); }
      const channel = doc.rss && doc.rss.channel || null; const atom = doc.feed || null; const rdf = doc['rdf:RDF'] || null;
      const text = v => clip(stripHtml(typeof v === 'object' && v ? (v['#text'] || '') : v), 400);
      let feedTitle = ''; let items = [];
      if (channel) { feedTitle = text(channel.title); items = [].concat(channel.item || []).map(i => ({ title: text(i.title), url: typeof i.link === 'string' ? i.link : (i.link && i.link['#text']) || '', date: String(i.pubDate || i['dc:date'] || '').slice(0, 40), summary: text(i.description || i['content:encoded']) })); }
      else if (atom) { feedTitle = text(atom.title); items = [].concat(atom.entry || []).map(i => { const links = [].concat(i.link || []); const l = links.find(x => x['@_rel'] !== 'self') || links[0] || {}; return { title: text(i.title), url: l['@_href'] || '', date: String(i.updated || i.published || '').slice(0, 25), summary: text(i.summary || i.content) }; }); }
      else if (rdf) { feedTitle = text(rdf.channel && rdf.channel.title); items = [].concat(rdf.item || []).map(i => ({ title: text(i.title), url: typeof i.link === 'string' ? i.link : '', date: String(i['dc:date'] || '').slice(0, 25), summary: text(i.description) })); }
      else return plainError('rss_read', '没有识别出订阅源内容');
      items = items.filter(i => i.title).slice(0, limit);
      if (!items.length) return { tool_name: 'rss_read', url, results_count: 0, content: '订阅源里没有条目。' };
      return { tool_name: 'rss_read', url, title: feedTitle, results_count: items.length, content: (feedTitle ? feedTitle + '\n' : '') + items.map((i, n) => (n + 1) + '. ' + i.title + (i.date ? '｜' + i.date : '') + (i.summary ? '\n   ' + clip(i.summary, 200) : '') + (i.url ? '\n   ' + i.url : '')).join('\n'),
        cards: [linkCard('订阅 · ' + (feedTitle || url), items.map(i => ({ title: i.title, url: i.url, snippet: i.summary, meta: i.date })))] };
    } catch (error) { return failure('rss_read', error); }
  }

  async function news_gdelt(args) {
    const query = clip(args.query, 200); if (query.length < 2) return plainError('news_gdelt', '请提供检索关键词');
    const span = ['1d', '3d', '1w', '1m'].includes(args.timespan) ? args.timespan : '3d'; const limit = count(args.limit, 8, 1, 12);
    try {
      const res = await get('https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&sort=datedesc&maxrecords=' + limit + '&timespan=' + span + '&query=' + enc(query));
      if (!res.ok) { const e = new Error('GDELT ' + res.status); e.status = res.status; throw e; }
      let data; try { data = JSON.parse(res.text); } catch (_) { return plainError('news_gdelt', '新闻库返回了提示而不是数据：' + clip(res.text, 100) + '。可稍后再试，或换关键词'); }
      const articles = (data.articles || []).map(a => {
        const d = String(a.seendate || ''); const date = /^\d{8}T/.test(d) ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) : d;
        return { title: clip(a.title, 160), url: a.url, meta: [a.domain, a.language, a.sourcecountry, date].filter(Boolean).join(' · ') };
      }).filter(a => a.title);
      if (!articles.length) return { tool_name: 'news_gdelt', query, results_count: 0, content: '这段时间没有匹配的新闻，可放宽时间范围或换关键词。' };
      return { tool_name: 'news_gdelt', query, results_count: articles.length, content: '范围：最近 ' + span + '（只有标题，需要正文请用 read_web_page 读取链接）\n' + articles.map((a, i) => (i + 1) + '. ' + a.title + '｜' + a.meta + '\n   ' + a.url).join('\n'),
        cards: [linkCard('新闻 · ' + query, articles)] };
    } catch (error) { return failure('news_gdelt', error); }
  }

  async function wayback(args) {
    const target = String(args.url || '').trim();
    if (!/^https?:\/\//i.test(target) || target.length > 1500) return plainError('wayback', '请提供完整的网页地址（http 或 https）');
    const ts = String(args.timestamp || '').replace(/\D/g, '').slice(0, 14);
    try {
      const data = await getJson('wayback', 'https://archive.org/wayback/available?url=' + enc(target) + (ts ? '&timestamp=' + ts : ''));
      const snap = data.archived_snapshots && data.archived_snapshots.closest;
      if (!snap || !snap.available) return { tool_name: 'wayback', url: target, results_count: 0, content: 'Wayback Machine 里没有这个网页的快照。' };
      const raw = String(snap.timestamp || ''); const date = raw.length >= 8 ? raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8) : raw;
      const url = String(snap.url || '').replace(/^http:\/\//i, 'https://');
      if (!/^https:\/\/web\.archive\.org\//.test(url)) return plainError('wayback', '快照地址异常，已忽略');
      return { tool_name: 'wayback', url, title: '网页快照 ' + date, results_count: 1, content: '最接近' + (ts ? '指定日期' : '现在') + '的快照：' + date + '（HTTP ' + (snap.status || '?') + '）\n' + url + '\n可用 read_web_page 读取这个快照链接的内容。',
        cards: [linkCard('网页快照', [{ title: target, url, snippet: '', meta: '快照时间 ' + date }])] };
    } catch (error) { return failure('wayback', error); }
  }

  const handlers = { wiki_summary, search_papers, paper_by_doi, cite_format, github_repo, github_issues, npm_pypi_lookup, vuln_check, stackexchange_search, hn_search, wikidata_facts, dictionary, rss_read, news_gdelt, wayback };
  return {
    has: name => Object.prototype.hasOwnProperty.call(handlers, name),
    async execute(name, args) {
      if (!this.has(name)) return plainError(name, '未知工具');
      try { return await handlers[name](args && typeof args === 'object' ? args : {}); }
      catch (error) { return plainError(name, '工具执行失败：' + clip(error && error.message, 100)); }
    }
  };
}

// Default transport: the same pinned, https-only fetchers read_web_page uses.
function defaultHttp(injected) {
  const web = injected || require('./web-fetch');
  return {
    async get(url, o) {
      const res = await web.fetchSafeRedirectBuffer(url, { headers: o.headers, timeoutMs: o.timeoutMs, maxBytes: o.maxBytes, maxRedirects: 2 });
      return { ok: res.ok, status: res.status, headers: res.headers, text: res.buffer.toString('utf8') };
    },
    async post(url, body, o) {
      const safe = await web.assertSafeWebUrl(url);
      const res = await web.requestPinnedJson(safe.parsed, safe.addresses, { method: 'POST', body, headers: o.headers, timeoutMs: o.timeoutMs, maxBytes: o.maxBytes });
      return { ok: res.status >= 200 && res.status < 300, status: res.status, headers: res.headers, text: res.text };
    }
  };
}

module.exports = { createKnowledgeTools, TOOL_DEFS, TOOL_NAMES, NETWORK_TOOL_NAMES, formatCitations, normalizeDoi, stripHtml, clip };
