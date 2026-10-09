'use strict';
const crypto = require('node:crypto');
function derive(secret, version) {
  if (!secret) throw new Error('ai_models_encryption_key_missing');
  return crypto.createHash('sha256').update('xtj:ai-models:v' + version + ':' + secret).digest();
}
function encrypt(plain, env = process.env) {
  const version = env.ENCRYPTION_KEY ? 2 : 1;
  const key = derive(version === 2 ? env.ENCRYPTION_KEY : env.API_SECRET || env.SUPABASE_SERVICE_KEY, version);
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return { version, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function decrypt(blob, env = process.env) {
  if (!blob || !blob.iv || !blob.tag || !blob.data) throw new Error('ai_models_invalid_ciphertext');
  const version = blob.version || 1;
  if (![1, 2].includes(version)) throw new Error('ai_models_unknown_key_version');
  const secrets = version === 2 ? [env.ENCRYPTION_KEY, ...(env.ENCRYPTION_PREVIOUS_KEYS || '').split(',')]
    : [env.API_SECRET, env.SUPABASE_SERVICE_KEY, ...(env.AI_MODELS_LEGACY_SECRETS || '').split(',')];
  for (const secret of secrets.filter(Boolean)) {
    try {
      const cipher = crypto.createDecipheriv('aes-256-gcm', derive(secret, version), Buffer.from(blob.iv, 'base64'));
      cipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
      return Buffer.concat([cipher.update(Buffer.from(blob.data, 'base64')), cipher.final()]).toString('utf8');
    } catch (_) {}
  }
  // Do not silently replace an unreadable saved key with an empty string.
  throw new Error('ai_models_encryption_key_unavailable');
}
async function migrateSecrets(db, env = process.env) {
  if (!env.ENCRYPTION_KEY) return;
  let after = null;
  while (true) {
    let query = db.from('posts').select('id,content').eq('media_type', '__custom_ai_models__').order('id').limit(100);
    if (after) query = query.gt('id', after);
    const result = await query;
    if (!result || result.error) throw result && result.error || Error('ai_models_migration_unavailable');
    if (!result.data.length) return;
    for (const row of result.data) {
      const content = JSON.parse(row.content), models = Array.isArray(content.models) ? content.models : [];
      let changed = false;
      for (const model of models) {
        if (model.api_key_enc && model.api_key_enc.version !== 2) {
          model.api_key_enc = encrypt(decrypt(model.api_key_enc, env), env); changed = true;
        }
      }
      if (changed) {
        const saved = await db.from('posts').update({ content: JSON.stringify(content) }).eq('id', row.id).eq('content', row.content);
        if (!saved || saved.error) throw saved && saved.error || Error('ai_models_migration_save_failed');
      }
    }
    after = result.data.at(-1).id;
  }
}
module.exports = { encrypt, decrypt, migrateSecrets };
