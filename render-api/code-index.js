'use strict';

// ===================== Code Project Index & Agent Tools =====================
// Provides project-level indexing, code search, and token budget management.
// Does NOT replace code-agent.js — it is used BY code-agent.js.

const crypto = require('crypto');

// ── Constants ──────────────────────────────────────────────────────────
const MAX_FILE_SIZE_INDEX = 2 * 1024 * 1024; // 2MB — skip larger files for indexing
const MAX_INDEX_FILES = 1000;
const MAX_INDEX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_CHUNK_SIZE = 4096; // ~4KB per chunk (roughly 60-100 lines)
const DEFAULT_MAX_TOKENS = 128000; // Default context window
const SYSTEM_RESERVE_TOKENS = 8000; // Reserve for system prompt
const OUTPUT_RESERVE_TOKENS = 8192; // Reserve for model output
const HISTORY_RESERVE_TOKENS = 4000; // Reserve for conversation history
const MAX_CHUNKS_PER_REQUEST = 60; // Max chunks in one request
const DEFAULT_INDEX_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_WORKSPACES = 32;
const DEFAULT_MAX_REGISTRY_BYTES = 128 * 1024 * 1024;
const INDEX_BATCH_TTL_MS = 10 * 60 * 1000;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;

// ── In-memory index store (per-process, not persistent) ─────────────────
// Map insertion order is the LRU order (oldest first).
var indexRegistry = new Map();
var latestGenerations = new Map();
// Pending batches are scoped by user/workspace/generation and are never
// exposed as a usable index until the client sends the final batch.
var pendingIndexBatches = new Map();
var registryConfig = {
  ttlMs: DEFAULT_INDEX_TTL_MS,
  maxWorkspaces: DEFAULT_MAX_WORKSPACES,
  maxBytes: DEFAULT_MAX_REGISTRY_BYTES
};
var legacyGeneration = 0;
var legacyWorkspaceId = 'default';

function validatePath(path) {
  if (typeof path !== 'string' || !path || path.length > 500) return false;
  if (path.charAt(0) === '/' || path.indexOf('\\') !== -1 || /^[A-Za-z]:/.test(path)) return false;
  var parts = path.split('/');
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i] || parts[i] === '.' || parts[i] === '..' || parts[i].indexOf('\0') !== -1) return false;
  }
  return true;
}

function normalizeScope(scope, requireGeneration) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    return { ok: false, error: 'Scope is required', code: 'INVALID_SCOPE' };
  }
  var userId = typeof scope.userId === 'string' ? scope.userId.trim() : '';
  var workspaceId = typeof scope.workspaceId === 'string' ? scope.workspaceId.trim() : '';
  if (!userId || userId.length > 200 || !workspaceId || workspaceId.length > 300) {
    return { ok: false, error: 'Invalid userId or workspaceId', code: 'INVALID_SCOPE' };
  }
  var generation = scope.generation;
  if (generation !== undefined && generation !== null) {
    if (!Number.isSafeInteger(generation) || generation < 0) {
      return { ok: false, error: 'Generation must be a non-negative integer', code: 'INVALID_GENERATION' };
    }
  } else if (requireGeneration) {
    return { ok: false, error: 'Generation is required', code: 'INVALID_GENERATION' };
  }
  return {
    ok: true,
    userId: userId,
    workspaceId: workspaceId,
    generation: generation,
    baseKey: JSON.stringify([userId, workspaceId]),
    key: generation === undefined || generation === null ?
      null : JSON.stringify([userId, workspaceId, generation])
  };
}

function legacyScope(workspaceId, forBuild) {
  if (forBuild) {
    legacyGeneration++;
    legacyWorkspaceId = typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : 'default';
  }
  return {
    userId: '__legacy__',
    workspaceId: typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : legacyWorkspaceId,
    generation: forBuild ? legacyGeneration : undefined
  };
}

function estimateIndexBytes(index) {
  var bytes = 0;
  index.files.forEach(function(entry) {
    bytes += Buffer.byteLength(entry.path || '', 'utf8') + 256;
  });
  index.chunks.forEach(function(chunk) {
    bytes += Buffer.byteLength(chunk.content || '', 'utf8') +
      Buffer.byteLength(chunk.id || '', 'utf8') + 128;
  });
  return bytes;
}

function deleteRegistryEntry(key) {
  var entry = indexRegistry.get(key);
  if (!entry) return false;
  indexRegistry.delete(key);
  var baseKey = JSON.stringify([entry.index.userId, entry.index.workspaceId]);
  if (latestGenerations.get(baseKey) === entry.index.generation) {
    var latest = null;
    indexRegistry.forEach(function(candidate) {
      var candidateBase = JSON.stringify([candidate.index.userId, candidate.index.workspaceId]);
      if (candidateBase === baseKey && (latest === null || candidate.index.generation > latest)) {
        latest = candidate.index.generation;
      }
    });
    if (latest === null) latestGenerations.delete(baseKey);
    else latestGenerations.set(baseKey, latest);
  }
  return true;
}

function cleanupRegistry(now) {
  now = typeof now === 'number' ? now : Date.now();
  indexRegistry.forEach(function(entry, key) {
    if (entry.expiresAt <= now) deleteRegistryEntry(key);
  });

  var bytes = 0;
  indexRegistry.forEach(function(entry) { bytes += entry.estimatedBytes || 0; });
  while (indexRegistry.size > registryConfig.maxWorkspaces || bytes > registryConfig.maxBytes) {
    var oldestKey = indexRegistry.keys().next().value;
    if (oldestKey === undefined) break;
    var oldest = indexRegistry.get(oldestKey);
    bytes -= oldest && oldest.estimatedBytes ? oldest.estimatedBytes : 0;
    deleteRegistryEntry(oldestKey);
  }
  pendingIndexBatches.forEach(function (batch, key) {
    if (!batch || batch.expiresAt <= now) pendingIndexBatches.delete(key);
  });
}

function touchEntry(key, entry) {
  var now = Date.now();
  entry.lastAccessedAt = now;
  entry.expiresAt = now + registryConfig.ttlMs;
  indexRegistry.delete(key);
  indexRegistry.set(key, entry);
}

function resolveIndex(scope) {
  var normalized = normalizeScope(scope, false);
  if (!normalized.ok) return normalized;
  cleanupRegistry();
  var latestGeneration = latestGenerations.get(normalized.baseKey);
  var key = normalized.key;
  if (!key && latestGeneration !== undefined) {
    key = JSON.stringify([normalized.userId, normalized.workspaceId, latestGeneration]);
  }
  var entry = key ? indexRegistry.get(key) : null;
  if (!entry && latestGeneration !== undefined && normalized.generation !== undefined) {
    return {
      ok: false,
      error: 'Index generation does not match',
      code: 'GENERATION_MISMATCH',
      currentGeneration: latestGeneration
    };
  }
  if (!entry) return { ok: false, error: 'No project index built', code: 'INDEX_NOT_FOUND' };
  touchEntry(key, entry);
  return { ok: true, index: entry.index, scope: normalized };
}

