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
//   base_url      TEXT,                           -- 自定义 API 端点（可选）
//   models_config JSONB DEFAULT '[]'::jsonb,     -- 可用模型列表
//   capabilities  JSONB DEFAULT '{}'::jsonb,     -- 能力标签（如 ["chat","thinking","tools"]）
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

// ── Encryption ──────────────────────────────────────────────────────────
// AES-256-GCM requires: 32-byte key, 12-byte IV, produces 16-byte auth tag.

function getEncryptionKey() {
  // 优先使用专门的 ENCRYPTION_KEY，否则从 API_SECRET 派生
  if (process.env.ENCRYPTION_KEY) {
    var key = Buffer.from(process.env.ENCRYPTION_KEY, 'utf8');
    if (key.length >= 32) return key.slice(0, 32);
    // 如果不足 32 字节，用 SHA-256 派生
    return crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest();
  }
  if (process.env.API_SECRET) {
    return crypto.createHash('sha256').update('provider-key-derivation:' + process.env.API_SECRET).digest();
  }
  // 兜底（生产环境不应到达这里，因为 server.js 已要求 API_SECRET）
  return crypto.createHash('sha256').update('xtj-fallback-key-do-not-use-in-production').digest();
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
    tag: tag.toString('base64')
  };
}

function decryptApiKey(encrypted, ivB64, tagB64) {
  var key = getEncryptionKey();
  var decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  var decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
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
    models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
    capabilities: ['chat', 'thinking', 'tools']
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

// ── Route registration ──────────────────────────────────────────────────

module.exports = function registerProviderRegistryRoutes(app, deps) {
  var supabase = deps.supabase;
  var verifyToken = deps.verifyToken;
  var rateLimit = deps.rateLimit;
  var sanitizeError = deps.sanitizeError;

  // ── GET /api/provider/models ──────────────────────────────────────────
  // 返回所有已启用的提供商及其可用模型（公开接口，无需管理员权限）
  app.get('/api/provider/models', async function(req, res) {
    try {
      var { data, error } = await supabase
        .from('provider_registry')
        .select('id, name, provider_type, models_config, capabilities, base_url, enabled')
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
          capabilities: p.capabilities || {},
          base_url: p.base_url
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
      if (!modelsConfig || (Array.isArray(modelsConfig) && modelsConfig.length === 0)) {
        modelsConfig = defaults.models;
      }
      if (!capabilities || (typeof capabilities === 'object' && Object.keys(capabilities).length === 0)) {
        capabilities = defaults.capabilities;
      }

      // 检查名称是否已存在
      var { data: existing } = await supabase
        .from('provider_registry')
        .select('id')
        .eq('name', name)
        .maybeSingle();

      if (existing) {
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
          base_url: baseUrl || null,
          models_config: Array.isArray(modelsConfig) ? modelsConfig : [],
          capabilities: capabilities || {},
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
          signal: controller.signal
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
          try { modelsData = await response.json(); } catch (_) {}

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
          var errorText = '';
          try { errorText = (await response.text()).slice(0, 200); } catch (_) {}
          return res.status(200).json({
            ok: false,
            message: 'API Key 验证失败 (HTTP ' + response.status + ')',
            detail: errorText,
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
      }
      if (body.base_url !== undefined) {
        updateData.base_url = String(body.base_url).trim() || null;
      }
      if (body.models_config !== undefined) {
        updateData.models_config = Array.isArray(body.models_config) ? body.models_config : [];
      }
      if (body.capabilities !== undefined) {
        updateData.capabilities = body.capabilities;
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