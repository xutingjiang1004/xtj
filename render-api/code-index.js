'use strict';

// ===================== Code Project Index & Agent Tools =====================
// Provides project-level indexing, code search, and token budget management.
// Does NOT replace code-agent.js — it is used BY code-agent.js.

const crypto = require('crypto');

// ── Constants ──────────────────────────────────────────────────────────
const MAX_FILE_SIZE_INDEX = 2 * 1024 * 1024; // 2MB — skip larger files for indexing
const MAX_CHUNK_SIZE = 4096; // ~4KB per chunk (roughly 60-100 lines)
const DEFAULT_MAX_TOKENS = 128000; // Default context window
const SYSTEM_RESERVE_TOKENS = 8000; // Reserve for system prompt
const OUTPUT_RESERVE_TOKENS = 8192; // Reserve for model output
const HISTORY_RESERVE_TOKENS = 4000; // Reserve for conversation history
const MAX_CHUNKS_PER_REQUEST = 60; // Max chunks in one request

// ── In-memory index store (per-process, not persistent) ─────────────────
var projectIndex = null; // { workspaceId, files: Map<path, FileEntry>, chunks: Map<chunkId, ChunkEntry>, builtAt }

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
function extractKeywords(message) {
  if (!message) return [];
  var keywords = [];

  // Extract quoted strings
  var quotedRe = /["'`]([^"'`]+)["'`]/g;
  var qm;
  while ((qm = quotedRe.exec(message)) !== null) {
    keywords.push(qm[1]);
  }

  // Extract file paths (e.g., js/code-workspace.js, src/App.tsx)
  var pathRe = /(?:[\w-]+\/)*[\w-]+\.[a-z]{2,4}/gi;
  var pm;
  while ((pm = pathRe.exec(message)) !== null) {
    var p = pm[0].toLowerCase();
    if (keywords.indexOf(p) === -1) keywords.push(p);
  }

  // Extract function/class names (capitalized words, camelCase, snake_case)
  var nameRe = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)*|[a-z]+(?:[A-Z][a-z]+)+|[a-z]+(?:_[a-z]+)+)\b/g;
  var nm;
  while ((nm = nameRe.exec(message)) !== null) {
    var n = nm[1];
    if (n.length > 2 && keywords.indexOf(n) === -1) keywords.push(n);
  }

  // Extract remaining significant words
  var words = message.replace(/[^\w\s\u4e00-\u9fff]/g, ' ').split(/\s+/);
  for (var i = 0; i < words.length; i++) {
    var w = words[i].toLowerCase();
    if (w.length > 2 && keywords.indexOf(w) === -1 && !/^(the|and|for|the|this|that|with|from|have|what|when|where|which|how|can|will|should|could|would|about|does|don't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't)$/i.test(w)) {
      keywords.push(w);
    }
  }

  return keywords.slice(0, 30); // Cap keywords
}

// ── Build project index ─────────────────────────────────────────────────
function buildIndex(workspaceId, files) {
  if (!files || !Array.isArray(files)) {
    return { ok: false, error: 'files must be an array' };
  }

  var fileMap = new Map();
  var chunkMap = new Map();
  var totalChunks = 0;
  var totalFiles = 0;

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!f || !f.path) continue;

    var entry = {
      path: f.path,
      name: f.name || f.path.split('/').pop(),
      language: f.language || '',
      size: f.size || 0,
      sha256: f.sha256 || '',
      modifiedAt: f.modifiedAt || null,
      symbols: f.symbols || { functions: [], classes: [], exports: [], imports: [] },
      chunks: [],
      isPinned: false
    };

    // Chunk larger files
    if (f.content && f.size < MAX_FILE_SIZE_INDEX) {
      var chunks = chunkContent(f.content, f.path);
      for (var c = 0; c < chunks.length; c++) {
        var chunk = chunks[c];
        chunkMap.set(chunk.id, chunk);
        entry.chunks.push(chunk.id);
        totalChunks++;
      }
    }

    fileMap.set(f.path, entry);
    totalFiles++;
  }

  projectIndex = {
    workspaceId: workspaceId || 'default',
    files: fileMap,
    chunks: chunkMap,
    totalFiles: totalFiles,
    totalChunks: totalChunks,
    builtAt: new Date().toISOString()
  };

  return {
    ok: true,
    totalFiles: totalFiles,
    totalChunks: totalChunks,
    builtAt: projectIndex.builtAt
  };
}

// ── Get index summary ───────────────────────────────────────────────────
function getIndexSummary() {
  if (!projectIndex) return null;
  return {
    workspaceId: projectIndex.workspaceId,
    totalFiles: projectIndex.totalFiles,
    totalChunks: projectIndex.totalChunks,
    builtAt: projectIndex.builtAt
  };
}

// ── Search code ─────────────────────────────────────────────────────────
function searchCode(query, options) {
  if (!projectIndex) return { ok: false, error: 'No project index built' };
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
    if (fileScore <= 0 && keywords.length > 0) return;

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
function selectBestChunks(query, budget, pinnedFilePaths, activeFilePath) {
  if (!projectIndex) return { ok: false, error: 'No project index built' };

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
function readFileRange(path, startLine, endLine) {
  if (!projectIndex) return { ok: false, error: 'No project index built' };

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
    return { ok: true, path: path, chunks: [], startLine: startLine, endLine: endLine };
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
    lines: lines,
    startLine: startLine,
    endLine: endLine,
    totalLines: lines.length
  };
}

// ── Get file symbols ────────────────────────────────────────────────────
function getFileSymbols(path) {
  if (!projectIndex) return { ok: false, error: 'No project index built' };

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
function listFiles(directory, depth, pattern) {
  if (!projectIndex) return { ok: false, error: 'No project index built' };

  var results = [];
  var maxDepth = depth || 3;
  var dirPrefix = directory ? (directory.endsWith('/') ? directory : directory + '/') : '';

  projectIndex.files.forEach(function (entry) {
    if (dirPrefix && !entry.path.startsWith(dirPrefix)) return;

    var relativePath = dirPrefix ? entry.path.slice(dirPrefix.length) : entry.path;
    var depthCount = relativePath.split('/').length - 1;
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
  });

  results.sort(function (a, b) { return a.path.localeCompare(b.path); });

  return {
    ok: true,
    directory: directory || '/',
    files: results,
    totalCount: results.length
  };
}

// ── Clear index ─────────────────────────────────────────────────────────
function clearIndex() {
  projectIndex = null;
  return { ok: true };
}

// ── Pin/unpin files ─────────────────────────────────────────────────────
function pinFile(path, pinned) {
  if (!projectIndex) return { ok: false, error: 'No project index built' };

  var entry = projectIndex.files.get(path);
  if (!entry) return { ok: false, error: 'File not found: ' + path };

  entry.isPinned = pinned !== false;
  return { ok: true, path: path, isPinned: entry.isPinned };
}

function getPinnedFiles() {
  if (!projectIndex) return [];
  var pinned = [];
  projectIndex.files.forEach(function (entry) {
    if (entry.isPinned) pinned.push(entry.path);
  });
  return pinned;
}

// ── Exports ─────────────────────────────────────────────────────────────
module.exports = {
  // Token budget
  TokenBudget: TokenBudget,
  estimateTokens: estimateTokens,
  estimateTokensForChunks: estimateTokensForChunks,

  // Index operations
  buildIndex: buildIndex,
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

  // Content utilities
  chunkContent: chunkContent,
  extractSymbols: extractSymbols,
  scoreRelevance: scoreRelevance,

  // Constants
  DEFAULT_MAX_TOKENS: DEFAULT_MAX_TOKENS,
  MAX_CHUNKS_PER_REQUEST: MAX_CHUNKS_PER_REQUEST
};