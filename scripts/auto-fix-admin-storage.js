#!/usr/bin/env node
/**
 * auto-fix-admin-storage.js
 *
 * 给 js/admin/admin.js 中未保护的 localStorage / sessionStorage 调用
 * 补上 try/catch，避免隐私模式 / 存储被禁用时抛异常中断管理后台流程
 * （登录初始化 initAdminClient、主题切换、邮件草稿读取等）。
 */

'use strict';
var fs = require('fs');
var path = require('path');

var TARGET = path.join(__dirname, '..', 'js', 'admin', 'admin.js');

function patchOnce(src, oldCode, newCode, label) {
  var idx = src.indexOf(oldCode);
  if (idx === -1) {
    // 幂等：如果新代码已存在则跳过
    if (src.indexOf(newCode) !== -1) {
      console.log('[admin-fix] SKIP (already patched): ' + label);
      return src;
    }
    console.error('[admin-fix] ERROR: block not found for: ' + label);
    process.exit(1);
  }
  if (src.indexOf(oldCode, idx + 1) !== -1) {
    console.error('[admin-fix] ERROR: block matched more than once: ' + label);
    process.exit(1);
  }
  console.log('[admin-fix] OK: ' + label);
  return src.slice(0, idx) + newCode + src.slice(idx + oldCode.length);
}

var src = fs.readFileSync(TARGET, 'utf8');

// 1. saveSession / saveCurrentTab / clearSession
src = patchOnce(src,
  [
    '    function saveSession() {',
    '        localStorage.setItem(SESSION_KEY, JSON.stringify({ t: Date.now() }));',
    '    }',
    '',
    '    function saveCurrentTab() {',
    '        localStorage.setItem(TAB_KEY, currentTab);',
    '    }',
    '',
    '    function clearSession() {',
    '        localStorage.removeItem(SESSION_KEY);',
    '        clearToken();',
    '    }'
  ].join('\n'),
  [
    '    function saveSession() {',
    '        try { localStorage.setItem(SESSION_KEY, JSON.stringify({ t: Date.now() })); } catch(e) {}',
    '    }',
    '',
    '    function saveCurrentTab() {',
    '        try { localStorage.setItem(TAB_KEY, currentTab); } catch(e) {}',
    '    }',
    '',
    '    function clearSession() {',
    '        try { localStorage.removeItem(SESSION_KEY); } catch(e) {}',
    '        clearToken();',
    '    }'
  ].join('\n'),
  'session helpers'
);

// 2. savedTab in initAdminClient
src = patchOnce(src,
  '        var savedTab = localStorage.getItem(TAB_KEY);',
  [
    '        var savedTab = null;',
    '        try { savedTab = localStorage.getItem(TAB_KEY); } catch(e) {}'
  ].join('\n'),
  'savedTab read'
);

// 3. toggleTheme
src = patchOnce(src,
  [
    '        if (isDark) { html.removeAttribute(\'data-theme\'); localStorage.setItem(\'xtj-admin-theme\', \'light\'); }',
    '        else { html.setAttribute(\'data-theme\', \'dark\'); localStorage.setItem(\'xtj-admin-theme\', \'dark\'); }'
  ].join('\n'),
  [
    '        if (isDark) { html.removeAttribute(\'data-theme\'); try { localStorage.setItem(\'xtj-admin-theme\', \'light\'); } catch(e) {} }',
    '        else { html.setAttribute(\'data-theme\', \'dark\'); try { localStorage.setItem(\'xtj-admin-theme\', \'dark\'); } catch(e) {} }'
  ].join('\n'),
  'toggleTheme'
);

// 4. applySavedAdminTheme
src = patchOnce(src,
  [
    '    function applySavedAdminTheme() {',
    '        var saved = localStorage.getItem(\'xtj-admin-theme\');'
  ].join('\n'),
  [
    '    function applySavedAdminTheme() {',
    '        var saved = null;',
    '        try { saved = localStorage.getItem(\'xtj-admin-theme\'); } catch(e) {}'
  ].join('\n'),
  'applySavedAdminTheme'
);

// 5. Email draft read in panel init
src = patchOnce(src,
  [
    '        // 检查是否有草稿',
    '        var draftSubject = sessionStorage.getItem(\'xtj_email_draft_subject\');',
    '        var draftContent = sessionStorage.getItem(\'xtj_email_draft_content\');'
  ].join('\n'),
  [
    '        // 检查是否有草稿',
    '        var draftSubject = null, draftContent = null;',
    '        try {',
    '            draftSubject = sessionStorage.getItem(\'xtj_email_draft_subject\');',
    '            draftContent = sessionStorage.getItem(\'xtj_email_draft_content\');',
    '        } catch(e) {}'
  ].join('\n'),
  'email draft read in panel'
);

// 6. emailRestoreDraft
src = patchOnce(src,
  [
    '    window.emailRestoreDraft = function() {',
    '        var sub = sessionStorage.getItem(\'xtj_email_draft_subject\');',
    '        var con = sessionStorage.getItem(\'xtj_email_draft_content\');'
  ].join('\n'),
  [
    '    window.emailRestoreDraft = function() {',
    '        var sub = null, con = null;',
    '        try {',
    '            sub = sessionStorage.getItem(\'xtj_email_draft_subject\');',
    '            con = sessionStorage.getItem(\'xtj_email_draft_content\');',
    '        } catch(e) {}'
  ].join('\n'),
  'emailRestoreDraft'
);

// 7. emailUpdateDraftBarVisibility
src = patchOnce(src,
  [
    '    function emailUpdateDraftBarVisibility() {',
    '        var bar = document.getElementById(\'emailDraftBar\');',
    '        if (!bar) return;',
    '        var sub = sessionStorage.getItem(\'xtj_email_draft_subject\');',
    '        var con = sessionStorage.getItem(\'xtj_email_draft_content\');'
  ].join('\n'),
  [
    '    function emailUpdateDraftBarVisibility() {',
    '        var bar = document.getElementById(\'emailDraftBar\');',
    '        if (!bar) return;',
    '        var sub = null, con = null;',
    '        try {',
    '            sub = sessionStorage.getItem(\'xtj_email_draft_subject\');',
    '            con = sessionStorage.getItem(\'xtj_email_draft_content\');',
    '        } catch(e) {}'
  ].join('\n'),
  'emailUpdateDraftBarVisibility'
);

// 语法自检
try {
  new Function(src);
} catch (syntaxErr) {
  console.error('[admin-fix] ERROR: syntax check failed:', syntaxErr.message);
  process.exit(1);
}

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[admin-fix] All patches applied successfully.');
