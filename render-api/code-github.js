'use strict';

// Read-only GitHub proxy for the Code workspace.
// The server-side token is never returned to the browser.

const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const REPO_PART_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9_.-])?$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const GIT_OBJECT_SHA_RE = /^[a-f0-9]{40,64}$/i;

function parseAllowedRepos(raw) {
  return new Set(String(raw || '')
    .split(/[\s,]+/)
    .map(function(item) { return item.trim().toLowerCase(); })
    .filter(Boolean));
}

function parseRepo(value) {
  var parts = String(value || '').trim().split('/');
  if (parts.length !== 2 || !REPO_PART_RE.test(parts[0]) || !REPO_PART_RE.test(parts[1])) {
    return null;
  }
  if (parts[0] === '.' || parts[0] === '..' || parts[1] === '.' || parts[1] === '..') {
    return null;
  }
  return { owner: parts[0], repo: parts[1], fullName: parts[0] + '/' + parts[1] };
}

function validateRef(value, required) {
  var ref = String(value || '').trim();
  if (!ref) return required ? null : '';
  if (!REF_RE.test(ref) || ref.indexOf('..') >= 0 || ref.indexOf('//') >= 0 || ref.endsWith('/')) {
    return null;
  }
  return ref;
}

function validatePath(value, required) {
  var filePath = String(value || '').trim();
  if (!filePath) return required ? null : '';
  if (filePath.length > 1000 || filePath.startsWith('/') || filePath.endsWith('/') ||
      filePath.indexOf('\\') >= 0 || /[\u0000-\u001f\u007f]/.test(filePath)) {
    return null;
  }
  var segments = filePath.split('/');
  if (segments.some(function(segment) { return !segment || segment === '.' || segment === '..'; })) {
    return null;
  }
  return segments.join('/');
}

function encodeRepoPath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

function mimeForFile(filePath) {
  var ext = path.extname(filePath || '').toLowerCase();
  var types = {
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.cjs': 'text/javascript; charset=utf-8',
    '.ts': 'text/typescript; charset=utf-8',
    '.tsx': 'text/typescript; charset=utf-8',
    '.jsx': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.yaml': 'application/yaml; charset=utf-8',
    '.yml': 'application/yaml; charset=utf-8',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  };
  return types[ext] || 'application/octet-stream';
}

function upstreamError(status) {
  var errors = {
    401: { code: 'github_token_invalid', message: 'GitHub 服务凭据无效' },
    403: { code: 'github_forbidden', message: 'GitHub 拒绝访问该资源' },
    404: { code: 'github_not_found', message: 'GitHub 资源不存在' },
    409: { code: 'github_conflict', message: 'GitHub 仓库当前不可读取' },
    422: { code: 'github_unprocessable', message: 'GitHub 无法处理该请求' }
  };
  return errors[status] || { code: 'github_upstream_error', message: 'GitHub 服务返回错误' };
}

