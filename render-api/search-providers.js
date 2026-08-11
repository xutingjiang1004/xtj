/**
 * Web search provider chain + query helpers.
 * Priority: Tavily > Brave > Serper > Custom API > Bing HTML > SearXNG
 */
'use strict';

// 审计 🟡：SEARCH_API_URL 是用户请求触发的服务端出站请求目标，复用 web-fetch 的
// assertSafeWebUrl（协议 + DNS 解析 + 私有地址校验），与全站 SSRF 防护标准一致。
const { assertSafeWebUrl } = require('./web-fetch');

function buildSearchQuery(message) {
  var q = String(message || '').trim();
  var hasTimeWord = /今天|现在|当前|实时|最新/i.test(q);
  var hasNewest = /最新/i.test(q);
  // 不再删除时效词 — 保留原样获得更精准的搜索
  var cleaned = q.slice(0, 120);
  // 包含时效词的问题：追加当前中文日期, 让搜索更精准
  // ★ U3: 避免重复追加 (如"最新的XX"已经有"最新", 不再追加)
  if (hasTimeWord) {
    var now = new Date();
    var dateStr = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日';
    cleaned = cleaned + ' ' + dateStr;
    if (!hasNewest) cleaned = cleaned + ' 最新';
  }
  if (/新闻|资讯|报道|快讯/i.test(q)) {
    return (cleaned + ' 新闻').slice(0, 120);
  }
  if (/价格|多少钱|售价/i.test(q)) {
    return (cleaned + ' 价格').slice(0, 120);
  }
  if (/天气|温度|下雨|降雨/i.test(q)) {
    return ''; // 天气不走搜索
  }
  return cleaned.slice(0, 120);
}

function cleanSearchResults(results, maxCount) {
  maxCount = maxCount || 25;
  if (!Array.isArray(results)) return [];
  var out = [];
  var seenUrl = {};
  var seenTitle = {};
  // ★ U3: URL 协议白名单, 防止 javascript:/data:text/html 等危险协议
  var ALLOWED_URL_PROTOCOLS = ['http:', 'https:'];
  function isUrlSafe(url) {
    if (!url) return false;
    var lower = url.toLowerCase().trim();
    // 提取协议部分
    var colonIdx = lower.indexOf(':');
    if (colonIdx < 0) return true; // 相对路径
    var proto = lower.slice(0, colonIdx + 1);
    for (var i = 0; i < ALLOWED_URL_PROTOCOLS.length; i++) {
      // 审计 ⚪：协议后必须紧跟 //，拒绝 http:evil.com 这类"伪协议"写法
      if (proto === ALLOWED_URL_PROTOCOLS[i] && lower.slice(colonIdx + 1).indexOf('//') === 0) return true;
    }
    return false;
  }
  results.forEach(function(r) {
    if (!r) return;
    var u = (r.url || '').trim();
    var t = (r.title || '').trim();
    var s = (r.snippet || '').trim();
    // ★ U3: 过滤危险协议 URL
    if (u && !isUrlSafe(u)) return;
    // 跳过完全没有内容的结果
    if (!u && !t && !s) return;
    // URL 去重
    if (u && seenUrl[u]) return;
    if (u) seenUrl[u] = true;
    // 标题模糊去重：取标题前 10 个字作为指纹
    var titleKey = t.replace(/[\s\-—·•·,，。！？、；：""''（）()\[\]【】《》<>]/g, '').slice(0, 10);
    if (titleKey && seenTitle[titleKey]) return;
    if (titleKey) seenTitle[titleKey] = true;
    // 标题兜底
    if (!t) t = (s || u || '').slice(0, 40);
    // 评分：有摘要的优先，有来源的优先，标题更完整的优先
    var score = 0;
    if (s.length > 20) score += 3;
    else if (s.length > 0) score += 1;
    if (r.source && r.source !== 'web') score += 1;
    if (t.length > 8) score += 1;
    if (u) score += 1;
    out.push({ url: u, title: t, snippet: s, source: (r.source || 'web'), published_at: r.published_at || '', _score: score });
  });
  // 按评分降序排列，高分优先
  out.sort(function(a, b) { return (b._score || 0) - (a._score || 0); });
  // 去掉 _score 字段再返回
  return out.slice(0, maxCount).map(function(item) {
    return { url: item.url, title: item.title, snippet: item.snippet, source: item.source, published_at: item.published_at };
  });
}

