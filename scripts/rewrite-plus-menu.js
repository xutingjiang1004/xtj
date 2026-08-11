// ============================================================================
// ⚠️ 一次性补丁/诊断脚本 —— 请勿重跑
// ----------------------------------------------------------------------------
// 本脚本针对特定历史代码状态编写（部分以源码行号偏移 + 字符串锚点改写
// js/* 与 js/core-parts/*），对应改动已合入当前源码；直接重跑可能因锚点
// 失效而报错或静默误改源码。请仅作历史排查参考，使命完成后可移入
// scripts/archive/。
// ============================================================================

'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'js', 'ai-agent.js');
let s = fs.readFileSync(file, 'utf8');

const start = s.indexOf('    // + 菜单：与 Code 工作区一致');
const altStart = s.indexOf('    // + 菜单：');
const i1 = start >= 0 ? start : altStart;
const i2 = s.indexOf("var inputBar = el('div', { class: 'ai-chat-input-bar' });");
if (i1 < 0 || i2 < 0) {
  console.error('markers not found', i1, i2);
  process.exit(1);
}

const block = `    // + 菜单：自定义二级面板（系统 <select> 无法：从按钮展开/收回、保持打开、二级页）
    // 主页：上传 / 模型 / 思考程度 / 网页搜索开关
    // 二级：模型列表、思考程度列表；选择后停留在菜单，方便连着改
    var modelLabels = {
      'deepseek-v4-flash': 'V4 Flash',
      'deepseek-v4-pro': 'V4 Pro'
    };
    var thinkLabels = { off: '关闭', low: '轻度', medium: '中度', high: '深度', max: '极致' };

    var plusBtn = el('button', {
      type: 'button',
      class: 'ai-plus-btn',
      id: 'aiPlusBtn',
      'aria-label': '更多选项',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-controls': 'aiPlusPanelShell',
      title: '上传文件、模型、思考程度、网页搜索'
    });
    plusBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

    var panelShell = el('div', {
      class: 'ai-plus-panel-shell',
      id: 'aiPlusPanelShell',
      role: 'menu',
      'aria-label': '更多选项'
    });
    panelShell.innerHTML =
      '<div class="ai-plus-panel-content">' +
        '<div class="ai-panel-page ai-panel-page-primary is-active" id="aiPanelPrimary" data-page="primary">' +
          '<button type="button" class="ai-panel-option" role="menuitem" data-action="upload">' +
            '<span class="ai-panel-option-icon" aria-hidden="true">📎</span>' +
            '<span class="ai-panel-option-text">上传文件</span>' +
          '</button>' +
          '<div class="ai-panel-separator" role="separator"></div>' +
          '<button type="button" class="ai-panel-option" role="menuitem" data-action="model">' +
            '<span class="ai-panel-option-icon" aria-hidden="true">💻</span>' +
            '<span class="ai-panel-option-text">模型</span>' +
            '<span class="ai-panel-option-value" id="aiPlusModelValue">V4 Flash</span>' +
            '<span class="ai-panel-chevron" aria-hidden="true">›</span>' +
          '</button>' +
          '<button type="button" class="ai-panel-option" role="menuitem" data-action="think">' +
            '<span class="ai-panel-option-icon" aria-hidden="true">💭</span>' +
            '<span class="ai-panel-option-text">思考程度</span>' +
            '<span class="ai-panel-option-value" id="aiPlusThinkValue">深度</span>' +
            '<span class="ai-panel-chevron" aria-hidden="true">›</span>' +
          '</button>' +
          '<div class="ai-panel-separator" role="separator"></div>' +
          '<button type="button" class="ai-panel-option ai-panel-option-toggle" role="menuitemcheckbox" data-action="search" aria-checked="false">' +
            '<span class="ai-panel-option-icon" aria-hidden="true">🔍</span>' +
            '<span class="ai-panel-option-text">网页搜索</span>' +
            '<span class="ai-search-status" id="aiSearchStatus">关</span>' +
          '</button>' +
        '</div>' +
        '<div class="ai-panel-page ai-panel-page-secondary" id="aiPanelModel" data-page="model" hidden>' +
          '<button type="button" class="ai-panel-back" data-back="primary" aria-label="返回">' +
            '<span aria-hidden="true">‹</span><span>模型</span>' +
          '</button>' +
          '<div class="ai-panel-options-group" role="radiogroup" aria-label="选择模型">' +
            '<button type="button" class="ai-panel-option" role="radio" data-model="deepseek-v4-flash" aria-checked="false">' +
              '<span class="ai-panel-option-body"><span class="ai-panel-option-label">DeepSeek V4 Flash</span><span class="ai-panel-option-desc">速度更快，适合日常聊天</span></span>' +
              '<span class="ai-panel-check" aria-hidden="true">✓</span>' +
            '</button>' +
            '<button type="button" class="ai-panel-option" role="radio" data-model="deepseek-v4-pro" aria-checked="false">' +
              '<span class="ai-panel-option-body"><span class="ai-panel-option-label">DeepSeek V4 Pro</span><span class="ai-panel-option-desc">能力更强，适合复杂任务</span></span>' +
              '<span class="ai-panel-check" aria-hidden="true">✓</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="ai-panel-page ai-panel-page-secondary" id="aiPanelThink" data-page="think" hidden>' +
          '<button type="button" class="ai-panel-back" data-back="primary" aria-label="返回">' +
            '<span aria-hidden="true">‹</span><span>思考程度</span>' +
          '</button>' +
          '<div class="ai-panel-options-group" role="radiogroup" aria-label="选择思考程度">' +
            '<button type="button" class="ai-panel-option" role="radio" data-think="off" aria-checked="false"><span>关闭</span><span class="ai-panel-check" aria-hidden="true">✓</span></button>' +
            '<button type="button" class="ai-panel-option" role="radio" data-think="low" aria-checked="false"><span>轻度</span><span class="ai-panel-check" aria-hidden="true">✓</span></button>' +
            '<button type="button" class="ai-panel-option" role="radio" data-think="medium" aria-checked="false"><span>中度</span><span class="ai-panel-check" aria-hidden="true">✓</span></button>' +
            '<button type="button" class="ai-panel-option" role="radio" data-think="high" aria-checked="false"><span>深度</span><span class="ai-panel-check" aria-hidden="true">✓</span></button>' +
            '<button type="button" class="ai-panel-option" role="radio" data-think="max" aria-checked="false"><span>极致</span><span class="ai-panel-check" aria-hidden="true">✓</span></button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var panelOpen = false;
    var panelClosing = false;
    var currentPage = 'primary';
    var closeTimer = null;
    var pageEls = {
      primary: panelShell.querySelector('#aiPanelPrimary'),
      model: panelShell.querySelector('#aiPanelModel'),
      think: panelShell.querySelector('#aiPanelThink')
    };

    function updateModelUI() {
      var v = panelShell.querySelector('#aiPlusModelValue');
      if (v) v.textContent = modelLabels[S.selectedModel] || S.selectedModel || 'V4 Flash';
      var radios = panelShell.querySelectorAll('[data-model]');
      for (var i = 0; i < radios.length; i++) {
        var on = radios[i].getAttribute('data-model') === S.selectedModel;
        radios[i].setAttribute('aria-checked', on ? 'true' : 'false');
        radios[i].classList.toggle('is-selected', on);
      }
    }
    function updateThinkUI() {
      var v = panelShell.querySelector('#aiPlusThinkValue');
      if (v) v.textContent = thinkLabels[S.thinkingMode] || S.thinkingMode || '深度';
      var radios = panelShell.querySelectorAll('[data-think]');
      for (var i = 0; i < radios.length; i++) {
        var on = radios[i].getAttribute('data-think') === S.thinkingMode;
        radios[i].setAttribute('aria-checked', on ? 'true' : 'false');
        radios[i].classList.toggle('is-selected', on);
      }
    }
    function updateSearchStatus() {
      var st = panelShell.querySelector('#aiSearchStatus');
      var btn = panelShell.querySelector('[data-action="search"]');
      if (st) {
        st.textContent = S.webSearchEnabled ? '开' : '关';
        st.classList.toggle('on', !!S.webSearchEnabled);
      }
      if (btn) {
        btn.setAttribute('aria-checked', S.webSearchEnabled ? 'true' : 'false');
        btn.classList.toggle('is-selected', !!S.webSearchEnabled);
      }
      if (plusBtn) {
        if (S.webSearchEnabled) plusBtn.classList.add('ws-on');
        else plusBtn.classList.remove('ws-on');
      }
    }

    function showPage(pageId) {
      currentPage = pageId;
      Object.keys(pageEls).forEach(function(key) {
        var elp = pageEls[key];
        if (!elp) return;
        var active = key === pageId;
        elp.hidden = !active;
        elp.classList.toggle('is-active', active);
        elp.setAttribute('aria-hidden', active ? 'false' : 'true');
      });
    }

    function positionPanel() {
      // 锚定在 + 按钮上方：从按钮中心展开
      if (!plusBtn || !panelShell || !panelShell.parentNode) return;
      var btnRect = plusBtn.getBoundingClientRect();
      var bar = panelShell.parentNode.getBoundingClientRect();
      // 相对 inputBar 定位
      var left = btnRect.left - bar.left + btnRect.width / 2 - 20;
      // 限制不超出右边界
      var maxLeft = Math.max(8, bar.width - 268);
      if (left > maxLeft) left = maxLeft;
      if (left < 8) left = 8;
      panelShell.style.left = left + 'px';
      panelShell.style.right = 'auto';
      // 展开原点：按钮中心相对面板底部
      var originX = Math.round(btnRect.left + btnRect.width / 2 - bar.left - left);
      panelShell.style.transformOrigin = originX + 'px 100%';
    }

    function openPanel() {
      if (panelOpen || panelClosing) return;
      panelOpen = true;
      showPage('primary');
      updateModelUI();
      updateThinkUI();
      updateSearchStatus();
      positionPanel();
      // 强制一帧 closed 态再 open，保证从按钮缩放动画
      panelShell.classList.remove('is-closing', 'open');
      panelShell.classList.add('is-opening');
      plusBtn.classList.add('active');
      plusBtn.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          if (!panelOpen) return;
          panelShell.classList.add('open');
        });
      });
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(function() {
        panelShell.classList.remove('is-opening');
        closeTimer = null;
      }, 320);
    }

    function closePanel(animate) {
      if (!panelOpen || panelClosing) return;
      panelClosing = true;
      panelOpen = false;
      showPage('primary');
      panelShell.classList.remove('is-opening');
      panelShell.classList.add('is-closing');
      panelShell.classList.remove('open');
      plusBtn.classList.remove('active');
      plusBtn.setAttribute('aria-expanded', 'false');
      if (animate === false) {
        panelShell.classList.remove('is-closing');
        panelClosing = false;
        return;
      }
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(function() {
        panelShell.classList.remove('is-closing');
        panelClosing = false;
        closeTimer = null;
      }, 280);
    }

    plusBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (panelOpen) closePanel();
      else openPanel();
    });

    panelShell.addEventListener('click', function(e) {
      e.stopPropagation();
      var t = e.target.closest('[data-action], [data-back], [data-model], [data-think]');
      if (!t) return;

      if (t.hasAttribute('data-back')) {
        showPage('primary');
        return;
      }
      var action = t.getAttribute('data-action');
      if (action === 'upload') {
        closePanel();
        setTimeout(function() {
          var fi = document.getElementById('aiChatFileInp');
          if (fi) fi.click();
        }, 50);
        return;
      }
      if (action === 'model') {
        showPage('model');
        return;
      }
      if (action === 'think') {
        showPage('think');
        return;
      }
      if (action === 'search') {
        S.webSearchEnabled = !S.webSearchEnabled;
        try { localStorage.setItem('xtj_ai_web_search', S.webSearchEnabled ? 'true' : 'false'); } catch (err) {}
        updateSearchStatus();
        notify(S.webSearchEnabled ? '网页搜索已开启' : '网页搜索已关闭');
        // 不关闭菜单
        return;
      }

      var model = t.getAttribute('data-model');
      if (model) {
        if (model !== S.selectedModel) {
          S.selectedModel = model;
          S._userPickedModel = true;
          try { localStorage.setItem('xtj_ai_model', model); } catch (err) {}
          notify('模型：' + (modelLabels[model] || model));
        }
        updateModelUI();
        // 选完回到主页，菜单保持打开，方便继续改思考
        showPage('primary');
        return;
      }
      var think = t.getAttribute('data-think');
      if (think) {
        if (think !== S.thinkingMode) {
          S.thinkingMode = think;
          S._userPickedThinkingMode = true;
          try { localStorage.setItem('xtj_ai_thinking_mode', think); } catch (err) {}
          notify('思考程度：' + (thinkLabels[think] || think));
        }
        updateThinkUI();
        showPage('primary');
      }
    });

    var panelAbortController = new AbortController();
    document.addEventListener('click', function(e) {
      if (!panelOpen) return;
      if (panelShell.contains(e.target) || plusBtn.contains(e.target) || e.target === plusBtn) return;
      closePanel();
    }, { signal: panelAbortController.signal });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && panelOpen) {
        if (currentPage !== 'primary') showPage('primary');
        else closePanel();
      }
    }, { signal: panelAbortController.signal });
    window.addEventListener('resize', function() {
      if (panelOpen) positionPanel();
    }, { signal: panelAbortController.signal, passive: true });

    S._panelAbortController = panelAbortController;
    S._panelCleanup = function() {
      try { panelAbortController.abort(); } catch (e) {}
      if (closeTimer) clearTimeout(closeTimer);
      panelOpen = false;
      panelClosing = false;
    };

    updateModelUI();
    updateThinkUI();
    updateSearchStatus();

`;

