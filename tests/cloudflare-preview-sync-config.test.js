'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { syncPreviewConfig } = require('../scripts/cloudflare-preview-sync-config');
const { curlRequest } = require('../scripts/cloudflare-preview-preflight');
const { PREVIEW_TARGET: TARGET } = require('../cloudflare/preview-target');

const CF_TOKEN = 'fixture_cloudflare_token_private';
const RENDER_TOKEN = 'fixture_render_token_private';
const ORIGINALS = {
  SUPABASE_URL: 'https://ithowxqignlhkwaykglt.supabase.co',
  API_SECRET: 'fixture_original_signing_secret',
  SUPABASE_SERVICE_KEY: 'sb_secret_fixture_original_service',
  ENCRYPTION_KEY: 'fixture_original_encryption_secret',
  ENCRYPTION_PREVIOUS_KEYS: 'fixture_previous_one,fixture_previous_two',
  AI_MODELS_LEGACY_SECRETS: 'fixture_legacy_secret',
  SUPABASE_ANON_KEY: 'sb_publishable_fixture_public_key'
};
const ok = data => ({ status: 200, failure: null, data });
function fixture(options = {}) {
  let reads = 0;
  const calls = [], original = { ...ORIGINALS, ...options.originals };
  const project = { name: TARGET.project, subdomain: TARGET.project + '.pages.dev',
    domains: [TARGET.project + '.pages.dev'], production_branch: TARGET.productionBranch,
    deployment_configs: { preview: { env_vars: { ...options.current } }, production: { env_vars: {} } } };
  const setup = {
    env: { CLOUDFLARE_API_TOKEN: CF_TOKEN, RENDER_API_KEY: RENDER_TOKEN },
    apply: options.apply ?? true,
    request(url, config) {
      calls.push({ url, config });
      if (options.transportError) throw Error(CF_TOKEN + RENDER_TOKEN);
      if (url.startsWith('https://api.render.com/')) {
        assert.equal(config.token, RENDER_TOKEN);
        assert.equal(config.method, undefined, 'Render access must remain read-only');
        if (url.includes('/env-vars?')) {
          reads++;
          if (options.badPage) return ok([{ envVar: { key: 'API_SECRET', value: original.API_SECRET }, cursor: 'stalled' }]);
          if (reads === 1) return ok(Object.entries({ ...original, UNRELATED_PROVIDER_KEY: 'fixture_do_not_copy' })
            .map(([key, value], index) => ({ envVar: { key, value }, cursor: 'cursor-' + index })));
          return ok([]);
        }
        return ok({ id: 'srv-d8j326u7r5hc73dem1f0', name: 'xtj', branch: 'main',
          ownerId: 'tea-d7mm2kjeo5us73eso5s0', repo: options.wrongRepo ? 'https://github.com/other/xtj' : 'https://github.com/xutingjiang1004/xtj' });
      }
      assert.ok(url.startsWith('https://api.cloudflare.com/client/v4/accounts/' + TARGET.accountId + '/pages/projects/' + TARGET.project));
      assert.equal(config.token, CF_TOKEN);
      if (config.method === 'PATCH') {
        if (options.writeError) return { status: 403, data: { success: false, error: original.API_SECRET } };
        assert.deepEqual(Object.keys(config.body), ['deployment_configs']);
        assert.deepEqual(Object.keys(config.body.deployment_configs), ['preview']);
        Object.assign(project.deployment_configs.preview.env_vars, structuredClone(config.body.deployment_configs.preview.env_vars));
        if (options.changedProduction) project.deployment_configs.production.env_vars.CHANGED = { type: 'plain_text', value: 'another-editor' };
      }
      if (options.customDomain) project.domains.push('formal.example');
      return ok({ success: true, result: structuredClone(project) });
    }
  };
  return { setup, calls, project, original };
}

test('copies original signing, service and historical keys only into missing preview bindings', async () => {
  const f = fixture(), result = await syncPreviewConfig(f.setup);
  assert.equal(result.ok, true);
  assert.equal(result.configuration_saved, true);
  assert.equal(result.redeploy_required, true);
  assert.equal(result.backend_migration_complete, false);
  const vars = f.project.deployment_configs.preview.env_vars;
  for (const [key, value] of Object.entries(ORIGINALS)) {
    assert.equal(vars[key].value, value, 'original bytes must be retained');
    assert.equal(vars[key].type, key === 'SUPABASE_URL' ? 'plain_text' : 'secret_text');
  }
  assert.equal(vars.UNRELATED_PROVIDER_KEY, undefined);
  assert.equal(vars.RENDER_API_KEY, undefined);
  assert.equal(vars.CLOUDFLARE_API_TOKEN, undefined);
  assert.deepEqual(f.project.deployment_configs.production, { env_vars: {} });
  const output = JSON.stringify(result);
  for (const value of [CF_TOKEN, RENDER_TOKEN, ...Object.values(ORIGINALS)]) assert.equal(output.includes(value), false);
  assert.equal(f.calls.filter(c => c.config.method === 'PATCH').length, 1);
  assert.ok(f.calls.some(c => c.url.includes('cursor=cursor-7')), 'must verify the actual end of paginated configuration');
});

