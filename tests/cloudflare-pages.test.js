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
  const backendPaths = ['/api', '/api/uploads/media', '/admin/login', '/admin/users', '/health', '/health/mail', '/share', '/share/example'];
  const matches = (route, pathname) => route.endsWith('/*') ? pathname === route.slice(0, -2) || pathname.startsWith(route.slice(0, -1)) : pathname === route;
  const isBackendPath = pathname => routes.include.some(route => matches(route, pathname)) && !routes.exclude.some(route => matches(route, pathname));
  for (const pathname of backendPaths) assert.equal(isBackendPath(pathname), true, pathname + ' must return the explicit migration 503');
  for (const pathname of ['/', '/admin', '/admin.html', '/js/admin/admin.min.js', '/missing']) assert.equal(isBackendPath(pathname), false, pathname + ' must remain a static path');
  assert.deepEqual(routes.exclude, ['/admin', '/admin.html']);
  const workerSource = fs.readFileSync(path.join(out, '_worker.js'), 'utf8');
  const worker = (await import('data:text/javascript;base64,' + Buffer.from(workerSource).toString('base64'))).default;
  for (const pathname of backendPaths) for (const method of ['GET', 'POST', 'HEAD']) {
    const response = await worker.fetch(new Request('https://preview.example' + pathname, {method}));
    assert.equal(response.status, 503);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.ok(response.headers.get('Content-Security-Policy'));
    if (method === 'HEAD') assert.equal(await response.text(), '');
    else assert.equal((await response.json()).code, 'preview_backend_unavailable');
  }
});
