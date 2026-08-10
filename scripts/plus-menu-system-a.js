'use strict';
/**
 * Plan A: system-level + menu
 * - Primary: transparent <select> overlay on + button (works desktop + iOS without showPicker quirks)
 * - Secondary: thinking-level <select> opened via showPicker after choosing「思考程度…」
 */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'js', 'ai-agent.js');
let s = fs.readFileSync(file, 'utf8');

const startMark = '    // + 菜单：';
const i1 = s.indexOf(startMark);
const i2 = s.indexOf("var inputBar = el('div', { class: 'ai-chat-input-bar' });");
if (i1 < 0 || i2 < 0) {
  console.error('markers not found', i1, i2);
  process.exit(1);
}

const block = `    // + 菜单方案 A：系统级 <select>
    // - 主菜单：透明 select 叠在 + 上（桌面/iOS 一次点开，不靠脆弱的 showPicker 主路径）
    // - 二级：选「思考程度…」后再弹系统思考列表（showPicker / 回退 click）
    // - 模型、搜索在主列表直接选，避免全挤二级又关菜单
    var modelLabels = {
      'deepseek-v4-flash': 'V4 Flash',
      'deepseek-v4-pro': 'V4 Pro'
    };
    var thinkLabels = { off: '关闭', low: '轻度', medium: '中度', high: '深度', max: '极致' };

    function openNativePicker(selectEl) {
      if (!selectEl || !selectEl.isConnected) return false;
      try {
        if (typeof selectEl.showPicker === 'function') {
          selectEl.showPicker();
          return true;
        }
      } catch (e1) {}
      try {
        selectEl.focus({ preventScroll: true });
        selectEl.click();
        return true;
      } catch (e2) {
        return false;
      }
    }

    function fillSelect(sel, options, selectedValue) {
      sel.innerHTML = '';
      for (var i = 0; i < options.length; i++) {
        var opt = options[i];
        var o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (selectedValue != null && String(opt.value) === String(selectedValue)) o.selected = true;
        sel.appendChild(o);
      }
    }

    var plusWrap = el('div', { class: 'ai-plus-wrap', id: 'aiPlusWrap' });
    var plusBtn = el('button', {
      type: 'button',
      class: 'ai-plus-btn',
      id: 'aiPlusBtn',
      tabindex: '-1',
      'aria-hidden': 'true',
      title: '更多选项'
    });
    plusBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

    // 主菜单：盖在 + 上，系统列表
    var actionSelect = el('select', {
      id: 'aiPlusActionSelect',
      class: 'ai-plus-select-hit',
      'aria-label': '更多选项'
    });

    // 二级：思考程度
    var thinkSelect = el('select', {
      id: 'aiPlusThinkSelect',
      class: 'ai-native-picker',
      'aria-label': '思考程度',
      tabindex: '-1'
    });

    function rebuildActionOptions() {
      var curModel = S.selectedModel || 'deepseek-v4-flash';
      var curThink = S.thinkingMode || 'max';
      var wsOn = !!S.webSearchEnabled;
      fillSelect(actionSelect, [
        { value: '', label: '选择操作…' },
        { value: 'upload', label: '上传文件' },
        { value: 'model:deepseek-v4-flash', label: (curModel === 'deepseek-v4-flash' ? '✓ ' : '') + '模型 · V4 Flash（更快）' },
        { value: 'model:deepseek-v4-pro', label: (curModel === 'deepseek-v4-pro' ? '✓ ' : '') + '模型 · V4 Pro（更强）' },
        { value: 'think', label: '思考程度 · ' + (thinkLabels[curThink] || curThink) + ' ›' },
        { value: 'search:on', label: (wsOn ? '✓ ' : '') + '网页搜索 · 开' },
        { value: 'search:off', label: (!wsOn ? '✓ ' : '') + '网页搜索 · 关' }
      ], '');
    }

    function rebuildThinkOptions() {
      var cur = S.thinkingMode || 'max';
      fillSelect(thinkSelect, [
        { value: '', label: '选择思考程度…' },
        { value: 'off', label: (cur === 'off' ? '✓ ' : '') + '关闭' },
        { value: 'low', label: (cur === 'low' ? '✓ ' : '') + '轻度' },
        { value: 'medium', label: (cur === 'medium' ? '✓ ' : '') + '中度' },
        { value: 'high', label: (cur === 'high' ? '✓ ' : '') + '深度' },
        { value: 'max', label: (cur === 'max' ? '✓ ' : '') + '极致' }
      ], '');
    }

    function updateModelUI() { rebuildActionOptions(); }
    function updateThinkUI() {
      rebuildThinkOptions();
      rebuildActionOptions();
    }
    function updateSearchStatus() {
      rebuildActionOptions();
      if (plusBtn) {
        if (S.webSearchEnabled) plusBtn.classList.add('ws-on');
        else plusBtn.classList.remove('ws-on');
      }
      if (plusWrap) {
        if (S.webSearchEnabled) plusWrap.classList.add('ws-on');
        else plusWrap.classList.remove('ws-on');
      }
    }

    // 打开主菜单：优先 showPicker，失败则依赖透明 select 本地点击（桌面）
    function openMainMenu() {
      rebuildActionOptions();
      actionSelect.value = '';
      // 预热：部分浏览器要求 focus
      try { actionSelect.focus({ preventScroll: true }); } catch (e) {}
      if (!openNativePicker(actionSelect)) {
        // 桌面旧浏览器：无法 showPicker 时，用户可再点透明 select 区域
        try { actionSelect.click(); } catch (e2) {}
      }
    }

    // + 视觉按钮也可点（部分无障碍场景）
    plusBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      openMainMenu();
    });

    // 透明 select 自己被点时也刷新选项（桌面原生下拉）
    actionSelect.addEventListener('focus', function() {
      rebuildActionOptions();
    });
    actionSelect.addEventListener('mousedown', function() {
      rebuildActionOptions();
    });

    actionSelect.addEventListener('change', function() {
      var v = actionSelect.value;
      try { actionSelect.value = ''; } catch (e0) {}
      if (!v) return;

      if (v === 'upload') {
        try {
          var fi = document.getElementById('aiChatFileInp');
          if (fi) fi.click();
        } catch (eUp) {}
        return;
      }

      if (v.indexOf('model:') === 0) {
        var newModel = v.slice(6);
        if (newModel && newModel !== S.selectedModel) {
          S.selectedModel = newModel;
          S._userPickedModel = true;
          try { localStorage.setItem('xtj_ai_model', newModel); } catch (e) {}
          notify('模型：' + (modelLabels[newModel] || newModel));
        }
        updateModelUI();
        return;
      }

      if (v === 'think') {
        // 二级：系统思考列表（尽量同步调用，保住用户手势）
        rebuildThinkOptions();
        thinkSelect.value = '';
        var opened = openNativePicker(thinkSelect);
        if (!opened) {
          // 手势丢失时给一次明确提示，并让二次点 + 也能进思考列表
          try { notify('请再点一次 +，或直接选择思考程度'); } catch (eN) {}
          // 把主菜单临时改成「仅思考选项」，用户再点 + 即可
          fillSelect(actionSelect, [
            { value: '', label: '选择思考程度…' },
            { value: 'think:off', label: '关闭' },
            { value: 'think:low', label: '轻度' },
            { value: 'think:medium', label: '中度' },
            { value: 'think:high', label: '深度' },
            { value: 'think:max', label: '极致' },
            { value: 'back', label: '‹ 返回主菜单' }
          ], '');
        }
        return;
      }

      if (v.indexOf('think:') === 0) {
        var mode = v.slice(6);
        if (mode && mode !== S.thinkingMode) {
          S.thinkingMode = mode;
          S._userPickedThinkingMode = true;
          try { localStorage.setItem('xtj_ai_thinking_mode', mode); } catch (e) {}
          notify('思考程度：' + (thinkLabels[mode] || mode));
        }
        updateThinkUI();
        return;
      }

      if (v === 'back') {
        rebuildActionOptions();
        return;
      }

      if (v === 'search:on' || v === 'search:off') {
        S.webSearchEnabled = v === 'search:on';
        try { localStorage.setItem('xtj_ai_web_search', S.webSearchEnabled ? 'true' : 'false'); } catch (e) {}
        updateSearchStatus();
        notify(S.webSearchEnabled ? '网页搜索已开启' : '网页搜索已关闭');
      }
    });

    thinkSelect.addEventListener('change', function() {
      var mode = thinkSelect.value;
      try { thinkSelect.value = ''; } catch (e0) {}
      if (!mode) return;
      if (mode !== S.thinkingMode) {
        S.thinkingMode = mode;
        S._userPickedThinkingMode = true;
        try { localStorage.setItem('xtj_ai_thinking_mode', mode); } catch (e) {}
        notify('思考程度：' + (thinkLabels[mode] || mode));
      }
      updateThinkUI();
    });

    plusWrap.appendChild(plusBtn);
    plusWrap.appendChild(actionSelect);

    S._panelCleanup = function() {};
    S._panelAbortController = null;

    rebuildActionOptions();
    rebuildThinkOptions();
    updateSearchStatus();

`;

