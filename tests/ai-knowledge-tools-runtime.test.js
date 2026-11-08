'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createKnowledgeTools, TOOL_DEFS, TOOL_NAMES, NETWORK_TOOL_NAMES, formatCitations, normalizeDoi } = require('../render-api/ai-knowledge-tools');

// A fake transport: first matching route wins; every request is recorded, nothing touches the network.
function fakeHttp(routes) {
  const calls = [];
  const find = url => { const hit = routes.find(([pattern]) => pattern.test(url)); return hit ? hit[1] : null; };
  const run = async (url, body) => {
    calls.push({ url, body });
    const r = find(url);
    if (!r) return { ok: false, status: 404, headers: { get: () => null }, text: '' };
    if (r instanceof Error) throw r;
    const res = typeof r === 'function' ? r(url, body) : r;
    const status = res.status || 200;
    return { ok: status >= 200 && status < 300, status, headers: { get: key => (res.headers || {})[String(key).toLowerCase()] || null }, text: typeof res.body === 'string' ? res.body : JSON.stringify(res.body) };
  };
  return { http: { get: (url) => run(url), post: (url, body) => run(url, body) }, calls };
}
const tools = (routes, extra) => { const f = fakeHttp(routes); return Object.assign({ t: createKnowledgeTools(Object.assign({ http: f.http, githubToken: '' }, extra || {})) }, f); };
const json = body => ({ body });

test('every knowledge tool has a definition, a handler, a compact description and is registered as network or pure', () => {
  assert.equal(TOOL_DEFS.length, 15);
  const t = createKnowledgeTools({ http: fakeHttp([]).http });
  for (const def of TOOL_DEFS) {
    const name = def.function.name;
    assert.ok(TOOL_NAMES.includes(name) && t.has(name), name);
    assert.equal(def.function.parameters.type, 'object');
    for (const r of def.function.parameters.required) assert.ok(def.function.parameters.properties[r], name + ' requires an undeclared property ' + r);
    assert.ok(def.function.description.length < 140, name + ' description too long');
  }
  assert.ok(!NETWORK_TOOL_NAMES.includes('cite_format') && NETWORK_TOOL_NAMES.length === 14);
});

