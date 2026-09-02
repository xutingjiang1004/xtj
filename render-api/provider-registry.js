'use strict';

// ===================== Provider Registry =====================
// API Key / Provider Registry system for user model configuration,
// encrypted API key storage, and provider management.
//
// ── Supabase Schema ──────────────────────────────────────────────────────
//
// -- provider_registry: 存储已配置的 AI 提供商
// CREATE TABLE provider_registry (
//   id            BIGSERIAL PRIMARY KEY,
//   name          TEXT NOT NULL UNIQUE,          -- 用户自定义名称（如 "我的 DeepSeek"）
//   provider_type TEXT NOT NULL CHECK (provider_type IN ('openai','deepseek','anthropic','custom')),
//   api_key_encrypted TEXT NOT NULL,             -- AES-256-GCM 加密后的 API Key
//   api_key_iv       TEXT NOT NULL,              -- 加密使用的 IV (base64)
//   api_key_tag      TEXT NOT NULL,              -- GCM 认证标签 (base64)
//   key_version      TEXT NOT NULL DEFAULT 'v1', -- 加密密钥版本（v1 = sha256(ENCRYPTION_KEY)）
//   base_url      TEXT,                           -- 自定义 API 端点（可选）
//   models_config JSONB DEFAULT '[]'::jsonb,     -- 可用模型列表
//   capabilities  JSONB DEFAULT '[]'::jsonb,     -- 能力标签字符串数组（如 ["chat","thinking","tools"]）
//   enabled       BOOLEAN DEFAULT true,
//   created_at    TIMESTAMPTZ DEFAULT now(),
//   updated_at    TIMESTAMPTZ DEFAULT now()
// );
//
// -- user_model_preferences: 用户级别的模型偏好
// CREATE TABLE user_model_preferences (
//   id                BIGSERIAL PRIMARY KEY,
//   user_id           TEXT NOT NULL REFERENCES users(user_name) ON DELETE CASCADE,
//   provider_id       BIGINT NOT NULL REFERENCES provider_registry(id) ON DELETE CASCADE,
//   model_id          TEXT NOT NULL,
//   custom_parameters JSONB DEFAULT '{}'::jsonb, -- 自定义参数（如 temperature, max_tokens）
//   created_at        TIMESTAMPTZ DEFAULT now(),
//   updated_at        TIMESTAMPTZ DEFAULT now(),
//   UNIQUE(user_id, provider_id, model_id)
// );
//
// -- Indexes
// CREATE INDEX idx_provider_registry_enabled ON provider_registry(enabled);
// CREATE INDEX idx_provider_registry_type ON provider_registry(provider_type);
// CREATE INDEX idx_user_model_prefs_user ON user_model_preferences(user_id);
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const dns = require('dns');
const net = require('net');

// ── Encryption ──────────────────────────────────────────────────────────
// AES-256-GCM requires: 32-byte key, 12-byte IV, produces 16-byte auth tag.

// 密钥版本说明：provider 行内 api_key_* 字段配合 key_version 使用，
// v1 = sha256(ENCRYPTION_KEY) 派生的 32 字节密钥。未来轮换密钥时写入新版本号。
function getEncryptionKey() {
  // 优先使用专门的 ENCRYPTION_KEY：统一用 sha256 派生 32 字节。
  // 不再对明文前 32 字节做 slice 截断——截断会破坏密钥熵并造成"长密钥等于短密钥"的歧义。
  if (process.env.ENCRYPTION_KEY) {
    return crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest();
  }
  if (process.env.API_SECRET) {
    // 降级路径：从 API_SECRET 派生，但提示配置独立密钥以便轮换与隔离。
    console.warn('[PROVIDER] ENCRYPTION_KEY 未设置，正在使用 API_SECRET 派生加密密钥；建议配置独立的 ENCRYPTION_KEY。');
    return crypto.createHash('sha256').update('provider-key-derivation:' + process.env.API_SECRET).digest();
  }
  // 密钥缺失：server.js 已要求 API_SECRET，此处不应到达。若到达则拒绝启动以保安全。
  throw new Error('ENCRYPTION_KEY 和 API_SECRET 均未设置，无法初始化加密模块。请在环境变量中设置 ENCRYPTION_KEY 或 API_SECRET。');
}

