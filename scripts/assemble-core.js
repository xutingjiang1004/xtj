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

if (require.main === module) {
  assemble();
}

module.exports = { assemble };
