'use strict';

/**
 * SSRF-safe HTTPS page fetch + readable text extraction for Cat AI tools.
 * Ported from code-agent patterns (DNS pin, private IP block, size/time limits).
 */

var dns = require('dns');
var https = require('https');
var net = require('net');

var WEB_MAX_BYTES = 1.5 * 1024 * 1024;
var WEB_TIMEOUT_MS = 12000;
var WEB_MAX_REDIRECTS = 3;
var WEB_TEXT_MAX = 24000;

/**
 * Promise-based DNS lookup. Node's dns.lookup REQUIRES a callback and does NOT
 * return a Promise when omitted (throws ERR_INVALID_ARG_TYPE) — so await dns.lookup
 * silently breaks every web tool. Always use dns.promises (or an injected impl).
 */
function defaultDnsLookup(hostname, options) {
  return dns.promises.lookup(hostname, options || { all: true, verbatim: true });
}

function isPrivateAddress(address) {
  var value = String(address || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(value) === 4) {
    var octets = value.split('.').map(Number);
    var first = octets[0];
    return first === 0 || first === 10 || first === 127 || first >= 224 ||
      (first === 100 && octets[1] >= 64 && octets[1] <= 127) ||
      (first === 169 && octets[1] === 254) ||
      (first === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (first === 192 && (octets[1] === 168 || (octets[1] === 0 && octets[2] === 0) || (octets[1] === 0 && octets[2] === 2))) ||
      (first === 198 && (octets[1] === 18 || octets[1] === 19 || octets[1] === 51)) ||
      (first === 203 && octets[1] === 0 && octets[2] === 113);
  }
  if (net.isIP(value) === 6) {
    if (value.indexOf('::ffff:') === 0) {
      var mappedV4 = value.slice(7);
      if (net.isIP(mappedV4) === 4) return isPrivateAddress(mappedV4);
    }
    // 审计 🟡：补齐 6to4(2002::/16，可内嵌任意 IPv4)、Teredo(2001::/32)、
    // 文档段(2001:db8::/32)、NAT64(64:ff9b::/96) 与组播(ff00::/8)
    return value === '::' || value === '::1' ||
      value.indexOf('fc') === 0 || value.indexOf('fd') === 0 ||
      /^(fe[89ab]):/i.test(value) ||
      /^64:ff9b:/.test(value) ||
      /^2002:/.test(value) ||
      /^2001:0:/i.test(value) ||
      /^2001:db8:/.test(value) ||
      /^ff00:/i.test(value);
  }
  return false;
}

function isBlockedWebHost(hostname) {
  var host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    host === 'metadata.google.internal' || host === 'metadata' || host.endsWith('.internal') ||
    isPrivateAddress(host);
}

async function assertSafeWebUrl(rawUrl, lookupImpl) {
  var parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch (_) {
    throw new Error('网址格式无效');
  }
  if (parsed.protocol !== 'https:') throw new Error('仅支持 HTTPS 链接');
  if (parsed.port && parsed.port !== '443') throw new Error('仅支持标准 443 端口');
  if (parsed.username || parsed.password) throw new Error('网址不允许包含凭据');
  if (isBlockedWebHost(parsed.hostname)) throw new Error('网址主机不在允许范围内');

  var lookup = lookupImpl || defaultDnsLookup;
  var addresses = null;
  var lastLookupError = null;
  // Free-tier cold starts / transient resolver blips: retry DNS a couple times.
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
      lastLookupError = null;
      break;
    } catch (err) {
      lastLookupError = err;
      addresses = null;
      if (attempt < 2) {
        await new Promise(function(resolve) { setTimeout(resolve, 180 * (attempt + 1)); });
      }
    }
  }
  if (lastLookupError || !Array.isArray(addresses) || !addresses.length) {
    throw new Error('无法解析网页主机');
  }
  if (addresses.some(function(item) { return isPrivateAddress(item && item.address); })) {
    throw new Error('网页主机解析到禁止访问的内网地址');
  }
  return {
    parsed: parsed,
    addresses: addresses.map(function(item) { return item.address; })
  };
}