// Web Search 配置
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;   // 有结果缓存 5 分钟
const SEARCH_EMPTY_CACHE_TTL_MS = 30 * 1000;  // 无结果缓存 30 秒
const searchCache = new Map();
const SEARCH_CACHE_MAX_SIZE = 1000;
function limitSearchCacheSize() {
  if (searchCache.size <= SEARCH_CACHE_MAX_SIZE) return;
  var overflow = searchCache.size - SEARCH_CACHE_MAX_SIZE;
  var keys = Array.from(searchCache.keys());
  for (var i = 0; i < overflow && i < keys.length; i++) searchCache.delete(keys[i]);
}
// 每 10 分钟清理过期搜索缓存
setInterval(function() {
  var now = Date.now();
  searchCache.forEach(function(val, key) {
    if (val.expiresAt && now > val.expiresAt) searchCache.delete(key);
  });
  limitSearchCacheSize();
}, 10 * 60 * 1000);

// ===================== 搜索 Provider 架构 =====================
// 每个 provider 返回 { results: [...], error: string|null }
// results 每条为 { title, url, snippet, source, published_at }

// Provider 1: Tavily API
async function searchTavily(query, maxResults, extraOpts) {
  var apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return { results: [], error: null }; // 未配置，跳过
  try {
    extraOpts = extraOpts || {};
    var tavilyBody = {
      api_key: apiKey,
      query: query,
      max_results: Math.min(maxResults || 5, 20),
      search_depth: extraOpts.search_depth === 'advanced' ? 'advanced' : 'basic',
      include_answer: !!extraOpts.include_answer
    };
    if (extraOpts.time_range) tavilyBody.time_range = extraOpts.time_range;
    if (extraOpts.topic === 'news') tavilyBody.topic = 'news';
    var resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tavilyBody),
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) {
      var errBody = await resp.text().catch(function() { return ''; });
      return { results: [], error: 'Tavily status=' + resp.status + ' ' + errBody.slice(0, 100) };
    }
    var data = await resp.json();
    var raw = data && data.results;
    if (!Array.isArray(raw) || !raw.length) return { results: [], error: 'Tavily returned 0 results' };
    var results = raw.map(function(r) {
      return {
        title: String(r.title || '').trim().slice(0, 200),
        url: String(r.url || '').trim(),
        snippet: String(r.content || r.snippet || '').trim().slice(0, 500),
        source: r.source || 'tavily',
        published_at: r.published_date || ''
      };
    }).filter(function(r) { return r.title && r.url; });
    return { results: results.slice(0, maxResults || 5), error: null };
  } catch (e) {
    return { results: [], error: 'Tavily error: ' + (e.message || 'unknown') };
  }
}


// Provider 2: Brave Search API
async function searchBrave(query, maxResults) {
  var apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return { results: [], error: null };
  try {
    var resp = await fetch('https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(query) + '&count=' + (maxResults || 5), {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) return { results: [], error: 'Brave status=' + resp.status };
    var data = await resp.json();
    var web = data && data.web;
    var raw = web && web.results;
    if (!Array.isArray(raw) || !raw.length) return { results: [], error: 'Brave returned 0 results' };
    var results = raw.map(function(r) {
      return {
        title: String(r.title || '').trim().slice(0, 200),
        url: String(r.url || '').trim(),
        snippet: String(r.description || '').trim().slice(0, 500),
        source: r.source || 'brave',
        published_at: r.age || r.published_date || r.pub_date || ''
      };
    }).filter(function(r) { return r.title && r.url; });
    return { results: results.slice(0, maxResults || 5), error: null };
  } catch (e) {
    return { results: [], error: 'Brave error: ' + (e.message || 'unknown') };
  }
}

// Provider 3: Serper / Google Search API
async function searchSerper(query, maxResults) {
  var apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return { results: [], error: null };
  try {
    var resp = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify({ q: query, num: Math.min(maxResults || 5, 20) }),
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) return { results: [], error: 'Serper status=' + resp.status };
    var data = await resp.json();
    var raw = data && data.organic;
    if (!Array.isArray(raw) || !raw.length) return { results: [], error: 'Serper returned 0 results' };
    var results = raw.map(function(r) {
      return {
        title: String(r.title || '').trim().slice(0, 200),
        url: String(r.link || '').trim(),
        snippet: String(r.snippet || '').trim().slice(0, 500),
        source: r.source || 'serper',
        published_at: r.date || r.publicationDate || ''
      };
    }).filter(function(r) { return r.title && r.url; });
    return { results: results.slice(0, maxResults || 5), error: null };
  } catch (e) {
    return { results: [], error: 'Serper error: ' + (e.message || 'unknown') };
  }
}

