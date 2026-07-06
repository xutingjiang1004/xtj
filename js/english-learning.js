/* ============================================================
 * XTJ 英语学习二级页面
 * 单词库 + AI 生成阅读文章 + 选择题 + 完形填空 + 答题评分
 * ============================================================ */

(function() {
  'use strict';

  var S = {
    words: [],          // [{id, en, cn, addedAt}]
    history: [],        // [{id, score, total, level, time}]
    currentQuiz: null,  // {article, words, questions, answers, level, types}
    isGenerating: false
  };

  var STORAGE_KEY = 'xtj_english_words_v1';
  var HISTORY_KEY = 'xtj_english_history_v1';
  var MAX_WORDS = 200;
  var MAX_HISTORY = 50;

  // ============= Storage =============
  function loadWords() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      console.warn('[EL] loadWords failed:', e && e.message);
      return [];
    }
  }
  function saveWords() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S.words.slice(0, MAX_WORDS))); } catch (e) { console.warn('[EL] saveWords failed:', e && e.message); }
  }
  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(S.history.slice(0, MAX_HISTORY))); } catch (e) { console.warn('[EL] saveHistory failed:', e && e.message); }
  }

  function uid() {
    return 'w_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ============= Element helpers =============
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === undefined || v === null) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.textContent = v;
        else if (k === 'style') node.style.cssText = v;
        else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      }
    }
    if (children !== undefined && children !== null) {
      if (typeof children === 'string') node.textContent = children;
      else if (Array.isArray(children)) {
        children.forEach(function(c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
      }
    }
    return node;
  }

  function notify(msg, type) {
    if (window.notify && typeof window.notify === 'function') {
      try { window.notify(msg, type); return; } catch (e) {}
    }
    if (type !== 'silent') {
      console.log('[EL]', msg);
    }
  }

  // ============= Auth helper =============
  function readUserName() {
    try { return sessionStorage.getItem('xtj_user_name') || localStorage.getItem('xtj_user_name') || ''; } catch (e) { return ''; }
  }
  function readPwHash() {
    try { return sessionStorage.getItem('xtj_pw_hash') || localStorage.getItem('xtj_pw_hash') || ''; } catch (e) { return ''; }
  }
  function readUserToken() {
    try { return sessionStorage.getItem('xtj_user_token') || localStorage.getItem('xtj_user_token') || ''; } catch (e) { return ''; }
  }
  async function getAuthHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    try {
      if (typeof window.ensureUserToken === 'function') {
        var t = await window.ensureUserToken();
        if (t) { headers.Authorization = 'Bearer ' + t; return headers; }
      }
    } catch (e) {}
    var tok = readUserToken();
    if (tok) headers.Authorization = 'Bearer ' + tok;
    return headers;
  }

  // ============= Word library =============
  function addWord(en, cn) {
    en = String(en || '').trim().toLowerCase();
    cn = String(cn || '').trim();
    if (!en) return null;
    if (!/^[a-zA-Z\s\-']+$/.test(en)) return null;
    if (en.length > 60) return null;
    // 去重
    for (var i = 0; i < S.words.length; i++) {
      if (S.words[i].en === en) {
        // 更新释义
        if (cn && S.words[i].cn !== cn) S.words[i].cn = cn;
        return S.words[i];
      }
    }
    if (S.words.length >= MAX_WORDS) {
      notify('单词库已满 (' + MAX_WORDS + ' 词), 请删除部分');
      return null;
    }
    var w = { id: uid(), en: en, cn: cn || '', addedAt: Date.now() };
    S.words.unshift(w);
    saveWords();
    return w;
  }

  function deleteWord(id) {
    S.words = S.words.filter(function(w) { return w.id !== id; });
    saveWords();
  }

  function deleteSelected(ids) {
    if (!ids || !ids.length) return 0;
    S.words = S.words.filter(function(w) { return ids.indexOf(w.id) < 0; });
    saveWords();
    return ids.length;
  }

  function clearAllWords() {
    S.words = [];
    saveWords();
  }

  // ============= Render word list =============
  function renderWordList() {
    var list = $('elWordList');
    if (!list) return;
    list.innerHTML = '';
    if (S.words.length === 0) {
      list.appendChild(el('div', { class: 'el-empty-hint', text: '还没有单词, 添加一个开始学习吧 ✨' }));
      $('elWordCount').textContent = '0';
      updateGenInfo();
      return;
    }
    S.words.forEach(function(w) {
      var item = el('div', { class: 'el-word-item', 'data-id': w.id });
      var cb = el('input', { type: 'checkbox', class: 'el-word-cb', 'data-id': w.id });
      cb.addEventListener('change', function() {
        if (cb.checked) item.classList.add('selected');
        else item.classList.remove('selected');
      });
      var en = el('div', { class: 'el-word-en', text: w.en });
      var cn = el('div', { class: 'el-word-cn', text: w.cn || '—' });
      var delBtn = el('button', { class: 'el-word-del', 'aria-label': '删除', title: '删除', text: '×' });
      delBtn.addEventListener('click', function() {
        deleteWord(w.id);
        renderWordList();
        updateGenInfo();
        notify('已删除: ' + w.en);
      });
      item.appendChild(cb);
      item.appendChild(en);
      item.appendChild(cn);
      item.appendChild(delBtn);
      list.appendChild(item);
    });
    $('elWordCount').textContent = String(S.words.length);
    updateGenInfo();
  }

  function updateGenInfo() {
    var el2 = $('elGenTotal');
    if (el2) el2.textContent = String(S.words.length);
    var el3 = $('elGenBtn');
    if (el3) el3.disabled = S.words.length === 0;
  }

  // ============= AI Generation =============
  function getSelectedTypes() {
    var types = [];
    var boxes = document.querySelectorAll('input[name="elType"]:checked');
    boxes.forEach(function(b) { types.push(b.value); });
    return types;
  }
  function getSelectedLevel() {
    var r = document.querySelector('input[name="elLevel"]:checked');
    return r ? r.value : 'cet4';
  }

  async function generateQuiz() {
    if (S.isGenerating) return;
    if (S.words.length === 0) {
      notify('请先添加单词到单词库');
      return;
    }
    var types = getSelectedTypes();
    if (types.length === 0) {
      notify('请至少选择一种题目类型');
      return;
    }
    var level = getSelectedLevel();

    S.isGenerating = true;
    showLoading(true);
    hideResult();
    hideArticle();
    hideQuestions();

    try {
      var apiBase = (typeof window.API_BASE === 'string' && window.API_BASE) ? window.API_BASE : '/api/agent';
      var headers = await getAuthHeaders();
      var un = readUserName();
      var pw = readPwHash();
      var body = {
        words: S.words.map(function(w) { return { en: w.en, cn: w.cn || '' }; }),
        level: level,
        types: types
      };
      // 兼容旧认证: 附带 user_name + password_hash
      if (!headers.Authorization && un && pw) {
        body.user_name = un;
        body.password_hash = pw;
      }
      var resp = await fetch(apiBase + '/english/generate', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        var errText = '';
        try { var ej = await resp.json(); errText = (ej && ej.error) || ''; } catch (e) {}
        throw new Error(errText || ('HTTP ' + resp.status));
      }

      var json = await resp.json();
      if (!json.ok || !json.data) {
        throw new Error(json.error || '返回数据异常');
      }
      var data = json.data;

      S.currentQuiz = {
        article: data.article || '',
        words: data.words_used || S.words.map(function(w) { return w.en; }),
        questions: data.questions || [],
        answers: {},
        level: level,
        types: types,
        time: Date.now()
      };

      renderArticle(S.currentQuiz);
      renderQuestions(S.currentQuiz);
      showLoading(false);
    } catch (e) {
      showLoading(false);
      console.error('[EL] generate error:', e);
      notify('生成失败: ' + (e.message || '未知错误'));
    } finally {
      S.isGenerating = false;
    }
  }

  // ============= Render Article & Questions =============
  function renderArticle(quiz) {
    var card = $('elArticleCard');
    var text = $('elArticleText');
    var meta = $('elArticleMeta');
    var wordsBox = $('elArticleWords');
    if (!card || !text) return;

    text.textContent = quiz.article || '(本轮未生成文章)';
    if (meta) meta.textContent = quiz.words.length + ' 词 · ' + (quiz.level || '').toUpperCase();

    if (wordsBox) {
      wordsBox.innerHTML = '';
      if (quiz.words && quiz.words.length) {
        quiz.words.slice(0, 20).forEach(function(w) {
          wordsBox.appendChild(el('span', { class: 'el-word-tag', text: w }));
        });
      }
    }
    card.style.display = '';
  }

  function renderQuestions(quiz) {
    var card = $('elQuestionsCard');
    var list = $('elQuestionsList');
    var meta = $('elQuestionsMeta');
    if (!card || !list) return;
    list.innerHTML = '';

    quiz.questions.forEach(function(q, qi) {
      var qEl = el('div', { class: 'el-question', 'data-qid': q.id });
      if (q.type === 'mc') {
        var title = el('div', { class: 'el-q-title' });
        title.appendChild(el('span', { class: 'el-q-type', text: '单选' }));
        title.appendChild(document.createTextNode('Q' + (qi + 1) + '. ' + q.question));
        qEl.appendChild(title);
        var opts = el('div', { class: 'el-q-options' });
        q.options.forEach(function(opt, oi) {
          var oid = q.id + '_' + oi;
          var optEl = el('label', { class: 'el-q-option', 'data-oid': oid, 'data-oi': oi, 'data-qid': q.id });
          var input = el('input', { type: 'radio', name: 'q_' + q.id, value: String(oi) });
          input.addEventListener('change', function() {
            S.currentQuiz.answers[q.id] = oi;
            // 高亮选中
            var siblings = opts.querySelectorAll('.el-q-option');
            siblings.forEach(function(s) { s.classList.remove('selected'); });
            optEl.classList.add('selected');
          });
          optEl.appendChild(input);
          optEl.appendChild(el('span', { text: opt }));
          opts.appendChild(optEl);
        });
        qEl.appendChild(opts);
        qEl.appendChild(el('div', { class: 'el-q-explain', 'data-explain-for': q.id, style: 'display:none' }));
      } else if (q.type === 'cloze') {
        var title2 = el('div', { class: 'el-q-title' });
        title2.appendChild(el('span', { class: 'el-q-type', text: '完形' }));
        title2.appendChild(document.createTextNode('Q' + (qi + 1) + '. ' + q.question));
        qEl.appendChild(title2);
        var ctx = el('div', { class: 'el-q-context', style: 'font-size:13px;line-height:1.85;margin:6px 0;white-space:pre-wrap;color:rgb(55,70,65);' });
        // 渲染 context 并替换 ___ 为 select
        var ctxHtml = escapeHtml(q.context);
        var blankIdx = 0;
        var parts = ctxHtml.split('___');
        var ctxFrag = document.createDocumentFragment();
        parts.forEach(function(p, pi) {
          if (pi > 0) {
            // 插入 select
            var bk = q.blanks[blankIdx];
            if (bk) {
              var sel = el('select', { class: 'el-blank-sel', 'data-qid': q.id, 'data-bi': String(blankIdx), style: 'padding:2px 6px;font-size:12px;border:1px solid rgba(140,196,158,0.4);border-radius:6px;background:rgba(255,255,255,0.7);' });
              sel.appendChild(el('option', { value: '-1', text: '(选)' }));
              bk.options.forEach(function(o, oi2) {
                sel.appendChild(el('option', { value: String(oi2), text: String.fromCharCode(65 + oi2) }));
              });
              sel.addEventListener('change', function() {
                var v = parseInt(sel.value);
                if (!S.currentQuiz.answers[q.id]) S.currentQuiz.answers[q.id] = {};
                S.currentQuiz.answers[q.id][blankIdx] = v;
              });
              ctxFrag.appendChild(sel);
            }
            blankIdx++;
          }
          ctxFrag.appendChild(document.createTextNode(p));
        });
        ctx.appendChild(ctxFrag);
        qEl.appendChild(ctx);
        qEl.appendChild(el('div', { class: 'el-q-explain', 'data-explain-for': q.id, style: 'display:none' }));
      }
      list.appendChild(qEl);
    });

    if (meta) {
      var mcCount = quiz.questions.filter(function(q) { return q.type === 'mc'; }).length;
      var clCount = quiz.questions.filter(function(q) { return q.type === 'cloze'; }).length;
      var total = quiz.questions.length + quiz.questions.reduce(function(s, q) { return s + (q.blanks ? q.blanks.length : 0); }, 0);
      meta.textContent = mcCount + ' 单选 + ' + clCount + ' 完形, 共 ' + total + ' 空';
    }
    card.style.display = '';
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function hideArticle() { var c = $('elArticleCard'); if (c) c.style.display = 'none'; }
  function hideQuestions() { var c = $('elQuestionsCard'); if (c) c.style.display = 'none'; }
  function hideResult() { var c = $('elResultCard'); if (c) c.style.display = 'none'; }
  function showLoading(b) {
    var l = $('elLoading');
    var g = $('elGenBtn');
    if (l) l.style.display = b ? '' : 'none';
    if (g) g.disabled = b || S.words.length === 0;
    if (b && g) g.textContent = '⏳ 生成中...';
    else if (g) g.textContent = '✨ 生成练习';
  }

  // ============= Submit & Scoring =============
  function submitAnswers() {
    if (!S.currentQuiz) return;
    var q = S.currentQuiz;
    var correct = 0;
    var total = 0;

    q.questions.forEach(function(qu) {
      if (qu.type === 'mc') {
        total++;
        var ua = q.answers[qu.id];
        if (typeof ua === 'number' && ua === qu.answer) correct++;
      } else if (qu.type === 'cloze') {
        qu.blanks.forEach(function(bk, bi) {
          total++;
          var ua2 = (q.answers[qu.id] || {})[bi];
          if (typeof ua2 === 'number' && ua2 === bk.answer) correct++;
        });
      }
    });

    var pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    showResult(correct, total, pct);

    // 记录
    S.history.unshift({
      id: 'h_' + Date.now(),
      score: correct,
      total: total,
      pct: pct,
      level: q.level,
      types: q.types,
      time: Date.now()
    });
    saveHistory();
    renderHistory();
  }

  function showResult(correct, total, pct) {
    var card = $('elResultCard');
    var icon = $('elResultIcon');
    var score = $('elResultScore');
    var text = $('elResultText');
    if (!card) return;
    if (icon) icon.textContent = pct >= 80 ? '🎉' : (pct >= 60 ? '👍' : '💪');
    if (score) score.textContent = correct + ' / ' + total + '  (' + pct + '%)';
    if (text) {
      var advice = pct >= 80 ? '太棒了! 你对这些单词掌握得很扎实~' :
                   pct >= 60 ? '不错哦! 错题可以再复习一下解析~' :
                   '加油! 错题解析值得仔细看, 多记几遍会更好的~';
      text.textContent = advice;
    }
    card.style.display = '';
    // 滚动到结果
    setTimeout(function() {
      try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    }, 100);
  }

  function showAllAnswers() {
    if (!S.currentQuiz) return;
    var q = S.currentQuiz;
    q.questions.forEach(function(qu) {
      if (qu.type === 'mc') {
        var opts = document.querySelectorAll('.el-q-option[data-qid="' + qu.id + '"]');
        opts.forEach(function(opt) {
          opt.classList.add('disabled');
          var oi = parseInt(opt.getAttribute('data-oi'));
          if (oi === qu.answer) opt.classList.add('correct');
          var ua = q.answers[qu.id];
          if (typeof ua === 'number' && ua === oi && ua !== qu.answer) opt.classList.add('wrong');
        });
        var explain = document.querySelector('.el-q-explain[data-explain-for="' + qu.id + '"]');
        if (explain) {
          explain.textContent = '✅ 正确答案: ' + String.fromCharCode(65 + qu.answer) + '. ' + (qu.options[qu.answer] || '') + ' · ' + (qu.explain || '');
          explain.style.display = '';
        }
      } else if (qu.type === 'cloze') {
        qu.blanks.forEach(function(bk, bi) {
          var sels = document.querySelectorAll('.el-blank-sel[data-qid="' + qu.id + '"][data-bi="' + bi + '"]');
          sels.forEach(function(sel) {
            sel.value = String(bk.answer);
            sel.style.background = 'rgba(160, 220, 180, 0.4)';
            sel.style.borderColor = 'rgba(66, 155, 122, 0.5)';
          });
        });
        var explain2 = document.querySelector('.el-q-explain[data-explain-for="' + qu.id + '"]');
        if (explain2) {
          var s = '✅ 答案: ';
          qu.blanks.forEach(function(bk, bi) {
            s += '空' + (bi + 1) + '=' + String.fromCharCode(65 + bk.answer) + '; ';
          });
          s += ' · ' + (qu.blanks[0] && qu.blanks[0].explain || '');
          explain2.textContent = s;
          explain2.style.display = '';
        }
      }
    });
    // 禁用提交按钮
    var sb = $('elSubmitBtn');
    if (sb) sb.disabled = true;
  }

  // ============= History =============
  function renderHistory() {
    var list = $('elHistoryList');
    if (!list) return;
    list.innerHTML = '';
    if (!S.history || S.history.length === 0) {
      list.appendChild(el('div', { class: 'el-empty-hint', text: '还没有练习记录' }));
      return;
    }
    S.history.forEach(function(h) {
      var item = el('div', { class: 'el-history-item', 'data-id': h.id });
      var scoreClass = h.pct >= 80 ? '' : (h.pct >= 60 ? 'mid' : 'low');
      var score = el('div', { class: 'el-h-score ' + scoreClass, text: h.pct + '%' });
      var info = el('div', { class: 'el-h-info' });
      info.appendChild(el('div', { text: h.correct + '/' + h.total + ' · ' + (h.score || 0) + ' 分' }));
      info.appendChild(el('div', { class: 'el-h-meta', text: ((h.level || 'cet4').toUpperCase()) + ' · ' + (h.types || []).join('/') }));
      var time = el('div', { class: 'el-h-time', text: formatTime(h.time) });
      item.appendChild(score);
      item.appendChild(info);
      item.appendChild(time);
      list.appendChild(item);
    });
  }

  function formatTime(ts) {
    var d = new Date(ts);
    var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
    var now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return '今天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // ============= Tabs =============
  function switchTab(name) {
    var tabs = document.querySelectorAll('.el-tab');
    tabs.forEach(function(t) {
      if (t.getAttribute('data-eltab') === name) t.classList.add('active');
      else t.classList.remove('active');
    });
    var panes = ['library', 'practice', 'history'];
    panes.forEach(function(p) {
      var pn = $('elPane' + p.charAt(0).toUpperCase() + p.slice(1));
      if (pn) {
        if (p === name) pn.classList.add('active');
        else pn.classList.remove('active');
      }
    });
    if (name === 'history') renderHistory();
  }

  // ============= Open/Close =============
  function setDockBarVisible(visible) {
    var dockBar = document.querySelector('.dock-bar');
    if (dockBar) dockBar.style.display = visible ? '' : 'none';
  }

  function openPage() {
    var panel = $('panelEnglishLearning');
    if (!panel) return;
    if (!window.currentUser) {
      if (typeof window.notify === 'function') {
        try { window.notify('请先登录后再使用英语学习'); return; } catch (e) {}
      }
      return;
    }
    panel.classList.remove('hidden');
    setTimeout(function() { panel.classList.add('el-show'); }, 10);
    setDockBarVisible(false);
    S.words = loadWords();
    S.history = loadHistory();
    renderWordList();
    renderHistory();
    updateGenInfo();
  }

  function closePage() {
    var panel = $('panelEnglishLearning');
    if (!panel) return;
    panel.classList.add('hidden');
    panel.classList.remove('el-show');
    setDockBarVisible(true);
  }

  // ============= Event bindings =============
  function bindEvents() {
    // Dock tab click - use capture phase and stop propagation to prevent switchDockTab
    var dockBtn = $('englishLearnBtn');
    if (dockBtn) {
      dockBtn.addEventListener('click', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        openPage();
      }, true);
    }

    // Back button
    var back = $('elBackBtn');
    if (back) back.addEventListener('click', function() { closePage(); });

    // Tabs
    var tabs = document.querySelectorAll('.el-tab');
    tabs.forEach(function(t) {
      t.addEventListener('click', function() {
        switchTab(t.getAttribute('data-eltab'));
      });
    });

    // Add single word
    var addBtn = $('elAddWordBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        var en = $('elWordInput').value.trim();
        var cn = $('elMeaningInput').value.trim();
        if (!en) { notify('请输入英文单词'); return; }
        var w = addWord(en, cn);
        if (w) {
          notify('已添加: ' + w.en);
          $('elWordInput').value = '';
          $('elMeaningInput').value = '';
          $('elWordInput').focus();
          renderWordList();
        }
      });
    }

    // Enter to add
    ['elWordInput', 'elMeaningInput'].forEach(function(id) {
      var input = $(id);
      if (input) {
        input.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            $('elAddWordBtn').click();
          }
        });
      }
    });

    // Batch add
    var batchBtn = $('elBatchAddBtn');
    if (batchBtn) {
      batchBtn.addEventListener('click', function() {
        var text = $('elBatchInput').value;
        var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l; });
        var added = 0;
        var dupes = 0;
        var before = S.words.length;
        lines.forEach(function(line) {
          var parts = line.split(/\s+/);
          var en = parts[0] || '';
          var cn = parts.slice(1).join(' ').replace(/^\(|\)$/g, '').trim();
          if (en) {
            var w = addWord(en, cn);
            if (w) added++;
          }
        });
        var after = S.words.length;
        dupes = added - (after - before);
        if (added > 0) {
          notify('批量添加完成: +' + (after - before) + ' 新词');
          $('elBatchInput').value = '';
          renderWordList();
        } else {
          notify('没有有效输入');
        }
      });
    }

    // Select all
    var sa = $('elSelectAllCb');
    if (sa) {
      sa.addEventListener('change', function() {
        var cbs = document.querySelectorAll('.el-word-cb');
        cbs.forEach(function(cb) { cb.checked = sa.checked; cb.dispatchEvent(new Event('change')); });
      });
    }

    // Delete selected
    var ds = $('elDeleteSelBtn');
    if (ds) {
      ds.addEventListener('click', function() {
        var cbs = document.querySelectorAll('.el-word-cb:checked');
        if (cbs.length === 0) { notify('请先勾选要删除的单词'); return; }
        if (!confirm('确定删除选中的 ' + cbs.length + ' 个单词?')) return;
        var ids = Array.from(cbs).map(function(cb) { return cb.getAttribute('data-id'); });
        var n = deleteSelected(ids);
        notify('已删除 ' + n + ' 个单词');
        renderWordList();
        $('elSelectAllCb').checked = false;
      });
    }

    // Generate
    var genBtn = $('elGenBtn');
    if (genBtn) genBtn.addEventListener('click', generateQuiz);

    // Submit
    var subBtn = $('elSubmitBtn');
    if (subBtn) subBtn.addEventListener('click', submitAnswers);

    // Show answer
    var showBtn = $('elShowAnswerBtn');
    if (showBtn) showBtn.addEventListener('click', showAllAnswers);

    // New practice
    var newBtn = $('elNewPracticeBtn');
    if (newBtn) newBtn.addEventListener('click', function() {
      hideResult();
      hideArticle();
      hideQuestions();
      switchTab('practice');
      $('elGenCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Header: new practice button
    var newTopBtn = $('elNewChatBtn');
    if (newTopBtn) newTopBtn.addEventListener('click', function() {
      hideResult();
      hideArticle();
      hideQuestions();
      switchTab('practice');
    });

    // Header: clear
    var delBtn = $('elDeleteBtn');
    if (delBtn) delBtn.addEventListener('click', function() {
      if (!confirm('确定清空全部单词和练习记录? 此操作不可恢复!')) return;
      clearAllWords();
      S.history = [];
      saveHistory();
      renderWordList();
      renderHistory();
      notify('已清空');
    });
  }

  // ============= Bootstrap =============
  function bootstrap() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  function init() {
    S.words = loadWords();
    S.history = loadHistory();
    bindEvents();
    console.log('[EL] English learning initialized. Words:', S.words.length, 'History:', S.history.length);
  }

  bootstrap();

  // Expose for external usage
  window.EnglishLearning = {
    open: openPage,
    close: closePage,
    addWord: addWord,
    getWords: function() { return S.words.slice(); }
  };
  try { console.log('[EL] English learning loaded, panel:', !!document.getElementById('panelEnglishLearning')); } catch (e) {}
})();
