'use strict';

const MAX_RESPONSE_BYTES = 64 * 1024;
const HTML_TAG_RE = /<\s*\/?\s*[a-z][^>]*>/i;
const WORD_RE = /^[a-zA-Z\s\-']+$/;
const QUESTION_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

class EnglishGenerateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EnglishGenerateError';
    this.code = code;
  }
}

function failInput(message) {
  throw new EnglishGenerateError('INVALID_INPUT', message);
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, maxLength, field, allowEmpty) {
  if (typeof value !== 'string') failInput(field + ' 必须是字符串');
  var clean = value.trim();
  if (!allowEmpty && !clean) failInput(field + ' 不能为空');
  if (clean.length > maxLength) failInput(field + ' 过长');
  return clean;
}

function validateEnglishGenerateInput(body) {
  if (!isPlainObject(body)) failInput('请求体格式错误');
  if (!Array.isArray(body.words) || body.words.length < 1 || body.words.length > 200) {
    failInput('words 数量必须为 1 到 200');
  }

  var seenWords = Object.create(null);
  var words = [];
  body.words.forEach(function(item) {
    if (!isPlainObject(item)) failInput('word 必须是对象');
    var en = requireString(item.en, 60, '单词', false).toLowerCase();
    if (!WORD_RE.test(en)) failInput('单词格式不合法');
    var cn = requireString(item.cn == null ? '' : item.cn, 80, '中文释义', true);
    var mastery = item.mastery == null ? 0 : item.mastery;
    if (typeof mastery !== 'number' || !Number.isFinite(mastery) || mastery < 0 || mastery > 100) {
      failInput('mastery 必须为 0 到 100 的有限数值');
    }
    if (!seenWords[en]) {
      seenWords[en] = true;
      words.push({ en: en, cn: cn, mastery: mastery });
    }
  });
  if (!words.length) failInput('没有有效单词');

  var level = requireString(body.level, 10, 'level', false).toLowerCase();
  if (['cet4', 'cet6', 'ielts'].indexOf(level) < 0) failInput('level 不受支持');

  if (!Array.isArray(body.types) || body.types.length < 1 || body.types.length > 3) {
    failInput('types 数量必须为 1 到 3');
  }
  var typeSeen = Object.create(null);
  var types = [];
  body.types.forEach(function(value) {
    if (typeof value !== 'string' || ['article', 'mc', 'cloze'].indexOf(value) < 0) failInput('题型不受支持');
    if (!typeSeen[value]) { typeSeen[value] = true; types.push(value); }
  });

  var hasQuizType = types.indexOf('mc') >= 0 || types.indexOf('cloze') >= 0;
  var hasArticle = types.indexOf('article') >= 0;
  var rawQuestionCount = body.question_count;
  var questionCount;
  if (!hasQuizType && hasArticle) {
    // article-only: question_count must be 0 (or normalize to 0); any non-zero value is coerced to 0
    if (rawQuestionCount == null) {
      questionCount = 0;
    } else {
      if (!Number.isSafeInteger(rawQuestionCount) || rawQuestionCount < 0 || rawQuestionCount > 10) {
        failInput('question_count 在仅生成文章模式下必须为 0');
      }
      questionCount = 0;
    }
  } else {
    if (!Number.isSafeInteger(rawQuestionCount) || rawQuestionCount < 2 || rawQuestionCount > 10) {
      failInput('question_count 必须为 2 到 10 的整数');
    }
    questionCount = rawQuestionCount;
  }
  var articleLength = requireString(body.article_length, 10, 'article_length', false).toLowerCase();
  if (['short', 'medium', 'long'].indexOf(articleLength) < 0) failInput('article_length 不受支持');
  var topic = requireString(body.topic == null ? '' : body.topic, 80, 'topic', true);
  var focus = requireString(body.focus, 10, 'focus', false).toLowerCase();
  if (['all', 'weak', 'selected'].indexOf(focus) < 0) failInput('focus 不受支持');
  if (body.regen_article != null && typeof body.regen_article !== 'boolean') failInput('regen_article 必须是布尔值');
  if (body.regen_quiz != null && typeof body.regen_quiz !== 'boolean') failInput('regen_quiz 必须是布尔值');
  if (body.regen_article === true && types.indexOf('article') < 0) failInput('regen_article 要求 types 包含 article');
  if (body.regen_quiz === true && types.indexOf('mc') < 0 && types.indexOf('cloze') < 0) failInput('regen_quiz 要求 types 包含 mc 或 cloze');

  return {
    words: words,
    level: level,
    types: types,
    question_count: questionCount,
    article_length: articleLength,
    topic: topic,
    focus: focus,
    regen_article: body.regen_article === true,
    regen_quiz: body.regen_quiz === true
  };
}