// Provider 4: 自定义 SEARCH_API_URL（兼容 SearXNG 格式）
async function searchCustomApi(query, maxResults) {
  var apiUrl = process.env.SEARCH_API_URL;
  if (!apiUrl) return { results: [], error: null };
  try {
    var parsedUrl = new URL(apiUrl);
    if (parsedUrl.protocol !== 'https:') return { results: [], error: 'CustomApi must use https' };
    // 审计 🟡：复用 assertSafeWebUrl（DNS 解析 + 私有/内网地址校验），
    // 替代仅靠 hostname 字符集正则的校验——原实现允许 10.0.0.5 / intranet-host 直连内网
    try { await assertSafeWebUrl(apiUrl); }
    catch (_) { return { results: [], error: 'CustomApi invalid host' }; }
    apiUrl = apiUrl.replace(/\/+$/, '');
    var url = apiUrl + '/search?q=' + encodeURIComponent(query) + '&format=json&language=zh-CN&safesearch=1&pageno=1&categories=general';
    var resp = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) return { results: [], error: 'CustomApi status=' + resp.status };
    var data = await resp.json();
    var raw = data && data.results;
    if (!Array.isArray(raw) || !raw.length) return { results: [], error: 'CustomApi returned 0 results' };
    var results = raw.map(function(r) {
      return {
        title: String(r.title || '').trim().slice(0, 200),
        url: String(r.url || '').trim(),
        snippet: String(r.content || r.snippet || '').trim().slice(0, 500),
        source: r.engine || 'custom',
        published_at: r.publishedDate || ''
      };
    }).filter(function(r) { return r.title && r.url; });
    return { results: results.slice(0, maxResults || 5), error: null };
  } catch (e) {
    return { results: [], error: 'CustomApi error: ' + (e.message || 'unknown') };
  }
}

// Provider 5: SearXNG 公共实例
async function searchSearxng(query, maxResults) {
  var instances = [
    'https://searx.work', 'https://search.leptons.xyz', 'https://searx.si',
    'https://search.sapti.me', 'https://searx.be', 'https://search.projectsegfau.lt',
    'https://searx.raghav.site', 'https://searx.frankfurt.systems',
    'https://searx.foss.family', 'https://searx.tuxcloud.net'
  ];
  if (process.env.SEARCH_API_URL) {
    try {
      var parsedUrl = new URL(process.env.SEARCH_API_URL);
      if (parsedUrl.protocol !== 'https:') throw new Error('must be https');
      // 审计 🟡：复用 assertSafeWebUrl（DNS + 私有地址校验），拒绝指向内网的实例
      await assertSafeWebUrl(process.env.SEARCH_API_URL);
      var customUrl = process.env.SEARCH_API_URL.replace(/\/+$/, '');
      if (instances.indexOf(customUrl) < 0) instances.unshift(customUrl);
    } catch (e) {
      console.warn('[SEARCH] invalid SEARCH_API_URL, ignored:', e.message);
    }
  }
  var category = /新闻|资讯|报道|快讯|新闻|头条/i.test(query) ? 'news' : 'general';
  var fetchers = instances.map(function(baseUrl) {
    var url = baseUrl + '/search?q=' + encodeURIComponent(query) + '&format=json&language=zh-CN&safesearch=1&categories=' + category + '&pageno=1';
    return fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15000)
    }).then(function(r) {
      if (!r.ok) throw new Error(baseUrl.slice(0, 30) + ' status=' + r.status);
      return r.json();
    }).then(function(data) {
      var raw = data && data.results;
      if (!Array.isArray(raw) || !raw.length) throw new Error(baseUrl.slice(0, 30) + ' no results');
      return raw.map(function(item) {
        return {
          title: String(item.title || '').trim().slice(0, 200),
          url: String(item.url || '').trim(),
          snippet: String(item.content || item.snippet || '').trim().slice(0, 500),
          source: item.engine || 'searxng',
          published_at: item.publishedDate || ''
        };
      }).filter(function(r) { return r.title && r.url; });
    }).catch(function(e) {
      throw new Error(e.message || 'unknown error');
    });
  });
  try {
    var winner = await Promise.any(fetchers);
    return { results: (winner || []).slice(0, maxResults || 5), error: null };
  } catch (e) {
    return { results: [], error: 'SearXNG error: all instances failed' };
  }
}