test('wiki_summary searches, reads the summary, names other candidates and returns an info card', async () => {
  const { t, calls } = tools([
    [/zh\.wikipedia\.org\/w\/rest\.php\/v1\/search\/page/, json({ pages: [{ key: '图灵', title: '图灵' }, { key: '图灵奖', title: '图灵奖' }] })],
    [/zh\.wikipedia\.org\/api\/rest_v1\/page\/summary\//, json({ title: '艾伦·图灵', description: '英国数学家', extract: '艾伦·麦席森·图灵是英国数学家、逻辑学家。', content_urls: { desktop: { page: 'https://zh.wikipedia.org/wiki/图灵' } } })]
  ]);
  const r = await t.execute('wiki_summary', { query: '图灵', lang: 'zh' });
  assert.match(r.content, /英国数学家/); assert.match(r.content, /其他相关条目：图灵奖/); assert.match(r.content, /来源：https:\/\/zh\.wikipedia\.org/);
  assert.equal(r.cards[0].type, 'info_card'); assert.equal(r.cards[0].protocol, 'xtj.ai.ui.v1');
  assert.match(calls[1].url, /summary\/%E5%9B%BE%E7%81%B5$/);
  // an unknown language falls back to zh instead of building a wikipedia host from model text
  await t.execute('wiki_summary', { query: 'x', lang: 'evil.com/#' });
  assert.ok(calls.every(c => /^https:\/\/zh\.wikipedia\.org\//.test(c.url)));
  assert.match((await tools([[/search\/page/, json({ pages: [] })]]).t.execute('wiki_summary', { query: '不存在的词条' })).error, /没有找到/);
  assert.match((await t.execute('wiki_summary', { query: '  ' })).error, /请提供/);
});

test('search_papers supports openalex, crossref and arxiv, and rebuilds abstracts from the inverted index', async () => {
  const oa = tools([[/api\.openalex\.org\/works/, json({ results: [{ id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1/abc', title: 'Attention', publication_year: 2017, cited_by_count: 9000,
    authorships: [{ author: { display_name: 'A' } }, { author: { display_name: 'B' } }, { author: { display_name: 'C' } }, { author: { display_name: 'D' } }, { author: { display_name: 'E' } }],
    primary_location: { source: { display_name: 'NeurIPS' } }, abstract_inverted_index: { Hello: [0], world: [1], again: [2] } }] })]]);
  const r = await oa.t.execute('search_papers', { query: 'transformer', year_from: 2015, limit: 3 });
  assert.match(r.content, /Attention｜A、B、C、D 等｜2017｜NeurIPS｜被引 9000｜DOI 10\.1\/abc/); assert.match(r.content, /摘要：Hello world again/);
  assert.match(oa.calls[0].url, /from_publication_date:2015-01-01/); assert.match(oa.calls[0].url, /per-page=3/);
  assert.equal(r.cards[0].type, 'link_list'); assert.equal(r.cards[0].data.results[0].url, 'https://doi.org/10.1/abc');

  const cr = tools([[/api\.crossref\.org\/works\?/, json({ message: { items: [{ DOI: '10.2/x', title: ['Paper X'], author: [{ given: 'Ann', family: 'Lee' }], issued: { 'date-parts': [[2020]] }, 'container-title': ['J'], 'is-referenced-by-count': 3, URL: 'https://doi.org/10.2/x' }] } })]]);
  assert.match((await cr.t.execute('search_papers', { query: 'x', source: 'crossref' })).content, /Paper X｜Ann Lee｜2020｜J｜被引 3/);

  const atom = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T17:57:34Z</published><title>Attention Is All You Need</title><summary>The dominant sequence models.</summary><author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author></entry></feed>';
  const ax = tools([[/export\.arxiv\.org\/api\/query/, { body: atom }]]);
  const r3 = await ax.t.execute('search_papers', { query: 'attention', source: 'arxiv' });
  assert.match(r3.content, /Attention Is All You Need｜Ashish Vaswani、Noam Shazeer｜2017｜arXiv/); assert.match(r3.content, /链接：http:\/\/arxiv\.org\/abs\/1706\.03762v7/);
  assert.equal((await tools([[/openalex/, json({ results: [] })]]).t.execute('search_papers', { query: 'zzz' })).results_count, 0);
  assert.match((await oa.t.execute('search_papers', { query: '' })).error, /请提供/);
});

test('paper_by_doi reads Crossref, cleans the JATS abstract, rejects malformed DOIs and reports unknown ones', async () => {
  const body = { message: { title: ['Deep learning'], author: [{ given: 'Yann', family: 'LeCun' }, { given: 'Yoshua', family: 'Bengio' }], issued: { 'date-parts': [[2015, 5]] }, 'container-title': ['Nature'], volume: '521', issue: '7553', page: '436-444',
    publisher: 'Springer', type: 'journal-article', abstract: '<jats:p>Deep learning <jats:italic>allows</jats:italic> models.</jats:p>', 'is-referenced-by-count': 70000, URL: 'https://doi.org/10.1038/nature14539' } };
  const { t, calls } = tools([[/api\.crossref\.org\/works\/10\.1038/, json(body)]]);
  const r = await t.execute('paper_by_doi', { doi: 'https://doi.org/10.1038/nature14539' });
  assert.match(r.content, /Deep learning/); assert.match(r.content, /LeCun, Yann；Bengio, Yoshua/); assert.match(r.content, /被引 70000/); assert.match(r.content, /摘要：Deep learning allows models\./);
  assert.match(calls[0].url, /works\/10\.1038%2Fnature14539$/);
  assert.match((await t.execute('paper_by_doi', { doi: 'not a doi' })).error, /DOI 格式/);
  assert.match((await t.execute('paper_by_doi', { doi: '10.9999/unknown' })).error, /没有找到这个 DOI/);
  assert.equal(normalizeDoi('doi: 10.1/ab'), ''); assert.equal(normalizeDoi('DOI:10.1234/ab.c'), '10.1234/ab.c');
});

test('cite_format writes BibTeX, GB/T 7714, APA and MLA for English and Chinese records, and can start from a DOI', async () => {
  const en = formatCitations({ title: 'Deep learning', authors: ['LeCun, Yann', 'Bengio, Yoshua', 'Hinton, Geoffrey'], year: 2015, venue: 'Nature', volume: '521', issue: '7553', pages: '436-444', doi: 'https://doi.org/10.1038/nature14539' });
  assert.match(en.bibtex, /^@article\{lecun2015deep,/); assert.match(en.bibtex, /pages = \{436--444\}/); assert.match(en.bibtex, /author = \{LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey\}/);
  assert.equal(en.gbt7714, 'LECUN Y, BENGIO Y, HINTON G. Deep learning[J]. Nature, 2015, 521(7553): 436-444. DOI:10.1038/nature14539.');
  assert.equal(en.apa, 'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436-444. https://doi.org/10.1038/nature14539');
  assert.equal(en.mla, 'LeCun, Yann, et al. "Deep learning." Nature, vol. 521, no. 7553, 2015, pp. 436-444. https://doi.org/10.1038/nature14539.');
  const zh = formatCitations({ title: '深度学习研究综述', authors: ['张三', '李四', '王五', '赵六'], year: 2020, venue: '计算机学报', volume: '43', issue: '5', pages: '1-20' });
  assert.equal(zh.gbt7714, '张三, 李四, 王五, 等. 深度学习研究综述[J]. 计算机学报, 2020, 43(5): 1-20.');
  // special characters and unnamed styles
  assert.match(formatCitations({ title: 'R&D 100% {x}', authors: ['A B'], year: 2020 }).bibtex, /title = \{R\\&D 100\\% \\\{x\\\}\}/);
  assert.deepEqual(Object.keys(formatCitations({ title: 'T', authors: [] }, 'apa')), ['apa']);
  assert.equal(formatCitations({ authors: ['A B'] }), null);
  const { t } = tools([[/api\.crossref\.org\/works\/10\.1038/, json({ message: { title: ['Deep learning'], author: [{ given: 'Yann', family: 'LeCun' }], issued: { 'date-parts': [[2015]] }, 'container-title': ['Nature'], type: 'journal-article' } })]]);
  const viaDoi = await t.execute('cite_format', { doi: '10.1038/nature14539', style: 'apa' });
  assert.match(viaDoi.content, /APA：\nLeCun, Y\. \(2015\)\. Deep learning\. Nature\./); assert.ok(!/BibTeX/.test(viaDoi.content));
  assert.match((await t.execute('cite_format', { style: 'apa' })).error, /至少需要题名/);
});

test('github_repo and github_issues parse repository forms, show rate limits honestly and send the optional token only to github', async () => {
  const repo = { full_name: 'nodejs/node', description: 'Node.js JavaScript runtime', stargazers_count: 100000, forks_count: 30000, open_issues_count: 1500, language: 'JavaScript', license: { spdx_id: 'MIT' }, pushed_at: '2026-11-01T00:00:00Z', created_at: '2014-11-26T00:00:00Z', topics: ['nodejs', 'runtime'], homepage: 'https://nodejs.org', html_url: 'https://github.com/nodejs/node', archived: false };
  const seen = [];
  const f = fakeHttp([[/api\.github\.com\/repos\/nodejs\/node\/releases\/latest/, json({ tag_name: 'v24.0.0', published_at: '2026-10-01T00:00:00Z' })], [/api\.github\.com\/repos\/nodejs\/node\/readme/, { body: '# Node.js\n\n![logo](x.png)\nNode.js is an open-source runtime.' }], [/api\.github\.com\/repos\/nodejs\/node$/, json(repo)]]);
  const origGet = f.http.get; f.http.get = (url, o) => { seen.push(o); return origGet(url, o); };
  const t = createKnowledgeTools({ http: f.http, githubToken: 'TESTTOKEN' });
  const r = await t.execute('github_repo', { repo: 'https://github.com/nodejs/node.git' });
  assert.match(r.content, /nodejs\/node：Node\.js JavaScript runtime/); assert.match(r.content, /star 100000/); assert.match(r.content, /最新版本 v24\.0\.0（2026-10-01）/); assert.match(r.content, /README 摘要：[\s\S]*Node\.js is an open-source runtime/); assert.ok(!/logo/.test(r.content));
  assert.ok(f.calls.every(c => /^https:\/\/api\.github\.com\//.test(c.url)));
  assert.equal(f.calls.length, 3);
  assert.match((await t.execute('github_repo', { repo: 'not a repo' })).error, /owner\/name/);
  assert.match((await t.execute('github_repo', { repo: '../../etc/passwd' })).error, /owner\/name/);
  const limited = tools([[/api\.github\.com/, { status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: { message: 'rate limit' } }]]);
  assert.match((await limited.t.execute('github_repo', { repo: 'a/b' })).error, /限流/);
  assert.match((await tools([[/api\.github\.com/, { status: 404, body: {} }]]).t.execute('github_repo', { repo: 'a/b' })).error, /没有找到这个公开仓库/);

  const issues = tools([[/api\.github\.com\/search\/issues/, json({ total_count: 2, items: [{ title: 'Crash on start', html_url: 'https://github.com/a/b/issues/7', number: 7, state: 'open', user: { login: 'u' }, comments: 3, updated_at: '2026-10-30T00:00:00Z', body: 'It crashes\n\nwith a long trace', pull_request: undefined }, { title: 'Fix crash', html_url: 'https://github.com/a/b/pull/8', number: 8, state: 'closed', user: { login: 'v' }, comments: 0, updated_at: '2026-10-31T00:00:00Z', body: null, pull_request: {} }] })]]);
  const ir = await issues.t.execute('github_issues', { repo: 'a/b', query: 'crash', kind: 'both', state: 'all', limit: 5 });
  assert.match(ir.content, /共匹配 2 条/); assert.match(ir.content, /issue #7 · open · u · 3 评论/); assert.match(ir.content, /PR #8 · closed/);
  const q = decodeURIComponent(issues.calls[0].url.split('q=')[1].split('&')[0]);
  assert.equal(q, 'repo:a/b crash'); assert.match(issues.calls[0].url, /per_page=5/);
  assert.equal(decodeURIComponent((await (async () => { const x = tools([[/search\/issues/, json({ items: [] })]]); await x.t.execute('github_issues', { repo: 'a/b', query: 'bug', state: 'closed' }); return x.calls[0].url.split('q=')[1].split('&')[0]; })())), 'repo:a/b is:issue is:closed bug');
  // an injected qualifier cannot reach another repository through newlines
  const inj = tools([[/search\/issues/, json({ items: [] })]]); await inj.t.execute('github_issues', { repo: 'a/b', query: 'x\nrepo:evil/secret' });
  assert.ok(!/\n/.test(decodeURIComponent(inj.calls[0].url)));
});

test('npm_pypi_lookup handles scoped npm names, pypi metadata and rejects odd names or versions', async () => {
  const npm = tools([[/registry\.npmjs\.org\/@scope%2Fpkg\/latest$/, json({ name: '@scope/pkg', version: '2.1.0', description: 'A pkg', license: 'MIT', homepage: 'https://example.dev', dependencies: { a: '1', b: '2' }, engines: { node: '>=18' } })], [/api\.npmjs\.org\/downloads\/point\/last-week\/@scope%2Fpkg/, json({ downloads: 12345 })]]);
  const r = await npm.t.execute('npm_pypi_lookup', { ecosystem: 'npm', name: '@scope/pkg' });
  assert.match(r.content, /@scope\/pkg@2\.1\.0：A pkg/); assert.match(r.content, /近一周下载 12345/); assert.match(r.content, /依赖 2 个：a、b/); assert.equal(r.cards[0].type, 'info_card');
  const py = tools([[/pypi\.org\/pypi\/requests\/json$/, json({ info: { version: '2.32.0', summary: 'HTTP for Humans', license: 'Apache-2.0', requires_python: '>=3.8', requires_dist: ['urllib3>=1.21', 'certifi (>=2017)', 'PySocks; extra == "socks"'], project_url: 'https://pypi.org/project/requests/' }, urls: [{ upload_time_iso_8601: '2024-05-29T15:37:47Z' }] })]]);
  const p = await py.t.execute('npm_pypi_lookup', { ecosystem: 'pypi', name: 'requests' });
  assert.match(p.content, /requests==2\.32\.0：HTTP for Humans/); assert.match(p.content, /要求 Python >=3\.8｜发布 2024-05-29/); assert.match(p.content, /依赖 2 个：urllib3、certifi/);
  for (const bad of [{ ecosystem: 'npm', name: '../x' }, { ecosystem: 'npm', name: 'a b' }, { ecosystem: 'gem', name: 'x' }]) assert.match((await npm.t.execute('npm_pypi_lookup', bad)).error, /ecosystem|包名/);
  assert.match((await npm.t.execute('npm_pypi_lookup', { ecosystem: 'npm', name: 'ok', version: '1; rm' })).error, /版本号格式/);
  assert.match((await tools([[/registry\.npmjs\.org/, { status: 404, body: {} }]]).t.execute('npm_pypi_lookup', { ecosystem: 'npm', name: 'nope' })).error, /没有找到这个包/);
});

test('vuln_check posts the package to OSV, summarizes fixes and warns when no version was given', async () => {
  const osv = { vulns: [{ id: 'GHSA-xxxx', aliases: ['CVE-2021-23337'], summary: 'Command injection in lodash', modified: '2024-01-02T00:00:00Z', affected: [{ ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }] }, { id: 'GHSA-yyyy', aliases: [], details: 'Prototype pollution', modified: '2023-05-05T00:00:00Z', affected: [] }] };
  const { t, calls } = tools([[/api\.osv\.dev\/v1\/query/, json(osv)]]);
  const r = await t.execute('vuln_check', { ecosystem: 'npm', name: 'lodash', version: '4.17.20' });
  assert.deepEqual(JSON.parse(calls[0].body), { package: { name: 'lodash', ecosystem: 'npm' }, version: '4.17.20' });
  assert.match(r.content, /lodash@4\.17\.20 共 2 条漏洞记录/); assert.match(r.content, /GHSA-xxxx（CVE-2021-23337）：Command injection in lodash｜修复于 4\.17\.21/); assert.match(r.content, /暂无修复版本信息/); assert.ok(!/请再给版本号/.test(r.content));
  const noVersion = await t.execute('vuln_check', { ecosystem: 'PyPI', name: 'django' });
  assert.match(noVersion.content, /请再给版本号核对/); assert.equal(JSON.parse(calls[1].body).package.ecosystem, 'PyPI');
  assert.equal(r.cards[0].data.results[0].url, 'https://osv.dev/vulnerability/GHSA-xxxx');
  assert.match((await tools([[/osv/, json({})]]).t.execute('vuln_check', { ecosystem: 'npm', name: 'safe', version: '1.0.0' })).content, /没有已知漏洞记录（不代表绝对安全/);
  assert.match((await t.execute('vuln_check', { ecosystem: 'cobol', name: 'x' })).error, /请提供生态/);
});

test('stackexchange_search decodes titles, restricts sites, and attaches the accepted answer as plain text', async () => {
  const routes = [[/api\.stackexchange\.com\/2\.3\/answers\/555/, json({ items: [{ body: '<p>Use <code>Array.prototype.flat()</code>.</p><pre>a.flat(Infinity)</pre>' }] })],
    [/api\.stackexchange\.com\/2\.3\/search\/advanced/, json({ items: [{ title: 'How to flatten &amp; merge arrays?', link: 'https://stackoverflow.com/q/1', score: 40, answer_count: 5, is_answered: true, accepted_answer_id: 555, tags: ['javascript', 'arrays'] }, { title: 'Other', link: 'https://stackoverflow.com/q/2', score: 1, answer_count: 0, is_answered: false, tags: [] }] })]];
  const { t, calls } = tools(routes);
  const r = await t.execute('stackexchange_search', { query: 'flatten array', tags: 'javascript;arrays<script>', with_answer: true });
  assert.match(r.content, /How to flatten & merge arrays\?｜评分 40｜5 个回答（有已采纳）/); assert.match(r.content, /第 1 条的已采纳答案：\nUse Array\.prototype\.flat\(\)\./); assert.ok(!/<code>/.test(r.content));
  assert.match(calls[0].url, /site=stackoverflow/); assert.match(calls[0].url, /tagged=javascript%3Barrays/); assert.ok(!/%3C|<|%3E|>/i.test(calls[0].url), 'markup is stripped from tags');
  await t.execute('stackexchange_search', { query: 'x', site: 'evil.example' }); assert.match(calls.at(-1).url, /site=stackoverflow/);
  assert.match((await t.execute('stackexchange_search', { query: '' })).error, /请提供/);
});

test('hn_search covers stories, comments and the front page', async () => {
  const hits = { hits: [{ objectID: '1', title: 'Show HN: A thing', url: 'https://example.com/a', points: 120, num_comments: 30, author: 'pg', created_at: '2026-11-01T10:00:00Z' }, { objectID: '2', title: 'Ask HN', url: null, points: 5, num_comments: 1, author: 'x', created_at: '2026-11-02T10:00:00Z' }] };
  const { t, calls } = tools([[/hn\.algolia\.com\/api\/v1\/search_by_date\?tags=comment/, json({ hits: [{ objectID: '9', comment_text: '<p>I <i>agree</i></p>', author: 'c', created_at: '2026-11-03T00:00:00Z', story_title: 'Big story' }] })], [/hn\.algolia\.com\/api\/v1\/search\?tags=(story|front_page)/, json(hits)]]);
  const r = await t.execute('hn_search', { query: 'thing' });
  assert.match(r.content, /Show HN: A thing｜120 分 · 30 评论 · pg · 2026-11-01/); assert.match(r.content, /https:\/\/news\.ycombinator\.com\/item\?id=2/);
  await t.execute('hn_search', { kind: 'front_page' }); assert.ok(/tags=front_page/.test(calls.at(-1).url) && !/query=/.test(calls.at(-1).url));
  const c = await t.execute('hn_search', { query: 'agree', kind: 'comment', sort: 'date' }); assert.match(c.content, /I agree｜c · 2026-11-03 · 属于《Big story》/);
  assert.match((await t.execute('hn_search', {})).error, /请提供搜索关键词/);
});

test('wikidata_facts resolves ids to labels, formats dates by precision and skips deprecated claims', async () => {
  const claim = (pid, dv, rank) => ({ [pid]: [{ rank: rank || 'normal', mainsnak: { datavalue: dv } }] });
  const entity = { labels: { zh: { value: '艾伦·图灵' } }, descriptions: { zh: { value: '英国数学家' } }, claims: Object.assign({},
    claim('P569', { type: 'time', value: { time: '+1912-06-23T00:00:00Z', precision: 11 } }), claim('P27', { type: 'wikibase-entityid', value: { id: 'Q145' } }),
    claim('P106', { type: 'wikibase-entityid', value: { id: 'Q170790' } }), claim('P570', { type: 'time', value: { time: '+1954-06-07T00:00:00Z', precision: 11 } }, 'deprecated'), claim('P1082', { type: 'quantity', value: { amount: '+1234' } })) };
  const { t, calls } = tools([[/wbsearchentities/, json({ search: [{ id: 'Q7251' }] })], [/wbgetentities.*props=labels&/, json({ entities: { Q145: { labels: { zh: { value: '英国' } } }, Q170790: { labels: { en: { value: 'mathematician' } } } } })], [/wbgetentities.*props=labels\|descriptions\|claims/, json({ entities: { Q7251: entity } })]]);
  const r = await t.execute('wikidata_facts', { entity: '图灵' });
  assert.match(r.content, /艾伦·图灵（英国数学家） \[Q7251\]/); assert.match(r.content, /出生日期：1912-06-23/); assert.match(r.content, /国籍：英国/); assert.match(r.content, /职业：mathematician/); assert.match(r.content, /人口：1234/); assert.ok(!/逝世日期/.test(r.content));
  assert.match(calls[0].url, /language=zh/);
  const byId = await t.execute('wikidata_facts', { id: 'q7251' }); assert.equal(byId.title, '艾伦·图灵'); assert.ok(!calls.slice(-3).some(c => /wbsearchentities/.test(c.url)));
  assert.match((await tools([[/wbsearchentities/, json({ search: [] })]]).t.execute('wikidata_facts', { entity: '无此物' })).error, /没有找到/);
  assert.match((await t.execute('wikidata_facts', {})).error, /请提供/);
});

test('dictionary reads English entries, refuses Chinese or unsafe input and reports unknown words', async () => {
  const { t, calls } = tools([[/dictionaryapi\.dev\/api\/v2\/entries\/en\/serendipity$/, json([{ word: 'serendipity', phonetic: '/ˌsɛɹ.ənˈdɪp.ɪ.ti/', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'Finding something good without looking for it.', example: 'A happy serendipity.' }], synonyms: ['luck', 'chance'] }] }])]]);
  const r = await t.execute('dictionary', { word: ' Serendipity ' });
  assert.match(r.content, /serendipity \/ˌsɛɹ/); assert.match(r.content, /\[noun\] 1\. Finding something good[\s\S]*同义词：luck, chance/);
  for (const bad of ['你好', 'a/b', '../x', '']) assert.ok((await t.execute('dictionary', { word: bad })).error, bad);
  assert.equal(calls.length, 1);
  assert.match((await tools([[/dictionaryapi/, { status: 404, body: { title: 'No Definitions Found' } }]]).t.execute('dictionary', { word: 'qwxzv' })).error, /没有找到这个词条/);
});

test('rss_read parses RSS 2.0, Atom and RDF, strips HTML, refuses non-https and non-feed content', async () => {
  const rss = '<?xml version="1.0"?><rss version="2.0"><channel><title>Tech &amp; News</title><item><title>First</title><link>https://e.com/1</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;/p&gt;</description></item><item><title>Second</title><link>https://e.com/2</link></item></channel></rss>';
  const atom = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title><entry><title>Post A</title><link rel="self" href="https://b.com/feed"/><link rel="alternate" href="https://b.com/a"/><updated>2026-11-01T00:00:00Z</updated><summary>Sum A</summary></entry></feed>';
  const rdf = '<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Old</title></channel><item><title>R1</title><link>https://o.com/1</link><dc:date>2026-10-10</dc:date></item></rdf:RDF>';
  const { t } = tools([[/e\.com\/feed/, { body: rss }], [/b\.com\/feed/, { body: atom }], [/o\.com\/feed/, { body: rdf }], [/html\.com/, { body: '<html><body>hi</body></html>' }], [/down\.test/, { status: 500, body: '' }]]);
  const a = await t.execute('rss_read', { url: 'https://e.com/feed', limit: 1 });
  assert.match(a.content, /^Tech & News\n1\. First｜Mon, 02 Nov 2026 10:00:00 GMT\n   Hello world\n   https:\/\/e\.com\/1/); assert.equal(a.results_count, 1);
  assert.match((await t.execute('rss_read', { url: 'https://b.com/feed' })).content, /Post A｜2026-11-01T00:00:00Z\n   Sum A\n   https:\/\/b\.com\/a/);
  assert.match((await t.execute('rss_read', { url: 'https://o.com/feed' })).content, /R1｜2026-10-10\n   https:\/\/o\.com\/1/);
  assert.match((await t.execute('rss_read', { url: 'http://e.com/feed' })).error, /https/);
  assert.match((await t.execute('rss_read', { url: 'https://html.com/page' })).error, /没有识别出订阅源内容|不是有效/);
  assert.match((await t.execute('rss_read', { url: 'https://down.test/feed' })).error, /暂时不可用（500）/);
});

test('news_gdelt formats dates, explains rate-limit text and clamps the time span', async () => {
  const good = tools([[/api\.gdeltproject\.org\/api\/v2\/doc\/doc/, json({ articles: [{ title: 'Markets rally', url: 'https://n.com/1', domain: 'n.com', language: 'English', sourcecountry: 'US', seendate: '20261102T101500Z' }] })]]);
  const r = await good.t.execute('news_gdelt', { query: 'markets', timespan: '1w', limit: 3 });
  assert.match(r.content, /范围：最近 1w/); assert.match(r.content, /Markets rally｜n\.com · English · US · 2026-11-02/); assert.match(good.calls[0].url, /timespan=1w/); assert.match(good.calls[0].url, /maxrecords=3/);
  await good.t.execute('news_gdelt', { query: 'x y', timespan: 'forever' }); assert.match(good.calls[1].url, /timespan=3d/);
  assert.match((await tools([[/gdelt/, { body: 'Please limit requests to one every 5 seconds.' }]]).t.execute('news_gdelt', { query: 'markets' })).error, /返回了提示而不是数据：Please limit requests/);
  assert.equal((await tools([[/gdelt/, json({})]]).t.execute('news_gdelt', { query: 'markets' })).results_count, 0);
  assert.match((await good.t.execute('news_gdelt', { query: 'a' })).error, /请提供/);
});

test('wayback returns the nearest snapshot over https and refuses snapshot hosts other than the archive', async () => {
  const snap = (url) => json({ archived_snapshots: { closest: { available: true, status: '200', timestamp: '20200115093000', url } } });
  const { t, calls } = tools([[/archive\.org\/wayback\/available/, snap('http://web.archive.org/web/20200115093000/https://example.com/')]]);
  const r = await t.execute('wayback', { url: 'https://example.com/', timestamp: '2020-01-15' });
  assert.match(calls[0].url, /timestamp=20200115$/); assert.equal(r.url, 'https://web.archive.org/web/20200115093000/https://example.com/'); assert.match(r.content, /2020-01-15（HTTP 200）/);
  assert.match((await tools([[/available/, snap('https://evil.example/x')]]).t.execute('wayback', { url: 'https://example.com/' })).error, /快照地址异常/);
  assert.equal((await tools([[/available/, json({ archived_snapshots: {} })]]).t.execute('wayback', { url: 'https://example.com/' })).results_count, 0);
  assert.match((await t.execute('wayback', { url: 'ftp://x' })).error, /完整的网页地址/);
});

test('failures never throw: network errors, 429 and bad JSON become readable errors; unknown tools are refused; card links are http(s) only', async () => {
  const net = tools([[/./, new Error('socket hang up')]]);
  assert.match((await net.t.execute('wiki_summary', { query: 'x' })).error, /暂时连不上数据源（socket hang up）/);
  assert.match((await tools([[/./, { status: 429, body: {} }]]).t.execute('hn_search', { query: 'x' })).error, /限流/);
  assert.match((await tools([[/./, { body: '<html>oops</html>' }]]).t.execute('hn_search', { query: 'x' })).error, /无法识别的内容/);
  assert.match((await net.t.execute('nope', {})).error, /未知工具/);
  assert.equal(net.t.has('constructor'), false);
  const evil = tools([[/search\/issues/, json({ items: [{ title: 'T', html_url: 'javascript:alert(1)', number: 1, state: 'open', user: { login: 'u' }, comments: 0, updated_at: '', body: '' }] })]]);
  const r = await evil.t.execute('github_issues', { repo: 'a/b' });
  assert.equal(r.cards[0].data.results[0].url, '');
});

test('real-world degradations: OpenAlex refusing anonymous traffic falls back to Crossref, and a rate-limited Wikipedia summary falls back to the search excerpt', async () => {
  const crossref = [/api\.crossref\.org\/works\?/, json({ message: { items: [{ DOI: '10.2/x', title: ['Paper X'], author: [{ given: 'Ann', family: 'Lee' }], issued: { 'date-parts': [[2020]] }, 'container-title': ['J'], 'is-referenced-by-count': 3, URL: 'https://doi.org/10.2/x' }] } })];
  const limited = tools([[/api\.openalex\.org/, { status: 429, body: { error: 'Rate limit exceeded', message: 'Insufficient budget. This request has no API key' } }], crossref]);
  const r = await limited.t.execute('search_papers', { query: 'deep learning' });
  assert.match(r.content, /^数据源：crossref（OpenAlex 暂时不可用，已改用 Crossref）/); assert.match(r.content, /Paper X/); assert.equal(limited.calls.length, 2);
  // an explicit source never silently switches
  assert.match((await tools([[/api\.crossref\.org/, { status: 429, body: {} }]]).t.execute('search_papers', { query: 'x', source: 'crossref' })).error, /限流/);
  // an optional key is sent only when configured
  const keyed = tools([[/api\.openalex\.org/, json({ results: [] })]], { openalexKey: 'K123' }); await keyed.t.execute('search_papers', { query: 'x' });
  assert.match(keyed.calls[0].url, /api_key=K123/); const plain = tools([[/api\.openalex\.org/, json({ results: [] })]], { openalexKey: '' }); await plain.t.execute('search_papers', { query: 'x' });
  assert.ok(!/api_key/.test(plain.calls[0].url));

  const wiki = tools([[/rest\.php\/v1\/search\/page/, json({ pages: [{ key: '艾伦·图灵', title: '艾伦·图灵', description: '英国数学家', excerpt: '<span class="searchmatch">图灵</span>是英国&nbsp;数学家' }] })], [/rest_v1\/page\/summary/, { status: 429, body: 'too many requests' }]]);
  const w = await wiki.t.execute('wiki_summary', { query: '图灵' });
  assert.ok(!w.error, 'a refused summary must not fail the tool'); assert.match(w.content, /艾伦·图灵（英国数学家）/); assert.match(w.content, /图灵是英国 数学家/); assert.doesNotMatch(w.content, /searchmatch|<span/);
  assert.match(w.content, /来源：https:\/\/zh\.wikipedia\.org\/wiki\//);
});

test('the default transport uses the pinned, https-only fetchers with limits, and maps their responses', async () => {
  const seen = [];
  const web = {
    async fetchSafeRedirectBuffer(url, o) { seen.push(['get', url, o]); return { ok: true, status: 200, headers: { get: () => null }, buffer: Buffer.from(JSON.stringify({ pages: [{ key: 'K', title: 'T' }] })) }; },
    async assertSafeWebUrl(url) { seen.push(['assert', url]); return { parsed: new URL(url), addresses: [{ address: '203.0.113.9', family: 4 }] }; },
    async requestPinnedJson(parsed, addresses, o) { seen.push(['post', String(parsed), addresses[0].address, o.method, o.body, o.headers['Content-Type']]); return { status: 200, headers: { get: () => null }, text: JSON.stringify({ vulns: [] }) }; }
  };
  const t = createKnowledgeTools({ web, githubToken: '' });
  const wiki = await t.execute('wiki_summary', { query: 'x' });
  assert.deepEqual(seen[0].slice(0, 2), ['get', 'https://zh.wikipedia.org/w/rest.php/v1/search/page?q=x&limit=4']);
  assert.equal(seen[0][2].maxRedirects, 2); assert.equal(seen[0][2].timeoutMs, 12000); assert.equal(seen[0][2].maxBytes, 2 * 1024 * 1024); assert.match(seen[0][2].headers['User-Agent'], /^XTJ-CatAI\/1\.0/);
  assert.ok(!/@/.test(seen[0][2].headers['User-Agent']), 'no e-mail address is sent to third parties');
  assert.ok(wiki.content || wiki.error);
  const vuln = await t.execute('vuln_check', { ecosystem: 'npm', name: 'safe', version: '1.0.0' });
  assert.match(vuln.content, /没有已知漏洞记录/);
  const post = seen.find(x => x[0] === 'post'); assert.equal(post[1], 'https://api.osv.dev/v1/query'); assert.equal(post[2], '203.0.113.9'); assert.equal(post[3], 'POST'); assert.equal(post[5], 'application/json'); assert.deepEqual(JSON.parse(post[4]).package, { name: 'safe', ecosystem: 'npm' });
  assert.ok(seen.some(x => x[0] === 'assert' && x[1] === 'https://api.osv.dev/v1/query'), 'the POST target is validated before connecting');
});
