'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { PREVIEW_TARGET: TARGET, resolvePreviewAccountId } = require('../cloudflare/preview-target');
const { preflight, curlRequest, isIsolatedProject } = require('./cloudflare-preview-preflight');
const { buildPages } = require('./build-pages');
const ROOT = path.resolve(__dirname, '..');

function readState() {
  const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return { branch: git(['branch', '--show-current']), sha: git(['rev-parse', 'HEAD']), dirty: !!git(['status', '--porcelain']) };
}

function credentialValues(env) {
  const values = [];
  for (const [key, value] of Object.entries(env)) {
    if (!value || !(/TOKEN|SECRET|PASSWORD|API_KEY|SERVICE_KEY|ENCRYPTION.*KEY/i.test(key) || key === 'CLOUDFLARE_ACCOUNT_ID')) continue;
    values.push(String(value));
    if (/PREVIOUS_KEYS|LEGACY_SECRETS/i.test(key)) values.push(...String(value).split(',').filter(Boolean));
  }
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

function redact(text, env) {
  let safe = String(text || '');
  for (const value of credentialValues(env)) safe = safe.split(value).join('[REDACTED]');
  return safe.replace(/cfat_[A-Za-z0-9._~+/=-]+/g, '[REDACTED]');
}

function privateLogger() {
  let directory;
  return (stage, output) => {
    directory ||= fs.mkdtempSync(path.join(os.tmpdir(), 'xtj-pages-deploy-'));
    fs.writeFileSync(path.join(directory, stage + '.log'), output, { mode: 0o600 });
  };
}

function prepareArtifact(env) {
  // Regenerate the allowlist after tests; never upload leftover test files.
  const artifact = buildPages();
  const credentials = credentialValues(env).map(value => Buffer.from(value));
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(file);
        if (credentials.some(value => bytes.includes(value))) throw Error('artifact_contains_credential');
      } else throw Error('artifact_contains_non_file');
    }
  };
  walk(artifact.out);
}

