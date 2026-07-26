'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const registerCodeGithubRoutes = require('../render-api/code-github');

function createApp(options) {
  options = options || {};
  var app = express();
  registerCodeGithubRoutes(app, {
    env: options.env || {
      GITHUB_TOKEN: 'server-only-token',
      GITHUB_ALLOWED_REPOS: 'xutingjiang1004/xtj'
    },
    timeoutMs: options.timeoutMs || 50,
    fetch: options.fetch || (async function() {
      return { ok: true, status: 200, json: async function() { return {}; } };
    }),
    authenticateUser: options.authenticateUser || function(req, res, next) {
      if (req.get('Authorization') !== 'Bearer user-token') {
        return res.status(401).json({ ok: false, code: 'user_auth_required' });
      }
      req.userName = 'tester';
      next();
    }
  });
  return app;
}

function authGet(app, url) {
  return request(app).get(url).set('Authorization', 'Bearer user-token');
}

test('all routes require site user authentication', async function() {
  var app = createApp();
  var response = await request(app).get('/api/code/github/repos/xutingjiang1004/xtj');
  assert.equal(response.status, 401);
  assert.equal(response.body.code, 'user_auth_required');
});

test('missing server token fails without calling GitHub', async function() {
  var called = false;
  var app = createApp({
    env: { GITHUB_TOKEN: '', GITHUB_ALLOWED_REPOS: 'xutingjiang1004/xtj' },
    fetch: async function() { called = true; }
  });
  var response = await authGet(app, '/api/code/github/repos/xutingjiang1004/xtj');
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'github_not_configured');
  assert.equal(called, false);
});

test('repo allowlist is exact and case insensitive', async function() {
  var called = false;
  var app = createApp({
    env: {
      GITHUB_TOKEN: 'token',
      GITHUB_ALLOWED_REPOS: ' XUTINGJIANG1004/XTJ,other/repo '
    },
    fetch: async function(url) {
      called = true;
      return {
        ok: true,
        status: 200,
        json: async function() {
          return { full_name: 'xutingjiang1004/xtj', private: true, default_branch: 'main' };
        }
      };
    }
  });

  var allowed = await authGet(app, '/api/code/github/repos/xutingjiang1004/xtj');
  assert.equal(allowed.status, 200);
  assert.equal(called, true);

  called = false;
  var denied = await authGet(app, '/api/code/github/repo?repo=xutingjiang1004/xtj-malicious');
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'github_repo_not_allowed');
  assert.equal(called, false);
});

test('strictly validates repo, ref and path before upstream request', async function() {
  var called = false;
  var app = createApp({ fetch: async function() { called = true; } });
  var cases = [
    ['/api/code/github/repo?repo=xutingjiang1004%2Fxtj%2Fevil', 'invalid_repo'],
    ['/api/code/github/tree?repo=xutingjiang1004/xtj&ref=../main', 'invalid_ref'],
    ['/api/code/github/file?repo=xutingjiang1004/xtj&ref=main&path=../secret', 'invalid_path'],
    ['/api/code/github/file?repo=xutingjiang1004/xtj&ref=main&path=/etc/passwd', 'invalid_path']
  ];
  for (var i = 0; i < cases.length; i++) {
    var response = await authGet(app, cases[i][0]);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, cases[i][1]);
  }
  assert.equal(called, false);
});

test('file endpoint encodes each path segment and returns base64 metadata', async function() {
  var seenUrl = '';
  var seenHeaders = null;
  var app = createApp({
    fetch: async function(url, options) {
      seenUrl = url;
      seenHeaders = options.headers;
      return {
        ok: true,
        status: 200,
        json: async function() {
          return {
            type: 'file',
            name: '行程 表.md',
            sha: 'abc123',
            size: 12,
            encoding: 'base64',
            content: '5peF56iL\n'
          };
        }
      };
    }
  });

  var url = '/api/code/github/repos/xutingjiang1004/xtj/file?ref=xtj-hotfix&path=' +
    encodeURIComponent('docs/上海 行程/行程 表.md');
  var response = await authGet(app, url);
  assert.equal(response.status, 200);
  assert.match(seenUrl, /\/contents\/docs\/%E4%B8%8A%E6%B5%B7%20%E8%A1%8C%E7%A8%8B\/%E8%A1%8C%E7%A8%8B%20%E8%A1%A8\.md\?ref=xtj-hotfix$/);
  assert.equal(seenHeaders.Authorization, 'Bearer server-only-token');
  assert.equal(response.body.content, '5peF56iL');
  assert.equal(response.body.sha, 'abc123');
  assert.equal(response.body.size, 12);
  assert.equal(response.body.mimeType, 'text/markdown; charset=utf-8');
});