// 旧版密钥派生（兼容存量数据）：ENCRYPTION_KEY >= 32 字节时曾直接取明文前 32 字节，
// < 32 字节时才是 sha256（此时与新版派生一致）。API_SECRET 路径新旧派生完全相同，
// 无需兼容。返回 null 表示旧派生与当前派生一致或不存在。
function getLegacyEncryptionKey() {
  if (process.env.ENCRYPTION_KEY) {
    var raw = Buffer.from(process.env.ENCRYPTION_KEY, 'utf8');
    if (raw.length >= 32) return raw.slice(0, 32);
  }
  return null;
}

function gcmDecrypt(key, encrypted, ivB64, tagB64) {
  var decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  var decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

function encryptApiKey(plaintext) {
  var key = getEncryptionKey();
  var iv = crypto.randomBytes(12);
  var cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  var encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  var tag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    key_version: 'v1'
  };
}

function decryptApiKey(encrypted, ivB64, tagB64, keyVersion) {
  // 优先使用新版派生（sha256）密钥解密
  var primaryKey = getEncryptionKey();
  var primaryError = null;
  try {
    return gcmDecrypt(primaryKey, encrypted, ivB64, tagB64);
  } catch (e) {
    primaryError = e;
  }
  // 存量数据兼容：旧版对 >=32 字节的 ENCRYPTION_KEY 取明文前 32 字节作为密钥。
  // 仅当旧派生结果与当前派生不同时才重试（避免同一密钥重复尝试）；
  // key_version 为未知版本时不回退，避免将来轮换密钥后误用旧派生。
  if (keyVersion === undefined || keyVersion === null || keyVersion === 'v1') {
    var legacyKey = getLegacyEncryptionKey();
    if (legacyKey && !legacyKey.equals(primaryKey)) {
      try {
        var decrypted = gcmDecrypt(legacyKey, encrypted, ivB64, tagB64);
        console.warn('[PROVIDER] 检测到旧版密钥派生（slice）加密的存量数据，已兼容解密；建议重新保存该 API Key 以迁移到新版派生。');
        return decrypted;
      } catch (_) { /* 新/旧派生均失败，走下方统一报错 */ }
    }
  }
  throw primaryError;
}

// ── Provider type defaults ──────────────────────────────────────────────

var PROVIDER_DEFAULTS = {
  openai: {
    base_url: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    capabilities: ['chat', 'tools', 'vision']
  },
  deepseek: {
    base_url: 'https://api.deepseek.com/v1',
    models: ['deepseek-v4-flash-vision-exp', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
    capabilities: ['chat', 'thinking', 'tools', 'vision']
  },
  anthropic: {
    base_url: 'https://api.anthropic.com/v1',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
    capabilities: ['chat', 'thinking', 'tools']
  },
  custom: {
    base_url: '',
    models: [],
    capabilities: ['chat']
  }
};

function getDefaultConfig(providerType) {
  return PROVIDER_DEFAULTS[providerType] || PROVIDER_DEFAULTS.custom;
}

// ── SSRF hostname 判定 ─────────────────────────────────────────────────

// 判断单条 IP 地址是否为内网/回环/保留段（IPv4/IPv6）。与 web-fetch.js 的
// isPrivateAddress 保持同一套覆盖标准：IPv4 全部分段 + IPv6 的 mapped 内嵌、
// ULA(fc/fd)、链路本地(fe8-feB)、NAT64(64:ff9b::/96)、6to4(2002::/16)、
// Teredo(2001::/32)、文档段(2001:db8::/32) 与组播(ff00::/8)。
function isPrivateIpAddress(address) {
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
      if (net.isIP(mappedV4) === 4) return isPrivateIpAddress(mappedV4);
    }
    return value === '::' || value === '::1' ||
      /^f[cd][0-9a-f]{2}:/.test(value) ||  // fc00::/7 ULA（fc00-fdff 前缀全段）
      /^fe[89ab]:/.test(value) ||          // fe80::/10 链路本地
      /^64:ff9b:/.test(value) ||           // NAT64 well-known 前缀
      /^2002:/.test(value) ||              // 6to4（2002::/16，可内嵌任意 IPv4）
      /^2001:0:/i.test(value) ||           // Teredo（2001::/32）
      /^2001:db8:/.test(value) ||          // 文档/示例保留段
      /^ff00:/i.test(value);               // 组播
  }
  return false;
}