// ── Token estimation ────────────────────────────────────────────────────
function estimateTokens(text) {
  if (!text) return 0;
  // Rough estimate: ~3.5 chars per token for code, ~4 for natural language
  return Math.ceil(text.length / 3.5);
}

function estimateTokensForChunks(chunks) {
  var total = 0;
  for (var i = 0; i < chunks.length; i++) {
    total += chunks[i].tokenEstimate || estimateTokens(chunks[i].content);
  }
  return total;
}

// ── Token Budget Manager ────────────────────────────────────────────────
function TokenBudget(maxTokens) {
  this.maxTokens = maxTokens || DEFAULT_MAX_TOKENS;
  this.reserved = SYSTEM_RESERVE_TOKENS + OUTPUT_RESERVE_TOKENS + HISTORY_RESERVE_TOKENS;
  this.used = 0;
  this.allocations = [];
}

TokenBudget.prototype.available = function () {
  return Math.max(0, this.maxTokens - this.reserved - this.used);
};

TokenBudget.prototype.allocate = function (item) {
  var tokens = item.tokenEstimate || estimateTokens(item.content || '');
  this.used += tokens;
  this.allocations.push({ item: item, tokens: tokens });
  return tokens;
};

TokenBudget.prototype.canFit = function (tokens) {
  return this.available() >= tokens;
};

TokenBudget.prototype.summary = function () {
  return {
    maxTokens: this.maxTokens,
    reserved: this.reserved,
    used: this.used,
    available: this.available(),
    allocationCount: this.allocations.length
  };
};

// ── File metadata extraction ────────────────────────────────────────────
function extractSymbols(content, language) {
  var symbols = { functions: [], classes: [], exports: [], imports: [] };

  if (!content || !language) return symbols;

  try {
    // JavaScript / TypeScript
    if (language === 'javascript' || language === 'typescript') {
      // Functions: function name, const name = () =>, name() {
      var funcRe = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|(\w+)\s*\([^)]*\)\s*\{)/g;
      var fm;
      while ((fm = funcRe.exec(content)) !== null) {
        var fname = fm[1] || fm[2] || fm[3];
        if (fname && symbols.functions.indexOf(fname) === -1) {
          symbols.functions.push(fname);
        }
      }
      // Classes: class ClassName
      var classRe = /class\s+(\w+)/g;
      var cm;
      while ((cm = classRe.exec(content)) !== null) {
        if (symbols.classes.indexOf(cm[1]) === -1) {
          symbols.classes.push(cm[1]);
        }
      }
      // Exports: export default, export const/function/class, module.exports
      var exportRe = /(?:export\s+(?:default\s+(?:class|function)\s+)?(\w+)|module\.exports\s*=\s*(\w+)|exports\.(\w+)\s*=)/g;
      var em;
      while ((em = exportRe.exec(content)) !== null) {
        var ename = em[1] || em[2] || em[3];
        if (ename && symbols.exports.indexOf(ename) === -1) {
          symbols.exports.push(ename);
        }
      }
      // Imports: import { X } from, require('X')
      var importRe = /(?:import\s+(?:\{[^}]*\}|(\w+))\s*from\s*['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g;
      var im;
      while ((im = importRe.exec(content)) !== null) {
        var ipath = im[2] || im[3];
        if (ipath && symbols.imports.indexOf(ipath) === -1) {
          symbols.imports.push(ipath);
        }
      }
    }

    // Python
    if (language === 'python') {
      var pyFuncRe = /(?:def\s+(\w+)|class\s+(\w+))/g;
      var pm;
      while ((pm = pyFuncRe.exec(content)) !== null) {
        var pname = pm[1] || pm[2];
        if (pname) {
          if (pm[1] && symbols.functions.indexOf(pname) === -1) symbols.functions.push(pname);
          if (pm[2] && symbols.classes.indexOf(pname) === -1) symbols.classes.push(pname);
        }
      }
      var pyImportRe = /(?:import\s+(\w+)|from\s+(\S+)\s+import)/g;
      var pim;
      while ((pim = pyImportRe.exec(content)) !== null) {
        var pipath = pim[1] || pim[2];
        if (pipath && symbols.imports.indexOf(pipath) === -1) symbols.imports.push(pipath);
      }
    }
  } catch (e) {
    // Symbol extraction is best-effort
  }

  return symbols;
}