test('branches and recursive tree responses are normalized', async function() {
  var responses = [
    [
      { name: 'main', protected: true, commit: { sha: 'main-sha' } },
      { name: 'xtj-hotfix', protected: false, commit: { sha: 'hotfix-sha' } }
    ],
    {
      truncated: false,
      tree: [
        { path: 'src', type: 'tree', sha: 'dir-sha' },
        { path: 'src/app.js', type: 'blob', sha: 'file-sha', size: 10 }
      ]
    }
  ];
  var app = createApp({
    fetch: async function() {
      var body = responses.shift();
      return { ok: true, status: 200, json: async function() { return body; } };
    }
  });

  var branches = await authGet(app, '/api/code/github/repos/xutingjiang1004/xtj/branches');
  assert.equal(branches.status, 200);
  assert.deepEqual(branches.body.branches.map(function(item) { return item.name; }), ['main', 'xtj-hotfix']);

  var tree = await authGet(app, '/api/code/github/repos/xutingjiang1004/xtj/tree?ref=xtj-hotfix');
  assert.equal(tree.status, 200);
  assert.deepEqual(tree.body.tree.map(function(item) { return item.type; }), ['tree', 'blob']);
});

test('large GitHub files fall back from Contents API metadata to Git Blobs API', async function() {
  var calls = [];
  var sha = 'a'.repeat(40);
  var app = createApp({
    fetch: async function(url) {
      calls.push(url);
      if (url.includes('/contents/')) {
        return {
          ok: true,
          status: 200,
          json: async function() {
            return { type: 'file', name: 'guide.docx', sha: sha, size: 2 * 1024 * 1024, encoding: 'none', content: '' };
          }
        };
      }
      return {
        ok: true,
        status: 200,
        json: async function() {
          return { sha: sha, size: 2 * 1024 * 1024, encoding: 'base64', content: 'UEsDBA==' };
        }
      };
    }
  });
  var response = await authGet(
    app,
    '/api/code/github/repos/xutingjiang1004/xtj/file?ref=xtj-hotfix&path=docs%2Fguide.docx'
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.content, 'UEsDBA==');
  assert.equal(response.body.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(calls.length, 2);
  assert.match(calls[1], new RegExp('/git/blobs/' + sha + '$'));
});

test('rejects oversized files and incomplete recursive trees truthfully', async function() {
  var oversizedApp = createApp({
    fetch: async function() {
      return {
        ok: true,
        status: 200,
        json: async function() {
          return { type: 'file', name: 'huge.pdf', sha: 'b'.repeat(40), size: 21 * 1024 * 1024, encoding: 'none', content: '' };
        }
      };
    }
  });
  var oversized = await authGet(
    oversizedApp,
    '/api/code/github/repos/xutingjiang1004/xtj/file?ref=xtj-hotfix&path=huge.pdf'
  );
  assert.equal(oversized.status, 413);
  assert.equal(oversized.body.code, 'github_file_too_large');

  var truncatedApp = createApp({
    fetch: async function() {
      return {
        ok: true,
        status: 200,
        json: async function() { return { truncated: true, tree: [] }; }
      };
    }
  });
  var truncated = await authGet(
    truncatedApp,
    '/api/code/github/repos/xutingjiang1004/xtj/tree?ref=xtj-hotfix'
  );
  assert.equal(truncated.status, 409);
  assert.equal(truncated.body.code, 'github_tree_truncated');
});

test('maps known GitHub statuses without exposing upstream response bodies', async function() {
  var statuses = [401, 403, 404, 409, 422];
  var expectedCodes = [
    'github_token_invalid',
    'github_forbidden',
    'github_not_found',
    'github_conflict',
    'github_unprocessable'
  ];
  for (var i = 0; i < statuses.length; i++) {
    var status = statuses[i];
    var app = createApp({
      fetch: async function() {
        return {
          ok: false,
          status: status,
          json: async function() { return { message: 'secret upstream detail' }; }
        };
      }
    });
    var response = await authGet(app, '/api/code/github/repos/xutingjiang1004/xtj');
    assert.equal(response.status, status);
    assert.equal(response.body.code, expectedCodes[i]);
    assert.doesNotMatch(JSON.stringify(response.body), /secret upstream detail/);
  }
});

test('maps network errors and timeouts separately', async function() {
  var networkApp = createApp({
    fetch: async function() { throw new Error('socket failed with token'); }
  });
  var network = await authGet(networkApp, '/api/code/github/repos/xutingjiang1004/xtj');
  assert.equal(network.status, 502);
  assert.equal(network.body.code, 'github_network_error');

  var timeoutApp = createApp({
    timeoutMs: 10,
    fetch: function(url, options) {
      return new Promise(function(resolve, reject) {
        options.signal.addEventListener('abort', function() {
          var error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }
  });
  var timeout = await authGet(timeoutApp, '/api/code/github/repos/xutingjiang1004/xtj');
  assert.equal(timeout.status, 504);
  assert.equal(timeout.body.code, 'github_timeout');
});

test('times out while decoding a hanging GitHub response body', async function() {
  var app = createApp({
    timeoutMs: 10,
    fetch: async function() {
      return {
        ok: true,
        status: 200,
        json: function() { return new Promise(function() {}); }
      };
    }
  });
  var response = await authGet(app, '/api/code/github/repos/xutingjiang1004/xtj');
  assert.equal(response.status, 504);
  assert.equal(response.body.code, 'github_timeout');
});