function safeModelText(value, maxLength, field, allowEmpty) {
  if (typeof value !== 'string') throw new EnglishGenerateError('INVALID_OUTPUT', field + ' 格式错误');
  var clean = value.trim();
  if (!allowEmpty && !clean) throw new EnglishGenerateError('INVALID_OUTPUT', field + ' 为空');
  if (clean.length > maxLength || HTML_TAG_RE.test(clean)) {
    throw new EnglishGenerateError('INVALID_OUTPUT', field + ' 不安全或过长');
  }
  return clean;
}

function validateOptions(options, min, max) {
  if (!Array.isArray(options) || options.length < min || options.length > max) {
    throw new EnglishGenerateError('INVALID_OUTPUT', '选项数量错误');
  }
  var seen = Object.create(null);
  var cleaned = options.map(function(option) {
    var text = safeModelText(option, 200, '选项', false);
    if (!text) throw new EnglishGenerateError('INVALID_OUTPUT', '选项不能为空');
    var key = text.toLowerCase();
    if (seen[key]) throw new EnglishGenerateError('INVALID_OUTPUT', '选项不得重复');
    seen[key] = true;
    return text;
  });
  return cleaned;
}


function answerableCount(question) {
  if (!isPlainObject(question)) return 0;
  if (question.type === 'mc') return 1;
  if (question.type === 'cloze' && Array.isArray(question.blanks)) return question.blanks.length;
  return 0;
}

function validateAnswer(answer, options) {
  if (!Number.isSafeInteger(answer) || answer < 0 || answer >= options.length) {
    throw new EnglishGenerateError('INVALID_OUTPUT', '答案下标错误');
  }
  return answer;
}