let out = s.slice(0, i1) + block + s.slice(i2);

// Fix append: panelShell / nativePickers → plusWrap + thinkSelect
out = out.replace(
  /inputBar\.appendChild\(plusBtn\);\s*inputBar\.appendChild\(panelShell\);/,
  'inputBar.appendChild(plusWrap);\n    inputBar.appendChild(thinkSelect);'
);
out = out.replace(
  /inputBar\.appendChild\(plusBtn\);\s*for \(var _np = 0; _np < nativePickers\.length; _np\+\+\) inputBar\.appendChild\(nativePickers\[_np\]\);/,
  'inputBar.appendChild(plusWrap);\n    inputBar.appendChild(thinkSelect);'
);
// If only plusBtn was appended somehow
if (!out.includes('appendChild(plusWrap)')) {
  out = out.replace(
    /inputBar\.appendChild\(plusBtn\);/,
    'inputBar.appendChild(plusWrap);\n    inputBar.appendChild(thinkSelect);'
  );
}

// Fix indent on inputBar line if broken
out = out.replace(/\n\s*var inputBar = el\('div', \{ class: 'ai-chat-input-bar' \}\);/, "\n    var inputBar = el('div', { class: 'ai-chat-input-bar' });");

fs.writeFileSync(file, out);
console.log('ok system A menu');
console.log('plusWrap', out.includes('ai-plus-wrap'));
console.log('thinkSelect', out.includes('aiPlusThinkSelect'));
console.log('panelShell left', out.includes('ai-plus-panel-shell'));
console.log('append plusWrap', out.includes('appendChild(plusWrap)'));