function requestPinnedHttps(parsed, addresses, maxBytes, timeoutMs, headers, externalSignal) {
  return new Promise(function(resolve, reject) {
    var chunks = [];
    var total = 0;
    var settled = false;
    function onExternalAbort() {
      if (!settled) {
        settled = true;
        try { request.destroy(new Error('请求已取消')); } catch (_) {}
        // abort 路径同样拆除监听，避免泄漏
        try {
          if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
        } catch (_) {}
        reject(new Error('请求已取消'));
      }
    }
    if (externalSignal) {
      if (externalSignal.aborted) {
        return reject(new Error('请求已取消'));
      }
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    var request = https.request({
      protocol: 'https:',
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      servername: parsed.hostname,
      rejectUnauthorized: true,
      headers: Object.assign({
        Host: parsed.host,
        'User-Agent': 'XTJ-CatAI-Reader/1.0 (+https://xtj)',
        Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5'
      }, headers || {}),
      lookup: function(_hostname, _options, callback) {
        callback(null, addresses[0], net.isIP(addresses[0]) || 4);
      }
    }, function(response) {
      var declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        settled = true;
        request.destroy();
        cleanupExternalAbort();
        reject(new Error('网页内容超过大小限制'));
        return;
      }
      response.on('data', function(chunk) {
        total += chunk.length;
        if (total > maxBytes) {
          request.destroy();
          if (!settled) {
            settled = true;
            cleanupExternalAbort();
            reject(new Error('网页内容超过大小限制'));
          }
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', function() {
        if (settled) return;
        settled = true;
        cleanupExternalAbort();
        var body = Buffer.concat(chunks, total);
        resolve({
          status: response.statusCode || 0,
          ok: (response.statusCode || 0) >= 200 && (response.statusCode || 0) < 300,
          headers: {
            get: function(key) {
              return response.headers[String(key).toLowerCase()] || null;
            }
          },
          body: body
        });
      });
      response.on('error', function(err) {
        if (!settled) {
          settled = true;
          cleanupExternalAbort();
          reject(err);
        }
      });
    });
    request.setTimeout(timeoutMs, function() {
      request.destroy(new Error('网页请求超时'));
    });
    request.on('error', function(err) {
      if (!settled) {
        settled = true;
        cleanupExternalAbort();
        reject(err);
      }
    });
    // 仅在请求真正结束（settled）后移除 abort 监听；
    // 此前错误地在 end() 后 microtask 立即 cleanup，导致用户取消无效。
    function cleanupExternalAbort() {
      if (externalSignal) {
        try { externalSignal.removeEventListener('abort', onExternalAbort); } catch (_) {}
      }
    }
    request.end();
  });
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, function(_, hex) {
      try { return String.fromCodePoint(parseInt(hex, 16)); } catch (e) { return ''; }
    })
    .replace(/&#(\d+);/g, function(_, num) {
      try { return String.fromCodePoint(parseInt(num, 10)); } catch (e) { return ''; }
    });
}

function extractTitle(html) {
  var m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) {
    var og = String(html || '').match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || String(html || '').match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (og) return decodeHtmlEntities(og[1]).replace(/\s+/g, ' ').trim().slice(0, 200);
    return '';
  }
  return decodeHtmlEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 200);
}

function normalizeWebText(buffer, contentType) {
  var raw = buffer.toString('utf8');
  var title = '';
  var text = raw;
  if (/html/i.test(contentType || '') || /<\s*html[\s>]/i.test(raw.slice(0, 2000))) {
    title = extractTitle(raw);
    text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    text = decodeHtmlEntities(text);
  }
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  var truncated = text.length > WEB_TEXT_MAX;
  if (truncated) text = text.slice(0, WEB_TEXT_MAX);
  return { title: title, text: text, truncated: truncated };
}

/**
 * Fetch one HTTPS page and return readable text.
 * @returns {{ ok: boolean, url: string, title: string, content: string, content_type: string, bytes: number, truncated: boolean, status: number }}
 */
