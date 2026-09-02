/**
 * Assemble js/core-parts/*.js -> js/core.js
 * Runtime also loads js/core-utils.min.js before core.min.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const manifestPath = path.join(ROOT, 'js', 'core-parts', 'MANIFEST.json');

function assemble() {
  if (!fs.existsSync(manifestPath)) {
    console.log('[assemble-core] no MANIFEST.json — skip');
    return false;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const chunks = [];
  chunks.push([
    '/**',
    ' * AUTO-ASSEMBLED from js/core-parts (see MANIFEST.json).',
    ' * Edit the part files, then run: node scripts/assemble-core.js',
    ' * Runtime also loads js/core-utils.min.js before this file.',
    ' */',
    ''
  ].join('\n'));

  manifest.parts.forEach(function (rel) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) throw new Error('missing part: ' + rel);
    const text = fs.readFileSync(full, 'utf8');
    chunks.push(text.replace(/\s+$/, '') + '\n');
  });

  // 非阻断告警：跨 part 的重复顶层函数 / window.x = 定义（防"覆盖式双定义"回归陷阱）
  // ★ 修复：chunks[0] 是文件头注释块，part 正文从 chunks[1] 开始，必须 slice(1)
  //   才能与 manifest.parts 按相同下标对齐；此前直接传 chunks 导致整体错位 1，
  //   每个 part 的重复定义都被错误标注成下一个 part 的文件名，误导排查。
  warnDuplicateDefinitions(manifest.parts, chunks.slice(1));

  let out = chunks.join('\n');
  if (!out.endsWith('\n')) out += '\n';

  const corePath = path.join(ROOT, 'js', 'core.js');
  const prev = fs.existsSync(corePath) ? fs.readFileSync(corePath, 'utf8') : '';
  if (prev === out) {
    console.log('[assemble-core] core.js already up to date');
    return false;
  }
  fs.writeFileSync(corePath, out, 'utf8');
  console.log(
    '[assemble-core] wrote js/core.js (' +
      Buffer.byteLength(out) +
      ' bytes, ' +
      out.split(/\n/).length +
      ' lines)'
  );
  return true;
}

function warnDuplicateDefinitions(parts, chunks) {
  const byName = {};
  const FUNC_RE = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  const ASSIGN_RE = /(?:^|\n)\s*(?:window\.)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(/g;
  parts.forEach(function (rel, idx) {
    const text = chunks[idx];
    let m;
    FUNC_RE.lastIndex = 0;
    while ((m = FUNC_RE.exec(text))) {
      const name = m[1];
      (byName[name] = byName[name] || []).push(rel + ' (function ' + name + ')');
    }
    ASSIGN_RE.lastIndex = 0;
    while ((m = ASSIGN_RE.exec(text))) {
      const name = m[1];
      (byName[name] = byName[name] || []).push(rel + ' (window.' + name + ' = fn)');
    }
  });
  Object.keys(byName).forEach(function (name) {
    const seen = byName[name];
    const files = seen.filter(function (v, i) { return seen.indexOf(v) === i; });
    if (files.length > 1) {
      console.warn('[assemble-core] ⚠ 重复定义（覆盖式双定义风险）: ' + name + ' 出现在 ' + files.join(' 与 '));
    }
  });
}

if (require.main === module) {
  assemble();
}

module.exports = { assemble };
