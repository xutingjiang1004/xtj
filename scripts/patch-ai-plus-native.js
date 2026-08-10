'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'js', 'ai-agent.js');
let s = fs.readFileSync(file, 'utf8');

const marker = '// 创建 + 号按钮';
const i1 = s.indexOf(marker);
const i2 = s.indexOf("var inputBar = el('div', { class: 'ai-chat-input-bar' });");
if (i1 < 0 || i2 < 0) {
  console.error('markers not found', i1, i2);
  process.exit(1);
}
const lineStart = s.lastIndexOf('\n', i1) + 1;

const newBlock = `    // + 菜单：与 Code 工作区一致，走系统级原生控件
    // - 主菜单 / 模型 / 思考 / 搜索：HTML <select> → iOS/Android 系统选择器（液态玻璃）
    // - 上传文件：input[type=file] → 系统文件窗口
    // 不再维护自定义玻璃面板动画与二级页 UI
    var modelLabels = {
      'deepseek-v4-flash': 'V4 Flash',
      'deepseek-v4-pro': 'V4 Pro'
    };
    var thinkLabels = { off: '关闭', low: '轻度', medium: '中度', high: '深度', max: '极致' };

    function openNativePicker(selectEl) {
      if (!selectEl) return false;
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

    function buildNativeSelect(id, ariaLabel, options, value) {
      var sel = el('select', {
        id: id,
        class: 'ai-native-picker',
        'aria-label': ariaLabel,
        tabindex: '-1'
      });
      for (var oi = 0; oi < options.length; oi++) {
        var opt = options[oi];
        var o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (String(opt.value) === String(value)) o.selected = true;
        sel.appendChild(o);
      }
      return sel;
    }

    var plusBtn = el('button', {
      type: 'button',
      class: 'ai-plus-btn',
      id: 'aiPlusBtn',
      'aria-label': '更多选项',
      'aria-haspopup': 'listbox',
      title: '上传文件、模型、思考程度、网页搜索'
    });
    plusBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

    var actionSelect = buildNativeSelect('aiPlusActionSelect', '更多选项', [
      { value: '', label: '选择操作…' },
      { value: 'upload', label: '上传文件' },
      { value: 'model', label: '选择模型' },
      { value: 'think', label: '思考程度' },
      { value: 'search', label: '网页搜索' }
    ], '');

    var modelSelect = buildNativeSelect('aiModelSelect', '选择模型', [
      { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash · 更快' },
      { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro · 更强' }
    ], S.selectedModel || 'deepseek-v4-flash');

    var thinkSelect = buildNativeSelect('aiThinkSelect', '选择思考程度', [
      { value: 'off', label: '关闭' },
      { value: 'low', label: '轻度' },
      { value: 'medium', label: '中度' },
      { value: 'high', label: '深度' },
      { value: 'max', label: '极致' }
    ], S.thinkingMode || 'max');

    var searchSelect = buildNativeSelect('aiSearchSelect', '网页搜索', [
      { value: 'off', label: '网页搜索：关' },
      { value: 'on', label: '网页搜索：开' }
    ], S.webSearchEnabled ? 'on' : 'off');

    function updateModelUI() {
      if (modelSelect && S.selectedModel) {
        try { modelSelect.value = S.selectedModel; } catch (e) {}
      }
    }
    function updateThinkUI() {
      if (thinkSelect && S.thinkingMode) {
        try { thinkSelect.value = S.thinkingMode; } catch (e) {}
      }
    }
    function updateSearchStatus() {
      if (searchSelect) {
        try { searchSelect.value = S.webSearchEnabled ? 'on' : 'off'; } catch (e) {}
      }
      if (plusBtn) {
        if (S.webSearchEnabled) plusBtn.classList.add('ws-on');
        else plusBtn.classList.remove('ws-on');
      }
    }

    plusBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      try { actionSelect.value = ''; } catch (e0) {}
      openNativePicker(actionSelect);
    });

    actionSelect.addEventListener('change', function() {
      var v = actionSelect.value;
      try { actionSelect.value = ''; } catch (eReset) {}
      if (!v) return;
      if (v === 'upload') {
        setTimeout(function() {
          try {
            var fi = document.getElementById('aiChatFileInp');
            if (fi) fi.click();
          } catch (eUp) {}
        }, 0);
        return;
      }
      if (v === 'model') {
        updateModelUI();
        setTimeout(function() { openNativePicker(modelSelect); }, 30);
        return;
      }
      if (v === 'think') {
        updateThinkUI();
        setTimeout(function() { openNativePicker(thinkSelect); }, 30);
        return;
      }
      if (v === 'search') {
        updateSearchStatus();
        setTimeout(function() { openNativePicker(searchSelect); }, 30);
      }
    });

    modelSelect.addEventListener('change', function() {
      var newModel = modelSelect.value;
      if (newModel && newModel !== S.selectedModel) {
        S.selectedModel = newModel;
        S._userPickedModel = true;
        try { localStorage.setItem('xtj_ai_model', newModel); } catch (e) {}
        notify('模型切换: ' + (modelLabels[newModel] || newModel));
      }
    });

    thinkSelect.addEventListener('change', function() {
      var newMode = thinkSelect.value;
      if (newMode && newMode !== S.thinkingMode) {
        S.thinkingMode = newMode;
        S._userPickedThinkingMode = true;
        try { localStorage.setItem('xtj_ai_thinking_mode', newMode); } catch (e) {}
        notify('思考程度: ' + (thinkLabels[newMode] || newMode));
      }
    });

    searchSelect.addEventListener('change', function() {
      S.webSearchEnabled = searchSelect.value === 'on';
      try { localStorage.setItem('xtj_ai_web_search', S.webSearchEnabled ? 'true' : 'false'); } catch (e) {}
      updateSearchStatus();
      notify(S.webSearchEnabled ? '网页搜索已开启' : '网页搜索已关闭');
    });

    S._panelCleanup = function() {};
    S._panelAbortController = null;
    var nativePickers = [actionSelect, modelSelect, thinkSelect, searchSelect];

`;

let out = s.slice(0, lineStart) + newBlock + s.slice(i2);
// Support both LF and CRLF line endings in the source file
const oldAppendLf = "inputBar.appendChild(plusBtn);\n    inputBar.appendChild(panelShell);";
const oldAppendCrlf = "inputBar.appendChild(plusBtn);\r\n    inputBar.appendChild(panelShell);";
const newAppendLf = "inputBar.appendChild(plusBtn);\n    for (var _np = 0; _np < nativePickers.length; _np++) inputBar.appendChild(nativePickers[_np]);";
const newAppendCrlf = "inputBar.appendChild(plusBtn);\r\n    for (var _np = 0; _np < nativePickers.length; _np++) inputBar.appendChild(nativePickers[_np]);";
if (out.includes(oldAppendCrlf)) {
  out = out.replace(oldAppendCrlf, newAppendCrlf);
} else if (out.includes(oldAppendLf)) {
  out = out.replace(oldAppendLf, newAppendLf);
} else {
  console.error('append site not found');
  process.exit(1);
}
fs.writeFileSync(file, out);
console.log('patched ai-agent.js, length', out.length);
console.log('has openNativePicker', out.includes('openNativePicker'));
console.log('has panelShell open?', /ai-plus-panel-shell/.test(out));