async function fetchSafeWebPage(rawUrl, options) {
  options = options || {};
  var lookupImpl = options.lookupImpl || defaultDnsLookup;
  var maxBytes = options.maxBytes || WEB_MAX_BYTES;
  var timeoutMs = options.timeoutMs || WEB_TIMEOUT_MS;
  var externalSignal = options.signal || null;
  var current = String(rawUrl || '').trim();

  for (var redirect = 0; redirect <= WEB_MAX_REDIRECTS; redirect++) {
    var safeTarget = await assertSafeWebUrl(current, lookupImpl);
    var parsed = safeTarget.parsed;
    var response;
    try {
      response = await requestPinnedHttps(
        parsed,
        safeTarget.addresses,
        maxBytes,
        timeoutMs,
        options.headers || {},
        externalSignal
      );
    } catch (err) {
      throw new Error((err && err.message) || '网页请求失败');
    }

    if (response && response.status >= 300 && response.status < 400) {
      if (redirect === WEB_MAX_REDIRECTS) throw new Error('网页重定向次数过多');
      var location = response.headers && response.headers.get ? response.headers.get('location') : '';
      if (!location) throw new Error('网页重定向缺少目标');
      current = new URL(location, parsed).toString();
      continue;
    }

    if (!response || !response.ok) {
      throw new Error('网页返回 HTTP ' + (response && response.status || 0));
    }

    var contentType = response.headers && response.headers.get
      ? (response.headers.get('content-type') || '')
      : '';
    var normalized = normalizeWebText(response.body, contentType);
    var content = normalized.text || '';
    var title = normalized.title || '';
    var usedFallback = false;

    // SPA / 壳页面常几乎无正文：用 Jina Reader 公共代理再抽一次（仍走 SSRF 校验）
    if (content.replace(/\s+/g, '').length < 120 && options.allowJinaFallback !== false) {
      try {
        var jina = await fetchViaJinaReader(parsed.toString(), {
          lookupImpl: lookupImpl,
          maxBytes: Math.min(maxBytes, 900 * 1024),
          timeoutMs: Math.min(timeoutMs, 14000)
        });
        if (jina && jina.content && jina.content.replace(/\s+/g, '').length > content.replace(/\s+/g, '').length) {
          content = jina.content;
          if (jina.title) title = jina.title;
          usedFallback = true;
        }
      } catch (_) { /* keep direct extract */ }
    }

    if (!content) throw new Error('未能从页面提取可读文本');

    return {
      ok: true,
      url: parsed.toString(),
      title: title || '',
      content: content,
      content_type: contentType.split(';')[0] || 'text/html',
      bytes: response.body.length,
      truncated: normalized.truncated || response.body.length >= maxBytes,
      status: response.status,
      via_jina: usedFallback
    };
  }
  throw new Error('网页重定向失败');
}

/**
 * Jina Reader: https://r.jina.ai/<url>
 * 用于 SPA 空壳页的可读正文兜底。目标仍是公网 HTTPS，DNS pin 到 jina 主机。
 */
async function fetchViaJinaReader(targetUrl, options) {
  options = options || {};
  var jinaUrl = 'https://r.jina.ai/' + String(targetUrl || '').replace(/^https?:\/\//i, 'https://');
  var safe = await assertSafeWebUrl(jinaUrl, options.lookupImpl);
  // jina 主机本身不能是内网；assertSafeWebUrl 已保证
  var response = await requestPinnedHttps(
    safe.parsed,
    safe.addresses,
    options.maxBytes || WEB_MAX_BYTES,
    options.timeoutMs || WEB_TIMEOUT_MS,
    {
      Accept: 'text/plain,text/markdown,text/html;q=0.8,*/*;q=0.5',
      'X-Return-Format': 'markdown'
    }
  );
  if (!response || !response.ok) throw new Error('Jina 阅读失败 HTTP ' + (response && response.status || 0));
  var raw = response.body.toString('utf8');
  var title = '';
  var tm = raw.match(/^Title:\s*(.+)$/im) || raw.match(/^#\s+(.+)$/m);
  if (tm) title = tm[1].trim().slice(0, 200);
  var text = raw
    .replace(/^URL Source:.*$/gim, '')
    .replace(/^Markdown Content:\s*/im, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, WEB_TEXT_MAX);
  // 保留段落感
  text = raw
    .replace(/^URL Source:.*$/gim, '')
    .replace(/^Title:.*$/gim, '')
    .replace(/^Markdown Content:\s*/im, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, WEB_TEXT_MAX);
  return { title: title, content: text, bytes: response.body.length };
}

module.exports = {
  fetchSafeWebPage: fetchSafeWebPage,
  fetchViaJinaReader: fetchViaJinaReader,
  isPrivateAddress: isPrivateAddress,
  isBlockedWebHost: isBlockedWebHost,
  assertSafeWebUrl: assertSafeWebUrl,
  defaultDnsLookup: defaultDnsLookup
};
