/**
 * Split js/core.js into editable parts under js/core-parts/,
 * extract pure window utils into js/core-utils.js,
 * and write scripts/assemble-core.js output contract.
 *
 * Source of truth after split: js/core-parts/*.js + js/core-utils.js
 * Runtime still loads core.min.js (assembled) + core-utils.min.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const corePath = path.join(ROOT, 'js', 'core.js');
const partsDir = path.join(ROOT, 'js', 'core-parts');
const utilsPath = path.join(ROOT, 'js', 'core-utils.js');

const raw = fs.readFileSync(corePath, 'utf8');
const lines = raw.split(/\n/);
const hadCRLF = /\r\n/.test(raw);

function sliceLines(start1, end1Inclusive) {
  return lines.slice(start1 - 1, end1Inclusive).join('\n');
}

function writeFile(p, content, banner) {
  let out = content;
  if (banner) out = banner + '\n' + out;
  if (!out.endsWith('\n')) out += '\n';
  if (hadCRLF) out = out.replace(/\n/g, '\r\n');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, out, 'utf8');
  console.log('[write]', path.relative(ROOT, p), 'lines~', out.split(/\n/).length);
}

// ---- 1) core-utils.js from pure window helpers (lines 1-61) ----
// Find end of safeParseDate function
let utilsEnd = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('// console.log(\'[XTJ] core.js loaded')) {
    utilsEnd = i; // exclusive
    break;
  }
  if (i > 0 && lines[i].includes('XTJ_RUNTIME_CONFIG') && utilsEnd === 0) {
    utilsEnd = i;
    break;
  }
}
if (utilsEnd < 30) {
  // fallback: first blank line after safeParseDate return
  for (let i = 60; i < 80; i++) {
    if (lines[i].trim() === '' && lines[i + 1] && lines[i + 1].includes('XTJ')) {
      utilsEnd = i + 1;
      break;
    }
  }
}
if (utilsEnd < 30) throw new Error('utils end not found');

const utilsBody = lines.slice(0, utilsEnd).join('\n').replace(/\s+$/, '') + '\n';
writeFile(utilsPath, utilsBody, '/** Shared window utils — loaded before core.js */');

// ---- 2) Split remainder into parts by stable anchors ----
const bodyLines = lines.slice(utilsEnd);
// Recompute absolute line numbers: body line 0 = original utilsEnd+1
function absLine(bodyIdx0) {
  return utilsEnd + bodyIdx0 + 1;
}

