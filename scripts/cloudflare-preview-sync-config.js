'use strict';

// Copy existing configuration in memory. Never start the Render application,
// generate replacement keys, log values, or write credentials to local files.
const { isDeepStrictEqual } = require('node:util');
const { PREVIEW_TARGET: TARGET, resolvePreviewAccountId } = require('../cloudflare/preview-target');
const { curlRequest, validToken, isIsolatedProject } = require('./cloudflare-preview-preflight');

const SOURCE = Object.freeze({
  serviceId: 'srv-d8j326u7r5hc73dem1f0',
  workspaceId: 'tea-d7mm2kjeo5us73eso5s0',
  repo: 'https://github.com/xutingjiang1004/xtj',
  supabaseUrl: 'https://ithowxqignlhkwaykglt.supabase.co'
});
const KEYS = Object.freeze(['SUPABASE_URL', 'API_SECRET', 'SUPABASE_SERVICE_KEY', 'ENCRYPTION_KEY',
  'ENCRYPTION_PREVIOUS_KEYS', 'AI_MODELS_LEGACY_SECRETS', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY']);
const REQUIRED = ['SUPABASE_URL', 'API_SECRET', 'SUPABASE_SERVICE_KEY'];

function keyRole(value) {
  if (/^sb_secret_[\w-]+$/.test(value)) return 'service_role';
  if (/^sb_publishable_[\w-]+$/.test(value)) return 'anon';
  if (!/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) return null;
  try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')).role; }
  catch (_) { return null; }
}

function validSource(values) {
  if (REQUIRED.some(key => !values[key])) return false;
  // Keep the exact original key bytes, including historical derivation keys.
  if (values.SUPABASE_URL.replace(/\/$/, '') !== SOURCE.supabaseUrl) return false;
  if (keyRole(values.SUPABASE_SERVICE_KEY) !== 'service_role') return false;
  return ['SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'].every(key => !values[key] || keyRole(values[key]) === 'anon');
}

async function syncPreviewConfig({ env = process.env, apply = false, request = curlRequest } = {}) {
  let stage = 'credentials';
  const report = { scope: 'pages_preview_configuration', mode: apply ? 'apply' : 'check',
    configuration_saved: false, backend_migration_complete: false };
  const fail = (code, extra = {}) => ({ ...report, ok: false, stage, code, ...extra });
  try {
    const missing = ['RENDER_API_KEY', 'CLOUDFLARE_API_TOKEN'].filter(key => !validToken(env[key]));
    if (missing.length) return fail('missing_or_unsafe_credential_binding', { required_environment_bindings: missing });
    const accountId = resolvePreviewAccountId(undefined, env.CLOUDFLARE_ACCOUNT_ID);
    const renderBase = 'https://api.render.com/v1/services/' + SOURCE.serviceId;
    const pagesBase = 'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/pages/projects/' + TARGET.project;
    const cf = () => request(pagesBase, { token: env.CLOUDFLARE_API_TOKEN });
    const goodProject = r => r?.status === 200 && !r.failure && r.data?.success === true && isIsolatedProject(r.data.result);
    stage = 'project_guard';
    if (!goodProject(await cf())) return fail('independent_preview_required');

    stage = 'render_source';
    const source = await request(renderBase, { token: env.RENDER_API_KEY });
    if (source.failure || source.status !== 200) return fail(source.failure || 'render_service_read_failed',
      source.failure === 'proxy_connect_denied' ? { required_network_host: 'api.render.com' } : {});
    const service = source.data;
    if (service?.id !== SOURCE.serviceId || service.name !== 'xtj' || service.ownerId !== SOURCE.workspaceId
      || service.branch !== 'main' || service.repo?.replace(/\.git$/, '') !== SOURCE.repo) return fail('unexpected_render_source');

    stage = 'render_configuration';
    const values = Object.create(null), seenKeys = new Set(), seenCursors = new Set();
    let cursor = '', completed = false;
    // Official Render CLI's generated GetEnvVarsForService contract: GET only,
    // [{envVar:{key,value},cursor}], with cursor and limit query parameters.
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const response = await request(renderBase + '/env-vars?' + query, { token: env.RENDER_API_KEY });
      if (response.failure || response.status !== 200 || !Array.isArray(response.data)) return fail(response.failure || 'render_configuration_read_failed');
      if (response.data.length === 0) { completed = true; break; }
      if (response.data.length > 100) return fail('unexpected_render_configuration_page');
      for (const row of response.data) {
        const item = row?.envVar;
        if (!item || typeof item.key !== 'string' || seenKeys.has(item.key)) return fail('ambiguous_render_configuration');
        seenKeys.add(item.key);
        if (!KEYS.includes(item.key)) continue;
        if (typeof item.value !== 'string' || item.value.length > 65536) return fail('invalid_original_configuration');
        if (item.value) values[item.key] = item.value;
      }
      cursor = response.data.at(-1)?.cursor;
      if (typeof cursor !== 'string' || !cursor || cursor.length > 2048 || seenCursors.has(cursor)) return fail('render_configuration_cursor_stalled');
      seenCursors.add(cursor);
    }
    if (!completed) return fail('render_configuration_page_limit');
    if (!validSource(values)) return fail('original_signing_or_database_configuration_invalid',
      { missing_original_binding_names: REQUIRED.filter(key => !values[key]) });

    stage = 'project_guard';
    const latest = await cf();
    if (!goodProject(latest)) return fail('project_changed_before_configuration_write');
    const project = latest.data.result;
    const current = project.deployment_configs?.preview?.env_vars || {};
    const updates = Object.create(null);
    for (const key of KEYS) {
      if (values[key] && !Object.hasOwn(current, key)) updates[key] = {
        type: key === 'SUPABASE_URL' ? 'plain_text' : 'secret_text', value: values[key]
      };
    }
    const names = Object.keys(updates);
    report.source_binding_names = KEYS.filter(key => Object.hasOwn(values, key));
    report.add_binding_names = names;
    report.preserved_binding_names = Object.keys(current).sort();
    report.absent_optional_original_binding_names = KEYS.filter(key => !REQUIRED.includes(key) && !values[key]);
    if (!apply || names.length === 0) return { ...report, ok: true, code: names.length ? 'configuration_ready_to_copy' : 'existing_bindings_preserved',
      redeploy_required: false };

    stage = 'preview_configuration_write';
    // PATCH merges named env-vars; only explicit null deletes a key. Omit every
    // existing binding, masked secret and production setting to preserve them.
    const saved = await request(pagesBase, { token: env.CLOUDFLARE_API_TOKEN, method: 'PATCH',
      body: { deployment_configs: { preview: { env_vars: updates } } } });
    if (saved.failure || saved.status !== 200 || saved.data?.success !== true) return fail('preview_configuration_write_not_confirmed');
    report.configuration_saved = true;
    stage = 'preview_configuration_verify';
    const after = await cf();
    const stored = after.data?.result?.deployment_configs?.preview?.env_vars || {};
    if (!goodProject(after) || names.some(key => stored[key]?.type !== updates[key].type)
      || Object.keys(current).some(key => !Object.hasOwn(stored, key))
      || !isDeepStrictEqual(after.data.result.deployment_configs?.production, project.deployment_configs?.production)) {
      return fail('configuration_verification_failed', { redeploy_required: true });
    }
    return { ...report, ok: true, code: 'original_configuration_copied_to_preview', redeploy_required: true };
  } catch (_) { return fail('configuration_stopped_without_logging_sensitive_error'); }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length && (argv.length !== 1 || argv[0] !== '--apply')) {
    console.log(JSON.stringify({ ok: false, code: 'usage_cloudflare_sync_config_optional_apply' }));
    return 2;
  }
  const result = await syncPreviewConfig({ apply: argv[0] === '--apply' });
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
module.exports = { syncPreviewConfig, main };