// Replace from i1 up to (but not including) inputBar declaration
const out = s.slice(0, i1) + block + s.slice(i2);

// Fix append of nativePickers -> panelShell
let out2 = out.replace(
  /for \(var _np = 0; _np < nativePickers\.length; _np\+\+\) inputBar\.appendChild\(nativePickers\[_np\]\);/,
  'inputBar.appendChild(panelShell);'
);
if (out2 === out) {
  // try CRLF
  out2 = out.replace(
    /for \(var _np = 0; _np < nativePickers\.length; _np\+\+\) inputBar\.appendChild\(nativePickers\[_np\]\);/,
    'inputBar.appendChild(panelShell);'
  );
}

// Ensure we still have inputBar.appendChild(plusBtn) then panelShell
if (!/inputBar\.appendChild\(panelShell\)/.test(out2)) {
  out2 = out2.replace(
    /inputBar\.appendChild\(plusBtn\);/,
    'inputBar.appendChild(plusBtn);\n    inputBar.appendChild(panelShell);'
  );
}

// Remove leftover nativePickers if any
out2 = out2.replace(/var nativePickers = \[actionSelect\];\s*/g, '');

fs.writeFileSync(file, out2);
console.log('rewrote plus menu');
console.log('has openPanel', out2.includes('function openPanel'));
console.log('has panelShell append', /appendChild\(panelShell\)/.test(out2));
console.log('nativePickers left', out2.includes('nativePickers'));
console.log('has double inputBar?', (out2.match(/var inputBar = el/g) || []).length);
