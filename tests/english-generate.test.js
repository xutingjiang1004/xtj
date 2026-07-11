'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createEnglishGenerateHandler,
  registerEnglishGenerateRoute,
  validateEnglishGenerateInput,
  validateEnglishGenerateOutput
} = require('../render-api/english-generate');

function validBody(overrides) {
  return Object.assign({
    words: [{ en: 'apple', cn: '苹果', mastery: 30 }],
    level: 'cet4',
    types: ['article', 'mc'],
    question_count: 2,
    article_length: 'short',
    topic: 'technology',
    focus: 'weak'
  }, overrides || {});
}

function validModel(overrides) {
  return Object.assign({
    article: 'Apple technology changes how people learn.',
    words_used: ['apple'],
    questions: [{
      id: 'q1',
      type: 'mc',
      question: 'Which word appears in the article?',
      options: ['apple', 'pear', 'orange', 'banana'],
      answer: 0,
      explain: 'The article uses apple.'
    }, {
      id: 'q2',
      type: 'mc',
      question: 'What is apple in Chinese?',
      options: ['苹果', '梨', '橙子', '香蕉'],
      answer: 0,
      explain: 'Apple means 苹果.'
    }]
  }, overrides || {});
}

function fakeResponse() {
  return {
    statusCode: 200,
    body: null,
    status: function(code) { this.statusCode = code; return this; },
    json: function(body) { this.body = body; return this; }
  };
}

async function invoke(options) {
  options = options || {};
  var res = fakeResponse();
  var capturedOptions;
  var handler = createEnglishGenerateHandler({
    callDeepSeek: options.callDeepSeek || async function(messages, callOptions) {
      capturedOptions = callOptions;
      return { content: JSON.stringify(validModel()), usage: null };
    },
    isDeepSeekConfigured: function() { return options.configured !== false; },
    timeoutMs: options.timeoutMs || 50,
    logger: { error: function() {} }
  });
  await handler({ body: options.body || validBody() }, res);
  return { res: res, callOptions: capturedOptions };
}

