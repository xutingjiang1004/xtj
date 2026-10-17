'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deployPreview, redact } = require('../scripts/cloudflare-preview-deploy');
const { PREVIEW_TARGET: TARGET } = require('../cloudflare/preview-target');
const TOKEN = 'fixture_sensitive_token_never_output';
const SHA = 'a'.repeat(40);
const project = { name: TARGET.project, subdomain: TARGET.project + '.pages.dev', production_branch: TARGET.productionBranch,
  canonical_deployment: null, domains: [TARGET.project + '.pages.dev'] };
const ok = result => ({ status: 200, data: { success: true, result } });
function fixture(options = {}) {
  const commands = [], logs = [], requests = [];
  let states = 0, projectReads = 0;
  const setup = {
    env: { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: 'managed-placeholder:' + TOKEN,
      HTTPS_PROXY: 'http://proxy:8080', NODE_EXTRA_CA_CERTS: '/fixture/managed-ca.pem' },
    state() { states++; return { sha: SHA, branch: TARGET.sourceBranch, dirty: options.dirty || (options.changedSource && states > 1) }; },
    artifact() {}, writeLog(stage, text) { logs.push({ stage, text }); },
    run(command, args, config) {
      commands.push({ command, args, config });
      return { status: options.failTests && args[0] === 'test' ? 1 : options.uploadError && command === 'npx' ? 1 : 0,
        stdout: 'fixture log ' + TOKEN, stderr: '' };
    },
    request(url, config) {
      requests.push({ url, config });
      if (url.endsWith('/tokens/verify')) return ok({ status: 'active' });
      if (url.endsWith('/pages/projects/' + TARGET.project)) {
        projectReads++;
        return ok(options.customDomain && projectReads > 1 ? { ...project, domains: [...project.domains, 'production.example'] } : project);
      }
      if (url.includes('/deployments?')) return ok(options.noDeployment ? [] : [{ id: '11111111-1111-4111-8111-111111111111', url: 'https://fixture.xtj-preview.pages.dev',
        environment: 'preview', latest_stage: { status: 'success' }, deployment_trigger: { metadata: { commit_hash: SHA, branch: TARGET.branch } } }]);
      assert.deepEqual(config, {});
      return { status: 0, failure: 'proxy_connect_denied' };
    }
  };
  return { setup, commands, logs, requests };
}

test('one command corrects the account per process, runs checks and deploys only a preview despite a blocked site probe', async () => {
  const f = fixture(), result = await deployPreview(f.setup);
  assert.equal(result.deployment_success, true);
  assert.equal(result.http_verification, 'proxy_connect_denied');
  assert.equal(result.backend_migration_complete, false);
  assert.deepEqual(f.commands.map(c => c.command), ['npm', 'npm', 'npm', 'npx']);
  const command = f.commands.at(-1);
  assert.ok(command.args.includes('pages'));
  assert.ok(command.args.includes('--branch=migration-preview'));
  assert.equal(command.config.env.CLOUDFLARE_ACCOUNT_ID, TARGET.accountId);
  assert.equal(command.config.env.HTTPS_PROXY, f.setup.env.HTTPS_PROXY);
  assert.equal(command.config.env.NODE_EXTRA_CA_CERTS, f.setup.env.NODE_EXTRA_CA_CERTS);
  assert.equal(f.setup.env.CLOUDFLARE_ACCOUNT_ID.startsWith('managed-placeholder:'), true);
  assert.equal(command.args.join(' ').includes(TOKEN), false);
  assert.equal(f.logs.some(log => log.text.includes(TOKEN)), false);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('an artifact validation failure prevents upload and never exposes the rejected value', async () => {
  const f = fixture(); f.setup.artifact = () => { throw Error(TOKEN); };
  const result = await deployPreview(f.setup);
  assert.equal(result.deployment_success, false);
  assert.equal(result.stage, 'artifact');
  assert.equal(f.commands.some(command => command.command === 'npx'), false);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('dirty work, failed checks, changed source and newly attached production domains prevent upload', async () => {
  for (const changed of [{ dirty: true }, { failTests: true }, { changedSource: true }, { customDomain: true }]) {
    const f = fixture(changed), result = await deployPreview(f.setup);
    assert.equal(result.deployment_success, false);
    assert.equal(f.commands.some(command => command.command === 'npx'), false);
  }
});

test('a successful CLI exit is insufficient without an API-confirmed preview deployment', async () => {
  const f = fixture({ noDeployment: true });
  assert.equal((await deployPreview(f.setup)).deployment_success, false);
});

test('an upload command error can recover from a confirmed deployment without uploading twice', async () => {
  const f = fixture({ uploadError: true }), result = await deployPreview(f.setup);
  assert.equal(result.deployment_success, true);
  assert.equal(f.commands.filter(c => c.command === 'npx').length, 1);
});

test('transport errors never expose credentials or raw service errors', async () => {
  const f = fixture(); f.setup.request = () => { throw Error(TOKEN); };
  const result = await deployPreview(f.setup);
  assert.equal(result.deployment_success, false);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  assert.equal(f.commands.length, 0);
});

test('log and artifact credential classification covers service and encryption keys, including individual old keys', () => {
  const env = { SUPABASE_SERVICE_KEY: 'fixture_service_role_secret', ENCRYPTION_KEY: 'fixture_encryption_secret',
    ENCRYPTION_PREVIOUS_KEYS: 'fixture_old_key_one,fixture_old_key_two', AI_MODELS_LEGACY_SECRETS: 'fixture_old_api_secret' };
  const output = redact(Object.values(env).join(' ') + ' fixture_old_key_one fixture_old_key_two', env);
  for (const value of [...Object.values(env), 'fixture_old_key_one', 'fixture_old_key_two']) assert.equal(output.includes(value), false);
});