// 统一的 SSRF hostname 判定（IPv4 / IPv6 / localhost / 保留域名）。
// 传入的 hostname 应为去除方括号、小写化后的主机名。
// 修复（审计 🟠）：net.isIP 拒绝一切 IP 字面量——包括 IPv6 的完整书写形式
// （0:0:0:0:0:0:0:1、0000:...:0001）与 8 段完整 IPv4-mapped（0:0:0:0:0:ffff:7f00:1），
// 不再依赖字符串前缀匹配；非 IP 域名强制走 DNS 解析后再校验（见 assertSafeProviderHost）。
function isHostBlocked(hostname) {
  var host = String(hostname || '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host === '0.0.0.0' ||
      host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') ||
      host === 'metadata.google.internal' || host === 'metadata') {
    return true;
  }
  // 任何合法 IPv4/IPv6 字面量一律拒绝（强制走 DNS 域名；十六进制/八进制/十进制
  // 整数 IP 变体也被 net.isIP 以字面量形式拒绝）
  if (net.isIP(host) !== 0) return true;
  return false;
}

// 域名级 SSRF 校验：解析全部 A/AAAA 记录，任一地址为内网/回环/保留段即拒绝。
// 防止攻击者用攻击者可控 DNS 的公网域名做 DNS rebinding 到内网。
async function assertSafeProviderHost(hostname, lookupImpl) {
  var host = String(hostname || '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (isHostBlocked(host)) {
    return { ok: false, error: 'BLOCKED_BASE_URL' };
  }
  // Node dns.lookup 必须传 callback；默认走 dns.promises.lookup。
  var lookup = lookupImpl || (dns.promises && dns.promises.lookup
    ? function(h, opts) { return dns.promises.lookup(h, opts || { all: true, verbatim: true }); }
    : null);
  var addresses;
  try {
    if (!lookup) throw new Error('no dns lookup');
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch (_) {
    return { ok: false, error: 'DNS_RESOLVE_FAILED' };
  }
  if (!Array.isArray(addresses) || !addresses.length ||
      addresses.some(function(item) { return isPrivateIpAddress(item && item.address); })) {
    return { ok: false, error: 'BLOCKED_BASE_URL' };
  }
  return { ok: true, addresses: addresses.map(function(item) { return item.address; }) };
}

// URL 规范化：使用 URL 对象解析，要求 https，拒绝内网地址（含 DNS 解析后校验）
async function normalizeProviderUrl(rawUrl) {
  if (!rawUrl) return null;
  var parsed;
  try { parsed = new URL(rawUrl); } catch (_) { return { error: 'INVALID_BASE_URL' }; }
  if (parsed.protocol !== 'https:') return { error: 'INVALID_BASE_URL' };
  // URL.hostname 对 IPv6 字面量会带方括号（如 [::1]），先去括号再判定
  var hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // SSRF 防护：拒绝 IP 字面量 / localhost / 内网保留段 / 云元数据，并对域名做
  // DNS 解析后地址校验（与 web-fetch.assertSafeWebUrl 同标准）
  var hostCheck = await assertSafeProviderHost(hostname);
  if (!hostCheck.ok) {
    return { error: hostCheck.error === 'DNS_RESOLVE_FAILED' ? 'INVALID_BASE_URL' : 'BLOCKED_BASE_URL' };
  }
  // 去除尾斜杠，保留路径
  var normalized = parsed.origin + parsed.pathname.replace(/\/+$/, '');
  return { url: normalized };
}

// capabilities 始终为字符串数组
function normalizeCapabilities(caps) {
  if (Array.isArray(caps)) return caps.map(String);
  if (typeof caps === 'string') return [caps];
  return [];
}

// ── Route registration ──────────────────────────────────────────────────

module.exports = function registerProviderRegistryRoutes(app, deps) {
  var supabase = deps.supabase;
  var verifyToken = deps.verifyToken;
  var rateLimit = deps.rateLimit;
  var sanitizeError = deps.sanitizeError;

  // ── GET /api/provider/models ──────────────────────────────────────────
  // 返回所有已启用的提供商及其可用模型（公开接口，无需管理员权限，需 IP 限流）
  app.get('/api/provider/models', rateLimit(60000, 60), async function(req, res) {
    try {
      // base_url 等内部字段不下发，避免泄露自定义内网端点
      var { data, error } = await supabase
        .from('provider_registry')
        .select('id, name, provider_type, models_config, capabilities, enabled')
        .eq('enabled', true)
        .order('name');

      if (error) {
        return res.status(500).json({ error: sanitizeError(error), code: 'DB_QUERY_FAILED' });
      }

      var result = (data || []).map(function(p) {
        return {
          id: p.id,
          name: p.name,
          provider_type: p.provider_type,
          models: p.models_config || [],
          capabilities: normalizeCapabilities(p.capabilities)
          // base_url 不下发：避免泄露自定义内网端点
        };
      });

      return res.json({ ok: true, providers: result });
    } catch (e) {
      console.error('[PROVIDER] GET /api/provider/models error:', e.message);
      return res.status(500).json({ error: sanitizeError(e), code: 'INTERNAL_ERROR' });
    }
  });

  // ── GET /api/provider/list ────────────────────────────────────────────
  // 列出所有已配置的提供商（管理员专用，不暴露 API Key）
  app.get('/api/provider/list', verifyToken, rateLimit(60000, 30), async function(req, res) {
    try {
      var { data, error } = await supabase
        .from('provider_registry')
        .select('id, name, provider_type, base_url, models_config, capabilities, enabled, created_at, updated_at')
        .order('name');

      if (error) {
        return res.status(500).json({ error: sanitizeError(error), code: 'DB_QUERY_FAILED' });
      }

      return res.json({ ok: true, providers: data || [] });
    } catch (e) {
      console.error('[PROVIDER] GET /api/provider/list error:', e.message);
      return res.status(500).json({ error: sanitizeError(e), code: 'INTERNAL_ERROR' });
    }
  });

  // ── POST /api/provider/register ───────────────────────────────────────
  // 注册一个新的提供商（管理员专用）
  app.post('/api/provider/register', verifyToken, rateLimit(60000, 20), async function(req, res) {
    try {
      var body = req.body || {};
      var name = String(body.name || '').trim();
      var providerType = String(body.provider_type || '').trim().toLowerCase();
      var apiKey = String(body.api_key || '').trim();
      var baseUrl = String(body.base_url || '').trim();
      var modelsConfig = body.models_config;
      var capabilities = body.capabilities;

      // 验证必填字段
      if (!name) {
        return res.status(400).json({ error: '提供商名称不能为空', code: 'MISSING_NAME' });
      }
      if (!providerType || ['openai', 'deepseek', 'anthropic', 'custom'].indexOf(providerType) === -1) {
        return res.status(400).json({ error: '无效的提供商类型，支持: openai, deepseek, anthropic, custom', code: 'INVALID_TYPE' });
      }
      if (!apiKey) {
        return res.status(400).json({ error: 'API Key 不能为空', code: 'MISSING_API_KEY' });
      }

      // 加密 API Key
      var encrypted = encryptApiKey(apiKey);

      // 填充默认值
      var defaults = getDefaultConfig(providerType);
      if (!baseUrl) baseUrl = defaults.base_url;
      // URL 规范化 + SSRF 防护（含 DNS 解析后地址校验）
      if (baseUrl) {
        var urlResult = await normalizeProviderUrl(baseUrl);
        if (!urlResult) { return res.status(400).json({ error: 'base_url 无效', code: 'INVALID_BASE_URL' }); }
        if (urlResult.error) { return res.status(400).json({ error: urlResult.error === 'BLOCKED_BASE_URL' ? '不允许的 base_url 地址' : 'base_url 格式无效', code: urlResult.error }); }
        baseUrl = urlResult.url;
      }
      if (!modelsConfig || (Array.isArray(modelsConfig) && modelsConfig.length === 0)) {
        modelsConfig = defaults.models;
      }
      capabilities = normalizeCapabilities(capabilities && capabilities.length ? capabilities : defaults.capabilities);

      // 检查名称是否已存在（处理 database error）
      var nameCheck = await supabase
        .from('provider_registry')
        .select('id')
        .eq('name', name)
        .maybeSingle();

      if (nameCheck.error) {
        return res.status(503).json({ error: '名称查询失败', code: 'NAME_QUERY_FAILED', details: sanitizeError(nameCheck.error) });
      }

      if (nameCheck.data) {
        return res.status(409).json({ error: '提供商名称已存在', code: 'DUPLICATE_NAME' });
      }

      var { data, error } = await supabase
        .from('provider_registry')
        .insert([{
          name: name,
          provider_type: providerType,
          api_key_encrypted: encrypted.encrypted,
          api_key_iv: encrypted.iv,
          api_key_tag: encrypted.tag,
          key_version: encrypted.key_version,
          base_url: baseUrl || null,
          models_config: Array.isArray(modelsConfig) ? modelsConfig : [],
          capabilities: capabilities,
          enabled: body.enabled !== false
        }])
        .select()
        .single();

      if (error) {
        // 检查唯一约束冲突
        if (error.code === '23505') {
          return res.status(409).json({ error: '提供商名称已存在', code: 'DUPLICATE_NAME' });
        }
        return res.status(500).json({ error: sanitizeError(error), code: 'INSERT_FAILED' });
      }

      return res.status(201).json({
        ok: true,
        provider: {
          id: data.id,
          name: data.name,
          provider_type: data.provider_type,
          base_url: data.base_url,
          models_config: data.models_config,
          capabilities: data.capabilities,
          enabled: data.enabled,
          created_at: data.created_at
        }
      });
    } catch (e) {
      console.error('[PROVIDER] POST /api/provider/register error:', e.message);
      return res.status(500).json({ error: sanitizeError(e), code: 'INTERNAL_ERROR' });
    }
  });

  // ── POST /api/provider/test ───────────────────────────────────────────
  // 测试 API Key 是否有效（管理员专用）
  app.post('/api/provider/test', verifyToken, rateLimit(60000, 10), async function(req, res) {
    try {
      var body = req.body || {};
      var providerType = String(body.provider_type || '').trim().toLowerCase();
      var apiKey = String(body.api_key || '').trim();
      var baseUrl = String(body.base_url || '').trim();

      if (!apiKey) {
        return res.status(400).json({ error: 'API Key 不能为空', code: 'MISSING_API_KEY' });
      }
      if (!providerType || ['openai', 'deepseek', 'anthropic', 'custom'].indexOf(providerType) === -1) {
        return res.status(400).json({ error: '无效的提供商类型', code: 'INVALID_TYPE' });
      }

      // 构建测试请求
      var testUrl = baseUrl || getDefaultConfig(providerType).base_url;
      if (!testUrl) {
        // custom 类型如果没有 baseUrl，尝试从 apiKey 猜
        return res.status(400).json({ error: '自定义提供商需要提供 base_url', code: 'MISSING_BASE_URL' });
      }

      // SSRF 防护：仅允许 https，拒绝 IP 字面量 / localhost / 内网保留段 / 云元数据地址，
      // 并对域名做 DNS 解析后地址校验（防 DNS rebinding 到内网）
      var parsedTestUrl = null;
      try { parsedTestUrl = new URL(testUrl); } catch (_) {
        return res.status(400).json({ error: 'base_url 不是合法的 URL', code: 'INVALID_BASE_URL' });
      }
      if (parsedTestUrl.protocol !== 'https:') {
        return res.status(400).json({ error: '仅支持 https:// 的 base_url', code: 'INVALID_BASE_URL' });
      }
      // URL.hostname 对 IPv6 字面量会带方括号（如 [::1]），先去括号再判定
      var hostname = parsedTestUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      // SSRF 防护：net.isIP 拒绝一切 IP 字面量（含 IPv6 完整书写形式），
      // 域名再走 dns.lookup 校验全部解析地址均为公网
      var hostCheck = await assertSafeProviderHost(hostname);
      if (!hostCheck.ok) {
        return res.status(400).json({ error: 'base_url 指向不允许的主机', code: 'BLOCKED_BASE_URL' });
      }

      // 移除末尾的 /v1 等路径以获取基础 URL
      var modelsUrl = testUrl.replace(/\/+$/, '');
      if (modelsUrl.indexOf('/v1') === -1) {
        modelsUrl = modelsUrl + '/v1';
      }
      modelsUrl = modelsUrl + '/models';

      var controller = new AbortController();
      var timeout = setTimeout(function() { controller.abort(); }, 10000);

      try {
        var fetchOptions = {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
          },
          signal: controller.signal,
          // 不跟随重定向：3xx 一律视为失败，防止重定向到内网/云元数据地址
          redirect: 'manual'
        };

        // Anthropic 使用 x-api-key 头
        if (providerType === 'anthropic') {
          fetchOptions.headers = {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          };
        }

        var response = await fetch(modelsUrl, fetchOptions);
        clearTimeout(timeout);

        if (response.ok) {
          var modelsData = null;
          // 响应体设字节上限（256KB），超限即丢弃，防止超大响应体拖垮进程
          try {
            var maxBodyBytes = 256 * 1024;
            var bodyBytes = 0;
            var chunks = [];
            var reader = response.body && typeof response.body.getReader === 'function' ? response.body.getReader() : null;
            if (reader) {
              var overLimit = false;
              while (true) {
                var chunk = await reader.read();
                if (chunk.done) break;
                bodyBytes += chunk.value ? chunk.value.byteLength : 0;
                if (bodyBytes > maxBodyBytes) { overLimit = true; break; }
                chunks.push(Buffer.from(chunk.value));
              }
              if (overLimit && reader && typeof reader.cancel === 'function') {
                // 超限跳出后释放 reader，避免连接/流一直占用
                try { await reader.cancel(); } catch (_) {}
              }
              if (!overLimit) {
                var bodyText = Buffer.concat(chunks).toString('utf8');
                try { modelsData = JSON.parse(bodyText); } catch (_) {}
              }
            } else {
              var fullText = await response.text();
              if (Buffer.byteLength(fullText, 'utf8') <= maxBodyBytes) {
                try { modelsData = JSON.parse(fullText); } catch (_) {}
              }
            }
          } catch (_) { modelsData = null; }

          var models = [];
          if (modelsData && modelsData.data && Array.isArray(modelsData.data)) {
            models = modelsData.data.map(function(m) { return m.id || m; });
          }

          return res.json({
            ok: true,
            message: 'API Key 有效',
            models: models,
            status: response.status
          });
        } else {
          // 不回显响应体内容，防止 SSRF 探测结果外带；只返回状态码
          return res.status(200).json({
            ok: false,
            message: 'API Key 验证失败 (HTTP ' + response.status + ')',
            detail: '',
            status: response.status
          });
        }
      } catch (fetchErr) {
        clearTimeout(timeout);
        if (fetchErr.name === 'AbortError') {
          return res.status(200).json({ ok: false, message: '连接超时（10秒）', code: 'TIMEOUT' });
        }
        return res.status(200).json({ ok: false, message: '连接失败: ' + (fetchErr.message || '') });
      }
    } catch (e) {
      console.error('[PROVIDER] POST /api/provider/test error:', e.message);
      return res.status(500).json({ error: sanitizeError(e), code: 'INTERNAL_ERROR' });
    }
  });

  // ── PUT /api/provider/:id ─────────────────────────────────────────────
  // 更新提供商配置（管理员专用）
  app.put('/api/provider/:id', verifyToken, rateLimit(60000, 20), async function(req, res) {
    try {
      var providerId = req.params.id;
      if (!providerId || isNaN(Number(providerId))) {
        return res.status(400).json({ error: '无效的提供商 ID', code: 'INVALID_ID' });
      }

      var body = req.body || {};
      var updateData = {};

      if (body.name !== undefined) {
        var name = String(body.name).trim();
        if (!name) return res.status(400).json({ error: '提供商名称不能为空', code: 'MISSING_NAME' });
        updateData.name = name;
      }
      if (body.provider_type !== undefined) {
        var pt = String(body.provider_type).trim().toLowerCase();
        if (['openai', 'deepseek', 'anthropic', 'custom'].indexOf(pt) === -1) {
          return res.status(400).json({ error: '无效的提供商类型', code: 'INVALID_TYPE' });
        }
        updateData.provider_type = pt;
      }
      if (body.api_key !== undefined && String(body.api_key).trim()) {
        var encrypted = encryptApiKey(String(body.api_key).trim());
        updateData.api_key_encrypted = encrypted.encrypted;
        updateData.api_key_iv = encrypted.iv;
        updateData.api_key_tag = encrypted.tag;
        updateData.key_version = encrypted.key_version;
      }
      if (body.base_url !== undefined) {
        var updateUrl = String(body.base_url).trim();
        if (updateUrl) {
          var updateUrlResult = await normalizeProviderUrl(updateUrl);
          if (!updateUrlResult || updateUrlResult.error) {
            return res.status(400).json({ error: updateUrlResult && updateUrlResult.error === 'BLOCKED_BASE_URL' ? '不允许的 base_url 地址' : 'base_url 格式无效', code: updateUrlResult ? updateUrlResult.error : 'INVALID_BASE_URL' });
          }
          updateData.base_url = updateUrlResult.url;
        } else {
          updateData.base_url = null;
        }
      }
      if (body.models_config !== undefined) {
        updateData.models_config = Array.isArray(body.models_config) ? body.models_config : [];
      }
      if (body.capabilities !== undefined) {
        updateData.capabilities = normalizeCapabilities(body.capabilities);
      }
      if (body.enabled !== undefined) {
        updateData.enabled = Boolean(body.enabled);
      }

      updateData.updated_at = new Date().toISOString();

      if (Object.keys(updateData).length <= 1) {
        return res.status(400).json({ error: '没有需要更新的字段', code: 'NO_UPDATE' });
      }

      var { data, error } = await supabase
        .from('provider_registry')
        .update(updateData)
        .eq('id', providerId)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: '提供商名称已存在', code: 'DUPLICATE_NAME' });
        }
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: '提供商不存在', code: 'NOT_FOUND' });
        }
        return res.status(500).json({ error: sanitizeError(error), code: 'UPDATE_FAILED' });
      }

      if (!data) {
        return res.status(404).json({ error: '提供商不存在', code: 'NOT_FOUND' });
      }

      return res.json({
        ok: true,
        provider: {
          id: data.id,
          name: data.name,
          provider_type: data.provider_type,
          base_url: data.base_url,
          models_config: data.models_config,
          capabilities: data.capabilities,
          enabled: data.enabled,
          updated_at: data.updated_at
        }
      });
    } catch (e) {
      console.error('[PROVIDER] PUT /api/provider/:id error:', e.message);
      return res.status(500).json({ error: sanitizeError(e), code: 'INTERNAL_ERROR' });
    }
  });

  // ── DELETE /api/provider/:id ──────────────────────────────────────────
  // 删除提供商（管理员专用）
  app.delete('/api/provider/:id', verifyToken, rateLimit(60000, 10), async function(req, res) {
    try {
      var providerId = req.params.id;
      if (!providerId || isNaN(Number(providerId))) {
        return res.status(400).json({ error: '无效的提供商 ID', code: 'INVALID_ID' });
      }

      // 同时删除关联的用户偏好
      var { error: prefsError } = await supabase
        .from('user_model_preferences')
        .delete()
        .eq('provider_id', providerId);

      if (prefsError) {
        console.warn('[PROVIDER] Failed to delete user preferences for provider', providerId, ':', prefsError.message);
      }

      var { data, error } = await supabase
        .from('provider_registry')
        .delete()
        .eq('id', providerId)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: '提供商不存在', code: 'NOT_FOUND' });
        }
        return res.status(500).json({ error: sanitizeError(error), code: 'DELETE_FAILED' });
      }

      if (!data) {
        return res.status(404).json({ error: '提供商不存在', code: 'NOT_FOUND' });
      }

      return res.json({ ok: true, message: '提供商已删除' });
    } catch (e) {
      console.error('[PROVIDER] DELETE /api/provider/:id error:', e.message);
      return res.status(500).json({ error: sanitizeError(e), code: 'INTERNAL_ERROR' });
    }
  });
};