// Provider 6: Bing HTML 解析（最后兜底）
async function searchBingHtml(query, maxResults) {
  try {
    var url = 'https://www.bing.com/search?q=' + encodeURIComponent(query) + '&count=' + (maxResults || 5) + '&mkt=zh-CN';
    var resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml'
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) return { results: [], error: 'BingHtml status=' + resp.status };
    var html = await resp.text();
    var items = [];
    var pos = 0;
    while (true) {
      var start = html.indexOf('b_algo', pos);
      if (start < 0) break;
      var liStart = html.lastIndexOf('<li', start);
      if (liStart < 0) { pos = start + 1; continue; }
      var liEnd = html.indexOf('</li>', liStart);
      if (liEnd < 0) { pos = start + 1; continue; }
      var block = html.slice(liStart, liEnd + 5);
      var aHref = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>/i);
      var title = aHref ? aHref[2].replace(/<[^>]+>/g, '').trim() : '';
      var urlVal = aHref ? aHref[1] : '';
      var pMatch = block.match(/<p[^>]*>(.*?)<\/p>/i);
      var snippet = pMatch ? pMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      if (title && urlVal) items.push({ title: title, url: urlVal, snippet: snippet, source: 'bing', published_at: '' });
      pos = liEnd + 5;
    }
    return { results: items.slice(0, maxResults || 5), error: null };
  } catch (e) {
    return { results: [], error: 'BingHtml error: ' + (e.message || 'unknown') };
  }
}

