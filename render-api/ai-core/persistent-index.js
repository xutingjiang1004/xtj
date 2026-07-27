// ==================== AI Core: Persistent Code Index ====================
// Persists code workspace metadata, file index, and code chunks to Supabase.
// Enables incremental index updates and recovery after Render restarts.
// Feature flag: CODE_PERSISTENT_INDEX_ENABLED
'use strict';

var crypto = require('crypto');

// ── Feature Flag ──────────────────────────────────────────────────────────

var PERSIST_ENABLED = false;

function isPersistEnabled() {
  if (PERSIST_ENABLED) return true;
  return String(process.env.CODE_PERSISTENT_INDEX_ENABLED || '0') === '1';
}

function setPersistEnabledForTests(enabled) {
  PERSIST_ENABLED = enabled;
}

// ── Workspace Key Generation ──────────────────────────────────────────────

function generateWorkspaceKey(userId, sourceType, identifier) {
  // Stable workspace key from user + source + identifier
  var parts = [
    String(userId || '').slice(0, 100),
    String(sourceType || 'local_folder').slice(0, 50),
    String(identifier || '').slice(0, 200)
  ];
  return parts.join(':');
}

// ── Workspace CRUD ────────────────────────────────────────────────────────

function upsertWorkspace(supabase, params) {
  if (!isPersistEnabled() || !supabase) return Promise.resolve(null);
  var workspaceKey = generateWorkspaceKey(params.userId, params.sourceType, params.identifier);
  return supabase.from('code_workspaces').select('id').eq('user_id', String(params.userId)).eq('workspace_key', workspaceKey).limit(1)
    .then(function(r) {
      if (r.error) return null;
      if (r.data && r.data.length > 0) {
        // Update existing
        return supabase.from('code_workspaces').update({
          workspace_name: String(params.workspaceName || '').slice(0, 200),
          generation: Number(params.generation || 0),
          index_status: String(params.indexStatus || 'ready'),
          last_opened_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq('id', r.data[0].id).then(function(u) {
          if (u.error) return null;
          return r.data[0];
        });
      }
      // Insert new
      return supabase.from('code_workspaces').insert({
        user_id: String(params.userId),
        workspace_key: workspaceKey,
        workspace_name: String(params.workspaceName || '').slice(0, 200),
        source_type: String(params.sourceType || 'local_folder'),
        repo_full_name: String(params.repoFullName || ''),
        git_ref: String(params.gitRef || ''),
        generation: Number(params.generation || 0),
        index_status: String(params.indexStatus || 'ready'),
        total_files: Number(params.totalFiles || 0),
        total_chunks: Number(params.totalChunks || 0),
        total_bytes: Number(params.totalBytes || 0),
        truncated: params.truncated === true
      }).select('id').then(function(ins) {
        if (ins.error) return null;
        return ins.data && ins.data[0] ? ins.data[0] : null;
      });
    }).catch(function(e) { console.error('[persistent-index] upsertWorkspace error:', e.message); return null; });
}

function getWorkspace(supabase, userId, workspaceKey) {
  if (!isPersistEnabled() || !supabase) return Promise.resolve(null);
  return supabase.from('code_workspaces').select('*')
    .eq('user_id', String(userId))
    .eq('workspace_key', String(workspaceKey))
    .limit(1)
    .then(function(r) {
      if (r.error) return null;
      return r.data && r.data[0] ? r.data[0] : null;
    }).catch(function() { return null; });
}

function getWorkspaceById(supabase, workspaceId) {
  if (!isPersistEnabled() || !supabase) return Promise.resolve(null);
  return supabase.from('code_workspaces').select('*')
    .eq('id', String(workspaceId))
    .limit(1)
    .then(function(r) {
      if (r.error) return null;
      return r.data && r.data[0] ? r.data[0] : null;
    }).catch(function() { return null; });
}

function updateWorkspaceStats(supabase, workspaceId, stats) {
  if (!isPersistEnabled() || !supabase) return Promise.resolve(null);
  var payload = { updated_at: new Date().toISOString() };
  if (stats.totalFiles !== undefined) payload.total_files = Number(stats.totalFiles);
  if (stats.totalChunks !== undefined) payload.total_chunks = Number(stats.totalChunks);
  if (stats.totalBytes !== undefined) payload.total_bytes = Number(stats.totalBytes);
  if (stats.indexStatus !== undefined) payload.index_status = String(stats.indexStatus);
  if (stats.generation !== undefined) payload.generation = Number(stats.generation);
  if (stats.truncated !== undefined) payload.truncated = stats.truncated === true;
  return supabase.from('code_workspaces').update(payload).eq('id', String(workspaceId))
    .then(function(r) { if (r.error) console.error('[persistent-index] updateStats error:', r.error.message); })
    .catch(function(e) { console.error('[persistent-index] updateStats error:', e.message); });
}

// ── File CRUD ─────────────────────────────────────────────────────────────

function upsertIndexFile(supabase, userId, workspaceId, file) {
  if (!isPersistEnabled() || !supabase) return Promise.resolve(null);
  var payload = {
    user_id: String(userId),
    workspace_id: String(workspaceId),
    path: String(file.path || '').slice(0, 500),
    name: String(file.name || '').slice(0, 255),
    language: String(file.language || '').slice(0, 50),
    size_bytes: Number(file.sizeBytes || file.size || 0),
    modified_at: file.modifiedAt != null ? Number(file.modifiedAt) : null,
    sha256: String(file.sha256 || '').slice(0, 64),
    content_hash: String(file.contentHash || '').slice(0, 64),
    index_status: 'active',
    updated_at: new Date().toISOString()
  };
  return supabase.from('code_index_files').upsert(payload, {
    onConflict: 'workspace_id, path',
    ignoreDuplicates: false
  }).select('id').then(function(r) {
    if (r.error) { console.error('[persistent-index] upsertFile error:', r.error.message); return null; }
    return r.data && r.data[0] ? r.data[0] : null;
  }).catch(function(e) { console.error('[persistent-index] upsertFile error:', e.message); return null; });
}

function getIndexFiles(supabase, workspaceId) {
  if (!isPersistEnabled() || !supabase) return Promise.resolve([]);
  return supabase.from('code_index_files').select('*')
    .eq('workspace_id', String(workspaceId))
    .eq('index_status', 'active')
    .then(function(r) {
      if (r.error) return [];
      return (r.data || []).map(function(row) {
        return {
          id: row.id,
          path: row.path,
          name: row.name,
          language: row.language,
          size: row.size_bytes,
          modifiedAt: row.modified_at,
          sha256: row.sha256,
          contentHash: row.content_hash
        };
      });
    }).catch(function() { return []; });
}

function deleteIndexFile(supabase, workspaceId, path) {
  if (!isPersistEnabled() || !supabase) return Promise.resolve();
  // Find file first, then delete chunks, then mark file as deleted
  return supabase.from('code_index_files').select('id').eq('workspace_id', String(workspaceId)).eq('path', String(path)).limit(1)
    .then(function(r) {
      if (r.error || !r.data || !r.data[0]) return;
      var fileId = r.data[0].id;
      return supabase.from('code_index_chunks').delete().eq('file_id', fileId).then(function() {
        return supabase.from('code_index_files').update({
          index_status: 'deleted',
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq('id', fileId);
      });
    }).catch(function(e) { console.error('[persistent-index] deleteFile error:', e.message); });
}

function deleteAllIndexFiles(supabase, workspaceId) {
  if (!isPersistEnabled() || !supabase) return Promise.resolve();
  return supabase.from('code_index_files').select('id').eq('workspace_id', String(workspaceId))
    .then(function(r) {
      if (r.error || !r.data) return;
      var fileIds = r.data.map(function(f) { return f.id; });
      // Delete chunks first
      return supabase.from('code_index_chunks').delete().in('file_id', fileIds).then(function() {
        return supabase.from('code_index_files').delete().eq('workspace_id', String(workspaceId));
      });
    }).catch(function(e) { console.error('[persistent-index] deleteAllFiles error:', e.message); });
}

// ── Chunk CRUD ────────────────────────────────────────────────────────────

function upsertChunks(supabase, userId, workspaceId, fileId, chunks) {
  if (!isPersistEnabled() || !supabase) return Promise.resolve();
  if (!Array.isArray(chunks) || chunks.length === 0) return Promise.resolve();

  // Delete old chunks for this file, then insert new ones
  return supabase.from('code_index_chunks').delete().eq('file_id', String(fileId))
    .then(function() {
      var rows = chunks.map(function(chunk) {
        return {
          user_id: String(userId),
          workspace_id: String(workspaceId),
          file_id: String(fileId),
          chunk_key: String(chunk.chunkKey || chunk.id || '').slice(0, 500),
          start_line: Number(chunk.startLine || 0),
          end_line: Number(chunk.endLine || 0),
          content: String(chunk.content || '').slice(0, 10000),
          token_estimate: Number(chunk.tokenEstimate || 0),
          content_hash: String(chunk.contentHash || '').slice(0, 64)
        };
      });
      // Batch insert in groups of 50
      var batchSize = 50;
      var insertBatch = function(index) {
        if (index >= rows.length) return Promise.resolve();
        var batch = rows.slice(index, index + batchSize);
        return supabase.from('code_index_chunks').upsert(batch, {
          onConflict: 'file_id, chunk_key',
          ignoreDuplicates: false
        }).then(function() { return insertBatch(index + batchSize); });
      };
      return insertBatch(0);
    }).catch(function(e) { console.error('[persistent-index] upsertChunks error:', e.message); });
}

function getChunksByFileId(supabase, fileId) {
  if (!isPersistEnabled() || !supabase) return Promise.resolve([]);
  return supabase.from('code_index_chunks').select('*')
    .eq('file_id', String(fileId))
    .order('start_line', { ascending: true })
    .then(function(r) {
      if (r.error) return [];
      return (r.data || []).map(function(row) {
        return {
          id: row.chunk_key,
          chunkKey: row.chunk_key,
          startLine: row.start_line,
          endLine: row.end_line,
          content: row.content,
          tokenEstimate: row.token_estimate,
          contentHash: row.content_hash
        };
      });
    }).catch(function() { return []; });
}

function getAllChunks(supabase, workspaceId) {
  if (!isPersistEnabled() || !supabase) return Promise.resolve([]);
  return supabase.from('code_index_chunks').select('*, code_index_files!inner(path, name, language, sha256)')
    .eq('workspace_id', String(workspaceId))
    .then(function(r) {
      if (r.error) return [];
      return (r.data || []).map(function(row) {
        var fileInfo = row.code_index_files || {};
        return {
          id: row.chunk_key,
          chunkKey: row.chunk_key,
          fileId: row.file_id,
          path: fileInfo.path || '',
          name: fileInfo.name || '',
          language: fileInfo.language || '',
          startLine: row.start_line,
          endLine: row.end_line,
          content: row.content,
          tokenEstimate: row.token_estimate,
          contentHash: row.content_hash,
          sha256: fileInfo.sha256 || ''
        };
      });
    }).catch(function() { return []; });
}

// ── Build Tracking ────────────────────────────────────────────────────────

function createBuild(supabase, userId, workspaceId, params) {
  if (!isPersistEnabled() || !supabase) return Promise.resolve(null);
  return supabase.from('code_index_builds').insert({
    user_id: String(userId),
    workspace_id: String(workspaceId),
    generation: Number(params.generation || 0),
    status: 'started',
    scan_count: Number(params.scanCount || 0),
    started_at: new Date().toISOString()
  }).select('id').then(function(r) {
    if (r.error) return null;
    return r.data && r.data[0] ? r.data[0] : null;
  }).catch(function() { return null; });
}

function updateBuild(supabase, buildId, updates) {
  if (!isPersistEnabled() || !supabase) return Promise.resolve();
  return supabase.from('code_index_builds').update(updates).eq('id', String(buildId))
    .then(function(r) { if (r.error) console.error('[persistent-index] updateBuild error:', r.error.message); })
    .catch(function(e) { console.error('[persistent-index] updateBuild error:', e.message); });
}

function completeBuild(supabase, buildId, stats) {
  if (!isPersistEnabled() || !supabase) return Promise.resolve();
  return supabase.from('code_index_builds').update({
    status: 'completed',
    uploaded_count: Number(stats.uploadedCount || 0),
    changed_count: Number(stats.changedCount || 0),
    deleted_count: Number(stats.deletedCount || 0),
    failed_count: Number(stats.failedCount || 0),
    completed_at: new Date().toISOString()
  }).eq('id', String(buildId))
    .then(function(r) { if (r.error) console.error('[persistent-index] completeBuild error:', r.error.message); })
    .catch(function(e) { console.error('[persistent-index] completeBuild error:', e.message); });
}

// ── Manifest Comparison ───────────────────────────────────────────────────

function compareManifest(supabase, workspaceId, manifestFiles) {
  // Compare client manifest with stored files, return upload/delete/unchanged lists
  if (!isPersistEnabled() || !supabase) return Promise.resolve({
    ok: true,
    uploadPaths: manifestFiles.map(function(f) { return f.path; }),
    unchangedPaths: [],
    deletePaths: [],
    rebuildRequired: false
  });

  return getIndexFiles(supabase, workspaceId).then(function(storedFiles) {
    var storedMap = {};
    for (var i = 0; i < storedFiles.length; i++) {
      storedMap[storedFiles[i].path] = storedFiles[i];
    }

    var manifestMap = {};
    for (var j = 0; j < manifestFiles.length; j++) {
      manifestMap[manifestFiles[j].path] = manifestFiles[j];
    }

    var uploadPaths = [];
    var unchangedPaths = [];
    var deletePaths = [];

    // Check manifest files against stored
    for (var k = 0; k < manifestFiles.length; k++) {
      var mf = manifestFiles[k];
      var stored = storedMap[mf.path];
      if (!stored) {
        // New file
        uploadPaths.push(mf.path);
      } else if (mf.sha256 && stored.sha256 && mf.sha256 === stored.sha256) {
        // SHA matches, unchanged
        unchangedPaths.push(mf.path);
      } else if (mf.size === stored.size && mf.modifiedAt === stored.modifiedAt) {
        // Size and mtime match, likely unchanged
        unchangedPaths.push(mf.path);
      } else {
        // Changed
        uploadPaths.push(mf.path);
      }
    }

    // Check stored files not in manifest (deleted)
    for (var d = 0; d < storedFiles.length; d++) {
      if (!manifestMap[storedFiles[d].path]) {
        deletePaths.push(storedFiles[d].path);
      }
    }

    return {
      ok: true,
      uploadPaths: uploadPaths,
      unchangedPaths: unchangedPaths,
      deletePaths: deletePaths,
      rebuildRequired: false
    };
  }).catch(function() {
    // On error, fall back to full upload
    return {
      ok: true,
      uploadPaths: manifestFiles.map(function(f) { return f.path; }),
      unchangedPaths: [],
      deletePaths: [],
      rebuildRequired: true
    };
  });
}

// ── Index Recovery (from DB to memory) ────────────────────────────────────

function recoverIndex(supabase, workspaceId) {
  if (!isPersistEnabled() || !supabase) return Promise.resolve(null);

  return Promise.all([
    getWorkspaceById(supabase, workspaceId),
    getIndexFiles(supabase, workspaceId),
    getAllChunks(supabase, workspaceId)
  ]).then(function(results) {
    var ws = results[0];
    var files = results[1];
    var chunks = results[2];

    if (!ws) return null;

    // Build file map
    var fileMap = new Map();
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      fileMap.set(f.path, {
        id: f.id,
        path: f.path,
        name: f.name,
        language: f.language,
        size: f.size || 0,
        sha256: f.sha256 || '',
        modifiedAt: f.modifiedAt || null,
        totalLines: 0,
        symbols: { functions: [], classes: [], exports: [], imports: [] },
        chunks: [],
        isPinned: false
      });
    }

    // Build chunk map and assign to files
    var chunkMap = new Map();
    var totalLines = 0;
    for (var c = 0; c < chunks.length; c++) {
      var chunk = chunks[c];
      var chunkId = chunk.id;
      chunkMap.set(chunkId, {
        id: chunkId,
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        content: chunk.content,
        tokenEstimate: chunk.tokenEstimate,
        language: chunk.language,
        sha256: chunk.sha256
      });

      var fileEntry = fileMap.get(chunk.path);
      if (fileEntry) {
        fileEntry.chunks.push(chunkId);
        if (chunk.endLine > fileEntry.totalLines) fileEntry.totalLines = chunk.endLine;
      }
    }

    return {
      userId: ws.user_id,
      workspaceId: workspaceId,
      generation: ws.generation,
      files: fileMap,
      chunks: chunkMap,
      totalFiles: fileMap.size,
      totalChunks: chunkMap.size,
      totalBytes: ws.total_bytes || 0,
      scannedFiles: ws.total_files || 0,
      indexedFiles: fileMap.size,
      skippedFiles: 0,
      failedFiles: 0,
      truncated: ws.truncated === true,
      status: ws.index_status || 'ready',
      builtAt: ws.updated_at || ws.created_at
    };
  }).catch(function(e) {
    console.error('[persistent-index] recoverIndex error:', e.message);
    return null;
  });
}

// ── Content Security ──────────────────────────────────────────────────────

var SENSITIVE_PATTERNS = [
  /-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY-----/i,
  /-----BEGIN\s+CERTIFICATE-----/i,
  /api[_-]?key\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i,
  /secret\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/i,
  /password\s*[:=]\s*['"][^'"]+['"]/i,
  /token\s*[:=]\s*['"][A-Za-z0-9_\-.]{20,}['"]/i,
  /sk-[A-Za-z0-9]{20,}/i,
  /ghp_[A-Za-z0-9]{20,}/i,
  /gho_[A-Za-z0-9]{20,}/i,
  /ghu_[A-Za-z0-9]{20,}/i,
  /ghs_[A-Za-z0-9]{20,}/i,
  /ghr_[A-Za-z0-9]{20,}/i
];

function isSensitiveContent(content) {
  if (!content || typeof content !== 'string') return false;
  for (var i = 0; i < SENSITIVE_PATTERNS.length; i++) {
    if (SENSITIVE_PATTERNS[i].test(content)) return true;
  }
  return false;
}

function isSensitivePath(path) {
  if (!path) return false;
  var name = path.split('/').pop().toLowerCase();
  var sensitiveNames = [
    '.env', '.env.local', '.env.production', '.env.development',
    'credentials.json', 'service-account.json', 'id_rsa', 'id_ed25519',
    '.npmrc', '.pypirc', 'config.json', 'secrets.json'
  ];
  return sensitiveNames.indexOf(name) !== -1;
}

// ── Default Ignore Rules ──────────────────────────────────────────────────

var DEFAULT_IGNORE_PATTERNS = [
  /(^|\/)\.git\//, /(^|\/)node_modules\//, /(^|\/)dist\//,
  /(^|\/)build\//, /(^|\/)coverage\//, /(^|\/)\.cache\//,
  /(^|\/)\.next\//, /(^|\/)\.tmp\//, /(^|\/)\.nuxt\//,
  /(^|\/)\.output\//, /(^|\/)__pycache__\//, /(^|\/)\.venv\//,
  /(^|\/)vendor\//, /(^|\/)bower_components\//
];

var DEFAULT_IGNORE_EXTENSIONS = [
  '.min.js', '.min.css', '.map', '.lock', '.sum',
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.avi', '.mov',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.wasm', '.bin'
];

function shouldIgnoreFile(path, size) {
  if (!path) return true;

  // Safety: always ignore sensitive paths
  if (isSensitivePath(path)) return true;

  // Check patterns
  for (var i = 0; i < DEFAULT_IGNORE_PATTERNS.length; i++) {
    if (DEFAULT_IGNORE_PATTERNS[i].test(path)) return true;
  }

  // Check extensions
  var ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  if (DEFAULT_IGNORE_EXTENSIONS.indexOf(ext) !== -1) return true;

  // Skip large binary files
  if (size > 2 * 1024 * 1024) return true;

  return false;
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  // Feature flag
  isPersistEnabled: isPersistEnabled,
  setPersistEnabledForTests: setPersistEnabledForTests,

  // Workspace
  generateWorkspaceKey: generateWorkspaceKey,
  upsertWorkspace: upsertWorkspace,
  getWorkspace: getWorkspace,
  getWorkspaceById: getWorkspaceById,
  updateWorkspaceStats: updateWorkspaceStats,

  // Files
  upsertIndexFile: upsertIndexFile,
  getIndexFiles: getIndexFiles,
  deleteIndexFile: deleteIndexFile,
  deleteAllIndexFiles: deleteAllIndexFiles,

  // Chunks
  upsertChunks: upsertChunks,
  getChunksByFileId: getChunksByFileId,
  getAllChunks: getAllChunks,

  // Builds
  createBuild: createBuild,
  updateBuild: updateBuild,
  completeBuild: completeBuild,

  // Manifest
  compareManifest: compareManifest,

  // Recovery
  recoverIndex: recoverIndex,

  // Security
  isSensitiveContent: isSensitiveContent,
  isSensitivePath: isSensitivePath,
  shouldIgnoreFile: shouldIgnoreFile
};