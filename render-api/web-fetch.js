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
    return value === '::' || value === '::1' || value.indexOf('fc') === 0 || value.indexOf('fd') === 0 ||
      /^(fe[89ab]):/i.test(value);
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

  var lookup = lookupImpl || dns.lookup;
  var addresses;
  try {
    addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
  } catch (_) {
    throw new Error('无法解析网页主机');
  }
  if (!Array.isArray(addresses) || !addresses.length ||
      addresses.some(function(item) { return isPrivateAddress(item && item.address); })) {
    throw new Error('网页主机解析到禁止访问的内网地址');
  }
  return {
    parsed: parsed,
    addresses: addresses.map(function(item) { return item.address; })
  };
}

function requestPinnedHttps(parsed, addresses, maxBytes, timeoutMs, headers) {
  return new Promise(function(resolve, reject) {
    var chunks = [];
    var total = 0;
    var settled = false;
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
        reject(new Error('网页内容超过大小限制'));
        return;
      }
      response.on('data', function(chunk) {
        total += chunk.length;
        if (total > maxBytes) {
          request.destroy();
          if (!settled) {
            settled = true;
            reject(new Error('网页内容超过大小限制'));
          }
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', function() {
        if (settled) return;
        settled = true;
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
        reject(err);
      }
    });
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
  var lookupImpl = options.lookupImpl || dns.lookup;
  var maxBytes = options.maxBytes || WEB_MAX_BYTES;
  var timeoutMs = options.timeoutMs || WEB_TIMEOUT_MS;
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
        options.headers || {}
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
    if (!normalized.text) throw new Error('未能从页面提取可读文本');

    return {
      ok: true,
      url: parsed.toString(),
      title: normalized.title || '',
      content: normalized.text,
      content_type: contentType.split(';')[0] || 'text/html',
      bytes: response.body.length,
      truncated: normalized.truncated || response.body.length >= maxBytes,
      status: response.status
    };
  }
  throw new Error('网页重定向失败');
}

module.exports = {
  fetchSafeWebPage: fetchSafeWebPage,
  isPrivateAddress: isPrivateAddress,
  isBlockedWebHost: isBlockedWebHost,
  assertSafeWebUrl: assertSafeWebUrl
};
