'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPages, allowed } = require('../scripts/build-pages');

test('Pages artifact excludes backend, credentials, metadata and preserves frontend bytes', async () => {
  for (const file of ['.env', 'render-api/server.js', 'supabase/key.json', 'package.json', 'js/.env.js', 'docs/secret.js', 'js/source.js.map', 'css/ai-workbench.min.css', 'js/ai-core/tool-workbench.min.js']) assert.equal(allowed(file), false, file);
  const { out, files } = buildPages();
  for (const file of files) assert.deepEqual(fs.readFileSync(path.join(out, file)), fs.readFileSync(path.resolve(__dirname, '..', file)), file);
  for (const file of ['render-api', 'supabase', '.env', 'package.json', '.git']) assert.equal(fs.existsSync(path.join(out, file)), false);
  // Every local entrypoint script/style/icon reference must resolve in the artifact.
  for (const html of ['index.html', 'admin.html']) {
    const text = fs.readFileSync(path.join(out, html), 'utf8');
    for (const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const url = match[1].split('?')[0];
      if (!/^(?:js\/|css\/|icon\.svg$)/.test(url)) continue;
      assert.equal(fs.existsSync(path.join(out, url)), true, html + ': ' + url);
    }
  }
  assert.ok(fs.existsSync(path.join(out, '404.html')));
  assert.match(fs.readFileSync(path.join(out, '_headers'), 'utf8'), /Content-Security-Policy:/);
  const routes = JSON.parse(fs.readFileSync(path.join(out, '_routes.json')));
  assert.ok(routes.include.includes('/share/*'));
  const workerSource = fs.readFileSync(path.join(out, '_worker.js'), 'utf8');
  const worker = (await import('data:text/javascript;base64,' + Buffer.from(workerSource).toString('base64'))).default;
  for (const method of ['GET', 'POST', 'HEAD']) {
    const response = await worker.fetch(new Request('https://preview.example/api/uploads/media?path=private.jpg', {method}));
    assert.equal(response.status, 503);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.ok(response.headers.get('Content-Security-Policy'));
    if (method === 'HEAD') assert.equal(await response.text(), '');
    else assert.equal((await response.json()).code, 'preview_backend_unavailable');
  }
});