async function deployPreview({ env = process.env, state = readState, request = curlRequest,
  run = (command, args, options) => spawnSync(command, args, options), artifact = prepareArtifact,
  writeLog = privateLogger(), onPhase = () => {} } = {}) {
  let stage = 'source';
  const fail = code => ({ scope: 'pages_preview_deployment', deployment_success: false, code, stage });
  try {
    const initial = state();
    if (initial.dirty || initial.branch !== TARGET.sourceBranch || !/^[a-f0-9]{40}$/.test(initial.sha)) return fail('clean_migration_branch_required');
    const accountId = resolvePreviewAccountId(undefined, env.CLOUDFLARE_ACCOUNT_ID);
    stage = 'preflight'; onPhase(stage, 'started');
    const before = await preflight({ accountId, token: env.CLOUDFLARE_API_TOKEN, env, request });
    // A failed site probe cannot grant API access, but it also must not prevent
    // an authorized preview upload through the already allowed Cloudflare API.
    if (![0, 5].includes(before.exit_code)) return fail('api_or_project_preflight_failed');
    onPhase(stage, 'passed');
    const childEnv = { ...env, CLOUDFLARE_ACCOUNT_ID: accountId, WRANGLER_SEND_METRICS: 'false' };
    const execute = (label, command, args, timeout) => {
      stage = label; onPhase(stage, 'started');
      const result = run(command, args, { cwd: ROOT, env: childEnv, encoding: 'utf8', timeout,
        maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      writeLog(label, redact((result.stdout || '') + (result.stderr || ''), env));
      const passed = !result.error && result.status === 0;
      onPhase(stage, passed ? 'passed' : 'failed');
      return passed;
    };
    if (!execute('build', 'npm', ['run', 'build:pages'], 300000)) return fail('build_failed');
    if (!execute('tests', 'npm', ['test'], 1500000)) return fail('tests_failed');
    if (!execute('syntax', 'npm', ['run', 'test:syntax'], 120000)) return fail('syntax_failed');
    stage = 'artifact'; onPhase(stage, 'started');
    artifact(env);
    const current = state();
    if (current.dirty || current.sha !== initial.sha || current.branch !== initial.branch) return fail('source_changed_during_checks');
    onPhase(stage, 'passed');
    const base = 'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/pages/projects/' + TARGET.project;
    stage = 'project_guard';
    const project = await request(base, { token: env.CLOUDFLARE_API_TOKEN });
    if (project.failure || project.status !== 200 || project.data?.success !== true || !isIsolatedProject(project.data.result)) return fail('project_changed_during_checks');
    const configuration = JSON.parse(fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8'));
    const declaredVars = configuration.env?.preview?.vars || configuration.vars || {};
    const previousConfig = project.data.result.deployment_configs || {};
    const previousBindings = previousConfig.preview?.env_vars || {};
    // Pages treats Wrangler vars as authoritative and removes other plain-text
    // bindings. Never copy unknown values into files or quietly delete them.
    if (Object.entries(previousBindings).some(([name, binding]) => binding.type === 'plain_text'
      && (!Object.hasOwn(declaredVars, name) || declaredVars[name] !== binding.value))) return fail('undeclared_existing_preview_plain_binding');
    const uploaded = execute('upload', 'npx', ['--yes', 'wrangler@' + TARGET.wranglerVersion, 'pages', 'deploy',
      'output/cloudflare-pages', '--project-name=' + TARGET.project, '--branch=' + TARGET.branch,
      '--commit-hash=' + initial.sha], 240000);
    stage = 'deployment_verify'; onPhase(stage, 'started');
    const response = await request(base + '/deployments?per_page=5', { token: env.CLOUDFLARE_API_TOKEN });
    const deployments = response.status === 200 && response.data?.success === true && Array.isArray(response.data.result) ? response.data.result : [];
    const match = deployments.find(item => item.environment === 'preview' && item.latest_stage?.status === 'success'
      && item.deployment_trigger?.metadata?.commit_hash === initial.sha && item.deployment_trigger.metadata.branch === TARGET.branch);
    if (!match || !/^[a-f0-9-]{36}$/.test(match.id || '')
      || !/^https:\/\/[a-z0-9-]+\.xtj-preview\.pages\.dev$/.test(match.url || '')) {
      return fail(uploaded ? 'deployment_not_confirmed' : 'upload_failed');
    }
    const configured = await request(base, { token: env.CLOUDFLARE_API_TOKEN });
    const deployedConfig = configured.data?.result?.deployment_configs || {};
    const deployedBindings = deployedConfig.preview?.env_vars || {};
    if (configured.failure || configured.status !== 200 || configured.data?.success !== true || !isIsolatedProject(configured.data.result)
      || !isDeepStrictEqual(deployedConfig.production, previousConfig.production)
      || Object.entries(previousBindings).some(([name, binding]) => deployedBindings[name]?.type !== binding.type)
      || Object.entries(declaredVars).some(([name, value]) => deployedBindings[name]?.type !== 'plain_text' || deployedBindings[name].value !== value)) {
      return fail('deployment_runtime_bindings_or_production_configuration_changed');
    }
    const after = await preflight({ accountId, token: env.CLOUDFLARE_API_TOKEN, env, request });
    if (![0, 5].includes(after.exit_code)) return fail('post_deploy_project_check_failed');
    onPhase(stage, 'passed');
    return { scope: 'pages_preview_deployment', deployment_success: true,
      commit_hash: initial.sha, deployment_id: match.id, immutable_url: match.url,
      preview_url: 'https://' + TARGET.hostname, http_verification: after.checks.find(check => check.name === 'preview_http')?.code,
      missing_local_backend_bindings: after.missing_local_backend_bindings,
      backend_migration_complete: false };
  } catch (_) { return fail('deployment_stopped_without_logging_sensitive_error'); }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length) {
    console.log(JSON.stringify({ deployment_success: false, code: 'this_command_only_deploys_the_verified_preview' }));
    return 2;
  }
  const result = await deployPreview({ onPhase: (phase, status) => console.log(JSON.stringify({ phase, status })) });
  console.log(JSON.stringify(result, null, 2));
  return result.deployment_success ? 0 : 1;
}
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
module.exports = { deployPreview, redact, main };