// 主搜索函数：按优先级依次尝试 Provider，取第一个成功的结果（避免浪费 API 配额）
// M-6: 给单个搜索 provider 套超时（Promise.race），防止无自带超时的 provider
// 挂起永久卡住整个串行搜索链并泄漏整体定时器
function withSearchProviderTimeout(providerFn, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() {
      var error = new Error('search provider timed out');
      error.code = 'SEARCH_PROVIDER_TIMEOUT';
      reject(error);
    }, timeoutMs);
    Promise.resolve(providerFn()).then(function(value) {
      clearTimeout(timer);
      resolve(value);
    }, function(error) {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function searchWeb(query, maxResults) {
  maxResults = maxResults || 5;
  var searchQuery = buildSearchQuery(query);
  if (!searchQuery) searchQuery = String(query || '').trim().slice(0, 120);
  var cacheKey = searchQuery.toLowerCase().trim().slice(0, 100);
  var cached = searchCache.get(cacheKey);
  if (cached && cached.results) {
    var cachedResults = cached.results.results || [];
    var cacheTtl = cachedResults.length > 0 ? SEARCH_CACHE_TTL_MS : SEARCH_EMPTY_CACHE_TTL_MS;
    if ((Date.now() - cached.ts) < cacheTtl) return cached.results;
    searchCache.delete(cacheKey);
  }

  // 缓存大小限制（最多 500 条，超出删最旧的）
  if (searchCache.size >= 500) {
    var oldKey = searchCache.keys().next().value;
    if (oldKey) searchCache.delete(oldKey);
  }

  // 按优先级定义 provider 列表（串行：前面的成功就不走后面的，省 API 配额）
  var providerList = [
    { name: 'Tavily', fn: function() { return searchTavily(searchQuery, maxResults); }, requiresEnv: 'TAVILY_API_KEY', enabled: !!process.env.TAVILY_API_KEY },
    { name: 'Brave', fn: function() { return searchBrave(searchQuery, maxResults); }, requiresEnv: 'BRAVE_SEARCH_API_KEY', enabled: !!process.env.BRAVE_SEARCH_API_KEY },
    { name: 'Serper', fn: function() { return searchSerper(searchQuery, maxResults); }, requiresEnv: 'SERPER_API_KEY', enabled: !!process.env.SERPER_API_KEY },
    { name: 'CustomApi', fn: function() { return searchCustomApi(searchQuery, maxResults); }, requiresEnv: 'SEARCH_API_URL', enabled: !!process.env.SEARCH_API_URL },
    { name: 'BingHtml', fn: function() { return searchBingHtml(searchQuery, maxResults); }, requiresEnv: null, enabled: true },
    { name: 'SearXNG', fn: function() { return searchSearxng(searchQuery, maxResults); }, requiresEnv: null, enabled: true }
  ];

  var diagnostics = {
    query: searchQuery,
    enabled_providers: [],
    missing_env: [],
    provider_results: [],
    provider_errors: []
  };

  var mergedResults = [];
  var usedProvider = null;

  // 整体搜索总超时 25 秒
  var searchTimedOut = false;
  var searchTimer = setTimeout(function() { searchTimedOut = true; }, 25000);

  for (var pi = 0; pi < providerList.length; pi++) {
    if (searchTimedOut) break;
    var provider = providerList[pi];
    if (!provider.enabled) {
      diagnostics.missing_env.push(provider.requiresEnv);
      continue;
    }
    diagnostics.enabled_providers.push(provider.name);
    try {
      // M-6: 每个 provider 单独套 12s 超时——整体 25s 定时器只在循环间检查，
      // 单个无自带超时的 provider 挂起会永久卡住 await 且泄漏 25s 定时器
      var result = await withSearchProviderTimeout(provider.fn, 12000);
      if (result.error) {
        diagnostics.provider_errors.push({ provider: provider.name, error: result.error });
      } else if (result.results && result.results.length > 0) {
        diagnostics.provider_results.push({ provider: provider.name, count: result.results.length });
        // 取第一个有结果的 provider
        mergedResults = result.results;
        usedProvider = provider.name;
        break;
      } else {
        diagnostics.provider_results.push({ provider: provider.name, count: 0 });
      }
    } catch (e) {
      diagnostics.provider_errors.push({ provider: provider.name, error: e.message || 'unknown' });
    }
  }

  var finalResult = {
    results: mergedResults,
    diagnostics: diagnostics,
    used_provider: usedProvider
  };

  var cacheTtl = mergedResults.length > 0 ? SEARCH_CACHE_TTL_MS : SEARCH_EMPTY_CACHE_TTL_MS;
  searchCache.set(cacheKey, { ts: Date.now(), results: finalResult, expiresAt: Date.now() + cacheTtl });
  limitSearchCacheSize();
  clearTimeout(searchTimer);

  if (searchTimedOut && mergedResults.length === 0) {
    console.warn('[SEARCH] total search timeout (25s) for:', searchQuery);
  }

  return finalResult;
}

module.exports = {
  searchWeb: searchWeb,
  searchTavily: searchTavily,
  searchBrave: searchBrave,
  searchSerper: searchSerper,
  searchCustomApi: searchCustomApi,
  searchSearxng: searchSearxng,
  searchBingHtml: searchBingHtml,
  buildSearchQuery: buildSearchQuery,
  cleanSearchResults: cleanSearchResults,
  withSearchProviderTimeout: withSearchProviderTimeout,
  // for health diagnostics / tests
  _searchCache: typeof searchCache !== "undefined" ? searchCache : null
};