function validateEnglishGenerateOutput(data, request) {
  if (!isPlainObject(data)) throw new EnglishGenerateError('INVALID_OUTPUT', '响应不是对象');
  var article = safeModelText(data.article == null ? '' : data.article, 5000, 'article', true);
  if (request.types.indexOf('article') >= 0 && !article) {
    throw new EnglishGenerateError('INVALID_OUTPUT', 'article 为空');
  }
  if (!Array.isArray(data.words_used) || data.words_used.length > 200) {
    throw new EnglishGenerateError('INVALID_OUTPUT', 'words_used 格式错误');
  }
  var wordsUsed = data.words_used.map(function(word) {
    var clean = safeModelText(word, 60, 'words_used', false).toLowerCase();
    if (!WORD_RE.test(clean)) throw new EnglishGenerateError('INVALID_OUTPUT', 'words_used 格式错误');
    return clean;
  });
  // words_used 每个词必须属于请求词集
  var requestWordMap = Object.create(null);
  (request.words || []).forEach(function(w) { if (w && w.en) requestWordMap[w.en] = true; });
  wordsUsed.forEach(function(used) {
    if (!requestWordMap[used]) throw new EnglishGenerateError('INVALID_OUTPUT', 'words_used 包含未请求的词: ' + used);
  });
  var expectsQuestions = request.types.indexOf('mc') >= 0 || request.types.indexOf('cloze') >= 0;
  var expectsArticleOnly = !expectsQuestions && request.types.indexOf('article') >= 0;
  if (!Array.isArray(data.questions)) {
    throw new EnglishGenerateError('INVALID_OUTPUT', 'questions 必须是数组');
  }
  if (expectsArticleOnly) {
    // article-only: questions MUST be strictly empty
    if (data.questions.length !== 0) {
      throw new EnglishGenerateError('QUESTION_COUNT_MISMATCH', '仅生成文章时 questions 必须为空数组');
    }
  } else if (expectsQuestions) {
    if (data.questions.length < 1) {
      throw new EnglishGenerateError('QUESTION_COUNT_MISMATCH', 'questions 数量不足');
    }
    if (data.questions.length > request.question_count + 4) {
      // 给一点余量但必须后续 answerableCount 严格匹配
      throw new EnglishGenerateError('QUESTION_COUNT_MISMATCH', 'questions 数量超出预期');
    }
  }

  var seenQuestionIds = Object.create(null);
  var questions = data.questions.map(function(question, index) {
    if (!isPlainObject(question) || ['mc', 'cloze'].indexOf(question.type) < 0 || request.types.indexOf(question.type) < 0) {
      throw new EnglishGenerateError('INVALID_OUTPUT', 'question 类型错误');
    }
    var questionId = question.id == null ? 'q' + (index + 1) : question.id;
    if (typeof questionId !== 'string' && typeof questionId !== 'number') {
      throw new EnglishGenerateError('INVALID_OUTPUT', 'id 格式错误');
    }
    var cleanId = safeModelText(String(questionId), 80, 'id', false);
    if (!QUESTION_ID_RE.test(cleanId)) throw new EnglishGenerateError('INVALID_OUTPUT', 'id 格式错误');
    if (seenQuestionIds[cleanId]) throw new EnglishGenerateError('INVALID_OUTPUT', 'id 重复');
    seenQuestionIds[cleanId] = true;
    var base = {
      id: cleanId,
      type: question.type,
      question: safeModelText(question.question, 500, 'question', false)
    };
    if (question.type === 'mc') {
      base.options = validateOptions(question.options, 4, 4);
      base.answer = validateAnswer(question.answer, base.options);
      base.explain = safeModelText(question.explain == null ? '' : question.explain, 300, 'explain', true);
      return base;
    }
    base.context = safeModelText(question.context, 3000, 'context', false);
    if (!Array.isArray(question.blanks) || question.blanks.length < 1 || question.blanks.length > 10) {
      throw new EnglishGenerateError('INVALID_OUTPUT', 'blanks 格式错误');
    }
    var placeholderCount = (base.context.match(/___/g) || []).length;
    if (placeholderCount !== question.blanks.length) throw new EnglishGenerateError('INVALID_OUTPUT', 'blanks 占位符数量不匹配');
    base.blanks = question.blanks.map(function(blank) {
      if (!isPlainObject(blank)) throw new EnglishGenerateError('INVALID_OUTPUT', 'blank 格式错误');
      var options = validateOptions(blank.options, 2, 6);
      return {
        options: options,
        answer: validateAnswer(blank.answer, options),
        explain: safeModelText(blank.explain == null ? '' : blank.explain, 200, 'explain', true)
      };
    });
    return base;
  });

  var totalAnswerable = questions.reduce(function(sum, question) { return sum + answerableCount(question); }, 0);
  if (expectsArticleOnly) {
    if (totalAnswerable !== 0) {
      throw new EnglishGenerateError('QUESTION_COUNT_MISMATCH', '仅生成文章时不允许有可作答题目');
    }
  } else if (expectsQuestions) {
    if (totalAnswerable !== request.question_count) {
      throw new EnglishGenerateError('QUESTION_COUNT_MISMATCH', '可作答题量不匹配（期望 ' + request.question_count + '，实际 ' + totalAnswerable + '）');
    }
  } else {
    if (totalAnswerable !== 0) {
      throw new EnglishGenerateError('QUESTION_COUNT_MISMATCH', '不应该生成题目');
    }
  }

  var result = { article: article, words_used: wordsUsed, questions: questions };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_RESPONSE_BYTES) {
    throw new EnglishGenerateError('INVALID_OUTPUT', '响应过长');
  }
  return result;
}

function buildMessages(input) {
  var expectsQuestions = input.types.indexOf('mc') >= 0 || input.types.indexOf('cloze') >= 0;
  var questionInstruction = expectsQuestions
    ? '必须准确生成 question_count 对应的可作答题量：每个选择题计 1 题，每个完形填空 blank 计 1 题；总可作答题量必须等于 question_count，不允许少题、多题、零题或重复 id。'
    : '本次仅生成 article：questions 必须严格为 []；不要生成选择题或完形填空；question_count 在本模式下不用于生成题目；article 和 words_used 必须正常生成。';
  var instruction = [
    '请根据以下受控参数生成英语学习材料，并且只输出 JSON 对象。',
    '输出结构必须为 {"article":"...","words_used":["word"],"questions":[...]}。',
    '选择题必须有 4 个 options，answer 是 0 到 3 的数字下标。',
    '完形填空使用现有 blanks 数组结构，每个 blank 包含 options、answer、explain。',
    questionInstruction,
    '不得输出 HTML、脚本、Markdown 代码块或 JSON 之外的文字。',
    '参数：' + JSON.stringify(input)
  ].join('\n');
  return [
    { role: 'system', content: '你是英语教学 AI。严格遵守 JSON schema，不得添加额外文字。' },
    { role: 'user', content: instruction }
  ];
}