test('generate route is registered behind authentication and an independent limiter', function() {
  var source = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
  assert.match(source, /registerEnglishGenerateRoute\(app, \{[\s\S]*?authenticateUser: authenticateUser,[\s\S]*?rateLimit: rateLimit/);
  assert.doesNotMatch(source, /\/\*\s*try \{\s*\}\)\.filter\(function\(s\)/);
});

test('registered route rejects an unauthenticated request with 401', async function() {
  var chain;
  var modelCalled = false;
  var app = { post: function(pathname) {
    assert.equal(pathname, '/api/agent/english/generate');
    chain = Array.prototype.slice.call(arguments, 1);
  } };
  var authenticateUser = function(req, res) { return res.status(401).json({ error: '未登录' }); };
  var limiter = function(req, res, next) { return next(); };
  var rateLimit = function(windowMs, maxRequests) {
    assert.equal(windowMs, 60000);
    assert.equal(maxRequests, 10);
    return limiter;
  };
  registerEnglishGenerateRoute(app, {
    authenticateUser: authenticateUser,
    rateLimit: rateLimit,
    callDeepSeek: async function() { modelCalled = true; },
    isDeepSeekConfigured: function() { return true; },
    logger: { error: function() {} }
  });
  var res = fakeResponse();
  await chain[0]({ body: validBody() }, res, function() {});
  assert.equal(res.statusCode, 401);
  assert.equal(modelCalled, false);
});

test('valid input is normalized and duplicate words are removed', function() {
  var result = validateEnglishGenerateInput(validBody({
    words: [
      { en: ' Apple ', cn: '苹果', mastery: 20 },
      { en: 'apple', cn: '重复', mastery: 80 }
    ]
  }));
  assert.deepEqual(result.words, [{ en: 'apple', cn: '苹果', mastery: 20 }]);
});

test('invalid request fields return 400 without calling DeepSeek', async function() {
  var called = false;
  var result = await invoke({
    body: validBody({ level: 'unknown' }),
    callDeepSeek: async function() { called = true; }
  });
  assert.equal(result.res.statusCode, 400);
  assert.equal(result.res.body.ok, false);
  assert.equal(called, false);
});

test('missing API key returns 503 without a mock article', async function() {
  var called = false;
  var result = await invoke({
    configured: false,
    callDeepSeek: async function() { called = true; }
  });
  assert.equal(result.res.statusCode, 503);
  assert.equal(result.res.body.ok, false);
  assert.equal(called, false);
});

test('successful DeepSeek response has an explicit source and abort signal', async function() {
  var captured;
  var result = await invoke({
    callDeepSeek: async function(messages, options) {
      captured = options;
      return { content: JSON.stringify(validModel()), usage: { total_tokens: 20 } };
    }
  });
  assert.equal(result.res.statusCode, 200);
  assert.equal(result.res.body.ok, true);
  assert.equal(result.res.body.source, 'deepseek');
  assert.equal(captured.response_format.type, 'json_object');
  assert.ok(captured.signal instanceof AbortSignal);
});

test('malformed model JSON returns 502', async function() {
  var result = await invoke({ callDeepSeek: async function() { return { content: 'not json' }; } });
  assert.equal(result.res.statusCode, 502);
  assert.equal(result.res.body.ok, false);
});

test('invalid answer index and HTML model output are rejected', function() {
  var request = validateEnglishGenerateInput(validBody());
  assert.throws(function() {
    validateEnglishGenerateOutput(validModel({ questions: [Object.assign({}, validModel().questions[0], { answer: 9 })] }), request);
  }, /答案下标错误/);
  assert.throws(function() {
    validateEnglishGenerateOutput(validModel({ article: '<script>alert(1)</script>' }), request);
  }, /不安全/);
});

test('article is required when article type was requested', function() {
  var request = validateEnglishGenerateInput(validBody());
  assert.throws(function() { validateEnglishGenerateOutput(validModel({ article: '' }), request); }, /article 为空/);
});

test('cloze preserves the blanks structure', function() {
  var request = validateEnglishGenerateInput(validBody({ types: ['cloze'], question_count: 2 }));
  var result = validateEnglishGenerateOutput(validModel({
    article: '',
    questions: [{
      id: 'q1', type: 'cloze', question: 'Complete the text.', context: 'I eat ___ and ___.',
      blanks: [{ options: ['apples', 'cars'], answer: 0, explain: 'Apples can be eaten.' }, { options: ['learn', 'sleep'], answer: 0, explain: 'Learn fits.' }]
    }]
  }), request);
  assert.equal(result.questions[0].blanks[0].answer, 0);
});


test('model output with zero questions is rejected', function() {
  var request = validateEnglishGenerateInput(validBody({ question_count: 4 }));
  assert.throws(function() { validateEnglishGenerateOutput(validModel({ questions: [] }), request); }, /questions 格式错误/);
});

test('model output with too few answerable items is rejected', function() {
  var request = validateEnglishGenerateInput(validBody({ question_count: 4 }));
  assert.throws(function() { validateEnglishGenerateOutput(validModel({ questions: [validModel().questions[0]] }), request); }, /可作答题量不足/);
});

test('model output with duplicate question ids is rejected', function() {
  var request = validateEnglishGenerateInput(validBody({ question_count: 2 }));
  var q = validModel().questions[0];
  assert.throws(function() { validateEnglishGenerateOutput(validModel({ questions: [q, Object.assign({}, q)] }), request); }, /id 重复/);
});

test('mixed multiple-choice and cloze blanks count toward requested answerable total', function() {
  var request = validateEnglishGenerateInput(validBody({ types: ['mc', 'cloze'], question_count: 4 }));
  var mc = validModel().questions[0];
  var result = validateEnglishGenerateOutput(validModel({
    questions: [
      mc,
      Object.assign({}, mc, { id: 'q2', question: 'Which is a fruit?' }),
      { id: 'q3', type: 'cloze', question: 'Complete the text.', context: 'I eat ___ and ___.', blanks: [
        { options: ['apples', 'cars'], answer: 0, explain: 'Apples can be eaten.' },
        { options: ['learn', 'sleep'], answer: 0, explain: 'Learn fits the topic.' }
      ] }
    ]
  }), request);
  assert.equal(result.questions.length, 3);
});

test('handler timeout returns 504 and aborts the injected signal', async function() {
  var signal;
  var result = await invoke({
    timeoutMs: 10,
    callDeepSeek: function(messages, options) {
      signal = options.signal;
      return new Promise(function() {});
    }
  });
  assert.equal(result.res.statusCode, 504);
  assert.equal(signal.aborted, true);
});

test('parse-batch prompt and parser use a strict words object', function() {
  var source = fs.readFileSync(path.join(__dirname, '..', 'render-api', 'server.js'), 'utf8');
  assert.match(source, /\{"words":\[\{"en":"apple","cn":"苹果"\}/);
  assert.match(source, /!Array\.isArray\(parsed\.words\)/);
  assert.doesNotMatch(source, /Array\.isArray\(arr\.data\)/);
});