// ── Content chunking ────────────────────────────────────────────────────
function chunkContent(content, path) {
  if (!content) return [];
  var lines = content.split('\n');
  var chunks = [];
  var currentChunk = [];
  var currentLineCount = 0;
  var startLine = 1;

  for (var i = 0; i < lines.length; i++) {
    currentChunk.push(lines[i]);
    currentLineCount++;

    // Chunk at natural boundaries: empty lines, function/class defs
    var isBoundary = false;
    if (lines[i].trim() === '') isBoundary = true;
    if (/^(?:function|class|def|export|import|const|let|var|public|private|protected|@|#|###|\/\/=|\/\*=)/.test(lines[i].trim())) isBoundary = true;

    if ((currentLineCount >= 80 || isBoundary) && currentChunk.length > 0) {
      var chunkContent = currentChunk.join('\n');
      var chunkId = path + '#L' + startLine + '-' + (startLine + currentLineCount - 1);
      chunks.push({
        id: chunkId,
        path: path,
        startLine: startLine,
        endLine: startLine + currentLineCount - 1,
        content: chunkContent,
        tokenEstimate: estimateTokens(chunkContent)
      });
      currentChunk = [];
      startLine = i + 2; // Next line (1-indexed)
      currentLineCount = 0;
    }
  }

  // Remaining lines
  if (currentChunk.length > 0) {
    var remContent = currentChunk.join('\n');
    chunks.push({
      id: path + '#L' + startLine + '-' + (startLine + currentLineCount - 1),
      path: path,
      startLine: startLine,
      endLine: startLine + currentLineCount - 1,
      content: remContent,
      tokenEstimate: estimateTokens(remContent)
    });
  }

  return chunks;
}

// ── Relevance scoring ───────────────────────────────────────────────────
function scoreRelevance(fileEntry, queryKeywords) {
  if (!queryKeywords || queryKeywords.length === 0) return 0.5;
  var score = 0;

  var pathLower = fileEntry.path.toLowerCase();
  var nameLower = fileEntry.name.toLowerCase();

  for (var i = 0; i < queryKeywords.length; i++) {
    var kw = queryKeywords[i].toLowerCase();
    if (!kw) continue;

    // Exact path match
    if (pathLower === kw) score += 10;
    // File name match
    if (nameLower === kw || nameLower === kw + '.js' || nameLower === kw + '.ts' || nameLower === kw + '.py' || nameLower === kw + '.css') score += 8;
    // File name contains keyword
    if (nameLower.indexOf(kw) !== -1) score += 5;
    // Path contains keyword
    if (pathLower.indexOf(kw) !== -1) score += 3;

    // Symbol matches
    if (fileEntry.symbols) {
      if (fileEntry.symbols.functions && fileEntry.symbols.functions.some(function (f) { return f.toLowerCase() === kw; })) score += 7;
      if (fileEntry.symbols.classes && fileEntry.symbols.classes.some(function (c) { return c.toLowerCase() === kw; })) score += 7;
      if (fileEntry.symbols.exports && fileEntry.symbols.exports.some(function (e) { return e.toLowerCase() === kw; })) score += 6;
      if (fileEntry.symbols.functions && fileEntry.symbols.functions.some(function (f) { return f.toLowerCase().indexOf(kw) !== -1; })) score += 3;
      if (fileEntry.symbols.classes && fileEntry.symbols.classes.some(function (c) { return c.toLowerCase().indexOf(kw) !== -1; })) score += 3;
    }
  }

  return score;
}

function scoreChunkRelevance(chunk, queryKeywords) {
  if (!queryKeywords || queryKeywords.length === 0) return 0.3;
  var score = 0;
  var contentLower = chunk.content.toLowerCase();

  for (var i = 0; i < queryKeywords.length; i++) {
    var kw = queryKeywords[i].toLowerCase();
    if (!kw) continue;

    var count = 0;
    var pos = contentLower.indexOf(kw);
    while (pos !== -1) {
      count++;
      pos = contentLower.indexOf(kw, pos + 1);
    }

    if (count > 0) {
      score += Math.min(count, 5); // Cap at 5 per keyword to avoid oversized files dominating
      // Bonus for function/class definition matches
      if (contentLower.indexOf('function ' + kw) !== -1 || contentLower.indexOf('class ' + kw) !== -1 || contentLower.indexOf('def ' + kw) !== -1) {
        score += 5;
      }
    }
  }

  return score;
}

// ── Extract keywords from user query ────────────────────────────────────
var CHINESE_SEARCH_ALIASES = {
  '登录': ['login', 'auth', 'token', 'session'],
  '登陆': ['login', 'auth', 'token', 'session'],
  '鉴权': ['auth', 'authenticate', 'authorization', 'token'],
  '认证': ['auth', 'authenticate', 'token'],
  '头像': ['avatar', 'profile', 'photo'],
  '用户': ['user', 'account', 'profile'],
  '管理员': ['admin', 'administrator'],
  '聊天': ['chat', 'message', 'conversation', 'dm'],
  '消息': ['message', 'chat', 'notification'],
  '照片': ['photo', 'image', 'gallery', 'wall'],
  '图片': ['image', 'photo', 'preview'],
  '导航': ['nav', 'navigation', 'sidebar', 'menu'],
  '接口': ['api', 'route', 'endpoint'],
  '后端': ['server', 'backend', 'api'],
  '前端': ['frontend', 'client', 'ui'],
  '上传': ['upload', 'file', 'storage'],
  '文档': ['document', 'doc', 'docx', 'pdf'],
  '表格': ['spreadsheet', 'xlsx', 'sheet'],
  '索引': ['index', 'search', 'chunk'],
  '缓存': ['cache', 'cached'],
  '网络': ['network', 'fetch', 'request'],
  '错误': ['error', 'failed', 'exception'],
  '旅游': ['travel', 'trip', 'tourism', 'itinerary'],
  '攻略': ['guide', 'itinerary', 'travel', 'route']
};

function pushUniqueKeyword(keywords, value) {
  var normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized && keywords.indexOf(normalized) === -1) keywords.push(normalized);
}

function extractKeywords(message) {
  if (!message) return [];
  var keywords = [];

  // Extract quoted strings
  var quotedRe = /["'`]([^"'`]+)["'`]/g;
  var qm;
  while ((qm = quotedRe.exec(message)) !== null) {
    pushUniqueKeyword(keywords, qm[1]);
  }

  // Extract file paths (e.g., js/code-workspace.js, src/App.tsx)
  var pathRe = /(?:[\w-]+\/)*[\w-]+\.[a-z]{2,4}/gi;
  var pm;
  while ((pm = pathRe.exec(message)) !== null) {
    pushUniqueKeyword(keywords, pm[0]);
  }

  // Extract function/class names (capitalized words, camelCase, snake_case)
  var nameRe = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)*|[a-z]+(?:[A-Z][a-z]+)+|[a-z]+(?:_[a-z]+)+)\b/g;
  var nm;
  while ((nm = nameRe.exec(message)) !== null) {
    var n = nm[1];
    if (n.length > 2) pushUniqueKeyword(keywords, n);
  }

  // Expand common Chinese product intents to code identifiers. This avoids
  // treating a whole sentence such as “修复登录功能” as one unmatchable token.
  Object.keys(CHINESE_SEARCH_ALIASES).forEach(function(chineseTerm) {
    if (message.indexOf(chineseTerm) === -1) return;
    pushUniqueKeyword(keywords, chineseTerm);
    CHINESE_SEARCH_ALIASES[chineseTerm].forEach(function(alias) {
      pushUniqueKeyword(keywords, alias);
    });
  });

  // Preserve short meaningful Chinese terms even when no alias exists.
  var chineseRuns = message.match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (var cr = 0; cr < chineseRuns.length && keywords.length < 30; cr++) {
    var run = chineseRuns[cr];
    if (run.length <= 6) {
      pushUniqueKeyword(keywords, run);
    } else {
      for (var cg = 0; cg < run.length - 1 && keywords.length < 30; cg++) {
        pushUniqueKeyword(keywords, run.slice(cg, cg + 2));
      }
    }
  }

  // Extract remaining significant words
  var words = message.replace(/[^\w\s\u4e00-\u9fff]/g, ' ').split(/\s+/);
  for (var i = 0; i < words.length; i++) {
    var w = words[i].toLowerCase();
    if (w.length > 2 && !/^(the|and|for|this|that|with|from|have|what|when|where|which|how|can|will|should|could|would|about|does|don't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't)$/i.test(w)) {
      pushUniqueKeyword(keywords, w);
    }
  }

  return keywords.slice(0, 30); // Cap keywords
}

// ── Build project index ─────────────────────────────────────────────────
function buildIndex(scope, files, options) {
  // Backward compatibility: buildIndex(workspaceId, files).
  var explicitScope = scope && typeof scope === 'object' && !Array.isArray(scope);
  var normalized = normalizeScope(explicitScope ? scope : legacyScope(scope, true), true);
  if (!normalized.ok) return normalized;
  if (!files || !Array.isArray(files)) {
    return { ok: false, error: 'files must be an array' };
  }
  if (files.length > MAX_INDEX_FILES) {
    return { ok: false, error: 'Too many files', code: 'FILE_LIMIT_EXCEEDED', maxFiles: MAX_INDEX_FILES };
  }

  cleanupRegistry();
  var currentGeneration = latestGenerations.get(normalized.baseKey);
  if (currentGeneration !== undefined && normalized.generation < currentGeneration) {
    return {
      ok: false,
      error: 'Stale index generation',
      code: 'STALE_GENERATION',
      currentGeneration: currentGeneration
    };
  }

  var fileMap = new Map();
  var chunkMap = new Map();
  var totalChunks = 0;
  var totalFiles = 0;
  var totalBytes = 0;
  var seenPaths = new Set();

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!f || typeof f !== 'object') {
      return { ok: false, error: 'Invalid file entry at index ' + i, code: 'INVALID_FILE' };
    }
    if (!validatePath(f.path)) {
      return { ok: false, error: 'Invalid file path: ' + String(f.path || ''), code: 'INVALID_PATH' };
    }
    if (seenPaths.has(f.path)) {
      return { ok: false, error: 'Duplicate file path: ' + f.path, code: 'DUPLICATE_PATH' };
    }
    seenPaths.add(f.path);

    if (f.content !== undefined && typeof f.content !== 'string') {
      return { ok: false, error: 'File content must be text: ' + f.path, code: 'INVALID_CONTENT' };
    }
    var content = typeof f.content === 'string' ? f.content : '';
    var actualSize = Buffer.byteLength(content, 'utf8');
    if (f.size !== undefined && (!Number.isSafeInteger(f.size) || f.size < 0)) {
      return { ok: false, error: 'Invalid file size: ' + f.path, code: 'INVALID_SIZE' };
    }
    if (actualSize > MAX_FILE_SIZE_INDEX || (f.size !== undefined && f.size > MAX_FILE_SIZE_INDEX)) {
      return { ok: false, error: 'File is too large to index: ' + f.path, code: 'FILE_TOO_LARGE' };
    }
    totalBytes += actualSize;
    if (totalBytes > MAX_INDEX_TOTAL_BYTES) {
      return { ok: false, error: 'Index content is too large', code: 'TOTAL_SIZE_EXCEEDED' };
    }

    var sha256 = typeof f.sha256 === 'string' ? f.sha256.trim().toLowerCase() : '';
    if (sha256 && !SHA256_HEX_RE.test(sha256)) {
      return { ok: false, error: 'Invalid SHA-256: ' + f.path, code: 'INVALID_SHA256' };
    }
    if (sha256 && crypto.createHash('sha256').update(content, 'utf8').digest('hex') !== sha256) {
      return { ok: false, error: 'SHA-256 does not match content: ' + f.path, code: 'SHA256_MISMATCH' };
    }
    if (!sha256 && content) {
      sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    }

    var language = typeof f.language === 'string' ? f.language.trim().toLowerCase() : '';

    var entry = {
      path: f.path,
      name: f.path.split('/').pop(),
      language: language,
      size: actualSize,
      sha256: sha256,
      totalLines: content ? content.split('\n').length : 0,
      modifiedAt: f.modifiedAt || null,
      symbols: extractSymbols(content, language),
      chunks: [],
      isPinned: false
    };

    if (content) {
      var chunks = chunkContent(content, f.path);
      for (var c = 0; c < chunks.length; c++) {
        var chunk = chunks[c];
        chunk.language = language;
        chunk.sha256 = sha256;
        chunkMap.set(chunk.id, chunk);
        entry.chunks.push(chunk.id);
        totalChunks++;
      }
    }

    fileMap.set(f.path, entry);
    totalFiles++;
  }

  var projectIndex = {
    userId: normalized.userId,
    workspaceId: normalized.workspaceId,
    generation: normalized.generation,
    files: fileMap,
    chunks: chunkMap,
    totalFiles: totalFiles,
    totalChunks: totalChunks,
    totalBytes: totalBytes,
    scannedFiles: files.length,
    indexedFiles: totalFiles,
    skippedFiles: 0,
    failedFiles: 0,
    truncated: options && options.truncated === true,
    status: 'ready',
    builtAt: new Date().toISOString()
  };
  if (options && options.validateOnly) {
    return {
      ok: true,
      userId: projectIndex.userId,
      workspaceId: projectIndex.workspaceId,
      generation: projectIndex.generation,
      totalFiles: totalFiles,
      totalChunks: totalChunks,
      totalBytes: totalBytes,
      scannedFiles: projectIndex.scannedFiles,
      indexedFiles: projectIndex.indexedFiles,
      skippedFiles: projectIndex.skippedFiles,
      failedFiles: projectIndex.failedFiles,
      truncated: projectIndex.truncated === true,
      status: 'validated'
    };
  }
  var now = Date.now();
  var registryEntry = {
    index: projectIndex,
    estimatedBytes: estimateIndexBytes(projectIndex),
    createdAt: now,
    lastAccessedAt: now,
    expiresAt: now + registryConfig.ttlMs
  };
  indexRegistry.delete(normalized.key);
  indexRegistry.set(normalized.key, registryEntry);
  if (currentGeneration === undefined || normalized.generation >= currentGeneration) {
    latestGenerations.set(normalized.baseKey, normalized.generation);
  }
  cleanupRegistry(now);

  if (!indexRegistry.has(normalized.key)) {
    return { ok: false, error: 'Index exceeds registry capacity', code: 'REGISTRY_CAPACITY_EXCEEDED' };
  }

  return {
    ok: true,
    userId: projectIndex.userId,
    workspaceId: projectIndex.workspaceId,
    generation: projectIndex.generation,
    totalFiles: totalFiles,
    totalChunks: totalChunks,
    totalBytes: totalBytes,
    scannedFiles: projectIndex.scannedFiles,
    indexedFiles: projectIndex.indexedFiles,
    skippedFiles: projectIndex.skippedFiles,
    failedFiles: projectIndex.failedFiles,
    truncated: projectIndex.truncated === true,
    status: projectIndex.status,
    builtAt: projectIndex.builtAt
  };
}

// Build an index from bounded client batches. Each batch is validated before
// being retained, while the real project index remains unavailable until the
// final batch is received. This keeps request/body memory bounded and prevents
// AI from reading a half-built project.
function appendIndexBatch(scope, files, options) {
  options = options || {};
  var normalized = normalizeScope(scope, true);
  if (!normalized.ok) return normalized;
  if (!Array.isArray(files)) return { ok: false, error: 'files must be an array', code: 'INVALID_FILES' };
  cleanupRegistry();

  var key = normalized.key;
  if (options.reset === true) pendingIndexBatches.delete(key);
  var existing = pendingIndexBatches.get(key);
  if (existing && existing.generation !== normalized.generation) {
    pendingIndexBatches.delete(key);
    existing = null;
  }

  // Reuse the strict path, SHA and size validation from the normal builder,
  // but skip registry publication for this intermediate batch.
  var validated = buildIndex(scope, files, { validateOnly: true });
  if (!validated.ok) return validated;

  var pending = existing || {
    userId: normalized.userId,
    workspaceId: normalized.workspaceId,
    generation: normalized.generation,
    files: [],
    paths: new Set(),
    totalBytes: 0,
    truncated: false,
    expiresAt: Date.now() + INDEX_BATCH_TTL_MS
  };

  if (pending.files.length + files.length > MAX_INDEX_FILES) {
    return { ok: false, error: 'Too many files', code: 'FILE_LIMIT_EXCEEDED', maxFiles: MAX_INDEX_FILES };
  }
  // Validate the complete batch before mutating the pending accumulator. A
  // rejected request must be safe to retry and must not leave half-appended
  // paths or bytes behind.
  var batchPaths = new Set();
  var batchBytes = 0;
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    if (pending.paths.has(file.path) || batchPaths.has(file.path)) {
      return { ok: false, error: 'Duplicate file path: ' + file.path, code: 'DUPLICATE_PATH' };
    }
    batchPaths.add(file.path);
    batchBytes += Buffer.byteLength(typeof file.content === 'string' ? file.content : '', 'utf8');
  }
  if (pending.totalBytes + batchBytes > MAX_INDEX_TOTAL_BYTES) {
    return { ok: false, error: 'Index content is too large', code: 'TOTAL_SIZE_EXCEEDED' };
  }
  for (var j = 0; j < files.length; j++) {
    pending.paths.add(files[j].path);
    pending.files.push(files[j]);
  }
  pending.totalBytes += batchBytes;
  pending.truncated = pending.truncated || options.truncated === true;
  pending.expiresAt = Date.now() + INDEX_BATCH_TTL_MS;

  var finalize = options.finalize === true;
  if (!finalize) {
    pendingIndexBatches.set(key, pending);
    return {
      ok: true,
      status: 'building',
      userId: pending.userId,
      workspaceId: pending.workspaceId,
      generation: pending.generation,
      scannedFiles: pending.files.length,
      indexedFiles: 0,
      totalBytes: pending.totalBytes,
      batchComplete: true,
      finalizeRequired: true
    };
  }

  var result = buildIndex(scope, pending.files, { truncated: pending.truncated });
  if (result.ok) pendingIndexBatches.delete(key);
  else pendingIndexBatches.set(key, pending);
  return result;
}

// ── Get index summary ───────────────────────────────────────────────────
function getIndexSummary(scope) {
  var resolved = resolveIndex(scope && typeof scope === 'object' ? scope : legacyScope(scope, false));
  if (!resolved.ok) return null;
  var projectIndex = resolved.index;
  return {
    userId: projectIndex.userId,
    workspaceId: projectIndex.workspaceId,
    generation: projectIndex.generation,
    totalFiles: projectIndex.totalFiles,
    totalChunks: projectIndex.totalChunks,
    totalBytes: projectIndex.totalBytes,
    scannedFiles: projectIndex.scannedFiles,
    indexedFiles: projectIndex.indexedFiles,
    skippedFiles: projectIndex.skippedFiles,
    failedFiles: projectIndex.failedFiles,
    truncated: projectIndex.truncated === true,
    status: projectIndex.status,
    builtAt: projectIndex.builtAt
  };
}

// ── Search code ─────────────────────────────────────────────────────────
function searchCode(scope, query, options) {
  // Backward compatibility: searchCode(query, options).
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    options = query;
    query = scope;
    scope = legacyScope(null, false);
  }
  var resolved = resolveIndex(scope);
  if (!resolved.ok) return resolved;
  var projectIndex = resolved.index;
  if (!query) return { ok: false, error: 'Query is required' };

  var maxResults = (options && options.maxResults) || 20;
  var pathFilter = (options && options.path) || null;
  var extFilter = (options && options.extensions) || null;

  var keywords = extractKeywords(query);
  var results = [];

  projectIndex.files.forEach(function (fileEntry) {
    if (pathFilter && fileEntry.path.indexOf(pathFilter) === -1) return;
    if (extFilter) {
      var ext = fileEntry.name.slice(fileEntry.name.lastIndexOf('.')).toLowerCase();
      if (extFilter.indexOf(ext) === -1) return;
    }

    // Check file-level relevance
    var fileScore = scoreRelevance(fileEntry, keywords);

    // Check chunk-level relevance
    for (var c = 0; c < fileEntry.chunks.length; c++) {
      var chunkId = fileEntry.chunks[c];
      var chunk = projectIndex.chunks.get(chunkId);
      if (!chunk) continue;

      var chunkScore = scoreChunkRelevance(chunk, keywords);
      if (chunkScore > 0 || keywords.length === 0) {
        results.push({
          path: fileEntry.path,
          name: fileEntry.name,
          language: fileEntry.language,
          chunkId: chunk.id,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          score: fileScore + chunkScore,
          tokenEstimate: chunk.tokenEstimate
        });
      }
    }
  });

  // Sort by relevance score descending
  results.sort(function (a, b) { return b.score - a.score; });

  // Deduplicate by chunkId
  var seen = new Set();
  var deduped = [];
  for (var i = 0; i < results.length; i++) {
    if (deduped.length >= maxResults) break;
    if (!seen.has(results[i].chunkId)) {
      seen.add(results[i].chunkId);
      deduped.push(results[i]);
    }
  }

  return {
    ok: true,
    query: query,
    results: deduped,
    totalHits: results.length,
    keywords: keywords
  };
}

// ── Select best chunks within token budget ──────────────────────────────
function selectBestChunks(scope, query, budget, pinnedFilePaths, activeFilePath) {
  // Backward compatibility: selectBestChunks(query, budget, pinned, active).
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    activeFilePath = pinnedFilePaths;
    pinnedFilePaths = budget;
    budget = query;
    query = scope;
    scope = legacyScope(null, false);
  }
  var resolved = resolveIndex(scope);
  if (!resolved.ok) return resolved;
  var projectIndex = resolved.index;

  var keywords = extractKeywords(query);
  var allCandidates = [];
  var pinnedChunks = [];

  // Collect pinned file chunks first
  if (pinnedFilePaths && Array.isArray(pinnedFilePaths)) {
    for (var pf = 0; pf < pinnedFilePaths.length; pf++) {
      var pinnedEntry = projectIndex.files.get(pinnedFilePaths[pf]);
      if (pinnedEntry) {
        for (var pc = 0; pc < pinnedEntry.chunks.length; pc++) {
          var pchunkId = pinnedEntry.chunks[pc];
          var pchunk = projectIndex.chunks.get(pchunkId);
          if (pchunk) {
            pinnedChunks.push({
              path: pinnedEntry.path,
              name: pinnedEntry.name,
              language: pinnedEntry.language,
              chunkId: pchunk.id,
              startLine: pchunk.startLine,
              endLine: pchunk.endLine,
              content: pchunk.content,
              score: 100, // Pinned files get highest priority
              tokenEstimate: pchunk.tokenEstimate,
              priority: 'pinned'
            });
          }
        }
      }
    }
  }

  // Collect active file chunks next
  if (activeFilePath) {
    var activeEntry = projectIndex.files.get(activeFilePath);
    if (activeEntry) {
      for (var ac = 0; ac < activeEntry.chunks.length; ac++) {
        var achunkId = activeEntry.chunks[ac];
        var achunk = projectIndex.chunks.get(achunkId);
        if (achunk) {
          allCandidates.push({
            path: activeEntry.path,
            name: activeEntry.name,
            language: activeEntry.language,
            chunkId: achunk.id,
            startLine: achunk.startLine,
            endLine: achunk.endLine,
            content: achunk.content,
            score: 90, // Active file gets high priority
            tokenEstimate: achunk.tokenEstimate,
            priority: 'active'
          });
        }
      }
    }
  }

  // Collect all other chunks with relevance scores
  projectIndex.files.forEach(function (fileEntry) {
    // Skip already processed pinned files and active file
    if (pinnedFilePaths && pinnedFilePaths.indexOf(fileEntry.path) !== -1) return;
    if (fileEntry.path === activeFilePath) return;

    for (var c = 0; c < fileEntry.chunks.length; c++) {
      var chunkId = fileEntry.chunks[c];
      var chunk = projectIndex.chunks.get(chunkId);
      if (!chunk) continue;

      var chunkScore = scoreChunkRelevance(chunk, keywords);
      var fileScore = scoreRelevance(fileEntry, keywords);
      var totalScore = fileScore + chunkScore;

      if (totalScore > 0 || keywords.length === 0) {
        allCandidates.push({
          path: fileEntry.path,
          name: fileEntry.name,
          language: fileEntry.language,
          chunkId: chunk.id,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          score: totalScore,
          tokenEstimate: chunk.tokenEstimate,
          priority: 'search'
        });
      }
    }
  });

  // Sort by score descending
  allCandidates.sort(function (a, b) { return b.score - a.score; });

  // Allocate within budget: pinned first, then active, then search results
  var budgetTokens = typeof budget === 'number' ? budget : 60000;
  var selected = [];
  var usedTokens = 0;
  var seen = new Set();

  function tryAdd(candidate) {
    if (seen.has(candidate.chunkId)) return false;
    if (usedTokens + candidate.tokenEstimate > budgetTokens) return false;
    if (selected.length >= MAX_CHUNKS_PER_REQUEST) return false;

    seen.add(candidate.chunkId);
    selected.push(candidate);
    usedTokens += candidate.tokenEstimate;
    return true;
  }

  // Add pinned chunks first
  for (var i = 0; i < pinnedChunks.length; i++) {
    tryAdd(pinnedChunks[i]);
  }

  // Add remaining candidates by score
  for (var j = 0; j < allCandidates.length; j++) {
    if (usedTokens >= budgetTokens) break;
    if (selected.length >= MAX_CHUNKS_PER_REQUEST) break;
    tryAdd(allCandidates[j]);
  }

  return {
    ok: true,
    query: query,
    keywords: keywords,
    selected: selected,
    totalCandidates: allCandidates.length + pinnedChunks.length,
    usedTokens: usedTokens,
    budgetTokens: budgetTokens,
    truncated: allCandidates.length > selected.length
  };
}

// ── Read file range ─────────────────────────────────────────────────────
function readFileRange(scope, path, startLine, endLine) {
  // Backward compatibility: readFileRange(path, startLine, endLine).
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    endLine = startLine;
    startLine = path;
    path = scope;
    scope = legacyScope(null, false);
  }
  var resolved = resolveIndex(scope);
  if (!resolved.ok) return resolved;
  var projectIndex = resolved.index;
  if (!validatePath(path)) return { ok: false, error: 'Invalid file path', code: 'INVALID_PATH' };
  startLine = Number.isSafeInteger(startLine) && startLine > 0 ? startLine : 1;
  endLine = Number.isSafeInteger(endLine) && endLine >= startLine ? endLine : startLine + 999999;

  var entry = projectIndex.files.get(path);
  if (!entry) return { ok: false, error: 'File not found in index: ' + path };

  // Find matching chunks
  var matchingChunks = [];
  for (var c = 0; c < entry.chunks.length; c++) {
    var chunk = projectIndex.chunks.get(entry.chunks[c]);
    if (!chunk) continue;
    // Check overlap
    if (chunk.endLine >= startLine && chunk.startLine <= endLine) {
      matchingChunks.push(chunk);
    }
  }

  // If no chunks match, return empty
  if (matchingChunks.length === 0) {
    return { ok: true, path: path, sha256: entry.sha256, chunks: [], startLine: startLine, endLine: endLine };
  }

  // Extract the requested lines from chunks
  var lines = [];
  for (var i = 0; i < matchingChunks.length; i++) {
    var chunkLines = matchingChunks[i].content.split('\n');
    var chunkStart = matchingChunks[i].startLine;
    for (var j = 0; j < chunkLines.length; j++) {
      var lineNum = chunkStart + j;
      if (lineNum >= startLine && lineNum <= endLine) {
        lines.push({ lineNum: lineNum, text: chunkLines[j] });
      }
    }
  }

  return {
    ok: true,
    path: path,
    sha256: entry.sha256,
    lines: lines,
    startLine: startLine,
    endLine: endLine,
    totalLines: lines.length,
    totalFileLines: entry.totalLines || 0
  };
}

// ── Get file symbols ────────────────────────────────────────────────────
function getFileSymbols(scope, path) {
  // Backward compatibility: getFileSymbols(path).
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    path = scope;
    scope = legacyScope(null, false);
  }
  var resolved = resolveIndex(scope);
  if (!resolved.ok) return resolved;
  var projectIndex = resolved.index;
  if (!validatePath(path)) return { ok: false, error: 'Invalid file path', code: 'INVALID_PATH' };

  var entry = projectIndex.files.get(path);
  if (!entry) return { ok: false, error: 'File not found in index: ' + path };

  return {
    ok: true,
    path: path,
    name: entry.name,
    language: entry.language,
    symbols: entry.symbols
  };
}

// ── List files ──────────────────────────────────────────────────────────
function listFiles(scope, directory, depth, pattern) {
  // Backward compatibility: listFiles(directory, depth, pattern).
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    pattern = depth;
    depth = directory;
    directory = scope;
    scope = legacyScope(null, false);
  }
  var resolved = resolveIndex(scope);
  if (!resolved.ok) return resolved;
  var projectIndex = resolved.index;
  if (directory && !validatePath(directory)) {
    return { ok: false, error: 'Invalid directory path', code: 'INVALID_PATH' };
  }

  var results = [];
  var maxDepth = Number.isSafeInteger(depth) ? Math.min(Math.max(depth, 0), 20) : 3;
  var dirPrefix = directory ? (directory.endsWith('/') ? directory : directory + '/') : '';
  var MAX_LIST_FILES = 200;

  // First pass: collect directories to build a tree summary
  var dirMap = {};
  projectIndex.files.forEach(function (entry) {
    if (dirPrefix && !entry.path.startsWith(dirPrefix)) return;

    var relativePath = dirPrefix ? entry.path.slice(dirPrefix.length) : entry.path;
    var parts = relativePath.split('/');
    var depthCount = parts.length - 1;
    if (depthCount > maxDepth) return;

    if (pattern) {
      try {
        var re = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i');
        if (!re.test(entry.name)) return;
      } catch (e) { /* invalid pattern */ }
    }

    results.push({
      path: entry.path,
      name: entry.name,
      language: entry.language,
      size: entry.size,
      symbols: entry.symbols,
      chunkCount: entry.chunks.length
    });

    // Build directory tree
    for (var d = 0; d < parts.length - 1; d++) {
      var dirPath = dirPrefix + parts.slice(0, d + 1).join('/');
      if (!dirMap[dirPath]) dirMap[dirPath] = [];
      dirMap[dirPath].push(entry.path);
    }
  });

  results.sort(function (a, b) { return a.path.localeCompare(b.path); });

  var totalFiles = results.length;
  var truncated = totalFiles > MAX_LIST_FILES;
  if (truncated) {
    results = results.slice(0, MAX_LIST_FILES);
  }

  // Build directory summary
  var directories = Object.keys(dirMap).sort().map(function (dir) {
    return { path: dir, fileCount: dirMap[dir].length };
  });

  var resultObj = {
    ok: true,
    directory: directory || '/',
    directories: directories,
    files: results,
    totalFiles: totalFiles,
    returnedFiles: results.length,
    truncated: truncated,
    totalCount: totalFiles
  };

  if (truncated) {
    resultObj.hint = '目录内容已截断，请指定具体 directory 参数缩小范围';
  }

  return resultObj;
}

// ── Clear index ─────────────────────────────────────────────────────────
function clearIndex(scope) {
  var normalized = normalizeScope(scope && typeof scope === 'object' ? scope : legacyScope(scope, false), false);
  if (!normalized.ok) return normalized;
  cleanupRegistry();
  var latestGeneration = latestGenerations.get(normalized.baseKey);
  var key = normalized.key;
  if (!key && latestGeneration !== undefined) {
    key = JSON.stringify([normalized.userId, normalized.workspaceId, latestGeneration]);
  }
  var entry = key ? indexRegistry.get(key) : null;
  var pending = key ? pendingIndexBatches.get(key) : null;
  if (!entry && !pending) return { ok: true, cleared: false };
  if (entry) deleteRegistryEntry(key);
  if (pending) pendingIndexBatches.delete(key);
  return { ok: true, cleared: true };
}

// ── Pin/unpin files ─────────────────────────────────────────────────────
function pinFile(scope, path, pinned) {
  // Backward compatibility: pinFile(path, pinned).
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    pinned = path;
    path = scope;
    scope = legacyScope(null, false);
  }
  var resolved = resolveIndex(scope);
  if (!resolved.ok) return resolved;
  var projectIndex = resolved.index;
  if (!validatePath(path)) return { ok: false, error: 'Invalid file path', code: 'INVALID_PATH' };

  var entry = projectIndex.files.get(path);
  if (!entry) return { ok: false, error: 'File not found: ' + path };

  entry.isPinned = pinned !== false;
  return { ok: true, path: path, isPinned: entry.isPinned };
}

function getPinnedFiles(scope) {
  var resolved = resolveIndex(scope && typeof scope === 'object' ? scope : legacyScope(scope, false));
  if (!resolved.ok) return [];
  var projectIndex = resolved.index;
  var pinned = [];
  projectIndex.files.forEach(function (entry) {
    if (entry.isPinned) pinned.push(entry.path);
  });
  return pinned;
}

function configureRegistry(options) {
  options = options || {};
  if (options.ttlMs !== undefined) {
    if (!Number.isSafeInteger(options.ttlMs) || options.ttlMs < 1) throw new Error('ttlMs must be a positive integer');
    registryConfig.ttlMs = options.ttlMs;
  }
  if (options.maxWorkspaces !== undefined) {
    if (!Number.isSafeInteger(options.maxWorkspaces) || options.maxWorkspaces < 1) throw new Error('maxWorkspaces must be a positive integer');
    registryConfig.maxWorkspaces = options.maxWorkspaces;
  }
  if (options.maxBytes !== undefined) {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) throw new Error('maxBytes must be a positive integer');
    registryConfig.maxBytes = options.maxBytes;
  }
  cleanupRegistry();
  return getRegistryStats();
}

function getRegistryStats() {
  cleanupRegistry();
  var estimatedBytes = 0;
  var workspaces = [];
  indexRegistry.forEach(function(entry) {
    estimatedBytes += entry.estimatedBytes || 0;
    workspaces.push({
      userId: entry.index.userId,
      workspaceId: entry.index.workspaceId,
      generation: entry.index.generation,
      lastAccessedAt: entry.lastAccessedAt,
      expiresAt: entry.expiresAt,
      estimatedBytes: entry.estimatedBytes || 0
    });
  });
  return {
    workspaceCount: indexRegistry.size,
    estimatedBytes: estimatedBytes,
    maxWorkspaces: registryConfig.maxWorkspaces,
    maxBytes: registryConfig.maxBytes,
    ttlMs: registryConfig.ttlMs,
    workspaces: workspaces
  };
}

function resetRegistryForTests() {
  indexRegistry.clear();
  pendingIndexBatches.clear();
  latestGenerations.clear();
  registryConfig.ttlMs = DEFAULT_INDEX_TTL_MS;
  registryConfig.maxWorkspaces = DEFAULT_MAX_WORKSPACES;
  registryConfig.maxBytes = DEFAULT_MAX_REGISTRY_BYTES;
  legacyGeneration = 0;
  legacyWorkspaceId = 'default';
}

// ── Phase 4: Persistent Index Integration ───────────────────────────────
// These functions bridge the in-memory registry with the Supabase-backed
// persistent index. When CODE_PERSISTENT_INDEX_ENABLED is on, index builds
// are persisted to the database and can be recovered after Render restarts.
// The in-memory registry remains the primary hot cache; the DB is the
// source of truth for recovery.

var persistentIndex = null;

// Expose internal resolveIndex for persistence (used by code-agent.js)
function _resolveIndexForPersistence(scope) {
  return resolveIndex(scope);
}

function _lazyPersistentIndex() {
  if (!persistentIndex) {
    try { persistentIndex = require('./ai-core/persistent-index'); } catch (e) {
      persistentIndex = { isPersistEnabled: function() { return false; } };
    }
  }
  return persistentIndex;
}

function persistIndexToDB(supabase, userId, identifier, projectIndex) {
  var pi = _lazyPersistentIndex();
  if (!pi.isPersistEnabled() || !supabase) return Promise.resolve(null);

  return pi.upsertWorkspace(supabase, {
    userId: userId,
    sourceType: 'local_folder',
    identifier: String(identifier || projectIndex.workspaceId),
    workspaceName: String(identifier || projectIndex.workspaceId),
    generation: projectIndex.generation,
    indexStatus: 'ready',
    totalFiles: projectIndex.totalFiles,
    totalChunks: projectIndex.totalChunks,
    totalBytes: projectIndex.totalBytes,
    truncated: projectIndex.truncated === true
  }).then(function(ws) {
    if (!ws || !ws.id) return null;
    var workspaceId = ws.id;

    // Delete old files and chunks for this workspace, then insert new
    return pi.deleteAllIndexFiles(supabase, workspaceId).then(function() {
      var fileEntries = [];
      projectIndex.files.forEach(function(entry, path) {
        fileEntries.push({ path: path, entry: entry });
      });

      var uploadFile = function(index) {
        if (index >= fileEntries.length) return Promise.resolve();
        var fe = fileEntries[index];
        var entry = fe.entry;

        return pi.upsertIndexFile(supabase, userId, workspaceId, {
          path: fe.path,
          name: entry.name,
          language: entry.language,
          size: entry.size,
          modifiedAt: entry.modifiedAt,
          sha256: entry.sha256
        }).then(function(fileRecord) {
          if (!fileRecord || !fileRecord.id) return uploadFile(index + 1);

          // Collect chunks for this file
          var chunkRows = [];
          for (var c = 0; c < entry.chunks.length; c++) {
            var chunkId = entry.chunks[c];
            var chunk = projectIndex.chunks.get(chunkId);
            if (chunk) {
              chunkRows.push({
                chunkKey: chunk.id,
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                content: chunk.content,
                tokenEstimate: chunk.tokenEstimate,
                contentHash: ''
              });
            }
          }
          return pi.upsertChunks(supabase, userId, workspaceId, fileRecord.id, chunkRows).then(function() {
            return uploadFile(index + 1);
          });
        });
      };

      return uploadFile(0).then(function() {
        return workspaceId;
      });
    });
  }).catch(function(e) {
    console.error('[code-index] persistIndexToDB error:', e.message);
    return null;
  });
}

function recoverIndexFromDB(supabase, scope, identifier) {
  var pi = _lazyPersistentIndex();
  if (!pi.isPersistEnabled() || !supabase) return Promise.resolve(null);

  var normalized = normalizeScope(scope, false);
  if (!normalized.ok) return Promise.resolve(null);

  var workspaceKey = pi.generateWorkspaceKey(normalized.userId, 'local_folder', String(identifier || normalized.workspaceId));
  return pi.getWorkspace(supabase, normalized.userId, workspaceKey).then(function(ws) {
    if (!ws) return null;
    // Check index version
    if (ws.index_version !== 1) {
      return { ok: false, error: '索引版本不匹配，需要重建', code: 'NEEDS_UPGRADE', currentVersion: ws.index_version };
    }
    if (ws.index_status === 'stale' || ws.index_status === 'needs_upgrade') {
      return { ok: false, error: '索引已过期，需要重建', code: 'NEEDS_UPGRADE', status: ws.index_status };
    }
    return pi.recoverIndex(supabase, ws.id).then(function(recovered) {
      if (!recovered || !recovered.files || recovered.files.size === 0) return null;
      // Load into in-memory registry
      var now = Date.now();
      var registryEntry = {
        index: recovered,
        estimatedBytes: estimateIndexBytes(recovered),
        createdAt: now,
        lastAccessedAt: now,
        expiresAt: now + registryConfig.ttlMs
      };
      var key = JSON.stringify([recovered.userId, recovered.workspaceId, recovered.generation]);
      indexRegistry.delete(key);
      indexRegistry.set(key, registryEntry);
      var baseKey = JSON.stringify([recovered.userId, recovered.workspaceId]);
      var currentGen = latestGenerations.get(baseKey);
      if (currentGen === undefined || recovered.generation >= currentGen) {
        latestGenerations.set(baseKey, recovered.generation);
      }
      // Update workspace last_opened_at
      pi.updateWorkspaceStats(supabase, ws.id, { indexStatus: 'ready' }).catch(function() {});
      return {
        ok: true,
        recovered: true,
        workspaceId: ws.id,
        summary: getIndexSummary(scope)
      };
    });
  }).catch(function(e) {
    console.error('[code-index] recoverIndexFromDB error:', e.message);
    return null;
  });
}

// ── Exports ─────────────────────────────────────────────────────────────
module.exports = {
  // Token budget
  TokenBudget: TokenBudget,
  estimateTokens: estimateTokens,
  estimateTokensForChunks: estimateTokensForChunks,

  // Index operations
  buildIndex: buildIndex,
  appendIndexBatch: appendIndexBatch,
  clearIndex: clearIndex,
  getIndexSummary: getIndexSummary,

  // Search & selection
  searchCode: searchCode,
  selectBestChunks: selectBestChunks,
  extractKeywords: extractKeywords,

  // File operations
  readFileRange: readFileRange,
  getFileSymbols: getFileSymbols,
  listFiles: listFiles,

  // Pin management
  pinFile: pinFile,
  getPinnedFiles: getPinnedFiles,

  // Registry lifecycle
  configureRegistry: configureRegistry,
  getRegistryStats: getRegistryStats,
  cleanupExpired: cleanupRegistry,
  _resetRegistryForTests: resetRegistryForTests,

  // Content utilities
  chunkContent: chunkContent,
  extractSymbols: extractSymbols,
  scoreRelevance: scoreRelevance,

  // Phase 4: Persistent index
  persistIndexToDB: persistIndexToDB,
  recoverIndexFromDB: recoverIndexFromDB,
  _resolveIndexForPersistence: _resolveIndexForPersistence,

  // Constants
  DEFAULT_MAX_TOKENS: DEFAULT_MAX_TOKENS,
  MAX_CHUNKS_PER_REQUEST: MAX_CHUNKS_PER_REQUEST,
  MAX_INDEX_FILES: MAX_INDEX_FILES,
  MAX_INDEX_TOTAL_BYTES: MAX_INDEX_TOTAL_BYTES
};
