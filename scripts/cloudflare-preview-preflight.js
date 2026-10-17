'use strict';

// Read-only checks for the independent preview. Never print raw provider errors:
// they can echo a token mistakenly supplied as an Account ID.
const { spawnSync } = require('node:child_process');
const { PREVIEW_TARGET, resolvePreviewAccountId } = require('../cloudflare/preview-target');
const { project: PROJECT, hostname: PREVIEW_HOST, productionBranch: PRODUCTION_BRANCH } = PREVIEW_TARGET;

function isIsolatedProject(project) {
  return project?.name === PROJECT && project.subdomain === PROJECT + '.pages.dev'
    && project.production_branch === PRODUCTION_BRANCH
    && project.canonical_deployment == null && project.production_deployment == null
    && Array.isArray(project.domains) && project.domains.length === 1 && project.domains[0] === PROJECT + '.pages.dev';
}

function curlRequest(url, { token, spawn = spawnSync } = {}) {
  const args = ['--disable', '--silent', '--show-error', '--proto', '=https',
    '--connect-timeout', '10', '--max-time', '20', '--max-filesize', '1048576',
    '--config', '-', '--write-out', '\n%{http_code}', '--url', url];
  // Credentials travel through stdin, not command arguments or temporary files.
  const input = token ? 'header = ' + JSON.stringify('Authorization: Bearer ' + token) + '\n' : '';
  const childEnv = { ...process.env };
  delete childEnv.CLOUDFLARE_API_TOKEN;
  delete childEnv.CLOUDFLARE_ACCOUNT_ID;
  const result = spawn('curl', args, { input, encoding: 'utf8', timeout: 25000,
    maxBuffer: 2 * 1024 * 1024, env: childEnv });
  const output = typeof result.stdout === 'string' ? result.stdout : '';
  const match = output.match(/\n(\d{3})$/);
  const status = match ? Number(match[1]) : 0;
  // A proxy CONNECT failure precedes the TLS connection to Cloudflare. An HTTP
  // 403 from the site itself must not be classified as this environment problem.
  const connectDenied = /CONNECT tunnel failed, response 403/i.test(result.stderr || '');
  let data = null;
  if (match) {
    try { data = JSON.parse(output.slice(0, match.index)); } catch (_) { /* HTML and proxy bodies are not logged. */ }
  }
  return { status, data, failure: connectDenied ? 'proxy_connect_denied'
    : result.error || result.status !== 0 ? 'transport_failed' : null };
}

function validToken(value) {
  // Managed environments may supply an opaque credential reference. Let the API
  // validate it; only reject absent values and characters unsafe in a header.
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 16384 && /^[\x20-\x7e]+$/.test(value);
}

async function preflight({ accountId, token, env = {}, request = curlRequest } = {}) {
  const report = {
    preview: 'https://' + PREVIEW_HOST,
    checks: [],
    // Existing values must be restored securely; generating replacement signing
    // or encryption keys would break sessions and encrypted provider keys.
    missing_local_backend_bindings: ['API_SECRET', 'SUPABASE_SERVICE_KEY', 'ENCRYPTION_KEY'].filter(key => !env[key])
  };
  const add = (name, status, code) => report.checks.push({ name, status, code });
  const done = exitCode => ({ ...report, ok: exitCode === 0, exit_code: exitCode });
  if (!/^[a-f0-9]{32}$/i.test(accountId || '')) {
    add('account_id', 'failed', 'account_id_must_be_32_hex_characters');
    return done(2);
  }
  add('account_id', 'passed', 'valid_format');
  if (!validToken(token)) {
    add('api_token', 'failed', 'missing_or_unsafe_token_header');
    return done(2);
  }
  const api = 'https://api.cloudflare.com/client/v4';
  async function get(path, authenticated = true) {
    try { return await request(api + path, authenticated ? { token } : {}); }
    catch (_) { return { status: 0, failure: 'transport_failed', data: null }; }
  }
  // Cloudflare account tokens are NOT user tokens. Try the correct scope first;
  // a failed scope verification alone does not prove that the credential is bad.
  let verification = await get('/accounts/' + accountId + '/tokens/verify');
  let tokenScope = 'account_token_active';
  if (verification.status !== 200 || verification.data?.result?.status !== 'active') {
    if (verification.failure) {
      add('api_token', 'failed', verification.failure);
      return done(3);
    }
    verification = await get('/user/tokens/verify');
    tokenScope = 'user_token_active';
  }
  if (verification.status !== 200 || verification.data?.success !== true || verification.data?.result?.status !== 'active') {
    add('api_token', 'failed', verification.failure || 'token_verification_failed');
    return done(3);
  }
  add('api_token', 'passed', tokenScope);
  const projectResponse = await get('/accounts/' + accountId + '/pages/projects/' + PROJECT);
  if (projectResponse.status !== 200 || projectResponse.data?.success !== true) {
    add('pages_project', 'failed', projectResponse.failure || (projectResponse.status === 404 ? 'preview_project_not_found' : 'project_read_failed'));
    return done(3);
  }
  const project = projectResponse.data.result;
  if (!isIsolatedProject(project)) {
    add('pages_project', 'failed', 'preview_project_isolation_check_failed');
    return done(4);
  }
  add('pages_project', 'passed', 'independent_preview_without_custom_domain_or_production_deployment');
  // Only contact the known preview host, and never send the API token to it.
  let preview;
  try { preview = await request('https://' + PREVIEW_HOST + '/api/config/public', {}); }
  catch (_) { preview = { status: 0, failure: 'transport_failed' }; }
  if (preview.failure || preview.status !== 200) {
    add('preview_http', 'failed', preview.failure || 'preview_http_' + preview.status);
    if (preview.failure === 'proxy_connect_denied') report.required_network_host = PREVIEW_HOST;
    return done(5);
  }
  const config = preview.data;
  if (!config || Object.keys(config).sort().join(',') !== 'supabase_anon_key,supabase_url') {
    add('preview_http', 'failed', 'unexpected_public_config_response');
    return done(5);
  }
  add('preview_http', 'passed', 'public_config_reachable');
  // Success covers preview reachability only; full backend migration is separate.
  return done(0);
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length && (argv.length !== 2 || argv[0] !== '--account-id')) {
    console.log(JSON.stringify({ ok: false, exit_code: 2, code: 'usage_npm_run_cloudflare_preflight_optional_account_id' }));
    return 2;
  }
  let accountId;
  try { accountId = resolvePreviewAccountId(argv[1], process.env.CLOUDFLARE_ACCOUNT_ID); }
  catch (_) {
    console.log(JSON.stringify({ ok: false, exit_code: 2, code: 'unexpected_preview_account' }));
    return 2;
  }
  const result = await preflight({ accountId,
    token: process.env.CLOUDFLARE_API_TOKEN, env: process.env });
  console.log(JSON.stringify(result, null, 2));
  return result.exit_code;
}

if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => {
  console.log(JSON.stringify({ ok: false, exit_code: 1, code: 'preflight_failed_without_logging_provider_error' }));
  process.exitCode = 1;
});
module.exports = { curlRequest, preflight, isIsolatedProject, main };