module.exports = function registerCodeGithubRoutes(app, deps) {
  deps = deps || {};
  var authenticateUser = deps.authenticateUser;
  if (typeof authenticateUser !== 'function') {
    throw new Error('registerCodeGithubRoutes requires authenticateUser');
  }

  var env = deps.env || process.env;
  var fetchImpl = deps.fetch || global.fetch;
  var timeoutMs = Number(deps.timeoutMs) > 0 ? Number(deps.timeoutMs) : DEFAULT_TIMEOUT_MS;

  function prepareRequest(req, res, options) {
    var token = String(env.GITHUB_TOKEN || '').trim();
    if (!token) {
      res.status(503).json({ ok: false, code: 'github_not_configured', error: 'GitHub 私库连接尚未配置' });
      return null;
    }
    if (typeof fetchImpl !== 'function') {
      res.status(503).json({ ok: false, code: 'github_fetch_unavailable', error: 'GitHub 连接不可用' });
      return null;
    }

    var routeRepo = req.params && req.params.owner && req.params.repo
      ? req.params.owner + '/' + req.params.repo
      : req.query && req.query.repo;
    var parsedRepo = parseRepo(routeRepo);
    if (!parsedRepo) {
      res.status(400).json({ ok: false, code: 'invalid_repo', error: '仓库名称格式无效' });
      return null;
    }

    var allowed = parseAllowedRepos(env.GITHUB_ALLOWED_REPOS);
    if (!allowed.has(parsedRepo.fullName.toLowerCase())) {
      res.status(403).json({ ok: false, code: 'github_repo_not_allowed', error: '该仓库不在允许列表中' });
      return null;
    }

    var ref = validateRef(req.query && req.query.ref, options.requireRef === true);
    if (ref === null) {
      res.status(400).json({ ok: false, code: 'invalid_ref', error: 'Git 引用格式无效' });
      return null;
    }

    var repoPath = validatePath(req.query && req.query.path, options.requirePath === true);
    if (repoPath === null) {
      res.status(400).json({ ok: false, code: 'invalid_path', error: '仓库路径格式无效' });
      return null;
    }

    return { token: token, repo: parsedRepo, ref: ref, path: repoPath };
  }

  async function githubJson(req, url, token) {
    var controller = new AbortController();
    var timedOut = false;
    var timer = setTimeout(function() {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    var abortFromClient = function() { controller.abort(); };
    req.once('aborted', abortFromClient);

    try {
      var response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token,
          'User-Agent': 'xtj-code-workspace',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        signal: controller.signal
      });

      var data = null;
      try { data = await response.json(); } catch (_) {}
      if (!response.ok) {
        var mapped = upstreamError(response.status);
        return { ok: false, status: response.status, code: mapped.code, error: mapped.message };
      }
      return { ok: true, data: data };
    } catch (error) {
      if (timedOut) {
        return { ok: false, status: 504, code: 'github_timeout', error: 'GitHub 请求超时' };
      }
      if (error && error.name === 'AbortError' && req.aborted) {
        return { ok: false, aborted: true };
      }
      return { ok: false, status: 502, code: 'github_network_error', error: '无法连接 GitHub' };
    } finally {
      clearTimeout(timer);
      req.removeListener('aborted', abortFromClient);
    }
  }

  async function handle(req, res, options, buildUrl, normalize) {
    var context = prepareRequest(req, res, options);
    if (!context) return;

    var result = await githubJson(req, buildUrl(context), context.token);
    if (result.aborted || res.writableEnded) return;
    if (!result.ok) {
      return res.status(result.status).json({ ok: false, code: result.code, error: result.error });
    }

    try {
      return res.json(normalize(result.data, context));
    } catch (error) {
      if (error && error.code === 'github_tree_truncated') {
        return res.status(409).json({
          ok: false,
          code: 'github_tree_truncated',
          error: 'GitHub 返回的仓库树不完整，请缩小读取范围'
        });
      }
      return res.status(502).json({
        ok: false,
        code: 'github_invalid_response',
        error: 'GitHub 返回了无法识别的数据'
      });
    }
  }

  function repoHandler(req, res) {
    return handle(req, res, {}, function(ctx) {
      return 'https://api.github.com/repos/' + encodeURIComponent(ctx.repo.owner) + '/' + encodeURIComponent(ctx.repo.repo);
    }, function(data) {
      return {
        ok: true,
        repo: {
          full_name: data.full_name,
          private: data.private === true,
          default_branch: data.default_branch || '',
          description: data.description || '',
          updated_at: data.updated_at || null,
          permissions: data.permissions || null
        }
      };
    });
  }
  app.get('/api/code/github/repo', authenticateUser, repoHandler);
  app.get('/api/code/github/repos/:owner/:repo', authenticateUser, repoHandler);

  function branchesHandler(req, res) {
    return handle(req, res, {}, function(ctx) {
      return 'https://api.github.com/repos/' + encodeURIComponent(ctx.repo.owner) + '/' +
        encodeURIComponent(ctx.repo.repo) + '/branches?per_page=100';
    }, function(data) {
      if (!Array.isArray(data)) throw new Error('invalid branches');
      return {
        ok: true,
        branches: data.map(function(branch) {
          return {
            name: branch.name,
            sha: branch.commit && branch.commit.sha || '',
            protected: branch.protected === true
          };
        })
      };
    });
  }
  app.get('/api/code/github/branches', authenticateUser, branchesHandler);
  app.get('/api/code/github/repos/:owner/:repo/branches', authenticateUser, branchesHandler);

  function treeHandler(req, res) {
    return handle(req, res, { requireRef: true }, function(ctx) {
      var base = 'https://api.github.com/repos/' + encodeURIComponent(ctx.repo.owner) + '/' +
        encodeURIComponent(ctx.repo.repo);
      if (ctx.path) {
        return base + '/contents/' + encodeRepoPath(ctx.path) + '?ref=' + encodeURIComponent(ctx.ref);
      }
      return base + '/git/trees/' + encodeURIComponent(ctx.ref) + '?recursive=1';
    }, function(data, ctx) {
      var entries = Array.isArray(data) ? data : data.tree;
      if (!Array.isArray(entries)) throw new Error('invalid tree');
      if (data && data.truncated === true) {
        var truncatedError = new Error('truncated tree');
        truncatedError.code = 'github_tree_truncated';
        throw truncatedError;
      }
      return {
        ok: true,
        repo: ctx.repo.fullName,
        ref: ctx.ref,
        path: ctx.path,
        truncated: data && data.truncated === true,
        tree: entries.map(function(entry) {
          return {
            path: entry.path || entry.name || '',
            name: entry.name || String(entry.path || '').split('/').pop(),
            type: entry.type === 'tree' || entry.type === 'dir' ? 'tree' : 'blob',
            sha: entry.sha || '',
            size: Number(entry.size) || 0,
            mode: entry.mode || '',
            url: entry.url || ''
          };
        })
      };
    });
  }
  app.get('/api/code/github/tree', authenticateUser, treeHandler);
  app.get('/api/code/github/repos/:owner/:repo/tree', authenticateUser, treeHandler);

  function sendGithubFailure(res, result) {
    if (result.aborted || res.writableEnded) return;
    return res.status(result.status).json({ ok: false, code: result.code, error: result.error });
  }

  function normalizeFile(data, ctx, metadata) {
    metadata = metadata || data;
    if (!data || Array.isArray(data) || data.encoding !== 'base64' || typeof data.content !== 'string') {
      return null;
    }
    var size = Number(metadata.size);
    if (!Number.isFinite(size) || size < 0) size = Math.floor(data.content.replace(/\s+/g, '').length * 3 / 4);
    if (size > MAX_FILE_BYTES) return { tooLarge: true, size: size };
    return {
      ok: true,
      repo: ctx.repo.fullName,
      ref: ctx.ref,
      path: ctx.path,
      name: metadata.name || ctx.path.split('/').pop(),
      sha: metadata.sha || data.sha || '',
      size: size,
      mimeType: mimeForFile(ctx.path),
      encoding: 'base64',
      content: data.content.replace(/\s+/g, '')
    };
  }

  async function fileHandler(req, res) {
    var ctx = prepareRequest(req, res, { requireRef: true, requirePath: true });
    if (!ctx) return;
    var base = 'https://api.github.com/repos/' + encodeURIComponent(ctx.repo.owner) + '/' +
      encodeURIComponent(ctx.repo.repo);
    var contentsUrl = base + '/contents/' + encodeRepoPath(ctx.path) + '?ref=' + encodeURIComponent(ctx.ref);
    var metadataResult = await githubJson(req, contentsUrl, ctx.token);
    if (!metadataResult.ok) return sendGithubFailure(res, metadataResult);

    var metadata = metadataResult.data;
    if (!metadata || Array.isArray(metadata) || metadata.type !== 'file') {
      return res.status(502).json({ ok: false, code: 'github_invalid_response', error: 'GitHub 返回了无法识别的文件数据' });
    }
    if (Number(metadata.size) > MAX_FILE_BYTES) {
      return res.status(413).json({ ok: false, code: 'github_file_too_large', error: 'GitHub 文件超过 20MB 读取上限' });
    }

    var normalized = normalizeFile(metadata, ctx, metadata);
    if (!normalized) {
      if (!GIT_OBJECT_SHA_RE.test(String(metadata.sha || ''))) {
        return res.status(502).json({ ok: false, code: 'github_invalid_response', error: 'GitHub 文件内容不可用' });
      }
      // The Contents API omits inline base64 for files larger than 1 MB.
      // Fall back to the Git Blobs API while keeping the token server-side.
      var blobUrl = base + '/git/blobs/' + encodeURIComponent(metadata.sha);
      var blobResult = await githubJson(req, blobUrl, ctx.token);
      if (!blobResult.ok) return sendGithubFailure(res, blobResult);
      normalized = normalizeFile(blobResult.data, ctx, metadata);
    }
    if (normalized && normalized.tooLarge) {
      return res.status(413).json({ ok: false, code: 'github_file_too_large', error: 'GitHub 文件超过 20MB 读取上限' });
    }
    if (!normalized) {
      return res.status(502).json({ ok: false, code: 'github_invalid_response', error: 'GitHub 文件内容不可用' });
    }
    return res.json(normalized);
  }
  app.get('/api/code/github/file', authenticateUser, fileHandler);
  app.get('/api/code/github/repos/:owner/:repo/file', authenticateUser, fileHandler);
};

module.exports._test = {
  parseAllowedRepos: parseAllowedRepos,
  parseRepo: parseRepo,
  validateRef: validateRef,
  validatePath: validatePath,
  encodeRepoPath: encodeRepoPath,
  mimeForFile: mimeForFile
};