function createEnglishGenerateHandler(deps) {
  if (!deps || typeof deps.callDeepSeek !== 'function') throw new TypeError('callDeepSeek dependency is required');
  var configured = typeof deps.isDeepSeekConfigured === 'function' ? deps.isDeepSeekConfigured : function() { return false; };
  var logger = deps.logger || console;
  var timeoutMs = Number.isFinite(deps.timeoutMs) && deps.timeoutMs > 0 ? deps.timeoutMs : 55000;

  return async function englishGenerateHandler(req, res) {
    var input;
    try {
      input = validateEnglishGenerateInput(req.body);
    } catch (error) {
      var msg = String((error && error.message) || '请求参数不合法');
      return res.status(400).json({ ok: false, error: msg, code: 'INVALID_INPUT' });
    }
    if (!configured()) return res.status(503).json({ ok: false, error: 'AI 服务暂未配置', code: 'AI_NOT_CONFIGURED' });

    var controller = new AbortController();
    var timer;
    var timeoutPromise = new Promise(function(resolve, reject) {
      timer = setTimeout(function() {
        controller.abort();
        reject(new EnglishGenerateError('TIMEOUT', 'AI generation timed out'));
      }, timeoutMs);
    });
    try {
      var aiResult = await Promise.race([
        deps.callDeepSeek(buildMessages(input), {
          thinking_mode: 'low',
          max_tokens: 4096,
          response_format: { type: 'json_object' },
          signal: controller.signal
        }),
        timeoutPromise
      ]);
      var raw = aiResult && aiResult.content;
      if (typeof raw !== 'string' || !raw.trim()) throw new EnglishGenerateError('UPSTREAM', 'empty model response');
      var parsed;
      try { parsed = JSON.parse(raw); } catch (_) { throw new EnglishGenerateError('INVALID_OUTPUT', 'invalid JSON'); }
      var data = validateEnglishGenerateOutput(parsed, input);
      return res.json({ ok: true, source: 'deepseek', data: data, usage: aiResult.usage || null });
    } catch (error) {
      var message = String((error && error.message) || '');
      var eCode = error && error.code ? String(error.code).toUpperCase() : 'UPSTREAM_ERROR';
      var isTimeout = eCode === 'TIMEOUT' || (error && error.name === 'AbortError') || /超时|timeout/i.test(message);
      var status = 502;
      var replyCode = eCode;
      var replyMsg = message || 'AI 服务暂时无响应，请重试';
      if (isTimeout) { status = 504; replyCode = 'AI_TIMEOUT'; replyMsg = 'AI 生成超时，请重试'; }
      else if (eCode === 'INVALID_INPUT') { status = 400; replyMsg = message || '请求参数不合法'; }
      else if (eCode === 'INVALID_OUTPUT') { status = 502; replyCode = 'INVALID_OUTPUT'; replyMsg = 'AI 返回格式异常，请重试'; }
      else if (eCode === 'QUESTION_COUNT_MISMATCH') { status = 502; replyCode = 'QUESTION_COUNT_MISMATCH'; replyMsg = message || '题量不匹配'; }
      else if (eCode === 'INVALID_CLOZE_STRUCTURE') { status = 502; replyCode = 'INVALID_CLOZE_STRUCTURE'; replyMsg = '完形填空格式错误，请重试'; }
      else if (eCode === 'UPSTREAM' || eCode === 'AI_NOT_CONFIGURED') { status = 503; replyCode = eCode === 'AI_NOT_CONFIGURED' ? 'AI_NOT_CONFIGURED' : 'UPSTREAM_ERROR'; replyMsg = 'AI 服务暂未配置或不可用'; }
      try { logger.error('[ENGLISH-GEN] failed', { code: replyCode, detail: message }); } catch (_) {}
      return res.status(status).json({ ok: false, error: replyMsg, code: replyCode });
    } finally {
      clearTimeout(timer);
    }
  };
}

function registerEnglishGenerateRoute(app, deps) {
  if (!app || typeof app.post !== 'function') throw new TypeError('app.post is required');
  if (!deps || typeof deps.authenticateUser !== 'function' || typeof deps.rateLimit !== 'function') {
    throw new TypeError('authentication and rate limit dependencies are required');
  }
  var handler = createEnglishGenerateHandler(deps);
  app.post('/api/agent/english/generate', deps.authenticateUser, deps.rateLimit(60000, 10), handler);
  return handler;
}

module.exports = {
  EnglishGenerateError,
  createEnglishGenerateHandler,
  registerEnglishGenerateRoute,
  validateEnglishGenerateInput,
  validateEnglishGenerateOutput,
  answerableCount
};