test('check mode performs only reads and never sends a configuration body', async () => {
  const f = fixture({ apply: false }), result = await syncPreviewConfig(f.setup);
  assert.equal(result.ok, true);
  assert.equal(result.configuration_saved, false);
  assert.equal(result.code, 'configuration_ready_to_copy');
  assert.equal(f.calls.some(c => c.config.method || c.config.body), false);
});

test('existing masked secrets and unrelated settings survive without being replayed or overwritten', async () => {
  const current = { API_SECRET: { type: 'secret_text', value: '' }, OTHER: { type: 'plain_text', value: 'preserve' } };
  const f = fixture({ current }), result = await syncPreviewConfig(f.setup);
  assert.equal(result.ok, true);
  assert.equal(result.add_binding_names.includes('API_SECRET'), false);
  assert.deepEqual(f.project.deployment_configs.preview.env_vars.API_SECRET, current.API_SECRET);
  assert.deepEqual(f.project.deployment_configs.preview.env_vars.OTHER, current.OTHER);
  const update = f.calls.find(c => c.config.method === 'PATCH').config.body.deployment_configs.preview.env_vars;
  assert.equal(Object.hasOwn(update, 'API_SECRET'), false);
  assert.equal(Object.hasOwn(update, 'OTHER'), false);
});

test('repeat runs preserve all existing bindings and do not perform redundant writes', async () => {
  const current = Object.fromEntries(Object.keys(ORIGINALS).map(key => [key, { type: 'secret_text', value: '' }]));
  const f = fixture({ current }), result = await syncPreviewConfig(f.setup);
  assert.equal(result.ok, true);
  assert.equal(result.code, 'existing_bindings_preserved');
  assert.equal(f.calls.some(c => c.config.method === 'PATCH'), false);
});

test('missing runtime credentials stop before any API call, even when configuration was published elsewhere', async () => {
  const f = fixture(); delete f.setup.env.RENDER_API_KEY;
  const result = await syncPreviewConfig(f.setup);
  assert.equal(result.ok, false);
  assert.deepEqual(result.required_environment_bindings, ['RENDER_API_KEY']);
  assert.equal(f.calls.length, 0);
});

test('wrong sources, production domains, private public-keys and invalid original values prevent any write', async () => {
  for (const options of [{ wrongRepo: true }, { customDomain: true }, { badPage: true },
    { originals: { API_SECRET: '' } }, { originals: { SUPABASE_SERVICE_KEY: 'sb_publishable_wrong_role' } },
    { originals: { SUPABASE_URL: 'https://other.supabase.co' } },
    { originals: { SUPABASE_ANON_KEY: 'sb_secret_never_public' } }]) {
    const f = fixture(options), result = await syncPreviewConfig(f.setup);
    assert.equal(result.ok, false);
    assert.equal(f.calls.some(c => c.config.method === 'PATCH'), false);
  }
});

test('failed requests, malformed pagination and post-write production changes are reported without values', async () => {
  for (const options of [{ transportError: true }, { badPage: true }, { writeError: true }, { changedProduction: true }]) {
    const f = fixture(options), result = await syncPreviewConfig(f.setup);
    assert.equal(result.ok, false);
    for (const value of [CF_TOKEN, RENDER_TOKEN, ...Object.values(ORIGINALS)]) assert.equal(JSON.stringify(result).includes(value), false);
  }
});

test('HTTP transport sends authorization and JSON only through stdin, retaining proxy and CA trust', () => {
  const body = { deployment_configs: { preview: { env_vars: { API_SECRET: { type: 'secret_text', value: 'fixture_"secret\\line\nnext' } } } } };
  curlRequest('https://api.cloudflare.com/client/v4/fixture', { token: CF_TOKEN, method: 'PATCH', body,
    spawn(command, args, options) {
      assert.equal(command, 'curl');
      assert.equal(args.join(' ').includes(CF_TOKEN), false);
      assert.equal(args.join(' ').includes('fixture_"secret'), false);
      const encoded = options.input.split('\n').find(line => line.startsWith('data-binary = ')).slice('data-binary = '.length);
      assert.deepEqual(JSON.parse(JSON.parse(encoded)), body);
      assert.ok(options.input.includes('request = "PATCH"'));
      assert.equal(options.env.RENDER_API_KEY, undefined);
      assert.equal(options.env.CLOUDFLARE_API_TOKEN, undefined);
      assert.equal(options.env.HTTPS_PROXY, process.env.HTTPS_PROXY);
      assert.equal(options.env.NODE_EXTRA_CA_CERTS, process.env.NODE_EXTRA_CA_CERTS);
      return { status: 0, stdout: '{"success":true}\n200', stderr: '' };
    } });
  assert.throws(() => curlRequest('https://fixture.example', { method: 'DELETE' }));
  assert.throws(() => curlRequest('https://fixture.example', { token: CF_TOKEN + '\nX-Injected: true' }));
});
