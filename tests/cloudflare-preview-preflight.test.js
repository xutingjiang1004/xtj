'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { curlRequest, preflight } = require('../scripts/cloudflare-preview-preflight');
const { PREVIEW_TARGET, resolvePreviewAccountId } = require('../cloudflare/preview-target');

const accountId = 'a'.repeat(32);
const token = 'cfat_fixture:secret_never_print/==';
const project = { name: 'xtj-preview', subdomain: 'xtj-preview.pages.dev',
  production_branch: 'preview-production-unused', canonical_deployment: null,
  domains: ['xtj-preview.pages.dev'] };
const reply = result => ({ status: 200, failure: null, data: { success: true, result } });
const preview = { status: 200, failure: null, data: { supabase_url: 'https://fixture.supabase.co', supabase_anon_key: null } };

test('the verified preview account handles placeholders without changing identities or exposing values', () => {
  for (const value of [undefined, '', token, 'managed-reference:fixture']) {
    assert.equal(resolvePreviewAccountId(undefined, value), PREVIEW_TARGET.accountId);
  }
  assert.equal(resolvePreviewAccountId(undefined, PREVIEW_TARGET.accountId), PREVIEW_TARGET.accountId);
  assert.throws(() => resolvePreviewAccountId(token), { code: 'unexpected_preview_account' });
  assert.throws(() => resolvePreviewAccountId(undefined, accountId), { code: 'unexpected_preview_account' });
});

test('invalid account IDs stop before building any URL or sending a credential', async () => {
  for (const value of [token, '', 'a'.repeat(31), 'g'.repeat(32), 'a'.repeat(32) + '/tokens']) {
    const result = await preflight({ accountId: value, token, request() { assert.fail('network request with invalid account ID'); } });
    assert.equal(result.exit_code, 2);
    assert.equal(JSON.stringify(result).includes(token), false);
  }
});

test('missing credentials and header injection stop before any request', async () => {
  for (const value of ['', '   ', token + '\r\nX-Leak: true', token + '\0', 'x'.repeat(16385)]) {
    const result = await preflight({ accountId, token: value, request() { assert.fail('unsafe credential was sent'); } });
    assert.equal(result.exit_code, 2);
    assert.equal(result.checks[1].code, 'missing_or_unsafe_token_header');
  }
});

test('curl honors the configured proxy and keeps credentials out of argv and diagnostics', () => {
  const result = curlRequest('https://api.cloudflare.com/client/v4/test', { token, spawn(command, args, options) {
    assert.equal(command, 'curl');
    assert.ok(args.includes('--disable'));
    assert.equal(args.some(arg => arg.includes(token)), false);
    assert.ok(options.input.includes(token));
    assert.equal(options.env.CLOUDFLARE_API_TOKEN, undefined);
    assert.equal(options.env.HTTPS_PROXY, process.env.HTTPS_PROXY);
    return { status: 56, stdout: '\n000', stderr: 'curl: (56) CONNECT tunnel failed, response 403' };
  } });
  assert.deepEqual(result, { status: 0, data: null, failure: 'proxy_connect_denied' });
  const site403 = curlRequest('https://migration-preview.xtj-preview.pages.dev/', { spawn() {
    return { status: 0, stdout: '<html>Forbidden</html>\n403', stderr: '' };
  } });
  assert.equal(site403.status, 403);
  assert.equal(site403.failure, null);
});

test('an account token does not need user-token verification; preview requests never carry it', async () => {
  const requests = [];
  const result = await preflight({ accountId, token, request(url, options) {
    requests.push(url);
    if (url.endsWith('/tokens/verify')) { assert.ok(url.includes('/accounts/' + accountId)); return reply({ status: 'active' }); }
    if (url.endsWith('/pages/projects/xtj-preview')) { assert.equal(options.token, token); return reply(project); }
    assert.deepEqual(options, {});
    return preview;
  } });
  assert.equal(result.ok, true);
  assert.equal(requests.length, 3);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.deepEqual(result.missing_local_backend_bindings, ['API_SECRET', 'SUPABASE_SERVICE_KEY', 'ENCRYPTION_KEY']);
});

test('user tokens remain supported without treating account-scope 401 as a bad token', async () => {
  const result = await preflight({ accountId, token, request(url) {
    if (url.includes('/accounts/') && url.endsWith('/tokens/verify')) return { status: 401, data: { errors: [{ message: token }] } };
    if (url.endsWith('/user/tokens/verify')) return reply({ status: 'active' });
    if (url.endsWith('/pages/projects/xtj-preview')) return reply(project);
    return preview;
  } });
  assert.equal(result.ok, true);
  assert.equal(result.checks[1].code, 'user_token_active');
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('proxy rejection reports the exact host and never echoes provider errors or public keys', async () => {
  const result = await preflight({ accountId, token, request(url) {
    if (url.endsWith('/tokens/verify')) return reply({ status: 'active' });
    if (url.endsWith('/pages/projects/xtj-preview')) return reply(project);
    return { status: 0, data: { error: token }, failure: 'proxy_connect_denied' };
  } });
  assert.equal(result.exit_code, 5);
  assert.equal(result.required_network_host, 'migration-preview.xtj-preview.pages.dev');
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('custom domains, a live production deployment and wrong branches fail closed before visiting the site', async () => {
  for (const changed of [{ domains: [...project.domains, 'xtj.example'] }, { canonical_deployment: { id: 'live' } },
    { production_deployment: { id: 'live' } }, { production_branch: 'migration-preview' }, { subdomain: 'other.pages.dev' }]) {
    const result = await preflight({ accountId, token, request(url) {
      if (url.endsWith('/tokens/verify')) return reply({ status: 'active' });
      assert.ok(url.endsWith('/pages/projects/xtj-preview'), 'must not visit site after failed isolation checks');
      return reply({ ...project, ...changed });
    } });
    assert.equal(result.exit_code, 4);
  }
});

test('network exceptions and provider error bodies never escape into the public report', async () => {
  for (const request of [() => { throw Error(token); }, () => ({ status: 403, data: { errors: [{ message: token }] } })]) {
    const result = await preflight({ accountId, token, request });
    assert.equal(result.exit_code, 3);
    assert.equal(JSON.stringify(result).includes(token), false);
  }
});