// Find anchors in full file (1-based)
function findAbs(re, fromAbs) {
  const from = (fromAbs || 1) - 1;
  for (let i = from; i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return -1;
}

const aConfig = utilsEnd + 1; // first line of body
const aSecondary = findAbs(/^\(function\(\) \{\s*$/, aConfig);
const aAuthMark = findAbs(/\/\/ =+ 认证标记/, aConfig);
const aProfile = findAbs(/\/\/ =+ 查看用户资料卡|\/\/ ========== 查看用户资料卡/, aConfig);
const aLikes = findAbs(/\/\/ =+ 点赞/, aConfig);
const aStats = findAbs(/\/\/ =+ 数据统计详情功能|let statCurrentType/, aConfig);
const aDockChat = findAbs(/window\.switchDockTab\s*=\s*function/, aConfig);
// Prefer a section before switchDockTab - look for dock chat container helpers
const aChatSection = findAbs(/function dockChatGoBack|function loadDockChatList|\/\/ =+ .*聊天/, Math.max(aConfig, aStats > 0 ? aStats : aConfig));
const aAnnouncements = findAbs(/function loadAnnouncements|window\.openAnnouncementModal|\/\/ =+ 公告/, aDockChat > 0 ? aDockChat : aConfig);
const aEmergency = findAbs(/installEmergencyActionRescue/, aConfig);
const aFinal = findAbs(/installFinalUiAndDataOverrides/, aConfig);
const lastLine = lines.length;

console.log('anchors', {
  aConfig, aSecondary, aAuthMark, aProfile, aLikes, aStats,
  aChatSection, aDockChat, aAnnouncements, aEmergency, aFinal, lastLine
});

// Build parts with safe fallbacks
const parts = [];

function addPart(name, startAbs, endAbsInclusive, title) {
  if (startAbs < 1 || endAbsInclusive < startAbs) {
    throw new Error('bad part ' + name + ' ' + startAbs + '-' + endAbsInclusive);
  }
  parts.push({ name: name, start: startAbs, end: endAbsInclusive, title: title });
}

// 01: bootstrap / config / secondary page / early session (until auth markers)
const p01end = aAuthMark > 0 ? aAuthMark - 1 : (aProfile > 0 ? aProfile - 1 : 2000);
addPart('01-bootstrap', aConfig, p01end, 'Config, session bootstrap, secondary-page state');

// 02: auth + restrictions until profile card
const p02start = p01end + 1;
const p02end = aProfile > 0 ? aProfile - 1 : (aLikes > 0 ? aLikes - 1 : p02start + 500);
addPart('02-auth-restrictions', p02start, p02end, 'Auth markers, restrictions, admin login helpers');

// 03: profile / reports / cat-ai poll until likes
const p03start = p02end + 1;
const p03end = aLikes > 0 ? aLikes - 1 : (aStats > 0 ? aStats - 1 : p03start + 1000);
addPart('03-profile-report-ai', p03start, p03end, 'Profile card, activity, reports, cat-AI comment polling');

// 04: likes / post tools / delete / image viewer / view history until stats
const p04start = p03end + 1;
const p04end = aStats > 0 ? aStats - 1 : (aDockChat > 0 ? aDockChat - 1 : p04start + 1000);
addPart('04-posts-interactions', p04start, p04end, 'Likes, post tools, delete, image viewer, view history, feed helpers');

// 05: stats vars + feed render until dock chat (do NOT cut mid-function)
const p05start = p04end + 1;
// Prefer start of chat list area: look for "function loadConversations" or dockChatList
let chatStart = findAbs(/function loadConversations|function renderChatList|id=\"dockChatList\"|dockChatListView/, p05start);
if (chatStart < 0) chatStart = aDockChat > 0 ? aDockChat : -1;
// Walk back to a clean section comment if possible
if (chatStart > 0) {
  for (let i = chatStart - 1; i > chatStart - 40 && i > p05start; i--) {
    if (/^[\s]*\/\/ =+/.test(lines[i - 1])) {
      chatStart = i;
      break;
    }
  }
}
const p05end = chatStart > 0 ? chatStart - 1 : (aEmergency > 0 ? aEmergency - 1 : p05start + 2000);
addPart('05-feed-stats', p05start, p05end, 'Feed render, filters, stats state (pre-chat)');

// 06: chat + dock tab switching until announcements/final
// NOTE: dock logic is MOVED not modified — keep byte-identical content
const p06start = p05end + 1;
const p06end = aEmergency > 0 ? aEmergency - 1 : lastLine;
addPart('06-chat-and-nav', p06start, p06end, 'Dock chat, switchDockTab, announcements/report mid-layer (behavior preserved)');

// 07: final overrides IIFEs
if (aEmergency > 0) {
  addPart('07-final-overrides', aEmergency, lastLine, 'Emergency rescue + final UI/data overrides');
}

// Validate coverage: continuous, no gaps, no overlap
parts.sort((a, b) => a.start - b.start);
if (parts[0].start !== aConfig) throw new Error('parts do not start at body');
for (let i = 1; i < parts.length; i++) {
  if (parts[i].start !== parts[i - 1].end + 1) {
    throw new Error('gap/overlap between ' + parts[i - 1].name + ' and ' + parts[i].name +
      ' (' + parts[i - 1].end + ' -> ' + parts[i].start + ')');
  }
}
if (parts[parts.length - 1].end !== lastLine) {
  throw new Error('parts do not cover file end: ' + parts[parts.length - 1].end + ' vs ' + lastLine);
}

// Write parts
fs.mkdirSync(partsDir, { recursive: true });
// clean old parts
fs.readdirSync(partsDir).forEach(function (f) {
  if (f.endsWith('.js')) fs.unlinkSync(path.join(partsDir, f));
});

const manifest = [];
parts.forEach(function (p, idx) {
  const fileName = p.name + '.js';
  const banner = [
    '/**',
    ' * core-parts/' + fileName,
    ' * ' + p.title,
    ' * Lines from original core.js: ' + p.start + '-' + p.end,
    ' * DO NOT edit js/core.js directly — edit this file, then run: node scripts/assemble-core.js',
    ' */'
  ].join('\n');
  const body = sliceLines(p.start, p.end);
  writeFile(path.join(partsDir, fileName), body, banner);
  manifest.push(fileName);
});

writeFile(path.join(partsDir, 'MANIFEST.json'), JSON.stringify({
  version: 1,
  utils: 'js/core-utils.js',
  parts: manifest.map(function (f) { return 'js/core-parts/' + f; }),
  note: 'Assemble with node scripts/assemble-core.js (also run by npm run build)'
}, null, 2));

// Run assemble once
const { assemble } = require('./assemble-core.js');
assemble();

// Verify round-trip: assembled body (without banner) should match original body
const assembled = fs.readFileSync(corePath, 'utf8');
// Strip banner
const assembledBody = assembled.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '');
const originalBody = lines.slice(utilsEnd).join('\n').replace(/\s+$/, '') + '\n';
// Compare ignoring part banners inside
const stripPartBanners = (t) => t.replace(/\/\*\*\n \* core-parts\/[\s\S]*?\*\/\n/g, '');
const a = stripPartBanners(assembledBody).replace(/\r\n/g, '\n');
const b = originalBody.replace(/\r\n/g, '\n');
if (a !== b) {
  // show first diff
  const al = a.split('\n');
  const bl = b.split('\n');
  console.log('assembled lines', al.length, 'original body lines', bl.length);
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) {
      console.log('first diff at line', i + 1);
      console.log('A:', JSON.stringify((al[i] || '').slice(0, 120)));
      console.log('B:', JSON.stringify((bl[i] || '').slice(0, 120)));
      break;
    }
  }
  // Not fatal if only trailing newlines differ after banner strip - but log warning
  console.warn('[warn] assembled body differs from original (see above). Review carefully.');
} else {
  console.log('[ok] assembled body matches original body exactly (part banners stripped)');
}

console.log('[done] core split complete');
